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
