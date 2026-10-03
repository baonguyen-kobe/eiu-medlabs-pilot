-- Synthetic S5 holds and guards regression suite.
-- Covers condition-specific holds, held floor protection, canceled hold root skipping,
-- and UOM allowed_scale validation on admin consequence and reconcile operations.
-- Isolated namespace pg_temp.s5h_* to prevent collisions.
begin;
select no_plan();

create function pg_temp.s5h_id(n integer) returns uuid language sql immutable as $$
  select ('e5500000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select pg_temp.s5h_id(n),'s5-holds-'||n||'@campus.local','{"preapproved":true}'::jsonb,
  jsonb_build_object('full_name','S5 holds actor '||n) from generate_series(1,4) n;

insert into public.profiles(id,email,full_name,phone,is_active)
select pg_temp.s5h_id(n),'s5-holds-'||n||'@campus.local','S5 holds actor '||n,'0901122334',true
from generate_series(1,4) n on conflict(id) do update set phone=excluded.phone,is_active=true;

insert into public.user_roles(user_id,role) values
(pg_temp.s5h_id(1),'admin'),(pg_temp.s5h_id(2),'lecturer'),
(pg_temp.s5h_id(3),'staff'),(pg_temp.s5h_id(4),'staff');

delete from public.profile_room_types where profile_id=pg_temp.s5h_id(4);
insert into public.profile_room_types(profile_id,room_type_id)
values(pg_temp.s5h_id(3),'40000000-0000-0000-0000-000000000001') on conflict do nothing;

select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.s5h_id(1),'role','authenticated')::text,true);

insert into public.rooms(id,room_code,building_code,room_type_id)
values(pg_temp.s5h_id(10),'S5H_TEST','S5H_TEST','40000000-0000-0000-0000-000000000001');

insert into public.class_schedules(id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,schedule_date,start_time,end_time,semester,created_by)
select pg_temp.s5h_id(n),'S5H-'||n,'S5 holds fixture',pg_temp.s5h_id(10),pg_temp.s5h_id(2),current_date+50+n,'09:00','11:00','HK1',pg_temp.s5h_id(1)
from generate_series(11,16) n;

insert into public.equipment_catalog(id,item_name,commercial_name,unit) values
(pg_temp.s5h_id(20),'S5H liquid','S5H liquid demand','liều'),
(pg_temp.s5h_id(21),'S5H asset','S5H asset demand','cái'),
(pg_temp.s5h_id(24),'S5H rational','S5H rational demand','bộ');

insert into public.inventory_categories(id,code,name) values(pg_temp.s5h_id(30),'S5H-CAT','S5 holds fixture');
insert into public.inventory_uoms(code,name,dimension,allowed_scale) values
('s5h_ml','S5H millilitre','volume',6),('s5h_count','S5H count','count',0);

insert into public.inventory_catalog_items(id,code,name,category_id,material_kind,base_uom_code,tracking_strategy,return_semantics,expiry_required) values
(pg_temp.s5h_id(31),'S5H-LIQUID','S5H liquid',pg_temp.s5h_id(30),'other','s5h_ml','quantity','nonreturnable',false),
(pg_temp.s5h_id(32),'S5H-ASSET','S5H asset',pg_temp.s5h_id(30),'other','s5h_count','serialized','returnable',true),
(pg_temp.s5h_id(33),'S5H-RATIONAL','S5H rational stock',pg_temp.s5h_id(30),'other','s5h_count','quantity','returnable',false);

insert into public.inventory_storage_locations(id,code,name) values
(pg_temp.s5h_id(41),'S5H-A','S5H source A'),(pg_temp.s5h_id(42),'S5H-B','S5H source B'),(pg_temp.s5h_id(43),'S5H-C','S5H replacement');

create temporary table s5h_context(key text primary key,value jsonb);
grant all on s5h_context to authenticated;
set local role authenticated;

create function pg_temp.s5h_actor(n integer) returns text language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.s5h_id(n),'role','authenticated')::text,true)
$$;

create function pg_temp.s5h_request(k text) returns uuid language sql as $$select (value#>>'{}')::uuid from s5h_context where key=k$$;

create function pg_temp.s5h_command(k text,op text,payload jsonb default '{}') returns jsonb language sql as $$
 select public.equipment_preparation_command(op,pg_temp.s5h_request(k),jsonb_build_object('expected_revision',
 (select preparation_revision from public.equipment_requests where id=pg_temp.s5h_request(k)))||payload,gen_random_uuid())
$$;

create function pg_temp.s5h_line(k text) returns uuid language sql as $$
 select id from public.equipment_request_items where request_id=pg_temp.s5h_request(k) and catalog_item_id in (pg_temp.s5h_id(20),pg_temp.s5h_id(21),pg_temp.s5h_id(24))
$$;

create function pg_temp.s5h_alloc(mapping text,loc integer,q text,assets jsonb default '[]') returns jsonb language sql as $$
 select jsonb_build_object('mapping_id',value->>'mapping_id','location_id',pg_temp.s5h_id(loc),'base_quantity',q,'asset_ids',assets)
 from s5h_context where key=mapping
$$;

create function pg_temp.s5h_plan(k text,q text,allocations jsonb) returns jsonb language sql as $$
 select jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',id,'planned_quantity',q,
 'reviewed_revision',line_revision,'shortage_reason','Reviewed exact target','allocations',allocations)))
 from public.equipment_request_items where id=pg_temp.s5h_line(k)
$$;

create function pg_temp.s5h_confirm(k text,plan jsonb) returns jsonb language sql as $$
 select pg_temp.s5h_command(k,'confirm',jsonb_build_object('lock_token',pg_temp.s5h_id(90),'draft_revision',
 (select revision from public.equipment_preparations where request_id=pg_temp.s5h_request(k) and state='draft'),'plan',plan))
$$;

-- Physical opening
insert into s5h_context values('opening',public.inventory_command('confirm_opening_balance',jsonb_build_object(
 'synthetic',true,'cutover_key','S5H-OPENING','scope_description','S5 holds fixture','count_cutoff',now(),'provenance_note','Synthetic acceptance stock',
 'lines',jsonb_build_array(
 jsonb_build_object('line_key','A','provenance_group','A','catalog_item_id',pg_temp.s5h_id(33),'location_id',pg_temp.s5h_id(41),'good_quantity','10','damaged_quantity','0','expiry_precision','not_required'),
 jsonb_build_object('line_key','B','provenance_group','B','catalog_item_id',pg_temp.s5h_id(33),'location_id',pg_temp.s5h_id(42),'good_quantity','10','damaged_quantity','0','expiry_precision','not_required'),
 jsonb_build_object('line_key','C','provenance_group','C','catalog_item_id',pg_temp.s5h_id(31),'location_id',pg_temp.s5h_id(43),'good_quantity','5.000000','damaged_quantity','0','expiry_precision','not_required'))),gen_random_uuid()));

insert into s5h_context
select 'rational',to_jsonb(public.create_equipment_request_with_items(pg_temp.s5h_id(16),'HK1',pg_temp.s5h_id(2),
 ((current_date+66)::text||' 09:00+07')::timestamptz,((current_date+66)::text||' 11:00+07')::timestamptz,null,null,
 jsonb_build_array(jsonb_build_object('skill_name','S5H Skill','catalog_item_id',pg_temp.s5h_id(24),'quantity','1'))));

insert into s5h_context values
('rational-map',pg_temp.s5h_command('rational','map_item',jsonb_build_object('catalog_item_id',pg_temp.s5h_id(24),'inventory_item_id',pg_temp.s5h_id(33),'base_units_per_requested_unit','3.000000','reason','Three base units per requested set')));

create function pg_temp.s5_command(k text,op text,payload jsonb default '{}') returns jsonb language sql as $$
 select public.equipment_fulfillment_command(op,pg_temp.s5h_request(k),jsonb_build_object('expected_revision',
 (select fulfillment_revision from public.equipment_requests where id=pg_temp.s5h_request(k)),'business_key',gen_random_uuid(),'reason','Synthetic physical fact')||payload,gen_random_uuid())
$$;

create function pg_temp.s5_slice(k text) returns uuid language sql as $$
 select s.id from public.equipment_issue_slices s join public.equipment_fulfillment_events e on e.id=s.event_id where e.request_id=pg_temp.s5h_request(k) order by e.revision limit 1
$$;

create function pg_temp.s5_issue(k text,m text,loc integer,q text) returns jsonb language sql as $$
 select jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',pg_temp.s5h_line(k),'mapping_id',value->>'mapping_id','location_id',pg_temp.s5h_id(loc),'quantity',q,'asset_ids','[]'::jsonb))) from s5h_context where key=m
$$;

create function pg_temp.s5h_cohort_a() returns uuid language sql as $$
 select c.origin_id from public.inventory_stock_origins o join public.inventory_receipt_cohorts c on c.origin_id=o.id where o.catalog_item_id=pg_temp.s5h_id(33) and o.line_key='A'
$$;

create function pg_temp.s5h_cohort_b() returns uuid language sql as $$
 select c.origin_id from public.inventory_stock_origins o join public.inventory_receipt_cohorts c on c.origin_id=o.id where o.catalog_item_id=pg_temp.s5h_id(33) and o.line_key='B'
$$;

-- 1. Setup Request: Start, Confirm, Handover 3 units from location 41
select pg_temp.s5h_command('rational','start',jsonb_build_object('lock_token',pg_temp.s5h_id(90)));
select pg_temp.s5h_confirm('rational',pg_temp.s5h_plan('rational','1',jsonb_build_array(pg_temp.s5h_alloc('rational-map',41,'3'))));
select pg_temp.s5_command('rational','handover',pg_temp.s5_issue('rational','rational-map',41,'3'));
insert into s5h_context values('slice-id',to_jsonb(pg_temp.s5_slice('rational')));

-- Initial return: 0 returned, all 3 due
select pg_temp.s5_command('rational','initial_return','{"lines":[]}');

-- Staff resolves all 3 due as missing
select pg_temp.s5h_actor(3);
select pg_temp.s5_command('rational','resolve',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('issue_slice_id',(select value#>>'{}' from s5h_context where key='slice-id'),'quantity','3','classification','missing'))));

-- 2. Boundary (3): Scale validation on Admin consequence
select pg_temp.s5h_actor(1);
select throws_ok(
  $$select pg_temp.s5_command('rational','consequence',jsonb_build_object('issue_slice_id',(select value#>>'{}' from s5h_context where key='slice-id'),'quantity','1.5','classification','settled','evidence','Fractional count rejected'))$$,
  'P0001','S5_INVALID_QUANTITY','consequence rejects quantity exceeding inventory UOM allowed_scale'
);

-- Admin consequences 2 units legitimately
select lives_ok(
  $$select pg_temp.s5_command('rational','consequence',jsonb_build_object('issue_slice_id',(select value#>>'{}' from s5h_context where key='slice-id'),'quantity','2','classification','settled','evidence','Admin consequence approved'))$$,
  'admin consequence succeeds with exact integer quantity'
);

-- 3. Late recover of 1 unit in 'damaged' condition at location 41
-- Because consequence was settled, this late intake creates a 'damaged' hold.
select pg_temp.s5h_actor(3);
select pg_temp.s5_command('rational','recover',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('issue_slice_id',(select value#>>'{}' from s5h_context where key='slice-id'),'location_id',pg_temp.s5h_id(41),'quantity','1','condition','damaged'))));

reset role;
grant execute on function private.s5_pool_hold(uuid,uuid,text) to authenticated;
set local role authenticated;
select pg_temp.s5h_actor(3);
reset role;
grant execute on function private.s4_pool_backing(uuid,uuid) to authenticated;
set local role authenticated;
select pg_temp.s5h_actor(3);
-- Verify hold was recorded condition-specifically
select is(private.s5_pool_hold(pg_temp.s5h_cohort_a(),pg_temp.s5h_id(41),'damaged'),1::numeric,'damaged hold is recorded at location A');
select is(private.s5_pool_hold(pg_temp.s5h_cohort_a(),pg_temp.s5h_id(41),'good'),0::numeric,'good hold remains zero at location A');

-- Boundary (2): Damaged hold does not reduce good backing availability
select is(private.s4_pool_backing(pg_temp.s5h_cohort_a(),pg_temp.s5h_id(41)),7::numeric,'damaged hold does not reduce good backing availability');

-- Boundary (2): Damaged hold does not block decrease of free good stock
-- Test via direct update under reset role (database superuser context in tests)
reset role;
select lives_ok(
  $$update public.inventory_stock_balances set quantity=5,updated_at=clock_timestamp() where cohort_id=pg_temp.s5h_cohort_a() and location_id=pg_temp.s5h_id(41) and condition='good'$$,
  'unheld good stock can decrease while damaged hold exists'
);
select is((select quantity from public.inventory_stock_balances where cohort_id=pg_temp.s5h_cohort_a() and location_id=pg_temp.s5h_id(41) and condition='good'),5::numeric,'good stock balance decreased to 5');

select throws_ok(
  $$update public.inventory_stock_balances set quantity=0,updated_at=clock_timestamp() where cohort_id=pg_temp.s5h_cohort_a() and location_id=pg_temp.s5h_id(41) and condition='damaged'$$,
  'P0001','S5_RECONCILIATION_HOLD','mutation guard blocks decrease below damaged held floor'
);
set local role authenticated;
select pg_temp.s5h_actor(3);
-- 4. Late recover of 1 unit in 'good' condition at location 41 (Location A)
-- Creates root hold for good stock at location A
select pg_temp.s5_command('rational','recover',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('issue_slice_id',(select value#>>'{}' from s5h_context where key='slice-id'),'location_id',pg_temp.s5h_id(41),'quantity','1','condition','good'))));
insert into s5h_context values('recover-good-event',(select to_jsonb(id) from public.equipment_fulfillment_events where request_id=pg_temp.s5h_request('rational') and operation='recover' order by revision desc limit 1));

select is(private.s5_pool_hold(pg_temp.s5h_cohort_a(),pg_temp.s5h_id(41),'good'),1::numeric,'good hold of 1 recorded at location A');
-- Good stock at location 41 is now 5 + 1 = 6. Held floor is 1.

reset role;
select lives_ok(
  $$update public.inventory_stock_balances set quantity=2,updated_at=clock_timestamp() where cohort_id=pg_temp.s5h_cohort_a() and location_id=pg_temp.s5h_id(41) and condition='good'$$,
  'unheld good stock above held floor can decrease freely'
);
select throws_ok(
  $$update public.inventory_stock_balances set quantity=0,updated_at=clock_timestamp() where cohort_id=pg_temp.s5h_cohort_a() and location_id=pg_temp.s5h_id(41) and condition='good'$$,
  'P0001','S5_RECONCILIATION_HOLD','mutation guard blocks decrease below good held floor'
);
set local role authenticated;
select pg_temp.s5h_actor(1);

-- 5. Boundary (3): Scale validation on Admin reconcile
select pg_temp.s5h_actor(1);
select throws_ok(
  $$select pg_temp.s5_command('rational','reconcile',jsonb_build_object('issue_slice_id',(select value#>>'{}' from s5h_context where key='slice-id'),'quantity','0.5','classification','restore_eligible','evidence','Fractional reconcile rejected'))$$,
  'P0001','S5_INVALID_QUANTITY','reconcile rejects quantity exceeding inventory UOM allowed_scale'
);

-- 6. Boundary (1): Canceled hold root not consumed after recover correction moves A -> B
-- Correct the good recover event to move intake from location A (41) to location B (42)
select pg_temp.s5h_actor(3);
select lives_ok(
  $$select pg_temp.s5_command('rational','correct',jsonb_build_object('event_id',(select value#>>'{}' from s5h_context where key='recover-good-event')::uuid,'lines',jsonb_build_array(jsonb_build_object('issue_slice_id',(select value#>>'{}' from s5h_context where key='slice-id'),'location_id',pg_temp.s5h_id(42),'quantity','1','condition','good'))))$$,
  'correction moves recovered receipt from location A to location B'
);

-- Verify hold states before reconciliation:
-- Hold at location A (41) should be canceled (sum = 0)
select is(private.s5_pool_hold(pg_temp.s5h_cohort_a(),pg_temp.s5h_id(41),'good'),0::numeric,'hold at location A is cancelled by correction');
-- Hold at location B (42) should now be active (1)
select is(private.s5_pool_hold(pg_temp.s5h_cohort_a(),pg_temp.s5h_id(42),'good'),1::numeric,'hold at location B is active after correction');

-- Admin reconciles the 1 held unit
select pg_temp.s5h_actor(1);
select lives_ok(
  $$select pg_temp.s5_command('rational','reconcile',jsonb_build_object('issue_slice_id',(select value#>>'{}' from s5h_context where key='slice-id'),'quantity','1','classification','restore_eligible','evidence','Admin reconciles corrected location B hold'))$$,
  'admin reconciliation executes successfully'
);

-- Boundary (1) verification:
-- Canceled hold root at Location A was skipped and not consumed
select is(private.s5_pool_hold(pg_temp.s5h_cohort_a(),pg_temp.s5h_id(41),'good'),0::numeric,'canceled hold root at location A was not doubly offset');
-- Positive hold root at Location B was consumed and cleared
select is(private.s5_pool_hold(pg_temp.s5h_cohort_a(),pg_temp.s5h_id(42),'good'),0::numeric,'reconcile consumed positive hold root at location B, clearing pool B');

select * from finish();
rollback;
