begin;
create or replace function private.s4_sync_lines(p_request uuid,p_items jsonb,p_basic_skill text default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; j jsonb; item_id uuid; seen uuid[]:='{}'; old_line public.equipment_request_items; previous_context text;
begin
 select * into r from public.equipment_requests where id=p_request for update;
 if not private.is_active_user() or not (r.registrant_id=auth.uid() or private.can_manage_equipment_request(r.id)) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 500 then raise exception 'EQUIPMENT_REQUEST_ITEMS_REQUIRED' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) entry where (entry->>'expected_revision')::bigint is distinct from r.preparation_revision) then raise exception 'STALE_REVISION' using errcode='23505'; end if;
 if r.status not in ('new','preparing') or (r.request_domain='nursing_skills' and r.status<>'new') then raise exception 'S4_USE_QUANTITY_ADJUSTMENT' using errcode='42501'; end if;
 previous_context:=current_setting('app.s4_command',true);
 perform set_config('app.s4_command','true',true);
 perform set_config('app.s4_registration','',true);
 -- Remove excluded identities before inserting replacements, so the old
 -- commercial-name guard cannot mistake a tombstone for an active duplicate.
 update public.equipment_request_items l set removed_at=clock_timestamp()
 where l.request_id=p_request and l.removed_at is null
   and not exists(select 1 from jsonb_array_elements(p_items) entry where nullif(entry->>'id','')::uuid=l.id);
 for j in select value from jsonb_array_elements(p_items) loop
  if (j->>'quantity')::integer<1 then raise exception 'INVALID_QUANTITY' using errcode='22023'; end if;
  item_id:=nullif(j->>'id','')::uuid;
  if item_id is not null then
   select * into old_line from public.equipment_request_items where id=item_id and request_id=p_request and removed_at is null;
   if not found or item_id=any(seen) then raise exception 'S4_INVALID_LINE_ID' using errcode='22023'; end if;
   update public.equipment_request_items set skill_name=coalesce(p_basic_skill,btrim(j->>'skill_name')),catalog_item_id=case when r.request_domain='nursing_skills' then (j->>'catalog_item_id')::uuid end,basic_medical_catalog_item_id=case when r.request_domain='basic_medical' then (j->>'catalog_item_id')::uuid end,quantity=(j->>'quantity')::integer,note=nullif(btrim(j->>'note'),'') where id=item_id;
  else
   insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,basic_medical_catalog_item_id,quantity,note)
   values(p_request,coalesce(p_basic_skill,btrim(j->>'skill_name')),case when r.request_domain='nursing_skills' then (j->>'catalog_item_id')::uuid end,case when r.request_domain='basic_medical' then (j->>'catalog_item_id')::uuid end,(j->>'quantity')::integer,nullif(btrim(j->>'note'),'')) returning id into item_id;
  end if;
  seen:=array_append(seen,item_id);
 end loop;
 perform set_config('app.s4_command',coalesce(previous_context,''),true);
end; $$;

-- Operational additions remain inside the existing fulfillment P1 writer lane.
create or replace function public.remove_equipment_request_item(target_item_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; ln public.equipment_request_items; previous_context text;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 if not private.is_active_user() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into ln from public.equipment_request_items where id=target_item_id and removed_at is null;
 select * into r from public.equipment_requests where id=ln.request_id for update;
 if not found or not(r.registrant_id=auth.uid() or private.can_manage_equipment_request(r.id)) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if r.status<>'new' and r.request_domain='nursing_skills' then raise exception 'S4_USE_QUANTITY_ADJUSTMENT'; end if;
 if r.status not in ('new','preparing') then raise exception 'EQUIPMENT_REQUEST_NOT_EDITABLE'; end if;
 previous_context:=current_setting('app.s4_command',true);
 perform set_config('app.s4_command','true',true);
 update public.equipment_request_items set removed_at=clock_timestamp() where id=ln.id;
 perform set_config('app.s4_command',coalesce(previous_context,''),true);
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'equipment_request.item_removed','equipment_request',r.id,jsonb_build_object('item_id',ln.id));
 return true;
end; $$;
revoke all on function public.remove_equipment_request_item(uuid) from public,anon;
grant execute on function public.remove_equipment_request_item(uuid) to authenticated;

create or replace function public.add_equipment_request_item(target_request_id uuid,target_skill_name text,target_catalog_item_id uuid,target_quantity integer,target_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; item_id uuid; previous_context text;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 if not private.is_active_user() or not private.can_manage_equipment_request(target_request_id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into r from public.equipment_requests where id=target_request_id for update;
 if r.status<>'new' or r.request_domain<>'nursing_skills' then raise exception 'S4_USE_QUANTITY_ADJUSTMENT'; end if;
 if target_quantity is null or target_quantity not between 1 and 9999 or nullif(btrim(target_skill_name),'') is null then raise exception 'INVALID_QUANTITY'; end if;
 if not exists(select 1 from public.equipment_catalog where id=target_catalog_item_id and is_active) then raise exception 'CATALOG_ITEM_INACTIVE_OR_MISSING'; end if;
 if not exists(select 1 from public.equipment_request_items where request_id=r.id and skill_name=btrim(target_skill_name) and removed_at is null) then raise exception 'SKILL_NOT_FOUND_IN_REQUEST'; end if;
 perform set_config('app.s4_registration','',true);
 previous_context:=current_setting('app.s4_command',true);
 perform set_config('app.s4_command','true',true);
 insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,quantity,note) values(r.id,btrim(target_skill_name),target_catalog_item_id,target_quantity,nullif(btrim(target_note),'')) returning id into item_id;
 perform set_config('app.s4_command',coalesce(previous_context,''),true);
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'equipment_request.item_added','equipment_request',r.id,jsonb_build_object('item_id',item_id,'quantity',target_quantity));
 return item_id;
end; $$;
revoke all on function public.add_equipment_request_item(uuid,text,uuid,integer,text) from public,anon;
grant execute on function public.add_equipment_request_item(uuid,text,uuid,integer,text) to authenticated;

create or replace function private.s5_add_supplemental_line(p_request uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; m public.equipment_inventory_mappings; ref public.equipment_request_items; q numeric; previous_context text; new_line uuid;
begin
 select * into strict r from public.equipment_requests where id=p_request for update;
 if not private.is_active_user() or not private.can_access_inventory() or not private.can_manage_equipment_request(r.id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if r.status<>'handed_over' or exists(select 1 from public.equipment_fulfillment_events where request_id=r.id and operation='initial_return') then raise exception 'S5_SUPPLEMENT_BEFORE_INITIAL_RETURN_REQUIRED'; end if;
 if nullif(btrim(p_payload->>'reason'),'') is null or length(p_payload->>'reason')>1000 or length(coalesce(p_payload->>'note',''))>1000 then raise exception 'S5_AMENDMENT_REASON_REQUIRED' using errcode='22023'; end if;
 q:=private.s4_quantity(p_payload->>'requested_quantity');
 if q<1 or q<>trunc(q) or q>2147483647 then raise exception 'S4_DEMAND_UNIT_INTEGER_REQUIRED' using errcode='22023'; end if;
 select * into ref from public.equipment_request_items where id=(p_payload->>'reference_line_id')::uuid and request_id=r.id and removed_at is null;
 if not found then raise exception 'S4_INVALID_LINE_ID' using errcode='22023'; end if;
 select * into m from public.equipment_inventory_mappings where id=(p_payload->>'mapping_id')::uuid;
 if not found or not exists(select 1 from public.equipment_catalog where id=m.catalog_item_id and is_active)
  or not exists(select 1 from public.inventory_catalog_items where id=m.inventory_item_id and active and return_semantics<>'in_place')
  or not exists(select 1 from public.inventory_storage_locations where id=(p_payload->>'location_id')::uuid and active)
  or exists(select 1 from public.equipment_request_items where request_id=r.id and catalog_item_id=m.catalog_item_id and removed_at is null) then raise exception 'S5_NEW_MAPPED_CATALOG_REQUIRED' using errcode='22023'; end if;
 perform private.p1_request_gate(m.inventory_item_id,(p_payload->>'location_id')::uuid,null,r.id);
 new_line:=(p_payload->>'line_id')::uuid;
 previous_context:=current_setting('app.s4_command',true);
 perform set_config('app.s4_command','true',true);
 perform private.s4_add_line(r.id,new_line,m.catalog_item_id,ref.skill_name,q::integer,p_payload->>'note');
 perform set_config('app.s4_command',coalesce(previous_context,''),true);
 insert into public.equipment_preparation_events(request_id,operation,actor_id,revision,payload)
 values(r.id,'supplemental_line_requested',auth.uid(),(select preparation_revision from public.equipment_requests where id=r.id),p_payload);
 return jsonb_build_object('line_id',new_line,'requested_quantity',q::text,'stock_effect',false);
end; $$;
revoke all on function private.s5_add_supplemental_line(uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.equipment_operations_read(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare page integer; phase text; search_text text; rows jsonb; total bigint;
begin
 if not private.is_active_user() or not private.can_access_inventory() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if jsonb_typeof(p_filters) is distinct from 'object' then raise exception 'S4_INVALID_FILTER' using errcode='22023'; end if;
 page:=coalesce((p_filters->>'page')::integer,1); phase:=coalesce(p_filters->>'phase','all'); search_text:=coalesce(btrim(p_filters->>'search'),'');
 if page not between 1 and 100000 or phase not in ('all','prepare','handover','signature','return','hold') or length(search_text)>120 then raise exception 'S4_INVALID_FILTER' using errcode='22023'; end if;
 with scoped as (
  select r.id,r.status,r.receive_at,r.return_at,(r.return_at<now()) return_overdue,s.course_code_snapshot course_code,s.course_name_snapshot course_name,s.class_code,
   coalesce(pr.full_name,'') responsible_name,r.late_approval_status,
   exists(select 1 from public.equipment_preparations where request_id=r.id and state='prepared') prepared,
   exists(select 1 from public.equipment_preparations where request_id=r.id) has_preparation,
   (select count(*) from public.equipment_fulfillment_events e where e.request_id=r.id and e.signature_required
     and not exists(select 1 from public.equipment_fulfillment_events newer where newer.corrects_event_id=e.id)
     and not exists(select 1 from public.equipment_fulfillment_signatures sig where sig.event_id=e.id)) unsigned_count,
   (select count(*) from public.equipment_issue_slices sl join public.equipment_fulfillment_events e on e.id=sl.event_id cross join lateral private.s5_obligation(sl.id) o where e.request_id=r.id and o.due>0) due_line_count,
   (select count(*) from public.equipment_issue_slices sl join public.equipment_fulfillment_events e on e.id=sl.event_id cross join lateral private.s5_obligation(sl.id) o where e.request_id=r.id and o.held>0) hold_line_count
  from public.equipment_requests r join public.class_schedules s on s.id=r.class_schedule_id left join public.profiles pr on pr.id=r.responsible_lecturer_id
  where r.request_domain='nursing_skills' and private.can_manage_equipment_request(r.id)
   and (search_text='' or strpos(lower(concat_ws(' ',r.id::text,s.course_code_snapshot,s.course_name_snapshot,s.class_code,pr.full_name)),lower(search_text))>0)
 ), filtered as (
  select * from scoped where case phase
   when 'prepare' then status='new' when 'handover' then status='preparing' and prepared
   when 'signature' then unsigned_count>0 when 'return' then due_line_count>0 when 'hold' then hold_line_count>0
   else status in ('new','preparing','handed_over','returned') or unsigned_count>0 or due_line_count>0 or hold_line_count>0 end
 ), page_rows as (
  select * from filtered order by case when due_line_count>0 then return_at else receive_at end,id limit 30 offset (page-1)*30
 ) select (select count(*) from filtered),coalesce((select jsonb_agg(to_jsonb(x) order by case when x.due_line_count>0 then x.return_at else x.receive_at end,x.id) from page_rows x),'[]'::jsonb) into total,rows;
 return jsonb_build_object('rows',rows,'total',total,'page',page,'page_size',30);
end; $$;
revoke all on function public.equipment_operations_read(jsonb) from public,anon;
grant execute on function public.equipment_operations_read(jsonb) to authenticated;

create or replace function private.s5_snapshot(p_event uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('event',to_jsonb(e),'issues',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.equipment_issue_slices s where s.event_id=e.id),'[]'::jsonb),'effects',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.equipment_fulfillment_effects f where f.event_id=e.id),'[]'::jsonb)) from public.equipment_fulfillment_events e where e.id=p_event;
$$;
create or replace function private.p1_fulfillment_core(p_operation text,p_request_id uuid,p_payload jsonb,p_retry_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r public.equipment_requests; p public.equipment_preparations; e public.equipment_fulfillment_events; target public.equipment_fulfillment_events;
 manager boolean; h text; old_h text; result jsonb; effective_operation text; tx uuid; event_id uuid; reason text; snapshot jsonb; required boolean; complete boolean; effective_payload jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 if actor is null or not private.is_active_user() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into r from public.equipment_requests where id=p_request_id for update;
 if not found or r.request_domain<>'nursing_skills' or not private.can_read_preparation(r.id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 manager:=private.can_access_inventory() and private.can_manage_equipment_request(r.id);
 if p_operation='sign' then
  if actor is distinct from r.registrant_id and actor is distinct from r.responsible_lecturer_id then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 elsif not manager then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_operation in ('consequence','reconcile') and not private.is_inventory_admin() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_retry_key is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'INVALID_PAYLOAD'; end if;
 if p_payload ? 'return_entry_mode' and (p_operation<>'recover' or jsonb_typeof(p_payload->'return_entry_mode')<>'string' or p_payload->>'return_entry_mode' not in ('incremental','cumulative')) then raise exception 'S5_INVALID_RETURN_ENTRY_MODE' using errcode='22023'; end if;
 if p_payload ? 'carrier_name' and (p_operation not in ('initial_return','recover') or jsonb_typeof(p_payload->'carrier_name')<>'string' or length(p_payload->>'carrier_name')>200) then raise exception 'S5_INVALID_CARRIER_NAME' using errcode='22023'; end if;
 h:=encode(extensions.digest(convert_to(jsonb_build_object('request',r.id,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');
 select payload_hash,result_ids into old_h,result from public.inventory_operation_replays where actor_id=actor and operation='s5:'||p_operation and retry_key=p_retry_key;
 if found then
  if h<>old_h then raise exception 'RETRY_PAYLOAD_MISMATCH' using errcode='23505'; end if;
  return result;
 end if;
 if (p_payload->>'expected_revision')::bigint is distinct from r.fulfillment_revision then raise exception 'STALE_REVISION' using errcode='23505'; end if;
 select * into p from public.equipment_preparations where request_id=r.id and state='prepared' for update;
 if p.id is null or r.status not in ('preparing','handed_over','returned','completed') then raise exception 'S5_PREPARED_REQUEST_REQUIRED'; end if;
 perform set_config('app.s5_command','true',true);
 if p_operation='add_supplemental_line' then
  result:=private.s5_add_supplemental_line(r.id,p_payload);
  update public.equipment_requests set fulfillment_revision=fulfillment_revision+1 where id=r.id returning fulfillment_revision into r.fulfillment_revision;
  result:=result||jsonb_build_object('revision',r.fulfillment_revision);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data) values(actor,'equipment.fulfillment.add_supplemental_line','equipment_request',r.id,result);
  perform private.enqueue_equipment_request_outbox_event(r.id,'updated',p_retry_key,actor);
  insert into public.inventory_operation_replays(actor_id,operation,retry_key,payload_hash,result_ids) values(actor,'s5:'||p_operation,p_retry_key,h,result);
  perform set_config('app.s5_command','',true);
  return result;
 end if;
 if p_operation='sign' then
  select * into e from public.equipment_fulfillment_events where id=(p_payload->>'event_id')::uuid and request_id=r.id;
  if not found or not e.signature_required or exists(select 1 from public.equipment_fulfillment_events where corrects_event_id=e.id) then raise exception 'S5_CURRENT_SIGNABLE_EVENT_REQUIRED'; end if;
  snapshot:=private.s5_snapshot(e.id);
  h:=encode(extensions.digest(convert_to(snapshot::text,'UTF8'),'sha256'),'hex');
  if h is distinct from p_payload->>'snapshot_hash' then raise exception 'S5_SIGNATURE_SNAPSHOT_MISMATCH'; end if;
  insert into public.equipment_fulfillment_signatures(event_id,actor_id,snapshot_hash,signature) values(e.id,actor,h,p_payload->>'signature');
  event_id:=e.id;
 else
  if p_operation not in ('handover','supplement','initial_return','recover','resolve','consequence','reconcile','correct') then raise exception 'S5_UNKNOWN_OPERATION'; end if;
  reason:=nullif(btrim(p_payload->>'reason'),'');
  if reason is null or nullif(btrim(p_payload->>'business_key'),'') is null then raise exception 'S5_REASON_BUSINESS_KEY_REQUIRED'; end if;
  effective_operation:=p_operation; effective_payload:=p_payload;
  if p_operation='correct' then
   select * into target from public.equipment_fulfillment_events where id=(p_payload->>'event_id')::uuid and request_id=r.id;
   if not found or exists(select 1 from public.equipment_fulfillment_events where corrects_event_id=target.id) then raise exception 'S5_CURRENT_EVENT_REQUIRED'; end if;
   effective_operation:=case when target.operation='correct' then target.payload->>'effective_operation' else target.operation end;
   if effective_operation in ('consequence','reconcile') and not private.is_inventory_admin() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
   effective_payload:=p_payload||jsonb_build_object('effective_operation',effective_operation);
  end if;
  if effective_operation='handover' and p_operation<>'correct' then
   if r.status<>'preparing' or private.s4_health(p.id)<>'[]'::jsonb then raise exception 'S5_PREPARATION_RECONCILIATION_REQUIRED'; end if;
   update public.inventory_reservations set released_at=clock_timestamp() where preparation_id=p.id and released_at is null;
  elsif not exists(select 1 from public.equipment_fulfillment_events where request_id=r.id and operation='handover') then raise exception 'S5_HANDOVER_REQUIRED'; end if;
  if p_operation='supplement' and exists(select 1 from public.equipment_fulfillment_events where request_id=r.id and operation='initial_return') then raise exception 'S5_SUPPLEMENT_BEFORE_INITIAL_RETURN_REQUIRED'; end if;
  if effective_operation in ('recover','resolve','consequence','reconcile') and not exists(select 1 from public.equipment_fulfillment_events where request_id=r.id and operation='initial_return') then raise exception 'S5_INITIAL_RETURN_REQUIRED'; end if;
  required:=effective_operation in ('handover','supplement','initial_return');
  insert into public.inventory_transactions(operation,business_key,actor_id,occurred_at,reason,corrects_transaction_id) values('EQUIPMENT_FULFILLMENT',r.id::text||':'||(p_payload->>'business_key'),actor,clock_timestamp(),reason,target.transaction_id) returning id into tx;
  insert into public.equipment_fulfillment_events(request_id,preparation_id,revision,operation,business_key,actor_id,reason,payload,corrects_event_id,transaction_id,signature_required)
  values(r.id,p.id,r.fulfillment_revision+1,p_operation,p_payload->>'business_key',actor,reason,effective_payload,target.id,tx,required) returning id into event_id;
  if p_operation='correct' then perform private.s5_reverse_event(event_id,target.id); end if;
  if effective_operation in ('handover','supplement') then perform private.s5_issue(event_id,p_payload->'lines');
  elsif effective_operation in ('initial_return','recover') then perform private.s5_receive(event_id,p_payload->'lines',effective_operation='recover' and p_operation<>'correct' and coalesce(p_payload->>'return_entry_mode','cumulative')='cumulative');
  elsif effective_operation='resolve' then perform private.s5_resolve(event_id,p_payload->'lines');
  else perform private.s5_admin_effect(event_id,p_payload); end if;
 end if;
 if exists(select 1 from public.equipment_issue_slices s join public.equipment_fulfillment_events ev on ev.id=s.event_id cross join lateral private.s5_obligation(s.id) o where ev.request_id=r.id and (o.issued<0 or o.returned<0 or o.resolved<0 or o.due<0 or o.held<0 or o.returned+o.resolved>o.issued or o.held>o.returned)) then raise exception 'S5_OBLIGATION_INVARIANT'; end if;
 complete:=exists(select 1 from public.equipment_fulfillment_events initial_event where initial_event.request_id=r.id and (initial_event.operation='initial_return' or (initial_event.operation='correct' and initial_event.payload->>'effective_operation'='initial_return')) and not exists(select 1 from public.equipment_fulfillment_events newer where newer.corrects_event_id=initial_event.id))
  and not exists(select 1 from public.equipment_fulfillment_events ev where ev.request_id=r.id and ev.signature_required and not exists(select 1 from public.equipment_fulfillment_events newer where newer.corrects_event_id=ev.id) and not exists(select 1 from public.equipment_fulfillment_signatures sig where sig.event_id=ev.id))
  and not exists(select 1 from public.equipment_issue_slices s join public.equipment_fulfillment_events ev on ev.id=s.event_id cross join lateral private.s5_obligation(s.id) o where ev.request_id=r.id and o.due>0);
 perform set_config('app.equipment_confirmation_rpc','true',true);
 update public.equipment_requests set fulfillment_revision=fulfillment_revision+1,status=case when complete then 'completed' when exists(select 1 from public.equipment_fulfillment_events where request_id=r.id and (operation='initial_return' or (operation='correct' and payload->>'effective_operation'='initial_return'))) then 'returned' else 'handed_over' end where id=r.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data) values(actor,'equipment.fulfillment.'||p_operation,'equipment_request',r.id,jsonb_build_object('event_id',event_id,'revision',r.fulfillment_revision+1));
 perform private.enqueue_equipment_request_outbox_event(r.id,'updated',p_retry_key,actor);
 result:=jsonb_build_object('event_id',event_id,'revision',r.fulfillment_revision+1,'completed',complete);
 h:=encode(extensions.digest(convert_to(jsonb_build_object('request',r.id,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');
 insert into public.inventory_operation_replays(actor_id,operation,retry_key,payload_hash,result_ids) values(actor,'s5:'||p_operation,p_retry_key,h,result);
 perform set_config('app.s5_command','',true);
 return result;
end; $$;
revoke all on function private.s5_snapshot(uuid),public.equipment_fulfillment_command(text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.equipment_fulfillment_command(text,uuid,jsonb,uuid) to authenticated;

create or replace function public.equipment_fulfillment_read(p_request_id uuid,p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.equipment_requests; result jsonb; manager boolean;
begin
 if not private.is_active_user() or not private.can_read_preparation(p_request_id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into r from public.equipment_requests where id=p_request_id and request_domain='nursing_skills';
 if not found then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_page is null or p_page<1 or p_page>100000 then raise exception 'INVALID_PAGE'; end if;
 manager:=private.can_access_inventory() and private.can_manage_equipment_request(r.id);
 select jsonb_build_object('request_id',r.id,'revision',r.fulfillment_revision,'status',r.status,'manager',manager,'admin',manager and private.is_inventory_admin(),'signer',auth.uid() in (r.registrant_id,r.responsible_lecturer_id),
 'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'catalog_item_id',l.catalog_item_id,'name',c.commercial_name,'registered_quantity',l.registered_quantity,'planned_quantity',l.planned_quantity,'requested_quantity',l.quantity,'baseline_source',l.baseline_source,'unit',c.unit) order by l.id) from public.equipment_request_items l join public.equipment_catalog c on c.id=l.catalog_item_id where l.request_id=r.id and l.removed_at is null),'[]'::jsonb),
 'issues',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from(select s.*,o.*,a.asset_code,i.name item_name,i.base_uom_code from public.equipment_issue_slices s join public.equipment_fulfillment_events e on e.id=s.event_id join public.inventory_catalog_items i on i.id=s.inventory_item_id left join public.equipment_assets a on a.id=s.asset_id cross join lateral private.s5_obligation(s.id) o where e.request_id=r.id)x),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(x) order by x.revision desc) from(select e.*,private.s5_snapshot(e.id) snapshot,encode(extensions.digest(convert_to(private.s5_snapshot(e.id)::text,'UTF8'),'sha256'),'hex') snapshot_hash,
 (select coalesce(jsonb_agg(to_jsonb(display_row) order by display_row.id),'[]'::jsonb) from (
  select sl.id,'issue'::text kind,i.name item_name,i.base_uom_code unit,sl.quantity::text quantity,'good'::text condition,a.asset_code,sl.id issue_slice_id
  from public.equipment_issue_slices sl join public.inventory_catalog_items i on i.id=sl.inventory_item_id left join public.equipment_assets a on a.id=sl.asset_id where sl.event_id=e.id
  union all
  select f.id,f.kind,i.name,i.base_uom_code,f.quantity::text,f.condition,a.asset_code,sl.id
  from public.equipment_fulfillment_effects f join public.equipment_issue_slices sl on sl.id=f.issue_slice_id join public.inventory_catalog_items i on i.id=sl.inventory_item_id left join public.equipment_assets a on a.id=sl.asset_id where f.event_id=e.id
 ) display_row) display_lines,
 (select jsonb_build_object('actor_id',sig.actor_id,'signed_at',sig.signed_at,'snapshot_hash',sig.snapshot_hash) from public.equipment_fulfillment_signatures sig where sig.event_id=e.id) signature,
 exists(select 1 from public.equipment_fulfillment_events newer where newer.corrects_event_id=e.id) superseded
 from public.equipment_fulfillment_events e where e.request_id=r.id order by e.revision desc limit 50 offset (p_page-1)*50)x),'[]'::jsonb),
 'event_count',(select count(*) from public.equipment_fulfillment_events where request_id=r.id),
 'locations',case when manager then coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active) order by name,id) from public.inventory_storage_locations),'[]'::jsonb) else '[]'::jsonb end,
 'allocations',case when manager then coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.equipment_preparation_allocations a join public.equipment_preparation_plans pl on pl.id=a.plan_id where pl.preparation_id=(select id from public.equipment_preparations where request_id=r.id and state='prepared') and pl.revision=(select max(latest.revision) from public.equipment_preparation_plans latest where latest.preparation_id=pl.preparation_id)),'[]'::jsonb) else '[]'::jsonb end
 ) into result;
 return result;
end; $$;
revoke all on function public.equipment_fulfillment_read(uuid,integer) from public,anon,authenticated;
grant execute on function public.equipment_fulfillment_read(uuid,integer) to authenticated;

-- PostgREST computed field: expose only existence, not private warehouse drafts.
create or replace function public.has_inventory_preparation(p_request public.equipment_requests)
returns boolean language sql stable security definer set search_path='' as $$
 select private.can_read_preparation(p_request.id) and exists(select 1 from public.equipment_preparations where request_id=p_request.id);
$$;
revoke all on function public.has_inventory_preparation(public.equipment_requests) from public,anon,authenticated;
grant execute on function public.has_inventory_preparation(public.equipment_requests) to authenticated;

revoke all on function private.p1_fulfillment_core(text,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
notify pgrst, 'reload schema';
commit;
