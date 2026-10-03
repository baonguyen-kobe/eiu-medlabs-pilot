-- Participant-safe preparation existence and verified consequence correction dispatch.
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
  for h in select ef.*,ef.quantity+coalesce((select sum(off.quantity) from public.equipment_fulfillment_effects off where off.offsets_effect_id=ef.id and off.kind='reconciliation'),0) available
   from public.equipment_fulfillment_effects ef where ef.issue_slice_id=s.id and ef.kind='hold' order by ef.id loop
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
 'lines',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'catalog_item_id',l.catalog_item_id,'name',c.commercial_name,'registered_quantity',l.registered_quantity,'planned_quantity',l.planned_quantity,'unit',c.unit) order by l.id) from public.equipment_request_items l join public.equipment_catalog c on c.id=l.catalog_item_id where l.request_id=r.id and l.removed_at is null),'[]'::jsonb),
 'issues',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from(select s.*,o.*,a.asset_code,i.name item_name from public.equipment_issue_slices s join public.equipment_fulfillment_events e on e.id=s.event_id join public.inventory_catalog_items i on i.id=s.inventory_item_id left join public.equipment_assets a on a.id=s.asset_id cross join lateral private.s5_obligation(s.id) o where e.request_id=r.id)x),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(x) order by x.revision desc) from(select e.*,private.s5_snapshot(e.id) snapshot,encode(extensions.digest(convert_to(private.s5_snapshot(e.id)::text,'UTF8'),'sha256'),'hex') snapshot_hash,
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
