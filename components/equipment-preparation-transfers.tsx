"use client";

import { useRef, useState } from "react";
import {
  changePreparation,
  readPreparation,
} from "@/app/equipment/preparation/actions";
import { readPreparationTransfers } from "@/app/equipment/preparation/transfer-actions";
import {
  preparationWorkspaceSchema,
  type PreparationWorkspace,
} from "@/lib/equipment-preparation";
import {
  transferAssetsSchema,
  transferDebtsSchema,
  transferLocationsSchema,
  transferSourcesSchema,
  type TransferAsset,
  type TransferDebt,
  type TransferLocation,
  type TransferReadResource,
  type TransferSource,
} from "@/lib/equipment-preparation-transfers";
import type { Json } from "@/lib/database.types";

type TransferAttempt = { payload: Record<string, Json>; key: string };
type Props = {
  workspace: PreparationWorkspace;
  lockToken: string | null;
  disabled: boolean;
  onWorkspace: (next: PreparationWorkspace) => void;
  onBusyChange: (busy: boolean) => void;
};

export function EquipmentPreparationTransfers({
  workspace,
  lockToken,
  disabled,
  onWorkspace,
  onBusyChange,
}: Props) {
  const [sources, setSources] = useState<TransferSource[]>([]);
  const [locations, setLocations] = useState<TransferLocation[]>([]);
  const [assets, setAssets] = useState<TransferAsset[]>([]);
  const [debts, setDebts] = useState<TransferDebt[]>([]);
  const [pages, setPages] = useState<Record<TransferReadResource, number>>({
    sources: 1,
    locations: 1,
    assets: 1,
    debts: 1,
  });
  const [sourceKey, setSourceKey] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [assetCode, setAssetCode] = useState("");
  const [debtId, setDebtId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [condition, setCondition] = useState("good");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusyState] = useState(false);
  function setBusy(value: boolean) {
    setBusyState(value);
    onBusyChange(value);
  }
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<TransferAttempt | null>(null);
  const running = useRef(false);
  const requestId = workspace.request.id;
  const reversing = workspace.preparation?.state === "reversing";
  const source = sources.find(
    (row) => `${row.inventory_item_id}:${row.location_id}` === sourceKey,
  );
  const asset = assets.find((row) => row.id === assetId);
  const debt = debts.find((row) => row.id === debtId);
  const serialized = reversing
    ? Boolean(debt?.asset_id)
    : source?.tracking_strategy === "serialized";
  const writable =
    workspace.manager &&
    !disabled &&
    !busy &&
    (reversing ||
      (workspace.preparation?.state === "draft" && Boolean(lockToken)));

  async function load(resource: TransferReadResource, page: number) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await readPreparationTransfers(requestId, resource, {
        page,
        inventory_item_id: source?.inventory_item_id ?? null,
        location_id: source?.location_id ?? null,
        asset_code: assetCode,
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      if (resource === "sources") {
        setSources(transferSourcesSchema.parse(result.data).rows);
        setSourceKey("");
        setAssets([]);
        setAssetId("");
      }
      if (resource === "locations") {
        setLocations(transferLocationsSchema.parse(result.data).rows);
        setDestinationId("");
      }
      if (resource === "assets") {
        setAssets(transferAssetsSchema.parse(result.data).rows);
        setAssetId("");
      }
      if (resource === "debts") {
        setDebts(transferDebtsSchema.parse(result.data).rows);
        setDebtId("");
      }
      setPages((current) => ({ ...current, [resource]: page }));
      setConfirmed(false);
    } catch {
      setMessage("Không tải được dữ liệu chuyển kho. Hãy thử tải lại.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function submit(attempt: TransferAttempt) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    setPending(attempt);
    try {
      const result = await changePreparation(
        requestId,
        "physical_transfer",
        attempt.payload,
        attempt.key,
      );
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setPending(null);
      setConfirmed(false);
      setQuantity("");
      setAssetId("");
      setAssets([]);
      setDebtId("");
      setDebts([]);
      setSourceKey("");
      setSources([]);
      onWorkspace(result.data);
      setMessage(
        "Đã ghi nhận chuyển kho vật lý. Tải lại nguồn hoặc nghĩa vụ hoàn trả trước lần chuyển tiếp theo. Cam kết không được giải phóng bởi thao tác này.",
      );
    } catch {
      setMessage(
        "Kết nối gián đoạn. Dùng Thử lại cùng thao tác để tránh ghi trùng; không thực hiện lại việc chuyển vật lý.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function transfer() {
    if (!writable || pending || !confirmed || !reason.trim()) return;
    const common = {
      expected_revision: workspace.request.revision,
      lock_token: lockToken,
      quantity: serialized ? "1" : quantity,
      physical_confirmation: true,
      reason: reason.trim(),
    };
    if (reversing) {
      if (!debt) return;
      void submit({
        key: crypto.randomUUID(),
        payload: {
          ...common,
          compensates_id: debt.id,
          cohort_id: debt.cohort_id,
          asset_id: debt.asset_id,
          source_location_id: debt.source_location_id,
          destination_location_id: debt.destination_location_id,
          condition: serialized ? "asset" : condition,
          expected_version: debt.expected_version,
          expected_stock_revision: debt.expected_stock_revision,
          asset_revision: debt.asset_revision,
        },
      });
    } else {
      if (!source || !destinationId || (serialized && !asset)) return;
      void submit({
        key: crypto.randomUUID(),
        payload: {
          ...common,
          inventory_item_id: source.inventory_item_id,
          source_location_id: source.location_id,
          destination_location_id: destinationId,
          condition: "good",
          asset_id: asset?.id ?? null,
          asset_revision: asset?.revision ?? null,
        },
      });
    }
  }

  async function refresh() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await readPreparation(requestId);
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      onWorkspace(preparationWorkspaceSchema.parse(result.data));
      setConfirmed(false);
      setDebts([]);
      setDebtId("");
      setSources([]);
      setSourceKey("");
      setAssets([]);
      setAssetId("");
      setMessage(
        "Đã tải phiên bản mới. Rà soát nguồn và lịch sử trước khi xác nhận. Thao tác chưa rõ kết quả vẫn giữ mã thử lại cũ.",
      );
    } catch {
      setMessage(
        "Không tải được phiên bản mới; nội dung đang nhập được giữ nguyên.",
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function pagination(resource: TransferReadResource, count: number) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="button button-secondary"
          disabled={busy || pages[resource] <= 1}
          onClick={() => void load(resource, pages[resource] - 1)}
        >
          Trang trước
        </button>
        <span>Trang {pages[resource]}</span>
        <button
          type="button"
          className="button button-secondary"
          disabled={busy || count < 100}
          onClick={() => void load(resource, pages[resource] + 1)}
        >
          Trang sau
        </button>
      </div>
    );
  }

  if (!workspace.manager) return null;
  return (
    <section
      className="space-y-4 rounded-xl border p-4"
      aria-label="Chuyển kho vật lý liên quan phiếu"
    >
      <h2 className="text-lg font-semibold">
        {reversing
          ? "Chuyển trả vật lý về đúng nguồn gốc"
          : "Chuyển kho vật lý để chuẩn bị"}
      </h2>
      <p className="text-sm text-muted-foreground">
        Chỉ ghi nhận sau khi hàng đã thực sự di chuyển. Chuyển kho không phải
        giữ tồn, giao nhận hay giải phóng cam kết. Hàng theo số lượng được máy
        chủ chọn FEFO; không chọn lô thủ công.
      </p>
      <button
        type="button"
        className="button button-secondary"
        disabled={busy}
        onClick={() => void refresh()}
      >
        Tải phiên bản mới, giữ nội dung
      </button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {pending && (
        <div className="space-y-2 rounded-lg border p-3">
          <p>
            Thao tác chưa được xác nhận thành công. Thử lại dùng nguyên dữ liệu
            và mã chống trùng; không chuyển hàng thêm lần nữa.
          </p>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy || disabled}
            onClick={() => void submit(pending)}
          >
            Thử lại cùng thao tác
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => {
              setPending(null);
              setConfirmed(false);
              setMessage(
                "Đã bỏ lần thử cũ. Tải phiên bản mới và rà soát lịch sử chuyển kho trước khi xác nhận thao tác mới.",
              );
            }}
          >
            Bỏ lần thử để rà soát lại
          </button>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          transfer();
        }}
        className="space-y-4"
      >
        <fieldset
          disabled={!writable || Boolean(pending)}
          className="space-y-4"
        >
          {reversing ? (
            <div className="space-y-2">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void load("debts", 1)}
              >
                Tải nghĩa vụ hoàn trả còn lại
              </button>
              <label className="block space-y-1">
                <span>Chuyển gốc cần hoàn trả</span>
                <select
                  className="input w-full"
                  required
                  value={debtId}
                  onChange={(event) => {
                    setDebtId(event.target.value);
                    setConfirmed(false);
                    setQuantity("");
                  }}
                >
                  <option value="">Chọn chuyển gốc</option>
                  {debts.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.item_name}
                      {row.asset_code ? ` · ${row.asset_code}` : ""} ·{" "}
                      {row.source_name} → {row.destination_name} · còn{" "}
                      {row.outstanding_quantity} {row.base_uom_code} · #
                      {row.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              {pagination("debts", debts.length)}
              {debt && (
                <p className="text-sm">
                  Đúng nguồn: {debt.source_name} → {debt.destination_name}. Còn
                  phải trả: {debt.outstanding_quantity} {debt.base_uom_code}.{" "}
                  {debt.asset_id
                    ? `Tình trạng hiện tại: ${debt.operational_status}; ${debt.asset_location_id === debt.source_location_id ? "đang ở nguồn hoàn trả" : "đã đổi vị trí — không thể xác nhận"}. Không đổi tình trạng tài sản.`
                    : `Tồn vật lý tại nguồn: tốt ${debt.good_quantity}; hỏng ${debt.damaged_quantity}. Máy chủ kiểm tra lại tồn và cam kết khi ghi nhận.`}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void load("sources", 1)}
              >
                Tải thiết bị và nguồn được ánh xạ
              </button>
              <label className="block space-y-1">
                <span>Thiết bị và vị trí nguồn</span>
                <select
                  className="input w-full"
                  required
                  value={sourceKey}
                  onChange={(event) => {
                    setSourceKey(event.target.value);
                    setAssets([]);
                    setAssetId("");
                    setConfirmed(false);
                  }}
                >
                  <option value="">Chọn thiết bị / nguồn</option>
                  {sources.map((row) => (
                    <option
                      key={`${row.inventory_item_id}:${row.location_id}`}
                      value={`${row.inventory_item_id}:${row.location_id}`}
                    >
                      {row.item_code} · {row.item_name} · {row.location_name}
                      {row.available_quantity !== null
                        ? ` · khả dụng ${row.available_quantity} ${row.base_uom_code}`
                        : " · theo tài sản"}
                    </option>
                  ))}
                </select>
              </label>
              {pagination("sources", sources.length)}
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void load("locations", 1)}
              >
                Tải vị trí đích
              </button>
              <label className="block space-y-1">
                <span>Vị trí đích</span>
                <select
                  className="input w-full"
                  required
                  value={destinationId}
                  onChange={(event) => {
                    setDestinationId(event.target.value);
                    setConfirmed(false);
                  }}
                >
                  <option value="">Chọn vị trí đích</option>
                  {locations
                    .filter((row) => row.id !== source?.location_id)
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                </select>
              </label>
              {pagination("locations", locations.length)}
              {serialized && (
                <div className="space-y-2">
                  <label className="block space-y-1">
                    <span>
                      Mã tài sản chính xác (nhập/quét để lọc, hoặc để trống)
                    </span>
                    <input
                      className="input w-full"
                      value={assetCode}
                      onChange={(event) => setAssetCode(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void load("assets", 1)}
                  >
                    Tìm tài sản tại nguồn
                  </button>
                  <label className="block space-y-1">
                    <span>Tài sản thực tế đã chuyển</span>
                    <select
                      className="input w-full"
                      required
                      value={assetId}
                      onChange={(event) => {
                        setAssetId(event.target.value);
                        setConfirmed(false);
                      }}
                    >
                      <option value="">Chọn đúng tài sản</option>
                      {assets.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.asset_code} ·{" "}
                          {row.manufacturer_serial ?? "Không có số sê-ri"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {pagination("assets", assets.length)}
                </div>
              )}
            </div>
          )}
          {!serialized && (
            <label className="block space-y-1">
              <span>
                Số lượng thực tế đã chuyển (
                {reversing ? debt?.base_uom_code : source?.base_uom_code})
              </span>
              <input
                className="input w-full"
                required
                inputMode="decimal"
                pattern="[0-9]+([.][0-9]+)?"
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
          )}
          {reversing && !serialized && (
            <label className="block space-y-1">
              <span>Tình trạng vật lý đang có tại nguồn hoàn trả</span>
              <select
                className="input w-full"
                value={condition}
                onChange={(event) => {
                  setCondition(event.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="good">Tốt</option>
                <option value="damaged">
                  Hỏng (đã được ghi nhận ở tồn vật lý)
                </option>
              </select>
            </label>
          )}
          <label className="block space-y-1">
            <span>Lý do / bằng chứng chuyển thực tế</span>
            <textarea
              className="input w-full"
              required
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setConfirmed(false);
              }}
            />
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              Tôi xác nhận đúng hàng / tài sản và số lượng đã thực sự chuyển
              giữa hai vị trí nêu trên. Đây không phải thao tác thay đổi tồn
              trên giấy.
            </span>
          </label>
          <button
            type="submit"
            className="button button-primary"
            disabled={
              !confirmed ||
              (reversing
                ? !debt ||
                  (serialized &&
                    debt.asset_location_id !== debt.source_location_id)
                : !source || !destinationId || (serialized && !asset))
            }
          >
            Ghi nhận {reversing ? "hoàn trả" : "chuyển kho"} vật lý
          </button>
        </fieldset>
      </form>
    </section>
  );
}
