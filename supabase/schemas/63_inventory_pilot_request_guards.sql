create or replace function private.p1_request_scope(p_request uuid)
returns uuid language sql stable security definer set search_path='' as $$
 with slices as (
  select sl.* from public.equipment_issue_slices sl
  join public.equipment_fulfillment_events e on e.id=sl.event_id
  join public.equipment_preparations p on p.id=e.preparation_id
  join public.equipment_request_items ri on ri.id=sl.request_line_id
  where p_request in (e.request_id,p.request_id,ri.request_id)
     or exists(select 1 from public.equipment_fulfillment_effects f join public.equipment_fulfillment_events fe on fe.id=f.event_id join public.equipment_preparations fp on fp.id=fe.preparation_id where f.issue_slice_id=sl.id and p_request in (fe.request_id,fp.request_id))
 ), dimensions as (
  select sl.inventory_item_id item,sl.location_id loc from slices sl
  union select a.catalog_item_id,a.location_id from slices sl join public.equipment_assets a on a.id=sl.asset_id
  union select o.catalog_item_id,sl.location_id from slices sl join public.inventory_stock_origins o on o.id=sl.cohort_id
  union select m.inventory_item_id,sl.location_id from slices sl join public.equipment_inventory_mappings m on m.id=sl.mapping_id
  union select sl.inventory_item_id,f.location_id from slices sl join public.equipment_fulfillment_effects f on f.issue_slice_id=sl.id
  union select m.inventory_item_id,al.location_id from public.equipment_preparation_allocations al join public.equipment_preparation_plans pl on pl.id=al.plan_id join public.equipment_preparations p on p.id=pl.preparation_id join public.equipment_inventory_mappings m on m.id=al.mapping_id where p.request_id=p_request
  union select coalesce(o.catalog_item_id,a.catalog_item_id),coalesce(a.location_id,r.location_id) from public.inventory_reservations r join public.equipment_preparations p on p.id=r.preparation_id left join public.inventory_stock_origins o on o.id=r.cohort_id left join public.equipment_assets a on a.id=r.asset_id where p.request_id=p_request
  union select coalesce(o.catalog_item_id,a.catalog_item_id),endpoint.loc from public.equipment_preparation_transfers t join public.equipment_preparations p on p.id=t.preparation_id left join public.inventory_stock_origins o on o.id=t.cohort_id left join public.equipment_assets a on a.id=t.asset_id cross join lateral (values(t.source_location_id),(t.destination_location_id),(a.location_id)) endpoint(loc) where p.request_id=p_request
  union select m.inventory_item_id,null::uuid from public.equipment_preparations p cross join lateral jsonb_path_query(p.draft,'$.**.mapping_id') j join public.equipment_inventory_mappings m on m.id=case when j#>>'{}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (j#>>'{}')::uuid end where p.request_id=p_request
  union select a.catalog_item_id,a.location_id from public.equipment_preparations p cross join lateral jsonb_path_query(p.draft,'$.**.asset_ids[*]') j join public.equipment_assets a on a.id=case when j#>>'{}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (j#>>'{}')::uuid end where p.request_id=p_request
  union select null::uuid,case when j#>>'{}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (j#>>'{}')::uuid end from public.equipment_preparations p cross join lateral jsonb_path_query(p.draft,'$.**.location_id') j where p.request_id=p_request
 ) select s.id from public.inventory_pilot_scopes s where exists(select 1 from dimensions d where d.loc=s.location_id or exists(select 1 from public.inventory_pilot_scope_items i where i.scope_id=s.id and i.catalog_item_id=d.item)) order by s.id limit 1;
$$;
create or replace function private.p1_request_gate(p_item uuid,p_location uuid,p_asset uuid,p_request uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c private.inventory_pilot_writer_context; scope uuid; item uuid; loc uuid;
begin
 perform private.p1_gate(p_item,p_location,p_asset);
 scope:=private.p1_request_scope(p_request);
 if scope is not null then
  select i.catalog_item_id,s.location_id into item,loc from public.inventory_pilot_scopes s join public.inventory_pilot_scope_items i on i.scope_id=s.id where s.id=scope order by i.catalog_item_id limit 1;
  perform private.p1_gate(item,loc);
 end if;
 select * into c from private.inventory_pilot_writer_context where transaction_id=txid_current();
 if c.bound_scope_id is not null and c.request_id is distinct from p_request then raise exception 'P1_REQUEST_CONTEXT_MISMATCH' using errcode='42501'; end if;
end; $$;
-- Scope classification follows the backing and every actual endpoint, not just
-- the denormalized slice. Effects use this same boundary for OLD and NEW.
create or replace function private.p1_issue_slice_gate(p_slice public.equipment_issue_slices,p_event uuid,p_location uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare item uuid; loc uuid; mapping public.equipment_inventory_mappings; original_request uuid; preparation_request uuid; request uuid; effect_preparation_request uuid; line public.equipment_request_items; scoped boolean;
begin
 select coalesce(o.catalog_item_id,a.catalog_item_id),coalesce(a.location_id,p_slice.location_id) into item,loc
 from (values(1)) seed(n) left join public.inventory_stock_origins o on o.id=p_slice.cohort_id left join public.equipment_assets a on a.id=p_slice.asset_id;
 select * into mapping from public.equipment_inventory_mappings where id=p_slice.mapping_id;
 select e.request_id,p.request_id into original_request,preparation_request from public.equipment_fulfillment_events e join public.equipment_preparations p on p.id=e.preparation_id where e.id=p_slice.event_id;
 select e.request_id,p.request_id into request,effect_preparation_request from public.equipment_fulfillment_events e join public.equipment_preparations p on p.id=e.preparation_id where e.id=p_event;
 select * into line from public.equipment_request_items where id=p_slice.request_line_id;
 scoped:=exists(select 1 from public.inventory_pilot_scopes s where s.location_id in (loc,p_slice.location_id,p_location)
  or exists(select 1 from public.inventory_pilot_scope_items i where i.scope_id=s.id and i.catalog_item_id in (item,p_slice.inventory_item_id,mapping.inventory_item_id)))
  or private.p1_request_scope(original_request) is not null or private.p1_request_scope(request) is not null
  or private.p1_request_scope(line.request_id) is not null or private.p1_request_scope(preparation_request) is not null or private.p1_request_scope(effect_preparation_request) is not null;
 perform private.p1_request_gate(item,loc,p_slice.asset_id,original_request);
 perform private.p1_request_gate(mapping.inventory_item_id,p_slice.location_id,null,original_request);
 perform private.p1_request_gate(p_slice.inventory_item_id,p_slice.location_id,p_slice.asset_id,original_request);
 perform private.p1_request_gate(item,coalesce(p_location,p_slice.location_id),p_slice.asset_id,request);
 if line.request_id is distinct from original_request then perform private.p1_request_gate(item,loc,p_slice.asset_id,line.request_id); end if;
 if preparation_request is distinct from original_request then perform private.p1_request_gate(item,loc,p_slice.asset_id,preparation_request); end if;
 if effect_preparation_request is distinct from request then perform private.p1_request_gate(item,loc,p_slice.asset_id,effect_preparation_request); end if;
 if scoped and (item is null or item is distinct from p_slice.inventory_item_id or mapping.inventory_item_id is distinct from item
  or mapping.catalog_item_id is distinct from line.catalog_item_id or line.request_id is distinct from original_request
  or preparation_request is distinct from original_request or request is distinct from original_request or effect_preparation_request is distinct from request
  or loc is distinct from p_slice.location_id or (p_location is not null and p_location is distinct from p_slice.location_id)) then
  raise exception 'P1_ISSUE_DIMENSION_MISMATCH' using errcode='42501';
 end if;
end; $$;
create or replace function private.p1_request_fact_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare item uuid; loc uuid; request uuid; sl public.equipment_issue_slices;
begin
 if tg_table_name='equipment_preparation_allocations' then
  if tg_op<>'INSERT' then select m.inventory_item_id,p.request_id into item,request from public.equipment_inventory_mappings m cross join public.equipment_preparation_plans pl join public.equipment_preparations p on p.id=pl.preparation_id where m.id=old.mapping_id and pl.id=old.plan_id; perform private.p1_request_gate(item,old.location_id,null,request); end if;
  if tg_op<>'DELETE' then select m.inventory_item_id,p.request_id into item,request from public.equipment_inventory_mappings m cross join public.equipment_preparation_plans pl join public.equipment_preparations p on p.id=pl.preparation_id where m.id=new.mapping_id and pl.id=new.plan_id; perform private.p1_request_gate(item,new.location_id,null,request); end if;
 elsif tg_table_name in ('inventory_reservations','equipment_preparation_transfers') then
  if tg_op<>'INSERT' then
   select coalesce(o.catalog_item_id,a.catalog_item_id),p.request_id into item,request from public.equipment_preparations p left join public.inventory_stock_origins o on o.id=old.cohort_id left join public.equipment_assets a on a.id=old.asset_id where p.id=old.preparation_id;
   if tg_table_name='inventory_reservations' then perform private.p1_request_gate(item,old.location_id,old.asset_id,request);
   else perform private.p1_request_gate(item,old.source_location_id,old.asset_id,request); perform private.p1_request_gate(item,old.destination_location_id,old.asset_id,request); end if;
  end if;
  if tg_op<>'DELETE' then
   select coalesce(o.catalog_item_id,a.catalog_item_id),p.request_id into item,request from public.equipment_preparations p left join public.inventory_stock_origins o on o.id=new.cohort_id left join public.equipment_assets a on a.id=new.asset_id where p.id=new.preparation_id;
   if tg_table_name='inventory_reservations' then perform private.p1_request_gate(item,new.location_id,new.asset_id,request);
   else perform private.p1_request_gate(item,new.source_location_id,new.asset_id,request); perform private.p1_request_gate(item,new.destination_location_id,new.asset_id,request); end if;
  end if;
 elsif tg_table_name='equipment_issue_slices' then
  if tg_op<>'INSERT' then perform private.p1_issue_slice_gate(old,old.event_id); end if;
  if tg_op<>'DELETE' then perform private.p1_issue_slice_gate(new,new.event_id); end if;
 elsif tg_table_name='equipment_fulfillment_effects' then
  if tg_op<>'INSERT' then
   select * into sl from public.equipment_issue_slices where id=old.issue_slice_id;
   perform private.p1_issue_slice_gate(sl,old.event_id,old.location_id);
  end if;
  if tg_op<>'DELETE' then
   select * into sl from public.equipment_issue_slices where id=new.issue_slice_id;
   perform private.p1_issue_slice_gate(sl,new.event_id,new.location_id);
  end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end; $$;
create or replace function private.p1_request_projection_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare scope uuid; c private.inventory_pilot_writer_context; item uuid; loc uuid;
begin
 if row(new.status,new.fulfillment_revision,new.handover_staff_confirmed_by,new.handover_staff_confirmed_at,new.handover_signature_path,new.handover_recipient_signed_at,new.handover_effective_at,new.return_staff_confirmed_by,new.return_staff_confirmed_at,new.return_signature_path,new.return_recipient_signed_at,new.return_effective_at)
  is not distinct from row(old.status,old.fulfillment_revision,old.handover_staff_confirmed_by,old.handover_staff_confirmed_at,old.handover_signature_path,old.handover_recipient_signed_at,old.handover_effective_at,old.return_staff_confirmed_by,old.return_staff_confirmed_at,old.return_signature_path,old.return_recipient_signed_at,old.return_effective_at) then return new; end if;
 scope:=private.p1_request_scope(old.id); if scope is null then return new; end if;
 select * into c from private.inventory_pilot_writer_context where transaction_id=txid_current() and backend_pid=pg_backend_pid();
 if c.actor_id is distinct from auth.uid() or c.request_id is distinct from old.id or c.writer_id not in ('equipment_preparation_command','equipment_fulfillment_command') or c.writer_id is null then raise exception 'P1_LEGACY_PROJECTION_DENIED' using errcode='42501'; end if;
 -- S5 signatures may advance the settled projection; they never authorize stock writes.
 if c.writer_id='equipment_fulfillment_command' and c.operation='sign' then
  if row(new.handover_staff_confirmed_by,new.handover_staff_confirmed_at,new.handover_signature_path,new.handover_recipient_signed_at,new.handover_effective_at,new.return_staff_confirmed_by,new.return_staff_confirmed_at,new.return_signature_path,new.return_recipient_signed_at,new.return_effective_at) is distinct from row(old.handover_staff_confirmed_by,old.handover_staff_confirmed_at,old.handover_signature_path,old.handover_recipient_signed_at,old.handover_effective_at,old.return_staff_confirmed_by,old.return_staff_confirmed_at,old.return_signature_path,old.return_recipient_signed_at,old.return_effective_at) then raise exception 'P1_SIGNATURE_IS_NOT_PHYSICAL_AUTHORITY' using errcode='42501'; end if;
  return new;
 end if;
 select i.catalog_item_id,s.location_id into item,loc from public.inventory_pilot_scopes s join public.inventory_pilot_scope_items i on i.scope_id=s.id where s.id=scope order by i.catalog_item_id limit 1;
 perform private.p1_request_gate(item,loc,null,old.id); return new;
end; $$;
create or replace function private.p1_preparation_state_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare scope uuid; item uuid; loc uuid;
begin
 if row(new.id,new.request_id,new.state,new.primary_preparer,new.confirmed_at) is not distinct from row(old.id,old.request_id,old.state,old.primary_preparer,old.confirmed_at) then return new; end if;
 scope:=private.p1_request_scope(old.request_id); if scope is null then return new; end if;
 select i.catalog_item_id,s.location_id into item,loc from public.inventory_pilot_scopes s join public.inventory_pilot_scope_items i on i.scope_id=s.id where s.id=scope order by i.catalog_item_id limit 1;
 perform private.p1_request_gate(item,loc,null,old.request_id);
 if new.request_id<>old.request_id or new.id<>old.id then raise exception 'P1_PREPARATION_IDENTITY_IMMUTABLE' using errcode='42501'; end if;
 return new;
end; $$;
revoke all on function private.p1_request_scope(uuid),private.p1_request_gate(uuid,uuid,uuid,uuid),private.p1_issue_slice_gate(public.equipment_issue_slices,uuid,uuid),private.p1_request_fact_guard(),private.p1_request_projection_guard(),private.p1_preparation_state_guard() from public,anon,authenticated,service_role;
