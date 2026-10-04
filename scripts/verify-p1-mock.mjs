import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import {
  buildP1SmokeSql,
  actorSql,
  jsonSql,
  sqlLiteral,
  P1_WRITERS,
} from "../tests/helpers/inventory-p1-runtime.mjs";
import {
  createP1RemoteClient,
  singleJson,
  P1_PROJECT,
} from "../tests/helpers/inventory-p1-remote.mjs";
import { runP1RemoteRaces } from "../tests/helpers/inventory-p1-remote-races.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
assert.ok(
  process.argv.length === 3 &&
    ["--remote", "--read-remote"].includes(process.argv[2]),
  "Explicit --remote or --read-remote required; isolated MOCK pilot only",
);
const rawManifest = await readFile(
  resolve(root, "docs/architecture/P1_MOCK_MANIFEST.json"),
  "utf8",
);
const manifest = JSON.parse(rawManifest);
assert.equal(manifest.scope_code, "P1-MOCK-ACC2B31A");
assert.equal(manifest.synthetic, true);
assert.equal(manifest.real_activation, false);
assert.equal(manifest.target_project_ref, P1_PROJECT);
const client = createP1RemoteClient(root);
const admin = manifest.users.find((u) => u.role === "admin").id;
const pilot = {
  scope_id: manifest.scope_id,
  scope_version: manifest.scope_version,
  manifest_id: manifest.manifest_id,
  project_ref: P1_PROJECT,
};
const call = async (operation, extra = {}) =>
  singleJson(
    await client.query(
      `begin; ${actorSql(admin)} select public.inventory_pilot_command(${sqlLiteral(operation)},${jsonSql({ pilot, reason: "INV062 actual synthetic pilot verification; no real activation", evidence_reference: `INV062:${manifest.scope_code}:${operation}:${randomUUID()}`, ...extra })},${sqlLiteral(randomUUID())}::uuid) as result; commit;`,
    ),
  );
const marker = async () =>
  singleJson(
    await client.query(
      `begin; ${actorSql(admin)} select public.inventory_pilot_read(${sqlLiteral(manifest.scope_id)}::uuid) as result; rollback;`,
    ),
  );
const snapshot = async () =>
  singleJson(
    await client.query(`select jsonb_build_object(
 'batch',(select to_jsonb(b) from public.inventory_opening_batches b where b.id=${sqlLiteral(manifest.opening_result.opening_batch_id)}::uuid),
 'origins',(select jsonb_agg(to_jsonb(o) order by o.id) from public.inventory_stock_origins o where o.catalog_item_id=any(array[${manifest.items.map((i) => sqlLiteral(i.id)).join(",")}]::uuid[])),
 'facts',(select jsonb_agg(to_jsonb(f) order by f.id) from public.inventory_stock_facts f join public.inventory_stock_origins o on o.id=f.origin_id where o.catalog_item_id=any(array[${manifest.items.map((i) => sqlLiteral(i.id)).join(",")}]::uuid[])),
 'balances',(select jsonb_agg(to_jsonb(b) order by b.cohort_id,b.location_id,b.condition) from public.inventory_stock_balances b join public.inventory_stock_origins o on o.id=b.cohort_id where o.catalog_item_id=any(array[${manifest.items.map((i) => sqlLiteral(i.id)).join(",")}]::uuid[])),
 'ledger',(select jsonb_agg(to_jsonb(l) order by l.transaction_id,l.line_no) from public.inventory_transaction_lines l where l.catalog_item_id=any(array[${manifest.items.map((i) => sqlLiteral(i.id)).join(",")}]::uuid[])),
 'asset',(select to_jsonb(a) from public.equipment_assets a where a.id=${sqlLiteral(manifest.asset.id)}::uuid),
 'asset_events',(select jsonb_agg(to_jsonb(e) order by e.revision) from public.equipment_asset_events e where e.asset_id=${sqlLiteral(manifest.asset.id)}::uuid),
 'identities',(select jsonb_agg(jsonb_build_object('id',u.id,'password',u.encrypted_password,'metadata',u.raw_app_meta_data,'profile',to_jsonb(p),'roles',(select jsonb_agg(role order by role) from public.user_roles where user_id=u.id)) order by u.id) from auth.users u join public.profiles p on p.id=u.id where u.id=any(array[${manifest.users.map((u) => sqlLiteral(u.id)).join(",")}]::uuid[]))
 ) as result;`),
  );
const prior = await snapshot();
assert.equal(prior.origins.length, 6);
assert.equal(prior.ledger.length, 8);
assert.equal(prior.asset_events.length, 2);
assert.equal(prior.asset.id, manifest.asset.id);
assert.equal(prior.asset.asset_code, manifest.asset.asset_code);
assert.equal(prior.asset.revision, manifest.asset.revision);
for (const u of prior.identities)
  assert.ok(!u.password, "MOCK identities must remain non-login");
const registered = singleJson(
  await client.query(
    `select exists(select 1 from public.inventory_pilot_scopes where id=${sqlLiteral(manifest.scope_id)}::uuid) as result;`,
  ),
);
if (process.argv[2] === "--read-remote") {
  assert.equal(registered, true);
  const state = await marker();
  assert.equal(state.scope.phase, "PAUSED");
  assert.deepEqual(state.scope.manifest, manifest);
  console.log(
    JSON.stringify(
      {
        project_ref: P1_PROJECT,
        observed_at: new Date().toISOString(),
        state,
        physical_snapshot: prior,
      },
      null,
      2,
    ),
  );
} else {
  assert.equal(
    registered,
    false,
    "Already registered: preserve durable scope; use --read-remote, never reseed/reset",
  );
  const smokeRows = await client.query(buildP1SmokeSql(manifest));
  const smoke = singleJson(smokeRows);
  assert.equal(smoke.kind, "P1_RPC_SMOKE_ROLLBACK_INTEGRITY");
  assert.equal(smoke.rollback_integrity, true);
  assert.deepEqual(await snapshot(), prior);
  const registration = await call("register_scope", { manifest });
  assert.equal(registration.phase, "OPENING_READY");
  for (const [writer_id, allowed] of P1_WRITERS)
    await call("record_writer", { writer_id, allowed });
  let races;
  try {
    races = await runP1RemoteRaces({
      client,
      manifest,
      control: call,
      snapshot,
    });
    const report = await call("report_dual_write", {
      writer_id: "manual_offline",
      physical_reference:
        "MOCK-INJECTED-COMPETING-WRITER-NO-ACTUAL-OFFLINE-STOCK",
    });
    assert.equal(report.phase, "PAUSED");
    const blocked = await call("reconcile");
    assert.equal(blocked.reconciliation.ready, false);
    await call("resolve_discrepancy", { related_event_id: report.event_id });
    const reconciliation = await call("reconcile");
    assert.equal(reconciliation.reconciliation.ready, true);
    assert.equal(reconciliation.phase, "PAUSED");
    const after = await snapshot();
    assert.deepEqual(
      after,
      prior,
      "Remote original physical facts and non-login identities remain byte-equivalent JSON rows",
    );
    const final = await marker();
    assert.equal(final.scope.phase, "PAUSED");
    assert.deepEqual(final.scope.manifest, manifest);
    assert.equal(final.scope.opening_confirmed, true);
    assert.equal(final.writers.length, 8);
    assert.equal(final.bindings[0].asset_id, manifest.asset.id);
    assert.equal(
      final.bindings[0].opening_event_id,
      manifest.asset_opening_result.event_id,
    );
    assert.deepEqual(final.unresolved_events, []);
    const migration = singleJson(
      await client.query(
        "select exists(select 1 from supabase_migrations.schema_migrations where version='20261004050000') as result;",
      ),
    );
    assert.equal(migration, true);
    const evidence = {
      kind: "ACTUAL_MOCK_P1_RUNTIME_NOT_REAL_P1",
      observed_at: new Date().toISOString(),
      project_ref: P1_PROJECT,
      scope_id: manifest.scope_id,
      manifest_id: manifest.manifest_id,
      scope_version: manifest.scope_version,
      manifest_sha256: createHash("sha256").update(rawManifest).digest("hex"),
      migration_sha256: createHash("sha256")
        .update(
          await readFile(
            resolve(
              root,
              "supabase/migrations/20261004050000_inventory_p1_mock_markers.sql",
            ),
          ),
        )
        .digest("hex"),
      smoke_sql_sha256: createHash("sha256")
        .update(buildP1SmokeSql(manifest))
        .digest("hex"),
      smoke,
      races,
      injected_dual_write: {
        event_id: report.event_id,
        real_competing_write_observed: false,
      },
      physical_rows_unchanged: true,
      original_physical_snapshot: after,
      final_marker: final,
      interactive_login_verified: false,
      real_activation: false,
    };
    await writeFile(
      resolve(root, "docs/architecture/P1_MOCK_RUNTIME_EVIDENCE.json"),
      JSON.stringify(evidence, null, 2) + "\n",
      { flag: "wx" },
    );
    console.log(
      JSON.stringify(
        {
          project_ref: P1_PROJECT,
          scope_id: manifest.scope_id,
          final_phase: final.scope.phase,
          races: races.map((r) => r.scenario),
          physical_rows_unchanged: true,
          evidence: "docs/architecture/P1_MOCK_RUNTIME_EVIDENCE.json",
        },
        null,
        2,
      ),
    );
  } finally {
    if ((await marker()).scope.phase !== "PAUSED") await call("pause");
  }
}
