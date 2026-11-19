-- Preparation source picker: the stock read crossed every mapping with every
-- active storage location and returned the first 100 rows by name, almost all
-- with nothing available. With 170+ room locations the location that held the
-- stock fell past page 1, so staff saw a page of zeros (found 2026-11-19 while
-- walking the Skills lab flow on localhost).
--
-- Only locations that can supply the line are returned now: issue locations
-- (room locations never are, see 69_room_root_locations; the commit already
-- rejected them with S4_INVALID_SOURCE) holding stock available for new
-- reservations, or an asset for serialized items. Fullest locations first.

do $$
declare
  fn text;
  anchor constant text :=
E'   select m.id mapping_id,m.catalog_item_id,m.inventory_item_id,m.base_units_per_requested_unit::text conversion_factor,m.base_uom_code,i.name item_name,i.code item_code,i.tracking_strategy,l.id location_id,l.name location_name,\n'
'    coalesce((select sum(private.s4_available(c.origin_id,l.id)) from public.inventory_receipt_cohorts c join public.inventory_stock_origins o on o.id=c.origin_id where o.catalog_item_id=i.id),0)::text available_quantity\n'
'   from public.equipment_inventory_mappings m join public.inventory_catalog_items i on i.id=m.inventory_item_id cross join public.inventory_storage_locations l\n'
'   where m.catalog_item_id=(p_filters->>''catalog_item_id'')::uuid and i.active and l.active order by i.name,l.name,m.id limit 100 offset (page-1)*100';
  replacement constant text :=
E'   select s.mapping_id,s.catalog_item_id,s.inventory_item_id,s.conversion_factor,s.base_uom_code,s.item_name,s.item_code,s.tracking_strategy,s.location_id,s.location_name,s.available::text available_quantity from (\n'
'    select m.id mapping_id,m.catalog_item_id,m.inventory_item_id,m.base_units_per_requested_unit::text conversion_factor,m.base_uom_code,i.name item_name,i.code item_code,i.tracking_strategy,l.id location_id,l.name location_name,\n'
'     coalesce((select sum(private.s4_available(c.origin_id,l.id)) from public.inventory_receipt_cohorts c join public.inventory_stock_origins o on o.id=c.origin_id where o.catalog_item_id=i.id),0) available\n'
'    from public.equipment_inventory_mappings m join public.inventory_catalog_items i on i.id=m.inventory_item_id cross join public.inventory_storage_locations l\n'
'    where m.catalog_item_id=(p_filters->>''catalog_item_id'')::uuid and i.active and l.active and l.allow_issue\n'
'   ) s\n'
'   where case when s.tracking_strategy=''serialized''\n'
'     then exists(select 1 from public.equipment_assets a where a.catalog_item_id=s.inventory_item_id and a.location_id=s.location_id)\n'
'     else s.available>0 end\n'
'   order by s.available desc,s.item_name,s.location_name,s.mapping_id limit 100 offset (page-1)*100';
begin
  select replace(pg_get_functiondef('public.equipment_preparation_read(uuid,text,jsonb)'::regprocedure), E'\r', '') into fn;
  if position(anchor in fn) = 0 then
    raise exception 'equipment_preparation_read changed; update preparation_sources_with_stock';
  end if;
  execute replace(fn, anchor, replacement);
end;
$$;

notify pgrst, 'reload schema';
