-- V1 foundation. Apply to a dedicated Supabase DEVELOPMENT project only.
-- Workbook column labels/types and H formula are intentionally not hard-coded yet.
create extension if not exists pgcrypto;

create type public.school_member_role as enum ('CENTRAL_ADMIN','CATEGORY_1','CATEGORY_2');
create type public.delivery_status as enum ('DRAFT','SUBMITTED','VALIDATED','CANCELLED');

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(department_id, code)
);
create table public.school_years (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  starts_on date,
  ends_on date,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create table public.school_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  department_id uuid references public.departments(id) on delete cascade,
  role public.school_member_role not null,
  created_at timestamptz not null default now(),
  primary key(user_id, role, department_id),
  check ((role='CENTRAL_ADMIN' and department_id is null) or (role<>'CENTRAL_ADMIN' and department_id is not null))
);
create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  cycle text not null,
  display_order integer not null default 0
);
create table public.pedagogical_groups (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  school_year_id uuid not null references public.school_years(id),
  promotion_id uuid not null references public.promotions(id),
  group_code text not null,
  created_at timestamptz not null default now(),
  unique(school_id, school_year_id, promotion_id, group_code)
);
-- JSONB keeps the original workbook's heterogeneous cell types intact during the mapping phase.
-- Keys A,B,C,D,F,G,H,I,K,L will be interpreted after the workbook audit.
create table public.school_reports (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  school_year_id uuid not null references public.school_years(id),
  report_data jsonb not null default '{}'::jsonb,
  system_data jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(school_id, school_year_id),
  check (jsonb_typeof(report_data)='object'),
  check (jsonb_typeof(system_data)='object')
);
create table public.delivery_slips (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id),
  school_year_id uuid not null references public.school_years(id),
  slip_number text not null,
  delivery_date date not null,
  status public.delivery_status not null default 'DRAFT',
  observations text,
  responsible_agent text,
  created_by uuid not null default auth.uid() references auth.users(id),
  validated_by uuid references auth.users(id),
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  unique(school_id, school_year_id, slip_number),
  check(status <> 'VALIDATED' or (validated_by is not null and validated_at is not null))
);
create table public.delivery_slip_lines (
  id uuid primary key default gen_random_uuid(),
  delivery_slip_id uuid not null references public.delivery_slips(id) on delete cascade,
  promotion_id uuid not null references public.promotions(id),
  group_code text not null,
  quantity_delivered integer not null check(quantity_delivered >= 0),
  created_at timestamptz not null default now(),
  unique(delivery_slip_id, promotion_id, group_code)
);
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id),
  department_id uuid references public.departments(id),
  school_id uuid references public.schools(id),
  event_type text not null,
  entity_table text not null,
  record_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.is_central_admin()
returns boolean language sql stable security definer set search_path=public,pg_temp set row_security=off
as $$ select exists(select 1 from public.school_memberships m where m.user_id=auth.uid() and m.role='CENTRAL_ADMIN' and m.department_id is null); $$;
create or replace function public.has_department_access(target_department uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp set row_security=off
as $$ select public.is_central_admin() or exists(select 1 from public.school_memberships m where m.user_id=auth.uid() and m.department_id=target_department and m.role in ('CATEGORY_1','CATEGORY_2')); $$;
create or replace function public.current_department_role(target_department uuid)
returns public.school_member_role language sql stable security definer set search_path=public,pg_temp set row_security=off
as $$
 select case
  when public.is_central_admin() then 'CENTRAL_ADMIN'::public.school_member_role
  when exists(select 1 from public.school_memberships m where m.user_id=auth.uid() and m.department_id=target_department and m.role='CATEGORY_1') then 'CATEGORY_1'::public.school_member_role
  when exists(select 1 from public.school_memberships m where m.user_id=auth.uid() and m.department_id=target_department and m.role='CATEGORY_2') then 'CATEGORY_2'::public.school_member_role
  else null end;
$$;

alter table public.departments enable row level security;
alter table public.schools enable row level security;
alter table public.school_years enable row level security;
alter table public.school_memberships enable row level security;
alter table public.promotions enable row level security;
alter table public.pedagogical_groups enable row level security;
alter table public.school_reports enable row level security;
alter table public.delivery_slips enable row level security;
alter table public.delivery_slip_lines enable row level security;
alter table public.audit_events enable row level security;

-- No direct table writes from browser clients. Mutations go through narrowly-scoped RPCs.
revoke all on public.departments, public.schools, public.school_years, public.school_memberships,
 public.promotions, public.pedagogical_groups, public.school_reports, public.delivery_slips,
 public.delivery_slip_lines, public.audit_events from anon, authenticated;
grant select on public.departments, public.schools, public.school_years, public.school_memberships,
 public.promotions, public.pedagogical_groups, public.school_reports, public.delivery_slips,
 public.delivery_slip_lines to authenticated;
grant select on public.audit_events to authenticated;
grant usage on type public.school_member_role, public.delivery_status to authenticated;

create policy departments_read on public.departments for select to authenticated using (public.is_central_admin() or exists(select 1 from public.school_memberships m where m.user_id=auth.uid() and m.department_id=id));
create policy schools_read on public.schools for select to authenticated using(public.has_department_access(department_id));
create policy school_years_read on public.school_years for select to authenticated using(true);
create policy memberships_self_read on public.school_memberships for select to authenticated using(user_id=auth.uid() or public.is_central_admin());
create policy promotions_read on public.promotions for select to authenticated using(true);
create policy groups_read on public.pedagogical_groups for select to authenticated using(exists(select 1 from public.schools s where s.id=school_id and public.has_department_access(s.department_id)));
create policy reports_department_read on public.school_reports for select to authenticated using(exists(select 1 from public.schools s where s.id=school_id and public.has_department_access(s.department_id)));
create policy delivery_read on public.delivery_slips for select to authenticated using(exists(select 1 from public.schools s where s.id=school_id and public.has_department_access(s.department_id)));
create policy delivery_lines_read on public.delivery_slip_lines for select to authenticated using(exists(select 1 from public.delivery_slips d join public.schools s on s.id=d.school_id where d.id=delivery_slip_id and public.has_department_access(s.department_id)));
create policy audit_read_admin on public.audit_events for select to authenticated using(public.is_central_admin());

-- Enforce column permissions inside the database. G is central-admin only; H is never client writable.
create or replace function public.save_school_report(
 p_school_id uuid, p_school_year_id uuid, p_changes jsonb
) returns public.school_reports
language plpgsql security definer set search_path=public,pg_temp set row_security=off
as $$
declare
 v_department uuid;
 v_role public.school_member_role;
 v_report public.school_reports;
 v_key text;
 v_allowed text[];
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if jsonb_typeof(p_changes) <> 'object' then raise exception 'Changes must be a JSON object'; end if;
 select department_id into v_department from public.schools where id=p_school_id and is_active=true;
 if v_department is null then raise exception 'School not found or inactive'; end if;
 v_role := public.current_department_role(v_department);
 if v_role is null then raise exception 'Department access denied'; end if;
 if v_role='CENTRAL_ADMIN' then
   v_allowed := array['A','B','C','D','F','G','I','K','L'];
 elsif v_role='CATEGORY_1' then
   v_allowed := array['A','B','C','D','F'];
 else
   v_allowed := array['I','K','L'];
 end if;
 for v_key in select jsonb_object_keys(p_changes) loop
   if v_key not in ('A','B','C','D','F','G','H','I','K','L') then raise exception 'Unknown report field: %',v_key; end if;
   if v_key='H' then raise exception 'Field H is system-managed'; end if;
   if not (v_key = any(v_allowed)) then raise exception 'Not authorized to edit field %',v_key; end if;
 end loop;
 insert into public.school_reports as existing(school_id,school_year_id,report_data,created_by,updated_by)
 values(p_school_id,p_school_year_id,p_changes,auth.uid(),auth.uid())
 on conflict(school_id,school_year_id) do update
 set report_data=existing.report_data || excluded.report_data,
     updated_by=auth.uid(),updated_at=now()
 returning * into v_report;
 insert into public.audit_events(actor_user_id,department_id,school_id,event_type,entity_table,record_id,details)
 values(auth.uid(),v_department,p_school_id,'REPORT_FIELDS_SAVED','school_reports',v_report.id::text,
 jsonb_build_object('changed_fields',coalesce((select jsonb_agg(k) from jsonb_object_keys(p_changes) as keys(k)),'[]'::jsonb)));
 return v_report;
end;
$$;
revoke all on function public.save_school_report(uuid,uuid,jsonb) from public, anon;
grant execute on function public.save_school_report(uuid,uuid,jsonb) to authenticated;

-- Draft creation is allowed only inside the user's assigned department. Validation remains admin-only for V1.
create or replace function public.create_delivery_slip(
 p_school_id uuid,p_school_year_id uuid,p_slip_number text,p_delivery_date date,
 p_observations text default null,p_responsible_agent text default null
) returns public.delivery_slips
language plpgsql security definer set search_path=public,pg_temp set row_security=off
as $$
declare v_department uuid; v_result public.delivery_slips;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 select department_id into v_department from public.schools where id=p_school_id and is_active=true;
 if v_department is null or not public.has_department_access(v_department) then raise exception 'Department access denied'; end if;
 insert into public.delivery_slips(school_id,school_year_id,slip_number,delivery_date,observations,responsible_agent,created_by)
 values(p_school_id,p_school_year_id,p_slip_number,p_delivery_date,p_observations,p_responsible_agent,auth.uid())
 returning * into v_result;
 insert into public.audit_events(actor_user_id,department_id,school_id,event_type,entity_table,record_id)
 values(auth.uid(),v_department,p_school_id,'DELIVERY_SLIP_CREATED','delivery_slips',v_result.id::text);
 return v_result;
end;
$$;
revoke all on function public.create_delivery_slip(uuid,uuid,text,date,text,text) from public,anon;
grant execute on function public.create_delivery_slip(uuid,uuid,text,date,text,text) to authenticated;


create or replace function public.add_delivery_slip_line(
 p_delivery_slip_id uuid,p_promotion_id uuid,p_group_code text,p_quantity integer
) returns public.delivery_slip_lines
language plpgsql security definer set search_path=public,pg_temp set row_security=off
as $
declare v_department uuid; v_school uuid; v_creator uuid; v_status public.delivery_status; v_result public.delivery_slip_lines;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_quantity < 0 then raise exception 'Quantity cannot be negative'; end if;
 select s.department_id,d.school_id,d.created_by,d.status into v_department,v_school,v_creator,v_status
 from public.delivery_slips d join public.schools s on s.id=d.school_id where d.id=p_delivery_slip_id;
 if v_department is null or not public.has_department_access(v_department) then raise exception 'Department access denied'; end if;
 if v_status <> 'DRAFT' then raise exception 'Only draft delivery slips can be edited'; end if;
 if v_creator <> auth.uid() and not public.is_central_admin() then raise exception 'Only the creator or central admin can edit this slip'; end if;
 insert into public.delivery_slip_lines(delivery_slip_id,promotion_id,group_code,quantity_delivered)
 values(p_delivery_slip_id,p_promotion_id,p_group_code,p_quantity)
 returning * into v_result;
 insert into public.audit_events(actor_user_id,department_id,school_id,event_type,entity_table,record_id,details)
 values(auth.uid(),v_department,v_school,'DELIVERY_SLIP_LINE_ADDED','delivery_slip_lines',v_result.id::text,
 jsonb_build_object('promotion_id',p_promotion_id,'group_code',p_group_code,'quantity',p_quantity));
 return v_result;
end;
$;
revoke all on function public.add_delivery_slip_line(uuid,uuid,text,integer) from public,anon;
grant execute on function public.add_delivery_slip_line(uuid,uuid,text,integer) to authenticated;

comment on column public.school_reports.report_data is 'Workbook fields keyed by original column letters; labels and data types are mapped in a later audited migration.';
comment on column public.school_reports.system_data is 'System-derived values, including future confirmed mapping for column H.';