import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sqlLiteral, jsonSql, actorSql } from "./inventory-p1-runtime.mjs";
import { singleJson } from "./inventory-p1-remote.mjs";

// Management requests use independent PostgreSQL sessions. Ordering is proven
// by pg_blocking_pids, not inferred from elapsed HTTP timing. The held mutex has
// a bounded lease; it commits no data. Physical success is observed then rolled
// back on the exact immutable remote fixture, unlike the committed local race.
export async function runP1RemoteRaces({
  client,
  manifest,
  control,
  snapshot,
}) {
  const admin = manifest.users.find((u) => u.role === "admin").id;
  const pilot = {
    scope_id: manifest.scope_id,
    scope_version: manifest.scope_version,
    manifest_id: manifest.manifest_id,
    project_ref: client.projectRef,
  };
  const lock =
    "pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0))";
  const command = (op, extra = {}) =>
    `select public.inventory_pilot_command(${sqlLiteral(op)},${jsonSql({ pilot, reason: "Actual remote MOCK serialization", evidence_reference: `INV062:remote-race:${op}:${randomUUID()}`, ...extra })},${sqlLiteral(randomUUID())}::uuid) as result;`;
  const tx = (body, name, rollback = false) =>
    `begin; set local application_name=${sqlLiteral(name)}; set local statement_timeout='35s'; set local lock_timeout='30s'; ${actorSql(admin)} ${body} ${rollback ? "rollback" : "commit"};`;
  const settled = (promise) =>
    promise.then(
      (rows) => ({ ok: true, result: singleJson(rows) }),
      (error) => ({ ok: false, error: error.message }),
    );
  async function waitFor(check, label) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const value = singleJson(await client.query(check));
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new Error(`REMOTE_BARRIER_NOT_OBSERVED: ${label}`);
  }
  async function race(first, second) {
    const nonce = randomUUID().replaceAll("-", "");
    const blockerName = `p1_${nonce}_b`,
      firstName = `p1_${nonce}_1`,
      secondName = `p1_${nonce}_2`;
    const blocker = settled(
      client.query(
        `begin; set local application_name=${sqlLiteral(blockerName)}; set local statement_timeout='30s'; select ${lock}; select pg_sleep(18); select jsonb_build_object('released',true) as result; commit;`,
      ),
    );
    let a, b;
    try {
      await waitFor(
        `select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.application_name=${sqlLiteral(blockerName)} and l.locktype='advisory' and l.granted) as result;`,
        "writer mutex held",
      );
      a = settled(client.query(tx(first.sql, firstName, first.rollback)));
      const firstWait = await waitFor(
        `select (select jsonb_build_object('pid',a.pid,'blocking_pids',pg_blocking_pids(a.pid)) from pg_stat_activity a where a.application_name=${sqlLiteral(firstName)} and cardinality(pg_blocking_pids(a.pid))>0) as result;`,
        "first contender blocked",
      );
      b = settled(client.query(tx(second.sql, secondName, second.rollback)));
      const secondWait = await waitFor(
        `select (select jsonb_build_object('pid',a.pid,'blocking_pids',pg_blocking_pids(a.pid)) from pg_stat_activity a where a.application_name=${sqlLiteral(secondName)} and ${firstWait.pid}=any(pg_blocking_pids(a.pid))) as result;`,
        "second contender behind first",
      );
      const outcomes = await Promise.all([a, b]);
      const release = await blocker;
      assert.equal(release.ok, true, release.error);
      return { first_wait: firstWait, second_wait: secondWait, outcomes };
    } finally {
      await Promise.all([blocker, a, b].filter(Boolean));
    }
  }
  function passed(outcome) {
    assert.equal(outcome.ok, true, outcome.error);
    return outcome.result;
  }
  function denied(outcome) {
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /42501/);
  }
  const report = [];
  const before = await snapshot();
  const early = await race(
    { sql: command("activate") },
    { sql: command("confirm_opening") },
  );
  denied(early.outcomes[0]);
  passed(early.outcomes[1]);
  assert.deepEqual(await snapshot(), before);
  report.push({
    scenario: "activation waits before opening confirmation and is denied",
    ...early,
  });
  const activation = await race(
    { sql: command("confirm_opening") },
    { sql: command("activate") },
  );
  passed(activation.outcomes[0]);
  assert.equal(passed(activation.outcomes[1]).phase, "ACTIVE");
  assert.deepEqual(await snapshot(), before);
  report.push({
    scenario:
      "opening confirmation then activation serialize without physical repost",
    ...activation,
  });
  function physical() {
    const retry = randomUUID();
    const payload = {
      pilot,
      id: manifest.asset.id,
      expected_revision: manifest.asset.revision,
      location_id: manifest.location.id,
      custodian_id: manifest.asset.custodian_id,
      operational_status: "ready",
      reason: "MOCK same-state serialization probe; transaction rolls back",
      evidence_note: "INV062 remote-only rollback probe",
    };
    return {
      rollback: true,
      sql: `select public.equipment_asset_command('set_asset_state',${jsonSql(payload)},${sqlLiteral(retry)}::uuid); select jsonb_build_object('observed_revision',(select revision from public.equipment_assets where id=${sqlLiteral(manifest.asset.id)}::uuid),'observed_new_events',(select count(*) from public.equipment_asset_events e join public.inventory_operation_replays r on (r.result_ids->>'event_id')::uuid=e.id where r.actor_id=${sqlLiteral(admin)}::uuid and r.operation='set_asset_state' and r.retry_key=${sqlLiteral(retry)}::uuid),'physical_transaction_rolled_back',true) as result;`,
    };
  }
  const pauseFirst = await race({ sql: command("pause") }, physical());
  assert.equal(passed(pauseFirst.outcomes[0]).phase, "PAUSED");
  denied(pauseFirst.outcomes[1]);
  assert.deepEqual(await snapshot(), before);
  report.push({
    scenario: "durable PAUSED before physical write prevents all effects",
    ...pauseFirst,
  });
  await control("activate");
  const writeFirst = await race(physical(), { sql: command("pause") });
  const observed = passed(writeFirst.outcomes[0]);
  assert.equal(observed.observed_revision, manifest.asset.revision + 1);
  assert.equal(observed.observed_new_events, 1);
  assert.equal(passed(writeFirst.outcomes[1]).phase, "PAUSED");
  assert.deepEqual(await snapshot(), before);
  report.push({
    scenario:
      "physical write observes exactly one effect before queued pause; physical transaction rolls back",
    ...writeFirst,
  });
  return report;
}
