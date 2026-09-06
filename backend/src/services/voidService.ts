import { PoolClient } from "pg";
import { withTransaction } from "../db/pool";
import { recordAuditEvent } from "../audit/auditLog";
import {
  PaymentNotFoundError,
  PaymentAlreadyVoidedError,
  ValidationError,
  VoidRequestNotFoundError,
  VoidRequestNotPendingError,
} from "../domain/errors";
import { PaymentVoidRequest } from "../domain/entities";

/**
 * BR-016 (LOOP 13, approved): a cajero may void THEIR OWN payment without
 * owner/supervisor authorization only if requested within this window from
 * the payment's creation — "antes de que el cliente se retire". Outside
 * this window, or if the requester isn't the original cashier, it always
 * falls back to the BR-015 request -> authorization flow.
 */
const SELF_VOID_WINDOW_SECONDS = 120;

/**
 * Applies the actual reversal to a payment: VOIDED status (BR-013: never
 * deleted), recomputes affected obligations' status from remaining ACTIVE
 * allocations, and reverses any cash movement. Shared by both the
 * owner/supervisor-authorized path and the BR-016 self-void path so the
 * financial effect is identical regardless of which authorization route
 * was taken.
 */
async function applyVoidReversal(
  client: PoolClient,
  tenantId: string,
  paymentId: string,
  voidedByUserId: string
): Promise<void> {
  await client.query(
    `UPDATE payments SET status = 'VOIDED', voided_at = now(), voided_by_user_id = $1 WHERE id = $2`,
    [voidedByUserId, paymentId]
  );

  const affectedObligations = await client.query<{ obligation_id: string }>(
    `SELECT DISTINCT obligation_id FROM payment_allocations WHERE payment_id = $1`,
    [paymentId]
  );
  for (const row of affectedObligations.rows) {
    const remaining = await client.query<{ remaining_cents: string }>(
      `SELECT
          (po.amount * 100)::bigint
            - coalesce((
                SELECT sum(pa.amount * 100)::bigint
                FROM payment_allocations pa
                JOIN payments p ON p.id = pa.payment_id
                WHERE pa.obligation_id = po.id AND p.status = 'ACTIVE'
              ), 0) AS remaining_cents
       FROM payment_obligations po WHERE po.id = $1`,
      [row.obligation_id]
    );
    const remainingCents = Number(remaining.rows[0].remaining_cents);
    const fullAmount = await client.query<{ amount: string }>(
      `SELECT amount FROM payment_obligations WHERE id = $1`,
      [row.obligation_id]
    );
    const fullCents = Math.round(Number(fullAmount.rows[0].amount) * 100);
    const newStatus = remainingCents <= 0 ? "PAID" : remainingCents === fullCents ? "PENDING" : "PARTIAL";
    await client.query(`UPDATE payment_obligations SET status = $1 WHERE id = $2`, [
      newStatus,
      row.obligation_id,
    ]);
  }

  const cashMovement = await client.query<{ id: string; cash_session_id: string; amount: string }>(
    `SELECT id, cash_session_id, amount FROM cash_movements WHERE payment_id = $1 AND type = 'SALE'`,
    [paymentId]
  );
  for (const cm of cashMovement.rows) {
    await client.query(
      `INSERT INTO cash_movements (tenant_id, cash_session_id, type, amount, payment_id)
       VALUES ($1, $2, 'REVERSAL', $3, $4)`,
      [tenantId, cm.cash_session_id, (Number(cm.amount) * -1).toFixed(2), paymentId]
    );
  }
}

/**
 * Step 1 of BR-015, with the BR-016 self-void shortcut evaluated first.
 *
 * - If the requester IS the payment's original creator AND the payment was
 *   created within SELF_VOID_WINDOW_SECONDS: void executes immediately,
 *   recorded as SELF_EXECUTED (own, distinguishable audit trail — never
 *   confused with an owner/supervisor-authorized void).
 * - Otherwise: creates a PENDING_AUTHORIZATION request; nothing financial
 *   changes until a 'supervisor' or 'admin' authorizes it (BR-017).
 */
export async function requestVoid(
  actorUserId: string,
  tenantId: string,
  paymentId: string,
  reason: string
): Promise<PaymentVoidRequest> {
  if (!reason?.trim()) throw new ValidationError("A reason is required to request a void");

  return withTransaction(async (client) => {
    const payment = await client.query<{ id: string; status: string; created_by_user_id: string; created_at: string }>(
      `SELECT id, status, created_by_user_id, created_at FROM payments WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, paymentId]
    );
    if (payment.rowCount === 0) throw new PaymentNotFoundError(paymentId);
    if (payment.rows[0].status === "VOIDED") throw new PaymentAlreadyVoidedError(paymentId);

    const isOwnPayment = payment.rows[0].created_by_user_id === actorUserId;
    const ageSeconds = (Date.now() - new Date(payment.rows[0].created_at).getTime()) / 1000;
    const eligibleForSelfVoid = isOwnPayment && ageSeconds <= SELF_VOID_WINDOW_SECONDS;

    if (eligibleForSelfVoid) {
      await applyVoidReversal(client, tenantId, paymentId, actorUserId);

      const inserted = await client.query(
        `INSERT INTO payment_void_requests
           (tenant_id, payment_id, status, reason, requested_by_user_id, authorized_by_user_id, resolved_at)
         VALUES ($1, $2, 'SELF_EXECUTED', $3, $4, $4, now())
         RETURNING id, tenant_id, payment_id, status, reason, requested_by_user_id,
                   authorized_by_user_id, requested_at, resolved_at`,
        [tenantId, paymentId, reason, actorUserId]
      );

      await recordAuditEvent(client, {
        tenantId,
        actorUserId,
        action: "PAYMENT_VOID_SELF_EXECUTED",
        entityType: "payment",
        entityId: paymentId,
        metadata: { reason, voidRequestId: inserted.rows[0].id, ageSeconds: Math.round(ageSeconds) },
      });

      return mapRow(inserted.rows[0]);
    }

    const inserted = await client.query(
      `INSERT INTO payment_void_requests
         (tenant_id, payment_id, status, reason, requested_by_user_id)
       VALUES ($1, $2, 'PENDING_AUTHORIZATION', $3, $4)
       RETURNING id, tenant_id, payment_id, status, reason, requested_by_user_id,
                 authorized_by_user_id, requested_at, resolved_at`,
      [tenantId, paymentId, reason, actorUserId]
    );

    await recordAuditEvent(client, {
      tenantId,
      actorUserId,
      action: "PAYMENT_VOID_REQUESTED",
      entityType: "payment",
      entityId: paymentId,
      metadata: { reason, voidRequestId: inserted.rows[0].id, selfVoidEligible: false },
    });

    return mapRow(inserted.rows[0]);
  });
}

/**
 * Step 2: BR-017 — 'admin' (owner) OR a designated 'supervisor' may
 * authorize/deny. Route-level requireRole('admin', 'supervisor') enforces
 * who may call this; this function trusts that check already ran.
 */
export async function authorizeVoid(
  actorUserId: string,
  tenantId: string,
  voidRequestId: string,
  decision: "AUTHORIZED" | "DENIED"
): Promise<PaymentVoidRequest> {
  return withTransaction(async (client) => {
    const request = await client.query(
      `SELECT * FROM payment_void_requests WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, voidRequestId]
    );
    if (request.rowCount === 0) throw new VoidRequestNotFoundError(voidRequestId);
    if (request.rows[0].status !== "PENDING_AUTHORIZATION") throw new VoidRequestNotPendingError();

    const paymentId = request.rows[0].payment_id;

    if (decision === "DENIED") {
      const updated = await client.query(
        `UPDATE payment_void_requests
         SET status = 'DENIED', authorized_by_user_id = $1, resolved_at = now()
         WHERE id = $2
         RETURNING *`,
        [actorUserId, voidRequestId]
      );
      await recordAuditEvent(client, {
        tenantId,
        actorUserId,
        action: "PAYMENT_VOID_DENIED",
        entityType: "payment",
        entityId: paymentId,
        metadata: { voidRequestId },
      });
      return mapRow(updated.rows[0]);
    }

    await applyVoidReversal(client, tenantId, paymentId, actorUserId);

    const updated = await client.query(
      `UPDATE payment_void_requests
       SET status = 'EXECUTED', authorized_by_user_id = $1, resolved_at = now()
       WHERE id = $2
       RETURNING *`,
      [actorUserId, voidRequestId]
    );

    await recordAuditEvent(client, {
      tenantId,
      actorUserId,
      action: "PAYMENT_VOID_EXECUTED",
      entityType: "payment",
      entityId: paymentId,
      metadata: { voidRequestId },
    });

    return mapRow(updated.rows[0]);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): PaymentVoidRequest {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    paymentId: row.payment_id,
    status: row.status,
    reason: row.reason,
    requestedByUserId: row.requested_by_user_id,
    authorizedByUserId: row.authorized_by_user_id,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
  };
}
