import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { EquipmentFulfillmentWorkspace } from "@/components/equipment-fulfillment-workspace";
import { fulfillmentSchema } from "@/lib/equipment-fulfillment";
import { isEquipmentRequestId } from "@/lib/equipment-calendar-request";
import { getViewer } from "@/lib/viewer";

export default async function FulfillmentPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  if (!isEquipmentRequestId(requestId)) notFound();
  const viewer = await getViewer();
  const { data, error } = await viewer.supabase.rpc(
    "equipment_fulfillment_read",
    { p_request_id: requestId },
  );
  if (error) {
    if (error.code === "42501") notFound();
    throw new Error("Không tải được bàn giao / thu hồi thiết bị.");
  }
  return (
    <WorkspaceShell
      fullName={viewer.fullName}
      roles={viewer.roles}
      roomTypeCodes={viewer.roomTypes.map(({ code }) => code)}
      allowBasicMedicalAccess={viewer.allowBasicMedicalAccess}
      canImportSchedules={viewer.canImportSchedules}
      canManagePersonnel={viewer.canManagePersonnel}
      canManageEmailNotifications={viewer.canManageEmailNotifications}
      title="Bàn giao và thu hồi"
      description="Thực giao/thực nhận ghi kho ngay. Chữ ký xác nhận riêng, không ghi kho lần hai."
    >
      <EquipmentFulfillmentWorkspace initial={fulfillmentSchema.parse(data)} />
    </WorkspaceShell>
  );
}
