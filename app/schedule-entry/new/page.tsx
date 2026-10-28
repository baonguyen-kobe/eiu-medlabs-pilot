import { getInterfaceText } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { ScheduleForm } from "@/components/schedule-form";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getViewer } from "@/lib/viewer";
import { NURSING_SKILLS_ROOM_TYPE_ID } from "@/lib/room-types";
import {
  canUseSkillsWorkspace,
  defaultWorkspacePath,
} from "@/lib/workspace-access";
import { LocalizedText } from "@/components/i18n/language-provider";

export async function generateMetadata() {
  const text = await getInterfaceText();
  return { title: text("Tạo lịch Skills lab") };
}

function equipmentRegisterReturnTo(value?: string) {
  if (!value?.startsWith("/") || value.startsWith("//")) return undefined;
  const target = new URL(value, "http://local");
  return target.pathname === "/equipment/register"
    ? `${target.pathname}${target.search}`
    : undefined;
}

export default async function NewSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
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
  } = await getViewer();
  const roomTypeCodes = roomTypes.map(({ code }) => code);
  if (!canUseSkillsWorkspace(roles, roomTypeCodes)) {
    redirect(defaultWorkspacePath(roles, roomTypeCodes));
  }
  const query = await searchParams;
  const returnTo = equipmentRegisterReturnTo(query.returnTo);

  const [{ data: courses }, { data: rooms }, { data: lecturerRoles }] =
    await Promise.all([
      supabase
        .from("courses")
        .select("id, course_code, course_name")
        .eq("is_active", true)
        .eq("room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
        .order("course_code"),
      supabase
        .from("rooms")
        .select("id, room_code, building_code, room_name, room_type_id")
        .eq("is_active", true)
        .eq("room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
        .order("building_code")
        .order("room_code"),
      supabase.from("user_roles").select("user_id").eq("role", "lecturer"),
    ]);

  if (
    !roles.some((role) =>
      ["admin", "staff", "teaching_assistant", "lecturer"].includes(role),
    )
  ) {
    redirect("/dashboard");
  }

  const lecturerIds = (lecturerRoles ?? []).map(({ user_id }) => user_id);
  const { data: activePeople } = lecturerIds.length
    ? await supabase.rpc("list_scoped_lecturers", {
        target_room_type_id: NURSING_SKILLS_ROOM_TYPE_ID,
      })
    : { data: [] };
  const lecturerIdSet = new Set(lecturerIds);
  const lecturers = (
    (activePeople ?? []) as Array<{
      id: string;
      full_name: string;
      title: string | null;
    }>
  )
    .filter((person) => lecturerIdSet.has(person.id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "vi"));

  return (
    <WorkspaceShell
      fullName={fullName}
      roles={roles}
      roomTypeCodes={roomTypeCodes}
      allowBasicMedicalAccess={allowBasicMedicalAccess}
      canImportSchedules={canImportSchedules}
      canManagePersonnel={canManagePersonnel}
      canManageEmailNotifications={canManageEmailNotifications}
      title={<LocalizedText text={"Tạo lịch Skills lab"} />}
      description={
        <LocalizedText
          text={"Lịch hợp lệ được tạo và hiển thị ngay trong hệ thống."}
        />
      }
    >
      <ScheduleForm
        courses={courses ?? []}
        rooms={rooms ?? []}
        lecturers={lecturers ?? []}
        canAssignLecturer={roles.some((role) =>
          ["admin", "staff", "teaching_assistant", "lecturer"].includes(role),
        )}
        defaultLecturerId={
          roles.includes("lecturer") &&
          !roles.some((role) => ["admin", "staff"].includes(role))
            ? userId
            : undefined
        }
        scope="skills_lab"
        returnTo={returnTo}
      />
    </WorkspaceShell>
  );
}
