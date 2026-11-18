"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  equipmentImportDateTime,
  equipmentRequestCreatedAtFromCode,
  getEquipmentImportFormatIssues,
  normalizeEquipmentImportRow,
  normalizeEquipmentLookupKey,
  normalizeEquipmentRequestCode,
  normalizeEquipmentRoom,
  normalizeEquipmentStatus,
  type EquipmentImportRow,
} from "@/lib/equipment-import-values";
import { formatEquipmentRequestCode } from "@/lib/equipment-request-code";
import { normalizeCourseLookupKey } from "@/lib/import-values";
import { NURSING_SKILLS_ROOM_TYPE_ID } from "@/lib/room-types";
import { createClient } from "@/lib/supabase/server";

export type EquipmentImportValidationStatus =
  "valid" | "warning" | "error" | "duplicate";

export type EquipmentImportValidationResult = {
  ok: boolean;
  message: string;
  totalRows: number;
  totalRequests: number;
  creatableRequests: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  duplicateRows: number;
  normalizedRows: EquipmentImportRow[];
  rows: Array<{
    rowNumber: number;
    requestCode: string;
    status: EquipmentImportValidationStatus;
    errors: string[];
    warnings: string[];
  }>;
};

export type EquipmentImportResult = {
  ok: boolean;
  message: string;
  batchId?: string;
  totalRows?: number;
  totalRequests?: number;
  importedRows?: number;
  importedRequests?: number;
  errorRows?: number;
  warningRows?: number;
  duplicateRows?: number;
  durationMs?: number;
  issues?: Array<{
    rowNumber: number;
    requestCode: string;
    errors: string[];
    warnings: string[];
  }>;
};

type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
};

type Schedule = {
  id: string;
  course_code_snapshot: string;
  schedule_date: string;
  start_time: string;
  schedule_status: string;
  semester: string | null;
  rooms: {
    room_code: string;
    building_code: string;
    room_type_id: string;
  } | null;
};

type CatalogItem = {
  id: string;
  item_name: string;
  commercial_name: string | null;
  model: string | null;
  is_active: boolean;
};

type PreparedRequest = {
  requestCode: string;
  rowNumbers: number[];
  status: EquipmentImportValidationStatus;
  errors: string[];
  warnings: string[];
  payload: Record<string, unknown> | null;
};

type PreparedImport = {
  validation: EquipmentImportValidationResult;
  requests: PreparedRequest[];
};

const sharedRequestFields = [
  "registrant_name",
  "registrant_email",
  "phone",
  "responsible_name",
  "responsible_email",
  "course_code",
  "semester",
  "schedule_date",
  "class_start_time",
  "room",
  "receive_date",
  "receive_time",
  "return_date",
  "return_time",
  "status",
  "request_note",
] as const;

function emptyValidation(message: string): EquipmentImportValidationResult {
  return {
    ok: false,
    message,
    totalRows: 0,
    totalRequests: 0,
    creatableRequests: 0,
    validRows: 0,
    warningRows: 0,
    errorRows: 0,
    duplicateRows: 0,
    normalizedRows: [],
    rows: [],
  };
}

function parseRows(inputRowsJson: string) {
  try {
    const value = JSON.parse(inputRowsJson) as unknown;
    if (
      !Array.isArray(value) ||
      value.some((row) => !row || typeof row !== "object" || Array.isArray(row))
    ) {
      return null;
    }
    return (value as EquipmentImportRow[]).map(normalizeEquipmentImportRow);
  } catch {
    return null;
  }
}

function addToDirectory<T>(directory: Map<string, T[]>, key: string, row: T) {
  if (!key) return;
  directory.set(key, [...(directory.get(key) ?? []), row]);
}

function resolveProfile(
  email: unknown,
  name: unknown,
  byEmail: Map<string, Profile>,
  byName: Map<string, Profile[]>,
) {
  const normalizedEmail = String(email ?? "")
    .trim()
    .toLowerCase();
  if (normalizedEmail) {
    return {
      profile: byEmail.get(normalizedEmail) ?? null,
      ambiguous: false,
      matchedBy: "email" as const,
    };
  }
  const matches = byName.get(normalizeEquipmentLookupKey(name)) ?? [];
  return {
    profile: matches.length === 1 ? matches[0] : null,
    ambiguous: matches.length > 1,
    matchedBy: "name" as const,
  };
}

function scheduleKey(
  courseCode: unknown,
  date: unknown,
  startTime: unknown,
  room: unknown,
) {
  return [
    normalizeCourseLookupKey(courseCode),
    String(date ?? ""),
    String(startTime ?? "").slice(0, 5),
    normalizeEquipmentRoom(room),
  ].join("|");
}

function catalogExactKey(item: {
  item_name?: unknown;
  commercial_name?: unknown;
  model?: unknown;
}) {
  return [item.item_name, item.commercial_name, item.model]
    .map(normalizeEquipmentLookupKey)
    .join("|");
}

async function prepareEquipmentImport(
  inputRowsJson: string,
): Promise<PreparedImport> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) {
    return {
      validation: emptyValidation("Phiên đăng nhập đã hết hạn."),
      requests: [],
    };
  }

  const rows = parseRows(inputRowsJson);
  if (!rows) {
    return {
      validation: emptyValidation(
        "Dữ liệu import không hợp lệ. Vui lòng đọc lại file.",
      ),
      requests: [],
    };
  }
  if (rows.length === 0) {
    return {
      validation: emptyValidation("File không có dòng dữ liệu nào."),
      requests: [],
    };
  }
  if (rows.length > 500) {
    return {
      validation: emptyValidation("Mỗi lần import tối đa 500 dòng."),
      requests: [],
    };
  }

  const { data: roleRows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (!(roleRows ?? []).some(({ role }) => ["admin", "staff"].includes(role))) {
    return {
      validation: emptyValidation(
        "Chỉ Quản trị viên hoặc Chuyên viên được import phiếu thiết bị.",
      ),
      requests: [],
    };
  }

  const validDates = rows
    .map((row) => String(row.schedule_date ?? ""))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  const scheduleQuery = supabase
    .from("class_schedules")
    .select(
      "id,course_code_snapshot,schedule_date,start_time,schedule_status,semester,rooms!inner(room_code,building_code,room_type_id)",
    )
    .eq("rooms.room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
    .is("basic_medical_registration_id", null)
    .neq("schedule_status", "cancelled");
  if (validDates.length) {
    scheduleQuery
      .gte("schedule_date", validDates[0])
      .lte("schedule_date", validDates.at(-1)!);
  } else {
    scheduleQuery.limit(0);
  }

  const [
    { data: profileRows },
    { data: lecturerRows },
    { data: scheduleRows },
    { data: catalogRows },
    { data: existingRows },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,full_name,email,phone")
      .eq("is_active", true),
    supabase.rpc("list_scoped_lecturers", {
      target_room_type_id: NURSING_SKILLS_ROOM_TYPE_ID,
    }),
    scheduleQuery,
    supabase
      .from("equipment_catalog")
      .select("id,item_name,commercial_name,model,is_active"),
    supabase
      .from("equipment_requests")
      .select("id,class_schedule_id,created_at")
      .limit(5000),
  ]);

  const profiles = (profileRows ?? []) as Profile[];
  const lecturers = (lecturerRows ?? []) as Profile[];
  const schedules = (scheduleRows ?? []) as unknown as Schedule[];
  const catalog = (catalogRows ?? []) as CatalogItem[];
  const profileByEmail = new Map<string, Profile>();
  for (const profile of profiles) {
    const normalized = profile.email?.trim().toLowerCase();
    if (normalized) {
      profileByEmail.set(normalized, profile);
    }
  }
  const profileByName = new Map<string, Profile[]>();
  for (const profile of profiles) {
    addToDirectory(
      profileByName,
      normalizeEquipmentLookupKey(profile.full_name),
      profile,
    );
  }
  // list_scoped_lecturers returns no email, so take it from the profile rows.
  const lecturerIds = new Set(lecturers.map(({ id }) => id));
  const lecturerByEmail = new Map<string, Profile>();
  for (const profile of profiles) {
    const normalized = profile.email?.trim().toLowerCase();
    if (normalized && lecturerIds.has(profile.id)) {
      lecturerByEmail.set(normalized, profile);
    }
  }
  const lecturerByName = new Map<string, Profile[]>();
  for (const profile of lecturers) {
    addToDirectory(
      lecturerByName,
      normalizeEquipmentLookupKey(profile.full_name),
      profile,
    );
  }

  const schedulesByKey = new Map<string, Schedule[]>();
  for (const schedule of schedules) {
    if (!schedule.rooms) continue;
    addToDirectory(
      schedulesByKey,
      scheduleKey(
        schedule.course_code_snapshot,
        schedule.schedule_date,
        schedule.start_time,
        `${schedule.rooms.room_code}.${schedule.rooms.building_code}`,
      ),
      schedule,
    );
  }
  const catalogByExact = new Map<string, CatalogItem[]>();
  const catalogByName = new Map<string, CatalogItem[]>();
  for (const item of catalog) {
    addToDirectory(catalogByExact, catalogExactKey(item), item);
    addToDirectory(
      catalogByName,
      normalizeEquipmentLookupKey(item.item_name),
      item,
    );
  }
  const occupiedSchedules = new Set(
    (existingRows ?? []).map(({ class_schedule_id }) => class_schedule_id),
  );
  const existingCodes = new Set(
    (existingRows ?? []).map(({ created_at }) =>
      formatEquipmentRequestCode(created_at),
    ),
  );

  const grouped = new Map<
    string,
    Array<{ row: EquipmentImportRow; index: number }>
  >();
  rows.forEach((row, index) => {
    const code =
      normalizeEquipmentRequestCode(row.source_code) || `__row_${index}`;
    grouped.set(code, [...(grouped.get(code) ?? []), { row, index }]);
  });

  const reviews = rows.map((row, index) => ({
    rowNumber: index + 2,
    requestCode: normalizeEquipmentRequestCode(row.source_code),
    status: "valid" as EquipmentImportValidationStatus,
    errors: getEquipmentImportFormatIssues(row).map(({ message }) => message),
    warnings: [] as string[],
  }));
  const preparedRequests: PreparedRequest[] = [];

  for (const [requestCode, entries] of grouped) {
    const first = entries[0].row;
    const groupErrors: string[] = [];
    const groupWarnings: string[] = [];
    const rowNumbers = entries.map(({ index }) => index + 2);
    const inconsistent = sharedRequestFields.filter((field) => {
      const reference = String(first[field] ?? "");
      return entries.some(({ row }) => String(row[field] ?? "") !== reference);
    });
    if (inconsistent.length) {
      groupErrors.push(
        "Thông tin chung không thống nhất giữa các dòng cùng mã phiếu",
      );
    }

    const scheduleMatches =
      schedulesByKey.get(
        scheduleKey(
          first.course_code,
          first.schedule_date,
          first.class_start_time,
          first.room,
        ),
      ) ?? [];
    const schedule = scheduleMatches.length === 1 ? scheduleMatches[0] : null;
    if (scheduleMatches.length === 0) {
      groupErrors.push(
        `Không tìm thấy lớp ${String(first.course_code)} · ${String(first.schedule_date)} · ${String(first.class_start_time)} · ${String(first.room)}`,
      );
    } else if (scheduleMatches.length > 1) {
      groupErrors.push(
        "Thông tin lớp khớp nhiều lịch; cần bổ sung dữ liệu phân biệt",
      );
    } else if (
      !schedule?.semester ||
      !["HK1", "HK2", "HK3", "HK4"].includes(schedule.semester)
    ) {
      groupErrors.push(
        `Lớp ${String(first.course_code)} · ${String(first.schedule_date)} chưa có thông tin Học kỳ hợp lệ trong lịch`,
      );
    } else if (
      first.semester &&
      String(first.semester).trim().toUpperCase() !== schedule.semester
    ) {
      groupWarnings.push(
        `Học kỳ trong file (${String(first.semester)}) khác lịch học (${schedule.semester}); hệ thống sử dụng học kỳ của lịch học (${schedule.semester})`,
      );
    }

    const registrantMatch = resolveProfile(
      first.registrant_email,
      first.registrant_name,
      profileByEmail,
      profileByName,
    );
    if (!registrantMatch.profile) {
      groupErrors.push(
        registrantMatch.ambiguous
          ? "Tên người đăng ký trùng nhiều nhân sự; hãy nhập email"
          : "Không tìm thấy người đăng ký trong Nhân sự",
      );
    } else if (!registrantMatch.profile.email?.trim()) {
      groupErrors.push("Người đăng ký chưa có email trong hồ sơ Nhân sự");
    }
    const responsibleMatch = resolveProfile(
      first.responsible_email,
      first.responsible_name,
      lecturerByEmail,
      lecturerByName,
    );
    let responsible = responsibleMatch.profile;
    const registrantEmail = registrantMatch.profile?.email
      ?.trim()
      .toLowerCase();
    if (
      !responsible &&
      registrantMatch.profile &&
      ((first.responsible_email &&
        registrantEmail &&
        String(first.responsible_email).trim().toLowerCase() ===
          registrantEmail) ||
        (!first.responsible_email &&
          normalizeEquipmentLookupKey(first.responsible_name) ===
            normalizeEquipmentLookupKey(registrantMatch.profile.full_name)))
    ) {
      responsible = registrantMatch.profile;
    }
    if (!responsible) {
      groupErrors.push(
        responsibleMatch.ambiguous
          ? "Tên giảng viên phụ trách trùng nhiều nhân sự; hãy nhập email"
          : "Không tìm thấy giảng viên phụ trách thuộc Kỹ năng Điều dưỡng",
      );
    }

    const phone = String(first.phone || registrantMatch.profile?.phone || "");
    if (!/^\d{10}$/.test(phone)) {
      groupErrors.push("Số điện thoại người đăng ký phải có đúng 10 chữ số");
    }
    if (
      first.phone &&
      registrantMatch.profile?.phone &&
      first.phone !== registrantMatch.profile.phone
    ) {
      groupWarnings.push(
        "Số điện thoại khác hồ sơ Nhân sự; giữ số trong file làm dữ liệu phiếu",
      );
    }

    const createdAt = equipmentRequestCreatedAtFromCode(requestCode);
    const receiveAt = equipmentImportDateTime(
      first.receive_date,
      first.receive_time,
    );
    const returnAt = equipmentImportDateTime(
      first.return_date,
      first.return_time,
    );
    const status = normalizeEquipmentStatus(first.status);
    const resolvedItems: Array<Record<string, unknown>> = [];
    for (const { row, index } of entries) {
      const hasQualifier = Boolean(row.commercial_name || row.model);
      const matches = hasQualifier
        ? (catalogByExact.get(catalogExactKey(row)) ?? [])
        : (catalogByName.get(normalizeEquipmentLookupKey(row.item_name)) ?? []);
      const item = matches.length === 1 ? matches[0] : null;
      if (!item) {
        reviews[index].errors.push(
          matches.length > 1
            ? "Tên thiết bị khớp nhiều dòng Danh mục; hãy nhập Tên thương mại và Model"
            : "Không tìm thấy thiết bị trong Danh mục thiết bị",
        );
      } else {
        if (!item.is_active) {
          reviews[index].warnings.push(
            "Thiết bị đang ngừng sử dụng; vẫn được nhập để lưu dữ liệu cũ",
          );
        }
        resolvedItems.push({
          catalog_item_id: item.id,
          skill_name: String(row.skill_name),
          quantity: Number(row.quantity),
          note: String(row.item_note || "") || null,
        });
      }
    }

    const anyRowErrors = entries.some(
      ({ index }) => reviews[index].errors.length > 0,
    );
    const duplicate = Boolean(
      !anyRowErrors &&
      !groupErrors.length &&
      schedule &&
      (occupiedSchedules.has(schedule.id) || existingCodes.has(requestCode)),
    );
    if (duplicate) {
      groupErrors.push(
        occupiedSchedules.has(schedule!.id)
          ? "Lớp này đã có phiếu thiết bị"
          : "Mã phiếu đã tồn tại",
      );
    }
    const allWarnings = [
      ...groupWarnings,
      ...entries.flatMap(({ index }) => reviews[index].warnings),
    ];
    const finalStatus: EquipmentImportValidationStatus = duplicate
      ? "duplicate"
      : anyRowErrors || groupErrors.length > 0
        ? "error"
        : allWarnings.length > 0
          ? "warning"
          : "valid";
    for (const { index } of entries) {
      reviews[index].status = finalStatus;
      reviews[index].errors.push(...groupErrors);
      reviews[index].warnings.push(...groupWarnings);
    }

    const payload =
      (finalStatus === "valid" || finalStatus === "warning") &&
      schedule &&
      registrantMatch.profile &&
      responsible &&
      createdAt &&
      receiveAt &&
      returnAt &&
      status
        ? {
            source_code: requestCode,
            class_schedule_id: schedule.id,
            semester: schedule.semester,
            registrant_id: registrantMatch.profile.id,
            responsible_lecturer_id: responsible.id,
            phone_snapshot: phone,
            email_snapshot: registrantMatch.profile.email?.trim() ?? "",
            receive_at: receiveAt,
            return_at: returnAt,
            status,
            note: String(first.request_note || "") || null,
            created_at: createdAt,
            items: resolvedItems,
          }
        : null;
    preparedRequests.push({
      requestCode,
      rowNumbers,
      status: finalStatus,
      errors: [...new Set(groupErrors)],
      warnings: [...new Set(allWarnings)],
      payload,
    });
  }

  const validRows = reviews.filter(({ status }) => status === "valid").length;
  const warningRows = reviews.filter(
    ({ status }) => status === "warning",
  ).length;
  const errorRows = reviews.filter(({ status }) => status === "error").length;
  const duplicateRows = reviews.filter(
    ({ status }) => status === "duplicate",
  ).length;
  const creatableRequests = preparedRequests.filter(
    ({ status }) => status === "valid" || status === "warning",
  ).length;
  return {
    validation: {
      ok: true,
      message: `Đã kiểm tra ${rows.length} dòng thuộc ${preparedRequests.length} phiếu. Có ${creatableRequests} phiếu có thể tạo.`,
      totalRows: rows.length,
      totalRequests: preparedRequests.length,
      creatableRequests,
      validRows,
      warningRows,
      errorRows,
      duplicateRows,
      normalizedRows: rows,
      rows: reviews.map((review) => ({
        ...review,
        errors: [...new Set(review.errors)],
        warnings: [...new Set(review.warnings)],
      })),
    },
    requests: preparedRequests,
  };
}

export async function validateEquipmentImportRows(
  inputRowsJson: string,
): Promise<EquipmentImportValidationResult> {
  return (await prepareEquipmentImport(inputRowsJson)).validation;
}

export async function importEquipmentRequestRows(
  _fileName: string,
  inputRowsJson: string,
): Promise<EquipmentImportResult> {
  const startedAt = Date.now();
  const prepared = await prepareEquipmentImport(inputRowsJson);
  if (!prepared.validation.ok) {
    return { ok: false, message: prepared.validation.message };
  }
  const creatable = prepared.requests.filter(({ payload }) => payload);
  if (!creatable.length) {
    return { ok: false, message: "Không có phiếu hợp lệ để import." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_equipment_requests", {
    target_requests: creatable.map(({ payload }) => payload),
  });
  if (error || !Array.isArray(data)) {
    return {
      ok: false,
      message: error?.message || "Không thể tạo các phiếu thiết bị.",
    };
  }

  const outcomes = data as Array<{
    source_code?: string;
    ok?: boolean;
    request_id?: string;
    message?: string;
  }>;
  const outcomeByCode = new Map(
    outcomes.map((outcome) => [String(outcome.source_code), outcome]),
  );
  const successful = creatable.filter(
    ({ requestCode }) => outcomeByCode.get(requestCode)?.ok === true,
  );
  const failed = creatable.filter(
    ({ requestCode }) => outcomeByCode.get(requestCode)?.ok !== true,
  );
  const importedRows = successful.reduce(
    (total, request) => total + request.rowNumbers.length,
    0,
  );
  const validationIssues = prepared.validation.rows
    .filter(({ errors, warnings }) => errors.length || warnings.length)
    .map(({ rowNumber, requestCode, errors, warnings }) => ({
      rowNumber,
      requestCode,
      errors,
      warnings,
    }));
  const runtimeIssues = failed.map((request) => ({
    rowNumber: request.rowNumbers[0],
    requestCode: request.requestCode,
    errors: [
      outcomeByCode.get(request.requestCode)?.message ||
        "Không thể tạo phiếu thiết bị",
    ],
    warnings: [],
  }));

  revalidatePath("/equipment/requests");
  revalidatePath("/equipment/mine");
  revalidatePath("/class-schedules");

  const importedRequests = successful.length;
  return {
    ok: importedRequests > 0,
    message: `Đã tạo ${importedRequests} phiếu với ${importedRows} dòng thiết bị từ ${prepared.validation.totalRequests} phiếu trong file.`,
    batchId: randomUUID(),
    totalRows: prepared.validation.totalRows,
    totalRequests: prepared.validation.totalRequests,
    importedRows,
    importedRequests,
    errorRows: prepared.validation.errorRows + runtimeIssues.length,
    warningRows: prepared.validation.warningRows,
    duplicateRows: prepared.validation.duplicateRows,
    durationMs: Date.now() - startedAt,
    issues: [...validationIssues, ...runtimeIssues],
  };
}
