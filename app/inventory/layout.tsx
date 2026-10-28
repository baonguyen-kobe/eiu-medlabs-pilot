import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getViewer } from "@/lib/viewer";
import { LocalizedText } from "@/components/i18n/language-provider";

export default async function InventoryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await requireInventoryViewer();
  const fullViewer = await getViewer();

  return (
    <WorkspaceShell
      fullName={viewer.fullName}
      roles={viewer.roles}
      roomTypeCodes={fullViewer.roomTypes.map((r) => r.code)}
      allowBasicMedicalAccess={fullViewer.allowBasicMedicalAccess}
      canImportSchedules={fullViewer.canImportSchedules}
      canManagePersonnel={fullViewer.canManagePersonnel}
      canManageEmailNotifications={fullViewer.canManageEmailNotifications}
      title={<LocalizedText text={"Quản lý Kho & Thiết bị"} />}
      description={
        <LocalizedText
          text={"Hệ thống quản lý kho, nhập hàng và nghiệp vụ vật tư MedLabs"}
        />
      }
    >
      <div className="inventory-workspace min-w-0 space-y-6">{children}</div>
    </WorkspaceShell>
  );
}
