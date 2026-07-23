-- ============================================================
-- Discover Group Finance Portal — schema
-- Every table is RLS-protected. No anonymous access anywhere.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Roles ----------
create type finance_role as enum ('viewer', 'clerk', 'manager', 'admin');

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  role        finance_role not null default 'viewer',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Helper: current user's role. SECURITY DEFINER avoids RLS recursion.
create or replace function auth_role() returns finance_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() in ('clerk','manager','admin'), false)
$$;

create or replace function is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role() in ('manager','admin'), false)
$$;

-- ---------- Reference data ----------
create table vendors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text not null,   -- airline, hotel, transportation, admission,
                               -- guide, tour_operator, restaurant, landlord,
                               -- utility, payroll, other
  contact     text,
  tax_id      text,
  terms_days  int not null default 30,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text not null default 'agency',  -- agency, corporate, direct, ota
  contact     text,
  terms_days  int not null default 30,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- Tours (cost centre for booking payables) ----------
create table tours (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  title         text not null,
  client_id     uuid references clients(id),
  start_date    date,
  end_date      date,
  pax           int not null default 0,
  status        text not null default 'planned', -- planned, running, closed, cancelled
  created_at    timestamptz not null default now()
);

-- ---------- Payables ----------
create table payables (
  id            uuid primary key default gen_random_uuid(),
  invoice_no    text,
  vendor_id     uuid not null references vendors(id),
  tour_id       uuid references tours(id),          -- null = operational expense
  kind          text not null,                       -- 'booking' | 'operational'
  category      text not null,                       -- airline, hotel, transportation,
                                                     -- admission, guide, tour, restaurant,
                                                     -- office_rental, utilities, salary, other
  description   text,
  amount        numeric(14,2) not null check (amount >= 0),
  currency      char(3) not null default 'PHP',
  invoice_date  date not null default current_date,
  due_date      date,
  paid_amount   numeric(14,2) not null default 0 check (paid_amount >= 0),
  status        text not null default 'unpaid',      -- unpaid, partial, paid, void
  notes         text,
  created_by    uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on payables (status, due_date);
create index on payables (tour_id);
create index on payables (category);

-- ---------- Receivables ----------
create table receivables (
  id            uuid primary key default gen_random_uuid(),
  invoice_no    text,
  client_id     uuid not null references clients(id),
  tour_id       uuid references tours(id),
  description   text,
  amount        numeric(14,2) not null check (amount >= 0),
  currency      char(3) not null default 'PHP',
  invoice_date  date not null default current_date,
  due_date      date,
  received_amount numeric(14,2) not null default 0 check (received_amount >= 0),
  status        text not null default 'open',        -- open, partial, settled, written_off
  notes         text,
  created_by    uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index on receivables (status, due_date);
create index on receivables (tour_id);

-- ---------- Payment log (audit trail) ----------
create table payments (
  id            uuid primary key default gen_random_uuid(),
  payable_id    uuid references payables(id) on delete cascade,
  receivable_id uuid references receivables(id) on delete cascade,
  direction     text not null,   -- 'out' | 'in'
  amount        numeric(14,2) not null check (amount > 0),
  method        text,            -- bank, cash, card, cheque, online
  reference     text,
  paid_on       date not null default current_date,
  created_by    uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  check (num_nonnulls(payable_id, receivable_id) = 1)
);

-- ---------- Keep balances in sync ----------
create or replace function apply_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.payable_id is not null then
    update payables set
      paid_amount = paid_amount + new.amount,
      status = case
        when paid_amount + new.amount >= amount then 'paid'
        when paid_amount + new.amount > 0 then 'partial'
        else 'unpaid' end,
      updated_at = now()
    where id = new.payable_id;
  else
    update receivables set
      received_amount = received_amount + new.amount,
      status = case
        when received_amount + new.amount >= amount then 'settled'
        when received_amount + new.amount > 0 then 'partial'
        else 'open' end,
      updated_at = now()
    where id = new.receivable_id;
  end if;
  return new;
end $$;

create trigger trg_apply_payment after insert on payments
  for each row execute function apply_payment();

-- ---------- Reporting views ----------
create view v_payables_aging as
select p.*, v.name as vendor_name, t.code as tour_code,
       (p.amount - p.paid_amount) as balance,
       case
         when p.status = 'paid' then 'settled'
         when p.due_date is null then 'undated'
         when p.due_date >= current_date then 'current'
         when current_date - p.due_date <= 30 then '1-30'
         when current_date - p.due_date <= 60 then '31-60'
         when current_date - p.due_date <= 90 then '61-90'
         else '90+'
       end as aging_bucket
from payables p
join vendors v on v.id = p.vendor_id
left join tours t on t.id = p.tour_id
where p.status <> 'void';

create view v_receivables_aging as
select r.*, c.name as client_name, t.code as tour_code,
       (r.amount - r.received_amount) as balance,
       case
         when r.status = 'settled' then 'settled'
         when r.due_date is null then 'undated'
         when r.due_date >= current_date then 'current'
         when current_date - r.due_date <= 30 then '1-30'
         when current_date - r.due_date <= 60 then '31-60'
         when current_date - r.due_date <= 90 then '61-90'
         else '90+'
       end as aging_bucket
from receivables r
join clients c on c.id = r.client_id
left join tours t on t.id = r.tour_id
where r.status <> 'written_off';

-- Profit per tour: revenue billed vs booking costs incurred
create view v_tour_margin as
select t.id, t.code, t.title, t.pax, t.status, t.start_date,
       coalesce(rev.total, 0) as revenue,
       coalesce(cost.total, 0) as cost,
       coalesce(rev.total, 0) - coalesce(cost.total, 0) as margin
from tours t
left join (select tour_id, sum(amount) total from receivables
           where status <> 'written_off' group by tour_id) rev on rev.tour_id = t.id
left join (select tour_id, sum(amount) total from payables
           where status <> 'void' group by tour_id) cost on cost.tour_id = t.id;

-- ============================================================
-- Row Level Security
-- ============================================================
alter table profiles     enable row level security;
alter table vendors      enable row level security;
alter table clients      enable row level security;
alter table tours        enable row level security;
alter table payables     enable row level security;
alter table receivables  enable row level security;
alter table payments     enable row level security;

-- Profiles: you see yourself; admins see everyone.
create policy profiles_self_read on profiles for select
  to authenticated using (id = auth.uid() or auth_role() = 'admin');
create policy profiles_admin_write on profiles for all
  to authenticated using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- Reference data: any active signed-in user reads; staff writes.
create policy vendors_read on vendors for select to authenticated using (auth_role() is not null);
create policy vendors_write on vendors for all to authenticated
  using (is_staff()) with check (is_staff());

create policy clients_read on clients for select to authenticated using (auth_role() is not null);
create policy clients_write on clients for all to authenticated
  using (is_staff()) with check (is_staff());

create policy tours_read on tours for select to authenticated using (auth_role() is not null);
create policy tours_write on tours for all to authenticated
  using (is_staff()) with check (is_staff());

-- Ledgers: read for signed-in staff/viewers, insert+update for staff,
-- delete restricted to managers.
create policy payables_read on payables for select to authenticated using (auth_role() is not null);
create policy payables_insert on payables for insert to authenticated with check (is_staff());
create policy payables_update on payables for update to authenticated
  using (is_staff()) with check (is_staff());
create policy payables_delete on payables for delete to authenticated using (is_manager());

create policy receivables_read on receivables for select to authenticated using (auth_role() is not null);
create policy receivables_insert on receivables for insert to authenticated with check (is_staff());
create policy receivables_update on receivables for update to authenticated
  using (is_staff()) with check (is_staff());
create policy receivables_delete on receivables for delete to authenticated using (is_manager());

-- Payments are append-only. No update, no delete: the audit trail stands.
create policy payments_read on payments for select to authenticated using (auth_role() is not null);
create policy payments_insert on payments for insert to authenticated with check (is_staff());

-- Views inherit RLS from base tables via security_invoker.
alter view v_payables_aging     set (security_invoker = on);
alter view v_receivables_aging  set (security_invoker = on);
alter view v_tour_margin        set (security_invoker = on);

-- ---------- New signups start as inactive viewers ----------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, role, active)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), 'viewer', false);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- Lock down helper functions ----------
-- These are called only by RLS policies and triggers. They must not be
-- reachable as /rest/v1/rpc endpoints.
revoke execute on function public.auth_role()       from anon, authenticated, public;
revoke execute on function public.is_staff()        from anon, authenticated, public;
revoke execute on function public.is_manager()      from anon, authenticated, public;
revoke execute on function public.apply_payment()   from anon, authenticated, public;
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- ============================================================
-- Booking department document library
-- ============================================================
create table documents (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  category      text not null,
  sensitivity   text not null default 'internal',  -- 'internal' | 'restricted'
  tour_id       uuid references tours(id),
  period        text,
  notes         text,
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint,
  uploaded_by   uuid references profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

alter table documents enable row level security;

create policy documents_read_internal on documents for select to authenticated
  using (sensitivity = 'internal' and private.auth_role() is not null);
create policy documents_read_restricted on documents for select to authenticated
  using (sensitivity = 'restricted' and private.is_manager());
create policy documents_insert on documents for insert to authenticated
  with check (private.is_manager());
create policy documents_update on documents for update to authenticated
  using (private.is_manager()) with check (private.is_manager());
create policy documents_delete on documents for delete to authenticated
  using (private.is_manager());

-- Private storage bucket, 50 MB cap.
insert into storage.buckets (id, name, public, file_size_limit)
values ('booking-docs', 'booking-docs', false, 52428800)
on conflict (id) do nothing;

-- Path prefix mirrors sensitivity so the file is protected, not just its row.
create policy booking_docs_read_internal on storage.objects for select to authenticated
  using (bucket_id = 'booking-docs' and (storage.foldername(name))[1] = 'internal'
         and private.auth_role() is not null);
create policy booking_docs_read_restricted on storage.objects for select to authenticated
  using (bucket_id = 'booking-docs' and (storage.foldername(name))[1] = 'restricted'
         and private.is_manager());
create policy booking_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'booking-docs'
              and (storage.foldername(name))[1] in ('internal','restricted')
              and private.is_manager());
create policy booking_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'booking-docs' and private.is_manager());
