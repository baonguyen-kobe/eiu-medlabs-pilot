begin;

select plan(10);

-- t4e step 3: a Skills lab room shared with Y cơ sở. Both sides book it, one
-- booking per slot, and each side sees only its own sessions there.
do $$
declare
  bm_type uuid := '40000000-0000-0000-0000-000000000002';
  skills_type uuid := '40000000-0000-0000-0000-000000000001';
begin
  insert into auth.users (id, email) values
    ('99300000-0000-4000-8000-000000000001', 'share-admin@example.test'),
    ('99300000-0000-4000-8000-000000000002', 'share-bm-staff@example.test'),
    ('99300000-0000-4000-8000-000000000003', 'share-skills-staff@example.test'),
    ('99300000-0000-4000-8000-000000000004', 'share-lecturer@example.test');
  insert into public.profiles (id, email, full_name, is_active) values
    ('99300000-0000-4000-8000-000000000001', 'share-admin@example.test', 'Share Admin', true),
    ('99300000-0000-4000-8000-000000000002', 'share-bm-staff@example.test', 'Share BM Staff', true),
    ('99300000-0000-4000-8000-000000000003', 'share-skills-staff@example.test', 'Share Skills Staff', true),
    ('99300000-0000-4000-8000-000000000004', 'share-lecturer@example.test', 'Share Lecturer', true)
  on conflict (id) do update set email = excluded.email, is_active = excluded.is_active;
  insert into public.user_roles (user_id, role) values
    ('99300000-0000-4000-8000-000000000001', 'admin'),
    ('99300000-0000-4000-8000-000000000002', 'staff'),
    ('99300000-0000-4000-8000-000000000003', 'staff'),
    ('99300000-0000-4000-8000-000000000004', 'lecturer');
  insert into public.profile_room_types (profile_id, room_type_id) values
    ('99300000-0000-4000-8000-000000000002', bm_type),
    ('99300000-0000-4000-8000-000000000003', skills_type),
    ('99300000-0000-4000-8000-000000000004', bm_type)
  on conflict do nothing;
  insert into public.courses (id, course_code, course_name, room_type_id, is_active) values
    ('99300000-0000-4000-8000-000000000010', 'SHR-SK', 'Shared Skills course', skills_type, true),
    ('99300000-0000-4000-8000-000000000011', 'SHR-BM', 'Shared BM course', bm_type, true);
  insert into public.rooms (id, room_code, building_code, room_name, room_type_id, capacity, is_active) values
    ('99300000-0000-4000-8000-000000000020', 'SHR-1', 'SHR', 'Shared room', skills_type, 30, true),
    ('99300000-0000-4000-8000-000000000021', 'SHR-2', 'SHR', 'BM room', bm_type, 30, true);
end;
$$;

select is((select usage_scopes from public.rooms where id = '99300000-0000-4000-8000-000000000020'),
  '{nursing_skills}'::text[], 'a new room is used by its own side');

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '99300000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', json_build_object('sub', '99300000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
select is(public.set_room_shared_with_basic_medical('99300000-0000-4000-8000-000000000020', true),
  '{nursing_skills,basic_medical}'::text[], 'an Admin shares a Skills lab room with Y cơ sở');
select throws_ok($$select public.set_room_shared_with_basic_medical('99300000-0000-4000-8000-000000000021', true)$$,
  '22023', 'ROOM_SHARE_SKILLS_ONLY', 'only a Skills lab room can be shared');

select set_config('role', 'postgres', true);
do $$
begin
  -- A Skills session 08:00-10:00 and a Basic Medical registration session
  -- 10:00-12:00 the same day in the shared room.
  insert into public.class_schedules (id, course_id, course_code_snapshot, course_name_snapshot, room_id, schedule_date, start_time, end_time, source, schedule_status, student_count, semester, created_by, published_by, published_at) values
    ('99300000-0000-4000-8000-000000000040', '99300000-0000-4000-8000-000000000010', 'SHR-SK', 'Shared Skills course',
     '99300000-0000-4000-8000-000000000020', current_date + 30, time '08:00', time '10:00', 'manual', 'published', 20, 'HK1',
     '99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001', clock_timestamp());
  insert into public.basic_medical_registrations (id, academic_year, semester, start_date, end_date, course_id, room_id, student_count, registrant_id, responsible_lecturer_id, created_by) values
    ('99300000-0000-4000-8000-000000000030', '2042-2043', 'HK1', current_date + 30, current_date + 30,
     '99300000-0000-4000-8000-000000000011', '99300000-0000-4000-8000-000000000020', 20,
     '99300000-0000-4000-8000-000000000004', '99300000-0000-4000-8000-000000000004', '99300000-0000-4000-8000-000000000001');
  perform set_config('app.basic_medical_registration_mutation', 'true', true);
  insert into public.class_schedules (id, course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id, schedule_date, start_time, end_time, source, basic_medical_registration_id, schedule_status, student_count, created_by, published_by, published_at) values
    ('99300000-0000-4000-8000-000000000041', '99300000-0000-4000-8000-000000000011', 'SHR-BM', 'Shared BM course',
     '99300000-0000-4000-8000-000000000020', '99300000-0000-4000-8000-000000000004', current_date + 30, time '10:00', time '12:00', 'manual',
     '99300000-0000-4000-8000-000000000030', 'published', 20, '99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001', clock_timestamp());
  insert into public.basic_medical_registration_sessions (id, registration_id, class_schedule_id, lesson_title, teaching_lecturer_id, session_number) values
    ('99300000-0000-4000-8000-000000000050', '99300000-0000-4000-8000-000000000030', '99300000-0000-4000-8000-000000000041', 'Shared session', '99300000-0000-4000-8000-000000000004', 1);
  perform set_config('app.basic_medical_registration_mutation', 'false', true);
end;
$$;

select throws_ok($$
  insert into public.class_schedules (course_id, course_code_snapshot, course_name_snapshot, room_id, schedule_date, start_time, end_time, source, schedule_status, student_count, semester, created_by, published_by, published_at)
  values ('99300000-0000-4000-8000-000000000010', 'SHR-SK', 'Overlap', '99300000-0000-4000-8000-000000000020', current_date + 30, time '10:30', time '11:30', 'manual', 'published', 20, 'HK1', '99300000-0000-4000-8000-000000000001', '99300000-0000-4000-8000-000000000001', clock_timestamp())$$,
  '23P01', null, 'a slot booked by Y cơ sở is locked for Skills lab');

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '99300000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', json_build_object('sub', '99300000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
select is((select count(*)::integer from public.rooms where id = '99300000-0000-4000-8000-000000000020'),
  1, 'Basic Medical staff see the shared room');
select is((select array_agg(course_code_snapshot order by start_time) from public.class_schedules where room_id = '99300000-0000-4000-8000-000000000020'),
  '{SHR-BM}'::text[], 'Basic Medical staff see only their session in the shared room');

select set_config('request.jwt.claim.sub', '99300000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', json_build_object('sub', '99300000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
select is((select array_agg(course_code_snapshot order by start_time) from public.class_schedules where room_id = '99300000-0000-4000-8000-000000000020'),
  '{SHR-SK}'::text[], 'Skills staff see only their session in the shared room');
with changed as (update public.class_schedules set note = 'x'
    where id = '99300000-0000-4000-8000-000000000041' returning 1)
select is(count(*)::integer, 0, 'Skills staff cannot change a Basic Medical session in the shared room') from changed;

select set_config('request.jwt.claim.sub', '99300000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', json_build_object('sub', '99300000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
select throws_ok($$select public.set_room_shared_with_basic_medical('99300000-0000-4000-8000-000000000020', false)$$,
  '23503', 'ROOM_SHARE_IN_USE', 'sharing stays while Y cơ sở has upcoming sessions there');

select set_config('role', 'postgres', true);
select is((select usage_scopes from public.rooms where id = '99300000-0000-4000-8000-000000000020'),
  '{nursing_skills,basic_medical}'::text[], 'the room is still shared');

select * from finish();
rollback;
