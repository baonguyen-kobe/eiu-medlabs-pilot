-- t4r1: read model for one room's equipment (PILOT-REVIEW-003). Everything is
-- derived from the ledger and fulfillment events; nothing is stored twice.
--   fixed     = quantity stock held at the room's locations (root and children)
--   assets    = serialized assets located there
--   temporary = issued, not yet returned, on requests whose session is in the room
create or replace function public.room_equipment_read(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not (select private.can_access_inventory()) then
    raise exception 'AUTH_DENIED: Access denied to inventory read models' using errcode = '42501';
  end if;

  with recursive room_locations as (
    select l.id from public.inventory_storage_locations l
    where l.room_id = p_room_id and l.is_room_root
    union
    select child.id from public.inventory_storage_locations child
    join room_locations parent on child.parent_location_id = parent.id
  ),
  fixed as (
    select i.id as item_id, i.code, i.name, i.base_uom_code, i.return_semantics,
      sum(b.quantity) filter (where b.condition = 'good') as good,
      sum(b.quantity) filter (where b.condition = 'damaged') as damaged
    from public.inventory_stock_balances b
    join public.inventory_stock_origins o on o.id = b.cohort_id
    join public.inventory_catalog_items i on i.id = o.catalog_item_id
    where b.location_id in (select id from room_locations) and b.quantity <> 0
    group by i.id
  ),
  assets as (
    select a.id, a.asset_code, i.name, a.operational_status, a.lifecycle_status
    from public.equipment_assets a
    join public.inventory_catalog_items i on i.id = a.catalog_item_id
    where a.location_id in (select id from room_locations)
      and a.lifecycle_status <> 'disposed'
  ),
  temporary as (
    select r.id as request_id, r.return_at, i.code, i.name, i.base_uom_code,
      a.id as asset_id, a.asset_code, o.issued - o.returned - o.resolved as outstanding
    from public.equipment_requests r
    join public.class_schedules s on s.id = r.class_schedule_id
    join public.equipment_fulfillment_events e on e.request_id = r.id
    join public.equipment_issue_slices sl on sl.event_id = e.id and sl.return_required
    join public.inventory_catalog_items i on i.id = sl.inventory_item_id
    left join public.equipment_assets a on a.id = sl.asset_id
    cross join lateral private.s5_obligation(sl.id) o
    where s.room_id = p_room_id
      and r.status not in ('completed', 'cancelled')
      and o.issued - o.returned - o.resolved > 0
  )
  select jsonb_build_object(
    'room', (select jsonb_build_object('id', ro.id, 'room_code', ro.room_code,
        'building_code', ro.building_code, 'room_name', ro.room_name,
        'location_id', (select l.id from public.inventory_storage_locations l
          where l.room_id = ro.id and l.is_room_root))
      from public.rooms ro where ro.id = p_room_id),
    -- shortcut: rows capped at 500 per group; page them if a room ever holds more.
    'fixed', coalesce((select jsonb_agg(f order by f.name) from (select * from fixed order by name limit 500) f), '[]'::jsonb),
    'assets', coalesce((select jsonb_agg(x order by x.asset_code) from (select * from assets order by asset_code limit 500) x), '[]'::jsonb),
    'temporary', coalesce((select jsonb_agg(t order by t.return_at, t.name) from (select * from temporary order by return_at, name limit 500) t), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.room_equipment_read(uuid) from public, anon;
grant execute on function public.room_equipment_read(uuid) to authenticated;

-- One page of rooms with their counts for the room list. Counts reuse
-- room_equipment_read so both screens always agree.
create or replace function public.room_equipment_summary(
  p_query text default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  size integer := greatest(1, least(coalesce(p_page_size, 50), 100));
  page integer := greatest(1, coalesce(p_page, 1));
  total bigint;
  rows jsonb;
begin
  if not (select private.can_access_inventory()) then
    raise exception 'AUTH_DENIED: Access denied to inventory read models' using errcode = '42501';
  end if;

  select count(*) into total from public.rooms ro
  where ro.is_active and (nullif(btrim(p_query), '') is null
    or concat_ws(' ', ro.building_code, ro.room_code, ro.room_name) ilike '%' || btrim(p_query) || '%');

  -- shortcut: one room_equipment_read per listed room (at most 100 per page);
  -- move to a set-based query if the room list gets slow.
  select coalesce(jsonb_agg(jsonb_build_object(
      'room_id', ro.id, 'room_code', ro.room_code, 'building_code', ro.building_code,
      'room_name', ro.room_name, 'room_type', rt.name,
      'fixed', jsonb_array_length(d->'fixed') + jsonb_array_length(d->'assets'),
      'temporary', jsonb_array_length(d->'temporary'),
      'damaged', (select count(*) from jsonb_array_elements(d->'fixed') f where coalesce((f->>'damaged')::numeric, 0) > 0)
        + (select count(*) from jsonb_array_elements(d->'assets') a where a->>'operational_status' = 'damaged')
    ) order by ro.building_code, ro.room_code), '[]'::jsonb)
  into rows
  from (
    select * from public.rooms ro
    where ro.is_active and (nullif(btrim(p_query), '') is null
      or concat_ws(' ', ro.building_code, ro.room_code, ro.room_name) ilike '%' || btrim(p_query) || '%')
    order by ro.building_code, ro.room_code
    limit size offset (page - 1) * size
  ) ro
  left join public.room_types rt on rt.id = ro.room_type_id
  cross join lateral (select public.room_equipment_read(ro.id) as d) detail;

  return jsonb_build_object('total', total, 'page', page, 'page_size', size, 'rows', rows);
end;
$$;

revoke all on function public.room_equipment_summary(text, integer, integer) from public, anon;
grant execute on function public.room_equipment_summary(text, integer, integer) to authenticated;
