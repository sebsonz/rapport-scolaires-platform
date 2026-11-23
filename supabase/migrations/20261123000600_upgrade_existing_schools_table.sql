-- SCHOOLS-02: upgrade the legacy schools table created by the initial schema.
-- CREATE TABLE IF NOT EXISTS in SCHOOLS-01 cannot add columns to an existing table.
-- Keep existing school rows intact; newly created/edited schools are validated by the admin RPC.

alter table public.schools
  add column if not exists commune text,
  add column if not exists arrondissement text,
  add column if not exists locality text,
  add column if not exists phone text,
  add column if not exists director_name text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

-- Existing rows may not have commune data. Keep it nullable for legacy records;
-- admin_save_school enforces commune for every new or edited record.
alter table public.schools
  drop constraint if exists schools_commune_nonempty;

alter table public.schools
  add constraint schools_commune_nonempty
  check (commune is null or length(trim(commune)) between 2 and 120);

alter table public.schools
  drop constraint if exists schools_arrondissement_length,
  drop constraint if exists schools_locality_length,
  drop constraint if exists schools_phone_length,
  drop constraint if exists schools_director_length;

alter table public.schools
  add constraint schools_arrondissement_length
    check (arrondissement is null or length(arrondissement) <= 120),
  add constraint schools_locality_length
    check (locality is null or length(locality) <= 240),
  add constraint schools_phone_length
    check (phone is null or length(phone) <= 40),
  add constraint schools_director_length
    check (director_name is null or length(director_name) <= 160);

-- Ensure the new admin RPCs can insert legacy-compatible rows while still
-- recording the actor for all new school records.
alter table public.schools
  alter column updated_at set default now();

comment on column public.schools.commune is
  'Commune of the school; nullable only for legacy rows created before SCHOOLS-01.';
