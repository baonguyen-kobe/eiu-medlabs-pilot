import { randomUUID } from "node:crypto";
import {
  actorSql,
  jsonSql,
  sqlLiteral,
  P1_WRITERS,
} from "./inventory-p1-runtime.mjs";

// Local-only, rollback-only contract counterpart. Never an operational manifest.
export function buildP1RealOpeningSql(baseline) {
  const m = structuredClone(baseline);
  const code = `P1-REAL-TEST-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  m.scope_id = randomUUID();
  m.manifest_id = randomUUID();
  m.scope_code = code;
  m.synthetic = false;
  m.dataset_kind = "real";
  m.real_activation = false;
  m.location = {
    ...m.location,
    id: randomUUID(),
    code: `${code}-LOC`,
    name: `${code} rollback-only location`,
    synthetic: false,
  };
  m.users = m.users.map((u) => ({
    ...u,
    id: randomUUID(),
    email: `gate-${randomUUID()}@example.test`,
    synthetic: false,
    interactive_login: true,
  }));
  const admin = m.users.find((u) => u.role === "admin").id;
  const staff = m.users.find((u) => u.role === "staff").id;
  const replacements = new Map();
  m.items = m.items.map((i) => {
    const id = randomUUID();
    replacements.set(i.id, id);
    return {
      ...i,
      id,
      code: `${code}-${i.key.toUpperCase()}`,
      name: `${code} ${i.key} rollback-only item`,
      synthetic: false,
    };
  });
  m.opening.reference = `${code}-OPEN-V1`;
  m.opening_payload.synthetic = false;
  m.opening_payload.cutover_key = m.opening.reference;
  m.opening_payload.scope_description =
    "Local rollback-only non-synthetic contract fixture";
  m.opening_payload.provenance_note =
    "No real stock; no operational authorization";
  m.opening_payload.lines = m.opening_payload.lines.map((line) => {
    const next = {
      ...line,
      catalog_item_id: replacements.get(line.catalog_item_id),
      location_id: m.location.id,
    };
    for (const key of ["origin_id", "cohort_id", "fact_id"]) delete next[key];
    return next;
  });
  m.asset = {
    ...m.asset,
    catalog_item_id: replacements.get(m.asset.catalog_item_id),
    location_id: m.location.id,
    custodian_id: staff,
    manufacturer_serial: `${code}-SERIAL`,
    synthetic: false,
  };
  for (const key of [
    "id",
    "asset_code",
    "event_id",
    "transaction_id",
    "revision",
  ])
    delete m.asset[key];
  for (const key of [
    "opening_result",
    "asset_opening_result",
    "facts",
    "balances_read",
    "database_checks",
    "serialized_count_checks",
  ])
    delete m[key];
  const pilot = {
    scope_id: m.scope_id,
    manifest_id: m.manifest_id,
    scope_version: m.scope_version,
    project_ref: m.target_project_ref,
  };
  const quantity = { ...m.opening_payload, pilot };
  const asset = {
    catalog_item_id: m.asset.catalog_item_id,
    location_id: m.location.id,
    row_key: m.asset.row_key,
    manufacturer: m.asset.manufacturer,
    model: m.asset.model,
    manufacturer_serial: m.asset.manufacturer_serial,
    custodian_id: staff,
    intake_reference: m.opening.reference,
    operational_status: "ready",
    expiry_precision: "not_required",
    synthetic: false,
    reason: "Local rollback-only opening",
    evidence_note: "Exact local test tuple",
    pilot,
  };
  const uuid = (v) => `${sqlLiteral(v)}::uuid`;
  const control = (op, extra = {}) =>
    `public.inventory_pilot_command(${sqlLiteral(op)},${jsonSql({ pilot, reason: "Local rollback-only contract test", evidence_reference: "LOCAL-TEST-NOT-REAL-ISOLATION", ...extra })},gen_random_uuid())`;
  const opening = (payload = quantity, retry = "gen_random_uuid()") =>
    `public.inventory_command('confirm_opening_balance',${jsonSql(payload)},${retry})`;
  const assetCommand = (payload = asset) =>
    `public.equipment_asset_command('open_asset',${jsonSql(payload)},gen_random_uuid())`;
  const expect = (query, message, state = "42501") =>
    `select pg_temp.real_expect(${sqlLiteral(`select ${query}`)},${sqlLiteral(message)},${sqlLiteral(state)});`;
  const approve = `insert into private.inventory_pilot_owner_approvals(scope_id,scope_version,manifest_id,permission,manifest,approval_reference) values(${uuid(m.scope_id)},${m.scope_version},${uuid(m.manifest_id)},'opening',${jsonSql(m)},'LOCAL-ROLLBACK-TEST-OWNER-AUTHORITY');`;
  return `begin;
create function pg_temp.real_assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'P1_REAL_ASSERT: %',label; end if; end $$;
create function pg_temp.real_expect(query text,message text,code text) returns void language plpgsql as $$
declare actual_code text; actual_message text; begin
 begin execute query; exception when others then
  get stacked diagnostics actual_code=returned_sqlstate,actual_message=message_text;
  if actual_code=code and actual_message like message||'%' then return; end if;
  raise exception 'P1_REAL_WRONG_DENIAL: expected % %, got % %',code,message,actual_code,actual_message;
 end; raise exception 'P1_REAL_EXPECTED_DENIAL: %',message;
end $$;
create temporary table real_results(k text primary key,v jsonb) on commit drop;
grant all on real_results to authenticated;
${m.users
  .map(
    (
      u,
    ) => `insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data) values(${uuid(u.id)},${sqlLiteral(u.email)},'authenticated','authenticated','{"synthetic":false,"test_only":true}',jsonb_build_object('full_name','Rollback-only gate test'));
insert into public.user_roles(user_id,role) values(${uuid(u.id)},${sqlLiteral(u.role)}::public.app_role);
insert into public.profile_room_types(profile_id,room_type_id,receive_schedule_emails) values(${uuid(u.id)},'40000000-0000-0000-0000-000000000001',false);`,
  )
  .join("\n")}
insert into public.inventory_storage_locations(id,code,name) values(${uuid(m.location.id)},${sqlLiteral(m.location.code)},${sqlLiteral(m.location.name)});
${m.items.map((i, index) => `insert into public.inventory_catalog_items select (jsonb_populate_record(null::public.inventory_catalog_items,to_jsonb(ci)||${jsonSql({ id: i.id, code: i.code, name: i.name })})).* from public.inventory_catalog_items ci where ci.id=${uuid(baseline.items[index].id)};`).join("\n")}
${actorSql(admin)}
${expect(control("register_scope", { manifest: m }), "P1_OWNER_APPROVAL_REQUIRED")}
${expect(opening(), "P1_SCOPE_UNKNOWN")}
reset role;
${approve}
${actorSql(admin)}
${expect(`(select to_jsonb(a) from private.inventory_pilot_owner_approvals a limit 1)`, "")}
${expect(control("register_scope", { manifest: { ...m, count_cutoff: "2026-01-01T00:00:00Z" } }), "P1_OWNER_APPROVAL_REQUIRED")}
select ${control("register_scope", { manifest: m })};
${expect(opening(), "P1_WRITER_EXCLUSION_EVIDENCE_REQUIRED")}
${P1_WRITERS.map(([writer_id, allowed]) => `select ${control("record_writer", { writer_id, allowed })};`).join("\n")}
${expect(opening({ ...quantity, pilot: undefined }), "P1_CONTEXT_REQUIRED")}
${expect(opening({ ...quantity, pilot: { ...pilot, scope_version: m.scope_version + 1 } }), "P1_VERSION_MISMATCH", "23505")}
${expect(opening({ ...quantity, lines: quantity.lines.slice(1) }), "P1_OPENING_MANIFEST_MISMATCH", "23505")}
${actorSql(staff)}
${expect(opening(), "P1_ACTOR_DENIED")}
${actorSql(admin)}
reset role;
create function pg_temp.real_late_failure() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.inventory_stock_origins o join public.inventory_opening_batches b on b.id=o.opening_batch_id
  where o.id=new.origin_id and b.cutover_key=${sqlLiteral(m.opening.reference)} and o.line_key=${sqlLiteral(quantity.lines.at(-1).line_key)}) then
  raise exception 'LOCAL_TEST_LATE_FACT_FAILURE' using errcode='P0001';
 end if; return new;
end $$;
create trigger zz_real_late_failure before insert on public.inventory_stock_facts for each row execute function pg_temp.real_late_failure();
${actorSql(admin)}
${expect(opening(), "LOCAL_TEST_LATE_FACT_FAILURE", "P0001")}
reset role;
select pg_temp.real_assert(not exists(select 1 from public.inventory_opening_batches where cutover_key=${sqlLiteral(m.opening.reference)})
 and not exists(select 1 from public.inventory_stock_origins where catalog_item_id=any(array[${m.items.map((i) => uuid(i.id)).join(",")}])), 'late batch failure rolls back header, scope claims, facts and ledger');
drop trigger zz_real_late_failure on public.inventory_stock_facts;
${actorSql(admin)}
insert into real_results values('retry',to_jsonb(gen_random_uuid()));
insert into real_results values('quantity',${opening(quantity, "(select (v#>>'{}')::uuid from real_results where k='retry')")});
select pg_temp.real_assert(${opening(quantity, "(select (v#>>'{}')::uuid from real_results where k='retry')")}=(select v from real_results where k='quantity'),'same retry returns exact opening identities');
${expect(opening(), "BUSINESS_DUPLICATE", "23505")}
${expect(opening({ ...quantity, provenance_note: "Changed retry payload" }, "(select (v#>>'{}')::uuid from real_results where k='retry')"), "RETRY_PAYLOAD_MISMATCH", "23505")}
${expect(control("confirm_opening"), "P1_OPENING_RECONCILIATION_REQUIRED")}
${expect(assetCommand({ ...asset, manufacturer_serial: "WRONG-EXACT-SERIAL" }), "P1_ASSET_IDENTITY_MISMATCH")}
insert into real_results values('asset',${assetCommand()});
select public.equipment_asset_command('set_asset_lifecycle',jsonb_build_object('pilot',${jsonSql(pilot)},'id',(select v->>'id' from real_results where k='asset'),'expected_revision',1,'lifecycle_status','in_service','reason','Local test commission','evidence_note','Local rollback evidence'),gen_random_uuid());
select ${control("confirm_opening")};
insert into real_results values('reconciliation',${control("reconcile")});
select pg_temp.real_assert((select v#>>'{reconciliation,ready}'='true' and v#>>'{reconciliation,opening_complete}'='true' from real_results where k='reconciliation'),'complete exact opening reconciles');
${expect(control("activate"), "P1_OWNER_APPROVAL_REQUIRED")}
select ${control("record_writer", { writer_id: "legacy", allowed: false })};
reset role;
select pg_temp.real_assert((select synthetic=false from public.inventory_opening_batches where cutover_key=${sqlLiteral(m.opening.reference)}),'quantity batch remains non-synthetic');
select pg_temp.real_assert((select count(*)=2 and bool_and(private.s4_available(o.id,f.location_id)=0)
 from public.inventory_stock_origins o join public.inventory_stock_facts f on f.origin_id=o.id and f.version=0
 where o.opening_batch_id=(select (v->>'opening_batch_id')::uuid from real_results where k='quantity')
 and o.line_key in ('ethanol-unknown','ethanol-expired')),'unknown and expired remain physically counted but unavailable');
select pg_temp.real_assert(not exists(select 1 from public.inventory_stock_origins o join public.inventory_stock_facts f on f.origin_id=o.id and f.version=0
 where o.opening_batch_id=(select (v->>'opening_batch_id')::uuid from real_results where k='quantity')
 and private.s4_available(o.id,f.location_id)<>case when f.expiry_precision='unknown' or f.expiry_date<(now() at time zone 'Asia/Ho_Chi_Minh')::date then 0 else f.good_quantity end),'damaged never contributes to available quantity');
select pg_temp.real_assert((select count(*)=6 from public.inventory_stock_origins where opening_batch_id=(select (v->>'opening_batch_id')::uuid from real_results where k='quantity')),'retry and business duplicate post once');
select pg_temp.real_assert((select count(*)=1 from public.inventory_pilot_asset_bindings where scope_id=${uuid(m.scope_id)} and asset_id=(select (v->>'id')::uuid from real_results where k='asset') and opening_event_id is not null),'generated asset binds to exact declared identity');
select pg_temp.real_assert(not exists(select 1 from public.inventory_stock_facts f join public.inventory_stock_origins o on o.id=f.origin_id where o.opening_batch_id=(select (v->>'opening_batch_id')::uuid from real_results where k='quantity') and f.base_quantity<>f.good_quantity+f.damaged_quantity),'base equals good plus damaged');
${actorSql(admin)}
select ${control("report_discrepancy", { physical_reference: m.opening.reference })};
${expect(control("activate"), "P1_ACTIVATION_RECONCILIATION_REQUIRED")}
select pg_temp.real_assert(public.inventory_pilot_read(${uuid(m.scope_id)})#>>'{scope,phase}'='PAUSED','discrepancy remains PAUSED');
select pg_temp.real_assert(${opening(quantity, "(select (v#>>'{}')::uuid from real_results where k='retry')")}=(select v from real_results where k='quantity'),'PAUSED retry has no new physical effect');
${expect(opening(), "P1_PAUSED")}
select jsonb_build_object('real_opening',true,'atomic_rollback',true,'exact_asset',true,'expiry_and_damaged_policy',true,'retry_and_duplicate',true,'reconciled',true,'owner_activation_denied',true,'final_phase','PAUSED');
rollback;`;
}
