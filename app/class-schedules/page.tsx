import { LocalizedText } from "@/components/i18n/language-provider";
import { Dashboard } from "@/components/dashboard";
import { redirect } from "next/navigation";
import {
  addDays,
  addMonths,
  format,
  isSameMonth,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScheduleEvent } from "@/lib/demo-data";
import { businessToday, businessTodayString } from "@/lib/business-time";
import { normalizeCalendarEquipmentRequest } from "@/lib/equipment-calendar-request";
import { NURSING_SKILLS_ROOM_TYPE_ID } from "@/lib/room-types";
import {
  canUseSkillsWorkspace,
  defaultWorkspacePath,
} from "@/lib/workspace-access";

type Role = "admin" | "lecturer" | "staff" | "teaching_assistant" | "viewer";
type ViewMode = "month" | "week" | "list";

export default async function ClassSchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; week?: string }>;
}) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();

  if (!claimsData?.claims?.sub) {
    redirect("/login");
  }

  const query = await searchParams;
  const requestedDate = query.date ?? query.week;
  const parsedDate = requestedDate ? parseISO(requestedDate) : businessToday();
  const baseDate = isValid(parsedDate) ? parsedDate : businessToday();
  const hasExplicitView = ["month", "week", "list"].includes(query.view ?? "");
  const viewMode: ViewMode = hasExplicitView
    ? (query.view as ViewMode)
    : "week";
  const weekStart = startOfWeek(baseDate, { weekStartsOn: 1 });
  const monthStart = startOfMonth(baseDate);
  const periodStart =
    viewMode === "month"
      ? startOfWeek(monthStart, { weekStartsOn: 1 })
      : weekStart;
  const periodEnd =
    viewMode === "month" ? addDays(periodStart, 41) : addDays(weekStart, 6);
  const periodStartText = format(periodStart, "yyyy-MM-dd");
  const periodEndText = format(periodEnd, "yyyy-MM-dd");

  const [
    { data: profile },
    { data: roleRows },
    { data: schedules },
    { data: shifts },
    { data: people },
    { data: roomTypes },
    { data: scopedLecturers },
    { data: rooms },
    { data: personnelAuthority },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "full_name, allow_basic_medical_access, can_manage_email_notifications",
      )
      .eq("id", claimsData.claims.sub)
      .single(),
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", claimsData.claims.sub),
    supabase
      .from("class_schedules")
      .select(
        `
        id, room_id, schedule_date, start_time, end_time, course_code_snapshot,
        course_name_snapshot, lecturer_id, lecturer_2_id, schedule_status, source, note, student_count,
        rooms!inner (room_code, building_code, room_type_id),
        equipment_requests (id, status)
      `,
      )
      .eq("rooms.room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
      .gte("schedule_date", periodStartText)
      .lte("schedule_date", periodEndText)
      .neq("schedule_status", "cancelled")
      .order("schedule_date")
      .order("start_time"),
    supabase
      .from("staff_shifts")
      .select(
        "id, staff_id, shift_date, start_time, end_time, shift_slot, status, note",
      )
      .gte("shift_date", periodStartText)
      .lte("shift_date", periodEndText)
      .neq("status", "cancelled")
      .order("shift_date")
      .order("start_time"),
    supabase.rpc("list_active_people"),
    supabase.from("room_types").select("id, code, name").eq("is_active", true),
    supabase.rpc("list_scoped_lecturers", {
      target_room_type_id: NURSING_SKILLS_ROOM_TYPE_ID,
    }),
    supabase
      .from("rooms")
      .select("id, room_code, building_code, room_type_id")
      .eq("room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
      .eq("is_active", true)
      .order("room_code"),
    supabase.rpc("get_personnel_authority_context"),
  ]);

  const roles = (roleRows ?? []).map((row) => row.role as Role);
  const roomTypeCodes = (roomTypes ?? []).map(({ code }) => code);
  if (!canUseSkillsWorkspace(roles, roomTypeCodes)) {
    redirect(defaultWorkspacePath(roles, roomTypeCodes));
  }
  const referencedLecturerIds = (schedules ?? []).flatMap((schedule) =>
    [schedule.lecturer_id, schedule.lecturer_2_id].filter((id): id is string =>
      Boolean(id),
    ),
  );
  const adminClient = createAdminClient();
  const [{ data: rootPrincipal }, { data: historicalPeople }] =
    await Promise.all([
      adminClient
        .from("system_security_principals")
        .select("root_admin_id")
        .eq("singleton", true)
        .maybeSingle(),
      referencedLecturerIds.length
        ? adminClient
            .from("profiles")
            .select("id,full_name")
            .in("id", [...new Set(referencedLecturerIds)])
        : Promise.resolve({ data: [] }),
    ]);
  const activePeople = (people ?? []) as Array<{
    id: string;
    full_name: string;
    title: string | null;
  }>;
  const peopleById = new Map(
    [
      ...activePeople,
      ...((historicalPeople ?? []) as Array<{ id: string; full_name: string }>),
    ].map((person) => [person.id, person.full_name]),
  );
  const weekdayLabels = [
    "Thứ Hai",
    "Thứ Ba",
    "Thứ Tư",
    "Thứ Năm",
    "Thứ Sáu",
    "Thứ Bảy",
    "Chủ nhật",
  ];
  const todayText = businessTodayString();
  const rootAdminId = rootPrincipal?.root_admin_id ?? null;
  const dayCount = viewMode === "month" ? 42 : 7;
  const calendarDays = Array.from({ length: dayCount }, (_, index) => {
    const date = addDays(periodStart, index);
    const dateText = format(date, "yyyy-MM-dd");
    const weekdayIndex = (date.getDay() + 6) % 7;
    return {
      date: dateText,
      weekday: weekdayLabels[weekdayIndex],
      day: format(date, "dd"),
      today: dateText === todayText,
      sunday: weekdayIndex === 6,
      outsideMonth: viewMode === "month" && !isSameMonth(date, baseDate),
    };
  });
  const periodLabel =
    viewMode === "month"
      ? new Intl.DateTimeFormat("vi-VN", {
          month: "long",
          year: "numeric",
          timeZone: "Asia/Ho_Chi_Minh",
        }).format(baseDate)
      : `${format(weekStart, "dd/MM")} – ${format(addDays(weekStart, 6), "dd/MM/yyyy")}`;
  const previousDate =
    viewMode === "month" ? addMonths(baseDate, -1) : addDays(baseDate, -7);
  const nextDate =
    viewMode === "month" ? addMonths(baseDate, 1) : addDays(baseDate, 7);
  const classEvents: ScheduleEvent[] = (schedules ?? []).map((schedule) => {
    const room = schedule.rooms as unknown as {
      room_code: string;
      building_code: string;
      room_type_id: string;
    } | null;
    const lecturerIds = [schedule.lecturer_id, schedule.lecturer_2_id].filter(
      Boolean,
    ) as string[];
    const lecturerNames = lecturerIds.map(
      (id) => peopleById.get(id) ?? "Giảng viên",
    );
    return {
      id: schedule.id,
      type: "class",
      date: schedule.schedule_date,
      start: schedule.start_time.slice(0, 5),
      end: schedule.end_time.slice(0, 5),
      title: schedule.course_code_snapshot,
      subtitle: schedule.course_name_snapshot,
      room: room ? `${room.room_code}. ${room.building_code}` : "Chưa xác định",
      roomId: schedule.room_id,
      person: lecturerNames.length ? lecturerNames.join("\n") : undefined,
      personId: schedule.lecturer_id ?? undefined,
      personIds: lecturerIds,
      status: schedule.schedule_status,
      assigned: Boolean(schedule.lecturer_id),
      source: schedule.source === "import" ? "import" : "manual",
      note: schedule.note ?? undefined,
      owned: lecturerIds.includes(claimsData.claims.sub),
      studentCount: schedule.student_count,
      roomTypeId: room?.room_type_id,
      equipmentRequest: normalizeCalendarEquipmentRequest<
        NonNullable<ScheduleEvent["equipmentRequest"]>["status"]
      >(schedule.equipment_requests),
      rootOperationalAssignment:
        schedule.schedule_date >= todayText &&
        Boolean(rootAdminId && lecturerIds.includes(rootAdminId)),
      rootOperationalAssigneeIds: rootAdminId
        ? lecturerIds.filter((id) => id === rootAdminId)
        : [],
    };
  });
  const shiftEvents: ScheduleEvent[] = (shifts ?? []).map((shift) => {
    return {
      id: shift.id,
      type: "shift",
      date: shift.shift_date,
      start: shift.start_time.slice(0, 5),
      end: shift.end_time.slice(0, 5),
      title: "Ca trực kho",
      subtitle:
        shift.shift_slot === "MORNING"
          ? "Ca sáng"
          : shift.shift_slot === "AFTERNOON"
            ? "Ca chiều"
            : "Ca trực",
      person: peopleById.get(shift.staff_id) ?? "Nhân sự",
      personId: shift.staff_id,
      status: shift.status,
      note: shift.note ?? undefined,
      owned: shift.staff_id === claimsData.claims.sub,
    };
  });

  return (
    <Dashboard
      fullName={
        profile?.full_name ||
        String(claimsData.claims.email ?? <LocalizedText text={"Người dùng"} />)
      }
      roles={roles}
      roomTypeCodes={roomTypeCodes}
      allowBasicMedicalAccess={profile?.allow_basic_medical_access ?? false}
      canManageEmailNotifications={
        roles.includes("admin") ||
        (roles.includes("staff") &&
          (profile?.can_manage_email_notifications ?? false))
      }
      isRootAdministrator={Boolean(
        (
          personnelAuthority as {
            is_root_administrator?: boolean;
          } | null
        )?.is_root_administrator,
      )}
      events={[...classEvents, ...shiftEvents]}
      calendarDays={calendarDays}
      periodLabel={periodLabel}
      previousDate={format(previousDate, "yyyy-MM-dd")}
      nextDate={format(nextDate, "yyyy-MM-dd")}
      anchorDate={format(baseDate, "yyyy-MM-dd")}
      initialView={viewMode}
      hasExplicitView={hasExplicitView}
      todayDate={todayText}
      lecturers={(
        (scopedLecturers ?? []) as Array<{ id: string; full_name: string }>
      ).map(({ id, full_name }) => ({ id, fullName: full_name }))}
      rooms={(rooms ?? []).map((room) => ({
        id: room.id,
        label: `${room.room_code} · ${room.building_code}`,
        roomTypeId: room.room_type_id,
      }))}
    />
  );
}
