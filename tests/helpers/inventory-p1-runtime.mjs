import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
export const jsonSql = (value) => `${sqlLiteral(JSON.stringify(value))}::jsonb`;
export const P1_WRITERS = Object.freeze([
  ["inventory_command", true],
  ["equipment_asset_command", true],
  ["equipment_preparation_command", true],
  ["equipment_preparation_transfer", true],
  ["equipment_fulfillment_command", true],
  ["legacy", false],
  ["privileged_import", false],
  ["manual_offline", false],
]);
const TARGET = "kwpyukofofoaqhmxndlc";
const SCOPE = "P1-MOCK-ACC2B31A";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function validateManifest(m) {
  assert.equal(m.synthetic, true);
  assert.equal(m.dataset_kind, "mock");
  assert.equal(m.target_project_ref, TARGET);
  assert.match(m.scope_code, /^P1-MOCK-[A-Z0-9]+$/);
  for (const id of [
    m.scope_id,
    m.manifest_id,
    m.location.id,
    ...m.items.map((i) => i.id),
    ...m.users.map((u) => u.id),
  ])
    assert.match(id, UUID);
  assert.equal(m.users.filter((u) => u.role === "admin").length, 1);
  assert.equal(m.users.filter((u) => u.role === "staff").length, 2);
  assert.deepEqual(m.items.map((i) => i.key).sort(), [
    "chemical",
    "consumable",
    "reusable",
    "serialized",
  ]);
  assert.equal(m.scope_version, 1);
  assert.ok(
    m.opening_payload && m.opening_retry_key && m.asset_opening_retry_key,
  );
}
export function actorSql(actor) {
  assert.match(actor, UUID);
  return `set local role authenticated; select set_config('request.jwt.claims',${jsonSql({ sub: actor, role: "authenticated" })}::text,true);`;
}
function parseJson(output) {
  const lines = output.split(/\r?\n/).filter((line) => line.startsWith("{"));
  assert.ok(lines.length, "psql did not emit JSON");
  return JSON.parse(lines.at(-1));
}

// Local Docker transport only: no URL/password/network target accepted.
// No discovery or execution occurs on importing this module.
export function createP1LocalClient() {
  const project = process.env.SUPABASE_LOCAL_PROJECT_ID ?? "eiu-medlabs-pilot";
  assert.equal(project, "eiu-medlabs-pilot");
  const listed = spawnSync(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${project}`,
      "--format",
      "{{.Names}}",
    ],
    { encoding: "utf8" },
  );
  assert.equal(listed.status, 0, listed.stderr);
  const containers = listed.stdout
    .split(/\r?\n/)
    .filter((n) => n.startsWith("supabase_db_"));
  assert.equal(
    containers.length,
    1,
    "REFUSING_AMBIGUOUS_LOCAL_SUPABASE_DATABASE",
  );
  const sql = (query) =>
    new Promise((accept, reject) => {
      const child = spawn(
        "docker",
        [
          "exec",
          "-i",
          containers[0],
          "psql",
          "-X",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-v",
          "ON_ERROR_STOP=1",
          "-qAt",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let out = "",
        err = "";
      child.stdout.on("data", (c) => {
        out += c;
      });
      child.stderr.on("data", (c) => {
        err += c;
      });
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? accept(out)
          : reject(new Error(`P1 local psql exited ${code}: ${err}\n${out}`)),
      );
      child.stdin.end(
        `set statement_timeout='90s'; set lock_timeout='25s';\n${query}\n`,
      );
    });
  return { sql, container: containers[0], localOnly: true };
}

// Only this setup function commits a LOCAL fresh synthetic bootstrap. It clones
// the approved source with fresh identities; no existing scope is reset/reseeded.
export async function setupP1Local({
  root = process.cwd(),
  client = createP1LocalClient(),
} = {}) {
  assert.equal(client.localOnly, true, "LOCAL_ONLY_SETUP_REQUIRED");
  const baseline = JSON.parse(
    await readFile(
      resolve(root, "docs/architecture/P1_MOCK_MANIFEST.json"),
      "utf8",
    ),
  );
  validateManifest(baseline);
  let bootstrap = await readFile(
    resolve(root, "scripts/p1-mock-manifest.sql"),
    "utf8",
  );
  const namespace = `P1-MOCK-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  const substitutions = [
    [baseline.scope_id, randomUUID()],
    [baseline.manifest_id, randomUUID()],
    ...baseline.users.map((user) => [user.id, randomUUID()]),
    [SCOPE, namespace],
    [SCOPE.toLowerCase(), namespace.toLowerCase()],
  ];
  // Only fixture identities/names change; approved physical payloads and the
  // canonical room type remain intact. No existing scope is reset or deleted.
  for (const [before, after] of substitutions)
    bootstrap = bootstrap.replaceAll(before, after);
  const manifest = parseJson(await client.sql(bootstrap));
  manifest.asset.catalog_item_id = manifest.items.find(
    (item) => item.key === "serialized",
  ).id;
  manifest.asset.location_id = manifest.location.id;
  manifest.asset.custodian_id = manifest.users.find(
    (user) => user.role === "staff",
  ).id;
  manifest.asset.lifecycle_status = "in_service";
  manifest.asset.opening_good_count = 1;
  manifest.asset.opening_damaged_count = 0;
  manifest.opening_retry_key = baseline.opening_retry_key;
  manifest.asset_opening_retry_key = baseline.asset_opening_retry_key;
  manifest.marker_runtime_enforced = false;
  validateManifest(manifest);
  assert.equal(manifest.facts.length, 6);
  assert.match(manifest.asset.id, UUID);
  return {
    sql: client.sql,
    manifest,
    container: client.container,
    localOnly: true,
  };
}

// Owner client required. Every suite side effect, including temporary role/phone
// additions, is reversed before the final outer ROLLBACK. No seed SQL is included.
export function buildP1SmokeSql(manifest) {
  validateManifest(manifest);
  const admin = manifest.users.find((u) => u.role === "admin").id;
  const staff = manifest.users
    .filter((u) => u.role === "staff")
    .map((u) => u.id);
  const meta = {
    scope_id: manifest.scope_id,
    scope_version: manifest.scope_version,
    manifest_id: manifest.manifest_id,
    project_ref: TARGET,
  };
  const openingAsset = {
    row_key: manifest.asset.row_key,
    manufacturer: manifest.asset.manufacturer,
    model: manifest.asset.model,
    manufacturer_serial: manifest.asset.manufacturer_serial,
    operational_status: "ready",
    expiry_precision: "not_required",
    synthetic: true,
    intake_reference: manifest.opening.reference,
    reason: "SYNTHETIC MOCK training opening",
    evidence_note: "MOCK manifest; no real asset or stock",
    custodian_id: staff[0],
    catalog_item_id: manifest.items.find((i) => i.key === "serialized").id,
    location_id: manifest.location.id,
  };
  return `begin isolation level repeatable read;
set local statement_timeout='90s'; set local lock_timeout='25s';
-- Freeze unrelated writers during owner fingerprints as well as RPC exercise.
select pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
create temporary table p1_test_context(k text primary key,v jsonb not null) on commit drop;
grant all on p1_test_context to authenticated,service_role;
insert into p1_test_context values ('manifest',${jsonSql(manifest)}),('pilot',${jsonSql(meta)}),('asset-opening-payload',${jsonSql(openingAsset)});
create function pg_temp.p1_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'P1_ASSERT: %',label; end if; end $$;
create function pg_temp.p1_get(key text) returns jsonb language sql as $$ select v from p1_test_context where k=key $$;
create function pg_temp.p1_put(key text,value jsonb) returns void language sql as $$ insert into p1_test_context values(key,value) on conflict(k) do update set v=excluded.v $$;
create function pg_temp.p1_meta(payload jsonb default '{}') returns jsonb language sql as $$ select payload||jsonb_build_object('pilot',pg_temp.p1_get('pilot')) $$;
create function pg_temp.p1_control(op text,extra jsonb default '{}') returns jsonb language sql as $$
 select public.inventory_pilot_command(op,pg_temp.p1_meta(jsonb_build_object('reason','Rolled-back mock P1 acceptance','evidence_reference','P1-MOCK-ACC2B31A-smoke:'||op||':'||gen_random_uuid())||extra),gen_random_uuid()) $$;
create function pg_temp.p1_expect(query text,code text,label text) returns void language plpgsql as $$
declare actual text; begin
 begin execute query; exception when others then
  get stacked diagnostics actual=returned_sqlstate;
  if actual=code then return; end if;
  raise exception 'P1_WRONG_SQLSTATE % expected %, got %: %',label,code,actual,sqlerrm;
 end;
 raise exception 'P1_EXPECTED_DENIAL: %',label;
end $$;
-- Owner-only full row fingerprints: successful denied DML is never excused by RLS
-- filtering, schema absence, FK errors, or generic P0001 wording.
create function pg_temp.p1_fingerprint() returns jsonb language plpgsql as $$
declare t record; value text; result jsonb:='{}'; begin
 for t in select c.relname,n.nspname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where c.relkind in ('r','p') and n.nspname in ('public','auth','private') order by n.nspname,c.relname loop
  execute format('select md5(coalesce(string_agg(to_jsonb(x)::text,chr(10) order by to_jsonb(x)::text),'''')) from %I.%I x',t.nspname,t.relname) into value;
  result:=result||jsonb_build_object(t.nspname||'.'||t.relname,value);
 end loop; return result; end $$;
insert into p1_test_context values('before',pg_temp.p1_fingerprint());
savepoint p1_all_effects;
select pg_temp.p1_assert(current_user in ('postgres','supabase_admin'),'owner client prerequisite');
select pg_temp.p1_assert(not exists(select 1 from public.inventory_pilot_scopes where id=${sqlLiteral(manifest.scope_id)}::uuid),'unregistered pristine scope prerequisite');

${actorSql(admin)}
select pg_temp.p1_put('registered',pg_temp.p1_control('register_scope',jsonb_build_object('manifest',pg_temp.p1_get('manifest'))));
select pg_temp.p1_assert(pg_temp.p1_get('registered')->>'phase'='OPENING_READY','registration phase');
select pg_temp.p1_assert(public.inventory_pilot_read(${sqlLiteral(manifest.scope_id)}::uuid)#>'{scope,manifest}'=pg_temp.p1_get('manifest'),'full frozen manifest is durable');
${actorSql(staff[0])}
select pg_temp.p1_expect('select pg_temp.p1_control(''confirm_opening'')','42501','Staff cannot adopt Admin opening');
${actorSql(admin)}
select pg_temp.p1_put('confirmed',pg_temp.p1_control('confirm_opening'));
select pg_temp.p1_assert((public.inventory_pilot_read(${sqlLiteral(manifest.scope_id)}::uuid)#>>'{scope,opening_confirmed}')::boolean,'opening adoption durable');
select pg_temp.p1_assert((select count(*)=1 and bool_and(b->>'asset_id'=${sqlLiteral(manifest.asset.id)} and b->>'opening_event_id'=${sqlLiteral(manifest.asset_opening_result.event_id)} and b->>'intake_reference'=${sqlLiteral(manifest.opening.reference)} and b->>'row_key'=${sqlLiteral(manifest.asset.row_key)}) from jsonb_array_elements(public.inventory_pilot_read(${sqlLiteral(manifest.scope_id)}::uuid)->'bindings') b),'existing asset binds to original physical opening provenance');
select pg_temp.p1_assert(public.inventory_command('confirm_opening_balance',pg_temp.p1_meta(${jsonSql(manifest.opening_payload)}),${sqlLiteral(manifest.opening_retry_key)}::uuid)=${jsonSql(manifest.opening_result)},'original opening retry including transport pilot preserves IDs');
select pg_temp.p1_assert(public.equipment_asset_command('open_asset',pg_temp.p1_meta(pg_temp.p1_get('asset-opening-payload')),${sqlLiteral(manifest.asset_opening_retry_key)}::uuid)=${jsonSql(manifest.asset_opening_result)},'original asset opening retry preserves IDs');
select pg_temp.p1_expect(format('select public.inventory_command(''confirm_opening_balance'',%L::jsonb,%L::uuid)',pg_temp.p1_meta(${jsonSql(manifest.opening_payload)}||'{"provenance_note":"changed"}'::jsonb),${sqlLiteral(manifest.opening_retry_key)}),'23505','wrong retry payload');
select pg_temp.p1_expect(format('select public.inventory_command(''confirm_opening_balance'',%L::jsonb,%L::uuid)',${jsonSql(manifest.opening_payload)}||jsonb_build_object('pilot',pg_temp.p1_get('pilot')||'{"scope_version":0}'::jsonb),${sqlLiteral(manifest.opening_retry_key)}),'23505','explicit wrong pilot rejected even on exact replay');
select pg_temp.p1_expect(format('select public.equipment_asset_command(''set_asset_state'',%L::jsonb,gen_random_uuid())',pg_temp.p1_meta(jsonb_build_object('id',${sqlLiteral(manifest.asset.id)},'expected_revision',public.equipment_asset_read('detail',jsonb_build_object('id',${sqlLiteral(manifest.asset.id)}))#>'{rows,0,revision}','location_id',${sqlLiteral(manifest.location.id)},'custodian_id',${sqlLiteral(staff[0])},'operational_status','under_maintenance','reason','Preactive physical denial','evidence_note','Must deny'))),'42501','OPENING_READY cannot perform normal asset physical mutation');
select pg_temp.p1_put('reconcile-opening',pg_temp.p1_control('reconcile'));
select pg_temp.p1_expect('select pg_temp.p1_control(''activate'')','42501','writer evidence is required');
select pg_temp.p1_assert(public.inventory_pilot_read(${sqlLiteral(manifest.scope_id)}::uuid)#>>'{scope,phase}'='OPENING_READY','missing exclusions never activates');
${P1_WRITERS.map(([writer, allowed]) => `select pg_temp.p1_control('record_writer',${jsonSql({ writer_id: writer, allowed })});`).join("\n")}
select pg_temp.p1_put('reconcile-ready',pg_temp.p1_control('reconcile'));
select pg_temp.p1_assert((pg_temp.p1_get('reconcile-ready')#>>'{reconciliation,ready}')::boolean,'full reconciliation ready');
select pg_temp.p1_assert((pg_temp.p1_get('reconcile-ready')#>>'{reconciliation,opening_complete}')::boolean,'opening complete');
select pg_temp.p1_assert(pg_temp.p1_control('activate')->>'phase'='ACTIVE','activate after all eight writers');
select pg_temp.p1_assert((select count(*)=8 and bool_and(w->>'recorded_at' is not null and nullif(btrim(w->>'evidence_reference'),'') is not null) from jsonb_array_elements(public.inventory_pilot_read(${sqlLiteral(manifest.scope_id)}::uuid)->'writers') w),'eight evidenced writers incl prep transfer');

-- Setup ONLY transient workflow metadata, using named baseline identities.
reset role;
update public.profiles set phone='0901234567' where id=${sqlLiteral(admin)}::uuid;
insert into public.user_roles(user_id,role) values(${sqlLiteral(staff[1])}::uuid,'lecturer');
do $$ declare room uuid:=gen_random_uuid(); course uuid:=gen_random_uuid(); schedule uuid:=gen_random_uuid(); rt uuid; d uuid; i jsonb; begin
 rt:='40000000-0000-0000-0000-000000000001'::uuid;
 insert into public.rooms(id,room_code,building_code,room_type_id) values(room,'P1-SMOKE-'||room,'P1-MOCK',rt);
 insert into public.courses(id,course_code,course_name) values(course,'P1-SMOKE-'||course,'Rolled-back nursing P1 smoke');
 insert into public.class_schedules(id,course_id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,schedule_date,start_time,end_time,semester,created_by,source,schedule_status,student_count,published_by,published_at)
 values(schedule,course,'P1-SMOKE-'||course,'Rolled-back nursing P1 smoke',room,${sqlLiteral(staff[1])}::uuid,current_date+60,'09:00','11:00','HK1',${sqlLiteral(admin)}::uuid,'manual','published',20,${sqlLiteral(admin)}::uuid,now());
 perform pg_temp.p1_put('schedule',to_jsonb(schedule));
 for i in select value from jsonb_array_elements(pg_temp.p1_get('manifest')->'items') loop
  d:=gen_random_uuid();
  insert into public.equipment_catalog(id,item_name,commercial_name,unit) values(d,'P1 smoke '||(i->>'key'),'P1 smoke demand '||(i->>'key'),'cái');
  perform pg_temp.p1_put('demand-'||(i->>'key'),to_jsonb(d));
 end loop;
end $$;
${actorSql(admin)}
-- Supplier/source are actual approved S1 metadata RPCs, not fake physical intake.
select pg_temp.p1_put('supplier',public.inventory_command('create_inventory_supplier',jsonb_build_object('code','P1-SMOKE-'||gen_random_uuid(),'name','Synthetic rolled-back P1 supplier'),gen_random_uuid()));
do $$ declare item jsonb; source jsonb; begin
 select value into item from jsonb_array_elements(pg_temp.p1_get('manifest')->'items') where value->>'key'='consumable';
 source:=public.inventory_command('create_acquisition_source',jsonb_build_object('source_reference','P1-SMOKE-'||gen_random_uuid(),'supplier_id',pg_temp.p1_get('supplier')->>'id','reference_date',current_date,'lines',jsonb_build_array(jsonb_build_object('line_key','receipt-gloves','catalog_item_id',item->>'id','expected_purchase_quantity','10','purchase_uom_code',item->>'uom','expected_conversion_factor','1','currency_code','VND','unit_cost','1'))),gen_random_uuid());
 perform pg_temp.p1_put('source',source);
 perform pg_temp.p1_put('source-line',public.inventory_read('source_lines',jsonb_build_object('source_id',source->>'id'))#>'{rows,0}');
end $$;
select pg_temp.p1_put('receipt-payload',jsonb_build_object('receipt_reference','P1-SMOKE-'||gen_random_uuid(),'occurred_at',clock_timestamp(),'reason','Actual rolled-back receipt','lines',jsonb_build_array(jsonb_build_object('line_key','receipt-gloves','source_line_id',pg_temp.p1_get('source-line')->>'id','catalog_item_id',pg_temp.p1_get('source-line')->>'catalog_item_id','location_id',${sqlLiteral(manifest.location.id)},'purchase_uom_code',${sqlLiteral(manifest.items.find((i) => i.key === "consumable").uom)},'purchase_quantity','10','conversion_factor','1','good_quantity','10','damaged_quantity','0','expiry_precision','not_required','evidence_note','Synthetic receipt'))));
-- No pilot transport supplied: database resolves the frozen target/actor itself.
select pg_temp.p1_put('receipt',public.inventory_command('receive_stock',pg_temp.p1_get('receipt-payload'),gen_random_uuid()));
select pg_temp.p1_put('receipt-cohort',public.inventory_read('cohorts',jsonb_build_object('item_id',${sqlLiteral(manifest.items.find((i) => i.key === "consumable").id)},'q','receipt-gloves'))#>'{rows,0}');
select pg_temp.p1_assert((pg_temp.p1_get('receipt-cohort')->>'good_balance')::numeric=10 and (pg_temp.p1_get('receipt-cohort')->>'damaged_balance')::numeric=0,'receipt physical 10 good');
select pg_temp.p1_put('condition-payload',jsonb_build_object('location_id',${sqlLiteral(manifest.location.id)},'reason','Actual rolled-back damage','lines',jsonb_build_array(jsonb_build_object('origin_id',pg_temp.p1_get('receipt-cohort')->>'origin_id','expected_version',pg_temp.p1_get('receipt-cohort')->'current_version','expected_stock_revision',pg_temp.p1_get('receipt-cohort')->'stock_revision','from_condition','good','to_condition','damaged','quantity','2'))));
select public.inventory_command('change_stock_condition',pg_temp.p1_meta(pg_temp.p1_get('condition-payload')),gen_random_uuid());
select pg_temp.p1_put('receipt-cohort',public.inventory_read('cohorts',jsonb_build_object('origin_id',pg_temp.p1_get('receipt-cohort')->>'origin_id'))#>'{rows,0}');
select pg_temp.p1_assert((pg_temp.p1_get('receipt-cohort')->>'good_balance')::numeric=8 and (pg_temp.p1_get('receipt-cohort')->>'damaged_balance')::numeric=2,'condition physically moves 2 good to damaged');
select public.inventory_command('reconcile_stocktake',pg_temp.p1_meta(jsonb_build_object('stocktake_reference','P1-SMOKE-'||gen_random_uuid(),'location_id',${sqlLiteral(manifest.location.id)},'count_timestamp',clock_timestamp(),'reason','Observed one fewer glove','evidence_note','Rolled-back synthetic count','lines',jsonb_build_array(jsonb_build_object('origin_id',pg_temp.p1_get('receipt-cohort')->>'origin_id','expected_version',pg_temp.p1_get('receipt-cohort')->'current_version','expected_stock_revision',pg_temp.p1_get('receipt-cohort')->'stock_revision','condition','good','expected_quantity','8','counted_quantity','7')))),gen_random_uuid());
select pg_temp.p1_put('receipt-cohort',public.inventory_read('cohorts',jsonb_build_object('origin_id',pg_temp.p1_get('receipt-cohort')->>'origin_id'))#>'{rows,0}');
select pg_temp.p1_assert((pg_temp.p1_get('receipt-cohort')->>'good_balance')::numeric=7 and (pg_temp.p1_get('receipt-cohort')->>'damaged_balance')::numeric=2,'stocktake removes exactly one good');
select pg_temp.p1_put('asset-state',public.equipment_asset_read('detail',jsonb_build_object('id',${sqlLiteral(manifest.asset.id)}))#>'{rows,0}');
select public.equipment_asset_command('set_asset_state',pg_temp.p1_meta(jsonb_build_object('id',${sqlLiteral(manifest.asset.id)},'expected_revision',pg_temp.p1_get('asset-state')->'revision','location_id',${sqlLiteral(manifest.location.id)},'custodian_id',${sqlLiteral(staff[0])},'operational_status','under_maintenance','reason','Synthetic maintenance','evidence_note','Rollback only')),gen_random_uuid());
select pg_temp.p1_put('asset-maintenance',public.equipment_asset_read('detail',jsonb_build_object('id',${sqlLiteral(manifest.asset.id)}))#>'{rows,0}');
select pg_temp.p1_assert(pg_temp.p1_get('asset-maintenance')->>'operational_status'='under_maintenance' and not (pg_temp.p1_get('asset-maintenance')->>'eligible')::boolean,'asset becomes ineligible under maintenance');
select public.equipment_asset_command('set_asset_state',pg_temp.p1_meta(jsonb_build_object('id',${sqlLiteral(manifest.asset.id)},'expected_revision',pg_temp.p1_get('asset-maintenance')->'revision','location_id',${sqlLiteral(manifest.location.id)},'custodian_id',${sqlLiteral(staff[0])},'operational_status','ready','reason','Synthetic maintenance finished','evidence_note','Rollback only')),gen_random_uuid());

-- Actual published nursing request: Admin registrant, named Staff 2 responsible lecturer.
select pg_temp.p1_put('request',to_jsonb(public.create_equipment_request_with_items((pg_temp.p1_get('schedule')#>>'{}')::uuid,'HK1',${sqlLiteral(staff[1])}::uuid,((current_date+60)::text||' 09:00+07')::timestamptz,((current_date+60)::text||' 11:00+07')::timestamptz,null,'Rolled-back P1 nursing workflow',jsonb_build_array(
 jsonb_build_object('skill_name','P1 nursing','catalog_item_id',pg_temp.p1_get('demand-reusable')#>>'{}','quantity',4),
 jsonb_build_object('skill_name','P1 nursing','catalog_item_id',pg_temp.p1_get('demand-serialized')#>>'{}','quantity',1)))));
do $$ declare key text; item jsonb; r uuid:=(pg_temp.p1_get('request')#>>'{}')::uuid; w jsonb; begin
 for key in select unnest(array['reusable','serialized']) loop
  select value into item from jsonb_array_elements(pg_temp.p1_get('manifest')->'items') where value->>'key'=key;
  w:=public.equipment_preparation_read(r);
  perform pg_temp.p1_put('mapping-'||key,public.equipment_preparation_command('map_item',r,pg_temp.p1_meta(jsonb_build_object('expected_revision',w#>'{request,revision}','catalog_item_id',pg_temp.p1_get('demand-'||key)#>>'{}','inventory_item_id',item->>'id','base_units_per_requested_unit','1','reason','Explicit mock P1 mapping')),gen_random_uuid()));
 end loop;
end $$;
${actorSql(staff[0])}
select pg_temp.p1_put('token',to_jsonb(gen_random_uuid()));
select public.equipment_preparation_command('start',(pg_temp.p1_get('request')#>>'{}')::uuid,pg_temp.p1_meta(jsonb_build_object('expected_revision',public.equipment_preparation_read((pg_temp.p1_get('request')#>>'{}')::uuid)#>'{request,revision}','lock_token',pg_temp.p1_get('token')#>>'{}')),gen_random_uuid());
-- A real valid out-of-scope destination tests BOTH transfer endpoint boundaries.
reset role;
insert into public.inventory_storage_locations(code,name) values('P1-SMOKE-OUT-'||gen_random_uuid(),'Rollback-only outside location') returning id;
select pg_temp.p1_put('outside-location',to_jsonb(id)) from public.inventory_storage_locations where name='Rollback-only outside location';
select pg_temp.p1_put('denial-before',pg_temp.p1_fingerprint());
${actorSql(staff[0])}
select pg_temp.p1_expect(format('select public.inventory_command(''transfer_stock'',%L::jsonb,gen_random_uuid())',pg_temp.p1_meta(jsonb_build_object('source_location_id',${sqlLiteral(manifest.location.id)},'target_location_id',pg_temp.p1_get('outside-location')#>>'{}','reason','Boundary denial','lines',jsonb_build_array(jsonb_build_object('origin_id',pg_temp.p1_get('receipt-cohort')->>'origin_id','expected_version',pg_temp.p1_get('receipt-cohort')->'current_version','expected_stock_revision',pg_temp.p1_get('receipt-cohort')->'stock_revision','condition','good','quantity','1'))))),'42501','S2 mixed boundary transfer');
select pg_temp.p1_expect(format('select public.equipment_preparation_transfer(%L::uuid,%L::jsonb,gen_random_uuid())',pg_temp.p1_get('request')#>>'{}',pg_temp.p1_meta(jsonb_build_object('expected_revision',public.equipment_preparation_read((pg_temp.p1_get('request')#>>'{}')::uuid)#>'{request,revision}','lock_token',pg_temp.p1_get('token')#>>'{}','source_location_id',${sqlLiteral(manifest.location.id)},'destination_location_id',pg_temp.p1_get('outside-location')#>>'{}','inventory_item_id',${sqlLiteral(manifest.items.find((i) => i.key === "reusable").id)},'quantity','1','condition','good','reason','Boundary denial','physical_confirmation',true))),'42501','S4 mixed boundary transfer');
reset role;
select pg_temp.p1_assert(pg_temp.p1_fingerprint()=pg_temp.p1_get('denial-before'),'both boundary transfers roll back every row effect');
${actorSql(staff[0])}
do $$ declare r uuid:=(pg_temp.p1_get('request')#>>'{}')::uuid; w jsonb; line jsonb; key text; planned text; assets jsonb; plan jsonb:='[]'; issue jsonb:='[]'; begin
 w:=public.equipment_preparation_read(r);
 for line in select value from jsonb_array_elements(w->'lines') loop
  key:=case when line->>'catalog_item_id'=pg_temp.p1_get('demand-reusable')#>>'{}' then 'reusable' else 'serialized' end;
  planned:=case when key='reusable' then '4' else '1' end;
  assets:=case when key='serialized' then jsonb_build_array(${sqlLiteral(manifest.asset.id)}) else '[]'::jsonb end;
  perform pg_temp.p1_put('line-'||key,line);
  plan:=plan||jsonb_build_array(jsonb_build_object('line_id',line->>'id','planned_quantity',planned,'reviewed_revision',line->'line_revision','shortage_reason','','allocations',jsonb_build_array(jsonb_build_object('mapping_id',pg_temp.p1_get('mapping-'||key)->>'mapping_id','location_id',${sqlLiteral(manifest.location.id)},'base_quantity',planned,'asset_ids',assets))));
  issue:=issue||jsonb_build_array(jsonb_build_object('line_id',line->>'id','mapping_id',pg_temp.p1_get('mapping-'||key)->>'mapping_id','location_id',${sqlLiteral(manifest.location.id)},'quantity',planned,'asset_ids',assets));
 end loop;
 perform public.equipment_preparation_command('confirm',r,pg_temp.p1_meta(jsonb_build_object('expected_revision',w#>'{request,revision}','lock_token',pg_temp.p1_get('token')#>>'{}','draft_revision',w#>'{preparation,revision}','plan',jsonb_build_object('lines',plan))),gen_random_uuid());
 perform pg_temp.p1_put('handover-lines',issue);
 perform pg_temp.p1_assert((public.equipment_preparation_read(r)#>>'{preparation,state}')='prepared','actual preparation committed');
 perform pg_temp.p1_assert(not (public.equipment_asset_read('detail',jsonb_build_object('id',${sqlLiteral(manifest.asset.id)}))#>>'{rows,0,available}')::boolean,'exact asset reserved');
 perform pg_temp.p1_put('handover',public.equipment_fulfillment_command('handover',r,pg_temp.p1_meta(jsonb_build_object('expected_revision',0,'business_key','P1-SMOKE-'||gen_random_uuid(),'reason','Actual synthetic physical handover','lines',issue)),gen_random_uuid()));
 w:=public.equipment_fulfillment_read(r);
 perform pg_temp.p1_assert(w->>'status'='handed_over','handover is physical before signature');
 perform pg_temp.p1_assert((select sum((v->>'issued')::numeric)=5 and sum((v->>'due')::numeric)=5 from jsonb_array_elements(w->'issues') v),'four trays plus exact pump issued with full debt');
 perform pg_temp.p1_assert(public.equipment_asset_read('detail',jsonb_build_object('id',${sqlLiteral(manifest.asset.id)}))#>>'{rows,0,operational_status}'='in_use','handover exact asset physically in use');
 perform pg_temp.p1_put('handover-workspace',w);
end $$;
-- Return 2 trays good, 1 damaged, leave 1 due. Return exact pump damaged.
do $$ declare r uuid:=(pg_temp.p1_get('request')#>>'{}')::uuid; w jsonb:=public.equipment_fulfillment_read(r); s jsonb; lines jsonb:='[]'; begin
 for s in select value from jsonb_array_elements(w->'issues') loop
  if s->>'asset_id' is null then
   lines:=lines||jsonb_build_array(jsonb_build_object('issue_slice_id',s->>'id','location_id',${sqlLiteral(manifest.location.id)},'condition','good','quantity','2'),jsonb_build_object('issue_slice_id',s->>'id','location_id',${sqlLiteral(manifest.location.id)},'condition','damaged','quantity','1'));
   perform pg_temp.p1_put('tray-slice',s);
  else lines:=lines||jsonb_build_array(jsonb_build_object('issue_slice_id',s->>'id','location_id',${sqlLiteral(manifest.location.id)},'condition','damaged','quantity','1')); end if;
 end loop;
 perform pg_temp.p1_put('initial-return',public.equipment_fulfillment_command('initial_return',r,pg_temp.p1_meta(jsonb_build_object('expected_revision',w->'revision','business_key','P1-SMOKE-'||gen_random_uuid(),'reason','Actual good and damaged returns','lines',lines)),gen_random_uuid()));
 w:=public.equipment_fulfillment_read(r);
 perform pg_temp.p1_assert((select sum((v->>'returned')::numeric)=4 and sum((v->>'due')::numeric)=1 from jsonb_array_elements(w->'issues') v),'initial return leaves exactly one tray outstanding');
 perform pg_temp.p1_assert(public.equipment_asset_read('detail',jsonb_build_object('id',${sqlLiteral(manifest.asset.id)}))#>>'{rows,0,operational_status}'='damaged','damaged pump return observed');
 perform pg_temp.p1_put('recover-payload',jsonb_build_object('expected_revision',w->'revision','business_key','P1-SMOKE-'||gen_random_uuid(),'reason','Recover outstanding synthetic tray','lines',jsonb_build_array(jsonb_build_object('issue_slice_id',pg_temp.p1_get('tray-slice')->>'id','location_id',${sqlLiteral(manifest.location.id)},'condition','good','quantity','3'))));
 perform pg_temp.p1_put('recover-retry',to_jsonb(gen_random_uuid()));
 -- A VALID outstanding physical recovery is denied while PAUSED, not an
 -- over-return payload whose incidental validation could hide a missing gate.
 perform set_config('request.jwt.claims',${jsonSql({ sub: admin, role: "authenticated" })}::text,true);
 perform pg_temp.p1_control('pause');
 perform set_config('request.jwt.claims',${jsonSql({ sub: staff[0], role: "authenticated" })}::text,true);
 perform pg_temp.p1_expect(format('select public.equipment_fulfillment_command(''recover'',%L::uuid,%L::jsonb,%L::uuid)',r,pg_temp.p1_meta(pg_temp.p1_get('recover-payload')),pg_temp.p1_get('recover-retry')#>>'{}'),'42501','PAUSED valid physical recovery');
 perform pg_temp.p1_assert(public.equipment_fulfillment_read(r)=w,'PAUSED rejected valid recovery preserves event revision debt and signatures');
 perform set_config('request.jwt.claims',${jsonSql({ sub: admin, role: "authenticated" })}::text,true);
 perform pg_temp.p1_control('reconcile'); perform pg_temp.p1_control('activate');
 perform set_config('request.jwt.claims',${jsonSql({ sub: staff[0], role: "authenticated" })}::text,true);
 perform pg_temp.p1_put('recovered',public.equipment_fulfillment_command('recover',r,pg_temp.p1_meta(pg_temp.p1_get('recover-payload')),(pg_temp.p1_get('recover-retry')#>>'{}')::uuid));
 w:=public.equipment_fulfillment_read(r);
 perform pg_temp.p1_assert((select sum((v->>'returned')::numeric)=5 and sum((v->>'due')::numeric)=0 from jsonb_array_elements(w->'issues') v),'cumulative recovery adds one, not three');
 perform pg_temp.p1_assert((select (v->>'good_balance')::numeric=11 and (v->>'damaged_balance')::numeric=2 from jsonb_array_elements(public.inventory_read('cohorts',jsonb_build_object('origin_id',${sqlLiteral(manifest.facts.find((f) => f.row_key === "trays").origin_id)}))->'rows') v),'tray physical projection is 11 good plus 2 damaged');
end $$;
-- A second valid new nursing request remains draft for the PAUSED reservation gate.

${actorSql(admin)}
reset role;
do $$ declare sid uuid:=gen_random_uuid(); begin
 insert into public.class_schedules(id,course_id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,schedule_date,start_time,end_time,semester,created_by,source,schedule_status,student_count,published_by,published_at)
 select sid,course_id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,schedule_date+1,start_time,end_time,semester,created_by,source,schedule_status,student_count,published_by,published_at
 from public.class_schedules where class_schedules.id=(pg_temp.p1_get('schedule')#>>'{}')::uuid;
 perform pg_temp.p1_put('schedule-paused',to_jsonb(sid));
end $$;
${actorSql(admin)}
select pg_temp.p1_put('request-paused',to_jsonb(public.create_equipment_request_with_items((pg_temp.p1_get('schedule-paused')#>>'{}')::uuid,'HK1',${sqlLiteral(staff[1])}::uuid,((current_date+61)::text||' 09:00+07')::timestamptz,((current_date+61)::text||' 11:00+07')::timestamptz,null,'Paused reservation acceptance',jsonb_build_array(jsonb_build_object('skill_name','P1 nursing','catalog_item_id',pg_temp.p1_get('demand-reusable')#>>'{}','quantity',1)))));
${actorSql(staff[0])}
select pg_temp.p1_put('token-paused',to_jsonb(gen_random_uuid()));
select public.equipment_preparation_command('start',(pg_temp.p1_get('request-paused')#>>'{}')::uuid,pg_temp.p1_meta(jsonb_build_object('expected_revision',public.equipment_preparation_read((pg_temp.p1_get('request-paused')#>>'{}')::uuid)#>'{request,revision}','lock_token',pg_temp.p1_get('token-paused')#>>'{}')),gen_random_uuid());
do $$ declare w jsonb:=public.equipment_preparation_read((pg_temp.p1_get('request-paused')#>>'{}')::uuid); line jsonb; begin
 line:=w#>'{lines,0}';
 perform pg_temp.p1_put('paused-confirm-payload',jsonb_build_object('expected_revision',w#>'{request,revision}','lock_token',pg_temp.p1_get('token-paused')#>>'{}','draft_revision',w#>'{preparation,revision}','plan',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('line_id',line->>'id','planned_quantity','1','reviewed_revision',line->'line_revision','shortage_reason','','allocations',jsonb_build_array(jsonb_build_object('mapping_id',pg_temp.p1_get('mapping-reusable')->>'mapping_id','location_id',${sqlLiteral(manifest.location.id)},'base_quantity','1','asset_ids','[]'::jsonb)))))));
end $$;
${actorSql(admin)}
select pg_temp.p1_control('pause');
select pg_temp.p1_assert(public.inventory_pilot_read(${sqlLiteral(manifest.scope_id)}::uuid)#>>'{scope,phase}'='PAUSED','manual pause durable');
select pg_temp.p1_put('paused-reconcile',pg_temp.p1_control('reconcile'));
select pg_temp.p1_assert((pg_temp.p1_get('paused-reconcile')#>>'{reconciliation,ready}')::boolean,'PAUSED reconciliation remains possible');
reset role;
select pg_temp.p1_put('denial-before',pg_temp.p1_fingerprint());
${actorSql(admin)}
select pg_temp.p1_expect(format('select public.inventory_command(''receive_stock'',%L::jsonb,gen_random_uuid())',pg_temp.p1_meta(pg_temp.p1_get('receipt-payload')||jsonb_build_object('receipt_reference','P1-SMOKE-'||gen_random_uuid()))),'42501','PAUSED physical receipt');
select pg_temp.p1_expect(format('select public.equipment_asset_command(''set_asset_state'',%L::jsonb,gen_random_uuid())',pg_temp.p1_meta(jsonb_build_object('id',${sqlLiteral(manifest.asset.id)},'expected_revision',public.equipment_asset_read('detail',jsonb_build_object('id',${sqlLiteral(manifest.asset.id)}))#>'{rows,0,revision}','location_id',${sqlLiteral(manifest.location.id)},'custodian_id',${sqlLiteral(staff[0])},'operational_status','ready','reason','Paused repair','evidence_note','Must deny'))),'42501','PAUSED asset mutation');
select pg_temp.p1_expect(format('select public.inventory_command(''confirm_opening_balance'',%L::jsonb,gen_random_uuid())',pg_temp.p1_meta(${jsonSql(manifest.opening_payload)}||jsonb_build_object('cutover_key','P1-SMOKE-'||gen_random_uuid()))),'42501','PAUSED new Admin opening');
${actorSql(staff[0])}
select pg_temp.p1_expect(format('select public.equipment_preparation_command(''confirm'',%L::uuid,%L::jsonb,gen_random_uuid())',pg_temp.p1_get('request-paused')#>>'{}',pg_temp.p1_meta(pg_temp.p1_get('paused-confirm-payload'))),'42501','PAUSED physical allocation/reservation confirmation');
${actorSql(staff[0])}
select pg_temp.p1_assert(public.equipment_fulfillment_command('recover',(pg_temp.p1_get('request')#>>'{}')::uuid,pg_temp.p1_meta(pg_temp.p1_get('recover-payload')),(pg_temp.p1_get('recover-retry')#>>'{}')::uuid)=pg_temp.p1_get('recovered'),'PAUSED exact replay is no new physical effect');
reset role;
select pg_temp.p1_assert(pg_temp.p1_fingerprint()=pg_temp.p1_get('denial-before'),'PAUSED denials and replay have no side effects');
-- Zero-physical signing survives PAUSED; observable completion follows signatures.
${actorSql(admin)}
do $$ declare r uuid:=(pg_temp.p1_get('request')#>>'{}')::uuid; w jsonb; e jsonb; begin
 for e in select value from jsonb_array_elements(public.equipment_fulfillment_read(r)->'events') where (value->>'signature_required')::boolean loop
  w:=public.equipment_fulfillment_read(r);
  perform public.equipment_fulfillment_command('sign',r,pg_temp.p1_meta(jsonb_build_object('expected_revision',w->'revision','event_id',e->>'id','snapshot_hash',e->>'snapshot_hash','signature','data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=')),gen_random_uuid());
 end loop;
 perform pg_temp.p1_assert(public.equipment_fulfillment_read(r)->>'status'='completed','PAUSED signatures complete settled request');
end $$;
-- Correct phase for identity denials isolates them from generic PAUSED rejection.
select pg_temp.p1_control('reconcile'); select pg_temp.p1_control('activate');
reset role;
do $$ declare outsider uuid:=gen_random_uuid(); begin
 insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(outsider,'p1-outsider-'||outsider||'@example.invalid','{"preapproved":true,"synthetic":true}'::jsonb,'{"full_name":"P1 rolled-back outside Admin"}'::jsonb);
 insert into public.profiles(id,email,full_name,is_active) values(outsider,'p1-outsider-'||outsider||'@example.invalid','P1 rolled-back outside Admin',true) on conflict(id) do nothing;
 insert into public.user_roles(user_id,role) values(outsider,'admin');
 perform pg_temp.p1_put('outside-actor',to_jsonb(outsider));
end $$;
reset role;
select pg_temp.p1_put('denial-before',pg_temp.p1_fingerprint());
${actorSql(admin)}
${[
  ["scope_version", 0, "23505"],
  ["project_ref", "bwhiivfhezoozrzvchmm", "42501"],
  ["scope_id", "00000000-0000-0000-0000-000000000001", "42501"],
  ["manifest_id", "00000000-0000-0000-0000-000000000002", "42501"],
]
  .map(
    ([key, value, code]) =>
      `select pg_temp.p1_expect(format('select public.inventory_command(''receive_stock'',%L::jsonb,gen_random_uuid())',pg_temp.p1_get('receipt-payload')||jsonb_build_object('receipt_reference','P1-SMOKE-'||gen_random_uuid(),'pilot',pg_temp.p1_get('pilot')||${jsonSql({ [key]: value })})),'${code}','wrong ${key}');`,
  )
  .join("\n")}
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select pg_temp.p1_expect(format('select public.inventory_command(''receive_stock'',%L::jsonb,gen_random_uuid())',pg_temp.p1_meta(pg_temp.p1_get('receipt-payload')||jsonb_build_object('receipt_reference','P1-SMOKE-'||gen_random_uuid()))),'42501','unknown actor cannot write scoped stock');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.p1_get('outside-actor')#>>'{}','role','authenticated')::text,true);
select pg_temp.p1_expect(format('select public.inventory_command(''receive_stock'',%L::jsonb,gen_random_uuid())',pg_temp.p1_meta(pg_temp.p1_get('receipt-payload')||jsonb_build_object('receipt_reference','P1-SMOKE-'||gen_random_uuid()))),'42501','active real Admin outside frozen actor list denied');
reset role;
select pg_temp.p1_assert(pg_temp.p1_fingerprint()=pg_temp.p1_get('denial-before'),'identity denials are atomic');

-- Owner, service role, forged GUC and private-core attacks use actual scoped rows.
${actorSql(admin)} reset role;
select pg_temp.p1_put('denial-before',pg_temp.p1_fingerprint());
select set_config('app.inventory_command','true',true); select set_config('app.s4_command','true',true);
select set_config('app.s5_command','true',true); select set_config('app.s4_transfer_work','true',true);
select set_config('app.inventory_pilot_writer','inventory_command',true);
select pg_temp.p1_expect(format('update public.inventory_stock_balances set quantity=quantity+1 where cohort_id=%L::uuid',pg_temp.p1_get('receipt-cohort')->>'origin_id'),'42501','owner forged GUC stock bypass');
select pg_temp.p1_expect(format('update public.equipment_assets set operational_status=''ready'' where id=%L::uuid',${sqlLiteral(manifest.asset.id)}),'42501','owner direct asset bypass');
select pg_temp.p1_expect(format('update public.inventory_pilot_scopes set phase=''PAUSED'' where id=%L::uuid',${sqlLiteral(manifest.scope_id)}),'42501','owner direct marker bypass');
select pg_temp.p1_expect('truncate public.inventory_stock_balances','42501','owner truncate physical protection');
select pg_temp.p1_expect('truncate public.inventory_pilot_events','42501','owner truncate durable audit protection');
set local role service_role;
select pg_temp.p1_expect(format('update public.inventory_stock_balances set quantity=quantity+1 where cohort_id=%L::uuid',pg_temp.p1_get('receipt-cohort')->>'origin_id'),'42501','service-role direct DML');
select pg_temp.p1_expect('insert into private.inventory_pilot_writer_context(transaction_id,backend_pid,writer_id,operation,payload) values(txid_current(),pg_backend_pid(),''inventory_command'',''receive_stock'',''{}'')','42501','service role cannot mint context');
select pg_temp.p1_expect('truncate public.inventory_stock_balances','42501','service-role truncate');
select pg_temp.p1_expect('select private.p1_inventory_core(''receive_stock'',''{}''::jsonb,gen_random_uuid())','42501','service private inventory core');
select pg_temp.p1_expect('select private.p1_asset_core(''open_asset'',''{}''::jsonb,gen_random_uuid())','42501','service private asset core');
select pg_temp.p1_expect('select private.p1_preparation_core(''start'',gen_random_uuid(),''{}''::jsonb,gen_random_uuid())','42501','service private preparation core');
select pg_temp.p1_expect('select private.p1_transfer_core(gen_random_uuid(),''{}''::jsonb,gen_random_uuid())','42501','service private transfer core');
select pg_temp.p1_expect('select private.p1_fulfillment_core(''handover'',gen_random_uuid(),''{}''::jsonb,gen_random_uuid())','42501','service private fulfillment core');
${actorSql(admin)}
do $$ declare f record; begin
 for f in select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args, p.pronargs from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='private' and (p.proname like 'p1_%' or p.proname like '%pilot%core%' or p.proname in ('inventory_command_core','equipment_asset_command_core','equipment_preparation_command_core','equipment_preparation_transfer_core','equipment_fulfillment_command_core')) loop
  perform pg_temp.p1_assert(not has_function_privilege('authenticated',f.oid,'EXECUTE') and not has_function_privilege('service_role',f.oid,'EXECUTE'),'private helper/core execute not granted: '||f.proname);
 end loop;
 perform pg_temp.p1_expect('select private.p1_enter(''inventory_command'',''receive_stock'',''{}''::jsonb,null::uuid)','42501','authenticated private context entry');
 perform pg_temp.p1_expect('select private.p1_inventory_core(''receive_stock'',''{}''::jsonb,gen_random_uuid())','42501','authenticated private inventory core');
 perform pg_temp.p1_expect('select private.p1_asset_core(''open_asset'',''{}''::jsonb,gen_random_uuid())','42501','authenticated private asset core');
 perform pg_temp.p1_expect('select private.p1_preparation_core(''start'',gen_random_uuid(),''{}''::jsonb,gen_random_uuid())','42501','authenticated private preparation core');
 perform pg_temp.p1_expect('select private.p1_transfer_core(gen_random_uuid(),''{}''::jsonb,gen_random_uuid())','42501','authenticated private transfer core');
 perform pg_temp.p1_expect('select private.p1_fulfillment_core(''handover'',gen_random_uuid(),''{}''::jsonb,gen_random_uuid())','42501','authenticated private fulfillment core');
end $$;
reset role;
select pg_temp.p1_assert(pg_temp.p1_fingerprint()=pg_temp.p1_get('denial-before'),'owner/service/GUC/private attacks leave all durable data unchanged');
select set_config('app.inventory_command','',true); select set_config('app.s4_command','',true);
select set_config('app.s5_command','',true); select set_config('app.s4_transfer_work','',true);
select set_config('app.inventory_pilot_writer','',true);
${actorSql(admin)}
select pg_temp.p1_put('dual-write',pg_temp.p1_control('report_dual_write',jsonb_build_object('writer_id','legacy','physical_reference','P1-MOCK-ACC2B31A-observed-manual-count')));
select pg_temp.p1_assert(pg_temp.p1_get('dual-write')->>'phase'='PAUSED','dual-write pauses in same committed command result');
select pg_temp.p1_assert(exists(select 1 from jsonb_array_elements(public.inventory_pilot_read(${sqlLiteral(manifest.scope_id)}::uuid)->'unresolved_events') e where e->>'id'=pg_temp.p1_get('dual-write')->>'event_id'),'dual-write unresolved event durable read');
select pg_temp.p1_put('unresolved-reconcile',pg_temp.p1_control('reconcile'));
select pg_temp.p1_assert(not (pg_temp.p1_get('unresolved-reconcile')#>>'{reconciliation,ready}')::boolean,'unresolved dual-write reconciliation not ready');
select pg_temp.p1_expect('select pg_temp.p1_control(''activate'')','42501','unresolved event blocks activation');
select pg_temp.p1_control('resolve_discrepancy',jsonb_build_object('related_event_id',pg_temp.p1_get('dual-write')->>'event_id'));
select pg_temp.p1_put('resolved-reconcile',pg_temp.p1_control('reconcile'));
select pg_temp.p1_assert((pg_temp.p1_get('resolved-reconcile')#>>'{reconciliation,ready}')::boolean,'fresh reconciliation after resolution ready');
select pg_temp.p1_assert(pg_temp.p1_control('activate')->>'phase'='ACTIVE','resolved fresh reconciliation reactivates');
select pg_temp.p1_put('discrepancy',pg_temp.p1_control('report_discrepancy',jsonb_build_object('physical_reference','P1-MOCK-ACC2B31A-discrepancy-smoke')));
select pg_temp.p1_assert(public.inventory_pilot_read(${sqlLiteral(manifest.scope_id)}::uuid)#>>'{scope,phase}'='PAUSED','ordinary discrepancy also pauses durably');
select pg_temp.p1_control('resolve_discrepancy',jsonb_build_object('related_event_id',pg_temp.p1_get('discrepancy')->>'event_id'));
select pg_temp.p1_control('reconcile');
select pg_temp.p1_assert(public.inventory_pilot_read(${sqlLiteral(manifest.scope_id)}::uuid)#>>'{scope,phase}'='PAUSED','safe final marker stays PAUSED');
select pg_temp.p1_assert(public.inventory_pilot_read(${sqlLiteral(manifest.scope_id)}::uuid)->'unresolved_events'='[]'::jsonb,'all acceptance discrepancies resolved');
reset role;
-- No double-post opening; actual ledger/projection equality after complete workflow.
select pg_temp.p1_assert((select count(*)=6 from public.inventory_stock_origins where opening_batch_id=${sqlLiteral(manifest.opening_result.opening_batch_id)}::uuid),'opening adopted without duplicate origins');
select pg_temp.p1_assert((select count(*)=1 from public.equipment_assets where intake_kind='open' and intake_reference=${sqlLiteral(manifest.opening.reference)} and row_key=${sqlLiteral(manifest.asset.row_key)}),'asset adoption and replays never create another exact physical identity');
select pg_temp.p1_assert(not exists(select 1 from public.inventory_stock_balances b join public.inventory_stock_origins o on o.id=b.cohort_id where o.catalog_item_id=${sqlLiteral(manifest.asset.catalog_item_id)}::uuid and b.quantity<>0),'serialized asset never double-counts in quantity stock');
select pg_temp.p1_assert(not exists(select 1 from public.inventory_stock_balances b join public.inventory_stock_origins o on o.id=b.cohort_id where o.catalog_item_id=any(array[${manifest.items.map((i) => sqlLiteral(i.id)).join(",")}]::uuid[]) and b.quantity<>(select coalesce(sum(l.quantity_delta),0) from public.inventory_transaction_lines l where l.cohort_id=b.cohort_id and l.location_id=b.location_id and l.condition=b.condition)),'every scoped balance equals physical ledger');
select jsonb_build_object('kind','ACTUAL_P1_RPC_SMOKE_BEFORE_ROLLBACK','scope_id',${sqlLiteral(manifest.scope_id)},'final_phase','PAUSED','receipt_good',7,'receipt_damaged',2,'tray_good',11,'tray_damaged',2,'pump_operational_status','damaged','outstanding_return',0);
rollback to savepoint p1_all_effects;
select pg_temp.p1_assert(pg_temp.p1_fingerprint()=pg_temp.p1_get('before'),'ROLLBACK restores all public/auth/private durable rows including roles phone stock replays audit and outbox');
select jsonb_build_object('kind','P1_RPC_SMOKE_ROLLBACK_INTEGRITY','scope_id',${sqlLiteral(manifest.scope_id)},'rollback_integrity',true);
rollback;`;
}
