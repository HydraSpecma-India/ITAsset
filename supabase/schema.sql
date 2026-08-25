-- =====================================================================
--  IT Purchase & Budget Monitoring Tool — full database schema
--  Run this once in the Supabase SQL editor of a fresh project.
--  Everything is prefixed it_ / v_it_ so it can share a project safely.
-- =====================================================================

-- ------------------------------------------------------------- tables
create table if not exists public.it_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null default 'viewer' check (role in ('admin','viewer')),
  must_change_password boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.it_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.it_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  gst_no text,
  contact_person text,
  phone text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.it_budgets (
  id uuid primary key default gen_random_uuid(),
  budget_year integer not null,
  category_id uuid not null references public.it_categories(id) on delete restrict,
  scope text not null check (scope in ('local','global')),
  amount numeric(14,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (budget_year, category_id, scope)
);

create table if not exists public.it_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null,
  invoice_date date not null,
  vendor_id uuid references public.it_vendors(id) on delete set null,
  po_number text,
  currency text not null default 'INR',
  tax_amount numeric(14,2) not null default 0,
  other_charges numeric(14,2) not null default 0,
  notes text,
  attachment_path text,
  created_by uuid references public.it_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists it_invoices_no_vendor_uidx
  on public.it_invoices (lower(invoice_no), coalesce(vendor_id,'00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.it_assets (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.it_invoices(id) on delete cascade,
  asset_name text not null,
  asset_tag text,
  serial_no text,
  model text,
  category_id uuid not null references public.it_categories(id) on delete restrict,
  scope text not null check (scope in ('local','global')),
  item_type text not null default 'hardware' check (item_type in ('hardware','software','service')),
  staff_name text,
  staff_code text,
  department text,
  location text,
  quantity integer not null default 1 check (quantity > 0),
  unit_cost numeric(14,2) not null default 0,
  line_total numeric(16,2) generated always as (quantity * unit_cost) stored,
  purchase_date date not null,
  budget_year integer generated always as (extract(year from purchase_date)::int) stored,
  warranty_end date,
  license_end date,
  amc_end date,
  replacement_due date,
  status text not null default 'in_use' check (status in ('in_use','spare','repair','disposed')),
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists it_assets_year_cat_scope_idx on public.it_assets (budget_year, category_id, scope);
create index if not exists it_assets_invoice_idx on public.it_assets (invoice_id);

create table if not exists public.it_plan_lines (
  id uuid primary key default gen_random_uuid(),
  plan_year integer not null,
  category_id uuid not null references public.it_categories(id) on delete restrict,
  scope text not null check (scope in ('local','global')),
  planned_amount numeric(14,2) not null default 0,
  basis text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_year, category_id, scope)
);

-- ------------------------------------------------------------ helpers
create or replace function public.it_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.it_users where id = auth.uid() and role = 'admin' and is_active);
$$;

create or replace function public.it_is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.it_users where id = auth.uid() and is_active);
$$;

create or replace function public.it_mark_password_changed()
returns void language sql volatile security definer set search_path = public as $$
  update public.it_users set must_change_password = false where id = auth.uid();
$$;

create or replace function public.it_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

do $$
declare t text;
begin
  foreach t in array array['it_budgets','it_invoices','it_assets','it_plan_lines'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.it_touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS
alter table public.it_users      enable row level security;
alter table public.it_categories enable row level security;
alter table public.it_vendors    enable row level security;
alter table public.it_budgets    enable row level security;
alter table public.it_invoices   enable row level security;
alter table public.it_assets     enable row level security;
alter table public.it_plan_lines enable row level security;

drop policy if exists it_users_read on public.it_users;
create policy it_users_read on public.it_users
  for select to authenticated using (id = auth.uid() or public.it_is_admin());

drop policy if exists it_users_admin_write on public.it_users;
create policy it_users_admin_write on public.it_users
  for all to authenticated using (public.it_is_admin()) with check (public.it_is_admin());

do $$
declare t text;
begin
  foreach t in array array['it_categories','it_vendors','it_budgets','it_invoices','it_assets','it_plan_lines'] loop
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (public.it_is_member())', t, t);
    execute format('drop policy if exists %I_admin_write on public.%I', t, t);
    execute format('create policy %I_admin_write on public.%I for all to authenticated using (public.it_is_admin()) with check (public.it_is_admin())', t, t);
  end loop;
end $$;

-- -------------------------------------------------------------- views
create or replace view public.v_it_budget_summary
with (security_invoker = true) as
with keys as (
  select budget_year, category_id, scope from public.it_budgets
  union
  select budget_year, category_id, scope from public.it_assets where status <> 'disposed'
),
spend as (
  select budget_year, category_id, scope, sum(line_total) as consumed, count(*) as line_count
  from public.it_assets group by 1,2,3
)
select k.budget_year, k.category_id, c.name as category_name, c.sort_order, k.scope,
       coalesce(b.amount, 0) as budget_amount,
       coalesce(s.consumed, 0) as consumed,
       coalesce(b.amount, 0) - coalesce(s.consumed, 0) as balance,
       case when coalesce(b.amount,0) = 0 then null
            else round(coalesce(s.consumed,0) / b.amount * 100, 1) end as utilisation_pct,
       coalesce(s.line_count, 0) as line_count
from keys k
join public.it_categories c on c.id = k.category_id
left join public.it_budgets b on b.budget_year = k.budget_year and b.category_id = k.category_id and b.scope = k.scope
left join spend s on s.budget_year = k.budget_year and s.category_id = k.category_id and s.scope = k.scope;

create or replace view public.v_it_expiry_alerts
with (security_invoker = true) as
select * from (
  select a.id as asset_id, a.asset_name, a.asset_tag, a.serial_no, a.model,
         c.name as category_name, a.scope, a.staff_name, a.department, a.location,
         a.status, a.line_total, a.purchase_date,
         'Warranty' as alert_type, a.warranty_end as expiry_date
  from public.it_assets a join public.it_categories c on c.id = a.category_id
  where a.warranty_end is not null
  union all
  select a.id, a.asset_name, a.asset_tag, a.serial_no, a.model, c.name, a.scope,
         a.staff_name, a.department, a.location, a.status, a.line_total, a.purchase_date,
         'Licence / Subscription', a.license_end
  from public.it_assets a join public.it_categories c on c.id = a.category_id
  where a.license_end is not null
  union all
  select a.id, a.asset_name, a.asset_tag, a.serial_no, a.model, c.name, a.scope,
         a.staff_name, a.department, a.location, a.status, a.line_total, a.purchase_date,
         'AMC / Service contract', a.amc_end
  from public.it_assets a join public.it_categories c on c.id = a.category_id
  where a.amc_end is not null
  union all
  select a.id, a.asset_name, a.asset_tag, a.serial_no, a.model, c.name, a.scope,
         a.staff_name, a.department, a.location, a.status, a.line_total, a.purchase_date,
         'Replacement due', a.replacement_due
  from public.it_assets a join public.it_categories c on c.id = a.category_id
  where a.replacement_due is not null
) x
where x.status <> 'disposed';

create or replace view public.v_it_invoice_totals
with (security_invoker = true) as
select i.id, i.invoice_no, i.invoice_date, i.po_number, i.currency,
       i.tax_amount, i.other_charges, i.notes, i.attachment_path, i.created_at,
       i.vendor_id, v.name as vendor_name,
       coalesce(sum(a.line_total), 0) as lines_total,
       coalesce(sum(a.line_total), 0) + i.tax_amount + i.other_charges as invoice_total,
       count(a.id) as line_count
from public.it_invoices i
left join public.it_vendors v on v.id = i.vendor_id
left join public.it_assets a on a.invoice_id = i.id
group by i.id, v.name;

-- ------------------------------------------------- user admin (RPCs)
create or replace function public.it_admin_create_user(
  p_email text, p_full_name text, p_role text, p_temp_password text
) returns uuid
language plpgsql volatile security definer set search_path = public, auth, extensions as $$
declare uid uuid;
begin
  if not public.it_is_admin() then raise exception 'Only administrators can create users'; end if;
  if p_role not in ('admin','viewer') then raise exception 'Invalid role'; end if;
  if length(coalesce(p_temp_password,'')) < 8 then raise exception 'Temporary password must be at least 8 characters'; end if;
  p_email := lower(trim(p_email));
  if exists (select 1 from auth.users where email = p_email) then
    raise exception 'A user with that email already exists';
  end if;

  uid := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    is_super_admin, is_sso_user, is_anonymous
  ) values (
    '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
    p_email, extensions.crypt(p_temp_password, extensions.gen_salt('bf')),
    now(), now(), now(),
    jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', p_full_name),
    '', '', '', '', false, false, false
  );
  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), uid::text, uid,
    jsonb_build_object('sub', uid::text, 'email', p_email, 'email_verified', true, 'phone_verified', false),
    'email', now(), now(), now()
  );
  insert into public.it_users (id, email, full_name, role, must_change_password, is_active)
  values (uid, p_email, p_full_name, p_role, true, true);
  return uid;
end $$;

create or replace function public.it_admin_reset_password(p_user_id uuid, p_temp_password text)
returns void
language plpgsql volatile security definer set search_path = public, auth, extensions as $$
begin
  if not public.it_is_admin() then raise exception 'Only administrators can reset passwords'; end if;
  if length(coalesce(p_temp_password,'')) < 8 then raise exception 'Temporary password must be at least 8 characters'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_temp_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user_id;
  update public.it_users set must_change_password = true where id = p_user_id;
end $$;

revoke all on function public.it_admin_create_user(text,text,text,text) from public, anon;
revoke all on function public.it_admin_reset_password(uuid,text) from public, anon;
grant execute on function public.it_admin_create_user(text,text,text,text) to authenticated;
grant execute on function public.it_admin_reset_password(uuid,text) to authenticated;
grant execute on function public.it_mark_password_changed() to authenticated;

-- --------------------------------------------------- seed + storage
insert into public.it_categories (name, description, sort_order) values
  ('Laptop',                    'Notebooks and mobile workstations',              10),
  ('Desktop / Workstation',     'Desktop PCs, all-in-ones, workstations',         20),
  ('Server & Storage',          'Servers, NAS/SAN, backup appliances',            30),
  ('Networking',                'Switches, routers, firewalls, access points',    40),
  ('Printers & Scanners',       'Printers, MFDs, scanners, label printers',       50),
  ('Peripherals & Accessories', 'Monitors, keyboards, docks, cables, headsets',   60),
  ('Mobile & Tablet',           'Phones, tablets, rugged handhelds',              70),
  ('Software Licence',          'Perpetual and subscription software licences',   80),
  ('Cloud & Subscription',      'Azure, M365, SaaS subscriptions',                90),
  ('UPS & Power',               'UPS units, batteries, power distribution',      100),
  ('CCTV & Security',           'Cameras, NVR, access control',                  110),
  ('AMC & Services',            'Annual maintenance, support and service calls', 120),
  ('Consumables',               'Toner, cartridges, media, small spares',        130),
  ('Others',                    'Anything that does not fit the above',          140)
on conflict (name) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('it-invoices', 'it-invoices', false, 20971520,
        array['application/pdf','image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

drop policy if exists it_invoices_bucket_read on storage.objects;
create policy it_invoices_bucket_read on storage.objects
  for select to authenticated using (bucket_id = 'it-invoices' and public.it_is_member());

drop policy if exists it_invoices_bucket_write on storage.objects;
create policy it_invoices_bucket_write on storage.objects
  for all to authenticated
  using (bucket_id = 'it-invoices' and public.it_is_admin())
  with check (bucket_id = 'it-invoices' and public.it_is_admin());

-- --------------------------------------------- first admin + viewer
-- Change the emails and the temporary password before running.
do $$
declare rec record; uid uuid;
begin
  for rec in
    select * from (values
      ('itadmin@hydraspecma.com', 'IT Administrator',  'admin',  'Hydra@2026'),
      ('itview@hydraspecma.com',  'Management Viewer', 'viewer', 'Hydra@2026')
    ) as t(email, full_name, role, pwd)
  loop
    select id into uid from auth.users where email = rec.email;
    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        is_super_admin, is_sso_user, is_anonymous
      ) values (
        '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
        rec.email, extensions.crypt(rec.pwd, extensions.gen_salt('bf')),
        now(), now(), now(),
        jsonb_build_object('provider','email','providers', jsonb_build_array('email')),
        jsonb_build_object('full_name', rec.full_name),
        '', '', '', '', false, false, false
      );
      insert into auth.identities (
        id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), uid::text, uid,
        jsonb_build_object('sub', uid::text, 'email', rec.email, 'email_verified', true, 'phone_verified', false),
        'email', now(), now(), now()
      );
    end if;
    insert into public.it_users (id, email, full_name, role, must_change_password, is_active)
    values (uid, rec.email, rec.full_name, rec.role, true, true)
    on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;
  end loop;
end $$;
