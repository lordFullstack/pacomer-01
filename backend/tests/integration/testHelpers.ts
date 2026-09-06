import { Pool } from "pg";

/**
 * These integration tests need a real Postgres database with all
 * migrations in /migrations applied (they exercise real transactions,
 * locking, and constraints — the whole point per 14_TESTING.md's
 * concurrency/idempotency cases, which cannot be honestly verified against
 * a mock). They are skipped automatically if DATABASE_URL isn't set.
 *
 * To run them for real:
 *   1. Point DATABASE_URL at a disposable test database.
 *   2. Apply migrations 0001-0006 in order (psql -f migrations/000X_*.sql).
 *   3. npm run test:integration
 */
export const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

export function getTestPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set — integration tests should have been skipped");
  }
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

export interface SeededTenant {
  tenantId: string;
  userId: string;
  tableId: string;
}

export async function seedTenant(pool: Pool): Promise<SeededTenant> {
  const restaurant = await pool.query(`INSERT INTO restaurants (name) VALUES ('Test Restaurant') RETURNING id`);
  const tenantId = restaurant.rows[0].id;

  // auth_user_id is a random uuid standing in for a Supabase Auth identity —
  // these tests call services directly, bypassing the HTTP/auth middleware
  // layer, so no real Supabase session is needed.
  const user = await pool.query(
    `INSERT INTO app_users (auth_user_id, tenant_id, role) VALUES (gen_random_uuid(), $1, 'admin') RETURNING id`,
    [tenantId]
  );
  const userId = user.rows[0].id;

  const table = await pool.query(`INSERT INTO tables (tenant_id, label) VALUES ($1, 'Mesa 1') RETURNING id`, [
    tenantId,
  ]);
  const tableId = table.rows[0].id;

  return { tenantId, userId, tableId };
}

export async function cleanupTenant(pool: Pool, tenantId: string): Promise<void> {
  // Ordered to respect FKs; BR-013 (no physical deletion) governs the
  // application's own writes, not this test-only teardown of fixture data.
  await pool.query(
    `DELETE FROM audit_events WHERE tenant_id = $1;
     DELETE FROM idempotency_keys WHERE tenant_id = $1;
     DELETE FROM changes WHERE payment_id IN (SELECT id FROM payments WHERE tenant_id = $1);
     DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE tenant_id = $1);
     DELETE FROM tenders WHERE payment_id IN (SELECT id FROM payments WHERE tenant_id = $1);
     DELETE FROM payments WHERE tenant_id = $1;
     DELETE FROM payment_obligations WHERE tenant_id = $1;
     DELETE FROM consumptions WHERE tenant_id = $1;
     DELETE FROM diners WHERE tenant_id = $1;
     DELETE FROM table_sessions WHERE tenant_id = $1;
     DELETE FROM tables WHERE tenant_id = $1;
     DELETE FROM app_users WHERE tenant_id = $1;
     DELETE FROM restaurants WHERE id = $1;`,
    [tenantId]
  );
}
