"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { processPendingScheduleEmails } from "@/lib/email-notifications";
import {
  normalizeCourseLookupKey,
  normalizeImportDate,
  normalizeImportRowValues,
  normalizeImportTime,
  normalizeLecturerLookupKey,
} from "@/lib/import-values";
import { createClient } from "@/lib/supabase/server";
import { isWithinOperatingHours } from "@/lib/business-time";
import { roomTypeIdForScope, type ScheduleScope } from "@/lib/room-types";
import { createImportScheduleHash } from "@/lib/import-schedule-hash";
import {
  classifyImportPreviewCandidate,
  classifyImportPreviewCandidatesInOrder,
  type ExistingScheduleForPreview,
} from "@/lib/import-preview-conflicts";
import { isCanonicalSemester } from "@/lib/semesters";

type ImportRow = Record<string, unknown>;
type ImportLecturer = {
  id: string;
  full_name: string;
  email: string;
};

export type ImportResult = {
  ok: boolean;
  message: string;
  batchId?: string;
  semester?: string;
  totalRows?: number;
  importedRows?: number;
  errorRows?: number;
  warningRows?: number;
  duplicateRows?: number;
  conflictRows?: number;
  durationMs?: number;
  issues?: Array<{
    rowNumber: number;
    errors: string[];
    warnings: string[];
  }>;
};

export type ImportValidationStatus =
  "valid" | "warning" | "error" | "duplicate" | "conflict";

export type ImportValidationResult = {
  ok: boolean;
  message: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  duplicateRows: number;
  conflictRows: number;
  normalizedRows: ImportRow[];
  rows: Array<{
    rowNumber: number;
    status: ImportValidationStatus;
    errors: string[];
    warnings: string[];
  }>;
};

function text(row: ImportRow, key: string): string {
  return String(row[key] ?? "").trim();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await task(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function invalidValidation(message: string): ImportValidationResult {
  return {
    ok: false,
    message,
    totalRows: 0,
    validRows: 0,
    warningRows: 0,
    errorRows: 0,
    duplicateRows: 0,
    conflictRows: 0,
    normalizedRows: [],
    rows: [],
  };
}

function parseImportRows(inputRowsJson: string): ImportRow[] | null {
  try {
    const parsed = JSON.parse(inputRowsJson) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (row) => !row || typeof row !== "object" || Array.isArray(row),
      )
    ) {
      return null;
    }
    return (parsed as ImportRow[]).map(normalizeImportRowValues);
  } catch {
    return null;
  }
}

export async function validateScheduleRows(
  inputRowsJson: string,
  scope: ScheduleScope = "skills_lab",
  semester?: string,
): Promise<ImportValidationResult> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return invalidValidation("Phiên đăng nhập đã hết hạn.");

  if (scope === "skills_lab") {
    if (!semester || !isCanonicalSemester(semester)) {
      return invalidValidation(
        "Học kỳ không hợp lệ hoặc chưa được chọn. Vui lòng chọn học kỳ trước khi import.",
      );
    }
  }

  const inputRows = parseImportRows(inputRowsJson);
  if (!inputRows) {
    return invalidValidation(
      "Dữ liệu import không hợp lệ. Vui lòng đọc lại file.",
    );
  }
  if (inputRows.length === 0)
    return invalidValidation("File không có dòng dữ liệu nào.");
  if (inputRows.length > 500)
    return invalidValidation("Mỗi lần import tối đa 500 dòng.");
  const roomTypeId = roomTypeIdForScope(scope);

  const [
    { data: roleRows },
    { data: importerProfile },
    { data: courses },
    { data: rooms },
    { data: lecturers },
  ] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase
      .from("profiles")
      .select("can_import_schedules")
      .eq("id", userId)
      .single(),
    supabase
      .from("courses")
      .select("id, course_code, course_name")
      .eq("is_active", true)
      .eq("room_type_id", roomTypeId),
    supabase
      .from("rooms")
      .select("id, room_code, building_code, room_type_id")
      .eq("is_active", true)
      .eq("room_type_id", roomTypeId),
    supabase.rpc("list_scoped_import_lecturers", {
      target_room_type_id: roomTypeId,
    }),
  ]);

  const roles = (roleRows ?? []).map(({ role }) => role);
  if (
    !roles.includes("admin") &&
    !(
      importerProfile?.can_import_schedules &&
      roles.some((role) =>
        ["staff", "lecturer", "teaching_assistant"].includes(role),
      )
    )
  ) {
    return invalidValidation("Bạn không có quyền import lịch.");
  }

  const courseMap = new Map(
    (courses ?? []).map((course) => [
      normalizeCourseLookupKey(course.course_code),
      course,
    ]),
  );
  const roomMap = new Map(
    (rooms ?? []).map((room) => [
      `${room.room_code.trim().toUpperCase()}|${room.building_code.trim().toUpperCase()}`,
      room,
    ]),
  );
  const lecturerDirectory = (lecturers ?? []) as ImportLecturer[];
  const lecturerByEmail = new Map(
    lecturerDirectory.map((profile) => [
      profile.email.trim().toLowerCase(),
      profile,
    ]),
  );
  const lecturerNames = new Map<string, ImportLecturer[]>();
  for (const profile of lecturerDirectory) {
    const key = normalizeLecturerLookupKey(profile.full_name);
    lecturerNames.set(key, [...(lecturerNames.get(key) ?? []), profile]);
  }

  const preparedRows = inputRows.map((row, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const scheduleDate = normalizeImportDate(row.schedule_date);
    const startTime = normalizeImportTime(row.start_time);
    const endTime = normalizeImportTime(row.end_time);
    const courseCode = text(row, "course_code").toUpperCase();
    const courseName = text(row, "course_name");
    const roomCode = text(row, "room_code").toUpperCase();
    const buildingCode = text(row, "building_code").toUpperCase();
    const course = courseMap.get(normalizeCourseLookupKey(courseCode));
    const room = roomMap.get(`${roomCode}|${buildingCode}`);
    const studentCount = Number(text(row, "student_count"));

    if (!scheduleDate) errors.push("Ngày học không hợp lệ");
    if (
      !startTime ||
      !endTime ||
      (startTime && endTime && endTime <= startTime)
    ) {
      errors.push("Khoảng thời gian không hợp lệ");
    } else if (!isWithinOperatingHours(startTime, endTime)) {
      errors.push(
        "Thời gian phải nằm trong ca sáng 07:30–11:30 hoặc ca chiều 12:30–16:30",
      );
    }
    if (!courseCode) errors.push("Thiếu mã môn học");
    if (!courseName) errors.push("Thiếu tên môn học");
    if (!course && courseCode && courseName) {
      warnings.push("Môn học mới cần admin xác nhận trong danh mục");
    } else if (
      course &&
      courseName &&
      course.course_name.trim().toLocaleLowerCase("vi") !==
        courseName.toLocaleLowerCase("vi")
    ) {
      warnings.push("Tên môn học khác danh mục; sử dụng tên trong danh mục");
    }
    if (!room) errors.push(`Không tìm thấy phòng ${roomCode}.${buildingCode}`);
    if (!Number.isInteger(studentCount) || studentCount < 1)
      errors.push("Số sinh viên phải là số nguyên từ 1 trở lên");

    const lecturerEmail = text(row, "lecturer_email").toLowerCase();
    const lecturerName = normalizeLecturerLookupKey(text(row, "lecturer_name"));
    const nameMatches = lecturerName
      ? (lecturerNames.get(lecturerName) ?? [])
      : [];
    const requestedLecturer =
      (lecturerEmail && lecturerByEmail.get(lecturerEmail)) ||
      (nameMatches.length === 1 ? nameMatches[0] : null) ||
      null;
    if (!lecturerEmail && requestedLecturer) {
      row.lecturer_email = requestedLecturer.email;
    }
    if (lecturerName && nameMatches.length > 1 && !lecturerEmail) {
      warnings.push("Tên giảng viên trùng nhiều nhân sự; phiếu được để trống");
    }
    if ((lecturerEmail || lecturerName) && !requestedLecturer) {
      warnings.push(
        "Không tìm thấy giảng viên; phiếu được để trống người phụ trách",
      );
    }
    const normalizedData = {
      schedule_date: scheduleDate,
      start_time: startTime,
      end_time: endTime,
      course_code: courseCode,
      room_code: roomCode,
      building_code: buildingCode,
      class_code: null,
      lecturer_id: requestedLecturer?.id ?? null,
      student_count: studentCount,
      note: text(row, "note") || null,
    };
    const rowHash = room
      ? createImportScheduleHash({
          courseCode,
          roomId: room.id,
          scheduleDate: scheduleDate ?? "",
          startTime: startTime ?? "",
          endTime: endTime ?? "",
        })
      : createHash("sha256")
          .update(JSON.stringify(normalizedData))
          .digest("hex");
    return {
      courseCode,
      duplicateWithinFile: false,
      endTime,
      errors,
      index,
      lecturerId: requestedLecturer?.id ?? null,
      roomId: room?.id ?? null,
      rowHash,
      scheduleDate,
      startTime,
      warnings,
    };
  });

  const hashesToCheck = [
    ...new Set(
      preparedRows
        .filter(({ duplicateWithinFile }) => !duplicateWithinFile)
        .map(({ rowHash }) => rowHash),
    ),
  ];
  const { data: existingHashes, error: duplicateCheckError } =
    await supabase.rpc("find_existing_import_hashes", {
      target_hashes: hashesToCheck,
      target_room_type_id: roomTypeId,
    });
  const existingHashSet = new Set(
    ((existingHashes ?? []) as Array<{ normalized_row_hash: string }>).map(
      ({ normalized_row_hash }) => normalized_row_hash,
    ),
  );
  if (duplicateCheckError) {
    for (const prepared of preparedRows) {
      prepared.errors.push("Không thể kiểm tra dữ liệu trùng");
    }
  }
  const remoteDuplicates = preparedRows.map(
    ({ rowHash }) => !duplicateCheckError && existingHashSet.has(rowHash),
  );

  const comparableRows = preparedRows.filter(
    (row) => row.roomId && row.scheduleDate && row.startTime && row.endTime,
  );
  const roomIds = [
    ...new Set(comparableRows.map(({ roomId }) => roomId as string)),
  ];
  const lecturerIds = [
    ...new Set(
      comparableRows
        .map(({ lecturerId }) => lecturerId)
        .filter((lecturerId): lecturerId is string => Boolean(lecturerId)),
    ),
  ];
  const scheduleDates = comparableRows
    .map(({ scheduleDate }) => scheduleDate as string)
    .sort();
  let existingSchedules: ExistingScheduleForPreview[] = [];
  let scheduleCheckFailed = false;
  if (roomIds.length && scheduleDates.length) {
    const select =
      "course_code_snapshot,room_id,schedule_date,start_time,end_time,lecturer_id,lecturer_2_id";
    const roomQuery = supabase
      .from("class_schedules")
      .select(select)
      .in("room_id", roomIds)
      .gte("schedule_date", scheduleDates[0])
      .lte("schedule_date", scheduleDates.at(-1) as string)
      .neq("schedule_status", "cancelled");
    const lecturerQuery = lecturerIds.length
      ? supabase
          .from("class_schedules")
          .select(select)
          .or(
            `lecturer_id.in.(${lecturerIds.join(",")}),lecturer_2_id.in.(${lecturerIds.join(",")})`,
          )
          .gte("schedule_date", scheduleDates[0])
          .lte("schedule_date", scheduleDates.at(-1) as string)
          .neq("schedule_status", "cancelled")
      : null;
    const [roomResult, lecturerResult] = await Promise.all([
      roomQuery,
      lecturerQuery,
    ]);
    scheduleCheckFailed = Boolean(roomResult.error || lecturerResult?.error);
    existingSchedules = [
      ...(roomResult.data ?? []),
      ...(lecturerResult?.data ?? []),
    ] as ExistingScheduleForPreview[];
  }

  const scheduleChecks = preparedRows.map((prepared) =>
    scheduleCheckFailed
      ? { conflict: false, duplicate: false }
      : classifyImportPreviewCandidate(prepared, existingSchedules),
  );
  if (scheduleCheckFailed) {
    for (const prepared of preparedRows) {
      prepared.errors.push("Không thể kiểm tra lịch tạo tay và lịch đang mở");
    }
  }

  const intraFileChecks = classifyImportPreviewCandidatesInOrder(
    preparedRows.map((prepared, index) => ({
      ...prepared,
      eligible:
        prepared.errors.length === 0 &&
        !remoteDuplicates[index] &&
        !scheduleChecks[index].duplicate &&
        !scheduleChecks[index].conflict,
    })),
  );

  const validationRows = preparedRows.map((prepared, index) => {
    const duplicate =
      intraFileChecks[index].duplicate ||
      remoteDuplicates[index] ||
      scheduleChecks[index].duplicate;
    const conflict =
      !duplicate &&
      (scheduleChecks[index].conflict || intraFileChecks[index].conflict);
    if (duplicate) {
      prepared.errors.push(
        intraFileChecks[index].duplicate
          ? "Dòng trùng với một dòng khác trong cùng file"
          : "Lịch trùng với lịch đã có (tạo tay hoặc import)",
      );
    } else if (conflict) {
      prepared.errors.push(
        intraFileChecks[index].conflict
          ? "Lịch xung đột phòng hoặc giảng viên với dòng trước trong cùng file"
          : "Lịch xung đột phòng hoặc giảng viên với lịch đã có",
      );
    }
    const status: ImportValidationStatus = duplicate
      ? "duplicate"
      : conflict
        ? "conflict"
        : prepared.errors.length > 0
          ? "error"
          : prepared.warnings.length > 0
            ? "warning"
            : "valid";
    return {
      rowNumber: prepared.index + 2,
      status,
      errors: prepared.errors,
      warnings: prepared.warnings,
    };
  });

  const validRows = validationRows.filter(
    ({ status }) => status === "valid",
  ).length;
  const warningRows = validationRows.filter(
    ({ status }) => status === "warning",
  ).length;
  const errorRows = validationRows.filter(
    ({ status }) => status === "error",
  ).length;
  const duplicateRows = validationRows.filter(
    ({ status }) => status === "duplicate",
  ).length;
  const conflictRows = validationRows.filter(
    ({ status }) => status === "conflict",
  ).length;
  return {
    ok: true,
    message: `Đã kiểm tra ${inputRows.length} dòng. Có ${validRows + warningRows} dòng có thể tạo lịch.`,
    totalRows: inputRows.length,
    validRows,
    warningRows,
    errorRows,
    duplicateRows,
    conflictRows,
    normalizedRows: inputRows,
    rows: validationRows,
  };
}

export async function importScheduleRows(
  fileName: string,
  inputRowsJson: string,
  scope: ScheduleScope = "skills_lab",
  semester?: string,
): Promise<ImportResult> {
  const startedAt = Date.now();
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) {
    return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  }

  if (scope === "skills_lab") {
    if (!semester || !isCanonicalSemester(semester)) {
      return {
        ok: false,
        message:
          "Học kỳ không hợp lệ hoặc chưa được chọn. Vui lòng chọn học kỳ trước khi import.",
      };
    }
  }

  let inputRows: ImportRow[];
  try {
    const parsed = JSON.parse(inputRowsJson) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (row) => !row || typeof row !== "object" || Array.isArray(row),
      )
    ) {
      throw new Error("INVALID_IMPORT_PAYLOAD");
    }
    inputRows = (parsed as ImportRow[]).map(normalizeImportRowValues);
  } catch {
    return {
      ok: false,
      message: "Dữ liệu import không hợp lệ. Vui lòng đọc lại file.",
    };
  }
  if (inputRows.length === 0) {
    return { ok: false, message: "File không có dòng dữ liệu nào." };
  }
  if (inputRows.length > 500) {
    return { ok: false, message: "Mỗi lần import tối đa 500 dòng." };
  }
  const roomTypeId = roomTypeIdForScope(scope);

  const [
    { data: roleRows },
    { data: importerProfile },
    { data: courses },
    { data: rooms },
    { data: lecturers },
  ] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase
      .from("profiles")
      .select("can_import_schedules")
      .eq("id", userId)
      .single(),
    supabase
      .from("courses")
      .select("id, course_code, course_name")
      .eq("is_active", true)
      .eq("room_type_id", roomTypeId),
    supabase
      .from("rooms")
      .select("id, room_code, building_code, room_type_id")
      .eq("is_active", true)
      .eq("room_type_id", roomTypeId),
    supabase.rpc("list_scoped_import_lecturers", {
      target_room_type_id: roomTypeId,
    }),
  ]);

  const roles = (roleRows ?? []).map(({ role }) => role);
  if (
    !roles.includes("admin") &&
    !(
      importerProfile?.can_import_schedules &&
      roles.some((role) =>
        ["staff", "lecturer", "teaching_assistant"].includes(role),
      )
    )
  ) {
    return { ok: false, message: "Bạn không có quyền import lịch." };
  }

  const courseMap = new Map(
    (courses ?? []).map((course) => [
      normalizeCourseLookupKey(course.course_code),
      course,
    ]),
  );
  const roomMap = new Map(
    (rooms ?? []).map((room) => [
      `${room.room_code.trim().toUpperCase()}|${room.building_code.trim().toUpperCase()}`,
      room,
    ]),
  );
  const lecturerDirectory = (lecturers ?? []) as ImportLecturer[];
  const lecturerByEmail = new Map(
    lecturerDirectory.map((profile) => [
      profile.email.trim().toLowerCase(),
      profile,
    ]),
  );
  const lecturerNames = new Map<string, ImportLecturer[]>();
  for (const profile of lecturerDirectory) {
    const key = normalizeLecturerLookupKey(profile.full_name);
    lecturerNames.set(key, [...(lecturerNames.get(key) ?? []), profile]);
  }

  const fileHash = createHash("sha256")
    .update(`${fileName}\n${JSON.stringify(inputRows)}`)
    .digest("hex");
  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({
      source_type: "import",
      original_file_name: fileName.slice(0, 255) || "import.xlsx",
      file_hash: fileHash,
      status: "importing",
      total_rows: inputRows.length,
      created_by: userId,
      room_type_id: roomTypeId,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return { ok: false, message: "Không thể tạo phiên import." };
  }

  const seenHashes = new Set<string>();
  const preparedRows = inputRows.map((row, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const scheduleDate = normalizeImportDate(row.schedule_date);
    const startTime = normalizeImportTime(row.start_time);
    const endTime = normalizeImportTime(row.end_time);
    const courseCode = text(row, "course_code").toUpperCase();
    const courseName = text(row, "course_name");
    const roomCode = text(row, "room_code").toUpperCase();
    const buildingCode = text(row, "building_code").toUpperCase();
    const course = courseMap.get(normalizeCourseLookupKey(courseCode));
    const room = roomMap.get(`${roomCode}|${buildingCode}`);
    const studentCount = Number(text(row, "student_count"));

    if (!scheduleDate) errors.push("Ngày học không hợp lệ");
    if (
      !startTime ||
      !endTime ||
      (startTime && endTime && endTime <= startTime)
    ) {
      errors.push("Khoảng thời gian không hợp lệ");
    } else if (!isWithinOperatingHours(startTime, endTime)) {
      errors.push(
        "Thời gian phải nằm trong ca sáng 07:30–11:30 hoặc ca chiều 12:30–16:30",
      );
    }
    if (!courseCode) errors.push("Thiếu mã môn học");
    if (!courseName) errors.push("Thiếu tên môn học");
    if (!course && courseCode && courseName) {
      warnings.push("Môn học mới cần admin xác nhận trong danh mục");
    } else if (
      course &&
      courseName &&
      course.course_name.trim().toLocaleLowerCase("vi") !==
        courseName.toLocaleLowerCase("vi")
    ) {
      warnings.push("Tên môn học khác danh mục; sử dụng tên trong danh mục");
    }
    if (!room) errors.push(`Không tìm thấy phòng ${roomCode}.${buildingCode}`);
    if (!Number.isInteger(studentCount) || studentCount < 1)
      errors.push("Số sinh viên phải là số nguyên từ 1 trở lên");

    const lecturerEmail = text(row, "lecturer_email").toLowerCase();
    const lecturerName = normalizeLecturerLookupKey(text(row, "lecturer_name"));
    const nameMatches = lecturerName
      ? (lecturerNames.get(lecturerName) ?? [])
      : [];
    const requestedLecturer =
      (lecturerEmail && lecturerByEmail.get(lecturerEmail)) ||
      (nameMatches.length === 1 ? nameMatches[0] : null) ||
      null;
    if (lecturerName && nameMatches.length > 1 && !lecturerEmail) {
      warnings.push("Tên giảng viên trùng nhiều nhân sự; phiếu được để trống");
    }
    if ((lecturerEmail || lecturerName) && !requestedLecturer) {
      warnings.push(
        "Không tìm thấy giảng viên; phiếu được để trống người phụ trách",
      );
    }
    const normalizedData = {
      schedule_date: scheduleDate,
      start_time: startTime,
      end_time: endTime,
      course_code: courseCode,
      room_code: roomCode,
      building_code: buildingCode,
      class_code: null,
      lecturer_id: requestedLecturer?.id ?? null,
      student_count: studentCount,
      note: text(row, "note") || null,
    };
    const rowHash = room
      ? createImportScheduleHash({
          courseCode,
          roomId: room.id,
          scheduleDate: scheduleDate ?? "",
          startTime: startTime ?? "",
          endTime: endTime ?? "",
        })
      : createHash("sha256")
          .update(JSON.stringify(normalizedData))
          .digest("hex");
    const duplicateWithinFile = seenHashes.has(rowHash);
    seenHashes.add(rowHash);

    return {
      course,
      courseCode,
      courseName,
      duplicateWithinFile,
      endTime,
      errors,
      index,
      normalizedData,
      requestedLecturer,
      room,
      row,
      rowHash,
      scheduleDate,
      startTime,
      warnings,
      studentCount,
    };
  });

  const hashesToCheck = [
    ...new Set(
      preparedRows
        .filter(({ duplicateWithinFile }) => !duplicateWithinFile)
        .map(({ rowHash }) => rowHash),
    ),
  ];
  const { data: existingHashes, error: duplicateCheckError } =
    await supabase.rpc("find_existing_import_hashes", {
      target_hashes: hashesToCheck,
      target_room_type_id: roomTypeId,
    });
  const existingHashSet = new Set(
    ((existingHashes ?? []) as Array<{ normalized_row_hash: string }>).map(
      ({ normalized_row_hash }) => normalized_row_hash,
    ),
  );
  if (duplicateCheckError) {
    for (const prepared of preparedRows) {
      prepared.errors.push("Không thể kiểm tra dữ liệu trùng");
    }
  }
  const remoteDuplicateChecks = preparedRows.map(
    ({ rowHash }) => !duplicateCheckError && existingHashSet.has(rowHash),
  );

  const outcomes = await mapWithConcurrency(
    preparedRows,
    6,
    async (prepared, index) => {
      const {
        course,
        courseCode,
        courseName,
        endTime,
        errors,
        normalizedData,
        requestedLecturer,
        room,
        row,
        rowHash,
        scheduleDate,
        startTime,
        warnings,
        studentCount,
      } = prepared;
      const duplicate =
        prepared.duplicateWithinFile || remoteDuplicateChecks[index];

      let scheduleId: string | null = null;
      let validationStatus:
        | "imported"
        | "warning"
        | "error"
        | "duplicate"
        | "conflict"
        | "system_error";
      if (duplicate) {
        validationStatus = "duplicate";
        errors.push(
          prepared.duplicateWithinFile
            ? "Dòng trùng với một dòng khác trong cùng file"
            : "Lịch này đã được import trước đó",
        );
      } else if (
        errors.length > 0 ||
        !room ||
        !scheduleDate ||
        !startTime ||
        !endTime
      ) {
        validationStatus = "error";
      } else {
        const requestedStatus = warnings.length > 0 ? "warning" : "imported";
        const { data: createdScheduleId, error: scheduleError } =
          await supabase.rpc("create_import_schedule_row", {
            target_batch_id: batch.id,
            target_row_number: prepared.index + 2,
            target_hash: rowHash,
            target_raw: row,
            target_normalized: normalizedData,
            target_status: requestedStatus,
            target_errors: errors,
            target_warnings: warnings,
            target_course_id: course?.id ?? null,
            target_course_code: course?.course_code ?? courseCode,
            target_course_name: course?.course_name ?? courseName,
            target_room_id: room.id,
            target_lecturer_id: requestedLecturer?.id ?? null,
            target_date: scheduleDate,
            target_start: startTime,
            target_end: endTime,
            target_note: text(row, "note") || null,
            target_student_count: studentCount,
            target_semester: scope === "skills_lab" ? semester : null,
          });

        if (scheduleError || !createdScheduleId) {
          if (scheduleError?.code === "23505") {
            errors.push("Lịch trùng business key với dữ liệu đã có");
            validationStatus = "duplicate";
          } else if (scheduleError?.code === "23P01") {
            errors.push("Xung đột phòng hoặc lịch giảng viên");
            validationStatus = "conflict";
          } else if (scheduleError?.code === "23514") {
            errors.push("Thời gian nằm ngoài khung hoạt động");
            validationStatus = "error";
          } else {
            errors.push("Không thể tạo lịch");
            validationStatus = "system_error";
          }
        } else {
          scheduleId = String(createdScheduleId);
          validationStatus = requestedStatus;
        }
      }

      let fatal = false;
      if (!scheduleId) {
        const { error: rowError } = await supabase.rpc(
          "record_import_validation_row",
          {
            target_batch_id: batch.id,
            target_row_number: prepared.index + 2,
            target_hash: rowHash,
            target_raw: row,
            target_normalized: normalizedData,
            target_status: validationStatus,
            target_errors: errors,
            target_warnings: warnings,
          },
        );
        if (rowError) {
          errors.push("Không thể ghi nhận kết quả kiểm tra của dòng");
          fatal = true;
        }
      }
      return {
        errors,
        fatal,
        rowNumber: prepared.index + 2,
        status: validationStatus,
        warnings,
      };
    },
  );

  const importedRows = outcomes.filter(
    ({ status }) => status === "imported" || status === "warning",
  ).length;
  const errorRows = outcomes.filter(({ status }) => status === "error").length;
  const warningRows = outcomes.filter(
    ({ status }) => status === "warning",
  ).length;
  const duplicateRows = outcomes.filter(
    ({ status }) => status === "duplicate",
  ).length;
  const conflictRows = outcomes.filter(
    ({ status }) => status === "conflict",
  ).length;
  const systemErrorRows = outcomes.filter(
    ({ status }) => status === "system_error",
  ).length;
  const issues = outcomes
    .filter(({ errors, warnings }) => errors.length > 0 || warnings.length > 0)
    .map(({ rowNumber, errors, warnings }) => ({ rowNumber, errors, warnings }))
    .sort((left, right) => left.rowNumber - right.rowNumber);

  if (outcomes.some(({ fatal }) => fatal)) {
    await supabase.rpc("finalize_import_batch", {
      target_batch_id: batch.id,
    });
    return {
      ok: false,
      message:
        "Phiên import đã dừng vì không thể ghi nhận kết quả của một số dòng. Hãy tải file lỗi hoặc thử lại.",
      batchId: batch.id,
      totalRows: inputRows.length,
      importedRows,
      errorRows: errorRows + systemErrorRows,
      warningRows,
      duplicateRows,
      conflictRows,
      durationMs: Date.now() - startedAt,
      issues,
    };
  }

  const { data: finishData, error: finishError } = await supabase.rpc(
    "finalize_import_batch",
    { target_batch_id: batch.id },
  );

  if (finishError) {
    return {
      ok: false,
      message: "Dữ liệu đã xử lý nhưng không thể chốt phiên import.",
      batchId: batch.id,
      durationMs: Date.now() - startedAt,
      issues,
    };
  }

  // Use DB-computed counts from the RPC; fall back to application counts if
  // the response shape is unexpected (e.g. during a schema migration window).
  const dbCounts = finishData as Record<string, number> | null;
  const finalImported = dbCounts?.imported ?? importedRows;
  const finalErrors = dbCounts
    ? (dbCounts.errors ?? 0) + (dbCounts.system_errors ?? 0)
    : errorRows + systemErrorRows;
  const finalWarnings = dbCounts?.warnings ?? warningRows;
  const finalDuplicates = dbCounts?.duplicates ?? duplicateRows;
  const finalConflicts = dbCounts?.conflicts ?? conflictRows;

  revalidatePath("/dashboard");
  revalidatePath("/class-schedules");
  revalidatePath("/imports");
  revalidatePath("/basic-medical/schedules");
  after(processPendingScheduleEmails);
  return {
    ok: true,
    message: `Đã tạo ${finalImported} lịch từ ${inputRows.length} dòng.`,
    batchId: batch.id,
    semester: scope === "skills_lab" ? semester : undefined,
    totalRows: inputRows.length,
    importedRows: finalImported,
    errorRows: finalErrors,
    warningRows: finalWarnings,
    duplicateRows: finalDuplicates,
    conflictRows: finalConflicts,
    durationMs: Date.now() - startedAt,
    issues,
  };
}
