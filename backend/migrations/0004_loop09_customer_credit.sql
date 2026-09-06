-- LOOP 09 — Customer Credit
-- BR-014: credit created only via application-layer POST /credits, never as
-- a tender method on payments (there is still no 'credito' value anywhere
-- in the tenders/credit_repayment_tenders check constraints).
-- BR-018: any cajero may grant credit freely (no authorization step here,
-- unlike payment void). BR-019: credit_limit is mandatory per customer.
-- BR-020: no due_date/mora columns in this version — open balance only.

create table if not exists customers (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    name text not null,
    phone text not null,
    type text not null check (type in ('persona', 'empresa')),
    credit_limit numeric(12, 2) not null check (credit_limit > 0), -- BR-019
    created_at timestamptz not null default now(),
    unique (tenant_id, phone)
);

-- BR-014: the debt of record once cash-register accounting is done with an
-- obligation. One row per obligation credited (an obligation is credited at
-- most once — partial credit + partial cash on the same obligation is
-- possible, but re-crediting the same obligation twice is not; the
-- remaining-balance check in registerCredit enforces this).
create table if not exists customer_credits (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    customer_id uuid not null references customers(id),
    obligation_id uuid not null references payment_obligations(id) unique,
    amount numeric(12, 2) not null check (amount > 0),
    created_by_user_id uuid not null references app_users(id),
    created_at timestamptz not null default now()
);

-- Abono: mirrors payments/tenders/payment_allocations/changes structurally,
-- but targets customer_credits instead of payment_obligations directly,
-- because the debt now lives on the customer's account, not the original
-- table's obligation record.
create table if not exists credit_repayments (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    customer_id uuid not null references customers(id),
    status text not null check (status in ('ACTIVE', 'VOIDED')) default 'ACTIVE',
    applied_amount numeric(12, 2) not null check (applied_amount >= 0),
    created_by_user_id uuid not null references app_users(id),
    created_at timestamptz not null default now()
);

create table if not exists credit_repayment_tenders (
    id uuid primary key default gen_random_uuid(),
    repayment_id uuid not null references credit_repayments(id),
    method text not null check (method in ('efectivo', 'transferencia')), -- BR-014: never 'credito'
    amount numeric(12, 2) not null check (amount > 0)
);

create table if not exists credit_repayment_allocations (
    id uuid primary key default gen_random_uuid(),
    repayment_id uuid not null references credit_repayments(id),
    customer_credit_id uuid not null references customer_credits(id),
    amount numeric(12, 2) not null check (amount > 0)
);

create table if not exists credit_repayment_change (
    id uuid primary key default gen_random_uuid(),
    repayment_id uuid not null unique references credit_repayments(id),
    amount numeric(12, 2) not null check (amount >= 0)
);

alter table customers enable row level security;
alter table customer_credits enable row level security;
alter table credit_repayments enable row level security;
alter table credit_repayment_tenders enable row level security;
alter table credit_repayment_allocations enable row level security;
alter table credit_repayment_change enable row level security;

create policy tenant_isolation_customers on customers
  for select using (tenant_id = current_tenant_id());

create policy tenant_isolation_customer_credits on customer_credits
  for select using (tenant_id = current_tenant_id());

create policy tenant_isolation_credit_repayments on credit_repayments
  for select using (tenant_id = current_tenant_id());
