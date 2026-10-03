-- S4 authenticated transactional smoke/regression. All synthetic facts roll back.
begin;
select no_plan();
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('e4000000-0000-0000-0000-000000000001','s4-admin@campus.local','{"preapproved":true}','{"full_name":"S4 Admin"}'),
('e4000000-0000-0000-0000-000000000002','s4-lecturer@campus.local','{"preapproved":true}','{"full_name":"S4 Lecturer"}');
insert into public.profiles(id,email,full_name,phone,is_active) values
('e4000000-0000-0000-0000-000000000001','s4-admin@campus.local','S4 Admin','0901234567',true),
('e4000000-0000-0000-0000-000000000002','s4-lecturer@campus.local','S4 Lecturer','0901234567',true)
on conflict(id) do update set phone=excluded.phone,is_active=true;
insert into public.user_roles(user_id,role) values('e4000000-0000-0000-0000-000000000001','admin'),('e4000000-0000-0000-0000-000000000002','lecturer');
select set_config('request.jwt.claims','{"sub":"e4000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
insert into public.rooms(id,room_code,building_code,room_type_id) values('e4000000-0000-0000-0000-000000000010','S4_TEST','S4_TEST','40000000-0000-0000-0000-000000000001');
insert into public.class_schedules(id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,schedule_date,start_time,end_time,semester,created_by)
values('e4000000-0000-0000-0000-000000000011','S4','S4 synthetic','e4000000-0000-0000-0000-000000000010','e4000000-0000-0000-0000-000000000002',current_date+30,'09:00','11:00','HK1','e4000000-0000-0000-0000-000000000001');
insert into public.equipment_catalog(id,item_name,commercial_name,unit) values('e4000000-0000-0000-0000-000000000012','S4','S4 Synthetic Item','cái');
create temporary table s4_context(key text primary key,value jsonb);
grant all on s4_context to authenticated;
set local role authenticated;
insert into s4_context values('request',to_jsonb(public.create_equipment_request_with_items('e4000000-0000-0000-0000-000000000011','HK1','e4000000-0000-0000-0000-000000000002',((current_date+30)::text||' 09:00+07')::timestamptz,((current_date+30)::text||' 11:00+07')::timestamptz,null,null,'[{"skill_name":"S4 Skill","catalog_item_id":"e4000000-0000-0000-0000-000000000012","quantity":8}]')));
create function pg_temp.s4_request() returns uuid language sql as $$select (value#>>'{}')::uuid from s4_context where key='request'$$;
create function pg_temp.s4_command(op text,payload jsonb default '{}') returns jsonb language sql as $$select public.equipment_preparation_command(op,pg_temp.s4_request(),jsonb_build_object('expected_revision',(select preparation_revision from public.equipment_requests where id=pg_temp.s4_request()))||payload,gen_random_uuid())$$;
select is((select registered_quantity from public.equipment_request_items where request_id=pg_temp.s4_request()),8,'original registration quantity is captured');
select is((select count(*) from public.inventory_reservations rs join public.equipment_preparations p on p.id=rs.preparation_id where p.request_id=pg_temp.s4_request()),0::bigint,'new request owns no reservation');
select throws_ok($$select pg_temp.s4_command('start','{"expected_revision":-1,"lock_token":"e4000000-0000-0000-0000-000000000020"}')$$,'23505','STALE_REVISION','stale start rejects');
insert into s4_context values('start',pg_temp.s4_command('start','{"lock_token":"e4000000-0000-0000-0000-000000000020"}'));
select throws_ok($$select pg_temp.s4_command('start','{"lock_token":"e4000000-0000-0000-0000-000000000021"}')$$,'P0001','S4_LOCK_HELD','another tab cannot take the preparation lock');
select throws_ok($$update public.class_schedules set course_name_snapshot='Changed behind preparation' where id='e4000000-0000-0000-0000-000000000011'$$,'42501','CLASS_EQUIPMENT_REQUEST_EXISTS','direct class update cannot bypass preparation source lock');
select is((select count(*) from public.inventory_reservations rs join public.equipment_preparations p on p.id=rs.preparation_id where p.request_id=pg_temp.s4_request()),0::bigint,'start does not reserve');
select throws_ok($$select public.manager_confirm_equipment_status(pg_temp.s4_request(),'preparing')$$,'P0001','S4_CONFIRM_PREPARATION_REQUIRED','legacy status RPC cannot bypass reservation validation');
select throws_ok($$update public.equipment_request_items set registered_quantity=9 where request_id=pg_temp.s4_request()$$,'42501',null,'direct baseline mutation is denied');
select throws_ok($$select public.equipment_preparation_command('confirm',pg_temp.s4_request(),jsonb_build_object('expected_revision',(select preparation_revision from public.equipment_requests where id=pg_temp.s4_request()),'lock_token','e4000000-0000-0000-0000-000000000020','draft_revision',1,'plan',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',(select id from public.equipment_request_items where request_id=pg_temp.s4_request()),'reviewed_revision',1,'planned_quantity','0','shortage_reason','No stock','allocations','[]'::jsonb)))),gen_random_uuid())$$,'P0001','S4_ALL_ZERO_FORBIDDEN','all-zero plan cannot confirm');
select is((select status from public.equipment_requests where id=pg_temp.s4_request()),'new','failed confirmation is atomic');
select is((select count(*) from public.equipment_preparation_plans pl join public.equipment_preparations p on p.id=pl.preparation_id where p.request_id=pg_temp.s4_request()),0::bigint,'failed confirmation retains no partial plan');
create function pg_temp.s4_plan(q text) returns jsonb language sql as $$
 select jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',id,'planned_quantity',q,'reviewed_revision',line_revision,'shortage_reason','Synthetic plan','allocations','[]'::jsonb))) from public.equipment_request_items where request_id=pg_temp.s4_request()
$$;
select lives_ok($$select pg_temp.s4_command('save',jsonb_build_object('lock_token','e4000000-0000-0000-0000-000000000020','draft_revision',1,'plan',pg_temp.s4_plan('3')))$$,'warehouse progress can save without hard reservation');
select is((select planned_quantity from public.equipment_request_items where request_id=pg_temp.s4_request()),8,'warehouse draft does not publish tentative quantity');
insert into s4_context values('plan6',pg_temp.s4_plan('6'));
insert into s4_context values('targets6',(select jsonb_build_array(jsonb_build_object('line_id',id,'quantity','6')) from public.equipment_request_items where request_id=pg_temp.s4_request()));
select set_config('request.jwt.claims','{"sub":"e4000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is(public.equipment_preparation_read(pg_temp.s4_request())#>>'{preparation,draft,lines,0,planned_quantity}','8','participant reads published target, not warehouse draft');
insert into s4_context values('proposal',pg_temp.s4_command('propose_adjustment',jsonb_build_object('targets',(select value from s4_context where key='targets6'),'reason','Synthetic absolute target')));
select ok(not exists(select 1 from s4_context where key='proposal' and value#>'{preparation,draft}' is not null),'participant command response cannot disclose warehouse draft');
select is(public.equipment_preparation_read(pg_temp.s4_request())#>>'{lines,0,planned_quantity}','8','pending proposal leaves current plan unchanged');
select set_config('request.jwt.claims','{"sub":"e4000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select pg_temp.s4_command('approve_adjustment',jsonb_build_object('adjustment_id',(select value->>'adjustment_id' from s4_context where key='proposal'),'reviewed_revision',-1,'plan',(select value from s4_context where key='plan6')))$$,'23505','STALE_REVISION','stale review cannot approve absolute target');
select lives_ok($$select pg_temp.s4_command('approve_adjustment',jsonb_build_object('adjustment_id',(select value->>'adjustment_id' from s4_context where key='proposal'),'reviewed_revision',(select preparation_revision from public.equipment_requests where id=pg_temp.s4_request()),'plan',(select value from s4_context where key='plan6')))$$,'current reviewed NEW adjustment applies without reservation');
select is((select planned_quantity from public.equipment_request_items where request_id=pg_temp.s4_request()),6,'approval publishes absolute six, not previous plus six');
select is((select registered_quantity from public.equipment_request_items where request_id=pg_temp.s4_request()),8,'approval preserves original registered baseline');
select is((select count(*) from public.inventory_reservations rs join public.equipment_preparations p on p.id=rs.preparation_id where p.request_id=pg_temp.s4_request()),0::bigint,'NEW approval never reserves');
select lives_ok($$select pg_temp.s4_command('release_lock','{"expected_revision":-1,"lock_token":"e4000000-0000-0000-0000-000000000020"}')$$,'own tab can release even after requester revision changes');
select set_config('request.jwt.claims','{"sub":"e4000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select ok(not exists(select 1 from public.equipment_preparation_events where request_id=pg_temp.s4_request() and operation='approve_adjustment' and payload ? 'plan'),
 'participant event SELECT cannot disclose unpublished warehouse plan');
select ok(not exists(select 1 from jsonb_array_elements(public.equipment_preparation_read(pg_temp.s4_request(),'history')->'rows') e where e->>'operation'='approve_adjustment' and e->'payload' ? 'plan'),
 'participant history RPC cannot disclose unpublished warehouse plan');
select * from finish();
rollback;
