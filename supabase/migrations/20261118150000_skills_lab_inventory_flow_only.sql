-- t2h: Skills lab requests move only through the inventory flow (Chuẩn bị,
-- Bàn giao / thu hồi). The manual status buttons and the request-level
-- signature stay for Basic Medical only. Owner decision 2026-11-18.
do $$
declare
  fn text;
  guard constant text := E'  if current_row.request_domain = ''nursing_skills'' then\n'
    || E'    raise exception ''EQUIPMENT_REQUEST_INVENTORY_FLOW_ONLY'' using errcode = ''42501'',\n'
    || E'      hint = ''Phiếu Skills lab ghi nhận qua Chuẩn bị và Bàn giao / thu hồi.'';\n'
    || E'  end if;\n';
  manager_anchor constant text := E'    raise exception ''EQUIPMENT_REQUEST_CANCELLED_TERMINAL'' using errcode = ''22023'';\n  end if;\n';
  signer_anchor constant text := E'    raise exception ''Chỉ Người đăng ký hoặc Giảng viên phụ trách được ký xác nhận.'' using errcode = ''42501'';\n  end if;\n';
begin
  fn := replace(pg_get_functiondef('public.manager_confirm_equipment_status(uuid,text)'::regprocedure), E'\r', '');
  if position(manager_anchor in fn) = 0 then
    raise exception 'manager_confirm_equipment_status changed; update t2h patch';
  end if;
  execute replace(fn, manager_anchor, manager_anchor || guard);

  fn := replace(pg_get_functiondef('public.registrant_confirm_equipment_handoff(uuid,text,text)'::regprocedure), E'\r', '');
  if position(signer_anchor in fn) = 0 then
    raise exception 'registrant_confirm_equipment_handoff changed; update t2h patch';
  end if;
  execute replace(fn, signer_anchor, signer_anchor || guard);
end;
$$;
