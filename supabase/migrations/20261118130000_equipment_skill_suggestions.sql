-- t4a: skill suggestions came from the first 1,000 request lines in name
-- order, so later names were dropped once there were more lines. This returns
-- the distinct names directly. security invoker: the caller sees the same
-- lines as before.
create or replace function public.list_equipment_skill_suggestions()
returns setof text
language sql
stable
security invoker
set search_path = ''
as $$
  select name from (
    select btrim(skill_name) as name, count(*) as uses
    from public.equipment_request_items
    where nullif(btrim(skill_name), '') is not null
    group by btrim(skill_name)
  ) used
  -- shortcut: the 1,000 most used names; a combobox needs no more.
  order by uses desc, name
  limit 1000;
$$;

revoke all on function public.list_equipment_skill_suggestions() from public, anon;
grant execute on function public.list_equipment_skill_suggestions() to authenticated;
