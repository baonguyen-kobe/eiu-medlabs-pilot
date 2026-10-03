-- S4 operational settings are distinct from the existing 24-hour registration rule.
create table public.equipment_preparation_settings (
  setting_key text primary key default 'primary' check (setting_key='primary'),
  revision bigint not null default 1,
  warning_lead_minutes integer not null default 120 check (warning_lead_minutes between 1 and 10080),
  inactivity_minutes integer not null default 15 check (inactivity_minutes between 1 and 120),
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.equipment_preparation_settings(setting_key) values ('primary');
alter table public.equipment_preparation_settings enable row level security;
revoke all on public.equipment_preparation_settings from public,anon,authenticated;

create or replace function private.s4_lock_inactivity()
returns interval language sql stable security definer set search_path='' as $$
 select make_interval(mins=>inactivity_minutes) from public.equipment_preparation_settings where setting_key='primary';
$$;
revoke all on function private.s4_lock_inactivity() from public,anon,authenticated;

create or replace function public.equipment_preparation_settings_command(p_expected_revision bigint,p_warning_lead_minutes integer,p_inactivity_minutes integer,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare before_row public.equipment_preparation_settings; after_row public.equipment_preparation_settings;
begin
 if not private.is_inventory_admin() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 if p_warning_lead_minutes is null or p_warning_lead_minutes not between 1 and 10080 or p_inactivity_minutes is null or p_inactivity_minutes not between 1 and 120 or nullif(btrim(p_reason),'') is null or length(p_reason)>1000 then raise exception 'S4_INVALID_SETTINGS' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 select * into before_row from public.equipment_preparation_settings where setting_key='primary' for update;
 if p_expected_revision is distinct from before_row.revision then raise exception 'STALE_REVISION' using errcode='23505'; end if;
 update public.equipment_preparation_settings set revision=revision+1,warning_lead_minutes=p_warning_lead_minutes,inactivity_minutes=p_inactivity_minutes,updated_by=auth.uid(),updated_at=clock_timestamp() where setting_key='primary' returning * into after_row;
 insert into public.audit_logs(actor_id,action,entity_type,old_data,new_data,metadata) values(auth.uid(),'equipment_preparation_settings_changed','equipment_preparation_settings',to_jsonb(before_row),to_jsonb(after_row),jsonb_build_object('reason',btrim(p_reason)));
 return jsonb_build_object('revision',after_row.revision,'warning_lead_minutes',after_row.warning_lead_minutes,'inactivity_minutes',after_row.inactivity_minutes);
end; $$;

create or replace function public.equipment_preparation_operations_read(p_resource text default 'queue',p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare settings jsonb; lead_minutes integer; page integer; search_text text; status_filter text; sort_order text; rows jsonb; total bigint;
begin
 if not private.can_access_inventory() then raise exception 'AUTH_DENIED' using errcode='42501'; end if;
 select jsonb_build_object('revision',s.revision,'warning_lead_minutes',s.warning_lead_minutes,'inactivity_minutes',s.inactivity_minutes),s.warning_lead_minutes into settings,lead_minutes from public.equipment_preparation_settings s where setting_key='primary';
 if p_resource='settings' then return settings; end if;
 if p_resource is distinct from 'queue' or jsonb_typeof(p_filters) is distinct from 'object' then raise exception 'S4_INVALID_FILTER' using errcode='22023'; end if;
 page:=coalesce((p_filters->>'page')::integer,1); search_text:=coalesce(btrim(p_filters->>'search'),''); status_filter:=coalesce(p_filters->>'status','new'); sort_order:=coalesce(p_filters->>'sort','priority');
 if page not between 1 and 100000 or length(search_text)>120 or status_filter not in ('new','preparing','all') or sort_order not in ('priority','pickup','class') then raise exception 'S4_INVALID_FILTER' using errcode='22023'; end if;
 with scoped as (
  select r.id,r.status,r.receive_at,(s.schedule_date+s.start_time) at time zone 'Asia/Ho_Chi_Minh' class_at,s.course_code_snapshot course_code,s.course_name_snapshot course_name,s.class_code,
   p.id preparation_id,p.state preparation_state,p.primary_preparer,pr.full_name primary_preparer_name,
   (r.status='new' and r.receive_at<=now()+make_interval(mins=>lead_minutes)) overdue
  from public.equipment_requests r join public.class_schedules s on s.id=r.class_schedule_id
  left join public.equipment_preparations p on p.request_id=r.id and p.state in ('draft','prepared','reversing')
  left join public.profiles pr on pr.id=p.primary_preparer
  where r.request_domain='nursing_skills' and r.status in ('new','preparing') and private.can_manage_equipment_request(r.id)
   and (status_filter='all' or r.status=status_filter)
   and (search_text='' or strpos(lower(concat_ws(' ',s.course_code_snapshot,s.course_name_snapshot,s.class_code,r.id::text)),lower(search_text))>0)
 ), page_rows as (
  select * from scoped order by case when sort_order='priority' then overdue end desc,
   case when sort_order in ('priority','pickup') then receive_at end asc,
   class_at asc,id asc limit 30 offset (page-1)*30
 )
 select (select count(*) from scoped),coalesce((select jsonb_agg(to_jsonb(x)-'preparation_id'||jsonb_build_object('health',case when x.preparation_id is null then '[]'::jsonb else private.s4_health(x.preparation_id) end) order by case when sort_order='priority' then x.overdue end desc,case when sort_order in ('priority','pickup') then x.receive_at end asc,x.class_at,x.id) from page_rows x),'[]'::jsonb) into total,rows;
 return jsonb_build_object('rows',rows,'total',total,'page',page,'page_size',30,'admin',private.is_inventory_admin(),'settings',settings);
end; $$;
revoke all on function public.equipment_preparation_operations_read(text,jsonb),public.equipment_preparation_settings_command(bigint,integer,integer,text) from public,anon;
grant execute on function public.equipment_preparation_operations_read(text,jsonb),public.equipment_preparation_settings_command(bigint,integer,integer,text) to authenticated;

-- Immutable semantic event prevents repeats across scheduler runs and transactions.
-- Inactivity changes are irrelevant to warnings: only pickup and warning lead participate.
create table public.equipment_preparation_warning_events (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.equipment_requests(id) on delete restrict,
 pickup_at timestamptz not null,
 warning_lead_minutes integer not null,
 settings_revision bigint not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(request_id,pickup_at,warning_lead_minutes)
);
alter table public.equipment_preparation_warning_events enable row level security;
revoke all on public.equipment_preparation_warning_events from public,anon,authenticated;
create trigger equipment_preparation_warning_immutable before update or delete on public.equipment_preparation_warning_events for each row execute function private.s4_immutable();
create index equipment_requests_preparation_pickup on public.equipment_requests(receive_at,id) where request_domain='nursing_skills' and status='new';
create or replace function private.s4_warn_near_pickup()
returns integer language plpgsql security definer set search_path='' as $$
declare config public.equipment_preparation_settings; r public.equipment_requests; event_id uuid; notified integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
 select * into config from public.equipment_preparation_settings where setting_key='primary';
 for r in select requests.* from public.equipment_requests requests
  where requests.request_domain='nursing_skills' and requests.status='new'
   and requests.receive_at<=now()+make_interval(mins=>config.warning_lead_minutes)
   and not exists(select 1 from public.equipment_preparation_warning_events e where e.request_id=requests.id and e.pickup_at=requests.receive_at and e.warning_lead_minutes=config.warning_lead_minutes)
  order by requests.receive_at,requests.id limit 100 for update of requests
 loop
  insert into public.equipment_preparation_warning_events(request_id,pickup_at,warning_lead_minutes,settings_revision) values(r.id,r.receive_at,config.warning_lead_minutes,config.revision) on conflict do nothing returning id into event_id;
  if event_id is not null then
   insert into public.equipment_preparation_events(request_id,operation,revision,payload) values(r.id,'near_pickup_unprepared',r.preparation_revision,jsonb_build_object('event_id',event_id,'pickup_at',r.receive_at,'warning_lead_minutes',config.warning_lead_minutes,'settings_revision',config.revision));
   perform private.notify_equipment_request_recipients(r.id,'near_pickup_unprepared','Phiếu thiết bị sắp đến giờ nhận chưa chuẩn bị','Vui lòng rà soát và hoàn tất chuẩn bị thiết bị. Phiếu vẫn ở trạng thái Mới.',false,true,null,jsonb_build_object('event_id',event_id,'pickup_at',r.receive_at,'warning_lead_minutes',config.warning_lead_minutes,'preparation_href','/equipment/preparation/'||r.id));
   notified:=notified+1;
  end if;
 end loop;
 return notified;
end; $$;
revoke all on function private.s4_warn_near_pickup() from public,anon,authenticated;
select cron.schedule('medlabs-s4-near-pickup','* * * * *','select private.s4_warn_near_pickup();');
