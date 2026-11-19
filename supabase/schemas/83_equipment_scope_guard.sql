-- Equipment scopes change only through set_equipment_item_scopes (independent
-- review 2026-11-19). The side policies let a manager update any column of a
-- row in their scope, so an ordinary edit could add or drop a side without the
-- RPC's in-use check and audit row. A new row belongs to exactly one side; the
-- RPC is the only way to share or move an item.

create or replace function private.equipment_items_scope_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.equipment_scope_change', true), '') = 'true' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if cardinality(new.usage_scopes) <> 1 then
      raise exception 'EQUIPMENT_SCOPE_RPC_ONLY' using errcode = '42501',
        hint = 'Thiết bị mới thuộc đúng một bên; Admin tick phạm vi ở Danh mục > Phạm vi thiết bị.';
    end if;
  elsif new.usage_scopes is distinct from old.usage_scopes then
    raise exception 'EQUIPMENT_SCOPE_RPC_ONLY' using errcode = '42501',
      hint = 'Đổi phạm vi thiết bị ở Danh mục > Phạm vi thiết bị.';
  end if;
  return new;
end;
$$;

drop trigger if exists equipment_items_scope_guard on public.equipment_items;
create trigger equipment_items_scope_guard
  before insert or update of usage_scopes on public.equipment_items
  for each row execute function private.equipment_items_scope_guard();

do $$
declare
  fn text;
  anchor constant text := E'  update public.equipment_items set usage_scopes = scopes where id = p_item_id;\n';
begin
  select replace(pg_get_functiondef('public.set_equipment_item_scopes(uuid,text[])'::regprocedure), E'\r', '') into fn;
  if position(anchor in fn) = 0 then
    raise exception 'set_equipment_item_scopes changed; update equipment_scope_guard';
  end if;
  execute replace(fn, anchor,
    E'  perform set_config(''app.equipment_scope_change'', ''true'', true);\n'
    || anchor
    || E'  perform set_config(''app.equipment_scope_change'', ''false'', true);\n');
end;
$$;
