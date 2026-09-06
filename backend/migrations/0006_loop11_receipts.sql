-- LOOP 11 — Comprobantes (operational receipt only)
-- BR-024: no tax obligation currently -> no fiscal integration. This table
-- is deliberately NOT a fiscal invoice: no tax fields, no fiscal document
-- type, no official consecutivo. receipt_counters.next_number is purely an
-- internal, per-tenant operational sequence for the printed/shown receipt.

create table if not exists receipt_counters (
    tenant_id uuid primary key references restaurants(id),
    next_number bigint not null default 1
);

create table if not exists receipts (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    sequential_number bigint not null,
    obligation_ids uuid[] not null,
    amount numeric(12, 2) not null check (amount > 0),
    customer_name text,
    customer_id_number text, -- "NIC o cédula" (01_DISCOVERY.md), optional, non-fiscal
    issued_by_user_id uuid not null references app_users(id),
    issued_at timestamptz not null default now(),
    unique (tenant_id, sequential_number)
);

alter table receipts enable row level security;
alter table receipt_counters enable row level security;

create policy tenant_isolation_receipts on receipts
  for select using (tenant_id = current_tenant_id());
