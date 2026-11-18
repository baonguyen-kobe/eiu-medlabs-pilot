-- t4e step 3 (owner decision 2026-11-18): a Skills lab room can also be used
-- by Y cơ sở. Both sides then see it in their room pickers; the existing
-- room/time exclusion keeps one booking per slot across both sides.
--
-- A room stays one record. Its room_type_id stays the primary side; only a
-- Skills lab room may add basic_medical to usage_scopes (Admin only). Basic
-- Medical schedules are already mutable only through Basic Medical RPCs
-- (guard_basic_medical_linked_schedule_mutation), so Skills permissions are
-- unchanged; Basic Medical checks that required a Basic Medical room now
-- accept a room tagged for Basic Medical.

alter table public.rooms add column if not exists usage_scopes text[];
update public.rooms r set usage_scopes = array[t.code]
from public.room_types t where t.id = r.room_type_id and r.usage_scopes is null;
update public.rooms set usage_scopes = '{nursing_skills}' where usage_scopes is null;
alter table public.rooms
  alter column usage_scopes set not null,
  add constraint rooms_usage_scopes_check
    check (cardinality(usage_scopes) between 1 and 2
      and usage_scopes <@ array['nursing_skills', 'basic_medical']);

-- The primary side is always in usage_scopes; changing it drops any sharing.
create or replace function private.sync_room_usage_scopes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  primary_code text;
begin
  select code into primary_code from public.room_types where id = new.room_type_id;
  if tg_op = 'INSERT' or new.room_type_id is distinct from old.room_type_id
     or new.usage_scopes is null then
    new.usage_scopes := array[coalesce(primary_code, 'nursing_skills')];
  end if;
  if primary_code is not null and not new.usage_scopes @> array[primary_code] then
    raise exception 'ROOM_USAGE_PRIMARY_REQUIRED' using errcode = '22023';
  end if;
  if cardinality(new.usage_scopes) > 1 and primary_code is distinct from 'nursing_skills' then
    raise exception 'ROOM_SHARE_SKILLS_ONLY' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.sync_room_usage_scopes() from public, anon, authenticated;
drop trigger if exists rooms_sync_usage_scopes on public.rooms;
create trigger rooms_sync_usage_scopes
  before insert or update on public.rooms
  for each row execute function private.sync_room_usage_scopes();

-- Admin: let Y cơ sở also use a Skills lab room, or stop it.
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
  scopes := case when p_shared then '{nursing_skills,basic_medical}'::text[] else '{nursing_skills}'::text[] end;
  update public.rooms set usage_scopes = scopes where id = room.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'room.basic_medical_sharing_changed', 'room', room.id,
    jsonb_build_object('from', room.usage_scopes, 'to', scopes));
  return scopes;
end;
$$;
revoke all on function public.set_room_shared_with_basic_medical(uuid, boolean) from public, anon;
grant execute on function public.set_room_shared_with_basic_medical(uuid, boolean) to authenticated;

-- Basic Medical users see rooms tagged for them.
drop policy if exists rooms_scoped_select on public.rooms;
create policy rooms_scoped_select on public.rooms for select to authenticated
  using ((select private.has_room_type(rooms.room_type_id))
    or (rooms.usage_scopes @> '{basic_medical}'
      and (select private.has_room_type('40000000-0000-0000-0000-000000000002'::uuid))));

-- A Basic Medical schedule is visible by its registration, wherever its room is;
-- a Skills-only viewer of a shared room does not see it.
drop policy if exists class_schedules_scoped_select on public.class_schedules;
create policy class_schedules_scoped_select on public.class_schedules for select to authenticated
  using (
    (case when class_schedules.basic_medical_registration_id is not null
       then (select private.can_view_basic_medical_registration(class_schedules.basic_medical_registration_id))
       else (select private.can_access_room(class_schedules.room_id)) end)
    and ((class_schedules.schedule_status <> 'cancelled'::public.schedule_status)
      or (select private.has_role('admin'::public.app_role))
      or (class_schedules.created_by = (select auth.uid()))));

-- Basic Medical checks that required a Basic Medical room accept a tagged one.
do $$
declare
  fn text;
  anchor text;
  sig text;
begin
  foreach sig in array array[
    'public.save_basic_medical_registration',
    'public.set_basic_medical_room_inventory',
    'private.validate_equipment_request_timing',
    'private.enqueue_basic_medical_schedule_outbox_event',
    'private.notify_basic_medical_condition_adjustment'] loop
    select replace(pg_get_functiondef(p.oid), E'\r', '') into fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname = sig;
    if fn is null then raise exception '% missing; update t4e step 3 patch', sig; end if;
    anchor := case sig
      when 'public.save_basic_medical_registration' then
        'not exists(select 1 from public.rooms where id=target_room_id and is_active and room_type_id=basic_medical_room_type_id)'
      when 'public.set_basic_medical_room_inventory' then
        'where id = target_room_id and room_type_id = basic_medical_room_type_id'
      when 'private.validate_equipment_request_timing' then
        '(new.request_domain=''basic_medical'' and target_room_type_id<>basic_medical_room_type_id)'
      when 'private.enqueue_basic_medical_schedule_outbox_event' then
        'if room_row.room_type_id <> basic_medical_room_type_id then'
      else E'    rooms.room_type_id,\n    rooms.room_code,'
    end;
    if position(anchor in fn) = 0 then raise exception '% changed; update t4e step 3 patch', sig; end if;
    execute replace(fn, anchor, case sig
      when 'public.save_basic_medical_registration' then
        'not exists(select 1 from public.rooms where id=target_room_id and is_active and usage_scopes @> ''{basic_medical}'')'
      when 'public.set_basic_medical_room_inventory' then
        'where id = target_room_id and usage_scopes @> ''{basic_medical}'''
      when 'private.validate_equipment_request_timing' then
        '(new.request_domain=''basic_medical'' and not exists(select 1 from public.class_schedules s join public.rooms r on r.id=s.room_id where s.id=new.class_schedule_id and r.usage_scopes @> ''{basic_medical}''))'
      when 'private.enqueue_basic_medical_schedule_outbox_event' then
        -- A Skills schedule in a shared room is not a Basic Medical session.
        'if room_row.room_type_id <> basic_medical_room_type_id and schedule_row.basic_medical_registration_id is null then'
      else E'    ''40000000-0000-0000-0000-000000000002''::uuid as room_type_id,\n    rooms.room_code,'
    end);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
