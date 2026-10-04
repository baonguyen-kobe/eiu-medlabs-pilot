-- Room-type authorization, Y co so access and student counts.
create table if not exists public.room_types (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_types_code_not_blank check (btrim(code) <> ''),
  constraint room_types_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists room_types_code_unique_idx
  on public.room_types (lower(btrim(code)));
create unique index if not exists room_types_name_unique_idx
  on public.room_types (lower(btrim(name)));

insert into public.room_types (id, code, name)
values
  ('40000000-0000-0000-0000-000000000001', 'nursing_skills', 'Kỹ năng Điều dưỡng'),
  ('40000000-0000-0000-0000-000000000002', 'basic_medical', 'Y cơ sở')
on conflict (id) do update set code = excluded.code, name = excluded.name;

alter table public.profiles
  add column if not exists allow_basic_medical_access boolean not null default false;
alter table public.profiles
  add column if not exists allow_early_equipment_handover boolean not null default false;
alter table public.profiles
  add column if not exists can_import_schedules boolean not null default false;
alter table public.profiles
  add column if not exists access_version integer not null default 1;

alter table public.rooms
  add column if not exists room_type_id uuid references public.room_types(id) on delete restrict;

update public.rooms
set room_type_id = case
  when lower(btrim(coalesce(room_type, ''))) in ('y cơ sở', 'y co so', 'basic_medical')
    then '40000000-0000-0000-0000-000000000002'::uuid
  else '40000000-0000-0000-0000-000000000001'::uuid
end
where room_type_id is null;

alter table public.rooms
  alter column room_type_id set default '40000000-0000-0000-0000-000000000001'::uuid,
  alter column room_type_id set not null;

create index if not exists rooms_room_type_id_idx
  on public.rooms (room_type_id, is_active, building_code, room_code);

create table if not exists public.profile_room_types (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  room_type_id uuid not null references public.room_types(id) on delete cascade,
  receive_schedule_emails boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  primary key (profile_id, room_type_id)
);

alter table public.profile_room_types
  add column if not exists receive_schedule_emails boolean not null default false;

create index if not exists profile_room_types_room_type_idx
  on public.profile_room_types (room_type_id, profile_id);

alter table public.import_batches
  add column if not exists room_type_id uuid references public.room_types(id) on delete restrict;

update public.import_batches as batches
set room_type_id = coalesce(
  (
    select rooms.room_type_id
    from public.class_schedules as schedules
    join public.rooms as rooms on rooms.id = schedules.room_id
    where schedules.import_batch_id = batches.id
    order by schedules.created_at
    limit 1
  ),
  '40000000-0000-0000-0000-000000000001'::uuid
)
where batches.room_type_id is null;

alter table public.import_batches
  alter column room_type_id set default '40000000-0000-0000-0000-000000000001'::uuid,
  alter column room_type_id set not null;

create index if not exists import_batches_room_type_idx
  on public.import_batches (room_type_id, created_at desc);

alter table public.class_schedules
  add column if not exists student_count integer;

update public.class_schedules set student_count = 1 where student_count is null;
alter table public.class_schedules
  alter column student_count set default 1,
  alter column student_count set not null;
alter table public.class_schedules
  drop constraint if exists class_schedules_student_count_positive;
alter table public.class_schedules
  add constraint class_schedules_student_count_positive check (student_count >= 1);

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.has_role('admin'));
$$;

create or replace function private.has_room_type(target_room_type_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_active_user()) and (
    (select private.has_role('admin'))
    or exists (
      select 1
      from public.profile_room_types as assignments
      join public.user_roles as roles on roles.user_id = assignments.profile_id
      where assignments.profile_id = (select auth.uid())
        and assignments.room_type_id = target_room_type_id
    )
  );
$$;

create or replace function private.can_access_room(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rooms as rooms
    where rooms.id = target_room_id
      and (select private.has_room_type(rooms.room_type_id))
  );
$$;

create or replace function private.can_manage_class_room(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.can_access_room(target_room_id)) and exists (
    select 1
    from public.user_roles as roles
    where roles.user_id = (select auth.uid())
      and roles.role in ('admin', 'staff')
  );
$$;

create or replace function private.can_import_schedules(target_room_type_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_active_user()) and (
    (select private.has_role('admin'))
    or (
      exists (
        select 1 from public.profiles profiles
        where profiles.id = (select auth.uid())
          and profiles.can_import_schedules
      )
      and exists (
        select 1 from public.user_roles roles
        where roles.user_id = (select auth.uid())
          and roles.role in ('staff', 'lecturer', 'teaching_assistant')
      )
      and exists (
        select 1 from public.profile_room_types scopes
        where scopes.profile_id = (select auth.uid())
          and scopes.room_type_id = target_room_type_id
      )
    )
  );
$$;

create or replace function private.can_create_manual_schedule_for(
  target_room_id uuid,
  target_lecturer_ids uuid[]
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_room_type_id uuid;
  lecturer_ids uuid[] := array_remove(coalesce(target_lecturer_ids, '{}'::uuid[]), null);
  valid_lecturers boolean := false;
begin
  if actor_id is null or not (select private.is_active_user()) then return false; end if;
  select rooms.room_type_id into target_room_type_id
  from public.rooms rooms where rooms.id = target_room_id and rooms.is_active;
  if target_room_type_id is null or not (select private.has_room_type(target_room_type_id)) then
    return false;
  end if;
  if cardinality(lecturer_ids) > 2
    or cardinality(lecturer_ids) <> cardinality(array(select distinct unnest(lecturer_ids))) then
    return false;
  end if;
  valid_lecturers := not exists (
    select 1 from unnest(lecturer_ids) requested(id)
    where not exists (
      select 1 from public.profiles profiles
      where profiles.id = requested.id and profiles.is_active
        and exists (select 1 from public.user_roles roles where roles.user_id = profiles.id and roles.role = 'lecturer')
        and exists (select 1 from public.profile_room_types scopes where scopes.profile_id = profiles.id and scopes.room_type_id = target_room_type_id)
    )
  );
  if not valid_lecturers then return false; end if;
  if (select private.has_role('admin')) then return true; end if;
  if (select private.has_role('staff')) then return true; end if;
  if (select private.has_role('teaching_assistant')) then
    return cardinality(lecturer_ids) > 0;
  end if;
  if (select private.has_role('lecturer')) then
    return cardinality(lecturer_ids) > 0 and actor_id = any(lecturer_ids);
  end if;
  return false;
end;
$$;

create or replace function private.can_modify_class_schedule(
  target_schedule_id uuid,
  target_action text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  schedule_row public.class_schedules;
  room_type_value uuid;
  in_scope boolean := false;
  import_batch_owns boolean := false;
  lecturer_is_related boolean := false;
  can_admin boolean := false;
  can_staff boolean := false;
  can_import_owner boolean := false;
  can_teaching_assistant boolean := false;
  can_lecturer boolean := false;
begin
  if actor_id is null or not (select private.is_active_user())
    or target_action not in ('assign_lecturers', 'reschedule', 'details', 'delete') then
    return false;
  end if;
  select schedules.* into schedule_row from public.class_schedules schedules
  where schedules.id = target_schedule_id and schedules.schedule_status <> 'cancelled';
  if schedule_row.id is null then return false; end if;
  select rooms.room_type_id into room_type_value from public.rooms rooms
  where rooms.id = schedule_row.room_id;
  in_scope := room_type_value is not null
    and (select private.has_room_type(room_type_value));
  import_batch_owns := schedule_row.source = 'import' and exists (
    select 1 from public.import_batches batches
    where batches.id = schedule_row.import_batch_id
      and batches.created_by = actor_id
  );
  lecturer_is_related := schedule_row.created_by = actor_id
    or coalesce(actor_id in (schedule_row.lecturer_id, schedule_row.lecturer_2_id), false);
  can_admin := (select private.has_role('admin'));
  can_staff := (select private.has_role('staff')) and in_scope;
  can_import_owner := in_scope and import_batch_owns
    and exists (select 1 from public.profiles profiles where profiles.id=actor_id and profiles.is_active and profiles.can_import_schedules)
    and exists (select 1 from public.user_roles roles where roles.user_id=actor_id and roles.role in ('staff','lecturer','teaching_assistant'));
  can_teaching_assistant := (select private.has_role('teaching_assistant'))
    and in_scope
    and schedule_row.created_by = actor_id;
  if (select private.has_role('lecturer')) and target_action in ('reschedule', 'details') then
    can_lecturer := in_scope and lecturer_is_related;
  end if;
  if (select private.has_role('lecturer')) and target_action = 'delete' then
    can_lecturer := in_scope
      and schedule_row.created_by = actor_id
      and room_type_value = '40000000-0000-0000-0000-000000000001'::uuid;
  end if;
  if (select private.has_role('lecturer')) and target_action = 'assign_lecturers' then
    can_lecturer := in_scope and schedule_row.created_by = actor_id;
  end if;
  return coalesce(can_admin, false)
    or coalesce(can_staff, false)
    or coalesce(can_import_owner, false)
    or coalesce(can_teaching_assistant, false)
    or coalesce(can_lecturer, false);
end;
$$;

create or replace function private.profile_has_room_type(
  target_profile_id uuid,
  target_room_type_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles as profiles
    where profiles.id = target_profile_id and profiles.is_active
      and exists (
        select 1 from public.profile_room_types as assignments
        where assignments.profile_id = target_profile_id
          and assignments.room_type_id = target_room_type_id
      )
  );
$$;

revoke execute on function private.is_admin() from public, anon;
revoke execute on function private.has_room_type(uuid) from public, anon;
revoke execute on function private.can_access_room(uuid) from public, anon;
revoke execute on function private.can_manage_class_room(uuid) from public, anon;
revoke all on function private.can_import_schedules(uuid) from public, anon;
revoke all on function private.can_create_manual_schedule_for(uuid, uuid[]) from public, anon;
revoke all on function private.can_modify_class_schedule(uuid, text) from public, anon;
revoke execute on function private.profile_has_room_type(uuid, uuid) from public, anon;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.has_room_type(uuid) to authenticated;
grant execute on function private.can_access_room(uuid) to authenticated;
grant execute on function private.can_manage_class_room(uuid) to authenticated;
grant execute on function private.can_import_schedules(uuid) to authenticated;
grant execute on function private.can_create_manual_schedule_for(uuid, uuid[]) to authenticated;
grant execute on function private.can_modify_class_schedule(uuid, text) to authenticated;
grant execute on function private.profile_has_room_type(uuid, uuid) to authenticated;

alter table public.room_types enable row level security;
alter table public.profile_room_types enable row level security;

create policy room_types_scoped_select on public.room_types
for select to authenticated
using (
  (select private.has_role('admin'))
  or exists (
    select 1 from public.profile_room_types as assignments
    where assignments.profile_id = (select auth.uid())
      and assignments.room_type_id = id
  )
);

create policy room_types_admin_all on public.room_types
for all to authenticated
using ((select private.has_role('admin')))
with check ((select private.has_role('admin')));

create policy profile_room_types_own_select on public.profile_room_types
for select to authenticated
using (profile_id = (select auth.uid()) or (select private.has_role('admin')));

create policy profile_room_types_admin_all on public.profile_room_types
for all to authenticated
using ((select private.has_role('admin')))
with check ((select private.has_role('admin')));

drop policy if exists rooms_select_active_users on public.rooms;
create policy rooms_scoped_select on public.rooms
for select to authenticated
using ((select private.has_room_type(room_type_id)));

drop policy if exists class_schedules_select on public.class_schedules;
create policy class_schedules_scoped_select on public.class_schedules
for select to authenticated
using (
  (select private.can_access_room(room_id))
  and (
    schedule_status <> 'cancelled'
    or (select private.has_role('admin'))
    or created_by = (select auth.uid())
  )
);

drop policy if exists class_schedules_creator_insert on public.class_schedules;
create policy class_schedules_scoped_insert on public.class_schedules
for insert to authenticated
with check (
  (
    (select private.can_create_manual_schedule_for(
      room_id,
      array_remove(array[lecturer_id, lecturer_2_id]::uuid[], null)
    ))
  )
  and created_by = (select auth.uid())
  and source = 'manual'
  and schedule_status = 'published'
  and published_by = (select auth.uid())
  and published_at is not null
  and cancelled_at is null
  and cancelled_by is null
  and student_count >= 1
  and (
    basic_medical_registration_id is null
    or exists (
      select 1
      from public.basic_medical_registrations as registration
      where registration.id = basic_medical_registration_id
        and registration.created_by = (select auth.uid())
    )
  )
  and (
    lecturer_id is null
    or exists (
      select 1 from public.rooms as selected_room
      where selected_room.id = room_id
        and (select private.profile_has_room_type(lecturer_id, selected_room.room_type_id))
        and (
          exists (
            select 1 from public.user_roles as lecturer_role
            where lecturer_role.user_id = lecturer_id and lecturer_role.role = 'lecturer'
          )
          or (
            basic_medical_registration_id is not null
            and exists (
              select 1 from public.profiles as lecturer_profile
              where lecturer_profile.id = lecturer_id
                and lecturer_profile.is_active
                and lower(btrim(coalesce(lecturer_profile.title, ''))) = 'giảng viên'
            )
          )
        )
    )
  )
  and (
    lecturer_2_id is null
    or exists (
      select 1 from public.rooms as selected_room
      where selected_room.id = room_id
        and (select private.profile_has_room_type(lecturer_2_id, selected_room.room_type_id))
        and (
          exists (
            select 1 from public.user_roles as lecturer_role
            where lecturer_role.user_id = lecturer_2_id and lecturer_role.role = 'lecturer'
          )
          or (
            basic_medical_registration_id is not null
            and exists (
              select 1 from public.profiles as lecturer_profile
              where lecturer_profile.id = lecturer_2_id
                and lecturer_profile.is_active
                and lower(btrim(coalesce(lecturer_profile.title, ''))) = 'giảng viên'
            )
          )
        )
    )
  )
);

drop policy if exists class_schedules_authorized_delete on public.class_schedules;
create policy class_schedules_scoped_delete on public.class_schedules
for delete to authenticated
using (
  (select private.can_modify_class_schedule(id, 'delete'))
);

drop policy if exists import_batches_select on public.import_batches;
create policy import_batches_scoped_select on public.import_batches
for select to authenticated
using (
  (select private.has_room_type(room_type_id))
  and (
    (created_by = (select auth.uid()) and (select private.can_import_schedules(room_type_id)))
    or (select private.has_role('admin'))
    or (select private.has_role('staff'))
  )
);

drop policy if exists import_batches_insert on public.import_batches;
create policy import_batches_scoped_insert on public.import_batches
for insert to authenticated
with check (
  (select private.can_import_schedules(room_type_id))
  and created_by = (select auth.uid())
);

drop policy if exists import_batches_owner_update on public.import_batches;
create policy import_batches_scoped_update on public.import_batches
for update to authenticated
using (
  (select private.has_room_type(room_type_id))
  and (
    (select private.has_role('admin'))
    or ((select private.can_import_schedules(room_type_id)) and created_by = (select auth.uid()) and status not in ('completed', 'failed'))
  )
)
with check (
  (select private.has_room_type(room_type_id))
  and ((select private.has_role('admin')) or ((select private.can_import_schedules(room_type_id)) and created_by = (select auth.uid())))
);

grant select on public.room_types, public.profile_room_types to authenticated;
grant all on public.room_types, public.profile_room_types to authenticated;
grant select, insert, update on public.room_types, public.profile_room_types to service_role;

create or replace function public.list_scoped_lecturers(target_room_type_id uuid)
returns table (id uuid, full_name text, title text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.has_room_type(target_room_type_id)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;

  return query
  select profiles.id, profiles.full_name, profiles.title
  from public.profiles as profiles
  where profiles.is_active
    and exists (
      select 1 from public.user_roles as roles
      where roles.user_id = profiles.id and roles.role = 'lecturer'
    )
    and exists (
      select 1 from public.profile_room_types as assignments
      where assignments.profile_id = profiles.id
        and assignments.room_type_id = target_room_type_id
    )
  order by profiles.full_name;
end;
$$;

revoke all on function public.list_scoped_lecturers(uuid) from public, anon;
grant execute on function public.list_scoped_lecturers(uuid) to authenticated;

create or replace function public.list_basic_medical_instructors()
returns table (id uuid, full_name text, title text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  basic_medical_room_type_id constant uuid := '40000000-0000-0000-0000-000000000002'::uuid;
begin
  if not (select private.has_room_type(basic_medical_room_type_id)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;

  return query
  select profiles.id, profiles.full_name, profiles.title
  from public.profiles as profiles
  where profiles.is_active
    and lower(btrim(coalesce(profiles.title, ''))) = 'giảng viên'
    and exists (
      select 1 from public.profile_room_types as assignments
      where assignments.profile_id = profiles.id
        and assignments.room_type_id = basic_medical_room_type_id
    )
  order by profiles.full_name;
end;
$$;

revoke all on function public.list_basic_medical_instructors() from public, anon;
grant execute on function public.list_basic_medical_instructors() to authenticated;

create or replace function public.list_scoped_import_lecturers(target_room_type_id uuid)
returns table (id uuid, full_name text, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.can_import_schedules(target_room_type_id)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  return query
  select profiles.id, profiles.full_name, profiles.email
  from public.profiles as profiles
  where profiles.is_active
    and exists (select 1 from public.user_roles as roles where roles.user_id = profiles.id and roles.role = 'lecturer')
    and exists (select 1 from public.profile_room_types as assignments where assignments.profile_id = profiles.id and assignments.room_type_id = target_room_type_id)
  order by profiles.full_name;
end;
$$;

revoke all on function public.list_scoped_import_lecturers(uuid) from public, anon;
grant execute on function public.list_scoped_import_lecturers(uuid) to authenticated;

create or replace function public.list_active_people()
returns table (id uuid, full_name text, title text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_user()) then
    raise exception 'Tài khoản không hoạt động hoặc không có quyền truy cập.'
      using errcode = '42501';
  end if;

  return query
  select profiles.id, profiles.full_name, profiles.title
  from public.profiles as profiles
  where profiles.is_active
    and (
      (select private.is_admin())
      or exists (
        select 1
        from public.profile_room_types as viewer_scope
        join public.profile_room_types as person_scope
          on person_scope.room_type_id = viewer_scope.room_type_id
        where viewer_scope.profile_id = (select auth.uid())
          and person_scope.profile_id = profiles.id
      )
    )
  order by profiles.full_name;
end;
$$;

revoke all on function public.list_active_people() from public, anon;
grant execute on function public.list_active_people() to authenticated;

create or replace function public.assign_class_lecturers(
  target_schedule_id uuid,
  target_lecturer_ids uuid[]
)
returns public.class_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_row public.class_schedules;
  room_type_value uuid;
  normalized_ids uuid[];
begin
  select schedules.*
  into target_row
  from public.class_schedules as schedules
  where schedules.id = target_schedule_id
  for update;

  if target_row.id is null then
    raise exception 'CLASS_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  select rooms.room_type_id into room_type_value
  from public.rooms as rooms where rooms.id = target_row.room_id;
  if not (select private.can_modify_class_schedule(target_schedule_id, 'assign_lecturers')) then
    raise exception 'CLASS_MANAGEMENT_SCOPE_REQUIRED' using errcode = '42501';
  end if;

  normalized_ids := array_remove(coalesce(target_lecturer_ids, '{}'::uuid[]), null);

  if cardinality(normalized_ids) > 2 then
    raise exception 'TOO_MANY_CLASS_LECTURERS' using errcode = '22023';
  end if;
  if cardinality(normalized_ids) <> cardinality(array_remove(coalesce(target_lecturer_ids, '{}'::uuid[]), null)) then
    raise exception 'DUPLICATE_CLASS_LECTURER' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(normalized_ids) as requested(id)
    where not exists (
      select 1
      from public.profiles as profiles
      where profiles.id = requested.id
        and profiles.is_active
        and exists (
          select 1 from public.user_roles as roles
          where roles.user_id = profiles.id and roles.role = 'lecturer'
        )
        and exists (
          select 1 from public.profile_room_types as assignments
          where assignments.profile_id = profiles.id
            and assignments.room_type_id = room_type_value
        )
    )
  ) then
    raise exception 'LECTURER_ROOM_TYPE_MISMATCH' using errcode = '42501';
  end if;
  if (select private.has_role('lecturer'))
    and not ((select private.has_role('admin')) or (select private.has_role('staff')) or (select private.has_role('teaching_assistant')))
    and (select auth.uid()) <> all(normalized_ids) then
    raise exception 'LECTURER_MUST_REMAIN_ASSIGNED' using errcode = '42501';
  end if;

  update public.class_schedules
  set lecturer_id = normalized_ids[1],
      lecturer_2_id = normalized_ids[2],
      updated_at = now()
  where id = target_schedule_id
  returning * into target_row;
  return target_row;
exception
  when exclusion_violation then
    raise exception 'LECTURER_SCHEDULE_CONFLICT' using errcode = '23P01';
end;
$$;

revoke all on function public.assign_class_lecturers(uuid, uuid[]) from public, anon;
grant execute on function public.assign_class_lecturers(uuid, uuid[]) to authenticated;

create or replace function public.reschedule_class(
  target_schedule_id uuid,
  target_schedule_date date
)
returns public.class_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.class_schedules;
  changed_row public.class_schedules;
  room_type_value uuid;
  room_type_code_value text;
  change_id uuid := gen_random_uuid();
  room_label text;
  actor_name text;
  lecturer_name text;
  schedule_code text;
begin
  if target_schedule_date is null then
    raise exception 'INVALID_SCHEDULE_DATE' using errcode = '22023';
  end if;

  select schedules.*
  into before_row
  from public.class_schedules as schedules
  where schedules.id = target_schedule_id
    and schedules.schedule_status <> 'cancelled'
  for update;

  if before_row.id is null then
    raise exception 'CLASS_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  select rooms.room_type_id, room_types.code,
         concat_ws(' · ', rooms.room_code, rooms.building_code)
  into room_type_value, room_type_code_value, room_label
  from public.rooms as rooms
  join public.room_types as room_types on room_types.id = rooms.room_type_id
  where rooms.id = before_row.room_id;
  select profiles.full_name into actor_name
  from public.profiles as profiles where profiles.id = (select auth.uid());
  select pg_catalog.string_agg(profiles.full_name, ' · ' order by profiles.full_name)
  into lecturer_name
  from public.profiles as profiles
  where profiles.id in (before_row.lecturer_id, before_row.lecturer_2_id);
  schedule_code := to_char(
    before_row.created_at at time zone 'Asia/Ho_Chi_Minh',
    'YYMMDDHH24MISS'
  );
  if not (select private.can_modify_class_schedule(target_schedule_id, 'reschedule')) then
    raise exception 'CLASS_DATE_CHANGE_FORBIDDEN' using errcode = '42501';
  end if;

  update public.class_schedules
  set schedule_date = target_schedule_date,
      updated_at = now()
  where id = target_schedule_id
  returning * into changed_row;

  if target_schedule_date is distinct from before_row.schedule_date then
    insert into public.email_notifications (
      notification_type, recipient_id, recipient_email, dedupe_key, subject, payload
    )
    select
      case when room_type_code_value = 'basic_medical'
        then 'class_schedule_basic_medical_updated'
        else 'class_schedule_rescheduled' end,
      recipients.id, recipients.email,
      concat(
        case when room_type_code_value = 'basic_medical'
          then 'class_schedule_basic_medical_updated:'
          else 'class_schedule_rescheduled:' end,
        change_id, ':', recipients.id
      ),
      case when room_type_code_value = 'basic_medical'
        then concat(
          '[MedLabs Calendar] Đổi ngày học Y cơ sở · ',
          before_row.course_code_snapshot
        )
        else concat(
          '[MedLabs Calendar] Đổi ngày học của ',
          coalesce(lecturer_name, 'Chưa có giảng viên'),
          ' - ', before_row.course_code_snapshot,
          ' - ', to_char(changed_row.schedule_date, 'DD/MM/YYYY'),
          ' - ', schedule_code
        )
      end,
      jsonb_build_object(
        'schedule_id', before_row.id,
        'course_code', before_row.course_code_snapshot,
        'course_name', before_row.course_name_snapshot,
        'old_schedule_date', before_row.schedule_date,
        'schedule_date', changed_row.schedule_date,
        'start_time', before_row.start_time,
        'end_time', before_row.end_time,
        'room', room_label,
        'student_count', before_row.student_count,
        'lecturer', coalesce(lecturer_name, 'Chưa có giảng viên'),
        'request_code', schedule_code,
        'actor', coalesce(actor_name, 'Người dùng hệ thống'),
        'room_type_code', room_type_code_value
      )
    from public.profiles as recipients
    where recipients.is_active
      and (
        recipients.id in (before_row.lecturer_id, before_row.lecturer_2_id)
        or (
          room_type_code_value <> 'basic_medical'
          and recipients.id = before_row.created_by
        )
        or exists (
          select 1 from public.user_roles as roles
          where roles.user_id = recipients.id
            and roles.role in ('admin', 'staff', 'viewer')
            and (
              roles.role = 'admin'
              or exists (
                select 1 from public.profile_room_types as assignments
                where assignments.profile_id = recipients.id
                  and assignments.room_type_id = room_type_value
                  and (
                    roles.role <> 'viewer'
                    or assignments.receive_schedule_emails
                  )
              )
            )
        )
      )
    on conflict (dedupe_key) do nothing;
  end if;

  return changed_row;
exception
  when exclusion_violation then
    raise exception 'ROOM_OR_LECTURER_SCHEDULE_CONFLICT' using errcode = '23P01';
end;
$$;

revoke all on function public.reschedule_class(uuid, date) from public, anon;
grant execute on function public.reschedule_class(uuid, date) to authenticated;

create or replace function private.import_schedule_business_key(
  target_course_code text, target_room_id uuid, target_date date,
  target_start time, target_end time
)
returns text language sql immutable set search_path = '' as $$
  select concat(
    length(upper(btrim(coalesce(target_course_code, '')))), ':', upper(btrim(coalesce(target_course_code, ''))),
    length(target_room_id::text), ':', target_room_id::text,
    length(target_date::text), ':', target_date::text,
    length(to_char(target_start, 'HH24:MI:SS')), ':', to_char(target_start, 'HH24:MI:SS'),
    length(to_char(target_end, 'HH24:MI:SS')), ':', to_char(target_end, 'HH24:MI:SS')
  );
$$;

create or replace function private.import_schedule_hash(
  target_course_code text, target_room_id uuid, target_date date,
  target_start time, target_end time
)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(private.import_schedule_business_key(
    target_course_code, target_room_id, target_date, target_start, target_end
  ), 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.create_import_schedule_row(
  target_batch_id uuid, target_row_number integer, target_hash text,
  target_raw jsonb, target_normalized jsonb, target_status public.import_row_status,
  target_errors jsonb, target_warnings jsonb, target_course_id uuid,
  target_course_code text, target_course_name text, target_room_id uuid,
  target_lecturer_id uuid, target_date date, target_start time, target_end time,
  target_note text, target_student_count integer, target_semester text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  schedule_id uuid;
  batch_room_type_id uuid;
  selected_room_type_id uuid;
  canonical_hash text;
  nursing_skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
begin
  if target_status not in ('imported', 'warning') then
    raise exception 'INVALID_IMPORT_ROW_STATUS' using errcode = '22023';
  end if;
  if target_student_count is null or target_student_count < 1 then
    raise exception 'INVALID_STUDENT_COUNT' using errcode = '22023';
  end if;
  if target_date is null or target_start is null or target_end is null or target_end <= target_start then
    raise exception 'INVALID_IMPORT_SCHEDULE' using errcode = '22023';
  end if;
  select batches.room_type_id into batch_room_type_id
  from public.import_batches as batches
  where batches.id = target_batch_id and batches.created_by = caller_id and batches.status = 'importing';
  if batch_room_type_id is null then
    raise exception 'IMPORT_BATCH_NOT_WRITABLE' using errcode = '42501';
  end if;
  if not (select private.can_import_schedules(batch_room_type_id)) then
    raise exception 'IMPORT_PERMISSION_REQUIRED' using errcode = '42501';
  end if;
  if batch_room_type_id = nursing_skills_room_type_id then
    if target_semester is null or target_semester not in ('HK1', 'HK2', 'HK3', 'HK4') then
      raise exception 'Học kỳ phải là HK1, HK2, HK3 hoặc HK4.' using errcode = '22023';
    end if;
  elsif target_semester is not null and target_semester not in ('HK1', 'HK2', 'HK3', 'HK4') then
    raise exception 'Học kỳ phải là HK1, HK2, HK3 hoặc HK4.' using errcode = '22023';
  end if;
  select rooms.room_type_id into selected_room_type_id from public.rooms as rooms where rooms.id = target_room_id;
  if selected_room_type_id is null or selected_room_type_id <> batch_room_type_id
     or not (select private.has_room_type(selected_room_type_id)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  if target_lecturer_id is not null and not (
    (select private.profile_has_room_type(target_lecturer_id, selected_room_type_id))
    and exists (select 1 from public.user_roles as roles where roles.user_id = target_lecturer_id and roles.role = 'lecturer')
  ) then
    raise exception 'LECTURER_ROOM_TYPE_MISMATCH' using errcode = '42501';
  end if;

  canonical_hash := private.import_schedule_hash(target_course_code, target_room_id, target_date, target_start, target_end);
  if target_hash is distinct from canonical_hash then
    raise exception 'INVALID_IMPORT_HASH' using errcode = '22023';
  end if;
  -- Serialize the DB-derived business key; caller-supplied random hashes cannot bypass this lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(canonical_hash, 0));
  if exists (
    select 1 from public.class_schedules schedules
    where schedules.schedule_status <> 'cancelled'
      and schedules.room_id = target_room_id and schedules.schedule_date = target_date
      and schedules.start_time = target_start and schedules.end_time = target_end
      and upper(btrim(schedules.course_code_snapshot)) = upper(btrim(target_course_code))
  ) then
    raise exception 'IMPORT_ROW_DUPLICATE' using errcode = '23505';
  end if;

  insert into public.class_schedules (
    course_id, course_code_snapshot, course_name_snapshot, room_id,
    lecturer_id, class_code, schedule_date, start_time, end_time,
    source, source_row_id, import_batch_id, schedule_status, note, student_count, semester,
    created_by, published_by, published_at
  ) values (
    target_course_id, target_course_code, target_course_name, target_room_id,
    target_lecturer_id, null, target_date, target_start, target_end,
    'import', null, target_batch_id, 'published', target_note, target_student_count, target_semester,
    caller_id, caller_id, now()
  ) returning id into schedule_id;

  insert into public.import_rows (
    import_batch_id, row_number, source_row_id, normalized_row_hash,
    raw_data, normalized_data, validation_status, errors, warnings, class_schedule_id
  ) values (
    target_batch_id, target_row_number, null, canonical_hash,
    coalesce(target_raw, '{}'::jsonb), coalesce(target_normalized, '{}'::jsonb),
    target_status, coalesce(target_errors, '[]'::jsonb),
    coalesce(target_warnings, '[]'::jsonb), schedule_id
  );
  return schedule_id;
exception when exclusion_violation then
  raise exception 'SCHEDULE_CONFLICT' using errcode = '23P01';
end;
$$;

revoke all on function public.create_import_schedule_row(
  uuid, integer, text, jsonb, jsonb, public.import_row_status, jsonb, jsonb,
  uuid, text, text, uuid, uuid, date, time, time, text, integer, text
) from public, anon;
revoke all on function private.import_schedule_business_key(text, uuid, date, time, time) from public, anon, authenticated;
revoke all on function private.import_schedule_hash(text, uuid, date, time, time) from public, anon, authenticated;
grant execute on function public.create_import_schedule_row(
  uuid, integer, text, jsonb, jsonb, public.import_row_status, jsonb, jsonb,
  uuid, text, text, uuid, uuid, date, time, time, text, integer, text
) to authenticated;

-- The legacy overload does not carry student_count or room-type scope checks.
revoke all on function public.create_import_schedule_row(
  uuid, integer, text, jsonb, jsonb, public.import_row_status, jsonb, jsonb,
  uuid, text, text, uuid, uuid, date, time, time, text
) from public, anon, authenticated;
drop function if exists public.create_import_schedule_row(
  uuid, integer, text, jsonb, jsonb, public.import_row_status, jsonb, jsonb,
  uuid, text, text, uuid, uuid, date, time, time, text
);
drop function if exists public.create_import_schedule_row(
  uuid, integer, text, jsonb, jsonb, public.import_row_status, jsonb, jsonb,
  uuid, text, text, uuid, uuid, date, time, time, text, integer
);

-- Keep the details RPC in the declarative schema as well as the migration chain.
create or replace function public.update_class_schedule_details(
  target_schedule_id uuid,
  target_schedule_date date,
  target_start_time time,
  target_end_time time,
  target_room_id uuid,
  target_student_count integer,
  target_lecturer_ids uuid[] default '{}'::uuid[]
)
returns public.class_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  before_row public.class_schedules;
  changed_row public.class_schedules;
  source_room_type uuid;
  target_room_type uuid;
  normalized_ids uuid[] := coalesce(target_lecturer_ids, '{}'::uuid[]);
  is_admin boolean := (select private.has_role('admin'));
  is_staff boolean := (select private.has_role('staff'));
  can_import_owner boolean := false;
  is_teaching_assistant boolean := (select private.has_role('teaching_assistant'));
  can_manage_details boolean := false;
begin
  if not (select private.can_modify_class_schedule(target_schedule_id, 'details')) then
    raise exception 'CLASS_UPDATE_FORBIDDEN' using errcode = '42501';
  end if;
  select * into before_row from public.class_schedules schedules
  where schedules.id = target_schedule_id and schedules.schedule_status <> 'cancelled'
  for update;
  if before_row.id is null then raise exception 'CLASS_NOT_AVAILABLE' using errcode = 'P0001'; end if;
  select rooms.room_type_id into source_room_type from public.rooms rooms where rooms.id = before_row.room_id;
  can_import_owner := before_row.source = 'import'
    and (select private.can_import_schedules(source_room_type))
    and exists (
      select 1 from public.import_batches batches
      where batches.id = before_row.import_batch_id
        and batches.created_by = actor_id
    );

  select room_type_id into target_room_type from public.rooms where id = target_room_id and is_active;
  if target_room_type is null then raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501'; end if;
  if is_admin then
    can_manage_details := true;
  elsif is_staff then
    can_manage_details := (select private.has_room_type(source_room_type)) and (select private.has_room_type(target_room_type));
  elsif is_teaching_assistant then
    can_manage_details := (select private.has_room_type(source_room_type))
      and (select private.has_room_type(target_room_type))
      and before_row.created_by = actor_id;
  elsif can_import_owner then
    can_manage_details := (select private.has_room_type(source_room_type))
      and (select private.has_room_type(target_room_type));
  end if;

  if not can_manage_details then
    if not coalesce(
      (select auth.uid()) in (before_row.lecturer_id, before_row.lecturer_2_id),
      false
    ) then
      raise exception 'CLASS_UPDATE_FORBIDDEN' using errcode = '42501';
    end if;
    if target_start_time is distinct from before_row.start_time
      or target_end_time is distinct from before_row.end_time
      or target_room_id is distinct from before_row.room_id
      or target_student_count is distinct from before_row.student_count
      or normalized_ids is distinct from array_remove(array[before_row.lecturer_id, before_row.lecturer_2_id], null)
    then raise exception 'CLASS_DETAILS_UPDATE_FORBIDDEN' using errcode = '42501'; end if;
  end if;

  if target_schedule_date is null or target_start_time is null or target_end_time <= target_start_time
    or target_student_count is null or target_student_count < 1 or target_room_id is null or cardinality(normalized_ids) > 2
    or cardinality(normalized_ids) <> cardinality(array(select distinct unnest(normalized_ids)))
  then raise exception 'INVALID_CLASS_DETAILS' using errcode = '22023'; end if;

  if not is_admin and (not (select private.has_room_type(source_room_type)) or not (select private.has_room_type(target_room_type))) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(normalized_ids) lecturer_id where not exists (
      select 1 from public.profiles profiles where profiles.id = lecturer_id and profiles.is_active
        and exists (select 1 from public.user_roles roles where roles.user_id = lecturer_id and roles.role = 'lecturer')
        and exists (select 1 from public.profile_room_types scopes where scopes.profile_id = lecturer_id and scopes.room_type_id = target_room_type)
    )
  ) then raise exception 'LECTURER_ROOM_TYPE_MISMATCH' using errcode = '42501'; end if;
  if (select private.has_role('lecturer'))
    and not (is_admin or is_staff or is_teaching_assistant or can_import_owner)
    and actor_id <> all(normalized_ids) then
    raise exception 'LECTURER_MUST_REMAIN_ASSIGNED' using errcode = '42501';
  end if;

  update public.class_schedules set
    schedule_date = target_schedule_date, start_time = target_start_time, end_time = target_end_time,
    room_id = target_room_id, student_count = target_student_count,
    lecturer_id = normalized_ids[1], lecturer_2_id = normalized_ids[2], updated_at = now()
  where id = target_schedule_id returning * into changed_row;
  return changed_row;
exception
  when exclusion_violation then raise exception 'SCHEDULE_CONFLICT' using errcode = '23P01';
end;
$$;

revoke all on function public.update_class_schedule_details(uuid,date,time,time,uuid,integer,uuid[]) from public, anon;
grant execute on function public.update_class_schedule_details(uuid,date,time,time,uuid,integer,uuid[]) to authenticated;

create or replace function public.claim_class(target_schedule_id uuid)
returns public.class_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  before_row public.class_schedules;
  claimed public.class_schedules;
begin
  if actor_id is null or not (select private.is_active_user()) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  if not ((select private.has_role('lecturer')) or (select private.has_role('admin'))) then
    raise exception 'LECTURER_ROLE_REQUIRED' using errcode = '42501';
  end if;

  select * into before_row
  from public.class_schedules
  where id = target_schedule_id
    and schedule_status <> 'cancelled'
    and (schedule_date + start_time) > (now() at time zone 'Asia/Ho_Chi_Minh')
  for update;

  if before_row.id is null then
    raise exception 'CLASS_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  if not (select private.can_access_room(before_row.room_id)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;

  -- Equipment Request Lock Guard: Any row in equipment_requests locks the class
  if (select private.class_schedule_has_equipment_request(target_schedule_id)) then
    raise exception 'CLASS_EQUIPMENT_REQUEST_EXISTS' using errcode = '42501';
  end if;

  if actor_id in (before_row.lecturer_id, before_row.lecturer_2_id) then
    raise exception 'CLASS_ALREADY_CLAIMED' using errcode = 'P0001';
  end if;

  if before_row.lecturer_id is null then
    update public.class_schedules
    set lecturer_id = actor_id,
        updated_at = now()
    where id = target_schedule_id
    returning * into claimed;
  elsif before_row.lecturer_2_id is null then
    update public.class_schedules
    set lecturer_2_id = actor_id,
        updated_at = now()
    where id = target_schedule_id
    returning * into claimed;
  else
    raise exception 'CLASS_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  return claimed;
exception
  when exclusion_violation then
    raise exception 'LECTURER_SCHEDULE_CONFLICT' using errcode = '23P01';
end;
$$;

revoke all on function public.claim_class(uuid) from public, anon;
grant execute on function public.claim_class(uuid) to authenticated;

create or replace function public.withdraw_class(target_schedule_id uuid)
returns public.class_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.class_schedules;
  withdrawn public.class_schedules;
begin
  if not ((select private.has_role('lecturer')) or (select private.has_role('admin'))) then
    raise exception 'LECTURER_ROLE_REQUIRED' using errcode = '42501';
  end if;

  select * into before_row
  from public.class_schedules
  where id = target_schedule_id
    and (select auth.uid()) in (lecturer_id, lecturer_2_id)
  for update;

  if before_row.id is null then
    raise exception 'NOT_CLASS_OWNER' using errcode = '42501';
  end if;
  if not (select private.can_access_room(before_row.room_id)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  if before_row.schedule_status = 'cancelled'
     or (before_row.schedule_date + before_row.start_time) <=
        (now() at time zone 'Asia/Ho_Chi_Minh') then
    raise exception 'CLASS_WITHDRAWAL_CLOSED' using errcode = 'P0001';
  end if;

  update public.class_schedules
  set lecturer_id = case
        when lecturer_id = (select auth.uid()) then lecturer_2_id
        else lecturer_id
      end,
      lecturer_2_id = null,
      updated_at = now()
  where id = target_schedule_id
  returning * into withdrawn;

  return withdrawn;
end;
$$;

-- Notify Admins/Staff and opted-in read-only viewers assigned to the room type.
create or replace function private.enqueue_manual_schedule_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_label text;
  room_type_value uuid;
  room_type_code_value text;
  lecturer_name text;
  creator_name text;
  schedule_code text;
begin
  if new.source <> 'manual' then return new; end if;

  select concat_ws(' · ', rooms.room_code, rooms.building_code),
         rooms.room_type_id, room_types.code
  into room_label, room_type_value, room_type_code_value
  from public.rooms as rooms
  join public.room_types as room_types on room_types.id = rooms.room_type_id
  where rooms.id = new.room_id;

  -- Phiếu Y cơ sở chỉ gửi email tổng hợp YC-P01/YC-P02.
  if room_type_code_value = 'basic_medical' then return new; end if;

  select pg_catalog.string_agg(profiles.full_name, ' · ' order by profiles.full_name)
  into lecturer_name from public.profiles as profiles
  where profiles.id in (new.lecturer_id, new.lecturer_2_id);

  select profiles.full_name into creator_name
  from public.profiles as profiles where profiles.id = new.created_by;
  schedule_code := to_char(
    new.created_at at time zone 'Asia/Ho_Chi_Minh',
    'YYMMDDHH24MISS'
  );

  insert into public.email_notifications (
    notification_type, recipient_id, recipient_email, dedupe_key, subject, payload
  )
  select
    'class_schedule_created',
    recipient.id, recipient.email,
    concat('class_schedule_created:', new.id, ':', recipient.id),
    concat(
      '[MedLabs Calendar] Lịch phòng Skills Lab mới của ',
      coalesce(lecturer_name, 'Chưa có giảng viên'),
      ' - ', to_char(new.schedule_date, 'DD/MM/YYYY'),
      ' - ', new.course_code_snapshot,
      ' - ', schedule_code
    ),
    jsonb_build_object(
      'schedule_id', new.id, 'source', 'manual',
      'course_code', new.course_code_snapshot, 'course_name', new.course_name_snapshot,
      'schedule_date', new.schedule_date, 'start_time', new.start_time,
      'end_time', new.end_time, 'room', coalesce(room_label, 'Chưa có phòng'),
      'lecturer', coalesce(lecturer_name, 'Chưa có giảng viên'),
      'student_count', new.student_count,
      'creator', coalesce(creator_name, 'Người tạo phiếu'),
      'request_code', schedule_code,
      'room_type_code', room_type_code_value
    )
  from public.profiles as recipient
  where recipient.is_active
    and (
      recipient.id in (new.created_by, new.lecturer_id, new.lecturer_2_id)
      or exists (
        select 1 from public.user_roles as roles
        where roles.user_id = recipient.id and roles.role in ('staff', 'admin', 'viewer')
          and (
            roles.role = 'admin'
            or exists (
              select 1 from public.profile_room_types as assignments
              where assignments.profile_id = recipient.id
                and assignments.room_type_id = room_type_value
                and (
                  roles.role <> 'viewer'
                  or assignments.receive_schedule_emails
                )
            )
          )
      )
    )
  on conflict (dedupe_key) do nothing;
  return new;
end;
$$;

-- Keep import summary scope-aware.
create or replace function private.enqueue_import_summary_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator_name text;
  schedule_rows jsonb;
  room_type_code_value text;
begin
  if new.status <> 'completed' or old.status = 'completed' or new.imported_rows <= 0 then
    return new;
  end if;
  select profiles.full_name into creator_name from public.profiles as profiles where profiles.id = new.created_by;
  select room_types.code into room_type_code_value
  from public.room_types as room_types where room_types.id = new.room_type_id;
  -- Import lịch Y cơ sở không phát sinh email (YC-L02 đã bỏ).
  if room_type_code_value = 'basic_medical' then return new; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'schedule_id', schedules.id, 'course_code', schedules.course_code_snapshot,
    'course_name', schedules.course_name_snapshot, 'schedule_date', schedules.schedule_date,
    'start_time', schedules.start_time, 'end_time', schedules.end_time,
    'room', concat_ws(' · ', rooms.room_code, rooms.building_code),
    'lecturer', coalesce(nullif(concat_ws(' · ', lecturers.full_name, lecturers_2.full_name), ''), 'Chưa có giảng viên'),
    'student_count', schedules.student_count
  ) order by schedules.schedule_date, schedules.start_time, schedules.id), '[]'::jsonb)
  into schedule_rows
  from public.class_schedules as schedules
  join public.rooms as rooms on rooms.id = schedules.room_id
  left join public.profiles as lecturers on lecturers.id = schedules.lecturer_id
  left join public.profiles as lecturers_2 on lecturers_2.id = schedules.lecturer_2_id
  where schedules.import_batch_id = new.id and schedules.schedule_status <> 'cancelled';

  insert into public.email_notifications (
    notification_type, recipient_id, recipient_email, dedupe_key, subject, payload
  )
  select 'class_schedule_import_summary',
    recipient.id, recipient.email,
    concat('class_schedule_import_summary:', new.id, ':', recipient.id),
    concat(
      '[MedLabs Calendar] Cập nhật Lịch sử dụng phòng Skills Lab mới · ',
      new.imported_rows, ' lịch mới'
    ),
    jsonb_build_object(
      'batch_id', new.id, 'source', 'import', 'file_name', new.original_file_name,
      'creator', coalesce(creator_name, 'Người import'), 'completed_at', new.completed_at,
      'total_rows', new.total_rows, 'imported_rows', new.imported_rows,
      'warning_rows', new.warning_rows, 'error_rows', new.error_rows,
      'duplicate_rows', new.duplicate_rows, 'schedules', schedule_rows,
      'room_type_code', room_type_code_value
    )
  from public.profiles as recipient
  where recipient.is_active
    and (
      recipient.id = new.created_by
      or exists (
        select 1
        from public.class_schedules as related_schedules
        where related_schedules.import_batch_id = new.id
          and related_schedules.schedule_status <> 'cancelled'
          and recipient.id in (
            related_schedules.lecturer_id,
            related_schedules.lecturer_2_id
          )
      )
      or exists (
        select 1 from public.user_roles as roles
        where roles.user_id = recipient.id and roles.role in ('staff', 'admin', 'viewer')
          and (
            roles.role = 'admin'
            or exists (
              select 1 from public.profile_room_types as assignments
              where assignments.profile_id = recipient.id
                and assignments.room_type_id = new.room_type_id
                and (
                  roles.role <> 'viewer'
                  or assignments.receive_schedule_emails
                )
            )
          )
      )
    )
  on conflict (dedupe_key) do nothing;
  return new;
end;
$$;

-- Catalog entries may be removed once only cancelled schedule history remains.
-- Import rows retain their raw snapshots because their schedule FK uses ON DELETE SET NULL.
create or replace function public.delete_catalog_room(target_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  perform 1 from public.rooms where id = target_room_id for update;
  if not found then
    raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.basic_medical_registrations
    where room_id = target_room_id
  ) then
    raise exception 'CATALOG_HAS_BASIC_MEDICAL_REGISTRATIONS' using errcode = '23503';
  end if;

  if exists (
    select 1 from public.class_schedules
    where room_id = target_room_id and schedule_status <> 'cancelled'
  ) then
    raise exception 'CATALOG_HAS_ACTIVE_SCHEDULES' using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.class_schedules as schedules
    where schedules.room_id = target_room_id
      and schedules.schedule_status = 'cancelled'
      and (
        exists (
          select 1 from public.equipment_requests as requests
          where requests.class_schedule_id = schedules.id
        )
        or exists (
          select 1 from public.basic_medical_registration_sessions as sessions
          where sessions.class_schedule_id = schedules.id
        )
      )
  ) then
    raise exception 'CATALOG_HAS_RELATED_REQUESTS' using errcode = '23503';
  end if;

  delete from public.class_schedules
  where room_id = target_room_id and schedule_status = 'cancelled';

  delete from public.rooms where id = target_room_id;
end;
$$;

revoke all on function public.delete_catalog_room(uuid) from public, anon;
grant execute on function public.delete_catalog_room(uuid) to authenticated;

create or replace function public.delete_catalog_course(target_course_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_admin()) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  perform 1 from public.courses where id = target_course_id for update;
  if not found then
    raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.basic_medical_registrations
    where course_id = target_course_id
  ) then
    raise exception 'CATALOG_HAS_BASIC_MEDICAL_REGISTRATIONS' using errcode = '23503';
  end if;

  if exists (
    select 1 from public.class_schedules
    where course_id = target_course_id and schedule_status <> 'cancelled'
  ) then
    raise exception 'CATALOG_HAS_ACTIVE_SCHEDULES' using errcode = '23503';
  end if;

  if exists (
    select 1
    from public.class_schedules as schedules
    where schedules.course_id = target_course_id
      and schedules.schedule_status = 'cancelled'
      and (
        exists (
          select 1 from public.equipment_requests as requests
          where requests.class_schedule_id = schedules.id
        )
        or exists (
          select 1 from public.basic_medical_registration_sessions as sessions
          where sessions.class_schedule_id = schedules.id
        )
      )
  ) then
    raise exception 'CATALOG_HAS_RELATED_REQUESTS' using errcode = '23503';
  end if;

  delete from public.class_schedules
  where course_id = target_course_id and schedule_status = 'cancelled';

  delete from public.courses where id = target_course_id;
end;
$$;

revoke all on function public.delete_catalog_course(uuid) from public, anon;
grant execute on function public.delete_catalog_course(uuid) to authenticated;

-- Fourth follow-up: import RPCs require the capability in the requested scope.
grant insert, update, delete on public.class_schedules to service_role;
grant insert, update, delete on public.import_batches to service_role;
grant insert, update, delete on public.import_rows to service_role;

-- Scope every import-only RPC and direct row insert to the explicit capability.
drop function if exists public.find_existing_import_hashes(text[]);

create or replace function public.find_existing_import_hashes(
  target_hashes text[],
  target_room_type_id uuid
)
returns table(normalized_row_hash text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.can_import_schedules(target_room_type_id)) then
    raise exception 'IMPORT_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  return query
  select distinct rows.normalized_row_hash
  from public.import_rows rows
  join public.class_schedules schedules on schedules.id = rows.class_schedule_id
  join public.rooms rooms on rooms.id = schedules.room_id
  where rows.normalized_row_hash = any(coalesce(target_hashes, array[]::text[]))
    and rows.validation_status in ('imported', 'warning')
    and schedules.schedule_status <> 'cancelled'
    and rooms.room_type_id = target_room_type_id;
end;
$$;

revoke all on function public.find_existing_import_hashes(text[], uuid) from public, anon;
grant execute on function public.find_existing_import_hashes(text[], uuid) to authenticated;

revoke all on function public.import_hash_exists(text) from authenticated;

create or replace function public.record_import_validation_row(
  target_batch_id uuid,
  target_row_number integer,
  target_hash text,
  target_raw jsonb,
  target_normalized jsonb,
  target_status public.import_row_status,
  target_errors jsonb,
  target_warnings jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  row_id uuid;
  batch_room_type_id uuid;
begin
  if target_status not in ('error', 'duplicate') then
    raise exception 'INVALID_IMPORT_ROW_STATUS' using errcode = '22023';
  end if;

  select batches.room_type_id
  into batch_room_type_id
  from public.import_batches batches
  where batches.id = target_batch_id
    and batches.created_by = caller_id
    and batches.status = 'importing';

  if batch_room_type_id is null then
    raise exception 'IMPORT_BATCH_NOT_WRITABLE' using errcode = '42501';
  end if;
  if not (select private.can_import_schedules(batch_room_type_id)) then
    raise exception 'IMPORT_PERMISSION_REQUIRED' using errcode = '42501';
  end if;

  insert into public.import_rows (
    import_batch_id, row_number, source_row_id, normalized_row_hash,
    raw_data, normalized_data, validation_status, errors, warnings
  ) values (
    target_batch_id, target_row_number, null, target_hash,
    coalesce(target_raw, '{}'::jsonb), coalesce(target_normalized, '{}'::jsonb),
    target_status, coalesce(target_errors, '[]'::jsonb),
    coalesce(target_warnings, '[]'::jsonb)
  )
  returning id into row_id;

  return row_id;
end;
$$;

revoke all on function public.record_import_validation_row(
  uuid, integer, text, jsonb, jsonb, public.import_row_status, jsonb, jsonb
) from public, anon;
grant execute on function public.record_import_validation_row(
  uuid, integer, text, jsonb, jsonb, public.import_row_status, jsonb, jsonb
) to authenticated;

drop policy if exists import_rows_insert on public.import_rows;
create policy import_rows_insert on public.import_rows
for insert to authenticated
with check (
  exists (
    select 1
    from public.import_batches batches
    where batches.id = import_rows.import_batch_id
      and batches.created_by = (select auth.uid())
      and batches.status = 'importing'
      and (select private.can_import_schedules(batches.room_type_id))
  )
);

-- Declarative mirror of the Skills-only manual-schedule contract.
create or replace function public.create_manual_class_schedule(
  target_course_id uuid,
  target_room_id uuid,
  target_lecturer_id uuid,
  target_lecturer_2_id uuid,
  target_schedule_date date,
  target_start_time time,
  target_end_time time,
  target_note text,
  target_student_count integer,
  target_semester text
)
returns public.class_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  created_row public.class_schedules;
  course_code_val text;
  course_name_val text;
  course_room_type_id uuid;
  room_room_type_id uuid;
  nursing_skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
begin
  if actor_id is null or not (select private.is_active_user()) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  if target_semester is null or target_semester not in ('HK1', 'HK2', 'HK3', 'HK4') then
    raise exception 'Học kỳ phải là HK1, HK2, HK3 hoặc HK4.' using errcode = '22023';
  end if;

  select courses.course_code, courses.course_name, courses.room_type_id
  into course_code_val, course_name_val, course_room_type_id
  from public.courses as courses
  where courses.id = target_course_id
    and courses.is_active;

  if course_room_type_id is distinct from nursing_skills_room_type_id then
    raise exception 'SKILLS_MANUAL_SCHEDULE_REQUIRED' using errcode = '42501';
  end if;

  select rooms.room_type_id
  into room_room_type_id
  from public.rooms as rooms
  where rooms.id = target_room_id
    and rooms.is_active;

  if room_room_type_id is distinct from nursing_skills_room_type_id then
    raise exception 'SKILLS_MANUAL_SCHEDULE_REQUIRED' using errcode = '42501';
  end if;

  if not (select private.has_room_type(course_room_type_id)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;

  if not (select private.can_create_manual_schedule_for(
    target_room_id,
    array_remove(
      array[target_lecturer_id, target_lecturer_2_id]::uuid[],
      null
    )
  )) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;

  insert into public.class_schedules (
    course_id, course_code_snapshot, course_name_snapshot, room_id,
    lecturer_id, lecturer_2_id, schedule_date, start_time, end_time,
    source, schedule_status, note, student_count, semester, created_by, published_by, published_at
  ) values (
    target_course_id, course_code_val, course_name_val, target_room_id,
    target_lecturer_id, target_lecturer_2_id, target_schedule_date, target_start_time, target_end_time,
    'manual', 'published', target_note, target_student_count, target_semester, actor_id, actor_id, clock_timestamp()
  ) returning * into created_row;

  return created_row;
end;
$$;

revoke all on function public.create_manual_class_schedule(uuid,uuid,uuid,uuid,date,time,time,text,integer,text) from public, anon;
grant execute on function public.create_manual_class_schedule(uuid,uuid,uuid,uuid,date,time,time,text,integer,text) to authenticated;
