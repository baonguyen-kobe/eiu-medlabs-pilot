-- ============================================================================
-- Migration: 20261003020000_inventory_s1_bounded_reads.sql
-- Description: S1 Bounded Read Contracts:
--   - Single-page bounded reads with default 50, max 100
--   - New 'summary' resource { active_item_count, active_source_count }
--   - New 'source_receipts' resource with intake transaction_id link
--   - Enhanced 'source_lines' with actual_base_quantity, expected_base_quantity,
--     base_discrepancy, and packaging array
--   - Enhanced 'cohorts' with canonical InventoryCohortDetail fields including
--     original intake transaction_id for /transactions/<id>?origin=<origin_id>
--   - Enhanced 'balances' with aggregate expiry_state filtering ('eligible', 'expired', 'unknown')
--   - Deterministic tie-breaker sort orders across all master and history resources
--   - Full role gate (private.can_access_inventory()) preserved
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

  -- --------------------------------------------------------------------------
  -- 11.13 Transaction Detail
  -- --------------------------------------------------------------------------
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
