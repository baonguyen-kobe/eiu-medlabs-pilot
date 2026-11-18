-- t4e step 2: one equipment catalog with usage scopes (owner decision
-- 2026-11-18: merge the tables and keep a compatibility layer).
--
-- equipment_catalog becomes the shared table equipment_items with
-- usage_scopes (nursing_skills, basic_medical). Basic Medical rows move in
-- with the same ids. The old names stay as security-invoker views filtered by
-- scope, so existing pages and functions keep seeing only their own side.
-- Commercial names stay unique within each scope; a name present on both
-- sides is listed for an Admin to resolve, never merged automatically.

alter table public.equipment_catalog rename to equipment_items;
alter table public.equipment_items
  add column usage_scopes text[] not null default '{nursing_skills}'
    constraint equipment_items_usage_scopes_check
    check (cardinality(usage_scopes) between 1 and 2
      and usage_scopes <@ array['nursing_skills', 'basic_medical']);

drop index public.equipment_catalog_commercial_name_normalized_key;
create unique index equipment_catalog_commercial_name_normalized_key
  on public.equipment_items (lower(btrim(commercial_name)))
  where usage_scopes @> '{nursing_skills}';
create unique index basic_medical_catalog_commercial_name_normalized_key_v2
  on public.equipment_items (lower(btrim(commercial_name)))
  where usage_scopes @> '{basic_medical}';

insert into public.equipment_items (
  id, item_name, commercial_name, item_type, country_of_origin, manufacturer,
  model, unit, is_active, created_at, updated_at, usage_scopes)
select id, item_name, commercial_name, item_type, country_of_origin, manufacturer,
  model, unit, is_active, created_at, updated_at, '{basic_medical}'
from public.basic_medical_equipment_catalog;

alter table public.basic_medical_room_inventory
  drop constraint basic_medical_room_inventory_catalog_item_id_fkey,
  add constraint basic_medical_room_inventory_catalog_item_id_fkey
    foreign key (catalog_item_id) references public.equipment_items(id) on delete restrict;
alter table public.equipment_request_items
  drop constraint equipment_request_items_basic_medical_catalog_item_id_fkey,
  add constraint equipment_request_items_basic_medical_catalog_item_id_fkey
    foreign key (basic_medical_catalog_item_id) references public.equipment_items(id) on delete restrict;
alter table public.equipment_inventory_mappings
  drop constraint equipment_inventory_mappings_basic_medical_catalog_item_id_fkey,
  add constraint equipment_inventory_mappings_basic_medical_catalog_item_id_fkey
    foreign key (basic_medical_catalog_item_id) references public.equipment_items(id) on delete restrict;

drop table public.basic_medical_equipment_catalog;
alter index public.basic_medical_catalog_commercial_name_normalized_key_v2
  rename to basic_medical_catalog_commercial_name_normalized_key;

-- Each side reads and writes only rows in its scope.
drop policy if exists equipment_catalog_select on public.equipment_items;
drop policy if exists equipment_catalog_admin on public.equipment_items;
create policy equipment_items_select on public.equipment_items for select to authenticated
  using ((select private.is_active_user()) and (
    usage_scopes @> '{nursing_skills}'
    or (select private.can_manage_basic_medical())
    or (select private.has_room_type('40000000-0000-0000-0000-000000000002'::uuid))));
create policy equipment_items_manage_skills on public.equipment_items for all to authenticated
  using (((select private.has_role('admin')) or (select private.has_role('staff')))
    and usage_scopes @> '{nursing_skills}')
  with check (((select private.has_role('admin')) or (select private.has_role('staff')))
    and usage_scopes @> '{nursing_skills}');
create policy equipment_items_manage_basic_medical on public.equipment_items for all to authenticated
  using ((select private.can_manage_basic_medical()) and usage_scopes @> '{basic_medical}')
  with check ((select private.can_manage_basic_medical()) and usage_scopes @> '{basic_medical}');

create view public.equipment_catalog with (security_invoker = true) as
  select id, item_name, commercial_name, item_type, country_of_origin, manufacturer,
    model, unit, is_active, created_at, updated_at, usage_scopes
  from public.equipment_items where usage_scopes @> '{nursing_skills}';
create view public.basic_medical_equipment_catalog with (security_invoker = true) as
  select id, item_name, commercial_name, item_type, country_of_origin, manufacturer,
    model, unit, is_active, created_at, updated_at, usage_scopes
  from public.equipment_items where usage_scopes @> '{basic_medical}';
-- A row added through a side's view belongs to that side.
alter view public.equipment_catalog alter column usage_scopes set default '{nursing_skills}';
alter view public.basic_medical_equipment_catalog alter column usage_scopes set default '{basic_medical}';
alter view public.equipment_catalog alter column id set default gen_random_uuid();
alter view public.basic_medical_equipment_catalog alter column id set default gen_random_uuid();
revoke all on public.equipment_catalog, public.basic_medical_equipment_catalog from anon;
grant select, insert, update, delete on public.equipment_catalog, public.basic_medical_equipment_catalog
  to authenticated, service_role;

-- The tick: an Admin sets which sides use an item. A side still in use keeps it.
create or replace function public.set_equipment_item_scopes(p_item_id uuid, p_scopes text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  current_scopes text[];
  scopes text[] := array(select distinct unnest(p_scopes) order by 1);
begin
  if not (select private.is_active_user()) or not (select private.has_role('admin')) then
    raise exception 'EQUIPMENT_SCOPE_ADMIN_ONLY' using errcode = '42501';
  end if;
  if cardinality(scopes) = 0 or not scopes <@ array['nursing_skills', 'basic_medical'] then
    raise exception 'EQUIPMENT_SCOPE_INVALID' using errcode = '22023';
  end if;
  select usage_scopes into current_scopes from public.equipment_items where id = p_item_id for update;
  if current_scopes is null then
    raise exception 'EQUIPMENT_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not scopes @> '{nursing_skills}' and current_scopes @> '{nursing_skills}' and (
       exists (select 1 from public.equipment_request_items where catalog_item_id = p_item_id)
    or exists (select 1 from public.equipment_inventory_mappings where catalog_item_id = p_item_id)) then
    raise exception 'EQUIPMENT_SCOPE_IN_USE' using errcode = '23503',
      hint = 'Thiết bị đang được phiếu hoặc kho Skills lab dùng; không bỏ phạm vi này được.';
  end if;
  if not scopes @> '{basic_medical}' and current_scopes @> '{basic_medical}' and (
       exists (select 1 from public.basic_medical_room_inventory where catalog_item_id = p_item_id)
    or exists (select 1 from public.equipment_request_items where basic_medical_catalog_item_id = p_item_id)
    or exists (select 1 from public.equipment_inventory_mappings where basic_medical_catalog_item_id = p_item_id)) then
    raise exception 'EQUIPMENT_SCOPE_IN_USE' using errcode = '23503',
      hint = 'Thiết bị đang được phòng hoặc phiếu Y cơ sở dùng; không bỏ phạm vi này được.';
  end if;
  update public.equipment_items set usage_scopes = scopes where id = p_item_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'equipment_item.scopes_changed', 'equipment_item', p_item_id,
    jsonb_build_object('from', current_scopes, 'to', scopes));
  return scopes;
end;
$$;
revoke all on function public.set_equipment_item_scopes(uuid, text[]) from public, anon;
grant execute on function public.set_equipment_item_scopes(uuid, text[]) to authenticated;

-- Same commercial name on both sides as two rows: for an Admin to resolve.
create or replace function public.equipment_catalog_scope_duplicates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_user()) or not (select private.has_role('admin')) then
    raise exception 'EQUIPMENT_SCOPE_ADMIN_ONLY' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'commercial_name', s.commercial_name,
      'skills_id', s.id, 'skills_item_name', s.item_name,
      'basic_medical_id', b.id, 'basic_medical_item_name', b.item_name)
    order by s.commercial_name)
    from public.equipment_items s
    join public.equipment_items b
      on lower(btrim(b.commercial_name)) = lower(btrim(s.commercial_name)) and b.id <> s.id
    where s.usage_scopes @> '{nursing_skills}' and b.usage_scopes @> '{basic_medical}'), '[]'::jsonb);
end;
$$;
revoke all on function public.equipment_catalog_scope_duplicates() from public, anon;
grant execute on function public.equipment_catalog_scope_duplicates() to authenticated;

notify pgrst, 'reload schema';
