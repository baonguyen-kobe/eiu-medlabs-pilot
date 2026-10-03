create or replace function private.s5_snapshot(p_event uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('event',to_jsonb(e),'issues',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.equipment_issue_slices s where s.event_id=e.id),'[]'::jsonb),'effects',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.equipment_fulfillment_effects f where f.event_id=e.id),'[]'::jsonb)) from public.equipment_fulfillment_events e where e.id=p_event;
$$;
create or replace function public.equipment_fulfillment_command(p_operation text,p_request_id uuid,p_payload jsonb,p_retry_key uuid)
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
  elsif effective_operation in ('initial_return','recover') then perform private.s5_receive(event_id,p_payload->'lines',effective_operation='recover' and p_operation<>'correct');
  elsif effective_operation='resolve' then perform private.s5_resolve(event_id,p_payload->'lines');
  else perform private.s5_admin_effect(event_id,p_payload); end if;
 end if;
 if exists(select 1 from public.equipment_issue_slices s join public.equipment_fulfillment_events ev on ev.id=s.event_id cross join lateral private.s5_obligation(s.id) o where ev.request_id=r.id and (o.issued<0 or o.returned<0 or o.resolved<0 or o.due<0 or o.held<0 or o.returned+o.resolved>o.issued or o.held>o.returned)) then raise exception 'S5_OBLIGATION_INVARIANT'; end if;
 complete:=exists(select 1 from public.equipment_fulfillment_events where request_id=r.id and (operation='initial_return' or (operation='correct' and payload->>'effective_operation'='initial_return')) and not exists(select 1 from public.equipment_fulfillment_events newer where newer.corrects_event_id=id))
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
