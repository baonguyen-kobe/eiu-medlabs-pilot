"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  PackageCheck,
  Search,
  Trash2,
  X,
} from "@/components/icons";
import { changeStockConditionAction } from "@/app/inventory/actions";
import { readInventoryOptions } from "@/app/inventory/read-actions";
import { BUSINESS_TIME_ZONE, businessTodayString } from "@/lib/business-time";
import {
  compareExact,
  formatDisplayQuantity,
  isPositive,
  subtractExact,
  validateDecimalString,
} from "@/lib/inventory/decimal";
import { InventoryLookup } from "@/components/inventory/inventory-lookup";
import {
  ConditionBadge,
  HoldStatusBadge,
} from "@/components/inventory/status-badge";
import { PaginationControls } from "@/components/pagination-controls";
import type {
  ChangeStockConditionPayload,
  InventoryOperationStock,
  InventoryStorageLocation,
} from "@/lib/inventory/types";

const STOCK_PAGE_SIZE = 20;

interface ConditionLineState {
  id: string;
  originId: string;
  currentFactVersion: number | string;
  stockRevision: number | string;
  catalogItemId: string;
  itemCode: string;
  itemName: string;
  currentGoodQuantity: string;
  quantity: string;
  baseUomCode: string;
  isHeld: boolean;
  holdReason: string | null;
}

export function ConditionChangeForm({
  preselectedLocationId = "",
  preselectedOriginId = "",
}: {
  preselectedLocationId?: string;
  preselectedOriginId?: string;
}) {
  const [locationId, setLocationId] = useState(preselectedLocationId);
  const [reason, setReason] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => {
    const now = new Date();
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: BUSINESS_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now);
    return `${businessTodayString(now)}T${time}`;
  });

  // Stock picker state with search & pagination
  const [availableStock, setAvailableStock] = useState<
    InventoryOperationStock[]
  >([]);
  const [totalStock, setTotalStock] = useState(0);
  const [stockPage, setStockPage] = useState(1);
  const [stockSearch, setStockSearch] = useState("");
  const [isLoadingStock, setIsLoadingStock] = useState(false);

  const [lines, setLines] = useState<ConditionLineState[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    ok: boolean;
    message: string;
    transactionId?: string;
  } | null>(null);

  const [isPending, startTransition] = useTransition();

  // Retry key preservation across unchanged network attempts
  const retryKeyRef = useRef<string | null>(null);
  const lastPayloadRef = useRef<string | null>(null);

  // Out-of-order fetch guard
  // Guard to auto-select preselected origin only once
  const hasAutoAddedPreselectedRef = useRef(false);

  const fetchIdRef = useRef(0);

  const fetchGoodStock = useCallback(
    async (locId: string, page: number, q: string) => {
      if (!locId) {
        setAvailableStock([]);
        setTotalStock(0);
        return;
      }

      const currentFetchId = ++fetchIdRef.current;

      try {
        const res = await readInventoryOptions<InventoryOperationStock>(
          "operation_stock",
          {
            location_id: locId,
            condition: "good",
            include_held: true,
            q: q.trim() || undefined,
            page,
            page_size: STOCK_PAGE_SIZE,
          },
        );

        if (currentFetchId !== fetchIdRef.current) return;

        setAvailableStock(res.rows);
        setTotalStock(res.total);

        if (preselectedOriginId && !hasAutoAddedPreselectedRef.current) {
          const match = res.rows.find(
            (s) => s.origin_id === preselectedOriginId,
          );
          if (match) {
            hasAutoAddedPreselectedRef.current = true;
            setLines([
              {
                id: crypto.randomUUID(),
                originId: match.origin_id,
                currentFactVersion: match.current_version,
                stockRevision: match.stock_revision,
                catalogItemId: match.catalog_item_id,
                itemCode: match.item_code,
                itemName: match.item_name,
                currentGoodQuantity: match.quantity,
                quantity: match.quantity,
                baseUomCode: match.base_uom_code,
                isHeld: match.is_held,
                holdReason: match.hold_reason,
              },
            ]);
          }
        }
      } catch (err: unknown) {
        if (currentFetchId !== fetchIdRef.current) return;
        setValidationError(
          `Không tải được tồn kho: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (currentFetchId === fetchIdRef.current) {
          setIsLoadingStock(false);
        }
      }
    },
    [preselectedOriginId],
  );

  // Event-driven location change handler
  function handleLocationChange(newLocId: string) {
    hasAutoAddedPreselectedRef.current = true;
    setLocationId(newLocId);
    setLines([]); // Clear lines immediately
    setStockPage(1);
    setStockSearch("");
    setIsLoadingStock(true);
    fetchGoodStock(newLocId, 1, "");
  }

  function handleStockPageChange(newPage: number) {
    setStockPage(newPage);
    setIsLoadingStock(true);
    fetchGoodStock(locationId, newPage, stockSearch);
  }

  function handleStockSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStockPage(1);
    setIsLoadingStock(true);
    fetchGoodStock(locationId, 1, stockSearch);
  }

  useEffect(() => {
    let isMounted = true;
    if (!preselectedLocationId) return;

    (async () => {
      try {
        const res = await readInventoryOptions<InventoryOperationStock>(
          "operation_stock",
          {
            location_id: preselectedLocationId,
            condition: "good",
            include_held: true,
            page: 1,
            page_size: STOCK_PAGE_SIZE,
          },
        );
        if (!isMounted) return;
        setAvailableStock(res.rows);
        setTotalStock(res.total);
        if (preselectedOriginId && !hasAutoAddedPreselectedRef.current) {
          const match = res.rows.find(
            (s) => s.origin_id === preselectedOriginId,
          );
          if (match) {
            hasAutoAddedPreselectedRef.current = true;
            setLines([
              {
                id: crypto.randomUUID(),
                originId: match.origin_id,
                currentFactVersion: match.current_version,
                stockRevision: match.stock_revision,
                catalogItemId: match.catalog_item_id,
                itemCode: match.item_code,
                itemName: match.item_name,
                currentGoodQuantity: match.quantity,
                quantity: match.quantity,
                baseUomCode: match.base_uom_code,
                isHeld: match.is_held,
                holdReason: match.hold_reason,
              },
            ]);
          }
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        setValidationError(
          `Không tải được tồn kho: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [preselectedLocationId, preselectedOriginId]);

  function handleAddLine(stock: InventoryOperationStock) {
    const existing = lines.find((l) => l.originId === stock.origin_id);
    if (existing) {
      setValidationError("Lô vật tư này đã có trong danh sách hạ phẩm cấp");
      return;
    }

    setValidationError(null);
    setLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        originId: stock.origin_id,
        currentFactVersion: stock.current_version,
        stockRevision: stock.stock_revision,
        catalogItemId: stock.catalog_item_id,
        itemCode: stock.item_code,
        itemName: stock.item_name,
        currentGoodQuantity: stock.quantity,
        quantity: stock.quantity,
        baseUomCode: stock.base_uom_code,
        isHeld: stock.is_held,
        holdReason: stock.hold_reason,
      },
    ]);
  }

  function handleRemoveLine(index: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== index));
  }

  function handleUpdateLineQuantity(index: number, qty: string) {
    setLines((prev) =>
      prev.map((line, idx) =>
        idx === index ? { ...line, quantity: qty } : line,
      ),
    );
  }

  // Exact calculations per line
  const lineEvaluations = useMemo(() => {
    return lines.map((line) => {
      const val = validateDecimalString(line.quantity, 6);
      const isPos = val.valid && val.normalized && isPositive(val.normalized);
      const withinBounds =
        isPos && val.normalized
          ? compareExact(val.normalized, line.currentGoodQuantity) <= 0
          : false;

      let remainingGood = "0";
      if (withinBounds && val.normalized) {
        remainingGood = subtractExact(line.currentGoodQuantity, val.normalized);
      }

      let error: string | null = null;
      if (!val.valid) {
        error = val.error || "Số lượng không hợp lệ";
      } else if (!isPos) {
        error = "Số lượng báo hỏng phải lớn hơn 0";
      } else if (!withinBounds) {
        error = `Vượt quá tồn tốt hiện tại (${formatDisplayQuantity(line.currentGoodQuantity)} ${line.baseUomCode})`;
      }

      return {
        line,
        val,
        remainingGood,
        isValid: Boolean(isPos && withinBounds),
        error,
      };
    });
  }, [lines]);

  const canSubmit =
    Boolean(locationId) &&
    Boolean(reason.trim()) &&
    lines.length > 0 &&
    lineEvaluations.every((e) => e.isValid);

  function handleOpenReview() {
    setValidationError(null);
    if (!locationId) {
      setValidationError("Vui lòng chọn vị trí kho thực hiện.");
      return;
    }
    if (!reason.trim()) {
      setValidationError("Vui lòng nhập lý do hạ phẩm cấp (báo hỏng vật tư).");
      return;
    }
    if (lines.length === 0) {
      setValidationError("Vui lòng chọn ít nhất một lô vật tư để báo hỏng.");
      return;
    }
    if (!lineEvaluations.every((e) => e.isValid)) {
      setValidationError("Vui lòng kiểm tra lại số lượng các dòng báo hỏng.");
      return;
    }
    setConfirmOpen(true);
  }

  async function handleFinalSubmit() {
    if (!canSubmit) return;
    setConfirmOpen(false);

    const payload: ChangeStockConditionPayload = {
      location_id: locationId,
      reason: reason.trim(),
      occurred_at: new Date(`${occurredAt}+07:00`).toISOString(),
      lines: lines.map((l) => ({
        origin_id: l.originId,
        expected_version: l.currentFactVersion,
        expected_stock_revision: l.stockRevision,
        from_condition: "good",
        to_condition: "damaged",
        quantity: l.quantity.trim(),
      })),
    };

    const serialized = JSON.stringify(payload);
    let retryKey = retryKeyRef.current;
    if (lastPayloadRef.current !== serialized || !retryKey) {
      retryKey = crypto.randomUUID();
      lastPayloadRef.current = serialized;
      retryKeyRef.current = retryKey;
    }

    startTransition(async () => {
      const res = await changeStockConditionAction(payload, retryKey).catch(
        (err: unknown) => ({
          ok: false as const,
          error: `Chưa nhận được kết quả; hãy thử lại cùng dữ liệu. ${err instanceof Error ? err.message : ""}`,
        }),
      );

      if (res.ok && res.data) {
        lastPayloadRef.current = null;
        retryKeyRef.current = null;
        setNotice({
          ok: true,
          message: `Ghi nhận hạ phẩm cấp thành công! Tổng tồn vật lý tại kho được bảo toàn tuyệt đối.`,
          transactionId: res.data.transaction_id,
        });
        setLines([]);
        setReason("");
        fetchGoodStock(locationId, stockPage, stockSearch);
      } else {
        setNotice({
          ok: false,
          message: res.error || "Giao dịch hạ phẩm cấp thất bại",
        });
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Notice alert */}
      {notice ? (
        <div
          role="status"
          className={`p-4 rounded-xl border flex items-start gap-3 ${
            notice.ok
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-rose-50 border-rose-200 text-rose-900"
          }`}
        >
          {notice.ok ? (
            <Check className="text-emerald-600 mt-0.5 shrink-0" size={20} />
          ) : (
            <AlertTriangle
              className="text-rose-600 mt-0.5 shrink-0"
              size={20}
            />
          )}
          <div className="space-y-1">
            <p className="font-semibold text-sm">{notice.message}</p>
            {notice.transactionId ? (
              <p className="text-xs">
                <Link
                  href={`/inventory/transactions/${notice.transactionId}`}
                  className="font-medium underline hover:text-emerald-800"
                >
                  Xem chi tiết giao dịch hạ phẩm cấp #{notice.transactionId} →
                </Link>
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="ml-auto text-slate-400 hover:text-slate-600"
          >
            <X size={16} />
          </button>
        </div>
      ) : null}

      {validationError ? (
        <div
          role="alert"
          className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-center justify-between"
        >
          <span>{validationError}</span>
          <button
            type="button"
            onClick={() => setValidationError(null)}
            className="text-rose-500 hover:text-rose-700"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {/* Scope banner explaining Good -> Damaged only */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs space-y-1">
        <div className="font-bold flex items-center gap-1.5 text-amber-950">
          <AlertTriangle size={16} className="text-amber-600 shrink-0" />
          <span>
            Quy tắc nghiệp vụ: Chỉ cho phép Hạ phẩm cấp (Tốt → Hỏng) /
            Deterioration Only
          </span>
        </div>
        <p className="text-slate-700 leading-relaxed">
          Nghiệp vụ này chuyển đổi số lượng vật tư thực tế từ{" "}
          <strong>Hàng tốt (Good)</strong> sang{" "}
          <strong>Hàng hỏng (Damaged)</strong> do sự cố, bể vỡ, hoặc giảm chất
          lượng vật lý tại kho. Theo hợp đồng S2 và quy định V1.1,{" "}
          <em>
            nghiệp vụ phục hồi/sửa chữa (Hỏng → Tốt) bị loại trừ hoàn toàn
          </em>
          . Tổng số lượng tồn vật lý tại vị trí kho được bảo toàn tuyệt đối.
        </p>
      </div>

      {/* Header form card */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <span>
            Thông tin Ghi nhận Hạ phẩm cấp / Condition Deterioration Details
          </span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 min-w-0">
          {/* Location lookup */}
          <div className="min-w-0">
            <InventoryLookup<InventoryStorageLocation>
              resource="locations"
              filters={{ active: true }}
              value={locationId}
              label="Vị trí kho thực hiện *"
              id="condition-location"
              placeholder="Chọn kho lưu trữ..."
              onSelect={(loc) => handleLocationChange(loc.id)}
            />
          </div>

          {/* Occurred at */}
          <div className="min-w-0">
            <label
              htmlFor="condition-occurred-at"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Thời điểm ghi nhận *
            </label>
            <input
              id="condition-occurred-at"
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 bg-white"
            />
          </div>

          {/* Reason */}
          <div className="min-w-0">
            <label
              htmlFor="condition-reason"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Lý do báo hỏng / hạ phẩm cấp *
            </label>
            <input
              id="condition-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="VD: Bể vỡ chai thủy tinh trong lúc bảo quản, rò rỉ bao bì..."
              className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 bg-white"
            />
          </div>
        </div>
      </div>

      {/* Stock picker for good condition stock with search & pagination */}
      {locationId ? (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Chọn lô hàng tốt tại kho / Available Good Stock ({totalStock}{" "}
                lô)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Chỉ hiển thị các lô vật tư đang ở trạng thái Tốt (Good) tại kho
                đã chọn
              </p>
            </div>

            {/* Search form */}
            <form
              onSubmit={handleStockSearchSubmit}
              className="flex items-center gap-2"
            >
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2.5 top-2.5 text-slate-400"
                />
                <input
                  type="text"
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  placeholder="Tìm theo SKU, tên vật tư..."
                  className="text-xs pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 w-56"
                />
              </div>
              <button
                type="submit"
                className="button button-secondary text-xs py-1.5 px-3"
              >
                Tìm
              </button>
            </form>
          </div>

          {isLoadingStock ? (
            <div className="text-center py-8 text-xs text-amber-600 font-medium animate-pulse">
              Đang tải danh sách hàng tốt...
            </div>
          ) : availableStock.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              Kho này hiện không có lô vật tư tình trạng Tốt nào phù hợp với bộ
              lọc.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto border border-slate-100 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[11px]">
                      <th className="py-2 px-3">Mã SKU {"&"} Tên vật tư</th>
                      <th className="py-2 px-3">Tình trạng</th>
                      <th className="py-2 px-3">Trạng thái giữ (Hold)</th>
                      <th className="py-2 px-3 text-right">Tồn tốt hiện có</th>
                      <th className="py-2 px-3">Hạn dùng</th>
                      <th className="py-2 px-3 text-center">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {availableStock.map((item) => {
                      const isSelected = lines.some(
                        (l) => l.originId === item.origin_id,
                      );
                      return (
                        <tr
                          key={item.origin_id}
                          className={`hover:bg-slate-50/80 transition-colors ${
                            isSelected ? "bg-amber-50/50" : ""
                          }`}
                        >
                          <td className="py-2.5 px-3">
                            <span className="font-mono font-semibold text-slate-900 mr-2">
                              {item.item_code}
                            </span>
                            <span className="text-slate-800">
                              {item.item_name}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <ConditionBadge condition={item.condition} />
                          </td>
                          <td className="py-2.5 px-3">
                            <HoldStatusBadge
                              isHeld={item.is_held}
                              holdReason={item.hold_reason}
                            />
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                            {formatDisplayQuantity(item.quantity)}{" "}
                            {item.base_uom_code}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">
                            {item.expiry_date || "—"}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button
                              type="button"
                              disabled={isSelected}
                              onClick={() => handleAddLine(item)}
                              className={`button text-xs py-1 px-2.5 ${
                                isSelected
                                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                  : "button-secondary"
                              }`}
                            >
                              {isSelected ? "Đã chọn" : "+ Thêm vào phiếu"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Bounded pagination controls */}
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-500">
                  Hiển thị trang {stockPage} trên tổng số {totalStock} lô
                </span>
                <PaginationControls
                  currentPage={stockPage}
                  totalItems={totalStock}
                  pageSize={STOCK_PAGE_SIZE}
                  onPageChange={handleStockPageChange}
                />
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* Lines to change condition */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Danh sách vật tư báo hỏng / Items to Mark Damaged ({lines.length})
            </h3>
            <p className="text-xs text-slate-500">
              Nhập số lượng hàng tốt chuyển sang hàng hỏng (Bảo toàn tổng tồn
              kho vật lý)
            </p>
          </div>
        </div>

        {lines.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl">
            <PackageCheck className="mx-auto text-slate-300 mb-2" size={28} />
            <p className="text-xs text-slate-500">
              Chưa có lô vật tư nào được chọn. Hãy chọn kho và thêm lô từ bảng
              trên.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[11px]">
                  <th className="py-2.5 px-3">Lô {"&"} Vật tư</th>
                  <th className="py-2.5 px-3 text-right">Tồn tốt ban đầu</th>
                  <th className="py-2.5 px-3 text-right w-44">SL Báo hỏng *</th>
                  <th className="py-2.5 px-3 text-right">
                    Tồn tốt còn lại (Dự kiến)
                  </th>
                  <th className="py-2.5 px-3 text-center w-16">Xóa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lineEvaluations.map(
                  ({ line, remainingGood, isValid, error }, idx) => (
                    <tr
                      key={line.originId}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900">
                          {line.itemCode} - {line.itemName}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          Lô: {line.originId.slice(0, 8)}... | Phiên bản kho: r
                          {line.stockRevision}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-emerald-700">
                        {formatDisplayQuantity(line.currentGoodQuantity)}{" "}
                        {line.baseUomCode}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <input
                            type="text"
                            value={line.quantity}
                            onChange={(e) =>
                              handleUpdateLineQuantity(idx, e.target.value)
                            }
                            className={`w-28 text-right font-mono text-xs py-1.5 px-2 border rounded-lg focus:ring-2 ${
                              !isValid
                                ? "border-rose-400 bg-rose-50/50 focus:ring-rose-500"
                                : "border-slate-300 focus:ring-amber-500"
                            }`}
                          />
                          <span className="text-slate-500 font-medium">
                            {line.baseUomCode}
                          </span>
                        </div>
                        {error ? (
                          <p className="text-[11px] text-rose-600 mt-1 text-right">
                            {error}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-slate-700">
                        {isValid ? (
                          `${formatDisplayQuantity(remainingGood)} ${line.baseUomCode}`
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(idx)}
                          className="text-slate-400 hover:text-rose-600 p-1 rounded"
                          title="Xóa dòng"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Tổng cộng: <strong>{lines.length}</strong> dòng báo hỏng
          </span>
          <button
            type="button"
            disabled={!canSubmit || isPending}
            onClick={handleOpenReview}
            className={`button button-primary bg-amber-600 hover:bg-amber-700 text-white py-2 px-5 text-xs font-semibold ${
              !canSubmit || isPending ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            {isPending ? "Đang xử lý..." : "Xác nhận Hạ phẩm cấp (Báo hỏng) →"}
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="text-amber-600" size={18} />
              <span>Xác nhận giao dịch hạ phẩm cấp (Báo hỏng)</span>
            </h3>

            <p className="text-xs text-slate-600 leading-relaxed">
              Bạn có chắc chắn muốn chuyển <strong>{lines.length}</strong> dòng
              vật tư này từ <strong>Hàng tốt</strong> sang{" "}
              <strong>Hàng hỏng</strong> không? Thao tác này sẽ ghi sổ bất biến
              và giảm lượng tồn đủ điều kiện cấp phát (Eligible).
            </p>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Vị trí kho:</span>
                <span className="font-semibold text-slate-800">
                  {locationId}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Lý do:</span>
                <span className="font-semibold text-slate-800">{reason}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Số dòng báo hỏng:</span>
                <span className="font-semibold text-slate-800">
                  {lines.length}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="button button-secondary text-xs"
              >
                Hủy bỏ / Cancel
              </button>
              <button
                type="button"
                onClick={handleFinalSubmit}
                className="button bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold py-2 px-4 rounded-lg"
              >
                Ghi sổ báo hỏng / Confirm Deterioration
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
