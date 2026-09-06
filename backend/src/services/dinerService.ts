import { createHash } from "crypto";
import { v4 as uuid } from "uuid";
import { PoolClient } from "pg";
import { withTransaction } from "../db/pool";
import { claimIdempotencyKey, storeIdempotentResponse } from "../middleware/idempotency";
import { recordAuditEvent } from "../audit/auditLog";
import { publishServiceLineEvent } from "../realtime/publishEvent";
import { RegisterDinerInput, RegisterDinerOutput } from "../domain/entities";
import { TableNotFoundError, ValidationError } from "../domain/errors";

function fingerprint(input: RegisterDinerInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        tableId: input.tableId,
        amount: input.amount,
        paymentMode: input.paymentMode,
        name: input.name ?? null,
        descriptor: input.descriptor ?? null,
      })
    )
    .digest("hex");
}

function validate(input: RegisterDinerInput): void {
  if (!input.tableId) throw new ValidationError("tableId is required");
  if (!input.idempotencyKey) throw new ValidationError("idempotencyKey is required");
  if (!["individual", "conjunto"].includes(input.paymentMode)) {
    throw new ValidationError("paymentMode must be 'individual' or 'conjunto'");
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError("amount must be a positive decimal string");
  }
}

/**
 * Finds the table's currently OPEN session, or opens one (BR-002: "una mesa
 * se abre al registrar el primer comensal"). BR-001/BR-006: any authorized
 * server may add diners to an open table session — no ownership check here
 * beyond tenant isolation.
 */
async function getOrOpenTableSession(
  client: PoolClient,
  tenantId: string,
  tableId: string
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM table_sessions
     WHERE tenant_id = $1 AND table_id = $2 AND status = 'OPEN'
     FOR UPDATE`,
    [tenantId, tableId]
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return existing.rows[0].id;
  }

  const table = await client.query(
    `SELECT id FROM tables WHERE tenant_id = $1 AND id = $2`,
    [tenantId, tableId]
  );
  if (table.rowCount === 0) {
    throw new TableNotFoundError(tableId);
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO table_sessions (tenant_id, table_id, status, opened_at)
     VALUES ($1, $2, 'OPEN', now())
     RETURNING id`,
    [tenantId, tableId]
  );
  return inserted.rows[0].id;
}

/**
 * POST /service-line/diners — the priority endpoint from 05_BACKEND.md.
 * Single atomic transaction: open/reuse table session, insert diner,
 * insert consumption, insert obligation, record audit event, claim
 * idempotency key. Realtime publish happens AFTER commit (ADR-STACK §8-9).
 */
export async function registerDiner(
  actorUserId: string,
  tenantId: string,
  input: RegisterDinerInput
): Promise<RegisterDinerOutput> {
  validate(input);
  const requestFingerprint = fingerprint(input);

  const result = await withTransaction<RegisterDinerOutput | { duplicate: RegisterDinerOutput }>(
    async (client) => {
      const claim = await claimIdempotencyKey(
        client,
        tenantId,
        input.idempotencyKey,
        requestFingerprint
      );
      if (claim.isDuplicate) {
        return { duplicate: claim.storedResponse as RegisterDinerOutput };
      }

      const tableSessionId = await getOrOpenTableSession(client, tenantId, input.tableId);

      const diner = await client.query<{ id: string; created_at: string }>(
        `INSERT INTO diners (tenant_id, table_session_id, name, descriptor, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [tenantId, tableSessionId, input.name ?? null, input.descriptor ?? null, actorUserId]
      );
      const dinerId = diner.rows[0].id;

      const consumption = await client.query<{ id: string }>(
        `INSERT INTO consumptions (tenant_id, diner_id, amount)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [tenantId, dinerId, input.amount]
      );
      const consumptionId = consumption.rows[0].id;

      const obligation = await client.query<{ id: string; status: string; created_at: string }>(
        `INSERT INTO payment_obligations
           (tenant_id, diner_id, consumption_id, payment_mode, amount, status)
         VALUES ($1, $2, $3, $4, $5, 'PENDING')
         RETURNING id, status, created_at`,
        [tenantId, dinerId, consumptionId, input.paymentMode, input.amount]
      );

      const eventId = await recordAuditEvent(client, {
        tenantId,
        actorUserId,
        action: "DINER_REGISTERED",
        entityType: "payment_obligation",
        entityId: obligation.rows[0].id,
        metadata: {
          tableId: input.tableId,
          tableSessionId,
          dinerId,
          amount: input.amount,
          paymentMode: input.paymentMode,
        },
      });

      const output: RegisterDinerOutput = {
        dinerId,
        obligationId: obligation.rows[0].id,
        tableSessionId,
        status: obligation.rows[0].status as RegisterDinerOutput["status"],
        createdAt: obligation.rows[0].created_at,
        eventId,
      };

      await storeIdempotentResponse(client, tenantId, input.idempotencyKey, output);
      return output;
    }
  );

  const output = "duplicate" in result ? result.duplicate : result;

  // Fire-and-forget: only for genuinely new writes, not replayed duplicates.
  if (!("duplicate" in result)) {
    void publishServiceLineEvent(tenantId, { ...output, tableId: input.tableId });
  }

  return output;
}

// exported for potential reuse by other services (kept local otherwise)
export const __internal = { fingerprint, ensureUuid: uuid };
