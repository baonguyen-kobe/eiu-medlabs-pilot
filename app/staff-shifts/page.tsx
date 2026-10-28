import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { redirect } from "next/navigation";
import { StaffShiftRoster } from "@/components/staff-shift-roster";
import { WorkspaceShell } from "@/components/workspace-shell";
import { businessToday } from "@/lib/business-time";
import { getViewer } from "@/lib/viewer";
import { createAdminClient } from "@/lib/supabase/admin";
import { LocalizedText } from "@/components/i18n/language-provider";

type ShiftView = "week" | "month";
type ShiftTab = "roster" | "register";

export default async function StaffShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; tab?: string }>;
}) {
  const {
    supabase,
    userId,
    fullName,
    roles,
    roomTypes,
    allowBasicMedicalAccess,
    canImportSchedules,
    canManagePersonnel,
    canManageEmailNotifications,
    isRootAdministrator,
  } = await getViewer();

  const isSkillsScope = roomTypes.some((rt) => rt.code === "nursing_skills");
  const isStaffOrAdmin = roles.includes("admin") || roles.includes("staff");
  const isAllowed = isRootAdministrator || (isSkillsScope && isStaffOrAdmin);
  if (!isAllowed) {
    redirect("/dashboard");
  }
  const query = await searchParams;
  const parsedDate = query.date ? parseISO(query.date) : businessToday();
  const baseDate = isValid(parsedDate) ? parsedDate : businessToday();
  const view: ShiftView = query.view === "month" ? "month" : "week";
  const tab: ShiftTab = query.tab === "register" ? "register" : "roster";
  const periodStart =
    view === "month"
      ? startOfWeek(startOfMonth(baseDate), { weekStartsOn: 1 })
      : startOfWeek(baseDate, { weekStartsOn: 1 });
  const periodEnd =
    view === "month"
      ? endOfWeek(endOfMonth(baseDate), { weekStartsOn: 1 })
      : addDays(periodStart, 6);
  const periodStartText = format(periodStart, "yyyy-MM-dd");
  const periodEndText = format(periodEnd, "yyyy-MM-dd");
  const days = Array.from(
    { length: differenceInCalendarDays(periodEnd, periodStart) + 1 },
    (_, index) => format(addDays(periodStart, index), "yyyy-MM-dd"),
  );
  const previousDate =
    view === "month" ? addMonths(baseDate, -1) : addWeeks(baseDate, -1);
  const nextDate =
    view === "month" ? addMonths(baseDate, 1) : addWeeks(baseDate, 1);
  const periodLabel =
    view === "month"
      ? `Tháng ${format(baseDate, "MM/yyyy")}`
      : `${format(periodStart, "dd/MM")} – ${format(periodEnd, "dd/MM/yyyy")}`;

  const [{ data: shifts }, { data: people }, { data: currentProfile }] =
    await Promise.all([
      supabase
        .from("staff_shifts")
        .select(
          "id, staff_id, shift_date, shift_slot, start_time, end_time, note, status, registration_source, creation_group_id",
        )
        .gte("shift_date", periodStartText)
        .lte("shift_date", periodEndText)
        .neq("status", "cancelled")
        .order("shift_date")
        .order("start_time"),
      supabase.rpc("list_operational_shift_assignees"),
      supabase
        .from("profiles")
        .select("can_manage_shift_history")
        .eq("id", userId)
        .maybeSingle(),
    ]);

  const canManageShiftHistory = Boolean(
    isRootAdministrator || currentProfile?.can_manage_shift_history,
  );

  const operationalShiftAssignees = (people ?? []) as Array<{
    id: string;
    full_name: string;
    title: string | null;
  }>;
  const referencedStaffIds = [...(shifts ?? []).map((shift) => shift.staff_id)];
  const { data: historicalPeople } = referencedStaffIds.length
    ? await createAdminClient()
        .from("profiles")
        .select("id,full_name")
        .in("id", [...new Set(referencedStaffIds)])
    : { data: [] };
  const peopleById = new Map(
    [
      ...operationalShiftAssignees,
      ...((historicalPeople ?? []) as Array<{ id: string; full_name: string }>),
    ].map((person) => [person.id, person.full_name]),
  );
  const assignees = operationalShiftAssignees
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "vi"))
    .map((person) => ({ id: person.id, fullName: person.full_name }));

  return (
    <WorkspaceShell
      fullName={fullName}
      roles={roles}
      roomTypeCodes={roomTypes.map(({ code }) => code)}
      allowBasicMedicalAccess={allowBasicMedicalAccess}
      canImportSchedules={canImportSchedules}
      canManagePersonnel={canManagePersonnel}
      canManageEmailNotifications={canManageEmailNotifications}
      title={<LocalizedText text={"Lịch trực"} />}
      description={
        <LocalizedText
          text={"Xem và quản lý lịch trực phòng thực hành Kỹ năng Điều dưỡng."}
        />
      }
    >
      <StaffShiftRoster
        shifts={(shifts ?? []).map((shift) => ({
          ...shift,
          shift_slot: shift.shift_slot as "MORNING" | "AFTERNOON",
          staffName: peopleById.get(shift.staff_id) ?? "",
        }))}
        assignees={assignees}
        userId={userId}
        userFullName={fullName}
        days={days}
        anchorDate={format(baseDate, "yyyy-MM-dd")}
        previousDate={format(previousDate, "yyyy-MM-dd")}
        nextDate={format(nextDate, "yyyy-MM-dd")}
        periodLabel={periodLabel}
        view={view}
        tab={tab}
        isAdmin={roles.includes("admin")}
        canSelfRegister={
          !isRootAdministrator &&
          (roles.includes("staff") || roles.includes("admin"))
        }
        canManageShiftHistory={canManageShiftHistory}
      />
    </WorkspaceShell>
  );
}
