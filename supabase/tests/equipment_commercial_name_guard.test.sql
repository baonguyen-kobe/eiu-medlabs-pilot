begin;
select plan(24);

create temp table commercial_name_guard_ctx (
  admin_id uuid,
  lecturer_1_id uuid,
  lecturer_2_id uuid,
  skills_course_id uuid,
  skills_room_id uuid,
  skills_schedule_a_id uuid,
  skills_schedule_b_id uuid,
  skills_schedule_c_id uuid,
  skills_schedule_d_id uuid,
  skills_catalog_x_id uuid,
  skills_catalog_y_id uuid,
  basic_catalog_x_id uuid,
  basic_catalog_y_id uuid,
  basic_registration_id uuid,
  basic_session_a_id uuid,
  basic_session_b_id uuid,
  basic_session_c_id uuid,
  basic_schedule_a_id uuid,
  basic_schedule_b_id uuid,
  basic_schedule_c_id uuid,
  skills_request_id uuid,
  basic_request_id uuid
);

do $$
declare
  ctx commercial_name_guard_ctx%rowtype;
  skills_type_id uuid;
  basic_type_id uuid;
  basic_course_id uuid;
  basic_room_id uuid;
begin
  ctx.admin_id := gen_random_uuid();
  ctx.lecturer_1_id := gen_random_uuid();
  ctx.lecturer_2_id := gen_random_uuid();

  select id into skills_type_id from public.room_types where code = 'nursing_skills';
  select id into basic_type_id from public.room_types where code = 'basic_medical';

  insert into auth.users (id, email) values
    (ctx.admin_id, 'commercial-guard-admin-' || substr(ctx.admin_id::text, 1, 8) || '@eiu.edu.vn'),
    (ctx.lecturer_1_id, 'commercial-guard-l1-' || substr(ctx.lecturer_1_id::text, 1, 8) || '@eiu.edu.vn'),
    (ctx.lecturer_2_id, 'commercial-guard-l2-' || substr(ctx.lecturer_2_id::text, 1, 8) || '@eiu.edu.vn');

  insert into public.profiles (id, email, full_name, phone, is_active, title, allow_basic_medical_access)
  values
    (ctx.admin_id, 'commercial-guard-admin-' || substr(ctx.admin_id::text, 1, 8) || '@eiu.edu.vn', 'Commercial guard Admin', '0901234567', true, 'Admin', true),
    (ctx.lecturer_1_id, 'commercial-guard-l1-' || substr(ctx.lecturer_1_id::text, 1, 8) || '@eiu.edu.vn', 'Lê Hồng Liêm', '0901234568', true, 'Lecturer', true),
    (ctx.lecturer_2_id, 'commercial-guard-l2-' || substr(ctx.lecturer_2_id::text, 1, 8) || '@eiu.edu.vn', 'Hà Thị Kim Phụng', '0901234569', true, 'Lecturer', true)
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    phone = excluded.phone,
    is_active = excluded.is_active,
    title = excluded.title,
    allow_basic_medical_access = excluded.allow_basic_medical_access;

  insert into public.user_roles (user_id, role) values
    (ctx.admin_id, 'admin'), (ctx.lecturer_1_id, 'lecturer'), (ctx.lecturer_2_id, 'lecturer');
  insert into public.profile_room_types (profile_id, room_type_id) values
    (ctx.lecturer_1_id, skills_type_id), (ctx.lecturer_2_id, skills_type_id),
    (ctx.lecturer_1_id, basic_type_id), (ctx.lecturer_2_id, basic_type_id)
  on conflict do nothing;

  insert into public.courses (course_code, course_name, room_type_id, is_active)
  values ('CG-SK-' || substr(ctx.admin_id::text, 1, 8), 'Commercial guard Skills', skills_type_id, true)
  returning id into ctx.skills_course_id;
  insert into public.rooms (room_code, building_code, room_name, room_type_id, capacity, is_active)
  values ('CGSK' || substr(ctx.admin_id::text, 1, 4), 'CG', 'Commercial guard Skills room', skills_type_id, 40, true)
  returning id into ctx.skills_room_id;
  insert into public.courses (course_code, course_name, room_type_id, is_active)
  values ('CG-BM-' || substr(ctx.admin_id::text, 1, 8), 'Commercial guard Basic Medical', basic_type_id, true)
  returning id into basic_course_id;
  insert into public.rooms (room_code, building_code, room_name, room_type_id, capacity, is_active)
  values ('CGBM' || substr(ctx.admin_id::text, 1, 4), 'CG', 'Commercial guard Basic Medical room', basic_type_id, 40, true)
  returning id into basic_room_id;

  insert into public.equipment_catalog (item_name, commercial_name, unit, is_active)
  values ('Skills guard X ' || ctx.admin_id::text, 'Máy X ' || ctx.admin_id::text, 'cái', true)
  returning id into ctx.skills_catalog_x_id;
  insert into public.equipment_catalog (item_name, commercial_name, unit, is_active)
  values ('Skills guard Y ' || ctx.admin_id::text, 'Máy Y ' || ctx.admin_id::text, 'cái', true)
  returning id into ctx.skills_catalog_y_id;
  insert into public.basic_medical_equipment_catalog (item_name, commercial_name, unit, is_active)
  values ('Basic guard X ' || ctx.admin_id::text, 'Thiết bị X ' || ctx.admin_id::text, 'cái', true)
  returning id into ctx.basic_catalog_x_id;
  insert into public.basic_medical_equipment_catalog (item_name, commercial_name, unit, is_active)
  values ('Basic guard Y ' || ctx.admin_id::text, 'Thiết bị Y ' || ctx.admin_id::text, 'cái', true)
  returning id into ctx.basic_catalog_y_id;

  insert into public.class_schedules (course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id, schedule_date, start_time, end_time, source, schedule_status, student_count, created_by, published_by, published_at, semester)
  values (ctx.skills_course_id, 'CG-SK', 'Commercial guard Skills', ctx.skills_room_id, ctx.lecturer_1_id, current_date + 20, '09:00', '11:00', 'manual', 'published', 20, ctx.admin_id, ctx.admin_id, now(), 'HK1')
  returning id into ctx.skills_schedule_a_id;
  insert into public.class_schedules (course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id, schedule_date, start_time, end_time, source, schedule_status, student_count, created_by, published_by, published_at, semester)
  values (ctx.skills_course_id, 'CG-SK', 'Commercial guard Skills', ctx.skills_room_id, ctx.lecturer_1_id, current_date + 21, '09:00', '11:00', 'manual', 'published', 20, ctx.admin_id, ctx.admin_id, now(), 'HK1')
  returning id into ctx.skills_schedule_b_id;
  insert into public.class_schedules (course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id, schedule_date, start_time, end_time, source, schedule_status, student_count, created_by, published_by, published_at, semester)
  values (ctx.skills_course_id, 'CG-SK', 'Commercial guard Skills', ctx.skills_room_id, ctx.lecturer_1_id, current_date + 22, '09:00', '11:00', 'manual', 'published', 20, ctx.admin_id, ctx.admin_id, now(), 'HK1')
  returning id into ctx.skills_schedule_c_id;
  insert into public.class_schedules (course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id, schedule_date, start_time, end_time, source, schedule_status, student_count, created_by, published_by, published_at, semester)
  values (ctx.skills_course_id, 'CG-SK', 'Commercial guard Skills', ctx.skills_room_id, ctx.lecturer_1_id, current_date + 23, '09:00', '11:00', 'manual', 'published', 20, ctx.admin_id, ctx.admin_id, now(), 'HK1')
  returning id into ctx.skills_schedule_d_id;

  insert into commercial_name_guard_ctx select (ctx).*;

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', ctx.admin_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', ctx.admin_id, 'role', 'authenticated')::text, true);
  update commercial_name_guard_ctx set basic_registration_id = public.save_basic_medical_registration(
    null, '2099-2100', 'HK1', current_date + 24, current_date + 26, basic_course_id, basic_room_id, 20, ctx.lecturer_1_id, 'commercial guard',
    jsonb_build_array(
      jsonb_build_object('schedule_date', current_date + 24, 'start_time', '09:00', 'end_time', '11:00', 'lesson_title', 'TNTH A', 'teaching_lecturer_id', ctx.lecturer_1_id),
      jsonb_build_object('schedule_date', current_date + 25, 'start_time', '09:00', 'end_time', '11:00', 'lesson_title', 'TNTH B', 'teaching_lecturer_id', ctx.lecturer_1_id),
      jsonb_build_object('schedule_date', current_date + 26, 'start_time', '09:00', 'end_time', '11:00', 'lesson_title', 'TNTH C', 'teaching_lecturer_id', ctx.lecturer_1_id)
    )
  );
  update commercial_name_guard_ctx context_row set
    basic_session_a_id = (select id from public.basic_medical_registration_sessions where registration_id = context_row.basic_registration_id and session_number = 1),
    basic_session_b_id = (select id from public.basic_medical_registration_sessions where registration_id = context_row.basic_registration_id and session_number = 2),
    basic_session_c_id = (select id from public.basic_medical_registration_sessions where registration_id = context_row.basic_registration_id and session_number = 3),
    basic_schedule_a_id = (select class_schedule_id from public.basic_medical_registration_sessions where registration_id = context_row.basic_registration_id and session_number = 1),
    basic_schedule_b_id = (select class_schedule_id from public.basic_medical_registration_sessions where registration_id = context_row.basic_registration_id and session_number = 2),
    basic_schedule_c_id = (select class_schedule_id from public.basic_medical_registration_sessions where registration_id = context_row.basic_registration_id and session_number = 3);
end;
$$;

-- The catalog identity itself rejects alternate case and surrounding whitespace.
select throws_ok(
  $$ insert into public.equipment_catalog (item_name, commercial_name, unit, is_active) select 'case', lower(commercial_name), 'cái', true from public.equipment_catalog where id = (select skills_catalog_x_id from commercial_name_guard_ctx) $$,
  '23505', null, 'Skills catalog rejects a case-only commercial-name duplicate'
);
select throws_ok(
  $$ insert into public.equipment_catalog (item_name, commercial_name, unit, is_active) select 'space', '  ' || commercial_name || '  ', 'cái', true from public.equipment_catalog where id = (select skills_catalog_x_id from commercial_name_guard_ctx) $$,
  '23505', null, 'Skills catalog rejects a whitespace-only commercial-name duplicate'
);
select throws_ok(
  $$ insert into public.basic_medical_equipment_catalog (item_name, commercial_name, unit, is_active) select 'case', lower(commercial_name), 'cái', true from public.basic_medical_equipment_catalog where id = (select basic_catalog_x_id from commercial_name_guard_ctx) $$,
  '23505', null, 'Basic Medical catalog rejects a case-only commercial-name duplicate'
);
select throws_ok(
  $$ insert into public.basic_medical_equipment_catalog (item_name, commercial_name, unit, is_active) select 'space', '  ' || commercial_name || '  ', 'cái', true from public.basic_medical_equipment_catalog where id = (select basic_catalog_x_id from commercial_name_guard_ctx) $$,
  '23505', null, 'Basic Medical catalog rejects a whitespace-only commercial-name duplicate'
);

select throws_ok(
  $$ select public.create_equipment_request_with_items((select skills_schedule_a_id from commercial_name_guard_ctx), 'HK1', (select lecturer_1_id from commercial_name_guard_ctx), ((current_date + 20)::text || ' 09:00 Asia/Ho_Chi_Minh')::timestamptz, ((current_date + 20)::text || ' 11:00 Asia/Ho_Chi_Minh')::timestamptz, null, null, jsonb_build_array(jsonb_build_object('skill_name', 'Activity A', 'catalog_item_id', (select skills_catalog_x_id from commercial_name_guard_ctx), 'quantity', 1), jsonb_build_object('skill_name', 'Activity A', 'catalog_item_id', (select skills_catalog_x_id from commercial_name_guard_ctx), 'quantity', 2))) $$,
  '22023', 'EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY', 'Skills create rejects the same commercial name in the same activity'
);
select lives_ok(
  $$ update commercial_name_guard_ctx set skills_request_id = public.create_equipment_request_with_items(skills_schedule_b_id, 'HK1', lecturer_1_id, ((current_date + 21)::text || ' 09:00 Asia/Ho_Chi_Minh')::timestamptz, ((current_date + 21)::text || ' 11:00 Asia/Ho_Chi_Minh')::timestamptz, null, null, jsonb_build_array(jsonb_build_object('skill_name', 'Activity A', 'catalog_item_id', skills_catalog_x_id, 'quantity', 1), jsonb_build_object('skill_name', 'Activity A', 'catalog_item_id', skills_catalog_y_id, 'quantity', 1))) $$,
  'Skills create accepts different commercial names in one activity'
);
select lives_ok(
  $$ select public.create_equipment_request_with_items((select skills_schedule_c_id from commercial_name_guard_ctx), 'HK1', (select lecturer_1_id from commercial_name_guard_ctx), ((current_date + 22)::text || ' 09:00 Asia/Ho_Chi_Minh')::timestamptz, ((current_date + 22)::text || ' 11:00 Asia/Ho_Chi_Minh')::timestamptz, null, null, jsonb_build_array(jsonb_build_object('skill_name', 'Activity A', 'catalog_item_id', (select skills_catalog_x_id from commercial_name_guard_ctx), 'quantity', 1), jsonb_build_object('skill_name', 'Activity B', 'catalog_item_id', (select skills_catalog_x_id from commercial_name_guard_ctx), 'quantity', 1))) $$,
  'Skills create accepts the same commercial name in different activities'
);
select lives_ok(
  $$ select public.update_equipment_request_content(
    r.id,r.class_schedule_id,r.semester,r.responsible_lecturer_id,r.receive_at,r.return_at,r.note,r.late_registration_reason,
    (select jsonb_agg(jsonb_build_object('id',i.id,'catalog_item_id',i.catalog_item_id,'skill_name',i.skill_name,'quantity',case when i.catalog_item_id=ctx.skills_catalog_x_id then 2 else i.quantity end,'note',i.note,'expected_revision',r.preparation_revision)) from public.equipment_request_items i where i.request_id=r.id and i.removed_at is null))
    from public.equipment_requests r join commercial_name_guard_ctx ctx on r.id=ctx.skills_request_id $$,
  'Skills self-row update is not treated as a duplicate'
);
select throws_ok(
  $$ select public.update_equipment_request_content((select skills_request_id from commercial_name_guard_ctx), (select skills_schedule_b_id from commercial_name_guard_ctx), 'HK1', (select lecturer_1_id from commercial_name_guard_ctx), ((current_date + 21)::text || ' 09:00 Asia/Ho_Chi_Minh')::timestamptz, ((current_date + 21)::text || ' 11:00 Asia/Ho_Chi_Minh')::timestamptz, null, null, jsonb_build_array(jsonb_build_object('id',(select id from public.equipment_request_items where request_id=(select skills_request_id from commercial_name_guard_ctx) and catalog_item_id=(select skills_catalog_x_id from commercial_name_guard_ctx) and removed_at is null),'expected_revision',(select preparation_revision from public.equipment_requests where id=(select skills_request_id from commercial_name_guard_ctx)),'skill_name', 'Activity A', 'catalog_item_id', (select skills_catalog_x_id from commercial_name_guard_ctx), 'quantity', 1), jsonb_build_object('expected_revision',(select preparation_revision from public.equipment_requests where id=(select skills_request_id from commercial_name_guard_ctx)),'skill_name', 'Activity A', 'catalog_item_id', (select skills_catalog_x_id from commercial_name_guard_ctx), 'quantity', 2))) $$,
  '22023', 'EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY', 'Skills edit rejects a second duplicate row'
);
select throws_ok(
  $$ select public.add_equipment_request_item((select skills_request_id from commercial_name_guard_ctx), 'Activity A', (select skills_catalog_x_id from commercial_name_guard_ctx), 1, null) $$,
  '22023', 'EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY', 'Skills manager add-item path enforces the commercial-name guard'
);

select throws_ok(
  $$ select public.create_equipment_request_with_items((select basic_schedule_a_id from commercial_name_guard_ctx), 'HK1', null, ((current_date + 24)::text || ' 09:00 Asia/Ho_Chi_Minh')::timestamptz, ((current_date + 24)::text || ' 11:00 Asia/Ho_Chi_Minh')::timestamptz, null, null, jsonb_build_array(jsonb_build_object('skill_name', 'ignored', 'catalog_item_id', (select basic_catalog_x_id from commercial_name_guard_ctx), 'quantity', 1), jsonb_build_object('skill_name', 'ignored', 'catalog_item_id', (select basic_catalog_x_id from commercial_name_guard_ctx), 'quantity', 2))) $$,
  '22023', 'EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY', 'Basic Medical create rejects the same commercial name in its immutable source activity'
);
select lives_ok(
  $$ update commercial_name_guard_ctx set basic_request_id = public.create_equipment_request_with_items(basic_schedule_b_id, 'HK1', null, ((current_date + 25)::text || ' 09:00 Asia/Ho_Chi_Minh')::timestamptz, ((current_date + 25)::text || ' 11:00 Asia/Ho_Chi_Minh')::timestamptz, null, null, jsonb_build_array(jsonb_build_object('skill_name', 'ignored', 'catalog_item_id', basic_catalog_x_id, 'quantity', 1), jsonb_build_object('skill_name', 'ignored', 'catalog_item_id', basic_catalog_y_id, 'quantity', 1))) $$,
  'Basic Medical create accepts different commercial names in one immutable source activity'
);
select is(
  (select source_identity_id from public.equipment_requests where id = (select basic_request_id from commercial_name_guard_ctx)),
  (select basic_session_b_id from commercial_name_guard_ctx),
  'Basic Medical request persists source_identity_id as its immutable activity/session identity'
);
select lives_ok(
  $$ select public.create_equipment_request_with_items((select basic_schedule_c_id from commercial_name_guard_ctx), 'HK1', null, ((current_date + 26)::text || ' 09:00 Asia/Ho_Chi_Minh')::timestamptz, ((current_date + 26)::text || ' 11:00 Asia/Ho_Chi_Minh')::timestamptz, null, null, jsonb_build_array(jsonb_build_object('skill_name', 'ignored', 'catalog_item_id', (select basic_catalog_x_id from commercial_name_guard_ctx), 'quantity', 1))) $$,
  'Basic Medical permits the same commercial name for a distinct source session/request boundary'
);
select lives_ok(
  $$ update public.equipment_request_items set quantity = 2 where request_id = (select basic_request_id from commercial_name_guard_ctx) and basic_medical_catalog_item_id = (select basic_catalog_x_id from commercial_name_guard_ctx) $$,
  'Basic Medical self-row update is not treated as a duplicate'
);
select throws_ok(
  $$ select public.update_basic_medical_equipment_request_content((select basic_request_id from commercial_name_guard_ctx), ((current_date + 25)::text || ' 09:00 Asia/Ho_Chi_Minh')::timestamptz, ((current_date + 25)::text || ' 11:00 Asia/Ho_Chi_Minh')::timestamptz, null, null, jsonb_build_array(jsonb_build_object('id',(select id from public.equipment_request_items where request_id=(select basic_request_id from commercial_name_guard_ctx) and basic_medical_catalog_item_id=(select basic_catalog_x_id from commercial_name_guard_ctx) and removed_at is null),'expected_revision',(select preparation_revision from public.equipment_requests where id=(select basic_request_id from commercial_name_guard_ctx)),'catalog_item_id', (select basic_catalog_x_id from commercial_name_guard_ctx), 'quantity', 1), jsonb_build_object('expected_revision',(select preparation_revision from public.equipment_requests where id=(select basic_request_id from commercial_name_guard_ctx)),'catalog_item_id', (select basic_catalog_x_id from commercial_name_guard_ctx), 'quantity', 2))) $$,
  '22023', 'EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY', 'Basic Medical edit rejects a second duplicate row'
);

select lives_ok(
  $$ select public.assign_class_lecturers((select skills_schedule_d_id from commercial_name_guard_ctx), array[(select lecturer_1_id from commercial_name_guard_ctx), (select lecturer_2_id from commercial_name_guard_ctx)]) $$,
  'Lecturer slots accept Lecturer 1 followed by Lecturer 2'
);
select ok(
  (select array[lecturer_id, lecturer_2_id] from public.class_schedules where id = (select skills_schedule_d_id from commercial_name_guard_ctx))
    = array[(select lecturer_1_id from commercial_name_guard_ctx), (select lecturer_2_id from commercial_name_guard_ctx)],
  'Lecturer slots persist Lê Hồng Liêm before Hà Thị Kim Phụng'
);
select lives_ok(
  $$ select public.update_skills_lab_class_schedule((select skills_schedule_d_id from commercial_name_guard_ctx), current_date + 40, '09:00', '11:00', (select skills_course_id from commercial_name_guard_ctx), (select skills_room_id from commercial_name_guard_ctx), 20, array[(select lecturer_1_id from commercial_name_guard_ctx), (select lecturer_2_id from commercial_name_guard_ctx)]) $$,
  'Skills schedule update preserves the first explicit lecturer slot in its outbox path'
);
select is(
  (select payload->>'lecturer' from public.email_outbox_events where aggregate_id = (select skills_schedule_d_id from commercial_name_guard_ctx) and event_type = 'class_schedule_rescheduled'),
  'Lê Hồng Liêm · Hà Thị Kim Phụng',
  'Skills schedule outbox displays Lecturer 1 before Lecturer 2'
);
select lives_ok(
  $$ select public.assign_class_lecturers((select skills_schedule_d_id from commercial_name_guard_ctx), array[(select lecturer_2_id from commercial_name_guard_ctx), (select lecturer_1_id from commercial_name_guard_ctx)]) $$,
  'Lecturer slots accept reversed explicit input'
);
select ok(
  (select array[lecturer_id, lecturer_2_id] from public.class_schedules where id = (select skills_schedule_d_id from commercial_name_guard_ctx))
    = array[(select lecturer_2_id from commercial_name_guard_ctx), (select lecturer_1_id from commercial_name_guard_ctx)],
  'Lecturer slots persist Hà Thị Kim Phụng before Lê Hồng Liêm without alphabetical sorting'
);
select lives_ok(
  $$ select public.update_skills_lab_class_schedule((select skills_schedule_a_id from commercial_name_guard_ctx), current_date + 41, '09:00', '11:00', (select skills_course_id from commercial_name_guard_ctx), (select skills_room_id from commercial_name_guard_ctx), 20, array[(select lecturer_2_id from commercial_name_guard_ctx), (select lecturer_1_id from commercial_name_guard_ctx)]) $$,
  'Skills schedule update accepts reversed explicit lecturer slots in its outbox path'
);
select is(
  (select payload->>'lecturer' from public.email_outbox_events where aggregate_id = (select skills_schedule_a_id from commercial_name_guard_ctx) and event_type = 'class_schedule_rescheduled'),
  'Hà Thị Kim Phụng · Lê Hồng Liêm',
  'Skills schedule outbox preserves reversed input slots without alphabetical sorting'
);

select * from finish();
rollback;
