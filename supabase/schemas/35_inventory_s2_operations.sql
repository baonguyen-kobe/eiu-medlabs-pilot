-- ============================================================================
-- S2 INVENTORY OPERATIONS SCHEMA (DECLARATIVE)
-- Canonical References:
-- - plans/G0_S1_DESIGN_FREEZE_PACK.md
-- - plans/G0_S1_OPERATIONS.md
-- - DECISION_LOG.md (INV-050)
-- ============================================================================
-- 1. EXTEND INVENTORY TRANSACTIONS OPERATION CHECK
alter table public.inventory_transactions
  drop constraint if exists inventory_transactions_operation_valid;

alter table public.inventory_transactions
  add constraint inventory_transactions_operation_valid check (
    operation in (
      'RECEIVE', 'OPENING', 'CORRECT_RECEIPT', 'REVERSE_RECEIPT', 'CORRECT_OPENING',
      'TRANSFER', 'CONDITION_CHANGE', 'STOCKTAKE_ADJUST', 'STOCKTAKE_SURPLUS', 'VERIFY_SURPLUS'
    )
  );

-- 2. ADD MONOTONIC STOCK REVISION TO COHORTS
alter table public.inventory_receipt_cohorts
  add column if not exists revision bigint not null default 1;

-- 3. CREATE STOCKTAKE SURPLUS RECORDS TABLE
create table if not exists public.inventory_stocktake_surplus_records (
  id uuid primary key default gen_random_uuid(),
  surplus_reference text not null unique,
  transaction_id uuid not null references public.inventory_transactions(id) on delete restrict,
  catalog_item_id uuid not null references public.inventory_catalog_items(id) on delete restrict,
  initial_location_id uuid not null references public.inventory_storage_locations(id) on delete restrict,
  initial_condition text not null check (initial_condition in ('good', 'damaged')),
  initial_quantity numeric(18,6) not null check (initial_quantity > 0),
  counted_by_id uuid not null references public.profiles(id) on delete restrict,
  counted_at timestamptz not null,
  reason text not null check (btrim(reason) <> ''),
  evidence_note text not null check (btrim(evidence_note) <> ''),
  status text not null default 'held' check (status in ('held', 'released')),
  verified_by_id uuid references public.profiles(id) on delete restrict,
  verified_at timestamptz,
  verification_reason text,
  verification_evidence_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_stocktake_surplus_ref_not_blank check (btrim(surplus_reference) <> '')
);

-- Guard surplus record immutability
create or replace function private.guard_inventory_surplus_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'TABLE_IMMUTABLE: Surplus records cannot be deleted' using errcode = '42501';
  elsif tg_op = 'UPDATE' then
    if new.id <> old.id or new.transaction_id <> old.transaction_id or
       new.surplus_reference <> old.surplus_reference or
       new.catalog_item_id <> old.catalog_item_id or
       new.initial_location_id <> old.initial_location_id or
       new.initial_condition <> old.initial_condition or
       new.initial_quantity <> old.initial_quantity or
       new.counted_by_id <> old.counted_by_id or
       new.counted_at <> old.counted_at or
       new.reason <> old.reason or
       new.evidence_note <> old.evidence_note then
      raise exception 'SURPLUS_RECORD_IMMUTABLE: Initial intake fields of surplus record cannot be modified' using errcode = '42501';
    end if;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_surplus_mutation on public.inventory_stocktake_surplus_records;
create trigger trg_guard_surplus_mutation
before update or delete on public.inventory_stocktake_surplus_records
for each row execute function private.guard_inventory_surplus_mutation();

-- 4. EXTEND INVENTORY STOCK ORIGINS FOR SURPLUS PROVENANCE
alter table public.inventory_stock_origins
  add column if not exists surplus_id uuid references public.inventory_stocktake_surplus_records(id) on delete restrict;

alter table public.inventory_stock_origins
  drop constraint if exists inventory_stock_origins_one_intake;

alter table public.inventory_stock_origins
  add constraint inventory_stock_origins_one_intake check (
    (receipt_id is not null and opening_batch_id is null and surplus_id is null) or
    (receipt_id is null and opening_batch_id is not null and surplus_id is null) or
    (receipt_id is null and opening_batch_id is null and surplus_id is not null)
  );

alter table public.inventory_stock_origins
  drop constraint if exists inventory_stock_origins_unique_surplus_line;

alter table public.inventory_stock_origins
  add constraint inventory_stock_origins_unique_surplus_line unique (surplus_id, line_key);

create index if not exists idx_stock_origins_surplus on public.inventory_stock_origins(surplus_id);

-- 5. CREATE INVENTORY STOCK HOLDS TABLE
create table if not exists public.inventory_stock_holds (
  origin_id uuid primary key references public.inventory_stock_origins(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'released')),
  hold_reason text not null check (btrim(hold_reason) <> ''),
  placed_by_id uuid not null references public.profiles(id) on delete restrict,
  placed_at timestamptz not null default now(),
  released_by_id uuid references public.profiles(id) on delete restrict,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.guard_inventory_hold_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'TABLE_IMMUTABLE: Hold records cannot be deleted' using errcode = '42501';
  elsif tg_op = 'UPDATE' then
    if new.origin_id <> old.origin_id then
      raise exception 'HOLD_ORIGIN_IMMUTABLE: Hold origin_id cannot be modified' using errcode = '42501';
    end if;
    if old.status = 'released' and new.status <> old.status then
      raise exception 'HOLD_TERMINAL: Released holds cannot be modified' using errcode = '42501';
    end if;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_hold_mutation on public.inventory_stock_holds;
create trigger trg_guard_hold_mutation
before update or delete on public.inventory_stock_holds
for each row execute function private.guard_inventory_hold_mutation();

-- 6. CREATE IMMUTABLE INVENTORY STOCK EVIDENCE TABLE
create table if not exists public.inventory_stock_evidence (
  id uuid primary key default gen_random_uuid(),
  origin_id uuid not null references public.inventory_stock_origins(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (btrim(action) <> ''),
  note text not null check (btrim(note) <> ''),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

drop trigger if exists trg_prevent_stock_evidence_mutation on public.inventory_stock_evidence;
create trigger trg_prevent_stock_evidence_mutation
before update or delete on public.inventory_stock_evidence
for each row execute function private.prevent_inventory_history_mutation();

create index if not exists idx_stock_evidence_origin on public.inventory_stock_evidence(origin_id, created_at desc);

-- 7. SECURITY & PERMISSIONS ON NEW TABLES (S1 PARITY)
alter table public.inventory_stocktake_surplus_records enable row level security;
alter table public.inventory_stock_holds enable row level security;
alter table public.inventory_stock_evidence enable row level security;

drop policy if exists inventory_stocktake_surplus_records_select on public.inventory_stocktake_surplus_records;
create policy inventory_stocktake_surplus_records_select on public.inventory_stocktake_surplus_records
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_stock_holds_select on public.inventory_stock_holds;
create policy inventory_stock_holds_select on public.inventory_stock_holds
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_stock_evidence_select on public.inventory_stock_evidence;
create policy inventory_stock_evidence_select on public.inventory_stock_evidence
for select to authenticated using ((select private.can_access_inventory()));

revoke insert, update, delete on table
  public.inventory_stocktake_surplus_records,
  public.inventory_stock_holds,
  public.inventory_stock_evidence
from public, anon, authenticated;

grant select on table
  public.inventory_stocktake_surplus_records,
  public.inventory_stock_holds,
  public.inventory_stock_evidence
to authenticated;


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


  -- S2 Physical Operations Working Variables
  v_source_loc_id uuid;
  v_target_loc_id uuid;
  v_loc_id uuid;
  v_source_loc public.inventory_storage_locations%rowtype;
  v_target_loc public.inventory_storage_locations%rowtype;
  v_from_condition text;
  v_to_condition text;
  v_condition text;
  v_qty numeric(18,6);
  v_current_balance numeric(18,6);
  v_catalog_item_id uuid;
  v_item_id uuid;
  v_allowed_scale smallint;
  v_stocktake_ref text;
  v_count_timestamp timestamptz;
  v_evidence_note text;
  v_counted_qty numeric(18,6);
  v_expected_qty numeric(18,6);
  v_expected_fact_version bigint;
  v_expected_stock_revision bigint;
  v_cohort_revision bigint;
  v_delta numeric(18,6);
  v_surplus_ref text;
  v_surplus_id uuid;
  v_new_origin_id uuid;
  v_new_fact_id uuid;
  v_seen_keys text[] := '{}';
  v_count_key text;
  v_action text;
  v_hold public.inventory_stock_holds%rowtype;
  v_origin_info record;
  v_surplus_origins jsonb := '[]'::jsonb;
  v_distinct_cohort_ids uuid[] := '{}';

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
    'verify_stocktake_surplus',
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
      insert into public.inventory_receipt_cohorts (origin_id, current_fact_id, revision)
      values (v_origin_id, v_fact_id, 1);

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
      perform private.p1_real_opening(p_payload);
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
      btrim(p_payload->>'provenance_note'), (p_payload->>'synthetic')::boolean, v_tx_id
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
      insert into public.inventory_receipt_cohorts (origin_id, current_fact_id, revision)
      values (v_origin_id, v_fact_id, 1);

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

      -- Check downstream dependencies (S1 guard extended for count evidence)
      if exists (
        select 1 from public.inventory_transaction_lines tl
        join public.inventory_stock_origins o on o.id = tl.cohort_id
        where o.receipt_id = v_receipt_id
          and tl.transaction_id <> v_orig_tx.id
          and not exists (
            select 1 from public.inventory_transactions t
            where t.id = tl.transaction_id and t.corrects_transaction_id = v_orig_tx.id
          )
      ) or exists (
        select 1 from public.inventory_stock_evidence ev
        join public.inventory_stock_origins o on o.id = ev.origin_id
        where o.receipt_id = v_receipt_id
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
      ) or exists (
        select 1 from public.inventory_stock_evidence ev
        join public.inventory_stock_origins o on o.id = ev.origin_id
        where o.opening_batch_id = v_batch_id
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
      set current_fact_id = v_fact_id, revision = revision + 1, updated_at = clock_timestamp()
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
    set current_fact_id = v_fact_id, revision = revision + 1, updated_at = clock_timestamp()
    where origin_id = v_origin_id;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (v_caller_id, 'inventory.opening_expiry_verified', 'inventory_stock_fact', v_fact_id,
            jsonb_build_object('origin_id', v_origin_id, 'evidence_note', p_payload->>'evidence_note', 'reason', v_reason));

    v_result := jsonb_build_object('transaction_id', v_tx_id, 'fact_id', v_fact_id);


  -- --------------------------------------------------------------------------
  -- 4.11 S2 Physical Operation: Transfer Stock (transfer_stock)
  -- --------------------------------------------------------------------------
  elsif p_operation = 'transfer_stock' then
    v_source_loc_id := (p_payload->>'source_location_id')::uuid;
    v_target_loc_id := (p_payload->>'target_location_id')::uuid;
    v_reason := btrim(coalesce(p_payload->>'reason', 'Stock transfer'));

    if v_source_loc_id is null or v_target_loc_id is null then
      raise exception 'INVALID_TRANSFER: Source and target locations are required' using errcode = '22023';
    end if;

    if v_source_loc_id = v_target_loc_id then
      raise exception 'INVALID_TRANSFER: Source and target locations must be distinct' using errcode = '22023';
    end if;

    select * into v_source_loc from public.inventory_storage_locations where id = v_source_loc_id;
    if not found or not v_source_loc.active then
      raise exception 'INACTIVE_REFERENCE: Source location not found or inactive' using errcode = '22023';
    end if;

    select * into v_target_loc from public.inventory_storage_locations where id = v_target_loc_id;
    if not found or not v_target_loc.active then
      raise exception 'INACTIVE_REFERENCE: Target location not found or inactive' using errcode = '22023';
    end if;

    v_lines_arr := p_payload->'lines';
    if v_lines_arr is null or jsonb_typeof(v_lines_arr) <> 'array' or jsonb_array_length(v_lines_arr) = 0 then
      raise exception 'EMPTY_LINES: Transfer requires at least one line' using errcode = '22023';
    end if;

    -- Create TRANSFER Transaction
    insert into public.inventory_transactions (
      operation, business_key, actor_id, occurred_at, posted_at, reason
    ) values (
      'TRANSFER', 'transfer:' || p_retry_key::text,
      v_caller_id,
      coalesce((p_payload->>'occurred_at')::timestamptz, clock_timestamp()),
      clock_timestamp(),
      v_reason
    ) returning id into v_tx_id;

    v_line_no := 0;
    v_distinct_cohort_ids := '{}';

    for i in 0 .. jsonb_array_length(v_lines_arr) - 1 loop
      v_line := v_lines_arr->i;
      v_origin_id := (v_line->>'origin_id')::uuid;
      v_expected_fact_version := (v_line->>'expected_version')::bigint;
      v_expected_stock_revision := (v_line->>'expected_stock_revision')::bigint;
      v_condition := v_line->>'condition';

      if v_origin_id is null then
        raise exception 'INVALID_LINE: Origin id is required' using errcode = '22023';
      end if;

      if v_expected_fact_version is null or v_expected_fact_version < 0 then
        raise exception 'STALE_REVISION: Expected version is required' using errcode = '23505';
      end if;

      if v_expected_stock_revision is null or v_expected_stock_revision < 0 then
        raise exception 'STALE_REVISION: Expected stock revision is required' using errcode = '23505';
      end if;

      if v_condition not in ('good', 'damaged') then
        raise exception 'INVALID_LINE: Condition must be good or damaged' using errcode = '22023';
      end if;

      -- Validate every line against the unchanged pre-command cohort revision.
        select f.*, c.revision as stock_revision into v_current_fact
        from public.inventory_receipt_cohorts c
        join public.inventory_stock_facts f on f.id = c.current_fact_id
        where c.origin_id = v_origin_id
        for update;

        if not found then
          raise exception 'COHORT_NOT_FOUND: Cohort % not found', v_origin_id using errcode = 'P0002';
        end if;

        v_cohort_revision := v_current_fact.stock_revision;

        if v_current_fact.version <> v_expected_fact_version then
          raise exception 'STALE_REVISION: Cohort fact version conflict. Expected %, got %',
            v_expected_fact_version, v_current_fact.version using errcode = '23505';
        end if;

        if v_cohort_revision <> v_expected_stock_revision then
          raise exception 'STALE_REVISION: Cohort stock revision conflict. Expected %, got %',
            v_expected_stock_revision, v_cohort_revision using errcode = '23505';
        end if;

      if not (v_origin_id = any(v_distinct_cohort_ids)) then
        v_distinct_cohort_ids := array_append(v_distinct_cohort_ids, v_origin_id);
      end if;

      -- Look up item and scale into explicit scalar
      select o.catalog_item_id, u.allowed_scale into v_catalog_item_id, v_allowed_scale
      from public.inventory_stock_origins o
      join public.inventory_catalog_items i on i.id = o.catalog_item_id
      join public.inventory_uoms u on u.code = i.base_uom_code
      where o.id = v_origin_id;

      v_qty := private.inventory_validate_decimal(v_line->>'quantity', v_allowed_scale, true);

      -- Lock and verify source balance
      select quantity into v_current_balance
      from public.inventory_stock_balances
      where cohort_id = v_origin_id
        and location_id = v_source_loc_id
        and condition = v_condition
      for update;

      if not found or v_current_balance < v_qty then
        raise exception 'INSUFFICIENT_STOCK: Insufficient % stock for transfer. Available %, requested %',
          v_condition, coalesce(v_current_balance, 0), v_qty using errcode = '22023';
      end if;

      v_line_no := v_line_no + 1;
      -- Debit line at source
      insert into public.inventory_transaction_lines (
        transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
      ) values (
        v_tx_id, v_line_no * 2 - 1, v_origin_id, v_catalog_item_id, v_source_loc_id, v_condition, -v_qty
      );

      update public.inventory_stock_balances
      set quantity = quantity - v_qty, updated_at = clock_timestamp()
      where cohort_id = v_origin_id
        and location_id = v_source_loc_id
        and condition = v_condition;

      -- Credit line at target
      insert into public.inventory_transaction_lines (
        transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
      ) values (
        v_tx_id, v_line_no * 2, v_origin_id, v_catalog_item_id, v_target_loc_id, v_condition, v_qty
      );

      insert into public.inventory_stock_balances (cohort_id, location_id, condition, quantity)
      values (v_origin_id, v_target_loc_id, v_condition, v_qty)
      on conflict (cohort_id, location_id, condition)
      do update set quantity = inventory_stock_balances.quantity + v_qty, updated_at = clock_timestamp();
    end loop;

    -- Defer monotonic revision bump: increment once per distinct cohort after all batch lines succeed
    update public.inventory_receipt_cohorts
    set revision = revision + 1, updated_at = clock_timestamp()
    where origin_id = any(v_distinct_cohort_ids);

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
    values (v_caller_id, 'inventory.stock_transferred', 'inventory_transaction', v_tx_id, p_payload);

    v_result := jsonb_build_object('transaction_id', v_tx_id);

  -- --------------------------------------------------------------------------
  -- 4.12 S2 Physical Operation: Change Stock Condition (change_stock_condition)
  -- --------------------------------------------------------------------------
  elsif p_operation = 'change_stock_condition' then
    v_loc_id := (p_payload->>'location_id')::uuid;
    v_reason := btrim(coalesce(p_payload->>'reason', ''));

    if v_loc_id is null then
      raise exception 'INVALID_PAYLOAD: Location id is required' using errcode = '22023';
    end if;

    if v_reason = '' then
      raise exception 'REASON_REQUIRED: Reason is required for condition change' using errcode = '22023';
    end if;

    select * into v_loc from public.inventory_storage_locations where id = v_loc_id;
    if not found or not v_loc.active then
      raise exception 'INACTIVE_REFERENCE: Location not found or inactive' using errcode = '22023';
    end if;

    v_lines_arr := p_payload->'lines';
    if v_lines_arr is null or jsonb_typeof(v_lines_arr) <> 'array' or jsonb_array_length(v_lines_arr) = 0 then
      raise exception 'EMPTY_LINES: Condition change requires at least one line' using errcode = '22023';
    end if;

    -- Create CONDITION_CHANGE Transaction
    insert into public.inventory_transactions (
      operation, business_key, actor_id, occurred_at, posted_at, reason
    ) values (
      'CONDITION_CHANGE', 'condition_change:' || p_retry_key::text,
      v_caller_id,
      coalesce((p_payload->>'occurred_at')::timestamptz, clock_timestamp()),
      clock_timestamp(),
      v_reason
    ) returning id into v_tx_id;

    v_line_no := 0;
    v_distinct_cohort_ids := '{}';

    for i in 0 .. jsonb_array_length(v_lines_arr) - 1 loop
      v_line := v_lines_arr->i;
      v_origin_id := (v_line->>'origin_id')::uuid;
      v_expected_fact_version := (v_line->>'expected_version')::bigint;
      v_expected_stock_revision := (v_line->>'expected_stock_revision')::bigint;
      v_from_condition := v_line->>'from_condition';
      v_to_condition := v_line->>'to_condition';

      if v_origin_id is null then
        raise exception 'INVALID_LINE: Origin id is required' using errcode = '22023';
      end if;

      if v_expected_fact_version is null or v_expected_fact_version < 0 then
        raise exception 'STALE_REVISION: Expected version is required' using errcode = '23505';
      end if;

      if v_expected_stock_revision is null or v_expected_stock_revision < 0 then
        raise exception 'STALE_REVISION: Expected stock revision is required' using errcode = '23505';
      end if;

      -- Check Repair Exclusion: only good -> damaged is allowed in V1
      if v_from_condition <> 'good' or v_to_condition <> 'damaged' then
        raise exception 'REPAIR_EXCLUDED: Only good to damaged condition change is permitted in V1 (repair excluded)'
          using errcode = '22023';
      end if;

      -- Lock Cohort and verify monotonic stock revision and fact version against pre-command state
        select f.*, c.revision as stock_revision into v_current_fact
        from public.inventory_receipt_cohorts c
        join public.inventory_stock_facts f on f.id = c.current_fact_id
        where c.origin_id = v_origin_id
        for update;

        if not found then
          raise exception 'COHORT_NOT_FOUND: Cohort % not found', v_origin_id using errcode = 'P0002';
        end if;

        v_cohort_revision := v_current_fact.stock_revision;

        if v_current_fact.version <> v_expected_fact_version then
          raise exception 'STALE_REVISION: Cohort fact version conflict. Expected %, got %',
            v_expected_fact_version, v_current_fact.version using errcode = '23505';
        end if;

        if v_cohort_revision <> v_expected_stock_revision then
          raise exception 'STALE_REVISION: Cohort stock revision conflict. Expected %, got %',
            v_expected_stock_revision, v_cohort_revision using errcode = '23505';
        end if;

      if not (v_origin_id = any(v_distinct_cohort_ids)) then
        v_distinct_cohort_ids := array_append(v_distinct_cohort_ids, v_origin_id);
      end if;

      -- Look up item and scale into explicit scalar
      select o.catalog_item_id, u.allowed_scale into v_catalog_item_id, v_allowed_scale
      from public.inventory_stock_origins o
      join public.inventory_catalog_items i on i.id = o.catalog_item_id
      join public.inventory_uoms u on u.code = i.base_uom_code
      where o.id = v_origin_id;

      v_qty := private.inventory_validate_decimal(v_line->>'quantity', v_allowed_scale, true);

      -- Lock and verify good balance
      select quantity into v_current_balance
      from public.inventory_stock_balances
      where cohort_id = v_origin_id
        and location_id = v_loc_id
        and condition = 'good'
      for update;

      if not found or v_current_balance < v_qty then
        raise exception 'INSUFFICIENT_STOCK: Insufficient good stock for condition change. Available %, requested %',
          coalesce(v_current_balance, 0), v_qty using errcode = '22023';
      end if;

      v_line_no := v_line_no + 1;
      -- Debit good
      insert into public.inventory_transaction_lines (
        transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
      ) values (
        v_tx_id, v_line_no * 2 - 1, v_origin_id, v_catalog_item_id, v_loc_id, 'good', -v_qty
      );

      update public.inventory_stock_balances
      set quantity = quantity - v_qty, updated_at = clock_timestamp()
      where cohort_id = v_origin_id
        and location_id = v_loc_id
        and condition = 'good';

      -- Credit damaged
      insert into public.inventory_transaction_lines (
        transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
      ) values (
        v_tx_id, v_line_no * 2, v_origin_id, v_catalog_item_id, v_loc_id, 'damaged', v_qty
      );

      insert into public.inventory_stock_balances (cohort_id, location_id, condition, quantity)
      values (v_origin_id, v_loc_id, 'damaged', v_qty)
      on conflict (cohort_id, location_id, condition)
      do update set quantity = inventory_stock_balances.quantity + v_qty, updated_at = clock_timestamp();
    end loop;

    -- Defer monotonic revision bump
    update public.inventory_receipt_cohorts
    set revision = revision + 1, updated_at = clock_timestamp()
    where origin_id = any(v_distinct_cohort_ids);

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
    values (v_caller_id, 'inventory.stock_condition_changed', 'inventory_transaction', v_tx_id, p_payload);

    v_result := jsonb_build_object('transaction_id', v_tx_id);

  -- --------------------------------------------------------------------------
  -- 4.13 S2 Physical Operation: Reconcile Stocktake (reconcile_stocktake)
  -- --------------------------------------------------------------------------
  elsif p_operation = 'reconcile_stocktake' then
    v_stocktake_ref := btrim(coalesce(p_payload->>'stocktake_reference', ''));
    if v_stocktake_ref = '' then
      raise exception 'STOCKTAKE_REFERENCE_REQUIRED: Stocktake reference is required' using errcode = '22023';
    end if;

    v_loc_id := (p_payload->>'location_id')::uuid;
    v_count_timestamp := (p_payload->>'count_timestamp')::timestamptz;
    v_reason := btrim(coalesce(p_payload->>'reason', ''));
    v_evidence_note := btrim(coalesce(p_payload->>'evidence_note', ''));

    if v_loc_id is null then
      raise exception 'INVALID_PAYLOAD: Location id is required' using errcode = '22023';
    end if;

    if v_count_timestamp is null then
      raise exception 'INVALID_PAYLOAD: Count timestamp is required' using errcode = '22023';
    end if;

    if v_reason = '' then
      raise exception 'REASON_REQUIRED: Reason is required for stocktake reconciliation' using errcode = '22023';
    end if;

    if v_evidence_note = '' then
      raise exception 'EVIDENCE_REQUIRED: Evidence note is required for stocktake reconciliation' using errcode = '22023';
    end if;

    select * into v_loc from public.inventory_storage_locations where id = v_loc_id;
    if not found or not v_loc.active then
      raise exception 'INACTIVE_REFERENCE: Location not found or inactive' using errcode = '22023';
    end if;

    v_lines_arr := p_payload->'lines';
    if v_lines_arr is null or jsonb_typeof(v_lines_arr) <> 'array' or jsonb_array_length(v_lines_arr) = 0 then
      raise exception 'EMPTY_LINES: Stocktake reconciliation requires at least one line' using errcode = '22023';
    end if;

    -- Check repeat count semantic uniqueness across counted cohort lines
    -- Canonicalize UUID string so case cannot bypass uniqueness
    v_seen_keys := '{}';
    for i in 0 .. jsonb_array_length(v_lines_arr) - 1 loop
      v_line := v_lines_arr->i;
      if v_line ? 'origin_id' and (v_line->>'origin_id') is not null then
        v_origin_id := (v_line->>'origin_id')::uuid;
        v_condition := coalesce(v_line->>'condition', 'good');
        v_count_key := lower(v_origin_id::text) || ':' || v_condition;
        if v_count_key = any(v_seen_keys) then
          raise exception 'DUPLICATE_COUNT_LINE: Repeat count for the same cohort and condition in one stocktake is not permitted'
            using errcode = '23505';
        end if;
        v_seen_keys := array_append(v_seen_keys, v_count_key);
      end if;
    end loop;

    -- Create STOCKTAKE_ADJUST Transaction with unique business key derived from stocktake_reference
    if exists (
      select 1 from public.inventory_transactions
      where operation = 'STOCKTAKE_ADJUST' and business_key = 'stocktake:' || v_stocktake_ref
    ) then
      raise exception 'BUSINESS_DUPLICATE: Stocktake % already posted', v_stocktake_ref using errcode = '23505';
    end if;

    insert into public.inventory_transactions (
      operation, business_key, actor_id, occurred_at, posted_at, reason
    ) values (
      'STOCKTAKE_ADJUST', 'stocktake:' || v_stocktake_ref,
      v_caller_id, v_count_timestamp, clock_timestamp(), v_reason
    ) returning id into v_tx_id;

    v_line_no := 0;
    v_surplus_origins := '[]'::jsonb;
    v_distinct_cohort_ids := '{}';

    for i in 0 .. jsonb_array_length(v_lines_arr) - 1 loop
      v_line := v_lines_arr->i;

      -- Determine line kind: Existing Cohort Adjustment vs Unprovenanced Surplus
      if v_line ? 'origin_id' and (v_line->>'origin_id') is not null then
        -- --------------------------------------------------------------------
        -- Line Kind 1: Existing Cohort Count / Adjustment
        -- --------------------------------------------------------------------
        v_origin_id := (v_line->>'origin_id')::uuid;
        v_expected_fact_version := (v_line->>'expected_version')::bigint;
        v_expected_stock_revision := (v_line->>'expected_stock_revision')::bigint;
        v_condition := coalesce(v_line->>'condition', 'good');

        if v_expected_fact_version is null or v_expected_fact_version < 0 then
          raise exception 'STALE_REVISION: Expected version is required for cohort count' using errcode = '23505';
        end if;

        if v_expected_stock_revision is null or v_expected_stock_revision < 0 then
          raise exception 'STALE_REVISION: Expected stock revision is required for cohort count' using errcode = '23505';
        end if;

        if v_condition not in ('good', 'damaged') then
          raise exception 'INVALID_LINE: Condition must be good or damaged' using errcode = '22023';
        end if;

        -- Mandatory expected_quantity check BEFORE delta calculation
        if not (v_line ? 'expected_quantity') or (v_line->>'expected_quantity') is null then
          raise exception 'EXPECTED_QUANTITY_REQUIRED: Expected quantity is mandatory for count reconciliation' using errcode = '22023';
        end if;

        -- Lock cohort fact and verify monotonic revision and fact version against pre-command state
          select f.*, c.revision as stock_revision into v_current_fact
          from public.inventory_receipt_cohorts c
          join public.inventory_stock_facts f on f.id = c.current_fact_id
          where c.origin_id = v_origin_id
          for update;

          if not found then
            raise exception 'COHORT_NOT_FOUND: Cohort % not found', v_origin_id using errcode = 'P0002';
          end if;

          v_cohort_revision := v_current_fact.stock_revision;

          if v_current_fact.version <> v_expected_fact_version then
            raise exception 'STALE_REVISION: Cohort fact version conflict. Expected %, got %',
              v_expected_fact_version, v_current_fact.version using errcode = '23505';
          end if;

          if v_cohort_revision <> v_expected_stock_revision then
            raise exception 'STALE_REVISION: Cohort stock revision conflict. Expected %, got %',
              v_expected_stock_revision, v_cohort_revision using errcode = '23505';
          end if;

        if not (v_origin_id = any(v_distinct_cohort_ids)) then
          v_distinct_cohort_ids := array_append(v_distinct_cohort_ids, v_origin_id);
        end if;

        -- Look up item and scale into explicit scalar
        select o.catalog_item_id, u.allowed_scale into v_item_id, v_allowed_scale
        from public.inventory_stock_origins o
        join public.inventory_catalog_items i on i.id = o.catalog_item_id
        join public.inventory_uoms u on u.code = i.base_uom_code
        where o.id = v_origin_id;

        v_expected_qty := private.inventory_validate_decimal(v_line->>'expected_quantity', v_allowed_scale, false);
        v_counted_qty := private.inventory_validate_decimal(v_line->>'counted_quantity', v_allowed_scale, false);

        -- Lock balance row at location
        select quantity into v_current_balance
        from public.inventory_stock_balances
        where cohort_id = v_origin_id
          and location_id = v_loc_id
          and condition = v_condition
        for update;

        if not found then v_current_balance := 0; end if;

        -- Validate stale before computing delta
        if v_current_balance <> v_expected_qty then
          raise exception 'STALE_STOCK_STATE: Expected quantity % does not match current balance % for cohort %',
            v_expected_qty, v_current_balance, v_origin_id using errcode = '23505';
        end if;

        -- Calculate server-derived delta
        v_delta := v_counted_qty - v_current_balance;

        if v_delta <> 0 then
          v_line_no := v_line_no + 1;
          insert into public.inventory_transaction_lines (
            transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
          ) values (
            v_tx_id, v_line_no, v_origin_id, v_item_id, v_loc_id, v_condition, v_delta
          );

          insert into public.inventory_stock_balances (cohort_id, location_id, condition, quantity)
          values (v_origin_id, v_loc_id, v_condition, v_counted_qty)
          on conflict (cohort_id, location_id, condition)
          do update set quantity = v_counted_qty, updated_at = clock_timestamp();
        end if;

        -- Always record count evidence (including zero delta) with complete server-validated metadata
        insert into public.inventory_stock_evidence (
          origin_id, actor_id, action, note, metadata
        ) values (
          v_origin_id, v_caller_id, 'STOCKTAKE_COUNT_ADJUST',
          coalesce(v_line->>'evidence_note', v_evidence_note),
          jsonb_build_object(
            'expected_quantity', v_expected_qty::text,
            'counted_quantity', v_counted_qty::text,
            'delta', v_delta::text,
            'condition', v_condition,
            'stocktake_reference', v_stocktake_ref,
            'location_id', v_loc_id,
            'count_timestamp', v_count_timestamp,
            'transaction_id', v_tx_id,
            'expected_version', v_expected_fact_version,
            'expected_stock_revision', v_expected_stock_revision
          )
        );

      else
        -- --------------------------------------------------------------------
        -- Line Kind 2: Unprovenanced Surplus (STOCKTAKE_SURPLUS)
        -- --------------------------------------------------------------------
        v_item_id := (v_line->>'catalog_item_id')::uuid;
        if v_item_id is null then
          raise exception 'INVALID_LINE: Catalog item id is required for surplus line' using errcode = '22023';
        end if;

        select i.*, u.allowed_scale into v_item
        from public.inventory_catalog_items i
        join public.inventory_uoms u on u.code = i.base_uom_code
        where i.id = v_item_id;

        if not found or not v_item.active then
          raise exception 'INACTIVE_REFERENCE: Catalog item not found or inactive' using errcode = '22023';
        end if;

        v_condition := coalesce(v_line->>'condition', 'good');
        if v_condition not in ('good', 'damaged') then
          raise exception 'INVALID_LINE: Condition must be good or damaged' using errcode = '22023';
        end if;

        v_counted_qty := private.inventory_validate_decimal(v_line->>'counted_quantity', v_item.allowed_scale, true);

        -- Expiry handling for surplus:
        if v_item.expiry_required then
          v_expiry_precision := coalesce(v_line->>'expiry_precision', 'unknown');
          if v_expiry_precision not in ('day', 'month', 'unknown') then
            raise exception 'INVALID_EXPIRY: Expiry precision must be day, month, or unknown' using errcode = '22023';
          end if;
          if v_expiry_precision in ('day', 'month') then
            v_expiry_input := v_line->>'expiry_input';
            v_expiry_date := private.inventory_normalize_expiry(v_expiry_precision, v_expiry_input, false);
          else
            v_expiry_input := null;
            v_expiry_date := null;
          end if;
        else
          v_expiry_precision := 'not_required';
          v_expiry_input := null;
          v_expiry_date := null;
        end if;

        -- Generate unique surplus reference
        v_surplus_ref := 'SURPLUS-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' || substr(extensions.gen_random_uuid()::text, 1, 6);

        -- Create Surplus Record (status held)
        insert into public.inventory_stocktake_surplus_records (
          surplus_reference, transaction_id, catalog_item_id, initial_location_id, initial_condition,
          initial_quantity, counted_by_id, counted_at, reason, evidence_note, status
        ) values (
          v_surplus_ref, v_tx_id, v_item.id, v_loc_id, v_condition,
          v_counted_qty, v_caller_id, v_count_timestamp, v_reason,
          coalesce(v_line->>'evidence_note', v_evidence_note), 'held'
        ) returning id into v_surplus_id;

        -- Create Origin with STOCKTAKE_SURPLUS provenance
        insert into public.inventory_stock_origins (
          surplus_id, line_key, provenance_group, catalog_item_id
        ) values (
          v_surplus_id, 'SURPLUS-' || (i + 1)::text, 'STOCKTAKE_SURPLUS', v_item.id
        ) returning id into v_new_origin_id;

        -- Create Initial Fact (version 0)
        insert into public.inventory_stock_facts (
          origin_id, version, previous_fact_id, transaction_id, location_id,
          base_uom_code, purchase_quantity, purchase_uom_code, conversion_factor,
          base_quantity, good_quantity, damaged_quantity,
          expiry_precision, expiry_input, expiry_date,
          source_snapshot, evidence_note
        ) values (
          v_new_origin_id, 0, null, v_tx_id, v_loc.id,
          v_item.base_uom_code, null, null, null,
          v_counted_qty,
          (case when v_condition = 'good' then v_counted_qty else 0 end),
          (case when v_condition = 'damaged' then v_counted_qty else 0 end),
          v_expiry_precision, v_expiry_input, v_expiry_date,
          jsonb_build_object('surplus_id', v_surplus_id, 'surplus_reference', v_surplus_ref, 'counted_at', v_count_timestamp),
          coalesce(v_line->>'evidence_note', v_evidence_note)
        ) returning id into v_new_fact_id;

        -- Create Cohort Projection with initial revision 1
        insert into public.inventory_receipt_cohorts (origin_id, current_fact_id, revision)
        values (v_new_origin_id, v_new_fact_id, 1);

        -- Apply Hold immediately (surplus physical origin held until Admin verification)
        insert into public.inventory_stock_holds (
          origin_id, status, hold_reason, placed_by_id, placed_at
        ) values (
          v_new_origin_id, 'active', 'STOCKTAKE_SURPLUS_PENDING_VERIFICATION', v_caller_id, clock_timestamp()
        );

        -- Record Immutable Evidence
        insert into public.inventory_stock_evidence (
          origin_id, actor_id, action, note, metadata
        ) values (
          v_new_origin_id, v_caller_id, 'SURPLUS_RECORDED',
          coalesce(v_line->>'evidence_note', v_evidence_note),
          jsonb_build_object('surplus_reference', v_surplus_ref, 'counted_quantity', v_counted_qty::text, 'condition', v_condition, 'stocktake_reference', v_stocktake_ref, 'location_id', v_loc_id, 'count_timestamp', v_count_timestamp, 'transaction_id', v_tx_id)
        );

        -- Ledger Line
        v_line_no := v_line_no + 1;
        insert into public.inventory_transaction_lines (
          transaction_id, line_no, cohort_id, catalog_item_id, location_id, condition, quantity_delta
        ) values (
          v_tx_id, v_line_no, v_new_origin_id, v_item.id, v_loc_id, v_condition, v_counted_qty
        );

        -- Physical onhand immediately in balances
        insert into public.inventory_stock_balances (cohort_id, location_id, condition, quantity)
        values (v_new_origin_id, v_loc_id, v_condition, v_counted_qty);

        v_surplus_origins := v_surplus_origins || jsonb_build_object(
          'origin_id', v_new_origin_id,
          'surplus_id', v_surplus_id,
          'surplus_reference', v_surplus_ref
        );
      end if;
    end loop;

    -- Defer monotonic revision bump for existing counted cohorts that had quantity changes
    if exists (select 1 from public.inventory_transaction_lines where transaction_id = v_tx_id) then
      update public.inventory_receipt_cohorts
      set revision = revision + 1, updated_at = clock_timestamp()
      where origin_id in (
        select distinct cohort_id from public.inventory_transaction_lines where transaction_id = v_tx_id and cohort_id = any(v_distinct_cohort_ids)
      );
    end if;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
    values (v_caller_id, 'inventory.stocktake_reconciled', 'inventory_transaction', v_tx_id, p_payload);

    v_result := jsonb_build_object(
      'transaction_id', v_tx_id,
      'lines_processed', v_line_no,
      'surplus_origins', v_surplus_origins
    );

  -- --------------------------------------------------------------------------
  -- 4.14 S2 Physical Operation: Verify Stocktake Surplus (verify_stocktake_surplus) [Admin Only]
  -- --------------------------------------------------------------------------
  elsif p_operation = 'verify_stocktake_surplus' then
    v_origin_id := (p_payload->>'origin_id')::uuid;
    v_expected_fact_version := (p_payload->>'expected_version')::bigint;
    v_expected_stock_revision := (p_payload->>'expected_stock_revision')::bigint;
    v_action := btrim(coalesce(p_payload->>'action', ''));
    v_reason := btrim(coalesce(p_payload->>'reason', ''));
    v_evidence_note := btrim(coalesce(p_payload->>'evidence_note', ''));

    if v_origin_id is null then
      raise exception 'INVALID_PAYLOAD: Origin id is required' using errcode = '22023';
    end if;

    if v_expected_fact_version is null or v_expected_fact_version < 0 then
      raise exception 'STALE_REVISION: Expected version is required' using errcode = '23505';
    end if;

    if v_expected_stock_revision is null or v_expected_stock_revision < 0 then
      raise exception 'STALE_REVISION: Expected stock revision is required' using errcode = '23505';
    end if;

    if v_action not in ('release', 'append_evidence') then
      raise exception 'INVALID_ACTION: Action must be release or append_evidence' using errcode = '22023';
    end if;

    if v_reason = '' then
      raise exception 'REASON_REQUIRED: Reason is required for surplus verification' using errcode = '22023';
    end if;

    if v_evidence_note = '' then
      raise exception 'EVIDENCE_REQUIRED: Evidence note is required for surplus verification' using errcode = '22023';
    end if;

    select o.*, i.material_kind, i.expiry_required, i.base_uom_code
    into v_origin_info
    from public.inventory_stock_origins o
    join public.inventory_catalog_items i on i.id = o.catalog_item_id
    where o.id = v_origin_id;

    if not found then
      raise exception 'ORIGIN_NOT_FOUND: Origin % not found', v_origin_id using errcode = 'P0002';
    end if;

    -- Lock current fact and cohort revision
    select f.*, c.revision as stock_revision into v_current_fact
    from public.inventory_receipt_cohorts c
    join public.inventory_stock_facts f on f.id = c.current_fact_id
    where c.origin_id = v_origin_id
    for update;

    if not found then
      raise exception 'COHORT_NOT_FOUND: Cohort % not found', v_origin_id using errcode = 'P0002';
    end if;

    v_cohort_revision := v_current_fact.stock_revision;

    if v_current_fact.version <> v_expected_fact_version then
      raise exception 'STALE_REVISION: Cohort fact version conflict. Expected %, got %',
        v_expected_fact_version, v_current_fact.version using errcode = '23505';
    end if;

    if v_cohort_revision <> v_expected_stock_revision then
      raise exception 'STALE_REVISION: Cohort stock revision conflict. Expected %, got %',
        v_expected_stock_revision, v_cohort_revision using errcode = '23505';
    end if;

    if v_action = 'release' then
      select * into v_hold
      from public.inventory_stock_holds
      where origin_id = v_origin_id
      for update;

      if not found or v_hold.status <> 'active' then
        raise exception 'INVALID_HOLD_STATE: No active hold found for origin %', v_origin_id using errcode = '22023';
      end if;

      -- Chemical items cannot release with unknown expiry (even if supplied not_required)
      if v_origin_info.material_kind = 'chemical' then
        if v_current_fact.expiry_precision = 'unknown' and
           (p_payload->>'expiry_precision' is null or p_payload->>'expiry_precision' not in ('day', 'month')) then
          raise exception 'CHEMICAL_EXPIRY_REQUIRED: Chemical surplus cannot be released with unknown expiry. Admin must provide verified day or month expiry.'
            using errcode = '22023';
        end if;
      end if;

      -- Required expiry unknown cannot release without verified day/month expiry
      if v_origin_info.expiry_required and v_current_fact.expiry_precision = 'unknown' then
        if p_payload->>'expiry_precision' is null or p_payload->>'expiry_precision' not in ('day', 'month') then
          raise exception 'EXPIRY_VERIFICATION_REQUIRED: Item requires expiry. Admin must verify day or month expiry to release hold.'
            using errcode = '22023';
        end if;
      end if;

      -- If new verified expiry precision is supplied:
      if p_payload ? 'expiry_precision' and p_payload->>'expiry_precision' in ('day', 'month') then
        v_expiry_precision := p_payload->>'expiry_precision';
        v_expiry_input := p_payload->>'expiry_input';
        v_expiry_date := private.inventory_normalize_expiry(v_expiry_precision, v_expiry_input, false);
      else
        v_expiry_precision := v_current_fact.expiry_precision;
        v_expiry_input := v_current_fact.expiry_input;
        v_expiry_date := v_current_fact.expiry_date;
      end if;

      -- Create VERIFY_SURPLUS Transaction
      insert into public.inventory_transactions (
        operation, business_key, actor_id, occurred_at, posted_at, reason
      ) values (
        'VERIFY_SURPLUS', 'verify_surplus:release:' || v_origin_id::text || ':' || p_retry_key::text,
        v_caller_id, clock_timestamp(), clock_timestamp(), v_reason
      ) returning id into v_tx_id;

      -- Insert New Fact Version with verified expiry
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
        v_current_fact.source_snapshot, v_evidence_note
      ) returning id into v_fact_id;

      -- Update Cohort current fact pointer and bump cohort revision
      update public.inventory_receipt_cohorts
      set current_fact_id = v_fact_id, revision = revision + 1, updated_at = clock_timestamp()
      where origin_id = v_origin_id;

      -- Release Hold
      update public.inventory_stock_holds
      set status = 'released',
          released_by_id = v_caller_id,
          released_at = clock_timestamp(),
          release_reason = v_reason,
          updated_at = clock_timestamp()
      where origin_id = v_origin_id;

      if v_origin_info.surplus_id is not null then
        update public.inventory_stocktake_surplus_records
        set status = 'released',
            verified_by_id = v_caller_id,
            verified_at = clock_timestamp(),
            verification_reason = v_reason,
            verification_evidence_note = v_evidence_note,
            updated_at = clock_timestamp()
        where id = v_origin_info.surplus_id;
      end if;

      insert into public.inventory_stock_evidence (
        origin_id, actor_id, action, note, metadata
      ) values (
        v_origin_id, v_caller_id, 'SURPLUS_VERIFIED_RELEASED', v_evidence_note,
        jsonb_build_object('reason', v_reason, 'released_at', clock_timestamp())
      );

    elsif v_action = 'append_evidence' then
      insert into public.inventory_stock_evidence (
        origin_id, actor_id, action, note, metadata
      ) values (
        v_origin_id, v_caller_id, 'EVIDENCE_APPENDED', v_evidence_note,
        jsonb_build_object('reason', v_reason, 'appended_at', clock_timestamp())
      );
    end if;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, new_data)
    values (v_caller_id, 'inventory.surplus_verified', 'inventory_stock_origin', v_origin_id, p_payload);

    v_result := jsonb_build_object(
      'transaction_id', v_tx_id,
      'origin_id', v_origin_id,
      'action', v_action
    );

  -- --------------------------------------------------------------------------
  -- 4.15 S2 Physical Operation: Append Stocktake Evidence (append_stocktake_evidence)
  -- --------------------------------------------------------------------------
  elsif p_operation = 'append_stocktake_evidence' then
    v_origin_id := (p_payload->>'origin_id')::uuid;
    v_reason := btrim(coalesce(p_payload->>'reason', ''));
    v_evidence_note := btrim(coalesce(p_payload->>'evidence_note', ''));

    if v_origin_id is null then
      raise exception 'INVALID_PAYLOAD: Origin id is required' using errcode = '22023';
    end if;

    if v_evidence_note = '' then
      raise exception 'EVIDENCE_REQUIRED: Evidence note cannot be blank' using errcode = '22023';
    end if;

    if not exists (select 1 from public.inventory_stock_origins where id = v_origin_id) then
      raise exception 'ORIGIN_NOT_FOUND: Origin % not found', v_origin_id using errcode = 'P0002';
    end if;

    insert into public.inventory_stock_evidence (
      origin_id, actor_id, action, note, metadata
    ) values (
      v_origin_id, v_caller_id, 'EVIDENCE_APPENDED', v_evidence_note,
      jsonb_build_object('reason', v_reason, 'appended_at', clock_timestamp())
    ) returning id into v_id;

    -- Return id (evidence UUID) for shared client resolution
    v_result := jsonb_build_object('id', v_id, 'origin_id', v_origin_id, 'evidence_id', v_id);

  else
    raise exception 'UNKNOWN_OPERATION: Operation % is not supported', p_operation using errcode = '22023';
  end if;
  if coalesce(current_setting('app.s4_transfer_work',true),'')<>'true' then
    perform private.s4_refresh_health();
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

-- Revoke and Grant for inventory_command
revoke all on function public.inventory_command(text, jsonb, uuid) from public, anon;
grant execute on function public.inventory_command(text, jsonb, uuid) to authenticated;

create or replace function public.inventory_read(
  p_resource text,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_page integer := coalesce((p_filters->>'page')::integer, 1);
  v_page_size integer := coalesce((p_filters->>'page_size')::integer, 50);
  v_offset integer;
  v_q text := btrim(coalesce(p_filters->>'q', ''));
  v_sort text := btrim(coalesce(p_filters->>'sort', ''));
  v_active boolean := (p_filters->>'active')::boolean;
  v_id uuid := (p_filters->>'id')::uuid;
  v_item_id uuid := (p_filters->>'item_id')::uuid;
  v_location_id uuid := (p_filters->>'location_id')::uuid;
  v_source_id uuid := (p_filters->>'source_id')::uuid;
  v_origin_id uuid := (p_filters->>'origin_id')::uuid;
  v_category_id uuid := (p_filters->>'category_id')::uuid;
  v_supplier_id uuid := (p_filters->>'supplier_id')::uuid;
  v_source_line_id uuid := (p_filters->>'source_line_id')::uuid;
  v_status text := nullif(btrim(coalesce(p_filters->>'status', '')), '');
  v_operation text := nullif(btrim(coalesce(p_filters->>'operation', '')), '');
  v_condition text := nullif(btrim(coalesce(p_filters->>'condition', '')), '');
  v_expiry_state text := nullif(btrim(coalesce(p_filters->>'expiry_state', '')), '');
  v_is_held boolean := (p_filters->>'is_held')::boolean;
  v_include_held boolean := coalesce((p_filters->>'include_held')::boolean, true);
  v_provenance_group text := nullif(btrim(coalesce(p_filters->>'provenance_group', '')), '');

  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
begin
  if not private.can_access_inventory() then
    raise exception 'AUTH_DENIED: Access denied to inventory read models' using errcode = '42501';
  end if;

  if v_page < 1 then v_page := 1; end if;
  if v_page_size < 1 then v_page_size := 50; end if;
  if v_page_size > 100 then v_page_size := 100; end if;
  v_offset := (v_page - 1) * v_page_size;

  -- --------------------------------------------------------------------------
  -- 11.1 Items
  -- --------------------------------------------------------------------------
  if p_resource = 'items' then
    select count(*) into v_total
    from public.inventory_catalog_items i
    where (v_id is null or i.id = v_id)
      and (v_active is null or i.active = v_active)
      and (v_category_id is null or i.category_id = v_category_id)
      and (v_q = '' or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%');

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select i.id, i.code, i.name, i.category_id, c.name as category_name, c.code as category_code,
             i.material_kind, i.base_uom_code, u.name as base_uom_name, u.allowed_scale as base_uom_scale,
             i.tracking_strategy, i.return_semantics, i.expiry_required, i.active, i.revision,
             i.created_at, i.updated_at
      from public.inventory_catalog_items i
      join public.inventory_categories c on c.id = i.category_id
      join public.inventory_uoms u on u.code = i.base_uom_code
      where (v_id is null or i.id = v_id)
        and (v_active is null or i.active = v_active)
        and (v_category_id is null or i.category_id = v_category_id)
        and (v_q = '' or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%')
      order by
        case when v_sort = 'name_desc' then i.name end desc nulls last,
        case when v_sort = 'code_desc' then i.code end desc nulls last,
        case when v_sort = 'code_asc' then i.code end asc nulls last,
        case when v_sort not in ('name_desc', 'code_desc', 'code_asc') then i.name end asc nulls last,
        case when v_sort in ('name_desc', 'code_desc') then i.code end desc nulls last,
        i.code asc,
        i.id asc
      limit v_page_size offset v_offset
    ) sub;

  -- --------------------------------------------------------------------------
  -- 11.2 Categories
  -- --------------------------------------------------------------------------
  elsif p_resource = 'categories' then
    select count(*) into v_total
    from public.inventory_categories c
    where (v_id is null or c.id = v_id)
      and (v_active is null or c.active = v_active)
      and (v_q = '' or c.code ilike '%' || v_q || '%' or c.name ilike '%' || v_q || '%');

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select c.id, c.code, c.name, c.active, c.revision, c.created_at, c.updated_at
      from public.inventory_categories c
      where (v_id is null or c.id = v_id)
        and (v_active is null or c.active = v_active)
        and (v_q = '' or c.code ilike '%' || v_q || '%' or c.name ilike '%' || v_q || '%')
      order by
        case when v_sort = 'name_desc' then c.name end desc nulls last,
        case when v_sort = 'code_desc' then c.code end desc nulls last,
        case when v_sort = 'code_asc' then c.code end asc nulls last,
        case when v_sort not in ('name_desc', 'code_desc', 'code_asc') then c.name end asc nulls last,
        case when v_sort in ('name_desc', 'code_desc') then c.code end desc nulls last,
        c.code asc,
        c.id asc
      limit v_page_size offset v_offset
    ) sub;

  -- --------------------------------------------------------------------------
  -- 11.3 UOMs
  -- --------------------------------------------------------------------------
  elsif p_resource = 'uoms' then
    select count(*) into v_total
    from public.inventory_uoms u
    where (v_active is null or u.active = v_active)
      and (v_q = '' or u.code ilike '%' || v_q || '%' or u.name ilike '%' || v_q || '%');

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select u.code, u.name, u.dimension, u.allowed_scale, u.active, u.revision, u.created_at, u.updated_at
      from public.inventory_uoms u
      where (v_active is null or u.active = v_active)
        and (v_q = '' or u.code ilike '%' || v_q || '%' or u.name ilike '%' || v_q || '%')
      order by
        case when v_sort = 'name_desc' then u.name end desc nulls last,
        case when v_sort = 'code_desc' then u.code end desc nulls last,
        case when v_sort = 'code_asc' then u.code end asc nulls last,
        case when v_sort not in ('name_desc', 'code_desc', 'code_asc') then u.name end asc nulls last,
        u.code asc
      limit v_page_size offset v_offset
    ) sub;

  -- --------------------------------------------------------------------------
  -- 11.4 Suppliers
  -- --------------------------------------------------------------------------
  elsif p_resource = 'suppliers' then
    select count(*) into v_total
    from public.inventory_suppliers s
    where (v_id is null or s.id = v_id)
      and (v_active is null or s.active = v_active)
      and (v_q = '' or s.name ilike '%' || v_q || '%' or s.tax_code ilike '%' || v_q || '%');

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select s.id, s.name, s.tax_code, s.contact, s.notes, s.active, s.revision, s.created_at, s.updated_at
      from public.inventory_suppliers s
      where (v_id is null or s.id = v_id)
        and (v_active is null or s.active = v_active)
        and (v_q = '' or s.name ilike '%' || v_q || '%' or s.tax_code ilike '%' || v_q || '%')
      order by
        case when v_sort = 'name_desc' then s.name end desc nulls last,
        case when v_sort not in ('name_desc') then s.name end asc nulls last,
        case when v_sort = 'name_desc' then s.id end desc nulls last,
        s.id asc
      limit v_page_size offset v_offset
    ) sub;

  -- --------------------------------------------------------------------------
  -- 11.5 Locations
  -- --------------------------------------------------------------------------
  elsif p_resource = 'locations' then
    select count(*) into v_total
    from public.inventory_storage_locations l
    where (v_id is null or l.id = v_id)
      and (v_active is null or l.active = v_active)
      and (v_q = '' or l.code ilike '%' || v_q || '%' or l.name ilike '%' || v_q || '%');

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select l.id, l.code, l.name, l.parent_location_id, p.code as parent_code, p.name as parent_name,
             l.room_id, r.room_code, l.active, l.revision, l.created_at, l.updated_at
      from public.inventory_storage_locations l
      left join public.inventory_storage_locations p on p.id = l.parent_location_id
      left join public.rooms r on r.id = l.room_id
      where (v_id is null or l.id = v_id)
        and (v_active is null or l.active = v_active)
        and (v_q = '' or l.code ilike '%' || v_q || '%' or l.name ilike '%' || v_q || '%')
      order by
        case when v_sort = 'name_desc' then l.name end desc nulls last,
        case when v_sort = 'code_desc' then l.code end desc nulls last,
        case when v_sort = 'code_asc' then l.code end asc nulls last,
        case when v_sort not in ('name_desc', 'code_desc', 'code_asc') then l.name end asc nulls last,
        case when v_sort in ('name_desc', 'code_desc') then l.code end desc nulls last,
        l.code asc,
        l.id asc
      limit v_page_size offset v_offset
    ) sub;

  -- --------------------------------------------------------------------------
  -- 11.6 Sources
  -- --------------------------------------------------------------------------
  elsif p_resource = 'sources' then
    select count(*) into v_total
    from public.acquisition_records a
    where (v_id is null or a.id = v_id)
      and (v_supplier_id is null or a.supplier_id = v_supplier_id)
      and (v_status is null or a.status = v_status)
      and (v_active is null or (v_active = true and a.status = 'active') or (v_active = false and a.status = 'voided'))
      and (v_q = '' or a.source_reference ilike '%' || v_q || '%' or a.external_reference ilike '%' || v_q || '%');

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select a.id, a.source_reference, a.supplier_id, s.name as supplier_name,
             a.reference_date, a.funding_source, a.external_reference, a.notes, a.status, a.revision,
             (select count(*) from public.acquisition_record_lines l where l.acquisition_record_id = a.id) as line_count,
             a.created_at, a.updated_at
      from public.acquisition_records a
      join public.inventory_suppliers s on s.id = a.supplier_id
      where (v_id is null or a.id = v_id)
        and (v_supplier_id is null or a.supplier_id = v_supplier_id)
        and (v_status is null or a.status = v_status)
        and (v_active is null or (v_active = true and a.status = 'active') or (v_active = false and a.status = 'voided'))
        and (v_q = '' or a.source_reference ilike '%' || v_q || '%' or a.external_reference ilike '%' || v_q || '%')
      order by
        case when v_sort = 'posted_asc' then a.reference_date end asc nulls last,
        case when v_sort in ('name_asc', 'code_asc') then a.source_reference end asc nulls last,
        case when v_sort in ('name_desc', 'code_desc') then a.source_reference end desc nulls last,
        case when v_sort not in ('posted_asc', 'name_asc', 'code_asc', 'name_desc', 'code_desc') then a.reference_date end desc nulls last,
        case when v_sort in ('name_desc', 'code_desc') then a.id end desc nulls last,
        a.source_reference asc,
        a.id asc
      limit v_page_size offset v_offset
    ) sub;

  -- --------------------------------------------------------------------------
  -- 11.7 Source Lines
  -- --------------------------------------------------------------------------
  elsif p_resource = 'source_lines' then
    select count(*) into v_total
    from public.acquisition_record_lines l
    join public.inventory_catalog_items i on i.id = l.catalog_item_id
    where (v_id is null or l.id = v_id)
      and (v_source_id is null or l.acquisition_record_id = v_source_id)
      and (v_item_id is null or l.catalog_item_id = v_item_id)
      and (v_q = '' or l.line_key ilike '%' || v_q || '%' or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%');

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select l.id, l.acquisition_record_id, l.line_key, l.catalog_item_id,
             i.code as catalog_item_code, i.name as catalog_item_name,
             l.expected_purchase_quantity::text as expected_purchase_quantity,
             l.purchase_uom_code,
             l.expected_conversion_factor::text as expected_conversion_factor,
             l.unit_cost::text as unit_cost, l.currency_code,
             l.manufacturer, l.model, l.country_of_origin, l.warranty_start, l.warranty_end, l.notes,
             actuals.total_base_qty::text as actual_base_quantity,
             actuals.total_base_qty::text as received_base_quantity,
            case
              when l.expected_conversion_factor is not null
              then round((l.expected_purchase_quantity * l.expected_conversion_factor), 6)::text
              else null
            end as expected_base_quantity,
            case
              when l.expected_conversion_factor is not null
              then round((actuals.total_base_qty - (l.expected_purchase_quantity * l.expected_conversion_factor)), 6)::text
              else null
            end as base_discrepancy,
             actuals.packaging,
             l.created_at, l.updated_at
      from public.acquisition_record_lines l
      join public.inventory_catalog_items i on i.id = l.catalog_item_id
      left join lateral (
        select
          coalesce((
            select sum(f_tot.base_quantity)
            from public.inventory_stock_origins o_tot
            join public.inventory_receipt_cohorts c_tot on c_tot.origin_id = o_tot.id
            join public.inventory_stock_facts f_tot on f_tot.id = c_tot.current_fact_id
            where o_tot.source_line_id = l.id
          ), 0) as total_base_qty,
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'purchase_uom_code', pkg.purchase_uom_code,
                'conversion_factor', pkg.conversion_factor::text,
                'purchase_quantity', pkg.purchase_qty::text,
                'base_quantity', pkg.base_qty::text
              ) order by pkg.purchase_uom_code asc, pkg.conversion_factor asc
            )
            from (
              select
                f_pkg.purchase_uom_code,
                f_pkg.conversion_factor,
                sum(f_pkg.purchase_quantity) as purchase_qty,
                sum(f_pkg.base_quantity) as base_qty
              from public.inventory_stock_origins o_pkg
              join public.inventory_receipt_cohorts c_pkg on c_pkg.origin_id = o_pkg.id
              join public.inventory_stock_facts f_pkg on f_pkg.id = c_pkg.current_fact_id
              where o_pkg.source_line_id = l.id
              group by f_pkg.purchase_uom_code, f_pkg.conversion_factor
            ) pkg
          ), '[]'::jsonb) as packaging
      ) actuals on true
      where (v_id is null or l.id = v_id)
        and (v_source_id is null or l.acquisition_record_id = v_source_id)
        and (v_item_id is null or l.catalog_item_id = v_item_id)
        and (v_q = '' or l.line_key ilike '%' || v_q || '%' or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%')
      order by
        case when v_sort = 'name_desc' then i.name end desc nulls last,
        case when v_sort = 'name_asc' then i.name end asc nulls last,
        case when v_sort = 'code_desc' then l.line_key end desc nulls last,
        case when v_sort not in ('name_desc', 'name_asc', 'code_desc') then l.line_key end asc nulls last,
        case when v_sort in ('name_desc', 'code_desc') then l.id end desc nulls last,
        l.id asc
      limit v_page_size offset v_offset
    ) sub;

  -- --------------------------------------------------------------------------
  -- 11.8 Source Receipts
  -- --------------------------------------------------------------------------
  elsif p_resource = 'source_receipts' then
    select count(*) into v_total
    from public.inventory_stock_origins o
    join public.inventory_receipts r on r.id = o.receipt_id
    join public.acquisition_record_lines l on l.id = o.source_line_id
    join public.inventory_stock_facts f on f.origin_id = o.id and f.version = 0
    join public.inventory_transactions t on t.id = r.transaction_id
    where o.source_line_id is not null
      and (v_source_id is null or l.acquisition_record_id = v_source_id)
      and (v_source_line_id is null or o.source_line_id = v_source_line_id)
      and (v_origin_id is null or o.id = v_origin_id)
      and (v_item_id is null or o.catalog_item_id = v_item_id)
      and (v_q = '' or r.receipt_reference ilike '%' || v_q || '%' or o.line_key ilike '%' || v_q || '%');

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select r.transaction_id,
             r.receipt_reference,
             o.id as origin_id,
             o.source_line_id,
             o.line_key,
             f.purchase_quantity::text as purchase_quantity,
             f.purchase_uom_code,
             f.conversion_factor::text as conversion_factor,
             f.base_quantity::text as base_quantity,
             f.base_uom_code,
             t.posted_at
      from public.inventory_stock_origins o
      join public.inventory_receipts r on r.id = o.receipt_id
      join public.acquisition_record_lines l on l.id = o.source_line_id
      join public.inventory_stock_facts f on f.origin_id = o.id and f.version = 0
      join public.inventory_transactions t on t.id = r.transaction_id
      where o.source_line_id is not null
        and (v_source_id is null or l.acquisition_record_id = v_source_id)
        and (v_source_line_id is null or o.source_line_id = v_source_line_id)
        and (v_origin_id is null or o.id = v_origin_id)
        and (v_item_id is null or o.catalog_item_id = v_item_id)
        and (v_q = '' or r.receipt_reference ilike '%' || v_q || '%' or o.line_key ilike '%' || v_q || '%')
      order by
        case when v_sort = 'posted_asc' then t.posted_at end asc nulls last,
        case when v_sort = 'code_asc' then r.receipt_reference end asc nulls last,
        case when v_sort = 'code_desc' then r.receipt_reference end desc nulls last,
        case when v_sort = 'name_asc' then r.receipt_reference end asc nulls last,
        case when v_sort = 'name_desc' then r.receipt_reference end desc nulls last,
        case when v_sort not in ('posted_asc', 'code_asc', 'code_desc', 'name_asc', 'name_desc') then t.posted_at end desc nulls last,
        case when v_sort in ('code_asc', 'name_asc') then o.id end asc nulls last,
        o.id desc
      limit v_page_size offset v_offset
    ) sub;

  -- --------------------------------------------------------------------------
  -- 11.9 Summary
  -- --------------------------------------------------------------------------
  elsif p_resource = 'summary' then
    v_total := 1;
    select jsonb_build_array(
      jsonb_build_object(
        'active_item_count', (select count(*) from public.inventory_catalog_items where active = true),
        'active_source_count', (select count(*) from public.acquisition_records where status = 'active')
      )
    ) into v_rows;

  -- --------------------------------------------------------------------------
  -- 11.10 Balances
  -- --------------------------------------------------------------------------
  elsif p_resource = 'balances' then
    select count(*) into v_total
    from (
      select o.catalog_item_id, b.location_id, b.condition
      from public.inventory_stock_balances b
      join public.inventory_receipt_cohorts c on c.origin_id = b.cohort_id
      join public.inventory_stock_facts f on f.id = c.current_fact_id
      join public.inventory_stock_origins o on o.id = c.origin_id
      join public.inventory_catalog_items i on i.id = o.catalog_item_id
      join public.inventory_storage_locations l on l.id = b.location_id
      where (v_item_id is null or o.catalog_item_id = v_item_id)
        and (v_location_id is null or b.location_id = v_location_id)
        and (v_condition is null or b.condition = v_condition)
        and (v_active is null or (i.active = v_active and l.active = v_active))
        and (v_q = '' or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%' or l.code ilike '%' || v_q || '%' or l.name ilike '%' || v_q || '%')
      group by o.catalog_item_id, b.location_id, b.condition
      having (
        v_expiry_state is null
        or (v_expiry_state = 'expired' and sum(case when b.condition = 'good' and (f.expiry_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date) then b.quantity else 0 end) > 0)
        or (v_expiry_state = 'eligible' and sum(case when b.condition = 'good' and i.active and l.active and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date) and f.expiry_precision <> 'unknown' and not exists (select 1 from public.inventory_stock_holds h where h.origin_id = c.origin_id and h.status = 'active') then b.quantity else 0 end) > 0)
        or (v_expiry_state = 'unknown' and sum(case when b.condition = 'good' and f.expiry_precision = 'unknown' then b.quantity else 0 end) > 0)
      )
    ) cnt;

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select o.catalog_item_id as item_id, i.code as item_code, i.name as item_name,
             i.base_uom_code, u.name as base_uom_name,
             b.location_id, l.code as location_code, l.name as location_name,
             b.condition,
             sum(b.quantity)::text as quantity,
             sum(case when b.condition = 'good' and i.active and l.active
                           and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)
                           and f.expiry_precision <> 'unknown'
                           and not exists (select 1 from public.inventory_stock_holds h where h.origin_id = c.origin_id and h.status = 'active')
                      then b.quantity else 0 end)::text as eligible_quantity,
             sum(case when b.condition='good' then private.s4_available(c.origin_id,b.location_id) else 0 end)::text as available_quantity,
             sum(case when b.condition = 'good' and (f.expiry_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date)
                      then b.quantity else 0 end)::text as expired_quantity,
             sum(case when b.condition = 'good' and f.expiry_precision = 'unknown'
                      then b.quantity else 0 end)::text as unknown_expiry_quantity
      from public.inventory_stock_balances b
      join public.inventory_receipt_cohorts c on c.origin_id = b.cohort_id
      join public.inventory_stock_facts f on f.id = c.current_fact_id
      join public.inventory_stock_origins o on o.id = c.origin_id
      join public.inventory_catalog_items i on i.id = o.catalog_item_id
      join public.inventory_uoms u on u.code = i.base_uom_code
      join public.inventory_storage_locations l on l.id = b.location_id
      where (v_item_id is null or o.catalog_item_id = v_item_id)
        and (v_location_id is null or b.location_id = v_location_id)
        and (v_condition is null or b.condition = v_condition)
        and (v_active is null or (i.active = v_active and l.active = v_active))
        and (v_q = '' or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%' or l.code ilike '%' || v_q || '%' or l.name ilike '%' || v_q || '%')
      group by o.catalog_item_id, i.code, i.name, i.base_uom_code, u.name,
               b.location_id, l.code, l.name, b.condition
      having (
        v_expiry_state is null
        or (v_expiry_state = 'expired' and sum(case when b.condition = 'good' and (f.expiry_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date) then b.quantity else 0 end) > 0)
        or (v_expiry_state = 'eligible' and sum(case when b.condition = 'good' and i.active and l.active and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date) and f.expiry_precision <> 'unknown' and not exists (select 1 from public.inventory_stock_holds h where h.origin_id = c.origin_id and h.status = 'active') then b.quantity else 0 end) > 0)
        or (v_expiry_state = 'unknown' and sum(case when b.condition = 'good' and f.expiry_precision = 'unknown' then b.quantity else 0 end) > 0)
      )
      order by
        case when v_sort = 'name_desc' then i.name end desc nulls last,
        case when v_sort = 'code_desc' then i.code end desc nulls last,
        case when v_sort = 'code_asc' then i.code end asc nulls last,
        case when v_sort not in ('name_desc', 'code_desc', 'code_asc') then i.name end asc nulls last,
        case when v_sort = 'name_desc' then l.name end desc nulls last,
        case when v_sort = 'code_desc' then l.code end desc nulls last,
        case when v_sort = 'code_asc' then l.code end asc nulls last,
        case when v_sort not in ('name_desc', 'code_desc', 'code_asc') then l.name end asc nulls last,
        case when v_sort in ('name_desc', 'code_desc') then b.condition end desc nulls last,
        b.condition asc,
        o.catalog_item_id asc,
        b.location_id asc
      limit v_page_size offset v_offset
    ) sub;

  -- --------------------------------------------------------------------------
  -- 11.11 Transactions
  -- --------------------------------------------------------------------------
  elsif p_resource = 'transactions' then
    select count(*) into v_total
    from public.inventory_transactions t
    join public.profiles p on p.id = t.actor_id
    where (v_id is null or t.id = v_id)
      and (v_operation is null or t.operation = v_operation)
      and (v_q = '' or t.business_key ilike '%' || v_q || '%' or p.full_name ilike '%' || v_q || '%' or p.email ilike '%' || v_q || '%');

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select t.id, t.operation, t.business_key, t.actor_id, p.full_name as actor_name, p.email as actor_email,
             t.occurred_at, t.posted_at, t.reason, t.corrects_transaction_id,
             (select count(*) from public.inventory_transaction_lines tl where tl.transaction_id = t.id) as line_count
      from public.inventory_transactions t
      join public.profiles p on p.id = t.actor_id
      where (v_id is null or t.id = v_id)
        and (v_operation is null or t.operation = v_operation)
        and (v_q = '' or t.business_key ilike '%' || v_q || '%' or p.full_name ilike '%' || v_q || '%' or p.email ilike '%' || v_q || '%')
      order by
        case when v_sort = 'posted_asc' then t.posted_at end asc nulls last,
        case when v_sort = 'code_asc' then t.business_key end asc nulls last,
        case when v_sort = 'code_desc' then t.business_key end desc nulls last,
        case when v_sort not in ('posted_asc', 'code_asc', 'code_desc') then t.posted_at end desc nulls last,
        case when v_sort in ('code_desc') then t.id end desc nulls last,
        t.id asc
      limit v_page_size offset v_offset
    ) sub;

  -- --------------------------------------------------------------------------
  -- 11.12 Cohorts
  -- --------------------------------------------------------------------------
  elsif p_resource = 'cohorts' then
    select count(*) into v_total
    from public.inventory_receipt_cohorts c
    join public.inventory_stock_origins o on o.id = c.origin_id
    join public.inventory_stock_facts f on f.id = c.current_fact_id
    join public.inventory_catalog_items i on i.id = o.catalog_item_id
    where (v_origin_id is null or o.id = v_origin_id)
      and (v_item_id is null or o.catalog_item_id = v_item_id)
      and (v_location_id is null
           or exists (select 1 from public.inventory_stock_balances b where b.cohort_id = c.origin_id and b.location_id = v_location_id and b.quantity > 0))
      and (
        v_expiry_state is null
        or (v_expiry_state = 'expired' and f.expiry_date is not null and f.expiry_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date)
        or (v_expiry_state = 'unknown' and f.expiry_precision = 'unknown')
        or (v_expiry_state = 'eligible'
            and i.active
            and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)
            and f.expiry_precision <> 'unknown'
            and not exists (select 1 from public.inventory_stock_holds h where h.origin_id = c.origin_id and h.status = 'active')
            and exists (
              select 1 from public.inventory_stock_balances b
              join public.inventory_storage_locations bl on bl.id = b.location_id
              where b.cohort_id = c.origin_id
                and b.condition = 'good'
                and b.quantity > 0
                and bl.active = true
                and (v_location_id is null or b.location_id = v_location_id)
            ))
      )
      and (v_q = '' or o.line_key ilike '%' || v_q || '%' or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%');

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select c.origin_id,
             coalesce(f0.transaction_id, f.transaction_id) as transaction_id,
             f.id as current_fact_id,
             f.version as current_version,
             c.revision as stock_revision,
             o.line_key,
             o.provenance_group,
             o.catalog_item_id,
             i.code as item_code,
             i.name as item_name,
             f.base_uom_code,
             r.receipt_reference,
             ob.cutover_key,
             sr.surplus_reference,
             f.location_id as intake_location_id,
             l_intake.code as intake_location_code,
             l_intake.name as intake_location_name,
             case
               when v_location_id is not null then v_location_id
               when loc_stats.pos_loc_count = 1 then loc_stats.single_loc_id
               else null
             end as current_location_id,
             case
               when v_location_id is not null then (select code from public.inventory_storage_locations where id = v_location_id)
               when loc_stats.pos_loc_count = 1 then loc_stats.single_loc_code
               else null
             end as current_location_code,
             case
               when v_location_id is not null then (select name from public.inventory_storage_locations where id = v_location_id)
               when loc_stats.pos_loc_count = 1 then loc_stats.single_loc_name
               else null
             end as current_location_name,
             case
               when loc_stats.pos_loc_count = 0 then 'depleted'
               when loc_stats.pos_loc_count = 1 then 'single'
               else 'split'
             end as location_state,
             loc_stats.scoped_locations_json as locations,
             f.expiry_precision as current_expiry_precision,
             f.expiry_date as current_expiry_date,
             f.expiry_input,
             coalesce((select sum(b.quantity)::text from public.inventory_stock_balances b where b.cohort_id = c.origin_id and b.condition = 'good' and (v_location_id is null or b.location_id = v_location_id)), '0') as good_balance,
             coalesce((select sum(b.quantity)::text from public.inventory_stock_balances b where b.cohort_id = c.origin_id and b.condition = 'damaged' and (v_location_id is null or b.location_id = v_location_id)), '0') as damaged_balance,
             coalesce((select sum(b.quantity)::text from public.inventory_stock_balances b where b.cohort_id = c.origin_id and (v_location_id is null or b.location_id = v_location_id)), '0') as physical_balance,
             case
               when i.active
                    and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)
                    and f.expiry_precision <> 'unknown'
                    and not exists (select 1 from public.inventory_stock_holds h where h.origin_id = c.origin_id and h.status = 'active')
               then coalesce((
                 select sum(b.quantity)::text
                 from public.inventory_stock_balances b
                 join public.inventory_storage_locations bl on bl.id = b.location_id
                 where b.cohort_id = c.origin_id
                   and b.condition = 'good'
                   and bl.active = true
                   and (v_location_id is null or b.location_id = v_location_id)
               ), '0')
               else '0'
             end as eligible_balance,
             coalesce((select sum(private.s4_available(b.cohort_id,b.location_id))::text
               from public.inventory_stock_balances b
               where b.cohort_id=c.origin_id and b.condition='good'
                 and (v_location_id is null or b.location_id=v_location_id)), '0') as available_quantity,
             coalesce(f0.base_quantity, f.base_quantity)::text as origin_base_quantity,
             f.good_quantity::text as current_good_quantity,
             f.damaged_quantity::text as current_damaged_quantity,
             coalesce((select sum(b.quantity)::text from public.inventory_stock_balances b where b.cohort_id = c.origin_id and (v_location_id is null or b.location_id = v_location_id)), '0') as remaining_quantity,
             (exists (select 1 from public.inventory_stock_holds h where h.origin_id = c.origin_id and h.status = 'active')) as is_held,
             (select h.hold_reason from public.inventory_stock_holds h where h.origin_id = c.origin_id and h.status = 'active' limit 1) as hold_reason,
             c.created_at,
             c.updated_at
      from public.inventory_receipt_cohorts c
      join public.inventory_stock_origins o on o.id = c.origin_id
      join public.inventory_stock_facts f on f.id = c.current_fact_id
      left join public.inventory_stock_facts f0 on f0.origin_id = c.origin_id and f0.version = 0
      left join public.inventory_transactions t0 on t0.id = f0.transaction_id
      join public.inventory_catalog_items i on i.id = o.catalog_item_id
      join public.inventory_storage_locations l_intake on l_intake.id = f.location_id
      left join public.inventory_receipts r on r.id = o.receipt_id
      left join public.inventory_opening_batches ob on ob.id = o.opening_batch_id
      left join public.inventory_stocktake_surplus_records sr on sr.id = o.surplus_id
      left join lateral (
        select
          count(*) as pos_loc_count,
          coalesce(jsonb_agg(
            jsonb_build_object(
              'location_id', loc_sub.location_id,
              'location_code', loc_sub.code,
              'location_name', loc_sub.name,
              'good_balance', loc_sub.good_qty::text,
              'damaged_balance', loc_sub.damaged_qty::text,
              'physical_balance', loc_sub.physical_qty::text
            ) order by loc_sub.name asc, loc_sub.code asc
          ) filter (where v_location_id is null or loc_sub.location_id = v_location_id), '[]'::jsonb) as scoped_locations_json,
          (case when count(*) = 1 then (jsonb_agg(loc_sub.location_id))->>0 else null end)::uuid as single_loc_id,
          (case when count(*) = 1 then (jsonb_agg(loc_sub.code))->>0 else null end) as single_loc_code,
          (case when count(*) = 1 then (jsonb_agg(loc_sub.name))->>0 else null end) as single_loc_name
        from (
          select
            bl.id as location_id,
            bl.code,
            bl.name,
            sum(case when b2.condition = 'good' then b2.quantity else 0 end) as good_qty,
            sum(case when b2.condition = 'damaged' then b2.quantity else 0 end) as damaged_qty,
            sum(b2.quantity) as physical_qty
          from public.inventory_stock_balances b2
          join public.inventory_storage_locations bl on bl.id = b2.location_id
          where b2.cohort_id = c.origin_id
          group by bl.id, bl.code, bl.name
          having sum(b2.quantity) > 0
        ) loc_sub
      ) loc_stats on true
      where (v_origin_id is null or o.id = v_origin_id)
        and (v_item_id is null or o.catalog_item_id = v_item_id)
        and (v_location_id is null
             or exists (select 1 from public.inventory_stock_balances b where b.cohort_id = c.origin_id and b.location_id = v_location_id and b.quantity > 0))
        and (
          v_expiry_state is null
          or (v_expiry_state = 'expired' and f.expiry_date is not null and f.expiry_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date)
          or (v_expiry_state = 'unknown' and f.expiry_precision = 'unknown')
          or (v_expiry_state = 'eligible'
              and i.active
              and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)
              and f.expiry_precision <> 'unknown'
              and not exists (select 1 from public.inventory_stock_holds h where h.origin_id = c.origin_id and h.status = 'active')
              and exists (
                select 1 from public.inventory_stock_balances b
                join public.inventory_storage_locations bl on bl.id = b.location_id
                where b.cohort_id = c.origin_id
                  and b.condition = 'good'
                  and b.quantity > 0
                  and bl.active = true
                  and (v_location_id is null or b.location_id = v_location_id)
              ))
        )
        and (v_q = '' or o.line_key ilike '%' || v_q || '%' or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%')
      order by
        case when v_sort = 'posted_asc' then coalesce(t0.posted_at, f.created_at) end asc nulls last,
        case when v_sort = 'name_asc' then i.name end asc nulls last,
        case when v_sort = 'name_desc' then i.name end desc nulls last,
        case when v_sort = 'code_asc' then i.code end asc nulls last,
        case when v_sort = 'code_desc' then i.code end desc nulls last,
        case when v_sort not in ('posted_asc', 'name_asc', 'name_desc', 'code_asc', 'code_desc') then coalesce(t0.posted_at, f.created_at) end desc nulls last,
        case when v_sort in ('name_desc', 'code_desc') then o.id end desc nulls last,
        o.id asc
      limit v_page_size offset v_offset
    ) sub;
  elsif p_resource = 'transaction_detail' then
    if v_id is null then
      raise exception 'ID_REQUIRED: Transaction detail requires transaction id filter' using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select (to_jsonb(t) || jsonb_build_object('actor_name', p.full_name)) as transaction,
             (
               select coalesce(jsonb_agg(tl_sub), '[]'::jsonb)
               from (
                 select tl.transaction_id, tl.line_no, tl.cohort_id, tl.catalog_item_id, i.code as item_code, i.name as item_name,
                        tl.location_id, l.code as location_code, l.name as location_name,
                        tl.condition, tl.quantity_delta::text as quantity_delta
                 from public.inventory_transaction_lines tl
                 join public.inventory_catalog_items i on i.id = tl.catalog_item_id
                 join public.inventory_storage_locations l on l.id = tl.location_id
                 where tl.transaction_id = t.id
                 order by tl.line_no asc
               ) tl_sub
             ) as lines,
             (
               select coalesce(jsonb_agg(f_sub), '[]'::jsonb)
               from (
                 select f.id, f.origin_id, f.version, f.previous_fact_id, f.transaction_id, f.location_id, f.base_uom_code,
                        f.purchase_quantity::text as purchase_quantity, f.purchase_uom_code,
                        f.conversion_factor::text as conversion_factor,
                        f.base_quantity::text as base_quantity,
                        f.good_quantity::text as good_quantity,
                        f.damaged_quantity::text as damaged_quantity,
                        f.expiry_precision, f.expiry_input, f.expiry_date,
                        f.source_snapshot, f.evidence_note
                 from public.inventory_stock_facts f
                 where f.transaction_id = t.id
                 order by f.version asc, f.id asc
               ) f_sub
             ) as facts,
             (
               select coalesce(jsonb_agg(origin_detail order by origin_detail.line_key), '[]'::jsonb)
               from (
                 select o.id as origin_id, o.line_key, o.catalog_item_id,
                        i.code as item_code, i.name as item_name, i.base_uom_code,
                        (to_jsonb(original) || jsonb_build_object(
                          'purchase_quantity', original.purchase_quantity::text,
                          'conversion_factor', original.conversion_factor::text,
                          'base_quantity', original.base_quantity::text,
                          'good_quantity', original.good_quantity::text,
                          'damaged_quantity', original.damaged_quantity::text,
                          'location_name', original_location.name
                        )) as original_fact,
                        (to_jsonb(current_fact) || jsonb_build_object(
                          'purchase_quantity', current_fact.purchase_quantity::text,
                          'conversion_factor', current_fact.conversion_factor::text,
                          'base_quantity', current_fact.base_quantity::text,
                          'good_quantity', current_fact.good_quantity::text,
                          'damaged_quantity', current_fact.damaged_quantity::text,
                          'location_name', current_location.name
                        )) as current_fact,
                        (
                          select coalesce(jsonb_agg(balance_detail order by balance_detail.location_id, balance_detail.condition), '[]'::jsonb)
                          from (
                            select b.location_id, bl.name as location_name, b.condition, b.quantity::text as quantity
                            from public.inventory_stock_balances b
                            join public.inventory_storage_locations bl on bl.id = b.location_id
                            where b.cohort_id = o.id
                          ) balance_detail
                        ) as balances
                 from public.inventory_stock_origins o
                 join public.inventory_catalog_items i on i.id = o.catalog_item_id
                 join public.inventory_stock_facts original on original.origin_id = o.id and original.version = 0
                 join public.inventory_receipt_cohorts c on c.origin_id = o.id
                 join public.inventory_stock_facts current_fact on current_fact.id = c.current_fact_id
                 join public.inventory_storage_locations original_location on original_location.id = original.location_id
                 join public.inventory_storage_locations current_location on current_location.id = current_fact.location_id
                 where original.transaction_id = t.id
                    or exists (select 1 from public.inventory_stock_facts relevant where relevant.origin_id = o.id and relevant.transaction_id = t.id)
                    or exists (select 1 from public.inventory_transaction_lines tl where tl.cohort_id = o.id and tl.transaction_id = t.id)
                    or (t.operation = 'STOCKTAKE_ADJUST' and exists (
                         select 1 from public.inventory_stock_evidence ev
                         where ev.origin_id = o.id and ev.metadata->>'stocktake_reference' = substr(t.business_key, 11)
                       ))
               ) origin_detail
             ) as origins
      from public.inventory_transactions t
      join public.profiles p on p.id = t.actor_id
      where t.id = v_id
    ) sub;

    v_total := jsonb_array_length(v_rows);

  -- --------------------------------------------------------------------------
  -- 9.14 S2 Resource: Operation Stock (operation_stock)
  --      Bounded dimensional balances with cohort identity, monotonic revision, hold status
  -- --------------------------------------------------------------------------
  elsif p_resource = 'operation_stock' then
    select count(*) into v_total
    from public.inventory_stock_balances b
    join public.inventory_receipt_cohorts c on c.origin_id = b.cohort_id
    join public.inventory_stock_facts f on f.id = c.current_fact_id
    join public.inventory_stock_origins o on o.id = c.origin_id
    join public.inventory_catalog_items i on i.id = o.catalog_item_id
    join public.inventory_storage_locations l on l.id = b.location_id
    left join public.inventory_stock_holds h on h.origin_id = o.id and h.status = 'active'
    where (v_origin_id is null or o.id = v_origin_id)
      and (v_provenance_group is null or o.provenance_group = v_provenance_group)
      and (v_location_id is null or b.location_id = v_location_id)
      and (v_item_id is null or o.catalog_item_id = v_item_id)
      and (v_condition is null or b.condition = v_condition)
      and (v_active is null or (i.active = v_active and l.active = v_active))
      and (v_is_held is null or ((h.origin_id is not null) = v_is_held))
      and (v_include_held or h.origin_id is null)
      and (v_q = '' or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%' or l.code ilike '%' || v_q || '%' or l.name ilike '%' || v_q || '%');

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select b.cohort_id,
             o.id as origin_id,
             f.id as current_fact_id,
             f.version as current_version,
             c.revision as stock_revision,
             o.catalog_item_id,
             i.code as item_code,
             i.name as item_name,
             i.material_kind,
             i.expiry_required,
             i.base_uom_code,
             u.name as base_uom_name,
             b.location_id,
             l.code as location_code,
             l.name as location_name,
             b.condition,
             b.quantity::text as quantity,
             (h.origin_id is not null) as is_held,
             h.hold_reason,
             case when h.origin_id is not null or b.condition = 'damaged' or not i.active or not l.active
                       or f.expiry_precision = 'unknown'
                       or (f.expiry_date is not null and f.expiry_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date)
                  then '0.000000'
                  else private.s4_available(c.origin_id,b.location_id)::text end as available_quantity,
             f.expiry_precision,
             f.expiry_date,
             f.expiry_input,
             o.provenance_group,
             r.receipt_reference,
             ob.cutover_key,
             sr.surplus_reference,
             f.location_id as intake_location_id
      from public.inventory_stock_balances b
      join public.inventory_receipt_cohorts c on c.origin_id = b.cohort_id
      join public.inventory_stock_facts f on f.id = c.current_fact_id
      join public.inventory_stock_origins o on o.id = c.origin_id
      join public.inventory_catalog_items i on i.id = o.catalog_item_id
      join public.inventory_uoms u on u.code = i.base_uom_code
      join public.inventory_storage_locations l on l.id = b.location_id
      left join public.inventory_stock_holds h on h.origin_id = o.id and h.status = 'active'
      left join public.inventory_receipts r on r.id = o.receipt_id
      left join public.inventory_opening_batches ob on ob.id = o.opening_batch_id
      left join public.inventory_stocktake_surplus_records sr on sr.id = o.surplus_id
      where (v_origin_id is null or o.id = v_origin_id)
        and (v_provenance_group is null or o.provenance_group = v_provenance_group)
        and (v_location_id is null or b.location_id = v_location_id)
        and (v_item_id is null or o.catalog_item_id = v_item_id)
        and (v_condition is null or b.condition = v_condition)
        and (v_active is null or (i.active = v_active and l.active = v_active))
        and (v_is_held is null or ((h.origin_id is not null) = v_is_held))
        and (v_include_held or h.origin_id is null)
        and (v_q = '' or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%' or l.code ilike '%' || v_q || '%' or l.name ilike '%' || v_q || '%')
      order by
        case when v_sort = 'name_desc' then i.name end desc nulls last,
        case when v_sort = 'name_asc' then i.name end asc nulls last,
        case when v_sort = 'code_desc' then i.code end desc nulls last,
        case when v_sort = 'code_asc' then i.code end asc nulls last,
        case when v_sort not in ('name_desc', 'name_asc', 'code_desc', 'code_asc') then i.name end asc nulls last,
        l.name asc,
        b.condition asc,
        o.id asc
      limit v_page_size offset v_offset
    ) sub;

  -- --------------------------------------------------------------------------
  -- 9.15 S2 Resource: Stock Evidence (stock_evidence)
  -- --------------------------------------------------------------------------
  elsif p_resource = 'stock_evidence' then
    select count(*) into v_total
    from public.inventory_stock_evidence e
    where (v_origin_id is null or e.origin_id = v_origin_id);

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select e.id, e.origin_id, e.actor_id, p.full_name as actor_name,
             e.action, e.note, e.metadata, e.created_at
      from public.inventory_stock_evidence e
      join public.profiles p on p.id = e.actor_id
      where (v_origin_id is null or e.origin_id = v_origin_id)
      order by e.created_at desc, e.id desc
      limit v_page_size offset v_offset
    ) sub;

  else
    raise exception 'UNKNOWN_RESOURCE: Resource % is not supported in inventory_read', p_resource using errcode = '22023';
  end if;

  return jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'page', v_page,
    'page_size', v_page_size
  );
end;
$$;

-- Revoke and Grant for inventory_read
revoke all on function public.inventory_read(text, jsonb) from public, anon;
grant execute on function public.inventory_read(text, jsonb) to authenticated;
