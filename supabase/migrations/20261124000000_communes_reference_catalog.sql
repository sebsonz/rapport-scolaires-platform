-- SCHOOL-COMMUNES-01: official Benin commune reference catalogue.
-- Idempotent so it can be applied after the catalogue was provisioned manually in DEV.
BEGIN;

CREATE TABLE IF NOT EXISTS public.communes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL
    REFERENCES public.departments(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communes_code_nonempty CHECK (length(trim(code)) BETWEEN 1 AND 30),
  CONSTRAINT communes_name_nonempty CHECK (length(trim(name)) BETWEEN 2 AND 120),
  CONSTRAINT communes_department_name_unique UNIQUE (department_id, name)
);

ALTER TABLE public.communes ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.communes TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'communes'
      AND policyname = 'communes_read_authorized_department'
  ) THEN
    CREATE POLICY communes_read_authorized_department
      ON public.communes
      FOR SELECT
      TO authenticated
      USING (
        public.is_central_admin()
        OR EXISTS (
          SELECT 1
          FROM public.school_memberships m
          WHERE m.user_id = auth.uid()
            AND m.department_id = communes.department_id
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF (
    SELECT COUNT(*) FROM public.departments
    WHERE code IN ('ALI','ATA','ATL','BOR','COL','COU','DON','LIT','MON','OUE','PLA','ZOU')
  ) <> 12 THEN
    RAISE EXCEPTION 'Les 12 départements attendus doivent être présents avant le catalogue des communes.';
  END IF;
END
$$;

WITH commune_data(department_code, commune_code, commune_name) AS (
  VALUES
  ('ALI','ALI-BANIKOARA','Banikoara'),
  ('ALI','ALI-GOGOUNOU','Gogounou'),
  ('ALI','ALI-KANDI','Kandi'),
  ('ALI','ALI-KARIMAMA','Karimama'),
  ('ALI','ALI-MALANVILLE','Malanville'),
  ('ALI','ALI-SEGBANA','Ségbana'),
  ('ATA','ATA-BOUKOMBE','Boukombé'),
  ('ATA','ATA-COBLY','Cobly'),
  ('ATA','ATA-KEROU','Kérou'),
  ('ATA','ATA-KOUANDE','Kouandé'),
  ('ATA','ATA-MATERI','Matéri'),
  ('ATA','ATA-NATITINGOU','Natitingou'),
  ('ATA','ATA-OUASSA-PEHUNCO','Ouassa-Péhunco'),
  ('ATA','ATA-TANGUIETA','Tanguiéta'),
  ('ATA','ATA-TOUCOUNTOUNA','Toucountouna'),
  ('ATL','ATL-ABOMEY-CALAVI','Abomey-Calavi'),
  ('ATL','ATL-ALLADA','Allada'),
  ('ATL','ATL-KPOMASSE','Kpomassè'),
  ('ATL','ATL-OUIDAH','Ouidah'),
  ('ATL','ATL-SO-AVA','Sô-Ava'),
  ('ATL','ATL-TOFFO','Toffo'),
  ('ATL','ATL-TORI-BOSSITO','Tori-Bossito'),
  ('ATL','ATL-ZE','Zè'),
  ('BOR','BOR-BEMBEREKE','Bembéréké'),
  ('BOR','BOR-KALELE','Kalalé'),
  ('BOR','BOR-NDALI','N''Dali'),
  ('BOR','BOR-NIKKI','Nikki'),
  ('BOR','BOR-PARAKOU','Parakou'),
  ('BOR','BOR-PERERE','Pèrèrè'),
  ('BOR','BOR-SINENDE','Sinendé'),
  ('BOR','BOR-TCHAOUROU','Tchaourou'),
  ('COL','COL-BANTE','Bantè'),
  ('COL','COL-DASSA-ZOUME','Dassa-Zoumè'),
  ('COL','COL-GLAZOUE','Glazoué'),
  ('COL','COL-OUESSE','Ouèssè'),
  ('COL','COL-SAVALOU','Savalou'),
  ('COL','COL-SAVE','Savè'),
  ('COU','COU-APLAHOUE','Aplahoué'),
  ('COU','COU-DJAKOTOMEY','Djakotomey'),
  ('COU','COU-DOGBO','Dogbo'),
  ('COU','COU-KLOUEKANME','Klouékanmè'),
  ('COU','COU-LALO','Lalo'),
  ('COU','COU-TOVIKLIN','Toviklin'),
  ('DON','DON-BASSILA','Bassila'),
  ('DON','DON-COPARGO','Copargo'),
  ('DON','DON-DJOUGOU','Djougou'),
  ('DON','DON-OUAKE','Ouaké'),
  ('LIT','LIT-COTONOU','Cotonou'),
  ('MON','MON-ATHIEME','Athiémé'),
  ('MON','MON-BOPA','Bopa'),
  ('MON','MON-COME','Comè'),
  ('MON','MON-GRAND-POPO','Grand-Popo'),
  ('MON','MON-HOUEYOGBE','Houéyogbé'),
  ('MON','MON-LOKOSSA','Lokossa'),
  ('OUE','OUE-ADJARRA','Adjarra'),
  ('OUE','OUE-ADJOHOUN','Adjohoun'),
  ('OUE','OUE-AGUEGUES','Aguégués'),
  ('OUE','OUE-AKPRO-MISSERETE','Akpro-Missérété'),
  ('OUE','OUE-AVRANKOU','Avrankou'),
  ('OUE','OUE-BONOU','Bonou'),
  ('OUE','OUE-DANGBO','Dangbo'),
  ('OUE','OUE-PORTO-NOVO','Porto-Novo'),
  ('OUE','OUE-SEME-PODJI','Sèmè-Podji'),
  ('PLA','PLA-ADJA-OUERE','Adja-Ouèrè'),
  ('PLA','PLA-IFANGNI','Ifangni'),
  ('PLA','PLA-KETOU','Kétou'),
  ('PLA','PLA-POBE','Pobè'),
  ('PLA','PLA-SAKETE','Sakété'),
  ('ZOU','ZOU-ABOMEY','Abomey'),
  ('ZOU','ZOU-AGBANGNIZOUN','Agbangnizoun'),
  ('ZOU','ZOU-BOHICON','Bohicon'),
  ('ZOU','ZOU-COVE','Covè'),
  ('ZOU','ZOU-DJIDJA','Djidja'),
  ('ZOU','ZOU-OUINHI','Ouinhi'),
  ('ZOU','ZOU-ZAKPOTA','Za-Kpota'),
  ('ZOU','ZOU-ZAGNANADO','Zagnanado'),
  ('ZOU','ZOU-ZOGBODOMEY','Zogbodomey')
)
INSERT INTO public.communes (department_id, code, name)
SELECT d.id, c.commune_code, c.commune_name
FROM commune_data c
JOIN public.departments d ON d.code = c.department_code
WHERE NOT EXISTS (
  SELECT 1
  FROM public.communes existing
  WHERE existing.code = c.commune_code
     OR (existing.department_id = d.id AND lower(trim(existing.name)) = lower(trim(c.commune_name)))
);

DO $$
DECLARE
  v_total integer;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.communes;
  IF v_total <> 77 THEN
    RAISE EXCEPTION 'Catalogue communal incomplet : % communes présentes, 77 attendues.', v_total;
  END IF;
END
$$;

COMMIT;
