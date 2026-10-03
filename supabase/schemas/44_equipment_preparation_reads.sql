create or replace function public.equipment_preparation_read(p_request_id uuid,p_resource text default 'workspace',p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.equipment_requests; p public.equipment_preparations; manager boolean; rows jsonb; total bigint; page integer:=greatest(1,coalesce((p_filters->>'page')::integer,1));
begin
 if not private.can_read_preparation(p_request_id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into r from public.equipment_requests where id=p_request_id;
 if r.request_domain<>'nursing_skills' then raise exception 'S4_DOMAIN_NOT_ENABLED'; end if;
 manager:=private.can_access_inventory() and private.can_manage_equipment_request(r.id);
 select * into p from public.equipment_preparations where request_id=r.id order by created_at desc limit 1;
 if p_resource='catalog' then
  select count(*) into total from public.equipment_catalog c where c.is_active
    and (coalesce(p_filters->>'search','')='' or c.commercial_name ilike '%'||(p_filters->>'search')||'%' or c.item_name ilike '%'||(p_filters->>'search')||'%');
  select coalesce(jsonb_agg(x),'[]'::jsonb) into rows from (
    select c.id,c.commercial_name,c.item_name,c.unit from public.equipment_catalog c where c.is_active
      and (coalesce(p_filters->>'search','')='' or c.commercial_name ilike '%'||(p_filters->>'search')||'%' or c.item_name ilike '%'||(p_filters->>'search')||'%')
    order by c.commercial_name,c.id limit 100 offset (page-1)*100
  ) x;
  return jsonb_build_object('rows',rows,'total',total,'page',page);
 end if;
 if p_resource='history' then
  select count(*) into total from public.equipment_preparation_events where request_id=r.id;
  select coalesce(jsonb_agg(x),'[]') into rows from (select e.id,e.operation,e.revision,e.created_at,e.payload,pr.full_name actor_name from public.equipment_preparation_events e left join public.profiles pr on pr.id=e.actor_id where e.request_id=r.id order by e.created_at desc,e.id desc limit 30 offset (page-1)*30) x;
  return jsonb_build_object('rows',rows,'total',total,'page',page);
 elsif p_resource='stock' then
  if not manager then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(x),'[]') into rows from (
   select m.id mapping_id,m.catalog_item_id,m.inventory_item_id,m.base_units_per_requested_unit::text conversion_factor,m.base_uom_code,i.name item_name,i.code item_code,i.tracking_strategy,l.id location_id,l.name location_name,
    coalesce((select sum(private.s4_available(c.origin_id,l.id)) from public.inventory_receipt_cohorts c join public.inventory_stock_origins o on o.id=c.origin_id where o.catalog_item_id=i.id),0)::text available_quantity
   from public.equipment_inventory_mappings m join public.inventory_catalog_items i on i.id=m.inventory_item_id cross join public.inventory_storage_locations l
   where m.catalog_item_id=(p_filters->>'catalog_item_id')::uuid and i.active and l.active order by i.name,l.name,m.id limit 100 offset (page-1)*100
  ) x;
  return jsonb_build_object('rows',rows,'page',page);
 elsif p_resource='assets' then
  if not manager then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
  select count(*) into total from public.equipment_assets a where a.catalog_item_id=(p_filters->>'inventory_item_id')::uuid and a.location_id=(p_filters->>'location_id')::uuid and (nullif(p_filters->>'asset_code','') is null or a.asset_code=p_filters->>'asset_code');
  select coalesce(jsonb_agg(x),'[]') into rows from (select a.id,a.asset_code,a.manufacturer_serial,a.revision,private.s4_asset_eligible(a.id,a.location_id) eligible,not exists(select 1 from public.inventory_reservations rs where rs.asset_id=a.id and rs.released_at is null and rs.preparation_id is distinct from p.id) unreserved from public.equipment_assets a where a.catalog_item_id=(p_filters->>'inventory_item_id')::uuid and a.location_id=(p_filters->>'location_id')::uuid and (nullif(p_filters->>'asset_code','') is null or a.asset_code=p_filters->>'asset_code') order by a.asset_code limit 100 offset (page-1)*100) x;
  return jsonb_build_object('rows',rows,'total',total,'page',page);
 elsif p_resource<>'workspace' then raise exception 'S4_INVALID_RESOURCE'; end if;
 select coalesce(jsonb_agg(x order by x.created_at,x.id),'[]') into rows from (
  select l.id,l.catalog_item_id,l.skill_name,l.quantity::text demand_quantity,l.registered_quantity::text registered_quantity,l.planned_quantity::text planned_quantity,l.baseline_source,l.line_revision,l.note,l.created_at,c.commercial_name,c.item_name,c.unit from public.equipment_request_items l join public.equipment_catalog c on c.id=l.catalog_item_id where l.request_id=r.id and l.removed_at is null
 ) x;
 return jsonb_build_object('request',jsonb_build_object('id',r.id,'status',r.status,'revision',r.preparation_revision,'receive_at',r.receive_at,'return_at',r.return_at,'registrant_id',r.registrant_id,'responsible_lecturer_id',r.responsible_lecturer_id),'manager',manager,'admin',manager and private.is_inventory_admin(),'actor_id',auth.uid(),'can_propose',auth.uid() in (r.registrant_id,r.responsible_lecturer_id),'lines',rows,
  'preparation',case when p.id is null then null else (to_jsonb(p)-'lock_token')||jsonb_build_object('health',private.s4_health(p.id),'draft',case when manager then p.draft else jsonb_build_object('lines',(select coalesce(jsonb_agg(jsonb_build_object('line_id',l.id,'planned_quantity',l.planned_quantity::text,'reviewed_revision',null,'shortage_reason','','allocations','[]'::jsonb)),'[]'::jsonb) from public.equipment_request_items l where l.request_id=r.id and l.removed_at is null)) end) end,
  'adjustments',coalesce((select jsonb_agg(a order by a.created_at desc) from (select * from public.equipment_quantity_adjustments where request_id=r.id order by created_at desc limit 30) a),'[]'::jsonb),
  'transfers',case when manager then coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('quantity',t.quantity::text) order by t.created_at,t.id) from public.equipment_preparation_transfers t where t.preparation_id=p.id),'[]'::jsonb) else '[]'::jsonb end);
end; $$;
revoke all on function public.equipment_preparation_read(uuid,text,jsonb) from public,anon;
grant execute on function public.equipment_preparation_read(uuid,text,jsonb) to authenticated;
