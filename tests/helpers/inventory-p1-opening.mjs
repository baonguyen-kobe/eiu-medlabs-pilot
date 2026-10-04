import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  actorSql,
  jsonSql,
  P1_WRITERS,
  sqlLiteral,
} from "./inventory-p1-runtime.mjs";

// Execute only through setupP1Local/createP1LocalClient. Every corruption precedes
// registration, restores USER triggers before the RPC, and is savepoint-rolled back.
export function buildP1OpeningSql(manifest) {
  assert.equal(manifest.synthetic, true);
  assert.equal(manifest.dataset_kind, "mock");
  assert.equal(manifest.target_project_ref, "kwpyukofofoaqhmxndlc");
  assert.notEqual(
    manifest.scope_code,
    "P1-MOCK-ACC2B31A",
    "LOCAL_COUNTERPART_REQUIRED",
  );
  assert.equal(manifest.opening_payload.lines.length, 6);
  assert.equal(manifest.facts.length, 6);
  const admin = manifest.users.find((user) => user.role === "admin").id;
  const staff = manifest.users.find((user) => user.role === "staff").id;
  const uuid = (value) => `${sqlLiteral(value)}::uuid`;
  const batch = uuid(manifest.opening_result.opening_batch_id);
  const transaction = uuid(manifest.opening_result.transaction_id);
  const originalAsset = uuid(manifest.asset.id);
  const origin = uuid(
    manifest.facts.find((row) => row.row_key === "gloves").origin_id,
  );
  const factFilter = `origin_id=${origin} and version=0`;
  const meta = (value) => ({
    scope_id: value.scope_id,
    scope_version: value.scope_version,
    manifest_id: value.manifest_id,
    project_ref: value.target_project_ref,
  });
  const writers = P1_WRITERS.map(
    ([writer_id, allowed]) =>
      `select pg_temp.p1_open_control('record_writer',${jsonSql({ writer_id, allowed })});`,
  ).join("\n");
  const register = `select pg_temp.p1_open_control('register_scope',jsonb_build_object('manifest',pg_temp.p1_open_get('manifest')));\n${writers}`;
  const corruptCase = (label, tables, corruption, discrepancy) => `
savepoint p1_corrupted_baseline;
reset role;
select set_config('request.jwt.claims','{}',true);
select pg_temp.p1_open_assert(not exists(select 1 from public.inventory_pilot_scopes where id=${uuid(manifest.scope_id)}),'${label}: before registration');
${tables.map((table) => `alter table public.${table} disable trigger user;`).join("\n")}
${corruption}
${tables.map((table) => `alter table public.${table} enable trigger user;`).join("\n")}
${actorSql(admin)}
${register}
select pg_temp.p1_open_reject(${jsonSql(discrepancy)},${sqlLiteral(label)});
reset role;
rollback to savepoint p1_corrupted_baseline;
release savepoint p1_corrupted_baseline;`;

  const newManifest = structuredClone(manifest);
  newManifest.scope_code = `P1-MOCK-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  newManifest.scope_id = randomUUID();
  newManifest.manifest_id = randomUUID();
  newManifest.location.id = randomUUID();
  newManifest.location.code = `${newManifest.scope_code}-SKL`;
  newManifest.location.name = `${newManifest.scope_code} new-opening warehouse — MOCK`;
  newManifest.opening.reference = `${newManifest.scope_code}-OPEN-V1`;
  newManifest.opening_payload.cutover_key = newManifest.opening.reference;
  const itemIds = new Map();
  for (const item of newManifest.items) {
    const oldId = item.id;
    item.id = randomUUID();
    itemIds.set(oldId, item.id);
    item.code = item.code.replace(manifest.scope_code, newManifest.scope_code);
    item.name = `${newManifest.scope_code} ${item.key} — MOCK`;
  }
  for (const line of newManifest.opening_payload.lines) {
    line.catalog_item_id = itemIds.get(line.catalog_item_id);
    line.location_id = newManifest.location.id;
    for (const key of ["origin_id", "cohort_id", "fact_id"]) delete line[key];
  }
  newManifest.asset.catalog_item_id = itemIds.get(
    manifest.asset.catalog_item_id,
  );
  newManifest.asset.location_id = newManifest.location.id;
  newManifest.asset.manufacturer_serial = `${newManifest.scope_code}-IP100-001`;
  for (const key of [
    "id",
    "asset_code",
    "event_id",
    "transaction_id",
    "revision",
  ])
    delete newManifest.asset[key];
  for (const key of [
    "opening_result",
    "asset_opening_result",
    "facts",
    "balances_read",
    "database_checks",
    "serialized_count_checks",
  ])
    delete newManifest[key];
  newManifest.opening_retry_key = randomUUID();
  newManifest.asset_opening_retry_key = randomUUID();
  const assetPayload = {
    catalog_item_id: newManifest.asset.catalog_item_id,
    location_id: newManifest.location.id,
    row_key: newManifest.asset.row_key,
    manufacturer: newManifest.asset.manufacturer,
    model: newManifest.asset.model,
    manufacturer_serial: newManifest.asset.manufacturer_serial,
    custodian_id: staff,
    intake_reference: newManifest.opening.reference,
    operational_status: "ready",
    expiry_precision: "not_required",
    synthetic: true,
    reason: "New synthetic MOCK opening",
    evidence_note: "Rollback-only new expected serialized tuple",
  };
  const extraOrigin = `do $$ declare new_origin uuid:=gen_random_uuid(); new_fact uuid:=gen_random_uuid(); new_tx uuid:=gen_random_uuid(); new_batch uuid:=gen_random_uuid(); new_item uuid:=gen_random_uuid(); begin
    insert into public.inventory_catalog_items select (jsonb_populate_record(null::public.inventory_catalog_items,to_jsonb(ci)||jsonb_build_object('id',new_item,'code','P1-MOCK-OUTSIDE-'||new_item,'name','Outside SKU — MOCK'))).* from public.inventory_catalog_items ci where ci.id=${uuid(manifest.items.find((item) => item.key === "consumable").id)};
    insert into public.inventory_transactions(id,operation,business_key,actor_id,occurred_at,reason) values(new_tx,'OPENING','P1-MOCK-EXTRA-'||new_tx,${uuid(admin)},${sqlLiteral(manifest.count_cutoff)}::timestamptz,'Extra preexisting MOCK origin');
    insert into public.inventory_opening_batches(id,cutover_key,scope_description,count_cutoff,provenance_note,synthetic,transaction_id) values(new_batch,'P1-MOCK-EXTRA-'||new_batch,'Extra MOCK',${sqlLiteral(manifest.count_cutoff)}::timestamptz,'Extra provenance',true,new_tx);
    insert into public.inventory_stock_origins(id,opening_batch_id,line_key,provenance_group,catalog_item_id) values(new_origin,new_batch,'outside-zero','outside-zero',new_item);
    insert into public.inventory_stock_facts select (jsonb_populate_record(null::public.inventory_stock_facts,to_jsonb(sf)||jsonb_build_object('id',new_fact,'origin_id',new_origin,'transaction_id',new_tx,'good_quantity',0,'damaged_quantity',0,'base_quantity',0,'source_snapshot',jsonb_build_object('cutover_key','P1-MOCK-EXTRA-'||new_batch,'provenance_group','outside-zero')))).* from public.inventory_stock_facts sf where ${factFilter};
    insert into public.inventory_receipt_cohorts(origin_id,current_fact_id) values(new_origin,new_fact);
    insert into public.inventory_stock_balances(cohort_id,location_id,condition,quantity) values(new_origin,${uuid(manifest.location.id)},'good',0);
  end $$;`;
  const extraAsset = (
    outsideSku,
  ) => `do $$ declare new_item uuid:=gen_random_uuid(); new_asset uuid:=gen_random_uuid(); new_location uuid:=gen_random_uuid(); begin
    ${outsideSku ? `insert into public.inventory_catalog_items select (jsonb_populate_record(null::public.inventory_catalog_items,to_jsonb(ci)||jsonb_build_object('id',new_item,'code','P1-MOCK-OUTSIDE-'||new_item,'name','Outside serialized SKU — MOCK'))).* from public.inventory_catalog_items ci where ci.id=${uuid(manifest.asset.catalog_item_id)};` : `new_item:=${uuid(manifest.asset.catalog_item_id)}; insert into public.inventory_storage_locations(id,code,name) values(new_location,'P1-MOCK-OUTSIDE-'||new_location,'Outside location — MOCK');`}
    insert into public.equipment_assets select (jsonb_populate_record(null::public.equipment_assets,to_jsonb(ea)||jsonb_build_object('id',new_asset,'asset_code','EIU-AST-'||upper(split_part(new_asset::text,'-',1)),'catalog_item_id',new_item,'location_id',${outsideSku ? uuid(manifest.location.id) : "new_location"},'intake_reference','P1-MOCK-EXTRA-'||new_asset,'manufacturer_serial','MOCK-EXTRA-'||new_asset))).* from public.equipment_assets ea where ea.id=${originalAsset};
  end $$;`;

  const corruptions = [
    corruptCase(
      "missing opening ledger AND projection",
      ["inventory_transaction_lines", "inventory_stock_balances"],
      `delete from public.inventory_transaction_lines where transaction_id=${transaction} and cohort_id=${origin} and condition='good';\ndelete from public.inventory_stock_balances where cohort_id=${origin} and condition='good';`,
      { missing_opening_ledger_good: "gloves" },
    ),
    corruptCase(
      "missing projection despite original ledger",
      ["inventory_stock_balances"],
      `delete from public.inventory_stock_balances where cohort_id=${origin} and condition='good';`,
      { missing_initial_stock: "gloves" },
    ),
    corruptCase(
      "opening ledger wrong catalog",
      ["inventory_transaction_lines"],
      `update public.inventory_transaction_lines set catalog_item_id=${uuid(manifest.items.find((item) => item.key === "reusable").id)} where transaction_id=${transaction} and cohort_id=${origin} and condition='good';`,
      { missing_opening_ledger_good: "gloves" },
    ),
    corruptCase(
      "outside SKU zero-stock origin at closed warehouse",
      [
        "inventory_catalog_items",
        "inventory_transactions",
        "inventory_opening_batches",
        "inventory_stock_origins",
        "inventory_stock_facts",
        "inventory_receipt_cohorts",
        "inventory_stock_balances",
      ],
      extraOrigin,
      "UNEXPECTED_INITIAL_ORIGINS",
    ),
    corruptCase(
      "unexpected initial fact version with unchanged projection",
      ["inventory_stock_facts", "inventory_receipt_cohorts"],
      `do $$ declare next_fact uuid:=gen_random_uuid(); begin insert into public.inventory_stock_facts select (jsonb_populate_record(null::public.inventory_stock_facts,to_jsonb(sf)||jsonb_build_object('id',next_fact,'version',1,'previous_fact_id',sf.id))).* from public.inventory_stock_facts sf where ${factFilter}; update public.inventory_receipt_cohorts set current_fact_id=next_fact where origin_id=${origin}; end $$;`,
      "UNEXPECTED_INITIAL_FACTS",
    ),
    corruptCase(
      "extra scope SKU serialized asset outside warehouse",
      ["inventory_storage_locations", "equipment_assets"],
      extraAsset(false),
      "UNEXPECTED_SERIALIZED_ASSETS",
    ),
    corruptCase(
      "extra outside SKU serialized asset at scope warehouse",
      ["inventory_catalog_items", "equipment_assets"],
      extraAsset(true),
      "UNEXPECTED_SERIALIZED_ASSETS",
    ),
    ...[
      ["scope_description", "Different MOCK scope"],
      ["provenance_note", "Different MOCK provenance"],
      ["count_cutoff", `${manifest.count_cutoff}`],
    ].map(([field, value]) =>
      corruptCase(
        `batch ${field} mismatch`,
        ["inventory_opening_batches"],
        `update public.inventory_opening_batches set ${field}=${sqlLiteral(value)}${field === "count_cutoff" ? "::timestamptz+interval '1 second'" : ""} where id=${batch};`,
        "OPENING_BATCH_MISSING_OR_MISMATCHED",
      ),
    ),
    ...[
      ["business_key", sqlLiteral("P1-MOCK-WRONG-OPENING")],
      ["actor_id", uuid(staff)],
      ["occurred_at", "occurred_at+interval '1 second'"],
      ["reason", sqlLiteral("Wrong opening scope reason")],
    ].map(([field, value]) =>
      corruptCase(
        `opening header ${field} mismatch`,
        ["inventory_transactions"],
        `update public.inventory_transactions set ${field}=${value} where id=${transaction};`,
        "OPENING_BATCH_MISSING_OR_MISMATCHED",
      ),
    ),
    ...[
      [
        "source_snapshot",
        'source_snapshot||\'{"cutover_key":"P1-MOCK-WRONG"}\'::jsonb',
      ],
      [
        "source_snapshot",
        'source_snapshot||\'{"provenance_group":"wrong"}\'::jsonb',
      ],
      ["evidence_note", sqlLiteral("Wrong evidence")],
      ["previous_fact_id", "id"],
    ].map(([field, value]) =>
      corruptCase(
        `original fact ${field} mismatch`,
        ["inventory_stock_facts"],
        `update public.inventory_stock_facts set ${field}=${value} where ${factFilter};`,
        { mismatched_row: "gloves" },
      ),
    ),
    corruptCase(
      "original fact transaction mismatch",
      ["inventory_stock_facts"],
      `update public.inventory_stock_facts set transaction_id=${uuid(manifest.asset_opening_result.transaction_id)} where ${factFilter};`,
      { fact_tx_mismatch: "gloves" },
    ),
    ...["origin_id", "cohort_id", "fact_id"].map((field) =>
      corruptCase(
        `manifest original ${field} mismatch`,
        [],
        `update p1_open_context set v=jsonb_set(v,'{facts,0,${field}}',to_jsonb(gen_random_uuid()::text)) where k='manifest';`,
        { original_row_id_mismatch: manifest.facts[0].row_key },
      ),
    ),
    ...["opening_batch_id", "transaction_id"].map((field) =>
      corruptCase(
        `manifest opening ${field} mismatch`,
        [],
        `update p1_open_context set v=jsonb_set(v,'{opening_result,${field}}',to_jsonb(gen_random_uuid()::text)) where k='manifest';`,
        "OPENING_BATCH_MISSING_OR_MISMATCHED",
      ),
    ),
    corruptCase(
      "manifest serialized original event mismatch",
      [],
      `update p1_open_context set v=jsonb_set(v,'{asset_opening_result,event_id}',to_jsonb(gen_random_uuid()::text)) where k='manifest';`,
      "SERIALIZED_EVENT_MISMATCH",
    ),
    corruptCase(
      "manifest serialized original code mismatch",
      [],
      `update p1_open_context set v=jsonb_set(v,'{asset_opening_result,asset_code}','"EIU-AST-00000000"'::jsonb) where k='manifest';`,
      "SERIALIZED_EVENT_MISMATCH",
    ),
  ];

  return `begin isolation level repeatable read;
set local statement_timeout='90s'; set local lock_timeout='25s';
select pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
create temporary table p1_open_context(k text primary key,v jsonb not null) on commit drop;
grant all on p1_open_context to authenticated;
insert into p1_open_context values('manifest',${jsonSql(manifest)}),('pilot',${jsonSql(meta(manifest))}),('new-manifest',${jsonSql(newManifest)}),('new-pilot',${jsonSql(meta(newManifest))}),('new-asset-payload',${jsonSql(assetPayload)});
create function pg_temp.p1_open_assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'P1_OPEN_ASSERT: %',label; end if; end $$;
create function pg_temp.p1_open_get(key text) returns jsonb language sql as $$ select v from p1_open_context where k=key $$;
create function pg_temp.p1_open_put(key text,value jsonb) returns void language sql as $$ insert into p1_open_context values(key,value) on conflict(k) do update set v=excluded.v $$;
create function pg_temp.p1_open_meta(payload jsonb) returns jsonb language sql as $$ select payload||jsonb_build_object('pilot',pg_temp.p1_open_get('pilot')) $$;
create function pg_temp.p1_open_control(op text,extra jsonb default '{}') returns jsonb language sql as $$
 select public.inventory_pilot_command(op,pg_temp.p1_open_meta(jsonb_build_object('reason','Rollback-only MOCK opening regression','evidence_reference','P1-MOCK-opening:'||op||':'||gen_random_uuid())||extra),gen_random_uuid()) $$;
create function pg_temp.p1_open_deny(query text,expected_code text,label text) returns void language plpgsql as $$
declare actual text; begin begin execute query; exception when others then get stacked diagnostics actual=returned_sqlstate; if actual=expected_code then return; end if; raise exception 'P1_OPEN_WRONG_SQLSTATE: % expected %, got %: %',label,expected_code,actual,sqlerrm; end; raise exception 'P1_OPEN_EXPECTED_DENIAL: %',label; end $$;
create function pg_temp.p1_open_reject(expected jsonb,label text) returns void language plpgsql as $$
declare result jsonb; detail text; begin
 begin perform pg_temp.p1_open_control('confirm_opening'); exception when sqlstate '42501' then
  get stacked diagnostics detail=pg_exception_detail;
  perform pg_temp.p1_open_assert((detail::jsonb->'discrepancies')@>jsonb_build_array(expected),label||': confirmation names actual defect');
  result:=pg_temp.p1_open_control('reconcile')->'reconciliation';
  perform pg_temp.p1_open_assert(not (result->>'ready')::boolean and not (result->>'opening_complete')::boolean and (result->'discrepancies')@>jsonb_build_array(expected),label||': not false-ready');
  perform pg_temp.p1_open_deny('select pg_temp.p1_open_control(''activate'')','42501',label||': ACT denied');
  perform pg_temp.p1_open_assert(public.inventory_pilot_read((pg_temp.p1_open_get('pilot')->>'scope_id')::uuid)#>>'{scope,phase}'='OPENING_READY',label||': phase remains safe');
  return;
 end;
 raise exception 'P1_OPEN_CORRUPTED_BASELINE_ADOPTED: %',label;
end $$;
create function pg_temp.p1_open_fingerprint() returns jsonb language plpgsql as $$
declare t record; digest text; result jsonb:='{}'; begin
 for t in select c.relname,n.nspname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','auth','private') order by n.nspname,c.relname loop
  execute format('select md5(coalesce(string_agg(to_jsonb(x)::text,chr(10) order by to_jsonb(x)::text),'''')) from %I.%I x',t.nspname,t.relname) into digest;
  result:=result||jsonb_build_object(t.nspname||'.'||t.relname,digest);
 end loop; return result; end $$;
select pg_temp.p1_open_assert(current_user in ('postgres','supabase_admin'),'LOCAL owner required');
select pg_temp.p1_open_assert(not exists(select 1 from public.inventory_pilot_scopes where id=${uuid(manifest.scope_id)}),'pristine local counterpart');
select pg_temp.p1_open_put('before',pg_temp.p1_open_fingerprint());
savepoint p1_open_all;
${corruptions.join("\n")}
-- Unbound serialized tuple must itself prevent ACT even with opening/writer evidence.
savepoint p1_unbound;
${actorSql(admin)}
${register}
select pg_temp.p1_open_assert(pg_temp.p1_open_control('reconcile')#>'{reconciliation,discrepancies}'@>'["SERIALIZED_IDENTITY_UNBOUND_OR_MISMATCHED"]'::jsonb,'unbound tuple cannot be ready');
select pg_temp.p1_open_deny('select pg_temp.p1_open_control(''activate'')','42501','unbound asset after registration cannot ACT');
reset role;
rollback to savepoint p1_unbound;
release savepoint p1_unbound;
-- The untouched original counterpart is adopted by original IDs, not reposted.
savepoint p1_original_adoption;
${actorSql(admin)}
${register}
select pg_temp.p1_open_control('confirm_opening');
select pg_temp.p1_open_assert((select binding->>'asset_id'=${sqlLiteral(manifest.asset.id)} and binding->>'opening_event_id'=${sqlLiteral(manifest.asset_opening_result.event_id)} from jsonb_array_elements(public.inventory_pilot_read(${uuid(manifest.scope_id)})->'bindings') binding),'original serialized identity/event adopted');
select pg_temp.p1_open_assert((pg_temp.p1_open_control('reconcile')#>>'{reconciliation,ready}')::boolean,'original opening ready');
select pg_temp.p1_open_assert(pg_temp.p1_open_control('activate')->>'phase'='ACTIVE','original adoption ACT');
select pg_temp.p1_open_put('original-cohort',public.inventory_read('cohorts',jsonb_build_object('origin_id',${origin}))#>'{rows,0}');
select public.inventory_command('change_stock_condition',pg_temp.p1_open_meta(jsonb_build_object('location_id',${uuid(manifest.location.id)},'reason','Later actual MOCK physical condition movement','lines',jsonb_build_array(jsonb_build_object('origin_id',${origin},'expected_version',pg_temp.p1_open_get('original-cohort')->'current_version','expected_stock_revision',pg_temp.p1_open_get('original-cohort')->'stock_revision','from_condition','good','to_condition','damaged','quantity','1')))),gen_random_uuid());
select pg_temp.p1_open_assert((public.inventory_read('cohorts',jsonb_build_object('origin_id',${origin}))#>>'{rows,0,good_balance}')::numeric=99 and (public.inventory_read('cohorts',jsonb_build_object('origin_id',${origin}))#>>'{rows,0,damaged_balance}')::numeric=6,'later physical movement changes original projection 99/6');
select pg_temp.p1_open_assert((pg_temp.p1_open_control('reconcile')#>>'{reconciliation,ready}')::boolean,'immutable opening qualifies without freezing later physical balance');
select pg_temp.p1_open_put('unknown-cohort',public.inventory_read('cohorts',jsonb_build_object('origin_id',${uuid(manifest.facts.find((row) => row.row_key === "ethanol-unknown").origin_id)}))#>'{rows,0}');
select public.inventory_command('verify_opening_expiry',pg_temp.p1_open_meta(jsonb_build_object('origin_id',pg_temp.p1_open_get('unknown-cohort')->>'origin_id','expected_version',pg_temp.p1_open_get('unknown-cohort')->'current_version','expiry_precision','day','expiry_input','2028-12-31','reason','Later MOCK expiry correction','evidence_note','Rollback-only observed synthetic label')),gen_random_uuid());
select pg_temp.p1_open_assert(public.inventory_read('cohorts',jsonb_build_object('origin_id',pg_temp.p1_open_get('unknown-cohort')->>'origin_id'))#>>'{rows,0,current_expiry_date}'='2028-12-31','later correction updates current expiry fact');
select pg_temp.p1_open_assert((pg_temp.p1_open_control('reconcile')#>>'{reconciliation,ready}')::boolean,'later corrected facts do not invalidate immutable opening');
select pg_temp.p1_open_control('pause');
reset role;
rollback to savepoint p1_original_adoption;
release savepoint p1_original_adoption;
-- A separate closed namespace starts with no physical opening or supplied asset IDs.
select set_config('request.jwt.claims','{}',true);
insert into public.inventory_storage_locations select (jsonb_populate_record(null::public.inventory_storage_locations,to_jsonb(loc)||${jsonSql({ id: newManifest.location.id, code: newManifest.location.code, name: newManifest.location.name })})).* from public.inventory_storage_locations loc where loc.id=${uuid(manifest.location.id)};
${newManifest.items.map((item, index) => `insert into public.inventory_catalog_items select (jsonb_populate_record(null::public.inventory_catalog_items,to_jsonb(ci)||${jsonSql({ id: item.id, code: item.code, name: item.name })})).* from public.inventory_catalog_items ci where ci.id=${uuid(manifest.items[index].id)};`).join("\n")}
update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{mock_scope_id}',${jsonSql(newManifest.scope_id)}) where id=any(array[${manifest.users.map((user) => uuid(user.id)).join(",")}]::uuid[]);
select pg_temp.p1_open_put('manifest',pg_temp.p1_open_get('new-manifest'));
select pg_temp.p1_open_put('pilot',pg_temp.p1_open_get('new-pilot'));
${actorSql(admin)}
${register}
select pg_temp.p1_open_assert(public.inventory_pilot_read(${uuid(newManifest.scope_id)})#>'{scope,manifest}'=${jsonSql(newManifest)},'new tuple frozen without generated identities');
select pg_temp.p1_open_assert((select binding->>'asset_id' is null and binding->>'asset_code' is null and binding->>'opening_event_id' is null from jsonb_array_elements(public.inventory_pilot_read(${uuid(newManifest.scope_id)})->'bindings') binding),'new binding initially empty');
select pg_temp.p1_open_deny('select pg_temp.p1_open_control(''activate'')','42501','preopening ACT denied');
select pg_temp.p1_open_put('new-opening',public.inventory_command('confirm_opening_balance',pg_temp.p1_open_meta(pg_temp.p1_open_get('manifest')->'opening_payload'),${uuid(newManifest.opening_retry_key)}));
select pg_temp.p1_open_deny('select pg_temp.p1_open_control(''confirm_opening'')','42501','quantity opening without physical asset cannot confirm');
${actorSql(staff)}
select pg_temp.p1_open_deny(format('select public.equipment_asset_command(''open_asset'',%L::jsonb,gen_random_uuid())',pg_temp.p1_open_meta(pg_temp.p1_open_get('new-asset-payload'))),'42501','Staff cannot bind opening');
${actorSql(admin)}
select pg_temp.p1_open_put('new-asset',public.equipment_asset_command('open_asset',pg_temp.p1_open_meta(pg_temp.p1_open_get('new-asset-payload')),${uuid(newManifest.asset_opening_retry_key)}));
select pg_temp.p1_open_assert((pg_temp.p1_open_get('new-asset')->>'id')::uuid<>${originalAsset} and pg_temp.p1_open_get('new-asset')->>'asset_code' ~ '^EIU-AST-[0-9A-F]{8}$','server generates NEW identity/code');
select pg_temp.p1_open_assert((select binding->>'asset_id'=pg_temp.p1_open_get('new-asset')->>'id' and binding->>'asset_code'=pg_temp.p1_open_get('new-asset')->>'asset_code' and binding->>'opening_event_id'=pg_temp.p1_open_get('new-asset')->>'event_id' from jsonb_array_elements(public.inventory_pilot_read(${uuid(newManifest.scope_id)})->'bindings') binding),'open_asset atomically binds generated identity/code/event');
select pg_temp.p1_open_assert(public.equipment_asset_command('open_asset',pg_temp.p1_open_meta(pg_temp.p1_open_get('new-asset-payload')),${uuid(newManifest.asset_opening_retry_key)})=pg_temp.p1_open_get('new-asset'),'exact opening retry returns same IDs');
select pg_temp.p1_open_deny(format('select public.equipment_asset_command(''open_asset'',%L::jsonb,gen_random_uuid())',pg_temp.p1_open_meta(pg_temp.p1_open_get('new-asset-payload'))),'23505','different retry duplicate does not create new asset');
select pg_temp.p1_open_deny('select pg_temp.p1_open_control(''confirm_opening'')','42501','registered but uncommissioned asset cannot confirm');
select public.equipment_asset_command('set_asset_lifecycle',pg_temp.p1_open_meta(jsonb_build_object('id',pg_temp.p1_open_get('new-asset')->>'id','expected_revision',pg_temp.p1_open_get('new-asset')->'revision','lifecycle_status','in_service','reason','Commission new synthetic MOCK asset','evidence_note','Rollback-only commissioning')),gen_random_uuid());
select pg_temp.p1_open_control('confirm_opening');
select pg_temp.p1_open_assert((pg_temp.p1_open_control('reconcile')#>>'{reconciliation,ready}')::boolean,'new quantity and serialized opening ready');
select pg_temp.p1_open_assert(pg_temp.p1_open_control('activate')->>'phase'='ACTIVE','new opening ACT');
select pg_temp.p1_open_assert(pg_temp.p1_open_control('pause')->>'phase'='PAUSED','new opening ends PAUSED');
select pg_temp.p1_open_assert(public.equipment_asset_command('open_asset',pg_temp.p1_open_meta(pg_temp.p1_open_get('new-asset-payload')),${uuid(newManifest.asset_opening_retry_key)})=pg_temp.p1_open_get('new-asset'),'PAUSED exact opening retry is nonphysical');
reset role;
select pg_temp.p1_open_assert((select count(*)=1 from public.equipment_assets where catalog_item_id=${uuid(newManifest.asset.catalog_item_id)} or location_id=${uuid(newManifest.location.id)}),'retry duplicates never add a physical asset');
select pg_temp.p1_open_assert((select count(*)=6 from public.inventory_stock_origins where opening_batch_id=(pg_temp.p1_open_get('new-opening')->>'opening_batch_id')::uuid),'new opening has exact six origins');
select pg_temp.p1_open_assert((select count(*)=6 from public.inventory_stock_origins where opening_batch_id=${batch}) and (select count(*)=1 from public.equipment_assets where intake_reference=${sqlLiteral(manifest.opening.reference)}),'original counterpart physical identities untouched');
select jsonb_build_object('kind','P1_OPENING_REGRESSION_BEFORE_ROLLBACK','corrupted_baselines',${corruptions.length},'original_adoption',true,'new_generated_binding',true,'new_final_phase','PAUSED');
rollback to savepoint p1_open_all;
select pg_temp.p1_open_assert(pg_temp.p1_open_fingerprint()=pg_temp.p1_open_get('before'),'all original durable rows restored including auth metadata');
select jsonb_build_object('kind','P1_OPENING_ROLLBACK_INTEGRITY','rollback_integrity',true);
rollback;`;
}
