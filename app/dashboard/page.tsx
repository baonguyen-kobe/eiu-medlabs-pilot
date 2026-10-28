import { addDays, endOfMonth, format, startOfMonth } from "date-fns";
import {
  CalendarDays,
  GraduationCap,
  PackageCheck,
  Plus,
} from "@/components/icons";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import {
  businessToday,
  businessTodayString,
  formatBusinessDate,
} from "@/lib/business-time";
import { getViewer } from "@/lib/viewer";
import { NURSING_SKILLS_ROOM_TYPE_ID } from "@/lib/room-types";
import {
  canUseSkillsWorkspace,
  canViewBasicMedicalSchedules,
} from "@/lib/workspace-access";
import { normalizeCalendarEquipmentRequest } from "@/lib/equipment-calendar-request";
import { LocalizedText } from "@/components/i18n/language-provider";
import { LocalizedElement } from "@/components/i18n/localized-element";

export default async function DashboardPage() {
  const {
    supabase,
    fullName,
    roles,
    roomTypes,
    allowBasicMedicalAccess,
    canImportSchedules,
    canManagePersonnel,
    canManageEmailNotifications,
  } = await getViewer();
  const roomTypeCodes = roomTypes.map(({ code }) => code);
  if (
    !canUseSkillsWorkspace(roles, roomTypeCodes) &&
    canViewBasicMedicalSchedules(roles, roomTypeCodes)
  ) {
    redirect("/basic-medical/schedules");
  }
  const today = businessToday();
  const todayText = businessTodayString();
  const monthStartText = format(startOfMonth(today), "yyyy-MM-dd");
  const monthEnd = endOfMonth(today);
  const upcomingEnd = addDays(today, 7);
  const monthEndText = format(monthEnd, "yyyy-MM-dd");
  const upcomingEndText = format(upcomingEnd, "yyyy-MM-dd");
  const queryEndText = format(
    monthEnd.getTime() > upcomingEnd.getTime() ? monthEnd : upcomingEnd,
    "yyyy-MM-dd",
  );

  const [{ data: schedules }, { data: people }] = await Promise.all([
    supabase
      .from("class_schedules")
      .select(
        `
        id, schedule_date, start_time, end_time, course_code_snapshot,
        course_name_snapshot, lecturer_id, lecturer_2_id, schedule_status,
        rooms!inner (room_code, building_code, room_type_id),
        equipment_requests (id, status)
      `,
      )
      .eq("rooms.room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
      .gte("schedule_date", monthStartText)
      .lte("schedule_date", queryEndText)
      .neq("schedule_status", "cancelled")
      .order("schedule_date")
      .order("start_time"),
    supabase.rpc("list_active_people"),
  ]);

  const classRows = schedules ?? [];
  const peopleById = new Map(
    ((people ?? []) as Array<{ id: string; full_name: string }>).map(
      (person) => [person.id, person.full_name],
    ),
  );
  const activeClasses = classRows.filter(
    ({ schedule_status }) => schedule_status !== "cancelled",
  );
  const monthClasses = activeClasses.filter(
    ({ schedule_date }) =>
      schedule_date >= monthStartText && schedule_date <= monthEndText,
  );
  const upcomingClasses = activeClasses.filter(
    ({ schedule_date }) =>
      schedule_date >= todayText && schedule_date <= upcomingEndText,
  );
  const openClasses = monthClasses.filter(
    ({ lecturer_id, lecturer_2_id }) => !lecturer_id && !lecturer_2_id,
  );
  const monthClassesWithoutEffectiveEquipmentRequest = monthClasses.filter(
    (schedule) => {
      const equipmentRequest = normalizeCalendarEquipmentRequest(
        schedule.equipment_requests,
      );
      return !equipmentRequest || equipmentRequest.status === "cancelled";
    },
  );
  const canImport = roles.some((role) =>
    ["admin", "staff", "teaching_assistant"].includes(role),
  );
  const canCreate =
    canImport ||
    (roles.includes("lecturer") &&
      roomTypes.some(({ id }) => id === NURSING_SKILLS_ROOM_TYPE_ID));
  const displayRole = roles.includes("admin")
    ? "admin"
    : roles.includes("staff")
      ? "staff"
      : roles.includes("lecturer")
        ? "lecturer"
        : roles.includes("teaching_assistant")
          ? "teaching_assistant"
          : "viewer";
  const lecturerView = displayRole === "lecturer";

  return (
    <WorkspaceShell
      fullName={fullName}
      roles={roles}
      roomTypeCodes={roomTypeCodes}
      allowBasicMedicalAccess={allowBasicMedicalAccess}
      canImportSchedules={canImportSchedules}
      canManagePersonnel={canManagePersonnel}
      canManageEmailNotifications={canManageEmailNotifications}
      title={<LocalizedText text={"Tổng quan"} />}
      description={
        <LocalizedText
          text="Hôm nay {0}"
          values={[formatBusinessDate(todayText)]}
        />
      }
      actions={
        canCreate ? (
          <>
            {canImport ? (
              <Link
                className="button button-secondary"
                href="/schedule-entry/import"
              >
                <LocalizedText text={"Import lịch Skills lab"} />
              </Link>
            ) : null}
            <Link className="button button-primary" href="/schedule-entry/new">
              <Plus size={17} />
              <LocalizedText text={" Tạo lịch"} />
            </Link>
          </>
        ) : undefined
      }
    >
      <LocalizedElement
        as="section"
        textAttributes={["aria-label"]}
        className="kpi-grid"
        aria-label="Chỉ số tổng quan"
      >
        <article className="kpi-card kpi-teal">
          <div className="kpi-icon">
            <CalendarDays />
          </div>
          <span>
            <LocalizedText text={"Tổng lớp học trong tháng"} />
          </span>
          <strong>{monthClasses.length}</strong>
        </article>
        <article className="kpi-card kpi-indigo">
          <div className="kpi-icon">
            <GraduationCap />
          </div>
          <span>
            <LocalizedText text={"Số lớp đã có Giảng viên"} />
          </span>
          <strong>{monthClasses.length - openClasses.length}</strong>
        </article>
        <article className="kpi-card kpi-amber">
          <div className="kpi-icon">
            <GraduationCap />
          </div>
          <span>
            <LocalizedText text={"Số lớp chưa có Giảng viên"} />
          </span>
          <strong>{openClasses.length}</strong>
        </article>
        <article className="kpi-card kpi-violet">
          <div className="kpi-icon">
            <PackageCheck />
          </div>
          <span>
            <LocalizedText text={"Số lớp chưa đăng ký thiết bị"} />
          </span>
          <strong>{monthClassesWithoutEffectiveEquipmentRequest.length}</strong>
        </article>
      </LocalizedElement>

      <section className="overview-grid">
        <article className="overview-panel overview-schedule-panel">
          <div className="overview-panel-heading">
            <h2>
              <LocalizedText text={"LỊCH HỌC 7 NGÀY TỚI"} />
            </h2>
            <Link href="/class-schedules">
              <LocalizedText text={"Xem lịch Skills lab"} />
            </Link>
          </div>
          <LocalizedElement
            as="div"
            textAttributes={["aria-label"]}
            className="responsive-table"
            role="region"
            aria-label="Lịch học 7 ngày tới; vuốt ngang để xem đầy đủ"
            tabIndex={0}
          >
            <table className="data-table overview-schedule-table">
              <thead>
                <tr>
                  <th>
                    <LocalizedText text={"Ngày"} />
                  </th>
                  <th>
                    <LocalizedText text={"Thời gian"} />
                  </th>
                  <th>
                    <LocalizedText text={"Mã môn"} />
                  </th>
                  <th>
                    <LocalizedText text={"Tên môn học"} />
                  </th>
                  <th>
                    <LocalizedText text={"Phòng"} />
                  </th>
                  <th>
                    <LocalizedText text={"Giảng viên"} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {upcomingClasses.slice(0, 8).map((schedule) => {
                  const room = schedule.rooms as unknown as {
                    room_code: string;
                    building_code: string;
                  } | null;
                  return (
                    <tr key={schedule.id}>
                      <td>{formatBusinessDate(schedule.schedule_date)}</td>
                      <td className="mono">
                        {schedule.start_time.slice(0, 5)}–
                        {schedule.end_time.slice(0, 5)}
                      </td>
                      <td>
                        <strong>{schedule.course_code_snapshot}</strong>
                      </td>
                      <td>{schedule.course_name_snapshot}</td>
                      <td>
                        {room ? (
                          `${room.room_code} · ${room.building_code}`
                        ) : (
                          <LocalizedText text={"Chưa có phòng"} />
                        )}
                      </td>
                      <td className="lecturer-name">
                        {schedule.lecturer_id || schedule.lecturer_2_id ? (
                          <span className="lecturer-name-list">
                            {[schedule.lecturer_id, schedule.lecturer_2_id]
                              .filter(Boolean)
                              .map((id) => (
                                <strong key={id as string}>
                                  {peopleById.get(id as string) ?? (
                                    <LocalizedText text={"Giảng viên"} />
                                  )}
                                </strong>
                              ))}
                          </span>
                        ) : (
                          <strong>
                            <LocalizedText text={"Chưa có giảng viên"} />
                          </strong>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </LocalizedElement>
          {!upcomingClasses.length ? (
            <p className="panel-empty">
              <LocalizedText text={"Chưa có lịch học trong 7 ngày tới."} />
            </p>
          ) : null}
        </article>

        {lecturerView ? (
          <article className="overview-panel">
            <div className="overview-panel-heading">
              <div>
                <span>
                  <LocalizedText text={"Giảng viên"} />
                </span>
                <h2>
                  <LocalizedText text={"Lớp đang mở gần nhất"} />
                </h2>
              </div>
              <Link href="/classes/open">
                <LocalizedText text={"Xem tất cả"} />
              </Link>
            </div>
            <div className="overview-list">
              {openClasses.slice(0, 6).map((schedule) => (
                <div key={schedule.id}>
                  <time>{formatBusinessDate(schedule.schedule_date)}</time>
                  <strong>{schedule.course_code_snapshot}</strong>
                  <span>
                    {schedule.start_time.slice(0, 5)}–
                    {schedule.end_time.slice(0, 5)}
                  </span>
                  <small>{schedule.course_name_snapshot}</small>
                </div>
              ))}
              {!openClasses.length ? (
                <p className="empty-state">
                  <LocalizedText text={"Không có lớp đang chờ nhận."} />
                </p>
              ) : null}
            </div>
          </article>
        ) : null}
      </section>
    </WorkspaceShell>
  );
}
