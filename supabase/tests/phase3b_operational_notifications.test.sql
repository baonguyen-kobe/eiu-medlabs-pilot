begin;
select plan(36);

select has_table(
  'public',
  'user_notifications',
  'Phase 3B provides one shared user notification table'
);
select has_column('public', 'user_notifications', 'recipient_id', 'notification recipient is stored');
select has_column('public', 'user_notifications', 'read_at', 'read state is stored');
select has_column('public', 'user_notifications', 'dedupe_key', 'notification dedupe key is stored');
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'user_notifications_recipient_created_idx'
  ),
  'notification lookup index exists'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'user_notifications_recipient_unread_idx'
  ),
  'notification unread lookup index exists'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_notifications'::regclass),
  'notification rows have RLS enabled'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_notifications'
      and policyname = 'user_notifications_recipient_select'
  ),
  'recipient-only select policy exists'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'user_notifications'
      and policyname = 'user_notifications_recipient_mark_read'
  ),
  'recipient-only read update policy exists'
);
select ok(
  not has_table_privilege('authenticated', 'public.user_notifications', 'INSERT'),
  'authenticated clients cannot create arbitrary bell notifications'
);
select has_function(
  'public',
  'list_equipment_request_lifecycle_audit',
  array['uuid'],
  'scoped lifecycle audit read RPC exists'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.equipment_requests'::regclass
      and tgname = 'equipment_requests_lifecycle_observer'
      and not tgisinternal
  ),
  'equipment lifecycle observer trigger exists'
);
select ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_notifications'
  ),
  'notifications are published through Supabase Realtime'
);

-- Exercise the observer through real request mutations. This fixture uses a
-- Skills request so the normal participant/management split is deterministic.
insert into public.profile_room_types (profile_id, room_type_id)
select profiles.id, '40000000-0000-0000-0000-000000000001'::uuid
from public.profiles profiles
where lower(profiles.email) in ('admin@campus.local', 'staff@campus.local')
on conflict do nothing;

insert into public.class_schedules (
  id, course_id, room_id, lecturer_id, schedule_date, start_time, end_time,
  student_count, course_code_snapshot, course_name_snapshot, semester,
  schedule_status, published_at, published_by, source, created_by
)
values (
  '94000000-0000-0000-0000-000000000001'::uuid,
  (select id from public.courses where room_type_id = '40000000-0000-0000-0000-000000000001'::uuid limit 1),
  (select id from public.rooms where room_type_id = '40000000-0000-0000-0000-000000000001'::uuid limit 1),
  coalesce((select id from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'::uuid),
  current_date + interval '12 days', '07:30', '11:30', 20,
  'PHASE3B', 'Phase 3B lifecycle observer', 'HK1', 'published', clock_timestamp(),
  coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid),
  'manual',
  coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid)
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'), true);
select set_config('request.jwt.claims', json_build_object('sub', coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid), 'role', 'authenticated')::text, true);

insert into public.equipment_requests (
  id, class_schedule_id, source_identity_id, request_domain, registrant_id,
  responsible_lecturer_id, semester, phone_snapshot, email_snapshot,
  receive_at, return_at, created_by
)
values (
  '94000000-0000-0000-0000-000000000002'::uuid,
  '94000000-0000-0000-0000-000000000001'::uuid,
  '94000000-0000-0000-0000-000000000001'::uuid,
  'nursing_skills',
  coalesce((select id from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'::uuid),
  coalesce((select id from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'::uuid),
  'HK1', '0901234567', 'giangvien@campus.local',
  ((current_date + interval '12 days')::date::text || ' 09:00:00 Asia/Ho_Chi_Minh')::timestamptz,
  ((current_date + interval '12 days')::date::text || ' 11:00:00 Asia/Ho_Chi_Minh')::timestamptz,
  coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid)
);

select throws_ok($$select public.manager_confirm_equipment_status(
  '94000000-0000-0000-0000-000000000002'::uuid, 'preparing')$$,
  'P0001','S4_CONFIRM_PREPARATION_REQUIRED','Legacy status command cannot bypass S4 confirmation');

select results_eq(
  $$ select status from public.equipment_requests where id = '94000000-0000-0000-0000-000000000002'::uuid $$,
  array['new'],
  'rejected preparation leaves the request NEW'
);
select ok(
  not exists (select 1 from public.audit_logs where entity_id = '94000000-0000-0000-0000-000000000002'::uuid and action = 'equipment_request.status_changed'),
  'rejected preparation writes no lifecycle audit'
);
select ok(
  not exists (select 1 from public.user_notifications where entity_id = '94000000-0000-0000-0000-000000000002'::uuid and notification_type = 'prepared'),
  'rejected preparation sends no prepared notification; real S4 positive is covered by inventory_s4_reservations'
);
select ok(
  not exists (
    select 1 from public.user_notifications notifications
    where notifications.entity_id = '94000000-0000-0000-0000-000000000002'::uuid
      and notifications.actor_id = notifications.recipient_id
  ),
  'lifecycle actor is excluded from bell recipients'
);
select is_empty(
  $$ select id from public.email_outbox_events where aggregate_id = '94000000-0000-0000-0000-000000000002'::uuid and event_type in ('ready_for_handover', 'handed_over', 'completed') $$,
  'lifecycle observer does not enqueue lifecycle email'
);

-- Reconstruct only a historical legacy fixture, never an Inventory preparation.
do $$ begin
  if exists(select 1 from public.equipment_preparations where request_id='94000000-0000-0000-0000-000000000002'::uuid)
    or exists(select 1 from public.equipment_fulfillment_events where request_id='94000000-0000-0000-0000-000000000002'::uuid)
  then raise exception 'REFUSING_INVENTORY_HISTORY_LEGACY_FIXTURE'; end if;
end $$;
set local session_replication_role=replica;
update public.equipment_requests set status='preparing' where id='94000000-0000-0000-0000-000000000002'::uuid;
set local session_replication_role=origin;
select public.manager_confirm_equipment_status(
  '94000000-0000-0000-0000-000000000002'::uuid,
  'handed_over'
);
select ok(
  exists (select 1 from public.audit_logs where entity_id = '94000000-0000-0000-0000-000000000002'::uuid and action = 'equipment_request.handover_staff_confirmed'),
  'first warehouse handover confirmation writes its semantic audit'
);
select ok(
  exists (select 1 from public.user_notifications where entity_id = '94000000-0000-0000-0000-000000000002'::uuid and notification_type = 'handover_waiting_recipient'),
  'first warehouse handover confirmation notifies participant side'
);

select set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'), true);
select set_config('request.jwt.claims', json_build_object('sub', coalesce((select id from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'::uuid), 'role', 'authenticated')::text, true);
select public.registrant_confirm_equipment_handoff(
  '94000000-0000-0000-0000-000000000002'::uuid,
  'handover',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLffwAAAABJRU5ErkJggg=='
);
select results_eq(
  $$ select status from public.equipment_requests where id = '94000000-0000-0000-0000-000000000002'::uuid $$,
  array['handed_over'],
  'recipient handover confirmation makes handover effective'
);
select results_eq(
  $$ select count(*)::integer from public.audit_logs where entity_id = '94000000-0000-0000-0000-000000000002'::uuid and action = 'equipment_request.handover_recipient_signed' $$,
  array[1],
  'recipient handover completion writes one semantic audit row'
);
select results_eq(
  $$ select count(*)::integer from public.audit_logs where entity_id = '94000000-0000-0000-0000-000000000002'::uuid and action = 'equipment_request.status_changed' $$,
  array[0],
  'recipient handover uses dedicated semantic audit without a generic status duplicate'
);
select ok(
  exists (select 1 from public.user_notifications where entity_id = '94000000-0000-0000-0000-000000000002'::uuid and notification_type = 'handover_completed'),
  'effective handover notifies management side'
);

select public.registrant_confirm_equipment_handoff(
  '94000000-0000-0000-0000-000000000002'::uuid,
  'return',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLffwAAAABJRU5ErkJggg=='
);
select ok(
  exists (select 1 from public.user_notifications where entity_id = '94000000-0000-0000-0000-000000000002'::uuid and notification_type = 'return_waiting_management'),
  'recipient-first return notifies management side'
);

select set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'), true);
select set_config('request.jwt.claims', json_build_object('sub', coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid), 'role', 'authenticated')::text, true);
select public.manager_confirm_equipment_status(
  '94000000-0000-0000-0000-000000000002'::uuid,
  'returned'
);
select results_eq(
  $$ select status from public.equipment_requests where id = '94000000-0000-0000-0000-000000000002'::uuid $$,
  array['completed'],
  'second return confirmation completes the request'
);
select ok(
  exists (select 1 from public.audit_logs where entity_id = '94000000-0000-0000-0000-000000000002'::uuid and action = 'equipment_request.return_staff_confirmed'),
  'completion uses the semantic return confirmation audit'
);
select is_empty(
  $$ select id from public.email_outbox_events where aggregate_id = '94000000-0000-0000-0000-000000000002'::uuid and event_type in ('handed_over', 'completed') $$,
  'completion does not enqueue lifecycle email'
);
select ok(
  not exists (
    select 1 from public.audit_logs
    where entity_id = '94000000-0000-0000-0000-000000000002'::uuid
      and (old_data::text || new_data::text) ~ 'signature(_path)?|base64'
  ),
  'lifecycle audit stores only safe status data, never signature content or paths'
);

select lives_ok(
  $$ select public.manager_confirm_equipment_status('94000000-0000-0000-0000-000000000002'::uuid, 'completed') $$,
  'same completed confirmation is a no-op'
);
select results_eq(
  $$
    select count(*)::integer
    from public.audit_logs
    where entity_id = '94000000-0000-0000-0000-000000000002'::uuid
      and action in (
        'equipment_request.status_changed',
        'equipment_request.handover_staff_confirmed',
        'equipment_request.handover_recipient_signed',
        'equipment_request.return_staff_confirmed',
        'equipment_request.return_recipient_signed'
      )
  $$,
  array[4],
  'no-op confirmation adds no duplicate lifecycle audit'
);

select throws_ok($$select public.manager_confirm_equipment_status(
  '94000000-0000-0000-0000-000000000002'::uuid,'preparing')$$,
  'P0001','S4_CONFIRM_PREPARATION_REQUIRED','Rollback cannot fabricate an Inventory preparation');
select public.manager_confirm_equipment_status(
  '94000000-0000-0000-0000-000000000002'::uuid, 'new');
select results_eq(
  $$ select status from public.equipment_requests where id = '94000000-0000-0000-0000-000000000002'::uuid $$,
  array['new'],
  'legacy manager rollback to NEW is persisted'
);
select ok(
  exists (
    select 1 from public.audit_logs
    where entity_id = '94000000-0000-0000-0000-000000000002'::uuid
      and action = 'equipment_request.status_changed'
      and metadata ->> 'transition' = 'rollback'
  ),
  'rollback writes a rollback lifecycle audit'
);
select ok(
  exists (
    select 1 from public.user_notifications
    where entity_id = '94000000-0000-0000-0000-000000000002'::uuid
      and notification_type = 'status_rollback'
  ),
  'rollback notifies impacted stakeholders without email'
);

select * from finish();
rollback;
