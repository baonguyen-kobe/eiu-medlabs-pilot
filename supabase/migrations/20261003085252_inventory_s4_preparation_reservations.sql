-- INV-054/055: isolated synthetic pilot S4 preparation/reservation.


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


-- Stable shared request identity; Basic Medical remains outside Inventory preparation.
create or replace function private.s4_guard_line()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; changed boolean;
begin
 if tg_op='DELETE' then
  if private.can_hard_delete() and not exists(select 1 from public.equipment_preparations where request_id=old.request_id) then return old; end if;
  raise exception 'S4_LINE_HISTORY_IMMUTABLE' using errcode='42501';
 end if;
 select * into r from public.equipment_requests where id=new.request_id for update;
 if tg_op='UPDATE' then
  if new.id<>old.id or new.request_id<>old.request_id or new.registered_quantity<>old.registered_quantity or new.baseline_source<>old.baseline_source then raise exception 'S4_REGISTERED_BASELINE_IMMUTABLE' using errcode='42501'; end if;
  if new.planned_quantity is distinct from old.planned_quantity
     and coalesce(current_setting('app.s4_command',true),'')<>'true' then
   raise exception 'S4_USE_QUANTITY_ADJUSTMENT' using errcode='42501';
  end if;
  changed:=row(new.skill_name,new.catalog_item_id,new.basic_medical_catalog_item_id,new.quantity,new.note,new.removed_at) is distinct from row(old.skill_name,old.catalog_item_id,old.basic_medical_catalog_item_id,old.quantity,old.note,old.removed_at);
  if changed then
   if r.request_domain='nursing_skills'
      and row(new.catalog_item_id,new.quantity,new.removed_at) is distinct from row(old.catalog_item_id,old.quantity,old.removed_at)
      and coalesce(current_setting('app.s4_command',true),'')<>'true' then
    raise exception 'S4_USE_QUANTITY_ADJUSTMENT' using errcode='42501';
   end if;
   if r.request_domain='nursing_skills' and r.status<>'new' and coalesce(current_setting('app.s4_command',true),'')<>'true' then raise exception 'S4_USE_QUANTITY_ADJUSTMENT' using errcode='42501'; end if;
   if new.skill_name<>old.skill_name and exists(select 1 from public.equipment_preparations p where p.request_id=r.id and p.state='draft' and p.lock_expires_at>clock_timestamp()) then raise exception 'S4_ACTIVITY_LOCKED_DURING_PREPARATION' using errcode='42501'; end if;
   new.line_revision:=old.line_revision+1;
  else new.line_revision:=old.line_revision;
  end if;
 else
  if r.request_domain='nursing_skills'
     and coalesce(current_setting('app.s4_registration',true),'')<>new.request_id::text
     and coalesce(current_setting('app.s4_command',true),'')<>'true' then
   raise exception 'S4_USE_QUANTITY_ADJUSTMENT' using errcode='42501';
  end if;
  if r.request_domain='nursing_skills' and r.status<>'new' and coalesce(current_setting('app.s4_command',true),'')<>'true' then raise exception 'S4_USE_QUANTITY_ADJUSTMENT' using errcode='42501'; end if;
  if coalesce(current_setting('app.s4_registration',true),'')=new.request_id::text then
   new.registered_quantity:=new.quantity; new.planned_quantity:=new.quantity; new.baseline_source:='registration';
  else new.registered_quantity:=0; new.planned_quantity:=0; new.baseline_source:='added'; end if;
  changed:=true;
 end if;
 if changed then
  update public.equipment_requests set preparation_revision=preparation_revision+1 where id=new.request_id;
 end if;
 return new;
end; $$;
create trigger equipment_items_s4_identity before insert or update or delete on public.equipment_request_items for each row execute function private.s4_guard_line();

create or replace function private.s4_begin_registration()
returns trigger language plpgsql security definer set search_path='' as $$
begin perform set_config('app.s4_registration',new.id::text,true); return new; end; $$;
create trigger equipment_requests_s4_registration after insert on public.equipment_requests for each row execute function private.s4_begin_registration();

create or replace function private.s4_sync_lines(p_request uuid,p_items jsonb,p_basic_skill text default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; j jsonb; item_id uuid; seen uuid[]:='{}'; old_line public.equipment_request_items;
begin
 select * into r from public.equipment_requests where id=p_request for update;
 if not private.is_active_user() or not (r.registrant_id=auth.uid() or private.can_manage_equipment_request(r.id)) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 500 then raise exception 'EQUIPMENT_REQUEST_ITEMS_REQUIRED' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) entry where (entry->>'expected_revision')::bigint is distinct from r.preparation_revision) then raise exception 'STALE_REVISION' using errcode='23505'; end if;
 if r.status not in ('new','preparing') or (r.request_domain='nursing_skills' and r.status<>'new') then raise exception 'S4_USE_QUANTITY_ADJUSTMENT' using errcode='42501'; end if;
 perform set_config('app.s4_registration','',true);
 -- Remove excluded identities before inserting replacements, so the old
 -- commercial-name guard cannot mistake a tombstone for an active duplicate.
 update public.equipment_request_items l set removed_at=clock_timestamp()
 where l.request_id=p_request and l.removed_at is null
   and not exists(select 1 from jsonb_array_elements(p_items) entry where nullif(entry->>'id','')::uuid=l.id);
 for j in select value from jsonb_array_elements(p_items) loop
  if (j->>'quantity')::integer<1 then raise exception 'INVALID_QUANTITY' using errcode='22023'; end if;
  item_id:=nullif(j->>'id','')::uuid;
  if item_id is not null then
   select * into old_line from public.equipment_request_items where id=item_id and request_id=p_request and removed_at is null;
   if not found or item_id=any(seen) then raise exception 'S4_INVALID_LINE_ID' using errcode='22023'; end if;
   update public.equipment_request_items set skill_name=coalesce(p_basic_skill,btrim(j->>'skill_name')),catalog_item_id=case when r.request_domain='nursing_skills' then (j->>'catalog_item_id')::uuid end,basic_medical_catalog_item_id=case when r.request_domain='basic_medical' then (j->>'catalog_item_id')::uuid end,quantity=(j->>'quantity')::integer,note=nullif(btrim(j->>'note'),'') where id=item_id;
  else
   insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,basic_medical_catalog_item_id,quantity,note)
   values(p_request,coalesce(p_basic_skill,btrim(j->>'skill_name')),case when r.request_domain='nursing_skills' then (j->>'catalog_item_id')::uuid end,case when r.request_domain='basic_medical' then (j->>'catalog_item_id')::uuid end,(j->>'quantity')::integer,nullif(btrim(j->>'note'),'')) returning id into item_id;
  end if;
  seen:=array_append(seen,item_id);
 end loop;
end; $$;
revoke all on function private.s4_guard_line(),private.s4_begin_registration(),private.s4_sync_lines(uuid,jsonb,text) from public,anon,authenticated;

create or replace function private.s4_add_line(p_request uuid,p_line uuid,p_catalog uuid,p_skill text,p_quantity integer,p_note text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_line is null or p_quantity is null or p_quantity<1
    or not exists(select 1 from public.equipment_catalog where id=p_catalog and is_active)
    or not exists(select 1 from public.equipment_request_items where request_id=p_request and removed_at is null and skill_name=p_skill)
    or exists(select 1 from public.equipment_request_items where id=p_line) then
  raise exception 'S4_INVALID_ADDED_LINE' using errcode='22023';
 end if;
 perform set_config('app.s4_registration','',true);
 insert into public.equipment_request_items(id,request_id,catalog_item_id,skill_name,quantity,note)
 values(p_line,p_request,p_catalog,p_skill,p_quantity,nullif(btrim(p_note),''));
end; $$;

create or replace function private.s4_snapshot_line()
returns trigger language plpgsql security definer set search_path='' as $$
declare catalog jsonb;
begin
 if tg_op='UPDATE' and row(new.skill_name,new.catalog_item_id,new.basic_medical_catalog_item_id,new.quantity,new.planned_quantity,new.note,new.removed_at)
    is not distinct from row(old.skill_name,old.catalog_item_id,old.basic_medical_catalog_item_id,old.quantity,old.planned_quantity,old.note,old.removed_at) then return new; end if;
 if new.catalog_item_id is not null then
  select to_jsonb(c) into catalog from public.equipment_catalog c where c.id=new.catalog_item_id;
 else
  select to_jsonb(c) into catalog from public.basic_medical_equipment_catalog c where c.id=new.basic_medical_catalog_item_id;
 end if;
 insert into public.equipment_preparation_events(request_id,operation,actor_id,revision,payload)
 values(new.request_id,case when tg_op='INSERT' then 'line_registered' else 'line_changed' end,auth.uid(),
   (select preparation_revision from public.equipment_requests where id=new.request_id),
   jsonb_build_object('before',case when tg_op='UPDATE' then to_jsonb(old) else null end,'after',to_jsonb(new),'catalog_snapshot',catalog));
 return new;
end; $$;
create trigger equipment_items_s4_snapshot after insert or update on public.equipment_request_items for each row execute function private.s4_snapshot_line();
revoke all on function private.s4_add_line(uuid,uuid,uuid,text,integer,text),private.s4_snapshot_line() from public,anon,authenticated;


-- Drafts may be incomplete, but must remain readable by every supported client.
create or replace function private.s4_validate_draft(p_plan jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare j jsonb; a jsonb; asset jsonb;
begin
 if jsonb_typeof(p_plan) is distinct from 'object' or jsonb_typeof(p_plan->'lines') is distinct from 'array' then raise exception 'S4_INVALID_DRAFT'; end if;
 if jsonb_array_length(p_plan->'lines')>500 then raise exception 'S4_INVALID_DRAFT'; end if;
 for j in select value from jsonb_array_elements(p_plan->'lines') loop
  if nullif(j->>'line_id','') is null or jsonb_typeof(j->'planned_quantity') is distinct from 'string'
     or jsonb_typeof(j->'shortage_reason') is distinct from 'string'
     or jsonb_typeof(j->'allocations') is distinct from 'array'
     or not(j ? 'reviewed_revision') then raise exception 'S4_INVALID_DRAFT'; end if;
  perform (j->>'line_id')::uuid;
  if j->'reviewed_revision'<>'null'::jsonb and (jsonb_typeof(j->'reviewed_revision')<>'number' or (j->>'reviewed_revision')!~'^[1-9][0-9]*$') then raise exception 'S4_INVALID_DRAFT'; end if;
  if jsonb_array_length(j->'allocations')>100 then raise exception 'S4_INVALID_DRAFT'; end if;
  for a in select value from jsonb_array_elements(j->'allocations') loop
   if nullif(a->>'mapping_id','') is null or nullif(a->>'location_id','') is null
      or jsonb_typeof(a->'base_quantity') is distinct from 'string'
      or jsonb_typeof(a->'asset_ids') is distinct from 'array' then raise exception 'S4_INVALID_DRAFT'; end if;
   perform (a->>'mapping_id')::uuid; perform (a->>'location_id')::uuid;
   for asset in select value from jsonb_array_elements(a->'asset_ids') loop
    if jsonb_typeof(asset)<>'string' then raise exception 'S4_INVALID_DRAFT'; end if;
    perform (asset#>>'{}')::uuid;
   end loop;
  end loop;
 end loop;
end; $$;
revoke all on function private.s4_validate_draft(jsonb) from public,anon,authenticated;

-- Private transaction engine. Called only after request/actor/revision/lock checks.
create or replace function private.s4_commit_plan(p_preparation uuid,p_plan jsonb,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.equipment_preparations; r public.equipment_requests; ln public.equipment_request_items;
 j jsonb; a jsonb; ar jsonb; mp record; pool record; asset public.equipment_assets;
 plan_id uuid; allocation_id uuid; q numeric; planned numeric; numerator numeric; denominator numeric; factor numeric; divisor numeric; needed numeric; available numeric; take numeric; total numeric:=0; seen uuid[]:='{}';
begin
 perform private.s4_validate_draft(p_plan);
 select * into p from public.equipment_preparations where id=p_preparation for update;
 select * into r from public.equipment_requests where id=p.request_id for update;
 if p.id is null or p.state not in ('draft','prepared') or r.request_domain<>'nursing_skills' then raise exception 'S4_INVALID_STATE'; end if;
 if r.late_approval_status in ('pending','rejected') then raise exception 'S4_LATE_APPROVAL_REQUIRED'; end if;
 if r.receive_at is null or r.return_at<r.receive_at or r.responsible_lecturer_id is null then raise exception 'S4_PICKUP_RETURN_REQUIRED'; end if;
 if jsonb_typeof(p_plan->'lines') is distinct from 'array' or jsonb_array_length(p_plan->'lines') not between 1 and 500 then raise exception 'S4_LINES_REQUIRED'; end if;
 -- Releasing the previous revision is transactional: every validation failure restores it.
 update public.inventory_reservations set released_at=clock_timestamp() where preparation_id=p.id and released_at is null;
 insert into public.equipment_preparation_plans(preparation_id,revision,plan,actor_id,reason) values(p.id,p.revision+1,p_plan,auth.uid(),p_reason) returning id into plan_id;
 for j in select value from jsonb_array_elements(p_plan->'lines') loop
  select * into ln from public.equipment_request_items where id=(j->>'line_id')::uuid and request_id=r.id and removed_at is null;
  if not found or ln.id=any(seen) then raise exception 'S4_INVALID_LINE_ID'; end if;
  seen:=array_append(seen,ln.id);
  if (j->>'reviewed_revision')::bigint is distinct from ln.line_revision then raise exception 'S4_REVIEW_REQUIRED'; end if;
  planned:=private.s4_quantity(j->>'planned_quantity');
  if planned<>trunc(planned) or planned>2147483647 then raise exception 'S4_DEMAND_UNIT_INTEGER_REQUIRED'; end if;
  if planned<coalesce((select (t.value->>'quantity')::integer
      from public.equipment_quantity_adjustments qa cross join lateral jsonb_array_elements(qa.targets) t
      where qa.request_id=r.id and qa.status='approved' and t.value->>'line_id'=ln.id::text
      order by qa.reviewed_at desc,qa.id desc limit 1),ln.quantity)
     and nullif(btrim(j->>'shortage_reason'),'') is null then raise exception 'S4_SHORTAGE_REASON_REQUIRED'; end if;
  if jsonb_typeof(j->'allocations') is distinct from 'array' then raise exception 'S4_ALLOCATIONS_REQUIRED'; end if;
  numerator:=0; denominator:=1;
  for a in select value from jsonb_array_elements(j->'allocations') loop
   select m.*,i.tracking_strategy,i.active,i.base_uom_code current_uom,u.allowed_scale,c.unit current_demand_unit,c.is_active demand_active into mp
   from public.equipment_inventory_mappings m join public.inventory_catalog_items i on i.id=m.inventory_item_id join public.inventory_uoms u on u.code=i.base_uom_code join public.equipment_catalog c on c.id=m.catalog_item_id
   where m.id=(a->>'mapping_id')::uuid and m.catalog_item_id=ln.catalog_item_id;
   if not found or not mp.active or not mp.demand_active or mp.base_uom_code<>mp.current_uom or mp.demand_unit<>mp.current_demand_unit then raise exception 'S4_MAPPING_REQUIRED'; end if;
   if not exists(select 1 from public.inventory_storage_locations l where l.id=(a->>'location_id')::uuid and l.active) then raise exception 'S4_INVALID_SOURCE'; end if;
   q:=private.s4_quantity(a->>'base_quantity');
   if q<=0 or q<>round(q,mp.allowed_scale) then raise exception 'S4_INVALID_BASE_QUANTITY'; end if;
   -- Sum exact rational request-unit equivalents; numeric division would make
   -- three 1/3 allocations falsely fail the integer target of one.
   factor:=mp.base_units_per_requested_unit*1000000;
   numerator:=numerator*factor+(q*1000000)*denominator;
   denominator:=denominator*factor;
   divisor:=gcd(numerator,denominator);
   numerator:=div(numerator,divisor); denominator:=div(denominator,divisor);
   insert into public.equipment_preparation_allocations(plan_id,request_line_id,mapping_id,location_id,base_quantity) values(plan_id,ln.id,mp.id,(a->>'location_id')::uuid,q) returning id into allocation_id;
   if mp.tracking_strategy='serialized' then
    if jsonb_typeof(a->'asset_ids') is distinct from 'array' or jsonb_array_length(a->'asset_ids')<>q then raise exception 'S4_EXACT_ASSETS_REQUIRED'; end if;
    for ar in select value from jsonb_array_elements(a->'asset_ids') loop
     select * into asset from public.equipment_assets where id=(ar#>>'{}')::uuid for update;
     if not found or asset.catalog_item_id<>mp.inventory_item_id or not private.s4_asset_eligible(asset.id,(a->>'location_id')::uuid) then raise exception 'S4_ASSET_INELIGIBLE'; end if;
     insert into public.inventory_reservations(preparation_id,allocation_id,asset_id,location_id,quantity) values(p.id,allocation_id,asset.id,asset.location_id,1);
    end loop;
   else
    if coalesce(jsonb_array_length(a->'asset_ids'),0)<>0 then raise exception 'S4_QUANTITY_ASSET_MISMATCH'; end if;
    needed:=q;
    for pool in select c.origin_id,f.expiry_date from public.inventory_receipt_cohorts c join public.inventory_stock_origins o on o.id=c.origin_id join public.inventory_stock_facts f on f.id=c.current_fact_id where o.catalog_item_id=mp.inventory_item_id order by f.expiry_date nulls last,o.created_at,c.origin_id loop
     available:=private.s4_pool_backing(pool.origin_id,(a->>'location_id')::uuid)-coalesce((select sum(rs.quantity) from public.inventory_reservations rs where rs.cohort_id=pool.origin_id and rs.location_id=(a->>'location_id')::uuid and rs.released_at is null),0);
     if available<=0 then continue; end if;
     take:=least(available,needed);
     insert into public.inventory_reservations(preparation_id,allocation_id,cohort_id,location_id,quantity) values(p.id,allocation_id,pool.origin_id,(a->>'location_id')::uuid,take);
     needed:=needed-take;
     exit when needed=0;
    end loop;
    if needed<>0 then raise exception 'S4_INSUFFICIENT_AVAILABLE'; end if;
   end if;
  end loop;
  if numerator<>planned*denominator then raise exception 'S4_ALLOCATION_TOTAL_MISMATCH'; end if;
  update public.equipment_request_items set planned_quantity=planned::integer where id=ln.id;
  total:=total+planned;
 end loop;
 if exists(select 1 from public.equipment_request_items l where l.request_id=r.id and l.removed_at is null and not(l.id=any(seen))) then raise exception 'S4_ALL_LINES_REVIEW_REQUIRED'; end if;
 if total<=0 then raise exception 'S4_ALL_ZERO_FORBIDDEN'; end if;
 update public.equipment_preparations set state='prepared',draft=p_plan,source_revision=r.preparation_revision,revision=revision+1,primary_preparer=coalesce(primary_preparer,auth.uid()),confirmed_at=coalesce(confirmed_at,clock_timestamp()),lock_holder=null,lock_token=null,lock_expires_at=null where id=p.id;
 return plan_id;
end; $$;
revoke all on function private.s4_commit_plan(uuid,jsonb,text) from public,anon,authenticated;

-- A deficient pool marks all affected owners for reconciliation; it never chooses
-- a victim or silently transfers their commitment to another request.
create or replace function private.s4_health(p_preparation uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x order by x.reservation_id),'[]'::jsonb) from (
  select rs.id reservation_id,rs.allocation_id,rs.cohort_id,rs.asset_id,rs.location_id,rs.quantity::text committed,
   case when rs.asset_id is not null then case when private.s4_asset_eligible(rs.asset_id,rs.location_id) then '0' else '1' end
   else greatest(0,coalesce((select sum(other.quantity) from public.inventory_reservations other where other.cohort_id=rs.cohort_id and other.location_id=rs.location_id and other.released_at is null),0)-private.s4_pool_backing(rs.cohort_id,rs.location_id))::text end pool_shortfall
  from public.inventory_reservations rs where rs.preparation_id=p_preparation and rs.released_at is null
 ) x where x.pool_shortfall::numeric>0;
$$;
create or replace function private.s4_refresh_health()
returns void language plpgsql security definer set search_path='' as $$
declare p record; h jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 for p in select * from public.equipment_preparations where state in ('prepared','reversing') order by request_id loop
  h:=private.s4_health(p.id);
  if h is distinct from p.health then
   update public.equipment_preparations set health=h where id=p.id;
   insert into public.equipment_preparation_events(request_id,preparation_id,operation,actor_id,revision,payload) values(p.request_id,p.id,'health_changed',auth.uid(),p.revision,jsonb_build_object('before',p.health,'after',h));
   if h<>'[]'::jsonb then
    perform private.notify_equipment_request_recipients(p.request_id,'preparation_shortfall','Phiếu thiết bị cần phân bổ lại','Cam kết được giữ nguyên; nguồn đủ điều kiện đã thiếu. Vui lòng kiểm tra chi tiết chuẩn bị.',true,true,auth.uid(),jsonb_build_object('preparation_id',p.id,'health',h));
   end if;
  end if;
 end loop;
end; $$;
revoke all on function private.s4_health(uuid),private.s4_refresh_health() from public,anon,authenticated;
-- Expiry transitions need no user mutation; this does NOT release reservations.
select cron.schedule('medlabs-s4-expiry-health','* * * * *','select private.s4_refresh_health();');

create or replace function private.s4_available(p_cohort uuid,p_location uuid)
returns numeric language sql stable security definer set search_path='' as $$
 select greatest(0,private.s4_pool_backing(p_cohort,p_location)-coalesce((select sum(quantity) from public.inventory_reservations where cohort_id=p_cohort and location_id=p_location and released_at is null),0));
$$;
revoke all on function private.s4_available(uuid,uuid) from public,anon,authenticated;


create or replace function public.equipment_preparation_command(p_operation text,p_request_id uuid,p_payload jsonb,p_retry_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; p public.equipment_preparations; adj public.equipment_quantity_adjustments;
 actor uuid:=auth.uid(); manager boolean; result jsonb; old_result jsonb; payload_hash text; old_hash text;
 j jsonb; line public.equipment_request_items; target numeric; plan_id uuid; mapping_id uuid; item record; token uuid;
 normalized_targets jsonb:='[]'::jsonb; new_line_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 if actor is null or not private.is_active_user() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into r from public.equipment_requests where id=p_request_id for update;
 if not found or r.request_domain<>'nursing_skills' or not private.can_read_preparation(r.id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 manager:=private.can_access_inventory() and private.can_manage_equipment_request(r.id);
 if p_operation not in ('propose_adjustment') and not manager then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_operation='propose_adjustment' and actor not in (r.registrant_id,r.responsible_lecturer_id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_operation in ('override_lock') and not private.is_inventory_admin() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_retry_key is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'INVALID_PAYLOAD'; end if;
 payload_hash:=encode(extensions.digest(convert_to(jsonb_build_object('request',r.id,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');
 select rr.payload_hash,rr.result_ids into old_hash,old_result from public.inventory_operation_replays rr where rr.actor_id=actor and rr.operation='s4:'||p_operation and rr.retry_key=p_retry_key;
 if found then
  if old_hash<>payload_hash then raise exception 'RETRY_PAYLOAD_MISMATCH' using errcode='23505'; end if;
  return old_result;
 end if;
 if r.status not in ('new','preparing') then raise exception 'S4_INVALID_REQUEST_STATE'; end if;
 if p_operation not in ('heartbeat','release_lock') and (p_payload->>'expected_revision')::bigint is distinct from r.preparation_revision then raise exception 'STALE_REVISION' using errcode='23505'; end if;
 select * into p from public.equipment_preparations where request_id=r.id and state in ('draft','prepared','reversing') for update;
 perform set_config('app.s4_command','true',true);
 perform set_config('app.s4_registration','',true);
 if p_operation='start' then
  if r.status<>'new' then raise exception 'S4_NEW_REQUIRED'; end if;
  token:=(p_payload->>'lock_token')::uuid;
  if token is null then raise exception 'S4_TAB_TOKEN_REQUIRED'; end if;
  if p.id is null then
   insert into public.equipment_preparations(request_id,source_revision,previous_preparer) values(r.id,r.preparation_revision,(select primary_preparer from public.equipment_preparations where request_id=r.id order by created_at desc limit 1)) returning * into p;
  end if;
  if p.state<>'draft' then raise exception 'S4_INVALID_STATE'; end if;
  if p.lock_expires_at>clock_timestamp() and (p.lock_holder<>actor or p.lock_token<>token) then raise exception 'S4_LOCK_HELD'; end if;
  update public.equipment_preparations set lock_holder=actor,lock_token=token,lock_expires_at=clock_timestamp()+private.s4_lock_inactivity() where id=p.id;
 elsif p_operation in ('save','heartbeat','release_lock','confirm') then
  if p.id is null or p.state<>'draft' or p.lock_holder is distinct from actor or p.lock_token is distinct from (p_payload->>'lock_token')::uuid or p.lock_expires_at<=clock_timestamp() then raise exception 'S4_LOCK_REQUIRED'; end if;
  if p_operation='save' then
   if (p_payload->>'draft_revision')::bigint is distinct from p.revision then raise exception 'STALE_REVISION' using errcode='23505'; end if;
   perform private.s4_validate_draft(p_payload->'plan');
   update public.equipment_preparations set draft=p_payload->'plan',revision=revision+1,source_revision=r.preparation_revision,lock_expires_at=clock_timestamp()+private.s4_lock_inactivity() where id=p.id;
  elsif p_operation='heartbeat' then
   update public.equipment_preparations set lock_expires_at=clock_timestamp()+private.s4_lock_inactivity() where id=p.id;
  elsif p_operation='release_lock' then
   update public.equipment_preparations set lock_holder=null,lock_token=null,lock_expires_at=null where id=p.id;
  else
   if (p_payload->>'draft_revision')::bigint is distinct from p.revision or p.source_revision<>r.preparation_revision then raise exception 'STALE_REVISION' using errcode='23505'; end if;
   plan_id:=private.s4_commit_plan(p.id,p_payload->'plan','Confirmed preparation');
   perform set_config('app.equipment_confirmation_rpc','true',true);
   update public.equipment_requests set status='preparing',preparation_revision=preparation_revision+1 where id=r.id;
   perform private.enqueue_equipment_request_outbox_event(r.id,'updated',p_retry_key,actor);
  end if;
 elsif p_operation='override_lock' then
  if p.id is null or p.state<>'draft' or nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'S4_REASON_REQUIRED'; end if;
  token:=nullif(p_payload->>'lock_token','')::uuid;
  if token is null then
   update public.equipment_preparations set lock_holder=null,lock_token=null,lock_expires_at=null,revision=revision+1 where id=p.id;
  else
   if not exists(select 1 from public.profiles pr where pr.id=(p_payload->>'holder_id')::uuid and pr.is_active) or not exists(select 1 from public.user_roles ur where ur.user_id=(p_payload->>'holder_id')::uuid and (ur.role='admin' or (ur.role='staff' and exists(select 1 from public.profile_room_types s join public.class_schedules cs on cs.id=r.class_schedule_id join public.rooms rm on rm.id=cs.room_id where s.profile_id=ur.user_id and s.room_type_id=rm.room_type_id)))) then raise exception 'AUTH_DENIED'; end if;
   update public.equipment_preparations set lock_holder=(p_payload->>'holder_id')::uuid,lock_token=token,lock_expires_at=clock_timestamp()+private.s4_lock_inactivity(),revision=revision+1 where id=p.id;
  end if;
 elsif p_operation='map_item' then
  if nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'S4_REASON_REQUIRED'; end if;
  select i.*,c.unit demand_unit into item from public.inventory_catalog_items i cross join public.equipment_catalog c where i.id=(p_payload->>'inventory_item_id')::uuid and c.id=(p_payload->>'catalog_item_id')::uuid and i.active and c.is_active;
  if not found then raise exception 'S4_MAPPING_REQUIRED'; end if;
  target:=private.s4_quantity(p_payload->>'base_units_per_requested_unit');
  if target<=0 then raise exception 'S4_INVALID_BASE_QUANTITY'; end if;
  insert into public.equipment_inventory_mappings(catalog_item_id,inventory_item_id,base_units_per_requested_unit,demand_unit,base_uom_code,reason,created_by) values((p_payload->>'catalog_item_id')::uuid,item.id,target,item.demand_unit,item.base_uom_code,p_payload->>'reason',actor) returning id into mapping_id;
 elsif p_operation='add_line' then
  if p.id is null or p.state<>'draft' or p.lock_holder is distinct from actor
     or p.lock_token is distinct from (p_payload->>'lock_token')::uuid
     or p.lock_expires_at<=clock_timestamp() then raise exception 'S4_LOCK_REQUIRED'; end if;
  if nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'S4_REASON_REQUIRED'; end if;
  target:=private.s4_quantity(p_payload->>'quantity');
  if target<1 or target<>trunc(target) or target>2147483647 then raise exception 'S4_DEMAND_UNIT_INTEGER_REQUIRED'; end if;
  new_line_id:=gen_random_uuid();
  perform private.s4_add_line(r.id,new_line_id,(p_payload->>'catalog_item_id')::uuid,p_payload->>'skill_name',target::integer,p_payload->>'note');
  select * into r from public.equipment_requests where id=r.id;
  update public.equipment_preparations set
   draft=jsonb_set(draft,'{lines}',coalesce(draft->'lines','[]'::jsonb)||jsonb_build_array(jsonb_build_object('line_id',new_line_id,'planned_quantity',target::text,'reviewed_revision',null,'shortage_reason','','allocations','[]'::jsonb))),
   revision=revision+1,source_revision=r.preparation_revision where id=p.id;
 elsif p_operation='propose_adjustment' then
  if nullif(btrim(p_payload->>'reason'),'') is null or jsonb_typeof(p_payload->'targets') is distinct from 'array' or jsonb_array_length(p_payload->'targets') not between 1 and 500 then raise exception 'S4_ADJUSTMENT_REASON_TARGETS_REQUIRED'; end if;
  for j in select value from jsonb_array_elements(p_payload->'targets') loop
   if nullif(j->>'line_id','') is null then raise exception 'S4_INVALID_LINE_ID'; end if;
   target:=private.s4_quantity(j->>'quantity');
   if target<>trunc(target) or target>2147483647 then raise exception 'S4_DEMAND_UNIT_INTEGER_REQUIRED'; end if;
   select * into line from public.equipment_request_items where id=(j->>'line_id')::uuid and request_id=r.id and removed_at is null;
   if found then
    normalized_targets:=normalized_targets||jsonb_build_array(jsonb_build_object('line_id',line.id,'quantity',target::text));
   else
    select * into item from public.equipment_catalog where id=(j->>'catalog_item_id')::uuid and is_active;
    if not found or target<1 or exists(select 1 from public.equipment_request_items where id=(j->>'line_id')::uuid)
       or not exists(select 1 from public.equipment_request_items where request_id=r.id and removed_at is null and skill_name=j->>'skill_name') then raise exception 'S4_INVALID_ADDED_LINE'; end if;
    normalized_targets:=normalized_targets||jsonb_build_array(jsonb_build_object('line_id',(j->>'line_id')::uuid,'quantity',target::text,'catalog_item_id',item.id,'skill_name',j->>'skill_name','note',coalesce(j->>'note',''),'commercial_name',item.commercial_name,'item_name',item.item_name,'unit',item.unit));
   end if;
  end loop;
  if (select count(*)<>count(distinct value->>'line_id') from jsonb_array_elements(p_payload->'targets')) then raise exception 'S4_DUPLICATE_LINE'; end if;
  insert into public.equipment_quantity_adjustments(request_id,submitted_revision,targets,reason,submitted_by) values(r.id,r.preparation_revision,normalized_targets,p_payload->>'reason',actor) returning * into adj;
 elsif p_operation in ('approve_adjustment','reject_adjustment') then
  select * into adj from public.equipment_quantity_adjustments where id=(p_payload->>'adjustment_id')::uuid and request_id=r.id and status='pending' for update;
  if not found then raise exception 'S4_PENDING_ADJUSTMENT_REQUIRED'; end if;
  if p_operation='approve_adjustment' then
   -- Explicit current-revision review is required even if submission is older.
   if (p_payload->>'reviewed_revision')::bigint is distinct from r.preparation_revision then raise exception 'STALE_REVISION' using errcode='23505'; end if;
   for j in select value from jsonb_array_elements(adj.targets) loop
    if not exists(select 1 from jsonb_array_elements(p_payload->'plan'->'lines') pl where pl->>'line_id'=j->>'line_id' and private.s4_quantity(pl->>'planned_quantity')=private.s4_quantity(j->>'quantity')) then raise exception 'S4_ABSOLUTE_TARGET_REQUIRED'; end if;
    if j ? 'catalog_item_id' then
     perform private.s4_add_line(r.id,(j->>'line_id')::uuid,(j->>'catalog_item_id')::uuid,j->>'skill_name',private.s4_quantity(j->>'quantity')::integer,j->>'note');
    end if;
    if r.status='new' then
     update public.equipment_request_items set planned_quantity=private.s4_quantity(j->>'quantity')::integer where id=(j->>'line_id')::uuid and request_id=r.id;
    end if;
   end loop;
   select * into r from public.equipment_requests where id=r.id;
   if p.state='reversing' then raise exception 'S4_REVERSAL_IN_PROGRESS'; end if;
   if r.status='preparing' then
    if exists(select 1 from jsonb_array_elements(p_payload->'plan'->'lines') pl
      join public.equipment_request_items l on l.id=(pl->>'line_id')::uuid and l.request_id=r.id
      where not exists(select 1 from jsonb_array_elements(adj.targets) t where t->>'line_id'=pl->>'line_id')
        and private.s4_quantity(pl->>'planned_quantity')<>l.planned_quantity) then raise exception 'S4_REALLOCATION_CANNOT_CHANGE_PLAN'; end if;
    plan_id:=private.s4_commit_plan(p.id,p_payload->'plan',adj.reason);
   else
    if p.id is null then insert into public.equipment_preparations(request_id,source_revision) values(r.id,r.preparation_revision) returning * into p; end if;
    -- Approval publishes only approved targets. Preserve the holder's unrelated
    -- warehouse progress, and force affected lines to be reviewed again.
    update public.equipment_preparations ep set draft=jsonb_build_object('lines',(
      select jsonb_agg(coalesce(saved.value,jsonb_build_object('line_id',l.id,'planned_quantity',l.planned_quantity::text,'reviewed_revision',null,'shortage_reason','','allocations','[]'::jsonb))
        ||case when target.value is not null then jsonb_build_object('planned_quantity',target.value->>'quantity','reviewed_revision',null) else '{}'::jsonb end order by l.created_at,l.id)
      from public.equipment_request_items l
      left join lateral (select value from jsonb_array_elements(ep.draft->'lines') where value->>'line_id'=l.id::text limit 1) saved on true
      left join lateral (select value from jsonb_array_elements(adj.targets) where value->>'line_id'=l.id::text limit 1) target on true
      where l.request_id=r.id and l.removed_at is null
    )),revision=revision+1,source_revision=r.preparation_revision+1 where ep.id=p.id;
   end if;
   update public.equipment_requests set preparation_revision=preparation_revision+1 where id=r.id;
  end if;
  update public.equipment_quantity_adjustments set status=case when p_operation='approve_adjustment' then 'approved' else 'rejected' end,reviewed_by=actor,reviewed_at=clock_timestamp(),review_note=p_payload->>'reason' where id=adj.id;
 elsif p_operation='reallocate' then
  if p.id is null or p.state<>'prepared' or nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'S4_PREPARED_REASON_REQUIRED'; end if;
  -- Reallocation changes backing, not the absolute committed target.
  for j in select value from jsonb_array_elements(p.draft->'lines') loop
   if not exists(select 1 from jsonb_array_elements(p_payload->'plan'->'lines') pl where pl->>'line_id'=j->>'line_id' and private.s4_quantity(pl->>'planned_quantity')=private.s4_quantity(j->>'planned_quantity')) then raise exception 'S4_REALLOCATION_CANNOT_CHANGE_PLAN'; end if;
  end loop;
  plan_id:=private.s4_commit_plan(p.id,p_payload->'plan',p_payload->>'reason');
  update public.equipment_requests set preparation_revision=preparation_revision+1 where id=r.id;
 elsif p_operation='begin_reversal' then
  if p.id is null or p.state not in ('draft','prepared') or nullif(btrim(p_payload->>'reason'),'') is null then raise exception 'S4_PREPARED_REASON_REQUIRED'; end if;
  if p.state='draft' and (p.lock_holder is distinct from actor or p.lock_token is distinct from (p_payload->>'lock_token')::uuid or p.lock_expires_at<=clock_timestamp()) then raise exception 'S4_LOCK_REQUIRED'; end if;
  update public.equipment_preparations set state='reversing',revision=revision+1 where id=p.id;
  update public.equipment_requests set preparation_revision=preparation_revision+1 where id=r.id;
 elsif p_operation='finalize_reversal' then
  if p.id is null or p.state<>'reversing' then raise exception 'S4_REVERSAL_REQUIRED'; end if;
  if exists(select 1 from public.equipment_preparation_transfers t where t.preparation_id=p.id and t.compensates_id is null and t.quantity>coalesce((select sum(c.quantity) from public.equipment_preparation_transfers c where c.compensates_id=t.id),0)) then raise exception 'S4_PHYSICAL_COMPENSATION_REQUIRED'; end if;
  update public.inventory_reservations set released_at=clock_timestamp() where preparation_id=p.id and released_at is null;
  update public.equipment_preparations set state='reversed',revision=revision+1,primary_preparer=previous_preparer where id=p.id;
  perform set_config('app.equipment_confirmation_rpc','true',true);
  update public.equipment_requests set status='new',preparation_revision=preparation_revision+1 where id=r.id;
  perform private.enqueue_equipment_request_outbox_event(r.id,'updated',p_retry_key,actor);
 else raise exception 'S4_INVALID_OPERATION';
 end if;
 perform private.s4_refresh_health();
 select * into r from public.equipment_requests where id=p_request_id;
 select * into p from public.equipment_preparations where request_id=r.id order by created_at desc limit 1;
 result:=jsonb_build_object('request_id',r.id,'revision',r.preparation_revision,'adjustment_id',adj.id,'mapping_id',mapping_id,'plan_id',plan_id);
 if p_operation not in ('heartbeat','save') then
  insert into public.equipment_preparation_events(request_id,preparation_id,operation,actor_id,revision,payload) values(r.id,p.id,p_operation,actor,r.preparation_revision,
   case when p_operation='approve_adjustment' and r.status='new' then p_payload-'lock_token'-'plan' else p_payload-'lock_token' end);
 end if;
 insert into public.inventory_operation_replays(actor_id,operation,retry_key,payload_hash,result_ids) values(actor,'s4:'||p_operation,p_retry_key,payload_hash,result);
 perform set_config('app.s4_command','false',true);
 return result;
end; $$;
revoke all on function public.equipment_preparation_command(text,uuid,jsonb,uuid) from public,anon;
grant execute on function public.equipment_preparation_command(text,uuid,jsonb,uuid) to authenticated;


-- Effective content writers preserve their existing scope/timing rules.
-- Item IDs and expected_revision are now required for existing lines.
create or replace function public.update_equipment_request_content(target_request_id uuid,target_class_schedule_id uuid,target_semester text,target_responsible_lecturer_id uuid,target_receive_at timestamptz,target_return_at timestamptz,target_note text,target_late_registration_reason text,target_items jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare updated_request_id uuid; req_late_status text; actor_id uuid:=(select auth.uid()); target_sched_semester text; current_request record; effective_semester text;
begin
  perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
  if not private.is_active_user() or not exists(select 1 from public.equipment_requests r where r.id=target_request_id and (r.registrant_id=actor_id or private.can_manage_equipment_request(r.id))) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
  select req.class_schedule_id,req.semester into current_request from public.equipment_requests req where req.id=target_request_id;
  if current_request.class_schedule_id is null then raise exception 'Không tìm thấy phiếu hoặc bạn không có quyền điều chỉnh.' using errcode='42501'; end if;
  if target_class_schedule_id is distinct from current_request.class_schedule_id then raise exception 'EQUIPMENT_REQUEST_DOMAIN_OR_SOURCE_IMMUTABLE' using errcode='22023'; end if;
  select s.semester into target_sched_semester from public.class_schedules s join public.rooms r on r.id=s.room_id where s.id=target_class_schedule_id and s.schedule_status<>'cancelled' and r.room_type_id='40000000-0000-0000-0000-000000000001'::uuid and (select private.has_room_type(r.room_type_id));
  if not found then raise exception 'Lớp Skills lab không hợp lệ.' using errcode='42501'; end if;
  if target_sched_semester in ('HK1','HK2','HK3','HK4') then effective_semester:=target_sched_semester; elsif current_request.semester in ('HK1','HK2','HK3','HK4') then effective_semester:=current_request.semester; else raise exception 'Lịch học chưa có thông tin Học kỳ hợp lệ.' using errcode='22023'; end if;
  if target_items is null or jsonb_typeof(target_items)<>'array' or jsonb_array_length(target_items)=0 then raise exception 'Danh sách thiết bị không hợp lệ.' using errcode='22023'; end if;
  if exists(select 1 from jsonb_to_recordset(target_items) i(skill_name text,catalog_item_id uuid,quantity integer,note text) left join public.equipment_catalog c on c.id=i.catalog_item_id where i.skill_name is null or btrim(i.skill_name)='' or i.catalog_item_id is null or i.quantity is null or i.quantity<1 or c.id is null or not c.is_active) then raise exception 'Danh sách thiết bị có dữ liệu không hợp lệ.' using errcode='22023'; end if;
  perform private.s4_sync_lines(target_request_id,target_items);
  update public.equipment_requests set semester=effective_semester,responsible_lecturer_id=target_responsible_lecturer_id,receive_at=target_receive_at,return_at=target_return_at,note=nullif(btrim(target_note),''),late_registration_reason=nullif(btrim(target_late_registration_reason),'') where id=target_request_id and status in ('new','preparing') returning id into updated_request_id;
  if updated_request_id is null then raise exception 'Không tìm thấy phiếu hoặc bạn không có quyền điều chỉnh.' using errcode='42501'; end if;
  select late_approval_status into req_late_status from public.equipment_requests where id=target_request_id;
  perform private.enqueue_equipment_request_outbox_event(target_request_id,case when req_late_status='pending' then 'late_approval_requested' else 'updated' end,null,actor_id);
  return updated_request_id;
end; $$;

create or replace function public.update_basic_medical_equipment_request_content(target_request_id uuid,target_receive_at timestamptz,target_return_at timestamptz,target_note text,target_late_registration_reason text,target_items jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=(select auth.uid()); request_row record; source_row record; updated_request_id uuid; receive_local timestamp; return_local timestamp; req_late_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
  if actor_id is null or not (select private.is_active_user()) then raise exception 'AUTHENTICATION_REQUIRED' using errcode='42501'; end if;
  select requests.* into request_row from public.equipment_requests requests where requests.id=target_request_id and requests.request_domain='basic_medical' for update;
  if request_row.id is null then raise exception 'BASIC_MEDICAL_EQUIPMENT_EDIT_FORBIDDEN' using errcode='42501'; end if;
  if request_row.status not in ('new','preparing') then raise exception 'BASIC_MEDICAL_EQUIPMENT_EDIT_STATUS' using errcode='22023'; end if;
  if request_row.registrant_id<>actor_id and not (select private.can_manage_basic_medical()) then raise exception 'BASIC_MEDICAL_EQUIPMENT_EDIT_FORBIDDEN' using errcode='42501'; end if;
  select s.id session_id,s.class_schedule_id,s.lesson_title,s.teaching_lecturer_id,s.cancelled_at session_cancelled_at,r.cancelled_at registration_cancelled_at,r.semester registration_semester,c.schedule_date,c.schedule_status into source_row from public.basic_medical_registration_sessions s join public.basic_medical_registrations r on r.id=s.registration_id join public.class_schedules c on c.id=s.class_schedule_id where s.id=request_row.source_identity_id for update of s,c;
  if source_row.session_id is null or source_row.session_cancelled_at is not null or source_row.registration_cancelled_at is not null or source_row.schedule_status='cancelled' then raise exception 'BASIC_MEDICAL_SESSION_CANCELLED' using errcode='22023'; end if;
  if request_row.class_schedule_id is distinct from source_row.class_schedule_id then raise exception 'EQUIPMENT_REQUEST_LIVE_SOURCE_IMMUTABLE' using errcode='22023'; end if;
  if source_row.registration_semester not in ('HK1','HK2','HK3','HK4') then raise exception 'EQUIPMENT_REQUEST_SEMESTER_REQUIRED' using errcode='22023'; end if;
  if target_items is null or jsonb_typeof(target_items)<>'array' or jsonb_array_length(target_items) not between 1 and 500 then raise exception 'EQUIPMENT_REQUEST_ITEMS_REQUIRED' using errcode='22023'; end if;
  if exists(select 1 from jsonb_to_recordset(target_items) i(catalog_item_id uuid,quantity integer,note text) left join public.basic_medical_equipment_catalog c on c.id=i.catalog_item_id where i.catalog_item_id is null or i.quantity is null or i.quantity<1 or i.quantity>100000 or length(coalesce(i.note,''))>1000 or c.id is null or not c.is_active) then raise exception 'EQUIPMENT_REQUEST_BASIC_MEDICAL_CATALOG_REQUIRED' using errcode='22023'; end if;
  receive_local:=target_receive_at at time zone 'Asia/Ho_Chi_Minh'; return_local:=target_return_at at time zone 'Asia/Ho_Chi_Minh';
  if target_receive_at is null or target_return_at is null or target_return_at<target_receive_at or receive_local::date<(clock_timestamp() at time zone 'Asia/Ho_Chi_Minh')::date or receive_local::date>source_row.schedule_date or return_local::date<source_row.schedule_date or receive_local::time not in (time '09:00',time '11:00',time '14:00',time '16:00') or return_local::time not in (time '09:00',time '11:00',time '14:00',time '16:00') then raise exception 'BASIC_MEDICAL_EQUIPMENT_TIMING_INVALID' using errcode='22023'; end if;
  perform set_config('app.basic_medical_equipment_edit_rpc','true',true);
  perform private.s4_sync_lines(target_request_id,target_items,source_row.lesson_title);
  update public.equipment_requests set responsible_lecturer_id=source_row.teaching_lecturer_id,semester=source_row.registration_semester,receive_at=target_receive_at,return_at=target_return_at,note=nullif(btrim(target_note),''),late_registration_reason=nullif(btrim(target_late_registration_reason),'') where id=target_request_id and request_domain='basic_medical' and status in ('new','preparing') returning id into updated_request_id;
  if updated_request_id is null then raise exception 'BASIC_MEDICAL_EQUIPMENT_EDIT_STATUS' using errcode='22023'; end if;
  select late_approval_status into req_late_status from public.equipment_requests where id=target_request_id;
  perform private.enqueue_equipment_request_outbox_event(target_request_id,case when req_late_status='pending' then 'late_approval_requested' else 'updated' end,null,actor_id);
  return updated_request_id;
end; $$;
revoke all on function public.update_basic_medical_equipment_request_content(uuid,timestamptz,timestamptz,text,text,jsonb) from public,anon;
grant execute on function public.update_basic_medical_equipment_request_content(uuid,timestamptz,timestamptz,text,text,jsonb) to authenticated;


-- A real transfer still goes through S2/S3. This layer only correlates ownership.
create or replace function private.s4_guard_transfer_backing()
returns trigger language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=nullif(current_setting('app.s4_transfer_owner',true),'')::uuid; reserved numeric; stock numeric;
begin
 if new.quantity_delta>=0 or new.condition<>'good' or not exists(select 1 from public.inventory_transactions t where t.id=new.transaction_id and t.operation='TRANSFER') then return new; end if;
 select coalesce(sum(quantity),0) into reserved from public.inventory_reservations where cohort_id=new.cohort_id and location_id=new.location_id and released_at is null and (owner_id is null or preparation_id<>owner_id);
 select quantity into stock from public.inventory_stock_balances where cohort_id=new.cohort_id and location_id=new.location_id and condition='good';
 if coalesce(stock,0)+new.quantity_delta<reserved then raise exception 'S4_RESERVED_BACKING_PROTECTED' using errcode='23514'; end if;
 return new;
end; $$;
create trigger inventory_lines_s4_transfer_guard before insert on public.inventory_transaction_lines for each row execute function private.s4_guard_transfer_backing();
create or replace function private.s4_guard_asset_location()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.location_id<>old.location_id and exists(select 1 from public.inventory_reservations r where r.asset_id=old.id and r.released_at is null and r.preparation_id is distinct from nullif(current_setting('app.s4_transfer_owner',true),'')::uuid) then raise exception 'S4_RESERVED_ASSET_PROTECTED' using errcode='23514'; end if;
 return new;
end; $$;
create trigger equipment_assets_s4_location_guard before update on public.equipment_assets for each row execute function private.s4_guard_asset_location();

create or replace function public.equipment_preparation_transfer(p_request_id uuid,p_payload jsonb,p_retry_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
<<transfer_command>>
declare r public.equipment_requests; p public.equipment_preparations; original public.equipment_preparation_transfers;
 asset public.equipment_assets; fact record; rs record; pool record; entry jsonb; result jsonb; replay jsonb; h text; old_h text;
 source_id uuid; destination_id uuid; cohort uuid; asset_id uuid; item_id uuid; tx uuid; link_id uuid; quantity numeric; left_qty numeric; moved numeric; cond text;
 lines jsonb:='[]'; links jsonb:='[]'; available numeric; scale integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 if not private.can_access_inventory() or not private.can_manage_equipment_request(p_request_id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into r from public.equipment_requests where id=p_request_id for update;
 if not found or r.request_domain<>'nursing_skills' then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_retry_key is null or jsonb_typeof(p_payload) is distinct from 'object' or nullif(btrim(p_payload->>'reason'),'') is null or p_payload->'physical_confirmation' is distinct from 'true'::jsonb then raise exception 'S4_REAL_TRANSFER_CONFIRMATION_REQUIRED'; end if;
 h:=encode(extensions.digest(convert_to(jsonb_build_object('request',r.id,'payload',p_payload)::text,'UTF8'),'sha256'),'hex');
 select rr.payload_hash,rr.result_ids into old_h,replay from public.inventory_operation_replays rr where rr.actor_id=auth.uid() and rr.operation='s4:physical_transfer' and rr.retry_key=p_retry_key;
 if found then if h<>old_h then raise exception 'RETRY_PAYLOAD_MISMATCH'; end if; return replay; end if;
 -- The outer replay owns retries atomically. Nested physical commands must use
 -- fresh keys so unrelated historical transfers cannot become S4 evidence.
 if r.status not in ('new','preparing') then raise exception 'S4_INVALID_REQUEST_STATE'; end if;
 if (p_payload->>'expected_revision')::bigint is distinct from r.preparation_revision then raise exception 'STALE_REVISION' using errcode='23505'; end if;
 select * into p from public.equipment_preparations where request_id=r.id and state in ('draft','prepared','reversing') for update;
 if p.id is null or p.state not in ('draft','reversing') then raise exception 'S4_TRANSFER_STATE_INVALID'; end if;
 if p.state='draft' and (p.lock_holder is distinct from auth.uid() or p.lock_token is distinct from (p_payload->>'lock_token')::uuid or p.lock_token is null or p.lock_expires_at is null or p.lock_expires_at<=clock_timestamp()) then raise exception 'S4_LOCK_REQUIRED'; end if;
 source_id:=(p_payload->>'source_location_id')::uuid; destination_id:=(p_payload->>'destination_location_id')::uuid;
 cohort:=nullif(p_payload->>'cohort_id','')::uuid; asset_id:=nullif(p_payload->>'asset_id','')::uuid; item_id:=nullif(p_payload->>'inventory_item_id','')::uuid;
 quantity:=private.s4_quantity(p_payload->>'quantity'); cond:=p_payload->>'condition';
 if quantity<=0 or source_id is null or destination_id is null or source_id=destination_id then raise exception 'S4_TRANSFER_TARGET_REQUIRED'; end if;
 if p.state='reversing' then
  select * into original from public.equipment_preparation_transfers where id=(p_payload->>'compensates_id')::uuid and preparation_id=p.id and compensates_id is null for update;
  if not found or original.cohort_id is distinct from cohort or original.asset_id is distinct from asset_id or source_id is distinct from original.destination_location_id or destination_id is distinct from original.source_location_id or quantity>original.quantity-coalesce((select sum(t.quantity) from public.equipment_preparation_transfers t where t.compensates_id=original.id),0) then raise exception 'S4_COMPENSATION_PROVENANCE_REQUIRED'; end if;
 else
  if p_payload ? 'compensates_id' then raise exception 'S4_REVERSAL_REQUIRED'; end if;
  if cohort is not null or item_id is null then raise exception 'S4_ITEM_TRANSFER_REQUIRED'; end if;
  if not exists(select 1 from public.equipment_request_items l join public.equipment_inventory_mappings m on m.catalog_item_id=l.catalog_item_id where l.request_id=r.id and l.removed_at is null and m.inventory_item_id=item_id) then raise exception 'S4_MAPPING_REQUIRED'; end if;
 end if;
 perform set_config('app.s4_transfer_owner',p.id::text,true);
 perform set_config('app.s4_transfer_work','true',true);
 if asset_id is null then
  if p.state='reversing' then
   if cond is null or cond not in ('good','damaged') then raise exception 'S4_PHYSICAL_CONDITION_REQUIRED'; end if;
   select f.version,c.revision into fact from public.inventory_receipt_cohorts c join public.inventory_stock_facts f on f.id=c.current_fact_id where c.origin_id=cohort;
   if not found then raise exception 'COHORT_NOT_FOUND'; end if;
   lines:=jsonb_build_array(jsonb_build_object('origin_id',cohort,'expected_version',p_payload->>'expected_version','expected_stock_revision',p_payload->>'expected_stock_revision','condition',cond,'quantity',quantity::text));
  else
   if cond is distinct from 'good' then raise exception 'S4_PHYSICAL_CONDITION_REQUIRED'; end if;
   select u.allowed_scale into scale from public.inventory_catalog_items i join public.inventory_uoms u on u.code=i.base_uom_code where i.id=item_id and i.active and i.tracking_strategy='quantity';
   if not found or quantity<>round(quantity,scale) then raise exception 'S4_INVALID_BASE_QUANTITY'; end if;
   left_qty:=quantity;
   for pool in
    select c.origin_id,c.revision,f.version,private.s4_available(c.origin_id,source_id) available
    from public.inventory_receipt_cohorts c join public.inventory_stock_origins o on o.id=c.origin_id join public.inventory_stock_facts f on f.id=c.current_fact_id
    where o.catalog_item_id=item_id and private.s4_available(c.origin_id,source_id)>0
    order by f.expiry_date nulls last,o.created_at,c.origin_id limit 500
   loop
    available:=least(pool.available,left_qty);
    lines:=lines||jsonb_build_array(jsonb_build_object('origin_id',pool.origin_id,'expected_version',pool.version,'expected_stock_revision',pool.revision,'condition','good','quantity',available::text));
    left_qty:=left_qty-available; exit when left_qty=0;
   end loop;
   if left_qty<>0 then raise exception 'S4_INSUFFICIENT_AVAILABLE'; end if;
  end if;
  result:=public.inventory_command('transfer_stock',jsonb_build_object('source_location_id',source_id,'target_location_id',destination_id,'reason',p_payload->>'reason','lines',lines),gen_random_uuid());
 else
  select * into asset from public.equipment_assets where id=asset_id for update;
  if not found or asset.location_id is distinct from source_id or quantity<>1 then raise exception 'S4_ASSET_LOCATION_CHANGED'; end if;
  if p.state='draft' and (asset.catalog_item_id is distinct from item_id or not private.s4_asset_eligible(asset.id,source_id) or exists(select 1 from public.inventory_reservations v where v.asset_id=asset.id and v.released_at is null)) then raise exception 'S4_ASSET_INELIGIBLE'; end if;
  result:=public.equipment_asset_command('set_asset_state',jsonb_build_object('id',asset.id,'expected_revision',p_payload->>'asset_revision','location_id',destination_id,'custodian_id',asset.custodian_id,'operational_status',asset.operational_status,'reason',p_payload->>'reason','evidence_note',p_payload->>'reason'),gen_random_uuid());
  cond:='asset';
  lines:=jsonb_build_array(jsonb_build_object('quantity','1'));
 end if;
 tx:=(result->>'transaction_id')::uuid;
 for entry in select value from jsonb_array_elements(lines) loop
  insert into public.equipment_preparation_transfers(preparation_id,transaction_id,compensates_id,source_location_id,destination_location_id,cohort_id,asset_id,quantity,condition)
  values(p.id,tx,original.id,source_id,destination_id,(entry->>'origin_id')::uuid,asset_id,(entry->>'quantity')::numeric,cond) returning id into link_id;
  links:=links||jsonb_build_array(link_id);
 end loop;
 -- Keep returned backing owned until final reversal; split only the moved part.
 if p.state='reversing' then
  left_qty:=quantity;
  for rs in select * from public.inventory_reservations v where v.preparation_id=p.id and v.released_at is null and v.location_id=source_id and v.cohort_id is not distinct from cohort and v.asset_id is not distinct from transfer_command.asset_id order by v.created_at,v.id loop
   moved:=least(left_qty,rs.quantity);
   update public.inventory_reservations set released_at=clock_timestamp() where id=rs.id;
   insert into public.inventory_reservations(preparation_id,allocation_id,cohort_id,asset_id,location_id,quantity) values(p.id,rs.allocation_id,cohort,asset_id,destination_id,moved);
   if rs.quantity>moved then insert into public.inventory_reservations(preparation_id,allocation_id,cohort_id,asset_id,location_id,quantity) values(p.id,rs.allocation_id,cohort,asset_id,source_id,rs.quantity-moved); end if;
   left_qty:=left_qty-moved; exit when left_qty=0;
  end loop;
 end if;
 perform set_config('app.s4_transfer_owner','',true); perform set_config('app.s4_transfer_work','',true);
 update public.equipment_requests set preparation_revision=preparation_revision+1 where id=r.id returning preparation_revision into r.preparation_revision;
 update public.equipment_preparations set source_revision=r.preparation_revision,revision=revision+1 where id=p.id;
 insert into public.equipment_preparation_events(request_id,preparation_id,operation,actor_id,revision,payload) values(r.id,p.id,'physical_transfer',auth.uid(),r.preparation_revision,jsonb_build_object('transfer_ids',links,'transaction_id',tx,'compensates_id',original.id));
 perform private.s4_refresh_health();
 result:=jsonb_build_object('transfer_ids',links,'transaction_id',tx,'revision',r.preparation_revision);
 insert into public.inventory_operation_replays(actor_id,operation,retry_key,payload_hash,result_ids) values(auth.uid(),'s4:physical_transfer',p_retry_key,h,result);
 return result;
end; $$;
revoke all on function private.s4_guard_transfer_backing(),private.s4_guard_asset_location() from public,anon,authenticated;
revoke all on function public.equipment_preparation_transfer(uuid,jsonb,uuid) from public,anon;
grant execute on function public.equipment_preparation_transfer(uuid,jsonb,uuid) to authenticated;

-- Manager-only, request-scoped, paged selectors. No raw lot picker is exposed.
create or replace function public.equipment_preparation_transfer_read(p_request_id uuid,p_resource text,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.equipment_preparations; rows jsonb; page integer:=greatest(1,least(100000,coalesce((p_filters->>'page')::integer,1)));
begin
 if not private.can_access_inventory() or not private.can_manage_equipment_request(p_request_id) or not exists(select 1 from public.equipment_requests where id=p_request_id and request_domain='nursing_skills') then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into p from public.equipment_preparations where request_id=p_request_id order by created_at desc limit 1;
 if p_resource='sources' then
  select coalesce(jsonb_agg(x),'[]') into rows from (
   select i.id inventory_item_id,i.name item_name,i.code item_code,i.base_uom_code,i.tracking_strategy,l.id location_id,l.name location_name,
    case when i.tracking_strategy='quantity' then coalesce((select sum(private.s4_available(c.origin_id,l.id)) from public.inventory_receipt_cohorts c join public.inventory_stock_origins o on o.id=c.origin_id where o.catalog_item_id=i.id),0)::text else null end available_quantity
   from public.inventory_catalog_items i cross join public.inventory_storage_locations l
   where i.active and l.active and exists(select 1 from public.equipment_request_items q join public.equipment_inventory_mappings m on m.catalog_item_id=q.catalog_item_id where q.request_id=p_request_id and q.removed_at is null and m.inventory_item_id=i.id)
   order by i.name,i.id,l.name,l.id limit 100 offset (page-1)*100
  ) x;
 elsif p_resource='locations' then
  select coalesce(jsonb_agg(x),'[]') into rows from (select id,name from public.inventory_storage_locations where active order by name,id limit 100 offset (page-1)*100) x;
 elsif p_resource='assets' then
  if not exists(select 1 from public.equipment_request_items q join public.equipment_inventory_mappings m on m.catalog_item_id=q.catalog_item_id where q.request_id=p_request_id and q.removed_at is null and m.inventory_item_id=(p_filters->>'inventory_item_id')::uuid) then raise exception 'S4_MAPPING_REQUIRED'; end if;
  select coalesce(jsonb_agg(x),'[]') into rows from (
   select a.id,a.asset_code,a.manufacturer_serial,a.revision
   from public.equipment_assets a where a.catalog_item_id=(p_filters->>'inventory_item_id')::uuid and a.location_id=(p_filters->>'location_id')::uuid
   and (nullif(btrim(p_filters->>'asset_code'),'') is null or a.asset_code=btrim(p_filters->>'asset_code'))
   and private.s4_asset_eligible(a.id,a.location_id) and not exists(select 1 from public.inventory_reservations v where v.asset_id=a.id and v.released_at is null)
   order by a.asset_code,a.id limit 100 offset (page-1)*100
  ) x;
 elsif p_resource='debts' then
  select coalesce(jsonb_agg(x),'[]') into rows from (
   select t.id,t.cohort_id,t.asset_id,t.destination_location_id source_location_id,t.source_location_id destination_location_id,
    src.name source_name,dst.name destination_name,i.name item_name,i.base_uom_code,a.asset_code,
    (t.quantity-coalesce((select sum(c.quantity) from public.equipment_preparation_transfers c where c.compensates_id=t.id),0))::text outstanding_quantity,
    f.version expected_version,rc.revision expected_stock_revision,a.revision asset_revision,a.operational_status,
    coalesce((select b.quantity from public.inventory_stock_balances b where b.cohort_id=t.cohort_id and b.location_id=t.destination_location_id and b.condition='good'),0)::text good_quantity,
    coalesce((select b.quantity from public.inventory_stock_balances b where b.cohort_id=t.cohort_id and b.location_id=t.destination_location_id and b.condition='damaged'),0)::text damaged_quantity,
    a.location_id asset_location_id
   from public.equipment_preparation_transfers t
   join public.inventory_storage_locations src on src.id=t.destination_location_id join public.inventory_storage_locations dst on dst.id=t.source_location_id
   left join public.inventory_stock_origins o on o.id=t.cohort_id left join public.inventory_receipt_cohorts rc on rc.origin_id=t.cohort_id left join public.inventory_stock_facts f on f.id=rc.current_fact_id
   left join public.equipment_assets a on a.id=t.asset_id join public.inventory_catalog_items i on i.id=coalesce(o.catalog_item_id,a.catalog_item_id)
   where t.preparation_id=p.id and t.compensates_id is null and t.quantity>coalesce((select sum(c.quantity) from public.equipment_preparation_transfers c where c.compensates_id=t.id),0)
   order by t.created_at,t.id limit 100 offset (page-1)*100
  ) x;
 else raise exception 'S4_INVALID_RESOURCE';
 end if;
 return jsonb_build_object('rows',rows,'page',page);
end; $$;
revoke all on function public.equipment_preparation_transfer_read(uuid,text,jsonb) from public,anon;
grant execute on function public.equipment_preparation_transfer_read(uuid,text,jsonb) to authenticated;


-- Preserve current read scope while hiding removed rows from legacy active editors.
drop policy if exists equipment_items_manage on public.equipment_request_items;
drop policy if exists equipment_items_select on public.equipment_request_items;
create policy equipment_items_select on public.equipment_request_items for select to authenticated using(removed_at is null and private.can_read_preparation(request_id));
revoke insert,update,delete on public.equipment_request_items from authenticated;
revoke insert,update,delete on public.equipment_requests from authenticated;

create or replace function private.s4_guard_request_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.equipment_preparations;
begin
 if tg_op='DELETE' then
  if exists(select 1 from public.equipment_preparations where request_id=old.id) then raise exception 'S4_REQUEST_HISTORY_IMMUTABLE' using errcode='42501'; end if;
  return old;
 end if;
 if row(new.class_schedule_id,new.receive_at,new.return_at,new.responsible_lecturer_id,new.note) is distinct from row(old.class_schedule_id,old.receive_at,old.return_at,old.responsible_lecturer_id,old.note) then
  new.preparation_revision:=old.preparation_revision+1;
 end if;
 if old.request_domain<>'nursing_skills' then return new; end if;
 select * into p from public.equipment_preparations where request_id=old.id and state in ('draft','prepared','reversing');
 if new.status is distinct from old.status then
  if new.status='preparing' and (coalesce(current_setting('app.s4_command',true),'')<>'true' or not exists(select 1 from public.equipment_preparations where request_id=old.id and state='prepared')) then raise exception 'S4_CONFIRM_PREPARATION_REQUIRED'; end if;
  if new.status in ('handed_over','returned','completed') and exists(select 1 from public.equipment_preparations where request_id=old.id) then raise exception 'S5_NOT_AUTHORIZED'; end if;
  if new.status in ('new','cancelled') and p.id is not null then
   if p.state in ('prepared','reversing') or exists(select 1 from public.equipment_preparation_transfers t where t.preparation_id=p.id and t.compensates_id is null and t.quantity>coalesce((select sum(c.quantity) from public.equipment_preparation_transfers c where c.compensates_id=t.id),0)) then raise exception 'S4_STRICT_REVERSAL_REQUIRED'; end if;
   if new.status='cancelled' then update public.equipment_preparations set state='cancelled',lock_holder=null,lock_token=null,lock_expires_at=null where id=p.id; end if;
  end if;
 end if;
 return new;
end; $$;
drop trigger if exists equipment_requests_s4_lifecycle on public.equipment_requests;
create trigger equipment_requests_s4_lifecycle before update or delete on public.equipment_requests for each row execute function private.s4_guard_request_lifecycle();
revoke all on function private.s4_guard_request_lifecycle() from public,anon,authenticated;
create or replace function private.s4_guard_class_schedule_source()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.course_code_snapshot,new.course_name_snapshot,new.room_id,new.schedule_date,new.start_time,new.end_time,new.semester)
    is distinct from (old.course_code_snapshot,old.course_name_snapshot,old.room_id,old.schedule_date,old.start_time,old.end_time,old.semester)
    and (select private.class_schedule_has_equipment_request(old.id)) then
  raise exception 'CLASS_EQUIPMENT_REQUEST_EXISTS' using errcode='42501';
 end if;
 return new;
end; $$;
drop trigger if exists class_schedules_s4_equipment_lock on public.class_schedules;
create trigger class_schedules_s4_equipment_lock before update on public.class_schedules for each row execute function private.s4_guard_class_schedule_source();
revoke all on function private.s4_guard_class_schedule_source() from public,anon,authenticated;

create or replace function public.remove_equipment_request_item(target_item_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; ln public.equipment_request_items;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 if not private.is_active_user() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into ln from public.equipment_request_items where id=target_item_id and removed_at is null;
 select * into r from public.equipment_requests where id=ln.request_id for update;
 if not found or not(r.registrant_id=auth.uid() or private.can_manage_equipment_request(r.id)) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if r.status<>'new' and r.request_domain='nursing_skills' then raise exception 'S4_USE_QUANTITY_ADJUSTMENT'; end if;
 if r.status not in ('new','preparing') then raise exception 'EQUIPMENT_REQUEST_NOT_EDITABLE'; end if;
 update public.equipment_request_items set removed_at=clock_timestamp() where id=ln.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'equipment_request.item_removed','equipment_request',r.id,jsonb_build_object('item_id',ln.id));
 return true;
end; $$;
revoke all on function public.remove_equipment_request_item(uuid) from public,anon;
grant execute on function public.remove_equipment_request_item(uuid) to authenticated;

create or replace function public.add_equipment_request_item(target_request_id uuid,target_skill_name text,target_catalog_item_id uuid,target_quantity integer,target_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; item_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 if not private.is_active_user() or not private.can_manage_equipment_request(target_request_id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into r from public.equipment_requests where id=target_request_id for update;
 if r.status<>'new' or r.request_domain<>'nursing_skills' then raise exception 'S4_USE_QUANTITY_ADJUSTMENT'; end if;
 if target_quantity is null or target_quantity not between 1 and 9999 or nullif(btrim(target_skill_name),'') is null then raise exception 'INVALID_QUANTITY'; end if;
 if not exists(select 1 from public.equipment_catalog where id=target_catalog_item_id and is_active) then raise exception 'CATALOG_ITEM_INACTIVE_OR_MISSING'; end if;
 if not exists(select 1 from public.equipment_request_items where request_id=r.id and skill_name=btrim(target_skill_name) and removed_at is null) then raise exception 'SKILL_NOT_FOUND_IN_REQUEST'; end if;
 perform set_config('app.s4_registration','',true);
 insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,quantity,note) values(r.id,btrim(target_skill_name),target_catalog_item_id,target_quantity,nullif(btrim(target_note),'')) returning id into item_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'equipment_request.item_added','equipment_request',r.id,jsonb_build_object('item_id',item_id,'quantity',target_quantity));
 return item_id;
end; $$;
revoke all on function public.add_equipment_request_item(uuid,text,uuid,integer,text) from public,anon;
grant execute on function public.add_equipment_request_item(uuid,text,uuid,integer,text) to authenticated;

create or replace function private.guard_equipment_request_item_commercial_name()
returns trigger language plpgsql security definer set search_path='' as $$
declare domain public.equipment_request_domain; commercial text;
begin
 if new.removed_at is not null then return new; end if;
 select request_domain into domain from public.equipment_requests where id=new.request_id for update;
 if domain='nursing_skills' then select lower(btrim(commercial_name)) into commercial from public.equipment_catalog where id=new.catalog_item_id;
 else select lower(btrim(commercial_name)) into commercial from public.basic_medical_equipment_catalog where id=new.basic_medical_catalog_item_id; end if;
 if commercial is null or commercial='' then return new; end if;
 if exists(select 1 from public.equipment_request_items e left join public.equipment_catalog c on c.id=e.catalog_item_id left join public.basic_medical_equipment_catalog b on b.id=e.basic_medical_catalog_item_id where e.request_id=new.request_id and e.removed_at is null and e.id<>new.id and lower(btrim(e.skill_name))=lower(btrim(new.skill_name)) and lower(btrim(case when domain='nursing_skills' then c.commercial_name else b.commercial_name end))=commercial) then raise exception 'EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY' using errcode='22023'; end if;
 return new;
end; $$;
revoke all on function private.guard_equipment_request_item_commercial_name() from public,anon,authenticated;


create or replace function public.equipment_preparation_read(p_request_id uuid,p_resource text default 'workspace',p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.equipment_requests; p public.equipment_preparations; manager boolean; rows jsonb; total bigint; page integer:=greatest(1,coalesce((p_filters->>'page')::integer,1));
begin
 if not private.can_read_preparation(p_request_id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into r from public.equipment_requests where id=p_request_id;
 if r.request_domain<>'nursing_skills' then raise exception 'S4_DOMAIN_NOT_ENABLED'; end if;
 manager:=private.can_access_inventory() and private.can_manage_equipment_request(r.id);
 select * into p from public.equipment_preparations where request_id=r.id order by created_at desc limit 1;
 if p_resource='catalog' then
  select count(*) into total from public.equipment_catalog c where c.is_active
    and (coalesce(p_filters->>'search','')='' or c.commercial_name ilike '%'||(p_filters->>'search')||'%' or c.item_name ilike '%'||(p_filters->>'search')||'%');
  select coalesce(jsonb_agg(x),'[]'::jsonb) into rows from (
    select c.id,c.commercial_name,c.item_name,c.unit from public.equipment_catalog c where c.is_active
      and (coalesce(p_filters->>'search','')='' or c.commercial_name ilike '%'||(p_filters->>'search')||'%' or c.item_name ilike '%'||(p_filters->>'search')||'%')
    order by c.commercial_name,c.id limit 100 offset (page-1)*100
  ) x;
  return jsonb_build_object('rows',rows,'total',total,'page',page);
 end if;
 if p_resource='history' then
  select count(*) into total from public.equipment_preparation_events where request_id=r.id;
  select coalesce(jsonb_agg(x),'[]') into rows from (select e.id,e.operation,e.revision,e.created_at,e.payload,pr.full_name actor_name from public.equipment_preparation_events e left join public.profiles pr on pr.id=e.actor_id where e.request_id=r.id order by e.created_at desc,e.id desc limit 30 offset (page-1)*30) x;
  return jsonb_build_object('rows',rows,'total',total,'page',page);
 elsif p_resource='stock' then
  if not manager then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(x),'[]') into rows from (
   select m.id mapping_id,m.catalog_item_id,m.inventory_item_id,m.base_units_per_requested_unit::text conversion_factor,m.base_uom_code,i.name item_name,i.code item_code,i.tracking_strategy,l.id location_id,l.name location_name,
    coalesce((select sum(private.s4_available(c.origin_id,l.id)) from public.inventory_receipt_cohorts c join public.inventory_stock_origins o on o.id=c.origin_id where o.catalog_item_id=i.id),0)::text available_quantity
   from public.equipment_inventory_mappings m join public.inventory_catalog_items i on i.id=m.inventory_item_id cross join public.inventory_storage_locations l
   where m.catalog_item_id=(p_filters->>'catalog_item_id')::uuid and i.active and l.active order by i.name,l.name,m.id limit 100 offset (page-1)*100
  ) x;
  return jsonb_build_object('rows',rows,'page',page);
 elsif p_resource='assets' then
  if not manager then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
  select count(*) into total from public.equipment_assets a where a.catalog_item_id=(p_filters->>'inventory_item_id')::uuid and a.location_id=(p_filters->>'location_id')::uuid and (nullif(p_filters->>'asset_code','') is null or a.asset_code=p_filters->>'asset_code');
  select coalesce(jsonb_agg(x),'[]') into rows from (select a.id,a.asset_code,a.manufacturer_serial,a.revision,private.s4_asset_eligible(a.id,a.location_id) eligible,not exists(select 1 from public.inventory_reservations rs where rs.asset_id=a.id and rs.released_at is null and rs.preparation_id is distinct from p.id) unreserved from public.equipment_assets a where a.catalog_item_id=(p_filters->>'inventory_item_id')::uuid and a.location_id=(p_filters->>'location_id')::uuid and (nullif(p_filters->>'asset_code','') is null or a.asset_code=p_filters->>'asset_code') order by a.asset_code limit 100 offset (page-1)*100) x;
  return jsonb_build_object('rows',rows,'total',total,'page',page);
 elsif p_resource<>'workspace' then raise exception 'S4_INVALID_RESOURCE'; end if;
 select coalesce(jsonb_agg(x order by x.created_at,x.id),'[]') into rows from (
  select l.id,l.catalog_item_id,l.skill_name,l.quantity::text demand_quantity,l.registered_quantity::text registered_quantity,l.planned_quantity::text planned_quantity,l.baseline_source,l.line_revision,l.note,l.created_at,c.commercial_name,c.item_name,c.unit from public.equipment_request_items l join public.equipment_catalog c on c.id=l.catalog_item_id where l.request_id=r.id and l.removed_at is null
 ) x;
 return jsonb_build_object('request',jsonb_build_object('id',r.id,'status',r.status,'revision',r.preparation_revision,'receive_at',r.receive_at,'return_at',r.return_at,'registrant_id',r.registrant_id,'responsible_lecturer_id',r.responsible_lecturer_id),'manager',manager,'admin',manager and private.is_inventory_admin(),'actor_id',auth.uid(),'can_propose',auth.uid() in (r.registrant_id,r.responsible_lecturer_id),'lines',rows,
  'preparation',case when p.id is null then null else (to_jsonb(p)-'lock_token')||jsonb_build_object('health',private.s4_health(p.id),'draft',case when manager then p.draft else jsonb_build_object('lines',(select coalesce(jsonb_agg(jsonb_build_object('line_id',l.id,'planned_quantity',l.planned_quantity::text,'reviewed_revision',null,'shortage_reason','','allocations','[]'::jsonb)),'[]'::jsonb) from public.equipment_request_items l where l.request_id=r.id and l.removed_at is null)) end) end,
  'adjustments',coalesce((select jsonb_agg(a order by a.created_at desc) from (select * from public.equipment_quantity_adjustments where request_id=r.id order by created_at desc limit 30) a),'[]'::jsonb),
  'transfers',case when manager then coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('quantity',t.quantity::text) order by t.created_at,t.id) from public.equipment_preparation_transfers t where t.preparation_id=p.id),'[]'::jsonb) else '[]'::jsonb end);
end; $$;
revoke all on function public.equipment_preparation_read(uuid,text,jsonb) from public,anon;
grant execute on function public.equipment_preparation_read(uuid,text,jsonb) to authenticated;


-- S4 operational settings are distinct from the existing 24-hour registration rule.
create table public.equipment_preparation_settings (
  setting_key text primary key default 'primary' check (setting_key='primary'),
  revision bigint not null default 1,
  warning_lead_minutes integer not null default 120 check (warning_lead_minutes between 1 and 10080),
  inactivity_minutes integer not null default 15 check (inactivity_minutes between 1 and 120),
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.equipment_preparation_settings(setting_key) values ('primary');
alter table public.equipment_preparation_settings enable row level security;
revoke all on public.equipment_preparation_settings from public,anon,authenticated;

create or replace function private.s4_lock_inactivity()
returns interval language sql stable security definer set search_path='' as $$
 select make_interval(mins=>inactivity_minutes) from public.equipment_preparation_settings where setting_key='primary';
$$;
revoke all on function private.s4_lock_inactivity() from public,anon,authenticated;

create or replace function public.equipment_preparation_settings_command(p_expected_revision bigint,p_warning_lead_minutes integer,p_inactivity_minutes integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_row public.equipment_preparation_settings; after_row public.equipment_preparation_settings;
begin
 if not private.is_inventory_admin() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_warning_lead_minutes is null or p_warning_lead_minutes not between 1 and 10080 or p_inactivity_minutes is null or p_inactivity_minutes not between 1 and 120 or nullif(btrim(p_reason),'') is null or length(p_reason)>1000 then raise exception 'S4_INVALID_SETTINGS' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 select * into before_row from public.equipment_preparation_settings where setting_key='primary' for update;
 if p_expected_revision is distinct from before_row.revision then raise exception 'STALE_REVISION' using errcode='23505'; end if;
 update public.equipment_preparation_settings set revision=revision+1,warning_lead_minutes=p_warning_lead_minutes,inactivity_minutes=p_inactivity_minutes,updated_by=auth.uid(),updated_at=clock_timestamp() where setting_key='primary' returning * into after_row;
 insert into public.audit_logs(actor_id,action,entity_type,old_data,new_data,metadata) values(auth.uid(),'equipment_preparation_settings_changed','equipment_preparation_settings',to_jsonb(before_row),to_jsonb(after_row),jsonb_build_object('reason',btrim(p_reason)));
 return jsonb_build_object('revision',after_row.revision,'warning_lead_minutes',after_row.warning_lead_minutes,'inactivity_minutes',after_row.inactivity_minutes);
end; $$;

create or replace function public.equipment_preparation_operations_read(p_resource text default 'queue',p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare settings jsonb; lead_minutes integer; page integer; search_text text; status_filter text; sort_order text; rows jsonb; total bigint;
begin
 if not private.can_access_inventory() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select jsonb_build_object('revision',s.revision,'warning_lead_minutes',s.warning_lead_minutes,'inactivity_minutes',s.inactivity_minutes),s.warning_lead_minutes into settings,lead_minutes from public.equipment_preparation_settings s where setting_key='primary';
 if p_resource='settings' then return settings; end if;
 if p_resource is distinct from 'queue' or jsonb_typeof(p_filters) is distinct from 'object' then raise exception 'S4_INVALID_FILTER' using errcode='22023'; end if;
 page:=coalesce((p_filters->>'page')::integer,1); search_text:=coalesce(btrim(p_filters->>'search'),''); status_filter:=coalesce(p_filters->>'status','new'); sort_order:=coalesce(p_filters->>'sort','priority');
 if page not between 1 and 100000 or length(search_text)>120 or status_filter not in ('new','preparing','all') or sort_order not in ('priority','pickup','class') then raise exception 'S4_INVALID_FILTER' using errcode='22023'; end if;
 with scoped as (
  select r.id,r.status,r.receive_at,(s.schedule_date+s.start_time) at time zone 'Asia/Ho_Chi_Minh' class_at,s.course_code_snapshot course_code,s.course_name_snapshot course_name,s.class_code,
   p.id preparation_id,p.state preparation_state,p.primary_preparer,pr.full_name primary_preparer_name,
   (r.status='new' and r.receive_at<=now()+make_interval(mins=>lead_minutes)) overdue
  from public.equipment_requests r join public.class_schedules s on s.id=r.class_schedule_id
  left join public.equipment_preparations p on p.request_id=r.id and p.state in ('draft','prepared','reversing')
  left join public.profiles pr on pr.id=p.primary_preparer
  where r.request_domain='nursing_skills' and r.status in ('new','preparing') and private.can_manage_equipment_request(r.id)
   and (status_filter='all' or r.status=status_filter)
   and (search_text='' or strpos(lower(concat_ws(' ',s.course_code_snapshot,s.course_name_snapshot,s.class_code,r.id::text)),lower(search_text))>0)
 ), page_rows as (
  select * from scoped order by case when sort_order='priority' then overdue end desc,
   case when sort_order in ('priority','pickup') then receive_at end asc,
   class_at asc,id asc limit 30 offset (page-1)*30
 )
 select (select count(*) from scoped),coalesce((select jsonb_agg(to_jsonb(x)-'preparation_id'||jsonb_build_object('health',case when x.preparation_id is null then '[]'::jsonb else private.s4_health(x.preparation_id) end) order by case when sort_order='priority' then x.overdue end desc,case when sort_order in ('priority','pickup') then x.receive_at end asc,x.class_at,x.id) from page_rows x),'[]'::jsonb) into total,rows;
 return jsonb_build_object('rows',rows,'total',total,'page',page,'page_size',30,'admin',private.is_inventory_admin(),'settings',settings);
end; $$;
revoke all on function public.equipment_preparation_operations_read(text,jsonb),public.equipment_preparation_settings_command(bigint,integer,integer,text) from public,anon;
grant execute on function public.equipment_preparation_operations_read(text,jsonb),public.equipment_preparation_settings_command(bigint,integer,integer,text) to authenticated;

-- Immutable semantic event prevents repeats across scheduler runs and transactions.
-- Inactivity changes are irrelevant to warnings: only pickup and warning lead participate.
create table public.equipment_preparation_warning_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.equipment_requests(id) on delete restrict,
 pickup_at timestamptz not null,
 warning_lead_minutes integer not null,
 settings_revision bigint not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(request_id,pickup_at,warning_lead_minutes)
);
alter table public.equipment_preparation_warning_events enable row level security;
revoke all on public.equipment_preparation_warning_events from public,anon,authenticated;
create trigger equipment_preparation_warning_immutable before update or delete on public.equipment_preparation_warning_events for each row execute function private.s4_immutable();
create index equipment_requests_preparation_pickup on public.equipment_requests(receive_at,id) where request_domain='nursing_skills' and status='new';
create or replace function private.s4_warn_near_pickup()
returns integer language plpgsql security definer set search_path='' as $$
declare config public.equipment_preparation_settings; r public.equipment_requests; event_id uuid; notified integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 select * into config from public.equipment_preparation_settings where setting_key='primary';
 for r in select requests.* from public.equipment_requests requests
  where requests.request_domain='nursing_skills' and requests.status='new'
   and requests.receive_at<=now()+make_interval(mins=>config.warning_lead_minutes)
   and not exists(select 1 from public.equipment_preparation_warning_events e where e.request_id=requests.id and e.pickup_at=requests.receive_at and e.warning_lead_minutes=config.warning_lead_minutes)
  order by requests.receive_at,requests.id limit 100 for update of requests
 loop
  insert into public.equipment_preparation_warning_events(request_id,pickup_at,warning_lead_minutes,settings_revision) values(r.id,r.receive_at,config.warning_lead_minutes,config.revision) on conflict do nothing returning id into event_id;
  if event_id is not null then
   insert into public.equipment_preparation_events(request_id,operation,revision,payload) values(r.id,'near_pickup_unprepared',r.preparation_revision,jsonb_build_object('event_id',event_id,'pickup_at',r.receive_at,'warning_lead_minutes',config.warning_lead_minutes,'settings_revision',config.revision));
   perform private.notify_equipment_request_recipients(r.id,'near_pickup_unprepared','Phiếu thiết bị sắp đến giờ nhận chưa chuẩn bị','Vui lòng rà soát và hoàn tất chuẩn bị thiết bị. Phiếu vẫn ở trạng thái Mới.',false,true,null,jsonb_build_object('event_id',event_id,'pickup_at',r.receive_at,'warning_lead_minutes',config.warning_lead_minutes,'preparation_href','/equipment/preparation/'||r.id));
   notified:=notified+1;
  end if;
 end loop;
 return notified;
end; $$;
revoke all on function private.s4_warn_near_pickup() from public,anon,authenticated;
select cron.schedule('medlabs-s4-near-pickup','* * * * *','select private.s4_warn_near_pickup();');


-- Aggregate Skills messages publish committed/live targets, never warehouse draft values.
-- Basic Medical retains its existing quantity semantics and recipient routing.
create or replace function private.enqueue_equipment_request_outbox_event(
  target_request_id uuid,
  target_event text,
  target_operation_id uuid default null,
  target_actor_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_mode text;
  req_row record;
  sched_row record;
  room_row record;
  actor_name text;
  registrant_profile record;
  responsible_profile record;
  items_json jsonb;
  payload jsonb;
  recipients jsonb := '[]'::jsonb;
  event_key_value text;
  manager_row record;
  outbox_id uuid;
  effective_actor_id uuid := coalesce(target_actor_id, (select auth.uid()));
  basic_medical_room_type_id constant uuid := '40000000-0000-0000-0000-000000000002'::uuid;
  nursing_skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
begin
  select delivery_mode into current_mode from public.email_delivery_settings where setting_key = 'primary';
  if current_mode not in ('test', 'live') then current_mode := 'off'; end if;

  select * into req_row from public.equipment_requests where id = target_request_id;
  if req_row.id is null or req_row.request_domain not in ('nursing_skills', 'basic_medical') then
    raise exception 'EQUIPMENT_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into registrant_profile from public.profiles where id = req_row.registrant_id;
  select * into responsible_profile from public.profiles where id = req_row.responsible_lecturer_id;
  if effective_actor_id is not null then select full_name into actor_name from public.profiles where id = effective_actor_id; end if;
  select * into sched_row from public.class_schedules where id = req_row.class_schedule_id;
  if sched_row.room_id is not null then select * into room_row from public.rooms where id = sched_row.room_id; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'skill_name', item.skill_name,
    'item_name', case when req_row.request_domain = 'basic_medical' then coalesce(basic_catalog.item_name, 'Thiết bị không còn trong danh mục') else coalesce(skills_catalog.item_name, 'Thiết bị không còn trong danh mục') end,
    'commercial_name', case when req_row.request_domain = 'basic_medical' then coalesce(basic_catalog.commercial_name, '') else coalesce(skills_catalog.commercial_name, '') end,
    'unit', case when req_row.request_domain = 'basic_medical' then coalesce(basic_catalog.unit, '') else coalesce(skills_catalog.unit, '') end,
    'quantity', case when req_row.request_domain='nursing_skills' then item.planned_quantity else item.quantity end,
    'registered_quantity', item.registered_quantity,
    'line_id', item.id,
    'note', item.note
  )), '[]'::jsonb)
  into items_json
  from public.equipment_request_items item
  left join public.equipment_catalog skills_catalog on skills_catalog.id = item.catalog_item_id
  left join public.basic_medical_equipment_catalog basic_catalog on basic_catalog.id = item.basic_medical_catalog_item_id
  where item.request_id = target_request_id and item.removed_at is null;

  payload := jsonb_build_object(
    'request_id', req_row.id,
    'request_code', to_char(req_row.created_at at time zone 'Asia/Ho_Chi_Minh', 'YYMMDDHH24MISS'),
    'request_domain', req_row.request_domain,
    'event', target_event,
    'actor', coalesce(actor_name, registrant_profile.full_name, 'Người dùng hệ thống'),
    'course_code', coalesce(sched_row.course_code_snapshot, ''),
    'course_name', coalesce(sched_row.course_name_snapshot, ''),
    'schedule_date', sched_row.schedule_date,
    'start_time', to_char(sched_row.start_time, 'HH24:MI'),
    'end_time', to_char(sched_row.end_time, 'HH24:MI'),
    'semester', req_row.semester,
    'student_count', sched_row.student_count,
    'lab_type', case when req_row.request_domain = 'basic_medical' then 'Y cơ sở' else 'Kỹ năng Điều dưỡng' end,
    'room', coalesce(concat_ws(' · ', room_row.room_code, room_row.building_code), ''),
    'room_name', room_row.room_name,
    'registrant_name', coalesce(registrant_profile.full_name, ''),
    'registrant_email', coalesce(req_row.email_snapshot, registrant_profile.email, ''),
    'registrant_phone', coalesce(req_row.phone_snapshot, registrant_profile.phone, ''),
    'responsible_name', coalesce(responsible_profile.full_name, ''),
    'responsible_email', coalesce(responsible_profile.email, ''),
    'receive_at', req_row.receive_at,
    'return_at', req_row.return_at,
    'note', req_row.note,
    'late_approval_status', req_row.late_approval_status,
    'late_registration_reason', req_row.late_registration_reason,
    'late_review_note', req_row.late_review_note,
    'items', items_json
  );

  if req_row.registrant_id is not null and position('@' in coalesce(req_row.email_snapshot, registrant_profile.email, '')) > 0 then
    recipients := recipients || jsonb_build_object('recipient_id', req_row.registrant_id, 'recipient_email', lower(coalesce(req_row.email_snapshot, registrant_profile.email)), 'audience', 'registrant');
  end if;
  if req_row.responsible_lecturer_id <> req_row.registrant_id
    and responsible_profile.is_active
    and position('@' in coalesce(responsible_profile.email, '')) > 0
    and lower(responsible_profile.email) <> lower(coalesce(req_row.email_snapshot, registrant_profile.email, '')) then
    recipients := recipients || jsonb_build_object('recipient_id', req_row.responsible_lecturer_id, 'recipient_email', lower(responsible_profile.email), 'audience', 'responsible');
  end if;

  if target_event not in ('late_approval_approved', 'late_approval_rejected', 'deleted') then
    for manager_row in
      select distinct profile.id as user_id, lower(btrim(profile.email)) as email
      from public.user_roles role_row
      join public.profiles profile on profile.id = role_row.user_id
      where role_row.role in ('admin', 'staff')
        and profile.is_active and position('@' in coalesce(profile.email, '')) > 0
        and (role_row.role = 'admin' or exists (
          select 1 from public.profile_room_types scope
          where scope.profile_id = profile.id
            and scope.room_type_id = case when req_row.request_domain = 'basic_medical' then basic_medical_room_type_id else nursing_skills_room_type_id end
        ))
    loop
      if not exists (select 1 from jsonb_array_elements(recipients) recipient where recipient->>'recipient_email' = manager_row.email) then
        recipients := recipients || jsonb_build_object('recipient_id', manager_row.user_id, 'recipient_email', manager_row.email, 'audience', 'admin');
      end if;
    end loop;
  end if;

  event_key_value := case when target_event = 'deleted' then concat('equipment_request:deleted:', target_request_id) else concat('equipment_request:', target_event, ':', target_request_id, ':', coalesce(target_operation_id, gen_random_uuid())) end;
  insert into public.email_outbox_events(event_key,domain,event_type,aggregate_id,actor_id,payload,recipients,delivery_mode_at_event,status,last_error)
  values(event_key_value,'equipment_request',target_event,target_request_id,effective_actor_id,payload,recipients,current_mode,'pending',null)
  on conflict(event_key) do nothing returning id into outbox_id;
  return outbox_id;
end;
$$;
revoke all on function private.enqueue_equipment_request_outbox_event(uuid,text,uuid,uuid) from public, anon;
grant execute on function private.enqueue_equipment_request_outbox_event(uuid,text,uuid,uuid) to authenticated;



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
  if coalesce(current_setting('app.s4_transfer_work',true),'')<>'true' then
    perform private.s4_refresh_health();
  end if;

  insert into public.inventory_operation_replays (
    actor_id, operation, retry_key, payload_hash, result_ids, committed_at
  ) values (
    v_caller_id, p_operation, p_retry_key, v_payload_hash, v_result, clock_timestamp()
  );

  return v_result;
end;
$$;

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
        (e.eligible and not exists(select 1 from public.inventory_reservations rs where rs.asset_id=a.id and rs.released_at is null)) as available,
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
        (e.eligible and not exists(select 1 from public.inventory_reservations rs where rs.asset_id=a.id and rs.released_at is null)) as available,
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
        (e.eligible and not exists(select 1 from public.inventory_reservations rs where rs.asset_id=a.id and rs.released_at is null)) as available,
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

create or replace function private.guard_equipment_request_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_schedule_date date;
  target_room_type_id uuid;
begin
  -- S4 line writes advance only concurrency metadata. Do not reclassify a
  -- Basic Medical request as a Skills edit when no business field changed.
  if to_jsonb(new)->>'preparation_revision' is not null
    and (to_jsonb(new)->>'preparation_revision')::bigint = (to_jsonb(old)->>'preparation_revision')::bigint + 1
    and to_jsonb(new) - 'preparation_revision' - 'updated_at'
      = to_jsonb(old) - 'preparation_revision' - 'updated_at' then
    return new;
  end if;
  if current_setting('app.equipment_confirmation_rpc', true) = 'true' then
    return new;
  end if;
  if current_setting('app.basic_medical_equipment_edit_rpc', true) = 'true'
    and old.request_domain = 'basic_medical'
    and new.request_domain = 'basic_medical' then
    return new;
  end if;
  if old.status not in ('new', 'preparing')
    and (
      new.class_schedule_id is distinct from old.class_schedule_id
      or new.semester is distinct from old.semester
      or new.registrant_id is distinct from old.registrant_id
      or new.responsible_lecturer_id is distinct from old.responsible_lecturer_id
      or new.phone_snapshot is distinct from old.phone_snapshot
      or new.email_snapshot is distinct from old.email_snapshot
      or new.receive_at is distinct from old.receive_at
      or new.return_at is distinct from old.return_at
      or new.note is distinct from old.note
      or new.created_by is distinct from old.created_by
    ) then
    raise exception 'Chỉ có thể điều chỉnh phiếu trạng thái Mới hoặc Đã soạn.' using errcode = '42501';
  end if;
  if (select private.has_role('admin')) or (select private.has_role('staff')) then
    if new.status is distinct from old.status
      or new.handover_staff_confirmed_by is distinct from old.handover_staff_confirmed_by
      or new.handover_staff_confirmed_at is distinct from old.handover_staff_confirmed_at
      or new.handover_signature_path is distinct from old.handover_signature_path
      or new.handover_recipient_signed_at is distinct from old.handover_recipient_signed_at
      or new.handover_effective_at is distinct from old.handover_effective_at
      or new.return_staff_confirmed_by is distinct from old.return_staff_confirmed_by
      or new.return_staff_confirmed_at is distinct from old.return_staff_confirmed_at
      or new.return_signature_path is distinct from old.return_signature_path
      or new.return_recipient_signed_at is distinct from old.return_recipient_signed_at
      or new.return_effective_at is distinct from old.return_effective_at then
      raise exception 'Vui lòng dùng luồng xác nhận trạng thái phiếu.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.registrant_id is distinct from old.registrant_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.status is distinct from old.status
    or new.handover_file_url is distinct from old.handover_file_url
    or new.handover_staff_confirmed_by is distinct from old.handover_staff_confirmed_by
    or new.handover_staff_confirmed_at is distinct from old.handover_staff_confirmed_at
    or new.handover_signature_path is distinct from old.handover_signature_path
    or new.handover_recipient_signed_at is distinct from old.handover_recipient_signed_at
    or new.handover_effective_at is distinct from old.handover_effective_at
    or new.return_staff_confirmed_by is distinct from old.return_staff_confirmed_by
    or new.return_staff_confirmed_at is distinct from old.return_staff_confirmed_at
    or new.return_signature_path is distinct from old.return_signature_path
    or new.return_recipient_signed_at is distinct from old.return_recipient_signed_at
    or new.return_effective_at is distinct from old.return_effective_at
    or new.phone_snapshot is distinct from old.phone_snapshot
    or new.email_snapshot is distinct from old.email_snapshot then
    raise exception 'Người đăng ký chỉ được điều chỉnh nội dung phiếu.' using errcode = '42501';
  end if;
  select schedules.schedule_date, rooms.room_type_id
  into target_schedule_date, target_room_type_id
  from public.class_schedules as schedules
  join public.rooms as rooms on rooms.id = schedules.room_id
  where schedules.id = new.class_schedule_id
    and schedules.schedule_status <> 'cancelled';
  if target_schedule_date is null
    or target_room_type_id <> '40000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'Lớp Skills lab không hợp lệ hoặc đã bị hủy.' using errcode = '22023';
  end if;
  if (new.receive_at at time zone 'Asia/Ho_Chi_Minh')::date > target_schedule_date then
    raise exception 'Ngày nhận phải bằng hoặc trước ngày học.' using errcode = '22023';
  end if;
  if new.responsible_lecturer_id <> new.registrant_id
    and new.responsible_lecturer_id is distinct from old.responsible_lecturer_id
    and not exists (
      select 1 from public.list_scoped_lecturers(target_room_type_id) as lecturers
      where lecturers.id = new.responsible_lecturer_id
    ) then
    raise exception 'Giảng viên phụ trách không hợp lệ.' using errcode = '22023';
  end if;
  return new;
end;
$$;
