create or replace function private.p1_quantity_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare item uuid; loc uuid; fact uuid;
begin
 if tg_table_name='inventory_stock_origins' then
  if tg_op<>'INSERT' then
   select f.location_id into loc from public.inventory_receipt_cohorts c join public.inventory_stock_facts f on f.id=c.current_fact_id where c.origin_id=old.id;
   perform private.p1_gate(old.catalog_item_id,loc);
  end if;
  if tg_op<>'DELETE' then perform private.p1_gate(new.catalog_item_id); end if;
 elsif tg_table_name='inventory_stock_facts' then
  if tg_op<>'INSERT' then select catalog_item_id into item from public.inventory_stock_origins where id=old.origin_id; perform private.p1_gate(item,old.location_id); end if;
  if tg_op<>'DELETE' then select catalog_item_id into item from public.inventory_stock_origins where id=new.origin_id; perform private.p1_gate(item,new.location_id); end if;
 elsif tg_table_name='inventory_receipt_cohorts' then
  if tg_op<>'INSERT' then select o.catalog_item_id,f.location_id into item,loc from public.inventory_stock_origins o join public.inventory_stock_facts f on f.id=old.current_fact_id where o.id=old.origin_id; perform private.p1_gate(item,loc); end if;
  if tg_op<>'DELETE' then select o.catalog_item_id,f.location_id into item,loc from public.inventory_stock_origins o join public.inventory_stock_facts f on f.id=new.current_fact_id where o.id=new.origin_id; perform private.p1_gate(item,loc); end if;
 elsif tg_table_name in ('inventory_transaction_lines','inventory_stock_balances') then
  if tg_op<>'INSERT' then select catalog_item_id into item from public.inventory_stock_origins where id=old.cohort_id; perform private.p1_gate(item,old.location_id); end if;
  if tg_op<>'DELETE' then
   select catalog_item_id into item from public.inventory_stock_origins where id=new.cohort_id; perform private.p1_gate(item,new.location_id);
   if tg_table_name='inventory_transaction_lines' then
    if new.catalog_item_id is distinct from item and (exists(select 1 from public.inventory_pilot_scope_items where catalog_item_id in (item,new.catalog_item_id)) or exists(select 1 from public.inventory_pilot_scopes where location_id=new.location_id)) then raise exception 'P1_LEDGER_ITEM_MISMATCH' using errcode='42501'; end if;
   end if;
  end if;
 elsif tg_table_name='inventory_opening_scope' then
  if tg_op<>'INSERT' then perform private.p1_gate(old.catalog_item_id,old.location_id); end if;
  if tg_op<>'DELETE' then perform private.p1_gate(new.catalog_item_id,new.location_id); end if;
 elsif tg_table_name='inventory_stocktake_surplus_records' then
  if tg_op<>'INSERT' then perform private.p1_gate(old.catalog_item_id,old.initial_location_id); end if;
  if tg_op<>'DELETE' then perform private.p1_gate(new.catalog_item_id,new.initial_location_id); end if;
 elsif tg_table_name='inventory_stock_holds' then
  if tg_op<>'INSERT' then select o.catalog_item_id,f.location_id into item,loc from public.inventory_stock_origins o join public.inventory_receipt_cohorts c on c.origin_id=o.id join public.inventory_stock_facts f on f.id=c.current_fact_id where o.id=old.origin_id; perform private.p1_gate(item,loc); end if;
  if tg_op<>'DELETE' then select o.catalog_item_id,f.location_id into item,loc from public.inventory_stock_origins o join public.inventory_receipt_cohorts c on c.origin_id=o.id join public.inventory_stock_facts f on f.id=c.current_fact_id where o.id=new.origin_id; perform private.p1_gate(item,loc); end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
create or replace function private.p1_asset_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare s public.inventory_pilot_scopes; b public.inventory_pilot_asset_bindings; c private.inventory_pilot_writer_context; asset public.equipment_assets;
begin
 if tg_table_name='equipment_asset_events' then
  if tg_op<>'INSERT' then select * into asset from public.equipment_assets where id=old.asset_id; perform private.p1_gate(asset.catalog_item_id,asset.location_id,asset.id); end if;
  if tg_op<>'DELETE' then select * into asset from public.equipment_assets where id=new.asset_id; perform private.p1_gate(asset.catalog_item_id,asset.location_id,asset.id); end if;
 else
  if tg_op<>'INSERT' then perform private.p1_gate(old.catalog_item_id,old.location_id,old.id); end if;
  if tg_op<>'DELETE' then
   -- A BEFORE INSERT cannot look up the not-yet-inserted asset UUID.
   perform private.p1_gate(new.catalog_item_id,new.location_id,case when tg_op='INSERT' then null else old.id end);
   select scope.* into s from public.inventory_pilot_scopes scope where scope.location_id=new.location_id or exists(select 1 from public.inventory_pilot_scope_items i where i.scope_id=scope.id and i.catalog_item_id=new.catalog_item_id);
   if s.id is not null then
    select * into b from public.inventory_pilot_asset_bindings where scope_id=s.id;
    if row(new.catalog_item_id,new.location_id,new.intake_kind,new.intake_reference,new.row_key,lower(btrim(new.manufacturer)),lower(btrim(new.model)),lower(btrim(new.manufacturer_serial))) is distinct from row(b.catalog_item_id,b.location_id,'open',b.intake_reference,b.row_key,lower(btrim(b.manufacturer)),lower(btrim(b.model)),lower(btrim(b.manufacturer_serial))) or (b.asset_id is not null and new.id<>b.asset_id) then raise exception 'P1_ASSET_IDENTITY_MISMATCH' using errcode='42501'; end if;
    if s.phase='OPENING_READY' then
     if new.operational_status is distinct from coalesce(s.manifest#>>'{asset,operational_status}','ready') or new.custodian_id is distinct from (s.manifest#>>'{asset,custodian_id}')::uuid or new.lifecycle_status not in ('registered','in_service') then raise exception 'P1_OPENING_ASSET_STATE_MISMATCH' using errcode='42501'; end if;
    end if;
   end if;
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
revoke all on function private.p1_quantity_guard(),private.p1_asset_guard() from public,anon,authenticated,service_role;
