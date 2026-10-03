-- ============================================================================
-- Migration: 20261003064848_inventory_s3_assets.sql
-- Description: S3 Serialized Asset + QR Persistence and Operations Schema
--   - Extend inventory_transactions operation check constraint with ASSET operations:
--       * ASSET_RECEIVE, ASSET_OPEN, ASSET_SET_STATE, ASSET_SET_LIFECYCLE, ASSET_CORRECT
--   - Create equipment_assets table (canonical physical identity, outside quantity balance):
--       * Immutable server-generated code matching EIU-AST-[0-9A-F]{8}
--       * Qualified serial uniqueness: lower(manufacturer) + lower(model) + lower(serial) across SKUs
--       * Mandatory maker and model if serial present, nullable serial permitted
--       * Immutable intake business identity (intake_kind, intake_reference, row_key)
--       * Monotonic positive revision, lifecycle_status, operational_status, normalized expiry
--   - Create equipment_asset_events table (immutable event log):
--       * Asset revision, operation, actor, occurred/posted timestamps, reason, evidence_note
--       * Strict before/after state snapshots, optional corrects_event_id
--       * Links to shared inventory_transactions (transaction_id), ZERO quantity lines
--   - Indexes for paging, filtering, lookups, and duplicate key checks
--   - Mutation guards:
--       * Immutability trigger on equipment_asset_events (no UPDATE/DELETE)
--       * Immutability and monotonic revision guard on equipment_assets (no DELETE, identity locked)
--       * Narrow first-fact guard on inventory_catalog_items (sensitive axes locked if asset facts exist)
--       * Narrow first-fact guard on acquisition_record_lines (cannot delete or retarget if asset facts exist)
--   - Derived eligibility helper private.inventory_asset_eligibility:
--       * Lifecycle in_service, operational ready, active item/location, required expiry verified/unexpired
--       * Returns boolean eligible and ineligibility_reasons text array
--   - RLS select policies and explicit mutation revokes for authenticated
--   - Dispatcher public.equipment_asset_command:
--       * Conservative inventory writer lock (inventory:s1:writer)
--       * Active Admin/Staff authentication and profile lock
--       * Privilege checks BEFORE replay:
--           - open_asset: Admin only
--           - set_asset_lifecycle: Admin only
--           - correct_asset: Admin required for open intake or items with required expiry
--       * Advisory lock on retry_key and replay payload/op mismatch detection
--       * Operations: receive_asset, open_asset, set_asset_state, set_asset_lifecycle, correct_asset
--       * Appends audit log in the same transaction
--       * Returns {id, asset_code, revision, event_id, transaction_id}
--   - Bounded read RPC public.equipment_asset_read:
--       * Authenticated active Admin/Staff access
--       * Resources: 'assets', 'detail', 'lookup', 'history'
--       * Clamped pagination 1..100, deterministic ordering
--       * Lookup strictly enforces regex ^EIU-AST-[0-9A-F]{8}$
-- ============================================================================

-- ============================================================================
-- 1. EXTEND INVENTORY TRANSACTIONS OPERATION CHECK CONSTRAINT
-- ============================================================================

alter table public.inventory_transactions
  drop constraint if exists inventory_transactions_operation_valid;

alter table public.inventory_transactions
  add constraint inventory_transactions_operation_valid check (
    operation in (
      'RECEIVE', 'OPENING', 'CORRECT_RECEIPT', 'REVERSE_RECEIPT', 'CORRECT_OPENING',
      'TRANSFER', 'CONDITION_CHANGE', 'STOCKTAKE_ADJUST', 'STOCKTAKE_SURPLUS', 'VERIFY_SURPLUS',
      'ASSET_RECEIVE', 'ASSET_OPEN', 'ASSET_SET_STATE', 'ASSET_SET_LIFECYCLE', 'ASSET_CORRECT'
    )
  );

-- ============================================================================
-- 2. SERIALIZED ASSET TABLES
-- ============================================================================

-- 2.1 Equipment Assets (Canonical Physical Identity & Projection)
create table if not exists public.equipment_assets (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null,
  catalog_item_id uuid not null references public.inventory_catalog_items(id) on delete restrict,
  source_line_id uuid references public.acquisition_record_lines(id) on delete restrict,
  intake_kind text not null,
  intake_reference text not null,
  row_key text not null,
  manufacturer text,
  model text,
  manufacturer_serial text,
  location_id uuid not null references public.inventory_storage_locations(id) on delete restrict,
  custodian_id uuid references public.profiles(id) on delete restrict,
  lifecycle_status text not null default 'registered',
  operational_status text not null default 'ready',
  expiry_precision text not null default 'not_required',
  expiry_date date,
  revision bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint equipment_assets_code_format check (asset_code ~ '^EIU-AST-[0-9A-F]{8}$'),
  constraint equipment_assets_code_unique unique (asset_code),
  constraint equipment_assets_intake_kind_valid check (intake_kind in ('receive', 'open')),
  constraint equipment_assets_intake_reference_not_blank check (btrim(intake_reference) <> ''),
  constraint equipment_assets_row_key_not_blank check (btrim(row_key) <> ''),
  constraint equipment_assets_intake_unique unique (intake_kind, intake_reference, row_key),
  constraint equipment_assets_lifecycle_valid check (lifecycle_status in ('registered', 'in_service', 'inactive', 'retired', 'disposed')),
  constraint equipment_assets_operational_valid check (operational_status in ('ready', 'in_use', 'under_maintenance', 'damaged', 'prohibited')),
  constraint equipment_assets_expiry_precision_valid check (expiry_precision in ('day', 'month', 'unknown', 'not_required')),
  constraint equipment_assets_expiry_date_precision_match check (
    (expiry_precision in ('unknown', 'not_required') and expiry_date is null) or
    (expiry_precision in ('day', 'month') and expiry_date is not null)
  ),
  constraint equipment_assets_serial_requires_maker_model check (
    manufacturer_serial is null or (
      btrim(manufacturer_serial) <> '' and
      manufacturer is not null and btrim(manufacturer) <> '' and
      model is not null and btrim(model) <> ''
    )
  ),
  constraint equipment_assets_revision_positive check (revision >= 1)
);

-- 2.2 Equipment Asset Events (Immutable Event Log & History)
create table if not exists public.equipment_asset_events (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.equipment_assets(id) on delete restrict,
  revision bigint not null,
  operation text not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null,
  posted_at timestamptz not null default clock_timestamp(),
  reason text not null,
  evidence_note text not null,
  before_state jsonb,
  after_state jsonb not null,
  corrects_event_id uuid references public.equipment_asset_events(id) on delete restrict,
  transaction_id uuid not null references public.inventory_transactions(id) on delete restrict,
  constraint equipment_asset_events_revision_positive check (revision >= 1),
  constraint equipment_asset_events_operation_valid check (
    operation in ('receive_asset', 'open_asset', 'set_asset_state', 'set_asset_lifecycle', 'correct_asset')
  ),
  constraint equipment_asset_events_reason_not_blank check (btrim(reason) <> ''),
  constraint equipment_asset_events_evidence_not_blank check (btrim(evidence_note) <> ''),
  constraint equipment_asset_events_unique_asset_revision unique (asset_id, revision),
  constraint equipment_asset_events_before_state_check check (
    (revision = 1 and before_state is null) or (revision > 1 and before_state is not null)
  )
);

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

create index if not exists idx_equipment_assets_catalog_item on public.equipment_assets(catalog_item_id);
create index if not exists idx_equipment_assets_location on public.equipment_assets(location_id);
create index if not exists idx_equipment_assets_source_line on public.equipment_assets(source_line_id) where source_line_id is not null;
create index if not exists idx_equipment_assets_lifecycle on public.equipment_assets(lifecycle_status);
create index if not exists idx_equipment_assets_operational on public.equipment_assets(operational_status);
create index if not exists idx_equipment_assets_custodian on public.equipment_assets(custodian_id) where custodian_id is not null;
create index if not exists idx_equipment_assets_paging on public.equipment_assets(created_at desc, id desc);

create unique index if not exists idx_equipment_assets_serial_unique on public.equipment_assets (
  lower(btrim(manufacturer)), lower(btrim(model)), lower(btrim(manufacturer_serial))
) where manufacturer_serial is not null and btrim(manufacturer_serial) <> '';

create index if not exists idx_equipment_asset_events_asset_revision on public.equipment_asset_events(asset_id, revision desc);
create index if not exists idx_equipment_asset_events_asset_posted on public.equipment_asset_events(asset_id, posted_at desc);
create index if not exists idx_equipment_asset_events_actor on public.equipment_asset_events(actor_id);
create index if not exists idx_equipment_asset_events_corrects on public.equipment_asset_events(corrects_event_id) where corrects_event_id is not null;
create index if not exists idx_equipment_asset_events_tx on public.equipment_asset_events(transaction_id);

-- ============================================================================
-- 4. MUTATION GUARDS AND FIRST-FACT PROTECTIONS
-- ============================================================================

-- 4.1 Immutability of equipment_asset_events (No UPDATE or DELETE)
drop trigger if exists trg_prevent_asset_events_mutation on public.equipment_asset_events;
create trigger trg_prevent_asset_events_mutation
before update or delete on public.equipment_asset_events
for each row execute function private.prevent_inventory_history_mutation();

-- 4.2 Guard equipment_assets mutation (No DELETE, identity lock, monotonic revision)
create or replace function private.guard_equipment_asset_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'TABLE_IMMUTABLE: equipment_assets records cannot be deleted'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id
       or new.asset_code <> old.asset_code
       or new.catalog_item_id <> old.catalog_item_id
       or new.intake_kind <> old.intake_kind
       or new.intake_reference <> old.intake_reference
       or new.row_key <> old.row_key
       or (old.source_line_id is not null and new.source_line_id is distinct from old.source_line_id) then
      raise exception 'IMMUTABLE_IDENTITY: Asset immutable identity cannot be modified'
        using errcode = '42501';
    end if;

    if new.revision <> old.revision + 1 then
      raise exception 'STALE_REVISION: Expected revision % does not match current %', new.revision, old.revision
        using errcode = '23505';
    end if;

    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_equipment_asset_mutation on public.equipment_assets;
create trigger trg_guard_equipment_asset_mutation
before update or delete on public.equipment_assets
for each row execute function private.guard_equipment_asset_mutation();

-- 4.3 Catalog Item First-Fact Guard for Equipment Assets
create or replace function private.guard_catalog_item_asset_facts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_assets boolean;
begin
  if tg_op = 'DELETE' then
    select exists (
      select 1 from public.equipment_assets where catalog_item_id = old.id
    ) into v_has_assets;
    if v_has_assets then
      raise exception 'CATALOG_ITEM_IN_USE: Cannot delete catalog item referenced by equipment assets'
        using errcode = '42501';
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if new.base_uom_code <> old.base_uom_code
       or new.material_kind <> old.material_kind
       or new.tracking_strategy <> old.tracking_strategy
       or new.return_semantics <> old.return_semantics
       or new.expiry_required <> old.expiry_required then
      select exists (
        select 1 from public.equipment_assets where catalog_item_id = old.id
      ) into v_has_assets;
      if v_has_assets then
        raise exception 'SENSITIVE_AXES_LOCKED: Cannot modify base UOM, material kind, tracking, return semantics, or expiry requirement after asset facts exist'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_guard_catalog_item_asset_facts on public.inventory_catalog_items;
create trigger trg_guard_catalog_item_asset_facts
before update or delete on public.inventory_catalog_items
for each row execute function private.guard_catalog_item_asset_facts();

-- 4.4 Acquisition Line First-Fact Guard for Equipment Assets
create or replace function private.guard_acquisition_line_asset_facts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_assets boolean;
begin
  if tg_op = 'DELETE' then
    select exists (
      select 1 from public.equipment_assets where source_line_id = old.id
    ) into v_has_assets;
    if v_has_assets then
      raise exception 'SOURCE_LINE_IN_USE: Cannot delete acquisition line referenced by equipment assets'
        using errcode = '42501';
    end if;
    return old;
  elsif tg_op = 'UPDATE' then
    if new.catalog_item_id <> old.catalog_item_id then
      select exists (
        select 1 from public.equipment_assets where source_line_id = old.id
      ) into v_has_assets;
      if v_has_assets then
        raise exception 'SOURCE_LINE_IN_USE: Cannot retarget catalog item after equipment assets exist'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_guard_acquisition_line_asset_facts on public.acquisition_record_lines;
create trigger trg_guard_acquisition_line_asset_facts
before update or delete on public.acquisition_record_lines
for each row execute function private.guard_acquisition_line_asset_facts();

-- ============================================================================
-- 5. DERIVED ELIGIBILITY HELPER
-- ============================================================================

create or replace function private.inventory_asset_eligibility(
  p_lifecycle_status text,
  p_operational_status text,
  p_item_active boolean,
  p_item_expiry_required boolean,
  p_location_active boolean,
  p_expiry_precision text,
  p_expiry_date date
)
returns table (
  eligible boolean,
  ineligibility_reasons text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reasons text[] := array[]::text[];
begin
  if p_lifecycle_status <> 'in_service' then
    v_reasons := array_append(v_reasons, 'Lifecycle status is ' || p_lifecycle_status || ' (requires in_service)');
  end if;

  if p_operational_status <> 'ready' then
    v_reasons := array_append(v_reasons, 'Operational status is ' || p_operational_status || ' (requires ready)');
  end if;

  if not p_item_active then
    v_reasons := array_append(v_reasons, 'Catalog item is inactive');
  end if;

  if not p_location_active then
    v_reasons := array_append(v_reasons, 'Storage location is inactive');
  end if;

  if p_item_expiry_required then
    if p_expiry_precision = 'unknown' or p_expiry_date is null then
      v_reasons := array_append(v_reasons, 'Asset expiry date is unknown or unverified');
    elsif p_expiry_date < current_date then
      v_reasons := array_append(v_reasons, 'Asset expired on ' || p_expiry_date::text);
    end if;
  else
    if p_expiry_date is not null and p_expiry_date < current_date then
      v_reasons := array_append(v_reasons, 'Asset expired on ' || p_expiry_date::text);
    end if;
  end if;

  eligible := (cardinality(v_reasons) = 0 or v_reasons is null);
  ineligibility_reasons := coalesce(v_reasons, array[]::text[]);
  return next;
end;
$$;

-- ============================================================================
-- 6. ROW LEVEL SECURITY (RLS) AND PERMISSIONS
-- ============================================================================

alter table public.equipment_assets enable row level security;
alter table public.equipment_asset_events enable row level security;

drop policy if exists equipment_assets_select on public.equipment_assets;
create policy equipment_assets_select on public.equipment_assets
for select to authenticated using ((select private.can_access_inventory()));

drop policy if exists equipment_asset_events_select on public.equipment_asset_events;
create policy equipment_asset_events_select on public.equipment_asset_events
for select to authenticated using ((select private.can_access_inventory()));

revoke insert, update, delete on table
  public.equipment_assets,
  public.equipment_asset_events
from public, anon, authenticated;

grant select on table
  public.equipment_assets,
  public.equipment_asset_events
to authenticated;

-- ============================================================================
-- 7. DISPATCHER: equipment_asset_command
-- ============================================================================

create or replace function public.equipment_asset_command(
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
  v_replay_op text;
  v_replay_hash text;
  v_replay_result jsonb;

  v_asset_id uuid;
  v_asset_code text;
  v_expected_revision bigint;
  v_new_revision bigint;
  v_event_id uuid;
  v_tx_id uuid;

  v_catalog_item_id uuid;
  v_source_line_id uuid;
  v_location_id uuid;
  v_custodian_id uuid;
  v_intake_kind text;
  v_intake_reference text;
  v_row_key text;
  v_maker text;
  v_model text;
  v_serial text;
  v_operational_status text;
  v_target_lifecycle text;
  v_expiry_precision text;
  v_expiry_input text;
  v_expiry_date date;
  v_expiry_required boolean;
  v_reason text;
  v_evidence_note text;
  v_occurred_at timestamptz;

  v_corrects_event_id uuid;
  v_target_event public.equipment_asset_events%rowtype;
  v_asset public.equipment_assets%rowtype;
  v_item public.inventory_catalog_items%rowtype;
  v_uom public.inventory_uoms%rowtype;
  v_loc public.inventory_storage_locations%rowtype;
  v_source_line public.acquisition_record_lines%rowtype;
  v_acq_rec public.acquisition_records%rowtype;

  v_before_state jsonb;
  v_after_state jsonb;
  v_result jsonb;
  v_biz_key text;
begin
  -- 1. Conservative Inventory Writer Lock (shared across S1, S2, and S3 assets)
  perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer', 0));

  -- 2. Authentication & Base Authorization
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'AUTH_DENIED: Unauthenticated request' using errcode = '42501';
  end if;

  perform 1 from public.profiles where id = v_caller_id for update;

  if not private.can_access_inventory() then
    raise exception 'AUTH_DENIED: User not active or unauthorized for inventory' using errcode = '42501';
  end if;

  v_is_admin := private.is_inventory_admin();

  -- 3. Operation Validity & Input Payload Checks
  if p_operation is null or p_operation not in ('receive_asset', 'open_asset', 'set_asset_state', 'set_asset_lifecycle', 'correct_asset') then
    raise exception 'INVALID_OPERATION: Unsupported operation %', p_operation using errcode = '22023';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_PAYLOAD: Payload must be an object' using errcode = '22023';
  end if;

  if p_retry_key is null then
    raise exception 'INVALID_RETRY_KEY: Retry key cannot be null' using errcode = '22023';
  end if;

  -- 4. Privilege Checks BEFORE Replay
  if p_operation in ('open_asset', 'set_asset_lifecycle') then
    if not v_is_admin then
      raise exception 'AUTH_DENIED: Administrator role required for %', p_operation using errcode = '42501';
    end if;
  end if;

  if p_operation = 'correct_asset' and not v_is_admin then
    v_asset_id := (p_payload->>'id')::uuid;
    if v_asset_id is not null then
      select a.intake_kind, i.expiry_required into v_intake_kind, v_expiry_required
      from public.equipment_assets a
      join public.inventory_catalog_items i on i.id = a.catalog_item_id
      where a.id = v_asset_id;
      if found and (v_intake_kind = 'open' or v_expiry_required = true) then
        raise exception 'AUTH_DENIED: Administrator role required for opening or required-expiry corrections' using errcode = '42501';
      end if;
    end if;
  end if;

  -- 5. Lock Retry Key Advisory Transaction Lock & Replay Check
  perform pg_advisory_xact_lock(hashtext('retry:' || p_retry_key::text));

  v_payload_hash := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');

  select operation, payload_hash, result_ids
  into v_replay_op, v_replay_hash, v_replay_result
  from public.inventory_operation_replays
  where actor_id = v_caller_id
    and retry_key = p_retry_key
    and operation in ('receive_asset', 'open_asset', 'set_asset_state', 'set_asset_lifecycle', 'correct_asset');

  if found then
    if v_replay_op <> p_operation or v_replay_hash <> v_payload_hash then
      raise exception 'RETRY_PAYLOAD_MISMATCH: Retry key already used with different operation or payload' using errcode = '23505';
    else
      return v_replay_result;
    end if;
  end if;

  -- 6. Revision Check for Mutation Operations
  if p_operation in ('set_asset_state', 'set_asset_lifecycle', 'correct_asset') then
    v_expected_revision := (p_payload->>'expected_revision')::bigint;
    if v_expected_revision is null or v_expected_revision < 1 then
      raise exception 'STALE_REVISION: Expected revision is required' using errcode = '23505';
    end if;
  end if;

  -- 7. Mandatory Reason and Evidence Note
  v_reason := btrim(coalesce(p_payload->>'reason', ''));
  v_evidence_note := btrim(coalesce(p_payload->>'evidence_note', ''));
  if v_reason = '' then
    raise exception 'INVALID_REASON: Reason cannot be blank' using errcode = '22023';
  end if;
  if v_evidence_note = '' then
    raise exception 'INVALID_EVIDENCE_NOTE: Evidence note cannot be blank' using errcode = '22023';
  end if;

  v_occurred_at := coalesce((p_payload->>'occurred_at')::timestamptz, clock_timestamp());

  -- ==========================================================================
  -- 8. OPERATION DISPATCH
  -- ==========================================================================

  -- --------------------------------------------------------------------------
  -- 8.1 receive_asset & open_asset
  -- --------------------------------------------------------------------------
  if p_operation in ('receive_asset', 'open_asset') then
    if p_operation = 'receive_asset' then
      v_intake_kind := 'receive';
    else
      v_intake_kind := 'open';
    end if;

    -- Validate Catalog Item
    v_catalog_item_id := (p_payload->>'catalog_item_id')::uuid;
    if v_catalog_item_id is null then
      raise exception 'INVALID_PAYLOAD: catalog_item_id is required' using errcode = '22023';
    end if;

    select * into v_item from public.inventory_catalog_items where id = v_catalog_item_id;
    if not found or not v_item.active then
      raise exception 'INACTIVE_REFERENCE: Catalog item not found or inactive' using errcode = '22023';
    end if;

    if v_item.tracking_strategy <> 'serialized' then
      raise exception 'INVALID_CATALOG_ITEM: Catalog item tracking strategy must be serialized' using errcode = '22023';
    end if;

    select * into v_uom from public.inventory_uoms where code = v_item.base_uom_code;
    if not found or v_uom.dimension <> 'count' or v_uom.allowed_scale <> 0 then
      raise exception 'INVALID_CATALOG_ITEM: Catalog item base UOM must be discrete count' using errcode = '22023';
    end if;

    -- Validate Source Line
    v_source_line_id := (p_payload->>'source_line_id')::uuid;
    if v_intake_kind = 'receive' then
      if v_source_line_id is null then
        raise exception 'SOURCE_LINE_REQUIRED: source_line_id is required for asset receipt' using errcode = '22023';
      end if;
      select * into v_source_line from public.acquisition_record_lines where id = v_source_line_id;
      if not found then
        raise exception 'SOURCE_LINE_NOT_FOUND: Acquisition line not found' using errcode = 'P0002';
      end if;
      if v_source_line.catalog_item_id <> v_catalog_item_id then
        raise exception 'SOURCE_LINE_MISMATCH: Acquisition line catalog item does not match' using errcode = '22023';
      end if;
      select * into v_acq_rec from public.acquisition_records where id = v_source_line.acquisition_record_id;
      if not found or v_acq_rec.status <> 'active' then
        raise exception 'SOURCE_RECORD_VOIDED: Acquisition record is voided or not active' using errcode = '22023';
      end if;
    else
      -- open_asset: source_line_id is optional
      if v_source_line_id is not null then
        select * into v_source_line from public.acquisition_record_lines where id = v_source_line_id;
        if not found then
          raise exception 'SOURCE_LINE_NOT_FOUND: Acquisition line not found' using errcode = 'P0002';
        end if;
        if v_source_line.catalog_item_id <> v_catalog_item_id then
          raise exception 'SOURCE_LINE_MISMATCH: Acquisition line catalog item does not match' using errcode = '22023';
        end if;
        select * into v_acq_rec from public.acquisition_records where id = v_source_line.acquisition_record_id;
        if not found or v_acq_rec.status <> 'active' then
          raise exception 'SOURCE_RECORD_VOIDED: Acquisition record is voided or not active' using errcode = '22023';
        end if;
      end if;
    end if;

    -- Validate Location
    v_location_id := (p_payload->>'location_id')::uuid;
    if v_location_id is null then
      raise exception 'INVALID_PAYLOAD: location_id is required' using errcode = '22023';
    end if;
    select * into v_loc from public.inventory_storage_locations where id = v_location_id;
    if not found or not v_loc.active then
      raise exception 'INACTIVE_REFERENCE: Storage location not found or inactive' using errcode = '22023';
    end if;

    -- Validate Intake Reference & Row Key
    v_intake_reference := btrim(coalesce(p_payload->>'intake_reference', ''));
    v_row_key := btrim(coalesce(p_payload->>'row_key', ''));
    if v_intake_reference = '' then
      raise exception 'INVALID_INTAKE_REFERENCE: Intake reference cannot be blank' using errcode = '22023';
    end if;
    if v_row_key = '' then
      raise exception 'INVALID_ROW_KEY: Row key cannot be blank' using errcode = '22023';
    end if;

    -- Business Lock on Intake Identity Tuple
    perform pg_advisory_xact_lock(hashtext('biz_asset_intake:' || v_intake_kind || ':' || v_intake_reference || ':' || v_row_key));

    if exists (
      select 1 from public.equipment_assets
      where intake_kind = v_intake_kind
        and intake_reference = v_intake_reference
        and row_key = v_row_key
    ) then
      raise exception 'BUSINESS_DUPLICATE: Intake % already posted with row_key %', v_intake_reference, v_row_key using errcode = '23505';
    end if;

    -- Manufacturer, Model, Serial Normalization & Qualified Uniqueness across SKUs
    v_serial := nullif(btrim(coalesce(p_payload->>'manufacturer_serial', '')), '');
    v_maker := nullif(btrim(coalesce(p_payload->>'manufacturer', '')), '');
    v_model := nullif(btrim(coalesce(p_payload->>'model', '')), '');

    if v_serial is not null then
      if v_maker is null or v_model is null then
        raise exception 'INVALID_SERIAL_IDENTITY: Manufacturer and model are required when manufacturer_serial is present' using errcode = '22023';
      end if;

      perform pg_advisory_xact_lock(hashtext('serial:' || lower(v_maker) || ':' || lower(v_model) || ':' || lower(v_serial)));

      if exists (
        select 1 from public.equipment_assets
        where lower(btrim(manufacturer)) = lower(v_maker)
          and lower(btrim(model)) = lower(v_model)
          and lower(btrim(manufacturer_serial)) = lower(v_serial)
      ) then
        raise exception 'DUPLICATE_MANUFACTURER_SERIAL: Asset with manufacturer %, model %, serial % already exists', v_maker, v_model, v_serial using errcode = '23505';
      end if;
    end if;

    -- Custodian Validation (Optional)
    v_custodian_id := (p_payload->>'custodian_id')::uuid;
    if v_custodian_id is not null then
      if not exists (select 1 from public.profiles where id = v_custodian_id and is_active = true) then
        raise exception 'INACTIVE_REFERENCE: Custodian not found or inactive' using errcode = '22023';
      end if;
    end if;

    -- Operational Status
    v_operational_status := coalesce(nullif(btrim(p_payload->>'operational_status'), ''), 'ready');
    if v_operational_status not in ('ready', 'in_use', 'under_maintenance', 'damaged', 'prohibited') then
      raise exception 'INVALID_OPERATIONAL_STATUS: Status % is invalid', v_operational_status using errcode = '22023';
    end if;

    -- Expiry Validation & Normalization
    v_expiry_precision := coalesce(nullif(btrim(p_payload->>'expiry_precision'), ''), 'not_required');
    v_expiry_input := nullif(btrim(coalesce(p_payload->>'expiry_input', '')), '');

    if v_item.expiry_required then
      if v_expiry_precision = 'not_required' then
        raise exception 'INVALID_EXPIRY: Expiry date is required for this catalog item' using errcode = '22023';
      end if;
      v_expiry_date := private.inventory_normalize_expiry(v_expiry_precision, v_expiry_input, (v_intake_kind = 'open'));
    else
      v_expiry_date := private.inventory_normalize_expiry(v_expiry_precision, v_expiry_input, (v_intake_kind = 'open'));
    end if;

    -- Server-Generated Immutable Unique asset_code
    loop
      v_asset_code := 'EIU-AST-' || upper(split_part(gen_random_uuid()::text, '-', 1));
      exit when not exists (select 1 from public.equipment_assets where asset_code = v_asset_code);
    end loop;

    -- Structured JSON Business Key to Prevent Delimiter Collisions
    v_biz_key := jsonb_build_object('ref', v_intake_reference, 'row', v_row_key)::text;

    -- Insert Shared Transaction Header
    insert into public.inventory_transactions (
      operation, business_key, actor_id, occurred_at, posted_at, reason
    ) values (
      case when v_intake_kind = 'receive' then 'ASSET_RECEIVE' else 'ASSET_OPEN' end,
      v_biz_key,
      v_caller_id,
      v_occurred_at,
      clock_timestamp(),
      v_reason
    ) returning id into v_tx_id;

    -- Insert Canonical Asset Projection
    insert into public.equipment_assets (
      asset_code, catalog_item_id, source_line_id, intake_kind, intake_reference,
      row_key, manufacturer, model, manufacturer_serial, location_id,
      custodian_id, lifecycle_status, operational_status, expiry_precision,
      expiry_date, revision, created_at, updated_at
    ) values (
      v_asset_code, v_catalog_item_id, v_source_line_id, v_intake_kind, v_intake_reference,
      v_row_key, v_maker, v_model, v_serial, v_location_id,
      v_custodian_id, 'registered', v_operational_status, v_expiry_precision,
      v_expiry_date, 1, clock_timestamp(), clock_timestamp()
    ) returning id into v_asset_id;

    -- Build After State
    v_after_state := jsonb_build_object(
      'id', v_asset_id,
      'asset_code', v_asset_code,
      'catalog_item_id', v_catalog_item_id,
      'source_line_id', v_source_line_id,
      'intake_kind', v_intake_kind,
      'intake_reference', v_intake_reference,
      'row_key', v_row_key,
      'manufacturer', v_maker,
      'model', v_model,
      'manufacturer_serial', v_serial,
      'location_id', v_location_id,
      'custodian_id', v_custodian_id,
      'lifecycle_status', 'registered',
      'operational_status', v_operational_status,
      'expiry_precision', v_expiry_precision,
      'expiry_date', v_expiry_date,
      'revision', 1
    );

    -- Insert Immutable Event Log linked to Transaction Header
    insert into public.equipment_asset_events (
      asset_id, revision, operation, actor_id, occurred_at, posted_at,
      reason, evidence_note, before_state, after_state, corrects_event_id,
      transaction_id
    ) values (
      v_asset_id, 1, p_operation, v_caller_id, v_occurred_at, clock_timestamp(),
      v_reason, v_evidence_note, null, v_after_state, null,
      v_tx_id
    ) returning id into v_event_id;

    v_new_revision := 1;

  -- --------------------------------------------------------------------------
  -- 8.2 set_asset_state
  -- --------------------------------------------------------------------------
  elsif p_operation = 'set_asset_state' then
    v_asset_id := (p_payload->>'id')::uuid;
    if v_asset_id is null then
      raise exception 'INVALID_PAYLOAD: Asset id is required' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtext('asset:' || v_asset_id::text));

    select * into v_asset from public.equipment_assets where id = v_asset_id for update;
    if not found then
      raise exception 'ASSET_NOT_FOUND: Asset % does not exist', v_asset_id using errcode = 'P0002';
    end if;
    v_asset_code := v_asset.asset_code;

    if v_asset.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: Expected revision % does not match current %', v_expected_revision, v_asset.revision using errcode = '23505';
    end if;

    -- Validate Location
    v_location_id := (p_payload->>'location_id')::uuid;
    if v_location_id is null then
      raise exception 'LOCATION_REQUIRED: location_id is required' using errcode = '22023';
    end if;
    select * into v_loc from public.inventory_storage_locations where id = v_location_id;
    if not found or not v_loc.active then
      raise exception 'INACTIVE_REFERENCE: Storage location not found or inactive' using errcode = '22023';
    end if;
    -- Validate Custodian (must be explicitly provided in physical snapshot; nullable)
    if not (p_payload ? 'custodian_id') then
      raise exception 'INVALID_PAYLOAD: custodian_id must be explicitly provided in physical snapshot' using errcode = '22023';
    end if;
    v_custodian_id := (p_payload->>'custodian_id')::uuid;
    if v_custodian_id is not null then
      if not exists (select 1 from public.profiles where id = v_custodian_id and is_active = true) then
        raise exception 'INACTIVE_REFERENCE: Custodian not found or inactive' using errcode = '22023';
      end if;
    end if;
    -- Validate Operational Status
    v_operational_status := btrim(coalesce(p_payload->>'operational_status', ''));
    if v_operational_status not in ('ready', 'in_use', 'under_maintenance', 'damaged', 'prohibited') then
      raise exception 'INVALID_OPERATIONAL_STATUS: Status % is invalid', v_operational_status using errcode = '22023';
    end if;

    -- Snapshot Before State
    v_before_state := jsonb_build_object(
      'id', v_asset.id,
      'asset_code', v_asset.asset_code,
      'catalog_item_id', v_asset.catalog_item_id,
      'source_line_id', v_asset.source_line_id,
      'intake_kind', v_asset.intake_kind,
      'intake_reference', v_asset.intake_reference,
      'row_key', v_asset.row_key,
      'manufacturer', v_asset.manufacturer,
      'model', v_asset.model,
      'manufacturer_serial', v_asset.manufacturer_serial,
      'location_id', v_asset.location_id,
      'custodian_id', v_asset.custodian_id,
      'lifecycle_status', v_asset.lifecycle_status,
      'operational_status', v_asset.operational_status,
      'expiry_precision', v_asset.expiry_precision,
      'expiry_date', v_asset.expiry_date,
      'revision', v_asset.revision
    );

    v_new_revision := v_asset.revision + 1;
    v_biz_key := jsonb_build_object('asset_id', v_asset.id, 'rev', v_new_revision)::text;

    -- Insert Shared Transaction Header
    insert into public.inventory_transactions (
      operation, business_key, actor_id, occurred_at, posted_at, reason
    ) values (
      'ASSET_SET_STATE',
      v_biz_key,
      v_caller_id,
      v_occurred_at,
      clock_timestamp(),
      v_reason
    ) returning id into v_tx_id;

    -- Update Operational Projection
    update public.equipment_assets set
      location_id = v_location_id,
      custodian_id = v_custodian_id,
      operational_status = v_operational_status,
      revision = v_new_revision,
      updated_at = clock_timestamp()
    where id = v_asset.id;

    -- Snapshot After State
    v_after_state := jsonb_build_object(
      'id', v_asset.id,
      'asset_code', v_asset.asset_code,
      'catalog_item_id', v_asset.catalog_item_id,
      'source_line_id', v_asset.source_line_id,
      'intake_kind', v_asset.intake_kind,
      'intake_reference', v_asset.intake_reference,
      'row_key', v_asset.row_key,
      'manufacturer', v_asset.manufacturer,
      'model', v_asset.model,
      'manufacturer_serial', v_asset.manufacturer_serial,
      'location_id', v_location_id,
      'custodian_id', v_custodian_id,
      'lifecycle_status', v_asset.lifecycle_status,
      'operational_status', v_operational_status,
      'expiry_precision', v_asset.expiry_precision,
      'expiry_date', v_asset.expiry_date,
      'revision', v_new_revision
    );

    -- Insert Immutable Event Log linked to Transaction Header
    insert into public.equipment_asset_events (
      asset_id, revision, operation, actor_id, occurred_at, posted_at,
      reason, evidence_note, before_state, after_state, corrects_event_id,
      transaction_id
    ) values (
      v_asset.id, v_new_revision, 'set_asset_state', v_caller_id, v_occurred_at, clock_timestamp(),
      v_reason, v_evidence_note, v_before_state, v_after_state, null,
      v_tx_id
    ) returning id into v_event_id;

  -- --------------------------------------------------------------------------
  -- 8.3 set_asset_lifecycle
  -- --------------------------------------------------------------------------
  elsif p_operation = 'set_asset_lifecycle' then
    v_asset_id := (p_payload->>'id')::uuid;
    if v_asset_id is null then
      raise exception 'INVALID_PAYLOAD: Asset id is required' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtext('asset:' || v_asset_id::text));

    select * into v_asset from public.equipment_assets where id = v_asset_id for update;
    if not found then
      raise exception 'ASSET_NOT_FOUND: Asset % does not exist', v_asset_id using errcode = 'P0002';
    end if;
    v_asset_code := v_asset.asset_code;

    if v_asset.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: Expected revision % does not match current %', v_expected_revision, v_asset.revision using errcode = '23505';
    end if;

    v_target_lifecycle := btrim(coalesce(p_payload->>'lifecycle_status', ''));
    if v_target_lifecycle not in ('registered', 'in_service', 'inactive', 'retired', 'disposed') then
      raise exception 'INVALID_LIFECYCLE_STATUS: Status % is invalid', v_target_lifecycle using errcode = '22023';
    end if;

    if v_asset.lifecycle_status = 'disposed' then
      raise exception 'DISPOSED_LIFECYCLE_TERMINAL: Disposed assets cannot be transitioned' using errcode = '22023';
    end if;

    if v_asset.lifecycle_status = v_target_lifecycle then
      raise exception 'INVALID_LIFECYCLE_TRANSITION: Asset is already in % status', v_asset.lifecycle_status using errcode = '22023';
    end if;

    if v_target_lifecycle = 'in_service' and v_asset.lifecycle_status not in ('registered', 'inactive', 'retired') then
      raise exception 'INVALID_LIFECYCLE_TRANSITION: Cannot transition % to in_service', v_asset.lifecycle_status using errcode = '22023';
    end if;

    if v_target_lifecycle = 'inactive' and v_asset.lifecycle_status not in ('registered', 'in_service') then
      raise exception 'INVALID_LIFECYCLE_TRANSITION: Cannot transition % to inactive', v_asset.lifecycle_status using errcode = '22023';
    end if;

    if v_target_lifecycle = 'retired' and v_asset.lifecycle_status not in ('registered', 'in_service', 'inactive') then
      raise exception 'INVALID_LIFECYCLE_TRANSITION: Cannot transition % to retired', v_asset.lifecycle_status using errcode = '22023';
    end if;

    if v_target_lifecycle = 'disposed' and v_asset.lifecycle_status not in ('registered', 'in_service', 'inactive', 'retired') then
      raise exception 'INVALID_LIFECYCLE_TRANSITION: Cannot transition % to disposed', v_asset.lifecycle_status using errcode = '22023';
    end if;

    if v_target_lifecycle = 'registered' then
      raise exception 'INVALID_LIFECYCLE_TRANSITION: Cannot transition to registered' using errcode = '22023';
    end if;

    -- Snapshot Before State
    v_before_state := jsonb_build_object(
      'id', v_asset.id,
      'asset_code', v_asset.asset_code,
      'catalog_item_id', v_asset.catalog_item_id,
      'source_line_id', v_asset.source_line_id,
      'intake_kind', v_asset.intake_kind,
      'intake_reference', v_asset.intake_reference,
      'row_key', v_asset.row_key,
      'manufacturer', v_asset.manufacturer,
      'model', v_asset.model,
      'manufacturer_serial', v_asset.manufacturer_serial,
      'location_id', v_asset.location_id,
      'custodian_id', v_asset.custodian_id,
      'lifecycle_status', v_asset.lifecycle_status,
      'operational_status', v_asset.operational_status,
      'expiry_precision', v_asset.expiry_precision,
      'expiry_date', v_asset.expiry_date,
      'revision', v_asset.revision
    );

    v_new_revision := v_asset.revision + 1;
    v_biz_key := jsonb_build_object('asset_id', v_asset.id, 'rev', v_new_revision)::text;

    -- Insert Shared Transaction Header
    insert into public.inventory_transactions (
      operation, business_key, actor_id, occurred_at, posted_at, reason
    ) values (
      'ASSET_SET_LIFECYCLE',
      v_biz_key,
      v_caller_id,
      v_occurred_at,
      clock_timestamp(),
      v_reason
    ) returning id into v_tx_id;

    -- Update Operational Projection
    update public.equipment_assets set
      lifecycle_status = v_target_lifecycle,
      revision = v_new_revision,
      updated_at = clock_timestamp()
    where id = v_asset.id;

    -- Snapshot After State
    v_after_state := jsonb_build_object(
      'id', v_asset.id,
      'asset_code', v_asset.asset_code,
      'catalog_item_id', v_asset.catalog_item_id,
      'source_line_id', v_asset.source_line_id,
      'intake_kind', v_asset.intake_kind,
      'intake_reference', v_asset.intake_reference,
      'row_key', v_asset.row_key,
      'manufacturer', v_asset.manufacturer,
      'model', v_asset.model,
      'manufacturer_serial', v_asset.manufacturer_serial,
      'location_id', v_asset.location_id,
      'custodian_id', v_asset.custodian_id,
      'lifecycle_status', v_target_lifecycle,
      'operational_status', v_asset.operational_status,
      'expiry_precision', v_asset.expiry_precision,
      'expiry_date', v_asset.expiry_date,
      'revision', v_new_revision
    );

    -- Insert Immutable Event Log linked to Transaction Header
    insert into public.equipment_asset_events (
      asset_id, revision, operation, actor_id, occurred_at, posted_at,
      reason, evidence_note, before_state, after_state, corrects_event_id,
      transaction_id
    ) values (
      v_asset.id, v_new_revision, 'set_asset_lifecycle', v_caller_id, v_occurred_at, clock_timestamp(),
      v_reason, v_evidence_note, v_before_state, v_after_state, null,
      v_tx_id
    ) returning id into v_event_id;

  -- --------------------------------------------------------------------------
  -- 8.4 correct_asset
  -- --------------------------------------------------------------------------
  elsif p_operation = 'correct_asset' then
    v_asset_id := (p_payload->>'id')::uuid;
    if v_asset_id is null then
      raise exception 'INVALID_PAYLOAD: Asset id is required' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtext('asset:' || v_asset_id::text));

    select * into v_asset from public.equipment_assets where id = v_asset_id for update;
    if not found then
      raise exception 'ASSET_NOT_FOUND: Asset % does not exist', v_asset_id using errcode = 'P0002';
    end if;
    v_asset_code := v_asset.asset_code;

    if v_asset.revision <> v_expected_revision then
      raise exception 'STALE_REVISION: Expected revision % does not match current %', v_expected_revision, v_asset.revision using errcode = '23505';
    end if;

    -- Validate corrects_event_id belongs to the same asset
    v_corrects_event_id := (p_payload->>'corrects_event_id')::uuid;
    if v_corrects_event_id is null then
      raise exception 'INVALID_CORRECTION_TARGET: corrects_event_id is required' using errcode = '22023';
    end if;

    select * into v_target_event from public.equipment_asset_events where id = v_corrects_event_id;
    if not found or v_target_event.asset_id <> v_asset.id then
      raise exception 'INVALID_CORRECTION_TARGET: Corrected event % does not belong to asset %', v_corrects_event_id, v_asset.id using errcode = '22023';
    end if;

    -- Privilege Check for opening and required-expiry corrections
    select * into v_item from public.inventory_catalog_items where id = v_asset.catalog_item_id;
    if (v_asset.intake_kind = 'open' or v_item.expiry_required = true) and not v_is_admin then
      raise exception 'AUTH_DENIED: Administrator role required for opening or required-expiry corrections' using errcode = '42501';
    end if;
    -- Validate required snapshot keys for metadata/expiry correction (no silent lost fields)
    if not (p_payload ? 'manufacturer')
       or not (p_payload ? 'model')
       or not (p_payload ? 'manufacturer_serial')
       or not (p_payload ? 'expiry_precision')
       or not (p_payload ? 'expiry_input') then
      raise exception 'INVALID_PAYLOAD: Metadata correction requires complete snapshot (manufacturer, model, manufacturer_serial, expiry_precision, expiry_input)' using errcode = '22023';
    end if;

    -- Manufacturer, Model, Serial Normalization & Uniqueness across other assets
    v_serial := nullif(btrim(coalesce(p_payload->>'manufacturer_serial', '')), '');
    v_maker := nullif(btrim(coalesce(p_payload->>'manufacturer', '')), '');
    v_model := nullif(btrim(coalesce(p_payload->>'model', '')), '');

    if v_serial is not null then
      if v_maker is null or v_model is null then
        raise exception 'INVALID_SERIAL_IDENTITY: Manufacturer and model are required when manufacturer_serial is present' using errcode = '22023';
      end if;

      perform pg_advisory_xact_lock(hashtext('serial:' || lower(v_maker) || ':' || lower(v_model) || ':' || lower(v_serial)));

      if exists (
        select 1 from public.equipment_assets
        where id <> v_asset.id
          and lower(btrim(manufacturer)) = lower(v_maker)
          and lower(btrim(model)) = lower(v_model)
          and lower(btrim(manufacturer_serial)) = lower(v_serial)
      ) then
        raise exception 'DUPLICATE_MANUFACTURER_SERIAL: Asset with manufacturer %, model %, serial % already exists', v_maker, v_model, v_serial using errcode = '23505';
      end if;
    end if;

    -- Expiry Validation & Normalization
    v_expiry_precision := nullif(btrim(p_payload->>'expiry_precision'), '');
    if v_expiry_precision is null then
      raise exception 'INVALID_EXPIRY: expiry_precision is required' using errcode = '22023';
    end if;
    if v_expiry_precision not in ('day', 'month', 'unknown', 'not_required') then
      raise exception 'INVALID_EXPIRY: Unsupported precision %', v_expiry_precision using errcode = '22023';
    end if;
    v_expiry_input := nullif(btrim(coalesce(p_payload->>'expiry_input', '')), '');

    if v_item.expiry_required then
      if v_expiry_precision = 'not_required' then
        raise exception 'INVALID_EXPIRY: Expiry date is required for this catalog item' using errcode = '22023';
      end if;
      v_expiry_date := private.inventory_normalize_expiry(v_expiry_precision, v_expiry_input, (v_asset.intake_kind = 'open'));
    else
      v_expiry_date := private.inventory_normalize_expiry(v_expiry_precision, v_expiry_input, (v_asset.intake_kind = 'open'));
    end if;

    -- Snapshot Before State
    v_before_state := jsonb_build_object(
      'id', v_asset.id,
      'asset_code', v_asset.asset_code,
      'catalog_item_id', v_asset.catalog_item_id,
      'source_line_id', v_asset.source_line_id,
      'intake_kind', v_asset.intake_kind,
      'intake_reference', v_asset.intake_reference,
      'row_key', v_asset.row_key,
      'manufacturer', v_asset.manufacturer,
      'model', v_asset.model,
      'manufacturer_serial', v_asset.manufacturer_serial,
      'location_id', v_asset.location_id,
      'custodian_id', v_asset.custodian_id,
      'lifecycle_status', v_asset.lifecycle_status,
      'operational_status', v_asset.operational_status,
      'expiry_precision', v_asset.expiry_precision,
      'expiry_date', v_asset.expiry_date,
      'revision', v_asset.revision
    );

    v_new_revision := v_asset.revision + 1;
    v_biz_key := jsonb_build_object('asset_id', v_asset.id, 'rev', v_new_revision)::text;

    -- Insert Shared Transaction Header with corrects_transaction_id
    insert into public.inventory_transactions (
      operation, business_key, actor_id, occurred_at, posted_at, reason, corrects_transaction_id
    ) values (
      'ASSET_CORRECT',
      v_biz_key,
      v_caller_id,
      v_occurred_at,
      clock_timestamp(),
      v_reason,
      v_target_event.transaction_id
    ) returning id into v_tx_id;

    -- Update Operational Projection
    update public.equipment_assets set
      manufacturer = v_maker,
      model = v_model,
      manufacturer_serial = v_serial,
      expiry_precision = v_expiry_precision,
      expiry_date = v_expiry_date,
      revision = v_new_revision,
      updated_at = clock_timestamp()
    where id = v_asset.id;

    -- Snapshot After State
    v_after_state := jsonb_build_object(
      'id', v_asset.id,
      'asset_code', v_asset.asset_code,
      'catalog_item_id', v_asset.catalog_item_id,
      'source_line_id', v_asset.source_line_id,
      'intake_kind', v_asset.intake_kind,
      'intake_reference', v_asset.intake_reference,
      'row_key', v_asset.row_key,
      'manufacturer', v_maker,
      'model', v_model,
      'manufacturer_serial', v_serial,
      'location_id', v_asset.location_id,
      'custodian_id', v_asset.custodian_id,
      'lifecycle_status', v_asset.lifecycle_status,
      'operational_status', v_asset.operational_status,
      'expiry_precision', v_expiry_precision,
      'expiry_date', v_expiry_date,
      'revision', v_new_revision
    );

    -- Insert Immutable Event Log linked to Transaction Header
    insert into public.equipment_asset_events (
      asset_id, revision, operation, actor_id, occurred_at, posted_at,
      reason, evidence_note, before_state, after_state, corrects_event_id,
      transaction_id
    ) values (
      v_asset.id, v_new_revision, 'correct_asset', v_caller_id, v_occurred_at, clock_timestamp(),
      v_reason, v_evidence_note, v_before_state, v_after_state, v_corrects_event_id,
      v_tx_id
    ) returning id into v_event_id;
  end if;

  -- ==========================================================================
  -- 9. AUDIT LOGGING & REPLAY PERSISTENCE
  -- ==========================================================================

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, old_data, new_data, metadata, created_at
  ) values (
    v_caller_id,
    'equipment_asset.' || p_operation,
    'equipment_asset',
    v_asset_id,
    v_before_state,
    v_after_state,
    jsonb_build_object(
      'event_id', v_event_id,
      'transaction_id', v_tx_id,
      'asset_code', v_asset_code,
      'revision', v_new_revision,
      'reason', v_reason,
      'evidence_note', v_evidence_note,
      'retry_key', p_retry_key
    ),
    clock_timestamp()
  );

  v_result := jsonb_build_object(
    'id', v_asset_id,
    'asset_code', v_asset_code,
    'revision', v_new_revision,
    'event_id', v_event_id,
    'transaction_id', v_tx_id
  );

  insert into public.inventory_operation_replays (
    actor_id, operation, retry_key, payload_hash, result_ids, committed_at
  ) values (
    v_caller_id, p_operation, p_retry_key, v_payload_hash, v_result, clock_timestamp()
  );

  return v_result;
end;
$$;

revoke all on function public.equipment_asset_command(text, jsonb, uuid) from public, anon;
grant execute on function public.equipment_asset_command(text, jsonb, uuid) to authenticated;

-- ============================================================================
-- 8. BOUNDED READ RPC: equipment_asset_read
-- ============================================================================

create or replace function public.equipment_asset_read(
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
  v_id uuid := (p_filters->>'id')::uuid;
  v_catalog_item_id uuid := (p_filters->>'catalog_item_id')::uuid;
  v_location_id uuid := (p_filters->>'location_id')::uuid;
  v_lifecycle_status text := nullif(btrim(coalesce(p_filters->>'lifecycle_status', '')), '');
  v_operational_status text := nullif(btrim(coalesce(p_filters->>'operational_status', '')), '');
  v_asset_code text := btrim(coalesce(p_filters->>'asset_code', ''));
  v_transaction_id uuid := (p_filters->>'transaction_id')::uuid;

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
  -- 8.1 Resource: assets
  -- --------------------------------------------------------------------------
  if p_resource = 'assets' then
    select count(*) into v_total
    from public.equipment_assets a
    join public.inventory_catalog_items i on i.id = a.catalog_item_id
    join public.inventory_storage_locations l on l.id = a.location_id
    where (v_catalog_item_id is null or a.catalog_item_id = v_catalog_item_id)
      and (v_location_id is null or a.location_id = v_location_id)
      and (v_lifecycle_status is null or a.lifecycle_status = v_lifecycle_status)
      and (v_operational_status is null or a.operational_status = v_operational_status)
      and (
        v_q = '' or
        a.asset_code ilike '%' || v_q || '%' or
        i.code ilike '%' || v_q || '%' or
        i.name ilike '%' || v_q || '%' or
        coalesce(a.manufacturer, '') ilike '%' || v_q || '%' or
        coalesce(a.model, '') ilike '%' || v_q || '%' or
        coalesce(a.manufacturer_serial, '') ilike '%' || v_q || '%'
      );

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select
        a.id,
        a.asset_code,
        a.catalog_item_id,
        i.code as item_code,
        i.name as item_name,
        a.source_line_id,
        a.intake_kind,
        a.intake_reference,
        a.row_key,
        a.manufacturer,
        a.model,
        a.manufacturer_serial,
        a.location_id,
        l.code as location_code,
        l.name as location_name,
        a.custodian_id,
        c.full_name as custodian_name,
        a.lifecycle_status,
        a.operational_status,
        a.expiry_precision,
        a.expiry_date,
        a.revision,
        e.eligible,
        to_jsonb(e.ineligibility_reasons) as ineligibility_reasons,
        a.created_at,
        a.updated_at
      from public.equipment_assets a
      join public.inventory_catalog_items i on i.id = a.catalog_item_id
      join public.inventory_storage_locations l on l.id = a.location_id
      left join public.profiles c on c.id = a.custodian_id
      cross join lateral private.inventory_asset_eligibility(
        a.lifecycle_status,
        a.operational_status,
        i.active,
        i.expiry_required,
        l.active,
        a.expiry_precision,
        a.expiry_date
      ) e
      where (v_catalog_item_id is null or a.catalog_item_id = v_catalog_item_id)
        and (v_location_id is null or a.location_id = v_location_id)
        and (v_lifecycle_status is null or a.lifecycle_status = v_lifecycle_status)
        and (v_operational_status is null or a.operational_status = v_operational_status)
        and (
          v_q = '' or
          a.asset_code ilike '%' || v_q || '%' or
          i.code ilike '%' || v_q || '%' or
          i.name ilike '%' || v_q || '%' or
          coalesce(a.manufacturer, '') ilike '%' || v_q || '%' or
          coalesce(a.model, '') ilike '%' || v_q || '%' or
          coalesce(a.manufacturer_serial, '') ilike '%' || v_q || '%'
        )
      order by a.created_at desc, a.id desc
      limit v_page_size offset v_offset
    ) sub;

    return jsonb_build_object('rows', v_rows, 'total', v_total);

  -- --------------------------------------------------------------------------
  -- 8.2 Resource: detail
  -- --------------------------------------------------------------------------
  elsif p_resource = 'detail' then
    if v_id is null then
      raise exception 'INVALID_PAYLOAD: Asset id is required for detail' using errcode = '22023';
    end if;

    select count(*) into v_total
    from public.equipment_assets a
    where a.id = v_id;

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select
        a.id,
        a.asset_code,
        a.catalog_item_id,
        i.code as item_code,
        i.name as item_name,
        a.source_line_id,
        a.intake_kind,
        a.intake_reference,
        a.row_key,
        a.manufacturer,
        a.model,
        a.manufacturer_serial,
        a.location_id,
        l.code as location_code,
        l.name as location_name,
        a.custodian_id,
        c.full_name as custodian_name,
        a.lifecycle_status,
        a.operational_status,
        a.expiry_precision,
        a.expiry_date,
        a.revision,
        e.eligible,
        to_jsonb(e.ineligibility_reasons) as ineligibility_reasons,
        a.created_at,
        a.updated_at
      from public.equipment_assets a
      join public.inventory_catalog_items i on i.id = a.catalog_item_id
      join public.inventory_storage_locations l on l.id = a.location_id
      left join public.profiles c on c.id = a.custodian_id
      cross join lateral private.inventory_asset_eligibility(
        a.lifecycle_status,
        a.operational_status,
        i.active,
        i.expiry_required,
        l.active,
        a.expiry_precision,
        a.expiry_date
      ) e
      where a.id = v_id
    ) sub;

    return jsonb_build_object('rows', v_rows, 'total', v_total);

  -- --------------------------------------------------------------------------
  -- 8.3 Resource: lookup
  -- --------------------------------------------------------------------------
  elsif p_resource = 'lookup' then
    if v_asset_code = '' or v_asset_code !~ '^EIU-AST-[0-9A-F]{8}$' then
      raise exception 'INVALID_ASSET_CODE: Asset code % is malformed', v_asset_code using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select
        a.id,
        a.asset_code,
        a.catalog_item_id,
        i.code as item_code,
        i.name as item_name,
        a.source_line_id,
        a.intake_kind,
        a.intake_reference,
        a.row_key,
        a.manufacturer,
        a.model,
        a.manufacturer_serial,
        a.location_id,
        l.code as location_code,
        l.name as location_name,
        a.custodian_id,
        c.full_name as custodian_name,
        a.lifecycle_status,
        a.operational_status,
        a.expiry_precision,
        a.expiry_date,
        a.revision,
        e.eligible,
        to_jsonb(e.ineligibility_reasons) as ineligibility_reasons,
        a.created_at,
        a.updated_at
      from public.equipment_assets a
      join public.inventory_catalog_items i on i.id = a.catalog_item_id
      join public.inventory_storage_locations l on l.id = a.location_id
      left join public.profiles c on c.id = a.custodian_id
      cross join lateral private.inventory_asset_eligibility(
        a.lifecycle_status,
        a.operational_status,
        i.active,
        i.expiry_required,
        l.active,
        a.expiry_precision,
        a.expiry_date
      ) e
      where a.asset_code = v_asset_code
    ) sub;

    if jsonb_array_length(v_rows) = 0 then
      raise exception 'INVALID_ASSET_CODE: Asset code % not found', v_asset_code using errcode = '22023';
    end if;

    return jsonb_build_object('rows', v_rows, 'total', 1);

  -- --------------------------------------------------------------------------
  -- 8.4 Resource: history
  -- --------------------------------------------------------------------------
  elsif p_resource = 'history' then
    if (v_id is null and v_transaction_id is null) or (v_id is not null and v_transaction_id is not null) then
      raise exception 'INVALID_PAYLOAD: Exactly one of asset id or transaction_id is required for history' using errcode = '22023';
    end if;

    select count(*) into v_total
    from public.equipment_asset_events h
    where (v_id is not null and h.asset_id = v_id)
       or (v_transaction_id is not null and h.transaction_id = v_transaction_id);

    select coalesce(jsonb_agg(sub), '[]'::jsonb) into v_rows
    from (
      select
        h.id,
        h.asset_id,
        h.revision,
        h.operation,
        h.actor_id,
        p.full_name as actor_name,
        h.occurred_at,
        h.posted_at,
        h.reason,
        h.evidence_note,
        h.before_state,
        h.after_state,
        h.corrects_event_id,
        h.transaction_id
      from public.equipment_asset_events h
      join public.profiles p on p.id = h.actor_id
      where (v_id is not null and h.asset_id = v_id)
         or (v_transaction_id is not null and h.transaction_id = v_transaction_id)
      order by h.revision desc
      limit v_page_size offset v_offset
    ) sub;

    return jsonb_build_object('rows', v_rows, 'total', v_total);

  else
    raise exception 'INVALID_RESOURCE: Unknown resource %', p_resource using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.equipment_asset_read(text, jsonb) from public, anon;
grant execute on function public.equipment_asset_read(text, jsonb) to authenticated;
