"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { processPendingScheduleEmails } from "@/lib/email-notifications";
import { isValidBasicMedicalSessionTime } from "@/lib/business-time";
import { BASIC_MEDICAL_ROOM_TYPE_ID } from "@/lib/room-types";
import { createClient } from "@/lib/supabase/server";

export type BasicRegistrationState = {
  ok: boolean;
  message: string;
  registrationId?: string;
};

type SessionDraft = {
  sessionId?: string;
  date: string;
  startTime: string;
  endTime: string;
  lessonTitle: string;
  teachingLecturerId: string;
};

type RegistrationDraft = {
  courseId: string;
  roomId: string;
  responsibleId: string;
  academicYear: string;
  semester: string;
  startDate: string;
  endDate: string;
  studentCount: number;
  note: string;
  sessions: SessionDraft[];
};

function parseRegistrationDraft(formData: FormData) {
  const draft: RegistrationDraft = {
    courseId: String(formData.get("course_id") ?? ""),
    roomId: String(formData.get("room_id") ?? ""),
    responsibleId: String(formData.get("responsible_lecturer_id") ?? ""),
    academicYear: String(formData.get("academic_year") ?? "").trim(),
    semester: String(formData.get("semester") ?? ""),
    startDate: String(formData.get("start_date") ?? ""),
    endDate: String(formData.get("end_date") ?? ""),
    studentCount: Number(formData.get("student_count")),
    note: String(formData.get("note") ?? "").trim(),
    sessions: [],
  };
  try {
    draft.sessions = JSON.parse(String(formData.get("sessions") ?? "[]"));
  } catch {
    return { error: "Danh sách buổi học không hợp lệ." } as const;
  }
  if (!/^\d{4}-\d{4}$/.test(draft.academicYear))
    return {
      error: "Năm học phải có định dạng YYYY-YYYY, ví dụ 2026-2027.",
    } as const;
  const [academicStart, academicEnd] = draft.academicYear
    .split("-")
    .map(Number);
  if (academicEnd !== academicStart + 1)
    return {
      error: "Năm học phải gồm hai năm liên tiếp, ví dụ 2026-2027.",
    } as const;
  if (!["HK1", "HK2", "HK3", "HK4"].includes(draft.semester))
    return { error: "Vui lòng chọn Học kỳ." } as const;
  if (!draft.startDate)
    return { error: "Vui lòng chọn Ngày bắt đầu." } as const;
  if (!draft.endDate) return { error: "Vui lòng chọn Ngày kết thúc." } as const;
  if (draft.endDate < draft.startDate)
    return {
      error: "Ngày kết thúc phải bằng hoặc sau Ngày bắt đầu.",
    } as const;
  if (!draft.courseId) return { error: "Vui lòng chọn Môn học." } as const;
  if (!draft.roomId) return { error: "Vui lòng chọn Phòng/Lab." } as const;
  if (!Number.isInteger(draft.studentCount) || draft.studentCount < 1)
    return {
      error: "Số lượng sinh viên phải là số nguyên dương.",
    } as const;
  if (!draft.responsibleId)
    return { error: "Vui lòng chọn Giảng viên phụ trách." } as const;
  if (!Array.isArray(draft.sessions) || draft.sessions.length < 1)
    return { error: "Phiếu phải có ít nhất một buổi học." } as const;

  for (const [index, session] of draft.sessions.entries()) {
    const number = index + 1;
    if (!session || typeof session !== "object")
      return { error: `Buổi ${number} không hợp lệ.` } as const;
    if (!session.date)
      return {
        error: `Buổi ${number}: Vui lòng chọn Ngày học.`,
      } as const;
    if (session.date < draft.startDate || session.date > draft.endDate)
      return {
        error: `Buổi ${number}: Ngày học phải nằm trong khoảng đăng ký.`,
      } as const;
    if (!isValidBasicMedicalSessionTime(session.startTime, session.endTime))
      return {
        error: `Buổi ${number}: Giờ bắt đầu phải từ 07:00 đến 20:30, giờ kết thúc không quá 21:00 và phải sau giờ bắt đầu.`,
      } as const;
    if (!String(session.lessonTitle ?? "").trim())
      return {
        error: `Buổi ${number}: Vui lòng nhập Tên bài TN-TH.`,
      } as const;
    if (!session.teachingLecturerId)
      return {
        error: `Buổi ${number}: Vui lòng chọn Giảng viên giảng dạy/hướng dẫn.`,
      } as const;
    if (
      session.sessionId !== undefined &&
      !/^[0-9a-f-]{36}$/i.test(session.sessionId)
    )
      return { error: `Buổi ${number}: mã định danh không hợp lệ.` } as const;
  }
  const existingSessionIds = draft.sessions
    .map((session) => session.sessionId)
    .filter((sessionId): sessionId is string => Boolean(sessionId));
  if (new Set(existingSessionIds).size !== existingSessionIds.length)
    return { error: "Không được lặp mã định danh buổi học." } as const;
  return { draft } as const;
}

async function saveBasicMedicalRegistration(
  formData: FormData,
  registrationId: string | null,
): Promise<BasicRegistrationState> {
  const parsed = parseRegistrationDraft(formData);
  if ("error" in parsed)
    return {
      ok: false,
      message: parsed.error ?? "Dữ liệu phiếu Y cơ sở không hợp lệ.",
    };
  const { draft } = parsed;
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { ok: false, message: "Phiên đăng nhập đã hết hạn." };

  const [courseResult, roomResult, lecturersResult, rolesResult] =
    await Promise.all([
      supabase
        .from("courses")
        .select("id")
        .eq("id", draft.courseId)
        .eq("is_active", true)
        .eq("room_type_id", BASIC_MEDICAL_ROOM_TYPE_ID)
        .maybeSingle(),
      supabase
        .from("rooms")
        .select("id")
        .eq("id", draft.roomId)
        .eq("is_active", true)
        .contains("usage_scopes", ["basic_medical"])
        .maybeSingle(),
      supabase.rpc("list_basic_medical_instructors"),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
  const hasRole = (rolesResult.data ?? []).some(({ role }) =>
    ["admin", "staff", "teaching_assistant", "lecturer"].includes(role),
  );
  const allowedLecturerIds = new Set(
    ((lecturersResult.data ?? []) as Array<{ id: string }>).map(({ id }) => id),
  );
  if (!courseResult.data || !roomResult.data || !hasRole)
    return {
      ok: false,
      message: "Bạn không có quyền hoặc môn/phòng không hợp lệ.",
    };
  if (
    !allowedLecturerIds.has(draft.responsibleId) ||
    draft.sessions.some(
      (session) => !allowedLecturerIds.has(session.teachingLecturerId),
    )
  )
    return {
      ok: false,
      message: "Giảng viên không thuộc phạm vi Y cơ sở.",
    };

  const { data: savedId, error } = await supabase.rpc(
    "save_basic_medical_registration",
    {
      target_registration_id: registrationId,
      target_academic_year: draft.academicYear,
      target_semester: draft.semester,
      target_start_date: draft.startDate,
      target_end_date: draft.endDate,
      target_course_id: draft.courseId,
      target_room_id: draft.roomId,
      target_student_count: draft.studentCount,
      target_responsible_lecturer_id: draft.responsibleId,
      target_note: draft.note,
      target_sessions: draft.sessions.map((session) => ({
        session_id: session.sessionId ?? null,
        schedule_date: session.date,
        start_time: session.startTime,
        end_time: session.endTime,
        lesson_title: session.lessonTitle.trim(),
        teaching_lecturer_id: session.teachingLecturerId,
      })),
    },
  );
  if (error || !savedId)
    return {
      ok: false,
      message:
        error?.code === "23P01"
          ? "Có buổi bị trùng phòng hoặc giảng viên. Phiếu chưa được thay đổi."
          : error?.message || "Không thể lưu phiếu Y cơ sở.",
    };

  after(processPendingScheduleEmails);

  revalidatePath("/basic-medical/new");
  revalidatePath("/basic-medical/schedules");
  revalidatePath("/basic-medical/registrations");
  revalidatePath("/class-schedules");
  return {
    ok: true,
    message: registrationId
      ? "Đã lưu điều chỉnh. ID phiếu được giữ nguyên."
      : `Đã tạo phiếu Y cơ sở với ${draft.sessions.length} buổi học.`,
    registrationId: savedId,
  };
}

export async function createBasicMedicalRegistration(
  _state: BasicRegistrationState,
  formData: FormData,
) {
  return saveBasicMedicalRegistration(formData, null);
}

export async function updateBasicMedicalRegistration(
  _state: BasicRegistrationState,
  formData: FormData,
) {
  const registrationId = String(formData.get("registration_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(registrationId))
    return { ok: false, message: "Phiếu Y cơ sở không hợp lệ." };
  return saveBasicMedicalRegistration(formData, registrationId);
}
