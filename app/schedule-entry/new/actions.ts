"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { processPendingScheduleEmails } from "@/lib/email-notifications";
import { createClient } from "@/lib/supabase/server";
import { isWithinOperatingHours } from "@/lib/business-time";
import { NURSING_SKILLS_ROOM_TYPE_ID } from "@/lib/room-types";
import { isCanonicalSemester } from "@/lib/semesters";

export type CreateScheduleState = {
  ok: boolean;
  message: string;
};

export async function createScheduleDraft(
  _previousState: CreateScheduleState,
  formData: FormData,
): Promise<CreateScheduleState> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) {
    return { ok: false, message: "Phiên đăng nhập đã hết hạn." };
  }

  const [{ data: roles }, { data: course }, { data: room }] = await Promise.all(
    [
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase
        .from("courses")
        .select("id, course_code, course_name, room_type_id")
        .eq("id", String(formData.get("course_id") ?? ""))
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("rooms")
        .select("id, room_type_id")
        .eq("id", String(formData.get("room_id") ?? ""))
        .eq("is_active", true)
        .maybeSingle(),
    ],
  );

  const roleNames = (roles ?? []).map(({ role }) => role);
  if (
    !roleNames.some((role) =>
      ["admin", "staff", "teaching_assistant", "lecturer"].includes(role),
    )
  ) {
    return { ok: false, message: "Bạn không có quyền tạo phiếu lịch." };
  }
  if (!course || !room) {
    return { ok: false, message: "Môn học hoặc phòng không hợp lệ." };
  }

  const scheduleDate = String(formData.get("schedule_date") ?? "");
  const startTime = String(formData.get("start_time") ?? "");
  const endTime = String(formData.get("end_time") ?? "");
  const semester = String(formData.get("semester") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const rawStudentCount = String(formData.get("student_count") ?? "").trim();
  const requestedLecturerIds = [
    ...new Set(
      formData
        .getAll("lecturer_ids")
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];

  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate) || !startTime || !endTime) {
    return { ok: false, message: "Vui lòng nhập đủ ngày và thời gian." };
  }
  if (!isCanonicalSemester(semester)) {
    return { ok: false, message: "Vui lòng chọn Học kỳ." };
  }
  if (!rawStudentCount) {
    return { ok: false, message: "Vui lòng nhập số sinh viên." };
  }
  const studentCount = Number(rawStudentCount);
  if (!Number.isInteger(studentCount) || studentCount < 1) {
    return {
      ok: false,
      message: "Số sinh viên phải là số nguyên từ 1 trở lên.",
    };
  }
  if (
    course.room_type_id !== NURSING_SKILLS_ROOM_TYPE_ID ||
    room.room_type_id !== NURSING_SKILLS_ROOM_TYPE_ID
  ) {
    return {
      ok: false,
      message: "Môn học và phòng phải thuộc Kỹ năng Điều dưỡng.",
    };
  }
  if (endTime <= startTime) {
    return { ok: false, message: "Giờ kết thúc phải sau giờ bắt đầu." };
  }
  if (!isWithinOperatingHours(startTime, endTime)) {
    return {
      ok: false,
      message:
        "Lịch phải nằm trọn trong ca sáng 07:30–11:30 hoặc ca chiều 12:30–16:30.",
    };
  }

  if (requestedLecturerIds.length > 2) {
    return {
      ok: false,
      message: "Mỗi lớp chỉ được phân công tối đa 2 giảng viên.",
    };
  }
  if (
    roleNames.includes("lecturer") &&
    !roleNames.some((role) =>
      ["admin", "staff", "teaching_assistant"].includes(role),
    ) &&
    !requestedLecturerIds.includes(userId)
  ) {
    return {
      ok: false,
      message: "Giảng viên tạo lịch phải có tên trong danh sách giảng dạy.",
    };
  }
  if (
    roleNames.includes("teaching_assistant") &&
    !roleNames.some((role) => ["admin", "staff"].includes(role)) &&
    requestedLecturerIds.length === 0
  ) {
    return {
      ok: false,
      message: "Trợ giảng phải chọn ít nhất một giảng viên phụ trách.",
    };
  }
  if (requestedLecturerIds.length) {
    const { data: eligibleLecturers } = await supabase.rpc(
      "list_scoped_lecturers",
      {
        target_room_type_id: NURSING_SKILLS_ROOM_TYPE_ID,
      },
    );
    const eligibleIds = new Set(
      ((eligibleLecturers ?? []) as Array<{ id: string }>).map(({ id }) => id),
    );
    if (requestedLecturerIds.some((id) => !eligibleIds.has(id))) {
      return {
        ok: false,
        message: "Giảng viên được chọn không thuộc Loại phòng này.",
      };
    }
  }
  const { data: createdSchedule, error } = await supabase.rpc(
    "create_manual_class_schedule",
    {
      target_course_id: course.id,
      target_room_id: room.id,
      target_lecturer_id: requestedLecturerIds[0] ?? null,
      target_lecturer_2_id: requestedLecturerIds[1] ?? null,
      target_schedule_date: scheduleDate,
      target_start_time: startTime,
      target_end_time: endTime,
      target_note: note || null,
      target_student_count: studentCount,
      target_semester: semester,
    },
  );

  if (error) {
    console.error("RPC Error:", error);
    if (error.code === "23P01") {
      return {
        ok: false,
        message: "Phòng hoặc giảng viên đã có lịch trùng trong khung giờ này.",
      };
    }
    if (error.code === "23514") {
      return {
        ok: false,
        message:
          "Thời gian nằm ngoài ca sáng 07:30–11:30 hoặc ca chiều 12:30–16:30.",
      };
    }
    return { ok: false, message: "Không thể tạo lịch. Vui lòng thử lại." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/class-schedules");
  revalidatePath("/classes/open");
  revalidatePath("/basic-medical/schedules");
  after(processPendingScheduleEmails);
  const returnTo = String(formData.get("return_to") ?? "");
  if (
    returnTo.startsWith("/") &&
    !returnTo.startsWith("//") &&
    createdSchedule
  ) {
    const target = new URL(returnTo, "http://local");
    if (target.pathname === "/equipment/register") {
      target.searchParams.set("schedule", createdSchedule.id);
      redirect(`${target.pathname}?${target.searchParams.toString()}`);
    }
  }
  return { ok: true, message: "Đã tạo lịch thành công." };
}
