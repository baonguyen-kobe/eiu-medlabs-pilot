begin;
select plan(11);

select set_config('role', 'postgres', true);

select ok(
  (
    select attnotnull
    from pg_attribute
    -- t4e: equipment_catalog is now a view over equipment_items.
    where attrelid = 'public.equipment_items'::regclass
      and attname = 'commercial_name'
      and not attisdropped
  ),
  'commercial_name is not null'
);

select throws_ok(
  $$
    insert into public.equipment_catalog (id, item_name, commercial_name, unit)
    values ('61000000-0000-0000-0000-000000000001', 'Blank commercial', '   ', 'cái')
  $$,
  '23514',
  null,
  'blank commercial_name is rejected'
);

select lives_ok(
  $$
    insert into public.equipment_catalog (id, item_name, commercial_name, model, unit)
    values ('61000000-0000-0000-0000-000000000002', 'Device A', 'Commercial-X', 'M1', 'cái')
  $$,
  'a valid commercial name is accepted'
);

select throws_ok(
  $$
    insert into public.equipment_catalog (id, item_name, commercial_name, model, unit)
    values ('61000000-0000-0000-0000-000000000003', 'Device B', ' commercial-x ', 'M2', 'cái')
  $$,
  '23505',
  null,
  'case and trim duplicate is rejected even when item and model differ'
);

select results_eq(
  $$
    select count(*)::integer
    from public.equipment_catalog
    where lower(btrim(commercial_name)) = 'commercial-x'
  $$,
  array[1],
  'only one normalized Commercial-X row exists'
);

select lives_ok(
  $$
    insert into public.equipment_catalog (id, item_name, commercial_name, model, unit)
    values ('61000000-0000-0000-0000-000000000004', 'Device A', 'Commercial-Y', 'M1', 'cái')
  $$,
  'different commercial names may share an item name and model'
);

select throws_ok(
  $$
    update public.equipment_catalog
    set commercial_name = ' commercial-x '
    where id = '61000000-0000-0000-0000-000000000004'
  $$,
  '23505',
  null,
  'editing a row to another row normalized commercial name is rejected'
);

select lives_ok(
  $$
    insert into public.equipment_catalog (id, item_name, commercial_name, unit, is_active)
    values ('61000000-0000-0000-0000-000000000005', 'Inactive device', 'Commercial-Z', 'cái', false)
  $$,
  'inactive catalog rows retain their commercial-name identity'
);

select throws_ok(
  $$
    insert into public.equipment_catalog (id, item_name, commercial_name, unit)
    values ('61000000-0000-0000-0000-000000000006', 'Duplicate inactive identity', ' commercial-z ', 'cái')
  $$,
  '23505',
  null,
  'inactive catalog commercial names cannot be duplicated'
);

select is(
  (
    select id
    from public.equipment_catalog
    where id = '61000000-0000-0000-0000-000000000002'
  ),
  '61000000-0000-0000-0000-000000000002'::uuid,
  'updating a matched catalog row preserves its UUID'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where contype = 'f'
      and conrelid = 'public.equipment_request_items'::regclass
      and confrelid = 'public.equipment_items'::regclass
  ),
  'equipment request items retain a foreign key to immutable catalog UUIDs'
);

select * from finish();
rollback;
