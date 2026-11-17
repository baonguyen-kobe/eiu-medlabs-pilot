-- t2i: filter, search and page equipment requests in the database instead of
-- in the browser, so lists past the 1,000-row API cap stay complete.
-- security invoker: the caller's RLS decides which rows exist.
-- Returns one page of ids (newest first) plus the filtered total; the app
-- loads the rows by id. p_focus_id picks the page that holds that request.

create or replace function public.list_equipment_request_page(
  p_domains text[],
  p_mine boolean default false,
  p_query text default null,
  p_domain text default null,
  p_status text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_page integer default 1,
  p_page_size integer default 20,
  p_focus_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as (
    select r.id, r.created_at,
      row_number() over (order by r.created_at desc, r.id desc) as position
    from public.equipment_requests r
    left join public.class_schedules s on s.id = r.class_schedule_id
    left join public.rooms room on room.id = s.room_id
    left join public.profiles registrant on registrant.id = r.registrant_id
    left join public.profiles responsible on responsible.id = r.responsible_lecturer_id
    where r.request_domain::text = any(p_domains)
      and (not p_mine or (select auth.uid()) in (r.registrant_id, r.responsible_lecturer_id))
      and (p_domain is null or r.request_domain::text = p_domain)
      and (p_date_from is null or s.schedule_date >= p_date_from)
      and (p_date_to is null or s.schedule_date <= p_date_to)
      -- Mirrors getWarehouseStatus in components/equipment-request-list.tsx.
      and (p_status is null or p_status = case
        when r.status = 'cancelled' then 'cancelled'
        when r.status = 'completed'
          or (r.return_staff_confirmed_at is not null and r.return_recipient_signed_at is not null)
          then 'completed'
        when r.return_staff_confirmed_at is not null or r.status = 'returned' then 'returned'
        when r.handover_staff_confirmed_at is not null or r.status = 'handed_over' then 'handed_over'
        else r.status end)
      and (nullif(btrim(p_query), '') is null or concat_ws(' ',
        r.id::text, s.course_code_snapshot, s.course_name_snapshot,
        room.room_code, room.building_code, registrant.full_name, responsible.full_name,
        case r.request_domain::text when 'basic_medical' then 'Y cơ sở' else 'Kỹ năng Điều dưỡng' end
      ) ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ),
  bounds as (
    select greatest(1, least(coalesce(p_page_size, 20), 100)) as size,
      (select count(*) from filtered) as total,
      (select position from filtered where id = p_focus_id) as focus_position
  ),
  chosen as (
    select b.size, b.total, least(
      greatest(1, case when b.focus_position is not null
        then ((b.focus_position - 1) / b.size + 1)::integer
        else coalesce(p_page, 1) end),
      greatest(1, ((b.total + b.size - 1) / b.size)::integer)) as page
    from bounds b
  )
  select jsonb_build_object(
    'total', c.total,
    'page', c.page,
    'page_size', c.size,
    'ids', coalesce((
      select jsonb_agg(f.id order by f.position)
      from filtered f
      where f.position > (c.page - 1) * c.size and f.position <= c.page * c.size
    ), '[]'::jsonb)
  )
  from chosen c;
$$;

revoke all on function public.list_equipment_request_page(text[], boolean, text, text, text, date, date, integer, integer, uuid) from public, anon;
grant execute on function public.list_equipment_request_page(text[], boolean, text, text, text, date, date, integer, integer, uuid) to authenticated;
