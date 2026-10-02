"use client";

import React, {
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
  Plus,
  Trash2,
  X,
} from "@/components/icons";
import { receiveStockAction } from "@/app/inventory/actions";
import { readInventoryOptions } from "@/app/inventory/read-actions";
import { BUSINESS_TIME_ZONE, businessTodayString } from "@/lib/business-time";
import {
  formatDisplayQuantity,
  multiplyExact,
  validateSplit,
} from "@/lib/inventory/decimal";
import { normalizeExpiryInput } from "@/lib/inventory/dates";
import { InventoryLookup } from "@/components/inventory/inventory-lookup";
import type {
  AcquisitionRecord,
  AcquisitionRecordLine,
  ExpiryPrecision,
  InventoryCatalogItem,
  InventoryStorageLocation,
  InventoryUom,
  ReceiveStockLineInput,
} from "@/lib/inventory/types";

interface FormLineState {
  lineKey: string;
  sourceLineId: string;
  catalogItemId: string;
  locationId: string;
  purchaseQuantity: string;
  purchaseUomCode: string;
  conversionFactor: string;
  goodQuantity: string;
  damagedQuantity: string;
  expiryPrecision: ExpiryPrecision;
  expiryInput: string;
  evidenceNote: string;
}

export function ReceiveForm({
  initialSources = [],
  initialSourceLines = [],
  preselectedSourceId,
  // Optional backwards compatibility:
  sources,
  sourceLines,
  items: legacyItems = [],
  locations: legacyLocations = [],
  uoms: legacyUoms = [],
}: {
  initialSources?: AcquisitionRecord[];
  initialSourceLines?: AcquisitionRecordLine[];
  preselectedSourceId?: string;
  sources?: AcquisitionRecord[];
  sourceLines?: AcquisitionRecordLine[];
  items?: InventoryCatalogItem[];
  locations?: InventoryStorageLocation[];
  uoms?: InventoryUom[];
} = {}) {
  const activeSources = sources || initialSources;
  const activeSourceLines = sourceLines || initialSourceLines;

  const [receiptReference, setReceiptReference] = useState("");
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

  // Source selection helper for line filtering
  const [selectedSourceId, setSelectedSourceId] = useState<string>(
    preselectedSourceId || activeSources[0]?.id || "",
  );

  // Resolved metadata dictionary for items chosen through source lines
  const [resolvedItems, setResolvedItems] = useState<
    Record<string, InventoryCatalogItem>
  >(() => {
    const map: Record<string, InventoryCatalogItem> = {};
    for (const it of legacyItems) {
      map[it.id] = it;
    }
    return map;
  });

  // Resolved source lines dictionary for display
  const [resolvedSourceLines, setResolvedSourceLines] = useState<
    Record<string, AcquisitionRecordLine>
  >(() => {
    const map: Record<string, AcquisitionRecordLine> = {};
    for (const sl of activeSourceLines) {
      map[sl.id] = sl;
    }
    return map;
  });

  // Initialize with first available line if provided
  const [lines, setLines] = useState<FormLineState[]>(() => {
    const firstSl = activeSourceLines[0];
    const initialItem = firstSl
      ? legacyItems.find((i) => i.id === firstSl.catalog_item_id)
      : legacyItems[0];

    return [
      {
        lineKey: "L1",
        sourceLineId: firstSl?.id || "",
        catalogItemId: firstSl?.catalog_item_id || initialItem?.id || "",
        locationId: legacyLocations[0]?.id || "",
        purchaseQuantity: firstSl?.expected_purchase_quantity || "1",
        purchaseUomCode:
          firstSl?.purchase_uom_code ||
          initialItem?.base_uom_code ||
          legacyUoms[0]?.code ||
          "",
        conversionFactor: firstSl?.expected_conversion_factor || "1",
        goodQuantity: firstSl?.expected_purchase_quantity || "1",
        damagedQuantity: "0",
        expiryPrecision: initialItem?.expiry_required ? "day" : "not_required",
        expiryInput: "",
        evidenceNote: "",
      },
    ];
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<{
    ok: boolean;
    message: string;
    receiptId?: string;
  } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const lastPayloadRef = useRef<string | null>(null);
  const retryKeyRef = useRef<string | null>(null);

  // Focus restoration & modal ref
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Dirty form warning
  const isDirty = useMemo(() => {
    return (
      Boolean(receiptReference.trim()) ||
      lines.length > 1 ||
      lines.some((l) => Boolean(l.sourceLineId) || Boolean(l.locationId))
    );
  }, [receiptReference, lines]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Modal keyboard & focus trap
  useEffect(() => {
    if (!confirmOpen) return;
    const previousActive = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) {
        setConfirmOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const modal = modalRef.current;
      if (!modal) return;
      const focusables = Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
      previousActive?.focus();
    };
  }, [confirmOpen, isPending]);

  // Handle source line selection and resolve item metadata
  function handleSelectSourceLine(idx: number, sl: AcquisitionRecordLine) {
    setResolvedSourceLines((prev) => ({ ...prev, [sl.id]: sl }));

    const existingItem = resolvedItems[sl.catalog_item_id];
    const initialExpiry: ExpiryPrecision = existingItem?.expiry_required
      ? "day"
      : "not_required";

    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== idx) return line;
        return {
          ...line,
          sourceLineId: sl.id,
          catalogItemId: sl.catalog_item_id,
          purchaseUomCode: sl.purchase_uom_code || line.purchaseUomCode,
          conversionFactor:
            sl.expected_conversion_factor || line.conversionFactor || "1",
          expiryPrecision:
            line.expiryPrecision === "not_required"
              ? initialExpiry
              : line.expiryPrecision,
        };
      }),
    );

    // Resolve item metadata via bounded lookup if not cached
    if (!existingItem && sl.catalog_item_id) {
      readInventoryOptions<InventoryCatalogItem>("items", {
        id: sl.catalog_item_id,
        page: 1,
        page_size: 1,
      })
        .then((res) => {
          if (res.rows.length > 0) {
            const item = res.rows[0];
            setResolvedItems((prev) => ({ ...prev, [item.id]: item }));
            if (item.expiry_required) {
              setLines((prev) =>
                prev.map((line, i) =>
                  i === idx && line.expiryPrecision === "not_required"
                    ? { ...line, expiryPrecision: "day" }
                    : line,
                ),
              );
            }
          }
        })
        .catch(() => {
          // Non-blocking fallback
        });
    }
  }

  function addLine() {
    const nextLineNo = lines.length + 1;
    setLines((prev) => [
      ...prev,
      {
        lineKey: `L${nextLineNo}`,
        sourceLineId: "",
        catalogItemId: "",
        locationId: prev[prev.length - 1]?.locationId || "",
        purchaseQuantity: "1",
        purchaseUomCode: "",
        conversionFactor: "1",
        goodQuantity: "1",
        damagedQuantity: "0",
        expiryPrecision: "not_required",
        expiryInput: "",
        evidenceNote: "",
      },
    ]);
  }

  function removeLine(index: number) {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, idx) => idx !== index));
  }

  function updateLine(index: number, updates: Partial<FormLineState>) {
    setLines((prev) =>
      prev.map((line, idx) => {
        if (idx !== index) return line;
        return { ...line, ...updates };
      }),
    );
  }

  function focusFirstInvalidControl(): boolean {
    const firstInvalid = document.querySelector<HTMLElement>(
      'input:invalid, select:invalid, textarea:invalid, [aria-invalid="true"]',
    );
    if (firstInvalid) {
      firstInvalid.focus();
      return true;
    }
    return false;
  }

  // Pre-calculate line validations and base quantities
  const lineCalculations = useMemo(() => {
    return lines.map((line) => {
      const item = resolvedItems[line.catalogItemId];
      const mult = multiplyExact(
        line.purchaseQuantity,
        line.conversionFactor,
        6,
      );
      const baseQty = mult.valid && mult.result ? mult.result : "0";

      const split =
        mult.valid && mult.result
          ? validateSplit(mult.result, line.goodQuantity, line.damagedQuantity)
          : { valid: false, error: mult.error };

      let expiryCheck: { valid: boolean; error?: string } = { valid: true };
      if (item?.expiry_required && line.expiryPrecision === "not_required") {
        expiryCheck = {
          valid: false,
          error:
            "Vật tư này bắt buộc phải có Hạn sử dụng (O01) / Expiry required",
        };
      } else {
        const norm = normalizeExpiryInput(
          line.expiryPrecision,
          line.expiryInput,
        );
        if (!norm.valid) {
          expiryCheck = { valid: false, error: norm.error };
        }
      }

      const hasSourceLine = Boolean(line.sourceLineId);
      const hasLocation = Boolean(line.locationId);
      const hasUom = Boolean(line.purchaseUomCode);

      return {
        item,
        mult,
        baseQty,
        split,
        expiryCheck,
        hasSourceLine,
        hasLocation,
        hasUom,
        isValid:
          hasSourceLine &&
          hasLocation &&
          hasUom &&
          mult.valid &&
          split.valid &&
          expiryCheck.valid,
      };
    });
  }, [lines, resolvedItems]);

  const allLinesValid = lineCalculations.every((calc) => calc.isValid);
  const canSubmit =
    Boolean(receiptReference.trim()) &&
    Boolean(occurredAt) &&
    allLinesValid &&
    lines.length > 0;

  function handleOpenReview() {
    setValidationError(null);
    if (!canSubmit) {
      setValidationError(
        "Vui lòng hoàn thiện đúng các trường dữ liệu bắt buộc trên từng dòng hàng / Please fill all required fields.",
      );
      setTimeout(() => {
        focusFirstInvalidControl();
      }, 50);
      return;
    }
    setConfirmOpen(true);
  }

  async function handleFinalSubmit() {
    if (!canSubmit) return;
    setConfirmOpen(false);

    const payload: {
      receipt_reference: string;
      occurred_at: string;
      lines: ReceiveStockLineInput[];
    } = {
      receipt_reference: receiptReference.trim().toUpperCase(),
      occurred_at: new Date(`${occurredAt}+07:00`).toISOString(),
      lines: lines.map((l) => ({
        line_key: l.lineKey.trim(),
        source_line_id: l.sourceLineId,
        catalog_item_id: l.catalogItemId,
        location_id: l.locationId,
        purchase_quantity: l.purchaseQuantity,
        purchase_uom_code: l.purchaseUomCode,
        conversion_factor: l.conversionFactor,
        good_quantity: l.goodQuantity,
        damaged_quantity: l.damagedQuantity,
        expiry_precision: l.expiryPrecision,
        expiry_input: l.expiryInput.trim() || undefined,
        evidence_note: l.evidenceNote.trim() || undefined,
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
      const res = await receiveStockAction(payload, retryKey).catch(
        (error: unknown) => ({
          ok: false as const,
          error: `Chưa nhận được kết quả; hãy thử lại cùng dữ liệu / Response unavailable; retry unchanged input. ${error instanceof Error ? error.message : ""}`,
        }),
      );
      if (res.ok && res.data) {
        lastPayloadRef.current = null;
        retryKeyRef.current = null;
        setNotice({
          ok: true,
          message: `Nhận kho thành công cho phiếu ${payload.receipt_reference}! Sổ cái và tồn kho đã được ghi nhận.`,
          receiptId: res.data.id,
        });
        setReceiptReference("");
      } else {
        setNotice({
          ok: false,
          message:
            res.error || "Giao dịch nhận kho thất bại / Receive stock failed",
        });
      }
    });
  }

  return (
    <div className="space-y-6">
      {notice ? (
        <div
          role="alert"
          aria-live="polite"
          className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            notice.ok
              ? "bg-emerald-50 text-emerald-900 border-emerald-200"
              : "bg-red-50 text-red-900 border-red-200"
          }`}
        >
          <div className="flex items-center gap-2 text-xs font-semibold">
            {notice.ok ? (
              <Check className="text-emerald-600 shrink-0" size={18} />
            ) : (
              <AlertTriangle className="text-red-600 shrink-0" size={18} />
            )}
            <span>{notice.message}</span>
          </div>

          {notice.ok ? (
            <div className="flex items-center gap-2">
              <Link
                href="/inventory/stock"
                className="button button-primary text-xs"
              >
                <PackageCheck size={14} /> Kiểm tra Tồn kho &rarr;
              </Link>
              <Link
                href="/inventory/transactions"
                className="button button-secondary text-xs"
              >
                Xem sổ cái &rarr;
              </Link>
            </div>
          ) : (
            <button
              type="button"
              className="text-slate-400 hover:text-slate-600 p-1"
              onClick={() => setNotice(null)}
              aria-label="Đóng thông báo"
            >
              <X size={16} />
            </button>
          )}
        </div>
      ) : null}

      {validationError ? (
        <div
          role="alert"
          aria-live="polite"
          className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-600 shrink-0" />
            <span>{validationError}</span>
          </div>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 p-1"
            onClick={() => setValidationError(null)}
            aria-label="Đóng lỗi"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {/* Main Intake Form Container */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-6 space-y-6 dark:bg-slate-900 dark:border-slate-800">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
            Thông tin tiếp nhận thực tế / Intake Document
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Xác nhận thực nhận tại kho MedLabs. Biểu mẫu có thể chỉnh sửa trước
            khi ghi sổ; sau khi ghi sổ, chứng từ trở thành bất biến.
          </p>
        </div>

        {/* Header Fields Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200/80 dark:bg-slate-800/40 dark:border-slate-800">
          <div>
            <label
              htmlFor="receipt-reference"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Mã phiếu nhận hàng (Số hóa đơn/biên bản){" "}
              <span className="text-red-500">*</span>
            </label>
            <input
              id="receipt-reference"
              type="text"
              className="w-full text-xs font-mono uppercase border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              placeholder="VD: PNK-2026-001"
              value={receiptReference}
              onChange={(e) => setReceiptReference(e.target.value)}
              required
            />
            <span className="text-[11px] text-slate-400 block mt-1">
              Định danh duy nhất của đợt giao nhận vật lý
            </span>
          </div>

          <div>
            <label
              htmlFor="receipt-occurred-at"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Thời điểm nhận thực tế <span className="text-red-500">*</span>
            </label>
            <input
              id="receipt-occurred-at"
              type="datetime-local"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              required
            />
            <span className="text-[11px] text-slate-400 block mt-1">
              Giờ và ngày thực tế hàng đến kho (Asia/Ho_Chi_Minh)
            </span>
          </div>

          <div>
            <InventoryLookup<AcquisitionRecord>
              resource="sources"
              filters={{ active: true }}
              value={selectedSourceId}
              onSelect={(source) => setSelectedSourceId(source.id)}
              label="Lọc nhanh hồ sơ nguồn cam kết"
              id="receipt-source-filter"
              placeholder="Chọn hồ sơ nguồn để lọc dòng…"
            />
            <span className="text-[11px] text-slate-400 block mt-1">
              Giúp chọn nhanh các dòng cam kết từ hồ sơ này
            </span>
          </div>
        </div>

        {/* Multi-line Intake Table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
              Chi tiết các dòng hàng thực nhận ({lines.length})
            </h3>
            <button
              type="button"
              className="button button-secondary text-xs"
              onClick={addLine}
            >
              <Plus size={14} /> Thêm dòng hàng / Add Line
            </button>
          </div>

          <div className="space-y-4">
            {lines.map((line, idx) => {
              const calc = lineCalculations[idx];
              const item = calc?.item;
              const sourceLine = resolvedSourceLines[line.sourceLineId];

              return (
                <div
                  key={idx}
                  className={`p-4 rounded-xl border transition-colors ${
                    calc?.isValid
                      ? "bg-white border-slate-200 dark:bg-slate-900 dark:border-slate-800"
                      : "bg-red-50/20 border-red-200 dark:bg-red-950/20 dark:border-red-900/40"
                  }`}
                >
                  <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 text-xs font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 font-mono">
                        Dòng {line.lineKey}
                      </span>
                      {item ? (
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          &bull; {item.name} ({item.code})
                        </span>
                      ) : null}
                    </div>

                    {lines.length > 1 ? (
                      <button
                        type="button"
                        className="text-slate-400 hover:text-red-600 p-1 rounded"
                        title="Xóa dòng"
                        aria-label={`Xóa dòng ${idx + 1}`}
                        onClick={() => removeLine(idx)}
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                    {/* Bounded Source Line Selector */}
                    <div>
                      <InventoryLookup<AcquisitionRecordLine>
                        resource="source_lines"
                        filters={
                          selectedSourceId
                            ? { source_id: selectedSourceId }
                            : undefined
                        }
                        value={line.sourceLineId}
                        selectedLabel={
                          sourceLine
                            ? `${sourceLine.line_key}: ${sourceLine.item_name || sourceLine.item_code || ""} (${sourceLine.expected_purchase_quantity} ${sourceLine.purchase_uom_code})`
                            : undefined
                        }
                        onSelect={(sl) => handleSelectSourceLine(idx, sl)}
                        label="Dòng cam kết nguồn"
                        id={`receive-line-source-${idx}`}
                        required
                        placeholder="Chọn dòng cam kết…"
                      />
                    </div>

                    {/* Destination Location */}
                    <div>
                      <InventoryLookup<InventoryStorageLocation>
                        resource="locations"
                        filters={{ active: true }}
                        value={line.locationId}
                        onSelect={(loc) =>
                          updateLine(idx, { locationId: loc.id })
                        }
                        label="Vị trí nhập kho"
                        id={`receive-line-location-${idx}`}
                        required
                        placeholder="Chọn vị trí kho…"
                      />
                    </div>

                    {/* Purchase Quantity & UOM */}
                    <div>
                      <label
                        htmlFor={`receive-line-purchase-qty-${idx}`}
                        className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
                      >
                        SL Giao / ĐVT Nhập{" "}
                        <span className="text-red-500">*</span>
                      </label>
                      <div className="flex gap-1.5">
                        <input
                          id={`receive-line-purchase-qty-${idx}`}
                          type="text"
                          inputMode="decimal"
                          className="w-full text-xs font-mono border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                          value={line.purchaseQuantity}
                          onChange={(e) =>
                            updateLine(idx, {
                              purchaseQuantity: e.target.value,
                            })
                          }
                          required
                        />
                        <div className="w-32 shrink-0">
                          <InventoryLookup<InventoryUom>
                            resource="uoms"
                            valueKey="code"
                            filters={{ active: true }}
                            value={line.purchaseUomCode}
                            onSelect={(u) =>
                              updateLine(idx, { purchaseUomCode: u.code })
                            }
                            label="ĐVT"
                            id={`receive-line-purchase-uom-${idx}`}
                            hideLabel
                            required
                            placeholder="ĐVT"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Conversion Factor & Live Base Preview */}
                    <div>
                      <label
                        htmlFor={`receive-line-factor-${idx}`}
                        className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Hệ số quy đổi sang {item?.base_uom_code || "Cơ sở"}{" "}
                        <span className="text-red-500">*</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id={`receive-line-factor-${idx}`}
                          type="text"
                          inputMode="decimal"
                          className="w-24 text-xs font-mono border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                          value={line.conversionFactor}
                          onChange={(e) =>
                            updateLine(idx, {
                              conversionFactor: e.target.value,
                            })
                          }
                          required
                        />
                        <div className="flex-1 bg-slate-50 border border-slate-200 rounded p-1.5 text-center dark:bg-slate-800/50 dark:border-slate-800">
                          <span className="text-[10px] text-slate-400 block uppercase">
                            SL cơ sở:
                          </span>
                          <span className="font-mono font-bold text-xs text-indigo-700 dark:text-indigo-300">
                            {formatDisplayQuantity(calc?.baseQty)}{" "}
                            {item?.base_uom_code}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Second row: Inspection Split (Good vs Damaged) and Expiry */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    {/* Good Quantity */}
                    <div>
                      <label
                        htmlFor={`receive-line-good-qty-${idx}`}
                        className="block text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 mb-1"
                      >
                        SL Tốt / Đạt chuẩn{" "}
                        <span className="text-red-500">*</span>
                      </label>
                      <input
                        id={`receive-line-good-qty-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="w-full text-xs font-mono border border-emerald-300 rounded p-2 focus:ring-1 focus:ring-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-200"
                        value={line.goodQuantity}
                        onChange={(e) =>
                          updateLine(idx, { goodQuantity: e.target.value })
                        }
                        required
                      />
                    </div>

                    {/* Damaged Quantity */}
                    <div>
                      <label
                        htmlFor={`receive-line-damaged-qty-${idx}`}
                        className="block text-[11px] font-semibold text-amber-800 dark:text-amber-300 mb-1"
                      >
                        SL Hỏng / Lỗi <span className="text-red-500">*</span>
                      </label>
                      <input
                        id={`receive-line-damaged-qty-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="w-full text-xs font-mono border border-amber-300 rounded p-2 focus:ring-1 focus:ring-amber-500 bg-amber-50/30 dark:bg-amber-950/20 dark:border-amber-800 dark:text-amber-200"
                        value={line.damagedQuantity}
                        onChange={(e) =>
                          updateLine(idx, { damagedQuantity: e.target.value })
                        }
                        required
                      />
                    </div>

                    {/* Expiry Precision */}
                    <div>
                      <label
                        htmlFor={`receive-line-expiry-precision-${idx}`}
                        className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Độ chính xác HSD <span className="text-red-500">*</span>
                      </label>
                      <select
                        id={`receive-line-expiry-precision-${idx}`}
                        className="w-full text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={line.expiryPrecision}
                        onChange={(e) =>
                          updateLine(idx, {
                            expiryPrecision: e.target.value as ExpiryPrecision,
                          })
                        }
                      >
                        {!item?.expiry_required ? (
                          <option value="not_required">
                            Không yêu cầu HSD
                          </option>
                        ) : null}
                        <option value="day">Chính xác đến Ngày (Day)</option>
                        <option value="month">
                          Chính xác đến Tháng (Month)
                        </option>
                      </select>
                    </div>

                    {/* Expiry Input */}
                    <div>
                      <label
                        htmlFor={`receive-line-expiry-input-${idx}`}
                        className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
                      >
                        {line.expiryPrecision === "not_required"
                          ? "Trạng thái HSD"
                          : "Nhập ngày/tháng *"}
                      </label>
                      {line.expiryPrecision === "not_required" ? (
                        <input
                          id={`receive-line-expiry-input-${idx}`}
                          type="text"
                          disabled
                          className="w-full text-xs border border-slate-200 rounded p-2 bg-slate-100 text-slate-400 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-500"
                          value="Không yêu cầu hạn dùng"
                        />
                      ) : line.expiryPrecision === "day" ? (
                        <input
                          id={`receive-line-expiry-input-${idx}`}
                          type="date"
                          className="w-full text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                          value={line.expiryInput}
                          onChange={(e) =>
                            updateLine(idx, { expiryInput: e.target.value })
                          }
                          required
                        />
                      ) : (
                        <input
                          id={`receive-line-expiry-input-${idx}`}
                          type="month"
                          className="w-full text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                          value={line.expiryInput}
                          onChange={(e) =>
                            updateLine(idx, { expiryInput: e.target.value })
                          }
                          required
                        />
                      )}
                    </div>
                  </div>

                  {/* Line Validation Errors */}
                  {!calc?.isValid ? (
                    <div
                      role="alert"
                      aria-live="polite"
                      className="mt-3 p-2 text-xs rounded bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300 space-y-1"
                    >
                      {!calc?.hasSourceLine ? (
                        <div>
                          Vui lòng chọn dòng cam kết nguồn / Source line is
                          required
                        </div>
                      ) : null}
                      {!calc?.hasLocation ? (
                        <div>
                          Vui lòng chọn vị trí kho / Location is required
                        </div>
                      ) : null}
                      {!calc?.hasUom ? (
                        <div>Vui lòng chọn ĐVT nhập / UOM is required</div>
                      ) : null}
                      {!calc?.mult.valid ? <div>{calc?.mult.error}</div> : null}
                      {!calc?.split.valid ? (
                        <div>{calc?.split.error}</div>
                      ) : null}
                      {!calc?.expiryCheck.valid ? (
                        <div>{calc?.expiryCheck.error}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Submit Action Bar */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {allLinesValid && lines.length > 0 ? (
              <span className="text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1.5">
                <Check size={16} /> Toàn bộ các dòng hàng đã thỏa mãn điều kiện
                quy đổi và kiểm tra
              </span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400 font-medium inline-flex items-center gap-1.5">
                <AlertTriangle size={16} /> Vui lòng hoàn thiện đúng các trường
                dữ liệu trên từng dòng
              </span>
            )}
          </div>

          <button
            ref={reviewButtonRef}
            type="button"
            className="button button-primary text-xs"
            disabled={isPending}
            onClick={handleOpenReview}
          >
            {isPending
              ? "Đang xử lý…"
              : "Xác nhận & Xem trước / Review & Confirm"}
          </button>
        </div>
      </div>

      {/* Review & Final Confirmation Modal */}
      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="receive-confirmation-dialog-title"
        >
          <div
            ref={modalRef}
            className="relative w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] dark:bg-slate-900 dark:border-slate-800"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/40">
              <h3
                id="receive-confirmation-dialog-title"
                className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider"
              >
                Xác nhận ghi sổ nhận kho / Post Receipt Confirmation
              </h3>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600 rounded-lg p-1 dark:hover:text-slate-200"
                onClick={() => setConfirmOpen(false)}
                aria-label="Đóng / Close"
                disabled={isPending}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto text-xs">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 grid grid-cols-2 gap-3 dark:bg-slate-800/50 dark:border-slate-800">
                <div>
                  <span className="text-slate-400 block text-[11px]">
                    Mã phiếu nhận:
                  </span>
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm">
                    {receiptReference.toUpperCase()}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">
                    Thời điểm tiếp nhận:
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {occurredAt.replace("T", " ")}
                  </span>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden dark:border-slate-800">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px] dark:bg-slate-800/50 dark:border-slate-800 dark:text-slate-300">
                      <th className="p-2">Dòng</th>
                      <th className="p-2">Vật tư</th>
                      <th className="p-2 text-right">SL Giao</th>
                      <th className="p-2 text-right">Hệ số</th>
                      <th className="p-2 text-right">SL Quy đổi</th>
                      <th className="p-2 text-right text-emerald-700 dark:text-emerald-400">
                        Tốt
                      </th>
                      <th className="p-2 text-right text-amber-700 dark:text-amber-400">
                        Hỏng
                      </th>
                      <th className="p-2">Hạn sử dụng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                    {lines.map((l, i) => {
                      const calc = lineCalculations[i];
                      return (
                        <tr key={i}>
                          <td className="p-2">{l.lineKey}</td>
                          <td className="p-2 font-sans font-medium text-slate-800 dark:text-slate-200">
                            {calc?.item?.name || l.catalogItemId}
                          </td>
                          <td className="p-2 text-right">
                            {l.purchaseQuantity} {l.purchaseUomCode}
                          </td>
                          <td className="p-2 text-right">
                            &times;{l.conversionFactor}
                          </td>
                          <td className="p-2 text-right font-bold text-indigo-700 dark:text-indigo-300">
                            {calc?.baseQty} {calc?.item?.base_uom_code}
                          </td>
                          <td className="p-2 text-right text-emerald-700 dark:text-emerald-400">
                            {l.goodQuantity}
                          </td>
                          <td className="p-2 text-right text-amber-700 dark:text-amber-400">
                            {l.damagedQuantity}
                          </td>
                          <td className="p-2 font-sans text-slate-600 dark:text-slate-300">
                            {l.expiryPrecision === "not_required"
                              ? "Không yêu cầu"
                              : l.expiryInput}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] leading-relaxed dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-300">
                <strong>Lưu ý:</strong> Hành động này ghi nhận giao dịch nhập
                vật lý vào sổ cái kho MedLabs và cập nhật số dư tồn kho tức
                thời. Chứng từ sau khi ghi nhận không thể xóa mà chỉ có thể điều
                chỉnh hoặc hủy qua nghiệp vụ hiệu chỉnh có lưu vết kiểm toán.
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                className="button button-secondary text-xs"
                onClick={() => setConfirmOpen(false)}
                disabled={isPending}
              >
                Quay lại sửa
              </button>
              <button
                type="button"
                className="button button-primary text-xs"
                disabled={isPending}
                onClick={handleFinalSubmit}
              >
                {isPending ? "Đang ghi sổ…" : "Xác nhận ghi sổ ngay"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
