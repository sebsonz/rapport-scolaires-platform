-- DELIVERY-SLIPS-05
-- Unified administrative lifecycle, immutable audit snapshots and shared recount rules.
-- Apply after DELIVERY-SLIPS-01..04. This migration is NOT applied automatically.

-- PostgreSQL requires a newly-added enum value to be committed before it is used.
ALTER TYPE public.delivery_status ADD VALUE IF NOT EXISTS 'ARCHIVED';

BEGIN;

-- One canonical definition of quantities already reserved/delivered by slips.
-- CANCELLED documents are released; ARCHIVED documents remain counted.
CREATE OR REPLACE FUNCTION public.delivery_slip_active_statuses()
RETURNS public.delivery_status[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT ARRAY[
    'DRAFT'::public.delivery_status,
    'SUBMITTED'::public.delivery_status,
    'VALIDATED'::public.delivery_status,
    'ARCHIVED'::public.delivery_status
  ];
$$;

CREATE OR REPLACE FUNCTION public.get_delivery_slip_group_totals(
  p_school_id uuid,
  p_school_year_id uuid
)
RETURNS TABLE(
  pedagogical_group_id uuid,
  promotion_id uuid,
  group_code text,
  already_slipped bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp
SET row_security=off
AS $$
  SELECT
    g.id,
    g.promotion_id,
    g.group_code,
    COALESCE(SUM(l.quantity_delivered),0)::bigint
  FROM public.pedagogical_groups g
  LEFT JOIN public.delivery_slip_lines l
    ON (
      l.source_pedagogical_group_id = g.id
      OR (
        l.source_pedagogical_group_id IS NULL
        AND l.promotion_id = g.promotion_id
        AND l.group_code = g.group_code
      )
    )
  LEFT JOIN public.delivery_slips d
    ON d.id = l.delivery_slip_id
   AND d.school_id = p_school_id
   AND d.school_year_id = p_school_year_id
   AND d.status = ANY(public.delivery_slip_active_statuses())
  WHERE g.school_id = p_school_id
    AND g.school_year_id = p_school_year_id
  GROUP BY g.id,g.promotion_id,g.group_code;
$$;

REVOKE ALL ON FUNCTION public.get_delivery_slip_group_totals(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_delivery_slip_group_totals(uuid,uuid) TO authenticated;

-- Rebuild candidate RPC around the canonical recount helper. Legacy manual lines
-- (source_pedagogical_group_id IS NULL) are matched by promotion + group code.
CREATE OR REPLACE FUNCTION public.get_automatic_delivery_slip_candidates(
  p_school_id uuid,
  p_school_year_id uuid
)
RETURNS TABLE(
  pedagogical_group_id uuid,
  promotion_id uuid,
  promotion_label text,
  group_code text,
  current_delivered bigint,
  already_slipped bigint,
  available_to_slip bigint,
  has_report boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,auth,pg_temp
SET row_security=off
AS $$
DECLARE v_department uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentification requise'; END IF;
  SELECT department_id INTO v_department
  FROM public.schools WHERE id=p_school_id AND is_active=true;
  IF v_department IS NULL OR NOT public.has_department_access(v_department) THEN
    RAISE EXCEPTION 'Accès à cet établissement refusé';
  END IF;
  IF NOT public.is_central_admin()
     AND NOT public.has_department_role(v_department,'CATEGORY_2') THEN
    RAISE EXCEPTION 'La génération automatique est réservée à la Catégorie 2';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.school_years WHERE id=p_school_year_id) THEN
    RAISE EXCEPTION 'Année scolaire introuvable';
  END IF;

  RETURN QUERY
  WITH src AS (
    SELECT
      g.id AS gid,
      g.promotion_id,
      g.group_code,
      p.label,
      r.id IS NOT NULL AS report_exists,
      (
        COALESCE(
          (SELECT c.quantity
           FROM public.school_report_delivery_initial_corrections c
           WHERE c.school_report_id=r.id
           ORDER BY c.created_at DESC LIMIT 1),
          (SELECT SUM(o.quantity)
           FROM public.school_report_operations o
           WHERE o.school_report_id=r.id
             AND o.operation_type='DELIVERY_INITIAL'),
          0
        )
        + COALESCE(
          (SELECT SUM(o.quantity)
           FROM public.school_report_operations o
           WHERE o.school_report_id=r.id
             AND o.operation_type IN('DELIVERY_RATISSAGE','DELIVERY_CORRECTION_FIRST_ISSUE')),
          0
        )
      )::bigint AS delivered
    FROM public.pedagogical_groups g
    JOIN public.promotions p ON p.id=g.promotion_id
    LEFT JOIN public.school_reports r ON r.pedagogical_group_id=g.id
    WHERE g.school_id=p_school_id AND g.school_year_id=p_school_year_id
  )
  SELECT
    s.gid,s.promotion_id,s.label,s.group_code,s.delivered,
    COALESCE(t.already_slipped,0),
    s.delivered-COALESCE(t.already_slipped,0),
    s.report_exists
  FROM src s
  LEFT JOIN public.get_delivery_slip_group_totals(p_school_id,p_school_year_id) t
    ON t.pedagogical_group_id=s.gid
  WHERE s.report_exists
  ORDER BY s.label,s.group_code;
END;
$$;

REVOKE ALL ON FUNCTION public.get_automatic_delivery_slip_candidates(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_automatic_delivery_slip_candidates(uuid,uuid) TO authenticated;

-- Admin-only state changes for BOTH manual and automatic documents.
CREATE OR REPLACE FUNCTION public.admin_transition_delivery_slip(
  p_delivery_slip_id uuid,
  p_action text,
  p_reason text
)
RETURNS public.delivery_slips
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,auth,pg_temp
SET row_security=off
AS $$
DECLARE
  v_slip public.delivery_slips;
  v_department uuid;
  v_previous_status text;
  v_next_status public.delivery_status;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_central_admin() THEN
    RAISE EXCEPTION 'Action réservée à l’administration centrale';
  END IF;
  IF p_action NOT IN ('CANCEL','ARCHIVE') THEN
    RAISE EXCEPTION 'Action administrative invalide';
  END IF;
  IF nullif(trim(coalesce(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Un motif est obligatoire';
  END IF;

  SELECT * INTO v_slip FROM public.delivery_slips
  WHERE id=p_delivery_slip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bordereau introuvable'; END IF;

  v_previous_status:=v_slip.status::text;
  IF p_action='CANCEL' THEN
    IF v_slip.status='CANCELLED' THEN RAISE EXCEPTION 'Ce bordereau est déjà annulé'; END IF;
    v_next_status:='CANCELLED';
  ELSE
    IF v_slip.status='CANCELLED' THEN
      RAISE EXCEPTION 'Un bordereau annulé ne peut pas être archivé';
    END IF;
    IF v_slip.status='ARCHIVED' THEN RAISE EXCEPTION 'Ce bordereau est déjà archivé'; END IF;
    v_next_status:='ARCHIVED';
  END IF;

  SELECT department_id INTO v_department FROM public.schools WHERE id=v_slip.school_id;
  UPDATE public.delivery_slips
  SET status=v_next_status
  WHERE id=v_slip.id RETURNING * INTO v_slip;

  INSERT INTO public.audit_events(
    actor_user_id,department_id,school_id,event_type,entity_table,record_id,details
  ) VALUES (
    auth.uid(),v_department,v_slip.school_id,
    CASE WHEN p_action='CANCEL' THEN 'DELIVERY_SLIP_CANCELLED' ELSE 'DELIVERY_SLIP_ARCHIVED' END,
    'delivery_slips',v_slip.id::text,
    jsonb_build_object(
      'reason',trim(p_reason),
      'previous_status',v_previous_status,
      'new_status',v_slip.status::text,
      'slip_number',v_slip.slip_number,
      'creation_mode',v_slip.creation_mode,
      'lines',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',l.id,'promotion_id',l.promotion_id,'group_code',l.group_code,
        'quantity_delivered',l.quantity_delivered,
        'source_pedagogical_group_id',l.source_pedagogical_group_id
      ) ORDER BY l.created_at),'[]'::jsonb)
      FROM public.delivery_slip_lines l WHERE l.delivery_slip_id=v_slip.id)
    )
  );
  RETURN v_slip;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_transition_delivery_slip(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_transition_delivery_slip(uuid,text,text) TO authenticated;

-- Admin can correct metadata and replace all lines regardless of current status.
-- The previous complete snapshot is written to audit_events before mutation.
CREATE OR REPLACE FUNCTION public.admin_update_delivery_slip(
  p_delivery_slip_id uuid,
  p_slip_number text,
  p_delivery_date date,
  p_observations text,
  p_responsible_agent text,
  p_lines jsonb,
  p_reason text
)
RETURNS public.delivery_slips
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,auth,pg_temp
SET row_security=off
AS $$
DECLARE
  v_slip public.delivery_slips;
  v_department uuid;
  v_line jsonb;
  v_promotion uuid;
  v_group_code text;
  v_quantity integer;
  v_source_group uuid;
  v_count integer:=0;
  v_before jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_central_admin() THEN
    RAISE EXCEPTION 'Modification réservée à l’administration centrale';
  END IF;
  IF nullif(trim(coalesce(p_slip_number,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Le numéro du bordereau est obligatoire';
  END IF;
  IF jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines)=0 THEN
    RAISE EXCEPTION 'Le bordereau doit contenir au moins une ligne';
  END IF;
  IF nullif(trim(coalesce(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Un motif de correction est obligatoire';
  END IF;

  SELECT * INTO v_slip FROM public.delivery_slips
  WHERE id=p_delivery_slip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bordereau introuvable'; END IF;
  SELECT department_id INTO v_department FROM public.schools WHERE id=v_slip.school_id;

  v_before:=jsonb_build_object(
    'slip_number',v_slip.slip_number,
    'delivery_date',v_slip.delivery_date,
    'observations',v_slip.observations,
    'responsible_agent',v_slip.responsible_agent,
    'status',v_slip.status::text,
    'lines',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',l.id,'promotion_id',l.promotion_id,'group_code',l.group_code,
      'quantity_delivered',l.quantity_delivered,
      'source_pedagogical_group_id',l.source_pedagogical_group_id
    ) ORDER BY l.created_at),'[]'::jsonb)
    FROM public.delivery_slip_lines l WHERE l.delivery_slip_id=v_slip.id)
  );

  -- Validate every requested line against this slip's school and school year.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_promotion:=nullif(v_line->>'promotion_id','')::uuid;
    v_group_code:=nullif(trim(v_line->>'group_code'),'');
    v_quantity:=nullif(v_line->>'quantity_delivered','')::integer;
    v_source_group:=nullif(v_line->>'source_pedagogical_group_id','')::uuid;
    IF v_promotion IS NULL OR v_group_code IS NULL OR v_quantity IS NULL OR v_quantity<0 THEN
      RAISE EXCEPTION 'Ligne invalide : promotion, groupe et quantité positive ou nulle requis';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.promotions p WHERE p.id=v_promotion) THEN
      RAISE EXCEPTION 'Promotion inconnue';
    END IF;
    IF v_source_group IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM public.pedagogical_groups g
      WHERE g.id=v_source_group AND g.school_id=v_slip.school_id
        AND g.school_year_id=v_slip.school_year_id
        AND g.promotion_id=v_promotion AND g.group_code=v_group_code
    ) THEN
      RAISE EXCEPTION 'Le groupe source ne correspond pas à l’établissement, à l’année ou à la promotion';
    END IF;
    IF EXISTS(
      SELECT 1 FROM jsonb_array_elements(p_lines) x
      WHERE x.value->>'promotion_id'=v_promotion::text
        AND x.value->>'group_code'=v_group_code
      GROUP BY x.value->>'promotion_id',x.value->>'group_code'
      HAVING COUNT(*)>1
    ) THEN
      RAISE EXCEPTION 'Une même promotion et un même groupe ne peuvent apparaître deux fois';
    END IF;
  END LOOP;

  INSERT INTO public.audit_events(
    actor_user_id,department_id,school_id,event_type,entity_table,record_id,details
  ) VALUES (
    auth.uid(),v_department,v_slip.school_id,'DELIVERY_SLIP_ADMIN_CORRECTION_BEFORE',
    'delivery_slips',v_slip.id::text,
    jsonb_build_object('reason',trim(p_reason),'before',v_before)
  );

  DELETE FROM public.delivery_slip_lines WHERE delivery_slip_id=v_slip.id;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO public.delivery_slip_lines(
      delivery_slip_id,promotion_id,group_code,quantity_delivered,source_pedagogical_group_id
    ) VALUES (
      v_slip.id,
      (v_line->>'promotion_id')::uuid,
      trim(v_line->>'group_code'),
      (v_line->>'quantity_delivered')::integer,
      nullif(v_line->>'source_pedagogical_group_id','')::uuid
    );
    v_count:=v_count+1;
  END LOOP;

  UPDATE public.delivery_slips
  SET slip_number=trim(p_slip_number),
      delivery_date=p_delivery_date,
      observations=nullif(trim(coalesce(p_observations,'')),''),
      responsible_agent=nullif(trim(coalesce(p_responsible_agent,'')),'')
  WHERE id=v_slip.id RETURNING * INTO v_slip;

  INSERT INTO public.audit_events(
    actor_user_id,department_id,school_id,event_type,entity_table,record_id,details
  ) VALUES (
    auth.uid(),v_department,v_slip.school_id,'DELIVERY_SLIP_ADMIN_CORRECTED',
    'delivery_slips',v_slip.id::text,
    jsonb_build_object('reason',trim(p_reason),'previous',v_before,
      'new_status',v_slip.status::text,'new_line_count',v_count)
  );
  RETURN v_slip;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_delivery_slip(uuid,text,date,text,text,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_update_delivery_slip(uuid,text,date,text,text,jsonb,text) TO authenticated;

-- Permanent deletion is central-admin-only for every status and both creation modes.
-- Full header + line snapshot is retained in audit_events before cascading deletion.
CREATE OR REPLACE FUNCTION public.admin_delete_delivery_slip(
  p_delivery_slip_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,auth,pg_temp
SET row_security=off
AS $$
DECLARE
  v_slip public.delivery_slips;
  v_department uuid;
  v_snapshot jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_central_admin() THEN
    RAISE EXCEPTION 'Suppression réservée exclusivement à l’administration centrale';
  END IF;
  IF nullif(trim(coalesce(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Un motif de suppression est obligatoire';
  END IF;
  SELECT * INTO v_slip FROM public.delivery_slips
  WHERE id=p_delivery_slip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bordereau introuvable'; END IF;
  SELECT department_id INTO v_department FROM public.schools WHERE id=v_slip.school_id;

  v_snapshot:=jsonb_build_object(
    'id',v_slip.id,'school_id',v_slip.school_id,'school_year_id',v_slip.school_year_id,
    'slip_number',v_slip.slip_number,'delivery_date',v_slip.delivery_date,
    'status',v_slip.status::text,'creation_mode',v_slip.creation_mode,
    'creator_role',v_slip.creator_role,'created_by',v_slip.created_by,
    'validated_by',v_slip.validated_by,'validated_at',v_slip.validated_at,
    'observations',v_slip.observations,'responsible_agent',v_slip.responsible_agent,
    'created_at',v_slip.created_at,
    'lines',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',l.id,'promotion_id',l.promotion_id,'group_code',l.group_code,
      'quantity_delivered',l.quantity_delivered,
      'source_pedagogical_group_id',l.source_pedagogical_group_id
    ) ORDER BY l.created_at),'[]'::jsonb)
    FROM public.delivery_slip_lines l WHERE l.delivery_slip_id=v_slip.id)
  );

  INSERT INTO public.audit_events(
    actor_user_id,department_id,school_id,event_type,entity_table,record_id,details
  ) VALUES (
    auth.uid(),v_department,v_slip.school_id,'DELIVERY_SLIP_ADMIN_DELETED',
    'delivery_slips',v_slip.id::text,
    jsonb_build_object('reason',trim(p_reason),'deleted_snapshot',v_snapshot)
  );
  DELETE FROM public.delivery_slips WHERE id=v_slip.id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_delivery_slip(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_delivery_slip(uuid,text) TO authenticated;

-- Keep legacy public write paths from bypassing the administrative lifecycle.
COMMENT ON FUNCTION public.admin_transition_delivery_slip(uuid,text,text) IS
  'Central-admin-only lifecycle operation shared by manual and automatic slips. CANCELLED releases quantities; ARCHIVED continues to count.';
COMMENT ON FUNCTION public.admin_delete_delivery_slip(uuid,text) IS
  'Central-admin-only permanent deletion with complete pre-delete audit snapshot; deleted quantities are released.';

COMMIT;
