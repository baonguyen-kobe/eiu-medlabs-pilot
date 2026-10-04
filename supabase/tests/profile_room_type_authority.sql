begin;
select plan(12);

create temp table scope_authority_actors as
select gen_random_uuid() as id, gen_random_uuid() as course_id,
  gen_random_uuid() as room_id, gen_random_uuid() as schedule_id,
  gen_random_uuid() as basic_room_id;
grant select on scope_authority_actors to authenticated;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select id, 'scope-authority-' || id || '@example.invalid',
  '{"provider":"email","preapproved":true,"synthetic":true}'::jsonb,
  '{"full_name":"Scope authority regression","role":"admin","room_type_ids":["40000000-0000-0000-0000-000000000001"]}'::jsonb
from scope_authority_actors;

select is(
  (select count(*)::integer from public.profile_room_types
   where profile_id in (select id from scope_authority_actors)),
  0,
  'new Auth profile receives no implicit room-type scope, including from user metadata'
);

select is(
  (select count(*)::integer from public.user_roles
   where user_id in (select id from scope_authority_actors)),
  0,
  'user metadata cannot grant an application role'
);

-- Explicit legacy membership must not authorize domain reads without a role.
insert into public.profile_room_types (profile_id, room_type_id)
select id, '40000000-0000-0000-0000-000000000001'::uuid
from scope_authority_actors;

insert into public.courses (id, course_code, course_name, room_type_id)
select course_id, 'SCOPE-' || course_id, 'Scope authority course',
  '40000000-0000-0000-0000-000000000001'::uuid
from scope_authority_actors;

insert into public.rooms (id, room_code, building_code, room_type_id)
select room_id, 'SCOPE-' || room_id, 'AUTH',
  '40000000-0000-0000-0000-000000000001'::uuid
from scope_authority_actors;

insert into public.rooms (id, room_code, building_code, room_type_id)
select basic_room_id, 'SCOPE-' || basic_room_id, 'AUTH',
  '40000000-0000-0000-0000-000000000002'::uuid
from scope_authority_actors;

insert into public.class_schedules (
  id, course_id, course_code_snapshot, course_name_snapshot, room_id,
  schedule_date, start_time, end_time, source, schedule_status,
  student_count, semester, created_by, published_by, published_at
)
select schedule_id, course_id, 'SCOPE-' || course_id, 'Scope authority course',
  room_id, '2049-01-15'::date, '09:00'::time, '11:00'::time,
  'manual'::public.schedule_source, 'published'::public.schedule_status,
  20, 'HK1', id, id, now()
from scope_authority_actors;

select set_config(
  'request.jwt.claims',
  (select jsonb_build_object('sub', id, 'role', 'authenticated')::text
   from scope_authority_actors),
  true
);
set local role authenticated;

select is(
  (select count(*)::integer from public.rooms
   where id = (select room_id from scope_authority_actors)),
  0,
  'active legacy Nursing member without an application role cannot read rooms'
);

select is(
  (select count(*)::integer from public.class_schedules
   where id = (select schedule_id from scope_authority_actors)),
  0,
  'active legacy Nursing member without an application role cannot read schedules'
);

reset role;

insert into public.user_roles (user_id, role)
select id, 'lecturer'::public.app_role from scope_authority_actors;
set local role authenticated;

select is(
  (select count(*)::integer from public.rooms
   where id in (select room_id from scope_authority_actors
                union all select basic_room_id from scope_authority_actors)),
  1,
  'a Nursing lecturer reads the assigned Nursing room, not the Basic room'
);
select is(
  (select count(*)::integer from public.class_schedules
   where id = (select schedule_id from scope_authority_actors)),
  1,
  'explicit role and Nursing scope authorize the Nursing schedule'
);

reset role;
delete from public.user_roles where user_id in (select id from scope_authority_actors);
set local role authenticated;

select is(
  array[
    (select count(*)::integer from public.rooms
     where id = (select room_id from scope_authority_actors)),
    (select count(*)::integer from public.class_schedules
     where id = (select schedule_id from scope_authority_actors))
  ],
  array[0, 0],
  'revoking the last role immediately removes domain reads with the same JWT claims'
);
select is(
  (select count(*)::integer from public.profile_room_types
   where profile_id = (select id from scope_authority_actors)),
  1,
  'role revocation does not delete the existing scope or self membership introspection'
);

reset role;
delete from public.profile_room_types
where profile_id in (select id from scope_authority_actors);
insert into public.profile_room_types (profile_id, room_type_id)
select id, '40000000-0000-0000-0000-000000000002'::uuid
from scope_authority_actors;
insert into public.user_roles (user_id, role)
select id, 'staff'::public.app_role from scope_authority_actors;
update public.profiles set full_name = 'Configured Basic-only staff'
where id in (select id from scope_authority_actors);
set local role authenticated;

select is(
  (select array_agg(room_type_id order by room_type_id) from public.profile_room_types
   where profile_id = (select id from scope_authority_actors)),
  array['40000000-0000-0000-0000-000000000002'::uuid],
  'explicit Basic-only scope survives profile update without Nursing enrollment'
);
select is(
  (select array_agg(room_type_id order by room_type_id) from public.rooms
   where id in (select room_id from scope_authority_actors
                union all select basic_room_id from scope_authority_actors)),
  array['40000000-0000-0000-0000-000000000002'::uuid],
  'Staff workspace override does not grant Nursing room access to Basic-only staff'
);

reset role;
delete from public.profile_room_types
where profile_id in (select id from scope_authority_actors);
update public.user_roles set role = 'admin'::public.app_role
where user_id in (select id from scope_authority_actors);
set local role authenticated;

select is(
  (select count(*)::integer from public.rooms
   where id in (select room_id from scope_authority_actors
                union all select basic_room_id from scope_authority_actors)),
  2,
  'active Admin retains all-room access without assigned scopes'
);

reset role;
update public.profiles set is_active = false
where id in (select id from scope_authority_actors);
set local role authenticated;

select is(
  (select count(*)::integer from public.rooms
   where id in (select room_id from scope_authority_actors
                union all select basic_room_id from scope_authority_actors)),
  0,
  'inactive profile cannot use the Admin override'
);

reset role;

select * from finish();
rollback;
