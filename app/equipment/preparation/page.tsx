import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { EquipmentPreparationQueue } from "@/components/equipment-preparation-queue";
import { preparationQueueSchema } from "@/lib/equipment-preparation-operations";
import { getViewer } from "@/lib/viewer";

export default async function PreparationQueuePage() {
  const viewer = await getViewer();
  const { data, error } = await viewer.supabase.rpc(
    "equipment_preparation_operations_read",
    {
      p_resource: "queue",
      p_filters: { page: 1, status: "new", sort: "priority", search: "" },
    },
  );
  if (error) {
    if (error.code === "42501") notFound();
    throw new Error("Không tải được hàng đợi chuẩn bị thiết bị.");
  }
  const queue = preparationQueueSchema.parse(data);
  return (
    <WorkspaceShell
      fullName={viewer.fullName}
      roles={viewer.roles}
      roomTypeCodes={viewer.roomTypes.map(({ code }) => code)}
      allowBasicMedicalAccess={viewer.allowBasicMedicalAccess}
      canImportSchedules={viewer.canImportSchedules}
      canManagePersonnel={viewer.canManagePersonnel}
      canManageEmailNotifications={viewer.canManageEmailNotifications}
      title="Hàng đợi chuẩn bị thiết bị"
      description="Điều phối chuẩn bị Skills Lab trong phạm vi được phân công; không tự nhận việc hoặc bàn giao."
    >
      <EquipmentPreparationQueue initial={queue} />
    </WorkspaceShell>
  );
}
