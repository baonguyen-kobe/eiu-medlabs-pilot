create unique index if not exists equipment_fulfillment_one_successor on public.equipment_fulfillment_events(corrects_event_id) where corrects_event_id is not null;

-- Reverse only the target version's own facts, not its predecessor offsets.
-- All inverses and replacement facts commit together, including signature state.
create or replace function private.s5_reverse_event(p_event uuid,p_target uuid)
returns void language plpgsql security definer set search_path='' as $$
declare e public.equipment_fulfillment_events; target public.equipment_fulfillment_events; slice_rec public.equipment_issue_slices; eff_rec record; a record; current_asset public.equipment_assets; before_asset jsonb; last_asset uuid;
begin
 select * into strict e from public.equipment_fulfillment_events where id=p_event;
 select * into strict target from public.equipment_fulfillment_events where id=p_target and request_id=e.request_id;
 if target.operation in ('consequence','reconcile') or exists(select 1 from public.equipment_fulfillment_effects where event_id=target.id and kind in ('consequence','reconciliation')) then
  if not private.is_inventory_admin() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 end if;
 -- Restore exact physical asset before-state for target replacement facts only,
 -- skipping predecessor assets whose mutations in target transaction were compensation-only.
 -- Reverse applies only when no later asset event would be erased.
 for a in with target_replacement_assets as (
   select s.asset_id, count(*)::int as own_facts
   from public.equipment_issue_slices s
   where s.event_id=target.id and s.asset_id is not null
   group by s.asset_id
   union all
   select s.asset_id, count(*)::int as own_facts
   from public.equipment_fulfillment_effects eff
   join public.equipment_issue_slices s on s.id=eff.issue_slice_id
   where eff.event_id=target.id and s.asset_id is not null
     and eff.kind in ('receipt','consequence','reconciliation')
     and (eff.offsets_effect_id is null or (eff.kind='reconciliation' and eff.classification<>'correction'))
   group by s.asset_id
  ),
  grouped_replacements as (
   select asset_id, sum(own_facts)::int as own_facts
   from target_replacement_assets
   group by asset_id
  ),
  target_ranked_mutations as (
   select ae.asset_id, ae.before_state,
          row_number() over (partition by ae.asset_id order by ae.revision desc) as rn_desc
   from public.equipment_asset_events ae
   where ae.transaction_id=target.transaction_id
  )
  select m.asset_id, m.before_state
  from target_ranked_mutations m
  join grouped_replacements g on g.asset_id=m.asset_id and m.rn_desc=g.own_facts
 loop
  select transaction_id into last_asset from public.equipment_asset_events where asset_id=a.asset_id order by revision desc limit 1;
  if last_asset<>target.transaction_id then raise exception 'S5_DEPENDENT_ASSET_HISTORY'; end if;
  before_asset:=a.before_state;
  select * into strict current_asset from public.equipment_assets where id=a.asset_id for update;
  perform private.s5_asset(e.transaction_id,a.asset_id,(before_asset->>'location_id')::uuid,(before_asset->>'custodian_id')::uuid,before_asset->>'operational_status',before_asset->>'lifecycle_status',e.reason);
 end loop;
 for slice_rec in select * from public.equipment_issue_slices where event_id=target.id loop
  if exists(select 1 from public.equipment_fulfillment_effects where issue_slice_id=slice_rec.id) then raise exception 'S5_DEPENDENT_ISSUE_HISTORY'; end if;
  insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,classification) values(e.id,slice_rec.id,'issue_correction',-slice_rec.quantity,'superseded_issue');
  if slice_rec.cohort_id is not null then perform private.s5_stock(e.transaction_id,slice_rec.cohort_id,slice_rec.inventory_item_id,slice_rec.location_id,'good',slice_rec.quantity); end if;
 end loop;
 for eff_rec in select * from public.equipment_fulfillment_effects where event_id=target.id and kind<>'issue_correction' and (offsets_effect_id is null or (kind='reconciliation' and classification<>'correction')) order by case when kind='hold' then 0 else 1 end,id loop
  select * into strict slice_rec from public.equipment_issue_slices where id=eff_rec.issue_slice_id;
  if eff_rec.kind='receipt' and slice_rec.cohort_id is not null then
   if eff_rec.condition='good' and eff_rec.quantity>private.s4_available(slice_rec.cohort_id,eff_rec.location_id) then raise exception 'S5_CORRECTION_BACKING_RESERVED_OR_HELD'; end if;
   perform private.s5_stock(e.transaction_id,slice_rec.cohort_id,slice_rec.inventory_item_id,eff_rec.location_id,eff_rec.condition,-eff_rec.quantity);
  end if;
  insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,location_id,condition,classification,offsets_effect_id)
  values(e.id,slice_rec.id,eff_rec.kind,-eff_rec.quantity,eff_rec.location_id,eff_rec.condition,'correction',case when eff_rec.kind='reconciliation' then eff_rec.offsets_effect_id else eff_rec.id end);
 end loop;
 -- A late receipt also carried resolution offsets. Undo those explicitly;
 -- offsets created by a prior correction are not target physical facts.
 for eff_rec in select * from public.equipment_fulfillment_effects where event_id=target.id and classification='late_return' loop
  insert into public.equipment_fulfillment_effects(event_id,issue_slice_id,kind,quantity,classification,offsets_effect_id)
  values(e.id,eff_rec.issue_slice_id,'resolution',-eff_rec.quantity,'correction',eff_rec.offsets_effect_id);
 end loop;
end; $$;
revoke all on function private.s5_reverse_event(uuid,uuid) from public,anon,authenticated;
