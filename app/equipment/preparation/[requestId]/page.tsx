import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { EquipmentPreparationWorkspace } from "@/components/equipment-preparation-workspace";
import { preparationWorkspaceSchema } from "@/lib/equipment-preparation";
import { isEquipmentRequestId } from "@/lib/equipment-calendar-request";
import { getViewer } from "@/lib/viewer";

export default async function PreparationPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  if (!isEquipmentRequestId(requestId)) notFound();
  const viewer = await getViewer();
  const { data, error } = await viewer.supabase.rpc(
    "equipment_preparation_read",
    { p_request_id: requestId, p_resource: "workspace", p_filters: {} },
  );
  if (error) {
    if (error.code === "42501" || error.message === "S4_DOMAIN_NOT_ENABLED")
      notFound();
    throw new Error("Không tải được phiên chuẩn bị thiết bị.");
  }
  const workspace = preparationWorkspaceSchema.parse(data);
  return (
    <WorkspaceShell
      fullName={viewer.fullName}
      roles={viewer.roles}
      roomTypeCodes={viewer.roomTypes.map(({ code }) => code)}
      allowBasicMedicalAccess={viewer.allowBasicMedicalAccess}
      canImportSchedules={viewer.canImportSchedules}
      canManagePersonnel={viewer.canManagePersonnel}
      canManageEmailNotifications={viewer.canManageEmailNotifications}
      title="Chuẩn bị thiết bị"
      description="Rà soát, phân bổ và giữ cam kết thiết bị; chưa thực hiện bàn giao."
    >
      <EquipmentPreparationWorkspace initial={workspace} />
    </WorkspaceShell>
  );
}
