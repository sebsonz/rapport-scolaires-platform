-- DELIVERY-SLIPS-01
-- Explicit creator role and secure submit / validation workflow.
BEGIN;

ALTER TABLE public.delivery_slips
  ADD COLUMN IF NOT EXISTS creator_role text;

ALTER TABLE public.delivery_slips
  DROP CONSTRAINT IF EXISTS delivery_slips_creator_role_check;
ALTER TABLE public.delivery_slips
  ADD CONSTRAINT delivery_slips_creator_role_check
  CHECK (creator_role IS NULL OR creator_role IN ('CENTRAL_ADMIN', 'CATEGORY_1', 'CATEGORY_2'));

COMMENT ON COLUMN public.delivery_slips.creator_role IS
  'Role explicitly used by the creator for this slip; determines whether central validation is mandatory. Legacy rows may be null.';

CREATE OR REPLACE FUNCTION public.create_delivery_slip_v2(
  p_school_id uuid,
  p_school_year_id uuid,
  p_slip_number text,
  p_delivery_date date,
  p_creator_role text,
  p_observations text DEFAULT NULL,
  p_responsible_agent text DEFAULT NULL
)
RETURNS public.delivery_slips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_department uuid;
  v_result public.delivery_slips;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  IF p_creator_role NOT IN ('CENTRAL_ADMIN', 'CATEGORY_1', 'CATEGORY_2') THEN
    RAISE EXCEPTION 'Rôle créateur invalide';
  END IF;

  SELECT department_id INTO v_department
  FROM public.schools
  WHERE id = p_school_id AND is_active = true;

  IF v_department IS NULL THEN
    RAISE EXCEPTION 'Établissement introuvable ou inactif';
  END IF;

  IF p_creator_role = 'CENTRAL_ADMIN' THEN
    IF NOT public.is_central_admin() THEN
      RAISE EXCEPTION 'Seul un administrateur central peut créer au nom de ce rôle';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.school_memberships m
      WHERE m.user_id = auth.uid()
        AND m.department_id = v_department
        AND m.role::text = p_creator_role
    ) THEN
      RAISE EXCEPTION 'Vous ne possédez pas ce rôle dans le département de cet établissement';
    END IF;
  END IF;

  IF nullif(trim(coalesce(p_slip_number, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Le numéro du bordereau est obligatoire';
  END IF;

  INSERT INTO public.delivery_slips(
    school_id, school_year_id, slip_number, delivery_date,
    observations, responsible_agent, created_by, creator_role
  )
  VALUES (
    p_school_id, p_school_year_id, trim(p_slip_number), p_delivery_date,
    nullif(trim(coalesce(p_observations, '')), ''),
    nullif(trim(coalesce(p_responsible_agent, '')), ''),
    auth.uid(), p_creator_role
  )
  RETURNING * INTO v_result;

  INSERT INTO public.audit_events(
    actor_user_id, department_id, school_id, event_type, entity_table, record_id, details
  )
  VALUES (
    auth.uid(), v_department, p_school_id, 'DELIVERY_SLIP_CREATED',
    'delivery_slips', v_result.id::text,
    jsonb_build_object('creator_role', p_creator_role, 'slip_number', v_result.slip_number)
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_delivery_slip_v2(uuid,uuid,text,date,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_delivery_slip_v2(uuid,uuid,text,date,text,text,text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_delivery_slip(p_delivery_slip_id uuid)
RETURNS public.delivery_slips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_slip public.delivery_slips;
  v_department uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT d.* INTO v_slip
  FROM public.delivery_slips d
  WHERE d.id = p_delivery_slip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bordereau introuvable';
  END IF;

  SELECT department_id INTO v_department
  FROM public.schools
  WHERE id = v_slip.school_id;

  IF v_slip.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Seul un brouillon peut être soumis';
  END IF;

  IF v_slip.created_by <> auth.uid() AND NOT public.is_central_admin() THEN
    RAISE EXCEPTION 'Seul le créateur ou un administrateur central peut soumettre ce bordereau';
  END IF;

  IF NOT public.has_department_access(v_department) THEN
    RAISE EXCEPTION 'Accès au département refusé';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.delivery_slip_lines l
    WHERE l.delivery_slip_id = p_delivery_slip_id
  ) THEN
    RAISE EXCEPTION 'Ajoutez au moins une ligne avant de soumettre le bordereau';
  END IF;

  UPDATE public.delivery_slips
  SET status = 'SUBMITTED'
  WHERE id = p_delivery_slip_id
  RETURNING * INTO v_slip;

  INSERT INTO public.audit_events(
    actor_user_id, department_id, school_id, event_type, entity_table, record_id, details
  )
  VALUES (
    auth.uid(), v_department, v_slip.school_id, 'DELIVERY_SLIP_SUBMITTED',
    'delivery_slips', v_slip.id::text,
    jsonb_build_object('creator_role', v_slip.creator_role, 'status', v_slip.status)
  );

  RETURN v_slip;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_delivery_slip(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_delivery_slip(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_delivery_slip(p_delivery_slip_id uuid)
RETURNS public.delivery_slips
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_slip public.delivery_slips;
  v_department uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_central_admin() THEN
    RAISE EXCEPTION 'Seule l’administration centrale peut valider un bordereau';
  END IF;

  SELECT d.* INTO v_slip
  FROM public.delivery_slips d
  WHERE d.id = p_delivery_slip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bordereau introuvable';
  END IF;

  SELECT department_id INTO v_department
  FROM public.schools
  WHERE id = v_slip.school_id;

  IF v_slip.creator_role <> 'CATEGORY_2' THEN
    RAISE EXCEPTION 'La validation administrative est réservée aux bordereaux créés en catégorie 2';
  END IF;

  IF v_slip.status <> 'SUBMITTED' THEN
    RAISE EXCEPTION 'Seul un bordereau soumis peut être validé';
  END IF;

  UPDATE public.delivery_slips
  SET status = 'VALIDATED',
      validated_by = auth.uid(),
      validated_at = now()
  WHERE id = p_delivery_slip_id
  RETURNING * INTO v_slip;

  INSERT INTO public.audit_events(
    actor_user_id, department_id, school_id, event_type, entity_table, record_id, details
  )
  VALUES (
    auth.uid(), v_department, v_slip.school_id, 'DELIVERY_SLIP_VALIDATED',
    'delivery_slips', v_slip.id::text,
    jsonb_build_object('creator_user_id', v_slip.created_by, 'creator_role', v_slip.creator_role)
  );

  RETURN v_slip;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_delivery_slip(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_delivery_slip(uuid) TO authenticated;

COMMIT;
