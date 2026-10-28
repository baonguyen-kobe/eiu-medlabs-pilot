-- Operational additions remain inside the existing fulfillment P1 writer lane.
create or replace function private.s5_add_supplemental_line(p_request uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; m public.equipment_inventory_mappings; ref public.equipment_request_items; q numeric; previous_context text; new_line uuid;
begin
 select * into strict r from public.equipment_requests where id=p_request for update;
 if not private.is_active_user() or not private.can_access_inventory() or not private.can_manage_equipment_request(r.id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if r.status<>'handed_over' or exists(select 1 from public.equipment_fulfillment_events where request_id=r.id and operation='initial_return') then raise exception 'S5_SUPPLEMENT_BEFORE_INITIAL_RETURN_REQUIRED'; end if;
 if nullif(btrim(p_payload->>'reason'),'') is null or length(p_payload->>'reason')>1000 or length(coalesce(p_payload->>'note',''))>1000 then raise exception 'S5_AMENDMENT_REASON_REQUIRED' using errcode='22023'; end if;
 q:=private.s4_quantity(p_payload->>'requested_quantity');
 if q<1 or q<>trunc(q) or q>2147483647 then raise exception 'S4_DEMAND_UNIT_INTEGER_REQUIRED' using errcode='22023'; end if;
 select * into ref from public.equipment_request_items where id=(p_payload->>'reference_line_id')::uuid and request_id=r.id and removed_at is null;
 if not found then raise exception 'S4_INVALID_LINE_ID' using errcode='22023'; end if;
 select * into m from public.equipment_inventory_mappings where id=(p_payload->>'mapping_id')::uuid;
 if not found or not exists(select 1 from public.equipment_catalog where id=m.catalog_item_id and is_active)
  or not exists(select 1 from public.inventory_catalog_items where id=m.inventory_item_id and active and return_semantics<>'in_place')
  or not exists(select 1 from public.inventory_storage_locations where id=(p_payload->>'location_id')::uuid and active)
  or exists(select 1 from public.equipment_request_items where request_id=r.id and catalog_item_id=m.catalog_item_id and removed_at is null) then raise exception 'S5_NEW_MAPPED_CATALOG_REQUIRED' using errcode='22023'; end if;
 perform private.p1_request_gate(m.inventory_item_id,(p_payload->>'location_id')::uuid,null,r.id);
 new_line:=(p_payload->>'line_id')::uuid;
 previous_context:=current_setting('app.s4_command',true);
 perform set_config('app.s4_command','true',true);
 perform private.s4_add_line(r.id,new_line,m.catalog_item_id,ref.skill_name,q::integer,p_payload->>'note');
 perform set_config('app.s4_command',coalesce(previous_context,''),true);
 insert into public.equipment_preparation_events(request_id,operation,actor_id,revision,payload)
 values(r.id,'supplemental_line_requested',auth.uid(),(select preparation_revision from public.equipment_requests where id=r.id),p_payload);
 return jsonb_build_object('line_id',new_line,'requested_quantity',q::text,'stock_effect',false);
end; $$;
revoke all on function private.s5_add_supplemental_line(uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.equipment_operations_read(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare page integer; phase text; search_text text; rows jsonb; total bigint;
begin
 if not private.is_active_user() or not private.can_access_inventory() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if jsonb_typeof(p_filters) is distinct from 'object' then raise exception 'S4_INVALID_FILTER' using errcode='22023'; end if;
 page:=coalesce((p_filters->>'page')::integer,1); phase:=coalesce(p_filters->>'phase','all'); search_text:=coalesce(btrim(p_filters->>'search'),'');
 if page not between 1 and 100000 or phase not in ('all','prepare','handover','signature','return','hold') or length(search_text)>120 then raise exception 'S4_INVALID_FILTER' using errcode='22023'; end if;
 with scoped as (
  select r.id,r.status,r.receive_at,r.return_at,(r.return_at<now()) return_overdue,s.course_code_snapshot course_code,s.course_name_snapshot course_name,s.class_code,
   coalesce(pr.full_name,'') responsible_name,r.late_approval_status,
   exists(select 1 from public.equipment_preparations where request_id=r.id and state='prepared') prepared,
   exists(select 1 from public.equipment_preparations where request_id=r.id) has_preparation,
   (select count(*) from public.equipment_fulfillment_events e where e.request_id=r.id and e.signature_required
     and not exists(select 1 from public.equipment_fulfillment_events newer where newer.corrects_event_id=e.id)
     and not exists(select 1 from public.equipment_fulfillment_signatures sig where sig.event_id=e.id)) unsigned_count,
   (select count(*) from public.equipment_issue_slices sl join public.equipment_fulfillment_events e on e.id=sl.event_id cross join lateral private.s5_obligation(sl.id) o where e.request_id=r.id and o.due>0) due_line_count,
   (select count(*) from public.equipment_issue_slices sl join public.equipment_fulfillment_events e on e.id=sl.event_id cross join lateral private.s5_obligation(sl.id) o where e.request_id=r.id and o.held>0) hold_line_count
  from public.equipment_requests r join public.class_schedules s on s.id=r.class_schedule_id left join public.profiles pr on pr.id=r.responsible_lecturer_id
  where r.request_domain='nursing_skills' and private.can_manage_equipment_request(r.id)
   and (search_text='' or strpos(lower(concat_ws(' ',r.id::text,s.course_code_snapshot,s.course_name_snapshot,s.class_code,pr.full_name)),lower(search_text))>0)
 ), filtered as (
  select * from scoped where case phase
   when 'prepare' then status='new' when 'handover' then status='preparing' and prepared
   when 'signature' then unsigned_count>0 when 'return' then due_line_count>0 when 'hold' then hold_line_count>0
   else status in ('new','preparing','handed_over','returned') or unsigned_count>0 or due_line_count>0 or hold_line_count>0 end
 ), page_rows as (
  select * from filtered order by case when due_line_count>0 then return_at else receive_at end,id limit 30 offset (page-1)*30
 ) select (select count(*) from filtered),coalesce((select jsonb_agg(to_jsonb(x) order by case when x.due_line_count>0 then x.return_at else x.receive_at end,x.id) from page_rows x),'[]'::jsonb) into total,rows;
 return jsonb_build_object('rows',rows,'total',total,'page',page,'page_size',30);
end; $$;
revoke all on function public.equipment_operations_read(jsonb) from public,anon;
grant execute on function public.equipment_operations_read(jsonb) to authenticated;
