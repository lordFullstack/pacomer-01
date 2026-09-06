import { supabase } from "../config/supabaseClient";

/**
 * ADR-STACK §7-9: Supabase Realtime is the sync mechanism, NOT the source
 * of truth. This function must only be called AFTER the Postgres
 * transaction has committed (see services/dinerService.ts call order).
 * A failure here must never roll back or block the already-committed
 * financial/domain write — it only means the cashier UI must fall back to
 * polling/resync, per ADR-STACK §9.
 */
export async function publishServiceLineEvent(
  tenantId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const channel = supabase.channel(`tenant:${tenantId}:service-line`);
  try {
    await channel.send({
      type: "broadcast",
      event: "DINER_REGISTERED",
      payload,
    });
  } catch (err) {
    // Deliberately swallowed per ADR-STACK §9: realtime delivery failure
    // must not affect the already-committed financial state. Log for
    // observability (LOOP 18) instead of throwing.
    // eslint-disable-next-line no-console
    console.error("[realtime] failed to publish DINER_REGISTERED", err);
  } finally {
    await supabase.removeChannel(channel);
  }
}
