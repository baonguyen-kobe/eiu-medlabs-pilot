-- Room-type scopes are assigned explicitly by personnel configuration.
-- Preserve all existing memberships; do not backfill or infer scopes from roles.
drop trigger if exists profiles_assign_default_room_type on public.profiles;
drop function if exists private.assign_default_room_type();

create or replace function private.has_room_type(target_room_type_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_active_user()) and (
    (select private.has_role('admin'))
    or exists (
      select 1
      from public.profile_room_types as assignments
      join public.user_roles as roles on roles.user_id = assignments.profile_id
      where assignments.profile_id = (select auth.uid())
        and assignments.room_type_id = target_room_type_id
    )
  );
$$;
