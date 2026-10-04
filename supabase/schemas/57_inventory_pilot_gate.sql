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
 if not s.synthetic then
  perform private.p1_owner_approval(s);
  if not p_replay and c.operation in ('confirm_opening_balance','open_asset') then perform private.p1_real_opening(c.payload,false); end if;
 end if;
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
