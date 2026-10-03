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

