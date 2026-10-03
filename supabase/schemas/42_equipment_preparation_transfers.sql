-- A real transfer still goes through S2/S3. This layer only correlates ownership.
create or replace function private.s4_guard_transfer_backing()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=nullif(current_setting('app.s4_transfer_owner',true),'')::uuid; reserved numeric; stock numeric;
begin
 if new.quantity_delta>=0 or new.condition<>'good' or not exists(select 1 from public.inventory_transactions t where t.id=new.transaction_id and t.operation='TRANSFER') then return new; end if;
 select coalesce(sum(quantity),0) into reserved from public.inventory_reservations where cohort_id=new.cohort_id and location_id=new.location_id and released_at is null and (owner_id is null or preparation_id<>owner_id);
 select quantity into stock from public.inventory_stock_balances where cohort_id=new.cohort_id and location_id=new.location_id and condition='good';
 if coalesce(stock,0)+new.quantity_delta<reserved then raise exception 'S4_RESERVED_BACKING_PROTECTED' using errcode='23514'; end if;
 return new;
end; $$;
create trigger inventory_lines_s4_transfer_guard before insert on public.inventory_transaction_lines for each row execute function private.s4_guard_transfer_backing();
create or replace function private.s4_guard_asset_location()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.location_id<>old.location_id and exists(select 1 from public.inventory_reservations r where r.asset_id=old.id and r.released_at is null and r.preparation_id is distinct from nullif(current_setting('app.s4_transfer_owner',true),'')::uuid) then raise exception 'S4_RESERVED_ASSET_PROTECTED' using errcode='23514'; end if;
 return new;
end; $$;
create trigger equipment_assets_s4_location_guard before update on public.equipment_assets for each row execute function private.s4_guard_asset_location();

create or replace function public.equipment_preparation_transfer(p_request_id uuid,p_payload jsonb,p_retry_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
<<transfer_command>>
declare r public.equipment_requests; p public.equipment_preparations; original public.equipment_preparation_transfers;
 asset public.equipment_assets; fact record; rs record; pool record; entry jsonb; result jsonb; replay jsonb; h text; old_h text;
 source_id uuid; destination_id uuid; cohort uuid; asset_id uuid; item_id uuid; tx uuid; link_id uuid; quantity numeric; left_qty numeric; moved numeric; cond text;
 lines jsonb:='[]'; links jsonb:='[]'; available numeric; scale integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 if not private.can_access_inventory() or not private.can_manage_equipment_request(p_request_id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into r from public.equipment_requests where id=p_request_id for update;
 if not found or r.request_domain<>'nursing_skills' then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_retry_key is null or jsonb_typeof(p_payload) is distinct from 'object' or nullif(btrim(p_payload->>'reason'),'') is null or p_payload->'physical_confirmation' is distinct from 'true'::jsonb then raise exception 'S4_REAL_TRANSFER_CONFIRMATION_REQUIRED'; end if;
 h:=encode(extensions.digest(convert_to(jsonb_build_object('request',r.id,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');
 select rr.payload_hash,rr.result_ids into old_h,replay from public.inventory_operation_replays rr where rr.actor_id=auth.uid() and rr.operation='s4:physical_transfer' and rr.retry_key=p_retry_key;
 if found then if h<>old_h then raise exception 'RETRY_PAYLOAD_MISMATCH'; end if; return replay; end if;
 -- The outer replay owns retries atomically. Nested physical commands must use
 -- fresh keys so unrelated historical transfers cannot become S4 evidence.
 if r.status not in ('new','preparing') then raise exception 'S4_INVALID_REQUEST_STATE'; end if;
 if (p_payload->>'expected_revision')::bigint is distinct from r.preparation_revision then raise exception 'STALE_REVISION' using errcode='23505'; end if;
 select * into p from public.equipment_preparations where request_id=r.id and state in ('draft','prepared','reversing') for update;
 if p.id is null or p.state not in ('draft','reversing') then raise exception 'S4_TRANSFER_STATE_INVALID'; end if;
 if p.state='draft' and (p.lock_holder is distinct from auth.uid() or p.lock_token is distinct from (p_payload->>'lock_token')::uuid or p.lock_token is null or p.lock_expires_at is null or p.lock_expires_at<=clock_timestamp()) then raise exception 'S4_LOCK_REQUIRED'; end if;
 source_id:=(p_payload->>'source_location_id')::uuid; destination_id:=(p_payload->>'destination_location_id')::uuid;
 cohort:=nullif(p_payload->>'cohort_id','')::uuid; asset_id:=nullif(p_payload->>'asset_id','')::uuid; item_id:=nullif(p_payload->>'inventory_item_id','')::uuid;
 quantity:=private.s4_quantity(p_payload->>'quantity'); cond:=p_payload->>'condition';
 if quantity<=0 or source_id is null or destination_id is null or source_id=destination_id then raise exception 'S4_TRANSFER_TARGET_REQUIRED'; end if;
 if p.state='reversing' then
  select * into original from public.equipment_preparation_transfers where id=(p_payload->>'compensates_id')::uuid and preparation_id=p.id and compensates_id is null for update;
  if not found or original.cohort_id is distinct from cohort or original.asset_id is distinct from asset_id or source_id is distinct from original.destination_location_id or destination_id is distinct from original.source_location_id or quantity>original.quantity-coalesce((select sum(t.quantity) from public.equipment_preparation_transfers t where t.compensates_id=original.id),0) then raise exception 'S4_COMPENSATION_PROVENANCE_REQUIRED'; end if;
 else
  if p_payload ? 'compensates_id' then raise exception 'S4_REVERSAL_REQUIRED'; end if;
  if cohort is not null or item_id is null then raise exception 'S4_ITEM_TRANSFER_REQUIRED'; end if;
  if not exists(select 1 from public.equipment_request_items l join public.equipment_inventory_mappings m on m.catalog_item_id=l.catalog_item_id where l.request_id=r.id and l.removed_at is null and m.inventory_item_id=item_id) then raise exception 'S4_MAPPING_REQUIRED'; end if;
 end if;
 perform set_config('app.s4_transfer_owner',p.id::text,true);
 perform set_config('app.s4_transfer_work','true',true);
 if asset_id is null then
  if p.state='reversing' then
   if cond is null or cond not in ('good','damaged') then raise exception 'S4_PHYSICAL_CONDITION_REQUIRED'; end if;
   select f.version,c.revision into fact from public.inventory_receipt_cohorts c join public.inventory_stock_facts f on f.id=c.current_fact_id where c.origin_id=cohort;
   if not found then raise exception 'COHORT_NOT_FOUND'; end if;
   lines:=jsonb_build_array(jsonb_build_object('origin_id',cohort,'expected_version',p_payload->>'expected_version','expected_stock_revision',p_payload->>'expected_stock_revision','condition',cond,'quantity',quantity::text));
  else
   if cond is distinct from 'good' then raise exception 'S4_PHYSICAL_CONDITION_REQUIRED'; end if;
   select u.allowed_scale into scale from public.inventory_catalog_items i join public.inventory_uoms u on u.code=i.base_uom_code where i.id=item_id and i.active and i.tracking_strategy='quantity';
   if not found or quantity<>round(quantity,scale) then raise exception 'S4_INVALID_BASE_QUANTITY'; end if;
   left_qty:=quantity;
   for pool in
    select c.origin_id,c.revision,f.version,private.s4_available(c.origin_id,source_id) available
    from public.inventory_receipt_cohorts c join public.inventory_stock_origins o on o.id=c.origin_id join public.inventory_stock_facts f on f.id=c.current_fact_id
    where o.catalog_item_id=item_id and private.s4_available(c.origin_id,source_id)>0
    order by f.expiry_date nulls last,o.created_at,c.origin_id limit 500
   loop
    available:=least(pool.available,left_qty);
    lines:=lines||jsonb_build_array(jsonb_build_object('origin_id',pool.origin_id,'expected_version',pool.version,'expected_stock_revision',pool.revision,'condition','good','quantity',available::text));
    left_qty:=left_qty-available; exit when left_qty=0;
   end loop;
   if left_qty<>0 then raise exception 'S4_INSUFFICIENT_AVAILABLE'; end if;
  end if;
  result:=public.inventory_command('transfer_stock',jsonb_build_object('source_location_id',source_id,'target_location_id',destination_id,'reason',p_payload->>'reason','lines',lines),gen_random_uuid());
 else
  select * into asset from public.equipment_assets where id=asset_id for update;
  if not found or asset.location_id is distinct from source_id or quantity<>1 then raise exception 'S4_ASSET_LOCATION_CHANGED'; end if;
  if p.state='draft' and (asset.catalog_item_id is distinct from item_id or not private.s4_asset_eligible(asset.id,source_id) or exists(select 1 from public.inventory_reservations v where v.asset_id=asset.id and v.released_at is null)) then raise exception 'S4_ASSET_INELIGIBLE'; end if;
  result:=public.equipment_asset_command('set_asset_state',jsonb_build_object('id',asset.id,'expected_revision',p_payload->>'asset_revision','location_id',destination_id,'custodian_id',asset.custodian_id,'operational_status',asset.operational_status,'reason',p_payload->>'reason','evidence_note',p_payload->>'reason'),gen_random_uuid());
  cond:='asset';
  lines:=jsonb_build_array(jsonb_build_object('quantity','1'));
 end if;
 tx:=(result->>'transaction_id')::uuid;
 for entry in select value from jsonb_array_elements(lines) loop
  insert into public.equipment_preparation_transfers(preparation_id,transaction_id,compensates_id,source_location_id,destination_location_id,cohort_id,asset_id,quantity,condition)
  values(p.id,tx,original.id,source_id,destination_id,(entry->>'origin_id')::uuid,asset_id,(entry->>'quantity')::numeric,cond) returning id into link_id;
  links:=links||jsonb_build_array(link_id);
 end loop;
 -- Keep returned backing owned until final reversal; split only the moved part.
 if p.state='reversing' then
  left_qty:=quantity;
  for rs in select * from public.inventory_reservations v where v.preparation_id=p.id and v.released_at is null and v.location_id=source_id and v.cohort_id is not distinct from cohort and v.asset_id is not distinct from transfer_command.asset_id order by v.created_at,v.id loop
   moved:=least(left_qty,rs.quantity);
   update public.inventory_reservations set released_at=clock_timestamp() where id=rs.id;
   insert into public.inventory_reservations(preparation_id,allocation_id,cohort_id,asset_id,location_id,quantity) values(p.id,rs.allocation_id,cohort,asset_id,destination_id,moved);
   if rs.quantity>moved then insert into public.inventory_reservations(preparation_id,allocation_id,cohort_id,asset_id,location_id,quantity) values(p.id,rs.allocation_id,cohort,asset_id,source_id,rs.quantity-moved); end if;
   left_qty:=left_qty-moved; exit when left_qty=0;
  end loop;
 end if;
 perform set_config('app.s4_transfer_owner','',true); perform set_config('app.s4_transfer_work','',true);
 update public.equipment_requests set preparation_revision=preparation_revision+1 where id=r.id returning preparation_revision into r.preparation_revision;
 update public.equipment_preparations set source_revision=r.preparation_revision,revision=revision+1 where id=p.id;
 insert into public.equipment_preparation_events(request_id,preparation_id,operation,actor_id,revision,payload) values(r.id,p.id,'physical_transfer',auth.uid(),r.preparation_revision,jsonb_build_object('transfer_ids',links,'transaction_id',tx,'compensates_id',original.id));
 perform private.s4_refresh_health();
 result:=jsonb_build_object('transfer_ids',links,'transaction_id',tx,'revision',r.preparation_revision);
 insert into public.inventory_operation_replays(actor_id,operation,retry_key,payload_hash,result_ids) values(auth.uid(),'s4:physical_transfer',p_retry_key,h,result);
 return result;
end; $$;
revoke all on function private.s4_guard_transfer_backing(),private.s4_guard_asset_location() from public,anon,authenticated;
revoke all on function public.equipment_preparation_transfer(uuid,jsonb,uuid) from public,anon;
grant execute on function public.equipment_preparation_transfer(uuid,jsonb,uuid) to authenticated;

-- Manager-only, request-scoped, paged selectors. No raw lot picker is exposed.
create or replace function public.equipment_preparation_transfer_read(p_request_id uuid,p_resource text,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.equipment_preparations; rows jsonb; page integer:=greatest(1,least(100000,coalesce((p_filters->>'page')::integer,1)));
begin
 if not private.can_access_inventory() or not private.can_manage_equipment_request(p_request_id) or not exists(select 1 from public.equipment_requests where id=p_request_id and request_domain='nursing_skills') then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into p from public.equipment_preparations where request_id=p_request_id order by created_at desc limit 1;
 if p_resource='sources' then
  select coalesce(jsonb_agg(x),'[]') into rows from (
   select i.id inventory_item_id,i.name item_name,i.code item_code,i.base_uom_code,i.tracking_strategy,l.id location_id,l.name location_name,
    case when i.tracking_strategy='quantity' then coalesce((select sum(private.s4_available(c.origin_id,l.id)) from public.inventory_receipt_cohorts c join public.inventory_stock_origins o on o.id=c.origin_id where o.catalog_item_id=i.id),0)::text else null end available_quantity
   from public.inventory_catalog_items i cross join public.inventory_storage_locations l
   where i.active and l.active and exists(select 1 from public.equipment_request_items q join public.equipment_inventory_mappings m on m.catalog_item_id=q.catalog_item_id where q.request_id=p_request_id and q.removed_at is null and m.inventory_item_id=i.id)
   order by i.name,i.id,l.name,l.id limit 100 offset (page-1)*100
  ) x;
 elsif p_resource='locations' then
  select coalesce(jsonb_agg(x),'[]') into rows from (select id,name from public.inventory_storage_locations where active order by name,id limit 100 offset (page-1)*100) x;
 elsif p_resource='assets' then
  if not exists(select 1 from public.equipment_request_items q join public.equipment_inventory_mappings m on m.catalog_item_id=q.catalog_item_id where q.request_id=p_request_id and q.removed_at is null and m.inventory_item_id=(p_filters->>'inventory_item_id')::uuid) then raise exception 'S4_MAPPING_REQUIRED'; end if;
  select coalesce(jsonb_agg(x),'[]') into rows from (
   select a.id,a.asset_code,a.manufacturer_serial,a.revision
   from public.equipment_assets a where a.catalog_item_id=(p_filters->>'inventory_item_id')::uuid and a.location_id=(p_filters->>'location_id')::uuid
   and (nullif(btrim(p_filters->>'asset_code'),'') is null or a.asset_code=btrim(p_filters->>'asset_code'))
   and private.s4_asset_eligible(a.id,a.location_id) and not exists(select 1 from public.inventory_reservations v where v.asset_id=a.id and v.released_at is null)
   order by a.asset_code,a.id limit 100 offset (page-1)*100
  ) x;
 elsif p_resource='debts' then
  select coalesce(jsonb_agg(x),'[]') into rows from (
   select t.id,t.cohort_id,t.asset_id,t.destination_location_id source_location_id,t.source_location_id destination_location_id,
    src.name source_name,dst.name destination_name,i.name item_name,i.base_uom_code,a.asset_code,
    (t.quantity-coalesce((select sum(c.quantity) from public.equipment_preparation_transfers c where c.compensates_id=t.id),0))::text outstanding_quantity,
    f.version expected_version,rc.revision expected_stock_revision,a.revision asset_revision,a.operational_status,
    coalesce((select b.quantity from public.inventory_stock_balances b where b.cohort_id=t.cohort_id and b.location_id=t.destination_location_id and b.condition='good'),0)::text good_quantity,
    coalesce((select b.quantity from public.inventory_stock_balances b where b.cohort_id=t.cohort_id and b.location_id=t.destination_location_id and b.condition='damaged'),0)::text damaged_quantity,
    a.location_id asset_location_id
   from public.equipment_preparation_transfers t
   join public.inventory_storage_locations src on src.id=t.destination_location_id join public.inventory_storage_locations dst on dst.id=t.source_location_id
   left join public.inventory_stock_origins o on o.id=t.cohort_id left join public.inventory_receipt_cohorts rc on rc.origin_id=t.cohort_id left join public.inventory_stock_facts f on f.id=rc.current_fact_id
   left join public.equipment_assets a on a.id=t.asset_id join public.inventory_catalog_items i on i.id=coalesce(o.catalog_item_id,a.catalog_item_id)
   where t.preparation_id=p.id and t.compensates_id is null and t.quantity>coalesce((select sum(c.quantity) from public.equipment_preparation_transfers c where c.compensates_id=t.id),0)
   order by t.created_at,t.id limit 100 offset (page-1)*100
  ) x;
 else raise exception 'S4_INVALID_RESOURCE';
 end if;
 return jsonb_build_object('rows',rows,'page',page);
end; $$;
revoke all on function public.equipment_preparation_transfer_read(uuid,text,jsonb) from public,anon;
grant execute on function public.equipment_preparation_transfer_read(uuid,text,jsonb) to authenticated;
