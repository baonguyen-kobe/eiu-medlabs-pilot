begin;
select plan(21);

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
  '42501','EQUIPMENT_REQUEST_INVENTORY_FLOW_ONLY','Legacy status command cannot move a Skills lab request (t2h)');

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

-- t2h: a Skills lab request moves only through the inventory flow, so the
-- request-level handover and signature are refused even mid-workflow.
-- shortcut: the manual-flow notifications (handover/return/rollback) now run
-- only for Basic Medical and have no pgTAP fixture here; add one if that flow
-- stays after t4r3 step C.
do $$ begin
  if exists(select 1 from public.equipment_preparations where request_id='94000000-0000-0000-0000-000000000002'::uuid)
    or exists(select 1 from public.equipment_fulfillment_events where request_id='94000000-0000-0000-0000-000000000002'::uuid)
  then raise exception 'REFUSING_INVENTORY_HISTORY_LEGACY_FIXTURE'; end if;
end $$;
set local session_replication_role=replica;
update public.equipment_requests set status='preparing' where id='94000000-0000-0000-0000-000000000002'::uuid;
set local session_replication_role=origin;
select throws_ok($$select public.manager_confirm_equipment_status(
  '94000000-0000-0000-0000-000000000002'::uuid, 'handed_over')$$,
  '42501','EQUIPMENT_REQUEST_INVENTORY_FLOW_ONLY','Manual handover is refused for a Skills lab request');

select set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'), true);
select set_config('request.jwt.claims', json_build_object('sub', coalesce((select id from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'::uuid), 'role', 'authenticated')::text, true);
select throws_ok($$select public.registrant_confirm_equipment_handoff(
  '94000000-0000-0000-0000-000000000002'::uuid, 'handover',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLffwAAAABJRU5ErkJggg==')$$,
  '42501','EQUIPMENT_REQUEST_INVENTORY_FLOW_ONLY','Request-level signature is refused for a Skills lab request');

select * from finish();
rollback;
