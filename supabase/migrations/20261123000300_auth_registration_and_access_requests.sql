-- AUTH-01: public self-registration with email verification and admin-controlled access.
-- No department or role is assigned during signup. Access remains blocked until approval.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_full_name_nonempty check (length(trim(full_name)) > 0)
);

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_note text,
  constraint access_requests_review_consistency check (
    (status = 'PENDING' and reviewed_at is null and reviewed_by is null)
    or
    (status in ('APPROVED', 'REJECTED') and reviewed_at is not null and reviewed_by is not null)
  )
);

create index if not exists access_requests_status_requested_at_idx
  on public.access_requests(status, requested_at desc);

create or replace function public.handle_new_school_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_name text;
begin
  v_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  if v_name is null then
    v_name := split_part(coalesce(new.email, ''), '@', 1);
  end if;

  insert into public.user_profiles(user_id, full_name, email)
  values (new.id, v_name, coalesce(new.email, ''))
  on conflict (user_id) do nothing;

  insert into public.access_requests(user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_school_profile on auth.users;
create trigger on_auth_user_created_school_profile
  after insert on auth.users
  for each row execute function public.handle_new_school_user();

alter table public.user_profiles enable row level security;
alter table public.access_requests enable row level security;

revoke all on public.user_profiles, public.access_requests from anon, authenticated;
grant select on public.user_profiles, public.access_requests to authenticated;
grant update(status, reviewed_at, reviewed_by, review_note)
  on public.access_requests to authenticated;

drop policy if exists user_profiles_read_self_or_central on public.user_profiles;
create policy user_profiles_read_self_or_central
  on public.user_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_central_admin());

drop policy if exists access_requests_read_self_or_central on public.access_requests;
create policy access_requests_read_self_or_central
  on public.access_requests for select to authenticated
  using (user_id = auth.uid() or public.is_central_admin());

drop policy if exists access_requests_update_central_only on public.access_requests;
create policy access_requests_update_central_only
  on public.access_requests for update to authenticated
  using (public.is_central_admin())
  with check (public.is_central_admin());

comment on table public.user_profiles is
  'Public profile metadata for school platform users; profile creation is driven by auth.users trigger.';
comment on table public.access_requests is
  'Self-registration access gate. New accounts are PENDING until a central administrator reviews them.';
