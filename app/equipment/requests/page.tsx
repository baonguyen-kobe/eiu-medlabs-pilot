import { redirect } from "next/navigation";
import { EquipmentRequestList } from "@/components/equipment-request-list";
import { WorkspaceShell } from "@/components/workspace-shell";
import { equipmentRequestSelect } from "@/lib/equipment-requests";
import { isEquipmentRequestId } from "@/lib/equipment-calendar-request";
import { getViewer } from "@/lib/viewer";
import {
  canUseEquipmentOperations,
  equipmentOperationsDomains,
} from "@/lib/workspace-access";
import { LocalizedText } from "@/components/i18n/language-provider";

export default async function EquipmentRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const {
    supabase,
    userId,
    email,
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

  const [query, { data }, { data: catalog }] = await Promise.all([
    searchParams,
    supabase
      .from("equipment_requests")
      .select(equipmentRequestSelect)
      .in("request_domain", manageableDomains)
      .order("created_at", { ascending: false }),
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
        requests={data ?? []}
        emptyMessage="Chưa có phiếu đăng ký thiết bị."
        canManageStatus
        canAddItems
        manageableDomains={[...manageableDomains]}
        catalog={catalog ?? []}
        viewerId={userId}
        viewerEmail={email}
        viewerRoles={roles}
        initialRequestId={
          isEquipmentRequestId(query.request) ? query.request : undefined
        }
      />
    </WorkspaceShell>
  );
}
