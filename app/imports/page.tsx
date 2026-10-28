import { FileClock, Import, Plus } from "@/components/icons";
import Link from "next/link";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getViewer } from "@/lib/viewer";
import { PaginationLinks } from "@/components/pagination-links";
import { normalizePage, paginationRange } from "@/lib/pagination";
import { LocalizedText } from "@/components/i18n/language-provider";
import { LocalizedElement } from "@/components/i18n/localized-element";

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
  if (
    !roles.includes("admin") &&
    !(
      canImportSchedules &&
      roles.some((role) =>
        ["staff", "lecturer", "teaching_assistant"].includes(role),
      )
    )
  ) {
    redirect("/dashboard");
  }

  const query = await searchParams;
  const currentPage = normalizePage(query.page);
  const { from, to } = paginationRange(currentPage);
  const { data: batches, count } = await supabase
    .from("import_batches")
    .select(
      `
      id, original_file_name, status, total_rows, valid_rows, warning_rows,
      error_rows, imported_rows, duplicate_rows, conflict_rows, created_at, completed_at,
      room_types (name)
    `,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  return (
    <WorkspaceShell
      fullName={fullName}
      roles={roles}
      roomTypeCodes={roomTypes.map(({ code }) => code)}
      allowBasicMedicalAccess={allowBasicMedicalAccess}
      canImportSchedules={canImportSchedules}
      canManagePersonnel={canManagePersonnel}
      canManageEmailNotifications={canManageEmailNotifications}
      title={<LocalizedText text={"Lịch sử import"} />}
      description={
        <LocalizedText
          text={"Theo dõi số dòng đã tạo, cảnh báo, lỗi và dữ liệu trùng."}
        />
      }
      actions={
        <Link className="button button-primary" href="/schedule-entry/import">
          <Plus size={17} />
          <LocalizedText text={" Import mới"} />
        </Link>
      }
    >
      <section className="data-panel">
        <div className="data-toolbar">
          <Import size={20} />
          <h2 className="standard-section-heading">
            <LocalizedText text={"Các phiên import gần đây"} />
          </h2>
          <span>
            {batches?.length ?? 0}
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
                  <td>{batch.error_rows}</td>
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
