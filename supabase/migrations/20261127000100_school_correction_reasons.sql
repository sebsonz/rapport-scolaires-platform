-- School correction reasons
-- Additive migration: creates only an isolated correction-reasons feature.
-- Does not modify existing reports, schools, operations or delivery slips.

CREATE TABLE public.school_correction_reasons (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
    title text NOT NULL CHECK (length(btrim(title)) > 0),
    content_html text NOT NULL CHECK (length(btrim(content_html)) > 0),
    created_by uuid NOT NULL DEFAULT auth.uid()
        REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX school_correction_reasons_school_updated_idx
    ON public.school_correction_reasons (school_id, updated_at DESC);

ALTER TABLE public.school_correction_reasons ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.school_correction_reasons TO authenticated;

CREATE POLICY school_correction_reasons_read
    ON public.school_correction_reasons
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.schools s
            WHERE s.id = school_correction_reasons.school_id
              AND public.has_department_access(s.department_id)
        )
    );

CREATE POLICY school_correction_reasons_insert
    ON public.school_correction_reasons
    FOR INSERT TO authenticated
    WITH CHECK (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1
            FROM public.schools s
            WHERE s.id = school_correction_reasons.school_id
              AND (
                  public.is_central_admin()
                  OR public.has_department_role(
                      s.department_id,
                      'CATEGORY_1'::public.school_member_role
                  )
              )
        )
    );

CREATE POLICY school_correction_reasons_update
    ON public.school_correction_reasons
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.schools s
            WHERE s.id = school_correction_reasons.school_id
              AND (
                  public.is_central_admin()
                  OR public.has_department_role(
                      s.department_id,
                      'CATEGORY_1'::public.school_member_role
                  )
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.schools s
            WHERE s.id = school_correction_reasons.school_id
              AND (
                  public.is_central_admin()
                  OR public.has_department_role(
                      s.department_id,
                      'CATEGORY_1'::public.school_member_role
                  )
              )
        )
    );

CREATE POLICY school_correction_reasons_delete
    ON public.school_correction_reasons
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.schools s
            WHERE s.id = school_correction_reasons.school_id
              AND (
                  public.is_central_admin()
                  OR public.has_department_role(
                      s.department_id,
                      'CATEGORY_1'::public.school_member_role
                  )
              )
        )
    );

CREATE OR REPLACE FUNCTION public.protect_school_correction_reason_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.school_id IS DISTINCT FROM OLD.school_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Correction reason identity fields are immutable';
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

CREATE TRIGGER school_correction_reasons_protect_identity
    BEFORE UPDATE ON public.school_correction_reasons
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_school_correction_reason_identity();