"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertPasswordChangeNotRequired } from "@/lib/forced-password";
import { personnelRoleDisplayNames } from "@/lib/admin-catalog-template";
import {
  assertUniquePersonnelImportIdentities,
  normalizePersonnelPhone,
} from "@/lib/personnel-import";

async function adminContext() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) throw new Error("AUTH_REQUIRED");
  await assertPasswordChangeNotRequired(supabase, userId);

  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!role) throw new Error("ADMIN_REQUIRED");
  return { supabase, userId };
}

async function personnelContext() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) throw new Error("AUTH_REQUIRED");
  await assertPasswordChangeNotRequired(supabase, userId);
  const { data, error } = await supabase.rpc("get_personnel_authority_context");
  const authority = data as {
    configured?: boolean;
    can_manage_personnel?: boolean;
    is_root_administrator?: boolean;
  } | null;
  if (error || !authority?.configured) {
    throw new Error("PERSONNEL_SECURITY_NOT_CONFIGURED");
  }
  if (!authority.can_manage_personnel) {
    throw new Error("PERSONNEL_MANAGER_REQUIRED");
  }
  return { supabase, userId, authority };
}

type CreatedAuthIdentity = { id: string; email: string };

async function cleanupCreatedAuthUsersOrRecordReconciliation({
  adminClient,
  identities,
  actorId,
  failureStage,
}: {
  adminClient: ReturnType<typeof createAdminClient>;
  identities: CreatedAuthIdentity[];
  actorId: string;
  failureStage: string;
}) {
  const failures: Array<
    CreatedAuthIdentity & {
      error: string;
      profileLockError?: string;
      reconciliationError?: string;
    }
  > = [];
  for (const identity of identities) {
    let lastError = "";
    let deleted = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { error } = await adminClient.auth.admin.deleteUser(identity.id);
      if (!error) {
        deleted = true;
        break;
      }
      lastError = error.message;
    }
    if (!deleted) {
      const { error: profileLockError } = await adminClient
        .from("profiles")
        .update({
          is_active: false,
          can_import_schedules: false,
          allow_basic_medical_access: false,
        })
        .eq("id", identity.id);
      const { error: reconciliationError } = await adminClient
        .from("personnel_auth_reconciliation_logs")
        .insert({
          profile_id: identity.id,
          previous_email: identity.email,
          requested_email: identity.email,
          failure_stage: failureStage,
          error_message: lastError || "Auth cleanup failed",
          created_by: actorId,
        });
      failures.push({
        ...identity,
        error: lastError || "Unknown cleanup error",
        profileLockError: profileLockError?.message,
        reconciliationError: reconciliationError?.message,
      });
      console.error("personnel.auth.cleanup.reconciliation_required", {
        correlation_id: `${failureStage}:${identity.id}`,
        profile_id: identity.id,
        auth_delete_error: lastError || "Unknown cleanup error",
        profile_lock_error: profileLockError?.message ?? null,
        reconciliation_insert_error: reconciliationError?.message ?? null,
      });
    }
  }
  return failures;
}

export async function createCourse(formData: FormData) {
  const { supabase } = await adminContext();
  const courseCode = String(formData.get("course_code") ?? "").trim();
  const courseName = String(formData.get("course_name") ?? "").trim();
  const roomTypeId = String(formData.get("room_type_id") ?? "").trim();
  if (!courseCode || !courseName || !roomTypeId) {
    catalogRedirect(
      "/admin/courses",
      "error",
      "Vui lòng nhập mã môn học, tên môn học và Loại.",
    );
  }
  const { data: roomType } = await supabase
    .from("room_types")
    .select("id")
    .eq("id", roomTypeId)
    .eq("is_active", true)
    .maybeSingle();
  if (!roomType) {
    catalogRedirect("/admin/courses", "error", "Loại đã chọn không hợp lệ.");
  }
  const { error } = await supabase.from("courses").insert({
    course_code: courseCode,
    course_name: courseName,
    room_type_id: roomTypeId,
  });
  if (error) {
    catalogRedirect(
      "/admin/courses",
      "error",
      "Mã môn học đã tồn tại hoặc thông tin không hợp lệ.",
    );
  }
  revalidatePath("/admin/courses");
  catalogRedirect("/admin/courses", "notice", "Đã thêm môn học.");
}

export async function setRoomsActive(
  targetIds: string[],
  targetIsActive: boolean,
) {
  const { supabase } = await adminContext();
  const { error } = await supabase.rpc("set_catalog_rooms_active", {
    target_ids: targetIds,
    target_is_active: targetIsActive,
  });
  if (error) throw new Error("CATALOG_UPDATE_FAILED");
  revalidatePath("/admin/rooms");
}

export async function setCoursesActive(
  targetIds: string[],
  targetIsActive: boolean,
) {
  const { supabase } = await adminContext();
  const { error } = await supabase.rpc("set_catalog_courses_active", {
    target_ids: targetIds,
    target_is_active: targetIsActive,
  });
  if (error) throw new Error("CATALOG_UPDATE_FAILED");
  revalidatePath("/admin/courses");
}

function assertRoomCapacityInput(capacity: number | null) {
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
    throw new Error("INVALID_ROOM_CAPACITY");
  }
}

export async function updateCatalogRoom(input: {
  id: string;
  roomCode: string;
  buildingCode: string;
  roomName: string;
  capacity: number | null;
  roomTypeId: string;
}) {
  assertRoomCapacityInput(input.capacity);
  const { supabase } = await adminContext();
  const { error } = await supabase.rpc("update_catalog_room", {
    target_id: input.id,
    target_room_code: input.roomCode,
    target_building_code: input.buildingCode,
    target_room_name: input.roomName,
    target_capacity: input.capacity,
    target_room_type_id: input.roomTypeId,
  });
  if (error)
    throw new Error(
      error.message.includes("INVALID_ROOM_CAPACITY")
        ? "INVALID_ROOM_CAPACITY"
        : "CATALOG_UPDATE_FAILED",
    );
  revalidatePath("/admin/rooms");
}

export async function updateCatalogCourse(input: {
  id: string;
  courseCode: string;
  courseName: string;
  roomTypeId: string;
}) {
  const { supabase } = await adminContext();
  const { error } = await supabase.rpc("update_catalog_course", {
    target_id: input.id,
    target_course_code: input.courseCode,
    target_course_name: input.courseName,
    target_room_type_id: input.roomTypeId,
  });
  if (error) throw new Error("CATALOG_UPDATE_FAILED");
  revalidatePath("/admin/courses");
}

export async function updateCatalogRoomsBatch(
  inputs: Array<{
    id: string;
    roomCode: string;
    buildingCode: string;
    roomName: string;
    capacity: number | null;
    roomTypeId: string;
  }>,
) {
  inputs.forEach((input) => assertRoomCapacityInput(input.capacity));
  const { supabase } = await adminContext();
  const { error } = await supabase.rpc("update_catalog_rooms_batch", {
    target_rows: inputs.map((input) => ({
      id: input.id,
      room_code: input.roomCode,
      building_code: input.buildingCode,
      room_name: input.roomName,
      capacity: input.capacity,
      room_type_id: input.roomTypeId,
    })),
  });
  if (error)
    throw new Error(
      error.message.includes("INVALID_ROOM_CAPACITY")
        ? "INVALID_ROOM_CAPACITY"
        : "CATALOG_UPDATE_FAILED",
    );
  revalidatePath("/admin/rooms");
}

export async function updateCatalogCoursesBatch(
  inputs: Array<{
    id: string;
    courseCode: string;
    courseName: string;
    roomTypeId: string;
  }>,
) {
  const { supabase } = await adminContext();
  const { error } = await supabase.rpc("update_catalog_courses_batch", {
    target_rows: inputs.map((input) => ({
      id: input.id,
      course_code: input.courseCode,
      course_name: input.courseName,
      room_type_id: input.roomTypeId,
    })),
  });
  if (error) throw new Error("CATALOG_UPDATE_FAILED");
  revalidatePath("/admin/courses");
}

export async function resetPersonnelPassword(targetUserId: string) {
  const { supabase } = await personnelContext();
  if (!/^[0-9a-f]{8}-/i.test(targetUserId)) throw new Error("INVALID_TARGET");
  const adminClient = createAdminClient();
  const { data: authUser, error: authReadError } =
    await adminClient.auth.admin.getUserById(targetUserId);
  if (!authUser.user) throw new Error("PASSWORD_RESET_NOT_AVAILABLE");
  const providers = new Set([
    authUser?.user.app_metadata?.provider,
    ...(authUser?.user.app_metadata?.providers ?? []),
    ...(authUser?.user.identities ?? []).map((identity) => identity.provider),
  ]);
  if (authReadError || !providers.has("email")) {
    throw new Error("PASSWORD_RESET_NOT_AVAILABLE");
  }
  const canonicalEmail = authUser.user.email?.trim();
  if (!canonicalEmail) throw new Error("PASSWORD_RESET_NOT_AVAILABLE");
  const { data: operationId, error: reserveError } = await supabase.rpc(
    "reserve_personnel_password_operation",
    { target_user_id: targetUserId, target_action: "password_reset" },
  );
  if (reserveError || !operationId)
    throw new Error("PASSWORD_RESET_NOT_ALLOWED");
  await beginPersonnelPasswordAuthUpdate(adminClient, operationId);
  let updateError: { message: string } | null = null;
  let updateThrew = false;
  try {
    const result = await adminClient.auth.admin.updateUserById(targetUserId, {
      password: canonicalEmail,
    });
    updateError = result.error;
  } catch {
    updateThrew = true;
  }
  if (updateThrew) {
    const { error: markError } = await adminClient.rpc(
      "mark_personnel_password_reconciliation_required",
      {
        target_operation_id: operationId,
        target_error: "auth_update_outcome_unknown",
      },
    );
    if (markError) throw new Error("PASSWORD_OPERATION_RECOVERY_REQUIRED");
    revalidatePath("/admin/personnel");
    return { outcome: "reconciliation_pending" as const };
  }
  const { error: authStateError } = await adminClient.rpc(
    "record_personnel_password_auth_result",
    {
      target_operation_id: operationId,
      target_auth_succeeded: !updateError,
      target_error: updateError?.message ?? null,
    },
  );
  if (authStateError) {
    await markPersonnelPasswordReconciliationRequired(
      adminClient,
      operationId,
      "auth_result_recording_failed",
    );
    const recovered = await reconcilePersonnelPasswordAuthUpdate(
      adminClient,
      operationId,
    );
    if (recovered?.outcome === "auth_failed")
      throw new Error("PASSWORD_RESET_AUTH_FAILED");
    revalidatePath("/admin/personnel");
    return;
  }
  if (updateError) throw new Error("PASSWORD_RESET_AUTH_FAILED");
  const { error: commitError } = await adminClient.rpc(
    "commit_personnel_password_operation",
    { target_operation_id: operationId },
  );
  if (commitError) {
    const { error: markError } = await adminClient.rpc(
      "mark_personnel_password_reconciliation_required",
      {
        target_operation_id: operationId,
        target_error: commitError.message,
      },
    );
    if (markError) throw new Error("PASSWORD_OPERATION_RECOVERY_REQUIRED");
    await reconcilePersonnelPasswordAuthUpdate(adminClient, operationId);
    revalidatePath("/admin/personnel");
    return;
  }
  revalidatePath("/admin/personnel");
}

export async function changePersonnelPasswordByRoot(
  targetUserId: string,
  password: string,
  confirmation: string,
) {
  const { supabase, authority } = await personnelContext();
  if (
    !authority.is_root_administrator ||
    password.length < 6 ||
    password !== confirmation
  ) {
    throw new Error("PASSWORD_CHANGE_NOT_ALLOWED");
  }
  const adminClient = createAdminClient();
  const { data: authUser } =
    await adminClient.auth.admin.getUserById(targetUserId);
  if (!authUser.user) throw new Error("PASSWORD_CHANGE_NOT_AVAILABLE");
  const providers = new Set([
    authUser?.user.app_metadata?.provider,
    ...(authUser?.user.app_metadata?.providers ?? []),
    ...(authUser?.user.identities ?? []).map((identity) => identity.provider),
  ]);
  if (!providers.has("email")) throw new Error("PASSWORD_CHANGE_NOT_AVAILABLE");
  const { data: operationId, error: reserveError } = await supabase.rpc(
    "reserve_personnel_password_operation",
    { target_user_id: targetUserId, target_action: "password_changed_by_root" },
  );
  if (reserveError || !operationId)
    throw new Error("PASSWORD_CHANGE_NOT_ALLOWED");
  await beginPersonnelPasswordAuthUpdate(adminClient, operationId);
  let error: { message: string } | null = null;
  let updateThrew = false;
  try {
    const result = await adminClient.auth.admin.updateUserById(targetUserId, {
      password,
    });
    error = result.error;
  } catch {
    updateThrew = true;
  }
  if (updateThrew) {
    const { error: markError } = await adminClient.rpc(
      "mark_personnel_password_reconciliation_required",
      {
        target_operation_id: operationId,
        target_error: "auth_update_outcome_unknown",
      },
    );
    if (markError) throw new Error("PASSWORD_OPERATION_RECOVERY_REQUIRED");
    revalidatePath("/admin/personnel");
    return { outcome: "reconciliation_pending" as const };
  }
  const { error: authStateError } = await adminClient.rpc(
    "record_personnel_password_auth_result",
    {
      target_operation_id: operationId,
      target_auth_succeeded: !error,
      target_error: error?.message ?? null,
    },
  );
  if (authStateError) {
    await markPersonnelPasswordReconciliationRequired(
      adminClient,
      operationId,
      "auth_result_recording_failed",
    );
    const recovered = await reconcilePersonnelPasswordAuthUpdate(
      adminClient,
      operationId,
    );
    if (recovered?.outcome === "auth_failed")
      throw new Error("PASSWORD_CHANGE_AUTH_FAILED");
    revalidatePath("/admin/personnel");
    return;
  }
  if (error) throw new Error("PASSWORD_CHANGE_AUTH_FAILED");
  const { error: commitError } = await adminClient.rpc(
    "commit_personnel_password_operation",
    { target_operation_id: operationId },
  );
  if (commitError) {
    const { error: markError } = await adminClient.rpc(
      "mark_personnel_password_reconciliation_required",
      {
        target_operation_id: operationId,
        target_error: commitError.message,
      },
    );
    if (markError) throw new Error("PASSWORD_OPERATION_RECOVERY_REQUIRED");
    await reconcilePersonnelPasswordAuthUpdate(adminClient, operationId);
    revalidatePath("/admin/personnel");
    return;
  }
  revalidatePath("/admin/personnel");
}

// This action is intentionally Root-only and receives just an operation ID;
// the durable operation has already recorded whether Auth succeeded.  It never
// receives a password, reset value, or provider token from the browser.
export async function reconcilePersonnelPasswordOperation(operationId: string) {
  const { authority } = await personnelContext();
  if (!authority.is_root_administrator || !/^[0-9a-f]{8}-/i.test(operationId)) {
    throw new Error("PASSWORD_RECONCILIATION_NOT_ALLOWED");
  }
  const { error } = await createAdminClient().rpc(
    "reconcile_personnel_password_operation",
    { target_operation_id: operationId },
  );
  if (error) throw new Error("PASSWORD_RECONCILIATION_FAILED");
  revalidatePath("/admin/personnel");
}

export async function setPersonnelEmailNotificationCapability(
  targetUserId: string,
  enabled: boolean,
): Promise<number> {
  const { supabase } = await adminContext();
  const { data, error } = await supabase.rpc(
    "set_personnel_email_notification_capability",
    { target_user_id: targetUserId, target_enabled: enabled },
  );
  if (error) throw new Error("EMAIL_NOTIFICATION_CAPABILITY_UPDATE_FAILED");
  revalidatePath("/admin/personnel");
  return Number(data);
}

function catalogRedirect(
  path: "/admin/courses" | "/admin/rooms" | "/admin/personnel",
  kind: "notice" | "error",
  message: string,
): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}

function normalizeImportKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function importValue(row: Record<string, unknown>, ...keys: string[]) {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [normalizeImportKey(key), value]),
  );
  for (const key of keys) {
    const value = String(normalized.get(normalizeImportKey(key)) ?? "").trim();
    if (value) return value;
  }
  return "";
}

async function readAdminCatalogFile(
  formData: FormData,
  path: "/admin/courses" | "/admin/rooms" | "/admin/personnel",
) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    catalogRedirect(path, "error", "Vui lòng chọn file import.");
  }
  if (file.size > 10 * 1024 * 1024) {
    catalogRedirect(path, "error", "File import không được vượt quá 10 MB.");
  }
  if (!/\.(csv|xlsx)$/i.test(file.name)) {
    catalogRedirect(path, "error", "Chỉ hỗ trợ file CSV hoặc XLSX.");
  }
  const XLSX = await import("@e965/xlsx");
  const fileBuffer = await file.arrayBuffer();
  const workbook = /\.csv$/i.test(file.name)
    ? XLSX.read(new TextDecoder("utf-8").decode(fileBuffer), {
        type: "string",
        codepage: 65001,
      })
    : XLSX.read(fileBuffer, { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: "",
    raw: false,
  });
  if (!rows.length || rows.length > 5000) {
    catalogRedirect(path, "error", "File phải có từ 1 đến 5.000 dòng dữ liệu.");
  }
  return { file, rows };
}

export async function importCourses(formData: FormData) {
  const { supabase } = await adminContext();
  try {
    const { file, rows } = await readAdminCatalogFile(
      formData,
      "/admin/courses",
    );
    const { data: roomTypes, error: typeError } = await supabase
      .from("room_types")
      .select("id,code,name")
      .eq("is_active", true);
    if (typeError) throw typeError;
    const roomTypeByKey = new Map<string, string>();
    (roomTypes ?? []).forEach((roomType) => {
      roomTypeByKey.set(normalizeImportKey(roomType.code), roomType.id);
      roomTypeByKey.set(normalizeImportKey(roomType.name), roomType.id);
    });
    const allowedRoomTypeNames = (roomTypes ?? [])
      .map(({ name }) => name)
      .join(", ");
    const imported = new Map<
      string,
      { course_code: string; course_name: string; room_type_id: string }
    >();
    rows.forEach((row, index) => {
      const courseCode = importValue(row, "Mã môn học", "course_code");
      const courseName = importValue(row, "Tên môn học", "course_name");
      const roomTypeKey = importValue(
        row,
        "Loại",
        "Loại phòng",
        "Mã loại phòng",
        "room_type_code",
      );
      const roomTypeId = roomTypeByKey.get(normalizeImportKey(roomTypeKey));
      if (!courseCode || !courseName || !roomTypeId) {
        throw new Error(
          `Dòng ${index + 2} phải có Mã môn học, Tên môn học và Loại hợp lệ. Chỉ dùng: ${allowedRoomTypeNames}.`,
        );
      }
      imported.set(courseCode.toLocaleUpperCase("vi"), {
        course_code: courseCode,
        course_name: courseName,
        room_type_id: roomTypeId,
      });
    });

    const { data: existing, error: readError } = await supabase
      .from("courses")
      .select("id,course_code");
    if (readError) throw readError;
    const existingByCode = new Map(
      (existing ?? []).map((course) => [
        course.course_code.trim().toLocaleUpperCase("vi"),
        course.id,
      ]),
    );
    const payload = [...imported.entries()].map(([key, course]) => ({
      id: existingByCode.get(key),
      ...course,
    }));
    const { error } = await supabase.rpc("apply_catalog_course_import", {
      target_rows: payload,
    });
    if (error) throw error;
    revalidatePath("/admin/courses");
    catalogRedirect(
      "/admin/courses",
      "notice",
      `Đã import ${payload.length} môn học từ ${file.name}.`,
    );
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    catalogRedirect(
      "/admin/courses",
      "error",
      error instanceof Error ? error.message : "Không thể đọc file import.",
    );
  }
}

export async function importRooms(formData: FormData) {
  const { supabase } = await adminContext();
  try {
    const { file, rows } = await readAdminCatalogFile(formData, "/admin/rooms");
    const { data: roomTypes, error: typeError } = await supabase
      .from("room_types")
      .select("id,code,name")
      .eq("is_active", true);
    if (typeError) throw typeError;
    const roomTypeByKey = new Map<string, string>();
    (roomTypes ?? []).forEach((roomType) => {
      roomTypeByKey.set(normalizeImportKey(roomType.code), roomType.id);
      roomTypeByKey.set(normalizeImportKey(roomType.name), roomType.id);
    });

    const imported = new Map<
      string,
      {
        room_code: string;
        building_code: string;
        room_name: string | null;
        room_type_id: string;
        capacity: number | null;
      }
    >();
    rows.forEach((row, index) => {
      const roomCode = importValue(row, "Mã phòng", "room_code");
      const buildingCode = importValue(row, "Tòa nhà", "building_code");
      const roomName = importValue(row, "Tên phòng", "room_name");
      const roomTypeKey = importValue(
        row,
        "Loại phòng",
        "Mã loại phòng",
        "room_type_code",
      );
      const capacityText = importValue(row, "Sức chứa", "capacity");
      const capacity = capacityText ? Number(capacityText) : null;
      const roomTypeId = roomTypeByKey.get(normalizeImportKey(roomTypeKey));
      if (!roomCode || !buildingCode || !roomTypeId) {
        throw new Error(
          `Dòng ${index + 2} phải có Mã phòng, Tòa nhà và Loại phòng hợp lệ.`,
        );
      }
      if (capacity !== null && (!Number.isInteger(capacity) || capacity <= 0)) {
        throw new Error(
          `Sức chứa tại dòng ${index + 2} phải là số nguyên dương.`,
        );
      }
      const key = `${roomCode.toLocaleUpperCase("vi")}|${buildingCode.toLocaleUpperCase("vi")}`;
      imported.set(key, {
        room_code: roomCode,
        building_code: buildingCode,
        room_name: roomName || null,
        room_type_id: roomTypeId,
        capacity,
      });
    });

    const { data: existing, error: readError } = await supabase
      .from("rooms")
      .select("id,room_code,building_code");
    if (readError) throw readError;
    const existingByCode = new Map(
      (existing ?? []).map((room) => [
        `${room.room_code.trim().toLocaleUpperCase("vi")}|${room.building_code.trim().toLocaleUpperCase("vi")}`,
        room.id,
      ]),
    );
    const payload = [...imported.entries()].map(([key, room]) => ({
      id: existingByCode.get(key),
      ...room,
    }));
    const { error } = await supabase.rpc("apply_catalog_room_import", {
      target_rows: payload,
    });
    if (error) throw error;
    revalidatePath("/admin/rooms");
    catalogRedirect(
      "/admin/rooms",
      "notice",
      `Đã import ${payload.length} phòng từ ${file.name}.`,
    );
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    catalogRedirect(
      "/admin/rooms",
      "error",
      error instanceof Error && error.message.includes("INVALID_ROOM_CAPACITY")
        ? "Sức chứa phải là số nguyên từ 1 trở lên hoặc để trống."
        : error instanceof Error
          ? error.message
          : "Không thể đọc file import.",
    );
  }
}

export async function deleteCourse(formData: FormData) {
  const { supabase } = await adminContext();
  const { error } = await supabase.rpc("delete_catalog_course", {
    target_course_id: String(formData.get("id") ?? ""),
  });
  if (error) throw new Error("CATALOG_DELETE_BLOCKED");
  revalidatePath("/admin/courses");
}

export async function createRoom(formData: FormData) {
  const { supabase } = await adminContext();
  const roomCode = String(formData.get("room_code") ?? "").trim();
  const buildingCode = String(formData.get("building_code") ?? "").trim();
  const roomTypeId = String(formData.get("room_type_id") ?? "").trim();
  if (!roomCode || !buildingCode || !roomTypeId) {
    catalogRedirect(
      "/admin/rooms",
      "error",
      "Vui lòng nhập Mã phòng, Tòa nhà và Loại phòng.",
    );
  }
  const capacityValue = String(formData.get("capacity") ?? "").trim();
  if (capacityValue && !/^[1-9]\d*$/.test(capacityValue)) {
    catalogRedirect(
      "/admin/rooms",
      "error",
      "Sức chứa phải là số nguyên từ 1 trở lên.",
    );
  }
  const { data: roomType } = await supabase
    .from("room_types")
    .select("id")
    .eq("id", roomTypeId)
    .eq("is_active", true)
    .maybeSingle();
  if (!roomType) {
    catalogRedirect(
      "/admin/rooms",
      "error",
      "Loại phòng đã chọn không hợp lệ.",
    );
  }
  const { error } = await supabase.from("rooms").insert({
    room_code: roomCode,
    building_code: buildingCode,
    room_name: String(formData.get("room_name") ?? "").trim() || null,
    room_type_id: roomTypeId,
    capacity: capacityValue ? Number(capacityValue) : null,
  });
  if (error) {
    catalogRedirect(
      "/admin/rooms",
      "error",
      error.code === "23505" ? "Phòng đã tồn tại." : "Không thể thêm phòng.",
    );
  }
  revalidatePath("/admin/rooms");
  catalogRedirect("/admin/rooms", "notice", "Đã thêm phòng.");
}

export async function createRoomType(formData: FormData) {
  const { supabase } = await adminContext();
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!name || !code)
    catalogRedirect(
      "/admin/rooms",
      "error",
      "Tên và mã Loại phòng không hợp lệ.",
    );
  const { error } = await supabase.from("room_types").insert({ name, code });
  if (error)
    catalogRedirect(
      "/admin/rooms",
      "error",
      "Loại phòng đã tồn tại hoặc không hợp lệ.",
    );
  revalidatePath("/admin/rooms");
  catalogRedirect("/admin/rooms", "notice", "Đã thêm Loại phòng.");
}

export async function toggleRoomType(formData: FormData) {
  const { supabase } = await adminContext();
  const { error } = await supabase
    .from("room_types")
    .update({ is_active: String(formData.get("active")) === "true" })
    .eq("id", String(formData.get("id") ?? ""));
  if (error)
    catalogRedirect("/admin/rooms", "error", "Không thể cập nhật Loại phòng.");
  revalidatePath("/admin/rooms");
  catalogRedirect("/admin/rooms", "notice", "Đã cập nhật Loại phòng.");
}

export async function deleteRoom(formData: FormData) {
  const { supabase } = await adminContext();
  const { error } = await supabase.rpc("delete_catalog_room", {
    target_room_id: String(formData.get("id") ?? ""),
  });
  if (error) throw new Error("CATALOG_DELETE_BLOCKED");
  revalidatePath("/admin/rooms");
}

function personnelRedirect(kind: "notice" | "error", message: string): never {
  redirect(`/admin/personnel?${kind}=${encodeURIComponent(message)}`);
}

async function beginPersonnelPasswordAuthUpdate(
  adminClient: ReturnType<typeof createAdminClient>,
  operationId: string,
) {
  const { error } = await adminClient.rpc(
    "begin_personnel_password_auth_update",
    { target_operation_id: operationId },
  );
  if (!error) return;
  await markPersonnelPasswordReconciliationRequired(
    adminClient,
    operationId,
    "auth_update_not_started",
  );
  const released = await reconcilePersonnelPasswordAuthUpdate(
    adminClient,
    operationId,
  );
  if (released?.outcome !== "auth_failed")
    throw new Error("PASSWORD_OPERATION_RECOVERY_REQUIRED");
  throw new Error("PASSWORD_AUTH_UPDATE_NOT_STARTED");
}

async function markPersonnelPasswordReconciliationRequired(
  adminClient: ReturnType<typeof createAdminClient>,
  operationId: string,
  reason: string,
) {
  const { error } = await adminClient.rpc(
    "mark_personnel_password_reconciliation_required",
    { target_operation_id: operationId, target_error: reason },
  );
  if (error) throw new Error("PASSWORD_OPERATION_RECOVERY_REQUIRED");
}

async function reconcilePersonnelPasswordAuthUpdate(
  adminClient: ReturnType<typeof createAdminClient>,
  operationId: string,
) {
  const { data, error } = await adminClient.rpc(
    "reconcile_personnel_password_operation",
    { target_operation_id: operationId },
  );
  if (error) throw new Error("PASSWORD_AUTH_CHANGED_RECONCILIATION_REQUIRED");
  return data as { outcome?: string } | null;
}

type PersonnelRole =
  "admin" | "lecturer" | "staff" | "teaching_assistant" | "viewer";

const personnelRoleAliases = new Map<string, PersonnelRole>([
  ["admin", "admin"],
  ["quantrivien", "admin"],
  ["lecturer", "lecturer"],
  ["giangvien", "lecturer"],
  ["staff", "staff"],
  ["nhanvien", "staff"],
  ["chuyenvien", "staff"],
  ["teachingassistant", "teaching_assistant"],
  ["trogiang", "teaching_assistant"],
  ["viewer", "viewer"],
  ["nguoixem", "viewer"],
]);

const legacyImportRoleAliases = new Set([
  "importer",
  "nguoitaophieu",
  "nguoinhaplich",
  "quyennhaplich",
]);

function splitPersonnelImportValues(value: string) {
  return value
    .split(/[,;|\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parsePersonnelImportBoolean(
  value: string,
  rowNumber: number,
  label = "Quyền Y cơ sở",
) {
  if (!value) return null;
  const normalized = normalizeImportKey(value);
  if (["co", "true", "1", "yes", "x"].includes(normalized)) return true;
  if (["khong", "false", "0", "no"].includes(normalized)) return false;
  throw new Error(`${label} tại dòng ${rowNumber} chỉ nhận Có hoặc Không.`);
}

export async function createPersonnel(formData: FormData) {
  const { supabase, userId } = await personnelContext();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const title = String(formData.get("title") ?? "").trim() || null;
  const roles = formData
    .getAll("roles")
    .map(String)
    .filter((role) =>
      ["admin", "lecturer", "staff", "teaching_assistant", "viewer"].includes(
        role,
      ),
    ) as PersonnelRole[];
  const roomTypeIds = [
    ...new Set(formData.getAll("room_type_ids").map(String).filter(Boolean)),
  ];
  const requestedEmailRoomTypeIds = new Set(
    formData.getAll("email_room_type_ids").map(String).filter(Boolean),
  );
  const emailRoomTypeIds = new Set(
    roomTypeIds.filter((roomTypeId) =>
      requestedEmailRoomTypeIds.has(roomTypeId),
    ),
  );
  const allowBasicMedicalAccess =
    String(formData.get("allow_basic_medical_access")) === "true";
  const canImportSchedules =
    String(formData.get("can_import_schedules")) === "true";

  if (!email || !fullName || password.length < 8 || roles.length === 0) {
    personnelRedirect(
      "error",
      "Cần đủ họ tên, email, mật khẩu tạm từ 8 ký tự và ít nhất một vai trò.",
    );
  }
  if (roles.includes("viewer") && roles.length > 1) {
    personnelRedirect(
      "error",
      "Vai trò Người xem là quyền chỉ đọc và không thể kết hợp với vai trò khác.",
    );
  }
  if (
    canImportSchedules &&
    !roles.some((role) =>
      ["staff", "lecturer", "teaching_assistant"].includes(role),
    )
  ) {
    personnelRedirect(
      "error",
      "Quyền nhập lịch chỉ áp dụng cho Chuyên viên, Giảng viên hoặc Trợ giảng.",
    );
  }

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch {
    personnelRedirect(
      "error",
      "Chưa cấu hình SUPABASE_SECRET_KEY cho chức năng tạo tài khoản.",
    );
  }

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { preapproved: true },
  });
  if (error || !data.user) {
    personnelRedirect(
      "error",
      error?.message ?? "Không thể tạo tài khoản nhân sự.",
    );
  }

  const targetId = data.user.id;
  const { data: createdProfile } = await supabase
    .from("profiles")
    .select("access_version")
    .eq("id", targetId)
    .single();
  const { error: profileError } = await supabase.rpc("admin_update_personnel", {
    target_profile_id: targetId,
    target_email: email,
    target_full_name: fullName,
    target_phone: phone,
    target_title: title,
    target_roles: roles,
    target_can_import_schedules: canImportSchedules,
    target_room_type_ids: roomTypeIds,
    target_email_room_type_ids: roles.includes("viewer")
      ? [...emailRoomTypeIds]
      : [],
    target_allow_basic_medical_access: allowBasicMedicalAccess,
    target_is_active: true,
    target_expected_version: createdProfile?.access_version ?? 1,
  });

  if (profileError) {
    const cleanupFailures = await cleanupCreatedAuthUsersOrRecordReconciliation(
      {
        adminClient,
        identities: [{ id: targetId, email }],
        actorId: userId,
        failureStage: "create_personnel_auth_cleanup",
      },
    );
    if (cleanupFailures.length) {
      personnelRedirect(
        "error",
        "AUTH_PROFILE_RECONCILIATION_REQUIRED: Không thể xóa tài khoản Auth sau khi lưu hồ sơ thất bại. Tài khoản đã được khóa và ghi nhận để đối soát.",
      );
    }
    personnelRedirect(
      "error",
      personnelRpcMessage(profileError.message) ||
        "Không thể hoàn tất hồ sơ nhân sự.",
    );
  }

  revalidatePath("/admin/personnel");
  personnelRedirect("notice", `Đã tạo tài khoản ${email}.`);
}

export async function importPersonnel(formData: FormData) {
  const { supabase, userId } = await personnelContext();
  const mode = String(formData.get("mode") ?? "");
  if (!(["new", "all"] as const).includes(mode as "new" | "all")) {
    personnelRedirect("error", "Chế độ import nhân sự không hợp lệ.");
  }

  try {
    const { file, rows } = await readAdminCatalogFile(
      formData,
      "/admin/personnel",
    );
    if (rows.length > 500) {
      throw new Error("Mỗi lần chỉ import tối đa 500 nhân sự.");
    }

    const [
      { data: roomTypes, error: roomTypeError },
      { data: profiles, error: profileReadError },
      { data: currentRoleRows, error: roleReadError },
    ] = await Promise.all([
      supabase.from("room_types").select("id,code,name").eq("is_active", true),
      supabase
        .from("profiles")
        .select(
          "id,email,full_name,phone,is_active,allow_basic_medical_access,can_import_schedules,access_version",
        ),
      supabase.from("user_roles").select("user_id,role"),
    ]);
    if (roomTypeError || profileReadError || roleReadError) {
      throw roomTypeError ?? profileReadError ?? roleReadError;
    }

    const roomTypeByKey = new Map<string, string>();
    (roomTypes ?? []).forEach((roomType) => {
      roomTypeByKey.set(normalizeImportKey(roomType.code), roomType.id);
      roomTypeByKey.set(normalizeImportKey(roomType.name), roomType.id);
    });
    const existingByEmail = new Map(
      (profiles ?? []).map((profile) => [
        profile.email.trim().toLowerCase(),
        profile,
      ]),
    );
    const existingByPhone = new Map(
      (profiles ?? [])
        .map(
          (profile) =>
            [normalizePersonnelPhone(profile.phone), profile] as const,
        )
        .filter(([phone]) => Boolean(phone)),
    );
    const administratorIds = new Set(
      (currentRoleRows ?? [])
        .filter(({ role }) => role === "admin")
        .map(({ user_id }) => user_id),
    );

    const importedRows: Array<{
      email: string;
      fullName: string;
      password: string;
      phone: string | null;
      title: string | null;
      roles: PersonnelRole[];
      roomTypeIds: string[];
      emailRoomTypeIds: string[];
      allowBasicMedicalAccess: boolean | null;
      canImportSchedules: boolean;
      rowNumber: number;
    }> = [];

    let compatibilityWarningCount = 0;
    rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const fullName = importValue(row, "Họ và tên", "Họ tên", "full_name");
      const email = importValue(row, "Email đăng nhập", "Email")
        .trim()
        .toLowerCase();
      const password = importValue(row, "Mật khẩu tạm", "Mật khẩu", "password");
      const phone = importValue(row, "Số điện thoại", "phone") || null;
      const title = importValue(row, "Chức danh", "title") || null;
      const roleText = importValue(row, "Vai trò", "roles", "role");
      const importPermissionText = importValue(
        row,
        "Quyền nhập lịch",
        "can_import_schedules",
      );
      const roomTypeText = importValue(
        row,
        "Loại phòng",
        "Mã loại phòng",
        "room_type_codes",
      );
      const basicMedicalText = importValue(
        row,
        "Quyền Y cơ sở",
        "allow_basic_medical_access",
      );
      const emailRoomTypeText = importValue(
        row,
        "Loại phòng nhận email",
        "Nhận email loại phòng",
        "email_room_types",
      );

      if (!fullName || !email || !/^\S+@\S+\.\S+$/.test(email)) {
        throw new Error(
          `Dòng ${rowNumber} phải có Họ và tên và Email đăng nhập hợp lệ.`,
        );
      }

      const roleValues = splitPersonnelImportValues(roleText);
      const legacyImportValues = roleValues.filter((role) =>
        legacyImportRoleAliases.has(normalizeImportKey(role)),
      );
      const mainRoleValues = roleValues.filter(
        (role) => !legacyImportRoleAliases.has(normalizeImportKey(role)),
      );
      const invalidRoleValues = mainRoleValues.filter(
        (role) => !personnelRoleAliases.has(normalizeImportKey(role)),
      );
      let roles = [
        ...new Set(
          mainRoleValues.map((role) =>
            personnelRoleAliases.get(normalizeImportKey(role)),
          ),
        ),
      ].filter(Boolean) as PersonnelRole[];
      if (!roles.length && legacyImportValues.length > 0) {
        roles = ["teaching_assistant"];
        compatibilityWarningCount += 1;
      }
      if (!roles.length || invalidRoleValues.length > 0) {
        const received = invalidRoleValues.length
          ? ` Giá trị chưa đúng: "${invalidRoleValues.join(", ")}".`
          : "";
        throw new Error(
          `Vai trò tại dòng ${rowNumber} không hợp lệ.${received} Chỉ dùng: ${personnelRoleDisplayNames.join(", ")}.`,
        );
      }
      if (roles.includes("viewer") && roles.length > 1) {
        throw new Error(
          "Vai trò Người xem tại dòng " +
            rowNumber +
            " không thể kết hợp với vai trò khác.",
        );
      }
      const parsedImportPermission = parsePersonnelImportBoolean(
        importPermissionText,
        rowNumber,
        "Quyền nhập lịch",
      );
      const canImportSchedules =
        parsedImportPermission ?? legacyImportValues.length > 0;
      if (canImportSchedules && roles.includes("viewer")) {
        throw new Error(
          `Quyền nhập lịch tại dòng ${rowNumber} không áp dụng cho Người xem.`,
        );
      }

      const roomTypeValues = splitPersonnelImportValues(roomTypeText);
      const invalidRoomTypeValues = roomTypeValues.filter(
        (roomType) => !roomTypeByKey.has(normalizeImportKey(roomType)),
      );
      const roomTypeIds = [
        ...new Set(
          roomTypeValues.map((roomType) =>
            roomTypeByKey.get(normalizeImportKey(roomType)),
          ),
        ),
      ];
      if (!roomTypeIds.length || invalidRoomTypeValues.length > 0) {
        const received = invalidRoomTypeValues.length
          ? ` Giá trị chưa đúng: "${invalidRoomTypeValues.join(", ")}".`
          : "";
        const allowedRoomTypes = (roomTypes ?? [])
          .map(({ name }) => name)
          .join(", ");
        throw new Error(
          `Loại phòng tại dòng ${rowNumber} không hợp lệ.${received} Chỉ dùng: ${allowedRoomTypes || "chưa có Loại phòng đang hoạt động"}. Nhiều Loại phòng ngăn cách bằng dấu phẩy.`,
        );
      }
      const emailRoomTypeValues = splitPersonnelImportValues(emailRoomTypeText);
      const invalidEmailRoomTypeValues = emailRoomTypeValues.filter(
        (roomType) => !roomTypeByKey.has(normalizeImportKey(roomType)),
      );
      const emailRoomTypeIds = [
        ...new Set(
          emailRoomTypeValues.map((roomType) =>
            roomTypeByKey.get(normalizeImportKey(roomType)),
          ),
        ),
      ];
      if (invalidEmailRoomTypeValues.length > 0) {
        throw new Error(
          `Loại phòng nhận email tại dòng ${rowNumber} không hợp lệ. Giá trị chưa đúng: "${invalidEmailRoomTypeValues.join(", ")}". Chỉ dùng tên Loại phòng đang hoạt động và đã nhập trong cột Loại phòng.`,
        );
      }
      if (
        emailRoomTypeIds.some((roomTypeId) => !roomTypeIds.includes(roomTypeId))
      ) {
        throw new Error(
          "Loại phòng nhận email tại dòng " +
            rowNumber +
            " phải nằm trong Loại phòng được phân công.",
        );
      }

      importedRows.push({
        email,
        fullName,
        password,
        phone,
        title,
        roles: roles as PersonnelRole[],
        roomTypeIds: roomTypeIds as string[],
        emailRoomTypeIds: emailRoomTypeIds as string[],
        allowBasicMedicalAccess: parsePersonnelImportBoolean(
          basicMedicalText,
          rowNumber,
        ),
        canImportSchedules,
        rowNumber,
      });
    });

    assertUniquePersonnelImportIdentities(importedRows);
    if (mode === "new") {
      for (const row of importedRows) {
        const existingEmail = existingByEmail.get(row.email);
        if (existingEmail) {
          throw new Error(
            `Email "${row.email}" tại dòng ${row.rowNumber} đã thuộc về ${existingEmail.full_name}. Import mới chỉ nhận email và số điện thoại chưa tồn tại.`,
          );
        }
        const normalizedPhone = normalizePersonnelPhone(row.phone);
        const existingPhone = normalizedPhone
          ? existingByPhone.get(normalizedPhone)
          : undefined;
        if (existingPhone) {
          throw new Error(
            `Số điện thoại "${row.phone}" tại dòng ${row.rowNumber} đã thuộc về ${existingPhone.full_name} (${existingPhone.email}). Import mới không thay đổi dữ liệu hiện có.`,
          );
        }
      }
    }

    const preservedAdministratorRows = importedRows.filter((row) => {
      const existing = existingByEmail.get(row.email);
      return Boolean(existing && administratorIds.has(existing.id));
    });
    if (mode === "all") {
      for (const row of importedRows) {
        const normalizedPhone = normalizePersonnelPhone(row.phone);
        const existingPhone = normalizedPhone
          ? existingByPhone.get(normalizedPhone)
          : undefined;
        if (
          existingPhone &&
          administratorIds.has(existingPhone.id) &&
          existingPhone.email.trim().toLowerCase() !== row.email
        ) {
          throw new Error(
            `Số điện thoại "${row.phone}" tại dòng ${row.rowNumber} đang thuộc tài khoản Quản trị viên ${existingPhone.full_name} (${existingPhone.email}) và không thể thay thế.`,
          );
        }
      }
    }

    const selectedRows = importedRows.filter(
      (row) =>
        mode === "new" ||
        !preservedAdministratorRows.some(
          (administrator) => administrator.email === row.email,
        ),
    );
    for (const row of selectedRows) {
      if (!existingByEmail.has(row.email) && row.password.length < 8) {
        throw new Error(
          `Mật khẩu tạm tại dòng ${row.rowNumber} phải có ít nhất 8 ký tự để tạo tài khoản mới.`,
        );
      }
    }

    let adminClient;
    try {
      adminClient = createAdminClient();
    } catch {
      throw new Error(
        "Chưa cấu hình SUPABASE_SECRET_KEY cho chức năng import nhân sự.",
      );
    }

    const createdUsers: CreatedAuthIdentity[] = [];
    const resolvedRows: Array<
      (typeof selectedRows)[number] & {
        id: string;
        isNew: boolean;
        accessVersion: number;
      }
    > = [];

    for (const row of selectedRows) {
      const existing = existingByEmail.get(row.email);
      if (existing) {
        resolvedRows.push({
          ...row,
          id: existing.id,
          isNew: false,
          accessVersion: existing.access_version,
        });
        continue;
      }

      const { data, error } = await adminClient.auth.admin.createUser({
        email: row.email,
        password: row.password,
        email_confirm: true,
        user_metadata: { full_name: row.fullName },
        app_metadata: { preapproved: true },
      });
      if (error || !data.user) {
        const failures = await cleanupCreatedAuthUsersOrRecordReconciliation({
          adminClient,
          identities: createdUsers,
          actorId: userId,
          failureStage: "personnel_import_create_cleanup",
        });
        if (failures.length)
          throw new Error("AUTH_PROFILE_RECONCILIATION_REQUIRED");
        throw new Error(
          `Không thể tạo ${row.email}: ${error?.message ?? "Lỗi không xác định"}`,
        );
      }
      createdUsers.push({ id: data.user.id, email: row.email });
      resolvedRows.push({
        ...row,
        id: data.user.id,
        isNew: true,
        accessVersion: 1,
      });
    }
    const { data: importResult, error: importError } = await supabase.rpc(
      "admin_apply_personnel_import",
      {
        target_mode: mode,
        target_file_name: file.name,
        target_rows: resolvedRows.map((row) => ({
          id: row.id,
          email: row.email,
          full_name: row.fullName,
          phone: row.phone,
          title: row.title,
          roles: row.roles,
          room_type_ids: row.roomTypeIds,
          email_room_type_ids: row.roles.includes("viewer")
            ? row.emailRoomTypeIds
            : [],
          can_import_schedules: row.canImportSchedules,
          allow_basic_medical_access: row.allowBasicMedicalAccess ?? false,
          is_active: true,
          is_new: row.isNew,
          access_version: row.accessVersion,
        })),
      },
    );

    if (importError) {
      const failures = await cleanupCreatedAuthUsersOrRecordReconciliation({
        adminClient,
        identities: createdUsers,
        actorId: userId,
        failureStage: "personnel_import_rpc_cleanup",
      });
      if (failures.length)
        throw new Error("AUTH_PROFILE_RECONCILIATION_REQUIRED");
      throw new Error(personnelRpcMessage(importError.message));
    }
    const counts = importResult as {
      created?: number;
      updated?: number;
      locked?: number;
      skipped_protected?: number;
    } | null;
    const createdCount = Number(counts?.created ?? 0);
    const updatedCount = Number(counts?.updated ?? 0);
    const lockedCount = Number(counts?.locked ?? 0);
    const skippedCount =
      Number(counts?.skipped_protected ?? 0) +
      preservedAdministratorRows.length;
    revalidatePath("/admin/personnel");
    personnelRedirect(
      "notice",
      mode === "new"
        ? `Đã thêm ${createdCount} nhân sự mới từ ${file.name}. Dữ liệu hiện có được giữ nguyên.${compatibilityWarningCount ? ` ${compatibilityWarningCount} dòng Importer cũ đã được chuyển thành Trợ giảng + quyền nhập lịch.` : ""}`
        : `Đã thay danh sách nhân sự theo ${file.name}: ${createdCount} tạo mới, ${updatedCount} cập nhật, ${lockedCount} nhân sự cũ đã khóa; ${skippedCount} tài khoản được bảo vệ đã bỏ qua.${compatibilityWarningCount ? ` ${compatibilityWarningCount} dòng Importer cũ đã được chuyển thành Trợ giảng + quyền nhập lịch.` : ""}`,
    );
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    personnelRedirect(
      "error",
      error instanceof Error ? error.message : "Không thể đọc file import.",
    );
  }
}

export type SavePersonnelResult = {
  ok: boolean;
  message: string;
  personnel?: Record<string, unknown>;
  code?: string;
};

function personnelRpcMessage(message: string) {
  const mappings: Array<[string, string]> = [
    [
      "PERSONNEL_SECURITY_NOT_CONFIGURED",
      "Chưa cấu hình Root Administrator và tài khoản quản lý nhân sự. Hệ thống đang từ chối thao tác theo nguyên tắc an toàn.",
    ],
    ["PERSONNEL_MANAGER_REQUIRED", "Bạn không có quyền quản lý nhân sự."],
    [
      "ROOT_ADMIN_SECURITY_IMMUTABLE",
      "Không thể thay đổi quyền bảo mật của Root Administrator trong trang Nhân sự.",
    ],
    [
      "CANNOT_MANAGE_OWN_SECURITY",
      "Bạn không thể thay đổi quyền hoặc trạng thái của chính mình trong trang Nhân sự.",
    ],
    [
      "ROOT_ADMIN_REQUIRED_FOR_ADMIN_ACCOUNT",
      "Chỉ Root Administrator được thay đổi tài khoản Quản trị viên hiện hữu.",
    ],
    ["INVALID_PERSONNEL_VERSION", "Phiên bản nhân sự không hợp lệ."],
    [
      "PERSONNEL_BOOLEAN_REQUIRED",
      "Trạng thái và các quyền bổ sung phải được gửi đầy đủ.",
    ],
    ["INVALID_PERSONNEL_IMPORT", "Dữ liệu import nhân sự không hợp lệ."],
    [
      "PERSONNEL_CHANGED_RELOAD_REQUIRED",
      "Nhân sự đã được một quản trị viên khác cập nhật. Vui lòng tải lại dữ liệu trước khi lưu.",
    ],
    [
      "VIEWER_ROLE_MUST_BE_EXCLUSIVE",
      "Người xem không thể kết hợp với vai trò khác.",
    ],
    [
      "IMPORT_PERMISSION_ROLE_REQUIRED",
      "Quyền nhập lịch chỉ áp dụng cho Chuyên viên, Giảng viên hoặc Trợ giảng.",
    ],
    [
      "EMAIL_SCOPE_VIEWER_ONLY",
      "Chỉ Người xem mới cấu hình nhận email theo loại phòng.",
    ],
    [
      "EMAIL_SCOPE_MUST_BE_ASSIGNED",
      "Loại phòng nhận email phải nằm trong phạm vi được phân công.",
    ],
    [
      "CANNOT_LOCK_CURRENT_ADMIN",
      "Bạn không thể tự khóa tài khoản đang đăng nhập.",
    ],
    ["CANNOT_REMOVE_CURRENT_ADMIN", "Bạn không thể tự gỡ quyền Quản trị viên."],
    [
      "LAST_ACTIVE_ADMIN_REQUIRED",
      "Hệ thống phải còn ít nhất một Quản trị viên đang hoạt động.",
    ],
    ["PERSONNEL_EMAIL_EXISTS", "Email đăng nhập đã được sử dụng."],
    [
      "PERSONNEL_UPDATE_IN_PROGRESS",
      "Nhân sự đang được một quản trị viên khác cập nhật. Vui lòng thử lại sau.",
    ],
    [
      "PERSONNEL_RECONCILIATION_REQUIRED",
      "Nhân sự đang chờ đối soát email đăng nhập. Vui lòng xử lý đối soát trước khi chỉnh sửa tiếp.",
    ],
    [
      "ROOT_ADMIN_REQUIRED_FOR_PERSONNEL_MANAGER",
      "Chỉ Root Administrator được thay đổi tài khoản quản lý nhân sự.",
    ],
    [
      "PERSONNEL_UPDATE_OPERATION_EXPIRED",
      "Phiên chỉnh sửa đã hết hạn. Vui lòng tải lại nhân sự trước khi lưu.",
    ],
    [
      "PERSONNEL_EMAIL_CHANGE_REQUIRES_OPERATION",
      "Thay đổi email phải đi qua luồng đồng bộ tài khoản bảo mật.",
    ],
    ["PERSONNEL_PHONE_EXISTS", "Số điện thoại đã được sử dụng."],
    [
      "BASIC_MEDICAL_PERMISSION_INVALID",
      "Quyền tạo lịch Y cơ sở không phù hợp với vai trò hoặc phạm vi.",
    ],
  ];
  return mappings.find(([code]) => message.includes(code))?.[1] ?? message;
}

export async function savePersonnelChanges(
  formData: FormData,
): Promise<SavePersonnelResult> {
  const startedAt = performance.now();
  const { supabase, userId } = await personnelContext();
  const targetId = String(formData.get("id") ?? "");
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const roles = [...new Set(formData.getAll("roles").map(String))].filter(
    (role): role is PersonnelRole =>
      ["admin", "staff", "lecturer", "teaching_assistant", "viewer"].includes(
        role,
      ),
  );
  const roomTypeIds = [
    ...new Set(formData.getAll("room_type_ids").map(String).filter(Boolean)),
  ];
  const emailRoomTypeIds = [
    ...new Set(
      formData.getAll("email_room_type_ids").map(String).filter(Boolean),
    ),
  ];
  const expectedVersion = Number(formData.get("access_version"));
  const canImportSchedules = formData.get("can_import_schedules") === "true";
  const allowBasicMedicalAccess =
    formData.get("allow_basic_medical_access") === "true";
  const isActive = formData.get("is_active") === "true";

  if (
    !targetId ||
    !email ||
    !/^\S+@\S+\.\S+$/.test(email) ||
    !fullName ||
    !Number.isInteger(expectedVersion) ||
    roles.length === 0 ||
    roomTypeIds.length === 0
  ) {
    return {
      ok: false,
      message: "Vui lòng nhập đủ thông tin, vai trò và phạm vi phụ trách.",
    };
  }

  const { data: current, error: currentError } = await supabase
    .from("profiles")
    .select("email,access_version")
    .eq("id", targetId)
    .maybeSingle();
  if (currentError || !current) {
    return { ok: false, message: "Không tìm thấy nhân sự cần cập nhật." };
  }

  let adminClient;
  try {
    adminClient = createAdminClient();
  } catch {
    return {
      ok: false,
      message:
        "Chưa cấu hình SUPABASE_SECRET_KEY cho thao tác quản trị tài khoản.",
    };
  }

  const rpcInput = {
    target_profile_id: targetId,
    target_email: email,
    target_full_name: fullName,
    target_phone: String(formData.get("phone") ?? "").trim() || null,
    target_title: String(formData.get("title") ?? "").trim() || null,
    target_roles: roles,
    target_can_import_schedules: canImportSchedules,
    target_room_type_ids: roomTypeIds,
    target_email_room_type_ids: roles.includes("viewer")
      ? emailRoomTypeIds
      : [],
    target_allow_basic_medical_access: allowBasicMedicalAccess,
    target_is_active: isActive,
    target_expected_version: expectedVersion,
  };

  const rpcStartedAt = performance.now();
  const { data: operationData, error: beginError } = await supabase.rpc(
    "begin_personnel_update",
    rpcInput,
  );
  if (beginError) {
    return {
      ok: false,
      code: beginError.code,
      message: personnelRpcMessage(beginError.message),
    };
  }
  const operation = operationData as {
    operation_id: string;
    previous_email: string;
    requested_email: string;
    expected_version: number;
  };

  const authStartedAt = performance.now();
  const emailChanged = current.email.trim().toLowerCase() !== email;
  if (emailChanged) {
    const { error: authError } = await adminClient.auth.admin.updateUserById(
      targetId,
      { email, email_confirm: true },
    );
    if (authError) {
      await supabase.rpc("cancel_personnel_update", {
        target_operation_id: operation.operation_id,
      });
      return { ok: false, message: authError.message };
    }
  }
  const { error: markAuthError } = await supabase.rpc(
    "mark_personnel_auth_updated",
    { target_operation_id: operation.operation_id },
  );
  if (markAuthError) {
    if (emailChanged) {
      const { error: rollbackError } =
        await adminClient.auth.admin.updateUserById(targetId, {
          email: operation.previous_email,
          email_confirm: true,
        });
      if (rollbackError) {
        await adminClient
          .from("personnel_update_operations")
          .update({
            status: "reconciliation_required",
            last_error: `${markAuthError.message}; rollback: ${rollbackError.message}`,
          })
          .eq("id", operation.operation_id);
      } else {
        await adminClient.rpc("resolve_personnel_update_operation", {
          target_operation_id: operation.operation_id,
          target_status: "rolled_back",
          target_error: markAuthError.message,
        });
      }
    } else {
      await supabase.rpc("cancel_personnel_update", {
        target_operation_id: operation.operation_id,
      });
    }
    return {
      ok: false,
      code: markAuthError.code,
      message:
        "Không thể xác nhận trạng thái đồng bộ email. Hệ thống đã hoàn tác hoặc chuyển phiếu sang đối soát.",
    };
  }
  const authMs = Math.round(performance.now() - authStartedAt);

  const { data, error } = await supabase.rpc("commit_personnel_update", {
    target_operation_id: operation.operation_id,
  });
  const rpcMs = Math.round(performance.now() - rpcStartedAt);

  if (error) {
    const { data: committedProfile } = await adminClient
      .from("profiles")
      .select("email,access_version")
      .eq("id", targetId)
      .maybeSingle();
    if (
      committedProfile?.email?.trim().toLowerCase() === email &&
      committedProfile.access_version === expectedVersion + 1
    ) {
      const { data: snapshotRows } = await supabase.rpc(
        "admin_list_personnel",
        {
          target_query: email,
          target_role: null,
          target_import_permission: "all",
          target_status: "all",
          target_page: 1,
          target_page_size: 50,
        },
      );
      const personnel = (
        (snapshotRows ?? []) as Array<Record<string, unknown>>
      ).find((row) => row.id === targetId);
      revalidatePath("/admin/personnel");
      return {
        ok: true,
        message:
          "Đã cập nhật nhân sự. Kết quả đã được đối chiếu sau khi phản hồi cơ sở dữ liệu bị gián đoạn.",
        personnel,
      };
    }
    if (emailChanged) {
      const { error: rollbackError } =
        await adminClient.auth.admin.updateUserById(targetId, {
          email: operation.previous_email,
          email_confirm: true,
        });
      if (rollbackError) {
        await adminClient
          .from("profiles")
          .update({ is_active: false })
          .eq("id", targetId);
        await adminClient.from("personnel_auth_reconciliation_logs").insert({
          profile_id: targetId,
          previous_email: operation.previous_email,
          requested_email: email,
          failure_stage: "database_rpc_and_auth_rollback",
          error_message: `${error.message}; rollback: ${rollbackError.message}`,
          created_by: userId,
        });
        await adminClient
          .from("personnel_update_operations")
          .update({
            status: "reconciliation_required",
            last_error: `${error.message}; rollback: ${rollbackError.message}`,
          })
          .eq("id", operation.operation_id);
        return {
          ok: false,
          code: "AUTH_PROFILE_RECONCILIATION_REQUIRED",
          message:
            "Lưu dữ liệu thất bại và không thể hoàn tác email đăng nhập. Hệ thống đã ghi nhận để quản trị viên đối soát.",
        };
      }
      await adminClient.rpc("resolve_personnel_update_operation", {
        target_operation_id: operation.operation_id,
        target_status: "rolled_back",
        target_error: error.message,
      });
    }
    if (!emailChanged) {
      await adminClient
        .from("personnel_update_operations")
        .update({
          status: "expired",
          resolved_at: new Date().toISOString(),
          last_error: error.message,
        })
        .eq("id", operation.operation_id);
    }
    return {
      ok: false,
      code: error.code,
      message: personnelRpcMessage(error.message),
    };
  }

  if (process.env.VERCEL_ENV !== "production") {
    console.info("personnel.save.timing", {
      auth_ms: authMs,
      rpc_ms: rpcMs,
      total_ms: Math.round(performance.now() - startedAt),
    });
  }
  revalidatePath("/admin/personnel");
  return {
    ok: true,
    message: "Đã cập nhật nhân sự.",
    personnel: (data ?? {}) as Record<string, unknown>,
  };
}

/** t4e step 3: let Y cơ sở also book a Skills lab room, or stop it. */
export async function setRoomSharedWithBasicMedical(formData: FormData) {
  const { supabase } = await adminContext();
  const shared = String(formData.get("shared")) === "true";
  const { error } = await supabase.rpc("set_room_shared_with_basic_medical", {
    p_room_id: String(formData.get("id") ?? ""),
    p_shared: shared,
  });
  if (error)
    catalogRedirect(
      "/admin/rooms",
      "error",
      error.hint || "Không thể cập nhật phòng dùng chung.",
    );
  revalidatePath("/admin/rooms");
  catalogRedirect(
    "/admin/rooms",
    "notice",
    shared ? "Đã cho Y cơ sở dùng chung phòng." : "Đã bỏ dùng chung phòng.",
  );
}
