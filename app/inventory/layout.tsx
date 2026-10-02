import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getViewer } from "@/lib/viewer";

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
      title="Quản lý Kho & Thiết bị"
      description="S1 Foundation — Hệ thống quản lý kho, nhập hàng và số dư vật tư MedLabs"
    >
      <div className="inventory-workspace space-y-6">{children}</div>
    </WorkspaceShell>
  );
}
