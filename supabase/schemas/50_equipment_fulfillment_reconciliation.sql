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
