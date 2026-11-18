-- t4e step 3 fix: rooms.usage_scopes was filled by a trigger, so rows written
-- with triggers off (fixtures, replica sessions) got no value. It is now a
-- generated column from the room type and a sharing flag, always present.

alter table public.rooms add column if not exists shared_basic_medical boolean not null default false;
update public.rooms
set shared_basic_medical = true
where usage_scopes @> '{basic_medical}'
  and room_type_id = '40000000-0000-0000-0000-000000000001'::uuid;

drop trigger if exists rooms_sync_usage_scopes on public.rooms;
drop function if exists private.sync_room_usage_scopes();
drop policy if exists rooms_scoped_select on public.rooms;
alter table public.rooms drop constraint if exists rooms_usage_scopes_check;
alter table public.rooms drop column usage_scopes;
alter table public.rooms add column usage_scopes text[] generated always as (
  case
    when room_type_id = '40000000-0000-0000-0000-000000000002'::uuid then '{basic_medical}'::text[]
    when shared_basic_medical then '{nursing_skills,basic_medical}'::text[]
    else '{nursing_skills}'::text[]
  end) stored;

create policy rooms_scoped_select on public.rooms for select to authenticated
  using ((select private.has_room_type(rooms.room_type_id))
    or (rooms.usage_scopes @> '{basic_medical}'
      and (select private.has_room_type('40000000-0000-0000-0000-000000000002'::uuid))));

create or replace function public.set_room_shared_with_basic_medical(p_room_id uuid, p_shared boolean)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  room public.rooms;
  scopes text[];
begin
  if not (select private.is_active_user()) or not (select private.has_role('admin')) then
    raise exception 'ROOM_SHARE_ADMIN_ONLY' using errcode = '42501';
  end if;
  select * into room from public.rooms where id = p_room_id for update;
  if room.id is null then
    raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if room.room_type_id <> '40000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'ROOM_SHARE_SKILLS_ONLY' using errcode = '22023',
      hint = 'Chỉ phòng Skills lab mới dùng chung với Y cơ sở được.';
  end if;
  if not p_shared and (
       exists (select 1 from public.class_schedules
               where room_id = room.id and basic_medical_registration_id is not null
                 and schedule_status <> 'cancelled' and schedule_date >= current_date)
    or exists (select 1 from public.basic_medical_room_inventory
               where room_id = room.id and is_active)) then
    raise exception 'ROOM_SHARE_IN_USE' using errcode = '23503',
      hint = 'Phòng đang có buổi Y cơ sở sắp tới hoặc tồn thiết bị Y cơ sở; chưa bỏ dùng chung được.';
  end if;
  update public.rooms set shared_basic_medical = p_shared where id = room.id
  returning usage_scopes into scopes;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'room.basic_medical_sharing_changed', 'room', room.id,
    jsonb_build_object('from', room.usage_scopes, 'to', scopes));
  return scopes;
end;
$$;

notify pgrst, 'reload schema';
