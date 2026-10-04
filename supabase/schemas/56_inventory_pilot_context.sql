create or replace function private.p1_owner_approval(p_scope public.inventory_pilot_scopes,p_permission text default 'opening')
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.inventory_pilot_owner_approvals a
  where a.scope_id=p_scope.id and a.scope_version=p_scope.scope_version
  and a.manifest_id=p_scope.manifest_id and a.manifest_hash=p_scope.manifest_hash
  and a.permission=p_permission) then raise exception 'P1_OWNER_APPROVAL_REQUIRED' using errcode='42501'; end if;
end; $$;
create or replace function private.p1_real_opening(p_payload jsonb,p_replay boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare c private.inventory_pilot_writer_context; s public.inventory_pilot_scopes;
begin
 if p_payload->'synthetic' is distinct from 'false'::jsonb then raise exception 'P1_REAL_OPENING_DECLARATION_REQUIRED' using errcode='42501'; end if;
 select * into c from private.inventory_pilot_writer_context where transaction_id=txid_current() and backend_pid=pg_backend_pid();
 if c.transaction_id is null or c.actor_id is distinct from auth.uid() or c.pilot is null
  or not ((c.writer_id='inventory_command' and c.operation='confirm_opening_balance')
    or (c.writer_id='equipment_asset_command' and c.operation='open_asset')) then raise exception 'P1_CONTEXT_REQUIRED' using errcode='42501'; end if;
 select * into s from public.inventory_pilot_scopes where id=(c.pilot->>'scope_id')::uuid;
 if s.id is null or s.synthetic then raise exception 'P1_REAL_SCOPE_REQUIRED' using errcode='42501'; end if;
 perform private.p1_identity(s,c.pilot); perform private.p1_actor(s,true); perform private.p1_owner_approval(s);
 if not p_replay then
  if s.phase='PAUSED' then raise exception 'P1_PAUSED' using errcode='42501'; end if;
  if s.phase<>'OPENING_READY' then raise exception 'P1_OPENING_CLOSED' using errcode='42501'; end if;
  if (select count(*) from public.inventory_pilot_writers where scope_id=s.id)<>8
   or exists(select 1 from public.inventory_pilot_writers w where w.scope_id=s.id
    and (nullif(btrim(w.evidence_reference),'') is null or w.recorded_at is null
      or w.recorded_by is distinct from s.admin_id
      or w.allowed is distinct from (w.writer_id not in ('legacy','privileged_import','manual_offline')))) then
   raise exception 'P1_WRITER_EXCLUSION_EVIDENCE_REQUIRED' using errcode='42501';
  end if;
  if c.writer_id='inventory_command' and p_payload-'pilot' is distinct from s.manifest->'opening_payload' then raise exception 'P1_OPENING_MANIFEST_MISMATCH' using errcode='23505'; end if;
 end if;
end; $$;
revoke all on function private.p1_owner_approval(public.inventory_pilot_scopes,text),private.p1_real_opening(jsonb,boolean) from public,anon,authenticated,service_role;

create or replace function private.p1_actor(p_scope public.inventory_pilot_scopes,p_admin boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.can_access_inventory() or auth.uid() is null then raise exception 'P1_ACTOR_DENIED' using errcode='42501'; end if;
 if p_scope.synthetic then
  if not exists(select 1 from auth.users u where u.id=auth.uid() and u.raw_app_meta_data->'synthetic'='true'::jsonb and (u.raw_app_meta_data->>'mock_scope_id')::uuid=p_scope.id and nullif(u.encrypted_password,'') is null) then raise exception 'P1_SYNTHETIC_ACTOR_MISMATCH' using errcode='42501'; end if;
 elsif not exists(select 1 from auth.users u where u.id=auth.uid() and u.raw_app_meta_data->'synthetic' is distinct from 'true'::jsonb and u.email not like '%@%.invalid') then
  raise exception 'P1_REAL_ACTOR_MISMATCH' using errcode='42501';
 end if;
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
 if p_payload->'synthetic'='false'::jsonb and p_operation in ('confirm_opening_balance','open_asset') and p_payload->'pilot' is null then
  raise exception 'P1_CONTEXT_REQUIRED' using errcode='42501';
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
 values(txid_current(),pg_backend_pid(),auth.uid(),p_writer,p_operation,coalesce(p_request,previous.request_id),meta,case when p_operation in ('confirm_opening_balance','open_asset') then coalesce(p_payload-'pilot','{}'::jsonb) else '{}'::jsonb end,previous.bound_scope_id,coalesce(previous.outside_touched,false))
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
