-- t4r3 step A (PILOT-REVIEW-003, owner approval 2026-11-18): Basic Medical
-- catalog items map to shared inventory SKUs through the same mapping table as
-- Skills lab, as an exclusive second FK. Mapping is manual (no name matching),
-- Admin only. This step adds no stock: basic_medical_cutover_preview only
-- shows what the opening at each room location would be.

alter table public.equipment_inventory_mappings
  alter column catalog_item_id drop not null,
  add column if not exists basic_medical_catalog_item_id uuid
    references public.basic_medical_equipment_catalog(id) on delete restrict;

alter table public.equipment_inventory_mappings
  drop constraint if exists equipment_inventory_mappings_one_catalog,
  add constraint equipment_inventory_mappings_one_catalog
    check (num_nonnulls(catalog_item_id, basic_medical_catalog_item_id) = 1);

-- One current mapping per Basic Medical item (mappings are immutable rows).
create unique index if not exists equipment_inventory_mappings_one_basic_medical
  on public.equipment_inventory_mappings (basic_medical_catalog_item_id)
  where basic_medical_catalog_item_id is not null;

create or replace function public.map_basic_medical_inventory_item(
  p_basic_medical_catalog_item_id uuid,
  p_inventory_item_id uuid,
  p_base_units_per_unit text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  bm public.basic_medical_equipment_catalog;
  item public.inventory_catalog_items;
  factor numeric;
  mapping_id uuid;
begin
  if not (select private.is_active_user()) or not (select private.has_role('admin')) then
    raise exception 'BASIC_MEDICAL_MAPPING_ADMIN_ONLY' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into bm from public.basic_medical_equipment_catalog where id = p_basic_medical_catalog_item_id;
  if not found then raise exception 'BASIC_MEDICAL_ITEM_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into item from public.inventory_catalog_items where id = p_inventory_item_id and active;
  if not found then raise exception 'INACTIVE_REFERENCE: Inventory item not found or inactive' using errcode = '22023'; end if;
  factor := private.inventory_validate_decimal(p_base_units_per_unit, 6, true);
  if exists (select 1 from public.equipment_inventory_mappings
             where basic_medical_catalog_item_id = bm.id) then
    raise exception 'BASIC_MEDICAL_ITEM_ALREADY_MAPPED' using errcode = '23505';
  end if;

  insert into public.equipment_inventory_mappings (
    basic_medical_catalog_item_id, inventory_item_id, base_units_per_requested_unit,
    demand_unit, base_uom_code, reason, created_by)
  values (bm.id, item.id, factor, coalesce(nullif(btrim(bm.unit), ''), 'cái'),
    item.base_uom_code, btrim(p_reason), actor)
  returning id into mapping_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'inventory.basic_medical_mapped', 'equipment_inventory_mapping', mapping_id,
    jsonb_build_object('basic_medical_catalog_item_id', bm.id, 'inventory_item_id', item.id,
      'base_units_per_unit', factor::text));
  return mapping_id;
end;
$$;

revoke all on function public.map_basic_medical_inventory_item(uuid, uuid, text, text) from public, anon;
grant execute on function public.map_basic_medical_inventory_item(uuid, uuid, text, text) to authenticated;

-- What step B would post: one opening line per room and item, in base units,
-- at the room's root location. Rows without a mapping are listed as blockers.
create or replace function public.basic_medical_cutover_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rows jsonb;
begin
  if not (select private.is_active_user()) or not (select private.has_role('admin')) then
    raise exception 'BASIC_MEDICAL_MAPPING_ADMIN_ONLY' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'room_id', ro.id, 'room_code', ro.room_code, 'building_code', ro.building_code,
      'location_id', loc.id,
      'basic_medical_item_id', bm.id, 'basic_medical_item_name', bm.item_name, 'unit', bm.unit,
      'good_quantity', inv.good_quantity, 'damaged_quantity', inv.damaged_quantity,
      'mapping_id', m.id, 'inventory_item_id', i.id, 'inventory_item_code', i.code,
      'inventory_item_name', i.name, 'base_uom_code', i.base_uom_code,
      'base_good', (inv.good_quantity * m.base_units_per_requested_unit)::text,
      'base_damaged', (inv.damaged_quantity * m.base_units_per_requested_unit)::text,
      'blocker', case when m.id is null then 'UNMAPPED'
                      when loc.id is null then 'NO_ROOM_LOCATION' end
    ) order by ro.building_code, ro.room_code, bm.item_name), '[]'::jsonb)
  into rows
  from public.basic_medical_room_inventory inv
  join public.rooms ro on ro.id = inv.room_id
  join public.basic_medical_equipment_catalog bm on bm.id = inv.catalog_item_id
  left join public.equipment_inventory_mappings m on m.basic_medical_catalog_item_id = bm.id
  left join public.inventory_catalog_items i on i.id = m.inventory_item_id
  left join public.inventory_storage_locations loc on loc.room_id = ro.id and loc.is_room_root
  where inv.is_active and (inv.good_quantity > 0 or inv.damaged_quantity > 0);

  return jsonb_build_object(
    'rows', rows,
    'blocked', (select count(*) from jsonb_array_elements(rows) r where r->>'blocker' is not null),
    'ready', (select count(*) from jsonb_array_elements(rows) r where r->>'blocker' is null));
end;
$$;

revoke all on function public.basic_medical_cutover_preview() from public, anon;
grant execute on function public.basic_medical_cutover_preview() to authenticated;

-- Basic Medical catalog with its current mapping, for the Admin mapping page.
create or replace function public.basic_medical_mapping_read()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_user()) or not (select private.has_role('admin')) then
    raise exception 'BASIC_MEDICAL_MAPPING_ADMIN_ONLY' using errcode = '42501';
  end if;
  -- shortcut: the Basic Medical catalog is small (tens of items); page it if it grows past 500.
  return coalesce((select jsonb_agg(row order by row->>'item_name') from (
    select jsonb_build_object(
      'id', bm.id, 'item_name', bm.item_name, 'commercial_name', bm.commercial_name, 'unit', bm.unit,
      'mapping_id', m.id, 'inventory_item_id', i.id, 'inventory_item_code', i.code,
      'inventory_item_name', i.name, 'base_uom_code', i.base_uom_code,
      'base_units_per_unit', m.base_units_per_requested_unit::text) as row
    from public.basic_medical_equipment_catalog bm
    left join public.equipment_inventory_mappings m on m.basic_medical_catalog_item_id = bm.id
    left join public.inventory_catalog_items i on i.id = m.inventory_item_id
    where bm.is_active
    limit 500) listed), '[]'::jsonb);
end;
$$;

revoke all on function public.basic_medical_mapping_read() from public, anon;
grant execute on function public.basic_medical_mapping_read() to authenticated;
