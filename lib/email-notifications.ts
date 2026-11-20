import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assertEmailOutboxOperationSucceeded,
  isEmailDeliveryDisabled,
  isSuccessfulEmailRetryStatus,
} from "@/lib/email-outbox-contract";
import { renderEmailV2 } from "@/lib/email-template-v2";
import {
  canonicalEmailWebhookPayload,
  emailFailureStatus,
} from "@/lib/email-webhook-signature";

export type ScheduleSummary = {
  course_code?: string;
  course_name?: string;
  schedule_date?: string;
  start_time?: string;
  end_time?: string;
  room?: string;
  lecturer?: string;
  student_count?: number;
};

export type EmailNotification = {
  id: string;
  notification_type: string;
  recipient_email: string;
  dedupe_key: string;
  subject: string;
  payload: Record<string, unknown>;
  delivery_mode_at_enqueue: EmailDeliveryMode;
};

export type EquipmentEmailItem = {
  skill_name?: string;
  item_name?: string;
  commercial_name?: string;
  unit?: string;
  quantity?: number;
  note?: string | null;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTime(value: unknown) {
  return String(value ?? "").slice(0, 5);
}

function formatVietnameseDate(value: unknown) {
  const text = String(value ?? "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

function formatVietnameseDateTime(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  return {
    date: new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date),
    time: new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date),
  };
}

function equipmentItems(payload: Record<string, unknown>) {
  return Array.isArray(payload.items)
    ? (payload.items as EquipmentEmailItem[])
    : [];
}

function groupedEquipmentItems(payload: Record<string, unknown>) {
  return Map.groupBy(
    equipmentItems(payload),
    (item) => item.skill_name || "Không có tên kỹ thuật",
  );
}

function equipmentRowsHtml(items: EquipmentEmailItem[]) {
  return items
    .map(
      (item, index) => `<tr>
        <td style="border:1px solid #e5e7eb;padding:6px;text-align:center">${index + 1}</td>
        <td style="border:1px solid #e5e7eb;padding:6px">${escapeHtml(item.item_name)}</td>
        <td style="border:1px solid #e5e7eb;padding:6px">${escapeHtml(item.commercial_name)}</td>
        <td style="border:1px solid #e5e7eb;padding:6px;text-align:center">${escapeHtml(item.unit)}</td>
        <td style="border:1px solid #e5e7eb;padding:6px;text-align:center">${escapeHtml(item.quantity)}</td>
        <td style="border:1px solid #e5e7eb;padding:6px">${escapeHtml(item.note)}</td>
      </tr>`,
    )
    .join("");
}

function equipmentSectionRow(
  label: string,
  value: unknown,
  labelWidth = false,
) {
  if (value === null || value === undefined || value === "") return "";
  return `<tr><td style="border:1px solid #e5e7eb;padding:6px;background:#f8fafc;${labelWidth ? "width:30%;" : ""}">${escapeHtml(label)}</td><td style="border:1px solid #e5e7eb;padding:6px">${escapeHtml(value)}</td></tr>`;
}

function equipmentSectionHtml(title: string, rows: string) {
  return `<h3 style="margin:16px 0 8px;font-size:16px;color:#2563eb;border-bottom:2px solid #2563eb;padding-bottom:4px">${escapeHtml(title)}</h3>
    <table style="border-collapse:collapse;border:1px solid #e5e7eb;width:100%;margin-bottom:16px"><tbody>${rows}</tbody></table>`;
}

function equipmentIntro(payload: Record<string, unknown>) {
  const event = String(payload.event ?? "created");
  const audience = String(payload.audience ?? "registrant");
  if (event === "late_approval_requested") {
    return `Phiếu của <strong>${escapeHtml(payload.registrant_name)}</strong> đang Chờ duyệt đăng ký trễ.`;
  }
  if (event === "late_approval_approved") {
    return "Phiếu đăng ký thiết bị đã được duyệt đăng ký trễ.";
  }
  if (event === "late_approval_rejected") {
    return "Phiếu đăng ký thiết bị đã bị từ chối đăng ký trễ. Vui lòng mở hệ thống để điều chỉnh và gửi lại.";
  }
  if (event === "deleted") {
    return payload.request_domain === "basic_medical"
      ? `Phiếu đăng ký thiết bị của <strong>${escapeHtml(payload.registrant_name)}</strong> đã được hủy bởi <strong>${escapeHtml(payload.actor)}</strong>.`
      : `Phiếu đăng ký thiết bị của <strong>${escapeHtml(payload.registrant_name)}</strong> đã bị xóa bởi <strong>${escapeHtml(payload.actor)}</strong>.`;
  }
  if (audience === "admin") {
    return event === "created"
      ? `Có phiếu đăng ký trang thiết bị mới do <strong>${escapeHtml(payload.registrant_name)}</strong> gửi.`
      : `Phiếu đăng ký trang thiết bị của <strong>${escapeHtml(payload.registrant_name)}</strong> vừa được điều chỉnh.`;
  }
  if (audience === "responsible") {
    return event === "created"
      ? `Bạn được chọn là giảng viên phụ trách trong phiếu đăng ký trang thiết bị của <strong>${escapeHtml(payload.registrant_name)}</strong>.`
      : `Phiếu đăng ký trang thiết bị bạn đang phụ trách vừa được <strong>${escapeHtml(payload.registrant_name)}</strong> điều chỉnh.`;
  }
  return event === "created"
    ? "Phiếu đăng ký trang thiết bị của bạn đã được tiếp nhận."
    : "Phiếu đăng ký trang thiết bị của bạn đã được cập nhật.";
}

function equipmentIntroText(payload: Record<string, unknown>) {
  const event = String(payload.event ?? "created");
  const audience = String(payload.audience ?? "registrant");
  if (event === "late_approval_requested") {
    return `Phiếu của ${payload.registrant_name ?? ""} đang Chờ duyệt đăng ký trễ.`;
  }
  if (event === "late_approval_approved") {
    return "Phiếu đăng ký thiết bị đã được duyệt đăng ký trễ.";
  }
  if (event === "late_approval_rejected") {
    return "Phiếu đăng ký thiết bị đã bị từ chối đăng ký trễ. Vui lòng mở hệ thống để điều chỉnh và gửi lại.";
  }
  if (event === "deleted") {
    return payload.request_domain === "basic_medical"
      ? `Phiếu đăng ký thiết bị của ${payload.registrant_name ?? ""} đã được hủy bởi ${payload.actor ?? "Người dùng hệ thống"}.`
      : `Phiếu đăng ký thiết bị của ${payload.registrant_name ?? ""} đã bị xóa bởi ${payload.actor ?? "Người dùng hệ thống"}.`;
  }
  if (audience === "admin") {
    return event === "created"
      ? `Có phiếu đăng ký trang thiết bị mới do ${payload.registrant_name ?? ""} gửi.`
      : `Phiếu đăng ký trang thiết bị của ${payload.registrant_name ?? ""} vừa được điều chỉnh.`;
  }
  if (audience === "responsible") {
    return event === "created"
      ? `Bạn được chọn là giảng viên phụ trách trong phiếu của ${payload.registrant_name ?? ""}.`
      : `Phiếu đăng ký trang thiết bị bạn đang phụ trách vừa được ${payload.registrant_name ?? ""} điều chỉnh.`;
  }
  return event === "created"
    ? "Phiếu đăng ký trang thiết bị của bạn đã được tiếp nhận."
    : "Phiếu đăng ký trang thiết bị của bạn đã được cập nhật.";
}

function renderEquipmentEmail(notification: EmailNotification) {
  const payload = notification.payload;
  const isBasicMedical = payload.request_domain === "basic_medical";
  const responsibleLabel = isBasicMedical
    ? "Giảng viên giảng dạy/hướng dẫn"
    : "Giảng viên phụ trách";
  const receive = formatVietnameseDateTime(payload.receive_at);
  const returned = formatVietnameseDateTime(payload.return_at);
  const groups = groupedEquipmentItems(payload);
  const equipmentTables = [...groups.entries()]
    .map(
      ([skillName, items]) => `<div style="margin-bottom:20px">
        <h4 style="margin:12px 0 8px;font-size:14px;color:#2563eb;font-weight:bold">▪ ${escapeHtml(skillName)}</h4>
        <table style="border-collapse:collapse;width:100%;border:1px solid #e5e7eb">
          <thead><tr>
            <th style="border:1px solid #e5e7eb;padding:6px;background:#f8fafc;width:5%;text-align:center">#</th>
            <th style="border:1px solid #e5e7eb;padding:6px;background:#f8fafc;width:25%">Tên thiết bị</th>
            <th style="border:1px solid #e5e7eb;padding:6px;background:#f8fafc;width:35%">Tên thương mại</th>
            <th style="border:1px solid #e5e7eb;padding:6px;background:#f8fafc;width:10%;text-align:center">ĐVT</th>
            <th style="border:1px solid #e5e7eb;padding:6px;background:#f8fafc;width:10%;text-align:center">SL</th>
            <th style="border:1px solid #e5e7eb;padding:6px;background:#f8fafc;width:15%">Ghi chú</th>
          </tr></thead>
          <tbody>${equipmentRowsHtml(items)}</tbody>
        </table>
      </div>`,
    )
    .join("");
  const courseRows = [
    equipmentSectionRow(
      "Ngày học",
      formatVietnameseDate(payload.schedule_date),
      true,
    ),
    equipmentSectionRow(
      "Giờ học",
      `${formatTime(payload.start_time)}–${formatTime(payload.end_time)}`,
    ),
    equipmentSectionRow("Học kỳ", payload.semester),
    equipmentSectionRow("Mã môn học", payload.course_code),
    equipmentSectionRow("Tên môn học", payload.course_name),
    equipmentSectionRow("Số lượng Sinh viên", payload.student_count),
    equipmentSectionRow("Loại lab", payload.lab_type),
    equipmentSectionRow("Phòng/Lab", payload.room),
  ].join("");
  const registrantRows = [
    equipmentSectionRow("Người đăng ký", payload.registrant_name, true),
    equipmentSectionRow("Email", payload.registrant_email),
    equipmentSectionRow("SĐT", payload.registrant_phone),
  ].join("");
  const responsibleRows = [
    equipmentSectionRow(responsibleLabel, payload.responsible_name, true),
    equipmentSectionRow(`Email ${responsibleLabel}`, payload.responsible_email),
  ].join("");
  const receiptRows = [
    equipmentSectionRow("Ngày nhận", receive.date, true),
    equipmentSectionRow("Giờ nhận", receive.time),
    equipmentSectionRow("Ngày trả", returned.date),
    equipmentSectionRow("Giờ trả", returned.time),
    equipmentSectionRow("Lý do đăng ký trễ", payload.late_registration_reason),
    equipmentSectionRow("Ghi chú xét duyệt", payload.late_review_note),
  ].join("");

  return `<!doctype html><html lang="vi"><body>
    <div style="font-family:Verdana,Arial,sans-serif;line-height:1.45;color:#111">
      <h2 style="margin:0 0 8px;color:#173f6b">MedLabs Calendar</h2>
      <p style="margin:0 0 16px">${equipmentIntro(payload)}</p>
      <div style="text-align:center;margin:16px 0;padding:12px;background:#f0f9ff;border:1px solid #bfdbfe;border-radius:8px">
        <strong style="font-size:16px;color:#059669">ID PHIẾU ĐĂNG KÝ:
          <span style="color:#2563eb">${escapeHtml(payload.course_code)}</span> -
          <span style="color:#dc2626">${escapeHtml(payload.request_code ?? payload.request_id)}</span>
        </strong>
      </div>
      ${equipmentSectionHtml("1. Thông tin môn học", courseRows)}
      ${equipmentSectionHtml("2. Thông tin người đăng ký", registrantRows)}
      ${equipmentSectionHtml(`3. Thông tin ${responsibleLabel.toLocaleLowerCase("vi")}`, responsibleRows)}
      ${equipmentSectionHtml("4. Thông tin nhận thiết bị", receiptRows)}
      <h3 style="margin:16px 0 12px;font-size:16px;color:#2563eb;border-bottom:2px solid #2563eb;padding-bottom:4px">Danh sách chi tiết thiết bị</h3>
      ${equipmentTables}
      ${payload.note ? `<p><strong>Ghi chú chung:</strong> ${escapeHtml(payload.note)}</p>` : ""}
      <p style="margin-top:20px;color:#64748b">Trân trọng,<br>EIU - MedLabs</p>
    </div>
  </body></html>`;
}

function renderEquipmentEmailText(notification: EmailNotification) {
  const payload = notification.payload;
  const responsibleLabel =
    payload.request_domain === "basic_medical"
      ? "Giảng viên giảng dạy/hướng dẫn"
      : "Giảng viên phụ trách";
  const receive = formatVietnameseDateTime(payload.receive_at);
  const returned = formatVietnameseDateTime(payload.return_at);
  const lines = [
    equipmentIntroText(payload),
    "",
    `📋 ID PHIẾU ĐĂNG KÝ: ${payload.course_code ?? ""} - ${payload.request_code ?? payload.request_id ?? ""}`,
    "",
    "=== 1. THÔNG TIN MÔN HỌC ===",
    `Ngày học: ${formatVietnameseDate(payload.schedule_date)}`,
    `Giờ học: ${formatTime(payload.start_time)}–${formatTime(payload.end_time)}`,
    `Học kỳ: ${payload.semester ?? ""}`,
    `Mã môn học: ${payload.course_code ?? ""}`,
    `Tên môn học: ${payload.course_name ?? ""}`,
    `Số lượng Sinh viên: ${payload.student_count ?? ""}`,
    `Loại lab: ${payload.lab_type ?? ""}`,
    `Phòng/Lab: ${payload.room ?? ""}`,
    "",
    "=== 2. THÔNG TIN NGƯỜI ĐĂNG KÝ ===",
    `Người đăng ký: ${payload.registrant_name ?? ""}`,
    `Email: ${payload.registrant_email ?? ""}`,
    `Số điện thoại: ${payload.registrant_phone ?? ""}`,
    "",
    `=== 3. THÔNG TIN ${responsibleLabel.toLocaleUpperCase("vi")} ===`,
    `${responsibleLabel}: ${payload.responsible_name ?? ""}`,
    `Email ${responsibleLabel}: ${payload.responsible_email ?? ""}`,
    "",
    "=== 4. THÔNG TIN NHẬN THIẾT BỊ ===",
    `Ngày nhận: ${receive.date}`,
    `Giờ nhận: ${receive.time}`,
    `Ngày trả: ${returned.date}`,
    `Giờ trả: ${returned.time}`,
    ...(payload.late_registration_reason
      ? [`Lý do đăng ký trễ: ${payload.late_registration_reason}`]
      : []),
    ...(payload.late_review_note
      ? [`Ghi chú xét duyệt: ${payload.late_review_note}`]
      : []),
    "",
    "=== DANH SÁCH CHI TIẾT THIẾT BỊ ===",
  ];

  for (const [skillName, items] of groupedEquipmentItems(payload)) {
    lines.push("", `▪ ${skillName}`);
    items.forEach((item, index) => {
      lines.push(
        `  ${index + 1}. ${item.item_name ?? ""}`,
        `     - Tên thương mại: ${item.commercial_name || "N/A"}`,
        `     - ĐVT: ${item.unit || "N/A"}`,
        `     - Số lượng: ${item.quantity ?? ""}`,
      );
      if (item.note) lines.push(`     - Ghi chú: ${item.note}`);
    });
  }
  if (payload.note) lines.push("", `Ghi chú chung: ${payload.note}`);
  lines.push("", "Trân trọng,", "EIU - MedLabs");
  return lines.join("\n");
}

function basicMedicalSectionRow(label: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  return `<tr><td style="border:1px solid #dbe4ee;padding:8px;background:#f8fafc;width:30%;font-weight:600">${escapeHtml(label)}</td><td style="border:1px solid #dbe4ee;padding:8px">${escapeHtml(value)}</td></tr>`;
}

function basicMedicalEventLabel(type: string) {
  if (type.endsWith("_created")) return "đã được tạo";
  if (type.endsWith("_updated")) return "đã được điều chỉnh";
  return "đã được xóa";
}

function renderBasicMedicalRegistrationEmail(notification: EmailNotification) {
  const payload = notification.payload;
  const schedules = Array.isArray(payload.schedules)
    ? (payload.schedules as ScheduleSummary[])
    : [];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const detailRows = [
    basicMedicalSectionRow(
      "Mã phiếu",
      payload.registration_code ?? payload.registration_id,
    ),
    basicMedicalSectionRow("Năm học", payload.academic_year),
    basicMedicalSectionRow("Học kỳ", payload.semester),
    basicMedicalSectionRow(
      "Thời gian đăng ký",
      `${formatVietnameseDate(payload.start_date)}–${formatVietnameseDate(payload.end_date)}`,
    ),
    basicMedicalSectionRow("Mã môn học", payload.course_code),
    basicMedicalSectionRow("Tên môn học", payload.course_name),
    basicMedicalSectionRow("Phòng", payload.room),
    basicMedicalSectionRow("Số sinh viên", payload.student_count),
    basicMedicalSectionRow("Người đăng ký", payload.registrant_name),
    basicMedicalSectionRow("Giảng viên phụ trách", payload.responsible_name),
    basicMedicalSectionRow("Ghi chú", payload.note),
  ].join("");

  return `<!doctype html><html lang="vi"><body style="margin:0;background:#f6f3ed">
    <div style="max-width:900px;margin:0 auto;padding:24px;font-family:Verdana,Arial,sans-serif;color:#17324d;line-height:1.5">
      <div style="background:#173f6b;color:white;padding:18px 20px;border-radius:10px 10px 0 0">
        <h2 style="margin:0">MedLabs Calendar</h2>
        <div style="margin-top:4px">Phiếu đăng ký phòng Y cơ sở</div>
      </div>
      <div style="background:white;padding:20px;border:1px solid #e4d8c8;border-top:0">
        <p style="margin-top:0">Phiếu <strong>${escapeHtml(payload.course_code)}</strong> ${basicMedicalEventLabel(notification.notification_type)} bởi <strong>${escapeHtml(payload.actor)}</strong>.</p>
        <table style="border-collapse:collapse;width:100%;margin-bottom:18px"><tbody>${detailRows}</tbody></table>
        <h3 style="color:#173f6b;margin:18px 0 8px">Danh sách buổi học</h3>
        <table style="width:100%;border-collapse:collapse" cellpadding="8" border="1">
          <thead style="background:#f3eee6"><tr><th>Ngày</th><th>Thời gian</th><th>Nội dung</th><th>Phòng</th><th>Giảng viên hướng dẫn</th><th>Số sinh viên</th></tr></thead>
          <tbody>${schedules
            .map(
              (schedule) => `<tr>
                <td>${escapeHtml(formatVietnameseDate(schedule.schedule_date))}</td>
                <td>${escapeHtml(formatTime(schedule.start_time))}–${escapeHtml(formatTime(schedule.end_time))}</td>
                <td>${escapeHtml(schedule.course_name)}</td>
                <td>${escapeHtml(schedule.room)}</td>
                <td>${escapeHtml(schedule.lecturer)}</td>
                <td style="text-align:center">${escapeHtml(schedule.student_count ?? "")}</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table>
        <p><a href="${escapeHtml(`${appUrl}/basic-medical/registrations`)}" style="color:#173f6b;font-weight:700">Mở phiếu trên MedLabs Calendar</a></p>
        <p style="color:#64748b">Trân trọng,<br>EIU - MedLabs</p>
      </div>
    </div>
  </body></html>`;
}

function renderBasicMedicalRegistrationText(notification: EmailNotification) {
  const payload = notification.payload;
  const schedules = Array.isArray(payload.schedules)
    ? (payload.schedules as ScheduleSummary[])
    : [];
  const lines = [
    `Phiếu Y cơ sở ${payload.course_code ?? ""} ${basicMedicalEventLabel(notification.notification_type)} bởi ${payload.actor ?? ""}.`,
    "",
    `Mã phiếu: ${payload.registration_code ?? payload.registration_id ?? ""}`,
    `Năm học: ${payload.academic_year ?? ""}`,
    `Học kỳ: ${payload.semester ?? ""}`,
    `Thời gian đăng ký: ${formatVietnameseDate(payload.start_date)}–${formatVietnameseDate(payload.end_date)}`,
    `Môn học: ${payload.course_code ?? ""} - ${payload.course_name ?? ""}`,
    `Phòng: ${payload.room ?? ""}`,
    `Số sinh viên: ${payload.student_count ?? ""}`,
    `Người đăng ký: ${payload.registrant_name ?? ""}`,
    `Giảng viên phụ trách: ${payload.responsible_name ?? ""}`,
  ];
  if (payload.note) lines.push(`Ghi chú: ${payload.note}`);
  lines.push("", "DANH SÁCH BUỔI HỌC");
  schedules.forEach((schedule, index) => {
    lines.push(
      `${index + 1}. ${formatVietnameseDate(schedule.schedule_date)} ${formatTime(schedule.start_time)}–${formatTime(schedule.end_time)} | ${schedule.course_name ?? ""} | ${schedule.room ?? ""} | ${schedule.lecturer ?? ""}`,
    );
  });
  lines.push("", "Trân trọng,", "EIU - MedLabs");
  return lines.join("\n");
}

function scheduleRowsHtml(schedules: ScheduleSummary[]) {
  return schedules
    .map(
      (schedule) => `
        <tr>
          <td>${escapeHtml(formatVietnameseDate(schedule.schedule_date))}</td>
          <td>${escapeHtml(formatTime(schedule.start_time))}–${escapeHtml(formatTime(schedule.end_time))}</td>
          <td><strong>${escapeHtml(schedule.course_code)}</strong></td>
          <td>${escapeHtml(schedule.course_name)}</td>
          <td>${escapeHtml(schedule.room)}</td>
          <td>${escapeHtml(schedule.lecturer)}</td>
          <td>${escapeHtml(schedule.student_count ?? 1)}</td>
        </tr>`,
    )
    .join("");
}

function renderBasicMedicalEquipmentDamageEmail(
  notification: EmailNotification,
) {
  const payload = notification.payload;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const items = Array.isArray(payload.items)
    ? (payload.items as Array<{
        item_name?: string;
        commercial_name?: string | null;
        unit?: string;
        newly_damaged_quantity?: number;
        good_quantity?: number;
        damaged_quantity?: number;
      }>)
    : [];
  const room = [payload.room_code, payload.room_name, payload.building_code]
    .filter(Boolean)
    .join(" · ");
  const rows = items
    .map(
      (item, index) => `<tr>
        <td style="border:1px solid #dbe4ee;padding:8px;text-align:center">${index + 1}</td>
        <td style="border:1px solid #dbe4ee;padding:8px">${escapeHtml(item.item_name)}</td>
        <td style="border:1px solid #dbe4ee;padding:8px">${escapeHtml(item.commercial_name)}</td>
        <td style="border:1px solid #dbe4ee;padding:8px;text-align:center">${escapeHtml(item.unit)}</td>
        <td style="border:1px solid #dbe4ee;padding:8px;text-align:center">${escapeHtml(item.newly_damaged_quantity)}</td>
        <td style="border:1px solid #dbe4ee;padding:8px;text-align:center">${escapeHtml(item.good_quantity)}</td>
        <td style="border:1px solid #dbe4ee;padding:8px;text-align:center">${escapeHtml(item.damaged_quantity)}</td>
      </tr>`,
    )
    .join("");
  const managementCopy = payload.audience === "admin";
  const destination = managementCopy
    ? `${appUrl}/basic-medical/equipment?tab=damaged`
    : `${appUrl}/basic-medical/registrations`;
  const destinationLabel = managementCopy
    ? "Mở danh sách thiết bị hư"
    : "Mở Phiếu Y cơ sở";
  return `<!doctype html><html lang="vi"><body style="margin:0;background:#f6f3ed">
    <div style="max-width:900px;margin:0 auto;padding:24px;font-family:Verdana,Arial,sans-serif;color:#17324d;line-height:1.5">
      <div style="background:#173f6b;color:white;padding:18px 20px"><h2 style="margin:0">MedLabs Calendar</h2><div>Thiết bị phòng được báo Hư</div></div>
      <div style="background:white;padding:20px;border:1px solid #e4d8c8">
        <p>${managementCopy ? `<strong>${escapeHtml(payload.reporter_name)}</strong> đã báo thiết bị hư khi xác nhận buổi học tại phòng <strong>${escapeHtml(room)}</strong>. Vui lòng kiểm tra danh sách thiết bị hư bên dưới.` : `Hệ thống đã ghi nhận báo cáo thiết bị hư trong quá trình xác nhận buổi học tại phòng <strong>${escapeHtml(room)}</strong>. Thông tin đã được gửi đến bộ phận phụ trách Y cơ sở để kiểm tra và xử lý.`}</p>
        <table style="border-collapse:collapse;width:100%"><thead><tr><th>#</th><th>Thiết bị</th><th>Tên thương mại</th><th>ĐVT</th><th>Hư mới</th><th>Tốt</th><th>Hư</th></tr></thead><tbody>${rows}</tbody></table>
        <p><a href="${escapeHtml(destination)}">${destinationLabel}</a></p>
        <p>Trân trọng,<br>EIU - MedLabs</p>
      </div>
    </div>
  </body></html>`;
}

function renderBasicMedicalEquipmentDamageText(
  notification: EmailNotification,
) {
  const payload = notification.payload;
  const items = Array.isArray(payload.items)
    ? (payload.items as Array<{
        item_name?: string;
        newly_damaged_quantity?: number;
        unit?: string;
        good_quantity?: number;
        damaged_quantity?: number;
      }>)
    : [];
  const room = [payload.room_code, payload.room_name, payload.building_code]
    .filter(Boolean)
    .join(" · ");
  const managementCopy = payload.audience === "admin";
  const destination = managementCopy
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/basic-medical/equipment?tab=damaged`
    : `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/basic-medical/registrations`;
  const destinationLabel = managementCopy
    ? "Mở danh sách thiết bị hư"
    : "Mở Phiếu Y cơ sở";
  const lines = [
    notification.subject,
    "",
    managementCopy
      ? `${payload.reporter_name ?? "Người dùng"} đã báo thiết bị hư khi xác nhận buổi học tại phòng ${room}. Vui lòng kiểm tra danh sách thiết bị hư bên dưới.`
      : `Hệ thống đã ghi nhận báo cáo thiết bị hư trong quá trình xác nhận buổi học tại phòng ${room}. Thông tin đã được gửi đến bộ phận phụ trách Y cơ sở để kiểm tra và xử lý.`,
    "",
    `Người báo hư: ${payload.reporter_name ?? ""}`,
    `Phòng: ${room}`,
    `Buổi học: ${formatVietnameseDate(payload.schedule_date)} ${formatTime(payload.start_time)}–${formatTime(payload.end_time)}`,
    "",
    "THIẾT BỊ HƯ MỚI",
  ];
  items.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${item.item_name ?? ""}: hư mới ${item.newly_damaged_quantity ?? 0} ${item.unit ?? ""}; hiện có ${item.good_quantity ?? 0} Tốt, ${item.damaged_quantity ?? 0} Hư.`,
    );
  });
  lines.push("", `${destinationLabel}: ${destination}`);
  lines.push("", "Trân trọng,", "EIU - MedLabs");
  return lines.join("\n");
}

function renderEmailV1(notification: EmailNotification) {
  if (notification.notification_type.startsWith("equipment_request_")) {
    return renderEquipmentEmail(notification);
  }
  if (
    notification.notification_type.startsWith("basic_medical_registration_")
  ) {
    return renderBasicMedicalRegistrationEmail(notification);
  }
  if (
    notification.notification_type === "basic_medical_room_equipment_damaged"
  ) {
    return renderBasicMedicalEquipmentDamageEmail(notification);
  }
  const payload = notification.payload;
  const schedules = Array.isArray(payload.schedules)
    ? (payload.schedules as ScheduleSummary[])
    : [payload as ScheduleSummary];
  const visibleSchedules = schedules.slice(0, 50);
  const remainingCount = schedules.length - visibleSchedules.length;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const type = notification.notification_type;
  const isBasicRegistration = type.startsWith("basic_medical_registration_");
  const isImport = type.endsWith("import_summary");
  const intro = isBasicRegistration
    ? `Phiếu Y cơ sở <strong>${escapeHtml(payload.course_code)}</strong> đã được ${type.endsWith("_created") ? "tạo" : type.endsWith("_updated") ? "điều chỉnh" : "xóa"} bởi <strong>${escapeHtml(payload.actor)}</strong>. Người đăng ký: <strong>${escapeHtml(payload.registrant_name)}</strong>; giảng viên phụ trách: <strong>${escapeHtml(payload.responsible_name)}</strong>.`
    : type === "class_schedule_rescheduled" ||
        type === "class_schedule_basic_medical_updated"
      ? `Lịch <strong>${escapeHtml(payload.course_code)}</strong> đã được điều chỉnh bởi <strong>${escapeHtml(payload.actor)}</strong>.${payload.old_schedule_date ? ` Ngày học đổi từ ${escapeHtml(formatVietnameseDate(payload.old_schedule_date))} sang ${escapeHtml(formatVietnameseDate(payload.schedule_date))}.` : ""}`
      : type === "class_schedule_skills_lab_deleted"
        ? `Giảng viên <strong>${escapeHtml(payload.actor)}</strong> đã xóa lớp Skills Lab <strong>${escapeHtml(payload.course_code)}</strong> do mình tạo.`
        : type === "class_schedule_basic_medical_cancelled"
          ? `Lịch Y cơ sở <strong>${escapeHtml(payload.course_code)}</strong> đã được hủy bởi <strong>${escapeHtml(payload.actor)}</strong>.`
          : isImport
            ? "Danh sách lịch sử dụng phòng Skills Lab mới đã được cập nhật trên hệ thống."
            : `Một lịch ${payload.room_type_code === "basic_medical" ? "Y cơ sở" : "lớp"} mới vừa được tạo bởi <strong>${escapeHtml(payload.creator)}</strong>.`;
  const destination = isBasicRegistration
    ? `${appUrl}/basic-medical/registrations`
    : isImport
      ? `${appUrl}/imports`
      : payload.room_type_code === "basic_medical" ||
          type.includes("basic_medical")
        ? `${appUrl}/basic-medical/schedules`
        : `${appUrl}/class-schedules`;
  return `<!doctype html>
  <html lang="vi">
    <body style="font-family:Verdana,Arial,sans-serif;color:#17324d;line-height:1.5">
      <h2 style="margin:0 0 12px">MedLabs Calendar</h2>
      <p>${intro}</p>
      <table style="width:100%;border-collapse:collapse" cellpadding="8" border="1">
        <thead><tr><th>Ngày</th><th>Thời gian</th><th>Mã môn</th><th>Tên môn học</th><th>Phòng</th><th>Giảng viên</th><th>Số sinh viên</th></tr></thead>
        <tbody>${scheduleRowsHtml(visibleSchedules)}</tbody>
      </table>
      ${remainingCount > 0 ? `<p>Còn ${remainingCount} lịch khác. Vui lòng mở hệ thống để xem đầy đủ.</p>` : ""}
      <p><a href="${escapeHtml(destination)}">Mở MedLabs Calendar</a></p>
    </body>
  </html>`;
}

// Giữ renderer V1 để có thể phục hồi ngay nếu bản V2 chưa được duyệt.
const ACTIVE_EMAIL_TEMPLATE_VERSION: "v1" | "v2" = "v2";

function renderEmail(notification: EmailNotification) {
  return ACTIVE_EMAIL_TEMPLATE_VERSION === "v2"
    ? renderEmailV2(notification)
    : renderEmailV1(notification);
}

function renderScheduleEmailText(notification: EmailNotification) {
  const payload = notification.payload;
  const schedules = Array.isArray(payload.schedules)
    ? (payload.schedules as ScheduleSummary[])
    : [payload as ScheduleSummary];
  const lines = [notification.subject, ""];
  if (payload.actor) lines.push(`Người thực hiện: ${payload.actor}`);
  if (payload.creator) lines.push(`Người tạo: ${payload.creator}`);
  if (payload.old_schedule_date) {
    lines.push(
      `Ngày học cũ: ${formatVietnameseDate(payload.old_schedule_date)}`,
      `Ngày học mới: ${formatVietnameseDate(payload.schedule_date)}`,
    );
  }
  lines.push("", "CHI TIẾT LỊCH");
  schedules.slice(0, 50).forEach((schedule, index) => {
    lines.push(
      `${index + 1}. ${formatVietnameseDate(schedule.schedule_date)} ${formatTime(schedule.start_time)}–${formatTime(schedule.end_time)} | ${schedule.course_code ?? ""} - ${schedule.course_name ?? ""} | ${schedule.room ?? ""} | ${schedule.lecturer ?? ""} | ${schedule.student_count ?? ""} SV`,
    );
  });
  if (schedules.length > 50) {
    lines.push(`Còn ${schedules.length - 50} lịch khác trên MedLabs Calendar.`);
  }
  lines.push("", "Trân trọng,", "EIU - MedLabs");
  return lines.join("\n");
}

function renderEmailText(notification: EmailNotification) {
  if (notification.notification_type.startsWith("equipment_request_")) {
    return renderEquipmentEmailText(notification);
  }
  if (
    notification.notification_type.startsWith("basic_medical_registration_")
  ) {
    return renderBasicMedicalRegistrationText(notification);
  }
  if (
    notification.notification_type === "basic_medical_room_equipment_damaged"
  ) {
    return renderBasicMedicalEquipmentDamageText(notification);
  }
  return renderScheduleEmailText(notification);
}

export type EmailDeliveryMode = "off" | "test" | "live";

const DEFAULT_TEST_RECIPIENT_EMAIL = "bao.nguyen@eiu.edu.vn";

export function getEmailTestRecipient() {
  const configuredRecipient =
    process.env.EMAIL_TEST_RECIPIENT?.trim().toLowerCase();
  if (configuredRecipient) return configuredRecipient;
  if (process.env.NODE_ENV !== "production")
    return DEFAULT_TEST_RECIPIENT_EMAIL;
  throw new Error("Thiếu EMAIL_TEST_RECIPIENT trong môi trường production.");
}

function addTestBanner(html: string, banner: string) {
  const withBanner = html.replace(
    /<body\b[^>]*>/i,
    (bodyTag) => `${bodyTag}${banner}`,
  );
  return withBanner === html ? `${banner}${html}` : withBanner;
}

export async function getEmailDeliveryMode(): Promise<EmailDeliveryMode> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_delivery_settings")
    .select("delivery_mode")
    .eq("setting_key", "primary")
    .maybeSingle();

  if (error) {
    console.error("Không thể đọc chế độ gửi email:", error.message);
    return "off";
  }
  return data?.delivery_mode === "live" || data?.delivery_mode === "test"
    ? data.delivery_mode
    : "off";
}

async function suppressPendingNotifications(dedupeKeys?: string[]) {
  const supabase = createAdminClient();
  let query = supabase
    .from("email_notifications")
    .update({
      status: "suppressed",
      processing_started_at: null,
      last_error: "Đã bỏ qua vì hệ thống đang tắt gửi email.",
    })
    // A processing row may already be inside the provider call. Suppressing it
    // here would make the database say "suppressed" even when the provider has
    // actually delivered it. The worker owns processing rows and reconciles
    // their final state.
    .eq("status", "pending");
  if (dedupeKeys?.length) query = query.in("dedupe_key", dedupeKeys);
  const { error } = await query;
  if (error)
    console.error("Không thể đánh dấu email đã tắt gửi:", error.message);
}

async function deliverNotification(notification: EmailNotification) {
  const supabase = createAdminClient();
  const appsScriptUrl = process.env.EMAIL_APPS_SCRIPT_URL;
  const appsScriptSecret = process.env.EMAIL_APPS_SCRIPT_SECRET;
  let providerSucceeded = false;
  // Timeout or an unreadable 2xx reply: Apps Script may have sent it, so never auto-resend.
  let deliveryUncertain = false;
  let providerMessageId: string | null = null;

  try {
    const currentDeliveryMode = await getEmailDeliveryMode();
    if (currentDeliveryMode === "off") {
      const { data: suppressed, error } = await supabase
        .from("email_notifications")
        .update({
          status: "suppressed",
          processing_started_at: null,
          last_error: "Đã bỏ qua vì hệ thống đang tắt gửi email.",
        })
        .eq("id", notification.id)
        .eq("status", "processing")
        .select("id")
        .maybeSingle();
      if (error) throw new Error(`EMAIL_SUPPRESS_ACK_FAILED: ${error.message}`);
      // A concurrent actor may have reconciled the row already. In either case
      // Off is observed before the provider call, so this worker must stop.
      if (!suppressed) return;
      return;
    }

    const deliveryMode = notification.delivery_mode_at_enqueue;
    if (deliveryMode === "off") {
      const { data: suppressed, error } = await supabase
        .from("email_notifications")
        .update({
          status: "suppressed",
          processing_started_at: null,
          last_error: "Email được tạo khi chế độ gửi đang tắt.",
        })
        .eq("id", notification.id)
        .eq("status", "processing")
        .select("id")
        .maybeSingle();
      if (error) throw new Error(`EMAIL_SUPPRESS_ACK_FAILED: ${error.message}`);
      if (!suppressed) return;
      return;
    }

    // A change between Test and Live must never retarget an already queued item.
    // The stored snapshot wins. Changing to Off remains an emergency stop.
    const isTestDelivery = deliveryMode === "test";
    const deliveryRecipient = isTestDelivery
      ? getEmailTestRecipient()
      : notification.recipient_email;
    const deliverySubject = isTestDelivery
      ? `[KIỂM THỬ] ${notification.subject}`
      : notification.subject;
    const originalHtml = renderEmail(notification);
    const originalText = renderEmailText(notification);
    const testBannerHtml = `
      <div style="margin:0 0 18px;padding:14px 16px;border:1px solid #d9a441;border-radius:10px;background:#fff7df;color:#163b66;font-family:Verdana,Arial,sans-serif">
        <strong>EMAIL KIỂM THỬ — KHÔNG GỬI CHO NGƯỜI NHẬN GỐC</strong><br>
        Người nhận gốc: ${escapeHtml(notification.recipient_email)}
      </div>`;
    const deliveryHtml = isTestDelivery
      ? addTestBanner(originalHtml, testBannerHtml)
      : originalHtml;
    const deliveryText = isTestDelivery
      ? `EMAIL KIỂM THỬ — KHÔNG GỬI CHO NGƯỜI NHẬN GỐC\nNgười nhận gốc: ${notification.recipient_email}\n\n${originalText}`
      : originalText;

    if (!appsScriptUrl || !appsScriptSecret) {
      throw new Error(
        "Thiếu EMAIL_APPS_SCRIPT_URL hoặc EMAIL_APPS_SCRIPT_SECRET.",
      );
    }
    const senderName = notification.notification_type.startsWith(
      "equipment_request_",
    )
      ? "Đăng ký trang thiết bị"
      : notification.notification_type.startsWith("basic_medical_registration_")
        ? "Đăng ký phòng Y cơ sở"
        : "MedLabs Calendar";
    const timestamp = Date.now().toString();
    const nonce = randomUUID();
    const webhookPayload = {
      timestamp,
      nonce,
      id: notification.id,
      dedupeKey: notification.dedupe_key,
      to: deliveryRecipient,
      subject: deliverySubject,
      html: deliveryHtml,
      text: deliveryText,
      senderName,
    };
    const canonicalPayload = canonicalEmailWebhookPayload(webhookPayload);
    const signature = createHmac("sha256", appsScriptSecret)
      .update(canonicalPayload)
      .digest("hex");

    const response = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...webhookPayload, signature }),
      signal: AbortSignal.timeout(60_000),
    }).catch((fetchError: unknown) => {
      deliveryUncertain =
        fetchError instanceof Error && fetchError.name === "TimeoutError";
      throw fetchError;
    });

    const result = (await response.json().catch(() => {
      deliveryUncertain = response.ok;
      throw new Error(`APPS_SCRIPT_EMAIL_INVALID_RESPONSE_${response.status}`);
    })) as {
      ok?: boolean;
      messageId?: string;
      error?: string;
    };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? `APPS_SCRIPT_EMAIL_${response.status}`);
    }
    providerSucceeded = true;
    providerMessageId = result.messageId ?? notification.dedupe_key;

    const { data: acknowledged, error } = await supabase
      .from("email_notifications")
      .update({
        status: isTestDelivery ? "simulated" : "sent",
        provider_message_id: providerMessageId,
        provider_succeeded_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        processing_started_at: null,
        acknowledgement_error: null,
        last_error: isTestDelivery
          ? `Đã gửi bản kiểm thử tới ${deliveryRecipient}; không gửi tới ${notification.recipient_email}.`
          : null,
      })
      .eq("id", notification.id)
      .eq("status", "processing")
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`EMAIL_DB_ACK_FAILED: ${error.message}`);
    if (!acknowledged) throw new Error("EMAIL_DB_ACK_FAILED: STATUS_CHANGED");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 1000)
        : "Không thể gửi email.";
    const { error: failureUpdateError } = await supabase
      .from("email_notifications")
      .update(
        providerSucceeded
          ? {
              status: emailFailureStatus(true),
              provider_message_id: providerMessageId,
              provider_succeeded_at: new Date().toISOString(),
              processing_started_at: null,
              acknowledgement_error: message,
              last_error:
                "Provider đã gửi; cần đối soát DB, không được gửi lại tự động.",
            }
          : deliveryUncertain
            ? {
                status: emailFailureStatus(true),
                processing_started_at: null,
                acknowledgement_error: message,
                last_error:
                  "Không rõ Apps Script đã gửi hay chưa; cần đối soát, không được gửi lại tự động.",
              }
            : {
                status: emailFailureStatus(false),
                processing_started_at: null,
                last_error: message,
              },
      )
      .eq("id", notification.id);
    if (failureUpdateError) {
      console.error(
        "Không thể ghi nhận lỗi gửi email:",
        failureUpdateError.message,
      );
    }
  }
}

export async function processEmailNotificationsByDedupeKeys(
  dedupeKeys: string[],
) {
  if (!dedupeKeys.length) return;

  const supabase = createAdminClient();
  const deliveryMode = await getEmailDeliveryMode();
  if (isEmailDeliveryDisabled(deliveryMode)) {
    await suppressPendingNotifications(dedupeKeys);
    return;
  }
  const { data, error } = await supabase
    .from("email_notifications")
    .select(
      "id,notification_type,recipient_email,dedupe_key,subject,payload,attempts,delivery_mode_at_enqueue",
    )
    .in("dedupe_key", dedupeKeys)
    .eq("status", "pending");

  assertEmailOutboxOperationSucceeded("QUEUE_READ", error);

  await Promise.all(
    ((data ?? []) as Array<EmailNotification & { attempts: number }>).map(
      async (notification) => {
        const { data: claimed, error } = await supabase
          .from("email_notifications")
          .update({
            status: "processing",
            attempts: notification.attempts + 1,
            processing_started_at: new Date().toISOString(),
            last_error: null,
          })
          .eq("id", notification.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();
        assertEmailOutboxOperationSucceeded("CLAIM", error);
        if (claimed) await deliverNotification(notification);
      },
    ),
  );
}

export async function retryEmailNotification(notificationId: string) {
  if (isEmailDeliveryDisabled(await getEmailDeliveryMode())) return false;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_notifications")
    .update({
      status: "pending",
      processing_started_at: null,
      sent_at: null,
      last_error: null,
    })
    .eq("id", notificationId)
    .eq("status", "failed")
    .select("dedupe_key")
    .maybeSingle();
  assertEmailOutboxOperationSucceeded("RETRY", error);
  if (!data) return false;
  await processEmailNotificationsByDedupeKeys([data.dedupe_key]);
  const { data: outcome, error: outcomeError } = await supabase
    .from("email_notifications")
    .select("status")
    .eq("id", notificationId)
    .maybeSingle();
  assertEmailOutboxOperationSucceeded("RETRY_OUTCOME", outcomeError);
  return isSuccessfulEmailRetryStatus(outcome?.status ?? null);
}

export async function processPendingScheduleEmails() {
  const supabase = createAdminClient();
  const { error: expansionError } = await supabase.rpc(
    "process_email_outbox_events",
    { batch_size: 50 },
  );
  assertEmailOutboxOperationSucceeded("EXPAND", expansionError);

  const deliveryMode = await getEmailDeliveryMode();
  if (isEmailDeliveryDisabled(deliveryMode)) {
    await suppressPendingNotifications();
    return;
  }
  const { data, error } = await supabase.rpc("claim_email_notifications", {
    batch_size: 25,
  });

  assertEmailOutboxOperationSucceeded("CLAIM", error);

  await Promise.all(
    ((data ?? []) as EmailNotification[]).map((notification) =>
      deliverNotification(notification),
    ),
  );
}
