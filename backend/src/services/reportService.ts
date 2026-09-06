import { pool } from "../db/pool";
import {
  DailySalesReport,
  PendingCollectionsReport,
  CustomerCreditsReport,
  CashStatusReport,
  PayablesReport,
} from "../domain/entities";

/**
 * 12_REPORTS.md rule: reports must never affect the critical registration/
 * payment path. All queries here run as plain reads against the pool —
 * never inside withTransaction, never taking row locks.
 */

export async function getDailySalesReport(tenantId: string, date?: string): Promise<DailySalesReport> {
  const dateFilter = date ?? new Date().toISOString().slice(0, 10);

  const totals = await pool.query<{ total: string; count: string }>(
    `SELECT coalesce(sum(amount), 0) AS total, count(*) AS count
     FROM payments
     WHERE tenant_id = $1 AND status = 'ACTIVE' AND created_at::date = $2::date`,
    [tenantId, dateFilter]
  );

  const byServer = await pool.query<{ server_user_id: string; total: string }>(
    `SELECT d.created_by_user_id AS server_user_id, sum(pa.amount) AS total
     FROM payment_allocations pa
     JOIN payments p ON p.id = pa.payment_id
     JOIN payment_obligations po ON po.id = pa.obligation_id
     JOIN diners d ON d.id = po.diner_id
     WHERE p.tenant_id = $1 AND p.status = 'ACTIVE' AND p.created_at::date = $2::date
     GROUP BY d.created_by_user_id`,
    [tenantId, dateFilter]
  );

  const byMethod = await pool.query<{ method: string; total: string }>(
    `SELECT t.method, sum(t.amount) AS total
     FROM tenders t
     JOIN payments p ON p.id = t.payment_id
     WHERE p.tenant_id = $1 AND p.status = 'ACTIVE' AND p.created_at::date = $2::date
     GROUP BY t.method`,
    [tenantId, dateFilter]
  );

  return {
    date: dateFilter,
    totalApplied: totals.rows[0].total,
    paymentCount: Number(totals.rows[0].count),
    byServer: byServer.rows.map((r) => ({ serverUserId: r.server_user_id, totalApplied: r.total })),
    byMethod: byMethod.rows.map((r) => ({ method: r.method as "efectivo" | "transferencia", totalTendered: r.total })),
  };
}

export async function getPendingCollectionsReport(tenantId: string): Promise<PendingCollectionsReport> {
  const result = await pool.query<{
    id: string;
    table_id: string;
    table_label: string;
    diner_name: string | null;
    diner_descriptor: string | null;
    amount: string;
    status: string;
    remaining_cents: string;
  }>(
    `SELECT
        po.id, ts.table_id, t.label AS table_label,
        d.name AS diner_name, d.descriptor AS diner_descriptor,
        po.amount, po.status,
        (po.amount * 100)::bigint
          - coalesce((
              SELECT sum(pa.amount * 100)::bigint FROM payment_allocations pa
              JOIN payments p ON p.id = pa.payment_id
              WHERE pa.obligation_id = po.id AND p.status = 'ACTIVE'
            ), 0)
          - coalesce((SELECT sum(cc.amount * 100)::bigint FROM customer_credits cc WHERE cc.obligation_id = po.id), 0)
          AS remaining_cents
     FROM payment_obligations po
     JOIN diners d ON d.id = po.diner_id
     JOIN table_sessions ts ON ts.id = d.table_session_id
     JOIN tables t ON t.id = ts.table_id
     WHERE po.tenant_id = $1 AND po.status IN ('PENDING', 'PARTIAL')
     ORDER BY po.created_at ASC`,
    [tenantId]
  );

  const obligations = result.rows
    .map((r) => ({
      obligationId: r.id,
      tableId: r.table_id,
      tableLabel: r.table_label,
      dinerName: r.diner_name,
      dinerDescriptor: r.diner_descriptor,
      amount: r.amount,
      remaining: (Number(r.remaining_cents) / 100).toFixed(2),
      status: r.status as "PENDING" | "PARTIAL",
    }))
    .filter((o) => Number(o.remaining) > 0);

  const totalRemaining = obligations.reduce((s, o) => s + Number(o.remaining), 0).toFixed(2);
  return { obligations, totalRemaining };
}

export async function getCustomerCreditsReport(tenantId: string): Promise<CustomerCreditsReport> {
  const result = await pool.query<{ id: string; name: string; balance: string }>(
    `SELECT
        c.id, c.name,
        coalesce((SELECT sum(cc.amount * 100)::bigint FROM customer_credits cc WHERE cc.customer_id = c.id), 0)
          - coalesce((
              SELECT sum(cra.amount * 100)::bigint
              FROM credit_repayment_allocations cra
              JOIN credit_repayments cr ON cr.id = cra.repayment_id
              JOIN customer_credits cc2 ON cc2.id = cra.customer_credit_id
              WHERE cc2.customer_id = c.id AND cr.status = 'ACTIVE'
            ), 0) AS balance_cents
     FROM customers c
     WHERE c.tenant_id = $1`,
    [tenantId]
  );

  const customers = result.rows
    .map((r) => ({ customerId: r.id, name: r.name, outstandingBalance: (Number(r.balance ?? 0) / 100).toFixed(2) }))
    .filter((c) => Number(c.outstandingBalance) > 0);

  const totalOutstanding = customers.reduce((s, c) => s + Number(c.outstandingBalance), 0).toFixed(2);
  return { customers, totalOutstanding };
}

export async function getCashStatusReport(tenantId: string): Promise<CashStatusReport> {
  const session = await pool.query<{ id: string; status: string; opening_cash: string }>(
    `SELECT id, status, opening_cash FROM cash_sessions WHERE tenant_id = $1 AND status <> 'CLOSED'`,
    [tenantId]
  );
  if (session.rowCount === 0) {
    return { sessionId: null, status: "NO_SESSION", openingCash: null, expectedCash: null };
  }
  const movements = await pool.query<{ total: string }>(
    `SELECT coalesce(sum(amount), 0) AS total FROM cash_movements WHERE cash_session_id = $1`,
    [session.rows[0].id]
  );
  const expected = Number(session.rows[0].opening_cash) + Number(movements.rows[0].total);
  return {
    sessionId: session.rows[0].id,
    status: session.rows[0].status as "OPEN" | "OPERATING" | "COUNTING",
    openingCash: session.rows[0].opening_cash,
    expectedCash: expected.toFixed(2),
  };
}

export async function getPayablesReport(tenantId: string): Promise<PayablesReport> {
  const result = await pool.query<{ id: string; name: string; balance: string }>(
    `SELECT
        s.id, s.name,
        coalesce((SELECT sum(amount * 100)::bigint FROM purchases WHERE supplier_id = s.id), 0)
          - coalesce((
              SELECT sum(spa.amount * 100)::bigint
              FROM supplier_payment_allocations spa
              JOIN supplier_payments sp ON sp.id = spa.payment_id
              JOIN purchases pu ON pu.id = spa.purchase_id
              WHERE pu.supplier_id = s.id AND sp.status = 'ACTIVE'
            ), 0) AS balance_cents
     FROM suppliers s
     WHERE s.tenant_id = $1`,
    [tenantId]
  );

  const suppliers = result.rows
    .map((r) => ({ supplierId: r.id, name: r.name, outstandingBalance: (Number(r.balance ?? 0) / 100).toFixed(2) }))
    .filter((s) => Number(s.outstandingBalance) > 0);

  const totalPayable = suppliers.reduce((s, x) => s + Number(x.outstandingBalance), 0).toFixed(2);
  return { suppliers, totalPayable };
}
