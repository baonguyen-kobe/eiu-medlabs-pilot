import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  legacyRequestFixture,
  legacyItemFixture,
  legacyStageFixture,
  cleanupLegacyRequest,
} from "./helpers/legacy-equipment-fixture.mjs";
import { equipmentUpdateItems } from "./helpers/equipment-update-fixture.mjs";
import { createClient } from "@supabase/supabase-js";

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

function client() {
  return createClient(
    localEnv.NEXT_PUBLIC_SUPABASE_URL,
    localEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function serviceClient() {
  return createClient(
    localEnv.NEXT_PUBLIC_SUPABASE_URL,
    localEnv.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function signIn(email, password) {
  const supabase = client();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  assert.ifError(error);
  assert.ok(data.user);
  return { supabase, user: data.user };
}

function importScheduleHash({ courseCode, roomId, date, start, end }) {
  const time = (value) => (/^\d{2}:\d{2}$/.test(value) ? `${value}:00` : value);
  const parts = [
    courseCode.trim().toUpperCase(),
    roomId,
    date,
    time(start),
    time(end),
  ];
  const key = parts.map((value) => `${[...value].length}:${value}`).join("");
  return createHash("sha256").update(key, "utf8").digest("hex");
}
test("teaching assistant manages only own manual schedules and needs import capability", async () => {
  const assistant = await signIn("trogiang@campus.local", "LocalAssistant123!");
  const assistantImporter = await signIn(
    "trogiang.import@campus.local",
    "LocalAssistantImport123!",
  );
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const scheduleId = crypto.randomUUID();
  const foreignScheduleId = crypto.randomUUID();
  const ownBatchId = crypto.randomUUID();
  const deniedBatchId = crypto.randomUUID();
  const row = {
    course_id: "10000000-0000-0000-0000-000000000001",
    course_code_snapshot: "NUR 101",
    course_name_snapshot: "Physical assessment",
    room_id: "20000000-0000-0000-0000-000000000001",
    start_time: "07:30",
    end_time: "09:30",
    source: "manual",
    schedule_status: "published",
    student_count: 20,
    published_at: new Date().toISOString(),
    lecturer_id: lecturer.user.id,
  };
  try {
    const ownInsert = await serviceClient()
      .from("class_schedules")
      .insert({
        ...row,
        id: scheduleId,
        schedule_date: "2047-10-01",
        created_by: assistant.user.id,
        published_by: assistant.user.id,
      });
    assert.ifError(ownInsert.error);
    assert.ifError(
      (
        await assistant.supabase.rpc("reschedule_class", {
          target_schedule_id: scheduleId,
          target_schedule_date: "2047-10-02",
        })
      ).error,
    );

    assert.ifError(
      (
        await serviceClient()
          .from("class_schedules")
          .insert({
            ...row,
            id: foreignScheduleId,
            schedule_date: "2047-10-03",
            created_by: admin.user.id,
            published_by: admin.user.id,
          })
      ).error,
    );
    assert.equal(
      (
        await assistant.supabase.rpc("reschedule_class", {
          target_schedule_id: foreignScheduleId,
          target_schedule_date: "2047-10-04",
        })
      ).error?.code,
      "42501",
    );

    const deniedBatch = await assistant.supabase.from("import_batches").insert({
      id: deniedBatchId,
      original_file_name: "denied.xlsx",
      file_hash: crypto.randomUUID(),
      status: "importing",
      created_by: assistant.user.id,
      room_type_id: "40000000-0000-0000-0000-000000000001",
    });
    assert.equal(deniedBatch.error?.code, "42501");

    const allowedBatch = await assistantImporter.supabase
      .from("import_batches")
      .insert({
        id: ownBatchId,
        original_file_name: "allowed.xlsx",
        file_hash: crypto.randomUUID(),
        status: "importing",
        created_by: assistantImporter.user.id,
        room_type_id: "40000000-0000-0000-0000-000000000001",
      });
    assert.ifError(allowedBatch.error);
  } finally {
    await serviceClient()
      .from("class_schedules")
      .delete()
      .in("id", [scheduleId, foreignScheduleId]);
    await admin.supabase.from("import_batches").delete().eq("id", ownBatchId);
  }
});

test("personnel update is atomic, versioned, and separates import capability", async () => {
  const service = serviceClient();
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const email = `personnel-${crypto.randomUUID()}@campus.local`;
  const { data: created, error: createError } =
    await service.auth.admin.createUser({
      email,
      password: "PersonnelAtomic123!",
      email_confirm: true,
      app_metadata: { preapproved: true },
      user_metadata: { full_name: "Nhan su kiem thu" },
    });
  assert.ifError(createError);
  const profileId = created.user.id;
  try {
    const { data: before, error: beforeError } = await admin.supabase
      .from("profiles")
      .select("access_version")
      .eq("id", profileId)
      .single();
    assert.ifError(beforeError);
    const input = {
      target_profile_id: profileId,
      target_email: email,
      target_full_name: "Tro giang kiem thu",
      target_phone: "0912345678",
      target_title: "Tro giang",
      target_roles: ["teaching_assistant"],
      target_can_import_schedules: true,
      target_room_type_ids: ["40000000-0000-0000-0000-000000000001"],
      target_email_room_type_ids: [],
      target_allow_basic_medical_access: false,
      target_is_active: true,
      target_expected_version: before.access_version,
    };
    const saved = await admin.supabase.rpc("admin_update_personnel", input);
    assert.ifError(saved.error);
    assert.equal(saved.data.can_import_schedules, true);
    assert.deepEqual(saved.data.roles, ["teaching_assistant"]);

    const stale = await admin.supabase.rpc("admin_update_personnel", {
      ...input,
      target_full_name: "Stale overwrite",
    });
    assert.equal(stale.error?.code, "P0001");
    assert.equal(stale.error?.message, "PERSONNEL_CHANGED_RELOAD_REQUIRED");

    const invalid = await admin.supabase.rpc("admin_update_personnel", {
      ...input,
      target_roles: ["viewer", "staff"],
      target_expected_version: saved.data.access_version,
    });
    assert.equal(invalid.error?.code, "22023");

    const { data: after, error: afterError } = await admin.supabase
      .from("profiles")
      .select("full_name, can_import_schedules, access_version")
      .eq("id", profileId)
      .single();
    assert.ifError(afterError);
    assert.equal(after.full_name, "Tro giang kiem thu");
    assert.equal(after.can_import_schedules, true);
    assert.equal(after.access_version, saved.data.access_version);

    const listed = await admin.supabase.rpc("admin_list_personnel", {
      target_query: email,
      target_role: "teaching_assistant",
      target_import_permission: "enabled",
      target_status: "active",
      target_page: 1,
      target_page_size: 50,
    });
    assert.ifError(listed.error);
    assert.equal(listed.data.length, 1);
    assert.equal(listed.data[0].id, profileId);

    const deprecatedRole = await service.from("user_roles").insert({
      user_id: profileId,
      role: "importer",
      created_by: admin.user.id,
    });
    assert.equal(deprecatedRole.error?.code, "22023");
  } finally {
    await service.auth.admin.deleteUser(profileId);
  }
});

function personnelUpdateInput(profile, overrides = {}) {
  return {
    target_profile_id: profile.id,
    target_email: profile.email,
    target_full_name: profile.full_name,
    target_phone: profile.phone,
    target_title: profile.title,
    target_roles: ["lecturer"],
    target_can_import_schedules: false,
    target_room_type_ids: ["40000000-0000-0000-0000-000000000001"],
    target_email_room_type_ids: [],
    target_allow_basic_medical_access: false,
    target_is_active: true,
    target_expected_version: profile.access_version,
    ...overrides,
  };
}

async function createPersonnelFixture(service, label) {
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const email = `${safeLabel}-${crypto.randomUUID()}@campus.local`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: "PersonnelAuthority123!",
    email_confirm: true,
    app_metadata: { preapproved: true },
    user_metadata: { full_name: label },
  });
  assert.ifError(error);
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id,email,full_name,phone,title,is_active,access_version")
    .eq("id", data.user.id)
    .single();
  assert.ifError(profileError);
  return profile;
}

async function configurePersonnelFixture(
  actor,
  service,
  profileId,
  roles,
  roomTypeIds,
) {
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id,email,full_name,phone,title,is_active,access_version")
    .eq("id", profileId)
    .single();
  assert.ifError(profileError);
  const changed = await actor.supabase.rpc(
    "admin_update_personnel",
    personnelUpdateInput(profile, {
      target_roles: roles,
      target_room_type_ids: roomTypeIds,
    }),
  );
  assert.ifError(changed.error);
  return changed.data;
}

test("personnel authority chỉ cho Root và Bảo; Root/Admin hiện hữu được bảo vệ", async () => {
  const service = serviceClient();
  const root = await signIn("admin@campus.local", "LocalAdmin123!");
  const manager = await signIn(
    "bao.nguyen@eiu.edu.vn",
    "LocalPersonnelManager123!",
  );
  const ordinaryAdmin = await signIn(
    "admin.other@campus.local",
    "LocalOtherAdmin123!",
  );
  const staff = await signIn("staff@campus.local", "LocalStaff123!");
  const target = await createPersonnelFixture(service, "Authority target");
  const raceTarget = await createPersonnelFixture(service, "Authority race");
  try {
    const contexts = await Promise.all(
      [root, manager, ordinaryAdmin, staff].map(({ supabase }) =>
        supabase.rpc("get_personnel_authority_context"),
      ),
    );
    contexts.forEach(({ error }) => assert.ifError(error));
    assert.equal(contexts[0].data.is_root_administrator, true);
    assert.equal(contexts[0].data.can_manage_personnel, true);
    assert.equal(contexts[1].data.is_secondary_personnel_manager, true);
    assert.equal(contexts[1].data.can_manage_personnel, true);
    assert.equal(contexts[2].data.can_manage_personnel, false);
    assert.equal(contexts[3].data.can_manage_personnel, false);

    for (const actor of [ordinaryAdmin, staff]) {
      const listed = await actor.supabase.rpc("admin_list_personnel", {
        target_page: 1,
        target_page_size: 50,
      });
      assert.equal(listed.error?.code, "42501");
      assert.equal(listed.error?.message, "PERSONNEL_MANAGER_REQUIRED");
      const changed = await actor.supabase.rpc(
        "admin_update_personnel",
        personnelUpdateInput(target),
      );
      assert.equal(changed.error?.code, "42501");
      assert.equal(changed.error?.message, "PERSONNEL_MANAGER_REQUIRED");
    }

    const directProfileWrite = await manager.supabase
      .from("profiles")
      .update({ can_import_schedules: true })
      .eq("id", target.id)
      .select("id");
    assert.ok(
      directProfileWrite.error || directProfileWrite.data?.length === 0,
      "Personnel mutations must go through the atomic RPC",
    );
    const directRoleWrite = await manager.supabase.from("user_roles").insert({
      user_id: target.id,
      role: "admin",
      created_by: manager.user.id,
    });
    assert.ok(directRoleWrite.error);

    const rootManagerRace = await Promise.all([
      root.supabase.rpc(
        "admin_update_personnel",
        personnelUpdateInput(raceTarget, { target_title: "Root writer" }),
      ),
      manager.supabase.rpc(
        "admin_update_personnel",
        personnelUpdateInput(raceTarget, { target_title: "Manager writer" }),
      ),
    ]);
    assert.equal(
      rootManagerRace.filter(({ error }) => !error).length,
      1,
      "exactly one concurrent writer succeeds",
    );
    assert.equal(
      rootManagerRace.filter(
        ({ error }) => error?.message === "PERSONNEL_CHANGED_RELOAD_REQUIRED",
      ).length,
      1,
      "the other concurrent writer receives the stale-version error",
    );

    for (const [field, value] of [
      ["target_expected_version", null],
      ["target_is_active", null],
      ["target_can_import_schedules", null],
      ["target_allow_basic_medical_access", null],
    ]) {
      const result = await root.supabase.rpc("admin_update_personnel", {
        ...personnelUpdateInput(target),
        [field]: value,
      });
      assert.equal(result.error?.code, "22023");
    }

    const { data: rootProfile } = await service
      .from("profiles")
      .select("id,email,full_name,phone,title,is_active,access_version")
      .eq("id", root.user.id)
      .single();
    const rootSelf = await root.supabase.rpc(
      "admin_update_personnel",
      personnelUpdateInput(rootProfile, { target_roles: ["admin"] }),
    );
    assert.equal(rootSelf.error?.message, "CANNOT_MANAGE_OWN_SECURITY");
    const managerSelf = await manager.supabase.rpc(
      "admin_update_personnel",
      personnelUpdateInput(
        {
          ...(
            await service
              .from("profiles")
              .select("id,email,full_name,phone,title,is_active,access_version")
              .eq("id", manager.user.id)
              .single()
          ).data,
        },
        { target_roles: ["admin"] },
      ),
    );
    assert.equal(managerSelf.error?.message, "CANNOT_MANAGE_OWN_SECURITY");

    const protectedProfile = await service
      .from("profiles")
      .update({ is_active: false })
      .eq("id", root.user.id);
    assert.equal(
      protectedProfile.error?.message,
      "ROOT_ADMIN_SECURITY_IMMUTABLE",
    );
    const protectedRole = await service
      .from("user_roles")
      .delete()
      .eq("user_id", root.user.id)
      .eq("role", "admin");
    assert.ok(protectedRole.error);

    const promoted = await manager.supabase.rpc(
      "admin_update_personnel",
      personnelUpdateInput(target, { target_roles: ["admin"] }),
    );
    assert.ifError(promoted.error);
    assert.deepEqual(promoted.data.roles, ["admin"]);
    const managerSecondEdit = await manager.supabase.rpc(
      "admin_update_personnel",
      personnelUpdateInput(
        { ...target, access_version: promoted.data.access_version },
        { target_roles: ["admin"], target_full_name: "Denied" },
      ),
    );
    assert.equal(
      managerSecondEdit.error?.message,
      "ROOT_ADMIN_REQUIRED_FOR_ADMIN_ACCOUNT",
    );
    const rootEdit = await root.supabase.rpc(
      "admin_update_personnel",
      personnelUpdateInput(
        { ...target, access_version: promoted.data.access_version },
        { target_roles: ["admin"], target_full_name: "Root managed admin" },
      ),
    );
    assert.ifError(rootEdit.error);

    const staleVersion = rootEdit.data.access_version;
    const rootRace = await Promise.all([
      root.supabase.rpc(
        "admin_update_personnel",
        personnelUpdateInput(
          { ...target, access_version: staleVersion },
          { target_roles: ["admin"], target_title: "Root session A" },
        ),
      ),
      root.supabase.rpc(
        "admin_update_personnel",
        personnelUpdateInput(
          { ...target, access_version: staleVersion },
          { target_roles: ["admin"], target_title: "Root session B" },
        ),
      ),
    ]);
    assert.equal(rootRace.filter(({ error }) => !error).length, 1);
    assert.equal(
      rootRace.filter(
        ({ error }) => error?.message === "PERSONNEL_CHANGED_RELOAD_REQUIRED",
      ).length,
      1,
    );
  } finally {
    await Promise.all([
      service.auth.admin.deleteUser(target.id),
      service.auth.admin.deleteUser(raceTarget.id),
    ]);
  }
});

test("bulk personnel import rollback atomic, tăng version và bỏ qua tài khoản bảo vệ", async () => {
  const service = serviceClient();
  const root = await signIn("admin@campus.local", "LocalAdmin123!");
  const first = await createPersonnelFixture(service, "Import first");
  const second = await createPersonnelFixture(service, "Import second");
  const roomType = "40000000-0000-0000-0000-000000000001";
  const row = (profile, overrides = {}) => ({
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    phone: profile.phone,
    title: profile.title,
    roles: ["lecturer"],
    room_type_ids: [roomType],
    email_room_type_ids: [],
    can_import_schedules: false,
    allow_basic_medical_access: false,
    is_active: true,
    is_new: false,
    access_version: profile.access_version,
    ...overrides,
  });
  try {
    const failed = await root.supabase.rpc("admin_apply_personnel_import", {
      target_mode: "new",
      target_file_name: "failure-injection.xlsx",
      target_rows: [
        row(first, { full_name: "Must rollback" }),
        row(second, { roles: ["viewer", "staff"] }),
      ],
    });
    assert.equal(failed.error?.code, "22023");
    const { data: unchanged } = await service
      .from("profiles")
      .select("id,full_name,access_version")
      .in("id", [first.id, second.id])
      .order("id");
    const originalById = new Map([
      [first.id, first],
      [second.id, second],
    ]);
    for (const profile of unchanged) {
      assert.equal(profile.full_name, originalById.get(profile.id)?.full_name);
      assert.equal(
        profile.access_version,
        originalById.get(profile.id)?.access_version,
      );
    }

    const applied = await root.supabase.rpc("admin_apply_personnel_import", {
      target_mode: "new",
      target_file_name: "success.xlsx",
      target_rows: [row(first, { full_name: "Imported atomically" })],
    });
    assert.ifError(applied.error);
    assert.equal(applied.data.updated, 1);
    const { data: afterImport } = await service
      .from("profiles")
      .select("full_name,access_version")
      .eq("id", first.id)
      .single();
    assert.equal(afterImport.full_name, "Imported atomically");
    assert.equal(afterImport.access_version, first.access_version + 1);

    const staleDrawer = await root.supabase.rpc(
      "admin_update_personnel",
      personnelUpdateInput(first),
    );
    assert.equal(
      staleDrawer.error?.message,
      "PERSONNEL_CHANGED_RELOAD_REQUIRED",
    );

    const { data: principals } = await service
      .from("system_security_principals")
      .select("root_admin_id,personnel_manager_id")
      .single();
    const { data: protectedProfiles } = await service
      .from("profiles")
      .select("id,email,full_name,phone,title,is_active,access_version")
      .in("id", [principals.root_admin_id, principals.personnel_manager_id]);
    const { data: activeOps } = await service
      .from("personnel_update_operations")
      .select("id")
      .in("profile_id", [
        principals.root_admin_id,
        principals.personnel_manager_id,
      ])
      .in("status", [
        "reserved",
        "auth_updated",
        "rollback_required",
        "reconciliation_required",
      ]);
    for (const operation of activeOps ?? []) {
      assert.ifError(
        (
          await service.rpc("resolve_personnel_update_operation", {
            target_operation_id: operation.id,
            target_status: "expired",
            target_error: "test setup cleanup",
          })
        ).error,
      );
    }
    const protectedRows = protectedProfiles.map((profile) =>
      row(profile, { roles: [], room_type_ids: [], is_active: false }),
    );
    const protectedImport = await root.supabase.rpc(
      "admin_apply_personnel_import",
      {
        target_mode: "new",
        target_file_name: "protected.xlsx",
        target_rows: protectedRows,
      },
    );
    if (protectedImport.error) {
      assert.match(
        protectedImport.error.message,
        /PERSONNEL_UPDATE_IN_PROGRESS/,
      );
    } else {
      assert.equal(protectedImport.data.skipped_protected, 2);
    }
    const { data: protectedAfter } = await service
      .from("profiles")
      .select("id,is_active,access_version")
      .in("id", [principals.root_admin_id, principals.personnel_manager_id]);
    for (const profile of protectedAfter) {
      const before = protectedProfiles.find(({ id }) => id === profile.id);
      assert.equal(profile.is_active, true);
      assert.equal(profile.access_version, before.access_version);
    }
  } finally {
    await Promise.all([
      service.auth.admin.deleteUser(first.id),
      service.auth.admin.deleteUser(second.id),
    ]);
  }
});

test("import validation statuses và hash RPC áp dụng giới hạn an toàn", async () => {
  const service = serviceClient();
  const importer = await signIn("importer@campus.local", "LocalImporter123!");
  const staff = await signIn("staff@campus.local", "LocalStaff123!");
  const batchId = crypto.randomUUID();
  const roomTypeId = "40000000-0000-0000-0000-000000000001";
  try {
    assert.ifError(
      (
        await importer.supabase.from("import_batches").insert({
          id: batchId,
          original_file_name: "status-test.xlsx",
          file_hash: crypto.randomUUID(),
          status: "importing",
          created_by: importer.user.id,
          room_type_id: roomTypeId,
        })
      ).error,
    );
    for (const [index, status] of ["conflict", "system_error"].entries()) {
      const recorded = await importer.supabase.rpc(
        "record_import_validation_row",
        {
          target_batch_id: batchId,
          target_row_number: index + 1,
          target_hash: crypto.randomUUID(),
          target_raw: {},
          target_normalized: {},
          target_status: status,
          target_errors: [{ message: status }],
          target_warnings: [],
        },
      );
      assert.ifError(recorded.error);
    }
    const { data: statuses, error: statusesError } = await importer.supabase
      .from("import_rows")
      .select("validation_status")
      .eq("import_batch_id", batchId)
      .order("row_number");
    assert.ifError(statusesError);
    assert.deepEqual(
      statuses.map(({ validation_status }) => validation_status),
      ["conflict", "system_error"],
    );

    const nullHashes = await importer.supabase.rpc(
      "find_existing_import_hashes",
      { target_hashes: null, target_room_type_id: roomTypeId },
    );
    assert.equal(nullHashes.error?.code, "22023");
    const empty = await importer.supabase.rpc("find_existing_import_hashes", {
      target_hashes: [],
      target_room_type_id: roomTypeId,
    });
    assert.ifError(empty.error);
    assert.deepEqual(empty.data, []);
    const max = await importer.supabase.rpc("find_existing_import_hashes", {
      target_hashes: Array.from({ length: 500 }, (_, index) =>
        String(index).padStart(64, "0"),
      ),
      target_room_type_id: roomTypeId,
    });
    assert.ifError(max.error);
    const tooMany = await importer.supabase.rpc("find_existing_import_hashes", {
      target_hashes: Array.from({ length: 501 }, (_, index) =>
        String(index).padStart(64, "0"),
      ),
      target_room_type_id: roomTypeId,
    });
    assert.equal(tooMany.error?.code, "22023");
    const noCapability = await staff.supabase.rpc(
      "find_existing_import_hashes",
      { target_hashes: [], target_room_type_id: roomTypeId },
    );
    assert.equal(noCapability.error?.code, "42501");
  } finally {
    await service.from("import_batches").delete().eq("id", batchId);
  }
});

test("chỉ tài khoản nhân sự được duyệt trước mới có thể được tạo", async () => {
  const supabase = client();
  const email = `auth-whitelist-${crypto.randomUUID()}@eiu.edu.vn`;
  const { data, error } = await supabase.auth.signUp({
    email,
    password: "WhitelistCheck123!",
  });

  assert.ok(error);
  assert.equal(error.status, 403);
  assert.match(error.message, /Nhân sự/i);
  assert.equal(data.user, null);
});

test("quyền nhập lịch chỉ quản lý batch của mình và Trợ giảng chỉ quản lý lịch mình tạo", async () => {
  const service = serviceClient();
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const importer = await signIn("importer@campus.local", "LocalImporter123!");
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const otherEmail = `other-importer-${crypto.randomUUID()}@campus.local`;
  const otherPassword = "OtherImporter123!";
  const { data: created, error: createError } =
    await service.auth.admin.createUser({
      email: otherEmail,
      password: otherPassword,
      email_confirm: true,
      app_metadata: { preapproved: true },
      user_metadata: { full_name: "Importer khác" },
    });
  assert.ifError(createError);
  const otherId = created.user.id;
  const ownId = crypto.randomUUID();
  const otherIdSchedule = crypto.randomUUID();
  const ownBatchId = crypto.randomUUID();
  const otherBatchId = crypto.randomUUID();
  let ownBatchScheduleId = null;
  let otherBatchScheduleId = null;
  try {
    assert.ifError(
      (
        await service.from("user_roles").insert({
          user_id: otherId,
          role: "teaching_assistant",
          created_by: admin.user.id,
        })
      ).error,
    );
    assert.ifError(
      (
        await service
          .from("profiles")
          .update({ can_import_schedules: true })
          .eq("id", otherId)
      ).error,
    );
    assert.ifError(
      (
        await service.from("profile_room_types").upsert({
          profile_id: otherId,
          room_type_id: "40000000-0000-0000-0000-000000000001",
          created_by: admin.user.id,
        })
      ).error,
    );
    const otherImporter = await signIn(otherEmail, otherPassword);
    const batches = [
      {
        id: ownBatchId,
        original_file_name: "own.xlsx",
        file_hash: crypto.randomUUID(),
        status: "importing",
        created_by: importer.user.id,
        room_type_id: "40000000-0000-0000-0000-000000000001",
      },
      {
        id: otherBatchId,
        original_file_name: "other.xlsx",
        file_hash: crypto.randomUUID(),
        status: "importing",
        created_by: otherId,
        room_type_id: "40000000-0000-0000-0000-000000000001",
      },
    ];
    assert.ifError(
      (await importer.supabase.from("import_batches").insert(batches[0])).error,
    );
    assert.ifError(
      (await otherImporter.supabase.from("import_batches").insert(batches[1]))
        .error,
    );
    const base = {
      course_id: "10000000-0000-0000-0000-000000000001",
      course_code_snapshot: "NUR 101",
      course_name_snapshot: "Thăm khám thể chất",
      room_id: "20000000-0000-0000-0000-000000000001",
      start_time: "07:30",
      end_time: "09:30",
      student_count: 20,
      source: "manual",
      schedule_status: "published",
      published_at: new Date().toISOString(),
    };
    assert.ifError(
      (
        await serviceClient()
          .from("class_schedules")
          .insert({
            ...base,
            id: ownId,
            schedule_date: "2039-09-01",
            lecturer_id: importer.user.id,
            created_by: importer.user.id,
            published_by: importer.user.id,
          })
      ).error,
    );
    assert.ifError(
      (
        await serviceClient()
          .from("class_schedules")
          .insert({
            ...base,
            id: otherIdSchedule,
            schedule_date: "2039-09-02",
            lecturer_id: importer.user.id,
            created_by: otherId,
            published_by: otherId,
          })
      ).error,
    );
    const createImported = async (actor, batchId, date, lecturerId) =>
      actor.supabase.rpc("create_import_schedule_row", {
        target_batch_id: batchId,
        target_row_number: 1,
        target_hash: importScheduleHash({
          courseCode: "NUR 101",
          roomId: base.room_id,
          date,
          start: base.start_time,
          end: base.end_time,
        }),
        target_raw: {},
        target_normalized: {},
        target_status: "imported",
        target_errors: [],
        target_warnings: [],
        target_course_id: base.course_id,
        target_course_code: base.course_code_snapshot,
        target_course_name: base.course_name_snapshot,
        target_room_id: base.room_id,
        target_lecturer_id: lecturerId,
        target_date: date,
        target_start: base.start_time,
        target_end: base.end_time,
        target_note: null,
        target_student_count: base.student_count,
        target_semester: "HK1",
      });
    const ownImported = await createImported(
      importer,
      ownBatchId,
      "2039-09-03",
      lecturer.user.id,
    );
    assert.ifError(ownImported.error);
    ownBatchScheduleId = ownImported.data;
    const otherImported = await createImported(
      otherImporter,
      otherBatchId,
      "2039-09-04",
      lecturer.user.id,
    );
    assert.ifError(otherImported.error);
    otherBatchScheduleId = otherImported.data;
    const { data: ownBatchState, error: ownBatchStateError } =
      await importer.supabase
        .from("class_schedules")
        .select("id, source, import_batch_id, created_by")
        .eq("id", ownBatchScheduleId)
        .single();
    assert.ifError(ownBatchStateError);
    assert.equal(ownBatchState.source, "import");
    assert.equal(ownBatchState.import_batch_id, ownBatchId);
    assert.equal(ownBatchState.created_by, importer.user.id);
    const { data: ownBatchStateRow, error: ownBatchError } =
      await importer.supabase
        .from("import_batches")
        .select("id, created_by, room_type_id")
        .eq("id", ownBatchId)
        .single();
    assert.ifError(ownBatchError);
    assert.equal(ownBatchStateRow.created_by, importer.user.id);

    const lecturerReschedule = await importer.supabase.rpc("reschedule_class", {
      target_schedule_id: otherIdSchedule,
      target_schedule_date: "2039-09-12",
    });
    assert.ifError(lecturerReschedule.error);
    const deniedAssign = await importer.supabase.rpc("assign_class_lecturers", {
      target_schedule_id: otherIdSchedule,
      target_lecturer_ids: [],
    });
    assert.equal(deniedAssign.error?.code, "42501");
    const deniedRawDelete = await importer.supabase
      .from("class_schedules")
      .delete()
      .eq("id", otherIdSchedule)
      .select("id");
    assert.equal(deniedRawDelete.error?.code, "42501");
    assert.match(deniedRawDelete.error?.message ?? "", /permission denied/i);

    const deniedRpcDelete = await importer.supabase.rpc(
      "delete_skills_lab_class_schedule",
      {
        target_schedule_id: otherIdSchedule,
      },
    );
    assert.equal(deniedRpcDelete.error?.code, "42501");

    const lecturerDetails = await importer.supabase.rpc(
      "update_class_schedule_details",
      {
        target_schedule_id: otherIdSchedule,
        target_schedule_date: "2039-09-15",
        target_start_time: "07:30",
        target_end_time: "09:30",
        target_room_id: "20000000-0000-0000-0000-000000000001",
        target_student_count: 20,
        target_lecturer_ids: [importer.user.id],
      },
    );
    assert.ifError(lecturerDetails.error);

    const unrelatedReschedule = await importer.supabase.rpc(
      "reschedule_class",
      {
        target_schedule_id: otherBatchScheduleId,
        target_schedule_date: "2039-09-14",
      },
    );
    assert.equal(unrelatedReschedule.error?.code, "42501");

    assert.ifError(
      (
        await importer.supabase.rpc("reschedule_class", {
          target_schedule_id: ownId,
          target_schedule_date: "2039-09-11",
        })
      ).error,
    );
    assert.ifError(
      (
        await importer.supabase.rpc("assign_class_lecturers", {
          target_schedule_id: ownId,
          target_lecturer_ids: [importer.user.id, lecturer.user.id],
        })
      ).error,
    );
    assert.ifError(
      (
        await importer.supabase.rpc("reschedule_class", {
          target_schedule_id: ownBatchScheduleId,
          target_schedule_date: "2039-09-13",
        })
      ).error,
    );
    assert.equal(
      (
        await importer.supabase.rpc("reschedule_class", {
          target_schedule_id: otherBatchScheduleId,
          target_schedule_date: "2039-09-14",
        })
      ).error?.code,
      "42501",
    );

    assert.ifError(
      (
        await otherImporter.supabase.rpc("reschedule_class", {
          target_schedule_id: otherBatchScheduleId,
          target_schedule_date: "2039-09-17",
        })
      ).error,
    );
    assert.ifError(
      (
        await otherImporter.supabase.rpc("assign_class_lecturers", {
          target_schedule_id: otherBatchScheduleId,
          target_lecturer_ids: [lecturer.user.id],
        })
      ).error,
    );

    assert.ifError(
      (
        await admin.supabase
          .from("profiles")
          .update({ can_import_schedules: false })
          .eq("id", importer.user.id)
      ).error,
    );
    assert.ifError(
      (
        await importer.supabase.rpc("reschedule_class", {
          target_schedule_id: otherIdSchedule,
          target_schedule_date: "2039-09-16",
        })
      ).error,
    );
    assert.equal(
      (
        await importer.supabase.rpc("assign_class_lecturers", {
          target_schedule_id: otherIdSchedule,
          target_lecturer_ids: [lecturer.user.id],
        })
      ).error?.code,
      "42501",
    );
    assert.ifError(
      (
        await admin.supabase
          .from("profiles")
          .update({ can_import_schedules: true })
          .eq("id", importer.user.id)
      ).error,
    );

    const ownDelete = await serviceClient()
      .from("class_schedules")
      .delete()
      .eq("id", ownId)
      .select("id")
      .single();
    assert.ifError(ownDelete.error);
  } finally {
    await admin.supabase
      .from("profiles")
      .update({ can_import_schedules: true })
      .eq("id", importer.user.id);
    await serviceClient()
      .from("class_schedules")
      .delete()
      .in(
        "id",
        [
          ownId,
          otherIdSchedule,
          ownBatchScheduleId,
          otherBatchScheduleId,
        ].filter(Boolean),
      );
    await admin.supabase
      .from("import_batches")
      .delete()
      .in("id", [ownBatchId, otherBatchId]);
    await service.auth.admin.deleteUser(otherId);
  }
});

test("Staff ngoài room-type scope không quản lý được phiếu thiết bị bằng direct RPC/RLS", async () => {
  const service = serviceClient();
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const scopedEmail = `basic-only-staff-${crypto.randomUUID()}@campus.local`;
  const password = "ScopedStaff123!";
  const { data: created, error: createError } =
    await service.auth.admin.createUser({
      email: scopedEmail,
      password,
      email_confirm: true,
      app_metadata: { preapproved: true },
      user_metadata: { full_name: "Staff ngoài scope" },
    });
  assert.ifError(createError);
  const staffId = created.user.id;
  const scheduleId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const catalogId = crypto.randomUUID();
  try {
    const { data: scopedProfile, error: scopedProfileError } = await service
      .from("profiles")
      .select("id,email,full_name,phone,title,is_active,access_version")
      .eq("id", staffId)
      .single();
    assert.ifError(scopedProfileError);
    assert.ifError(
      (
        await admin.supabase.rpc(
          "admin_update_personnel",
          personnelUpdateInput(scopedProfile, {
            target_roles: ["staff"],
            target_room_type_ids: ["40000000-0000-0000-0000-000000000002"],
          }),
        )
      ).error,
    );
    assert.ifError(
      (
        await serviceClient().from("class_schedules").insert({
          id: scheduleId,
          course_id: "10000000-0000-0000-0000-000000000001",
          course_code_snapshot: "NUR 101",
          course_name_snapshot: "Thăm khám thể chất",
          room_id: "20000000-0000-0000-0000-000000000001",
          lecturer_id: lecturer.user.id,
          schedule_date: "2039-10-02",
          start_time: "07:30",
          end_time: "09:30",
          student_count: 20,
          semester: "HK1",
          schedule_status: "published",
          created_by: admin.user.id,
          published_by: admin.user.id,
          published_at: new Date().toISOString(),
        })
      ).error,
    );
    assert.ifError(
      (
        await legacyRequestFixture({
          id: requestId,
          class_schedule_id: scheduleId,
          registrant_id: admin.user.id,
          responsible_lecturer_id: lecturer.user.id,
          semester: "HK1",
          phone_snapshot: "0901000001",
          email_snapshot: "admin@campus.local",
          receive_at: "2039-10-02T02:00:00Z",
          return_at: "2039-10-02T09:00:00Z",
          status: "new",
          created_by: admin.user.id,
        })
      ).error,
    );
    assert.ifError(
      (
        await admin.supabase.from("equipment_catalog").insert({
          id: catalogId,
          item_name: "Thiết bị kiểm thử scope",
          commercial_name: `Scope ${catalogId}`,
          unit: "Cái",
        })
      ).error,
    );
    const scopedStaff = await signIn(scopedEmail, password);
    assert.equal(
      (
        await scopedStaff.supabase.rpc("manager_confirm_equipment_status", {
          target_request_id: requestId,
          target_status: "preparing",
        })
      ).error?.code,
      "42501",
    );
    assert.equal(
      (
        await scopedStaff.supabase.rpc(
          "manager_review_late_equipment_request",
          {
            target_request_id: requestId,
            target_decision: "approved",
            target_note: null,
          },
        )
      ).error?.code,
      "42501",
    );
    // Direct DELETE privilege is revoked from authenticated role — expect 42501
    const deleted = await scopedStaff.supabase
      .from("equipment_requests")
      .delete()
      .eq("id", requestId)
      .select("id");
    assert.equal(deleted.error?.code, "42501");
    const unauthorizedItem = await scopedStaff.supabase
      .from("equipment_request_items")
      .insert({
        request_id: requestId,
        catalog_item_id: catalogId,
        skill_name: "Ngoài scope",
        quantity: 1,
      });
    assert.equal(unauthorizedItem.error?.code, "42501");

    await legacyStageFixture(requestId, "preparing");
    const inScopeStaff = await signIn("staff@campus.local", "LocalStaff123!");
    assert.ifError(
      (
        await inScopeStaff.supabase.rpc("manager_confirm_equipment_status", {
          target_request_id: requestId,
          target_status: "handed_over",
        })
      ).error,
    );
  } finally {
    // Must delete equipment_requests BEFORE class_schedules (FK dependency)
    // Use serviceClient() since DELETE privilege is revoked from authenticated role
    await cleanupLegacyRequest(requestId);
    await admin.supabase.from("equipment_catalog").delete().eq("id", catalogId);
    await serviceClient().from("class_schedules").delete().eq("id", scheduleId);
    await service.auth.admin.deleteUser(staffId);
  }
});

test("chuyển email Off chỉ suppress pending, không đổi row đang processing", async () => {
  const service = serviceClient();
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const id = crypto.randomUUID();
  try {
    assert.ifError(
      (
        await admin.supabase.rpc("set_email_delivery_mode", {
          target_mode: "live",
        })
      ).error,
    );
    assert.ifError(
      (
        await service.from("email_notifications").insert({
          id,
          notification_type: "second_followup_test",
          recipient_id: admin.user.id,
          recipient_email: "original@example.com",
          dedupe_key: `second-followup:${id}`,
          subject: "Race Off",
          payload: {},
        })
      ).error,
    );
    // Make this notification the deterministic first claim candidate; unrelated
    // queued rows must not turn this race-condition test into a batch-order test.
    assert.ifError(
      (
        await service
          .from("email_notifications")
          .update({ created_at: "2000-01-01T00:00:00.000Z" })
          .eq("id", id)
      ).error,
    );
    assert.ifError(
      (await service.rpc("claim_email_notifications", { batch_size: 1 })).error,
    );
    assert.ifError(
      (
        await admin.supabase.rpc("set_email_delivery_mode", {
          target_mode: "off",
        })
      ).error,
    );
    const { data, error } = await service
      .from("email_notifications")
      .select("status")
      .eq("id", id)
      .single();
    assert.ifError(error);
    assert.equal(data.status, "processing");
  } finally {
    await service.from("email_notifications").delete().eq("id", id);
    await admin.supabase.rpc("set_email_delivery_mode", {
      target_mode: "test",
    });
  }
});

test("Người xem chỉ đọc lịch và nhận email theo loại phòng đã chọn", async () => {
  const service = serviceClient();
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const email = "viewer-" + crypto.randomUUID() + "@campus.local";
  const password = "LocalViewer123!";
  let scheduleId;
  const { data: created, error: createUserError } =
    await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "Người xem kiểm thử" },
      app_metadata: { preapproved: true },
    });
  assert.ifError(createUserError);
  assert.ok(created.user);
  const viewerId = created.user.id;

  const previousMode = await service
    .from("email_delivery_settings")
    .select("delivery_mode")
    .eq("setting_key", "primary")
    .single();
  assert.ifError(previousMode.error);

  try {
    assert.ifError(
      (
        await admin.supabase.rpc("set_email_delivery_mode", {
          target_mode: "test",
        })
      ).error,
    );
    const { error: roleError } = await service.from("user_roles").insert({
      user_id: viewerId,
      role: "viewer",
      created_by: admin.user.id,
    });
    assert.ifError(roleError);
    const { error: scopeError } = await service
      .from("profile_room_types")
      .upsert({
        profile_id: viewerId,
        room_type_id: "40000000-0000-0000-0000-000000000001",
        created_by: admin.user.id,
        receive_schedule_emails: true,
      });
    assert.ifError(scopeError);

    const viewer = await signIn(email, password);
    const { error: readError } = await viewer.supabase
      .from("class_schedules")
      .select("id")
      .limit(1);
    assert.ifError(readError);

    const { error: writeError } = await viewer.supabase
      .from("class_schedules")
      .insert({
        id: crypto.randomUUID(),
        course_id: "10000000-0000-0000-0000-000000000001",
        course_code_snapshot: "NUR 101",
        course_name_snapshot: "Thăm khám thể chất",
        room_id: "20000000-0000-0000-0000-000000000001",
        schedule_date: "2039-08-19",
        start_time: "07:30",
        end_time: "11:30",
        source: "manual",
        schedule_status: "published",
        created_by: viewerId,
        published_by: viewerId,
        published_at: new Date().toISOString(),
      });
    assert.ok(writeError);

    const { data: createdSchedule, error: scheduleError } =
      await admin.supabase.rpc("create_manual_class_schedule", {
        target_course_id: "10000000-0000-0000-0000-000000000001",
        target_room_id: "20000000-0000-0000-0000-000000000001",
        target_lecturer_id: null,
        target_lecturer_2_id: null,
        target_schedule_date: "2039-08-20",
        target_start_time: "07:30",
        target_end_time: "11:30",
        target_note: null,
        target_student_count: 20,
        target_semester: "HK1",
      });
    assert.ifError(scheduleError);
    scheduleId = createdSchedule.id;

    const forbiddenReschedule = await viewer.supabase.rpc("reschedule_class", {
      target_schedule_id: scheduleId,
      target_schedule_date: "2039-08-21",
    });
    assert.ok(forbiddenReschedule.error);
    assert.equal(forbiddenReschedule.error.code, "42501");

    const forbiddenDetailsUpdate = await viewer.supabase.rpc(
      "update_class_schedule_details",
      {
        target_schedule_id: scheduleId,
        target_schedule_date: "2039-08-20",
        target_start_time: "07:30",
        target_end_time: "11:30",
        target_room_id: "20000000-0000-0000-0000-000000000001",
        target_student_count: 1,
        target_lecturer_ids: [],
      },
    );
    assert.ok(forbiddenDetailsUpdate.error);
    assert.equal(forbiddenDetailsUpdate.error.code, "42501");

    for (let batch = 0; batch < 10; batch++) {
      assert.ifError(
        (await service.rpc("process_email_outbox_events", { batch_size: 500 }))
          .error,
      );
      const probe = await service
        .from("email_notifications")
        .select("id")
        .eq("recipient_id", viewerId)
        .eq("notification_type", "class_schedule_created")
        .filter("payload->>schedule_id", "eq", scheduleId)
        .maybeSingle();
      assert.ifError(probe.error);
      if (probe.data) break;
    }
    const { data: notification, error: notificationError } =
      await serviceClient()
        .from("email_notifications")
        .select("id")
        .eq("recipient_id", viewerId)
        .eq("notification_type", "class_schedule_created")
        .filter("payload->>schedule_id", "eq", scheduleId)
        .maybeSingle();
    assert.ifError(notificationError);
    assert.ok(notification);
  } finally {
    if (scheduleId) {
      await serviceClient()
        .from("class_schedules")
        .delete()
        .eq("id", scheduleId);
    }
    await service.auth.admin.deleteUser(viewerId);
    assert.ifError(
      (
        await admin.supabase.rpc("set_email_delivery_mode", {
          target_mode: previousMode.data.delivery_mode,
        })
      ).error,
    );
  }
});

test("tối đa hai giảng viên nhận được lớp khi đăng ký đồng thời", async () => {
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const importerLecturer = await signIn(
    "importer@campus.local",
    "LocalImporter123!",
  );
  const scheduleId = crypto.randomUUID();

  const { error: insertError } = await serviceClient()
    .from("class_schedules")
    .insert({
      id: scheduleId,
      course_id: "10000000-0000-0000-0000-000000000001",
      course_code_snapshot: "NUR 101",
      course_name_snapshot: "Thăm khám thể chất",
      room_id: "20000000-0000-0000-0000-000000000001",
      schedule_date: "2030-08-20",
      start_time: "07:30",
      end_time: "11:30",
      source: "manual",
      schedule_status: "published",
      created_by: admin.user.id,
      published_by: admin.user.id,
      published_at: new Date().toISOString(),
    });
  assert.ifError(insertError);

  const results = await Promise.all([
    admin.supabase.rpc("claim_class", { target_schedule_id: scheduleId }),
    lecturer.supabase.rpc("claim_class", { target_schedule_id: scheduleId }),
    importerLecturer.supabase.rpc("claim_class", {
      target_schedule_id: scheduleId,
    }),
  ]);
  assert.equal(results.filter((result) => result.error === null).length, 2);
  assert.equal(results.filter((result) => result.error !== null).length, 1);

  const { data: claimed } = await admin.supabase
    .from("class_schedules")
    .select("lecturer_id, lecturer_2_id")
    .eq("id", scheduleId)
    .single();
  assert.ok(claimed?.lecturer_id);
  assert.ok(claimed?.lecturer_2_id);
  assert.notEqual(claimed.lecturer_id, claimed.lecturer_2_id);

  const users = [admin, lecturer, importerLecturer];
  for (const winnerId of [claimed.lecturer_id, claimed.lecturer_2_id]) {
    const winner = users.find(({ user }) => user.id === winnerId);
    assert.ok(winner);
    const withdrawn = await winner.supabase.rpc("withdraw_class", {
      target_schedule_id: scheduleId,
    });
    assert.ifError(withdrawn.error);
  }

  const { data: emptied } = await admin.supabase
    .from("class_schedules")
    .select("lecturer_id, lecturer_2_id")
    .eq("id", scheduleId)
    .single();
  assert.equal(emptied.lecturer_id, null);
  assert.equal(emptied.lecturer_2_id, null);

  await serviceClient().from("class_schedules").delete().eq("id", scheduleId);
});

test("giảng viên có quyền import vẫn chỉ tạo lịch manual khi tự phân công", async () => {
  const importer = await signIn("importer@campus.local", "LocalImporter123!");
  const scheduleId = crypto.randomUUID();
  const assignedScheduleId = crypto.randomUUID();
  await serviceClient()
    .from("class_schedules")
    .delete()
    .in("schedule_date", ["2030-08-21", "2030-08-22"]);

  const baseRow = {
    course_id: "10000000-0000-0000-0000-000000000002",
    course_code_snapshot: "NUR 205",
    course_name_snapshot: "Điều dưỡng nội khoa",
    room_id: "20000000-0000-0000-0000-000000000002",
    schedule_date: "2030-08-21",
    start_time: "13:30",
    end_time: "16:30",
    source: "manual",
    lecturer_id: importer.user.id,
    created_by: importer.user.id,
  };

  const { error: createError } = await serviceClient()
    .from("class_schedules")
    .insert({
      ...baseRow,
      id: scheduleId,
      schedule_status: "published",
      published_by: importer.user.id,
      published_at: new Date().toISOString(),
    });
  assert.ifError(createError);

  const { error: assignmentError } = await serviceClient()
    .from("class_schedules")
    .insert({
      ...baseRow,
      id: assignedScheduleId,
      schedule_date: "2030-08-22",
      schedule_status: "published",
      published_by: importer.user.id,
      published_at: new Date().toISOString(),
      lecturer_id: importer.user.id,
    });
  assert.ifError(assignmentError);

  const { data: deleted, error: deleteError } = await serviceClient()
    .from("class_schedules")
    .delete()
    .eq("id", scheduleId)
    .select("id")
    .single();
  assert.ifError(deleteError);
  assert.equal(deleted.id, scheduleId);
  await serviceClient()
    .from("class_schedules")
    .delete()
    .eq("id", assignedScheduleId);
});

test("staff không thể đăng ký hai ca cùng slot", async () => {
  const staff = await signIn("staff@campus.local", "LocalStaff123!");

  const first = await staff.supabase.rpc("register_staff_shifts", {
    shifts_payload: [
      {
        staff_id: staff.user.id,
        shift_date: "2030-08-23",
        shift_slot: "MORNING",
        start_time: "07:30",
        end_time: "11:30",
        note: "Ca kiểm thử",
      },
    ],
  });
  assert.ifError(first.error);

  const overlap = await staff.supabase.rpc("register_staff_shifts", {
    shifts_payload: [
      {
        staff_id: staff.user.id,
        shift_date: "2030-08-23",
        shift_slot: "MORNING",
        start_time: "07:30",
        end_time: "10:30",
      },
    ],
  });
  assert.ok(overlap.error);

  const cancelled = await staff.supabase.rpc("cancel_staff_shift", {
    target_shift_id: first.data[0].id,
  });
  assert.ifError(cancelled.error);
});

test("hai batch import đồng thời không tạo cùng normalized hash", async () => {
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const batchIds = [crypto.randomUUID(), crypto.randomUUID()];
  const scheduleDate = "2046-08-07";
  const hash = importScheduleHash({
    courseCode: "NUR 101",
    roomId: "20000000-0000-0000-0000-000000000001",
    date: scheduleDate,
    start: "07:30",
    end: "09:30",
  });
  const createdScheduleIds = [];

  try {
    for (const [index, id] of batchIds.entries()) {
      const { error } = await admin.supabase.from("import_batches").insert({
        id,
        source_type: "import",
        original_file_name: `concurrent-${index}.csv`,
        file_hash: crypto.randomUUID(),
        status: "importing",
        total_rows: 1,
        created_by: admin.user.id,
        room_type_id: "40000000-0000-0000-0000-000000000001",
      });
      assert.ifError(error);
    }

    const createRow = (batchId, rowNumber) =>
      admin.supabase.rpc("create_import_schedule_row", {
        target_batch_id: batchId,
        target_row_number: rowNumber,
        target_hash: hash,
        target_raw: {},
        target_normalized: { hash },
        target_status: "imported",
        target_errors: [],
        target_warnings: [],
        target_course_id: "10000000-0000-0000-0000-000000000001",
        target_course_code: "NUR 101",
        target_course_name: "Thăm khám thể chất",
        target_room_id: "20000000-0000-0000-0000-000000000001",
        target_lecturer_id: null,
        target_date: scheduleDate,
        target_start: "07:30",
        target_end: "09:30",
        target_note: null,
        target_student_count: 20,
        target_semester: "HK1",
      });

    const results = await Promise.all([
      createRow(batchIds[0], 2),
      createRow(batchIds[1], 2),
    ]);
    createdScheduleIds.push(
      ...results.filter(({ data }) => data).map(({ data }) => data),
    );
    assert.equal(results.filter(({ error }) => !error).length, 1);
    const rejected = results.find(({ error }) => error);
    assert.equal(rejected.error.code, "23505");

    const { count, error } = await admin.supabase
      .from("import_rows")
      .select("id", { count: "exact", head: true })
      .eq("normalized_row_hash", hash)
      .not("class_schedule_id", "is", null);
    assert.ifError(error);
    assert.equal(count, 1);
  } finally {
    if (createdScheduleIds.length > 0) {
      await serviceClient()
        .from("class_schedules")
        .delete()
        .in("id", createdScheduleIds);
    }
    await admin.supabase.from("import_batches").delete().in("id", batchIds);
  }
});

test("tạo lịch thủ công xếp đúng một email cho mỗi Staff hoặc Admin", async () => {
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const { data: createdSchedule, error: insertError } =
    await admin.supabase.rpc("create_manual_class_schedule", {
      target_course_id: "10000000-0000-0000-0000-000000000001",
      target_room_id: "20000000-0000-0000-0000-000000000002",
      target_lecturer_id: null,
      target_lecturer_2_id: null,
      target_schedule_date: "2049-08-20",
      target_start_time: "07:30",
      target_end_time: "11:30",
      target_note: null,
      target_student_count: 20,
      target_semester: "HK1",
    });
  assert.ifError(insertError);
  const scheduleId = createdSchedule.id;

  try {
    await serviceClient().rpc("process_email_outbox_events", {
      batch_size: 50,
    });
    const { data: queued, error: queueError } = await serviceClient()
      .from("email_notifications")
      .select("recipient_id, dedupe_key, payload")
      .eq("notification_type", "class_schedule_created")
      .contains("payload", { schedule_id: scheduleId });
    assert.ifError(queueError);
    const scheduleEmails = (queued ?? []).filter(({ payload }) => {
      const p = typeof payload === "string" ? JSON.parse(payload) : payload;
      return p?.schedule_id === scheduleId;
    });
    assert.ok(scheduleEmails.length >= 1, "Must generate email notifications");
    assert.equal(
      new Set(scheduleEmails.map(({ recipient_id }) => recipient_id)).size,
      scheduleEmails.length,
      "Recipients must be unique",
    );
    assert.equal(
      new Set(scheduleEmails.map(({ dedupe_key }) => dedupe_key)).size,
      scheduleEmails.length,
      "Dedupe keys must be unique",
    );
  } finally {
    await serviceClient().from("class_schedules").delete().eq("id", scheduleId);
  }
});

test("các thay đổi nghiệp vụ quan trọng được ghi audit", async () => {
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const { data: logs, error } = await admin.supabase
    .from("audit_logs")
    .select("action, actor_id")
    .in("action", [
      "class_schedule.lecturer_changed",
      "staff_shift.created",
      "staff_shift.status_changed",
    ]);

  assert.ifError(error);
  assert.ok(
    logs.some(
      ({ action, actor_id }) =>
        action === "class_schedule.lecturer_changed" && actor_id,
    ),
  );
  assert.ok(
    logs.some(
      ({ action, actor_id }) => action === "staff_shift.created" && actor_id,
    ),
  );
  assert.ok(
    logs.some(
      ({ action, actor_id }) =>
        action === "staff_shift.status_changed" && actor_id,
    ),
  );
});

test("staff xem được lịch sử import cùng phạm vi và importer xem phiên của mình", async () => {
  const importer = await signIn("importer@campus.local", "LocalImporter123!");
  const staff = await signIn("staff@campus.local", "LocalStaff123!");
  const batchId = crypto.randomUUID();

  const { error: insertError } = await importer.supabase
    .from("import_batches")
    .insert({
      id: batchId,
      source_type: "import",
      original_file_name: "rls-test.csv",
      file_hash: crypto.randomUUID(),
      status: "uploaded",
      created_by: importer.user.id,
    });
  assert.ifError(insertError);

  const { data: visibleToStaff, error: readError } = await staff.supabase
    .from("import_batches")
    .select("id")
    .eq("id", batchId);
  assert.ifError(readError);
  assert.equal(visibleToStaff.length, 1);

  const { data: visible } = await importer.supabase
    .from("import_batches")
    .select("id")
    .eq("id", batchId)
    .single();
  assert.equal(visible.id, batchId);
});

test("người dùng thường chỉ đọc hồ sơ của mình và dùng danh bạ an toàn", async () => {
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");

  const { data: profiles, error: profileError } = await lecturer.supabase
    .from("profiles")
    .select("id, email, full_name");
  assert.ifError(profileError);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].id, lecturer.user.id);

  const { data: people, error: directoryError } =
    await lecturer.supabase.rpc("list_active_people");
  assert.ifError(directoryError);
  assert.ok(people.length >= 4);
  assert.deepEqual(Object.keys(people[0]).sort(), ["full_name", "id", "title"]);
});

test("database chặn lịch vượt giờ hoạt động", async () => {
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const { error } = await serviceClient().from("class_schedules").insert({
    id: crypto.randomUUID(),
    course_id: "10000000-0000-0000-0000-000000000001",
    course_code_snapshot: "NUR 101",
    course_name_snapshot: "Thăm khám thể chất",
    room_id: "20000000-0000-0000-0000-000000000001",
    schedule_date: "2031-09-01",
    start_time: "11:00",
    end_time: "13:00",
    source: "manual",
    schedule_status: "published",
    created_by: admin.user.id,
    published_by: admin.user.id,
    published_at: new Date().toISOString(),
  });
  assert.ok(error);
  assert.equal(error.code, "23514");
});

test("giảng viên được tạo lớp Skills lab mới trong loại phòng của mình", async () => {
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const scheduleId = crypto.randomUUID();

  const { error } = await serviceClient().from("class_schedules").insert({
    id: scheduleId,
    course_id: "10000000-0000-0000-0000-000000000001",
    course_code_snapshot: "NUR 101",
    course_name_snapshot: "Thăm khám thể chất",
    room_id: "20000000-0000-0000-0000-000000000001",
    schedule_date: "2034-09-07",
    start_time: "07:30",
    end_time: "09:30",
    source: "manual",
    schedule_status: "published",
    student_count: 20,
    created_by: lecturer.user.id,
    published_by: lecturer.user.id,
    published_at: new Date().toISOString(),
    lecturer_id: lecturer.user.id,
  });
  assert.ifError(error);

  const { error: cleanupError } = await serviceClient()
    .from("class_schedules")
    .delete()
    .eq("id", scheduleId);
  assert.ifError(cleanupError);
});

test("chỉ Admin hoặc Staff được chuyển trạng thái phiếu thiết bị", async () => {
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const staff = await signIn("staff@campus.local", "LocalStaff123!");
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const scheduleId = crypto.randomUUID();
  const requestId = crypto.randomUUID();

  const { error: scheduleError } = await serviceClient()
    .from("class_schedules")
    .insert({
      id: scheduleId,
      course_id: "10000000-0000-0000-0000-000000000001",
      course_code_snapshot: "NUR 101",
      course_name_snapshot: "Thăm khám thể chất",
      room_id: "20000000-0000-0000-0000-000000000001",
      schedule_date: "2034-09-08",
      start_time: "07:30",
      end_time: "09:30",
      source: "manual",
      schedule_status: "published",
      student_count: 20,
      semester: "HK1",
      created_by: admin.user.id,
      published_by: admin.user.id,
      published_at: new Date().toISOString(),
      lecturer_id: lecturer.user.id,
    });
  assert.ifError(scheduleError);

  const { error: invalidTimeError } = await serviceClient()
    .from("equipment_requests")
    .insert({
      id: crypto.randomUUID(),
      class_schedule_id: scheduleId,
      registrant_id: admin.user.id,
      responsible_lecturer_id: lecturer.user.id,
      phone_snapshot: "0901000001",
      email_snapshot: "admin@campus.local",
      receive_at: "2034-09-08T03:00:00.000Z",
      return_at: "2034-09-08T04:00:00.000Z",
      status: "new",
      created_by: admin.user.id,
    });
  assert.ok(invalidTimeError);
  assert.equal(invalidTimeError.code, "22023");

  const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const { error: pastReceiveError } = await serviceClient()
    .from("equipment_requests")
    .insert({
      id: crypto.randomUUID(),
      class_schedule_id: scheduleId,
      registrant_id: admin.user.id,
      responsible_lecturer_id: lecturer.user.id,
      phone_snapshot: "0901000001",
      email_snapshot: "admin@campus.local",
      receive_at: `${pastDate}T02:00:00.000Z`,
      return_at: `${pastDate}T04:00:00.000Z`,
      status: "new",
      created_by: admin.user.id,
    });
  assert.ok(pastReceiveError);
  assert.equal(pastReceiveError.code, "22023");

  const { error: afterClassError } = await serviceClient()
    .from("equipment_requests")
    .insert({
      id: crypto.randomUUID(),
      class_schedule_id: scheduleId,
      registrant_id: admin.user.id,
      responsible_lecturer_id: lecturer.user.id,
      phone_snapshot: "0901000001",
      email_snapshot: "admin@campus.local",
      receive_at: "2034-09-09T02:00:00.000Z",
      return_at: "2034-09-09T04:00:00.000Z",
      status: "new",
      created_by: admin.user.id,
    });
  assert.ok(afterClassError);
  assert.equal(afterClassError.code, "22023");

  const { error: requestError } = await serviceClient()
    .from("equipment_requests")
    .insert({
      id: requestId,
      class_schedule_id: scheduleId,
      semester: "HK1",
      registrant_id: admin.user.id,
      responsible_lecturer_id: lecturer.user.id,
      phone_snapshot: "0901000001",
      email_snapshot: "admin@campus.local",
      receive_at: "2034-09-08T02:00:00.000Z",
      return_at: "2034-09-08T04:00:00.000Z",
      status: "new",
      created_by: admin.user.id,
    });
  assert.ifError(requestError);

  const { data: lecturerUpdate, error: lecturerUpdateError } =
    await lecturer.supabase
      .from("equipment_requests")
      .update({ status: "preparing" })
      .eq("id", requestId)
      .select("id");
  assert.equal(lecturerUpdateError?.code, "42501");
  assert.equal(lecturerUpdate, null);
  await legacyStageFixture(requestId, "preparing");

  const { data: staffUpdate, error: staffUpdateError } =
    await staff.supabase.rpc("manager_confirm_equipment_status", {
      target_request_id: requestId,
      target_status: "handed_over",
    });
  assert.ifError(staffUpdateError);
  assert.equal(staffUpdate.status, "preparing");

  const { error: adminContentEditError } = await admin.supabase
    .from("equipment_requests")
    .update({ note: "Vẫn được sửa khi Đã soạn" })
    .eq("id", requestId);
  assert.equal(adminContentEditError?.code, "42501");

  const { data: nextStatus, error: nextStatusError } = await admin.supabase.rpc(
    "manager_confirm_equipment_status",
    { target_request_id: requestId, target_status: "handed_over" },
  );
  assert.ifError(nextStatusError);
  assert.equal(nextStatus.status, "preparing");
  assert.equal(nextStatus.handover_staff_confirmed_by, admin.user.id);

  const { error: itemError } = await cleanupLegacyRequest(requestId);
  assert.ifError(itemError);
  const { error: reqError } = await cleanupLegacyRequest(requestId);
  assert.ifError(reqError);

  const { error: scheduleCleanupError } = await serviceClient()
    .from("class_schedules")
    .delete()
    .eq("id", scheduleId);
  assert.ifError(scheduleCleanupError);
});

test("người đăng ký được điều chỉnh nội dung nhưng không được tự đổi trạng thái phiếu", async () => {
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const firstScheduleId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const catalogItemId = crypto.randomUUID();

  for (const [id, date, sem] of [[firstScheduleId, "2035-09-09", "HK1"]]) {
    const { error } = await serviceClient().from("class_schedules").insert({
      id,
      course_id: "10000000-0000-0000-0000-000000000001",
      course_code_snapshot: "NUR 101",
      course_name_snapshot: "Thăm khám thể chất",
      room_id: "20000000-0000-0000-0000-000000000001",
      schedule_date: date,
      start_time: "07:30",
      end_time: "09:30",
      source: "manual",
      schedule_status: "published",
      student_count: 20,
      semester: sem,
      created_by: lecturer.user.id,
      published_by: lecturer.user.id,
      published_at: new Date().toISOString(),
      lecturer_id: lecturer.user.id,
    });
    assert.ifError(error);
  }

  const { data: catalogItem, error: catalogError } = await admin.supabase
    .from("equipment_catalog")
    .insert({
      id: catalogItemId,
      item_name: `Thiết bị test ${catalogItemId}`,
      commercial_name: `Thiết bị test ${catalogItemId}`,
      unit: "Cái",
    })
    .select("id")
    .single();
  assert.ifError(catalogError);

  const { error: requestError } = await legacyRequestFixture({
    id: requestId,
    class_schedule_id: firstScheduleId,
    semester: "HK1",
    registrant_id: lecturer.user.id,
    responsible_lecturer_id: lecturer.user.id,
    phone_snapshot: "0901000004",
    email_snapshot: "giangvien@campus.local",
    receive_at: "2035-09-09T02:00:00.000Z",
    return_at: "2035-09-09T04:00:00.000Z",
    status: "new",
    created_by: lecturer.user.id,
  });
  assert.ifError(requestError);

  const { error: initialItemError } = await legacyItemFixture({
    request_id: requestId,
    skill_name: "Kỹ năng cũ",
    catalog_item_id: catalogItem.id,
    quantity: 1,
  });
  assert.ifError(initialItemError);
  const savedLine = await lecturer.supabase
    .from("equipment_request_items")
    .select("id")
    .eq("request_id", requestId)
    .single();
  assert.ifError(savedLine.error);

  const { error: statusError } = await lecturer.supabase
    .from("equipment_requests")
    .update({ status: "completed" })
    .eq("id", requestId);
  assert.ok(statusError);
  assert.equal(statusError.code, "42501");

  const { data: updatedId, error: updateError } = await lecturer.supabase.rpc(
    "update_equipment_request_content",
    {
      target_request_id: requestId,
      target_class_schedule_id: firstScheduleId,
      target_semester: "HK1",
      target_responsible_lecturer_id: lecturer.user.id,
      target_receive_at: "2035-09-09T02:00:00.000Z",
      target_return_at: "2035-09-09T04:00:00.000Z",
      target_note: "Nội dung đã điều chỉnh",
      target_items: await equipmentUpdateItems(lecturer.supabase, requestId, [
        {
          id: savedLine.data.id,
          skill_name: "Kỹ năng mới",
          catalog_item_id: catalogItem.id,
          quantity: 2,
          note: "Ghi chú mới",
        },
      ]),
    },
  );
  assert.ifError(updateError);
  assert.equal(updatedId, requestId);

  const { data: updatedRequest, error: readError } = await admin.supabase
    .from("equipment_requests")
    .select(
      "id,class_schedule_id,semester,status,note,equipment_request_items(skill_name,quantity,note)",
    )
    .eq("id", requestId)
    .single();
  assert.ifError(readError);
  assert.equal(updatedRequest.id, requestId);
  assert.equal(updatedRequest.class_schedule_id, firstScheduleId);
  assert.equal(updatedRequest.semester, "HK1");
  assert.equal(updatedRequest.status, "new");
  assert.equal(updatedRequest.note, "Nội dung đã điều chỉnh");
  assert.deepEqual(updatedRequest.equipment_request_items, [
    { skill_name: "Kỹ năng mới", quantity: 2, note: "Ghi chú mới" },
  ]);

  const { error: preparingError } = await admin.supabase.rpc(
    "manager_confirm_equipment_status",
    { target_request_id: requestId, target_status: "preparing" },
  );
  assert.match(preparingError.message, /S4_CONFIRM_PREPARATION_REQUIRED/);
  await legacyStageFixture(requestId, "preparing");

  const { error: warehouseHandoverError } = await admin.supabase.rpc(
    "manager_confirm_equipment_status",
    { target_request_id: requestId, target_status: "handed_over" },
  );
  assert.ifError(warehouseHandoverError);
  const { error: recipientHandoverError } = await lecturer.supabase.rpc(
    "registrant_confirm_equipment_handoff",
    {
      target_request_id: requestId,
      target_phase: "handover",
      target_signature:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    },
  );
  assert.ifError(recipientHandoverError);

  const { error: lockedRpcError } = await lecturer.supabase.rpc(
    "update_equipment_request_content",
    {
      target_request_id: requestId,
      target_class_schedule_id: firstScheduleId,
      target_semester: "HK1",
      target_responsible_lecturer_id: lecturer.user.id,
      target_receive_at: "2035-09-09T02:00:00.000Z",
      target_return_at: "2035-09-09T04:00:00.000Z",
      target_note: "Không được cập nhật",
      target_items: await equipmentUpdateItems(lecturer.supabase, requestId, [
        {
          id: savedLine.data.id,
          skill_name: "Kỹ năng bị khóa",
          catalog_item_id: catalogItem.id,
          quantity: 1,
          note: "Không được lưu",
        },
      ]),
    },
  );
  assert.ok(lockedRpcError);
  assert.equal(lockedRpcError.code, "42501");

  const { error: lockedItemError } = await lecturer.supabase
    .from("equipment_request_items")
    .insert({
      request_id: requestId,
      skill_name: "Kỹ năng bị khóa",
      catalog_item_id: catalogItem.id,
      quantity: 1,
    });
  assert.ok(lockedItemError);
  assert.equal(lockedItemError.code, "42501");

  const { error: itemError } = await cleanupLegacyRequest(requestId);
  assert.ifError(itemError);
  const { error: reqError } = await cleanupLegacyRequest(requestId);
  assert.ifError(reqError);

  for (const id of [firstScheduleId]) {
    const { error } = await serviceClient()
      .from("class_schedules")
      .delete()
      .eq("id", id);
    assert.ifError(error);
  }
  await admin.supabase
    .from("equipment_catalog")
    .delete()
    .eq("id", catalogItemId);
});

test("TA preserves historical Skills responsible lecturer but cannot assign a new ineligible lecturer", async () => {
  const service = serviceClient();
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const ta = await signIn("trogiang@campus.local", "LocalAssistant123!");

  const historicalLecturer = await createPersonnelFixture(
    service,
    "Historical Lecturer",
  );
  const freshIneligibleLecturer = await createPersonnelFixture(
    service,
    "Fresh Ineligible Lecturer",
  );

  const skillsRoomTypeId = "40000000-0000-0000-0000-000000000001";
  const scheduleId = crypto.randomUUID();
  const catalogItemId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  let originalRootAdminId = null;
  let rootWasReassigned = false;

  try {
    await configurePersonnelFixture(
      admin,
      service,
      historicalLecturer.id,
      ["lecturer"],
      [skillsRoomTypeId],
    );
    await configurePersonnelFixture(
      admin,
      service,
      freshIneligibleLecturer.id,
      ["lecturer"],
      [skillsRoomTypeId],
    );

    const { error: scheduleError } = await service
      .from("class_schedules")
      .insert({
        id: scheduleId,
        course_id: "10000000-0000-0000-0000-000000000001",
        course_code_snapshot: "NUR 101",
        course_name_snapshot: "Kỹ năng điều dưỡng",
        room_id: "20000000-0000-0000-0000-000000000001",
        schedule_date: "2036-04-10",
        start_time: "08:00",
        end_time: "11:00",
        source: "manual",
        schedule_status: "published",
        student_count: 25,
        semester: "HK1",
        created_by: ta.user.id,
        published_by: admin.user.id,
        published_at: new Date().toISOString(),
        lecturer_id: historicalLecturer.id,
      });
    assert.ifError(scheduleError);

    const { error: catalogError } = await admin.supabase
      .from("equipment_catalog")
      .insert({
        id: catalogItemId,
        item_name: `Thiết bị lịch sử ${catalogItemId}`,
        commercial_name: `Thiết bị lịch sử ${catalogItemId}`,
        unit: "Bộ",
      });
    assert.ifError(catalogError);

    const { error: requestError } = await legacyRequestFixture({
      id: requestId,
      class_schedule_id: scheduleId,
      semester: "HK1",
      registrant_id: ta.user.id,
      responsible_lecturer_id: historicalLecturer.id,
      phone_snapshot: "0901234567",
      email_snapshot: "trogiang@campus.local",
      receive_at: "2036-04-10T02:00:00.000Z",
      return_at: "2036-04-10T04:00:00.000Z",
      status: "new",
      created_by: ta.user.id,
      note: "Ghi chú ban đầu",
    });
    assert.ifError(requestError);

    const { error: itemError } = await legacyItemFixture({
      request_id: requestId,
      skill_name: "Kỹ năng thực hành",
      catalog_item_id: catalogItemId,
      quantity: 1,
    });
    assert.ifError(itemError);

    const basicMedicalRoomTypeId = "40000000-0000-0000-0000-000000000002";
    await configurePersonnelFixture(
      admin,
      service,
      historicalLecturer.id,
      ["lecturer"],
      [basicMedicalRoomTypeId],
    );
    await configurePersonnelFixture(
      admin,
      service,
      freshIneligibleLecturer.id,
      ["lecturer"],
      [basicMedicalRoomTypeId],
    );

    const { data: scopedLecturers, error: scopedError } = await ta.supabase.rpc(
      "list_scoped_lecturers",
      { target_room_type_id: skillsRoomTypeId },
    );
    assert.ifError(scopedError);
    assert.equal(
      (scopedLecturers ?? []).some((l) => l.id === historicalLecturer.id),
      false,
    );
    assert.equal(
      (scopedLecturers ?? []).some((l) => l.id === freshIneligibleLecturer.id),
      false,
    );

    const savedLine = await ta.supabase
      .from("equipment_request_items")
      .select("id")
      .eq("request_id", requestId)
      .single();
    assert.ifError(savedLine.error);
    const { data: updatedId, error: updateError } = await ta.supabase.rpc(
      "update_equipment_request_content",
      {
        target_request_id: requestId,
        target_class_schedule_id: scheduleId,
        target_semester: "HK1",
        target_responsible_lecturer_id: historicalLecturer.id,
        target_receive_at: "2036-04-10T02:00:00.000Z",
        target_return_at: "2036-04-10T04:00:00.000Z",
        target_note: "Ghi chú đã cập nhật bảo lưu giảng viên cũ",
        target_late_registration_reason: null,
        target_items: await equipmentUpdateItems(ta.supabase, requestId, [
          {
            id: savedLine.data.id,
            skill_name: "Kỹ năng thực hành cập nhật",
            catalog_item_id: catalogItemId,
            quantity: 2,
            note: "Đã cập nhật số lượng",
          },
        ]),
      },
    );
    assert.ifError(updateError);
    assert.equal(updatedId, requestId);

    const { data: verifiedRow, error: verifyError } = await admin.supabase
      .from("equipment_requests")
      .select("id,responsible_lecturer_id,note")
      .eq("id", requestId)
      .single();
    assert.ifError(verifyError);
    assert.equal(verifiedRow.responsible_lecturer_id, historicalLecturer.id);
    assert.equal(verifiedRow.note, "Ghi chú đã cập nhật bảo lưu giảng viên cũ");

    const { error: ineligibleError } = await ta.supabase.rpc(
      "update_equipment_request_content",
      {
        target_request_id: requestId,
        target_class_schedule_id: scheduleId,
        target_semester: "HK1",
        target_responsible_lecturer_id: freshIneligibleLecturer.id,
        target_receive_at: "2036-04-10T02:00:00.000Z",
        target_return_at: "2036-04-10T04:00:00.000Z",
        target_note: "Cố tình gán giảng viên không đủ điều kiện mới",
        target_late_registration_reason: null,
        target_items: await equipmentUpdateItems(ta.supabase, requestId, [
          {
            id: savedLine.data.id,
            skill_name: "Kỹ năng",
            catalog_item_id: catalogItemId,
            quantity: 2,
          },
        ]),
      },
    );
    assert.equal(
      ineligibleError?.message,
      "Giảng viên phụ trách không hợp lệ.",
    );

    const { data: principalRow, error: principalReadError } = await service
      .from("system_security_principals")
      .select("root_admin_id")
      .eq("singleton", true)
      .single();
    assert.ifError(principalReadError);
    originalRootAdminId = principalRow.root_admin_id;

    const { error: addHistoricalAdminError } = await service
      .from("user_roles")
      .insert({
        user_id: historicalLecturer.id,
        role: "admin",
        created_by: admin.user.id,
      });
    assert.ifError(addHistoricalAdminError);

    const { error: setRootError } = await service
      .from("system_security_principals")
      .update({ root_admin_id: historicalLecturer.id })
      .eq("singleton", true);
    assert.ifError(setRootError);
    rootWasReassigned = true;

    const { error: rootPreserveError } = await ta.supabase.rpc(
      "update_equipment_request_content",
      {
        target_request_id: requestId,
        target_class_schedule_id: scheduleId,
        target_semester: "HK1",
        target_responsible_lecturer_id: historicalLecturer.id,
        target_receive_at: "2036-04-10T02:00:00.000Z",
        target_return_at: "2036-04-10T04:00:00.000Z",
        target_note: "Cố tình bảo lưu giảng viên nay đã là Root",
        target_late_registration_reason: null,
        target_items: await equipmentUpdateItems(ta.supabase, requestId, [
          {
            id: savedLine.data.id,
            skill_name: "Kỹ năng",
            catalog_item_id: catalogItemId,
            quantity: 2,
          },
        ]),
      },
    );
    assert.ok(rootPreserveError);
    assert.equal(rootPreserveError.code, "42501");
    assert.match(
      rootPreserveError.message ?? "",
      /ROOT_ADMIN_OPERATIONAL_ASSIGNMENT_FORBIDDEN/,
    );
  } finally {
    if (rootWasReassigned && originalRootAdminId) {
      const { error: restoreRootError } = await service
        .from("system_security_principals")
        .update({ root_admin_id: originalRootAdminId })
        .eq("singleton", true);

      assert.ifError(restoreRootError);
      rootWasReassigned = false;
    }
    const { error: deleteItemsError } = await cleanupLegacyRequest(requestId);
    assert.ifError(deleteItemsError);

    const { error: deleteRequestError } = await cleanupLegacyRequest(requestId);
    assert.ifError(deleteRequestError);

    const { error: deleteScheduleError } = await service
      .from("class_schedules")
      .delete()
      .eq("id", scheduleId);
    assert.ifError(deleteScheduleError);

    const { error: deleteCatalogError } = await admin.supabase
      .from("equipment_catalog")
      .delete()
      .eq("id", catalogItemId);
    assert.ifError(deleteCatalogError);

    const [historicalDelete, freshIneligibleDelete] = await Promise.all([
      service.auth.admin.deleteUser(historicalLecturer.id),
      service.auth.admin.deleteUser(freshIneligibleLecturer.id),
    ]);
    assert.ifError(historicalDelete.error);
    assert.ifError(freshIneligibleDelete.error);
  }
});

test("mỗi dòng import hợp lệ tạo lịch và bản ghi kiểm tra trong một RPC", async () => {
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const importer = await signIn("importer@campus.local", "LocalImporter123!");
  const batchId = crypto.randomUUID();
  const hash = importScheduleHash({
    courseCode: "PHA 110",
    roomId: "20000000-0000-0000-0000-000000000003",
    date: "2031-09-02",
    start: "12:30",
    end: "16:30",
  });

  const { error: batchError } = await importer.supabase
    .from("import_batches")
    .insert({
      id: batchId,
      source_type: "import",
      original_file_name: "atomic-test.csv",
      file_hash: hash,
      status: "importing",
      total_rows: 1,
      room_type_id: "40000000-0000-0000-0000-000000000001",
      created_by: importer.user.id,
    });
  assert.ifError(batchError);

  const { data: scheduleId, error: rpcError } = await importer.supabase.rpc(
    "create_import_schedule_row",
    {
      target_batch_id: batchId,
      target_row_number: 1,
      target_hash: hash,
      target_raw: { course_code: "PHA 110" },
      target_normalized: { schedule_date: "2031-09-02" },
      target_status: "imported",
      target_errors: [],
      target_warnings: [],
      target_course_id: "10000000-0000-0000-0000-000000000003",
      target_course_code: "PHA 110",
      target_course_name: "Dược lý cơ bản",
      target_room_id: "20000000-0000-0000-0000-000000000003",
      target_lecturer_id: null,
      target_date: "2031-09-02",
      target_start: "12:30",
      target_end: "16:30",
      target_note: null,
      target_student_count: 20,
      target_semester: "HK1",
    },
  );
  assert.ifError(rpcError);
  assert.ok(scheduleId);

  const { data: importedRow, error: rowError } = await importer.supabase
    .from("import_rows")
    .select("class_schedule_id, validation_status")
    .eq("import_batch_id", batchId)
    .single();
  assert.ifError(rowError);
  assert.equal(importedRow.class_schedule_id, scheduleId);
  assert.equal(importedRow.validation_status, "imported");

  const { data: importedSchedule, error: scheduleError } = await admin.supabase
    .from("class_schedules")
    .select("schedule_status")
    .eq("id", scheduleId)
    .single();
  assert.ifError(scheduleError);
  assert.equal(importedSchedule.schedule_status, "published");

  const { error: finishError } = await importer.supabase.rpc(
    "finalize_import_batch",
    { target_batch_id: batchId },
  );
  assert.ifError(finishError);
  await serviceClient().rpc("process_email_outbox_events", { batch_size: 50 });

  const { data: summaries, error: summaryError } = await serviceClient()
    .from("email_notifications")
    .select("recipient_id, payload")
    .eq("notification_type", "class_schedule_import_summary");
  assert.ifError(summaryError);
  const batchSummaries = (summaries ?? []).filter(({ payload }) => {
    const p = typeof payload === "string" ? JSON.parse(payload) : payload;
    return p?.batch_id === batchId;
  });
  // Importer (created_by) always receives an email; additional recipients
  // depend on room-type staff/admin assignments in the seed.
  assert.ok(
    batchSummaries.length >= 1,
    `Expected at least 1 import summary email, got ${batchSummaries.length}`,
  );
  const importerEmail = batchSummaries.find(
    ({ recipient_id }) => recipient_id === importer.user.id,
  );
  assert.ok(importerEmail, "Importer must receive an import summary email");
  assert.ok(
    batchSummaries.every(({ payload }) => payload.schedules.length === 1),
  );

  await serviceClient().from("class_schedules").delete().eq("id", scheduleId);
  await admin.supabase.from("import_batches").delete().eq("id", batchId);
});

test("direct RPC không cho Staff đổi lớp từ loại phòng ngoài scope sang scope của mình", async () => {
  const service = serviceClient();
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const staff = await signIn("staff@campus.local", "LocalStaff123!");
  const importer = await signIn("importer@campus.local", "LocalImporter123!");
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const roomId = crypto.randomUUID();
  const scheduleId = crypto.randomUUID();
  try {
    await configurePersonnelFixture(
      admin,
      service,
      staff.user.id,
      ["staff"],
      ["40000000-0000-0000-0000-000000000001"],
    );
    const { error: roomError } = await admin.supabase.from("rooms").insert({
      id: roomId,
      room_code: `YC-${roomId.slice(0, 6)}`,
      building_code: "B08",
      room_name: "Y cơ sở kiểm thử",
      room_type: "Y cơ sở",
      room_type_id: "40000000-0000-0000-0000-000000000002",
      capacity: 30,
    });
    assert.ifError(roomError);
    const { error: scheduleError } = await serviceClient()
      .from("class_schedules")
      .insert({
        id: scheduleId,
        course_id: "10000000-0000-0000-0000-000000000001",
        course_code_snapshot: "NUR 101",
        course_name_snapshot: "Thăm khám thể chất",
        room_id: roomId,
        schedule_date: "2048-08-10",
        start_time: "07:30",
        end_time: "09:30",
        source: "manual",
        schedule_status: "published",
        student_count: 20,
        created_by: admin.user.id,
        published_by: admin.user.id,
        published_at: new Date().toISOString(),
      });
    assert.ifError(scheduleError);

    const denied = await staff.supabase.rpc("update_class_schedule_details", {
      target_schedule_id: scheduleId,
      target_schedule_date: "2048-08-10",
      target_start_time: "07:30",
      target_end_time: "09:30",
      target_room_id: "20000000-0000-0000-0000-000000000001",
      target_student_count: 20,
      target_lecturer_ids: [],
    });
    assert.ok(denied.error);
    assert.equal(denied.error.code, "42501");

    const allowed = await admin.supabase.rpc("update_class_schedule_details", {
      target_schedule_id: scheduleId,
      target_schedule_date: "2048-08-10",
      target_start_time: "07:30",
      target_end_time: "09:30",
      target_room_id: "20000000-0000-0000-0000-000000000001",
      target_student_count: 20,
      target_lecturer_ids: [],
    });
    assert.ifError(allowed.error);

    const importerCannotEditOthers = await importer.supabase.rpc(
      "update_class_schedule_details",
      {
        target_schedule_id: scheduleId,
        target_schedule_date: "2048-08-11",
        target_start_time: "07:30",
        target_end_time: "09:30",
        target_room_id: "20000000-0000-0000-0000-000000000001",
        target_student_count: 20,
        target_lecturer_ids: [],
      },
    );
    assert.ok(importerCannotEditOthers.error);
    assert.equal(importerCannotEditOthers.error.code, "42501");

    const invalidLecturer = await admin.supabase.rpc(
      "update_class_schedule_details",
      {
        target_schedule_id: scheduleId,
        target_schedule_date: "2048-08-10",
        target_start_time: "07:30",
        target_end_time: "09:30",
        target_room_id: "20000000-0000-0000-0000-000000000001",
        target_student_count: 20,
        target_lecturer_ids: [staff.user.id],
      },
    );
    assert.ok(invalidLecturer.error);
    assert.equal(invalidLecturer.error.code, "42501");

    assert.ifError(
      (
        await service
          .from("profiles")
          .update({ is_active: false })
          .eq("id", lecturer.user.id)
      ).error,
    );
    const inactiveLecturer = await admin.supabase.rpc(
      "update_class_schedule_details",
      {
        target_schedule_id: scheduleId,
        target_schedule_date: "2048-08-10",
        target_start_time: "07:30",
        target_end_time: "09:30",
        target_room_id: "20000000-0000-0000-0000-000000000001",
        target_student_count: 20,
        target_lecturer_ids: [lecturer.user.id],
      },
    );
    assert.ok(inactiveLecturer.error);
    assert.equal(inactiveLecturer.error.code, "42501");
  } finally {
    await service
      .from("profiles")
      .update({ is_active: true })
      .eq("id", lecturer.user.id);
    await serviceClient().from("class_schedules").delete().eq("id", scheduleId);
    await admin.supabase.from("rooms").delete().eq("id", roomId);
  }
});

test("email giữ snapshot Test khi setting đổi sang Live", async () => {
  const service = serviceClient();
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const id = crypto.randomUUID();
  try {
    assert.ifError(
      (
        await service
          .from("email_delivery_settings")
          .update({ delivery_mode: "test" })
          .eq("setting_key", "primary")
      ).error,
    );
    assert.ifError(
      (
        await service.from("email_notifications").insert({
          id,
          notification_type: "safe_review_mode_snapshot",
          recipient_id: admin.user.id,
          recipient_email: "original@example.com",
          dedupe_key: `mode-snapshot:${id}`,
          subject: "Mode snapshot",
          payload: {},
        })
      ).error,
    );
    assert.ifError(
      (
        await service
          .from("email_delivery_settings")
          .update({ delivery_mode: "live" })
          .eq("setting_key", "primary")
      ).error,
    );
    const { data, error } = await service
      .from("email_notifications")
      .select("status,delivery_mode_at_enqueue")
      .eq("id", id)
      .single();
    assert.ifError(error);
    assert.equal(data.status, "pending");
    assert.equal(data.delivery_mode_at_enqueue, "test");
  } finally {
    await service.from("email_notifications").delete().eq("id", id);
    await service
      .from("email_delivery_settings")
      .update({ delivery_mode: "off" })
      .eq("setting_key", "primary");
  }
});

test("email giữ snapshot Live khi setting đổi sang Test và suppress khi tạo ở Off", async () => {
  const service = serviceClient();
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const liveId = crypto.randomUUID();
  const offId = crypto.randomUUID();
  try {
    assert.ifError(
      (
        await service
          .from("email_delivery_settings")
          .update({ delivery_mode: "live" })
          .eq("setting_key", "primary")
      ).error,
    );
    assert.ifError(
      (
        await service.from("email_notifications").insert({
          id: liveId,
          notification_type: "safe_review_mode_snapshot_live",
          recipient_id: admin.user.id,
          recipient_email: "original@example.com",
          dedupe_key: `mode-snapshot-live:${liveId}`,
          subject: "Mode snapshot Live",
          payload: {},
        })
      ).error,
    );
    assert.ifError(
      (
        await service
          .from("email_delivery_settings")
          .update({ delivery_mode: "test" })
          .eq("setting_key", "primary")
      ).error,
    );
    const liveRow = await service
      .from("email_notifications")
      .select("status,delivery_mode_at_enqueue")
      .eq("id", liveId)
      .single();
    assert.ifError(liveRow.error);
    assert.equal(liveRow.data.status, "pending");
    assert.equal(liveRow.data.delivery_mode_at_enqueue, "live");

    assert.ifError(
      (
        await service
          .from("email_delivery_settings")
          .update({ delivery_mode: "off" })
          .eq("setting_key", "primary")
      ).error,
    );
    assert.ifError(
      (
        await service.from("email_notifications").insert({
          id: offId,
          notification_type: "safe_review_mode_snapshot_off",
          recipient_id: admin.user.id,
          recipient_email: "original@example.com",
          dedupe_key: `mode-snapshot-off:${offId}`,
          subject: "Mode snapshot Off",
          payload: {},
        })
      ).error,
    );
    const offRow = await service
      .from("email_notifications")
      .select("status,delivery_mode_at_enqueue")
      .eq("id", offId)
      .single();
    assert.ifError(offRow.error);
    assert.equal(offRow.data.status, "suppressed");
    assert.equal(offRow.data.delivery_mode_at_enqueue, "off");
  } finally {
    await service
      .from("email_notifications")
      .delete()
      .in("id", [liveId, offId]);
    await service
      .from("email_delivery_settings")
      .update({ delivery_mode: "live" })
      .eq("setting_key", "primary");
  }
});

test("direct equipment RPC luôn xác minh giảng viên phụ trách và độ dài nội dung", async () => {
  const service = serviceClient();
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const staff = await signIn("staff@campus.local", "LocalStaff123!");
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const { data: staffProfile, error: staffProfileError } = await service
    .from("profiles")
    .select("phone")
    .eq("id", staff.user.id)
    .single();
  assert.ifError(staffProfileError);
  assert.ok(staffProfile);
  const scheduleId = crypto.randomUUID();
  const catalogId = crypto.randomUUID();
  try {
    assert.ifError(
      (
        await service
          .from("profiles")
          .update({ phone: "0901234567" })
          .eq("id", staff.user.id)
      ).error,
    );
    assert.ifError(
      (
        await serviceClient().from("class_schedules").insert({
          id: scheduleId,
          course_id: "10000000-0000-0000-0000-000000000001",
          course_code_snapshot: "NUR 101",
          course_name_snapshot: "Thăm khám thể chất",
          room_id: "20000000-0000-0000-0000-000000000001",
          schedule_date: "2049-08-10",
          start_time: "07:30",
          end_time: "09:30",
          source: "manual",
          schedule_status: "published",
          student_count: 20,
          semester: "HK1",
          created_by: admin.user.id,
          published_by: admin.user.id,
          published_at: new Date().toISOString(),
        })
      ).error,
    );
    assert.ifError(
      (
        await admin.supabase.from("equipment_catalog").insert({
          id: catalogId,
          item_name: `Thiết bị ${catalogId}`,
          commercial_name: `Thương mại ${catalogId}`,
          unit: "Cái",
        })
      ).error,
    );
    const base = {
      target_class_schedule_id: scheduleId,
      target_semester: "HK1",
      target_receive_at: "2049-08-10T02:00:00.000Z",
      target_return_at: "2049-08-10T04:00:00.000Z",
      target_late_registration_reason: null,
      target_items: [
        {
          skill_name: "Kỹ năng",
          catalog_item_id: catalogId,
          quantity: 1,
          note: null,
        },
      ],
    };
    const selfAsResponsible = await staff.supabase.rpc(
      "create_equipment_request_with_items",
      {
        ...base,
        target_responsible_lecturer_id: staff.user.id,
        target_note: null,
      },
    );
    assert.ok(selfAsResponsible.error);
    assert.equal(selfAsResponsible.error.code, "42501");

    const oversizedNote = await staff.supabase.rpc(
      "create_equipment_request_with_items",
      {
        ...base,
        target_responsible_lecturer_id: lecturer.user.id,
        target_note: "x".repeat(2001),
      },
    );
    assert.ok(oversizedNote.error);
    assert.equal(oversizedNote.error.code, "22023");
  } finally {
    await service
      .from("profiles")
      .update({ phone: staffProfile.phone })
      .eq("id", staff.user.id);
    // Use serviceClient() since DELETE privilege is revoked from authenticated role
    await serviceClient()
      .from("equipment_requests")
      .delete()
      .eq("class_schedule_id", scheduleId);
    await serviceClient().from("class_schedules").delete().eq("id", scheduleId);
    await admin.supabase.from("equipment_catalog").delete().eq("id", catalogId);
  }
});

test("direct import RPC từ chối hash giả do caller gửi", async () => {
  const importer = await signIn("importer@campus.local", "LocalImporter123!");
  const batchId = crypto.randomUUID();
  try {
    assert.ifError(
      (
        await importer.supabase.from("import_batches").insert({
          id: batchId,
          source_type: "import",
          original_file_name: "forged-hash.csv",
          file_hash: crypto.randomUUID(),
          status: "importing",
          total_rows: 1,
          created_by: importer.user.id,
          room_type_id: "40000000-0000-0000-0000-000000000001",
        })
      ).error,
    );
    const result = await importer.supabase.rpc("create_import_schedule_row", {
      target_batch_id: batchId,
      target_row_number: 1,
      target_hash: crypto.randomUUID(),
      target_raw: {},
      target_normalized: {},
      target_status: "imported",
      target_errors: [],
      target_warnings: [],
      target_course_id: "10000000-0000-0000-0000-000000000001",
      target_course_code: "NUR 101",
      target_course_name: "Thăm khám thể chất",
      target_room_id: "20000000-0000-0000-0000-000000000001",
      target_lecturer_id: null,
      target_date: "2049-09-01",
      target_start: "07:30",
      target_end: "09:30",
      target_note: null,
      target_student_count: 20,
      target_semester: "HK1",
    });
    assert.ok(result.error);
    assert.equal(result.error.code, "22023");
    assert.match(result.error.message, /INVALID_IMPORT_HASH/);
  } finally {
    await importer.supabase.from("import_batches").delete().eq("id", batchId);
  }
});

test("hash của lịch import đã hủy không chặn lần import sau", async () => {
  const service = serviceClient();
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const importer = await signIn("importer@campus.local", "LocalImporter123!");
  const batchId = crypto.randomUUID();
  const target = {
    courseCode: "NUR 101",
    roomId: "20000000-0000-0000-0000-000000000001",
    date: "2049-09-02",
    start: "07:30",
    end: "09:30",
  };
  const hash = importScheduleHash(target);
  let scheduleId = null;
  try {
    assert.ifError(
      (
        await importer.supabase.from("import_batches").insert({
          id: batchId,
          source_type: "import",
          original_file_name: "cancelled-row.csv",
          file_hash: crypto.randomUUID(),
          status: "importing",
          total_rows: 1,
          created_by: importer.user.id,
          room_type_id: "40000000-0000-0000-0000-000000000001",
        })
      ).error,
    );
    const created = await importer.supabase.rpc("create_import_schedule_row", {
      target_batch_id: batchId,
      target_row_number: 1,
      target_hash: hash,
      target_raw: {},
      target_normalized: {},
      target_status: "imported",
      target_errors: [],
      target_warnings: [],
      target_course_id: "10000000-0000-0000-0000-000000000001",
      target_course_code: target.courseCode,
      target_course_name: "Thăm khám thể chất",
      target_room_id: target.roomId,
      target_lecturer_id: null,
      target_date: target.date,
      target_start: target.start,
      target_end: target.end,
      target_note: null,
      target_student_count: 20,
      target_semester: "HK1",
    });
    assert.ifError(created.error);
    scheduleId = created.data;

    const active = await importer.supabase.rpc("find_existing_import_hashes", {
      target_hashes: [hash],
      target_room_type_id: "40000000-0000-0000-0000-000000000001",
    });
    assert.ifError(active.error);
    assert.equal(active.data.length, 1);

    assert.ifError(
      (
        await admin.supabase
          .from("class_schedules")
          .update({
            schedule_status: "cancelled",
            cancelled_by: admin.user.id,
            cancelled_at: new Date().toISOString(),
          })
          .eq("id", scheduleId)
      ).error,
    );
    const cancelled = await importer.supabase.rpc(
      "find_existing_import_hashes",
      {
        target_hashes: [hash],
        target_room_type_id: "40000000-0000-0000-0000-000000000001",
      },
    );
    assert.ifError(cancelled.error);
    assert.equal(cancelled.data.length, 0);
  } finally {
    if (scheduleId) {
      await service
        .from("import_rows")
        .delete()
        .eq("class_schedule_id", scheduleId);
      await service
        .from("class_schedules")
        .update({
          schedule_status: "published",
          cancelled_by: null,
          cancelled_at: null,
        })
        .eq("id", scheduleId);
      await serviceClient()
        .from("class_schedules")
        .delete()
        .eq("id", scheduleId);
    }
    await service.from("import_batches").delete().eq("id", batchId);
  }
});

test("RLS giới hạn Y cơ sở, số sinh viên bắt buộc và đổi ngày chặn trùng phòng", async () => {
  const service = serviceClient();
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const staff = await signIn("staff@campus.local", "LocalStaff123!");
  const roomId = crypto.randomUUID();
  const roomCode = `YT${roomId.slice(0, 6)}`;
  const firstId = crypto.randomUUID();
  const secondId = crypto.randomUUID();
  const yScope = "40000000-0000-0000-0000-000000000002";

  await configurePersonnelFixture(
    admin,
    service,
    staff.user.id,
    ["staff"],
    ["40000000-0000-0000-0000-000000000001"],
  );

  assert.ifError(
    (
      await admin.supabase.from("rooms").insert({
        id: roomId,
        room_code: roomCode,
        building_code: "YC",
        room_type_id: yScope,
      })
    ).error,
  );

  const common = {
    course_id: "10000000-0000-0000-0000-000000000001",
    course_code_snapshot: "NUR 101",
    course_name_snapshot: "Thăm khám thể chất",
    room_id: roomId,
    start_time: "07:30",
    end_time: "11:30",
    source: "manual",
    schedule_status: "published",
    created_by: admin.user.id,
    published_by: admin.user.id,
    published_at: new Date().toISOString(),
  };
  assert.ifError(
    (
      await serviceClient()
        .from("class_schedules")
        .insert([
          {
            ...common,
            id: firstId,
            schedule_date: "2034-08-20",
            student_count: 25,
          },
          {
            ...common,
            id: secondId,
            schedule_date: "2034-08-21",
            student_count: 30,
          },
        ])
    ).error,
  );

  const { data: hidden } = await staff.supabase
    .from("class_schedules")
    .select("id")
    .in("id", [firstId, secondId]);
  assert.equal(hidden.length, 0);

  await configurePersonnelFixture(
    admin,
    service,
    staff.user.id,
    ["staff"],
    ["40000000-0000-0000-0000-000000000001", yScope],
  );
  const { data: visible } = await staff.supabase
    .from("class_schedules")
    .select("id, student_count")
    .in("id", [firstId, secondId]);
  assert.equal(visible.length, 2);
  assert.deepEqual(
    visible.map(({ student_count }) => student_count).sort((a, b) => a - b),
    [25, 30],
  );

  const conflict = await staff.supabase.rpc("reschedule_class", {
    target_schedule_id: firstId,
    target_schedule_date: "2034-08-21",
  });
  assert.ok(conflict.error);

  await serviceClient()
    .from("class_schedules")
    .delete()
    .in("id", [firstId, secondId]);
  await admin.supabase.from("rooms").delete().eq("id", roomId);
  await configurePersonnelFixture(
    admin,
    service,
    staff.user.id,
    ["staff"],
    ["40000000-0000-0000-0000-000000000001"],
  );
});

test("Admin xóa được danh mục khi chỉ còn lịch hoặc ca đã hủy", async () => {
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const { data: operationalStaff, error: operationalStaffError } =
    await serviceClient()
      .from("profiles")
      .select("id")
      .eq("email", "staff@campus.local")
      .single();
  assert.ifError(operationalStaffError);
  assert.ok(operationalStaff);
  const roomId = crypto.randomUUID();
  const courseId = crypto.randomUUID();
  const courseRoomId = crypto.randomUUID();
  const activeScheduleId = crypto.randomUUID();
  const cancelledCourseScheduleId = crypto.randomUUID();
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const cancelledAt = new Date().toISOString();

  try {
    assert.ifError(
      (
        await admin.supabase.from("courses").insert({
          id: courseId,
          course_code: `DEL-${suffix}`,
          course_name: "Môn kiểm thử xóa danh mục",
        })
      ).error,
    );
    assert.ifError(
      (
        await admin.supabase.from("rooms").insert([
          {
            id: roomId,
            room_code: `DEL-${suffix}`,
            building_code: "QA",
            room_type_id: "40000000-0000-0000-0000-000000000001",
          },
          {
            id: courseRoomId,
            room_code: `COURSE-${suffix}`,
            building_code: "QA",
            room_type_id: "40000000-0000-0000-0000-000000000001",
          },
        ])
      ).error,
    );

    const scheduleBase = {
      course_id: courseId,
      course_code_snapshot: `DEL-${suffix}`,
      course_name_snapshot: "Môn kiểm thử xóa danh mục",
      start_time: "07:30",
      end_time: "11:30",
      source: "manual",
      student_count: 10,
      created_by: admin.user.id,
    };
    assert.ifError(
      (
        await serviceClient()
          .from("class_schedules")
          .insert([
            {
              ...scheduleBase,
              id: activeScheduleId,
              room_id: roomId,
              schedule_date: "2042-08-20",
              schedule_status: "published",
              published_by: admin.user.id,
              published_at: cancelledAt,
            },
            {
              ...scheduleBase,
              id: cancelledCourseScheduleId,
              room_id: courseRoomId,
              schedule_date: "2042-08-21",
              schedule_status: "published",
              published_by: admin.user.id,
              published_at: cancelledAt,
            },
          ])
      ).error,
    );
    assert.ifError(
      (
        await admin.supabase
          .from("class_schedules")
          .update({
            schedule_status: "cancelled",
            cancelled_by: admin.user.id,
            cancelled_at: cancelledAt,
          })
          .eq("id", cancelledCourseScheduleId)
      ).error,
    );

    const blockedRoom = await admin.supabase.rpc("delete_catalog_room", {
      target_room_id: roomId,
    });
    assert.ok(blockedRoom.error);
    assert.match(blockedRoom.error.message, /CATALOG_HAS_ACTIVE_SCHEDULES/);

    assert.ifError(
      (
        await admin.supabase
          .from("class_schedules")
          .update({
            schedule_status: "cancelled",
            cancelled_by: admin.user.id,
            cancelled_at: cancelledAt,
          })
          .eq("id", activeScheduleId)
      ).error,
    );
    assert.ifError(
      (
        await admin.supabase.rpc("delete_catalog_room", {
          target_room_id: roomId,
        })
      ).error,
    );

    assert.ifError(
      (
        await admin.supabase.rpc("delete_catalog_course", {
          target_course_id: courseId,
        })
      ).error,
    );

    for (const [table, id] of [
      ["rooms", roomId],
      ["courses", courseId],
    ]) {
      const { data, error } = await admin.supabase
        .from(table)
        .select("id")
        .eq("id", id)
        .maybeSingle();
      assert.ifError(error);
      assert.equal(data, null);
    }
  } finally {
    await serviceClient()
      .from("class_schedules")
      .delete()
      .in("id", [activeScheduleId, cancelledCourseScheduleId]);
    await admin.supabase.from("courses").delete().eq("id", courseId);
    await admin.supabase
      .from("rooms")
      .delete()
      .in("id", [roomId, courseRoomId]);
  }
});

test("Admin và Staff xóa phiếu thiết bị, phiếu Y cơ sở chỉ hủy qua RPC", async () => {
  const service = serviceClient();
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const staff = await signIn("staff@campus.local", "LocalStaff123!");
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const equipmentScheduleId = crypto.randomUUID();
  const equipmentRequestId = crypto.randomUUID();
  const equipmentItemId = crypto.randomUUID();
  const equipmentCatalogItemId = crypto.randomUUID();
  const equipmentRoomId = crypto.randomUUID();
  let registrationId = null;
  const basicRoomId = crypto.randomUUID();
  const basicCourseId = crypto.randomUUID();
  let addedBasicMedicalScope = false;
  let addedLecturerBasicMedicalScope = false;

  try {
    const { data: existingBasicMedicalScope, error: scopeReadError } =
      await admin.supabase
        .from("profile_room_types")
        .select("profile_id")
        .eq("profile_id", admin.user.id)
        .eq("room_type_id", "40000000-0000-0000-0000-000000000002")
        .maybeSingle();
    assert.ifError(scopeReadError);
    if (!existingBasicMedicalScope) {
      const { error: scopeInsertError } = await service
        .from("profile_room_types")
        .insert({
          profile_id: admin.user.id,
          room_type_id: "40000000-0000-0000-0000-000000000002",
          created_by: admin.user.id,
        });
      assert.ifError(scopeInsertError);
      addedBasicMedicalScope = true;
    }
    const { data: lecturerBasicMedicalScope, error: lecturerScopeReadError } =
      await admin.supabase
        .from("profile_room_types")
        .select("profile_id")
        .eq("profile_id", lecturer.user.id)
        .eq("room_type_id", "40000000-0000-0000-0000-000000000002")
        .maybeSingle();
    assert.ifError(lecturerScopeReadError);
    if (!lecturerBasicMedicalScope) {
      const { error: lecturerScopeInsertError } = await service
        .from("profile_room_types")
        .insert({
          profile_id: lecturer.user.id,
          room_type_id: "40000000-0000-0000-0000-000000000002",
          created_by: admin.user.id,
        });
      assert.ifError(lecturerScopeInsertError);
      addedLecturerBasicMedicalScope = true;
    }

    const { data: catalogItem, error: catalogError } = await admin.supabase
      .from("equipment_catalog")
      .insert({
        id: equipmentCatalogItemId,
        item_name: `Thiết bị xóa ${equipmentCatalogItemId}`,
        commercial_name: `Thiết bị xóa ${equipmentCatalogItemId}`,
        unit: "Cái",
      })
      .select("id")
      .single();
    assert.ifError(catalogError);

    // This scenario deliberately preserves cancelled history. Give each run
    // its own room so retained schedules cannot collide on the next run.
    assert.ifError(
      (
        await admin.supabase.from("rooms").insert({
          id: equipmentRoomId,
          room_code: `SK-${equipmentRoomId.slice(0, 8)}`,
          building_code: "YT",
          room_type_id: "40000000-0000-0000-0000-000000000001",
        })
      ).error,
    );
    assert.ifError(
      (
        await serviceClient().from("class_schedules").insert({
          id: equipmentScheduleId,
          course_id: "10000000-0000-0000-0000-000000000001",
          course_code_snapshot: "NUR 101",
          course_name_snapshot: "Thăm khám thể chất",
          room_id: equipmentRoomId,
          schedule_date: "2043-08-20",
          start_time: "07:30",
          end_time: "11:30",
          source: "manual",
          schedule_status: "published",
          student_count: 20,
          semester: "HK1",
          created_by: admin.user.id,
          published_by: admin.user.id,
          published_at: new Date().toISOString(),
        })
      ).error,
    );
    assert.ifError(
      (
        await legacyRequestFixture({
          id: equipmentRequestId,
          class_schedule_id: equipmentScheduleId,
          semester: "HK1",
          registrant_id: admin.user.id,
          responsible_lecturer_id: lecturer.user.id,
          phone_snapshot: "0901000001",
          email_snapshot: "admin@campus.local",
          receive_at: "2043-08-20T02:00:00.000Z",
          return_at: "2043-08-20T04:00:00.000Z",
          status: "new",
          created_by: admin.user.id,
        })
      ).error,
    );
    assert.ifError(
      (
        await legacyItemFixture({
          id: equipmentItemId,
          request_id: equipmentRequestId,
          skill_name: "Kiểm thử xóa phiếu",
          catalog_item_id: catalogItem.id,
          quantity: 1,
        })
      ).error,
    );

    // Direct DELETE is now privilege-denied for all authenticated roles
    const lecturerDelete = await lecturer.supabase
      .from("equipment_requests")
      .delete()
      .eq("id", equipmentRequestId)
      .select("id");
    assert.equal(lecturerDelete.error?.code, "42501");

    // Admin/Staff must use soft_cancel_equipment_request RPC instead of direct delete
    const equipmentStaffCancel = await staff.supabase.rpc(
      "soft_cancel_equipment_request",
      { target_request_id: equipmentRequestId },
    );
    assert.ifError(equipmentStaffCancel.error);

    // After soft cancel the request remains in the table (not deleted)
    const { data: cancelledItems, error: cancelledItemsError } =
      await admin.supabase
        .from("equipment_requests")
        .select("status")
        .eq("id", equipmentRequestId)
        .single();
    assert.ifError(cancelledItemsError);
    assert.equal(cancelledItems.status, "cancelled");

    // Items remain attached (not cascade-deleted by soft cancel)
    const { data: survivingItems, error: survivingItemsError } =
      await admin.supabase
        .from("equipment_request_items")
        .select("id")
        .eq("id", equipmentItemId);
    assert.ifError(survivingItemsError);
    // Items survive soft cancel (physical delete only happens via hard_delete RPC)
    assert.equal(survivingItems.length, 1);
    const { data: keptEquipmentSchedule, error: keptScheduleError } =
      await admin.supabase
        .from("class_schedules")
        .select("id")
        .eq("id", equipmentScheduleId)
        .single();
    assert.ifError(keptScheduleError);
    assert.equal(keptEquipmentSchedule.id, equipmentScheduleId);

    assert.ifError(
      (
        await admin.supabase.from("courses").insert({
          id: basicCourseId,
          course_code: `YCS-${basicCourseId.slice(0, 8)}`,
          course_name: "Môn học Y cơ sở kiểm thử",
          room_type_id: "40000000-0000-0000-0000-000000000002",
        })
      ).error,
    );
    assert.ifError(
      (
        await admin.supabase.from("rooms").insert({
          id: basicRoomId,
          room_code: `Y-${basicRoomId.slice(0, 8)}`,
          building_code: "YT",
          room_type_id: "40000000-0000-0000-0000-000000000002",
        })
      ).error,
    );
    const createdRegistration = await admin.supabase.rpc(
      "save_basic_medical_registration",
      {
        target_registration_id: null,
        target_academic_year: "2043-2044",
        target_semester: "HK1",
        target_start_date: "2043-08-21",
        target_end_date: "2043-08-21",
        target_course_id: basicCourseId,
        target_room_id: basicRoomId,
        target_student_count: 20,
        target_responsible_lecturer_id: lecturer.user.id,
        target_note: "Kiểm thử hủy phiếu Y cơ sở",
        target_sessions: [
          {
            schedule_date: "2043-08-21",
            start_time: "07:30",
            end_time: "11:30",
            lesson_title: "Kiểm thử xóa phiếu Y cơ sở",
            teaching_lecturer_id: lecturer.user.id,
          },
        ],
      },
    );
    assert.ifError(createdRegistration.error);
    assert.equal(typeof createdRegistration.data, "string");
    registrationId = createdRegistration.data;
    const directDelete = await admin.supabase
      .from("basic_medical_registrations")
      .delete()
      .eq("id", registrationId)
      .select("id");
    assert.ok(directDelete.error);

    const staffCancel = await staff.supabase.rpc(
      "cancel_basic_medical_registration",
      {
        target_registration_id: registrationId,
        target_reason: "Staff cancel test",
      },
    );
    assert.ok(staffCancel.error);
    assert.match(staffCancel.error.message, /BASIC_MEDICAL_MANAGER_REQUIRED/);

    const adminCancel = await admin.supabase.rpc(
      "cancel_basic_medical_registration",
      {
        target_registration_id: registrationId,
        target_reason: "Admin cancel test",
      },
    );
    assert.ifError(adminCancel.error);

    const { data: outboxEvents } = await serviceClient()
      .from("email_outbox_events")
      .select("event_type,event_key")
      .eq("domain", "basic_medical_registration")
      .in("event_type", ["created", "cancelled"]);
    assert.ok(
      outboxEvents?.some(
        (e) =>
          e.event_type === "created" && e.event_key.includes(registrationId),
      ),
      "Expected created outbox event for registrationId",
    );
    assert.ok(
      outboxEvents?.some(
        (e) =>
          e.event_type === "cancelled" && e.event_key.includes(registrationId),
      ),
      "Expected cancelled outbox event for registrationId",
    );

    const [
      { data: cancelledRegistration },
      { data: keptSession },
      { data: cancelledSchedule },
    ] = await Promise.all([
      admin.supabase
        .from("basic_medical_registrations")
        .select("cancelled_at,cancel_reason")
        .eq("id", registrationId)
        .single(),
      admin.supabase
        .from("basic_medical_registration_sessions")
        .select("id,class_schedule_id")
        .eq("registration_id", registrationId)
        .single(),
      admin.supabase
        .from("class_schedules")
        .select("schedule_status")
        .eq("basic_medical_registration_id", registrationId)
        .single(),
    ]);
    assert.ok(cancelledRegistration.cancelled_at);
    assert.equal(cancelledRegistration.cancel_reason, "Admin cancel test");
    assert.equal(typeof keptSession.id, "string");
    assert.equal(typeof keptSession.class_schedule_id, "string");
    assert.equal(cancelledSchedule.schedule_status, "cancelled");
  } finally {
    await serviceClient()
      .from("equipment_request_items")
      .delete()
      .eq("id", equipmentItemId);
    await serviceClient()
      .from("equipment_requests")
      .delete()
      .eq("id", equipmentRequestId);
    if (registrationId) {
      await service
        .from("basic_medical_registration_sessions")
        .delete()
        .eq("registration_id", registrationId);
      await serviceClient()
        .from("class_schedules")
        .delete()
        .eq("basic_medical_registration_id", registrationId);
      await service
        .from("basic_medical_registrations")
        .delete()
        .eq("id", registrationId);
    }
    await serviceClient()
      .from("class_schedules")
      .delete()
      .eq("id", equipmentScheduleId);
    await admin.supabase
      .from("equipment_catalog")
      .delete()
      .eq("id", equipmentCatalogItemId);
    await admin.supabase.from("courses").delete().eq("id", basicCourseId);
    await admin.supabase.from("rooms").delete().eq("id", basicRoomId);
    if (addedBasicMedicalScope) {
      await service
        .from("profile_room_types")
        .delete()
        .eq("profile_id", admin.user.id)
        .eq("room_type_id", "40000000-0000-0000-0000-000000000002");
    }
    if (addedLecturerBasicMedicalScope) {
      await service
        .from("profile_room_types")
        .delete()
        .eq("profile_id", lecturer.user.id)
        .eq("room_type_id", "40000000-0000-0000-0000-000000000002");
    }
  }
});

test("Phiếu thiết bị chỉ cho ký giao sau khi kho xác nhận và GV phụ trách có thể ký", async () => {
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const staff = await signIn("staff@campus.local", "LocalStaff123!");
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");
  const roomId = crypto.randomUUID();
  const scheduleId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const invalidRequestId = crypto.randomUUID();
  const catalogItemId = crypto.randomUUID();
  const supplementalCatalogItemId = crypto.randomUUID();
  const postHandoverCatalogItemId = crypto.randomUUID();
  const signature =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

  try {
    assert.ifError(
      (
        await admin.supabase.from("rooms").insert({
          id: roomId,
          room_code: `WF-${crypto.randomUUID().slice(0, 8)}`,
          building_code: "QA",
          room_type_id: "40000000-0000-0000-0000-000000000001",
        })
      ).error,
    );
    assert.ifError(
      (
        await serviceClient().from("class_schedules").insert({
          id: scheduleId,
          course_id: null,
          course_code_snapshot: "WF 101",
          course_name_snapshot: "Kiểm thử luồng phiếu thiết bị",
          room_id: roomId,
          schedule_date: "2045-08-20",
          start_time: "07:30",
          end_time: "11:30",
          source: "manual",
          schedule_status: "published",
          student_count: 20,
          semester: "HK1",
          created_by: admin.user.id,
          published_by: admin.user.id,
          published_at: new Date().toISOString(),
        })
      ).error,
    );
    assert.ifError(
      (
        await admin.supabase.from("equipment_catalog").insert({
          id: catalogItemId,
          item_name: `Thiết bị workflow ${catalogItemId.slice(0, 8)}`,
          commercial_name: `Workflow QA ${catalogItemId}`,
          unit: "Cái",
        })
      ).error,
    );
    assert.ifError(
      (
        await admin.supabase.from("equipment_catalog").insert([
          {
            id: supplementalCatalogItemId,
            item_name: `Thiết bị bổ sung workflow ${supplementalCatalogItemId.slice(0, 8)}`,
            commercial_name: `Workflow supplemental ${supplementalCatalogItemId}`,
            unit: "Cái",
          },
          {
            id: postHandoverCatalogItemId,
            item_name: `Thiết bị sau giao workflow ${postHandoverCatalogItemId.slice(0, 8)}`,
            commercial_name: `Workflow post-handover ${postHandoverCatalogItemId}`,
            unit: "Cái",
          },
        ])
      ).error,
    );
    assert.ifError(
      (
        await legacyRequestFixture({
          id: requestId,
          class_schedule_id: scheduleId,
          semester: "HK1",
          registrant_id: admin.user.id,
          responsible_lecturer_id: lecturer.user.id,
          phone_snapshot: "0901000001",
          email_snapshot: "admin@campus.local",
          receive_at: "2045-08-19T02:00:00.000Z",
          return_at: "2045-08-20T09:00:00.000Z",
          status: "new",
          created_by: admin.user.id,
        })
      ).error,
    );

    const invalidTiming = await serviceClient()
      .from("equipment_requests")
      .insert({
        id: invalidRequestId,
        class_schedule_id: scheduleId,
        semester: "HK1",
        registrant_id: admin.user.id,
        responsible_lecturer_id: lecturer.user.id,
        phone_snapshot: "0901000001",
        email_snapshot: "admin@campus.local",
        receive_at: "2045-08-18T02:00:00.000Z",
        return_at: "2045-08-19T09:00:00.000Z",
        status: "new",
        created_by: admin.user.id,
      });
    assert.ok(invalidTiming.error);
    assert.match(invalidTiming.error.message, /Ngày trả.*ngày học/i);

    const lecturerTooEarly = await lecturer.supabase.rpc(
      "registrant_confirm_equipment_handoff",
      {
        target_request_id: requestId,
        target_phase: "handover",
        target_signature: signature,
      },
    );
    assert.ok(lecturerTooEarly.error);
    assert.match(lecturerTooEarly.error.message, /Kho.*Đã giao/i);

    const staffTooEarly = await staff.supabase.rpc(
      "manager_confirm_equipment_status",
      { target_request_id: requestId, target_status: "handed_over" },
    );
    assert.ok(staffTooEarly.error);
    assert.match(staffTooEarly.error.message, /Đã soạn/i);

    const adminEarly = await admin.supabase.rpc(
      "manager_confirm_equipment_status",
      { target_request_id: requestId, target_status: "handed_over" },
    );
    assert.ok(adminEarly.error);
    assert.match(adminEarly.error.message, /Đã soạn/i);

    const preparing = await admin.supabase.rpc(
      "manager_confirm_equipment_status",
      { target_request_id: requestId, target_status: "preparing" },
    );
    assert.match(preparing.error.message, /S4_CONFIRM_PREPARATION_REQUIRED/);
    await legacyItemFixture({
      request_id: requestId,
      skill_name: "Kỹ năng workflow",
      catalog_item_id: catalogItemId,
      quantity: 1,
    });
    await legacyStageFixture(requestId, "preparing");
    const adminHandover = await admin.supabase.rpc(
      "manager_confirm_equipment_status",
      { target_request_id: requestId, target_status: "handed_over" },
    );
    assert.ifError(adminHandover.error);
    assert.ok(adminHandover.data.handover_staff_confirmed_at);

    const responsibleEarlySign = await lecturer.supabase.rpc(
      "registrant_confirm_equipment_handoff",
      {
        target_request_id: requestId,
        target_phase: "handover",
        target_signature: signature,
      },
    );
    assert.ifError(responsibleEarlySign.error);
    assert.equal(responsibleEarlySign.data.status, "handed_over");

    assert.ifError(
      (
        await admin.supabase.rpc("manager_confirm_equipment_status", {
          target_request_id: requestId,
          target_status: "new",
        })
      ).error,
    );
    assert.match(
      (
        await staff.supabase.rpc("manager_confirm_equipment_status", {
          target_request_id: requestId,
          target_status: "preparing",
        })
      ).error.message,
      /S4_CONFIRM_PREPARATION_REQUIRED/,
    );
    await legacyStageFixture(requestId, "preparing");

    const editWhilePreparing = await admin.supabase.rpc(
      "update_equipment_request_content",
      {
        target_request_id: requestId,
        target_class_schedule_id: scheduleId,
        target_semester: "HK2",
        target_responsible_lecturer_id: lecturer.user.id,
        target_receive_at: "2045-08-19T02:00:00.000Z",
        target_return_at: "2045-08-20T09:00:00.000Z",
        target_note: "Điều chỉnh khi Đã soạn",
        target_items: await equipmentUpdateItems(admin.supabase, requestId, [
          {
            skill_name: "Kỹ năng workflow",
            catalog_item_id: catalogItemId,
            quantity: 1,
            note: null,
          },
        ]),
      },
    );
    assert.match(
      editWhilePreparing.error.message,
      /S4_USE_QUANTITY_ADJUSTMENT/,
    );
    assert.equal(editWhilePreparing.data, null);

    const managerAddsWhilePreparing = await staff.supabase
      .from("equipment_request_items")
      .insert({
        request_id: requestId,
        skill_name: "Kỹ năng workflow",
        catalog_item_id: supplementalCatalogItemId,
        quantity: 2,
        note: "Bổ sung trước khi giao",
      });
    assert.equal(managerAddsWhilePreparing.error?.code, "42501");

    const responsibleSignsBeforeWarehouse = await lecturer.supabase.rpc(
      "registrant_confirm_equipment_handoff",
      {
        target_request_id: requestId,
        target_phase: "handover",
        target_signature: signature,
      },
    );
    assert.ok(responsibleSignsBeforeWarehouse.error);
    assert.match(
      responsibleSignsBeforeWarehouse.error.message,
      /Kho.*Đã giao/i,
    );

    const staffConfirmsHandover = await staff.supabase.rpc(
      "manager_confirm_equipment_status",
      { target_request_id: requestId, target_status: "handed_over" },
    );
    assert.ifError(staffConfirmsHandover.error);
    assert.equal(staffConfirmsHandover.data.status, "preparing");
    assert.ok(staffConfirmsHandover.data.handover_staff_confirmed_at);

    const responsibleSignsHandover = await lecturer.supabase.rpc(
      "registrant_confirm_equipment_handoff",
      {
        target_request_id: requestId,
        target_phase: "handover",
        target_signature: signature,
      },
    );
    assert.ifError(responsibleSignsHandover.error);
    assert.equal(responsibleSignsHandover.data.status, "handed_over");

    const managerAddsAfterHandover = await staff.supabase
      .from("equipment_request_items")
      .insert({
        request_id: requestId,
        skill_name: "Kỹ năng workflow",
        catalog_item_id: postHandoverCatalogItemId,
        quantity: 1,
      });
    assert.ok(managerAddsAfterHandover.error);

    const responsibleSignsReturn = await lecturer.supabase.rpc(
      "registrant_confirm_equipment_handoff",
      {
        target_request_id: requestId,
        target_phase: "return",
        target_signature: signature,
      },
    );
    assert.ifError(responsibleSignsReturn.error);
    assert.equal(responsibleSignsReturn.data.status, "handed_over");

    const staffConfirmsReturn = await staff.supabase.rpc(
      "manager_confirm_equipment_status",
      { target_request_id: requestId, target_status: "returned" },
    );
    assert.ifError(staffConfirmsReturn.error);
    assert.equal(staffConfirmsReturn.data.status, "completed");

    const adminRollsBackToHandover = await admin.supabase.rpc(
      "manager_confirm_equipment_status",
      { target_request_id: requestId, target_status: "handed_over" },
    );
    assert.ifError(adminRollsBackToHandover.error);
    assert.equal(adminRollsBackToHandover.data.status, "handed_over");
    assert.ok(adminRollsBackToHandover.data.handover_recipient_signed_at);
    assert.equal(adminRollsBackToHandover.data.return_staff_confirmed_at, null);
    assert.equal(
      adminRollsBackToHandover.data.return_recipient_signed_at,
      null,
    );

    const staffConfirmsReturnFirst = await staff.supabase.rpc(
      "manager_confirm_equipment_status",
      { target_request_id: requestId, target_status: "returned" },
    );
    assert.ifError(staffConfirmsReturnFirst.error);
    assert.equal(staffConfirmsReturnFirst.data.status, "handed_over");
    assert.ok(staffConfirmsReturnFirst.data.return_staff_confirmed_at);
    assert.equal(
      staffConfirmsReturnFirst.data.return_recipient_signed_at,
      null,
    );

    const responsibleSignsReturnLast = await lecturer.supabase.rpc(
      "registrant_confirm_equipment_handoff",
      {
        target_request_id: requestId,
        target_phase: "return",
        target_signature: signature,
      },
    );
    assert.ifError(responsibleSignsReturnLast.error);
    assert.equal(responsibleSignsReturnLast.data.status, "completed");
  } finally {
    // Use serviceClient() since DELETE privilege is revoked from authenticated role
    await serviceClient()
      .from("equipment_requests")
      .delete()
      .in("id", [requestId, invalidRequestId]);
    await serviceClient().from("class_schedules").delete().eq("id", scheduleId);
    await admin.supabase.from("rooms").delete().eq("id", roomId);
    await admin.supabase
      .from("equipment_catalog")
      .delete()
      .in("id", [
        catalogItemId,
        supplementalCatalogItemId,
        postHandoverCatalogItemId,
      ]);
  }
});

test("Basic Medical schedule edit (YC-L04) and cancellation (YC-L05) create transactional outbox events", async () => {
  const admin = await signIn("admin@campus.local", "LocalAdmin123!");
  const staff = await signIn("staff@campus.local", "LocalStaff123!");
  const lecturer = await signIn("giangvien@campus.local", "LocalLecturer123!");

  await serviceClient()
    .from("profile_room_types")
    .upsert([
      {
        profile_id: admin.user.id,
        room_type_id: "40000000-0000-0000-0000-000000000002",
      },
      {
        profile_id: lecturer.user.id,
        room_type_id: "40000000-0000-0000-0000-000000000002",
      },
    ]);

  const roomId = crypto.randomUUID();
  const courseId = crypto.randomUUID();
  const scheduleId = crypto.randomUUID();

  try {
    await serviceClient()
      .from("rooms")
      .insert({
        id: roomId,
        room_code: `Y-OUTBOX-${roomId.slice(0, 6)}`,
        building_code: "YT",
        room_type_id: "40000000-0000-0000-0000-000000000002",
      });
    await serviceClient()
      .from("courses")
      .insert({
        id: courseId,
        course_code: `BM-OUTBOX-${courseId.slice(0, 6)}`,
        course_name: "Basic Medical Outbox Course",
        room_type_id: "40000000-0000-0000-0000-000000000002",
      });
    await serviceClient()
      .from("class_schedules")
      .insert({
        id: scheduleId,
        course_id: courseId,
        course_code_snapshot: `BM-OUTBOX-${courseId.slice(0, 6)}`,
        course_name_snapshot: "Basic Medical Outbox Course",
        room_id: roomId,
        lecturer_id: lecturer.user.id,
        schedule_date: "2044-10-10",
        start_time: "08:00",
        end_time: "11:00",
        student_count: 30,
        schedule_status: "published",
        created_by: admin.user.id,
        published_by: admin.user.id,
        published_at: new Date().toISOString(),
      });

    const editRes = await admin.supabase.rpc("update_class_schedule_details", {
      target_schedule_id: scheduleId,
      target_schedule_date: "2044-10-10",
      target_start_time: "08:00",
      target_end_time: "11:30",
      target_room_id: roomId,
      target_student_count: 40,
      target_lecturer_ids: [lecturer.user.id],
    });
    assert.ifError(editRes.error);

    const { data: updateEvents } = await serviceClient()
      .from("email_outbox_events")
      .select("*")
      .eq("aggregate_id", scheduleId)
      .eq("event_type", "schedule_updated");
    assert.equal(updateEvents?.length, 1);
    assert.equal(updateEvents[0].domain, "basic_medical_schedule");

    const staffCancel = await staff.supabase.rpc("cancel_class_schedule", {
      target_schedule_id: scheduleId,
    });
    assert.ok(staffCancel.error);

    const cancelRes = await admin.supabase.rpc("cancel_class_schedule", {
      target_schedule_id: scheduleId,
    });
    assert.ifError(cancelRes.error);

    const { data: cancelEvents } = await serviceClient()
      .from("email_outbox_events")
      .select("*")
      .eq("aggregate_id", scheduleId)
      .eq("event_type", "schedule_cancelled");
    assert.equal(cancelEvents?.length, 1);
    assert.equal(cancelEvents[0].domain, "basic_medical_schedule");
  } finally {
    await serviceClient()
      .from("email_outbox_events")
      .delete()
      .eq("aggregate_id", scheduleId);
    await serviceClient().from("class_schedules").delete().eq("id", scheduleId);
    await serviceClient().from("courses").delete().eq("id", courseId);
    await serviceClient().from("rooms").delete().eq("id", roomId);
  }
});

test("Equipment import profile null-email safety handles null profile email without crashing", async () => {
  const profiles = [
    {
      id: "p1",
      full_name: "Giảng viên Có Email",
      email: "gv.email@campus.local",
      phone: "0901234567",
    },
    {
      id: "p2",
      full_name: "Giảng viên Không Email",
      email: null,
      phone: "0907654321",
    },
    {
      id: "p3",
      full_name: "Giảng viên Email Trắng",
      email: "   ",
      phone: "0908888888",
    },
  ];

  const profileByEmail = new Map();
  for (const profile of profiles) {
    const normalized = profile.email?.trim().toLowerCase();
    if (normalized) {
      profileByEmail.set(normalized, profile);
    }
  }

  assert.equal(profileByEmail.has("null"), false);
  assert.equal(profileByEmail.has("undefined"), false);
  assert.equal(profileByEmail.has(""), false);
  assert.equal(profileByEmail.size, 1);
  assert.equal(profileByEmail.get("gv.email@campus.local")?.id, "p1");

  const profileByName = new Map();
  for (const profile of profiles) {
    const key = profile.full_name.trim().toLowerCase();
    profileByName.set(key, [profile]);
  }

  assert.equal(profileByName.get("giảng viên không email")?.[0]?.id, "p2");
  assert.equal(profileByName.get("giảng viên email trắng")?.[0]?.id, "p3");

  const registrantNoEmail = profileByName.get("giảng viên không email")?.[0];
  const groupErrors = [];

  if (registrantNoEmail && !registrantNoEmail.email?.trim()) {
    groupErrors.push("Người đăng ký chưa có email trong hồ sơ Nhân sự");
  }

  assert.equal(groupErrors.length, 1);
  assert.equal(
    groupErrors[0],
    "Người đăng ký chưa có email trong hồ sơ Nhân sự",
  );

  const registrantEmail = registrantNoEmail?.email?.trim().toLowerCase();
  let responsible = null;
  const firstResponsibleEmail = "gv.email@campus.local";

  assert.doesNotThrow(() => {
    if (
      !responsible &&
      registrantNoEmail &&
      firstResponsibleEmail &&
      registrantEmail &&
      firstResponsibleEmail.trim().toLowerCase() === registrantEmail
    ) {
      responsible = registrantNoEmail;
    }
  });

  assert.equal(responsible, null);
});
