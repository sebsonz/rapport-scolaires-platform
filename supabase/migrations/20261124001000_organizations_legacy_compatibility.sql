-- ORGANIZATIONS-02
-- Preserve the existing delivery-slip workflow for approved users who have not
-- yet been assigned to an organization. Once assigned, organization snapshots
-- are captured and a suspended organization cannot issue new slips.
BEGIN;

CREATE OR REPLACE FUNCTION public.capture_delivery_slip_organization_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_organization public.organizations;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.organization_snapshot IS DISTINCT FROM OLD.organization_snapshot THEN
      RAISE EXCEPTION 'L''organisation émettrice et son identité historique ne peuvent pas être modifiées après création du bordereau';
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour créer un bordereau';
  END IF;

  -- Transitional compatibility: users not yet enrolled in an organization
  -- retain the pre-existing delivery-slip workflow. Do not trust a client-
  -- supplied organization identifier for an unassigned user.
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    WHERE om.user_id = auth.uid()
  ) THEN
    NEW.organization_id := NULL;
    NEW.organization_snapshot := '{}'::jsonb;
    RETURN NEW;
  END IF;

  SELECT o.* INTO v_organization
  FROM public.organization_memberships om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Affectation d''organisation introuvable. Contactez l''administration centrale.';
  END IF;

  IF v_organization.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Votre organisation est suspendue et ne peut pas émettre de nouveaux bordereaux';
  END IF;

  IF NEW.organization_id IS NOT NULL AND NEW.organization_id <> v_organization.id THEN
    RAISE EXCEPTION 'Un utilisateur ne peut émettre un bordereau qu''au nom de son organisation';
  END IF;

  NEW.organization_id := v_organization.id;
  NEW.organization_snapshot := jsonb_build_object(
    'id', v_organization.id,
    'code', v_organization.code,
    'legal_name', v_organization.legal_name,
    'short_name', v_organization.short_name,
    'logo_path', v_organization.logo_path,
    'address', v_organization.address,
    'phone', v_organization.phone,
    'email', v_organization.email,
    'country', v_organization.country,
    'tax_identifier', v_organization.tax_identifier,
    'website', v_organization.website,
    'captured_at', now()
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.capture_delivery_slip_organization_snapshot() IS
  'Captures immutable organization identity for assigned users while preserving legacy delivery-slip creation for users not yet assigned to an organization.';

COMMIT;
