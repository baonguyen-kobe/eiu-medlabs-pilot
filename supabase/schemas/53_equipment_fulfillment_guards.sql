-- These guards also cover pre-existing S1/S2/S3 administrative writers.
create or replace function private.s5_pool_hold(p_cohort uuid,p_location uuid,p_condition text)
returns numeric language sql stable security definer set search_path='' as $$
 select greatest(0,coalesce(sum(f.quantity),0)) from public.equipment_fulfillment_effects f join public.equipment_issue_slices s on s.id=f.issue_slice_id where s.cohort_id=p_cohort and f.location_id=p_location and f.condition=p_condition and f.kind in ('hold','reconciliation');
$$;
create or replace function private.s4_pool_backing(p_cohort uuid,p_location uuid)
returns numeric language sql stable security definer set search_path='' as $$
 select greatest(0,coalesce((select b.quantity from public.inventory_stock_balances b
 join public.inventory_stock_origins o on o.id=b.cohort_id join public.inventory_receipt_cohorts c on c.origin_id=o.id join public.inventory_stock_facts f on f.id=c.current_fact_id join public.inventory_catalog_items i on i.id=o.catalog_item_id join public.inventory_storage_locations l on l.id=b.location_id
 where b.cohort_id=p_cohort and b.location_id=p_location and b.condition='good' and i.active and l.active
 and not exists(select 1 from public.inventory_stock_holds h where h.origin_id=o.id and h.status='active')
 and (not i.expiry_required or (f.expiry_precision in ('day','month') and f.expiry_date is not null))
 and (f.expiry_date is null or f.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)),0)-private.s5_pool_hold(p_cohort,p_location,'good'));
$$;
create or replace function private.s4_asset_eligible(p_asset uuid,p_location uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.equipment_assets a join public.inventory_catalog_items i on i.id=a.catalog_item_id join public.inventory_storage_locations l on l.id=a.location_id
 where a.id=p_asset and a.location_id=p_location and i.active and l.active and a.lifecycle_status='in_service' and a.operational_status='ready'
 and (not i.expiry_required or (a.expiry_precision in ('day','month') and a.expiry_date is not null))
 and (a.expiry_date is null or a.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)
 and not exists(select 1 from public.equipment_issue_slices s cross join lateral private.s5_obligation(s.id) o where s.asset_id=a.id and (o.issued>o.returned or o.held>0)));
$$;
create or replace function private.s5_guard_asset_custody()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('app.s5_command',true),'')<>'true'
 and row(new.location_id,new.custodian_id,new.operational_status,new.lifecycle_status) is distinct from row(old.location_id,old.custodian_id,old.operational_status,old.lifecycle_status)
 and exists(select 1 from public.equipment_issue_slices s cross join lateral private.s5_obligation(s.id) o where s.asset_id=old.id and (o.issued>o.returned or o.held>0)) then raise exception 'S5_USE_FULFILLMENT_CUSTODY_RECONCILIATION'; end if;
 return new;
end; $$;
drop trigger if exists equipment_assets_s5_custody on public.equipment_assets;
create trigger equipment_assets_s5_custody before update on public.equipment_assets for each row execute function private.s5_guard_asset_custody();
create or replace function private.s5_guard_held_stock()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.quantity<private.s5_pool_hold(old.cohort_id,old.location_id,old.condition) and coalesce(current_setting('app.s5_command',true),'')<>'true' then raise exception 'S5_RECONCILIATION_HOLD'; end if;
 return new;
end; $$;
drop trigger if exists inventory_stock_s5_hold on public.inventory_stock_balances;
create trigger inventory_stock_s5_hold before update on public.inventory_stock_balances for each row execute function private.s5_guard_held_stock();
create or replace function private.s5_guard_request_projection()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('app.s5_command',true),'')<>'true' and exists(select 1 from public.equipment_preparations where request_id=old.id)
 and (new.fulfillment_revision is distinct from old.fulfillment_revision
 or row(new.handover_staff_confirmed_by,new.handover_staff_confirmed_at,new.handover_signature_path,new.handover_recipient_signed_at,new.handover_effective_at,new.return_staff_confirmed_by,new.return_staff_confirmed_at,new.return_signature_path,new.return_recipient_signed_at,new.return_effective_at)
 is distinct from row(old.handover_staff_confirmed_by,old.handover_staff_confirmed_at,old.handover_signature_path,old.handover_recipient_signed_at,old.handover_effective_at,old.return_staff_confirmed_by,old.return_staff_confirmed_at,old.return_signature_path,old.return_recipient_signed_at,old.return_effective_at)) then raise exception 'S5_USE_EVENT_BOUND_FULFILLMENT'; end if;
 return new;
end; $$;
drop trigger if exists equipment_requests_s5_projection on public.equipment_requests;
create trigger equipment_requests_s5_projection before update on public.equipment_requests for each row execute function private.s5_guard_request_projection();
revoke all on function private.s5_pool_hold(uuid,uuid,text),private.s5_guard_asset_custody(),private.s5_guard_held_stock(),private.s5_guard_request_projection() from public,anon,authenticated;
