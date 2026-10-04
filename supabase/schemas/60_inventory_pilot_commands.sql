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
  if not s.synthetic then perform private.p1_owner_approval(s,'activate'); end if;
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
