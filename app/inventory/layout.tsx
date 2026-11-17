import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getViewer } from "@/lib/viewer";
import {
  InventoryShellDescription,
  InventoryShellTitle,
} from "@/components/inventory/inventory-shell-title";

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
      title={<InventoryShellTitle />}
      description={<InventoryShellDescription />}
    >
      <div className="inventory-workspace min-w-0 space-y-6">{children}</div>
    </WorkspaceShell>
  );
}
