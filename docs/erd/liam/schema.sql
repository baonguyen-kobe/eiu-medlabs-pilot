-- Liam ERD schema projection for EIU-MEDLABS.
-- Source is the configured declarative schema set, with the five active basic-medical base tables
-- supplied from the migration that originally creates them because schema_paths only contains their later amendments.

-- Baseline source: supabase/migrations/20260805160000_basic_medical_room_equipment_confirmation.sql
create table public.basic_medical_equipment_catalog (
  id uuid primary key default gen_random_uuid(),
  item_name text not null check (btrim(item_name) <> ''),
  commercial_name text,
  item_type text,
  country_of_origin text,
  manufacturer text,
  model text,
  unit text not null check (btrim(unit) <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (item_name, commercial_name, model)
);

create table public.basic_medical_room_inventory (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete restrict,
  catalog_item_id uuid not null references public.basic_medical_equipment_catalog(id) on delete restrict,
  total_quantity integer not null default 0 check (total_quantity >= 0),
  good_quantity integer not null default 0 check (good_quantity >= 0),
  damaged_quantity integer not null default 0 check (damaged_quantity >= 0),
  is_active boolean not null default true,
  last_damage_reporter_id uuid references public.profiles(id) on delete set null,
  last_damage_reported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint basic_medical_inventory_quantity_balance
    check (total_quantity = good_quantity + damaged_quantity),
  unique (room_id, catalog_item_id)
);

create table public.basic_medical_session_confirmations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.basic_medical_registration_sessions(id) on delete set null,
  registration_id_snapshot uuid not null,
  class_schedule_id_snapshot uuid not null,
  signer_id uuid not null references public.profiles(id) on delete restrict,
  signature_data text not null check (
    length(signature_data) between 100 and 400000
    and signature_data like 'data:image/png;base64,%'
  ),
  schedule_date_snapshot date not null,
  start_time_snapshot time not null,
  end_time_snapshot time not null,
  room_id_snapshot uuid not null references public.rooms(id) on delete restrict,
  teaching_lecturer_id_snapshot uuid not null references public.profiles(id) on delete restrict,
  signed_at timestamptz not null default now(),
  invalidated_at timestamptz,
  invalidated_reason text,
  created_at timestamptz not null default now()
);

create unique index basic_medical_confirmations_active_session_idx
  on public.basic_medical_session_confirmations (session_id)
  where session_id is not null and invalidated_at is null;
create index basic_medical_confirmations_registration_idx
  on public.basic_medical_session_confirmations (registration_id_snapshot, invalidated_at, signed_at desc);

create table public.basic_medical_session_equipment_checks (
  id uuid primary key default gen_random_uuid(),
  confirmation_id uuid not null references public.basic_medical_session_confirmations(id) on delete cascade,
  inventory_id uuid not null references public.basic_medical_room_inventory(id) on delete restrict,
  item_name_snapshot text not null,
  commercial_name_snapshot text,
  unit_snapshot text not null,
  total_before integer not null check (total_before >= 0),
  good_before integer not null check (good_before >= 0),
  damaged_before integer not null check (damaged_before >= 0),
  newly_damaged_quantity integer not null default 0 check (newly_damaged_quantity >= 0),
  good_after integer not null check (good_after >= 0),
  damaged_after integer not null check (damaged_after >= 0),
  created_at timestamptz not null default now(),
  unique (confirmation_id, inventory_id),
  constraint basic_medical_checks_before_balance
    check (total_before = good_before + damaged_before),
  constraint basic_medical_checks_after_balance
    check (total_before = good_after + damaged_after)
);

create table public.basic_medical_equipment_condition_logs (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.basic_medical_room_inventory(id) on delete restrict,
  confirmation_id uuid references public.basic_medical_session_confirmations(id) on delete set null,
  event_type text not null check (
    event_type in ('damage_report', 'condition_adjustment', 'stock_adjustment')
  ),
  total_before integer not null check (total_before >= 0),
  good_before integer not null check (good_before >= 0),
  damaged_before integer not null check (damaged_before >= 0),
  total_after integer not null check (total_after >= 0),
  good_after integer not null check (good_after >= 0),
  damaged_after integer not null check (damaged_after >= 0),
  quantity_delta integer not null default 0,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  note text,
  created_at timestamptz not null default now(),
  constraint basic_medical_logs_before_balance
    check (total_before = good_before + damaged_before),
  constraint basic_medical_logs_after_balance
    check (total_after = good_after + damaged_after)
);

create index basic_medical_catalog_active_name_idx
  on public.basic_medical_equipment_catalog (is_active, item_name, commercial_name);
create index basic_medical_inventory_room_idx
  on public.basic_medical_room_inventory (room_id, is_active, catalog_item_id);
create index basic_medical_inventory_damaged_idx
  on public.basic_medical_room_inventory (damaged_quantity desc, last_damage_reported_at desc)
  where damaged_quantity > 0;
create index basic_medical_checks_confirmation_idx
  on public.basic_medical_session_equipment_checks (confirmation_id, inventory_id);
create index basic_medical_condition_logs_inventory_idx
  on public.basic_medical_equipment_condition_logs (inventory_id, created_at desc);
create index basic_medical_condition_logs_actor_idx
  on public.basic_medical_equipment_condition_logs (actor_id, created_at desc);


-- Source: supabase/schemas/01_app.sql
create extension if not exists btree_gist with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

-- `importer` is retained only as a deprecated enum value so existing migration
-- history can be replayed. Runtime code and new writes use the separate
-- profiles.can_import_schedules permission instead.
create type public.app_role as enum ('admin', 'lecturer', 'staff', 'teaching_assistant', 'importer', 'viewer');
create type public.schedule_source as enum ('manual', 'import', 'google_sheet');
create type public.schedule_status as enum ('draft', 'published', 'cancelled', 'completed');
create type public.shift_status as enum ('scheduled', 'cancelled', 'completed');
create type public.shift_registration_source as enum ('self_registered', 'admin_assigned', 'generated');
create type public.import_status as enum ('uploaded', 'validating', 'ready', 'importing', 'completed', 'completed_with_errors', 'failed');
create type public.import_row_status as enum ('valid', 'warning', 'error', 'duplicate', 'conflict', 'system_error', 'imported', 'skipped');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  title text,
  employee_code text,
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  can_import_schedules boolean not null default false,
  can_manage_shift_history boolean not null default false,
  allow_basic_medical_access boolean not null default false,
  access_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_not_blank check (btrim(email) <> ''),
  constraint profiles_name_not_blank check (btrim(full_name) <> ''),
  constraint profiles_access_version_positive check (access_version >= 1)
);

create table public.personnel_auth_reconciliation_logs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  previous_email text not null,
  requested_email text not null,
  failure_stage text not null,
  error_message text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint personnel_auth_reconciliation_stage_not_blank check (btrim(failure_stage) <> '')
);

create index personnel_auth_reconciliation_open_idx
  on public.personnel_auth_reconciliation_logs (created_at desc)
  where resolved_at is null;

create unique index profiles_email_unique_idx on public.profiles (lower(email));
create unique index profiles_employee_code_unique_idx
  on public.profiles (upper(btrim(employee_code)))
  where employee_code is not null and btrim(employee_code) <> '';

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  primary key (user_id, role)
);

create index user_roles_created_by_idx on public.user_roles (created_by);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  course_code text not null,
  course_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courses_code_not_blank check (btrim(course_code) <> ''),
  constraint courses_name_not_blank check (btrim(course_name) <> '')
);

create unique index courses_code_unique_idx on public.courses (upper(btrim(course_code)));
create index courses_active_name_idx on public.courses (is_active, course_name);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  building_code text not null,
  room_name text,
  room_type text,
  capacity integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_code_not_blank check (btrim(room_code) <> ''),
  constraint rooms_building_not_blank check (btrim(building_code) <> ''),
  constraint rooms_capacity_positive check (capacity is null or capacity > 0)
);

create unique index rooms_code_building_unique_idx
  on public.rooms (upper(btrim(room_code)), upper(btrim(building_code)));
create index rooms_active_type_idx on public.rooms (is_active, room_type);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_type public.schedule_source not null default 'import',
  original_file_name text not null,
  file_hash text not null,
  status public.import_status not null default 'uploaded',
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  warning_rows integer not null default 0,
  error_rows integer not null default 0,
  imported_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  conflict_rows integer not null default 0,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint import_batches_counts_non_negative check (
    total_rows >= 0 and valid_rows >= 0 and warning_rows >= 0 and
    error_rows >= 0 and imported_rows >= 0 and duplicate_rows >= 0 and conflict_rows >= 0
  )
);

create index import_batches_created_by_idx on public.import_batches (created_by, created_at desc);
create index import_batches_status_idx on public.import_batches (status, created_at desc);

-- Declared here because room-type policies in the next schema file reference
-- both this registration table and the class schedule foreign-key column.
create table public.basic_medical_registrations (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null check (btrim(academic_year) <> ''),
  semester text not null check (semester in ('HK1','HK2','HK3','HK4')),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  course_id uuid not null references public.courses(id) on delete restrict,
  room_id uuid not null references public.rooms(id) on delete restrict,
  student_count integer not null check (student_count > 0),
  registrant_id uuid not null references public.profiles(id) on delete restrict,
  responsible_lecturer_id uuid not null references public.profiles(id) on delete restrict,
  note text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.class_schedules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses(id) on delete restrict,
  course_code_snapshot text not null,
  course_name_snapshot text not null,
  room_id uuid not null references public.rooms(id) on delete restrict,
  lecturer_id uuid references public.profiles(id) on delete restrict,
  class_code text,
  schedule_date date not null,
  start_time time not null,
  end_time time not null,
  time_range tsrange generated always as (
    tsrange(schedule_date + start_time, schedule_date + end_time, '[)')
  ) stored,
  source public.schedule_source not null default 'manual',
  source_row_id text,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  basic_medical_registration_id uuid references public.basic_medical_registrations(id) on delete cascade,
  schedule_status public.schedule_status not null default 'draft',
  note text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lecturer_2_id uuid references public.profiles(id) on delete restrict,
  semester text,
  constraint class_schedules_semester_check check (
    semester is null or semester in ('HK1', 'HK2', 'HK3', 'HK4')
  ),
  constraint class_schedules_course_code_not_blank check (btrim(course_code_snapshot) <> ''),
  constraint class_schedules_course_name_not_blank check (btrim(course_name_snapshot) <> ''),
  constraint class_schedules_valid_time check (end_time > start_time),
  constraint class_schedules_publish_metadata check (
    (schedule_status <> 'published') or (published_at is not null and published_by is not null)
  ),
  constraint class_schedules_cancel_metadata check (
    (schedule_status <> 'cancelled') or (cancelled_at is not null and cancelled_by is not null)
  ),
  constraint class_schedules_lecturers_distinct check (
    lecturer_id is null or lecturer_2_id is null or lecturer_id <> lecturer_2_id
  ),
  constraint class_schedules_room_no_overlap exclude using gist (
    room_id with =,
    time_range with &&
  ) where (schedule_status <> 'cancelled'),
  constraint class_schedules_lecturer_no_overlap exclude using gist (
    lecturer_id with =,
    time_range with &&
  ) where (lecturer_id is not null and schedule_status <> 'cancelled')
);

create index class_schedules_course_id_idx on public.class_schedules (course_id);
create index class_schedules_room_date_idx on public.class_schedules (room_id, schedule_date);
create index class_schedules_lecturer_date_idx on public.class_schedules (lecturer_id, schedule_date);
create index class_schedules_lecturer_2_date_idx on public.class_schedules (lecturer_2_id, schedule_date);
create index class_schedules_created_by_idx on public.class_schedules (created_by, created_at desc);
create index class_schedules_import_batch_idx on public.class_schedules (import_batch_id);
create index class_schedules_open_idx
  on public.class_schedules (schedule_date, start_time)
  where schedule_status = 'published' and (lecturer_id is null or lecturer_2_id is null);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.import_batches(id) on delete cascade,
  row_number integer not null,
  source_row_id text,
  normalized_row_hash text not null,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  validation_status public.import_row_status not null,
  errors jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  class_schedule_id uuid references public.class_schedules(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint import_rows_row_number_positive check (row_number > 0),
  unique (import_batch_id, row_number)
);

create index import_rows_batch_status_idx on public.import_rows (import_batch_id, validation_status);
create index import_rows_hash_idx on public.import_rows (normalized_row_hash);
create index import_rows_schedule_idx on public.import_rows (class_schedule_id);

create table public.staff_shifts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete restrict,
  shift_date date not null,
  shift_slot text not null check (shift_slot in ('MORNING', 'AFTERNOON')),
  start_time time not null,
  end_time time not null,
  status public.shift_status not null default 'scheduled',
  registration_source public.shift_registration_source not null,
  note text,
  creation_group_id uuid,
  created_by uuid not null references public.profiles(id) on delete restrict,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_shifts_slot_check check (shift_slot in ('MORNING', 'AFTERNOON')),
  constraint staff_shifts_valid_time check (end_time > start_time),
  constraint staff_shifts_morning_time_check check (
    shift_slot <> 'MORNING' or (
      start_time >= '07:00'::time
      and start_time < end_time
      and end_time <= '11:30'::time
      and extract(minute from start_time)::integer in (0, 30)
      and extract(second from start_time)::integer = 0
      and extract(minute from end_time)::integer in (0, 30)
      and extract(second from end_time)::integer = 0
    )
  ),
  constraint staff_shifts_afternoon_time_check check (
    shift_slot <> 'AFTERNOON' or (
      start_time >= '12:30'::time
      and start_time < end_time
      and end_time <= '16:30'::time
      and extract(minute from start_time)::integer in (0, 30)
      and extract(second from start_time)::integer = 0
      and extract(minute from end_time)::integer in (0, 30)
      and extract(second from end_time)::integer = 0
    )
  ),
  constraint staff_shifts_cancel_metadata check (
    (status <> 'cancelled') or (cancelled_at is not null and cancelled_by is not null)
  )
);

create index staff_shifts_staff_date_idx on public.staff_shifts (staff_id, shift_date);
create index staff_shifts_date_status_idx on public.staff_shifts (shift_date, status);
create index staff_shifts_created_by_idx on public.staff_shifts (created_by);
create index staff_shifts_creation_group_idx on public.staff_shifts (creation_group_id) where creation_group_id is not null;
create unique index staff_shifts_active_slot_unique_idx on public.staff_shifts (staff_id, shift_date, shift_slot) where (status <> 'cancelled');


create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_not_blank check (btrim(action) <> ''),
  constraint audit_logs_entity_type_not_blank check (btrim(entity_type) <> '')
);

create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

create table public.email_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  recipient_email text not null,
  dedupe_key text not null,
  subject text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  processing_started_at timestamptz,
  sent_at timestamptz,
  delivery_mode_at_enqueue text not null default 'off',
  provider_succeeded_at timestamptz,
  acknowledgement_error text,
  constraint email_notifications_type_not_blank check (btrim(notification_type) <> ''),
  constraint email_notifications_recipient_not_blank check (btrim(recipient_email) <> ''),
  constraint email_notifications_subject_not_blank check (btrim(subject) <> ''),
  constraint email_notifications_attempts_non_negative check (attempts >= 0),
  constraint email_notifications_status_valid check (
    status in ('pending', 'processing', 'sent', 'sent_unconfirmed', 'simulated', 'suppressed', 'failed')
  ),
  constraint email_notifications_delivery_mode_snapshot_valid check (
    delivery_mode_at_enqueue in ('off', 'test', 'live')
  )
);

create unique index email_notifications_dedupe_idx
  on public.email_notifications (dedupe_key);
create index email_notifications_dispatch_idx
  on public.email_notifications (status, attempts, created_at)
  where status in ('pending', 'failed');
create index email_notifications_recipient_idx
  on public.email_notifications (recipient_id, created_at desc);

create table public.email_delivery_settings (
  setting_key text primary key default 'primary',
  delivery_mode text not null default 'off',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint email_delivery_settings_singleton check (setting_key = 'primary'),
  constraint email_delivery_settings_mode_valid check (
    delivery_mode in ('off', 'test', 'live')
  )
);

insert into public.email_delivery_settings (setting_key, delivery_mode)
values ('primary', 'off');

create or replace function private.snapshot_email_delivery_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare selected_mode text;
begin
  select settings.delivery_mode into selected_mode
  from public.email_delivery_settings settings where settings.setting_key = 'primary';
  new.delivery_mode_at_enqueue := case when selected_mode in ('test', 'live') then selected_mode else 'off' end;
  if new.delivery_mode_at_enqueue = 'off' then
    new.status := 'suppressed';
    new.last_error := 'Đã bỏ qua vì hệ thống đang tắt gửi email tại thời điểm tạo.';
  end if;
  return new;
end;
$$;

create trigger email_notifications_snapshot_delivery_mode
before insert on public.email_notifications
for each row execute function private.snapshot_email_delivery_mode();

create or replace function public.set_email_delivery_mode(target_mode text)
returns public.email_delivery_settings
language plpgsql security definer set search_path = '' as $$
declare changed public.email_delivery_settings;
begin
  if not (select private.has_role('admin')) then
    raise exception 'ADMIN_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if target_mode not in ('off', 'test', 'live') then
    raise exception 'INVALID_EMAIL_DELIVERY_MODE' using errcode = '22023';
  end if;
  update public.email_delivery_settings
  set delivery_mode = target_mode, updated_by = (select auth.uid()), updated_at = clock_timestamp()
  where setting_key = 'primary' returning * into changed;
  if target_mode = 'off' then
    update public.email_notifications
    set status = 'suppressed', processing_started_at = null,
        last_error = 'Đã bỏ qua vì hệ thống đang tắt gửi email.'
    where status = 'pending';
  end if;
  return changed;
end;
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.prevent_class_lecturer_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lecturer_value uuid;
  target_range tsrange;
begin
  if new.schedule_status = 'cancelled' then
    return new;
  end if;

  if new.lecturer_id is not null and new.lecturer_id = new.lecturer_2_id then
    raise exception 'DUPLICATE_CLASS_LECTURER' using errcode = '23514';
  end if;

  target_range := tsrange(
    new.schedule_date + new.start_time,
    new.schedule_date + new.end_time,
    '[)'
  );

  for lecturer_value in
    select lecturer_id_value
    from unnest(array_remove(array[new.lecturer_id, new.lecturer_2_id]::uuid[], null))
      as lecturer_ids(lecturer_id_value)
    order by lecturer_id_value
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(lecturer_value::text, 0)
    );

    if exists (
      select 1
      from public.class_schedules as schedules
      where schedules.id <> new.id
        and schedules.schedule_status <> 'cancelled'
        and schedules.time_range && target_range
        and (
          schedules.lecturer_id = lecturer_value
          or schedules.lecturer_2_id = lecturer_value
        )
    ) then
      raise exception 'LECTURER_SCHEDULE_CONFLICT' using errcode = '23P01';
    end if;
  end loop;

  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger courses_set_updated_at before update on public.courses
for each row execute function private.set_updated_at();
create trigger rooms_set_updated_at before update on public.rooms
for each row execute function private.set_updated_at();
create trigger class_schedules_set_updated_at before update on public.class_schedules
for each row execute function private.set_updated_at();
create trigger class_schedules_prevent_lecturer_overlap
before insert or update of lecturer_id, lecturer_2_id, schedule_date, start_time, end_time, schedule_status
on public.class_schedules
for each row execute function private.prevent_class_lecturer_overlap();
create trigger staff_shifts_set_updated_at before update on public.staff_shifts
for each row execute function private.set_updated_at();

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_active
  );
$$;

create or replace function private.has_role(required_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_active_user())
    and exists (
      select 1
      from public.user_roles
      where user_id = (select auth.uid())
        and role = required_role
    );
$$;

create or replace function private.can_create_schedule_entries()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_active_user())
    and exists (
      select 1
      from public.user_roles
      where user_id = (select auth.uid())
        and role in ('admin', 'staff', 'lecturer', 'teaching_assistant')
    );
$$;

create or replace function private.write_audit(
  action_name text,
  target_type text,
  target_id uuid,
  before_data jsonb,
  after_data jsonb,
  extra_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, old_data, new_data, metadata
  ) values (
    (select auth.uid()), action_name, target_type, target_id,
    before_data, after_data, coalesce(extra_metadata, '{}'::jsonb)
  );
$$;

create or replace function private.audit_business_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  action_name text;
  target_id uuid;
  before_data jsonb;
  after_data jsonb;
begin
  before_data := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  after_data := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  target_id := coalesce((after_data ->> 'id')::uuid, (before_data ->> 'id')::uuid);

  if tg_table_name = 'class_schedules' then
    action_name := case
      when tg_op = 'INSERT' then 'class_schedule.created'
      when tg_op = 'DELETE' then 'class_schedule.deleted'
      when old.schedule_status is distinct from new.schedule_status then 'class_schedule.status_changed'
      when old.lecturer_id is distinct from new.lecturer_id
        or old.lecturer_2_id is distinct from new.lecturer_2_id
        then 'class_schedule.lecturer_changed'
      else 'class_schedule.updated'
    end;
  elsif tg_table_name = 'staff_shifts' then
    action_name := case
      when tg_op = 'INSERT' then 'staff_shift.created'
      when old.status is distinct from new.status then 'staff_shift.status_changed'
      else 'staff_shift.updated'
    end;
  elsif tg_table_name = 'import_batches' then
    action_name := case
      when tg_op = 'INSERT' then 'import.started'
      else 'import.status_changed'
    end;
  elsif tg_table_name = 'user_roles' then
    action_name := case when tg_op = 'INSERT' then 'role.assigned' else 'role.removed' end;
    target_id := coalesce(
      (after_data ->> 'user_id')::uuid,
      (before_data ->> 'user_id')::uuid
    );
  else
    action_name := 'profile.updated';
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    (select auth.uid()), action_name, tg_table_name, target_id, before_data, after_data
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger class_schedules_audit
after insert or update or delete on public.class_schedules
for each row execute function private.audit_business_change();
create trigger staff_shifts_audit
after insert or update on public.staff_shifts
for each row execute function private.audit_business_change();
create trigger import_batches_audit
after insert or update on public.import_batches
for each row execute function private.audit_business_change();
create trigger user_roles_audit
after insert or delete on public.user_roles
for each row execute function private.audit_business_change();
create trigger profiles_audit
after update on public.profiles
for each row
when (old.is_active is distinct from new.is_active)
execute function private.audit_business_change();

create or replace function private.enqueue_manual_schedule_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_label text;
  lecturer_name text;
  creator_name text;
begin
  if new.source <> 'manual' then
    return new;
  end if;

  select concat_ws(' · ', rooms.room_code, rooms.building_code)
  into room_label
  from public.rooms as rooms
  where rooms.id = new.room_id;

  select pg_catalog.string_agg(profiles.full_name, ' · ' order by profiles.full_name)
  into lecturer_name
  from public.profiles as profiles
  where profiles.id in (new.lecturer_id, new.lecturer_2_id);

  select profiles.full_name
  into creator_name
  from public.profiles as profiles
  where profiles.id = new.created_by;

  insert into public.email_notifications (
    notification_type,
    recipient_id,
    recipient_email,
    dedupe_key,
    subject,
    payload
  )
  select
    'class_schedule_created',
    recipient.id,
    recipient.email,
    concat('class_schedule_created:', new.id, ':', recipient.id),
    concat('[MedLabs Calendar] Lịch lớp mới · ', new.course_code_snapshot),
    jsonb_build_object(
      'schedule_id', new.id,
      'source', 'manual',
      'course_code', new.course_code_snapshot,
      'course_name', new.course_name_snapshot,
      'schedule_date', new.schedule_date,
      'start_time', new.start_time,
      'end_time', new.end_time,
      'room', coalesce(room_label, 'Chưa có phòng'),
      'lecturer', coalesce(lecturer_name, 'Chưa có giảng viên'),
      'creator', coalesce(creator_name, 'Người tạo phiếu')
    )
  from public.profiles as recipient
  where recipient.is_active
    and exists (
      select 1
      from public.user_roles as roles
      where roles.user_id = recipient.id
        and roles.role in ('staff', 'admin')
    )
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

create or replace function private.enqueue_import_summary_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator_name text;
  schedule_rows jsonb;
begin
  if new.status <> 'completed'
     or old.status = 'completed'
     or new.imported_rows <= 0 then
    return new;
  end if;

  select profiles.full_name
  into creator_name
  from public.profiles as profiles
  where profiles.id = new.created_by;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'schedule_id', schedules.id,
        'course_code', schedules.course_code_snapshot,
        'course_name', schedules.course_name_snapshot,
        'schedule_date', schedules.schedule_date,
        'start_time', schedules.start_time,
        'end_time', schedules.end_time,
        'room', concat_ws(' · ', rooms.room_code, rooms.building_code),
        'lecturer', coalesce(
          nullif(concat_ws(' · ', lecturers.full_name, lecturers_2.full_name), ''),
          'Chưa có giảng viên'
        )
      )
      order by schedules.schedule_date, schedules.start_time, schedules.id
    ),
    '[]'::jsonb
  )
  into schedule_rows
  from public.class_schedules as schedules
  join public.rooms as rooms on rooms.id = schedules.room_id
  left join public.profiles as lecturers on lecturers.id = schedules.lecturer_id
  left join public.profiles as lecturers_2 on lecturers_2.id = schedules.lecturer_2_id
  where schedules.import_batch_id = new.id
    and schedules.schedule_status <> 'cancelled';

  insert into public.email_notifications (
    notification_type,
    recipient_id,
    recipient_email,
    dedupe_key,
    subject,
    payload
  )
  select
    'class_schedule_import_summary',
    recipient.id,
    recipient.email,
    concat('class_schedule_import_summary:', new.id, ':', recipient.id),
    concat('[MedLabs Calendar] Tổng hợp import · ', new.imported_rows, ' lịch mới'),
    jsonb_build_object(
      'batch_id', new.id,
      'source', 'import',
      'file_name', new.original_file_name,
      'creator', coalesce(creator_name, 'Người import'),
      'completed_at', new.completed_at,
      'total_rows', new.total_rows,
      'imported_rows', new.imported_rows,
      'warning_rows', new.warning_rows,
      'error_rows', new.error_rows,
      'duplicate_rows', new.duplicate_rows,
      'schedules', schedule_rows
    )
  from public.profiles as recipient
  where recipient.is_active
    and exists (
      select 1
      from public.user_roles as roles
      where roles.user_id = recipient.id
        and roles.role in ('staff', 'admin')
    )
  on conflict (dedupe_key) do nothing;

  return new;
end;
$$;

create trigger class_schedules_email_outbox
after insert on public.class_schedules
for each row execute function private.enqueue_manual_schedule_email();

create trigger import_batches_email_outbox
after update on public.import_batches
for each row execute function private.enqueue_import_summary_email();

create or replace function public.claim_email_notifications(batch_size integer default 25)
returns setof public.email_notifications
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select notifications.id
    from public.email_notifications as notifications
    where (
        notifications.status = 'pending'
        or (
          notifications.status = 'processing'
          and notifications.processing_started_at < now() - interval '10 minutes'
        )
      )
      and notifications.attempts < 5
    order by notifications.created_at, notifications.id
    for update skip locked
    limit greatest(1, least(coalesce(batch_size, 25), 100))
  )
  update public.email_notifications as notifications
  set status = 'processing',
      attempts = notifications.attempts + 1,
      processing_started_at = now(),
      last_error = null
  from candidates
  where notifications.id = candidates.id
  returning notifications.*;
$$;

create or replace function public.claim_class(target_schedule_id uuid)
returns public.class_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.class_schedules;
  claimed public.class_schedules;
begin
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

  if (select auth.uid()) in (before_row.lecturer_id, before_row.lecturer_2_id) then
    raise exception 'CLASS_ALREADY_CLAIMED' using errcode = 'P0001';
  end if;

  if before_row.lecturer_id is null then
    update public.class_schedules
    set lecturer_id = (select auth.uid()),
        updated_at = now()
    where id = target_schedule_id
    returning * into claimed;
  elsif before_row.lecturer_2_id is null then
    update public.class_schedules
    set lecturer_2_id = (select auth.uid()),
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

create or replace function public.find_existing_import_hashes(target_hashes text[])
returns table(normalized_row_hash text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.can_create_schedule_entries()) then
    raise exception 'SCHEDULE_CREATOR_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if target_hashes is null or cardinality(target_hashes) > 500 then
    raise exception 'INVALID_IMPORT_HASHES' using errcode = '22023';
  end if;
  return query
  select distinct rows.normalized_row_hash
  from public.import_rows as rows
  join public.class_schedules schedules on schedules.id = rows.class_schedule_id
  where rows.normalized_row_hash = any(target_hashes)
    and rows.validation_status in ('imported', 'warning')
    and schedules.schedule_status <> 'cancelled';
end;
$$;

revoke all on function public.find_existing_import_hashes(text[]) from public, anon;
grant execute on function public.find_existing_import_hashes(text[]) to authenticated;

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
  where id = target_schedule_id
  returning * into withdrawn;

  return withdrawn;
end;
$$;

create or replace function private.can_operate_skills_shifts(actor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_active boolean;
  is_root boolean;
  has_role boolean;
  has_scope boolean;
begin
  if actor_id is null then
    return false;
  end if;

  select
    p.is_active,
    (ssp.root_admin_id = actor_id)
  into is_active, is_root
  from public.profiles p
  left join public.system_security_principals ssp on ssp.singleton = true
  where p.id = actor_id;

  if not coalesce(is_active, false) then
    return false;
  end if;

  if coalesce(is_root, false) then
    return true;
  end if;

  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = actor_id and ur.role in ('admin', 'staff')
  ) into has_role;

  if not has_role then
    return false;
  end if;

  select exists (
    select 1 from public.profile_room_types prt
    join public.room_types rt on rt.id = prt.room_type_id
    where prt.profile_id = actor_id and rt.code = 'nursing_skills'
  ) into has_scope;

  return has_scope;
end;
$$;

create or replace function private.can_manage_shift_history(actor_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if actor_id is null then
    return false;
  end if;

  if exists (
    select 1
    from public.system_security_principals principals
    where principals.singleton and principals.root_admin_id = actor_id
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.profiles p
    where p.id = actor_id
      and p.can_manage_shift_history = true
  );
end;
$$;

create or replace function private.is_eligible_shift_assignee(target_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = target_staff_id
      and (select private.is_operationally_assignable(p.id))
      and exists (
        select 1
        from public.user_roles r
        where r.user_id = p.id
          and r.role in ('staff', 'admin')
      )
      and exists (
        select 1
        from public.profile_room_types prt
        join public.room_types rt on rt.id = prt.room_type_id
        where prt.profile_id = p.id
          and rt.code = 'nursing_skills'
      )
  );
$$;

create or replace function private.validate_staff_shift_operational_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_eligible_shift_assignee(new.staff_id) then
    raise exception 'ASSIGN_STAFF_NOT_ELIGIBLE: User % is not an eligible Skills Lab shift assignee', new.staff_id;
  end if;
  return new;
end;
$$;

drop trigger if exists staff_shift_operational_assignee on public.staff_shifts;
create trigger staff_shift_operational_assignee
before insert or update of staff_id on public.staff_shifts
for each row
execute function private.validate_staff_shift_operational_assignee();

create or replace function public.list_operational_shift_assignees()
returns table (id uuid, full_name text, title text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_operate_skills_shifts(auth.uid()) then
    raise exception 'PERMISSION_DENIED: User lacks Skills Lab operational scope' using errcode = '42501';
  end if;

  return query
  select profiles.id, profiles.full_name, profiles.title
  from public.profiles profiles
  where (select private.is_operationally_assignable(profiles.id))
    and exists (
      select 1 from public.user_roles roles
      where roles.user_id = profiles.id and roles.role in ('staff', 'admin')
    )
    and exists (
      select 1 from public.profile_room_types prt
      join public.room_types rt on rt.id = prt.room_type_id
      where prt.profile_id = profiles.id and rt.code = 'nursing_skills'
    )
  order by profiles.full_name;
end;
$$;

create or replace function public.register_staff_shifts(
  shifts_payload jsonb,
  adjustment_reason text default null
)
returns setof public.staff_shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  is_admin boolean;
  is_root boolean;
  can_history boolean;
  business_today date;
  row_elem jsonb;
  target_staff_id uuid;
  target_date date;
  target_slot text;
  target_start time;
  target_end time;
  target_note text;
  target_group_id uuid;
  assigned_source public.shift_registration_source;
  created_row public.staff_shifts;
  seen_keys text[] := '{}';
  row_key text;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED: Authentication is required' using errcode = '42501';
  end if;

  if not private.can_operate_skills_shifts(actor_id) then
    raise exception 'PERMISSION_DENIED: User lacks Skills Lab operational scope' using errcode = '42501';
  end if;

  is_admin := private.is_admin();
  is_root := exists (
    select 1 from public.system_security_principals where singleton and root_admin_id = actor_id
  );
  can_history := private.can_manage_shift_history(actor_id);
  business_today := (now() at time zone 'Asia/Ho_Chi_Minh')::date;

  if shifts_payload is null or jsonb_array_length(shifts_payload) = 0 then
    raise exception 'INVALID_PAYLOAD: Shift payload must be a non-empty array' using errcode = '22023';
  end if;

  -- Phase 1: Validate all rows in payload
  for row_elem in select * from jsonb_array_elements(shifts_payload) loop
    target_staff_id := (row_elem->>'staff_id')::uuid;
    target_date := (row_elem->>'shift_date')::date;
    target_slot := upper(btrim(coalesce(row_elem->>'shift_slot', '')));
    target_start := (row_elem->>'start_time')::time;
    target_end := (row_elem->>'end_time')::time;
    target_note := nullif(btrim(coalesce(row_elem->>'note', '')), '');
    target_group_id := (row_elem->>'creation_group_id')::uuid;

    if target_staff_id is null then
      raise exception 'INVALID_STAFF_ID: staff_id is required' using errcode = '22023';
    end if;

    if target_date is null then
      raise exception 'INVALID_SHIFT_DATE: shift_date is required' using errcode = '22023';
    end if;

    if target_slot not in ('MORNING', 'AFTERNOON') then
      raise exception 'INVALID_SHIFT_SLOT: shift_slot must be MORNING or AFTERNOON' using errcode = '22023';
    end if;

    if target_start is null or target_end is null or target_start >= target_end then
      raise exception 'INVALID_TIME_RANGE: start_time must be earlier than end_time' using errcode = '22023';
    end if;

    -- Slot-specific time rules
    if target_slot = 'MORNING' then
      if target_start < '07:30'::time or target_end > '11:30'::time or
         extract(minute from target_start)::integer not in (0, 30) or extract(second from target_start)::integer <> 0 or
         extract(minute from target_end)::integer not in (0, 30) or extract(second from target_end)::integer <> 0 then
        raise exception 'INVALID_MORNING_TIME: Morning shift must be within 07:30-11:30 on 30-minute grid' using errcode = '22023';
      end if;
    elsif target_slot = 'AFTERNOON' then
      if target_start < '12:30'::time or target_end > '16:30'::time or
         extract(minute from target_start)::integer not in (0, 30) or extract(second from target_start)::integer <> 0 or
         extract(minute from target_end)::integer not in (0, 30) or extract(second from target_end)::integer <> 0 then
        raise exception 'INVALID_AFTERNOON_TIME: Afternoon shift must be within 12:30-16:30 on 30-minute grid' using errcode = '22023';
      end if;
    end if;

    -- Assignee eligibility
    if not private.is_eligible_shift_assignee(target_staff_id) then
      raise exception 'ASSIGNEE_NOT_ELIGIBLE: User % is not eligible for Skills Lab shifts', target_staff_id using errcode = '42501';
    end if;

    -- Root cannot be assigned
    if exists (
      select 1 from public.system_security_principals principals
      where principals.singleton and principals.root_admin_id = target_staff_id
    ) then
      raise exception 'ASSIGN_ROOT_NOT_ALLOWED: Root administrator cannot be assigned to shifts' using errcode = '42501';
    end if;

    -- Authority check: Staff can only register shifts for themselves
    if target_staff_id <> actor_id and not is_admin and not is_root then
      raise exception 'PERMISSION_DENIED: Staff members can only register shifts for themselves' using errcode = '42501';
    end if;

    -- Temporal policy
    if target_date < business_today then
      if not can_history and not is_root then
        raise exception 'HISTORICAL_MUTATION_FORBIDDEN: Historical shifts require history management capability' using errcode = '42501';
      end if;
      if adjustment_reason is null or btrim(adjustment_reason) = '' then
        raise exception 'HISTORICAL_REASON_REQUIRED: Reason is required for historical shift mutations' using errcode = '22023';
      end if;
    end if;

    -- Intra-payload duplicate check
    row_key := target_staff_id::text || ':' || target_date::text || ':' || target_slot;
    if row_key = any(seen_keys) then
      raise exception 'DUPLICATE_PAYLOAD_SLOT: Multiple entries for staff % on % slot % in the same request', target_staff_id, target_date, target_slot using errcode = '23505';
    end if;
    seen_keys := array_append(seen_keys, row_key);

    -- Database active slot conflict check
    if exists (
      select 1
      from public.staff_shifts s
      where s.staff_id = target_staff_id
        and s.shift_date = target_date
        and s.shift_slot = target_slot
        and s.status <> 'cancelled'
    ) then
      raise exception 'ACTIVE_SHIFT_EXISTS: Staff % already has an active % shift on %', target_staff_id, target_slot, target_date using errcode = '23505';
    end if;
  end loop;

  -- Phase 2: Insert rows atomically
  for row_elem in select * from jsonb_array_elements(shifts_payload) loop
    target_staff_id := (row_elem->>'staff_id')::uuid;
    target_date := (row_elem->>'shift_date')::date;
    target_slot := upper(btrim(coalesce(row_elem->>'shift_slot', '')));
    target_start := (row_elem->>'start_time')::time;
    target_end := (row_elem->>'end_time')::time;
    target_note := nullif(btrim(coalesce(row_elem->>'note', '')), '');
    target_group_id := (row_elem->>'creation_group_id')::uuid;

    assigned_source := case
      when target_staff_id = actor_id and not is_admin and not is_root then 'self_registered'::public.shift_registration_source
      else 'admin_assigned'::public.shift_registration_source
    end;

    insert into public.staff_shifts (
      staff_id,
      shift_date,
      shift_slot,
      start_time,
      end_time,
      note,
      status,
      registration_source,
      creation_group_id,
      created_by
    ) values (
      target_staff_id,
      target_date,
      target_slot,
      target_start,
      target_end,
      target_note,
      'scheduled',
      assigned_source,
      target_group_id,
      actor_id
    ) returning * into created_row;

    -- Audit log if historical
    if target_date < business_today then
      insert into public.audit_logs (
        actor_id,
        action,
        entity_type,
        entity_id,
        new_data,
        metadata
      ) values (
        actor_id,
        'create_historical_shift',
        'staff_shifts',
        created_row.id,
        to_jsonb(created_row),
        jsonb_build_object('reason', adjustment_reason)
      );
    end if;

    return next created_row;
  end loop;
end;
$$;

create or replace function public.cancel_staff_shift(
  target_shift_id uuid,
  reason text default null
)
returns public.staff_shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  is_admin boolean;
  is_root boolean;
  can_history boolean;
  business_today date;
  target_shift public.staff_shifts;
  cancelled_row public.staff_shifts;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED: Authentication is required' using errcode = '42501';
  end if;

  if not private.can_operate_skills_shifts(actor_id) then
    raise exception 'PERMISSION_DENIED: User lacks Skills Lab operational scope' using errcode = '42501';
  end if;

  is_admin := private.is_admin();
  is_root := exists (
    select 1 from public.system_security_principals where singleton and root_admin_id = actor_id
  );
  can_history := private.can_manage_shift_history(actor_id);
  business_today := (now() at time zone 'Asia/Ho_Chi_Minh')::date;

  select * into target_shift
  from public.staff_shifts
  where id = target_shift_id
  for update;

  if target_shift.id is null then
    raise exception 'SHIFT_NOT_FOUND: Staff shift % not found', target_shift_id using errcode = 'P0002';
  end if;

  if target_shift.status = 'cancelled' then
    return target_shift;
  end if;

  -- Authority check: Staff can only cancel their own shift
  if target_shift.staff_id <> actor_id and not is_admin and not is_root then
    raise exception 'PERMISSION_DENIED: Staff members can only cancel their own shifts' using errcode = '42501';
  end if;

  -- Temporal check
  if target_shift.shift_date < business_today then
    if not can_history and not is_root then
      raise exception 'HISTORICAL_MUTATION_FORBIDDEN: Historical cancellation requires history capability' using errcode = '42501';
    end if;
    if reason is null or btrim(reason) = '' then
      raise exception 'HISTORICAL_REASON_REQUIRED: Reason is required for historical shift cancellation' using errcode = '22023';
    end if;
  end if;

  update public.staff_shifts
  set
    status = 'cancelled',
    cancelled_by = actor_id,
    cancelled_at = now(),
    cancellation_reason = nullif(btrim(coalesce(reason, '')), ''),
    updated_at = now()
  where id = target_shift_id
  returning * into cancelled_row;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data,
    metadata
  ) values (
    actor_id,
    case when target_shift.shift_date < business_today then 'cancel_historical_shift' else 'cancel_shift' end,
    'staff_shifts',
    cancelled_row.id,
    to_jsonb(target_shift),
    to_jsonb(cancelled_row),
    jsonb_build_object('reason', reason)
  );

  return cancelled_row;
end;
$$;

create or replace function public.update_staff_shift_time(
  target_shift_id uuid,
  target_start_time time,
  target_end_time time,
  target_note text default null,
  reason text default null
)
returns public.staff_shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  is_admin boolean;
  is_root boolean;
  can_history boolean;
  business_today date;
  target_shift public.staff_shifts;
  updated_row public.staff_shifts;
begin
  if actor_id is null then
    raise exception 'AUTH_REQUIRED: Authentication is required' using errcode = '42501';
  end if;

  if not private.can_operate_skills_shifts(actor_id) then
    raise exception 'PERMISSION_DENIED: User lacks Skills Lab operational scope' using errcode = '42501';
  end if;

  is_admin := private.is_admin();
  is_root := exists (
    select 1 from public.system_security_principals where singleton and root_admin_id = actor_id
  );
  can_history := private.can_manage_shift_history(actor_id);
  business_today := (now() at time zone 'Asia/Ho_Chi_Minh')::date;

  select * into target_shift
  from public.staff_shifts
  where id = target_shift_id
  for update;

  if target_shift.id is null then
    raise exception 'SHIFT_NOT_FOUND: Staff shift % not found', target_shift_id using errcode = 'P0002';
  end if;

  if target_shift.status = 'cancelled' then
    raise exception 'SHIFT_CANCELLED: Cannot edit a cancelled shift' using errcode = '22023';
  end if;

  -- Authority check: Staff can only edit their own shifts
  if target_shift.staff_id <> actor_id and not is_admin and not is_root then
    raise exception 'PERMISSION_DENIED: Staff members can only edit their own shifts' using errcode = '42501';
  end if;

  -- Temporal check
  if target_shift.shift_date < business_today then
    if not can_history and not is_root then
      raise exception 'HISTORICAL_MUTATION_FORBIDDEN: Historical shift edit requires history capability' using errcode = '42501';
    end if;
    if reason is null or btrim(reason) = '' then
      raise exception 'HISTORICAL_REASON_REQUIRED: Reason is required for historical shift edit' using errcode = '22023';
    end if;
  end if;

  if target_start_time is null or target_end_time is null or target_start_time >= target_end_time then
    raise exception 'INVALID_TIME_RANGE: start_time must be earlier than end_time' using errcode = '22023';
  end if;

  -- Slot rule enforcement
  if target_shift.shift_slot = 'MORNING' then
    if (target_start_time <> target_shift.start_time or target_end_time <> target_shift.end_time) and (
       target_start_time < '07:30'::time or target_end_time > '11:30'::time or
       extract(minute from target_start_time)::integer not in (0, 30) or extract(second from target_start_time)::integer <> 0 or
       extract(minute from target_end_time)::integer not in (0, 30) or extract(second from target_end_time)::integer <> 0
    ) then
      raise exception 'INVALID_MORNING_TIME: Morning shift must be within 07:30-11:30 on 30-minute grid' using errcode = '22023';
    end if;
  elsif target_shift.shift_slot = 'AFTERNOON' then
    if (target_start_time <> target_shift.start_time or target_end_time <> target_shift.end_time) and (
       target_start_time < '12:30'::time or target_end_time > '16:30'::time or
       extract(minute from target_start_time)::integer not in (0, 30) or extract(second from target_start_time)::integer <> 0 or
       extract(minute from target_end_time)::integer not in (0, 30) or extract(second from target_end_time)::integer <> 0
    ) then
      raise exception 'INVALID_AFTERNOON_TIME: Afternoon shift must be within 12:30-16:30 on 30-minute grid' using errcode = '22023';
    end if;
  end if;

  update public.staff_shifts
  set
    start_time = target_start_time,
    end_time = target_end_time,
    note = nullif(btrim(coalesce(target_note, '')), ''),
    updated_at = now()
  where id = target_shift_id
  returning * into updated_row;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data,
    metadata
  ) values (
    actor_id,
    case when target_shift.shift_date < business_today then 'update_historical_shift_time' else 'update_shift_time' end,
    'staff_shifts',
    updated_row.id,
    to_jsonb(target_shift),
    to_jsonb(updated_row),
    jsonb_build_object('reason', reason)
  );

  return updated_row;
end;
$$;

create or replace function public.create_import_schedule_row(
  target_batch_id uuid,
  target_row_number integer,
  target_hash text,
  target_raw jsonb,
  target_normalized jsonb,
  target_status public.import_row_status,
  target_errors jsonb,
  target_warnings jsonb,
  target_course_id uuid,
  target_course_code text,
  target_course_name text,
  target_room_id uuid,
  target_lecturer_id uuid,
  target_date date,
  target_start time,
  target_end time,
  target_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  schedule_id uuid;
  lecturer_id_value uuid;
begin
  if not (select private.can_create_schedule_entries()) then
    raise exception 'SCHEDULE_CREATOR_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if target_status not in ('imported', 'warning') then
    raise exception 'INVALID_IMPORT_ROW_STATUS' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.import_batches b
    where b.id = target_batch_id
      and b.created_by = caller_id
      and b.status = 'importing'
  ) then
    raise exception 'IMPORT_BATCH_NOT_WRITABLE' using errcode = '42501';
  end if;

  lecturer_id_value := case
    when (select private.has_role('admin')) then target_lecturer_id
    else null
  end;

  insert into public.class_schedules (
    course_id, course_code_snapshot, course_name_snapshot, room_id,
    lecturer_id, class_code, schedule_date, start_time, end_time,
    source, source_row_id, import_batch_id, schedule_status, note, created_by,
    published_by, published_at
  ) values (
    target_course_id, target_course_code, target_course_name, target_room_id,
    lecturer_id_value, null, target_date, target_start, target_end,
    'import', null, target_batch_id, 'published', target_note, caller_id,
    caller_id, now()
  )
  returning id into schedule_id;

  insert into public.import_rows (
    import_batch_id, row_number, source_row_id, normalized_row_hash,
    raw_data, normalized_data, validation_status, errors, warnings,
    class_schedule_id
  ) values (
    target_batch_id, target_row_number, null, target_hash,
    coalesce(target_raw, '{}'::jsonb), coalesce(target_normalized, '{}'::jsonb),
    target_status, coalesce(target_errors, '[]'::jsonb),
    coalesce(target_warnings, '[]'::jsonb), schedule_id
  );

  return schedule_id;
end;
$$;

create or replace function public.hook_only_precreated_personnel(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if coalesce((event -> 'user' -> 'app_metadata' ->> 'preapproved')::boolean, false) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Email chưa được tạo trong danh sách Nhân sự.'
    )
  );
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    case
      when coalesce(new.raw_app_meta_data ->> 'provider', '') = 'google'
        then lower(coalesce(new.email, '')) like '%@eiu.edu.vn'
      else true
    end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.hook_only_precreated_personnel(jsonb) from public, anon, authenticated;
grant execute on function public.hook_only_precreated_personnel(jsonb) to supabase_auth_admin;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function private.is_active_user() to authenticated;
grant execute on function private.has_role(public.app_role) to authenticated;
grant execute on function private.can_create_schedule_entries() to authenticated;

revoke execute on function public.claim_class(uuid) from public, anon;
revoke execute on function public.withdraw_class(uuid) from public, anon;
revoke execute on function public.claim_email_notifications(integer) from public, anon, authenticated;

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
  where profiles.is_active = true
  order by profiles.full_name;
end;
$$;

revoke all on function public.list_active_people() from public, anon;
grant execute on function public.list_active_people() to authenticated;

grant execute on function public.claim_class(uuid) to authenticated;
grant execute on function public.withdraw_class(uuid) to authenticated;
grant execute on function public.claim_email_notifications(integer) to service_role;
revoke all on function private.snapshot_email_delivery_mode() from public, anon, authenticated;
revoke execute on function public.create_import_schedule_row(
  uuid, integer, text, jsonb, jsonb, public.import_row_status, jsonb, jsonb,
  uuid, text, text, uuid, uuid, date, time, time, text
) from public, anon;
grant execute on function public.create_import_schedule_row(
  uuid, integer, text, jsonb, jsonb, public.import_row_status, jsonb, jsonb,
  uuid, text, text, uuid, uuid, date, time, time, text
) to authenticated;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.courses enable row level security;
alter table public.rooms enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.class_schedules enable row level security;
alter table public.staff_shifts enable row level security;
alter table public.audit_logs enable row level security;
alter table public.email_notifications enable row level security;
alter table public.email_delivery_settings enable row level security;
alter table public.personnel_auth_reconciliation_logs enable row level security;

create policy profiles_select_self_or_admin on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (select private.has_role('admin'))
);

create policy profiles_admin_all on public.profiles
for all to authenticated
using ((select private.has_role('admin')))
with check ((select private.has_role('admin')));

create policy user_roles_select_active on public.user_roles
for select to authenticated
using ((select private.is_active_user()));

create policy user_roles_admin_all on public.user_roles
for all to authenticated
using ((select private.has_role('admin')))
with check ((select private.has_role('admin')));

create policy personnel_auth_reconciliation_admin_select
on public.personnel_auth_reconciliation_logs
for select to authenticated
using ((select private.has_role('admin')));

grant select on public.personnel_auth_reconciliation_logs to authenticated;
grant all on public.personnel_auth_reconciliation_logs to service_role;

create policy courses_select_active_users on public.courses
for select to authenticated
using ((select private.is_active_user()));

create policy courses_admin_all on public.courses
for all to authenticated
using ((select private.has_role('admin')))
with check ((select private.has_role('admin')));

create policy rooms_select_active_users on public.rooms
for select to authenticated
using ((select private.is_active_user()));

create policy rooms_admin_all on public.rooms
for all to authenticated
using ((select private.has_role('admin')))
with check ((select private.has_role('admin')));

create policy class_schedules_select on public.class_schedules
for select to authenticated
using (
  (select private.is_active_user())
  and (
    schedule_status <> 'cancelled'
    or (select private.has_role('admin'))
    or created_by = (select auth.uid())
  )
);

create policy class_schedules_creator_insert on public.class_schedules
for insert to authenticated
with check (
  (select private.can_create_schedule_entries())
  and created_by = (select auth.uid())
  and schedule_status = 'published'
  and published_by = (select auth.uid())
  and published_at is not null
  and cancelled_at is null
  and cancelled_by is null
  and (
    (select private.has_role('admin'))
    or (lecturer_id is null and lecturer_2_id is null)
  )
);

create policy class_schedules_authorized_delete on public.class_schedules
for delete to authenticated
using ((select private.can_create_schedule_entries()));

create policy class_schedules_admin_update on public.class_schedules
for update to authenticated
using ((select private.has_role('admin')))
with check ((select private.has_role('admin')));

create policy import_batches_select on public.import_batches
for select to authenticated
using (
  (select private.has_role('admin'))
  or created_by = (select auth.uid())
);

create policy import_batches_insert on public.import_batches
for insert to authenticated
with check (
  (select private.can_create_schedule_entries())
  and created_by = (select auth.uid())
);

create policy import_batches_owner_update on public.import_batches
for update to authenticated
using (
  (select private.has_role('admin'))
  or (created_by = (select auth.uid()) and status not in ('completed', 'failed'))
)
with check (
  (select private.has_role('admin'))
  or created_by = (select auth.uid())
);

create policy import_rows_select on public.import_rows
for select to authenticated
using (
  exists (
    select 1 from public.import_batches b
    where b.id = import_batch_id
      and (b.created_by = (select auth.uid()) or (select private.has_role('admin')))
  )
);

create policy import_rows_insert on public.import_rows
for insert to authenticated
with check (
  exists (
    select 1 from public.import_batches b
    where b.id = import_batch_id
      and b.created_by = (select auth.uid())
      and (select private.can_create_schedule_entries())
  )
);

create policy staff_shifts_select on public.staff_shifts
for select to authenticated
using ((select private.can_operate_skills_shifts((select auth.uid()))));

create policy audit_logs_admin_select on public.audit_logs
for select to authenticated
using ((select private.has_role('admin')));

create policy email_notifications_admin_select on public.email_notifications
for select to authenticated
using ((select private.has_role('admin')));

grant select on public.profiles, public.user_roles, public.courses, public.rooms,
  public.class_schedules, public.staff_shifts to authenticated;
grant select, insert, update on public.import_batches, public.import_rows to authenticated;
grant insert, update on public.class_schedules to authenticated;
revoke select on public.staff_shifts from anon, public;
grant select on public.staff_shifts to authenticated;
revoke insert, update, delete, truncate on public.staff_shifts from authenticated, anon, public;
grant all on public.staff_shifts to service_role;
grant all on public.profiles, public.user_roles, public.courses, public.rooms,
  public.class_schedules to authenticated;
grant select on public.audit_logs, public.email_notifications to authenticated;

-- Server-side directory imports use the secret/service role. Keep this grant
-- intentionally limited to the three tables the import workflow reads/writes.
grant select, insert, update on public.profiles, public.user_roles, public.courses
  to service_role;
grant select, insert, update, delete on public.email_notifications to service_role;
grant select, update on public.email_delivery_settings to service_role;
revoke all on function public.set_email_delivery_mode(text) from public, anon;
grant execute on function public.set_email_delivery_mode(text) to authenticated;


-- Source: supabase/schemas/02_room_type_scopes.sql
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

insert into public.profile_room_types (profile_id, room_type_id)
select profiles.id, '40000000-0000-0000-0000-000000000001'::uuid
from public.profiles as profiles
on conflict do nothing;

create or replace function private.assign_default_room_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profile_room_types (profile_id, room_type_id)
  values (new.id, '40000000-0000-0000-0000-000000000001'::uuid)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_assign_default_room_type on public.profiles;
create trigger profiles_assign_default_room_type
after insert on public.profiles
for each row execute function private.assign_default_room_type();

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

revoke execute on function private.assign_default_room_type() from public, anon, authenticated;
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


-- Source: supabase/schemas/03_registration_workflows.sql
-- Declarative mirror of 20260803090011_native_registration_workflows.sql.
create table if not exists public.basic_medical_registrations (
  id uuid primary key default gen_random_uuid(), academic_year text not null check (btrim(academic_year) <> ''),
  semester text not null check (semester in ('HK1','HK2','HK3','HK4')), start_date date not null,
  end_date date not null check (end_date >= start_date), course_id uuid not null references public.courses(id) on delete restrict,
  room_id uuid not null references public.rooms(id) on delete restrict, student_count integer not null check (student_count > 0),
  registrant_id uuid not null references public.profiles(id) on delete restrict,
  responsible_lecturer_id uuid not null references public.profiles(id) on delete restrict, note text,
  created_by uuid not null references public.profiles(id) on delete restrict, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.courses
  add column if not exists room_type_id uuid references public.room_types(id) on delete restrict;
update public.courses as courses
set room_type_id = coalesce(
  (
    select rooms.room_type_id
    from public.class_schedules as schedules
    join public.rooms as rooms on rooms.id = schedules.room_id
    where schedules.course_id = courses.id
    group by rooms.room_type_id
    order by count(*) desc, rooms.room_type_id
    limit 1
  ),
  (
    select rooms.room_type_id
    from public.basic_medical_registrations as registrations
    join public.rooms as rooms on rooms.id = registrations.room_id
    where registrations.course_id = courses.id
    group by rooms.room_type_id
    order by count(*) desc, rooms.room_type_id
    limit 1
  ),
  '40000000-0000-0000-0000-000000000001'::uuid
)
where courses.room_type_id is null;
alter table public.courses
  alter column room_type_id set default '40000000-0000-0000-0000-000000000001'::uuid,
  alter column room_type_id set not null;
create index if not exists courses_room_type_id_idx
  on public.courses (room_type_id, is_active, course_name);
alter table public.class_schedules add column if not exists basic_medical_registration_id uuid references public.basic_medical_registrations(id) on delete cascade;
drop trigger if exists class_schedules_email_outbox on public.class_schedules;
create trigger class_schedules_email_outbox
after insert on public.class_schedules
for each row
when (new.basic_medical_registration_id is null)
execute function private.enqueue_manual_schedule_email();
alter table public.class_schedules
  drop constraint if exists class_schedules_operating_hours;
alter table public.class_schedules
  add constraint class_schedules_operating_hours check (
    (
      basic_medical_registration_id is not null
      and start_time >= time '07:00'
      and end_time <= time '21:00'
    )
    or
    (
      basic_medical_registration_id is null
      and (
        (start_time >= time '07:30' and end_time <= time '11:30')
        or (start_time >= time '12:30' and end_time <= time '16:30')
      )
    )
  );
create table if not exists public.basic_medical_registration_sessions (
  id uuid primary key default gen_random_uuid(), registration_id uuid not null references public.basic_medical_registrations(id) on delete cascade,
  class_schedule_id uuid not null unique references public.class_schedules(id) on delete cascade,
  lesson_title text not null check (btrim(lesson_title) <> ''), teaching_lecturer_id uuid not null references public.profiles(id) on delete restrict,
  session_number integer not null check (session_number > 0), unique (registration_id, session_number)
);
create table if not exists public.equipment_catalog (
  id uuid primary key default gen_random_uuid(), item_name text not null check (btrim(item_name) <> ''),
  commercial_name text not null check (btrim(commercial_name) <> ''),
  item_type text, country_of_origin text, manufacturer text, model text, unit text not null check (btrim(unit) <> ''),
  is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists equipment_catalog_commercial_name_normalized_key
  on public.equipment_catalog (lower(btrim(commercial_name)));
create table if not exists public.equipment_requests (
  id uuid primary key default gen_random_uuid(), class_schedule_id uuid not null unique references public.class_schedules(id) on delete cascade,
  registrant_id uuid not null references public.profiles(id) on delete restrict,
  responsible_lecturer_id uuid not null references public.profiles(id) on delete restrict,
  semester text not null check (semester in ('HK1','HK2','HK3','HK4')),
  phone_snapshot text not null check (phone_snapshot ~ '^[0-9]{10}$'), email_snapshot text not null,
  receive_at timestamptz not null, return_at timestamptz not null check (return_at >= receive_at),
  status text not null default 'new' check (status in ('new','preparing','handed_over','returned','completed')),
  late_approval_status text not null default 'not_required' check (late_approval_status in ('not_required','pending','approved','rejected')),
  late_registration_reason text,
  late_requested_at timestamptz,
  late_reviewed_by uuid references public.profiles(id) on delete set null,
  late_reviewed_at timestamptz,
  late_review_note text,
  handover_file_url text, note text, created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.equipment_requests
  add column if not exists handover_staff_confirmed_by uuid references public.profiles(id) on delete set null,
  add column if not exists handover_staff_confirmed_at timestamptz,
  add column if not exists handover_recipient_signature text,
  add column if not exists handover_recipient_signed_at timestamptz,
  add column if not exists handover_effective_at timestamptz,
  add column if not exists return_staff_confirmed_by uuid references public.profiles(id) on delete set null,
  add column if not exists return_staff_confirmed_at timestamptz,
  add column if not exists return_recipient_signature text,
  add column if not exists return_recipient_signed_at timestamptz,
  add column if not exists return_effective_at timestamptz;
alter table public.equipment_requests
  add column if not exists late_approval_status text not null default 'not_required',
  add column if not exists late_registration_reason text,
  add column if not exists late_requested_at timestamptz,
  add column if not exists late_reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists late_reviewed_at timestamptz,
  add column if not exists late_review_note text;
alter table public.equipment_requests
  add constraint equipment_requests_late_approval_status_valid check (
    late_approval_status in ('not_required','pending','approved','rejected')
  ),
  add constraint equipment_requests_late_approval_reason_required check (
    late_approval_status = 'not_required'
    or nullif(btrim(late_registration_reason), '') is not null
  ),
  add constraint equipment_requests_late_review_valid check (
    (late_approval_status in ('not_required','pending') and late_reviewed_by is null and late_reviewed_at is null)
    or (late_approval_status in ('approved','rejected') and late_reviewed_by is not null and late_reviewed_at is not null)
  );
alter table public.equipment_requests
  add constraint equipment_requests_handover_signature_valid check (
    handover_recipient_signature is null or (
      length(handover_recipient_signature) between 100 and 400000
      and handover_recipient_signature like 'data:image/png;base64,%'
    )
  ),
  add constraint equipment_requests_return_signature_valid check (
    return_recipient_signature is null or (
      length(return_recipient_signature) between 100 and 400000
      and return_recipient_signature like 'data:image/png;base64,%'
    )
  );
create table if not exists public.equipment_request_items (
  id uuid primary key default gen_random_uuid(), request_id uuid not null references public.equipment_requests(id) on delete cascade,
  skill_name text not null check (btrim(skill_name) <> ''), catalog_item_id uuid not null references public.equipment_catalog(id) on delete restrict,
  quantity integer not null check (quantity > 0), note text, created_at timestamptz not null default now()
);
create index if not exists basic_medical_registrations_created_by_idx on public.basic_medical_registrations(created_by, created_at desc);
create index if not exists equipment_requests_registrant_idx on public.equipment_requests(registrant_id, created_at desc);
create index if not exists equipment_requests_late_approval_pending_idx
  on public.equipment_requests(created_at desc)
  where late_approval_status = 'pending';
create index if not exists equipment_request_items_request_idx on public.equipment_request_items(request_id);
alter table public.basic_medical_registrations enable row level security;
alter table public.basic_medical_registration_sessions enable row level security;
alter table public.equipment_catalog enable row level security;
alter table public.equipment_requests enable row level security;
alter table public.equipment_request_items enable row level security;
create trigger basic_medical_registrations_set_updated_at before update on public.basic_medical_registrations for each row execute function private.set_updated_at();

create or replace function public.save_basic_medical_registration(
  target_registration_id uuid,
  target_academic_year text,
  target_semester text,
  target_start_date date,
  target_end_date date,
  target_course_id uuid,
  target_room_id uuid,
  target_student_count integer,
  target_responsible_lecturer_id uuid,
  target_note text,
  target_sessions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  registration_id_value uuid;
  registration_owner_id uuid;
  course_code_value text;
  course_name_value text;
  session_row record;
  session_number_value integer := 0;
  schedule_id_value uuid;
  basic_medical_room_type_id constant uuid := '40000000-0000-0000-0000-000000000002'::uuid;
begin
  if actor_id is null
    or not (select private.is_active_user())
    or not (
      (select private.has_role('admin'))
      or (select private.has_role('staff'))
      or (
        (select private.has_room_type(basic_medical_room_type_id))
        and (
          (select private.has_role('lecturer'))
          or (select private.has_role('teaching_assistant'))
        )
        and exists (
          select 1
          from public.profiles as profiles
          where profiles.id = actor_id
            and profiles.allow_basic_medical_access
        )
      )
    ) then
    raise exception 'Bạn không có quyền lưu phiếu Y cơ sở.' using errcode = '42501';
  end if;

  if target_academic_year !~ '^\d{4}-\d{4}$'
    or substring(target_academic_year from 6 for 4)::integer
      <> substring(target_academic_year from 1 for 4)::integer + 1 then
    raise exception 'Năm học phải gồm hai năm liên tiếp, ví dụ 2026-2027.' using errcode = '22023';
  end if;
  if target_semester not in ('HK1', 'HK2', 'HK3', 'HK4') then
    raise exception 'Học kỳ không hợp lệ.' using errcode = '22023';
  end if;
  if target_start_date is null or target_end_date is null or target_end_date < target_start_date then
    raise exception 'Khoảng ngày đăng ký không hợp lệ.' using errcode = '22023';
  end if;
  if target_student_count is null or target_student_count < 1 then
    raise exception 'Số lượng sinh viên phải là số nguyên dương.' using errcode = '22023';
  end if;
  if target_sessions is null
    or jsonb_typeof(target_sessions) <> 'array'
    or jsonb_array_length(target_sessions) < 1
    or jsonb_array_length(target_sessions) > 500 then
    raise exception 'Danh sách buổi học phải có từ 1 đến 500 buổi.' using errcode = '22023';
  end if;

  select courses.course_code, courses.course_name
  into course_code_value, course_name_value
  from public.courses as courses
  where courses.id = target_course_id
    and courses.is_active
    and courses.room_type_id = basic_medical_room_type_id;
  if course_code_value is null then
    raise exception 'Môn học Y cơ sở không hợp lệ.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.rooms as rooms
    where rooms.id = target_room_id
      and rooms.is_active
      and rooms.room_type_id = basic_medical_room_type_id
  ) then
    raise exception 'Phòng Y cơ sở không hợp lệ.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles as profiles
    where profiles.id = target_responsible_lecturer_id
      and profiles.is_active
      and lower(btrim(coalesce(profiles.title, ''))) = 'giảng viên'
      and exists (
        select 1 from public.profile_room_types as assignments
        where assignments.profile_id = profiles.id
          and assignments.room_type_id = basic_medical_room_type_id
      )
  ) then
    raise exception 'Giảng viên phụ trách không hợp lệ.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(target_sessions) as session(
      schedule_date date,
      start_time time,
      end_time time,
      lesson_title text,
      teaching_lecturer_id uuid
    )
    left join public.profiles as profiles on profiles.id = session.teaching_lecturer_id
    where session.schedule_date is null
      or session.schedule_date < target_start_date
      or session.schedule_date > target_end_date
      or session.start_time is null
      or session.start_time < time '07:00'
      or session.end_time is null
      or session.end_time > time '21:00'
      or session.end_time <= session.start_time
      or nullif(btrim(session.lesson_title), '') is null
      or profiles.id is null
      or not profiles.is_active
      or lower(btrim(coalesce(profiles.title, ''))) <> 'giảng viên'
      or not exists (
        select 1 from public.profile_room_types as assignments
        where assignments.profile_id = profiles.id
          and assignments.room_type_id = basic_medical_room_type_id
      )
  ) then
    raise exception 'Danh sách buổi học có dữ liệu không hợp lệ.' using errcode = '22023';
  end if;

  if target_registration_id is null then
    insert into public.basic_medical_registrations (
      academic_year, semester, start_date, end_date, course_id, room_id,
      student_count, registrant_id, responsible_lecturer_id, note, created_by
    ) values (
      target_academic_year, target_semester, target_start_date, target_end_date,
      target_course_id, target_room_id, target_student_count, actor_id,
      target_responsible_lecturer_id, nullif(btrim(target_note), ''), actor_id
    ) returning id, created_by into registration_id_value, registration_owner_id;
  else
    select registrations.created_by
    into registration_owner_id
    from public.basic_medical_registrations as registrations
    where registrations.id = target_registration_id
    for update;

    if registration_owner_id is null then
      raise exception 'Không tìm thấy phiếu Y cơ sở.' using errcode = 'P0002';
    end if;
    if registration_owner_id <> actor_id
      and not (select private.has_role('admin'))
      and not (select private.has_role('staff')) then
      raise exception 'Bạn không có quyền điều chỉnh phiếu Y cơ sở.' using errcode = '42501';
    end if;

    update public.basic_medical_registrations
    set academic_year = target_academic_year,
        semester = target_semester,
        start_date = target_start_date,
        end_date = target_end_date,
        course_id = target_course_id,
        room_id = target_room_id,
        student_count = target_student_count,
        responsible_lecturer_id = target_responsible_lecturer_id,
        note = nullif(btrim(target_note), '')
    where id = target_registration_id;

    delete from public.class_schedules
    where basic_medical_registration_id = target_registration_id;
    registration_id_value := target_registration_id;
  end if;

  for session_row in
    select session.*
    from jsonb_to_recordset(target_sessions) as session(
      schedule_date date,
      start_time time,
      end_time time,
      lesson_title text,
      teaching_lecturer_id uuid
    )
  loop
    session_number_value := session_number_value + 1;
    insert into public.class_schedules (
      course_id, course_code_snapshot, course_name_snapshot, room_id,
      lecturer_id, lecturer_2_id, schedule_date, start_time, end_time,
      source, schedule_status, note, student_count, created_by,
      published_by, published_at, basic_medical_registration_id
    ) values (
      target_course_id, course_code_value, course_name_value, target_room_id,
      session_row.teaching_lecturer_id, null, session_row.schedule_date,
      session_row.start_time, session_row.end_time, 'manual', 'published',
      nullif(btrim(target_note), ''), target_student_count,
      registration_owner_id, actor_id, now(), registration_id_value
    ) returning id into schedule_id_value;

    insert into public.basic_medical_registration_sessions (
      registration_id, class_schedule_id, lesson_title,
      teaching_lecturer_id, session_number
    ) values (
      registration_id_value, schedule_id_value,
      btrim(session_row.lesson_title), session_row.teaching_lecturer_id,
      session_number_value
    );
  end loop;

  return registration_id_value;
end;
$$;
create trigger equipment_catalog_set_updated_at before update on public.equipment_catalog for each row execute function private.set_updated_at();
create trigger equipment_requests_set_updated_at before update on public.equipment_requests for each row execute function private.set_updated_at();
create or replace function private.enforce_equipment_request_semester_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_sched_semester text;
  target_room_type_id uuid;
begin
  if tg_op = 'INSERT' then
    if new.class_schedule_id is null then
      raise exception 'Lớp Skills lab không hợp lệ.' using errcode = '22023';
    end if;

    select schedules.semester, rooms.room_type_id
    into target_sched_semester, target_room_type_id
    from public.class_schedules as schedules
    join public.rooms as rooms on rooms.id = schedules.room_id
    where schedules.id = new.class_schedule_id
      and schedules.schedule_status <> 'cancelled';

    if target_room_type_id is null
      or target_room_type_id <> '40000000-0000-0000-0000-000000000001'::uuid then
      raise exception 'Lớp Skills lab không hợp lệ hoặc đã bị hủy.' using errcode = '22023';
    end if;

    if target_sched_semester is null
      or target_sched_semester not in ('HK1', 'HK2', 'HK3', 'HK4') then
      raise exception 'Lịch học chưa có thông tin Học kỳ hợp lệ.' using errcode = '22023';
    end if;

    new.semester := target_sched_semester;
    return new;

  elsif tg_op = 'UPDATE' then
    if new.class_schedule_id is not distinct from old.class_schedule_id then
      select schedules.semester, rooms.room_type_id
      into target_sched_semester, target_room_type_id
      from public.class_schedules as schedules
      join public.rooms as rooms on rooms.id = schedules.room_id
      where schedules.id = new.class_schedule_id
        and schedules.schedule_status <> 'cancelled';

      if target_sched_semester in ('HK1', 'HK2', 'HK3', 'HK4') then
        new.semester := target_sched_semester;
      else
        if new.semester is distinct from old.semester then
          raise exception 'Lịch học chưa có thông tin Học kỳ hợp lệ để cập nhật.' using errcode = '22023';
        end if;
        new.semester := old.semester;
      end if;

      return new;
    else
      select schedules.semester, rooms.room_type_id
      into target_sched_semester, target_room_type_id
      from public.class_schedules as schedules
      join public.rooms as rooms on rooms.id = schedules.room_id
      where schedules.id = new.class_schedule_id
        and schedules.schedule_status <> 'cancelled';

      if target_room_type_id is null
        or target_room_type_id <> '40000000-0000-0000-0000-000000000001'::uuid then
        raise exception 'Lớp Skills lab không hợp lệ hoặc đã bị hủy.' using errcode = '22023';
      end if;

      if target_sched_semester is null
        or target_sched_semester not in ('HK1', 'HK2', 'HK3', 'HK4') then
        raise exception 'Lịch học mới chưa có thông tin Học kỳ hợp lệ.' using errcode = '22023';
      end if;

      new.semester := target_sched_semester;
      return new;
    end if;
  end if;

  return new;
end;
$$;
drop trigger if exists equipment_requests_enforce_semester_authority on public.equipment_requests;
create trigger equipment_requests_enforce_semester_authority
before insert or update on public.equipment_requests
for each row execute function private.enforce_equipment_request_semester_authority();
create or replace function private.validate_equipment_request_content()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare skills_room_type constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
begin
  if new.semester not in ('HK1','HK2','HK3','HK4') then
    raise exception 'Học kỳ phải là HK1, HK2, HK3 hoặc HK4.' using errcode = '22023';
  end if;
  if length(coalesce(new.note, '')) > 2000 then
    raise exception 'Ghi chú không được vượt quá 2000 ký tự.' using errcode = '22023';
  end if;
  if length(coalesce(new.late_registration_reason, '')) > 1000 then
    raise exception 'Lý do đăng ký trễ không được vượt quá 1000 ký tự.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles profiles
    where profiles.id = new.responsible_lecturer_id and profiles.is_active
      and exists (select 1 from public.user_roles roles where roles.user_id = profiles.id and roles.role = 'lecturer')
      and exists (select 1 from public.profile_room_types scopes where scopes.profile_id = profiles.id and scopes.room_type_id = skills_room_type)
  ) then raise exception 'Giảng viên phụ trách không hợp lệ.' using errcode = '42501'; end if;
  return new;
end;
$$;
create trigger equipment_requests_validate_content
before insert or update on public.equipment_requests
for each row execute function private.validate_equipment_request_content();
create or replace function private.validate_equipment_request_timing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_schedule_date date;
  target_room_type_id uuid;
  receive_local timestamp;
  return_local timestamp;
begin
  if current_setting('app.equipment_confirmation_rpc', true) = 'true' then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.class_schedule_id is not distinct from old.class_schedule_id
    and new.receive_at is not distinct from old.receive_at
    and new.return_at is not distinct from old.return_at then
    return new;
  end if;

  select schedules.schedule_date, rooms.room_type_id
  into target_schedule_date, target_room_type_id
  from public.class_schedules as schedules
  join public.rooms as rooms on rooms.id = schedules.room_id
  where schedules.id = new.class_schedule_id
    and schedules.schedule_status <> 'cancelled';

  if target_schedule_date is null
    or target_room_type_id <> '40000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'Lớp Skills lab không hợp lệ hoặc đã bị hủy.' using errcode = '22023';
  end if;

  receive_local := new.receive_at at time zone 'Asia/Ho_Chi_Minh';
  return_local := new.return_at at time zone 'Asia/Ho_Chi_Minh';

  if receive_local::date < (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'Ngày nhận không được trước ngày hiện tại.' using errcode = '22023';
  end if;
  if receive_local::date > target_schedule_date then
    raise exception 'Ngày nhận phải bằng hoặc trước ngày học.' using errcode = '22023';
  end if;
  if return_local < receive_local then
    raise exception 'Ngày và giờ trả phải sau hoặc bằng thời điểm nhận.' using errcode = '22023';
  end if;
  if return_local::date < target_schedule_date then
    raise exception 'Ngày trả phải bằng hoặc sau ngày học.' using errcode = '22023';
  end if;
  if receive_local::time not in (time '09:00', time '11:00', time '14:00', time '16:00')
    or return_local::time not in (time '09:00', time '11:00', time '14:00', time '16:00') then
    raise exception 'Giờ nhận và giờ trả không hợp lệ.' using errcode = '22023';
  end if;

  return new;
end;
$$;
create trigger equipment_requests_validate_timing before insert or update on public.equipment_requests for each row execute function private.validate_equipment_request_timing();
create or replace function private.enforce_equipment_late_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_setting('app.equipment_confirmation_rpc', true) = 'true' then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and new.receive_at is not distinct from old.receive_at
    and new.late_registration_reason is not distinct from old.late_registration_reason
    and old.late_approval_status <> 'rejected' then
    return new;
  end if;
  if new.receive_at <= clock_timestamp() then
    raise exception 'Thời gian nhận thiết bị phải sau thời điểm đăng ký.' using errcode = '22023';
  end if;

  perform set_config('app.equipment_late_approval_system', 'true', true);
  if new.receive_at < clock_timestamp() + interval '24 hours' then
    if nullif(btrim(new.late_registration_reason), '') is null then
      raise exception 'Vui lòng nhập Lý do đăng ký trễ.' using errcode = '22023';
    end if;
    new.late_approval_status := 'pending';
    new.late_requested_at := clock_timestamp();
    new.late_reviewed_by := null;
    new.late_reviewed_at := null;
    new.late_review_note := null;
  else
    new.late_approval_status := 'not_required';
    new.late_registration_reason := null;
    new.late_requested_at := null;
    new.late_reviewed_by := null;
    new.late_reviewed_at := null;
    new.late_review_note := null;
  end if;
  return new;
end;
$$;
create trigger equipment_requests_enforce_late_approval
before insert or update on public.equipment_requests
for each row execute function private.enforce_equipment_late_approval();

create or replace function private.guard_equipment_late_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_rank integer;
  new_rank integer;
begin
  if (
    new.late_approval_status is distinct from old.late_approval_status
    or new.late_requested_at is distinct from old.late_requested_at
    or new.late_reviewed_by is distinct from old.late_reviewed_by
    or new.late_reviewed_at is distinct from old.late_reviewed_at
    or new.late_review_note is distinct from old.late_review_note
  ) and current_setting('app.equipment_late_approval_system', true) <> 'true'
    and current_setting('app.equipment_late_approval_rpc', true) <> 'true'
    and current_setting('app.equipment_confirmation_rpc', true) <> 'true' then
    raise exception 'Vui lòng dùng luồng duyệt đăng ký trễ.' using errcode = '42501';
  end if;

  old_rank := case old.status
    when 'new' then 0 when 'preparing' then 1 when 'handed_over' then 2
    when 'returned' then 3 when 'completed' then 4 end;
  new_rank := case new.status
    when 'new' then 0 when 'preparing' then 1 when 'handed_over' then 2
    when 'returned' then 3 when 'completed' then 4 end;
  if new_rank > old_rank and old.late_approval_status in ('pending', 'rejected') then
    raise exception 'Phiếu chưa được duyệt đăng ký trễ.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger equipment_requests_guard_late_approval
before update on public.equipment_requests
for each row execute function private.guard_equipment_late_approval();
create or replace function private.guard_equipment_request_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_schedule_date date;
  target_room_type_id uuid;
begin
  if current_setting('app.equipment_confirmation_rpc', true) = 'true' then
    return new;
  end if;

  if old.status not in ('new', 'preparing')
    and (
      new.class_schedule_id is distinct from old.class_schedule_id
      or new.semester is distinct from old.semester
      or new.registrant_id is distinct from old.registrant_id
      or new.responsible_lecturer_id is distinct from old.responsible_lecturer_id
      or new.phone_snapshot is distinct from old.phone_snapshot
      or new.email_snapshot is distinct from old.email_snapshot
      or new.receive_at is distinct from old.receive_at
      or new.return_at is distinct from old.return_at
      or new.note is distinct from old.note
      or new.created_by is distinct from old.created_by
    ) then
    raise exception 'Chỉ có thể điều chỉnh phiếu trạng thái Mới hoặc Đã soạn.' using errcode = '42501';
  end if;

  if (select private.has_role('admin')) or (select private.has_role('staff')) then
    if new.status is distinct from old.status
      or new.handover_staff_confirmed_by is distinct from old.handover_staff_confirmed_by
      or new.handover_staff_confirmed_at is distinct from old.handover_staff_confirmed_at
      or new.handover_recipient_signature is distinct from old.handover_recipient_signature
      or new.handover_recipient_signed_at is distinct from old.handover_recipient_signed_at
      or new.handover_effective_at is distinct from old.handover_effective_at
      or new.return_staff_confirmed_by is distinct from old.return_staff_confirmed_by
      or new.return_staff_confirmed_at is distinct from old.return_staff_confirmed_at
      or new.return_recipient_signature is distinct from old.return_recipient_signature
      or new.return_recipient_signed_at is distinct from old.return_recipient_signed_at
      or new.return_effective_at is distinct from old.return_effective_at then
      raise exception 'Vui lòng dùng luồng xác nhận trạng thái phiếu.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.registrant_id is distinct from old.registrant_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.status is distinct from old.status
    or new.handover_file_url is distinct from old.handover_file_url
    or new.handover_staff_confirmed_by is distinct from old.handover_staff_confirmed_by
    or new.handover_staff_confirmed_at is distinct from old.handover_staff_confirmed_at
    or new.handover_recipient_signature is distinct from old.handover_recipient_signature
    or new.handover_recipient_signed_at is distinct from old.handover_recipient_signed_at
    or new.handover_effective_at is distinct from old.handover_effective_at
    or new.return_staff_confirmed_by is distinct from old.return_staff_confirmed_by
    or new.return_staff_confirmed_at is distinct from old.return_staff_confirmed_at
    or new.return_recipient_signature is distinct from old.return_recipient_signature
    or new.return_recipient_signed_at is distinct from old.return_recipient_signed_at
    or new.return_effective_at is distinct from old.return_effective_at
    or new.phone_snapshot is distinct from old.phone_snapshot
    or new.email_snapshot is distinct from old.email_snapshot then
    raise exception 'Người đăng ký chỉ được điều chỉnh nội dung phiếu.' using errcode = '42501';
  end if;

  select schedules.schedule_date, rooms.room_type_id
  into target_schedule_date, target_room_type_id
  from public.class_schedules as schedules
  join public.rooms as rooms on rooms.id = schedules.room_id
  where schedules.id = new.class_schedule_id
    and schedules.schedule_status <> 'cancelled';

  if target_schedule_date is null
    or target_room_type_id <> '40000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'Lớp Skills lab không hợp lệ hoặc đã bị hủy.' using errcode = '22023';
  end if;

  if (new.receive_at at time zone 'Asia/Ho_Chi_Minh')::date > target_schedule_date then
    raise exception 'Ngày nhận phải bằng hoặc trước ngày học.' using errcode = '22023';
  end if;

  if new.responsible_lecturer_id <> new.registrant_id
    and not exists (
      select 1
      from public.list_scoped_lecturers(target_room_type_id) as lecturers
      where lecturers.id = new.responsible_lecturer_id
    ) then
    raise exception 'Giảng viên phụ trách không hợp lệ.' using errcode = '22023';
  end if;

  return new;
end;
$$;
create or replace function private.can_manage_equipment_schedule(target_schedule_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.has_role('admin')) or (
    (select private.has_role('staff')) and exists (
      select 1 from public.class_schedules schedules
      join public.rooms rooms on rooms.id = schedules.room_id
      where schedules.id = target_schedule_id
        and (select private.has_room_type(rooms.room_type_id))
    )
  );
$$;
create or replace function private.can_manage_equipment_request(target_request_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.equipment_requests requests
    where requests.id = target_request_id
      and (select private.can_manage_equipment_schedule(requests.class_schedule_id))
  );
$$;
create or replace function private.enforce_equipment_request_room_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid());
begin
  if (select auth.role()) = 'service_role' or (select private.has_role('admin')) then
    return coalesce(new, old);
  end if;
  if (select private.has_role('staff')) then
    if not (select private.can_manage_equipment_schedule(coalesce(new.class_schedule_id, old.class_schedule_id))) then
      raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode = '42501';
    end if;
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and new.registrant_id = actor_id and new.created_by = actor_id then return new; end if;
  if tg_op = 'UPDATE' and ((old.registrant_id = actor_id and new.registrant_id = actor_id) or (old.responsible_lecturer_id = actor_id and new.responsible_lecturer_id = actor_id)) then return new; end if;
  raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode = '42501';
end;
$$;
create trigger equipment_requests_enforce_room_scope
before insert or update or delete on public.equipment_requests
for each row execute function private.enforce_equipment_request_room_scope();
create or replace function public.manager_confirm_equipment_status(
  target_request_id uuid,
  target_status text
)
returns public.equipment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.equipment_requests;
  changed_row public.equipment_requests;
  actor_id uuid := (select auth.uid());
  current_rank integer;
  target_rank integer;
begin
  if actor_id is null or not (select private.is_active_user())
    or not ((select private.has_role('admin')) or (select private.has_role('staff'))) then
    raise exception 'Chỉ Admin hoặc Chuyên viên được chuyển trạng thái phiếu.' using errcode = '42501';
  end if;
  if target_status not in ('new','preparing','handed_over','returned','completed') then
    raise exception 'Trạng thái phiếu không hợp lệ.' using errcode = '22023';
  end if;

  select * into current_row from public.equipment_requests
  where id = target_request_id for update;
  if current_row.id is null then
    raise exception 'Không tìm thấy phiếu thiết bị.' using errcode = 'P0002';
  end if;
  if not (select private.can_manage_equipment_request(target_request_id)) then
    raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  if current_row.status = 'cancelled' then
    raise exception 'EQUIPMENT_REQUEST_CANCELLED_TERMINAL' using errcode = '22023';
  end if;
  current_rank := case current_row.status
    when 'new' then 0 when 'preparing' then 1 when 'handed_over' then 2
    when 'returned' then 3 when 'completed' then 4 end;
  target_rank := case target_status
    when 'new' then 0 when 'preparing' then 1 when 'handed_over' then 2
    when 'returned' then 3 when 'completed' then 4 end;
  perform set_config('app.equipment_confirmation_rpc', 'true', true);

  if target_rank < current_rank then
    update public.equipment_requests
    set status = target_status,
        handover_staff_confirmed_by = case when target_rank >= 2 then handover_staff_confirmed_by else null end,
        handover_staff_confirmed_at = case when target_rank >= 2 then handover_staff_confirmed_at else null end,
        handover_signature_path = case when target_rank >= 2 then handover_signature_path else null end,
        handover_recipient_signed_at = case when target_rank >= 2 then handover_recipient_signed_at else null end,
        handover_effective_at = case when target_rank >= 2 then handover_effective_at else null end,
        return_staff_confirmed_by = null,
        return_staff_confirmed_at = null,
        return_signature_path = null,
        return_recipient_signed_at = null,
        return_effective_at = null
    where id = target_request_id returning * into changed_row;
    return changed_row;
  end if;

  if target_status = current_row.status
    and target_status not in ('handed_over','returned') then
    return current_row;
  end if;
  if target_status = 'preparing' then
    update public.equipment_requests set status = 'preparing'
    where id = target_request_id returning * into changed_row;
  elsif target_status = 'handed_over' then
    if current_row.status = 'new' then
      raise exception 'Phải chuyển phiếu sang Đã soạn trước khi xác nhận Đã giao.' using errcode = '22023';
    end if;
    update public.equipment_requests
    set handover_staff_confirmed_by = actor_id,
        handover_staff_confirmed_at = clock_timestamp(),
        status = case when handover_signature_path is not null then 'handed_over' else status end
    where id = target_request_id returning * into changed_row;
  elsif target_status = 'returned' then
    if current_row.status not in ('handed_over','returned') then
      raise exception 'Phải xác nhận đã giao trước khi xác nhận trả.' using errcode = '22023';
    end if;
    update public.equipment_requests
    set return_staff_confirmed_by = actor_id,
        return_staff_confirmed_at = clock_timestamp(),
        status = case when return_signature_path is not null then 'completed' else status end
    where id = target_request_id returning * into changed_row;
  else
    raise exception 'Trạng thái Hoàn thành chỉ được tạo khi đủ hai xác nhận trả.' using errcode = '22023';
  end if;
  return changed_row;
end;
$$;

create or replace function public.manager_review_late_equipment_request(
  target_request_id uuid,
  target_decision text,
  target_note text default null
)
returns public.equipment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_row public.equipment_requests;
  changed_row public.equipment_requests;
begin
  if actor_id is null or not (select private.is_active_user())
    or not ((select private.has_role('admin')) or (select private.has_role('staff'))) then
    raise exception 'Chỉ Admin hoặc Chuyên viên được duyệt đăng ký trễ.' using errcode = '42501';
  end if;
  if target_decision not in ('approved', 'rejected') then
    raise exception 'Kết quả duyệt đăng ký trễ không hợp lệ.' using errcode = '22023';
  end if;

  select * into current_row
  from public.equipment_requests
  where id = target_request_id
  for update;
  if current_row.id is null then
    raise exception 'Không tìm thấy phiếu thiết bị.' using errcode = 'P0002';
  end if;
  if not (select private.can_manage_equipment_request(target_request_id)) then
    raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  if current_row.late_approval_status <> 'pending' then
    raise exception 'Phiếu không ở trạng thái Chờ duyệt đăng ký trễ.' using errcode = '22023';
  end if;
  if current_row.receive_at <= clock_timestamp() then
    raise exception 'Thời gian nhận thiết bị đã đến hoặc đã qua.' using errcode = '22023';
  end if;

  perform set_config('app.equipment_late_approval_rpc', 'true', true);
  update public.equipment_requests
  set late_approval_status = target_decision,
      late_reviewed_by = actor_id,
      late_reviewed_at = clock_timestamp(),
      late_review_note = nullif(btrim(target_note), '')
  where id = target_request_id
  returning * into changed_row;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    old_data,
    new_data,
    metadata
  ) values (
    actor_id,
    case when target_decision = 'approved' then 'approve_late_equipment_registration' else 'reject_late_equipment_registration' end,
    'equipment_request',
    target_request_id,
    jsonb_build_object('late_approval_status', current_row.late_approval_status),
    jsonb_build_object('late_approval_status', target_decision),
    jsonb_build_object('review_note', nullif(btrim(target_note), ''))
  );

  return changed_row;
end;
$$;

create or replace function public.registrant_confirm_equipment_handoff(
  target_request_id uuid,
  target_phase text,
  target_signature text
)
returns public.equipment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.equipment_requests;
  changed_row public.equipment_requests;
  actor_id uuid := (select auth.uid());
  signed_at_value timestamptz := clock_timestamp();
  class_start_at timestamptz;
  signature_bytes bytea;
begin
  if actor_id is null or not (select private.is_active_user()) then
    raise exception 'Phiên đăng nhập đã hết hạn.' using errcode = '42501';
  end if;
  if target_phase not in ('handover','return') then
    raise exception 'Loại xác nhận không hợp lệ.' using errcode = '22023';
  end if;
  if target_signature is null
    or length(target_signature) not between 100 and 400000
    or target_signature not like 'data:image/png;base64,%' then
    raise exception 'Chữ ký điện tử không hợp lệ.' using errcode = '22023';
  end if;
  begin
    signature_bytes := decode(split_part(target_signature, ',', 2), 'base64');
  exception when others then
    raise exception 'Chữ ký điện tử không hợp lệ.' using errcode = '22023';
  end;
  if substring(signature_bytes from 1 for 8) <> decode('iVBORw0KGgo=', 'base64') then
    raise exception 'Chữ ký phải là ảnh PNG.' using errcode = '22023';
  end if;

  select requests.* into current_row
  from public.equipment_requests as requests
  where requests.id = target_request_id for update;
  if current_row.id is null
    or actor_id not in (current_row.registrant_id, current_row.responsible_lecturer_id) then
    raise exception 'Chỉ Người đăng ký hoặc Giảng viên phụ trách được ký xác nhận.' using errcode = '42501';
  end if;
  select ((schedules.schedule_date + schedules.start_time) at time zone 'Asia/Ho_Chi_Minh')
  into class_start_at
  from public.class_schedules as schedules
  where schedules.id = current_row.class_schedule_id;
  perform set_config('app.equipment_confirmation_rpc', 'true', true);

  if target_phase = 'handover' then
    if current_row.status not in ('new','preparing','handed_over') then
      raise exception 'Phiếu không còn ở bước xác nhận giao.' using errcode = '22023';
    end if;
    if current_row.handover_staff_confirmed_at is null
      and current_row.status <> 'handed_over' then
      raise exception 'Kho phải xác nhận Đã giao trước khi Người đăng ký hoặc Giảng viên phụ trách ký.' using errcode = '22023';
    end if;
    update public.equipment_requests
    set handover_recipient_signature = target_signature,
        handover_recipient_signed_at = signed_at_value,
        handover_effective_at = case
          when signed_at_value > class_start_at then receive_at
          else signed_at_value end,
        status = case when handover_staff_confirmed_at is not null then 'handed_over' else status end
    where id = target_request_id returning * into changed_row;
  else
    if current_row.status not in ('handed_over','returned') then
      raise exception 'Phải xác nhận đã giao trước khi ký xác nhận trả.' using errcode = '22023';
    end if;
    update public.equipment_requests
    set return_recipient_signature = target_signature,
        return_recipient_signed_at = signed_at_value,
        return_effective_at = case
          when signed_at_value < return_at then return_at
          else signed_at_value end,
        status = case when return_staff_confirmed_at is not null then 'completed' else status end
    where id = target_request_id returning * into changed_row;
  end if;
  return changed_row;
end;
$$;
create trigger equipment_requests_guard_update before update on public.equipment_requests for each row execute function private.guard_equipment_request_update();

create or replace function public.create_equipment_request_with_items(
  target_class_schedule_id uuid,
  target_semester text,
  target_responsible_lecturer_id uuid,
  target_receive_at timestamptz,
  target_return_at timestamptz,
  target_note text,
  target_late_registration_reason text,
  target_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_profile public.profiles;
  request_id uuid;
  req_late_status text;
  derived_semester text;
begin
  if actor_id is null or not (select private.is_active_user())
    or not (
      (select private.has_role('admin'))
      or (select private.has_role('staff'))
      or (select private.has_role('teaching_assistant'))
      or (select private.has_role('lecturer'))
    ) then
    raise exception 'Bạn không có quyền tạo phiếu thiết bị.' using errcode = '42501';
  end if;

  select schedules.semester into derived_semester
  from public.class_schedules as schedules
  join public.rooms as rooms on rooms.id = schedules.room_id
  where schedules.id = target_class_schedule_id
    and schedules.schedule_status <> 'cancelled'
    and rooms.room_type_id = '40000000-0000-0000-0000-000000000001'::uuid
    and (select private.has_room_type(rooms.room_type_id));

  if not found then
    raise exception 'Lớp Skills lab không hợp lệ.' using errcode = '42501';
  end if;

  if derived_semester is null or derived_semester not in ('HK1','HK2','HK3','HK4') then
    raise exception 'Lịch học chưa có thông tin Học kỳ hợp lệ.' using errcode = '22023';
  end if;

  if target_items is null or jsonb_typeof(target_items) <> 'array'
    or jsonb_array_length(target_items) = 0
    or jsonb_array_length(target_items) > 500 then
    raise exception 'Danh sách thiết bị phải có từ 1 đến 500 dòng.' using errcode = '22023';
  end if;

  if target_responsible_lecturer_id <> actor_id
    and not exists (
      select 1
      from public.list_scoped_lecturers('40000000-0000-0000-0000-000000000001'::uuid) as lecturers
      where lecturers.id = target_responsible_lecturer_id
    ) then
    raise exception 'Giảng viên phụ trách không hợp lệ.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(target_items) as item(
      skill_name text, catalog_item_id uuid, quantity integer, note text
    )
    left join public.equipment_catalog as catalog on catalog.id = item.catalog_item_id
    where item.skill_name is null or btrim(item.skill_name) = ''
      or length(item.skill_name) > 200
      or item.catalog_item_id is null
      or item.quantity is null or item.quantity < 1 or item.quantity > 100000
      or length(coalesce(item.note, '')) > 1000
      or catalog.id is null or not catalog.is_active
  ) then
    raise exception 'Danh sách thiết bị có dữ liệu không hợp lệ.' using errcode = '22023';
  end if;

  select * into actor_profile from public.profiles where id = actor_id;
  if actor_profile.id is null or coalesce(actor_profile.phone, '') !~ '^\d{10}$' then
    raise exception 'Hồ sơ Nhân sự chưa có số điện thoại 10 chữ số.' using errcode = '22023';
  end if;

  insert into public.equipment_requests (
    class_schedule_id, semester, registrant_id, responsible_lecturer_id,
    phone_snapshot, email_snapshot, receive_at, return_at,
    late_registration_reason, note, created_by
  ) values (
    target_class_schedule_id, derived_semester, actor_id, target_responsible_lecturer_id,
    actor_profile.phone, actor_profile.email, target_receive_at, target_return_at,
    nullif(btrim(target_late_registration_reason), ''), nullif(btrim(target_note), ''), actor_id
  ) returning id into request_id;

  insert into public.equipment_request_items (
    request_id, skill_name, catalog_item_id, quantity, note
  )
  select request_id, btrim(item.skill_name), item.catalog_item_id, item.quantity,
         nullif(btrim(item.note), '')
  from jsonb_to_recordset(target_items) as item(
    skill_name text, catalog_item_id uuid, quantity integer, note text
  );

  select late_approval_status into req_late_status
  from public.equipment_requests where id = request_id;

  perform private.enqueue_equipment_request_outbox_event(
    request_id,
    case when req_late_status = 'pending' then 'late_approval_requested' else 'created' end,
    null,
    actor_id
  );

  return request_id;
end;
$$;

revoke all on function public.create_equipment_request_with_items(uuid,text,uuid,timestamptz,timestamptz,text,text,jsonb) from public, anon;
grant execute on function public.create_equipment_request_with_items(uuid,text,uuid,timestamptz,timestamptz,text,text,jsonb) to authenticated;

drop function if exists public.update_equipment_request_content(uuid, uuid, uuid, timestamptz, timestamptz, text, jsonb);
drop function if exists public.update_equipment_request_content(uuid, uuid, text, uuid, timestamptz, timestamptz, text, jsonb);
create or replace function public.update_equipment_request_content(
  target_request_id uuid,
  target_class_schedule_id uuid,
  target_semester text,
  target_responsible_lecturer_id uuid,
  target_receive_at timestamptz,
  target_return_at timestamptz,
  target_note text,
  target_late_registration_reason text,
  target_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_request_id uuid;
  req_late_status text;
  actor_id uuid := (select auth.uid());
  target_sched_semester text;
  current_request record;
  effective_semester text;
begin
  select schedules.semester into target_sched_semester
  from public.class_schedules as schedules
  join public.rooms as rooms on rooms.id = schedules.room_id
  where schedules.id = target_class_schedule_id
    and schedules.schedule_status <> 'cancelled'
    and rooms.room_type_id = '40000000-0000-0000-0000-000000000001'::uuid
    and (select private.has_room_type(rooms.room_type_id));

  if not found then
    raise exception 'Lớp Skills lab không hợp lệ.' using errcode = '42501';
  end if;

  select req.class_schedule_id, req.semester into current_request
  from public.equipment_requests as req
  where req.id = target_request_id;

  if target_sched_semester in ('HK1','HK2','HK3','HK4') then
    effective_semester := target_sched_semester;
  elsif current_request.class_schedule_id is not null
    and current_request.class_schedule_id = target_class_schedule_id
    and current_request.semester in ('HK1','HK2','HK3','HK4') then
    effective_semester := current_request.semester;
  else
    effective_semester := null;
  end if;

  if effective_semester is null or effective_semester not in ('HK1','HK2','HK3','HK4') then
    raise exception 'Lịch học chưa có thông tin Học kỳ hợp lệ.' using errcode = '22023';
  end if;

  if target_items is null
    or jsonb_typeof(target_items) <> 'array'
    or jsonb_array_length(target_items) = 0 then
    raise exception 'Danh sách thiết bị không hợp lệ.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(target_items) as item(
      skill_name text, catalog_item_id uuid, quantity integer, note text
    )
    left join public.equipment_catalog catalog on catalog.id = item.catalog_item_id
    where item.skill_name is null
      or btrim(item.skill_name) = ''
      or item.catalog_item_id is null
      or item.quantity is null
      or item.quantity < 1
      or catalog.id is null
      or not catalog.is_active
  ) then
    raise exception 'Danh sách thiết bị có dữ liệu không hợp lệ.' using errcode = '22023';
  end if;

  update public.equipment_requests
  set class_schedule_id = target_class_schedule_id,
      semester = effective_semester,
      responsible_lecturer_id = target_responsible_lecturer_id,
      receive_at = target_receive_at,
      return_at = target_return_at,
      note = nullif(btrim(target_note), ''),
      late_registration_reason = nullif(btrim(target_late_registration_reason), '')
  where id = target_request_id
    and status in ('new', 'preparing')
  returning id into updated_request_id;

  if updated_request_id is null then
    raise exception 'Không tìm thấy phiếu hoặc bạn không có quyền điều chỉnh.' using errcode = '42501';
  end if;

  delete from public.equipment_request_items where request_id = target_request_id;

  insert into public.equipment_request_items (
    request_id, skill_name, catalog_item_id, quantity, note
  )
  select target_request_id,
         btrim(item.skill_name),
         item.catalog_item_id,
         item.quantity,
         nullif(btrim(item.note), '')
  from jsonb_to_recordset(target_items) as item(
    skill_name text, catalog_item_id uuid, quantity integer, note text
  );

  select late_approval_status into req_late_status
  from public.equipment_requests where id = target_request_id;

  perform private.enqueue_equipment_request_outbox_event(
    target_request_id,
    case when req_late_status = 'pending' then 'late_approval_requested' else 'updated' end,
    null,
    actor_id
  );

  return updated_request_id;
end;
$$;

revoke execute on function public.update_equipment_request_content(uuid, uuid, text, uuid, timestamptz, timestamptz, text, text, jsonb) from public, anon;
grant execute on function public.update_equipment_request_content(uuid, uuid, text, uuid, timestamptz, timestamptz, text, text, jsonb) to authenticated;

create or replace function public.update_equipment_request_content(
  target_request_id uuid,
  target_class_schedule_id uuid,
  target_semester text,
  target_responsible_lecturer_id uuid,
  target_receive_at timestamptz,
  target_return_at timestamptz,
  target_note text,
  target_items jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select public.update_equipment_request_content(
    target_request_id,
    target_class_schedule_id,
    target_semester,
    target_responsible_lecturer_id,
    target_receive_at,
    target_return_at,
    target_note,
    coalesce((
      select requests.late_registration_reason
      from public.equipment_requests as requests
      where requests.id = target_request_id
    ), ''),
    target_items
  );
$$;

revoke execute on function public.update_equipment_request_content(uuid, uuid, text, uuid, timestamptz, timestamptz, text, jsonb) from public, anon;
grant execute on function public.update_equipment_request_content(uuid, uuid, text, uuid, timestamptz, timestamptz, text, jsonb) to authenticated;
create policy basic_medical_registrations_select on public.basic_medical_registrations for select to authenticated using ((select private.is_active_user()) and ((select private.has_role('admin')) or (select private.has_role('staff')) or ((select private.has_room_type('40000000-0000-0000-0000-000000000002'::uuid)) and (created_by = (select auth.uid()) or registrant_id = (select auth.uid()) or responsible_lecturer_id = (select auth.uid())))));
create policy basic_medical_registrations_manage on public.basic_medical_registrations for all to authenticated using ((select private.has_role('admin')) or (select private.has_role('staff')) or created_by = (select auth.uid())) with check (created_by = (select auth.uid()) and ((select private.has_role('admin')) or (select private.has_role('staff')) or (((select private.has_role('lecturer')) or (select private.has_role('teaching_assistant'))) and (select private.has_room_type('40000000-0000-0000-0000-000000000002'::uuid)) and exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.allow_basic_medical_access))));
create policy basic_medical_sessions_select on public.basic_medical_registration_sessions for select to authenticated using (exists (select 1 from public.basic_medical_registrations r where r.id = registration_id));
create policy basic_medical_sessions_manage on public.basic_medical_registration_sessions for all to authenticated using (exists (select 1 from public.basic_medical_registrations r where r.id = registration_id and (r.created_by = (select auth.uid()) or (select private.has_role('admin')) or (select private.has_role('staff'))))) with check (exists (select 1 from public.basic_medical_registrations r where r.id = registration_id and (r.created_by = (select auth.uid()) or (select private.has_role('admin')) or (select private.has_role('staff')))));
create policy equipment_catalog_select on public.equipment_catalog for select to authenticated using ((select private.is_active_user()));
create policy equipment_catalog_admin on public.equipment_catalog for all to authenticated using ((select private.has_role('admin')) or (select private.has_role('staff'))) with check ((select private.has_role('admin')) or (select private.has_role('staff')));
create policy equipment_requests_select on public.equipment_requests for select to authenticated using ((select private.is_active_user()) and ((select private.can_manage_equipment_request(id)) or registrant_id = (select auth.uid()) or responsible_lecturer_id = (select auth.uid())));
create policy equipment_requests_insert on public.equipment_requests for insert to authenticated with check ((select private.is_active_user()) and registrant_id = (select auth.uid()) and created_by = (select auth.uid()));
create policy equipment_requests_update on public.equipment_requests for update to authenticated using ((select private.can_manage_equipment_request(id)) or registrant_id = (select auth.uid())) with check ((select private.can_manage_equipment_request(id)) or (registrant_id = (select auth.uid()) and created_by = (select auth.uid())));
create policy equipment_requests_delete on public.equipment_requests for delete to authenticated using ((select private.can_manage_equipment_request(id)));
create policy equipment_items_select on public.equipment_request_items for select to authenticated using (exists (select 1 from public.equipment_requests r where r.id = request_id));
create policy equipment_items_manage on public.equipment_request_items for all to authenticated using (exists (select 1 from public.equipment_requests r where r.id = request_id and r.status in ('new', 'preparing') and (r.registrant_id = (select auth.uid()) or (select private.can_manage_equipment_request(r.id))))) with check (exists (select 1 from public.equipment_requests r where r.id = request_id and r.status in ('new', 'preparing') and (r.registrant_id = (select auth.uid()) or (select private.can_manage_equipment_request(r.id)))));
grant select, insert, update, delete on public.basic_medical_registrations, public.basic_medical_registration_sessions,
  public.equipment_catalog, public.equipment_requests, public.equipment_request_items to authenticated;
revoke execute on function public.save_basic_medical_registration(uuid, text, text, date, date, uuid, uuid, integer, uuid, text, jsonb) from public, anon;
grant execute on function public.save_basic_medical_registration(uuid, text, text, date, date, uuid, uuid, integer, uuid, text, jsonb) to authenticated;
grant select on public.class_schedules, public.rooms, public.equipment_catalog, public.equipment_requests,
  public.equipment_request_items to service_role;
revoke execute on function public.update_equipment_request_content(uuid, uuid, text, uuid, timestamptz, timestamptz, text, text, jsonb) from public, anon;
grant execute on function public.update_equipment_request_content(uuid, uuid, text, uuid, timestamptz, timestamptz, text, text, jsonb) to authenticated;
revoke execute on function public.update_equipment_request_content(uuid, uuid, text, uuid, timestamptz, timestamptz, text, jsonb) from public, anon;
grant execute on function public.update_equipment_request_content(uuid, uuid, text, uuid, timestamptz, timestamptz, text, jsonb) to authenticated;
revoke execute on function public.manager_confirm_equipment_status(uuid, text) from public, anon;
grant execute on function public.manager_confirm_equipment_status(uuid, text) to authenticated;
revoke all on function private.validate_equipment_request_content() from public, anon, authenticated;
revoke execute on function public.manager_review_late_equipment_request(uuid, text, text) from public, anon;
grant execute on function public.manager_review_late_equipment_request(uuid, text, text) to authenticated;
revoke all on function private.can_manage_equipment_schedule(uuid) from public, anon;
revoke all on function private.can_manage_equipment_request(uuid) from public, anon;
grant execute on function private.can_manage_equipment_schedule(uuid) to authenticated;
grant execute on function private.can_manage_equipment_request(uuid) to authenticated;
revoke all on function private.enforce_equipment_request_room_scope() from public, anon, authenticated;
revoke all on function private.enforce_equipment_request_semester_authority() from public, anon, authenticated;
revoke execute on function public.registrant_confirm_equipment_handoff(uuid, text, text) from public, anon;
grant execute on function public.registrant_confirm_equipment_handoff(uuid, text, text) to authenticated;

create or replace function public.import_equipment_requests(target_requests jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  request_payload jsonb;
  item_payload jsonb;
  new_request_id uuid;
  source_code text;
  results jsonb := '[]'::jsonb;
  target_sched_semester text;
  derived_semester text;
begin
  if actor_id is null
    or not (select private.is_active_user())
    or not ((select private.has_role('admin')) or (select private.has_role('staff'))) then
    raise exception 'Chỉ Quản trị viên hoặc Chuyên viên được import phiếu thiết bị.' using errcode = '42501';
  end if;
  if target_requests is null
    or jsonb_typeof(target_requests) <> 'array'
    or jsonb_array_length(target_requests) = 0
    or jsonb_array_length(target_requests) > 500 then
    raise exception 'Danh sách import phải có từ 1 đến 500 phiếu.' using errcode = '22023';
  end if;

  perform set_config('app.equipment_confirmation_rpc', 'true', true);
  for request_payload in select value from jsonb_array_elements(target_requests)
  loop
    source_code := coalesce(request_payload ->> 'source_code', '');
    begin
      if jsonb_typeof(request_payload -> 'items') <> 'array'
        or jsonb_array_length(request_payload -> 'items') = 0 then
        raise exception 'Phiếu % chưa có danh sách thiết bị.', source_code using errcode = '22023';
      end if;
      if not exists (
        select 1
        from public.profiles as profiles
        where profiles.id = (request_payload ->> 'registrant_id')::uuid
          and profiles.is_active
      ) then
        raise exception 'Người đăng ký của phiếu % không hợp lệ.', source_code using errcode = '22023';
      end if;

      select schedules.semester into target_sched_semester
      from public.class_schedules as schedules
      join public.rooms as rooms on rooms.id = schedules.room_id
      where schedules.id = (request_payload ->> 'class_schedule_id')::uuid
        and schedules.schedule_status <> 'cancelled'
        and rooms.room_type_id = '40000000-0000-0000-0000-000000000001'::uuid;

      if not found then
        raise exception 'Lớp Skills lab của phiếu % không hợp lệ.', source_code using errcode = '22023';
      end if;

      if target_sched_semester is null or target_sched_semester not in ('HK1','HK2','HK3','HK4') then
        raise exception 'Lịch học của phiếu % chưa có thông tin Học kỳ hợp lệ.', source_code using errcode = '22023';
      end if;

      derived_semester := target_sched_semester;

      if (request_payload ->> 'responsible_lecturer_id')::uuid
          <> (request_payload ->> 'registrant_id')::uuid
        and not exists (
          select 1
          from public.list_scoped_lecturers(
            '40000000-0000-0000-0000-000000000001'::uuid
          ) as lecturers
          where lecturers.id = (request_payload ->> 'responsible_lecturer_id')::uuid
        ) then
        raise exception 'Giảng viên phụ trách của phiếu % không hợp lệ.', source_code using errcode = '22023';
      end if;

      insert into public.equipment_requests (
        class_schedule_id,
        semester,
        registrant_id,
        responsible_lecturer_id,
        phone_snapshot,
        email_snapshot,
        receive_at,
        return_at,
        status,
        note,
        created_by,
        created_at,
        updated_at
      ) values (
        (request_payload ->> 'class_schedule_id')::uuid,
        derived_semester,
        (request_payload ->> 'registrant_id')::uuid,
        (request_payload ->> 'responsible_lecturer_id')::uuid,
        request_payload ->> 'phone_snapshot',
        request_payload ->> 'email_snapshot',
        (request_payload ->> 'receive_at')::timestamptz,
        (request_payload ->> 'return_at')::timestamptz,
        request_payload ->> 'status',
        nullif(request_payload ->> 'note', ''),
        actor_id,
        (request_payload ->> 'created_at')::timestamptz,
        (request_payload ->> 'created_at')::timestamptz
      ) returning id into new_request_id;

      for item_payload in
        select value from jsonb_array_elements(request_payload -> 'items')
      loop
        if not exists (
          select 1
          from public.equipment_catalog as catalog
          where catalog.id = (item_payload ->> 'catalog_item_id')::uuid
        ) then
          raise exception 'Danh mục thiết bị của phiếu % đã thay đổi.', source_code using errcode = '22023';
        end if;
        insert into public.equipment_request_items (
          request_id,
          skill_name,
          catalog_item_id,
          quantity,
          note,
          created_at
        ) values (
          new_request_id,
          item_payload ->> 'skill_name',
          (item_payload ->> 'catalog_item_id')::uuid,
          (item_payload ->> 'quantity')::integer,
          nullif(item_payload ->> 'note', ''),
          (request_payload ->> 'created_at')::timestamptz
        );
      end loop;

      results := results || jsonb_build_array(jsonb_build_object(
        'source_code', source_code,
        'ok', true,
        'request_id', new_request_id
      ));
    exception
      when unique_violation then
        results := results || jsonb_build_array(jsonb_build_object(
          'source_code', source_code,
          'ok', false,
          'message', 'Lớp hoặc mã phiếu đã có phiếu thiết bị.'
        ));
      when sqlstate '22023' then
        results := results || jsonb_build_array(jsonb_build_object(
          'source_code', source_code,
          'ok', false,
          'message', sqlerrm
        ));
      when foreign_key_violation or check_violation then
        results := results || jsonb_build_array(jsonb_build_object(
          'source_code', source_code,
          'ok', false,
          'message', 'Dữ liệu liên quan của phiếu không còn hợp lệ.'
        ));
      when others then
        results := results || jsonb_build_array(jsonb_build_object(
          'source_code', source_code,
          'ok', false,
          'message', 'Không thể tạo phiếu thiết bị.'
        ));
    end;
  end loop;
  return results;
end;
$$;

revoke execute on function public.import_equipment_requests(jsonb) from public, anon;
grant execute on function public.import_equipment_requests(jsonb) to authenticated;

-- Declarative mirror of 20260823110000_basic_medical_equipment_request_edit.sql.
create or replace function private.guard_equipment_request_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_schedule_date date;
  target_room_type_id uuid;
begin
  if current_setting('app.equipment_confirmation_rpc', true) = 'true' then
    return new;
  end if;
  if current_setting('app.basic_medical_equipment_edit_rpc', true) = 'true'
    and old.request_domain = 'basic_medical'
    and new.request_domain = 'basic_medical' then
    return new;
  end if;
  if old.status not in ('new', 'preparing')
    and (
      new.class_schedule_id is distinct from old.class_schedule_id
      or new.semester is distinct from old.semester
      or new.registrant_id is distinct from old.registrant_id
      or new.responsible_lecturer_id is distinct from old.responsible_lecturer_id
      or new.phone_snapshot is distinct from old.phone_snapshot
      or new.email_snapshot is distinct from old.email_snapshot
      or new.receive_at is distinct from old.receive_at
      or new.return_at is distinct from old.return_at
      or new.note is distinct from old.note
      or new.created_by is distinct from old.created_by
    ) then
    raise exception 'Chỉ có thể điều chỉnh phiếu trạng thái Mới hoặc Đã soạn.' using errcode = '42501';
  end if;
  if (select private.has_role('admin')) or (select private.has_role('staff')) then
    if new.status is distinct from old.status
      or new.handover_staff_confirmed_by is distinct from old.handover_staff_confirmed_by
      or new.handover_staff_confirmed_at is distinct from old.handover_staff_confirmed_at
      or new.handover_signature_path is distinct from old.handover_signature_path
      or new.handover_recipient_signed_at is distinct from old.handover_recipient_signed_at
      or new.handover_effective_at is distinct from old.handover_effective_at
      or new.return_staff_confirmed_by is distinct from old.return_staff_confirmed_by
      or new.return_staff_confirmed_at is distinct from old.return_staff_confirmed_at
      or new.return_signature_path is distinct from old.return_signature_path
      or new.return_recipient_signed_at is distinct from old.return_recipient_signed_at
      or new.return_effective_at is distinct from old.return_effective_at then
      raise exception 'Vui lòng dùng luồng xác nhận trạng thái phiếu.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.registrant_id is distinct from old.registrant_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.status is distinct from old.status
    or new.handover_file_url is distinct from old.handover_file_url
    or new.handover_staff_confirmed_by is distinct from old.handover_staff_confirmed_by
    or new.handover_staff_confirmed_at is distinct from old.handover_staff_confirmed_at
    or new.handover_signature_path is distinct from old.handover_signature_path
    or new.handover_recipient_signed_at is distinct from old.handover_recipient_signed_at
    or new.handover_effective_at is distinct from old.handover_effective_at
    or new.return_staff_confirmed_by is distinct from old.return_staff_confirmed_by
    or new.return_staff_confirmed_at is distinct from old.return_staff_confirmed_at
    or new.return_signature_path is distinct from old.return_signature_path
    or new.return_recipient_signed_at is distinct from old.return_recipient_signed_at
    or new.return_effective_at is distinct from old.return_effective_at
    or new.phone_snapshot is distinct from old.phone_snapshot
    or new.email_snapshot is distinct from old.email_snapshot then
    raise exception 'Người đăng ký chỉ được điều chỉnh nội dung phiếu.' using errcode = '42501';
  end if;
  select schedules.schedule_date, rooms.room_type_id
  into target_schedule_date, target_room_type_id
  from public.class_schedules as schedules
  join public.rooms as rooms on rooms.id = schedules.room_id
  where schedules.id = new.class_schedule_id
    and schedules.schedule_status <> 'cancelled';
  if target_schedule_date is null
    or target_room_type_id <> '40000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'Lớp Skills lab không hợp lệ hoặc đã bị hủy.' using errcode = '22023';
  end if;
  if (new.receive_at at time zone 'Asia/Ho_Chi_Minh')::date > target_schedule_date then
    raise exception 'Ngày nhận phải bằng hoặc trước ngày học.' using errcode = '22023';
  end if;
  if new.responsible_lecturer_id <> new.registrant_id
    and not exists (
      select 1 from public.list_scoped_lecturers(target_room_type_id) as lecturers
      where lecturers.id = new.responsible_lecturer_id
    ) then
    raise exception 'Giảng viên phụ trách không hợp lệ.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.update_basic_medical_equipment_request_content(
  target_request_id uuid,
  target_receive_at timestamptz,
  target_return_at timestamptz,
  target_note text,
  target_late_registration_reason text,
  target_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  request_row record;
  source_row record;
  updated_request_id uuid;
  receive_local timestamp;
  return_local timestamp;
begin
  if actor_id is null or not (select private.is_active_user()) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  select requests.* into request_row
  from public.equipment_requests as requests
  where requests.id = target_request_id
    and requests.request_domain = 'basic_medical'
  for update;
  if request_row.id is null then
    raise exception 'BASIC_MEDICAL_EQUIPMENT_EDIT_FORBIDDEN' using errcode = '42501';
  end if;
  if request_row.status not in ('new', 'preparing') then
    raise exception 'BASIC_MEDICAL_EQUIPMENT_EDIT_STATUS' using errcode = '22023';
  end if;
  if request_row.registrant_id <> actor_id
    and not (select private.can_manage_basic_medical()) then
    raise exception 'BASIC_MEDICAL_EQUIPMENT_EDIT_FORBIDDEN' using errcode = '42501';
  end if;

  select sessions.id as session_id,
         sessions.class_schedule_id,
         sessions.lesson_title,
         sessions.teaching_lecturer_id,
         sessions.cancelled_at as session_cancelled_at,
         registrations.cancelled_at as registration_cancelled_at,
         registrations.semester as registration_semester,
         schedules.schedule_date,
         schedules.schedule_status
  into source_row
  from public.basic_medical_registration_sessions as sessions
  join public.basic_medical_registrations as registrations
    on registrations.id = sessions.registration_id
  join public.class_schedules as schedules
    on schedules.id = sessions.class_schedule_id
  where sessions.id = request_row.source_identity_id
  for update of sessions, schedules;
  if source_row.session_id is null
    or source_row.session_cancelled_at is not null
    or source_row.registration_cancelled_at is not null
    or source_row.schedule_status = 'cancelled' then
    raise exception 'BASIC_MEDICAL_SESSION_CANCELLED' using errcode = '22023';
  end if;
  if request_row.class_schedule_id is distinct from source_row.class_schedule_id then
    raise exception 'EQUIPMENT_REQUEST_LIVE_SOURCE_IMMUTABLE' using errcode = '22023';
  end if;
  if source_row.registration_semester not in ('HK1', 'HK2', 'HK3', 'HK4') then
    raise exception 'EQUIPMENT_REQUEST_SEMESTER_REQUIRED' using errcode = '22023';
  end if;

  if target_items is null
    or jsonb_typeof(target_items) <> 'array'
    or jsonb_array_length(target_items) not between 1 and 500 then
    raise exception 'EQUIPMENT_REQUEST_ITEMS_REQUIRED' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(target_items) as item(
      catalog_item_id uuid, quantity integer, note text
    )
    left join public.basic_medical_equipment_catalog as catalog
      on catalog.id = item.catalog_item_id
    where item.catalog_item_id is null
      or item.quantity is null or item.quantity < 1 or item.quantity > 100000
      or length(coalesce(item.note, '')) > 1000
      or catalog.id is null or not catalog.is_active
  ) then
    raise exception 'EQUIPMENT_REQUEST_BASIC_MEDICAL_CATALOG_REQUIRED' using errcode = '22023';
  end if;

  receive_local := target_receive_at at time zone 'Asia/Ho_Chi_Minh';
  return_local := target_return_at at time zone 'Asia/Ho_Chi_Minh';
  if target_receive_at is null or target_return_at is null
    or target_return_at < target_receive_at
    or receive_local::date < (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date
    or receive_local::date > source_row.schedule_date
    or return_local::date < source_row.schedule_date
    or receive_local::time not in (time '09:00', time '11:00', time '14:00', time '16:00')
    or return_local::time not in (time '09:00', time '11:00', time '14:00', time '16:00') then
    raise exception 'BASIC_MEDICAL_EQUIPMENT_TIMING_INVALID' using errcode = '22023';
  end if;

  perform set_config('app.basic_medical_equipment_edit_rpc', 'true', true);

  update public.equipment_requests
  set responsible_lecturer_id = source_row.teaching_lecturer_id,
      semester = source_row.registration_semester,
      receive_at = target_receive_at,
      return_at = target_return_at,
      note = nullif(btrim(target_note), ''),
      late_registration_reason = nullif(btrim(target_late_registration_reason), '')
  where id = target_request_id
    and request_domain = 'basic_medical'
    and status in ('new', 'preparing')
  returning id into updated_request_id;
  if updated_request_id is null then
    raise exception 'BASIC_MEDICAL_EQUIPMENT_EDIT_STATUS' using errcode = '22023';
  end if;

  delete from public.equipment_request_items where request_id = target_request_id;
  insert into public.equipment_request_items (
    request_id, skill_name, basic_medical_catalog_item_id, quantity, note
  )
  select target_request_id,
         source_row.lesson_title,
         item.catalog_item_id,
         item.quantity,
         nullif(btrim(item.note), '')
  from jsonb_to_recordset(target_items) as item(
    catalog_item_id uuid, quantity integer, note text
  );
  return updated_request_id;
end;
$$;

revoke all on function public.update_basic_medical_equipment_request_content(uuid,timestamptz,timestamptz,text,text,jsonb) from public, anon;
grant execute on function public.update_basic_medical_equipment_request_content(uuid,timestamptz,timestamptz,text,text,jsonb) to authenticated;


-- Source: supabase/schemas/04_personnel_permissions.sql
-- Fourth safe-review follow-up: personnel roles, import capability and atomic admin editing.

create or replace function private.prevent_deprecated_importer_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'importer'::public.app_role then
    raise exception 'DEPRECATED_IMPORTER_ROLE' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists user_roles_reject_deprecated_importer on public.user_roles;
create trigger user_roles_reject_deprecated_importer
before insert or update of role on public.user_roles
for each row execute function private.prevent_deprecated_importer_role();

revoke all on function private.prevent_deprecated_importer_role() from public, anon, authenticated;

create or replace function public.admin_update_personnel(
  target_profile_id uuid,
  target_email text,
  target_full_name text,
  target_phone text,
  target_title text,
  target_roles public.app_role[],
  target_can_import_schedules boolean,
  target_room_type_ids uuid[],
  target_email_room_type_ids uuid[],
  target_allow_basic_medical_access boolean,
  target_is_active boolean,
  target_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_profile public.profiles;
  normalized_email text := lower(btrim(coalesce(target_email, '')));
  normalized_name text := btrim(coalesce(target_full_name, ''));
  normalized_phone text := nullif(btrim(coalesce(target_phone, '')), '');
  normalized_title text := nullif(btrim(coalesce(target_title, '')), '');
  normalized_roles public.app_role[];
  normalized_scopes uuid[];
  normalized_email_scopes uuid[];
  active_admin_count integer;
begin
  if actor_id is null or not (select private.has_role('admin')) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select profiles.* into current_profile
  from public.profiles profiles
  where profiles.id = target_profile_id
  for update;
  if current_profile.id is null then
    raise exception 'PERSONNEL_NOT_FOUND' using errcode = 'P0002';
  end if;
  if current_profile.access_version <> target_expected_version then
    raise exception 'PERSONNEL_CHANGED_RELOAD_REQUIRED' using errcode = 'P0001';
  end if;
  if normalized_email = '' or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_PERSONNEL_EMAIL' using errcode = '22023';
  end if;
  if normalized_name = '' then
    raise exception 'INVALID_PERSONNEL_NAME' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct role_value order by role_value), '{}'::public.app_role[])
  into normalized_roles
  from unnest(coalesce(target_roles, '{}'::public.app_role[])) role_values(role_value);
  if cardinality(normalized_roles) = 0 then
    raise exception 'MAIN_ROLE_REQUIRED' using errcode = '22023';
  end if;
  if 'importer'::public.app_role = any(normalized_roles) then
    raise exception 'DEPRECATED_IMPORTER_ROLE' using errcode = '22023';
  end if;
  if 'viewer'::public.app_role = any(normalized_roles) and cardinality(normalized_roles) <> 1 then
    raise exception 'VIEWER_ROLE_MUST_BE_EXCLUSIVE' using errcode = '22023';
  end if;
  if target_can_import_schedules and not (
    'staff'::public.app_role = any(normalized_roles)
    or 'lecturer'::public.app_role = any(normalized_roles)
    or 'teaching_assistant'::public.app_role = any(normalized_roles)
  ) then
    raise exception 'IMPORT_PERMISSION_ROLE_REQUIRED' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct scope_id order by scope_id), '{}'::uuid[])
  into normalized_scopes
  from unnest(coalesce(target_room_type_ids, '{}'::uuid[])) scope_values(scope_id);
  select coalesce(array_agg(distinct scope_id order by scope_id), '{}'::uuid[])
  into normalized_email_scopes
  from unnest(coalesce(target_email_room_type_ids, '{}'::uuid[])) scope_values(scope_id);
  if cardinality(normalized_scopes) = 0 then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(normalized_scopes) requested(id)
    where not exists (select 1 from public.room_types room_types where room_types.id = requested.id and room_types.is_active)
  ) then
    raise exception 'INVALID_ROOM_TYPE_SCOPE' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(normalized_email_scopes) requested(id)
    where requested.id <> all(normalized_scopes)
  ) then
    raise exception 'EMAIL_SCOPE_MUST_BE_ASSIGNED' using errcode = '22023';
  end if;
  if cardinality(normalized_email_scopes) > 0 and not ('viewer'::public.app_role = any(normalized_roles)) then
    raise exception 'EMAIL_SCOPE_VIEWER_ONLY' using errcode = '22023';
  end if;
  if target_allow_basic_medical_access and not (
    ('lecturer'::public.app_role = any(normalized_roles) or 'teaching_assistant'::public.app_role = any(normalized_roles))
    and '40000000-0000-0000-0000-000000000002'::uuid = any(normalized_scopes)
  ) then
    raise exception 'BASIC_MEDICAL_PERMISSION_INVALID' using errcode = '22023';
  end if;

  if target_profile_id = actor_id and not target_is_active then
    raise exception 'CANNOT_LOCK_CURRENT_ADMIN' using errcode = '42501';
  end if;
  if target_profile_id = actor_id and not ('admin'::public.app_role = any(normalized_roles)) then
    raise exception 'CANNOT_REMOVE_CURRENT_ADMIN' using errcode = '42501';
  end if;
  if (not target_is_active or not ('admin'::public.app_role = any(normalized_roles)))
    and exists (select 1 from public.user_roles roles where roles.user_id = target_profile_id and roles.role = 'admin') then
    select count(*) into active_admin_count
    from public.profiles profiles
    where profiles.is_active and profiles.id <> target_profile_id
      and exists (select 1 from public.user_roles roles where roles.user_id = profiles.id and roles.role = 'admin');
    if active_admin_count = 0 then
      raise exception 'LAST_ACTIVE_ADMIN_REQUIRED' using errcode = '42501';
    end if;
  end if;
  if exists (
    select 1 from public.profiles profiles
    where profiles.id <> target_profile_id and lower(profiles.email) = normalized_email
  ) then
    raise exception 'PERSONNEL_EMAIL_EXISTS' using errcode = '23505';
  end if;
  if normalized_phone is not null and exists (
    select 1 from public.profiles profiles
    where profiles.id <> target_profile_id
      and regexp_replace(coalesce(profiles.phone, ''), '[^0-9]+', '', 'g') = regexp_replace(normalized_phone, '[^0-9]+', '', 'g')
      and regexp_replace(normalized_phone, '[^0-9]+', '', 'g') <> ''
  ) then
    raise exception 'PERSONNEL_PHONE_EXISTS' using errcode = '23505';
  end if;

  update public.profiles
  set email = normalized_email,
      full_name = normalized_name,
      phone = normalized_phone,
      title = normalized_title,
      can_import_schedules = coalesce(target_can_import_schedules, false),
      allow_basic_medical_access = coalesce(target_allow_basic_medical_access, false),
      is_active = coalesce(target_is_active, false),
      access_version = access_version + 1
  where id = target_profile_id;

  delete from public.user_roles where user_id = target_profile_id;
  insert into public.user_roles (user_id, role, created_by)
  select target_profile_id, role_value, actor_id from unnest(normalized_roles) role_values(role_value);

  delete from public.profile_room_types where profile_id = target_profile_id;
  insert into public.profile_room_types (
    profile_id, room_type_id, receive_schedule_emails, created_by
  )
  select target_profile_id, scope_id, scope_id = any(normalized_email_scopes), actor_id
  from unnest(normalized_scopes) scopes(scope_id);

  return jsonb_build_object(
    'id', target_profile_id,
    'email', normalized_email,
    'full_name', normalized_name,
    'phone', normalized_phone,
    'title', normalized_title,
    'roles', to_jsonb(normalized_roles),
    'can_import_schedules', coalesce(target_can_import_schedules, false),
    'room_type_ids', to_jsonb(normalized_scopes),
    'email_room_type_ids', to_jsonb(normalized_email_scopes),
    'allow_basic_medical_access', coalesce(target_allow_basic_medical_access, false),
    'is_active', coalesce(target_is_active, false),
    'access_version', current_profile.access_version + 1
  );
end;
$$;

revoke all on function public.admin_update_personnel(
  uuid, text, text, text, text, public.app_role[], boolean, uuid[], uuid[], boolean, boolean, integer
) from public, anon;
grant execute on function public.admin_update_personnel(
  uuid, text, text, text, text, public.app_role[], boolean, uuid[], uuid[], boolean, boolean, integer
) to authenticated;

create or replace function public.admin_list_personnel(
  target_query text default null,
  target_role text default null,
  target_import_permission text default 'all',
  target_status text default 'all',
  target_page integer default 1,
  target_page_size integer default 50
)
returns table (
  id uuid,
  email text,
  full_name text,
  phone text,
  title text,
  is_active boolean,
  can_import_schedules boolean,
  allow_basic_medical_access boolean,
  access_version integer,
  roles public.app_role[],
  room_type_ids uuid[],
  email_room_type_ids uuid[],
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  started_at timestamptz := clock_timestamp();
  normalized_query text := lower(btrim(coalesce(target_query, '')));
  normalized_role text := nullif(lower(btrim(coalesce(target_role, ''))), '');
  normalized_import text := lower(btrim(coalesce(target_import_permission, 'all')));
  normalized_status text := lower(btrim(coalesce(target_status, 'all')));
  safe_page integer := greatest(coalesce(target_page, 1), 1);
  safe_page_size integer := least(greatest(coalesce(target_page_size, 50), 1), 50);
begin
  if not (select private.has_role('admin')) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if normalized_role = 'all' then normalized_role := null; end if;
  if normalized_role is not null and normalized_role not in ('admin','staff','lecturer','teaching_assistant','viewer') then
    raise exception 'INVALID_ROLE_FILTER' using errcode = '22023';
  end if;
  if normalized_import not in ('all','enabled','disabled') or normalized_status not in ('all','active','inactive') then
    raise exception 'INVALID_PERSONNEL_FILTER' using errcode = '22023';
  end if;

  return query
  with filtered as (
    select profiles.*
    from public.profiles profiles
    where exists (
      select 1 from public.user_roles any_role
      where any_role.user_id = profiles.id and any_role.role <> 'importer'
    )
      and (
        normalized_query = ''
        or lower(extensions.unaccent(profiles.full_name)) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(profiles.email) like '%' || normalized_query || '%'
        or lower(coalesce(profiles.phone, '')) like '%' || normalized_query || '%'
        or lower(extensions.unaccent(coalesce(profiles.title, ''))) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
      )
      and (normalized_role is null or exists (
        select 1 from public.user_roles role_filter
        where role_filter.user_id = profiles.id and role_filter.role::text = normalized_role
      ))
      and (normalized_import = 'all'
        or (normalized_import = 'enabled' and profiles.can_import_schedules)
        or (normalized_import = 'disabled' and not profiles.can_import_schedules))
      and (normalized_status = 'all'
        or (normalized_status = 'active' and profiles.is_active)
        or (normalized_status = 'inactive' and not profiles.is_active))
  ), paged as (
    select filtered.*, count(*) over() as filtered_count
    from filtered
    order by filtered.full_name, filtered.id
    limit safe_page_size offset (safe_page - 1) * safe_page_size
  )
  select paged.id, paged.email, paged.full_name, paged.phone, paged.title,
    paged.is_active, paged.can_import_schedules,
    paged.allow_basic_medical_access, paged.access_version,
    coalesce((select array_agg(user_roles.role order by user_roles.role) from public.user_roles where user_roles.user_id = paged.id and user_roles.role <> 'importer'), '{}'::public.app_role[]),
    coalesce((select array_agg(scopes.room_type_id order by scopes.room_type_id) from public.profile_room_types scopes where scopes.profile_id = paged.id), '{}'::uuid[]),
    coalesce((select array_agg(scopes.room_type_id order by scopes.room_type_id) from public.profile_room_types scopes where scopes.profile_id = paged.id and scopes.receive_schedule_emails), '{}'::uuid[]),
    paged.filtered_count
  from paged;

  raise log 'personnel.list.total_ms=%', extract(milliseconds from clock_timestamp() - started_at)::integer;
end;
$$;

revoke all on function public.admin_list_personnel(text,text,text,text,integer,integer) from public, anon;
grant execute on function public.admin_list_personnel(text,text,text,text,integer,integer) to authenticated;


-- Source: supabase/schemas/05_personnel_authority.sql
create table if not exists public.system_security_principals (
  singleton boolean primary key default true check (singleton),
  root_admin_id uuid not null unique references public.profiles(id) on delete restrict,
  personnel_manager_id uuid not null unique references public.profiles(id) on delete restrict,
  configured_at timestamptz not null default now(),
  configured_by uuid references public.profiles(id) on delete set null,
  constraint security_principals_distinct_accounts check (root_admin_id <> personnel_manager_id)
);

alter table public.system_security_principals enable row level security;
revoke all on public.system_security_principals from public, anon, authenticated;
grant select, insert, update on public.system_security_principals to service_role;

create or replace function private.validate_security_principals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
    join public.user_roles r on r.user_id = p.id and r.role = 'admin'
    where p.id = new.root_admin_id and p.is_active
  ) then
    raise exception 'ROOT_ADMIN_MUST_BE_ACTIVE_ADMIN' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.profiles p
    join public.user_roles r on r.user_id = p.id and r.role = 'admin'
    where p.id = new.personnel_manager_id and p.is_active
  ) then
    raise exception 'PERSONNEL_MANAGER_MUST_BE_ACTIVE_ADMIN' using errcode = '23514';
  end if;
  new.configured_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists system_security_principals_validate on public.system_security_principals;
create trigger system_security_principals_validate
before insert or update on public.system_security_principals
for each row execute function private.validate_security_principals();

create or replace function private.is_root_administrator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.system_security_principals principals
    join public.profiles profiles on profiles.id = principals.root_admin_id
    join public.user_roles roles on roles.user_id = profiles.id and roles.role = 'admin'
    where principals.singleton and profiles.is_active
      and profiles.id = (select auth.uid())
  );
$$;

create or replace function private.is_secondary_personnel_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.system_security_principals principals
    join public.profiles profiles on profiles.id = principals.personnel_manager_id
    join public.user_roles roles on roles.user_id = profiles.id and roles.role = 'admin'
    where principals.singleton and profiles.is_active
      and profiles.id = (select auth.uid())
  );
$$;

create or replace function private.can_manage_personnel()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_root_administrator())
    or (select private.is_secondary_personnel_manager());
$$;

create or replace function private.is_protected_security_principal(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.system_security_principals principals
    where principals.singleton
      and target_profile_id in (principals.root_admin_id, principals.personnel_manager_id)
  );
$$;

create or replace function private.is_current_admin(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles roles
    where roles.user_id = target_profile_id and roles.role = 'admin'
  );
$$;

revoke execute on function private.validate_security_principals() from public, anon, authenticated;
revoke execute on function private.is_root_administrator() from public, anon, authenticated;
revoke execute on function private.is_secondary_personnel_manager() from public, anon, authenticated;
revoke execute on function private.can_manage_personnel() from public, anon, authenticated;
revoke execute on function private.is_protected_security_principal(uuid) from public, anon, authenticated;
revoke execute on function private.is_current_admin(uuid) from public, anon, authenticated;
grant execute on function private.is_root_administrator() to authenticated;
grant execute on function private.can_manage_personnel() to authenticated;

create or replace function private.protect_root_administrator_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.system_security_principals principals
    where principals.singleton and principals.root_admin_id = old.id
  ) and (tg_op = 'DELETE' or not new.is_active) then
    raise exception 'ROOT_ADMIN_SECURITY_IMMUTABLE' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists profiles_protect_root_administrator on public.profiles;
create trigger profiles_protect_root_administrator
before update of is_active or delete on public.profiles
for each row execute function private.protect_root_administrator_profile();

create or replace function private.protect_root_administrator_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and exists (
    select 1 from public.system_security_principals principals
    where principals.singleton and principals.root_admin_id = old.user_id
  ) and (tg_op = 'DELETE' or new.role <> 'admin' or new.user_id <> old.user_id) then
    raise exception 'ROOT_ADMIN_SECURITY_IMMUTABLE' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists user_roles_protect_root_administrator on public.user_roles;
create trigger user_roles_protect_root_administrator
before update or delete on public.user_roles
for each row execute function private.protect_root_administrator_role();

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_personnel_manager_select on public.profiles
for select to authenticated
using ((select private.can_manage_personnel()));

drop policy if exists user_roles_admin_all on public.user_roles;
create policy user_roles_personnel_manager_select on public.user_roles
for select to authenticated
using ((select private.can_manage_personnel()));

drop policy if exists profile_room_types_admin_all on public.profile_room_types;
create policy profile_room_types_personnel_manager_select on public.profile_room_types
for select to authenticated
using ((select private.can_manage_personnel()));

drop policy if exists personnel_auth_reconciliation_admin_select on public.personnel_auth_reconciliation_logs;
create policy personnel_auth_reconciliation_root_select
on public.personnel_auth_reconciliation_logs
for select to authenticated
using ((select private.is_root_administrator()));

create or replace function public.get_personnel_authority_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'configured', exists (select 1 from public.system_security_principals where singleton),
    'can_manage_personnel', (select private.can_manage_personnel()),
    'is_root_administrator', (select private.is_root_administrator()),
    'is_secondary_personnel_manager', (select private.is_secondary_personnel_manager())
  );
$$;

revoke all on function public.get_personnel_authority_context() from public, anon;
grant execute on function public.get_personnel_authority_context() to authenticated;

drop function if exists public.admin_update_personnel(
  uuid, text, text, text, text, public.app_role[], boolean, uuid[], uuid[], boolean, boolean, integer
);

create function public.admin_update_personnel(
  target_profile_id uuid,
  target_email text,
  target_full_name text,
  target_phone text,
  target_title text,
  target_roles public.app_role[],
  target_can_import_schedules boolean,
  target_room_type_ids uuid[],
  target_email_room_type_ids uuid[],
  target_allow_basic_medical_access boolean,
  target_is_active boolean,
  target_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_is_root boolean;
  current_profile public.profiles%rowtype;
  target_was_admin boolean;
  normalized_email text := lower(btrim(coalesce(target_email, '')));
  normalized_name text := btrim(coalesce(target_full_name, ''));
  normalized_phone text := nullif(btrim(coalesce(target_phone, '')), '');
  normalized_title text := nullif(btrim(coalesce(target_title, '')), '');
  normalized_roles public.app_role[];
  normalized_scopes uuid[];
  normalized_email_scopes uuid[];
  old_roles public.app_role[];
begin
  if not exists (select 1 from public.system_security_principals where singleton for share) then
    raise exception 'PERSONNEL_SECURITY_NOT_CONFIGURED' using errcode = '42501';
  end if;
  if not (select private.can_manage_personnel()) then
    raise exception 'PERSONNEL_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  if target_expected_version is null or target_expected_version < 1 then
    raise exception 'INVALID_PERSONNEL_VERSION' using errcode = '22023';
  end if;
  if target_is_active is null or target_can_import_schedules is null
    or target_allow_basic_medical_access is null then
    raise exception 'PERSONNEL_BOOLEAN_REQUIRED' using errcode = '22023';
  end if;

  select * into current_profile from public.profiles
  where id = target_profile_id for update;
  if current_profile.id is null then
    raise exception 'PERSONNEL_NOT_FOUND' using errcode = 'P0002';
  end if;
  if current_profile.access_version <> target_expected_version then
    raise exception 'PERSONNEL_CHANGED_RELOAD_REQUIRED' using errcode = 'P0001';
  end if;

  actor_is_root := (select private.is_root_administrator());
  target_was_admin := (select private.is_current_admin(target_profile_id));
  if target_profile_id = actor_id then
    raise exception 'CANNOT_MANAGE_OWN_SECURITY' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.system_security_principals principals
    where principals.singleton and principals.root_admin_id = target_profile_id
  ) then
    raise exception 'ROOT_ADMIN_SECURITY_IMMUTABLE' using errcode = '42501';
  end if;
  if target_was_admin and not actor_is_root then
    raise exception 'ROOT_ADMIN_REQUIRED_FOR_ADMIN_ACCOUNT' using errcode = '42501';
  end if;
  if normalized_email = '' or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_PERSONNEL_EMAIL' using errcode = '22023';
  end if;
  if normalized_name = '' then
    raise exception 'INVALID_PERSONNEL_NAME' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct role_value order by role_value), '{}'::public.app_role[])
  into normalized_roles from unnest(coalesce(target_roles, '{}'::public.app_role[])) values_(role_value);
  if cardinality(normalized_roles) = 0 then
    raise exception 'MAIN_ROLE_REQUIRED' using errcode = '22023';
  end if;
  if 'importer'::public.app_role = any(normalized_roles) then
    raise exception 'DEPRECATED_IMPORTER_ROLE' using errcode = '22023';
  end if;
  if 'viewer'::public.app_role = any(normalized_roles) and cardinality(normalized_roles) <> 1 then
    raise exception 'VIEWER_ROLE_MUST_BE_EXCLUSIVE' using errcode = '22023';
  end if;
  if target_can_import_schedules and not (
    'staff'::public.app_role = any(normalized_roles)
    or 'lecturer'::public.app_role = any(normalized_roles)
    or 'teaching_assistant'::public.app_role = any(normalized_roles)
  ) then
    raise exception 'IMPORT_PERMISSION_ROLE_REQUIRED' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct scope_id order by scope_id), '{}'::uuid[])
  into normalized_scopes from unnest(coalesce(target_room_type_ids, '{}'::uuid[])) values_(scope_id);
  select coalesce(array_agg(distinct scope_id order by scope_id), '{}'::uuid[])
  into normalized_email_scopes from unnest(coalesce(target_email_room_type_ids, '{}'::uuid[])) values_(scope_id);
  if cardinality(normalized_scopes) = 0 then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(normalized_scopes) requested(id)
    where not exists (select 1 from public.room_types room_types where room_types.id = requested.id and room_types.is_active)
  ) then
    raise exception 'INVALID_ROOM_TYPE_SCOPE' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(normalized_email_scopes) requested(id) where requested.id <> all(normalized_scopes)) then
    raise exception 'EMAIL_SCOPE_MUST_BE_ASSIGNED' using errcode = '22023';
  end if;
  if cardinality(normalized_email_scopes) > 0 and not ('viewer'::public.app_role = any(normalized_roles)) then
    raise exception 'EMAIL_SCOPE_VIEWER_ONLY' using errcode = '22023';
  end if;
  if target_allow_basic_medical_access and not (
    ('lecturer'::public.app_role = any(normalized_roles) or 'teaching_assistant'::public.app_role = any(normalized_roles))
    and '40000000-0000-0000-0000-000000000002'::uuid = any(normalized_scopes)
  ) then
    raise exception 'BASIC_MEDICAL_PERMISSION_INVALID' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles p where p.id <> target_profile_id and lower(p.email) = normalized_email) then
    raise exception 'PERSONNEL_EMAIL_EXISTS' using errcode = '23505';
  end if;
  if normalized_phone is not null and exists (
    select 1 from public.profiles p where p.id <> target_profile_id
      and regexp_replace(coalesce(p.phone, ''), '[^0-9]+', '', 'g') = regexp_replace(normalized_phone, '[^0-9]+', '', 'g')
      and regexp_replace(normalized_phone, '[^0-9]+', '', 'g') <> ''
  ) then
    raise exception 'PERSONNEL_PHONE_EXISTS' using errcode = '23505';
  end if;

  select coalesce(array_agg(role order by role), '{}'::public.app_role[])
  into old_roles from public.user_roles where user_id = target_profile_id;

  update public.profiles set
    email = normalized_email, full_name = normalized_name, phone = normalized_phone,
    title = normalized_title, can_import_schedules = target_can_import_schedules,
    allow_basic_medical_access = target_allow_basic_medical_access,
    is_active = target_is_active, access_version = access_version + 1
  where id = target_profile_id;

  delete from public.user_roles where user_id = target_profile_id;
  insert into public.user_roles (user_id, role, created_by)
  select target_profile_id, role_value, actor_id from unnest(normalized_roles) values_(role_value);
  delete from public.profile_room_types where profile_id = target_profile_id;
  insert into public.profile_room_types (profile_id, room_type_id, receive_schedule_emails, created_by)
  select target_profile_id, scope_id, scope_id = any(normalized_email_scopes), actor_id
  from unnest(normalized_scopes) values_(scope_id);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data, metadata)
  values (
    actor_id,
    case
      when cardinality(old_roles) = 0 then 'personnel.created'
      when not target_was_admin and 'admin'::public.app_role = any(normalized_roles) then 'personnel.promoted_to_admin'
      when target_was_admin and not ('admin'::public.app_role = any(normalized_roles)) then 'personnel.admin_role_removed'
      when current_profile.is_active and not target_is_active then 'personnel.locked'
      when not current_profile.is_active and target_is_active then 'personnel.unlocked'
      else 'personnel.updated'
    end,
    'profile', target_profile_id,
    jsonb_build_object('roles', old_roles, 'is_active', current_profile.is_active, 'version', current_profile.access_version),
    jsonb_build_object('roles', normalized_roles, 'is_active', target_is_active, 'version', current_profile.access_version + 1),
    jsonb_build_object('actor_authority', case when actor_is_root then 'root_administrator' else 'personnel_manager' end)
  );

  return jsonb_build_object(
    'id', target_profile_id, 'email', normalized_email, 'full_name', normalized_name,
    'phone', normalized_phone, 'title', normalized_title, 'roles', to_jsonb(normalized_roles),
    'can_import_schedules', target_can_import_schedules, 'room_type_ids', to_jsonb(normalized_scopes),
    'email_room_type_ids', to_jsonb(normalized_email_scopes),
    'allow_basic_medical_access', target_allow_basic_medical_access,
    'is_active', target_is_active, 'access_version', current_profile.access_version + 1,
    'is_root_administrator', false,
    'is_security_principal', exists (
      select 1 from public.system_security_principals p where p.singleton and p.personnel_manager_id = target_profile_id
    ),
    'is_current_admin', 'admin'::public.app_role = any(normalized_roles),
    'can_edit_security', actor_is_root or not ('admin'::public.app_role = any(normalized_roles))
  );
end;
$$;

revoke all on function public.admin_update_personnel(
  uuid, text, text, text, text, public.app_role[], boolean, uuid[], uuid[], boolean, boolean, integer
) from public, anon;
grant execute on function public.admin_update_personnel(
  uuid, text, text, text, text, public.app_role[], boolean, uuid[], uuid[], boolean, boolean, integer
) to authenticated;

drop function if exists public.admin_list_personnel(text,text,text,text,integer,integer);

create function public.admin_list_personnel(
  target_query text default null,
  target_role text default null,
  target_import_permission text default 'all',
  target_status text default 'all',
  target_page integer default 1,
  target_page_size integer default 50
)
returns table (
  id uuid, email text, full_name text, phone text, title text, is_active boolean,
  can_import_schedules boolean, allow_basic_medical_access boolean, access_version integer,
  roles public.app_role[], room_type_ids uuid[], email_room_type_ids uuid[],
  is_root_administrator boolean, is_security_principal boolean,
  is_current_admin boolean, can_edit_security boolean, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_is_root boolean;
  normalized_query text := lower(btrim(coalesce(target_query, '')));
  normalized_role text := nullif(lower(btrim(coalesce(target_role, ''))), '');
  normalized_import text := lower(btrim(coalesce(target_import_permission, 'all')));
  normalized_status text := lower(btrim(coalesce(target_status, 'all')));
  safe_page integer := greatest(coalesce(target_page, 1), 1);
  safe_page_size integer := least(greatest(coalesce(target_page_size, 50), 1), 50);
begin
  if not exists (select 1 from public.system_security_principals where singleton) then
    raise exception 'PERSONNEL_SECURITY_NOT_CONFIGURED' using errcode = '42501';
  end if;
  if not (select private.can_manage_personnel()) then
    raise exception 'PERSONNEL_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  actor_is_root := (select private.is_root_administrator());
  if normalized_role = 'all' then normalized_role := null; end if;
  if normalized_role is not null and normalized_role not in ('admin','staff','lecturer','teaching_assistant','viewer') then
    raise exception 'INVALID_ROLE_FILTER' using errcode = '22023';
  end if;
  if normalized_import not in ('all','enabled','disabled') or normalized_status not in ('all','active','inactive') then
    raise exception 'INVALID_PERSONNEL_FILTER' using errcode = '22023';
  end if;

  return query
  with principals as (
    select root_admin_id, personnel_manager_id from public.system_security_principals where singleton
  ), filtered as (
    select profiles.* from public.profiles profiles
    where exists (select 1 from public.user_roles r where r.user_id = profiles.id and r.role <> 'importer')
      and (normalized_query = ''
        or lower(extensions.unaccent(profiles.full_name)) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(profiles.email) like '%' || normalized_query || '%'
        or lower(coalesce(profiles.phone, '')) like '%' || normalized_query || '%'
        or lower(extensions.unaccent(coalesce(profiles.title, ''))) like '%' || lower(extensions.unaccent(normalized_query)) || '%')
      and (normalized_role is null or exists (
        select 1 from public.user_roles rf where rf.user_id = profiles.id and rf.role::text = normalized_role))
      and (normalized_import = 'all' or (normalized_import = 'enabled' and profiles.can_import_schedules)
        or (normalized_import = 'disabled' and not profiles.can_import_schedules))
      and (normalized_status = 'all' or (normalized_status = 'active' and profiles.is_active)
        or (normalized_status = 'inactive' and not profiles.is_active))
  ), paged as (
    select filtered.*, count(*) over() as filtered_count from filtered
    order by filtered.full_name, filtered.id
    limit safe_page_size offset (safe_page - 1) * safe_page_size
  )
  select paged.id, paged.email, paged.full_name, paged.phone, paged.title,
    paged.is_active, paged.can_import_schedules, paged.allow_basic_medical_access,
    paged.access_version,
    coalesce((select array_agg(r.role order by r.role) from public.user_roles r where r.user_id = paged.id and r.role <> 'importer'), '{}'::public.app_role[]),
    coalesce((select array_agg(s.room_type_id order by s.room_type_id) from public.profile_room_types s where s.profile_id = paged.id), '{}'::uuid[]),
    coalesce((select array_agg(s.room_type_id order by s.room_type_id) from public.profile_room_types s where s.profile_id = paged.id and s.receive_schedule_emails), '{}'::uuid[]),
    paged.id = principals.root_admin_id,
    paged.id in (principals.root_admin_id, principals.personnel_manager_id),
    exists (select 1 from public.user_roles ar where ar.user_id = paged.id and ar.role = 'admin'),
    paged.id <> (select auth.uid())
      and paged.id <> principals.root_admin_id
      and (actor_is_root or not exists (select 1 from public.user_roles ar where ar.user_id = paged.id and ar.role = 'admin')),
    paged.filtered_count
  from paged cross join principals;
end;
$$;

revoke all on function public.admin_list_personnel(text,text,text,text,integer,integer) from public, anon;
grant execute on function public.admin_list_personnel(text,text,text,text,integer,integer) to authenticated;

create or replace function public.admin_apply_personnel_import(
  target_mode text,
  target_rows jsonb,
  target_file_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_is_root boolean;
  item jsonb;
  import_profile_id uuid;
  current_profile public.profiles%rowtype;
  normalized_roles public.app_role[];
  normalized_scopes uuid[];
  normalized_email_scopes uuid[];
  normalized_email text;
  normalized_name text;
  normalized_phone text;
  normalized_title text;
  requested_import boolean;
  requested_basic boolean;
  requested_active boolean;
  expected_version integer;
  applied_ids uuid[] := '{}'::uuid[];
  created_count integer := 0;
  updated_count integer := 0;
  locked_count integer := 0;
  skipped_count integer := 0;
begin
  if not exists (select 1 from public.system_security_principals where singleton for share) then
    raise exception 'PERSONNEL_SECURITY_NOT_CONFIGURED' using errcode = '42501';
  end if;
  if not (select private.can_manage_personnel()) then
    raise exception 'PERSONNEL_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  if target_mode not in ('new', 'all') then
    raise exception 'INVALID_PERSONNEL_IMPORT_MODE' using errcode = '22023';
  end if;
  if target_rows is null or jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) > 500 then
    raise exception 'INVALID_PERSONNEL_IMPORT_ROWS' using errcode = '22023';
  end if;
  if exists (
    select 1 from (
      select value->>'id' id_value, count(*) count_value from jsonb_array_elements(target_rows)
      group by value->>'id' having count(*) > 1
    ) duplicates
  ) then
    raise exception 'DUPLICATE_PERSONNEL_IMPORT_ID' using errcode = '22023';
  end if;
  actor_is_root := (select private.is_root_administrator());

  for item in select value from jsonb_array_elements(target_rows)
  loop
    begin
      import_profile_id := (item->>'id')::uuid;
      expected_version := (item->>'access_version')::integer;
    exception when others then
      raise exception 'INVALID_PERSONNEL_IMPORT_ID_OR_VERSION' using errcode = '22023';
    end;
    select * into current_profile from public.profiles where id = import_profile_id for update;
    if current_profile.id is null then
      raise exception 'PERSONNEL_NOT_FOUND' using errcode = 'P0002';
    end if;
    if (select private.is_protected_security_principal(import_profile_id))
      or (select private.is_current_admin(import_profile_id)) then
      skipped_count := skipped_count + 1;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
      values (actor_id, 'personnel.import_skipped_protected_account', 'profile', import_profile_id,
        jsonb_build_object('actor_authority', case when actor_is_root then 'root_administrator' else 'personnel_manager' end,
          'file_name', target_file_name));
      continue;
    end if;
    if expected_version is null or expected_version < 1 then
      raise exception 'INVALID_PERSONNEL_VERSION' using errcode = '22023';
    end if;
    if current_profile.access_version <> expected_version then
      raise exception 'PERSONNEL_CHANGED_RELOAD_REQUIRED' using errcode = 'P0001';
    end if;
    if not (item ? 'is_active') or jsonb_typeof(item->'is_active') <> 'boolean'
      or not (item ? 'can_import_schedules') or jsonb_typeof(item->'can_import_schedules') <> 'boolean'
      or not (item ? 'allow_basic_medical_access') or jsonb_typeof(item->'allow_basic_medical_access') <> 'boolean' then
      raise exception 'PERSONNEL_BOOLEAN_REQUIRED' using errcode = '22023';
    end if;
    normalized_email := lower(btrim(coalesce(item->>'email', '')));
    normalized_name := btrim(coalesce(item->>'full_name', ''));
    normalized_phone := nullif(btrim(coalesce(item->>'phone', '')), '');
    normalized_title := nullif(btrim(coalesce(item->>'title', '')), '');
    requested_import := (item->>'can_import_schedules')::boolean;
    requested_basic := (item->>'allow_basic_medical_access')::boolean;
    requested_active := (item->>'is_active')::boolean;
    if normalized_email = '' or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or normalized_name = '' then
      raise exception 'INVALID_PERSONNEL_IMPORT_IDENTITY' using errcode = '22023';
    end if;
    begin
      select coalesce(array_agg(distinct value::public.app_role order by value::public.app_role), '{}'::public.app_role[])
      into normalized_roles from jsonb_array_elements_text(coalesce(item->'roles', '[]'::jsonb));
      select coalesce(array_agg(distinct value::uuid order by value::uuid), '{}'::uuid[])
      into normalized_scopes from jsonb_array_elements_text(coalesce(item->'room_type_ids', '[]'::jsonb));
      select coalesce(array_agg(distinct value::uuid order by value::uuid), '{}'::uuid[])
      into normalized_email_scopes from jsonb_array_elements_text(coalesce(item->'email_room_type_ids', '[]'::jsonb));
    exception when others then
      raise exception 'INVALID_PERSONNEL_IMPORT_ROLE_OR_SCOPE' using errcode = '22023';
    end;
    if cardinality(normalized_roles) = 0 or cardinality(normalized_scopes) = 0 then
      raise exception 'PERSONNEL_IMPORT_ROLE_SCOPE_REQUIRED' using errcode = '22023';
    end if;
    if 'importer'::public.app_role = any(normalized_roles)
      or ('viewer'::public.app_role = any(normalized_roles) and cardinality(normalized_roles) <> 1) then
      raise exception 'INVALID_PERSONNEL_IMPORT_ROLE' using errcode = '22023';
    end if;
    if requested_import and not (
      'staff'::public.app_role = any(normalized_roles) or 'lecturer'::public.app_role = any(normalized_roles)
      or 'teaching_assistant'::public.app_role = any(normalized_roles)
    ) then
      raise exception 'IMPORT_PERMISSION_ROLE_REQUIRED' using errcode = '22023';
    end if;
    if exists (
      select 1 from unnest(normalized_scopes) requested(id)
      where not exists (select 1 from public.room_types rt where rt.id = requested.id and rt.is_active)
    ) then
      raise exception 'INVALID_ROOM_TYPE_SCOPE' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(normalized_email_scopes) requested(id) where requested.id <> all(normalized_scopes))
      or (cardinality(normalized_email_scopes) > 0 and not ('viewer'::public.app_role = any(normalized_roles))) then
      raise exception 'INVALID_PERSONNEL_EMAIL_SCOPE' using errcode = '22023';
    end if;
    if requested_basic and not (
      ('lecturer'::public.app_role = any(normalized_roles) or 'teaching_assistant'::public.app_role = any(normalized_roles))
      and '40000000-0000-0000-0000-000000000002'::uuid = any(normalized_scopes)
    ) then
      raise exception 'BASIC_MEDICAL_PERMISSION_INVALID' using errcode = '22023';
    end if;
    if exists (select 1 from public.profiles p where p.id <> import_profile_id and lower(p.email) = normalized_email) then
      raise exception 'PERSONNEL_EMAIL_EXISTS' using errcode = '23505';
    end if;
    if normalized_phone is not null and exists (
      select 1 from public.profiles p where p.id <> import_profile_id
      and regexp_replace(coalesce(p.phone, ''), '[^0-9]+', '', 'g') = regexp_replace(normalized_phone, '[^0-9]+', '', 'g')
      and regexp_replace(normalized_phone, '[^0-9]+', '', 'g') <> ''
    ) then
      raise exception 'PERSONNEL_PHONE_EXISTS' using errcode = '23505';
    end if;

    update public.profiles set email = normalized_email, full_name = normalized_name,
      phone = normalized_phone, title = normalized_title, is_active = requested_active,
      can_import_schedules = requested_import, allow_basic_medical_access = requested_basic,
      access_version = access_version + 1 where id = import_profile_id;
    delete from public.user_roles where user_id = import_profile_id;
    insert into public.user_roles (user_id, role, created_by)
    select import_profile_id, value, actor_id from unnest(normalized_roles) roles(value);
    delete from public.profile_room_types scopes_existing where scopes_existing.profile_id = import_profile_id;
    insert into public.profile_room_types (profile_id, room_type_id, receive_schedule_emails, created_by)
    select import_profile_id, value, value = any(normalized_email_scopes), actor_id from unnest(normalized_scopes) scopes(value);
    applied_ids := array_append(applied_ids, import_profile_id);
    if coalesce((item->>'is_new')::boolean, false) then created_count := created_count + 1;
    else updated_count := updated_count + 1; end if;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (actor_id, 'personnel.import_applied', 'profile', import_profile_id,
      jsonb_build_object('actor_authority', case when actor_is_root then 'root_administrator' else 'personnel_manager' end,
        'old_version', current_profile.access_version, 'new_version', current_profile.access_version + 1,
        'file_name', target_file_name));
  end loop;

  if target_mode = 'all' then
    for current_profile in
      select p.* from public.profiles p
      where not (p.id = any(applied_ids))
        and not (select private.is_protected_security_principal(p.id))
        and not (select private.is_current_admin(p.id))
      for update
    loop
      if current_profile.is_active or current_profile.can_import_schedules or current_profile.allow_basic_medical_access then
        update public.profiles set is_active = false, can_import_schedules = false,
          allow_basic_medical_access = false, access_version = access_version + 1
        where id = current_profile.id;
        locked_count := locked_count + 1;
        insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
        values (actor_id, 'personnel.locked', 'profile', current_profile.id,
          jsonb_build_object('actor_authority', case when actor_is_root then 'root_administrator' else 'personnel_manager' end,
            'source', 'personnel_import', 'file_name', target_file_name,
            'old_version', current_profile.access_version, 'new_version', current_profile.access_version + 1));
      end if;
    end loop;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (actor_id, 'personnel.import_applied', 'personnel_import',
    jsonb_build_object('actor_authority', case when actor_is_root then 'root_administrator' else 'personnel_manager' end,
      'mode', target_mode, 'file_name', target_file_name, 'created', created_count,
      'updated', updated_count, 'locked', locked_count, 'skipped_protected', skipped_count));
  return jsonb_build_object('created', created_count, 'updated', updated_count,
    'locked', locked_count, 'skipped_protected', skipped_count);
end;
$$;

revoke all on function public.admin_apply_personnel_import(text,jsonb,text) from public, anon;
grant execute on function public.admin_apply_personnel_import(text,jsonb,text) to authenticated;

create or replace function public.find_existing_import_hashes(target_hashes text[], target_room_type_id uuid)
returns table(normalized_row_hash text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if target_hashes is null or cardinality(target_hashes) > 500 then
    raise exception 'INVALID_IMPORT_HASH_COUNT' using errcode = '22023';
  end if;
  if not (select private.can_import_schedules(target_room_type_id)) then
    raise exception 'IMPORT_PERMISSION_REQUIRED' using errcode = '42501';
  end if;
  return query
  select distinct rows.normalized_row_hash
  from public.import_rows rows
  join public.class_schedules schedules on schedules.id = rows.class_schedule_id
  join public.rooms rooms on rooms.id = schedules.room_id
  where rows.normalized_row_hash = any(target_hashes)
    and rows.validation_status in ('imported', 'warning')
    and schedules.schedule_status <> 'cancelled'
    and rooms.room_type_id = target_room_type_id;
end;
$$;

revoke all on function public.find_existing_import_hashes(text[], uuid) from public, anon;
grant execute on function public.find_existing_import_hashes(text[], uuid) to authenticated;

create or replace function public.record_import_validation_row(
  target_batch_id uuid, target_row_number integer, target_hash text,
  target_raw jsonb, target_normalized jsonb, target_status public.import_row_status,
  target_errors jsonb, target_warnings jsonb
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
  if target_status not in ('error', 'duplicate', 'conflict', 'system_error') then
    raise exception 'INVALID_IMPORT_ROW_STATUS' using errcode = '22023';
  end if;
  select batches.room_type_id into batch_room_type_id
  from public.import_batches batches
  where batches.id = target_batch_id and batches.created_by = caller_id and batches.status = 'importing';
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
    target_status, coalesce(target_errors, '[]'::jsonb), coalesce(target_warnings, '[]'::jsonb)
  ) returning id into row_id;
  return row_id;
end;
$$;

revoke all on function public.record_import_validation_row(
  uuid, integer, text, jsonb, jsonb, public.import_row_status, jsonb, jsonb
) from public, anon;
grant execute on function public.record_import_validation_row(
  uuid, integer, text, jsonb, jsonb, public.import_row_status, jsonb, jsonb
) to authenticated;


-- Source: supabase/schemas/06_sixth_followup_personnel_and_basic_medical.sql
set check_function_bodies = false;

-- Personnel email changes use a short-lived reservation so a stale writer
-- never reaches the external Auth provider.
create table public.personnel_update_operations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  expected_version integer not null check (expected_version > 0),
  requested_email text not null,
  payload jsonb not null,
  expires_at timestamptz not null default (clock_timestamp() + interval '10 minutes'),
  created_at timestamptz not null default clock_timestamp()
);
create unique index personnel_update_operations_profile_idx
  on public.personnel_update_operations(profile_id);
alter table public.personnel_update_operations enable row level security;
revoke all on public.personnel_update_operations from public, anon, authenticated;
grant select, insert, update, delete on public.personnel_update_operations to service_role;

create or replace function public.begin_personnel_update(
  target_profile_id uuid,
  target_email text,
  target_full_name text,
  target_phone text,
  target_title text,
  target_roles public.app_role[],
  target_can_import_schedules boolean,
  target_room_type_ids uuid[],
  target_email_room_type_ids uuid[],
  target_allow_basic_medical_access boolean,
  target_is_active boolean,
  target_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_profile public.profiles%rowtype;
  operation_id uuid;
  normalized_email text := lower(btrim(coalesce(target_email, '')));
begin
  if not (select private.can_manage_personnel()) then
    raise exception 'PERSONNEL_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  if target_expected_version is null or target_expected_version < 1 then
    raise exception 'INVALID_PERSONNEL_VERSION' using errcode = '22023';
  end if;
  if normalized_email = '' or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_PERSONNEL_EMAIL' using errcode = '22023';
  end if;

  select * into current_profile from public.profiles
  where id = target_profile_id for update;
  if current_profile.id is null then
    raise exception 'PERSONNEL_NOT_FOUND' using errcode = 'P0002';
  end if;
  if current_profile.access_version <> target_expected_version then
    raise exception 'PERSONNEL_CHANGED_RELOAD_REQUIRED' using errcode = 'P0001';
  end if;
  if target_profile_id = actor_id then
    raise exception 'CANNOT_MANAGE_OWN_SECURITY' using errcode = '42501';
  end if;
  if (select private.is_protected_security_principal(target_profile_id)) then
    raise exception 'ROOT_ADMIN_SECURITY_IMMUTABLE' using errcode = '42501';
  end if;
  if (select private.is_current_admin(target_profile_id))
    and not (select private.is_root_administrator()) then
    raise exception 'ROOT_ADMIN_REQUIRED_FOR_ADMIN_ACCOUNT' using errcode = '42501';
  end if;

  delete from public.personnel_update_operations
  where profile_id = target_profile_id and expires_at <= clock_timestamp();
  if exists (select 1 from public.personnel_update_operations where profile_id = target_profile_id) then
    raise exception 'PERSONNEL_UPDATE_IN_PROGRESS' using errcode = '55P03';
  end if;

  insert into public.personnel_update_operations (
    profile_id, actor_id, expected_version, requested_email, payload
  ) values (
    target_profile_id, actor_id, target_expected_version, normalized_email,
    jsonb_build_object(
      'full_name', target_full_name, 'phone', target_phone, 'title', target_title,
      'roles', to_jsonb(target_roles),
      'can_import_schedules', target_can_import_schedules,
      'room_type_ids', to_jsonb(target_room_type_ids),
      'email_room_type_ids', to_jsonb(target_email_room_type_ids),
      'allow_basic_medical_access', target_allow_basic_medical_access,
      'is_active', target_is_active
    )
  ) returning id into operation_id;

  return jsonb_build_object(
    'operation_id', operation_id,
    'profile_id', target_profile_id,
    'previous_email', current_profile.email,
    'requested_email', normalized_email,
    'expected_version', target_expected_version
  );
exception when unique_violation then
  raise exception 'PERSONNEL_UPDATE_IN_PROGRESS' using errcode = '55P03';
end;
$$;

revoke all on function public.begin_personnel_update(
  uuid,text,text,text,text,public.app_role[],boolean,uuid[],uuid[],boolean,boolean,integer
) from public, anon;
grant execute on function public.begin_personnel_update(
  uuid,text,text,text,text,public.app_role[],boolean,uuid[],uuid[],boolean,boolean,integer
) to authenticated;

create or replace function public.commit_personnel_update(target_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  operation_row public.personnel_update_operations%rowtype;
  result jsonb;
begin
  select * into operation_row from public.personnel_update_operations
  where id = target_operation_id for update;
  if operation_row.id is null or operation_row.actor_id <> actor_id then
    raise exception 'PERSONNEL_UPDATE_OPERATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if operation_row.expires_at <= clock_timestamp() then
    delete from public.personnel_update_operations where id = operation_row.id;
    raise exception 'PERSONNEL_UPDATE_OPERATION_EXPIRED' using errcode = '57014';
  end if;

  -- The uncommitted delete remains visible to competing transactions, while
  -- this transaction may call the guarded legacy RPC.
  delete from public.personnel_update_operations where id = operation_row.id;
  perform set_config('app.personnel_update_operation', operation_row.id::text, true);
  select public.admin_update_personnel(
    operation_row.profile_id,
    operation_row.requested_email,
    operation_row.payload->>'full_name',
    operation_row.payload->>'phone',
    operation_row.payload->>'title',
    array(select value::public.app_role from jsonb_array_elements_text(operation_row.payload->'roles')),
    (operation_row.payload->>'can_import_schedules')::boolean,
    array(select value::uuid from jsonb_array_elements_text(operation_row.payload->'room_type_ids')),
    array(select value::uuid from jsonb_array_elements_text(operation_row.payload->'email_room_type_ids')),
    (operation_row.payload->>'allow_basic_medical_access')::boolean,
    (operation_row.payload->>'is_active')::boolean,
    operation_row.expected_version
  ) into result;
  return result;
end;
$$;

revoke all on function public.commit_personnel_update(uuid) from public, anon;
grant execute on function public.commit_personnel_update(uuid) to authenticated;

create or replace function public.cancel_personnel_update(target_operation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare deleted_count integer;
begin
  delete from public.personnel_update_operations
  where id = target_operation_id and actor_id = (select auth.uid());
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;
revoke all on function public.cancel_personnel_update(uuid) from public, anon;
grant execute on function public.cancel_personnel_update(uuid) to authenticated;

-- Guard the existing atomic RPC against bypassing an active reservation and
-- against changing an Auth identity without the reservation flow.
do $$
declare definition text;
begin
  select pg_get_functiondef(
    'public.admin_update_personnel(uuid,text,text,text,text,public.app_role[],boolean,uuid[],uuid[],boolean,boolean,integer)'::regprocedure
  ) into definition;
  if position('PERSONNEL_EMAIL_CHANGE_REQUIRES_OPERATION' in definition) = 0 then
    definition := replace(definition,
      'if current_profile.access_version <> target_expected_version then',
      $guard$if exists (
        select 1 from public.personnel_update_operations operations
        where operations.profile_id = target_profile_id
          and operations.id::text is distinct from current_setting('app.personnel_update_operation', true)
      ) then
        raise exception 'PERSONNEL_UPDATE_IN_PROGRESS' using errcode = '55P03';
      end if;
      if lower(current_profile.email) is distinct from normalized_email
        and current_setting('app.personnel_update_operation', true) is null then
        raise exception 'PERSONNEL_EMAIL_CHANGE_REQUIRES_OPERATION' using errcode = '42501';
      end if;
      if current_profile.access_version <> target_expected_version then$guard$);
    execute definition;
  end if;
end;
$$;

-- Bulk import must not race a reserved single-person update. The import RPC
-- locks each target profile, then rejects that row before applying any change.
do $$
declare definition text;
begin
  select pg_get_functiondef(
    'public.admin_apply_personnel_import(text,jsonb,text)'::regprocedure
  ) into definition;
  if position('PERSONNEL_UPDATE_IN_PROGRESS' in definition) = 0 then
    definition := replace(definition,
      'select * into current_profile from public.profiles where id = import_profile_id for update;',
      $guard$select * into current_profile from public.profiles where id = import_profile_id for update;
    if exists (
      select 1 from public.personnel_update_operations operations
      where operations.profile_id = import_profile_id
        and operations.expires_at > clock_timestamp()
    ) then
      raise exception 'PERSONNEL_UPDATE_IN_PROGRESS' using errcode = '55P03';
    end if;$guard$);
    execute definition;
  end if;
end;
$$;

-- Basic Medical authority is centralized and scope-aware.
create or replace function private.can_manage_basic_medical()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_active_user()) and (
    (select private.has_role('admin'))
    or (
      (select private.has_role('staff'))
      and (select private.has_room_type('40000000-0000-0000-0000-000000000002'::uuid))
    )
  );
$$;
revoke all on function private.can_manage_basic_medical() from public, anon;
grant execute on function private.can_manage_basic_medical() to authenticated;

create or replace function public.get_basic_medical_authority_context()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('can_manage_basic_medical', (select private.can_manage_basic_medical()));
$$;
revoke all on function public.get_basic_medical_authority_context() from public, anon;
grant execute on function public.get_basic_medical_authority_context() to authenticated;

-- Runtime history drift: replace deprecated Importer, title-based lecturer
-- authorization, unscoped Staff checks, and cancelled-session reuse.
do $$
declare definition text;
begin
  select pg_get_functiondef(
    'public.save_basic_medical_registration(uuid,text,text,date,date,uuid,uuid,integer,uuid,text,jsonb)'::regprocedure
  ) into definition;
  definition := replace(definition,
    E'(select private.has_role(''admin''))\n      or (select private.has_role(''staff''))',
    '(select private.can_manage_basic_medical())');
  definition := replace(definition,
    E'and not (select private.has_role(''admin''))\n      and not (select private.has_role(''staff''))',
    'and not (select private.can_manage_basic_medical())');
  definition := replace(definition,
    'or (select private.has_role(''importer''))',
    'or (select private.has_role(''teaching_assistant''))');
  definition := replace(definition,
    'and lower(btrim(coalesce(profiles.title, ''''))) = ''giảng viên''',
    'and exists (select 1 from public.user_roles lecturer_roles where lecturer_roles.user_id = profiles.id and lecturer_roles.role = ''lecturer'')');
  definition := replace(definition,
    'or lower(btrim(coalesce(profiles.title, ''''))) <> ''giảng viên''',
    'or not exists (select 1 from public.user_roles lecturer_roles where lecturer_roles.user_id = profiles.id and lecturer_roles.role = ''lecturer'')');
  definition := replace(definition,
    'and schedules.lecturer_id = (target_item.value->>''teaching_lecturer_id'')::uuid',
    E'and schedules.lecturer_id = (target_item.value->>''teaching_lecturer_id'')::uuid\n          and schedules.schedule_status = ''published''');
  execute definition;
end;
$$;

create or replace function public.list_basic_medical_instructors()
returns table (id uuid, full_name text, title text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.has_room_type('40000000-0000-0000-0000-000000000002'::uuid))
    and not (select private.has_role('admin')) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  return query
  select profiles.id, profiles.full_name, profiles.title
  from public.profiles profiles
  where profiles.is_active
    and exists (select 1 from public.user_roles roles where roles.user_id = profiles.id and roles.role = 'lecturer')
    and exists (select 1 from public.profile_room_types scopes where scopes.profile_id = profiles.id and scopes.room_type_id = '40000000-0000-0000-0000-000000000002'::uuid)
  order by profiles.full_name;
end;
$$;

-- Stable, unique human-facing registration code.
create sequence if not exists public.basic_medical_registration_code_seq;
create or replace function private.next_basic_medical_registration_code()
returns text language sql volatile security definer set search_path = '' as $$
  select 'YC-' || to_char(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD')
    || '-' || lpad(nextval('public.basic_medical_registration_code_seq')::text, 6, '0');
$$;
revoke all on function private.next_basic_medical_registration_code() from public, anon;
grant execute on function private.next_basic_medical_registration_code() to authenticated, service_role;
alter table public.basic_medical_registrations add column if not exists registration_code text;
alter table public.basic_medical_registrations alter column registration_code
  set default private.next_basic_medical_registration_code();
update public.basic_medical_registrations
set registration_code = private.next_basic_medical_registration_code()
where registration_code is null;
alter table public.basic_medical_registrations alter column registration_code set not null;
create unique index if not exists basic_medical_registrations_code_key
  on public.basic_medical_registrations(registration_code);

create or replace view public.basic_medical_registration_list
with (security_invoker = true)
as
select registrations.id,
       registrations.created_at,
       registrations.start_date,
       registrations.end_date,
       registrations.academic_year,
       registrations.semester,
       registrations.student_count,
       courses.course_code,
       courses.course_name,
       rooms.room_code,
       rooms.building_code,
       rooms.room_name,
       registrants.full_name as registrant_name,
       responsible.full_name as responsible_name,
       completion.session_count,
       completion.confirmed_session_count,
       completion.is_completed,
       concat_ws(
         ' ', registrations.registration_code,
         courses.course_code, courses.course_name,
         rooms.room_code, rooms.building_code, rooms.room_name,
         registrants.full_name, responsible.full_name
       ) as search_text,
       registrations.registration_code
from public.basic_medical_registrations as registrations
join public.courses on courses.id = registrations.course_id
join public.rooms on rooms.id = registrations.room_id
join public.profiles as registrants on registrants.id = registrations.registrant_id
join public.profiles as responsible on responsible.id = registrations.responsible_lecturer_id
join public.basic_medical_registration_completion as completion
  on completion.registration_id = registrations.id;
grant select on public.basic_medical_registration_list to authenticated, service_role;

-- Scope-aware policies and no direct inventory/confirmation writes.
drop policy if exists basic_medical_equipment_catalog_select on public.basic_medical_equipment_catalog;
create policy basic_medical_equipment_catalog_select on public.basic_medical_equipment_catalog
for select to authenticated using (
  (select private.is_active_user()) and (
    (select private.can_manage_basic_medical())
    or (select private.has_room_type('40000000-0000-0000-0000-000000000002'::uuid))
  )
);
drop policy if exists basic_medical_room_inventory_select on public.basic_medical_room_inventory;
create policy basic_medical_room_inventory_select on public.basic_medical_room_inventory
for select to authenticated using (
  (select private.is_active_user()) and (
    (select private.can_manage_basic_medical())
    or (select private.has_room_type('40000000-0000-0000-0000-000000000002'::uuid))
  )
);
drop policy if exists basic_medical_registrations_select on public.basic_medical_registrations;
create policy basic_medical_registrations_select on public.basic_medical_registrations
for select to authenticated using (
  (select private.is_active_user()) and (
    (select private.can_manage_basic_medical())
    or ((select private.has_room_type('40000000-0000-0000-0000-000000000002'::uuid))
      and (created_by = (select auth.uid()) or registrant_id = (select auth.uid()) or responsible_lecturer_id = (select auth.uid())))
  )
);
drop policy if exists basic_medical_registrations_manage on public.basic_medical_registrations;
create policy basic_medical_registrations_manage on public.basic_medical_registrations
for all to authenticated
using ((select private.can_manage_basic_medical()) or created_by = (select auth.uid()))
with check (created_by = (select auth.uid()) and (
  (select private.can_manage_basic_medical())
  or (((select private.has_role('lecturer')) or (select private.has_role('teaching_assistant')))
    and (select private.has_room_type('40000000-0000-0000-0000-000000000002'::uuid))
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.allow_basic_medical_access))
));
drop policy if exists basic_medical_sessions_manage on public.basic_medical_registration_sessions;
create policy basic_medical_sessions_manage on public.basic_medical_registration_sessions
for all to authenticated
using (exists (select 1 from public.basic_medical_registrations r where r.id = registration_id and (r.created_by = (select auth.uid()) or (select private.can_manage_basic_medical()))))
with check (exists (select 1 from public.basic_medical_registrations r where r.id = registration_id and (r.created_by = (select auth.uid()) or (select private.can_manage_basic_medical()))));

drop policy if exists basic_medical_equipment_catalog_manage on public.basic_medical_equipment_catalog;
create policy basic_medical_equipment_catalog_manage on public.basic_medical_equipment_catalog
for all to authenticated using ((select private.can_manage_basic_medical()))
with check ((select private.can_manage_basic_medical()));
drop policy if exists basic_medical_room_inventory_manage on public.basic_medical_room_inventory;
drop policy if exists basic_medical_condition_logs_manager_select on public.basic_medical_equipment_condition_logs;
create policy basic_medical_condition_logs_manager_select on public.basic_medical_equipment_condition_logs
for select to authenticated using ((select private.can_manage_basic_medical()));

revoke insert, update, delete on public.basic_medical_room_inventory from authenticated;
revoke insert, update, delete on public.basic_medical_session_confirmations from authenticated;
revoke insert, update, delete on public.basic_medical_session_equipment_checks from authenticated;
revoke insert, update, delete on public.basic_medical_equipment_condition_logs from authenticated;

drop policy if exists basic_medical_session_confirmations_select on public.basic_medical_session_confirmations;
create policy basic_medical_session_confirmations_select on public.basic_medical_session_confirmations
for select to authenticated using (
  signer_id = (select auth.uid())
  or (select private.can_manage_basic_medical())
  or exists (
    select 1 from public.basic_medical_registrations registrations
    where registrations.id = registration_id_snapshot
      and (registrations.registrant_id = (select auth.uid())
        or registrations.responsible_lecturer_id = (select auth.uid()))
  )
);
revoke select on public.basic_medical_session_confirmations from authenticated;
grant select (
  id, session_id, registration_id_snapshot, class_schedule_id_snapshot,
  signer_id, schedule_date_snapshot, start_time_snapshot, end_time_snapshot,
  room_id_snapshot, teaching_lecturer_id_snapshot, signed_at,
  invalidated_at, invalidated_reason, created_at
) on public.basic_medical_session_confirmations to authenticated;

-- Patch inventory RPCs to require the centralized manager scope.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.set_basic_medical_room_inventory(uuid,uuid,uuid,integer,integer,boolean,text)'::regprocedure) into definition;
  definition := replace(definition,
    'or not ((select private.has_role(''admin'')) or (select private.has_role(''staff'')))',
    'or not (select private.can_manage_basic_medical())');
  definition := replace(definition,
    'where id = target_room_id and room_type_id = basic_medical_room_type_id',
    E'where id = target_room_id and room_type_id = basic_medical_room_type_id\n      and is_active');
  definition := replace(definition,
    'where id = target_catalog_item_id',
    E'where id = target_catalog_item_id\n      and is_active');
  execute definition;

  select pg_get_functiondef('public.adjust_basic_medical_inventory_condition(uuid,integer,integer,text)'::regprocedure) into definition;
  definition := replace(definition,
    'or not ((select private.has_role(''admin'')) or (select private.has_role(''staff'')))',
    'or not (select private.can_manage_basic_medical())');
  execute definition;
end;
$$;


-- Source: supabase/schemas/07_seventh_followup_personnel_and_basic_medical.sql
-- Declarative-schema mirror for the Seventh Follow-up. Keeping the executable
-- definitions in one reviewed SQL source prevents the migration and schema
-- snapshots from drifting while Supabase concatenates schema_paths via psql.
-- Expanded from: supabase\migrations\20260807003035_seventh_followup_personnel_and_basic_medical.sql
set check_function_bodies = false;

-- ---------------------------------------------------------------------------
-- Personnel: durable Auth/Profile update saga and principal authority
-- ---------------------------------------------------------------------------

alter table public.personnel_update_operations
  add column if not exists previous_email text,
  add column if not exists status text not null default 'reserved',
  add column if not exists auth_updated_at timestamptz,
  add column if not exists committed_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists last_error text;

update public.personnel_update_operations operations
set previous_email = profiles.email
from public.profiles profiles
where profiles.id = operations.profile_id
  and operations.previous_email is null;

alter table public.personnel_update_operations
  alter column previous_email set not null;

alter table public.personnel_update_operations
  drop constraint if exists personnel_update_operations_status_check;
alter table public.personnel_update_operations
  add constraint personnel_update_operations_status_check check (
    status in (
      'reserved', 'auth_updated', 'committed', 'rollback_required',
      'rolled_back', 'reconciliation_required', 'expired'
    )
  );

drop index if exists public.personnel_update_operations_profile_idx;
create unique index personnel_update_operations_active_profile_idx
  on public.personnel_update_operations(profile_id)
  where status in ('reserved', 'auth_updated', 'rollback_required', 'reconciliation_required');
create index personnel_update_operations_reconcile_idx
  on public.personnel_update_operations(status, expires_at)
  where status in ('auth_updated', 'rollback_required', 'reconciliation_required');

create or replace function public.begin_personnel_update(
  target_profile_id uuid,
  target_email text,
  target_full_name text,
  target_phone text,
  target_title text,
  target_roles public.app_role[],
  target_can_import_schedules boolean,
  target_room_type_ids uuid[],
  target_email_room_type_ids uuid[],
  target_allow_basic_medical_access boolean,
  target_is_active boolean,
  target_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_is_root boolean := (select private.is_root_administrator());
  current_profile public.profiles%rowtype;
  operation_id uuid;
  normalized_email text := lower(btrim(coalesce(target_email, '')));
  normalized_name text := btrim(coalesce(target_full_name, ''));
  normalized_roles public.app_role[];
  normalized_scopes uuid[];
  normalized_email_scopes uuid[];
begin
  if not (select private.can_manage_personnel()) then
    raise exception 'PERSONNEL_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  if target_expected_version is null or target_expected_version < 1 then
    raise exception 'INVALID_PERSONNEL_VERSION' using errcode = '22023';
  end if;
  if target_is_active is null or target_can_import_schedules is null
    or target_allow_basic_medical_access is null then
    raise exception 'PERSONNEL_BOOLEAN_REQUIRED' using errcode = '22023';
  end if;
  if normalized_email = '' or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_PERSONNEL_EMAIL' using errcode = '22023';
  end if;
  if normalized_name = '' then
    raise exception 'INVALID_PERSONNEL_NAME' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct value order by value), '{}'::public.app_role[])
  into normalized_roles from unnest(coalesce(target_roles, '{}'::public.app_role[])) values_(value);
  select coalesce(array_agg(distinct value order by value), '{}'::uuid[])
  into normalized_scopes from unnest(coalesce(target_room_type_ids, '{}'::uuid[])) values_(value);
  select coalesce(array_agg(distinct value order by value), '{}'::uuid[])
  into normalized_email_scopes from unnest(coalesce(target_email_room_type_ids, '{}'::uuid[])) values_(value);
  if cardinality(normalized_roles) = 0 or cardinality(normalized_scopes) = 0 then
    raise exception 'PERSONNEL_ROLE_SCOPE_REQUIRED' using errcode = '22023';
  end if;
  if 'importer'::public.app_role = any(normalized_roles)
    or ('viewer'::public.app_role = any(normalized_roles) and cardinality(normalized_roles) <> 1) then
    raise exception 'INVALID_PERSONNEL_ROLE' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(normalized_email_scopes) value where value <> all(normalized_scopes)) then
    raise exception 'EMAIL_SCOPE_MUST_BE_ASSIGNED' using errcode = '22023';
  end if;

  select * into current_profile from public.profiles
  where id = target_profile_id for update;
  if current_profile.id is null then
    raise exception 'PERSONNEL_NOT_FOUND' using errcode = 'P0002';
  end if;
  if current_profile.access_version <> target_expected_version then
    raise exception 'PERSONNEL_CHANGED_RELOAD_REQUIRED' using errcode = 'P0001';
  end if;
  if target_profile_id = actor_id then
    raise exception 'CANNOT_MANAGE_OWN_SECURITY' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.system_security_principals principals
    where principals.singleton and principals.root_admin_id = target_profile_id
  ) then
    raise exception 'ROOT_ADMIN_SECURITY_IMMUTABLE' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.system_security_principals principals
    where principals.singleton and principals.personnel_manager_id = target_profile_id
  ) and not actor_is_root then
    raise exception 'ROOT_ADMIN_REQUIRED_FOR_PERSONNEL_MANAGER' using errcode = '42501';
  end if;
  if (select private.is_current_admin(target_profile_id)) and not actor_is_root then
    raise exception 'ROOT_ADMIN_REQUIRED_FOR_ADMIN_ACCOUNT' using errcode = '42501';
  end if;

  update public.personnel_update_operations
  set status = case when status = 'reserved' then 'expired' else 'reconciliation_required' end,
      resolved_at = case when status = 'reserved' then clock_timestamp() else resolved_at end,
      last_error = coalesce(last_error, 'Operation expired before a new reservation was requested')
  where profile_id = target_profile_id
    and status in ('reserved', 'auth_updated')
    and expires_at <= clock_timestamp();

  if exists (
    select 1 from public.personnel_update_operations
    where profile_id = target_profile_id
      and status in ('auth_updated', 'rollback_required', 'reconciliation_required')
  ) then
    raise exception 'PERSONNEL_RECONCILIATION_REQUIRED' using errcode = '55P03';
  end if;
  if exists (
    select 1 from public.personnel_update_operations
    where profile_id = target_profile_id and status = 'reserved'
  ) then
    raise exception 'PERSONNEL_UPDATE_IN_PROGRESS' using errcode = '55P03';
  end if;

  insert into public.personnel_update_operations (
    profile_id, actor_id, expected_version, previous_email,
    requested_email, payload, status
  ) values (
    target_profile_id, actor_id, target_expected_version, lower(current_profile.email),
    normalized_email,
    jsonb_build_object(
      'full_name', normalized_name, 'phone', target_phone, 'title', target_title,
      'roles', to_jsonb(normalized_roles),
      'can_import_schedules', target_can_import_schedules,
      'room_type_ids', to_jsonb(normalized_scopes),
      'email_room_type_ids', to_jsonb(normalized_email_scopes),
      'allow_basic_medical_access', target_allow_basic_medical_access,
      'is_active', target_is_active
    ),
    'reserved'
  ) returning id into operation_id;

  return jsonb_build_object(
    'operation_id', operation_id,
    'profile_id', target_profile_id,
    'previous_email', lower(current_profile.email),
    'requested_email', normalized_email,
    'expected_version', target_expected_version,
    'status', 'reserved'
  );
exception when unique_violation then
  raise exception 'PERSONNEL_UPDATE_IN_PROGRESS' using errcode = '55P03';
end;
$$;

create or replace function public.mark_personnel_auth_updated(target_operation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare updated_count integer;
begin
  update public.personnel_update_operations
  set status = 'auth_updated', auth_updated_at = clock_timestamp(), last_error = null
  where id = target_operation_id
    and actor_id = (select auth.uid())
    and status = 'reserved'
    and expires_at > clock_timestamp();
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'PERSONNEL_UPDATE_OPERATION_NOT_RESERVED' using errcode = 'P0002';
  end if;
  return true;
end;
$$;
revoke all on function public.mark_personnel_auth_updated(uuid) from public, anon;
grant execute on function public.mark_personnel_auth_updated(uuid) to authenticated;

create or replace function public.commit_personnel_update(target_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  operation_row public.personnel_update_operations%rowtype;
  result jsonb;
begin
  select * into operation_row from public.personnel_update_operations
  where id = target_operation_id for update;
  if operation_row.id is null or operation_row.actor_id <> actor_id then
    raise exception 'PERSONNEL_UPDATE_OPERATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if operation_row.status <> 'auth_updated' then
    raise exception 'PERSONNEL_AUTH_UPDATE_NOT_CONFIRMED' using errcode = '55000';
  end if;
  if operation_row.expires_at <= clock_timestamp() then
    update public.personnel_update_operations
    set status = 'reconciliation_required', last_error = 'Commit attempted after expiry'
    where id = operation_row.id;
    raise exception 'PERSONNEL_UPDATE_OPERATION_EXPIRED' using errcode = '57014';
  end if;

  perform set_config('app.personnel_update_operation', operation_row.id::text, true);
  select public.admin_update_personnel(
    operation_row.profile_id, operation_row.requested_email,
    operation_row.payload->>'full_name', operation_row.payload->>'phone',
    operation_row.payload->>'title',
    array(select value::public.app_role from jsonb_array_elements_text(operation_row.payload->'roles')),
    (operation_row.payload->>'can_import_schedules')::boolean,
    array(select value::uuid from jsonb_array_elements_text(operation_row.payload->'room_type_ids')),
    array(select value::uuid from jsonb_array_elements_text(operation_row.payload->'email_room_type_ids')),
    (operation_row.payload->>'allow_basic_medical_access')::boolean,
    (operation_row.payload->>'is_active')::boolean,
    operation_row.expected_version
  ) into result;

  update public.personnel_update_operations
  set status = 'committed', committed_at = clock_timestamp(),
      resolved_at = clock_timestamp(), last_error = null
  where id = operation_row.id;
  return result;
exception when others then
  if operation_row.id is not null then
    update public.personnel_update_operations
    set status = case when requested_email = previous_email then 'expired' else 'rollback_required' end,
        last_error = sqlerrm,
        resolved_at = case when requested_email = previous_email then clock_timestamp() else null end
    where id = operation_row.id and status = 'auth_updated';
  end if;
  raise;
end;
$$;

create or replace function public.cancel_personnel_update(target_operation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare updated_count integer;
begin
  update public.personnel_update_operations
  set status = 'rolled_back', resolved_at = clock_timestamp(),
      last_error = coalesce(last_error, 'Cancelled before Auth update')
  where id = target_operation_id
    and actor_id = (select auth.uid())
    and status = 'reserved';
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.resolve_personnel_update_operation(
  target_operation_id uuid,
  target_status text,
  target_error text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare updated_count integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if target_status not in ('committed','rolled_back','reconciliation_required','expired') then
    raise exception 'INVALID_PERSONNEL_OPERATION_STATUS' using errcode = '22023';
  end if;
  update public.personnel_update_operations
  set status = target_status,
      committed_at = case when target_status = 'committed' then coalesce(committed_at, clock_timestamp()) else committed_at end,
      resolved_at = case when target_status in ('committed','rolled_back','expired') then clock_timestamp() else null end,
      last_error = target_error
  where id = target_operation_id
    and status in ('auth_updated','rollback_required','reconciliation_required');
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;
revoke all on function public.resolve_personnel_update_operation(uuid,text,text) from public, anon, authenticated;
grant execute on function public.resolve_personnel_update_operation(uuid,text,text) to service_role;

-- The legacy atomic RPC may only run inside the matching active operation when
-- it changes an Auth identity. Resolved operations never block later writers.
do $$
declare definition text;
begin
  select pg_get_functiondef(
    'public.admin_update_personnel(uuid,text,text,text,text,public.app_role[],boolean,uuid[],uuid[],boolean,boolean,integer)'::regprocedure
  ) into definition;
  definition := replace(definition,
    E'where operations.profile_id = target_profile_id\n          and operations.id::text is distinct from current_setting(''app.personnel_update_operation'', true)',
    E'where operations.profile_id = target_profile_id\n          and operations.status in (''reserved'',''auth_updated'',''rollback_required'',''reconciliation_required'')\n          and operations.id::text is distinct from current_setting(''app.personnel_update_operation'', true)');
  execute definition;
end;
$$;

-- Root may manage the designated Personnel Manager; everyone else keeps the
-- protection. Root itself always remains immutable.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.admin_apply_personnel_import(text,jsonb,text)'::regprocedure)
  into definition;
  definition := replace(definition,
    'if (select private.is_protected_security_principal(import_profile_id))\n      or (select private.is_current_admin(import_profile_id)) then',
    $replacement$if exists (
      select 1 from public.system_security_principals principals
      where principals.singleton and principals.root_admin_id = import_profile_id
    ) or (
      exists (
        select 1 from public.system_security_principals principals
        where principals.singleton and principals.personnel_manager_id = import_profile_id
      ) and not actor_is_root
    ) or ((select private.is_current_admin(import_profile_id)) and not actor_is_root) then$replacement$);
  definition := replace(definition,
    E'if target_mode = ''all'' then\n    for current_profile in',
    E'if target_mode = ''all'' and exists (\n    select 1 from public.personnel_update_operations operations\n    where operations.status in (''reserved'',''auth_updated'',''rollback_required'',''reconciliation_required'')\n      and not (operations.profile_id = any(applied_ids))\n  ) then\n    raise exception ''PERSONNEL_UPDATE_IN_PROGRESS'' using errcode = ''55P03'';\n  end if;\n\n  if target_mode = ''all'' then\n    for current_profile in');
  execute definition;
end;
$$;

-- ---------------------------------------------------------------------------
-- Basic Medical: centralized visibility, RPC-only writes and soft cancellation
-- ---------------------------------------------------------------------------

alter table public.basic_medical_registrations
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancel_reason text;
create index if not exists basic_medical_registrations_active_idx
  on public.basic_medical_registrations(created_at desc)
  where cancelled_at is null;

create or replace function private.can_view_basic_medical_registration(target_registration_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.is_active_user()) and (
    (select private.can_manage_basic_medical())
    or (
      (select private.has_room_type('40000000-0000-0000-0000-000000000002'::uuid))
      and exists (
        select 1 from public.basic_medical_registrations registrations
        where registrations.id = target_registration_id
          and (
            (select private.has_role('viewer'))
            or registrations.created_by = (select auth.uid())
            or registrations.registrant_id = (select auth.uid())
            or registrations.responsible_lecturer_id = (select auth.uid())
            or exists (
              select 1 from public.basic_medical_registration_sessions sessions
              where sessions.registration_id = registrations.id
                and sessions.teaching_lecturer_id = (select auth.uid())
            )
          )
      )
    )
  );
$$;
revoke all on function private.can_view_basic_medical_registration(uuid) from public, anon;
grant execute on function private.can_view_basic_medical_registration(uuid) to authenticated;

drop policy if exists basic_medical_registrations_select on public.basic_medical_registrations;
create policy basic_medical_registrations_select on public.basic_medical_registrations
for select to authenticated using ((select private.can_view_basic_medical_registration(id)));

drop policy if exists basic_medical_sessions_select on public.basic_medical_registration_sessions;
create policy basic_medical_sessions_select on public.basic_medical_registration_sessions
for select to authenticated using ((select private.can_view_basic_medical_registration(registration_id)));

drop policy if exists basic_medical_session_confirmations_select on public.basic_medical_session_confirmations;
create policy basic_medical_session_confirmations_select on public.basic_medical_session_confirmations
for select to authenticated using (
  (select private.can_view_basic_medical_registration(registration_id_snapshot))
);

drop policy if exists basic_medical_session_equipment_checks_select on public.basic_medical_session_equipment_checks;
create policy basic_medical_session_equipment_checks_select on public.basic_medical_session_equipment_checks
for select to authenticated using (exists (
  select 1 from public.basic_medical_session_confirmations confirmations
  where confirmations.id = confirmation_id
    and (select private.can_view_basic_medical_registration(confirmations.registration_id_snapshot))
));

drop policy if exists basic_medical_registrations_manage on public.basic_medical_registrations;
drop policy if exists basic_medical_sessions_manage on public.basic_medical_registration_sessions;
revoke insert, update, delete on public.basic_medical_registrations from authenticated;
revoke insert, update, delete on public.basic_medical_registration_sessions from authenticated;

create or replace function public.cancel_basic_medical_registration(
  target_registration_id uuid,
  target_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  target_row public.basic_medical_registrations%rowtype;
  cancelled_schedule_count integer := 0;
begin
  if not (select private.can_manage_basic_medical()) then
    raise exception 'BASIC_MEDICAL_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  select * into target_row from public.basic_medical_registrations
  where id = target_registration_id for update;
  if target_row.id is null then
    raise exception 'BASIC_MEDICAL_REGISTRATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if target_row.cancelled_at is not null then
    return jsonb_build_object('id', target_row.id, 'already_cancelled', true, 'cancelled_schedules', 0);
  end if;

  update public.class_schedules schedules
  set schedule_status = 'cancelled', cancelled_by = actor_id,
      cancelled_at = clock_timestamp(), updated_at = clock_timestamp()
  where schedules.basic_medical_registration_id = target_registration_id
    and schedules.schedule_status not in ('cancelled', 'completed')
    and schedules.schedule_date >= (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  get diagnostics cancelled_schedule_count = row_count;

  update public.basic_medical_session_confirmations confirmations
  set invalidated_at = coalesce(confirmations.invalidated_at, clock_timestamp()),
      invalidated_reason = coalesce(confirmations.invalidated_reason, 'Phiếu Y cơ sở đã được hủy.')
  where confirmations.registration_id_snapshot = target_registration_id
    and confirmations.invalidated_at is null;

  update public.basic_medical_registrations
  set cancelled_at = clock_timestamp(), cancelled_by = actor_id,
      cancel_reason = nullif(btrim(target_reason), ''), updated_at = clock_timestamp()
  where id = target_registration_id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_data, new_data, metadata)
  values (
    actor_id, 'basic_medical.registration_cancelled', 'basic_medical_registration',
    target_registration_id,
    jsonb_build_object('cancelled_at', null),
    jsonb_build_object('cancelled_at', clock_timestamp(), 'reason', nullif(btrim(target_reason), '')),
    jsonb_build_object('cancelled_schedules', cancelled_schedule_count)
  );
  return jsonb_build_object('id', target_registration_id, 'already_cancelled', false,
    'cancelled_schedules', cancelled_schedule_count);
end;
$$;
revoke all on function public.cancel_basic_medical_registration(uuid,text) from public, anon;
grant execute on function public.cancel_basic_medical_registration(uuid,text) to authenticated;

-- Reject attempts to edit a cancelled registration through the save RPC.
do $$
declare definition text;
begin
  select pg_get_functiondef(
    'public.save_basic_medical_registration(uuid,text,text,date,date,uuid,uuid,integer,uuid,text,jsonb)'::regprocedure
  ) into definition;
  definition := replace(definition,
    E'if registration_owner_id is null then\n      raise exception ''Không tìm thấy phiếu Y cơ sở.'' using errcode = ''P0002'';\n    end if;',
    E'if registration_owner_id is null then\n      raise exception ''Không tìm thấy phiếu Y cơ sở.'' using errcode = ''P0002'';\n    end if;\n    if exists (select 1 from public.basic_medical_registrations cancelled where cancelled.id = target_registration_id and cancelled.cancelled_at is not null) then\n      raise exception ''Phiếu Y cơ sở đã hủy không thể điều chỉnh.'' using errcode = ''55000'';\n    end if;');
  execute definition;
end;
$$;

create or replace view public.basic_medical_registration_completion
with (security_invoker = true)
as
select registrations.id as registration_id,
       count(sessions.id)::integer as session_count,
       count(confirmations.id)::integer as confirmed_session_count,
       (count(sessions.id) > 0 and count(sessions.id) = count(confirmations.id)) as is_completed
from public.basic_medical_registrations registrations
left join public.basic_medical_registration_sessions sessions
  on sessions.registration_id = registrations.id
left join public.basic_medical_session_confirmations confirmations
  on confirmations.session_id = sessions.id and confirmations.invalidated_at is null
where registrations.cancelled_at is null
group by registrations.id;

create or replace view public.basic_medical_registration_list
with (security_invoker = true)
as
select registrations.id, registrations.created_at, registrations.start_date,
       registrations.end_date, registrations.academic_year, registrations.semester,
       registrations.student_count, courses.course_code, courses.course_name,
       rooms.room_code, rooms.building_code, rooms.room_name,
       registrants.full_name as registrant_name,
       responsible.full_name as responsible_name,
       completion.session_count, completion.confirmed_session_count,
       completion.is_completed,
       concat_ws(' ', registrations.registration_code, courses.course_code,
         courses.course_name, rooms.room_code, rooms.building_code, rooms.room_name,
         registrants.full_name, responsible.full_name) as search_text,
       registrations.registration_code
from public.basic_medical_registrations registrations
join public.courses on courses.id = registrations.course_id
join public.rooms on rooms.id = registrations.room_id
join public.profiles registrants on registrants.id = registrations.registrant_id
join public.profiles responsible on responsible.id = registrations.responsible_lecturer_id
join public.basic_medical_registration_completion completion
  on completion.registration_id = registrations.id
where registrations.cancelled_at is null;
grant select on public.basic_medical_registration_completion,
  public.basic_medical_registration_list to authenticated, service_role;

-- Correct historical human codes by the registration creation date in the
-- application timezone while preserving the unique sequence suffix.
update public.basic_medical_registrations registrations
set registration_code = 'YC-'
  || to_char(registrations.created_at at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD')
  || '-' || split_part(registrations.registration_code, '-', 3)
where registrations.registration_code ~ '^YC-[0-9]{6}-[0-9]{6,}$'
  and split_part(registrations.registration_code, '-', 2)
    <> to_char(registrations.created_at at time zone 'Asia/Ho_Chi_Minh', 'YYMMDD');

-- ---------------------------------------------------------------------------
-- Basic Medical equipment: scoped read/search/export and atomic catalog import
-- ---------------------------------------------------------------------------

create or replace function public.search_basic_medical_catalog_candidates(
  target_query text default null,
  target_limit integer default 30
)
returns table (
  id uuid, item_name text, commercial_name text, item_type text,
  country_of_origin text, manufacturer text, model text, unit text, is_active boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare safe_limit integer := least(greatest(coalesce(target_limit, 30), 1), 50);
declare normalized_query text := lower(btrim(coalesce(target_query, '')));
begin
  if not (select private.can_manage_basic_medical()) then
    raise exception 'BASIC_MEDICAL_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  return query
  select catalog.id, catalog.item_name, catalog.commercial_name, catalog.item_type,
    catalog.country_of_origin, catalog.manufacturer, catalog.model, catalog.unit,
    catalog.is_active
  from public.basic_medical_equipment_catalog catalog
  where catalog.is_active and (
    normalized_query = ''
    or lower(extensions.unaccent(catalog.item_name)) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
    or lower(extensions.unaccent(coalesce(catalog.commercial_name, ''))) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
    or lower(coalesce(catalog.model, '')) like '%' || normalized_query || '%'
  )
  order by catalog.item_name, catalog.commercial_name nulls last
  limit safe_limit;
end;
$$;
revoke all on function public.search_basic_medical_catalog_candidates(text,integer) from public, anon;
grant execute on function public.search_basic_medical_catalog_candidates(text,integer) to authenticated;

create or replace function public.search_basic_medical_equipment(
  target_tab text,
  target_query text default null,
  target_room_id uuid default null,
  target_catalog_item_id uuid default null,
  target_event_type text default null,
  target_actor_id uuid default null,
  target_from_date date default null,
  target_to_date date default null,
  target_status text default null,
  target_page integer default 1,
  target_page_size integer default 50
)
returns table(row_data jsonb, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  normalized_query text := lower(btrim(coalesce(target_query, '')));
  safe_page integer := greatest(coalesce(target_page, 1), 1);
  safe_size integer := least(greatest(coalesce(target_page_size, 50), 1), 50);
  can_manage boolean := (select private.can_manage_basic_medical());
begin
  if not (select private.is_active_user())
    or not ((select private.has_room_type('40000000-0000-0000-0000-000000000002'::uuid)) or can_manage) then
    raise exception 'BASIC_MEDICAL_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  if target_tab not in ('inventory','rooms','damaged','logs') then
    raise exception 'INVALID_BASIC_MEDICAL_EQUIPMENT_TAB' using errcode = '22023';
  end if;
  if target_tab in ('inventory','damaged','logs') and not can_manage then
    raise exception 'BASIC_MEDICAL_MANAGER_REQUIRED' using errcode = '42501';
  end if;

  if target_tab = 'inventory' then
    return query
    select to_jsonb(catalog), count(*) over()
    from public.basic_medical_equipment_catalog catalog
    where (target_status is null or target_status = ''
      or (target_status = 'active' and catalog.is_active)
      or (target_status = 'inactive' and not catalog.is_active))
      and (normalized_query = ''
        or lower(extensions.unaccent(catalog.item_name)) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(extensions.unaccent(coalesce(catalog.commercial_name, ''))) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(extensions.unaccent(coalesce(catalog.item_type, ''))) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(coalesce(catalog.manufacturer, '')) like '%' || normalized_query || '%'
        or lower(coalesce(catalog.model, '')) like '%' || normalized_query || '%')
    order by catalog.item_name, catalog.id
    limit safe_size offset (safe_page - 1) * safe_size;
  elsif target_tab in ('rooms','damaged') then
    return query
    select jsonb_build_object(
      'id', inventory.id, 'room_id', inventory.room_id,
      'catalog_item_id', inventory.catalog_item_id,
      'total_quantity', inventory.total_quantity, 'good_quantity', inventory.good_quantity,
      'damaged_quantity', inventory.damaged_quantity, 'is_active', inventory.is_active,
      'last_damage_reported_at', inventory.last_damage_reported_at,
      'room', to_jsonb(rooms), 'catalog', to_jsonb(catalog),
      'last_damage_reporter', case when can_manage then to_jsonb(reporter) else null end
    ), count(*) over()
    from public.basic_medical_room_inventory inventory
    join public.rooms rooms on rooms.id = inventory.room_id
    join public.basic_medical_equipment_catalog catalog on catalog.id = inventory.catalog_item_id
    left join public.profiles reporter on reporter.id = inventory.last_damage_reporter_id
    where inventory.is_active
      and (target_tab <> 'damaged' or inventory.damaged_quantity > 0)
      and (target_room_id is null or inventory.room_id = target_room_id)
      and (target_catalog_item_id is null or inventory.catalog_item_id = target_catalog_item_id)
      and (normalized_query = ''
        or lower(extensions.unaccent(catalog.item_name)) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(extensions.unaccent(coalesce(catalog.commercial_name, ''))) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(rooms.room_code) like '%' || normalized_query || '%'
        or lower(rooms.building_code) like '%' || normalized_query || '%'
        or lower(extensions.unaccent(coalesce(rooms.room_name, ''))) like '%' || lower(extensions.unaccent(normalized_query)) || '%')
    order by rooms.building_code, rooms.room_code, catalog.item_name
    limit safe_size offset (safe_page - 1) * safe_size;
  else
    return query
    select jsonb_build_object(
      'id', logs.id, 'event_type', logs.event_type,
      'total_before', logs.total_before, 'good_before', logs.good_before,
      'damaged_before', logs.damaged_before, 'total_after', logs.total_after,
      'good_after', logs.good_after, 'damaged_after', logs.damaged_after,
      'quantity_delta', logs.quantity_delta, 'note', logs.note,
      'created_at', logs.created_at,
      'inventory', jsonb_build_object('room', to_jsonb(rooms), 'catalog', to_jsonb(catalog)),
      'actor', to_jsonb(actor)
    ), count(*) over()
    from public.basic_medical_equipment_condition_logs logs
    join public.basic_medical_room_inventory inventory on inventory.id = logs.inventory_id
    join public.rooms rooms on rooms.id = inventory.room_id
    join public.basic_medical_equipment_catalog catalog on catalog.id = inventory.catalog_item_id
    join public.profiles actor on actor.id = logs.actor_id
    where (target_room_id is null or inventory.room_id = target_room_id)
      and (target_catalog_item_id is null or inventory.catalog_item_id = target_catalog_item_id)
      and (target_actor_id is null or logs.actor_id = target_actor_id)
      and (target_event_type is null or target_event_type = '' or logs.event_type = target_event_type)
      and (target_from_date is null or logs.created_at >= target_from_date::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and (target_to_date is null or logs.created_at < (target_to_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and (normalized_query = ''
        or lower(extensions.unaccent(catalog.item_name)) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(rooms.room_code) like '%' || normalized_query || '%'
        or lower(extensions.unaccent(actor.full_name)) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(extensions.unaccent(coalesce(logs.note, ''))) like '%' || lower(extensions.unaccent(normalized_query)) || '%')
    order by logs.created_at desc, logs.id
    limit safe_size offset (safe_page - 1) * safe_size;
  end if;
end;
$$;
revoke all on function public.search_basic_medical_equipment(text,text,uuid,uuid,text,uuid,date,date,text,integer,integer) from public, anon;
grant execute on function public.search_basic_medical_equipment(text,text,uuid,uuid,text,uuid,date,date,text,integer,integer) to authenticated;

create or replace function public.apply_basic_medical_catalog_import(
  target_mode text,
  target_rows jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  item jsonb;
  normalized_rows jsonb := '[]'::jsonb;
  item_name_value text;
  commercial_name_value text;
  model_value text;
  unit_value text;
  fingerprint_value text;
  fingerprints text[] := '{}';
  current_id uuid;
  inserted_count integer := 0;
  updated_count integer := 0;
  inactivated_count integer := 0;
begin
  if not (select private.can_manage_basic_medical()) then
    raise exception 'BASIC_MEDICAL_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  if target_mode not in ('new','all') or target_rows is null
    or jsonb_typeof(target_rows) <> 'array'
    or jsonb_array_length(target_rows) not between 1 and 5000 then
    raise exception 'INVALID_BASIC_MEDICAL_CATALOG_IMPORT' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(target_rows)
  loop
    item_name_value := btrim(coalesce(item->>'item_name', ''));
    commercial_name_value := nullif(btrim(coalesce(item->>'commercial_name', '')), '');
    model_value := nullif(btrim(coalesce(item->>'model', '')), '');
    unit_value := btrim(coalesce(item->>'unit', ''));
    if item_name_value = '' or unit_value = '' then
      raise exception 'CATALOG_ITEM_NAME_AND_UNIT_REQUIRED' using errcode = '22023';
    end if;
    fingerprint_value := lower(item_name_value) || '|' || lower(coalesce(commercial_name_value, '')) || '|' || lower(coalesce(model_value, ''));
    if fingerprint_value = any(fingerprints) then
      raise exception 'DUPLICATE_BASIC_MEDICAL_CATALOG_IMPORT_ROW' using errcode = '22023';
    end if;
    fingerprints := array_append(fingerprints, fingerprint_value);
    normalized_rows := normalized_rows || jsonb_build_array(jsonb_build_object(
      'item_name', item_name_value, 'commercial_name', commercial_name_value,
      'item_type', nullif(btrim(coalesce(item->>'item_type', '')), ''),
      'country_of_origin', nullif(btrim(coalesce(item->>'country_of_origin', '')), ''),
      'manufacturer', nullif(btrim(coalesce(item->>'manufacturer', '')), ''),
      'model', model_value, 'unit', unit_value, 'fingerprint', fingerprint_value
    ));
  end loop;

  for item in select value from jsonb_array_elements(normalized_rows)
  loop
    select catalog.id into current_id
    from public.basic_medical_equipment_catalog catalog
    where lower(catalog.item_name) = lower(item->>'item_name')
      and lower(coalesce(catalog.commercial_name, '')) = lower(coalesce(item->>'commercial_name', ''))
      and lower(coalesce(catalog.model, '')) = lower(coalesce(item->>'model', ''))
    for update;
    if current_id is null then
      insert into public.basic_medical_equipment_catalog(
        item_name, commercial_name, item_type, country_of_origin,
        manufacturer, model, unit, is_active
      ) values (
        item->>'item_name', nullif(item->>'commercial_name',''), nullif(item->>'item_type',''),
        nullif(item->>'country_of_origin',''), nullif(item->>'manufacturer',''),
        nullif(item->>'model',''), item->>'unit', true
      );
      inserted_count := inserted_count + 1;
    elsif target_mode = 'all' then
      update public.basic_medical_equipment_catalog
      set item_name = item->>'item_name', commercial_name = nullif(item->>'commercial_name',''),
          item_type = nullif(item->>'item_type',''), country_of_origin = nullif(item->>'country_of_origin',''),
          manufacturer = nullif(item->>'manufacturer',''), model = nullif(item->>'model',''),
          unit = item->>'unit', is_active = true
      where id = current_id;
      updated_count := updated_count + 1;
    end if;
    current_id := null;
  end loop;

  if target_mode = 'all' then
    update public.basic_medical_equipment_catalog catalog
    set is_active = false
    where catalog.is_active and not (
      lower(catalog.item_name) || '|' || lower(coalesce(catalog.commercial_name, '')) || '|' || lower(coalesce(catalog.model, ''))
      = any(fingerprints)
    );
    get diagnostics inactivated_count = row_count;
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, metadata)
  values (actor_id, 'basic_medical.catalog_imported', 'basic_medical_equipment_catalog',
    jsonb_build_object('mode', target_mode, 'inserted', inserted_count,
      'updated', updated_count, 'inactivated', inactivated_count));
  return jsonb_build_object('inserted', inserted_count, 'updated', updated_count,
    'inactivated', inactivated_count,
    'processed', inserted_count + updated_count);
end;
$$;
revoke all on function public.apply_basic_medical_catalog_import(text,jsonb) from public, anon;
grant execute on function public.apply_basic_medical_catalog_import(text,jsonb) to authenticated;

create or replace function public.audit_basic_medical_equipment_export(target_row_count integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not (select private.can_manage_basic_medical()) then
    raise exception 'BASIC_MEDICAL_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, metadata)
  values ((select auth.uid()), 'basic_medical.equipment_exported', 'basic_medical_equipment',
    jsonb_build_object('row_count', greatest(coalesce(target_row_count, 0), 0)));
  return true;
end;
$$;
revoke all on function public.audit_basic_medical_equipment_export(integer) from public, anon;
grant execute on function public.audit_basic_medical_equipment_export(integer) to authenticated;

-- End expanded source: supabase\migrations\20260807003035_seventh_followup_personnel_and_basic_medical.sql


-- Source: supabase/schemas/08_eighth_followup_personnel_and_basic_medical.sql
-- Declarative-schema mirror for the Eighth Follow-up.
-- Expanded from: supabase\migrations\20260807120000_eighth_followup_personnel_and_basic_medical.sql
set check_function_bodies = false;

-- Expired reservations may already have updated Auth before the application
-- persisted the marker. Keep them active until the service reconciler compares
-- Auth and profile state.
drop index if exists public.personnel_update_operations_reconcile_idx;
create index personnel_update_operations_reconcile_idx
  on public.personnel_update_operations(status, expires_at)
  where status in ('reserved', 'auth_updated', 'rollback_required', 'reconciliation_required');

do $$
declare
  definition text;
begin
  select pg_get_functiondef(
    'public.begin_personnel_update(uuid,text,text,text,text,public.app_role[],boolean,uuid[],uuid[],boolean,boolean,integer)'::regprocedure
  ) into definition;
  definition := replace(
    definition,
    E'  update public.personnel_update_operations\n  set status = case when status = ''reserved'' then ''expired'' else ''reconciliation_required'' end,\n      resolved_at = case when status = ''reserved'' then clock_timestamp() else resolved_at end,\n      last_error = coalesce(last_error, ''Operation expired before a new reservation was requested'')\n  where profile_id = target_profile_id\n    and status in (''reserved'', ''auth_updated'')\n    and expires_at <= clock_timestamp();',
    E'  update public.personnel_update_operations\n  set status = ''reconciliation_required'',\n      last_error = coalesce(last_error, ''Operation expired and requires Auth/Profile reconciliation'')\n  where profile_id = target_profile_id\n    and status = ''auth_updated''\n    and expires_at <= clock_timestamp();'
  );
  execute definition;
end;
$$;

create or replace function public.resolve_personnel_update_operation(
  target_operation_id uuid,
  target_status text,
  target_error text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare updated_count integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if target_status not in ('committed','rolled_back','reconciliation_required','expired') then
    raise exception 'INVALID_PERSONNEL_OPERATION_STATUS' using errcode = '22023';
  end if;
  update public.personnel_update_operations
  set status = target_status,
      committed_at = case when target_status = 'committed' then coalesce(committed_at, clock_timestamp()) else committed_at end,
      resolved_at = case when target_status in ('committed','rolled_back','expired') then clock_timestamp() else null end,
      last_error = target_error
  where id = target_operation_id
    and status in ('reserved','auth_updated','rollback_required','reconciliation_required');
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;
revoke all on function public.resolve_personnel_update_operation(uuid,text,text) from public, anon, authenticated;
grant execute on function public.resolve_personnel_update_operation(uuid,text,text) to service_role;

-- Only the registration RPCs may mutate linked class schedules. This prevents
-- generic schedule policies from bypassing the registration aggregate.
create or replace function private.guard_basic_medical_linked_schedule_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.basic_medical_registration_id is not null
    and current_setting('app.basic_medical_registration_mutation', true) is distinct from 'true' then
    raise exception 'BASIC_MEDICAL_SCHEDULE_RPC_REQUIRED' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.guard_basic_medical_linked_schedule_mutation() from public, anon, authenticated;

drop trigger if exists guard_basic_medical_linked_schedule_mutation on public.class_schedules;
create trigger guard_basic_medical_linked_schedule_mutation
before update or delete on public.class_schedules
for each row execute function private.guard_basic_medical_linked_schedule_mutation();

-- Recreate the save function with the transaction-local guard enabled before
-- it replaces linked schedules.
do $$
declare definition text;
begin
  select pg_get_functiondef(
    'public.save_basic_medical_registration(uuid,text,text,date,date,uuid,uuid,integer,uuid,text,jsonb)'::regprocedure
  ) into definition;
  definition := replace(
    definition,
    E'begin\n  if not (select private.can_manage_basic_medical()) then',
    E'begin\n  perform set_config(''app.basic_medical_registration_mutation'', ''true'', true);\n  if not (select private.can_manage_basic_medical()) then'
  );
  execute definition;
end;
$$;

create or replace function public.cancel_basic_medical_registration(
  target_registration_id uuid,
  target_reason text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  target_row public.basic_medical_registrations%rowtype;
  cancelled_schedule_count integer := 0;
begin
  if not (select private.can_manage_basic_medical()) then
    raise exception 'BASIC_MEDICAL_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  select * into target_row from public.basic_medical_registrations
  where id = target_registration_id for update;
  if target_row.id is null then
    raise exception 'BASIC_MEDICAL_REGISTRATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if target_row.cancelled_at is not null then
    return jsonb_build_object('id', target_row.id, 'already_cancelled', true, 'cancelled_schedules', 0);
  end if;

  perform set_config('app.basic_medical_registration_mutation', 'true', true);
  update public.class_schedules schedules
  set schedule_status = 'cancelled', cancelled_by = actor_id,
      cancelled_at = clock_timestamp(), updated_at = clock_timestamp()
  where schedules.basic_medical_registration_id = target_registration_id
    and schedules.schedule_status not in ('cancelled', 'completed')
    and schedules.schedule_date >= (clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date;
  get diagnostics cancelled_schedule_count = row_count;

  update public.basic_medical_session_confirmations confirmations
  set invalidated_at = coalesce(confirmations.invalidated_at, clock_timestamp()),
      invalidated_reason = coalesce(confirmations.invalidated_reason, 'Buổi học Y cơ sở đã được hủy.')
  from public.basic_medical_registration_sessions sessions
  join public.class_schedules schedules on schedules.id = sessions.class_schedule_id
  where confirmations.registration_id_snapshot = target_registration_id
    and confirmations.session_id = sessions.id
    and schedules.schedule_status = 'cancelled'
    and confirmations.invalidated_at is null;

  update public.basic_medical_registrations
  set cancelled_at = clock_timestamp(), cancelled_by = actor_id,
      cancel_reason = nullif(btrim(target_reason), ''), updated_at = clock_timestamp()
  where id = target_registration_id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_data, new_data, metadata)
  values (
    actor_id, 'basic_medical.registration_cancelled', 'basic_medical_registration',
    target_registration_id,
    jsonb_build_object('cancelled_at', null),
    jsonb_build_object('cancelled_at', clock_timestamp(), 'reason', nullif(btrim(target_reason), '')),
    jsonb_build_object('cancelled_schedules', cancelled_schedule_count)
  );
  return jsonb_build_object('id', target_registration_id, 'already_cancelled', false,
    'cancelled_schedules', cancelled_schedule_count);
end;
$$;
revoke all on function public.cancel_basic_medical_registration(uuid,text) from public, anon;
grant execute on function public.cancel_basic_medical_registration(uuid,text) to authenticated;

create or replace view public.basic_medical_registration_list
with (security_invoker = true)
as
select registrations.id, registrations.created_at, registrations.start_date,
       registrations.end_date, registrations.academic_year, registrations.semester,
  registrations.student_count, courses.course_code, courses.course_name,
       rooms.room_code, rooms.building_code, rooms.room_name,
       registrants.full_name as registrant_name,
       responsible.full_name as responsible_name,
       completion.session_count, completion.confirmed_session_count,
       completion.is_completed,
       concat_ws(' ', registrations.registration_code, courses.course_code,
         courses.course_name, rooms.room_code, rooms.building_code, rooms.room_name,
         registrants.full_name, responsible.full_name) as search_text,
       registrations.registration_code,
       registrations.cancelled_at, registrations.cancelled_by,
       registrations.cancel_reason
from public.basic_medical_registrations registrations
join public.courses courses on courses.id = registrations.course_id
join public.rooms rooms on rooms.id = registrations.room_id
join public.profiles registrants on registrants.id = registrations.registrant_id
join public.profiles responsible on responsible.id = registrations.responsible_lecturer_id
left join public.basic_medical_registration_completion completion
  on completion.registration_id = registrations.id;
grant select on public.basic_medical_registration_list to authenticated, service_role;
-- End expanded source: supabase\migrations\20260807120000_eighth_followup_personnel_and_basic_medical.sql

-- Source: supabase/schemas/09_ninth_and_remaining_workflows_hardening.sql
-- Declarative-schema mirror for Ninth + Remaining Workflows hardening.
-- Expanded from: supabase\migrations\20260807200000_ninth_and_remaining_workflows_hardening.sql
-- Ninth follow-up + Remaining Workflows hardening
-- Covers: N-HIGH-01, CF-HIGH-01, CF-HIGH-02, IMP-HIGH-01, EQ-HIGH-04,
--         N-MEDIUM-02 (concurrency), can_hard_delete, import RPC-only,
--         email queue cleanup, CSV formula injection helper.

-------------------------------------------------------------------------------
-- 1. Expand Basic Medical linked-schedule guard to cover INSERT
--    Previously only BEFORE UPDATE OR DELETE. Now also blocks direct INSERT
--    of a row whose basic_medical_registration_id is non-null, and UPDATE
--    that turns an ordinary schedule into a linked one.
-------------------------------------------------------------------------------
create or replace function private.guard_basic_medical_linked_schedule_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Guard INSERT: reject if new row is already linked to a registration
  if tg_op = 'INSERT' then
    if new.basic_medical_registration_id is not null
      and current_setting('app.basic_medical_registration_mutation', true) is distinct from 'true'
    then
      raise exception 'BASIC_MEDICAL_SCHEDULE_RPC_REQUIRED' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Guard UPDATE: reject if old OR new row is linked
  if tg_op = 'UPDATE' then
    if (
      old.basic_medical_registration_id is not null
      or new.basic_medical_registration_id is not null
    ) and current_setting('app.basic_medical_registration_mutation', true) is distinct from 'true'
    then
      raise exception 'BASIC_MEDICAL_SCHEDULE_RPC_REQUIRED' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Guard DELETE: reject if the row being removed is linked
  if tg_op = 'DELETE' then
    if old.basic_medical_registration_id is not null
      and current_setting('app.basic_medical_registration_mutation', true) is distinct from 'true'
    then
      raise exception 'BASIC_MEDICAL_SCHEDULE_RPC_REQUIRED' using errcode = '42501';
    end if;
    return old;
  end if;

  return coalesce(new, old);
end;
$$;
revoke all on function private.guard_basic_medical_linked_schedule_mutation() from public, anon, authenticated;

-- Recreate trigger to fire on INSERT OR UPDATE OR DELETE
drop trigger if exists guard_basic_medical_linked_schedule_mutation on public.class_schedules;
create trigger guard_basic_medical_linked_schedule_mutation
before insert or update or delete on public.class_schedules
for each row execute function private.guard_basic_medical_linked_schedule_mutation();

-------------------------------------------------------------------------------
-- 2. Equipment requests: change class_schedule_id FK from CASCADE → RESTRICT
--    Prevents deleting a class schedule from silently removing Equipment
--    Requests that belong to it.
-------------------------------------------------------------------------------
alter table public.equipment_requests
  drop constraint if exists equipment_requests_class_schedule_id_fkey;
alter table public.equipment_requests
  add constraint equipment_requests_class_schedule_id_fkey
    foreign key (class_schedule_id) references public.class_schedules(id)
    on delete restrict deferrable initially deferred;

-------------------------------------------------------------------------------
-- 3. Central hard-delete authority
--    Returns true only for Root Administrator and the designated secondary
--    principal (personnel manager / Bảo).  All hard-delete RPCs must call
--    this function instead of scattering email-based checks.
-------------------------------------------------------------------------------
create or replace function private.can_hard_delete()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.system_security_principals principals
    where principals.singleton
      and (
        principals.root_admin_id = (select auth.uid())
        or principals.personnel_manager_id = (select auth.uid())
      )
  );
$$;
revoke all on function private.can_hard_delete() from public, anon, authenticated;
grant execute on function private.can_hard_delete() to authenticated;

-------------------------------------------------------------------------------
-- 4. Fix record_import_validation_row to accept conflict and system_error
--    Previously the function rejected these two statuses with an exception,
--    causing any conflict or system-error row to turn the whole batch fatal.
-------------------------------------------------------------------------------
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
  if target_status not in ('error', 'duplicate', 'conflict', 'system_error') then
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

-------------------------------------------------------------------------------
-- 5. finalize_import_batch: RPC computes counts from DB instead of trusting
--    client-supplied numbers. Revoke direct import_batches UPDATE from
--    authenticated so the browser cannot forge status or row counts.
-------------------------------------------------------------------------------
create or replace function public.finalize_import_batch(
  target_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  batch_room_type_id uuid;
  imported_count integer;
  warning_count integer;
  error_count integer;
  duplicate_count integer;
  conflict_count integer;
  system_error_count integer;
  total_count integer;
  new_status text;
begin
  -- Verify ownership and current state
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

  -- Count from DB — do not trust client numbers
  select
    count(*) filter (where validation_status = 'imported'),
    count(*) filter (where validation_status = 'warning'),
    count(*) filter (where validation_status = 'error'),
    count(*) filter (where validation_status = 'duplicate'),
    count(*) filter (where validation_status = 'conflict'),
    count(*) filter (where validation_status = 'system_error'),
    count(*)
  into imported_count, warning_count, error_count, duplicate_count, conflict_count, system_error_count, total_count
  from public.import_rows
  where import_batch_id = target_batch_id;

  new_status := case
    when imported_count + warning_count > 0 then
      case when error_count + duplicate_count + conflict_count + system_error_count > 0
        then 'completed_with_errors' else 'completed' end
    else 'failed'
  end;

  update public.import_batches
  set status = new_status::public.import_status,
      imported_rows = imported_count + warning_count,
      error_rows = error_count,
      warning_rows = warning_count,
      duplicate_rows = duplicate_count,
      conflict_rows = conflict_count,
      completed_at = clock_timestamp()
  where id = target_batch_id;

  return jsonb_build_object(
    'status', new_status,
    'imported', imported_count + warning_count,
    'warnings', warning_count,
    'errors', error_count,
    'duplicates', duplicate_count,
    'conflicts', conflict_count,
    'system_errors', system_error_count,
    'total', total_count
  );
end;
$$;
revoke all on function public.finalize_import_batch(uuid) from public, anon;
grant execute on function public.finalize_import_batch(uuid) to authenticated;

-- Revoke direct UPDATE on import_batches.status and row-count columns from
-- authenticated; the application must call finalize_import_batch instead.
-- INSERT (to create batches) and SELECT are still needed.
drop policy if exists import_batches_scoped_update on public.import_batches;

-- Revoke direct UPDATE on import_rows from authenticated; rows must be written
-- only through create_import_schedule_row and record_import_validation_row.
revoke update on public.import_rows from authenticated;

-------------------------------------------------------------------------------
-- 6. Reconciliation concurrency: claim/lease prevents two workers from
--    processing the same operation simultaneously.
--    Adds reconcile_started_at, reconcile_lease_expires_at, reconcile_worker_id
--    and a new 'reconciling' status value.
--    claim_personnel_reconciliation_batch atomically claims rows with
--    FOR UPDATE SKIP LOCKED so parallel workers never see the same operation.
-------------------------------------------------------------------------------
alter table public.personnel_update_operations
  add column if not exists reconcile_started_at timestamptz,
  add column if not exists reconcile_lease_expires_at timestamptz,
  add column if not exists reconcile_worker_id text;

-- Extend status check constraint to include 'reconciling' (used while a
-- worker holds the claim lease).
alter table public.personnel_update_operations
  drop constraint if exists personnel_update_operations_status_check;
alter table public.personnel_update_operations
  add constraint personnel_update_operations_status_check check (
    status in (
      'reserved', 'auth_updated', 'committed', 'rollback_required',
      'rolled_back', 'reconciliation_required', 'expired', 'reconciling'
    )
  );

-- Grant SELECT on import tables to service_role so integration tests and
-- internal monitoring can read batch/row state without going through REST.
grant select on public.import_batches to service_role;
grant select on public.import_rows to service_role;

-- Extend reconcile index to include the new status
drop index if exists public.personnel_update_operations_reconcile_idx;
create index personnel_update_operations_reconcile_idx
  on public.personnel_update_operations(status, expires_at)
  where status in ('reserved', 'auth_updated', 'rollback_required',
                   'reconciliation_required', 'reconciling');

-- Atomic claim RPC: sets status = reconciling and records lease
-- Returns claimed operations so the worker can process them without
-- keeping an open Postgres transaction across the external Auth API calls.
create or replace function public.claim_personnel_reconciliation_batch(
  target_limit integer default 10,
  target_worker_id text default null,
  target_lease_seconds integer default 300
)
returns table (
  id uuid,
  profile_id uuid,
  previous_email text,
  requested_email text,
  expected_version integer,
  prior_status text,
  expires_at timestamptz,
  actor_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_ts timestamptz := clock_timestamp();
  worker_id text := coalesce(nullif(btrim(coalesce(target_worker_id, '')), ''), gen_random_uuid()::text);
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if target_limit is null or target_limit < 1 or target_limit > 100 then
    raise exception 'INVALID_BATCH_LIMIT' using errcode = '22023';
  end if;
  if target_lease_seconds is null or target_lease_seconds < 30 or target_lease_seconds > 3600 then
    raise exception 'INVALID_LEASE_SECONDS' using errcode = '22023';
  end if;

  return query
  with claimed as (
    update public.personnel_update_operations ops
    set status = 'reconciling',
        reconcile_started_at = now_ts,
        reconcile_lease_expires_at = now_ts + (target_lease_seconds || ' seconds')::interval,
        reconcile_worker_id = worker_id
    where ops.id in (
      select sub.id
      from public.personnel_update_operations sub
      where sub.status in ('reserved', 'auth_updated', 'rollback_required', 'reconciliation_required')
        and sub.expires_at <= now_ts
        and (sub.reconcile_lease_expires_at is null or sub.reconcile_lease_expires_at < now_ts)
      order by sub.created_at
      limit target_limit
      for update skip locked
    )
    returning ops.id, ops.profile_id, ops.previous_email, ops.requested_email,
              ops.expected_version, ops.status as prior_status, ops.expires_at, ops.actor_id
  )
  select claimed.id, claimed.profile_id, claimed.previous_email, claimed.requested_email,
         claimed.expected_version, claimed.prior_status, claimed.expires_at, claimed.actor_id
  from claimed;
end;
$$;
revoke all on function public.claim_personnel_reconciliation_batch(integer, text, integer) from public, anon, authenticated;
grant execute on function public.claim_personnel_reconciliation_batch(integer, text, integer) to service_role;

-- Allow resolve_personnel_update_operation to also accept 'reconciling' as
-- current status (a claimed-but-not-yet-resolved operation).
create or replace function public.resolve_personnel_update_operation(
  target_operation_id uuid,
  target_status text,
  target_error text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare updated_count integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'SERVICE_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if target_status not in ('committed','rolled_back','reconciliation_required','expired') then
    raise exception 'INVALID_PERSONNEL_OPERATION_STATUS' using errcode = '22023';
  end if;
  update public.personnel_update_operations
  set status = target_status,
      committed_at = case when target_status = 'committed' then coalesce(committed_at, clock_timestamp()) else committed_at end,
      resolved_at = case when target_status in ('committed','rolled_back','expired') then clock_timestamp() else null end,
      last_error = target_error
  where id = target_operation_id
    and status in ('reserved','auth_updated','rollback_required','reconciliation_required','reconciling');
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;
revoke all on function public.resolve_personnel_update_operation(uuid,text,text) from public, anon, authenticated;
grant execute on function public.resolve_personnel_update_operation(uuid,text,text) to service_role;

-------------------------------------------------------------------------------
-- 7. Equipment request items: revoke generic direct DML, create RPC paths
--    Drops the equipment_items_manage for-all policy and replaces it with
--    SELECT only. All writes must go through official RPCs:
--      add_equipment_request_item  (Admin/Staff only, status new/preparing)
--      remove_equipment_request_item (Admin/Staff or registrant, status new/preparing)
--    Full edit (save_equipment_request) remains the existing Server Action
--    path; its direct DML is already guarded by the existing update policies
--    on equipment_requests. Items within a full-save RPC are transactional
--    with the parent update and handled by security definer functions.
-------------------------------------------------------------------------------
-- Drop the broad for-all policy; the existing equipment_items_select policy
-- (for select only) remains intact and provides read access.
drop policy if exists equipment_items_manage on public.equipment_request_items;

create or replace function public.add_equipment_request_item(
  target_request_id uuid,
  target_skill_name text,
  target_catalog_item_id uuid,
  target_quantity integer,
  target_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  request_status text;
  new_item_id uuid;
begin
  if not (select private.is_active_user()) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if not ((select private.has_role('admin')) or (select private.has_role('staff'))) then
    raise exception 'ADMIN_OR_STAFF_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(target_skill_name, '')), '') is null then
    raise exception 'INVALID_SKILL_NAME' using errcode = '22023';
  end if;
  if target_quantity is null or target_quantity < 1 or target_quantity > 9999 then
    raise exception 'INVALID_QUANTITY' using errcode = '22023';
  end if;

  select r.status into request_status
  from public.equipment_requests r
  where r.id = target_request_id
    and (select private.can_manage_equipment_request(r.id))
  for update;

  if request_status is null then
    raise exception 'EQUIPMENT_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if request_status not in ('new', 'preparing') then
    raise exception 'EQUIPMENT_REQUEST_NOT_EDITABLE' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.equipment_catalog where id = target_catalog_item_id and is_active
  ) then
    raise exception 'CATALOG_ITEM_INACTIVE_OR_MISSING' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.equipment_request_items
    where request_id = target_request_id
      and skill_name = btrim(target_skill_name)
  ) then
    raise exception 'SKILL_NOT_FOUND_IN_REQUEST' using errcode = 'P0002';
  end if;

  insert into public.equipment_request_items (request_id, skill_name, catalog_item_id, quantity, note)
  values (
    target_request_id,
    btrim(target_skill_name),
    target_catalog_item_id,
    target_quantity,
    nullif(btrim(coalesce(target_note, '')), '')
  )
  returning id into new_item_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id, 'equipment_request.item_added', 'equipment_request', target_request_id,
    jsonb_build_object('item_id', new_item_id, 'catalog_item_id', target_catalog_item_id,
      'skill_name', btrim(target_skill_name), 'quantity', target_quantity)
  );

  return new_item_id;
end;
$$;
revoke all on function public.add_equipment_request_item(uuid, text, uuid, integer, text) from public, anon;
grant execute on function public.add_equipment_request_item(uuid, text, uuid, integer, text) to authenticated;

create or replace function public.remove_equipment_request_item(
  target_item_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  request_id_val uuid;
  request_status text;
  deleted_count integer;
begin
  if not (select private.is_active_user()) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  select r.id, r.status into request_id_val, request_status
  from public.equipment_request_items items
  join public.equipment_requests r on r.id = items.request_id
  where items.id = target_item_id
    and (
      r.registrant_id = actor_id
      or (select private.can_manage_equipment_request(r.id))
    )
  for update of r;

  if request_id_val is null then
    raise exception 'EQUIPMENT_REQUEST_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;
  if request_status not in ('new', 'preparing') then
    raise exception 'EQUIPMENT_REQUEST_NOT_EDITABLE' using errcode = '42501';
  end if;

  delete from public.equipment_request_items where id = target_item_id;
  get diagnostics deleted_count = row_count;

  if deleted_count > 0 then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      actor_id, 'equipment_request.item_removed', 'equipment_request', request_id_val,
      jsonb_build_object('item_id', target_item_id)
    );
  end if;

  return deleted_count = 1;
end;
$$;
revoke all on function public.remove_equipment_request_item(uuid) from public, anon;
grant execute on function public.remove_equipment_request_item(uuid) to authenticated;

-------------------------------------------------------------------------------
-- 8. Email queue cleanup: Root/Bảo can hard-delete pending/suppressed/failed/
--    simulated notifications. Processing and sent records are protected.
-------------------------------------------------------------------------------
create or replace function public.admin_delete_email_notifications(
  target_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  deleted_count integer;
begin
  if not (select private.is_active_user()) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if not (select private.can_hard_delete()) then
    raise exception 'HARD_DELETE_AUTHORITY_REQUIRED' using errcode = '42501';
  end if;
  if target_ids is null or cardinality(target_ids) = 0 or cardinality(target_ids) > 200 then
    raise exception 'INVALID_NOTIFICATION_IDS' using errcode = '22023';
  end if;

  delete from public.email_notifications
  where id = any(target_ids)
    and status in ('pending', 'suppressed', 'failed', 'simulated');
  get diagnostics deleted_count = row_count;

  insert into public.audit_logs (actor_id, action, entity_type, metadata)
  values (actor_id, 'email_notifications.bulk_deleted', 'email_notifications',
    jsonb_build_object('requested_count', cardinality(target_ids), 'deleted_count', deleted_count));

  return deleted_count;
end;
$$;
revoke all on function public.admin_delete_email_notifications(uuid[]) from public, anon;
grant execute on function public.admin_delete_email_notifications(uuid[]) to authenticated;

-- End expanded source: supabase\migrations\20260807200000_ninth_and_remaining_workflows_hardening.sql


-- Source: supabase/schemas/10_equipment_transactional_outbox.sql
-- Schema: equipment_transactional_outbox
-- Description: Transactional Outbox for Non-Destructive Equipment Request Mutations (EMAIL-MEDIUM-02)

create table if not exists public.email_outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  domain text not null,
  event_type text not null,
  aggregate_id uuid,
  actor_id uuid references public.profiles(id) on delete set null,
  payload jsonb not null,
  recipients jsonb not null,
  delivery_mode_at_event text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error text,
  constraint email_outbox_events_delivery_mode_check check (delivery_mode_at_event in ('off', 'test', 'live')),
  constraint email_outbox_events_status_check check (status in ('pending', 'processing', 'processed', 'failed', 'suppressed'))
);

create index if not exists idx_email_outbox_events_pending
  on public.email_outbox_events(created_at, id)
  where status = 'pending';

alter table public.email_outbox_events enable row level security;
revoke all on public.email_outbox_events from public, anon, authenticated;
grant select, insert, update, delete on public.email_outbox_events to service_role;


-- Source: supabase/schemas/11_basic_medical_linked_schedule_editor.sql
-- Declarative mirror of the linked Basic Medical schedule wrapper introduced
-- by 20260810040000_sync_basic_medical_schedule_lecturer.sql.

do $$
begin
  if to_regprocedure(
    'public.update_class_schedule_details_core(uuid,date,time without time zone,time without time zone,uuid,integer,uuid[])'
  ) is null then
    alter function public.update_class_schedule_details(
      uuid, date, time, time, uuid, integer, uuid[]
    ) rename to update_class_schedule_details_core;
  end if;
end;
$$;

revoke all on function public.update_class_schedule_details_core(
  uuid, date, time, time, uuid, integer, uuid[]
) from public, anon, authenticated;

create or replace function public.update_class_schedule_details(
  target_schedule_id uuid,
  target_schedule_date date,
  target_start_time time,
  target_end_time time,
  target_room_id uuid,
  target_student_count integer,
  target_lecturer_ids uuid[] default null
)
returns public.class_schedules
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.class_schedules;
  changed_row public.class_schedules;
  linked_session public.basic_medical_registration_sessions;
  registration_row public.basic_medical_registrations;
  normalized_ids uuid[] := coalesce(target_lecturer_ids, '{}'::uuid[]);
  changes_confirmation_owner boolean := false;
  source_room_type_id uuid;
begin
  select schedules.* into before_row
  from public.class_schedules schedules
  where schedules.id = target_schedule_id
  for update;

  if before_row.basic_medical_registration_id is null then
    return public.update_class_schedule_details_core(
      target_schedule_id,
      target_schedule_date,
      target_start_time,
      target_end_time,
      target_room_id,
      target_student_count,
      normalized_ids
    );
  end if;

  select rooms.room_type_id into source_room_type_id
  from public.rooms rooms
  where rooms.id = before_row.room_id;

  if not (
    (select private.has_role('admin'))
    or (
      (select private.has_role('staff'))
      and (select private.has_room_type(source_room_type_id))
    )
  ) then
    raise exception 'CLASS_UPDATE_FORBIDDEN' using errcode = '42501';
  end if;

  select sessions.* into linked_session
  from public.basic_medical_registration_sessions sessions
  where sessions.class_schedule_id = target_schedule_id
    and sessions.registration_id = before_row.basic_medical_registration_id
  for update;

  select registrations.* into registration_row
  from public.basic_medical_registrations registrations
  where registrations.id = before_row.basic_medical_registration_id
  for update;

  if linked_session.id is null or registration_row.id is null then
    raise exception 'BASIC_MEDICAL_LINKED_SCHEDULE_INCONSISTENT'
      using errcode = '55000';
  end if;

  if cardinality(normalized_ids) <> 1 then
    raise exception 'BASIC_MEDICAL_TEACHING_LECTURER_REQUIRED'
      using errcode = '22023';
  end if;

  -- Room and student count belong to the aggregate registration, not one
  -- individual session. They must be changed through the registration editor.
  if target_room_id is distinct from before_row.room_id
    or target_student_count is distinct from before_row.student_count then
    raise exception 'BASIC_MEDICAL_REGISTRATION_EDIT_REQUIRED'
      using errcode = '55000';
  end if;

  if target_schedule_date < registration_row.start_date
    or target_schedule_date > registration_row.end_date then
    raise exception 'BASIC_MEDICAL_SESSION_DATE_OUTSIDE_REGISTRATION'
      using errcode = '22023';
  end if;

  changes_confirmation_owner :=
    before_row.schedule_date is distinct from target_schedule_date
    or before_row.start_time is distinct from target_start_time
    or before_row.end_time is distinct from target_end_time
    or linked_session.teaching_lecturer_id is distinct from normalized_ids[1];

  if changes_confirmation_owner and exists (
    select 1
    from public.basic_medical_session_confirmations confirmations
    where confirmations.session_id = linked_session.id
      and confirmations.invalidated_at is null
  ) then
    raise exception 'BASIC_MEDICAL_SESSION_ALREADY_CONFIRMED'
      using errcode = '55000';
  end if;

  perform set_config('app.basic_medical_registration_mutation', 'true', true);

  changed_row := public.update_class_schedule_details_core(
    target_schedule_id,
    target_schedule_date,
    target_start_time,
    target_end_time,
    target_room_id,
    target_student_count,
    normalized_ids
  );

  update public.basic_medical_registration_sessions sessions
  set teaching_lecturer_id = normalized_ids[1]
  where sessions.id = linked_session.id
    and sessions.teaching_lecturer_id is distinct from normalized_ids[1];

  return changed_row;
end;
$$;

revoke all on function public.update_class_schedule_details(
  uuid, date, time, time, uuid, integer, uuid[]
) from public, anon;
grant execute on function public.update_class_schedule_details(
  uuid, date, time, time, uuid, integer, uuid[]
) to authenticated;


-- Source: supabase/schemas/12_basic_medical_cancellation_time_boundary.sql
-- Declarative final state for BUG-Y-CALENDAR-CANCEL-001.
-- Preserve current/history sessions by cancelling only strictly future starts.

create or replace function private.is_basic_medical_schedule_start_after(
  target_schedule_date date,
  target_start_time time,
  target_business_now timestamp without time zone
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (target_schedule_date + target_start_time) > target_business_now;
$$;

revoke all on function private.is_basic_medical_schedule_start_after(
  date, time, timestamp without time zone
) from public, anon, authenticated;

create or replace function public.cancel_basic_medical_registration(
  target_registration_id uuid,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_row public.basic_medical_registrations%rowtype;
  business_now timestamp without time zone;
  cancelled_schedule_ids uuid[] := '{}'::uuid[];
  cancelled_schedule_count integer := 0;
begin
  if not (select private.can_manage_basic_medical()) then
    raise exception 'BASIC_MEDICAL_MANAGER_REQUIRED' using errcode = '42501';
  end if;

  select * into target_row from public.basic_medical_registrations
  where id = target_registration_id for update;
  if target_row.id is null then
    raise exception 'BASIC_MEDICAL_REGISTRATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if target_row.cancelled_at is not null then
    return jsonb_build_object('id', target_row.id, 'already_cancelled', true, 'cancelled_schedules', 0);
  end if;

  business_now := clock_timestamp() at time zone 'Asia/Ho_Chi_Minh';

  perform private.enqueue_basic_medical_registration_outbox_event(
    target_registration_id,
    'cancelled',
    actor_id,
    null
  );

  perform set_config('app.basic_medical_registration_mutation', 'true', true);

  with cancelled_schedules as (
    update public.class_schedules schedules
    set schedule_status = 'cancelled', cancelled_by = actor_id,
        cancelled_at = clock_timestamp(), updated_at = clock_timestamp()
    where schedules.basic_medical_registration_id = target_registration_id
      and schedules.schedule_status not in ('cancelled', 'completed')
      and private.is_basic_medical_schedule_start_after(
        schedules.schedule_date,
        schedules.start_time,
        business_now
      )
    returning schedules.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into cancelled_schedule_ids
  from cancelled_schedules;
  cancelled_schedule_count := cardinality(cancelled_schedule_ids);

  update public.basic_medical_session_confirmations confirmations
  set invalidated_at = coalesce(confirmations.invalidated_at, clock_timestamp()),
      invalidated_reason = coalesce(confirmations.invalidated_reason, 'Buổi học Y cơ sở đã được hủy.')
  from public.basic_medical_registration_sessions sessions
  where confirmations.registration_id_snapshot = target_registration_id
    and confirmations.session_id = sessions.id
    and sessions.class_schedule_id = any(cancelled_schedule_ids)
    and confirmations.invalidated_at is null;

  update public.basic_medical_registrations
  set cancelled_at = clock_timestamp(), cancelled_by = actor_id,
      cancel_reason = nullif(btrim(target_reason), ''), updated_at = clock_timestamp()
  where id = target_registration_id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, old_data, new_data, metadata)
  values (
    actor_id, 'basic_medical.registration_cancelled', 'basic_medical_registration',
    target_registration_id,
    jsonb_build_object('cancelled_at', null),
    jsonb_build_object('cancelled_at', clock_timestamp(), 'reason', nullif(btrim(target_reason), '')),
    jsonb_build_object('cancelled_schedules', cancelled_schedule_count)
  );

  return jsonb_build_object(
    'id', target_registration_id,
    'already_cancelled', false,
    'cancelled_schedules', cancelled_schedule_count
  );
end;
$$;

revoke all on function public.cancel_basic_medical_registration(uuid, text) from public, anon;
grant execute on function public.cancel_basic_medical_registration(uuid, text) to authenticated;


-- Source: supabase/schemas/13_basic_medical_confirmation_snapshot_guard.sql
-- Declarative final state for BUG-Y-CONFIRM-UI-001.
-- A signature must certify the exact eligible equipment state displayed to signer.

create or replace function private.assert_basic_medical_inventory_snapshot(
  target_room_id uuid,
  target_checks jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inventory_row record;
  check_item jsonb;
  canonical_count integer;
begin
  -- Every INSERT/UPDATE/DELETE on these tables takes ROW EXCLUSIVE, which
  -- conflicts with this lock. Catalog first is the canonical order used by
  -- parent-then-allocation creation writers; keep it stable everywhere.
  lock table public.basic_medical_equipment_catalog,
             public.basic_medical_room_inventory
    in share row exclusive mode;

  if jsonb_array_length(target_checks) <> (
    select count(*)
    from public.basic_medical_room_inventory as inventory
    join public.basic_medical_equipment_catalog as catalog
      on catalog.id = inventory.catalog_item_id
    where inventory.room_id = target_room_id
      and inventory.is_active
      and catalog.is_active
  ) then
    raise exception 'Thiết bị phòng đã thay đổi. Vui lòng tải lại trước khi ký xác nhận.'
      using errcode = '40001';
  end if;

  select count(distinct item->>'inventory_id') into canonical_count
  from jsonb_array_elements(target_checks) as item;
  if canonical_count <> jsonb_array_length(target_checks) then
    raise exception 'Thiết bị phòng đã thay đổi. Vui lòng tải lại trước khi ký xác nhận.'
      using errcode = '40001';
  end if;

  for inventory_row in
    select inventory.*, catalog.item_name, catalog.commercial_name, catalog.unit
    from public.basic_medical_room_inventory as inventory
    join public.basic_medical_equipment_catalog as catalog
      on catalog.id = inventory.catalog_item_id
    where inventory.room_id = target_room_id
      and inventory.is_active
      and catalog.is_active
    order by inventory.id
    for update of inventory, catalog
  loop
    select item into check_item
    from jsonb_array_elements(target_checks) as item
    where (item->>'inventory_id')::uuid = inventory_row.id;

    if check_item is null
      or (check_item->>'expected_catalog_item_id')::uuid
           is distinct from inventory_row.catalog_item_id
      or (check_item->>'expected_total_quantity')::integer
           is distinct from inventory_row.total_quantity
      or (check_item->>'expected_good_quantity')::integer
           is distinct from inventory_row.good_quantity
      or (check_item->>'expected_damaged_quantity')::integer
           is distinct from inventory_row.damaged_quantity
      or check_item->>'expected_item_name'
           is distinct from inventory_row.item_name
      or check_item->>'expected_commercial_name'
           is distinct from inventory_row.commercial_name
      or check_item->>'expected_unit'
           is distinct from inventory_row.unit then
      raise exception 'Thiết bị phòng đã thay đổi. Vui lòng tải lại trước khi ký xác nhận.'
        using errcode = '40001';
    end if;
  end loop;

  -- This reverse membership check rejects an item that disappeared,
  -- moved rooms, became inactive, or whose catalog became inactive.
  if exists (
    select 1
    from jsonb_array_elements(target_checks) as item
    left join public.basic_medical_room_inventory as inventory
      on inventory.id = (item->>'inventory_id')::uuid
     and inventory.room_id = target_room_id
     and inventory.is_active
    left join public.basic_medical_equipment_catalog as catalog
      on catalog.id = inventory.catalog_item_id
     and catalog.is_active
    where inventory.id is null or catalog.id is null
  ) then
    raise exception 'Thiết bị phòng đã thay đổi. Vui lòng tải lại trước khi ký xác nhận.'
      using errcode = '40001';
  end if;
end;
$$;

revoke all on function private.assert_basic_medical_inventory_snapshot(uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.confirm_basic_medical_session(
  target_session_id uuid,
  target_signature_data text,
  target_checks jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  signed_at_value timestamptz := clock_timestamp();
  local_signed_at timestamp;
  earliest_confirmation_at timestamp;
  session_row record;
  inventory_row record;
  confirmation_id_value uuid;
  inventory_count integer;
  newly_damaged integer;
  signature_bytes bytea;
  damaged_items jsonb := '[]'::jsonb;
begin
  if actor_id is null or not (select private.is_active_user()) then
    raise exception 'Phiên đăng nhập đã hết hạn.' using errcode = '42501';
  end if;
  if target_signature_data is null
    or length(target_signature_data) not between 100 and 400000
    or target_signature_data not like 'data:image/png;base64,%' then
    raise exception 'Chữ ký điện tử không hợp lệ.' using errcode = '22023';
  end if;
  begin
    signature_bytes := decode(split_part(target_signature_data, ',', 2), 'base64');
  exception when others then
    raise exception 'Chữ ký điện tử không hợp lệ.' using errcode = '22023';
  end;
  if substring(signature_bytes from 1 for 8) <> decode('iVBORw0KGgo=', 'base64') then
    raise exception 'Chữ ký phải là ảnh PNG.' using errcode = '22023';
  end if;
  if target_checks is null or jsonb_typeof(target_checks) <> 'array' then
    raise exception 'Danh sách tình trạng thiết bị không hợp lệ.' using errcode = '22023';
  end if;

  select sessions.id, sessions.registration_id, sessions.class_schedule_id,
         sessions.teaching_lecturer_id, schedules.schedule_date,
         schedules.start_time, schedules.end_time, schedules.room_id,
         schedules.schedule_status, rooms.room_code, rooms.room_name,
         rooms.building_code
  into session_row
  from public.basic_medical_registration_sessions as sessions
  join public.class_schedules as schedules on schedules.id = sessions.class_schedule_id
  join public.rooms as rooms on rooms.id = schedules.room_id
  where sessions.id = target_session_id
  for update of sessions, schedules;

  if session_row.id is null or session_row.schedule_status = 'cancelled' then
    raise exception 'Không tìm thấy buổi học có thể xác nhận.' using errcode = 'P0002';
  end if;
  if session_row.teaching_lecturer_id <> actor_id then
    raise exception 'Chỉ Giảng viên giảng dạy/hướng dẫn của buổi được ký xác nhận.' using errcode = '42501';
  end if;
  local_signed_at := signed_at_value at time zone 'Asia/Ho_Chi_Minh';
  earliest_confirmation_at := session_row.schedule_date + session_row.end_time - interval '1 hour';
  if local_signed_at < earliest_confirmation_at then
    raise exception 'Chỉ được xác nhận từ %.', to_char(earliest_confirmation_at, 'HH24:MI DD/MM/YYYY')
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.basic_medical_session_confirmations
    where session_id = target_session_id and invalidated_at is null
  ) then
    raise exception 'Buổi học đã được xác nhận.' using errcode = '23505';
  end if;

  -- Reject malformed values before the helper casts UUIDs or integers and
  -- before any inventory/catalog table lock is requested.
  if exists (
      select 1 from jsonb_array_elements(target_checks) as item
      where coalesce(item->>'inventory_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         or coalesce(item->>'newly_damaged_quantity', '') !~ '^[0-9]+$'
         or length(coalesce(item->>'newly_damaged_quantity', '')) > 10
         or (length(coalesce(item->>'newly_damaged_quantity', '')) = 10
             and item->>'newly_damaged_quantity' > '2147483647')
         or coalesce(item->>'expected_catalog_item_id', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         or coalesce(item->>'expected_total_quantity', '') !~ '^[0-9]+$'
         or length(coalesce(item->>'expected_total_quantity', '')) > 10
         or (length(coalesce(item->>'expected_total_quantity', '')) = 10
             and item->>'expected_total_quantity' > '2147483647')
         or coalesce(item->>'expected_good_quantity', '') !~ '^[0-9]+$'
         or length(coalesce(item->>'expected_good_quantity', '')) > 10
         or (length(coalesce(item->>'expected_good_quantity', '')) = 10
             and item->>'expected_good_quantity' > '2147483647')
         or coalesce(item->>'expected_damaged_quantity', '') !~ '^[0-9]+$'
         or length(coalesce(item->>'expected_damaged_quantity', '')) > 10
         or (length(coalesce(item->>'expected_damaged_quantity', '')) = 10
             and item->>'expected_damaged_quantity' > '2147483647')
         or jsonb_typeof(item->'expected_item_name') <> 'string'
         or jsonb_typeof(item->'expected_commercial_name') not in ('string', 'null')
         or jsonb_typeof(item->'expected_unit') <> 'string'
    )
    or (select count(distinct item->>'inventory_id') from jsonb_array_elements(target_checks) as item)
         <> jsonb_array_length(target_checks) then
    raise exception 'Danh sách tình trạng thiết bị không khớp với phòng.' using errcode = '22023';
  end if;

  -- These casts are safe after the complete syntax/range gate above. Keep
  -- payload-only numeric constraints ahead of helper casts and table locks.
  if exists (
    select 1
    from jsonb_array_elements(target_checks) as item
    where (item->>'newly_damaged_quantity')::integer
          > (item->>'expected_good_quantity')::integer
  ) then
    raise exception 'Danh sách tình trạng thiết bị không khớp với phòng.' using errcode = '22023';
  end if;

  -- Establish and lock the exact active allocation-plus-catalog set before
  -- any database-backed equipment-set acceptance decision under READ COMMITTED.
  perform private.assert_basic_medical_inventory_snapshot(session_row.room_id, target_checks);

  insert into public.basic_medical_session_confirmations (
    session_id, registration_id_snapshot, class_schedule_id_snapshot, signer_id,
    signature_data, schedule_date_snapshot, start_time_snapshot, end_time_snapshot,
    room_id_snapshot, teaching_lecturer_id_snapshot, signed_at
  ) values (
    session_row.id, session_row.registration_id, session_row.class_schedule_id, actor_id,
    target_signature_data, session_row.schedule_date, session_row.start_time, session_row.end_time,
    session_row.room_id, session_row.teaching_lecturer_id, signed_at_value
  ) returning id into confirmation_id_value;

  for inventory_row in
    select inventory.*, catalog.item_name, catalog.commercial_name, catalog.unit
    from public.basic_medical_room_inventory as inventory
    join public.basic_medical_equipment_catalog as catalog on catalog.id = inventory.catalog_item_id
    where inventory.room_id = session_row.room_id and inventory.is_active and catalog.is_active
    order by inventory.id
  loop
    select (item->>'newly_damaged_quantity')::integer into newly_damaged
    from jsonb_array_elements(target_checks) as item
    where (item->>'inventory_id')::uuid = inventory_row.id;
    if newly_damaged is null or newly_damaged < 0 or newly_damaged > inventory_row.good_quantity then
      raise exception 'Số lượng hư mới của % không hợp lệ.', inventory_row.item_name using errcode = '22023';
    end if;
    insert into public.basic_medical_session_equipment_checks (
      confirmation_id, inventory_id, item_name_snapshot, commercial_name_snapshot, unit_snapshot,
      total_before, good_before, damaged_before, newly_damaged_quantity, good_after, damaged_after
    ) values (
      confirmation_id_value, inventory_row.id, inventory_row.item_name, inventory_row.commercial_name,
      inventory_row.unit, inventory_row.total_quantity, inventory_row.good_quantity,
      inventory_row.damaged_quantity, newly_damaged, inventory_row.good_quantity - newly_damaged,
      inventory_row.damaged_quantity + newly_damaged
    );
    if newly_damaged > 0 then
      update public.basic_medical_room_inventory
      set good_quantity = good_quantity - newly_damaged, damaged_quantity = damaged_quantity + newly_damaged,
          last_damage_reporter_id = actor_id, last_damage_reported_at = signed_at_value
      where id = inventory_row.id;
      insert into public.basic_medical_equipment_condition_logs (
        inventory_id, confirmation_id, event_type, total_before, good_before, damaged_before,
        total_after, good_after, damaged_after, quantity_delta, actor_id, note
      ) values (
        inventory_row.id, confirmation_id_value, 'damage_report', inventory_row.total_quantity,
        inventory_row.good_quantity, inventory_row.damaged_quantity, inventory_row.total_quantity,
        inventory_row.good_quantity - newly_damaged, inventory_row.damaged_quantity + newly_damaged,
        newly_damaged, actor_id, 'Giảng viên báo hư khi xác nhận buổi học.'
      );
      damaged_items := damaged_items || jsonb_build_array(jsonb_build_object(
        'inventory_id', inventory_row.id, 'item_name', inventory_row.item_name,
        'commercial_name', inventory_row.commercial_name, 'unit', inventory_row.unit,
        'newly_damaged_quantity', newly_damaged, 'good_quantity', inventory_row.good_quantity - newly_damaged,
        'damaged_quantity', inventory_row.damaged_quantity + newly_damaged
      ));
    end if;
  end loop;
  if jsonb_array_length(damaged_items) > 0 then
    perform private.enqueue_basic_medical_damage_outbox_event(confirmation_id_value, actor_id);
  end if;
  return jsonb_build_object('confirmation_id', confirmation_id_value, 'signed_at', signed_at_value,
    'room_id', session_row.room_id, 'room_code', session_row.room_code, 'room_name', session_row.room_name,
    'building_code', session_row.building_code, 'damaged_items', damaged_items);
end;
$$;

revoke all on function public.confirm_basic_medical_session(uuid, text, jsonb) from public, anon;
grant execute on function public.confirm_basic_medical_session(uuid, text, jsonb) to authenticated;


-- Source: supabase/schemas/14_basic_medical_confirmation_evidence.sql
create or replace function public.get_basic_medical_confirmation_evidence(
  target_confirmation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  evidence jsonb;
begin
  select jsonb_build_object(
    'confirmation_id', confirmations.id,
    'registration_id_snapshot', confirmations.registration_id_snapshot,
    'class_schedule_id_snapshot', confirmations.class_schedule_id_snapshot,
    'signer_id', confirmations.signer_id,
    'signature_data', confirmations.signature_data,
    'schedule_date_snapshot', confirmations.schedule_date_snapshot,
    'start_time_snapshot', confirmations.start_time_snapshot,
    'end_time_snapshot', confirmations.end_time_snapshot,
    'room_id_snapshot', confirmations.room_id_snapshot,
    'teaching_lecturer_id_snapshot', confirmations.teaching_lecturer_id_snapshot,
    'signed_at', confirmations.signed_at,
    'invalidated_at', confirmations.invalidated_at,
    'invalidated_reason', confirmations.invalidated_reason,
    'equipment_checks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'inventory_id', checks.inventory_id,
          'item_name_snapshot', checks.item_name_snapshot,
          'commercial_name_snapshot', checks.commercial_name_snapshot,
          'unit_snapshot', checks.unit_snapshot,
          'total_before', checks.total_before,
          'good_before', checks.good_before,
          'damaged_before', checks.damaged_before,
          'newly_damaged_quantity', checks.newly_damaged_quantity,
          'total_after', checks.total_before,
          'good_after', checks.good_after,
          'damaged_after', checks.damaged_after
        ) order by checks.item_name_snapshot, checks.inventory_id
      )
      from public.basic_medical_session_equipment_checks checks
      where checks.confirmation_id = confirmations.id
    ), '[]'::jsonb)
  )
  into evidence
  from public.basic_medical_session_confirmations confirmations
  where confirmations.id = target_confirmation_id
    and (select private.can_view_basic_medical_registration(
      confirmations.registration_id_snapshot
    ));

  if evidence is null then
    raise exception 'CONFIRMATION_EVIDENCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  return evidence;
end;
$$;

revoke all on function public.get_basic_medical_confirmation_evidence(uuid)
  from public, anon;
grant execute on function public.get_basic_medical_confirmation_evidence(uuid)
  to authenticated;


-- Source: supabase/schemas/15_basic_medical_condition_log_catalog_snapshot.sql
-- Preserve the catalog identity and display name that existed when each new
-- Basic Medical condition log was written. Existing rows intentionally stay
-- NULL: deriving a historical name from today's mutable catalog would invent
-- evidence that was never recorded at the event time.
alter table public.basic_medical_equipment_condition_logs
  add column if not exists catalog_item_id_snapshot uuid,
  add column if not exists item_name_snapshot text,
  add column if not exists commercial_name_snapshot text,
  add column if not exists unit_snapshot text;

alter table public.basic_medical_equipment_condition_logs
  drop constraint if exists basic_medical_condition_log_catalog_snapshot_valid;

alter table public.basic_medical_equipment_condition_logs
  add constraint basic_medical_condition_log_catalog_snapshot_valid check (
    (
      catalog_item_id_snapshot is null
      and item_name_snapshot is null
      and commercial_name_snapshot is null
      and unit_snapshot is null
    )
    or (
      catalog_item_id_snapshot is not null
      and item_name_snapshot is not null
      and btrim(item_name_snapshot) <> ''
      and unit_snapshot is not null
      and btrim(unit_snapshot) <> ''
    )
  );

comment on column public.basic_medical_equipment_condition_logs.catalog_item_id_snapshot is
  'Catalog identity captured for new log events; NULL means the legacy row predates snapshot capture.';
comment on column public.basic_medical_equipment_condition_logs.item_name_snapshot is
  'Catalog item name captured at event time. Existing legacy rows are deliberately not backfilled.';
comment on column public.basic_medical_equipment_condition_logs.commercial_name_snapshot is
  'Optional commercial name captured at event time; NULL is also valid for a new event.';
comment on column public.basic_medical_equipment_condition_logs.unit_snapshot is
  'Catalog unit captured at event time. Existing legacy rows are deliberately not backfilled.';

create index if not exists basic_medical_condition_logs_catalog_snapshot_idx
  on public.basic_medical_equipment_condition_logs (catalog_item_id_snapshot, created_at desc);

create or replace function private.snapshot_basic_medical_condition_log_catalog()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select
    inventory.catalog_item_id,
    catalog.item_name,
    catalog.commercial_name,
    catalog.unit
  into
    new.catalog_item_id_snapshot,
    new.item_name_snapshot,
    new.commercial_name_snapshot,
    new.unit_snapshot
  from public.basic_medical_room_inventory as inventory
  join public.basic_medical_equipment_catalog as catalog
    on catalog.id = inventory.catalog_item_id
  where inventory.id = new.inventory_id;

  if new.catalog_item_id_snapshot is null then
    raise exception 'BASIC_MEDICAL_LOG_CATALOG_NOT_FOUND' using errcode = '23503';
  end if;

  return new;
end;
$$;

revoke all on function private.snapshot_basic_medical_condition_log_catalog()
  from public, anon, authenticated;

drop trigger if exists basic_medical_condition_log_catalog_snapshot
  on public.basic_medical_equipment_condition_logs;
create trigger basic_medical_condition_log_catalog_snapshot
before insert on public.basic_medical_equipment_condition_logs
for each row execute function private.snapshot_basic_medical_condition_log_catalog();

create or replace function public.search_basic_medical_equipment(
  target_tab text,
  target_query text default null,
  target_room_id uuid default null,
  target_catalog_item_id uuid default null,
  target_event_type text default null,
  target_actor_id uuid default null,
  target_from_date date default null,
  target_to_date date default null,
  target_status text default null,
  target_page integer default 1,
  target_page_size integer default 50
)
returns table(row_data jsonb, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  normalized_query text := lower(btrim(coalesce(target_query, '')));
  safe_page integer := greatest(coalesce(target_page, 1), 1);
  safe_size integer := least(greatest(coalesce(target_page_size, 50), 1), 50);
  can_manage boolean := (select private.can_manage_basic_medical());
begin
  if not (select private.is_active_user())
    or not ((select private.has_room_type('40000000-0000-0000-0000-000000000002'::uuid)) or can_manage) then
    raise exception 'BASIC_MEDICAL_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  if target_tab not in ('inventory','rooms','damaged','logs') then
    raise exception 'INVALID_BASIC_MEDICAL_EQUIPMENT_TAB' using errcode = '22023';
  end if;
  if target_tab in ('inventory','damaged','logs') and not can_manage then
    raise exception 'BASIC_MEDICAL_MANAGER_REQUIRED' using errcode = '42501';
  end if;

  if target_tab = 'inventory' then
    return query
    select to_jsonb(catalog), count(*) over()
    from public.basic_medical_equipment_catalog catalog
    where (target_status is null or target_status = ''
      or (target_status = 'active' and catalog.is_active)
      or (target_status = 'inactive' and not catalog.is_active))
      and (normalized_query = ''
        or lower(extensions.unaccent(catalog.item_name)) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(extensions.unaccent(coalesce(catalog.commercial_name, ''))) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(extensions.unaccent(coalesce(catalog.item_type, ''))) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(coalesce(catalog.manufacturer, '')) like '%' || normalized_query || '%'
        or lower(coalesce(catalog.model, '')) like '%' || normalized_query || '%')
    order by catalog.item_name, catalog.id
    limit safe_size offset (safe_page - 1) * safe_size;
  elsif target_tab in ('rooms','damaged') then
    return query
    select jsonb_build_object(
      'id', inventory.id, 'room_id', inventory.room_id,
      'catalog_item_id', inventory.catalog_item_id,
      'total_quantity', inventory.total_quantity, 'good_quantity', inventory.good_quantity,
      'damaged_quantity', inventory.damaged_quantity, 'is_active', inventory.is_active,
      'last_damage_reported_at', inventory.last_damage_reported_at,
      'room', to_jsonb(rooms), 'catalog', to_jsonb(catalog),
      'last_damage_reporter', case when can_manage then to_jsonb(reporter) else null end
    ), count(*) over()
    from public.basic_medical_room_inventory inventory
    join public.rooms rooms on rooms.id = inventory.room_id
    join public.basic_medical_equipment_catalog catalog on catalog.id = inventory.catalog_item_id
    left join public.profiles reporter on reporter.id = inventory.last_damage_reporter_id
    where inventory.is_active
      and (target_tab <> 'damaged' or inventory.damaged_quantity > 0)
      and (target_room_id is null or inventory.room_id = target_room_id)
      and (target_catalog_item_id is null or inventory.catalog_item_id = target_catalog_item_id)
      and (normalized_query = ''
        or lower(extensions.unaccent(catalog.item_name)) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(extensions.unaccent(coalesce(catalog.commercial_name, ''))) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(rooms.room_code) like '%' || normalized_query || '%'
        or lower(rooms.building_code) like '%' || normalized_query || '%'
        or lower(extensions.unaccent(coalesce(rooms.room_name, ''))) like '%' || lower(extensions.unaccent(normalized_query)) || '%')
    order by rooms.building_code, rooms.room_code, catalog.item_name
    limit safe_size offset (safe_page - 1) * safe_size;
  else
    return query
    select jsonb_build_object(
      'id', logs.id, 'event_type', logs.event_type,
      'total_before', logs.total_before, 'good_before', logs.good_before,
      'damaged_before', logs.damaged_before, 'total_after', logs.total_after,
      'good_after', logs.good_after, 'damaged_after', logs.damaged_after,
      'quantity_delta', logs.quantity_delta, 'note', logs.note,
      'created_at', logs.created_at,
      'inventory', jsonb_build_object(
        'room', to_jsonb(rooms),
        'catalog', jsonb_build_object(
          'id', logs.catalog_item_id_snapshot,
          'item_name', coalesce(logs.item_name_snapshot, 'Tên lịch sử không được ghi nhận'),
          'commercial_name', logs.commercial_name_snapshot,
          'unit', logs.unit_snapshot,
          'is_historical_snapshot', logs.item_name_snapshot is not null
        )
      ),
      'actor', to_jsonb(actor)
    ), count(*) over()
    from public.basic_medical_equipment_condition_logs logs
    join public.basic_medical_room_inventory inventory on inventory.id = logs.inventory_id
    join public.rooms rooms on rooms.id = inventory.room_id
    join public.profiles actor on actor.id = logs.actor_id
    where (target_room_id is null or inventory.room_id = target_room_id)
      and (target_catalog_item_id is null
        or coalesce(logs.catalog_item_id_snapshot, inventory.catalog_item_id) = target_catalog_item_id)
      and (target_actor_id is null or logs.actor_id = target_actor_id)
      and (target_event_type is null or target_event_type = '' or logs.event_type = target_event_type)
      and (target_from_date is null or logs.created_at >= target_from_date::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and (target_to_date is null or logs.created_at < (target_to_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
      and (normalized_query = ''
        or lower(extensions.unaccent(coalesce(logs.item_name_snapshot, ''))) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(rooms.room_code) like '%' || normalized_query || '%'
        or lower(extensions.unaccent(actor.full_name)) like '%' || lower(extensions.unaccent(normalized_query)) || '%'
        or lower(extensions.unaccent(coalesce(logs.note, ''))) like '%' || lower(extensions.unaccent(normalized_query)) || '%')
    order by logs.created_at desc, logs.id
    limit safe_size offset (safe_page - 1) * safe_size;
  end if;
end;
$$;

revoke all on function public.search_basic_medical_equipment(
  text,text,uuid,uuid,text,uuid,date,date,text,integer,integer
) from public, anon;
grant execute on function public.search_basic_medical_equipment(
  text,text,uuid,uuid,text,uuid,date,date,text,integer,integer
) to authenticated;


-- Source: supabase/schemas/16_reschedule_class_final_state.sql
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
  actor_id uuid := (select auth.uid());
begin
  if target_schedule_date is null then
    raise exception 'INVALID_SCHEDULE_DATE' using errcode = '22023';
  end if;

  select schedules.* into before_row
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
  from public.profiles as profiles where profiles.id = actor_id;

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
    if room_type_code_value = 'basic_medical' then
      -- Preserved baseline Basic Medical notification behavior: insert directly into email_notifications with approved subject format
      insert into public.email_notifications (
        notification_type, recipient_id, recipient_email, dedupe_key, subject, payload
      )
      select
        'class_schedule_basic_medical_updated',
        recipients.id, recipients.email,
        concat('class_schedule_basic_medical_updated:', change_id, ':', before_row.id, ':', recipients.id),
        concat('[MedLabs Calendar] Đổi ngày học Y cơ sở · ', coalesce(before_row.course_code_snapshot, '')),
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
          'actor', coalesce(actor_name, 'Người dùng hệ thống')
        )
      from public.profiles as recipients
      where recipients.is_active
        and (
          recipients.id in (before_row.lecturer_id, before_row.lecturer_2_id)
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
    else
      -- Skills Lab outbox event
      insert into public.email_outbox_events (
        domain,
        event_type,
        aggregate_id,
        event_key,
        payload,
        recipients,
        delivery_mode_at_event
      )
      select
        'skills_lab_schedule',
        'class_schedule_rescheduled',
        before_row.id,
        concat('skills_lab:rescheduled:', change_id, ':', before_row.id),
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
        ),
        (
          select coalesce(jsonb_agg(jsonb_build_object('id', recipients.id, 'email', recipients.email)), '[]'::jsonb)
          from public.profiles as recipients
          where recipients.is_active
            and (
              recipients.id in (before_row.lecturer_id, before_row.lecturer_2_id)
              or recipients.id = before_row.created_by
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
        ),
        (select delivery_mode from public.email_delivery_settings where setting_key = 'primary')
      on conflict (event_key) do nothing;
    end if;
  end if;

  return changed_row;
end;
$$;

revoke all on function public.reschedule_class(uuid, date) from public, anon;
grant execute on function public.reschedule_class(uuid, date) to authenticated;



-- Source: supabase/schemas/17_personnel_password_and_catalog_batches.sql
-- Forward-only personnel password controls and atomic room/course batch writes.
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;
alter table public.profiles
  add column if not exists must_change_password_hash text;

create or replace function private.assert_personnel_password_target(target_user_id uuid, require_root boolean default false)
returns table(actor_id uuid, actor_is_root boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  root_allowed boolean := false;
begin
  if caller_id is null or not (select private.can_manage_personnel()) then
    raise exception 'PERSONNEL_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  root_allowed := (select private.is_root_administrator());
  if require_root and not root_allowed then raise exception 'ROOT_ADMIN_REQUIRED' using errcode = '42501'; end if;
  perform 1 from public.profiles where id = target_user_id for update;
  if not found then raise exception 'PERSONNEL_NOT_FOUND' using errcode = 'P0002'; end if;
  if not root_allowed and (target_user_id = caller_id or (select private.is_current_admin(target_user_id)) or (select private.is_protected_security_principal(target_user_id))) then raise exception 'ROOT_ADMIN_REQUIRED_FOR_ADMIN_ACCOUNT' using errcode = '42501'; end if;
  return query select caller_id, root_allowed;
end; $$;

create or replace function public.begin_personnel_password_reset(target_user_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare actor record; begin
  select * into actor from private.assert_personnel_password_target(target_user_id, false);
  if not exists (select 1 from auth.users where id = target_user_id and (raw_app_meta_data ->> 'provider' = 'email' or raw_app_meta_data -> 'providers' ? 'email') and encrypted_password is not null) then raise exception 'PASSWORD_RESET_NOT_AVAILABLE' using errcode = '22023'; end if;
  update public.profiles set must_change_password = true,
    must_change_password_hash = (select md5(encrypted_password) from auth.users where id = target_user_id)
  where id = target_user_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata) values (actor.actor_id, 'password_reset', 'profile', target_user_id, jsonb_build_object('result', 'pending_auth_update', 'actor_authority', case when actor.actor_is_root then 'root_administrator' else 'personnel_manager' end));
end; $$;

create or replace function public.record_personnel_password_operation(target_user_id uuid, target_action text, target_result text) returns void language plpgsql security definer set search_path = '' as $$
declare actor record; begin
  if target_action not in ('password_reset', 'password_changed_by_root') or target_result not in ('auth_update_succeeded', 'auth_update_failed', 'root_password_changed') then raise exception 'INVALID_PASSWORD_AUDIT_OPERATION' using errcode = '22023'; end if;
  select * into actor from private.assert_personnel_password_target(target_user_id, target_action = 'password_changed_by_root');
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata) values (actor.actor_id, target_action, 'profile', target_user_id, jsonb_build_object('result', target_result, 'actor_authority', case when actor.actor_is_root then 'root_administrator' else 'personnel_manager' end));
end; $$;

create or replace function public.clear_own_must_change_password(target_reason text) returns void language plpgsql security definer set search_path = '' as $$
declare caller_id uuid := (select auth.uid()); profile_row public.profiles%rowtype; begin
  if caller_id is null or target_reason not in ('password_changed', 'password_recovered') then raise exception 'INVALID_PASSWORD_CHANGE_COMPLETION' using errcode = '22023'; end if;
  select * into profile_row from public.profiles where id = caller_id for update;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not profile_row.must_change_password then return; end if;
  if profile_row.must_change_password_hash is null or profile_row.must_change_password_hash is not distinct from (select md5(encrypted_password) from auth.users where id = caller_id) then raise exception 'PASSWORD_CHANGE_NOT_COMPLETED' using errcode = '22023'; end if;
  update public.profiles set must_change_password = false, must_change_password_hash = null where id = caller_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata) values (caller_id, 'password_change_completed', 'profile', caller_id, jsonb_build_object('reason', target_reason));
end; $$;

create or replace function public.reserve_personnel_password_change(target_user_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare actor record; begin
  select * into actor from private.assert_personnel_password_target(target_user_id, true);
  if not exists (select 1 from auth.users where id = target_user_id and (raw_app_meta_data ->> 'provider' = 'email' or raw_app_meta_data -> 'providers' ? 'email') and encrypted_password is not null) then raise exception 'PASSWORD_CHANGE_NOT_AVAILABLE' using errcode = '22023'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata) values (actor.actor_id, 'password_changed_by_root', 'profile', target_user_id, jsonb_build_object('result', 'pending_auth_update', 'actor_authority', 'root_administrator'));
end; $$;

create or replace function private.protect_catalog_type_history() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'rooms' and new.room_type_id is distinct from old.room_type_id and (exists (select 1 from public.class_schedules where room_id = old.id) or exists (select 1 from public.basic_medical_registrations where room_id = old.id) or exists (select 1 from public.basic_medical_room_inventory where room_id = old.id)) then raise exception 'ROOM_TYPE_CHANGE_HAS_HISTORY' using errcode = '23503'; end if;
  if tg_table_name = 'courses' and new.room_type_id is distinct from old.room_type_id and (exists (select 1 from public.class_schedules where course_id = old.id) or exists (select 1 from public.basic_medical_registrations where course_id = old.id)) then raise exception 'COURSE_TYPE_CHANGE_HAS_HISTORY' using errcode = '23503'; end if;
  return new;
end; $$;
drop trigger if exists rooms_protect_type_history on public.rooms;
create trigger rooms_protect_type_history before update of room_type_id on public.rooms for each row execute function private.protect_catalog_type_history();
drop trigger if exists courses_protect_type_history on public.courses;
create trigger courses_protect_type_history before update of room_type_id on public.courses for each row execute function private.protect_catalog_type_history();

create or replace function private.assert_catalog_batch_ids(target_ids uuid[]) returns void language plpgsql security definer set search_path = '' as $$ begin
  if not (select private.is_admin()) then raise exception 'ADMIN_REQUIRED' using errcode = '42501'; end if;
  if target_ids is null or cardinality(target_ids) < 1 or cardinality(target_ids) > 200 or cardinality(target_ids) <> (select count(distinct value) from unnest(target_ids) value) then raise exception 'INVALID_CATALOG_BATCH_IDS' using errcode = '22023'; end if;
end; $$;

create or replace function public.set_catalog_rooms_active(target_ids uuid[], target_is_active boolean) returns integer language plpgsql security definer set search_path = '' as $$
declare changed_count integer; begin
  perform private.assert_catalog_batch_ids(target_ids); perform 1 from public.rooms where id = any(target_ids) for update;
  if (select count(*) from public.rooms where id = any(target_ids)) <> cardinality(target_ids) then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.rooms set is_active = target_is_active where id = any(target_ids) and is_active is distinct from target_is_active; get diagnostics changed_count = row_count; return changed_count;
end; $$;

create or replace function public.set_catalog_courses_active(target_ids uuid[], target_is_active boolean) returns integer language plpgsql security definer set search_path = '' as $$
declare changed_count integer; begin
  perform private.assert_catalog_batch_ids(target_ids); perform 1 from public.courses where id = any(target_ids) for update;
  if (select count(*) from public.courses where id = any(target_ids)) <> cardinality(target_ids) then raise exception 'COURSE_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.courses set is_active = target_is_active where id = any(target_ids) and is_active is distinct from target_is_active; get diagnostics changed_count = row_count; return changed_count;
end; $$;

create or replace function public.update_catalog_room(target_id uuid, target_room_code text, target_building_code text, target_room_name text, target_capacity integer, target_room_type_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare current_room public.rooms%rowtype; begin
  perform private.assert_catalog_batch_ids(array[target_id]); select * into current_room from public.rooms where id = target_id for update; if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002'; end if;
  if nullif(btrim(target_room_code), '') is null or nullif(btrim(target_building_code), '') is null or target_capacity is not null and target_capacity < 0 then raise exception 'INVALID_ROOM_VALUES' using errcode = '22023'; end if;
  if not exists (select 1 from public.room_types where id = target_room_type_id and is_active) then raise exception 'INVALID_ROOM_TYPE' using errcode = '22023'; end if;
  if current_room.room_type_id is distinct from target_room_type_id and (exists (select 1 from public.class_schedules where room_id = target_id) or exists (select 1 from public.basic_medical_registrations where room_id = target_id) or exists (select 1 from public.basic_medical_room_inventory where room_id = target_id)) then raise exception 'ROOM_TYPE_CHANGE_HAS_HISTORY' using errcode = '23503'; end if;
  update public.rooms set room_code=btrim(target_room_code), building_code=btrim(target_building_code), room_name=nullif(btrim(target_room_name), ''), capacity=target_capacity, room_type_id=target_room_type_id where id=target_id;
end; $$;

create or replace function public.update_catalog_course(target_id uuid, target_course_code text, target_course_name text, target_room_type_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare current_course public.courses%rowtype; begin
  perform private.assert_catalog_batch_ids(array[target_id]); select * into current_course from public.courses where id=target_id for update; if not found then raise exception 'COURSE_NOT_FOUND' using errcode = 'P0002'; end if;
  if nullif(btrim(target_course_code), '') is null or nullif(btrim(target_course_name), '') is null then raise exception 'INVALID_COURSE_VALUES' using errcode = '22023'; end if;
  if not exists (select 1 from public.room_types where id=target_room_type_id and is_active) then raise exception 'INVALID_ROOM_TYPE' using errcode = '22023'; end if;
  if current_course.room_type_id is distinct from target_room_type_id and (exists (select 1 from public.class_schedules where course_id=target_id) or exists (select 1 from public.basic_medical_registrations where course_id=target_id)) then raise exception 'COURSE_TYPE_CHANGE_HAS_HISTORY' using errcode = '23503'; end if;
  update public.courses set course_code=btrim(target_course_code), course_name=btrim(target_course_name), room_type_id=target_room_type_id where id=target_id;
end; $$;

create or replace function public.apply_catalog_course_import(target_rows jsonb) returns integer language plpgsql security definer set search_path = '' as $$
declare item jsonb; changed_count integer := 0; target_id uuid; begin
  if not (select private.is_admin()) or jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) < 1 or jsonb_array_length(target_rows) > 5000 then raise exception 'INVALID_CATALOG_IMPORT' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(target_rows) as rows(row_json) left join public.room_types types on types.id = (rows.row_json->>'room_type_id')::uuid where nullif(btrim(rows.row_json->>'course_code'), '') is null or nullif(btrim(rows.row_json->>'course_name'), '') is null or types.id is null or not types.is_active) or (select count(*) from (select lower(btrim(rows.row_json->>'course_code')) from jsonb_array_elements(target_rows) rows(row_json) group by 1 having count(*) > 1) duplicates) > 0 then raise exception 'INVALID_CATALOG_IMPORT' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(target_rows) loop
    target_id := nullif(item->>'id', '')::uuid;
    if target_id is null then insert into public.courses(course_code, course_name, room_type_id) values (btrim(item->>'course_code'), btrim(item->>'course_name'), (item->>'room_type_id')::uuid); else perform public.update_catalog_course(target_id, item->>'course_code', item->>'course_name', (item->>'room_type_id')::uuid); end if;
    changed_count := changed_count + 1;
  end loop; return changed_count;
end; $$;

create or replace function public.apply_catalog_room_import(target_rows jsonb) returns integer language plpgsql security definer set search_path = '' as $$
declare item jsonb; changed_count integer := 0; target_id uuid; begin
  if not (select private.is_admin()) or jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) < 1 or jsonb_array_length(target_rows) > 5000 then raise exception 'INVALID_CATALOG_IMPORT' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(target_rows) as rows(row_json) left join public.room_types types on types.id = (rows.row_json->>'room_type_id')::uuid where nullif(btrim(rows.row_json->>'room_code'), '') is null or nullif(btrim(rows.row_json->>'building_code'), '') is null or types.id is null or not types.is_active) or (select count(*) from (select lower(btrim(rows.row_json->>'room_code')), lower(btrim(rows.row_json->>'building_code')) from jsonb_array_elements(target_rows) rows(row_json) group by 1, 2 having count(*) > 1) duplicates) > 0 then raise exception 'INVALID_CATALOG_IMPORT' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(target_rows) loop
    target_id := nullif(item->>'id', '')::uuid;
    if target_id is null then insert into public.rooms(room_code, building_code, room_name, room_type_id, capacity) values (btrim(item->>'room_code'), btrim(item->>'building_code'), nullif(btrim(item->>'room_name'), ''), (item->>'room_type_id')::uuid, nullif(item->>'capacity', '')::integer); else perform public.update_catalog_room(target_id, item->>'room_code', item->>'building_code', coalesce(item->>'room_name',''), nullif(item->>'capacity','')::integer, (item->>'room_type_id')::uuid); end if;
    changed_count := changed_count + 1;
  end loop; return changed_count;
end; $$;

create or replace function public.update_catalog_rooms_batch(target_rows jsonb) returns integer language plpgsql security definer set search_path = '' as $$
declare item jsonb; changed_count integer := 0; begin
  if jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) < 1 or jsonb_array_length(target_rows) > 200 then raise exception 'INVALID_CATALOG_BATCH' using errcode = '22023'; end if;
  if not (select private.is_admin()) or (select count(*) from (select rows.row_json->>'id' from jsonb_array_elements(target_rows) rows(row_json) group by 1 having count(*) > 1) duplicates) > 0 or exists (select 1 from jsonb_array_elements(target_rows) rows(row_json) left join public.rooms rooms on rooms.id = (rows.row_json->>'id')::uuid left join public.room_types types on types.id = (rows.row_json->>'room_type_id')::uuid where rooms.id is null or types.id is null or not types.is_active or nullif(btrim(rows.row_json->>'room_code'), '') is null or nullif(btrim(rows.row_json->>'building_code'), '') is null) then raise exception 'INVALID_CATALOG_BATCH' using errcode = '22023'; end if;
  perform 1 from public.rooms where id in (select (rows.row_json->>'id')::uuid from jsonb_array_elements(target_rows) rows(row_json)) order by id for update;
  for item in select value from jsonb_array_elements(target_rows) loop perform public.update_catalog_room((item->>'id')::uuid, item->>'room_code', item->>'building_code', coalesce(item->>'room_name',''), nullif(item->>'capacity','')::integer, (item->>'room_type_id')::uuid); changed_count := changed_count + 1; end loop; return changed_count;
end; $$;
create or replace function public.update_catalog_courses_batch(target_rows jsonb) returns integer language plpgsql security definer set search_path = '' as $$
declare item jsonb; changed_count integer := 0; begin
  if jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) < 1 or jsonb_array_length(target_rows) > 200 then raise exception 'INVALID_CATALOG_BATCH' using errcode = '22023'; end if;
  if not (select private.is_admin()) or (select count(*) from (select rows.row_json->>'id' from jsonb_array_elements(target_rows) rows(row_json) group by 1 having count(*) > 1) duplicates) > 0 or exists (select 1 from jsonb_array_elements(target_rows) rows(row_json) left join public.courses courses on courses.id = (rows.row_json->>'id')::uuid left join public.room_types types on types.id = (rows.row_json->>'room_type_id')::uuid where courses.id is null or types.id is null or not types.is_active or nullif(btrim(rows.row_json->>'course_code'), '') is null or nullif(btrim(rows.row_json->>'course_name'), '') is null) then raise exception 'INVALID_CATALOG_BATCH' using errcode = '22023'; end if;
  perform 1 from public.courses where id in (select (rows.row_json->>'id')::uuid from jsonb_array_elements(target_rows) rows(row_json)) order by id for update;
  for item in select value from jsonb_array_elements(target_rows) loop perform public.update_catalog_course((item->>'id')::uuid, item->>'course_code', item->>'course_name', (item->>'room_type_id')::uuid); changed_count := changed_count + 1; end loop; return changed_count;
end; $$;

revoke all on function private.assert_personnel_password_target(uuid, boolean) from public, anon, authenticated;
revoke all on function private.assert_catalog_batch_ids(uuid[]) from public, anon, authenticated;
revoke all on function private.protect_catalog_type_history() from public, anon, authenticated;
revoke all on function public.begin_personnel_password_reset(uuid) from public, anon;
revoke all on function public.record_personnel_password_operation(uuid, text, text) from public, anon;
revoke all on function public.clear_own_must_change_password(text) from public, anon;
revoke all on function public.reserve_personnel_password_change(uuid) from public, anon;
revoke all on function public.set_catalog_rooms_active(uuid[], boolean) from public, anon;
revoke all on function public.set_catalog_courses_active(uuid[], boolean) from public, anon;
revoke all on function public.update_catalog_room(uuid, text, text, text, integer, uuid) from public, anon;
revoke all on function public.update_catalog_course(uuid, text, text, uuid) from public, anon;
revoke all on function public.apply_catalog_course_import(jsonb), public.apply_catalog_room_import(jsonb) from public, anon;
revoke all on function public.update_catalog_rooms_batch(jsonb), public.update_catalog_courses_batch(jsonb) from public, anon;
grant execute on function public.begin_personnel_password_reset(uuid), public.record_personnel_password_operation(uuid, text, text), public.reserve_personnel_password_change(uuid), public.clear_own_must_change_password(text), public.set_catalog_rooms_active(uuid[], boolean), public.set_catalog_courses_active(uuid[], boolean), public.update_catalog_room(uuid, text, text, text, integer, uuid), public.update_catalog_course(uuid, text, text, uuid), public.apply_catalog_course_import(jsonb), public.apply_catalog_room_import(jsonb), public.update_catalog_rooms_batch(jsonb), public.update_catalog_courses_batch(jsonb) to authenticated;


-- Source: supabase/schemas/18_basic_medical_catalog_identity.sql
-- Basic Medical catalog identity is the normalized commercial name, including
-- inactive rows. Preflight is deliberately fail-closed: no historical catalog
-- identity is guessed, merged, renamed, or deleted during deployment.
do $$
declare
  invalid_row_count integer;
  duplicate_group_count integer;
begin
  select count(*) into invalid_row_count
  from public.basic_medical_equipment_catalog
  where commercial_name is null or btrim(commercial_name) = '';

  if invalid_row_count > 0 then
    raise exception
      'basic_medical_equipment_catalog commercial_name identity preflight failed: % null or blank rows',
      invalid_row_count using errcode = '23514';
  end if;

  select count(*) into duplicate_group_count
  from (
    select lower(btrim(commercial_name))
    from public.basic_medical_equipment_catalog
    group by lower(btrim(commercial_name))
    having count(*) > 1
  ) duplicate_groups;

  if duplicate_group_count > 0 then
    raise exception
      'basic_medical_equipment_catalog commercial_name identity preflight failed: % duplicate normalized commercial names',
      duplicate_group_count using errcode = '23505';
  end if;
end;
$$;

alter table public.basic_medical_equipment_catalog
  drop constraint if exists basic_medical_equipment_catal_item_name_commercial_name_mod_key;

alter table public.basic_medical_equipment_catalog
  alter column commercial_name set not null;

alter table public.basic_medical_equipment_catalog
  add constraint basic_medical_catalog_commercial_name_not_blank
  check (btrim(commercial_name) <> '');

create unique index basic_medical_catalog_commercial_name_normalized_key
  on public.basic_medical_equipment_catalog (lower(btrim(commercial_name)));

create or replace function public.apply_basic_medical_catalog_import(
  target_mode text,
  target_rows jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  item jsonb;
  normalized_rows jsonb := '[]'::jsonb;
  item_name_value text;
  commercial_name_value text;
  normalized_commercial_name text;
  unit_value text;
  commercial_names text[] := '{}'::text[];
  current_id uuid;
  inserted_count integer := 0;
  updated_count integer := 0;
  inactivated_count integer := 0;
begin
  if not (select private.can_manage_basic_medical()) then
    raise exception 'BASIC_MEDICAL_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  if target_mode not in ('new','all') or target_rows is null
    or jsonb_typeof(target_rows) <> 'array'
    or jsonb_array_length(target_rows) not between 1 and 5000 then
    raise exception 'INVALID_BASIC_MEDICAL_CATALOG_IMPORT' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(target_rows)
  loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'INVALID_BASIC_MEDICAL_CATALOG_IMPORT_ROW' using errcode = '22023';
    end if;
    item_name_value := btrim(coalesce(item->>'item_name', ''));
    commercial_name_value := btrim(coalesce(item->>'commercial_name', ''));
    normalized_commercial_name := lower(commercial_name_value);
    unit_value := btrim(coalesce(item->>'unit', ''));
    if item_name_value = '' or commercial_name_value = '' or unit_value = '' then
      raise exception 'BASIC_MEDICAL_CATALOG_ITEM_COMMERCIAL_NAME_AND_UNIT_REQUIRED'
        using errcode = '22023';
    end if;
    if normalized_commercial_name = any(commercial_names) then
      raise exception 'DUPLICATE_BASIC_MEDICAL_CATALOG_IMPORT_COMMERCIAL_NAME'
        using errcode = '22023';
    end if;
    commercial_names := array_append(commercial_names, normalized_commercial_name);
    normalized_rows := normalized_rows || jsonb_build_array(jsonb_build_object(
      'item_name', item_name_value,
      'commercial_name', commercial_name_value,
      'normalized_commercial_name', normalized_commercial_name,
      'item_type', nullif(btrim(coalesce(item->>'item_type', '')), ''),
      'country_of_origin', nullif(btrim(coalesce(item->>'country_of_origin', '')), ''),
      'manufacturer', nullif(btrim(coalesce(item->>'manufacturer', '')), ''),
      'model', nullif(btrim(coalesce(item->>'model', '')), ''),
      'unit', unit_value
    ));
  end loop;

  for item in select value from jsonb_array_elements(normalized_rows)
  loop
    select catalog.id into current_id
    from public.basic_medical_equipment_catalog catalog
    where lower(btrim(catalog.commercial_name)) = item->>'normalized_commercial_name'
    for update;

    if current_id is null then
      insert into public.basic_medical_equipment_catalog(
        item_name, commercial_name, item_type, country_of_origin,
        manufacturer, model, unit, is_active
      ) values (
        item->>'item_name', item->>'commercial_name', nullif(item->>'item_type',''),
        nullif(item->>'country_of_origin',''), nullif(item->>'manufacturer',''),
        nullif(item->>'model',''), item->>'unit', true
      );
      inserted_count := inserted_count + 1;
    elsif target_mode = 'all' then
      update public.basic_medical_equipment_catalog
      set item_name = item->>'item_name', commercial_name = item->>'commercial_name',
          item_type = nullif(item->>'item_type',''), country_of_origin = nullif(item->>'country_of_origin',''),
          manufacturer = nullif(item->>'manufacturer',''), model = nullif(item->>'model',''),
          unit = item->>'unit', is_active = true
      where id = current_id;
      updated_count := updated_count + 1;
    end if;
  end loop;

  if target_mode = 'all' then
    update public.basic_medical_equipment_catalog catalog
    set is_active = false
    where catalog.is_active
      and not (lower(btrim(catalog.commercial_name)) = any(commercial_names));
    get diagnostics inactivated_count = row_count;
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, metadata)
  values (actor_id, 'basic_medical.catalog_imported', 'basic_medical_equipment_catalog',
    jsonb_build_object('mode', target_mode, 'inserted', inserted_count,
      'updated', updated_count, 'inactivated', inactivated_count));
  return jsonb_build_object('inserted', inserted_count, 'updated', updated_count,
    'inactivated', inactivated_count,
    'processed', inserted_count + updated_count);
end;
$$;

revoke all on function public.apply_basic_medical_catalog_import(text,jsonb) from public, anon;
grant execute on function public.apply_basic_medical_catalog_import(text,jsonb) to authenticated;


-- Source: supabase/schemas/19_basic_medical_confirmation_display_snapshots.sql
-- Declarative final state for immutable, human-readable confirmation evidence.

alter table public.basic_medical_session_confirmations
  add column if not exists course_code_snapshot text,
  add column if not exists course_name_snapshot text,
  add column if not exists room_code_snapshot text,
  add column if not exists building_code_snapshot text,
  add column if not exists room_name_snapshot text,
  add column if not exists teaching_lecturer_name_snapshot text,
  add column if not exists signer_name_snapshot text;

create or replace function private.capture_basic_medical_confirmation_display_snapshots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  schedule_row record;
begin
  if new.session_id is null then
    return new;
  end if;

  select schedules.course_code_snapshot,
         schedules.course_name_snapshot,
         rooms.room_code,
         rooms.building_code,
         rooms.room_name,
         teaching.full_name as teaching_lecturer_name,
         signer.full_name as signer_name
  into schedule_row
  from public.class_schedules as schedules
  join public.rooms as rooms on rooms.id = schedules.room_id
  join public.profiles as teaching on teaching.id = new.teaching_lecturer_id_snapshot
  join public.profiles as signer on signer.id = new.signer_id
  where schedules.id = new.class_schedule_id_snapshot;

  if schedule_row.course_code_snapshot is null
    or schedule_row.course_name_snapshot is null
    or schedule_row.room_code is null
    or schedule_row.building_code is null
    or schedule_row.teaching_lecturer_name is null
    or schedule_row.signer_name is null then
    raise exception 'Không thể chụp thông tin hiển thị của bằng chứng xác nhận.'
      using errcode = 'P0002';
  end if;

  new.course_code_snapshot := schedule_row.course_code_snapshot;
  new.course_name_snapshot := schedule_row.course_name_snapshot;
  new.room_code_snapshot := schedule_row.room_code;
  new.building_code_snapshot := schedule_row.building_code;
  new.room_name_snapshot := schedule_row.room_name;
  new.teaching_lecturer_name_snapshot := schedule_row.teaching_lecturer_name;
  new.signer_name_snapshot := schedule_row.signer_name;
  return new;
end;
$$;

drop trigger if exists basic_medical_confirmation_display_snapshots
  on public.basic_medical_session_confirmations;
create trigger basic_medical_confirmation_display_snapshots
before insert on public.basic_medical_session_confirmations
for each row execute function private.capture_basic_medical_confirmation_display_snapshots();

revoke all on function private.capture_basic_medical_confirmation_display_snapshots()
  from public, anon, authenticated;

create or replace function public.get_basic_medical_confirmation_evidence(
  target_confirmation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  evidence jsonb;
begin
  select jsonb_build_object(
    'confirmation_id', confirmations.id,
    'registration_id_snapshot', confirmations.registration_id_snapshot,
    'class_schedule_id_snapshot', confirmations.class_schedule_id_snapshot,
    'signer_id', confirmations.signer_id,
    'signature_data', confirmations.signature_data,
    'schedule_date_snapshot', confirmations.schedule_date_snapshot,
    'start_time_snapshot', confirmations.start_time_snapshot,
    'end_time_snapshot', confirmations.end_time_snapshot,
    'room_id_snapshot', confirmations.room_id_snapshot,
    'teaching_lecturer_id_snapshot', confirmations.teaching_lecturer_id_snapshot,
    'course_code_snapshot', confirmations.course_code_snapshot,
    'course_name_snapshot', confirmations.course_name_snapshot,
    'room_code_snapshot', confirmations.room_code_snapshot,
    'building_code_snapshot', confirmations.building_code_snapshot,
    'room_name_snapshot', confirmations.room_name_snapshot,
    'teaching_lecturer_name_snapshot', confirmations.teaching_lecturer_name_snapshot,
    'signer_name_snapshot', confirmations.signer_name_snapshot,
    'display_snapshots_available', confirmations.course_code_snapshot is not null
      and confirmations.course_name_snapshot is not null
      and confirmations.room_code_snapshot is not null
      and confirmations.building_code_snapshot is not null
      and confirmations.teaching_lecturer_name_snapshot is not null
      and confirmations.signer_name_snapshot is not null,
    'signed_at', confirmations.signed_at,
    'invalidated_at', confirmations.invalidated_at,
    'invalidated_reason', confirmations.invalidated_reason,
    'equipment_checks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'inventory_id', checks.inventory_id,
          'item_name_snapshot', checks.item_name_snapshot,
          'commercial_name_snapshot', checks.commercial_name_snapshot,
          'unit_snapshot', checks.unit_snapshot,
          'total_before', checks.total_before,
          'good_before', checks.good_before,
          'damaged_before', checks.damaged_before,
          'newly_damaged_quantity', checks.newly_damaged_quantity,
          'total_after', checks.total_before,
          'good_after', checks.good_after,
          'damaged_after', checks.damaged_after
        ) order by checks.item_name_snapshot, checks.inventory_id
      )
      from public.basic_medical_session_equipment_checks as checks
      where checks.confirmation_id = confirmations.id
    ), '[]'::jsonb)
  )
  into evidence
  from public.basic_medical_session_confirmations as confirmations
  where confirmations.id = target_confirmation_id
    and (select private.can_view_basic_medical_registration(
      confirmations.registration_id_snapshot
    ));

  if evidence is null then
    raise exception 'CONFIRMATION_EVIDENCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  return evidence;
end;
$$;

revoke all on function public.get_basic_medical_confirmation_evidence(uuid)
  from public, anon;
grant execute on function public.get_basic_medical_confirmation_evidence(uuid)
  to authenticated;


-- Source: supabase/schemas/20_operations_integrity_master_batch.sql
-- Operations Integrity Master Batch.  This migration is intentionally forward
-- only; it hardens authority at the database boundary before UI changes use it.

alter table public.basic_medical_registration_sessions
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancellation_reason text;

alter table public.basic_medical_session_confirmations
  add column if not exists invalidated_by uuid references public.profiles(id) on delete set null,
  add column if not exists invalidated_by_name_snapshot text;

grant select (invalidated_at, invalidated_by, invalidated_by_name_snapshot, invalidated_reason)
on public.basic_medical_session_confirmations to authenticated;

-- A root administrator is a security principal, never an operational assignee.
create or replace function private.is_operationally_assignable(target_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = target_profile_id and p.is_active
      and not exists (
        select 1 from public.system_security_principals principals
        where principals.singleton and principals.root_admin_id = p.id
      )
  );
$$;

create or replace function private.assert_operationally_assignable(target_profile_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select private.is_operationally_assignable(target_profile_id)) then
    raise exception 'ROOT_ADMIN_OPERATIONAL_ASSIGNMENT_FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.guard_operational_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
begin
  target_id := nullif(to_jsonb(new)->>tg_argv[0], '')::uuid;
  -- Some assignment columns are intentionally nullable while a class is
  -- unassigned.  Only an actual future assignee is subject to the Root ban.
  if target_id is not null then
    perform private.assert_operationally_assignable(target_id);
  end if;
  return new;
end;
$$;

drop trigger if exists basic_medical_registration_operational_assignee on public.basic_medical_registrations;
create trigger basic_medical_registration_operational_assignee
before insert or update of responsible_lecturer_id on public.basic_medical_registrations
for each row execute function private.guard_operational_assignment('responsible_lecturer_id');
drop trigger if exists basic_medical_session_operational_assignee on public.basic_medical_registration_sessions;
create trigger basic_medical_session_operational_assignee
before insert or update of teaching_lecturer_id on public.basic_medical_registration_sessions
for each row execute function private.guard_operational_assignment('teaching_lecturer_id');
drop trigger if exists class_schedule_operational_lecturer on public.class_schedules;
create trigger class_schedule_operational_lecturer
before insert or update of lecturer_id on public.class_schedules
for each row execute function private.guard_operational_assignment('lecturer_id');
drop trigger if exists class_schedule_operational_second_lecturer on public.class_schedules;
create trigger class_schedule_operational_second_lecturer
before insert or update of lecturer_2_id on public.class_schedules
for each row execute function private.guard_operational_assignment('lecturer_2_id');
drop trigger if exists staff_shift_operational_assignee on public.staff_shifts;
create trigger staff_shift_operational_assignee
before insert or update of staff_id on public.staff_shifts
for each row execute function private.guard_operational_assignment('staff_id');
drop trigger if exists equipment_request_operational_responsible on public.equipment_requests;
create trigger equipment_request_operational_responsible
before insert or update of responsible_lecturer_id on public.equipment_requests
for each row execute function private.guard_operational_assignment('responsible_lecturer_id');

create or replace function public.list_operational_people()
returns table (id uuid, full_name text, title text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.is_active_user()) then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  return query
  select profiles.id, profiles.full_name, profiles.title
  from public.profiles profiles
  where (select private.is_operationally_assignable(profiles.id))
    and ((select private.is_admin()) or exists (
      select 1 from public.profile_room_types viewer_scope
      join public.profile_room_types person_scope on person_scope.room_type_id = viewer_scope.room_type_id
      where viewer_scope.profile_id = (select auth.uid()) and person_scope.profile_id = profiles.id
    ))
  order by profiles.full_name;
end;
$$;

-- Shift assignment is a narrower directory than the generic active-person
-- lookup.  It shares the same Root-exclusion predicate used by the triggers,
-- so the UI can never offer an assignee that the database will reject.
create or replace function public.list_operational_shift_assignees()
returns table (id uuid, full_name text, title text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.is_active_user()) then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  return query
  select profiles.id, profiles.full_name, profiles.title
  from public.profiles profiles
  where (select private.is_operationally_assignable(profiles.id))
    and exists (
      select 1 from public.user_roles roles
      where roles.user_id = profiles.id and roles.role in ('staff', 'admin')
    )
  order by profiles.full_name;
end;
$$;

-- Keep legacy role/scope directories aligned with the Root assignment guard.
-- These are used by schedule forms and spreadsheet import previews, so a Root
-- account must never be rendered as an operational choice only to fail later.
create or replace function public.list_scoped_lecturers(target_room_type_id uuid)
returns table (id uuid, full_name text, title text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.has_room_type(target_room_type_id)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  return query
  select profiles.id, profiles.full_name, profiles.title
  from public.profiles as profiles
  where (select private.is_operationally_assignable(profiles.id))
    and exists (select 1 from public.user_roles roles where roles.user_id = profiles.id and roles.role = 'lecturer')
    and exists (select 1 from public.profile_room_types assignments where assignments.profile_id = profiles.id and assignments.room_type_id = target_room_type_id)
  order by profiles.full_name;
end;
$$;

create or replace function public.list_scoped_import_lecturers(target_room_type_id uuid)
returns table (id uuid, full_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.can_import_schedules(target_room_type_id)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  return query
  select profiles.id, profiles.full_name, profiles.email
  from public.profiles as profiles
  where (select private.is_operationally_assignable(profiles.id))
    and exists (select 1 from public.user_roles roles where roles.user_id = profiles.id and roles.role = 'lecturer')
    and exists (select 1 from public.profile_room_types assignments where assignments.profile_id = profiles.id and assignments.room_type_id = target_room_type_id)
  order by profiles.full_name;
end;
$$;

create or replace function public.list_basic_medical_instructors()
returns table (id uuid, full_name text, title text)
language plpgsql stable security definer set search_path = '' as $$
declare basic_medical_room_type_id constant uuid := '40000000-0000-0000-0000-000000000002'::uuid;
begin
  if not (select private.has_room_type(basic_medical_room_type_id)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  return query
  select profiles.id, profiles.full_name, profiles.title
  from public.profiles as profiles
  where (select private.is_operationally_assignable(profiles.id))
    and exists (select 1 from public.user_roles roles where roles.user_id = profiles.id and roles.role = 'lecturer')
    and exists (select 1 from public.profile_room_types assignments where assignments.profile_id = profiles.id and assignments.room_type_id = basic_medical_room_type_id)
  order by profiles.full_name;
end;
$$;

create or replace function public.list_import_lecturers()
returns table (id uuid, full_name text, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.can_create_schedule_entries()) then
    raise exception 'SCHEDULE_CREATOR_ROLE_REQUIRED' using errcode = '42501';
  end if;
  return query
  select profiles.id, profiles.full_name, profiles.email
  from public.profiles profiles
  where (select private.is_operationally_assignable(profiles.id))
    and exists (select 1 from public.user_roles roles where roles.user_id = profiles.id and roles.role = 'lecturer')
  order by profiles.full_name;
end;
$$;

-- Canonical one-session cancellation.  The registration-wide cancellation RPC
-- remains a separate explicit operation for historical compatibility.
create or replace function public.cancel_basic_medical_session(
  target_session_id uuid,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  session_row public.basic_medical_registration_sessions%rowtype;
  registration_creator_id uuid;
  schedule_id uuid;
  already_cancelled boolean;
  normalized_reason text;
begin
  if actor_id is null or not (select private.is_active_user()) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  normalized_reason := nullif(btrim(coalesce(target_reason, '')), '');
  if normalized_reason is null then
    raise exception 'BASIC_MEDICAL_SESSION_CANCELLATION_REASON_REQUIRED' using errcode = '22023';
  end if;

  select sessions.* into session_row
  from public.basic_medical_registration_sessions as sessions
  where sessions.id = target_session_id
  for update;

  if not found then
    raise exception 'BASIC_MEDICAL_SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select reg.created_by into registration_creator_id
  from public.basic_medical_registrations as reg
  where reg.id = session_row.registration_id;

  -- Authorization check: Admin OR Registration Creator OR Session Teaching Lecturer
  if not (
    (select private.is_admin())
    or registration_creator_id = actor_id
    or session_row.teaching_lecturer_id = actor_id
  ) then
    raise exception 'BASIC_MEDICAL_SESSION_CANCEL_FORBIDDEN' using errcode = '42501';
  end if;

  select schedules.id, schedules.schedule_status = 'cancelled'
  into schedule_id, already_cancelled
  from public.class_schedules as schedules
  where schedules.id = session_row.class_schedule_id
  for update;

  if not found then
    raise exception 'BASIC_MEDICAL_LINKED_SCHEDULE_INCONSISTENT' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.basic_medical_session_confirmations as confirmations
    where confirmations.session_id = target_session_id
      and confirmations.invalidated_at is null
  ) then
    raise exception 'BASIC_MEDICAL_SESSION_CONFIRMATION_INVALIDATION_REQUIRED' using errcode = '22023';
  end if;

  if already_cancelled then
    return jsonb_build_object('session_id', target_session_id, 'cancelled', true, 'idempotent', true);
  end if;

  -- The linked-schedule trigger rejects generic writes. This transaction-local
  -- marker authorizes only this aggregate mutation and rolls back with it.
  perform set_config('app.basic_medical_registration_mutation', 'true', true);

  update public.class_schedules
  set schedule_status = 'cancelled',
      cancelled_at = clock_timestamp(),
      cancelled_by = actor_id
  where id = schedule_id;

  update public.basic_medical_registration_sessions
  set cancelled_at = clock_timestamp(),
      cancelled_by = actor_id,
      cancellation_reason = normalized_reason
  where id = target_session_id;

  perform private.enqueue_basic_medical_schedule_outbox_event(
    schedule_id, 'schedule_cancelled', actor_id, null
  );

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    actor_id,
    'basic_medical.session_cancelled',
    'basic_medical_registration_session',
    target_session_id,
    jsonb_build_object(
      'registration_id', session_row.registration_id,
      'schedule_id', schedule_id,
      'reason', normalized_reason
    )
  );

  return jsonb_build_object('session_id', target_session_id, 'cancelled', true, 'idempotent', false);
end;
$$;

-- Room-inventory writes are an auditable adjustment boundary.  Retain the
-- established function body (including the active target guard) and add the
-- reason guard without reintroducing an earlier implementation.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.set_basic_medical_room_inventory(uuid,uuid,uuid,integer,integer,boolean,text)'::regprocedure)
  into definition;
  if position('BASIC_MEDICAL_INVENTORY_ADJUSTMENT_REASON_REQUIRED' in definition) > 0 then return; end if;
  definition := replace(definition,
    E'begin\n  if actor_id is null',
    E'begin\n  if nullif(btrim(coalesce(target_note, '''')), '''') is null then\n    raise exception ''BASIC_MEDICAL_INVENTORY_ADJUSTMENT_REASON_REQUIRED'' using errcode = ''22023'';\n  end if;\n  if actor_id is null');
  if definition = pg_get_functiondef('public.set_basic_medical_room_inventory(uuid,uuid,uuid,integer,integer,boolean,text)'::regprocedure) then
    raise exception 'BASIC_MEDICAL_INVENTORY_REASON_GUARD_PATCH_FAILED';
  end if;
  execute definition;
end;
$$;

create or replace function public.invalidate_basic_medical_session_confirmation(
  target_confirmation_id uuid,
  target_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  confirmation_row public.basic_medical_session_confirmations%rowtype;
  actor_name text;
begin
  if actor_id is null or not (select private.is_admin()) then raise exception 'ADMIN_REQUIRED' using errcode = '42501'; end if;
  if nullif(btrim(coalesce(target_reason, '')), '') is null then raise exception 'BASIC_MEDICAL_CONFIRMATION_INVALIDATION_REASON_REQUIRED' using errcode = '22023'; end if;
  select * into confirmation_row from public.basic_medical_session_confirmations where id = target_confirmation_id for update;
  if not found then raise exception 'BASIC_MEDICAL_CONFIRMATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if confirmation_row.invalidated_at is not null then
    return jsonb_build_object('confirmation_id', target_confirmation_id, 'invalidated', true, 'idempotent', true);
  end if;
  select full_name into actor_name from public.profiles where id = actor_id;
  update public.basic_medical_session_confirmations set invalidated_at = clock_timestamp(), invalidated_by = actor_id,
    invalidated_by_name_snapshot = coalesce(nullif(btrim(actor_name), ''), 'Quản trị viên'),
    invalidated_reason = btrim(target_reason) where id = target_confirmation_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (actor_id, 'basic_medical.confirmation_invalidated', 'basic_medical_session_confirmation', target_confirmation_id,
    jsonb_build_object('session_id', confirmation_row.session_id, 'reason', btrim(target_reason)));
  return jsonb_build_object('confirmation_id', target_confirmation_id, 'invalidated', true, 'idempotent', false);
end;
$$;

-- Calendar administrators need confirmation state to choose the canonical
-- cancel versus invalidation action.  Keep this a narrow, Admin-only read
-- contract rather than broadening confirmation-table or signature access.
create or replace function public.list_basic_medical_schedule_confirmation_states(
  target_schedule_ids uuid[]
)
returns table (
  class_schedule_id uuid,
  session_id uuid,
  confirmation_id uuid,
  signed_at timestamptz,
  signer_name_snapshot text,
  invalidated_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (select private.is_admin()) then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if coalesce(cardinality(target_schedule_ids), 0) > 500 then
    raise exception 'INVALID_BASIC_MEDICAL_SCHEDULE_BATCH' using errcode = '22023';
  end if;
  return query
  select sessions.class_schedule_id, sessions.id, confirmations.id,
    confirmations.signed_at, confirmations.signer_name_snapshot,
    confirmations.invalidated_at
  from public.basic_medical_registration_sessions sessions
  left join public.basic_medical_session_confirmations confirmations
    on confirmations.session_id = sessions.id
  where sessions.class_schedule_id = any(target_schedule_ids)
  order by sessions.class_schedule_id, confirmations.signed_at nulls last;
end;
$$;

create or replace function public.get_basic_medical_confirmation_evidence(target_confirmation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare evidence jsonb;
begin
  select jsonb_build_object(
    'confirmation_id', confirmations.id, 'registration_id_snapshot', confirmations.registration_id_snapshot,
    'class_schedule_id_snapshot', confirmations.class_schedule_id_snapshot, 'signer_id', confirmations.signer_id,
    'signature_data', confirmations.signature_data, 'schedule_date_snapshot', confirmations.schedule_date_snapshot,
    'start_time_snapshot', confirmations.start_time_snapshot, 'end_time_snapshot', confirmations.end_time_snapshot,
    'room_id_snapshot', confirmations.room_id_snapshot, 'teaching_lecturer_id_snapshot', confirmations.teaching_lecturer_id_snapshot,
    'course_code_snapshot', confirmations.course_code_snapshot, 'course_name_snapshot', confirmations.course_name_snapshot,
    'room_code_snapshot', confirmations.room_code_snapshot, 'building_code_snapshot', confirmations.building_code_snapshot,
    'room_name_snapshot', confirmations.room_name_snapshot, 'teaching_lecturer_name_snapshot', confirmations.teaching_lecturer_name_snapshot,
    'signer_name_snapshot', confirmations.signer_name_snapshot,
    'display_snapshots_available', confirmations.course_code_snapshot is not null and confirmations.course_name_snapshot is not null
      and confirmations.room_code_snapshot is not null and confirmations.building_code_snapshot is not null
      and confirmations.teaching_lecturer_name_snapshot is not null and confirmations.signer_name_snapshot is not null,
    'signed_at', confirmations.signed_at, 'invalidated_at', confirmations.invalidated_at,
    'invalidated_by', confirmations.invalidated_by, 'invalidated_by_name_snapshot', confirmations.invalidated_by_name_snapshot,
    'invalidated_reason', confirmations.invalidated_reason,
    'equipment_checks', coalesce((select jsonb_agg(jsonb_build_object(
      'inventory_id', checks.inventory_id, 'item_name_snapshot', checks.item_name_snapshot,
      'commercial_name_snapshot', checks.commercial_name_snapshot, 'unit_snapshot', checks.unit_snapshot,
      'total_before', checks.total_before, 'good_before', checks.good_before, 'damaged_before', checks.damaged_before,
      'newly_damaged_quantity', checks.newly_damaged_quantity, 'total_after', checks.total_before,
      'good_after', checks.good_after, 'damaged_after', checks.damaged_after
    ) order by checks.item_name_snapshot, checks.inventory_id) from public.basic_medical_session_equipment_checks checks
    where checks.confirmation_id = confirmations.id), '[]'::jsonb)
  ) into evidence
  from public.basic_medical_session_confirmations confirmations
  where confirmations.id = target_confirmation_id
    and (select private.can_view_basic_medical_registration(confirmations.registration_id_snapshot));
  if evidence is null then raise exception 'CONFIRMATION_EVIDENCE_NOT_FOUND' using errcode = 'P0002'; end if;
  return evidence;
end;
$$;

-- Staff must be explicitly granted this narrow capability; the role alone is insufficient.
alter table public.profiles add column if not exists can_manage_email_notifications boolean not null default false;
create or replace function private.can_manage_email_notifications()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select private.is_admin()) or exists (
    select 1 from public.profiles p join public.user_roles r on r.user_id = p.id and r.role = 'staff'
    where p.id = (select auth.uid()) and p.can_manage_email_notifications
  );
$$;
create or replace function public.set_personnel_email_notification_capability(target_user_id uuid, target_enabled boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare new_access_version integer;
begin
  if not (select private.is_admin()) then raise exception 'ADMIN_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from public.user_roles where user_id = target_user_id and role = 'staff') then
    raise exception 'EMAIL_NOTIFICATION_CAPABILITY_STAFF_REQUIRED' using errcode = '22023';
  end if;
  update public.profiles set can_manage_email_notifications = target_enabled, access_version = access_version + 1
  where id = target_user_id returning access_version into new_access_version;
  if not found then raise exception 'PERSONNEL_NOT_FOUND' using errcode = 'P0002'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values ((select auth.uid()), 'personnel.email_notification_capability_changed', 'profile', target_user_id,
    jsonb_build_object('enabled', target_enabled));
  return new_access_version;
end;
$$;
drop policy if exists email_notifications_admin_select on public.email_notifications;
create policy email_notifications_manager_select on public.email_notifications for select to authenticated
using ((select private.can_manage_email_notifications()));

-- Durable saga state for password changes.  Values deliberately contain no
-- password, reset value, Auth token, or provider secret.
create table if not exists public.personnel_password_operations (
  id uuid primary key default gen_random_uuid(), target_user_id uuid not null references public.profiles(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict, action text not null check (action in ('password_reset','password_changed_by_root')),
  status text not null check (status in ('reserved','auth_update_started','auth_updated','committed','auth_failed','reconciliation_required','resolved','rolled_back')),
  correlation_id uuid not null default gen_random_uuid(), created_at timestamptz not null default clock_timestamp(),
  auth_updated_at timestamptz, committed_at timestamptz, resolved_at timestamptz, last_error text
);
create table if not exists private.personnel_password_auth_evidence (
  operation_id uuid primary key references public.personnel_password_operations(id) on delete cascade,
  auth_password_hash_before text not null,
  auth_update_started_at timestamptz
);
revoke all on private.personnel_password_auth_evidence from public, anon, authenticated;
alter table public.personnel_password_operations enable row level security;
revoke all on public.personnel_password_operations from public, anon, authenticated;

drop index if exists public.personnel_password_operations_one_active_target;
create unique index personnel_password_operations_one_active_target
on public.personnel_password_operations(target_user_id)
where status in ('reserved', 'auth_update_started', 'auth_updated', 'reconciliation_required');

create or replace function private.assert_personnel_password_operation_service()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'PASSWORD_OPERATION_SERVICE_REQUIRED' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.reserve_personnel_password_operation(target_user_id uuid, target_action text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor record;
  operation_id uuid;
begin
  if target_action not in ('password_reset','password_changed_by_root') then raise exception 'INVALID_PASSWORD_OPERATION' using errcode = '22023'; end if;
  select * into actor from private.assert_personnel_password_target(target_user_id, target_action = 'password_changed_by_root');
  if not exists (select 1 from auth.users where id = target_user_id and (raw_app_meta_data ->> 'provider' = 'email' or raw_app_meta_data -> 'providers' ? 'email') and encrypted_password is not null) then
    raise exception 'PASSWORD_CHANGE_NOT_AVAILABLE' using errcode = '22023';
  end if;
  insert into public.personnel_password_operations(target_user_id, actor_id, action, status)
  values(target_user_id, actor.actor_id, target_action, 'reserved') returning id into operation_id;
  insert into private.personnel_password_auth_evidence(operation_id, auth_password_hash_before)
  values(operation_id, (select encrypted_password from auth.users where id = target_user_id));
  return operation_id;
end;
$$;

-- This durable marker is written before the non-transactional Auth call.  If
-- the later result write fails, reconciliation compares the current Auth hash
-- with this pre-call evidence without retaining password material.
create or replace function public.begin_personnel_password_auth_update(target_operation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare operation public.personnel_password_operations%rowtype;
begin
  perform private.assert_personnel_password_operation_service();
  select * into operation from public.personnel_password_operations where id = target_operation_id for update;
  if not found then raise exception 'PASSWORD_OPERATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if operation.status <> 'reserved' or not exists (select 1 from private.personnel_password_auth_evidence where operation_id = target_operation_id) then
    raise exception 'PASSWORD_OPERATION_STATE_INVALID' using errcode = '22023';
  end if;
  update public.personnel_password_operations
  set status = 'auth_update_started', last_error = null
  where id = target_operation_id;
  update private.personnel_password_auth_evidence set auth_update_started_at = clock_timestamp()
  where operation_id = target_operation_id;
end;
$$;

create or replace function public.record_personnel_password_auth_result(target_operation_id uuid, target_auth_succeeded boolean, target_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  operation public.personnel_password_operations%rowtype;
begin
  perform private.assert_personnel_password_operation_service();
  select * into operation from public.personnel_password_operations where id = target_operation_id for update;
  if not found then raise exception 'PASSWORD_OPERATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if operation.status <> 'auth_update_started' then raise exception 'PASSWORD_OPERATION_STATE_INVALID' using errcode = '22023'; end if;
  update public.personnel_password_operations set status = case when target_auth_succeeded then 'auth_updated' else 'auth_failed' end,
    auth_updated_at = case when target_auth_succeeded then clock_timestamp() else null end,
    last_error = case when target_auth_succeeded then null else nullif(btrim(coalesce(target_error, '')), '') end
  where id = target_operation_id;
  if not target_auth_succeeded then
    delete from private.personnel_password_auth_evidence where operation_id = target_operation_id;
  end if;
end;
$$;

create or replace function public.commit_personnel_password_operation(target_operation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  operation public.personnel_password_operations%rowtype;
begin
  perform private.assert_personnel_password_operation_service();
  select * into operation from public.personnel_password_operations where id = target_operation_id for update;
  if not found then raise exception 'PASSWORD_OPERATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if operation.status <> 'auth_updated' then raise exception 'PASSWORD_OPERATION_STATE_INVALID' using errcode = '22023'; end if;
  if operation.action = 'password_reset' then
    update public.profiles set must_change_password = true, must_change_password_hash = (select md5(encrypted_password) from auth.users where id = operation.target_user_id) where id = operation.target_user_id;
  end if;
  update public.personnel_password_operations set status = 'committed', committed_at = clock_timestamp() where id = target_operation_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata) values
    (operation.actor_id, operation.action, 'profile', operation.target_user_id, jsonb_build_object('result', 'committed', 'operation_id', target_operation_id, 'correlation_id', operation.correlation_id));
  delete from private.personnel_password_auth_evidence where operation_id = target_operation_id;
end;
$$;

create or replace function public.mark_personnel_password_reconciliation_required(target_operation_id uuid, target_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  operation public.personnel_password_operations%rowtype;
begin
  perform private.assert_personnel_password_operation_service();
  select * into operation from public.personnel_password_operations where id = target_operation_id for update;
  if not found then raise exception 'PASSWORD_OPERATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if operation.status not in ('reserved','auth_update_started','auth_updated') then raise exception 'PASSWORD_OPERATION_STATE_INVALID' using errcode = '22023'; end if;
  update public.personnel_password_operations set status = 'reconciliation_required', last_error = nullif(btrim(coalesce(target_error, '')), '') where id = target_operation_id;
end;
$$;

-- Fresh reservation and Auth phases may still have an external Auth call in
-- flight.  Only an explicitly compensated operation is immediately safe for
-- reconciliation; crash recovery for any active phase is delayed by this
-- server-owned threshold.  Keeping this decision in Postgres prevents a
-- second Root browser from racing the request that owns the Auth call.
create or replace function private.personnel_password_operation_is_stale(
  operation public.personnel_password_operations
)
returns boolean language sql volatile security definer set search_path = '' as $$
  select case operation.status
    when 'reserved' then operation.created_at <= clock_timestamp() - interval '5 minutes'
    when 'auth_update_started' then coalesce(
      (select evidence.auth_update_started_at
       from private.personnel_password_auth_evidence evidence
       where evidence.operation_id = operation.id),
      operation.created_at
    ) <= clock_timestamp() - interval '5 minutes'
    when 'auth_updated' then coalesce(operation.auth_updated_at, operation.created_at)
      <= clock_timestamp() - interval '5 minutes'
    else false
  end;
$$;

-- A network exception from the Auth Admin API is not proof that the remote
-- password mutation failed: the request can finish after this process has
-- observed the exception. Keep that outcome out of every recovery path until
-- the same durable, server-owned grace period expires. Other explicitly
-- classified reconciliation states are safe to settle immediately because the
-- application knows that Auth was not started, Auth returned, or Auth success
-- was durably recorded before a later commit failed.
create or replace function private.personnel_password_operation_is_recoverable(
  operation public.personnel_password_operations
)
returns boolean language sql volatile security definer set search_path = '' as $$
  select case
    when operation.status in ('reserved', 'auth_update_started', 'auth_updated') then
      private.personnel_password_operation_is_stale(operation)
    when operation.status = 'reconciliation_required' then
      case
        when operation.last_error in ('auth_update_not_started', 'auth_result_recording_failed') then true
        when operation.auth_updated_at is not null then true
        when operation.last_error = 'auth_update_outcome_unknown' then coalesce(
          (select evidence.auth_update_started_at
           from private.personnel_password_auth_evidence evidence
           where evidence.operation_id = operation.id),
          operation.created_at
        ) <= clock_timestamp() - interval '5 minutes'
        else false
      end
    else false
  end;
$$;

-- The Root screen consumes only this service-authorized, server-filtered
-- recovery queue.  It deliberately contains no hashes, Auth error detail,
-- reset values, tokens, or other private evidence.
create or replace function public.list_recoverable_personnel_password_operations()
returns table (
  id uuid,
  correlation_id uuid,
  action text,
  status text,
  created_at timestamptz,
  target_full_name text,
  target_email text
)
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.assert_personnel_password_operation_service();
  return query
  select operations.id, operations.correlation_id, operations.action,
    operations.status, operations.created_at, profiles.full_name, profiles.email
  from public.personnel_password_operations operations
  join public.profiles profiles on profiles.id = operations.target_user_id
  where (select private.personnel_password_operation_is_recoverable(operations))
  order by operations.created_at;
end;
$$;

-- Retry only a durably recorded completed Auth phase or a stale crash
-- recovery.  No password material is accepted, stored, or re-sent here.
create or replace function public.reconcile_personnel_password_operation(target_operation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare operation public.personnel_password_operations%rowtype; current_auth_hash text; evidence private.personnel_password_auth_evidence%rowtype;
begin
  perform private.assert_personnel_password_operation_service();
  select * into operation from public.personnel_password_operations where id = target_operation_id for update;
  if not found then raise exception 'PASSWORD_OPERATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (select private.personnel_password_operation_is_recoverable(operation)) then
    raise exception 'PASSWORD_OPERATION_STILL_IN_PROGRESS' using errcode = '55000';
  end if;
  -- A stale reservation proves Auth was never begun, so it is safe to release
  -- without inspecting an Auth hash.  The same narrow path is used only when
  -- the application durably recorded that beginning the Auth phase failed.
  if operation.status = 'reserved'
    or (operation.status = 'reconciliation_required'
      and operation.auth_updated_at is null
      and operation.last_error = 'auth_update_not_started') then
    update public.personnel_password_operations set status = 'auth_failed', resolved_at = clock_timestamp(),
      last_error = coalesce(last_error, 'auth_update_not_started') where id = target_operation_id;
    delete from private.personnel_password_auth_evidence where operation_id = target_operation_id;
    return jsonb_build_object('operation_id', target_operation_id, 'outcome', 'auth_failed');
  end if;
  if operation.status in ('reserved','auth_update_started','reconciliation_required') and operation.auth_updated_at is null then
    select * into evidence from private.personnel_password_auth_evidence where operation_id = target_operation_id for update;
    if evidence.operation_id is null then raise exception 'PASSWORD_OPERATION_RECONCILIATION_UNSAFE' using errcode = '22023'; end if;
    select encrypted_password into current_auth_hash from auth.users where id = operation.target_user_id;
    if current_auth_hash is not distinct from evidence.auth_password_hash_before then
      update public.personnel_password_operations set status = 'auth_failed', resolved_at = clock_timestamp(),
        last_error = coalesce(last_error, 'auth_update_not_observed') where id = target_operation_id;
      delete from private.personnel_password_auth_evidence where operation_id = target_operation_id;
      return jsonb_build_object('operation_id', target_operation_id, 'outcome', 'auth_failed');
    end if;
    update public.personnel_password_operations set status = 'auth_updated', auth_updated_at = clock_timestamp(),
      last_error = coalesce(last_error, 'auth_result_reconciled_from_pre_auth_evidence') where id = target_operation_id;
    select * into operation from public.personnel_password_operations where id = target_operation_id;
  end if;
  if operation.status not in ('auth_updated','reconciliation_required') or operation.auth_updated_at is null then
    raise exception 'PASSWORD_OPERATION_RECONCILIATION_UNSAFE' using errcode = '22023';
  end if;
  if operation.action = 'password_reset' then
    update public.profiles set must_change_password = true,
      must_change_password_hash = (select md5(encrypted_password) from auth.users where id = operation.target_user_id)
    where id = operation.target_user_id;
  end if;
  update public.personnel_password_operations
  set status = 'committed', committed_at = clock_timestamp(), resolved_at = clock_timestamp(), last_error = null
  where id = target_operation_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata) values
    (operation.actor_id, operation.action, 'profile', operation.target_user_id,
      jsonb_build_object('result', 'reconciled', 'operation_id', target_operation_id, 'correlation_id', operation.correlation_id));
  delete from private.personnel_password_auth_evidence where operation_id = target_operation_id;
  return jsonb_build_object('operation_id', target_operation_id, 'outcome', 'committed');
end;
$$;

-- Fail deployment rather than silently turning zero/negative legacy capacities
-- into another value.
do $$ begin
  if exists (select 1 from public.rooms where capacity is not null and capacity < 1) then
    raise exception 'rooms capacity preflight failed: existing non-null capacity must be >= 1' using errcode = '23514';
  end if;
end $$;
alter table public.rooms drop constraint if exists rooms_capacity_real_or_unknown;
alter table public.rooms add constraint rooms_capacity_real_or_unknown check (capacity is null or capacity >= 1);

create or replace function private.assert_catalog_room_capacity(target_capacity integer)
returns void language plpgsql security definer set search_path = '' as $$
begin if target_capacity is not null and target_capacity < 1 then raise exception 'INVALID_ROOM_CAPACITY' using errcode = '22023'; end if; end;
$$;

-- Override the existing room mutation entry points so every server path shares
-- the same boundary (the table constraint remains the final line of defence).
create or replace function public.update_catalog_room(target_id uuid, target_room_code text, target_building_code text, target_room_name text, target_capacity integer, target_room_type_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  current_room public.rooms%rowtype;
begin
  perform private.assert_catalog_batch_ids(array[target_id]); perform private.assert_catalog_room_capacity(target_capacity);
  select * into current_room from public.rooms where id = target_id for update; if not found then raise exception 'ROOM_NOT_FOUND' using errcode = 'P0002'; end if;
  if nullif(btrim(target_room_code), '') is null or nullif(btrim(target_building_code), '') is null then raise exception 'INVALID_ROOM_VALUES' using errcode = '22023'; end if;
  if not exists (select 1 from public.room_types where id = target_room_type_id and is_active) then raise exception 'INVALID_ROOM_TYPE' using errcode = '22023'; end if;
  if current_room.room_type_id is distinct from target_room_type_id and (exists (select 1 from public.class_schedules where room_id = target_id) or exists (select 1 from public.basic_medical_registrations where room_id = target_id) or exists (select 1 from public.basic_medical_room_inventory where room_id = target_id)) then raise exception 'ROOM_TYPE_CHANGE_HAS_HISTORY' using errcode = '23503'; end if;
  update public.rooms set room_code=btrim(target_room_code), building_code=btrim(target_building_code), room_name=nullif(btrim(target_room_name), ''), capacity=target_capacity, room_type_id=target_room_type_id where id=target_id;
end; $$;

-- Keep the import RPC on the same human-readable capacity boundary as the
-- create, single-edit and batch-edit paths.  The table check below remains the
-- last line of defense for direct writes.
create or replace function public.apply_catalog_room_import(target_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare item jsonb; changed_count integer := 0; target_id uuid;
begin
  if not (select private.is_admin())
    or jsonb_typeof(target_rows) <> 'array'
    or jsonb_array_length(target_rows) < 1
    or jsonb_array_length(target_rows) > 5000 then
    raise exception 'INVALID_CATALOG_IMPORT' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(target_rows) as rows(row_json)
    left join public.room_types types on types.id = (rows.row_json->>'room_type_id')::uuid
    where nullif(btrim(rows.row_json->>'room_code'), '') is null
      or nullif(btrim(rows.row_json->>'building_code'), '') is null
      or types.id is null or not types.is_active
  ) or (select count(*) from (
    select lower(btrim(rows.row_json->>'room_code')), lower(btrim(rows.row_json->>'building_code'))
    from jsonb_array_elements(target_rows) rows(row_json)
    group by 1, 2 having count(*) > 1
  ) duplicates) > 0 then
    raise exception 'INVALID_CATALOG_IMPORT' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(target_rows) rows(row_json)
    where nullif(btrim(rows.row_json->>'capacity'), '') is not null
      and btrim(rows.row_json->>'capacity') !~ '^[1-9][0-9]*$'
  ) then
    raise exception 'INVALID_ROOM_CAPACITY' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(target_rows) loop
    target_id := nullif(item->>'id', '')::uuid;
    if target_id is null then
      insert into public.rooms(room_code, building_code, room_name, room_type_id, capacity)
      values (
        btrim(item->>'room_code'), btrim(item->>'building_code'),
        nullif(btrim(item->>'room_name'), ''), (item->>'room_type_id')::uuid,
        nullif(btrim(item->>'capacity'), '')::integer
      );
    else
      perform public.update_catalog_room(
        target_id, item->>'room_code', item->>'building_code',
        coalesce(item->>'room_name',''), nullif(item->>'capacity','')::integer,
        (item->>'room_type_id')::uuid
      );
    end if;
    changed_count := changed_count + 1;
  end loop;
  return changed_count;
end; $$;

-- A condition adjustment is an accountable operational event.  The existing
-- UI already requires a reason; enforce the same rule for direct RPC callers.
create or replace function public.adjust_basic_medical_inventory_condition(
  target_inventory_id uuid,
  target_good_quantity integer,
  target_damaged_quantity integer,
  target_note text default null
)
returns public.basic_medical_room_inventory
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  current_row public.basic_medical_room_inventory;
  changed_row public.basic_medical_room_inventory;
begin
  if actor_id is null or not (select private.can_manage_basic_medical()) then
    raise exception 'BASIC_MEDICAL_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(target_note, '')), '') is null then
    raise exception 'BASIC_MEDICAL_INVENTORY_ADJUSTMENT_REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into current_row from public.basic_medical_room_inventory where id = target_inventory_id for update;
  if current_row.id is null then raise exception 'BASIC_MEDICAL_INVENTORY_NOT_FOUND' using errcode = 'P0002'; end if;
  if target_good_quantity is null or target_damaged_quantity is null or target_good_quantity < 0 or target_damaged_quantity < 0 or target_good_quantity + target_damaged_quantity <> current_row.total_quantity then
    raise exception 'BASIC_MEDICAL_INVENTORY_QUANTITY_INVALID' using errcode = '22023';
  end if;
  update public.basic_medical_room_inventory
  set good_quantity = target_good_quantity, damaged_quantity = target_damaged_quantity,
      last_damage_reporter_id = case when target_damaged_quantity > current_row.damaged_quantity then actor_id else last_damage_reporter_id end,
      last_damage_reported_at = case when target_damaged_quantity > current_row.damaged_quantity then clock_timestamp() else last_damage_reported_at end
  where id = target_inventory_id returning * into changed_row;
  if (current_row.good_quantity, current_row.damaged_quantity) is distinct from (changed_row.good_quantity, changed_row.damaged_quantity) then
    insert into public.basic_medical_equipment_condition_logs (
      inventory_id, event_type, total_before, good_before, damaged_before,
      total_after, good_after, damaged_after, quantity_delta, actor_id, note
    ) values (
      changed_row.id, 'condition_adjustment', current_row.total_quantity,
      current_row.good_quantity, current_row.damaged_quantity,
      changed_row.total_quantity, changed_row.good_quantity, changed_row.damaged_quantity,
      changed_row.damaged_quantity - current_row.damaged_quantity, actor_id, btrim(target_note)
    );
  end if;
  return changed_row;
end;
$$;

revoke all on function private.is_operationally_assignable(uuid), private.assert_operationally_assignable(uuid), private.guard_operational_assignment(), private.can_manage_email_notifications(), private.assert_catalog_room_capacity(integer), private.assert_personnel_password_operation_service(), private.personnel_password_operation_is_stale(public.personnel_password_operations), private.personnel_password_operation_is_recoverable(public.personnel_password_operations) from public, anon, authenticated;
revoke all on function public.cancel_basic_medical_session(uuid,text), public.invalidate_basic_medical_session_confirmation(uuid,text), public.list_basic_medical_schedule_confirmation_states(uuid[]), public.list_operational_people(), public.list_operational_shift_assignees(), public.reserve_personnel_password_operation(uuid,text), public.begin_personnel_password_auth_update(uuid), public.record_personnel_password_auth_result(uuid,boolean,text), public.commit_personnel_password_operation(uuid), public.mark_personnel_password_reconciliation_required(uuid,text), public.reconcile_personnel_password_operation(uuid), public.list_recoverable_personnel_password_operations() from public, anon, authenticated;
revoke all on function public.set_personnel_email_notification_capability(uuid,boolean) from public, anon;
grant execute on function public.cancel_basic_medical_session(uuid,text), public.invalidate_basic_medical_session_confirmation(uuid,text), public.list_basic_medical_schedule_confirmation_states(uuid[]), public.list_operational_people(), public.list_operational_shift_assignees(), public.reserve_personnel_password_operation(uuid,text), public.set_personnel_email_notification_capability(uuid,boolean) to authenticated;
grant execute on function public.begin_personnel_password_auth_update(uuid), public.record_personnel_password_auth_result(uuid,boolean,text), public.commit_personnel_password_operation(uuid), public.mark_personnel_password_reconciliation_required(uuid,text), public.reconcile_personnel_password_operation(uuid), public.list_recoverable_personnel_password_operations() to service_role;


-- Source: supabase/schemas/21_catalog_reconciliation_preview_apply.sql
-- Server-authoritative, atomic catalog reconciliation. The file is supplied as
-- normalized JSON only; preview counts are always recomputed in the database.
create or replace function private.catalog_reconciliation_plan(target_domain text, target_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item jsonb; names text[] := '{}'::text[]; normalized text; plan jsonb;
begin
  if target_domain = 'skills' then
    if not ((select private.is_admin()) or (select private.has_role('staff'))) then raise exception 'CATALOG_MANAGER_REQUIRED' using errcode = '42501'; end if;
  elsif target_domain = 'basic_medical' then
    if not (select private.can_manage_basic_medical()) then raise exception 'BASIC_MEDICAL_MANAGER_REQUIRED' using errcode = '42501'; end if;
  else raise exception 'INVALID_CATALOG_DOMAIN' using errcode = '22023'; end if;
  if jsonb_typeof(target_rows) <> 'array' or jsonb_array_length(target_rows) not between 1 and 5000 then raise exception 'INVALID_CATALOG_IMPORT' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(target_rows) loop
    normalized := lower(btrim(coalesce(item->>'commercial_name','')));
    if normalized = '' or btrim(coalesce(item->>'item_name','')) = '' or btrim(coalesce(item->>'unit','')) = '' then raise exception 'CATALOG_COMMERCIAL_NAME_AND_UNIT_REQUIRED' using errcode = '22023'; end if;
    if normalized = any(names) then raise exception 'DUPLICATE_CATALOG_IMPORT_COMMERCIAL_NAME' using errcode = '22023'; end if;
    names := array_append(names, normalized);
  end loop;
  if target_domain = 'skills' then
    with file_rows as (
      select lower(btrim(value->>'commercial_name')) key, jsonb_build_object(
        'commercial_name', btrim(value->>'commercial_name'), 'item_name', btrim(value->>'item_name'),
        'item_type', nullif(btrim(value->>'item_type'), ''), 'country_of_origin', nullif(btrim(value->>'country_of_origin'), ''),
        'manufacturer', nullif(btrim(value->>'manufacturer'), ''), 'model', nullif(btrim(value->>'model'), ''), 'unit', btrim(value->>'unit')
      ) payload from jsonb_array_elements(target_rows)
    ), current_rows as (
      select c.id, lower(btrim(c.commercial_name)) key, c.is_active,
        jsonb_build_object('item_name',c.item_name,'commercial_name',c.commercial_name,'item_type',c.item_type,'country_of_origin',c.country_of_origin,'manufacturer',c.manufacturer,'model',c.model,'unit',c.unit) metadata,
        exists(select 1 from public.equipment_request_items i where i.catalog_item_id = c.id) referenced
      from public.equipment_catalog c
    ), absent as (select c.* from current_rows c where not (c.key = any(names)))
    select jsonb_build_object('updated', count(*) filter(where c.id is not null and c.is_active), 'reactivated', count(*) filter(where c.id is not null and not c.is_active), 'inserted', count(*) filter(where c.id is null), 'deactivated', (select count(*) from absent where referenced), 'deleted', (select count(*) from absent where not referenced), 'fingerprint', md5(coalesce(jsonb_agg(f.payload order by f.key)::text,'[]') || coalesce((select jsonb_agg(jsonb_build_object('id',id,'key',key,'active',is_active,'referenced',referenced,'metadata',metadata) order by key)::text from current_rows),'[]'))) into plan from file_rows f left join current_rows c on c.key = f.key;
  else
    with file_rows as (
      select lower(btrim(value->>'commercial_name')) key, jsonb_build_object(
        'commercial_name', btrim(value->>'commercial_name'), 'item_name', btrim(value->>'item_name'),
        'item_type', nullif(btrim(value->>'item_type'), ''), 'country_of_origin', nullif(btrim(value->>'country_of_origin'), ''),
        'manufacturer', nullif(btrim(value->>'manufacturer'), ''), 'model', nullif(btrim(value->>'model'), ''), 'unit', btrim(value->>'unit')
      ) payload from jsonb_array_elements(target_rows)
    ), current_rows as (
      select c.id, lower(btrim(c.commercial_name)) key, c.is_active,
        jsonb_build_object('item_name',c.item_name,'commercial_name',c.commercial_name,'item_type',c.item_type,'country_of_origin',c.country_of_origin,'manufacturer',c.manufacturer,'model',c.model,'unit',c.unit) metadata,
        exists(select 1 from public.basic_medical_room_inventory i where i.catalog_item_id = c.id)
          or exists(select 1 from public.basic_medical_equipment_condition_logs logs where logs.catalog_item_id_snapshot = c.id) referenced
      from public.basic_medical_equipment_catalog c
    ), absent as (select c.* from current_rows c where not (c.key = any(names)))
    select jsonb_build_object('updated', count(*) filter(where c.id is not null and c.is_active), 'reactivated', count(*) filter(where c.id is not null and not c.is_active), 'inserted', count(*) filter(where c.id is null), 'deactivated', (select count(*) from absent where referenced), 'deleted', (select count(*) from absent where not referenced), 'fingerprint', md5(coalesce(jsonb_agg(f.payload order by f.key)::text,'[]') || coalesce((select jsonb_agg(jsonb_build_object('id',id,'key',key,'active',is_active,'referenced',referenced,'metadata',metadata) order by key)::text from current_rows),'[]'))) into plan from file_rows f left join current_rows c on c.key = f.key;
  end if;
  return plan;
end; $$;

create or replace function public.preview_catalog_reconciliation(target_domain text, target_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin return private.catalog_reconciliation_plan(target_domain, target_rows); end; $$;

create or replace function public.apply_catalog_reconciliation(target_domain text, target_rows jsonb, target_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare plan jsonb; item jsonb; row_id uuid; names text[] := '{}'::text[]; actor_id uuid := (select auth.uid());
declare old_row record;
begin
  plan := private.catalog_reconciliation_plan(target_domain, target_rows);
  if nullif(btrim(coalesce(target_fingerprint,'')),'') is null or target_fingerprint <> plan->>'fingerprint' then raise exception 'CATALOG_RECONCILIATION_STALE_PREVIEW' using errcode = 'P0001'; end if;
  -- Locks make the verified plan and all mutations one transaction.
  if target_domain = 'skills' then lock table public.equipment_catalog, public.equipment_request_items in share row exclusive mode; else lock table public.basic_medical_equipment_catalog, public.basic_medical_room_inventory, public.basic_medical_equipment_condition_logs in share row exclusive mode; end if;
  plan := private.catalog_reconciliation_plan(target_domain, target_rows);
  if target_fingerprint <> plan->>'fingerprint' then raise exception 'CATALOG_RECONCILIATION_STALE_PREVIEW' using errcode = 'P0001'; end if;
  for item in select value from jsonb_array_elements(target_rows) loop
    names := array_append(names, lower(btrim(item->>'commercial_name')));
    if target_domain = 'skills' then
      select id into row_id from public.equipment_catalog where lower(btrim(commercial_name)) = lower(btrim(item->>'commercial_name')) for update;
      if row_id is null then insert into public.equipment_catalog(item_name,commercial_name,item_type,country_of_origin,manufacturer,model,unit,is_active) values(btrim(item->>'item_name'),btrim(item->>'commercial_name'),nullif(btrim(item->>'item_type'),''),nullif(btrim(item->>'country_of_origin'),''),nullif(btrim(item->>'manufacturer'),''),nullif(btrim(item->>'model'),''),btrim(item->>'unit'),true); else update public.equipment_catalog set item_name=btrim(item->>'item_name'),commercial_name=btrim(item->>'commercial_name'),item_type=nullif(btrim(item->>'item_type'),''),country_of_origin=nullif(btrim(item->>'country_of_origin'),''),manufacturer=nullif(btrim(item->>'manufacturer'),''),model=nullif(btrim(item->>'model'),''),unit=btrim(item->>'unit'),is_active=true where id=row_id; end if;
    else
      select id into row_id from public.basic_medical_equipment_catalog where lower(btrim(commercial_name)) = lower(btrim(item->>'commercial_name')) for update;
      if row_id is null then insert into public.basic_medical_equipment_catalog(item_name,commercial_name,item_type,country_of_origin,manufacturer,model,unit,is_active) values(btrim(item->>'item_name'),btrim(item->>'commercial_name'),nullif(btrim(item->>'item_type'),''),nullif(btrim(item->>'country_of_origin'),''),nullif(btrim(item->>'manufacturer'),''),nullif(btrim(item->>'model'),''),btrim(item->>'unit'),true); else update public.basic_medical_equipment_catalog set item_name=btrim(item->>'item_name'),commercial_name=btrim(item->>'commercial_name'),item_type=nullif(btrim(item->>'item_type'),''),country_of_origin=nullif(btrim(item->>'country_of_origin'),''),manufacturer=nullif(btrim(item->>'manufacturer'),''),model=nullif(btrim(item->>'model'),''),unit=btrim(item->>'unit'),is_active=true where id=row_id; end if;
    end if;
  end loop;
  if target_domain = 'skills' then
    for old_row in select c.id, exists(select 1 from public.equipment_request_items i where i.catalog_item_id=c.id) referenced from public.equipment_catalog c where not (lower(btrim(c.commercial_name)) = any(names)) loop
      if old_row.referenced then update public.equipment_catalog set is_active=false where id=old_row.id; else delete from public.equipment_catalog where id=old_row.id; end if;
    end loop;
  else
    for old_row in select c.id, exists(select 1 from public.basic_medical_room_inventory i where i.catalog_item_id=c.id) or exists(select 1 from public.basic_medical_equipment_condition_logs logs where logs.catalog_item_id_snapshot=c.id) referenced from public.basic_medical_equipment_catalog c where not (lower(btrim(c.commercial_name)) = any(names)) loop
      if old_row.referenced then update public.basic_medical_equipment_catalog set is_active=false where id=old_row.id; else delete from public.basic_medical_equipment_catalog where id=old_row.id; end if;
    end loop;
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,metadata) values(actor_id,'catalog.reconciled',target_domain,plan);
  return plan;
end; $$;

revoke all on function private.catalog_reconciliation_plan(text,jsonb) from public,anon,authenticated;
revoke all on function public.preview_catalog_reconciliation(text,jsonb), public.apply_catalog_reconciliation(text,jsonb,text) from public,anon;
grant execute on function public.preview_catalog_reconciliation(text,jsonb), public.apply_catalog_reconciliation(text,jsonb,text) to authenticated;


-- Source: supabase/schemas/22_basic_medical_confirmation_signer_snapshot_permission.sql
-- Declarative final state for the existing registration-list confirmation
-- embed. This is intentionally a column grant, not a table grant.
grant select (signer_name_snapshot)
on public.basic_medical_session_confirmations
to authenticated;


-- Source: supabase/schemas/23_update_basic_medical_session_teaching_lecturer.sql
-- Allow Basic Medical registration creator and Admin to change teaching lecturer
-- on an existing session without recreating the registration and without
-- invalidating existing confirmations or signatures.

create or replace function private.invalidate_basic_medical_confirmation_on_schedule_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  preserve_confirmation_context boolean;
begin
  -- Room, date, start_time, and end_time changes ALWAYS invalidate active confirmations.
  if old.room_id is distinct from new.room_id
    or old.schedule_date is distinct from new.schedule_date
    or old.start_time is distinct from new.start_time
    or old.end_time is distinct from new.end_time then
    update public.basic_medical_session_confirmations as confirmations
    set invalidated_at = coalesce(confirmations.invalidated_at, clock_timestamp()),
        invalidated_reason = coalesce(
          confirmations.invalidated_reason,
          'Thông tin phòng, thời gian hoặc Giảng viên giảng dạy/hướng dẫn đã thay đổi.'
        )
    from public.basic_medical_registration_sessions as sessions
    where sessions.class_schedule_id = new.id
      and confirmations.session_id = sessions.id
      and confirmations.invalidated_at is null;
    return new;
  end if;

  -- Lecturer-only change invalidates unless explicitly executed under the dedicated
  -- preserve-confirmation context from update_basic_medical_session_teaching_lecturer.
  if old.lecturer_id is distinct from new.lecturer_id then
    preserve_confirmation_context := coalesce(
      nullif(current_setting('app.basic_medical_preserve_confirmation_lecturer_change', true), ''),
      'false'
    )::boolean;

    if not preserve_confirmation_context then
      update public.basic_medical_session_confirmations as confirmations
      set invalidated_at = coalesce(confirmations.invalidated_at, clock_timestamp()),
          invalidated_reason = coalesce(
            confirmations.invalidated_reason,
            'Thông tin phòng, thời gian hoặc Giảng viên giảng dạy/hướng dẫn đã thay đổi.'
          )
      from public.basic_medical_registration_sessions as sessions
      where sessions.class_schedule_id = new.id
        and confirmations.session_id = sessions.id
        and confirmations.invalidated_at is null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.invalidate_basic_medical_confirmation_on_schedule_change() from public, anon, authenticated;

create or replace function public.update_basic_medical_session_teaching_lecturer(
  target_session_id uuid,
  target_teaching_lecturer_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid;
  session_row public.basic_medical_registration_sessions%rowtype;
  registration_row public.basic_medical_registrations%rowtype;
  schedule_row public.class_schedules%rowtype;
  basic_medical_room_type_id constant uuid := '40000000-0000-0000-0000-000000000002'::uuid;
  is_admin_user boolean := false;
  is_creator_user boolean := false;
begin
  actor_id := auth.uid();
  if actor_id is null or not (select private.is_active_user()) then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select sessions.* into session_row
  from public.basic_medical_registration_sessions as sessions
  where sessions.id = target_session_id
  for update;

  if session_row.id is null then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select registrations.* into registration_row
  from public.basic_medical_registrations as registrations
  where registrations.id = session_row.registration_id
  for update;

  if registration_row.id is null then
    raise exception 'REGISTRATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if registration_row.cancelled_at is not null then
    raise exception 'REGISTRATION_CANCELLED' using errcode = '55000';
  end if;

  select schedules.* into schedule_row
  from public.class_schedules as schedules
  where schedules.id = session_row.class_schedule_id
  for update;

  if schedule_row.id is null then
    raise exception 'BASIC_MEDICAL_LINKED_SCHEDULE_INCONSISTENT' using errcode = 'P0001';
  end if;

  if session_row.cancelled_at is not null or schedule_row.schedule_status = 'cancelled' then
    raise exception 'BASIC_MEDICAL_SESSION_CANCELLED' using errcode = '55000';
  end if;

  is_admin_user := (select private.is_admin());
  is_creator_user := (registration_row.created_by = actor_id);

  if not (is_admin_user or is_creator_user) then
    raise exception 'UPDATE_FORBIDDEN' using errcode = '42501';
  end if;

  -- Validate target lecturer is active, operationally assignable, has lecturer role, and has Basic Medical room type assignment
  if not (
    (select private.is_operationally_assignable(target_teaching_lecturer_id))
    and exists (
      select 1
      from public.user_roles as roles
      where roles.user_id = target_teaching_lecturer_id
        and roles.role = 'lecturer'
    )
    and exists (
      select 1
      from public.profile_room_types as assignments
      where assignments.profile_id = target_teaching_lecturer_id
        and assignments.room_type_id = basic_medical_room_type_id
    )
  ) then
    raise exception 'INVALID_LECTURER' using errcode = '22023';
  end if;

  if session_row.teaching_lecturer_id is distinct from target_teaching_lecturer_id then
    perform set_config('app.basic_medical_registration_mutation', 'true', true);
    perform set_config('app.basic_medical_preserve_confirmation_lecturer_change', 'true', true);

    update public.basic_medical_registration_sessions
    set teaching_lecturer_id = target_teaching_lecturer_id
    where id = session_row.id;

    update public.class_schedules
    set lecturer_id = target_teaching_lecturer_id
    where id = session_row.class_schedule_id;

    perform set_config('app.basic_medical_preserve_confirmation_lecturer_change', 'false', true);

    insert into public.audit_logs (
      actor_id,
      action,
      entity_type,
      entity_id,
      old_data,
      new_data,
      metadata
    ) values (
      actor_id,
      'basic_medical_session.update_teaching_lecturer',
      'basic_medical_registration_sessions',
      session_row.id,
      jsonb_build_object('teaching_lecturer_id', session_row.teaching_lecturer_id),
      jsonb_build_object('teaching_lecturer_id', target_teaching_lecturer_id),
      jsonb_build_object(
        'registration_id', session_row.registration_id,
        'session_number', session_row.session_number,
        'lesson_title', session_row.lesson_title,
        'class_schedule_id', session_row.class_schedule_id
      )
    );
  end if;

  return true;
end;
$$;

revoke all on function public.update_basic_medical_session_teaching_lecturer(uuid, uuid) from public, anon;
grant execute on function public.update_basic_medical_session_teaching_lecturer(uuid, uuid) to authenticated;


-- Source: supabase/schemas/24_consolidated_skills_class_edit_and_equipment_lock.sql
-- 24_consolidated_skills_class_edit_and_equipment_lock.sql
-- Consolidated Skills Class Edit Authority and Equipment Registration Integrity Lock

-- 1. Private helper: Check if ANY equipment_requests row exists for the schedule (row existence rule)
create or replace function private.class_schedule_has_equipment_request(target_schedule_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.equipment_requests
    where class_schedule_id = target_schedule_id
  );
$$;

revoke all on function private.class_schedule_has_equipment_request(uuid) from public, anon, authenticated;

-- 2. Public batch RPC for UI equipment lock status querying without RLS information leaks
create or replace function public.get_class_schedules_equipment_lock_status(
  target_schedule_ids uuid[]
)
returns table (
  schedule_id uuid,
  has_equipment_request boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null or not (select private.is_active_user()) then
    return;
  end if;

  return query
  select
    schedules.id as schedule_id,
    exists (
      select 1
      from public.equipment_requests as req
      where req.class_schedule_id = schedules.id
    ) as has_equipment_request
  from public.class_schedules as schedules
  where schedules.id = any(coalesce(target_schedule_ids, '{}'::uuid[]))
    and schedules.schedule_status <> 'cancelled'
    and (
      (select private.has_role('admin'))
      or exists (
        select 1
        from public.rooms as r
        where r.id = schedules.room_id
          and (select private.has_room_type(r.room_type_id))
      )
    );
end;
$$;

revoke all on function public.get_class_schedules_equipment_lock_status(uuid[]) from public, anon;
grant execute on function public.get_class_schedules_equipment_lock_status(uuid[]) to authenticated;

-- 3. Dedicated atomic RPC for Skills Lab class schedule editing
create or replace function public.update_skills_lab_class_schedule(
  target_schedule_id uuid,
  target_schedule_date date,
  target_start_time time,
  target_end_time time,
  target_course_id uuid,
  target_room_id uuid,
  target_student_count integer,
  target_lecturer_ids uuid[] default null
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
  nursing_skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
  source_room_type uuid;
  target_room_type uuid;
  course_row public.courses;
  is_admin boolean := (select private.has_role('admin'));
  is_staff boolean := (select private.has_role('staff'));
  is_ta boolean := (select private.has_role('teaching_assistant'));
  is_lecturer boolean := (select private.has_role('lecturer'));
  is_manager boolean := false;
  is_eligible_lecturer boolean := false;
  is_eligible_ta boolean := false;
  normalized_lecturer_ids uuid[];
  final_lecturer_1 uuid;
  final_lecturer_2 uuid;
  actor_name text;
  lecturer_name text;
  schedule_code text;
  room_label text;
  has_actual_change boolean := false;
  change_id uuid := gen_random_uuid();
begin
  if actor_id is null or not (select private.is_active_user()) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  select schedules.* into before_row
  from public.class_schedules as schedules
  where schedules.id = target_schedule_id
    and schedules.schedule_status <> 'cancelled'
  for update;

  if before_row.id is null then
    raise exception 'CLASS_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- Basic Medical schedule => hard reject
  if before_row.basic_medical_registration_id is not null then
    raise exception 'BASIC_MEDICAL_SCHEDULE_MUTATION_FORBIDDEN' using errcode = '42501';
  end if;

  select rooms.room_type_id into source_room_type
  from public.rooms as rooms
  where rooms.id = before_row.room_id;

  if source_room_type is distinct from nursing_skills_room_type_id then
    raise exception 'SKILLS_LAB_SCHEDULE_REQUIRED' using errcode = '42501';
  end if;

  -- Equipment Request Lock Guard: Any row in equipment_requests locks the class
  if (select private.class_schedule_has_equipment_request(target_schedule_id)) then
    raise exception 'CLASS_EQUIPMENT_REQUEST_EXISTS' using errcode = '42501';
  end if;

  -- Check actor scope for source room type
  if not is_admin and not (select private.has_room_type(source_room_type)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;

  -- Validate target room
  select rooms.room_type_id into target_room_type
  from public.rooms as rooms
  where rooms.id = target_room_id and rooms.is_active;

  if target_room_type is null or target_room_type is distinct from nursing_skills_room_type_id then
    raise exception 'INVALID_ROOM_SELECTION' using errcode = '22023';
  end if;

  if not is_admin and not (select private.has_room_type(target_room_type)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;

  -- Authoritatively resolve target course
  select * into course_row
  from public.courses as courses
  where courses.id = target_course_id
    and courses.is_active
    and courses.room_type_id = nursing_skills_room_type_id;

  if course_row.id is null then
    raise exception 'INVALID_COURSE_SELECTION' using errcode = '22023';
  end if;

  -- Validate date, times, operating hours, and student count
  if target_schedule_date is null
    or target_start_time is null
    or target_end_time is null
    or target_end_time <= target_start_time
    or target_student_count is null
    or target_student_count < 1 then
    raise exception 'INVALID_CLASS_DETAILS' using errcode = '22023';
  end if;

  if not (
    (target_start_time >= '07:30'::time and target_end_time <= '11:30'::time) or
    (target_start_time >= '12:30'::time and target_end_time <= '16:30'::time)
  ) then
    raise exception 'OPERATING_HOURS_VIOLATION' using errcode = '23514';
  end if;

  -- Evaluate actor authority
  is_manager := is_admin or (is_staff and (select private.has_room_type(nursing_skills_room_type_id)));
  is_eligible_lecturer := is_lecturer
    and (select private.has_room_type(nursing_skills_room_type_id))
    and (
      coalesce(actor_id in (before_row.lecturer_id, before_row.lecturer_2_id), false)
      or before_row.created_by = actor_id
    );
  is_eligible_ta := is_ta
    and (select private.has_room_type(nursing_skills_room_type_id))
    and (before_row.created_by = actor_id);

  if not (is_manager or is_eligible_lecturer or is_eligible_ta) then
    raise exception 'CLASS_UPDATE_FORBIDDEN' using errcode = '42501';
  end if;

  -- Determine lecturer assignments:
  -- For Manager: can assign lecturers if provided
  -- For Lecturer / TA own-edit: MUST strictly preserve existing lecturer_id and lecturer_2_id
  if is_manager then
    if target_lecturer_ids is not null then
      normalized_lecturer_ids := array_remove(target_lecturer_ids, null);

      if cardinality(normalized_lecturer_ids) > 2 then
        raise exception 'TOO_MANY_CLASS_LECTURERS' using errcode = '22023';
      end if;

      if cardinality(normalized_lecturer_ids) <> cardinality(array_remove(target_lecturer_ids, null)) then
        raise exception 'DUPLICATE_CLASS_LECTURER' using errcode = '22023';
      end if;

      if exists (
        select 1
        from unnest(normalized_lecturer_ids) as req(id)
        where not exists (
          select 1
          from public.profiles as profiles
          join public.user_roles as roles on roles.user_id = profiles.id and roles.role = 'lecturer'
          join public.profile_room_types as scopes on scopes.profile_id = profiles.id and scopes.room_type_id = nursing_skills_room_type_id
          where profiles.id = req.id and profiles.is_active
        )
      ) then
        raise exception 'LECTURER_ROOM_TYPE_MISMATCH' using errcode = '42501';
      end if;

      final_lecturer_1 := case when cardinality(normalized_lecturer_ids) >= 1 then normalized_lecturer_ids[1] else null end;
      final_lecturer_2 := case when cardinality(normalized_lecturer_ids) >= 2 then normalized_lecturer_ids[2] else null end;
    else
      final_lecturer_1 := before_row.lecturer_id;
      final_lecturer_2 := before_row.lecturer_2_id;
    end if;
  else
    -- Own edit: IMMUTABLE lecturer assignments
    final_lecturer_1 := before_row.lecturer_id;
    final_lecturer_2 := before_row.lecturer_2_id;
  end if;

  -- Detect actual change
  if before_row.schedule_date is distinct from target_schedule_date
    or before_row.start_time is distinct from target_start_time
    or before_row.end_time is distinct from target_end_time
    or before_row.course_id is distinct from course_row.id
    or before_row.course_code_snapshot is distinct from course_row.course_code
    or before_row.course_name_snapshot is distinct from course_row.course_name
    or before_row.room_id is distinct from target_room_id
    or before_row.student_count is distinct from target_student_count
    or before_row.lecturer_id is distinct from final_lecturer_1
    or before_row.lecturer_2_id is distinct from final_lecturer_2 then
    has_actual_change := true;
  end if;

  update public.class_schedules
  set schedule_date = target_schedule_date,
      start_time = target_start_time,
      end_time = target_end_time,
      course_id = course_row.id,
      course_code_snapshot = course_row.course_code,
      course_name_snapshot = course_row.course_name,
      room_id = target_room_id,
      student_count = target_student_count,
      lecturer_id = final_lecturer_1,
      lecturer_2_id = final_lecturer_2,
      updated_at = now()
  where id = target_schedule_id
  returning * into changed_row;

  -- Transactional outbox event on actual change
  if has_actual_change then
    select concat_ws(' · ', rooms.room_code, rooms.building_code)
    into room_label
    from public.rooms as rooms
    where rooms.id = target_room_id;

    select profiles.full_name into actor_name
    from public.profiles as profiles where profiles.id = actor_id;

    select pg_catalog.string_agg(profiles.full_name, ' · ' order by profiles.full_name)
    into lecturer_name
    from public.profiles as profiles
    where profiles.id in (changed_row.lecturer_id, changed_row.lecturer_2_id);

    select nullif(
      concat_ws(
        ' · ',
        (select profiles.full_name from public.profiles as profiles where profiles.id = changed_row.lecturer_id),
        (select profiles.full_name from public.profiles as profiles where profiles.id = changed_row.lecturer_2_id)
      ),
      ''
    ) into lecturer_name;

    schedule_code := to_char(
      before_row.created_at at time zone 'Asia/Ho_Chi_Minh',
      'YYMMDDHH24MISS'
    );

    insert into public.email_outbox_events (
      domain,
      event_type,
      aggregate_id,
      event_key,
      payload,
      recipients,
      delivery_mode_at_event
    )
    select
      'skills_lab_schedule',
      'class_schedule_rescheduled',
      before_row.id,
      concat('skills_lab:updated:', change_id, ':', before_row.id),
      jsonb_build_object(
        'schedule_id', before_row.id,
        'course_code', changed_row.course_code_snapshot,
        'course_name', changed_row.course_name_snapshot,
        'old_schedule_date', before_row.schedule_date,
        'schedule_date', changed_row.schedule_date,
        'start_time', changed_row.start_time,
        'end_time', changed_row.end_time,
        'room', room_label,
        'student_count', changed_row.student_count,
        'lecturer', coalesce(lecturer_name, 'Chưa có giảng viên'),
        'request_code', schedule_code,
        'actor', coalesce(actor_name, 'Người dùng hệ thống'),
        'room_type_code', 'nursing_skills'
      ),
      (
        select coalesce(jsonb_agg(jsonb_build_object('id', recipients.id, 'email', recipients.email)), '[]'::jsonb)
        from public.profiles as recipients
        where recipients.is_active
          and (
            recipients.id in (changed_row.lecturer_id, changed_row.lecturer_2_id, before_row.lecturer_id, before_row.lecturer_2_id)
            or recipients.id = before_row.created_by
            or exists (
              select 1 from public.user_roles as roles
              where roles.user_id = recipients.id
                and roles.role in ('admin', 'staff', 'viewer')
                and (
                  roles.role = 'admin'
                  or exists (
                    select 1 from public.profile_room_types as assignments
                    where assignments.profile_id = recipients.id
                      and assignments.room_type_id = nursing_skills_room_type_id
                      and (
                        roles.role <> 'viewer'
                        or assignments.receive_schedule_emails
                      )
                  )
                )
            )
          )
      ),
      (select delivery_mode from public.email_delivery_settings where setting_key = 'primary')
    on conflict (event_key) do nothing;
  end if;

  return changed_row;
exception
  when exclusion_violation then
    raise exception 'ROOM_OR_LECTURER_SCHEDULE_CONFLICT' using errcode = '23P01';
end;
$$;

revoke all on function public.update_skills_lab_class_schedule(uuid, date, time, time, uuid, uuid, integer, uuid[]) from public, anon;
grant execute on function public.update_skills_lab_class_schedule(uuid, date, time, time, uuid, uuid, integer, uuid[]) to authenticated;

-- 4. Harden withdraw_class with equipment lock guard
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

  if (select private.class_schedule_has_equipment_request(target_schedule_id)) then
    raise exception 'CLASS_EQUIPMENT_REQUEST_EXISTS' using errcode = '42501';
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

revoke all on function public.withdraw_class(uuid) from public, anon;
grant execute on function public.withdraw_class(uuid) to authenticated;

-- 5. Harden delete_skills_lab_class_schedule with equipment lock guard
create or replace function public.delete_skills_lab_class_schedule(
  target_schedule_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  before_row public.class_schedules;
  room_type_value uuid;
  room_type_code_value text;
  room_label text;
  actor_name text;
  lecturer_name text;
  schedule_code text;
  is_manager boolean;
  is_eligible_lecturer boolean;
  is_eligible_ta boolean;
begin
  if actor_id is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  select schedules.* into before_row
  from public.class_schedules as schedules
  where schedules.id = target_schedule_id
    and schedules.schedule_status <> 'cancelled'
  for update;

  if before_row.id is null then
    raise exception 'CLASS_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  if before_row.basic_medical_registration_id is not null then
    raise exception 'BASIC_MEDICAL_SCHEDULE_MUTATION_FORBIDDEN' using errcode = '42501';
  end if;

  if (select private.class_schedule_has_equipment_request(target_schedule_id)) then
    raise exception 'CLASS_EQUIPMENT_REQUEST_EXISTS' using errcode = '42501';
  end if;

  select rooms.room_type_id, room_types.code,
         concat_ws(' · ', rooms.room_code, rooms.building_code)
  into room_type_value, room_type_code_value, room_label
  from public.rooms as rooms
  join public.room_types as room_types on room_types.id = rooms.room_type_id
  where rooms.id = before_row.room_id;

  if not (select private.has_room_type(room_type_value)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;

  is_manager := (select private.has_role('admin')) or (select private.has_role('staff'));

  is_eligible_lecturer := (
    room_type_code_value = 'nursing_skills'
    and before_row.created_by = actor_id
    and (select private.has_role('lecturer'))
  );

  is_eligible_ta := (
    before_row.created_by = actor_id
    and (select private.has_role('teaching_assistant'))
  );

  if not (is_manager or is_eligible_lecturer or is_eligible_ta) then
    raise exception 'CLASS_DELETE_FORBIDDEN' using errcode = '42501';
  end if;

  if room_type_code_value = 'nursing_skills' and not is_manager then
    select profiles.full_name into actor_name
    from public.profiles as profiles where profiles.id = actor_id;

    select pg_catalog.string_agg(profiles.full_name, ' · ' order by profiles.full_name)
    into lecturer_name
    from public.profiles as profiles
    where profiles.id in (before_row.lecturer_id, before_row.lecturer_2_id);

    select nullif(
      concat_ws(
        ' · ',
        (select profiles.full_name from public.profiles as profiles where profiles.id = before_row.lecturer_id),
        (select profiles.full_name from public.profiles as profiles where profiles.id = before_row.lecturer_2_id)
      ),
      ''
    ) into lecturer_name;

    schedule_code := to_char(
      before_row.created_at at time zone 'Asia/Ho_Chi_Minh',
      'YYMMDDHH24MISS'
    );

    insert into public.email_outbox_events (
      domain,
      event_type,
      aggregate_id,
      event_key,
      payload,
      recipients,
      delivery_mode_at_event
    )
    select
      'skills_lab_schedule',
      'skills_lab_deleted',
      before_row.id,
      concat('skills_lab:lecturer_deleted:', before_row.id),
      jsonb_build_object(
        'schedule_id', before_row.id,
        'course_code', before_row.course_code_snapshot,
        'course_name', before_row.course_name_snapshot,
        'schedule_date', before_row.schedule_date,
        'start_time', before_row.start_time,
        'end_time', before_row.end_time,
        'room', room_label,
        'student_count', before_row.student_count,
        'lecturer', coalesce(lecturer_name, 'Chưa có giảng viên'),
        'request_code', schedule_code,
        'actor', coalesce(actor_name, 'Giảng viên')
      ),
      (
        select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'email', r.email)), '[]'::jsonb)
        from public.profiles as r
        where r.is_active
          and (
            r.id in (actor_id, before_row.lecturer_id, before_row.lecturer_2_id)
            or exists (
              select 1 from public.user_roles as roles
              where roles.user_id = r.id and roles.role in ('admin', 'staff')
                and (
                  roles.role = 'admin'
                  or exists (
                    select 1 from public.profile_room_types as assignments
                    where assignments.profile_id = r.id
                      and assignments.room_type_id = room_type_value
                  )
                )
            )
          )
      ),
      (select delivery_mode from public.email_delivery_settings where setting_key = 'primary')
    on conflict (event_key) do nothing;
  end if;

  delete from public.class_schedules where id = target_schedule_id;

  return true;
end;
$$;

revoke all on function public.delete_skills_lab_class_schedule(uuid) from public, anon;
grant execute on function public.delete_skills_lab_class_schedule(uuid) to authenticated;

-- 6. Harden reschedule_class with equipment lock guard
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
  room_label text;
  actor_name text;
  change_id uuid := gen_random_uuid();
  lecturer_name text;
  schedule_code text;
  actor_id uuid := (select auth.uid());
begin
  if target_schedule_date is null then
    raise exception 'INVALID_SCHEDULE_DATE' using errcode = '22023';
  end if;

  select schedules.* into before_row
  from public.class_schedules as schedules
  where schedules.id = target_schedule_id
    and schedules.schedule_status <> 'cancelled'
  for update;

  if before_row.id is null then
    raise exception 'CLASS_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  if (select private.class_schedule_has_equipment_request(target_schedule_id)) then
    raise exception 'CLASS_EQUIPMENT_REQUEST_EXISTS' using errcode = '42501';
  end if;

  select rooms.room_type_id, room_types.code,
         concat_ws(' · ', rooms.room_code, rooms.building_code)
  into room_type_value, room_type_code_value, room_label
  from public.rooms as rooms
  join public.room_types as room_types on room_types.id = rooms.room_type_id
  where rooms.id = before_row.room_id;

  select profiles.full_name into actor_name
  from public.profiles as profiles where profiles.id = actor_id;

  select pg_catalog.string_agg(profiles.full_name, ' · ' order by profiles.full_name)
  into lecturer_name
  from public.profiles as profiles
  where profiles.id in (before_row.lecturer_id, before_row.lecturer_2_id);

  select nullif(
    concat_ws(
      ' · ',
      (select profiles.full_name from public.profiles as profiles where profiles.id = before_row.lecturer_id),
      (select profiles.full_name from public.profiles as profiles where profiles.id = before_row.lecturer_2_id)
    ),
    ''
  ) into lecturer_name;

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
    if room_type_code_value = 'basic_medical' then
      insert into public.email_notifications (
        notification_type, recipient_id, recipient_email, dedupe_key, subject, payload
      )
      select
        'class_schedule_basic_medical_updated',
        recipients.id, recipients.email,
        concat('class_schedule_basic_medical_updated:', change_id, ':', before_row.id, ':', recipients.id),
        concat('[MedLabs Calendar] Đổi ngày học Y cơ sở · ', coalesce(before_row.course_code_snapshot, '')),
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
          'actor', coalesce(actor_name, 'Người dùng hệ thống')
        )
      from public.profiles as recipients
      where recipients.is_active
        and (
          recipients.id in (before_row.lecturer_id, before_row.lecturer_2_id)
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
    else
      insert into public.email_outbox_events (
        domain,
        event_type,
        aggregate_id,
        event_key,
        payload,
        recipients,
        delivery_mode_at_event
      )
      select
        'skills_lab_schedule',
        'class_schedule_rescheduled',
        before_row.id,
        concat('skills_lab:rescheduled:', change_id, ':', before_row.id),
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
        ),
        (
          select coalesce(jsonb_agg(jsonb_build_object('id', recipients.id, 'email', recipients.email)), '[]'::jsonb)
          from public.profiles as recipients
          where recipients.is_active
            and (
              recipients.id in (before_row.lecturer_id, before_row.lecturer_2_id)
              or recipients.id = before_row.created_by
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
        ),
        (select delivery_mode from public.email_delivery_settings where setting_key = 'primary')
      on conflict (event_key) do nothing;
    end if;
  end if;

  return changed_row;
exception
  when exclusion_violation then
    raise exception 'ROOM_OR_LECTURER_SCHEDULE_CONFLICT' using errcode = '23P01';
end;
$$;

revoke all on function public.reschedule_class(uuid, date) from public, anon;
grant execute on function public.reschedule_class(uuid, date) to authenticated;

-- 7. Harden assign_class_lecturers with equipment lock guard
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
  select schedules.* into target_row
  from public.class_schedules schedules
  where schedules.id = target_schedule_id
  for update;

  if target_row.id is null then
    raise exception 'CLASS_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  if (select private.class_schedule_has_equipment_request(target_schedule_id)) then
    raise exception 'CLASS_EQUIPMENT_REQUEST_EXISTS' using errcode = '42501';
  end if;

  select rooms.room_type_id into room_type_value
  from public.rooms rooms
  where rooms.id = target_row.room_id;

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
    select 1 from unnest(normalized_ids) requested(id) where not exists (
      select 1 from public.profiles profiles where profiles.id = requested.id and profiles.is_active
        and exists (select 1 from public.user_roles roles where roles.user_id = profiles.id and roles.role = 'lecturer')
        and exists (select 1 from public.profile_room_types scopes where scopes.profile_id = profiles.id and scopes.room_type_id = room_type_value)
    )
  ) then
    raise exception 'LECTURER_ROOM_TYPE_MISMATCH' using errcode = '42501';
  end if;

  update public.class_schedules
  set lecturer_id = case when cardinality(normalized_ids) >= 1 then normalized_ids[1] else null end,
      lecturer_2_id = case when cardinality(normalized_ids) >= 2 then normalized_ids[2] else null end,
      updated_at = now()
  where id = target_schedule_id
  returning * into target_row;

  return target_row;
end;
$$;

revoke all on function public.assign_class_lecturers(uuid, uuid[]) from public, anon;
grant execute on function public.assign_class_lecturers(uuid, uuid[]) to authenticated;

-- 8. Harden update_class_schedule_details_core with equipment lock guard
create or replace function public.update_class_schedule_details_core(
  target_schedule_id uuid,
  target_schedule_date date,
  target_start_time time,
  target_end_time time,
  target_room_id uuid,
  target_student_count integer,
  target_lecturer_ids uuid[] default null
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
  is_teaching_assistant boolean := (select private.has_role('teaching_assistant'));
  can_import_owner boolean := false;
  can_manage_details boolean := false;
  basic_medical_room_type_id uuid;
  has_actual_change boolean := false;
  mutation_id_val uuid;
begin
  select id into basic_medical_room_type_id
  from public.room_types
  where code = 'basic_medical'
  limit 1;

  if not (select private.can_modify_class_schedule(target_schedule_id, 'details')) then
    raise exception 'CLASS_UPDATE_FORBIDDEN' using errcode = '42501';
  end if;

  select * into before_row from public.class_schedules schedules
  where schedules.id = target_schedule_id and schedules.schedule_status <> 'cancelled'
  for update;

  if before_row.id is null then
    raise exception 'CLASS_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- Equipment lock check
  if (select private.class_schedule_has_equipment_request(target_schedule_id)) then
    raise exception 'CLASS_EQUIPMENT_REQUEST_EXISTS' using errcode = '42501';
  end if;

  select rooms.room_type_id into source_room_type from public.rooms rooms where rooms.id = before_row.room_id;

  can_import_owner := before_row.source = 'import'
    and (select private.can_import_schedules(source_room_type))
    and exists (
      select 1 from public.import_batches batches
      where batches.id = before_row.import_batch_id and batches.created_by = actor_id
    );

  select rooms.room_type_id into target_room_type
  from public.rooms rooms
  where rooms.id = target_room_id and rooms.is_active;

  if target_room_type is null then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;

  if source_room_type = basic_medical_room_type_id or target_room_type = basic_medical_room_type_id then
    if is_admin then
      can_manage_details := true;
    elsif is_staff then
      can_manage_details := (select private.has_room_type(source_room_type)) and (select private.has_room_type(target_room_type));
    else
      can_manage_details := false;
    end if;

    if not can_manage_details then
      raise exception 'CLASS_UPDATE_FORBIDDEN' using errcode = '42501';
    end if;
  else
    if is_admin then
      can_manage_details := true;
    elsif is_staff then
      can_manage_details := (select private.has_room_type(source_room_type)) and (select private.has_room_type(target_room_type));
    elsif is_teaching_assistant then
      can_manage_details := (select private.has_room_type(source_room_type)) and (select private.has_room_type(target_room_type)) and before_row.created_by = actor_id;
    elsif can_import_owner then
      can_manage_details := (select private.has_room_type(source_room_type)) and (select private.has_room_type(target_room_type));
    end if;

    if not can_manage_details then
      if not coalesce(actor_id in (before_row.lecturer_id, before_row.lecturer_2_id), false) then
        raise exception 'CLASS_UPDATE_FORBIDDEN' using errcode = '42501';
      end if;
      if target_start_time is distinct from before_row.start_time
        or target_end_time is distinct from before_row.end_time
        or target_room_id is distinct from before_row.room_id
        or target_student_count is distinct from before_row.student_count
        or normalized_ids is distinct from array_remove(array[before_row.lecturer_id, before_row.lecturer_2_id], null) then
        raise exception 'CLASS_DETAILS_UPDATE_FORBIDDEN' using errcode = '42501';
      end if;
    end if;
  end if;

  if target_schedule_date is null or target_start_time is null or target_end_time <= target_start_time
    or target_student_count is null or target_student_count < 1 or target_room_id is null
    or cardinality(normalized_ids) > 2
    or cardinality(normalized_ids) <> cardinality(array(select distinct unnest(normalized_ids))) then
    raise exception 'INVALID_CLASS_DETAILS' using errcode = '22023';
  end if;

  if not is_admin and (not (select private.has_room_type(source_room_type)) or not (select private.has_room_type(target_room_type))) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;

  if exists (
    select 1 from unnest(normalized_ids) lecturer_id where not exists (
      select 1 from public.profiles profiles where profiles.id = lecturer_id and profiles.is_active
        and exists (select 1 from public.user_roles roles where roles.user_id = lecturer_id and roles.role = 'lecturer')
        and exists (select 1 from public.profile_room_types scopes where scopes.profile_id = lecturer_id and scopes.room_type_id = target_room_type)
    )
  ) then
    raise exception 'LECTURER_ROOM_TYPE_MISMATCH' using errcode = '42501';
  end if;

  if (select private.has_role('lecturer')) and not (is_admin or is_staff or is_teaching_assistant or can_import_owner)
    and actor_id <> all(normalized_ids) then
    raise exception 'LECTURER_MUST_REMAIN_ASSIGNED' using errcode = '42501';
  end if;

  if before_row.schedule_date is distinct from target_schedule_date
    or before_row.start_time is distinct from target_start_time
    or before_row.end_time is distinct from target_end_time
    or before_row.room_id is distinct from target_room_id
    or before_row.student_count is distinct from target_student_count
    or before_row.lecturer_id is distinct from (case when cardinality(normalized_ids) >= 1 then normalized_ids[1] else null end)
    or before_row.lecturer_2_id is distinct from (case when cardinality(normalized_ids) >= 2 then normalized_ids[2] else null end) then
    has_actual_change := true;
  end if;

  update public.class_schedules
  set schedule_date = target_schedule_date,
      start_time = target_start_time,
      end_time = target_end_time,
      room_id = target_room_id,
      student_count = target_student_count,
      lecturer_id = (case when cardinality(normalized_ids) >= 1 then normalized_ids[1] else null end),
      lecturer_2_id = (case when cardinality(normalized_ids) >= 2 then normalized_ids[2] else null end),
      updated_at = now()
  where id = target_schedule_id
  returning * into changed_row;

  if has_actual_change and target_room_type = basic_medical_room_type_id then
    mutation_id_val := gen_random_uuid();
    perform private.enqueue_basic_medical_schedule_outbox_event(
      changed_row.id,
      'schedule_updated',
      actor_id,
      mutation_id_val
    );
  end if;

  return changed_row;
exception when exclusion_violation then
  raise exception 'SCHEDULE_CONFLICT' using errcode = '23P01';
end;
$$;

revoke all on function public.update_class_schedule_details_core(uuid, date, time, time, uuid, integer, uuid[]) from public, anon, authenticated;


-- Source: supabase/schemas/25_basic_medical_equipment_request_wave_1.sql
-- Basic Medical Equipment Request Wave 1: shared immutable lifecycle foundation.
-- The source identity is intentionally an unfettered UUID snapshot so a cancelled
-- Basic Medical source may be removed without erasing request history.

do $$ begin
  create type public.equipment_request_domain as enum ('nursing_skills', 'basic_medical');
exception when duplicate_object then null;
end $$;

alter table public.equipment_requests
  add column if not exists request_domain public.equipment_request_domain,
  add column if not exists source_identity_id uuid;

update public.equipment_requests
set request_domain = 'nursing_skills'::public.equipment_request_domain,
    source_identity_id = class_schedule_id
where request_domain is null or source_identity_id is null;

alter table public.equipment_requests
  alter column request_domain set not null,
  alter column source_identity_id set not null,
  alter column class_schedule_id drop not null,
  drop constraint if exists equipment_requests_class_schedule_id_key,
  drop constraint if exists equipment_requests_class_schedule_id_fkey;

alter table public.equipment_requests
  add constraint equipment_requests_class_schedule_id_fkey
    foreign key (class_schedule_id) references public.class_schedules(id)
    on delete restrict deferrable initially deferred,
  add constraint equipment_requests_live_link_domain_check check (
    class_schedule_id is not null or request_domain = 'basic_medical'
  );

create unique index if not exists equipment_requests_domain_source_identity_key
  on public.equipment_requests (request_domain, source_identity_id);

alter table public.equipment_request_items
  alter column catalog_item_id drop not null,
  add column if not exists basic_medical_catalog_item_id uuid
    references public.basic_medical_equipment_catalog(id) on delete restrict,
  add constraint equipment_request_items_one_domain_catalog check (
    num_nonnulls(catalog_item_id, basic_medical_catalog_item_id) = 1
  );

create or replace function private.derive_equipment_request_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  basic_session_id uuid;
begin
  if tg_op = 'UPDATE' then
    if new.request_domain <> old.request_domain
      or new.source_identity_id <> old.source_identity_id then
      raise exception 'EQUIPMENT_REQUEST_DOMAIN_OR_SOURCE_IMMUTABLE' using errcode = '22023';
    end if;
    if new.class_schedule_id is distinct from old.class_schedule_id then
      if not (
        old.request_domain = 'basic_medical'
        and old.status = 'cancelled'
        and new.class_schedule_id is null
        and current_setting('app.basic_medical_equipment_tombstone', true) = 'true'
      ) then
        raise exception 'EQUIPMENT_REQUEST_LIVE_SOURCE_IMMUTABLE' using errcode = '22023';
      end if;
    end if;
    return new;
  end if;

  select sessions.id into basic_session_id
  from public.basic_medical_registration_sessions as sessions
  where sessions.class_schedule_id = new.class_schedule_id;

  if basic_session_id is null then
    new.request_domain := 'nursing_skills';
    new.source_identity_id := new.class_schedule_id;
  else
    new.request_domain := 'basic_medical';
    new.source_identity_id := basic_session_id;
  end if;
  return new;
end;
$$;

drop trigger if exists equipment_requests_derive_source on public.equipment_requests;
create trigger equipment_requests_derive_source
before insert or update on public.equipment_requests
for each row execute function private.derive_equipment_request_source();

create or replace function private.enforce_equipment_request_item_domain_catalog()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_domain_value public.equipment_request_domain;
begin
  select request_domain into request_domain_value
  from public.equipment_requests where id = new.request_id;
  if request_domain_value is null then
    raise exception 'EQUIPMENT_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if request_domain_value = 'nursing_skills' then
    if new.catalog_item_id is null or new.basic_medical_catalog_item_id is not null
      or not exists (select 1 from public.equipment_catalog where id = new.catalog_item_id and is_active) then
      raise exception 'EQUIPMENT_REQUEST_SKILLS_CATALOG_REQUIRED' using errcode = '22023';
    end if;
  elsif new.basic_medical_catalog_item_id is null or new.catalog_item_id is not null
    or not exists (select 1 from public.basic_medical_equipment_catalog where id = new.basic_medical_catalog_item_id and is_active) then
    raise exception 'EQUIPMENT_REQUEST_BASIC_MEDICAL_CATALOG_REQUIRED' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists equipment_request_items_domain_catalog on public.equipment_request_items;
create trigger equipment_request_items_domain_catalog
before insert or update on public.equipment_request_items
for each row execute function private.enforce_equipment_request_item_domain_catalog();

create or replace function private.can_manage_equipment_request(target_request_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.equipment_requests as requests
    where requests.id = target_request_id
      and (
        (select private.has_role('admin'))
        or (
          requests.request_domain = 'nursing_skills'
          and (select private.can_manage_equipment_schedule(requests.class_schedule_id))
        )
        or (
          requests.request_domain = 'basic_medical'
          and (select private.can_manage_basic_medical())
        )
      )
  );
$$;

create or replace function private.guard_equipment_request_delete()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.request_domain = 'basic_medical' then
    raise exception 'BASIC_MEDICAL_EQUIPMENT_REQUEST_HISTORY_IMMUTABLE' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists equipment_requests_preserve_basic_medical_history on public.equipment_requests;
create trigger equipment_requests_preserve_basic_medical_history
before delete on public.equipment_requests
for each row execute function private.guard_equipment_request_delete();

create or replace function private.detach_cancelled_basic_medical_equipment_tombstones()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.equipment_requests
    where class_schedule_id = old.id and request_domain = 'nursing_skills'
  ) then
    raise exception 'CLASS_EQUIPMENT_REQUEST_EXISTS' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.equipment_requests
    where class_schedule_id = old.id and request_domain = 'basic_medical'
      and status <> 'cancelled'
  ) then
    raise exception 'BASIC_MEDICAL_SESSION_REMOVAL_BLOCKED_BY_ACTIVE_EQUIPMENT_REQUEST' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.equipment_requests
    where class_schedule_id = old.id and request_domain = 'basic_medical'
  ) then
    perform set_config('app.basic_medical_equipment_tombstone', 'true', true);
    update public.equipment_requests
    set class_schedule_id = null
    where class_schedule_id = old.id and request_domain = 'basic_medical'
      and status = 'cancelled';
  end if;
  return old;
end;
$$;

drop trigger if exists equipment_requests_detach_basic_medical_tombstones on public.class_schedules;
create trigger equipment_requests_detach_basic_medical_tombstones
before delete on public.class_schedules
for each row execute function private.detach_cancelled_basic_medical_equipment_tombstones();

create or replace function public.create_equipment_request_with_items(
  target_class_schedule_id uuid, target_semester text,
  target_responsible_lecturer_id uuid, target_receive_at timestamptz,
  target_return_at timestamptz, target_note text,
  target_late_registration_reason text, target_items jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  actor_profile public.profiles;
  source_row record;
  request_id uuid;
  responsible_id uuid;
  req_late_status text;
begin
  if actor_id is null or not (select private.is_active_user()) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  select schedules.id as schedule_id, schedules.semester as schedule_semester,
         sessions.id as session_id, sessions.lesson_title, sessions.teaching_lecturer_id,
         registrations.semester as registration_semester, registrations.created_by,
         registrations.registrant_id
  into source_row
  from public.class_schedules schedules
  left join public.basic_medical_registration_sessions sessions on sessions.class_schedule_id = schedules.id
  left join public.basic_medical_registrations registrations on registrations.id = sessions.registration_id
  where schedules.id = target_class_schedule_id and schedules.schedule_status <> 'cancelled'
  for update of schedules;
  if source_row.schedule_id is null then raise exception 'EQUIPMENT_REQUEST_SOURCE_NOT_AVAILABLE' using errcode = 'P0002'; end if;
  if source_row.session_id is null then
    if not (select private.can_manage_equipment_schedule(target_class_schedule_id))
      and not (select private.has_role('lecturer')) and not (select private.has_role('teaching_assistant')) then
      raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode = '42501';
    end if;
    responsible_id := target_responsible_lecturer_id;
    if source_row.schedule_semester not in ('HK1','HK2','HK3','HK4') then raise exception 'EQUIPMENT_REQUEST_SEMESTER_REQUIRED' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text)
      left join public.equipment_catalog c on c.id = i.catalog_item_id
      where nullif(btrim(i.skill_name),'') is null or i.quantity is null or i.quantity < 1 or c.id is null or not c.is_active) then
      raise exception 'EQUIPMENT_REQUEST_SKILLS_CATALOG_REQUIRED' using errcode = '22023';
    end if;
  else
    if not ((select private.can_manage_basic_medical()) or actor_id in (source_row.created_by, source_row.registrant_id, source_row.teaching_lecturer_id)) then
      raise exception 'EQUIPMENT_REQUEST_BASIC_MEDICAL_SCOPE_REQUIRED' using errcode = '42501';
    end if;
    responsible_id := coalesce(target_responsible_lecturer_id, source_row.teaching_lecturer_id);
    if responsible_id <> source_row.teaching_lecturer_id and not ((select private.is_admin()) or (select private.can_manage_basic_medical())) then
      raise exception 'BASIC_MEDICAL_RESPONSIBLE_OVERRIDE_FORBIDDEN' using errcode = '42501';
    end if;
    if source_row.registration_semester not in ('HK1','HK2','HK3','HK4') then raise exception 'EQUIPMENT_REQUEST_SEMESTER_REQUIRED' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text)
      left join public.basic_medical_equipment_catalog c on c.id = i.catalog_item_id
      where i.quantity is null or i.quantity < 1 or c.id is null or not c.is_active) then
      raise exception 'EQUIPMENT_REQUEST_BASIC_MEDICAL_CATALOG_REQUIRED' using errcode = '22023';
    end if;
  end if;
  if target_items is null or jsonb_typeof(target_items) <> 'array' or jsonb_array_length(target_items) not between 1 and 500 then
    raise exception 'EQUIPMENT_REQUEST_ITEMS_REQUIRED' using errcode = '22023'; end if;
  select * into actor_profile from public.profiles where id = actor_id;
  if actor_profile.id is null or coalesce(actor_profile.phone,'') !~ '^\\d{10}$' then raise exception 'EQUIPMENT_REQUEST_PHONE_REQUIRED' using errcode = '22023'; end if;
  insert into public.equipment_requests(class_schedule_id,semester,registrant_id,responsible_lecturer_id,phone_snapshot,email_snapshot,receive_at,return_at,late_registration_reason,note,created_by)
  values(target_class_schedule_id, coalesce(source_row.registration_semester,source_row.schedule_semester), actor_id,responsible_id,actor_profile.phone,actor_profile.email,target_receive_at,target_return_at,nullif(btrim(target_late_registration_reason),''),nullif(btrim(target_note),''),actor_id)
  returning id into request_id;
  if source_row.session_id is null then
    insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,quantity,note)
    select request_id,btrim(i.skill_name),i.catalog_item_id,i.quantity,nullif(btrim(i.note),'') from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text);
  else
    insert into public.equipment_request_items(request_id,skill_name,basic_medical_catalog_item_id,quantity,note)
    select request_id,source_row.lesson_title,i.catalog_item_id,i.quantity,nullif(btrim(i.note),'') from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text);
  end if;
  select late_approval_status into req_late_status from public.equipment_requests where id=request_id;
  perform private.enqueue_equipment_request_outbox_event(request_id,case when req_late_status='pending' then 'late_approval_requested' else 'created' end,null,actor_id);
  return request_id;
end; $$;

create or replace function public.hard_delete_equipment_request(target_request_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.equipment_requests where id=target_request_id and request_domain='basic_medical') then return false; end if;
  if not (select private.can_hard_delete()) then raise exception 'HARD_DELETE_AUTHORITY_REQUIRED' using errcode='42501'; end if;
  delete from public.equipment_request_items where request_id=target_request_id;
  delete from public.equipment_requests where id=target_request_id;
  return found;
end; $$;

create or replace function public.save_basic_medical_registration(
  target_registration_id uuid default null, target_academic_year text default null, target_semester text default null,
  target_start_date date default null, target_end_date date default null, target_course_id uuid default null, target_room_id uuid default null,
  target_student_count integer default null, target_responsible_lecturer_id uuid default null, target_note text default null, target_sessions jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid()); registration_id_value uuid; registration_owner_id uuid;
  course_row record; session_row record; existing_session record; schedule_id_value uuid; session_number_value integer := 0; event_type_val text; mutation_id_val uuid;
  responsible_id uuid; basic_medical_room_type_id constant uuid := '40000000-0000-0000-0000-000000000002'::uuid;
begin
  if actor_id is null or not (select private.is_active_user()) then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  if target_sessions is null or jsonb_typeof(target_sessions) <> 'array' or jsonb_array_length(target_sessions) not between 1 and 500 then raise exception 'BASIC_MEDICAL_SESSIONS_REQUIRED' using errcode='22023'; end if;
  if exists (select 1 from jsonb_to_recordset(target_sessions) s(session_id uuid,schedule_date date,start_time time,end_time time,lesson_title text,teaching_lecturer_id uuid)
    left join public.profiles p on p.id=s.teaching_lecturer_id
    where s.schedule_date is null or s.schedule_date not between target_start_date and target_end_date or s.start_time < time '07:00' or s.end_time > time '21:00' or s.end_time <= s.start_time or nullif(btrim(s.lesson_title),'') is null
      or p.id is null or not p.is_active or not exists(select 1 from public.user_roles r where r.user_id=p.id and r.role='lecturer')
      or not exists(select 1 from public.profile_room_types a where a.profile_id=p.id and a.room_type_id=basic_medical_room_type_id)) then raise exception 'BASIC_MEDICAL_SESSION_INVALID' using errcode='22023'; end if;
  if exists (select 1 from jsonb_to_recordset(target_sessions) s(session_id uuid) where s.session_id is not null group by s.session_id having count(*) > 1) then raise exception 'BASIC_MEDICAL_SESSION_ID_DUPLICATE' using errcode='22023'; end if;
  select course_code,course_name into course_row from public.courses where id=target_course_id and is_active and room_type_id=basic_medical_room_type_id;
  if course_row.course_code is null or not exists(select 1 from public.rooms where id=target_room_id and is_active and room_type_id=basic_medical_room_type_id) then raise exception 'BASIC_MEDICAL_SOURCE_INVALID' using errcode='22023'; end if;
  perform set_config('app.basic_medical_registration_mutation','true',true);
  if target_registration_id is null then
    event_type_val := 'created'; mutation_id_val := null;
    if not ((select private.can_manage_basic_medical()) or (select private.has_role('lecturer')) or (select private.has_role('teaching_assistant'))) then raise exception 'BASIC_MEDICAL_SAVE_FORBIDDEN' using errcode='42501'; end if;
    insert into public.basic_medical_registrations(academic_year,semester,start_date,end_date,course_id,room_id,student_count,registrant_id,responsible_lecturer_id,note,created_by)
    values(target_academic_year,target_semester,target_start_date,target_end_date,target_course_id,target_room_id,target_student_count,actor_id,coalesce(target_responsible_lecturer_id,(target_sessions->0->>'teaching_lecturer_id')::uuid),nullif(btrim(target_note),''),actor_id)
    returning id,created_by into registration_id_value,registration_owner_id;
  else
    event_type_val := 'updated'; mutation_id_val := gen_random_uuid();
    select id,created_by into registration_id_value,registration_owner_id from public.basic_medical_registrations where id=target_registration_id for update;
    if registration_id_value is null then raise exception 'BASIC_MEDICAL_REGISTRATION_NOT_FOUND' using errcode='P0002'; end if;
    if exists(select 1 from public.basic_medical_registrations where id=registration_id_value and cancelled_at is not null) then raise exception 'REGISTRATION_CANCELLED' using errcode='55000'; end if;
    if registration_owner_id<>actor_id and not (select private.can_manage_basic_medical()) then raise exception 'BASIC_MEDICAL_SAVE_FORBIDDEN' using errcode='42501'; end if;
    if exists(select 1 from jsonb_to_recordset(target_sessions) s(session_id uuid) where s.session_id is not null and not exists(select 1 from public.basic_medical_registration_sessions x where x.id=s.session_id and x.registration_id=registration_id_value)) then raise exception 'BASIC_MEDICAL_SESSION_ID_FOREIGN' using errcode='22023'; end if;
    delete from public.class_schedules schedules using public.basic_medical_registration_sessions sessions
    where sessions.registration_id=registration_id_value and schedules.id=sessions.class_schedule_id
      and not exists(select 1 from jsonb_to_recordset(target_sessions) s(session_id uuid) where s.session_id=sessions.id);
    update public.basic_medical_registrations set academic_year=target_academic_year,semester=target_semester,start_date=target_start_date,end_date=target_end_date,course_id=target_course_id,room_id=target_room_id,student_count=target_student_count,note=nullif(btrim(target_note),'') where id=registration_id_value;
  end if;
  for session_row in select * from jsonb_to_recordset(target_sessions) s(session_id uuid,schedule_date date,start_time time,end_time time,lesson_title text,teaching_lecturer_id uuid) loop
    session_number_value:=session_number_value+1;
    if session_row.session_id is not null then
      select * into existing_session from public.basic_medical_registration_sessions where id=session_row.session_id and registration_id=registration_id_value for update;
      if existing_session.cancelled_at is not null or exists(select 1 from public.class_schedules where id=existing_session.class_schedule_id and schedule_status='cancelled') then raise exception 'BASIC_MEDICAL_SESSION_CANCELLED' using errcode='22023'; end if;
      update public.class_schedules set course_id=target_course_id,course_code_snapshot=course_row.course_code,course_name_snapshot=course_row.course_name,room_id=target_room_id,lecturer_id=session_row.teaching_lecturer_id,schedule_date=session_row.schedule_date,start_time=session_row.start_time,end_time=session_row.end_time,note=nullif(btrim(target_note),''),student_count=target_student_count where id=existing_session.class_schedule_id;
      update public.basic_medical_registration_sessions set session_number=session_number_value,lesson_title=btrim(session_row.lesson_title),teaching_lecturer_id=session_row.teaching_lecturer_id where id=existing_session.id;
    else
      insert into public.class_schedules(course_id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,lecturer_2_id,schedule_date,start_time,end_time,source,schedule_status,note,student_count,created_by,published_by,published_at,basic_medical_registration_id)
      values(target_course_id,course_row.course_code,course_row.course_name,target_room_id,session_row.teaching_lecturer_id,null,session_row.schedule_date,session_row.start_time,session_row.end_time,'manual','published',nullif(btrim(target_note),''),target_student_count,registration_owner_id,actor_id,now(),registration_id_value)
      returning id into schedule_id_value;
      insert into public.basic_medical_registration_sessions(registration_id,class_schedule_id,lesson_title,teaching_lecturer_id,session_number) values(registration_id_value,schedule_id_value,btrim(session_row.lesson_title),session_row.teaching_lecturer_id,session_number_value);
    end if;
  end loop;
  responsible_id := coalesce(target_responsible_lecturer_id,(target_sessions->0->>'teaching_lecturer_id')::uuid);
  if responsible_id <> (target_sessions->0->>'teaching_lecturer_id')::uuid and not ((select private.is_admin()) or (select private.can_manage_basic_medical())) then raise exception 'BASIC_MEDICAL_RESPONSIBLE_OVERRIDE_FORBIDDEN' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles p where p.id=responsible_id and p.is_active and exists(select 1 from public.user_roles r where r.user_id=p.id and r.role='lecturer') and exists(select 1 from public.profile_room_types a where a.profile_id=p.id and a.room_type_id=basic_medical_room_type_id)) then raise exception 'BASIC_MEDICAL_RESPONSIBLE_INVALID' using errcode='22023'; end if;
  update public.basic_medical_registrations set responsible_lecturer_id=responsible_id where id=registration_id_value;
  perform private.enqueue_basic_medical_registration_outbox_event(registration_id_value,event_type_val,actor_id,mutation_id_val);
  return registration_id_value;
end; $$;

revoke all on function private.derive_equipment_request_source() from public, anon, authenticated;
revoke all on function private.enforce_equipment_request_item_domain_catalog() from public, anon, authenticated;
revoke all on function private.guard_equipment_request_delete() from public, anon, authenticated;
revoke all on function private.detach_cancelled_basic_medical_equipment_tombstones() from public, anon, authenticated;
revoke all on function public.create_equipment_request_with_items(uuid,text,uuid,timestamptz,timestamptz,text,text,jsonb) from public, anon;
grant execute on function public.create_equipment_request_with_items(uuid,text,uuid,timestamptz,timestamptz,text,text,jsonb) to authenticated;
revoke all on function public.save_basic_medical_registration(uuid,text,text,date,date,uuid,uuid,integer,uuid,text,jsonb) from public, anon;
grant execute on function public.save_basic_medical_registration(uuid,text,text,date,date,uuid,uuid,integer,uuid,text,jsonb) to authenticated;


-- Source: supabase/schemas/26_basic_medical_equipment_request_blockers.sql
-- Wave 1 external-review blockers: make the shared request lifecycle domain aware
-- without changing the immutable domain/source architecture introduced in Wave 1.

create or replace function private.enforce_equipment_request_semester_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_semester text;
  target_room_type_id uuid;
  skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
begin
  if new.request_domain = 'basic_medical' then
    -- A cancelled Basic Medical request may intentionally outlive its live schedule.
    if new.class_schedule_id is null then
      if tg_op = 'UPDATE' and old.request_domain = 'basic_medical' and old.status = 'cancelled' then
        new.semester := old.semester;
        return new;
      end if;
      raise exception 'BASIC_MEDICAL_SOURCE_INVALID' using errcode = '22023';
    end if;

    select registrations.semester
    into target_semester
    from public.basic_medical_registration_sessions as sessions
    join public.basic_medical_registrations as registrations on registrations.id = sessions.registration_id
    where sessions.id = new.source_identity_id
      and sessions.class_schedule_id = new.class_schedule_id
      and registrations.cancelled_at is null;

    if target_semester not in ('HK1', 'HK2', 'HK3', 'HK4') then
      raise exception 'BASIC_MEDICAL_SOURCE_INVALID' using errcode = '22023';
    end if;
    new.semester := target_semester;
    return new;
  end if;

  if new.class_schedule_id is null then
    raise exception 'Lớp Skills lab không hợp lệ.' using errcode = '22023';
  end if;

  select schedules.semester, rooms.room_type_id
  into target_semester, target_room_type_id
  from public.class_schedules as schedules
  join public.rooms as rooms on rooms.id = schedules.room_id
  where schedules.id = new.class_schedule_id
    and schedules.schedule_status <> 'cancelled';

  if target_room_type_id is null or target_room_type_id <> skills_room_type_id then
    raise exception 'Lớp Skills lab không hợp lệ hoặc đã bị hủy.' using errcode = '22023';
  end if;
  if target_semester not in ('HK1', 'HK2', 'HK3', 'HK4') then
    raise exception 'Lịch học chưa có thông tin Học kỳ hợp lệ.' using errcode = '22023';
  end if;
  new.semester := target_semester;
  return new;
end;
$$;

create or replace function private.validate_equipment_request_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
  basic_medical_room_type_id constant uuid := '40000000-0000-0000-0000-000000000002'::uuid;
  default_responsible_id uuid;
begin
  if new.semester not in ('HK1', 'HK2', 'HK3', 'HK4') then
    raise exception 'Học kỳ phải là HK1, HK2, HK3 hoặc HK4.' using errcode = '22023';
  end if;
  if length(coalesce(new.note, '')) > 2000 then
    raise exception 'Ghi chú không được vượt quá 2000 ký tự.' using errcode = '22023';
  end if;
  if length(coalesce(new.late_registration_reason, '')) > 1000 then
    raise exception 'Lý do đăng ký trễ không được vượt quá 1000 ký tự.' using errcode = '22023';
  end if;

  if new.request_domain = 'basic_medical' then
    select sessions.teaching_lecturer_id
    into default_responsible_id
    from public.basic_medical_registration_sessions as sessions
    where sessions.id = new.source_identity_id
      and sessions.class_schedule_id = new.class_schedule_id;

    if default_responsible_id is null then
      -- Tombstones retain their already validated responsible lecturer.
      if tg_op = 'UPDATE' and new.class_schedule_id is null and old.status = 'cancelled' then
        default_responsible_id := old.responsible_lecturer_id;
      else
        raise exception 'BASIC_MEDICAL_SOURCE_INVALID' using errcode = '22023';
      end if;
    end if;
    if new.responsible_lecturer_id <> default_responsible_id
      and not ((select private.is_admin()) or (select private.can_manage_basic_medical())) then
      raise exception 'BASIC_MEDICAL_RESPONSIBLE_OVERRIDE_FORBIDDEN' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.profiles as profiles
      where profiles.id = new.responsible_lecturer_id
        and profiles.is_active
        and exists (select 1 from public.user_roles roles where roles.user_id = profiles.id and roles.role = 'lecturer')
        and exists (select 1 from public.profile_room_types scopes where scopes.profile_id = profiles.id and scopes.room_type_id = basic_medical_room_type_id)
    ) then
      raise exception 'BASIC_MEDICAL_RESPONSIBLE_INVALID' using errcode = '22023';
    end if;
    return new;
  end if;

  if not exists (
    select 1 from public.profiles as profiles
    where profiles.id = new.responsible_lecturer_id
      and profiles.is_active
      and exists (select 1 from public.user_roles roles where roles.user_id = profiles.id and roles.role = 'lecturer')
      and exists (select 1 from public.profile_room_types scopes where scopes.profile_id = profiles.id and scopes.room_type_id = skills_room_type_id)
  ) then
    raise exception 'Giảng viên phụ trách không hợp lệ.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function private.validate_equipment_request_timing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_schedule_date date;
  target_room_type_id uuid;
  receive_local timestamp;
  return_local timestamp;
  skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
  basic_medical_room_type_id constant uuid := '40000000-0000-0000-0000-000000000002'::uuid;
begin
  if current_setting('app.equipment_confirmation_rpc', true) = 'true' then return new; end if;
  if tg_op = 'UPDATE'
    and new.class_schedule_id is not distinct from old.class_schedule_id
    and new.receive_at is not distinct from old.receive_at
    and new.return_at is not distinct from old.return_at then return new; end if;
  if new.class_schedule_id is null and new.request_domain = 'basic_medical' and tg_op = 'UPDATE' and old.status = 'cancelled' then
    return new;
  end if;

  select schedules.schedule_date, rooms.room_type_id
  into target_schedule_date, target_room_type_id
  from public.class_schedules as schedules
  join public.rooms as rooms on rooms.id = schedules.room_id
  where schedules.id = new.class_schedule_id and schedules.schedule_status <> 'cancelled';

  if target_schedule_date is null
    or (new.request_domain = 'nursing_skills' and target_room_type_id <> skills_room_type_id)
    or (new.request_domain = 'basic_medical' and target_room_type_id <> basic_medical_room_type_id) then
    raise exception 'EQUIPMENT_REQUEST_SOURCE_SCHEDULE_INVALID' using errcode = '22023';
  end if;

  receive_local := new.receive_at at time zone 'Asia/Ho_Chi_Minh';
  return_local := new.return_at at time zone 'Asia/Ho_Chi_Minh';
  if receive_local::date < (now() at time zone 'Asia/Ho_Chi_Minh')::date
    or receive_local::date > target_schedule_date
    or return_local < receive_local
    or return_local::date < target_schedule_date
    or receive_local::time not in (time '09:00', time '11:00', time '14:00', time '16:00')
    or return_local::time not in (time '09:00', time '11:00', time '14:00', time '16:00') then
    raise exception 'EQUIPMENT_REQUEST_TIMING_INVALID' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_equipment_request_room_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  request_domain_value public.equipment_request_domain := coalesce(new.request_domain, old.request_domain);
begin
  -- Physical deletion is only reachable through the gated hard-delete RPC;
  -- retain TB-06's trigger-level bypass for that SECURITY DEFINER path.
  if tg_op = 'DELETE' then return old; end if;
  if (select auth.role()) = 'service_role' or (select private.has_role('admin')) then return coalesce(new, old); end if;
  if (select private.has_role('staff')) then
    if (request_domain_value = 'basic_medical' and not (select private.can_manage_basic_medical()))
      or (request_domain_value = 'nursing_skills' and not (select private.can_manage_equipment_schedule(coalesce(new.class_schedule_id, old.class_schedule_id)))) then
      raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode = '42501';
    end if;
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and new.registrant_id = actor_id and new.created_by = actor_id then return new; end if;
  if tg_op = 'UPDATE' and ((old.registrant_id = actor_id and new.registrant_id = actor_id) or (old.responsible_lecturer_id = actor_id and new.responsible_lecturer_id = actor_id)) then return new; end if;
  raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode = '42501';
end;
$$;

-- Preserve the original TB-06 Skills hard-delete sequence. Basic Medical history
-- is deliberately a tombstone-only lifecycle and is never physically deleted.
create or replace function public.hard_delete_equipment_request(target_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  req_row public.equipment_requests;
  deleted_count integer := 0;
begin
  select * into req_row from public.equipment_requests where id = target_request_id for update;
  if req_row.id is null then return false; end if;
  if req_row.request_domain = 'basic_medical' then return false; end if;
  if not (select private.can_hard_delete()) then raise exception 'HARD_DELETE_AUTHORITY_REQUIRED' using errcode = '42501'; end if;
  perform private.enqueue_equipment_request_outbox_event(target_request_id, 'deleted', actor_id);
  delete from public.equipment_request_items where request_id = target_request_id;
  delete from public.equipment_requests where id = target_request_id;
  get diagnostics deleted_count = row_count;
  if deleted_count > 0 then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id)
    values (actor_id, 'equipment_request.hard_deleted', 'equipment_request', target_request_id);
  end if;
  return deleted_count > 0;
end;
$$;

-- The Wave 1 RPC used a double-escaped phone expression. Re-declare it here so
-- the shared domain triggers are reachable by valid Basic Medical callers.
create or replace function public.create_equipment_request_with_items(
  target_class_schedule_id uuid, target_semester text, target_responsible_lecturer_id uuid,
  target_receive_at timestamptz, target_return_at timestamptz, target_note text,
  target_late_registration_reason text, target_items jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid()); actor_profile public.profiles; source_row record;
  request_id uuid; responsible_id uuid; req_late_status text;
begin
  if actor_id is null or not (select private.is_active_user()) then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select schedules.id as schedule_id, schedules.semester as schedule_semester, sessions.id as session_id,
         sessions.lesson_title, sessions.teaching_lecturer_id, registrations.semester as registration_semester,
         registrations.created_by, registrations.registrant_id
  into source_row from public.class_schedules schedules
  left join public.basic_medical_registration_sessions sessions on sessions.class_schedule_id = schedules.id
  left join public.basic_medical_registrations registrations on registrations.id = sessions.registration_id
  where schedules.id = target_class_schedule_id and schedules.schedule_status <> 'cancelled' for update of schedules;
  if source_row.schedule_id is null then raise exception 'EQUIPMENT_REQUEST_SOURCE_NOT_AVAILABLE' using errcode = 'P0002'; end if;
  if source_row.session_id is null then
    if not (select private.can_manage_equipment_schedule(target_class_schedule_id)) and not (select private.has_role('lecturer')) and not (select private.has_role('teaching_assistant')) then raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode = '42501'; end if;
    responsible_id := target_responsible_lecturer_id;
    if source_row.schedule_semester not in ('HK1','HK2','HK3','HK4') then raise exception 'EQUIPMENT_REQUEST_SEMESTER_REQUIRED' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text) left join public.equipment_catalog c on c.id=i.catalog_item_id where nullif(btrim(i.skill_name),'') is null or i.quantity is null or i.quantity < 1 or c.id is null or not c.is_active) then raise exception 'EQUIPMENT_REQUEST_SKILLS_CATALOG_REQUIRED' using errcode = '22023'; end if;
  else
    if not ((select private.can_manage_basic_medical()) or actor_id in (source_row.created_by,source_row.registrant_id,source_row.teaching_lecturer_id)) then raise exception 'EQUIPMENT_REQUEST_BASIC_MEDICAL_SCOPE_REQUIRED' using errcode = '42501'; end if;
    responsible_id := coalesce(target_responsible_lecturer_id,source_row.teaching_lecturer_id);
    if responsible_id <> source_row.teaching_lecturer_id and not ((select private.is_admin()) or (select private.can_manage_basic_medical())) then raise exception 'BASIC_MEDICAL_RESPONSIBLE_OVERRIDE_FORBIDDEN' using errcode = '42501'; end if;
    if source_row.registration_semester not in ('HK1','HK2','HK3','HK4') then raise exception 'EQUIPMENT_REQUEST_SEMESTER_REQUIRED' using errcode = '22023'; end if;
    if exists (select 1 from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text) left join public.basic_medical_equipment_catalog c on c.id=i.catalog_item_id where nullif(btrim(i.skill_name),'') is null or i.quantity is null or i.quantity < 1 or c.id is null or not c.is_active) then raise exception 'EQUIPMENT_REQUEST_BASIC_MEDICAL_CATALOG_REQUIRED' using errcode = '22023'; end if;
  end if;
  if target_items is null or jsonb_typeof(target_items) <> 'array' or jsonb_array_length(target_items) not between 1 and 500 then raise exception 'EQUIPMENT_REQUEST_ITEMS_REQUIRED' using errcode = '22023'; end if;
  select * into actor_profile from public.profiles where id=actor_id;
  if actor_profile.id is null or coalesce(actor_profile.phone,'') !~ '^\d{10}$' then raise exception 'EQUIPMENT_REQUEST_PHONE_REQUIRED' using errcode = '22023'; end if;
  insert into public.equipment_requests(class_schedule_id,semester,registrant_id,responsible_lecturer_id,phone_snapshot,email_snapshot,receive_at,return_at,late_registration_reason,note,created_by)
  values(target_class_schedule_id,coalesce(source_row.registration_semester,source_row.schedule_semester),actor_id,responsible_id,actor_profile.phone,actor_profile.email,target_receive_at,target_return_at,nullif(btrim(target_late_registration_reason),''),nullif(btrim(target_note),''),actor_id)
  returning id,status into request_id,req_late_status;
  insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,basic_medical_catalog_item_id,quantity,note)
  select request_id,coalesce(nullif(btrim(i.skill_name),''),source_row.lesson_title),case when source_row.session_id is null then i.catalog_item_id else null end,case when source_row.session_id is not null then i.catalog_item_id else null end,i.quantity,nullif(btrim(i.note),'') from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text);
  return request_id;
end;
$$;

create or replace function public.save_basic_medical_registration(
  target_registration_id uuid default null, target_academic_year text default null, target_semester text default null,
  target_start_date date default null, target_end_date date default null, target_course_id uuid default null, target_room_id uuid default null,
  target_student_count integer default null, target_responsible_lecturer_id uuid default null, target_note text default null, target_sessions jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  registration_id_value uuid;
  registration_owner_id uuid;
  course_row record;
  session_row record;
  existing_session record;
  schedule_id_value uuid;
  session_number_value integer := 0;
  event_type_val text;
  mutation_id_val uuid;
  responsible_id uuid;
  is_manager boolean := (select private.can_manage_basic_medical());
  is_eligible_creator boolean;
  basic_medical_room_type_id constant uuid := '40000000-0000-0000-0000-000000000002'::uuid;
begin
  if actor_id is null or not (select private.is_active_user()) then raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  is_eligible_creator := exists (
    select 1 from public.profiles profiles
    where profiles.id = actor_id and profiles.is_active and profiles.allow_basic_medical_access
  ) and ((select private.has_role('lecturer')) or (select private.has_role('teaching_assistant')))
    and (select private.has_room_type(basic_medical_room_type_id));
  if not is_manager and not is_eligible_creator then raise exception 'BASIC_MEDICAL_SAVE_FORBIDDEN' using errcode = '42501'; end if;

  if target_academic_year !~ '^\d{4}-\d{4}$'
    or substring(target_academic_year from 6 for 4)::integer <> substring(target_academic_year from 1 for 4)::integer + 1 then
    raise exception 'BASIC_MEDICAL_ACADEMIC_YEAR_INVALID' using errcode = '22023';
  end if;
  if target_semester not in ('HK1', 'HK2', 'HK3', 'HK4') then raise exception 'BASIC_MEDICAL_SEMESTER_INVALID' using errcode = '22023'; end if;
  if target_start_date is null or target_end_date is null or target_end_date < target_start_date then raise exception 'BASIC_MEDICAL_DATE_RANGE_INVALID' using errcode = '22023'; end if;
  if target_student_count is null or target_student_count < 1 then raise exception 'BASIC_MEDICAL_STUDENT_COUNT_INVALID' using errcode = '22023'; end if;
  if target_sessions is null or jsonb_typeof(target_sessions) <> 'array' or jsonb_array_length(target_sessions) not between 1 and 500 then raise exception 'BASIC_MEDICAL_SESSIONS_REQUIRED' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_to_recordset(target_sessions) s(session_id uuid) where s.session_id is not null group by s.session_id having count(*) > 1) then raise exception 'BASIC_MEDICAL_SESSION_ID_DUPLICATE' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_to_recordset(target_sessions) s(session_id uuid,schedule_date date,start_time time,end_time time,lesson_title text,teaching_lecturer_id uuid)
    left join public.profiles p on p.id=s.teaching_lecturer_id
    where s.schedule_date is null or s.schedule_date not between target_start_date and target_end_date or s.start_time is null or s.start_time < time '07:00' or s.end_time is null or s.end_time > time '21:00' or s.end_time <= s.start_time or nullif(btrim(s.lesson_title),'') is null
      or p.id is null or not p.is_active or not exists(select 1 from public.user_roles r where r.user_id=p.id and r.role='lecturer')
      or not exists(select 1 from public.profile_room_types a where a.profile_id=p.id and a.room_type_id=basic_medical_room_type_id)) then raise exception 'BASIC_MEDICAL_SESSION_INVALID' using errcode='22023'; end if;
  select course_code, course_name into course_row from public.courses where id=target_course_id and is_active and room_type_id=basic_medical_room_type_id;
  if course_row.course_code is null or not exists(select 1 from public.rooms where id=target_room_id and is_active and room_type_id=basic_medical_room_type_id) then raise exception 'BASIC_MEDICAL_SOURCE_INVALID' using errcode='22023'; end if;

  perform set_config('app.basic_medical_registration_mutation','true',true);
  if target_registration_id is null then
    event_type_val := 'created'; mutation_id_val := null;
    insert into public.basic_medical_registrations(academic_year,semester,start_date,end_date,course_id,room_id,student_count,registrant_id,responsible_lecturer_id,note,created_by)
    values(target_academic_year,target_semester,target_start_date,target_end_date,target_course_id,target_room_id,target_student_count,actor_id,coalesce(target_responsible_lecturer_id,(target_sessions->0->>'teaching_lecturer_id')::uuid),nullif(btrim(target_note),''),actor_id)
    returning id,created_by into registration_id_value,registration_owner_id;
  else
    event_type_val := 'updated'; mutation_id_val := gen_random_uuid();
    select id,created_by into registration_id_value,registration_owner_id from public.basic_medical_registrations where id=target_registration_id for update;
    if registration_id_value is null then raise exception 'BASIC_MEDICAL_REGISTRATION_NOT_FOUND' using errcode='P0002'; end if;
    if exists(select 1 from public.basic_medical_registrations where id=registration_id_value and cancelled_at is not null) then raise exception 'REGISTRATION_CANCELLED' using errcode='55000'; end if;
    if not is_manager and registration_owner_id <> actor_id then raise exception 'BASIC_MEDICAL_SAVE_FORBIDDEN' using errcode='42501'; end if;
    if exists(select 1 from jsonb_to_recordset(target_sessions) s(session_id uuid) where s.session_id is not null and not exists(select 1 from public.basic_medical_registration_sessions x where x.id=s.session_id and x.registration_id=registration_id_value)) then raise exception 'BASIC_MEDICAL_SESSION_ID_FOREIGN' using errcode='22023'; end if;
    delete from public.class_schedules schedules using public.basic_medical_registration_sessions sessions
    where sessions.registration_id=registration_id_value and schedules.id=sessions.class_schedule_id
      and not exists(select 1 from jsonb_to_recordset(target_sessions) s(session_id uuid) where s.session_id=sessions.id);
    -- Shift retained identities out of the 1..500 user range before assigning
    -- final positions, so swaps and longer permutations never violate the key.
    update public.basic_medical_registration_sessions
    set session_number = session_number + 1000000
    where registration_id = registration_id_value
      and id in (select s.session_id from jsonb_to_recordset(target_sessions) s(session_id uuid) where s.session_id is not null);
    update public.basic_medical_registrations set academic_year=target_academic_year,semester=target_semester,start_date=target_start_date,end_date=target_end_date,course_id=target_course_id,room_id=target_room_id,student_count=target_student_count,note=nullif(btrim(target_note),'') where id=registration_id_value;
  end if;

  for session_row in select * from jsonb_to_recordset(target_sessions) s(session_id uuid,schedule_date date,start_time time,end_time time,lesson_title text,teaching_lecturer_id uuid) loop
    session_number_value := session_number_value + 1;
    if session_row.session_id is not null then
      select * into existing_session from public.basic_medical_registration_sessions where id=session_row.session_id and registration_id=registration_id_value for update;
      if existing_session.cancelled_at is not null or exists(select 1 from public.class_schedules where id=existing_session.class_schedule_id and schedule_status='cancelled') then raise exception 'BASIC_MEDICAL_SESSION_CANCELLED' using errcode='22023'; end if;
      update public.class_schedules set course_id=target_course_id,course_code_snapshot=course_row.course_code,course_name_snapshot=course_row.course_name,room_id=target_room_id,lecturer_id=session_row.teaching_lecturer_id,schedule_date=session_row.schedule_date,start_time=session_row.start_time,end_time=session_row.end_time,note=nullif(btrim(target_note),''),student_count=target_student_count where id=existing_session.class_schedule_id;
      update public.basic_medical_registration_sessions set session_number=session_number_value,lesson_title=btrim(session_row.lesson_title),teaching_lecturer_id=session_row.teaching_lecturer_id where id=existing_session.id;
    else
      insert into public.class_schedules(course_id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,lecturer_2_id,schedule_date,start_time,end_time,source,schedule_status,note,student_count,created_by,published_by,published_at,basic_medical_registration_id)
      values(target_course_id,course_row.course_code,course_row.course_name,target_room_id,session_row.teaching_lecturer_id,null,session_row.schedule_date,session_row.start_time,session_row.end_time,'manual','published',nullif(btrim(target_note),''),target_student_count,registration_owner_id,actor_id,now(),registration_id_value)
      returning id into schedule_id_value;
      insert into public.basic_medical_registration_sessions(registration_id,class_schedule_id,lesson_title,teaching_lecturer_id,session_number) values(registration_id_value,schedule_id_value,btrim(session_row.lesson_title),session_row.teaching_lecturer_id,session_number_value);
    end if;
  end loop;
  responsible_id := coalesce(target_responsible_lecturer_id,(target_sessions->0->>'teaching_lecturer_id')::uuid);
  if responsible_id <> (target_sessions->0->>'teaching_lecturer_id')::uuid and not ((select private.is_admin()) or is_manager) then raise exception 'BASIC_MEDICAL_RESPONSIBLE_OVERRIDE_FORBIDDEN' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles p where p.id=responsible_id and p.is_active and exists(select 1 from public.user_roles r where r.user_id=p.id and r.role='lecturer') and exists(select 1 from public.profile_room_types a where a.profile_id=p.id and a.room_type_id=basic_medical_room_type_id)) then raise exception 'BASIC_MEDICAL_RESPONSIBLE_INVALID' using errcode='22023'; end if;
  update public.basic_medical_registrations set responsible_lecturer_id=responsible_id where id=registration_id_value;
  perform private.enqueue_basic_medical_registration_outbox_event(registration_id_value,event_type_val,actor_id,mutation_id_val);
  return registration_id_value;
end;
$$;

revoke all on function private.enforce_equipment_request_semester_authority() from public, anon, authenticated;
revoke all on function private.validate_equipment_request_content() from public, anon, authenticated;
revoke all on function private.enforce_equipment_request_room_scope() from public, anon, authenticated;
revoke all on function public.hard_delete_equipment_request(uuid) from public, anon;
grant execute on function public.hard_delete_equipment_request(uuid) to authenticated;
revoke all on function public.create_equipment_request_with_items(uuid,text,uuid,timestamptz,timestamptz,text,text,jsonb) from public, anon;
grant execute on function public.create_equipment_request_with_items(uuid,text,uuid,timestamptz,timestamptz,text,text,jsonb) to authenticated;
revoke all on function public.save_basic_medical_registration(uuid,text,text,date,date,uuid,uuid,integer,uuid,text,jsonb) from public, anon;
grant execute on function public.save_basic_medical_registration(uuid,text,text,date,date,uuid,uuid,integer,uuid,text,jsonb) to authenticated;


-- Source: supabase/schemas/27_equipment_request_skills_compatibility.sql
-- Preserve established Nursing Skills contracts alongside Wave 1 source identity.

create or replace function private.enforce_equipment_request_semester_authority()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_semester text; target_room_type_id uuid; skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
begin
  if new.request_domain='basic_medical' then
    if new.class_schedule_id is null then
      if tg_op='UPDATE' and old.request_domain='basic_medical' and old.status='cancelled' then new.semester:=old.semester; return new; end if;
      raise exception 'BASIC_MEDICAL_SOURCE_INVALID' using errcode='22023';
    end if;
    select r.semester into target_semester from public.basic_medical_registration_sessions s join public.basic_medical_registrations r on r.id=s.registration_id where s.id=new.source_identity_id and s.class_schedule_id=new.class_schedule_id and r.cancelled_at is null;
    if target_semester is null or target_semester not in ('HK1','HK2','HK3','HK4') then raise exception 'BASIC_MEDICAL_SOURCE_INVALID' using errcode='22023'; end if;
    new.semester:=target_semester; return new;
  end if;
  if new.class_schedule_id is null then raise exception 'Lớp Skills lab không hợp lệ.' using errcode='22023'; end if;
  select s.semester,r.room_type_id into target_semester,target_room_type_id from public.class_schedules s join public.rooms r on r.id=s.room_id where s.id=new.class_schedule_id and s.schedule_status<>'cancelled';
  if target_room_type_id is null or target_room_type_id<>skills_room_type_id then raise exception 'Lớp Skills lab không hợp lệ hoặc đã bị hủy.' using errcode='22023'; end if;
  if target_semester is null or target_semester not in ('HK1','HK2','HK3','HK4') then
    if tg_op='UPDATE' and new.class_schedule_id is not distinct from old.class_schedule_id and old.semester in ('HK1','HK2','HK3','HK4') then new.semester:=old.semester; return new; end if;
    raise exception 'Lịch học chưa có thông tin Học kỳ hợp lệ.' using errcode='22023';
  end if;
  new.semester:=target_semester; return new;
end; $$;

create or replace function private.validate_equipment_request_timing()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare target_schedule_date date; target_room_type_id uuid; receive_local timestamp; return_local timestamp;
  skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid; basic_medical_room_type_id constant uuid := '40000000-0000-0000-0000-000000000002'::uuid;
begin
  if current_setting('app.equipment_confirmation_rpc',true)='true' then return new; end if;
  if tg_op='UPDATE' and new.class_schedule_id is not distinct from old.class_schedule_id and new.receive_at is not distinct from old.receive_at and new.return_at is not distinct from old.return_at then return new; end if;
  if new.class_schedule_id is null and new.request_domain='basic_medical' and tg_op='UPDATE' and old.status='cancelled' then return new; end if;
  select s.schedule_date,r.room_type_id into target_schedule_date,target_room_type_id from public.class_schedules s join public.rooms r on r.id=s.room_id where s.id=new.class_schedule_id and s.schedule_status<>'cancelled';
  if target_schedule_date is null or (new.request_domain='nursing_skills' and target_room_type_id<>skills_room_type_id) or (new.request_domain='basic_medical' and target_room_type_id<>basic_medical_room_type_id) then
    if new.request_domain='nursing_skills' then raise exception 'Lớp Skills lab không hợp lệ hoặc đã bị hủy.' using errcode='22023'; end if;
    raise exception 'EQUIPMENT_REQUEST_SOURCE_SCHEDULE_INVALID' using errcode='22023';
  end if;
  receive_local:=new.receive_at at time zone 'Asia/Ho_Chi_Minh'; return_local:=new.return_at at time zone 'Asia/Ho_Chi_Minh';
  if new.request_domain='nursing_skills' then
    if receive_local::date < (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'Ngày nhận không được trước ngày hiện tại.' using errcode='22023'; end if;
    if receive_local::date > target_schedule_date then raise exception 'Ngày nhận phải bằng hoặc trước ngày học.' using errcode='22023'; end if;
    if return_local < receive_local then raise exception 'Ngày và giờ trả phải sau hoặc bằng thời điểm nhận.' using errcode='22023'; end if;
    if return_local::date < target_schedule_date then raise exception 'Ngày trả phải bằng hoặc sau ngày học.' using errcode='22023'; end if;
    if receive_local::time not in (time '09:00',time '11:00',time '14:00',time '16:00') or return_local::time not in (time '09:00',time '11:00',time '14:00',time '16:00') then raise exception 'Giờ nhận và trả không hợp lệ.' using errcode='22023'; end if;
  elsif receive_local::date < (now() at time zone 'Asia/Ho_Chi_Minh')::date or receive_local::date > target_schedule_date or return_local < receive_local or return_local::date < target_schedule_date or receive_local::time not in (time '09:00',time '11:00',time '14:00',time '16:00') or return_local::time not in (time '09:00',time '11:00',time '14:00',time '16:00') then raise exception 'EQUIPMENT_REQUEST_TIMING_INVALID' using errcode='22023'; end if;
  return new;
end; $$;

create or replace function public.create_equipment_request_with_items(target_class_schedule_id uuid,target_semester text,target_responsible_lecturer_id uuid,target_receive_at timestamptz,target_return_at timestamptz,target_note text,target_late_registration_reason text,target_items jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=(select auth.uid()); actor_profile public.profiles; source_row record; request_id uuid; responsible_id uuid; req_late_status text; skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
begin
  if actor_id is null or not (select private.is_active_user()) then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select s.id schedule_id,s.semester schedule_semester,bs.id session_id,bs.lesson_title,bs.teaching_lecturer_id,r.semester registration_semester,r.created_by,r.registrant_id into source_row from public.class_schedules s left join public.basic_medical_registration_sessions bs on bs.class_schedule_id=s.id left join public.basic_medical_registrations r on r.id=bs.registration_id where s.id=target_class_schedule_id and s.schedule_status<>'cancelled' for update of s;
  if source_row.schedule_id is null then raise exception 'EQUIPMENT_REQUEST_SOURCE_NOT_AVAILABLE' using errcode='P0002'; end if;
  if source_row.session_id is null then
    if not (select private.can_manage_equipment_schedule(target_class_schedule_id)) and not (((select private.has_role('lecturer')) or (select private.has_role('teaching_assistant'))) and (select private.has_room_type(skills_room_type_id))) then raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode='42501'; end if;
    responsible_id:=target_responsible_lecturer_id;
    if source_row.schedule_semester is null or source_row.schedule_semester not in ('HK1','HK2','HK3','HK4') then raise exception 'Lịch học chưa có thông tin Học kỳ hợp lệ.' using errcode='22023'; end if;
    if exists(select 1 from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text) left join public.equipment_catalog c on c.id=i.catalog_item_id where nullif(btrim(i.skill_name),'') is null or i.quantity is null or i.quantity<1 or c.id is null or not c.is_active) then raise exception 'EQUIPMENT_REQUEST_SKILLS_CATALOG_REQUIRED' using errcode='22023'; end if;
  else
    if not ((select private.can_manage_basic_medical()) or actor_id in (source_row.created_by,source_row.registrant_id,source_row.teaching_lecturer_id)) then raise exception 'EQUIPMENT_REQUEST_BASIC_MEDICAL_SCOPE_REQUIRED' using errcode='42501'; end if;
    responsible_id:=coalesce(target_responsible_lecturer_id,source_row.teaching_lecturer_id);
    if responsible_id<>source_row.teaching_lecturer_id and not ((select private.is_admin()) or (select private.can_manage_basic_medical())) then raise exception 'BASIC_MEDICAL_RESPONSIBLE_OVERRIDE_FORBIDDEN' using errcode='42501'; end if;
    if source_row.registration_semester is null or source_row.registration_semester not in ('HK1','HK2','HK3','HK4') then raise exception 'EQUIPMENT_REQUEST_SEMESTER_REQUIRED' using errcode='22023'; end if;
    if exists(select 1 from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text) left join public.basic_medical_equipment_catalog c on c.id=i.catalog_item_id where nullif(btrim(i.skill_name),'') is null or i.quantity is null or i.quantity<1 or c.id is null or not c.is_active) then raise exception 'EQUIPMENT_REQUEST_BASIC_MEDICAL_CATALOG_REQUIRED' using errcode='22023'; end if;
  end if;
  if target_items is null or jsonb_typeof(target_items)<>'array' or jsonb_array_length(target_items) not between 1 and 500 then raise exception 'EQUIPMENT_REQUEST_ITEMS_REQUIRED' using errcode='22023'; end if;
  select * into actor_profile from public.profiles where id=actor_id; if actor_profile.id is null or coalesce(actor_profile.phone,'') !~ '^\d{10}$' then raise exception 'EQUIPMENT_REQUEST_PHONE_REQUIRED' using errcode='22023'; end if;
  insert into public.equipment_requests(class_schedule_id,semester,registrant_id,responsible_lecturer_id,phone_snapshot,email_snapshot,receive_at,return_at,late_registration_reason,note,created_by) values(target_class_schedule_id,coalesce(source_row.registration_semester,source_row.schedule_semester),actor_id,responsible_id,actor_profile.phone,actor_profile.email,target_receive_at,target_return_at,nullif(btrim(target_late_registration_reason),''),nullif(btrim(target_note),''),actor_id) returning id,status into request_id,req_late_status;
  insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,basic_medical_catalog_item_id,quantity,note) select request_id,coalesce(nullif(btrim(i.skill_name),''),source_row.lesson_title),case when source_row.session_id is null then i.catalog_item_id else null end,case when source_row.session_id is not null then i.catalog_item_id else null end,i.quantity,nullif(btrim(i.note),'') from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text);
  return request_id;
end; $$;

create or replace function public.update_equipment_request_content(target_request_id uuid,target_class_schedule_id uuid,target_semester text,target_responsible_lecturer_id uuid,target_receive_at timestamptz,target_return_at timestamptz,target_note text,target_late_registration_reason text,target_items jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare updated_request_id uuid; req_late_status text; actor_id uuid:=(select auth.uid()); target_sched_semester text; current_request record; effective_semester text;
begin
  select req.class_schedule_id,req.semester into current_request from public.equipment_requests req where req.id=target_request_id;
  if current_request.class_schedule_id is null then raise exception 'Không tìm thấy phiếu hoặc bạn không có quyền điều chỉnh.' using errcode='42501'; end if;
  if target_class_schedule_id is distinct from current_request.class_schedule_id then raise exception 'EQUIPMENT_REQUEST_DOMAIN_OR_SOURCE_IMMUTABLE' using errcode='22023'; end if;
  select s.semester into target_sched_semester from public.class_schedules s join public.rooms r on r.id=s.room_id where s.id=target_class_schedule_id and s.schedule_status<>'cancelled' and r.room_type_id='40000000-0000-0000-0000-000000000001'::uuid and (select private.has_room_type(r.room_type_id));
  if not found then raise exception 'Lớp Skills lab không hợp lệ.' using errcode='42501'; end if;
  if target_sched_semester in ('HK1','HK2','HK3','HK4') then effective_semester:=target_sched_semester; elsif current_request.semester in ('HK1','HK2','HK3','HK4') then effective_semester:=current_request.semester; else raise exception 'Lịch học chưa có thông tin Học kỳ hợp lệ.' using errcode='22023'; end if;
  if target_items is null or jsonb_typeof(target_items)<>'array' or jsonb_array_length(target_items)=0 then raise exception 'Danh sách thiết bị không hợp lệ.' using errcode='22023'; end if;
  if exists(select 1 from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text) left join public.equipment_catalog c on c.id=i.catalog_item_id where i.skill_name is null or btrim(i.skill_name)='' or i.catalog_item_id is null or i.quantity is null or i.quantity<1 or c.id is null or not c.is_active) then raise exception 'Danh sách thiết bị có dữ liệu không hợp lệ.' using errcode='22023'; end if;
  update public.equipment_requests set semester=effective_semester,responsible_lecturer_id=target_responsible_lecturer_id,receive_at=target_receive_at,return_at=target_return_at,note=nullif(btrim(target_note),''),late_registration_reason=nullif(btrim(target_late_registration_reason),'') where id=target_request_id and status in ('new','preparing') returning id into updated_request_id;
  if updated_request_id is null then raise exception 'Không tìm thấy phiếu hoặc bạn không có quyền điều chỉnh.' using errcode='42501'; end if;
  delete from public.equipment_request_items where request_id=target_request_id;
  insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,quantity,note) select target_request_id,btrim(i.skill_name),i.catalog_item_id,i.quantity,nullif(btrim(i.note),'') from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text);
  select late_approval_status into req_late_status from public.equipment_requests where id=target_request_id;
  perform private.enqueue_equipment_request_outbox_event(target_request_id,case when req_late_status='pending' then 'late_approval_requested' else 'updated' end,null,actor_id);
  return updated_request_id;
end; $$;

revoke all on function private.enforce_equipment_request_semester_authority() from public,anon,authenticated;
revoke all on function private.validate_equipment_request_timing() from public,anon,authenticated;
revoke all on function public.create_equipment_request_with_items(uuid,text,uuid,timestamptz,timestamptz,text,text,jsonb) from public,anon;
grant execute on function public.create_equipment_request_with_items(uuid,text,uuid,timestamptz,timestamptz,text,text,jsonb) to authenticated;
revoke execute on function public.update_equipment_request_content(uuid,uuid,text,uuid,timestamptz,timestamptz,text,text,jsonb) from public,anon;
grant execute on function public.update_equipment_request_content(uuid,uuid,text,uuid,timestamptz,timestamptz,text,text,jsonb) to authenticated;


-- Source: supabase/schemas/28_equipment_request_create_outbox_compatibility.sql
-- Restore the established Nursing Skills creation outbox without applying it to Basic Medical.

create or replace function public.create_equipment_request_with_items(target_class_schedule_id uuid,target_semester text,target_responsible_lecturer_id uuid,target_receive_at timestamptz,target_return_at timestamptz,target_note text,target_late_registration_reason text,target_items jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=(select auth.uid()); actor_profile public.profiles; source_row record; request_id uuid; responsible_id uuid; req_late_status text; skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
begin
  if actor_id is null or not (select private.is_active_user()) then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select s.id schedule_id,s.semester schedule_semester,bs.id session_id,bs.lesson_title,bs.teaching_lecturer_id,r.semester registration_semester,r.created_by,r.registrant_id into source_row from public.class_schedules s left join public.basic_medical_registration_sessions bs on bs.class_schedule_id=s.id left join public.basic_medical_registrations r on r.id=bs.registration_id where s.id=target_class_schedule_id and s.schedule_status<>'cancelled' for update of s;
  if source_row.schedule_id is null then raise exception 'EQUIPMENT_REQUEST_SOURCE_NOT_AVAILABLE' using errcode='P0002'; end if;
  if source_row.session_id is null then
    if not (select private.can_manage_equipment_schedule(target_class_schedule_id)) and not (((select private.has_role('lecturer')) or (select private.has_role('teaching_assistant'))) and (select private.has_room_type(skills_room_type_id))) then raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode='42501'; end if;
    responsible_id:=target_responsible_lecturer_id;
    if source_row.schedule_semester is null or source_row.schedule_semester not in ('HK1','HK2','HK3','HK4') then raise exception 'Lịch học chưa có thông tin Học kỳ hợp lệ.' using errcode='22023'; end if;
    if exists(select 1 from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text) left join public.equipment_catalog c on c.id=i.catalog_item_id where nullif(btrim(i.skill_name),'') is null or i.quantity is null or i.quantity<1 or c.id is null or not c.is_active) then raise exception 'EQUIPMENT_REQUEST_SKILLS_CATALOG_REQUIRED' using errcode='22023'; end if;
  else
    if not ((select private.can_manage_basic_medical()) or actor_id in (source_row.created_by,source_row.registrant_id,source_row.teaching_lecturer_id)) then raise exception 'EQUIPMENT_REQUEST_BASIC_MEDICAL_SCOPE_REQUIRED' using errcode='42501'; end if;
    responsible_id:=coalesce(target_responsible_lecturer_id,source_row.teaching_lecturer_id);
    if responsible_id<>source_row.teaching_lecturer_id and not ((select private.is_admin()) or (select private.can_manage_basic_medical())) then raise exception 'BASIC_MEDICAL_RESPONSIBLE_OVERRIDE_FORBIDDEN' using errcode='42501'; end if;
    if source_row.registration_semester is null or source_row.registration_semester not in ('HK1','HK2','HK3','HK4') then raise exception 'EQUIPMENT_REQUEST_SEMESTER_REQUIRED' using errcode='22023'; end if;
    if exists(select 1 from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text) left join public.basic_medical_equipment_catalog c on c.id=i.catalog_item_id where nullif(btrim(i.skill_name),'') is null or i.quantity is null or i.quantity<1 or c.id is null or not c.is_active) then raise exception 'EQUIPMENT_REQUEST_BASIC_MEDICAL_CATALOG_REQUIRED' using errcode='22023'; end if;
  end if;
  if target_items is null or jsonb_typeof(target_items)<>'array' or jsonb_array_length(target_items) not between 1 and 500 then raise exception 'EQUIPMENT_REQUEST_ITEMS_REQUIRED' using errcode='22023'; end if;
  select * into actor_profile from public.profiles where id=actor_id; if actor_profile.id is null or coalesce(actor_profile.phone,'') !~ '^\d{10}$' then raise exception 'EQUIPMENT_REQUEST_PHONE_REQUIRED' using errcode='22023'; end if;
  insert into public.equipment_requests(class_schedule_id,semester,registrant_id,responsible_lecturer_id,phone_snapshot,email_snapshot,receive_at,return_at,late_registration_reason,note,created_by) values(target_class_schedule_id,coalesce(source_row.registration_semester,source_row.schedule_semester),actor_id,responsible_id,actor_profile.phone,actor_profile.email,target_receive_at,target_return_at,nullif(btrim(target_late_registration_reason),''),nullif(btrim(target_note),''),actor_id) returning id,status into request_id,req_late_status;
  insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,basic_medical_catalog_item_id,quantity,note) select request_id,coalesce(nullif(btrim(i.skill_name),''),source_row.lesson_title),case when source_row.session_id is null then i.catalog_item_id else null end,case when source_row.session_id is not null then i.catalog_item_id else null end,i.quantity,nullif(btrim(i.note),'') from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text);
  if source_row.session_id is null then
    select late_approval_status into req_late_status from public.equipment_requests where id=request_id;
    perform private.enqueue_equipment_request_outbox_event(
      request_id,
      case when req_late_status='pending' then 'late_approval_requested' else 'created' end,
      null,
      actor_id
    );
  end if;
  return request_id;
end; $$;

revoke all on function public.create_equipment_request_with_items(uuid,text,uuid,timestamptz,timestamptz,text,text,jsonb) from public,anon;
grant execute on function public.create_equipment_request_with_items(uuid,text,uuid,timestamptz,timestamptz,text,text,jsonb) to authenticated;


-- Source: supabase/schemas/29_basic_medical_equipment_request_email.sql
-- Declarative counterpart: keep the effective Equipment Request email definitions byte-for-byte aligned.
-- Expanded from: supabase\migrations\20260823120000_basic_medical_equipment_request_email.sql
-- Domain-aware Equipment Request outbox: Nursing Skills and Basic Medical.

create or replace function private.format_equipment_email_subject(
  target_event text,
  target_audience text,
  base_subject text,
  target_request_domain text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  domain_prefix text := case when target_request_domain = 'basic_medical' then '[Y cơ sở]' else '' end;
  responsible_text text := case when target_request_domain = 'basic_medical' then 'buổi học bạn phụ trách' else 'bạn phụ trách' end;
begin
  if target_request_domain <> 'basic_medical' then
    return private.format_equipment_email_subject(target_event, target_audience, base_subject);
  end if;
  if target_audience = 'admin' then
    if target_event = 'created' then return concat('[Admin MedLabs Calendar]', domain_prefix, '[New] Có đăng ký trang thiết bị mới - ', base_subject); end if;
    if target_event = 'updated' then return concat('[Admin MedLabs Calendar]', domain_prefix, '[Adjusted] Điều chỉnh phiếu đăng ký thiết bị - ', base_subject); end if;
    return concat('[Admin MedLabs Calendar]', domain_prefix, '[Late] Có phiếu chờ duyệt đăng ký trễ - ', base_subject);
  end if;
  if target_audience = 'responsible' then
    if target_event = 'created' then return concat('[MedLabs Calendar]', domain_prefix, '[New] Phiếu thiết bị ', responsible_text, ' - ', base_subject); end if;
    if target_event = 'updated' then return concat('[MedLabs Calendar]', domain_prefix, '[Adjusted] Điều chỉnh phiếu đăng ký thiết bị - ', base_subject); end if;
    if target_event = 'late_approval_requested' then return concat('[MedLabs Calendar]', domain_prefix, '[Late] Phiếu thiết bị ', responsible_text, ' đăng ký trễ - ', base_subject); end if;
    if target_event = 'late_approval_approved' then return concat('[MedLabs Calendar]', domain_prefix, '[Late] Đã duyệt phiếu đăng ký trễ - ', base_subject); end if;
    return concat('[MedLabs Calendar]', domain_prefix, '[Late] Đã từ chối phiếu đăng ký trễ - ', base_subject);
  end if;
  if target_event = 'created' then return concat('[MedLabs Calendar]', domain_prefix, '[New] Xác nhận đăng ký trang thiết bị - ', base_subject); end if;
  if target_event = 'updated' then return concat('[MedLabs Calendar]', domain_prefix, '[Adjusted] Điều chỉnh phiếu đăng ký thiết bị - ', base_subject); end if;
  if target_event = 'late_approval_requested' then return concat('[MedLabs Calendar]', domain_prefix, '[Late] Gửi phiếu đăng ký thiết bị trễ - ', base_subject); end if;
  if target_event = 'late_approval_approved' then return concat('[MedLabs Calendar]', domain_prefix, '[Late] Đã duyệt đăng ký trễ - ', base_subject); end if;
  return concat('[MedLabs Calendar]', domain_prefix, '[Late] Từ chối đăng ký trễ - ', base_subject);
end;
$$;
revoke all on function private.format_equipment_email_subject(text,text,text,text) from public, anon, authenticated;

create or replace function private.enqueue_equipment_request_outbox_event(
  target_request_id uuid,
  target_event text,
  target_operation_id uuid default null,
  target_actor_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_mode text;
  req_row record;
  sched_row record;
  room_row record;
  actor_name text;
  registrant_profile record;
  responsible_profile record;
  items_json jsonb;
  payload jsonb;
  recipients jsonb := '[]'::jsonb;
  event_key_value text;
  manager_row record;
  outbox_id uuid;
  effective_actor_id uuid := coalesce(target_actor_id, (select auth.uid()));
  basic_medical_room_type_id constant uuid := '40000000-0000-0000-0000-000000000002'::uuid;
  nursing_skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
begin
  select delivery_mode into current_mode from public.email_delivery_settings where setting_key = 'primary';
  if current_mode not in ('test', 'live') then current_mode := 'off'; end if;

  select * into req_row from public.equipment_requests where id = target_request_id;
  if req_row.id is null or req_row.request_domain not in ('nursing_skills', 'basic_medical') then
    raise exception 'EQUIPMENT_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into registrant_profile from public.profiles where id = req_row.registrant_id;
  select * into responsible_profile from public.profiles where id = req_row.responsible_lecturer_id;
  if effective_actor_id is not null then select full_name into actor_name from public.profiles where id = effective_actor_id; end if;
  select * into sched_row from public.class_schedules where id = req_row.class_schedule_id;
  if sched_row.room_id is not null then select * into room_row from public.rooms where id = sched_row.room_id; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'skill_name', item.skill_name,
    'item_name', case when req_row.request_domain = 'basic_medical' then coalesce(basic_catalog.item_name, 'Thiết bị không còn trong danh mục') else coalesce(skills_catalog.item_name, 'Thiết bị không còn trong danh mục') end,
    'commercial_name', case when req_row.request_domain = 'basic_medical' then coalesce(basic_catalog.commercial_name, '') else coalesce(skills_catalog.commercial_name, '') end,
    'unit', case when req_row.request_domain = 'basic_medical' then coalesce(basic_catalog.unit, '') else coalesce(skills_catalog.unit, '') end,
    'quantity', item.quantity,
    'note', item.note
  )), '[]'::jsonb)
  into items_json
  from public.equipment_request_items item
  left join public.equipment_catalog skills_catalog on skills_catalog.id = item.catalog_item_id
  left join public.basic_medical_equipment_catalog basic_catalog on basic_catalog.id = item.basic_medical_catalog_item_id
  where item.request_id = target_request_id;

  payload := jsonb_build_object(
    'request_id', req_row.id,
    'request_code', to_char(req_row.created_at at time zone 'Asia/Ho_Chi_Minh', 'YYMMDDHH24MISS'),
    'request_domain', req_row.request_domain,
    'event', target_event,
    'actor', coalesce(actor_name, registrant_profile.full_name, 'Người dùng hệ thống'),
    'course_code', coalesce(sched_row.course_code_snapshot, ''),
    'course_name', coalesce(sched_row.course_name_snapshot, ''),
    'schedule_date', sched_row.schedule_date,
    'start_time', to_char(sched_row.start_time, 'HH24:MI'),
    'end_time', to_char(sched_row.end_time, 'HH24:MI'),
    'semester', req_row.semester,
    'student_count', sched_row.student_count,
    'lab_type', case when req_row.request_domain = 'basic_medical' then 'Y cơ sở' else 'Kỹ năng Điều dưỡng' end,
    'room', coalesce(concat_ws(' · ', room_row.room_code, room_row.building_code), ''),
    'room_name', room_row.room_name,
    'registrant_name', coalesce(registrant_profile.full_name, ''),
    'registrant_email', coalesce(req_row.email_snapshot, registrant_profile.email, ''),
    'registrant_phone', coalesce(req_row.phone_snapshot, registrant_profile.phone, ''),
    'responsible_name', coalesce(responsible_profile.full_name, ''),
    'responsible_email', coalesce(responsible_profile.email, ''),
    'receive_at', req_row.receive_at,
    'return_at', req_row.return_at,
    'note', req_row.note,
    'late_approval_status', req_row.late_approval_status,
    'late_registration_reason', req_row.late_registration_reason,
    'late_review_note', req_row.late_review_note,
    'items', items_json
  );

  if req_row.registrant_id is not null and position('@' in coalesce(req_row.email_snapshot, registrant_profile.email, '')) > 0 then
    recipients := recipients || jsonb_build_object('recipient_id', req_row.registrant_id, 'recipient_email', lower(coalesce(req_row.email_snapshot, registrant_profile.email)), 'audience', 'registrant');
  end if;
  if req_row.responsible_lecturer_id <> req_row.registrant_id
    and responsible_profile.is_active
    and position('@' in coalesce(responsible_profile.email, '')) > 0
    and lower(responsible_profile.email) <> lower(coalesce(req_row.email_snapshot, registrant_profile.email, '')) then
    recipients := recipients || jsonb_build_object('recipient_id', req_row.responsible_lecturer_id, 'recipient_email', lower(responsible_profile.email), 'audience', 'responsible');
  end if;

  if target_event not in ('late_approval_approved', 'late_approval_rejected', 'deleted') then
    for manager_row in
      select distinct profile.id as user_id, lower(btrim(profile.email)) as email
      from public.user_roles role_row
      join public.profiles profile on profile.id = role_row.user_id
      where role_row.role in ('admin', 'staff')
        and profile.is_active and position('@' in coalesce(profile.email, '')) > 0
        and (role_row.role = 'admin' or exists (
          select 1 from public.profile_room_types scope
          where scope.profile_id = profile.id
            and scope.room_type_id = case when req_row.request_domain = 'basic_medical' then basic_medical_room_type_id else nursing_skills_room_type_id end
        ))
    loop
      if not exists (select 1 from jsonb_array_elements(recipients) recipient where recipient->>'recipient_email' = manager_row.email) then
        recipients := recipients || jsonb_build_object('recipient_id', manager_row.user_id, 'recipient_email', manager_row.email, 'audience', 'admin');
      end if;
    end loop;
  end if;

  event_key_value := case when target_event = 'deleted' then concat('equipment_request:deleted:', target_request_id) else concat('equipment_request:', target_event, ':', target_request_id, ':', coalesce(target_operation_id, gen_random_uuid())) end;
  insert into public.email_outbox_events(event_key,domain,event_type,aggregate_id,actor_id,payload,recipients,delivery_mode_at_event,status,last_error)
  values(event_key_value,'equipment_request',target_event,target_request_id,effective_actor_id,payload,recipients,current_mode,'pending',null)
  on conflict(event_key) do nothing returning id into outbox_id;
  return outbox_id;
end;
$$;
revoke all on function private.enqueue_equipment_request_outbox_event(uuid,text,uuid,uuid) from public, anon;
grant execute on function private.enqueue_equipment_request_outbox_event(uuid,text,uuid,uuid) to authenticated;

create or replace function public.process_email_outbox_events(batch_size integer default 25)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  evt record;
  recipient record;
  processed_count integer := 0;
  notification_type_value text;
  fixed_subject text;
  recipient_subject text;
  base_subject text;
  recipient_id_value uuid;
  recipient_email_value text;
  notification_payload jsonb;
  is_equipment_request boolean;
  is_suppressed boolean;
begin
  for evt in (
    with candidates as (
      select id from public.email_outbox_events
      where status = 'pending' or (status = 'processing' and processing_started_at < now() - interval '10 minutes')
      order by created_at, id
      for update skip locked
      limit greatest(1, least(coalesce(batch_size, 25), 100))
    ), claimed as (
      update public.email_outbox_events event_row
      set status = 'processing', attempts = event_row.attempts + 1, processing_started_at = now()
      from candidates where event_row.id = candidates.id returning event_row.*
    ) select * from claimed
  ) loop
    is_equipment_request := evt.domain = 'equipment_request';
    fixed_subject := null;
    if evt.domain ilike 'skills_lab%' or evt.event_type in ('class_schedule_created','class_schedule_import_summary','class_schedule_rescheduled','skills_lab_deleted') then
      notification_type_value := evt.event_type;
      fixed_subject := private.format_skills_lab_email_subject(evt.event_type, evt.payload);
    elsif evt.domain = 'basic_medical_registration' then
      notification_type_value := concat('basic_medical_registration_', evt.event_type);
      fixed_subject := private.format_basic_medical_registration_subject(evt.event_type, evt.payload);
    elsif evt.domain = 'basic_medical_damage' then
      notification_type_value := 'basic_medical_room_equipment_damaged';
      fixed_subject := private.format_basic_medical_damage_subject(evt.payload);
    elsif evt.domain = 'basic_medical_schedule' then
      notification_type_value := case when evt.event_type = 'schedule_cancelled' then 'class_schedule_basic_medical_cancelled' else 'class_schedule_basic_medical_updated' end;
      fixed_subject := case when evt.event_type = 'schedule_cancelled' then concat('[MedLabs Calendar] Hủy lịch Y cơ sở · ', evt.payload->>'course_code') else concat('[MedLabs Calendar] Điều chỉnh lịch Y cơ sở · ', evt.payload->>'course_code') end;
    else
      notification_type_value := concat('equipment_request_', evt.event_type);
      is_equipment_request := true;
      base_subject := concat(evt.payload->>'registrant_name', ' - ', to_char((evt.payload->>'schedule_date')::date, 'DD/MM/YYYY'), ' - ', evt.payload->>'course_code', ' - ', evt.payload->>'request_code');
    end if;

    is_suppressed := evt.delivery_mode_at_event = 'off';
    for recipient in select * from jsonb_to_recordset(evt.recipients) as item(recipient_id uuid,recipient_email text,audience text,id uuid,email text) loop
      recipient_id_value := coalesce(recipient.recipient_id, recipient.id);
      recipient_email_value := coalesce(recipient.recipient_email, recipient.email);
      if recipient_id_value is null or recipient_email_value is null then continue; end if;
      recipient_subject := case when is_equipment_request then private.format_equipment_email_subject(evt.event_type, coalesce(recipient.audience, 'registrant'), base_subject, coalesce(evt.payload->>'request_domain', 'nursing_skills')) else fixed_subject end;
      notification_payload := case when is_equipment_request then jsonb_set(evt.payload, '{audience}', to_jsonb(coalesce(recipient.audience, 'registrant'))) else evt.payload end;
      insert into public.email_notifications(notification_type,recipient_id,recipient_email,dedupe_key,subject,payload,delivery_mode_at_enqueue,status,last_error)
      values(notification_type_value,recipient_id_value,recipient_email_value,concat('outbox_notif:',evt.id,':',recipient_id_value),recipient_subject,notification_payload,case when is_suppressed then 'off' else evt.delivery_mode_at_event end,case when is_suppressed then 'suppressed' else 'pending' end,case when is_suppressed then 'Email được tạo khi chế độ gửi đang tắt.' else null end)
      on conflict(dedupe_key) do nothing;
    end loop;
    update public.email_outbox_events
    set status = case when is_suppressed then 'suppressed' else 'processed' end,
        processed_at = now(),
        last_error = case when is_suppressed then 'Email được tạo khi chế độ gửi đang tắt.' else null end
    where id = evt.id;
    processed_count := processed_count + 1;
  end loop;
  return processed_count;
end;
$$;
revoke all on function public.process_email_outbox_events(integer) from public, anon, authenticated;
grant execute on function public.process_email_outbox_events(integer) to service_role;

create or replace function public.create_equipment_request_with_items(target_class_schedule_id uuid,target_semester text,target_responsible_lecturer_id uuid,target_receive_at timestamptz,target_return_at timestamptz,target_note text,target_late_registration_reason text,target_items jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=(select auth.uid()); actor_profile public.profiles; source_row record; request_id uuid; responsible_id uuid; req_late_status text; skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
begin
  if actor_id is null or not (select private.is_active_user()) then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select s.id schedule_id,s.semester schedule_semester,bs.id session_id,bs.lesson_title,bs.teaching_lecturer_id,r.semester registration_semester,r.created_by,r.registrant_id into source_row from public.class_schedules s left join public.basic_medical_registration_sessions bs on bs.class_schedule_id=s.id left join public.basic_medical_registrations r on r.id=bs.registration_id where s.id=target_class_schedule_id and s.schedule_status<>'cancelled' for update of s;
  if source_row.schedule_id is null then raise exception 'EQUIPMENT_REQUEST_SOURCE_NOT_AVAILABLE' using errcode='P0002'; end if;
  if source_row.session_id is null then
    if not (select private.can_manage_equipment_schedule(target_class_schedule_id)) and not (((select private.has_role('lecturer')) or (select private.has_role('teaching_assistant'))) and (select private.has_room_type(skills_room_type_id))) then raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode='42501'; end if;
    responsible_id:=target_responsible_lecturer_id;
    if source_row.schedule_semester is null or source_row.schedule_semester not in ('HK1','HK2','HK3','HK4') then raise exception 'Lịch học chưa có thông tin Học kỳ hợp lệ.' using errcode='22023'; end if;
    if exists(select 1 from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text) left join public.equipment_catalog c on c.id=i.catalog_item_id where nullif(btrim(i.skill_name),'') is null or i.quantity is null or i.quantity<1 or c.id is null or not c.is_active) then raise exception 'EQUIPMENT_REQUEST_SKILLS_CATALOG_REQUIRED' using errcode='22023'; end if;
  else
    if not ((select private.can_manage_basic_medical()) or actor_id in (source_row.created_by,source_row.registrant_id,source_row.teaching_lecturer_id)) then raise exception 'EQUIPMENT_REQUEST_BASIC_MEDICAL_SCOPE_REQUIRED' using errcode='42501'; end if;
    responsible_id:=coalesce(target_responsible_lecturer_id,source_row.teaching_lecturer_id);
    if responsible_id<>source_row.teaching_lecturer_id and not ((select private.is_admin()) or (select private.can_manage_basic_medical())) then raise exception 'BASIC_MEDICAL_RESPONSIBLE_OVERRIDE_FORBIDDEN' using errcode='42501'; end if;
    if source_row.registration_semester is null or source_row.registration_semester not in ('HK1','HK2','HK3','HK4') then raise exception 'EQUIPMENT_REQUEST_SEMESTER_REQUIRED' using errcode='22023'; end if;
    if exists(select 1 from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text) left join public.basic_medical_equipment_catalog c on c.id=i.catalog_item_id where nullif(btrim(i.skill_name),'') is null or i.quantity is null or i.quantity<1 or c.id is null or not c.is_active) then raise exception 'EQUIPMENT_REQUEST_BASIC_MEDICAL_CATALOG_REQUIRED' using errcode='22023'; end if;
  end if;
  if target_items is null or jsonb_typeof(target_items)<>'array' or jsonb_array_length(target_items) not between 1 and 500 then raise exception 'EQUIPMENT_REQUEST_ITEMS_REQUIRED' using errcode='22023'; end if;
  select * into actor_profile from public.profiles where id=actor_id; if actor_profile.id is null or coalesce(actor_profile.phone,'') !~ '^\d{10}$' then raise exception 'EQUIPMENT_REQUEST_PHONE_REQUIRED' using errcode='22023'; end if;
  insert into public.equipment_requests(class_schedule_id,semester,registrant_id,responsible_lecturer_id,phone_snapshot,email_snapshot,receive_at,return_at,late_registration_reason,note,created_by) values(target_class_schedule_id,coalesce(source_row.registration_semester,source_row.schedule_semester),actor_id,responsible_id,actor_profile.phone,actor_profile.email,target_receive_at,target_return_at,nullif(btrim(target_late_registration_reason),''),nullif(btrim(target_note),''),actor_id) returning id,status into request_id,req_late_status;
  insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,basic_medical_catalog_item_id,quantity,note) select request_id,coalesce(nullif(btrim(i.skill_name),''),source_row.lesson_title),case when source_row.session_id is null then i.catalog_item_id else null end,case when source_row.session_id is not null then i.catalog_item_id else null end,i.quantity,nullif(btrim(i.note),'') from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text);
  select late_approval_status into req_late_status from public.equipment_requests where id=request_id;
  perform private.enqueue_equipment_request_outbox_event(request_id,case when req_late_status='pending' then 'late_approval_requested' else 'created' end,null,actor_id);
  return request_id;
end; $$;
revoke all on function public.create_equipment_request_with_items(uuid,text,uuid,timestamptz,timestamptz,text,text,jsonb) from public,anon;
grant execute on function public.create_equipment_request_with_items(uuid,text,uuid,timestamptz,timestamptz,text,text,jsonb) to authenticated;

create or replace function public.update_basic_medical_equipment_request_content(target_request_id uuid,target_receive_at timestamptz,target_return_at timestamptz,target_note text,target_late_registration_reason text,target_items jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=(select auth.uid()); request_row record; source_row record; updated_request_id uuid; receive_local timestamp; return_local timestamp; req_late_status text;
begin
  if actor_id is null or not (select private.is_active_user()) then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select requests.* into request_row from public.equipment_requests requests where requests.id=target_request_id and requests.request_domain='basic_medical' for update;
  if request_row.id is null then raise exception 'BASIC_MEDICAL_EQUIPMENT_EDIT_FORBIDDEN' using errcode='42501'; end if;
  if request_row.status not in ('new','preparing') then raise exception 'BASIC_MEDICAL_EQUIPMENT_EDIT_STATUS' using errcode='22023'; end if;
  if request_row.registrant_id<>actor_id and not (select private.can_manage_basic_medical()) then raise exception 'BASIC_MEDICAL_EQUIPMENT_EDIT_FORBIDDEN' using errcode='42501'; end if;
  select s.id session_id,s.class_schedule_id,s.lesson_title,s.teaching_lecturer_id,s.cancelled_at session_cancelled_at,r.cancelled_at registration_cancelled_at,r.semester registration_semester,c.schedule_date,c.schedule_status into source_row from public.basic_medical_registration_sessions s join public.basic_medical_registrations r on r.id=s.registration_id join public.class_schedules c on c.id=s.class_schedule_id where s.id=request_row.source_identity_id for update of s,c;
  if source_row.session_id is null or source_row.session_cancelled_at is not null or source_row.registration_cancelled_at is not null or source_row.schedule_status='cancelled' then raise exception 'BASIC_MEDICAL_SESSION_CANCELLED' using errcode='22023'; end if;
  if request_row.class_schedule_id is distinct from source_row.class_schedule_id then raise exception 'EQUIPMENT_REQUEST_LIVE_SOURCE_IMMUTABLE' using errcode='22023'; end if;
  if source_row.registration_semester not in ('HK1','HK2','HK3','HK4') then raise exception 'EQUIPMENT_REQUEST_SEMESTER_REQUIRED' using errcode='22023'; end if;
  if target_items is null or jsonb_typeof(target_items)<>'array' or jsonb_array_length(target_items) not between 1 and 500 then raise exception 'EQUIPMENT_REQUEST_ITEMS_REQUIRED' using errcode='22023'; end if;
  if exists(select 1 from jsonb_to_recordset(target_items) i(catalog_item_id uuid,quantity integer,note text) left join public.basic_medical_equipment_catalog c on c.id=i.catalog_item_id where i.catalog_item_id is null or i.quantity is null or i.quantity<1 or i.quantity>100000 or length(coalesce(i.note,''))>1000 or c.id is null or not c.is_active) then raise exception 'EQUIPMENT_REQUEST_BASIC_MEDICAL_CATALOG_REQUIRED' using errcode='22023'; end if;
  receive_local:=target_receive_at at time zone 'Asia/Ho_Chi_Minh'; return_local:=target_return_at at time zone 'Asia/Ho_Chi_Minh';
  if target_receive_at is null or target_return_at is null or target_return_at<target_receive_at or receive_local::date<(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date or receive_local::date>source_row.schedule_date or return_local::date<source_row.schedule_date or receive_local::time not in (time '09:00',time '11:00',time '14:00',time '16:00') or return_local::time not in (time '09:00',time '11:00',time '14:00',time '16:00') then raise exception 'BASIC_MEDICAL_EQUIPMENT_TIMING_INVALID' using errcode='22023'; end if;
  perform set_config('app.basic_medical_equipment_edit_rpc','true',true);
  update public.equipment_requests set responsible_lecturer_id=source_row.teaching_lecturer_id,semester=source_row.registration_semester,receive_at=target_receive_at,return_at=target_return_at,note=nullif(btrim(target_note),''),late_registration_reason=nullif(btrim(target_late_registration_reason),'') where id=target_request_id and request_domain='basic_medical' and status in ('new','preparing') returning id into updated_request_id;
  if updated_request_id is null then raise exception 'BASIC_MEDICAL_EQUIPMENT_EDIT_STATUS' using errcode='22023'; end if;
  delete from public.equipment_request_items where request_id=target_request_id;
  insert into public.equipment_request_items(request_id,skill_name,basic_medical_catalog_item_id,quantity,note) select target_request_id,source_row.lesson_title,i.catalog_item_id,i.quantity,nullif(btrim(i.note),'') from jsonb_to_recordset(target_items) i(catalog_item_id uuid,quantity integer,note text);
  select late_approval_status into req_late_status from public.equipment_requests where id=target_request_id;
  perform private.enqueue_equipment_request_outbox_event(target_request_id,case when req_late_status='pending' then 'late_approval_requested' else 'updated' end,null,actor_id);
  return updated_request_id;
end; $$;
revoke all on function public.update_basic_medical_equipment_request_content(uuid,timestamptz,timestamptz,text,text,jsonb) from public,anon;
grant execute on function public.update_basic_medical_equipment_request_content(uuid,timestamptz,timestamptz,text,text,jsonb) to authenticated;

-- End expanded source: supabase\migrations\20260823120000_basic_medical_equipment_request_email.sql
-- Expanded from: supabase\migrations\20260823121000_restore_email_outbox_deleted_recipient_guard.sql
-- Preserve durable outbox processing when a recipient profile was deleted.

create or replace function public.process_email_outbox_events(batch_size integer default 25)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  evt record;
  recipient record;
  processed_count integer := 0;
  notification_type_value text;
  fixed_subject text;
  recipient_subject text;
  base_subject text;
  recipient_id_value uuid;
  recipient_email_value text;
  notification_payload jsonb;
  is_equipment_request boolean;
  is_suppressed boolean;
begin
  for evt in (
    with candidates as (
      select id from public.email_outbox_events
      where status = 'pending' or (status = 'processing' and processing_started_at < now() - interval '10 minutes')
      order by created_at, id
      for update skip locked
      limit greatest(1, least(coalesce(batch_size, 25), 100))
    ), claimed as (
      update public.email_outbox_events event_row
      set status = 'processing', attempts = event_row.attempts + 1, processing_started_at = now()
      from candidates where event_row.id = candidates.id returning event_row.*
    ) select * from claimed
  ) loop
    is_equipment_request := evt.domain = 'equipment_request';
    fixed_subject := null;
    if evt.domain ilike 'skills_lab%' or evt.event_type in ('class_schedule_created','class_schedule_import_summary','class_schedule_rescheduled','skills_lab_deleted') then
      notification_type_value := evt.event_type;
      fixed_subject := private.format_skills_lab_email_subject(evt.event_type, evt.payload);
    elsif evt.domain = 'basic_medical_registration' then
      notification_type_value := concat('basic_medical_registration_', evt.event_type);
      fixed_subject := private.format_basic_medical_registration_subject(evt.event_type, evt.payload);
    elsif evt.domain = 'basic_medical_damage' then
      notification_type_value := 'basic_medical_room_equipment_damaged';
      fixed_subject := private.format_basic_medical_damage_subject(evt.payload);
    elsif evt.domain = 'basic_medical_schedule' then
      notification_type_value := case when evt.event_type = 'schedule_cancelled' then 'class_schedule_basic_medical_cancelled' else 'class_schedule_basic_medical_updated' end;
      fixed_subject := case when evt.event_type = 'schedule_cancelled' then concat('[MedLabs Calendar] Hủy lịch Y cơ sở · ', evt.payload->>'course_code') else concat('[MedLabs Calendar] Điều chỉnh lịch Y cơ sở · ', evt.payload->>'course_code') end;
    else
      notification_type_value := concat('equipment_request_', evt.event_type);
      is_equipment_request := true;
      base_subject := concat(evt.payload->>'registrant_name', ' - ', to_char((evt.payload->>'schedule_date')::date, 'DD/MM/YYYY'), ' - ', evt.payload->>'course_code', ' - ', evt.payload->>'request_code');
    end if;

    is_suppressed := evt.delivery_mode_at_event = 'off';
    for recipient in select * from jsonb_to_recordset(evt.recipients) as item(recipient_id uuid,recipient_email text,audience text,id uuid,email text) loop
      recipient_id_value := coalesce(recipient.recipient_id, recipient.id);
      recipient_email_value := coalesce(recipient.recipient_email, recipient.email);
      if recipient_id_value is null or recipient_email_value is null then continue; end if;
      if not exists (select 1 from public.profiles where id = recipient_id_value) then continue; end if;
      recipient_subject := case when is_equipment_request then private.format_equipment_email_subject(evt.event_type, coalesce(recipient.audience, 'registrant'), base_subject, coalesce(evt.payload->>'request_domain', 'nursing_skills')) else fixed_subject end;
      notification_payload := case when is_equipment_request then jsonb_set(evt.payload, '{audience}', to_jsonb(coalesce(recipient.audience, 'registrant'))) else evt.payload end;
      insert into public.email_notifications(notification_type,recipient_id,recipient_email,dedupe_key,subject,payload,delivery_mode_at_enqueue,status,last_error)
      values(notification_type_value,recipient_id_value,recipient_email_value,concat('outbox_notif:',evt.id,':',recipient_id_value),recipient_subject,notification_payload,case when is_suppressed then 'off' else evt.delivery_mode_at_event end,case when is_suppressed then 'suppressed' else 'pending' end,case when is_suppressed then 'Email được tạo khi chế độ gửi đang tắt.' else null end)
      on conflict(dedupe_key) do nothing;
    end loop;
    update public.email_outbox_events
    set status = case when is_suppressed then 'suppressed' else 'processed' end,
        processed_at = now(),
        last_error = case when is_suppressed then 'Email được tạo khi chế độ gửi đang tắt.' else null end
    where id = evt.id;
    processed_count := processed_count + 1;
  end loop;
  return processed_count;
end;
$$;
revoke all on function public.process_email_outbox_events(integer) from public, anon, authenticated;
grant execute on function public.process_email_outbox_events(integer) to service_role;

-- End expanded source: supabase\migrations\20260823121000_restore_email_outbox_deleted_recipient_guard.sql


-- Source: supabase/schemas/30_phase3b_operational_notifications_audit.sql
-- Declarative counterpart: the Phase 3B effective DB definitions live in one
-- forward migration so migration/schema parity cannot drift.
-- Expanded from: supabase\migrations\20260824090000_phase3b_operational_notifications_audit.sql
-- Phase 3B: transactional operational bell notifications, lifecycle audit,
-- and domain-normalized email presentation.  This migration deliberately
-- observes the existing equipment workflow; it does not define a new state.

create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  domain text not null check (btrim(domain) <> ''),
  notification_type text not null check (btrim(notification_type) <> ''),
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id uuid,
  title text not null check (btrim(title) <> ''),
  body text not null check (btrim(body) <> ''),
  href text,
  dedupe_key text not null unique check (btrim(dedupe_key) <> ''),
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

create index user_notifications_recipient_created_idx
  on public.user_notifications(recipient_id, created_at desc);
create index user_notifications_recipient_unread_idx
  on public.user_notifications(recipient_id, created_at desc)
  where read_at is null;

alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from public, anon, authenticated;
grant select on public.user_notifications to authenticated;
grant update(read_at) on public.user_notifications to authenticated;

create policy user_notifications_recipient_select on public.user_notifications
for select to authenticated using (recipient_id = (select auth.uid()));
create policy user_notifications_recipient_mark_read on public.user_notifications
for update to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'user_notifications'
    ) then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
end;
$$;

create or replace function private.equipment_notification_status_label(target_status text)
returns text language sql stable security definer set search_path = '' as $$
  select case target_status
    when 'new' then 'Mới'
    when 'preparing' then 'Đã soạn'
    when 'handed_over' then 'Đã giao'
    when 'returned' then 'Đã trả'
    when 'completed' then 'Hoàn thành'
    when 'cancelled' then 'Đã hủy'
    else coalesce(target_status, '') end;
$$;

create or replace function private.notify_equipment_request_recipients(
  target_request_id uuid,
  target_notification_type text,
  target_title text,
  target_body text,
  include_participants boolean,
  include_management boolean,
  target_actor_id uuid default null,
  target_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.equipment_requests%rowtype;
  inserted_count integer := 0;
begin
  target_actor_id := coalesce(target_actor_id, (select auth.uid()));
  select * into request_row from public.equipment_requests where id = target_request_id;
  if request_row.id is null then return 0; end if;

  with candidates as (
    select request_row.registrant_id as recipient_id, 'participant'::text as audience
    where include_participants and request_row.registrant_id is not null
    union all
    select request_row.responsible_lecturer_id, 'participant'::text
    where include_participants
      and request_row.responsible_lecturer_id is not null
    union all
    select profiles.id, 'manager'::text
    from public.profiles
    join public.user_roles roles on roles.user_id = profiles.id
    join public.class_schedules schedules on schedules.id = request_row.class_schedule_id
    join public.rooms rooms on rooms.id = schedules.room_id
    where include_management
      and profiles.is_active
      and (
        roles.role = 'admin'
        or (
          roles.role = 'staff'
          and exists (
            select 1 from public.profile_room_types scopes
            where scopes.profile_id = profiles.id
              and scopes.room_type_id = rooms.room_type_id
          )
        )
      )
  ), deduped as (
    select distinct on (candidates.recipient_id)
      candidates.recipient_id, candidates.audience
    from candidates
    join public.profiles profiles on profiles.id = candidates.recipient_id
      and profiles.is_active
    where candidates.recipient_id is distinct from target_actor_id
    order by candidates.recipient_id,
      case candidates.audience when 'manager' then 0 else 1 end
  ), inserted as (
    insert into public.user_notifications(
      recipient_id, actor_id, domain, notification_type, entity_type, entity_id,
      title, body, href, dedupe_key, metadata
    )
    select
      recipient_id,
      target_actor_id,
      request_row.request_domain::text,
      target_notification_type,
      'equipment_request',
      target_request_id,
      target_title,
      target_body,
      case when audience = 'manager'
        then concat('/equipment/requests?request=', target_request_id)
        when request_row.request_domain = 'basic_medical'
          then concat('/basic-medical/equipment-requests?request=', target_request_id)
        else concat('/equipment/mine?request=', target_request_id)
      end,
      concat('equipment_request:', target_request_id, ':', target_notification_type,
        ':', txid_current(), ':', recipient_id),
      coalesce(target_metadata, '{}'::jsonb) || jsonb_build_object('audience', audience)
    from deduped
    on conflict (dedupe_key) do nothing
    returning 1
  ) select count(*) into inserted_count from inserted;
  return inserted_count;
end;
$$;
revoke all on function private.notify_equipment_request_recipients(uuid,text,text,text,boolean,boolean,uuid,jsonb)
from public, anon, authenticated;

create or replace function private.observe_equipment_request_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
  notification_type_value text;
  notification_title text;
  notification_body text;
  include_participants boolean := false;
  include_management boolean := false;
  transition_kind text := 'forward';
  old_status jsonb := jsonb_build_object('status', old.status);
  new_status jsonb := jsonb_build_object('status', new.status);
begin
  -- Cancellation and hard deletion already have their own semantic audits.
  if new.status = 'cancelled' or old.status = 'cancelled' then return new; end if;

  if old.handover_staff_confirmed_at is null and new.handover_staff_confirmed_at is not null then
    audit_action := 'equipment_request.handover_staff_confirmed';
    if new.status = 'handed_over' then
      notification_type_value := 'handover_completed';
      notification_title := 'Đã hoàn tất xác nhận giao thiết bị';
      notification_body := 'Phiếu đã đủ xác nhận và chuyển sang Đã giao.';
    else
      notification_type_value := 'handover_waiting_recipient';
      notification_title := 'Thiết bị đang chờ xác nhận nhận';
      notification_body := 'Kho đã xác nhận giao thiết bị. Vui lòng mở phiếu để ký xác nhận nhận thiết bị.';
    end if;
    include_participants := true;
  elsif old.handover_recipient_signed_at is null and new.handover_recipient_signed_at is not null then
    audit_action := 'equipment_request.handover_recipient_signed';
    if new.status = 'handed_over' then
      notification_type_value := 'handover_completed';
      notification_title := 'Đã hoàn tất xác nhận giao thiết bị';
      notification_body := 'Phiếu đã đủ xác nhận và chuyển sang Đã giao.';
      include_management := true;
    end if;
  elsif old.return_staff_confirmed_at is null and new.return_staff_confirmed_at is not null then
    audit_action := 'equipment_request.return_staff_confirmed';
    if new.status = 'completed' then
      notification_type_value := 'return_completed';
      notification_title := 'Phiếu thiết bị đã hoàn tất';
      notification_body := 'Đã đủ xác nhận trả thiết bị và phiếu đã được hoàn thành.';
    else
      notification_type_value := 'return_waiting_recipient';
      notification_title := 'Thiết bị đang chờ xác nhận trả';
      notification_body := 'Kho đã xác nhận bước trả thiết bị. Vui lòng mở phiếu để hoàn tất xác nhận trả.';
    end if;
    include_participants := true;
  elsif old.return_recipient_signed_at is null and new.return_recipient_signed_at is not null then
    audit_action := 'equipment_request.return_recipient_signed';
    if new.status = 'completed' then
      notification_type_value := 'return_completed';
      notification_title := 'Phiếu thiết bị đã hoàn tất';
      notification_body := 'Đã đủ xác nhận trả thiết bị và phiếu đã được hoàn thành.';
    else
      notification_type_value := 'return_waiting_management';
      notification_title := 'Người nhận đã xác nhận trả thiết bị';
      notification_body := 'Phiếu đang chờ bộ phận phụ trách xác nhận bước trả thiết bị.';
    end if;
    include_management := true;
  elsif old.status is distinct from new.status then
    audit_action := 'equipment_request.status_changed';
    if old.status = 'new' and new.status = 'preparing' then
      notification_type_value := 'prepared';
      notification_title := 'Thiết bị đã được soạn';
      notification_body := 'Phiếu thiết bị đã chuyển sang Đã soạn và sẵn sàng cho bước giao.';
      include_participants := true;
    elsif (case old.status when 'new' then 0 when 'preparing' then 1 when 'handed_over' then 2 when 'returned' then 3 when 'completed' then 4 end)
      > (case new.status when 'new' then 0 when 'preparing' then 1 when 'handed_over' then 2 when 'returned' then 3 when 'completed' then 4 end) then
      transition_kind := 'rollback';
      notification_type_value := 'status_rollback';
      notification_title := 'Trạng thái phiếu đã được điều chỉnh';
      notification_body := concat('Phiếu đã chuyển từ ', private.equipment_notification_status_label(old.status), ' về ', private.equipment_notification_status_label(new.status), '.');
      include_participants := true;
      include_management := true;
    end if;
  else
    return new;
  end if;

  if audit_action is null then return new; end if;
  perform private.write_audit(
    audit_action,
    'equipment_request',
    new.id,
    old_status,
    new_status,
    jsonb_build_object(
      'request_domain', new.request_domain,
      'transition', transition_kind
    )
  );
  if notification_type_value is not null then
    perform private.notify_equipment_request_recipients(
      new.id, notification_type_value, notification_title, notification_body,
      include_participants, include_management, (select auth.uid()),
      jsonb_build_object('old_status', old.status, 'new_status', new.status)
    );
  end if;
  return new;
end;
$$;
revoke all on function private.observe_equipment_request_lifecycle() from public, anon, authenticated;

drop trigger if exists equipment_requests_lifecycle_observer on public.equipment_requests;
create trigger equipment_requests_lifecycle_observer
after update of status, handover_staff_confirmed_at, handover_recipient_signed_at,
  return_staff_confirmed_at, return_recipient_signed_at
on public.equipment_requests
for each row execute function private.observe_equipment_request_lifecycle();

create or replace function public.list_equipment_request_lifecycle_audit(target_request_id uuid)
returns table(
  created_at timestamptz,
  action text,
  actor_id uuid,
  actor_name text,
  old_status text,
  new_status text,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.equipment_requests where id = target_request_id) then
    raise exception 'EQUIPMENT_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (select private.can_manage_equipment_request(target_request_id)) then
    raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  return query
  select logs.created_at, logs.action, logs.actor_id, profiles.full_name,
    logs.old_data ->> 'status', logs.new_data ->> 'status',
    jsonb_build_object(
      'request_domain', logs.metadata ->> 'request_domain',
      'transition', logs.metadata ->> 'transition'
    )
  from public.audit_logs logs
  left join public.profiles profiles on profiles.id = logs.actor_id
  where logs.entity_type = 'equipment_request'
    and logs.entity_id = target_request_id
    and logs.action in (
      'equipment_request.status_changed',
      'equipment_request.handover_staff_confirmed',
      'equipment_request.handover_recipient_signed',
      'equipment_request.return_staff_confirmed',
      'equipment_request.return_recipient_signed',
      'equipment_request.cancelled',
      'equipment_request.hard_deleted'
    )
  order by logs.created_at desc, logs.id desc;
end;
$$;
revoke all on function public.list_equipment_request_lifecycle_audit(uuid) from public, anon;
grant execute on function public.list_equipment_request_lifecycle_audit(uuid) to authenticated;

-- Keep the first late-approval email, but turn repeated pending edits into a
-- durable in-app update for the same stakeholders.
create or replace function private.suppress_repeated_late_equipment_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.equipment_requests%rowtype;
begin
  if new.domain <> 'equipment_request' or new.event_type <> 'late_approval_requested' then
    return new;
  end if;
  select * into request_row from public.equipment_requests where id = new.aggregate_id;
  if request_row.id is null or request_row.late_approval_status <> 'pending' then
    return new;
  end if;
  if exists (
    select 1 from public.email_outbox_events events
    where events.domain = 'equipment_request'
      and events.aggregate_id = new.aggregate_id
      and events.event_type = 'late_approval_requested'
  ) then
    perform private.notify_equipment_request_recipients(
      request_row.id,
      'late_pending_updated',
      'Phiếu chờ duyệt đăng ký trễ đã được cập nhật',
      'Phiếu đăng ký thiết bị đang chờ duyệt đăng ký trễ vừa được điều chỉnh.',
      true, true, new.actor_id,
      jsonb_build_object('late_approval_status', 'pending')
    );
    return null;
  end if;
  return new;
end;
$$;
revoke all on function private.suppress_repeated_late_equipment_email() from public, anon, authenticated;
drop trigger if exists email_outbox_suppress_repeated_late_equipment_email on public.email_outbox_events;
create trigger email_outbox_suppress_repeated_late_equipment_email
before insert on public.email_outbox_events
for each row execute function private.suppress_repeated_late_equipment_email();

create or replace function private.format_skills_lab_email_subject(
  target_event_type text,
  target_payload jsonb,
  target_audience text
)
returns text language plpgsql stable security definer set search_path = '' as $$
declare prefix text := case when target_audience = 'admin' then '[Admin MedLabs Calendar]' else '[MedLabs Calendar]' end;
declare course_code text := coalesce(target_payload->>'course_code', '');
declare imported_rows text := coalesce(target_payload->>'imported_rows', '0');
declare lecturer_name text := coalesce(nullif(target_payload->>'lecturer', ''), nullif(target_payload->>'actor', ''), 'Giảng viên');
declare schedule_date text := '';
declare record_code text := coalesce(nullif(target_payload->>'request_code', ''), nullif(target_payload->>'record_code', ''));
declare identifying_tail text;
begin
  if nullif(target_payload->>'schedule_date', '') is not null then
    schedule_date := to_char((target_payload->>'schedule_date')::date, 'DD/MM/YYYY');
  end if;
  identifying_tail := concat_ws(' - ', lecturer_name, nullif(schedule_date, ''), nullif(course_code, ''), nullif(record_code, ''));
  if target_event_type = 'class_schedule_created' then return concat(prefix, '[Skills Lab][New] Lịch Skills Lab mới - ', identifying_tail); end if;
  if target_event_type = 'class_schedule_import_summary' then return concat(prefix, '[Skills Lab][Import] Cập nhật lịch sử import - ', imported_rows, ' lịch mới'); end if;
  if target_event_type = 'class_schedule_rescheduled' then return concat(prefix, '[Skills Lab][Adjusted] Đổi ngày học - ', identifying_tail); end if;
  if target_event_type = 'skills_lab_deleted' then return concat(prefix, '[Skills Lab][Deleted] Xóa lịch Skills Lab - ', concat_ws(' - ', nullif(course_code, ''), nullif(schedule_date, ''), nullif(record_code, ''))); end if;
  return concat(prefix, '[Skills Lab][New] Lịch Skills Lab - ', course_code);
end;
$$;
revoke all on function private.format_skills_lab_email_subject(text,jsonb,text) from public, anon, authenticated;
create or replace function private.format_skills_lab_email_subject(
  target_event_type text,
  target_payload jsonb
)
returns text language sql stable security definer set search_path = '' as $$
  select private.format_skills_lab_email_subject(target_event_type, target_payload, 'registrant');
$$;
revoke all on function private.format_skills_lab_email_subject(text,jsonb) from public, anon, authenticated;

create or replace function private.format_basic_medical_registration_subject(
  target_event_type text,
  target_payload jsonb,
  target_audience text
)
returns text language plpgsql stable security definer set search_path = '' as $$
declare prefix text := case when target_audience = 'admin' then '[Admin MedLabs Calendar]' else '[MedLabs Calendar]' end;
declare course_code text := coalesce(target_payload->>'course_code', '');
declare registrant_name text := coalesce(nullif(target_payload->>'registrant_name', ''), 'Giảng viên');
declare start_date text := '';
declare end_date text := '';
declare registration_code text := coalesce(nullif(target_payload->>'registration_code', ''), '');
declare date_range text;
declare identifying_tail text;
begin
  if nullif(target_payload->>'start_date', '') is not null then
    start_date := to_char((target_payload->>'start_date')::date, 'DD/MM/YYYY');
  end if;
  if nullif(target_payload->>'end_date', '') is not null then
    end_date := to_char((target_payload->>'end_date')::date, 'DD/MM/YYYY');
  end if;
  date_range := case when start_date = '' then '' when end_date = '' or end_date = start_date then start_date else concat(start_date, ' - ', end_date) end;
  identifying_tail := concat_ws(' - ', registrant_name, nullif(course_code, ''), nullif(date_range, ''), nullif(registration_code, ''));
  if target_event_type = 'created' then return concat(prefix, '[Y cơ sở][New] Có Phiếu Y cơ sở mới - ', identifying_tail); end if;
  if target_event_type = 'updated' then return concat(prefix, '[Y cơ sở][Adjusted] Điều chỉnh Phiếu Y cơ sở - ', identifying_tail); end if;
  if target_event_type = 'cancelled' then return concat(prefix, '[Y cơ sở][Cancelled] Hủy Phiếu Y cơ sở - ', identifying_tail); end if;
  return concat(prefix, '[Y cơ sở][New] Phiếu Y cơ sở - ', course_code);
end;
$$;
revoke all on function private.format_basic_medical_registration_subject(text,jsonb,text) from public, anon, authenticated;
create or replace function private.format_basic_medical_registration_subject(
  target_event_type text,
  target_payload jsonb
)
returns text language sql stable security definer set search_path = '' as $$
  select private.format_basic_medical_registration_subject(target_event_type, target_payload, 'registrant');
$$;
revoke all on function private.format_basic_medical_registration_subject(text,jsonb) from public, anon, authenticated;

create or replace function private.format_basic_medical_damage_subject(
  target_payload jsonb,
  target_audience text
)
returns text language plpgsql stable security definer set search_path = '' as $$
declare prefix text := case when target_audience = 'admin' then '[Admin MedLabs Calendar]' else '[MedLabs Calendar]' end;
declare room_label text := concat_ws(' ', nullif(btrim(target_payload->>'room_code'), ''), nullif(btrim(target_payload->>'room_name'), ''));
begin
  return concat(prefix, '[Y cơ sở][Alert] Thiết bị phòng ', room_label, ' được báo Hư');
end;
$$;
revoke all on function private.format_basic_medical_damage_subject(jsonb,text) from public, anon, authenticated;

create or replace function private.format_equipment_email_subject(
  target_event text, target_audience text, base_subject text
)
returns text language sql stable security definer set search_path = '' as $$
  select private.format_equipment_email_subject(target_event, target_audience, base_subject, 'nursing_skills');
$$;
create or replace function private.format_equipment_email_subject(
  target_event text, target_audience text, base_subject text, target_request_domain text
)
returns text language plpgsql stable security definer set search_path = '' as $$
declare prefix text := case when target_audience = 'admin' then '[Admin MedLabs Calendar]' else '[MedLabs Calendar]' end;
declare domain_label text := case when target_request_domain = 'basic_medical' then '[Y cơ sở]' else '[Skills Lab]' end;
declare deletion_event text := case when target_request_domain = 'basic_medical' then '[Cancelled] Hủy phiếu đăng ký thiết bị - ' else '[Deleted] Xóa phiếu đăng ký thiết bị - ' end;
begin
  if target_event = 'created' then
    return concat(prefix, domain_label, '[New] ', case when target_audience = 'admin' then 'Có đăng ký trang thiết bị mới - ' else 'Xác nhận đăng ký trang thiết bị - ' end, base_subject);
  end if;
  if target_event = 'updated' then return concat(prefix, domain_label, '[Adjusted] Điều chỉnh phiếu đăng ký thiết bị - ', base_subject); end if;
  if target_event = 'deleted' then return concat(prefix, domain_label, deletion_event, base_subject); end if;
  if target_event = 'late_approval_requested' then return concat(prefix, domain_label, '[Late] ', case when target_audience = 'admin' then 'Có phiếu chờ duyệt đăng ký trễ - ' else 'Gửi phiếu đăng ký thiết bị trễ - ' end, base_subject); end if;
  if target_event = 'late_approval_approved' then return concat(prefix, domain_label, '[Late] Đã duyệt đăng ký trễ - ', base_subject); end if;
  return concat(prefix, domain_label, '[Late] Từ chối đăng ký trễ - ', base_subject);
end;
$$;
revoke all on function private.format_equipment_email_subject(text,text,text) from public, anon, authenticated;
revoke all on function private.format_equipment_email_subject(text,text,text,text) from public, anon, authenticated;

create or replace function private.enqueue_basic_medical_damage_outbox_event(
  target_confirmation_id uuid, actor_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare mode_val text := 'off'; conf_row record; items_json jsonb := '[]'::jsonb;
declare payload_val jsonb; recipients_val jsonb := '[]'::jsonb; event_key_val text; outbox_id uuid;
declare actor_name text := 'Người dùng hệ thống'; basic_medical_room_type_id uuid;
begin
  select coalesce(delivery_mode, 'off') into mode_val from public.email_delivery_settings where setting_key = 'primary';
  select id into basic_medical_room_type_id from public.room_types where code = 'basic_medical' limit 1;
  select coalesce(full_name, actor_name) into actor_name from public.profiles where id = actor_id;
  select confirmations.id, confirmations.session_id, confirmations.signed_at,
    confirmations.schedule_date_snapshot, confirmations.start_time_snapshot,
    confirmations.end_time_snapshot, confirmations.room_id_snapshot,
    rooms.room_code, rooms.room_name, rooms.building_code,
    schedules.course_code_snapshot, schedules.course_name_snapshot,
    reporter.full_name as reporter_name, sessions.teaching_lecturer_id,
    registrations.registrant_id
  into conf_row
  from public.basic_medical_session_confirmations confirmations
  join public.basic_medical_registration_sessions sessions on sessions.id = confirmations.session_id
  join public.basic_medical_registrations registrations on registrations.id = sessions.registration_id
  left join public.rooms rooms on rooms.id = confirmations.room_id_snapshot
  left join public.class_schedules schedules on schedules.id = confirmations.class_schedule_id_snapshot
  left join public.profiles reporter on reporter.id = confirmations.signer_id
  where confirmations.id = target_confirmation_id;
  if conf_row.id is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'inventory_id', checks.inventory_id, 'item_name', checks.item_name_snapshot,
    'commercial_name', checks.commercial_name_snapshot, 'unit', checks.unit_snapshot,
    'newly_damaged_quantity', checks.newly_damaged_quantity, 'good_quantity', checks.good_after,
    'damaged_quantity', checks.damaged_after) order by checks.id), '[]'::jsonb)
  into items_json from public.basic_medical_session_equipment_checks checks
  where checks.confirmation_id = target_confirmation_id and checks.newly_damaged_quantity > 0;
  if jsonb_array_length(items_json) = 0 then return null; end if;
  payload_val := jsonb_build_object(
    'confirmation_id', conf_row.id, 'room_code', coalesce(conf_row.room_code, ''),
    'room_name', coalesce(conf_row.room_name, ''), 'building_code', coalesce(conf_row.building_code, ''),
    'reporter_name', coalesce(conf_row.reporter_name, actor_name), 'reported_at', conf_row.signed_at,
    'course_code', coalesce(conf_row.course_code_snapshot, ''), 'course_name', coalesce(conf_row.course_name_snapshot, ''),
    'schedule_date', conf_row.schedule_date_snapshot, 'start_time', conf_row.start_time_snapshot,
    'end_time', conf_row.end_time_snapshot, 'items', items_json);
  with candidates as (
    select profiles.id, lower(btrim(profiles.email)) as email, 'admin'::text as audience
    from public.profiles profiles join public.user_roles roles on roles.user_id = profiles.id
    where profiles.is_active and profiles.email like '%@%' and roles.role = 'admin'
    union all
    select profiles.id, lower(btrim(profiles.email)), 'admin'::text
    from public.profiles profiles join public.user_roles roles on roles.user_id = profiles.id
    where profiles.is_active and profiles.email like '%@%' and roles.role = 'staff'
      and exists (select 1 from public.profile_room_types scopes where scopes.profile_id = profiles.id and scopes.room_type_id = basic_medical_room_type_id)
    union all
    select profiles.id, lower(btrim(profiles.email)), 'registrant'::text
    from public.profiles profiles where profiles.id = conf_row.registrant_id and profiles.is_active and profiles.email like '%@%'
    union all
    select profiles.id, lower(btrim(profiles.email)), 'lecturer'::text
    from public.profiles profiles where profiles.id = conf_row.teaching_lecturer_id and profiles.is_active and profiles.email like '%@%'
  ), deduped as (
    select distinct on (id) id, email, audience from candidates
    order by id, case audience when 'admin' then 0 when 'registrant' then 1 else 2 end
  ) select coalesce(jsonb_agg(jsonb_build_object('recipient_id', id, 'recipient_email', email, 'audience', audience)), '[]'::jsonb)
  into recipients_val from deduped;
  event_key_val := concat('basic_medical:damage:', target_confirmation_id);
  insert into public.email_outbox_events(domain,event_type,event_key,payload,recipients,delivery_mode_at_event,status)
  values ('basic_medical_damage','damage_reported',event_key_val,payload_val,recipients_val,coalesce(mode_val, 'off'),'pending')
  on conflict (event_key) do nothing returning id into outbox_id;
  return outbox_id;
end;
$$;
revoke all on function private.enqueue_basic_medical_damage_outbox_event(uuid,uuid) from public, anon, authenticated;

create or replace function public.process_email_outbox_events(batch_size integer default 25)
returns integer language plpgsql security definer set search_path = '' as $$
declare evt record; recipient record; processed_count integer := 0; notification_type_value text;
  fixed_subject text; recipient_subject text; base_subject text; recipient_id_value uuid;
  recipient_email_value text; recipient_audience text; notification_payload jsonb;
  is_equipment_request boolean; is_suppressed boolean;
begin
  for evt in (
    with candidates as (
      select id from public.email_outbox_events
      where status = 'pending' or (status = 'processing' and processing_started_at < now() - interval '10 minutes')
      order by created_at, id for update skip locked
      limit greatest(1, least(coalesce(batch_size, 25), 100))
    ), claimed as (
      update public.email_outbox_events event_row set status = 'processing', attempts = event_row.attempts + 1, processing_started_at = now()
      from candidates where event_row.id = candidates.id returning event_row.*
    ) select * from claimed
  ) loop
    is_equipment_request := evt.domain = 'equipment_request'; fixed_subject := null;
    if evt.domain ilike 'skills_lab%' or evt.event_type in ('class_schedule_created','class_schedule_import_summary','class_schedule_rescheduled','skills_lab_deleted') then
      notification_type_value := evt.event_type;
    elsif evt.domain = 'basic_medical_registration' then notification_type_value := concat('basic_medical_registration_', evt.event_type);
    elsif evt.domain = 'basic_medical_damage' then notification_type_value := 'basic_medical_room_equipment_damaged';
    elsif evt.domain = 'basic_medical_schedule' then notification_type_value := case when evt.event_type = 'schedule_cancelled' then 'class_schedule_basic_medical_cancelled' else 'class_schedule_basic_medical_updated' end;
    else
      notification_type_value := concat('equipment_request_', evt.event_type); is_equipment_request := true;
      base_subject := concat(evt.payload->>'registrant_name', ' - ', to_char((evt.payload->>'schedule_date')::date, 'DD/MM/YYYY'), ' - ', evt.payload->>'course_code', ' - ', evt.payload->>'request_code');
    end if;
    is_suppressed := evt.delivery_mode_at_event = 'off';
    for recipient in select * from jsonb_to_recordset(evt.recipients) as item(recipient_id uuid,recipient_email text,audience text,id uuid,email text) loop
      recipient_id_value := coalesce(recipient.recipient_id, recipient.id);
      recipient_email_value := coalesce(recipient.recipient_email, recipient.email);
      if recipient_id_value is null or recipient_email_value is null then continue; end if;
      if not exists (select 1 from public.profiles where id = recipient_id_value) then continue; end if;
      recipient_audience := coalesce(recipient.audience, case when exists (select 1 from public.user_roles roles where roles.user_id = recipient_id_value and roles.role in ('admin','staff')) then 'admin' else 'registrant' end);
      if is_equipment_request then
        recipient_subject := private.format_equipment_email_subject(evt.event_type, recipient_audience, base_subject, coalesce(evt.payload->>'request_domain', 'nursing_skills'));
        notification_payload := jsonb_set(evt.payload, '{audience}', to_jsonb(recipient_audience));
      elsif evt.domain ilike 'skills_lab%' or evt.event_type in ('class_schedule_created','class_schedule_import_summary','class_schedule_rescheduled','skills_lab_deleted') then
        recipient_subject := private.format_skills_lab_email_subject(evt.event_type, evt.payload, recipient_audience); notification_payload := evt.payload;
      elsif evt.domain = 'basic_medical_registration' then
        recipient_subject := private.format_basic_medical_registration_subject(evt.event_type, evt.payload, recipient_audience); notification_payload := evt.payload;
      elsif evt.domain = 'basic_medical_damage' then
        recipient_subject := private.format_basic_medical_damage_subject(evt.payload, recipient_audience); notification_payload := jsonb_set(evt.payload, '{audience}', to_jsonb(recipient_audience));
      else
        recipient_subject := concat(case when recipient_audience = 'admin' then '[Admin MedLabs Calendar]' else '[MedLabs Calendar]' end,
          '[Y cơ sở]', case when evt.event_type = 'schedule_cancelled' then '[Cancelled] Hủy lịch Y cơ sở - ' else '[Adjusted] Điều chỉnh lịch Y cơ sở - ' end,
          coalesce(evt.payload->>'course_code', '')); notification_payload := evt.payload;
      end if;
      insert into public.email_notifications(notification_type,recipient_id,recipient_email,dedupe_key,subject,payload,delivery_mode_at_enqueue,status,last_error)
      values(notification_type_value,recipient_id_value,recipient_email_value,concat('outbox_notif:',evt.id,':',recipient_id_value),recipient_subject,notification_payload,case when is_suppressed then 'off' else evt.delivery_mode_at_event end,case when is_suppressed then 'suppressed' else 'pending' end,case when is_suppressed then 'Email được tạo khi chế độ gửi đang tắt.' else null end)
      on conflict(dedupe_key) do nothing;
    end loop;
    update public.email_outbox_events set status = case when is_suppressed then 'suppressed' else 'processed' end, processed_at = now(), last_error = case when is_suppressed then 'Email được tạo khi chế độ gửi đang tắt.' else null end where id = evt.id;
    processed_count := processed_count + 1;
  end loop;
  return processed_count;
end;
$$;
revoke all on function public.process_email_outbox_events(integer) from public, anon, authenticated;
grant execute on function public.process_email_outbox_events(integer) to service_role;

-- End expanded source: supabase\migrations\20260824090000_phase3b_operational_notifications_audit.sql


-- Source: supabase/schemas/31_preserve_lecturer_order_and_equipment_commercial_name_guard.sql
-- Declarative counterpart: the final definitions are intentionally shared
-- with the forward migration to preserve migration/schema parity.
-- Expanded from: supabase\migrations\20260824110000_preserve_lecturer_order_and_equipment_commercial_name_guard.sql
-- Lecturer slots are semantic (Lecturer 1 / Lecturer 2), not an unordered
-- set. Equipment commercial names are likewise a catalog identity that may
-- occur only once in the same practical activity.

create or replace function private.guard_equipment_request_item_commercial_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_domain_value public.equipment_request_domain;
  commercial_name_value text;
begin
  -- Locking the parent serializes concurrent item additions for one request.
  select requests.request_domain
  into request_domain_value
  from public.equipment_requests as requests
  where requests.id = new.request_id
  for update;

  if request_domain_value = 'nursing_skills' then
    select lower(btrim(catalog.commercial_name))
    into commercial_name_value
    from public.equipment_catalog as catalog
    where catalog.id = new.catalog_item_id;
  elsif request_domain_value = 'basic_medical' then
    select lower(btrim(catalog.commercial_name))
    into commercial_name_value
    from public.basic_medical_equipment_catalog as catalog
    where catalog.id = new.basic_medical_catalog_item_id;
  end if;

  -- The existing domain-catalog trigger owns invalid catalog errors.
  if commercial_name_value is null or commercial_name_value = '' then
    return new;
  end if;

  if exists (
    select 1
    from public.equipment_request_items as existing
    left join public.equipment_catalog as skills_catalog
      on skills_catalog.id = existing.catalog_item_id
    left join public.basic_medical_equipment_catalog as basic_catalog
      on basic_catalog.id = existing.basic_medical_catalog_item_id
    where existing.request_id = new.request_id
      and existing.id is distinct from new.id
      and lower(btrim(existing.skill_name)) = lower(btrim(new.skill_name))
      and lower(btrim(coalesce(
        case when request_domain_value = 'nursing_skills'
          then skills_catalog.commercial_name
          else basic_catalog.commercial_name
        end,
        ''
      ))) = commercial_name_value
  ) then
    raise exception 'EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists equipment_request_items_commercial_name_guard on public.equipment_request_items;
create trigger equipment_request_items_commercial_name_guard
before insert or update of request_id, skill_name, catalog_item_id, basic_medical_catalog_item_id
on public.equipment_request_items
for each row execute function private.guard_equipment_request_item_commercial_name();

create or replace function private.preserve_schedule_email_lecturer_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lecturer_names text;
begin
  if new.domain <> 'skills_lab_schedule'
    or new.aggregate_id is null
    or new.event_type not in ('class_schedule_created', 'class_schedule_rescheduled', 'skills_lab_deleted') then
    return new;
  end if;

  select nullif(concat_ws(
    ' · ',
    lecturer_1.full_name,
    lecturer_2.full_name
  ), '')
  into lecturer_names
  from public.class_schedules as schedules
  left join public.profiles as lecturer_1 on lecturer_1.id = schedules.lecturer_id
  left join public.profiles as lecturer_2 on lecturer_2.id = schedules.lecturer_2_id
  where schedules.id = new.aggregate_id;

  new.payload := jsonb_set(
    coalesce(new.payload, '{}'::jsonb),
    '{lecturer}',
    to_jsonb(coalesce(lecturer_names, 'Chưa có giảng viên')),
    true
  );
  return new;
end;
$$;

drop trigger if exists email_outbox_preserve_schedule_lecturer_order on public.email_outbox_events;
create trigger email_outbox_preserve_schedule_lecturer_order
before insert on public.email_outbox_events
for each row execute function private.preserve_schedule_email_lecturer_order();

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
  select schedules.* into target_row
  from public.class_schedules schedules
  where schedules.id = target_schedule_id
  for update;

  if target_row.id is null then
    raise exception 'CLASS_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  if (select private.class_schedule_has_equipment_request(target_schedule_id)) then
    raise exception 'CLASS_EQUIPMENT_REQUEST_EXISTS' using errcode = '42501';
  end if;

  select rooms.room_type_id into room_type_value
  from public.rooms rooms where rooms.id = target_row.room_id;
  if not (select private.can_modify_class_schedule(target_schedule_id, 'assign_lecturers')) then
    raise exception 'CLASS_MANAGEMENT_SCOPE_REQUIRED' using errcode = '42501';
  end if;

  normalized_ids := array_remove(coalesce(target_lecturer_ids, '{}'::uuid[]), null);
  if cardinality(normalized_ids) > 2 then
    raise exception 'TOO_MANY_CLASS_LECTURERS' using errcode = '22023';
  end if;
  if cardinality(normalized_ids) <> cardinality(array_remove(coalesce(target_lecturer_ids, '{}'::uuid[]), null))
    or cardinality(normalized_ids) <> cardinality(array(select distinct unnest(normalized_ids))) then
    raise exception 'DUPLICATE_CLASS_LECTURER' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(normalized_ids) requested(id) where not exists (
      select 1 from public.profiles profiles where profiles.id = requested.id and profiles.is_active
        and exists (select 1 from public.user_roles roles where roles.user_id = profiles.id and roles.role = 'lecturer')
        and exists (select 1 from public.profile_room_types scopes where scopes.profile_id = profiles.id and scopes.room_type_id = room_type_value)
    )
  ) then
    raise exception 'LECTURER_ROOM_TYPE_MISMATCH' using errcode = '42501';
  end if;

  update public.class_schedules
  set lecturer_id = normalized_ids[1], lecturer_2_id = normalized_ids[2], updated_at = now()
  where id = target_schedule_id
  returning * into target_row;
  return target_row;
end;
$$;

revoke all on function public.assign_class_lecturers(uuid, uuid[]) from public, anon;
grant execute on function public.assign_class_lecturers(uuid, uuid[]) to authenticated;

create or replace function public.update_skills_lab_class_schedule(
  target_schedule_id uuid,
  target_schedule_date date,
  target_start_time time,
  target_end_time time,
  target_course_id uuid,
  target_room_id uuid,
  target_student_count integer,
  target_lecturer_ids uuid[] default null
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
  nursing_skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
  source_room_type uuid;
  target_room_type uuid;
  course_row public.courses;
  is_admin boolean := (select private.has_role('admin'));
  is_staff boolean := (select private.has_role('staff'));
  is_ta boolean := (select private.has_role('teaching_assistant'));
  is_lecturer boolean := (select private.has_role('lecturer'));
  is_manager boolean := false;
  is_eligible_lecturer boolean := false;
  is_eligible_ta boolean := false;
  normalized_lecturer_ids uuid[];
  final_lecturer_1 uuid;
  final_lecturer_2 uuid;
  actor_name text;
  lecturer_name text;
  schedule_code text;
  room_label text;
  has_actual_change boolean := false;
  change_id uuid := gen_random_uuid();
begin
  if actor_id is null or not (select private.is_active_user()) then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  select schedules.* into before_row from public.class_schedules as schedules
  where schedules.id = target_schedule_id and schedules.schedule_status <> 'cancelled'
  for update;
  if before_row.id is null then raise exception 'CLASS_NOT_AVAILABLE' using errcode = 'P0001'; end if;
  if before_row.basic_medical_registration_id is not null then
    raise exception 'BASIC_MEDICAL_SCHEDULE_MUTATION_FORBIDDEN' using errcode = '42501';
  end if;

  select rooms.room_type_id into source_room_type from public.rooms as rooms where rooms.id = before_row.room_id;
  if source_room_type is distinct from nursing_skills_room_type_id then
    raise exception 'SKILLS_LAB_SCHEDULE_REQUIRED' using errcode = '42501';
  end if;
  if (select private.class_schedule_has_equipment_request(target_schedule_id)) then
    raise exception 'CLASS_EQUIPMENT_REQUEST_EXISTS' using errcode = '42501';
  end if;
  if not is_admin and not (select private.has_room_type(source_room_type)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;

  select rooms.room_type_id into target_room_type from public.rooms as rooms
  where rooms.id = target_room_id and rooms.is_active;
  if target_room_type is null or target_room_type is distinct from nursing_skills_room_type_id then
    raise exception 'INVALID_ROOM_SELECTION' using errcode = '22023';
  end if;
  if not is_admin and not (select private.has_room_type(target_room_type)) then
    raise exception 'ROOM_TYPE_SCOPE_REQUIRED' using errcode = '42501';
  end if;

  select * into course_row from public.courses as courses
  where courses.id = target_course_id and courses.is_active and courses.room_type_id = nursing_skills_room_type_id;
  if course_row.id is null then raise exception 'INVALID_COURSE_SELECTION' using errcode = '22023'; end if;
  if target_schedule_date is null or target_start_time is null or target_end_time is null
    or target_end_time <= target_start_time or target_student_count is null or target_student_count < 1 then
    raise exception 'INVALID_CLASS_DETAILS' using errcode = '22023';
  end if;
  if not ((target_start_time >= '07:30'::time and target_end_time <= '11:30'::time)
    or (target_start_time >= '12:30'::time and target_end_time <= '16:30'::time)) then
    raise exception 'OPERATING_HOURS_VIOLATION' using errcode = '23514';
  end if;

  is_manager := is_admin or (is_staff and (select private.has_room_type(nursing_skills_room_type_id)));
  is_eligible_lecturer := is_lecturer and (select private.has_room_type(nursing_skills_room_type_id))
    and (coalesce(actor_id in (before_row.lecturer_id, before_row.lecturer_2_id), false) or before_row.created_by = actor_id);
  is_eligible_ta := is_ta and (select private.has_room_type(nursing_skills_room_type_id)) and before_row.created_by = actor_id;
  if not (is_manager or is_eligible_lecturer or is_eligible_ta) then
    raise exception 'CLASS_UPDATE_FORBIDDEN' using errcode = '42501';
  end if;

  if is_manager and target_lecturer_ids is not null then
    normalized_lecturer_ids := array_remove(target_lecturer_ids, null);
    if cardinality(normalized_lecturer_ids) > 2 then raise exception 'TOO_MANY_CLASS_LECTURERS' using errcode = '22023'; end if;
    if cardinality(normalized_lecturer_ids) <> cardinality(array_remove(target_lecturer_ids, null))
      or cardinality(normalized_lecturer_ids) <> cardinality(array(select distinct unnest(normalized_lecturer_ids))) then
      raise exception 'DUPLICATE_CLASS_LECTURER' using errcode = '22023';
    end if;
    if exists (
      select 1 from unnest(normalized_lecturer_ids) as req(id) where not exists (
        select 1 from public.profiles as profiles
        join public.user_roles as roles on roles.user_id = profiles.id and roles.role = 'lecturer'
        join public.profile_room_types as scopes on scopes.profile_id = profiles.id and scopes.room_type_id = nursing_skills_room_type_id
        where profiles.id = req.id and profiles.is_active
      )
    ) then raise exception 'LECTURER_ROOM_TYPE_MISMATCH' using errcode = '42501'; end if;
    final_lecturer_1 := normalized_lecturer_ids[1];
    final_lecturer_2 := normalized_lecturer_ids[2];
  else
    final_lecturer_1 := before_row.lecturer_id;
    final_lecturer_2 := before_row.lecturer_2_id;
  end if;

  has_actual_change := before_row.schedule_date is distinct from target_schedule_date
    or before_row.start_time is distinct from target_start_time
    or before_row.end_time is distinct from target_end_time
    or before_row.course_id is distinct from course_row.id
    or before_row.course_code_snapshot is distinct from course_row.course_code
    or before_row.course_name_snapshot is distinct from course_row.course_name
    or before_row.room_id is distinct from target_room_id
    or before_row.student_count is distinct from target_student_count
    or before_row.lecturer_id is distinct from final_lecturer_1
    or before_row.lecturer_2_id is distinct from final_lecturer_2;

  update public.class_schedules set schedule_date = target_schedule_date, start_time = target_start_time,
    end_time = target_end_time, course_id = course_row.id, course_code_snapshot = course_row.course_code,
    course_name_snapshot = course_row.course_name, room_id = target_room_id, student_count = target_student_count,
    lecturer_id = final_lecturer_1, lecturer_2_id = final_lecturer_2, updated_at = now()
  where id = target_schedule_id returning * into changed_row;

  if has_actual_change then
    select concat_ws(' · ', rooms.room_code, rooms.building_code) into room_label
    from public.rooms as rooms where rooms.id = target_room_id;
    select profiles.full_name into actor_name from public.profiles as profiles where profiles.id = actor_id;
    select nullif(concat_ws(' · ',
      (select profiles.full_name from public.profiles as profiles where profiles.id = changed_row.lecturer_id),
      (select profiles.full_name from public.profiles as profiles where profiles.id = changed_row.lecturer_2_id)
    ), '') into lecturer_name;
    schedule_code := to_char(before_row.created_at at time zone 'Asia/Ho_Chi_Minh', 'YYMMDDHH24MISS');
    insert into public.email_outbox_events(domain,event_type,aggregate_id,event_key,payload,recipients,delivery_mode_at_event)
    select 'skills_lab_schedule','class_schedule_rescheduled',before_row.id,
      concat('skills_lab:updated:', change_id, ':', before_row.id),
      jsonb_build_object('schedule_id', before_row.id, 'course_code', changed_row.course_code_snapshot,
        'course_name', changed_row.course_name_snapshot, 'old_schedule_date', before_row.schedule_date,
        'schedule_date', changed_row.schedule_date, 'start_time', changed_row.start_time, 'end_time', changed_row.end_time,
        'room', room_label, 'student_count', changed_row.student_count,
        'lecturer', coalesce(lecturer_name, 'Chưa có giảng viên'), 'request_code', schedule_code,
        'actor', coalesce(actor_name, 'Người dùng hệ thống'), 'room_type_code', 'nursing_skills'),
      (select coalesce(jsonb_agg(jsonb_build_object('id', recipients.id, 'email', recipients.email)), '[]'::jsonb)
       from public.profiles as recipients where recipients.is_active and (
         recipients.id in (changed_row.lecturer_id, changed_row.lecturer_2_id, before_row.lecturer_id, before_row.lecturer_2_id)
         or recipients.id = before_row.created_by or exists (
           select 1 from public.user_roles as roles where roles.user_id = recipients.id and roles.role in ('admin','staff','viewer')
             and (roles.role = 'admin' or exists (
               select 1 from public.profile_room_types as assignments where assignments.profile_id = recipients.id
                 and assignments.room_type_id = nursing_skills_room_type_id
                 and (roles.role <> 'viewer' or assignments.receive_schedule_emails)
             ))
         )
       )),
      (select delivery_mode from public.email_delivery_settings where setting_key = 'primary')
    on conflict (event_key) do nothing;
  end if;
  return changed_row;
exception when exclusion_violation then
  raise exception 'ROOM_OR_LECTURER_SCHEDULE_CONFLICT' using errcode = '23P01';
end;
$$;

revoke all on function public.update_skills_lab_class_schedule(uuid, date, time, time, uuid, uuid, integer, uuid[]) from public, anon;
grant execute on function public.update_skills_lab_class_schedule(uuid, date, time, time, uuid, uuid, integer, uuid[]) to authenticated;

-- End expanded source: supabase\migrations\20260824110000_preserve_lecturer_order_and_equipment_commercial_name_guard.sql


-- Source: supabase/schemas/32_basic_medical_condition_adjustment_notifications.sql
-- Declarative counterpart: the final condition-adjustment notification
-- definitions are shared with the forward migration.
-- Expanded from: supabase\migrations\20260824120000_basic_medical_condition_adjustment_notifications.sql
-- A generic condition adjustment belongs to aggregate room inventory, not to a
-- uniquely identifiable historical damage report. Notify only the management
-- side from the committed condition-log event.

create or replace function private.notify_basic_medical_condition_adjustment(
  target_condition_log_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  condition_log record;
  inserted_count integer := 0;
begin
  select
    logs.id,
    logs.inventory_id,
    logs.actor_id,
    logs.event_type,
    logs.good_before,
    logs.damaged_before,
    logs.good_after,
    logs.damaged_after,
    logs.item_name_snapshot,
    inventory.catalog_item_id,
    inventory.room_id,
    rooms.room_type_id,
    rooms.room_code,
    rooms.room_name,
    catalog.item_name
  into condition_log
  from public.basic_medical_equipment_condition_logs as logs
  join public.basic_medical_room_inventory as inventory
    on inventory.id = logs.inventory_id
  join public.rooms
    on rooms.id = inventory.room_id
  join public.basic_medical_equipment_catalog as catalog
    on catalog.id = inventory.catalog_item_id
  where logs.id = target_condition_log_id;

  if condition_log.id is null
    or condition_log.event_type <> 'condition_adjustment' then
    return 0;
  end if;

  with management_recipients as (
    select profiles.id as recipient_id
    from public.profiles
    join public.user_roles as roles
      on roles.user_id = profiles.id
    where profiles.is_active
      and roles.role = 'admin'
    union
    select profiles.id
    from public.profiles
    join public.user_roles as roles
      on roles.user_id = profiles.id
    join public.profile_room_types as scopes
      on scopes.profile_id = profiles.id
    where profiles.is_active
      and roles.role = 'staff'
      and scopes.room_type_id = condition_log.room_type_id
  ), inserted as (
    insert into public.user_notifications (
      recipient_id,
      actor_id,
      domain,
      notification_type,
      entity_type,
      entity_id,
      title,
      body,
      href,
      dedupe_key,
      metadata
    )
    select
      recipients.recipient_id,
      condition_log.actor_id,
      'basic_medical',
      'basic_medical_inventory_condition_adjusted',
      'basic_medical_condition_log',
      condition_log.id,
      'Đã điều chỉnh tình trạng thiết bị',
      concat(
        coalesce(condition_log.item_name_snapshot, condition_log.item_name),
        ' tại phòng ',
        concat_ws(' ', condition_log.room_code, condition_log.room_name),
        ': Tốt ', condition_log.good_before, ' → ', condition_log.good_after,
        ' · Hư ', condition_log.damaged_before, ' → ', condition_log.damaged_after,
        '.'
      ),
      concat('/basic-medical/equipment?tab=logs&item=', condition_log.catalog_item_id),
      concat(
        'basic_medical:condition_adjustment:',
        condition_log.id,
        ':',
        recipients.recipient_id
      ),
      jsonb_build_object(
        'condition_log_id', condition_log.id,
        'inventory_id', condition_log.inventory_id,
        'room_id', condition_log.room_id,
        'catalog_item_id', condition_log.catalog_item_id,
        'good_before', condition_log.good_before,
        'damaged_before', condition_log.damaged_before,
        'good_after', condition_log.good_after,
        'damaged_after', condition_log.damaged_after
      )
    from management_recipients as recipients
    where recipients.recipient_id is distinct from condition_log.actor_id
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into inserted_count from inserted;

  return inserted_count;
end;
$$;

revoke all on function private.notify_basic_medical_condition_adjustment(uuid)
from public, anon, authenticated;

create or replace function private.observe_basic_medical_condition_adjustment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.notify_basic_medical_condition_adjustment(new.id);
  return new;
end;
$$;

revoke all on function private.observe_basic_medical_condition_adjustment()
from public, anon, authenticated;

drop trigger if exists basic_medical_condition_adjustment_notification
  on public.basic_medical_equipment_condition_logs;

create trigger basic_medical_condition_adjustment_notification
after insert on public.basic_medical_equipment_condition_logs
for each row
when (new.event_type = 'condition_adjustment')
execute function private.observe_basic_medical_condition_adjustment();

-- End expanded source: supabase\migrations\20260824120000_basic_medical_condition_adjustment_notifications.sql
