-- AUTH-02: central administration RPCs.
-- All privileged mutations run server-side with explicit CENTRAL_ADMIN checks.
-- Browser clients never receive direct write privileges on memberships, departments or audit events.

create or replace function public.admin_get_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,auth,pg_temp
set row_security=off
as $$
declare v_result jsonb;
begin
  if not public.is_central_admin() then
    raise exception 'Accès réservé à l’administration centrale';
  end if;

  select jsonb_build_object(
    'users_total', (select count(*) from public.user_profiles),
    'requests_pending', (select count(*) from public.access_requests where status='PENDING'),
    'requests_approved', (select count(*) from public.access_requests where status='APPROVED'),
    'requests_rejected', (select count(*) from public.access_requests where status='REJECTED'),
    'departments_total', (select count(*) from public.departments),
    'memberships_total', (select count(*) from public.school_memberships where role <> 'CENTRAL_ADMIN'),
    'recent_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ar.id, 'user_id', ar.user_id, 'full_name', p.full_name,
        'email', p.email, 'status', ar.status, 'requested_at', ar.requested_at
      ) order by ar.requested_at desc)
      from (
        select * from public.access_requests
        order by requested_at desc limit 8
      ) ar
      join public.user_profiles p on p.user_id=ar.user_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_review_access_request(
  p_user_id uuid,
  p_decision text,
  p_review_note text default null,
  p_assignments jsonb default '[]'::jsonb
)
returns public.access_requests
language plpgsql
security definer
set search_path=public,auth,pg_temp
set row_security=off
as $$
declare
  v_request public.access_requests;
  v_assignment record;
  v_count integer := 0;
  v_is_central boolean;
begin
  if auth.uid() is null or not public.is_central_admin() then
    raise exception 'Action réservée à l’administration centrale';
  end if;
  if p_decision not in ('APPROVED','REJECTED') then
    raise exception 'Décision invalide';
  end if;
  if jsonb_typeof(coalesce(p_assignments,'[]'::jsonb)) <> 'array' then
    raise exception 'Les affectations doivent être un tableau JSON';
  end if;
  if p_decision='REJECTED' and jsonb_array_length(coalesce(p_assignments,'[]'::jsonb)) > 0 then
    raise exception 'Une demande rejetée ne peut recevoir d’affectation';
  end if;

  perform 1 from auth.users u
    where u.id=p_user_id and u.email_confirmed_at is not null;
  if not found then
    raise exception 'Utilisateur introuvable ou adresse email non confirmée';
  end if;

  select exists(
    select 1 from public.school_memberships
    where user_id=p_user_id and role='CENTRAL_ADMIN'
  ) into v_is_central;
  if v_is_central then
    raise exception 'Le compte administrateur central ne peut pas être traité comme une demande standard';
  end if;

  select * into v_request
  from public.access_requests
  where user_id=p_user_id
  for update;
  if not found then raise exception 'Demande d’accès introuvable'; end if;
  if v_request.status <> 'PENDING' then
    raise exception 'Cette demande a déjà été traitée';
  end if;

  if p_decision='APPROVED' then
    if jsonb_array_length(coalesce(p_assignments,'[]'::jsonb)) = 0 then
      raise exception 'Attribuez au moins un département et un rôle avant approbation';
    end if;

    for v_assignment in
      select department_id, role
      from jsonb_to_recordset(p_assignments)
        as x(department_id uuid, role text)
    loop
      if v_assignment.department_id is null
         or coalesce(v_assignment.role,'') not in ('CATEGORY_1','CATEGORY_2') then
        raise exception 'Affectation invalide: seuls CATEGORY_1 et CATEGORY_2 sont autorisés';
      end if;
      if not exists(select 1 from public.departments d where d.id=v_assignment.department_id) then
        raise exception 'Département inexistant: %', v_assignment.department_id;
      end if;
      v_count := v_count + 1;
    end loop;
    if v_count <> jsonb_array_length(p_assignments) then
      raise exception 'Une ou plusieurs affectations sont invalides';
    end if;

    if exists (
      select 1
      from jsonb_to_recordset(p_assignments) as x(department_id uuid, role text)
      group by department_id, role having count(*) > 1
    ) then
      raise exception 'Une affectation département/rôle est dupliquée';
    end if;

    insert into public.school_memberships(user_id,department_id,role)
    select p_user_id, x.department_id, x.role::public.school_member_role
    from jsonb_to_recordset(p_assignments) as x(department_id uuid, role text);
  end if;

  update public.access_requests
  set status=p_decision,
      reviewed_at=now(),
      reviewed_by=auth.uid(),
      review_note=nullif(trim(coalesce(p_review_note,'')),'')
  where user_id=p_user_id
  returning * into v_request;

  insert into public.audit_events(
    actor_user_id,event_type,entity_table,record_id,details
  ) values (
    auth.uid(),
    case when p_decision='APPROVED' then 'ACCESS_REQUEST_APPROVED' else 'ACCESS_REQUEST_REJECTED' end,
    'access_requests',v_request.id::text,
    jsonb_build_object('target_user_id',p_user_id,'assignment_count',v_count,'review_note',p_review_note)
  );

  return v_request;
end;
$$;

create or replace function public.admin_set_user_assignments(
  p_user_id uuid,
  p_assignments jsonb
)
returns integer
language plpgsql
security definer
set search_path=public,auth,pg_temp
set row_security=off
as $$
declare
  v_assignment record;
  v_count integer := 0;
begin
  if auth.uid() is null or not public.is_central_admin() then
    raise exception 'Action réservée à l’administration centrale';
  end if;
  if jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'Les affectations doivent être un tableau JSON';
  end if;
  if exists(select 1 from public.school_memberships where user_id=p_user_id and role='CENTRAL_ADMIN') then
    raise exception 'Les affectations du compte administrateur central sont protégées';
  end if;
  if not exists(select 1 from public.user_profiles where user_id=p_user_id) then
    raise exception 'Utilisateur introuvable';
  end if;
  if not exists(select 1 from public.access_requests where user_id=p_user_id and status='APPROVED') then
    raise exception 'Seuls les comptes approuvés peuvent recevoir des affectations';
  end if;

  for v_assignment in
    select department_id, role
    from jsonb_to_recordset(p_assignments)
      as x(department_id uuid, role text)
  loop
    if v_assignment.department_id is null
       or coalesce(v_assignment.role,'') not in ('CATEGORY_1','CATEGORY_2')
       or not exists(select 1 from public.departments where id=v_assignment.department_id) then
      raise exception 'Affectation invalide';
    end if;
    v_count := v_count + 1;
  end loop;

  if v_count <> jsonb_array_length(p_assignments) then
    raise exception 'Une ou plusieurs affectations sont invalides';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_assignments) as x(department_id uuid, role text)
    group by department_id,role having count(*)>1
  ) then
    raise exception 'Affectation département/rôle dupliquée';
  end if;

  delete from public.school_memberships
  where user_id=p_user_id and role in ('CATEGORY_1','CATEGORY_2');

  insert into public.school_memberships(user_id,department_id,role)
  select p_user_id,x.department_id,x.role::public.school_member_role
  from jsonb_to_recordset(p_assignments) as x(department_id uuid,role text);

  insert into public.audit_events(actor_user_id,event_type,entity_table,record_id,details)
  values(auth.uid(),'USER_ASSIGNMENTS_UPDATED','school_memberships',p_user_id::text,
    jsonb_build_object('assignment_count',v_count,'assignments',p_assignments));

  return v_count;
end;
$$;

create or replace function public.admin_save_department(
  p_department_id uuid,
  p_code text,
  p_name text
)
returns public.departments
language plpgsql
security definer
set search_path=public,pg_temp
set row_security=off
as $$
declare v_department public.departments;
begin
  if auth.uid() is null or not public.is_central_admin() then
    raise exception 'Action réservée à l’administration centrale';
  end if;
  if nullif(trim(p_code),'') is null or nullif(trim(p_name),'') is null then
    raise exception 'Le code et le nom du département sont obligatoires';
  end if;
  if length(trim(p_code)) > 30 or length(trim(p_name)) > 120 then
    raise exception 'Code ou nom trop long';
  end if;

  if p_department_id is null then
    insert into public.departments(code,name)
    values(upper(trim(p_code)),trim(p_name))
    returning * into v_department;
    insert into public.audit_events(actor_user_id,event_type,entity_table,record_id,details)
    values(auth.uid(),'DEPARTMENT_CREATED','departments',v_department.id::text,
      jsonb_build_object('code',v_department.code,'name',v_department.name));
  else
    update public.departments
    set code=upper(trim(p_code)),name=trim(p_name)
    where id=p_department_id
    returning * into v_department;
    if not found then raise exception 'Département introuvable'; end if;
    insert into public.audit_events(actor_user_id,department_id,event_type,entity_table,record_id,details)
    values(auth.uid(),v_department.id,'DEPARTMENT_UPDATED','departments',v_department.id::text,
      jsonb_build_object('code',v_department.code,'name',v_department.name));
  end if;
  return v_department;
end;
$$;

revoke all on function public.admin_get_overview() from public,anon,authenticated;
revoke all on function public.admin_review_access_request(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.admin_set_user_assignments(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.admin_save_department(uuid,text,text) from public,anon,authenticated;

grant execute on function public.admin_get_overview() to authenticated;
grant execute on function public.admin_review_access_request(uuid,text,text,jsonb) to authenticated;
grant execute on function public.admin_set_user_assignments(uuid,jsonb) to authenticated;
grant execute on function public.admin_save_department(uuid,text,text) to authenticated;

comment on function public.admin_review_access_request(uuid,text,text,jsonb) is
  'Central-admin-only atomic approval/rejection with department role assignments and audit trail.';
comment on function public.admin_set_user_assignments(uuid,jsonb) is
  'Central-admin-only replacement of CATEGORY_1/CATEGORY_2 assignments; CENTRAL_ADMIN is protected.';
