import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Service-role client, used server-side only.
 *
 * ADR-STACK §4/§18: Supabase provides identity, RLS and Realtime, but the
 * Application/Domain layer remains the authority for financial rules. This
 * client is therefore used for:
 *   - verifying the caller's JWT (Auth)
 *   - publishing realtime events after a successful Postgres transaction
 * It is NOT used to run the critical write path itself — that goes through
 * db/pool.ts with a real BEGIN/COMMIT (see services/dinerService.ts).
 */
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});
