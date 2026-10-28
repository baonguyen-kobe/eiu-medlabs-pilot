import { WorkspaceShell } from "@/components/workspace-shell";
import { getViewer } from "@/lib/viewer";

export async function AdminShell({
  title,
  description,
  active,
  actions,
  children,
}: {
  title: React.ReactNode;
  description: React.ReactNode;
  active: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const {
    fullName,
    roles,
    roomTypes,
    allowBasicMedicalAccess,
    canImportSchedules,
    canManagePersonnel,
    canManageEmailNotifications,
  } = await getViewer();
  return (
    <WorkspaceShell
      fullName={fullName}
      roles={roles}
      roomTypeCodes={roomTypes.map(({ code }) => code)}
      allowBasicMedicalAccess={allowBasicMedicalAccess}
      canImportSchedules={canImportSchedules}
      canManagePersonnel={canManagePersonnel}
      canManageEmailNotifications={canManageEmailNotifications}
      title={title}
      description={description}
      actions={actions}
    >
      <section className="admin-page workspace-admin-page" data-active={active}>
        <div className="admin-content">{children}</div>
      </section>
    </WorkspaceShell>
  );
}
