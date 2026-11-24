-- DELIVERY-SLIPS-02
-- Immutable creator identity snapshot for printed delivery slips.
BEGIN;

ALTER TABLE public.delivery_slips
  ADD COLUMN IF NOT EXISTS creator_full_name text;

CREATE OR REPLACE FUNCTION public.capture_delivery_slip_creator_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_full_name text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.creator_full_name IS DISTINCT FROM OLD.creator_full_name THEN
      RAISE EXCEPTION 'L''identite du createur du bordereau est immuable';
    END IF;
    RETURN NEW;
  END IF;

  SELECT nullif(trim(up.full_name), '')
    INTO v_full_name
  FROM public.user_profiles up
  WHERE up.user_id = NEW.created_by;

  IF v_full_name IS NULL THEN
    RAISE EXCEPTION 'Le nom complet du createur est introuvable dans son profil';
  END IF;

  NEW.creator_full_name := v_full_name;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS delivery_slips_creator_identity_trg ON public.delivery_slips;
CREATE TRIGGER delivery_slips_creator_identity_trg
BEFORE INSERT OR UPDATE OF creator_full_name
ON public.delivery_slips
FOR EACH ROW
EXECUTE FUNCTION public.capture_delivery_slip_creator_identity();

COMMENT ON COLUMN public.delivery_slips.creator_full_name IS
  'Snapshot immuable du nom complet du createur, capture depuis user_profiles a la creation.';

COMMIT;
