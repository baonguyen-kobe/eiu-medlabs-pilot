-- t4r1 (PILOT-REVIEW-003): every room has one root storage location. Stock or
-- assets held there are the room's fixed equipment, so preparation may not
-- pick them as an issue source (allow_issue = false). Lending fixed equipment
-- to another room is deferred to G5.

alter table public.inventory_storage_locations
  add column if not exists is_room_root boolean not null default false,
  add column if not exists allow_issue boolean not null default true;

alter table public.inventory_storage_locations
  drop constraint if exists inventory_storage_locations_room_root_needs_room,
  add constraint inventory_storage_locations_room_root_needs_room
    check (not is_room_root or room_id is not null);

create unique index if not exists inventory_storage_locations_one_root_per_room
  on public.inventory_storage_locations (room_id) where is_room_root;

-- Idempotent: returns the room's root, creating it on first use.
create or replace function private.ensure_room_root_location(p_room_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  room public.rooms;
  root_id uuid;
  base_code text;
begin
  select id into root_id from public.inventory_storage_locations
  where room_id = p_room_id and is_room_root;
  if root_id is not null then return root_id; end if;

  select * into strict room from public.rooms where id = p_room_id;
  base_code := 'PHONG-' || upper(regexp_replace(
    concat_ws('-', nullif(btrim(room.building_code), ''), btrim(room.room_code)), '\s+', '', 'g'));
  insert into public.inventory_storage_locations (code, name, room_id, is_room_root, allow_issue, active)
  values (
    -- A clashing code (an existing manual location) gets the room id suffix.
    case when exists (select 1 from public.inventory_storage_locations where code = base_code)
      then base_code || '-' || left(room.id::text, 8) else base_code end,
    'Phòng ' || concat_ws('-', nullif(btrim(room.building_code), ''), btrim(room.room_code)),
    room.id, true, false, room.is_active)
  returning id into root_id;
  return root_id;
end;
$$;

revoke all on function private.ensure_room_root_location(uuid) from public, anon, authenticated;

create or replace function private.provision_room_root_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.ensure_room_root_location(new.id);
  if tg_op = 'UPDATE' and new.is_active is distinct from old.is_active then
    update public.inventory_storage_locations set active = new.is_active
    where room_id = new.id and is_room_root;
  end if;
  return new;
end;
$$;

revoke all on function private.provision_room_root_location() from public, anon, authenticated;

drop trigger if exists rooms_provision_root_location on public.rooms;
create trigger rooms_provision_root_location
  after insert or update of is_active on public.rooms
  for each row execute function private.provision_room_root_location();

select private.ensure_room_root_location(id) from public.rooms order by room_code;

-- Deleting a room takes its unused root location with it. A root that holds
-- stock, history or child locations keeps the room (its FKs refuse).
create or replace function private.release_room_root_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.inventory_storage_locations where room_id = old.id and is_room_root;
  return old;
end;
$$;

revoke all on function private.release_room_root_location() from public, anon, authenticated;

drop trigger if exists rooms_release_root_location on public.rooms;
create trigger rooms_release_root_location
  before delete on public.rooms
  for each row execute function private.release_room_root_location();

-- Room locations are never an issue source. Patch the live definitions and
-- fail loudly if they have drifted (pattern of 20261117100000).
do $migration$
declare
  definition text;
  commit_old text := $old$where l.id=(a->>'location_id')::uuid and l.active) then raise exception 'S4_INVALID_SOURCE'$old$;
  commit_new text := $new$where l.id=(a->>'location_id')::uuid and l.active and l.allow_issue) then raise exception 'S4_INVALID_SOURCE'$new$;
  asset_old text := $old$and i.active and l.active and a.lifecycle_status='in_service'$old$;
  asset_new text := $new$and i.active and l.active and l.allow_issue and a.lifecycle_status='in_service'$new$;
begin
  definition := pg_get_functiondef('private.s4_commit_plan(uuid,jsonb,text)'::regprocedure);
  if position(commit_old in definition) = 0 then
    raise exception 'S4_COMMIT_PLAN_DEFINITION_CHANGED';
  end if;
  execute replace(definition, commit_old, commit_new);

  definition := pg_get_functiondef('private.s4_asset_eligible(uuid,uuid)'::regprocedure);
  if position(asset_old in definition) = 0 then
    raise exception 'S4_ASSET_ELIGIBLE_DEFINITION_CHANGED';
  end if;
  execute replace(definition, asset_old, asset_new);
end;
$migration$;
