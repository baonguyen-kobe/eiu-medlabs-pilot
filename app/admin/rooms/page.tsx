import { AdminShell } from "@/components/admin-shell";
import {
  createRoom,
  createRoomType,
  importRooms,
  toggleRoomType,
} from "@/app/admin/actions";
import { CatalogTabs } from "@/components/catalog-tabs";
import { CatalogImportActions } from "@/components/catalog-import-actions";
import { PaginationLinks } from "@/components/pagination-links";
import { requireAdmin } from "@/lib/admin";
import { normalizePage, paginationRange } from "@/lib/pagination";
import { CatalogBatchManager } from "@/components/catalog-batch-manager";
import { LocalizedText } from "@/components/i18n/language-provider";
import { LocalizedElement } from "@/components/i18n/localized-element";

export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string; page?: string }>;
}) {
  const { supabase } = await requireAdmin();
  const query = await searchParams;
  const currentPage = normalizePage(query.page);
  const { from, to } = paginationRange(currentPage);
  const [{ data: rooms, count }, { data: roomTypes }] = await Promise.all([
    supabase
      .from("rooms")
      .select(
        "id, room_code, building_code, room_name, room_type_id, capacity, is_active, room_types (name)",
        { count: "exact" },
      )
      .order("building_code")
      .order("room_code")
      .range(from, to),
    supabase
      .from("room_types")
      .select("id, code, name, is_active")
      .order("name"),
  ]);
  return (
    <AdminShell
      title={<LocalizedText text={"Danh mục phòng"} />}
      description={
        <LocalizedText
          text={"Quản lý mã phòng, tòa nhà và sức chứa dùng khi xếp lịch."}
        />
      }
      active="/admin/rooms"
      actions={<CatalogImportActions action={importRooms} catalog="rooms" />}
    >
      <CatalogTabs active="/admin/rooms" />
      {query.notice ? (
        <p className="action-feedback success">
          <LocalizedText text={query.notice} />
        </p>
      ) : null}
      {query.error ? (
        <p className="action-feedback error">
          <LocalizedText text={query.error} />
        </p>
      ) : null}
      <details className="catalog-manual-add">
        <summary>
          <LocalizedText text={"+ Thêm phòng"} />
        </summary>
        <form
          action={createRoom}
          className="admin-create-form admin-create-room"
        >
          <label>
            <LocalizedText text={"Mã phòng"} />
            <input name="room_code" required placeholder="301" />
          </label>
          <label>
            <LocalizedText text={"Tòa nhà"} />
            <input name="building_code" required placeholder="A3" />
          </label>
          <label>
            <LocalizedText text={"Tên phòng"} />
            <LocalizedElement
              as="input"
              textAttributes={["placeholder"]}
              name="room_name"
              placeholder="Phòng học 301"
            />
          </label>
          <label>
            <LocalizedText text={"Loại phòng"} />
            <select name="room_type_id" required defaultValue="">
              <option value="" disabled>
                <LocalizedText text={"Chọn Loại phòng"} />
              </option>
              {(roomTypes ?? [])
                .filter(({ is_active }) => is_active)
                .map((roomType) => (
                  <option key={roomType.id} value={roomType.id}>
                    {roomType.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <LocalizedText text={"Sức chứa"} />
            <input name="capacity" type="number" min="1" />
          </label>
          <button className="button button-primary">
            <LocalizedText text={"Thêm phòng"} />
          </button>
        </form>
      </details>
      <CatalogBatchManager
        kind="rooms"
        initialItems={(rooms ?? []).map((room) => ({
          ...room,
          room_types: room.room_types as unknown as { name: string } | null,
        }))}
        roomTypes={roomTypes ?? []}
      />
      <PaginationLinks
        currentPage={currentPage}
        totalItems={count ?? 0}
        pathname="/admin/rooms"
      />
      <details className="admin-create-personnel room-type-manager">
        <summary>
          <LocalizedText text={"Quản lý Loại phòng"} />
        </summary>
        <form action={createRoomType} className="admin-create-form">
          <label>
            <LocalizedText text={"Tên Loại phòng"} />
            <input name="name" required />
          </label>
          <label>
            <LocalizedText text={"Mã kỹ thuật"} />
            <input name="code" required placeholder="basic_medical" />
          </label>
          <button className="button button-primary">
            <LocalizedText text={"Thêm Loại phòng"} />
          </button>
        </form>
        <LocalizedElement
          as="div"
          textAttributes={["aria-label"]}
          className="responsive-table"
          role="region"
          aria-label="Danh sách Loại phòng"
          tabIndex={0}
        >
          <table className="data-table catalog-data-table">
            <thead>
              <tr>
                <th>
                  <LocalizedText text={"Tên"} />
                </th>
                <th>
                  <LocalizedText text={"Mã"} />
                </th>
                <th>
                  <LocalizedText text={"Trạng thái"} />
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(roomTypes ?? []).map((roomType) => (
                <tr key={roomType.id}>
                  <td>
                    <strong>{roomType.name}</strong>
                  </td>
                  <td className="mono">{roomType.code}</td>
                  <td>
                    {roomType.is_active ? (
                      <LocalizedText text={"Đang dùng"} />
                    ) : (
                      <LocalizedText text={"Ngừng dùng"} />
                    )}
                  </td>
                  <td>
                    <form action={toggleRoomType}>
                      <input type="hidden" name="id" value={roomType.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={String(!roomType.is_active)}
                      />
                      <button className="table-action">
                        {roomType.is_active ? (
                          <LocalizedText text={"Ngừng dùng"} />
                        ) : (
                          <LocalizedText text={"Kích hoạt"} />
                        )}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </LocalizedElement>
      </details>
    </AdminShell>
  );
}
