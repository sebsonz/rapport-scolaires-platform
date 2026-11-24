-- LOCATION-CATALOG-01: expose the minimal active-school location catalogue
-- independently from Category 1 / Category 2 memberships.
-- Report, group, entry and operation data remain protected by their existing RLS.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_school_location_filter_catalog()
RETURNS TABLE (
  department_id uuid,
  department_code text,
  department_name text,
  commune_id uuid,
  commune_code text,
  commune_name text,
  school_id uuid,
  school_code text,
  school_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
  SELECT
    d.id,
    d.code,
    d.name,
    c.id,
    c.code,
    c.name,
    s.id,
    s.code,
    s.name
  FROM public.schools s
  JOIN public.departments d
    ON d.id = s.department_id
  LEFT JOIN public.communes c
    ON c.id = s.commune_id
   AND c.department_id = s.department_id
   AND c.is_active = true
  WHERE auth.uid() IS NOT NULL
    AND s.is_active = true
    AND (
      public.is_central_admin()
      OR EXISTS (
        SELECT 1
        FROM public.school_memberships m
        WHERE m.user_id = auth.uid()
          AND m.department_id = s.department_id
      )
    )
  ORDER BY d.name, c.name NULLS LAST, s.name;
$$;

REVOKE ALL ON FUNCTION public.get_school_location_filter_catalog()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_school_location_filter_catalog()
  TO authenticated;

COMMENT ON FUNCTION public.get_school_location_filter_catalog() IS
  'Returns only department, active commune and active school identifiers/codes/names for departments assigned to the authenticated user; CENTRAL_ADMIN sees all departments. Category 1 / Category 2 roles do not filter the geographic catalogue. Does not expose report data or grant access to school operations; those remain governed by existing RLS and role checks.';

COMMIT;
