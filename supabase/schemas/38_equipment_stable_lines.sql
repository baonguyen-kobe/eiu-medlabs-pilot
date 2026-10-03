-- Stable shared request identity; Basic Medical remains outside Inventory preparation.
create or replace function private.s4_guard_line()
returns trigger language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; changed boolean;
begin
 if tg_op='DELETE' then
  if private.can_hard_delete() and not exists(select 1 from public.equipment_preparations where request_id=old.request_id) then return old; end if;
  raise exception 'S4_LINE_HISTORY_IMMUTABLE' using errcode='42501';
 end if;
 select * into r from public.equipment_requests where id=new.request_id for update;
 if tg_op='UPDATE' then
  if new.id<>old.id or new.request_id<>old.request_id or new.registered_quantity<>old.registered_quantity or new.baseline_source<>old.baseline_source then raise exception 'S4_REGISTERED_BASELINE_IMMUTABLE' using errcode='42501'; end if;
  if new.planned_quantity is distinct from old.planned_quantity
     and coalesce(current_setting('app.s4_command',true),'')<>'true' then
   raise exception 'S4_USE_QUANTITY_ADJUSTMENT' using errcode='42501';
  end if;
  changed:=row(new.skill_name,new.catalog_item_id,new.basic_medical_catalog_item_id,new.quantity,new.note,new.removed_at) is distinct from row(old.skill_name,old.catalog_item_id,old.basic_medical_catalog_item_id,old.quantity,old.note,old.removed_at);
  if changed then
   if r.request_domain='nursing_skills'
      and row(new.catalog_item_id,new.quantity,new.removed_at) is distinct from row(old.catalog_item_id,old.quantity,old.removed_at)
      and coalesce(current_setting('app.s4_command',true),'')<>'true' then
    raise exception 'S4_USE_QUANTITY_ADJUSTMENT' using errcode='42501';
   end if;
   if r.request_domain='nursing_skills' and r.status<>'new' and coalesce(current_setting('app.s4_command',true),'')<>'true' then raise exception 'S4_USE_QUANTITY_ADJUSTMENT' using errcode='42501'; end if;
   if new.skill_name<>old.skill_name and exists(select 1 from public.equipment_preparations p where p.request_id=r.id and p.state='draft' and p.lock_expires_at>clock_timestamp()) then raise exception 'S4_ACTIVITY_LOCKED_DURING_PREPARATION' using errcode='42501'; end if;
   new.line_revision:=old.line_revision+1;
  else new.line_revision:=old.line_revision;
  end if;
 else
  if r.request_domain='nursing_skills'
     and coalesce(current_setting('app.s4_registration',true),'')<>new.request_id::text
     and coalesce(current_setting('app.s4_command',true),'')<>'true' then
   raise exception 'S4_USE_QUANTITY_ADJUSTMENT' using errcode='42501';
  end if;
  if r.request_domain='nursing_skills' and r.status<>'new' and coalesce(current_setting('app.s4_command',true),'')<>'true' then raise exception 'S4_USE_QUANTITY_ADJUSTMENT' using errcode='42501'; end if;
  if coalesce(current_setting('app.s4_registration',true),'')=new.request_id::text then
   new.registered_quantity:=new.quantity; new.planned_quantity:=new.quantity; new.baseline_source:='registration';
  else new.registered_quantity:=0; new.planned_quantity:=0; new.baseline_source:='added'; end if;
  changed:=true;
 end if;
 if changed then
  update public.equipment_requests set preparation_revision=preparation_revision+1 where id=new.request_id;
 end if;
 return new;
end; $$;
create trigger equipment_items_s4_identity before insert or update or delete on public.equipment_request_items for each row execute function private.s4_guard_line();

create or replace function private.s4_begin_registration()
returns trigger language plpgsql security definer set search_path='' as $$
begin perform set_config('app.s4_registration',new.id::text,true); return new; end; $$;
create trigger equipment_requests_s4_registration after insert on public.equipment_requests for each row execute function private.s4_begin_registration();

create or replace function private.s4_sync_lines(p_request uuid,p_items jsonb,p_basic_skill text default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.equipment_requests; j jsonb; item_id uuid; seen uuid[]:='{}'; old_line public.equipment_request_items;
begin
 select * into r from public.equipment_requests where id=p_request for update;
 if not private.is_active_user() or not (r.registrant_id=auth.uid() or private.can_manage_equipment_request(r.id)) then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 500 then raise exception 'EQUIPMENT_REQUEST_ITEMS_REQUIRED' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) entry where (entry->>'expected_revision')::bigint is distinct from r.preparation_revision) then raise exception 'STALE_REVISION' using errcode='23505'; end if;
 if r.status not in ('new','preparing') or (r.request_domain='nursing_skills' and r.status<>'new') then raise exception 'S4_USE_QUANTITY_ADJUSTMENT' using errcode='42501'; end if;
 perform set_config('app.s4_registration','',true);
 -- Remove excluded identities before inserting replacements, so the old
 -- commercial-name guard cannot mistake a tombstone for an active duplicate.
 update public.equipment_request_items l set removed_at=clock_timestamp()
 where l.request_id=p_request and l.removed_at is null
   and not exists(select 1 from jsonb_array_elements(p_items) entry where nullif(entry->>'id','')::uuid=l.id);
 for j in select value from jsonb_array_elements(p_items) loop
  if (j->>'quantity')::integer<1 then raise exception 'INVALID_QUANTITY' using errcode='22023'; end if;
  item_id:=nullif(j->>'id','')::uuid;
  if item_id is not null then
   select * into old_line from public.equipment_request_items where id=item_id and request_id=p_request and removed_at is null;
   if not found or item_id=any(seen) then raise exception 'S4_INVALID_LINE_ID' using errcode='22023'; end if;
   update public.equipment_request_items set skill_name=coalesce(p_basic_skill,btrim(j->>'skill_name')),catalog_item_id=case when r.request_domain='nursing_skills' then (j->>'catalog_item_id')::uuid end,basic_medical_catalog_item_id=case when r.request_domain='basic_medical' then (j->>'catalog_item_id')::uuid end,quantity=(j->>'quantity')::integer,note=nullif(btrim(j->>'note'),'') where id=item_id;
  else
   insert into public.equipment_request_items(request_id,skill_name,catalog_item_id,basic_medical_catalog_item_id,quantity,note)
   values(p_request,coalesce(p_basic_skill,btrim(j->>'skill_name')),case when r.request_domain='nursing_skills' then (j->>'catalog_item_id')::uuid end,case when r.request_domain='basic_medical' then (j->>'catalog_item_id')::uuid end,(j->>'quantity')::integer,nullif(btrim(j->>'note'),'')) returning id into item_id;
  end if;
  seen:=array_append(seen,item_id);
 end loop;
end; $$;
revoke all on function private.s4_guard_line(),private.s4_begin_registration(),private.s4_sync_lines(uuid,jsonb,text) from public,anon,authenticated;

create or replace function private.s4_add_line(p_request uuid,p_line uuid,p_catalog uuid,p_skill text,p_quantity integer,p_note text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_line is null or p_quantity is null or p_quantity<1
    or not exists(select 1 from public.equipment_catalog where id=p_catalog and is_active)
    or not exists(select 1 from public.equipment_request_items where request_id=p_request and removed_at is null and skill_name=p_skill)
    or exists(select 1 from public.equipment_request_items where id=p_line) then
  raise exception 'S4_INVALID_ADDED_LINE' using errcode='22023';
 end if;
 perform set_config('app.s4_registration','',true);
 insert into public.equipment_request_items(id,request_id,catalog_item_id,skill_name,quantity,note)
 values(p_line,p_request,p_catalog,p_skill,p_quantity,nullif(btrim(p_note),''));
end; $$;

create or replace function private.s4_snapshot_line()
returns trigger language plpgsql security definer set search_path='' as $$
declare catalog jsonb;
begin
 if tg_op='UPDATE' and row(new.skill_name,new.catalog_item_id,new.basic_medical_catalog_item_id,new.quantity,new.planned_quantity,new.note,new.removed_at)
    is not distinct from row(old.skill_name,old.catalog_item_id,old.basic_medical_catalog_item_id,old.quantity,old.planned_quantity,old.note,old.removed_at) then return new; end if;
 if new.catalog_item_id is not null then
  select to_jsonb(c) into catalog from public.equipment_catalog c where c.id=new.catalog_item_id;
 else
  select to_jsonb(c) into catalog from public.basic_medical_equipment_catalog c where c.id=new.basic_medical_catalog_item_id;
 end if;
 insert into public.equipment_preparation_events(request_id,operation,actor_id,revision,payload)
 values(new.request_id,case when tg_op='INSERT' then 'line_registered' else 'line_changed' end,auth.uid(),
   (select preparation_revision from public.equipment_requests where id=new.request_id),
   jsonb_build_object('before',case when tg_op='UPDATE' then to_jsonb(old) else null end,'after',to_jsonb(new),'catalog_snapshot',catalog));
 return new;
end; $$;
create trigger equipment_items_s4_snapshot after insert or update on public.equipment_request_items for each row execute function private.s4_snapshot_line();
revoke all on function private.s4_add_line(uuid,uuid,uuid,text,integer,text),private.s4_snapshot_line() from public,anon,authenticated;
