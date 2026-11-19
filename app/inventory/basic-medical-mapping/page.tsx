import {
  BasicMedicalCutoverForm,
  BasicMedicalMapForm,
} from "@/components/inventory/basic-medical-map-form";
import { requireInventoryAdmin } from "@/lib/inventory/auth";
import { formatDisplayQuantity } from "@/lib/inventory/decimal";
import { getInterfaceText } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

type MappingRow = {
  id: string;
  item_name: string;
  commercial_name: string | null;
  unit: string | null;
  mapping_id: string | null;
  inventory_item_code: string | null;
  inventory_item_name: string | null;
  base_uom_code: string | null;
  base_units_per_unit: string | null;
};

type PreviewRow = {
  room_id: string;
  room_code: string;
  building_code: string;
  basic_medical_item_id: string;
  basic_medical_item_name: string;
  unit: string | null;
  good_quantity: number;
  damaged_quantity: number;
  inventory_item_code: string | null;
  base_uom_code: string | null;
  base_good: string | null;
  base_damaged: string | null;
  blocker: string | null;
};

// t4r3 step A: map each Basic Medical item to a shared SKU, then review what
// the room opening (step B) would post. Nothing here changes stock.
export default async function BasicMedicalMappingPage() {
  await requireInventoryAdmin();
  const supabase = await createClient();
  const [{ data: items, error }, { data: preview, error: previewError }] =
    await Promise.all([
      supabase.rpc("basic_medical_mapping_read"),
      supabase.rpc("basic_medical_cutover_preview"),
    ]);
  if (error || previewError) {
    throw new Error(
      `Basic Medical mapping: ${(error ?? previewError)!.message}`,
    );
  }
  const text = await getInterfaceText();
  const rows = (items ?? []) as MappingRow[];
  const opening = preview as {
    rows: PreviewRow[];
    blocked: number;
    ready: number;
  };
  const mapped = rows.filter((row) => row.mapping_id).length;

  return (
    <>
      <section className="kpi-grid" aria-label={text("Tiến độ ghép")}>
        <div className="kpi-card kpi-navy">
          <span>{text("Đã ghép")}</span>
          <strong>
            {mapped}/{rows.length}
          </strong>
          <small>{text("thiết bị Y cơ sở")}</small>
        </div>
        <div className="kpi-card kpi-gold">
          <span>{text("Dòng tồn phòng sẵn sàng")}</span>
          <strong>{opening.ready}</strong>
          <small>{text("sẽ thành tồn đầu kỳ")}</small>
        </div>
        <div className="kpi-card kpi-danger">
          <span>{text("Dòng còn vướng")}</span>
          <strong>{opening.blocked}</strong>
          <small>{text("chưa ghép mã kho")}</small>
        </div>
      </section>

      <div className="data-panel">
        <div className="responsive-table">
          <table className="data-table records-on-phone">
            <thead>
              <tr>
                <th>{text("Thiết bị Y cơ sở")}</th>
                <th>{text("Mã hàng trong kho")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td data-label={text("Thiết bị Y cơ sở")}>
                    <span className="cell-stack">
                      <strong>{row.item_name}</strong>
                      <small>
                        {[row.commercial_name, row.unit]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                  </td>
                  <td data-label={text("Mã hàng trong kho")}>
                    {row.mapping_id ? (
                      <span className="cell-stack">
                        <strong>
                          {row.inventory_item_code} - {row.inventory_item_name}
                        </strong>
                        <small>
                          {text("1 {0} = {1} {2}", [
                            row.unit || text("đơn vị"),
                            formatDisplayQuantity(row.base_units_per_unit!),
                            row.base_uom_code ?? "",
                          ])}
                        </small>
                      </span>
                    ) : (
                      <BasicMedicalMapForm itemId={row.id} unit={row.unit} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2>{text("Xem trước tồn đầu kỳ theo phòng")}</h2>
      <BasicMedicalCutoverForm ready={opening.ready} />
      {opening.rows.length === 0 ? (
        <p className="panel-empty">
          {text("Không còn dòng tồn phòng nào chờ chuyển sang kho chung.")}
        </p>
      ) : (
        <div className="data-panel">
          <div className="responsive-table">
            <table className="data-table records-on-phone">
              <thead>
                <tr>
                  <th>{text("Phòng")}</th>
                  <th>{text("Thiết bị Y cơ sở")}</th>
                  <th className="num">{text("Tốt / hỏng hiện có")}</th>
                  <th className="num">{text("Sẽ ghi vào kho")}</th>
                </tr>
              </thead>
              <tbody>
                {opening.rows.map((row) => (
                  <tr key={`${row.room_id}-${row.basic_medical_item_id}`}>
                    <td data-label={text("Phòng")}>
                      {row.building_code}-{row.room_code}
                    </td>
                    <td data-label={text("Thiết bị Y cơ sở")}>
                      {row.basic_medical_item_name}
                    </td>
                    <td className="num" data-label={text("Tốt / hỏng hiện có")}>
                      {row.good_quantity} / {row.damaged_quantity} {row.unit}
                    </td>
                    <td className="num" data-label={text("Sẽ ghi vào kho")}>
                      {row.blocker ? (
                        <span className="badge" data-tone="warning">
                          {text(
                            {
                              NO_ROOM_LOCATION: "Phòng chưa có vị trí kho",
                              ITEM_INACTIVE: "Vật tư kho đã ngừng",
                              EXPIRY_REQUIRED:
                                "Vật tư cần hạn dùng: nhập qua Tồn đầu kỳ",
                            }[row.blocker] ?? "Chưa ghép",
                          )}
                        </span>
                      ) : (
                        `${formatDisplayQuantity(row.base_good!)} / ${formatDisplayQuantity(row.base_damaged!)} ${row.base_uom_code}`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
