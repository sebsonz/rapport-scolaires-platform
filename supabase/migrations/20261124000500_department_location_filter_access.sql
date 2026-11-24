-- FIX-LOCATION-01: make department visibility use the same authoritative
-- access predicate as schools, reports and other department-scoped resources.
-- CENTRAL_ADMIN is unrestricted; CATEGORY_1/CATEGORY_2 see assigned departments only.

drop policy if exists departments_read on public.departments;
drop policy if exists departments_read_authorized on public.departments;

create policy departments_read_authorized
  on public.departments
  for select
  to authenticated
  using (public.has_department_access(departments.id));

comment on policy departments_read_authorized on public.departments is
  'CENTRAL_ADMIN can read every department; CATEGORY_1/CATEGORY_2 can read only departments assigned through school_memberships.';
