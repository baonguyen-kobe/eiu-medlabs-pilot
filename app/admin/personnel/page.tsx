import Link from "next/link";
import { AdminShell } from "@/components/admin-shell";
import { createPersonnel, importPersonnel } from "@/app/admin/actions";
import { requirePersonnelManager } from "@/lib/admin";
import { NURSING_SKILLS_ROOM_TYPE_ID } from "@/lib/room-types";
import { Download, UploadCloud } from "@/components/icons";
import { PersonnelImportButtons } from "@/components/personnel-import-buttons";
import { PaginationLinks } from "@/components/pagination-links";
import { TABLE_PAGE_SIZE, normalizePage } from "@/lib/pagination";
import {
  PersonnelManagementList,
  type PersonnelListItem,
} from "@/components/personnel-management-list";
import { PersonnelBasicMedicalPermissionField } from "@/components/personnel-basic-medical-permission-field";
import { createAdminClient } from "@/lib/supabase/admin";
import { LocalizedText } from "@/components/i18n/language-provider";
import { LocalizedElement } from "@/components/i18n/localized-element";

const roleLabels = {
  admin: "Quản trị viên",
  staff: "Chuyên viên",
  lecturer: "Giảng viên",
  teaching_assistant: "Trợ giảng",
  viewer: "Người xem",
} as const;

export default async function PersonnelPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    role?: string;
    import_permission?: string;
    status?: string;
    notice?: string;
    error?: string;
    page?: string;
  }>;
}) {
  const { supabase, userId, authority } = await requirePersonnelManager();
  const query = await searchParams;
  const currentPage = normalizePage(query.page);
  const authAdmin = createAdminClient();
  const [
    { data: roomTypes },
    { data: personnelRows, error: personnelError },
    { data: passwordReconciliationRows },
  ] = await Promise.all([
    supabase
      .from("room_types")
      .select("id,code,name")
      .eq("is_active", true)
      .order("name"),
    supabase.rpc("admin_list_personnel", {
      target_query: query.q?.trim() || null,
      target_role: query.role && query.role !== "all" ? query.role : null,
      target_import_permission: query.import_permission ?? "all",
      target_status: query.status ?? "all",
      target_page: currentPage,
      target_page_size: TABLE_PAGE_SIZE,
    }),
    authority.is_root_administrator
      ? authAdmin.rpc("list_recoverable_personnel_password_operations")
      : Promise.resolve({ data: [] }),
  ]);
  const rows = (personnelRows ?? []) as Array<
    PersonnelListItem & { total_count: number }
  >;
  const totalItems = Number(rows[0]?.total_count ?? 0);
  const passwordCapableById = new Map(
    await Promise.all(
      rows.map(async (row) => {
        const { data } = await authAdmin.auth.admin.getUserById(row.id);
        const providers = new Set([
          data.user?.app_metadata?.provider,
          ...(data.user?.app_metadata?.providers ?? []),
          ...(data.user?.identities ?? []).map((identity) => identity.provider),
        ]);
        return [row.id, providers.has("email")] as const;
      }),
    ),
  );
  const emailCapabilityById = new Map(
    await Promise.all(
      rows.map(async (row) => {
        const { data } = await authAdmin
          .from("profiles")
          .select("can_manage_email_notifications")
          .eq("id", row.id)
          .maybeSingle();
        return [row.id, Boolean(data?.can_manage_email_notifications)] as const;
      }),
    ),
  );

  return (
    <AdminShell
      title={<LocalizedText text={"Nhân sự & phân quyền"} />}
      description={
        <LocalizedText
          text={
            "Vai trò chính, quyền bổ sung và phạm vi được lưu trong một thao tác."
          }
        />
      }
      active="/admin/personnel"
    >
      {query.notice ? (
        <p className="action-feedback success">{query.notice}</p>
      ) : null}
      {query.error || personnelError ? (
        <p className="action-feedback error">
          {query.error ?? (
            <LocalizedText text={"Không thể tải danh sách nhân sự."} />
          )}
        </p>
      ) : null}

      <form
        action={importPersonnel}
        className="data-panel equipment-catalog-import personnel-import-panel"
      >
        <label className="equipment-import-file">
          <UploadCloud size={20} />
          <span>
            <LocalizedText text={"File CSV hoặc XLSX"} />
          </span>
          <LocalizedElement
            as="input"
            textAttributes={["aria-label"]}
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label="Chọn file import nhân sự"
            name="file"
            required
            type="file"
          />
        </label>
        <div className="equipment-import-actions">
          <Link
            className="button equipment-template-download"
            download
            href="/api/admin-catalog-template/personnel"
            prefetch={false}
          >
            <Download size={17} />
            <LocalizedText text={" Tải template"} />
          </Link>
          <PersonnelImportButtons />
        </div>
      </form>

      <details className="admin-create-personnel">
        <summary>
          <LocalizedText text={"Thêm nhân sự mới"} />
        </summary>
        <form action={createPersonnel}>
          <label>
            <LocalizedText text={"Họ và tên"} />
            <input name="full_name" required />
          </label>
          <label>
            <LocalizedText text={"Email đăng nhập"} />
            <input name="email" type="email" required />
          </label>
          <label>
            <LocalizedText text={"Mật khẩu tạm"} />
            <input name="password" type="password" minLength={8} required />
          </label>
          <label>
            <LocalizedText text={"Số điện thoại"} />
            <input name="phone" />
          </label>
          <label>
            <LocalizedText text={"Chức danh"} />
            <input name="title" />
          </label>
          <fieldset>
            <legend>
              <LocalizedText text={"Vai trò ban đầu"} />
            </legend>
            {(Object.keys(roleLabels) as Array<keyof typeof roleLabels>).map(
              (role) => (
                <label className="check-label" key={role}>
                  <input name="roles" type="checkbox" value={role} />
                  <LocalizedText text={roleLabels[role]} />
                </label>
              ),
            )}
          </fieldset>
          <fieldset>
            <legend>
              <LocalizedText text={"Quyền bổ sung"} />
            </legend>
            <label className="check-label">
              <input name="can_import_schedules" type="checkbox" value="true" />
              <LocalizedText text={"Cho phép nhập lịch"} />
            </label>
            <PersonnelBasicMedicalPermissionField />
          </fieldset>
          <fieldset>
            <legend>
              <LocalizedText text={"Loại phòng"} />
            </legend>
            {(roomTypes ?? []).map((roomType) => (
              <div className="person-room-scope" key={roomType.id}>
                <label className="check-label">
                  <input
                    name="room_type_ids"
                    type="checkbox"
                    value={roomType.id}
                    defaultChecked={roomType.id === NURSING_SKILLS_ROOM_TYPE_ID}
                  />
                  {roomType.name}
                </label>
                <label className="check-label">
                  <input
                    name="email_room_type_ids"
                    type="checkbox"
                    value={roomType.id}
                  />
                  <LocalizedText
                    text={"Nhận email lịch của loại phòng này (Người xem)"}
                  />
                </label>
              </div>
            ))}
          </fieldset>
          <button className="button button-primary">
            <LocalizedText text={"Tạo tài khoản"} />
          </button>
        </form>
      </details>

      <form className="personnel-filters" method="get">
        <label>
          <span>
            <LocalizedText text={"Tìm kiếm"} />
          </span>
          <LocalizedElement
            as="input"
            textAttributes={["placeholder"]}
            name="q"
            defaultValue={query.q}
            placeholder="Tên, email, số điện thoại…"
          />
        </label>
        <label>
          <span>
            <LocalizedText text={"Vai trò"} />
          </span>
          <select name="role" defaultValue={query.role ?? "all"}>
            <option value="all">
              <LocalizedText text={"Tất cả vai trò"} />
            </option>
            {(Object.keys(roleLabels) as Array<keyof typeof roleLabels>).map(
              (role) => (
                <option value={role} key={role}>
                  <LocalizedText text={roleLabels[role]} />
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          <span>
            <LocalizedText text={"Quyền nhập lịch"} />
          </span>
          <select
            name="import_permission"
            defaultValue={query.import_permission ?? "all"}
          >
            <option value="all">
              <LocalizedText text={"Tất cả"} />
            </option>
            <option value="enabled">
              <LocalizedText text={"Có"} />
            </option>
            <option value="disabled">
              <LocalizedText text={"Không"} />
            </option>
          </select>
        </label>
        <label>
          <span>
            <LocalizedText text={"Trạng thái"} />
          </span>
          <select name="status" defaultValue={query.status ?? "all"}>
            <option value="all">
              <LocalizedText text={"Tất cả trạng thái"} />
            </option>
            <option value="active">
              <LocalizedText text={"Đang hoạt động"} />
            </option>
            <option value="inactive">
              <LocalizedText text={"Đã khóa"} />
            </option>
          </select>
        </label>
        <button className="button button-secondary">
          <LocalizedText text={"Lọc"} />
        </button>
        <span className="inline-toolbar-count-slot">
          <span className="personnel-result-count inline-toolbar-count">
            {totalItems}
            <LocalizedText text={" nhân sự"} />
          </span>
        </span>
      </form>

      <PersonnelManagementList
        key={`${currentPage}:${query.q ?? ""}:${query.role ?? "all"}:${query.import_permission ?? "all"}:${query.status ?? "all"}:${rows.map((row) => `${row.id}:${row.access_version}`).join("|")}`}
        initialItems={rows.map(({ total_count, ...row }) => {
          void total_count;
          return {
            ...row,
            password_capable: passwordCapableById.get(row.id) ?? false,
            can_manage_email_notifications:
              emailCapabilityById.get(row.id) ?? false,
          };
        })}
        roomTypes={roomTypes ?? []}
        viewerId={userId}
        viewerIsRoot={authority.is_root_administrator}
        passwordReconciliationItems={
          (
            (passwordReconciliationRows ?? []) as Array<{
              id: string;
              correlation_id: string;
              action: string;
              status: string;
              created_at: string;
              target_full_name: string | null;
              target_email: string | null;
            }>
          ).map((operation) => ({
            ...operation,
            target:
              operation.target_full_name || operation.target_email
                ? {
                    full_name: operation.target_full_name ?? (
                      <LocalizedText text={"Nhân sự"} />
                    ),
                    email: operation.target_email ?? "",
                  }
                : null,
          })) as Array<{
            id: string;
            correlation_id: string;
            action: string;
            status: string;
            created_at: string;
            target: { full_name: string; email: string } | null;
          }>
        }
      />
      {!rows.length ? (
        <p className="panel-empty">
          <LocalizedText text={"Không tìm thấy nhân sự phù hợp."} />
        </p>
      ) : null}
      <PaginationLinks
        currentPage={currentPage}
        totalItems={totalItems}
        pathname="/admin/personnel"
        query={{
          q: query.q,
          role: query.role,
          import_permission: query.import_permission,
          status: query.status,
        }}
      />
    </AdminShell>
  );
}
