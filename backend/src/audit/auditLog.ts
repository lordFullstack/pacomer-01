import { PoolClient } from "pg";

/**
 * 03_DOMAIN_DATA_MODEL.md: AuditEvent. 05_BACKEND.md: "Audit event" is part
 * of the transactional write, not a best-effort side-log — if the audit
 * insert fails, the whole transaction rolls back (see services/dinerService.ts).
 */
export interface AuditEventInput {
  tenantId: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}

export async function recordAuditEvent(
  client: PoolClient,
  input: AuditEventInput
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO audit_events (tenant_id, actor_user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.tenantId,
      input.actorUserId,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  return result.rows[0].id;
}
