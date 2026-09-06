import { PoolClient } from "pg";
import { withTransaction, pool } from "../db/pool";
import { claimIdempotencyKey, storeIdempotentResponse } from "../middleware/idempotency";
import { recordAuditEvent } from "../audit/auditLog";
import { toCents, fromCents } from "../domain/money";
import { allocateFifo } from "../domain/allocation";
import { recordCashMovementForSupplierPayment } from "./cashSessionService";
import {
  RegisterPurchaseInput,
  RegisterPurchaseOutput,
  RegisterSupplierPaymentInput,
  RegisterSupplierPaymentOutput,
  SupplierAccountStatement,
} from "../domain/entities";
import {
  ValidationError,
  SupplierNotFoundError,
  SupplierPaymentExceedsBalanceError,
  NoOutstandingSupplierBalanceError,
} from "../domain/errors";

async function resolveOrCreateSupplier(
  client: PoolClient,
  tenantId: string,
  supplier: RegisterPurchaseInput["supplier"]
): Promise<string> {
  if ("id" in supplier) {
    const found = await client.query(`SELECT id FROM suppliers WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [
      tenantId,
      supplier.id,
    ]);
    if (found.rowCount === 0) throw new SupplierNotFoundError(supplier.id);
    return found.rows[0].id;
  }

  const existing = await client.query(`SELECT id FROM suppliers WHERE tenant_id = $1 AND name = $2 FOR UPDATE`, [
    tenantId,
    supplier.name,
  ]);
  if (existing.rowCount && existing.rowCount > 0) return existing.rows[0].id;

  const inserted = await client.query(
    `INSERT INTO suppliers (tenant_id, name, payment_terms) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, supplier.name, supplier.paymentTerms]
  );
  return inserted.rows[0].id;
}

async function outstandingBalanceCents(client: PoolClient, supplierId: string): Promise<number> {
  const result = await client.query<{ balance: string }>(
    `SELECT
        coalesce((SELECT sum(amount * 100)::bigint FROM purchases WHERE supplier_id = $1), 0)
        - coalesce((
            SELECT sum(spa.amount * 100)::bigint
            FROM supplier_payment_allocations spa
            JOIN supplier_payments sp ON sp.id = spa.payment_id
            JOIN purchases pu ON pu.id = spa.purchase_id
            WHERE pu.supplier_id = $1 AND sp.status = 'ACTIVE'
          ), 0) AS balance`,
    [supplierId]
  );
  return Number(result.rows[0].balance);
}

/**
 * Registers a purchase — BR-021: this simply adds to the supplier's single
 * accumulated balance; there is no per-invoice payable to track separately.
 */
export async function registerPurchase(
  actorUserId: string,
  tenantId: string,
  input: RegisterPurchaseInput
): Promise<RegisterPurchaseOutput> {
  if (!input.idempotencyKey) throw new ValidationError("idempotencyKey is required");
  if (toCents(input.amount) <= 0) throw new ValidationError("amount must be a positive decimal string");

  const result = await withTransaction<RegisterPurchaseOutput | { duplicate: RegisterPurchaseOutput }>(
    async (client) => {
      const fingerprint = JSON.stringify({ supplier: input.supplier, amount: input.amount });
      const claim = await claimIdempotencyKey(client, tenantId, input.idempotencyKey, fingerprint);
      if (claim.isDuplicate) return { duplicate: claim.storedResponse as RegisterPurchaseOutput };

      const supplierId = await resolveOrCreateSupplier(client, tenantId, input.supplier);

      const purchase = await client.query<{ id: string }>(
        `INSERT INTO purchases (tenant_id, supplier_id, amount, created_by_user_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, supplierId, input.amount, actorUserId]
      );

      const newBalanceCents = await outstandingBalanceCents(client, supplierId);

      const eventId = await recordAuditEvent(client, {
        tenantId,
        actorUserId,
        action: "PURCHASE_REGISTERED",
        entityType: "supplier",
        entityId: supplierId,
        metadata: { purchaseId: purchase.rows[0].id, amount: input.amount },
      });

      const output: RegisterPurchaseOutput = {
        supplierId,
        purchaseId: purchase.rows[0].id,
        outstandingBalance: fromCents(newBalanceCents),
        eventId,
      };
      await storeIdempotentResponse(client, tenantId, input.idempotencyKey, output);
      return output;
    }
  );

  return "duplicate" in result ? result.duplicate : result;
}

/**
 * Registers a payment TO a supplier. Allocated FIFO across outstanding
 * purchases (oldest first) for traceability, even though BR-021 means the
 * cajero only ever reasons about the single accumulated balance. No
 * "change" concept here — you cannot overpay a supplier, so total tendered
 * must not exceed the outstanding balance.
 */
export async function registerSupplierPayment(
  actorUserId: string,
  tenantId: string,
  input: RegisterSupplierPaymentInput
): Promise<RegisterSupplierPaymentOutput> {
  if (!input.idempotencyKey) throw new ValidationError("idempotencyKey is required");
  if (!input.tenders?.length) throw new ValidationError("tenders must have at least one entry");

  const result = await withTransaction<
    RegisterSupplierPaymentOutput | { duplicate: RegisterSupplierPaymentOutput }
  >(async (client) => {
    const fingerprint = JSON.stringify({ supplierId: input.supplierId, tenders: input.tenders });
    const claim = await claimIdempotencyKey(client, tenantId, input.idempotencyKey, fingerprint);
    if (claim.isDuplicate) return { duplicate: claim.storedResponse as RegisterSupplierPaymentOutput };

    const supplier = await client.query(`SELECT id FROM suppliers WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [
      tenantId,
      input.supplierId,
    ]);
    if (supplier.rowCount === 0) throw new SupplierNotFoundError(input.supplierId);

    const outstandingPurchases = await client.query<{ id: string; remaining_cents: string }>(
      `SELECT
          pu.id,
          (pu.amount * 100)::bigint
            - coalesce((
                SELECT sum(spa.amount * 100)::bigint
                FROM supplier_payment_allocations spa
                JOIN supplier_payments sp ON sp.id = spa.payment_id
                WHERE spa.purchase_id = pu.id AND sp.status = 'ACTIVE'
              ), 0) AS remaining_cents
       FROM purchases pu
       WHERE pu.supplier_id = $1
       ORDER BY pu.created_at ASC
       FOR UPDATE`,
      [input.supplierId]
    );

    const withBalance = outstandingPurchases.rows
      .map((r) => ({ id: r.id, remaining_cents: Number(r.remaining_cents) }))
      .filter((r) => r.remaining_cents > 0);
    if (withBalance.length === 0) throw new NoOutstandingSupplierBalanceError();

    const totalOutstandingCents = withBalance.reduce((s, r) => s + r.remaining_cents, 0);
    const tenderTotalCents = input.tenders.reduce((s, t) => s + toCents(t.amount), 0);
    if (tenderTotalCents > totalOutstandingCents) {
      throw new SupplierPaymentExceedsBalanceError(fromCents(totalOutstandingCents), fromCents(tenderTotalCents));
    }

    const payment = await client.query<{ id: string }>(
      `INSERT INTO supplier_payments (tenant_id, supplier_id, status, applied_amount, created_by_user_id)
       VALUES ($1, $2, 'ACTIVE', $3, $4) RETURNING id`,
      [tenantId, input.supplierId, fromCents(tenderTotalCents), actorUserId]
    );
    const paymentId = payment.rows[0].id;

    for (const t of input.tenders) {
      await client.query(
        `INSERT INTO supplier_payment_tenders (payment_id, method, amount) VALUES ($1, $2, $3)`,
        [paymentId, t.method, t.amount]
      );
    }

    const { allocations: fifoLines } = allocateFifo(
      withBalance.map((pu) => ({ id: pu.id, remainingCents: pu.remaining_cents })),
      tenderTotalCents
    );
    const allocationOutputs: RegisterSupplierPaymentOutput["allocations"] = [];
    for (const line of fifoLines) {
      await client.query(
        `INSERT INTO supplier_payment_allocations (payment_id, purchase_id, amount) VALUES ($1, $2, $3)`,
        [paymentId, line.id, fromCents(line.appliedCents)]
      );
      allocationOutputs.push({ purchaseId: line.id, amount: fromCents(line.appliedCents) });
    }

    const cashCents = input.tenders.filter((t) => t.method === "efectivo").reduce((s, t) => s + toCents(t.amount), 0);
    if (cashCents > 0) {
      await recordCashMovementForSupplierPayment(client, tenantId, paymentId, cashCents / 100);
    }

    const newBalanceCents = await outstandingBalanceCents(client, input.supplierId);

    const eventId = await recordAuditEvent(client, {
      tenantId,
      actorUserId,
      action: "SUPPLIER_PAYMENT_REGISTERED",
      entityType: "supplier",
      entityId: input.supplierId,
      metadata: { appliedAmount: fromCents(tenderTotalCents) },
    });

    const output: RegisterSupplierPaymentOutput = {
      paymentId,
      appliedAmount: fromCents(tenderTotalCents),
      outstandingBalance: fromCents(newBalanceCents),
      allocations: allocationOutputs,
      eventId,
    };
    await storeIdempotentResponse(client, tenantId, input.idempotencyKey, output);
    return output;
  });

  return "duplicate" in result ? result.duplicate : result;
}

export async function getSupplierAccountStatement(
  tenantId: string,
  supplierId: string
): Promise<SupplierAccountStatement> {
  const supplier = await pool.query(
    `SELECT id, tenant_id, name, payment_terms, created_at FROM suppliers WHERE tenant_id = $1 AND id = $2`,
    [tenantId, supplierId]
  );
  if (supplier.rowCount === 0) throw new SupplierNotFoundError(supplierId);

  const purchases = await pool.query(
    `SELECT id, amount, created_at FROM purchases WHERE tenant_id = $1 AND supplier_id = $2 ORDER BY created_at DESC`,
    [tenantId, supplierId]
  );
  const payments = await pool.query(
    `SELECT id, applied_amount, created_at FROM supplier_payments
     WHERE tenant_id = $1 AND supplier_id = $2 AND status = 'ACTIVE' ORDER BY created_at DESC`,
    [tenantId, supplierId]
  );
  const balanceCents = await outstandingBalanceCents(pool as unknown as PoolClient, supplierId);

  const row = supplier.rows[0];
  return {
    supplier: { id: row.id, tenantId: row.tenant_id, name: row.name, paymentTerms: row.payment_terms, createdAt: row.created_at },
    outstandingBalance: fromCents(balanceCents),
    purchases: purchases.rows.map((r) => ({ id: r.id, amount: r.amount, createdAt: r.created_at })),
    payments: payments.rows.map((r) => ({ id: r.id, appliedAmount: r.applied_amount, createdAt: r.created_at })),
  };
}
