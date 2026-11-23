-- CLASSES-01: national class catalogue, maintained exclusively by central administration.
-- Existing school-specific pedagogical_groups remain separate and are selected/created in school reports.

alter table public.promotions
  add column if not exists is_active boolean not null default true;

alter table public.promotions
  add constraint promotions_code_nonempty check (length(trim(code)) between 1 and 30),
  add constraint promotions_label_nonempty check (length(trim(label)) between 1 and 120),
  add constraint promotions_cycle_nonempty check (length(trim(cycle)) between 1 and 80),
  add constraint promotions_display_order_nonnegative check (display_order >= 0);

create index if not exists promotions_active_order_idx
  on public.promotions(is_active, display_order, cycle, label);

drop policy if exists promotions_read on public.promotions;
create policy promotions_read
  on public.promotions for select to authenticated
  using (is_active = true or public.is_central_admin());

create or replace function public.admin_save_class_catalogue_item(
  p_class_id uuid,
  p_code text,
  p_label text,
  p_cycle text,
  p_display_order integer default 0
)
returns public.promotions
language plpgsql
security definer
set search_path = public, auth, pg_temp
set row_security = off
as $$
declare
  v_class public.promotions;
begin
  if auth.uid() is null or not public.is_central_admin() then
    raise exception 'Action réservée à l’administration centrale';
  end if;
  if nullif(trim(p_code), '') is null or length(trim(p_code)) > 30
     or nullif(trim(p_label), '') is null or length(trim(p_label)) > 120
     or nullif(trim(p_cycle), '') is null or length(trim(p_cycle)) > 80
     or p_display_order is null or p_display_order < 0 then
    raise exception 'Code, libellé, cycle et ordre d’affichage sont obligatoires et doivent être valides';
  end if;

  if p_class_id is null then
    insert into public.promotions(code, label, cycle, display_order, is_active)
    values (upper(trim(p_code)), trim(p_label), trim(p_cycle), p_display_order, true)
    returning * into v_class;
    insert into public.audit_events(actor_user_id,event_type,entity_table,record_id,details)
    values(auth.uid(),'CLASS_CATALOGUE_ITEM_CREATED','promotions',v_class.id::text,
      jsonb_build_object('code',v_class.code,'label',v_class.label,'cycle',v_class.cycle));
  else
    update public.promotions
    set code=upper(trim(p_code)), label=trim(p_label), cycle=trim(p_cycle),
        display_order=p_display_order
    where id=p_class_id
    returning * into v_class;
    if not found then raise exception 'Classe introuvable'; end if;
    insert into public.audit_events(actor_user_id,event_type,entity_table,record_id,details)
    values(auth.uid(),'CLASS_CATALOGUE_ITEM_UPDATED','promotions',v_class.id::text,
      jsonb_build_object('code',v_class.code,'label',v_class.label,'cycle',v_class.cycle));
  end if;
  return v_class;
end;
$$;

create or replace function public.admin_set_class_catalogue_status(
  p_class_id uuid,
  p_is_active boolean
)
returns public.promotions
language plpgsql
security definer
set search_path = public, auth, pg_temp
set row_security = off
as $$
declare
  v_class public.promotions;
begin
  if auth.uid() is null or not public.is_central_admin() then
    raise exception 'Action réservée à l’administration centrale';
  end if;
  update public.promotions
  set is_active=p_is_active
  where id=p_class_id
  returning * into v_class;
  if not found then raise exception 'Classe introuvable'; end if;

  insert into public.audit_events(actor_user_id,event_type,entity_table,record_id,details)
  values(auth.uid(),
    case when p_is_active then 'CLASS_CATALOGUE_ITEM_ACTIVATED' else 'CLASS_CATALOGUE_ITEM_DEACTIVATED' end,
    'promotions',v_class.id::text,
    jsonb_build_object('code',v_class.code,'label',v_class.label,'is_active',v_class.is_active));
  return v_class;
end;
$$;

revoke all on function public.admin_save_class_catalogue_item(uuid,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.admin_set_class_catalogue_status(uuid,boolean) from public,anon,authenticated;
grant execute on function public.admin_save_class_catalogue_item(uuid,text,text,text,integer) to authenticated;
grant execute on function public.admin_set_class_catalogue_status(uuid,boolean) to authenticated;

comment on table public.promotions is
  'Référentiel national des classes/promotions possibles, géré par l’administration centrale; distinct des groupes pédagogiques propres à chaque établissement.';
