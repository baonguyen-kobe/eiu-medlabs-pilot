import Link from "next/link";
import { notFound } from "next/navigation";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { formatDisplayQuantity } from "@/lib/inventory/decimal";
import { readRoomEquipment, roomLabel } from "@/lib/inventory/room-equipment";
import { getInterfaceText } from "@/lib/i18n/server";

const tabs = [
  ["fixed", "Cố định"],
  ["temporary", "Tạm mượn"],
  ["assets", "Tài sản có mã"],
] as const;
type Tab = (typeof tabs)[number][0];

const assetTone: Record<string, string> = {
  ready: "success",
  in_use: "info",
  under_maintenance: "warning",
  damaged: "danger",
  prohibited: "neutral",
};
const assetLabel: Record<string, string> = {
  ready: "Sẵn sàng",
  in_use: "Đang dùng",
  under_maintenance: "Đang bảo trì",
  damaged: "Hỏng",
  prohibited: "Không được cấp",
};

const dateFormatter = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Asia/Ho_Chi_Minh",
});

export default async function RoomEquipmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireInventoryViewer();
  const [{ roomId }, query] = await Promise.all([params, searchParams]);
  // Seeded rooms use non-RFC ids, so check the shape only.
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(roomId)) notFound();
  const data = await readRoomEquipment(roomId);
  if (!data.room) notFound();
  const text = await getInterfaceText();
  const tab: Tab = tabs.some(([key]) => key === query.tab)
    ? (query.tab as Tab)
    : "fixed";
  const damaged =
    data.fixed.filter((row) => Number(row.damaged ?? 0) > 0).length +
    data.assets.filter((row) => row.operational_status === "damaged").length;
  const counts: Record<Tab, number> = {
    fixed: data.fixed.length,
    temporary: data.temporary.length,
    assets: data.assets.length,
  };
  const empty = counts.fixed + counts.temporary + counts.assets === 0;
  const href = (key: Tab) =>
    key === "fixed"
      ? `/inventory/rooms/${roomId}`
      : `/inventory/rooms/${roomId}?tab=${key}`;

  return (
    <>
      <p className="cell-stack">
        <Link href="/inventory/rooms">{text("← Tất cả phòng")}</Link>
        <strong>
          {text("Phòng {0}", [roomLabel(data.room)])}
          {data.room.room_name ? ` · ${data.room.room_name}` : ""}
        </strong>
      </p>

      {empty ? (
        <p className="panel-empty">
          {text("Phòng này chưa có thiết bị.")}{" "}
          <Link href="/inventory/receive">{text("Nhận kho")}</Link>
          {" · "}
          <Link href="/inventory/operations">{text("Nghiệp vụ kho")}</Link>
        </p>
      ) : (
        <>
          <section
            className="kpi-grid"
            aria-label={text("Tổng quan thiết bị phòng")}
          >
            <Link
              href={href("fixed")}
              className="kpi-card kpi-navy"
              scroll={false}
            >
              <span>{text("Cố định")}</span>
              <strong>{counts.fixed + counts.assets}</strong>
              <small>{text("mục tại phòng")}</small>
            </Link>
            <Link
              href={href("temporary")}
              className="kpi-card kpi-gold"
              scroll={false}
            >
              <span>{text("Tạm mượn")}</span>
              <strong>{counts.temporary}</strong>
              <small>{text("dòng còn phải trả")}</small>
            </Link>
            <div className="kpi-card kpi-danger">
              <span>{text("Hỏng")}</span>
              <strong>{damaged}</strong>
              <small>{text("mục cần xử lý")}</small>
            </div>
          </section>

          <nav className="segmented-control" aria-label={text("Nhóm thiết bị")}>
            {tabs.map(([key, label]) => (
              <Link
                key={key}
                href={href(key)}
                scroll={false}
                className={tab === key ? "selected" : ""}
                aria-current={tab === key ? "page" : undefined}
              >
                {text(label)} ({counts[key]})
              </Link>
            ))}
          </nav>

          {tab === "fixed" ? (
            data.fixed.length ? (
              <div className="data-panel">
                <div className="responsive-table">
                  <table className="data-table records-on-phone">
                    <thead>
                      <tr>
                        <th>{text("Vật tư")}</th>
                        <th className="num">{text("SL tốt")}</th>
                        <th className="num">{text("SL hỏng")}</th>
                        <th>{text("ĐVT")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.fixed.map((row) => (
                        <tr key={row.item_id}>
                          <td data-label={text("Vật tư")}>
                            <span className="cell-stack">
                              <strong>{row.name}</strong>
                              <small>{row.code}</small>
                            </span>
                          </td>
                          <td className="num" data-label={text("SL tốt")}>
                            {formatDisplayQuantity(row.good ?? "0")}
                          </td>
                          <td className="num" data-label={text("SL hỏng")}>
                            {Number(row.damaged ?? 0) > 0 ? (
                              <span className="badge" data-tone="danger">
                                {formatDisplayQuantity(row.damaged!)}
                              </span>
                            ) : (
                              0
                            )}
                          </td>
                          <td data-label={text("ĐVT")}>{row.base_uom_code}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="panel-empty">
                {text("Phòng chưa có vật tư cố định theo số lượng.")}
              </p>
            )
          ) : null}

          {tab === "temporary" ? (
            data.temporary.length ? (
              <div className="data-panel">
                <div className="responsive-table">
                  <table className="data-table records-on-phone">
                    <thead>
                      <tr>
                        <th>{text("Vật tư")}</th>
                        <th className="num">{text("Còn phải trả")}</th>
                        <th>{text("Hạn trả")}</th>
                        <th>{text("Phiếu")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.temporary.map((row, index) => (
                        <tr
                          key={`${row.request_id}-${row.asset_id ?? row.code}-${index}`}
                        >
                          <td data-label={text("Vật tư")}>
                            <span className="cell-stack">
                              <strong>{row.name}</strong>
                              <small>{row.asset_code ?? row.code}</small>
                            </span>
                          </td>
                          <td className="num" data-label={text("Còn phải trả")}>
                            {formatDisplayQuantity(row.outstanding)}{" "}
                            {row.base_uom_code}
                          </td>
                          <td data-label={text("Hạn trả")}>
                            {dateFormatter.format(new Date(row.return_at))}
                          </td>
                          <td data-label={text("Phiếu")}>
                            <Link
                              href={`/equipment/fulfillment/${row.request_id}`}
                            >
                              {text("Mở giao / trả")}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="panel-empty">
                {text("Không có thiết bị nào đang mượn tại phòng này.")}
              </p>
            )
          ) : null}

          {tab === "assets" ? (
            data.assets.length ? (
              <div className="data-panel">
                <div className="responsive-table">
                  <table className="data-table records-on-phone">
                    <thead>
                      <tr>
                        <th>{text("Mã thiết bị")}</th>
                        <th>{text("Tên")}</th>
                        <th>{text("Tình trạng")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.assets.map((row) => (
                        <tr key={row.id}>
                          <td data-label={text("Mã thiết bị")}>
                            <Link href={`/inventory/assets/${row.id}`}>
                              {row.asset_code}
                            </Link>
                          </td>
                          <td data-label={text("Tên")}>{row.name}</td>
                          <td data-label={text("Tình trạng")}>
                            <span
                              className="badge"
                              data-tone={
                                assetTone[row.operational_status] ?? "neutral"
                              }
                            >
                              {text(
                                assetLabel[row.operational_status] ??
                                  row.operational_status,
                              )}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="panel-empty">
                {text("Phòng chưa có thiết bị có mã.")}
              </p>
            )
          ) : null}
        </>
      )}
    </>
  );
}
