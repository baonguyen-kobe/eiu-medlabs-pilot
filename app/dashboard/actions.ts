"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processPendingScheduleEmails } from "@/lib/email-notifications";

export type ActionResult = {
  ok: boolean;
  message: string;
};

function friendlyDatabaseError(message: string): string {
  if (message.includes("CLASS_EQUIPMENT_REQUEST_EXISTS")) {
    return "Lớp đã có Phiếu đăng ký thiết bị. Vui lòng xóa vĩnh viễn Phiếu đăng ký thiết bị trước khi thực hiện thao tác này.";
  }
  if (message.includes("INVALID_ROOM_SELECTION")) {
    return "Phòng học được chọn không hợp lệ cho Kỹ năng Điều dưỡng.";
  }
  if (message.includes("INVALID_COURSE_SELECTION")) {
    return "Môn học được chọn không hợp lệ cho Kỹ năng Điều dưỡng.";
  }
  if (message.includes("BASIC_MEDICAL_REGISTRATION_EDIT_REQUIRED")) {
    return "Phòng và số sinh viên phải được điều chỉnh tại Phiếu Y cơ sở.";
  }
  if (message.includes("BASIC_MEDICAL_TEACHING_LECTURER_REQUIRED")) {
    return "Mỗi buổi Y cơ sở phải có đúng một giảng viên giảng dạy/hướng dẫn.";
  }
  if (message.includes("BASIC_MEDICAL_SESSION_DATE_OUTSIDE_REGISTRATION")) {
    return "Ngày học phải nằm trong thời gian đăng ký của Phiếu Y cơ sở.";
  }
  if (message.includes("BASIC_MEDICAL_SESSION_ALREADY_CONFIRMED")) {
    return "Buổi học đã được ký xác nhận nên không thể đổi lịch hoặc giảng viên.";
  }
  if (message.includes("BASIC_MEDICAL_LINKED_SCHEDULE_INCONSISTENT")) {
    return "Lịch và Phiếu Y cơ sở chưa đồng bộ. Vui lòng liên hệ quản trị hệ thống.";
  }
  if (message.includes("SCHEDULE_CONFLICT")) {
    return "Phòng hoặc giảng viên đã có lịch trùng trong thời gian này.";
  }
  if (message.includes("INVALID_CLASS_DETAILS")) {
    return "Vui lòng kiểm tra lại ngày, giờ, phòng và số sinh viên.";
  }
  if (
    message.includes("CLASS_UPDATE_FORBIDDEN") ||
    message.includes("CLASS_DETAILS_UPDATE_FORBIDDEN")
  ) {
    return "Bạn không có quyền sửa các nội dung này.";
  }
  if (message.includes("CLASS_NOT_AVAILABLE")) {
    return "Lớp này không còn khả dụng hoặc đã đủ 2 giảng viên.";
  }
  if (message.includes("CLASS_ALREADY_CLAIMED")) {
    return "Bạn đã là giảng viên của lớp này.";
  }
  if (message.includes("LECTURER_SCHEDULE_CONFLICT")) {
    return "Bạn đã có lịch giảng trùng với thời gian của lớp này.";
  }
  if (
    message.includes("ROOM_TYPE_SCOPE_REQUIRED") ||
    message.includes("CLASS_MANAGEMENT_SCOPE_REQUIRED")
  ) {
    return "Bạn không được phân công Loại phòng của lớp này.";
  }
  if (message.includes("ROOM_OR_LECTURER_SCHEDULE_CONFLICT")) {
    return "Không thể đổi ngày vì phòng hoặc một giảng viên có lịch giao nhau trong khung giờ này.";
  }
  if (message.includes("CLASS_DATE_CHANGE_FORBIDDEN")) {
    return "Bạn không có quyền đổi ngày học của lớp này.";
  }
  if (message.includes("CLASS_DELETE_FORBIDDEN")) {
    return "Bạn không có quyền xóa lớp này.";
  }
  if (message.includes("LECTURER_ROOM_TYPE_MISMATCH")) {
    return "Giảng viên được chọn không thuộc Loại phòng của lớp.";
  }
  if (message.includes("LECTURER_ROLE_REQUIRED")) {
    return "Tài khoản cần có vai trò Giảng viên để đăng ký lớp.";
  }
  if (message.includes("CLASS_WITHDRAWAL_CLOSED")) {
    return "Không thể rút lớp sau khi lớp đã bắt đầu.";
  }
  if (message.includes("NOT_CLASS_OWNER")) {
    return "Bạn chỉ có thể rút lớp do chính mình đăng ký.";
  }
  if (message.includes("ACTIVE_SHIFT_EXISTS")) {
    return "Nhân sự đã có ca trực đang hoạt động trong khung giờ này.";
  }
  if (message.includes("INVALID_MORNING_TIME")) {
    return "Ca sáng phải nằm trong khoảng 07:30–11:30 và theo bước 30 phút.";
  }
  if (message.includes("INVALID_AFTERNOON_TIME")) {
    return "Ca chiều phải nằm trong khoảng 12:30–16:30 và theo bước 30 phút.";
  }
  if (message.includes("ASSIGNEE_NOT_ELIGIBLE")) {
    return "Nhân sự được chọn không thuộc danh sách trực Skills Lab.";
  }
  if (message.includes("HISTORICAL_MUTATION_FORBIDDEN")) {
    return "Không thể tạo hoặc điều chỉnh lịch trực trong quá khứ khi chưa có quyền quản lý lịch sử.";
  }
  if (message.includes("HISTORICAL_REASON_REQUIRED")) {
    return "Vui lòng nhập lý do khi tạo hoặc điều chỉnh lịch trực trong quá khứ.";
  }
  if (message.includes("SHIFT_NOT_FOUND")) {
    return "Không tìm thấy ca trực hoặc ca trực đã bị hủy.";
  }
  if (message.includes("DUPLICATE_PAYLOAD_SLOT")) {
    return "Trùng ca trực của cùng nhân sự trong cùng ngày và buổi trong yêu cầu gửi lên.";
  }
  if (message.includes("ADMIN_ROLE_REQUIRED")) {
    return "Chỉ Quản trị viên mới được thực hiện thao tác này.";
  }
  if (message.includes("BASIC_MEDICAL_SESSION_CANCEL_FORBIDDEN")) {
    return "Chỉ Quản trị viên, người tạo phiếu hoặc giảng viên của buổi học mới được hủy buổi này.";
  }
  if (
    message.includes("BASIC_MEDICAL_SESSION_CONFIRMATION_INVALIDATION_REQUIRED")
  ) {
    return "Buổi học đã có xác nhận còn hiệu lực. Quản trị viên cần vô hiệu hóa xác nhận trước khi hủy buổi.";
  }
  if (message.includes("SHIFT_CANCELLED")) {
    return "Ca trực đã bị hủy nên không thể chỉnh sửa.";
  }
  if (message.includes("ASSIGN_ROOT_NOT_ALLOWED")) {
    return "Không thể phân công quản trị viên gốc vào ca trực.";
  }
  if (message.includes("INVALID_TIME_RANGE")) {
    return "Giờ bắt đầu phải sớm hơn giờ kết thúc.";
  }
  if (message.includes("AUTH_REQUIRED")) {
    return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  }
  if (message.includes("PERMISSION_DENIED")) {
    return "Bạn không có quyền thực hiện thao tác này.";
  }
  return "Không thể hoàn tất thao tác. Vui lòng kiểm tra dữ liệu và thử lại.";
}

export async function claimClass(scheduleId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) {
    return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  }

  const { error } = await supabase.rpc("claim_class", {
    target_schedule_id: scheduleId,
  });
  if (error) {
    return { ok: false, message: friendlyDatabaseError(error.message) };
  }

  revalidatePath("/dashboard");
  revalidatePath("/class-schedules");
  revalidatePath("/classes/open");
  revalidatePath("/classes/mine");
  return { ok: true, message: "Đăng ký lớp thành công." };
}

export type ShiftRegistrationPayloadItem = {
  staff_id: string;
  shift_date: string;
  shift_slot: "MORNING" | "AFTERNOON";
  start_time: string;
  end_time: string;
  note?: string | null;
  creation_group_id?: string | null;
};

export async function registerStaffShiftsAction(
  payload: ShiftRegistrationPayloadItem[],
  adjustmentReason?: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) {
    return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  }

  if (!Array.isArray(payload) || payload.length === 0) {
    return {
      ok: false,
      message: "Vui lòng chọn ít nhất một ca trực để đăng ký.",
    };
  }

  const { data, error } = await supabase.rpc("register_staff_shifts", {
    shifts_payload: payload,
    adjustment_reason: adjustmentReason?.trim() || null,
  });

  if (error) {
    return { ok: false, message: friendlyDatabaseError(error.message) };
  }

  revalidatePath("/dashboard");
  revalidatePath("/staff-shifts");
  const count = Array.isArray(data) ? data.length : payload.length;
  return { ok: true, message: `Đã đăng ký thành công ${count} ca trực.` };
}

export async function cancelStaffShiftAction(
  shiftId: string,
  reason?: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) {
    return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  }

  if (!shiftId) {
    return { ok: false, message: "Mã ca trực không hợp lệ." };
  }

  const { error } = await supabase.rpc("cancel_staff_shift", {
    target_shift_id: shiftId,
    reason: reason?.trim() || null,
  });

  if (error) {
    return { ok: false, message: friendlyDatabaseError(error.message) };
  }

  revalidatePath("/dashboard");
  revalidatePath("/staff-shifts");
  return { ok: true, message: "Đã hủy ca trực thành công." };
}

export async function updateStaffShiftTimeAction(
  shiftId: string,
  startTime: string,
  endTime: string,
  note?: string | null,
  reason?: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) {
    return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  }

  if (!shiftId || !startTime || !endTime) {
    return { ok: false, message: "Vui lòng nhập đầy đủ thông tin thời gian." };
  }

  const { error } = await supabase.rpc("update_staff_shift_time", {
    target_shift_id: shiftId,
    target_start_time: startTime,
    target_end_time: endTime,
    target_note: note?.trim() || null,
    reason: reason?.trim() || null,
  });

  if (error) {
    return { ok: false, message: friendlyDatabaseError(error.message) };
  }

  revalidatePath("/dashboard");
  revalidatePath("/staff-shifts");
  return { ok: true, message: "Đã cập nhật giờ ca trực thành công." };
}

export async function withdrawClass(scheduleId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  const { error } = await supabase.rpc("withdraw_class", {
    target_schedule_id: scheduleId,
  });
  if (error) {
    return { ok: false, message: friendlyDatabaseError(error.message) };
  }

  revalidatePath("/dashboard");
  revalidatePath("/class-schedules");
  revalidatePath("/classes/open");
  revalidatePath("/classes/mine");
  return {
    ok: true,
    message: "Đã rút khỏi lớp. Lớp được mở lại cho giảng viên khác.",
  };
}

export async function deleteClassSchedule(
  scheduleId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return { ok: false, message: "Phiên đăng nhập đã hết hạn." };

  const { error } = await supabase.rpc("delete_skills_lab_class_schedule", {
    target_schedule_id: scheduleId,
  });

  if (error) {
    return {
      ok: false,
      message: friendlyDatabaseError(error.message),
    };
  }

  revalidateScheduleViews();
  after(processPendingScheduleEmails);
  return { ok: true, message: "Đã xóa lớp khỏi hệ thống." };
}

async function requireAdminAction() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) return null;

  const { data: adminRole } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return adminRole ? { supabase, userId } : null;
}

function revalidateScheduleViews() {
  revalidatePath("/dashboard");
  revalidatePath("/class-schedules");
  revalidatePath("/classes/open");
  revalidatePath("/classes/mine");
  revalidatePath("/staff-shifts");
  revalidatePath("/basic-medical/schedules");
}

export async function rescheduleClass(
  scheduleId: string,
  scheduleDate: string,
): Promise<ActionResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
    return { ok: false, message: "Ngày học không hợp lệ." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("reschedule_class", {
    target_schedule_id: scheduleId,
    target_schedule_date: scheduleDate,
  });
  if (error)
    return { ok: false, message: friendlyDatabaseError(error.message) };
  revalidateScheduleViews();
  after(processPendingScheduleEmails);
  return { ok: true, message: "Đã đổi ngày học và xếp email thông báo." };
}

export async function updateClassSchedule(
  scheduleId: string,
  values: {
    scheduleDate: string;
    startTime: string;
    endTime: string;
    courseId?: string;
    roomId: string;
    studentCount: number;
    lecturerIds: string[];
  },
): Promise<ActionResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.scheduleDate))
    return { ok: false, message: "Ngày học không hợp lệ." };
  if (
    !/^\d{2}:\d{2}$/.test(values.startTime) ||
    !/^\d{2}:\d{2}$/.test(values.endTime) ||
    values.endTime <= values.startTime
  ) {
    return { ok: false, message: "Thời gian học không hợp lệ." };
  }
  if (!Number.isInteger(values.studentCount) || values.studentCount < 1)
    return { ok: false, message: "Số sinh viên phải từ 1 trở lên." };
  const uniqueLecturerIds = [...new Set(values.lecturerIds.filter(Boolean))];
  if (
    uniqueLecturerIds.length > 2 ||
    uniqueLecturerIds.length !== values.lecturerIds.filter(Boolean).length
  ) {
    return {
      ok: false,
      message: "Mỗi lớp chỉ có tối đa 2 giảng viên khác nhau.",
    };
  }
  const supabase = await createClient();

  if (values.courseId) {
    const { error } = await supabase.rpc("update_skills_lab_class_schedule", {
      target_schedule_id: scheduleId,
      target_schedule_date: values.scheduleDate,
      target_start_time: values.startTime,
      target_end_time: values.endTime,
      target_course_id: values.courseId,
      target_room_id: values.roomId,
      target_student_count: values.studentCount,
      target_lecturer_ids: uniqueLecturerIds.length ? uniqueLecturerIds : null,
    });
    if (error)
      return { ok: false, message: friendlyDatabaseError(error.message) };
    revalidateScheduleViews();
    after(processPendingScheduleEmails);
    return { ok: true, message: "Đã lưu thay đổi lớp học." };
  }

  const { error } = await supabase.rpc("update_class_schedule_details", {
    target_schedule_id: scheduleId,
    target_schedule_date: values.scheduleDate,
    target_start_time: values.startTime,
    target_end_time: values.endTime,
    target_room_id: values.roomId,
    target_student_count: values.studentCount,
    target_lecturer_ids: uniqueLecturerIds,
  });
  if (error)
    return { ok: false, message: friendlyDatabaseError(error.message) };
  revalidateScheduleViews();
  after(processPendingScheduleEmails);
  return { ok: true, message: "Đã lưu thay đổi lớp học." };
}

export async function adminCancelClass(
  scheduleId: string,
): Promise<ActionResult> {
  const context = await requireAdminAction();
  if (!context) return { ok: false, message: "Chỉ Admin được hủy lớp." };
  const { data: schedule, error: scheduleError } = await context.supabase
    .from("class_schedules")
    .select("basic_medical_registration_id")
    .eq("id", scheduleId)
    .maybeSingle();
  if (scheduleError || !schedule) {
    return { ok: false, message: "Lớp học không còn khả dụng." };
  }
  if (schedule.basic_medical_registration_id) {
    const { data: session, error: sessionError } = await context.supabase
      .from("basic_medical_registration_sessions")
      .select("id")
      .eq("class_schedule_id", scheduleId)
      .maybeSingle();
    if (sessionError || !session) {
      return {
        ok: false,
        message: "Không xác định được buổi Y cơ sở liên kết để hủy.",
      };
    }
    const { error } = await context.supabase.rpc(
      "cancel_basic_medical_session",
      {
        target_session_id: session.id,
        target_reason: "Hủy từ lịch chung bởi quản trị viên.",
      },
    );
    if (error)
      return { ok: false, message: friendlyDatabaseError(error.message) };
    revalidateScheduleViews();
    after(processPendingScheduleEmails);
    return {
      ok: true,
      message: "Đã hủy đúng một buổi Y cơ sở và lưu lại lịch sử thay đổi.",
    };
  }
  const { error } = await context.supabase.rpc("cancel_class_schedule", {
    target_schedule_id: scheduleId,
  });
  if (error)
    return { ok: false, message: friendlyDatabaseError(error.message) };
  revalidateScheduleViews();
  after(processPendingScheduleEmails);
  return { ok: true, message: "Đã hủy lớp và lưu lại lịch sử thay đổi." };
}

async function basicMedicalSessionForAdminAction(
  scheduleId: string,
  context: Awaited<ReturnType<typeof requireAdminAction>>,
) {
  if (!context) return null;
  const { data: session, error } = await context.supabase
    .from("basic_medical_registration_sessions")
    .select("id")
    .eq("class_schedule_id", scheduleId)
    .maybeSingle();
  return error ? null : session;
}

export async function adminCancelBasicMedicalSession(
  scheduleId: string,
  reason: string,
): Promise<ActionResult> {
  const context = await requireAdminAction();
  if (!context) return { ok: false, message: "Chỉ Admin được hủy lớp." };
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    return { ok: false, message: "Vui lòng nhập Lý do hủy buổi học." };
  }
  const session = await basicMedicalSessionForAdminAction(scheduleId, context);
  if (!session) {
    return {
      ok: false,
      message: "Không xác định được buổi Y cơ sở liên kết để hủy.",
    };
  }
  const { error } = await context.supabase.rpc("cancel_basic_medical_session", {
    target_session_id: session.id,
    target_reason: normalizedReason,
  });
  if (error)
    return { ok: false, message: friendlyDatabaseError(error.message) };
  revalidateScheduleViews();
  revalidatePath("/basic-medical/registrations");
  after(processPendingScheduleEmails);
  return { ok: true, message: "Đã hủy đúng một buổi Y cơ sở." };
}

export async function adminInvalidateBasicMedicalSessionConfirmation(
  confirmationId: string,
  reason: string,
): Promise<ActionResult> {
  const context = await requireAdminAction();
  if (!context)
    return { ok: false, message: "Chỉ Admin được vô hiệu hóa xác nhận." };
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    return { ok: false, message: "Vui lòng nhập Lý do vô hiệu hóa." };
  }
  const { error } = await context.supabase.rpc(
    "invalidate_basic_medical_session_confirmation",
    { target_confirmation_id: confirmationId, target_reason: normalizedReason },
  );
  if (error)
    return { ok: false, message: friendlyDatabaseError(error.message) };
  revalidateScheduleViews();
  revalidatePath("/basic-medical/registrations");
  return {
    ok: true,
    message: "Đã vô hiệu hóa xác nhận; bằng chứng gốc được giữ nguyên.",
  };
}
