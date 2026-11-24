-- GP = classe: one national class selected by a school is one pedagogical group.
-- Keep existing reports and operation history when a school removes a class from its active selection.

alter table public.pedagogical_groups
  add column if not exists is_active boolean not null default true;

create index if not exists pedagogical_groups_active_school_year_idx
  on public.pedagogical_groups(school_id, school_year_id, is_active, promotion_id);

create or replace function public.set_school_pedagogical_classes(
  p_school_id uuid,
  p_school_year_id uuid,
  p_promotion_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
set row_security = off
as $$
declare
  v_department_id uuid;
  v_promotion_id uuid;
  v_count integer := 0;
  v_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise';
  end if;

  select s.department_id into v_department_id
  from public.schools s
  where s.id = p_school_id and s.is_active = true;

  if v_department_id is null then
    raise exception 'Établissement introuvable ou inactif';
  end if;

  if not public.is_central_admin()
     and not public.has_department_role(v_department_id, 'CATEGORY_1') then
    raise exception 'Droit Catégorie 1 requis pour gérer les groupes pédagogiques';
  end if;

  if not exists (
    select 1 from public.school_years y
    where y.id = p_school_year_id and y.is_active = true
  ) then
    raise exception 'Sélectionnez une année scolaire active';
  end if;

  if coalesce(array_length(p_promotion_ids, 1), 0) > 0
     and exists (
       select 1
       from unnest(p_promotion_ids) selected(id)
       left join public.promotions p on p.id = selected.id and p.is_active = true
       where p.id is null
     ) then
    raise exception 'La sélection contient une classe absente ou inactive du référentiel national';
  end if;

  -- Disable classes removed from the selection. Their reports and ledger stay untouched.
  update public.pedagogical_groups g
  set is_active = false
  where g.school_id = p_school_id
    and g.school_year_id = p_school_year_id
    and g.is_active = true
    and not (g.promotion_id = any(coalesce(p_promotion_ids, '{}'::uuid[])));

  -- Reactivate an existing GP where possible; otherwise create exactly one GP for the class.
  foreach v_promotion_id in array coalesce(p_promotion_ids, '{}'::uuid[]) loop
    select g.id into v_group_id
    from public.pedagogical_groups g
    where g.school_id = p_school_id
      and g.school_year_id = p_school_year_id
      and g.promotion_id = v_promotion_id
    order by g.is_active desc, g.created_at asc
    limit 1;

    if v_group_id is null then
      insert into public.pedagogical_groups(
        school_id, school_year_id, promotion_id, group_code, is_active
      ) values (
        p_school_id, p_school_year_id, v_promotion_id, 'UNIQUE', true
      );
    else
      update public.pedagogical_groups
      set is_active = true
      where id = v_group_id and is_active = false;
    end if;
    v_count := v_count + 1;
  end loop;

  insert into public.audit_events(
    actor_user_id, department_id, school_id, event_type, entity_table, record_id, details
  ) values (
    auth.uid(), v_department_id, p_school_id, 'SCHOOL_PEDAGOGICAL_CLASSES_SYNCHRONIZED',
    'pedagogical_groups', p_school_year_id::text,
    jsonb_build_object(
      'school_year_id', p_school_year_id,
      'selected_promotion_ids', coalesce(to_jsonb(p_promotion_ids), '[]'::jsonb),
      'selected_count', v_count
    )
  );

  return v_count;
end;
$$;

revoke all on function public.set_school_pedagogical_classes(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.set_school_pedagogical_classes(uuid, uuid, uuid[])
  to authenticated;

-- Block all new or edited report/operation writes against a deactivated GP.
create or replace function public.guard_active_pedagogical_group()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_group_id uuid;
begin
  v_group_id := new.pedagogical_group_id;
  if not exists (
    select 1 from public.pedagogical_groups g
    where g.id = v_group_id and g.is_active = true
  ) then
    raise exception 'Ce groupe pédagogique est désactivé. Réactivez la classe avant toute nouvelle opération.';
  end if;
  return new;
end;
$$;

drop trigger if exists school_reports_active_group_guard on public.school_reports;
create trigger school_reports_active_group_guard
before insert or update on public.school_reports
for each row execute function public.guard_active_pedagogical_group();

drop trigger if exists school_report_operations_active_group_guard on public.school_report_operations;
create trigger school_report_operations_active_group_guard
before insert on public.school_report_operations
for each row execute function public.guard_active_pedagogical_group();

comment on column public.pedagogical_groups.is_active is
  'Indique si la classe/GP est actuellement sélectionnée par l’établissement pour cette année; false conserve intégralement son historique.';
comment on function public.set_school_pedagogical_classes(uuid, uuid, uuid[]) is
  'Synchronise la sélection des classes/GP d’un établissement pour une année scolaire; Catégorie 1 gère la sélection et les retraits sont des désactivations réversibles.';
