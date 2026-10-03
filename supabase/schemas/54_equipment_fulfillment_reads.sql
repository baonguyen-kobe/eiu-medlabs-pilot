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
