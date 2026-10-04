-- S4 commitments use authenticated commands; only identity/catalog provenance is privileged.
-- Independent e410 fixtures and every physical fact roll back, including on full-suite runs.
begin;
select no_plan();

create function pg_temp.s4r_id(n integer) returns uuid language sql immutable as $$
  select ('e4100000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select pg_temp.s4r_id(n),'s4-reserve-'||n||'@campus.local','{"preapproved":true}'::jsonb,
  jsonb_build_object('full_name','S4 reservation actor '||n) from generate_series(1,4) n;
insert into public.profiles(id,email,full_name,phone,is_active)
select pg_temp.s4r_id(n),'s4-reserve-'||n||'@campus.local','S4 reservation actor '||n,'0901234567',true
from generate_series(1,4) n on conflict(id) do update set phone=excluded.phone,is_active=true;
insert into public.user_roles(user_id,role) values
(pg_temp.s4r_id(1),'admin'),(pg_temp.s4r_id(2),'lecturer'),
(pg_temp.s4r_id(3),'staff'),(pg_temp.s4r_id(4),'staff');
insert into public.profile_room_types(profile_id,room_type_id)
values
(pg_temp.s4r_id(2),'40000000-0000-0000-0000-000000000001'),
(pg_temp.s4r_id(3),'40000000-0000-0000-0000-000000000001') on conflict do nothing;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.s4r_id(1),'role','authenticated')::text,true);
insert into public.rooms(id,room_code,building_code,room_type_id)
values(pg_temp.s4r_id(10),'S4R_TEST','S4R_TEST','40000000-0000-0000-0000-000000000001');
insert into public.class_schedules(id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,schedule_date,start_time,end_time,semester,created_by)
select pg_temp.s4r_id(n),'S4R-'||n,'S4 reservation fixture',pg_temp.s4r_id(10),pg_temp.s4r_id(2),current_date+30+n,'09:00','11:00','HK1',pg_temp.s4r_id(1)
from generate_series(11,16) n;
insert into public.equipment_catalog(id,item_name,commercial_name,unit) values
(pg_temp.s4r_id(20),'S4R liquid','S4R liquid demand','liều'),
(pg_temp.s4r_id(21),'S4R asset','S4R asset demand','cái'),
(pg_temp.s4r_id(22),'S4R extra','S4R independent addition','cái'),
(pg_temp.s4r_id(23),'S4R proposal','S4R pending addition','cái'),
(pg_temp.s4r_id(24),'S4R rational','S4R rational demand','bộ');
insert into public.inventory_categories(id,code,name) values(pg_temp.s4r_id(30),'S4R-CAT','S4 reservation fixture');
insert into public.inventory_uoms(code,name,dimension,allowed_scale) values
('s4r_ml','S4R millilitre','volume',6),('s4r_count','S4R count','count',0);
insert into public.inventory_catalog_items(id,code,name,category_id,material_kind,base_uom_code,tracking_strategy,return_semantics,expiry_required) values
(pg_temp.s4r_id(31),'S4R-LIQUID','S4R liquid',pg_temp.s4r_id(30),'other','s4r_ml','quantity','nonreturnable',false),
(pg_temp.s4r_id(32),'S4R-ASSET','S4R asset',pg_temp.s4r_id(30),'other','s4r_count','serialized','returnable',true),
(pg_temp.s4r_id(33),'S4R-RATIONAL','S4R rational stock',pg_temp.s4r_id(30),'other','s4r_count','quantity','returnable',false);
insert into public.inventory_storage_locations(id,code,name) values
(pg_temp.s4r_id(41),'S4R-A','S4R source A'),(pg_temp.s4r_id(42),'S4R-B','S4R source B'),(pg_temp.s4r_id(43),'S4R-C','S4R replacement');
create temporary table s4r_context(key text primary key,value jsonb);
grant all on s4r_context to authenticated;
set local role authenticated;
create function pg_temp.s4r_actor(n integer) returns text language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.s4r_id(n),'role','authenticated')::text,true)
$$;
create function pg_temp.s4r_request(k text) returns uuid language sql as $$select (value#>>'{}')::uuid from s4r_context where key=k$$;
create function pg_temp.s4r_command(k text,op text,payload jsonb default '{}') returns jsonb language sql as $$
 select public.equipment_preparation_command(op,pg_temp.s4r_request(k),jsonb_build_object('expected_revision',
 (select preparation_revision from public.equipment_requests where id=pg_temp.s4r_request(k)))||payload,gen_random_uuid())
$$;
create function pg_temp.s4r_line(k text) returns uuid language sql as $$
 select id from public.equipment_request_items where request_id=pg_temp.s4r_request(k) and catalog_item_id in (pg_temp.s4r_id(20),pg_temp.s4r_id(21),pg_temp.s4r_id(24))
$$;
create function pg_temp.s4r_reserved(k text) returns numeric language sql as $$
 select coalesce(sum(rs.quantity),0) from public.inventory_reservations rs join public.equipment_preparations p on p.id=rs.preparation_id
 where p.request_id=pg_temp.s4r_request(k) and rs.released_at is null
$$;
create function pg_temp.s4r_alloc(mapping text,loc integer,q text,assets jsonb default '[]') returns jsonb language sql as $$
 select jsonb_build_object('mapping_id',value->>'mapping_id','location_id',pg_temp.s4r_id(loc),'base_quantity',q,'asset_ids',assets)
 from s4r_context where key=mapping
$$;
create function pg_temp.s4r_plan(k text,q text,allocations jsonb) returns jsonb language sql as $$
 select jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',id,'planned_quantity',q,
 'reviewed_revision',line_revision,'shortage_reason','Reviewed exact target','allocations',allocations)))
 from public.equipment_request_items where id=pg_temp.s4r_line(k)
$$;
create function pg_temp.s4r_confirm(k text,plan jsonb) returns jsonb language sql as $$
 select pg_temp.s4r_command(k,'confirm',jsonb_build_object('lock_token',pg_temp.s4r_id(90),'draft_revision',
 (select revision from public.equipment_preparations where request_id=pg_temp.s4r_request(k) and state='draft'),'plan',plan))
$$;
create function pg_temp.s4r_available(k text,loc integer) returns numeric language plpgsql as $$
declare page_number integer:=1; stock_rows jsonb; available numeric;
begin
 loop
  stock_rows:=public.equipment_preparation_read(pg_temp.s4r_request(k),'stock',
   jsonb_build_object('catalog_item_id',pg_temp.s4r_id(20),'page',page_number))->'rows';
  select (x->>'available_quantity')::numeric into available
   from jsonb_array_elements(stock_rows) x where x->>'location_id'=pg_temp.s4r_id(loc)::text;
  if found then return available; end if;
  if jsonb_array_length(stock_rows)<100 then
   raise exception 'Fixture stock location % missing from projection',loc;
  end if;
  page_number:=page_number+1;
 end loop;
end;
$$;

-- Physical opening is posted through the same Admin RPC as the inventory UI.
insert into s4r_context values('opening',public.inventory_command('confirm_opening_balance',jsonb_build_object(
 'synthetic',true,'cutover_key','S4R-OPENING','scope_description','S4 reservation fixture','count_cutoff',now(),'provenance_note','Synthetic acceptance stock',
 'lines',jsonb_build_array(
 jsonb_build_object('line_key','A','provenance_group','A','catalog_item_id',pg_temp.s4r_id(31),'location_id',pg_temp.s4r_id(41),'good_quantity','0.300000','damaged_quantity','0','expiry_precision','not_required'),
 jsonb_build_object('line_key','B','provenance_group','B','catalog_item_id',pg_temp.s4r_id(31),'location_id',pg_temp.s4r_id(42),'good_quantity','0.500000','damaged_quantity','0','expiry_precision','not_required'),
 jsonb_build_object('line_key','C','provenance_group','C','catalog_item_id',pg_temp.s4r_id(31),'location_id',pg_temp.s4r_id(43),'good_quantity','0.800000','damaged_quantity','0','expiry_precision','not_required'),
 jsonb_build_object('line_key','R','provenance_group','R','catalog_item_id',pg_temp.s4r_id(33),'location_id',pg_temp.s4r_id(43),'good_quantity','3','damaged_quantity','0','expiry_precision','not_required'))),gen_random_uuid()));
insert into s4r_context values('asset',public.equipment_asset_command('open_asset',jsonb_build_object(
 'catalog_item_id',pg_temp.s4r_id(32),'location_id',pg_temp.s4r_id(41),'intake_reference','S4R-ASSET-OPEN','row_key','1',
 'expiry_precision','day','expiry_input',(current_date+365)::text,'reason','Synthetic opening','evidence_note','S4R acceptance'),gen_random_uuid()));
select public.equipment_asset_command('set_asset_lifecycle',jsonb_build_object('id',(select value->>'id' from s4r_context where key='asset'),
 'expected_revision',1,'lifecycle_status','in_service','reason','Commission fixture','evidence_note','S4R acceptance'),gen_random_uuid());
insert into s4r_context
select k,to_jsonb(public.create_equipment_request_with_items(pg_temp.s4r_id(schedule),'HK1',pg_temp.s4r_id(2),
 ((current_date+30+schedule)::text||' 09:00+07')::timestamptz,((current_date+30+schedule)::text||' 11:00+07')::timestamptz,null,null,
 jsonb_build_array(jsonb_build_object('skill_name','S4R Skill','catalog_item_id',pg_temp.s4r_id(catalog),'quantity',q::text))))
from (values('quantity',11,20,8),('competitor',12,20,8),('asset-owner',13,21,1),('asset-competitor',14,21,1),('additions',15,20,1),('rational',16,24,1)) fixtures(k,schedule,catalog,q);
insert into s4r_context values
('liquid-map',pg_temp.s4r_command('quantity','map_item',jsonb_build_object('catalog_item_id',pg_temp.s4r_id(20),'inventory_item_id',pg_temp.s4r_id(31),'base_units_per_requested_unit','0.100000','reason','Explicit demand conversion'))),
('asset-map',pg_temp.s4r_command('asset-owner','map_item',jsonb_build_object('catalog_item_id',pg_temp.s4r_id(21),'inventory_item_id',pg_temp.s4r_id(32),'base_units_per_requested_unit','1','reason','Explicit exact asset mapping'))),
('rational-map',pg_temp.s4r_command('rational','map_item',jsonb_build_object('catalog_item_id',pg_temp.s4r_id(24),'inventory_item_id',pg_temp.s4r_id(33),'base_units_per_requested_unit','3.000000','reason','Three base units per requested set')));

select pg_temp.s4r_actor(2);
insert into s4r_context values('participant-notifications-before-draft',to_jsonb((select count(*) from public.user_notifications where entity_id=pg_temp.s4r_request('quantity'))));
select pg_temp.s4r_actor(1);
select is(pg_temp.s4r_reserved('quantity'),0::numeric,'registration owns no commitment');
select pg_temp.s4r_command('quantity','start',jsonb_build_object('lock_token',pg_temp.s4r_id(90)));
insert into s4r_context values('quantity-plan',pg_temp.s4r_plan('quantity','8',jsonb_build_array(
 pg_temp.s4r_alloc('liquid-map',41,'0.300000'),pg_temp.s4r_alloc('liquid-map',42,'0.500000'))));
select pg_temp.s4r_command('quantity','save',jsonb_build_object('lock_token',pg_temp.s4r_id(90),'draft_revision',1,
 'plan',pg_temp.s4r_plan('quantity','3',jsonb_build_array(pg_temp.s4r_alloc('liquid-map',41,'0.300000')))));
select is(pg_temp.s4r_reserved('quantity'),0::numeric,'saved draft does not reserve');
select is(pg_temp.s4r_available('quantity',41),0.3::numeric,'draft leaves source availability unchanged');
select pg_temp.s4r_actor(2);
select is((select count(*) from public.user_notifications where entity_id=pg_temp.s4r_request('quantity')),
 (select value::text::bigint from s4r_context where key='participant-notifications-before-draft'),'start and save emit no intermediate participant notification');
select is(public.equipment_preparation_read(pg_temp.s4r_request('quantity'))#>>'{preparation,draft,lines,0,planned_quantity}','8','participant sees published eight, not draft three');
select throws_ok($$select pg_temp.s4r_command('quantity','confirm','{}')$$,'42501','AUTH_DENIED','participant cannot confirm a warehouse plan');
select throws_ok($$select public.equipment_preparation_read(pg_temp.s4r_request('quantity'),'stock','{}')$$,'42501','AUTH_DENIED','participant cannot inspect warehouse stock');
select pg_temp.s4r_actor(4);
select throws_ok($$select public.equipment_preparation_read(pg_temp.s4r_request('quantity'))$$,'42501','AUTH_DENIED','unscoped Staff cannot read this preparation');
select throws_ok($$select pg_temp.s4r_command('quantity','start',jsonb_build_object('lock_token',pg_temp.s4r_id(91)))$$,'42501','AUTH_DENIED','unscoped Staff cannot acquire this request');
select pg_temp.s4r_actor(3);
select is(public.equipment_preparation_read(pg_temp.s4r_request('quantity'))->>'manager','true','scoped Staff is a warehouse manager');
select throws_ok($$select pg_temp.s4r_command('quantity','override_lock',jsonb_build_object('reason','Staff override attempt'))$$,'42501','AUTH_DENIED','Staff cannot exercise Admin lock override');
select pg_temp.s4r_actor(1);
select lives_ok($$select pg_temp.s4r_confirm('quantity',(select value from s4r_context where key='quantity-plan'))$$,'Admin confirms exact multi-source preparation');
select is((select status from public.equipment_requests where id=pg_temp.s4r_request('quantity')),'preparing','confirmation publishes PREPARED request status');
select is(pg_temp.s4r_reserved('quantity'),0.8::numeric,'confirmed eight demand units commit exactly 0.8 base units');
select results_eq($$select rs.location_id,rs.quantity from public.inventory_reservations rs join public.equipment_preparations p on p.id=rs.preparation_id where p.request_id=pg_temp.s4r_request('quantity') and rs.released_at is null order by rs.location_id$$,
 $$select * from (values(pg_temp.s4r_id(41),0.3::numeric),(pg_temp.s4r_id(42),0.5::numeric)) expected(location_id,quantity) order by location_id$$,'commitments retain both explicit physical sources');
select is((select sum(b.quantity) from public.inventory_stock_balances b join public.inventory_stock_origins o on o.id=b.cohort_id where o.catalog_item_id=pg_temp.s4r_id(31)),1.6::numeric,'reservation leaves physical on-hand unchanged');
select is(pg_temp.s4r_available('quantity',41),0::numeric,'reservation reduces source A availability');
select is(pg_temp.s4r_available('quantity',42),0::numeric,'reservation reduces source B availability');
select pg_temp.s4r_actor(2);
select is((select count(*) from public.user_notifications where entity_id=pg_temp.s4r_request('quantity') and notification_type='prepared'),1::bigint,'confirmed PREPARED emits one aggregate participant notification');
select pg_temp.s4r_actor(1);
select pg_temp.s4r_command('competitor','start',jsonb_build_object('lock_token',pg_temp.s4r_id(90)));
select throws_ok($$select pg_temp.s4r_confirm('competitor',pg_temp.s4r_plan('competitor','8',jsonb_build_array(pg_temp.s4r_alloc('liquid-map',41,'0.300000'),pg_temp.s4r_alloc('liquid-map',42,'0.500000'))))$$,
 'P0001','S4_INSUFFICIENT_AVAILABLE','competing request cannot overbook committed decimal stock');
select is(pg_temp.s4r_reserved('competitor'),0::numeric,'failed competing confirmation leaves no partial commitment');
select is(pg_temp.s4r_reserved('quantity'),0.8::numeric,'failed competitor preserves first owner');

-- Absolute adjustments do not mutate commitments until current-revision approval.
select pg_temp.s4r_actor(2);
insert into s4r_context values('adjustment',pg_temp.s4r_command('quantity','propose_adjustment',jsonb_build_object('reason','Reduce absolute target to six',
 'targets',jsonb_build_array(jsonb_build_object('line_id',pg_temp.s4r_line('quantity'),'quantity','6')))));
select is(public.equipment_preparation_read(pg_temp.s4r_request('quantity'))#>>'{lines,0,planned_quantity}','8','pending target leaves published quantity eight');
select pg_temp.s4r_actor(1);
select is(pg_temp.s4r_reserved('quantity'),0.8::numeric,'pending target leaves active reservations unchanged');
insert into s4r_context values('six-plan',pg_temp.s4r_plan('quantity','6',jsonb_build_array(pg_temp.s4r_alloc('liquid-map',41,'0.300000'),pg_temp.s4r_alloc('liquid-map',42,'0.300000'))));
select throws_ok($$select pg_temp.s4r_command('quantity','approve_adjustment',jsonb_build_object('adjustment_id',(select value->>'adjustment_id' from s4r_context where key='adjustment'),'reviewed_revision',-1,'plan',(select value from s4r_context where key='six-plan')))$$,
 '23505','STALE_REVISION','stale explicit approval rejects');
select is(pg_temp.s4r_reserved('quantity'),0.8::numeric,'stale approval retains prior commitment');
select lives_ok($$select pg_temp.s4r_command('quantity','approve_adjustment',jsonb_build_object('adjustment_id',(select value->>'adjustment_id' from s4r_context where key='adjustment'),'reviewed_revision',(select preparation_revision from public.equipment_requests where id=pg_temp.s4r_request('quantity')),'plan',(select value from s4r_context where key='six-plan')))$$,'current reviewed adjustment replaces the committed plan');
select is((select planned_quantity from public.equipment_request_items where id=pg_temp.s4r_line('quantity')),6,'approval means absolute six, not fourteen');
select is((select registered_quantity from public.equipment_request_items where id=pg_temp.s4r_line('quantity')),8,'approval preserves immutable registration baseline');
select is(pg_temp.s4r_reserved('quantity'),0.6::numeric,'approved absolute target replaces 0.8 with 0.6 commitment');

-- Truthful damage is not blocked or hidden just because the stock is committed.
select lives_ok($$select public.inventory_command('change_stock_condition',jsonb_build_object('location_id',pg_temp.s4r_id(41),'reason','Observed damage',
 'lines',(select jsonb_build_array(jsonb_build_object('origin_id',o.id,'expected_version',f.version,'expected_stock_revision',c.revision,'from_condition','good','to_condition','damaged','quantity','0.100000'))
 from public.inventory_stock_origins o join public.inventory_receipt_cohorts c on c.origin_id=o.id join public.inventory_stock_facts f on f.id=c.current_fact_id where o.catalog_item_id=pg_temp.s4r_id(31) and o.line_key='A')),gen_random_uuid())$$,'truthful damage can reduce backing below commitments');
select is(pg_temp.s4r_reserved('quantity'),0.6::numeric,'damage retains all commitments until explicit reconciliation');
select is((select (h->>'pool_shortfall')::numeric from jsonb_array_elements(public.equipment_preparation_read(pg_temp.s4r_request('quantity'))#>'{preparation,health}') h where h->>'location_id'=pg_temp.s4r_id(41)::text),0.1::numeric,'health exposes exact damaged-pool shortfall');
select pg_temp.s4r_actor(2);
select is((select count(*) from public.user_notifications where entity_id=pg_temp.s4r_request('quantity') and notification_type='preparation_shortfall'),1::bigint,'physical shortfall proactively notifies authorized participant');
select pg_temp.s4r_actor(4);
select is((select count(*) from public.user_notifications where entity_id=pg_temp.s4r_request('quantity') and notification_type='preparation_shortfall'),0::bigint,'out-of-scope Staff receives no shortfall disclosure');
select pg_temp.s4r_actor(1);
select throws_ok($$select pg_temp.s4r_command('quantity','reallocate',jsonb_build_object('reason','Invalid target change','plan',pg_temp.s4r_plan('quantity','5',jsonb_build_array(pg_temp.s4r_alloc('liquid-map',43,'0.500000')))))$$,'P0001','S4_REALLOCATION_CANNOT_CHANGE_PLAN','reallocation cannot smuggle in a new target');
select lives_ok($$select pg_temp.s4r_command('quantity','reallocate',jsonb_build_object('reason','Replace damaged backing','plan',pg_temp.s4r_plan('quantity','6',jsonb_build_array(pg_temp.s4r_alloc('liquid-map',43,'0.600000')))))$$,'explicit reallocation replaces backing with healthy stock');
select is((select planned_quantity from public.equipment_request_items where id=pg_temp.s4r_line('quantity')),6,'reallocation preserves approved absolute target');
select is(pg_temp.s4r_reserved('quantity'),0.6::numeric,'reallocation preserves exact committed total');
select is(public.equipment_preparation_read(pg_temp.s4r_request('quantity'))#>'{preparation,health}','[]'::jsonb,'replacement backing resolves shortfall');
select is(pg_temp.s4r_available('quantity',43),0.2::numeric,'replacement source advertises only uncommitted remainder');

-- Serialized reservations identify the exact asset and cannot double-book it.
select pg_temp.s4r_command('asset-owner','start',jsonb_build_object('lock_token',pg_temp.s4r_id(90)));
select lives_ok($$select pg_temp.s4r_confirm('asset-owner',pg_temp.s4r_plan('asset-owner','1',jsonb_build_array(pg_temp.s4r_alloc('asset-map',41,'1',jsonb_build_array((select value->>'id' from s4r_context where key='asset'))))))$$,'prepared asset plan reserves the selected identity');
select is((select rs.asset_id from public.inventory_reservations rs join public.equipment_preparations p on p.id=rs.preparation_id where p.request_id=pg_temp.s4r_request('asset-owner') and rs.released_at is null),(select (value->>'id')::uuid from s4r_context where key='asset'),'reservation belongs to the exact selected asset');
select pg_temp.s4r_command('asset-competitor','start',jsonb_build_object('lock_token',pg_temp.s4r_id(90)));
select throws_ok($$select pg_temp.s4r_confirm('asset-competitor',pg_temp.s4r_plan('asset-competitor','1',jsonb_build_array(pg_temp.s4r_alloc('asset-map',41,'1',jsonb_build_array((select value->>'id' from s4r_context where key='asset'))))))$$,'23505',null,'another request cannot double-book the same asset');
select is(pg_temp.s4r_reserved('asset-competitor'),0::numeric,'double-booking failure leaves competitor unreserved');
select lives_ok($$select public.equipment_asset_command('correct_asset',jsonb_build_object('id',(select value->>'id' from s4r_context where key='asset'),'expected_revision',2,
 'corrects_event_id',(select value->>'event_id' from s4r_context where key='asset'),'manufacturer',null,'model',null,'manufacturer_serial',null,
 'expiry_precision','day','expiry_input',(current_date-1)::text,'reason','Label shows expired stock','evidence_note','Observed expiry label'),gen_random_uuid())$$,'truthful expired label correction is accepted for committed asset');
select is(pg_temp.s4r_reserved('asset-owner'),1::numeric,'expiry retains exact asset commitment');
select is((select h->>'pool_shortfall' from jsonb_array_elements(public.equipment_preparation_read(pg_temp.s4r_request('asset-owner'))#>'{preparation,health}') h where h->>'asset_id'=(select value->>'id' from s4r_context where key='asset')),'1','read model reports expired committed asset as deficient');

-- Missing-attempt mutations must reject rather than succeed through SQL NULL logic.
select throws_ok($$select pg_temp.s4r_command('additions','begin_reversal','{"reason":"No attempt"}')$$,'P0001','S4_PREPARED_REASON_REQUIRED','cannot reverse absent attempt');
select throws_ok($$select pg_temp.s4r_command('additions','finalize_reversal')$$,'P0001','S4_REVERSAL_REQUIRED','cannot finalize absent reversal');
select throws_ok($$select pg_temp.s4r_command('additions','reallocate','{"reason":"No attempt","plan":{"lines":[]}}')$$,'P0001','S4_PREPARED_REASON_REQUIRED','cannot reallocate absent attempt');
select throws_ok($$select pg_temp.s4r_command('additions','confirm',jsonb_build_object('lock_token',pg_temp.s4r_id(90),'draft_revision',1,'plan',jsonb_build_object('lines','[]'::jsonb)))$$,'P0001','S4_LOCK_REQUIRED','cannot confirm absent attempt');
select pg_temp.s4r_actor(3);
select lives_ok($$select pg_temp.s4r_command('additions','start',jsonb_build_object('lock_token',pg_temp.s4r_id(90)))$$,'scoped Staff can start preparation');
select lives_ok($$select pg_temp.s4r_command('additions','add_line',jsonb_build_object('lock_token',pg_temp.s4r_id(90),'catalog_item_id',pg_temp.s4r_id(22),'skill_name','S4R Skill','quantity','2','reason','Independent warehouse addition'))$$,'scoped Staff can add an independent warehouse line');
select is((select registered_quantity from public.equipment_request_items where request_id=pg_temp.s4r_request('additions') and catalog_item_id=pg_temp.s4r_id(22)),0,'warehouse addition has baseline zero');
select is((select planned_quantity from public.equipment_request_items where request_id=pg_temp.s4r_request('additions') and catalog_item_id=pg_temp.s4r_id(22)),0,'warehouse addition remains unpublished before confirmation');
select is(pg_temp.s4r_reserved('additions'),0::numeric,'independent draft addition does not reserve');
select pg_temp.s4r_actor(2);
insert into s4r_context values('new-line-proposal',pg_temp.s4r_command('additions','propose_adjustment',jsonb_build_object('reason','Requester proposes new line',
 'targets',jsonb_build_array(jsonb_build_object('line_id',pg_temp.s4r_id(95),'catalog_item_id',pg_temp.s4r_id(23),'skill_name','S4R Skill','quantity','3')))));
select is((select count(*) from public.equipment_request_items where request_id=pg_temp.s4r_request('additions') and id=pg_temp.s4r_id(95)),0::bigint,'pending NEW addition has no live line before approval');
select pg_temp.s4r_actor(1);
select lives_ok($$select pg_temp.s4r_command('additions','approve_adjustment',jsonb_build_object('adjustment_id',(select value->>'adjustment_id' from s4r_context where key='new-line-proposal'),
 'reviewed_revision',(select preparation_revision from public.equipment_requests where id=pg_temp.s4r_request('additions')),
 'plan',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',pg_temp.s4r_id(95),'planned_quantity','3','reviewed_revision',1,'shortage_reason','','allocations','[]'::jsonb)))))$$,'current reviewed NEW addition becomes live only on approval');
select results_eq($$select registered_quantity,planned_quantity,baseline_source from public.equipment_request_items where request_id=pg_temp.s4r_request('additions') and id=pg_temp.s4r_id(95)$$,
 $$select 0,3,'added'::text$$,'approved independent addition retains zero baseline and absolute planned three');
select is(pg_temp.s4r_reserved('additions'),0::numeric,'NEW approval still owns no reservation');
select is((select registered_quantity from public.equipment_request_items where id=pg_temp.s4r_line('additions')),1,'independent additions never rewrite original registration');

-- Three exact thirds must sum to one, without per-allocation decimal division loss.
select pg_temp.s4r_command('rational','start',jsonb_build_object('lock_token',pg_temp.s4r_id(90)));
select lives_ok($$select pg_temp.s4r_confirm('rational',pg_temp.s4r_plan('rational','1',jsonb_build_array(
 pg_temp.s4r_alloc('rational-map',43,'1'),pg_temp.s4r_alloc('rational-map',43,'1'),pg_temp.s4r_alloc('rational-map',43,'1'))))$$,
 'three base-unit allocations at factor three fulfill exactly one requested set');
select is(pg_temp.s4r_reserved('rational'),3::numeric,'exact rational fulfillment commits all three physical base units');
select is((select planned_quantity from public.equipment_request_items where id=pg_temp.s4r_line('rational')),1,'exact rational fulfillment preserves the single requested set');
-- A standalone transfer replay must never count as later physical compensation.
select pg_temp.s4r_command('rational','begin_reversal','{"reason":"Release rational acceptance commitment"}');
select pg_temp.s4r_command('rational','finalize_reversal','{"reason":"No transfer debt"}');
insert into s4r_context values('old-transfer-payload',jsonb_build_object(
 'source_location_id',pg_temp.s4r_id(43),'target_location_id',pg_temp.s4r_id(41),'reason','Replay provenance regression',
 'lines',(select jsonb_build_array(jsonb_build_object('origin_id',o.id,'expected_version',f.version::text,'expected_stock_revision',c.revision::text,'condition','good','quantity','1'))
 from public.inventory_stock_origins o join public.inventory_receipt_cohorts c on c.origin_id=o.id join public.inventory_stock_facts f on f.id=c.current_fact_id where o.catalog_item_id=pg_temp.s4r_id(33))));
insert into s4r_context values('old-transfer',public.inventory_command('transfer_stock',(select value from s4r_context where key='old-transfer-payload'),pg_temp.s4r_id(96)));
select pg_temp.s4r_command('rational','start',jsonb_build_object('lock_token',pg_temp.s4r_id(90)));
insert into s4r_context values('outbound',public.equipment_preparation_transfer(pg_temp.s4r_request('rational'),jsonb_build_object(
 'expected_revision',(select preparation_revision from public.equipment_requests where id=pg_temp.s4r_request('rational')),
 'lock_token',pg_temp.s4r_id(90),'source_location_id',pg_temp.s4r_id(41),'destination_location_id',pg_temp.s4r_id(43),
 'inventory_item_id',pg_temp.s4r_id(33),'quantity','1','condition','good','reason','Actual outbound','physical_confirmation',true),gen_random_uuid()));
select pg_temp.s4r_command('rational','begin_reversal',jsonb_build_object('lock_token',pg_temp.s4r_id(90),'reason','Return actual outbound'));
insert into s4r_context values('compensation',jsonb_build_object(
 'expected_revision',(select preparation_revision from public.equipment_requests where id=pg_temp.s4r_request('rational')),
 'compensates_id',(select value#>>'{transfer_ids,0}' from s4r_context where key='outbound'),
 'source_location_id',pg_temp.s4r_id(43),'destination_location_id',pg_temp.s4r_id(41),
 'cohort_id',(select value#>>'{lines,0,origin_id}' from s4r_context where key='old-transfer-payload'),
 'expected_version',(select value#>>'{lines,0,expected_version}' from s4r_context where key='old-transfer-payload'),
 'expected_stock_revision',(select value#>>'{lines,0,expected_stock_revision}' from s4r_context where key='old-transfer-payload'),
 'quantity','1','condition','good','reason','Replay provenance regression','physical_confirmation',true));
select throws_ok($$select public.equipment_preparation_transfer(pg_temp.s4r_request('rational'),(select value from s4r_context where key='compensation'),pg_temp.s4r_id(96))$$,
 '23505',null,'standalone replay key cannot bypass current physical stock revision');
select throws_ok($$select pg_temp.s4r_command('rational','finalize_reversal','{"reason":"Old transfer is not compensation"}')$$,
 'P0001','S4_PHYSICAL_COMPENSATION_REQUIRED','unrelated prior transfer cannot discharge reversal debt');
update s4r_context set value=jsonb_set(value,'{expected_stock_revision}',to_jsonb((select revision::text from public.inventory_receipt_cohorts where origin_id=(value->>'cohort_id')::uuid))) where key='compensation';
insert into s4r_context values('compensated',public.equipment_preparation_transfer(pg_temp.s4r_request('rational'),(select value from s4r_context where key='compensation'),pg_temp.s4r_id(96)));
select isnt((select value->>'transaction_id' from s4r_context where key='compensated'),(select value->>'transaction_id' from s4r_context where key='old-transfer'),
 'compensation posts a new physical transaction rather than adopting historical replay');
select is(public.equipment_preparation_transfer(pg_temp.s4r_request('rational'),(select value from s4r_context where key='compensation'),pg_temp.s4r_id(96)),
 (select value from s4r_context where key='compensated'),'outer retry returns same compensation without another physical transfer');
select is((select b.quantity from public.inventory_stock_balances b where b.cohort_id=(select (value->>'cohort_id')::uuid from s4r_context where key='compensation') and b.location_id=pg_temp.s4r_id(41) and b.condition='good'),
 1::numeric,'actual compensation physically returns one unit to original source');
select lives_ok($$select pg_temp.s4r_command('rational','finalize_reversal','{"reason":"Actual compensation complete"}')$$,'finalization succeeds only after actual compensation');
select * from finish();
rollback;
