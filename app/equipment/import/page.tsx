import { getInterfaceText } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Download } from "@/components/icons";
import { EquipmentImportWizard } from "@/components/equipment-import-wizard";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getViewer } from "@/lib/viewer";
import { LocalizedText } from "@/components/i18n/language-provider";

export async function generateMetadata() {
  const text = await getInterfaceText();
  return { title: text("Import Phiếu thiết bị") };
}

export default async function EquipmentImportPage() {
  const {
    fullName,
    roles,
    roomTypes,
    allowBasicMedicalAccess,
    canImportSchedules,
    canManagePersonnel,
    canManageEmailNotifications,
  } = await getViewer();
  if (!roles.some((role) => ["admin", "staff"].includes(role))) {
    redirect("/equipment/mine");
  }

  return (
    <WorkspaceShell
      fullName={fullName}
      roles={roles}
      roomTypeCodes={roomTypes.map(({ code }) => code)}
      allowBasicMedicalAccess={allowBasicMedicalAccess}
      canImportSchedules={canImportSchedules}
      canManagePersonnel={canManagePersonnel}
      canManageEmailNotifications={canManageEmailNotifications}
      title={<LocalizedText text={"Import Phiếu thiết bị"} />}
      description={
        <LocalizedText
          text={
            "Tải template chuẩn, kiểm tra từng dòng và đưa các phiếu thiết bị cũ lên hệ thống."
          }
        />
      }
      actions={
        <>
          <Link
            className="button button-secondary"
            download
            href="/api/equipment-import-template/csv"
            prefetch={false}
          >
            <Download size={16} />
            <LocalizedText text={" Template CSV"} />
          </Link>
          <Link
            className="button button-primary"
            download
            href="/api/equipment-import-template/xlsx"
            prefetch={false}
          >
            <Download size={16} />
            <LocalizedText text={" Template XLSX"} />
          </Link>
        </>
      }
    >
      <EquipmentImportWizard />
    </WorkspaceShell>
  );
}
