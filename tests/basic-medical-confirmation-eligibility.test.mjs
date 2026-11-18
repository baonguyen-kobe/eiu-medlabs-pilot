import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAX_BASIC_MEDICAL_CONFIRMATION_TIMER_DELAY,
  createBasicMedicalConfirmationTimerLifecycle,
  isBasicMedicalConfirmationTooEarly,
  scheduleBasicMedicalConfirmationWake,
} from "../lib/basic-medical-equipment.ts";

const Y05_DB_CONCURRENCY = process.env.Y05_DB_CONCURRENCY === "1";
const Y05_DB_CONTAINER =
  process.env.Y05_DB_CONTAINER ?? "supabase_db_lich-truc-app";

function startPsql(sql, applicationName) {
  const child = spawn(
    "docker",
    [
      "exec",
      "-i",
      "-e",
      `PGAPPNAME=${applicationName}`,
      Y05_DB_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`psql exited ${code}: ${output}`));
    });
  });
  child.stdin.end(sql);
  return { child, completed, getOutput: () => output };
}

async function runPsql(sql, applicationName = "y05_probe") {
  return startPsql(sql, applicationName).completed;
}

async function waitForOutput(process, marker, timeoutMs = 8_000) {
  const startedAt = Date.now();
  while (!process.getOutput().includes(marker)) {
    if (Date.now() - startedAt > timeoutMs) {
      process.child.kill();
      throw new Error(
        `Timed out waiting for ${marker}: ${process.getOutput()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForConfirmationLock(timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const wait = await runPsql(
      "select coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '') from pg_stat_activity where application_name = 'y05_confirm' and query like '%confirm_basic_medical_session%' limit 1;",
    );
    if (wait.trim().startsWith("Lock:")) return wait.trim();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

async function waitForApplicationLock(applicationName, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const wait = await runPsql(
      `select coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '') from pg_stat_activity where application_name = '${applicationName}' limit 1;`,
    );
    if (wait.trim().startsWith("Lock:")) return wait.trim();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}

const [
  registrationsPage,
  registrationList,
  confirmationAction,
  confirmationRpc,
  confirmationMigration,
] = await Promise.all([
  // The page reads basicMedicalRegistrationSelect from the shared lib.
  Promise.all([
    readFile(
      new URL("../app/basic-medical/registrations/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../lib/basic-medical-equipment.ts", import.meta.url),
      "utf8",
    ),
  ]).then(
    ([page, lib]) =>
      `${page}
${lib.match(/basicMedicalRegistrationSelect =\s*("[^"]+")/)[1]}`,
  ),
  readFile(
    new URL(
      "../components/basic-medical-registration-list.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../app/basic-medical/registrations/actions.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../supabase/schemas/13_basic_medical_confirmation_snapshot_guard.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../supabase/migrations/20260812010000_guard_basic_medical_confirmation_inventory_snapshot.sql",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("confirmation UI selects only active allocations with active catalog items", () => {
  assert.match(
    registrationsPage,
    /catalog:basic_medical_equipment_catalog!inner\([^)]*is_active\)/,
  );
  assert.match(registrationsPage, /\.eq\("is_active", true\)/);
  assert.match(registrationsPage, /\.eq\("catalog\.is_active", true\)/);
});

test("confirmation RPC uses the same active allocation and catalog eligibility", () => {
  const rpcStart = confirmationRpc.indexOf(
    "create or replace function public.confirm_basic_medical_session",
  );
  assert.notEqual(rpcStart, -1);
  const rpc = confirmationRpc.slice(rpcStart);

  assert.match(
    rpc,
    /where inventory\.room_id = session_row\.room_id\s+and inventory\.is_active\s+and catalog\.is_active\s+order by inventory\.id\s+loop/,
  );
  assert.match(
    rpc,
    /perform private\.assert_basic_medical_inventory_snapshot\(session_row\.room_id, target_checks\)/,
  );
});

test("confirmation timer crosses the exact cutoff and has backend-parity equality", () => {
  assert.equal(isBasicMedicalConfirmationTooEarly(1_000, 999), true);
  assert.equal(isBasicMedicalConfirmationTooEarly(1_000, 1_000), false);
  const timers = [];
  const timer = scheduleBasicMedicalConfirmationWake({
    eligibilityAt: 1_000,
    now: 999,
    setTimer: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    onWake: () => timers.push({ woke: true }),
  });
  assert.equal(timer, 1);
  assert.equal(timers[0].delay, 2);
  timers[0].callback();
  assert.deepEqual(timers[1], { woke: true });
});

test("confirmation timer lifecycle mounts, rerenders, crosses cutoff, and unmounts", () => {
  const timers = new Map();
  const cleared = [];
  let wakes = 0;
  let nextTimerId = 0;
  const setTimer = (callback, delay) => {
    nextTimerId += 1;
    timers.set(nextTimerId, { callback, delay });
    return nextTimerId;
  };
  const lifecycle = createBasicMedicalConfirmationTimerLifecycle({
    setTimer,
    clearTimer: (timer) => {
      cleared.push(timer);
      timers.delete(timer);
    },
    onWake: () => {
      wakes += 1;
    },
  });
  const longEligibilityAt = MAX_BASIC_MEDICAL_CONFIRMATION_TIMER_DELAY * 3;
  const firstTimer = lifecycle.update({
    eligibilityAt: longEligibilityAt,
    now: 0,
  });
  assert.equal(firstTimer, 1);
  assert.equal(
    timers.get(firstTimer).delay,
    MAX_BASIC_MEDICAL_CONFIRMATION_TIMER_DELAY,
  );
  assert.equal(timers.size, 1, "a long wait must not cause a rapid timer loop");

  // The component effect calls update again when its dependencies change.
  const rescheduledTimer = lifecycle.update({
    eligibilityAt: 50,
    now: 0,
  });
  assert.deepEqual(cleared, [firstTimer]);
  assert.equal(rescheduledTimer, 2);
  assert.equal(timers.get(rescheduledTimer).delay, 51);
  assert.equal(timers.size, 1);

  const callback = timers.get(rescheduledTimer).callback;
  callback();
  timers.delete(rescheduledTimer);
  assert.equal(wakes, 1);
  assert.equal(isBasicMedicalConfirmationTooEarly(50, 50), false);

  const unmountTimer = lifecycle.update({ eligibilityAt: 100, now: 50 });
  assert.equal(timers.size, 1);
  lifecycle.dispose();
  assert.deepEqual(cleared, [firstTimer, unmountTimer]);
  assert.equal(timers.size, 0, "unmount leaves no callback runnable");
});

test("confirmation becomes available at the next local cutoff without a refresh", () => {
  assert.match(
    registrationList,
    /const \[confirmationNow, setConfirmationNow\] = useState/,
  );
  assert.match(
    registrationList,
    /createBasicMedicalConfirmationTimerLifecycle/,
  );
  assert.match(registrationList, /setConfirmationNow\(Date\.now\(\)\)/);
  assert.match(registrationList, /return timerLifecycle\.dispose/);
});

test("cancelled schedules are displayed as cancelled and never offer Confirm", () => {
  assert.match(
    registrationsPage,
    /class_schedules\(id,schedule_date,start_time,end_time,schedule_status\)/,
  );
  assert.match(
    registrationList,
    /session\.class_schedules\?\.schedule_status === "cancelled"[\s\S]*request-status-gray/,
  );
});

test("confirmation submits and locks the exact displayed eligible equipment snapshot", () => {
  for (const field of [
    "expectedCatalogItemId",
    "expectedTotalQuantity",
    "expectedGoodQuantity",
    "expectedDamagedQuantity",
    "expectedItemName",
    "expectedCommercialName",
    "expectedUnit",
  ]) {
    assert.match(registrationList, new RegExp(field));
    assert.match(confirmationAction, new RegExp(field));
  }
  assert.match(
    confirmationRpc,
    /for update of inventory, catalog[\s\S]*expected_catalog_item_id[\s\S]*expected_commercial_name/,
  );
  assert.match(
    confirmationRpc,
    /perform private\.assert_basic_medical_inventory_snapshot\(session_row\.room_id, target_checks\);[\s\S]*insert into public\.basic_medical_session_confirmations/,
  );
  assert.match(
    confirmationRpc,
    /revoke all on function private\.assert_basic_medical_inventory_snapshot\(uuid, jsonb\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    confirmationRpc,
    /lock table public\.basic_medical_equipment_catalog,[\s\S]*public\.basic_medical_room_inventory[\s\S]*share row exclusive mode/,
  );
  assert.match(
    confirmationRpc,
    /left join public\.basic_medical_room_inventory as inventory[\s\S]*where inventory\.id is null or catalog\.id is null/,
  );
  const syntaxValidation = confirmationRpc.indexOf(
    "coalesce(item->>'inventory_id', '') !~",
  );
  const lockedSnapshot = confirmationRpc.indexOf(
    "perform private.assert_basic_medical_inventory_snapshot",
  );
  assert.notEqual(syntaxValidation, -1);
  assert.notEqual(lockedSnapshot, -1);
  assert.ok(
    syntaxValidation < lockedSnapshot,
    "syntactic payload validation must precede helper casts and table locks",
  );
});

test("schema and migration share lock order, stale message, and pre-lock integer gates", () => {
  for (const source of [confirmationRpc, confirmationMigration]) {
    assert.match(
      source,
      /lock table public\.basic_medical_equipment_catalog,\s+public\.basic_medical_room_inventory\s+in share row exclusive mode/,
    );
    assert.doesNotMatch(
      source,
      /lock table public\.basic_medical_room_inventory,\s+public\.basic_medical_equipment_catalog/,
    );
    assert.match(source, /2147483647/);
    assert.match(
      source,
      /Thiết bị phòng đã thay đổi\. Vui lòng tải lại trước khi ký xác nhận\./,
    );
    assert.doesNotMatch(source, /STALE_BASIC_MEDICAL_INVENTORY_SNAPSHOT/);
    assert.ok(
      source.indexOf("item->>'expected_total_quantity' > '2147483647'") <
        source.indexOf(
          "perform private.assert_basic_medical_inventory_snapshot",
        ),
    );
  }
  const staleMessage =
    "Thiết bị phòng đã thay đổi. Vui lòng tải lại trước khi ký xác nhận.";
  const staleMessages = (source) =>
    [
      ...source
        .slice(
          source.indexOf(
            "create or replace function private.assert_basic_medical_inventory_snapshot",
          ),
          source.indexOf(
            "revoke all on function private.assert_basic_medical_inventory_snapshot",
          ),
        )
        .matchAll(/raise exception '([^']+)'\s+using errcode = '40001'/g),
    ].map((match) => match[1]);
  assert.deepEqual(staleMessages(confirmationRpc), Array(4).fill(staleMessage));
  assert.deepEqual(
    staleMessages(confirmationMigration),
    staleMessages(confirmationRpc),
    "all four schema and migration stale paths expose identical messages",
  );
});

test(
  "confirmation serializes concurrent eligibility removals and additions",
  { skip: !Y05_DB_CONCURRENCY },
  async () => {
    const ids = {
      user: "95000000-0000-4000-8000-000000000001",
      course: "95000000-0000-4000-8000-000000000002",
      room: "95000000-0000-4000-8000-000000000003",
      registration: "95000000-0000-4000-8000-000000000004",
      schedule: "95000000-0000-4000-8000-000000000005",
      session: "95000000-0000-4000-8000-000000000006",
      catalog: "95000000-0000-4000-8000-000000000007",
      inventory: "95000000-0000-4000-8000-000000000008",
      addedCatalog: "95000000-0000-4000-8000-000000000009",
      addedInventory: "95000000-0000-4000-8000-00000000000a",
    };
    const cleanup = `
      select set_config('app.basic_medical_registration_mutation', 'true', false);
      delete from public.basic_medical_equipment_condition_logs where inventory_id in ('${ids.inventory}', '${ids.addedInventory}');
      delete from public.basic_medical_session_equipment_checks where inventory_id in ('${ids.inventory}', '${ids.addedInventory}');
      delete from public.basic_medical_session_confirmations where session_id = '${ids.session}';
      delete from public.basic_medical_registration_sessions where id = '${ids.session}';
      delete from public.class_schedules where id = '${ids.schedule}';
      delete from public.basic_medical_registrations where id = '${ids.registration}';
      delete from public.basic_medical_room_inventory where id in ('${ids.inventory}', '${ids.addedInventory}');
      delete from public.basic_medical_equipment_catalog where id in ('${ids.catalog}', '${ids.addedCatalog}');
      delete from public.profile_room_types where profile_id = '${ids.user}';
      delete from public.user_roles where user_id = '${ids.user}';
      delete from public.rooms where id = '${ids.room}';
      delete from public.courses where id = '${ids.course}';
      delete from public.profiles where id = '${ids.user}';
      delete from auth.users where id = '${ids.user}';
    `;
    const payload = JSON.stringify([
      {
        inventory_id: ids.inventory,
        newly_damaged_quantity: 0,
        expected_catalog_item_id: ids.catalog,
        expected_total_quantity: 10,
        expected_good_quantity: 8,
        expected_damaged_quantity: 2,
        expected_item_name: "Y05 Heart",
        expected_commercial_name: null,
        expected_unit: "set",
      },
    ]).replaceAll("'", "''");
    const confirmationSql = `
      select set_config('role', 'authenticated', false);
      select set_config('request.jwt.claims', '{"sub":"${ids.user}"}', false);
      do $$
      begin
        perform public.confirm_basic_medical_session(
          '${ids.session}',
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          '${payload}'::jsonb
        );
        raise exception 'Y05_UNEXPECTED_CONFIRMATION_SUCCESS';
      exception when sqlstate '40001' then
        raise notice 'Y05_SQLSTATE=40001';
      end;
      $$;
      reset role;
      select 'Y05_SIDE_EFFECTS=' ||
        (select count(*) from public.basic_medical_session_confirmations where session_id = '${ids.session}') || ':' ||
        (select count(*) from public.basic_medical_session_equipment_checks checks join public.basic_medical_session_confirmations confirmations on confirmations.id = checks.confirmation_id where confirmations.session_id = '${ids.session}') || ':' ||
        (select count(*) from public.basic_medical_equipment_condition_logs where inventory_id in ('${ids.inventory}', '${ids.addedInventory}')) || ':' ||
        (select count(*) from public.email_outbox_events where domain = 'basic_medical_damage' and payload::text like '%${ids.session}%');
    `;

    async function runPreLockInvalidPayload(value) {
      const invalidPayload = payload.replace(
        '"expected_total_quantity":10',
        `"expected_total_quantity":${value}`,
      );
      const invalidSql = confirmationSql.replace(payload, invalidPayload);
      const catalogLocker = startPsql(
        "begin; lock table public.basic_medical_equipment_catalog in access exclusive mode; \\echo Y05_CATALOG_ACCESS_LOCKED\nselect pg_sleep(2); commit;",
        "y05_validation_locker",
      );
      await waitForOutput(catalogLocker, "Y05_CATALOG_ACCESS_LOCKED");
      const invalidCall = startPsql(
        invalidSql
          .replace(
            "exception when sqlstate '40001'",
            "exception when sqlstate '22023'",
          )
          .replace("Y05_SQLSTATE=40001", "Y05_SQLSTATE=22023"),
        "y05_invalid_payload",
      );
      const invalidOutput = await Promise.race([
        invalidCall.completed,
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(new Error("invalid payload waited for an equipment lock")),
            750,
          ),
        ),
      ]);
      assert.match(invalidOutput, /Y05_SQLSTATE=22023/);
      assert.match(invalidOutput, /Y05_SIDE_EFFECTS=0:0:0:0/);
      assert.equal(
        await waitForApplicationLock("y05_invalid_payload", 100),
        null,
      );
      await catalogLocker.completed;
    }

    async function runRace(writerSql) {
      const writer = startPsql(
        `begin; ${writerSql}; \\echo Y05_WRITER_LOCKED\nselect pg_sleep(3); commit;`,
        "y05_writer",
      );
      await waitForOutput(writer, "Y05_WRITER_LOCKED");
      const confirmer = startPsql(confirmationSql, "y05_confirm");
      const waitEvent = await waitForConfirmationLock();
      const [writerOutput, confirmerOutput] = await Promise.all([
        writer.completed,
        confirmer.completed,
      ]);
      assert.match(writerOutput, /Y05_WRITER_LOCKED/);
      assert.match(waitEvent ?? "", /^Lock:/);
      assert.match(confirmerOutput, /Y05_SQLSTATE=40001/);
      assert.match(confirmerOutput, /Y05_SIDE_EFFECTS=0:0:0:0/);
    }

    async function runInverseInterleavingRace() {
      const writer = startPsql(
        `begin;
         insert into public.basic_medical_equipment_catalog
           (id, item_name, commercial_name, unit, is_active)
           values ('${ids.addedCatalog}', 'Y05 Added', 'Y05 Added commercial', 'set', true);
         \\echo Y05_CATALOG_LOCKED
         select pg_sleep(1);
         insert into public.basic_medical_room_inventory
           (id, room_id, catalog_item_id, total_quantity, good_quantity, damaged_quantity, is_active)
           values ('${ids.addedInventory}', '${ids.room}', '${ids.addedCatalog}', 1, 1, 0, true);
         commit;
         \\echo Y05_WRITER_COMMITTED`,
        "y05_inverse_writer",
      );
      await waitForOutput(writer, "Y05_CATALOG_LOCKED");
      const confirmer = startPsql(confirmationSql, "y05_confirm");
      const confirmerWait = await waitForConfirmationLock();
      assert.match(confirmerWait ?? "", /^Lock:/);
      const writerWait = await waitForApplicationLock(
        "y05_inverse_writer",
        500,
      );
      assert.equal(
        writerWait,
        null,
        "catalog-first writer must never wait on inventory held by confirmer",
      );
      const [writerOutput, confirmerOutput] = await Promise.all([
        writer.completed,
        confirmer.completed,
      ]);
      assert.match(writerOutput, /Y05_WRITER_COMMITTED/);
      assert.doesNotMatch(writerOutput + confirmerOutput, /40P01|deadlock/i);
      assert.match(confirmerOutput, /Y05_SQLSTATE=40001/);
      assert.match(confirmerOutput, /Y05_SIDE_EFFECTS=0:0:0:0/);
    }

    try {
      await runPsql(`
        ${cleanup}
        begin;
        insert into auth.users (id, email) values ('${ids.user}', 'y05-concurrency@eiu.edu.vn');
        insert into public.profiles (id, email, full_name, is_active, title)
          values ('${ids.user}', 'y05-concurrency@eiu.edu.vn', 'Y05 Lecturer', true, 'lecturer')
          on conflict (id) do update set email = excluded.email, full_name = excluded.full_name,
            is_active = excluded.is_active, title = excluded.title;
        insert into public.user_roles (user_id, role) values ('${ids.user}', 'lecturer')
          on conflict do nothing;
        insert into public.profile_room_types (profile_id, room_type_id)
          select '${ids.user}', id from public.room_types where code = 'basic_medical' limit 1;
        insert into public.courses (id, course_code, course_name, room_type_id, is_active)
          select '${ids.course}', 'Y05-CONCURRENCY', 'Y05 Concurrency', id, true
          from public.room_types where code = 'basic_medical' limit 1;
        insert into public.rooms (id, room_code, building_code, room_name, room_type_id, capacity, is_active)
          select '${ids.room}', 'Y05-RACE', 'Y05', 'Y05 Race Room', id, 10, true
          from public.room_types where code = 'basic_medical' limit 1;
        insert into public.basic_medical_equipment_catalog
          (id, item_name, commercial_name, unit, is_active)
          values ('${ids.catalog}', 'Y05 Heart', 'Y05 Heart commercial', 'set', true);
        insert into public.basic_medical_room_inventory
          (id, room_id, catalog_item_id, total_quantity, good_quantity, damaged_quantity, is_active)
          values ('${ids.inventory}', '${ids.room}', '${ids.catalog}', 10, 8, 2, true);
        insert into public.basic_medical_registrations
          (id, academic_year, semester, start_date, end_date, course_id, room_id, student_count, registrant_id, responsible_lecturer_id, created_by)
          values ('${ids.registration}', '2026-2027', 'HK1', current_date - 1, current_date - 1, '${ids.course}', '${ids.room}', 10, '${ids.user}', '${ids.user}', '${ids.user}');
        insert into public.class_schedules
          (id, course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id, schedule_date, start_time, end_time, schedule_status, published_by, published_at, student_count, created_by, basic_medical_registration_id)
          values ('${ids.schedule}', '${ids.course}', 'Y05-CONCURRENCY', 'Y05 Concurrency', '${ids.room}', '${ids.user}', current_date - 1, '08:00', '10:00', 'published', '${ids.user}', clock_timestamp(), 10, '${ids.user}', '${ids.registration}');
        insert into public.basic_medical_registration_sessions
          (id, registration_id, class_schedule_id, lesson_title, teaching_lecturer_id, session_number)
          values ('${ids.session}', '${ids.registration}', '${ids.schedule}', 'Y05 race session', '${ids.user}', 1);
        commit;
      `);

      await runPreLockInvalidPayload("2147483648");
      await runPreLockInvalidPayload("999999999999999999999999999999999999");
      await runPreLockInvalidPayload("-1");

      await runRace(
        `update public.basic_medical_room_inventory set is_active = false where id = '${ids.inventory}'`,
      );
      await runPsql(
        `update public.basic_medical_room_inventory set is_active = true where id = '${ids.inventory}';`,
      );

      await runInverseInterleavingRace();
    } finally {
      await runPsql(cleanup);
    }
  },
);
