import Link from "next/link";
import { PaginationLinks } from "@/components/pagination-links";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { readRoomSummary, roomLabel } from "@/lib/inventory/room-equipment";
import { getInterfaceText } from "@/lib/i18n/server";
import { normalizePage } from "@/lib/pagination";

const PAGE_SIZE = 50;

export default async function RoomEquipmentListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireInventoryViewer();
  const params = await searchParams;
  const q = params.q?.trim().slice(0, 100) ?? "";
  const summary = await readRoomSummary(q, normalizePage(params.page));
  const text = await getInterfaceText();

  return (
    <>
      <form className="list-filters" method="get">
        <label>
          {text("Tìm kiếm")}
          <input
            name="q"
            defaultValue={q}
            placeholder={text("Mã phòng, tòa nhà hoặc tên phòng")}
          />
        </label>
        <div className="list-filters-actions">
          <button type="submit" className="button button-primary">
            {text("Lọc")}
          </button>
          {q ? (
            <Link href="/inventory/rooms" className="button button-secondary">
              {text("Xóa bộ lọc")}
            </Link>
          ) : null}
          <span className="inline-toolbar-count">
            {text("{0} phòng", [summary.total])}
          </span>
        </div>
      </form>

      {summary.rows.length === 0 ? (
        <p className="panel-empty">
          {q
            ? text("Không có phòng nào khớp bộ lọc.")
            : text("Chưa có phòng đang hoạt động.")}
        </p>
      ) : (
        <div className="data-panel">
          <div className="responsive-table kho-list">
            <table className="data-table records-on-phone">
              <thead>
                <tr>
                  <th>{text("Phòng")}</th>
                  <th>{text("Loại phòng")}</th>
                  <th className="num">{text("Cố định")}</th>
                  <th className="num">{text("Tạm mượn")}</th>
                  <th className="num">{text("Hỏng")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((room) => (
                  <tr key={room.room_id}>
                    <td data-label={text("Phòng")}>
                      <span className="cell-stack">
                        <Link href={`/inventory/rooms/${room.room_id}`}>
                          {roomLabel(room)}
                        </Link>
                        {room.room_name ? (
                          <small>{room.room_name}</small>
                        ) : null}
                      </span>
                    </td>
                    <td data-label={text("Loại phòng")}>
                      {room.room_type ?? "—"}
                    </td>
                    <td className="num" data-label={text("Cố định")}>
                      {room.fixed}
                    </td>
                    <td className="num" data-label={text("Tạm mượn")}>
                      {room.temporary}
                    </td>
                    <td className="num" data-label={text("Hỏng")}>
                      {room.damaged ? (
                        <span className="badge" data-tone="danger">
                          {room.damaged}
                        </span>
                      ) : (
                        0
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PaginationLinks
        currentPage={summary.page}
        totalItems={summary.total}
        pathname="/inventory/rooms"
        query={{ q: q || undefined }}
        pageSize={PAGE_SIZE}
      />
    </>
  );
}
