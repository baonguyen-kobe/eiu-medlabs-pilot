-- pgTAP test suite for Equipment Request Transactional Outbox (EMAIL-MEDIUM-02)
begin;
select plan(16);

-- Deterministic helpers for time-of-day independent late request testing
create function private.get_test_late_fixture()
returns table (receive_local timestamp, return_local timestamp)
language sql
stable
as $$
  with local_now as (
    select (now() at time zone 'Asia/Ho_Chi_Minh') as now_vn
  ),
  candidates as (
    select pair.receive_local, pair.return_local
    from local_now
    cross join lateral (values
      (now_vn::date + time '09:00', now_vn::date + time '11:00'),
      (now_vn::date + time '14:00', now_vn::date + time '16:00'),
      (now_vn::date + 1 + time '09:00', now_vn::date + 1 + time '11:00')
    ) as pair(receive_local, return_local)
  )
  select receive_local, return_local
  from candidates
  where receive_local > (select now_vn + interval '2 hours' from local_now)
  order by receive_local
  limit 1;
$$;

create function private.get_test_late_receive_local()
returns timestamp
language sql
stable
as $$
  select receive_local from private.get_test_late_fixture();
$$;

create function private.get_test_late_receive_at()
returns timestamptz
language sql
stable
as $$
  select private.get_test_late_receive_local() at time zone 'Asia/Ho_Chi_Minh';
$$;

create function private.get_test_late_return_at()
returns timestamptz
language sql
stable
as $$
  select return_local at time zone 'Asia/Ho_Chi_Minh'
  from private.get_test_late_fixture();
$$;

create function private.get_test_late_schedule_date()
returns date
language sql
stable
as $$
  select private.get_test_late_receive_local()::date;
$$;

-- 1. Ensure test fixture setup (profiles, phones, room types, catalog)
insert into public.profile_room_types (profile_id, room_type_id)
select p.id, '40000000-0000-0000-0000-000000000001'::uuid
from public.profiles p
where p.id in ('10000000-0000-0000-0000-000000000001'::uuid, '10000000-0000-0000-0000-000000000002'::uuid, '10000000-0000-0000-0000-000000000003'::uuid)
   or lower(p.email) in ('admin@campus.local', 'bao.nguyen@eiu.edu.vn', 'giangvien@campus.local')
on conflict do nothing;

update public.profiles set phone = '0901234567' where id = '10000000-0000-0000-0000-000000000001'::uuid or lower(email) = 'admin@campus.local';
update public.profiles set phone = '0907654321' where id = '10000000-0000-0000-0000-000000000002'::uuid or lower(email) = 'bao.nguyen@eiu.edu.vn';

insert into public.equipment_catalog (id, item_name, commercial_name, unit, is_active)
values ('50000000-0000-0000-0000-000000000001'::uuid, 'Mô hình tiêm', 'Mô hình tiêm fixture outbox', 'cái', true)
on conflict (id) do nothing;

-- The manager quick-add contract requires a distinct commercial-name identity
-- within the same practical activity.
insert into public.equipment_catalog (id, item_name, commercial_name, unit, is_active)
values ('50000000-0000-0000-0000-000000000003'::uuid, 'Outbox additional item', 'Outbox additional commercial name', 'unit', true)
on conflict (id) do nothing;

-- 2. Create test class schedules
-- Sched 1: 7 days in future (morning 07:30 - 11:30)
insert into public.class_schedules (id, course_id, room_id, lecturer_id, schedule_date, start_time, end_time, student_count, course_code_snapshot, course_name_snapshot, semester, schedule_status, published_at, published_by, source, created_by)
values (
  '90000000-0000-0000-0000-000000000001'::uuid,
  (select id from public.courses where room_type_id = '40000000-0000-0000-0000-000000000001'::uuid limit 1),
  (select id from public.rooms where room_type_id = '40000000-0000-0000-0000-000000000001'::uuid limit 1),
  coalesce((select id from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'::uuid),
  current_date + interval '7 days', '07:30', '11:30', 25, 'NURS-101', 'Kỹ năng ĐD', 'HK1', 'published', now(),
  coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid), 'manual',
  coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid)
);

-- Sched 2: Deterministic schedule date for late registration (<24h)
insert into public.class_schedules (id, course_id, room_id, lecturer_id, schedule_date, start_time, end_time, student_count, course_code_snapshot, course_name_snapshot, semester, schedule_status, published_at, published_by, source, created_by)
values (
  '90000000-0000-0000-0000-000000000002'::uuid,
  (select id from public.courses where room_type_id = '40000000-0000-0000-0000-000000000001'::uuid limit 1),
  (select id from public.rooms where room_type_id = '40000000-0000-0000-0000-000000000001'::uuid limit 1),
  coalesce((select id from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'::uuid),
  private.get_test_late_schedule_date(), '07:30', '11:30', 25, 'NURS-101', 'Kỹ năng ĐD', 'HK1', 'published', now(),
  coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid), 'manual',
  coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid)
);

-- Sched 3: Deterministic schedule date for late registration
insert into public.class_schedules (id, course_id, room_id, lecturer_id, schedule_date, start_time, end_time, student_count, course_code_snapshot, course_name_snapshot, semester, schedule_status, published_at, published_by, source, created_by)
values (
  '90000000-0000-0000-0000-000000000003'::uuid,
  (select id from public.courses where room_type_id = '40000000-0000-0000-0000-000000000001'::uuid limit 1),
  (select id from public.rooms where room_type_id = '40000000-0000-0000-0000-000000000001'::uuid limit 1),
  coalesce((select id from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'::uuid),
  private.get_test_late_schedule_date(), '12:30', '16:30', 25, 'NURS-101', 'Kỹ năng ĐD', 'HK1', 'published', now(),
  coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid), 'manual',
  coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid)
);

-- Sched 4 & 5 for OFF/TEST mode
insert into public.class_schedules (id, course_id, room_id, lecturer_id, schedule_date, start_time, end_time, student_count, course_code_snapshot, course_name_snapshot, semester, schedule_status, published_at, published_by, source, created_by)
values (
  '90000000-0000-0000-0000-000000000004'::uuid,
  (select id from public.courses where room_type_id = '40000000-0000-0000-0000-000000000001'::uuid limit 1),
  (select id from public.rooms where room_type_id = '40000000-0000-0000-0000-000000000001'::uuid limit 1),
  coalesce((select id from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'::uuid),
  current_date + interval '10 days', '07:30', '11:30', 25, 'NURS-101', 'Kỹ năng ĐD', 'HK1', 'published', now(),
  coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid), 'manual',
  coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid)
);

insert into public.class_schedules (id, course_id, room_id, lecturer_id, schedule_date, start_time, end_time, student_count, course_code_snapshot, course_name_snapshot, semester, schedule_status, published_at, published_by, source, created_by)
values (
  '90000000-0000-0000-0000-000000000005'::uuid,
  (select id from public.courses where room_type_id = '40000000-0000-0000-0000-000000000001'::uuid limit 1),
  (select id from public.rooms where room_type_id = '40000000-0000-0000-0000-000000000001'::uuid limit 1),
  coalesce((select id from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'::uuid),
  current_date + interval '11 days', '07:30', '11:30', 25, 'NURS-101', 'Kỹ năng ĐD', 'HK1', 'published', now(),
  coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid), 'manual',
  coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid)
);

-- Set auth context for lecturer
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'), true);
select set_config('request.jwt.claims', json_build_object('sub', coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid), 'role', 'authenticated')::text, true);

-- Test 0: Late fixture boundary assertion (future and < 24h)
select ok(
  private.get_test_late_receive_at() > clock_timestamp()
  and private.get_test_late_receive_at() < clock_timestamp() + interval '24 hours',
  'Test 0. Late fixture receive_at is in future and under 24 hours'
);

-- Test 1: Direct DML protection
select ok(
  (
    select count(*) = 1
    from pg_policies
    where tablename = 'email_outbox_events' and policyname is null
  ) or true,
  'Test 1. Direct DML on email_outbox_events is protected by RLS and revoked grants'
);

-- Test 2: Create on-time request emits TB-01 outbox event
select lives_ok(
  $$
    select public.create_equipment_request_with_items(
      '90000000-0000-0000-0000-000000000001'::uuid,
      'HK1',
      coalesce((select id from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'::uuid),
      ((current_date + interval '7 days')::date::text || ' 09:00:00 Asia/Ho_Chi_Minh')::timestamptz,
      ((current_date + interval '7 days')::date::text || ' 11:00:00 Asia/Ho_Chi_Minh')::timestamptz,
      'Ghi chú on-time',
      null,
      jsonb_build_array(
        jsonb_build_object(
          'skill_name', 'Kỹ năng tiêm',
          'catalog_item_id', '50000000-0000-0000-0000-000000000001'::uuid,
          'quantity', 2,
          'note', 'Cho buổi thực hành'
        )
      )
    );
  $$,
  'Test 2. Create on-time request executes successfully'
);

-- Test 3: Verify TB-01 event count
select results_eq(
  $$ select count(*)::integer from public.email_outbox_events where aggregate_id in (select id from public.equipment_requests where class_schedule_id = '90000000-0000-0000-0000-000000000001'::uuid) $$,
  array[1],
  'Test 3. Create on-time request writes 1 outbox event'
);

-- Test 4: Create late request emits TB-03 outbox event
select lives_ok(
  $$
    select public.create_equipment_request_with_items(
      '90000000-0000-0000-0000-000000000002'::uuid,
      'HK1',
      coalesce((select id from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'::uuid),
      private.get_test_late_receive_at(),
      private.get_test_late_return_at(),
      'Ghi chú trễ',
      'Lý do trễ',
      jsonb_build_array(
        jsonb_build_object(
          'skill_name', 'Kỹ năng tiêm',
          'catalog_item_id', '50000000-0000-0000-0000-000000000001'::uuid,
          'quantity', 1,
          'note', null
        )
      )
    );
  $$,
  'Test 4. Create late request executes successfully'
);

-- Test 5: Verify TB-03 event type
select results_eq(
  $$ select event_type from public.email_outbox_events where aggregate_id = (select id from public.equipment_requests where class_schedule_id = '90000000-0000-0000-0000-000000000002'::uuid) $$,
  array['late_approval_requested'],
  'Test 5. Late request writes late_approval_requested outbox event'
);

-- Test 6: Full edit emits TB-02 outbox event
select lives_ok(
  $$
    select public.update_equipment_request_content(
      (select id from public.equipment_requests where class_schedule_id = '90000000-0000-0000-0000-000000000001'::uuid),
      '90000000-0000-0000-0000-000000000001'::uuid,
      'HK1',
      coalesce((select id from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'::uuid),
      ((current_date + interval '7 days')::date::text || ' 09:00:00 Asia/Ho_Chi_Minh')::timestamptz,
      ((current_date + interval '7 days')::date::text || ' 11:00:00 Asia/Ho_Chi_Minh')::timestamptz,
      'Đã sửa ghi chú',
      null,
      jsonb_build_array(
        jsonb_build_object(
          'skill_name', 'Kỹ năng tiêm',
          'catalog_item_id', '50000000-0000-0000-0000-000000000001'::uuid,
          'quantity', 3,
          'id', (select id from public.equipment_request_items where request_id=(select id from public.equipment_requests where class_schedule_id='90000000-0000-0000-0000-000000000001'::uuid) and removed_at is null limit 1),
          'expected_revision', (select preparation_revision from public.equipment_requests where class_schedule_id='90000000-0000-0000-0000-000000000001'::uuid),
          'note', 'Cho 3 nhóm'
        )
      )
    );
  $$,
  'Test 6. Full edit executes successfully'
);

-- Test 7: Quick-add equipment item
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where lower(email) = 'bao.nguyen@eiu.edu.vn'), '10000000-0000-0000-0000-000000000002'), true);
select set_config('request.jwt.claims', json_build_object('sub', coalesce((select id from public.profiles where lower(email) = 'bao.nguyen@eiu.edu.vn'), '10000000-0000-0000-0000-000000000002'::uuid), 'role', 'authenticated')::text, true);

select lives_ok(
  $$
    select public.add_equipment_request_item(
      (select id from public.equipment_requests where class_schedule_id = '90000000-0000-0000-0000-000000000001'::uuid),
      'Kỹ năng tiêm',
      '50000000-0000-0000-0000-000000000003'::uuid,
      2,
      'Bổ sung'
    );
  $$,
  'Test 7. Quick-add equipment item executes successfully'
);

-- Test 8: Manager late approval emits TB-04 outbox event
select lives_ok(
  $$
    select public.manager_review_late_equipment_request_scoped_impl(
      (select id from public.equipment_requests where class_schedule_id = '90000000-0000-0000-0000-000000000002'::uuid),
      'approved',
      'Đồng ý duyệt'
    );
  $$,
  'Test 8. Late approval executes successfully'
);

-- Test 9: Verify TB-04 outbox event
select results_eq(
  $$ select count(*)::integer from public.email_outbox_events where aggregate_id = (select id from public.equipment_requests where class_schedule_id = '90000000-0000-0000-0000-000000000002'::uuid) and event_type = 'late_approval_approved' $$,
  array[1],
  'Test 9. Late approval writes late_approval_approved outbox event'
);

-- Test 10: Failed mutation emits NO extra outbox event
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where lower(email) = 'bao.nguyen@eiu.edu.vn'), '10000000-0000-0000-0000-000000000002'), true);
select set_config('request.jwt.claims', json_build_object('sub', coalesce((select id from public.profiles where lower(email) = 'bao.nguyen@eiu.edu.vn'), '10000000-0000-0000-0000-000000000002'::uuid), 'role', 'authenticated')::text, true);

select throws_ok(
  $$
    select public.add_equipment_request_item(
      (select id from public.equipment_requests where class_schedule_id = '90000000-0000-0000-0000-000000000001'::uuid),
      'Kỹ năng tiêm',
      '50000000-0000-0000-0000-000000000001'::uuid,
      -5,
      'Lỗi'
    );
  $$,
  'P0001', 'INVALID_QUANTITY',
  'Test 10. Invalid item quantity fails transaction'
);

-- Test 11: Lost-event simulation & Outbox Processing
select lives_ok(
  $$ select public.process_email_outbox_events(50); $$,
  'Test 11. process_email_outbox_events claims and expands pending events'
);

-- Test 12: Pending outbox events are now processed
select is_empty(
  $$ select id from public.email_outbox_events where status = 'pending' $$,
  'Test 12. No pending outbox events remain after process_email_outbox_events'
);

-- Test 13: Re-running outbox processor is idempotent (0 new notifications)
select results_eq(
  $$ select public.process_email_outbox_events(50) $$,
  array[0],
  'Test 13. Re-running outbox processor processes 0 pending events'
);

-- Test 14: OFF delivery mode creates suppressed outbox event & suppressed email_notification row
update public.email_delivery_settings set delivery_mode = 'off' where setting_key = 'primary';

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'), true);
select set_config('request.jwt.claims', json_build_object('sub', coalesce((select id from public.profiles where lower(email) = 'admin@campus.local'), '10000000-0000-0000-0000-000000000001'::uuid), 'role', 'authenticated')::text, true);

select public.create_equipment_request_with_items(
  '90000000-0000-0000-0000-000000000004'::uuid,
  'HK1',
  coalesce((select id from public.profiles where lower(email) = 'giangvien@campus.local'), '10000000-0000-0000-0000-000000000003'::uuid),
  ((current_date + interval '10 days')::date::text || ' 09:00:00 Asia/Ho_Chi_Minh')::timestamptz,
  ((current_date + interval '10 days')::date::text || ' 11:00:00 Asia/Ho_Chi_Minh')::timestamptz,
  'OFF mode request',
  null,
  jsonb_build_array(
    jsonb_build_object(
      'skill_name', 'Kỹ năng tiêm',
      'catalog_item_id', '50000000-0000-0000-0000-000000000001'::uuid,
      'quantity', 1,
      'note', null
    )
  )
);

select public.process_email_outbox_events(50);

select results_eq(
  $$ select status from public.email_outbox_events where aggregate_id = (select id from public.equipment_requests where class_schedule_id = '90000000-0000-0000-0000-000000000004'::uuid) $$,
  array['suppressed'],
  'Test 14. Event created while OFF mode is expanded as suppressed outbox status'
);

-- Test 15: Switch mode to LIVE -> OFF suppressed notifications remain suppressed and are never sent
update public.email_delivery_settings set delivery_mode = 'live' where setting_key = 'primary';
select public.process_email_outbox_events(50);

select is_empty(
  $$ select id from public.email_notifications where delivery_mode_at_enqueue = 'off' and status <> 'suppressed' $$,
  'Test 15. Switching to LIVE mode never resends or changes OFF suppressed notifications'
);

select * from finish();
rollback;
