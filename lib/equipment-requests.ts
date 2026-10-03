export const equipmentRequestWorkflowStatuses = [
  { value: "new", label: "Mới", color: "red" },
  { value: "preparing", label: "Đã soạn", color: "orange" },
  { value: "handed_over", label: "Đã giao", color: "blue" },
  { value: "returned", label: "Đã trả", color: "purple" },
  { value: "completed", label: "Hoàn Thành", color: "green" },
] as const;

export type EquipmentRequestWorkflowStatus =
  (typeof equipmentRequestWorkflowStatuses)[number]["value"];

export const equipmentRequestStatuses = [
  ...equipmentRequestWorkflowStatuses,
  { value: "cancelled", label: "Đã hủy", color: "red" },
] as const;

export type EquipmentRequestStatus =
  (typeof equipmentRequestStatuses)[number]["value"];

export type EquipmentRequestDomain = "nursing_skills" | "basic_medical";

export const equipmentLateApprovalStatuses = [
  { value: "not_required", label: "Không yêu cầu" },
  { value: "pending", label: "Chờ duyệt đăng ký trễ" },
  { value: "approved", label: "Đã duyệt đăng ký trễ" },
  { value: "rejected", label: "Đã từ chối đăng ký trễ" },
] as const;

export type EquipmentLateApprovalStatus =
  (typeof equipmentLateApprovalStatuses)[number]["value"];

export const equipmentRequestSelect =
  "id,preparation_revision,request_domain,source_identity_id,registrant_id,responsible_lecturer_id,status,semester,phone_snapshot,email_snapshot,receive_at,return_at,note,handover_file_url,created_at,updated_at,late_approval_status,late_registration_reason,late_requested_at,late_reviewed_at,late_review_note,handover_staff_confirmed_at,handover_recipient_signed_at,handover_effective_at,return_staff_confirmed_at,return_recipient_signed_at,return_effective_at,profiles!equipment_requests_registrant_id_fkey(full_name),responsible:profiles!equipment_requests_responsible_lecturer_id_fkey(full_name,email),class_schedules(id,schedule_date,start_time,end_time,course_code_snapshot,course_name_snapshot,student_count,rooms(room_code,building_code,room_name)),equipment_request_items(id,quantity,skill_name,note,equipment_catalog(id,item_name,commercial_name,item_type,country_of_origin,manufacturer,model,unit),basic_medical_equipment_catalog(id,item_name,commercial_name,item_type,country_of_origin,manufacturer,model,unit))";

export const equipmentHandoverSelect = `${equipmentRequestSelect},handover_recipient_signature:handover_signature_path,return_recipient_signature:return_signature_path,handover_staff:profiles!equipment_requests_handover_staff_confirmed_by_fkey(full_name),return_staff:profiles!equipment_requests_return_staff_confirmed_by_fkey(full_name)`;

export type EquipmentConfirmationState = {
  status: EquipmentRequestStatus;
  late_approval_status: EquipmentLateApprovalStatus;
  late_registration_reason: string | null;
  late_requested_at: string | null;
  late_reviewed_at: string | null;
  late_review_note: string | null;
  handover_staff_confirmed_at: string | null;
  handover_recipient_signed_at: string | null;
  handover_effective_at: string | null;
  return_staff_confirmed_at: string | null;
  return_recipient_signed_at: string | null;
  return_effective_at: string | null;
};

export type EquipmentRequestListItem = {
  id: string;
  preparation_revision: number;
  request_domain: EquipmentRequestDomain;
  source_identity_id: string;
  registrant_id: string;
  responsible_lecturer_id: string;
  status: EquipmentRequestStatus;
  late_approval_status: EquipmentLateApprovalStatus;
  late_registration_reason: string | null;
  late_requested_at: string | null;
  late_reviewed_at: string | null;
  late_review_note: string | null;
  semester: string;
  phone_snapshot: string;
  email_snapshot: string;
  receive_at: string;
  return_at: string;
  note: string | null;
  handover_file_url: string | null;
  created_at: string;
  updated_at: string;
  handover_staff_confirmed_at: string | null;
  handover_recipient_signed_at: string | null;
  handover_effective_at: string | null;
  return_staff_confirmed_at: string | null;
  return_recipient_signed_at: string | null;
  return_effective_at: string | null;
  profiles: { full_name: string } | null;
  responsible: { full_name: string; email: string } | null;
  class_schedules: {
    id: string;
    schedule_date: string;
    start_time: string;
    end_time: string;
    course_code_snapshot: string;
    course_name_snapshot: string;
    student_count: number;
    rooms: {
      room_code: string;
      building_code: string;
      room_name: string | null;
    } | null;
  } | null;
  equipment_request_items: Array<{
    id: string;
    quantity: number;
    skill_name: string;
    note: string | null;
    equipment_catalog: {
      id: string;
      item_name: string;
      commercial_name: string | null;
      item_type: string | null;
      country_of_origin: string | null;
      manufacturer: string | null;
      model: string | null;
      unit: string;
    } | null;
    basic_medical_equipment_catalog: {
      id: string;
      item_name: string;
      commercial_name: string | null;
      item_type: string | null;
      country_of_origin: string | null;
      manufacturer: string | null;
      model: string | null;
      unit: string;
    } | null;
  }>;
};

export type EquipmentCatalogListItem = {
  id: string;
  item_name: string;
  commercial_name: string | null;
  item_type: string | null;
  country_of_origin: string | null;
  manufacturer: string | null;
  model: string | null;
  unit: string;
};

const equipmentRequestItemManagerRoles = new Set(["admin", "staff"]);
const equipmentRequestItemEditableStatuses = new Set<EquipmentRequestStatus>([
  "new",
  "preparing",
]);

export function canManageEquipmentRequestItems(roles: readonly string[]) {
  return roles.some((role) => equipmentRequestItemManagerRoles.has(role));
}

export function canAddEquipmentRequestItems(
  roles: readonly string[],
  status: EquipmentRequestStatus,
) {
  return (
    canManageEquipmentRequestItems(roles) &&
    equipmentRequestItemEditableStatuses.has(status)
  );
}

export function equipmentStatusMeta(status: EquipmentRequestStatus) {
  return (
    equipmentRequestStatuses.find((item) => item.value === status) ??
    equipmentRequestStatuses[0]
  );
}
