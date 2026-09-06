-- LOOP 05 — Backend Core
-- Scope: only what POST /service-line/diners needs, per 05_BACKEND.md and
-- 03_DOMAIN_DATA_MODEL.md. Payment/Tender/PaymentAllocation/Change tables
-- belong to LOOP 08 and are deliberately NOT created here.

create extension if not exists "pgcrypto";

create table if not exists restaurants (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_at timestamptz not null default now()
);

-- app_users bridges Supabase Auth identities to tenant + role.
-- 13_SECURITY_ROLES.md: "No confiar en el frontend para permisos" — role
-- lives here, resolved server-side on every request (see middleware/auth.ts).
create table if not exists app_users (
    id uuid primary key default gen_random_uuid(),
    auth_user_id uuid not null unique, -- references auth.users(id) (Supabase)
    tenant_id uuid not null references restaurants(id),
    role text not null check (role in ('servidor', 'cajero', 'supervisor', 'admin')),
    created_at timestamptz not null default now()
);

create table if not exists tables (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    label text not null, -- e.g. "Mesa 7"
    created_at timestamptz not null default now(),
    unique (tenant_id, label)
);

create table if not exists table_sessions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    table_id uuid not null references tables(id),
    status text not null check (status in ('OPEN', 'CLOSING', 'CLOSED')),
    opened_at timestamptz not null default now(),
    closed_at timestamptz
);

-- BR-002/BR-003: at most one OPEN session per table at a time.
create unique index if not exists one_open_session_per_table
    on table_sessions (tenant_id, table_id)
    where status = 'OPEN';

create table if not exists diners (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    table_session_id uuid not null references table_sessions(id),
    name text,
    descriptor text,
    created_by_user_id uuid not null references app_users(id),
    created_at timestamptz not null default now()
);

create table if not exists consumptions (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    diner_id uuid not null references diners(id),
    amount numeric(12, 2) not null check (amount > 0), -- decimal, never float
    created_at timestamptz not null default now()
);

create table if not exists payment_obligations (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    diner_id uuid not null references diners(id),
    consumption_id uuid not null references consumptions(id),
    payment_mode text not null check (payment_mode in ('individual', 'conjunto')),
    amount numeric(12, 2) not null check (amount > 0),
    status text not null check (status in ('PENDING', 'PARTIAL', 'PAID', 'CREDIT', 'SETTLED')),
    created_at timestamptz not null default now()
);

create table if not exists audit_events (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references restaurants(id),
    actor_user_id uuid not null,
    action text not null,
    entity_type text not null,
    entity_id uuid not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create table if not exists idempotency_keys (
    tenant_id uuid not null references restaurants(id),
    idempotency_key text not null,
    request_fingerprint text not null,
    response_body jsonb,
    created_at timestamptz not null default now(),
    primary key (tenant_id, idempotency_key)
);

-- Row Level Security: enabled now, policies deferred.
-- ADR-STACK §6: "La estrategia definitiva de tenancy y RLS deberá quedar
-- documentada antes de producción multi-restaurante." We enable RLS here
-- so no table is accidentally left open, but do not invent final policies
-- yet — the backend uses the service-role key (bypasses RLS) until LOOP 13
-- defines the real policy set.
alter table restaurants enable row level security;
alter table app_users enable row level security;
alter table tables enable row level security;
alter table table_sessions enable row level security;
alter table diners enable row level security;
alter table consumptions enable row level security;
alter table payment_obligations enable row level security;
alter table audit_events enable row level security;
alter table idempotency_keys enable row level security;
