import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { EquipmentRequestLifecycleHistory } from "@/components/equipment-request-lifecycle-history";
import { LocalizedText } from "@/components/i18n/language-provider";
import { formatEquipmentRequestCode } from "@/lib/equipment-request-code";
import {
  equipmentRequestSelect,
  equipmentRequestStatuses,
  equipmentRequestWorkflowStatuses,
  usesInventoryFulfillment,
  type EquipmentRequestListItem,
} from "@/lib/equipment-requests";
import {
  fulfillmentLabels,
  fulfillmentSchema,
  type Fulfillment,
  type FulfillmentOperation,
} from "@/lib/equipment-fulfillment";
import { addExact, formatDisplayQuantity } from "@/lib/inventory/decimal";
import { getInterfaceText } from "@/lib/i18n/server";
import { getViewer } from "@/lib/viewer";
import { equipmentOperationsDomains } from "@/lib/workspace-access";

// Detail template (t3a): Thông tin | Nội dung | Đính kèm | Liên quan | Lịch sử.
const tabs = [
  ["info", "Thông tin"],
  ["content", "Nội dung"],
  ["files", "Đính kèm"],
  ["related", "Liên quan"],
  ["history", "Lịch sử"],
] as const;
type Tab = (typeof tabs)[number][0];

const dateTime = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});
const date = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});
const at = (value: string | null | undefined) =>
  value ? dateTime.format(new Date(value)) : "—";

const sum = (values: string[]) =>
  values.reduce((total, value) => addExact(total, value), "0");

export default async function EquipmentRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ requestId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ requestId }, query] = await Promise.all([params, searchParams]);
  // Seeded and fixture ids are not RFC 4122, so check the shape only.
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId))
    notFound();
  const viewer = await getViewer();
  // RLS decides who may read the request; no row means no access.
  const { data: row } = await viewer.supabase
    .from("equipment_requests")
    .select(equipmentRequestSelect)
    .eq("id", requestId)
    .maybeSingle();
  if (!row) notFound();
  const request = row as unknown as EquipmentRequestListItem;
  const text = await getInterfaceText();

  const roomTypeCodes = viewer.roomTypes.map(({ code }) => code);
  const canManage = equipmentOperationsDomains(
    viewer.roles,
    roomTypeCodes,
  ).includes(request.request_domain);
  const canSign =
    request.registrant_id === viewer.userId ||
    request.responsible_lecturer_id === viewer.userId;
  const inventoryManaged = usesInventoryFulfillment(request);

  let fulfillment: Fulfillment | null = null;
  if (inventoryManaged && (canManage || canSign)) {
    const { data } = await viewer.supabase.rpc("equipment_fulfillment_read", {
      p_request_id: requestId,
    });
    const parsed = fulfillmentSchema.safeParse(data);
    fulfillment = parsed.success ? parsed.data : null;
  }

  const tab: Tab = tabs.some(([key]) => key === query.tab)
    ? (query.tab as Tab)
    : "info";
  const base = `/equipment/requests/${requestId}`;
  const href = (key: Tab) => (key === "info" ? base : `${base}?tab=${key}`);
  const listHref = canManage
    ? `/equipment/requests?request=${requestId}`
    : `/equipment/mine?request=${requestId}`;

  const code = formatEquipmentRequestCode(request.created_at);
  const schedule = request.class_schedules;
  const room = schedule?.rooms;
  const statusLabel =
    equipmentRequestStatuses.find(({ value }) => value === request.status)
      ?.label ?? request.status;
  const stepIndex = equipmentRequestWorkflowStatuses.findIndex(
    ({ value }) => value === request.status,
  );
  const events = (fulfillment?.events ?? []).filter(
    (event) => !event.superseded,
  );
  const signedEvents = events.filter((event) => event.signature);

  return (
    <WorkspaceShell
      fullName={viewer.fullName}
      roles={viewer.roles}
      roomTypeCodes={roomTypeCodes}
      allowBasicMedicalAccess={viewer.allowBasicMedicalAccess}
      canImportSchedules={viewer.canImportSchedules}
      canManagePersonnel={viewer.canManagePersonnel}
      canManageEmailNotifications={viewer.canManageEmailNotifications}
      title={<LocalizedText text={"Chi tiết phiếu thiết bị"} />}
      description={<LocalizedText text={"Phiếu {0}"} values={[code]} />}
    >
      <p className="cell-stack">
        <Link href={listHref}>{text("← Danh sách phiếu")}</Link>
        <strong>
          {text("Phiếu {0}", [code])} ·{" "}
          {request.request_domain === "basic_medical"
            ? text("Y cơ sở")
            : text("Skills lab")}
        </strong>
      </p>

      <nav className="segmented-control" aria-label={text("Mục của phiếu")}>
        {tabs.map(([key, label]) => (
          <Link
            key={key}
            href={href(key)}
            scroll={false}
            className={tab === key ? "selected" : ""}
            aria-current={tab === key ? "page" : undefined}
          >
            {text(label)}
          </Link>
        ))}
      </nav>

      {tab === "info" ? (
        <section className="data-panel" aria-label={text("Thông tin")}>
          <ol className="list-filters-actions" aria-label={text("Trạng thái")}>
            {request.status === "cancelled" ? (
              <li className="badge" data-tone="danger">
                {text("Đã hủy")}
              </li>
            ) : (
              equipmentRequestWorkflowStatuses.map((step, index) => (
                <li
                  key={step.value}
                  className="badge"
                  data-tone={
                    index < stepIndex
                      ? "success"
                      : index === stepIndex
                        ? "info"
                        : "neutral"
                  }
                  aria-current={index === stepIndex ? "step" : undefined}
                >
                  {text(step.label)}
                </li>
              ))
            )}
          </ol>
          <dl className="detail-list">
            <div>
              <dt>{text("Mã phiếu")}</dt>
              <dd className="mono">{code}</dd>
            </div>
            <div>
              <dt>{text("Trạng thái")}</dt>
              <dd>{text(statusLabel)}</dd>
            </div>
            <div>
              <dt>{text("Người đăng ký")}</dt>
              <dd>{request.profiles?.full_name ?? "—"}</dd>
            </div>
            <div>
              <dt>{text("GV phụ trách")}</dt>
              <dd>{request.responsible?.full_name ?? "—"}</dd>
            </div>
            <div>
              <dt>{text("Lớp / buổi")}</dt>
              <dd>
                {schedule
                  ? `${schedule.course_code_snapshot} · ${schedule.course_name_snapshot} · ${date.format(new Date(`${schedule.schedule_date}T00:00:00+07:00`))} ${schedule.start_time.slice(0, 5)}–${schedule.end_time.slice(0, 5)}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>{text("Phòng")}</dt>
              <dd>
                {room
                  ? `${room.building_code}-${room.room_code}${room.room_name ? ` · ${room.room_name}` : ""}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>{text("Nhận / trả")}</dt>
              <dd>
                {at(request.receive_at)} → {at(request.return_at)}
              </dd>
            </div>
            <div>
              <dt>{text("Ngày tạo")}</dt>
              <dd>{at(request.created_at)}</dd>
            </div>
            <div>
              <dt>{text("Ghi chú chung")}</dt>
              <dd>{request.note || text("Không có ghi chú")}</dd>
            </div>
            {request.late_approval_status !== "not_required" ? (
              <div>
                <dt>{text("Đăng ký trễ")}</dt>
                <dd>
                  {text(
                    request.late_approval_status === "pending"
                      ? "Chờ duyệt đăng ký trễ"
                      : request.late_approval_status === "approved"
                        ? "Đã duyệt đăng ký trễ"
                        : "Đã từ chối đăng ký trễ",
                  )}
                  {request.late_registration_reason
                    ? ` — ${request.late_registration_reason}`
                    : ""}
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="list-filters-actions">
            {canManage && inventoryManaged && request.status === "new" ? (
              <Link
                className="button button-secondary"
                href={`/equipment/preparation/${requestId}`}
              >
                {text("Chuẩn bị thiết bị")}
              </Link>
            ) : null}
            {inventoryManaged && (canManage || canSign) ? (
              <Link
                className="button button-primary"
                href={`/equipment/fulfillment/${requestId}`}
              >
                {canManage
                  ? text("Bàn giao, thu hồi và ký xác nhận")
                  : text("Xem và ký xác nhận bàn giao/thu hồi")}
              </Link>
            ) : null}
            {canManage ? (
              <Link className="button button-secondary" href={listHref}>
                {text("Đổi trạng thái / duyệt trễ / hủy")}
              </Link>
            ) : null}
            <a
              className="button button-secondary"
              href={`/api/equipment-requests/${requestId}/handover`}
            >
              {text("Xuất phiếu PDF")}
            </a>
          </div>
        </section>
      ) : null}

      {tab === "content" ? (
        <div className="data-panel">
          <div className="responsive-table">
            <table className="data-table records-on-phone">
              <thead>
                <tr>
                  <th>{text("Thiết bị")}</th>
                  {fulfillment ? null : <th>{text("Kỹ năng")}</th>}
                  <th>{text("Đăng ký")}</th>
                  {fulfillment ? (
                    <>
                      <th>{text("Đã giao")}</th>
                      <th>{text("Đã trả")}</th>
                      <th>{text("Còn phải trả")}</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {fulfillment
                  ? fulfillment.lines.map((line) => {
                      const slices = fulfillment.issues.filter(
                        (issue) => issue.request_line_id === line.id,
                      );
                      return (
                        <tr key={line.id}>
                          <td data-label={text("Thiết bị")}>{line.name}</td>
                          <td data-label={text("Đăng ký")}>
                            {formatDisplayQuantity(line.registered_quantity)}{" "}
                            {line.unit}
                          </td>
                          <td data-label={text("Đã giao")}>
                            {formatDisplayQuantity(
                              sum(slices.map((slice) => slice.issued)),
                            )}
                          </td>
                          <td data-label={text("Đã trả")}>
                            {formatDisplayQuantity(
                              sum(slices.map((slice) => slice.returned)),
                            )}
                          </td>
                          <td data-label={text("Còn phải trả")}>
                            {formatDisplayQuantity(
                              sum(slices.map((slice) => slice.due)),
                            )}
                          </td>
                        </tr>
                      );
                    })
                  : request.equipment_request_items.map((item) => {
                      const catalog =
                        item.equipment_catalog ??
                        item.basic_medical_equipment_catalog;
                      return (
                        <tr key={item.id}>
                          <td data-label={text("Thiết bị")}>
                            <span className="cell-stack">
                              <strong>{catalog?.item_name ?? "—"}</strong>
                              {catalog?.commercial_name ? (
                                <small>{catalog.commercial_name}</small>
                              ) : null}
                            </span>
                          </td>
                          <td data-label={text("Kỹ năng")}>
                            {item.skill_name || "—"}
                          </td>
                          <td data-label={text("Đăng ký")}>
                            {item.quantity} {catalog?.unit ?? ""}
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "files" ? (
        <section className="data-panel" aria-label={text("Đính kèm")}>
          <dl className="detail-list">
            <div>
              <dt>{text("Biên bản bàn giao")}</dt>
              <dd>
                <a href={`/api/equipment-requests/${requestId}/handover`}>
                  {text("Xuất phiếu PDF")}
                </a>
              </dd>
            </div>
            {request.handover_file_url ? (
              <div>
                <dt>{text("File đính kèm")}</dt>
                <dd>
                  <a href={request.handover_file_url}>{text("Mở file")}</a>
                </dd>
              </div>
            ) : null}
            {fulfillment ? (
              signedEvents.length ? (
                signedEvents.map((event) => (
                  <div key={event.id}>
                    <dt>
                      {text(
                        fulfillmentLabels[
                          event.operation as FulfillmentOperation
                        ] ?? event.operation,
                      )}
                    </dt>
                    <dd>
                      {text("Đã ký {0}", [at(event.signature!.signed_at)])}
                    </dd>
                  </div>
                ))
              ) : (
                <div>
                  <dt>{text("Chữ ký")}</dt>
                  <dd>{text("Chưa có chữ ký xác nhận.")}</dd>
                </div>
              )
            ) : (
              <>
                <div>
                  <dt>{text("Ký nhận giao")}</dt>
                  <dd>{at(request.handover_recipient_signed_at)}</dd>
                </div>
                <div>
                  <dt>{text("Ký nhận trả")}</dt>
                  <dd>{at(request.return_recipient_signed_at)}</dd>
                </div>
              </>
            )}
          </dl>
        </section>
      ) : null}

      {tab === "related" ? (
        <section className="data-panel" aria-label={text("Liên quan")}>
          <dl className="detail-list">
            <div>
              <dt>{text("Buổi học")}</dt>
              <dd>
                {schedule
                  ? `${schedule.course_code_snapshot} · ${date.format(new Date(`${schedule.schedule_date}T00:00:00+07:00`))} · ${text("{0} sinh viên", [schedule.student_count])}`
                  : "—"}
              </dd>
            </div>
          </dl>
          {events.length ? (
            <div className="responsive-table">
              <table className="data-table records-on-phone">
                <thead>
                  <tr>
                    <th>{text("Nghiệp vụ")}</th>
                    <th>{text("Thời điểm")}</th>
                    <th>{text("Ký xác nhận")}</th>
                    <th>{text("Lý do")}</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td data-label={text("Nghiệp vụ")}>
                        {text(
                          fulfillmentLabels[
                            event.operation as FulfillmentOperation
                          ] ?? event.operation,
                        )}
                      </td>
                      <td data-label={text("Thời điểm")}>
                        {at(event.occurred_at)}
                      </td>
                      <td data-label={text("Ký xác nhận")}>
                        {event.signature ? (
                          <span className="badge" data-tone="success">
                            {text("Đã ký")}
                          </span>
                        ) : event.signature_required ? (
                          <span className="badge" data-tone="warning">
                            {text("Chờ ký")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td data-label={text("Lý do")}>{event.reason || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="panel-empty">
              {text("Chưa có lần bàn giao / thu hồi nào.")}
            </p>
          )}
        </section>
      ) : null}

      {tab === "history" ? (
        <EquipmentRequestLifecycleHistory requestId={requestId} />
      ) : null}
    </WorkspaceShell>
  );
}
