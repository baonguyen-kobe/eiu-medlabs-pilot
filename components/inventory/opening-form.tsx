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
import { confirmOpeningBalanceAction } from "@/app/inventory/actions";
import { businessTodayString } from "@/lib/business-time";
import { validateSplit } from "@/lib/inventory/decimal";
import { normalizeExpiryInput } from "@/lib/inventory/dates";
import { InventoryLookup } from "@/components/inventory/inventory-lookup";
import type {
  ConfirmOpeningBalancePayload,
  ExpiryPrecision,
  InventoryCatalogItem,
  InventoryStorageLocation,
} from "@/lib/inventory/types";

interface OpeningLineState {
  lineKey: string;
  provenanceGroup: string;
  catalogItemId: string;
  locationId: string;
  baseQuantity: string;
  goodQuantity: string;
  damagedQuantity: string;
  expiryPrecision: ExpiryPrecision;
  expiryInput: string;
  evidenceNote: string;
}

export function OpeningForm({
  items: initialItems = [],
  locations: initialLocations = [],
}: {
  items?: InventoryCatalogItem[];
  locations?: InventoryStorageLocation[];
} = {}) {
  const [cutoverKey, setCutoverKey] = useState("CUTOVER-2026-S1");
  const [scopeDescription, setScopeDescription] = useState(
    "Kiểm kê khởi tạo số dư đầu kỳ toàn bộ kho MedLabs",
  );
  const [countCutoff, setCountCutoff] = useState(() => {
    return `${businessTodayString()}T00:00`;
  });
  const [provenanceNote, setProvenanceNote] = useState(
    "Biên bản kiểm kê số dư thực tế tại chỗ có xác nhận của Hội đồng kiểm kê",
  );

  // Resolved metadata dictionary for items chosen through bounded lookup
  const [resolvedItems, setResolvedItems] = useState<
    Record<string, InventoryCatalogItem>
  >(() => {
    const map: Record<string, InventoryCatalogItem> = {};
    for (const it of initialItems) {
      map[it.id] = it;
    }
    return map;
  });

  const [lines, setLines] = useState<OpeningLineState[]>([
    {
      lineKey: "L1",
      provenanceGroup: "BB-KK-01",
      catalogItemId: initialItems[0]?.id || "",
      locationId: initialLocations[0]?.id || "",
      baseQuantity: "10",
      goodQuantity: "10",
      damagedQuantity: "0",
      expiryPrecision: initialItems[0]?.expiry_required
        ? "unknown"
        : "not_required",
      expiryInput: "",
      evidenceNote: "",
    },
  ]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
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
      lines.length > 1 ||
      lines.some(
        (l) =>
          l.catalogItemId ||
          l.baseQuantity !== "10" ||
          l.goodQuantity !== "10" ||
          l.damagedQuantity !== "0",
      ) ||
      cutoverKey !== "CUTOVER-2026-S1"
    );
  }, [lines, cutoverKey]);

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

  function handleSelectItem(idx: number, item: InventoryCatalogItem) {
    setResolvedItems((prev) => ({ ...prev, [item.id]: item }));
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const next = { ...l, catalogItemId: item.id };
        if (item.expiry_required && next.expiryPrecision === "not_required") {
          next.expiryPrecision = "unknown";
        }
        return next;
      }),
    );
  }

  function addLine() {
    const nextNo = lines.length + 1;
    setLines((prev) => [
      ...prev,
      {
        lineKey: `L${nextNo}`,
        provenanceGroup: prev[prev.length - 1]?.provenanceGroup || "BB-KK-01",
        catalogItemId: "",
        locationId: prev[prev.length - 1]?.locationId || "",
        baseQuantity: "1",
        goodQuantity: "1",
        damagedQuantity: "0",
        expiryPrecision: "not_required",
        expiryInput: "",
        evidenceNote: "",
      },
    ]);
  }

  function removeLine(idx: number) {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, updates: Partial<OpeningLineState>) {
    setLines((prev) =>
      prev.map((line, i) => {
        if (i !== idx) return line;
        return { ...line, ...updates };
      }),
    );
  }

  // Focus first invalid control
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

  // Live calculations & validations
  const lineCalculations = useMemo(() => {
    return lines.map((line) => {
      const item = resolvedItems[line.catalogItemId];
      const split = validateSplit(
        line.baseQuantity,
        line.goodQuantity,
        line.damagedQuantity,
      );

      let expiryCheck = { valid: true, error: "" };
      if (item?.expiry_required && line.expiryPrecision === "not_required") {
        expiryCheck = {
          valid: false,
          error:
            "Vật tư yêu cầu HSD không được chọn 'Không yêu cầu'. Có thể chọn 'Chưa rõ (Unknown)' cho tồn đầu.",
        };
      } else if (
        line.expiryPrecision !== "not_required" &&
        line.expiryPrecision !== "unknown"
      ) {
        const norm = normalizeExpiryInput(
          line.expiryPrecision,
          line.expiryInput,
        );
        if (!norm.valid) {
          expiryCheck = {
            valid: false,
            error: norm.error || "Hạn dùng không hợp lệ",
          };
        }
      }

      const hasItem = Boolean(line.catalogItemId);
      const hasLocation = Boolean(line.locationId);

      return {
        item,
        split,
        expiryCheck,
        hasItem,
        hasLocation,
        isValid: hasItem && hasLocation && split.valid && expiryCheck.valid,
      };
    });
  }, [lines, resolvedItems]);

  const allLinesValid = lineCalculations.every((c) => c.isValid);
  const canSubmit =
    Boolean(cutoverKey.trim()) &&
    Boolean(countCutoff) &&
    Boolean(scopeDescription.trim()) &&
    Boolean(provenanceNote.trim()) &&
    allLinesValid &&
    lines.length > 0;

  function handleOpenReview() {
    setValidationError(null);
    if (!canSubmit) {
      setValidationError(
        "Vui lòng hoàn thiện các trường bắt buộc và sửa các dòng kiểm kê chưa hợp lệ / Please resolve invalid fields.",
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

    const payload: ConfirmOpeningBalancePayload = {
      cutover_key: cutoverKey.trim().toUpperCase(),
      count_cutoff: new Date(`${countCutoff}+07:00`).toISOString(),
      scope_description: scopeDescription.trim(),
      provenance_note: provenanceNote.trim(),
      synthetic: true,
      lines: lines.map((l) => ({
        line_key: l.lineKey.trim(),
        provenance_group: l.provenanceGroup.trim(),
        catalog_item_id: l.catalogItemId,
        location_id: l.locationId,
        base_quantity: l.baseQuantity,
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
      const res = await confirmOpeningBalanceAction(payload, retryKey).catch(
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
          message: `Xác nhận khởi tạo số dư đầu kỳ thành công (Mã chốt: ${payload.cutover_key})! Sổ cái và tồn kho đã được ghi nhận.`,
        });
      } else {
        setNotice({
          ok: false,
          message:
            res.error ||
            "Xác nhận số dư đầu kỳ thất bại / Failed to confirm opening balance",
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

      {/* Main Form Container */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6 dark:bg-slate-900 dark:border-slate-800">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
            Biên bản Chốt kiểm kê ban đầu / Opening Cutover
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Dành riêng cho Quản trị viên (Admin). Xác lập số dư kiểm kê ban đầu
            có giá trị pháp lý, không suy diễn lịch sử mua sắm.
          </p>
        </div>

        {/* Header Fields Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200/80 dark:bg-slate-800/40 dark:border-slate-800">
          <div>
            <label
              htmlFor="opening-cutover-key"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Mã đợt chốt (Cutover Key) <span className="text-red-500">*</span>
            </label>
            <input
              id="opening-cutover-key"
              type="text"
              className="w-full text-xs font-mono uppercase border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              value={cutoverKey}
              onChange={(e) => setCutoverKey(e.target.value)}
              required
            />
            <span className="text-[11px] text-slate-400 block mt-1">
              Khóa duy nhất của đợt khởi tạo
            </span>
          </div>

          <div>
            <label
              htmlFor="opening-count-cutoff"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Thời điểm chốt kiểm kê <span className="text-red-500">*</span>
            </label>
            <input
              id="opening-count-cutoff"
              type="datetime-local"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              value={countCutoff}
              onChange={(e) => setCountCutoff(e.target.value)}
              required
            />
            <span className="text-[11px] text-slate-400 block mt-1">
              Giờ và ngày chốt sổ (Asia/Ho_Chi_Minh)
            </span>
          </div>

          <div className="sm:col-span-2">
            <label
              htmlFor="opening-scope"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Phạm vi kiểm kê <span className="text-red-500">*</span>
            </label>
            <input
              id="opening-scope"
              type="text"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              value={scopeDescription}
              onChange={(e) => setScopeDescription(e.target.value)}
              required
            />
            <span className="text-[11px] text-slate-400 block mt-1">
              Mô tả ngắn phạm vi kho/khu vực kiểm kê
            </span>
          </div>

          <div className="sm:col-span-4">
            <label
              htmlFor="opening-provenance-note"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Căn cứ pháp lý & Ghi chú xuất xứ{" "}
              <span className="text-red-500">*</span>
            </label>
            <input
              id="opening-provenance-note"
              type="text"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              value={provenanceNote}
              onChange={(e) => setProvenanceNote(e.target.value)}
              required
            />
          </div>
        </div>

        {/* Multi-line Count Table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
              Danh sách các dòng kiểm đếm thực tế ({lines.length})
            </h3>
            <button
              type="button"
              className="button button-secondary text-xs"
              onClick={addLine}
            >
              <Plus size={14} /> Thêm dòng kiểm kê / Add Line
            </button>
          </div>

          <div className="space-y-4">
            {lines.map((line, idx) => {
              const calc = lineCalculations[idx];
              const item = calc?.item;

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
                    {/* Bounded Item Lookup */}
                    <div>
                      <InventoryLookup<InventoryCatalogItem>
                        resource="items"
                        filters={{ active: true }}
                        value={line.catalogItemId}
                        selectedLabel={
                          item ? `${item.name} (${item.code})` : undefined
                        }
                        onSelect={(selectedItem) =>
                          handleSelectItem(idx, selectedItem)
                        }
                        label="Vật tư kiểm kê"
                        id={`opening-item-${idx}`}
                        required
                        placeholder="Chọn vật tư kiểm kê…"
                      />
                    </div>

                    {/* Bounded Storage Location Lookup */}
                    <div>
                      <InventoryLookup<InventoryStorageLocation>
                        resource="locations"
                        filters={{ active: true }}
                        value={line.locationId}
                        onSelect={(selectedLoc) =>
                          updateLine(idx, { locationId: selectedLoc.id })
                        }
                        label="Vị trí lưu kho"
                        id={`opening-location-${idx}`}
                        required
                        placeholder="Chọn vị trí kho…"
                      />
                    </div>

                    {/* Provenance Group / Evidence key */}
                    <div>
                      <label
                        htmlFor={`opening-group-${idx}`}
                        className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Nhóm bằng chứng / Biên bản{" "}
                        <span className="text-red-500">*</span>
                      </label>
                      <input
                        id={`opening-group-${idx}`}
                        type="text"
                        className="w-full text-xs font-mono border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={line.provenanceGroup}
                        onChange={(e) =>
                          updateLine(idx, { provenanceGroup: e.target.value })
                        }
                        placeholder="VD: BB-KK-01"
                        required
                      />
                    </div>

                    {/* Total Base Count */}
                    <div>
                      <label
                        htmlFor={`opening-base-qty-${idx}`}
                        className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Tổng SL kiểm đếm ({item?.base_uom_code || "Cơ sở"}){" "}
                        <span className="text-red-500">*</span>
                      </label>
                      <input
                        id={`opening-base-qty-${idx}`}
                        type="text"
                        inputMode="decimal"
                        className="w-full text-xs font-mono font-bold text-indigo-700 border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-indigo-300"
                        value={line.baseQuantity}
                        onChange={(e) =>
                          updateLine(idx, { baseQuantity: e.target.value })
                        }
                        required
                      />
                    </div>
                  </div>

                  {/* Second row: Split & Expiry */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    {/* Good Quantity */}
                    <div>
                      <label
                        htmlFor={`opening-good-qty-${idx}`}
                        className="block text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 mb-1"
                      >
                        SL Tốt / Đạt chuẩn{" "}
                        <span className="text-red-500">*</span>
                      </label>
                      <input
                        id={`opening-good-qty-${idx}`}
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
                        htmlFor={`opening-damaged-qty-${idx}`}
                        className="block text-[11px] font-semibold text-amber-800 dark:text-amber-300 mb-1"
                      >
                        SL Hỏng / Lỗi <span className="text-red-500">*</span>
                      </label>
                      <input
                        id={`opening-damaged-qty-${idx}`}
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

                    {/* Expiry Precision Selection */}
                    <div>
                      <label
                        htmlFor={`opening-expiry-precision-${idx}`}
                        className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
                      >
                        Độ chính xác HSD <span className="text-red-500">*</span>
                      </label>
                      <select
                        id={`opening-expiry-precision-${idx}`}
                        className="w-full text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={line.expiryPrecision}
                        onChange={(e) =>
                          updateLine(idx, {
                            expiryPrecision: e.target.value as ExpiryPrecision,
                          })
                        }
                      >
                        {!item?.expiry_required ? (
                          <option value="not_required">Không yêu cầu</option>
                        ) : null}
                        <option value="unknown">
                          Chưa rõ (Unknown) &bull; Cần Admin xác minh sau
                        </option>
                        <option value="day">Chính xác đến Ngày (Day)</option>
                        <option value="month">
                          Chính xác đến Tháng (Month)
                        </option>
                      </select>
                    </div>

                    {/* Expiry Input / Status */}
                    <div>
                      <label
                        htmlFor={`opening-expiry-input-${idx}`}
                        className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
                      >
                        {line.expiryPrecision === "not_required"
                          ? "Trạng thái HSD"
                          : line.expiryPrecision === "unknown"
                            ? "Trạng thái HSD"
                            : "Nhập ngày/tháng *"}
                      </label>
                      {line.expiryPrecision === "not_required" ? (
                        <input
                          id={`opening-expiry-input-${idx}`}
                          type="text"
                          disabled
                          className="w-full text-xs border border-slate-200 rounded p-2 bg-slate-100 text-slate-400 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-500"
                          value="Không áp dụng"
                        />
                      ) : line.expiryPrecision === "unknown" ? (
                        <input
                          id={`opening-expiry-input-${idx}`}
                          type="text"
                          disabled
                          className="w-full text-xs border border-amber-200 rounded p-2 bg-amber-50 text-amber-800 font-medium dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-300"
                          value="Chưa rõ (Sẽ cần Admin xác minh)"
                        />
                      ) : line.expiryPrecision === "day" ? (
                        <input
                          id={`opening-expiry-input-${idx}`}
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
                          id={`opening-expiry-input-${idx}`}
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

                  {!calc?.isValid ? (
                    <div
                      role="alert"
                      aria-live="polite"
                      className="mt-3 p-2 text-xs rounded bg-red-50 border border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300"
                    >
                      {!calc?.hasItem
                        ? "Vui lòng chọn vật tư kiểm kê / Item is required"
                        : !calc?.hasLocation
                          ? "Vui lòng chọn vị trí lưu kho / Location is required"
                          : !calc?.split.valid
                            ? calc?.split.error
                            : calc?.expiryCheck.error}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Button Footer */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {allLinesValid && lines.length > 0 ? (
              <span className="text-emerald-700 dark:text-emerald-400 font-semibold inline-flex items-center gap-1.5">
                <Check size={16} /> Toàn bộ các dòng kiểm kê đã hợp lệ
              </span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400 font-medium inline-flex items-center gap-1.5">
                <AlertTriangle size={16} /> Vui lòng kiểm tra lại các trường vật
                tư, vị trí, số lượng và HSD
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

      {/* Review & Confirmation Modal */}
      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-opening-title"
        >
          <div
            ref={modalRef}
            className="relative w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] dark:bg-slate-900 dark:border-slate-800"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/40">
              <h3
                id="confirm-opening-title"
                className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider"
              >
                Xác nhận chốt tồn đầu kỳ / Confirm Opening Cutover
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
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 grid grid-cols-2 gap-2 dark:bg-slate-800/50 dark:border-slate-800">
                <div>
                  <span className="text-slate-400 block text-[11px]">
                    Mã chốt:
                  </span>
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                    {cutoverKey}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">
                    Thời điểm chốt:
                  </span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {countCutoff.replace("T", " ")}
                  </span>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden dark:border-slate-800">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[10px] dark:bg-slate-800/50 dark:border-slate-800 dark:text-slate-300">
                      <th className="p-2">Dòng</th>
                      <th className="p-2">Vật tư</th>
                      <th className="p-2 text-right">SL Cơ sở</th>
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
                      const item = resolvedItems[l.catalogItemId];
                      return (
                        <tr key={i}>
                          <td className="p-2">{l.lineKey}</td>
                          <td className="p-2 font-sans font-medium text-slate-800 dark:text-slate-200">
                            {item?.name || l.catalogItemId}
                          </td>
                          <td className="p-2 text-right font-bold text-slate-900 dark:text-slate-100">
                            {l.baseQuantity} {item?.base_uom_code}
                          </td>
                          <td className="p-2 text-right text-emerald-700 dark:text-emerald-400">
                            {l.goodQuantity}
                          </td>
                          <td className="p-2 text-right text-amber-700 dark:text-amber-400">
                            {l.damagedQuantity}
                          </td>
                          <td className="p-2 font-sans">
                            {l.expiryPrecision === "unknown" ? (
                              <span className="text-amber-800 dark:text-amber-300 font-semibold">
                                Chưa rõ (Unknown)
                              </span>
                            ) : l.expiryPrecision === "not_required" ? (
                              "Không yêu cầu"
                            ) : (
                              l.expiryInput
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
                {isPending ? "Đang xác nhận…" : "Xác nhận chốt số dư ngay"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
