-- S2 Physical Operations & Surplus Immutability Tests (pgTAP)
-- The fixture and all attempted changes roll back with this test transaction.
begin;
select plan(6);

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values (
  'e0000000-0000-0000-0000-000000000010',
  'inventory-s2-immutability@campus.local',
  '{"full_name":"Synthetic S2 Immutability"}',
  '{"preapproved":true}'
);

insert into public.profiles (id, email, full_name, is_active)
values (
  'e0000000-0000-0000-0000-000000000010',
  'inventory-s2-immutability@campus.local',
  'Synthetic S2 Immutability',
  true
)
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  is_active = excluded.is_active;

-- 1. S2 Operation Enum check rejects invalid operation
select throws_ok(
  $$ insert into public.inventory_transactions (
       id, operation, business_key, actor_id, occurred_at
     ) values (
       'e0000000-0000-0000-0000-000000000021', 'BOGUS_OPERATION',
       'PGTAP-S2-INVALID', 'e0000000-0000-0000-0000-000000000010', now()
     ); $$,
  '23514', null, 'Invalid transaction operation rejected by check constraint'
);

-- Setup dummy transaction
insert into public.inventory_transactions (
  id, operation, business_key, actor_id, occurred_at
) values (
  'e0000000-0000-0000-0000-000000000020', 'TRANSFER',
  'PGTAP-S2-TRANSFER', 'e0000000-0000-0000-0000-000000000010', now()
);

-- 2. Immutability of inventory_transactions
select throws_ok(
  $$ update public.inventory_transactions set reason = 'tampered'
     where id = 'e0000000-0000-0000-0000-000000000020'; $$,
  '42501', null, 'TRANSFER transaction refuses privileged UPDATE'
);

-- Setup dummy items & location for surplus fixture
insert into public.inventory_categories (id, code, name, active)
values ('e0000000-0000-0000-0000-000000000030', 'CAT-S2-TEST', 'Cat S2 Test', true);

insert into public.inventory_uoms (code, name, dimension, allowed_scale, active)
values ('uom_s2_test', 'S2 Count', 'count', 0, true);

insert into public.inventory_catalog_items (
  id, code, name, category_id, material_kind, base_uom_code, tracking_strategy, return_semantics, expiry_required, active
) values (
  'e0000000-0000-0000-0000-000000000031', 'ITEM-S2-TEST', 'Item S2 Test',
  'e0000000-0000-0000-0000-000000000030', 'other', 'uom_s2_test', 'quantity', 'nonreturnable', false, true
);

insert into public.inventory_storage_locations (id, code, name, active)
values ('e0000000-0000-0000-0000-000000000032', 'LOC-S2-TEST', 'Loc S2 Test', true);

insert into public.inventory_stocktake_surplus_records (
  id, surplus_reference, transaction_id, catalog_item_id, initial_location_id,
  initial_condition, initial_quantity, counted_by_id, counted_at, reason, evidence_note, status
) values (
  'e0000000-0000-0000-0000-000000000040', 'SURPLUS-TEST-001',
  'e0000000-0000-0000-0000-000000000020', 'e0000000-0000-0000-0000-000000000031',
  'e0000000-0000-0000-0000-000000000032', 'good', 5,
  'e0000000-0000-0000-0000-000000000010', now(), 'Count surplus', 'Evidence note', 'held'
);

-- 3. Surplus record refuses DELETE
select throws_ok(
  $$ delete from public.inventory_stocktake_surplus_records
     where id = 'e0000000-0000-0000-0000-000000000040'; $$,
  '42501', null, 'Surplus record refuses DELETE'
);

-- 4. Surplus record initial intake fields refuse UPDATE
select throws_ok(
  $$ update public.inventory_stocktake_surplus_records set initial_quantity = 100
     where id = 'e0000000-0000-0000-0000-000000000040'; $$,
  '42501', null, 'Surplus record initial fields refuse UPDATE'
);

-- Create origin & hold fixture
insert into public.inventory_stock_origins (
  id, surplus_id, line_key, provenance_group, catalog_item_id
) values (
  'e0000000-0000-0000-0000-000000000041', 'e0000000-0000-0000-0000-000000000040',
  'LINE-1', 'STOCKTAKE_SURPLUS', 'e0000000-0000-0000-0000-000000000031'
);

insert into public.inventory_stock_holds (
  origin_id, status, hold_reason, placed_by_id
) values (
  'e0000000-0000-0000-0000-000000000041', 'active', 'TEST_HOLD',
  'e0000000-0000-0000-0000-000000000010'
);

-- 5. Hold record refuses DELETE
select throws_ok(
  $$ delete from public.inventory_stock_holds
     where origin_id = 'e0000000-0000-0000-0000-000000000041'; $$,
  '42501', null, 'Hold record refuses DELETE'
);

-- Create evidence log fixture
insert into public.inventory_stock_evidence (
  id, origin_id, actor_id, action, note
) values (
  'e0000000-0000-0000-0000-000000000050',
  'e0000000-0000-0000-0000-000000000041',
  'e0000000-0000-0000-0000-000000000010',
  'EVIDENCE_LOGGED', 'Testing immutability'
);

-- 6. Evidence record refuses UPDATE and DELETE
select throws_ok(
  $$ update public.inventory_stock_evidence set note = 'tampered'
     where id = 'e0000000-0000-0000-0000-000000000050'; $$,
  '42501', null, 'Stock evidence refuses UPDATE'
);

select * from finish();
rollback;
