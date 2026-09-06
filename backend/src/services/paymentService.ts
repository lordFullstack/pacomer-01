import { PoolClient } from "pg";
import { withTransaction } from "../db/pool";
import { claimIdempotencyKey, storeIdempotentResponse } from "../middleware/idempotency";
import { recordAuditEvent } from "../audit/auditLog";
import { RegisterPaymentInput, RegisterPaymentOutput, ObligationStatus } from "../domain/entities";
import {
  ValidationError,
  ObligationNotFoundError,
  ObligationAlreadySettledError,
  ChangeExceedsCashTenderError,
} from "../domain/errors";
import { recordCashMovementForPayment } from "./cashSessionService";

import { toCents, fromCents } from "../domain/money";
import { allocateFifo } from "../domain/allocation";

function validateInput(input: RegisterPaymentInput): void {
  if (!input.idempotencyKey) throw new ValidationError("idempotencyKey is required");
  if (!input.obligationIds?.length) throw new ValidationError("obligationIds must have at least one id");
  if (!input.tenders?.length) throw new ValidationError("tenders must have at least one entry");
  for (const t of input.tenders) {
    if (!["efectivo", "transferencia"].includes(t.method)) {
      // BR-014 is enforced with a dedicated, clearer error at the call site
      // when method === 'credito'; anything else unknown is a plain 400.
      throw new ValidationError(`Unsupported tender method: ${t.method}`);
    }
    if (toCents(t.amount) <= 0) {
      throw new ValidationError("Each tender amount must be a positive decimal string");
    }
  }
}

interface ObligationRow {
  id: string;
  amount: string;
  status: ObligationStatus;
  remaining_cents: number;
}

async function lockObligationsWithRemainingBalance(
  client: PoolClient,
  tenantId: string,
  obligationIds: string[]
): Promise<ObligationRow[]> {
  const result = await client.query(
    `SELECT
        po.id,
        po.amount,
        po.status,
        (po.amount * 100)::bigint
          - coalesce((
              SELECT sum(pa.amount * 100)::bigint
              FROM payment_allocations pa
              JOIN payments p ON p.id = pa.payment_id
              WHERE pa.obligation_id = po.id AND p.status = 'ACTIVE'
            ), 0)
          - coalesce((
              SELECT sum(cc.amount * 100)::bigint
              FROM customer_credits cc
              WHERE cc.obligation_id = po.id
            ), 0) AS remaining_cents
     FROM payment_obligations po
     WHERE po.tenant_id = $1 AND po.id = ANY($2::uuid[])
     FOR UPDATE`,
    [tenantId, obligationIds]
  );

  if (result.rowCount !== obligationIds.length) {
    const foundIds = new Set(result.rows.map((r) => r.id));
    const missing = obligationIds.find((id) => !foundIds.has(id));
    throw new ObligationNotFoundError(missing ?? "unknown");
  }

  return result.rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    status: r.status,
    remaining_cents: Number(r.remaining_cents),
  }));
}

/**
 * POST /payments — 08_PAYMENTS_CASH.md patterns: individual, conjunto
 * (multiple obligationIds), parcial (tender < remaining), mixto (multiple
 * tenders). Allocation strategy: apply tender, in the order obligations
 * were given, up to each obligation's remaining balance; leftover tender
 * after all requested obligations are covered becomes Change (BR-012),
 * and can only be paid back from the cash portion tendered.
 */
export async function registerPayment(
  actorUserId: string,
  tenantId: string,
  input: RegisterPaymentInput
): Promise<RegisterPaymentOutput> {
  validateInput(input);

  const result = await withTransaction<RegisterPaymentOutput | { duplicate: RegisterPaymentOutput }>(
    async (client) => {
      const fingerprint = JSON.stringify({
        obligationIds: [...input.obligationIds].sort(),
        tenders: input.tenders,
      });
      const claim = await claimIdempotencyKey(client, tenantId, input.idempotencyKey, fingerprint);
      if (claim.isDuplicate) {
        return { duplicate: claim.storedResponse as RegisterPaymentOutput };
      }

      const obligations = await lockObligationsWithRemainingBalance(client, tenantId, input.obligationIds);
      for (const o of obligations) {
        if (o.remaining_cents <= 0) throw new ObligationAlreadySettledError(o.id);
      }

      const tenderTotalCents = input.tenders.reduce((sum, t) => sum + toCents(t.amount), 0);
      const cashTenderCents = input.tenders
        .filter((t) => t.method === "efectivo")
        .reduce((sum, t) => sum + toCents(t.amount), 0);

      // Allocate in the given order, capped per-obligation remaining balance.
      const { allocations: fifoLines, appliedTotalCents: appliedCents, leftoverCents: changeCents } = allocateFifo(
        obligations.map((o) => ({ id: o.id, remainingCents: o.remaining_cents })),
        tenderTotalCents
      );
      const allocations = fifoLines.map((line) => ({
        obligationId: line.id,
        cents: line.appliedCents,
        newStatus: (line.remainingAfterCents === 0 ? "PAID" : "PARTIAL") as ObligationStatus,
      }));

      if (changeCents > cashTenderCents) {
        // Can't give change out of a transfer (§11 ADR-STACK example).
        throw new ChangeExceedsCashTenderError();
      }

      const payment = await client.query<{ id: string; created_at: string }>(
        `INSERT INTO payments (tenant_id, status, amount, created_by_user_id)
         VALUES ($1, 'ACTIVE', $2, $3)
         RETURNING id, created_at`,
        [tenantId, fromCents(appliedCents), actorUserId]
      );
      const paymentId = payment.rows[0].id;

      for (const t of input.tenders) {
        await client.query(
          `INSERT INTO tenders (payment_id, method, amount) VALUES ($1, $2, $3)`,
          [paymentId, t.method, t.amount]
        );
      }

      const allocationOutputs: RegisterPaymentOutput["allocations"] = [];
      for (const a of allocations) {
        await client.query(
          `INSERT INTO payment_allocations (payment_id, obligation_id, amount)
           VALUES ($1, $2, $3)`,
          [paymentId, a.obligationId, fromCents(a.cents)]
        );
        await client.query(
          `UPDATE payment_obligations SET status = $1 WHERE id = $2`,
          [a.newStatus, a.obligationId]
        );
        allocationOutputs.push({
          obligationId: a.obligationId,
          amount: fromCents(a.cents),
          obligationStatus: a.newStatus,
        });
      }

      if (changeCents > 0) {
        await client.query(
          `INSERT INTO changes (payment_id, amount) VALUES ($1, $2)`,
          [paymentId, fromCents(changeCents)]
        );
      }

      // Cash movement only reflects the cash actually kept in the drawer:
      // cash tendered minus cash change returned.
      const netCashCents = cashTenderCents - changeCents;
      if (netCashCents !== 0) {
        await recordCashMovementForPayment(client, tenantId, paymentId, netCashCents / 100);
      }

      const eventId = await recordAuditEvent(client, {
        tenantId,
        actorUserId,
        action: "PAYMENT_REGISTERED",
        entityType: "payment",
        entityId: paymentId,
        metadata: {
          obligationIds: input.obligationIds,
          tenders: input.tenders,
          appliedAmount: fromCents(appliedCents),
          changeAmount: fromCents(changeCents),
        },
      });

      const output: RegisterPaymentOutput = {
        paymentId,
        appliedAmount: fromCents(appliedCents),
        changeAmount: fromCents(changeCents),
        allocations: allocationOutputs,
        eventId,
      };

      await storeIdempotentResponse(client, tenantId, input.idempotencyKey, output);
      return output;
    }
  );

  return "duplicate" in result ? result.duplicate : result;
}
