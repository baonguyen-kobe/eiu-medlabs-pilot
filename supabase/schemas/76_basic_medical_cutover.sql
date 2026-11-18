-- t4r3 steps B and C: Basic Medical room stock joins the shared ledger.
-- Owner decision 2026-11-18 (option 2): an Admin moves every ready room row
-- with one button; the opening is real but needs no P1 pilot scope, and it
-- is audited. After the move the ledger is the source of truth:
--   * basic_medical_room_inventory keeps the row (its id anchors session
--     checks and evidence) as a projection of the ledger;
--   * a lecturer's "hư mới" on a moved row posts good -> damaged in the ledger
--     at the room's root location, recorded as that lecturer;
--   * hand edits of a moved row's quantities are refused; use Kho instead.

alter table public.basic_medical_room_inventory
  add column if not exists cutover_at timestamptz,
  add column if not exists cutover_transaction_id uuid;

-- Ledger counts of one moved row, in Basic Medical units (whole items).
create or replace function private.basic_medical_ledger_counts(p_inventory_id uuid)
returns table(good integer, damaged integer, location_id uuid, inventory_item_id uuid, factor numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    floor(coalesce(sum(b.quantity) filter (where b.condition = 'good'), 0) / m.base_units_per_requested_unit)::integer,
    floor(coalesce(sum(b.quantity) filter (where b.condition = 'damaged'), 0) / m.base_units_per_requested_unit)::integer,
    loc.id, m.inventory_item_id, m.base_units_per_requested_unit
  from public.basic_medical_room_inventory inv
  join public.equipment_inventory_mappings m on m.basic_medical_catalog_item_id = inv.catalog_item_id
  join public.inventory_storage_locations loc on loc.room_id = inv.room_id and loc.is_room_root
  left join public.inventory_stock_origins o on o.catalog_item_id = m.inventory_item_id
  left join public.inventory_stock_balances b on b.cohort_id = o.id and b.location_id = loc.id
  where inv.id = p_inventory_id
  group by loc.id, m.inventory_item_id, m.base_units_per_requested_unit;
$$;
revoke all on function private.basic_medical_ledger_counts(uuid) from public, anon, authenticated;

-- Moved rows change only as a projection of the ledger.
create or replace function private.basic_medical_room_inventory_cutover_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.cutover_at is not null and new.cutover_at is null then
    raise exception 'BASIC_MEDICAL_ROOM_INVENTORY_CUT_OVER' using errcode = '42501';
  end if;
  if old.cutover_at is not null
     and row(new.good_quantity, new.damaged_quantity, new.total_quantity)
         is distinct from row(old.good_quantity, old.damaged_quantity, old.total_quantity)
     and coalesce(current_setting('app.basic_medical_projection', true), '') <> 'true' then
    raise exception 'BASIC_MEDICAL_ROOM_INVENTORY_CUT_OVER' using errcode = '42501',
      hint = 'Thiết bị này đã chuyển sang kho chung; đổi số lượng tại Kho.';
  end if;
  return new;
end;
$$;
revoke all on function private.basic_medical_room_inventory_cutover_guard() from public, anon, authenticated;
drop trigger if exists basic_medical_room_inventory_cutover_guard on public.basic_medical_room_inventory;
create trigger basic_medical_room_inventory_cutover_guard
  before update on public.basic_medical_room_inventory
  for each row execute function private.basic_medical_room_inventory_cutover_guard();

-- Post a session's newly damaged count to the ledger (oldest cohorts first).
create or replace function private.basic_medical_post_session_damage(p_inventory_id uuid, p_quantity integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  cohort record;
  remaining numeric;
  take numeric;
  lines jsonb := '[]'::jsonb;
  result jsonb;
begin
  select * into target from private.basic_medical_ledger_counts(p_inventory_id);
  if target.location_id is null then
    raise exception 'BASIC_MEDICAL_LEDGER_UNMAPPED' using errcode = '22023';
  end if;
  remaining := p_quantity * target.factor;
  for cohort in
    select b.cohort_id, b.quantity, f.version, c.revision
    from public.inventory_stock_balances b
    join public.inventory_stock_origins o on o.id = b.cohort_id
    join public.inventory_receipt_cohorts c on c.origin_id = b.cohort_id
    join public.inventory_stock_facts f on f.id = c.current_fact_id
    where b.location_id = target.location_id and o.catalog_item_id = target.inventory_item_id
      and b.condition = 'good' and b.quantity > 0
    order by c.created_at, b.cohort_id
  loop
    take := least(remaining, cohort.quantity);
    lines := lines || jsonb_build_array(jsonb_build_object(
      'origin_id', cohort.cohort_id, 'expected_version', cohort.version,
      'expected_stock_revision', cohort.revision, 'from_condition', 'good',
      'to_condition', 'damaged', 'quantity', trim_scale(take)::text));
    remaining := remaining - take;
    exit when remaining <= 0;
  end loop;
  if remaining > 0 then
    raise exception 'BASIC_MEDICAL_LEDGER_SHORT' using errcode = '22023';
  end if;
  perform set_config('app.basic_medical_session_damage', 'true', true);
  result := public.inventory_command('change_stock_condition', jsonb_build_object(
    'location_id', target.location_id,
    'reason', 'Giảng viên báo hư khi xác nhận buổi Y cơ sở',
    'lines', lines), gen_random_uuid());
  perform set_config('app.basic_medical_session_damage', 'false', true);
  return (result->>'transaction_id')::uuid;
end;
$$;
revoke all on function private.basic_medical_post_session_damage(uuid, integer) from public, anon, authenticated;

-- Live patches, failing loudly if a fragment moved.
do $$
declare
  fn text;
  anchor text;
begin
  -- 1. The cutover opening is real without a P1 scope, only from the cutover RPC.
  fn := replace(pg_get_functiondef('private.p1_enter(text,text,jsonb,uuid)'::regprocedure), E'\r', '');
  anchor := E'p_operation in (''confirm_opening_balance'',''open_asset'') and p_payload->''pilot'' is null then';
  if position(anchor in fn) = 0 then raise exception 'p1_enter changed; update t4r3 patch'; end if;
  execute replace(fn, anchor, E'p_operation in (''confirm_opening_balance'',''open_asset'') and p_payload->''pilot'' is null\n    and coalesce(current_setting(''app.basic_medical_cutover'', true), '''') <> ''true'' then');

  fn := replace(pg_get_functiondef('private.p1_real_opening(jsonb,boolean)'::regprocedure), E'', '');
  anchor := E'then raise exception ''P1_REAL_OPENING_DECLARATION_REQUIRED'' using errcode=''42501''; end if;
';
  if position(anchor in fn) = 0 then raise exception 'p1_real_opening changed; update t4r3 patch'; end if;
  execute replace(fn, anchor, anchor
    || E' if coalesce(current_setting(''app.basic_medical_cutover'', true), '''') = ''true'' then return; end if;
');

  -- 2. A lecturer's session damage may post one condition change.
  fn := replace(pg_get_functiondef('private.p1_inventory_core(text,jsonb,uuid)'::regprocedure), E'\r', '');
  anchor := E'  if not private.can_access_inventory() then\n';
  if position(anchor in fn) = 0 then raise exception 'p1_inventory_core changed; update t4r3 patch'; end if;
  execute replace(fn, anchor, E'  if not private.can_access_inventory()\n     and not (p_operation = ''change_stock_condition''\n       and coalesce(current_setting(''app.basic_medical_session_damage'', true), '''') = ''true'') then\n');

  -- 3. Confirmation reads moved rows from the ledger and posts their damage.
  fn := replace(pg_get_functiondef('public.confirm_basic_medical_session(uuid,text,jsonb)'::regprocedure), E'\r', '');
  anchor := E'  perform private.assert_basic_medical_inventory_snapshot(session_row.room_id, target_checks);\n';
  if position(anchor in fn) = 0 then raise exception 'confirm_basic_medical_session changed (snapshot); update t4r3 patch'; end if;
  fn := replace(fn, anchor,
    E'  perform set_config(''app.basic_medical_projection'', ''true'', true);\n'
    || E'  update public.basic_medical_room_inventory inv\n'
    || E'  set good_quantity = l.good, damaged_quantity = l.damaged, total_quantity = l.good + l.damaged\n'
    || E'  from public.basic_medical_room_inventory moved\n'
    || E'  cross join lateral private.basic_medical_ledger_counts(moved.id) l\n'
    || E'  where inv.id = moved.id and moved.room_id = session_row.room_id and moved.cutover_at is not null;\n'
    || anchor);
  anchor := E'where id = inventory_row.id; insert into public.basic_medical_equipment_condition_logs';
  if position(anchor in fn) = 0 then raise exception 'confirm_basic_medical_session changed (damage); update t4r3 patch'; end if;
  fn := replace(fn, anchor,
    E'where id = inventory_row.id; if inventory_row.cutover_at is not null then perform private.basic_medical_post_session_damage(inventory_row.id, newly_damaged); end if; insert into public.basic_medical_equipment_condition_logs');
  anchor := E'  return jsonb_build_object(''confirmation_id'', confirmation_id_value';
  if position(anchor in fn) = 0 then raise exception 'confirm_basic_medical_session changed (return); update t4r3 patch'; end if;
  execute replace(fn, anchor, E'  perform set_config(''app.basic_medical_projection'', ''false'', true);\n' || anchor);

  -- 4. The preview lists only rows not yet moved.
  fn := replace(pg_get_functiondef('public.basic_medical_cutover_preview()'::regprocedure), E'\r', '');
  anchor := E'where inv.is_active and (inv.good_quantity > 0 or inv.damaged_quantity > 0);';
  if position(anchor in fn) = 0 then raise exception 'basic_medical_cutover_preview changed; update t4r3 patch'; end if;
  execute replace(fn, anchor, E'where inv.is_active and inv.cutover_at is null and (inv.good_quantity > 0 or inv.damaged_quantity > 0);');
end;
$$;

-- Step B: move every ready row in one audited opening at the room locations.
create or replace function public.basic_medical_cutover_apply(p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  ready record;
  ids uuid[] := '{}';
  lines jsonb := '[]'::jsonb;
  result jsonb;
  transaction_id uuid;
begin
  if not (select private.is_active_user()) or not (select private.has_role('admin')) then
    raise exception 'BASIC_MEDICAL_MAPPING_ADMIN_ONLY' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'REASON_REQUIRED' using errcode = '22023';
  end if;
  for ready in
    select inv.id, inv.good_quantity, inv.damaged_quantity, m.inventory_item_id,
      m.base_units_per_requested_unit as factor, loc.id as location_id
    from public.basic_medical_room_inventory inv
    join public.equipment_inventory_mappings m on m.basic_medical_catalog_item_id = inv.catalog_item_id
    join public.inventory_storage_locations loc on loc.room_id = inv.room_id and loc.is_room_root
    where inv.is_active and inv.cutover_at is null
    order by inv.id
    for update of inv
  loop
    ids := ids || ready.id;
    if ready.good_quantity > 0 or ready.damaged_quantity > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object(
        'line_key', ready.id::text, 'provenance_group', 'basic_medical_cutover',
        'catalog_item_id', ready.inventory_item_id, 'location_id', ready.location_id,
        'good_quantity', trim_scale(ready.good_quantity * ready.factor)::text,
        'damaged_quantity', trim_scale(ready.damaged_quantity * ready.factor)::text,
        'expiry_precision', 'not_required'));
    end if;
  end loop;
  if cardinality(ids) = 0 then
    return jsonb_build_object('moved', 0, 'transaction_id', null);
  end if;

  if jsonb_array_length(lines) > 0 then
    perform set_config('app.basic_medical_cutover', 'true', true);
    result := public.inventory_command('confirm_opening_balance', jsonb_build_object(
      'synthetic', false,
      'cutover_key', 'BM-CUTOVER-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-US'),
      'scope_description', 'Chuyển kho Y cơ sở sang kho chung',
      'count_cutoff', clock_timestamp(),
      'provenance_note', btrim(p_reason),
      'lines', lines), gen_random_uuid());
    perform set_config('app.basic_medical_cutover', 'false', true);
    transaction_id := (result->>'transaction_id')::uuid;
  end if;

  update public.basic_medical_room_inventory
  set cutover_at = clock_timestamp(), cutover_transaction_id = transaction_id
  where id = any(ids);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (actor, 'inventory.basic_medical_cutover', 'inventory_transaction', transaction_id,
    jsonb_build_object('rows', cardinality(ids), 'lines', jsonb_array_length(lines), 'reason', btrim(p_reason)));
  return jsonb_build_object('moved', cardinality(ids), 'transaction_id', transaction_id);
end;
$$;
revoke all on function public.basic_medical_cutover_apply(text) from public, anon;
grant execute on function public.basic_medical_cutover_apply(text) to authenticated;
