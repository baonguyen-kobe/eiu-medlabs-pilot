-- S4: existing requests own demand; Inventory owns physical facts and commitments.
-- All commands share the S1 writer lock before row locks. No reservation ledger delta.
alter table public.equipment_requests add column if not exists preparation_revision bigint not null default 1;
alter table public.equipment_request_items
  add column if not exists registered_quantity integer,
  add column if not exists planned_quantity integer,
  add column if not exists baseline_source text not null default 'registration',
  add column if not exists line_revision bigint not null default 1,
  add column if not exists removed_at timestamptz;
update public.equipment_request_items set registered_quantity=quantity, baseline_source='cutover_snapshot' where registered_quantity is null;
alter table public.equipment_request_items alter column registered_quantity set not null;
alter table public.equipment_request_items alter column registered_quantity set default 0;
alter table public.equipment_request_items add constraint equipment_registered_quantity_nonnegative check (registered_quantity>=0);
update public.equipment_request_items set planned_quantity=quantity where planned_quantity is null;
alter table public.equipment_request_items alter column planned_quantity set not null;
alter table public.equipment_request_items alter column planned_quantity set default 0;
alter table public.equipment_request_items add constraint equipment_planned_quantity_nonnegative check (planned_quantity>=0);

create table public.equipment_inventory_mappings (
  id uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null references public.equipment_catalog(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_catalog_items(id) on delete restrict,
  base_units_per_requested_unit numeric(18,6) not null check (base_units_per_requested_unit>0),
  demand_unit text not null check (btrim(demand_unit)<>''),
  base_uom_code text not null references public.inventory_uoms(code) on delete restrict,
  reason text not null check (btrim(reason)<>''),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(catalog_item_id,inventory_item_id,base_units_per_requested_unit,demand_unit,base_uom_code)
);
create table public.equipment_preparations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.equipment_requests(id) on delete restrict,
  state text not null default 'draft' check(state in ('draft','prepared','reversing','reversed','cancelled')),
  revision bigint not null default 1,
  source_revision bigint not null,
  draft jsonb not null default '{"lines":[]}'::jsonb,
  lock_holder uuid references public.profiles(id) on delete restrict,
  lock_token uuid,
  lock_expires_at timestamptz,
  primary_preparer uuid references public.profiles(id) on delete restrict,
  previous_preparer uuid references public.profiles(id) on delete restrict,
  health jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  check ((lock_holder is null)=(lock_token is null)),
  check ((lock_holder is null)=(lock_expires_at is null))
);
create unique index equipment_preparations_current on public.equipment_preparations(request_id) where state in ('draft','prepared','reversing');
create table public.equipment_preparation_plans (
  id uuid primary key default gen_random_uuid(),
  preparation_id uuid not null references public.equipment_preparations(id) on delete restrict,
  revision bigint not null,
  plan jsonb not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(preparation_id,revision)
);
create table public.equipment_preparation_allocations (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.equipment_preparation_plans(id) on delete restrict,
  request_line_id uuid not null references public.equipment_request_items(id) on delete restrict,
  mapping_id uuid not null references public.equipment_inventory_mappings(id) on delete restrict,
  location_id uuid not null references public.inventory_storage_locations(id) on delete restrict,
  base_quantity numeric(18,6) not null check(base_quantity>0),
  created_at timestamptz not null default clock_timestamp()
);
create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  preparation_id uuid not null references public.equipment_preparations(id) on delete restrict,
  allocation_id uuid not null references public.equipment_preparation_allocations(id) on delete restrict,
  cohort_id uuid references public.inventory_receipt_cohorts(origin_id) on delete restrict,
  location_id uuid not null references public.inventory_storage_locations(id) on delete restrict,
  asset_id uuid references public.equipment_assets(id) on delete restrict,
  quantity numeric(18,6) not null check(quantity>0),
  created_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  check ((cohort_id is not null and asset_id is null) or (cohort_id is null and asset_id is not null and quantity=1))
);
create unique index inventory_reservations_active_asset on public.inventory_reservations(asset_id) where released_at is null and asset_id is not null;
create index inventory_reservations_active_pool on public.inventory_reservations(cohort_id,location_id) where released_at is null;
create index inventory_reservations_preparation on public.inventory_reservations(preparation_id);
create table public.equipment_quantity_adjustments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.equipment_requests(id) on delete restrict,
  submitted_revision bigint not null,
  targets jsonb not null,
  reason text not null check(btrim(reason)<>''),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  review_note text,
  created_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz
);
create unique index equipment_adjustment_one_pending on public.equipment_quantity_adjustments(request_id) where status='pending';
create table public.equipment_preparation_transfers (
  id uuid primary key default gen_random_uuid(),
  preparation_id uuid not null references public.equipment_preparations(id) on delete restrict,
  transaction_id uuid not null references public.inventory_transactions(id) on delete restrict,
  compensates_id uuid references public.equipment_preparation_transfers(id) on delete restrict,
  source_location_id uuid not null references public.inventory_storage_locations(id) on delete restrict,
  destination_location_id uuid not null references public.inventory_storage_locations(id) on delete restrict,
  cohort_id uuid references public.inventory_receipt_cohorts(origin_id) on delete restrict,
  asset_id uuid references public.equipment_assets(id) on delete restrict,
  quantity numeric(18,6) not null check(quantity>0),
  condition text not null check(condition in ('good','damaged','asset')),
  created_at timestamptz not null default clock_timestamp(),
  check(source_location_id<>destination_location_id),
  check((cohort_id is not null and asset_id is null and condition<>'asset') or (cohort_id is null and asset_id is not null and quantity=1 and condition='asset'))
);
create index equipment_preparation_transfers_owner on public.equipment_preparation_transfers(preparation_id);
create index equipment_preparation_transfers_compensation on public.equipment_preparation_transfers(compensates_id);
create table public.equipment_preparation_events (
  id uuid primary key default gen_random_uuid(),
  -- Keep immutable registration evidence if the existing root-only, pre-preparation
  -- hard-delete authority removes the request. Operational attempts still restrict deletion.
  request_id uuid not null,
  preparation_id uuid references public.equipment_preparations(id) on delete restrict,
  operation text not null,
  actor_id uuid references public.profiles(id) on delete restrict,
  revision bigint not null,
  payload jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index equipment_preparation_events_page on public.equipment_preparation_events(request_id,created_at desc,id desc);

create or replace function private.can_read_preparation(p_request_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.is_active_user() and exists(select 1 from public.equipment_requests r where r.id=p_request_id and (private.can_manage_equipment_request(r.id) or auth.uid() in (r.registrant_id,r.responsible_lecturer_id)));
$$;
create or replace function private.s4_immutable()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'S4_HISTORY_IMMUTABLE' using errcode='42501'; end;
$$;
create trigger equipment_mapping_immutable before update or delete on public.equipment_inventory_mappings for each row execute function private.s4_immutable();
create trigger equipment_plan_immutable before update or delete on public.equipment_preparation_plans for each row execute function private.s4_immutable();
create trigger equipment_allocation_immutable before update or delete on public.equipment_preparation_allocations for each row execute function private.s4_immutable();
create trigger equipment_transfer_immutable before update or delete on public.equipment_preparation_transfers for each row execute function private.s4_immutable();
create trigger equipment_preparation_event_immutable before update or delete on public.equipment_preparation_events for each row execute function private.s4_immutable();

alter table public.equipment_inventory_mappings enable row level security;
alter table public.equipment_preparations enable row level security;
alter table public.equipment_preparation_plans enable row level security;
alter table public.equipment_preparation_allocations enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.equipment_quantity_adjustments enable row level security;
alter table public.equipment_preparation_transfers enable row level security;
alter table public.equipment_preparation_events enable row level security;
create policy equipment_mapping_read on public.equipment_inventory_mappings for select to authenticated using(private.can_access_inventory());
create policy equipment_preparation_read on public.equipment_preparations for select to authenticated using(private.can_access_inventory() and private.can_manage_equipment_request(request_id));
create policy equipment_plan_read on public.equipment_preparation_plans for select to authenticated using(exists(select 1 from public.equipment_preparations p where p.id=preparation_id));
create policy equipment_allocation_read on public.equipment_preparation_allocations for select to authenticated using(exists(select 1 from public.equipment_preparation_plans p where p.id=plan_id));
create policy inventory_reservation_read on public.inventory_reservations for select to authenticated using(exists(select 1 from public.equipment_preparations p where p.id=preparation_id));
create policy equipment_adjustment_read on public.equipment_quantity_adjustments for select to authenticated using(private.can_read_preparation(request_id));
create policy equipment_transfer_read on public.equipment_preparation_transfers for select to authenticated using(exists(select 1 from public.equipment_preparations p where p.id=preparation_id));
create policy equipment_preparation_event_read on public.equipment_preparation_events for select to authenticated using(private.can_read_preparation(request_id) or (private.is_active_user() and private.can_hard_delete() and not exists(select 1 from public.equipment_requests r where r.id=request_id)));
revoke all on public.equipment_inventory_mappings,public.equipment_preparations,public.equipment_preparation_plans,public.equipment_preparation_allocations,public.inventory_reservations,public.equipment_quantity_adjustments,public.equipment_preparation_transfers,public.equipment_preparation_events from public,anon,authenticated;
grant select on public.equipment_inventory_mappings,public.equipment_preparation_plans,public.equipment_preparation_allocations,public.inventory_reservations,public.equipment_quantity_adjustments,public.equipment_preparation_transfers,public.equipment_preparation_events to authenticated;
grant select(id,request_id,state,revision,source_revision,draft,lock_holder,lock_expires_at,primary_preparer,previous_preparer,health,created_at,confirmed_at) on public.equipment_preparations to authenticated;
revoke all on function private.can_read_preparation(uuid),private.s4_immutable() from public,anon;
grant execute on function private.can_read_preparation(uuid) to authenticated;

create or replace function private.s4_pool_backing(p_cohort uuid,p_location uuid)
returns numeric language sql stable security definer set search_path='' as $$
 select coalesce((select b.quantity from public.inventory_stock_balances b
 join public.inventory_stock_origins o on o.id=b.cohort_id
 join public.inventory_receipt_cohorts c on c.origin_id=o.id
 join public.inventory_stock_facts f on f.id=c.current_fact_id
 join public.inventory_catalog_items i on i.id=o.catalog_item_id
 join public.inventory_storage_locations l on l.id=b.location_id
 where b.cohort_id=p_cohort and b.location_id=p_location and b.condition='good' and i.active and l.active
 and not exists(select 1 from public.inventory_stock_holds h where h.origin_id=o.id and h.status='active')
 and (not i.expiry_required or (f.expiry_precision in ('day','month') and f.expiry_date is not null))
 and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)),0);
$$;
create or replace function private.s4_asset_eligible(p_asset uuid,p_location uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.equipment_assets a join public.inventory_catalog_items i on i.id=a.catalog_item_id join public.inventory_storage_locations l on l.id=a.location_id
 where a.id=p_asset and a.location_id=p_location and i.active and l.active and a.lifecycle_status='in_service' and a.operational_status='ready'
 and (not i.expiry_required or (a.expiry_precision in ('day','month') and a.expiry_date is not null))
 and (a.expiry_date is null or a.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date));
$$;
create or replace function private.s4_quantity(p_value text)
returns numeric language plpgsql immutable set search_path='' as $$
declare q numeric;
begin
 if p_value is null or p_value !~ '^([0-9]+)(\.[0-9]{1,6})?$' then raise exception 'S4_EXACT_QUANTITY_REQUIRED' using errcode='22023'; end if;
 q:=p_value::numeric;
 if q>=1000000000000 then raise exception 'S4_QUANTITY_OVERFLOW' using errcode='22023'; end if;
 return q;
end; $$;
revoke all on function private.s4_pool_backing(uuid,uuid),private.s4_asset_eligible(uuid,uuid),private.s4_quantity(text) from public,anon,authenticated;
