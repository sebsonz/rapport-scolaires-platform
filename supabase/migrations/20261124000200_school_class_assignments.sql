-- SCHOOL-CLASSES-01: let Category 1 select the classes actually present in each school report.
-- Reuses pedagogical_groups as the school/year/class/group assignment; no parallel table is introduced.

-- Ensure the project has a current school year for the initial 2026-2027 rollout.
insert into public.school_years(code,label,starts_on,ends_on,is_active)
select '2026-2027','2026–2027',date '2026-09-01',date '2027-08-31',true
where not exists (select 1 from public.school_years where is_active = true)
on conflict (code) do nothing;

create index if not exists pedagogical_groups_school_year_idx
  on public.pedagogical_groups(school_id,school_year_id,promotion_id);

create or replace function public.category1_add_school_class_group(
  p_school_id uuid,
  p_school_year_id uuid,
  p_promotion_id uuid,
  p_group_code text
)
returns public.pedagogical_groups
language plpgsql
security definer
set search_path = public, auth, pg_temp
set row_security = off
as $$
declare
  v_department_id uuid;
  v_group public.pedagogical_groups;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;

  v_code := upper(trim(coalesce(p_group_code, '')));
  if length(v_code) < 1 or length(v_code) > 30 then
    raise exception 'Le code du groupe est obligatoire (1 à 30 caractères)';
  end if;

  select s.department_id
    into v_department_id
  from public.schools s
  where s.id = p_school_id
    and s.is_active = true;

  if v_department_id is null then
    raise exception 'Établissement introuvable ou inactif';
  end if;

  if not public.has_department_role(v_department_id, 'CATEGORY_1') then
    raise exception 'Droit Catégorie 1 requis pour configurer les classes de cet établissement';
  end if;

  if not exists (
    select 1 from public.school_years y
    where y.id = p_school_year_id and y.is_active = true
  ) then
    raise exception 'Sélectionnez une année scolaire active';
  end if;

  if not exists (
    select 1 from public.promotions p
    where p.id = p_promotion_id and p.is_active = true
  ) then
    raise exception 'Cette classe n’est plus disponible dans le catalogue national';
  end if;

  insert into public.pedagogical_groups(school_id,school_year_id,promotion_id,group_code)
  values(p_school_id,p_school_year_id,p_promotion_id,v_code)
  returning * into v_group;

  insert into public.audit_events(
    actor_user_id,department_id,school_id,event_type,entity_table,record_id,details
  ) values (
    auth.uid(),v_department_id,p_school_id,'SCHOOL_CLASS_GROUP_CREATED',
    'pedagogical_groups',v_group.id::text,
    jsonb_build_object(
      'school_year_id',p_school_year_id,
      'promotion_id',p_promotion_id,
      'group_code',v_code
    )
  );

  return v_group;
exception
  when unique_violation then
    raise exception 'Ce groupe existe déjà pour cette classe, cette école et cette année scolaire';
end;
$$;

revoke all on function public.category1_add_school_class_group(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.category1_add_school_class_group(uuid,uuid,uuid,text)
  to authenticated;

comment on function public.category1_add_school_class_group(uuid,uuid,uuid,text) is
  'Creates a school/year/class pedagogical group. Only Category 1 assigned to the school department may create it; inactive catalogue classes cannot be newly selected.';
