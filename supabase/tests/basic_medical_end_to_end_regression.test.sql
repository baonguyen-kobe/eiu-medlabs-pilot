begin;

select plan(36);

create temp table y08_context (
  manager_id uuid,
  lecturer_id uuid,
  course_id uuid,
  room_id uuid,
  registration_id uuid,
  main_schedule_id uuid,
  main_session_id uuid,
  stale_registration_id uuid,
  stale_schedule_id uuid,
  stale_session_id uuid,
  future_schedule_id uuid,
  future_session_id uuid,
  eligible_catalog_id uuid,
  inactive_catalog_id uuid,
  inactive_allocation_catalog_id uuid,
  eligible_inventory_id uuid,
  inactive_catalog_inventory_id uuid,
  inactive_inventory_id uuid
);

grant select on table y08_context to authenticated;

do $$
declare
  basic_medical_room_type_id uuid;
begin
  select id into strict basic_medical_room_type_id
  from public.room_types
  where code = 'basic_medical';

  insert into auth.users (id, email) values
    ('98000000-0000-4000-8000-000000000001', 'y08-manager@example.test'),
    ('98000000-0000-4000-8000-000000000002', 'y08-lecturer@example.test');

  insert into public.profiles (id, email, full_name, is_active) values
    ('98000000-0000-4000-8000-000000000001', 'y08-manager@example.test', 'Y08 Manager', true),
    ('98000000-0000-4000-8000-000000000002', 'y08-lecturer@example.test', 'Y08 Teaching Lecturer', true)
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    is_active = excluded.is_active;

  insert into public.user_roles (user_id, role) values
    ('98000000-0000-4000-8000-000000000001', 'admin'),
    ('98000000-0000-4000-8000-000000000002', 'lecturer');

  insert into public.profile_room_types (profile_id, room_type_id) values
    ('98000000-0000-4000-8000-000000000002', basic_medical_room_type_id)
  on conflict do nothing;

  insert into public.courses (
    id, course_code, course_name, room_type_id, is_active
  ) values (
    '98000000-0000-4000-8000-000000000003', 'Y08-E2E',
    'Y08 Basic Medical end-to-end', basic_medical_room_type_id, true
  );

  insert into public.rooms (
    id, room_code, building_code, room_name, room_type_id, capacity, is_active
  ) values (
    '98000000-0000-4000-8000-000000000004', 'Y08-R', 'Y08-B',
    'Y08 Integration Room', basic_medical_room_type_id, 30, true
  );

  insert into public.basic_medical_equipment_catalog (
    id, item_name, commercial_name, unit, is_active
  ) values
    ('98000000-0000-4000-8000-000000000010', 'Y08 Eligible Item', 'Y08 Eligible', 'piece', true),
    ('98000000-0000-4000-8000-000000000011', 'Y08 Deactivated Item', 'Y08 Deactivated', 'piece', true),
    ('98000000-0000-4000-8000-000000000012', 'Y08 Inactive Allocation Item', 'Y08 Inactive Allocation', 'piece', true);

  insert into public.basic_medical_room_inventory (
    id, room_id, catalog_item_id, total_quantity, good_quantity,
    damaged_quantity, is_active
  ) values
    ('98000000-0000-4000-8000-000000000020', '98000000-0000-4000-8000-000000000004', '98000000-0000-4000-8000-000000000010', 10, 8, 2, true),
    ('98000000-0000-4000-8000-000000000021', '98000000-0000-4000-8000-000000000004', '98000000-0000-4000-8000-000000000011', 4, 4, 0, true),
    ('98000000-0000-4000-8000-000000000022', '98000000-0000-4000-8000-000000000004', '98000000-0000-4000-8000-000000000012', 3, 3, 0, false);

  -- Y-01: catalog lifecycle is independent from allocation lifecycle.
  update public.basic_medical_equipment_catalog
  set is_active = false
  where id = '98000000-0000-4000-8000-000000000011';

  insert into public.basic_medical_registrations (
    id, academic_year, semester, start_date, end_date, course_id, room_id,
    student_count, registrant_id, responsible_lecturer_id, created_by
  ) values
    (
      '98000000-0000-4000-8000-000000000030', '2042-2043', 'HK1',
      current_date - 1, current_date + 10,
      '98000000-0000-4000-8000-000000000003',
      '98000000-0000-4000-8000-000000000004', 20,
      '98000000-0000-4000-8000-000000000002',
      '98000000-0000-4000-8000-000000000002',
      '98000000-0000-4000-8000-000000000001'
    ),
    (
      '98000000-0000-4000-8000-000000000031', '2042-2043', 'HK1',
      current_date - 2, current_date - 2,
      '98000000-0000-4000-8000-000000000003',
      '98000000-0000-4000-8000-000000000004', 20,
      '98000000-0000-4000-8000-000000000002',
      '98000000-0000-4000-8000-000000000002',
      '98000000-0000-4000-8000-000000000001'
    ),
    -- Filed by the coordinator on the lecturer's behalf.
    (
      '98000000-0000-4000-8000-000000000032', '2042-2043', 'HK1',
      current_date + 20, current_date + 20,
      '98000000-0000-4000-8000-000000000003',
      '98000000-0000-4000-8000-000000000004', 20,
      '98000000-0000-4000-8000-000000000001',
      '98000000-0000-4000-8000-000000000002',
      '98000000-0000-4000-8000-000000000001'
    );

  perform set_config('app.basic_medical_registration_mutation', 'true', true);

  insert into public.class_schedules (
    id, course_id, course_code_snapshot, course_name_snapshot, room_id,
    lecturer_id, schedule_date, start_time, end_time, source,
    basic_medical_registration_id, schedule_status, student_count,
    created_by, published_by, published_at
  ) values
    (
      '98000000-0000-4000-8000-000000000040',
      '98000000-0000-4000-8000-000000000003', 'Y08-E2E',
      'Y08 Basic Medical end-to-end', '98000000-0000-4000-8000-000000000004',
      '98000000-0000-4000-8000-000000000002', current_date - 1,
      time '08:00', time '10:00', 'manual',
      '98000000-0000-4000-8000-000000000030', 'published', 20,
      '98000000-0000-4000-8000-000000000001',
      '98000000-0000-4000-8000-000000000001', clock_timestamp()
    ),
    (
      '98000000-0000-4000-8000-000000000041',
      '98000000-0000-4000-8000-000000000003', 'Y08-E2E-STALE',
      'Y08 stale snapshot', '98000000-0000-4000-8000-000000000004',
      '98000000-0000-4000-8000-000000000002', current_date - 2,
      time '08:00', time '10:00', 'manual',
      '98000000-0000-4000-8000-000000000031', 'published', 20,
      '98000000-0000-4000-8000-000000000001',
      '98000000-0000-4000-8000-000000000001', clock_timestamp()
    );

  insert into public.basic_medical_registration_sessions (
    id, registration_id, class_schedule_id, lesson_title,
    teaching_lecturer_id, session_number
  ) values
    (
      '98000000-0000-4000-8000-000000000050',
      '98000000-0000-4000-8000-000000000030',
      '98000000-0000-4000-8000-000000000040', 'Y08 confirmed session',
      '98000000-0000-4000-8000-000000000002', 1
    ),
    (
      '98000000-0000-4000-8000-000000000051',
      '98000000-0000-4000-8000-000000000031',
      '98000000-0000-4000-8000-000000000041', 'Y08 stale session',
      '98000000-0000-4000-8000-000000000002', 1
    );

  insert into y08_context values (
    '98000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000002',
    '98000000-0000-4000-8000-000000000003',
    '98000000-0000-4000-8000-000000000004',
    '98000000-0000-4000-8000-000000000030',
    '98000000-0000-4000-8000-000000000040',
    '98000000-0000-4000-8000-000000000050',
    '98000000-0000-4000-8000-000000000031',
    '98000000-0000-4000-8000-000000000041',
    '98000000-0000-4000-8000-000000000051',
    '98000000-0000-4000-8000-000000000042',
    '98000000-0000-4000-8000-000000000052',
    '98000000-0000-4000-8000-000000000010',
    '98000000-0000-4000-8000-000000000011',
    '98000000-0000-4000-8000-000000000012',
    '98000000-0000-4000-8000-000000000020',
    '98000000-0000-4000-8000-000000000021',
    '98000000-0000-4000-8000-000000000022'
  );
end;
$$;

select ok(
  (select is_active from public.basic_medical_room_inventory
   where id = (select inactive_catalog_inventory_id from y08_context)),
  'Y-01 catalog deactivation preserves its active room allocation'
);

select set_config('role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select lecturer_id from y08_context))::text,
  true
);

select is(
  (select count(*)::integer from public.basic_medical_registration_list
   where id = (select registration_id from y08_context)),
  1,
  'teaching lecturer can open the scoped registration chain'
);

select is(
  (select responsible_name is not null and registrant_name is not null
   from public.basic_medical_registration_list
   where id = '98000000-0000-4000-8000-000000000032'),
  true,
  'responsible lecturer lists a registration filed by someone else, with both names'
);

select is(
  (
    select count(*)::integer
    from public.basic_medical_room_inventory inventory
    join public.basic_medical_equipment_catalog catalog
      on catalog.id = inventory.catalog_item_id
    where inventory.room_id = (select room_id from y08_context)
      and inventory.is_active and catalog.is_active
  ),
  1,
  'Y-01 canonical eligibility contains only active catalog plus active allocation'
);

select is(
  (
    select jsonb_build_object(
      'id', inventory.id,
      'total', inventory.total_quantity,
      'good', inventory.good_quantity,
      'damaged', inventory.damaged_quantity
    )
    from public.basic_medical_room_inventory inventory
    join public.basic_medical_equipment_catalog catalog
      on catalog.id = inventory.catalog_item_id
    where inventory.room_id = (select room_id from y08_context)
      and inventory.is_active and catalog.is_active
  ),
  jsonb_build_object(
    'id', (select eligible_inventory_id from y08_context),
    'total', 10, 'good', 8, 'damaged', 2
  ),
  'confirmation view starts with the exact Good and Damaged values'
);

select is(
  (
    select count(*)::integer
    from public.basic_medical_room_inventory inventory
    join public.basic_medical_equipment_catalog catalog
      on catalog.id = inventory.catalog_item_id
    where inventory.id = (select inactive_catalog_inventory_id from y08_context)
      and inventory.is_active and catalog.is_active
  ),
  0,
  'inactive-catalog allocation is excluded from confirmation'
);

select is(
  (
    select count(*)::integer
    from public.basic_medical_room_inventory inventory
    join public.basic_medical_equipment_catalog catalog
      on catalog.id = inventory.catalog_item_id
    where inventory.id = (select inactive_inventory_id from y08_context)
      and inventory.is_active and catalog.is_active
  ),
  0,
  'inactive allocation is excluded regardless of active catalog state'
);

select is(
  (select is_completed from public.basic_medical_registration_completion
   where registration_id = (select registration_id from y08_context)),
  false,
  'registration is incomplete before its session confirmation'
);

select lives_ok(
  format(
    $sql$select public.confirm_basic_medical_session(%L::uuid, %L, %L::jsonb)$sql$,
    (select main_session_id from y08_context),
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    jsonb_build_array(jsonb_build_object(
      'inventory_id', (select eligible_inventory_id from y08_context),
      'newly_damaged_quantity', 3,
      'expected_catalog_item_id', (select eligible_catalog_id from y08_context),
      'expected_total_quantity', 10,
      'expected_good_quantity', 8,
      'expected_damaged_quantity', 2,
      'expected_item_name', 'Y08 Eligible Item',
      'expected_commercial_name', 'Y08 Eligible',
      'expected_unit', 'piece'
    ))::text
  ),
  'teaching lecturer signs and commits the exact displayed equipment set'
);

select set_config('role', 'postgres', true);

select is(
  (
    select count(*)::integer
    from public.basic_medical_session_confirmations
    where session_id = (select main_session_id from y08_context)
      and invalidated_at is null
      and signer_id = (select lecturer_id from y08_context)
  ),
  1,
  'confirmation commits as the active session status record'
);

select is(
  (
    select count(*)::integer
    from public.basic_medical_session_equipment_checks checks
    join public.basic_medical_session_confirmations confirmations
      on confirmations.id = checks.confirmation_id
    where confirmations.session_id = (select main_session_id from y08_context)
  ),
  1,
  'confirmation snapshots only the one canonically eligible allocation'
);

select is(
  (
    select jsonb_build_object(
      'item', checks.item_name_snapshot,
      'commercial', checks.commercial_name_snapshot,
      'unit', checks.unit_snapshot,
      'total_before', checks.total_before,
      'good_before', checks.good_before,
      'damaged_before', checks.damaged_before,
      'new_damage', checks.newly_damaged_quantity,
      'good_after', checks.good_after,
      'damaged_after', checks.damaged_after
    )
    from public.basic_medical_session_equipment_checks checks
    join public.basic_medical_session_confirmations confirmations
      on confirmations.id = checks.confirmation_id
    where confirmations.session_id = (select main_session_id from y08_context)
  ),
  jsonb_build_object(
    'item', 'Y08 Eligible Item', 'commercial', 'Y08 Eligible', 'unit', 'piece',
    'total_before', 10, 'good_before', 8, 'damaged_before', 2,
    'new_damage', 3, 'good_after', 5, 'damaged_after', 5
  ),
  'equipment check preserves the exact before, damage delta, and after snapshot'
);

select is(
  (
    select jsonb_build_object(
      'total', total_quantity, 'good', good_quantity, 'damaged', damaged_quantity,
      'reporter', last_damage_reporter_id,
      'reported', last_damage_reported_at is not null
    )
    from public.basic_medical_room_inventory
    where id = (select eligible_inventory_id from y08_context)
  ),
  jsonb_build_object(
    'total', 10, 'good', 5, 'damaged', 5,
    'reporter', (select lecturer_id from y08_context), 'reported', true
  ),
  'room inventory atomically moves three units from Good to Damaged'
);

select is(
  (
    select jsonb_build_object(
      'event', event_type, 'total_before', total_before,
      'good_before', good_before, 'damaged_before', damaged_before,
      'total_after', total_after, 'good_after', good_after,
      'damaged_after', damaged_after, 'delta', quantity_delta,
      'actor', actor_id
    )
    from public.basic_medical_equipment_condition_logs
    where inventory_id = (select eligible_inventory_id from y08_context)
      and event_type = 'damage_report'
  ),
  jsonb_build_object(
    'event', 'damage_report', 'total_before', 10,
    'good_before', 8, 'damaged_before', 2,
    'total_after', 10, 'good_after', 5, 'damaged_after', 5,
    'delta', 3, 'actor', (select lecturer_id from y08_context)
  ),
  'condition log records the exact confirmation damage transition'
);

select is(
  (
    select count(*)::integer
    from public.email_outbox_events
    where domain = 'basic_medical_damage'
      and event_key = 'basic_medical:damage:' || (
        select id::text
        from public.basic_medical_session_confirmations
        where session_id = (select main_session_id from y08_context)
      )
  ),
  1,
  'damage confirmation enqueues exactly one transactional notification event'
);

select is(
  (select is_completed from public.basic_medical_registration_completion
   where registration_id = (select registration_id from y08_context)),
  true,
  'registration becomes completed when its only session has an active confirmation'
);

select set_config('role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select lecturer_id from y08_context))::text,
  true
);

select is(
  public.get_basic_medical_confirmation_evidence(
    (select id from public.basic_medical_session_confirmations
     where session_id = (select main_session_id from y08_context))
  )->>'signature_data',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'confirmation evidence returns the exact committed signature'
);

select is(
  public.get_basic_medical_confirmation_evidence(
    (select id from public.basic_medical_session_confirmations
     where session_id = (select main_session_id from y08_context))
  ) #> '{equipment_checks,0}',
  jsonb_build_object(
    'inventory_id', (select eligible_inventory_id from y08_context),
    'item_name_snapshot', 'Y08 Eligible Item',
    'commercial_name_snapshot', 'Y08 Eligible',
    'unit_snapshot', 'piece',
    'total_before', 10, 'good_before', 8, 'damaged_before', 2,
    'newly_damaged_quantity', 3,
    'total_after', 10, 'good_after', 5, 'damaged_after', 5
  ),
  'confirmation evidence view returns the complete immutable equipment snapshot'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select manager_id from y08_context))::text,
  true
);

select is(
  (
    select row_data->>'id'
    from public.search_basic_medical_equipment(
      'damaged', null, (select room_id from y08_context), null,
      null, null, null, null, null, 1, 50
    )
    where row_data->>'id' = (select eligible_inventory_id::text from y08_context)
  ),
  (select eligible_inventory_id::text from y08_context),
  'Damaged tab data source exposes the newly damaged allocation'
);

select is(
  (
    select row_data - array[
      'id','room_id','catalog_item_id','is_active','last_damage_reported_at',
      'room','catalog','last_damage_reporter'
    ]
    from public.search_basic_medical_equipment(
      'damaged', null, (select room_id from y08_context), null,
      null, null, null, null, null, 1, 50
    )
    where row_data->>'id' = (select eligible_inventory_id::text from y08_context)
  ),
  jsonb_build_object('total_quantity', 10, 'good_quantity', 5, 'damaged_quantity', 5),
  'Damaged tab data source reflects the updated Good and Damaged values'
);

select is(
  (
    select count(*)::integer
    from public.search_basic_medical_equipment(
      'logs', null, (select room_id from y08_context),
      (select eligible_catalog_id from y08_context), 'damage_report',
      (select lecturer_id from y08_context), null, null, null, 1, 50
    )
  ),
  1,
  'Log tab data source exposes exactly one matching damage report'
);

select is(
  (
    select row_data - array['id','note','created_at','inventory','actor']
    from public.search_basic_medical_equipment(
      'logs', null, (select room_id from y08_context),
      (select eligible_catalog_id from y08_context), 'damage_report',
      (select lecturer_id from y08_context), null, null, null, 1, 50
    )
  ),
  jsonb_build_object(
    'event_type', 'damage_report', 'total_before', 10,
    'good_before', 8, 'damaged_before', 2,
    'total_after', 10, 'good_after', 5, 'damaged_after', 5,
    'quantity_delta', 3
  ),
  'Log tab data source returns the exact before and after transition'
);

select set_config('role', 'postgres', true);

select is(
  private.is_basic_medical_schedule_start_after(
    current_date + 1, time '08:00', current_date + time '08:00'
  ),
  true,
  'Y-05 future schedule boundary is strictly after the captured business time'
);

select is(
  private.is_basic_medical_schedule_start_after(
    current_date, time '08:00', current_date + time '08:00'
  ),
  false,
  'Y-05 exact-start schedule is not classified as future'
);

select is(
  private.is_basic_medical_schedule_start_after(
    current_date, time '08:00', current_date + time '09:00'
  ),
  false,
  'Y-05 already-started schedule is not classified as future'
);

select set_config('role', 'postgres', true);
select set_config('app.basic_medical_registration_mutation', 'true', true);

insert into public.class_schedules (
  id, course_id, course_code_snapshot, course_name_snapshot, room_id,
  lecturer_id, schedule_date, start_time, end_time, source,
  basic_medical_registration_id, schedule_status, student_count,
  created_by, published_by, published_at
)
select future_schedule_id, course_id, 'Y08-E2E-FUTURE', 'Y08 future cancellation',
       room_id, lecturer_id, current_date + 10, time '08:00', time '10:00',
       'manual', registration_id, 'published', 20, manager_id, manager_id,
       clock_timestamp()
from y08_context;

insert into public.basic_medical_registration_sessions (
  id, registration_id, class_schedule_id, lesson_title,
  teaching_lecturer_id, session_number
)
select future_session_id, registration_id, future_schedule_id,
       'Y08 future cancelled session', lecturer_id, 2
from y08_context;

select set_config('role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select manager_id from y08_context))::text,
  true
);

select lives_ok(
  format(
    $sql$select public.cancel_basic_medical_registration(%L::uuid, 'Y08 cancellation guard')$sql$,
    (select registration_id from y08_context)
  ),
  'manager cancellation RPC completes for the mixed historical and future chain'
);

select set_config('role', 'postgres', true);

select is(
  (select schedule_status::text from public.class_schedules
   where id = (select future_schedule_id from y08_context)),
  'cancelled',
  'cancellation transitions the strictly future session schedule'
);

select is(
  (select schedule_status::text from public.class_schedules
   where id = (select main_schedule_id from y08_context)),
  'published',
  'cancellation preserves the already-started confirmed session schedule'
);

select is(
  (
    select count(*)::integer
    from public.basic_medical_session_confirmations
    where session_id = (select main_session_id from y08_context)
      and invalidated_at is null
  ),
  1,
  'cancellation preserves confirmation evidence for the historical session'
);

select ok(
  (select cancelled_at is not null and cancel_reason = 'Y08 cancellation guard'
   from public.basic_medical_registrations
   where id = (select registration_id from y08_context)),
  'registration records its cancellation state and reason'
);

select set_config('role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select lecturer_id from y08_context))::text,
  true
);

select throws_ok(
  format(
    $sql$select public.confirm_basic_medical_session(%L::uuid, %L, %L::jsonb)$sql$,
    (select future_session_id from y08_context),
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    jsonb_build_array(jsonb_build_object(
      'inventory_id', (select eligible_inventory_id from y08_context),
      'newly_damaged_quantity', 0,
      'expected_catalog_item_id', (select eligible_catalog_id from y08_context),
      'expected_total_quantity', 10,
      'expected_good_quantity', 5,
      'expected_damaged_quantity', 5,
      'expected_item_name', 'Y08 Eligible Item',
      'expected_commercial_name', 'Y08 Eligible',
      'expected_unit', 'piece'
    ))::text
  ),
  'P0002',
  null,
  'Y-05 cancelled session cannot be submitted for confirmation'
);

select throws_ok(
  format(
    $sql$select public.confirm_basic_medical_session(%L::uuid, %L, %L::jsonb)$sql$,
    (select stale_session_id from y08_context),
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    jsonb_build_array(jsonb_build_object(
      'inventory_id', (select eligible_inventory_id from y08_context),
      'newly_damaged_quantity', 0,
      'expected_catalog_item_id', (select eligible_catalog_id from y08_context),
      'expected_total_quantity', 10,
      'expected_good_quantity', 8,
      'expected_damaged_quantity', 2,
      'expected_item_name', 'Y08 Eligible Item',
      'expected_commercial_name', 'Y08 Eligible',
      'expected_unit', 'piece'
    ))::text
  ),
  '40001',
  null,
  'Y-05 stale displayed inventory snapshot is rejected atomically'
);

select set_config('role', 'postgres', true);

select is(
  (select count(*)::integer from public.basic_medical_session_confirmations
   where session_id = (select stale_session_id from y08_context)),
  0,
  'stale snapshot rejection creates no confirmation'
);

select is(
  (
    select jsonb_build_object('good', good_quantity, 'damaged', damaged_quantity)
    from public.basic_medical_room_inventory
    where id = (select eligible_inventory_id from y08_context)
  ),
  jsonb_build_object('good', 5, 'damaged', 5),
  'cancelled and stale submissions leave inventory unchanged'
);

select is(
  (select count(*)::integer from public.basic_medical_equipment_condition_logs
   where inventory_id = (select eligible_inventory_id from y08_context)),
  1,
  'cancelled and stale submissions create no extra condition logs'
);

select is(
  (select count(*)::integer from public.basic_medical_session_equipment_checks
   where confirmation_id in (
     select id from public.basic_medical_session_confirmations
     where session_id = (select main_session_id from y08_context)
   )),
  1,
  'historical equipment evidence survives cancellation and rejected retries'
);

select * from finish();
rollback;
