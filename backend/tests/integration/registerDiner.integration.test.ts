import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import { hasTestDatabase, getTestPool, seedTenant, cleanupTenant, SeededTenant } from "./testHelpers";

describe.skipIf(!hasTestDatabase)("registerDiner — 14_TESTING.md critical cases", () => {
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
  });

  it("doble toque en registrar: same idempotency key registers exactly one diner", async () => {
    const { registerDiner } = await import("../../src/services/dinerService");

    const input = {
      tableId: tenant.tableId,
      amount: "12000.00",
      paymentMode: "individual" as const,
      idempotencyKey: "double-tap-test-key",
    };

    const [first, second] = await Promise.all([
      registerDiner(tenant.userId, tenant.tenantId, input),
      registerDiner(tenant.userId, tenant.tenantId, input),
    ]);

    // Both calls must resolve to the SAME diner/obligation — not two rows.
    expect(first.dinerId).toBe(second.dinerId);
    expect(first.obligationId).toBe(second.obligationId);

    const dinerCount = await pool.query(`SELECT count(*) FROM diners WHERE table_session_id = $1`, [
      first.tableSessionId,
    ]);
    expect(Number(dinerCount.rows[0].count)).toBe(1);
  });

  it("dos servidores agregan simultáneamente a la misma mesa: both succeed, one table session, two diners", async () => {
    const { registerDiner } = await import("../../src/services/dinerService");

    const [a, b] = await Promise.all([
      registerDiner(tenant.userId, tenant.tenantId, {
        tableId: tenant.tableId,
        amount: "10000.00",
        paymentMode: "individual",
        idempotencyKey: "server-a-key",
      }),
      registerDiner(tenant.userId, tenant.tenantId, {
        tableId: tenant.tableId,
        amount: "15000.00",
        paymentMode: "individual",
        idempotencyKey: "server-b-key",
      }),
    ]);

    // BR-002/BR-001: one open session per table, both diners land in it.
    expect(a.tableSessionId).toBe(b.tableSessionId);
    expect(a.dinerId).not.toBe(b.dinerId);

    const sessionCount = await pool.query(
      `SELECT count(*) FROM table_sessions WHERE table_id = $1 AND status = 'OPEN'`,
      [tenant.tableId]
    );
    expect(Number(sessionCount.rows[0].count)).toBe(1);
  });

  it("same idempotency key with a DIFFERENT payload is rejected, not silently replayed", async () => {
    const { registerDiner } = await import("../../src/services/dinerService");

    await registerDiner(tenant.userId, tenant.tenantId, {
      tableId: tenant.tableId,
      amount: "10000.00",
      paymentMode: "individual",
      idempotencyKey: "reused-key",
    });

    await expect(
      registerDiner(tenant.userId, tenant.tenantId, {
        tableId: tenant.tableId,
        amount: "99999.00", // different amount, same key -> must not be treated as a retry
        paymentMode: "individual",
        idempotencyKey: "reused-key",
      })
    ).rejects.toThrow("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD");
  });
});
