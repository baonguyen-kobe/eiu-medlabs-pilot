"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { processPendingEmailOutbox } from "@/lib/equipment-request-emails";
import { businessTodayString } from "@/lib/business-time";
import {
  equipmentLeadTime,
  equipmentReceiveAt,
  equipmentHandoffTimes,
} from "@/lib/equipment-lead-time";
import {
  equipmentRequestWorkflowStatuses,
  usesInventoryFulfillment,
  type EquipmentConfirmationState,
  type EquipmentRequestListItem,
  type EquipmentRequestStatus,
  type EquipmentRequestWorkflowStatus,
} from "@/lib/equipment-requests";
import { NURSING_SKILLS_ROOM_TYPE_ID } from "@/lib/room-types";
import { isCanonicalSemester } from "@/lib/semesters";
import { createClient } from "@/lib/supabase/server";

export type EquipmentActionState = {
  ok: boolean;
  message: string;
  data?: EquipmentConfirmationState;
};

export type EquipmentItemActionState = {
  ok: boolean;
  message: string;
  item?: EquipmentRequestListItem["equipment_request_items"][number];
};

const duplicateCommercialNameInActivityMessage =
  "Cùng một tên thương mại thiết bị đã được đăng ký trong kỹ năng/bài thực hành này.";

function toEquipmentConfirmationState(
  row: Record<string, unknown>,
): EquipmentConfirmationState {
  return {
    status: row.status as EquipmentRequestStatus,
    late_approval_status:
      row.late_approval_status as EquipmentConfirmationState["late_approval_status"],
    late_registration_reason: (row.late_registration_reason as string) ?? null,
    late_requested_at: (row.late_requested_at as string) ?? null,
    late_reviewed_at: (row.late_reviewed_at as string) ?? null,
    late_review_note: (row.late_review_note as string) ?? null,
    handover_staff_confirmed_at:
      (row.handover_staff_confirmed_at as string) ?? null,
    handover_recipient_signed_at:
      (row.handover_recipient_signed_at as string) ?? null,
    handover_effective_at: (row.handover_effective_at as string) ?? null,
    return_staff_confirmed_at:
      (row.return_staff_confirmed_at as string) ?? null,
    return_recipient_signed_at:
      (row.return_recipient_signed_at as string) ?? null,
    return_effective_at: (row.return_effective_at as string) ?? null,
  };
}

async function legacyConfirmationError(
  supabase: SupabaseClient,
  requestId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("equipment_requests")
    .select("request_domain,has_inventory_preparation")
    .eq("id", requestId)
    .maybeSingle();
  if (error || !data) {
    return error?.message || "Không tìm thấy phiếu thiết bị.";
  }
  const request = data as Pick<
    EquipmentRequestListItem,
    "request_domain" | "has_inventory_preparation"
  >;
  return usesInventoryFulfillment(request)
    ? "Phiếu đã có chuẩn bị kho. Vui lòng mở Bàn giao, thu hồi và ký xác nhận để ghi nhận theo từng lần."
    : null;
}

export async function addEquipmentRequestItem({
  requestId,
  skillName,
  catalogItemId,
  quantity,
  note,
}: {
  requestId: string;
  skillName: string;
  catalogItemId: string;
  quantity: number;
  note?: string;
}): Promise<EquipmentItemActionState> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  const uuidPattern = /^[0-9a-f-]{36}$/i;
  const normalizedSkillName = skillName.trim();
  const normalizedNote = note?.trim() || null;

  if (!userId) return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  if (
    !uuidPattern.test(requestId) ||
    !uuidPattern.test(catalogItemId) ||
    !normalizedSkillName ||
    !Number.isInteger(quantity) ||
    quantity < 1
  ) {
    return { ok: false, message: "Dòng thiết bị bổ sung không hợp lệ." };
  }

  const [{ data: roleRows }, { data: request }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase
      .from("equipment_requests")
      .select("id,status,request_domain")
      .eq("id", requestId)
      .maybeSingle(),
  ]);

  if (!(roleRows ?? []).some(({ role }) => ["admin", "staff"].includes(role))) {
    return {
      ok: false,
      message: "Chỉ Admin hoặc Chuyên viên được bổ sung thiết bị.",
    };
  }
  if (!request || !["new", "preparing"].includes(request.status)) {
    return {
      ok: false,
      message:
        "Chỉ được bổ sung thiết bị khi phiếu ở trạng thái Mới hoặc Đã soạn.",
    };
  }
  if (request.request_domain !== "nursing_skills") {
    return {
      ok: false,
      message:
        "Chỉ có thể bổ sung thiết bị cho phiếu Kỹ năng Điều dưỡng trong không gian quản lý này.",
    };
  }

  const { data: newItemId, error } = await supabase.rpc(
    "add_equipment_request_item",
    {
      target_request_id: requestId,
      target_skill_name: normalizedSkillName,
      target_catalog_item_id: catalogItemId,
      target_quantity: quantity,
      target_note: normalizedNote,
    },
  );
  if (error || !newItemId) {
    if (
      error?.message?.includes(
        "EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY",
      )
    ) {
      return { ok: false, message: duplicateCommercialNameInActivityMessage };
    }
    if (error?.message?.includes("CATALOG_ITEM_INACTIVE_OR_MISSING")) {
      return {
        ok: false,
        message: "Thiết bị không còn hoạt động trong Danh mục.",
      };
    }
    if (error?.message?.includes("SKILL_NOT_FOUND_IN_REQUEST")) {
      return { ok: false, message: "Kỹ năng/bài thực hành không còn tồn tại." };
    }
    return {
      ok: false,
      message: error?.message || "Không thể bổ sung thiết bị vào phiếu.",
    };
  }

  const { data: inserted } = await supabase
    .from("equipment_request_items")
    .select(
      "id,quantity,skill_name,note,equipment_catalog(id,item_name,commercial_name,item_type,country_of_origin,manufacturer,model,unit)",
    )
    .eq("id", newItemId as string)
    .single();

  after(() => processPendingEmailOutbox());

  revalidatePath("/equipment/requests");
  revalidatePath("/equipment/mine");
  revalidatePath("/equipment/register");
  revalidatePath("/basic-medical/equipment-requests");
  return {
    ok: true,
    message: "Đã bổ sung thiết bị vào phiếu.",
    item: inserted as unknown as EquipmentRequestListItem["equipment_request_items"][number],
  };
}

export async function deleteEquipmentRequest(
  requestId: string,
): Promise<EquipmentActionState> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) {
    return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  }
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
    return { ok: false, message: "Phiếu thiết bị không hợp lệ." };
  }

  const { data: request, error: requestError } = await supabase
    .from("equipment_requests")
    .select("request_domain")
    .eq("id", requestId)
    .maybeSingle();
  if (requestError || !request) {
    return { ok: false, message: "Equipment request was not found." };
  }

  let actionMessage = "";
  const { data: isHardDeleted, error: hardDeleteErr } =
    request.request_domain === "nursing_skills"
      ? await supabase.rpc("hard_delete_equipment_request", {
          target_request_id: requestId,
        })
      : { data: false, error: null };

  if (!hardDeleteErr && isHardDeleted) {
    actionMessage = "Đã xóa vĩnh viễn phiếu thiết bị.";
  } else {
    const { data: isCancelled, error: cancelErr } = await supabase.rpc(
      "soft_cancel_equipment_request",
      { target_request_id: requestId },
    );
    if (cancelErr || !isCancelled) {
      return {
        ok: false,
        message: "Không thể hủy hoặc xóa phiếu thiết bị.",
      };
    }
    actionMessage = "Đã hủy phiếu thiết bị.";
  }

  after(() => processPendingEmailOutbox());

  revalidatePath("/equipment/requests");
  revalidatePath("/equipment/mine");
  revalidatePath("/equipment/register");
  revalidatePath("/basic-medical/equipment-requests");
  revalidatePath("/class-schedules");
  revalidatePath("/classes/open");
  revalidatePath("/classes/mine");
  return { ok: true, message: actionMessage };
}

export async function updateEquipmentRequestStatus(
  requestId: string,
  status: EquipmentRequestWorkflowStatus,
): Promise<EquipmentActionState> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { ok: false, message: "Phiên đăng nhập đã hết hạn." };

  const allowedStatuses = new Set(
    equipmentRequestWorkflowStatuses.map((item) => item.value),
  );
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !allowedStatuses.has(status)) {
    return { ok: false, message: "Phiếu hoặc trạng thái không hợp lệ." };
  }

  const guardError = await legacyConfirmationError(supabase, requestId);
  if (guardError) return { ok: false, message: guardError };

  const { data, error } = await supabase.rpc(
    "manager_confirm_equipment_status",
    {
      target_request_id: requestId,
      target_status: status,
    },
  );
  if (error || !data) {
    return {
      ok: false,
      message: error?.message || "Không thể cập nhật trạng thái phiếu.",
    };
  }

  const row = toEquipmentConfirmationState(data as Record<string, unknown>);
  const waitingMessage =
    status === "handed_over" && !row.handover_recipient_signed_at
      ? "Kho đã xác nhận giao; đang chờ Người đăng ký hoặc Giảng viên phụ trách ký xác nhận."
      : status === "returned" && !row.return_recipient_signed_at
        ? "Kho đã xác nhận trả; đang chờ Người đăng ký hoặc Giảng viên phụ trách ký xác nhận."
        : "Đã cập nhật trạng thái phiếu.";
  return { ok: true, message: waitingMessage, data: row };
}

export async function reviewLateEquipmentRequest(
  requestId: string,
  decision: "approved" | "rejected",
  note = "",
): Promise<EquipmentActionState> {
  if (
    !/^[0-9a-f-]{36}$/i.test(requestId) ||
    !["approved", "rejected"].includes(decision)
  ) {
    return { ok: false, message: "Phiếu hoặc kết quả duyệt không hợp lệ." };
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  }

  const { data, error } = await supabase.rpc(
    "manager_review_late_equipment_request",
    {
      target_request_id: requestId,
      target_decision: decision,
      target_note: note.trim() || null,
    },
  );
  if (error || !data) {
    return {
      ok: false,
      message:
        error?.message || "Không thể cập nhật kết quả duyệt đăng ký trễ.",
    };
  }

  after(() => processPendingEmailOutbox());

  return {
    ok: true,
    message:
      decision === "approved"
        ? "Đã duyệt đăng ký trễ."
        : "Đã từ chối đăng ký trễ.",
    data: toEquipmentConfirmationState(data as Record<string, unknown>),
  };
}

export async function confirmEquipmentRequestHandoff(
  requestId: string,
  phase: "handover" | "return",
  signature: string,
): Promise<EquipmentActionState> {
  if (
    !/^[0-9a-f-]{36}$/i.test(requestId) ||
    !["handover", "return"].includes(phase)
  ) {
    return { ok: false, message: "Phiếu hoặc bước xác nhận không hợp lệ." };
  }
  if (
    !signature.startsWith("data:image/png;base64,") ||
    signature.length < 100 ||
    signature.length > 400000
  ) {
    return { ok: false, message: "Chữ ký điện tử không hợp lệ." };
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  }

  const guardError = await legacyConfirmationError(supabase, requestId);
  if (guardError) return { ok: false, message: guardError };

  const { data, error } = await supabase.rpc(
    "registrant_confirm_equipment_handoff",
    {
      target_request_id: requestId,
      target_phase: phase,
      target_signature: signature,
    },
  );
  if (error || !data) {
    return {
      ok: false,
      message: error?.message || "Không thể lưu chữ ký xác nhận.",
    };
  }

  const row = toEquipmentConfirmationState(data as Record<string, unknown>);
  const message =
    phase === "handover"
      ? row.status === "handed_over"
        ? "Đã đủ hai xác nhận và chuyển sang Xác nhận đã giao."
        : "Đã lưu chữ ký giao; đang chờ xác nhận của kho."
      : row.status === "completed"
        ? "Đã đủ hai xác nhận trả và hoàn thành phiếu."
        : "Đã lưu chữ ký trả; đang chờ xác nhận của kho.";
  return { ok: true, message, data: row };
}

export async function updateEquipmentRequest(
  _state: EquipmentActionState,
  formData: FormData,
): Promise<EquipmentActionState> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { ok: false, message: "Phiên đăng nhập đã hết hạn." };

  const requestId = String(formData.get("request_id") ?? "");
  const scheduleId = String(formData.get("class_schedule_id") ?? "");
  const responsibleId = String(formData.get("responsible_lecturer_id") ?? "");
  const receiveDate = String(formData.get("receive_date") ?? "");
  const receiveTime = String(formData.get("receive_time") ?? "");
  const returnDate = String(formData.get("return_date") ?? "");
  const returnTime = String(formData.get("return_time") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const lateRegistrationReason = String(
    formData.get("late_registration_reason") ?? "",
  ).trim();
  const expectedRevision = Number(formData.get("expected_revision"));
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    return {
      ok: false,
      message: "Phiên bản phiếu không hợp lệ. Vui lòng tải lại phiếu.",
    };
  }
  let items: Array<{
    skillName: string;
    id: string;
    catalogItemId: string;
    quantity: number;
    note?: string;
  }> = [];
  try {
    const parsed: unknown = JSON.parse(String(formData.get("items") ?? "[]"));
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (item): item is (typeof items)[number] =>
          typeof item === "object" &&
          item !== null &&
          typeof item.id === "string" &&
          typeof item.skillName === "string" &&
          typeof item.catalogItemId === "string" &&
          typeof item.quantity === "number" &&
          (item.note === undefined || typeof item.note === "string"),
      )
    ) {
      return { ok: false, message: "Danh sách thiết bị không hợp lệ." };
    }
    items = parsed;
  } catch {
    return { ok: false, message: "Danh sách thiết bị không hợp lệ." };
  }

  const uuidPattern = /^[0-9a-f-]{36}$/i;
  if (
    !uuidPattern.test(requestId) ||
    !uuidPattern.test(scheduleId) ||
    !uuidPattern.test(responsibleId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(receiveDate) ||
    !/^\d{2}:\d{2}$/.test(receiveTime) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(returnDate) ||
    !/^\d{2}:\d{2}$/.test(returnTime)
  ) {
    return {
      ok: false,
      message: "Vui lòng kiểm tra lớp, giảng viên và thời gian nhận/trả.",
    };
  }
  if (
    !items.length ||
    new Set(items.map((item) => item.id)).size !== items.length ||
    items.some(
      (item) =>
        !uuidPattern.test(item.id) ||
        !item.skillName.trim() ||
        !uuidPattern.test(item.catalogItemId) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1,
    )
  ) {
    return {
      ok: false,
      message: "Mỗi dòng phải có kỹ năng, thiết bị và số lượng hợp lệ.",
    };
  }

  const [
    { data: request },
    { data: schedule },
    { data: roleRows },
    { data: eligibleLecturers },
  ] = await Promise.all([
    supabase
      .from("equipment_requests")
      .select(
        "id,class_schedule_id,registrant_id,responsible_lecturer_id,status,semester,receive_at,late_approval_status,late_registration_reason",
      )
      .eq("id", requestId)
      .maybeSingle(),
    supabase
      .from("class_schedules")
      .select("id,schedule_date,semester,rooms!inner(room_type_id)")
      .eq("id", scheduleId)
      .eq("rooms.room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
      .neq("schedule_status", "cancelled")
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.rpc("list_scoped_lecturers", {
      target_room_type_id: NURSING_SKILLS_ROOM_TYPE_ID,
    }),
  ]);

  let effectiveSemester: string | null = null;
  if (isCanonicalSemester(schedule?.semester)) {
    effectiveSemester = schedule.semester;
  } else if (
    request?.class_schedule_id &&
    request.class_schedule_id === scheduleId &&
    isCanonicalSemester(request.semester)
  ) {
    effectiveSemester = request.semester;
  } else {
    effectiveSemester = null;
  }

  if (!isCanonicalSemester(effectiveSemester)) {
    return {
      ok: false,
      message: "Lịch học chưa có thông tin Học kỳ hợp lệ.",
    };
  }

  const roles = (roleRows ?? []).map(({ role }) => role);
  const canManageAll = roles.some((role) => ["admin", "staff"].includes(role));
  if (!request || (request.registrant_id !== userId && !canManageAll)) {
    return { ok: false, message: "Bạn không có quyền điều chỉnh phiếu này." };
  }
  if (!["new", "preparing"].includes(request.status)) {
    return {
      ok: false,
      message: "Chỉ có thể điều chỉnh phiếu trạng thái Mới hoặc Đã soạn.",
    };
  }
  if (!schedule) {
    return {
      ok: false,
      message: "Lớp Skills lab không hợp lệ hoặc đã bị hủy.",
    };
  }

  const eligibleLecturerIds = new Set(
    ((eligibleLecturers ?? []) as Array<{ id: string }>).map(({ id }) => id),
  );
  const preservesResponsibleLecturer =
    responsibleId === request.responsible_lecturer_id;
  if (
    !preservesResponsibleLecturer &&
    responsibleId !== request.registrant_id &&
    !eligibleLecturerIds.has(responsibleId)
  ) {
    return { ok: false, message: "Giảng viên phụ trách không hợp lệ." };
  }

  const receiveAt = equipmentReceiveAt(receiveDate, receiveTime);
  const returnAt = new Date(`${returnDate}T${returnTime}:00+07:00`);
  if (
    !equipmentHandoffTimes.includes(
      receiveTime as (typeof equipmentHandoffTimes)[number],
    ) ||
    !equipmentHandoffTimes.includes(
      returnTime as (typeof equipmentHandoffTimes)[number],
    )
  ) {
    return { ok: false, message: "Giờ nhận và giờ trả không hợp lệ." };
  }
  if (!receiveAt || Number.isNaN(returnAt.getTime()) || returnAt < receiveAt) {
    return {
      ok: false,
      message: "Ngày trả phải sau hoặc bằng thời điểm nhận.",
    };
  }
  if (receiveDate > schedule.schedule_date) {
    return { ok: false, message: "Ngày nhận phải bằng hoặc trước ngày học." };
  }
  if (returnDate < schedule.schedule_date) {
    return { ok: false, message: "Ngày trả phải bằng hoặc sau ngày học." };
  }
  if (receiveDate < businessTodayString()) {
    return { ok: false, message: "Ngày nhận không được trước ngày hiện tại." };
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
  const preservesApprovedLateDecision =
    request.late_approval_status === "approved" &&
    new Date(request.receive_at).getTime() === receiveAt.getTime() &&
    (request.late_registration_reason?.trim() ?? "") === lateRegistrationReason;
  const requiresLateReview =
    leadTime.requiresLateApproval && !preservesApprovedLateDecision;

  const catalogIds = [...new Set(items.map((item) => item.catalogItemId))];
  const { data: catalogRows } = await supabase
    .from("equipment_catalog")
    .select("id")
    .in("id", catalogIds)
    .eq("is_active", true);
  if ((catalogRows ?? []).length !== catalogIds.length) {
    return { ok: false, message: "Danh sách có thiết bị không còn hoạt động." };
  }

  const { data: updatedId, error } = await supabase.rpc(
    "update_equipment_request_content",
    {
      target_request_id: requestId,
      target_class_schedule_id: scheduleId,
      target_semester: effectiveSemester,
      target_responsible_lecturer_id: responsibleId,
      target_receive_at: receiveAt.toISOString(),
      target_return_at: returnAt.toISOString(),
      target_note: note,
      target_late_registration_reason: lateRegistrationReason,
      target_items: items.map((item) => ({
        id: item.id,
        expected_revision: expectedRevision,
        skill_name: item.skillName.trim(),
        catalog_item_id: item.catalogItemId,
        quantity: item.quantity,
        note: item.note?.trim() || null,
      })),
    },
  );
  if (error || !updatedId) {
    return {
      ok: false,
      message: error?.message?.includes(
        "EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY",
      )
        ? duplicateCommercialNameInActivityMessage
        : error?.code === "23505"
          ? "Lớp này đã có một phiếu đăng ký thiết bị khác."
          : error?.message || "Không thể lưu nội dung điều chỉnh.",
    };
  }

  after(() => processPendingEmailOutbox());

  revalidatePath("/equipment/requests");
  revalidatePath("/equipment/mine");
  revalidatePath("/equipment/register");
  revalidatePath(`/equipment/preparation/${requestId}`);
  revalidatePath("/class-schedules");
  return {
    ok: true,
    message: requiresLateReview
      ? "Đã gửi yêu cầu duyệt đăng ký trễ. ID phiếu được giữ nguyên."
      : "Đã lưu điều chỉnh. ID và trạng thái hiện tại của phiếu được giữ nguyên.",
  };
}

export async function createEquipmentRequest(
  _state: EquipmentActionState,
  formData: FormData,
): Promise<EquipmentActionState> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { ok: false, message: "Phiên đăng nhập đã hết hạn." };

  const scheduleId = String(formData.get("class_schedule_id") ?? "");
  const responsibleId = String(formData.get("responsible_lecturer_id") ?? "");
  const receiveDate = String(formData.get("receive_date") ?? "");
  const receiveTime = String(formData.get("receive_time") ?? "");
  const returnDate = String(formData.get("return_date") ?? "");
  const returnTime = String(formData.get("return_time") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  const lateRegistrationReason = String(
    formData.get("late_registration_reason") ?? "",
  ).trim();
  let items: Array<{
    skillName: string;
    catalogItemId: string;
    quantity: number;
    note?: string;
  }> = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { ok: false, message: "Danh sách thiết bị không hợp lệ." };
  }
  if (
    !scheduleId ||
    !responsibleId ||
    !/^\d{4}-\d{2}-\d{2}$/.test(receiveDate) ||
    !/^\d{2}:\d{2}$/.test(receiveTime) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(returnDate) ||
    !/^\d{2}:\d{2}$/.test(returnTime)
  ) {
    return {
      ok: false,
      message: "Vui lòng kiểm tra lớp, giảng viên và thời gian nhận/trả.",
    };
  }
  if (
    !items.length ||
    items.some(
      (item) =>
        !item.skillName.trim() ||
        !item.catalogItemId ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1,
    )
  ) {
    return {
      ok: false,
      message: "Mỗi dòng phải có kỹ năng, thiết bị và số lượng hợp lệ.",
    };
  }
  const [
    { data: profile },
    { data: schedule },
    { data: roleRows },
    { data: eligibleLecturers },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("email,phone,is_active")
      .eq("id", userId)
      .single(),
    supabase
      .from("class_schedules")
      .select("id,schedule_date,semester,rooms!inner(room_type_id)")
      .eq("id", scheduleId)
      .eq("rooms.room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
      .neq("schedule_status", "cancelled")
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.rpc("list_scoped_lecturers", {
      target_room_type_id: NURSING_SKILLS_ROOM_TYPE_ID,
    }),
  ]);

  const effectiveSemester = schedule?.semester;
  if (!isCanonicalSemester(effectiveSemester)) {
    return {
      ok: false,
      message: "Lịch học chưa có thông tin Học kỳ hợp lệ.",
    };
  }

  if (
    !profile?.is_active ||
    !(roleRows ?? []).some(({ role }) =>
      ["admin", "staff", "teaching_assistant", "lecturer"].includes(role),
    )
  ) {
    return { ok: false, message: "Bạn không có quyền tạo phiếu thiết bị." };
  }
  if (!/^\d{10}$/.test(profile.phone ?? "")) {
    return {
      ok: false,
      message: "Hồ sơ Nhân sự chưa có số điện thoại 10 chữ số.",
    };
  }
  const eligibleLecturerIds = new Set(
    ((eligibleLecturers ?? []) as Array<{ id: string }>).map(({ id }) => id),
  );
  if (
    !schedule ||
    (responsibleId !== userId && !eligibleLecturerIds.has(responsibleId))
  ) {
    return {
      ok: false,
      message: "Lớp hoặc giảng viên phụ trách không hợp lệ.",
    };
  }
  const receiveAt = equipmentReceiveAt(receiveDate, receiveTime);
  const returnAt = new Date(`${returnDate}T${returnTime}:00+07:00`);
  if (
    !equipmentHandoffTimes.includes(
      receiveTime as (typeof equipmentHandoffTimes)[number],
    ) ||
    !equipmentHandoffTimes.includes(
      returnTime as (typeof equipmentHandoffTimes)[number],
    )
  ) {
    return { ok: false, message: "Giờ nhận và giờ trả không hợp lệ." };
  }
  if (!receiveAt || Number.isNaN(returnAt.getTime()) || returnAt < receiveAt) {
    return {
      ok: false,
      message: "Ngày trả phải sau hoặc bằng thời điểm nhận.",
    };
  }
  if (receiveDate > schedule.schedule_date) {
    return { ok: false, message: "Ngày nhận phải bằng hoặc trước ngày học." };
  }
  if (returnDate < schedule.schedule_date) {
    return { ok: false, message: "Ngày trả phải bằng hoặc sau ngày học." };
  }
  if (receiveDate < businessTodayString()) {
    return { ok: false, message: "Ngày nhận không được trước ngày hiện tại." };
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
    .from("equipment_catalog")
    .select("id")
    .in("id", catalogIds)
    .eq("is_active", true);
  if ((catalogRows ?? []).length !== catalogIds.length) {
    return { ok: false, message: "Danh sách có thiết bị không còn hoạt động." };
  }
  const { data: requestId, error } = await supabase.rpc(
    "create_equipment_request_with_items",
    {
      target_class_schedule_id: scheduleId,
      target_semester: effectiveSemester,
      target_responsible_lecturer_id: responsibleId,
      target_receive_at: receiveAt.toISOString(),
      target_return_at: returnAt.toISOString(),
      target_late_registration_reason: lateRegistrationReason || null,
      target_note: note || null,
      target_items: items.map((item) => ({
        skill_name: item.skillName.trim(),
        catalog_item_id: item.catalogItemId,
        quantity: item.quantity,
        note: item.note?.trim() || null,
      })),
    },
  );
  if (error || !requestId)
    return {
      ok: false,
      message: error?.message?.includes(
        "EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY",
      )
        ? duplicateCommercialNameInActivityMessage
        : error?.code === "23505"
          ? "Lớp này đã có phiếu đăng ký thiết bị."
          : error?.message || "Không thể tạo phiếu thiết bị.",
    };
  after(() => processPendingEmailOutbox());
  revalidatePath("/equipment/requests");
  revalidatePath("/equipment/mine");
  revalidatePath("/equipment/register");
  revalidatePath("/class-schedules");
  return {
    ok: true,
    message: leadTime.requiresLateApproval
      ? "Đã gửi yêu cầu duyệt đăng ký trễ."
      : "Đã tạo phiếu đăng ký thiết bị.",
  };
}
