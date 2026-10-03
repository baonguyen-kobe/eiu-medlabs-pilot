-- Preserve a historical Nursing Skills responsible lecturer only when an update
-- keeps that exact lecturer. New or changed assignments retain current checks.

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
  return new;
end;
$$;

revoke all
on function private.guard_equipment_request_responsible_assignment()
from public, anon, authenticated;

drop trigger if exists equipment_request_operational_responsible
on public.equipment_requests;

create trigger equipment_request_operational_responsible
before insert or update of responsible_lecturer_id
on public.equipment_requests
for each row
execute function private.guard_equipment_request_responsible_assignment();

create or replace function private.validate_equipment_request_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  skills_room_type_id constant uuid := '40000000-0000-0000-0000-000000000001'::uuid;
  basic_medical_room_type_id constant uuid := '40000000-0000-0000-0000-000000000002'::uuid;
  default_responsible_id uuid;
begin
  if new.semester not in ('HK1', 'HK2', 'HK3', 'HK4') then
    raise exception 'Học kỳ phải là HK1, HK2, HK3 hoặc HK4.' using errcode = '22023';
  end if;
  if length(coalesce(new.note, '')) > 2000 then
    raise exception 'Ghi chú không được vượt quá 2000 ký tự.' using errcode = '22023';
  end if;
  if length(coalesce(new.late_registration_reason, '')) > 1000 then
    raise exception 'Lý do đăng ký trễ không được vượt quá 1000 ký tự.' using errcode = '22023';
  end if;

  if new.request_domain = 'basic_medical' then
    select sessions.teaching_lecturer_id
    into default_responsible_id
    from public.basic_medical_registration_sessions as sessions
    where sessions.id = new.source_identity_id
      and sessions.class_schedule_id = new.class_schedule_id;

    if default_responsible_id is null then
      if tg_op = 'UPDATE' and new.class_schedule_id is null and old.status = 'cancelled' then
        default_responsible_id := old.responsible_lecturer_id;
      else
        raise exception 'BASIC_MEDICAL_SOURCE_INVALID' using errcode = '22023';
      end if;
    end if;
    if new.responsible_lecturer_id <> default_responsible_id
      and not ((select private.is_admin()) or (select private.can_manage_basic_medical())) then
      raise exception 'BASIC_MEDICAL_RESPONSIBLE_OVERRIDE_FORBIDDEN' using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.profiles as profiles
      where profiles.id = new.responsible_lecturer_id
        and profiles.is_active
        and exists (select 1 from public.user_roles as roles where roles.user_id = profiles.id and roles.role = 'lecturer')
        and exists (select 1 from public.profile_room_types as scopes where scopes.profile_id = profiles.id and scopes.room_type_id = basic_medical_room_type_id)
    ) then
      raise exception 'BASIC_MEDICAL_RESPONSIBLE_INVALID' using errcode = '22023';
    end if;
    return new;
  end if;

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

  if not exists (
    select 1 from public.profiles as profiles
    where profiles.id = new.responsible_lecturer_id
      and profiles.is_active
      and exists (select 1 from public.user_roles as roles where roles.user_id = profiles.id and roles.role = 'lecturer')
      and exists (select 1 from public.profile_room_types as scopes where scopes.profile_id = profiles.id and scopes.room_type_id = skills_room_type_id)
  ) then
    raise exception 'Giảng viên phụ trách không hợp lệ.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all
on function private.validate_equipment_request_content()
from public, anon, authenticated;


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
