create or replace function private.p1_register(p_manifest jsonb,p_pilot jsonb,p_evidence text)
returns public.inventory_pilot_scopes language plpgsql security definer set search_path='' as $$
declare s public.inventory_pilot_scopes; m jsonb:=p_manifest; j jsonb; item public.inventory_catalog_items; loc public.inventory_storage_locations; u record; actors uuid[]; admin uuid; staff uuid[]; asset_item uuid; writer text;
begin
 s.id:=(m->>'scope_id')::uuid; s.project_ref:=m->>'target_project_ref'; s.scope_version:=(m->>'scope_version')::bigint; s.manifest_id:=(m->>'manifest_id')::uuid;
 s.synthetic:=(m->>'synthetic')::boolean;
 s.manifest_hash:=encode(extensions.digest(convert_to(m::text,'UTF8'),'sha256'),'hex');
 if m->'synthetic'='false'::jsonb then
  perform private.p1_owner_approval(s);
 elsif jsonb_typeof(m) is distinct from 'object' or m->'synthetic' is distinct from 'true'::jsonb or m->>'dataset_kind' is distinct from 'mock' or m->'real_activation' is distinct from 'false'::jsonb
  or coalesce(m->>'scope_code','')!~'^P1-MOCK-[A-Z0-9]+(-[A-Z0-9]+)*$' then raise exception 'P1_MOCK_MANIFEST_REQUIRED' using errcode='42501'; end if;
 if m->>'target_project_ref' is distinct from 'kwpyukofofoaqhmxndlc'
  or m#>>'{workflow,domain}' is distinct from 'nursing_skills' or m#>>'{workflow,admission}' is distinct from 'new requests only' or m#>'{workflow,legacy_obligations}' is distinct from '[]'::jsonb then raise exception 'P1_MANIFEST_SCOPE_MISMATCH' using errcode='42501'; end if;
 if jsonb_typeof(m->'users') is distinct from 'array' or jsonb_array_length(m->'users')<>3 or jsonb_typeof(m->'items') is distinct from 'array' or jsonb_array_length(m->'items')<>4
  or jsonb_typeof(m#>'{opening_payload,lines}') is distinct from 'array'
  or (s.synthetic and jsonb_array_length(m#>'{opening_payload,lines}')<>6)
  or jsonb_array_length(m#>'{opening_payload,lines}')<3 then raise exception 'P1_MANIFEST_SHAPE_MISMATCH' using errcode='42501'; end if;
 select array_agg((value->>'id')::uuid order by ordinality),max((value->>'id')) filter(where value->>'role'='admin'),array_agg((value->>'id')::uuid order by ordinality) filter(where value->>'role'='staff') into actors,admin,staff from jsonb_array_elements(m->'users') with ordinality;
 if cardinality(staff) is distinct from 2 or admin is null or (select count(distinct x) from unnest(actors) x)<>3 or auth.uid() is distinct from admin or not private.is_inventory_admin() then raise exception 'P1_ACTOR_DENIED' using errcode='42501'; end if;
 for j in select value from jsonb_array_elements(m->'users') loop
  select p.is_active,a.email,a.encrypted_password,a.raw_app_meta_data into u from public.profiles p join auth.users a on a.id=p.id where p.id=(j->>'id')::uuid;
  if not found or not u.is_active or u.email is distinct from j->>'email'
   or not exists(select 1 from public.user_roles where user_id=(j->>'id')::uuid and role::text=j->>'role') then raise exception 'P1_ACTOR_DENIED' using errcode='42501'; end if;
  if s.synthetic then
   if u.email not like '%@%.invalid' or nullif(u.encrypted_password,'') is not null
    or u.raw_app_meta_data->'synthetic' is distinct from 'true'::jsonb or (u.raw_app_meta_data->>'mock_scope_id')::uuid is distinct from s.id
    or j->'synthetic' is distinct from 'true'::jsonb or j->'interactive_login' is distinct from 'false'::jsonb then raise exception 'P1_SYNTHETIC_ACTOR_MISMATCH' using errcode='42501'; end if;
  elsif u.email like '%@%.invalid' or u.raw_app_meta_data->'synthetic'='true'::jsonb or j->'synthetic' is distinct from 'false'::jsonb then
   raise exception 'P1_REAL_ACTOR_MISMATCH' using errcode='42501';
  end if;
 end loop;
 select * into loc from public.inventory_storage_locations where id=(m#>>'{location,id}')::uuid;
 if loc.id is null or not loc.active or loc.code is distinct from m#>>'{location,code}' or loc.name is distinct from m#>>'{location,name}'
  or (s.synthetic and (loc.code not like (m->>'scope_code')||'-%' or loc.name not like '%MOCK%'))
  or m#>'{location,synthetic}' is distinct from to_jsonb(s.synthetic) then raise exception 'P1_LOCATION_MISMATCH' using errcode='42501'; end if;
 if (select count(distinct j0->>'id') from jsonb_array_elements(m->'items') j0)<>4 or (select count(distinct j0->>'key') from jsonb_array_elements(m->'items') j0 where j0->>'key' in ('chemical','consumable','reusable','serialized'))<>4 then raise exception 'P1_ITEM_SCOPE_MISMATCH' using errcode='42501'; end if;
 for j in select value from jsonb_array_elements(m->'items') loop
  select * into item from public.inventory_catalog_items where id=(j->>'id')::uuid;
  if item.id is null or not item.active or row(item.code,item.name,item.material_kind,item.tracking_strategy,item.return_semantics,item.expiry_required,item.base_uom_code) is distinct from row(j->>'code',j->>'name',j->>'material_kind',j->>'tracking_strategy',j->>'return_semantics',(j->>'expiry_required')::boolean,j->>'uom')
   or (s.synthetic and (item.code not like (m->>'scope_code')||'-%' or item.name not like '%MOCK%')) then raise exception 'P1_ITEM_SCOPE_MISMATCH' using errcode='42501'; end if;
  if (j->>'key'='chemical' and row(item.material_kind,item.tracking_strategy,item.return_semantics,item.expiry_required) is distinct from row('chemical','quantity','nonreturnable',true))
   or (j->>'key'='consumable' and row(item.material_kind,item.tracking_strategy,item.return_semantics,item.expiry_required) is distinct from row('other','quantity','nonreturnable',false))
   or (j->>'key'='reusable' and row(item.material_kind,item.tracking_strategy,item.return_semantics,item.expiry_required) is distinct from row('other','quantity','returnable',false))
   or (j->>'key'='serialized' and row(item.material_kind,item.tracking_strategy,item.return_semantics,item.expiry_required) is distinct from row('other','serialized','returnable',false)) then raise exception 'P1_ARCHETYPE_MISMATCH' using errcode='42501'; end if;
  if j->>'key'='serialized' then asset_item:=item.id; end if;
 end loop;
 if m#>'{opening_payload,synthetic}' is distinct from to_jsonb(s.synthetic) or m#>>'{opening_payload,cutover_key}' is distinct from m#>>'{opening,reference}' or m#>>'{opening_payload,count_cutoff}' is distinct from m->>'count_cutoff'
  or nullif(btrim(m#>>'{opening,reference}'),'') is null or m#>>'{opening,reference}' is distinct from btrim(m#>>'{opening,reference}')
  or (s.synthetic and m#>>'{opening,reference}' not like (m->>'scope_code')||'-%')
  or (select count(distinct j0->>'line_key') from jsonb_array_elements(m#>'{opening_payload,lines}') j0)<>jsonb_array_length(m#>'{opening_payload,lines}') then raise exception 'P1_OPENING_MANIFEST_MISMATCH' using errcode='23505'; end if;
 for j in select value from jsonb_array_elements(m#>'{opening_payload,lines}') loop
  if (j->>'location_id')::uuid is distinct from loc.id or (j->>'catalog_item_id')::uuid=asset_item or not exists(select 1 from jsonb_array_elements(m->'items') i where i->>'id'=j->>'catalog_item_id')
   or (j->>'good_quantity')::numeric<0 or (j->>'damaged_quantity')::numeric<0 or coalesce((j->>'good_quantity')::numeric+(j->>'damaged_quantity')::numeric,0)<=0 then raise exception 'P1_OPENING_SCOPE_MISMATCH' using errcode='42501'; end if;
 end loop;
 if (select count(distinct j0->>'catalog_item_id') from jsonb_array_elements(m#>'{opening_payload,lines}') j0)<>3 or (m#>>'{asset,catalog_item_id}')::uuid is distinct from asset_item or (m#>>'{asset,location_id}')::uuid is distinct from loc.id
  or m#>'{asset,synthetic}' is distinct from to_jsonb(s.synthetic) or nullif(btrim(m#>>'{asset,manufacturer}'),'') is null or nullif(btrim(m#>>'{asset,model}'),'') is null or nullif(btrim(m#>>'{asset,manufacturer_serial}'),'') is null or nullif(btrim(m#>>'{asset,row_key}'),'') is null then raise exception 'P1_SERIALIZED_MANIFEST_MISMATCH' using errcode='42501'; end if;
 s.admin_id:=admin; s.staff_ids:=staff; perform private.p1_identity(s,p_pilot);
 update private.inventory_pilot_writer_context set bound_scope_id=s.id,pilot=p_pilot where transaction_id=txid_current();
 insert into public.inventory_pilot_scopes(id,project_ref,scope_version,manifest_id,manifest,manifest_hash,synthetic,admin_id,staff_ids,location_id,opening_reference,count_cutoff,registered_by,updated_by,evidence_reference)
 values(s.id,s.project_ref,s.scope_version,s.manifest_id,m,s.manifest_hash,s.synthetic,admin,staff,loc.id,m#>>'{opening,reference}',(m->>'count_cutoff')::timestamptz,auth.uid(),auth.uid(),p_evidence) returning * into s;
 insert into public.inventory_pilot_scope_items select s.id,(value->>'id')::uuid from jsonb_array_elements(m->'items');
 foreach writer in array array['inventory_command','equipment_asset_command','equipment_preparation_command','equipment_preparation_transfer','equipment_fulfillment_command','legacy','privileged_import','manual_offline'] loop
  insert into public.inventory_pilot_writers(scope_id,writer_id,allowed) values(s.id,writer,writer not in ('legacy','privileged_import','manual_offline'));
 end loop;
 insert into public.inventory_pilot_asset_bindings(scope_id,row_key,catalog_item_id,location_id,intake_reference,manufacturer,model,manufacturer_serial)
 values(s.id,m#>>'{asset,row_key}',asset_item,loc.id,s.opening_reference,m#>>'{asset,manufacturer}',m#>>'{asset,model}',m#>>'{asset,manufacturer_serial}');
 return s;
end; $$;
revoke all on function private.p1_register(jsonb,jsonb,text) from public,anon,authenticated,service_role;
