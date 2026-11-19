-- Basic Medical rows moved to the shared ledger (t4r3) are a projection of it,
-- but the projection was refreshed only inside confirm_basic_medical_session.
-- After Kho changed a moved item (for example good -> damaged), the sign
-- screen and export still showed the old count, and confirming failed the
-- snapshot check against the refreshed values; the failure rolled the refresh
-- back too, so reloading never helped (independent review 2026-11-19).
--
-- 1. Every balance change at a room root location refreshes that room's moved
--    rows, so every reader sees the ledger. Existing rows are refreshed once.
-- 2. The cutover preview blocks what the apply cannot open: an inactive
--    inventory item, or one that needs an expiry date (the opening is posted
--    with expiry 'not_required'). The apply moves only rows the preview calls
--    ready, so one such row no longer fails the whole cutover.

create or replace function private.refresh_basic_medical_projection(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous text := coalesce(current_setting('app.basic_medical_projection', true), '');
begin
  perform set_config('app.basic_medical_projection', 'true', true);
  update public.basic_medical_room_inventory inv
  set good_quantity = l.good, damaged_quantity = l.damaged, total_quantity = l.good + l.damaged
  from public.basic_medical_room_inventory moved
  cross join lateral private.basic_medical_ledger_counts(moved.id) l
  where inv.id = moved.id and moved.room_id = p_room_id and moved.cutover_at is not null
    and row(inv.good_quantity, inv.damaged_quantity, inv.total_quantity)
        is distinct from row(l.good, l.damaged, l.good + l.damaged);
  -- Restore: confirm_basic_medical_session sets and clears this flag itself.
  perform set_config('app.basic_medical_projection', previous, true);
end;
$$;
revoke all on function private.refresh_basic_medical_projection(uuid) from public, anon, authenticated;

create or replace function private.basic_medical_projection_on_balance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  room uuid;
begin
  select loc.room_id into room
  from public.inventory_storage_locations loc
  where loc.id = coalesce(new.location_id, old.location_id) and loc.is_room_root;
  if room is not null then
    perform private.refresh_basic_medical_projection(room);
  end if;
  return null;
end;
$$;

drop trigger if exists basic_medical_projection_on_balance on public.inventory_stock_balances;
create trigger basic_medical_projection_on_balance
  after insert or update or delete on public.inventory_stock_balances
  for each row execute function private.basic_medical_projection_on_balance();

do $$
declare
  room uuid;
begin
  for room in select distinct room_id from public.basic_medical_room_inventory where cutover_at is not null loop
    perform private.refresh_basic_medical_projection(room);
  end loop;
end;
$$;

do $$
declare
  fn text;
  anchor text;
begin
  fn := replace(pg_get_functiondef('public.basic_medical_cutover_preview()'::regprocedure), E'\r', '');
  anchor := E'      ''blocker'', case when m.id is null then ''UNMAPPED''\n                      when loc.id is null then ''NO_ROOM_LOCATION'' end';
  if position(anchor in fn) = 0 then raise exception 'basic_medical_cutover_preview changed; update projection_live patch'; end if;
  execute replace(fn, anchor,
    E'      ''blocker'', case when m.id is null then ''UNMAPPED''\n'
    || E'                      when loc.id is null then ''NO_ROOM_LOCATION''\n'
    || E'                      when not i.active then ''ITEM_INACTIVE''\n'
    || E'                      when i.expiry_required then ''EXPIRY_REQUIRED'' end');

  fn := replace(pg_get_functiondef('public.basic_medical_cutover_apply(text)'::regprocedure), E'\r', '');
  anchor := E'    join public.inventory_storage_locations loc on loc.room_id = inv.room_id and loc.is_room_root\n    where inv.is_active and inv.cutover_at is null\n';
  if position(anchor in fn) = 0 then raise exception 'basic_medical_cutover_apply changed; update projection_live patch'; end if;
  execute replace(fn, anchor,
    E'    join public.inventory_storage_locations loc on loc.room_id = inv.room_id and loc.is_room_root\n'
    || E'    join public.inventory_catalog_items i on i.id = m.inventory_item_id\n'
    || E'    where inv.is_active and inv.cutover_at is null and i.active and not i.expiry_required\n');
end;
$$;

notify pgrst, 'reload schema';
