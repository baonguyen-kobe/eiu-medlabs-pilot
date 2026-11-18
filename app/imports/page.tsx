import { Download, FileClock, Import } from "@/components/icons";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getViewer } from "@/lib/viewer";
import { PaginationLinks } from "@/components/pagination-links";
import { normalizePage, paginationRange } from "@/lib/pagination";
import { LocalizedText } from "@/components/i18n/language-provider";
import { LocalizedElement } from "@/components/i18n/localized-element";
import {
  canImportBasicMedicalSchedules,
  canImportSkillsSchedules,
  canManageBasicMedicalWorkspace,
} from "@/lib/workspace-access";

const importStatusLabels: Record<string, string> = {
  uploaded: "Đã tải lên",
  validating: "Đang kiểm tra",
  ready: "Sẵn sàng import",
  validated: "Đã kiểm tra",
  importing: "Đang tạo lịch",
  completed: "Hoàn tất",
  completed_with_errors: "Hoàn tất · Có lỗi",
  failed: "Thất bại",
};

type ImportKind = {
  label: string;
  note: string;
  href: string;
  template: string;
};

/** One Import page (t4d): pick a data type, get its template, open its import. */
export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const {
    supabase,
    fullName,
    roles,
    roomTypes,
    allowBasicMedicalAccess,
    canImportSchedules,
    canManagePersonnel,
    canManageEmailNotifications,
  } = await getViewer();
  const roomTypeCodes = roomTypes.map(({ code }) => code);
  const isAdmin = roles.includes("admin");
  const isStaff = roles.includes("staff");
  const canSkills = canImportSkillsSchedules(
    roles,
    roomTypeCodes,
    canImportSchedules,
  );

  const kinds: ImportKind[] = [
    ...(canSkills
      ? [
          {
            label: "Lịch Skills lab",
            note: "Tạo nhiều buổi học Skills lab từ một file.",
            href: "/schedule-entry/import",
            template: "/api/import-template/xlsx?scope=skills_lab",
          },
        ]
      : []),
    ...(canImportBasicMedicalSchedules(roles, roomTypeCodes, canImportSchedules)
      ? [
          {
            label: "Lịch Y cơ sở",
            note: "Tạo phiếu Y cơ sở và các buổi học từ một file.",
            href: "/basic-medical/import",
            template: "/api/import-template/xlsx?scope=basic_medical",
          },
        ]
      : []),
    ...(isAdmin || (isStaff && roomTypeCodes.includes("nursing_skills"))
      ? [
          {
            label: "Danh mục thiết bị Skills lab",
            note: "Thêm hoặc cập nhật thiết bị trong danh mục.",
            href: "/admin/equipment",
            template: "/api/admin-catalog-template/equipment",
          },
        ]
      : []),
    ...((isAdmin || isStaff) &&
    canManageBasicMedicalWorkspace(roles, roomTypeCodes)
      ? [
          {
            label: "Danh mục thiết bị Y cơ sở",
            note: "Thêm hoặc cập nhật thiết bị Y cơ sở theo phòng.",
            href: "/basic-medical/equipment",
            template: "/api/basic-medical-equipment-template",
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            label: "Môn học",
            note: "Thêm hoặc cập nhật danh mục môn học.",
            href: "/admin/courses",
            template: "/api/admin-catalog-template/courses",
          },
          {
            label: "Phòng",
            note: "Thêm hoặc cập nhật danh mục phòng.",
            href: "/admin/rooms",
            template: "/api/admin-catalog-template/rooms",
          },
        ]
      : []),
    ...(isAdmin && canManagePersonnel
      ? [
          {
            label: "Nhân sự",
            note: "Thêm hoặc cập nhật tài khoản và phạm vi.",
            href: "/admin/personnel",
            template: "/api/admin-catalog-template/personnel",
          },
        ]
      : []),
  ];
  if (!kinds.length) redirect("/dashboard");

  const query = await searchParams;
  const currentPage = normalizePage(query.page);
  const { from, to } = paginationRange(currentPage);
  // shortcut: history lists schedule imports (import_batches) only; catalog
  // and personnel imports keep no batch rows yet. Add them when they do.
  const { data: batches, count } = await supabase
    .from("import_batches")
    .select(
      `
      id, original_file_name, status, total_rows, valid_rows, warning_rows,
      error_rows, imported_rows, duplicate_rows, conflict_rows, created_at, completed_at,
      room_types (name),
      creator:profiles!import_batches_created_by_fkey (full_name)
    `,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  return (
    <WorkspaceShell
      fullName={fullName}
      roles={roles}
      roomTypeCodes={roomTypeCodes}
      allowBasicMedicalAccess={allowBasicMedicalAccess}
      canImportSchedules={canImportSchedules}
      canManagePersonnel={canManagePersonnel}
      canManageEmailNotifications={canManageEmailNotifications}
      title={<LocalizedText text={"Import dữ liệu"} />}
      description={
        <LocalizedText
          text={
            "Chọn loại dữ liệu, tải mẫu, rồi mở trang import để xem trước và áp dụng."
          }
        />
      }
    >
      <LocalizedElement
        as="section"
        textAttributes={["aria-label"]}
        className="import-kinds"
        aria-label="Loại dữ liệu"
      >
        {kinds.map((kind) => (
          <article key={kind.href}>
            <strong>
              <LocalizedText text={kind.label} />
            </strong>
            <small>
              <LocalizedText text={kind.note} />
            </small>
            <div className="list-filters-actions">
              <Link
                className="button button-secondary"
                href={kind.template}
                download
                prefetch={false}
              >
                <Download size={16} aria-hidden="true" />
                <LocalizedText text={"Tải mẫu"} />
              </Link>
              <Link className="button button-primary" href={kind.href}>
                <LocalizedText text={"Import"} />
              </Link>
            </div>
          </article>
        ))}
      </LocalizedElement>

      <section className="data-panel">
        <div className="data-toolbar">
          <Import size={20} />
          <h2 className="standard-section-heading">
            <LocalizedText text={"Lịch sử import"} />
          </h2>
          <span>
            {count ?? 0}
            <LocalizedText text={" phiên"} />
          </span>
        </div>
        <LocalizedElement
          as="div"
          textAttributes={["aria-label"]}
          className="responsive-table"
          role="region"
          aria-label="Lịch sử import; vuốt ngang để xem đầy đủ"
          tabIndex={0}
        >
          <table className="data-table import-history-table">
            <thead>
              <tr>
                <th>
                  <LocalizedText text={"File"} />
                </th>
                <th>
                  <LocalizedText text={"Thời điểm"} />
                </th>
                <th>
                  <LocalizedText text={"Người import"} />
                </th>
                <th>
                  <LocalizedText text={"Trạng thái"} />
                </th>
                <th>
                  <LocalizedText text={"Phạm vi"} />
                </th>
                <th>
                  <LocalizedText text={"Tổng"} />
                </th>
                <th>
                  <LocalizedText text={"Đã tạo"} />
                </th>
                <th>
                  <LocalizedText text={"Cảnh báo"} />
                </th>
                <th>
                  <LocalizedText text={"Lỗi"} />
                </th>
                <th>
                  <LocalizedText text={"Trùng"} />
                </th>
                <th>
                  <LocalizedText text={"Xung đột"} />
                </th>
              </tr>
            </thead>
            <tbody>
              {(batches ?? []).map((batch) => (
                <tr key={batch.id}>
                  <td>
                    <strong>
                      <FileClock size={15} /> {batch.original_file_name}
                    </strong>
                    <small className="mono">{batch.id}</small>
                  </td>
                  <td>
                    {new Intl.DateTimeFormat("vi-VN", {
                      dateStyle: "short",
                      timeStyle: "short",
                      timeZone: "Asia/Ho_Chi_Minh",
                    }).format(new Date(batch.created_at))}
                  </td>
                  <td>
                    {(batch.creator as unknown as { full_name: string } | null)
                      ?.full_name ?? "—"}
                  </td>
                  <td>
                    <span className="status-pill">
                      <LocalizedText
                        text={importStatusLabels[batch.status] ?? batch.status}
                      />
                    </span>
                  </td>
                  <td>
                    <strong>
                      {(batch.room_types as unknown as { name: string } | null)
                        ?.name ?? <LocalizedText text={"Kỹ năng Điều dưỡng"} />}
                    </strong>
                  </td>
                  <td>{batch.total_rows}</td>
                  <td>{batch.imported_rows}</td>
                  <td>{batch.warning_rows}</td>
                  <td>
                    {batch.error_rows > 0 ? (
                      <a href={`/api/import-errors/${batch.id}`}>
                        {batch.error_rows}
                      </a>
                    ) : (
                      batch.error_rows
                    )}
                  </td>
                  <td>{batch.duplicate_rows}</td>
                  <td>{batch.conflict_rows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </LocalizedElement>
        {!batches?.length ? (
          <p className="panel-empty">
            <LocalizedText text={"Chưa có phiên import nào."} />
          </p>
        ) : null}
        <PaginationLinks
          currentPage={currentPage}
          totalItems={count ?? 0}
          pathname="/imports"
        />
      </section>
    </WorkspaceShell>
  );
}
