import { redirect } from "next/navigation";
import { EquipmentRequestList } from "@/components/equipment-request-list";
import { WorkspaceShell } from "@/components/workspace-shell";
import {
  loadEquipmentRequestPage,
  type EquipmentRequestSearchParams,
} from "@/lib/equipment-request-page";
import { getViewer } from "@/lib/viewer";
import {
  canUseEquipmentOperations,
  equipmentOperationsDomains,
} from "@/lib/workspace-access";
import { LocalizedText } from "@/components/i18n/language-provider";

export default async function EquipmentRequestsPage({
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
  const manageableDomains = equipmentOperationsDomains(roles, roomTypeCodes);
  if (!canUseEquipmentOperations(roles, roomTypeCodes)) {
    redirect("/equipment/mine");
  }

  const params = await searchParams;
  const [{ requests, paging, focusId }, { data: catalog }] = await Promise.all([
    loadEquipmentRequestPage(supabase, {
      params,
      domains: manageableDomains,
    }),
    supabase
      .from("equipment_catalog")
      .select(
        "id,item_name,commercial_name,item_type,country_of_origin,manufacturer,model,unit",
      )
      .eq("is_active", true)
      .order("item_name"),
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
      title={<LocalizedText text={"Phiếu thiết bị"} />}
      description={
        <LocalizedText
          text={
            "Toàn bộ phiếu thiết bị đã đăng ký, dành cho Admin và Staff quản lý phòng."
          }
        />
      }
    >
      <EquipmentRequestList
        requests={requests}
        paging={paging}
        emptyMessage="Chưa có phiếu đăng ký thiết bị."
        canManageStatus
        canAddItems
        manageableDomains={[...manageableDomains]}
        catalog={catalog ?? []}
        viewerId={userId}
        viewerRoles={roles}
        initialRequestId={focusId}
      />
    </WorkspaceShell>
  );
}
