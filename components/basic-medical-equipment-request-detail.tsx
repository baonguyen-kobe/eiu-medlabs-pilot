import { formatEquipmentRequestCode } from "@/lib/equipment-request-code";
import {
  equipmentLateApprovalStatuses,
  equipmentStatusMeta,
  type EquipmentRequestListItem,
} from "@/lib/equipment-requests";
import type {
  BasicMedicalRegistrationListItem,
  BasicMedicalRegistrationSessionItem,
} from "@/lib/basic-medical-equipment";
import { LocalizedText } from "@/components/i18n/language-provider";

function formatDate(value?: string) {
  return value ? value.split("-").reverse().join("/") : "—";
}

function formatTime(value?: string) {
  return value?.slice(0, 5) ?? "—";
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function SourceDetails({
  registration,
  session,
}: {
  registration: BasicMedicalRegistrationListItem;
  session: BasicMedicalRegistrationSessionItem;
}) {
  const schedule = session.class_schedules;
  const room = registration.rooms;
  return (
    <dl className="basic-medical-equipment-source-grid">
      <div>
        <dt>
          <LocalizedText text={"Môn học"} />
        </dt>
        <dd>
          {registration.courses?.course_code ?? "—"} ·{" "}
          {registration.courses?.course_name ?? "—"}
        </dd>
      </div>
      <div>
        <dt>
          <LocalizedText text={"Học kỳ"} />
        </dt>
        <dd>{registration.semester}</dd>
      </div>
      <div>
        <dt>
          <LocalizedText text={"Buổi học"} />
        </dt>
        <dd>
          <LocalizedText text={"Buổi "} />
          {session.session_number}
        </dd>
      </div>
      <div>
        <dt>
          <LocalizedText text={"Tên bài TN-TH"} />
        </dt>
        <dd>{session.lesson_title}</dd>
      </div>
      <div>
        <dt>
          <LocalizedText text={"Ngày / thời gian"} />
        </dt>
        <dd>
          {formatDate(schedule?.schedule_date)} ·{" "}
          {formatTime(schedule?.start_time)}–{formatTime(schedule?.end_time)}
        </dd>
      </div>
      <div>
        <dt>
          <LocalizedText text={"Phòng"} />
        </dt>
        <dd>
          {room?.room_code ?? "—"}.{room?.building_code ?? "—"}
          {room?.room_name ? ` · ${room.room_name}` : ""}
        </dd>
      </div>
      <div>
        <dt>
          <LocalizedText text={"Giảng viên giảng dạy/hướng dẫn"} />
        </dt>
        <dd>{session.teaching?.full_name ?? "—"}</dd>
      </div>
      <div>
        <dt>
          <LocalizedText text={"Người đăng ký"} />
        </dt>
        <dd>{registration.registrant?.full_name ?? "—"}</dd>
      </div>
    </dl>
  );
}

export function BasicMedicalEquipmentRequestDetail({
  request,
  registration,
  session,
}: {
  request: EquipmentRequestListItem;
  registration: BasicMedicalRegistrationListItem;
  session: BasicMedicalRegistrationSessionItem;
}) {
  const status = equipmentStatusMeta(request.status);
  const lateApprovalLabel =
    equipmentLateApprovalStatuses.find(
      (item) => item.value === request.late_approval_status,
    )?.label ?? request.late_approval_status;

  return (
    <div className="basic-medical-equipment-detail">
      <div className="basic-medical-equipment-detail-summary">
        <div>
          <span>
            <LocalizedText text={"Mã phiếu"} />
          </span>
          <strong>{formatEquipmentRequestCode(request.created_at)}</strong>
        </div>
        <div>
          <span>
            <LocalizedText text={"Trạng thái"} />
          </span>
          <strong className={`request-status request-status-${status.color}`}>
            <LocalizedText text={status.label} />
          </strong>
        </div>
        <div>
          <span>
            <LocalizedText text={"Người đăng ký"} />
          </span>
          <strong>{request.profiles?.full_name ?? "—"}</strong>
        </div>
        <div>
          <span>
            <LocalizedText text={"Email"} />
          </span>
          <strong>{request.email_snapshot || "—"}</strong>
        </div>
        <div>
          <span>
            <LocalizedText text={"Số điện thoại"} />
          </span>
          <strong>{request.phone_snapshot || "—"}</strong>
        </div>
        <div>
          <span>
            <LocalizedText text={"Giảng viên phụ trách"} />
          </span>
          <strong>
            {request.responsible?.full_name ??
              session.teaching?.full_name ??
              "—"}
          </strong>
        </div>
        <div>
          <span>
            <LocalizedText text={"Nhận thiết bị"} />
          </span>
          <strong>{formatDateTime(request.receive_at)}</strong>
        </div>
        <div>
          <span>
            <LocalizedText text={"Trả thiết bị"} />
          </span>
          <strong>{formatDateTime(request.return_at)}</strong>
        </div>
        <div>
          <span>
            <LocalizedText text={"Duyệt đăng ký trễ"} />
          </span>
          <strong>{lateApprovalLabel}</strong>
        </div>
        <div>
          <span>
            <LocalizedText text={"Ghi chú"} />
          </span>
          <strong>
            {request.note || <LocalizedText text={"Không có ghi chú"} />}
          </strong>
        </div>
      </div>
      <section>
        <h3>
          <LocalizedText text={"Nguồn buổi học"} />
        </h3>
        <SourceDetails registration={registration} session={session} />
      </section>
      <section>
        <h3>
          <LocalizedText text={"Thiết bị Y cơ sở"} />
        </h3>
        <div className="responsive-table">
          <table className="data-table equipment-detail-table">
            <thead>
              <tr>
                <th>
                  <LocalizedText text={"STT"} />
                </th>
                <th>
                  <LocalizedText text={"Tên thiết bị và vật tư"} />
                </th>
                <th>
                  <LocalizedText text={"Tên thương mại"} />
                </th>
                <th>
                  <LocalizedText text={"Loại"} />
                </th>
                <th>
                  <LocalizedText text={"Nước SX"} />
                </th>
                <th>
                  <LocalizedText text={"Hãng"} />
                </th>
                <th>
                  <LocalizedText text={"Model"} />
                </th>
                <th>
                  <LocalizedText text={"ĐVT"} />
                </th>
                <th>
                  <LocalizedText text={"Số lượng"} />
                </th>
                <th>
                  <LocalizedText text={"Ghi chú"} />
                </th>
              </tr>
            </thead>
            <tbody>
              {request.equipment_request_items.map((item, index) => {
                const catalog = item.basic_medical_equipment_catalog;
                return (
                  <tr key={item.id}>
                    <td>{index + 1}</td>
                    <td>
                      <strong>
                        {catalog?.item_name || (
                          <LocalizedText
                            text={"Danh mục thiết bị không còn khả dụng"}
                          />
                        )}
                      </strong>
                    </td>
                    <td>{catalog?.commercial_name || "—"}</td>
                    <td>{catalog?.item_type || "—"}</td>
                    <td>{catalog?.country_of_origin || "—"}</td>
                    <td>{catalog?.manufacturer || "—"}</td>
                    <td>{catalog?.model || "—"}</td>
                    <td>{catalog?.unit || "—"}</td>
                    <td>{item.quantity}</td>
                    <td>{item.note || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
