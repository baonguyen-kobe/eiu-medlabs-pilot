import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { LocalizedText } from "@/components/i18n/language-provider";
import {
  basicMedicalRegistrationSelect,
  type BasicMedicalRegistrationListItem,
} from "@/lib/basic-medical-equipment";
import { isBasicMedicalConfirmationEvidenceEnabled } from "@/lib/basic-medical-confirmation-evidence";
import { formatBasicMedicalRegistrationCode } from "@/lib/basic-medical-registration-code";
import { formatEquipmentRequestCode } from "@/lib/equipment-request-code";
import { equipmentRequestStatuses } from "@/lib/equipment-requests";
import { getInterfaceText } from "@/lib/i18n/server";
import { getViewer } from "@/lib/viewer";
import { canViewBasicMedicalRegistrations } from "@/lib/workspace-access";

// Detail template (t3d): Thông tin | Nội dung | Đính kèm | Liên quan | Lịch sử.
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
const at = (value: string) => dateTime.format(new Date(value));
const day = (value: string) => value.split("-").reverse().join("/");

export default async function BasicMedicalRegistrationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const viewer = await getViewer();
  const roomTypeCodes = viewer.roomTypes.map(({ code }) => code);
  if (!canViewBasicMedicalRegistrations(viewer.roles, roomTypeCodes))
    notFound();

  const { data: row } = await viewer.supabase
    .from("basic_medical_registrations")
    .select(basicMedicalRegistrationSelect)
    .eq("id", id)
    .maybeSingle();
  if (!row) notFound();
  const registration = row as unknown as BasicMedicalRegistrationListItem;
  const sessions = [...registration.basic_medical_registration_sessions].sort(
    (left, right) => left.session_number - right.session_number,
  );
  const { data: requestRows } = sessions.length
    ? await viewer.supabase
        .from("equipment_requests")
        .select("id,status,created_at,source_identity_id")
        .eq("request_domain", "basic_medical")
        .in(
          "source_identity_id",
          sessions.map((session) => session.id),
        )
    : { data: [] };
  const requests = (requestRows ?? []) as Array<{
    id: string;
    status: string;
    created_at: string;
    source_identity_id: string;
  }>;

  const text = await getInterfaceText();
  const evidenceEnabled = isBasicMedicalConfirmationEvidenceEnabled();
  const tab: Tab = tabs.some(([key]) => key === query.tab)
    ? (query.tab as Tab)
    : "info";
  const base = `/basic-medical/registrations/${id}`;
  const href = (key: Tab) => (key === "info" ? base : `${base}?tab=${key}`);
  const code = formatBasicMedicalRegistrationCode(
    registration.registration_code,
  );
  const room = registration.rooms;
  const activeSessions = sessions.filter((session) => !session.cancelled_at);
  const confirmed = activeSessions.filter((session) =>
    session.confirmations.some((item) => !item.invalidated_at),
  ).length;
  const confirmations = sessions.flatMap((session) =>
    session.confirmations.map((confirmation) => ({ session, confirmation })),
  );
  const sessionNumber = new Map(
    sessions.map((session) => [session.id, session.session_number]),
  );
  const history = [
    { when: registration.created_at, what: text("Tạo phiếu") },
    ...(registration.cancelled_at
      ? [
          {
            when: registration.cancelled_at,
            what: text("Hủy phiếu: {0}", [registration.cancel_reason ?? "—"]),
          },
        ]
      : []),
    ...sessions.flatMap((session) =>
      session.cancelled_at
        ? [
            {
              when: session.cancelled_at,
              what: text("Hủy buổi {0}: {1}", [
                session.session_number,
                session.cancellation_reason ?? "—",
              ]),
            },
          ]
        : [],
    ),
    ...confirmations.flatMap(({ session, confirmation }) => [
      {
        when: confirmation.signed_at,
        what: text("Xác nhận buổi {0}", [session.session_number]),
      },
      ...(confirmation.invalidated_at
        ? [
            {
              when: confirmation.invalidated_at,
              what: text("Vô hiệu xác nhận buổi {0}: {1}", [
                session.session_number,
                confirmation.invalidated_reason ?? "—",
              ]),
            },
          ]
        : []),
    ]),
  ].sort((left, right) => right.when.localeCompare(left.when));

  return (
    <WorkspaceShell
      fullName={viewer.fullName}
      roles={viewer.roles}
      roomTypeCodes={roomTypeCodes}
      allowBasicMedicalAccess={viewer.allowBasicMedicalAccess}
      canImportSchedules={viewer.canImportSchedules}
      canManagePersonnel={viewer.canManagePersonnel}
      canManageEmailNotifications={viewer.canManageEmailNotifications}
      title={<LocalizedText text={"Chi tiết phiếu Y cơ sở"} />}
      description={<LocalizedText text={"Phiếu {0}"} values={[code]} />}
    >
      <p className="cell-stack">
        <Link href="/basic-medical/registrations">
          {text("← Danh sách phiếu")}
        </Link>
        <strong>
          {text("Phiếu {0}", [code])}
          {registration.courses ? ` · ${registration.courses.course_code}` : ""}
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
          <dl className="detail-list">
            <div>
              <dt>{text("Mã phiếu")}</dt>
              <dd className="mono">{code}</dd>
            </div>
            <div>
              <dt>{text("Trạng thái")}</dt>
              <dd>
                {registration.cancelled_at ? (
                  <span className="badge" data-tone="danger">
                    {text("Đã hủy")}
                  </span>
                ) : (
                  <span
                    className="badge"
                    data-tone={
                      confirmed === activeSessions.length ? "success" : "info"
                    }
                  >
                    {text("Đã xác nhận {0}/{1} buổi", [
                      confirmed,
                      activeSessions.length,
                    ])}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>{text("Môn học")}</dt>
              <dd>
                {registration.courses
                  ? `${registration.courses.course_code} · ${registration.courses.course_name}`
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
              <dt>{text("Thời gian")}</dt>
              <dd>
                {day(registration.start_date)} → {day(registration.end_date)} ·{" "}
                {registration.semester} {registration.academic_year}
              </dd>
            </div>
            <div>
              <dt>{text("Người đăng ký")}</dt>
              <dd>{registration.registrant?.full_name ?? "—"}</dd>
            </div>
            <div>
              <dt>{text("Giảng viên phụ trách")}</dt>
              <dd>{registration.responsible?.full_name ?? "—"}</dd>
            </div>
            <div>
              <dt>{text("Sĩ số")}</dt>
              <dd>{registration.student_count}</dd>
            </div>
            <div>
              <dt>{text("Ghi chú chung")}</dt>
              <dd>{registration.note || text("Không có ghi chú")}</dd>
            </div>
          </dl>
          <div className="list-filters-actions">
            <Link
              className="button button-secondary"
              href={`/basic-medical/registrations?q=${encodeURIComponent(code)}&status=all`}
            >
              {text("Xác nhận buổi / sửa / hủy trên danh sách")}
            </Link>
          </div>
        </section>
      ) : null}

      {tab === "content" ? (
        <div className="data-panel">
          <div className="responsive-table">
            <table className="data-table records-on-phone">
              <thead>
                <tr>
                  <th>{text("Buổi")}</th>
                  <th>{text("Nội dung")}</th>
                  <th>{text("Lịch học")}</th>
                  <th>{text("Giảng viên giảng dạy")}</th>
                  <th>{text("Xác nhận")}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => {
                  const valid = session.confirmations.find(
                    (item) => !item.invalidated_at,
                  );
                  const schedule = session.class_schedules;
                  return (
                    <tr key={session.id}>
                      <td data-label={text("Buổi")}>
                        {session.session_number}
                      </td>
                      <td data-label={text("Nội dung")}>
                        {session.lesson_title}
                      </td>
                      <td data-label={text("Lịch học")}>
                        {schedule
                          ? `${day(schedule.schedule_date)} · ${schedule.start_time.slice(0, 5)}–${schedule.end_time.slice(0, 5)}`
                          : "—"}
                      </td>
                      <td data-label={text("Giảng viên giảng dạy")}>
                        {session.teaching?.full_name ?? "—"}
                      </td>
                      <td data-label={text("Xác nhận")}>
                        {session.cancelled_at ? (
                          <span className="badge" data-tone="neutral">
                            {text("Đã hủy buổi")}
                          </span>
                        ) : valid ? (
                          <span className="badge" data-tone="success">
                            {text("Đã xác nhận")}
                          </span>
                        ) : (
                          <span className="badge" data-tone="warning">
                            {text("Chưa xác nhận")}
                          </span>
                        )}
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
        confirmations.length ? (
          <div className="data-panel">
            <div className="responsive-table">
              <table className="data-table records-on-phone">
                <thead>
                  <tr>
                    <th>{text("Buổi")}</th>
                    <th>{text("Thời điểm ký")}</th>
                    <th>{text("Hiệu lực")}</th>
                    <th>{text("Bằng chứng")}</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmations.map(({ session, confirmation }) => (
                    <tr key={confirmation.id}>
                      <td data-label={text("Buổi")}>
                        {session.session_number}
                      </td>
                      <td data-label={text("Thời điểm ký")}>
                        {at(confirmation.signed_at)}
                      </td>
                      <td data-label={text("Hiệu lực")}>
                        {confirmation.invalidated_at ? (
                          <span className="badge" data-tone="danger">
                            {text("Đã vô hiệu")}
                          </span>
                        ) : (
                          <span className="badge" data-tone="success">
                            {text("Đang có hiệu lực")}
                          </span>
                        )}
                      </td>
                      <td data-label={text("Bằng chứng")}>
                        {evidenceEnabled ? (
                          <span className="cell-stack">
                            <Link
                              href={`/basic-medical/registrations/confirmations/${confirmation.id}`}
                            >
                              {text("Xem bằng chứng")}
                            </Link>
                            <a
                              href={`/api/basic-medical/registrations/confirmations/${confirmation.id}/pdf`}
                            >
                              {text("Xuất PDF")}
                            </a>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="panel-empty">
            {text("Chưa có buổi nào được xác nhận.")}
          </p>
        )
      ) : null}

      {tab === "related" ? (
        requests.length ? (
          <div className="data-panel">
            <div className="responsive-table">
              <table className="data-table records-on-phone">
                <thead>
                  <tr>
                    <th>{text("Phiếu thiết bị")}</th>
                    <th>{text("Buổi")}</th>
                    <th>{text("Trạng thái")}</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td data-label={text("Phiếu thiết bị")}>
                        <Link href={`/equipment/requests/${request.id}`}>
                          {formatEquipmentRequestCode(request.created_at)}
                        </Link>
                      </td>
                      <td data-label={text("Buổi")}>
                        {sessionNumber.get(request.source_identity_id) ?? "—"}
                      </td>
                      <td data-label={text("Trạng thái")}>
                        {text(
                          equipmentRequestStatuses.find(
                            ({ value }) => value === request.status,
                          )?.label ?? request.status,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="panel-empty">
            {text("Chưa có phiếu thiết bị nào gắn với các buổi này.")}
          </p>
        )
      ) : null}

      {tab === "history" ? (
        <section className="data-panel" aria-label={text("Lịch sử")}>
          <ol className="cell-stack">
            {history.map((entry, index) => (
              <li key={`${entry.when}-${index}`}>
                <strong>{entry.what}</strong> <small>{at(entry.when)}</small>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </WorkspaceShell>
  );
}
