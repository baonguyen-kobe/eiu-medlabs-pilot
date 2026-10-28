begin;
select plan(23);

create temp table bm_equipment_blocker_ctx (
  admin_id uuid, bm_staff_id uuid, skills_staff_id uuid, lecturer_id uuid,
  override_lecturer_id uuid, blocked_lecturer_id uuid, course_id uuid, room_id uuid,
  skills_course_id uuid, skills_room_id uuid, bm_catalog_id uuid, skills_catalog_id uuid,
  registration_id uuid, session_a_id uuid, session_b_id uuid, session_c_id uuid,
  schedule_a_id uuid, schedule_b_id uuid, schedule_c_id uuid, request_a_id uuid,
  request_c_id uuid, source_a_id uuid, skills_schedule_id uuid, skills_request_id uuid
);
grant select, update on bm_equipment_blocker_ctx to authenticated;

do $$
declare
  ctx bm_equipment_blocker_ctx%rowtype;
  bm_type uuid;
  skills_type uuid;
begin
  ctx.admin_id := gen_random_uuid(); ctx.bm_staff_id := gen_random_uuid(); ctx.skills_staff_id := gen_random_uuid();
  ctx.lecturer_id := gen_random_uuid(); ctx.override_lecturer_id := gen_random_uuid(); ctx.blocked_lecturer_id := gen_random_uuid();
  select id into bm_type from public.room_types where code = 'basic_medical';
  select id into skills_type from public.room_types where code = 'nursing_skills';
  insert into auth.users (id, email) values
    (ctx.admin_id, 'wave1-blocker-admin@eiu.edu.vn'), (ctx.bm_staff_id, 'wave1-blocker-bm-staff@eiu.edu.vn'),
    (ctx.skills_staff_id, 'wave1-blocker-skills-staff@eiu.edu.vn'), (ctx.lecturer_id, 'wave1-blocker-lecturer@eiu.edu.vn'),
    (ctx.override_lecturer_id, 'wave1-blocker-override@eiu.edu.vn'), (ctx.blocked_lecturer_id, 'wave1-blocker-blocked@eiu.edu.vn');
  insert into public.profiles (id,email,full_name,is_active,title,allow_basic_medical_access) values
    (ctx.admin_id, 'wave1-blocker-admin@eiu.edu.vn', 'Wave Admin', true, 'Admin', false),
    (ctx.bm_staff_id, 'wave1-blocker-bm-staff@eiu.edu.vn', 'Wave BM Staff', true, 'Staff', false),
    (ctx.skills_staff_id, 'wave1-blocker-skills-staff@eiu.edu.vn', 'Wave Skills Staff', true, 'Staff', false),
    (ctx.lecturer_id, 'wave1-blocker-lecturer@eiu.edu.vn', 'Wave Lecturer', true, 'Lecturer', true),
    (ctx.override_lecturer_id, 'wave1-blocker-override@eiu.edu.vn', 'Wave Override Lecturer', true, 'Lecturer', true),
    (ctx.blocked_lecturer_id, 'wave1-blocker-blocked@eiu.edu.vn', 'Wave Blocked Lecturer', true, 'Lecturer', false)
  on conflict (id) do update set email=excluded.email, full_name=excluded.full_name, is_active=excluded.is_active, title=excluded.title, allow_basic_medical_access=excluded.allow_basic_medical_access;
  update public.profiles set phone = '0901234567' where id in (ctx.admin_id, ctx.bm_staff_id, ctx.skills_staff_id, ctx.lecturer_id, ctx.override_lecturer_id, ctx.blocked_lecturer_id);
  insert into public.user_roles (user_id,role) values
    (ctx.admin_id,'admin'), (ctx.bm_staff_id,'staff'), (ctx.skills_staff_id,'staff'),
    (ctx.lecturer_id,'lecturer'), (ctx.override_lecturer_id,'lecturer'), (ctx.blocked_lecturer_id,'lecturer')
  on conflict do nothing;
  insert into public.profile_room_types (profile_id,room_type_id) values
    (ctx.bm_staff_id,bm_type), (ctx.skills_staff_id,skills_type), (ctx.lecturer_id,bm_type), (ctx.lecturer_id,skills_type), (ctx.override_lecturer_id,bm_type)
  on conflict do nothing;
  insert into public.courses (course_code,course_name,room_type_id,is_active) values ('W1-BM-' || substr(ctx.admin_id::text,1,8), 'Wave Basic Medical', bm_type, true) returning id into ctx.course_id;
  insert into public.courses (course_code,course_name,room_type_id,is_active) values ('W1-SK-' || substr(ctx.admin_id::text,1,8), 'Wave Skills', skills_type, true) returning id into ctx.skills_course_id;
  insert into public.rooms (room_code,building_code,room_name,room_type_id,capacity,is_active) values ('W1BM' || substr(ctx.admin_id::text,1,4), 'W1', 'Wave BM room', bm_type, 40, true) returning id into ctx.room_id;
  insert into public.rooms (room_code,building_code,room_name,room_type_id,capacity,is_active) values ('W1SK' || substr(ctx.admin_id::text,1,4), 'W1', 'Wave Skills room', skills_type, 40, true) returning id into ctx.skills_room_id;
  insert into public.basic_medical_equipment_catalog (item_name,commercial_name,unit,is_active) values ('Wave BM item ' || ctx.admin_id::text, 'Wave BM commercial ' || ctx.admin_id::text, 'piece', true) returning id into ctx.bm_catalog_id;
  insert into public.equipment_catalog (item_name,commercial_name,unit,is_active) values ('Wave Skills item ' || ctx.admin_id::text, 'Wave skills', 'piece', true) returning id into ctx.skills_catalog_id;
  insert into public.class_schedules(course_id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,schedule_date,start_time,end_time,source,schedule_status,student_count,created_by,published_by,published_at,semester)
  values(ctx.skills_course_id,'W1-SK','Wave Skills',ctx.skills_room_id,ctx.lecturer_id,current_date+15,'09:00','11:00','manual','published',20,ctx.admin_id,ctx.admin_id,now(),'HK1') returning id into ctx.skills_schedule_id;
  insert into bm_equipment_blocker_ctx select (ctx).*;
end $$;

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', json_build_object('sub', (select admin_id from bm_equipment_blocker_ctx), 'role', 'authenticated')::text, true);

select lives_ok($$
  update bm_equipment_blocker_ctx set registration_id = public.save_basic_medical_registration(
    null, '2026-2027', 'HK1', current_date + 12, current_date + 14, course_id, room_id, 20, null, 'wave fixture',
    jsonb_build_array(
      jsonb_build_object('schedule_date', current_date + 12, 'start_time', '09:00', 'end_time', '11:00', 'lesson_title', 'A', 'teaching_lecturer_id', lecturer_id),
      jsonb_build_object('schedule_date', current_date + 13, 'start_time', '09:00', 'end_time', '11:00', 'lesson_title', 'B', 'teaching_lecturer_id', lecturer_id),
      jsonb_build_object('schedule_date', current_date + 14, 'start_time', '09:00', 'end_time', '11:00', 'lesson_title', 'C', 'teaching_lecturer_id', lecturer_id)
    )
  )
$$, 'Admin can create the Basic Medical source registration');

update bm_equipment_blocker_ctx ctx set
  session_a_id = (select id from public.basic_medical_registration_sessions where registration_id=ctx.registration_id and session_number=1),
  session_b_id = (select id from public.basic_medical_registration_sessions where registration_id=ctx.registration_id and session_number=2),
  session_c_id = (select id from public.basic_medical_registration_sessions where registration_id=ctx.registration_id and session_number=3),
  schedule_a_id = (select class_schedule_id from public.basic_medical_registration_sessions where registration_id=ctx.registration_id and session_number=1),
  schedule_b_id = (select class_schedule_id from public.basic_medical_registration_sessions where registration_id=ctx.registration_id and session_number=2),
  schedule_c_id = (select class_schedule_id from public.basic_medical_registration_sessions where registration_id=ctx.registration_id and session_number=3);

select lives_ok($$
  update bm_equipment_blocker_ctx set request_a_id = public.create_equipment_request_with_items(
    schedule_a_id, 'HK4', null,
    ((current_date + 12)::text || ' 09:00 Asia/Ho_Chi_Minh')::timestamptz,
    ((current_date + 12)::text || ' 11:00 Asia/Ho_Chi_Minh')::timestamptz,
    'BM request', null, jsonb_build_array(jsonb_build_object('skill_name','A','catalog_item_id',bm_catalog_id,'quantity',1))
  )
$$, 'Basic Medical equipment request commits through shared table triggers');

update bm_equipment_blocker_ctx set source_a_id = session_a_id;
select is((select semester from public.equipment_requests where id=(select request_a_id from bm_equipment_blocker_ctx)), 'HK1', 'Basic Medical request ignores forged semester and uses registration semester');
select ok(exists(select 1 from public.equipment_request_items where request_id=(select request_a_id from bm_equipment_blocker_ctx) and basic_medical_catalog_item_id=(select bm_catalog_id from bm_equipment_blocker_ctx)), 'Basic Medical active catalog is accepted');
select throws_ok($$insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,quantity) select request_a_id,'wrong',skills_catalog_id,1 from bm_equipment_blocker_ctx$$, '42501', null, 'Authenticated direct line INSERT remains denied');
-- Isolate the table-level domain invariant without weakening public grants.
reset role;
select throws_ok($$insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,quantity) select request_a_id,'wrong',skills_catalog_id,1 from bm_equipment_blocker_ctx$$, '22023', 'EQUIPMENT_REQUEST_BASIC_MEDICAL_CATALOG_REQUIRED', 'Skills catalog is rejected for Basic Medical');
set local role authenticated;
select is((select responsible_lecturer_id from public.equipment_requests where id=(select request_a_id from bm_equipment_blocker_ctx)), (select lecturer_id from bm_equipment_blocker_ctx), 'Basic Medical request defaults responsibility to its teaching lecturer');
select lives_ok($$
  update bm_equipment_blocker_ctx set skills_request_id = public.create_equipment_request_with_items(skills_schedule_id,'HK4',lecturer_id,((current_date+15)::text || ' 09:00 Asia/Ho_Chi_Minh')::timestamptz,((current_date+15)::text || ' 11:00 Asia/Ho_Chi_Minh')::timestamptz,'skills',null,jsonb_build_array(jsonb_build_object('skill_name','skills','catalog_item_id',skills_catalog_id,'quantity',1)))
$$, 'Skills request preserves the existing catalog lifecycle');
select throws_ok($$insert into public.equipment_request_items(request_id,skill_name,basic_medical_catalog_item_id,quantity) select skills_request_id,'wrong',bm_catalog_id,1 from bm_equipment_blocker_ctx$$, '42501', null, 'Authenticated direct Skills line INSERT remains denied');
reset role;
select throws_ok($$insert into public.equipment_request_items(request_id,skill_name,basic_medical_catalog_item_id,quantity) select skills_request_id,'wrong',bm_catalog_id,1 from bm_equipment_blocker_ctx$$, '22023', 'EQUIPMENT_REQUEST_SKILLS_CATALOG_REQUIRED', 'Basic Medical catalog is rejected for Skills');
set local role authenticated;

select set_config('request.jwt.claims', json_build_object('sub', (select bm_staff_id from bm_equipment_blocker_ctx), 'role', 'authenticated')::text, true);
select lives_ok($$
  update bm_equipment_blocker_ctx set request_c_id = public.create_equipment_request_with_items(
    schedule_c_id, 'HK4', override_lecturer_id,
    ((current_date + 14)::text || ' 09:00 Asia/Ho_Chi_Minh')::timestamptz,
    ((current_date + 14)::text || ' 11:00 Asia/Ho_Chi_Minh')::timestamptz,
    'BM override', null, jsonb_build_array(jsonb_build_object('skill_name','C','catalog_item_id',bm_catalog_id,'quantity',1))
  )
$$, 'BM-scoped Staff can choose a valid Basic Medical lecturer override');
select lives_ok($$select public.soft_cancel_equipment_request((select request_c_id from bm_equipment_blocker_ctx))$$, 'A Basic Medical request can be cancelled without deleting its source');
select throws_ok($$select public.create_equipment_request_with_items((select schedule_c_id from bm_equipment_blocker_ctx),'HK1',null,((current_date+14)::text || ' 09:00 Asia/Ho_Chi_Minh')::timestamptz,((current_date+14)::text || ' 11:00 Asia/Ho_Chi_Minh')::timestamptz,'duplicate',null,jsonb_build_array(jsonb_build_object('skill_name','C','catalog_item_id',(select bm_catalog_id from bm_equipment_blocker_ctx),'quantity',1)))$$, '23505', null, 'Cancelled request still reserves its immutable domain source');

select set_config('request.jwt.claims', json_build_object('sub', (select skills_staff_id from bm_equipment_blocker_ctx), 'role', 'authenticated')::text, true);
select throws_ok($$select public.manager_confirm_equipment_status((select request_a_id from bm_equipment_blocker_ctx), 'preparing')$$, '42501', 'EQUIPMENT_REQUEST_SCOPE_REQUIRED', 'Skills-scoped Staff cannot manage Basic Medical request');
select set_config('request.jwt.claims', json_build_object('sub', (select blocked_lecturer_id from bm_equipment_blocker_ctx), 'role', 'authenticated')::text, true);
select throws_ok($$select public.save_basic_medical_registration(null,'2026-2027','HK1',current_date+20,current_date+20,(select course_id from bm_equipment_blocker_ctx),(select room_id from bm_equipment_blocker_ctx),1,null,null,jsonb_build_array(jsonb_build_object('schedule_date',current_date+20,'start_time','09:00','end_time','11:00','lesson_title','blocked','teaching_lecturer_id',(select lecturer_id from bm_equipment_blocker_ctx))))$$, '42501', 'BASIC_MEDICAL_SAVE_FORBIDDEN', 'Lecturer without Basic Medical access and scope cannot save');

select set_config('request.jwt.claims', json_build_object('sub', (select admin_id from bm_equipment_blocker_ctx), 'role', 'authenticated')::text, true);
select lives_ok($$
  select public.save_basic_medical_registration(registration_id,'2026-2027','HK1',current_date+12,current_date+14,course_id,room_id,20,null,'reordered',
    jsonb_build_array(
      jsonb_build_object('session_id',session_b_id,'schedule_date',current_date+13,'start_time','09:00','end_time','11:00','lesson_title','B','teaching_lecturer_id',lecturer_id),
      jsonb_build_object('session_id',session_a_id,'schedule_date',current_date+12,'start_time','09:00','end_time','11:00','lesson_title','A','teaching_lecturer_id',lecturer_id),
      jsonb_build_object('session_id',session_c_id,'schedule_date',current_date+14,'start_time','09:00','end_time','11:00','lesson_title','C','teaching_lecturer_id',lecturer_id)
    )
  ) from bm_equipment_blocker_ctx
$$, 'Two-phase reconciliation accepts a three-session permutation');
select results_eq($$select session_number from public.basic_medical_registration_sessions where id=(select session_b_id from bm_equipment_blocker_ctx) union all select session_number from public.basic_medical_registration_sessions where id=(select session_a_id from bm_equipment_blocker_ctx)$$, array[1,2], 'Swap finishes B=1 and A=2 without a unique-key collision');
select ok((select class_schedule_id from public.basic_medical_registration_sessions where id=(select session_a_id from bm_equipment_blocker_ctx)) = (select schedule_a_id from bm_equipment_blocker_ctx) and (select class_schedule_id from public.basic_medical_registration_sessions where id=(select session_b_id from bm_equipment_blocker_ctx)) = (select schedule_b_id from bm_equipment_blocker_ctx), 'Reorder preserves session and linked schedule identities');

select throws_ok($$
  select public.save_basic_medical_registration(registration_id,'2026-2027','HK1',current_date+12,current_date+14,course_id,room_id,20,null,null,
    jsonb_build_array(jsonb_build_object('session_id',session_b_id,'schedule_date',current_date+13,'start_time','09:00','end_time','11:00','lesson_title','B','teaching_lecturer_id',lecturer_id),jsonb_build_object('session_id',session_c_id,'schedule_date',current_date+14,'start_time','09:00','end_time','11:00','lesson_title','C','teaching_lecturer_id',lecturer_id))) from bm_equipment_blocker_ctx
$$, '23503', 'BASIC_MEDICAL_SESSION_REMOVAL_BLOCKED_BY_ACTIVE_EQUIPMENT_REQUEST', 'Active request blocks physical source removal');
select lives_ok($$select public.cancel_basic_medical_session((select session_a_id from bm_equipment_blocker_ctx), 'cancel source while request is active')$$, 'Hủy buổi remains available while an active request exists');
select lives_ok($$select public.soft_cancel_equipment_request((select request_a_id from bm_equipment_blocker_ctx))$$, 'Basic Medical request can be soft-cancelled');
select lives_ok($$
  select public.save_basic_medical_registration(registration_id,'2026-2027','HK1',current_date+12,current_date+14,course_id,room_id,20,null,null,
    jsonb_build_array(jsonb_build_object('session_id',session_b_id,'schedule_date',current_date+13,'start_time','09:00','end_time','11:00','lesson_title','B','teaching_lecturer_id',lecturer_id),jsonb_build_object('session_id',session_c_id,'schedule_date',current_date+14,'start_time','09:00','end_time','11:00','lesson_title','C','teaching_lecturer_id',lecturer_id))) from bm_equipment_blocker_ctx
$$, 'Cancelled request permits controlled physical source removal');
select ok((select class_schedule_id is null and source_identity_id=source_a_id from public.equipment_requests join bm_equipment_blocker_ctx on id=request_a_id) and exists(select 1 from public.equipment_request_items where request_id=(select request_a_id from bm_equipment_blocker_ctx)), 'Cancelled request items and durable source identity survive tombstoning');

select * from finish();
rollback;
