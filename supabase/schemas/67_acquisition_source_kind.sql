-- t2c owner decision (2026-11-17): a source record is either a purchase
-- (Hợp đồng / Hóa đơn, supplier required) or a donation without documents
-- (Tặng / Không chứng từ, supplier optional, origin note required).
-- Existing records stay purchases. The kind is fixed at creation.

alter table public.acquisition_records
  add column if not exists source_kind text not null default 'purchase';

alter table public.acquisition_records
  drop constraint if exists acquisition_records_source_kind_valid,
  add constraint acquisition_records_source_kind_valid
    check (source_kind in ('purchase', 'donation'));

alter table public.acquisition_records alter column supplier_id drop not null;

alter table public.acquisition_records
  drop constraint if exists acquisition_records_supplier_by_kind,
  add constraint acquisition_records_supplier_by_kind
    check (source_kind = 'donation' or supplier_id is not null),
  drop constraint if exists acquisition_records_donation_note,
  add constraint acquisition_records_donation_note
    check (source_kind <> 'donation' or btrim(coalesce(notes, '')) <> '');

-- The command and read functions are large and wrapped by the P1 gate, so
-- this patches the exact fragments of the live definitions (the pattern of
-- 20260805154721) and fails loudly if they have changed.
do $migration$
declare
  definition text;
  core_create_old text := $old$
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
$old$;
  core_create_new text := $new$
    if coalesce(p_payload->>'source_kind', 'purchase') not in ('purchase', 'donation') then
      raise exception 'SOURCE_KIND_INVALID' using errcode = '22023';
    end if;
    if coalesce(p_payload->>'source_kind', 'purchase') = 'donation'
       and nullif(p_payload->>'supplier_id', '') is null then
      -- v_supp is a record: a no-row select gives it a shape with a null id.
      select * into v_supp from public.inventory_suppliers where false;
      if btrim(coalesce(p_payload->>'notes', '')) = '' then
        raise exception 'DONATION_NOTE_REQUIRED: Ghi rõ nguồn gốc hàng tặng' using errcode = '22023';
      end if;
    else
      select * into v_supp from public.inventory_suppliers where id = (p_payload->>'supplier_id')::uuid;
      if not found or not v_supp.active then
        raise exception 'INACTIVE_REFERENCE: Supplier not found or inactive' using errcode = '22023';
      end if;
    end if;

    insert into public.acquisition_records (
      source_reference, source_kind, supplier_id, reference_date, funding_source,
      external_reference, notes, status, revision
    ) values (
      v_code, coalesce(p_payload->>'source_kind', 'purchase'), v_supp.id, (p_payload->>'reference_date')::date,
      p_payload->>'funding_source', p_payload->>'external_reference',
      p_payload->>'notes', 'active', 1
    ) returning id into v_id;
$new$;
  read_old text := $old$
      select a.id, a.source_reference, a.supplier_id, s.name as supplier_name,$old$;
  read_new text := $new$
      select a.id, a.source_reference, a.source_kind, a.supplier_id, s.name as supplier_name,$new$;
  join_old text := $old$
      join public.inventory_suppliers s on s.id = a.supplier_id$old$;
  join_new text := $new$
      left join public.inventory_suppliers s on s.id = a.supplier_id$new$;
begin
  -- A Windows checkout may give this file CRLF; live definitions use LF.
  core_create_old := replace(core_create_old, E'\r', '');
  core_create_new := replace(core_create_new, E'\r', '');
  read_old := replace(read_old, E'\r', '');
  read_new := replace(read_new, E'\r', '');
  join_old := replace(join_old, E'\r', '');
  join_new := replace(join_new, E'\r', '');

  definition := pg_get_functiondef('private.p1_inventory_core(text,jsonb,uuid)'::regprocedure);
  if position(core_create_old in definition) = 0 then
    raise exception 'P1_INVENTORY_CORE_DEFINITION_CHANGED';
  end if;
  execute replace(definition, core_create_old, core_create_new);

  definition := pg_get_functiondef('public.inventory_read(text,jsonb)'::regprocedure);
  if position(read_old in definition) = 0 or position(join_old in definition) = 0 then
    raise exception 'INVENTORY_READ_DEFINITION_CHANGED';
  end if;
  execute replace(replace(definition, read_old, read_new), join_old, join_new);
end;
$migration$;
