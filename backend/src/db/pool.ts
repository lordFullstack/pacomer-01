import { Pool, PoolClient } from "pg";
import { env } from "../config/env";

/**
 * Direct Postgres pool.
 *
 * Why not go through supabase-js for writes: supabase-js issues one HTTP
 * request per call and does not expose BEGIN/COMMIT/ROLLBACK across several
 * statements. LOOP 05 (05_BACKEND.md) and ADR-STACK §12 require the
 * diner-registration write (and every future financial write in LOOP 08) to
 * be a single atomic transaction. We use `pg` directly for that, and reserve
 * supabase-js for Auth verification and Realtime publish.
 *
 * SSL: Supabase's Postgres REQUIRES SSL for any connection from outside its
 * own network — without this, every pool.connect()/query() fails (this bit
 * us in production: it manifested as 500s on every endpoint that touches
 * Postgres, first noticed on /reports/*). Local/test databases (e.g. a
 * Postgres running in Docker for TEST_DATABASE_URL) typically don't support
 * SSL at all, so we only require it for non-localhost hosts.
 */
const isLocalDb = /localhost|127\.0\.0\.1/.test(env.databaseUrl);

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  ssl: isLocalDb ? undefined : { rejectUnauthorized: false },
});

/**
 * Runs `fn` inside a single Postgres transaction. Commits on success,
 * rolls back on any thrown error, always releases the client.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
