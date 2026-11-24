-- Audited correction of the first delivery entry.
-- Original DELIVERY_INITIAL ledger events remain immutable; the latest correction becomes the effective quantity.
create table public.school_report_delivery_initial_corrections (
  id uuid primary key default gen_random_uuid(),
  school_report_id uuid not null references public.school_reports(id) on delete cascade,
  pedagogical_group_id uuid not null references public.pedagogical_groups(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  department_id uuid not null references public.departments(id),
  school_year_id uuid not null references public.school_years(id),
  quantity integer not null check (quantity >= 0),
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create index school_report_delivery_initial_corrections_latest_idx
  on public.school_report_delivery_initial_corrections(school_report_id, created_at desc);

alter table public.school_report_delivery_initial_corrections enable row level security;
revoke all on public.school_report_delivery_initial_corrections from anon, authenticated;
grant select on public.school_report_delivery_initial_corrections to authenticated;
create policy school_report_delivery_initial_corrections_read
  on public.school_report_delivery_initial_corrections
  for select to authenticated
  using (public.has_department_access(department_id));

create or replace function public.prevent_school_report_delivery_correction_mutation()
returns trigger language plpgsql
as $$
begin
  raise exception 'L''historique des corrections de livraison est immuable';
end;
$$;

create trigger school_report_delivery_initial_corrections_immutable_trg
before update or delete on public.school_report_delivery_initial_corrections
for each row execute function public.prevent_school_report_delivery_correction_mutation();

create or replace function public.correct_school_report_initial_delivery(
  p_pedagogical_group_id uuid,
  p_quantity integer,
  p_note text default null
) returns public.school_report_delivery_initial_corrections
language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
declare
  v_report public.school_reports;
  v_school uuid;
  v_department uuid;
  v_year uuid;
  v_role_ok boolean;
  v_enrolled integer;
  v_other_deliveries integer;
  v_original_initial integer;
  v_result public.school_report_delivery_initial_corrections;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'La quantité corrigée doit être un entier positif ou zéro';
  end if;

  select g.school_id,g.school_year_id,s.department_id
    into v_school,v_year,v_department
  from public.pedagogical_groups g
  join public.schools s on s.id=g.school_id
  where g.id=p_pedagogical_group_id and s.is_active=true;

  if v_department is null or not public.has_department_access(v_department) then
    raise exception 'Accès au département refusé';
  end if;
  v_role_ok := public.is_central_admin()
    or public.has_department_role(v_department,'CATEGORY_2');
  if not v_role_ok then raise exception 'Droit Catégorie 2 requis pour corriger une livraison'; end if;

  select * into v_report
  from public.school_reports r
  where r.pedagogical_group_id=p_pedagogical_group_id
  for update;
  if not found then raise exception 'Aucun rapport initial n''existe pour cette classe'; end if;

  select coalesce(sum(o.quantity),0)::integer into v_original_initial
  from public.school_report_operations o
  where o.school_report_id=v_report.id and o.operation_type='DELIVERY_INITIAL';
  if v_original_initial <= 0 then
    raise exception 'Aucune livraison initiale enregistrée à modifier';
  end if;

  v_enrolled :=
    coalesce(nullif(v_report.report_data->>'D','')::integer,0)
    + coalesce((select sum(o.quantity)::integer from public.school_report_operations o
      where o.school_report_id=v_report.id and o.operation_type='ENROLLMENT_RATISSAGE'),0);

  select coalesce(sum(o.quantity),0)::integer into v_other_deliveries
  from public.school_report_operations o
  where o.school_report_id=v_report.id
    and o.operation_type in ('DELIVERY_RATISSAGE','DELIVERY_CORRECTION_FIRST_ISSUE');

  if p_quantity + v_other_deliveries > v_enrolled then
    raise exception 'La livraison initiale corrigée dépasserait le reste autorisé: maximum %, saisi %',
      greatest(v_enrolled-v_other_deliveries,0),p_quantity;
  end if;

  insert into public.school_report_delivery_initial_corrections(
    school_report_id,pedagogical_group_id,school_id,department_id,school_year_id,
    quantity,note,created_by
  ) values (
    v_report.id,p_pedagogical_group_id,v_school,v_department,v_year,
    p_quantity,nullif(trim(p_note),''),auth.uid()
  ) returning * into v_result;

  insert into public.audit_events(
    actor_user_id,department_id,school_id,event_type,entity_table,record_id,details
  ) values (
    auth.uid(),v_department,v_school,'SCHOOL_REPORT_INITIAL_DELIVERY_CORRECTED',
    'school_report_delivery_initial_corrections',v_result.id::text,
    jsonb_build_object('pedagogical_group_id',p_pedagogical_group_id,
      'previous_effective_quantity',coalesce((
        select c.quantity from public.school_report_delivery_initial_corrections c
        where c.school_report_id=v_report.id and c.id<>v_result.id
        order by c.created_at desc limit 1
      ),v_original_initial),
      'corrected_quantity',p_quantity)
  );

  return v_result;
end;
$$;

revoke all on function public.correct_school_report_initial_delivery(uuid,integer,text) from public,anon;
grant execute on function public.correct_school_report_initial_delivery(uuid,integer,text) to authenticated;


-- Keep the shared computed delivery total and subsequent delivery limits aligned with the latest correction.
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
  v_effective_initial_delivery integer;
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

  select * into v_report from public.school_reports r
  where r.pedagogical_group_id=p_pedagogical_group_id for update;
  if not found then raise exception 'La classe doit d''abord être créée et enregistrée par la Catégorie 1'; end if;

  select o.* into v_result from public.school_report_operations o
  where o.idempotency_key=p_idempotency_key and o.department_id=v_department;
  if found then return v_result; end if;

  v_capacity := coalesce(nullif(v_report.report_data->>'C','')::integer,0);
  v_initial := coalesce(nullif(v_report.report_data->>'D','')::integer,0);
  select coalesce(sum(quantity),0)::integer into v_enrollment_ratisse
  from public.school_report_operations
  where school_report_id=v_report.id and operation_type='ENROLLMENT_RATISSAGE';
  v_enrolled := v_initial + v_enrollment_ratisse;

  select coalesce(sum(o.quantity),0)::integer into v_effective_initial_delivery
  from public.school_report_operations o
  where o.school_report_id=v_report.id and o.operation_type='DELIVERY_INITIAL';
  select c.quantity into v_effective_initial_delivery
  from public.school_report_delivery_initial_corrections c
  where c.school_report_id=v_report.id order by c.created_at desc limit 1;

  select coalesce(sum(quantity),0)::integer into v_delivered
  from public.school_report_operations
  where school_report_id=v_report.id
    and operation_type in ('DELIVERY_RATISSAGE','DELIVERY_CORRECTION_FIRST_ISSUE');
  v_delivered := v_delivered + coalesce(v_effective_initial_delivery,0);

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

-- Rebuild computed column I using the effective initial delivery value.
create or replace function public.rebuild_school_report_system_data(p_report_id uuid)
returns void language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
declare
  v_initial_delivery integer;
  v_other_deliveries integer;
  v_enrolled integer;
  v_capacity integer;
begin
  select coalesce(nullif(r.report_data->>'C','')::integer,0),
         coalesce(nullif(r.report_data->>'D','')::integer,0)
    into v_capacity,v_enrolled
  from public.school_reports r where r.id=p_report_id;
  if not found then return; end if;

  v_enrolled := v_enrolled + coalesce((
    select sum(o.quantity)::integer from public.school_report_operations o
    where o.school_report_id=p_report_id and o.operation_type='ENROLLMENT_RATISSAGE'
  ),0);

  select coalesce(sum(o.quantity),0)::integer into v_initial_delivery
  from public.school_report_operations o
  where o.school_report_id=p_report_id and o.operation_type='DELIVERY_INITIAL';
  select c.quantity into v_initial_delivery
  from public.school_report_delivery_initial_corrections c
  where c.school_report_id=p_report_id order by c.created_at desc limit 1;

  select coalesce(sum(o.quantity),0)::integer into v_other_deliveries
  from public.school_report_operations o
  where o.school_report_id=p_report_id
    and o.operation_type in ('DELIVERY_RATISSAGE','DELIVERY_CORRECTION_FIRST_ISSUE');

  update public.school_reports r
  set system_data = r.system_data || jsonb_build_object(
    'E',v_capacity-v_enrolled,
    'I',coalesce(v_initial_delivery,0)+v_other_deliveries,
    'total_enrolled',v_enrolled,
    'total_delivered_unique',coalesce(v_initial_delivery,0)+v_other_deliveries
  )
  where r.id=p_report_id;
end;
$$;
revoke all on function public.rebuild_school_report_system_data(uuid) from public,anon,authenticated;

create or replace function public.refresh_after_initial_delivery_correction()
returns trigger language plpgsql security definer
set search_path=public,pg_temp set row_security=off
as $$
begin
  perform public.rebuild_school_report_system_data(new.school_report_id);
  return new;
end;
$$;

create trigger school_report_initial_delivery_correction_refresh_trg
after insert on public.school_report_delivery_initial_corrections
for each row execute function public.refresh_after_initial_delivery_correction();
