-- t4r2 (PILOT-REVIEW-003): "Giữ lại cho phòng" turns borrowed equipment into
-- the room's fixed equipment. It is an ordinary return whose receiving
-- location is the room location, so the ledger, the due formula and the
-- initial-return signature stay unchanged. Only an Admin may do it, and only
-- into the room of the request's own session.

-- True when p_location is p_room's root location or below it.
create or replace function private.location_in_room(p_location uuid, p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select l.id, l.parent_location_id, l.room_id, l.is_room_root
    from public.inventory_storage_locations l where l.id = p_location
    union all
    select p.id, p.parent_location_id, p.room_id, p.is_room_root
    from public.inventory_storage_locations p join up on p.id = up.parent_location_id
  )
  select exists (select 1 from up where up.is_room_root and up.room_id = p_room);
$$;

revoke all on function private.location_in_room(uuid, uuid) from public, anon, authenticated;

do $migration$
declare
  definition text;
  receive_old text := $old$then raise exception 'S5_RECEIPT_LOCATION_CONDITION_REQUIRED'; end if;$old$;
  receive_new text := $new$then raise exception 'S5_RECEIPT_LOCATION_CONDITION_REQUIRED'; end if;
  if not (select l.allow_issue from public.inventory_storage_locations l where l.id=loc) then
   if not private.has_role('admin') then raise exception 'S5_ROOM_KEEP_ADMIN_ONLY' using errcode='42501'; end if;
   if not private.location_in_room(loc,(select cs.room_id from public.equipment_requests rq join public.class_schedules cs on cs.id=rq.class_schedule_id where rq.id=e.request_id)) then
    raise exception 'S5_ROOM_KEEP_WRONG_ROOM' using errcode='22023';
   end if;
  end if;$new$;
  read_old text := $old$coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) order by name,id) from public.inventory_storage_locations),'[]'::jsonb)$old$;
  -- Store locations, plus this request's room (flagged) for "Giữ lại cho phòng".
  read_new text := $new$coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'active',l.active,'room',not l.allow_issue) order by not l.allow_issue,l.name,l.id) from public.inventory_storage_locations l where l.allow_issue or private.location_in_room(l.id,(select cs.room_id from public.class_schedules cs where cs.id=r.class_schedule_id))),'[]'::jsonb)$new$;
begin
  definition := pg_get_functiondef('private.s5_receive(uuid,jsonb,boolean)'::regprocedure);
  if position(receive_old in definition) = 0 then
    raise exception 'S5_RECEIVE_DEFINITION_CHANGED';
  end if;
  execute replace(definition, receive_old, receive_new);

  definition := pg_get_functiondef('public.equipment_fulfillment_read(uuid,integer)'::regprocedure);
  if position(read_old in definition) = 0 then
    raise exception 'EQUIPMENT_FULFILLMENT_READ_DEFINITION_CHANGED';
  end if;
  execute replace(definition, read_old, read_new);
end;
$migration$;
