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
  CircleAlert,
  ClipboardList,
  History,
  X,
} from "@/components/icons";
import { reconcileStocktakeAction } from "@/app/inventory/actions";
import { readInventoryOptions } from "@/app/inventory/read-actions";
import { BUSINESS_TIME_ZONE, businessTodayString } from "@/lib/business-time";
import {
  compareExact,
  isNonNegative,
  isPositive,
  subtractExact,
  validateDecimalString,
} from "@/lib/inventory/decimal";
import { normalizeExpiryInput } from "@/lib/inventory/dates";
import { InventoryLookup } from "@/components/inventory/inventory-lookup";
import {
  StocktakeCountTable,
  type CountRowData,
  type CountObservation,
} from "./stocktake-count-table";
import {
  StocktakeSurplusSection,
  type SurplusLineItem,
} from "./stocktake-surplus-section";
import type {
  InventoryOperationStock,
  InventoryStorageLocation,
  ReconcileStocktakeLineInput,
  ReconcileStocktakePayload,
  StockCondition,
} from "@/lib/inventory/types";

const STOCK_PAGE_SIZE = 20;

export function StocktakeReconcileForm({
  preselectedLocationId = "",
}: {
  preselectedLocationId?: string;
}) {
  const [locationId, setLocationId] = useState(preselectedLocationId);

  // Stable business reference (independent of retry UUID)
  const [stocktakeReference, setStocktakeReference] = useState(() => {
    const today = businessTodayString(new Date()).replace(/-/g, "");
    return `STK-${today}-${Math.floor(1000 + Math.random() * 9000)}`;
  });

  const [reason, setReason] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [scopeDescription, setScopeDescription] = useState("");
  const [countTimestamp, setCountTimestamp] = useState(() => {
    const now = new Date();
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: BUSINESS_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now);
    return `${businessTodayString(now)}T${time}`;
  });

  // Current page cohorts and total count
  const [currentPageStock, setCurrentPageStock] = useState<CountRowData[]>([]);
  const [totalStockCount, setTotalStockCount] = useState(0);
  const [stockPage, setStockPage] = useState(1);
  const [stockSearch, setStockSearch] = useState("");
  const [isLoadingStock, setIsLoadingStock] = useState(false);

  // All known counts mapped by `${originId}:${condition}` to preserve entries across pagination and search
  const [countedMap, setCountedMap] = useState<
    Record<string, CountObservation>
  >({});

  // Unprovenanced surplus lines
  const [surplusLines, setSurplusLines] = useState<SurplusLineItem[]>([]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [staleErrorDetected, setStaleErrorDetected] = useState(false);
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
  const fetchIdRef = useRef(0);

  const fetchLocationStock = useCallback(
    async (locId: string, page: number, q: string) => {
      if (!locId) {
        setCurrentPageStock([]);
        setTotalStockCount(0);
        return;
      }

      const currentFetchId = ++fetchIdRef.current;
      setStaleErrorDetected(false);

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

        if (currentFetchId !== fetchIdRef.current) return;

        const rows: CountRowData[] = res.rows.map((row) => ({
          originId: row.origin_id,
          currentFactVersion: row.current_version,
          stockRevision: row.stock_revision,
          catalogItemId: row.catalog_item_id,
          itemCode: row.item_code,
          itemName: row.item_name,
          condition: row.condition,
          expectedQuantity: row.quantity,
          baseUomCode: row.base_uom_code,
          isHeld: row.is_held,
          holdReason: row.hold_reason,
        }));

        setCurrentPageStock(rows);
        setTotalStockCount(res.total);

        // Merge into countedMap without overriding existing user edits
        setCountedMap((prev) => {
          const next = { ...prev };
          for (const row of rows) {
            const key = `${row.originId}:${row.condition}`;
            if (!next[key]) {
              next[key] = {
                row,
                snapshotFactVersion: row.currentFactVersion,
                snapshotStockRevision: row.stockRevision,
                snapshotExpectedQuantity: row.expectedQuantity,
                countedQuantity: row.expectedQuantity,
                includedInCount: true,
                isStale: false,
              };
            } else {
              const stale =
                row.stockRevision !== next[key].snapshotStockRevision ||
                row.expectedQuantity !== next[key].snapshotExpectedQuantity;
              next[key] = {
                ...next[key],
                row,
                isStale: stale || Boolean(next[key].isStale),
              };
            }
          }
          return next;
        });
      } catch (err: unknown) {
        if (currentFetchId !== fetchIdRef.current) return;
        setValidationError(
          `Không thể tải dữ liệu tồn kho: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (currentFetchId === fetchIdRef.current) {
          setIsLoadingStock(false);
        }
      }
    },
    [],
  );

  function handleLocationChange(newLocId: string) {
    setLocationId(newLocId);
    setCountedMap({});
    setSurplusLines([]);
    setStockPage(1);
    setStockSearch("");
    setIsLoadingStock(true);
    fetchLocationStock(newLocId, 1, "");
  }

  function handleStockPageChange(newPage: number) {
    setStockPage(newPage);
    setIsLoadingStock(true);
    fetchLocationStock(locationId, newPage, stockSearch);
  }

  function handleStockSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStockPage(1);
    setIsLoadingStock(true);
    fetchLocationStock(locationId, 1, stockSearch);
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
            include_held: true,
            page: 1,
            page_size: STOCK_PAGE_SIZE,
          },
        );
        if (!isMounted) return;
        const rows: CountRowData[] = res.rows.map((row) => ({
          originId: row.origin_id,
          currentFactVersion: row.current_version,
          stockRevision: row.stock_revision,
          catalogItemId: row.catalog_item_id,
          itemCode: row.item_code,
          itemName: row.item_name,
          condition: row.condition,
          expectedQuantity: row.quantity,
          baseUomCode: row.base_uom_code,
          isHeld: row.is_held,
          holdReason: row.hold_reason,
        }));
        setCurrentPageStock(rows);
        setTotalStockCount(res.total);
        setCountedMap((prev) => {
          const next = { ...prev };
          for (const row of rows) {
            const key = `${row.originId}:${row.condition}`;
            if (!next[key]) {
              next[key] = {
                row,
                snapshotFactVersion: row.currentFactVersion,
                snapshotStockRevision: row.stockRevision,
                snapshotExpectedQuantity: row.expectedQuantity,
                countedQuantity: row.expectedQuantity,
                includedInCount: true,
                isStale: false,
              };
            }
          }
          return next;
        });
      } catch (err: unknown) {
        if (!isMounted) return;
        setValidationError(
          `Không thể tải dữ liệu tồn kho: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [preselectedLocationId]);

  function handleUpdateCountedQuantity(
    originId: string,
    condition: StockCondition,
    value: string,
  ) {
    const key = `${originId}:${condition}`;
    setCountedMap((prev) => {
      const existing = prev[key];
      if (!existing) return prev;
      return {
        ...prev,
        [key]: {
          ...existing,
          countedQuantity: value,
        },
      };
    });
  }

  function handleToggleInclude(originId: string, condition: StockCondition) {
    const key = `${originId}:${condition}`;
    setCountedMap((prev) => {
      const existing = prev[key];
      if (!existing) return prev;
      return {
        ...prev,
        [key]: {
          ...existing,
          includedInCount: !existing.includedInCount,
        },
      };
    });
  }
  function handleRecount(originId: string, condition: StockCondition) {
    const key = `${originId}:${condition}`;
    setCountedMap((prev) => {
      const existing = prev[key];
      if (!existing) return prev;
      return {
        ...prev,
        [key]: {
          ...existing,
          snapshotFactVersion: existing.row.currentFactVersion,
          snapshotStockRevision: existing.row.stockRevision,
          snapshotExpectedQuantity: existing.row.expectedQuantity,
          countedQuantity: "", // Cleared to require explicit re-entry of actual physical count
          isStale: false,
        },
      };
    });
  }

  function handleAddSurplusLine() {
    setSurplusLines((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        catalogItemId: "",
        itemCode: "",
        itemName: "",
        baseUomCode: "",
        condition: "good",
        countedQuantity: "1.000000",
        expiryPrecision: "not_required",
        expiryInput: "",
        evidenceNote: "",
      },
    ]);
  }

  function handleRemoveSurplusLine(id: string) {
    setSurplusLines((prev) => prev.filter((l) => l.id !== id));
  }

  function handleUpdateSurplusLine(
    id: string,
    updates: Partial<SurplusLineItem>,
  ) {
    setSurplusLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, ...updates } : line)),
    );
  }

  const evaluatedCountLines = useMemo(() => {
    const items = Object.values(countedMap).filter(
      (item) => item.includedInCount,
    );
    return items.map((item) => {
      const val = validateDecimalString(item.countedQuantity, 6);
      const isNonNeg =
        val.valid && val.normalized && isNonNegative(val.normalized);

      let delta = "0";
      let isChanged = false;
      let deltaType: "match" | "surplus" | "shortage" = "match";

      if (isNonNeg && val.normalized) {
        delta = subtractExact(val.normalized, item.snapshotExpectedQuantity);
        if (compareExact(val.normalized, item.snapshotExpectedQuantity) > 0) {
          deltaType = "surplus";
          isChanged = true;
        } else if (
          compareExact(val.normalized, item.snapshotExpectedQuantity) < 0
        ) {
          deltaType = "shortage";
          isChanged = true;
        }
      }

      let error: string | null = null;
      if (item.isStale) {
        error =
          "Số dư kho đã đổi; vui lòng bấm 'Đếm lại' để đối chiếu số dư mới trước khi ghi sổ.";
      } else if (!val.valid) {
        error = val.error || "Số lượng không hợp lệ";
      } else if (!isNonNeg) {
        error = "Số lượng kiểm kê không được âm";
      }

      return {
        row: item.row,
        snapshotFactVersion: item.snapshotFactVersion,
        snapshotStockRevision: item.snapshotStockRevision,
        snapshotExpectedQuantity: item.snapshotExpectedQuantity,
        countedQuantity: item.countedQuantity,
        val,
        delta,
        deltaType,
        isChanged,
        isStale: Boolean(item.isStale),
        isValid: Boolean(isNonNeg && !item.isStale),
        error,
      };
    });
  }, [countedMap]);

  const evaluatedSurplusLines = useMemo(() => {
    return surplusLines.map((line) => {
      const val = validateDecimalString(line.countedQuantity, 6);
      const isPos = val.valid && val.normalized && isPositive(val.normalized);
      const hasItem = Boolean(line.catalogItemId);

      let expiryValid = true;
      let expiryError: string | null = null;
      if (
        line.expiryPrecision !== "not_required" &&
        line.expiryPrecision !== "unknown"
      ) {
        const norm = normalizeExpiryInput(
          line.expiryPrecision,
          line.expiryInput,
        );
        if (!norm.valid) {
          expiryValid = false;
          expiryError = norm.error || "Hạn dùng không hợp lệ";
        }
      }

      let error: string | null = null;
      if (!hasItem) {
        error = "Chưa chọn vật tư danh mục";
      } else if (!val.valid) {
        error = val.error || "Số lượng không hợp lệ";
      } else if (!isPos) {
        error = "Số lượng hàng thừa phải lớn hơn 0";
      } else if (!expiryValid) {
        error = expiryError;
      }

      return {
        line,
        val,
        hasItem,
        isValid: Boolean(hasItem && isPos && expiryValid),
        error,
      };
    });
  }, [surplusLines]);

  const activeCountCount = evaluatedCountLines.length;
  const changedCountCount = evaluatedCountLines.filter(
    (c) => c.isChanged,
  ).length;
  const zeroDeltaCount = evaluatedCountLines.filter((c) => !c.isChanged).length;
  const surplusCount = evaluatedSurplusLines.length;
  const totalOperations = activeCountCount + surplusCount;

  const allCountValid = evaluatedCountLines.every((c) => c.isValid);
  const allSurplusValid = evaluatedSurplusLines.every((s) => s.isValid);

  const canSubmit =
    Boolean(stocktakeReference.trim()) &&
    Boolean(locationId) &&
    Boolean(reason.trim()) &&
    Boolean(evidenceNote.trim()) &&
    totalOperations > 0 &&
    allCountValid &&
    allSurplusValid;

  function handleOpenReview() {
    setValidationError(null);
    if (!stocktakeReference.trim()) {
      setValidationError("Vui lòng nhập mã đợt kiểm kê (Stocktake Reference).");
      return;
    }
    if (!locationId) {
      setValidationError("Vui lòng chọn vị trí kho kiểm kê.");
      return;
    }
    if (!reason.trim()) {
      setValidationError("Vui lòng nhập lý do kiểm kê.");
      return;
    }
    if (!evidenceNote.trim()) {
      setValidationError(
        "Vui lòng nhập ghi chú bằng chứng kiểm kê (Số biên bản/quyết định đối soát).",
      );
      return;
    }
    if (totalOperations === 0) {
      setValidationError("Chưa có dòng kiểm kê hoặc hàng thừa nào được chọn.");
      return;
    }
    if (!allCountValid || !allSurplusValid) {
      setValidationError(
        "Vui lòng sửa các lỗi số lượng trên danh sách kiểm kê.",
      );
      return;
    }
    setConfirmOpen(true);
  }

  async function handleFinalSubmit() {
    if (!canSubmit) return;
    setConfirmOpen(false);

    const linesPayload: ReconcileStocktakeLineInput[] = [
      ...evaluatedCountLines.map((c) => ({
        type: "count" as const,
        origin_id: c.row.originId,
        expected_version: c.snapshotFactVersion,
        expected_stock_revision: c.snapshotStockRevision,
        condition: c.row.condition,
        expected_quantity: c.snapshotExpectedQuantity,
        counted_quantity: c.countedQuantity.trim(),
      })),
      ...evaluatedSurplusLines.map((s) => ({
        type: "surplus" as const,
        catalog_item_id: s.line.catalogItemId,
        condition: s.line.condition,
        counted_quantity: s.line.countedQuantity.trim(),
        expiry_precision: s.line.expiryPrecision,
        expiry_input: s.line.expiryInput.trim() || undefined,
        evidence_note: s.line.evidenceNote.trim() || undefined,
      })),
    ];

    const payload: ReconcileStocktakePayload = {
      stocktake_reference: stocktakeReference.trim().toUpperCase(),
      location_id: locationId,
      count_timestamp: new Date(`${countTimestamp}+07:00`).toISOString(),
      scope_description: scopeDescription.trim() || undefined,
      reason: reason.trim(),
      evidence_note: evidenceNote.trim(),
      lines: linesPayload,
    };

    const serialized = JSON.stringify(payload);
    let retryKey = retryKeyRef.current;
    if (lastPayloadRef.current !== serialized || !retryKey) {
      retryKey = crypto.randomUUID();
      lastPayloadRef.current = serialized;
      retryKeyRef.current = retryKey;
    }

    startTransition(async () => {
      const res = await reconcileStocktakeAction(payload, retryKey).catch(
        (err: unknown) => ({
          ok: false as const,
          error: `Chưa nhận được kết quả máy chủ; hãy thử lại cùng dữ liệu. ${err instanceof Error ? err.message : ""}`,
        }),
      );

      if (res.ok && res.data) {
        lastPayloadRef.current = null;
        retryKeyRef.current = null;
        setNotice({
          ok: true,
          message: `Ghi sổ kiểm kê [${payload.stocktake_reference}] thành công! Đã ghi nhận ${activeCountCount} dòng đối chiếu (${zeroDeltaCount} khớp số liệu, ${changedCountCount} có chênh lệch) và ${surplusCount} dòng hàng thừa TẠM GIỮ.`,
          transactionId: res.data.transaction_id,
        });
        setSurplusLines([]);
        fetchLocationStock(locationId, stockPage, stockSearch);
      } else {
        const errMsg = res.error || "Giao dịch kiểm kê thất bại";
        if (
          errMsg.includes("STALE_REVISION") ||
          errMsg.includes("mismatch") ||
          errMsg.includes("đã thay đổi")
        ) {
          setStaleErrorDetected(true);
        }
        setNotice({
          ok: false,
          message: errMsg,
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
                  Xem chi tiết giao dịch kiểm kê #{notice.transactionId} &rarr;
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

      {/* Stale warning banner */}
      {staleErrorDetected ? (
        <div
          role="alert"
          className="p-4 bg-amber-50 border-2 border-amber-300 text-amber-900 rounded-xl space-y-2 shadow-xs"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <AlertTriangle className="text-amber-600" size={18} />
            <span>
              PHÁT HIỆN SỐ LIỆU ĐÃ BỊ THAY ĐỔI TRONG KHI KIỂM ĐẾM (Stale Count /
              ABA Detected)
            </span>
          </div>
          <p className="text-xs leading-relaxed text-slate-700">
            Số dư hệ thống hoặc phiên bản chuyển động kho (stock revision) tại
            kho này đã phát sinh giao dịch mới trong thời gian bạn nhập liệu.
            Vui lòng bấm nút bên dưới để tải lại dữ liệu số dư hiện thời và đối
            chiếu lại trước khi thực hiện ghi sổ.
          </p>
          <button
            type="button"
            onClick={() =>
              fetchLocationStock(locationId, stockPage, stockSearch)
            }
            className="button button-primary bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold py-1.5 px-3 flex items-center gap-1.5"
          >
            <History size={14} />
            <span>Tải lại số dư hiện tại &amp; Đối chiếu lại</span>
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

      {/* Educational notice card */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl text-blue-950 text-xs space-y-1.5">
        <div className="font-bold flex items-center gap-1.5">
          <CircleAlert size={16} className="text-blue-600 shrink-0" />
          <span>
            Quy tắc nghiệp vụ: Phân biệt Điều chỉnh Kiểm kê (S2) vs Sửa chứng từ
            gốc (S1)
          </span>
        </div>
        <p className="text-slate-700 leading-relaxed">
          • <strong>Điều chỉnh kiểm kê (S2 - reconcile_stocktake):</strong> Ghi
          nhận sai lệch thực tế tại vị trí kho hiện tại mà{" "}
          <em>KHÔNG sửa đổi chứng từ nhập ban đầu</em>. Máy chủ tự động tính
          toán chênh lệch (Delta = Thực tế - Sổ sách) và ghi nhận giao dịch kiểm
          kê bất biến. Cả các dòng kiểm đếm khớp số liệu (Delta = 0) cũng được
          lưu trữ thành bằng chứng kiểm kê định kỳ.
          <br />•{" "}
          <strong>Hàng thừa không chứng từ gốc (Owner Surplus B):</strong> Được
          cấp mã nguồn gốc <code>STOCKTAKE_SURPLUS</code>, vào tồn kho thực tế
          (on-hand) ngay lập tức nhưng <strong>BỊ TẠM GIỮ (HOLD)</strong> cho
          đến khi Quản trị viên (Admin) thẩm định {"&"} giải tỏa.
        </p>
      </div>

      {/* Header controls card */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <ClipboardList className="text-purple-600" size={18} />
          <span>
            Thông tin Phiên Kiểm kê Thực tế / Physical Stocktake Session
          </span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 pt-2 min-w-0">
          {/* Stocktake Reference */}
          <div className="min-w-0">
            <label
              htmlFor="stocktake-ref"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Mã đợt kiểm kê (Reference) *
            </label>
            <input
              id="stocktake-ref"
              type="text"
              value={stocktakeReference}
              onChange={(e) => setStocktakeReference(e.target.value)}
              placeholder="VD: STK-20261003-001..."
              className="w-full text-xs font-mono py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white uppercase font-bold"
              required
            />
          </div>

          {/* Location lookup */}
          <div className="min-w-0">
            <InventoryLookup<InventoryStorageLocation>
              resource="locations"
              filters={{ active: true }}
              value={locationId}
              label="Vị trí kho kiểm kê *"
              id="stocktake-location"
              placeholder="Chọn kho kiểm kê..."
              onSelect={(loc) => handleLocationChange(loc.id)}
            />
          </div>

          {/* Count Timestamp */}
          <div className="min-w-0">
            <label
              htmlFor="stocktake-timestamp"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Thời điểm kiểm đếm *
            </label>
            <input
              id="stocktake-timestamp"
              type="datetime-local"
              value={countTimestamp}
              onChange={(e) => setCountTimestamp(e.target.value)}
              className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
            />
          </div>

          {/* Reason */}
          <div>
            <label
              htmlFor="stocktake-reason"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Lý do kiểm kê *
            </label>
            <input
              id="stocktake-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="VD: Kiểm kê định kỳ quý 4, kiểm kê bất xuất..."
              className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
            />
          </div>

          {/* Evidence note */}
          <div>
            <label
              htmlFor="stocktake-evidence"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Chứng từ / Biên bản kiểm kê *
            </label>
            <input
              id="stocktake-evidence"
              type="text"
              value={evidenceNote}
              onChange={(e) => setEvidenceNote(e.target.value)}
              placeholder="VD: Biên bản kiểm kê số 09/BB-KK/2026..."
              className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
            />
          </div>
        </div>

        {/* Scope description */}
        <div>
          <label
            htmlFor="stocktake-scope"
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            Phạm vi kiểm kê / Ghi chú bổ sung
          </label>
          <input
            id="stocktake-scope"
            type="text"
            value={scopeDescription}
            onChange={(e) => setScopeDescription(e.target.value)}
            placeholder="VD: Toàn bộ tủ hóa chất A1-A3, các kệ lưu mẫu phòng thí nghiệm..."
            className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
          />
        </div>
      </div>

      {/* Section A: Count existing cohorts at location with search & pagination */}
      {locationId ? (
        <StocktakeCountTable
          currentPageStock={currentPageStock}
          countedMap={countedMap}
          totalStockCount={totalStockCount}
          stockPage={stockPage}
          stockSearch={stockSearch}
          isLoadingStock={isLoadingStock}
          onSearchChange={setStockSearch}
          onSearchSubmit={handleStockSearchSubmit}
          onPageChange={handleStockPageChange}
          onUpdateCountedQuantity={handleUpdateCountedQuantity}
          onToggleInclude={handleToggleInclude}
          onRecount={handleRecount}
        />
      ) : null}

      {/* Section B: Unprovenanced Surplus Lines (STOCKTAKE_SURPLUS) */}
      <StocktakeSurplusSection
        surplusLines={surplusLines}
        evaluatedSurplusLines={evaluatedSurplusLines}
        onAddSurplusLine={handleAddSurplusLine}
        onRemoveSurplusLine={handleRemoveSurplusLine}
        onUpdateSurplusLine={handleUpdateSurplusLine}
      />

      {/* Final submit summary bar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
        <span className="text-xs text-slate-600">
          Tổng cộng đã chọn ghi sổ: <strong>{activeCountCount}</strong> dòng
          kiểm đếm ({zeroDeltaCount} khớp số liệu, {changedCountCount} có chênh
          lệch), <strong>{surplusCount}</strong> dòng hàng thừa mới
        </span>
        <button
          type="button"
          disabled={!canSubmit || isPending}
          onClick={handleOpenReview}
          className={`button button-primary bg-purple-600 hover:bg-purple-700 text-white py-2 px-5 text-xs font-semibold ${
            !canSubmit || isPending ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          {isPending ? "Đang ghi sổ..." : "Xác nhận & Ghi sổ Kiểm kê →"}
        </button>
      </div>

      {/* Confirmation Modal */}
      {confirmOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ClipboardList className="text-purple-600" size={18} />
              <span>Xác nhận ghi sổ kiểm kê [{stocktakeReference}]</span>
            </h3>

            <p className="text-xs text-slate-600 leading-relaxed">
              Bạn có chắc chắn muốn ghi sổ phiên kiểm kê này không? Hệ thống sẽ
              ghi nhận biến động chênh lệch thực tế vào Sổ cái và tạo các lô
              hàng thừa ở trạng thái <strong>TẠM GIỮ (HOLD)</strong>.
            </p>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Mã đợt kiểm kê:</span>
                <span className="font-mono font-bold text-purple-700">
                  {stocktakeReference}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Kho kiểm kê:</span>
                <span className="font-semibold text-slate-800">
                  {locationId}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Chứng từ kiểm kê:</span>
                <span className="font-semibold text-slate-800">
                  {evidenceNote}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">
                  Số dòng kiểm đếm ghi nhận:
                </span>
                <span className="font-semibold text-slate-800">
                  {activeCountCount} dòng ({zeroDeltaCount} khớp,{" "}
                  {changedCountCount} có chênh lệch)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">
                  Số dòng hàng thừa (SURPLUS):
                </span>
                <span className="font-semibold text-purple-700 font-bold">
                  {surplusCount} dòng
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
                className="button bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold py-2 px-4 rounded-lg"
              >
                Ghi sổ kiểm kê / Confirm Stocktake
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
