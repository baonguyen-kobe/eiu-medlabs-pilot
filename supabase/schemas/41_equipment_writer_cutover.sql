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
