-- Workflow review fixes (owner decisions 2026-11-20):
--   1. Cancelling a class (Skills or Basic Medical, by any path) cancels its open equipment
--      requests; a request Kho already prepared or handed over blocks the cancel. A cancelled
--      Skills class emails its lecturers.
--   2. A Skills request's responsible lecturer must be the registrant or a Skills-scoped lecturer.
--   3. Returns cannot be received into an inactive storage location.
--   4. The preparation heartbeat no longer takes the global inventory lock or writes replay rows.
--   5. A pending late registration can still be rejected after its receive time, and approved
--      until its return time.
--   6. Lists can tell whether an inventory-backed request still waits for a recipient signature.
--   7. The room list filters "has equipment" across all rooms and escapes LIKE wildcards.
--   8. A lecturer cannot delete a Skills class that already took place; a schedule whose
--      Basic Medical confirmation is still valid cannot be deleted.

-- 1. Class cancel cascade -------------------------------------------------------------------

create or replace function private.cancel_equipment_for_cancelled_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := coalesce((select auth.uid()), new.cancelled_by);
  request_row record;
  previous_confirmation text := current_setting('app.equipment_confirmation_rpc', true);
  previous_cascade text := current_setting('app.class_cancel_cascade', true);
  room_type_code_value text;
  room_label text;
  lecturer_name text;
  actor_name text;
begin
  if exists (
    select 1
    from public.equipment_requests as requests
    where requests.class_schedule_id = new.id
      and requests.status not in ('cancelled', 'returned', 'completed')
      and (
        requests.status = 'handed_over'
        or exists (
          select 1 from public.equipment_preparations as preparations
          where preparations.request_id = requests.id
            and preparations.state in ('prepared', 'reversing')
        )
      )
  ) then
    raise exception 'CLASS_CANCEL_EQUIPMENT_IN_USE' using errcode = '55000',
      hint = 'Kho cần hoàn tác chuẩn bị hoặc nhận trả thiết bị trước khi hủy buổi.';
  end if;

  perform set_config('app.equipment_confirmation_rpc', 'true', true);
  perform set_config('app.class_cancel_cascade', 'true', true);
  for request_row in
    select requests.id
    from public.equipment_requests as requests
    where requests.class_schedule_id = new.id
      and requests.status in ('new', 'preparing')
    order by requests.id
    for update
  loop
    update public.equipment_requests set status = 'cancelled' where id = request_row.id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      actor_id, 'equipment_request.cancelled', 'equipment_request', request_row.id,
      jsonb_build_object('reason', 'class_schedule_cancelled', 'schedule_id', new.id)
    );
    perform private.enqueue_equipment_request_outbox_event(request_row.id, 'deleted', null, actor_id);
  end loop;
  perform set_config('app.equipment_confirmation_rpc', coalesce(previous_confirmation, ''), true);
  perform set_config('app.class_cancel_cascade', coalesce(previous_cascade, ''), true);

  -- Basic Medical cancellations already email through their own schedule outbox.
  if new.basic_medical_registration_id is not null then
    return new;
  end if;

  select room_types.code, concat_ws(' · ', rooms.room_code, rooms.building_code)
  into room_type_code_value, room_label
  from public.rooms as rooms
  join public.room_types as room_types on room_types.id = rooms.room_type_id
  where rooms.id = new.room_id;

  if room_type_code_value is distinct from 'nursing_skills' then
    return new;
  end if;

  select pg_catalog.string_agg(profiles.full_name, ' · ' order by profiles.full_name)
  into lecturer_name
  from public.profiles as profiles
  where profiles.id in (new.lecturer_id, new.lecturer_2_id);
  select profiles.full_name into actor_name from public.profiles as profiles where profiles.id = actor_id;

  insert into public.email_outbox_events (
    domain, event_type, aggregate_id, event_key, payload, recipients, delivery_mode_at_event
  )
  select
    'skills_lab_schedule',
    'skills_lab_cancelled',
    new.id,
    concat('skills_lab:cancelled:', new.id),
    jsonb_build_object(
      'schedule_id', new.id,
      'course_code', new.course_code_snapshot,
      'course_name', new.course_name_snapshot,
      'schedule_date', new.schedule_date,
      'start_time', new.start_time,
      'end_time', new.end_time,
      'room', room_label,
      'room_type_code', room_type_code_value,
      'student_count', new.student_count,
      'lecturer', coalesce(lecturer_name, 'Chưa có giảng viên'),
      'request_code', to_char(new.created_at at time zone 'Asia/Ho_Chi_Minh', 'YYMMDDHH24MISS'),
      'actor', coalesce(actor_name, 'Quản trị viên')
    ),
    (
      select coalesce(jsonb_agg(jsonb_build_object('id', recipients.id, 'email', recipients.email)), '[]'::jsonb)
      from public.profiles as recipients
      where recipients.is_active
        and recipients.id in (new.lecturer_id, new.lecturer_2_id, new.created_by)
    ),
    (select delivery_mode from public.email_delivery_settings where setting_key = 'primary')
  on conflict (event_key) do nothing;

  return new;
end;
$$;

revoke all on function private.cancel_equipment_for_cancelled_schedule() from public, anon, authenticated;

drop trigger if exists class_schedules_cancel_equipment on public.class_schedules;
-- BEFORE: the request triggers still see the class as active while its requests are cancelled.
create trigger class_schedules_cancel_equipment
before update of schedule_status on public.class_schedules
for each row
when (new.schedule_status = 'cancelled' and old.schedule_status is distinct from 'cancelled')
execute function private.cancel_equipment_for_cancelled_schedule();

-- The cascade runs for whoever cancels the class (a Basic Medical teaching lecturer may not
-- own the request), so it bypasses the room-scope check for that one status change only.
create or replace function private.enforce_equipment_request_room_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  request_domain_value public.equipment_request_domain := coalesce(new.request_domain, old.request_domain);
begin
  -- Physical deletion is only reachable through the gated hard-delete RPC;
  -- retain TB-06's trigger-level bypass for that SECURITY DEFINER path.
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE'
    and current_setting('app.class_cancel_cascade', true) = 'true'
    and new.status = 'cancelled'
    and old.status in ('new', 'preparing') then
    return new;
  end if;
  if (select auth.role()) = 'service_role' or (select private.has_role('admin')) then return coalesce(new, old); end if;
  if (select private.has_role('staff')) then
    if (request_domain_value = 'basic_medical' and not (select private.can_manage_basic_medical()))
      or (request_domain_value = 'nursing_skills' and not (select private.can_manage_equipment_schedule(coalesce(new.class_schedule_id, old.class_schedule_id)))) then
      raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode = '42501';
    end if;
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' and new.registrant_id = actor_id and new.created_by = actor_id then return new; end if;
  if tg_op = 'UPDATE' and ((old.registrant_id = actor_id and new.registrant_id = actor_id) or (old.responsible_lecturer_id = actor_id and new.responsible_lecturer_id = actor_id)) then return new; end if;
  raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode = '42501';
end;
$$;

create or replace function private.format_skills_lab_email_subject(
  target_event_type text,
  target_payload jsonb,
  target_audience text
)
returns text language plpgsql stable security definer set search_path = '' as $$
declare prefix text := case when target_audience = 'admin' then '[Admin MedLabs Calendar]' else '[MedLabs Calendar]' end;
declare course_code text := coalesce(target_payload->>'course_code', '');
declare imported_rows text := coalesce(target_payload->>'imported_rows', '0');
declare lecturer_name text := coalesce(nullif(target_payload->>'lecturer', ''), nullif(target_payload->>'actor', ''), 'Giảng viên');
declare schedule_date text := '';
declare record_code text := coalesce(nullif(target_payload->>'request_code', ''), nullif(target_payload->>'record_code', ''));
declare identifying_tail text;
begin
  if nullif(target_payload->>'schedule_date', '') is not null then
    schedule_date := to_char((target_payload->>'schedule_date')::date, 'DD/MM/YYYY');
  end if;
  identifying_tail := concat_ws(' - ', lecturer_name, nullif(schedule_date, ''), nullif(course_code, ''), nullif(record_code, ''));
  if target_event_type = 'class_schedule_created' then return concat(prefix, '[Skills Lab][New] Lịch Skills Lab mới - ', identifying_tail); end if;
  if target_event_type = 'class_schedule_import_summary' then return concat(prefix, '[Skills Lab][Import] Cập nhật lịch sử import - ', imported_rows, ' lịch mới'); end if;
  if target_event_type = 'class_schedule_rescheduled' then return concat(prefix, '[Skills Lab][Adjusted] Đổi ngày học - ', identifying_tail); end if;
  if target_event_type = 'skills_lab_deleted' then return concat(prefix, '[Skills Lab][Deleted] Xóa lịch Skills Lab - ', concat_ws(' - ', nullif(course_code, ''), nullif(schedule_date, ''), nullif(record_code, ''))); end if;
  if target_event_type = 'skills_lab_cancelled' then return concat(prefix, '[Skills Lab][Cancelled] Hủy lịch Skills Lab - ', identifying_tail); end if;
  return concat(prefix, '[Skills Lab][New] Lịch Skills Lab - ', course_code);
end;
$$;
revoke all on function private.format_skills_lab_email_subject(text,jsonb,text) from public, anon, authenticated;

-- 2. Skills responsible lecturer ------------------------------------------------------------

create or replace function private.guard_equipment_request_responsible_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.request_domain = 'nursing_skills'
    and old.request_domain = 'nursing_skills'
    and new.responsible_lecturer_id is not distinct from old.responsible_lecturer_id then
    if exists (
      select 1
      from public.system_security_principals as principals
      where principals.singleton
        and principals.root_admin_id = new.responsible_lecturer_id
    ) then
      raise exception 'ROOT_ADMIN_OPERATIONAL_ASSIGNMENT_FORBIDDEN'
        using errcode = '42501';
    end if;

    return new;
  end if;

  perform private.assert_operationally_assignable(new.responsible_lecturer_id);

  -- Same rule the request form applies: the registrant, or a lecturer scoped to Skills lab.
  -- Calls without a user session (service role, migrations) keep their own checks.
  if new.request_domain = 'nursing_skills'
    and (select auth.uid()) is not null
    and new.responsible_lecturer_id is distinct from new.registrant_id
    and not (
      exists (
        select 1 from public.user_roles as roles
        where roles.user_id = new.responsible_lecturer_id and roles.role = 'lecturer'
      )
      and exists (
        select 1 from public.profile_room_types as assignments
        where assignments.profile_id = new.responsible_lecturer_id
          and assignments.room_type_id = '40000000-0000-0000-0000-000000000001'::uuid
      )
    ) then
    raise exception 'Giảng viên phụ trách không hợp lệ.' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- 3. Active return locations ----------------------------------------------------------------

create or replace function private.s5_receipt_location_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only new receipts; a correction's negative receipt reverses the original location.
  if new.kind = 'receipt' and new.quantity > 0 and not exists (
    select 1 from public.inventory_storage_locations
    where id = new.location_id and active
  ) then
    raise exception 'S5_RECEIPT_LOCATION_INACTIVE' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.s5_receipt_location_active() from public, anon, authenticated;

drop trigger if exists equipment_fulfillment_effects_active_location on public.equipment_fulfillment_effects;
create trigger equipment_fulfillment_effects_active_location
before insert on public.equipment_fulfillment_effects
for each row execute function private.s5_receipt_location_active();

-- 4. Lightweight preparation heartbeat ------------------------------------------------------

create or replace function private.s4_heartbeat(p_request_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  r public.equipment_requests;
  p public.equipment_preparations;
begin
  if actor is null or not private.is_active_user() then raise exception 'AUTH_DENIED' using errcode = '42501'; end if;
  select * into r from public.equipment_requests where id = p_request_id;
  if not found or r.request_domain <> 'nursing_skills' or not private.can_read_preparation(r.id)
    or not (private.can_access_inventory() and private.can_manage_equipment_request(r.id)) then
    raise exception 'AUTH_DENIED' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'INVALID_PAYLOAD'; end if;
  if r.status not in ('new', 'preparing') then raise exception 'S4_INVALID_REQUEST_STATE'; end if;
  select * into p from public.equipment_preparations
  where request_id = r.id and state = 'draft'
  for update;
  if p.id is null
    or p.lock_holder is distinct from actor
    or p.lock_token is distinct from nullif(p_payload->>'lock_token', '')::uuid
    or p.lock_expires_at <= clock_timestamp() then
    raise exception 'S4_LOCK_REQUIRED';
  end if;
  update public.equipment_preparations
  set lock_expires_at = clock_timestamp() + private.s4_lock_inactivity()
  where id = p.id;
  return jsonb_build_object('request_id', r.id, 'revision', r.preparation_revision,
    'adjustment_id', null, 'mapping_id', null, 'plan_id', null);
end;
$$;
revoke all on function private.s4_heartbeat(uuid, jsonb) from public, anon, authenticated;

create or replace function public.equipment_preparation_command(p_operation text,p_request_id uuid,p_payload jsonb,p_retry_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare previous private.inventory_pilot_writer_context; result jsonb;
begin
 -- A lock refresh touches one row and must not queue behind every stock write.
 if p_operation = 'heartbeat' then return private.s4_heartbeat(p_request_id, p_payload); end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 previous:=private.p1_enter('equipment_preparation_command',p_operation,p_payload,p_request_id);
 perform private.p1_preflight('equipment_preparation_command',p_operation,p_payload,p_request_id,p_retry_key);
 result:=private.p1_preparation_core(p_operation,p_request_id,p_payload-'pilot',p_retry_key);
 perform private.p1_leave(previous); return result;
end; $$;

-- 5. Late registration review after the receive time ----------------------------------------

create or replace function public.manager_review_late_equipment_request_scoped_impl(
  target_request_id uuid,
  target_decision text,
  target_note text default null
)
returns public.equipment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  current_row public.equipment_requests;
  changed_row public.equipment_requests;
begin
  if actor_id is null or not (select private.is_active_user())
    or not ((select private.has_role('admin')) or (select private.has_role('staff'))) then
    raise exception 'Chỉ Admin hoặc Chuyên viên được duyệt đăng ký trễ.' using errcode = '42501';
  end if;
  if target_decision not in ('approved', 'rejected') then
    raise exception 'Kết quả duyệt đăng ký trễ không hợp lệ.' using errcode = '22023';
  end if;

  select * into current_row
  from public.equipment_requests
  where id = target_request_id
  for update;
  if current_row.id is null then
    raise exception 'Không tìm thấy phiếu thiết bị.' using errcode = 'P0002';
  end if;
  if current_row.late_approval_status <> 'pending' then
    raise exception 'Phiếu không ở trạng thái Chờ duyệt đăng ký trễ.' using errcode = '22023';
  end if;
  -- Rejecting is always allowed so a request never stays pending; approving needs the
  -- borrowing window to still be open.
  if target_decision = 'approved' and current_row.return_at <= clock_timestamp() then
    raise exception 'Thời gian trả thiết bị đã qua nên không thể duyệt. Vui lòng từ chối phiếu.' using errcode = '22023';
  end if;

  perform set_config('app.equipment_late_approval_rpc', 'true', true);
  update public.equipment_requests
  set late_approval_status = target_decision,
      late_reviewed_by = actor_id,
      late_reviewed_at = clock_timestamp(),
      late_review_note = nullif(btrim(target_note), '')
  where id = target_request_id
  returning * into changed_row;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, old_data, new_data, metadata
  ) values (
    actor_id,
    case when target_decision = 'approved' then 'approve_late_equipment_registration' else 'reject_late_equipment_registration' end,
    'equipment_request',
    target_request_id,
    jsonb_build_object('late_approval_status', current_row.late_approval_status),
    jsonb_build_object('late_approval_status', target_decision),
    jsonb_build_object('review_note', nullif(btrim(target_note), ''))
  );

  perform private.enqueue_equipment_request_outbox_event(
    target_request_id,
    case when target_decision = 'approved' then 'late_approval_approved' else 'late_approval_rejected' end,
    null,
    actor_id
  );

  return changed_row;
end;
$$;

-- 6. Unsigned fulfillment events ------------------------------------------------------------

-- PostgREST computed field: true while a current signable event has no recipient signature.
create or replace function public.has_unsigned_fulfillment(p_request public.equipment_requests)
returns boolean language sql stable security definer set search_path='' as $$
 select private.can_read_preparation(p_request.id) and exists(
  select 1 from public.equipment_fulfillment_events ev
  where ev.request_id = p_request.id and ev.signature_required
    and not exists(select 1 from public.equipment_fulfillment_events newer where newer.corrects_event_id = ev.id)
    and not exists(select 1 from public.equipment_fulfillment_signatures sig where sig.event_id = ev.id));
$$;
revoke all on function public.has_unsigned_fulfillment(public.equipment_requests) from public, anon, authenticated;
grant execute on function public.has_unsigned_fulfillment(public.equipment_requests) to authenticated;

-- 7. Room list filter -----------------------------------------------------------------------

drop function if exists public.room_equipment_summary(text, integer, integer);

create or replace function public.room_equipment_summary(
  p_query text default null,
  p_page integer default 1,
  p_page_size integer default 50,
  p_has_equipment boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  size integer := greatest(1, least(coalesce(p_page_size, 50), 100));
  page integer := greatest(1, coalesce(p_page, 1));
  pattern text;
  total bigint;
  rows jsonb;
begin
  if not (select private.can_access_inventory()) then
    raise exception 'AUTH_DENIED: Access denied to inventory read models' using errcode = '42501';
  end if;

  if nullif(btrim(p_query), '') is not null then
    pattern := '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  -- shortcut: one room_equipment_read per room (every active room when filtering on
  -- equipment); move to a set-based query if the room list gets slow.
  with matched as (
    select ro.* from public.rooms ro
    where ro.is_active
      and (pattern is null or concat_ws(' ', ro.building_code, ro.room_code, ro.room_name) ilike pattern)
  ), candidates as (
    select * from matched
    where coalesce(p_has_equipment, false)
       or id in (select id from matched order by building_code, room_code limit size offset (page - 1) * size)
  ), summarized as (
    select ro.id as room_id, ro.room_code, ro.building_code, ro.room_name, rt.name as room_type,
      jsonb_array_length(d->'fixed') + jsonb_array_length(d->'assets') as fixed,
      jsonb_array_length(d->'temporary') as temporary,
      (select count(*) from jsonb_array_elements(d->'fixed') f where coalesce((f->>'damaged')::numeric, 0) > 0)
        + (select count(*) from jsonb_array_elements(d->'assets') a where a->>'operational_status' = 'damaged') as damaged
    from candidates ro
    left join public.room_types rt on rt.id = ro.room_type_id
    cross join lateral (select public.room_equipment_read(ro.id) as d) detail
  ), kept as (
    select * from summarized
    where not coalesce(p_has_equipment, false) or fixed + temporary + damaged > 0
  )
  select
    case when coalesce(p_has_equipment, false) then (select count(*) from kept) else (select count(*) from matched) end,
    (select coalesce(jsonb_agg(to_jsonb(k) order by k.building_code, k.room_code), '[]'::jsonb)
     from (
       select * from kept order by building_code, room_code
       limit case when coalesce(p_has_equipment, false) then size end
       offset case when coalesce(p_has_equipment, false) then (page - 1) * size else 0 end
     ) k)
  into total, rows;

  return jsonb_build_object('total', total, 'page', page, 'page_size', size, 'rows', rows);
end;
$$;

revoke all on function public.room_equipment_summary(text, integer, integer, boolean) from public, anon;
grant execute on function public.room_equipment_summary(text, integer, integer, boolean) to authenticated;

-- 8. Delete guards --------------------------------------------------------------------------

create or replace function private.guard_class_schedule_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Service-role maintenance (cleanup scripts, fixtures) keeps its own controls.
  if (select auth.uid()) is null then
    return old;
  end if;
  if old.basic_medical_registration_id is null
    and old.schedule_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date
    and not ((select private.has_role('admin')) or (select private.has_role('staff'))) then
    raise exception 'CLASS_PAST_DELETE_FORBIDDEN' using errcode = '42501',
      hint = 'Lớp đã diễn ra nên không thể xóa. Liên hệ Quản trị viên nếu cần điều chỉnh.';
  end if;
  if exists (
    select 1
    from public.basic_medical_registration_sessions as sessions
    join public.basic_medical_session_confirmations as confirmations
      on confirmations.session_id = sessions.id
    where sessions.class_schedule_id = old.id
      and confirmations.invalidated_at is null
  ) then
    raise exception 'BASIC_MEDICAL_SESSION_CONFIRMATION_INVALIDATION_REQUIRED' using errcode = '22023';
  end if;
  return old;
end;
$$;
revoke all on function private.guard_class_schedule_delete() from public, anon, authenticated;

drop trigger if exists class_schedules_guard_delete on public.class_schedules;
create trigger class_schedules_guard_delete
before delete on public.class_schedules
for each row execute function private.guard_class_schedule_delete();
