-- Synthetic S5 behavior regression; identities and every physical fact roll back.
begin;
select no_plan();

create function pg_temp.s5f_id(n integer) returns uuid language sql immutable as $$
  select ('e5100000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select pg_temp.s5f_id(n),'s5-fulfillment-'||n||'@campus.local','{"preapproved":true}'::jsonb,
  jsonb_build_object('full_name','S5 fulfillment actor '||n) from generate_series(1,4) n;
insert into public.profiles(id,email,full_name,phone,is_active)
select pg_temp.s5f_id(n),'s5-fulfillment-'||n||'@campus.local','S5 fulfillment actor '||n,'0901234567',true
from generate_series(1,4) n on conflict(id) do update set phone=excluded.phone,is_active=true;
insert into public.user_roles(user_id,role) values
(pg_temp.s5f_id(1),'admin'),(pg_temp.s5f_id(2),'lecturer'),
(pg_temp.s5f_id(3),'staff'),(pg_temp.s5f_id(4),'staff');
insert into public.profile_room_types(profile_id,room_type_id)
values
(pg_temp.s5f_id(2),'40000000-0000-0000-0000-000000000001'),
(pg_temp.s5f_id(3),'40000000-0000-0000-0000-000000000001') on conflict do nothing;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.s5f_id(1),'role','authenticated')::text,true);
insert into public.rooms(id,room_code,building_code,room_type_id)
values(pg_temp.s5f_id(10),'S5F_TEST','S5F_TEST','40000000-0000-0000-0000-000000000001');
insert into public.class_schedules(id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,schedule_date,start_time,end_time,semester,created_by)
select pg_temp.s5f_id(n),'S5F-'||n,'S5 fulfillment fixture',pg_temp.s5f_id(10),pg_temp.s5f_id(2),current_date+30+n,'09:00','11:00','HK1',pg_temp.s5f_id(1)
from generate_series(11,16) n;
insert into public.equipment_catalog(id,item_name,commercial_name,unit) values
(pg_temp.s5f_id(20),'S5F liquid','S5F liquid demand','liều'),
(pg_temp.s5f_id(21),'S5F asset','S5F asset demand','cái'),
(pg_temp.s5f_id(22),'S5F extra','S5F independent addition','cái'),
(pg_temp.s5f_id(23),'S5F proposal','S5F pending addition','cái'),
(pg_temp.s5f_id(24),'S5F rational','S5F rational demand','bộ');
insert into public.inventory_categories(id,code,name) values(pg_temp.s5f_id(30),'S5F-CAT','S5 fulfillment fixture');
insert into public.inventory_uoms(code,name,dimension,allowed_scale) values
('s5f_ml','S5F millilitre','volume',6),('s5f_count','S5F count','count',0);
insert into public.inventory_catalog_items(id,code,name,category_id,material_kind,base_uom_code,tracking_strategy,return_semantics,expiry_required) values
(pg_temp.s5f_id(31),'S5F-LIQUID','S5F liquid',pg_temp.s5f_id(30),'other','s5f_ml','quantity','nonreturnable',false),
(pg_temp.s5f_id(32),'S5F-ASSET','S5F asset',pg_temp.s5f_id(30),'other','s5f_count','serialized','returnable',true),
(pg_temp.s5f_id(33),'S5F-RATIONAL','S5F rational stock',pg_temp.s5f_id(30),'other','s5f_count','quantity','returnable',false);
insert into public.inventory_storage_locations(id,code,name) values
(pg_temp.s5f_id(41),'S5F-A','S5F source A'),(pg_temp.s5f_id(42),'S5F-B','S5F source B'),(pg_temp.s5f_id(43),'S5F-C','S5F replacement');
create temporary table s5f_context(key text primary key,value jsonb);
grant all on s5f_context to authenticated;
set local role authenticated;
create function pg_temp.s5f_actor(n integer) returns text language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.s5f_id(n),'role','authenticated')::text,true)
$$;
create function pg_temp.s5f_request(k text) returns uuid language sql as $$select (value#>>'{}')::uuid from s5f_context where key=k$$;
create function pg_temp.s5f_command(k text,op text,payload jsonb default '{}') returns jsonb language sql as $$
 select public.equipment_preparation_command(op,pg_temp.s5f_request(k),jsonb_build_object('expected_revision',
 (select preparation_revision from public.equipment_requests where id=pg_temp.s5f_request(k)))||payload,gen_random_uuid())
$$;
create function pg_temp.s5f_line(k text) returns uuid language sql as $$
 select id from public.equipment_request_items where request_id=pg_temp.s5f_request(k) and catalog_item_id in (pg_temp.s5f_id(20),pg_temp.s5f_id(21),pg_temp.s5f_id(24))
$$;
create function pg_temp.s5f_reserved(k text) returns numeric language sql as $$
 select coalesce(sum(rs.quantity),0) from public.inventory_reservations rs join public.equipment_preparations p on p.id=rs.preparation_id
 where p.request_id=pg_temp.s5f_request(k) and rs.released_at is null
$$;
create function pg_temp.s5f_alloc(mapping text,loc integer,q text,assets jsonb default '[]') returns jsonb language sql as $$
 select jsonb_build_object('mapping_id',value->>'mapping_id','location_id',pg_temp.s5f_id(loc),'base_quantity',q,'asset_ids',assets)
 from s5f_context where key=mapping
$$;
create function pg_temp.s5f_plan(k text,q text,allocations jsonb) returns jsonb language sql as $$
 select jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',id,'planned_quantity',q,
 'reviewed_revision',line_revision,'shortage_reason','Reviewed exact target','allocations',allocations)))
 from public.equipment_request_items where id=pg_temp.s5f_line(k)
$$;
create function pg_temp.s5f_confirm(k text,plan jsonb) returns jsonb language sql as $$
 select pg_temp.s5f_command(k,'confirm',jsonb_build_object('lock_token',pg_temp.s5f_id(90),'draft_revision',
 (select revision from public.equipment_preparations where request_id=pg_temp.s5f_request(k) and state='draft'),'plan',plan))
$$;
create function pg_temp.s5f_available(k text,loc integer) returns numeric language plpgsql as $$
declare page_number integer:=1; stock_rows jsonb; available numeric;
begin
 loop
  stock_rows:=public.equipment_preparation_read(pg_temp.s5f_request(k),'stock',
   jsonb_build_object('catalog_item_id',pg_temp.s5f_id(20),'page',page_number))->'rows';
  select (x->>'available_quantity')::numeric into available
   from jsonb_array_elements(stock_rows) x where x->>'location_id'=pg_temp.s5f_id(loc)::text;
  if found then return available; end if;
  if jsonb_array_length(stock_rows)<100 then
   raise exception 'Fixture stock location % missing from projection',loc;
  end if;
  page_number:=page_number+1;
 end loop;
end;
$$;

-- Physical opening is posted through the same Admin RPC as the inventory UI.
insert into s5f_context values('opening',public.inventory_command('confirm_opening_balance',jsonb_build_object(
 'synthetic',true,'cutover_key','S5F-OPENING','scope_description','S5 fulfillment fixture','count_cutoff',now(),'provenance_note','Synthetic acceptance stock',
 'lines',jsonb_build_array(
 jsonb_build_object('line_key','A','provenance_group','A','catalog_item_id',pg_temp.s5f_id(31),'location_id',pg_temp.s5f_id(41),'good_quantity','0.300000','damaged_quantity','0','expiry_precision','not_required'),
 jsonb_build_object('line_key','B','provenance_group','B','catalog_item_id',pg_temp.s5f_id(31),'location_id',pg_temp.s5f_id(42),'good_quantity','0.500000','damaged_quantity','0','expiry_precision','not_required'),
 jsonb_build_object('line_key','C','provenance_group','C','catalog_item_id',pg_temp.s5f_id(31),'location_id',pg_temp.s5f_id(43),'good_quantity','0.800000','damaged_quantity','0','expiry_precision','not_required'),
 jsonb_build_object('line_key','R','provenance_group','R','catalog_item_id',pg_temp.s5f_id(33),'location_id',pg_temp.s5f_id(43),'good_quantity','3','damaged_quantity','0','expiry_precision','not_required'))),gen_random_uuid()));
insert into s5f_context values('asset',public.equipment_asset_command('open_asset',jsonb_build_object(
 'catalog_item_id',pg_temp.s5f_id(32),'location_id',pg_temp.s5f_id(41),'intake_reference','S5F-ASSET-OPEN','row_key','1',
 'expiry_precision','day','expiry_input',(current_date+365)::text,'reason','Synthetic opening','evidence_note','S5F acceptance'),gen_random_uuid()));
select public.equipment_asset_command('set_asset_lifecycle',jsonb_build_object('id',(select value->>'id' from s5f_context where key='asset'),
 'expected_revision',1,'lifecycle_status','in_service','reason','Commission fixture','evidence_note','S5F acceptance'),gen_random_uuid());
insert into s5f_context
select k,to_jsonb(public.create_equipment_request_with_items(pg_temp.s5f_id(schedule),'HK1',pg_temp.s5f_id(2),
 ((current_date+30+schedule)::text||' 09:00+07')::timestamptz,((current_date+30+schedule)::text||' 11:00+07')::timestamptz,null,null,
 jsonb_build_array(jsonb_build_object('skill_name','S5F Skill','catalog_item_id',pg_temp.s5f_id(catalog),'quantity',q::text))))
from (values('quantity',11,20,8),('competitor',12,20,8),('asset-owner',13,21,1),('asset-competitor',14,21,1),('additions',15,20,1),('rational',16,24,1)) fixtures(k,schedule,catalog,q);
insert into s5f_context values
('liquid-map',pg_temp.s5f_command('quantity','map_item',jsonb_build_object('catalog_item_id',pg_temp.s5f_id(20),'inventory_item_id',pg_temp.s5f_id(31),'base_units_per_requested_unit','0.100000','reason','Explicit demand conversion'))),
('asset-map',pg_temp.s5f_command('asset-owner','map_item',jsonb_build_object('catalog_item_id',pg_temp.s5f_id(21),'inventory_item_id',pg_temp.s5f_id(32),'base_units_per_requested_unit','1','reason','Explicit exact asset mapping'))),
('rational-map',pg_temp.s5f_command('rational','map_item',jsonb_build_object('catalog_item_id',pg_temp.s5f_id(24),'inventory_item_id',pg_temp.s5f_id(33),'base_units_per_requested_unit','3.000000','reason','Three base units per requested set')));


create function pg_temp.s5_command(k text,op text,payload jsonb default '{}') returns jsonb language sql as $$
 select public.equipment_fulfillment_command(op,pg_temp.s5f_request(k),jsonb_build_object('expected_revision',
 (select fulfillment_revision from public.equipment_requests where id=pg_temp.s5f_request(k)),'business_key',gen_random_uuid(),'reason','Synthetic physical fact')||payload,gen_random_uuid())
$$;
create function pg_temp.s5_issue(k text,m text,loc integer,q text,assets jsonb default '[]') returns jsonb language sql as $$
 select jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',pg_temp.s5f_line(k),'mapping_id',value->>'mapping_id','location_id',pg_temp.s5f_id(loc),'quantity',q,'asset_ids',assets))) from s5f_context where key=m
$$;
create function pg_temp.s5_slice(k text) returns uuid language sql as $$
 select s.id from public.equipment_issue_slices s join public.equipment_fulfillment_events e on e.id=s.event_id where e.request_id=pg_temp.s5f_request(k) order by e.revision limit 1
$$;
create function pg_temp.s5_receipt(k text,q text,condition text default 'good') returns jsonb language sql as $$
 select jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('issue_slice_id',pg_temp.s5_slice(k),'location_id',pg_temp.s5f_id(42),'quantity',q,'condition',condition)))
$$;
create function pg_temp.s5_sign(k text) returns void language plpgsql as $$
declare e jsonb;
begin
 for e in select value from jsonb_array_elements(public.equipment_fulfillment_read(pg_temp.s5f_request(k))->'events') where (value->>'signature_required')::boolean and not(value->>'superseded')::boolean and value->'signature'='null'::jsonb loop
  perform pg_temp.s5_command(k,'sign',jsonb_build_object('event_id',e->>'id','snapshot_hash',e->>'snapshot_hash','signature','data:image/png;base64,'||repeat('A',100)));
 end loop;
end; $$;

select pg_temp.s5f_command('quantity','start',jsonb_build_object('lock_token',pg_temp.s5f_id(90)));
select pg_temp.s5f_confirm('quantity',pg_temp.s5f_plan('quantity','8',jsonb_build_array(pg_temp.s5f_alloc('liquid-map',41,'0.3'),pg_temp.s5f_alloc('liquid-map',42,'0.5'))));
select lives_ok($$select pg_temp.s5_command('quantity','handover',pg_temp.s5_issue('quantity','liquid-map',41,'0.2'))$$,'actual below planned posts before signature');
select is((select quantity from public.inventory_stock_balances where location_id=pg_temp.s5f_id(41)),0.1::numeric,'physical stock debited immediately');
select is(pg_temp.s5f_reserved('quantity'),0::numeric,'unused preparation backing released at actual handover');
select is((select status from public.equipment_requests where id=pg_temp.s5f_request('quantity')),'handed_over','signature pending does not keep stock in warehouse');
select pg_temp.s5f_actor(3);
select lives_ok($$select pg_temp.s5_command('quantity','supplement',pg_temp.s5_issue('quantity','liquid-map',43,'0.8'))$$,'scoped Staff supplements above planned under INV-058');
select pg_temp.s5f_actor(4);
select throws_ok($$select pg_temp.s5_command('quantity','supplement',pg_temp.s5_issue('quantity','liquid-map',41,'0.1'))$$,'42501','AUTH_DENIED','out-of-scope Staff cannot issue');
select pg_temp.s5f_actor(2);
select lives_ok($$select pg_temp.s5_sign('quantity')$$,'recipient signs exact handover and supplemental snapshots');
select is((select status from public.equipment_requests where id=pg_temp.s5f_request('quantity')),'handed_over','consumable-only cannot complete without initial return');
select pg_temp.s5f_actor(1);
select lives_ok($$select pg_temp.s5_command('quantity','initial_return','{"lines":[]}')$$,'consumable-only records initial return without fake stock receipt');
select is((select status from public.equipment_requests where id=pg_temp.s5f_request('quantity')),'returned','pending initial return signature blocks completion even with zero due');
select pg_temp.s5f_actor(2);
select pg_temp.s5_sign('quantity');
select is((select status from public.equipment_requests where id=pg_temp.s5f_request('quantity')),'completed','consumable-only completes with all event-bound signatures');

select pg_temp.s5f_actor(1);
select pg_temp.s5f_command('rational','start',jsonb_build_object('lock_token',pg_temp.s5f_id(90)));
select pg_temp.s5f_confirm('rational',pg_temp.s5f_plan('rational','1',jsonb_build_array(pg_temp.s5f_alloc('rational-map',43,'3'))));
select pg_temp.s5_command('rational','handover',pg_temp.s5_issue('rational','rational-map',43,'3'));
select pg_temp.s5_command('rational','initial_return',pg_temp.s5_receipt('rational','1','damaged'));
select is(public.equipment_fulfillment_read(pg_temp.s5f_request('rational'))#>>'{issues,0,due}','2.000000','damaged physical return reduces due');
select pg_temp.s5f_actor(3);
select pg_temp.s5_command('rational','resolve',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('issue_slice_id',pg_temp.s5_slice('rational'),'quantity','2','classification','waived'))));
select is((select quantity from public.inventory_stock_balances where location_id=pg_temp.s5f_id(42) and condition='damaged'),1::numeric,'Staff waiver has zero warehouse delta');
select pg_temp.s5f_actor(2);
select pg_temp.s5_sign('rational');
select is((select status from public.equipment_requests where id=pg_temp.s5f_request('rational')),'completed','reasoned resolution closes due but only signatures complete workflow');
select pg_temp.s5f_actor(3);
select pg_temp.s5_command('rational','recover',pg_temp.s5_receipt('rational','1'));
select is(public.equipment_fulfillment_read(pg_temp.s5f_request('rational'))#>>'{issues,0,resolved}','1.000000','late physical receipt atomically offsets waiver');
select pg_temp.s5_command('rational','recover',pg_temp.s5_receipt('rational','1'));
select is(public.equipment_fulfillment_read(pg_temp.s5f_request('rational'))#>>'{issues,0,returned}','2.000000','repeated cumulative recovery does not duplicate receipt');
select is((select status from public.equipment_requests where id=pg_temp.s5f_request('rational')),'completed','ordinary late receipt does not reopen whole request');
select throws_ok($$select pg_temp.s5_command('rational','recover',pg_temp.s5_receipt('rational','0'))$$,'P0001','S5_CUMULATIVE_DECREASE_REQUIRES_CORRECTION','decreased cumulative quantity requires immutable correction');

select pg_temp.s5f_actor(1);
select pg_temp.s5f_command('asset-owner','start',jsonb_build_object('lock_token',pg_temp.s5f_id(90)));
select pg_temp.s5f_confirm('asset-owner',pg_temp.s5f_plan('asset-owner','1',jsonb_build_array(pg_temp.s5f_alloc('asset-map',41,'1',jsonb_build_array((select value->>'id' from s5f_context where key='asset'))))));
select pg_temp.s5_command('asset-owner','handover',pg_temp.s5_issue('asset-owner','asset-map',41,'1',jsonb_build_array((select value->>'id' from s5f_context where key='asset'))));
select is((select operational_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5f_context where key='asset')),'in_use','serialized physical handover sets current custody state');
select pg_temp.s5_command('asset-owner','initial_return','{"lines":[]}');
select pg_temp.s5_command('asset-owner','resolve',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('issue_slice_id',pg_temp.s5_slice('asset-owner'),'quantity','1','classification','missing'))));
select pg_temp.s5_command('asset-owner','consequence',jsonb_build_object('issue_slice_id',pg_temp.s5_slice('asset-owner'),'quantity','1','classification','retired','evidence','Admin reviewed missing asset'));
select lives_ok($$select pg_temp.s5_command('asset-owner','correct',jsonb_build_object('event_id',(select id from public.equipment_fulfillment_events where request_id=pg_temp.s5f_request('asset-owner') and operation='consequence'),'issue_slice_id',pg_temp.s5_slice('asset-owner'),'quantity','1','classification','retired','evidence','Corrected administrative evidence'))$$,'Admin consequence correction dispatches the original consequence operation');
select pg_temp.s5f_actor(3);
select pg_temp.s5_command('asset-owner','recover',pg_temp.s5_receipt('asset-owner','1'));
select is(public.equipment_fulfillment_read(pg_temp.s5f_request('asset-owner'))#>>'{issues,0,held}','1.000000','late retired-asset intake creates reconciliation hold');
select throws_ok($$select pg_temp.s5_command('asset-owner','reconcile',jsonb_build_object('issue_slice_id',pg_temp.s5_slice('asset-owner'),'quantity','1','classification','restore_eligible','evidence','Attempt'))$$,'42501','AUTH_DENIED','Staff cannot release administrative hold');
select pg_temp.s5f_actor(1);
select pg_temp.s5_command('asset-owner','reconcile',jsonb_build_object('issue_slice_id',pg_temp.s5_slice('asset-owner'),'quantity','1','classification','restore_eligible','evidence','Admin reviewed full immutable history'));
select is((select lifecycle_status from public.equipment_assets where id=(select(value->>'id')::uuid from s5f_context where key='asset')),'in_service','Admin explicitly reactivates retired returned asset');
select is(public.equipment_fulfillment_read(pg_temp.s5f_request('asset-owner'))#>>'{issues,0,held}','0.000000','Admin reconciliation appends hold offset');
select throws_ok($$delete from public.equipment_fulfillment_events where request_id=pg_temp.s5f_request('asset-owner')$$,'42501',null,'direct history deletion is denied');

-- Correction must preserve signed originals and post only net replacement facts.
insert into s5f_context values('signed-initial-return',(select to_jsonb(e) from public.equipment_fulfillment_events e where request_id=pg_temp.s5f_request('rational') and operation='initial_return'));
select lives_ok($$select pg_temp.s5_command('rational','correct',pg_temp.s5_receipt('rational','1','good')||jsonb_build_object('event_id',(select value->>'id' from s5f_context where key='signed-initial-return')))$$,'signed damaged receipt can be corrected to good by linked replacement');
select is((select count(*) from public.equipment_fulfillment_signatures where event_id=(select(value->>'id')::uuid from s5f_context where key='signed-initial-return')),1::bigint,'correction preserves original recipient evidence');
select is((select status from public.equipment_requests where id=pg_temp.s5f_request('rational')),'returned','replacement initial-return evidence needs new signature');
select pg_temp.s5f_actor(2);
select pg_temp.s5_sign('rational');
select is((select status from public.equipment_requests where id=pg_temp.s5f_request('rational')),'completed','corrected return completes after exact replacement signature');
select pg_temp.s5f_actor(1);
select lives_ok($$select pg_temp.s5_command('asset-owner','correct',jsonb_build_object('event_id',(select id from public.equipment_fulfillment_events where request_id=pg_temp.s5f_request('asset-owner') and operation='reconcile'),'issue_slice_id',pg_temp.s5_slice('asset-owner'),'quantity','1','classification','retain_ineligible','evidence','Correct reconciliation decision'))$$,'Admin can correct reconciliation without rewriting prior history');
select throws_ok($$select pg_temp.s5_command('quantity','supplement',pg_temp.s5_issue('quantity','liquid-map',41,'0.1'))$$,'P0001','S5_SUPPLEMENT_BEFORE_INITIAL_RETURN_REQUIRED','completed/returned request cannot gain new supplemental obligations');
select * from finish();
rollback;
