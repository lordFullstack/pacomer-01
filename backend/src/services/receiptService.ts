import { withTransaction, pool } from "../db/pool";
import { claimIdempotencyKey, storeIdempotentResponse } from "../middleware/idempotency";
import { recordAuditEvent } from "../audit/auditLog";
import { IssueReceiptInput, IssueReceiptOutput, Receipt } from "../domain/entities";
import { ValidationError, ObligationNotFoundError, ObligationNotYetPaidError } from "../domain/errors";

/**
 * POST /receipts — BR-024: operational receipt only, no fiscal fields.
 * Requires that every obligation referenced already has some payment or
 * credit registered against it (status != PENDING) — a receipt documents
 * money that moved, it doesn't create the movement itself.
 */
export async function issueReceipt(
  actorUserId: string,
  tenantId: string,
  input: IssueReceiptInput
): Promise<IssueReceiptOutput> {
  if (!input.idempotencyKey) throw new ValidationError("idempotencyKey is required");
  if (!input.obligationIds?.length) throw new ValidationError("obligationIds must have at least one id");

  const result = await withTransaction<IssueReceiptOutput | { duplicate: IssueReceiptOutput }>(async (client) => {
    const fingerprint = JSON.stringify({
      obligationIds: [...input.obligationIds].sort(),
      customerName: input.customerName ?? null,
      customerIdNumber: input.customerIdNumber ?? null,
    });
    const claim = await claimIdempotencyKey(client, tenantId, input.idempotencyKey, fingerprint);
    if (claim.isDuplicate) return { duplicate: claim.storedResponse as IssueReceiptOutput };

    const obligations = await client.query<{ id: string; amount: string; status: string }>(
      `SELECT id, amount, status FROM payment_obligations WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, input.obligationIds]
    );
    if (obligations.rowCount !== input.obligationIds.length) {
      const found = new Set(obligations.rows.map((r) => r.id));
      throw new ObligationNotFoundError(input.obligationIds.find((id) => !found.has(id)) ?? "unknown");
    }
    for (const o of obligations.rows) {
      if (o.status === "PENDING") throw new ObligationNotYetPaidError(o.id);
    }
    const totalAmount = obligations.rows.reduce((s, o) => s + Number(o.amount), 0).toFixed(2);

    // Per-tenant sequential counter (non-fiscal — see migration comment).
    await client.query(
      `INSERT INTO receipt_counters (tenant_id, next_number) VALUES ($1, 1)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId]
    );
    const counter = await client.query<{ next_number: string }>(
      `SELECT next_number FROM receipt_counters WHERE tenant_id = $1 FOR UPDATE`,
      [tenantId]
    );
    const sequentialNumber = Number(counter.rows[0].next_number);
    await client.query(`UPDATE receipt_counters SET next_number = next_number + 1 WHERE tenant_id = $1`, [tenantId]);

    const inserted = await client.query<{ id: string; issued_at: string }>(
      `INSERT INTO receipts
         (tenant_id, sequential_number, obligation_ids, amount, customer_name, customer_id_number, issued_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, issued_at`,
      [
        tenantId,
        sequentialNumber,
        input.obligationIds,
        totalAmount,
        input.customerName ?? null,
        input.customerIdNumber ?? null,
        actorUserId,
      ]
    );

    const eventId = await recordAuditEvent(client, {
      tenantId,
      actorUserId,
      action: "RECEIPT_ISSUED",
      entityType: "receipt",
      entityId: inserted.rows[0].id,
      metadata: { obligationIds: input.obligationIds, sequentialNumber, amount: totalAmount },
    });

    const output: IssueReceiptOutput = {
      id: inserted.rows[0].id,
      tenantId,
      sequentialNumber,
      obligationIds: input.obligationIds,
      amount: totalAmount,
      customerName: input.customerName ?? null,
      customerIdNumber: input.customerIdNumber ?? null,
      issuedByUserId: actorUserId,
      issuedAt: inserted.rows[0].issued_at,
      eventId,
    };
    await storeIdempotentResponse(client, tenantId, input.idempotencyKey, output);
    return output;
  });

  return "duplicate" in result ? result.duplicate : result;
}

export async function getReceipt(tenantId: string, receiptId: string): Promise<Receipt | null> {
  const result = await pool.query(
    `SELECT id, tenant_id, sequential_number, obligation_ids, amount, customer_name,
            customer_id_number, issued_by_user_id, issued_at
     FROM receipts WHERE tenant_id = $1 AND id = $2`,
    [tenantId, receiptId]
  );
  if (result.rowCount === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    tenantId: r.tenant_id,
    sequentialNumber: Number(r.sequential_number),
    obligationIds: r.obligation_ids,
    amount: r.amount,
    customerName: r.customer_name,
    customerIdNumber: r.customer_id_number,
    issuedByUserId: r.issued_by_user_id,
    issuedAt: r.issued_at,
  };
}
