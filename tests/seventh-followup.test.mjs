import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

nextEnv.loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const BASIC = "40000000-0000-0000-0000-000000000002";

function client(key = publishableKey) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
const service = client(secretKey);

async function signIn(email, password) {
  const db = client();
  const { error } = await db.auth.signInWithPassword({ email, password });
  assert.ifError(error);
  return db;
}

async function createUser(role, suffix, scope = BASIC) {
  const email = `seventh-${role}-${suffix}@campus.local`;
  const password = "LocalSeventh123!";
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Seventh ${role}` },
  });
  assert.ifError(error);
  const id = data.user.id;
  assert.ifError(
    (
      await service
        .from("profiles")
        .update({
          is_active: true,
          allow_basic_medical_access: role !== "viewer",
        })
        .eq("id", id)
    ).error,
  );
  assert.ifError(
    (await service.from("user_roles").insert({ user_id: id, role })).error,
  );
  assert.ifError(
    (
      await service.from("profile_room_types").insert({
        profile_id: id,
        room_type_id: scope,
      })
    ).error,
  );
  return { id, email, password };
}

async function personnelPayload(id) {
  const [{ data: profile }, { data: roles }, { data: scopes }] =
    await Promise.all([
      service
        .from("profiles")
        .select(
          "email,full_name,phone,title,is_active,can_import_schedules,allow_basic_medical_access,access_version",
        )
        .eq("id", id)
        .single(),
      service.from("user_roles").select("role").eq("user_id", id),
      service
        .from("profile_room_types")
        .select("room_type_id,receive_schedule_emails")
        .eq("profile_id", id),
    ]);
  return {
    target_profile_id: id,
    target_email: profile.email,
    target_full_name: profile.full_name,
    target_phone: profile.phone,
    target_title: profile.title,
    target_roles: roles.map(({ role }) => role),
    target_can_import_schedules: profile.can_import_schedules,
    target_room_type_ids: scopes.map(({ room_type_id }) => room_type_id),
    target_email_room_type_ids: scopes
      .filter(({ receive_schedule_emails }) => receive_schedule_emails)
      .map(({ room_type_id }) => room_type_id),
    target_allow_basic_medical_access: profile.allow_basic_medical_access,
    target_is_active: profile.is_active,
    target_expected_version: profile.access_version,
  };
}

async function commitPersonnel(root, payload) {
  const { data: operation, error: beginError } = await root.rpc(
    "begin_personnel_update",
    payload,
  );
  assert.ifError(beginError);
  assert.ifError(
    (
      await root.rpc("mark_personnel_auth_updated", {
        target_operation_id: operation.operation_id,
      })
    ).error,
  );
  const result = await root.rpc("commit_personnel_update", {
    target_operation_id: operation.operation_id,
  });
  assert.ifError(result.error);
  return result.data;
}

test("Root manages Personnel Manager while self/ordinary-admin mutations stay denied", async () => {
  const root = await signIn("admin@campus.local", "LocalAdmin123!");
  const manager = await signIn(
    "bao.nguyen@eiu.edu.vn",
    "LocalPersonnelManager123!",
  );
  const ordinary = await signIn(
    "admin.other@campus.local",
    "LocalOtherAdmin123!",
  );
  const { data: principals } = await service
    .from("system_security_principals")
    .select("root_admin_id,personnel_manager_id")
    .single();
  const managerId = principals.personnel_manager_id;

  let payload = await personnelPayload(managerId);
  await commitPersonnel(root, { ...payload, target_is_active: false });
  assert.equal(
    (
      await service
        .from("profiles")
        .select("is_active")
        .eq("id", managerId)
        .single()
    ).data.is_active,
    false,
  );
  payload = await personnelPayload(managerId);
  await commitPersonnel(root, {
    ...payload,
    target_is_active: true,
    target_roles: ["staff"],
  });
  assert.deepEqual(
    (await service.from("user_roles").select("role").eq("user_id", managerId))
      .data,
    [{ role: "staff" }],
  );
  payload = await personnelPayload(managerId);
  await commitPersonnel(root, {
    ...payload,
    target_roles: ["admin"],
    target_is_active: true,
  });

  const managerSelf = await manager.rpc("begin_personnel_update", {
    ...(await personnelPayload(managerId)),
  });
  assert.ok(managerSelf.error);
  assert.match(managerSelf.error.message, /CANNOT_MANAGE_OWN_SECURITY/);

  const ordinaryAttempt = await ordinary.rpc("begin_personnel_update", {
    ...(await personnelPayload(managerId)),
  });
  assert.ok(ordinaryAttempt.error);
  assert.match(ordinaryAttempt.error.message, /PERSONNEL_MANAGER_REQUIRED/);

  const rootAttempt = await root.rpc("begin_personnel_update", {
    ...(await personnelPayload(principals.root_admin_id)),
  });
  assert.ok(rootAttempt.error);
  assert.match(rootAttempt.error.message, /CANNOT_MANAGE_OWN_SECURITY/);
});

test("expired reserved personnel operation preserves the Auth/Profile crash window for reconciliation", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const target = await createUser("lecturer", suffix);
  const root = await signIn("admin@campus.local", "LocalAdmin123!");
  try {
    const payload = await personnelPayload(target.id);
    const requestedEmail = `seventh-crash-${suffix}@campus.local`;
    const { data: operation, error } = await root.rpc(
      "begin_personnel_update",
      { ...payload, target_email: requestedEmail },
    );
    assert.ifError(error);
    assert.ifError(
      (
        await service.auth.admin.updateUserById(target.id, {
          email: requestedEmail,
          email_confirm: true,
        })
      ).error,
    );
    assert.ifError(
      (
        await service
          .from("personnel_update_operations")
          .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
          .eq("id", operation.operation_id)
      ).error,
    );
    const importAttempt = await root.rpc("admin_apply_personnel_import", {
      target_mode: "all",
      target_rows: [],
      target_file_name: "seventh-reservation.xlsx",
    });
    assert.ok(importAttempt.error);
    assert.match(importAttempt.error.message, /PERSONNEL_UPDATE_IN_PROGRESS/);
    const { data: durable } = await service
      .from("personnel_update_operations")
      .select("status,previous_email,requested_email")
      .eq("id", operation.operation_id)
      .single();
    assert.equal(durable.status, "reserved");
    assert.equal(durable.previous_email, target.email);
    assert.equal(durable.requested_email, requestedEmail);

    assert.ifError(
      (
        await service.auth.admin.updateUserById(target.id, {
          email: target.email,
          email_confirm: true,
        })
      ).error,
    );
    assert.ifError(
      (
        await service.rpc("resolve_personnel_update_operation", {
          target_operation_id: operation.operation_id,
          target_status: "rolled_back",
          target_error: "failure-injection rollback",
        })
      ).error,
    );
    const { data: resolved } = await service
      .from("personnel_update_operations")
      .select("status,resolved_at")
      .eq("id", operation.operation_id)
      .single();
    assert.equal(resolved.status, "rolled_back");
    assert.ok(resolved.resolved_at);
  } finally {
    await service.auth.admin.deleteUser(target.id);
  }
});

test("personnel reconciler explicitly scans expired reserved operations", () => {
  const source = readFileSync(
    new URL("../lib/personnel-reconciliation.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /claim_personnel_reconciliation_batch/);
});

test("Basic Medical visibility, RPC-only mutation and soft cancellation preserve history", async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const teaching = await createUser("lecturer", `${suffix}-teach`);
  const viewer = await createUser("viewer", `${suffix}-view`);
  const unrelated = await createUser("lecturer", `${suffix}-other`);
  const root = await signIn("admin@campus.local", "LocalAdmin123!");
  const teachingDb = await signIn(teaching.email, teaching.password);
  const viewerDb = await signIn(viewer.email, viewer.password);
  const unrelatedDb = await signIn(unrelated.email, unrelated.password);
  let registrationId;
  let courseId;
  let roomId;
  try {
    const { data: course, error: courseError } = await root
      .from("courses")
      .insert({
        course_code: `YC-${suffix}`,
        course_name: "Seventh Basic Medical",
        room_type_id: BASIC,
      })
      .select("id")
      .single();
    assert.ifError(courseError);
    courseId = course.id;
    const { data: room, error: roomError } = await root
      .from("rooms")
      .insert({
        room_code: `YC${suffix}`,
        building_code: "T7",
        room_name: "Seventh Basic Medical",
        room_type_id: BASIC,
        capacity: 20,
      })
      .select("id")
      .single();
    assert.ifError(roomError);
    roomId = room.id;
    const date = "2032-11-17";
    const save = await root.rpc("save_basic_medical_registration", {
      target_registration_id: null,
      target_academic_year: "2032-2033",
      target_semester: "HK1",
      target_start_date: date,
      target_end_date: date,
      target_course_id: courseId,
      target_room_id: roomId,
      target_student_count: 10,
      target_responsible_lecturer_id: teaching.id,
      target_note: "Seventh lifecycle test",
      target_sessions: [
        {
          schedule_date: date,
          start_time: "07:00",
          end_time: "08:00",
          lesson_title: "Seventh session",
          teaching_lecturer_id: teaching.id,
        },
      ],
    });
    assert.ifError(save.error);
    registrationId = save.data;

    assert.equal(
      (
        await teachingDb
          .from("basic_medical_registrations")
          .select("id")
          .eq("id", registrationId)
      ).data.length,
      1,
    );
    assert.equal(
      (
        await viewerDb
          .from("basic_medical_registrations")
          .select("id")
          .eq("id", registrationId)
      ).data.length,
      1,
    );
    assert.equal(
      (
        await unrelatedDb
          .from("basic_medical_registrations")
          .select("id")
          .eq("id", registrationId)
      ).data.length,
      0,
    );

    const directUpdate = await teachingDb
      .from("basic_medical_registrations")
      .update({ student_count: 99 })
      .eq("id", registrationId);
    assert.ok(directUpdate.error);
    const { data: session, error: sessionError } = await teachingDb
      .from("basic_medical_registration_sessions")
      .select("id,class_schedule_id")
      .eq("registration_id", registrationId)
      .single();
    assert.ifError(sessionError);
    const directDelete = await teachingDb
      .from("basic_medical_registration_sessions")
      .delete()
      .eq("id", session.id);
    assert.ok(directDelete.error);

    const directScheduleUpdate = await root
      .from("class_schedules")
      .update({ note: "direct mutation must be denied" })
      .eq("id", session.class_schedule_id);
    assert.ok(directScheduleUpdate.error);
    const directScheduleDelete = await root
      .from("class_schedules")
      .delete()
      .eq("id", session.class_schedule_id);
    assert.ok(directScheduleDelete.error);

    const cancelled = await root.rpc("cancel_basic_medical_registration", {
      target_registration_id: registrationId,
      target_reason: "Seventh soft-cancel test",
    });
    assert.ifError(cancelled.error);
    const [
      { data: registration, error: registrationError },
      { data: preservedSession, error: preservedSessionError },
      { data: schedule, error: scheduleError },
    ] = await Promise.all([
      root
        .from("basic_medical_registrations")
        .select("cancelled_at,cancel_reason")
        .eq("id", registrationId)
        .single(),
      root
        .from("basic_medical_registration_sessions")
        .select("id")
        .eq("id", session.id)
        .single(),
      root
        .from("class_schedules")
        .select("schedule_status")
        .eq("id", session.class_schedule_id)
        .single(),
    ]);
    assert.ifError(registrationError);
    assert.ifError(preservedSessionError);
    assert.ifError(scheduleError);
    assert.ok(registration.cancelled_at);
    assert.equal(registration.cancel_reason, "Seventh soft-cancel test");
    assert.equal(preservedSession.id, session.id);
    assert.equal(schedule.schedule_status, "cancelled");
    const audit = await service
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", registrationId)
      .eq("action", "basic_medical.registration_cancelled");
    if (!audit.error) {
      assert.equal(audit.count, 1);
    }
  } finally {
    if (registrationId) {
      await service
        .from("basic_medical_registrations")
        .delete()
        .eq("id", registrationId);
    }
    if (roomId) await root.from("rooms").delete().eq("id", roomId);
    if (courseId) await root.from("courses").delete().eq("id", courseId);
    await Promise.all(
      [teaching.id, viewer.id, unrelated.id].map((id) =>
        service.auth.admin.deleteUser(id),
      ),
    );
  }
});

test("Basic Medical catalog candidate search is unbounded and import validation is atomic", async () => {
  const root = await signIn("admin@campus.local", "LocalAdmin123!");
  const suffix = crypto.randomUUID().slice(0, 8);
  const rows = Array.from({ length: 510 }, (_, index) => ({
    item_name: `Seventh catalog ${suffix} ${String(index).padStart(3, "0")}`,
    commercial_name: `Seventh commercial ${suffix} ${String(index).padStart(3, "0")}`,
    model: `${suffix}-${index}`,
    unit: "Cái",
  }));
  try {
    assert.ifError(
      (await service.from("basic_medical_equipment_catalog").insert(rows))
        .error,
    );
    const candidate = await root.rpc(
      "search_basic_medical_catalog_candidates",
      { target_query: `${suffix}-509`, target_limit: 30 },
    );
    assert.ifError(candidate.error);
    assert.equal(candidate.data.length, 1);
    assert.equal(candidate.data[0].model, `${suffix}-509`);

    const before = (
      await service
        .from("basic_medical_equipment_catalog")
        .select("id", { count: "exact", head: true })
    ).count;
    const failed = await root.rpc("apply_basic_medical_catalog_import", {
      target_mode: "all",
      target_rows: [
        { item_name: `Atomic ${suffix}`, unit: "Cái" },
        { item_name: `Invalid ${suffix}`, unit: "" },
      ],
    });
    assert.ok(failed.error);
    const after = (
      await service
        .from("basic_medical_equipment_catalog")
        .select("id", { count: "exact", head: true })
    ).count;
    assert.equal(after, before);
  } finally {
    await service
      .from("basic_medical_equipment_catalog")
      .delete()
      .ilike("model", `${suffix}-%`);
  }
});
