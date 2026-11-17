import { EquipmentRequestList } from "@/components/equipment-request-list";
import { WorkspaceShell } from "@/components/workspace-shell";
import { canManageEquipmentRequestItems } from "@/lib/equipment-requests";
import {
  loadEquipmentRequestPage,
  type EquipmentRequestSearchParams,
} from "@/lib/equipment-request-page";
import { getViewer } from "@/lib/viewer";
import { redirect } from "next/navigation";
import {
  canUseSkillsWorkspace,
  defaultWorkspacePath,
} from "@/lib/workspace-access";
import { LocalizedText } from "@/components/i18n/language-provider";

export default async function MyEquipmentRequestsPage({
  searchParams,
}: {
  searchParams: Promise<EquipmentRequestSearchParams>;
}) {
  const {
    supabase,
    userId,
    fullName,
    roles,
    roomTypes,
    allowBasicMedicalAccess,
    canImportSchedules,
    canManagePersonnel,
    canManageEmailNotifications,
  } = await getViewer();
  const roomTypeCodes = roomTypes.map(({ code }) => code);
  if (!canUseSkillsWorkspace(roles, roomTypeCodes)) {
    redirect(defaultWorkspacePath(roles, roomTypeCodes));
  }
  const canAddItems = canManageEquipmentRequestItems(roles);

  const params = await searchParams;
  const [{ requests, paging, focusId }, { data: catalog }] = await Promise.all([
    loadEquipmentRequestPage(supabase, {
      params,
      domains: ["nursing_skills", "basic_medical"],
      mine: true,
    }),
    canAddItems
      ? supabase
          .from("equipment_catalog")
          .select(
            "id,item_name,commercial_name,item_type,country_of_origin,manufacturer,model,unit",
          )
          .eq("is_active", true)
          .order("item_name")
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <WorkspaceShell
      fullName={fullName}
      roles={roles}
      roomTypeCodes={roomTypeCodes}
      allowBasicMedicalAccess={allowBasicMedicalAccess}
      canImportSchedules={canImportSchedules}
      canManagePersonnel={canManagePersonnel}
      canManageEmailNotifications={canManageEmailNotifications}
      title={<LocalizedText text={"Phiếu thiết bị của tôi"} />}
      description={
        <LocalizedText
          text={"Các phiếu mà bạn là người đăng ký hoặc giảng viên phụ trách."}
        />
      }
    >
      <EquipmentRequestList
        requests={requests}
        paging={paging}
        emptyMessage="Bạn chưa có phiếu thiết bị liên quan."
        canManageStatus={roles.some((role) =>
          ["admin", "staff"].includes(role),
        )}
        canAddItems={canAddItems}
        catalog={catalog ?? []}
        viewerId={userId}
        viewerRoles={roles}
        initialRequestId={focusId}
      />
    </WorkspaceShell>
  );
}
