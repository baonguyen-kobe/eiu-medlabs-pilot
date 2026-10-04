import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Local-only, no seed/reset/delete. Each run receives a fresh committed counterpart
// cloned from the approved P1 seed with new prefix/scope/manifest/three actor UUIDs.
// Its opening and commissioned asset exist; marker is absent or unconfirmed.
// The shared setup owns bootstrap; this runner registers evidence and leaves PAUSED.
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const json = (value) => `${literal(JSON.stringify(value))}::jsonb`;
const uuid = (value) => `${literal(value)}::uuid`;
const parse = (text) =>
  JSON.parse(text.split(/\r?\n/).findLast((line) => line.startsWith("{")));
const actorSql = (actor) => `set local role authenticated;
  select set_config('request.jwt.claims',${json({ sub: actor, role: "authenticated" })}::text,true);`;
const writers = [
  "inventory_command",
  "equipment_asset_command",
  "equipment_preparation_command",
  "equipment_preparation_transfer",
  "equipment_fulfillment_command",
  "legacy",
  "privileged_import",
  "manual_offline",
];

export function createP1RaceHarness({ container } = {}) {
  const project = process.env.SUPABASE_LOCAL_PROJECT_ID ?? "eiu-medlabs-pilot";
  assert.equal(project, "eiu-medlabs-pilot", "LOCAL_PILOT_ONLY");
  const discovered = spawnSync(
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
  assert.equal(
    discovered.status,
    0,
    discovered.stderr || "Local Docker discovery failed",
  );
  const names = discovered.stdout
    .split(/\r?\n/)
    .filter((name) => name.startsWith("supabase_db_"));
  assert.equal(names.length, 1, "REFUSING_AMBIGUOUS_LOCAL_SUPABASE_DATABASE");
  if (container !== undefined)
    assert.equal(container, names[0], "REFUSING_UNDISCOVERED_DATABASE");
  container = names[0];
  const nonce = crypto.randomBytes(6).toString("hex");
  let sequence = 0;
  function start(sql, keepOpen = false) {
    const name = `p1_race_${nonce}_${sequence++}`;
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        "-e",
        `PGAPPNAME=${name}`,
        container,
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
    let stdout = "";
    let stderr = "";
    let ended = false;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdin.on("error", () => {});
    const completed = new Promise((resolve, reject) => {
      child.once("error", (error) => {
        ended = true;
        reject(error);
      });
      child.once("close", (code) => {
        ended = true;
        if (code === 0) resolve(stdout);
        else reject(new Error(`P1 psql exited ${code}: ${stderr}\n${stdout}`));
      });
    });
    completed.catch(() => {});
    child.stdin.write(
      `set statement_timeout='30s'; set lock_timeout='25s';\n${sql}\n`,
    );
    if (!keepOpen) child.stdin.end();
    return { child, completed, name, output: () => stdout, ended: () => ended };
  }
  const sql = (query) => start(query).completed;
  async function until(probe, description, sessions = []) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      for (const session of sessions)
        if (session.ended()) {
          await session.completed;
          throw new Error(`P1 contender ended before barrier: ${session.name}`);
        }
      if (await probe()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`P1 barrier timeout: ${description}`);
  }
  function transaction({ actor, expression, rollback = false }) {
    return `begin;
      create function pg_temp.p1_attempt() returns jsonb language plpgsql as $attempt$
      declare result jsonb;
      begin
        result := ${expression};
        return jsonb_build_object('ok',true,'result',result);
      exception when others then
        return jsonb_build_object('ok',false,'code',sqlstate,'message',sqlerrm);
      end; $attempt$;
      ${actorSql(actor)}
      select pg_temp.p1_attempt(); ${rollback ? "rollback" : "commit"};`;
  }
  const command = async (args) => parse(await sql(transaction(args)));
  const read = async (actor, expression) =>
    parse(await sql(`begin; ${actorSql(actor)} select ${expression}; commit;`));
  async function race(commands) {
    assert.equal(commands.length, 2, "Two real sessions required");
    const blocker = start(
      `begin;
      select pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
      \\echo P1_BARRIER_READY`,
      true,
    );
    const contenders = [];
    const barriers = [];
    try {
      await until(
        () => blocker.output().includes("P1_BARRIER_READY"),
        "writer acquired",
        [blocker],
      );
      // Queue one actual backend at a time. PostgreSQL's lock waiters, not sleeps,
      // establish the intended order; assertions still accept only valid outcomes.
      for (const args of commands) {
        const contender = start(transaction(args));
        contenders.push(contender);
        await until(
          async () => {
            const proof = parse(
              await sql(`select coalesce((select jsonb_build_object('pid',a.pid,
            'waiting',a.wait_event_type='Lock' and a.wait_event='advisory',
            'blocked',exists(select 1 from pg_stat_activity b
              where b.application_name=${literal(blocker.name)} and b.pid=any(pg_blocking_pids(a.pid))))
            from pg_stat_activity a where a.application_name=${literal(contender.name)}),
            '{"waiting":false,"blocked":false}'::jsonb);`),
            );
            if (proof.waiting && proof.blocked) {
              barriers.push(proof);
              return true;
            }
            return false;
          },
          `${contender.name} queued on writer`,
          [blocker, ...contenders],
        );
      }
      blocker.child.stdin.end("commit;\n");
      await blocker.completed;
      const outcomes = (
        await Promise.all(contenders.map((entry) => entry.completed))
      ).map(parse);
      return { barriers, outcomes };
    } finally {
      if (!blocker.child.stdin.writableEnded)
        blocker.child.stdin.end("rollback;\n");
      await Promise.allSettled([
        blocker.completed,
        ...contenders.map((entry) => entry.completed),
      ]);
    }
  }
  return { sql, command, read, race, container };
}

function successful(outcome) {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return outcome.result;
}
function pilotDenied(outcome) {
  assert.equal(outcome.ok, false, "Expected a pilot-gate denial");
  assert.equal(outcome.code, "42501", JSON.stringify(outcome));
  assert.match(outcome.message, /^P1_/, JSON.stringify(outcome));
  assert.notEqual(
    outcome.code,
    "55P03",
    "A lock timeout is not phase-gate evidence",
  );
  assert.notEqual(
    outcome.code,
    "57014",
    "A statement timeout is not phase-gate evidence",
  );
}

export async function runP1Races({ manifest, container } = {}) {
  assert.match(manifest?.scope_code ?? "", /^P1-MOCK-/);
  assert.notEqual(
    manifest.scope_code,
    "P1-MOCK-ACC2B31A",
    "Fresh local counterpart prefix required",
  );
  for (const id of [
    manifest.scope_id,
    manifest.manifest_id,
    ...manifest.users.map((user) => user.id),
  ]) {
    assert.ok(
      ![
        "a27c1f6d-089e-43c5-93e1-4ca7f539b6a5",
        "2a312d76-1381-4a05-bea8-747576eab135",
        "b45ebb24-7dbb-4071-b5e7-7785b52587d7",
        "6b8f91e8-d47f-4445-b105-ae3124d349cb",
        "da210218-38de-462f-82c6-b68c3b8e9444",
      ].includes(id),
      "Never reuse canonical baseline identities",
    );
  }
  assert.equal(manifest.synthetic, true);
  assert.equal(manifest.dataset_kind, "mock");
  assert.equal(manifest.target_project_ref, "kwpyukofofoaqhmxndlc");
  assert.equal(manifest.items.length, 4);
  const admin = manifest.users.find((user) => user.role === "admin").id;
  const staff = manifest.users
    .filter((user) => user.role === "staff")
    .map((user) => user.id);
  assert.equal(staff.length, 2);
  assert.ok(
    manifest.opening_payload &&
      manifest.opening_result?.opening_batch_id &&
      manifest.asset?.id,
    "Setup must return actual local physical IDs, never baseline remote IDs",
  );
  const db = createP1RaceHarness({ container });
  const pilot = {
    scope_id: manifest.scope_id,
    scope_version: manifest.scope_version,
    manifest_id: manifest.manifest_id,
    project_ref: manifest.target_project_ref,
  };
  const evidence = `P1-RACES:${crypto.randomUUID()}`;
  const control = (operation, extra = {}, retryKey = crypto.randomUUID()) => ({
    actor: admin,
    expression: `public.inventory_pilot_command(${literal(operation)},${json({
      pilot,
      reason: "Synthetic multi-session gate acceptance",
      evidence_reference: `${evidence}:${operation}`,
      ...extra,
    })},${uuid(retryKey)})`,
  });
  const marker = () =>
    db.read(admin, `public.inventory_pilot_read(${uuid(manifest.scope_id)})`);
  const asset = async () =>
    parse(
      await db.sql(
        `select to_jsonb(a) from public.equipment_assets a where id=${uuid(manifest.asset.id)};`,
      ),
    );
  const assetWrite = (
    state,
    retryKey = crypto.randomUUID(),
    suppliedPilot = true,
  ) => ({
    actor: admin,
    expression: `public.equipment_asset_command('set_asset_state',${json({
      id: state.id,
      expected_revision: state.revision,
      location_id: state.location_id,
      custodian_id: state.custodian_id,
      operational_status: state.operational_status,
      reason: "Synthetic same-state physical revision for pause race",
      evidence_note: evidence,
      ...(suppliedPilot ? { pilot } : {}),
    })},${uuid(retryKey)})`,
  });
  const itemIds = manifest.items.map(({ id }) => uuid(id)).join(",");
  const snapshotExpression = `jsonb_build_object(
    'origins',(select count(*) from public.inventory_stock_origins where catalog_item_id in (${itemIds})),
    'facts',(select count(*) from public.inventory_stock_facts f join public.inventory_stock_origins o on o.id=f.origin_id where o.catalog_item_id in (${itemIds})),
    'ledger',(select count(*) from public.inventory_transaction_lines l join public.inventory_stock_origins o on o.id=l.cohort_id where o.catalog_item_id in (${itemIds})),
    'balances',(select coalesce(jsonb_agg(to_jsonb(b) order by b.cohort_id,b.location_id,b.condition),'[]')
      from public.inventory_stock_balances b join public.inventory_stock_origins o on o.id=b.cohort_id where o.catalog_item_id in (${itemIds})),
    'asset',(select to_jsonb(a) from public.equipment_assets a where id=${uuid(manifest.asset.id)}),
    'asset_events',(select count(*) from public.equipment_asset_events where asset_id=${uuid(manifest.asset.id)}),
    'actor_transactions',(select count(*) from public.inventory_transactions where actor_id=${uuid(admin)}))`;
  const snapshot = async () =>
    parse(await db.sql(`select ${snapshotExpression};`));
  const activate = async () => {
    const reconciled = successful(await db.command(control("reconcile")));
    assert.equal(
      reconciled.reconciliation.ready,
      true,
      JSON.stringify(reconciled),
    );
    assert.equal(reconciled.reconciliation.opening_complete, true);
    successful(await db.command(control("activate")));
    const observed = await marker();
    assert.equal(observed.scope.phase, "ACTIVE");
    assert.equal(observed.scope.opening_confirmed, true);
    assert.equal(observed.scope.reconciliation.ready, true);
    return observed;
  };
  const report = {
    scope_id: manifest.scope_id,
    container: db.container,
    scenarios: [],
  };
  let registered = false;
  try {
    const existing = parse(
      await db.sql(`select jsonb_build_object('present',exists(
      select 1 from public.inventory_pilot_scopes where id=${uuid(manifest.scope_id)}));`),
    );
    if (!existing.present)
      successful(await db.command(control("register_scope", { manifest })));
    registered = true;
    const initial = await marker();
    assert.equal(
      initial.scope.phase,
      "OPENING_READY",
      "Run opening race before confirmation; never reset a scope",
    );
    assert.equal(
      initial.scope.opening_confirmed,
      false,
      "Opening race requires a genuinely unconfirmed scope",
    );
    for (const writer_id of writers)
      successful(
        await db.command(
          control("record_writer", {
            writer_id,
            allowed: ![
              "legacy",
              "privileged_import",
              "manual_offline",
            ].includes(writer_id),
          }),
        ),
      );
    const beforeOpening = await snapshot();
    const confirmation = control("confirm_opening");
    const openingRace = await db.race([control("activate"), confirmation]);
    pilotDenied(openingRace.outcomes[0]);
    successful(openingRace.outcomes[1]);
    const afterOpening = await snapshot();
    assert.deepEqual(
      afterOpening,
      beforeOpening,
      "Adopting opening must not repost any physical fact",
    );
    const confirmed = await marker();
    assert.equal(confirmed.scope.opening_confirmed, true);
    assert.notEqual(
      confirmed.scope.phase,
      "ACTIVE",
      "Rejected early activation must not become ACTIVE",
    );
    assert.equal(
      confirmed.scope.opening_batch_id,
      manifest.opening_result.opening_batch_id,
    );
    assert.equal(confirmed.bindings[0].asset_id, manifest.asset.id);
    report.scenarios.push({
      name: "activation queued before opening confirmation",
      ...openingRace,
      physical_before: beforeOpening,
      physical_after: afterOpening,
      scope: confirmed.scope,
    });
    const reconciledOpening = successful(
      await db.command(control("reconcile")),
    );
    assert.equal(reconciledOpening.reconciliation.ready, true);
    const confirmedActivation = await db.race([
      confirmation,
      control("activate"),
    ]);
    assert.deepEqual(
      successful(confirmedActivation.outcomes[0]),
      openingRace.outcomes[1].result,
    );
    successful(confirmedActivation.outcomes[1]);
    const activeOpening = await marker();
    assert.equal(activeOpening.scope.phase, "ACTIVE");
    assert.equal(activeOpening.scope.opening_confirmed, true);
    assert.equal(activeOpening.scope.reconciliation.opening_complete, true);
    assert.equal(activeOpening.scope.reconciliation.ready, true);
    assert.deepEqual(await snapshot(), afterOpening);
    report.scenarios.push({
      name: "confirmed opening retry then activation serializes without repost",
      ...confirmedActivation,
      scope: activeOpening.scope,
    });

    // These use a real S3 transaction+event and revision, but preserve all physical
    // values. Re-activation therefore does not require stock/fixture repair.
    for (const pauseFirst of [true, false]) {
      if ((await marker()).scope.phase !== "ACTIVE") await activate();
      const before = await snapshot();
      const state = await asset();
      const write = assetWrite(state, crypto.randomUUID(), pauseFirst);
      const pause = control("pause");
      const raced = await db.race(pauseFirst ? [pause, write] : [write, pause]);
      const pauseOutcome = raced.outcomes[pauseFirst ? 0 : 1];
      const writeOutcome = raced.outcomes[pauseFirst ? 1 : 0];
      const paused = successful(pauseOutcome);
      if (pauseFirst) pilotDenied(writeOutcome);
      else successful(writeOutcome);
      const after = await snapshot();
      assert.equal((await marker()).scope.phase, "PAUSED");
      assert.equal(
        after.asset_events - before.asset_events,
        pauseFirst ? 0 : 1,
      );
      assert.equal(
        after.actor_transactions - before.actor_transactions,
        pauseFirst ? 0 : 1,
      );
      assert.equal(
        after.asset.revision - before.asset.revision,
        pauseFirst ? 0 : 1,
      );
      for (const key of ["origins", "facts", "ledger", "balances"])
        assert.deepEqual(after[key], before[key]);
      const postPause = await db.command(assetWrite(await asset()));
      pilotDenied(postPause);
      assert.deepEqual(
        await snapshot(),
        after,
        "A fresh post-PAUSED write cannot leave physical side effects",
      );
      if (!pauseFirst) {
        const replay = successful(await db.command(write));
        assert.deepEqual(
          replay,
          writeOutcome.result,
          "Old public retry remains valid while PAUSED",
        );
        assert.deepEqual(
          await snapshot(),
          after,
          "PAUSED retry must not repost physical writes",
        );
        const chronology = parse(
          await db.sql(`select jsonb_build_object('before_pause',
          a.posted_at<=p.occurred_at,'transaction_id',a.transaction_id,'event_id',a.id,'pause_event_id',p.id)
          from public.equipment_asset_events a cross join public.inventory_pilot_events p
          where a.id=${uuid(replay.event_id)} and p.id=${uuid(paused.event_id)};`),
        );
        assert.equal(chronology.before_pause, true);
        report.scenarios.push({
          name: "physical write committed before PAUSED; replay survives",
          ...raced,
          before,
          after,
          post_pause: postPause,
          replay,
          chronology,
        });
      } else
        report.scenarios.push({
          name: "PAUSED commits before explicit-context physical write",
          ...raced,
          before,
          after,
          post_pause: postPause,
        });
    }
    await activate();
    report.scenarios.push(
      await rolledBackTransfers({
        db,
        manifest,
        admin,
        staff,
        pilot,
        snapshotExpression,
        snapshot,
        evidence,
      }),
    );
    successful(await db.command(control("pause")));
    report.final = await marker();
    assert.equal(report.final.scope.phase, "PAUSED");
    return report;
  } finally {
    if (registered) {
      if ((await marker()).scope.phase !== "PAUSED")
        successful(await db.command(control("pause")));
      assert.equal(
        (await marker()).scope.phase,
        "PAUSED",
        "Always leave durable baseline safe",
      );
    }
  }
}

async function rolledBackTransfers({
  db,
  manifest,
  admin,
  staff,
  pilot,
  snapshotExpression,
  snapshot,
  evidence,
}) {
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
  const [room, schedule, demand, assetDemand, token] = ids;
  const tag = crypto.randomUUID();
  const quantityItem = manifest.items.find(
    (item) => item.key === "consumable",
  ).id;
  const assetItem = manifest.items.find((item) => item.key === "serialized").id;
  const before = await snapshot();
  const output = await db.sql(`begin;
    select pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
    update public.profiles set phone='0901234567' where id=${uuid(admin)};
    insert into public.user_roles(user_id,role) values(${uuid(staff[1])},'lecturer') on conflict do nothing;
    select set_config('request.jwt.claims',${json({ sub: admin, role: "authenticated" })}::text,true);
    insert into public.rooms(id,room_code,building_code,room_type_id)
      values(${uuid(room)},${literal(`P1-RACE-${tag}`)},'P1-RACE','40000000-0000-0000-0000-000000000001');
    insert into public.class_schedules(id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,
      schedule_date,start_time,end_time,semester,created_by,source,schedule_status,student_count,published_by,published_at)
      values(${uuid(schedule)},'P1-RACE','Synthetic rollback transfer',${uuid(room)},${uuid(staff[1])},
        current_date+70,'09:00','11:00','HK1',${uuid(admin)},'manual','published',20,${uuid(admin)},now());
    insert into public.equipment_catalog(id,item_name,commercial_name,unit) values
      (${uuid(demand)},'P1-RACE',${literal(`P1-RACE-Q-${tag}`)},'cái'),
      (${uuid(assetDemand)},'P1-RACE',${literal(`P1-RACE-A-${tag}`)},'cái');
    create temporary table p1_race_context(k text primary key,v jsonb);
    grant all on p1_race_context to authenticated;
    create function pg_temp.p1_snapshot() returns jsonb language sql as $snapshot$ select ${snapshotExpression}; $snapshot$;
    create function pg_temp.p1_nested(request_id uuid,payload jsonb) returns jsonb language plpgsql as $attempt$
    declare result jsonb;
    begin
      result:=public.equipment_preparation_transfer(request_id,payload,gen_random_uuid());
      return jsonb_build_object('ok',true,'result',result);
    exception when others then return jsonb_build_object('ok',false,'code',sqlstate,'message',sqlerrm);
    end; $attempt$;
    ${actorSql(admin)}
    insert into p1_race_context values('outside',public.inventory_command('create_inventory_location',
      jsonb_build_object('code',${literal(`P1-RACE-OUT-${tag}`)},'name','Outside frozen mock scope'),gen_random_uuid()));
    insert into p1_race_context values('request',to_jsonb(public.create_equipment_request_with_items(
      ${uuid(schedule)},'HK1',${uuid(staff[1])},((current_date+70)::text||' 09:00+07')::timestamptz,
      ((current_date+70)::text||' 11:00+07')::timestamptz,null,'Synthetic rollback transfer',
      jsonb_build_array(jsonb_build_object('skill_name','P1 race','catalog_item_id',${uuid(demand)},'quantity',1),
        jsonb_build_object('skill_name','P1 race','catalog_item_id',${uuid(assetDemand)},'quantity',1)))));
    do $setup$ declare r uuid; w jsonb; begin
      select (v#>>'{}')::uuid into r from p1_race_context where k='request';
      w:=public.equipment_preparation_read(r);
      perform public.equipment_preparation_command('map_item',r,jsonb_build_object('expected_revision',w#>'{request,revision}',
        'catalog_item_id',${uuid(demand)},'inventory_item_id',${uuid(quantityItem)},
        'base_units_per_requested_unit','1','reason','Synthetic quantity mapping','pilot',${json(pilot)}),gen_random_uuid());
      w:=public.equipment_preparation_read(r);
      perform public.equipment_preparation_command('map_item',r,jsonb_build_object('expected_revision',w#>'{request,revision}',
        'catalog_item_id',${uuid(assetDemand)},'inventory_item_id',${uuid(assetItem)},
        'base_units_per_requested_unit','1','reason','Synthetic asset mapping','pilot',${json(pilot)}),gen_random_uuid());
      w:=public.equipment_preparation_read(r);
      perform public.equipment_preparation_command('start',r,jsonb_build_object('expected_revision',w#>'{request,revision}',
        'lock_token',${uuid(token)},'pilot',${json(pilot)}),gen_random_uuid());
    end; $setup$;
    reset role;
    insert into p1_race_context values('before',pg_temp.p1_snapshot());
    ${actorSql(admin)}
    do $transfer$ declare r uuid; w jsonb; base jsonb; a public.equipment_assets; out_id uuid; begin
      select (v#>>'{}')::uuid into r from p1_race_context where k='request';
      select (v->>'id')::uuid into out_id from p1_race_context where k='outside';
      w:=public.equipment_preparation_read(r);
      insert into p1_race_context values('workspace_before',w);
      base:=jsonb_build_object('expected_revision',w#>'{request,revision}','lock_token',${uuid(token)},
        'physical_confirmation',true,'source_location_id',${uuid(manifest.location.id)},
        'destination_location_id',out_id,'quantity','1','condition','good',
        'reason','Synthetic mixed endpoint rollback','pilot',${json(pilot)});
      insert into p1_race_context values('quantity_denial',pg_temp.p1_nested(r,base||jsonb_build_object('inventory_item_id',${uuid(quantityItem)})));
      select * into a from public.equipment_assets where id=${uuid(manifest.asset.id)};
      insert into p1_race_context values('asset_denial',pg_temp.p1_nested(r,base||jsonb_build_object(
        'inventory_item_id',${uuid(assetItem)},'asset_id',a.id,'asset_revision',a.revision)));
      insert into p1_race_context values('workspace_after',public.equipment_preparation_read(r));
    end; $transfer$;
    reset role;
    insert into p1_race_context values('after_denials',pg_temp.p1_snapshot());
    ${actorSql(admin)}
    do $recovery$ declare a public.equipment_assets; result jsonb; begin
      select * into a from public.equipment_assets where id=${uuid(manifest.asset.id)};
      result:=public.equipment_asset_command('set_asset_state',jsonb_build_object('id',a.id,'expected_revision',a.revision,
        'location_id',a.location_id,'custodian_id',a.custodian_id,'operational_status',a.operational_status,
        'reason','Verify context restored after nested rollback','evidence_note',${literal(evidence)},'pilot',${json(pilot)}),gen_random_uuid());
      insert into p1_race_context values('recovery',result);
    end; $recovery$;
    reset role;
    insert into p1_race_context values('after_recovery',pg_temp.p1_snapshot());
    select jsonb_object_agg(k,v) from p1_race_context;
    rollback;`);
  const observed = parse(output);
  pilotDenied(observed.quantity_denial);
  pilotDenied(observed.asset_denial);
  assert.deepEqual(
    observed.after_denials,
    observed.before,
    "Both nested mixed-endpoint failures must roll back physical facts",
  );
  assert.deepEqual(
    observed.workspace_after,
    observed.workspace_before,
    "Rejected transfers leave no preparation links or revisions",
  );
  assert.ok(observed.recovery.transaction_id && observed.recovery.event_id);
  assert.equal(
    observed.after_recovery.asset_events,
    observed.before.asset_events + 1,
  );
  assert.equal(
    observed.after_recovery.actor_transactions,
    observed.before.actor_transactions + 1,
  );
  assert.equal(
    observed.after_recovery.asset.revision,
    observed.before.asset.revision + 1,
  );
  assert.deepEqual(
    await snapshot(),
    before,
    "Outer workflow rollback preserves all durable baseline physical records",
  );
  const residue = parse(
    await db.sql(`select jsonb_build_object('schedules',(select count(*) from public.class_schedules where id=${uuid(schedule)}),
    'demands',(select count(*) from public.equipment_catalog where id in (${uuid(demand)},${uuid(assetDemand)})),
    'lecturer_added',exists(select 1 from public.user_roles where user_id=${uuid(staff[1])} and role='lecturer'),
    'phone',(select phone from public.profiles where id=${uuid(admin)}));`),
  );
  assert.equal(residue.schedules, 0);
  assert.equal(residue.demands, 0);
  assert.equal(residue.lecturer_added, false);
  assert.equal(residue.phone, null);
  return {
    name: "actual nested quantity/asset transfers reject mixed endpoints atomically; context recovers",
    observed,
    residue,
  };
}

// Direct use: node <draft.mjs> <local-counterpart-manifest.json>. No remote URL accepted.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assert.ok(
    process.argv[2],
    "Provide committed local counterpart manifest JSON",
  );
  const manifest = JSON.parse(await readFile(process.argv[2], "utf8"));
  console.log(JSON.stringify(await runP1Races({ manifest }), null, 2));
}
