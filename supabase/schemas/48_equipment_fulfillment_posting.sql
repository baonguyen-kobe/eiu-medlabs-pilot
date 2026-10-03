-- Private posting primitives; callers hold inventory:s1:writer and request lock.
alter table public.inventory_transactions drop constraint inventory_transactions_operation_valid;
alter table public.inventory_transactions add constraint inventory_transactions_operation_valid check(operation in (
 'RECEIVE','OPENING','CORRECT_RECEIPT','REVERSE_RECEIPT','CORRECT_OPENING','TRANSFER','CONDITION_CHANGE','STOCKTAKE_ADJUST','STOCKTAKE_SURPLUS','VERIFY_SURPLUS',
 'ASSET_RECEIVE','ASSET_OPEN','ASSET_SET_STATE','ASSET_SET_LIFECYCLE','ASSET_CORRECT','EQUIPMENT_FULFILLMENT'));
alter table public.equipment_asset_events drop constraint equipment_asset_events_operation_valid;
alter table public.equipment_asset_events add constraint equipment_asset_events_operation_valid check(operation in ('receive_asset','open_asset','set_asset_state','set_asset_lifecycle','correct_asset','fulfillment'));

create or replace function private.s5_stock(p_tx uuid,p_cohort uuid,p_item uuid,p_location uuid,p_condition text,p_delta numeric)
returns void language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if p_delta=0 then return; end if;
 select coalesce(max(line_no),0)+1 into n from public.inventory_transaction_lines where transaction_id=p_tx;
 insert into public.inventory_transaction_lines(transaction_id,line_no,cohort_id,catalog_item_id,location_id,condition,quantity_delta) values(p_tx,n,p_cohort,p_item,p_location,p_condition,p_delta);
 if p_delta<0 then
  update public.inventory_stock_balances set quantity=quantity+p_delta,updated_at=clock_timestamp() where cohort_id=p_cohort and location_id=p_location and condition=p_condition and quantity>=-p_delta;
  if not found then raise exception 'S5_INSUFFICIENT_PHYSICAL_STOCK'; end if;
 else
  insert into public.inventory_stock_balances(cohort_id,location_id,condition,quantity) values(p_cohort,p_location,p_condition,p_delta)
  on conflict(cohort_id,location_id,condition) do update set quantity=inventory_stock_balances.quantity+excluded.quantity,updated_at=clock_timestamp();
 end if;
 update public.inventory_receipt_cohorts set revision=revision+1,updated_at=clock_timestamp() where origin_id=p_cohort;
end; $$;

create or replace function private.s5_asset(p_tx uuid,p_asset uuid,p_location uuid,p_custodian uuid,p_state text,p_lifecycle text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare before_asset public.equipment_assets; after_asset public.equipment_assets;
begin
 select * into strict before_asset from public.equipment_assets where id=p_asset for update;
 if before_asset.lifecycle_status='disposed' and p_lifecycle is distinct from 'disposed' then raise exception 'DISPOSED_REACTIVATION_FORBIDDEN'; end if;
 update public.equipment_assets set location_id=p_location,custodian_id=p_custodian,operational_status=p_state,lifecycle_status=p_lifecycle,revision=revision+1 where id=p_asset returning * into after_asset;
 insert into public.equipment_asset_events(asset_id,revision,operation,actor_id,occurred_at,reason,evidence_note,before_state,after_state,transaction_id)
 values(p_asset,after_asset.revision,'fulfillment',auth.uid(),clock_timestamp(),p_reason,p_reason,to_jsonb(before_asset),to_jsonb(after_asset),p_tx);
end; $$;

create or replace function private.s5_issue(p_event uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare e public.equipment_fulfillment_events; r public.equipment_requests; j jsonb; ar jsonb; m record; pool record; a public.equipment_assets; q numeric; needed numeric; take numeric;
begin
 select * into strict e from public.equipment_fulfillment_events where id=p_event;
 select * into strict r from public.equipment_requests where id=e.request_id;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 500 then raise exception 'S5_ISSUE_LINES_REQUIRED'; end if;
 for j in select value from jsonb_array_elements(p_lines) loop
  select mp.*,i.return_semantics,i.tracking_strategy,u.allowed_scale into m from public.equipment_inventory_mappings mp
   join public.inventory_catalog_items i on i.id=mp.inventory_item_id join public.inventory_uoms u on u.code=i.base_uom_code
   join public.equipment_request_items l on l.catalog_item_id=mp.catalog_item_id
   where mp.id=(j->>'mapping_id')::uuid and l.id=(j->>'line_id')::uuid and l.request_id=r.id and l.removed_at is null and i.active;
  if not found or m.return_semantics='in_place' then raise exception 'S5_INVALID_ISSUE_MAPPING'; end if;
  q:=private.s4_quantity(j->>'quantity');
  if q<=0 or q<>round(q,m.allowed_scale) then raise exception 'S5_INVALID_QUANTITY'; end if;
  if not exists(select 1 from public.inventory_storage_locations where id=(j->>'location_id')::uuid and active) then raise exception 'S5_INVALID_LOCATION'; end if;
  if m.tracking_strategy='serialized' then
   if jsonb_typeof(j->'asset_ids') is distinct from 'array' or jsonb_array_length(j->'asset_ids')<>q then raise exception 'S5_EXACT_ASSETS_REQUIRED'; end if;
   for ar in select value from jsonb_array_elements(j->'asset_ids') loop
    select * into a from public.equipment_assets where id=(ar#>>'{}')::uuid for update;
    if not found or a.catalog_item_id<>m.inventory_item_id or not private.s4_asset_eligible(a.id,(j->>'location_id')::uuid)
      or exists(select 1 from public.inventory_reservations where asset_id=a.id and released_at is null)
      or exists(select 1 from public.equipment_issue_slices s cross join lateral private.s5_obligation(s.id) o where s.asset_id=a.id and (o.issued>o.returned or o.held>0)) then raise exception 'S5_ASSET_UNAVAILABLE'; end if;
    insert into public.equipment_issue_slices(event_id,request_line_id,mapping_id,inventory_item_id,location_id,asset_id,quantity,return_required,base_units_per_requested_unit)
    values(e.id,(j->>'line_id')::uuid,m.id,m.inventory_item_id,a.location_id,a.id,1,m.return_semantics='returnable',m.base_units_per_requested_unit);
    perform private.s5_asset(e.transaction_id,a.id,a.location_id,r.responsible_lecturer_id,'in_use',a.lifecycle_status,e.reason);
   end loop;
  else
   if coalesce(jsonb_array_length(j->'asset_ids'),0)<>0 then raise exception 'S5_QUANTITY_ASSET_MISMATCH'; end if;
   needed:=q;
   for pool in select c.origin_id,f.expiry_date from public.inventory_receipt_cohorts c join public.inventory_stock_origins o on o.id=c.origin_id join public.inventory_stock_facts f on f.id=c.current_fact_id where o.catalog_item_id=m.inventory_item_id order by f.expiry_date nulls last,o.created_at,c.origin_id loop
    take:=least(needed,private.s4_available(pool.origin_id,(j->>'location_id')::uuid));
    if take<=0 then continue; end if;
    insert into public.equipment_issue_slices(event_id,request_line_id,mapping_id,inventory_item_id,location_id,cohort_id,quantity,return_required,base_units_per_requested_unit)
    values(e.id,(j->>'line_id')::uuid,m.id,m.inventory_item_id,(j->>'location_id')::uuid,pool.origin_id,take,m.return_semantics='returnable',m.base_units_per_requested_unit);
    perform private.s5_stock(e.transaction_id,pool.origin_id,m.inventory_item_id,(j->>'location_id')::uuid,'good',-take);
    needed:=needed-take;
    exit when needed=0;
   end loop;
   if needed<>0 then raise exception 'S5_INSUFFICIENT_AVAILABLE'; end if;
  end if;
 end loop;
end; $$;
revoke all on function private.s5_stock(uuid,uuid,uuid,uuid,text,numeric),private.s5_asset(uuid,uuid,uuid,uuid,text,text,text),private.s5_issue(uuid,jsonb) from public,anon,authenticated;
