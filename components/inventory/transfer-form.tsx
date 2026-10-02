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
  ArrowRight,
  Check,
  PackageCheck,
  Search,
  Trash2,
  X,
} from "@/components/icons";
import { transferStockAction } from "@/app/inventory/actions";
import { readInventoryOptions } from "@/app/inventory/read-actions";
import { BUSINESS_TIME_ZONE, businessTodayString } from "@/lib/business-time";
import {
  compareExact,
  formatDisplayQuantity,
  isPositive,
  validateDecimalString,
} from "@/lib/inventory/decimal";
import { InventoryLookup } from "@/components/inventory/inventory-lookup";
import {
  ConditionBadge,
  HoldStatusBadge,
} from "@/components/inventory/status-badge";
import { PaginationControls } from "@/components/pagination-controls";
import type {
  InventoryOperationStock,
  InventoryStorageLocation,
  StockCondition,
  TransferStockPayload,
} from "@/lib/inventory/types";

const STOCK_PAGE_SIZE = 20;

interface TransferLineState {
  id: string;
  originId: string;
  currentFactVersion: number | string;
  stockRevision: number | string;
  catalogItemId: string;
  itemCode: string;
  itemName: string;
  condition: StockCondition;
  maxQuantity: string;
  quantity: string;
  baseUomCode: string;
  isHeld: boolean;
  holdReason: string | null;
}

export function TransferForm({
  preselectedSourceId = "",
  preselectedTargetId = "",
  preselectedOriginId = "",
}: {
  preselectedSourceId?: string;
  preselectedTargetId?: string;
  preselectedOriginId?: string;
}) {
  const [sourceLocationId, setSourceLocationId] = useState(preselectedSourceId);
  const [targetLocationId, setTargetLocationId] = useState(preselectedTargetId);
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

  const [lines, setLines] = useState<TransferLineState[]>([]);
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

  const fetchStock = useCallback(
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
            include_held: true,
            q: q.trim() || undefined,
            page,
            page_size: STOCK_PAGE_SIZE,
          },
        );

        // Guard against out-of-order responses
        if (currentFetchId !== fetchIdRef.current) return;

        setAvailableStock(res.rows);
        setTotalStock(res.total);

        // Auto-select origin on first load if preselected
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
                condition: match.condition,
                maxQuantity: match.quantity,
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
          `Không tải được tồn kho nguồn: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (currentFetchId === fetchIdRef.current) {
          setIsLoadingStock(false);
        }
      }
    },
    [preselectedOriginId],
  );

  // Event-driven handler for source location change
  function handleSourceLocationChange(newLocId: string) {
    hasAutoAddedPreselectedRef.current = true;
    setSourceLocationId(newLocId);
    // Clear lines immediately on source change to prevent retaining stale stock from previous location
    setLines([]);
    setStockPage(1);
    setStockSearch("");
    if (newLocId === targetLocationId) {
      setTargetLocationId("");
    }
    setIsLoadingStock(true);
    fetchStock(newLocId, 1, "");
  }

  // Handle stock pagination change
  function handleStockPageChange(newPage: number) {
    setStockPage(newPage);
    setIsLoadingStock(true);
    fetchStock(sourceLocationId, newPage, stockSearch);
  }

  // Handle stock search
  function handleStockSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStockPage(1);
    setIsLoadingStock(true);
    fetchStock(sourceLocationId, 1, stockSearch);
  }

  // Initial load if source location preselected
  useEffect(() => {
    let isMounted = true;
    if (!preselectedSourceId) return;

    (async () => {
      try {
        const res = await readInventoryOptions<InventoryOperationStock>(
          "operation_stock",
          {
            location_id: preselectedSourceId,
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
                condition: match.condition,
                maxQuantity: match.quantity,
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
          `Không tải được tồn kho nguồn: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [preselectedSourceId, preselectedOriginId]);

  function handleAddLine(stock: InventoryOperationStock) {
    const existing = lines.find(
      (l) => l.originId === stock.origin_id && l.condition === stock.condition,
    );
    if (existing) {
      setValidationError(
        "Lô vật tư này đã có trong danh sách điều chuyển / Line already added",
      );
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
        condition: stock.condition,
        maxQuantity: stock.quantity,
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

  // Line validations
  const lineEvaluations = useMemo(() => {
    return lines.map((line) => {
      const val = validateDecimalString(line.quantity, 6);
      const isPos = val.valid && val.normalized && isPositive(val.normalized);
      const withinBounds =
        isPos && val.normalized
          ? compareExact(val.normalized, line.maxQuantity) <= 0
          : false;

      let error: string | null = null;
      if (!val.valid) {
        error = val.error || "Số lượng không hợp lệ";
      } else if (!isPos) {
        error = "Số lượng chuyển phải lớn hơn 0";
      } else if (!withinBounds) {
        error = `Vượt quá tồn khả dụng tại kho nguồn (${formatDisplayQuantity(line.maxQuantity)} ${line.baseUomCode})`;
      }

      return {
        line,
        val,
        isValid: Boolean(isPos && withinBounds),
        error,
      };
    });
  }, [lines]);

  const canSubmit =
    Boolean(sourceLocationId) &&
    Boolean(targetLocationId) &&
    sourceLocationId !== targetLocationId &&
    lines.length > 0 &&
    lineEvaluations.every((e) => e.isValid);

  function handleOpenReview() {
    setValidationError(null);
    if (!sourceLocationId) {
      setValidationError("Vui lòng chọn vị trí kho xuất (Kho nguồn).");
      return;
    }
    if (!targetLocationId) {
      setValidationError("Vui lòng chọn vị trí kho nhận (Kho đích).");
      return;
    }
    if (sourceLocationId === targetLocationId) {
      setValidationError("Kho nguồn và kho đích phải khác nhau.");
      return;
    }
    if (lines.length === 0) {
      setValidationError("Vui lòng chọn ít nhất một lô vật tư để điều chuyển.");
      return;
    }
    if (!lineEvaluations.every((e) => e.isValid)) {
      setValidationError(
        "Vui lòng kiểm tra lại số lượng các dòng điều chuyển.",
      );
      return;
    }
    setConfirmOpen(true);
  }

  async function handleFinalSubmit() {
    if (!canSubmit) return;
    setConfirmOpen(false);

    const payload: TransferStockPayload = {
      source_location_id: sourceLocationId,
      target_location_id: targetLocationId,
      reason: reason.trim() || undefined,
      occurred_at: new Date(`${occurredAt}+07:00`).toISOString(),
      lines: lines.map((l) => ({
        origin_id: l.originId,
        expected_version: l.currentFactVersion,
        expected_stock_revision: l.stockRevision,
        condition: l.condition,
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
      const res = await transferStockAction(payload, retryKey).catch(
        (err: unknown) => ({
          ok: false as const,
          error: `Chưa nhận được kết quả từ máy chủ; hãy thử lại cùng dữ liệu. ${err instanceof Error ? err.message : ""}`,
        }),
      );

      if (res.ok && res.data) {
        lastPayloadRef.current = null;
        retryKeyRef.current = null;
        setNotice({
          ok: true,
          message: `Điều chuyển kho thành công! Giao dịch đã được ghi nhận bất biến vào Sổ cái.`,
          transactionId: res.data.transaction_id,
        });
        setLines([]);
        setReason("");
        // Reload current page of stock
        fetchStock(sourceLocationId, stockPage, stockSearch);
      } else {
        setNotice({
          ok: false,
          message: res.error || "Giao dịch điều chuyển thất bại",
        });
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Alert banner */}
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
                  Xem chi tiết giao dịch điều chuyển #{notice.transactionId} →
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

      {/* Header controls card */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <ArrowRight className="text-sky-600" size={18} />
          <span>Thông tin Điều chuyển kho / Stock Transfer Details</span>
        </h2>
        <p className="text-xs text-slate-500">
          Điều chuyển vật tư thực tế giữa hai kho lưu trữ. Hệ thống bảo toàn
          tính toàn vẹn của lô, trạng thái tạm giữ (Hold) và tình trạng
          tốt/hỏng.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 min-w-0">
          {/* Source location lookup */}
          <div className="min-w-0">
            <InventoryLookup<InventoryStorageLocation>
              resource="locations"
              filters={{ active: true }}
              value={sourceLocationId}
              label="Kho xuất (Nguồn) *"
              id="transfer-source-location"
              placeholder="Chọn kho nguồn..."
              onSelect={(loc) => handleSourceLocationChange(loc.id)}
            />
          </div>

          {/* Target location lookup */}
          <div className="min-w-0">
            <InventoryLookup<InventoryStorageLocation>
              resource="locations"
              filters={{ active: true }}
              value={targetLocationId}
              label="Kho nhập (Đích) *"
              id="transfer-target-location"
              placeholder="Chọn kho đích..."
              onSelect={(loc) => setTargetLocationId(loc.id)}
            />
            {sourceLocationId &&
            targetLocationId &&
            sourceLocationId === targetLocationId ? (
              <span className="text-[11px] text-rose-600">
                Kho đích phải khác kho nguồn!
              </span>
            ) : null}
          </div>

          {/* Occurred at */}
          <div className="min-w-0">
            <label
              htmlFor="transfer-occurred-at"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Thời điểm điều chuyển *
            </label>
            <input
              id="transfer-occurred-at"
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 bg-white"
            />
          </div>

          {/* Reason */}
          <div className="min-w-0">
            <label
              htmlFor="transfer-reason"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Lý do điều chuyển
            </label>
            <input
              id="transfer-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="VD: Điều chuyển cấp phát thực hành, chuyển kho bảo quản..."
              className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 bg-white"
            />
          </div>
        </div>
      </div>

      {/* Stock picker from source location with search & pagination */}
      {sourceLocationId ? (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Chọn vật tư từ kho nguồn / Available Stock in Source (
                {totalStock} lô)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Tìm kiếm và chọn lô vật tư cần điều chuyển (hỗ trợ phân trang
                không giới hạn)
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
                  className="text-xs pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 w-56"
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
            <div className="text-center py-8 text-xs text-sky-600 font-medium animate-pulse">
              Đang tải danh sách lô tồn kho...
            </div>
          ) : availableStock.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              Kho nguồn hiện không có lô vật tư nào phù hợp với bộ lọc.
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
                      <th className="py-2 px-3 text-right">Tổng tồn</th>
                      <th className="py-2 px-3 text-right">Khả dụng</th>
                      <th className="py-2 px-3">Hạn dùng</th>
                      <th className="py-2 px-3 text-center">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {availableStock.map((item) => {
                      const isSelected = lines.some(
                        (l) =>
                          l.originId === item.origin_id &&
                          l.condition === item.condition,
                      );
                      return (
                        <tr
                          key={`${item.origin_id}-${item.condition}`}
                          className={`hover:bg-slate-50/80 transition-colors ${
                            isSelected ? "bg-sky-50/50" : ""
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
                          <td className="py-2.5 px-3 text-right font-mono text-emerald-700 font-semibold">
                            {formatDisplayQuantity(item.available_quantity)}{" "}
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

      {/* Selected transfer lines */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Danh sách vật tư điều chuyển / Lines to Transfer ({lines.length})
            </h3>
            <p className="text-xs text-slate-500">
              Nhập số lượng cần chuyển cho từng lô đã chọn
            </p>
          </div>
        </div>

        {lines.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-xl">
            <PackageCheck className="mx-auto text-slate-300 mb-2" size={28} />
            <p className="text-xs text-slate-500">
              Chưa có dòng vật tư nào được chọn. Hãy chọn kho nguồn và thêm vật
              tư ở bảng trên.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[11px]">
                  <th className="py-2.5 px-3">Vật tư {"&"} Tình trạng</th>
                  <th className="py-2.5 px-3">Cảnh báo trạng thái</th>
                  <th className="py-2.5 px-3 text-right">Tồn tại nguồn</th>
                  <th className="py-2.5 px-3 text-right w-48">
                    Số lượng chuyển *
                  </th>
                  <th className="py-2.5 px-3 text-center w-16">Xóa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lineEvaluations.map(({ line, isValid, error }, idx) => (
                  <tr
                    key={`${line.originId}-${line.condition}`}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">
                        {line.itemCode} - {line.itemName}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <ConditionBadge condition={line.condition} />
                        <span className="text-[11px] text-slate-400 font-mono">
                          Lô: {line.originId.slice(0, 8)}...
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {line.isHeld ? (
                        <div className="space-y-1">
                          <HoldStatusBadge
                            isHeld={true}
                            holdReason={line.holdReason}
                          />
                          <p className="text-[11px] text-amber-700 font-medium">
                            Lưu ý: Số lượng này sẽ tiếp tục bị TẠM GIỮ tại kho
                            đích.
                          </p>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-xs">
                          Bình thường
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-slate-800">
                      {formatDisplayQuantity(line.maxQuantity)}{" "}
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
                              : "border-slate-300 focus:ring-sky-500"
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
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Tổng cộng: <strong>{lines.length}</strong> dòng điều chuyển
          </span>
          <button
            type="button"
            disabled={!canSubmit || isPending}
            onClick={handleOpenReview}
            className={`button button-primary py-2 px-5 text-xs font-semibold ${
              !canSubmit || isPending ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            {isPending ? "Đang xử lý..." : "Xác nhận Điều chuyển kho →"}
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ArrowRight className="text-sky-600" size={18} />
              <span>Xác nhận giao dịch điều chuyển kho</span>
            </h3>

            <p className="text-xs text-slate-600 leading-relaxed">
              Bạn có chắc chắn muốn thực hiện giao dịch chuyển kho cho{" "}
              <strong>{lines.length}</strong> dòng vật tư này không? Giao dịch
              sẽ ghi sổ bất biến vào Sổ cái kho và cập nhật số dư tức thời.
            </p>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Kho nguồn:</span>
                <span className="font-semibold text-slate-800">
                  {sourceLocationId}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Kho đích:</span>
                <span className="font-semibold text-slate-800">
                  {targetLocationId}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Số dòng:</span>
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
                className="button button-primary text-xs"
              >
                Ghi sổ điều chuyển / Confirm Transfer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
