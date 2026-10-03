"use client";

import { useState } from "react";
import { readPreparation } from "@/app/equipment/preparation/actions";
import { readInventoryOptions } from "@/app/inventory/read-actions";
import { multiplyExact } from "@/lib/inventory/decimal";
import type { Json } from "@/lib/database.types";
import type {
  PreparationAllocation,
  PreparationAsset,
  PreparationDemand,
  PreparationOperation,
  PreparationSource,
} from "@/lib/equipment-preparation";
import {
  preparationSourcesSchema,
  preparationAssetsSchema,
  preparationInventoryOptionsSchema,
} from "@/lib/equipment-preparation";

type Command = (
  operation: PreparationOperation,
  payload: Record<string, Json>,
) => Promise<boolean>;

export function PreparationAllocations({
  requestId,
  demand,
  planned,
  allocations,
  disabled,
  onChange,
  command,
}: {
  requestId: string;
  demand: PreparationDemand;
  planned: string;
  allocations: PreparationAllocation[];
  disabled: boolean;
  onChange: (allocations: PreparationAllocation[]) => void;
  command: Command;
}) {
  const [sources, setSources] = useState<PreparationSource[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<
    Array<{ id: string; code: string; name: string; base_uom_code: string }>
  >([]);
  const [query, setQuery] = useState("");
  const [itemPage, setItemPage] = useState(1);
  const [itemTotal, setItemTotal] = useState(0);

  async function loadSources(nextPage = 1) {
    setBusy(true);
    setError("");
    try {
      const result = await readPreparation(requestId, "stock", {
        catalog_item_id: demand.catalog_item_id,
        page: nextPage,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const parsed = preparationSourcesSchema.parse(result.data);
      setSources(parsed.rows);
      setPage(nextPage);
    } catch {
      setError(
        "Không tải được nguồn. Dữ liệu allocations đang nhập được giữ nguyên.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function searchItems(nextPage = 1) {
    setBusy(true);
    setError("");
    try {
      const result = await readInventoryOptions<{
        id: string;
        code: string;
        name: string;
        base_uom_code: string;
      }>("items", { q: query, active: true, page: nextPage, page_size: 25 });
      const parsed = preparationInventoryOptionsSchema.parse(result);
      setItems(parsed.rows);
      setItemPage(nextPage);
      setItemTotal(parsed.total);
    } catch {
      setError("Không tải được danh mục Inventory.");
    } finally {
      setBusy(false);
    }
  }
  function add(source: PreparationSource) {
    const quantity = multiplyExact(planned, source.conversion_factor);
    onChange([
      ...allocations,
      {
        mapping_id: source.mapping_id,
        location_id: source.location_id,
        base_quantity: allocations.length ? "" : (quantity.result ?? ""),
        asset_ids: [],
      },
    ]);
  }
  return (
    <div className="space-y-3">
      {allocations.map((allocation, index) => (
        <AllocationRow
          key={`${allocation.mapping_id}:${allocation.location_id}:${index}`}
          requestId={requestId}
          allocation={allocation}
          source={sources.find(
            (source) =>
              source.mapping_id === allocation.mapping_id &&
              source.location_id === allocation.location_id,
          )}
          disabled={disabled}
          onChange={(value) =>
            onChange(
              allocations.map((row, position) =>
                position === index ? value : row,
              ),
            )
          }
          onRemove={() =>
            onChange(allocations.filter((_, position) => position !== index))
          }
        />
      ))}
      {!disabled ? (
        <>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => void loadSources()}
          >
            Chọn nguồn / Thêm allocation
          </button>
          {sources.length ? (
            <div className="space-y-2">
              {sources.map((source) => (
                <div
                  key={`${source.mapping_id}:${source.location_id}`}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    {source.item_code} · {source.item_name} ·{" "}
                    {source.location_name} ·{" "}
                    {source.tracking_strategy === "serialized"
                      ? "Chọn đúng tài sản"
                      : `Available-for-new: ${source.available_quantity} ${source.base_uom_code}`}{" "}
                    · 1 {demand.unit} = {source.conversion_factor}{" "}
                    {source.base_uom_code}
                  </span>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => add(source)}
                  >
                    Dùng nguồn
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || page === 1}
              onClick={() => void loadSources(page - 1)}
            >
              Nguồn trước
            </button>
            <span>Trang nguồn {page}</span>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || sources.length < 100}
              onClick={() => void loadSources(page + 1)}
            >
              Nguồn tiếp
            </button>
          </div>
          <details>
            <summary>Mapping Inventory đã xác minh</summary>
            <p>
              Chọn tường minh SKU tương thích và hệ số đơn vị; không suy từ tên
              thiết bị.
            </p>
            <label>
              Tìm SKU Inventory
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void searchItems()}
            >
              Tìm SKU
            </button>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const ok = await command("map_item", {
                  catalog_item_id: demand.catalog_item_id,
                  inventory_item_id: String(data.get("item")),
                  base_units_per_requested_unit: String(data.get("factor")),
                  reason: String(data.get("reason")),
                });
                if (ok) await loadSources();
              }}
            >
              <label>
                SKU đã xác minh
                <select name="item" required defaultValue="">
                  <option value="" disabled>
                    Chọn Inventory item
                  </option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} · {item.name} · {item.base_uom_code}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy || itemPage === 1}
                  onClick={() => void searchItems(itemPage - 1)}
                >
                  SKU trước
                </button>
                <span>
                  {itemPage} / {Math.max(1, Math.ceil(itemTotal / 25))}
                </span>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy || itemPage * 25 >= itemTotal}
                  onClick={() => void searchItems(itemPage + 1)}
                >
                  SKU tiếp
                </button>
              </div>
              <label>
                Số base unit trong 1 {demand.unit}
                <input
                  name="factor"
                  required
                  inputMode="decimal"
                  pattern="[0-9]+(\.[0-9]{1,6})?"
                  defaultValue="1"
                />
              </label>
              <label>
                Căn cứ tương thích và quy đổi
                <input name="reason" required />
              </label>
              <button type="submit" className="button" disabled={busy}>
                Lưu mapping
              </button>
            </form>
          </details>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

function AllocationRow({
  requestId,
  allocation,
  source,
  disabled,
  onChange,
  onRemove,
}: {
  requestId: string;
  allocation: PreparationAllocation;
  source?: PreparationSource;
  disabled: boolean;
  onChange: (allocation: PreparationAllocation) => void;
  onRemove: () => void;
}) {
  const [assets, setAssets] = useState<PreparationAsset[]>([]);
  const [assetCode, setAssetCode] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function loadAssets(nextPage: number, scan = false) {
    if (!source) {
      setError("Tải nguồn để đối chiếu mapping trước khi chọn tài sản.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await readPreparation(requestId, "assets", {
        inventory_item_id: source.inventory_item_id,
        location_id: allocation.location_id,
        page: nextPage,
        asset_code: scan ? assetCode.trim().toUpperCase() : "",
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const data = preparationAssetsSchema.parse(result.data);
      if (scan) {
        const asset = data.rows[0];
        if (!asset || !asset.eligible || !asset.unreserved) {
          setError(
            "Mã QR không tương thích, không đủ điều kiện hoặc đã được giữ ở phiếu khác.",
          );
          return;
        }
        if (!allocation.asset_ids.includes(asset.id))
          onChange({
            ...allocation,
            asset_ids: [...allocation.asset_ids, asset.id],
          });
      }
      setAssets(data.rows);
      setTotal(data.total);
      setPage(nextPage);
    } catch {
      setError("Không tải được tài sản. Lựa chọn hiện tại vẫn được giữ.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="rounded-xl border p-3 space-y-2" disabled={disabled}>
      <legend>
        {source
          ? `${source.item_name} · ${source.location_name}`
          : "Allocation đã lưu — tải nguồn để đối chiếu"}
      </legend>
      <label>
        SL base unit {source?.base_uom_code}
        <input
          inputMode="decimal"
          value={allocation.base_quantity}
          onChange={(event) =>
            onChange({ ...allocation, base_quantity: event.target.value })
          }
        />
      </label>
      <p>Đã chọn {allocation.asset_ids.length} tài sản chính xác.</p>
      <button
        type="button"
        className="button button-secondary"
        onClick={onRemove}
      >
        Bỏ allocation
      </button>
      {source?.tracking_strategy === "serialized" ? (
        <>
          <label>
            Quét hoặc nhập mã EIU-AST
            <input
              value={assetCode}
              onChange={(event) => setAssetCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void loadAssets(1, true);
                }
              }}
            />
          </label>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => void loadAssets(1, true)}
          >
            Kiểm tra và chọn QR
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => void loadAssets(1)}
          >
            Danh sách tài sản
          </button>
          {assets.map((asset) => (
            <label key={asset.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allocation.asset_ids.includes(asset.id)}
                disabled={!asset.eligible || !asset.unreserved}
                onChange={(event) =>
                  onChange({
                    ...allocation,
                    asset_ids: event.target.checked
                      ? [...allocation.asset_ids, asset.id]
                      : allocation.asset_ids.filter((id) => id !== asset.id),
                  })
                }
              />
              {asset.asset_code} ·{" "}
              {asset.manufacturer_serial ?? "Không serial NSX"} ·{" "}
              {asset.eligible && asset.unreserved
                ? "Có thể chọn"
                : "Không khả dụng"}
            </label>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || page === 1}
              onClick={() => void loadAssets(page - 1)}
            >
              Tài sản trước
            </button>
            <span>
              {page} / {Math.max(1, Math.ceil(total / 100))}
            </span>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy || page * 100 >= total}
              onClick={() => void loadAssets(page + 1)}
            >
              Tài sản tiếp
            </button>
          </div>
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </fieldset>
  );
}
