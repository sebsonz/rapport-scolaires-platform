-- DELIVERY-SLIPS-04
-- Explicit draft lifecycle and safe edit/delete operations for generated delivery slips.
-- This migration is intentionally additive and must be applied only after
-- DELIVERY-SLIPS-01, DELIVERY-SLIPS-02 and DELIVERY-SLIPS-03.

BEGIN;

-- Creation must stop at DRAFT. Submission and validation are separate user actions.
CREATE OR REPLACE FUNCTION public.create_automatic_delivery_slip(
 p_school_id uuid,
 p_school_year_id uuid,
 p_slip_number text,
 p_delivery_date date,
 p_group_ids uuid[],
 p_observations text DEFAULT NULL,
 p_responsible_agent text DEFAULT NULL
) RETURNS public.delivery_slips
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,auth,pg_temp
SET row_security=off
AS $$
DECLARE
 v_department uuid;
 v_role text;
 v_slip public.delivery_slips;
 v_group record;
 v_delivered bigint;
 v_slipped bigint;
 v_available bigint;
 v_count integer:=0;
 v_requested integer;
 v_found integer;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentification requise'; END IF;
 IF p_group_ids IS NULL OR cardinality(p_group_ids)=0 THEN RAISE EXCEPTION 'Sélectionnez au moins une classe'; END IF;
 SELECT COUNT(DISTINCT u.group_id)::integer INTO v_requested FROM unnest(p_group_ids) AS u(group_id);
 IF v_requested<>cardinality(p_group_ids) THEN RAISE EXCEPTION 'La sélection contient des classes en double'; END IF;

 SELECT department_id INTO v_department
 FROM public.schools WHERE id=p_school_id AND is_active=true FOR UPDATE;
 IF v_department IS NULL OR NOT public.has_department_access(v_department) THEN
   RAISE EXCEPTION 'Accès à cet établissement refusé';
 END IF;
 IF NOT public.is_central_admin() AND NOT public.has_department_role(v_department,'CATEGORY_2') THEN
   RAISE EXCEPTION 'La création est réservée à la Catégorie 2';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.school_years WHERE id=p_school_year_id AND is_active=true) THEN
   RAISE EXCEPTION 'L’année scolaire sélectionnée n’est pas active';
 END IF;
 IF nullif(trim(coalesce(p_slip_number,'')),'') IS NULL THEN RAISE EXCEPTION 'Le numéro du bordereau est obligatoire'; END IF;

 PERFORM r.id
 FROM public.school_reports r
 JOIN public.pedagogical_groups g ON g.id=r.pedagogical_group_id
 WHERE g.id=ANY(p_group_ids) AND g.school_id=p_school_id AND g.school_year_id=p_school_year_id
 ORDER BY r.id FOR UPDATE OF r;

 SELECT COUNT(*)::integer INTO v_found
 FROM public.pedagogical_groups g
 JOIN public.school_reports r ON r.pedagogical_group_id=g.id
 WHERE g.id=ANY(p_group_ids) AND g.school_id=p_school_id AND g.school_year_id=p_school_year_id;
 IF v_found<>v_requested THEN
   RAISE EXCEPTION 'Une ou plusieurs classes ne sont pas rattachées à cet établissement ou ne possèdent pas de rapport';
 END IF;

 v_role:=CASE WHEN public.is_central_admin() THEN 'CENTRAL_ADMIN' ELSE 'CATEGORY_2' END;
 SELECT * INTO v_slip FROM public.create_delivery_slip_v2(
   p_school_id,p_school_year_id,p_slip_number,p_delivery_date,v_role,p_observations,p_responsible_agent
 );
 UPDATE public.delivery_slips SET creation_mode='AUTOMATIC',status='DRAFT',
   validated_by=NULL,validated_at=NULL
 WHERE id=v_slip.id RETURNING * INTO v_slip;

 FOR v_group IN
   SELECT id,promotion_id,group_code
   FROM public.pedagogical_groups WHERE id=ANY(p_group_ids) ORDER BY id
 LOOP
   SELECT
     COALESCE(
       (SELECT c.quantity FROM public.school_report_delivery_initial_corrections c
        JOIN public.school_reports r ON r.id=c.school_report_id
        WHERE r.pedagogical_group_id=v_group.id ORDER BY c.created_at DESC LIMIT 1),
       (SELECT SUM(o.quantity) FROM public.school_report_operations o
        JOIN public.school_reports r ON r.id=o.school_report_id
        WHERE r.pedagogical_group_id=v_group.id AND o.operation_type='DELIVERY_INITIAL'),0
     )
     + COALESCE(
       (SELECT SUM(o.quantity) FROM public.school_report_operations o
        JOIN public.school_reports r ON r.id=o.school_report_id
        WHERE r.pedagogical_group_id=v_group.id
          AND o.operation_type IN('DELIVERY_RATISSAGE','DELIVERY_CORRECTION_FIRST_ISSUE')),0
     )
   INTO v_delivered;

   SELECT COALESCE(SUM(l.quantity_delivered),0)::bigint INTO v_slipped
   FROM public.delivery_slip_lines l
   JOIN public.delivery_slips d ON d.id=l.delivery_slip_id
   WHERE d.school_id=p_school_id AND d.school_year_id=p_school_year_id
     AND d.status<>'CANCELLED'
     AND (l.source_pedagogical_group_id=v_group.id
       OR (l.source_pedagogical_group_id IS NULL
         AND l.promotion_id=v_group.promotion_id AND l.group_code=v_group.group_code));

   v_available:=v_delivered-v_slipped;
   IF v_available<0 THEN
     RAISE EXCEPTION 'Anomalie classe % : déjà bordereauté %, livré actuel %',
       v_group.group_code,v_slipped,v_delivered;
   END IF;
   IF v_available>0 THEN
     INSERT INTO public.delivery_slip_lines(
       delivery_slip_id,promotion_id,group_code,quantity_delivered,source_pedagogical_group_id
     ) VALUES(v_slip.id,v_group.promotion_id,v_group.group_code,v_available::integer,v_group.id);
     v_count:=v_count+1;
   END IF;
 END LOOP;

 IF v_count=0 THEN
   RAISE EXCEPTION 'Aucune nouvelle quantité à bordereauter dans les classes sélectionnées';
 END IF;

 INSERT INTO public.audit_events(actor_user_id,department_id,school_id,event_type,entity_table,record_id,details)
 VALUES(auth.uid(),v_department,p_school_id,'AUTOMATIC_DELIVERY_SLIP_DRAFT_CREATED',
   'delivery_slips',v_slip.id::text,
   jsonb_build_object('slip_number',v_slip.slip_number,'selected_groups',p_group_ids,
     'line_count',v_count,'status','DRAFT'));
 RETURN v_slip;
END;
$$;

REVOKE ALL ON FUNCTION public.create_automatic_delivery_slip(uuid,uuid,text,date,uuid[],text,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_automatic_delivery_slip(uuid,uuid,text,date,uuid[],text,text)
 TO authenticated;

-- Update metadata and selected class lines only while the document is a draft.
-- Availability is recalculated server-side, excluding this draft's current lines.
CREATE OR REPLACE FUNCTION public.update_automatic_delivery_slip(
 p_delivery_slip_id uuid,
 p_slip_number text,
 p_delivery_date date,
 p_group_ids uuid[],
 p_observations text DEFAULT NULL,
 p_responsible_agent text DEFAULT NULL
) RETURNS public.delivery_slips
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,auth,pg_temp
SET row_security=off
AS $$
DECLARE
 v_slip public.delivery_slips;
 v_department uuid;
 v_requested integer;
 v_found integer:=0;
 v_candidate record;
 v_available bigint;
 v_line_count integer:=0;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentification requise'; END IF;
 IF nullif(trim(coalesce(p_slip_number,'')),'') IS NULL THEN
   RAISE EXCEPTION 'Le numéro du bordereau est obligatoire';
 END IF;
 IF p_group_ids IS NULL OR cardinality(p_group_ids)=0 THEN
   RAISE EXCEPTION 'Sélectionnez au moins une classe';
 END IF;
 SELECT COUNT(DISTINCT x.group_id)::integer INTO v_requested
 FROM unnest(p_group_ids) AS x(group_id);
 IF v_requested<>cardinality(p_group_ids) THEN
   RAISE EXCEPTION 'La sélection contient des classes en double';
 END IF;

 SELECT * INTO v_slip FROM public.delivery_slips
 WHERE id=p_delivery_slip_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Bordereau introuvable'; END IF;
 IF v_slip.creation_mode<>'AUTOMATIC' THEN
   RAISE EXCEPTION 'Cette opération concerne uniquement les bordereaux concernés par ce module';
 END IF;
 IF v_slip.status<>'DRAFT' THEN
   RAISE EXCEPTION 'Seul un brouillon peut être modifié';
 END IF;
 IF v_slip.created_by<>auth.uid() AND NOT public.is_central_admin() THEN
   RAISE EXCEPTION 'Seul le créateur ou un administrateur central peut modifier ce brouillon';
 END IF;
 SELECT department_id INTO v_department FROM public.schools WHERE id=v_slip.school_id;
 IF v_department IS NULL OR NOT public.has_department_access(v_department) THEN
   RAISE EXCEPTION 'Accès au département refusé';
 END IF;

 PERFORM r.id
 FROM public.school_reports r
 JOIN public.pedagogical_groups g ON g.id=r.pedagogical_group_id
 WHERE g.id=ANY(p_group_ids) AND g.school_id=v_slip.school_id
   AND g.school_year_id=v_slip.school_year_id
 ORDER BY r.id FOR UPDATE OF r;

 -- Remove this draft's previous lines first. The candidate RPC then recalculates
 -- remaining quantities without counting the document being edited.
 DELETE FROM public.delivery_slip_lines
 WHERE delivery_slip_id=v_slip.id AND source_pedagogical_group_id IS NOT NULL;

 FOR v_candidate IN
   SELECT c.* FROM public.get_automatic_delivery_slip_candidates(
     v_slip.school_id,v_slip.school_year_id
   ) c
   WHERE c.pedagogical_group_id=ANY(p_group_ids)
 LOOP
   v_available:=v_candidate.available_to_slip;
   IF v_available<0 THEN
     RAISE EXCEPTION 'Anomalie sur la classe % : quantité disponible négative',v_candidate.group_code;
   END IF;
   IF v_available>0 THEN
     INSERT INTO public.delivery_slip_lines(
       delivery_slip_id,promotion_id,group_code,quantity_delivered,source_pedagogical_group_id
     ) VALUES(v_slip.id,v_candidate.promotion_id,v_candidate.group_code,
       v_available::integer,v_candidate.pedagogical_group_id);
     v_line_count:=v_line_count+1;
   END IF;
   v_found:=v_found+1;
 END LOOP;

 IF v_found<>v_requested THEN
   RAISE EXCEPTION 'Une ou plusieurs classes sélectionnées sont indisponibles pour cet établissement';
 END IF;
 IF v_line_count=0 THEN RAISE EXCEPTION 'Aucune quantité disponible pour les classes sélectionnées'; END IF;

 UPDATE public.delivery_slips
 SET slip_number=trim(p_slip_number),
     delivery_date=p_delivery_date,
     observations=nullif(trim(coalesce(p_observations,'')),''),
     responsible_agent=nullif(trim(coalesce(p_responsible_agent,'')),'')
 WHERE id=v_slip.id
 RETURNING * INTO v_slip;

 INSERT INTO public.audit_events(actor_user_id,department_id,school_id,event_type,entity_table,record_id,details)
 VALUES(auth.uid(),v_department,v_slip.school_id,'AUTOMATIC_DELIVERY_SLIP_DRAFT_UPDATED',
   'delivery_slips',v_slip.id::text,
   jsonb_build_object('slip_number',v_slip.slip_number,'selected_groups',p_group_ids,
     'line_count',v_line_count,'status',v_slip.status));
 RETURN v_slip;
END;
$$;

REVOKE ALL ON FUNCTION public.update_automatic_delivery_slip(uuid,text,date,uuid[],text,text)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_automatic_delivery_slip(uuid,text,date,uuid[],text,text)
 TO authenticated;

-- Deletion is intentionally limited to drafts. Submitted or validated documents
-- remain in the audit trail and cannot be silently erased.
CREATE OR REPLACE FUNCTION public.delete_automatic_delivery_slip(
 p_delivery_slip_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,auth,pg_temp
SET row_security=off
AS $$
DECLARE
 v_slip public.delivery_slips;
 v_department uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentification requise'; END IF;
 SELECT * INTO v_slip FROM public.delivery_slips
 WHERE id=p_delivery_slip_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Bordereau introuvable'; END IF;
 IF v_slip.creation_mode<>'AUTOMATIC' THEN
   RAISE EXCEPTION 'Cette opération concerne uniquement les bordereaux concernés par ce module';
 END IF;
 IF v_slip.status<>'DRAFT' THEN
   RAISE EXCEPTION 'Seul un brouillon peut être supprimé. Un bordereau soumis ou validé doit être conservé dans l’historique';
 END IF;
 IF v_slip.created_by<>auth.uid() AND NOT public.is_central_admin() THEN
   RAISE EXCEPTION 'Seul le créateur ou un administrateur central peut supprimer ce brouillon';
 END IF;
 SELECT department_id INTO v_department FROM public.schools WHERE id=v_slip.school_id;
 IF v_department IS NULL OR NOT public.has_department_access(v_department) THEN
   RAISE EXCEPTION 'Accès au département refusé';
 END IF;

 INSERT INTO public.audit_events(actor_user_id,department_id,school_id,event_type,entity_table,record_id,details)
 VALUES(auth.uid(),v_department,v_slip.school_id,'AUTOMATIC_DELIVERY_SLIP_DRAFT_DELETED',
   'delivery_slips',v_slip.id::text,
   jsonb_build_object('slip_number',v_slip.slip_number,'previous_status',v_slip.status));
 DELETE FROM public.delivery_slip_lines WHERE delivery_slip_id=v_slip.id;
 DELETE FROM public.delivery_slips WHERE id=v_slip.id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_automatic_delivery_slip(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_automatic_delivery_slip(uuid) TO authenticated;

COMMIT;
