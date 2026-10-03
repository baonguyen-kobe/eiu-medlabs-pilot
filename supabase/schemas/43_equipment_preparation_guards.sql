-- Preserve current read scope while hiding removed rows from legacy active editors.
drop policy if exists equipment_items_manage on public.equipment_request_items;
drop policy if exists equipment_items_select on public.equipment_request_items;
create policy equipment_items_select on public.equipment_request_items for select to authenticated using(removed_at is null and private.can_read_preparation(request_id));
revoke insert,update,delete on public.equipment_request_items from authenticated;
revoke insert,update,delete on public.equipment_requests from authenticated;

create or replace function private.s4_guard_request_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
declare p public.equipment_preparations;
begin
 if tg_op='DELETE' then
  if exists(select 1 from public.equipment_preparations where request_id=old.id) then raise exception 'S4_REQUEST_HISTORY_IMMUTABLE' using errcode='42501'; end if;
  return old;
 end if;
 if row(new.class_schedule_id,new.receive_at,new.return_at,new.responsible_lecturer_id,new.note) is distinct from row(old.class_schedule_id,old.receive_at,old.return_at,old.responsible_lecturer_id,old.note) then
  new.preparation_revision:=old.preparation_revision+1;
 end if;
 if old.request_domain<>'nursing_skills' then return new; end if;
 select * into p from public.equipment_preparations where request_id=old.id and state in ('draft','prepared','reversing');
 if new.status is distinct from old.status then
  if new.status='preparing' and (coalesce(current_setting('app.s4_command',true),'')<>'true' or not exists(select 1 from public.equipment_preparations where request_id=old.id and state='prepared')) then raise exception 'S4_CONFIRM_PREPARATION_REQUIRED'; end if;
  if new.status in ('handed_over','returned','completed') and exists(select 1 from public.equipment_preparations where request_id=old.id) then raise exception 'S5_NOT_AUTHORIZED'; end if;
  if new.status in ('new','cancelled') and p.id is not null then
   if p.state in ('prepared','reversing') or exists(select 1 from public.equipment_preparation_transfers t where t.preparation_id=p.id and t.compensates_id is null and t.quantity>coalesce((select sum(c.quantity) from public.equipment_preparation_transfers c where c.compensates_id=t.id),0)) then raise exception 'S4_STRICT_REVERSAL_REQUIRED'; end if;
   if new.status='cancelled' then update public.equipment_preparations set state='cancelled',lock_holder=null,lock_token=null,lock_expires_at=null where id=p.id; end if;
  end if;
 end if;
 return new;
end; $$;
drop trigger if exists equipment_requests_s4_lifecycle on public.equipment_requests;
create trigger equipment_requests_s4_lifecycle before update or delete on public.equipment_requests for each row execute function private.s4_guard_request_lifecycle();
revoke all on function private.s4_guard_request_lifecycle() from public,anon,authenticated;
create or replace function private.s4_guard_class_schedule_source()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.course_code_snapshot,new.course_name_snapshot,new.room_id,new.schedule_date,new.start_time,new.end_time,new.semester)
    is distinct from (old.course_code_snapshot,old.course_name_snapshot,old.room_id,old.schedule_date,old.start_time,old.end_time,old.semester)
    and (select private.class_schedule_has_equipment_request(old.id)) then
  raise exception 'CLASS_EQUIPMENT_REQUEST_EXISTS' using errcode='42501';
 end if;
 return new;
end; $$;
drop trigger if exists class_schedules_s4_equipment_lock on public.class_schedules;
create trigger class_schedules_s4_equipment_lock before update on public.class_schedules for each row execute function private.s4_guard_class_schedule_source();
revoke all on function private.s4_guard_class_schedule_source() from public,anon,authenticated;

create or replace function public.remove_equipment_request_item(target_item_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; ln public.equipment_request_items;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 if not private.is_active_user() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into ln from public.equipment_request_items where id=target_item_id and removed_at is null;
 select * into r from public.equipment_requests where id=ln.request_id for update;
 if not found or not(r.registrant_id=auth.uid() or private.can_manage_equipment_request(r.id)) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if r.status<>'new' and r.request_domain='nursing_skills' then raise exception 'S4_USE_QUANTITY_ADJUSTMENT'; end if;
 if r.status not in ('new','preparing') then raise exception 'EQUIPMENT_REQUEST_NOT_EDITABLE'; end if;
 update public.equipment_request_items set removed_at=clock_timestamp() where id=ln.id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'equipment_request.item_removed','equipment_request',r.id,jsonb_build_object('item_id',ln.id));
 return true;
end; $$;
revoke all on function public.remove_equipment_request_item(uuid) from public,anon;
grant execute on function public.remove_equipment_request_item(uuid) to authenticated;

create or replace function public.add_equipment_request_item(target_request_id uuid,target_skill_name text,target_catalog_item_id uuid,target_quantity integer,target_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; item_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 if not private.is_active_user() or not private.can_manage_equipment_request(target_request_id) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select * into r from public.equipment_requests where id=target_request_id for update;
 if r.status<>'new' or r.request_domain<>'nursing_skills' then raise exception 'S4_USE_QUANTITY_ADJUSTMENT'; end if;
 if target_quantity is null or target_quantity not between 1 and 9999 or nullif(btrim(target_skill_name),'') is null then raise exception 'INVALID_QUANTITY'; end if;
 if not exists(select 1 from public.equipment_catalog where id=target_catalog_item_id and is_active) then raise exception 'CATALOG_ITEM_INACTIVE_OR_MISSING'; end if;
 if not exists(select 1 from public.equipment_request_items where request_id=r.id and skill_name=btrim(target_skill_name) and removed_at is null) then raise exception 'SKILL_NOT_FOUND_IN_REQUEST'; end if;
 perform set_config('app.s4_registration','',true);
 insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,quantity,note) values(r.id,btrim(target_skill_name),target_catalog_item_id,target_quantity,nullif(btrim(target_note),'')) returning id into item_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata) values(auth.uid(),'equipment_request.item_added','equipment_request',r.id,jsonb_build_object('item_id',item_id,'quantity',target_quantity));
 return item_id;
end; $$;
revoke all on function public.add_equipment_request_item(uuid,text,uuid,integer,text) from public,anon;
grant execute on function public.add_equipment_request_item(uuid,text,uuid,integer,text) to authenticated;

create or replace function private.guard_equipment_request_item_commercial_name()
returns trigger language plpgsql security definer set search_path='' as $$
declare domain public.equipment_request_domain; commercial text;
begin
 if new.removed_at is not null then return new; end if;
 select request_domain into domain from public.equipment_requests where id=new.request_id for update;
 if domain='nursing_skills' then select lower(btrim(commercial_name)) into commercial from public.equipment_catalog where id=new.catalog_item_id;
 else select lower(btrim(commercial_name)) into commercial from public.basic_medical_equipment_catalog where id=new.basic_medical_catalog_item_id; end if;
 if commercial is null or commercial='' then return new; end if;
 if exists(select 1 from public.equipment_request_items e left join public.equipment_catalog c on c.id=e.catalog_item_id left join public.basic_medical_equipment_catalog b on b.id=e.basic_medical_catalog_item_id where e.request_id=new.request_id and e.removed_at is null and e.id<>new.id and lower(btrim(e.skill_name))=lower(btrim(new.skill_name)) and lower(btrim(case when domain='nursing_skills' then c.commercial_name else b.commercial_name end))=commercial) then raise exception 'EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY' using errcode='22023'; end if;
 return new;
end; $$;
revoke all on function private.guard_equipment_request_item_commercial_name() from public,anon,authenticated;
