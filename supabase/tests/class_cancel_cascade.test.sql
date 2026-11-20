-- Cancelling a Skills class cancels its open equipment requests and emails the lecturers.
begin;
select plan(5);

insert into public.profile_room_types (profile_id, room_type_id)
select p.id, '40000000-0000-0000-0000-000000000001'::uuid
from public.profiles p
where lower(p.email) in ('admin@campus.local', 'giangvien@campus.local')
on conflict do nothing;
update public.profiles set phone = '0901234567' where lower(email) = 'admin@campus.local';

insert into public.equipment_catalog (id, item_name, commercial_name, unit, is_active)
values ('50000000-0000-0000-0000-000000000101'::uuid, 'Mô hình cascade', 'Mô hình cascade fixture', 'cái', true)
on conflict (id) do nothing;

insert into public.class_schedules (id, course_id, room_id, lecturer_id, schedule_date, start_time, end_time, student_count, course_code_snapshot, course_name_snapshot, semester, schedule_status, published_at, published_by, source, created_by)
values (
  '90000000-0000-0000-0000-000000000101'::uuid,
  (select id from public.courses where room_type_id = '40000000-0000-0000-0000-000000000001'::uuid limit 1),
  (select id from public.rooms where room_type_id = '40000000-0000-0000-0000-000000000001'::uuid limit 1),
  (select id from public.profiles where lower(email) = 'giangvien@campus.local'),
  current_date + interval '9 days', '07:30', '11:30', 25, 'NURS-CASCADE', 'Kỹ năng ĐD', 'HK1', 'published', now(),
  (select id from public.profiles where lower(email) = 'admin@campus.local'), 'manual',
  (select id from public.profiles where lower(email) = 'admin@campus.local')
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where lower(email) = 'admin@campus.local'), true);
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where lower(email) = 'admin@campus.local'), 'role', 'authenticated')::text, true);

select lives_ok(
  $$
    select public.create_equipment_request_with_items(
      '90000000-0000-0000-0000-000000000101'::uuid,
      'HK1',
      (select id from public.profiles where lower(email) = 'giangvien@campus.local'),
      ((current_date + interval '9 days')::date::text || ' 09:00:00 Asia/Ho_Chi_Minh')::timestamptz,
      ((current_date + interval '9 days')::date::text || ' 11:00:00 Asia/Ho_Chi_Minh')::timestamptz,
      null,
      null,
      jsonb_build_array(jsonb_build_object(
        'skill_name', 'Kỹ năng cascade',
        'catalog_item_id', '50000000-0000-0000-0000-000000000101'::uuid,
        'quantity', 1,
        'note', null
      ))
    );
  $$,
  'A new request is created for the class'
);

select lives_ok(
  $$ select public.cancel_class_schedule('90000000-0000-0000-0000-000000000101'::uuid); $$,
  'The admin cancels the class'
);

select results_eq(
  $$ select status from public.equipment_requests where class_schedule_id = '90000000-0000-0000-0000-000000000101'::uuid $$,
  array['cancelled'::text],
  'The open equipment request is cancelled with the class'
);

select results_eq(
  $$ select count(*)::integer from public.audit_logs
     where action = 'equipment_request.cancelled'
       and metadata->>'schedule_id' = '90000000-0000-0000-0000-000000000101' $$,
  array[1],
  'The cascade writes an audit row'
);

select results_eq(
  $$ select count(*)::integer from public.email_outbox_events
     where event_key = 'skills_lab:cancelled:90000000-0000-0000-0000-000000000101' $$,
  array[1],
  'The cancelled Skills class queues an email to its lecturers'
);

select * from finish();
rollback;
