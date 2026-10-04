begin;
select plan(57);

-- Setup test users
create or replace function pg_temp.setup_test_data() returns void language plpgsql as $$
declare
  skills_type_id uuid;
  basic_type_id uuid;
  staff_user_id uuid := '11111111-1111-1111-1111-111111111111'::uuid;
  admin_user_id uuid := '22222222-2222-2222-2222-222222222222'::uuid;
  root_user_id uuid := '33333333-3333-3333-3333-333333333333'::uuid;
  basic_only_id uuid := '44444444-4444-4444-4444-444444444444'::uuid;
  history_mgr_id uuid := '55555555-5555-5555-5555-555555555555'::uuid;
  admin_no_skills_id uuid := '66666666-6666-6666-6666-666666666666'::uuid;
  lecturer_user_id uuid := '77777777-7777-7777-7777-777777777777'::uuid;
  teaching_assistant_id uuid := '88888888-8888-8888-8888-888888888888'::uuid;
  viewer_user_id uuid := '99999999-9999-9999-9999-999999999999'::uuid;
  staff_no_skills_id uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  fixture_shift_id uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;
begin
  select id into skills_type_id from public.room_types where code = 'nursing_skills';
  select id into basic_type_id from public.room_types where code = 'basic_medical';

  -- Auth users
  insert into auth.users (id, email)
  values
    (staff_user_id, 'staff.skills@eiu.edu.vn'),
    (admin_user_id, 'admin.skills@eiu.edu.vn'),
    (root_user_id, 'root.staff-shifts@eiu.edu.vn'),
    (basic_only_id, 'basic.staff@eiu.edu.vn'),
    (history_mgr_id, 'history.manager@eiu.edu.vn'),
    (admin_no_skills_id, 'admin.noskills@eiu.edu.vn'),
    (lecturer_user_id, 'lecturer.staff-shifts@eiu.edu.vn'),
    (teaching_assistant_id, 'ta.staff-shifts@eiu.edu.vn'),
    (viewer_user_id, 'viewer.staff-shifts@eiu.edu.vn'),
    (staff_no_skills_id, 'staff.noskills@eiu.edu.vn')
  on conflict (id) do nothing;

  -- Profiles
  insert into public.profiles (id, email, full_name, is_active, can_manage_shift_history)
  values
    (staff_user_id, 'staff.skills@eiu.edu.vn', 'Staff Skills User', true, false),
    (admin_user_id, 'admin.skills@eiu.edu.vn', 'Admin Skills User', true, false),
    (root_user_id, 'root.staff-shifts@eiu.edu.vn', 'Root Staff Shift User', true, false),
    (basic_only_id, 'basic.staff@eiu.edu.vn', 'Basic Medical Staff', true, false),
    (history_mgr_id, 'history.manager@eiu.edu.vn', 'History Manager User', true, true),
    (admin_no_skills_id, 'admin.noskills@eiu.edu.vn', 'Admin No Skills User', true, false),
    (lecturer_user_id, 'lecturer.staff-shifts@eiu.edu.vn', 'Lecturer User', true, false),
    (teaching_assistant_id, 'ta.staff-shifts@eiu.edu.vn', 'Teaching Assistant User', true, false),
    (viewer_user_id, 'viewer.staff-shifts@eiu.edu.vn', 'Viewer User', true, false),
    (staff_no_skills_id, 'staff.noskills@eiu.edu.vn', 'Staff No Skills User', true, false)
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    can_manage_shift_history = excluded.can_manage_shift_history,
    is_active = excluded.is_active;

  -- Roles
  insert into public.user_roles (user_id, role, created_by)
  values
    (staff_user_id, 'staff', staff_user_id),
    (admin_user_id, 'admin', admin_user_id),
    (root_user_id, 'admin', root_user_id),
    (basic_only_id, 'staff', basic_only_id),
    (history_mgr_id, 'admin', history_mgr_id),
    (admin_no_skills_id, 'admin', admin_no_skills_id),
    (lecturer_user_id, 'lecturer', lecturer_user_id),
    (teaching_assistant_id, 'teaching_assistant', teaching_assistant_id),
    (viewer_user_id, 'viewer', viewer_user_id),
    (staff_no_skills_id, 'staff', staff_no_skills_id)
  on conflict do nothing;

  -- Room types
  insert into public.profile_room_types (profile_id, room_type_id, receive_schedule_emails, created_by)
  values
    (staff_user_id, skills_type_id, false, staff_user_id),
    (admin_user_id, skills_type_id, false, admin_user_id),
    (basic_only_id, basic_type_id, false, basic_only_id),
    (history_mgr_id, skills_type_id, false, history_mgr_id),
    (admin_no_skills_id, basic_type_id, false, admin_no_skills_id);

  insert into public.system_security_principals (singleton, root_admin_id, personnel_manager_id, configured_by)
  values (true, root_user_id, history_mgr_id, root_user_id)
  on conflict (singleton) do update set
    root_admin_id = excluded.root_admin_id,
    personnel_manager_id = excluded.personnel_manager_id,
    configured_by = excluded.configured_by;

  insert into public.staff_shifts (
    id, staff_id, shift_date, shift_slot, start_time, end_time,
    status, registration_source, created_by
  ) values (
    fixture_shift_id, staff_user_id, '2099-01-02', 'MORNING', '07:00', '11:00',
    'scheduled', 'admin_assigned', admin_user_id
  ) on conflict (id) do nothing;
end;
$$;

select pg_temp.setup_test_data();

-- Helper function to set test auth context
create or replace function pg_temp.set_test_user(target_user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', target_user_id::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', target_user_id, 'role', 'authenticated')::text, false);
end;
$$;

create or replace function pg_temp.get_root_admin_id() returns uuid language sql security definer as $$
  select root_admin_id from public.system_security_principals where singleton;
$$;

-- 1-9. Staff Shift SELECT authority follows the canonical operational helper
select pg_temp.set_test_user('11111111-1111-1111-1111-111111111111'::uuid);
select ok((select count(*) from public.staff_shifts) > 0, 'Staff with Skills scope can read staff_shifts');

select pg_temp.set_test_user('22222222-2222-2222-2222-222222222222'::uuid);
select ok((select count(*) from public.staff_shifts) > 0, 'Admin with Skills scope can read staff_shifts');

select pg_temp.set_test_user('33333333-3333-3333-3333-333333333333'::uuid);
select ok((select count(*) from public.staff_shifts) > 0, 'Root Administrator can read staff_shifts');

select pg_temp.set_test_user('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
select is((select count(*)::integer from public.staff_shifts), 0, 'Staff without Skills scope cannot read staff_shifts');

select pg_temp.set_test_user('66666666-6666-6666-6666-666666666666'::uuid);
select is((select count(*)::integer from public.staff_shifts), 0, 'Admin without Skills scope cannot read staff_shifts');

select pg_temp.set_test_user('77777777-7777-7777-7777-777777777777'::uuid);
select is((select count(*)::integer from public.staff_shifts), 0, 'Lecturer cannot read staff_shifts');

select pg_temp.set_test_user('88888888-8888-8888-8888-888888888888'::uuid);
select is((select count(*)::integer from public.staff_shifts), 0, 'Teaching Assistant cannot read staff_shifts');

select pg_temp.set_test_user('99999999-9999-9999-9999-999999999999'::uuid);
select is((select count(*)::integer from public.staff_shifts), 0, 'Viewer cannot read staff_shifts');

select pg_temp.set_test_user('44444444-4444-4444-4444-444444444444'::uuid);
select is((select count(*)::integer from public.staff_shifts), 0, 'Basic-Medical-only user cannot read staff_shifts');

-- 10. Test list_operational_shift_assignees directory
select pg_temp.set_test_user('11111111-1111-1111-1111-111111111111'::uuid);

select is(
  (
    select count(*)::integer from public.list_operational_shift_assignees()
    where id in (
      '11111111-1111-1111-1111-111111111111'::uuid,
      '22222222-2222-2222-2222-222222222222'::uuid,
      '44444444-4444-4444-4444-444444444444'::uuid,
      '55555555-5555-5555-5555-555555555555'::uuid,
      '66666666-6666-6666-6666-666666666666'::uuid
    )
  ),
  3,
  'list_operational_shift_assignees includes only Skills-scoped staff/admin and excludes basic-only users'
);

-- 2. Test canonical Morning registration valid time & grid
select lives_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '2 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30',
          'note', 'Morning shift test'
        )
      )
    )
  $$,
  'Staff can register valid morning shift for self'
);

-- 3. Duplicate active slot throws error
select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '2 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '10:30'
        )
      )
    )
  $$,
  'ACTIVE_SHIFT_EXISTS: Staff 11111111-1111-1111-1111-111111111111 already has an active MORNING shift on ' || (((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '2 days')::date)::text,
  'Duplicate active morning shift is rejected'
);

-- 4. Retired Morning start time is rejected for a new write
select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '3 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:00',
          'end_time', '11:30'
        )
      )
    )
  $$,
  'INVALID_MORNING_TIME: Morning shift must be within 07:30-11:30 on 30-minute grid',
  'Retired Morning start time is rejected'
);

-- 5. Morning end time after canonical window is rejected
select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '3 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '12:00'
        )
      )
    )
  $$,
  'INVALID_MORNING_TIME: Morning shift must be within 07:30-11:30 on 30-minute grid',
  'Morning shift later than 11:30 is rejected'
);

-- 6. Invalid 30-minute grid is rejected
select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '3 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:45',
          'end_time', '11:30'
        )
      )
    )
  $$,
  'INVALID_MORNING_TIME: Morning shift must be within 07:30-11:30 on 30-minute grid',
  'Morning shift off 30-minute grid is rejected'
);

-- 7. Afternoon valid registration
select lives_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '2 days')::date,
          'shift_slot', 'AFTERNOON',
          'start_time', '12:30',
          'end_time', '16:30'
        )
      )
    )
  $$,
  'Staff can register valid afternoon shift for self on same date as morning'
);

-- 8. Afternoon time before canonical window is rejected
select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '3 days')::date,
          'shift_slot', 'AFTERNOON',
          'start_time', '12:00',
          'end_time', '16:30'
        )
      )
    )
  $$,
  'INVALID_AFTERNOON_TIME: Afternoon shift must be within 12:30-16:30 on 30-minute grid',
  'Afternoon shift earlier than 12:30 is rejected'
);

-- 9. Afternoon time after canonical window is rejected
select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '3 days')::date,
          'shift_slot', 'AFTERNOON',
          'start_time', '12:30',
          'end_time', '17:00'
        )
      )
    )
  $$,
  'INVALID_AFTERNOON_TIME: Afternoon shift must be within 12:30-16:30 on 30-minute grid',
  'Afternoon shift later than 16:30 is rejected'
);

-- 10. Intra-payload duplicate throws error
select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '4 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        ),
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '4 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '08:00',
          'end_time', '10:00'
        )
      )
    )
  $$,
  'DUPLICATE_PAYLOAD_SLOT: Multiple entries for staff 11111111-1111-1111-1111-111111111111 on ' || (((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '4 days')::date)::text || ' slot MORNING in the same request',
  'Intra-payload duplicate for same staff on same date slot is rejected'
);

-- 11. Staff cannot register for another staff
select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '22222222-2222-2222-2222-222222222222'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '5 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        )
      )
    )
  $$,
  'PERMISSION_DENIED: Staff members can only register shifts for themselves',
  'Staff cannot register for another user'
);

-- 12. Admin can register for other staff
select pg_temp.set_test_user('22222222-2222-2222-2222-222222222222'::uuid);

select lives_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '5 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        )
      )
    )
  $$,
  'Admin can register shift for staff member'
);

-- 13. Registration source is admin_assigned
select is(
  (
    select registration_source::text from public.staff_shifts
    where staff_id = '11111111-1111-1111-1111-111111111111'::uuid
      and shift_date = ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '5 days')::date
      and shift_slot = 'MORNING'
      and status <> 'cancelled'
  ),
  'admin_assigned',
  'Shift registered by admin has admin_assigned source'
);

-- 14. Cannot register Basic-Medical-only user
select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '44444444-4444-4444-4444-444444444444'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '6 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        )
      )
    )
  $$,
  'ASSIGNEE_NOT_ELIGIBLE: User 44444444-4444-4444-4444-444444444444 is not eligible for Skills Lab shifts',
  'Cannot register basic-medical-only user for shift'
);

-- 15. Cannot register Root Administrator
select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', pg_temp.get_root_admin_id(),
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '6 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        )
      )
    )
  $$,
  'ASSIGNEE_NOT_ELIGIBLE: User ' || pg_temp.get_root_admin_id()::text || ' is not eligible for Skills Lab shifts',
  'Cannot register root administrator for shift'
);

-- 16. Cancellation of active shift
select lives_ok(
  $$
    select public.cancel_staff_shift(
      (
        select id from public.staff_shifts
        where staff_id = '11111111-1111-1111-1111-111111111111'::uuid
          and shift_date = ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '5 days')::date
          and shift_slot = 'MORNING'
          and status <> 'cancelled'
        limit 1
      ),
      'Admin adjustment test'
    )
  $$,
  'Admin can cancel scheduled shift'
);

-- 17. Re-registration in cancelled slot succeeds
select lives_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '5 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '08:00',
          'end_time', '11:00'
        )
      )
    )
  $$,
  'Can register new shift in previously cancelled slot'
);

-- 18. Staff CAN edit their OWN future shift time within allowable slot
select pg_temp.set_test_user('11111111-1111-1111-1111-111111111111'::uuid);

select lives_ok(
  $$
    select public.update_staff_shift_time(
      (
        select id from public.staff_shifts
        where staff_id = '11111111-1111-1111-1111-111111111111'::uuid
          and shift_date = ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '2 days')::date
          and shift_slot = 'MORNING'
          and status <> 'cancelled'
        limit 1
      ),
      '07:30'::time,
      '10:30'::time,
      'Updated note by self'
    )
  $$,
  'Staff can edit their own future shift time within slot'
);

-- 19. Staff cannot edit ANOTHER person shift
-- First register a shift for user 22222222
select pg_temp.set_test_user('22222222-2222-2222-2222-222222222222'::uuid);
select * from public.register_staff_shifts(
  jsonb_build_array(
    jsonb_build_object(
      'staff_id', '22222222-2222-2222-2222-222222222222'::uuid,
      'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '8 days')::date,
      'shift_slot', 'MORNING',
      'start_time', '07:30',
      'end_time', '11:30'
    )
  )
);

-- Now switch to normal staff user 11111111
select pg_temp.set_test_user('11111111-1111-1111-1111-111111111111'::uuid);

select throws_ok(
  $$
    select public.update_staff_shift_time(
      (
        select id from public.staff_shifts
        where staff_id = '22222222-2222-2222-2222-222222222222'::uuid
          and shift_date = ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '8 days')::date
          and shift_slot = 'MORNING'
          and status <> 'cancelled'
        limit 1
      ),
      '07:30'::time,
      '10:30'::time
    )
  $$,
  '42501',
  null,
  'Staff cannot edit another person shift when actor is staff'
);

-- 20. Staff editing own shift outside grid or slot bounds fails
select throws_ok(
  $$
    select public.update_staff_shift_time(
      (
        select id from public.staff_shifts
        where staff_id = '11111111-1111-1111-1111-111111111111'::uuid
          and shift_date = ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '2 days')::date
          and shift_slot = 'MORNING'
          and status <> 'cancelled'
        limit 1
      ),
      '06:30'::time,
      '10:30'::time
    )
  $$,
  'INVALID_MORNING_TIME: Morning shift must be within 07:30-11:30 on 30-minute grid',
  'Editing morning shift earlier than 07:30 is rejected'
);

-- 21. Normal staff without history capability creating past shift fails
select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date - interval '2 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        )
      )
    )
  $$,
  'HISTORICAL_MUTATION_FORBIDDEN: Historical shifts require history management capability',
  'Normal staff cannot create historical shifts'
);

-- 22. Admin without history capability on historical date fails
select pg_temp.set_test_user('22222222-2222-2222-2222-222222222222'::uuid);

select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date - interval '2 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        )
      )
    )
  $$,
  'HISTORICAL_MUTATION_FORBIDDEN: Historical shifts require history management capability',
  'Normal admin without history capability cannot create historical shifts'
);

-- 23. User with can_manage_shift_history capability without reason fails
select pg_temp.set_test_user('55555555-5555-5555-5555-555555555555'::uuid);

select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '55555555-5555-5555-5555-555555555555'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date - interval '2 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        )
      )
    )
  $$,
  'HISTORICAL_REASON_REQUIRED: Reason is required for historical shift mutations',
  'Historical registration requires explicit reason'
);

-- 24. User with can_manage_shift_history capability with reason SUCCEEDS
select lives_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '55555555-5555-5555-5555-555555555555'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date - interval '2 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        )
      ),
      'Backfilling completed shift from logbook'
    )
  $$,
  'User with history capability can create historical shift with reason'
);

-- 25. Audit log written for historical creation with EXACT reason string in metadata
select is(
  (
    select metadata->>'reason' from public.audit_logs
    where action = 'create_historical_shift'
      and actor_id = '55555555-5555-5555-5555-555555555555'::uuid
    order by id desc limit 1
  ),
  'Backfilling completed shift from logbook',
  'Audit log contains exact reason string in metadata'
);

-- 26. Historical cancellation with history capability and reason succeeds
do $$
declare
  target_id uuid;
begin
  select id into target_id from public.staff_shifts
  where staff_id = '55555555-5555-5555-5555-555555555555'::uuid
    and shift_date = ((now() at time zone 'Asia/Ho_Chi_Minh')::date - interval '2 days')::date
    and status <> 'cancelled';

  perform public.cancel_staff_shift(target_id, 'Correction of erroneous entry');
end;
$$;

-- 27. Audit log contains exact cancellation reason
select is(
  (
    select metadata->>'reason' from public.audit_logs
    where action = 'cancel_historical_shift'
      and actor_id = '55555555-5555-5555-5555-555555555555'::uuid
    order by id desc limit 1
  ),
  'Correction of erroneous entry',
  'Audit log contains exact historical cancellation reason string'
);

-- 28. Same-day registration is allowed
select pg_temp.set_test_user('11111111-1111-1111-1111-111111111111'::uuid);

select lives_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', (now() at time zone 'Asia/Ho_Chi_Minh')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30',
          'note', 'Today shift'
        )
      )
    )
  $$,
  'Same-day shift registration is allowed'
);

-- 29. Same-day cancellation is allowed
select lives_ok(
  $$
    select public.cancel_staff_shift(
      (
        select id from public.staff_shifts
        where staff_id = '11111111-1111-1111-1111-111111111111'::uuid
          and shift_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date
          and shift_slot = 'MORNING'
          and status <> 'cancelled'
        limit 1
      ),
      'Today emergency'
    )
  $$,
  'Same-day cancellation is allowed'
);

-- 30. Root Administrator implicit historical authority
select pg_temp.set_test_user(pg_temp.get_root_admin_id());

select lives_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date - interval '5 days')::date,
          'shift_slot', 'AFTERNOON',
          'start_time', '12:30',
          'end_time', '16:30'
        )
      ),
      'Root administrative historical record creation'
    )
  $$,
  'Root has implicit historical management authority with reason'
);

-- 31. Capacity is unlimited: multiple people can be registered in the same date and slot
select pg_temp.set_test_user('22222222-2222-2222-2222-222222222222'::uuid);

select lives_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '22222222-2222-2222-2222-222222222222'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '10 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        ),
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '10 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        ),
        jsonb_build_object(
          'staff_id', '55555555-5555-5555-5555-555555555555'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '10 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        )
      )
    )
  $$,
  'Multiple people can be registered in the same date and slot (unlimited capacity)'
);

-- 32. Direct hard DELETE on staff_shifts is revoked
select throws_ok(
  $$
    delete from public.staff_shifts where staff_id = '11111111-1111-1111-1111-111111111111'::uuid;
  $$,
  '42501',
  null,
  'Hard delete on staff_shifts table is forbidden for authenticated users'
);

-- 33. Direct INSERT on staff_shifts is revoked
select throws_ok(
  $$
    insert into public.staff_shifts (staff_id, shift_date, shift_slot, start_time, end_time)
    values ('11111111-1111-1111-1111-111111111111'::uuid, '2026-09-01'::date, 'MORNING', '07:00'::time, '11:00'::time);
  $$,
  '42501',
  null,
  'Direct insert on staff_shifts table is forbidden for authenticated users'
);

-- 34. Direct UPDATE on staff_shifts is revoked
select throws_ok(
  $$
    update public.staff_shifts set note = 'bypass' where staff_id = '11111111-1111-1111-1111-111111111111'::uuid;
  $$,
  '42501',
  null,
  'Direct update on staff_shifts table is forbidden for authenticated users'
);

-- 35. Staff without Skills Lab scope is denied from list_operational_shift_assignees
select pg_temp.set_test_user('44444444-4444-4444-4444-444444444444'::uuid);

select throws_ok(
  $$
    select * from public.list_operational_shift_assignees();
  $$,
  '42501',
  null,
  'Staff without Skills scope is denied from list_operational_shift_assignees'
);

-- 36. Staff without Skills Lab scope is denied from register_staff_shifts
select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '44444444-4444-4444-4444-444444444444'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '2 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        )
      )
    );
  $$,
  '42501',
  null,
  'Staff without Skills scope is denied from register_staff_shifts'
);

-- 37. Admin without Skills Lab scope is denied from list_operational_shift_assignees
select pg_temp.set_test_user('66666666-6666-6666-6666-666666666666'::uuid);

select throws_ok(
  $$
    select * from public.list_operational_shift_assignees();
  $$,
  '42501',
  null,
  'Admin without Skills scope is denied from list_operational_shift_assignees'
);

-- 38. Admin without Skills Lab scope is denied from register_staff_shifts
select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '2 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        )
      )
    );
  $$,
  '42501',
  null,
  'Admin without Skills scope is denied from register_staff_shifts'
);

-- 39. Obsolete function register_own_shift_pattern is absent from pg_proc
select is(
  (select count(*)::integer from pg_proc where proname in ('register_own_shift_pattern', 'cancel_own_shift_pattern')),
  0,
  'register_own_shift_pattern and cancel_own_shift_pattern are absent from pg_proc'
);

-- 40. Obsolete function materialize_shift_pattern is absent from pg_proc
select is(
  (select count(*)::integer from pg_proc where proname = 'materialize_shift_pattern'),
  0,
  'materialize_shift_pattern is absent from pg_proc'
);

-- 41. Obsolete function refresh_open_shift_patterns is absent from pg_proc
select is(
  (select count(*)::integer from pg_proc where proname = 'refresh_open_shift_patterns'),
  0,
  'refresh_open_shift_patterns is absent from pg_proc'
);

-- 42. Obsolete function preserve_staff_shift_history is absent from pg_proc
select is(
  (select count(*)::integer from pg_proc where proname = 'preserve_staff_shift_history'),
  0,
  'preserve_staff_shift_history is absent from pg_proc'
);

-- 43-49. Canonical windows preserve existing data but fail closed for writes.
select pg_temp.set_test_user('11111111-1111-1111-1111-111111111111'::uuid);

select is(
  (
    select start_time::text || '-' || end_time::text
    from public.staff_shifts
    where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
  ),
  '07:00:00-11:00:00',
  'Existing legacy Morning pair survives the canonical-window migration'
);

select lives_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '30 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:30',
          'end_time', '11:30'
        )
      )
    )
  $$,
  'Canonical Morning window accepts 07:30 through 11:30'
);

select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '31 days')::date,
          'shift_slot', 'MORNING',
          'start_time', '07:00',
          'end_time', '11:00'
        )
      )
    )
  $$,
  'INVALID_MORNING_TIME: Morning shift must be within 07:30-11:30 on 30-minute grid',
  'New legacy Morning pair is rejected'
);

select throws_ok(
  $$
    select * from public.register_staff_shifts(
      jsonb_build_array(
        jsonb_build_object(
          'staff_id', '11111111-1111-1111-1111-111111111111'::uuid,
          'shift_date', ((now() at time zone 'Asia/Ho_Chi_Minh')::date + interval '32 days')::date,
          'shift_slot', 'AFTERNOON',
          'start_time', '12:45',
          'end_time', '16:30'
        )
      )
    )
  $$,
  'INVALID_AFTERNOON_TIME: Afternoon shift must be within 12:30-16:30 on 30-minute grid',
  'Off-30-minute Afternoon value is rejected'
);

select lives_ok(
  $$
    select public.update_staff_shift_time(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
      '07:00'::time,
      '11:00'::time,
      'Legacy pair retained without time change'
    )
  $$,
  'Unchanged grandfathered Morning pair may persist'
);

select throws_ok(
  $$
    select public.update_staff_shift_time(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
      '07:00'::time,
      '11:30'::time
    )
  $$,
  'INVALID_MORNING_TIME: Morning shift must be within 07:30-11:30 on 30-minute grid',
  'Changed legacy Morning value is rejected'
);

select lives_ok(
  $$
    select public.update_staff_shift_time(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
      '07:30'::time,
      '11:30'::time,
      'Canonicalized legacy shift'
    )
  $$,
  'Canonical Morning edit succeeds'
);

rollback;
