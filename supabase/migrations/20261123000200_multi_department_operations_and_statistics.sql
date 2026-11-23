-- Rapports Scolaires: validated multi-department operations and shared statistics.
-- Apply only after the initial foundation has been reviewed in a dedicated Supabase DEV project.
-- This migration deliberately keeps the original workbook mapping while moving cumulative operations
-- into an auditable ledger. Corrections/reprints never inflate unique enrollment or delivery counts.

create type public.school_operation_type as enum (
  'ENROLLMENT_RATISSAGE',
  'ENROLLMENT_CORRECTION',
  'DELIVERY_INITIAL',
  'DELIVERY_RATISSAGE',
  'DELIVERY_CORRECTION_FIRST_ISSUE',
  'DELIVERY_REPRINT'
);

-- One person may hold one or both category roles in each department, and roles may differ by department.
drop index if exists public.school_memberships_department_user_uq;
create unique index school_memberships_user_department_role_uq
  on public.school_memberships(user_id, department_id, role)
  where department_id is not null;

create or replace function public.has_department_role(
  target_department uuid,
  target_role public.school_member_role
) returns boolean
language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  select public.is_central_admin()
    or exists (
      select 1 from public.school_memberships m
      where m.user_id=auth.uid()
        and m.department_id=target_department
        and m.role=target_role
    );
$$;

create table public.school_report_operations (
  id uuid primary key default gen_random_uuid(),
  school_report_id uuid not null references public.school_reports(id) on delete cascade,
  pedagogical_group_id uuid not null references public.pedagogical_groups(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  department_id uuid not null references public.departments(id),
  school_year_id uuid not null references public.school_years(id),
  operation_type public.school_operation_type not null,
  quantity integer not null check(quantity > 0),
  idempotency_key uuid not null unique,
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key(pedagogical_group_id,school_id,school_year_id)
    references public.pedagogical_groups(id,school_id,school_year_id)
);

create index school_report_operations_report_type_idx
  on public.school_report_operations(school_report_id,operation_type);
create index school_report_operations_department_year_idx
  on public.school_report_operations(department_id,school_year_id);

alter table public.school_report_operations enable row level security;
revoke all on public.school_report_operations from anon,authenticated;
grant select on public.school_report_operations to authenticated;
create policy school_report_operations_read on public.school_report_operations
  for select to authenticated using(public.has_department_access(department_id));

-- Validate the source enrollment fields and prevent a reduction of class capacity below enrolled totals.
create or replace function public.enforce_school_report_capacity()
returns trigger language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_capacity integer;
  v_initial integer;
  v_ratisse integer;
begin
  v_capacity := coalesce(nullif(new.report_data->>'C','')::integer,0);
  v_initial := coalesce(nullif(new.report_data->>'D','')::integer,0);
  if v_capacity < 0 or v_initial < 0 then
    raise exception 'Les effectifs ne peuvent pas être négatifs';
  end if;
  if v_initial > v_capacity then
    raise exception 'L''enrôlement initial ne peut pas dépasser l''effectif total';
  end if;

  select coalesce(sum(o.quantity),0)::integer into v_ratisse
  from public.school_report_operations o
  where o.school_report_id=new.id
    and o.operation_type='ENROLLMENT_RATISSAGE';

  if v_initial + v_ratisse > v_capacity then
    raise exception 'La modification ferait dépasser la capacité de la classe: enrôlés %, effectif %',
      v_initial + v_ratisse, v_capacity;
  end if;
  return new;
end;
$$;

drop trigger if exists school_reports_capacity_guard on public.school_reports;
create trigger school_reports_capacity_guard
before insert or update of report_data on public.school_reports
for each row execute function public.enforce_school_report_capacity();

-- Atomic operation recording: lock the report row, re-evaluate current totals, then append an immutable event.
create or replace function public.record_school_report_operation(
  p_pedagogical_group_id uuid,
  p_operation_type public.school_operation_type,
  p_quantity integer,
  p_idempotency_key uuid,
  p_note text default null
) returns public.school_report_operations
language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
declare
  v_report public.school_reports;
  v_school uuid;
  v_year uuid;
  v_department uuid;
  v_role_ok boolean;
  v_capacity integer;
  v_initial integer;
  v_enrollment_ratisse integer;
  v_enrolled integer;
  v_delivered integer;
  v_required_role public.school_member_role;
  v_result public.school_report_operations;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'La quantité doit être un entier positif'; end if;
  if p_idempotency_key is null then raise exception 'Une clé anti-doublon est obligatoire'; end if;

  select g.school_id,g.school_year_id,s.department_id
    into v_school,v_year,v_department
  from public.pedagogical_groups g
  join public.schools s on s.id=g.school_id
  where g.id=p_pedagogical_group_id and s.is_active=true;

  if v_department is null or not public.has_department_access(v_department) then
    raise exception 'Accès au département refusé';
  end if;

  if p_operation_type in ('ENROLLMENT_RATISSAGE','ENROLLMENT_CORRECTION') then
    v_required_role := 'CATEGORY_1';
  else
    v_required_role := 'CATEGORY_2';
  end if;
  v_role_ok := public.is_central_admin() or public.has_department_role(v_department,v_required_role);
  if not v_role_ok then raise exception 'Droit insuffisant pour cette opération'; end if;

  -- Idempotency lookup occurs only after department and role authorization.
  select o.* into v_result
  from public.school_report_operations o
  where o.idempotency_key=p_idempotency_key
    and o.department_id=v_department;
  if found then return v_result; end if;

  select * into v_report
  from public.school_reports r
  where r.pedagogical_group_id=p_pedagogical_group_id
  for update;

  if not found then raise exception 'La classe doit d''abord être créée et enregistrée par la Catégorie 1'; end if;

  v_capacity := coalesce(nullif(v_report.report_data->>'C','')::integer,0);
  v_initial := coalesce(nullif(v_report.report_data->>'D','')::integer,0);

  select coalesce(sum(quantity),0)::integer into v_enrollment_ratisse
  from public.school_report_operations
  where school_report_id=v_report.id and operation_type='ENROLLMENT_RATISSAGE';

  select coalesce(sum(quantity),0)::integer into v_delivered
  from public.school_report_operations
  where school_report_id=v_report.id
    and operation_type in ('DELIVERY_INITIAL','DELIVERY_RATISSAGE','DELIVERY_CORRECTION_FIRST_ISSUE');

  v_enrolled := v_initial + v_enrollment_ratisse;

  if p_operation_type='ENROLLMENT_RATISSAGE'
     and p_quantity > v_capacity-v_enrolled then
    raise exception 'Ratissage supérieur au reste à enrôler: reste %, saisi %',
      greatest(v_capacity-v_enrolled,0),p_quantity;
  end if;

  if p_operation_type in ('DELIVERY_INITIAL','DELIVERY_RATISSAGE','DELIVERY_CORRECTION_FIRST_ISSUE')
     and p_quantity > v_enrolled-v_delivered then
    raise exception 'Livraison supérieure au reste à livrer: reste %, saisi %',
      greatest(v_enrolled-v_delivered,0),p_quantity;
  end if;

  insert into public.school_report_operations(
    school_report_id,pedagogical_group_id,school_id,department_id,school_year_id,
    operation_type,quantity,idempotency_key,note,created_by
  ) values (
    v_report.id,p_pedagogical_group_id,v_school,v_department,v_year,
    p_operation_type,p_quantity,p_idempotency_key,p_note,auth.uid()
  ) returning * into v_result;

  insert into public.audit_events(
    actor_user_id,department_id,school_id,event_type,entity_table,record_id,details
  ) values (
    auth.uid(),v_department,v_school,'SCHOOL_REPORT_OPERATION_RECORDED',
    'school_report_operations',v_result.id::text,
    jsonb_build_object('operation_type',p_operation_type,'quantity',p_quantity,
      'pedagogical_group_id',p_pedagogical_group_id)
  );

  return v_result;
end;
$$;

revoke all on function public.record_school_report_operation(uuid,public.school_operation_type,integer,uuid,text) from public,anon;
grant execute on function public.record_school_report_operation(uuid,public.school_operation_type,integer,uuid,text) to authenticated;
grant usage on type public.school_operation_type to authenticated;

-- Shared department situation: one row per department visible to the current user.
-- Corrections and reprints are reported separately and never inflate unique enrollment/delivery.
create or replace function public.get_department_situations(p_school_year_id uuid)
returns table(
  department_id uuid,
  department_name text,
  schools_count bigint,
  classes_count bigint,
  total_effectif bigint,
  enrollment_initial bigint,
  enrollment_ratissage bigint,
  enrollment_corrections bigint,
  total_enrolled bigint,
  enrollment_remaining bigint,
  enrollment_rate numeric,
  delivery_initial bigint,
  delivery_ratissage bigint,
  delivery_correction_first_issue bigint,
  delivery_reprints bigint,
  total_delivered_unique bigint,
  delivery_remaining bigint,
  delivery_rate numeric,
  anomaly_count bigint
)
language sql stable security definer
set search_path=public,pg_temp set row_security=off
as $$
  with accessible_schools as (
    select s.id,s.department_id
    from public.schools s
    where s.is_active=true and public.has_department_access(s.department_id)
  ),
  report_totals as (
    select
      s.department_id,
      r.id as report_id,
      coalesce(nullif(r.report_data->>'C','')::integer,0)::bigint as capacity,
      coalesce(nullif(r.report_data->>'D','')::integer,0)::bigint as initial_enrolled,
      coalesce(sum(o.quantity) filter(where o.operation_type='ENROLLMENT_RATISSAGE'),0)::bigint as enrollment_ratisse,
      coalesce(sum(o.quantity) filter(where o.operation_type='ENROLLMENT_CORRECTION'),0)::bigint as enrollment_corrections,
      coalesce(sum(o.quantity) filter(where o.operation_type='DELIVERY_INITIAL'),0)::bigint as delivery_initial,
      coalesce(sum(o.quantity) filter(where o.operation_type='DELIVERY_RATISSAGE'),0)::bigint as delivery_ratisse,
      coalesce(sum(o.quantity) filter(where o.operation_type='DELIVERY_CORRECTION_FIRST_ISSUE'),0)::bigint as delivery_correction_first_issue,
      coalesce(sum(o.quantity) filter(where o.operation_type='DELIVERY_REPRINT'),0)::bigint as delivery_reprints
    from public.school_reports r
    join accessible_schools s on s.id=r.school_id
    left join public.school_report_operations o on o.school_report_id=r.id
    where r.school_year_id=p_school_year_id
    group by s.department_id,r.id,r.report_data
  ),
  school_counts as (
    select department_id,count(*) as schools_count
    from accessible_schools
    group by department_id
  ),
  dept_reports as (
    select
      department_id,
      count(report_id) as classes_count,
      coalesce(sum(capacity),0) as total_effectif,
      coalesce(sum(initial_enrolled),0) as enrollment_initial,
      coalesce(sum(enrollment_ratisse),0) as enrollment_ratissage,
      coalesce(sum(enrollment_corrections),0) as enrollment_corrections,
      coalesce(sum(initial_enrolled+enrollment_ratisse),0) as total_enrolled,
      coalesce(sum(delivery_initial),0) as delivery_initial,
      coalesce(sum(delivery_ratisse),0) as delivery_ratissage,
      coalesce(sum(delivery_correction_first_issue),0) as delivery_correction_first_issue,
      coalesce(sum(delivery_reprints),0) as delivery_reprints
    from report_totals
    group by department_id
  ),
  dept_rollup as (
    select
      d.id as department_id,
      d.name as department_name,
      sc.schools_count,
      coalesce(dr.classes_count,0) as classes_count,
      coalesce(dr.total_effectif,0) as total_effectif,
      coalesce(dr.enrollment_initial,0) as enrollment_initial,
      coalesce(dr.enrollment_ratissage,0) as enrollment_ratissage,
      coalesce(dr.enrollment_corrections,0) as enrollment_corrections,
      coalesce(dr.total_enrolled,0) as total_enrolled,
      coalesce(dr.delivery_initial,0) as delivery_initial,
      coalesce(dr.delivery_ratissage,0) as delivery_ratissage,
      coalesce(dr.delivery_correction_first_issue,0) as delivery_correction_first_issue,
      coalesce(dr.delivery_reprints,0) as delivery_reprints
    from public.departments d
    join school_counts sc on sc.department_id=d.id
    left join dept_reports dr on dr.department_id=d.id
  )
  select
    dr.department_id,dr.department_name,dr.schools_count,dr.classes_count,
    dr.total_effectif,dr.enrollment_initial,dr.enrollment_ratissage,dr.enrollment_corrections,
    dr.total_enrolled,
    dr.total_effectif-dr.total_enrolled,
    case when dr.total_effectif=0 then 0 else round(dr.total_enrolled::numeric*100/dr.total_effectif,2) end,
    dr.delivery_initial,dr.delivery_ratissage,dr.delivery_correction_first_issue,dr.delivery_reprints,
    dr.delivery_initial+dr.delivery_ratissage+dr.delivery_correction_first_issue,
    dr.total_enrolled-(dr.delivery_initial+dr.delivery_ratissage+dr.delivery_correction_first_issue),
    case when dr.total_enrolled=0 then 0 else round(
      (dr.delivery_initial+dr.delivery_ratissage+dr.delivery_correction_first_issue)::numeric*100/dr.total_enrolled,2
    ) end,
    (case when dr.total_enrolled>dr.total_effectif then 1 else 0 end)
    + (case when dr.delivery_initial+dr.delivery_ratissage+dr.delivery_correction_first_issue>dr.total_enrolled then 1 else 0 end)
  from dept_rollup dr
  order by dr.department_name;
$$;
revoke all on function public.get_department_situations(uuid) from public,anon;
grant execute on function public.get_department_situations(uuid) to authenticated;

create or replace function public.assign_department_role(
  p_user_id uuid,
  p_department_id uuid,
  p_role public.school_member_role
) returns public.school_memberships
language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
declare v_result public.school_memberships;
begin
  if not public.is_central_admin() then raise exception 'Seul l''administrateur central peut attribuer les rôles'; end if;
  if p_role='CENTRAL_ADMIN' then raise exception 'Le rôle central ne se rattache pas à un département'; end if;
  insert into public.school_memberships(user_id,department_id,role)
  values(p_user_id,p_department_id,p_role)
  on conflict(user_id,department_id,role) where department_id is not null do nothing;
  select * into v_result from public.school_memberships
  where user_id=p_user_id and department_id=p_department_id and role=p_role;
  return v_result;
end;
$$;
revoke all on function public.assign_department_role(uuid,uuid,public.school_member_role) from public,anon;
grant execute on function public.assign_department_role(uuid,uuid,public.school_member_role) to authenticated;

comment on table public.school_report_operations is
  'Journal immuable des enrôlements complémentaires, corrections de dossiers, livraisons uniques et réimpressions.';
comment on column public.school_memberships.role is
  'Rôle attribué par département; un utilisateur peut cumuler plusieurs départements et plusieurs catégories.';


-- Replace the initial role-priority RPC: field permissions are checked independently,
-- so a user holding both category roles in one department can perform both workflows.
create or replace function public.save_school_report(p_pedagogical_group_id uuid,p_changes jsonb)
returns public.school_reports language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
declare
  v_school uuid; v_department uuid; v_report public.school_reports; v_key text;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if jsonb_typeof(p_changes)<>'object' or p_changes='{}'::jsonb then
    raise exception 'Un objet JSON non vide est obligatoire';
  end if;

  select g.school_id,s.department_id into v_school,v_department
  from public.pedagogical_groups g
  join public.schools s on s.id=g.school_id
  where g.id=p_pedagogical_group_id and s.is_active=true;
  if v_department is null or not public.has_department_access(v_department) then
    raise exception 'Accès au département refusé';
  end if;

  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('A','B','C','D','E','F','G','H','I','J','K','L') then
      raise exception 'Champ inconnu: %',v_key;
    end if;
    if v_key in ('E','H','I','J') then
      raise exception 'Le champ % est calculé par le système',v_key;
    end if;
    if v_key='G' and not public.is_central_admin() then
      raise exception 'Le champ G est réservé à l''administrateur central';
    end if;
    if v_key in ('A','B','C','D','F')
       and not public.is_central_admin()
       and not public.has_department_role(v_department,'CATEGORY_1') then
      raise exception 'Droit Catégorie 1 requis pour le champ %',v_key;
    end if;
    if v_key in ('K','L')
       and not public.is_central_admin()
       and not public.has_department_role(v_department,'CATEGORY_2') then
      raise exception 'Droit Catégorie 2 requis pour le champ %',v_key;
    end if;
  end loop;

  insert into public.school_reports as existing(
    school_id,school_year_id,pedagogical_group_id,report_data,created_by,updated_by
  )
  select g.school_id,g.school_year_id,g.id,p_changes,auth.uid(),auth.uid()
  from public.pedagogical_groups g
  where g.id=p_pedagogical_group_id
  on conflict(pedagogical_group_id) do update
    set report_data=existing.report_data||excluded.report_data,
        updated_by=auth.uid(),updated_at=now()
  returning * into v_report;

  insert into public.audit_events(
    actor_user_id,department_id,school_id,event_type,entity_table,record_id,details
  ) values (
    auth.uid(),v_department,v_school,'REPORT_FIELDS_SAVED','school_reports',v_report.id::text,
    jsonb_build_object('changed_fields',
      coalesce((select jsonb_agg(k) from jsonb_object_keys(p_changes) as keys(k)),'[]'::jsonb))
  );
  return v_report;
end;
$$;
revoke all on function public.save_school_report(uuid,jsonb) from public,anon;
grant execute on function public.save_school_report(uuid,jsonb) to authenticated;

-- System values are recalculated from the enrollment base and immutable operation ledger.
-- E = capacity - (initial enrollment + ratissage); I = unique deliveries;
-- corrections/reprints remain separate; J compares actual enrolled and uniquely delivered.
create or replace function public.refresh_school_report_system_data()
returns trigger language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_capacity integer;
  v_initial integer;
  v_ratisse integer;
  v_delivered integer;
  v_enrolled integer;
begin
  v_capacity := coalesce(nullif(new.report_data->>'C','')::integer,0);
  v_initial := coalesce(nullif(new.report_data->>'D','')::integer,0);

  select coalesce(sum(quantity),0)::integer into v_ratisse
  from public.school_report_operations
  where school_report_id=new.id and operation_type='ENROLLMENT_RATISSAGE';

  select coalesce(sum(quantity),0)::integer into v_delivered
  from public.school_report_operations
  where school_report_id=new.id
    and operation_type in ('DELIVERY_INITIAL','DELIVERY_RATISSAGE','DELIVERY_CORRECTION_FIRST_ISSUE');

  v_enrolled := v_initial+v_ratisse;
  new.system_data := jsonb_build_object(
    'E',v_capacity-v_enrolled,
    'H',new.report_data->'B',
    'I',v_delivered,
    'J',case when v_enrolled=0 and v_delivered=0 then to_jsonb(''::text)
             else to_jsonb(v_enrolled=v_delivered) end,
    'total_enrolled',v_enrolled,
    'total_delivered_unique',v_delivered,
    'enrollment_corrections',(
      select coalesce(sum(quantity),0) from public.school_report_operations
      where school_report_id=new.id and operation_type='ENROLLMENT_CORRECTION'
    ),
    'delivery_reprints',(
      select coalesce(sum(quantity),0) from public.school_report_operations
      where school_report_id=new.id and operation_type='DELIVERY_REPRINT'
    )
  );
  new.updated_at:=now();
  return new;
end;
$$;

create or replace function public.rebuild_school_report_system_data(p_report_id uuid)
returns void language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
begin
  update public.school_reports r
  set system_data=jsonb_build_object(
    'E',
      coalesce(nullif(r.report_data->>'C','')::integer,0)
      - coalesce(nullif(r.report_data->>'D','')::integer,0)
      - coalesce((select sum(o.quantity) from public.school_report_operations o
        where o.school_report_id=r.id and o.operation_type='ENROLLMENT_RATISSAGE'),0),
    'H',r.report_data->'B',
    'I',coalesce((select sum(o.quantity) from public.school_report_operations o
      where o.school_report_id=r.id and o.operation_type in
      ('DELIVERY_INITIAL','DELIVERY_RATISSAGE','DELIVERY_CORRECTION_FIRST_ISSUE')),0),
    'J',case
      when coalesce(nullif(r.report_data->>'D','')::integer,0)
        +coalesce((select sum(o.quantity) from public.school_report_operations o
          where o.school_report_id=r.id and o.operation_type='ENROLLMENT_RATISSAGE'),0)=0
      then to_jsonb(''::text)
      else to_jsonb(
        coalesce(nullif(r.report_data->>'D','')::integer,0)
        +coalesce((select sum(o.quantity) from public.school_report_operations o
          where o.school_report_id=r.id and o.operation_type='ENROLLMENT_RATISSAGE'),0)
        =
        coalesce((select sum(o.quantity) from public.school_report_operations o
          where o.school_report_id=r.id and o.operation_type in
          ('DELIVERY_INITIAL','DELIVERY_RATISSAGE','DELIVERY_CORRECTION_FIRST_ISSUE')),0)
      ) end,
    'total_enrolled',
      coalesce(nullif(r.report_data->>'D','')::integer,0)
      +coalesce((select sum(o.quantity) from public.school_report_operations o
        where o.school_report_id=r.id and o.operation_type='ENROLLMENT_RATISSAGE'),0),
    'total_delivered_unique',coalesce((select sum(o.quantity) from public.school_report_operations o
      where o.school_report_id=r.id and o.operation_type in
      ('DELIVERY_INITIAL','DELIVERY_RATISSAGE','DELIVERY_CORRECTION_FIRST_ISSUE')),0),
    'enrollment_corrections',coalesce((select sum(o.quantity) from public.school_report_operations o
      where o.school_report_id=r.id and o.operation_type='ENROLLMENT_CORRECTION'),0),
    'delivery_reprints',coalesce((select sum(o.quantity) from public.school_report_operations o
      where o.school_report_id=r.id and o.operation_type='DELIVERY_REPRINT'),0)
  )
  where r.id=p_report_id;
end;
$$;
revoke all on function public.rebuild_school_report_system_data(uuid) from public,anon,authenticated;

create or replace function public.refresh_after_school_report_operation()
returns trigger language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
begin
  perform public.rebuild_school_report_system_data(new.school_report_id);
  return new;
end;
$$;
create trigger school_report_operations_refresh_trg
after insert on public.school_report_operations
for each row execute function public.refresh_after_school_report_operation();

-- Ensure the public field documentation reflects the new computed I and the added correction ledgers.
comment on column public.school_reports.report_data is
  'Workbook source fields A,B,C,D,F,G,K,L. D is initial enrollment; I is system-computed from unique delivery operations.';
comment on column public.school_reports.system_data is
  'Calculated E=C-(D+enrollment ratissage), H=B, I=unique delivered total, J=actual enrollment equals unique delivered; corrections/reprints are separate.';


-- Legacy delivery-slip endpoints must not be usable by Category 1 accounts.
create or replace function public.guard_delivery_slip_category2()
returns trigger language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
declare v_department uuid;
begin
  select department_id into v_department from public.schools where id=new.school_id;
  if v_department is null then raise exception 'Établissement introuvable'; end if;
  if not public.is_central_admin()
     and not public.has_department_role(v_department,'CATEGORY_2') then
    raise exception 'Seule la Catégorie 2 peut enregistrer une livraison';
  end if;
  return new;
end;
$$;
create trigger delivery_slips_category2_guard_trg
before insert on public.delivery_slips
for each row execute function public.guard_delivery_slip_category2();

create or replace function public.guard_delivery_slip_line_category2()
returns trigger language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
declare v_department uuid;
begin
  select s.department_id into v_department
  from public.delivery_slips d join public.schools s on s.id=d.school_id
  where d.id=new.delivery_slip_id;
  if v_department is null then raise exception 'Bordereau introuvable'; end if;
  if not public.is_central_admin()
     and not public.has_department_role(v_department,'CATEGORY_2') then
    raise exception 'Seule la Catégorie 2 peut renseigner les quantités livrées';
  end if;
  return new;
end;
$$;
create trigger delivery_slip_lines_category2_guard_trg
before insert on public.delivery_slip_lines
for each row execute function public.guard_delivery_slip_line_category2();
