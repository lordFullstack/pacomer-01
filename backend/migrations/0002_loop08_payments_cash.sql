-- LOOP 08 — Payments / Cash / Financial API
-- BR-011/BR-012: Payment (applied), Tender (received) and Change (returned)
-- are separate first-class entities — never collapse them into one column.
-- BR-013: no physical deletion — void is a status transition, always audited.
-- BR-014: no "credito" tender method exists in this schema on purpose.

create table if not exists payments (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    status text not null check (status in ('ACTIVE', 'VOIDED')) default 'ACTIVE',
    amount numeric(12, 2) not null check (amount >= 0), -- BR-011: applied funds only
    created_by_user_id uuid not null references app_users(id),
    created_at timestamptz not null default now(),
    voided_at timestamptz,
    voided_by_user_id uuid references app_users(id)
);

create table if not exists tenders (
    id uuid primary key default gen_random_uuid(),
    payment_id uuid not null references payments(id),
    method text not null check (method in ('efectivo', 'transferencia')), -- BR-014: no 'credito' here
    amount numeric(12, 2) not null check (amount > 0),
    created_at timestamptz not null default now()
);

create table if not exists payment_allocations (
    id uuid primary key default gen_random_uuid(),
    payment_id uuid not null references payments(id),
    obligation_id uuid not null references payment_obligations(id),
    amount numeric(12, 2) not null check (amount > 0),
    created_at timestamptz not null default now()
);

-- BR-012: Change is its own entity, never inferred as an unassigned allocation.
create table if not exists changes (
    id uuid primary key default gen_random_uuid(),
    payment_id uuid not null unique references payments(id),
    amount numeric(12, 2) not null check (amount >= 0),
    created_at timestamptz not null default now()
);

create table if not exists cash_sessions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    status text not null check (status in ('OPEN', 'OPERATING', 'COUNTING', 'CLOSED')),
    opened_by_user_id uuid not null references app_users(id),
    opening_cash numeric(12, 2) not null default 0,
    opened_at timestamptz not null default now(),
    closed_at timestamptz,
    counted_cash numeric(12, 2),
    expected_cash numeric(12, 2),
    difference numeric(12, 2)
);

-- BR per 08_PAYMENTS_CASH.md: at most one non-CLOSED session per tenant.
create unique index if not exists one_active_cash_session_per_tenant
    on cash_sessions (tenant_id)
    where status <> 'CLOSED';

create table if not exists cash_movements (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    cash_session_id uuid not null references cash_sessions(id),
    type text not null check (type in ('SALE', 'ADJUSTMENT', 'REVERSAL')),
    amount numeric(12, 2) not null, -- signed: inflow positive, outflow negative
    payment_id uuid references payments(id),
    created_at timestamptz not null default now()
);

-- BR-015: two-step void — request, then explicit OWNER_ADMIN authorization.
create table if not exists payment_void_requests (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    payment_id uuid not null references payments(id),
    status text not null check (status in ('PENDING_AUTHORIZATION', 'AUTHORIZED', 'DENIED', 'EXECUTED', 'SELF_EXECUTED')),
    reason text not null,
    requested_by_user_id uuid not null references app_users(id),
    authorized_by_user_id uuid references app_users(id),
    requested_at timestamptz not null default now(),
    resolved_at timestamptz
);

alter table payments enable row level security;
alter table tenders enable row level security;
alter table payment_allocations enable row level security;
alter table changes enable row level security;
alter table cash_sessions enable row level security;
alter table cash_movements enable row level security;
alter table payment_void_requests enable row level security;
