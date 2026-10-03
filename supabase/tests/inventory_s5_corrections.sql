-- S5 corrections behavioral regression covering same-asset and A->B->C correction chains
-- Isolated namespace pg_temp.s5c_* to prevent collisions with existing test fixtures.
begin;
select no_plan();

create function pg_temp.s5c_id(n integer) returns uuid language sql immutable as $$
  select ('e51c0000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select pg_temp.s5c_id(n),'s5-corrections-'||n||'@campus.local','{"preapproved":true}'::jsonb,
  jsonb_build_object('full_name','S5 corrections actor '||n) from generate_series(1,4) n;

insert into public.profiles(id,email,full_name,phone,is_active)
select pg_temp.s5c_id(n),'s5-corrections-'||n||'@campus.local','S5 corrections actor '||n,'0907654321',true
from generate_series(1,4) n on conflict(id) do update set phone=excluded.phone,is_active=true;

insert into public.user_roles(user_id,role) values
(pg_temp.s5c_id(1),'admin'),(pg_temp.s5c_id(2),'lecturer'),
(pg_temp.s5c_id(3),'staff'),(pg_temp.s5c_id(4),'staff');

delete from public.profile_room_types where profile_id=pg_temp.s5c_id(4);
insert into public.profile_room_types(profile_id,room_type_id)
values(pg_temp.s5c_id(3),'40000000-0000-0000-0000-000000000001') on conflict do nothing;

select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.s5c_id(1),'role','authenticated')::text,true);

insert into public.rooms(id,room_code,building_code,room_type_id)
values(pg_temp.s5c_id(10),'S5C_TEST','S5C_TEST','40000000-0000-0000-0000-000000000001');

insert into public.class_schedules(id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,schedule_date,start_time,end_time,semester,created_by)
select pg_temp.s5c_id(n),'S5C-'||n,'S5 corrections fixture',pg_temp.s5c_id(10),pg_temp.s5c_id(2),current_date+40+n,'09:00','11:00','HK1',pg_temp.s5c_id(1)
from generate_series(11,14) n;

insert into public.equipment_catalog(id,item_name,commercial_name,unit) values
(pg_temp.s5c_id(21),'S5C asset item','S5C asset item demand','cái');

insert into public.inventory_categories(id,code,name) values(pg_temp.s5c_id(30),'S5C-CAT','S5 corrections fixture');

insert into public.inventory_uoms(code,name,dimension,allowed_scale) values
('s5c_count','S5C count','count',0);

insert into public.inventory_catalog_items(id,code,name,category_id,material_kind,base_uom_code,tracking_strategy,return_semantics,expiry_required) values
(pg_temp.s5c_id(32),'S5C-SERIAL','S5C serial stock',pg_temp.s5c_id(30),'other','s5c_count','serialized','returnable',true);

insert into public.inventory_storage_locations(id,code,name) values
(pg_temp.s5c_id(41),'S5C-LOC1','S5C source location 1'),
(pg_temp.s5c_id(42),'S5C-LOC2','S5C return location 2');

create temporary table s5c_context(key text primary key,value jsonb);
grant all on s5c_context to authenticated;
set local role authenticated;

create function pg_temp.s5c_actor(n integer) returns text language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.s5c_id(n),'role','authenticated')::text,true)
$$;

create function pg_temp.s5c_request(k text) returns uuid language sql as $$
 select (value#>>'{}')::uuid from s5c_context where key=k
$$;

create function pg_temp.s5c_line(k text) returns uuid language sql as $$
 select id from public.equipment_request_items where request_id=pg_temp.s5c_request(k) and catalog_item_id=pg_temp.s5c_id(21)
$$;

create function pg_temp.s5c_command(k text,op text,payload jsonb default '{}') returns jsonb language sql as $$
 select public.equipment_fulfillment_command(op,pg_temp.s5c_request(k),jsonb_build_object('expected_revision',
 (select fulfillment_revision from public.equipment_requests where id=pg_temp.s5c_request(k)),'business_key',gen_random_uuid(),'reason','Synthetic physical fact')||payload,gen_random_uuid())
$$;

create function pg_temp.s5c_prep_command(k text,op text,payload jsonb default '{}') returns jsonb language sql as $$
 select public.equipment_preparation_command(op,pg_temp.s5c_request(k),jsonb_build_object('expected_revision',
 (select preparation_revision from public.equipment_requests where id=pg_temp.s5c_request(k)))||payload,gen_random_uuid())
$$;

-- Create 6 test assets: A, B, C, D, E, F
insert into s5c_context values
('asset-A',public.equipment_asset_command('open_asset',jsonb_build_object('catalog_item_id',pg_temp.s5c_id(32),'location_id',pg_temp.s5c_id(41),'intake_reference','S5C-OPEN-A','row_key','A','expiry_precision','day','expiry_input',(current_date+365)::text,'reason','Opening A','evidence_note','S5C fixture'),gen_random_uuid())),
('asset-B',public.equipment_asset_command('open_asset',jsonb_build_object('catalog_item_id',pg_temp.s5c_id(32),'location_id',pg_temp.s5c_id(41),'intake_reference','S5C-OPEN-B','row_key','B','expiry_precision','day','expiry_input',(current_date+365)::text,'reason','Opening B','evidence_note','S5C fixture'),gen_random_uuid())),
('asset-C',public.equipment_asset_command('open_asset',jsonb_build_object('catalog_item_id',pg_temp.s5c_id(32),'location_id',pg_temp.s5c_id(41),'intake_reference','S5C-OPEN-C','row_key','C','expiry_precision','day','expiry_input',(current_date+365)::text,'reason','Opening C','evidence_note','S5C fixture'),gen_random_uuid())),
('asset-D',public.equipment_asset_command('open_asset',jsonb_build_object('catalog_item_id',pg_temp.s5c_id(32),'location_id',pg_temp.s5c_id(41),'intake_reference','S5C-OPEN-D','row_key','D','expiry_precision','day','expiry_input',(current_date+365)::text,'reason','Opening D','evidence_note','S5C fixture'),gen_random_uuid())),
('asset-E',public.equipment_asset_command('open_asset',jsonb_build_object('catalog_item_id',pg_temp.s5c_id(32),'location_id',pg_temp.s5c_id(41),'intake_reference','S5C-OPEN-E','row_key','E','expiry_precision','day','expiry_input',(current_date+365)::text,'reason','Opening E','evidence_note','S5C fixture'),gen_random_uuid())),
('asset-F',public.equipment_asset_command('open_asset',jsonb_build_object('catalog_item_id',pg_temp.s5c_id(32),'location_id',pg_temp.s5c_id(41),'intake_reference','S5C-OPEN-F','row_key','F','expiry_precision','day','expiry_input',(current_date+365)::text,'reason','Opening F','evidence_note','S5C fixture'),gen_random_uuid()));

select public.equipment_asset_command('set_asset_lifecycle',jsonb_build_object('id',(select value->>'id' from s5c_context where key='asset-A'),'expected_revision',1,'lifecycle_status','in_service','reason','Commission A','evidence_note','S5C'),gen_random_uuid());
select public.equipment_asset_command('set_asset_lifecycle',jsonb_build_object('id',(select value->>'id' from s5c_context where key='asset-B'),'expected_revision',1,'lifecycle_status','in_service','reason','Commission B','evidence_note','S5C'),gen_random_uuid());
select public.equipment_asset_command('set_asset_lifecycle',jsonb_build_object('id',(select value->>'id' from s5c_context where key='asset-C'),'expected_revision',1,'lifecycle_status','in_service','reason','Commission C','evidence_note','S5C'),gen_random_uuid());
select public.equipment_asset_command('set_asset_lifecycle',jsonb_build_object('id',(select value->>'id' from s5c_context where key='asset-D'),'expected_revision',1,'lifecycle_status','in_service','reason','Commission D','evidence_note','S5C'),gen_random_uuid());
select public.equipment_asset_command('set_asset_lifecycle',jsonb_build_object('id',(select value->>'id' from s5c_context where key='asset-E'),'expected_revision',1,'lifecycle_status','in_service','reason','Commission E','evidence_note','S5C'),gen_random_uuid());
select public.equipment_asset_command('set_asset_lifecycle',jsonb_build_object('id',(select value->>'id' from s5c_context where key='asset-F'),'expected_revision',1,'lifecycle_status','in_service','reason','Commission F','evidence_note','S5C'),gen_random_uuid());
-- Requests
insert into s5c_context
select k,to_jsonb(public.create_equipment_request_with_items(pg_temp.s5c_id(schedule),'HK1',pg_temp.s5c_id(2),
 ((current_date+40+schedule)::text||' 09:00+07')::timestamptz,((current_date+40+schedule)::text||' 11:00+07')::timestamptz,null,null,
 jsonb_build_array(jsonb_build_object('skill_name','S5C Skills','catalog_item_id',pg_temp.s5c_id(21),'quantity','1'))))
from (values('chain-abc',11),('chain-same',12),('chain-receipt',13),('chain-admin',14)) fixtures(k,schedule);

select pg_temp.s5c_prep_command('chain-abc','map_item',jsonb_build_object('catalog_item_id',pg_temp.s5c_id(21),'inventory_item_id',pg_temp.s5c_id(32),'base_units_per_requested_unit','1','reason','Mapping'));
insert into s5c_context values
('map-abc',(select to_jsonb(m) from (select id as mapping_id from public.equipment_inventory_mappings where catalog_item_id=pg_temp.s5c_id(21) and inventory_item_id=pg_temp.s5c_id(32)) m)),
('map-same',(select to_jsonb(m) from (select id as mapping_id from public.equipment_inventory_mappings where catalog_item_id=pg_temp.s5c_id(21) and inventory_item_id=pg_temp.s5c_id(32)) m)),
('map-receipt',(select to_jsonb(m) from (select id as mapping_id from public.equipment_inventory_mappings where catalog_item_id=pg_temp.s5c_id(21) and inventory_item_id=pg_temp.s5c_id(32)) m)),
('map-admin',(select to_jsonb(m) from (select id as mapping_id from public.equipment_inventory_mappings where catalog_item_id=pg_temp.s5c_id(21) and inventory_item_id=pg_temp.s5c_id(32)) m));
-- Prepare all 4 requests
select pg_temp.s5c_prep_command('chain-abc','start',jsonb_build_object('lock_token',pg_temp.s5c_id(91)));
select pg_temp.s5c_prep_command('chain-abc','confirm',jsonb_build_object('lock_token',pg_temp.s5c_id(91),'draft_revision',
 (select revision from public.equipment_preparations where request_id=pg_temp.s5c_request('chain-abc') and state='draft'),
 'plan',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',pg_temp.s5c_line('chain-abc'),'planned_quantity','1','reviewed_revision',1,'shortage_reason','Reviewed',
 'allocations',jsonb_build_array(jsonb_build_object('mapping_id',(select value->>'mapping_id' from s5c_context where key='map-abc'),'location_id',pg_temp.s5c_id(41),'base_quantity','1','asset_ids',jsonb_build_array((select value->>'id' from s5c_context where key='asset-A')))))))));

select pg_temp.s5c_prep_command('chain-same','start',jsonb_build_object('lock_token',pg_temp.s5c_id(92)));
select pg_temp.s5c_prep_command('chain-same','confirm',jsonb_build_object('lock_token',pg_temp.s5c_id(92),'draft_revision',
 (select revision from public.equipment_preparations where request_id=pg_temp.s5c_request('chain-same') and state='draft'),
 'plan',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',pg_temp.s5c_line('chain-same'),'planned_quantity','1','reviewed_revision',1,'shortage_reason','Reviewed',
 'allocations',jsonb_build_array(jsonb_build_object('mapping_id',(select value->>'mapping_id' from s5c_context where key='map-same'),'location_id',pg_temp.s5c_id(41),'base_quantity','1','asset_ids',jsonb_build_array((select value->>'id' from s5c_context where key='asset-D')))))))));

select pg_temp.s5c_prep_command('chain-receipt','start',jsonb_build_object('lock_token',pg_temp.s5c_id(93)));
select pg_temp.s5c_prep_command('chain-receipt','confirm',jsonb_build_object('lock_token',pg_temp.s5c_id(93),'draft_revision',
 (select revision from public.equipment_preparations where request_id=pg_temp.s5c_request('chain-receipt') and state='draft'),
 'plan',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',pg_temp.s5c_line('chain-receipt'),'planned_quantity','1','reviewed_revision',1,'shortage_reason','Reviewed',
 'allocations',jsonb_build_array(jsonb_build_object('mapping_id',(select value->>'mapping_id' from s5c_context where key='map-receipt'),'location_id',pg_temp.s5c_id(41),'base_quantity','1','asset_ids',jsonb_build_array((select value->>'id' from s5c_context where key='asset-E')))))))));

select pg_temp.s5c_prep_command('chain-admin','start',jsonb_build_object('lock_token',pg_temp.s5c_id(94)));
select pg_temp.s5c_prep_command('chain-admin','confirm',jsonb_build_object('lock_token',pg_temp.s5c_id(94),'draft_revision',
 (select revision from public.equipment_preparations where request_id=pg_temp.s5c_request('chain-admin') and state='draft'),
 'plan',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',pg_temp.s5c_line('chain-admin'),'planned_quantity','1','reviewed_revision',1,'shortage_reason','Reviewed',
 'allocations',jsonb_build_array(jsonb_build_object('mapping_id',(select value->>'mapping_id' from s5c_context where key='map-admin'),'location_id',pg_temp.s5c_id(41),'base_quantity','1','asset_ids',jsonb_build_array((select value->>'id' from s5c_context where key='asset-F')))))))));

-- Helper for handover payload
create function pg_temp.s5c_issue_payload(k text,m text,loc integer,asset_id text) returns jsonb language sql as $$
 select jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',pg_temp.s5c_line(k),'mapping_id',value->>'mapping_id','location_id',pg_temp.s5c_id(loc),'quantity','1','asset_ids',jsonb_build_array(asset_id))))
 from s5c_context where key=m
$$;

--------------------------------------------------------------------------------
-- Scenario 1: A -> B -> C correction chain on handover
--------------------------------------------------------------------------------
-- Step 1: Initial handover with Asset A
select pg_temp.s5c_command('chain-abc','handover',pg_temp.s5c_issue_payload('chain-abc','map-abc',41,(select value->>'id' from s5c_context where key='asset-A')));
select is((select operational_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5c_context where key='asset-A')),'in_use','A is in_use after initial handover');

-- Step 2: C1 corrects Handover to Asset B
insert into s5c_context values('c1-abc',pg_temp.s5c_command('chain-abc','correct',pg_temp.s5c_issue_payload('chain-abc','map-abc',41,(select value->>'id' from s5c_context where key='asset-B'))||jsonb_build_object('event_id',(select id from public.equipment_fulfillment_events where request_id=pg_temp.s5c_request('chain-abc') and operation='handover'))));
select is((select operational_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5c_context where key='asset-A')),'ready','A is restored to ready after C1');
select is((select operational_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5c_context where key='asset-B')),'in_use','B is in_use after C1');

-- Step 3: C2 corrects C1 to Asset C
with c1 as (select (value->>'event_id')::uuid as id from s5c_context where key='c1-abc')
select lives_ok(format($$select pg_temp.s5c_command('chain-abc','correct',pg_temp.s5c_issue_payload('chain-abc','map-abc',41,(select value->>'id' from s5c_context where key='asset-C'))||jsonb_build_object('event_id','%s'))$$,(select id from c1)),'C2 successfully corrects C1 without restoring predecessor A');
select is((select operational_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5c_context where key='asset-A')),'ready','A remains ready (compensation-only in C1, untouched by C2)');
select is((select operational_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5c_context where key='asset-B')),'ready','B is restored to ready by C2');
select is((select operational_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5c_context where key='asset-C')),'in_use','C is in_use after C2');

-- Check net issue identity for request: exactly 1 active slice for asset C, slices for A and B net to 0
reset role;
grant execute on function private.s5_obligation(uuid) to authenticated;
set local role authenticated;
select pg_temp.s5c_actor(3);
select is((select count(*) from public.equipment_issue_slices s cross join lateral private.s5_obligation(s.id) o join public.equipment_fulfillment_events e on e.id=s.event_id where e.request_id=pg_temp.s5c_request('chain-abc') and o.issued>0),1::bigint,'Exactly one net positive issue slice remains');
select is((select s.asset_id from public.equipment_issue_slices s cross join lateral private.s5_obligation(s.id) o join public.equipment_fulfillment_events e on e.id=s.event_id where e.request_id=pg_temp.s5c_request('chain-abc') and o.issued>0),(select(value->>'id')::uuid from s5c_context where key='asset-C'),'Net positive issue slice is for Asset C');

--------------------------------------------------------------------------------
-- Scenario 2: Same-asset H -> C1 -> C2 correction chain
--------------------------------------------------------------------------------
-- Initial handover with Asset D
select pg_temp.s5c_command('chain-same','handover',pg_temp.s5c_issue_payload('chain-same','map-same',41,(select value->>'id' from s5c_context where key='asset-D')));
select is((select operational_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5c_context where key='asset-D')),'in_use','D is in_use after handover');

-- C1 corrects handover with same Asset D (e.g. metadata or reason correction)
insert into s5c_context values('c1-same',pg_temp.s5c_command('chain-same','correct',pg_temp.s5c_issue_payload('chain-same','map-same',41,(select value->>'id' from s5c_context where key='asset-D'))||jsonb_build_object('event_id',(select id from public.equipment_fulfillment_events where request_id=pg_temp.s5c_request('chain-same') and operation='handover'))));
select is((select operational_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5c_context where key='asset-D')),'in_use','D remains in_use after same-asset C1');

-- C2 corrects C1 with same Asset D
with c1 as (select (value->>'event_id')::uuid as id from s5c_context where key='c1-same')
select lives_ok(format($$select pg_temp.s5c_command('chain-same','correct',pg_temp.s5c_issue_payload('chain-same','map-same',41,(select value->>'id' from s5c_context where key='asset-D'))||jsonb_build_object('event_id','%s'))$$,(select id from c1)),'C2 executes cleanly for same-asset chain');

select is((select operational_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5c_context where key='asset-D')),'in_use','D is still in_use after C2');

--------------------------------------------------------------------------------
-- Scenario 3: Initial return receipt correction chain
--------------------------------------------------------------------------------
select pg_temp.s5c_command('chain-abc','initial_return',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('issue_slice_id',(select s.id from public.equipment_issue_slices s cross join lateral private.s5_obligation(s.id) o join public.equipment_fulfillment_events e on e.id=s.event_id where e.request_id=pg_temp.s5c_request('chain-abc') and o.issued>0),'location_id',pg_temp.s5c_id(42),'quantity','1','condition','damaged'))));

select is((select operational_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5c_context where key='asset-C')),'damaged','C is damaged after damaged return');

-- Correct return from damaged to good (C1)
insert into s5c_context values('c1-ret',pg_temp.s5c_command('chain-abc','correct',jsonb_build_object('event_id',(select id from public.equipment_fulfillment_events where request_id=pg_temp.s5c_request('chain-abc') and operation='initial_return'),'lines',jsonb_build_array(jsonb_build_object('issue_slice_id',(select s.id from public.equipment_issue_slices s cross join lateral private.s5_obligation(s.id) o join public.equipment_fulfillment_events e on e.id=s.event_id where e.request_id=pg_temp.s5c_request('chain-abc') and o.issued>0),'location_id',pg_temp.s5c_id(42),'quantity','1','condition','good')))));

select is((select operational_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5c_context where key='asset-C')),'ready','C is ready after C1 corrected to good');

-- Correct C1 return back to damaged (C2)
with c1 as (select (value->>'event_id')::uuid as id from s5c_context where key='c1-ret')
select lives_ok(format($$select pg_temp.s5c_command('chain-abc','correct',jsonb_build_object('event_id','%s','lines',jsonb_build_array(jsonb_build_object('issue_slice_id',(select s.id from public.equipment_issue_slices s cross join lateral private.s5_obligation(s.id) o join public.equipment_fulfillment_events e on e.id=s.event_id where e.request_id=pg_temp.s5c_request('chain-abc') and o.issued>0),'location_id',pg_temp.s5c_id(42),'quantity','1','condition','damaged'))))$$,(select id from c1)),'Receipt C2 executes cleanly');

select is((select operational_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5c_context where key='asset-C')),'damaged','C is damaged after C2');

--------------------------------------------------------------------------------
-- Scenario 4: Admin consequence correction chain + history erasure guard
--------------------------------------------------------------------------------
-- Admin consequence on chain-admin
select pg_temp.s5c_command('chain-admin','handover',pg_temp.s5c_issue_payload('chain-admin','map-admin',41,(select value->>'id' from s5c_context where key='asset-F')));
select pg_temp.s5c_command('chain-admin','initial_return','{"lines":[]}');
select pg_temp.s5c_command('chain-admin','resolve',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('issue_slice_id',(select s.id from public.equipment_issue_slices s join public.equipment_fulfillment_events e on e.id=s.event_id where e.request_id=pg_temp.s5c_request('chain-admin') and e.operation='handover'),'quantity','1','classification','missing'))));

select pg_temp.s5c_actor(1);
select pg_temp.s5c_command('chain-admin','consequence',jsonb_build_object('issue_slice_id',(select s.id from public.equipment_issue_slices s join public.equipment_fulfillment_events e on e.id=s.event_id where e.request_id=pg_temp.s5c_request('chain-admin') and e.operation='handover'),'quantity','1','classification','retired','evidence','Initial retirement'));
select is((select lifecycle_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5c_context where key='asset-F')),'retired','F is retired');

-- C1 corrects consequence to disposed
insert into s5c_context values('c1-adm',pg_temp.s5c_command('chain-admin','correct',jsonb_build_object('event_id',(select id from public.equipment_fulfillment_events where request_id=pg_temp.s5c_request('chain-admin') and operation='consequence'),'issue_slice_id',(select s.id from public.equipment_issue_slices s join public.equipment_fulfillment_events e on e.id=s.event_id where e.request_id=pg_temp.s5c_request('chain-admin') and e.operation='handover'),'quantity','1','classification','disposed','evidence','Disposed instead of retired')));
select is((select lifecycle_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5c_context where key='asset-F')),'disposed','F is disposed after C1');

-- Disposed ordinary reactivation forbidden (C2 cannot reactivate disposed asset)
with c1 as (select (value->>'event_id')::uuid as id from s5c_context where key='c1-adm')
select throws_ok(format($$select pg_temp.s5c_command('chain-admin','correct',jsonb_build_object('event_id','%s','issue_slice_id',(select s.id from public.equipment_issue_slices s join public.equipment_fulfillment_events e on e.id=s.event_id where e.request_id=pg_temp.s5c_request('chain-admin') and e.operation='handover'),'quantity','1','classification','settled','evidence','Attempt reactivation'))$$,(select id from c1)),'P0001','DISPOSED_REACTIVATION_FORBIDDEN','Disposed asset cannot be reactivated via ordinary correction');

select * from finish();
rollback;
