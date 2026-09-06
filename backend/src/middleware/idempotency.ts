import { PoolClient } from "pg";

/**
 * 05_BACKEND.md requires an idempotency key on the diner-registration
 * endpoint (protects against double-tap / retry-on-lost-connection per
 * 04_UX_SERVER.md and 14_TESTING.md "doble toque en registrar").
 *
 * Strategy: unique constraint on (tenant_id, idempotency_key) in
 * idempotency_keys, holding the stored response body. Must run INSIDE the
 * same transaction as the write it protects, so a concurrent duplicate
 * request either sees the committed row or blocks on the row lock — never a
 * race where both requests believe they were first.
 */
export async function claimIdempotencyKey(
  client: PoolClient,
  tenantId: string,
  key: string,
  requestFingerprint: string
): Promise<{ isDuplicate: true; storedResponse: unknown } | { isDuplicate: false }> {
  const existing = await client.query(
    `SELECT response_body, request_fingerprint
     FROM idempotency_keys
     WHERE tenant_id = $1 AND idempotency_key = $2
     FOR UPDATE`,
    [tenantId, key]
  );

  if (existing.rowCount && existing.rowCount > 0) {
    const row = existing.rows[0];
    if (row.request_fingerprint !== requestFingerprint) {
      throw new Error(
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"
      );
    }
    return { isDuplicate: true, storedResponse: row.response_body };
  }

  // Reserve the key now (response_body filled in after the write succeeds,
  // in the same transaction) so a concurrent duplicate blocks on FOR UPDATE
  // above instead of slipping through.
  await client.query(
    `INSERT INTO idempotency_keys (tenant_id, idempotency_key, request_fingerprint, response_body)
     VALUES ($1, $2, $3, NULL)`,
    [tenantId, key, requestFingerprint]
  );

  return { isDuplicate: false };
}

export async function storeIdempotentResponse(
  client: PoolClient,
  tenantId: string,
  key: string,
  responseBody: unknown
): Promise<void> {
  await client.query(
    `UPDATE idempotency_keys
     SET response_body = $3
     WHERE tenant_id = $1 AND idempotency_key = $2`,
    [tenantId, key, JSON.stringify(responseBody)]
  );
}
