-- Synthetic S5 behavior regression; identities and every physical fact roll back.
begin;
select no_plan();

create function pg_temp.s5x_id(n integer) returns uuid language sql immutable as $$
  select ('e5400000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select pg_temp.s5x_id(n),'s5-resolution-'||n||'@campus.local','{"preapproved":true}'::jsonb,
  jsonb_build_object('full_name','S5 fulfillment actor '||n) from generate_series(1,4) n;
insert into public.profiles(id,email,full_name,phone,is_active)
select pg_temp.s5x_id(n),'s5-resolution-'||n||'@campus.local','S5 fulfillment actor '||n,'0901234567',true
from generate_series(1,4) n on conflict(id) do update set phone=excluded.phone,is_active=true;
insert into public.user_roles(user_id,role) values
(pg_temp.s5x_id(1),'admin'),(pg_temp.s5x_id(2),'lecturer'),
(pg_temp.s5x_id(3),'staff'),(pg_temp.s5x_id(4),'staff');
insert into public.profile_room_types(profile_id,room_type_id)
values
(pg_temp.s5x_id(2),'40000000-0000-0000-0000-000000000001'),
(pg_temp.s5x_id(3),'40000000-0000-0000-0000-000000000001') on conflict do nothing;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.s5x_id(1),'role','authenticated')::text,true);
insert into public.rooms(id,room_code,building_code,room_type_id)
values(pg_temp.s5x_id(10),'S5X_TEST','S5X_TEST','40000000-0000-0000-0000-000000000001');
insert into public.class_schedules(id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,schedule_date,start_time,end_time,semester,created_by)
select pg_temp.s5x_id(n),'S5X-'||n,'S5 fulfillment fixture',pg_temp.s5x_id(10),pg_temp.s5x_id(2),current_date+30+n,'09:00','11:00','HK1',pg_temp.s5x_id(1)
from generate_series(11,16) n;
insert into public.equipment_catalog(id,item_name,commercial_name,unit) values
(pg_temp.s5x_id(20),'S5X liquid','S5X liquid demand','liều'),
(pg_temp.s5x_id(21),'S5X asset','S5X asset demand','cái'),
(pg_temp.s5x_id(22),'S5X extra','S5X independent addition','cái'),
(pg_temp.s5x_id(23),'S5X proposal','S5X pending addition','cái'),
(pg_temp.s5x_id(24),'S5X rational','S5X rational demand','bộ');
insert into public.inventory_categories(id,code,name) values(pg_temp.s5x_id(30),'S5X-CAT','S5 fulfillment fixture');
insert into public.inventory_uoms(code,name,dimension,allowed_scale) values
('s5x_ml','S5X millilitre','volume',6),('s5x_count','S5X count','count',0);
insert into public.inventory_catalog_items(id,code,name,category_id,material_kind,base_uom_code,tracking_strategy,return_semantics,expiry_required) values
(pg_temp.s5x_id(31),'S5X-LIQUID','S5X liquid',pg_temp.s5x_id(30),'other','s5x_ml','quantity','nonreturnable',false),
(pg_temp.s5x_id(32),'S5X-ASSET','S5X asset',pg_temp.s5x_id(30),'other','s5x_count','serialized','returnable',true),
(pg_temp.s5x_id(33),'S5X-RATIONAL','S5X rational stock',pg_temp.s5x_id(30),'other','s5x_count','quantity','returnable',false);
insert into public.inventory_storage_locations(id,code,name) values
(pg_temp.s5x_id(41),'S5X-A','S5X source A'),(pg_temp.s5x_id(42),'S5X-B','S5X source B'),(pg_temp.s5x_id(43),'S5X-C','S5X replacement');
create temporary table s5x_context(key text primary key,value jsonb);
grant all on s5x_context to authenticated;
set local role authenticated;
create function pg_temp.s5x_actor(n integer) returns text language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.s5x_id(n),'role','authenticated')::text,true)
$$;
create function pg_temp.s5x_request(k text) returns uuid language sql as $$select (value#>>'{}')::uuid from s5x_context where key=k$$;
create function pg_temp.s5x_command(k text,op text,payload jsonb default '{}') returns jsonb language sql as $$
 select public.equipment_preparation_command(op,pg_temp.s5x_request(k),jsonb_build_object('expected_revision',
 (select preparation_revision from public.equipment_requests where id=pg_temp.s5x_request(k)))||payload,gen_random_uuid())
$$;
create function pg_temp.s5x_line(k text) returns uuid language sql as $$
 select id from public.equipment_request_items where request_id=pg_temp.s5x_request(k) and catalog_item_id in (pg_temp.s5x_id(20),pg_temp.s5x_id(21),pg_temp.s5x_id(24))
$$;
create function pg_temp.s5x_reserved(k text) returns numeric language sql as $$
 select coalesce(sum(rs.quantity),0) from public.inventory_reservations rs join public.equipment_preparations p on p.id=rs.preparation_id
 where p.request_id=pg_temp.s5x_request(k) and rs.released_at is null
$$;
create function pg_temp.s5x_alloc(mapping text,loc integer,q text,assets jsonb default '[]') returns jsonb language sql as $$
 select jsonb_build_object('mapping_id',value->>'mapping_id','location_id',pg_temp.s5x_id(loc),'base_quantity',q,'asset_ids',assets)
 from s5x_context where key=mapping
$$;
create function pg_temp.s5x_plan(k text,q text,allocations jsonb) returns jsonb language sql as $$
 select jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',id,'planned_quantity',q,
 'reviewed_revision',line_revision,'shortage_reason','Reviewed exact target','allocations',allocations)))
 from public.equipment_request_items where id=pg_temp.s5x_line(k)
$$;
create function pg_temp.s5x_confirm(k text,plan jsonb) returns jsonb language sql as $$
 select pg_temp.s5x_command(k,'confirm',jsonb_build_object('lock_token',pg_temp.s5x_id(90),'draft_revision',
 (select revision from public.equipment_preparations where request_id=pg_temp.s5x_request(k) and state='draft'),'plan',plan))
$$;
create function pg_temp.s5x_available(k text,loc integer) returns numeric language plpgsql as $$
declare page_number integer:=1; stock_rows jsonb; available numeric;
begin
 loop
  stock_rows:=public.equipment_preparation_read(pg_temp.s5x_request(k),'stock',
   jsonb_build_object('catalog_item_id',pg_temp.s5x_id(20),'page',page_number))->'rows';
  select (x->>'available_quantity')::numeric into available
   from jsonb_array_elements(stock_rows) x where x->>'location_id'=pg_temp.s5x_id(loc)::text;
  if found then return available; end if;
  if jsonb_array_length(stock_rows)<100 then
   raise exception 'Fixture stock location % missing from projection',loc;
  end if;
  page_number:=page_number+1;
 end loop;
end;
$$;

-- Physical opening is posted through the same Admin RPC as the inventory UI.
insert into s5x_context values('opening',public.inventory_command('confirm_opening_balance',jsonb_build_object(
 'synthetic',true,'cutover_key','S5X-OPENING','scope_description','S5 fulfillment fixture','count_cutoff',now(),'provenance_note','Synthetic acceptance stock',
 'lines',jsonb_build_array(
 jsonb_build_object('line_key','A','provenance_group','A','catalog_item_id',pg_temp.s5x_id(31),'location_id',pg_temp.s5x_id(41),'good_quantity','0.300000','damaged_quantity','0','expiry_precision','not_required'),
 jsonb_build_object('line_key','B','provenance_group','B','catalog_item_id',pg_temp.s5x_id(31),'location_id',pg_temp.s5x_id(42),'good_quantity','0.500000','damaged_quantity','0','expiry_precision','not_required'),
 jsonb_build_object('line_key','C','provenance_group','C','catalog_item_id',pg_temp.s5x_id(31),'location_id',pg_temp.s5x_id(43),'good_quantity','0.800000','damaged_quantity','0','expiry_precision','not_required'),
 jsonb_build_object('line_key','R','provenance_group','R','catalog_item_id',pg_temp.s5x_id(33),'location_id',pg_temp.s5x_id(43),'good_quantity','3','damaged_quantity','0','expiry_precision','not_required'))),gen_random_uuid()));
insert into s5x_context values('asset',public.equipment_asset_command('open_asset',jsonb_build_object(
 'catalog_item_id',pg_temp.s5x_id(32),'location_id',pg_temp.s5x_id(41),'intake_reference','S5X-ASSET-OPEN','row_key','1',
 'expiry_precision','day','expiry_input',(current_date+365)::text,'reason','Synthetic opening','evidence_note','S5X acceptance'),gen_random_uuid()));
select public.equipment_asset_command('set_asset_lifecycle',jsonb_build_object('id',(select value->>'id' from s5x_context where key='asset'),
 'expected_revision',1,'lifecycle_status','in_service','reason','Commission fixture','evidence_note','S5X acceptance'),gen_random_uuid());
insert into s5x_context
select k,to_jsonb(public.create_equipment_request_with_items(pg_temp.s5x_id(schedule),'HK1',pg_temp.s5x_id(2),
 ((current_date+30+schedule)::text||' 09:00+07')::timestamptz,((current_date+30+schedule)::text||' 11:00+07')::timestamptz,null,null,
 jsonb_build_array(jsonb_build_object('skill_name','S5X Skill','catalog_item_id',pg_temp.s5x_id(catalog),'quantity',q::text))))
from (values('quantity',11,20,8),('competitor',12,20,8),('asset-owner',13,21,1),('asset-competitor',14,21,1),('additions',15,20,1),('rational',16,24,1)) fixtures(k,schedule,catalog,q);
insert into s5x_context values
('liquid-map',pg_temp.s5x_command('quantity','map_item',jsonb_build_object('catalog_item_id',pg_temp.s5x_id(20),'inventory_item_id',pg_temp.s5x_id(31),'base_units_per_requested_unit','0.100000','reason','Explicit demand conversion'))),
('asset-map',pg_temp.s5x_command('asset-owner','map_item',jsonb_build_object('catalog_item_id',pg_temp.s5x_id(21),'inventory_item_id',pg_temp.s5x_id(32),'base_units_per_requested_unit','1','reason','Explicit exact asset mapping'))),
('rational-map',pg_temp.s5x_command('rational','map_item',jsonb_build_object('catalog_item_id',pg_temp.s5x_id(24),'inventory_item_id',pg_temp.s5x_id(33),'base_units_per_requested_unit','3.000000','reason','Three base units per requested set')));


create function pg_temp.s5_command(k text,op text,payload jsonb default '{}') returns jsonb language sql as $$
 select public.equipment_fulfillment_command(op,pg_temp.s5x_request(k),jsonb_build_object('expected_revision',
 (select fulfillment_revision from public.equipment_requests where id=pg_temp.s5x_request(k)),'business_key',gen_random_uuid(),'reason','Synthetic physical fact')||payload,gen_random_uuid())
$$;
create function pg_temp.s5_issue(k text,m text,loc integer,q text,assets jsonb default '[]') returns jsonb language sql as $$
 select jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',pg_temp.s5x_line(k),'mapping_id',value->>'mapping_id','location_id',pg_temp.s5x_id(loc),'quantity',q,'asset_ids',assets))) from s5x_context where key=m
$$;
create function pg_temp.s5_slice(k text) returns uuid language sql as $$
 select s.id from public.equipment_issue_slices s join public.equipment_fulfillment_events e on e.id=s.event_id where e.request_id=pg_temp.s5x_request(k) order by e.revision limit 1
$$;
create function pg_temp.s5_receipt(k text,q text,condition text default 'good') returns jsonb language sql as $$
 select jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('issue_slice_id',pg_temp.s5_slice(k),'location_id',pg_temp.s5x_id(42),'quantity',q,'condition',condition)))
$$;
create function pg_temp.s5_sign(k text) returns void language plpgsql as $$
declare e jsonb;
begin
 for e in select value from jsonb_array_elements(public.equipment_fulfillment_read(pg_temp.s5x_request(k))->'events') where (value->>'signature_required')::boolean and not(value->>'superseded')::boolean and value->'signature'='null'::jsonb loop
  perform pg_temp.s5_command(k,'sign',jsonb_build_object('event_id',e->>'id','snapshot_hash',e->>'snapshot_hash','signature','data:image/png;base64,'||repeat('A',100)));
 end loop;
end; $$;

select pg_temp.s5x_command('rational','start',jsonb_build_object('lock_token',pg_temp.s5x_id(90)));
select pg_temp.s5x_confirm('rational',pg_temp.s5x_plan('rational','1',jsonb_build_array(pg_temp.s5x_alloc('rational-map',43,'3'))));
select pg_temp.s5_command('rational','handover',pg_temp.s5_issue('rational','rational-map',43,'3'));
insert into s5x_context values('slice-a',to_jsonb(pg_temp.s5_slice('rational')));
select pg_temp.s5_command('rational','initial_return','{"lines":[]}');
select throws_ok($$select pg_temp.s5_command('rational','resolve',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('issue_slice_id',(select value#>>'{}' from s5x_context where key='slice-a'),'quantity','0.5','classification','waived'))))$$,'P0001','S5_INVALID_QUANTITY','count-unit resolution rejects fractional obligation');
select pg_temp.s5_command('rational','resolve',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('issue_slice_id',(select value#>>'{}' from s5x_context where key='slice-a'),'quantity','2','classification','waived'))));
select pg_temp.s5_command('rational','consequence',jsonb_build_object('issue_slice_id',(select value#>>'{}' from s5x_context where key='slice-a'),'quantity','1','classification','settled','evidence','Original settlement'));
select pg_temp.s5_command('rational','correct',jsonb_build_object('event_id',(select id from public.equipment_fulfillment_events where request_id=pg_temp.s5x_request('rational') and operation='consequence'),'issue_slice_id',(select value#>>'{}' from s5x_context where key='slice-a'),'quantity','1','classification','settled','evidence','Updated consequence justification'));
select pg_temp.s5_command('rational','recover',pg_temp.s5_receipt('rational','1'));
select is((select x->>'held' from jsonb_array_elements(public.equipment_fulfillment_read(pg_temp.s5x_request('rational'))->'issues') x where x->>'id'=(select value#>>'{}' from s5x_context where key='slice-a')),'1.000000','active consequence creates hold on late return');
select * from finish();
rollback;
