import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { EquipmentFulfillmentWorkspace } from "@/components/equipment-fulfillment-workspace";
import {
  fulfillmentSchema,
  type FulfillmentSummary,
} from "@/lib/equipment-fulfillment";
import { isEquipmentRequestId } from "@/lib/equipment-calendar-request";
import { formatEquipmentRequestCode } from "@/lib/equipment-request-code";
import { getViewer } from "@/lib/viewer";
import { LocalizedText } from "@/components/i18n/language-provider";

const timeFormat = new Intl.DateTimeFormat("vi-VN", {
  hour: "2-digit",
  minute: "2-digit",
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Ho_Chi_Minh",
});

type RequestRow = {
  created_at: string;
  receive_at: string;
  return_at: string;
  registrant: { full_name: string } | null;
  responsible: { full_name: string } | null;
  class_schedules: {
    schedule_date: string;
    start_time: string;
    end_time: string;
    course_code_snapshot: string;
    course_name_snapshot: string;
    rooms: { room_code: string; building_code: string } | null;
  } | null;
};

export default async function FulfillmentPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  if (!isEquipmentRequestId(requestId)) notFound();
  const viewer = await getViewer();
  const [{ data, error }, { data: row }, { data: peopleRows }] =
    await Promise.all([
      viewer.supabase.rpc("equipment_fulfillment_read", {
        p_request_id: requestId,
      }),
      viewer.supabase
        .from("equipment_requests")
        .select(
          "created_at,receive_at,return_at,registrant:profiles!equipment_requests_registrant_id_fkey(full_name),responsible:profiles!equipment_requests_responsible_lecturer_id_fkey(full_name),class_schedules(schedule_date,start_time,end_time,course_code_snapshot,course_name_snapshot,rooms(room_code,building_code))",
        )
        .eq("id", requestId)
        .maybeSingle(),
      viewer.supabase.rpc("list_active_people"),
    ]);
  if (error) {
    if (error.code === "42501") notFound();
    throw new Error("Không tải được bàn giao / thu hồi thiết bị.");
  }
  const request = row as unknown as RequestRow | null;
  const schedule = request?.class_schedules;
  const summary: FulfillmentSummary = {
    code: request ? formatEquipmentRequestCode(request.created_at) : "",
    course: schedule
      ? `${schedule.course_code_snapshot} · ${schedule.course_name_snapshot}`
      : "",
    room: schedule?.rooms
      ? `${schedule.rooms.building_code}-${schedule.rooms.room_code}`
      : "",
    session: schedule
      ? `${schedule.schedule_date.split("-").reverse().join("/")} · ${schedule.start_time.slice(0, 5)}–${schedule.end_time.slice(0, 5)}`
      : "",
    handover: request
      ? `${timeFormat.format(new Date(request.receive_at))} → ${timeFormat.format(new Date(request.return_at))}`
      : "",
    registrant: request?.registrant?.full_name ?? "",
    responsible: request?.responsible?.full_name ?? "",
  };
  // Names for the history; ids the viewer cannot resolve stay unnamed.
  const people = Object.fromEntries(
    ((peopleRows ?? []) as Array<{ id: string; full_name: string }>).map(
      (person) => [person.id, person.full_name],
    ),
  );

  return (
    <WorkspaceShell
      fullName={viewer.fullName}
      roles={viewer.roles}
      roomTypeCodes={viewer.roomTypes.map(({ code }) => code)}
      allowBasicMedicalAccess={viewer.allowBasicMedicalAccess}
      canImportSchedules={viewer.canImportSchedules}
      canManagePersonnel={viewer.canManagePersonnel}
      canManageEmailNotifications={viewer.canManageEmailNotifications}
      title={<LocalizedText text={"Bàn giao và thu hồi"} />}
      description={
        <LocalizedText
          text={
            "Thực giao/thực nhận ghi kho ngay. Chữ ký xác nhận riêng, không ghi kho lần hai."
          }
        />
      }
    >
      <EquipmentFulfillmentWorkspace
        initial={fulfillmentSchema.parse(data)}
        summary={summary}
        people={people}
      />
    </WorkspaceShell>
  );
}
