-- Preparation source picker, serialized items (independent review 2026-11-19):
-- a location was listed whenever an asset sat there, even when every asset was
-- already reserved by another preparation or not eligible, so staff saw a
-- source with nothing to pick. Count only the assets the asset picker offers
-- (eligible and not held by another preparation) and list a location only
-- when that count is above zero, as for quantity items.

do $$
declare
  fn text;
  available_old constant text :=
E'     coalesce((select sum(private.s4_available(c.origin_id,l.id)) from public.inventory_receipt_cohorts c join public.inventory_stock_origins o on o.id=c.origin_id where o.catalog_item_id=i.id),0) available\n';
  available_new constant text :=
E'     case when i.tracking_strategy=''serialized''\n'
'      then (select count(*) from public.equipment_assets a where a.catalog_item_id=i.id and a.location_id=l.id and private.s4_asset_eligible(a.id,l.id)\n'
'        and not exists(select 1 from public.inventory_reservations rs where rs.asset_id=a.id and rs.released_at is null and rs.preparation_id is distinct from p.id))\n'
'      else coalesce((select sum(private.s4_available(c.origin_id,l.id)) from public.inventory_receipt_cohorts c join public.inventory_stock_origins o on o.id=c.origin_id where o.catalog_item_id=i.id),0) end available\n';
  where_old constant text :=
E'   where case when s.tracking_strategy=''serialized''\n'
'     then exists(select 1 from public.equipment_assets a where a.catalog_item_id=s.inventory_item_id and a.location_id=s.location_id)\n'
'     else s.available>0 end\n';
  where_new constant text := E'   where s.available>0\n';
begin
  select replace(pg_get_functiondef('public.equipment_preparation_read(uuid,text,jsonb)'::regprocedure), E'\r', '') into fn;
  if position(available_old in fn) = 0 or position(where_old in fn) = 0 then
    raise exception 'equipment_preparation_read changed; update preparation_serialized_sources';
  end if;
  execute replace(replace(fn, available_old, available_new), where_old, where_new);
end;
$$;

notify pgrst, 'reload schema';
