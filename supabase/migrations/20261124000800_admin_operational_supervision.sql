-- ADMIN-SUPERVISION-01
-- Read-only operational overview for the central administration.
-- Reuses existing school reports, pedagogical groups, immutable operations and correction ledger.
-- No new business tables and no change to existing RLS policies.

create or replace function public.admin_get_operational_supervision(
  p_school_year_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
set row_security = off
as $$
declare
  v_year_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null or not public.is_central_admin() then
    raise exception 'Accès réservé à l’administration centrale';
  end if;

  if p_school_year_id is null then
    select y.id into v_year_id
    from public.school_years y
    where y.is_active = true
    order by y.starts_on desc nulls last, y.created_at desc
    limit 1;
  else
    select y.id into v_year_id
    from public.school_years y
    where y.id = p_school_year_id;
  end if;

  if p_school_year_id is not null and v_year_id is null then
    raise exception 'Année scolaire introuvable';
  end if;

  with active_schools as (
    select s.id, s.department_id, s.code, s.name
    from public.schools s
    where s.is_active = true
  ),
  group_rows as (
    select
      g.id as group_id,
      g.school_id,
      g.school_year_id,
      g.promotion_id,
      g.group_code,
      r.id as report_id,
      coalesce(nullif(r.report_data->>'C','')::bigint,0) as capacity,
      coalesce(nullif(r.report_data->>'D','')::bigint,0) as initial_enrolled,
      coalesce(o.enrollment_ratissage,0) as enrollment_ratissage,
      coalesce(o.enrollment_corrections,0) as enrollment_corrections,
      coalesce(o.delivery_initial,0) as original_delivery_initial,
      coalesce(c.quantity,o.delivery_initial,0) as delivery_initial,
      coalesce(o.delivery_ratissage,0) as delivery_ratissage,
      coalesce(o.delivery_correction,0) as delivery_correction,
      coalesce(o.delivery_reprints,0) as delivery_reprints
    from public.pedagogical_groups g
    join active_schools s on s.id = g.school_id
    left join public.school_reports r
      on r.pedagogical_group_id = g.id
      and r.school_id = g.school_id
      and r.school_year_id = g.school_year_id
    left join lateral (
      select
        coalesce(sum(x.quantity) filter (where x.operation_type='ENROLLMENT_RATISSAGE'),0)::bigint as enrollment_ratissage,
        coalesce(sum(x.quantity) filter (where x.operation_type='ENROLLMENT_CORRECTION'),0)::bigint as enrollment_corrections,
        coalesce(sum(x.quantity) filter (where x.operation_type='DELIVERY_INITIAL'),0)::bigint as delivery_initial,
        coalesce(sum(x.quantity) filter (where x.operation_type='DELIVERY_RATISSAGE'),0)::bigint as delivery_ratissage,
        coalesce(sum(x.quantity) filter (where x.operation_type='DELIVERY_CORRECTION_FIRST_ISSUE'),0)::bigint as delivery_correction,
        coalesce(sum(x.quantity) filter (where x.operation_type='DELIVERY_REPRINT'),0)::bigint as delivery_reprints
      from public.school_report_operations x
      where x.school_report_id = r.id
    ) o on true
    left join lateral (
      select dc.quantity
      from public.school_report_delivery_initial_corrections dc
      where dc.school_report_id = r.id
      order by dc.created_at desc, dc.id desc
      limit 1
    ) c on true
    where v_year_id is not null
      and g.school_year_id = v_year_id
      and g.is_active = true
  ),
  school_rollup as (
    select
      s.id as school_id,
      s.department_id,
      s.code as school_code,
      s.name as school_name,
      count(gr.group_id)::bigint as groups_count,
      count(gr.report_id)::bigint as reports_count,
      coalesce(sum(gr.capacity),0)::bigint as capacity,
      coalesce(sum(gr.initial_enrolled),0)::bigint as enrollment_initial,
      coalesce(sum(gr.enrollment_ratissage),0)::bigint as enrollment_ratissage,
      coalesce(sum(gr.initial_enrolled + gr.enrollment_ratissage),0)::bigint as enrolled,
      coalesce(sum(gr.enrollment_corrections),0)::bigint as enrollment_corrections,
      coalesce(sum(gr.delivery_initial + gr.delivery_ratissage + gr.delivery_correction),0)::bigint as delivered_unique,
      coalesce(sum(gr.delivery_reprints),0)::bigint as reprints,
      coalesce(sum(gr.delivery_initial),0)::bigint as delivery_initial,
      coalesce(sum(gr.delivery_ratissage),0)::bigint as delivery_ratissage,
      coalesce(sum(gr.delivery_correction),0)::bigint as delivery_correction
    from active_schools s
    left join group_rows gr on gr.school_id = s.id
    group by s.id,s.department_id,s.code,s.name
  ),
  department_rollup as (
    select
      d.id as department_id,
      d.code as department_code,
      d.name as department_name,
      count(sr.school_id)::bigint as schools_count,
      coalesce(sum(sr.groups_count),0)::bigint as groups_count,
      coalesce(sum(sr.reports_count),0)::bigint as reports_count,
      coalesce(sum(sr.capacity),0)::bigint as capacity,
      coalesce(sum(sr.enrollment_initial),0)::bigint as enrollment_initial,
      coalesce(sum(sr.enrollment_ratissage),0)::bigint as enrollment_ratissage,
      coalesce(sum(sr.enrolled),0)::bigint as enrolled,
      coalesce(sum(sr.enrollment_corrections),0)::bigint as enrollment_corrections,
      coalesce(sum(sr.delivered_unique),0)::bigint as delivered_unique,
      coalesce(sum(sr.reprints),0)::bigint as reprints,
      coalesce(sum(sr.delivery_initial),0)::bigint as delivery_initial,
      coalesce(sum(sr.delivery_ratissage),0)::bigint as delivery_ratissage,
      coalesce(sum(sr.delivery_correction),0)::bigint as delivery_correction
    from public.departments d
    left join school_rollup sr on sr.department_id = d.id
    group by d.id,d.code,d.name
  )
  select jsonb_build_object(
    'school_year', (
      select case when y.id is null then null else
        jsonb_build_object('id',y.id,'code',y.code,'label',y.label,'is_active',y.is_active)
      end
      from (select v_year_id as id) selected
      left join public.school_years y on y.id=selected.id
    ),
    'totals', jsonb_build_object(
      'departments', (select count(*) from public.departments),
      'active_schools', (select count(*) from active_schools),
      'groups', coalesce((select sum(groups_count) from school_rollup),0),
      'reports', coalesce((select sum(reports_count) from school_rollup),0),
      'capacity', coalesce((select sum(capacity) from school_rollup),0),
      'enrollment_initial', coalesce((select sum(enrollment_initial) from school_rollup),0),
      'enrollment_ratissage', coalesce((select sum(enrollment_ratissage) from school_rollup),0),
      'enrolled', coalesce((select sum(enrolled) from school_rollup),0),
      'enrollment_corrections', coalesce((select sum(enrollment_corrections) from school_rollup),0),
      'delivered_unique', coalesce((select sum(delivered_unique) from school_rollup),0),
      'reprints', coalesce((select sum(reprints) from school_rollup),0),
      'enrollment_remaining', coalesce((select sum(capacity-enrolled) from school_rollup),0),
      'delivery_remaining', coalesce((select sum(enrolled-delivered_unique) from school_rollup),0),
      'anomalies', coalesce((select count(*) from school_rollup where enrolled>capacity or delivered_unique>enrolled),0)
    ),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'department_id',department_id,'code',department_code,'name',department_name,
        'schools',schools_count,'groups',groups_count,'reports',reports_count,
        'capacity',capacity,'enrollment_initial',enrollment_initial,'enrollment_ratissage',enrollment_ratissage,'enrolled',enrolled,
        'enrollment_corrections',enrollment_corrections,
        'delivered_unique',delivered_unique,'reprints',reprints,
        'delivery_initial',delivery_initial,'delivery_ratissage',delivery_ratissage,
        'delivery_correction',delivery_correction,
        'enrollment_rate',case when capacity>0 and enrolled<=capacity then round(enrolled::numeric*100/capacity,2) else null end,
        'delivery_rate',case when enrolled>0 and delivered_unique<=enrolled and enrolled<=capacity then round(delivered_unique::numeric*100/enrolled,2) else null end,
        'anomalies',(case when enrolled>capacity then 1 else 0 end)+(case when delivered_unique>enrolled then 1 else 0 end)
      ) order by department_name)
      from department_rollup
    ), '[]'::jsonb),
    'schools', coalesce((
      select jsonb_agg(jsonb_build_object(
        'school_id',school_id,'department_id',department_id,
        'code',school_code,'name',school_name,
        'groups',groups_count,'reports',reports_count,'capacity',capacity,
        'enrollment_initial',enrollment_initial,'enrollment_ratissage',enrollment_ratissage,
        'enrolled',enrolled,'delivery_initial',delivery_initial,'delivery_ratissage',delivery_ratissage,
        'delivery_correction',delivery_correction,'delivered_unique',delivered_unique,'reprints',reprints,
        'enrollment_remaining',capacity-enrolled,
        'delivery_remaining',enrolled-delivered_unique
      ) order by school_name)
      from school_rollup
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_get_operational_supervision(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_operational_supervision(uuid) to authenticated;

comment on function public.admin_get_operational_supervision(uuid) is
  'Read-only central supervision of active schools, pedagogical groups, reports and operation ledger for a school year. Includes latest audited initial-delivery correction; does not grant write access.';
