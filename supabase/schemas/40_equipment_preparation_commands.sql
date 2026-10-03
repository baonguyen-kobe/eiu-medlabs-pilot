create or replace function public.equipment_preparation_command(p_operation text,p_request_id uuid,p_payload jsonb,p_retry_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; p public.equipment_preparations; adj public.equipment_quantity_adjustments;
 actor uuid:=auth.uid(); manager boolean; result jsonb; old_result jsonb; payload_hash text; old_hash text;
 j jsonb; line public.equipment_request_items; target numeric; plan_id uuid; mapping_id uuid; item record; token uuid;
 normalized_targets jsonb:='[]'::jsonb; new_line_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 if actor is null or not private.is_active_user() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into r from public.equipment_requests where id=p_request_id for update;
 if not found or r.request_domain<>'nursing_skills' or not private.can_read_preparation(r.id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 manager:=private.can_access_inventory() and private.can_manage_equipment_request(r.id);
 if p_operation not in ('propose_adjustment') and not manager then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_operation='propose_adjustment' and actor not in (r.registrant_id,r.responsible_lecturer_id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_operation in ('override_lock') and not private.is_inventory_admin() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_retry_key is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'INVALID_PAYLOAD'; end if;
 payload_hash:=encode(extensions.digest(convert_to(jsonb_build_object('request',r.id,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');
 select rr.payload_hash,rr.result_ids into old_hash,old_result from public.inventory_operation_replays rr where rr.actor_id=actor and rr.operation='s4:'||p_operation and rr.retry_key=p_retry_key;
 if found then
  if old_hash<>payload_hash then raise exception 'RETRY_PAYLOAD_MISMATCH' using errcode='23505'; end if;
  return old_result;
 end if;
 if r.status not in ('new','preparing') then raise exception 'S4_INVALID_REQUEST_STATE'; end if;
 if p_operation not in ('heartbeat','release_lock') and (p_payload->>'expected_revision')::bigint is distinct from r.preparation_revision then raise exception 'STALE_REVISION' using errcode='23505'; end if;
 select * into p from public.equipment_preparations where request_id=r.id and state in ('draft','prepared','reversing') for update;
 perform set_config('app.s4_command','true',true);
 perform set_config('app.s4_registration','',true);
 if p_operation='start' then
  if r.status<>'new' then raise exception 'S4_NEW_REQUIRED'; end if;
  token:=(p_payload->>'lock_token')::uuid;
  if token is null then raise exception 'S4_TAB_TOKEN_REQUIRED'; end if;
  if p.id is null then
   insert into public.equipment_preparations(request_id,source_revision,previous_preparer) values(r.id,r.preparation_revision,(select primary_preparer from public.equipment_preparations where request_id=r.id order by created_at desc limit 1)) returning * into p;
  end if;
  if p.state<>'draft' then raise exception 'S4_INVALID_STATE'; end if;
  if p.lock_expires_at>clock_timestamp() and (p.lock_holder<>actor or p.lock_token<>token) then raise exception 'S4_LOCK_HELD'; end if;
  update public.equipment_preparations set lock_holder=actor,lock_token=token,lock_expires_at=clock_timestamp()+private.s4_lock_inactivity() where id=p.id;
 elsif p_operation in ('save','heartbeat','release_lock','confirm') then
  if p.id is null or p.state<>'draft' or p.lock_holder is distinct from actor or p.lock_token is distinct from (p_payload->>'lock_token')::uuid or p.lock_expires_at<=clock_timestamp() then raise exception 'S4_LOCK_REQUIRED'; end if;
  if p_operation='save' then
   if (p_payload->>'draft_revision')::bigint is distinct from p.revision then raise exception 'STALE_REVISION' using errcode='23505'; end if;
   perform private.s4_validate_draft(p_payload->'plan');
   update public.equipment_preparations set draft=p_payload->'plan',revision=revision+1,source_revision=r.preparation_revision,lock_expires_at=clock_timestamp()+private.s4_lock_inactivity() where id=p.id;
  elsif p_operation='heartbeat' then
   update public.equipment_preparations set lock_expires_at=clock_timestamp()+private.s4_lock_inactivity() where id=p.id;
  elsif p_operation='release_lock' then
   update public.equipment_preparations set lock_holder=null,lock_token=null,lock_expires_at=null where id=p.id;
  else
   if (p_payload->>'draft_revision')::bigint is distinct from p.revision or p.source_revision<>r.preparation_revision then raise exception 'STALE_REVISION' using errcode='23505'; end if;
   plan_id:=private.s4_commit_plan(p.id,p_payload->'plan','Confirmed preparation');
   perform set_config('app.equipment_confirmation_rpc','true',true);
   update public.equipment_requests set status='preparing',preparation_revision=preparation_revision+1 where id=r.id;
   perform private.enqueue_equipment_request_outbox_event(r.id,'updated',p_retry_key,actor);
  end if;
 elsif p_operation='override_lock' then
  if p.id is null or p.state<>'draft' or nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'S4_REASON_REQUIRED'; end if;
  token:=nullif(p_payload->>'lock_token','')::uuid;
  if token is null then
   update public.equipment_preparations set lock_holder=null,lock_token=null,lock_expires_at=null,revision=revision+1 where id=p.id;
  else
   if not exists(select 1 from public.profiles pr where pr.id=(p_payload->>'holder_id')::uuid and pr.is_active) or not exists(select 1 from public.user_roles ur where ur.user_id=(p_payload->>'holder_id')::uuid and (ur.role='admin' or (ur.role='staff' and exists(select 1 from public.profile_room_types s join public.class_schedules cs on cs.id=r.class_schedule_id join public.rooms rm on rm.id=cs.room_id where s.profile_id=ur.user_id and s.room_type_id=rm.room_type_id)))) then raise exception 'AUTH_DENIED'; end if;
   update public.equipment_preparations set lock_holder=(p_payload->>'holder_id')::uuid,lock_token=token,lock_expires_at=clock_timestamp()+private.s4_lock_inactivity(),revision=revision+1 where id=p.id;
  end if;
 elsif p_operation='map_item' then
  if nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'S4_REASON_REQUIRED'; end if;
  select i.*,c.unit demand_unit into item from public.inventory_catalog_items i cross join public.equipment_catalog c where i.id=(p_payload->>'inventory_item_id')::uuid and c.id=(p_payload->>'catalog_item_id')::uuid and i.active and c.is_active;
  if not found then raise exception 'S4_MAPPING_REQUIRED'; end if;
  target:=private.s4_quantity(p_payload->>'base_units_per_requested_unit');
  if target<=0 then raise exception 'S4_INVALID_BASE_QUANTITY'; end if;
  insert into public.equipment_inventory_mappings(catalog_item_id,inventory_item_id,base_units_per_requested_unit,demand_unit,base_uom_code,reason,created_by) values((p_payload->>'catalog_item_id')::uuid,item.id,target,item.demand_unit,item.base_uom_code,p_payload->>'reason',actor) returning id into mapping_id;
 elsif p_operation='add_line' then
  if p.id is null or p.state<>'draft' or p.lock_holder is distinct from actor
     or p.lock_token is distinct from (p_payload->>'lock_token')::uuid
     or p.lock_expires_at<=clock_timestamp() then raise exception 'S4_LOCK_REQUIRED'; end if;
  if nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'S4_REASON_REQUIRED'; end if;
  target:=private.s4_quantity(p_payload->>'quantity');
  if target<1 or target<>trunc(target) or target>2147483647 then raise exception 'S4_DEMAND_UNIT_INTEGER_REQUIRED'; end if;
  new_line_id:=gen_random_uuid();
  perform private.s4_add_line(r.id,new_line_id,(p_payload->>'catalog_item_id')::uuid,p_payload->>'skill_name',target::integer,p_payload->>'note');
  select * into r from public.equipment_requests where id=r.id;
  update public.equipment_preparations set
   draft=jsonb_set(draft,'{lines}',coalesce(draft->'lines','[]'::jsonb)||jsonb_build_array(jsonb_build_object('line_id',new_line_id,'planned_quantity',target::text,'reviewed_revision',null,'shortage_reason','','allocations','[]'::jsonb))),
   revision=revision+1,source_revision=r.preparation_revision where id=p.id;
 elsif p_operation='propose_adjustment' then
  if nullif(btrim(p_payload->>'reason'),'') is null or jsonb_typeof(p_payload->'targets') is distinct from 'array' or jsonb_array_length(p_payload->'targets') not between 1 and 500 then raise exception 'S4_ADJUSTMENT_REASON_TARGETS_REQUIRED'; end if;
  for j in select value from jsonb_array_elements(p_payload->'targets') loop
   if nullif(j->>'line_id','') is null then raise exception 'S4_INVALID_LINE_ID'; end if;
   target:=private.s4_quantity(j->>'quantity');
   if target<>trunc(target) or target>2147483647 then raise exception 'S4_DEMAND_UNIT_INTEGER_REQUIRED'; end if;
   select * into line from public.equipment_request_items where id=(j->>'line_id')::uuid and request_id=r.id and removed_at is null;
   if found then
    normalized_targets:=normalized_targets||jsonb_build_array(jsonb_build_object('line_id',line.id,'quantity',target::text));
   else
    select * into item from public.equipment_catalog where id=(j->>'catalog_item_id')::uuid and is_active;
    if not found or target<1 or exists(select 1 from public.equipment_request_items where id=(j->>'line_id')::uuid)
       or not exists(select 1 from public.equipment_request_items where request_id=r.id and removed_at is null and skill_name=j->>'skill_name') then raise exception 'S4_INVALID_ADDED_LINE'; end if;
    normalized_targets:=normalized_targets||jsonb_build_array(jsonb_build_object('line_id',(j->>'line_id')::uuid,'quantity',target::text,'catalog_item_id',item.id,'skill_name',j->>'skill_name','note',coalesce(j->>'note',''),'commercial_name',item.commercial_name,'item_name',item.item_name,'unit',item.unit));
   end if;
  end loop;
  if (select count(*)<>count(distinct value->>'line_id') from jsonb_array_elements(p_payload->'targets')) then raise exception 'S4_DUPLICATE_LINE'; end if;
  insert into public.equipment_quantity_adjustments(request_id,submitted_revision,targets,reason,submitted_by) values(r.id,r.preparation_revision,normalized_targets,p_payload->>'reason',actor) returning * into adj;
 elsif p_operation in ('approve_adjustment','reject_adjustment') then
  select * into adj from public.equipment_quantity_adjustments where id=(p_payload->>'adjustment_id')::uuid and request_id=r.id and status='pending' for update;
  if not found then raise exception 'S4_PENDING_ADJUSTMENT_REQUIRED'; end if;
  if p_operation='approve_adjustment' then
   -- Explicit current-revision review is required even if submission is older.
   if (p_payload->>'reviewed_revision')::bigint is distinct from r.preparation_revision then raise exception 'STALE_REVISION' using errcode='23505'; end if;
   for j in select value from jsonb_array_elements(adj.targets) loop
    if not exists(select 1 from jsonb_array_elements(p_payload->'plan'->'lines') pl where pl->>'line_id'=j->>'line_id' and private.s4_quantity(pl->>'planned_quantity')=private.s4_quantity(j->>'quantity')) then raise exception 'S4_ABSOLUTE_TARGET_REQUIRED'; end if;
    if j ? 'catalog_item_id' then
     perform private.s4_add_line(r.id,(j->>'line_id')::uuid,(j->>'catalog_item_id')::uuid,j->>'skill_name',private.s4_quantity(j->>'quantity')::integer,j->>'note');
    end if;
    if r.status='new' then
     update public.equipment_request_items set planned_quantity=private.s4_quantity(j->>'quantity')::integer where id=(j->>'line_id')::uuid and request_id=r.id;
    end if;
   end loop;
   select * into r from public.equipment_requests where id=r.id;
   if p.state='reversing' then raise exception 'S4_REVERSAL_IN_PROGRESS'; end if;
   if r.status='preparing' then
    if exists(select 1 from jsonb_array_elements(p_payload->'plan'->'lines') pl
      join public.equipment_request_items l on l.id=(pl->>'line_id')::uuid and l.request_id=r.id
      where not exists(select 1 from jsonb_array_elements(adj.targets) t where t->>'line_id'=pl->>'line_id')
        and private.s4_quantity(pl->>'planned_quantity')<>l.planned_quantity) then raise exception 'S4_REALLOCATION_CANNOT_CHANGE_PLAN'; end if;
    plan_id:=private.s4_commit_plan(p.id,p_payload->'plan',adj.reason);
   else
    if p.id is null then insert into public.equipment_preparations(request_id,source_revision) values(r.id,r.preparation_revision) returning * into p; end if;
    -- Approval publishes only approved targets. Preserve the holder's unrelated
    -- warehouse progress, and force affected lines to be reviewed again.
    update public.equipment_preparations ep set draft=jsonb_build_object('lines',(
      select jsonb_agg(coalesce(saved.value,jsonb_build_object('line_id',l.id,'planned_quantity',l.planned_quantity::text,'reviewed_revision',null,'shortage_reason','','allocations','[]'::jsonb))
        ||case when target.value is not null then jsonb_build_object('planned_quantity',target.value->>'quantity','reviewed_revision',null) else '{}'::jsonb end order by l.created_at,l.id)
      from public.equipment_request_items l
      left join lateral (select value from jsonb_array_elements(ep.draft->'lines') where value->>'line_id'=l.id::text limit 1) saved on true
      left join lateral (select value from jsonb_array_elements(adj.targets) where value->>'line_id'=l.id::text limit 1) target on true
      where l.request_id=r.id and l.removed_at is null
    )),revision=revision+1,source_revision=r.preparation_revision+1 where ep.id=p.id;
   end if;
   update public.equipment_requests set preparation_revision=preparation_revision+1 where id=r.id;
  end if;
  update public.equipment_quantity_adjustments set status=case when p_operation='approve_adjustment' then 'approved' else 'rejected' end,reviewed_by=actor,reviewed_at=clock_timestamp(),review_note=p_payload->>'reason' where id=adj.id;
 elsif p_operation='reallocate' then
  if p.id is null or p.state<>'prepared' or nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'S4_PREPARED_REASON_REQUIRED'; end if;
  -- Reallocation changes backing, not the absolute committed target.
  for j in select value from jsonb_array_elements(p.draft->'lines') loop
   if not exists(select 1 from jsonb_array_elements(p_payload->'plan'->'lines') pl where pl->>'line_id'=j->>'line_id' and private.s4_quantity(pl->>'planned_quantity')=private.s4_quantity(j->>'planned_quantity')) then raise exception 'S4_REALLOCATION_CANNOT_CHANGE_PLAN'; end if;
  end loop;
  plan_id:=private.s4_commit_plan(p.id,p_payload->'plan',p_payload->>'reason');
  update public.equipment_requests set preparation_revision=preparation_revision+1 where id=r.id;
 elsif p_operation='begin_reversal' then
  if p.id is null or p.state not in ('draft','prepared') or nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'S4_PREPARED_REASON_REQUIRED'; end if;
  if p.state='draft' and (p.lock_holder is distinct from actor or p.lock_token is distinct from (p_payload->>'lock_token')::uuid or p.lock_expires_at<=clock_timestamp()) then raise exception 'S4_LOCK_REQUIRED'; end if;
  update public.equipment_preparations set state='reversing',revision=revision+1 where id=p.id;
  update public.equipment_requests set preparation_revision=preparation_revision+1 where id=r.id;
 elsif p_operation='finalize_reversal' then
  if p.id is null or p.state<>'reversing' then raise exception 'S4_REVERSAL_REQUIRED'; end if;
  if exists(select 1 from public.equipment_preparation_transfers t where t.preparation_id=p.id and t.compensates_id is null and t.quantity>coalesce((select sum(c.quantity) from public.equipment_preparation_transfers c where c.compensates_id=t.id),0)) then raise exception 'S4_PHYSICAL_COMPENSATION_REQUIRED'; end if;
  update public.inventory_reservations set released_at=clock_timestamp() where preparation_id=p.id and released_at is null;
  update public.equipment_preparations set state='reversed',revision=revision+1,primary_preparer=previous_preparer where id=p.id;
  perform set_config('app.equipment_confirmation_rpc','true',true);
  update public.equipment_requests set status='new',preparation_revision=preparation_revision+1 where id=r.id;
  perform private.enqueue_equipment_request_outbox_event(r.id,'updated',p_retry_key,actor);
 else raise exception 'S4_INVALID_OPERATION';
 end if;
 perform private.s4_refresh_health();
 select * into r from public.equipment_requests where id=p_request_id;
 select * into p from public.equipment_preparations where request_id=r.id order by created_at desc limit 1;
 result:=jsonb_build_object('request_id',r.id,'revision',r.preparation_revision,'adjustment_id',adj.id,'mapping_id',mapping_id,'plan_id',plan_id);
 if p_operation not in ('heartbeat','save') then
  insert into public.equipment_preparation_events(request_id,preparation_id,operation,actor_id,revision,payload) values(r.id,p.id,p_operation,actor,r.preparation_revision,
   case when p_operation='approve_adjustment' and r.status='new' then p_payload-'lock_token'-'plan' else p_payload-'lock_token' end);
 end if;
 insert into public.inventory_operation_replays(actor_id,operation,retry_key,payload_hash,result_ids) values(actor,'s4:'||p_operation,p_retry_key,payload_hash,result);
 perform set_config('app.s4_command','false',true);
 return result;
end; $$;
revoke all on function public.equipment_preparation_command(text,uuid,jsonb,uuid) from public,anon;
grant execute on function public.equipment_preparation_command(text,uuid,jsonb,uuid) to authenticated;
