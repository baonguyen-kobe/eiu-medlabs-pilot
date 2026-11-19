begin;

select plan(13);

-- t4r3 B/C: an Admin moves a Basic Medical room row into the shared ledger,
-- and a lecturer's newly damaged count then posts good -> damaged there.
do $$
declare
  bm_type uuid;
begin
  select id into strict bm_type from public.room_types where code = 'basic_medical';

  insert into auth.users (id, email) values
    ('99100000-0000-4000-8000-000000000001', 'cutover-admin@example.test'),
    ('99100000-0000-4000-8000-000000000002', 'cutover-lecturer@example.test');
  insert into public.profiles (id, email, full_name, is_active) values
    ('99100000-0000-4000-8000-000000000001', 'cutover-admin@example.test', 'Cutover Admin', true),
    ('99100000-0000-4000-8000-000000000002', 'cutover-lecturer@example.test', 'Cutover Lecturer', true)
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name, is_active = excluded.is_active;
  insert into public.user_roles (user_id, role) values
    ('99100000-0000-4000-8000-000000000001', 'admin'),
    ('99100000-0000-4000-8000-000000000002', 'lecturer');
  insert into public.profile_room_types (profile_id, room_type_id) values
    ('99100000-0000-4000-8000-000000000002', bm_type)
  on conflict do nothing;

  insert into public.courses (id, course_code, course_name, room_type_id, is_active) values
    ('99100000-0000-4000-8000-000000000003', 'CUT-BM', 'Cutover Basic Medical', bm_type, true);
  insert into public.rooms (id, room_code, building_code, room_name, room_type_id, capacity, is_active) values
    ('99100000-0000-4000-8000-000000000004', 'CUT-R', 'CUT', 'Cutover room', bm_type, 30, true);

  insert into public.basic_medical_equipment_catalog (id, item_name, commercial_name, unit, is_active) values
    ('99100000-0000-4000-8000-000000000010', 'Cutover stethoscope', 'Cutover stetho', 'piece', true);
  insert into public.basic_medical_room_inventory (id, room_id, catalog_item_id, total_quantity, good_quantity, damaged_quantity, is_active) values
    ('99100000-0000-4000-8000-000000000020', '99100000-0000-4000-8000-000000000004', '99100000-0000-4000-8000-000000000010', 10, 8, 2, true);

  insert into public.inventory_categories (id, code, name) values
    ('99100000-0000-4000-8000-000000000060', 'CUT-CAT', 'Cutover category');
  insert into public.inventory_uoms (code, name, dimension, allowed_scale) values
    ('cut_piece', 'Cutover piece', 'count', 0);
  insert into public.inventory_catalog_items (id, code, name, category_id, material_kind, base_uom_code, tracking_strategy, return_semantics, expiry_required) values
    ('99100000-0000-4000-8000-000000000061', 'CUT-ITEM', 'Cutover stethoscope SKU', '99100000-0000-4000-8000-000000000060', 'other', 'cut_piece', 'quantity', 'returnable', false);

  insert into public.basic_medical_registrations (id, academic_year, semester, start_date, end_date, course_id, room_id, student_count, registrant_id, responsible_lecturer_id, created_by) values
    ('99100000-0000-4000-8000-000000000030', '2042-2043', 'HK1', current_date - 1, current_date + 10,
     '99100000-0000-4000-8000-000000000003', '99100000-0000-4000-8000-000000000004', 20,
     '99100000-0000-4000-8000-000000000002', '99100000-0000-4000-8000-000000000002', '99100000-0000-4000-8000-000000000001');
  perform set_config('app.basic_medical_registration_mutation', 'true', true);
  insert into public.class_schedules (id, course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id, schedule_date, start_time, end_time, source, basic_medical_registration_id, schedule_status, student_count, created_by, published_by, published_at) values
    ('99100000-0000-4000-8000-000000000040', '99100000-0000-4000-8000-000000000003', 'CUT-BM', 'Cutover Basic Medical',
     '99100000-0000-4000-8000-000000000004', '99100000-0000-4000-8000-000000000002', current_date - 1, time '08:00', time '10:00', 'manual',
     '99100000-0000-4000-8000-000000000030', 'published', 20, '99100000-0000-4000-8000-000000000001', '99100000-0000-4000-8000-000000000001', clock_timestamp());
  insert into public.basic_medical_registration_sessions (id, registration_id, class_schedule_id, lesson_title, teaching_lecturer_id, session_number) values
    ('99100000-0000-4000-8000-000000000050', '99100000-0000-4000-8000-000000000030', '99100000-0000-4000-8000-000000000040', 'Cutover session', '99100000-0000-4000-8000-000000000002', 1);
end;
$$;

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', json_build_object('sub', '99100000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);

select lives_ok($$select public.map_basic_medical_inventory_item(
  '99100000-0000-4000-8000-000000000010', '99100000-0000-4000-8000-000000000061', '1', 'Cutover test')$$,
  'Admin maps the Basic Medical item to an inventory SKU');
select is((public.basic_medical_cutover_apply('Cutover test') ->> 'moved')::integer, 1,
  'Admin moves the ready row with one real opening and no P1 scope');
select is((public.basic_medical_cutover_preview() ->> 'ready')::integer, 0,
  'a moved row leaves the preview');
select is((public.basic_medical_cutover_apply('Cutover again') ->> 'moved')::integer, 0,
  'moving again posts nothing');

select set_config('role', 'postgres', true);
select is((select row(good, damaged)::text from private.basic_medical_ledger_counts('99100000-0000-4000-8000-000000000020')),
  '(8,2)', 'the ledger holds the room counts at the room location');
select throws_ok($$update public.basic_medical_room_inventory set good_quantity = 7 where id = '99100000-0000-4000-8000-000000000020'$$,
  '42501', 'BASIC_MEDICAL_ROOM_INVENTORY_CUT_OVER', 'a moved row cannot be edited by hand');

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', json_build_object('sub', '99100000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
-- Kho finds one more damaged item before the session is signed (review 2026-11-19).
select lives_ok($$select public.inventory_command('change_stock_condition', jsonb_build_object(
  'location_id', (select loc.id from public.inventory_storage_locations loc
    join public.basic_medical_room_inventory inv on inv.room_id = loc.room_id and loc.is_room_root
    where inv.id = '99100000-0000-4000-8000-000000000020'),
  'reason', 'Kho phát hiện thêm một món hư',
  'lines', jsonb_build_array(jsonb_build_object(
    'origin_id', c.origin_id, 'expected_version', f.version, 'expected_stock_revision', c.revision,
    'from_condition', 'good', 'to_condition', 'damaged', 'quantity', '1'))), gen_random_uuid())
  from public.inventory_receipt_cohorts c
  join public.inventory_stock_origins o on o.id = c.origin_id
  join public.inventory_stock_facts f on f.id = c.current_fact_id
  where o.catalog_item_id = '99100000-0000-4000-8000-000000000061'$$,
  'Kho moves one moved item from good to damaged');
select is((select row(good_quantity, damaged_quantity, total_quantity)::text from public.basic_medical_room_inventory where id = '99100000-0000-4000-8000-000000000020'),
  '(7,3,10)', 'the room row follows the ledger right away, before any session is signed');

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '99100000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', json_build_object('sub', '99100000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
select throws_like($$select public.inventory_command('change_stock_condition',
  jsonb_build_object('location_id', gen_random_uuid(), 'reason', 'x', 'lines', '[]'::jsonb), gen_random_uuid())$$,
  'AUTH_DENIED%', 'a lecturer cannot post a condition change directly');
select lives_ok(format(
  $sql$select public.confirm_basic_medical_session(%L::uuid, %L, %L::jsonb)$sql$,
  '99100000-0000-4000-8000-000000000050',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  jsonb_build_array(jsonb_build_object(
    'inventory_id', '99100000-0000-4000-8000-000000000020', 'newly_damaged_quantity', 3,
    'expected_catalog_item_id', '99100000-0000-4000-8000-000000000010',
    'expected_total_quantity', 10, 'expected_good_quantity', 7, 'expected_damaged_quantity', 3,
    'expected_item_name', 'Cutover stethoscope', 'expected_commercial_name', 'Cutover stetho',
    'expected_unit', 'piece'))::text),
  'the lecturer confirms against the counts the sign screen showed (7 good, 3 damaged)');

select set_config('role', 'postgres', true);
select is((select row(good, damaged)::text from private.basic_medical_ledger_counts('99100000-0000-4000-8000-000000000020')),
  '(4,6)', 'the damage moved 3 from good to damaged in the ledger');
select is((select row(good_quantity, damaged_quantity, total_quantity)::text from public.basic_medical_room_inventory where id = '99100000-0000-4000-8000-000000000020'),
  '(4,6,10)', 'the room row mirrors the ledger');
select ok(exists(select 1 from public.inventory_transactions
  where operation = 'CONDITION_CHANGE' and actor_id = '99100000-0000-4000-8000-000000000002'),
  'the condition change is recorded as the lecturer');

select * from finish();
rollback;
