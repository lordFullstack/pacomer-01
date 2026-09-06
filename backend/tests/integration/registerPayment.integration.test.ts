import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { hasTestDatabase, getTestPool, seedTenant, SeededTenant } from "./testHelpers";

async function seedObligation(pool: Pool, tenant: SeededTenant, amount: string) {
  const session = await pool.query(
    `INSERT INTO table_sessions (tenant_id, table_id, status) VALUES ($1, $2, 'OPEN') RETURNING id`,
    [tenant.tenantId, tenant.tableId]
  );
  const diner = await pool.query(
    `INSERT INTO diners (tenant_id, table_session_id, created_by_user_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.tenantId, session.rows[0].id, tenant.userId]
  );
  const consumption = await pool.query(
    `INSERT INTO consumptions (tenant_id, diner_id, amount) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.tenantId, diner.rows[0].id, amount]
  );
  const obligation = await pool.query(
    `INSERT INTO payment_obligations (tenant_id, diner_id, consumption_id, payment_mode, amount, status)
     VALUES ($1, $2, $3, 'individual', $4, 'PENDING') RETURNING id`,
    [tenant.tenantId, diner.rows[0].id, consumption.rows[0].id, amount]
  );
  return obligation.rows[0].id as string;
}

describe.skipIf(!hasTestDatabase)("registerPayment — 14_TESTING.md 'pago duplicado' / concurrency", () => {
  let pool: Pool;
  let tenant: SeededTenant;

  beforeAll(() => {
    pool = getTestPool();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    tenant = await seedTenant(pool);
    await pool.query(
      `INSERT INTO cash_sessions (tenant_id, status, opened_by_user_id, opening_cash) VALUES ($1, 'OPEN', $2, 0)`,
      [tenant.tenantId, tenant.userId]
    );
  });

  it("two concurrent full-amount payment attempts on the same obligation: exactly one succeeds", async () => {
    const { registerPayment } = await import("../../src/services/paymentService");
    const obligationId = await seedObligation(pool, tenant, "50000.00");

    const attempt = () =>
      registerPayment(tenant.userId, tenant.tenantId, {
        obligationIds: [obligationId],
        tenders: [{ method: "efectivo", amount: "50000.00" }],
        idempotencyKey: `attempt-${Math.random()}`, // different keys: this is a genuine race, not a retry
      });

    const results = await Promise.allSettled([attempt(), attempt()]);

    // FOR UPDATE locking in lockObligationsWithRemainingBalance means the
    // second transaction sees the obligation already fully allocated and
    // must reject it as ObligationAlreadySettledError — never double-pay.
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const totalApplied = await pool.query<{ total: string }>(
      `SELECT coalesce(sum(pa.amount), 0) AS total
       FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
       WHERE pa.obligation_id = $1 AND p.status = 'ACTIVE'`,
      [obligationId]
    );
    // Exactly one $50,000 payment applied — never $100,000.
    expect(Number(totalApplied.rows[0].total)).toBe(50000);
  });

  it("mixed tender (efectivo + transferencia) applies correctly and change is zero when exact", async () => {
    const { registerPayment } = await import("../../src/services/paymentService");
    const obligationId = await seedObligation(pool, tenant, "37000.00");

    const output = await registerPayment(tenant.userId, tenant.tenantId, {
      obligationIds: [obligationId],
      tenders: [
        { method: "efectivo", amount: "20000.00" },
        { method: "transferencia", amount: "17000.00" },
      ],
      idempotencyKey: "mixed-tender-key",
    });

    expect(output.appliedAmount).toBe("37000.00");
    expect(output.changeAmount).toBe("0.00");
  });

  it("rejects change that would exceed the cash tendered (can't make change from a transfer)", async () => {
    const { registerPayment } = await import("../../src/services/paymentService");
    const obligationId = await seedObligation(pool, tenant, "10000.00");

    // Bill is $10,000, tendered entirely by transfer at $15,000. The
    // $5,000 excess would need to come back as change, but there is no
    // cash in this payment to source it from — must be rejected.
    await expect(
      registerPayment(tenant.userId, tenant.tenantId, {
        obligationIds: [obligationId],
        tenders: [{ method: "transferencia", amount: "15000.00" }],
        idempotencyKey: "invalid-change-key",
      })
    ).rejects.toThrow("CHANGE_EXCEEDS_CASH_TENDER");
  });
});
