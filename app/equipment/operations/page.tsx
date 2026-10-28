import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getViewer } from "@/lib/viewer";
import {
  equipmentOperationsSchema,
  equipmentOperationHref,
  operationPhases,
} from "@/lib/equipment-operations";
import styles from "@/components/equipment-preparation.module.css";
import { LocalizedText } from "@/components/i18n/language-provider";
import { LocalizedElement } from "@/components/i18n/localized-element";

const dateTime = new Intl.DateTimeFormat("vi-VN", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Asia/Ho_Chi_Minh",
});
export default async function EquipmentOperationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const phase =
    typeof params.phase === "string" && params.phase in operationPhases
      ? (params.phase as keyof typeof operationPhases)
      : "all";
  const search =
    typeof params.search === "string" ? params.search.slice(0, 120) : "";
  const rawPage = typeof params.page === "string" ? Number(params.page) : 1;
  const page =
    Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100000
      ? rawPage
      : 1;
  const viewer = await getViewer();
  const { data, error } = await viewer.supabase.rpc(
    "equipment_operations_read",
    { p_filters: { phase, search, page } },
  );
  if (error) {
    if (error.code === "42501") notFound();
    throw new Error(
      "Không tải được công việc kho. Hãy tải lại; dữ liệu cũ không bị thay đổi.",
    );
  }
  const queue = equipmentOperationsSchema.parse(data);
  const pageHref = (next: number) =>
    `/equipment/operations?${new URLSearchParams({ phase, search, page: String(next) })}`;
  return (
    <WorkspaceShell
      fullName={viewer.fullName}
      roles={viewer.roles}
      roomTypeCodes={viewer.roomTypes.map(({ code }) => code)}
      allowBasicMedicalAccess={viewer.allowBasicMedicalAccess}
      canImportSchedules={viewer.canImportSchedules}
      canManagePersonnel={viewer.canManagePersonnel}
      canManageEmailNotifications={viewer.canManageEmailNotifications}
      title={<LocalizedText text={"Công việc kho & giao nhận"} />}
      description={
        <LocalizedText
          text={
            "Theo dõi chuẩn bị, giao, chữ ký, trả thiếu và đối soát theo đúng phạm vi."
          }
        />
      }
    >
      <div className={styles.root}>
        <form method="get" className="grid gap-3 md:grid-cols-3">
          <label>
            <LocalizedText text={"Tìm phiếu, môn, lớp hoặc người phụ trách"} />
            <input name="search" defaultValue={search} maxLength={120} />
          </label>
          <label>
            <LocalizedText text={"Việc cần xử lý"} />
            <select name="phase" defaultValue={phase}>
              {Object.entries(operationPhases).map(([value, label]) => (
                <option key={value} value={value}>
                  <LocalizedText text={label} />
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button className="button" type="submit">
              <LocalizedText text={"Lọc công việc"} />
            </button>
            <Link
              href="/equipment/operations"
              className="button button-secondary"
            >
              <LocalizedText text={"Đặt lại"} />
            </Link>
          </div>
        </form>
        <p>
          {queue.total}
          <LocalizedText text={" phiếu · Trang "} />
          {page}/{Math.max(1, Math.ceil(queue.total / queue.page_size))}
          <LocalizedText
            text={
              ". Số dòng cần trả là số nghĩa vụ, không cộng số lượng khác đơn vị."
            }
          />
        </p>
        <Link href="/equipment/preparation">
          <LocalizedText text={"Mở hàng đợi chuẩn bị chi tiết"} />
        </Link>
        {queue.rows.length === 0 ? (
          <p>
            <LocalizedText
              text={"Không có công việc trong phạm vi và bộ lọc hiện tại."}
            />
          </p>
        ) : (
          queue.rows.map((row) => {
            const fulfill =
              row.prepared ||
              (row.has_preparation &&
                !["new", "preparing"].includes(row.status));
            const legacy = !row.has_preparation && row.status !== "new";
            return (
              <article key={row.id} className="my-4 space-y-2">
                <h2>
                  {row.course_code} · {row.course_name} ·{" "}
                  {row.class_code ?? "—"}
                </h2>
                <p>
                  <LocalizedText text={"Phụ trách: "} />
                  {row.responsible_name || (
                    <LocalizedText text={"Chưa ghi nhận"} />
                  )}
                </p>
                <p>
                  <LocalizedText text={"Nhận "} />
                  {dateTime.format(new Date(row.receive_at))}
                  <LocalizedText text={" · Trả"} />{" "}
                  {dateTime.format(new Date(row.return_at))}
                </p>
                <p>
                  {row.status === "new" ? (
                    <LocalizedText text={"Cần chuẩn bị"} />
                  ) : row.status === "preparing" ? (
                    <LocalizedText text={"Chờ giao"} />
                  ) : row.status === "completed" ? (
                    <LocalizedText
                      text={"Đã hoàn tất phiếu; kiểm tra việc đối soát còn mở"}
                    />
                  ) : (
                    <LocalizedText text={"Đã giao / đang theo dõi trả"} />
                  )}
                </p>
                {["pending", "rejected"].includes(
                  row.late_approval_status ?? "",
                ) ? (
                  <p>
                    <LocalizedText
                      text={
                        "Cần xử lý phê duyệt đăng ký muộn trước khi xác nhận chuẩn bị."
                      }
                    />
                  </p>
                ) : null}
                {row.unsigned_count > 0 ? (
                  <p>
                    <LocalizedText text={"Chờ ký: "} />
                    {row.unsigned_count}
                    <LocalizedText text={" sự kiện"} />
                  </p>
                ) : null}
                {row.due_line_count > 0 ? (
                  <p>
                    {row.return_overdue ? (
                      <LocalizedText text={"Quá hạn trả"} />
                    ) : (
                      <LocalizedText text={"Còn phải trả"} />
                    )}
                    : {row.due_line_count}
                    <LocalizedText text={" dòng dụng cụ / tài sản"} />
                  </p>
                ) : null}
                {row.hold_line_count > 0 ? (
                  <p>
                    <LocalizedText text={"Chờ Admin đối soát: "} />
                    {row.hold_line_count}
                    <LocalizedText
                      text={" dòng hold; chưa sẵn sàng giao lại."}
                    />
                  </p>
                ) : null}
                {legacy ? (
                  <p>
                    <LocalizedText
                      text={
                        "Phiếu theo luồng cũ; mở giao nhận legacy, chưa có số lượng Inventory để đối chiếu."
                      }
                    />
                  </p>
                ) : null}
                <Link
                  className="button button-secondary"
                  href={equipmentOperationHref(row)}
                >
                  {legacy ? (
                    <LocalizedText text={"Mở phiếu theo luồng cũ"} />
                  ) : fulfill ? (
                    <LocalizedText text={"Mở giao nhận và nghĩa vụ"} />
                  ) : (
                    <LocalizedText text={"Mở chuẩn bị"} />
                  )}
                </Link>
              </article>
            );
          })
        )}
        <LocalizedElement
          as="nav"
          textAttributes={["aria-label"]}
          aria-label="Phân trang công việc kho"
          className="flex gap-3"
        >
          {page > 1 ? (
            <Link className="button button-secondary" href={pageHref(page - 1)}>
              <LocalizedText text={"Trang trước"} />
            </Link>
          ) : null}
          {page * queue.page_size < queue.total ? (
            <Link className="button button-secondary" href={pageHref(page + 1)}>
              <LocalizedText text={"Trang tiếp"} />
            </Link>
          ) : null}
        </LocalizedElement>
      </div>
    </WorkspaceShell>
  );
}
