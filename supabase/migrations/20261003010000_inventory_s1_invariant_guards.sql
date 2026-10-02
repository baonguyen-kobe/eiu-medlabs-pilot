-- Enforce normalized opening identity, positive receipt corrections, and expiry evidence.
create or replace function public.inventory_command(
  p_operation text,
  p_payload jsonb,
  p_retry_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_is_admin boolean;
  v_payload_hash text;
  v_replay_hash text;
  v_replay_result jsonb;

  -- Master working variables
  v_id uuid;
  v_expected_revision bigint;
  v_reason text;
  v_code text;
  v_name text;

  -- Entity records
  v_item record;
  v_cat record;
  v_uom public.inventory_uoms%rowtype;
  v_supp record;
  v_loc public.inventory_storage_locations%rowtype;
  v_source record;
  v_source_line record;

  -- Transaction working variables
  v_tx_id uuid;
  v_receipt_id uuid;
  v_batch_id uuid;
  v_origin_id uuid;
  v_fact_id uuid;
  v_orig_tx record;
  v_current_fact record;
  v_line jsonb;
  v_lines_arr jsonb;
  v_line_no int := 0;
  v_line_key text;
  v_provenance_group text;

  -- Numeric / conversion working variables
  v_purchase_qty numeric(18,6);
  v_factor numeric(18,6);
  v_base_qty numeric(18,6);
  v_good_qty numeric(18,6);
  v_damaged_qty numeric(18,6);
  v_good_delta numeric(18,6);
  v_damaged_delta numeric(18,6);
  v_prod numeric;

  -- Expiry working variables
  v_expiry_precision text;
  v_expiry_input text;
  v_expiry_date date;

  -- Replay result object
  v_result jsonb;
begin
  -- S1 serializes Inventory writes; reads remain concurrent. This also orders
  -- master edits, opening scope claims and multi-source receipt/correction locks.
  perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer', 0));
  -- 1. Authentication & Base Authorization
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'AUTH_DENIED: Unauthenticated request' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = v_caller_id for update;

  if not private.can_access_inventory() then
    raise exception 'AUTH_DENIED: User not active or unauthorized for inventory' using errcode = '42501';
  end if;

  v_is_admin := private.is_inventory_admin();

  if p_retry_key is null then
    raise exception 'INVALID_RETRY_KEY: Retry key cannot be null' using errcode = '22023';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_PAYLOAD: Payload must be an object' using errcode = '22023';
  end if;

  if (p_operation like 'update_%' or p_operation like 'inactivate_%'
      or p_operation like 'reactivate_%' or p_operation = 'create_acquisition_source_line')
     and (p_payload->>'expected_revision' is null or (p_payload->>'expected_revision')::bigint < 1) then
    raise exception 'STALE_REVISION: Expected revision is required' using errcode = '23505';
  end if;

  -- 2. Admin-only operations check
  if p_operation in (
    'inactivate_inventory_item', 'reactivate_inventory_item',
    'confirm_opening_balance', 'correct_opening_balance', 'verify_opening_expiry',
    'create_inventory_uom', 'update_inventory_uom', 'inactivate_inventory_uom', 'reactivate_inventory_uom',
    'inactivate_inventory_category', 'reactivate_inventory_category',
    'inactivate_inventory_supplier', 'reactivate_inventory_supplier',
    'inactivate_inventory_location', 'reactivate_inventory_location'
  ) then
    if not v_is_admin then
      raise exception 'AUTH_DENIED: Administrator role required for %', p_operation using errcode = '42501';
    end if;
  end if;

  if p_operation = 'update_acquisition_source' and p_payload ? 'status' then
    if not v_is_admin then
      raise exception 'AUTH_DENIED: Administrator role required for source lifecycle changes' using errcode = '42501';
    end if;
  end if;

  -- 3. Lock Ordering (G0 Pack §6)

  -- 3.2 Lock retry key advisory transaction lock
  perform pg_advisory_xact_lock(hashtext('retry:' || p_retry_key::text));

  -- 3.3 Check idempotent replay
  v_payload_hash := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  select payload_hash, result_ids into v_replay_hash, v_replay_result
  from public.inventory_operation_replays
  where actor_id = v_caller_id
    and operation = p_operation
    and retry_key = p_retry_key;

  if found then
    if v_replay_hash = v_payload_hash then
      return v_replay_result;
    else
      raise exception 'RETRY_PAYLOAD_MISMATCH: Retry key already used with different payload' using errcode = '23505';
    end if;
  end if;

  -- ==========================================================================
  -- 4. DISPATCH OPERATION
  -- ==========================================================================

  -- --------------------------------------------------------------------------
  -- 4.1 Master: Catalog Item Operations
  -- --------------------------------------------------------------------------
  if p_operation = 'create_inventory_item' then
    v_code := upper(btrim(coalesce(p_payload->>'code', '')));
    v_name := btrim(coalesce(p_payload->>'name', ''));
    if v_code = '' or v_name = '' then
      raise exception 'INVALID_ITEM: Code and name cannot be blank' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtext('biz_item_code:' || v_code));

    select * into v_cat from public.inventory_categories where id = (p_payload->>'category_id')::uuid;
    if not found or not v_cat.active then
      raise exception 'INACTIVE_REFERENCE: Category not found or inactive' using errcode = '22023';
    end if;

    select * into v_uom from public.inventory_uoms where code = p_payload->>'base_uom_code';
    if not found or not v_uom.active then
      raise exception 'INACTIVE_REFERENCE: Base UOM not found or inactive' using errcode = '22023';
    end if;

    if p_payload->>'material_kind' = 'chemical' and not coalesce((p_payload->>'expiry_required')::boolean, false) then
      raise exception 'INVALID_EXPIRY_POLICY: Chemical material kind requires expiry_required=true' using errcode = '22023';
    end if;

    insert into public.inventory_catalog_items (
      code, name, category_id, material_kind, base_uom_code,
      tracking_strategy, return_semantics, expiry_required, active, revision
    ) values (
      v_code, v_name, v_cat.id, p_payload->>'material_kind', v_uom.code,
      p_payload->>'tracking_strategy', p_payload->>'return_semantics',
      (p_payload->>'expiry_required')::boolean, true, 1
    ) returning id into v_id;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
    values (v_caller_id, 'inventory.item_created', 'inventory_catalog_item', v_id, p_payload);

    v_result := jsonb_build_object('id', v_id, 'revision', 1);

  elsif p_operation = 'update_inventory_item' then
    v_id := (p_payload->>'id')::uuid;
    v_expected_revision := (p_payload->>'expected_revision')::bigint;

    select * into v_item from public.inventory_catalog_items where id = v_id for update;
    if not found then
      raise exception 'ITEM_NOT_FOUND: Item not found' using errcode = 'P0002';
    end if;

    if v_item.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: Item revision conflict. Expected %, got %', v_expected_revision, v_item.revision
        using errcode = '23505';
    end if;

    if p_payload ? 'category_id' then
      select * into v_cat from public.inventory_categories where id = (p_payload->>'category_id')::uuid;
      if not found or not v_cat.active then
        raise exception 'INACTIVE_REFERENCE: Category not found or inactive' using errcode = '22023';
      end if;
    end if;

    update public.inventory_catalog_items
    set name = coalesce(btrim(p_payload->>'name'), name),
        category_id = coalesce((p_payload->>'category_id')::uuid, category_id),
        material_kind = coalesce(p_payload->>'material_kind', material_kind),
        base_uom_code = coalesce(p_payload->>'base_uom_code', base_uom_code),
        tracking_strategy = coalesce(p_payload->>'tracking_strategy', tracking_strategy),
        return_semantics = coalesce(p_payload->>'return_semantics', return_semantics),
        expiry_required = coalesce((p_payload->>'expiry_required')::boolean, expiry_required),
        revision = revision + 1,
        updated_at = clock_timestamp()
    where id = v_id
    returning revision into v_expected_revision;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
    values (v_caller_id, 'inventory.item_updated', 'inventory_catalog_item', v_id, to_jsonb(v_item), p_payload);

    v_result := jsonb_build_object('id', v_id, 'revision', v_expected_revision);

  elsif p_operation in ('inactivate_inventory_item', 'reactivate_inventory_item') then
    v_id := (p_payload->>'id')::uuid;
    v_expected_revision := (p_payload->>'expected_revision')::bigint;
    v_reason := btrim(coalesce(p_payload->>'reason', ''));
    if v_reason = '' then
      raise exception 'REASON_REQUIRED: Active state change requires a non-blank reason' using errcode = '22023';
    end if;

    select * into v_item from public.inventory_catalog_items where id = v_id for update;
    if not found then
      raise exception 'ITEM_NOT_FOUND: Item not found' using errcode = 'P0002';
    end if;

    if v_item.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: Revision conflict' using errcode = '23505';
    end if;

    update public.inventory_catalog_items
    set active = (p_operation = 'reactivate_inventory_item'),
        revision = revision + 1,
        updated_at = clock_timestamp()
    where id = v_id
    returning revision into v_expected_revision;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (v_caller_id, 'inventory.item_active_state_changed', 'inventory_catalog_item', v_id,
            jsonb_build_object('operation', p_operation, 'reason', v_reason, 'revision', v_expected_revision));

    v_result := jsonb_build_object('id', v_id, 'revision', v_expected_revision);

  -- --------------------------------------------------------------------------
  -- 4.2 Reference Master Operations (Categories, UOMs, Suppliers, Locations)
  -- --------------------------------------------------------------------------
  elsif p_operation = 'create_inventory_category' then
    v_code := upper(btrim(coalesce(p_payload->>'code', '')));
    v_name := btrim(coalesce(p_payload->>'name', ''));
    insert into public.inventory_categories (code, name, active, revision)
    values (v_code, v_name, true, 1)
    returning id into v_id;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
    values (v_caller_id, 'inventory.category_created', 'inventory_category', v_id, p_payload);

    v_result := jsonb_build_object('id', v_id, 'revision', 1);

  elsif p_operation = 'update_inventory_category' then
    v_id := (p_payload->>'id')::uuid;
    v_expected_revision := (p_payload->>'expected_revision')::bigint;
    select * into v_cat from public.inventory_categories where id = v_id for update;
    if not found or v_cat.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: Category revision mismatch' using errcode = '23505';
    end if;

    update public.inventory_categories
    set name = coalesce(btrim(p_payload->>'name'), name),
        revision = revision + 1,
        updated_at = clock_timestamp()
    where id = v_id
    returning revision into v_expected_revision;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
    values (v_caller_id, 'inventory.category_updated', 'inventory_category', v_id, to_jsonb(v_cat), p_payload);

    v_result := jsonb_build_object('id', v_id, 'revision', v_expected_revision);

  elsif p_operation in ('inactivate_inventory_category', 'reactivate_inventory_category') then
    v_id := (p_payload->>'id')::uuid;
    v_expected_revision := (p_payload->>'expected_revision')::bigint;
    v_reason := btrim(coalesce(p_payload->>'reason', ''));
    if v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;

    select * into v_cat from public.inventory_categories where id = v_id for update;
    if not found or v_cat.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: Category revision mismatch' using errcode = '23505';
    end if;

    update public.inventory_categories
    set active = (p_operation = 'reactivate_inventory_category'),
        revision = revision + 1,
        updated_at = clock_timestamp()
    where id = v_id
    returning revision into v_expected_revision;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (v_caller_id, 'inventory.category_active_changed', 'inventory_category', v_id,
            jsonb_build_object('operation', p_operation, 'reason', v_reason));

    v_result := jsonb_build_object('id', v_id, 'revision', v_expected_revision);

  elsif p_operation = 'create_inventory_uom' then
    v_code := btrim(coalesce(p_payload->>'code', ''));
    v_name := btrim(coalesce(p_payload->>'name', ''));
    insert into public.inventory_uoms (code, name, dimension, allowed_scale, active, revision)
    values (v_code, v_name, p_payload->>'dimension', (p_payload->>'allowed_scale')::smallint, true, 1);

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
    values (v_caller_id, 'inventory.uom_created', 'inventory_uom', null, p_payload);

    v_result := jsonb_build_object('code', v_code, 'revision', 1);

  elsif p_operation = 'update_inventory_uom' then
    v_code := btrim(coalesce(p_payload->>'code', ''));
    v_expected_revision := (p_payload->>'expected_revision')::bigint;
    select * into v_uom from public.inventory_uoms where code = v_code for update;
    if not found or v_uom.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: UOM revision mismatch' using errcode = '23505';
    end if;

    update public.inventory_uoms
    set name = coalesce(btrim(p_payload->>'name'), name),
        dimension = coalesce(p_payload->>'dimension', dimension),
        allowed_scale = coalesce((p_payload->>'allowed_scale')::smallint, allowed_scale),
        revision = revision + 1,
        updated_at = clock_timestamp()
    where code = v_code
    returning revision into v_expected_revision;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
    values (v_caller_id, 'inventory.uom_updated', 'inventory_uom', null, to_jsonb(v_uom), p_payload);

    v_result := jsonb_build_object('code', v_code, 'revision', v_expected_revision);

  elsif p_operation in ('inactivate_inventory_uom', 'reactivate_inventory_uom') then
    v_code := btrim(coalesce(p_payload->>'code', ''));
    v_expected_revision := (p_payload->>'expected_revision')::bigint;
    v_reason := btrim(coalesce(p_payload->>'reason', ''));
    if v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;

    select * into v_uom from public.inventory_uoms where code = v_code for update;
    if not found or v_uom.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: UOM revision mismatch' using errcode = '23505';
    end if;

    update public.inventory_uoms
    set active = (p_operation = 'reactivate_inventory_uom'),
        revision = revision + 1,
        updated_at = clock_timestamp()
    where code = v_code
    returning revision into v_expected_revision;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (v_caller_id, 'inventory.uom_active_changed', 'inventory_uom', null,
            jsonb_build_object('operation', p_operation, 'reason', v_reason, 'code', v_code));

    v_result := jsonb_build_object('code', v_code, 'revision', v_expected_revision);

  elsif p_operation = 'create_inventory_supplier' then
    v_name := btrim(coalesce(p_payload->>'name', ''));
    insert into public.inventory_suppliers (name, tax_code, contact, notes, active, revision)
    values (v_name, p_payload->>'tax_code', p_payload->>'contact', p_payload->>'notes', true, 1)
    returning id into v_id;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
    values (v_caller_id, 'inventory.supplier_created', 'inventory_supplier', v_id, p_payload);

    v_result := jsonb_build_object('id', v_id, 'revision', 1);

  elsif p_operation = 'update_inventory_supplier' then
    v_id := (p_payload->>'id')::uuid;
    v_expected_revision := (p_payload->>'expected_revision')::bigint;
    select * into v_supp from public.inventory_suppliers where id = v_id for update;
    if not found or v_supp.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: Supplier revision mismatch' using errcode = '23505';
    end if;

    update public.inventory_suppliers
    set name = coalesce(btrim(p_payload->>'name'), name),
        tax_code = coalesce(p_payload->>'tax_code', tax_code),
        contact = coalesce(p_payload->>'contact', contact),
        notes = coalesce(p_payload->>'notes', notes),
        revision = revision + 1,
        updated_at = clock_timestamp()
    where id = v_id
    returning revision into v_expected_revision;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
    values (v_caller_id, 'inventory.supplier_updated', 'inventory_supplier', v_id, to_jsonb(v_supp), p_payload);

    v_result := jsonb_build_object('id', v_id, 'revision', v_expected_revision);

  elsif p_operation in ('inactivate_inventory_supplier', 'reactivate_inventory_supplier') then
    v_id := (p_payload->>'id')::uuid;
    v_expected_revision := (p_payload->>'expected_revision')::bigint;
    v_reason := btrim(coalesce(p_payload->>'reason', ''));
    if v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;

    select * into v_supp from public.inventory_suppliers where id = v_id for update;
    if not found or v_supp.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: Supplier revision mismatch' using errcode = '23505';
    end if;

    update public.inventory_suppliers
    set active = (p_operation = 'reactivate_inventory_supplier'),
        revision = revision + 1,
        updated_at = clock_timestamp()
    where id = v_id
    returning revision into v_expected_revision;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (v_caller_id, 'inventory.supplier_active_changed', 'inventory_supplier', v_id,
            jsonb_build_object('operation', p_operation, 'reason', v_reason));

    v_result := jsonb_build_object('id', v_id, 'revision', v_expected_revision);

  elsif p_operation = 'create_inventory_location' then
    perform pg_advisory_xact_lock(hashtext('inventory_location_hierarchy_lock'));
    v_code := upper(btrim(coalesce(p_payload->>'code', '')));
    v_name := btrim(coalesce(p_payload->>'name', ''));

    insert into public.inventory_storage_locations (code, name, parent_location_id, room_id, active, revision)
    values (
      v_code, v_name, (p_payload->>'parent_location_id')::uuid, (p_payload->>'room_id')::uuid, true, 1
    ) returning id into v_id;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
    values (v_caller_id, 'inventory.location_created', 'inventory_storage_location', v_id, p_payload);

    v_result := jsonb_build_object('id', v_id, 'revision', 1);

  elsif p_operation = 'update_inventory_location' then
    perform pg_advisory_xact_lock(hashtext('inventory_location_hierarchy_lock'));
    v_id := (p_payload->>'id')::uuid;
    v_expected_revision := (p_payload->>'expected_revision')::bigint;

    select * into v_loc from public.inventory_storage_locations where id = v_id for update;
    if not found or v_loc.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: Location revision mismatch' using errcode = '23505';
    end if;

    update public.inventory_storage_locations
    set name = coalesce(btrim(p_payload->>'name'), name),
        parent_location_id = case when p_payload ? 'parent_location_id' then (p_payload->>'parent_location_id')::uuid else parent_location_id end,
        room_id = case when p_payload ? 'room_id' then (p_payload->>'room_id')::uuid else room_id end,
        revision = revision + 1,
        updated_at = clock_timestamp()
    where id = v_id
    returning revision into v_expected_revision;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
    values (v_caller_id, 'inventory.location_updated', 'inventory_storage_location', v_id, to_jsonb(v_loc), p_payload);

    v_result := jsonb_build_object('id', v_id, 'revision', v_expected_revision);

  elsif p_operation in ('inactivate_inventory_location', 'reactivate_inventory_location') then
    v_id := (p_payload->>'id')::uuid;
    v_expected_revision := (p_payload->>'expected_revision')::bigint;
    v_reason := btrim(coalesce(p_payload->>'reason', ''));
    if v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;

    select * into v_loc from public.inventory_storage_locations where id = v_id for update;
    if not found or v_loc.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: Location revision mismatch' using errcode = '23505';
    end if;

    update public.inventory_storage_locations
    set active = (p_operation = 'reactivate_inventory_location'),
        revision = revision + 1,
        updated_at = clock_timestamp()
    where id = v_id
    returning revision into v_expected_revision;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (v_caller_id, 'inventory.location_active_changed', 'inventory_storage_location', v_id,
            jsonb_build_object('operation', p_operation, 'reason', v_reason));

    v_result := jsonb_build_object('id', v_id, 'revision', v_expected_revision);

  -- --------------------------------------------------------------------------
  -- 4.3 Provenance: Acquisition Records and Lines
  -- --------------------------------------------------------------------------
  elsif p_operation = 'create_acquisition_source' then
    v_code := btrim(coalesce(p_payload->>'source_reference', ''));
    perform pg_advisory_xact_lock(hashtext('source_ref:' || v_code));

    select * into v_supp from public.inventory_suppliers where id = (p_payload->>'supplier_id')::uuid;
    if not found or not v_supp.active then
      raise exception 'INACTIVE_REFERENCE: Supplier not found or inactive' using errcode = '22023';
    end if;

    insert into public.acquisition_records (
      source_reference, supplier_id, reference_date, funding_source,
      external_reference, notes, status, revision
    ) values (
      v_code, v_supp.id, (p_payload->>'reference_date')::date,
      p_payload->>'funding_source', p_payload->>'external_reference',
      p_payload->>'notes', 'active', 1
    ) returning id into v_id;

    -- Optional initial lines
    if p_payload ? 'lines' and jsonb_array_length(p_payload->'lines') > 0 then
      for v_line in select * from jsonb_array_elements(p_payload->'lines') loop
        v_purchase_qty := private.inventory_validate_decimal(v_line->>'expected_purchase_quantity', 6, true);
        v_factor := case when v_line ? 'expected_conversion_factor' and v_line->>'expected_conversion_factor' is not null
                         then private.inventory_validate_decimal(v_line->>'expected_conversion_factor', 6, true)
                         else null end;
        insert into public.acquisition_record_lines (
          acquisition_record_id, line_key, catalog_item_id, expected_purchase_quantity,
          purchase_uom_code, expected_conversion_factor, unit_cost, currency_code,
          manufacturer, model, country_of_origin, warranty_start, warranty_end, notes
        ) values (
          v_id, btrim(v_line->>'line_key'), (v_line->>'catalog_item_id')::uuid, v_purchase_qty,
          v_line->>'purchase_uom_code', v_factor,
          private.inventory_validate_cost(v_line->>'unit_cost', v_line->>'currency_code'),
          v_line->>'currency_code', v_line->>'manufacturer', v_line->>'model',
          v_line->>'country_of_origin', (v_line->>'warranty_start')::date,
          (v_line->>'warranty_end')::date, v_line->>'notes'
        );
      end loop;
    end if;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
    values (v_caller_id, 'inventory.acquisition_source_created', 'acquisition_record', v_id, p_payload);

    v_result := jsonb_build_object('id', v_id, 'revision', 1);

  elsif p_operation = 'update_acquisition_source' then
    v_id := (p_payload->>'id')::uuid;
    v_expected_revision := (p_payload->>'expected_revision')::bigint;

    select * into v_source from public.acquisition_records where id = v_id for update;
    if not found or v_source.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: Acquisition source revision mismatch' using errcode = '23505';
    end if;

    if p_payload ? 'status' and p_payload->>'status' is distinct from v_source.status
       and btrim(coalesce(p_payload->>'reason', '')) = '' then
      raise exception 'REASON_REQUIRED: Source lifecycle change requires a reason' using errcode = '22023';
    end if;

    update public.acquisition_records
    set supplier_id = coalesce((p_payload->>'supplier_id')::uuid, supplier_id),
        reference_date = coalesce((p_payload->>'reference_date')::date, reference_date),
        funding_source = coalesce(p_payload->>'funding_source', funding_source),
        external_reference = coalesce(p_payload->>'external_reference', external_reference),
        notes = coalesce(p_payload->>'notes', notes),
        status = coalesce(p_payload->>'status', status),
        revision = revision + 1,
        updated_at = clock_timestamp()
    where id = v_id
    returning revision into v_expected_revision;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
    values (v_caller_id, 'inventory.acquisition_source_updated', 'acquisition_record', v_id, to_jsonb(v_source), p_payload);

    v_result := jsonb_build_object('id', v_id, 'revision', v_expected_revision);

  elsif p_operation = 'create_acquisition_source_line' then
    v_id := (p_payload->>'acquisition_record_id')::uuid;
    v_expected_revision := (p_payload->>'expected_revision')::bigint;

    select * into v_source from public.acquisition_records where id = v_id for update;
    if not found or v_source.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: Acquisition source revision mismatch' using errcode = '23505';
    end if;

    select * into v_item from public.inventory_catalog_items where id = (p_payload->>'catalog_item_id')::uuid;
    if not found or not v_item.active then
      raise exception 'INACTIVE_REFERENCE: Catalog item not found or inactive' using errcode = '22023';
    end if;

    v_purchase_qty := private.inventory_validate_decimal(p_payload->>'expected_purchase_quantity', 6, true);
    v_factor := case when p_payload ? 'expected_conversion_factor' and p_payload->>'expected_conversion_factor' is not null
                     then private.inventory_validate_decimal(p_payload->>'expected_conversion_factor', 6, true)
                     else null end;

    insert into public.acquisition_record_lines (
      acquisition_record_id, line_key, catalog_item_id, expected_purchase_quantity,
      purchase_uom_code, expected_conversion_factor, unit_cost, currency_code,
      manufacturer, model, country_of_origin, warranty_start, warranty_end, notes
    ) values (
      v_id, btrim(p_payload->>'line_key'), v_item.id, v_purchase_qty,
      p_payload->>'purchase_uom_code', v_factor,
      private.inventory_validate_cost(p_payload->>'unit_cost', p_payload->>'currency_code'),
      p_payload->>'currency_code', p_payload->>'manufacturer', p_payload->>'model',
      p_payload->>'country_of_origin', (p_payload->>'warranty_start')::date,
      (p_payload->>'warranty_end')::date, p_payload->>'notes'
    ) returning id into v_origin_id;

    update public.acquisition_records
    set revision = revision + 1, updated_at = clock_timestamp()
    where id = v_id
    returning revision into v_expected_revision;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
    values (v_caller_id, 'inventory.acquisition_line_created', 'acquisition_record_line', v_origin_id, p_payload);

    v_result := jsonb_build_object('id', v_origin_id, 'source_revision', v_expected_revision);

  elsif p_operation = 'update_acquisition_source_line' then
    v_id := (p_payload->>'id')::uuid;
    v_expected_revision := (p_payload->>'expected_revision')::bigint;

    select * into v_source_line from public.acquisition_record_lines where id = v_id for update;
    if not found then raise exception 'LINE_NOT_FOUND' using errcode = 'P0002'; end if;

    select * into v_source from public.acquisition_records where id = v_source_line.acquisition_record_id for update;
    if not found or v_source.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: Acquisition source revision mismatch' using errcode = '23505';
    end if;

    v_purchase_qty := case when p_payload ? 'expected_purchase_quantity'
                           then private.inventory_validate_decimal(p_payload->>'expected_purchase_quantity', 6, true)
                           else v_source_line.expected_purchase_quantity end;
    v_factor := case when p_payload ? 'expected_conversion_factor' and p_payload->>'expected_conversion_factor' is not null
                     then private.inventory_validate_decimal(p_payload->>'expected_conversion_factor', 6, true)
                     else v_source_line.expected_conversion_factor end;

    update public.acquisition_record_lines
    set line_key = coalesce(btrim(p_payload->>'line_key'), line_key),
        expected_purchase_quantity = v_purchase_qty,
        purchase_uom_code = coalesce(p_payload->>'purchase_uom_code', purchase_uom_code),
        expected_conversion_factor = v_factor,
        unit_cost = case when p_payload ? 'unit_cost'
                         then private.inventory_validate_cost(p_payload->>'unit_cost', coalesce(p_payload->>'currency_code', currency_code))
                         else unit_cost end,
        currency_code = coalesce(p_payload->>'currency_code', currency_code),
        manufacturer = coalesce(p_payload->>'manufacturer', manufacturer),
        model = coalesce(p_payload->>'model', model),
        country_of_origin = coalesce(p_payload->>'country_of_origin', country_of_origin),
        warranty_start = coalesce((p_payload->>'warranty_start')::date, warranty_start),
        warranty_end = coalesce((p_payload->>'warranty_end')::date, warranty_end),
        notes = coalesce(p_payload->>'notes', notes),
        updated_at = clock_timestamp()
    where id = v_id;

    update public.acquisition_records
    set revision = revision + 1, updated_at = clock_timestamp()
    where id = v_source.id
    returning revision into v_expected_revision;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_data, new_data)
    values (v_caller_id, 'inventory.acquisition_line_updated', 'acquisition_record_line', v_id, to_jsonb(v_source_line), p_payload);

    v_result := jsonb_build_object('id', v_id, 'source_revision', v_expected_revision);

  -- --------------------------------------------------------------------------
  -- 4.4 Physical Stock Intake: Receive Stock (receive_stock)
  -- --------------------------------------------------------------------------
  elsif p_operation = 'receive_stock' then
    v_code := btrim(coalesce(p_payload->>'receipt_reference', ''));
    if v_code = '' then raise exception 'RECEIPT_REFERENCE_REQUIRED' using errcode = '22023'; end if;

    perform pg_advisory_xact_lock(hashtext('receipt:' || v_code));

    if exists (select 1 from public.inventory_receipts where receipt_reference = v_code) then
      raise exception 'BUSINESS_DUPLICATE: Receipt reference % already posted', v_code using errcode = '23505';
    end if;

    v_lines_arr := p_payload->'lines';
    if v_lines_arr is null or jsonb_array_length(v_lines_arr) = 0 then
      raise exception 'LINES_REQUIRED: Receipt must contain at least one line' using errcode = '22023';
    end if;

    -- Insert Transaction Header
    insert into public.inventory_transactions (
      operation, business_key, actor_id, occurred_at, posted_at, reason
    ) values (
      'RECEIVE', v_code, v_caller_id, (p_payload->>'occurred_at')::timestamptz, clock_timestamp(), p_payload->>'reason'
    ) returning id into v_tx_id;

    -- Insert Receipt Document
    insert into public.inventory_receipts (receipt_reference, transaction_id)
    values (v_code, v_tx_id)
    returning id into v_receipt_id;

    -- Process Each Line
    for v_line in select * from jsonb_array_elements(v_lines_arr) loop
      v_line_no := v_line_no + 1;
      v_line_key := btrim(coalesce(v_line->>'line_key', ''));
      if v_line_key = '' then raise exception 'LINE_KEY_REQUIRED' using errcode = '22023'; end if;

      -- Source Line & Source Record validation
      select * into v_source_line from public.acquisition_record_lines where id = (v_line->>'source_line_id')::uuid for update;
      if not found then raise exception 'SOURCE_LINE_NOT_FOUND' using errcode = '22023'; end if;

      select * into v_source from public.acquisition_records where id = v_source_line.acquisition_record_id for update;
      if not found or v_source.status <> 'active' then
        raise exception 'INACTIVE_REFERENCE: Acquisition source record is not active' using errcode = '22023';
      end if;

      -- Catalog Item validation
      select * into v_item from public.inventory_catalog_items where id = (v_line->>'catalog_item_id')::uuid for update;
      if not found or not v_item.active then
        raise exception 'INACTIVE_REFERENCE: Catalog item is not active' using errcode = '22023';
      end if;

      if v_item.id <> v_source_line.catalog_item_id then
        raise exception 'ITEM_SOURCE_MISMATCH: Catalog item does not match acquisition line' using errcode = '22023';
      end if;

      if v_item.tracking_strategy = 'serialized' then
        raise exception 'SERIALIZED_TRACKING_NOT_SUPPORTED: Quantity intake does not support serialized items'
          using errcode = '22023';
      end if;

      -- Location validation
      select * into v_loc from public.inventory_storage_locations where id = (v_line->>'location_id')::uuid;
      if not found or not v_loc.active then
        raise exception 'INACTIVE_REFERENCE: Storage location is not active' using errcode = '22023';
      end if;

      -- Purchase UOM & Decimals
      select * into v_uom from public.inventory_uoms where code = v_line->>'purchase_uom_code';
      if not found or not v_uom.active then
        raise exception 'INACTIVE_REFERENCE: Purchase UOM is not active' using errcode = '22023';
      end if;

      select * into v_cat from public.inventory_uoms where code = v_item.base_uom_code;

      v_purchase_qty := private.inventory_validate_decimal(v_line->>'purchase_quantity', v_uom.allowed_scale, true);
      v_factor := private.inventory_validate_decimal(v_line->>'conversion_factor', 6, true);

      -- Exact multiplication product check
      v_prod := v_purchase_qty * v_factor;
      if scale(trim_scale(v_prod)) > v_cat.allowed_scale then
        raise exception 'INVALID_DECIMAL: Base quantity scale % exceeds base UOM scale %', scale(trim_scale(v_prod)), v_cat.allowed_scale
          using errcode = '22023';
      end if;
      v_base_qty := v_prod;

      v_good_qty := private.inventory_validate_decimal(v_line->>'good_quantity', v_cat.allowed_scale, false);
      v_damaged_qty := private.inventory_validate_decimal(v_line->>'damaged_quantity', v_cat.allowed_scale, false);

      if v_good_qty + v_damaged_qty <> v_base_qty then
        raise exception 'INVALID_DECIMAL: Good quantity (%) + damaged quantity (%) must equal base quantity (%) exactly',
          v_good_qty, v_damaged_qty, v_base_qty using errcode = '22023';
      end if;

      -- Expiry validation
      v_expiry_precision := v_line->>'expiry_precision';
      v_expiry_input := v_line->>'expiry_input';

      if v_item.material_kind = 'chemical' or v_item.expiry_required then
        if v_expiry_precision not in ('day', 'month') then
          raise exception 'INVALID_EXPIRY: Expiry required (day or month) for item %', v_item.code
            using errcode = '22023';
        end if;
      else
        if v_expiry_precision = 'unknown' then
          raise exception 'INVALID_EXPIRY: Unknown precision not permitted for normal receipts' using errcode = '22023';
        end if;
      end if;

      v_expiry_date := private.inventory_normalize_expiry(v_expiry_precision, v_expiry_input, false);

      -- Insert Origin
      insert into public.inventory_stock_origins (
        receipt_id, line_key, provenance_group, catalog_item_id, source_line_id
      ) values (
        v_receipt_id, v_line_key, 'receipt:' || v_code, v_item.id, v_source_line.id
      ) returning id into v_origin_id;

      -- Insert Fact (version 0)
      insert into public.inventory_stock_facts (
        origin_id, version, previous_fact_id, transaction_id, location_id,
        base_uom_code, purchase_quantity, purchase_uom_code, conversion_factor,
        base_quantity, good_quantity, damaged_quantity,
        expiry_precision, expiry_input, expiry_date,
        source_snapshot, evidence_note
      ) values (
        v_origin_id, 0, null, v_tx_id, v_loc.id,
        v_item.base_uom_code, v_purchase_qty, v_uom.code, v_factor,
        v_base_qty, v_good_qty, v_damaged_qty,
        v_expiry_precision, v_expiry_input, v_expiry_date,
        jsonb_build_object(
          'source_id', v_source.id,
          'source_reference', v_source.source_reference,
          'source_line_id', v_source_line.id,
          'supplier_id', v_source.supplier_id,
          'reference_date', v_source.reference_date,
          'expected_purchase_quantity', v_source_line.expected_purchase_quantity::text,
          'purchase_uom_code', v_source_line.purchase_uom_code,
          'expected_conversion_factor', v_source_line.expected_conversion_factor::text,
          'unit_cost', v_source_line.unit_cost::text,
          'currency_code', v_source_line.currency_code
        ),
        v_line->>'evidence_note'
      ) returning id into v_fact_id;

      -- Insert Cohort Projection
      insert into public.inventory_receipt_cohorts (origin_id, current_fact_id)
      values (v_origin_id, v_fact_id);

      -- Insert Ledger Lines & Update Balances
      if v_good_qty > 0 then
        insert into public.inventory_transaction_lines (
          transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
        ) values (
          v_tx_id, v_line_no * 2 - 1, v_origin_id, v_item.id, v_loc.id, 'good', v_good_qty
        );

        insert into public.inventory_stock_balances (cohort_id, location_id, condition, quantity)
        values (v_origin_id, v_loc.id, 'good', v_good_qty)
        on conflict (cohort_id, location_id, condition)
        do update set quantity = inventory_stock_balances.quantity + v_good_qty, updated_at = clock_timestamp();
      end if;

      if v_damaged_qty > 0 then
        insert into public.inventory_transaction_lines (
          transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
        ) values (
          v_tx_id, v_line_no * 2, v_origin_id, v_item.id, v_loc.id, 'damaged', v_damaged_qty
        );

        insert into public.inventory_stock_balances (cohort_id, location_id, condition, quantity)
        values (v_origin_id, v_loc.id, 'damaged', v_damaged_qty)
        on conflict (cohort_id, location_id, condition)
        do update set quantity = inventory_stock_balances.quantity + v_damaged_qty, updated_at = clock_timestamp();
      end if;
    end loop;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
    values (v_caller_id, 'inventory.stock_received', 'inventory_receipt', v_receipt_id,
            jsonb_build_object('transaction_id', v_tx_id, 'receipt_reference', v_code));

    v_result := jsonb_build_object('transaction_id', v_tx_id, 'receipt_id', v_receipt_id);

  -- --------------------------------------------------------------------------
  -- 4.5 Opening Balance Confirmation (confirm_opening_balance)
  -- --------------------------------------------------------------------------
  elsif p_operation = 'confirm_opening_balance' then
    if not coalesce((p_payload->>'synthetic')::boolean, false) then
      raise exception 'SYNTHETIC_CUTOVER_REQUIRED: S1 opening balance must declare synthetic=true'
        using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtext('inventory_opening_scope_lock'));

    v_code := btrim(coalesce(p_payload->>'cutover_key', ''));
    if v_code = '' then raise exception 'CUTOVER_KEY_REQUIRED' using errcode = '22023'; end if;

    perform pg_advisory_xact_lock(hashtext('biz_opening:' || v_code));

    if exists (select 1 from public.inventory_opening_batches where cutover_key = v_code) then
      raise exception 'BUSINESS_DUPLICATE: Opening cutover key % already confirmed', v_code using errcode = '23505';
    end if;

    v_lines_arr := p_payload->'lines';
    if v_lines_arr is null or jsonb_array_length(v_lines_arr) = 0 then
      raise exception 'LINES_REQUIRED: Opening batch must contain lines' using errcode = '22023';
    end if;

    -- Validate duplicate natural dimensions across lines
    select count(*) into v_line_no from (
      select distinct (l->>'catalog_item_id')::uuid, (l->>'location_id')::uuid,
                      l->>'expiry_precision', private.inventory_normalize_expiry(l->>'expiry_precision', l->>'expiry_input', true),
                      btrim(coalesce(l->>'provenance_group', ''))
      from jsonb_array_elements(v_lines_arr) as l
    ) as sub;

    if v_line_no <> jsonb_array_length(v_lines_arr) then
      raise exception 'DUPLICATE_NATURAL_DIMENSIONS: Distinct lines require unique provenance groups or distinct natural dimensions'
        using errcode = '23505';
    end if;

    -- Insert Transaction Header
    insert into public.inventory_transactions (
      operation, business_key, actor_id, occurred_at, posted_at, reason
    ) values (
      'OPENING', v_code, v_caller_id, (p_payload->>'count_cutoff')::timestamptz, clock_timestamp(), p_payload->>'scope_description'
    ) returning id into v_tx_id;

    -- Insert Opening Batch
    insert into public.inventory_opening_batches (
      cutover_key, scope_description, count_cutoff, provenance_note, synthetic, transaction_id
    ) values (
      v_code, btrim(p_payload->>'scope_description'), (p_payload->>'count_cutoff')::timestamptz,
      btrim(p_payload->>'provenance_note'), true, v_tx_id
    ) returning id into v_batch_id;

    v_line_no := 0;
    for v_line in select * from jsonb_array_elements(v_lines_arr) loop
      v_line_no := v_line_no + 1;
      v_line_key := btrim(coalesce(v_line->>'line_key', ''));
      v_provenance_group := btrim(coalesce(v_line->>'provenance_group', ''));
      if v_line_key = '' or v_provenance_group = '' then
        raise exception 'LINE_KEY_AND_PROVENANCE_REQUIRED' using errcode = '22023';
      end if;

      select * into v_item from public.inventory_catalog_items where id = (v_line->>'catalog_item_id')::uuid;
      if not found or not v_item.active then
        raise exception 'INACTIVE_REFERENCE: Item not active' using errcode = '22023';
      end if;

      if v_item.tracking_strategy = 'serialized' then
        raise exception 'SERIALIZED_TRACKING_NOT_SUPPORTED' using errcode = '22023';
      end if;

      select * into v_loc from public.inventory_storage_locations where id = (v_line->>'location_id')::uuid;
      if not found or not v_loc.active then
        raise exception 'INACTIVE_REFERENCE: Location not active' using errcode = '22023';
      end if;

      -- Check opening scope collision
      if exists (
        select 1 from public.inventory_opening_scope
        where catalog_item_id = v_item.id and location_id = v_loc.id
          and opening_batch_id <> v_batch_id
      ) then
        raise exception 'OPENING_SCOPE_CONFLICT: Item % at location % already claimed by an opening batch',
          v_item.code, v_loc.code using errcode = '23505';
      end if;

      -- Insert Opening Scope Claim
      insert into public.inventory_opening_scope (opening_batch_id, catalog_item_id, location_id)
      values (v_batch_id, v_item.id, v_loc.id)
      on conflict (catalog_item_id, location_id) do nothing;

      select * into v_uom from public.inventory_uoms where code = v_item.base_uom_code;

      v_good_qty := private.inventory_validate_decimal(v_line->>'good_quantity', v_uom.allowed_scale, false);
      v_damaged_qty := private.inventory_validate_decimal(v_line->>'damaged_quantity', v_uom.allowed_scale, false);
      v_base_qty := v_good_qty + v_damaged_qty;
      if v_line ? 'base_quantity'
         and private.inventory_validate_decimal(v_line->>'base_quantity', v_uom.allowed_scale, false) <> v_base_qty then
        raise exception 'INVALID_DECIMAL: Opening base quantity must equal good plus damaged' using errcode = '22023';
      end if;

      -- Expiry validation (unknown is allowed in opening!)
      v_expiry_precision := v_line->>'expiry_precision';
      v_expiry_input := v_line->>'expiry_input';

      if v_item.material_kind = 'chemical' or v_item.expiry_required then
        if v_expiry_precision not in ('day', 'month', 'unknown') then
          raise exception 'INVALID_EXPIRY: Expiry required for chemical or expiry-required opening' using errcode = '22023';
        end if;
      end if;

      v_expiry_date := private.inventory_normalize_expiry(v_expiry_precision, v_expiry_input, true);

      -- Insert Origin
      insert into public.inventory_stock_origins (
        opening_batch_id, line_key, provenance_group, catalog_item_id
      ) values (
        v_batch_id, v_line_key, v_provenance_group, v_item.id
      ) returning id into v_origin_id;

      -- Insert Fact (version 0)
      insert into public.inventory_stock_facts (
        origin_id, version, previous_fact_id, transaction_id, location_id,
        base_uom_code, purchase_quantity, purchase_uom_code, conversion_factor,
        base_quantity, good_quantity, damaged_quantity,
        expiry_precision, expiry_input, expiry_date,
        source_snapshot, evidence_note
      ) values (
        v_origin_id, 0, null, v_tx_id, v_loc.id,
        v_item.base_uom_code, null, null, null,
        v_base_qty, v_good_qty, v_damaged_qty,
        v_expiry_precision, v_expiry_input, v_expiry_date,
        jsonb_build_object('cutover_key', v_code, 'provenance_group', v_provenance_group),
        v_line->>'evidence_note'
      ) returning id into v_fact_id;

      -- Insert Cohort Projection
      insert into public.inventory_receipt_cohorts (origin_id, current_fact_id)
      values (v_origin_id, v_fact_id);

      -- Insert Ledger Lines & Balances
      if v_good_qty > 0 then
        insert into public.inventory_transaction_lines (
          transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
        ) values (
          v_tx_id, v_line_no * 2 - 1, v_origin_id, v_item.id, v_loc.id, 'good', v_good_qty
        );

        insert into public.inventory_stock_balances (cohort_id, location_id, condition, quantity)
        values (v_origin_id, v_loc.id, 'good', v_good_qty)
        on conflict (cohort_id, location_id, condition)
        do update set quantity = inventory_stock_balances.quantity + v_good_qty, updated_at = clock_timestamp();
      end if;

      if v_damaged_qty > 0 then
        insert into public.inventory_transaction_lines (
          transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
        ) values (
          v_tx_id, v_line_no * 2, v_origin_id, v_item.id, v_loc.id, 'damaged', v_damaged_qty
        );

        insert into public.inventory_stock_balances (cohort_id, location_id, condition, quantity)
        values (v_origin_id, v_loc.id, 'damaged', v_damaged_qty)
        on conflict (cohort_id, location_id, condition)
        do update set quantity = inventory_stock_balances.quantity + v_damaged_qty, updated_at = clock_timestamp();
      end if;
    end loop;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
    values (v_caller_id, 'inventory.opening_confirmed', 'inventory_opening_batch', v_batch_id,
            jsonb_build_object('transaction_id', v_tx_id, 'cutover_key', v_code));

    v_result := jsonb_build_object('transaction_id', v_tx_id, 'opening_batch_id', v_batch_id);

  -- --------------------------------------------------------------------------
  -- 4.6 Corrections and Reversals (correct_receipt, reverse_receipt, correct_opening_balance)
  -- --------------------------------------------------------------------------
  elsif p_operation in ('correct_receipt', 'reverse_receipt', 'correct_opening_balance') then
    v_reason := btrim(coalesce(p_payload->>'reason', ''));
    if v_reason = '' then
      raise exception 'REASON_REQUIRED: Correction and reversal operations require a reason' using errcode = '22023';
    end if;

    select * into v_orig_tx from public.inventory_transactions
    where id = (p_payload->>'transaction_id')::uuid for update;
    if not found then raise exception 'TRANSACTION_NOT_FOUND' using errcode = 'P0002'; end if;

    if p_operation in ('correct_receipt', 'reverse_receipt') and v_orig_tx.operation <> 'RECEIVE' then
      raise exception 'INVALID_TRANSACTION: Target must be a RECEIVE transaction' using errcode = '22023';
    elsif p_operation = 'correct_opening_balance' and v_orig_tx.operation <> 'OPENING' then
      raise exception 'INVALID_TRANSACTION: Target must be an OPENING transaction' using errcode = '22023';
    end if;

    if p_operation = 'correct_opening_balance' then
      perform pg_advisory_xact_lock(hashtext('inventory_opening_scope_lock'));
    end if;

    -- Lock all origins of the target intake
    if v_orig_tx.operation = 'RECEIVE' then
      select id into v_receipt_id from public.inventory_receipts where transaction_id = v_orig_tx.id;
      perform 1 from public.inventory_stock_origins where receipt_id = v_receipt_id order by id for update;

      -- Check downstream dependencies (S1 guard)
      if exists (
        select 1 from public.inventory_transaction_lines tl
        join public.inventory_stock_origins o on o.id = tl.cohort_id
        where o.receipt_id = v_receipt_id
          and tl.transaction_id <> v_orig_tx.id
          and not exists (
            select 1 from public.inventory_transactions t
            where t.id = tl.transaction_id and t.corrects_transaction_id = v_orig_tx.id
          )
      ) then
        raise exception 'DEPENDENT_FACT: Cohort has downstream physical movements' using errcode = '42501';
      end if;
    else
      select id into v_batch_id from public.inventory_opening_batches where transaction_id = v_orig_tx.id;
      perform 1 from public.inventory_stock_origins where opening_batch_id = v_batch_id order by id for update;

      if exists (
        select 1 from public.inventory_transaction_lines tl
        join public.inventory_stock_origins o on o.id = tl.cohort_id
        where o.opening_batch_id = v_batch_id
          and tl.transaction_id <> v_orig_tx.id
          and not exists (
            select 1 from public.inventory_transactions t
            where t.id = tl.transaction_id and t.corrects_transaction_id = v_orig_tx.id
          )
      ) then
        raise exception 'DEPENDENT_FACT: Cohort has downstream physical movements' using errcode = '42501';
      end if;
    end if;

    -- Create Correction Transaction Header
    insert into public.inventory_transactions (
      operation, business_key, actor_id, occurred_at, posted_at, reason, corrects_transaction_id
    ) values (
      case p_operation
        when 'reverse_receipt' then 'REVERSE_RECEIPT'
        when 'correct_opening_balance' then 'CORRECT_OPENING'
        else 'CORRECT_RECEIPT'
      end,
      v_orig_tx.id::text || ':' || clock_timestamp()::text,
      v_caller_id, clock_timestamp(), clock_timestamp(), v_reason, v_orig_tx.id
    ) returning id into v_tx_id;

    v_lines_arr := coalesce(p_payload->'lines', p_payload->'versions');
    v_line_no := 0;
    if v_lines_arr is null or jsonb_typeof(v_lines_arr) <> 'array'
       or jsonb_array_length(v_lines_arr) = 0 then
      raise exception 'LINES_REQUIRED: Correction requires intended facts' using errcode = '22023';
    end if;
    if (select count(*) <> count(distinct line->>'origin_id')
        from jsonb_array_elements(v_lines_arr) as entries(line)) then
      raise exception 'INVALID_ORIGIN: Duplicate correction origin' using errcode = '22023';
    end if;
    if p_operation = 'reverse_receipt'
       and jsonb_array_length(v_lines_arr) <> (
         select count(*) from public.inventory_stock_origins where receipt_id = v_receipt_id
       ) then
      raise exception 'INVALID_ORIGIN: Reversal must include every receipt origin' using errcode = '22023';
    end if;

    for v_line in select * from jsonb_array_elements(v_lines_arr) loop
      v_origin_id := (v_line->>'origin_id')::uuid;
      v_expected_revision := (v_line->>'expected_version')::bigint;
      if v_expected_revision is null or v_expected_revision < 0 then
        raise exception 'STALE_REVISION: Expected fact version is required' using errcode = '23505';
      end if;
      if not exists (
        select 1 from public.inventory_stock_origins
        where id = v_origin_id
          and ((v_orig_tx.operation = 'RECEIVE' and receipt_id = v_receipt_id)
               or (v_orig_tx.operation = 'OPENING' and opening_batch_id = v_batch_id))
      ) then
        raise exception 'INVALID_ORIGIN: Origin does not belong to target intake' using errcode = '22023';
      end if;
      if exists (
        select 1 from public.inventory_stock_facts f
        join public.inventory_transactions t on t.id = f.transaction_id
        where f.origin_id = v_origin_id and t.operation = 'REVERSE_RECEIPT'
      ) then
        raise exception 'REVERSED_ORIGIN: Reversed receipt origin is terminal' using errcode = '22023';
      end if;

      -- Fetch and lock cohort and current fact
      select f.* into v_current_fact
      from public.inventory_receipt_cohorts c
      join public.inventory_stock_facts f on f.id = c.current_fact_id
      where c.origin_id = v_origin_id for update;

      if not found or v_current_fact.version <> v_expected_revision then
        raise exception 'STALE_REVISION: Fact version conflict for origin %. Expected %, got %',
          v_origin_id, v_expected_revision, coalesce(v_current_fact.version, -1) using errcode = '23505';
      end if;

      select * into v_item from public.inventory_catalog_items where id = (
        select catalog_item_id from public.inventory_stock_origins where id = v_origin_id
      );
      select * into v_cat from public.inventory_uoms where code = v_item.base_uom_code;

      if p_operation = 'reverse_receipt' then
        -- REVERSE_RECEIPT sets target quantities to 0 while preserving purchase UOM and factor
        v_purchase_qty := 0;
        v_factor := v_current_fact.conversion_factor;
        v_base_qty := 0;
        v_good_qty := 0;
        v_damaged_qty := 0;
        v_loc.id := v_current_fact.location_id;
        v_uom.code := v_current_fact.purchase_uom_code;
        v_expiry_precision := v_current_fact.expiry_precision;
        v_expiry_input := v_current_fact.expiry_input;
        v_expiry_date := v_current_fact.expiry_date;
      else
        -- Regular correction
        select * into v_loc from public.inventory_storage_locations where id = (v_line->>'location_id')::uuid;
        if not found or not v_loc.active then raise exception 'INACTIVE_REFERENCE: Location' using errcode = '22023'; end if;

        if v_orig_tx.operation = 'RECEIVE' then
          select * into v_uom from public.inventory_uoms where code = v_line->>'purchase_uom_code';
          if not found or not v_uom.active then
            raise exception 'INACTIVE_REFERENCE: Purchase UOM is not active' using errcode = '22023';
          end if;
          v_purchase_qty := private.inventory_validate_decimal(v_line->>'purchase_quantity', v_uom.allowed_scale, true);
          v_factor := private.inventory_validate_decimal(v_line->>'conversion_factor', 6, true);
          v_prod := v_purchase_qty * v_factor;
          if scale(trim_scale(v_prod)) > v_cat.allowed_scale then
            raise exception 'INVALID_DECIMAL: Conversion exceeds base UOM scale' using errcode = '22023';
          end if;
          v_base_qty := v_prod;
        else
          v_purchase_qty := null;
          v_uom.code := null;
          v_factor := null;
          v_base_qty := private.inventory_validate_decimal(v_line->>'good_quantity', v_cat.allowed_scale, false)
                      + private.inventory_validate_decimal(v_line->>'damaged_quantity', v_cat.allowed_scale, false);
          if v_line ? 'base_quantity'
             and private.inventory_validate_decimal(v_line->>'base_quantity', v_cat.allowed_scale, false) <> v_base_qty then
            raise exception 'INVALID_DECIMAL: Opening base quantity must equal good plus damaged' using errcode = '22023';
          end if;

          -- If opening location corrected: claim new destination in opening scope
          if v_loc.id <> v_current_fact.location_id then
            if exists (
              select 1 from public.inventory_opening_scope
              where catalog_item_id = v_item.id and location_id = v_loc.id
                and opening_batch_id <> v_batch_id
            ) then
              raise exception 'OPENING_SCOPE_CONFLICT: Destination already claimed by another batch' using errcode = '23505';
            end if;

            insert into public.inventory_opening_scope (opening_batch_id, catalog_item_id, location_id)
            values (v_batch_id, v_item.id, v_loc.id)
            on conflict (catalog_item_id, location_id) do nothing;
          end if;
        end if;

        v_good_qty := private.inventory_validate_decimal(v_line->>'good_quantity', v_cat.allowed_scale, false);
        v_damaged_qty := private.inventory_validate_decimal(v_line->>'damaged_quantity', v_cat.allowed_scale, false);

        if v_good_qty + v_damaged_qty <> v_base_qty then
          raise exception 'INVALID_DECIMAL: Good and damaged sum must equal base quantity' using errcode = '22023';
        end if;

        v_expiry_precision := coalesce(v_line->>'expiry_precision', v_current_fact.expiry_precision);
        v_expiry_input := coalesce(v_line->>'expiry_input', v_current_fact.expiry_input);
        if (v_item.material_kind = 'chemical' or v_item.expiry_required)
           and (v_expiry_precision is null or v_expiry_precision = 'not_required'
                or (v_orig_tx.operation = 'RECEIVE' and v_expiry_precision = 'unknown')) then
          raise exception 'INVALID_EXPIRY: Correction must preserve required expiry policy' using errcode = '22023';
        end if;
        v_expiry_date := private.inventory_normalize_expiry(v_expiry_precision, v_expiry_input, (v_orig_tx.operation = 'OPENING'));
        if v_orig_tx.operation = 'OPENING'
           and v_current_fact.expiry_precision = 'unknown'
           and v_expiry_precision <> 'unknown'
           and nullif(btrim(v_line->>'evidence_note'), '') is null then
          raise exception 'EVIDENCE_REQUIRED: Resolving unknown opening expiry requires evidence' using errcode = '22023';
        end if;
      end if;

      -- Insert New Fact Version
      insert into public.inventory_stock_facts (
        origin_id, version, previous_fact_id, transaction_id, location_id,
        base_uom_code, purchase_quantity, purchase_uom_code, conversion_factor,
        base_quantity, good_quantity, damaged_quantity,
        expiry_precision, expiry_input, expiry_date,
        source_snapshot, evidence_note
      ) values (
        v_origin_id, v_current_fact.version + 1, v_current_fact.id, v_tx_id, v_loc.id,
        v_item.base_uom_code, v_purchase_qty, v_uom.code, v_factor,
        v_base_qty, v_good_qty, v_damaged_qty,
        v_expiry_precision, v_expiry_input, v_expiry_date,
        v_current_fact.source_snapshot, coalesce(v_line->>'evidence_note', v_reason)
      ) returning id into v_fact_id;

      -- Update Cohort current fact pointer
      update public.inventory_receipt_cohorts
      set current_fact_id = v_fact_id
      where origin_id = v_origin_id;

      -- Calculate and Apply Balance Deltas
      if v_loc.id = v_current_fact.location_id then
        insert into public.inventory_stock_balances (cohort_id, location_id, condition, quantity)
        values (v_origin_id, v_loc.id, 'good', 0), (v_origin_id, v_loc.id, 'damaged', 0)
        on conflict (cohort_id, location_id, condition) do nothing;
        v_good_delta := v_good_qty - v_current_fact.good_quantity;
        v_damaged_delta := v_damaged_qty - v_current_fact.damaged_quantity;

        if v_good_delta <> 0 then
          v_line_no := v_line_no + 1;
          insert into public.inventory_transaction_lines (
            transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
          ) values (
            v_tx_id, v_line_no, v_origin_id, v_item.id, v_loc.id, 'good', v_good_delta
          );

          update public.inventory_stock_balances
          set quantity = quantity + v_good_delta, updated_at = clock_timestamp()
          where cohort_id = v_origin_id and location_id = v_loc.id and condition = 'good';
          if not found or (select quantity from public.inventory_stock_balances where cohort_id = v_origin_id and location_id = v_loc.id and condition = 'good') < 0 then
            raise exception 'INSUFFICIENT_ORIGIN_STOCK: Balance would become negative' using errcode = '22023';
          end if;
        end if;

        if v_damaged_delta <> 0 then
          v_line_no := v_line_no + 1;
          insert into public.inventory_transaction_lines (
            transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
          ) values (
            v_tx_id, v_line_no, v_origin_id, v_item.id, v_loc.id, 'damaged', v_damaged_delta
          );

          update public.inventory_stock_balances
          set quantity = quantity + v_damaged_delta, updated_at = clock_timestamp()
          where cohort_id = v_origin_id and location_id = v_loc.id and condition = 'damaged';
          if not found or (select quantity from public.inventory_stock_balances where cohort_id = v_origin_id and location_id = v_loc.id and condition = 'damaged') < 0 then
            raise exception 'INSUFFICIENT_ORIGIN_STOCK: Balance would become negative' using errcode = '22023';
          end if;
        end if;
      else
        -- Location changed: debit old location, credit new location
        if v_current_fact.good_quantity > 0 then
          v_line_no := v_line_no + 1;
          insert into public.inventory_transaction_lines (
            transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
          ) values (
            v_tx_id, v_line_no, v_origin_id, v_item.id, v_current_fact.location_id, 'good', -v_current_fact.good_quantity
          );
          update public.inventory_stock_balances
          set quantity = quantity - v_current_fact.good_quantity, updated_at = clock_timestamp()
          where cohort_id = v_origin_id and location_id = v_current_fact.location_id and condition = 'good';
        end if;

        if v_current_fact.damaged_quantity > 0 then
          v_line_no := v_line_no + 1;
          insert into public.inventory_transaction_lines (
            transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
          ) values (
            v_tx_id, v_line_no, v_origin_id, v_item.id, v_current_fact.location_id, 'damaged', -v_current_fact.damaged_quantity
          );
          update public.inventory_stock_balances
          set quantity = quantity - v_current_fact.damaged_quantity, updated_at = clock_timestamp()
          where cohort_id = v_origin_id and location_id = v_current_fact.location_id and condition = 'damaged';
        end if;

        if v_good_qty > 0 then
          v_line_no := v_line_no + 1;
          insert into public.inventory_transaction_lines (
            transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
          ) values (
            v_tx_id, v_line_no, v_origin_id, v_item.id, v_loc.id, 'good', v_good_qty
          );
          insert into public.inventory_stock_balances (cohort_id, location_id, condition, quantity)
          values (v_origin_id, v_loc.id, 'good', v_good_qty)
          on conflict (cohort_id, location_id, condition)
          do update set quantity = inventory_stock_balances.quantity + v_good_qty, updated_at = clock_timestamp();
        end if;

        if v_damaged_qty > 0 then
          v_line_no := v_line_no + 1;
          insert into public.inventory_transaction_lines (
            transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
          ) values (
            v_tx_id, v_line_no, v_origin_id, v_item.id, v_loc.id, 'damaged', v_damaged_qty
          );
          insert into public.inventory_stock_balances (cohort_id, location_id, condition, quantity)
          values (v_origin_id, v_loc.id, 'damaged', v_damaged_qty)
          on conflict (cohort_id, location_id, condition)
          do update set quantity = inventory_stock_balances.quantity + v_damaged_qty, updated_at = clock_timestamp();
        end if;
      end if;
    end loop;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (v_caller_id, 'inventory.stock_corrected', 'inventory_transaction', v_tx_id,
            jsonb_build_object('operation', p_operation, 'corrects', v_orig_tx.id, 'reason', v_reason));

    v_result := jsonb_build_object('transaction_id', v_tx_id);

  -- --------------------------------------------------------------------------
  -- 4.7 Opening Expiry Verification (verify_opening_expiry)
  -- --------------------------------------------------------------------------
  elsif p_operation = 'verify_opening_expiry' then
    v_origin_id := (p_payload->>'origin_id')::uuid;
    v_expected_revision := (p_payload->>'expected_version')::bigint;
    v_reason := btrim(coalesce(p_payload->>'reason', ''));
    if v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;

    select f.* into v_current_fact
    from public.inventory_receipt_cohorts c
    join public.inventory_stock_facts f on f.id = c.current_fact_id
    where c.origin_id = v_origin_id for update;

    if not found or v_current_fact.version is distinct from v_expected_revision then
      raise exception 'STALE_REVISION: Fact version conflict' using errcode = '23505';
    end if;

    if v_current_fact.expiry_precision <> 'unknown' then
      raise exception 'INVALID_EXPIRY: Only unknown expiry can be verified' using errcode = '22023';
    end if;
    if nullif(btrim(p_payload->>'evidence_note'), '') is null then
      raise exception 'EVIDENCE_REQUIRED: Verification needs an evidence note' using errcode = '22023';
    end if;

    -- Validate new precision: must be day or month
    v_expiry_precision := p_payload->>'expiry_precision';
    v_expiry_input := p_payload->>'expiry_input';
    if v_expiry_precision not in ('day', 'month') then
      raise exception 'INVALID_EXPIRY: Verification requires known precision (day or month)' using errcode = '22023';
    end if;

    v_expiry_date := private.inventory_normalize_expiry(v_expiry_precision, v_expiry_input, false);

    -- Insert CORRECT_OPENING transaction
    insert into public.inventory_transactions (
      operation, business_key, actor_id, occurred_at, posted_at, reason, corrects_transaction_id
    ) values (
      'CORRECT_OPENING', 'verify_expiry:' || v_origin_id::text || ':' || clock_timestamp()::text,
      v_caller_id, clock_timestamp(), clock_timestamp(), v_reason, v_current_fact.transaction_id
    ) returning id into v_tx_id;

    -- Insert Fact Version (Zero stock delta)
    insert into public.inventory_stock_facts (
      origin_id, version, previous_fact_id, transaction_id, location_id,
      base_uom_code, purchase_quantity, purchase_uom_code, conversion_factor,
      base_quantity, good_quantity, damaged_quantity,
      expiry_precision, expiry_input, expiry_date,
      source_snapshot, evidence_note
    ) values (
      v_origin_id, v_current_fact.version + 1, v_current_fact.id, v_tx_id, v_current_fact.location_id,
      v_current_fact.base_uom_code, null, null, null,
      v_current_fact.base_quantity, v_current_fact.good_quantity, v_current_fact.damaged_quantity,
      v_expiry_precision, v_expiry_input, v_expiry_date,
      v_current_fact.source_snapshot, coalesce(p_payload->>'evidence_note', v_reason)
    ) returning id into v_fact_id;

    -- Update Cohort pointer
    update public.inventory_receipt_cohorts
    set current_fact_id = v_fact_id
    where origin_id = v_origin_id;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (v_caller_id, 'inventory.opening_expiry_verified', 'inventory_stock_fact', v_fact_id,
            jsonb_build_object('origin_id', v_origin_id, 'evidence_note', p_payload->>'evidence_note', 'reason', v_reason));

    v_result := jsonb_build_object('transaction_id', v_tx_id, 'fact_id', v_fact_id);

  else
    raise exception 'UNKNOWN_OPERATION: Operation % is not supported', p_operation using errcode = '22023';
  end if;

  -- 5. Record Replay & Return Result
  insert into public.inventory_operation_replays (
    actor_id, operation, retry_key, payload_hash, result_ids, committed_at
  ) values (
    v_caller_id, p_operation, p_retry_key, v_payload_hash, v_result, clock_timestamp()
  );

  return v_result;
end;
$$;
