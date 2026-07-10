-- Order Desk — Supabase schema.
-- Whole domain objects are stored as JSONB (matching lib/types.ts exactly) —
-- no ORM, no column-per-field mapping to maintain. A few columns are pulled
-- out alongside the JSONB purely so Postgres can index/sort/filter on them
-- without parsing JSON on every query.
--
-- Run once: Supabase dashboard → SQL Editor → New query → paste this whole
-- file → Run. Safe to re-run — every statement is idempotent (IF NOT EXISTS).

create table if not exists orders (
  id text primary key,
  status text not null,
  created_at timestamptz not null,
  -- Atomic claim for money-facing routes (create draft, confirm payment) —
  -- an UPDATE ... WHERE locked_at IS NULL is a single atomic operation in
  -- Postgres, so this holds even across multiple serverless instances
  -- (the in-memory Set this replaces only ever worked within one process).
  locked_at timestamptz,
  data jsonb not null
);
create index if not exists orders_status_idx on orders (status);
create index if not exists orders_created_at_idx on orders (created_at desc);

create table if not exists runtime_customers (
  shopify_id text primary key,
  data jsonb not null
);

create table if not exists order_history (
  order_id text primary key,
  paid_at timestamptz not null,
  data jsonb not null
);
create index if not exists order_history_paid_at_idx on order_history (paid_at desc);

-- Single-row settings table — currently just the global test-mode switch
-- (nav toggle: fakes Shopify draft/mark-paid + skips the Sheet mirror for
-- any order created while it's on; see lib/store.ts getTestMode/setTestMode).
create table if not exists app_settings (
  id smallint primary key default 1,
  test_mode boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);
insert into app_settings (id, test_mode) values (1, false)
  on conflict (id) do nothing;

-- Sample-credit usage: a row per draft created with a "Sample credit"
-- discount, so the auto-suggest ("this cafe has ₱X of paid samples not yet
-- credited") never offers the same credit twice. amount is PHP.
create table if not exists sample_credits (
  order_id text primary key,
  customer_id text not null,
  amount numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists sample_credits_customer_idx on sample_credits (customer_id);

-- RLS on, with NO policies: only the service-role/secret key (which the app
-- uses server-side) can touch these tables. Without this, anyone holding the
-- public "publishable" key could read orders through Supabase's REST API.
alter table orders enable row level security;
alter table runtime_customers enable row level security;
alter table order_history enable row level security;
alter table app_settings enable row level security;
alter table sample_credits enable row level security;
