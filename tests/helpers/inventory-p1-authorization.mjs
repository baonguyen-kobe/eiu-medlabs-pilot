import assert from "node:assert/strict";
import { actorSql, jsonSql, sqlLiteral } from "./inventory-p1-runtime.mjs";

// Execute only with setupP1Local/createP1LocalClient. All metadata, physical RPC
// facts, marker commands, corrupt legacy rows and successful DELETEs roll back.
export function buildP1AuthorizationSql(manifest) {
  assert.equal(manifest.synthetic, true);
  assert.equal(manifest.dataset_kind, "mock");
  assert.equal(manifest.target_project_ref, "kwpyukofofoaqhmxndlc");
  const admin = manifest.users.find((user) => user.role === "admin").id;
  const staff = manifest.users
    .filter((user) => user.role === "staff")
    .map((user) => user.id);
  const reusable = manifest.items.find((item) => item.key === "reusable").id;
  const meta = {
    scope_id: manifest.scope_id,
    scope_version: manifest.scope_version,
    manifest_id: manifest.manifest_id,
    project_ref: manifest.target_project_ref,
  };
  const phases = ["OPENING_READY", "PAUSED"];
  return `begin isolation level repeatable read;
select pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
create temporary table p1_auth_context(k text primary key,v jsonb not null) on commit drop;
grant all on p1_auth_context to authenticated;
insert into p1_auth_context values('manifest',${jsonSql(manifest)}),('pilot',${jsonSql(meta)});
create function pg_temp.auth_get(key text) returns jsonb language sql as $$ select v from p1_auth_context where k=key $$;
create function pg_temp.auth_put(key text,value jsonb) returns void language sql as $$ insert into p1_auth_context values(key,value) on conflict(k) do update set v=excluded.v $$;
create function pg_temp.auth_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'P1_AUTH_ASSERT: %',label; end if; end $$;
create function pg_temp.auth_control(op text,extra jsonb default '{}') returns jsonb language sql as $$
 select public.inventory_pilot_command(op,jsonb_build_object('pilot',pg_temp.auth_get('pilot'),'reason','Synthetic rolled-back AUTH01/AUTH02','evidence_reference','P1-AUTH-'||gen_random_uuid())||extra,gen_random_uuid()) $$;
create function pg_temp.auth_expect(query text,label text) returns void language plpgsql as $$
declare code text; message text; begin
 begin execute query; exception when others then
  get stacked diagnostics code=returned_sqlstate,message=message_text;
  if code='42501' and message like 'P1_%' then return; end if;
  raise exception 'P1_AUTH_WRONG_DENIAL %: % %',label,code,message;
 end;
 raise exception 'P1_AUTH_EXPECTED_DENIAL: %',label;
end $$;
create function pg_temp.auth_fingerprint() returns jsonb language plpgsql as $$
declare t record; digest text; result jsonb:='{}'; begin
 for t in select c.relname,n.nspname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('public','auth','private') order by n.nspname,c.relname loop
  execute format('select md5(coalesce(string_agg(to_jsonb(x)::text,chr(10) order by to_jsonb(x)::text),'''')) from %I.%I x',t.nspname,t.relname) into digest;
  result:=result||jsonb_build_object(t.nspname||'.'||t.relname,digest);
 end loop; return result;
end $$;
select pg_temp.auth_assert(current_user in ('postgres','supabase_admin'),'owner transport required');
select pg_temp.auth_assert(not exists(select 1 from public.inventory_pilot_scopes where id=${sqlLiteral(manifest.scope_id)}::uuid),'fresh local counterpart required');
select pg_temp.auth_put('before',pg_temp.auth_fingerprint());
savepoint authorization_effects;

-- Genuine unrelated metadata and physical backing, never production identities.
update public.profiles set phone='0901234567' where id=${sqlLiteral(admin)}::uuid;
insert into public.user_roles(user_id,role) values(${sqlLiteral(staff[1])}::uuid,'lecturer') on conflict do nothing;
do $$ declare room uuid:=gen_random_uuid(); course uuid:=gen_random_uuid(); schedule uuid; key text;
 item uuid:=gen_random_uuid(); loc uuid:=gen_random_uuid(); demand uuid:=gen_random_uuid(); begin
 insert into public.rooms(id,room_code,building_code,room_type_id) values(room,'P1-AUTH-'||room,'P1-MOCK','40000000-0000-0000-0000-000000000001');
 insert into public.courses(id,course_code,course_name) values(course,'P1-AUTH-'||course,'Rollback-only authorization nursing course');
 for key in select unnest(array['carrier','OPENING_READY','PAUSED']) loop
  schedule:=gen_random_uuid();
  insert into public.class_schedules(id,course_id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,schedule_date,start_time,end_time,semester,created_by,source,schedule_status,student_count,published_by,published_at)
  values(schedule,course,'P1-AUTH-'||course,'Synthetic authorization course',room,${sqlLiteral(staff[1])}::uuid,current_date+60+case key when 'carrier' then 0 when 'OPENING_READY' then 1 else 2 end,'09:00','11:00','HK1',${sqlLiteral(admin)}::uuid,'manual','published',20,${sqlLiteral(admin)}::uuid,now());
  perform pg_temp.auth_put('schedule-'||key,to_jsonb(schedule));
 end loop;
 insert into public.inventory_storage_locations(id,code,name) values(loc,'P1-AUTH-'||loc,'Synthetic unrelated authorization location');
 insert into public.inventory_catalog_items(id,code,name,category_id,material_kind,base_uom_code,tracking_strategy,return_semantics,expiry_required)
 select item,'P1-AUTH-'||item,'Synthetic unrelated authorization item',category_id,material_kind,base_uom_code,tracking_strategy,return_semantics,expiry_required from public.inventory_catalog_items where id=${sqlLiteral(reusable)}::uuid;
 insert into public.equipment_catalog(id,item_name,commercial_name,unit) values(demand,'P1 authorization demand','P1 authorization shared catalog','cái');
 perform pg_temp.auth_put('outside-item',to_jsonb(item)); perform pg_temp.auth_put('outside-location',to_jsonb(loc)); perform pg_temp.auth_put('demand',to_jsonb(demand));
end $$;
${actorSql(admin)}
select public.inventory_command('confirm_opening_balance',jsonb_build_object('synthetic',true,'cutover_key','P1-AUTH-'||gen_random_uuid(),'scope_description','Synthetic unrelated authorization stock','count_cutoff',clock_timestamp(),'provenance_note','Rollback-only authorization fixture','lines',jsonb_build_array(jsonb_build_object('line_key','outside','provenance_group','outside','catalog_item_id',pg_temp.auth_get('outside-item')#>>'{}','location_id',pg_temp.auth_get('outside-location')#>>'{}','good_quantity','100','damaged_quantity','0','expiry_precision','not_required'))),gen_random_uuid());
create function pg_temp.auth_new_request(key text) returns uuid language plpgsql as $$
declare request uuid; begin
 request:=public.create_equipment_request_with_items((pg_temp.auth_get('schedule-'||key)#>>'{}')::uuid,'HK1',${sqlLiteral(staff[1])}::uuid,((current_date+60)::text||' 09:00+07')::timestamptz,((current_date+63)::text||' 11:00+07')::timestamptz,null,'Synthetic rolled-back authorization request',jsonb_build_array(jsonb_build_object('skill_name','P1 authorization nursing','catalog_item_id',pg_temp.auth_get('demand')#>>'{}','quantity',1)));
 perform pg_temp.auth_put('request-'||key,to_jsonb(request)); return request;
end $$;
select pg_temp.auth_new_request('carrier');
select pg_temp.auth_put('outside-mapping',public.equipment_preparation_command('map_item',(pg_temp.auth_get('request-carrier')#>>'{}')::uuid,jsonb_build_object('expected_revision',public.equipment_preparation_read((pg_temp.auth_get('request-carrier')#>>'{}')::uuid)#>'{request,revision}','catalog_item_id',pg_temp.auth_get('demand')#>>'{}','inventory_item_id',pg_temp.auth_get('outside-item')#>>'{}','base_units_per_requested_unit','1','reason','Synthetic out-of-scope physical mapping'),gen_random_uuid()));
-- Same demand catalog has a pilot mapping; that mapping is not selected by any
-- unrelated draft or allocation. This catches the removed all-mappings fallback.
select public.equipment_preparation_command('map_item',(pg_temp.auth_get('request-carrier')#>>'{}')::uuid,jsonb_build_object('expected_revision',public.equipment_preparation_read((pg_temp.auth_get('request-carrier')#>>'{}')::uuid)#>'{request,revision}','catalog_item_id',pg_temp.auth_get('demand')#>>'{}','inventory_item_id',${sqlLiteral(reusable)},'base_units_per_requested_unit','1','reason','Unused pilot alternative for shared demand'),gen_random_uuid());
create function pg_temp.auth_prepare(key text) returns void language plpgsql as $$
declare request uuid:=(pg_temp.auth_get('request-'||key)#>>'{}')::uuid; token uuid:=gen_random_uuid(); w jsonb; plan jsonb; begin
 w:=public.equipment_preparation_read(request);
 perform public.equipment_preparation_command('start',request,jsonb_build_object('expected_revision',w#>'{request,revision}','lock_token',token),gen_random_uuid());
 w:=public.equipment_preparation_read(request);
 plan:=jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',w#>>'{lines,0,id}','planned_quantity','1','reviewed_revision',w#>'{lines,0,line_revision}','shortage_reason','','allocations',jsonb_build_array(jsonb_build_object('mapping_id',pg_temp.auth_get('outside-mapping')->>'mapping_id','location_id',pg_temp.auth_get('outside-location')#>>'{}','base_quantity','1','asset_ids','[]'::jsonb)))));
 perform public.equipment_preparation_command('save',request,jsonb_build_object('expected_revision',w#>'{request,revision}','lock_token',token,'draft_revision',w#>'{preparation,revision}','plan',plan),gen_random_uuid());
 w:=public.equipment_preparation_read(request);
 perform public.equipment_preparation_command('confirm',request,jsonb_build_object('expected_revision',w#>'{request,revision}','lock_token',token,'draft_revision',w#>'{preparation,revision}','plan',plan),gen_random_uuid());
 w:=public.equipment_preparation_read(request);
 perform pg_temp.auth_assert(w#>>'{request,status}'='preparing' and w#>>'{preparation,state}'='prepared','actual unrelated S4 confirmation '||key);
 perform pg_temp.auth_assert(w#>'{preparation,draft}'=plan,'unrelated prepared plan retains only selected physical mapping '||key);
end $$;
${actorSql(staff[0])}
select pg_temp.auth_prepare('carrier');
select pg_temp.auth_put('carrier-event',public.equipment_fulfillment_command('handover',(pg_temp.auth_get('request-carrier')#>>'{}')::uuid,jsonb_build_object('expected_revision',0,'business_key','P1-AUTH-'||gen_random_uuid(),'reason','Genuine unrelated carrier handover','lines',jsonb_build_array(jsonb_build_object('line_id',public.equipment_preparation_read((pg_temp.auth_get('request-carrier')#>>'{}')::uuid)#>>'{lines,0,id}','mapping_id',pg_temp.auth_get('outside-mapping')->>'mapping_id','location_id',pg_temp.auth_get('outside-location')#>>'{}','quantity','1','asset_ids','[]'::jsonb))),gen_random_uuid()));
reset role;
select pg_temp.auth_put('carrier-slice',to_jsonb(sl)) from public.equipment_issue_slices sl join public.equipment_fulfillment_events e on e.id=sl.event_id where e.request_id=(pg_temp.auth_get('request-carrier')#>>'{}')::uuid;
select pg_temp.auth_put('pilot-cohort',to_jsonb(id)) from public.inventory_stock_origins where catalog_item_id=${sqlLiteral(reusable)}::uuid order by id limit 1;
-- Preexisting malformed history is deliberately seeded BEFORE registration.
-- Each independent FK is genuine; no persistent trigger changes are needed.
do $$ declare sl public.equipment_issue_slices; id uuid; kind text; begin
 select original.* into sl from public.equipment_issue_slices original where original.id=(pg_temp.auth_get('carrier-slice')->>'id')::uuid;
 for kind in select unnest(array['asset','cohort']) loop
  id:=gen_random_uuid();
  insert into public.equipment_issue_slices(id,event_id,request_line_id,mapping_id,inventory_item_id,location_id,cohort_id,asset_id,quantity,return_required,base_units_per_requested_unit)
  values(id,sl.event_id,sl.request_line_id,sl.mapping_id,sl.inventory_item_id,sl.location_id,case when kind='cohort' then (pg_temp.auth_get('pilot-cohort')#>>'{}')::uuid end,case when kind='asset' then ${sqlLiteral(manifest.asset.id)}::uuid end,1,true,1);
  perform pg_temp.auth_put('forged-'||kind,to_jsonb(id));
 end loop;
end $$;
create function pg_temp.auth_forgery_denials(phase text) returns void language plpgsql as $$
declare sl public.equipment_issue_slices; kind text; backing text; query text; begin
 select * into sl from public.equipment_issue_slices where id=(pg_temp.auth_get('carrier-slice')->>'id')::uuid;
 for kind in select unnest(array['asset','cohort']) loop
  backing:=case kind when 'asset' then ${sqlLiteral(manifest.asset.id)} else pg_temp.auth_get('pilot-cohort')#>>'{}' end;
  query:=format('insert into public.equipment_issue_slices(event_id,request_line_id,mapping_id,inventory_item_id,location_id,cohort_id,asset_id,quantity,return_required,base_units_per_requested_unit) values(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L::uuid,%s,%s,1,true,1)',sl.event_id,sl.request_line_id,sl.mapping_id,sl.inventory_item_id,sl.location_id,case when kind='cohort' then quote_literal(backing)||'::uuid' else 'null' end,case when kind='asset' then quote_literal(backing)||'::uuid' else 'null' end);
  perform pg_temp.auth_expect(query,'owner forged '||kind||' slice '||phase);
  perform pg_temp.auth_expect(format('insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,location_id,condition) values(%L::uuid,%L::uuid,''receipt'',1,%L::uuid,''good'')',sl.event_id,pg_temp.auth_get('forged-'||kind)#>>'{}',sl.location_id),'owner effect inherits canonical '||kind||' backing '||phase);
 end loop;
end $$;
${actorSql(admin)}
select pg_temp.auth_control('register_scope',jsonb_build_object('manifest',pg_temp.auth_get('manifest')));
${phases
  .map(
    (phase) => `
${phase === "PAUSED" ? "select pg_temp.auth_control('pause');" : ""}
select pg_temp.auth_assert(public.inventory_pilot_read(${sqlLiteral(manifest.scope_id)}::uuid)#>>'{scope,phase}'=${sqlLiteral(phase)},'actual ${phase} prerequisite');
select pg_temp.auth_new_request(${sqlLiteral(phase)});
${actorSql(staff[0])}
select pg_temp.auth_prepare(${sqlLiteral(phase)});
do $$ declare r uuid:=(pg_temp.auth_get('request-${phase}')#>>'{}')::uuid; w jsonb; begin
 w:=public.equipment_preparation_read(r);
 perform public.equipment_preparation_command('begin_reversal',r,jsonb_build_object('expected_revision',w#>'{request,revision}','reason','Unrelated synthetic cancellation'),gen_random_uuid());
 w:=public.equipment_preparation_read(r);
 perform public.equipment_preparation_command('finalize_reversal',r,jsonb_build_object('expected_revision',w#>'{request,revision}','reason','No transfers to compensate'),gen_random_uuid());
 perform pg_temp.auth_assert(public.soft_cancel_equipment_request(r),'unrelated named actor cancellation succeeds ${phase}');
 perform pg_temp.auth_assert(public.equipment_preparation_read(r)#>>'{request,status}'='cancelled','unrelated cancellation actually persists ${phase}');
end $$;
reset role;
-- Legacy authorization settings are attacker-controlled and confer no authority.
select set_config('app.s4_command','true',true);
select set_config('app.s5_command','true',true);
select set_config('app.inventory_command','true',true);
select set_config('app.p1_scope_id',${sqlLiteral(manifest.scope_id)},true);
select set_config('app.p1_writer','equipment_fulfillment_command',true);
select pg_temp.auth_put('denial-before',pg_temp.auth_fingerprint());
select pg_temp.auth_forgery_denials(${sqlLiteral(phase)});
select pg_temp.auth_assert(pg_temp.auth_fingerprint()=pg_temp.auth_get('denial-before'),'denied direct slice/effect DML has exact zero row side effects ${phase}');
-- A BEFORE DELETE guard must return OLD for unrelated rows: verify real deletion.
do $$ declare location uuid:=gen_random_uuid(); deleted uuid; begin
 insert into public.inventory_storage_locations(id,code,name) values(location,'P1-AUTH-DELETE-'||location,'Unused unrelated authorization location');
 delete from public.inventory_storage_locations where id=location returning id into deleted;
 perform pg_temp.auth_assert(deleted=location and not exists(select 1 from public.inventory_storage_locations where id=location),'owner unscoped DELETE actually deletes ${phase}');
end $$;
select set_config('app.s4_command','',true);
select set_config('app.s5_command','',true);
select set_config('app.inventory_command','',true);
select set_config('app.p1_scope_id','',true);
select set_config('app.p1_writer','',true);
${actorSql(admin)}
`,
  )
  .join("\n")}
reset role;
rollback to savepoint authorization_effects;
select pg_temp.auth_assert(pg_temp.auth_fingerprint()=pg_temp.auth_get('before'),'whole authorization regression restores every durable row exactly');
select jsonb_build_object('authorization_denials',true,'unrelated_confirm_cancel',true,'unscoped_delete',true,'rollback_integrity',true);
rollback;`;
}
