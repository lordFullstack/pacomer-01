import { PoolClient } from "pg";
import { withTransaction } from "../db/pool";
import { recordAuditEvent } from "../audit/auditLog";
import { CashSessionNotOpenError, ValidationError } from "../domain/errors";
import { CashSession } from "../domain/entities";

/**
 * Called from within the SAME transaction as registerPayment (paymentService)
 * so a cash sale and its cash-drawer movement are atomic together.
 * 08_PAYMENTS_CASH.md: "Cobros en efectivo" as a movement type SALE.
 */
export async function recordCashMovementForPayment(
  client: PoolClient,
  tenantId: string,
  paymentId: string,
  netCashAmount: number
): Promise<void> {
  const session = await client.query<{ id: string }>(
    `SELECT id FROM cash_sessions
     WHERE tenant_id = $1 AND status IN ('OPEN', 'OPERATING')
     FOR UPDATE`,
    [tenantId]
  );
  if (session.rowCount === 0) {
    throw new CashSessionNotOpenError();
  }
  await client.query(
    `INSERT INTO cash_movements (tenant_id, cash_session_id, type, amount, payment_id)
     VALUES ($1, $2, 'SALE', $3, $4)`,
    [tenantId, session.rows[0].id, netCashAmount.toFixed(2), paymentId]
  );
  // Transition OPEN -> OPERATING on first movement of the day, if needed.
  await client.query(
    `UPDATE cash_sessions SET status = 'OPERATING' WHERE id = $1 AND status = 'OPEN'`,
    [session.rows[0].id]
  );
}

/**
 * Called from within the SAME transaction as registerSupplierPayment
 * (supplierService), for the cash portion of a payment made TO a supplier.
 * Recorded as a negative amount — it's an outflow from the drawer, the
 * mirror image of recordCashMovementForPayment's inflow.
 */
export async function recordCashMovementForSupplierPayment(
  client: PoolClient,
  tenantId: string,
  supplierPaymentId: string,
  cashAmount: number
): Promise<void> {
  if (cashAmount <= 0) return;
  const session = await client.query<{ id: string }>(
    `SELECT id FROM cash_sessions
     WHERE tenant_id = $1 AND status IN ('OPEN', 'OPERATING')
     FOR UPDATE`,
    [tenantId]
  );
  if (session.rowCount === 0) {
    throw new CashSessionNotOpenError();
  }
  await client.query(
    `INSERT INTO cash_movements (tenant_id, cash_session_id, type, amount, payment_id)
     VALUES ($1, $2, 'SUPPLIER_PAYMENT', $3, NULL)`,
    [tenantId, session.rows[0].id, (-cashAmount).toFixed(2)]
  );
  await client.query(
    `UPDATE cash_sessions SET status = 'OPERATING' WHERE id = $1 AND status = 'OPEN'`,
    [session.rows[0].id]
  );
  // Note: cash_movements.payment_id references `payments`, not
  // `supplier_payments` — left NULL here on purpose rather than widening
  // that foreign key; supplier_payment_id is not stored on this row. If
  // per-row traceability back to the specific supplier payment becomes a
  // real need, cash_movements needs its own nullable supplier_payment_id
  // column added via a follow-up migration, not a silent FK repurposing.
  void supplierPaymentId;
}

export async function openCashSession(
  actorUserId: string,
  tenantId: string,
  openingCash: string
): Promise<CashSession> {
  return withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT id FROM cash_sessions WHERE tenant_id = $1 AND status <> 'CLOSED'`,
      [tenantId]
    );
    if (existing.rowCount && existing.rowCount > 0) {
      throw new ValidationError("A cash session is already open for this tenant");
    }

    const inserted = await client.query(
      `INSERT INTO cash_sessions (tenant_id, status, opened_by_user_id, opening_cash)
       VALUES ($1, 'OPEN', $2, $3)
       RETURNING id, tenant_id, status, opened_by_user_id, opening_cash, opened_at,
                 closed_at, counted_cash, expected_cash, difference`,
      [tenantId, actorUserId, openingCash]
    );

    await recordAuditEvent(client, {
      tenantId,
      actorUserId,
      action: "CASH_SESSION_OPENED",
      entityType: "cash_session",
      entityId: inserted.rows[0].id,
      metadata: { openingCash },
    });

    return mapRow(inserted.rows[0]);
  });
}

/**
 * 08_PAYMENTS_CASH.md cuadre formula:
 * expected = opening + sum(cash movements). Difference = counted - expected.
 */
export async function closeCashSession(
  actorUserId: string,
  tenantId: string,
  cashSessionId: string,
  countedCash: string,
  observations?: string
): Promise<CashSession> {
  return withTransaction(async (client) => {
    const session = await client.query(
      `SELECT * FROM cash_sessions WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, cashSessionId]
    );
    if (session.rowCount === 0) throw new ValidationError("Cash session not found");
    if (session.rows[0].status === "CLOSED") {
      throw new ValidationError("Cash session already closed");
    }

    const movements = await client.query<{ total: string }>(
      `SELECT coalesce(sum(amount), 0) AS total FROM cash_movements WHERE cash_session_id = $1`,
      [cashSessionId]
    );
    const openingCash = Number(session.rows[0].opening_cash);
    const movementsTotal = Number(movements.rows[0].total);
    const expectedCash = openingCash + movementsTotal;
    const counted = Number(countedCash);
    const difference = counted - expectedCash;

    const updated = await client.query(
      `UPDATE cash_sessions
       SET status = 'CLOSED', closed_at = now(), counted_cash = $1,
           expected_cash = $2, difference = $3
       WHERE id = $4
       RETURNING id, tenant_id, status, opened_by_user_id, opening_cash, opened_at,
                 closed_at, counted_cash, expected_cash, difference`,
      [countedCash, expectedCash.toFixed(2), difference.toFixed(2), cashSessionId]
    );

    await recordAuditEvent(client, {
      tenantId,
      actorUserId,
      action: "CASH_SESSION_CLOSED",
      entityType: "cash_session",
      entityId: cashSessionId,
      metadata: { expectedCash: expectedCash.toFixed(2), countedCash, difference: difference.toFixed(2), observations },
    });

    return mapRow(updated.rows[0]);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): CashSession {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    status: row.status,
    openedByUserId: row.opened_by_user_id,
    openingCash: row.opening_cash,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    countedCash: row.counted_cash,
    expectedCash: row.expected_cash,
    difference: row.difference,
  };
}
