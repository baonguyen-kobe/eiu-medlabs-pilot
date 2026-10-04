-- INV-062. Mock-only; no operational-stock authorization is represented here.
create table if not exists public.inventory_pilot_scopes (
 id uuid primary key,
 project_ref text not null check(project_ref='kwpyukofofoaqhmxndlc'),
 scope_version bigint not null check(scope_version>0),
 manifest_id uuid not null unique,
 manifest jsonb not null check(jsonb_typeof(manifest)='object' and (manifest->'synthetic') is not distinct from 'true'::jsonb and (manifest->>'dataset_kind') is not distinct from 'mock'),
 manifest_hash text not null,
 synthetic boolean not null default true check(synthetic),
 phase text not null default 'OPENING_READY' check(phase in ('OPENING_READY','ACTIVE','PAUSED')),
 admin_id uuid not null references public.profiles(id) on delete restrict,
 staff_ids uuid[] not null check(cardinality(staff_ids)=2),
 location_id uuid not null unique references public.inventory_storage_locations(id) on delete restrict,
 opening_reference text not null unique check(btrim(opening_reference)<>''),
 count_cutoff timestamptz not null,
 opening_confirmed boolean not null default false,
 opening_batch_id uuid references public.inventory_opening_batches(id) on delete restrict,
 reconciliation jsonb,
 registered_by uuid not null references public.profiles(id) on delete restrict,
 registered_at timestamptz not null default now(),
 updated_by uuid not null references public.profiles(id) on delete restrict,
 updated_at timestamptz not null default clock_timestamp(),
 evidence_reference text not null check(btrim(evidence_reference)<>'')
);
create table if not exists public.inventory_pilot_scope_items (
 scope_id uuid not null references public.inventory_pilot_scopes(id) on delete restrict,
 catalog_item_id uuid not null unique references public.inventory_catalog_items(id) on delete restrict,
 primary key(scope_id,catalog_item_id)
);
create table if not exists public.inventory_pilot_writers (
 scope_id uuid not null references public.inventory_pilot_scopes(id) on delete restrict,
 writer_id text not null check(writer_id in ('inventory_command','equipment_asset_command','equipment_preparation_command','equipment_preparation_transfer','equipment_fulfillment_command','legacy','privileged_import','manual_offline')),
 allowed boolean not null,
 evidence_reference text,
 recorded_by uuid references public.profiles(id) on delete restrict,
 recorded_at timestamptz,
 primary key(scope_id,writer_id),
 check(not allowed or writer_id not in ('legacy','privileged_import','manual_offline'))
);
create table if not exists public.inventory_pilot_asset_bindings (
 scope_id uuid not null references public.inventory_pilot_scopes(id) on delete restrict,
 row_key text not null check(btrim(row_key)<>''),
 catalog_item_id uuid not null references public.inventory_catalog_items(id) on delete restrict,
 location_id uuid not null references public.inventory_storage_locations(id) on delete restrict,
 intake_reference text not null check(btrim(intake_reference)<>''),
 manufacturer text not null check(btrim(manufacturer)<>''),
 model text not null check(btrim(model)<>''),
 manufacturer_serial text not null check(btrim(manufacturer_serial)<>''),
 asset_id uuid unique references public.equipment_assets(id) on delete restrict,
 asset_code text,
 bound_by uuid references public.profiles(id) on delete restrict,
 bound_at timestamptz,
 opening_event_id uuid references public.equipment_asset_events(id) on delete restrict,
 primary key(scope_id,row_key),
 unique(intake_reference,row_key),
 check((asset_id is null and asset_code is null and bound_by is null and bound_at is null and opening_event_id is null) or (asset_id is not null and asset_code is not null and bound_by is not null and bound_at is not null and opening_event_id is not null))
);
create unique index if not exists inventory_pilot_expected_serial on public.inventory_pilot_asset_bindings(lower(btrim(manufacturer)),lower(btrim(model)),lower(btrim(manufacturer_serial)));
create table if not exists public.inventory_pilot_events (
 id uuid primary key default gen_random_uuid(),
 scope_id uuid not null references public.inventory_pilot_scopes(id) on delete restrict,
 scope_version bigint not null,
 manifest_id uuid not null,
 operation text not null,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 occurred_at timestamptz not null default clock_timestamp(),
 phase text not null check(phase in ('OPENING_READY','ACTIVE','PAUSED')),
 reason text not null check(btrim(reason)<>''),
 evidence_reference text not null check(btrim(evidence_reference)<>''),
 related_event_id uuid references public.inventory_pilot_events(id) on delete restrict,
 details jsonb not null default '{}'
);
create index if not exists inventory_pilot_events_scope on public.inventory_pilot_events(scope_id,occurred_at,id);
create unique index if not exists inventory_pilot_dual_write_reference on public.inventory_pilot_events(scope_id,evidence_reference) where operation='report_dual_write';
create unique index if not exists inventory_pilot_resolved_once on public.inventory_pilot_events(related_event_id) where operation='resolve_discrepancy';
-- Only trusted command wrappers can mint this capability; custom GUCs cannot.
create table if not exists private.inventory_pilot_writer_context (
 transaction_id bigint primary key,
 backend_pid integer not null,
 actor_id uuid,
 writer_id text not null,
 operation text not null,
 request_id uuid,
 pilot jsonb,
 payload jsonb not null,
 bound_scope_id uuid,
 outside_touched boolean not null default false,
 opening_checked boolean not null default false
);
revoke all on private.inventory_pilot_writer_context from public,anon,authenticated,service_role;
do $$ declare t text; begin
 foreach t in array array['inventory_pilot_scopes','inventory_pilot_scope_items','inventory_pilot_writers','inventory_pilot_asset_bindings','inventory_pilot_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
