"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { processPendingScheduleEmails } from "@/lib/email-notifications";
import { processPendingEmailOutbox } from "@/lib/equipment-request-emails";
import { businessTodayString } from "@/lib/business-time";
import {
  equipmentHandoffTimes,
  equipmentLeadTime,
  equipmentReceiveAt,
} from "@/lib/equipment-lead-time";

function registrationsUrl(kind: "notice" | "error", message: string) {
  return `/basic-medical/registrations?${kind}=${encodeURIComponent(message)}`;
}

export type BasicMedicalEquipmentRequestActionState = {
  ok: boolean;
  message: string;
  requestId?: string;
};

const uuidPattern = /^[0-9a-f-]{36}$/i;

type BasicMedicalEquipmentSource = {
  id: string;
  class_schedule_id: string;
  lesson_title: string;
  cancelled_at: string | null;
  registration: { semester: string; cancelled_at: string | null } | null;
  schedule: { schedule_date: string; schedule_status: string } | null;
};

function basicMedicalEquipmentRequestError(
  error?: {
    code?: string;
    message?: string;
  } | null,
) {
  if (error?.code === "23505") {
    return "Buổi học này đã có phiếu đăng ký thiết bị.";
  }
  const source = error?.message ?? "";
  if (source.includes("ROOT_ADMIN_OPERATIONAL_ASSIGNMENT_FORBIDDEN")) {
    return "Buổi học đang phân công Root Admin làm giảng viên. Vui lòng điều chỉnh giảng viên giảng dạy/hướng dẫn trước khi đăng ký thiết bị.";
  }
  if (
    source.includes("EQUIPMENT_REQUEST_SOURCE_NOT_AVAILABLE") ||
    source.includes("BASIC_MEDICAL_SESSION_CANCELLED") ||
    source.includes("REGISTRATION_CANCELLED")
  ) {
    return "Buổi học Y cơ sở đã hủy hoặc không còn hợp lệ để đăng ký thiết bị.";
  }
  if (
    error?.code === "42501" ||
    source.includes("EQUIPMENT_REQUEST_BASIC_MEDICAL_SCOPE_REQUIRED") ||
    source.includes("EQUIPMENT_REQUEST_SCOPE_REQUIRED")
  ) {
    return "Bạn không có quyền đăng ký thiết bị cho buổi học Y cơ sở này.";
  }
  if (source.includes("EQUIPMENT_REQUEST_PHONE_REQUIRED")) {
    return "Hồ sơ Nhân sự chưa có số điện thoại 10 chữ số.";
  }
  if (source.includes("EQUIPMENT_REQUEST_BASIC_MEDICAL_CATALOG_REQUIRED")) {
    return "Thiết bị đã chọn không còn hoạt động trong Danh mục Y cơ sở.";
  }
  if (
    source.includes("EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY")
  ) {
    return "Cùng một tên thương mại thiết bị đã được đăng ký trong bài TN-TH này.";
  }
  return "Không thể tạo phiếu đăng ký thiết bị Y cơ sở.";
}

export async function createBasicMedicalEquipmentRequest(
  _state: BasicMedicalEquipmentRequestActionState,
  formData: FormData,
): Promise<BasicMedicalEquipmentRequestActionState> {
  const sessionId = String(formData.get("session_id") ?? "");
  const receiveDate = String(formData.get("receive_date") ?? "");
  const receiveTime = String(formData.get("receive_time") ?? "");
  const returnDate = String(formData.get("return_date") ?? "");
  const returnTime = String(formData.get("return_time") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const lateRegistrationReason = String(
    formData.get("late_registration_reason") ?? "",
  ).trim();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  let items: Array<{ catalogItemId: string; quantity: number; note?: string }>;

  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { ok: false, message: "Danh sách thiết bị không hợp lệ." };
  }

  if (
    !uuidPattern.test(sessionId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(receiveDate) ||
    !/^\d{2}:\d{2}$/.test(receiveTime) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(returnDate) ||
    !/^\d{2}:\d{2}$/.test(returnTime) ||
    !Array.isArray(items) ||
    !items.length ||
    items.some(
      (item) =>
        !item ||
        !uuidPattern.test(item.catalogItemId) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1,
    )
  ) {
    return {
      ok: false,
      message: "Vui lòng kiểm tra buổi học, thời gian và danh sách thiết bị.",
    };
  }

  const [{ data: profile }, { data: sourceRow, error: sourceError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("phone,is_active")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("basic_medical_registration_sessions")
        .select(
          "id,class_schedule_id,lesson_title,cancelled_at,registration:basic_medical_registrations!inner(semester,cancelled_at),schedule:class_schedules!inner(schedule_date,schedule_status)",
        )
        .eq("id", sessionId)
        .maybeSingle(),
    ]);
  const source = sourceRow as unknown as BasicMedicalEquipmentSource | null;
  if (
    sourceError ||
    !source ||
    !source.registration ||
    !source.schedule ||
    source.cancelled_at ||
    source.registration?.cancelled_at ||
    source.schedule?.schedule_status === "cancelled"
  ) {
    return {
      ok: false,
      message:
        "Buổi học Y cơ sở đã hủy hoặc không còn hợp lệ để đăng ký thiết bị.",
    };
  }
  if (!profile?.is_active || !/^\d{10}$/.test(profile.phone ?? "")) {
    return {
      ok: false,
      message: "Hồ sơ Nhân sự chưa có số điện thoại 10 chữ số.",
    };
  }

  const receiveAt = equipmentReceiveAt(receiveDate, receiveTime);
  const returnAt = new Date(`${returnDate}T${returnTime}:00+07:00`);
  if (
    !receiveAt ||
    Number.isNaN(returnAt.getTime()) ||
    !equipmentHandoffTimes.includes(
      receiveTime as (typeof equipmentHandoffTimes)[number],
    ) ||
    !equipmentHandoffTimes.includes(
      returnTime as (typeof equipmentHandoffTimes)[number],
    ) ||
    returnAt < receiveAt
  ) {
    return { ok: false, message: "Giờ nhận và giờ trả không hợp lệ." };
  }
  if (
    receiveDate < businessTodayString() ||
    receiveDate > source.schedule!.schedule_date ||
    returnDate < source.schedule!.schedule_date
  ) {
    return {
      ok: false,
      message: "Ngày nhận/trả phải tuân theo ngày học Y cơ sở.",
    };
  }
  const leadTime = equipmentLeadTime(receiveAt);
  if (leadTime.isExpired) {
    return {
      ok: false,
      message: "Thời gian nhận thiết bị phải sau thời điểm đăng ký.",
    };
  }
  if (leadTime.requiresLateApproval && !lateRegistrationReason) {
    return { ok: false, message: "Vui lòng nhập Lý do đăng ký trễ." };
  }

  const catalogIds = [...new Set(items.map((item) => item.catalogItemId))];
  const { data: catalogRows } = await supabase
    .from("basic_medical_equipment_catalog")
    .select("id")
    .in("id", catalogIds)
    .eq("is_active", true);
  if ((catalogRows ?? []).length !== catalogIds.length) {
    return {
      ok: false,
      message: "Thiết bị đã chọn không còn hoạt động trong Danh mục Y cơ sở.",
    };
  }

  const { data: requestId, error } = await supabase.rpc(
    "create_equipment_request_with_items",
    {
      target_class_schedule_id: source.class_schedule_id,
      target_semester: source.registration!.semester,
      target_responsible_lecturer_id: null,
      target_receive_at: receiveAt.toISOString(),
      target_return_at: returnAt.toISOString(),
      target_note: note || null,
      target_late_registration_reason: lateRegistrationReason || null,
      target_items: items.map((item) => ({
        skill_name: source.lesson_title,
        catalog_item_id: item.catalogItemId,
        quantity: item.quantity,
        note: item.note?.trim() || null,
      })),
    },
  );
  if (error || !requestId) {
    return { ok: false, message: basicMedicalEquipmentRequestError(error) };
  }

  after(() => processPendingEmailOutbox());
  revalidatePath("/basic-medical/registrations");
  revalidatePath("/basic-medical/equipment-requests");
  revalidatePath("/equipment/requests");
  return {
    ok: true,
    message: leadTime.requiresLateApproval
      ? "Đã gửi yêu cầu duyệt đăng ký trễ."
      : "Đã tạo phiếu đăng ký thiết bị Y cơ sở.",
    requestId: requestId as string,
  };
}

export async function updateBasicMedicalEquipmentRequest(
  _state: BasicMedicalEquipmentRequestActionState,
  formData: FormData,
): Promise<BasicMedicalEquipmentRequestActionState> {
  const requestId = String(formData.get("request_id") ?? "");
  const receiveDate = String(formData.get("receive_date") ?? "");
  const receiveTime = String(formData.get("receive_time") ?? "");
  const returnDate = String(formData.get("return_date") ?? "");
  const returnTime = String(formData.get("return_time") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const lateRegistrationReason = String(
    formData.get("late_registration_reason") ?? "",
  ).trim();
  let items: Array<{
    id?: string;
    catalogItemId: string;
    quantity: number;
    note?: string;
  }>;
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { ok: false, message: "Danh sách thiết bị không hợp lệ." };
  }
  if (
    !uuidPattern.test(requestId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(receiveDate) ||
    !/^\d{2}:\d{2}$/.test(receiveTime) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(returnDate) ||
    !/^\d{2}:\d{2}$/.test(returnTime) ||
    !Array.isArray(items) ||
    !items.length ||
    items.some(
      (item) =>
        !item ||
        !uuidPattern.test(item.catalogItemId) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1,
    )
  ) {
    return {
      ok: false,
      message: "Vui lòng kiểm tra thời gian và danh sách thiết bị.",
    };
  }

  const receiveAt = equipmentReceiveAt(receiveDate, receiveTime);
  const returnAt = new Date(`${returnDate}T${returnTime}:00+07:00`);
  if (
    !receiveAt ||
    Number.isNaN(returnAt.getTime()) ||
    !equipmentHandoffTimes.includes(
      receiveTime as (typeof equipmentHandoffTimes)[number],
    ) ||
    !equipmentHandoffTimes.includes(
      returnTime as (typeof equipmentHandoffTimes)[number],
    ) ||
    returnAt < receiveAt ||
    receiveDate < businessTodayString()
  ) {
    return { ok: false, message: "Giờ nhận và giờ trả không hợp lệ." };
  }
  const leadTime = equipmentLeadTime(receiveAt);
  if (leadTime.isExpired) {
    return {
      ok: false,
      message: "Thời gian nhận thiết bị phải sau thời điểm đăng ký.",
    };
  }
  if (leadTime.requiresLateApproval && !lateRegistrationReason) {
    return { ok: false, message: "Vui lòng nhập Lý do đăng ký trễ." };
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  }
  const { data: updatedId, error } = await supabase.rpc(
    "update_basic_medical_equipment_request_content",
    {
      target_request_id: requestId,
      target_receive_at: receiveAt.toISOString(),
      target_return_at: returnAt.toISOString(),
      target_note: note || null,
      target_late_registration_reason: lateRegistrationReason || null,
      target_items: items.map((item) => ({
        id: item.id,
        expected_revision: Number(formData.get("expected_revision")),
        catalog_item_id: item.catalogItemId,
        quantity: item.quantity,
        note: item.note?.trim() || null,
      })),
    },
  );
  if (error || !updatedId) {
    if (
      error?.message?.includes(
        "EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY",
      )
    ) {
      return {
        ok: false,
        message:
          "Cùng một tên thương mại thiết bị đã được đăng ký trong bài TN-TH này.",
      };
    }
    const source = error?.message ?? "";
    return {
      ok: false,
      message: source.includes("BASIC_MEDICAL_EQUIPMENT_EDIT_STATUS")
        ? "Chỉ có thể điều chỉnh phiếu trạng thái Mới hoặc Đã soạn."
        : source.includes("BASIC_MEDICAL_EQUIPMENT_EDIT_FORBIDDEN") ||
            error?.code === "42501"
          ? "Bạn không có quyền điều chỉnh phiếu Y cơ sở này."
          : source.includes("BASIC_MEDICAL_SESSION_CANCELLED") ||
              source.includes("REGISTRATION_CANCELLED")
            ? "Buổi học Y cơ sở đã hủy hoặc không còn hợp lệ."
            : source.includes(
                  "EQUIPMENT_REQUEST_BASIC_MEDICAL_CATALOG_REQUIRED",
                )
              ? "Thiết bị đã chọn không còn hoạt động trong Danh mục Y cơ sở."
              : "Không thể lưu nội dung điều chỉnh phiếu Y cơ sở.",
    };
  }

  after(() => processPendingEmailOutbox());
  revalidatePath("/basic-medical/equipment-requests");
  revalidatePath("/basic-medical/registrations");
  revalidatePath("/equipment/requests");
  return {
    ok: true,
    message: leadTime.requiresLateApproval
      ? "Đã gửi yêu cầu duyệt đăng ký trễ. ID và trạng thái phiếu được giữ nguyên."
      : "Đã lưu điều chỉnh. ID và trạng thái phiếu được giữ nguyên.",
    requestId: updatedId as string,
  };
}

export async function cancelBasicMedicalSession(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(sessionId) || !reason) {
    redirect(registrationsUrl("error", "Buổi học Y cơ sở không hợp lệ."));
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_basic_medical_session", {
    target_session_id: sessionId,
    target_reason: reason,
  });
  if (error) {
    const message = error.message.includes("INVALIDATION_REQUIRED")
      ? "Buổi học đã được xác nhận. Hãy vô hiệu hóa xác nhận trước khi hủy."
      : "Không thể hủy buổi học đã chọn.";
    redirect(registrationsUrl("error", message));
  }
  after(processPendingScheduleEmails);
  revalidatePath("/basic-medical/registrations");
  revalidatePath("/basic-medical/schedules");
  revalidatePath("/class-schedules");
  redirect(registrationsUrl("notice", "Đã hủy đúng một buổi học Y cơ sở."));
}

export async function updateBasicMedicalSessionTeachingLecturer(
  formData: FormData,
) {
  const sessionId = String(formData.get("session_id") ?? "");
  const teachingLecturerId = String(formData.get("teaching_lecturer_id") ?? "");
  if (
    !/^[0-9a-f-]{36}$/i.test(sessionId) ||
    !/^[0-9a-f-]{36}$/i.test(teachingLecturerId)
  ) {
    redirect(
      registrationsUrl(
        "error",
        "Thông tin buổi học hoặc giảng viên không hợp lệ.",
      ),
    );
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) {
    redirect(registrationsUrl("error", "Phiên đăng nhập đã hết hạn."));
  }

  const { error } = await supabase.rpc(
    "update_basic_medical_session_teaching_lecturer",
    {
      target_session_id: sessionId,
      target_teaching_lecturer_id: teachingLecturerId,
    },
  );

  if (error) {
    const message = error.message.includes("UPDATE_FORBIDDEN")
      ? "Chỉ người tạo phiếu hoặc Admin được thay đổi giảng viên."
      : error.message.includes("INVALID_LECTURER")
        ? "Giảng viên không hợp lệ hoặc không thuộc phạm vi Y cơ sở."
        : error.message.includes("BASIC_MEDICAL_SESSION_CANCELLED") ||
            error.message.includes("REGISTRATION_CANCELLED")
          ? "Buổi học đã hủy, không thể thay đổi giảng viên."
          : "Không thể cập nhật giảng viên giảng dạy/hướng dẫn.";
    redirect(registrationsUrl("error", message));
  }

  revalidatePath("/basic-medical/registrations");
  revalidatePath("/basic-medical/schedules");
  revalidatePath("/class-schedules");
  redirect(
    registrationsUrl("notice", "Đã cập nhật giảng viên giảng dạy/hướng dẫn."),
  );
}

export async function invalidateBasicMedicalSessionConfirmation(
  formData: FormData,
) {
  const confirmationId = String(formData.get("confirmation_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(confirmationId) || !reason) {
    redirect(registrationsUrl("error", "Vui lòng nhập Lý do vô hiệu hóa."));
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc(
    "invalidate_basic_medical_session_confirmation",
    { target_confirmation_id: confirmationId, target_reason: reason },
  );
  if (error) {
    redirect(registrationsUrl("error", "Không thể vô hiệu hóa xác nhận."));
  }
  revalidatePath("/basic-medical/registrations");
  revalidatePath(
    `/basic-medical/registrations/confirmations/${confirmationId}`,
  );
  redirect(
    registrationsUrl(
      "notice",
      "Đã vô hiệu hóa xác nhận; bằng chứng gốc được giữ nguyên.",
    ),
  );
}

export async function cancelBasicMedicalRegistration(formData: FormData) {
  const registrationId = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(registrationId)) {
    redirect(registrationsUrl("error", "Phiếu Y cơ sở không hợp lệ."));
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) {
    redirect(registrationsUrl("error", "Phiên đăng nhập đã hết hạn."));
  }

  const { data: authority, error: authorityError } = await supabase.rpc(
    "get_basic_medical_authority_context",
  );
  if (
    authorityError ||
    !(authority as { can_manage_basic_medical?: boolean } | null)
      ?.can_manage_basic_medical
  ) {
    redirect(
      registrationsUrl(
        "error",
        "Chỉ Admin hoặc Chuyên viên được hủy phiếu Y cơ sở.",
      ),
    );
  }

  const reason = String(formData.get("reason") ?? "").trim();
  const { data, error } = await supabase.rpc(
    "cancel_basic_medical_registration",
    {
      target_registration_id: registrationId,
      target_reason: reason || null,
    },
  );

  if (error || !data) {
    redirect(
      registrationsUrl(
        "error",
        "Không thể hủy phiếu Y cơ sở. Phiếu có thể đã được hủy.",
      ),
    );
  }

  after(processPendingScheduleEmails);

  revalidatePath("/basic-medical/registrations");
  revalidatePath("/basic-medical/schedules");
  revalidatePath("/class-schedules");
  redirect(registrationsUrl("notice", "Đã hủy phiếu Y cơ sở."));
}

export type ConfirmBasicMedicalSessionResult = {
  ok: boolean;
  message: string;
  confirmationId?: string;
  signedAt?: string;
};

export async function confirmBasicMedicalSession({
  sessionId,
  signatureData,
  checks,
}: {
  sessionId: string;
  signatureData: string;
  checks: Array<{
    inventoryId: string;
    newlyDamagedQuantity: number;
    expectedCatalogItemId: string;
    expectedTotalQuantity: number;
    expectedGoodQuantity: number;
    expectedDamagedQuantity: number;
    expectedItemName: string;
    expectedCommercialName: string | null;
    expectedUnit: string;
  }>;
}): Promise<ConfirmBasicMedicalSessionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) {
    return { ok: false, message: "Buổi học không hợp lệ." };
  }
  if (
    !signatureData.startsWith("data:image/png;base64,") ||
    signatureData.length < 100 ||
    signatureData.length > 400_000
  ) {
    return { ok: false, message: "Chữ ký điện tử không hợp lệ." };
  }
  if (
    checks.some(
      ({
        inventoryId,
        newlyDamagedQuantity,
        expectedCatalogItemId,
        expectedTotalQuantity,
        expectedGoodQuantity,
        expectedDamagedQuantity,
        expectedItemName,
        expectedCommercialName,
        expectedUnit,
      }) =>
        !/^[0-9a-f-]{36}$/i.test(inventoryId) ||
        !/^[0-9a-f-]{36}$/i.test(expectedCatalogItemId) ||
        !Number.isInteger(newlyDamagedQuantity) ||
        newlyDamagedQuantity < 0 ||
        newlyDamagedQuantity > 2_147_483_647 ||
        !Number.isInteger(expectedTotalQuantity) ||
        !Number.isInteger(expectedGoodQuantity) ||
        !Number.isInteger(expectedDamagedQuantity) ||
        expectedTotalQuantity < 0 ||
        expectedTotalQuantity > 2_147_483_647 ||
        expectedGoodQuantity < 0 ||
        expectedGoodQuantity > 2_147_483_647 ||
        expectedDamagedQuantity < 0 ||
        expectedDamagedQuantity > 2_147_483_647 ||
        newlyDamagedQuantity > expectedGoodQuantity ||
        !expectedItemName ||
        (expectedCommercialName !== null &&
          typeof expectedCommercialName !== "string") ||
        !expectedUnit,
    )
  ) {
    return { ok: false, message: "Tình trạng thiết bị không hợp lệ." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_basic_medical_session", {
    target_session_id: sessionId,
    target_signature_data: signatureData,
    target_checks: checks.map((check) => ({
      inventory_id: check.inventoryId,
      newly_damaged_quantity: check.newlyDamagedQuantity,
      expected_catalog_item_id: check.expectedCatalogItemId,
      expected_total_quantity: check.expectedTotalQuantity,
      expected_good_quantity: check.expectedGoodQuantity,
      expected_damaged_quantity: check.expectedDamagedQuantity,
      expected_item_name: check.expectedItemName,
      expected_commercial_name: check.expectedCommercialName,
      expected_unit: check.expectedUnit,
    })),
  });
  if (error) return { ok: false, message: error.message };

  const result = data as unknown as {
    confirmation_id: string;
    signed_at: string;
    damaged_items?: unknown[];
  };
  const damagedItems = result.damaged_items ?? [];
  after(processPendingScheduleEmails);
  revalidatePath("/basic-medical/registrations");
  revalidatePath("/basic-medical/equipment");
  return {
    ok: true,
    message: damagedItems.length
      ? "Đã ký xác nhận và ghi nhận thiết bị hư."
      : "Đã ký xác nhận buổi học.",
    confirmationId: result.confirmation_id,
    signedAt: result.signed_at,
  };
}
