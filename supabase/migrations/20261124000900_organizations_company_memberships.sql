-- ORGANIZATIONS-01
-- Company identity, one active organization per approved user, immutable assignment history,
-- and organization branding snapshots for school delivery slips.
BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.organization_code_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  legal_name text NOT NULL,
  short_name text,
  logo_path text,
  address text,
  phone text,
  email text,
  country text NOT NULL DEFAULT 'Bénin',
  tax_identifier text,
  website text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(legal_name)) BETWEEN 2 AND 180),
  CHECK (short_name IS NULL OR length(trim(short_name)) <= 60),
  CHECK (address IS NULL OR length(trim(address)) <= 300),
  CHECK (phone IS NULL OR length(trim(phone)) <= 40),
  CHECK (email IS NULL OR length(trim(email)) <= 254),
  CHECK (country IS NOT NULL AND length(trim(country)) BETWEEN 2 AND 100),
  CHECK (tax_identifier IS NULL OR length(trim(tax_identifier)) <= 80),
  CHECK (website IS NULL OR length(trim(website)) <= 300),
  CHECK (logo_path IS NULL OR length(logo_path) <= 500)
);

CREATE INDEX IF NOT EXISTS organizations_status_name_idx
  ON public.organizations(status, legal_name);

CREATE TABLE IF NOT EXISTS public.organization_memberships (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES auth.users(id),
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_memberships_organization_idx
  ON public.organization_memberships(organization_id, assigned_at DESC);

CREATE TABLE IF NOT EXISTS public.organization_membership_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('ASSIGNED','REMOVED')),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organization_membership_events_org_created_idx
  ON public.organization_membership_events(organization_id, created_at DESC);

ALTER TABLE public.delivery_slips
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS organization_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.delivery_slips
  DROP CONSTRAINT IF EXISTS delivery_slips_organization_snapshot_object_check;
ALTER TABLE public.delivery_slips
  ADD CONSTRAINT delivery_slips_organization_snapshot_object_check
  CHECK (jsonb_typeof(organization_snapshot) = 'object');

COMMENT ON COLUMN public.delivery_slips.organization_id IS
  'Organization that issued this delivery slip. Null is retained for legacy slips created before ORGANIZATIONS-01.';
COMMENT ON COLUMN public.delivery_slips.organization_snapshot IS
  'Immutable issuer identity snapshot (name, logo, address and contacts) captured when the slip is created.';

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

  SELECT o.* INTO v_organization
  FROM public.organization_memberships om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.user_id = auth.uid()
    AND o.status = 'ACTIVE';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Affectez ce compte à une organisation active avant de créer un bordereau';
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

DROP TRIGGER IF EXISTS delivery_slips_organization_snapshot_trg ON public.delivery_slips;
CREATE TRIGGER delivery_slips_organization_snapshot_trg
BEFORE INSERT OR UPDATE OF organization_id, organization_snapshot
ON public.delivery_slips
FOR EACH ROW EXECUTE FUNCTION public.capture_delivery_slip_organization_snapshot();

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_membership_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.organizations, public.organization_memberships,
  public.organization_membership_events FROM anon, authenticated;
GRANT SELECT ON public.organizations, public.organization_memberships,
  public.organization_membership_events TO authenticated;

DROP POLICY IF EXISTS organizations_read_admin_or_member ON public.organizations;
CREATE POLICY organizations_read_admin_or_member
  ON public.organizations FOR SELECT TO authenticated
  USING (
    public.is_central_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships om
      WHERE om.organization_id = organizations.id
        AND om.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS organization_memberships_read_admin_or_self ON public.organization_memberships;
CREATE POLICY organization_memberships_read_admin_or_self
  ON public.organization_memberships FOR SELECT TO authenticated
  USING (public.is_central_admin() OR user_id = auth.uid());

DROP POLICY IF EXISTS organization_membership_events_read_admin ON public.organization_membership_events;
CREATE POLICY organization_membership_events_read_admin
  ON public.organization_membership_events FOR SELECT TO authenticated
  USING (public.is_central_admin());

CREATE OR REPLACE FUNCTION public.prevent_organization_membership_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'L''historique des affectations d''organisation est immuable';
END;
$$;

DROP TRIGGER IF EXISTS organization_membership_events_immutable_trg
  ON public.organization_membership_events;
CREATE TRIGGER organization_membership_events_immutable_trg
BEFORE UPDATE OR DELETE ON public.organization_membership_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_organization_membership_event_mutation();

CREATE OR REPLACE FUNCTION public.admin_save_organization(
  p_organization_id uuid,
  p_legal_name text,
  p_short_name text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_country text DEFAULT 'Bénin',
  p_tax_identifier text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_logo_path text DEFAULT NULL
)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, storage, pg_temp
SET row_security = off
AS $$
DECLARE
  v_organization public.organizations;
  v_before jsonb;
  v_logo_path text := nullif(trim(coalesce(p_logo_path, '')), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_central_admin() THEN
    RAISE EXCEPTION 'Action réservée à l''administration centrale';
  END IF;

  IF nullif(trim(coalesce(p_legal_name, '')), '') IS NULL
     OR length(trim(p_legal_name)) > 180
     OR length(trim(coalesce(p_short_name, ''))) > 60
     OR length(trim(coalesce(p_address, ''))) > 300
     OR length(trim(coalesce(p_phone, ''))) > 40
     OR length(trim(coalesce(p_email, ''))) > 254
     OR length(trim(coalesce(p_country, 'Bénin'))) NOT BETWEEN 2 AND 100
     OR length(trim(coalesce(p_tax_identifier, ''))) > 80
     OR length(trim(coalesce(p_website, ''))) > 300 THEN
    RAISE EXCEPTION 'Certaines informations de l''organisation sont invalides ou trop longues';
  END IF;

  IF v_logo_path IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'organization-logos' AND name = v_logo_path
  ) THEN
    RAISE EXCEPTION 'Le fichier du logo est introuvable dans le stockage de la plateforme';
  END IF;

  IF p_organization_id IS NULL THEN
    INSERT INTO public.organizations(
      code, legal_name, short_name, logo_path, address, phone, email,
      country, tax_identifier, website, created_by, updated_by
    )
    VALUES (
      'ORG-' || lpad(nextval('public.organization_code_seq')::text, 4, '0'),
      trim(p_legal_name),
      nullif(trim(coalesce(p_short_name, '')), ''),
      v_logo_path,
      nullif(trim(coalesce(p_address, '')), ''),
      nullif(trim(coalesce(p_phone, '')), ''),
      nullif(trim(coalesce(p_email, '')), ''),
      coalesce(nullif(trim(p_country), ''), 'Bénin'),
      nullif(trim(coalesce(p_tax_identifier, '')), ''),
      nullif(trim(coalesce(p_website, '')), ''),
      auth.uid(), auth.uid()
    )
    RETURNING * INTO v_organization;

    INSERT INTO public.audit_events(
      actor_user_id, event_type, entity_table, record_id, details
    )
    VALUES (
      auth.uid(), 'ORGANIZATION_CREATED', 'organizations', v_organization.id::text,
      jsonb_build_object('after', to_jsonb(v_organization))
    );
  ELSE
    SELECT to_jsonb(o) INTO v_before
    FROM public.organizations o
    WHERE o.id = p_organization_id
    FOR UPDATE;

    IF v_before IS NULL THEN
      RAISE EXCEPTION 'Organisation introuvable';
    END IF;

    UPDATE public.organizations
    SET legal_name = trim(p_legal_name),
        short_name = nullif(trim(coalesce(p_short_name, '')), ''),
        logo_path = v_logo_path,
        address = nullif(trim(coalesce(p_address, '')), ''),
        phone = nullif(trim(coalesce(p_phone, '')), ''),
        email = nullif(trim(coalesce(p_email, '')), ''),
        country = coalesce(nullif(trim(p_country), ''), 'Bénin'),
        tax_identifier = nullif(trim(coalesce(p_tax_identifier, '')), ''),
        website = nullif(trim(coalesce(p_website, '')), ''),
        updated_by = auth.uid(),
        updated_at = now()
    WHERE id = p_organization_id
    RETURNING * INTO v_organization;

    INSERT INTO public.audit_events(
      actor_user_id, event_type, entity_table, record_id, details
    )
    VALUES (
      auth.uid(), 'ORGANIZATION_UPDATED', 'organizations', v_organization.id::text,
      jsonb_build_object('before', v_before, 'after', to_jsonb(v_organization))
    );
  END IF;

  RETURN v_organization;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_organization_status(
  p_organization_id uuid,
  p_is_active boolean,
  p_reason text DEFAULT NULL
)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_organization public.organizations;
  v_previous_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_central_admin() THEN
    RAISE EXCEPTION 'Action réservée à l''administration centrale';
  END IF;
  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'Le statut demandé est obligatoire';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) > 500 THEN
    RAISE EXCEPTION 'Le motif ne peut pas dépasser 500 caractères';
  END IF;

  SELECT status INTO v_previous_status
  FROM public.organizations
  WHERE id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organisation introuvable'; END IF;

  UPDATE public.organizations
  SET status = CASE WHEN p_is_active THEN 'ACTIVE' ELSE 'SUSPENDED' END,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE id = p_organization_id
  RETURNING * INTO v_organization;

  INSERT INTO public.audit_events(
    actor_user_id, event_type, entity_table, record_id, details
  )
  VALUES (
    auth.uid(),
    CASE WHEN p_is_active THEN 'ORGANIZATION_REACTIVATED' ELSE 'ORGANIZATION_SUSPENDED' END,
    'organizations', v_organization.id::text,
    jsonb_build_object(
      'previous_status', v_previous_status,
      'new_status', v_organization.status,
      'reason', nullif(trim(coalesce(p_reason, '')), '')
    )
  );

  RETURN v_organization;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_organization_user(
  p_organization_id uuid,
  p_user_id uuid
)
RETURNS public.organization_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_organization public.organizations;
  v_membership public.organization_memberships;
  v_request_status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_central_admin() THEN
    RAISE EXCEPTION 'Action réservée à l''administration centrale';
  END IF;

  SELECT * INTO v_organization
  FROM public.organizations
  WHERE id = p_organization_id AND status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Organisation introuvable ou suspendue'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Compte utilisateur introuvable';
  END IF;

  SELECT status::text INTO v_request_status
  FROM public.access_requests
  WHERE user_id = p_user_id;
  IF NOT FOUND OR v_request_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Seuls les utilisateurs dont le compte a été validé peuvent être affectés';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organization_memberships WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Cet utilisateur appartient déjà à une organisation. Retirez d''abord son affectation actuelle.';
  END IF;

  INSERT INTO public.organization_memberships(user_id, organization_id, assigned_by)
  VALUES (p_user_id, p_organization_id, auth.uid())
  RETURNING * INTO v_membership;

  INSERT INTO public.organization_membership_events(
    user_id, organization_id, event_type, actor_user_id, details
  )
  VALUES (
    p_user_id, p_organization_id, 'ASSIGNED', auth.uid(),
    jsonb_build_object('assigned_at', v_membership.assigned_at)
  );

  INSERT INTO public.audit_events(
    actor_user_id, event_type, entity_table, record_id, details
  )
  VALUES (
    auth.uid(), 'ORGANIZATION_USER_ASSIGNED', 'organization_memberships', p_user_id::text,
    jsonb_build_object('organization_id', p_organization_id, 'user_id', p_user_id)
  );

  RETURN v_membership;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_organization_user(
  p_organization_id uuid,
  p_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
DECLARE
  v_membership public.organization_memberships;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_central_admin() THEN
    RAISE EXCEPTION 'Action réservée à l''administration centrale';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) > 500 THEN
    RAISE EXCEPTION 'Le motif ne peut pas dépasser 500 caractères';
  END IF;

  DELETE FROM public.organization_memberships
  WHERE user_id = p_user_id AND organization_id = p_organization_id
  RETURNING * INTO v_membership;

  IF NOT FOUND THEN RAISE EXCEPTION 'Affectation introuvable'; END IF;

  INSERT INTO public.organization_membership_events(
    user_id, organization_id, event_type, actor_user_id, details
  )
  VALUES (
    p_user_id, p_organization_id, 'REMOVED', auth.uid(),
    jsonb_build_object(
      'assigned_at', v_membership.assigned_at,
      'removed_at', now(),
      'reason', nullif(trim(coalesce(p_reason, '')), '')
    )
  );

  INSERT INTO public.audit_events(
    actor_user_id, event_type, entity_table, record_id, details
  )
  VALUES (
    auth.uid(), 'ORGANIZATION_USER_REMOVED', 'organization_memberships', p_user_id::text,
    jsonb_build_object(
      'organization_id', p_organization_id,
      'user_id', p_user_id,
      'reason', nullif(trim(coalesce(p_reason, '')), '')
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_organization_branding()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
SET row_security = off
AS $$
  SELECT CASE WHEN o.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', o.id,
    'code', o.code,
    'legal_name', o.legal_name,
    'short_name', o.short_name,
    'logo_path', o.logo_path,
    'address', o.address,
    'phone', o.phone,
    'email', o.email,
    'country', o.country,
    'tax_identifier', o.tax_identifier,
    'website', o.website,
    'status', o.status
  ) END
  FROM (SELECT auth.uid() AS user_id) actor_context
  LEFT JOIN public.organization_memberships om ON om.user_id = actor_context.user_id
  LEFT JOIN public.organizations o ON o.id = om.organization_id;
$$;

REVOKE ALL ON FUNCTION public.admin_save_organization(uuid,text,text,text,text,text,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_organization_status(uuid,boolean,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_assign_organization_user(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_remove_organization_user(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_organization_branding()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_save_organization(uuid,text,text,text,text,text,text,text,text,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_organization_status(uuid,boolean,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_organization_user(uuid,uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_organization_user(uuid,uuid,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_organization_branding()
  TO authenticated;

DO $storage_setup$
BEGIN
  -- Supabase provides these Storage relations. The plain PostgreSQL CI harness does not,
  -- so skip only the Storage bucket/policies there while still testing the organization schema.
  IF to_regclass('storage.buckets') IS NOT NULL
     AND to_regclass('storage.objects') IS NOT NULL THEN
    INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'organization-logos',
      'organization-logos',
      true,
      5242880,
      ARRAY['image/png','image/jpeg','image/webp','image/svg+xml']
    )
    ON CONFLICT (id) DO UPDATE
    SET public = EXCLUDED.public,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

    EXECUTE 'DROP POLICY IF EXISTS organization_logos_admin_insert ON storage.objects';
    EXECUTE 'CREATE POLICY organization_logos_admin_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = ''organization-logos'' AND public.is_central_admin())';
    EXECUTE 'DROP POLICY IF EXISTS organization_logos_admin_update ON storage.objects';
    EXECUTE 'CREATE POLICY organization_logos_admin_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = ''organization-logos'' AND public.is_central_admin()) WITH CHECK (bucket_id = ''organization-logos'' AND public.is_central_admin())';
    EXECUTE 'DROP POLICY IF EXISTS organization_logos_admin_delete ON storage.objects';
    EXECUTE 'CREATE POLICY organization_logos_admin_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = ''organization-logos'' AND public.is_central_admin())';
  ELSE
    RAISE NOTICE 'Supabase Storage is not present in this PostgreSQL test environment; skipping logo bucket setup.';
  END IF;
END;
$storage_setup$;

COMMENT ON TABLE public.organizations IS
  'Identité métier et visuelle des compagnies qui émettent les bordereaux de livraison.';
COMMENT ON TABLE public.organization_memberships IS
  'Affectation courante : un utilisateur validé appartient à une seule organisation à la fois.';
COMMENT ON TABLE public.organization_membership_events IS
  'Historique immuable des affectations et retraits des utilisateurs des organisations.';

COMMIT;
