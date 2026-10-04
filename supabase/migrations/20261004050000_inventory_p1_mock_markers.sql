-- INV-062: approved synthetic-only P1 marker/gate cutover.
-- Exact declarative source concatenation; full shadow diff blocked by pre-existing 01_app.sql.

-- SOURCE: supabase/schemas/55_inventory_pilot_scope.sql
-- INV-062. Mock-only; no operational-stock authorization is represented here.
create table if not exists public.inventory_pilot_scopes (
 id uuid primary key,
 project_ref text not null check(project_ref='kwpyukofofoaqhmxndlc'),
 scope_version bigint not null check(scope_version>0),
 manifest_id uuid not null unique,
 manifest jsonb not null check(jsonb_typeof(manifest)='object' and (manifest->'synthetic') is not distinct from 'true'::jsonb and (manifest->>'dataset_kind') is not distinct from 'mock'),
 manifest_hash text not null,
 synthetic boolean not null default true check(synthetic),
 phase text not null default 'OPENING_READY' check(phase in ('OPENING_READY','ACTIVE','PAUSED')),
 admin_id uuid not null references public.profiles(id) on delete restrict,
 staff_ids uuid[] not null check(cardinality(staff_ids)=2),
 location_id uuid not null unique references public.inventory_storage_locations(id) on delete restrict,
 opening_reference text not null unique check(btrim(opening_reference)<>''),
 count_cutoff timestamptz not null,
 opening_confirmed boolean not null default false,
 opening_batch_id uuid references public.inventory_opening_batches(id) on delete restrict,
 reconciliation jsonb,
 registered_by uuid not null references public.profiles(id) on delete restrict,
 registered_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id) on delete restrict,
 updated_at timestamptz not null default clock_timestamp(),
 evidence_reference text not null check(btrim(evidence_reference)<>'')
);
create table if not exists public.inventory_pilot_scope_items (
 scope_id uuid not null references public.inventory_pilot_scopes(id) on delete restrict,
 catalog_item_id uuid not null unique references public.inventory_catalog_items(id) on delete restrict,
 primary key(scope_id,catalog_item_id)
);
create table if not exists public.inventory_pilot_writers (
 scope_id uuid not null references public.inventory_pilot_scopes(id) on delete restrict,
 writer_id text not null check(writer_id in ('inventory_command','equipment_asset_command','equipment_preparation_command','equipment_preparation_transfer','equipment_fulfillment_command','legacy','privileged_import','manual_offline')),
 allowed boolean not null,
 evidence_reference text,
 recorded_by uuid references public.profiles(id) on delete restrict,
 recorded_at timestamptz,
 primary key(scope_id,writer_id),
 check(not allowed or writer_id not in ('legacy','privileged_import','manual_offline'))
);
create table if not exists public.inventory_pilot_asset_bindings (
 scope_id uuid not null references public.inventory_pilot_scopes(id) on delete restrict,
 row_key text not null check(btrim(row_key)<>''),
 catalog_item_id uuid not null references public.inventory_catalog_items(id) on delete restrict,
 location_id uuid not null references public.inventory_storage_locations(id) on delete restrict,
 intake_reference text not null check(btrim(intake_reference)<>''),
 manufacturer text not null check(btrim(manufacturer)<>''),
 model text not null check(btrim(model)<>''),
 manufacturer_serial text not null check(btrim(manufacturer_serial)<>''),
 asset_id uuid unique references public.equipment_assets(id) on delete restrict,
 asset_code text,
 bound_by uuid references public.profiles(id) on delete restrict,
 bound_at timestamptz,
 opening_event_id uuid references public.equipment_asset_events(id) on delete restrict,
 primary key(scope_id,row_key),
 unique(intake_reference,row_key),
 check((asset_id is null and asset_code is null and bound_by is null and bound_at is null and opening_event_id is null) or (asset_id is not null and asset_code is not null and bound_by is not null and bound_at is not null and opening_event_id is not null))
);
create unique index if not exists inventory_pilot_expected_serial on public.inventory_pilot_asset_bindings(lower(btrim(manufacturer)),lower(btrim(model)),lower(btrim(manufacturer_serial)));
create table if not exists public.inventory_pilot_events (
 id uuid primary key default gen_random_uuid(),
 scope_id uuid not null references public.inventory_pilot_scopes(id) on delete restrict,
 scope_version bigint not null,
 manifest_id uuid not null,
 operation text not null,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 occurred_at timestamptz not null default clock_timestamp(),
 phase text not null check(phase in ('OPENING_READY','ACTIVE','PAUSED')),
 reason text not null check(btrim(reason)<>''),
 evidence_reference text not null check(btrim(evidence_reference)<>''),
 related_event_id uuid references public.inventory_pilot_events(id) on delete restrict,
 details jsonb not null default '{}'
);
create index if not exists inventory_pilot_events_scope on public.inventory_pilot_events(scope_id,occurred_at,id);
create unique index if not exists inventory_pilot_dual_write_reference on public.inventory_pilot_events(scope_id,evidence_reference) where operation='report_dual_write';
create unique index if not exists inventory_pilot_resolved_once on public.inventory_pilot_events(related_event_id) where operation='resolve_discrepancy';
-- Only trusted command wrappers can mint this capability; custom GUCs cannot.
create table if not exists private.inventory_pilot_writer_context (
 transaction_id bigint primary key,
 backend_pid integer not null,
 actor_id uuid,
 writer_id text not null,
 operation text not null,
 request_id uuid,
 pilot jsonb,
 payload jsonb not null,
 bound_scope_id uuid,
 outside_touched boolean not null default false,
 opening_checked boolean not null default false
);
revoke all on private.inventory_pilot_writer_context from public,anon,authenticated,service_role;
do $$ declare t text; begin
 foreach t in array array['inventory_pilot_scopes','inventory_pilot_scope_items','inventory_pilot_writers','inventory_pilot_asset_bindings','inventory_pilot_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;


-- SOURCE: supabase/schemas/56_inventory_pilot_context.sql
create or replace function private.p1_actor(p_scope public.inventory_pilot_scopes,p_admin boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.can_access_inventory() or auth.uid() is null then raise exception 'P1_ACTOR_DENIED' using errcode='42501'; end if;
 if not exists(select 1 from auth.users u where u.id=auth.uid() and u.raw_app_meta_data->'synthetic'='true'::jsonb and (u.raw_app_meta_data->>'mock_scope_id')::uuid=p_scope.id and nullif(u.encrypted_password,'') is null) then raise exception 'P1_SYNTHETIC_ACTOR_MISMATCH' using errcode='42501'; end if;
 if auth.uid()=p_scope.admin_id and private.is_inventory_admin() then return; end if;
 if not p_admin and not private.is_inventory_admin() and auth.uid()=any(p_scope.staff_ids) and private.has_room_type('40000000-0000-0000-0000-000000000001'::uuid) and exists(select 1 from public.user_roles where user_id=auth.uid() and role='staff') then return; end if;
 raise exception 'P1_ACTOR_DENIED' using errcode='42501';
end; $$;
create or replace function private.p1_identity(p_scope public.inventory_pilot_scopes,p_pilot jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_pilot is null or jsonb_typeof(p_pilot)<>'object' then raise exception 'P1_CONTEXT_REQUIRED' using errcode='22023'; end if;
 if p_pilot->>'project_ref' is distinct from p_scope.project_ref then raise exception 'P1_PROJECT_MISMATCH' using errcode='42501'; end if;
 if (p_pilot->>'scope_id')::uuid is distinct from p_scope.id or (p_pilot->>'manifest_id')::uuid is distinct from p_scope.manifest_id then raise exception 'P1_SCOPE_MISMATCH' using errcode='42501'; end if;
 if (p_pilot->>'scope_version')::bigint is distinct from p_scope.scope_version then raise exception 'P1_VERSION_MISMATCH' using errcode='23505'; end if;
end; $$;
create or replace function private.p1_enter(p_writer text,p_operation text,p_payload jsonb,p_request uuid default null)
returns private.inventory_pilot_writer_context language plpgsql security definer set search_path='' as $$
declare previous private.inventory_pilot_writer_context; s public.inventory_pilot_scopes; meta jsonb;
begin
 if p_operation is null or btrim(p_operation) = '' then
  raise exception 'INVALID_OPERATION: Operation is required' using errcode = '22023';
 end if;
 select * into previous from private.inventory_pilot_writer_context where transaction_id=txid_current() and backend_pid=pg_backend_pid();
 meta:=coalesce(p_payload->'pilot',previous.pilot);
 if meta is not null then
  select * into s from public.inventory_pilot_scopes where id=(meta->>'scope_id')::uuid;
  if not found then raise exception 'P1_SCOPE_UNKNOWN' using errcode='42501'; end if;
  perform private.p1_identity(s,meta); perform private.p1_actor(s);
  if previous.bound_scope_id is not null and previous.bound_scope_id<>s.id then raise exception 'P1_MIXED_SCOPE' using errcode='42501'; end if;
 end if;
 insert into private.inventory_pilot_writer_context(transaction_id,backend_pid,actor_id,writer_id,operation,request_id,pilot,payload,bound_scope_id,outside_touched)
 values(txid_current(),pg_backend_pid(),auth.uid(),p_writer,p_operation,coalesce(p_request,previous.request_id),meta,case when p_operation='confirm_opening_balance' then coalesce(p_payload-'pilot','{}'::jsonb) else '{}'::jsonb end,previous.bound_scope_id,coalesce(previous.outside_touched,false))
 on conflict(transaction_id) do update set actor_id=excluded.actor_id,writer_id=excluded.writer_id,operation=excluded.operation,request_id=excluded.request_id,pilot=excluded.pilot,payload=excluded.payload,opening_checked=false;
 return previous;
end; $$;
create or replace function private.p1_leave(p_previous private.inventory_pilot_writer_context)
returns void language plpgsql security definer set search_path='' as $$
declare current_context private.inventory_pilot_writer_context;
begin
 if p_previous.transaction_id is null then delete from private.inventory_pilot_writer_context where transaction_id=txid_current(); return; end if;
 select * into current_context from private.inventory_pilot_writer_context where transaction_id=txid_current();
 update private.inventory_pilot_writer_context set actor_id=p_previous.actor_id,writer_id=p_previous.writer_id,operation=p_previous.operation,request_id=p_previous.request_id,
 pilot=coalesce(p_previous.pilot,current_context.pilot),payload=p_previous.payload,bound_scope_id=coalesce(current_context.bound_scope_id,p_previous.bound_scope_id),outside_touched=current_context.outside_touched or p_previous.outside_touched,opening_checked=p_previous.opening_checked
 where transaction_id=txid_current();
end; $$;
create or replace function private.p1_control_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare c private.inventory_pilot_writer_context;
begin
 select * into c from private.inventory_pilot_writer_context where transaction_id=txid_current() and backend_pid=pg_backend_pid();
 if c.writer_id is distinct from 'inventory_pilot_command' or c.actor_id is distinct from auth.uid() then
  -- Atomic binding after an authorized opening event is the only non-control update.
  if tg_table_name<>'inventory_pilot_asset_bindings' or tg_op<>'UPDATE' or c.writer_id is distinct from 'equipment_asset_command' or c.operation is distinct from 'open_asset' then
   raise exception 'P1_CONTROL_RPC_REQUIRED' using errcode='42501';
  end if;
 end if;
 if tg_op='DELETE' then raise exception 'P1_HISTORY_IMMUTABLE' using errcode='42501'; end if;
 if tg_table_name='inventory_pilot_scopes' then
  if c.bound_scope_id is distinct from new.id then raise exception 'P1_CONTROL_SCOPE_MISMATCH' using errcode='42501'; end if;
 elsif c.bound_scope_id is distinct from new.scope_id then raise exception 'P1_CONTROL_SCOPE_MISMATCH' using errcode='42501';
 end if;
 if tg_op='UPDATE' then
  if tg_table_name='inventory_pilot_scopes' then
   if row(new.id,new.project_ref,new.scope_version,new.manifest_id,new.manifest,new.manifest_hash,new.synthetic,new.admin_id,new.staff_ids,new.location_id,new.opening_reference,new.count_cutoff,new.registered_by,new.registered_at)
    is distinct from row(old.id,old.project_ref,old.scope_version,old.manifest_id,old.manifest,old.manifest_hash,old.synthetic,old.admin_id,old.staff_ids,old.location_id,old.opening_reference,old.count_cutoff,old.registered_by,old.registered_at) then raise exception 'P1_FROZEN_MANIFEST' using errcode='42501'; end if;
  elsif tg_table_name in ('inventory_pilot_events','inventory_pilot_scope_items') then
   raise exception 'P1_HISTORY_IMMUTABLE' using errcode='42501';
  elsif tg_table_name='inventory_pilot_asset_bindings' then
   if row(new.scope_id,new.row_key,new.catalog_item_id,new.location_id,new.intake_reference,new.manufacturer,new.model,new.manufacturer_serial) is distinct from row(old.scope_id,old.row_key,old.catalog_item_id,old.location_id,old.intake_reference,old.manufacturer,old.model,old.manufacturer_serial)
    or (old.asset_id is not null and row(new.asset_id,new.asset_code,new.bound_by,new.bound_at,new.opening_event_id) is distinct from row(old.asset_id,old.asset_code,old.bound_by,old.bound_at,old.opening_event_id)) then raise exception 'P1_BINDING_IMMUTABLE' using errcode='42501'; end if;
  end if;
 end if;
 return new;
end; $$;
create or replace function private.p1_event(p_scope uuid,p_operation text,p_reason text,p_evidence text,p_details jsonb default '{}',p_related uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare event_id uuid;
begin
 insert into public.inventory_pilot_events(scope_id,scope_version,manifest_id,operation,actor_id,phase,reason,evidence_reference,details,related_event_id)
 select id,scope_version,manifest_id,p_operation,auth.uid(),phase,p_reason,p_evidence,p_details,p_related from public.inventory_pilot_scopes where id=p_scope returning id into event_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'inventory.pilot_'||p_operation,'inventory_pilot_scope',p_scope,jsonb_build_object('event_id',event_id,'reason',p_reason,'evidence_reference',p_evidence));
 return event_id;
end; $$;
revoke all on function private.p1_actor(public.inventory_pilot_scopes,boolean),private.p1_identity(public.inventory_pilot_scopes,jsonb),private.p1_enter(text,text,jsonb,uuid),private.p1_leave(private.inventory_pilot_writer_context),private.p1_control_guard(),private.p1_event(uuid,text,text,text,jsonb,uuid) from public,anon,authenticated,service_role;


-- SOURCE: supabase/schemas/57_inventory_pilot_gate.sql
create or replace function private.p1_gate(p_item uuid,p_location uuid default null,p_asset uuid default null,p_replay boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare s public.inventory_pilot_scopes; c private.inventory_pilot_writer_context; a public.equipment_assets; b public.inventory_pilot_asset_bindings; r public.equipment_requests;
begin
 select * into c from private.inventory_pilot_writer_context where transaction_id=txid_current() and backend_pid=pg_backend_pid();
 if p_asset is not null then select * into a from public.equipment_assets where id=p_asset; end if;
 select m.* into s from public.inventory_pilot_scopes m
  where m.location_id=p_location
     or exists(select 1 from public.inventory_pilot_scope_items i where i.scope_id=m.id and i.catalog_item_id=p_item)
     or (p_asset is not null and (m.location_id=a.location_id
       or exists(select 1 from public.inventory_pilot_scope_items i where i.catalog_item_id=a.catalog_item_id and i.scope_id=m.id)
       or exists(select 1 from public.inventory_pilot_asset_bindings b0 where b0.scope_id=m.id and b0.asset_id=p_asset)))
  order by m.id limit 1;
 if not found then
  if c.bound_scope_id is not null or c.pilot is not null then raise exception 'P1_MIXED_SCOPE' using errcode='42501'; end if;
  if c.transaction_id is not null then update private.inventory_pilot_writer_context set outside_touched=true where transaction_id=c.transaction_id; end if;
  return;
 end if;
 -- Direct DML cannot mint a capability, including service_role and forged GUCs.
 if c.transaction_id is null or c.actor_id is distinct from auth.uid() then raise exception 'P1_WRITER_CONTEXT_REQUIRED' using errcode='42501'; end if;
 if c.outside_touched or (c.bound_scope_id is not null and c.bound_scope_id<>s.id) then raise exception 'P1_MIXED_SCOPE' using errcode='42501'; end if;
 if not exists(select 1 from public.inventory_pilot_scope_items where scope_id=s.id and catalog_item_id=p_item) or (p_location is not null and p_location<>s.location_id) then raise exception 'P1_SCOPE_MISMATCH' using errcode='42501'; end if;
 if p_asset is not null and (a.id is null or a.catalog_item_id is distinct from p_item or (p_location is not null and a.location_id is distinct from p_location)) then raise exception 'P1_ASSET_DIMENSION_MISMATCH' using errcode='42501'; end if;
 perform private.p1_actor(s);
 if c.pilot is not null then perform private.p1_identity(s,c.pilot); end if;
 if not p_replay and not exists(select 1 from public.inventory_pilot_writers where scope_id=s.id and writer_id=c.writer_id and allowed) then raise exception 'P1_WRITER_DENIED' using errcode='42501'; end if;
 if c.writer_id='equipment_fulfillment_command' and c.operation='sign' then raise exception 'P1_SIGNATURE_IS_NOT_PHYSICAL_AUTHORITY' using errcode='42501'; end if;
 if c.request_id is not null then
  select * into r from public.equipment_requests where id=c.request_id;
  if r.id is null or r.request_domain<>'nursing_skills' or r.created_at<s.registered_at or not (r.registrant_id=s.admin_id or r.registrant_id=any(s.staff_ids)) or not (r.responsible_lecturer_id=s.admin_id or r.responsible_lecturer_id=any(s.staff_ids)) or not private.can_manage_equipment_request(r.id) then raise exception 'P1_WORKFLOW_DENIED' using errcode='42501'; end if;
 elsif c.writer_id in ('equipment_preparation_command','equipment_preparation_transfer','equipment_fulfillment_command') then
  raise exception 'P1_WORKFLOW_DENIED' using errcode='42501';
 end if;
 if not p_replay then
 if s.phase='PAUSED' then raise exception 'P1_PAUSED' using errcode='42501'; end if;
 if s.phase='OPENING_READY' then
  perform private.p1_actor(s,true);
  if not ((c.writer_id='inventory_command' and c.operation in ('confirm_opening_balance','correct_opening_balance')) or (c.writer_id='equipment_asset_command' and c.operation in ('open_asset','set_asset_lifecycle','correct_asset'))) then raise exception 'P1_OPENING_ONLY' using errcode='42501'; end if;
  if c.operation='confirm_opening_balance' and not c.opening_checked then
   if c.payload is distinct from s.manifest->'opening_payload' then raise exception 'P1_OPENING_MANIFEST_MISMATCH' using errcode='23505'; end if;
   update private.inventory_pilot_writer_context set opening_checked=true where transaction_id=c.transaction_id;
  end if;
 elsif c.operation in ('confirm_opening_balance','open_asset','correct_opening_balance') then
  raise exception 'P1_OPENING_CLOSED' using errcode='42501';
 end if;
 end if;
 if p_asset is not null then
  select * into b from public.inventory_pilot_asset_bindings where scope_id=s.id;
  if a.id is null or (b.asset_id is not null and b.asset_id<>a.id) or (s.phase='ACTIVE' and b.asset_id is null)
   or a.catalog_item_id<>b.catalog_item_id or a.location_id<>b.location_id or a.intake_kind<>'open' or a.intake_reference<>b.intake_reference or a.row_key<>b.row_key
   or lower(btrim(a.manufacturer)) is distinct from lower(btrim(b.manufacturer)) or lower(btrim(a.model)) is distinct from lower(btrim(b.model)) or lower(btrim(a.manufacturer_serial)) is distinct from lower(btrim(b.manufacturer_serial)) then raise exception 'P1_ASSET_IDENTITY_MISMATCH' using errcode='42501'; end if;
 end if;
 update private.inventory_pilot_writer_context set bound_scope_id=s.id,pilot=jsonb_build_object('scope_id',s.id,'scope_version',s.scope_version,'manifest_id',s.manifest_id,'project_ref',s.project_ref) where transaction_id=c.transaction_id;
end; $$;
create or replace function private.p1_bind_asset(p_scope uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare s public.inventory_pilot_scopes; b public.inventory_pilot_asset_bindings; a public.equipment_assets; e public.equipment_asset_events;
begin
 select * into s from public.inventory_pilot_scopes where id=p_scope;
 select * into b from public.inventory_pilot_asset_bindings where scope_id=s.id for update;
 select a0.* into a from public.equipment_assets a0 where a0.catalog_item_id=b.catalog_item_id and a0.intake_kind='open' and a0.intake_reference=b.intake_reference and a0.row_key=b.row_key
  and lower(btrim(a0.manufacturer))=lower(btrim(b.manufacturer)) and lower(btrim(a0.model))=lower(btrim(b.model)) and lower(btrim(a0.manufacturer_serial))=lower(btrim(b.manufacturer_serial));
 if a.id is null then return false; end if;
 if a.location_id<>b.location_id or ((s.manifest#>>'{asset,id}') is not null and a.id<>(s.manifest#>>'{asset,id}')::uuid) or (b.asset_id is not null and b.asset_id<>a.id) then raise exception 'P1_ASSET_IDENTITY_MISMATCH' using errcode='23505'; end if;
 select e0.* into e from public.equipment_asset_events e0 join public.inventory_transactions t on t.id=e0.transaction_id
  where e0.asset_id=a.id and e0.operation='open_asset' and e0.actor_id=s.admin_id and e0.revision=1 and e0.before_state is null
  and t.operation='ASSET_OPEN' and t.actor_id=s.admin_id
  and case when pg_input_is_valid(t.business_key,'jsonb') then t.business_key::jsonb=jsonb_build_object('ref',b.intake_reference,'row',b.row_key) else false end
  and e0.after_state->>'id'=a.id::text and e0.after_state->>'asset_code'=a.asset_code
  and e0.after_state->>'intake_kind'='open' and e0.after_state->>'revision'='1'
  and ((s.manifest#>>'{asset_opening_result,event_id}') is null or e0.id=(s.manifest#>>'{asset_opening_result,event_id}')::uuid)
  and ((s.manifest#>>'{asset_opening_result,transaction_id}') is null or t.id=(s.manifest#>>'{asset_opening_result,transaction_id}')::uuid)
  and e0.after_state->>'intake_reference'=b.intake_reference and e0.after_state->>'row_key'=b.row_key and (e0.after_state->>'catalog_item_id')::uuid=b.catalog_item_id and (e0.after_state->>'location_id')::uuid=b.location_id
  and lower(btrim(e0.after_state->>'manufacturer'))=lower(btrim(b.manufacturer)) and lower(btrim(e0.after_state->>'model'))=lower(btrim(b.model)) and lower(btrim(e0.after_state->>'manufacturer_serial'))=lower(btrim(b.manufacturer_serial)) order by e0.revision limit 1;
 if e.id is null then return false; end if;
 if b.asset_id is null then
  update public.inventory_pilot_asset_bindings set asset_id=a.id,asset_code=a.asset_code,bound_by=auth.uid(),bound_at=clock_timestamp(),opening_event_id=e.id where scope_id=s.id and row_key=b.row_key;
 end if;
 return true;
end; $$;
create or replace function private.p1_asset_opened()
returns trigger language plpgsql security definer set search_path='' as $$
declare s uuid;
begin
 if new.operation='open_asset' then
  select i.scope_id into s from public.inventory_pilot_scope_items i join public.equipment_assets a on a.catalog_item_id=i.catalog_item_id where a.id=new.asset_id;
  if s is not null and not private.p1_bind_asset(s) then raise exception 'P1_ASSET_BINDING_REQUIRED' using errcode='23505'; end if;
 end if;
 return new;
end; $$;
revoke all on function private.p1_gate(uuid,uuid,uuid,boolean),private.p1_bind_asset(uuid),private.p1_asset_opened() from public,anon,authenticated,service_role;


-- SOURCE: supabase/schemas/58_inventory_pilot_reconciliation.sql
create or replace function private.p1_reconcile(p_scope uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.inventory_pilot_scopes; batch public.inventory_opening_batches; j jsonb; original_row jsonb; f record; b public.inventory_pilot_asset_bindings; a public.equipment_assets;
 opening_errors jsonb:='[]'; errors jsonb:='[]'; first_activation boolean; expected_count integer; ledger_bad boolean;
begin
 select * into strict s from public.inventory_pilot_scopes where id=p_scope;
 select * into batch from public.inventory_opening_batches where cutover_key=s.opening_reference;
 if batch.id is null or batch.synthetic is distinct from true or batch.count_cutoff is distinct from s.count_cutoff
  or batch.scope_description is distinct from btrim(s.manifest#>>'{opening_payload,scope_description}')
  or batch.provenance_note is distinct from btrim(s.manifest#>>'{opening_payload,provenance_note}')
  or ((s.manifest#>>'{opening_result,opening_batch_id}') is not null and batch.id is distinct from (s.manifest#>>'{opening_result,opening_batch_id}')::uuid)
  or ((s.manifest#>>'{opening_result,transaction_id}') is not null and batch.transaction_id is distinct from (s.manifest#>>'{opening_result,transaction_id}')::uuid)
  or not exists(select 1 from public.inventory_transactions tx where tx.id=batch.transaction_id and tx.actor_id=s.admin_id and tx.operation='OPENING' and tx.business_key=s.opening_reference and tx.occurred_at=s.count_cutoff and tx.reason is not distinct from s.manifest#>>'{opening_payload,scope_description}' and tx.corrects_transaction_id is null) then
  opening_errors:=opening_errors||jsonb_build_array('OPENING_BATCH_MISSING_OR_MISMATCHED');
 end if;
 first_activation:=not exists(select 1 from public.inventory_pilot_events where scope_id=s.id and operation='activate');
 expected_count:=jsonb_array_length(s.manifest#>'{opening_payload,lines}');
 if (select count(*) from public.inventory_stock_origins where opening_batch_id=batch.id)<>expected_count then opening_errors:=opening_errors||jsonb_build_array('OPENING_ROWS_INCOMPLETE'); end if;
 for j in select value from jsonb_array_elements(s.manifest#>'{opening_payload,lines}') loop
  select o.catalog_item_id,o.line_key,o.provenance_group,o.receipt_id,o.source_line_id,f0.* into f from public.inventory_stock_origins o join public.inventory_receipt_cohorts c on c.origin_id=o.id join public.inventory_stock_facts f0 on f0.origin_id=o.id and f0.version=0 where o.opening_batch_id=batch.id and o.line_key=j->>'line_key';
  if not found then opening_errors:=opening_errors||jsonb_build_array(jsonb_build_object('missing_row',j->>'line_key')); continue; end if;
  if f.catalog_item_id is distinct from (j->>'catalog_item_id')::uuid or f.location_id is distinct from (j->>'location_id')::uuid or f.provenance_group is distinct from j->>'provenance_group'
   or f.good_quantity is distinct from (j->>'good_quantity')::numeric or f.damaged_quantity is distinct from (j->>'damaged_quantity')::numeric or f.base_quantity is distinct from (j->>'good_quantity')::numeric+(j->>'damaged_quantity')::numeric
   or f.expiry_precision is distinct from j->>'expiry_precision' or f.expiry_input is distinct from j->>'expiry_input' or f.expiry_date is distinct from private.inventory_normalize_expiry(j->>'expiry_precision',j->>'expiry_input',true)
   or f.base_uom_code is distinct from (select base_uom_code from public.inventory_catalog_items where id=f.catalog_item_id)
   or f.receipt_id is not null or f.source_line_id is not null or f.previous_fact_id is not null
   or f.purchase_quantity is not null or f.purchase_uom_code is not null or f.conversion_factor is not null
   or f.source_snapshot->>'cutover_key' is distinct from s.opening_reference or f.source_snapshot->>'provenance_group' is distinct from btrim(j->>'provenance_group')
   or f.evidence_note is distinct from j->>'evidence_note' then
   opening_errors:=opening_errors||jsonb_build_array(jsonb_build_object('mismatched_row',j->>'line_key'));
  end if;
  if f.transaction_id is distinct from batch.transaction_id then opening_errors:=opening_errors||jsonb_build_array(jsonb_build_object('fact_tx_mismatch',j->>'line_key')); end if;
  select supplied.value into original_row from jsonb_array_elements(coalesce(s.manifest->'facts','[]'::jsonb)) supplied(value) where coalesce(supplied.value->>'row_key',supplied.value->>'line_key')=j->>'line_key';
  if ((original_row->>'origin_id') is not null and f.origin_id is distinct from (original_row->>'origin_id')::uuid)
   or ((original_row->>'cohort_id') is not null and f.origin_id is distinct from (original_row->>'cohort_id')::uuid)
   or ((original_row->>'fact_id') is not null and f.id is distinct from (original_row->>'fact_id')::uuid)
   or ((j->>'origin_id') is not null and f.origin_id is distinct from (j->>'origin_id')::uuid)
   or ((original_row->>'id') is not null and f.id is distinct from (original_row->>'id')::uuid)
   or ((j->>'cohort_id') is not null and f.origin_id is distinct from (j->>'cohort_id')::uuid)
   or ((j->>'fact_id') is not null and f.id is distinct from (j->>'fact_id')::uuid) then opening_errors:=opening_errors||jsonb_build_array(jsonb_build_object('original_row_id_mismatch',j->>'line_key')); end if;
  -- Immutable opening ledger is qualified on every reconciliation, even after corrections.
  if (j->>'good_quantity')::numeric>0 and not exists(select 1 from public.inventory_transaction_lines tl where tl.transaction_id=batch.transaction_id and tl.cohort_id=f.origin_id and tl.catalog_item_id=f.catalog_item_id and tl.location_id=f.location_id and tl.condition='good' and tl.quantity_delta=(j->>'good_quantity')::numeric) then
   opening_errors:=opening_errors||jsonb_build_array(jsonb_build_object('missing_opening_ledger_good',j->>'line_key'));
  end if;
  if (j->>'damaged_quantity')::numeric>0 and not exists(select 1 from public.inventory_transaction_lines tl where tl.transaction_id=batch.transaction_id and tl.cohort_id=f.origin_id and tl.catalog_item_id=f.catalog_item_id and tl.location_id=f.location_id and tl.condition='damaged' and tl.quantity_delta=(j->>'damaged_quantity')::numeric) then
   opening_errors:=opening_errors||jsonb_build_array(jsonb_build_object('missing_opening_ledger_damaged',j->>'line_key'));
  end if;
  -- The full join below cannot distinguish a missing ledger AND missing projection.
  if first_activation and (((j->>'good_quantity')::numeric>0 and not exists(select 1 from public.inventory_stock_balances sb where sb.cohort_id=f.origin_id and sb.location_id=f.location_id and sb.condition='good' and sb.quantity=(j->>'good_quantity')::numeric))
   or ((j->>'damaged_quantity')::numeric>0 and not exists(select 1 from public.inventory_stock_balances sb where sb.cohort_id=f.origin_id and sb.location_id=f.location_id and sb.condition='damaged' and sb.quantity=(j->>'damaged_quantity')::numeric))) then
   opening_errors:=opening_errors||jsonb_build_array(jsonb_build_object('missing_initial_stock',j->>'line_key'));
  end if;
  if first_activation and exists(select 1 from public.inventory_receipt_cohorts c join public.inventory_stock_facts latest on latest.id=c.current_fact_id where c.origin_id=f.origin_id and row(latest.location_id,latest.base_quantity,latest.good_quantity,latest.damaged_quantity,latest.expiry_precision,latest.expiry_date) is distinct from row(f.location_id,f.base_quantity,f.good_quantity,f.damaged_quantity,f.expiry_precision,f.expiry_date)) then opening_errors:=opening_errors||jsonb_build_array(jsonb_build_object('initial_fact_drift',j->>'line_key')); end if;
 end loop;
 if (select count(*) from public.inventory_transaction_lines tl where tl.transaction_id=batch.transaction_id)<>(select count(*) from jsonb_array_elements(s.manifest#>'{opening_payload,lines}') expected_line cross join (values('good_quantity'),('damaged_quantity')) quantity_field(name) where (expected_line->>quantity_field.name)::numeric>0) then opening_errors:=opening_errors||jsonb_build_array('OPENING_LEDGER_ROWS_MISMATCH'); end if;
 if (select count(*) from public.inventory_opening_scope where opening_batch_id=batch.id)<>(select count(distinct (j0->>'catalog_item_id')::uuid) from jsonb_array_elements(s.manifest#>'{opening_payload,lines}') j0)
  or exists(select 1 from public.inventory_opening_scope os where os.opening_batch_id=batch.id and not exists(select 1 from jsonb_array_elements(s.manifest#>'{opening_payload,lines}') expected_line where (expected_line->>'location_id')::uuid=os.location_id and (expected_line->>'catalog_item_id')::uuid=os.catalog_item_id)) then opening_errors:=opening_errors||jsonb_build_array('OPENING_SCOPE_MISMATCH'); end if;
 select * into b from public.inventory_pilot_asset_bindings where scope_id=s.id;
 select * into a from public.equipment_assets where id=b.asset_id;
 if b.asset_id is null or b.opening_event_id is null or a.id is null or a.asset_code is distinct from b.asset_code or a.catalog_item_id is distinct from b.catalog_item_id or a.location_id is distinct from b.location_id
  or a.intake_kind is distinct from 'open' or a.intake_reference is distinct from b.intake_reference or a.row_key is distinct from b.row_key
  or lower(btrim(a.manufacturer)) is distinct from lower(btrim(b.manufacturer)) or lower(btrim(a.model)) is distinct from lower(btrim(b.model)) or lower(btrim(a.manufacturer_serial)) is distinct from lower(btrim(b.manufacturer_serial)) then opening_errors:=opening_errors||jsonb_build_array('SERIALIZED_IDENTITY_UNBOUND_OR_MISMATCHED'); end if;
 if ((s.manifest#>>'{asset_opening_result,event_id}') is not null and b.opening_event_id is distinct from (s.manifest#>>'{asset_opening_result,event_id}')::uuid)
  or ((s.manifest#>>'{asset,id}') is not null and b.asset_id is distinct from (s.manifest#>>'{asset,id}')::uuid)
  or ((s.manifest#>>'{asset_opening_result,id}') is not null and b.asset_id is distinct from (s.manifest#>>'{asset_opening_result,id}')::uuid)
  or ((s.manifest#>>'{asset_opening_result,asset_code}') is not null and b.asset_code is distinct from s.manifest#>>'{asset_opening_result,asset_code}')
  or ((s.manifest#>>'{asset,asset_code}') is not null and b.asset_code is distinct from s.manifest#>>'{asset,asset_code}')
  or not exists(select 1 from public.equipment_asset_events opening_event join public.inventory_transactions tx on tx.id=opening_event.transaction_id where opening_event.id=b.opening_event_id and opening_event.asset_id=b.asset_id and opening_event.operation='open_asset' and opening_event.actor_id=s.admin_id and tx.actor_id=s.admin_id and tx.operation='ASSET_OPEN'
   and ((s.manifest#>>'{asset_opening_result,transaction_id}') is null or tx.id=(s.manifest#>>'{asset_opening_result,transaction_id}')::uuid)
   and row(opening_event.after_state->>'intake_reference',opening_event.after_state->>'row_key',opening_event.after_state->>'catalog_item_id',opening_event.after_state->>'location_id')=row(b.intake_reference,b.row_key,b.catalog_item_id::text,b.location_id::text)
   and tx.business_key=jsonb_build_object('ref',b.intake_reference,'row',b.row_key)::text and tx.occurred_at=opening_event.occurred_at
   and lower(btrim(opening_event.after_state->>'manufacturer'))=lower(btrim(b.manufacturer)) and lower(btrim(opening_event.after_state->>'model'))=lower(btrim(b.model)) and lower(btrim(opening_event.after_state->>'manufacturer_serial'))=lower(btrim(b.manufacturer_serial))) then
  opening_errors:=opening_errors||jsonb_build_array('SERIALIZED_EVENT_MISMATCH');
 end if;
 if (select count(*) from public.equipment_assets ea where ea.location_id=s.location_id or exists(select 1 from public.inventory_pilot_scope_items pi where pi.scope_id=s.id and pi.catalog_item_id=ea.catalog_item_id)) <> 1 then
  opening_errors:=opening_errors||jsonb_build_array('UNEXPECTED_SERIALIZED_ASSETS');
 end if;
 if exists(select 1 from public.inventory_stock_facts sf join public.inventory_stock_origins o on o.id=sf.origin_id where sf.location_id=s.location_id and not exists(select 1 from public.inventory_pilot_scope_items pi where pi.scope_id=s.id and pi.catalog_item_id=o.catalog_item_id)) then
  opening_errors:=opening_errors||jsonb_build_array('UNEXPECTED_LOCATION_STOCK');
 end if;
 if exists(select 1 from public.inventory_stock_balances sb join public.inventory_stock_origins o on o.id=sb.cohort_id join public.inventory_catalog_items i on i.id=o.catalog_item_id join public.inventory_pilot_scope_items pi on pi.catalog_item_id=i.id where pi.scope_id=s.id and i.tracking_strategy='serialized' and sb.quantity<>0) then opening_errors:=opening_errors||jsonb_build_array('SERIALIZED_QUANTITY_DOUBLE_COUNT'); end if;
 if first_activation then
  if exists(select 1 from public.inventory_stock_origins origin_row where
   (exists(select 1 from public.inventory_pilot_scope_items pi where pi.scope_id=s.id and pi.catalog_item_id=origin_row.catalog_item_id)
    or exists(select 1 from public.inventory_stock_facts fact_row where fact_row.origin_id=origin_row.id and fact_row.location_id=s.location_id)
    or exists(select 1 from public.inventory_transaction_lines ledger_row where ledger_row.cohort_id=origin_row.id and ledger_row.location_id=s.location_id)
    or exists(select 1 from public.inventory_stock_balances balance_row where balance_row.cohort_id=origin_row.id and balance_row.location_id=s.location_id))
   and (origin_row.opening_batch_id is distinct from batch.id or not exists(select 1 from jsonb_array_elements(s.manifest#>'{opening_payload,lines}') expected_line where expected_line->>'line_key'=origin_row.line_key and (expected_line->>'catalog_item_id')::uuid=origin_row.catalog_item_id))) then
   opening_errors:=opening_errors||jsonb_build_array('UNEXPECTED_INITIAL_ORIGINS');
  end if;
  if exists(select 1 from public.inventory_stock_facts fact_row join public.inventory_stock_origins origin_row on origin_row.id=fact_row.origin_id where
   (fact_row.location_id=s.location_id or exists(select 1 from public.inventory_pilot_scope_items pi where pi.scope_id=s.id and pi.catalog_item_id=origin_row.catalog_item_id))
   and (fact_row.version<>0 or origin_row.opening_batch_id is distinct from batch.id or not exists(select 1 from jsonb_array_elements(s.manifest#>'{opening_payload,lines}') expected_line where expected_line->>'line_key'=origin_row.line_key and (expected_line->>'catalog_item_id')::uuid=origin_row.catalog_item_id and (expected_line->>'location_id')::uuid=fact_row.location_id))) then
   opening_errors:=opening_errors||jsonb_build_array('UNEXPECTED_INITIAL_FACTS');
  end if;
  if a.lifecycle_status is distinct from 'in_service' or a.operational_status is distinct from coalesce(s.manifest#>>'{asset,operational_status}','ready') or a.custodian_id is distinct from (s.manifest#>>'{asset,custodian_id}')::uuid then opening_errors:=opening_errors||jsonb_build_array('SERIALIZED_OPENING_STATE_MISMATCH'); end if;
  if exists(select 1 from public.inventory_stock_balances sb join public.inventory_stock_origins o on o.id=sb.cohort_id join public.inventory_pilot_scope_items pi on pi.catalog_item_id=o.catalog_item_id join public.inventory_receipt_cohorts c on c.origin_id=o.id join public.inventory_stock_facts ff on ff.id=c.current_fact_id where pi.scope_id=s.id and (sb.location_id<>s.location_id or o.opening_batch_id is distinct from batch.id or sb.quantity<>case when sb.condition='good' then ff.good_quantity else ff.damaged_quantity end)) then opening_errors:=opening_errors||jsonb_build_array('INITIAL_STOCK_DISCREPANCY'); end if;
  if exists(select 1 from public.inventory_reservations r0 left join public.inventory_stock_origins o on o.id=r0.cohort_id left join public.equipment_assets a0 on a0.id=r0.asset_id where r0.released_at is null and (r0.location_id=s.location_id or exists(select 1 from public.inventory_pilot_scope_items pi where pi.scope_id=s.id and pi.catalog_item_id=coalesce(o.catalog_item_id,a0.catalog_item_id))))
   or exists(select 1 from public.equipment_issue_slices sl join public.inventory_pilot_scope_items pi on pi.catalog_item_id=sl.inventory_item_id cross join lateral private.s5_obligation(sl.id) ob where pi.scope_id=s.id and (ob.issued>ob.returned or ob.held>0)) then opening_errors:=opening_errors||jsonb_build_array('INITIAL_OBLIGATIONS'); end if;
 end if;
 errors:=opening_errors;
 -- Both missing balances and unexplained balance rows are checked, not just existing projections.
 with scoped_origins as (
  select o.id from public.inventory_stock_origins o
  where exists(select 1 from public.inventory_pilot_scope_items pi where pi.scope_id=s.id and pi.catalog_item_id=o.catalog_item_id)
     or exists(select 1 from public.inventory_receipt_cohorts c join public.inventory_stock_facts sf on sf.id=c.current_fact_id where c.origin_id=o.id and sf.location_id=s.location_id)
 ),
 ledger as (select l.cohort_id,l.location_id,l.condition,sum(l.quantity_delta) quantity from public.inventory_transaction_lines l join scoped_origins o on o.id=l.cohort_id group by l.cohort_id,l.location_id,l.condition),
 balances as (select sb.* from public.inventory_stock_balances sb join scoped_origins o on o.id=sb.cohort_id)
 select exists(select 1 from ledger l full join balances sb on row(sb.cohort_id,sb.location_id,sb.condition)=row(l.cohort_id,l.location_id,l.condition) where coalesce(l.quantity,0)<>coalesce(sb.quantity,0) or (coalesce(sb.quantity,0)<>0 and coalesce(l.location_id,sb.location_id)<>s.location_id)) into ledger_bad;
 if ledger_bad then errors:=errors||jsonb_build_array('LEDGER_BALANCE_DISCREPANCY'); end if;
 if exists(select 1 from public.inventory_stock_balances sb where sb.location_id=s.location_id and sb.quantity<>0 and not exists(select 1 from public.inventory_stock_origins o where o.id=sb.cohort_id and (exists(select 1 from public.inventory_pilot_scope_items pi where pi.scope_id=s.id and pi.catalog_item_id=o.catalog_item_id) or exists(select 1 from public.inventory_receipt_cohorts c join public.inventory_stock_facts sf on sf.id=c.current_fact_id where c.origin_id=o.id and sf.location_id=s.location_id)))) then
  errors:=errors||jsonb_build_array('UNEXPECTED_LOCATION_BALANCES');
 end if;
 if exists(select 1 from public.inventory_pilot_scope_items pi join public.inventory_catalog_items i on i.id=pi.catalog_item_id where pi.scope_id=s.id and not i.active) or not exists(select 1 from public.inventory_storage_locations where id=s.location_id and active) then errors:=errors||jsonb_build_array('INACTIVE_SCOPE_REFERENCE'); end if;
 if (select count(*) from public.inventory_pilot_writers where scope_id=s.id)<>8 or exists(select 1 from public.inventory_pilot_writers w where w.scope_id=s.id and (nullif(btrim(w.evidence_reference),'') is null or w.recorded_at is null or w.recorded_by<>s.admin_id or w.allowed is distinct from (w.writer_id not in ('legacy','privileged_import','manual_offline')))) then errors:=errors||jsonb_build_array('WRITER_EXCLUSION_EVIDENCE_MISSING'); end if;
 if exists(select 1 from public.inventory_pilot_events e where e.scope_id=s.id and e.operation in ('report_dual_write','report_discrepancy') and not exists(select 1 from public.inventory_pilot_events resolved where resolved.related_event_id=e.id and resolved.operation='resolve_discrepancy')) then errors:=errors||jsonb_build_array('UNRESOLVED_DISCREPANCY'); end if;
 return jsonb_build_object('ready',jsonb_array_length(errors)=0,'opening_complete',jsonb_array_length(opening_errors)=0,'discrepancies',errors,'opening_batch_id',batch.id,'asset_id',b.asset_id,'opening_rows',expected_count,'observed_at',clock_timestamp());
end; $$;
revoke all on function private.p1_reconcile(uuid) from public,anon,authenticated,service_role;


-- SOURCE: supabase/schemas/59_inventory_pilot_registration.sql
create or replace function private.p1_register(p_manifest jsonb,p_pilot jsonb,p_evidence text)
returns public.inventory_pilot_scopes language plpgsql security definer set search_path='' as $$
declare s public.inventory_pilot_scopes; m jsonb:=p_manifest; j jsonb; item public.inventory_catalog_items; loc public.inventory_storage_locations; u record; actors uuid[]; admin uuid; staff uuid[]; asset_item uuid; writer text;
begin
 if jsonb_typeof(m) is distinct from 'object' or m->'synthetic' is distinct from 'true'::jsonb or m->>'dataset_kind' is distinct from 'mock' or m->'real_activation' is distinct from 'false'::jsonb
  or m->>'target_project_ref' is distinct from 'kwpyukofofoaqhmxndlc' or coalesce(m->>'scope_code','')!~'^P1-MOCK-[A-Z0-9]+(-[A-Z0-9]+)*$'
  or m#>>'{workflow,domain}' is distinct from 'nursing_skills' or m#>>'{workflow,admission}' is distinct from 'new requests only' or m#>'{workflow,legacy_obligations}' is distinct from '[]'::jsonb then raise exception 'P1_MOCK_MANIFEST_REQUIRED' using errcode='42501'; end if;
 if jsonb_typeof(m->'users') is distinct from 'array' or jsonb_array_length(m->'users')<>3 or jsonb_typeof(m->'items') is distinct from 'array' or jsonb_array_length(m->'items')<>4
  or jsonb_typeof(m#>'{opening_payload,lines}') is distinct from 'array' or jsonb_array_length(m#>'{opening_payload,lines}')<>6 then raise exception 'P1_MANIFEST_SHAPE_MISMATCH' using errcode='42501'; end if;
 select array_agg((value->>'id')::uuid order by ordinality),max((value->>'id')) filter(where value->>'role'='admin'),array_agg((value->>'id')::uuid order by ordinality) filter(where value->>'role'='staff') into actors,admin,staff from jsonb_array_elements(m->'users') with ordinality;
 if cardinality(staff) is distinct from 2 or admin is null or (select count(distinct x) from unnest(actors) x)<>3 or auth.uid() is distinct from admin or not private.is_inventory_admin() then raise exception 'P1_ACTOR_DENIED' using errcode='42501'; end if;
 for j in select value from jsonb_array_elements(m->'users') loop
  select p.is_active,a.email,a.encrypted_password,a.raw_app_meta_data into u from public.profiles p join auth.users a on a.id=p.id where p.id=(j->>'id')::uuid;
  if not found or not u.is_active or u.email is distinct from j->>'email' or u.email not like '%@%.invalid' or nullif(u.encrypted_password,'') is not null
   or u.raw_app_meta_data->'synthetic' is distinct from 'true'::jsonb or (u.raw_app_meta_data->>'mock_scope_id')::uuid is distinct from (m->>'scope_id')::uuid
   or j->'synthetic' is distinct from 'true'::jsonb or j->'interactive_login' is distinct from 'false'::jsonb or not exists(select 1 from public.user_roles where user_id=(j->>'id')::uuid and role::text=j->>'role') then raise exception 'P1_SYNTHETIC_ACTOR_MISMATCH' using errcode='42501'; end if;
 end loop;
 select * into loc from public.inventory_storage_locations where id=(m#>>'{location,id}')::uuid;
 if loc.id is null or not loc.active or loc.code is distinct from m#>>'{location,code}' or loc.name is distinct from m#>>'{location,name}' or loc.code not like (m->>'scope_code')||'-%' or loc.name not like '%MOCK%' or m#>'{location,synthetic}' is distinct from 'true'::jsonb then raise exception 'P1_LOCATION_MISMATCH' using errcode='42501'; end if;
 if (select count(distinct j0->>'id') from jsonb_array_elements(m->'items') j0)<>4 or (select count(distinct j0->>'key') from jsonb_array_elements(m->'items') j0 where j0->>'key' in ('chemical','consumable','reusable','serialized'))<>4 then raise exception 'P1_ITEM_SCOPE_MISMATCH' using errcode='42501'; end if;
 for j in select value from jsonb_array_elements(m->'items') loop
  select * into item from public.inventory_catalog_items where id=(j->>'id')::uuid;
  if item.id is null or not item.active or row(item.code,item.name,item.material_kind,item.tracking_strategy,item.return_semantics,item.expiry_required,item.base_uom_code) is distinct from row(j->>'code',j->>'name',j->>'material_kind',j->>'tracking_strategy',j->>'return_semantics',(j->>'expiry_required')::boolean,j->>'uom')
   or item.code not like (m->>'scope_code')||'-%' or item.name not like '%MOCK%' then raise exception 'P1_ITEM_SCOPE_MISMATCH' using errcode='42501'; end if;
  if (j->>'key'='chemical' and row(item.material_kind,item.tracking_strategy,item.return_semantics,item.expiry_required) is distinct from row('chemical','quantity','nonreturnable',true))
   or (j->>'key'='consumable' and row(item.material_kind,item.tracking_strategy,item.return_semantics,item.expiry_required) is distinct from row('other','quantity','nonreturnable',false))
   or (j->>'key'='reusable' and row(item.material_kind,item.tracking_strategy,item.return_semantics,item.expiry_required) is distinct from row('other','quantity','returnable',false))
   or (j->>'key'='serialized' and row(item.material_kind,item.tracking_strategy,item.return_semantics,item.expiry_required) is distinct from row('other','serialized','returnable',false)) then raise exception 'P1_ARCHETYPE_MISMATCH' using errcode='42501'; end if;
  if j->>'key'='serialized' then asset_item:=item.id; end if;
 end loop;
 if m#>'{opening_payload,synthetic}' is distinct from 'true'::jsonb or m#>>'{opening_payload,cutover_key}' is distinct from m#>>'{opening,reference}' or m#>>'{opening_payload,count_cutoff}' is distinct from m->>'count_cutoff'
  or m#>>'{opening,reference}' not like (m->>'scope_code')||'-%' or (select count(distinct j0->>'line_key') from jsonb_array_elements(m#>'{opening_payload,lines}') j0)<>6 then raise exception 'P1_OPENING_MANIFEST_MISMATCH' using errcode='23505'; end if;
 for j in select value from jsonb_array_elements(m#>'{opening_payload,lines}') loop
  if (j->>'location_id')::uuid is distinct from loc.id or (j->>'catalog_item_id')::uuid=asset_item or not exists(select 1 from jsonb_array_elements(m->'items') i where i->>'id'=j->>'catalog_item_id')
   or (j->>'good_quantity')::numeric<0 or (j->>'damaged_quantity')::numeric<0 or coalesce((j->>'good_quantity')::numeric+(j->>'damaged_quantity')::numeric,0)<=0 then raise exception 'P1_OPENING_SCOPE_MISMATCH' using errcode='42501'; end if;
 end loop;
 if (select count(distinct j0->>'catalog_item_id') from jsonb_array_elements(m#>'{opening_payload,lines}') j0)<>3 or (m#>>'{asset,catalog_item_id}')::uuid is distinct from asset_item or (m#>>'{asset,location_id}')::uuid is distinct from loc.id
  or m#>'{asset,synthetic}' is distinct from 'true'::jsonb or nullif(btrim(m#>>'{asset,manufacturer}'),'') is null or nullif(btrim(m#>>'{asset,model}'),'') is null or nullif(btrim(m#>>'{asset,manufacturer_serial}'),'') is null or nullif(btrim(m#>>'{asset,row_key}'),'') is null then raise exception 'P1_SERIALIZED_MANIFEST_MISMATCH' using errcode='42501'; end if;
 s.id:=(m->>'scope_id')::uuid; s.project_ref:=m->>'target_project_ref'; s.scope_version:=(m->>'scope_version')::bigint; s.manifest_id:=(m->>'manifest_id')::uuid;
 s.admin_id:=admin; s.staff_ids:=staff; perform private.p1_identity(s,p_pilot);
 update private.inventory_pilot_writer_context set bound_scope_id=s.id,pilot=p_pilot where transaction_id=txid_current();
 insert into public.inventory_pilot_scopes(id,project_ref,scope_version,manifest_id,manifest,manifest_hash,admin_id,staff_ids,location_id,opening_reference,count_cutoff,registered_by,updated_by,evidence_reference)
 values(s.id,s.project_ref,s.scope_version,s.manifest_id,m,encode(extensions.digest(convert_to(m::text,'UTF8'),'sha256'),'hex'),admin,staff,loc.id,m#>>'{opening,reference}',(m->>'count_cutoff')::timestamptz,auth.uid(),auth.uid(),p_evidence) returning * into s;
 insert into public.inventory_pilot_scope_items select s.id,(value->>'id')::uuid from jsonb_array_elements(m->'items');
 foreach writer in array array['inventory_command','equipment_asset_command','equipment_preparation_command','equipment_preparation_transfer','equipment_fulfillment_command','legacy','privileged_import','manual_offline'] loop
  insert into public.inventory_pilot_writers(scope_id,writer_id,allowed) values(s.id,writer,writer not in ('legacy','privileged_import','manual_offline'));
 end loop;
 insert into public.inventory_pilot_asset_bindings(scope_id,row_key,catalog_item_id,location_id,intake_reference,manufacturer,model,manufacturer_serial)
 values(s.id,m#>>'{asset,row_key}',asset_item,loc.id,s.opening_reference,m#>>'{asset,manufacturer}',m#>>'{asset,model}',m#>>'{asset,manufacturer_serial}');
 return s;
end; $$;
revoke all on function private.p1_register(jsonb,jsonb,text) from public,anon,authenticated,service_role;


-- SOURCE: supabase/schemas/60_inventory_pilot_commands.sql
create or replace function public.inventory_pilot_command(p_operation text,p_payload jsonb,p_retry_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.inventory_pilot_scopes; previous private.inventory_pilot_writer_context; h text; old_h text; result jsonb; v_reconciliation jsonb; event_id uuid; related public.inventory_pilot_events; reason text:=nullif(btrim(p_payload->>'reason'),''); evidence text:=nullif(btrim(p_payload->>'evidence_reference'),''); writer_allowed boolean;
begin
 if auth.uid() is null or not private.can_access_inventory() then raise exception 'P1_ACTOR_DENIED' using errcode='42501'; end if;
 if p_retry_key is null or reason is null or evidence is null or p_operation not in ('register_scope','record_writer','confirm_opening','reconcile','activate','pause','report_dual_write','report_discrepancy','resolve_discrepancy') then raise exception 'P1_COMMAND_EVIDENCE_REQUIRED' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 select * into s from public.inventory_pilot_scopes where id=(p_payload#>>'{pilot,scope_id}')::uuid for update;
 if s.id is null then
  if p_operation<>'register_scope' then raise exception 'P1_SCOPE_UNKNOWN' using errcode='42501'; end if;
  previous:=private.p1_enter('inventory_pilot_command',p_operation,p_payload-'pilot');
 else
  previous:=private.p1_enter('inventory_pilot_command',p_operation,p_payload);
  perform private.p1_identity(s,p_payload->'pilot');
  perform private.p1_actor(s,p_operation in ('register_scope','record_writer','confirm_opening','activate','resolve_discrepancy'));
  update private.inventory_pilot_writer_context set bound_scope_id=s.id where transaction_id=txid_current();
 end if;
 h:=encode(extensions.digest(convert_to(p_payload::text,'UTF8'),'sha256'),'hex');
 select payload_hash,result_ids into old_h,result from public.inventory_operation_replays where actor_id=auth.uid() and operation='p1:'||p_operation and retry_key=p_retry_key;
 if found then
  if h<>old_h then raise exception 'P1_RETRY_PAYLOAD_MISMATCH' using errcode='23505'; end if;
  perform private.p1_leave(previous); return result;
 end if;
 if p_operation='register_scope' then
  if s.id is not null then raise exception 'P1_SCOPE_ALREADY_REGISTERED' using errcode='23505'; end if;
  s:=private.p1_register(p_payload->'manifest',p_payload->'pilot',evidence);
 elsif p_operation='record_writer' then
  if s.phase='ACTIVE' then raise exception 'P1_PAUSE_REQUIRED' using errcode='42501'; end if;
  writer_allowed:=(p_payload->>'allowed')::boolean;
  if writer_allowed is null or not exists(select 1 from public.inventory_pilot_writers where scope_id=s.id and writer_id=p_payload->>'writer_id') then raise exception 'P1_WRITER_UNKNOWN' using errcode='22023'; end if;
  if writer_allowed and p_payload->>'writer_id' in ('legacy','privileged_import','manual_offline') then raise exception 'P1_LEGACY_WRITER_FORBIDDEN' using errcode='42501'; end if;
  update public.inventory_pilot_writers set allowed=writer_allowed,evidence_reference=evidence,recorded_by=auth.uid(),recorded_at=clock_timestamp() where scope_id=s.id and writer_id=p_payload->>'writer_id';
 elsif p_operation='confirm_opening' then
  if s.phase='ACTIVE' then raise exception 'P1_OPENING_CLOSED' using errcode='42501'; end if;
  perform private.p1_bind_asset(s.id);
  v_reconciliation:=private.p1_reconcile(s.id);
  if v_reconciliation->>'opening_complete'<>'true' then raise exception 'P1_OPENING_RECONCILIATION_REQUIRED' using errcode='42501',detail=v_reconciliation::text; end if;
  update public.inventory_pilot_scopes set opening_confirmed=true,opening_batch_id=(v_reconciliation->>'opening_batch_id')::uuid where id=s.id;
 elsif p_operation='reconcile' then
  v_reconciliation:=private.p1_reconcile(s.id);
 elsif p_operation='activate' then
  v_reconciliation:=private.p1_reconcile(s.id);
  if not s.opening_confirmed or v_reconciliation->>'ready'<>'true' then raise exception 'P1_ACTIVATION_RECONCILIATION_REQUIRED' using errcode='42501',detail=v_reconciliation::text; end if;
  update public.inventory_pilot_scopes set phase='ACTIVE' where id=s.id;
 elsif p_operation in ('pause','report_dual_write','report_discrepancy') then
  if p_operation='report_dual_write' and (coalesce(p_payload->>'writer_id','') not in ('legacy','privileged_import','manual_offline') or nullif(btrim(p_payload->>'physical_reference'),'') is null) then raise exception 'P1_COMPETING_WRITER_EVIDENCE_REQUIRED' using errcode='22023'; end if;
  update public.inventory_pilot_scopes set phase='PAUSED' where id=s.id;
 elsif p_operation='resolve_discrepancy' then
  select * into related from public.inventory_pilot_events where id=(p_payload->>'related_event_id')::uuid and scope_id=s.id and operation in ('report_dual_write','report_discrepancy');
  if related.id is null then raise exception 'P1_DISCREPANCY_UNKNOWN' using errcode='22023'; end if;
 end if;
 update public.inventory_pilot_scopes set updated_by=auth.uid(),updated_at=clock_timestamp(),evidence_reference=evidence,reconciliation=coalesce(v_reconciliation,inventory_pilot_scopes.reconciliation) where id=s.id returning * into s;
 event_id:=private.p1_event(s.id,p_operation,reason,evidence,(p_payload-'pilot'-'manifest'-'reason'-'evidence_reference')||case when v_reconciliation is not null then jsonb_build_object('reconciliation',v_reconciliation) else '{}'::jsonb end,related.id);
 result:=jsonb_build_object('scope_id',s.id,'scope_version',s.scope_version,'manifest_id',s.manifest_id,'phase',s.phase,'event_id',event_id);
 if v_reconciliation is not null then result:=result||jsonb_build_object('reconciliation',v_reconciliation); end if;
 insert into public.inventory_operation_replays(actor_id,operation,retry_key,payload_hash,result_ids) values(auth.uid(),'p1:'||p_operation,p_retry_key,h,result);
 perform private.p1_leave(previous); return result;
end; $$;
create or replace function public.inventory_pilot_read(p_scope_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.inventory_pilot_scopes; result jsonb;
begin
 select * into s from public.inventory_pilot_scopes where id=p_scope_id;
 if s.id is null then raise exception 'P1_SCOPE_UNKNOWN' using errcode='42501'; end if;
 perform private.p1_actor(s);
 select jsonb_build_object('scope',to_jsonb(s),'writers',coalesce((select jsonb_agg(to_jsonb(w) order by w.writer_id) from public.inventory_pilot_writers w where w.scope_id=s.id),'[]'),
  'bindings',coalesce((select jsonb_agg(to_jsonb(b) order by b.row_key) from public.inventory_pilot_asset_bindings b where b.scope_id=s.id),'[]'),
  'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at desc,e.id desc) from (select * from public.inventory_pilot_events where scope_id=s.id order by occurred_at desc,id desc limit 50) e),'[]'),
  'unresolved_events',coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at,e.id) from public.inventory_pilot_events e where e.scope_id=s.id and e.operation in ('report_dual_write','report_discrepancy') and not exists(select 1 from public.inventory_pilot_events r where r.related_event_id=e.id and r.operation='resolve_discrepancy')),'[]')) into result;
 return result;
end; $$;
revoke all on function public.inventory_pilot_command(text,jsonb,uuid),public.inventory_pilot_read(uuid) from public,anon,authenticated,service_role;
grant execute on function public.inventory_pilot_command(text,jsonb,uuid),public.inventory_pilot_read(uuid) to authenticated;


-- SOURCE: supabase/schemas/61_inventory_pilot_writer_boundaries.sql
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


-- SOURCE: supabase/schemas/62_inventory_pilot_stock_guards.sql
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


-- SOURCE: supabase/schemas/63_inventory_pilot_request_guards.sql
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


-- SOURCE: supabase/schemas/64_inventory_pilot_guard_installation.sql
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
