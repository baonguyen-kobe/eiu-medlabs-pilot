-- t5c: rooms.room_type (free text) was replaced by room_type_id. No app code,
-- function, view or policy reads it; only rooms_active_type_idx does.
-- Refuse to drop while any row still relies on the text alone.
do $$
begin
  if exists (select 1 from public.rooms where room_type_id is null) then
    raise exception 'ROOM_TYPE_ID_MISSING: backfill room_type_id before dropping room_type';
  end if;
end;
$$;

drop index if exists public.rooms_active_type_idx;
alter table public.rooms drop column if exists room_type;
