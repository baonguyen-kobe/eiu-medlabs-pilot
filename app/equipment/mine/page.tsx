import { EquipmentRequestList } from "@/components/equipment-request-list";
import { WorkspaceShell } from "@/components/workspace-shell";
import {
  canManageEquipmentRequestItems,
  equipmentRequestSelect,
} from "@/lib/equipment-requests";
import { isEquipmentRequestId } from "@/lib/equipment-calendar-request";
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
  if (!canUseSkillsWorkspace(roles, roomTypeCodes)) {
    redirect(defaultWorkspacePath(roles, roomTypeCodes));
  }
  const canAddItems = canManageEquipmentRequestItems(roles);

  const [query, { data }, { data: catalog }] = await Promise.all([
    searchParams,
    supabase
      .from("equipment_requests")
      .select(equipmentRequestSelect)
      .or(`registrant_id.eq.${userId},responsible_lecturer_id.eq.${userId}`)
      .order("created_at", { ascending: false }),
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
        requests={data ?? []}
        emptyMessage="Bạn chưa có phiếu thiết bị liên quan."
        canManageStatus={roles.some((role) =>
          ["admin", "staff"].includes(role),
        )}
        canAddItems={canAddItems}
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
