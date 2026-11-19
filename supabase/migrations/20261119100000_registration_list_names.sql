-- Phiếu Y cơ sở list: the security-invoker view inner-joined profiles for the
-- registrant and responsible names. profiles RLS shows a lecturer only their
-- own profile, so a registration filed by a coordinator or Admin on the
-- lecturer's behalf vanished from the lecturer's list while its detail page
-- still opened (found 2026-11-19 walking the Y cơ sở flow on localhost).
--
-- Names now come from a definer helper that returns only full_name, the same
-- fact list_active_people already gives every signed-in user. Row access is
-- still decided by basic_medical_registrations RLS.

create or replace function private.person_full_name(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profiles.full_name from public.profiles where profiles.id = p_profile_id;
$$;

revoke all on function private.person_full_name(uuid) from public, anon;
grant execute on function private.person_full_name(uuid) to authenticated, service_role;

create or replace view public.basic_medical_registration_list
with (security_invoker = true)
as
select registrations.id,
       registrations.created_at,
       registrations.start_date,
       registrations.end_date,
       registrations.academic_year,
       registrations.semester,
       registrations.student_count,
       courses.course_code,
       courses.course_name,
       rooms.room_code,
       rooms.building_code,
       rooms.room_name,
       names.registrant_name,
       names.responsible_name,
       completion.session_count,
       completion.confirmed_session_count,
       completion.is_completed,
       concat_ws(
         ' ', registrations.registration_code,
         courses.course_code, courses.course_name,
         rooms.room_code, rooms.building_code, rooms.room_name,
         names.registrant_name, names.responsible_name
       ) as search_text,
       registrations.registration_code,
       registrations.cancelled_at,
       registrations.cancelled_by,
       registrations.cancel_reason
from public.basic_medical_registrations as registrations
join public.courses on courses.id = registrations.course_id
join public.rooms on rooms.id = registrations.room_id
cross join lateral (
  select private.person_full_name(registrations.registrant_id) as registrant_name,
         private.person_full_name(registrations.responsible_lecturer_id) as responsible_name
) as names
left join public.basic_medical_registration_completion as completion
  on completion.registration_id = registrations.id;

grant select on public.basic_medical_registration_list to authenticated, service_role;

notify pgrst, 'reload schema';
