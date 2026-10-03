-- S5: request physical facts are distinct from recipient signatures.
-- Authority: medlabs-OPs/plans/S5_DESIGN_PACK.md (INV-057/058).
alter table public.equipment_requests add column if not exists fulfillment_revision bigint not null default 0;

create table if not exists public.equipment_fulfillment_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.equipment_requests(id) on delete restrict,
 preparation_id uuid not null references public.equipment_preparations(id) on delete restrict,
 revision bigint not null check(revision>0),
 operation text not null check(operation in ('handover','supplement','initial_return','recover','resolve','consequence','reconcile','correct')),
 business_key text not null check(btrim(business_key)<>''),
 actor_id uuid not null references public.profiles(id) on delete restrict,
 occurred_at timestamptz not null default clock_timestamp(),
 reason text not null check(btrim(reason)<>''),
 payload jsonb not null,
 corrects_event_id uuid references public.equipment_fulfillment_events(id) on delete restrict,
 transaction_id uuid references public.inventory_transactions(id) on delete restrict,
 signature_required boolean not null default false,
 unique(request_id,revision), unique(request_id,business_key)
);
create unique index if not exists equipment_fulfillment_initial_once on public.equipment_fulfillment_events(request_id,operation) where operation in ('handover','initial_return');
create index if not exists equipment_fulfillment_preparation on public.equipment_fulfillment_events(preparation_id);
create index if not exists equipment_fulfillment_correction on public.equipment_fulfillment_events(corrects_event_id) where corrects_event_id is not null;

-- Each issue slice retains exact provenance, units and return policy forever.
create table if not exists public.equipment_issue_slices (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.equipment_fulfillment_events(id) on delete restrict,
 request_line_id uuid not null references public.equipment_request_items(id) on delete restrict,
 mapping_id uuid not null references public.equipment_inventory_mappings(id) on delete restrict,
 inventory_item_id uuid not null references public.inventory_catalog_items(id) on delete restrict,
 location_id uuid not null references public.inventory_storage_locations(id) on delete restrict,
 cohort_id uuid references public.inventory_receipt_cohorts(origin_id) on delete restrict,
 asset_id uuid references public.equipment_assets(id) on delete restrict,
 quantity numeric(18,6) not null check(quantity>0),
 return_required boolean not null,
 base_units_per_requested_unit numeric(18,6) not null check(base_units_per_requested_unit>0),
 check((cohort_id is null)<>(asset_id is null)),
 check(asset_id is null or quantity=1)
);
create index if not exists equipment_issue_event on public.equipment_issue_slices(event_id);
create index if not exists equipment_issue_asset on public.equipment_issue_slices(asset_id) where asset_id is not null;
create index if not exists equipment_issue_line on public.equipment_issue_slices(request_line_id);

-- Positive receipt/resolution removes an obligation; negative corrections append
-- offsets. No mutable cumulative counters can diverge from the source facts.
create table if not exists public.equipment_fulfillment_effects (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.equipment_fulfillment_events(id) on delete restrict,
 issue_slice_id uuid not null references public.equipment_issue_slices(id) on delete restrict,
 kind text not null check(kind in ('issue_correction','receipt','resolution','consequence','hold','reconciliation')),
 quantity numeric(18,6) not null check(quantity<>0),
 location_id uuid references public.inventory_storage_locations(id) on delete restrict,
 condition text check(condition in ('good','damaged')),
 classification text,
 offsets_effect_id uuid references public.equipment_fulfillment_effects(id) on delete restrict,
 check(kind<>'receipt' or (location_id is not null and condition is not null))
);
create index if not exists equipment_effect_event on public.equipment_fulfillment_effects(event_id);
create index if not exists equipment_effect_slice on public.equipment_fulfillment_effects(issue_slice_id,kind);
create index if not exists equipment_effect_offset on public.equipment_fulfillment_effects(offsets_effect_id) where offsets_effect_id is not null;
create table if not exists public.equipment_fulfillment_signatures (
 event_id uuid primary key references public.equipment_fulfillment_events(id) on delete restrict,
 actor_id uuid not null references public.profiles(id) on delete restrict,
 signed_at timestamptz not null default clock_timestamp(),
 snapshot_hash text not null,
 signature text not null check(length(signature) between 100 and 400000 and signature like 'data:image/png;base64,%')
);

do $$ declare t text; begin
 foreach t in array array['equipment_fulfillment_events','equipment_issue_slices','equipment_fulfillment_effects','equipment_fulfillment_signatures'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('drop trigger if exists immutable_history on public.%I',t);
  execute format('create trigger immutable_history before update or delete on public.%I for each row execute function private.prevent_inventory_history_mutation()',t);
 end loop;
end $$;
drop policy if exists fulfillment_read on public.equipment_fulfillment_events;
create policy fulfillment_read on public.equipment_fulfillment_events for select to authenticated using(private.can_read_preparation(request_id));
drop policy if exists fulfillment_read on public.equipment_issue_slices;
create policy fulfillment_read on public.equipment_issue_slices for select to authenticated using(exists(select 1 from public.equipment_fulfillment_events e where e.id=event_id));
drop policy if exists fulfillment_read on public.equipment_fulfillment_effects;
create policy fulfillment_read on public.equipment_fulfillment_effects for select to authenticated using(exists(select 1 from public.equipment_fulfillment_events e where e.id=event_id));
drop policy if exists fulfillment_read on public.equipment_fulfillment_signatures;
create policy fulfillment_read on public.equipment_fulfillment_signatures for select to authenticated using(exists(select 1 from public.equipment_fulfillment_events e where e.id=event_id));

create or replace function private.s5_obligation(p_slice uuid)
returns table(issued numeric,returned numeric,resolved numeric,due numeric,held numeric)
language sql stable security definer set search_path='' as $$
 select s.quantity+coalesce(sum(f.quantity) filter(where f.kind='issue_correction'),0),
 coalesce(sum(f.quantity) filter(where f.kind='receipt'),0),
 coalesce(sum(f.quantity) filter(where f.kind='resolution'),0),
 case when s.return_required then s.quantity+coalesce(sum(f.quantity) filter(where f.kind='issue_correction'),0)-coalesce(sum(f.quantity) filter(where f.kind in ('receipt','resolution')),0) else 0 end,
 coalesce(sum(f.quantity) filter(where f.kind in ('hold','reconciliation')),0)
 from public.equipment_issue_slices s left join public.equipment_fulfillment_effects f on f.issue_slice_id=s.id where s.id=p_slice group by s.id;
$$;
revoke all on function private.s5_obligation(uuid) from public,anon,authenticated;
