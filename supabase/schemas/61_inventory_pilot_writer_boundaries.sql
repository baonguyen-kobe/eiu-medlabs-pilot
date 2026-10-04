-- Keep accepted public signatures and core retry hashes; transport metadata is not physical payload.
create or replace function private.p1_preflight(p_writer text,p_operation text,p_payload jsonb,p_request uuid,p_retry uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c private.inventory_pilot_writer_context; replay_operation text; replay boolean; data jsonb; target record;
begin
 if p_writer='inventory_command' and p_operation not in ('receive_stock','confirm_opening_balance','correct_receipt','reverse_receipt','correct_opening_balance','verify_opening_expiry','transfer_stock','change_stock_condition','reconcile_stocktake','verify_stocktake_surplus') then return; end if;
 if p_writer='equipment_preparation_command' and p_operation not in ('confirm','approve_adjustment','reallocate','finalize_reversal') then return; end if;
 if p_writer='equipment_fulfillment_command' and p_operation='sign' then return; end if;
 replay_operation:=case p_writer when 'equipment_preparation_command' then 's4:'||p_operation when 'equipment_preparation_transfer' then 's4:physical_transfer' when 'equipment_fulfillment_command' then 's5:'||p_operation else p_operation end;
 -- The core still checks authorization and its exact payload hash. A replay has no new physical effect.
 replay:=exists(select 1 from public.inventory_operation_replays where actor_id=auth.uid() and operation=replay_operation and retry_key=p_retry);
 select * into c from private.inventory_pilot_writer_context where transaction_id=txid_current();
 if p_writer='equipment_asset_command' and p_operation='open_asset' and p_payload->'synthetic'='false'::jsonb then perform private.p1_real_opening(p_payload,replay); end if;
 if c.pilot is not null then
  select i.catalog_item_id,s.location_id into target from public.inventory_pilot_scopes s join public.inventory_pilot_scope_items i on i.scope_id=s.id where s.id=(c.pilot->>'scope_id')::uuid order by i.catalog_item_id limit 1;
  perform private.p1_gate(target.catalog_item_id,target.location_id,null,replay);
 end if;
 data:=p_payload;
 if p_request is not null then data:=jsonb_build_array(p_payload,coalesce((select to_jsonb(p) from public.equipment_preparations p where p.request_id=p_request and p.state in ('draft','prepared','reversing')),'{}'::jsonb)); end if;
 -- Early phase denial also covers valid targets whose core could reject before posting.
 -- Row guards below remain authoritative for actual dimensions, batches, and nested writes.
 for target in
  with ids as (select distinct (v#>>'{}')::uuid id from jsonb_path_query(data,'$.** ? (@.type() == "string")') v where v#>>'{}' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'),
  targets as (
   select i.catalog_item_id,s.location_id,null::uuid asset_id from ids x join public.inventory_pilot_scope_items i on i.catalog_item_id=x.id join public.inventory_pilot_scopes s on s.id=i.scope_id
   union select i.catalog_item_id,s.location_id,null::uuid from ids x join public.inventory_pilot_scopes s on s.location_id=x.id join public.inventory_pilot_scope_items i on i.scope_id=s.id
   union select a.catalog_item_id,a.location_id,a.id from ids x join public.equipment_assets a on a.id=x.id join public.inventory_pilot_scope_items i on i.catalog_item_id=a.catalog_item_id
   union select o.catalog_item_id,f.location_id,null::uuid from ids x join public.inventory_stock_origins o on o.id=x.id join public.inventory_pilot_scope_items i on i.catalog_item_id=o.catalog_item_id join public.inventory_receipt_cohorts c0 on c0.origin_id=o.id join public.inventory_stock_facts f on f.id=c0.current_fact_id
   union select m.inventory_item_id,s.location_id,null::uuid from ids x join public.equipment_inventory_mappings m on m.id=x.id join public.inventory_pilot_scope_items i on i.catalog_item_id=m.inventory_item_id join public.inventory_pilot_scopes s on s.id=i.scope_id
   union select sl.inventory_item_id,sl.location_id,sl.asset_id from ids x join public.equipment_issue_slices sl on sl.id=x.id join public.inventory_pilot_scope_items i on i.catalog_item_id=sl.inventory_item_id
   union select o.catalog_item_id,f.location_id,null::uuid from ids x join public.inventory_transactions t on t.id=x.id join public.inventory_stock_origins o on o.opening_batch_id in (select id from public.inventory_opening_batches where transaction_id=t.id) or o.receipt_id in (select id from public.inventory_receipts where transaction_id=t.id) join public.inventory_pilot_scope_items i on i.catalog_item_id=o.catalog_item_id join public.inventory_receipt_cohorts c0 on c0.origin_id=o.id join public.inventory_stock_facts f on f.id=c0.current_fact_id
  ) select distinct * from targets
 loop perform private.p1_gate(target.catalog_item_id,target.location_id,target.asset_id,replay); end loop;
end; $$;
revoke all on function private.p1_preflight(text,text,jsonb,uuid,uuid) from public,anon,authenticated,service_role;

do $$ begin
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='inventory_command' and pg_get_function_identity_arguments(p.oid)='p_operation text, p_payload jsonb, p_retry_key uuid')
    and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='p1_inventory_core') then
  alter function public.inventory_command(text,jsonb,uuid) set schema private;
  alter function private.inventory_command(text,jsonb,uuid) rename to p1_inventory_core;
 end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='equipment_asset_command' and pg_get_function_identity_arguments(p.oid)='p_operation text, p_payload jsonb, p_retry_key uuid')
    and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='p1_asset_core') then
  alter function public.equipment_asset_command(text,jsonb,uuid) set schema private;
  alter function private.equipment_asset_command(text,jsonb,uuid) rename to p1_asset_core;
 end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='equipment_preparation_command' and pg_get_function_identity_arguments(p.oid)='p_operation text, p_request_id uuid, p_payload jsonb, p_retry_key uuid')
    and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='p1_preparation_core') then
  alter function public.equipment_preparation_command(text,uuid,jsonb,uuid) set schema private;
  alter function private.equipment_preparation_command(text,uuid,jsonb,uuid) rename to p1_preparation_core;
 end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='equipment_preparation_transfer' and pg_get_function_identity_arguments(p.oid)='p_request_id uuid, p_payload jsonb, p_retry_key uuid')
    and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='p1_transfer_core') then
  alter function public.equipment_preparation_transfer(uuid,jsonb,uuid) set schema private;
  alter function private.equipment_preparation_transfer(uuid,jsonb,uuid) rename to p1_transfer_core;
 end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='equipment_fulfillment_command' and pg_get_function_identity_arguments(p.oid)='p_operation text, p_request_id uuid, p_payload jsonb, p_retry_key uuid')
    and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='p1_fulfillment_core') then
  alter function public.equipment_fulfillment_command(text,uuid,jsonb,uuid) set schema private;
  alter function private.equipment_fulfillment_command(text,uuid,jsonb,uuid) rename to p1_fulfillment_core;
 end if;
end $$;
drop function if exists private.inventory_command(text,jsonb,uuid);
revoke all on function private.p1_inventory_core(text,jsonb,uuid),private.p1_asset_core(text,jsonb,uuid),private.p1_preparation_core(text,uuid,jsonb,uuid),private.p1_transfer_core(uuid,jsonb,uuid),private.p1_fulfillment_core(text,uuid,jsonb,uuid) from public,anon,authenticated,service_role;

create or replace function public.inventory_command(p_operation text,p_payload jsonb,p_retry_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous private.inventory_pilot_writer_context; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 previous:=private.p1_enter('inventory_command',p_operation,p_payload);
 perform private.p1_preflight('inventory_command',p_operation,p_payload,null,p_retry_key);
 result:=private.p1_inventory_core(p_operation,p_payload-'pilot',p_retry_key);
 perform private.p1_leave(previous); return result;
end; $$;
create or replace function public.equipment_asset_command(p_operation text,p_payload jsonb,p_retry_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous private.inventory_pilot_writer_context; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 previous:=private.p1_enter('equipment_asset_command',p_operation,p_payload);
 perform private.p1_preflight('equipment_asset_command',p_operation,p_payload,null,p_retry_key);
 result:=private.p1_asset_core(p_operation,p_payload-'pilot',p_retry_key);
 perform private.p1_leave(previous); return result;
end; $$;
create or replace function public.equipment_preparation_command(p_operation text,p_request_id uuid,p_payload jsonb,p_retry_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous private.inventory_pilot_writer_context; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 previous:=private.p1_enter('equipment_preparation_command',p_operation,p_payload,p_request_id);
 perform private.p1_preflight('equipment_preparation_command',p_operation,p_payload,p_request_id,p_retry_key);
 result:=private.p1_preparation_core(p_operation,p_request_id,p_payload-'pilot',p_retry_key);
 perform private.p1_leave(previous); return result;
end; $$;
create or replace function public.equipment_preparation_transfer(p_request_id uuid,p_payload jsonb,p_retry_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous private.inventory_pilot_writer_context; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 previous:=private.p1_enter('equipment_preparation_transfer','physical_transfer',p_payload,p_request_id);
 perform private.p1_preflight('equipment_preparation_transfer','physical_transfer',p_payload,p_request_id,p_retry_key);
 result:=private.p1_transfer_core(p_request_id,p_payload-'pilot',p_retry_key);
 perform private.p1_leave(previous); return result;
end; $$;
create or replace function public.equipment_fulfillment_command(p_operation text,p_request_id uuid,p_payload jsonb,p_retry_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous private.inventory_pilot_writer_context; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 previous:=private.p1_enter('equipment_fulfillment_command',p_operation,p_payload,p_request_id);
 perform private.p1_preflight('equipment_fulfillment_command',p_operation,p_payload,p_request_id,p_retry_key);
 result:=private.p1_fulfillment_core(p_operation,p_request_id,p_payload-'pilot',p_retry_key);
 perform private.p1_leave(previous); return result;
end; $$;
revoke all on function public.inventory_command(text,jsonb,uuid),public.equipment_asset_command(text,jsonb,uuid),public.equipment_preparation_command(text,uuid,jsonb,uuid),public.equipment_preparation_transfer(uuid,jsonb,uuid),public.equipment_fulfillment_command(text,uuid,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.inventory_command(text,jsonb,uuid),public.equipment_asset_command(text,jsonb,uuid),public.equipment_preparation_command(text,uuid,jsonb,uuid),public.equipment_preparation_transfer(uuid,jsonb,uuid),public.equipment_fulfillment_command(text,uuid,jsonb,uuid) to authenticated;
