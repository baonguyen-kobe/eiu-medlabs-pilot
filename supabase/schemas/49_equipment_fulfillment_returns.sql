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
