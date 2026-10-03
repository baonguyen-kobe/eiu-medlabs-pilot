-- S3 Serialized Assets & Immutable History Integration Tests (pgTAP)
-- Canonical Reference: plans/S3_DESIGN_PACK.md
-- All fixtures and attempted changes roll back with this test transaction.
begin;
select plan(18);

-- 0. Fixtures Setup
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values (
  'e3000000-0000-0000-0000-000000000001',
  'inventory-s3-pgtap@campus.local',
  '{"full_name":"Synthetic S3 Test User"}',
  '{"preapproved":true}'
);

insert into public.profiles (id, email, full_name, is_active)
values (
  'e3000000-0000-0000-0000-000000000001',
  'inventory-s3-pgtap@campus.local',
  'Synthetic S3 Test User',
  true
)
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  is_active = excluded.is_active;

insert into public.inventory_categories (id, code, name, active)
values ('e3000000-0000-0000-0000-000000000010', 'CAT-S3-TEST', 'Cat S3 Test', true);

insert into public.inventory_uoms (code, name, dimension, allowed_scale, active)
values ('uom_s3_cnt', 'S3 Count', 'count', 0, true);

insert into public.inventory_catalog_items (
  id, code, name, category_id, material_kind, base_uom_code, tracking_strategy, return_semantics, expiry_required, active
) values (
  'e3000000-0000-0000-0000-000000000020', 'ITEM-S3-AST-1', 'Item S3 Asset 1',
  'e3000000-0000-0000-0000-000000000010', 'other', 'uom_s3_cnt', 'serialized', 'returnable', false, true
), (
  'e3000000-0000-0000-0000-000000000021', 'ITEM-S3-AST-2', 'Item S3 Asset 2',
  'e3000000-0000-0000-0000-000000000010', 'other', 'uom_s3_cnt', 'serialized', 'returnable', false, true
);

insert into public.inventory_storage_locations (id, code, name, active)
values ('e3000000-0000-0000-0000-000000000030', 'LOC-S3-TEST', 'Loc S3 Test', true);

insert into public.inventory_suppliers (id, name, active)
values ('e3000000-0000-0000-0000-000000000040', 'Supplier S3 Test', true);

insert into public.acquisition_records (id, source_reference, supplier_id, reference_date, status)
values ('e3000000-0000-0000-0000-000000000041', 'PO-S3-001', 'e3000000-0000-0000-0000-000000000040', '2026-10-01', 'active');

insert into public.acquisition_record_lines (
  id, acquisition_record_id, line_key, catalog_item_id, expected_purchase_quantity, purchase_uom_code, expected_conversion_factor
) values (
  'e3000000-0000-0000-0000-000000000042', 'e3000000-0000-0000-0000-000000000041', 'L1',
  'e3000000-0000-0000-0000-000000000020', 10, 'uom_s3_cnt', 1
);

-- 1. Invalid transaction operation rejected by inventory_transactions_operation_valid check constraint
select throws_ok(
  $$ insert into public.inventory_transactions (
       id, operation, business_key, actor_id, occurred_at
     ) values (
       'e3000000-0000-0000-0000-000000000049', 'BOGUS_OPERATION',
       '{"ref":"INVALID","row":"1"}', 'e3000000-0000-0000-0000-000000000001', now()
     ); $$,
  '23514', null, 'Invalid transaction operation rejected by check constraint'
);

-- Setup valid transaction header
insert into public.inventory_transactions (
  id, operation, business_key, actor_id, occurred_at, reason
) values (
  'e3000000-0000-0000-0000-000000000050', 'ASSET_RECEIVE',
  '{"ref":"PO-S3-001","row":"R1"}', 'e3000000-0000-0000-0000-000000000001', now(), 'PGTAP setup receive'
);

-- 2. Privileged UPDATE on inventory_transactions refused by immutability trigger
select throws_ok(
  $$ update public.inventory_transactions set reason = 'tampered'
     where id = 'e3000000-0000-0000-0000-000000000050'; $$,
  '42501', null, 'ASSET_RECEIVE transaction refuses privileged UPDATE'
);

-- 3. Privileged DELETE on inventory_transactions refused by immutability trigger
select throws_ok(
  $$ delete from public.inventory_transactions
     where id = 'e3000000-0000-0000-0000-000000000050'; $$,
  '42501', null, 'ASSET_RECEIVE transaction refuses privileged DELETE'
);

-- 4. Equipment asset check constraint rejects invalid asset_code format
select throws_ok(
  $$ insert into public.equipment_assets (
       asset_code, catalog_item_id, intake_kind, intake_reference, row_key, location_id
     ) values (
       'INVALID-CODE-XYZ', 'e3000000-0000-0000-0000-000000000020', 'open', 'OPEN-001', 'R1',
       'e3000000-0000-0000-0000-000000000030'
     ); $$,
  '23514', null, 'Malformed asset_code rejected by equipment_assets_code_format'
);

-- 5. Equipment asset check constraint rejects invalid lifecycle_status
select throws_ok(
  $$ insert into public.equipment_assets (
       asset_code, catalog_item_id, intake_kind, intake_reference, row_key, location_id, lifecycle_status
     ) values (
       'EIU-AST-11111111', 'e3000000-0000-0000-0000-000000000020', 'open', 'OPEN-001', 'R2',
       'e3000000-0000-0000-0000-000000000030', 'bogus_lifecycle'
     ); $$,
  '23514', null, 'Invalid lifecycle_status rejected by check constraint'
);

-- 6. Equipment asset check constraint rejects invalid operational_status
select throws_ok(
  $$ insert into public.equipment_assets (
       asset_code, catalog_item_id, intake_kind, intake_reference, row_key, location_id, operational_status
     ) values (
       'EIU-AST-22222222', 'e3000000-0000-0000-0000-000000000020', 'open', 'OPEN-001', 'R3',
       'e3000000-0000-0000-0000-000000000030', 'broken'
     ); $$,
  '23514', null, 'Invalid operational_status rejected by check constraint'
);

-- 7. Equipment asset check constraint rejects serial without manufacturer and model
select throws_ok(
  $$ insert into public.equipment_assets (
       asset_code, catalog_item_id, intake_kind, intake_reference, row_key, location_id,
       manufacturer_serial, manufacturer, model
     ) values (
       'EIU-AST-33333333', 'e3000000-0000-0000-0000-000000000020', 'open', 'OPEN-001', 'R4',
       'e3000000-0000-0000-0000-000000000030',
       'SN-12345', null, null
     ); $$,
  '23514', null, 'Serial without manufacturer/model rejected by equipment_assets_serial_requires_maker_model'
);

-- 8. Equipment asset check constraint rejects non-positive revision
select throws_ok(
  $$ insert into public.equipment_assets (
       asset_code, catalog_item_id, intake_kind, intake_reference, row_key, location_id, revision
     ) values (
       'EIU-AST-44444444', 'e3000000-0000-0000-0000-000000000020', 'open', 'OPEN-001', 'R5',
       'e3000000-0000-0000-0000-000000000030', 0
     ); $$,
  '23514', null, 'Revision < 1 rejected by equipment_assets_revision_positive'
);

-- Setup canonical valid asset
insert into public.equipment_assets (
  id, asset_code, catalog_item_id, source_line_id, intake_kind, intake_reference, row_key,
  manufacturer, model, manufacturer_serial, location_id, lifecycle_status, operational_status, revision
) values (
  'e3000000-0000-0000-0000-000000000060', 'EIU-AST-A1B2C3D4', 'e3000000-0000-0000-0000-000000000020',
  'e3000000-0000-0000-0000-000000000042', 'receive', 'PO-S3-001', 'R1',
  'Philips', 'PageWriter TC50', 'SN-S3-001', 'e3000000-0000-0000-0000-000000000030',
  'registered', 'ready', 1
);

-- Setup canonical valid asset event
insert into public.equipment_asset_events (
  id, asset_id, revision, operation, actor_id, occurred_at, reason, evidence_note,
  before_state, after_state, transaction_id
) values (
  'e3000000-0000-0000-0000-000000000070', 'e3000000-0000-0000-0000-000000000060', 1,
  'receive_asset', 'e3000000-0000-0000-0000-000000000001', now(), 'Initial receipt', 'Signed delivery note',
  null, '{"asset_code":"EIU-AST-A1B2C3D4","revision":1}'::jsonb, 'e3000000-0000-0000-0000-000000000050'
);

-- 9. Privileged UPDATE on equipment_asset_events refused by immutability trigger
select throws_ok(
  $$ update public.equipment_asset_events set reason = 'tampered'
     where id = 'e3000000-0000-0000-0000-000000000070'; $$,
  '42501', null, 'equipment_asset_events refuses privileged UPDATE'
);

-- 10. Privileged DELETE on equipment_asset_events refused by immutability trigger
select throws_ok(
  $$ delete from public.equipment_asset_events
     where id = 'e3000000-0000-0000-0000-000000000070'; $$,
  '42501', null, 'equipment_asset_events refuses privileged DELETE'
);

-- 11. Privileged DELETE on equipment_assets refused by mutation guard trigger
select throws_ok(
  $$ delete from public.equipment_assets
     where id = 'e3000000-0000-0000-0000-000000000060'; $$,
  '42501', null, 'equipment_assets refuses privileged DELETE'
);

-- 12. UPDATE modifying immutable identity on equipment_assets refused
select throws_ok(
  $$ update public.equipment_assets set asset_code = 'EIU-AST-FFFFFFFF'
     where id = 'e3000000-0000-0000-0000-000000000060'; $$,
  '42501', null, 'equipment_assets refuses modification of asset_code'
);

-- 13. UPDATE skipping revision monotonically on equipment_assets refused
select throws_ok(
  $$ update public.equipment_assets set revision = 5
     where id = 'e3000000-0000-0000-0000-000000000060'; $$,
  '23505', null, 'equipment_assets refuses non-monotonic revision jump'
);

-- 14. Unique asset_code constraint prevents duplicate asset_code
select throws_ok(
  $$ insert into public.equipment_assets (
       asset_code, catalog_item_id, intake_kind, intake_reference, row_key, location_id
     ) values (
       'EIU-AST-A1B2C3D4', 'e3000000-0000-0000-0000-000000000021', 'open', 'OPEN-DUP', 'R1',
       'e3000000-0000-0000-0000-000000000030'
     ); $$,
  '23505', null, 'Duplicate asset_code rejected by equipment_assets_code_unique'
);

-- 15. Unique index on manufacturer + model + serial rejects duplicate across different SKUs
select throws_ok(
  $$ insert into public.equipment_assets (
       asset_code, catalog_item_id, intake_kind, intake_reference, row_key, location_id,
       manufacturer, model, manufacturer_serial
     ) values (
       'EIU-AST-55555555', 'e3000000-0000-0000-0000-000000000021', 'open', 'OPEN-NEW', 'R9',
       'e3000000-0000-0000-0000-000000000030',
       ' philips ', ' pagewriter tc50 ', 'sn-s3-001'
     ); $$,
  '23505', null, 'Duplicate qualified serial across SKUs rejected by idx_equipment_assets_serial_unique'
);

-- 16. Unique intake identity (intake_kind, intake_reference, row_key) rejects duplicate intake tuple
select throws_ok(
  $$ insert into public.equipment_assets (
       asset_code, catalog_item_id, intake_kind, intake_reference, row_key, location_id
     ) values (
       'EIU-AST-66666666', 'e3000000-0000-0000-0000-000000000020', 'receive', 'PO-S3-001', 'R1',
       'e3000000-0000-0000-0000-000000000030'
     ); $$,
  '23505', null, 'Duplicate intake tuple rejected by equipment_assets_intake_unique'
);

-- 17. First-fact guard prevents modifying tracking_strategy on catalog item referenced by asset
select throws_ok(
  $$ update public.inventory_catalog_items set tracking_strategy = 'quantity'
     where id = 'e3000000-0000-0000-0000-000000000020'; $$,
  '42501', null, 'Catalog item tracking_strategy locked by guard_catalog_item_asset_facts'
);

-- 18. First-fact guard prevents retargeting catalog_item_id on source line referenced by asset
select throws_ok(
  $$ update public.acquisition_record_lines set catalog_item_id = 'e3000000-0000-0000-0000-000000000021'
     where id = 'e3000000-0000-0000-0000-000000000042'; $$,
  '42501', null, 'Source line catalog item retarget locked by guard_acquisition_line_asset_facts'
);

select * from finish();
rollback;
