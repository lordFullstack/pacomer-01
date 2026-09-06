-- LOOP 13 — Security / Roles / Authorization / Anulation
--
-- Context: the backend currently connects with the Postgres service-role
-- (bypasses RLS) for all writes — see config/supabaseClient.ts and
-- db/pool.ts comments. RLS policies below exist so that:
--   (a) any future direct-from-frontend Supabase read (e.g. a realtime
--       subscription) is safe by default, and
--   (b) the isolation strategy is documented and testable NOW, per
--       ADR-STACK §6 ("La estrategia definitiva de tenancy y RLS deberá
--       quedar documentada antes de producción multi-restaurante").
--
-- Strategy: every tenant-scoped table is readable/writable only when
-- app_users.auth_user_id = auth.uid() AND that user's tenant_id matches
-- the row's tenant_id. This assumes Supabase Auth (auth.uid()) — consistent
-- with ADR-STACK §5.

create or replace function current_tenant_id() returns uuid as $$
  select tenant_id from app_users where auth_user_id = auth.uid()
$$ language sql stable security definer;

-- restaurants: a user may only see their own restaurant row.
create policy tenant_isolation_restaurants on restaurants
  for select using (id = current_tenant_id());

create policy tenant_isolation_app_users on app_users
  for select using (tenant_id = current_tenant_id());

create policy tenant_isolation_tables on tables
  for select using (tenant_id = current_tenant_id());

create policy tenant_isolation_table_sessions on table_sessions
  for select using (tenant_id = current_tenant_id());

create policy tenant_isolation_diners on diners
  for select using (tenant_id = current_tenant_id());

create policy tenant_isolation_consumptions on consumptions
  for select using (tenant_id = current_tenant_id());

create policy tenant_isolation_payment_obligations on payment_obligations
  for select using (tenant_id = current_tenant_id());

create policy tenant_isolation_audit_events on audit_events
  for select using (tenant_id = current_tenant_id());

create policy tenant_isolation_payments on payments
  for select using (tenant_id = current_tenant_id());

create policy tenant_isolation_cash_sessions on cash_sessions
  for select using (tenant_id = current_tenant_id());

create policy tenant_isolation_cash_movements on cash_movements
  for select using (tenant_id = current_tenant_id());

create policy tenant_isolation_payment_void_requests on payment_void_requests
  for select using (tenant_id = current_tenant_id());

-- No INSERT/UPDATE/DELETE policies are defined: all writes go through the
-- backend's service-role connection (db/pool.ts), which bypasses RLS by
-- design (ADR-STACK §4/§18 — the frontend/RLS layer is not the authority
-- for financial rules). These SELECT policies only protect the scenario
-- where a client reads directly via supabase-js/Realtime with a user JWT.

-- BR-017: role permission notes (enforced in application code today via
-- requireRole; not yet mirrored as RLS policies since all writes are
-- backend-mediated):
--   servidor   -> can register diners only.
--   cajero     -> can register payments, open/close cash sessions (their
--                 normal daily duty per 01_DISCOVERY.md), and request voids
--                 (including their own self-void within the BR-016 window).
--   supervisor -> everything cajero can do, PLUS authorize/deny void
--                 requests from other cashiers (BR-017).
--   admin      -> everything supervisor can do, PLUS any future
--                 owner-only operation.
