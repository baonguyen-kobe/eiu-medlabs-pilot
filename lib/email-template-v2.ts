import type {
  EmailNotification,
  EquipmentEmailItem,
  ScheduleSummary,
} from "@/lib/email-notifications";

const COLORS = {
  navy: "#214773",
  navyDark: "#17385f",
  page: "#f3f0ea",
  border: "#d8e0e8",
  warmBorder: "#dfd3c3",
  label: "#f5f8fb",
  tableHead: "#f0ebe3",
  text: "#17324d",
  muted: "#66788a",
  link: "#174a7c",
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

function formatDate(value: unknown) {
  const text = String(value ?? "");
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

function formatDateTime(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function valueRow(label: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  return `<tr>
    <td class="email-label" style="width:27%;border:1px solid ${COLORS.border};padding:11px 12px;background:${COLORS.label};font-weight:700;color:${COLORS.navyDark};vertical-align:top">${escapeHtml(label)}</td>
    <td style="border:1px solid ${COLORS.border};padding:11px 12px;background:#ffffff;color:${COLORS.text};vertical-align:top">${escapeHtml(value)}</td>
  </tr>`;
}

function valueTable(rows: string) {
  if (!rows) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:15px"><tbody>${rows}</tbody></table>`;
}

type DetailField = readonly [label: string, value: unknown];

function hasValue(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

function pairedValueTable(fields: DetailField[]) {
  const visibleFields = fields.filter(([, value]) => hasValue(value));
  if (!visibleFields.length) return "";
  const desktopRows: string[] = [];
  for (let index = 0; index < visibleFields.length; index += 2) {
    const first = visibleFields[index];
    const second = visibleFields[index + 1];
    desktopRows.push(`<tr>
      <td style="width:17%;border:1px solid ${COLORS.border};padding:10px 11px;background:${COLORS.label};font-weight:700;color:${COLORS.navyDark};vertical-align:top">${escapeHtml(first[0])}</td>
      <td ${second ? "" : 'colspan="3"'} style="width:${second ? "33%" : "83%"};border:1px solid ${COLORS.border};padding:10px 11px;background:#ffffff;color:${COLORS.text};vertical-align:top">${escapeHtml(first[1])}</td>
      ${
        second
          ? `<td style="width:17%;border:1px solid ${COLORS.border};padding:10px 11px;background:${COLORS.label};font-weight:700;color:${COLORS.navyDark};vertical-align:top">${escapeHtml(second[0])}</td>
             <td style="width:33%;border:1px solid ${COLORS.border};padding:10px 11px;background:#ffffff;color:${COLORS.text};vertical-align:top">${escapeHtml(second[1])}</td>`
          : ""
      }
    </tr>`);
  }
  const mobileRows = visibleFields
    .map(
      ([label, value]) => `<tr>
        <td style="width:34%;border:1px solid ${COLORS.border};padding:10px 11px;background:${COLORS.label};font-weight:700;color:${COLORS.navyDark};vertical-align:top">${escapeHtml(label)}</td>
        <td style="width:66%;border:1px solid ${COLORS.border};padding:10px 11px;background:#ffffff;color:${COLORS.text};vertical-align:top">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join("");
  const tableStyle = `width:100%;border-collapse:collapse;margin:0 0 20px;font-size:15px;font-family:Verdana,Arial,sans-serif`;
  return `<table class="detail-desktop" role="presentation" cellpadding="0" cellspacing="0" style="${tableStyle}"><tbody>${desktopRows.join("")}</tbody></table>
    <table class="detail-mobile" role="presentation" cellpadding="0" cellspacing="0" style="display:none;max-height:0;overflow:hidden;mso-hide:all;${tableStyle}"><tbody>${mobileRows}</tbody></table>`;
}

function sectionTitle(title: string) {
  return `<h3 style="margin:22px 0 10px;color:${COLORS.navy};font-size:18px;line-height:1.35;font-weight:800">${escapeHtml(title)}</h3>`;
}

function emailShell(options: {
  subtitle: string;
  intro: string;
  content: string;
  destination?: string;
  destinationLabel?: string;
}) {
  const link = options.destination
    ? `<p style="margin:18px 0 0"><a href="${escapeHtml(options.destination)}" style="color:${COLORS.link};font-weight:700;text-decoration:underline">${escapeHtml(options.destinationLabel ?? "Mở MedLabs Calendar")}</a></p>`
    : "";

  return `<!doctype html>
  <html lang="vi">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>
        body, table, td, th, p, a, div, span {
          font-family: Verdana, Arial, sans-serif !important;
        }
        @media only screen and (max-width: 640px) {
          .email-frame { padding: 10px !important; }
          .email-body { padding: 18px 13px !important; }
          .email-label { width: 38% !important; }
          .detail-desktop { display:none !important; max-height:0 !important; overflow:hidden !important; }
          .detail-mobile { display:table !important; width:100% !important; max-height:none !important; overflow:visible !important; }
          .email-scroll { overflow-x: auto !important; display: block !important; }
        }
      </style>
    </head>
    <body style="margin:0;padding:0;background:${COLORS.page};font-family:Verdana,Arial,sans-serif;color:${COLORS.text};line-height:1.5">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:${COLORS.page};font-family:Verdana,Arial,sans-serif">
        <tr><td class="email-frame" style="padding:24px 16px" align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:1040px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid ${COLORS.warmBorder};border-radius:10px;overflow:hidden">
            <tr><td style="padding:21px 24px;background:${COLORS.navy};color:#ffffff;border-radius:9px 9px 0 0">
              <div style="font-size:24px;line-height:1.25;font-weight:800">MedLabs Calendar</div>
              <div style="margin-top:5px;font-size:15px;line-height:1.35;font-weight:700">${escapeHtml(options.subtitle)}</div>
            </td></tr>
            <tr><td class="email-body" style="padding:25px 24px 27px;background:#ffffff;border-radius:0 0 9px 9px;font-size:15px">
              <p style="margin:0 0 16px;color:${COLORS.text}">${options.intro}</p>
              ${options.content}
              ${link}
              <p style="margin:20px 0 0;color:${COLORS.muted};font-size:14px">Trân trọng,<br>EIU - MedLabs</p>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </body>
  </html>`;
}

function scheduleTable(schedules: ScheduleSummary[]) {
  const rows = schedules
    .slice(0, 50)
    .map(
      (schedule) => `<tr>
        <td style="border:1px solid ${COLORS.border};padding:8px;white-space:nowrap">${escapeHtml(formatDate(schedule.schedule_date))}</td>
        <td style="border:1px solid ${COLORS.border};padding:8px;white-space:nowrap">${escapeHtml(formatTime(schedule.start_time))}–${escapeHtml(formatTime(schedule.end_time))}</td>
        <td style="border:1px solid ${COLORS.border};padding:8px;font-weight:700">${escapeHtml(schedule.course_code)}</td>
        <td style="border:1px solid ${COLORS.border};padding:8px">${escapeHtml(schedule.course_name)}</td>
        <td style="border:1px solid ${COLORS.border};padding:8px;white-space:nowrap">${escapeHtml(schedule.room)}</td>
        <td style="border:1px solid ${COLORS.border};padding:8px">${escapeHtml(schedule.lecturer)}</td>
        <td style="border:1px solid ${COLORS.border};padding:8px;text-align:center">${escapeHtml(schedule.student_count ?? "")}</td>
      </tr>`,
    )
    .join("");
  const remaining = schedules.length - Math.min(schedules.length, 50);
  return `<div class="email-scroll" style="width:100%;overflow-x:auto">
    <table cellpadding="0" cellspacing="0" style="width:100%;min-width:760px;border-collapse:collapse;color:${COLORS.text};font-size:14px">
      <thead><tr>
        <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead};text-align:left">Ngày</th>
        <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead};text-align:left">Thời gian</th>
        <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead};text-align:left">Mã môn</th>
        <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead};text-align:left">Tên môn học</th>
        <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead};text-align:left">Phòng</th>
        <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead};text-align:left">Giảng viên</th>
        <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead};text-align:center">Số SV</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>${remaining > 0 ? `<p style="margin:10px 0 0;color:${COLORS.muted}">Còn ${remaining} lịch khác. Vui lòng mở hệ thống để xem đầy đủ.</p>` : ""}`;
}

function equipmentIntro(payload: Record<string, unknown>) {
  const event = String(payload.event ?? "created");
  const audience = String(payload.audience ?? "registrant");
  const registrant = `<strong>${escapeHtml(payload.registrant_name)}</strong>`;
  if (event === "late_approval_requested")
    return `Phiếu của ${registrant} đang <strong>Chờ duyệt đăng ký trễ</strong>.`;
  if (event === "late_approval_approved")
    return "Phiếu đăng ký thiết bị đã được <strong>Đã duyệt đăng ký trễ</strong>.";
  if (event === "late_approval_rejected")
    return "Phiếu đăng ký thiết bị đã bị từ chối đăng ký trễ. Vui lòng mở hệ thống để điều chỉnh và gửi lại.";
  if (event === "deleted")
    return payload.request_domain === "basic_medical"
      ? `Phiếu đăng ký thiết bị của ${registrant} đã được hủy bởi <strong>${escapeHtml(payload.actor)}</strong>.`
      : `Phiếu đăng ký thiết bị của ${registrant} đã bị xóa bởi <strong>${escapeHtml(payload.actor)}</strong>.`;
  if (audience === "admin")
    return event === "created"
      ? `Có phiếu đăng ký trang thiết bị mới do ${registrant} gửi.`
      : `Phiếu đăng ký trang thiết bị của ${registrant} vừa được điều chỉnh.`;
  if (audience === "responsible")
    return event === "created"
      ? `Bạn được chọn là giảng viên phụ trách trong phiếu đăng ký trang thiết bị của ${registrant}.`
      : `Phiếu đăng ký trang thiết bị bạn đang phụ trách vừa được ${registrant} điều chỉnh.`;
  return event === "created"
    ? "Phiếu đăng ký trang thiết bị của bạn đã được tiếp nhận."
    : "Phiếu đăng ký trang thiết bị của bạn đã được cập nhật.";
}

function equipmentItems(payload: Record<string, unknown>) {
  return Array.isArray(payload.items)
    ? (payload.items as EquipmentEmailItem[])
    : [];
}

function equipmentTable(payload: Record<string, unknown>) {
  const groups = new Map<string, EquipmentEmailItem[]>();
  for (const item of equipmentItems(payload)) {
    const name = item.skill_name || "Không có tên kỹ năng";
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([skillName, items]) => {
      const rows = items
        .map(
          (item, index) => `<tr>
            <td style="border:1px solid ${COLORS.border};padding:8px;text-align:center">${index + 1}</td>
            <td style="border:1px solid ${COLORS.border};padding:8px;font-weight:700">${escapeHtml(item.item_name)}</td>
            <td style="border:1px solid ${COLORS.border};padding:8px">${escapeHtml(item.commercial_name)}</td>
            <td style="border:1px solid ${COLORS.border};padding:8px;text-align:center">${escapeHtml(item.unit)}</td>
            <td style="border:1px solid ${COLORS.border};padding:8px;text-align:center">${escapeHtml(item.quantity)}</td>
            <td style="border:1px solid ${COLORS.border};padding:8px">${escapeHtml(item.note)}</td>
          </tr>`,
        )
        .join("");
      return `<h4 style="margin:16px 0 8px;color:${COLORS.navy};font-size:16px">${escapeHtml(skillName)}</h4>
        <div class="email-scroll" style="width:100%;overflow-x:auto"><table cellpadding="0" cellspacing="0" style="width:100%;min-width:720px;border-collapse:collapse;font-size:14px">
          <thead><tr>
            <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead}">#</th>
            <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead};text-align:left">Tên thiết bị và vật tư</th>
            <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead};text-align:left">Tên thương mại</th>
            <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead}">ĐVT</th>
            <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead}">Số lượng</th>
            <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead};text-align:left">Ghi chú</th>
          </tr></thead><tbody>${rows}</tbody>
        </table></div>`;
    })
    .join("");
}

function renderEquipment(notification: EmailNotification) {
  const payload = notification.payload;
  const isBasicMedical = payload.request_domain === "basic_medical";
  const responsibleLabel = isBasicMedical
    ? "Giảng viên giảng dạy/hướng dẫn"
    : "Giảng viên phụ trách";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const requestCode = payload.request_code ?? payload.request_id;
  const content = `${valueTable(valueRow("Mã phiếu", requestCode))}
    ${sectionTitle("1. Thông tin môn học")}
    ${pairedValueTable([
      ["Mã môn học", payload.course_code],
      ["Tên môn học", payload.course_name],
      ["Ngày học", formatDate(payload.schedule_date)],
      [
        "Giờ học",
        `${formatTime(payload.start_time)}–${formatTime(payload.end_time)}`,
      ],
      ["Học kỳ", payload.semester],
      ["Phòng/Lab", payload.room],
      ["Loại lab", payload.lab_type],
      ["Số sinh viên", payload.student_count],
    ])}
    ${sectionTitle("2. Thông tin người đăng ký")}
    ${pairedValueTable([
      ["Người đăng ký", payload.registrant_name],
      ["Email", payload.registrant_email],
      ["Số điện thoại", payload.registrant_phone],
    ])}
    ${sectionTitle(`3. Thông tin ${responsibleLabel.toLocaleLowerCase("vi")}`)}
    ${pairedValueTable([
      [responsibleLabel, payload.responsible_name],
      ["Email", payload.responsible_email],
    ])}
    ${sectionTitle("4. Thông tin nhận thiết bị")}
    ${pairedValueTable([
      ["Thời gian nhận", formatDateTime(payload.receive_at)],
      ["Thời gian trả", formatDateTime(payload.return_at)],
      ["Lý do đăng ký trễ", payload.late_registration_reason],
      ["Ghi chú xét duyệt", payload.late_review_note],
      ["Ghi chú chung", payload.note],
    ])}
    ${sectionTitle("5. Danh sách trang thiết bị")}${equipmentTable(payload)}`;
  return emailShell({
    subtitle: isBasicMedical
      ? "Phiếu đăng ký trang thiết bị Y cơ sở"
      : "Phiếu đăng ký trang thiết bị",
    intro: equipmentIntro(payload),
    content,
    destination: isBasicMedical
      ? `${appUrl}/basic-medical/equipment-requests`
      : `${appUrl}/equipment/requests`,
    destinationLabel: "Mở phiếu trên MedLabs Calendar",
  });
}

function basicRegistrationEvent(type: string) {
  if (type.endsWith("_created")) return "đã được tạo";
  if (type.endsWith("_updated")) return "đã được điều chỉnh";
  return "đã được xóa";
}

function renderBasicRegistration(notification: EmailNotification) {
  const payload = notification.payload;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const schedules = Array.isArray(payload.schedules)
    ? (payload.schedules as ScheduleSummary[])
    : [];
  const content = `${valueTable(
    valueRow("Mã phiếu", payload.registration_code ?? payload.registration_id),
  )}
    ${sectionTitle("1. Thông tin môn học")}
    ${pairedValueTable([
      ["Mã môn học", payload.course_code],
      ["Tên môn học", payload.course_name],
      ["Năm học", payload.academic_year],
      ["Học kỳ", payload.semester],
      [
        "Thời gian đăng ký",
        `${formatDate(payload.start_date)}–${formatDate(payload.end_date)}`,
      ],
      ["Phòng", payload.room],
      ["Số sinh viên", payload.student_count],
      ["Ghi chú", payload.note],
    ])}
    ${sectionTitle("2. Thông tin người đăng ký")}
    ${pairedValueTable([["Người đăng ký", payload.registrant_name]])}
    ${sectionTitle("3. Thông tin giảng viên phụ trách")}
    ${pairedValueTable([["Giảng viên phụ trách", payload.responsible_name]])}
    ${sectionTitle("4. Danh sách buổi học")}${scheduleTable(schedules)}`;
  return emailShell({
    subtitle: "Phiếu đăng ký phòng Y cơ sở",
    intro: `Phiếu <strong>${escapeHtml(payload.course_code)}</strong> ${basicRegistrationEvent(notification.notification_type)} bởi <strong>${escapeHtml(payload.actor)}</strong>.`,
    content,
    destination: `${appUrl}/basic-medical/registrations`,
    destinationLabel: "Mở phiếu trên MedLabs Calendar",
  });
}

function renderBasicMedicalEquipmentDamage(notification: EmailNotification) {
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
  const rows = items
    .map(
      (item, index) => `<tr>
        <td style="border:1px solid ${COLORS.border};padding:8px;text-align:center">${index + 1}</td>
        <td style="border:1px solid ${COLORS.border};padding:8px;font-weight:700">${escapeHtml(item.item_name)}</td>
        <td style="border:1px solid ${COLORS.border};padding:8px">${escapeHtml(item.commercial_name)}</td>
        <td style="border:1px solid ${COLORS.border};padding:8px;text-align:center">${escapeHtml(item.unit)}</td>
        <td style="border:1px solid ${COLORS.border};padding:8px;text-align:center;color:#b42318;font-weight:700">${escapeHtml(item.newly_damaged_quantity)}</td>
        <td style="border:1px solid ${COLORS.border};padding:8px;text-align:center">${escapeHtml(item.good_quantity)}</td>
        <td style="border:1px solid ${COLORS.border};padding:8px;text-align:center">${escapeHtml(item.damaged_quantity)}</td>
      </tr>`,
    )
    .join("");
  const room = [payload.room_code, payload.room_name, payload.building_code]
    .filter(Boolean)
    .join(" · ");
  const content = `${sectionTitle("1. Thông tin buổi học")}
    ${pairedValueTable([
      ["Mã môn học", payload.course_code],
      ["Tên môn học", payload.course_name],
      ["Ngày học", formatDate(payload.schedule_date)],
      [
        "Thời gian",
        `${formatTime(payload.start_time)}–${formatTime(payload.end_time)}`,
      ],
      ["Phòng", room],
      ["Người báo hư", payload.reporter_name],
      ["Ngày báo hư", formatDateTime(payload.reported_at)],
    ])}
    ${sectionTitle("2. Thiết bị hư mới")}
    <div class="email-scroll" style="width:100%;overflow-x:auto">
      <table cellpadding="0" cellspacing="0" style="width:100%;min-width:760px;border-collapse:collapse;font-size:14px">
        <thead><tr>
          <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead}">#</th>
          <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead};text-align:left">Tên thiết bị và vật tư</th>
          <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead};text-align:left">Tên thương mại</th>
          <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead}">ĐVT</th>
          <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead}">Hư mới</th>
          <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead}">Tốt hiện tại</th>
          <th style="border:1px solid ${COLORS.border};padding:8px;background:${COLORS.tableHead}">Hư hiện tại</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  const managementCopy = payload.audience === "admin";
  const intro = managementCopy
    ? `<strong>${escapeHtml(payload.reporter_name)}</strong> đã báo thiết bị hư khi xác nhận buổi học tại phòng <strong>${escapeHtml(room)}</strong>. Vui lòng kiểm tra danh sách thiết bị hư bên dưới.`
    : `Hệ thống đã ghi nhận báo cáo thiết bị hư trong quá trình xác nhận buổi học tại phòng <strong>${escapeHtml(room)}</strong>. Thông tin đã được gửi đến bộ phận phụ trách Y cơ sở để kiểm tra và xử lý.`;
  return emailShell({
    subtitle: "Thiết bị phòng được báo Hư",
    intro,
    content,
    destination: managementCopy
      ? `${appUrl}/basic-medical/equipment?tab=damaged`
      : `${appUrl}/basic-medical/registrations`,
    destinationLabel: managementCopy
      ? "Mở danh sách thiết bị hư"
      : "Mở Phiếu Y cơ sở",
  });
}

function scheduleIntro(notification: EmailNotification) {
  const payload = notification.payload;
  const type = notification.notification_type;
  if (type.endsWith("import_summary"))
    return "Danh sách lịch sử dụng phòng Skills Lab mới đã được cập nhật trên hệ thống.";
  if (
    type === "class_schedule_rescheduled" ||
    type === "class_schedule_basic_medical_updated"
  ) {
    const changedDate = payload.old_schedule_date
      ? ` Ngày học đổi từ <strong>${escapeHtml(formatDate(payload.old_schedule_date))}</strong> sang <strong>${escapeHtml(formatDate(payload.schedule_date))}</strong>.`
      : "";
    return `Lịch <strong>${escapeHtml(payload.course_code)}</strong> đã được điều chỉnh bởi <strong>${escapeHtml(payload.actor)}</strong>.${changedDate}`;
  }
  if (
    type === "class_schedule_skills_lab_deleted" ||
    type === "skills_lab_deleted"
  )
    return `Giảng viên <strong>${escapeHtml(payload.actor)}</strong> đã xóa lớp Skills Lab <strong>${escapeHtml(payload.course_code)}</strong> do mình tạo.`;
  if (type === "skills_lab_cancelled")
    return `Lớp Skills Lab <strong>${escapeHtml(payload.course_code)}</strong> đã được hủy bởi <strong>${escapeHtml(payload.actor)}</strong>. Phiếu thiết bị của lớp (nếu có) cũng đã được hủy.`;
  if (type === "class_schedule_basic_medical_cancelled")
    return `Lịch Y cơ sở <strong>${escapeHtml(payload.course_code)}</strong> đã được hủy bởi <strong>${escapeHtml(payload.actor)}</strong>.`;
  return `Một lịch ${payload.room_type_code === "basic_medical" ? "Y cơ sở" : "Skills Lab"} mới vừa được tạo bởi <strong>${escapeHtml(payload.creator)}</strong>.`;
}

function renderSchedule(notification: EmailNotification) {
  const payload = notification.payload;
  const type = notification.notification_type;
  const isImport = type.endsWith("import_summary");
  const isBasicMedical =
    payload.room_type_code === "basic_medical" ||
    type.includes("basic_medical");
  const schedules = Array.isArray(payload.schedules)
    ? (payload.schedules as ScheduleSummary[])
    : [payload as ScheduleSummary];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const summary = isImport
    ? ""
    : pairedValueTable([
        ["Mã môn học", payload.course_code],
        ["Tên môn học", payload.course_name],
        ["Ngày học", formatDate(payload.schedule_date)],
        [
          "Thời gian",
          `${formatTime(payload.start_time)}–${formatTime(payload.end_time)}`,
        ],
        ["Phòng", payload.room],
        ["Giảng viên", payload.lecturer],
        ["Số sinh viên", payload.student_count],
        ["Người thực hiện", payload.actor ?? payload.creator],
      ]);
  const subtitle = isImport
    ? "Cập nhật Lịch sử dụng phòng Skills Lab"
    : isBasicMedical
      ? "Lịch sử dụng phòng Y cơ sở"
      : "Lịch sử dụng phòng Skills Lab";
  return emailShell({
    subtitle,
    intro: scheduleIntro(notification),
    content: `${
      isImport ? "" : sectionTitle("Thông tin lịch")
    }${summary}${sectionTitle(isImport ? "Danh sách lịch mới" : "Chi tiết buổi học")}${scheduleTable(schedules)}`,
    destination: isImport
      ? `${appUrl}/imports`
      : isBasicMedical
        ? `${appUrl}/basic-medical/schedules`
        : `${appUrl}/class-schedules`,
  });
}

export function renderEmailV2(notification: EmailNotification) {
  if (notification.notification_type.startsWith("equipment_request_"))
    return renderEquipment(notification);
  if (notification.notification_type === "basic_medical_room_equipment_damaged")
    return renderBasicMedicalEquipmentDamage(notification);
  if (notification.notification_type.startsWith("basic_medical_registration_"))
    return renderBasicRegistration(notification);
  return renderSchedule(notification);
}
