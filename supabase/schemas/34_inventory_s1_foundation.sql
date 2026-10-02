-- ============================================================================
-- S1 INVENTORY FOUNDATION SCHEMA (DECLARATIVE)
-- Canonical References:
-- - plans/G0_S1_DESIGN_FREEZE_PACK.md
-- - plans/G0_S1_OPERATIONS.md
-- - plans/G0_S1_ACCEPTANCE_TRACEABILITY.md
-- - db/intended/drawdb/inventory.dbml
-- ============================================================================

-- Ensure required extensions are available
create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- 1. REFERENCE AND MASTER TABLES
-- ============================================================================

-- 1.1 Units of Measure (inventory_uoms)
create table if not exists public.inventory_uoms (
  code text primary key,
  name text not null,
  dimension text not null,
  allowed_scale smallint not null default 0,
  active boolean not null default true,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_uoms_code_not_blank check (btrim(code) <> ''),
  constraint inventory_uoms_name_not_blank check (btrim(name) <> ''),
  constraint inventory_uoms_dimension_valid check (dimension in ('count', 'volume', 'mass', 'package')),
  constraint inventory_uoms_scale_range check (allowed_scale between 0 and 6),
  constraint inventory_uoms_count_scale_zero check (dimension <> 'count' or allowed_scale = 0),
  constraint inventory_uoms_revision_positive check (revision >= 1)
);

-- 1.2 Categories (inventory_categories)
create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_categories_code_not_blank check (btrim(code) <> ''),
  constraint inventory_categories_name_not_blank check (btrim(name) <> ''),
  constraint inventory_categories_revision_positive check (revision >= 1)
);

-- 1.3 Suppliers (inventory_suppliers)
create table if not exists public.inventory_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_code text,
  contact text,
  notes text,
  active boolean not null default true,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_suppliers_name_not_blank check (btrim(name) <> ''),
  constraint inventory_suppliers_revision_positive check (revision >= 1)
);

-- 1.4 Catalog Items (inventory_catalog_items)
create table if not exists public.inventory_catalog_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category_id uuid not null references public.inventory_categories(id) on delete restrict,
  material_kind text not null,
  base_uom_code text not null references public.inventory_uoms(code) on delete restrict,
  tracking_strategy text not null,
  return_semantics text not null,
  expiry_required boolean not null,
  active boolean not null default true,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_catalog_items_code_not_blank check (btrim(code) <> ''),
  constraint inventory_catalog_items_name_not_blank check (btrim(name) <> ''),
  constraint inventory_catalog_items_material_kind_valid check (material_kind in ('chemical', 'other')),
  constraint inventory_catalog_items_tracking_strategy_valid check (tracking_strategy in ('quantity', 'serialized')),
  constraint inventory_catalog_items_return_semantics_valid check (return_semantics in ('returnable', 'nonreturnable', 'in_place')),
  constraint inventory_catalog_items_chemical_requires_expiry check (material_kind <> 'chemical' or expiry_required = true),
  constraint inventory_catalog_items_revision_positive check (revision >= 1)
);

-- 1.5 Storage Locations (inventory_storage_locations)
create table if not exists public.inventory_storage_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  parent_location_id uuid references public.inventory_storage_locations(id) on delete restrict,
  room_id uuid references public.rooms(id) on delete restrict,
  active boolean not null default true,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_storage_locations_code_not_blank check (btrim(code) <> ''),
  constraint inventory_storage_locations_name_not_blank check (btrim(name) <> ''),
  constraint inventory_storage_locations_no_self_parent check (parent_location_id is null or parent_location_id <> id),
  constraint inventory_storage_locations_revision_positive check (revision >= 1)
);

-- ============================================================================
-- 2. ACQUISITION AND PROVENANCE TABLES
-- ============================================================================

-- 2.1 Acquisition Records (acquisition_records)
create table if not exists public.acquisition_records (
  id uuid primary key default gen_random_uuid(),
  source_reference text not null unique,
  supplier_id uuid not null references public.inventory_suppliers(id) on delete restrict,
  reference_date date not null,
  funding_source text,
  external_reference text,
  notes text,
  status text not null default 'active',
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acquisition_records_reference_not_blank check (btrim(source_reference) <> ''),
  constraint acquisition_records_status_valid check (status in ('active', 'voided')),
  constraint acquisition_records_revision_positive check (revision >= 1)
);

-- 2.2 Acquisition Record Lines (acquisition_record_lines)
create table if not exists public.acquisition_record_lines (
  id uuid primary key default gen_random_uuid(),
  acquisition_record_id uuid not null references public.acquisition_records(id) on delete restrict,
  line_key text not null,
  catalog_item_id uuid not null references public.inventory_catalog_items(id) on delete restrict,
  expected_purchase_quantity numeric(18,6) not null,
  purchase_uom_code text not null references public.inventory_uoms(code) on delete restrict,
  expected_conversion_factor numeric(18,6),
  unit_cost numeric(20,4),
  currency_code text,
  manufacturer text,
  model text,
  country_of_origin text,
  warranty_start date,
  warranty_end date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acquisition_record_lines_unique_key unique (acquisition_record_id, line_key),
  constraint acquisition_record_lines_line_key_not_blank check (btrim(line_key) <> ''),
  constraint acquisition_record_lines_qty_positive check (expected_purchase_quantity > 0),
  constraint acquisition_record_lines_factor_positive check (expected_conversion_factor is null or expected_conversion_factor > 0),
  constraint acquisition_record_lines_cost_nonnegative check (unit_cost is null or unit_cost >= 0),
  constraint acquisition_record_lines_warranty_order check (warranty_start is null or warranty_end is null or warranty_end >= warranty_start),
  constraint acquisition_record_lines_cost_currency_paired check (
    (unit_cost is null and currency_code is null) or
    (unit_cost is not null and currency_code is not null and btrim(currency_code) <> '')
  )
);

-- ============================================================================
-- 3. PHYSICAL TRANSACTIONS AND INTAKE DOCUMENTS
-- ============================================================================

-- 3.1 Inventory Transactions (inventory_transactions)
create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  operation text not null,
  business_key text not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null,
  posted_at timestamptz not null default now(),
  reason text,
  corrects_transaction_id uuid references public.inventory_transactions(id) on delete restrict,
  constraint inventory_transactions_unique_operation_bizkey unique (operation, business_key),
  constraint inventory_transactions_operation_valid check (
    operation in ('RECEIVE', 'OPENING', 'CORRECT_RECEIPT', 'REVERSE_RECEIPT', 'CORRECT_OPENING')
  ),
  constraint inventory_transactions_business_key_not_blank check (btrim(business_key) <> '')
);

-- 3.2 Inventory Receipts (inventory_receipts)
create table if not exists public.inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_reference text not null unique,
  transaction_id uuid not null unique references public.inventory_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint inventory_receipts_reference_not_blank check (btrim(receipt_reference) <> '')
);

-- 3.3 Inventory Opening Batches (inventory_opening_batches)
create table if not exists public.inventory_opening_batches (
  id uuid primary key default gen_random_uuid(),
  cutover_key text not null unique,
  scope_description text not null,
  count_cutoff timestamptz not null,
  provenance_note text not null,
  synthetic boolean not null,
  transaction_id uuid not null unique references public.inventory_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint inventory_opening_batches_key_not_blank check (btrim(cutover_key) <> ''),
  constraint inventory_opening_batches_scope_not_blank check (btrim(scope_description) <> ''),
  constraint inventory_opening_batches_provenance_not_blank check (btrim(provenance_note) <> '')
);

-- 3.4 Inventory Opening Scope (inventory_opening_scope)
create table if not exists public.inventory_opening_scope (
  opening_batch_id uuid not null references public.inventory_opening_batches(id) on delete restrict,
  catalog_item_id uuid not null references public.inventory_catalog_items(id) on delete restrict,
  location_id uuid not null references public.inventory_storage_locations(id) on delete restrict,
  primary key (opening_batch_id, catalog_item_id, location_id),
  constraint inventory_opening_scope_unique_item_location unique (catalog_item_id, location_id)
);

-- ============================================================================
-- 4. STOCK ORIGINS, FACTS, AND COHORTS
-- ============================================================================

-- 4.1 Inventory Stock Origins (inventory_stock_origins)
create table if not exists public.inventory_stock_origins (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid references public.inventory_receipts(id) on delete restrict,
  opening_batch_id uuid references public.inventory_opening_batches(id) on delete restrict,
  line_key text not null,
  provenance_group text not null,
  catalog_item_id uuid not null references public.inventory_catalog_items(id) on delete restrict,
  source_line_id uuid references public.acquisition_record_lines(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint inventory_stock_origins_one_intake check (
    (receipt_id is not null and opening_batch_id is null) or
    (receipt_id is null and opening_batch_id is not null)
  ),
  constraint inventory_stock_origins_unique_receipt_line unique (receipt_id, line_key),
  constraint inventory_stock_origins_unique_opening_line unique (opening_batch_id, line_key),
  constraint inventory_stock_origins_line_key_not_blank check (btrim(line_key) <> ''),
  constraint inventory_stock_origins_provenance_group_not_blank check (btrim(provenance_group) <> '')
);

-- 4.2 Inventory Stock Facts (inventory_stock_facts)
create table if not exists public.inventory_stock_facts (
  id uuid primary key default gen_random_uuid(),
  origin_id uuid not null references public.inventory_stock_origins(id) on delete restrict,
  version bigint not null,
  previous_fact_id uuid unique references public.inventory_stock_facts(id) on delete restrict,
  transaction_id uuid not null references public.inventory_transactions(id) on delete restrict,
  location_id uuid not null references public.inventory_storage_locations(id) on delete restrict,
  base_uom_code text not null references public.inventory_uoms(code) on delete restrict,
  purchase_quantity numeric(18,6),
  purchase_uom_code text references public.inventory_uoms(code) on delete restrict,
  conversion_factor numeric(18,6),
  base_quantity numeric(18,6) not null,
  good_quantity numeric(18,6) not null,
  damaged_quantity numeric(18,6) not null,
  expiry_precision text not null,
  expiry_input text,
  expiry_date date,
  source_snapshot jsonb not null default '{}'::jsonb,
  evidence_note text,
  created_at timestamptz not null default now(),
  constraint inventory_stock_facts_unique_origin_version unique (origin_id, version),
  constraint inventory_stock_facts_unique_origin_id unique (origin_id, id),
  constraint inventory_stock_facts_version_nonnegative check (version >= 0),
  constraint inventory_stock_facts_purchase_qty_nonnegative check (purchase_quantity is null or purchase_quantity >= 0),
  constraint inventory_stock_facts_conversion_factor_positive check (conversion_factor is null or conversion_factor > 0),
  constraint inventory_stock_facts_base_qty_nonnegative check (base_quantity >= 0),
  constraint inventory_stock_facts_good_qty_nonnegative check (good_quantity >= 0),
  constraint inventory_stock_facts_damaged_qty_nonnegative check (damaged_quantity >= 0),
  constraint inventory_stock_facts_base_sum_exact check (base_quantity = good_quantity + damaged_quantity),
  constraint inventory_stock_facts_expiry_precision_valid check (
    expiry_precision in ('not_required', 'day', 'month', 'unknown')
  ),
  constraint inventory_stock_facts_expiry_date_paired check (
    (expiry_precision in ('not_required', 'unknown') and expiry_date is null) or
    (expiry_precision in ('day', 'month') and expiry_date is not null)
  )
);

-- 4.3 Inventory Receipt Cohorts (inventory_receipt_cohorts)
create table if not exists public.inventory_receipt_cohorts (
  origin_id uuid primary key references public.inventory_stock_origins(id) on delete restrict,
  current_fact_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_receipt_cohorts_origin_fact_fk foreign key (origin_id, current_fact_id)
    references public.inventory_stock_facts(origin_id, id) on delete restrict
);

-- ============================================================================
-- 5. LEDGER LINES, BALANCES, AND REPLAYS
-- ============================================================================

-- 5.1 Inventory Transaction Lines (inventory_transaction_lines)
create table if not exists public.inventory_transaction_lines (
  transaction_id uuid not null references public.inventory_transactions(id) on delete restrict,
  line_no int not null,
  cohort_id uuid not null references public.inventory_receipt_cohorts(origin_id) on delete restrict,
  catalog_item_id uuid not null references public.inventory_catalog_items(id) on delete restrict,
  location_id uuid not null references public.inventory_storage_locations(id) on delete restrict,
  condition text not null,
  quantity_delta numeric(18,6) not null,
  created_at timestamptz not null default now(),
  primary key (transaction_id, line_no),
  constraint inventory_transaction_lines_line_no_positive check (line_no >= 1),
  constraint inventory_transaction_lines_condition_valid check (condition in ('good', 'damaged')),
  constraint inventory_transaction_lines_delta_nonzero check (quantity_delta <> 0)
);

-- 5.2 Inventory Stock Balances (inventory_stock_balances)
create table if not exists public.inventory_stock_balances (
  cohort_id uuid not null references public.inventory_receipt_cohorts(origin_id) on delete restrict,
  location_id uuid not null references public.inventory_storage_locations(id) on delete restrict,
  condition text not null,
  quantity numeric(18,6) not null,
  updated_at timestamptz not null default now(),
  primary key (cohort_id, location_id, condition),
  constraint inventory_stock_balances_condition_valid check (condition in ('good', 'damaged')),
  constraint inventory_stock_balances_quantity_nonnegative check (quantity >= 0)
);

-- 5.3 Inventory Operation Replays (inventory_operation_replays)
create table if not exists public.inventory_operation_replays (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation text not null,
  retry_key uuid not null,
  payload_hash text not null,
  result_ids jsonb not null,
  committed_at timestamptz not null default now(),
  primary key (actor_id, operation, retry_key)
);

-- ============================================================================
-- 6. INDEXES
-- ============================================================================

create index if not exists idx_catalog_items_category on public.inventory_catalog_items(category_id);
create index if not exists idx_catalog_items_base_uom on public.inventory_catalog_items(base_uom_code);
create index if not exists idx_catalog_items_active on public.inventory_catalog_items(active);

create index if not exists idx_storage_locations_parent on public.inventory_storage_locations(parent_location_id);
create index if not exists idx_storage_locations_room on public.inventory_storage_locations(room_id);

create index if not exists idx_acquisition_records_supplier on public.acquisition_records(supplier_id);
create index if not exists idx_acquisition_records_ref_date on public.acquisition_records(reference_date);

create index if not exists idx_acquisition_record_lines_record on public.acquisition_record_lines(acquisition_record_id);
create index if not exists idx_acquisition_record_lines_item on public.acquisition_record_lines(catalog_item_id);

create index if not exists idx_inventory_tx_posted on public.inventory_transactions(posted_at desc);
create index if not exists idx_inventory_tx_actor on public.inventory_transactions(actor_id);
create index if not exists idx_inventory_tx_corrects on public.inventory_transactions(corrects_transaction_id);

create index if not exists idx_stock_origins_item on public.inventory_stock_origins(catalog_item_id);
create index if not exists idx_stock_origins_source_line on public.inventory_stock_origins(source_line_id);

create index if not exists idx_stock_facts_origin on public.inventory_stock_facts(origin_id, version desc);
create index if not exists idx_stock_facts_tx on public.inventory_stock_facts(transaction_id);
create index if not exists idx_stock_facts_location on public.inventory_stock_facts(location_id);
create index if not exists idx_stock_facts_expiry on public.inventory_stock_facts(expiry_date);

create index if not exists idx_tx_lines_cohort on public.inventory_transaction_lines(cohort_id);
create index if not exists idx_tx_lines_item on public.inventory_transaction_lines(catalog_item_id);
create index if not exists idx_tx_lines_location on public.inventory_transaction_lines(location_id);

create index if not exists idx_balances_location on public.inventory_stock_balances(location_id);

-- ============================================================================
-- 7. IMMUTABILITY AND INTEGRITY TRIGGERS
-- ============================================================================

-- 7.1 Generic history immutability trigger
create or replace function private.prevent_inventory_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'TABLE_IMMUTABLE: % records are immutable and cannot be updated or deleted', tg_table_name
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_prevent_tx_mutation on public.inventory_transactions;
create trigger trg_prevent_tx_mutation
before update or delete on public.inventory_transactions
for each row execute function private.prevent_inventory_history_mutation();

drop trigger if exists trg_prevent_receipt_mutation on public.inventory_receipts;
create trigger trg_prevent_receipt_mutation
before update or delete on public.inventory_receipts
for each row execute function private.prevent_inventory_history_mutation();

drop trigger if exists trg_prevent_opening_batch_mutation on public.inventory_opening_batches;
create trigger trg_prevent_opening_batch_mutation
before update or delete on public.inventory_opening_batches
for each row execute function private.prevent_inventory_history_mutation();

drop trigger if exists trg_prevent_stock_origin_mutation on public.inventory_stock_origins;
create trigger trg_prevent_stock_origin_mutation
before update or delete on public.inventory_stock_origins
for each row execute function private.prevent_inventory_history_mutation();

drop trigger if exists trg_prevent_stock_fact_mutation on public.inventory_stock_facts;
create trigger trg_prevent_stock_fact_mutation
before update or delete on public.inventory_stock_facts
for each row execute function private.prevent_inventory_history_mutation();

drop trigger if exists trg_prevent_tx_line_mutation on public.inventory_transaction_lines;
create trigger trg_prevent_tx_line_mutation
before update or delete on public.inventory_transaction_lines
for each row execute function private.prevent_inventory_history_mutation();

drop trigger if exists trg_prevent_operation_replay_mutation on public.inventory_operation_replays;
create trigger trg_prevent_operation_replay_mutation
before update or delete on public.inventory_operation_replays
for each row execute function private.prevent_inventory_history_mutation();

-- 7.2 Cohort mutation guard: prevent delete, restrict update to current_fact_id
create or replace function private.guard_inventory_cohort_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'TABLE_IMMUTABLE: Cohort records cannot be deleted'
      using errcode = '42501';
  elsif tg_op = 'UPDATE' then
    if new.origin_id <> old.origin_id then
      raise exception 'COHORT_ORIGIN_IMMUTABLE: Cohort origin_id cannot be modified'
        using errcode = '42501';
    end if;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_cohort_mutation on public.inventory_receipt_cohorts;
create trigger trg_guard_cohort_mutation
before update or delete on public.inventory_receipt_cohorts
for each row execute function private.guard_inventory_cohort_mutation();

-- 7.3 Opening scope mutation guard: append-only
create or replace function private.guard_inventory_opening_scope_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'UPDATE' then
    raise exception 'TABLE_IMMUTABLE: Opening scope claims are append-only'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_opening_scope_mutation on public.inventory_opening_scope;
create trigger trg_guard_opening_scope_mutation
before update or delete on public.inventory_opening_scope
for each row execute function private.guard_inventory_opening_scope_mutation();

-- 7.4 Location hierarchy cycle guard
create or replace function private.guard_inventory_location_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid;
  v_depth integer := 0;
begin
  if new.parent_location_id is null then
    return new;
  end if;
  if new.parent_location_id = new.id then
    raise exception 'CYCLIC_LOCATION_DETECTED: Location cannot be parent of itself'
      using errcode = '23514';
  end if;
  v_current := new.parent_location_id;
  while v_current is not null loop
    v_depth := v_depth + 1;
    if v_depth > 100 then
      raise exception 'CYCLIC_LOCATION_DETECTED: Hierarchy depth limit exceeded'
        using errcode = '23514';
    end if;
    select parent_location_id into v_current
    from public.inventory_storage_locations
    where id = v_current;

    if v_current = new.id then
      raise exception 'CYCLIC_LOCATION_DETECTED: Location cannot be an ancestor of itself'
        using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_guard_location_hierarchy on public.inventory_storage_locations;
create trigger trg_guard_location_hierarchy
before insert or update of parent_location_id on public.inventory_storage_locations
for each row execute function private.guard_inventory_location_hierarchy();

-- 7.5 Catalog item sensitive axes mutation guard
create or replace function private.guard_inventory_catalog_item_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_facts boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'TABLE_IMMUTABLE: Catalog items cannot be deleted'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.code <> old.code then
      raise exception 'IMMUTABLE_IDENTITY: Catalog item identity and code cannot be modified'
        using errcode = '42501';
    end if;

    if new.material_kind = 'chemical' and not new.expiry_required then
      raise exception 'INVALID_EXPIRY_POLICY: Chemical material kind requires expiry_required=true'
        using errcode = '22023';
    end if;

    select exists (
      select 1
      from public.inventory_stock_origins
      where catalog_item_id = old.id
    ) into v_has_facts;

    if v_has_facts then
      if new.base_uom_code <> old.base_uom_code
        or new.material_kind <> old.material_kind
        or new.tracking_strategy <> old.tracking_strategy
        or new.return_semantics <> old.return_semantics
        or new.expiry_required <> old.expiry_required then
        raise exception 'SENSITIVE_AXES_LOCKED: Cannot modify base UOM, material kind, tracking, return semantics, or expiry requirement after stock facts exist'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_catalog_item_mutation on public.inventory_catalog_items;
create trigger trg_guard_catalog_item_mutation
before update or delete on public.inventory_catalog_items
for each row execute function private.guard_inventory_catalog_item_mutation();

-- 7.6 UOM immutability guard for referenced items
create or replace function private.guard_inventory_uom_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in_use boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'TABLE_IMMUTABLE: UOMs cannot be deleted'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.code <> old.code then
      raise exception 'IMMUTABLE_IDENTITY: UOM code cannot be modified'
        using errcode = '42501';
    end if;

    if new.dimension <> old.dimension or new.allowed_scale <> old.allowed_scale then
      select exists (
        select 1 from public.inventory_catalog_items where base_uom_code = old.code
        union all
        select 1 from public.acquisition_record_lines where purchase_uom_code = old.code
        union all
        select 1 from public.inventory_stock_facts where base_uom_code = old.code or purchase_uom_code = old.code
      ) into v_in_use;

      if v_in_use then
        raise exception 'UOM_IN_USE: Dimension and allowed scale cannot be modified once UOM is referenced'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_uom_mutation on public.inventory_uoms;
create trigger trg_guard_uom_mutation
before update or delete on public.inventory_uoms
for each row execute function private.guard_inventory_uom_mutation();

-- 7.7 Acquisition line retargeting guard
create or replace function private.guard_acquisition_record_line_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_origins boolean;
begin
  if tg_op = 'DELETE' then
    select exists (
      select 1 from public.inventory_stock_origins where source_line_id = old.id
    ) into v_has_origins;
    if v_has_origins then
      raise exception 'SOURCE_LINE_IN_USE: Cannot delete acquisition line referenced by inventory origins'
        using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.catalog_item_id <> old.catalog_item_id then
      select exists (
        select 1 from public.inventory_stock_origins where source_line_id = old.id
      ) into v_has_origins;
      if v_has_origins then
        raise exception 'SOURCE_LINE_IN_USE: Cannot retarget catalog item after inventory origins exist'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_acquisition_line_mutation on public.acquisition_record_lines;
create trigger trg_guard_acquisition_line_mutation
before update or delete on public.acquisition_record_lines
for each row execute function private.guard_acquisition_record_line_mutation();

-- ============================================================================
-- 8. ROW LEVEL SECURITY (RLS) AND PERMISSIONS
-- ============================================================================

-- Helper authorization functions in private schema
create or replace function private.can_access_inventory()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_active_user())
    and exists (
      select 1
      from public.user_roles
      where user_id = (select auth.uid())
        and role in ('admin', 'staff')
    );
$$;

create or replace function private.is_inventory_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_active_user())
    and exists (
      select 1
      from public.user_roles
      where user_id = (select auth.uid())
        and role = 'admin'
    );
$$;

-- Enable RLS on all 17 tables
alter table public.inventory_uoms enable row level security;
alter table public.inventory_categories enable row level security;
alter table public.inventory_suppliers enable row level security;
alter table public.inventory_catalog_items enable row level security;
alter table public.inventory_storage_locations enable row level security;
alter table public.acquisition_records enable row level security;
alter table public.acquisition_record_lines enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.inventory_receipts enable row level security;
alter table public.inventory_opening_batches enable row level security;
alter table public.inventory_opening_scope enable row level security;
alter table public.inventory_stock_origins enable row level security;
alter table public.inventory_stock_facts enable row level security;
alter table public.inventory_receipt_cohorts enable row level security;
alter table public.inventory_transaction_lines enable row level security;
alter table public.inventory_stock_balances enable row level security;
alter table public.inventory_operation_replays enable row level security;

-- Read policies for active Admin and Staff (INV-018)
drop policy if exists inventory_uoms_select on public.inventory_uoms;
create policy inventory_uoms_select on public.inventory_uoms
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_categories_select on public.inventory_categories;
create policy inventory_categories_select on public.inventory_categories
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_suppliers_select on public.inventory_suppliers;
create policy inventory_suppliers_select on public.inventory_suppliers
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_catalog_items_select on public.inventory_catalog_items;
create policy inventory_catalog_items_select on public.inventory_catalog_items
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_storage_locations_select on public.inventory_storage_locations;
create policy inventory_storage_locations_select on public.inventory_storage_locations
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists acquisition_records_select on public.acquisition_records;
create policy acquisition_records_select on public.acquisition_records
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists acquisition_record_lines_select on public.acquisition_record_lines;
create policy acquisition_record_lines_select on public.acquisition_record_lines
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_transactions_select on public.inventory_transactions;
create policy inventory_transactions_select on public.inventory_transactions
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_receipts_select on public.inventory_receipts;
create policy inventory_receipts_select on public.inventory_receipts
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_opening_batches_select on public.inventory_opening_batches;
create policy inventory_opening_batches_select on public.inventory_opening_batches
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_opening_scope_select on public.inventory_opening_scope;
create policy inventory_opening_scope_select on public.inventory_opening_scope
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_stock_origins_select on public.inventory_stock_origins;
create policy inventory_stock_origins_select on public.inventory_stock_origins
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_stock_facts_select on public.inventory_stock_facts;
create policy inventory_stock_facts_select on public.inventory_stock_facts
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_receipt_cohorts_select on public.inventory_receipt_cohorts;
create policy inventory_receipt_cohorts_select on public.inventory_receipt_cohorts
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_transaction_lines_select on public.inventory_transaction_lines;
create policy inventory_transaction_lines_select on public.inventory_transaction_lines
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_stock_balances_select on public.inventory_stock_balances;
create policy inventory_stock_balances_select on public.inventory_stock_balances
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists inventory_operation_replays_select on public.inventory_operation_replays;
create policy inventory_operation_replays_select on public.inventory_operation_replays
for select to authenticated using (
  (select private.can_access_inventory()) and actor_id = (select auth.uid())
);

-- Deny direct table mutations from public/anon/authenticated:
-- Only SELECT is granted to authenticated. No INSERT/UPDATE/DELETE grants.
revoke insert, update, delete on table
  public.inventory_uoms,
  public.inventory_categories,
  public.inventory_suppliers,
  public.inventory_catalog_items,
  public.inventory_storage_locations,
  public.acquisition_records,
  public.acquisition_record_lines,
  public.inventory_transactions,
  public.inventory_receipts,
  public.inventory_opening_batches,
  public.inventory_opening_scope,
  public.inventory_stock_origins,
  public.inventory_stock_facts,
  public.inventory_receipt_cohorts,
  public.inventory_transaction_lines,
  public.inventory_stock_balances,
  public.inventory_operation_replays
from public, anon, authenticated;

grant select on table
  public.inventory_uoms,
  public.inventory_categories,
  public.inventory_suppliers,
  public.inventory_catalog_items,
  public.inventory_storage_locations,
  public.acquisition_records,
  public.acquisition_record_lines,
  public.inventory_transactions,
  public.inventory_receipts,
  public.inventory_opening_batches,
  public.inventory_opening_scope,
  public.inventory_stock_origins,
  public.inventory_stock_facts,
  public.inventory_receipt_cohorts,
  public.inventory_transaction_lines,
  public.inventory_stock_balances,
  public.inventory_operation_replays
to authenticated;

-- ============================================================================
-- 9. VALIDATION AND HELPER FUNCTIONS
-- ============================================================================

-- 9.1 Decimal validation helper
create or replace function private.inventory_validate_decimal(
  p_val text,
  p_scale_limit integer,
  p_must_be_positive boolean default false
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_num numeric;
  v_scale integer := 0;
  v_parts text[];
begin
  if p_val is null or btrim(p_val) = '' then
    raise exception 'INVALID_DECIMAL: Quantity cannot be null or empty'
      using errcode = '22023';
  end if;

  if p_val !~ '^[0-9]+(\.[0-9]+)?$' then
    raise exception 'INVALID_DECIMAL: Value % is not a valid canonical decimal', p_val
      using errcode = '22023';
  end if;

  if position('.' in p_val) > 0 then
    v_parts := string_to_array(p_val, '.');
    v_scale := length(v_parts[2]);
  else
    v_scale := 0;
  end if;

  if v_scale > 6 then
    raise exception 'INVALID_DECIMAL: Decimal scale % exceeds storage scale 6 for value %', v_scale, p_val
      using errcode = '22023';
  end if;

  v_num := p_val::numeric;
  if scale(trim_scale(v_num)) > p_scale_limit then
    raise exception 'INVALID_DECIMAL: Value % exceeds allowed UOM scale %', p_val, p_scale_limit
      using errcode = '22023';
  end if;


  if v_num > 999999999999.999999 then
    raise exception 'INVALID_DECIMAL: Value % exceeds maximum magnitude 999999999999.999999', p_val
      using errcode = '22023';
  end if;

  if p_must_be_positive and v_num <= 0 then
    raise exception 'INVALID_DECIMAL: Value % must be strictly positive', p_val
      using errcode = '22023';
  elsif v_num < 0 then
    raise exception 'INVALID_DECIMAL: Value % cannot be negative', p_val
      using errcode = '22023';
  end if;

  return v_num;
end;
$$;

-- 9.2 Unit cost validation helper
create or replace function private.inventory_validate_cost(
  p_cost text,
  p_currency text
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_num numeric;
  v_scale integer := 0;
  v_parts text[];
begin
  if p_cost is null and p_currency is null then
    return null;
  end if;

  if (p_cost is null and p_currency is not null) or (p_cost is not null and p_currency is null) then
    raise exception 'INVALID_COST: Unit cost and currency code must be provided together'
      using errcode = '22023';
  end if;

  if p_cost !~ '^[0-9]+(\.[0-9]+)?$' then
    raise exception 'INVALID_COST: Cost % is not a valid canonical decimal', p_cost
      using errcode = '22023';
  end if;

  if position('.' in p_cost) > 0 then
    v_parts := string_to_array(p_cost, '.');
    v_scale := length(v_parts[2]);
  else
    v_scale := 0;
  end if;

  if v_scale > 4 then
    raise exception 'INVALID_COST: Unit cost scale % exceeds allowed 4 decimals', v_scale
      using errcode = '22023';
  end if;

  v_num := p_cost::numeric;
  if v_num < 0 or v_num > 9999999999999999.9999 then
    raise exception 'INVALID_COST: Cost out of bounds'
      using errcode = '22023';
  end if;

  if btrim(p_currency) = '' then
    raise exception 'INVALID_COST: Currency code cannot be blank'
      using errcode = '22023';
  end if;

  return v_num;
end;
$$;

-- 9.3 Expiry date normalization helper
create or replace function private.inventory_normalize_expiry(
  p_precision text,
  p_input text,
  p_allow_unknown boolean default false
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_date date;
  v_month_start date;
begin
  if p_precision = 'not_required' then
    if p_input is not null and btrim(p_input) <> '' then
      raise exception 'INVALID_EXPIRY: Expiry input must be null when precision is not_required'
        using errcode = '22023';
    end if;
    return null;
  elsif p_precision = 'unknown' then
    if not p_allow_unknown then
      raise exception 'INVALID_EXPIRY: Unknown expiry precision is only allowed for opening balances'
        using errcode = '22023';
    end if;
    if p_input is not null and btrim(p_input) <> '' then
      raise exception 'INVALID_EXPIRY: Expiry input must be null when precision is unknown'
        using errcode = '22023';
    end if;
    return null;
  elsif p_precision = 'day' then
    if p_input is null or p_input !~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' then
      raise exception 'INVALID_EXPIRY: Day precision requires format YYYY-MM-DD'
        using errcode = '22023';
    end if;
    begin
      v_date := to_date(p_input, 'YYYY-MM-DD');
    exception when others then
      raise exception 'INVALID_EXPIRY: Invalid calendar date %', p_input
        using errcode = '22023';
    end;
    if to_char(v_date, 'YYYY-MM-DD') <> p_input then
      raise exception 'INVALID_EXPIRY: Invalid calendar day %', p_input
        using errcode = '22023';
    end if;
    return v_date;
  elsif p_precision = 'month' then
    if p_input is null or p_input !~ '^\d{4}-(0[1-9]|1[0-2])$' then
      raise exception 'INVALID_EXPIRY: Month precision requires format YYYY-MM'
        using errcode = '22023';
    end if;
    begin
      v_month_start := to_date(p_input || '-01', 'YYYY-MM-DD');
    exception when others then
      raise exception 'INVALID_EXPIRY: Invalid month %', p_input
        using errcode = '22023';
    end;
    v_date := (v_month_start + interval '1 month - 1 day')::date;
    return v_date;
  else
    raise exception 'INVALID_EXPIRY: Unsupported precision %', p_precision
      using errcode = '22023';
  end if;
end;
$$;

-- ============================================================================
-- 10. TYPED COMMAND DISPATCHER (public.inventory_command)
-- ============================================================================

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

-- Revoke and Grant for inventory_command
revoke all on function public.inventory_command(text, jsonb, uuid) from public, anon;
grant execute on function public.inventory_command(text, jsonb, uuid) to authenticated;

-- ============================================================================
-- 11. RICH PAGINATED READ MODELS (public.inventory_read)
-- ============================================================================

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

   elsif p_resource = 'summary' then
     v_total := 1;
     select jsonb_build_array(
       jsonb_build_object(
         'active_item_count', (select count(*) from public.inventory_catalog_items where active = true),
         'active_source_count', (select count(*) from public.acquisition_records where status = 'active')
       )
     ) into v_rows;

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
         or (v_expiry_state = 'eligible' and sum(case when b.condition = 'good' and i.active and l.active and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date) and f.expiry_precision <> 'unknown' then b.quantity else 0 end) > 0)
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
                       then b.quantity else 0 end)::text as eligible_quantity,
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
         or (v_expiry_state = 'eligible' and sum(case when b.condition = 'good' and i.active and l.active and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date) and f.expiry_precision <> 'unknown' then b.quantity else 0 end) > 0)
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

   elsif p_resource = 'cohorts' then
     select count(*) into v_total
     from public.inventory_receipt_cohorts c
     join public.inventory_stock_origins o on o.id = c.origin_id
     join public.inventory_stock_facts f on f.id = c.current_fact_id
     join public.inventory_catalog_items i on i.id = o.catalog_item_id
     where (v_origin_id is null or o.id = v_origin_id)
       and (v_item_id is null or o.catalog_item_id = v_item_id)
       and (v_location_id is null or f.location_id = v_location_id)
       and (
         v_expiry_state is null
         or (v_expiry_state = 'expired' and f.expiry_date is not null and f.expiry_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date)
         or (v_expiry_state = 'unknown' and f.expiry_precision = 'unknown')
         or (v_expiry_state = 'eligible' and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date) and f.expiry_precision <> 'unknown')
       )
       and (v_q = '' or o.line_key ilike '%' || v_q || '%' or i.code ilike '%' || v_q || '%' or i.name ilike '%' || v_q || '%');

     select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
     from (
       select c.origin_id,
              coalesce(f0.transaction_id, f.transaction_id) as transaction_id,
              f.id as current_fact_id,
              f.version as current_version,
              o.line_key,
              o.provenance_group,
              o.catalog_item_id,
              i.code as item_code,
              i.name as item_name,
              f.base_uom_code,
              r.receipt_reference,
              ob.cutover_key,
              f.location_id as current_location_id,
              l.code as current_location_code,
              l.name as current_location_name,
              f.expiry_precision as current_expiry_precision,
              f.expiry_date as current_expiry_date,
              f.expiry_input,
              coalesce((select sum(b.quantity)::text from public.inventory_stock_balances b where b.cohort_id = c.origin_id and b.condition = 'good'), '0') as good_balance,
              coalesce((select sum(b.quantity)::text from public.inventory_stock_balances b where b.cohort_id = c.origin_id and b.condition = 'damaged'), '0') as damaged_balance,
              coalesce((select sum(b.quantity)::text from public.inventory_stock_balances b where b.cohort_id = c.origin_id), '0') as physical_balance,
              case
                when i.active and l.active
                     and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)
                     and f.expiry_precision <> 'unknown'
                then coalesce((select sum(b.quantity)::text from public.inventory_stock_balances b where b.cohort_id = c.origin_id and b.condition = 'good'), '0')
                else '0'
              end as eligible_balance,
              coalesce(f0.base_quantity, f.base_quantity)::text as origin_base_quantity,
              f.good_quantity::text as current_good_quantity,
              f.damaged_quantity::text as current_damaged_quantity,
              coalesce((select sum(b.quantity)::text from public.inventory_stock_balances b where b.cohort_id = c.origin_id), '0') as remaining_quantity,
              c.created_at,
              c.updated_at
       from public.inventory_receipt_cohorts c
       join public.inventory_stock_origins o on o.id = c.origin_id
       join public.inventory_stock_facts f on f.id = c.current_fact_id
       left join public.inventory_stock_facts f0 on f0.origin_id = c.origin_id and f0.version = 0
       left join public.inventory_transactions t0 on t0.id = f0.transaction_id
       join public.inventory_catalog_items i on i.id = o.catalog_item_id
       join public.inventory_storage_locations l on l.id = f.location_id
       left join public.inventory_receipts r on r.id = o.receipt_id
       left join public.inventory_opening_batches ob on ob.id = o.opening_batch_id
       where (v_origin_id is null or o.id = v_origin_id)
         and (v_item_id is null or o.catalog_item_id = v_item_id)
         and (v_location_id is null or f.location_id = v_location_id)
         and (
           v_expiry_state is null
           or (v_expiry_state = 'expired' and f.expiry_date is not null and f.expiry_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date)
           or (v_expiry_state = 'unknown' and f.expiry_precision = 'unknown')
           or (v_expiry_state = 'eligible' and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date) and f.expiry_precision <> 'unknown')
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
                ) origin_detail
              ) as origins
       from public.inventory_transactions t
       join public.profiles p on p.id = t.actor_id
       where t.id = v_id
     ) sub;

     v_total := jsonb_array_length(v_rows);

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
