-- DELIVERY-SLIPS-03: additive automatic mode; legacy manual workflow is preserved.
BEGIN;
ALTER TABLE public.delivery_slips ADD COLUMN IF NOT EXISTS creation_mode text NOT NULL DEFAULT 'MANUAL';
ALTER TABLE public.delivery_slips DROP CONSTRAINT IF EXISTS delivery_slips_creation_mode_check;
ALTER TABLE public.delivery_slips ADD CONSTRAINT delivery_slips_creation_mode_check CHECK (creation_mode IN ('MANUAL','AUTOMATIC'));
ALTER TABLE public.delivery_slip_lines ADD COLUMN IF NOT EXISTS source_pedagogical_group_id uuid REFERENCES public.pedagogical_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS delivery_slip_lines_source_group_idx ON public.delivery_slip_lines(source_pedagogical_group_id) WHERE source_pedagogical_group_id IS NOT NULL;
COMMENT ON COLUMN public.delivery_slips.creation_mode IS 'MANUAL preserves the legacy workflow; AUTOMATIC identifies generated complementary slips.';
COMMENT ON COLUMN public.delivery_slip_lines.source_pedagogical_group_id IS 'Source pedagogical group for automatic lines; legacy/manual lines remain NULL.';

CREATE OR REPLACE FUNCTION public.get_automatic_delivery_slip_candidates(p_school_id uuid,p_school_year_id uuid)
RETURNS TABLE(pedagogical_group_id uuid,promotion_id uuid,promotion_label text,group_code text,current_delivered bigint,already_slipped bigint,available_to_slip bigint,has_report boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth,pg_temp SET row_security=off AS $$
DECLARE v_department uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentification requise'; END IF;
 SELECT department_id INTO v_department FROM public.schools WHERE id=p_school_id AND is_active=true;
 IF v_department IS NULL OR NOT public.has_department_access(v_department) THEN RAISE EXCEPTION 'Accès à cet établissement refusé'; END IF;
 IF NOT public.is_central_admin() AND NOT public.has_department_role(v_department,'CATEGORY_2') THEN RAISE EXCEPTION 'La génération automatique est réservée à la Catégorie 2'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.school_years WHERE id=p_school_year_id) THEN RAISE EXCEPTION 'Année scolaire introuvable'; END IF;
 RETURN QUERY
 WITH src AS (
  SELECT g.id gid,g.promotion_id,g.group_code,p.label,r.id IS NOT NULL report_exists,
   (COALESCE(MAX(corrected_initial.quantity),COALESCE(SUM(o.quantity) FILTER(WHERE o.operation_type='DELIVERY_INITIAL'),0))
    + COALESCE(SUM(o.quantity) FILTER(WHERE o.operation_type IN('DELIVERY_RATISSAGE','DELIVERY_CORRECTION_FIRST_ISSUE')),0))::bigint delivered
  FROM public.pedagogical_groups g JOIN public.promotions p ON p.id=g.promotion_id
  LEFT JOIN public.school_reports r ON r.pedagogical_group_id=g.id
  LEFT JOIN public.school_report_operations o ON o.school_report_id=r.id
  LEFT JOIN LATERAL (
   SELECT c.quantity FROM public.school_report_delivery_initial_corrections c
   WHERE c.school_report_id=r.id ORDER BY c.created_at DESC LIMIT 1
  ) corrected_initial ON true
  WHERE g.school_id=p_school_id AND g.school_year_id=p_school_year_id
  GROUP BY g.id,g.promotion_id,g.group_code,p.label,r.id
 ), sl AS (
  SELECT s.gid,COALESCE(SUM(CASE WHEN d.id IS NOT NULL THEN l.quantity_delivered ELSE 0 END),0)::bigint slipped
  FROM src s LEFT JOIN public.delivery_slip_lines l ON
   (l.source_pedagogical_group_id=s.gid OR (l.source_pedagogical_group_id IS NULL AND l.promotion_id=s.promotion_id AND l.group_code=s.group_code))
  LEFT JOIN public.delivery_slips d ON d.id=l.delivery_slip_id AND d.school_id=p_school_id AND d.school_year_id=p_school_year_id AND d.status<>'CANCELLED'
  GROUP BY s.gid
 )
 SELECT s.gid,s.promotion_id,s.label,s.group_code,s.delivered,COALESCE(sl.slipped,0),
  s.delivered-COALESCE(sl.slipped,0),s.report_exists
 FROM src s LEFT JOIN sl ON sl.gid=s.gid WHERE s.report_exists ORDER BY s.label,s.group_code;
END $$;
REVOKE ALL ON FUNCTION public.get_automatic_delivery_slip_candidates(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_automatic_delivery_slip_candidates(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_automatic_delivery_slip(
 p_school_id uuid,p_school_year_id uuid,p_slip_number text,p_delivery_date date,p_group_ids uuid[],
 p_observations text DEFAULT NULL,p_responsible_agent text DEFAULT NULL
) RETURNS public.delivery_slips
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth,pg_temp SET row_security=off AS $$
DECLARE
 v_department uuid; v_role text; v_slip public.delivery_slips; v_group record;
 v_delivered bigint; v_slipped bigint; v_available bigint; v_count integer:=0; v_requested integer; v_found integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentification requise'; END IF;
 IF p_group_ids IS NULL OR cardinality(p_group_ids)=0 THEN RAISE EXCEPTION 'Sélectionnez au moins une classe'; END IF;
 SELECT COUNT(DISTINCT u.group_id)::integer INTO v_requested FROM unnest(p_group_ids) AS u(group_id);
 IF v_requested<>cardinality(p_group_ids) THEN RAISE EXCEPTION 'La sélection contient des classes en double'; END IF;
 SELECT department_id INTO v_department FROM public.schools WHERE id=p_school_id AND is_active=true FOR UPDATE;
 IF v_department IS NULL OR NOT public.has_department_access(v_department) THEN RAISE EXCEPTION 'Accès à cet établissement refusé'; END IF;
 IF NOT public.is_central_admin() AND NOT public.has_department_role(v_department,'CATEGORY_2') THEN RAISE EXCEPTION 'La génération automatique est réservée à la Catégorie 2'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.school_years WHERE id=p_school_year_id AND is_active=true) THEN RAISE EXCEPTION 'L’année scolaire sélectionnée n’est pas active'; END IF;
 IF nullif(trim(coalesce(p_slip_number,'')),'') IS NULL THEN RAISE EXCEPTION 'Le numéro du bordereau est obligatoire'; END IF;
 PERFORM r.id FROM public.school_reports r JOIN public.pedagogical_groups g ON g.id=r.pedagogical_group_id
 WHERE g.id=ANY(p_group_ids) AND g.school_id=p_school_id AND g.school_year_id=p_school_year_id ORDER BY r.id FOR UPDATE OF r;
 SELECT COUNT(*)::integer INTO v_found FROM public.pedagogical_groups g JOIN public.school_reports r ON r.pedagogical_group_id=g.id
 WHERE g.id=ANY(p_group_ids) AND g.school_id=p_school_id AND g.school_year_id=p_school_year_id;
 IF v_found<>v_requested THEN RAISE EXCEPTION 'Une ou plusieurs classes sélectionnées ne sont pas rattachées à cet établissement ou ne possèdent pas de rapport'; END IF;
 v_role:=CASE WHEN public.is_central_admin() THEN 'CENTRAL_ADMIN' ELSE 'CATEGORY_2' END;
 SELECT * INTO v_slip FROM public.create_delivery_slip_v2(p_school_id,p_school_year_id,p_slip_number,p_delivery_date,v_role,p_observations,p_responsible_agent);
 UPDATE public.delivery_slips SET creation_mode='AUTOMATIC' WHERE id=v_slip.id RETURNING * INTO v_slip;
 FOR v_group IN SELECT id,promotion_id,group_code FROM public.pedagogical_groups WHERE id=ANY(p_group_ids) ORDER BY id LOOP
  SELECT
   COALESCE(
    (SELECT c.quantity FROM public.school_report_delivery_initial_corrections c
     JOIN public.school_reports r ON r.id=c.school_report_id
     WHERE r.pedagogical_group_id=v_group.id ORDER BY c.created_at DESC LIMIT 1),
    (SELECT SUM(o.quantity) FROM public.school_report_operations o
     JOIN public.school_reports r ON r.id=o.school_report_id
     WHERE r.pedagogical_group_id=v_group.id AND o.operation_type='DELIVERY_INITIAL'),
    0
   )
   + COALESCE(
    (SELECT SUM(o.quantity) FROM public.school_report_operations o
     JOIN public.school_reports r ON r.id=o.school_report_id
     WHERE r.pedagogical_group_id=v_group.id
      AND o.operation_type IN('DELIVERY_RATISSAGE','DELIVERY_CORRECTION_FIRST_ISSUE')),
    0
   )
  INTO v_delivered;
  SELECT COALESCE(SUM(l.quantity_delivered),0)::bigint INTO v_slipped
  FROM public.delivery_slip_lines l JOIN public.delivery_slips d ON d.id=l.delivery_slip_id
  WHERE d.school_id=p_school_id AND d.school_year_id=p_school_year_id AND d.status<>'CANCELLED'
   AND (l.source_pedagogical_group_id=v_group.id OR (l.source_pedagogical_group_id IS NULL AND l.promotion_id=v_group.promotion_id AND l.group_code=v_group.group_code));
  v_available:=v_delivered-v_slipped;
  IF v_available<0 THEN RAISE EXCEPTION 'Anomalie classe % : déjà bordereauté %, livré actuel %',v_group.group_code,v_slipped,v_delivered; END IF;
  IF v_available>0 THEN
   INSERT INTO public.delivery_slip_lines(delivery_slip_id,promotion_id,group_code,quantity_delivered,source_pedagogical_group_id)
   VALUES(v_slip.id,v_group.promotion_id,v_group.group_code,v_available::integer,v_group.id);
   v_count:=v_count+1;
  END IF;
 END LOOP;
 IF v_count=0 THEN RAISE EXCEPTION 'Aucune nouvelle quantité à bordereauter dans les classes sélectionnées'; END IF;
 IF v_role='CATEGORY_2' THEN
  SELECT * INTO v_slip FROM public.submit_delivery_slip(v_slip.id);
 ELSE
  UPDATE public.delivery_slips SET status='VALIDATED',validated_by=auth.uid(),validated_at=now()
  WHERE id=v_slip.id RETURNING * INTO v_slip;
 END IF;
 INSERT INTO public.audit_events(actor_user_id,department_id,school_id,event_type,entity_table,record_id,details)
 VALUES(auth.uid(),v_department,p_school_id,'AUTOMATIC_DELIVERY_SLIP_GENERATED','delivery_slips',v_slip.id::text,
 jsonb_build_object('slip_number',v_slip.slip_number,'selected_groups',p_group_ids,'line_count',v_count,'creation_mode','AUTOMATIC'));
 RETURN v_slip;
END $$;
REVOKE ALL ON FUNCTION public.create_automatic_delivery_slip(uuid,uuid,text,date,uuid[],text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_automatic_delivery_slip(uuid,uuid,text,date,uuid[],text,text) TO authenticated;
COMMIT;
