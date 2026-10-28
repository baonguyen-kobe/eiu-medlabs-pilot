import { redirect } from "next/navigation";
import Link from "next/link";
import { ImportWizard } from "@/components/import-wizard";
import { Download } from "@/components/icons";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getViewer } from "@/lib/viewer";
import {
  canImportBasicMedicalSchedules,
  canViewBasicMedicalSchedules,
} from "@/lib/workspace-access";
import { LocalizedText } from "@/components/i18n/language-provider";

export default async function BasicMedicalImportPage() {
  const {
    fullName,
    roles,
    roomTypes,
    allowBasicMedicalAccess,
    canImportSchedules,
    canManagePersonnel,
    canManageEmailNotifications,
  } = await getViewer();
  const roomTypeCodes = roomTypes.map(({ code }) => code);
  if (
    !canImportBasicMedicalSchedules(roles, roomTypeCodes, canImportSchedules)
  ) {
    redirect(
      canViewBasicMedicalSchedules(roles, roomTypeCodes)
        ? "/basic-medical/schedules"
        : "/dashboard",
    );
  }
  return (
    <WorkspaceShell
      fullName={fullName}
      roles={roles}
      roomTypeCodes={roomTypeCodes}
      allowBasicMedicalAccess={allowBasicMedicalAccess}
      canImportSchedules={canImportSchedules}
      canManagePersonnel={canManagePersonnel}
      canManageEmailNotifications={canManageEmailNotifications}
      title={<LocalizedText text={"Import lịch Y cơ sở"} />}
      description={
        <LocalizedText
          text={
            "Kiểm tra dữ liệu theo phạm vi phòng và giảng viên Y cơ sở trước khi tạo lịch."
          }
        />
      }
      actions={
        <>
          <Link
            className="button button-secondary"
            download
            href="/api/import-template/csv?scope=basic_medical"
            prefetch={false}
          >
            <Download size={16} />
            <LocalizedText text={" Template CSV"} />
          </Link>
          <Link
            className="button button-primary"
            download
            href="/api/import-template/xlsx?scope=basic_medical"
            prefetch={false}
          >
            <Download size={16} />
            <LocalizedText text={" Template XLSX"} />
          </Link>
        </>
      }
    >
      <ImportWizard embedded scope="basic_medical" />
    </WorkspaceShell>
  );
}
