import "server-only";

import { formatEquipmentRequestCode } from "@/lib/equipment-request-code";
import {
  BASIC_MEDICAL_ROOM_TYPE_ID,
  NURSING_SKILLS_ROOM_TYPE_ID,
} from "@/lib/room-types";
import { createAdminClient } from "@/lib/supabase/admin";

type EquipmentEmailEvent =
  | "created"
  | "updated"
  | "late_approval_requested"
  | "late_approval_approved"
  | "late_approval_rejected"
  | "deleted";

export type EquipmentEmailRequestSnapshot = {
  id: string;
  request_domain: "nursing_skills" | "basic_medical";
  created_at: string;
  semester: string;
  phone_snapshot: string;
  email_snapshot: string;
  receive_at: string;
  return_at: string;
  note: string | null;
  late_approval_status: string;
  late_registration_reason: string | null;
  late_review_note: string | null;
  registrant_id: string;
  responsible_lecturer_id: string;
  registrant: { full_name: string; email: string } | null;
  responsible: { full_name: string; email: string } | null;
  class_schedules: {
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
    skill_name: string;
    quantity: number;
    note: string | null;
    equipment_catalog: {
      item_name: string;
      commercial_name: string | null;
      unit: string;
    } | null;
    basic_medical_equipment_catalog: {
      item_name: string;
      commercial_name: string | null;
      unit: string;
    } | null;
  }>;
};

function formatVietnameseDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function formatTime(value: string) {
  return value.slice(0, 5);
}

export async function loadEquipmentRequestEmailSnapshot(requestId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("equipment_requests")
    .select(
      "id,request_domain,created_at,semester,registrant_id,responsible_lecturer_id,phone_snapshot,email_snapshot,receive_at,return_at,note,late_approval_status,late_registration_reason,late_review_note,registrant:profiles!equipment_requests_registrant_id_fkey(full_name,email),responsible:profiles!equipment_requests_responsible_lecturer_id_fkey(full_name,email),class_schedules(schedule_date,start_time,end_time,course_code_snapshot,course_name_snapshot,student_count,rooms(room_code,building_code,room_name)),equipment_request_items(skill_name,quantity,note,equipment_catalog!equipment_request_items_catalog_item_id_fkey(item_name,commercial_name,unit),basic_medical_equipment_catalog!equipment_request_items_basic_medical_catalog_item_id_fkey(item_name,commercial_name,unit))",
    )
    .eq("id", requestId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as unknown as EquipmentEmailRequestSnapshot | null;
}

function subjectForAudience({
  event,
  audience,
  baseSubject,
  requestDomain,
}: {
  event: EquipmentEmailEvent;
  audience: "registrant" | "responsible" | "admin";
  baseSubject: string;
  requestDomain: EquipmentEmailRequestSnapshot["request_domain"];
}) {
  if (requestDomain === "basic_medical") {
    const domain = "[Y cơ sở]";
    if (audience === "admin") {
      if (event === "created")
        return `[Admin MedLabs Calendar]${domain}[New] Có đăng ký trang thiết bị mới - ${baseSubject}`;
      if (event === "updated")
        return `[Admin MedLabs Calendar]${domain}[Adjusted] Điều chỉnh phiếu đăng ký thiết bị - ${baseSubject}`;
      if (event === "deleted")
        return `[Admin MedLabs Calendar]${domain}[Cancelled] Hủy phiếu đăng ký thiết bị - ${baseSubject}`;
      if (event === "late_approval_approved")
        return `[Admin MedLabs Calendar]${domain}[Late] Đã duyệt đăng ký trễ - ${baseSubject}`;
      if (event === "late_approval_rejected")
        return `[Admin MedLabs Calendar]${domain}[Late] Đã từ chối đăng ký trễ - ${baseSubject}`;
      return `[Admin MedLabs Calendar]${domain}[Late] Có phiếu chờ duyệt đăng ký trễ - ${baseSubject}`;
    }
    if (audience === "responsible") {
      if (event === "created")
        return `[MedLabs Calendar]${domain}[New] Phiếu thiết bị buổi học bạn phụ trách - ${baseSubject}`;
      if (event === "updated")
        return `[MedLabs Calendar]${domain}[Adjusted] Điều chỉnh phiếu đăng ký thiết bị - ${baseSubject}`;
      if (event === "deleted")
        return `[MedLabs Calendar]${domain}[Cancelled] Hủy phiếu đăng ký thiết bị - ${baseSubject}`;
      if (event === "late_approval_approved")
        return `[MedLabs Calendar]${domain}[Late] Đã duyệt đăng ký trễ - ${baseSubject}`;
      if (event === "late_approval_rejected")
        return `[MedLabs Calendar]${domain}[Late] Đã từ chối đăng ký trễ - ${baseSubject}`;
      return `[MedLabs Calendar]${domain}[Late] Phiếu thiết bị buổi học bạn phụ trách đăng ký trễ - ${baseSubject}`;
    }
    if (event === "created")
      return `[MedLabs Calendar]${domain}[New] Xác nhận đăng ký trang thiết bị - ${baseSubject}`;
    if (event === "updated")
      return `[MedLabs Calendar]${domain}[Adjusted] Điều chỉnh phiếu đăng ký thiết bị - ${baseSubject}`;
    if (event === "deleted")
      return `[MedLabs Calendar]${domain}[Cancelled] Hủy phiếu đăng ký thiết bị - ${baseSubject}`;
    if (event === "late_approval_approved")
      return `[MedLabs Calendar]${domain}[Late] Đã duyệt đăng ký trễ - ${baseSubject}`;
    if (event === "late_approval_rejected")
      return `[MedLabs Calendar]${domain}[Late] Đã từ chối đăng ký trễ - ${baseSubject}`;
    return `[MedLabs Calendar]${domain}[Late] Gửi phiếu đăng ký thiết bị trễ - ${baseSubject}`;
  }
  if (audience === "admin") {
    if (event === "created")
      return `[Admin MedLabs Calendar][Skills Lab][New] Có đăng ký trang thiết bị mới - ${baseSubject}`;
    if (event === "updated")
      return `[Admin MedLabs Calendar][Skills Lab][Adjusted] Điều chỉnh phiếu đăng ký thiết bị của ${baseSubject}`;
    return `[Admin MedLabs Calendar][Skills Lab][Late] Có phiếu chờ duyệt đăng ký trễ - ${baseSubject}`;
  }

  if (audience === "responsible") {
    if (event === "created")
      return `[MedLabs Calendar][Skills Lab][New] Phiếu thiết bị bạn phụ trách - ${baseSubject}`;
    if (event === "updated")
      return `[MedLabs Calendar][Skills Lab][Adjusted] Điều chỉnh phiếu thiết bị bạn phụ trách - ${baseSubject}`;
    if (event === "late_approval_requested")
      return `[MedLabs Calendar][Skills Lab][Late] Phiếu thiết bị bạn phụ trách đăng ký trễ - ${baseSubject}`;
    if (event === "late_approval_approved")
      return `[MedLabs Calendar][Skills Lab][Late] Đã duyệt phiếu đăng ký trễ bạn phụ trách - ${baseSubject}`;
    if (event === "late_approval_rejected")
      return `[MedLabs Calendar][Skills Lab][Late] Đã từ chối phiếu đăng ký trễ bạn phụ trách - ${baseSubject}`;
    return `[MedLabs Calendar][Skills Lab][Deleted] Phiếu thiết bị bạn phụ trách đã bị xóa - ${baseSubject}`;
  }

  if (event === "created")
    return `[MedLabs Calendar][Skills Lab][New] Xác nhận đăng ký trang thiết bị của ${baseSubject}`;
  if (event === "updated")
    return `[MedLabs Calendar][Skills Lab][Adjusted] Điều chỉnh phiếu đăng ký thiết bị của ${baseSubject}`;
  if (event === "late_approval_requested")
    return `[MedLabs Calendar][Skills Lab][Late] Gửi phiếu đăng ký thiết bị trễ - ${baseSubject}`;
  if (event === "late_approval_approved")
    return `[MedLabs Calendar][Skills Lab][Late] Đã duyệt đăng ký trễ - ${baseSubject}`;
  if (event === "late_approval_rejected")
    return `[MedLabs Calendar][Skills Lab][Late] Từ chối đăng ký trễ - ${baseSubject}`;
  return `[MedLabs Calendar][Skills Lab][Deleted] Phiếu đăng ký thiết bị đã bị xóa - ${baseSubject}`;
}

export async function enqueueEquipmentRequestEmails({
  requestId,
  event,
  operationId,
  snapshot,
  actorId,
}: {
  requestId: string;
  event: EquipmentEmailEvent;
  operationId?: string;
  snapshot?: EquipmentEmailRequestSnapshot;
  actorId?: string;
}) {
  const supabase = createAdminClient();
  const request =
    snapshot ?? (await loadEquipmentRequestEmailSnapshot(requestId));
  if (!request) throw new Error("Không tìm thấy phiếu để tạo email.");
  if (!request.registrant || !request.class_schedules) {
    throw new Error("Phiếu thiếu thông tin người đăng ký hoặc lớp học.");
  }

  const schedule = request.class_schedules;
  const { data: actor } = actorId
    ? await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", actorId)
        .maybeSingle()
    : { data: null };
  const requestCode = formatEquipmentRequestCode(request.created_at);
  const room = schedule.rooms;
  const roomLabel = room
    ? [room.room_code, room.building_code].filter(Boolean).join(" · ")
    : "";
  const payload = {
    request_id: request.id,
    request_code: requestCode,
    event,
    request_domain: request.request_domain,
    actor: actor?.full_name ?? request.registrant.full_name,
    course_code: schedule.course_code_snapshot,
    course_name: schedule.course_name_snapshot,
    schedule_date: schedule.schedule_date,
    start_time: formatTime(schedule.start_time),
    end_time: formatTime(schedule.end_time),
    semester: request.semester,
    student_count: schedule.student_count,
    lab_type:
      request.request_domain === "basic_medical"
        ? "Y cơ sở"
        : "Kỹ năng Điều dưỡng",
    room: roomLabel,
    room_name: room?.room_name ?? null,
    registrant_name: request.registrant.full_name,
    registrant_email: request.email_snapshot,
    registrant_phone: request.phone_snapshot,
    responsible_name: request.responsible?.full_name ?? "",
    responsible_email: request.responsible?.email ?? "",
    receive_at: request.receive_at,
    return_at: request.return_at,
    note: request.note,
    late_approval_status: request.late_approval_status,
    late_registration_reason: request.late_registration_reason,
    late_review_note: request.late_review_note,
    items: request.equipment_request_items.map((item) => ({
      skill_name: item.skill_name,
      item_name:
        (request.request_domain === "basic_medical"
          ? item.basic_medical_equipment_catalog?.item_name
          : item.equipment_catalog?.item_name) ??
        "Thiết bị không còn trong danh mục",
      commercial_name:
        (request.request_domain === "basic_medical"
          ? item.basic_medical_equipment_catalog?.commercial_name
          : item.equipment_catalog?.commercial_name) ?? "",
      unit:
        (request.request_domain === "basic_medical"
          ? item.basic_medical_equipment_catalog?.unit
          : item.equipment_catalog?.unit) ?? "",
      quantity: item.quantity,
      note: item.note,
    })),
  };
  const dateLabel = formatVietnameseDate(schedule.schedule_date);
  const baseSubject = `${request.registrant.full_name} - ${dateLabel} - ${schedule.course_code_snapshot} - ${requestCode}`;
  const operationKey = operationId ?? event;
  const notifications: Array<{
    notification_type: string;
    recipient_id: string;
    recipient_email: string;
    dedupe_key: string;
    subject: string;
    payload: Record<string, unknown>;
  }> = [];
  const sendsToManagers = ![
    "late_approval_approved",
    "late_approval_rejected",
    "deleted",
  ].includes(event);

  notifications.push({
    notification_type: `equipment_request_${event}`,
    recipient_id: request.registrant_id,
    recipient_email: request.email_snapshot.toLowerCase(),
    dedupe_key: `equipment_request:${request.id}:${operationKey}:registrant`,
    subject: subjectForAudience({
      event,
      audience: "registrant",
      baseSubject,
      requestDomain: request.request_domain,
    }),
    payload: { ...payload, audience: "registrant" },
  });

  const responsibleEmail = request.responsible?.email?.trim().toLowerCase();
  if (
    request.responsible_lecturer_id !== request.registrant_id &&
    responsibleEmail?.includes("@") &&
    responsibleEmail !== request.email_snapshot.trim().toLowerCase()
  ) {
    notifications.push({
      notification_type: `equipment_request_${event}`,
      recipient_id: request.responsible_lecturer_id,
      recipient_email: responsibleEmail,
      dedupe_key: `equipment_request:${request.id}:${operationKey}:responsible:${request.responsible_lecturer_id}`,
      subject: subjectForAudience({
        event,
        audience: "responsible",
        baseSubject,
        requestDomain: request.request_domain,
      }),
      payload: { ...payload, audience: "responsible" },
    });
  }

  const { data: managerRows, error: managerError } = sendsToManagers
    ? await supabase
        .from("user_roles")
        .select(
          "user_id,role,profile:profiles!user_roles_user_id_fkey(email,is_active,profile_room_types(room_type_id))",
        )
        .in("role", ["admin", "staff"])
        .eq("profile.is_active", true)
    : { data: [], error: null };
  if (managerError) throw new Error(managerError.message);

  const seenAdminEmails = new Set(
    notifications.map(({ recipient_email }) => recipient_email),
  );
  for (const row of sendsToManagers ? (managerRows ?? []) : []) {
    const profile = row.profile as unknown as {
      email: string;
      is_active: boolean;
      profile_room_types: Array<{ room_type_id: string }>;
    } | null;
    const email = profile?.email?.trim().toLowerCase();
    if (
      !profile?.is_active ||
      !email?.includes("@") ||
      seenAdminEmails.has(email) ||
      (row.role === "staff" &&
        !profile.profile_room_types.some(
          ({ room_type_id }) =>
            room_type_id ===
            (request.request_domain === "basic_medical"
              ? BASIC_MEDICAL_ROOM_TYPE_ID
              : NURSING_SKILLS_ROOM_TYPE_ID),
        ))
    )
      continue;
    seenAdminEmails.add(email);
    notifications.push({
      notification_type: `equipment_request_${event}`,
      recipient_id: row.user_id,
      recipient_email: email,
      dedupe_key: `equipment_request:${request.id}:${operationKey}:admin:${row.user_id}`,
      subject: subjectForAudience({
        event,
        audience: "admin",
        baseSubject,
        requestDomain: request.request_domain,
      }),
      payload: { ...payload, audience: "admin" },
    });
  }

  const { error: insertError } = await supabase
    .from("email_notifications")
    .upsert(notifications, {
      onConflict: "dedupe_key",
      ignoreDuplicates: true,
    });
  if (insertError) throw new Error(insertError.message);

  return notifications.map(({ dedupe_key }) => dedupe_key);
}

export async function processPendingEmailOutbox() {
  const supabase = createAdminClient();
  const { data: processedCount, error } = await supabase.rpc(
    "process_email_outbox_events",
    { batch_size: 25 },
  );
  if (error) {
    console.error("Không thể xử lý hàng đợi outbox email:", error.message);
    return;
  }
  if (processedCount && processedCount > 0) {
    const { processPendingScheduleEmails } =
      await import("./email-notifications");
    await processPendingScheduleEmails();
  }
}
