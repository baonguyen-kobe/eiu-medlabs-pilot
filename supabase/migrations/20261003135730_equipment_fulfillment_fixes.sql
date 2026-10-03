-- S5 Edge boundary fixes (review findings P1/P2)
-- Drop obsolete 2-argument signature of private.s5_pool_hold before recreating
drop function if exists private.s5_pool_hold(uuid, uuid);

create or replace function private.s5_receive(p_event uuid,p_lines jsonb,p_cumulative boolean)
returns void language plpgsql security definer set search_path='' as $$
declare e public.equipment_fulfillment_events; s public.equipment_issue_slices; o record; j jsonb; q numeric; already numeric; remaining numeric; offset_q numeric; f record; loc uuid; cond text; asset public.equipment_assets; settled boolean; seen text[]:='{}'; key text;
begin
 select * into strict e from public.equipment_fulfillment_events where id=p_event;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)>500 then raise exception 'S5_RECEIPT_LINES_REQUIRED'; end if;
 for j in select value from jsonb_array_elements(p_lines) loop
  select sl.* into s from public.equipment_issue_slices sl join public.equipment_fulfillment_events ev on ev.id=sl.event_id where sl.id=(j->>'issue_slice_id')::uuid and ev.request_id=e.request_id;
  if not found or not s.return_required then raise exception 'S5_RETURNABLE_ISSUE_REQUIRED'; end if;
  loc:=(j->>'location_id')::uuid; cond:=j->>'condition'; key:=s.id::text||':'||coalesce(cond,'');
  if key=any(seen) then raise exception 'S5_DUPLICATE_RECEIPT_TARGET'; end if;
  seen:=array_append(seen,key);
  if cond is null or cond not in ('good','damaged') or not exists(select 1 from public.inventory_storage_locations where id=loc) then raise exception 'S5_RECEIPT_LOCATION_CONDITION_REQUIRED'; end if;
  q:=private.s4_quantity(j->>'quantity');
  if q<>(select round(q,u.allowed_scale) from public.inventory_catalog_items i join public.inventory_uoms u on u.code=i.base_uom_code where i.id=s.inventory_item_id) then raise exception 'S5_INVALID_QUANTITY'; end if;
  if p_cumulative then
   select coalesce(sum(quantity),0) into already from public.equipment_fulfillment_effects where issue_slice_id=s.id and kind='receipt' and condition=cond;
   q:=q-already;
   if q<0 then raise exception 'S5_CUMULATIVE_DECREASE_REQUIRES_CORRECTION'; end if;
  end if;
  if q=0 then continue; end if;
  select * into o from private.s5_obligation(s.id);
  if q>o.issued-o.returned or (s.asset_id is not null and q<>1) then raise exception 'S5_RETURN_EXCEEDS_ISSUE'; end if;
  -- Offset only the part of the physical intake previously resolved away.
  remaining:=greatest(0,q-o.due);
  for f in select ef.id,ef.quantity+coalesce((select sum(off.quantity) from public.equipment_fulfillment_effects off where off.offsets_effect_id=ef.id and off.kind='resolution'),0) available
    from public.equipment_fulfillment_effects ef where ef.issue_slice_id=s.id and ef.kind='resolution' and ef.quantity>0 order by ef.id loop
   exit when remaining=0;
   offset_q:=least(remaining,f.available);
   if offset_q<=0 then continue; end if;
   insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,classification,offsets_effect_id) values(e.id,s.id,'resolution',-offset_q,'late_return',f.id);
   remaining:=remaining-offset_q;
  end loop;
  if remaining<>0 then raise exception 'S5_RESOLUTION_OFFSET_INVARIANT'; end if;
  settled:=coalesce((select sum(quantity) from public.equipment_fulfillment_effects where issue_slice_id=s.id and kind='consequence'),0)>0;
  insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,location_id,condition) values(e.id,s.id,'receipt',q,loc,cond);
  if settled then insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,location_id,condition,classification) values(e.id,s.id,'hold',q,loc,cond,'prior_administrative_consequence'); end if;
  if s.asset_id is null then
   perform private.s5_stock(e.transaction_id,s.cohort_id,s.inventory_item_id,loc,cond,q);
  else
   select * into strict asset from public.equipment_assets where id=s.asset_id for update;
   perform private.s5_asset(e.transaction_id,asset.id,loc,null,case when settled or asset.lifecycle_status in ('retired','disposed') then 'prohibited' when cond='damaged' then 'damaged' else 'ready' end,asset.lifecycle_status,e.reason);
  end if;
 end loop;
end; $$;

create or replace function private.s5_resolve(p_event uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare e public.equipment_fulfillment_events; j jsonb; s public.equipment_issue_slices; o record; q numeric; classification text;
begin
 select * into strict e from public.equipment_fulfillment_events where id=p_event;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 500 then raise exception 'S5_RESOLUTION_LINES_REQUIRED'; end if;
 for j in select value from jsonb_array_elements(p_lines) loop
  select sl.* into s from public.equipment_issue_slices sl join public.equipment_fulfillment_events ev on ev.id=sl.event_id where sl.id=(j->>'issue_slice_id')::uuid and ev.request_id=e.request_id;
  if not found or not s.return_required then raise exception 'S5_RETURNABLE_ISSUE_REQUIRED'; end if;
  select * into o from private.s5_obligation(s.id);
  q:=private.s4_quantity(j->>'quantity'); classification:=j->>'classification';
  if q<>(select round(q,u.allowed_scale) from public.inventory_catalog_items i join public.inventory_uoms u on u.code=i.base_uom_code where i.id=s.inventory_item_id) then raise exception 'S5_INVALID_QUANTITY'; end if;
  if q<=0 or q>o.due or (s.asset_id is not null and q<>1) then raise exception 'S5_RESOLUTION_EXCEEDS_DUE'; end if;
  if classification is null or classification not in ('missing','unrecoverable','waived') then raise exception 'S5_RESOLUTION_CLASSIFICATION_REQUIRED'; end if;
  insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,classification) values(e.id,s.id,'resolution',q,classification);
 end loop;
end; $$;
revoke all on function private.s5_receive(uuid,jsonb,boolean),private.s5_resolve(uuid,jsonb) from public,anon,authenticated;


create or replace function private.s5_admin_effect(p_event uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare e public.equipment_fulfillment_events; s public.equipment_issue_slices; o record; a public.equipment_assets; q numeric; action text; h record; remaining numeric; take numeric;
begin
 if not private.is_inventory_admin() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into strict e from public.equipment_fulfillment_events where id=p_event;
 select sl.* into s from public.equipment_issue_slices sl join public.equipment_fulfillment_events ev on ev.id=sl.event_id where sl.id=(p_payload->>'issue_slice_id')::uuid and ev.request_id=e.request_id;
 if not found then raise exception 'S5_ISSUE_REQUIRED'; end if;
 select * into o from private.s5_obligation(s.id);
 q:=private.s4_quantity(p_payload->>'quantity'); action:=p_payload->>'classification';
 if q<>(select round(q,u.allowed_scale) from public.inventory_catalog_items i join public.inventory_uoms u on u.code=i.base_uom_code where i.id=s.inventory_item_id) then raise exception 'S5_INVALID_QUANTITY'; end if;
 if nullif(btrim(p_payload->>'evidence'),'') is null or q<=0 or (s.asset_id is not null and q<>1) then raise exception 'S5_ADMIN_EVIDENCE_QUANTITY_REQUIRED'; end if;
 if e.operation='consequence' or (e.operation='correct' and e.payload->>'effective_operation'='consequence') then
  if action is null or action not in ('settled','retired','disposed') or (s.asset_id is null and action<>'settled') then raise exception 'S5_INVALID_CONSEQUENCE'; end if;
  if q>o.resolved-coalesce((select sum(quantity) from public.equipment_fulfillment_effects where issue_slice_id=s.id and kind='consequence'),0) then raise exception 'S5_UNSETTLED_RESOLUTION_REQUIRED'; end if;
  insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,classification) values(e.id,s.id,'consequence',q,action);
  if s.asset_id is not null then
   select * into strict a from public.equipment_assets where id=s.asset_id for update;
   perform private.s5_asset(e.transaction_id,a.id,a.location_id,a.custodian_id,'prohibited',case when action='settled' then a.lifecycle_status else action end,e.reason);
  end if;
 else
  if q>o.held then raise exception 'S5_HOLD_REQUIRED'; end if;
  if action is null or action not in ('retain_ineligible','restore_eligible') then raise exception 'S5_RECONCILIATION_ACTION_REQUIRED'; end if;
  if s.asset_id is null and action='retain_ineligible' then raise exception 'S5_RETAIN_HOLD_NO_RECONCILIATION_REQUIRED'; end if;
  remaining:=q;
  for h in select ef.*,ef.quantity+coalesce((select sum(off.quantity) from public.equipment_fulfillment_effects off where off.offsets_effect_id=ef.id and off.kind in ('hold','reconciliation')),0) available
   from public.equipment_fulfillment_effects ef where ef.issue_slice_id=s.id and ef.kind='hold' and ef.quantity>0
   and (ef.condition='good' or s.asset_id is not null)
   order by ef.id loop
   exit when remaining=0;
   take:=least(remaining,h.available);
   if take<=0 then continue; end if;
   insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,location_id,condition,classification,offsets_effect_id) values(e.id,s.id,'reconciliation',-take,h.location_id,h.condition,action,h.id);
   remaining:=remaining-take;
   if s.asset_id is not null then
    select * into strict a from public.equipment_assets where id=s.asset_id for update;
    if action='restore_eligible' and a.lifecycle_status='disposed' then raise exception 'DISPOSED_REACTIVATION_FORBIDDEN'; end if;
    perform private.s5_asset(e.transaction_id,a.id,a.location_id,a.custodian_id,case when action='retain_ineligible' then 'prohibited' when h.condition='damaged' then 'damaged' else 'ready' end,case when action='restore_eligible' then 'in_service' else a.lifecycle_status end,e.reason);
   end if;
  end loop;
  if remaining<>0 then raise exception 'S5_HOLD_OFFSET_INVARIANT'; end if;
 end if;
end; $$;
revoke all on function private.s5_admin_effect(uuid,jsonb) from public,anon,authenticated;


create unique index if not exists equipment_fulfillment_one_successor on public.equipment_fulfillment_events(corrects_event_id) where corrects_event_id is not null;

-- Reverse only the target version's own facts, not its predecessor offsets.
-- All inverses and replacement facts commit together, including signature state.
create or replace function private.s5_reverse_event(p_event uuid,p_target uuid)
returns void language plpgsql security definer set search_path='' as $$
declare e public.equipment_fulfillment_events; target public.equipment_fulfillment_events; slice_rec public.equipment_issue_slices; eff_rec record; a record; current_asset public.equipment_assets; before_asset jsonb; last_asset uuid;
begin
 select * into strict e from public.equipment_fulfillment_events where id=p_event;
 select * into strict target from public.equipment_fulfillment_events where id=p_target and request_id=e.request_id;
 if target.operation in ('consequence','reconcile') or exists(select 1 from public.equipment_fulfillment_effects where event_id=target.id and kind in ('consequence','reconciliation')) then
  if not private.is_inventory_admin() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 end if;
 -- Restore exact physical asset before-state for target replacement facts only,
 -- skipping predecessor assets whose mutations in target transaction were compensation-only.
 -- Reverse applies only when no later asset event would be erased.
 for a in with target_replacement_assets as (
   select s.asset_id, count(*)::int as own_facts
   from public.equipment_issue_slices s
   where s.event_id=target.id and s.asset_id is not null
   group by s.asset_id
   union all
   select s.asset_id, count(*)::int as own_facts
   from public.equipment_fulfillment_effects eff
   join public.equipment_issue_slices s on s.id=eff.issue_slice_id
   where eff.event_id=target.id and s.asset_id is not null
     and eff.kind in ('receipt','consequence','reconciliation')
     and (eff.offsets_effect_id is null or (eff.kind='reconciliation' and eff.classification<>'correction'))
   group by s.asset_id
  ),
  grouped_replacements as (
   select asset_id, sum(own_facts)::int as own_facts
   from target_replacement_assets
   group by asset_id
  ),
  target_ranked_mutations as (
   select ae.asset_id, ae.before_state,
          row_number() over (partition by ae.asset_id order by ae.revision desc) as rn_desc
   from public.equipment_asset_events ae
   where ae.transaction_id=target.transaction_id
  )
  select m.asset_id, m.before_state
  from target_ranked_mutations m
  join grouped_replacements g on g.asset_id=m.asset_id and m.rn_desc=g.own_facts
 loop
  select transaction_id into last_asset from public.equipment_asset_events where asset_id=a.asset_id order by revision desc limit 1;
  if last_asset<>target.transaction_id then raise exception 'S5_DEPENDENT_ASSET_HISTORY'; end if;
  before_asset:=a.before_state;
  select * into strict current_asset from public.equipment_assets where id=a.asset_id for update;
  perform private.s5_asset(e.transaction_id,a.asset_id,(before_asset->>'location_id')::uuid,(before_asset->>'custodian_id')::uuid,before_asset->>'operational_status',before_asset->>'lifecycle_status',e.reason);
 end loop;
 for slice_rec in select * from public.equipment_issue_slices where event_id=target.id loop
  if exists(select 1 from public.equipment_fulfillment_effects where issue_slice_id=slice_rec.id) then raise exception 'S5_DEPENDENT_ISSUE_HISTORY'; end if;
  insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,classification) values(e.id,slice_rec.id,'issue_correction',-slice_rec.quantity,'superseded_issue');
  if slice_rec.cohort_id is not null then perform private.s5_stock(e.transaction_id,slice_rec.cohort_id,slice_rec.inventory_item_id,slice_rec.location_id,'good',slice_rec.quantity); end if;
 end loop;
 for eff_rec in select * from public.equipment_fulfillment_effects where event_id=target.id and kind<>'issue_correction' and (offsets_effect_id is null or (kind='reconciliation' and classification<>'correction')) order by case when kind='hold' then 0 else 1 end,id loop
  select * into strict slice_rec from public.equipment_issue_slices where id=eff_rec.issue_slice_id;
  if eff_rec.kind='receipt' and slice_rec.cohort_id is not null then
   if eff_rec.condition='good' and eff_rec.quantity>private.s4_available(slice_rec.cohort_id,eff_rec.location_id) then raise exception 'S5_CORRECTION_BACKING_RESERVED_OR_HELD'; end if;
   perform private.s5_stock(e.transaction_id,slice_rec.cohort_id,slice_rec.inventory_item_id,eff_rec.location_id,eff_rec.condition,-eff_rec.quantity);
  end if;
  insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,location_id,condition,classification,offsets_effect_id)
  values(e.id,slice_rec.id,eff_rec.kind,-eff_rec.quantity,eff_rec.location_id,eff_rec.condition,'correction',case when eff_rec.kind='reconciliation' then eff_rec.offsets_effect_id else eff_rec.id end);
 end loop;
 -- A late receipt also carried resolution offsets. Undo those explicitly;
 -- offsets created by a prior correction are not target physical facts.
 for eff_rec in select * from public.equipment_fulfillment_effects where event_id=target.id and classification='late_return' loop
  insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,classification,offsets_effect_id)
  values(e.id,eff_rec.issue_slice_id,'resolution',-eff_rec.quantity,'correction',eff_rec.offsets_effect_id);
 end loop;
end; $$;
revoke all on function private.s5_reverse_event(uuid,uuid) from public,anon,authenticated;


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


-- These guards also cover pre-existing S1/S2/S3 administrative writers.
create or replace function private.s5_pool_hold(p_cohort uuid,p_location uuid,p_condition text)
returns numeric language sql stable security definer set search_path='' as $$
 select greatest(0,coalesce(sum(f.quantity),0)) from public.equipment_fulfillment_effects f join public.equipment_issue_slices s on s.id=f.issue_slice_id where s.cohort_id=p_cohort and f.location_id=p_location and f.condition=p_condition and f.kind in ('hold','reconciliation');
$$;
create or replace function private.s4_pool_backing(p_cohort uuid,p_location uuid)
returns numeric language sql stable security definer set search_path='' as $$
 select greatest(0,coalesce((select b.quantity from public.inventory_stock_balances b
 join public.inventory_stock_origins o on o.id=b.cohort_id join public.inventory_receipt_cohorts c on c.origin_id=o.id join public.inventory_stock_facts f on f.id=c.current_fact_id join public.inventory_catalog_items i on i.id=o.catalog_item_id join public.inventory_storage_locations l on l.id=b.location_id
 where b.cohort_id=p_cohort and b.location_id=p_location and b.condition='good' and i.active and l.active
 and not exists(select 1 from public.inventory_stock_holds h where h.origin_id=o.id and h.status='active')
 and (not i.expiry_required or (f.expiry_precision in ('day','month') and f.expiry_date is not null))
 and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)),0)-private.s5_pool_hold(p_cohort,p_location,'good'));
$$;
create or replace function private.s4_asset_eligible(p_asset uuid,p_location uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.equipment_assets a join public.inventory_catalog_items i on i.id=a.catalog_item_id join public.inventory_storage_locations l on l.id=a.location_id
 where a.id=p_asset and a.location_id=p_location and i.active and l.active and a.lifecycle_status='in_service' and a.operational_status='ready'
 and (not i.expiry_required or (a.expiry_precision in ('day','month') and a.expiry_date is not null))
 and (a.expiry_date is null or a.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)
 and not exists(select 1 from public.equipment_issue_slices s cross join lateral private.s5_obligation(s.id) o where s.asset_id=a.id and (o.issued>o.returned or o.held>0)));
$$;
create or replace function private.s5_guard_asset_custody()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('app.s5_command',true),'')<>'true'
 and row(new.location_id,new.custodian_id,new.operational_status,new.lifecycle_status) is distinct from row(old.location_id,old.custodian_id,old.operational_status,old.lifecycle_status)
 and exists(select 1 from public.equipment_issue_slices s cross join lateral private.s5_obligation(s.id) o where s.asset_id=old.id and (o.issued>o.returned or o.held>0)) then raise exception 'S5_USE_FULFILLMENT_CUSTODY_RECONCILIATION'; end if;
 return new;
end; $$;
drop trigger if exists equipment_assets_s5_custody on public.equipment_assets;
create trigger equipment_assets_s5_custody before update on public.equipment_assets for each row execute function private.s5_guard_asset_custody();
create or replace function private.s5_guard_held_stock()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.quantity<private.s5_pool_hold(old.cohort_id,old.location_id,old.condition) and coalesce(current_setting('app.s5_command',true),'')<>'true' then raise exception 'S5_RECONCILIATION_HOLD'; end if;
 return new;
end; $$;
drop trigger if exists inventory_stock_s5_hold on public.inventory_stock_balances;
create trigger inventory_stock_s5_hold before update on public.inventory_stock_balances for each row execute function private.s5_guard_held_stock();
create or replace function private.s5_guard_request_projection()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('app.s5_command',true),'')<>'true' and exists(select 1 from public.equipment_preparations where request_id=old.id)
 and (new.fulfillment_revision is distinct from old.fulfillment_revision
 or row(new.handover_staff_confirmed_by,new.handover_staff_confirmed_at,new.handover_signature_path,new.handover_recipient_signed_at,new.handover_effective_at,new.return_staff_confirmed_by,new.return_staff_confirmed_at,new.return_signature_path,new.return_recipient_signed_at,new.return_effective_at)
 is distinct from row(old.handover_staff_confirmed_by,old.handover_staff_confirmed_at,old.handover_signature_path,old.handover_recipient_signed_at,old.handover_effective_at,old.return_staff_confirmed_by,old.return_staff_confirmed_at,old.return_signature_path,old.return_recipient_signed_at,old.return_effective_at)) then raise exception 'S5_USE_EVENT_BOUND_FULFILLMENT'; end if;
 return new;
end; $$;
drop trigger if exists equipment_requests_s5_projection on public.equipment_requests;
create trigger equipment_requests_s5_projection before update on public.equipment_requests for each row execute function private.s5_guard_request_projection();
revoke all on function private.s5_pool_hold(uuid,uuid,text),private.s5_guard_asset_custody(),private.s5_guard_held_stock(),private.s5_guard_request_projection() from public,anon,authenticated;
