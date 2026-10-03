-- S5 isolated Skills pilot; canonical declarations schemas 47–54 plus lifecycle integration.
-- S5: request physical facts are distinct from recipient signatures.
-- Authority: medlabs-OPs/plans/S5_DESIGN_PACK.md (INV-057/058).
alter table public.equipment_requests add column if not exists fulfillment_revision bigint not null default 0;

create table if not exists public.equipment_fulfillment_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.equipment_requests(id) on delete restrict,
 preparation_id uuid not null references public.equipment_preparations(id) on delete restrict,
 revision bigint not null check(revision>0),
 operation text not null check(operation in ('handover','supplement','initial_return','recover','resolve','consequence','reconcile','correct')),
 business_key text not null check(btrim(business_key)<>''),
 actor_id uuid not null references public.profiles(id) on delete restrict,
 occurred_at timestamptz not null default clock_timestamp(),
 reason text not null check(btrim(reason)<>''),
 payload jsonb not null,
 corrects_event_id uuid references public.equipment_fulfillment_events(id) on delete restrict,
 transaction_id uuid references public.inventory_transactions(id) on delete restrict,
 signature_required boolean not null default false,
 unique(request_id,revision), unique(request_id,business_key)
);
create unique index if not exists equipment_fulfillment_initial_once on public.equipment_fulfillment_events(request_id,operation) where operation in ('handover','initial_return');
create index if not exists equipment_fulfillment_preparation on public.equipment_fulfillment_events(preparation_id);
create index if not exists equipment_fulfillment_correction on public.equipment_fulfillment_events(corrects_event_id) where corrects_event_id is not null;

-- Each issue slice retains exact provenance, units and return policy forever.
create table if not exists public.equipment_issue_slices (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.equipment_fulfillment_events(id) on delete restrict,
 request_line_id uuid not null references public.equipment_request_items(id) on delete restrict,
 mapping_id uuid not null references public.equipment_inventory_mappings(id) on delete restrict,
 inventory_item_id uuid not null references public.inventory_catalog_items(id) on delete restrict,
 location_id uuid not null references public.inventory_storage_locations(id) on delete restrict,
 cohort_id uuid references public.inventory_receipt_cohorts(origin_id) on delete restrict,
 asset_id uuid references public.equipment_assets(id) on delete restrict,
 quantity numeric(18,6) not null check(quantity>0),
 return_required boolean not null,
 base_units_per_requested_unit numeric(18,6) not null check(base_units_per_requested_unit>0),
 check((cohort_id is null)<>(asset_id is null)),
 check(asset_id is null or quantity=1)
);
create index if not exists equipment_issue_event on public.equipment_issue_slices(event_id);
create index if not exists equipment_issue_asset on public.equipment_issue_slices(asset_id) where asset_id is not null;
create index if not exists equipment_issue_line on public.equipment_issue_slices(request_line_id);

-- Positive receipt/resolution removes an obligation; negative corrections append
-- offsets. No mutable cumulative counters can diverge from the source facts.
create table if not exists public.equipment_fulfillment_effects (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.equipment_fulfillment_events(id) on delete restrict,
 issue_slice_id uuid not null references public.equipment_issue_slices(id) on delete restrict,
 kind text not null check(kind in ('issue_correction','receipt','resolution','consequence','hold','reconciliation')),
 quantity numeric(18,6) not null check(quantity<>0),
 location_id uuid references public.inventory_storage_locations(id) on delete restrict,
 condition text check(condition in ('good','damaged')),
 classification text,
 offsets_effect_id uuid references public.equipment_fulfillment_effects(id) on delete restrict,
 check(kind<>'receipt' or (location_id is not null and condition is not null))
);
create index if not exists equipment_effect_event on public.equipment_fulfillment_effects(event_id);
create index if not exists equipment_effect_slice on public.equipment_fulfillment_effects(issue_slice_id,kind);
create index if not exists equipment_effect_offset on public.equipment_fulfillment_effects(offsets_effect_id) where offsets_effect_id is not null;
create table if not exists public.equipment_fulfillment_signatures (
 event_id uuid primary key references public.equipment_fulfillment_events(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 signed_at timestamptz not null default clock_timestamp(),
 snapshot_hash text not null,
 signature text not null check(length(signature) between 100 and 400000 and signature like 'data:image/png;base64,%')
);

do $$ declare t text; begin
 foreach t in array array['equipment_fulfillment_events','equipment_issue_slices','equipment_fulfillment_effects','equipment_fulfillment_signatures'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('drop trigger if exists immutable_history on public.%I',t);
  execute format('create trigger immutable_history before update or delete on public.%I for each row execute function private.prevent_inventory_history_mutation()',t);
 end loop;
end $$;
drop policy if exists fulfillment_read on public.equipment_fulfillment_events;
create policy fulfillment_read on public.equipment_fulfillment_events for select to authenticated using(private.can_read_preparation(request_id));
drop policy if exists fulfillment_read on public.equipment_issue_slices;
create policy fulfillment_read on public.equipment_issue_slices for select to authenticated using(exists(select 1 from public.equipment_fulfillment_events e where e.id=event_id));
drop policy if exists fulfillment_read on public.equipment_fulfillment_effects;
create policy fulfillment_read on public.equipment_fulfillment_effects for select to authenticated using(exists(select 1 from public.equipment_fulfillment_events e where e.id=event_id));
drop policy if exists fulfillment_read on public.equipment_fulfillment_signatures;
create policy fulfillment_read on public.equipment_fulfillment_signatures for select to authenticated using(exists(select 1 from public.equipment_fulfillment_events e where e.id=event_id));

create or replace function private.s5_obligation(p_slice uuid)
returns table(issued numeric,returned numeric,resolved numeric,due numeric,held numeric)
language sql stable security definer set search_path='' as $$
 select s.quantity+coalesce(sum(f.quantity) filter(where f.kind='issue_correction'),0),
 coalesce(sum(f.quantity) filter(where f.kind='receipt'),0),
 coalesce(sum(f.quantity) filter(where f.kind='resolution'),0),
 case when s.return_required then s.quantity+coalesce(sum(f.quantity) filter(where f.kind='issue_correction'),0)-coalesce(sum(f.quantity) filter(where f.kind in ('receipt','resolution')),0) else 0 end,
 coalesce(sum(f.quantity) filter(where f.kind in ('hold','reconciliation')),0)
 from public.equipment_issue_slices s left join public.equipment_fulfillment_effects f on f.issue_slice_id=s.id where s.id=p_slice group by s.id;
$$;
revoke all on function private.s5_obligation(uuid) from public,anon,authenticated;

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

create or replace function private.s5_receive(p_event uuid,p_lines jsonb,p_cumulative boolean)
returns void language plpgsql security definer set search_path='' as $$
declare e public.equipment_fulfillment_events; s public.equipment_issue_slices; o record; j jsonb; q numeric; already numeric; remaining numeric; offset_q numeric; f record; loc uuid; cond text; asset public.equipment_assets; settled boolean; seen text[]:='{}'; key text;
begin
 select * into strict e from public.equipment_fulfillment_events where id=p_event;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)>500 then raise exception 'S5_RECEIPT_LINES_REQUIRED'; end if;
 for j in select value from jsonb_array_elements(p_lines) loop
  select sl.* into s from public.equipment_issue_slices sl join public.equipment_fulfillment_events ev on ev.id=sl.event_id where sl.id=(j->>'issue_slice_id')::uuid and ev.request_id=e.request_id;
  if not found or not s.return_required then raise exception 'S5_RETURNABLE_ISSUE_REQUIRED'; end if;
  loc:=(j->>'location_id')::uuid; cond:=j->>'condition'; key:=s.id::text||':'||coalesce(cond,'');
  if key=any(seen) then raise exception 'S5_DUPLICATE_RECEIPT_TARGET'; end if;
  seen:=array_append(seen,key);
  if cond is null or cond not in ('good','damaged') or not exists(select 1 from public.inventory_storage_locations where id=loc) then raise exception 'S5_RECEIPT_LOCATION_CONDITION_REQUIRED'; end if;
  q:=private.s4_quantity(j->>'quantity');
  if q<>(select round(q,u.allowed_scale) from public.inventory_catalog_items i join public.inventory_uoms u on u.code=i.base_uom_code where i.id=s.inventory_item_id) then raise exception 'S5_INVALID_QUANTITY'; end if;
  if p_cumulative then
   select coalesce(sum(quantity),0) into already from public.equipment_fulfillment_effects where issue_slice_id=s.id and kind='receipt' and condition=cond;
   q:=q-already;
   if q<0 then raise exception 'S5_CUMULATIVE_DECREASE_REQUIRES_CORRECTION'; end if;
  end if;
  if q=0 then continue; end if;
  select * into o from private.s5_obligation(s.id);
  if q>o.issued-o.returned or (s.asset_id is not null and q<>1) then raise exception 'S5_RETURN_EXCEEDS_ISSUE'; end if;
  -- Offset only the part of the physical intake previously resolved away.
  remaining:=greatest(0,q-o.due);
  for f in select ef.id,ef.quantity+coalesce((select sum(off.quantity) from public.equipment_fulfillment_effects off where off.offsets_effect_id=ef.id and off.kind='resolution'),0) available
    from public.equipment_fulfillment_effects ef where ef.issue_slice_id=s.id and ef.kind='resolution' and ef.quantity>0 order by ef.id loop
   exit when remaining=0;
   offset_q:=least(remaining,f.available);
   if offset_q<=0 then continue; end if;
   insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,classification,offsets_effect_id) values(e.id,s.id,'resolution',-offset_q,'late_return',f.id);
   remaining:=remaining-offset_q;
  end loop;
  if remaining<>0 then raise exception 'S5_RESOLUTION_OFFSET_INVARIANT'; end if;
  settled:=exists(select 1 from public.equipment_fulfillment_effects where issue_slice_id=s.id and kind='consequence');
  insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,location_id,condition) values(e.id,s.id,'receipt',q,loc,cond);
  if settled then insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,location_id,condition,classification) values(e.id,s.id,'hold',q,loc,cond,'prior_administrative_consequence'); end if;
  if s.asset_id is null then
   perform private.s5_stock(e.transaction_id,s.cohort_id,s.inventory_item_id,loc,cond,q);
  else
   select * into strict asset from public.equipment_assets where id=s.asset_id for update;
   perform private.s5_asset(e.transaction_id,asset.id,loc,null,case when settled or asset.lifecycle_status in ('retired','disposed') then 'prohibited' when cond='damaged' then 'damaged' else 'ready' end,asset.lifecycle_status,e.reason);
  end if;
 end loop;
end; $$;

create or replace function private.s5_resolve(p_event uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare e public.equipment_fulfillment_events; j jsonb; s public.equipment_issue_slices; o record; q numeric; classification text;
begin
 select * into strict e from public.equipment_fulfillment_events where id=p_event;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 500 then raise exception 'S5_RESOLUTION_LINES_REQUIRED'; end if;
 for j in select value from jsonb_array_elements(p_lines) loop
  select sl.* into s from public.equipment_issue_slices sl join public.equipment_fulfillment_events ev on ev.id=sl.event_id where sl.id=(j->>'issue_slice_id')::uuid and ev.request_id=e.request_id;
  if not found or not s.return_required then raise exception 'S5_RETURNABLE_ISSUE_REQUIRED'; end if;
  select * into o from private.s5_obligation(s.id);
  q:=private.s4_quantity(j->>'quantity'); classification:=j->>'classification';
  if q<=0 or q>o.due or (s.asset_id is not null and q<>1) then raise exception 'S5_RESOLUTION_EXCEEDS_DUE'; end if;
  if classification is null or classification not in ('missing','unrecoverable','waived') then raise exception 'S5_RESOLUTION_CLASSIFICATION_REQUIRED'; end if;
  insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,classification) values(e.id,s.id,'resolution',q,classification);
 end loop;
end; $$;
revoke all on function private.s5_receive(uuid,jsonb,boolean),private.s5_resolve(uuid,jsonb) from public,anon,authenticated;

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
 if e.operation='consequence' then
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

create unique index if not exists equipment_fulfillment_one_successor on public.equipment_fulfillment_events(corrects_event_id) where corrects_event_id is not null;

-- Reverse only the target version's own facts, not its predecessor offsets.
-- All inverses and replacement facts commit together, including signature state.
create or replace function private.s5_reverse_event(p_event uuid,p_target uuid)
returns void language plpgsql security definer set search_path='' as $$
declare e public.equipment_fulfillment_events; target public.equipment_fulfillment_events; s public.equipment_issue_slices; f record; a record; current_asset public.equipment_assets; before_asset jsonb; last_asset uuid;
begin
 select * into strict e from public.equipment_fulfillment_events where id=p_event;
 select * into strict target from public.equipment_fulfillment_events where id=p_target and request_id=e.request_id;
 if target.operation in ('consequence','reconcile') or exists(select 1 from public.equipment_fulfillment_effects where event_id=target.id and kind in ('consequence','reconciliation')) then
  if not private.is_inventory_admin() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 end if;
 -- Restore exact physical asset before-state only when no later asset event
 -- would be erased. Dependent history requires its own correction first.
 for a in select distinct on (ae.asset_id) ae.asset_id,ae.before_state from public.equipment_asset_events ae where ae.transaction_id=target.transaction_id order by ae.asset_id,ae.revision loop
  select transaction_id into last_asset from public.equipment_asset_events where asset_id=a.asset_id order by revision desc limit 1;
  if last_asset<>target.transaction_id then raise exception 'S5_DEPENDENT_ASSET_HISTORY'; end if;
  before_asset:=a.before_state;
  select * into strict current_asset from public.equipment_assets where id=a.asset_id for update;
  perform private.s5_asset(e.transaction_id,a.asset_id,(before_asset->>'location_id')::uuid,(before_asset->>'custodian_id')::uuid,before_asset->>'operational_status',before_asset->>'lifecycle_status',e.reason);
 end loop;
 for s in select * from public.equipment_issue_slices where event_id=target.id loop
  if exists(select 1 from public.equipment_fulfillment_effects where issue_slice_id=s.id) then raise exception 'S5_DEPENDENT_ISSUE_HISTORY'; end if;
  insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,classification) values(e.id,s.id,'issue_correction',-s.quantity,'superseded_issue');
  if s.cohort_id is not null then perform private.s5_stock(e.transaction_id,s.cohort_id,s.inventory_item_id,s.location_id,'good',s.quantity); end if;
 end loop;
 for f in select * from public.equipment_fulfillment_effects where event_id=target.id and kind<>'issue_correction' and (offsets_effect_id is null or (kind='reconciliation' and classification<>'correction')) order by case when kind='hold' then 0 else 1 end,id loop
  select * into strict s from public.equipment_issue_slices where id=f.issue_slice_id;
  if f.kind='receipt' and s.cohort_id is not null then
   if f.condition='good' and f.quantity>private.s4_available(s.cohort_id,f.location_id) then raise exception 'S5_CORRECTION_BACKING_RESERVED_OR_HELD'; end if;
   perform private.s5_stock(e.transaction_id,s.cohort_id,s.inventory_item_id,f.location_id,f.condition,-f.quantity);
  end if;
  insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,location_id,condition,classification,offsets_effect_id)
  values(e.id,s.id,f.kind,-f.quantity,f.location_id,f.condition,'correction',case when f.kind='reconciliation' then f.offsets_effect_id else f.id end);
 end loop;
 -- A late receipt also carried resolution offsets. Undo those explicitly;
 -- offsets created by a prior correction are not target physical facts.
 for f in select * from public.equipment_fulfillment_effects where event_id=target.id and classification='late_return' loop
  insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,classification,offsets_effect_id)
  values(e.id,f.issue_slice_id,'resolution',-f.quantity,'correction',f.offsets_effect_id);
 end loop;
end; $$;
revoke all on function private.s5_reverse_event(uuid,uuid) from public,anon,authenticated;

create or replace function private.s5_snapshot(p_event uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('event',to_jsonb(e),'issues',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.equipment_issue_slices s where s.event_id=e.id),'[]'::jsonb),'effects',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.equipment_fulfillment_effects f where f.event_id=e.id),'[]'::jsonb)) from public.equipment_fulfillment_events e where e.id=p_event;
$$;
create or replace function public.equipment_fulfillment_command(p_operation text,p_request_id uuid,p_payload jsonb,p_retry_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r public.equipment_requests; p public.equipment_preparations; e public.equipment_fulfillment_events; target public.equipment_fulfillment_events;
 manager boolean; h text; old_h text; result jsonb; effective_operation text; tx uuid; event_id uuid; reason text; snapshot jsonb; required boolean; complete boolean; effective_payload jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 if actor is null or not private.is_active_user() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into r from public.equipment_requests where id=p_request_id for update;
 if not found or r.request_domain<>'nursing_skills' or not private.can_read_preparation(r.id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 manager:=private.can_access_inventory() and private.can_manage_equipment_request(r.id);
 if p_operation='sign' then
  if actor is distinct from r.registrant_id and actor is distinct from r.responsible_lecturer_id then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 elsif not manager then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_operation in ('consequence','reconcile') and not private.is_inventory_admin() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_retry_key is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'INVALID_PAYLOAD'; end if;
 h:=encode(extensions.digest(convert_to(jsonb_build_object('request',r.id,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');
 select payload_hash,result_ids into old_h,result from public.inventory_operation_replays where actor_id=actor and operation='s5:'||p_operation and retry_key=p_retry_key;
 if found then
  if h<>old_h then raise exception 'RETRY_PAYLOAD_MISMATCH' using errcode='23505'; end if;
  return result;
 end if;
 if (p_payload->>'expected_revision')::bigint is distinct from r.fulfillment_revision then raise exception 'STALE_REVISION' using errcode='23505'; end if;
 select * into p from public.equipment_preparations where request_id=r.id and state='prepared' for update;
 if p.id is null or r.status not in ('preparing','handed_over','returned','completed') then raise exception 'S5_PREPARED_REQUEST_REQUIRED'; end if;
 perform set_config('app.s5_command','true',true);
 if p_operation='sign' then
  select * into e from public.equipment_fulfillment_events where id=(p_payload->>'event_id')::uuid and request_id=r.id;
  if not found or not e.signature_required or exists(select 1 from public.equipment_fulfillment_events where corrects_event_id=e.id) then raise exception 'S5_CURRENT_SIGNABLE_EVENT_REQUIRED'; end if;
  snapshot:=private.s5_snapshot(e.id);
  h:=encode(extensions.digest(convert_to(snapshot::text,'UTF8'),'sha256'),'hex');
  if h is distinct from p_payload->>'snapshot_hash' then raise exception 'S5_SIGNATURE_SNAPSHOT_MISMATCH'; end if;
  insert into public.equipment_fulfillment_signatures(event_id,actor_id,snapshot_hash,signature) values(e.id,actor,h,p_payload->>'signature');
  event_id:=e.id;
 else
  if p_operation not in ('handover','supplement','initial_return','recover','resolve','consequence','reconcile','correct') then raise exception 'S5_UNKNOWN_OPERATION'; end if;
  reason:=nullif(btrim(p_payload->>'reason'),'');
  if reason is null or nullif(btrim(p_payload->>'business_key'),'') is null then raise exception 'S5_REASON_BUSINESS_KEY_REQUIRED'; end if;
  effective_operation:=p_operation; effective_payload:=p_payload;
  if p_operation='correct' then
   select * into target from public.equipment_fulfillment_events where id=(p_payload->>'event_id')::uuid and request_id=r.id;
   if not found or exists(select 1 from public.equipment_fulfillment_events where corrects_event_id=target.id) then raise exception 'S5_CURRENT_EVENT_REQUIRED'; end if;
   effective_operation:=case when target.operation='correct' then target.payload->>'effective_operation' else target.operation end;
   if effective_operation in ('consequence','reconcile') and not private.is_inventory_admin() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
   effective_payload:=p_payload||jsonb_build_object('effective_operation',effective_operation);
  end if;
  if effective_operation='handover' and p_operation<>'correct' then
   if r.status<>'preparing' or private.s4_health(p.id)<>'[]'::jsonb then raise exception 'S5_PREPARATION_RECONCILIATION_REQUIRED'; end if;
   update public.inventory_reservations set released_at=clock_timestamp() where preparation_id=p.id and released_at is null;
  elsif not exists(select 1 from public.equipment_fulfillment_events where request_id=r.id and operation='handover') then raise exception 'S5_HANDOVER_REQUIRED'; end if;
  if effective_operation in ('recover','resolve','consequence','reconcile') and not exists(select 1 from public.equipment_fulfillment_events where request_id=r.id and operation='initial_return') then raise exception 'S5_INITIAL_RETURN_REQUIRED'; end if;
  required:=effective_operation in ('handover','supplement','initial_return');
  insert into public.inventory_transactions(operation,business_key,actor_id,occurred_at,reason,corrects_transaction_id) values('EQUIPMENT_FULFILLMENT',r.id::text||':'||(p_payload->>'business_key'),actor,clock_timestamp(),reason,target.transaction_id) returning id into tx;
  insert into public.equipment_fulfillment_events(request_id,preparation_id,revision,operation,business_key,actor_id,reason,payload,corrects_event_id,transaction_id,signature_required)
  values(r.id,p.id,r.fulfillment_revision+1,p_operation,p_payload->>'business_key',actor,reason,effective_payload,target.id,tx,required) returning id into event_id;
  if p_operation='correct' then perform private.s5_reverse_event(event_id,target.id); end if;
  if effective_operation in ('handover','supplement') then perform private.s5_issue(event_id,p_payload->'lines');
  elsif effective_operation in ('initial_return','recover') then perform private.s5_receive(event_id,p_payload->'lines',effective_operation='recover' and p_operation<>'correct');
  elsif effective_operation='resolve' then perform private.s5_resolve(event_id,p_payload->'lines');
  else perform private.s5_admin_effect(event_id,p_payload); end if;
 end if;
 if exists(select 1 from public.equipment_issue_slices s join public.equipment_fulfillment_events ev on ev.id=s.event_id cross join lateral private.s5_obligation(s.id) o where ev.request_id=r.id and (o.issued<0 or o.returned<0 or o.resolved<0 or o.due<0 or o.held<0 or o.returned+o.resolved>o.issued or o.held>o.returned)) then raise exception 'S5_OBLIGATION_INVARIANT'; end if;
 complete:=exists(select 1 from public.equipment_fulfillment_events where request_id=r.id and operation='initial_return')
  and not exists(select 1 from public.equipment_fulfillment_events ev where ev.request_id=r.id and ev.signature_required and not exists(select 1 from public.equipment_fulfillment_events newer where newer.corrects_event_id=ev.id) and not exists(select 1 from public.equipment_fulfillment_signatures sig where sig.event_id=ev.id))
  and not exists(select 1 from public.equipment_issue_slices s join public.equipment_fulfillment_events ev on ev.id=s.event_id cross join lateral private.s5_obligation(s.id) o where ev.request_id=r.id and o.due>0);
 perform set_config('app.equipment_confirmation_rpc','true',true);
 update public.equipment_requests set fulfillment_revision=fulfillment_revision+1,status=case when complete then 'completed' when exists(select 1 from public.equipment_fulfillment_events where request_id=r.id and operation='initial_return') then 'returned' else 'handed_over' end where id=r.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,new_data) values(actor,'equipment.fulfillment.'||p_operation,'equipment_request',r.id,jsonb_build_object('event_id',event_id,'revision',r.fulfillment_revision+1));
 perform private.enqueue_equipment_request_outbox_event(r.id,'updated',p_retry_key,actor);
 result:=jsonb_build_object('event_id',event_id,'revision',r.fulfillment_revision+1,'completed',complete);
 h:=encode(extensions.digest(convert_to(jsonb_build_object('request',r.id,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');
 insert into public.inventory_operation_replays(actor_id,operation,retry_key,payload_hash,result_ids) values(actor,'s5:'||p_operation,p_retry_key,h,result);
 perform set_config('app.s5_command','',true);
 return result;
end; $$;
revoke all on function private.s5_snapshot(uuid),public.equipment_fulfillment_command(text,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.equipment_fulfillment_command(text,uuid,jsonb,uuid) to authenticated;

-- These guards also cover pre-existing S1/S2/S3 administrative writers.
create or replace function private.s5_pool_hold(p_cohort uuid,p_location uuid)
returns numeric language sql stable security definer set search_path='' as $$
 select greatest(0,coalesce(sum(f.quantity),0)) from public.equipment_fulfillment_effects f join public.equipment_issue_slices s on s.id=f.issue_slice_id where s.cohort_id=p_cohort and f.location_id=p_location and f.kind in ('hold','reconciliation');
$$;
create or replace function private.s4_pool_backing(p_cohort uuid,p_location uuid)
returns numeric language sql stable security definer set search_path='' as $$
 select greatest(0,coalesce((select b.quantity from public.inventory_stock_balances b
 join public.inventory_stock_origins o on o.id=b.cohort_id join public.inventory_receipt_cohorts c on c.origin_id=o.id join public.inventory_stock_facts f on f.id=c.current_fact_id join public.inventory_catalog_items i on i.id=o.catalog_item_id join public.inventory_storage_locations l on l.id=b.location_id
 where b.cohort_id=p_cohort and b.location_id=p_location and b.condition='good' and i.active and l.active
 and not exists(select 1 from public.inventory_stock_holds h where h.origin_id=o.id and h.status='active')
 and (not i.expiry_required or (f.expiry_precision in ('day','month') and f.expiry_date is not null))
 and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)),0)-private.s5_pool_hold(p_cohort,p_location));
$$;
create or replace function private.s4_asset_eligible(p_asset uuid,p_location uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.equipment_assets a join public.inventory_catalog_items i on i.id=a.catalog_item_id join public.inventory_storage_locations l on l.id=a.location_id
 where a.id=p_asset and a.location_id=p_location and i.active and l.active and a.lifecycle_status='in_service' and a.operational_status='ready'
 and (not i.expiry_required or (a.expiry_precision in ('day','month') and a.expiry_date is not null))
 and (a.expiry_date is null or a.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)
 and not exists(select 1 from public.equipment_issue_slices s cross join lateral private.s5_obligation(s.id) o where s.asset_id=a.id and (o.issued>o.returned or o.held>0)));
$$;
create or replace function private.s5_guard_asset_custody()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('app.s5_command',true),'')<>'true'
 and row(new.location_id,new.custodian_id,new.operational_status,new.lifecycle_status) is distinct from row(old.location_id,old.custodian_id,old.operational_status,old.lifecycle_status)
 and exists(select 1 from public.equipment_issue_slices s cross join lateral private.s5_obligation(s.id) o where s.asset_id=old.id and (o.issued>o.returned or o.held>0)) then raise exception 'S5_USE_FULFILLMENT_CUSTODY_RECONCILIATION'; end if;
 return new;
end; $$;
create trigger equipment_assets_s5_custody before update on public.equipment_assets for each row execute function private.s5_guard_asset_custody();
create or replace function private.s5_guard_held_stock()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.quantity<old.quantity and coalesce(current_setting('app.s5_command',true),'')<>'true' and private.s5_pool_hold(old.cohort_id,old.location_id)>0 then raise exception 'S5_RECONCILIATION_HOLD'; end if;
 return new;
end; $$;
create trigger inventory_stock_s5_hold before update on public.inventory_stock_balances for each row execute function private.s5_guard_held_stock();
create or replace function private.s5_guard_request_projection()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('app.s5_command',true),'')<>'true' and exists(select 1 from public.equipment_preparations where request_id=old.id)
 and (new.fulfillment_revision is distinct from old.fulfillment_revision
 or row(new.handover_staff_confirmed_by,new.handover_staff_confirmed_at,new.handover_signature_path,new.handover_recipient_signed_at,new.handover_effective_at,new.return_staff_confirmed_by,new.return_staff_confirmed_at,new.return_signature_path,new.return_recipient_signed_at,new.return_effective_at)
 is distinct from row(old.handover_staff_confirmed_by,old.handover_staff_confirmed_at,old.handover_signature_path,old.handover_recipient_signed_at,old.handover_effective_at,old.return_staff_confirmed_by,old.return_staff_confirmed_at,old.return_signature_path,old.return_recipient_signed_at,old.return_effective_at)) then raise exception 'S5_USE_EVENT_BOUND_FULFILLMENT'; end if;
 return new;
end; $$;
create trigger equipment_requests_s5_projection before update on public.equipment_requests for each row execute function private.s5_guard_request_projection();
revoke all on function private.s5_pool_hold(uuid,uuid),private.s5_guard_asset_custody(),private.s5_guard_held_stock(),private.s5_guard_request_projection() from public,anon,authenticated;

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

-- Preserve current read scope while hiding removed rows from legacy active editors.
drop policy if exists equipment_items_manage on public.equipment_request_items;
drop policy if exists equipment_items_select on public.equipment_request_items;
create policy equipment_items_select on public.equipment_request_items for select to authenticated using(removed_at is null and private.can_read_preparation(request_id));
revoke insert,update,delete on public.equipment_request_items from authenticated;
revoke insert,update,delete on public.equipment_requests from authenticated;

create or replace function private.s4_guard_request_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.equipment_preparations;
begin
 if tg_op='DELETE' then
  if exists(select 1 from public.equipment_preparations where request_id=old.id) then raise exception 'S4_REQUEST_HISTORY_IMMUTABLE' using errcode='42501'; end if;
  return old;
 end if;
 if row(new.class_schedule_id,new.receive_at,new.return_at,new.responsible_lecturer_id,new.note) is distinct from row(old.class_schedule_id,old.receive_at,old.return_at,old.responsible_lecturer_id,old.note) then
  new.preparation_revision:=old.preparation_revision+1;
 end if;
 if old.request_domain<>'nursing_skills' then return new; end if;
 select * into p from public.equipment_preparations where request_id=old.id and state in ('draft','prepared','reversing');
 if coalesce(current_setting('app.s5_command',true),'')='true' then
  if p.state is distinct from 'prepared' or not exists(select 1 from public.equipment_fulfillment_events where request_id=old.id) then raise exception 'S5_PHYSICAL_EVENT_REQUIRED'; end if;
  return new;
 end if;
 if new.status is distinct from old.status then
  if new.status='preparing' and (coalesce(current_setting('app.s4_command',true),'')<>'true' or not exists(select 1 from public.equipment_preparations where request_id=old.id and state='prepared')) then raise exception 'S4_CONFIRM_PREPARATION_REQUIRED'; end if;
  if new.status in ('handed_over','returned','completed') and exists(select 1 from public.equipment_preparations where request_id=old.id) then raise exception 'S5_NOT_AUTHORIZED'; end if;
  if new.status in ('new','cancelled') and p.id is not null then
   if p.state in ('prepared','reversing') or exists(select 1 from public.equipment_preparation_transfers t where t.preparation_id=p.id and t.compensates_id is null and t.quantity>coalesce((select sum(c.quantity) from public.equipment_preparation_transfers c where c.compensates_id=t.id),0)) then raise exception 'S4_STRICT_REVERSAL_REQUIRED'; end if;
   if new.status='cancelled' then update public.equipment_preparations set state='cancelled',lock_holder=null,lock_token=null,lock_expires_at=null where id=p.id; end if;
  end if;
 end if;
 return new;
end; $$;
drop trigger if exists equipment_requests_s4_lifecycle on public.equipment_requests;
create trigger equipment_requests_s4_lifecycle before update or delete on public.equipment_requests for each row execute function private.s4_guard_request_lifecycle();
revoke all on function private.s4_guard_request_lifecycle() from public,anon,authenticated;
create or replace function private.s4_guard_class_schedule_source()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.course_code_snapshot,new.course_name_snapshot,new.room_id,new.schedule_date,new.start_time,new.end_time,new.semester)
    is distinct from (old.course_code_snapshot,old.course_name_snapshot,old.room_id,old.schedule_date,old.start_time,old.end_time,old.semester)
    and (select private.class_schedule_has_equipment_request(old.id)) then
  raise exception 'CLASS_EQUIPMENT_REQUEST_EXISTS' using errcode='42501';
 end if;
 return new;
end; $$;
drop trigger if exists class_schedules_s4_equipment_lock on public.class_schedules;
create trigger class_schedules_s4_equipment_lock before update on public.class_schedules for each row execute function private.s4_guard_class_schedule_source();
revoke all on function private.s4_guard_class_schedule_source() from public,anon,authenticated;

create or replace function public.remove_equipment_request_item(target_item_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; ln public.equipment_request_items;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 if not private.is_active_user() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into ln from public.equipment_request_items where id=target_item_id and removed_at is null;
 select * into r from public.equipment_requests where id=ln.request_id for update;
 if not found or not(r.registrant_id=auth.uid() or private.can_manage_equipment_request(r.id)) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if r.status<>'new' and r.request_domain='nursing_skills' then raise exception 'S4_USE_QUANTITY_ADJUSTMENT'; end if;
 if r.status not in ('new','preparing') then raise exception 'EQUIPMENT_REQUEST_NOT_EDITABLE'; end if;
 update public.equipment_request_items set removed_at=clock_timestamp() where id=ln.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'equipment_request.item_removed','equipment_request',r.id,jsonb_build_object('item_id',ln.id));
 return true;
end; $$;
revoke all on function public.remove_equipment_request_item(uuid) from public,anon;
grant execute on function public.remove_equipment_request_item(uuid) to authenticated;

create or replace function public.add_equipment_request_item(target_request_id uuid,target_skill_name text,target_catalog_item_id uuid,target_quantity integer,target_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; item_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 if not private.is_active_user() or not private.can_manage_equipment_request(target_request_id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into r from public.equipment_requests where id=target_request_id for update;
 if r.status<>'new' or r.request_domain<>'nursing_skills' then raise exception 'S4_USE_QUANTITY_ADJUSTMENT'; end if;
 if target_quantity is null or target_quantity not between 1 and 9999 or nullif(btrim(target_skill_name),'') is null then raise exception 'INVALID_QUANTITY'; end if;
 if not exists(select 1 from public.equipment_catalog where id=target_catalog_item_id and is_active) then raise exception 'CATALOG_ITEM_INACTIVE_OR_MISSING'; end if;
 if not exists(select 1 from public.equipment_request_items where request_id=r.id and skill_name=btrim(target_skill_name) and removed_at is null) then raise exception 'SKILL_NOT_FOUND_IN_REQUEST'; end if;
 perform set_config('app.s4_registration','',true);
 insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,quantity,note) values(r.id,btrim(target_skill_name),target_catalog_item_id,target_quantity,nullif(btrim(target_note),'')) returning id into item_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'equipment_request.item_added','equipment_request',r.id,jsonb_build_object('item_id',item_id,'quantity',target_quantity));
 return item_id;
end; $$;
revoke all on function public.add_equipment_request_item(uuid,text,uuid,integer,text) from public,anon;
grant execute on function public.add_equipment_request_item(uuid,text,uuid,integer,text) to authenticated;

create or replace function private.guard_equipment_request_item_commercial_name()
returns trigger language plpgsql security definer set search_path='' as $$
declare domain public.equipment_request_domain; commercial text;
begin
 if new.removed_at is not null then return new; end if;
 select request_domain into domain from public.equipment_requests where id=new.request_id for update;
 if domain='nursing_skills' then select lower(btrim(commercial_name)) into commercial from public.equipment_catalog where id=new.catalog_item_id;
 else select lower(btrim(commercial_name)) into commercial from public.basic_medical_equipment_catalog where id=new.basic_medical_catalog_item_id; end if;
 if commercial is null or commercial='' then return new; end if;
 if exists(select 1 from public.equipment_request_items e left join public.equipment_catalog c on c.id=e.catalog_item_id left join public.basic_medical_equipment_catalog b on b.id=e.basic_medical_catalog_item_id where e.request_id=new.request_id and e.removed_at is null and e.id<>new.id and lower(btrim(e.skill_name))=lower(btrim(new.skill_name)) and lower(btrim(case when domain='nursing_skills' then c.commercial_name else b.commercial_name end))=commercial) then raise exception 'EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY' using errcode='22023'; end if;
 return new;
end; $$;
revoke all on function private.guard_equipment_request_item_commercial_name() from public,anon,authenticated;
