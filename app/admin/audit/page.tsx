import Link from "next/link";
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
  "class_schedule.deleted": "Xóa lịch học",
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
  "personnel.created": "Thêm nhân sự",
  "personnel.updated": "Sửa nhân sự",
  "personnel.locked": "Khóa tài khoản",
  "personnel.unlocked": "Mở khóa tài khoản",
  "personnel.promoted_to_admin": "Nâng lên quản trị viên",
  "personnel.admin_role_removed": "Gỡ quyền quản trị viên",
  "personnel.import_applied": "Nhập danh sách nhân sự",
  "personnel.import_skipped_protected_account":
    "Bỏ qua tài khoản được bảo vệ khi nhập",
  "personnel.email_notification_capability_changed":
    "Đổi quyền quản lý email thông báo",
  password_reset: "Đặt lại mật khẩu",
  password_changed_by_root: "Quản trị cấp cao đổi mật khẩu",
  password_change_completed: "Đổi mật khẩu",
  "equipment_request.status_changed": "Đổi trạng thái phiếu thiết bị",
  "equipment_request.cancelled": "Hủy phiếu thiết bị",
  "equipment_request.hard_deleted": "Xóa phiếu thiết bị",
  "equipment_request.item_added": "Thêm thiết bị vào phiếu",
  "equipment_request.item_removed": "Bớt thiết bị khỏi phiếu",
  "equipment_request.status_rolled_back": "Hoàn tác trạng thái phiếu",
  "equipment_item.scopes_changed": "Đổi phạm vi dùng của thiết bị",
  "room.basic_medical_sharing_changed": "Đổi chia sẻ phòng cho Y cơ sở",
  "basic_medical.catalog_imported": "Nhập danh mục thiết bị Y cơ sở",
  "basic_medical.confirmation_invalidated": "Hủy xác nhận buổi Y cơ sở",
  "basic_medical.registration_cancelled": "Hủy đăng ký Y cơ sở",
  "basic_medical.session_cancelled": "Hủy buổi Y cơ sở",
  "catalog.reconciled": "Đối soát danh mục",
  "inventory.acquisition_line_created": "Thêm dòng nhập hàng",
  "inventory.acquisition_line_updated": "Sửa dòng nhập hàng",
  "inventory.acquisition_source_created": "Thêm nguồn nhập hàng",
  "inventory.acquisition_source_updated": "Sửa nguồn nhập hàng",
  "inventory.basic_medical_cutover": "Chuyển Y cơ sở sang quản lý kho",
  "inventory.basic_medical_mapped": "Gắn thiết bị Y cơ sở vào kho",
  "inventory.category_created": "Thêm nhóm vật tư",
  "inventory.category_updated": "Sửa nhóm vật tư",
  "inventory.category_active_changed": "Bật/tắt nhóm vật tư",
  "inventory.item_created": "Thêm vật tư",
  "inventory.item_updated": "Sửa vật tư",
  "inventory.item_active_state_changed": "Bật/tắt vật tư",
  "inventory.location_created": "Thêm vị trí kho",
  "inventory.location_updated": "Sửa vị trí kho",
  "inventory.location_active_changed": "Bật/tắt vị trí kho",
  "inventory.opening_confirmed": "Xác nhận tồn đầu kỳ",
  "inventory.opening_expiry_verified": "Xác nhận hạn dùng tồn đầu kỳ",
  "inventory.stock_condition_changed": "Đổi tình trạng hàng trong kho",
  "inventory.stock_corrected": "Điều chỉnh tồn kho",
  "inventory.stock_received": "Nhập kho",
  "inventory.stock_transferred": "Chuyển kho",
  "inventory.stocktake_reconciled": "Chốt kiểm kê",
  "inventory.supplier_created": "Thêm nhà cung cấp",
  "inventory.supplier_updated": "Sửa nhà cung cấp",
  "inventory.supplier_active_changed": "Bật/tắt nhà cung cấp",
  "inventory.surplus_verified": "Xác nhận hàng thừa",
  "inventory.uom_created": "Thêm đơn vị tính",
  "inventory.uom_updated": "Sửa đơn vị tính",
  "inventory.uom_active_changed": "Bật/tắt đơn vị tính",
};

const entityLabels: Record<string, string> = {
  profile: "Tài khoản",
  personnel_import: "Nhập nhân sự",
  equipment_request: "Phiếu thiết bị",
  equipment_catalog: "Danh mục thiết bị",
  equipment_item: "Thiết bị",
  class_schedules: "Lịch học",
  class_schedule: "Lịch học",
  staff_shifts: "Ca trực",
  staff_shift: "Ca trực",
  rooms: "Phòng",
  room: "Phòng",
  courses: "Học phần",
  basic_medical_registration: "Đăng ký Y cơ sở",
  basic_medical_registration_session: "Buổi Y cơ sở",
  basic_medical_session_confirmation: "Xác nhận buổi Y cơ sở",
  basic_medical_equipment_catalog: "Danh mục thiết bị Y cơ sở",
  inventory_catalog_item: "Vật tư",
  inventory_storage_location: "Vị trí kho",
  inventory_category: "Nhóm vật tư",
  inventory_supplier: "Nhà cung cấp",
  inventory_uom: "Đơn vị tính",
  inventory_pilot_scope: "Phạm vi kho",
  equipment_preparation_settings: "Cài đặt chuẩn bị thiết bị",
};

const actionOptions = Object.entries(actionLabels).sort(([, a], [, b]) =>
  a.localeCompare(b, "vi"),
);

// Dates are Vietnam calendar days, so filter on the +07:00 day boundaries.
const asDayStart = (value?: string) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+07:00` : null;
const asNextDayStart = (value?: string) => {
  const start = asDayStart(value);
  if (!start) return null;
  const next = new Date(start);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    action?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { supabase } = await requireAdmin();
  const query = await searchParams;
  const currentPage = normalizePage(query.page);
  const { from, to } = paginationRange(currentPage);
  const action =
    query.action && query.action in actionLabels ? query.action : "";
  const fromStart = asDayStart(query.from);
  const toEnd = asNextDayStart(query.to);
  let logQuery = supabase
    .from("audit_logs")
    .select(
      `
      id, action, entity_type, entity_id, created_at,
      profiles!audit_logs_actor_id_fkey (full_name, email)
    `,
      { count: "exact" },
    )
    .order("created_at", { ascending: false });
  if (action) logQuery = logQuery.eq("action", action);
  if (fromStart) logQuery = logQuery.gte("created_at", fromStart);
  if (toEnd) logQuery = logQuery.lt("created_at", toEnd);
  const { data: logs, count } = await logQuery.range(from, to);

  return (
    <AdminShell
      title="Lịch sử thay đổi"
      description={
        <LocalizedText
          text={"Lịch sử thay đổi nghiệp vụ, chỉ admin được xem."}
        />
      }
      active="/admin/audit"
    >
      <CatalogTabs active="/admin/audit" />
      <form className="list-filters audit-filters" method="get">
        <label>
          <LocalizedText text={"Hành động"} />
          <select name="action" defaultValue={action}>
            <option value="">Tất cả hành động</option>
            {actionOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <LocalizedText text={"Từ ngày"} />
          <input type="date" name="from" defaultValue={query.from ?? ""} />
        </label>
        <label>
          <LocalizedText text={"Đến ngày"} />
          <input type="date" name="to" defaultValue={query.to ?? ""} />
        </label>
        <div className="list-filters-actions">
          <button type="submit" className="button button-primary">
            <LocalizedText text={"Lọc"} />
          </button>
          {action || query.from || query.to ? (
            <Link href="/admin/audit" className="button button-secondary">
              <LocalizedText text={"Xóa bộ lọc"} />
            </Link>
          ) : null}
        </div>
      </form>
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
                          text={actionLabels[log.action] ?? "Thao tác khác"}
                        />
                      </strong>
                      {actionLabels[log.action] ? null : (
                        <small title={log.action}>{log.action}</small>
                      )}
                    </td>
                    <td title={log.entity_type}>
                      <LocalizedText
                        text={entityLabels[log.entity_type] ?? "Dữ liệu khác"}
                      />
                    </td>
                    <td className="mono" title={log.entity_id ?? undefined}>
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
          query={{ action, from: query.from, to: query.to }}
        />
      </div>
    </AdminShell>
  );
}
