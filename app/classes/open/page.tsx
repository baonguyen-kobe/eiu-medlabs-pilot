import { redirect } from "next/navigation";
import {
  ClassRegistrationList,
  type RegistrationClass,
} from "@/components/class-registration-list";
import { WorkspaceShell } from "@/components/workspace-shell";
import { resolveClassDateRange } from "@/lib/class-date-range";
import { isClassStartInFuture } from "@/lib/business-time";
import { getViewer } from "@/lib/viewer";
import Link from "next/link";
import { Plus } from "@/components/icons";
import { defaultWorkspacePath } from "@/lib/workspace-access";
import { NURSING_SKILLS_ROOM_TYPE_ID } from "@/lib/room-types";
import { LocalizedText } from "@/components/i18n/language-provider";

export default async function OpenClassesPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    date?: string;
    from?: string;
    to?: string;
  }>;
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
    isRootAdministrator,
    canManageEmailNotifications,
  } = await getViewer();
  const roomTypeCodes = roomTypes.map(({ code }) => code);
  const hasSkillsScope = roomTypeCodes.includes("nursing_skills");
  const isAllowedRole = roles.some((role) =>
    ["admin", "staff", "lecturer", "teaching_assistant"].includes(role),
  );

  if (!hasSkillsScope || !isAllowedRole) {
    redirect(defaultWorkspacePath(roles, roomTypeCodes));
  }

  const range = resolveClassDateRange(await searchParams);

  const [
    { data },
    { data: people },
    { data: rooms },
    { data: courses },
    scopedLecturerResults,
  ] = await Promise.all([
    supabase
      .from("class_schedules")
      .select(
        `
      id, room_id, course_id, schedule_date, start_time, end_time, course_code_snapshot,
      course_name_snapshot, lecturer_id, lecturer_2_id, student_count, created_by,
      rooms!inner (room_code, building_code, room_type_id, room_types (name))
    `,
      )
      .eq("rooms.room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
      .neq("schedule_status", "cancelled")
      .gte("schedule_date", range.from)
      .lte("schedule_date", range.to)
      .order("schedule_date")
      .order("start_time"),
    supabase.rpc("list_active_people"),
    supabase
      .from("rooms")
      .select("id, room_code, building_code, room_type_id")
      .eq("is_active", true)
      .eq("room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
      .order("room_code"),
    supabase
      .from("courses")
      .select("id, course_code, course_name")
      .eq("is_active", true)
      .eq("room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
      .order("course_code"),
    Promise.all(
      roomTypes
        .filter((rt) => rt.code === "nursing_skills")
        .map(async (roomType) => ({
          roomTypeId: roomType.id,
          result: await supabase.rpc("list_scoped_lecturers", {
            target_room_type_id: roomType.id,
          }),
        })),
    ),
  ]);

  const scheduleIds = (data ?? []).map((s) => s.id);
  const { data: lockStatuses } = scheduleIds.length
    ? await supabase.rpc("get_class_schedules_equipment_lock_status", {
        target_schedule_ids: scheduleIds,
      })
    : { data: [] };

  const lockMap = new Map(
    (
      (lockStatuses ?? []) as Array<{
        schedule_id: string;
        has_equipment_request: boolean;
      }>
    ).map((item) => [item.schedule_id, item.has_equipment_request]),
  );

  const activePeople = (people ?? []) as Array<{
    id: string;
    full_name: string;
    title: string | null;
  }>;
  const peopleById = new Map(
    activePeople.map((person) => [person.id, person.full_name]),
  );

  const classes: RegistrationClass[] = (data ?? []).map((item) => {
    const room = item.rooms as unknown as {
      room_code: string;
      building_code: string;
      room_type_id: string;
      room_types: { name: string } | null;
    } | null;
    return {
      ...item,
      course_id: item.course_id,
      created_by: item.created_by,
      has_equipment_request: lockMap.get(item.id) ?? false,
      lecturerNames: [item.lecturer_id, item.lecturer_2_id]
        .filter(Boolean)
        .map((id) => peopleById.get(id as string) ?? "Giảng viên"),
      claimable: isClassStartInFuture(item.schedule_date, item.start_time),
      roomLabel: room
        ? `${room.room_code} · ${room.building_code}`
        : "Chưa xếp phòng",
      roomId: item.room_id,
      roomTypeId: room?.room_type_id ?? "",
      roomTypeName: room?.room_types?.name ?? "Kỹ năng Điều dưỡng",
    };
  });

  const lecturerOptionsByRoomType = Object.fromEntries(
    scopedLecturerResults.map(({ roomTypeId, result }) => [
      roomTypeId,
      ((result.data ?? []) as Array<{ id: string; full_name: string }>).map(
        (person) => ({ value: person.id, label: person.full_name }),
      ),
    ]),
  );
  const canCreate = roles.some((role) =>
    ["admin", "staff", "teaching_assistant", "lecturer"].includes(role),
  );

  return (
    <WorkspaceShell
      fullName={fullName}
      roles={roles}
      roomTypeCodes={roomTypeCodes}
      allowBasicMedicalAccess={allowBasicMedicalAccess}
      canImportSchedules={canImportSchedules}
      canManagePersonnel={canManagePersonnel}
      canManageEmailNotifications={canManageEmailNotifications}
      title={<LocalizedText text={"Lớp đang mở"} />}
      description={
        <LocalizedText
          text="Toàn bộ lớp Kỹ năng Điều dưỡng từ {0} đến {1}."
          values={[
            range.from.split("-").reverse().join("/"),
            range.to.split("-").reverse().join("/"),
          ]}
        />
      }
      actions={
        canCreate ? (
          <Link className="button button-primary" href="/schedule-entry/new">
            <Plus size={17} />
            <LocalizedText text={" Tạo phiếu mới thủ công"} />
          </Link>
        ) : null
      }
    >
      <ClassRegistrationList
        classes={classes}
        mode="open"
        viewerId={userId}
        roles={roles}
        range={range}
        courses={courses ?? []}
        lecturerOptionsByRoomType={lecturerOptionsByRoomType}
        roomTypeOptions={roomTypes.filter((rt) => rt.code === "nursing_skills")}
        roomOptions={(rooms ?? []).map((room) => ({
          id: room.id,
          label: `${room.room_code} · ${room.building_code}`,
          roomTypeId: room.room_type_id,
        }))}
        isRootAdministrator={isRootAdministrator}
      />
    </WorkspaceShell>
  );
}
