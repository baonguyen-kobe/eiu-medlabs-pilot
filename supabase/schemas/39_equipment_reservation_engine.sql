-- Drafts may be incomplete, but must remain readable by every supported client.
create or replace function private.s4_validate_draft(p_plan jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare j jsonb; a jsonb; asset jsonb;
begin
 if jsonb_typeof(p_plan) is distinct from 'object' or jsonb_typeof(p_plan->'lines') is distinct from 'array' then raise exception 'S4_INVALID_DRAFT'; end if;
 if jsonb_array_length(p_plan->'lines')>500 then raise exception 'S4_INVALID_DRAFT'; end if;
 for j in select value from jsonb_array_elements(p_plan->'lines') loop
  if nullif(j->>'line_id','') is null or jsonb_typeof(j->'planned_quantity') is distinct from 'string'
     or jsonb_typeof(j->'shortage_reason') is distinct from 'string'
     or jsonb_typeof(j->'allocations') is distinct from 'array'
     or not(j ? 'reviewed_revision') then raise exception 'S4_INVALID_DRAFT'; end if;
  perform (j->>'line_id')::uuid;
  if j->'reviewed_revision'<>'null'::jsonb and (jsonb_typeof(j->'reviewed_revision')<>'number' or (j->>'reviewed_revision')!~'^[1-9][0-9]*$') then raise exception 'S4_INVALID_DRAFT'; end if;
  if jsonb_array_length(j->'allocations')>100 then raise exception 'S4_INVALID_DRAFT'; end if;
  for a in select value from jsonb_array_elements(j->'allocations') loop
   if nullif(a->>'mapping_id','') is null or nullif(a->>'location_id','') is null
      or jsonb_typeof(a->'base_quantity') is distinct from 'string'
      or jsonb_typeof(a->'asset_ids') is distinct from 'array' then raise exception 'S4_INVALID_DRAFT'; end if;
   perform (a->>'mapping_id')::uuid; perform (a->>'location_id')::uuid;
   for asset in select value from jsonb_array_elements(a->'asset_ids') loop
    if jsonb_typeof(asset)<>'string' then raise exception 'S4_INVALID_DRAFT'; end if;
    perform (asset#>>'{}')::uuid;
   end loop;
  end loop;
 end loop;
end; $$;
revoke all on function private.s4_validate_draft(jsonb) from public,anon,authenticated;

-- Private transaction engine. Called only after request/actor/revision/lock checks.
create or replace function private.s4_commit_plan(p_preparation uuid,p_plan jsonb,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.equipment_preparations; r public.equipment_requests; ln public.equipment_request_items;
 j jsonb; a jsonb; ar jsonb; mp record; pool record; asset public.equipment_assets;
 plan_id uuid; allocation_id uuid; q numeric; planned numeric; numerator numeric; denominator numeric; factor numeric; divisor numeric; needed numeric; available numeric; take numeric; total numeric:=0; seen uuid[]:='{}';
begin
 perform private.s4_validate_draft(p_plan);
 select * into p from public.equipment_preparations where id=p_preparation for update;
 select * into r from public.equipment_requests where id=p.request_id for update;
 if p.id is null or p.state not in ('draft','prepared') or r.request_domain<>'nursing_skills' then raise exception 'S4_INVALID_STATE'; end if;
 if r.late_approval_status in ('pending','rejected') then raise exception 'S4_LATE_APPROVAL_REQUIRED'; end if;
 if r.receive_at is null or r.return_at<r.receive_at or r.responsible_lecturer_id is null then raise exception 'S4_PICKUP_RETURN_REQUIRED'; end if;
 if jsonb_typeof(p_plan->'lines') is distinct from 'array' or jsonb_array_length(p_plan->'lines') not between 1 and 500 then raise exception 'S4_LINES_REQUIRED'; end if;
 -- Releasing the previous revision is transactional: every validation failure restores it.
 update public.inventory_reservations set released_at=clock_timestamp() where preparation_id=p.id and released_at is null;
 insert into public.equipment_preparation_plans(preparation_id,revision,plan,actor_id,reason) values(p.id,p.revision+1,p_plan,auth.uid(),p_reason) returning id into plan_id;
 for j in select value from jsonb_array_elements(p_plan->'lines') loop
  select * into ln from public.equipment_request_items where id=(j->>'line_id')::uuid and request_id=r.id and removed_at is null;
  if not found or ln.id=any(seen) then raise exception 'S4_INVALID_LINE_ID'; end if;
  seen:=array_append(seen,ln.id);
  if (j->>'reviewed_revision')::bigint is distinct from ln.line_revision then raise exception 'S4_REVIEW_REQUIRED'; end if;
  planned:=private.s4_quantity(j->>'planned_quantity');
  if planned<>trunc(planned) or planned>2147483647 then raise exception 'S4_DEMAND_UNIT_INTEGER_REQUIRED'; end if;
  if planned<coalesce((select (t.value->>'quantity')::integer
      from public.equipment_quantity_adjustments qa cross join lateral jsonb_array_elements(qa.targets) t
      where qa.request_id=r.id and qa.status='approved' and t.value->>'line_id'=ln.id::text
      order by qa.reviewed_at desc,qa.id desc limit 1),ln.quantity)
     and nullif(btrim(j->>'shortage_reason'),'') is null then raise exception 'S4_SHORTAGE_REASON_REQUIRED'; end if;
  if jsonb_typeof(j->'allocations') is distinct from 'array' then raise exception 'S4_ALLOCATIONS_REQUIRED'; end if;
  numerator:=0; denominator:=1;
  for a in select value from jsonb_array_elements(j->'allocations') loop
   select m.*,i.tracking_strategy,i.active,i.base_uom_code current_uom,u.allowed_scale,c.unit current_demand_unit,c.is_active demand_active into mp
   from public.equipment_inventory_mappings m join public.inventory_catalog_items i on i.id=m.inventory_item_id join public.inventory_uoms u on u.code=i.base_uom_code join public.equipment_catalog c on c.id=m.catalog_item_id
   where m.id=(a->>'mapping_id')::uuid and m.catalog_item_id=ln.catalog_item_id;
   if not found or not mp.active or not mp.demand_active or mp.base_uom_code<>mp.current_uom or mp.demand_unit<>mp.current_demand_unit then raise exception 'S4_MAPPING_REQUIRED'; end if;
   if not exists(select 1 from public.inventory_storage_locations l where l.id=(a->>'location_id')::uuid and l.active) then raise exception 'S4_INVALID_SOURCE'; end if;
   q:=private.s4_quantity(a->>'base_quantity');
   if q<=0 or q<>round(q,mp.allowed_scale) then raise exception 'S4_INVALID_BASE_QUANTITY'; end if;
   -- Sum exact rational request-unit equivalents; numeric division would make
   -- three 1/3 allocations falsely fail the integer target of one.
   factor:=mp.base_units_per_requested_unit*1000000;
   numerator:=numerator*factor+(q*1000000)*denominator;
   denominator:=denominator*factor;
   divisor:=gcd(numerator,denominator);
   numerator:=div(numerator,divisor); denominator:=div(denominator,divisor);
   insert into public.equipment_preparation_allocations(plan_id,request_line_id,mapping_id,location_id,base_quantity) values(plan_id,ln.id,mp.id,(a->>'location_id')::uuid,q) returning id into allocation_id;
   if mp.tracking_strategy='serialized' then
    if jsonb_typeof(a->'asset_ids') is distinct from 'array' or jsonb_array_length(a->'asset_ids')<>q then raise exception 'S4_EXACT_ASSETS_REQUIRED'; end if;
    for ar in select value from jsonb_array_elements(a->'asset_ids') loop
     select * into asset from public.equipment_assets where id=(ar#>>'{}')::uuid for update;
     if not found or asset.catalog_item_id<>mp.inventory_item_id or not private.s4_asset_eligible(asset.id,(a->>'location_id')::uuid) then raise exception 'S4_ASSET_INELIGIBLE'; end if;
     insert into public.inventory_reservations(preparation_id,allocation_id,asset_id,location_id,quantity) values(p.id,allocation_id,asset.id,asset.location_id,1);
    end loop;
   else
    if coalesce(jsonb_array_length(a->'asset_ids'),0)<>0 then raise exception 'S4_QUANTITY_ASSET_MISMATCH'; end if;
    needed:=q;
    for pool in select c.origin_id,f.expiry_date from public.inventory_receipt_cohorts c join public.inventory_stock_origins o on o.id=c.origin_id join public.inventory_stock_facts f on f.id=c.current_fact_id where o.catalog_item_id=mp.inventory_item_id order by f.expiry_date nulls last,o.created_at,c.origin_id loop
     available:=private.s4_pool_backing(pool.origin_id,(a->>'location_id')::uuid)-coalesce((select sum(rs.quantity) from public.inventory_reservations rs where rs.cohort_id=pool.origin_id and rs.location_id=(a->>'location_id')::uuid and rs.released_at is null),0);
     if available<=0 then continue; end if;
     take:=least(available,needed);
     insert into public.inventory_reservations(preparation_id,allocation_id,cohort_id,location_id,quantity) values(p.id,allocation_id,pool.origin_id,(a->>'location_id')::uuid,take);
     needed:=needed-take;
     exit when needed=0;
    end loop;
    if needed<>0 then raise exception 'S4_INSUFFICIENT_AVAILABLE'; end if;
   end if;
  end loop;
  if numerator<>planned*denominator then raise exception 'S4_ALLOCATION_TOTAL_MISMATCH'; end if;
  update public.equipment_request_items set planned_quantity=planned::integer where id=ln.id;
  total:=total+planned;
 end loop;
 if exists(select 1 from public.equipment_request_items l where l.request_id=r.id and l.removed_at is null and not(l.id=any(seen))) then raise exception 'S4_ALL_LINES_REVIEW_REQUIRED'; end if;
 if total<=0 then raise exception 'S4_ALL_ZERO_FORBIDDEN'; end if;
 update public.equipment_preparations set state='prepared',draft=p_plan,source_revision=r.preparation_revision,revision=revision+1,primary_preparer=coalesce(primary_preparer,auth.uid()),confirmed_at=coalesce(confirmed_at,clock_timestamp()),lock_holder=null,lock_token=null,lock_expires_at=null where id=p.id;
 return plan_id;
end; $$;
revoke all on function private.s4_commit_plan(uuid,jsonb,text) from public,anon,authenticated;

-- A deficient pool marks all affected owners for reconciliation; it never chooses
-- a victim or silently transfers their commitment to another request.
create or replace function private.s4_health(p_preparation uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x order by x.reservation_id),'[]'::jsonb) from (
  select rs.id reservation_id,rs.allocation_id,rs.cohort_id,rs.asset_id,rs.location_id,rs.quantity::text committed,
   case when rs.asset_id is not null then case when private.s4_asset_eligible(rs.asset_id,rs.location_id) then '0' else '1' end
   else greatest(0,coalesce((select sum(other.quantity) from public.inventory_reservations other where other.cohort_id=rs.cohort_id and other.location_id=rs.location_id and other.released_at is null),0)-private.s4_pool_backing(rs.cohort_id,rs.location_id))::text end pool_shortfall
  from public.inventory_reservations rs where rs.preparation_id=p_preparation and rs.released_at is null
 ) x where x.pool_shortfall::numeric>0;
$$;
create or replace function private.s4_refresh_health()
returns void language plpgsql security definer set search_path='' as $$
declare p record; h jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 for p in select * from public.equipment_preparations where state in ('prepared','reversing') order by request_id loop
  h:=private.s4_health(p.id);
  if h is distinct from p.health then
   update public.equipment_preparations set health=h where id=p.id;
   insert into public.equipment_preparation_events(request_id,preparation_id,operation,actor_id,revision,payload) values(p.request_id,p.id,'health_changed',auth.uid(),p.revision,jsonb_build_object('before',p.health,'after',h));
   if h<>'[]'::jsonb then
    perform private.notify_equipment_request_recipients(p.request_id,'preparation_shortfall','Phiếu thiết bị cần phân bổ lại','Cam kết được giữ nguyên; nguồn đủ điều kiện đã thiếu. Vui lòng kiểm tra chi tiết chuẩn bị.',true,true,auth.uid(),jsonb_build_object('preparation_id',p.id,'health',h));
   end if;
  end if;
 end loop;
end; $$;
revoke all on function private.s4_health(uuid),private.s4_refresh_health() from public,anon,authenticated;
-- Expiry transitions need no user mutation; this does NOT release reservations.
select cron.schedule('medlabs-s4-expiry-health','* * * * *','select private.s4_refresh_health();');

create or replace function private.s4_available(p_cohort uuid,p_location uuid)
returns numeric language sql stable security definer set search_path='' as $$
 select greatest(0,private.s4_pool_backing(p_cohort,p_location)-coalesce((select sum(quantity) from public.inventory_reservations where cohort_id=p_cohort and location_id=p_location and released_at is null),0));
$$;
revoke all on function private.s4_available(uuid,uuid) from public,anon,authenticated;
