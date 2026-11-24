-- SCHOOL-COMMUNES-02: migrate school management to the commune reference catalogue.
-- Existing commune text is retained for backward compatibility and auditability.
BEGIN;

ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS commune_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'schools_commune_id_fkey'
      AND conrelid = 'public.schools'::regclass
  ) THEN
    ALTER TABLE public.schools
      ADD CONSTRAINT schools_commune_id_fkey
      FOREIGN KEY (commune_id)
      REFERENCES public.communes(id)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_schools_commune_id
  ON public.schools(commune_id);

-- Backfill only exact department-scoped matches; never overwrite an existing reference.
UPDATE public.schools s
SET commune_id = c.id
FROM public.communes c
WHERE s.commune_id IS NULL
  AND c.department_id = s.department_id
  AND lower(trim(c.name)) = lower(trim(s.commune));

-- Replace the legacy text RPC signature with the validated commune-id signature.
DROP FUNCTION IF EXISTS public.admin_save_school(
  uuid, uuid, text, text, text, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.admin_save_school(
  p_school_id uuid,
  p_department_id uuid,
  p_code text,
  p_name text,
  p_commune_id uuid,
  p_arrondissement text DEFAULT NULL,
  p_locality text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_director_name text DEFAULT NULL
)
RETURNS public.schools
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_school public.schools;
  v_commune_name text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_central_admin() THEN
    RAISE EXCEPTION 'Action réservée à l’administration centrale';
  END IF;

  IF p_department_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.departments d WHERE d.id = p_department_id
  ) THEN
    RAISE EXCEPTION 'Sélectionnez un département valide';
  END IF;

  SELECT c.name
    INTO v_commune_name
  FROM public.communes c
  WHERE c.id = p_commune_id
    AND c.department_id = p_department_id
    AND c.is_active = true;

  IF v_commune_name IS NULL THEN
    RAISE EXCEPTION 'Sélectionnez une commune active appartenant au département choisi';
  END IF;

  IF nullif(trim(p_code), '') IS NULL
     OR length(trim(p_code)) > 30
     OR nullif(trim(p_name), '') IS NULL
     OR length(trim(p_name)) > 160 THEN
    RAISE EXCEPTION 'Le code et le nom de l’école sont obligatoires et doivent respecter les longueurs autorisées';
  END IF;

  IF p_school_id IS NULL THEN
    INSERT INTO public.schools(
      department_id, code, name, commune_id, commune,
      arrondissement, locality, phone, director_name, created_by
    ) VALUES (
      p_department_id,
      upper(trim(p_code)),
      trim(p_name),
      p_commune_id,
      v_commune_name,
      nullif(trim(coalesce(p_arrondissement, '')), ''),
      nullif(trim(coalesce(p_locality, '')), ''),
      nullif(trim(coalesce(p_phone, '')), ''),
      nullif(trim(coalesce(p_director_name, '')), ''),
      auth.uid()
    )
    RETURNING * INTO v_school;

    INSERT INTO public.audit_events(
      actor_user_id, department_id, event_type, entity_table, record_id, details
    )
    VALUES (
      auth.uid(), v_school.department_id, 'SCHOOL_CREATED', 'schools', v_school.id::text,
      jsonb_build_object(
        'code', v_school.code,
        'name', v_school.name,
        'commune_id', v_school.commune_id,
        'commune', v_school.commune
      )
    );
  ELSE
    UPDATE public.schools
    SET department_id = p_department_id,
        code = upper(trim(p_code)),
        name = trim(p_name),
        commune_id = p_commune_id,
        commune = v_commune_name,
        arrondissement = nullif(trim(coalesce(p_arrondissement, '')), ''),
        locality = nullif(trim(coalesce(p_locality, '')), ''),
        phone = nullif(trim(coalesce(p_phone, '')), ''),
        director_name = nullif(trim(coalesce(p_director_name, '')), ''),
        updated_at = now()
    WHERE id = p_school_id
    RETURNING * INTO v_school;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'École introuvable';
    END IF;

    INSERT INTO public.audit_events(
      actor_user_id, department_id, event_type, entity_table, record_id, details
    )
    VALUES (
      auth.uid(), v_school.department_id, 'SCHOOL_UPDATED', 'schools', v_school.id::text,
      jsonb_build_object(
        'code', v_school.code,
        'name', v_school.name,
        'commune_id', v_school.commune_id,
        'commune', v_school.commune
      )
    );
  END IF;

  RETURN v_school;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_school(
  uuid, uuid, text, text, uuid, text, text, text, text
) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_save_school(
  uuid, uuid, text, text, uuid, text, text, text, text
) TO authenticated;

COMMENT ON COLUMN public.schools.commune_id IS
  'Canonical commune reference. The legacy commune text column is retained and synchronized by admin_save_school during the compatibility period.';

COMMIT;
