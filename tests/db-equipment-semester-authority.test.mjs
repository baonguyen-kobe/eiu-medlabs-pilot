/**
 * DB / RPC Semester Authority Integration Tests - Blocker 2B
 * Cases: CREATE-1, CREATE-2, UPDATE-A, UPDATE-B, UPDATE-C, UPDATE-D
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { equipmentUpdateItems } from "./helpers/equipment-update-fixture.mjs";
import { createCanonicalScheduleFixture } from "./helpers/canonical-schedule-fixture.mjs";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const localEnv = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [key, ...value] = line.split("=");
      return [key, value.join("=")];
    }),
);

function serviceClient() {
  return createClient(
    localEnv.NEXT_PUBLIC_SUPABASE_URL,
    localEnv.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function signIn(email, password) {
  const supabase = createClient(
    localEnv.NEXT_PUBLIC_SUPABASE_URL,
    localEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  assert.ifError(error);
  assert.ok(data.user);
  return { supabase, user: data.user };
}

// Separate fixture rooms keep repeated runs independent without deleting history.
const DATES = {
  C1: "2059-11-01",
  C2: "2059-11-02",
  UA: "2059-11-03",
  UB: "2059-11-04",
  UC_A: "2059-11-05",
  UC_B: "2059-11-06",
  UD_A: "2059-11-07",
  UD_B: "2059-11-08",
};

function receiveAt(d) {
  return `${d}T02:00:00.000Z`;
}
function returnAt(d) {
  return `${d}T04:00:00.000Z`;
}

async function buildSchedule(service, id, semester, createdById, scheduleDate) {
  await createCanonicalScheduleFixture(service, createdById, {
    scheduleId: id,
    scheduleDate,
    semester: semester ?? "HK1",
  });
  if (semester === null) {
    const { error } = await service
      .from("class_schedules")
      .update({ semester: null })
      .eq("id", id);
    return error;
  }
  return null;
}

async function buildCatalog(service, id) {
  const { error } = await service.from("equipment_catalog").insert({
    id,
    item_name: `2B Test item ${id}`,
    commercial_name: `2B Commercial ${id}`,
    unit: "Cai",
    is_active: true,
  });
  return error;
}

function itemsFor(catalogId) {
  return [
    {
      skill_name: "Ky nang 2B",
      catalog_item_id: catalogId,
      quantity: 1,
      note: null,
    },
  ];
}

// CREATE-1: schedule HK2, caller HK4 -> stored HK2
test("[2B CREATE-1] create RPC ignores caller HK4, stores schedule semester HK2", async () => {
  const service = serviceClient();
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const scheduleId = crypto.randomUUID();
  const catalogId = crypto.randomUUID();
  let requestId = null;
  try {
    assert.ifError(
      (
        await service
          .from("profiles")
          .update({ phone: "0901234501" })
          .eq("id", lecturer.user.id)
      ).error,
    );
    assert.ifError(
      await buildSchedule(
        service,
        scheduleId,
        "HK2",
        lecturer.user.id,
        DATES.C1,
      ),
    );
    assert.ifError(await buildCatalog(service, catalogId));
    const { data, error } = await lecturer.supabase.rpc(
      "create_equipment_request_with_items",
      {
        target_class_schedule_id: scheduleId,
        target_semester: "HK4",
        target_responsible_lecturer_id: lecturer.user.id,
        target_receive_at: receiveAt(DATES.C1),
        target_return_at: returnAt(DATES.C1),
        target_note: null,
        target_late_registration_reason: null,
        target_items: itemsFor(catalogId),
      },
    );
    assert.ifError(error, `CREATE-1 unexpected RPC error: ${error?.message}`);
    assert.ok(data, "CREATE-1: expected non-null request ID");
    requestId = data;
    const { data: row, error: rowErr } = await service
      .from("equipment_requests")
      .select("semester")
      .eq("id", requestId)
      .single();
    assert.ifError(rowErr);
    assert.equal(
      row.semester,
      "HK2",
      `CREATE-1: semester must be HK2, got ${row.semester}`,
    );
  } finally {
    if (requestId)
      await service.from("equipment_requests").delete().eq("id", requestId);
    await service.from("class_schedules").delete().eq("id", scheduleId);
    await service.from("equipment_catalog").delete().eq("id", catalogId);
  }
});

// CREATE-2: schedule NULL semester, caller HK4 -> error 22023
test("[2B CREATE-2] create RPC fails closed when schedule semester is NULL", async () => {
  const service = serviceClient();
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const scheduleId = crypto.randomUUID();
  const catalogId = crypto.randomUUID();
  try {
    assert.ifError(
      (
        await service
          .from("profiles")
          .update({ phone: "0901234502" })
          .eq("id", lecturer.user.id)
      ).error,
    );
    assert.ifError(
      await buildSchedule(
        service,
        scheduleId,
        null,
        lecturer.user.id,
        DATES.C2,
      ),
    );
    assert.ifError(await buildCatalog(service, catalogId));
    const { data, error } = await lecturer.supabase.rpc(
      "create_equipment_request_with_items",
      {
        target_class_schedule_id: scheduleId,
        target_semester: "HK4",
        target_responsible_lecturer_id: lecturer.user.id,
        target_receive_at: receiveAt(DATES.C2),
        target_return_at: returnAt(DATES.C2),
        target_note: null,
        target_late_registration_reason: null,
        target_items: itemsFor(catalogId),
      },
    );
    assert.ok(error, `CREATE-2: expected failure, got data=${data}`);
    assert.equal(
      error.code,
      "22023",
      `CREATE-2: expected 22023, got ${error.code}: ${error.message}`,
    );
  } finally {
    await service.from("class_schedules").delete().eq("id", scheduleId);
    await service.from("equipment_catalog").delete().eq("id", catalogId);
  }
});

// Linked schedule protection and request-derived semester both remain enforced.
test("[2B UPDATE-A] linked schedule rejects clearing semester and request retains HK1", async () => {
  const service = serviceClient();
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const scheduleId = crypto.randomUUID();
  const catalogId = crypto.randomUUID();
  let requestId = null;
  try {
    assert.ifError(
      (
        await service
          .from("profiles")
          .update({ phone: "0901234503" })
          .eq("id", lecturer.user.id)
      ).error,
    );
    assert.ifError(
      await buildSchedule(
        service,
        scheduleId,
        "HK1",
        lecturer.user.id,
        DATES.UA,
      ),
    );
    assert.ifError(await buildCatalog(service, catalogId));
    const { data: reqData, error: createErr } = await lecturer.supabase.rpc(
      "create_equipment_request_with_items",
      {
        target_class_schedule_id: scheduleId,
        target_semester: "HK1",
        target_responsible_lecturer_id: lecturer.user.id,
        target_receive_at: receiveAt(DATES.UA),
        target_return_at: returnAt(DATES.UA),
        target_note: null,
        target_late_registration_reason: null,
        target_items: itemsFor(catalogId),
      },
    );
    assert.ifError(createErr);
    requestId = reqData;
    const { error: clearError } = await service
      .from("class_schedules")
      .update({ semester: null })
      .eq("id", scheduleId);
    assert.equal(clearError?.code, "42501");
    // Update with same schedule, caller lies with HK3
    const { data: updData, error: updateErr } = await lecturer.supabase.rpc(
      "update_equipment_request_content",
      {
        target_request_id: requestId,
        target_class_schedule_id: scheduleId,
        target_semester: "HK3",
        target_responsible_lecturer_id: lecturer.user.id,
        target_receive_at: receiveAt(DATES.UA),
        target_return_at: returnAt(DATES.UA),
        target_note: "Updated note",
        target_late_registration_reason: null,
        target_items: await equipmentUpdateItems(
          lecturer.supabase,
          requestId,
          itemsFor(catalogId),
        ),
      },
    );
    assert.ifError(
      updateErr,
      `UPDATE-A unexpected error: ${updateErr?.message}`,
    );
    assert.ok(updData);
    const { data: row, error: rowErr } = await service
      .from("equipment_requests")
      .select("semester")
      .eq("id", requestId)
      .single();
    assert.ifError(rowErr);
    assert.equal(
      row.semester,
      "HK1",
      `UPDATE-A: semester must be preserved as HK1, got ${row.semester}`,
    );
  } finally {
    if (requestId)
      await service.from("equipment_requests").delete().eq("id", requestId);
    await service.from("class_schedules").delete().eq("id", scheduleId);
    await service.from("equipment_catalog").delete().eq("id", catalogId);
  }
});

// UPDATE-B: same schedule has HK3, caller HK1 -> stored HK3
test("[2B UPDATE-B] update RPC uses schedule semester HK3, ignores caller HK1", async () => {
  const service = serviceClient();
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const scheduleId = crypto.randomUUID();
  const catalogId = crypto.randomUUID();
  let requestId = null;
  try {
    assert.ifError(
      (
        await service
          .from("profiles")
          .update({ phone: "0901234504" })
          .eq("id", lecturer.user.id)
      ).error,
    );
    assert.ifError(
      await buildSchedule(
        service,
        scheduleId,
        "HK3",
        lecturer.user.id,
        DATES.UB,
      ),
    );
    assert.ifError(await buildCatalog(service, catalogId));
    const { data: reqData, error: createErr } = await lecturer.supabase.rpc(
      "create_equipment_request_with_items",
      {
        target_class_schedule_id: scheduleId,
        target_semester: "HK3",
        target_responsible_lecturer_id: lecturer.user.id,
        target_receive_at: receiveAt(DATES.UB),
        target_return_at: returnAt(DATES.UB),
        target_note: null,
        target_late_registration_reason: null,
        target_items: itemsFor(catalogId),
      },
    );
    assert.ifError(createErr);
    requestId = reqData;
    const { data: updData, error: updateErr } = await lecturer.supabase.rpc(
      "update_equipment_request_content",
      {
        target_request_id: requestId,
        target_class_schedule_id: scheduleId,
        target_semester: "HK1",
        target_responsible_lecturer_id: lecturer.user.id,
        target_receive_at: receiveAt(DATES.UB),
        target_return_at: returnAt(DATES.UB),
        target_note: "Updated B",
        target_late_registration_reason: null,
        target_items: await equipmentUpdateItems(
          lecturer.supabase,
          requestId,
          itemsFor(catalogId),
        ),
      },
    );
    assert.ifError(
      updateErr,
      `UPDATE-B unexpected error: ${updateErr?.message}`,
    );
    assert.ok(updData);
    const { data: row, error: rowErr } = await service
      .from("equipment_requests")
      .select("semester")
      .eq("id", requestId)
      .single();
    assert.ifError(rowErr);
    assert.equal(
      row.semester,
      "HK3",
      `UPDATE-B: semester must be HK3, got ${row.semester}`,
    );
  } finally {
    if (requestId)
      await service.from("equipment_requests").delete().eq("id", requestId);
    await service.from("class_schedules").delete().eq("id", scheduleId);
    await service.from("equipment_catalog").delete().eq("id", catalogId);
  }
});

// UPDATE-C: immutable source rejects a destination before semester validation.
test("[2B UPDATE-C] update RPC rejects moving an immutable source to a NULL-semester schedule", async () => {
  const service = serviceClient();
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const scheduleIdA = crypto.randomUUID();
  const scheduleIdB = crypto.randomUUID();
  const catalogId = crypto.randomUUID();
  let requestId = null;
  try {
    assert.ifError(
      (
        await service
          .from("profiles")
          .update({ phone: "0901234505" })
          .eq("id", lecturer.user.id)
      ).error,
    );
    assert.ifError(
      await buildSchedule(
        service,
        scheduleIdA,
        "HK1",
        lecturer.user.id,
        DATES.UC_A,
      ),
    );
    assert.ifError(
      await buildSchedule(
        service,
        scheduleIdB,
        null,
        lecturer.user.id,
        DATES.UC_B,
      ),
    );
    assert.ifError(await buildCatalog(service, catalogId));
    const { data: reqData, error: createErr } = await lecturer.supabase.rpc(
      "create_equipment_request_with_items",
      {
        target_class_schedule_id: scheduleIdA,
        target_semester: "HK1",
        target_responsible_lecturer_id: lecturer.user.id,
        target_receive_at: receiveAt(DATES.UC_A),
        target_return_at: returnAt(DATES.UC_A),
        target_note: null,
        target_late_registration_reason: null,
        target_items: itemsFor(catalogId),
      },
    );
    assert.ifError(createErr);
    requestId = reqData;
    const { data, error: updateErr } = await lecturer.supabase.rpc(
      "update_equipment_request_content",
      {
        target_request_id: requestId,
        target_class_schedule_id: scheduleIdB,
        target_semester: "HK1",
        target_responsible_lecturer_id: lecturer.user.id,
        target_receive_at: receiveAt(DATES.UC_B),
        target_return_at: returnAt(DATES.UC_B),
        target_note: null,
        target_late_registration_reason: null,
        target_items: itemsFor(catalogId),
      },
    );
    assert.ok(updateErr, `UPDATE-C: expected failure, got data=${data}`);
    assert.equal(
      updateErr.code,
      "22023",
      `UPDATE-C: expected 22023, got ${updateErr.code}: ${updateErr.message}`,
    );
    assert.match(
      updateErr.message,
      /EQUIPMENT_REQUEST_DOMAIN_OR_SOURCE_IMMUTABLE/,
    );
  } finally {
    if (requestId)
      await service.from("equipment_requests").delete().eq("id", requestId);
    await service.from("class_schedules").delete().eq("id", scheduleIdA);
    await service.from("class_schedules").delete().eq("id", scheduleIdB);
    await service.from("equipment_catalog").delete().eq("id", catalogId);
  }
});

// UPDATE-D: a canonical destination does not make reassignment legal.
test("[2B UPDATE-D] update RPC rejects moving an immutable source to another canonical schedule", async () => {
  const service = serviceClient();
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const scheduleIdA = crypto.randomUUID();
  const scheduleIdB = crypto.randomUUID();
  const catalogId = crypto.randomUUID();
  let requestId = null;
  try {
    assert.ifError(
      (
        await service
          .from("profiles")
          .update({ phone: "0901234506" })
          .eq("id", lecturer.user.id)
      ).error,
    );
    assert.ifError(
      await buildSchedule(
        service,
        scheduleIdA,
        "HK1",
        lecturer.user.id,
        DATES.UD_A,
      ),
    );
    assert.ifError(
      await buildSchedule(
        service,
        scheduleIdB,
        "HK4",
        lecturer.user.id,
        DATES.UD_B,
      ),
    );
    assert.ifError(await buildCatalog(service, catalogId));
    const { data: reqData, error: createErr } = await lecturer.supabase.rpc(
      "create_equipment_request_with_items",
      {
        target_class_schedule_id: scheduleIdA,
        target_semester: "HK1",
        target_responsible_lecturer_id: lecturer.user.id,
        target_receive_at: receiveAt(DATES.UD_A),
        target_return_at: returnAt(DATES.UD_A),
        target_note: null,
        target_late_registration_reason: null,
        target_items: itemsFor(catalogId),
      },
    );
    assert.ifError(createErr);
    requestId = reqData;
    const { data: updData, error: updateErr } = await lecturer.supabase.rpc(
      "update_equipment_request_content",
      {
        target_request_id: requestId,
        target_class_schedule_id: scheduleIdB,
        target_semester: "HK1",
        target_responsible_lecturer_id: lecturer.user.id,
        target_receive_at: receiveAt(DATES.UD_B),
        target_return_at: returnAt(DATES.UD_B),
        target_note: null,
        target_late_registration_reason: null,
        target_items: itemsFor(catalogId),
      },
    );
    assert.equal(updData, null);
    assert.equal(updateErr?.code, "22023");
    assert.match(
      updateErr?.message ?? "",
      /EQUIPMENT_REQUEST_DOMAIN_OR_SOURCE_IMMUTABLE/,
    );
  } finally {
    if (requestId)
      await service.from("equipment_requests").delete().eq("id", requestId);
    await service.from("class_schedules").delete().eq("id", scheduleIdA);
    await service.from("class_schedules").delete().eq("id", scheduleIdB);
    await service.from("equipment_catalog").delete().eq("id", catalogId);
  }
});
