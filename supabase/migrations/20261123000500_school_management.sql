-- SCHOOLS-01: school directory managed exclusively by the central administrator.
create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on update restrict on delete restrict,
  code text not null,
  name text not null,
  commune text not null,
  arrondissement text,
  locality text,
  phone text,
  director_name text,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schools_code_nonempty check (length(trim(code)) between 1 and 30),
  constraint schools_name_nonempty check (length(trim(name)) between 2 and 160),
  constraint schools_commune_nonempty check (length(trim(commune)) between 2 and 120),
  constraint schools_arrondissement_length check (arrondissement is null or length(arrondissement) <= 120),
  constraint schools_locality_length check (locality is null or length(locality) <= 240),
  constraint schools_phone_length check (phone is null or length(phone) <= 40),
  constraint schools_director_length check (director_name is null or length(director_name) <= 160)
);

create unique index if not exists schools_department_code_uidx
  on public.schools(department_id, upper(trim(code)));
create index if not exists schools_department_active_name_idx
  on public.schools(department_id, is_active, name);

alter table public.schools enable row level security;
revoke all on public.schools from anon, authenticated;
grant select on public.schools to authenticated;

drop policy if exists schools_read_authorized_department on public.schools;
create policy schools_read_authorized_department
  on public.schools for select to authenticated
  using (
    public.is_central_admin()
    or exists (
      select 1 from public.school_memberships sm
      where sm.user_id = auth.uid()
        and sm.department_id = schools.department_id
        and sm.role in ('CATEGORY_1','CATEGORY_2')
    )
  );

create or replace function public.admin_save_school(
  p_school_id uuid,
  p_department_id uuid,
  p_code text,
  p_name text,
  p_commune text,
  p_arrondissement text default null,
  p_locality text default null,
  p_phone text default null,
  p_director_name text default null
)
returns public.schools
language plpgsql
security definer
set search_path = public, auth, pg_temp
set row_security = off
as $$
declare
  v_school public.schools;
begin
  if auth.uid() is null or not public.is_central_admin() then
    raise exception 'Action réservée à l’administration centrale';
  end if;
  if p_department_id is null or not exists (
    select 1 from public.departments d where d.id = p_department_id
  ) then
    raise exception 'Sélectionnez un département valide';
  end if;
  if nullif(trim(p_code), '') is null
     or length(trim(p_code)) > 30
     or nullif(trim(p_name), '') is null
     or length(trim(p_name)) > 160
     or nullif(trim(p_commune), '') is null
     or length(trim(p_commune)) > 120 then
    raise exception 'Le code, le nom de l’école et la commune sont obligatoires et doivent respecter les longueurs autorisées';
  end if;

  if p_school_id is null then
    insert into public.schools(
      department_id, code, name, commune, arrondissement, locality,
      phone, director_name, created_by
    ) values (
      p_department_id, upper(trim(p_code)), trim(p_name), trim(p_commune),
      nullif(trim(coalesce(p_arrondissement, '')), ''),
      nullif(trim(coalesce(p_locality, '')), ''),
      nullif(trim(coalesce(p_phone, '')), ''),
      nullif(trim(coalesce(p_director_name, '')), ''),
      auth.uid()
    ) returning * into v_school;

    insert into public.audit_events(actor_user_id, department_id, event_type, entity_table, record_id, details)
    values(auth.uid(), v_school.department_id, 'SCHOOL_CREATED', 'schools', v_school.id::text,
      jsonb_build_object('code',v_school.code,'name',v_school.name,'commune',v_school.commune));
  else
    update public.schools
    set department_id = p_department_id,
        code = upper(trim(p_code)),
        name = trim(p_name),
        commune = trim(p_commune),
        arrondissement = nullif(trim(coalesce(p_arrondissement, '')), ''),
        locality = nullif(trim(coalesce(p_locality, '')), ''),
        phone = nullif(trim(trim(coalesce(p_phone, ''))), ''),
        director_name = nullif(trim(coalesce(p_director_name, '')), ''),
        updated_at = now()
    where id = p_school_id
    returning * into v_school;
    if not found then raise exception 'École introuvable'; end if;

    insert into public.audit_events(actor_user_id, department_id, event_type, entity_table, record_id, details)
    values(auth.uid(), v_school.department_id, 'SCHOOL_UPDATED', 'schools', v_school.id::text,
      jsonb_build_object('code',v_school.code,'name',v_school.name,'commune',v_school.commune));
  end if;
  return v_school;
end;
$$;

create or replace function public.admin_set_school_status(
  p_school_id uuid,
  p_is_active boolean
)
returns public.schools
language plpgsql
security definer
set search_path = public, auth, pg_temp
set row_security = off
as $$
declare
  v_school public.schools;
begin
  if auth.uid() is null or not public.is_central_admin() then
    raise exception 'Action réservée à l’administration centrale';
  end if;
  if p_is_active is null then raise exception 'Statut invalide'; end if;

  update public.schools
  set is_active = p_is_active, updated_at = now()
  where id = p_school_id
  returning * into v_school;
  if not found then raise exception 'École introuvable'; end if;

  insert into public.audit_events(actor_user_id, department_id, event_type, entity_table, record_id, details)
  values(auth.uid(), v_school.department_id,
    case when p_is_active then 'SCHOOL_ACTIVATED' else 'SCHOOL_DEACTIVATED' end,
    'schools', v_school.id::text,
    jsonb_build_object('code',v_school.code,'name',v_school.name,'is_active',v_school.is_active));

  return v_school;
end;
$$;

revoke all on function public.admin_save_school(uuid,uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.admin_set_school_status(uuid,boolean) from public, anon, authenticated;
grant execute on function public.admin_save_school(uuid,uuid,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.admin_set_school_status(uuid,boolean) to authenticated;

comment on table public.schools is
  'School directory. Mutations are restricted to central-admin SECURITY DEFINER RPCs; department users have read-only access within their assignments.';
