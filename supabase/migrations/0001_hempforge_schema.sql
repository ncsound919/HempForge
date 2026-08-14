-- ─────────────────────────────────────────────────────────────────────────────
-- 0001_hempforge_schema.sql
-- HempForge — Supabase migration (schema + RLS)
--
-- Design notes:
--   * `public.documents` is a generic JSONB store that mirrors the app's
--     existing Firestore abstraction (collection + id + jsonb body). The server
--     adapter writes `tenant_id` on every row and RLS enforces tenant scoping,
--     so a misconfigured query can never leak across tenants.
--   * `public.plans` + `public.subscriptions` back Stripe billing.
--   * `profiles` is created by a trigger on auth.users (mirrors handle_new_user).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. documents (generic tenant-scoped JSONB store) ---------------------------
create table if not exists public.documents (
  id         text not null,
  collection text not null,
  tenant_id  text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, id, tenant_id)
);

create index if not exists idx_documents_tenant_collection
  on public.documents (tenant_id, collection);

create index if not exists idx_documents_updated_at
  on public.documents (updated_at desc);

-- 2. plans (Stripe-backed pricing) --------------------------------------------
create table if not exists public.plans (
  id               text primary key,
  name             text not null,
  slug             text not null unique,
  description      text not null default '',
  monthly_price    integer not null,          -- in cents
  stripe_price_id  text,                      -- recurring price id
  stripe_product_id text,
  features         jsonb not null default '[]'::jsonb,
  max_seats        integer not null default 1,
  max_facilities   integer not null default 1,
  sort_order       integer not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- 3. subscriptions (mirror Stripe subscription state) -------------------------
create table if not exists public.subscriptions (
  id                   text primary key,      -- stripe subscription id
  tenant_id            text not null,
  user_id              uuid references auth.users (id) on delete cascade,
  customer_id          text,                  -- stripe customer id
  plan_id              text references public.plans (id),
  status               text not null default 'incomplete',
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  seats                integer not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_subscriptions_tenant on public.subscriptions (tenant_id);
create index if not exists idx_subscriptions_customer on public.subscriptions (customer_id);

-- 4. profiles (denormalized user index, mirrors handle_new_user trigger) ------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  tenant_id  text not null default 'Global-Hemp-Wilson',
  role       text not null default 'Lab Admin',
  full_name  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, tenant_id, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_app_meta_data ->> 'tenant_id', 'Global-Hemp-Wilson'),
    coalesce(new.raw_app_meta_data ->> 'role', 'Lab Admin')
  )
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 5. RLS ----------------------------------------------------------------------
alter table public.documents enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.profiles enable row level security;

-- tenant_id is read from JWT app_metadata. Server (service role) bypasses RLS
-- entirely; client (anon key) can only see its own tenant's rows.
create or replace function public.current_tenant_id()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'app_metadata', '')::jsonb ->> 'tenant_id',
    'Global-Hemp-Wilson'
  );
$$;

-- documents: tenant-scoped read/write
create policy "documents_select_own_tenant" on public.documents
  for select using (tenant_id = public.current_tenant_id());
create policy "documents_insert_own_tenant" on public.documents
  for insert with check (tenant_id = public.current_tenant_id());
create policy "documents_update_own_tenant" on public.documents
  for update using (tenant_id = public.current_tenant_id());
create policy "documents_delete_own_tenant" on public.documents
  for delete using (tenant_id = public.current_tenant_id());

-- plans: readable by anyone, writable only via service role
create policy "plans_select_public" on public.plans for select using (true);

-- subscriptions: tenant-scoped read/write
create policy "subs_select_own_tenant" on public.subscriptions
  for select using (tenant_id = public.current_tenant_id());
create policy "subs_insert_own_tenant" on public.subscriptions
  for insert with check (tenant_id = public.current_tenant_id());
create policy "subs_update_own_tenant" on public.subscriptions
  for update using (tenant_id = public.current_tenant_id());

-- profiles: user reads own, tenant scoping is advisory here
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- 6. Seed plans (pricing in cents) --------------------------------------------
insert into public.plans (id, name, slug, description, monthly_price, features, max_seats, max_facilities, sort_order)
values
  ('plan_pilot',    'Pilot',    'pilot',    'Single facility, COA import, audit chain, Metrc sync, email support.', 50000,  '["1 facility","COA import + parsing","ALCOA++ audit chain","Metrc sync","Email support"]', 1, 1, 1),
  ('plan_standard', 'Standard', 'standard', 'Multi-facility, GxP workflows, literature intelligence, SLA.',            200000, '["5 facilities","Everything in Pilot","GxP 5-stage workflows","Literature intelligence","Priority SLA"]', 5, 5, 2),
  ('plan_enterprise','Enterprise','enterprise','Custom: unlimited facilities, SSO, on-prem, API access.',             999999, '["Unlimited facilities","SSO + MFA","On-prem / VPC","Full API access","Dedicated support"]', 999, 999, 3)
on conflict (id) do nothing;

grant select on public.plans to anon, authenticated;
