import type { AppRole } from "@/lib/viewer";
import type { EquipmentRequestDomain } from "@/lib/equipment-requests";

const nursingSkillsRoomTypeCode = "nursing_skills";
const basicMedicalRoomTypeCode = "basic_medical";

function hasAnyRole(roles: AppRole[], allowed: AppRole[]) {
  return roles.some((role) => allowed.includes(role));
}

export function isWorkspaceManager(roles: AppRole[]) {
  return hasAnyRole(roles, ["admin", "staff"]);
}

export function canUseInventoryWorkspace(roles: AppRole[]) {
  return hasAnyRole(roles, ["admin", "staff"]);
}

export function canManageInventoryAdmin(roles: AppRole[]) {
  return roles.includes("admin");
}
export function canManageBasicMedicalWorkspace(
  roles: AppRole[],
  roomTypeCodes: string[],
) {
  return (
    roles.includes("admin") ||
    (roles.includes("staff") &&
      roomTypeCodes.includes(basicMedicalRoomTypeCode))
  );
}

export function equipmentOperationsDomains(
  roles: AppRole[],
  roomTypeCodes: string[],
): EquipmentRequestDomain[] {
  if (roles.includes("admin")) {
    return ["nursing_skills", "basic_medical"];
  }
  if (!roles.includes("staff")) return [];

  const domains: EquipmentRequestDomain[] = [];
  if (roomTypeCodes.includes(nursingSkillsRoomTypeCode)) {
    domains.push("nursing_skills");
  }
  if (roomTypeCodes.includes(basicMedicalRoomTypeCode)) {
    domains.push("basic_medical");
  }
  return domains;
}

export function canUseEquipmentOperations(
  roles: AppRole[],
  roomTypeCodes: string[],
) {
  return equipmentOperationsDomains(roles, roomTypeCodes).length > 0;
}

export function canManageEquipmentRequestDomain(
  roles: AppRole[],
  roomTypeCodes: string[],
  requestDomain: EquipmentRequestDomain,
) {
  return equipmentOperationsDomains(roles, roomTypeCodes).includes(
    requestDomain,
  );
}

export function canUseSkillsWorkspace(
  roles: AppRole[],
  roomTypeCodes: string[],
) {
  return (
    isWorkspaceManager(roles) ||
    (roomTypeCodes.includes(nursingSkillsRoomTypeCode) &&
      hasAnyRole(roles, ["lecturer", "teaching_assistant", "viewer"]))
  );
}

export function canUseBasicMedicalEquipmentRegistration(
  roles: AppRole[],
  roomTypeCodes: string[],
) {
  return (
    roles.includes("admin") ||
    (roomTypeCodes.includes(basicMedicalRoomTypeCode) &&
      hasAnyRole(roles, ["staff", "lecturer", "teaching_assistant"]))
  );
}

export function canViewBasicMedicalSchedules(
  roles: AppRole[],
  roomTypeCodes: string[],
) {
  return (
    canManageBasicMedicalWorkspace(roles, roomTypeCodes) ||
    (roomTypeCodes.includes(basicMedicalRoomTypeCode) &&
      hasAnyRole(roles, ["lecturer", "teaching_assistant", "viewer"]))
  );
}

export function canViewBasicMedicalRegistrations(
  roles: AppRole[],
  roomTypeCodes: string[],
) {
  return (
    canManageBasicMedicalWorkspace(roles, roomTypeCodes) ||
    (roomTypeCodes.includes(basicMedicalRoomTypeCode) &&
      hasAnyRole(roles, ["lecturer", "teaching_assistant", "viewer"]))
  );
}

export function canCreateBasicMedicalSchedules(
  roles: AppRole[],
  roomTypeCodes: string[],
  allowBasicMedicalAccess: boolean,
) {
  return (
    canManageBasicMedicalWorkspace(roles, roomTypeCodes) ||
    (allowBasicMedicalAccess &&
      roomTypeCodes.includes(basicMedicalRoomTypeCode) &&
      hasAnyRole(roles, ["lecturer", "teaching_assistant"]))
  );
}

export function canImportBasicMedicalSchedules(
  roles: AppRole[],
  roomTypeCodes: string[],
  canImportSchedules: boolean,
) {
  return (
    roles.includes("admin") ||
    (canImportSchedules &&
      roomTypeCodes.includes(basicMedicalRoomTypeCode) &&
      hasAnyRole(roles, ["staff", "lecturer", "teaching_assistant"]))
  );
}

export function defaultWorkspacePath(
  roles: AppRole[],
  roomTypeCodes: string[],
) {
  return !canUseSkillsWorkspace(roles, roomTypeCodes) &&
    canViewBasicMedicalSchedules(roles, roomTypeCodes)
    ? "/basic-medical/schedules"
    : "/dashboard";
}
