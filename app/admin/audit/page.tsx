import { AdminShell } from "@/components/admin-shell";
import { requireAdmin } from "@/lib/admin";
import { CatalogTabs } from "@/components/catalog-tabs";
import { PaginationLinks } from "@/components/pagination-links";
import { normalizePage, paginationRange } from "@/lib/pagination";
import { LocalizedText } from "@/components/i18n/language-provider";
import { LocalizedElement } from "@/components/i18n/localized-element";

const actionLabels: Record<string, string> = {
  "class_schedule.created": "Tạo lịch học",
  "class_schedule.updated": "Sửa lịch học",
  "class_schedule.status_changed": "Đổi trạng thái lịch",
  "class_schedule.lecturer_changed": "Đổi giảng viên",
  "staff_shift.created": "Tạo ca trực",
  "staff_shift.updated": "Sửa ca trực",
  "staff_shift.status_changed": "Đổi trạng thái ca",
  "import.started": "Bắt đầu import",
  "import.status_changed": "Cập nhật import",
  "role.assigned": "Gán vai trò",
  "role.removed": "Gỡ vai trò",
  "profile.updated": "Đổi trạng thái tài khoản",
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const query = await searchParams;
  const currentPage = normalizePage(query.page);
  const { from, to } = paginationRange(currentPage);
  const { data: logs, count } = await supabase
    .from("audit_logs")
    .select(
      `
      id, action, entity_type, entity_id, created_at,
      profiles!audit_logs_actor_id_fkey (full_name, email)
    `,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  return (
    <AdminShell
      title="Audit log"
      description={
        <LocalizedText
          text={"Lịch sử thay đổi nghiệp vụ, chỉ admin được xem."}
        />
      }
      active="/admin/audit"
    >
      <CatalogTabs active="/admin/audit" />
      <div className="data-panel catalog-data-panel">
        <LocalizedElement
          as="div"
          textAttributes={["aria-label"]}
          className="responsive-table"
          role="region"
          aria-label="Lịch sử thay đổi; vuốt ngang để xem đầy đủ"
          tabIndex={0}
        >
          <table className="data-table catalog-data-table">
            <thead>
              <tr>
                <th>
                  <LocalizedText text={"Thời gian"} />
                </th>
                <th>
                  <LocalizedText text={"Người thao tác"} />
                </th>
                <th>
                  <LocalizedText text={"Hành động"} />
                </th>
                <th>
                  <LocalizedText text={"Đối tượng"} />
                </th>
                <th>
                  <LocalizedText text={"Mã bản ghi"} />
                </th>
              </tr>
            </thead>
            <tbody>
              {(logs ?? []).map((log) => {
                const actor = log.profiles as unknown as {
                  full_name: string;
                  email: string;
                } | null;
                return (
                  <tr key={log.id}>
                    <td>
                      {new Intl.DateTimeFormat("vi-VN", {
                        dateStyle: "short",
                        timeStyle: "medium",
                        timeZone: "Asia/Ho_Chi_Minh",
                      }).format(new Date(log.created_at))}
                    </td>
                    <td>
                      {actor?.full_name ?? <LocalizedText text={"Hệ thống"} />}
                      <small>{actor?.email}</small>
                    </td>
                    <td>
                      <strong>
                        <LocalizedText
                          text={actionLabels[log.action] ?? log.action}
                        />
                      </strong>
                    </td>
                    <td className="mono">{log.entity_type}</td>
                    <td className="mono">
                      {log.entity_id?.slice(0, 8) ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </LocalizedElement>
        <PaginationLinks
          currentPage={currentPage}
          totalItems={count ?? 0}
          pathname="/admin/audit"
        />
      </div>
    </AdminShell>
  );
}
