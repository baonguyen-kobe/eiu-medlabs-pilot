import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { EquipmentRequestLifecycleHistory } from "@/components/equipment-request-lifecycle-history";
import { RequestItemsTable } from "@/components/equipment-request-detail/items-table";
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
  searchParams: Promise<{ tab?: string; side?: string }>;
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

  // Old `?tab=history` links still land on the history panel.
  const sideTab =
    query.side === "history" || query.tab === "history" ? "history" : "summary";
  const base = `/equipment/requests/${requestId}`;
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
  const pendingSign = events.some(
    (event) => event.signature_required && !event.signature,
  );
  const fulfillmentHref = `/equipment/fulfillment/${requestId}`;
  const primary: { href: string; label: string } | null = !inventoryManaged
    ? null
    : canManage && request.status === "new"
      ? {
          href: `/equipment/preparation/${requestId}`,
          label: "Chuẩn bị thiết bị",
        }
      : canManage &&
          ["preparing", "handed_over", "returned"].includes(request.status)
        ? { href: fulfillmentHref, label: "Bàn giao / thu hồi" }
        : canSign && pendingSign
          ? { href: fulfillmentHref, label: "Ký xác nhận" }
          : null;
  const subtitle = [
    schedule
      ? `${schedule.course_code_snapshot} · ${schedule.course_name_snapshot}`
      : "",
    room ? `${room.building_code}-${room.room_code}` : "",
    request.receive_at || request.return_at
      ? `${at(request.receive_at)} → ${at(request.return_at)}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const itemHeaders = fulfillment
    ? ["Đăng ký", "Đã giao", "Đã trả", "Còn phải trả"]
    : ["Kỹ năng", "Đăng ký"];
  const itemRows = fulfillment
    ? fulfillment.lines.map((line) => {
        const slices = fulfillment.issues.filter(
          (issue) => issue.request_line_id === line.id,
        );
        return {
          id: line.id,
          name: line.name,
          cells: [
            `${formatDisplayQuantity(line.registered_quantity)} ${line.unit}`,
            formatDisplayQuantity(sum(slices.map((slice) => slice.issued))),
            formatDisplayQuantity(sum(slices.map((slice) => slice.returned))),
            formatDisplayQuantity(sum(slices.map((slice) => slice.due))),
          ],
        };
      })
    : request.equipment_request_items.map((item) => {
        const catalog =
          item.equipment_catalog ?? item.basic_medical_equipment_catalog;
        return {
          id: item.id,
          name: [catalog?.item_name ?? "—", catalog?.commercial_name]
            .filter(Boolean)
            .join(" · "),
          cells: [
            item.skill_name || "—",
            `${item.quantity} ${catalog?.unit ?? ""}`.trim(),
          ],
        };
      });
  const operationLabel = (operation: string) =>
    text(fulfillmentLabels[operation as FulfillmentOperation] ?? operation);

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
      <div className="kho-record">
        <header className="kho-record-header">
          <div className="kho-record-head">
            <div className="kho-record-title">
              <Link href={listHref}>← {text("Danh sách phiếu")}</Link>
              <h2>{text("Phiếu {0}", [code])}</h2>
              <span
                className="badge"
                data-tone={request.status === "cancelled" ? "danger" : "info"}
              >
                {text(statusLabel)}
              </span>
              {subtitle ? (
                <span className="kho-record-sub">{subtitle}</span>
              ) : null}
            </div>
            <div className="kho-record-actions">
              {primary ? (
                <Link className="button button-primary" href={primary.href}>
                  {text(primary.label)}
                </Link>
              ) : null}
              <a
                className="button button-secondary"
                href={`/api/equipment-requests/${requestId}/handover`}
              >
                {text("Xuất phiếu PDF")}
              </a>
              {canManage ? (
                <Link className="button button-secondary" href={listHref}>
                  {text("Đổi trạng thái / hủy trên danh sách")}
                </Link>
              ) : null}
            </div>
          </div>
          {request.status === "cancelled" ? null : (
            <ol className="kho-steps" aria-label={text("Tiến độ phiếu")}>
              {equipmentRequestWorkflowStatuses.map((step, index) => (
                <li
                  key={step.value}
                  data-state={
                    index < stepIndex
                      ? "done"
                      : index === stepIndex
                        ? "current"
                        : "todo"
                  }
                  aria-current={index === stepIndex ? "step" : undefined}
                >
                  {text(step.label)}
                </li>
              ))}
            </ol>
          )}
        </header>

        <div className="kho-record-grid">
          <div className="kho-record-main">
            <section className="kho-card" aria-labelledby="req-items">
              <div className="kho-card-head">
                <h3 id="req-items">{text("Thiết bị của phiếu")}</h3>
              </div>
              <RequestItemsTable headers={itemHeaders} rows={itemRows} />
            </section>

            <section
              className="kho-card kho-card-pad"
              aria-labelledby="req-info"
            >
              <div className="kho-card-head">
                <h3 id="req-info">{text("Thông tin")}</h3>
              </div>
              <dl className="kho-facts">
                <div>
                  <dt>{text("Mã phiếu")}</dt>
                  <dd className="mono">{code}</dd>
                </div>
                <div>
                  <dt>{text("Lĩnh vực")}</dt>
                  <dd>
                    {request.request_domain === "basic_medical"
                      ? text("Y cơ sở")
                      : text("Skills lab")}
                  </dd>
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
                {request.handover_file_url ? (
                  <div>
                    <dt>{text("File đính kèm")}</dt>
                    <dd>
                      <a href={request.handover_file_url}>{text("Mở file")}</a>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          </div>

          <aside className="kho-record-aside">
            <nav className="kho-side-tabs" aria-label={text("Bảng bên")}>
              <Link
                href={base}
                scroll={false}
                aria-current={sideTab === "summary" ? "page" : undefined}
              >
                {text("Tóm tắt")}
              </Link>
              <Link
                href={`${base}?side=history`}
                scroll={false}
                aria-current={sideTab === "history" ? "page" : undefined}
              >
                {text("Lịch sử")}
              </Link>
            </nav>
            {sideTab === "history" ? (
              <EquipmentRequestLifecycleHistory requestId={requestId} />
            ) : events.length ? (
              <ol className="kho-timeline">
                {events.map((event) => (
                  <li key={event.id}>
                    <strong>{operationLabel(event.operation)}</strong>
                    <span>{at(event.occurred_at)}</span>
                    {event.signature ? (
                      <span className="badge" data-tone="success">
                        {text("Đã ký")}
                      </span>
                    ) : event.signature_required ? (
                      <span className="badge" data-tone="warning">
                        {text("Chờ ký")}
                      </span>
                    ) : null}
                    {event.reason ? <small>{event.reason}</small> : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="panel-empty">
                {text("Chưa có lần bàn giao / thu hồi nào.")}
              </p>
            )}
          </aside>
        </div>
      </div>
    </WorkspaceShell>
  );
}
