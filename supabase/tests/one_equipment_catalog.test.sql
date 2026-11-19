begin;

select plan(14);

-- t4e step 2: one equipment table with usage scopes; each side keeps its view.
do $$
begin
  insert into auth.users (id, email) values
    ('99200000-0000-4000-8000-000000000001', 'scope-admin@example.test'),
    ('99200000-0000-4000-8000-000000000002', 'scope-staff@example.test');
  insert into public.profiles (id, email, full_name, is_active) values
    ('99200000-0000-4000-8000-000000000001', 'scope-admin@example.test', 'Scope Admin', true),
    ('99200000-0000-4000-8000-000000000002', 'scope-staff@example.test', 'Scope Staff', true)
  on conflict (id) do update set email = excluded.email, is_active = excluded.is_active;
  insert into public.user_roles (user_id, role) values
    ('99200000-0000-4000-8000-000000000001', 'admin'),
    ('99200000-0000-4000-8000-000000000002', 'staff');
  insert into public.equipment_catalog (id, item_name, commercial_name, unit) values
    ('99200000-0000-4000-8000-000000000010', 'Scope gauze', 'Scope shared name', 'gói');
  insert into public.basic_medical_equipment_catalog (id, item_name, commercial_name, unit) values
    ('99200000-0000-4000-8000-000000000011', 'Scope gauze BM', 'Scope shared name', 'gói'),
    ('99200000-0000-4000-8000-000000000012', 'Scope mask', 'Scope mask only BM', 'cái');
end;
$$;

select is((select usage_scopes from public.equipment_items where id = '99200000-0000-4000-8000-000000000010'),
  '{nursing_skills}'::text[], 'a row added through the Skills view belongs to Skills lab');
select is((select usage_scopes from public.equipment_items where id = '99200000-0000-4000-8000-000000000011'),
  '{basic_medical}'::text[], 'a row added through the Basic Medical view belongs to Y cơ sở');
select is((select count(*)::integer from public.equipment_catalog where id = '99200000-0000-4000-8000-000000000011'),
  0, 'the Skills view hides Basic Medical-only rows');
select throws_ok($$insert into public.basic_medical_equipment_catalog (item_name, commercial_name, unit)
  values ('dup', ' scope SHARED name ', 'gói')$$, '23505', null,
  'commercial names stay unique within one side');

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '99200000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', json_build_object('sub', '99200000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
select throws_ok($$select public.set_equipment_item_scopes('99200000-0000-4000-8000-000000000010', '{nursing_skills,basic_medical}')$$,
  '42501', 'EQUIPMENT_SCOPE_ADMIN_ONLY', 'only an Admin ticks scopes');

select set_config('request.jwt.claim.sub', '99200000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', json_build_object('sub', '99200000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
select is((select jsonb_array_length(public.equipment_catalog_scope_duplicates())
  - jsonb_array_length(jsonb_path_query_array(public.equipment_catalog_scope_duplicates(),
      '$[*] ? (@.commercial_name != "Scope shared name")'))),
  1, 'the same name on both sides is listed for the Admin');
select is(public.set_equipment_item_scopes('99200000-0000-4000-8000-000000000012', '{basic_medical,nursing_skills}'),
  '{basic_medical,nursing_skills}'::text[], 'an Admin ticks both sides');
select is((select count(*)::integer from public.equipment_catalog where id = '99200000-0000-4000-8000-000000000012'),
  1, 'a ticked item appears on the Skills side too');
select throws_ok($$select public.set_equipment_item_scopes('99200000-0000-4000-8000-000000000011', '{basic_medical,nursing_skills}')$$,
  '23505', null, 'ticking a side that already has the same name is refused');

select set_config('role', 'postgres', true);
insert into public.basic_medical_room_inventory (room_id, catalog_item_id, total_quantity, good_quantity, damaged_quantity)
select r.id, '99200000-0000-4000-8000-000000000011', 1, 1, 0
from public.rooms r join public.room_types t on t.id = r.room_type_id where t.code = 'basic_medical' limit 1;
select set_config('role', 'authenticated', true);
select throws_ok($$select public.set_equipment_item_scopes('99200000-0000-4000-8000-000000000011', '{nursing_skills}')$$,
  '23503', 'EQUIPMENT_SCOPE_IN_USE', 'a side in use keeps its scope');
-- Scopes change only through the RPC (review 2026-11-19).
select throws_ok($$update public.equipment_catalog set usage_scopes = '{nursing_skills}' where id = '99200000-0000-4000-8000-000000000012'$$,
  '42501', 'EQUIPMENT_SCOPE_RPC_ONLY', 'an ordinary catalog edit cannot change scopes');
select throws_ok($$insert into public.equipment_catalog (item_name, commercial_name, unit, usage_scopes)
  values ('two sides', 'two sides', 'cái', '{nursing_skills,basic_medical}')$$,
  '42501', 'EQUIPMENT_SCOPE_RPC_ONLY', 'a new item belongs to exactly one side');
select lives_ok($$update public.equipment_catalog set model = 'M2' where id = '99200000-0000-4000-8000-000000000012'$$,
  'other columns still edit normally');
select set_config('role', 'postgres', true);
select is((select usage_scopes from public.equipment_items where id = '99200000-0000-4000-8000-000000000011'),
  '{basic_medical}'::text[], 'the item still belongs to Y cơ sở');

select * from finish();
rollback;
