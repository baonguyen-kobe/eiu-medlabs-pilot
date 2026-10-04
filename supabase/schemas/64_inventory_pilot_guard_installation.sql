create or replace function private.p1_replay_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare c private.inventory_pilot_writer_context; expected text;
begin
 select * into c from private.inventory_pilot_writer_context where transaction_id=txid_current() and backend_pid=pg_backend_pid();
 if c.transaction_id is null or c.actor_id is distinct from auth.uid() or new.actor_id is distinct from c.actor_id then raise exception 'P1_REPLAY_RPC_REQUIRED' using errcode='42501'; end if;
 expected:=case c.writer_id when 'inventory_command' then c.operation when 'equipment_asset_command' then c.operation when 'equipment_preparation_command' then 's4:'||c.operation when 'equipment_preparation_transfer' then 's4:physical_transfer' when 'equipment_fulfillment_command' then 's5:'||c.operation when 'inventory_pilot_command' then 'p1:'||c.operation else null end;
 if expected is null or new.operation is distinct from expected then raise exception 'P1_REPLAY_WRITER_MISMATCH' using errcode='42501'; end if;
 return new;
end; $$;
create or replace function private.p1_header_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare c private.inventory_pilot_writer_context; scope uuid; actor uuid; item uuid; loc uuid; request uuid;
begin
 if not exists(select 1 from public.inventory_pilot_scopes) then return new; end if;
 if tg_table_name='inventory_transactions' then
  actor:=new.actor_id;
  if split_part(new.business_key,':',1)~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then request:=split_part(new.business_key,':',1)::uuid; scope:=private.p1_request_scope(request); end if;
 elsif tg_table_name='inventory_receipts' then select actor_id into actor from public.inventory_transactions where id=new.transaction_id;
 elsif tg_table_name='inventory_opening_batches' then
  select id into scope from public.inventory_pilot_scopes where opening_reference=new.cutover_key or new.cutover_key like (manifest->>'scope_code')||'-%';
  select actor_id into actor from public.inventory_transactions where id=new.transaction_id;
 elsif tg_table_name='equipment_fulfillment_events' then request:=new.request_id; actor:=new.actor_id; scope:=private.p1_request_scope(request);
 end if;
 if scope is not null or exists(select 1 from public.inventory_pilot_scopes s where s.admin_id=actor or actor=any(s.staff_ids)) then
  select * into c from private.inventory_pilot_writer_context where transaction_id=txid_current() and backend_pid=pg_backend_pid();
  if c.transaction_id is null or c.actor_id is distinct from auth.uid() or c.actor_id is distinct from actor or c.writer_id not in ('inventory_command','equipment_asset_command','equipment_preparation_command','equipment_preparation_transfer','equipment_fulfillment_command') then raise exception 'P1_HEADER_RPC_REQUIRED' using errcode='42501'; end if;
  if scope is not null then
   select i.catalog_item_id,s.location_id into item,loc from public.inventory_pilot_scopes s join public.inventory_pilot_scope_items i on i.scope_id=s.id where s.id=scope order by i.catalog_item_id limit 1;
   if request is not null then perform private.p1_request_gate(item,loc,null,request); else perform private.p1_gate(item,loc); end if;
  end if;
 end if;
 return new;
end; $$;
create or replace function private.p1_master_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='inventory_catalog_items' then
  if exists(select 1 from public.inventory_pilot_scope_items where catalog_item_id=old.id) then
   if tg_op='DELETE' then raise exception 'P1_FROZEN_SCOPE' using errcode='42501'; end if;
   if row(new.id,new.code,new.name,new.base_uom_code,new.material_kind,new.tracking_strategy,new.return_semantics,new.expiry_required) is distinct from row(old.id,old.code,old.name,old.base_uom_code,old.material_kind,old.tracking_strategy,old.return_semantics,old.expiry_required) then raise exception 'P1_FROZEN_SCOPE' using errcode='42501'; end if;
  end if;
 elsif tg_table_name='inventory_storage_locations' then
  if exists(select 1 from public.inventory_pilot_scopes where location_id=old.id) then
   if tg_op='DELETE' then raise exception 'P1_FROZEN_SCOPE' using errcode='42501'; end if;
   if row(new.id,new.code,new.name,new.parent_location_id,new.room_id) is distinct from row(old.id,old.code,old.name,old.parent_location_id,old.room_id) then raise exception 'P1_FROZEN_SCOPE' using errcode='42501'; end if;
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
create or replace function private.p1_truncate_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- TRUNCATE has no OLD rows. Whole-table operations cannot exclude the registered scope.
 if exists(select 1 from public.inventory_pilot_scopes) then raise exception 'P1_SCOPED_TRUNCATE_DENIED' using errcode='42501'; end if;
 return null;
end; $$;
revoke all on function private.p1_replay_guard(),private.p1_header_guard(),private.p1_master_guard(),private.p1_truncate_guard() from public,anon,authenticated,service_role;

do $$ declare t text; begin
 foreach t in array array['inventory_pilot_scopes','inventory_pilot_scope_items','inventory_pilot_writers','inventory_pilot_asset_bindings','inventory_pilot_events'] loop
  execute format('drop trigger if exists p1_control on public.%I; create trigger p1_control before insert or update or delete on public.%I for each row execute function private.p1_control_guard()',t,t);
 end loop;
 foreach t in array array['inventory_stock_origins','inventory_stock_facts','inventory_receipt_cohorts','inventory_transaction_lines','inventory_stock_balances','inventory_opening_scope','inventory_stocktake_surplus_records','inventory_stock_holds'] loop
  execute format('drop trigger if exists p1_quantity on public.%I; create trigger p1_quantity before insert or update or delete on public.%I for each row execute function private.p1_quantity_guard()',t,t);
 end loop;
 foreach t in array array['equipment_assets','equipment_asset_events'] loop
  execute format('drop trigger if exists p1_asset on public.%I; create trigger p1_asset before insert or update or delete on public.%I for each row execute function private.p1_asset_guard()',t,t);
 end loop;
 foreach t in array array['equipment_preparation_allocations','inventory_reservations','equipment_preparation_transfers','equipment_issue_slices','equipment_fulfillment_effects'] loop
  execute format('drop trigger if exists p1_request_fact on public.%I; create trigger p1_request_fact before insert or update or delete on public.%I for each row execute function private.p1_request_fact_guard()',t,t);
 end loop;
 foreach t in array array['inventory_transactions','inventory_receipts','inventory_opening_batches','equipment_fulfillment_events'] loop
  execute format('drop trigger if exists p1_header on public.%I; create trigger p1_header before insert on public.%I for each row execute function private.p1_header_guard()',t,t);
 end loop;
 foreach t in array array['inventory_catalog_items','inventory_storage_locations'] loop
  execute format('drop trigger if exists p1_master on public.%I; create trigger p1_master before update or delete on public.%I for each row execute function private.p1_master_guard()',t,t);
 end loop;
 foreach t in array array['inventory_pilot_scopes','inventory_pilot_scope_items','inventory_pilot_writers','inventory_pilot_asset_bindings','inventory_pilot_events','inventory_catalog_items','inventory_storage_locations','inventory_transactions','inventory_receipts','inventory_opening_batches','inventory_opening_scope','inventory_stock_origins','inventory_stock_facts','inventory_receipt_cohorts','inventory_transaction_lines','inventory_stock_balances','inventory_stocktake_surplus_records','inventory_stock_holds','equipment_assets','equipment_asset_events','equipment_preparations','equipment_preparation_plans','equipment_preparation_allocations','inventory_reservations','equipment_preparation_transfers','equipment_fulfillment_events','equipment_issue_slices','equipment_fulfillment_effects','equipment_fulfillment_signatures','inventory_operation_replays','equipment_requests','equipment_request_items','equipment_inventory_mappings','inventory_stock_evidence'] loop
  execute format('drop trigger if exists p1_truncate on public.%I; create trigger p1_truncate before truncate on public.%I for each statement execute function private.p1_truncate_guard()',t,t);
 end loop;
end $$;
drop trigger if exists p1_replay on public.inventory_operation_replays;
create trigger p1_replay before insert on public.inventory_operation_replays for each row execute function private.p1_replay_guard();
drop trigger if exists p1_projection on public.equipment_requests;
create trigger p1_projection before update on public.equipment_requests for each row execute function private.p1_request_projection_guard();
drop trigger if exists p1_preparation_state on public.equipment_preparations;
create trigger p1_preparation_state before update on public.equipment_preparations for each row execute function private.p1_preparation_state_guard();
drop trigger if exists p1_asset_binding on public.equipment_asset_events;
create trigger p1_asset_binding after insert on public.equipment_asset_events for each row execute function private.p1_asset_opened();
drop trigger if exists p1_context_truncate on private.inventory_pilot_writer_context;
create trigger p1_context_truncate before truncate on private.inventory_pilot_writer_context for each statement execute function private.p1_truncate_guard();
