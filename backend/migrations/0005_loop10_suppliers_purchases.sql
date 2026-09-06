-- LOOP 10 — Suppliers / Purchases
-- BR-021: cuenta acumulada — no per-purchase due obligation table; each
-- purchase simply adds to the supplier's running balance. We still track
-- individual purchases (for "Historial", a stated requirement) and allocate
-- payments FIFO across them for traceability, but the balance the cajero
-- sees and reasons about is always the single accumulated number.
-- BR-022: no due_date/mora columns (same posture as customer credit, BR-020).
-- BR-023: no tax, goods-receipt, or attachment columns in this version.

create table if not exists suppliers (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    name text not null,
    payment_terms text not null check (payment_terms in ('contado', 'semanal', 'quincenal')),
    created_at timestamptz not null default now(),
    unique (tenant_id, name)
);

create table if not exists purchases (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    supplier_id uuid not null references suppliers(id),
    amount numeric(12, 2) not null check (amount > 0),
    created_by_user_id uuid not null references app_users(id),
    created_at timestamptz not null default now()
);

create table if not exists supplier_payments (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    supplier_id uuid not null references suppliers(id),
    status text not null check (status in ('ACTIVE', 'VOIDED')) default 'ACTIVE',
    applied_amount numeric(12, 2) not null check (applied_amount > 0),
    created_by_user_id uuid not null references app_users(id),
    created_at timestamptz not null default now()
);

create table if not exists supplier_payment_tenders (
    id uuid primary key default gen_random_uuid(),
    payment_id uuid not null references supplier_payments(id),
    method text not null check (method in ('efectivo', 'transferencia')),
    amount numeric(12, 2) not null check (amount > 0)
);

-- FIFO allocation across purchases, same pattern as credit_repayment_allocations.
create table if not exists supplier_payment_allocations (
    id uuid primary key default gen_random_uuid(),
    payment_id uuid not null references supplier_payments(id),
    purchase_id uuid not null references purchases(id),
    amount numeric(12, 2) not null check (amount > 0)
);

-- Paying a supplier in cash is an outflow from the drawer, distinct from a
-- SALE inflow — extend the existing check constraint rather than widen it
-- silently.
alter table cash_movements drop constraint if exists cash_movements_type_check;
alter table cash_movements add constraint cash_movements_type_check
    check (type in ('SALE', 'ADJUSTMENT', 'REVERSAL', 'SUPPLIER_PAYMENT'));

alter table suppliers enable row level security;
alter table purchases enable row level security;
alter table supplier_payments enable row level security;
alter table supplier_payment_tenders enable row level security;
alter table supplier_payment_allocations enable row level security;

create policy tenant_isolation_suppliers on suppliers
  for select using (tenant_id = current_tenant_id());

create policy tenant_isolation_purchases on purchases
  for select using (tenant_id = current_tenant_id());

create policy tenant_isolation_supplier_payments on supplier_payments
  for select using (tenant_id = current_tenant_id());
