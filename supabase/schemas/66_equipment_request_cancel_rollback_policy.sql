-- t2b owner policy (2026-11-17):
--   * a request can be cancelled only while it is Mới or Đã soạn;
--   * only an Admin may move a request back to an earlier status (no reason
--     required); each rollback is recorded in audit_logs.
-- Inventory-backed requests are still guarded by s4_guard_request_lifecycle:
-- their stock returns only through the preparation/fulfillment reversal.

create or replace function public.soft_cancel_equipment_request(
  target_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  req_row public.equipment_requests;
begin
  if actor_id is null or not (select private.is_active_user()) then
    raise exception 'UNAUTHORIZED' using errcode = '42501';
  end if;

  select * into req_row
  from public.equipment_requests
  where id = target_request_id
  for update;

  if req_row.id is null then
    return false;
  end if;

  if not (
    req_row.registrant_id = actor_id
    or req_row.created_by = actor_id
    or (select private.can_manage_equipment_request(target_request_id))
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if req_row.status = 'cancelled' then
    return true;
  end if;

  if req_row.status not in ('new', 'preparing') then
    raise exception 'EQUIPMENT_REQUEST_CANCEL_AFTER_HANDOVER'
      using errcode = '22023',
        hint = 'Phiếu đã giao không thể hủy. Admin cần lùi trạng thái (có lý do) trước.';
  end if;

  perform set_config('app.equipment_confirmation_rpc', 'true', true);

  update public.equipment_requests
  set status = 'cancelled'
  where id = target_request_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id)
  values (actor_id, 'equipment_request.cancelled', 'equipment_request', target_request_id);

  perform private.enqueue_equipment_request_outbox_event(target_request_id, 'deleted', actor_id);

  return true;
end;
$$;

revoke all on function public.soft_cancel_equipment_request(uuid) from public, anon;
grant execute on function public.soft_cancel_equipment_request(uuid) to authenticated;

-- Drops a three-argument draft of this migration that existed only locally.
drop function if exists public.manager_confirm_equipment_status(uuid, text, text);

create or replace function public.manager_confirm_equipment_status(
  target_request_id uuid,
  target_status text
)
returns public.equipment_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.equipment_requests;
  changed_row public.equipment_requests;
  actor_id uuid := (select auth.uid());
  current_rank integer;
  target_rank integer;
begin
  if actor_id is null or not (select private.is_active_user())
    or not ((select private.has_role('admin')) or (select private.has_role('staff'))) then
    raise exception 'Chỉ Admin hoặc Chuyên viên được chuyển trạng thái phiếu.' using errcode = '42501';
  end if;
  if target_status not in ('new','preparing','handed_over','returned','completed') then
    raise exception 'Trạng thái phiếu không hợp lệ.' using errcode = '22023';
  end if;

  select * into current_row from public.equipment_requests
  where id = target_request_id for update;
  if current_row.id is null then
    raise exception 'Không tìm thấy phiếu thiết bị.' using errcode = 'P0002';
  end if;
  if not (select private.can_manage_equipment_request(target_request_id)) then
    raise exception 'EQUIPMENT_REQUEST_SCOPE_REQUIRED' using errcode = '42501';
  end if;
  if current_row.status = 'cancelled' then
    raise exception 'EQUIPMENT_REQUEST_CANCELLED_TERMINAL' using errcode = '22023';
  end if;
  current_rank := case current_row.status
    when 'new' then 0 when 'preparing' then 1 when 'handed_over' then 2
    when 'returned' then 3 when 'completed' then 4 end;
  target_rank := case target_status
    when 'new' then 0 when 'preparing' then 1 when 'handed_over' then 2
    when 'returned' then 3 when 'completed' then 4 end;
  perform set_config('app.equipment_confirmation_rpc', 'true', true);

  if target_rank < current_rank then
    if not (select private.has_role('admin')) then
      raise exception 'EQUIPMENT_REQUEST_ROLLBACK_ADMIN_ONLY'
        using errcode = '42501', hint = 'Chỉ Admin được lùi trạng thái phiếu.';
    end if;
    update public.equipment_requests
    set status = target_status,
        handover_staff_confirmed_by = case when target_rank >= 2 then handover_staff_confirmed_by else null end,
        handover_staff_confirmed_at = case when target_rank >= 2 then handover_staff_confirmed_at else null end,
        handover_signature_path = case when target_rank >= 2 then handover_signature_path else null end,
        handover_recipient_signed_at = case when target_rank >= 2 then handover_recipient_signed_at else null end,
        handover_effective_at = case when target_rank >= 2 then handover_effective_at else null end,
        return_staff_confirmed_by = null,
        return_staff_confirmed_at = null,
        return_signature_path = null,
        return_recipient_signed_at = null,
        return_effective_at = null
    where id = target_request_id returning * into changed_row;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (actor_id, 'equipment_request.status_rolled_back', 'equipment_request', target_request_id,
      jsonb_build_object('from', current_row.status, 'to', target_status));
    return changed_row;
  end if;

  if target_status = current_row.status
    and target_status not in ('handed_over','returned') then
    return current_row;
  end if;
  if target_status = 'preparing' then
    update public.equipment_requests set status = 'preparing'
    where id = target_request_id returning * into changed_row;
  elsif target_status = 'handed_over' then
    if current_row.status = 'new' then
      raise exception 'Phải chuyển phiếu sang Đã soạn trước khi xác nhận Đã giao.' using errcode = '22023';
    end if;
    update public.equipment_requests
    set handover_staff_confirmed_by = actor_id,
        handover_staff_confirmed_at = clock_timestamp(),
        status = case when handover_signature_path is not null then 'handed_over' else status end
    where id = target_request_id returning * into changed_row;
  elsif target_status = 'returned' then
    if current_row.status not in ('handed_over','returned') then
      raise exception 'Phải xác nhận đã giao trước khi xác nhận trả.' using errcode = '22023';
    end if;
    update public.equipment_requests
    set return_staff_confirmed_by = actor_id,
        return_staff_confirmed_at = clock_timestamp(),
        status = case when return_signature_path is not null then 'completed' else status end
    where id = target_request_id returning * into changed_row;
  else
    raise exception 'Trạng thái Hoàn thành chỉ được tạo khi đủ hai xác nhận trả.' using errcode = '22023';
  end if;
  return changed_row;
end;
$$;

revoke execute on function public.manager_confirm_equipment_status(uuid, text)
from public, anon;
grant execute on function public.manager_confirm_equipment_status(uuid, text)
to authenticated;
