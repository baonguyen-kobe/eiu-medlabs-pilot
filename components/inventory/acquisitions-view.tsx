"use client";

import React, { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ClipboardList, Plus, Search, Settings, X } from "@/components/icons";
import {
  createSourceAction,
  createSourceLineAction,
  updateSourceAction,
  updateSourceLineAction,
  voidSourceAction,
} from "@/app/inventory/actions";
import {
  formatCurrencyAmount,
  formatDisplayQuantity,
  validateDecimalString,
} from "@/lib/inventory/decimal";
import { formatInventoryDate } from "@/lib/inventory/dates";
import { businessTodayString } from "@/lib/business-time";
import { ConfirmActionModal } from "./confirm-action-modal";
import { PaginationControls } from "@/components/pagination-controls";
import { InventoryLookup } from "./inventory-lookup";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type {
  AcquisitionRecord,
  AcquisitionRecordLine,
  InventoryCatalogItem,
  InventorySourceReceipt,
  InventorySupplier,
  InventoryUom,
} from "@/lib/inventory/types";
function extractRevision(data: unknown): string | number | undefined {
  if (!data || typeof data !== "object") return undefined;
  if (
    "revision" in data &&
    (typeof data.revision === "number" || typeof data.revision === "string")
  ) {
    return data.revision;
  }
  if ("payload" in data && data.payload && typeof data.payload === "object") {
    const payload = data.payload;
    if (
      "revision" in payload &&
      (typeof payload.revision === "number" ||
        typeof payload.revision === "string")
    ) {
      return payload.revision;
    }
  }
  return undefined;
}

function extractSourceRevision(data: unknown): string | number | undefined {
  if (!data || typeof data !== "object") return undefined;
  if (
    "source_revision" in data &&
    (typeof data.source_revision === "number" ||
      typeof data.source_revision === "string")
  ) {
    return data.source_revision;
  }
  if ("payload" in data && data.payload && typeof data.payload === "object") {
    const payload = data.payload;
    if (
      "source_revision" in payload &&
      (typeof payload.source_revision === "number" ||
        typeof payload.source_revision === "string")
    ) {
      return payload.source_revision;
    }
  }
  if (
    "revision" in data &&
    (typeof data.revision === "number" || typeof data.revision === "string")
  ) {
    return data.revision;
  }
  return undefined;
}

export function AcquisitionsView({
  initialSources,
  sourcesTotal,
  currentSourcePage = 1,
  sourcePageSize = TABLE_PAGE_SIZE,
  currentSourceQ = "",
  currentSupplierId = "",
  currentStatus = "all",
  currentSort: _currentSort = "",
  selectedSourceId,
  selectedSource: serverSelectedSource,
  initialLines,
  linesTotal,
  currentLinePage = 1,
  linePageSize = TABLE_PAGE_SIZE,
  currentLineQ = "",
  initialReceipts,
  isAdmin,
}: {
  initialSources: AcquisitionRecord[];
  sourcesTotal: number;
  currentSourcePage?: number;
  sourcePageSize?: number;
  currentSourceQ?: string;
  currentSupplierId?: string;
  currentStatus?: string;
  currentSort?: string;
  selectedSourceId: string | null;
  selectedSource: AcquisitionRecord | null;
  initialLines: AcquisitionRecordLine[];
  linesTotal: number;
  currentLinePage?: number;
  linePageSize?: number;
  currentLineQ?: string;
  initialReceipts: InventorySourceReceipt[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [sources, setSources] = useState<AcquisitionRecord[]>(initialSources);
  const [lines, setLines] = useState<AcquisitionRecordLine[]>(initialLines);
  const [receipts, setReceipts] =
    useState<InventorySourceReceipt[]>(initialReceipts);

  const [search, setSearch] = useState(currentSourceQ);
  const [supplierFilter, setSupplierFilter] = useState(currentSupplierId);
  const [selectedSupplierFilterLabel, setSelectedSupplierFilterLabel] =
    useState("");
  const [statusFilter, setStatusFilter] = useState(currentStatus);
  const [lineSearch, setLineSearch] = useState(currentLineQ);

  // State derived directly from server props without synchronous useEffect cascades
  const [prevProps, setPrevProps] = useState({
    sources: initialSources,
    lines: initialLines,
    receipts: initialReceipts,
    sourceQ: currentSourceQ,
    supplierId: currentSupplierId,
    status: currentStatus,
    lineQ: currentLineQ,
  });
  if (
    prevProps.sources !== initialSources ||
    prevProps.lines !== initialLines ||
    prevProps.receipts !== initialReceipts ||
    prevProps.sourceQ !== currentSourceQ ||
    prevProps.supplierId !== currentSupplierId ||
    prevProps.status !== currentStatus ||
    prevProps.lineQ !== currentLineQ
  ) {
    setPrevProps({
      sources: initialSources,
      lines: initialLines,
      receipts: initialReceipts,
      sourceQ: currentSourceQ,
      supplierId: currentSupplierId,
      status: currentStatus,
      lineQ: currentLineQ,
    });
    setSources(initialSources);
    setLines(initialLines);
    setReceipts(initialReceipts);
    setSearch(currentSourceQ);
    setSupplierFilter(currentSupplierId);
    setStatusFilter(currentStatus);
    setLineSearch(currentLineQ);
  }

  const selectedSource =
    serverSelectedSource ||
    sources.find((s) => s.id === selectedSourceId) ||
    null;

  const updateParams = useCallback(
    (updates: Record<string, string | number | undefined | null>) => {
      const params = new URLSearchParams(
        searchParams ? searchParams.toString() : "",
      );
      for (const [key, val] of Object.entries(updates)) {
        if (
          val === undefined ||
          val === null ||
          val === "" ||
          (key === "page" && Number(val) <= 1) ||
          (key === "line_page" && Number(val) <= 1) ||
          (key === "status" && val === "all")
        ) {
          params.delete(key);
        } else {
          params.set(key, String(val));
        }
      }
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  // Modals
  const [createSourceOpen, setCreateSourceOpen] = useState(false);
  const [editSource, setEditSource] = useState<AcquisitionRecord | null>(null);
  const [voidSource, setVoidSource] = useState<AcquisitionRecord | null>(null);
  const [createLineOpen, setCreateLineOpen] = useState(false);
  const [editLine, setEditLine] = useState<AcquisitionRecordLine | null>(null);

  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  function handleSourceSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateParams({ q: search.trim() || undefined, page: undefined });
  }

  function handleStatusChange(val: string) {
    setStatusFilter(val);
    updateParams({ status: val === "all" ? undefined : val, page: undefined });
  }

  function handleLineSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateParams({
      line_q: lineSearch.trim() || undefined,
      line_page: undefined,
    });
  }
  async function handleConfirmVoid(reason: string) {
    if (!voidSource) return;
    startTransition(async () => {
      const res = await voidSourceAction({
        id: voidSource.id,
        expected_revision: voidSource.revision,
        reason,
      });

      if (res.ok) {
        setSources((prev) =>
          prev.map((s) =>
            s.id === voidSource.id
              ? {
                  ...s,
                  status: "voided",
                  revision: extractRevision(res.data) ?? voidSource.revision,
                }
              : s,
          ),
        );
        setNotice({
          ok: true,
          message: `Đã hủy hồ sơ nguồn ${voidSource.source_reference} (Không ảnh hưởng tồn kho)`,
        });
      } else {
        setNotice({ ok: false, message: res.error || "Lỗi hủy hồ sơ" });
      }
      setVoidSource(null);
    });
  }

  return (
    <div className="space-y-6">
      {/* Notice Banner */}
      {notice ? (
        <div
          className={`p-3 text-xs rounded-xl flex items-center justify-between border ${
            notice.ok
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          <span>{notice.message}</span>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 p-1"
            onClick={() => setNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {/* S1 Immutable Policy Notice Banner */}
      <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-xs text-blue-900 flex items-start gap-2.5">
        <ClipboardList size={18} className="text-blue-600 shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <span className="font-semibold block mb-0.5">
            Quy định bất biến hồ sơ nguồn (Invariants D09 / PAGE-004):
          </span>
          Lưu hồ sơ nguồn có biến động tồn kho bằng 0 (Delta = 0). Dữ liệu này
          ghi nhận bằng chứng mua sắm / hợp đồng / tài trợ. Hàng hóa thực tế chỉ
          được ghi nhận vào sổ cái khi hoàn tất thủ tục{" "}
          <strong>Nhận kho (Receive Stock)</strong>.
        </div>
      </div>

      {/* Main Grid: Left Sources List, Right Source Detail & Lines */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Sources List */}
        <div className="lg:col-span-1 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Danh sách hồ sơ nguồn ({sourcesTotal})
            </h2>
            <button
              type="button"
              className="button button-primary text-xs"
              onClick={() => setCreateSourceOpen(true)}
            >
              <Plus size={14} /> Tạo hồ sơ mới
            </button>
          </div>

          {/* Search & Filters */}
          <div className="space-y-2 p-3 bg-white rounded-xl border border-slate-200 shadow-xs">
            <form
              onSubmit={handleSourceSearchSubmit}
              className="relative flex items-center gap-1.5"
            >
              <div className="relative flex-1">
                <Search
                  className="absolute left-2.5 top-2 text-slate-400"
                  size={14}
                />
                <input
                  id="acquisitions-search"
                  aria-label="Tìm mã hồ sơ, nhà cung cấp / Search Source or Supplier"
                  type="text"
                  placeholder="Tìm mã hồ sơ, nhà cung cấp..."
                  className="w-full text-xs pl-8 pr-2.5 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="button button-secondary text-xs px-2.5 py-1.5"
              >
                Tìm
              </button>
            </form>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-1">
                <div className="flex-1">
                  <InventoryLookup<InventorySupplier>
                    resource="suppliers"
                    filters={{ active: true }}
                    value={supplierFilter}
                    valueKey="id"
                    label="Lọc theo nhà cung cấp"
                    id="acquisitions-supplier-filter"
                    selectedLabel={selectedSupplierFilterLabel}
                    placeholder="Tất cả NCC / All Suppliers"
                    hideLabel={true}
                    onSelect={(sup) => {
                      setSupplierFilter(sup.id);
                      setSelectedSupplierFilterLabel(sup.name);
                      updateParams({ supplier_id: sup.id, page: undefined });
                    }}
                  />
                </div>
                {supplierFilter ? (
                  <button
                    type="button"
                    className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                    onClick={() => {
                      setSupplierFilter("");
                      setSelectedSupplierFilterLabel("");
                      updateParams({ supplier_id: undefined, page: undefined });
                    }}
                    title="Bỏ lọc NCC"
                    aria-label="Bỏ lọc NCC"
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>

              <div>
                <select
                  id="acquisitions-status-filter"
                  aria-label="Lọc theo trạng thái / Filter by Status"
                  className="w-full text-[11px] p-1.5 border border-slate-300 rounded-lg bg-white"
                  value={statusFilter}
                  onChange={(e) => handleStatusChange(e.target.value)}
                >
                  <option value="all">Tất cả TT / All Statuses</option>
                  <option value="active">Đang hiệu lực / Active</option>
                  <option value="voided">Đã hủy / Voided</option>
                </select>
              </div>
            </div>
          </div>

          {/* Sources List Box */}
          <div className="space-y-2">
            {sources.length === 0 ? (
              <div className="p-8 text-center bg-white rounded-xl border border-slate-200 text-xs text-slate-400">
                Chưa có hồ sơ nguồn nào phù hợp.
              </div>
            ) : (
              sources.map((source) => {
                const isSelected = source.id === selectedSourceId;
                return (
                  <div
                    key={source.id}
                    onClick={() =>
                      updateParams({
                        sourceId: source.id,
                        line_page: undefined,
                        line_q: undefined,
                      })
                    }
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? "bg-blue-50/70 border-blue-500 shadow-xs ring-1 ring-blue-500/20"
                        : "bg-white border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono font-bold text-xs text-slate-900">
                        {source.source_reference}
                      </span>
                      {source.status === "voided" ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
                          Đã hủy / Voided
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                          Hiệu lực / Active
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-600 mb-1 line-clamp-1">
                      {source.supplier_name || "Nhà cung cấp chưa đặt tên"}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>
                        Ngày: {formatInventoryDate(source.reference_date)}
                      </span>
                      <span className="font-mono">
                        r{String(source.revision)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}

            <PaginationControls
              currentPage={currentSourcePage}
              totalItems={sourcesTotal}
              onPageChange={(p) =>
                updateParams({ page: p > 1 ? p : undefined })
              }
              pageSize={sourcePageSize}
            />
          </div>
        </div>

        {/* Right Column: Selected Source Detail & Lines */}
        <div className="lg:col-span-2 space-y-4">
          {selectedSource ? (
            <>
              {/* Header Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900 font-mono">
                        {selectedSource.source_reference}
                      </h3>
                      {selectedSource.status === "voided" ? (
                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">
                          Đã hủy / Voided
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-700">
                          Đang hiệu lực / Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Nhà cung cấp:{" "}
                      <strong className="text-slate-700">
                        {selectedSource.supplier_name ||
                          "Nhà cung cấp chưa đặt tên"}
                      </strong>
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedSource.status !== "voided" ? (
                      <>
                        <Link
                          href={`/inventory/receive?sourceId=${selectedSource.id}`}
                          className="button button-primary text-xs"
                        >
                          <Plus size={14} /> Nhận hàng từ hồ sơ này
                        </Link>
                        <button
                          type="button"
                          className="button button-secondary text-xs"
                          onClick={() => setEditSource(selectedSource)}
                        >
                          <Settings size={14} /> Sửa thông tin
                        </button>
                        {isAdmin ? (
                          <button
                            type="button"
                            className="button button-danger text-xs"
                            onClick={() => setVoidSource(selectedSource)}
                          >
                            Hủy hồ sơ
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      Ngày hồ sơ:
                    </span>
                    <span className="font-semibold text-slate-800">
                      {formatInventoryDate(selectedSource.reference_date)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      Nguồn kinh phí:
                    </span>
                    <span className="font-semibold text-slate-800">
                      {selectedSource.funding_source || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      Mã tham chiếu ngoài:
                    </span>
                    <span className="font-mono text-slate-800">
                      {selectedSource.external_reference || "—"}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">
                      Phiên bản:
                    </span>
                    <span className="font-mono text-slate-800">
                      r{String(selectedSource.revision)}
                    </span>
                  </div>
                </div>

                {selectedSource.notes ? (
                  <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <span className="font-semibold text-slate-700">
                      Ghi chú:
                    </span>{" "}
                    {selectedSource.notes}
                  </div>
                ) : null}
              </div>

              {/* Source Lines Card */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100 bg-slate-50/50">
                  <div className="flex items-center gap-3">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Các dòng vật tư cam kết ({linesTotal})
                    </h4>
                    <form
                      onSubmit={handleLineSearchSubmit}
                      className="flex items-center gap-1.5"
                    >
                      <div className="relative">
                        <Search
                          className="absolute left-2 top-1.5 text-slate-400"
                          size={13}
                        />
                        <input
                          id="search-source-lines"
                          aria-label="Tìm dòng vật tư"
                          type="text"
                          placeholder="Tìm SKU, tên..."
                          className="text-[11px] pl-6 pr-2 py-1 border border-slate-300 rounded-lg focus:ring-1 focus:ring-blue-500 w-36 sm:w-48"
                          value={lineSearch}
                          onChange={(e) => setLineSearch(e.target.value)}
                        />
                      </div>
                      <button
                        type="submit"
                        className="button button-secondary text-[11px] px-2 py-1"
                      >
                        Tìm
                      </button>
                    </form>
                  </div>
                  {selectedSource.status !== "voided" ? (
                    <button
                      type="button"
                      className="button button-primary text-xs"
                      onClick={() => setCreateLineOpen(true)}
                    >
                      <Plus size={14} /> Thêm dòng vật tư
                    </button>
                  ) : null}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                        <th className="py-2.5 px-3">Dòng / Key</th>
                        <th className="py-2.5 px-3">Vật tư / Item</th>
                        <th className="py-2.5 px-3">SL Cam kết</th>
                        <th className="py-2.5 px-3">So sánh SL cơ sở</th>
                        <th className="py-2.5 px-3">Đóng gói thực nhận</th>
                        <th className="py-2.5 px-3">Phiếu nhận thực tế</th>
                        <th className="py-2.5 px-3 text-right">
                          Đơn giá (INV-018)
                        </th>
                        <th className="py-2.5 px-3 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {lines.length === 0 ? (
                        <tr>
                          <td
                            colSpan={8}
                            className="py-8 text-center text-slate-400"
                          >
                            Hồ sơ này chưa có dòng vật tư cam kết nào.
                          </td>
                        </tr>
                      ) : (
                        lines.map((line) => {
                          const lineReceipts = receipts.filter(
                            (r) => r.source_line_id === line.id,
                          );
                          const hasFactor = Boolean(
                            line.expected_conversion_factor,
                          );
                          const discrepancyNum =
                            line.base_discrepancy !== null &&
                            line.base_discrepancy !== undefined
                              ? Number(line.base_discrepancy)
                              : null;

                          return (
                            <tr
                              key={line.id}
                              className="hover:bg-slate-50/80 transition-colors"
                            >
                              <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">
                                {line.line_key}
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="font-semibold text-slate-900 block">
                                  {line.item_code}
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  {line.item_name}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-mono">
                                <span className="font-bold text-slate-900">
                                  {formatDisplayQuantity(
                                    line.expected_purchase_quantity,
                                  )}
                                </span>{" "}
                                <span className="text-slate-600 font-medium">
                                  {line.purchase_uom_code}
                                </span>
                                {hasFactor ? (
                                  <span className="text-[11px] text-slate-400 block font-normal">
                                    QĐ: ×
                                    {formatDisplayQuantity(
                                      line.expected_conversion_factor!,
                                    )}
                                  </span>
                                ) : null}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="space-y-0.5 text-[11px]">
                                  <div>
                                    <span className="text-slate-400">
                                      Dự kiến:{" "}
                                    </span>
                                    <span className="font-mono font-medium">
                                      {line.expected_base_quantity
                                        ? formatDisplayQuantity(
                                            line.expected_base_quantity,
                                          )
                                        : "—"}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-slate-400">
                                      Thực nhận:{" "}
                                    </span>
                                    <span className="font-mono font-bold text-slate-900">
                                      {formatDisplayQuantity(
                                        line.actual_base_quantity || "0",
                                      )}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-slate-400">
                                      Lệch:{" "}
                                    </span>
                                    {hasFactor && discrepancyNum !== null ? (
                                      <span
                                        className={`font-mono font-bold px-1.5 py-0.5 rounded text-[10px] ${
                                          discrepancyNum === 0
                                            ? "bg-emerald-100 text-emerald-800"
                                            : discrepancyNum > 0
                                              ? "bg-blue-100 text-blue-800"
                                              : "bg-amber-100 text-amber-800"
                                        }`}
                                      >
                                        {discrepancyNum > 0
                                          ? `+${formatDisplayQuantity(line.base_discrepancy!)}`
                                          : formatDisplayQuantity(
                                              line.base_discrepancy!,
                                            )}
                                      </span>
                                    ) : (
                                      <span className="text-slate-400 italic">
                                        Không xác định
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 px-3">
                                {line.packaging && line.packaging.length > 0 ? (
                                  <div className="space-y-1 text-[11px] font-mono">
                                    {line.packaging.map((pkg, idx) => (
                                      <div key={idx}>
                                        <span className="font-semibold text-slate-900">
                                          {formatDisplayQuantity(
                                            pkg.purchase_quantity,
                                          )}{" "}
                                          {pkg.purchase_uom_code}
                                        </span>{" "}
                                        <span className="text-slate-500">
                                          (×
                                          {formatDisplayQuantity(
                                            pkg.conversion_factor,
                                          )}{" "}
                                          ={" "}
                                          {formatDisplayQuantity(
                                            pkg.base_quantity,
                                          )}
                                          )
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-slate-400 text-[11px] italic">
                                    Chưa nhận
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3">
                                {lineReceipts.length > 0 ? (
                                  <div className="space-y-1">
                                    {lineReceipts.map((rcpt, idx) => (
                                      <Link
                                        key={idx}
                                        href={`/inventory/transactions/${rcpt.transaction_id}?origin=${rcpt.origin_id}`}
                                        className="block text-[11px] text-blue-600 hover:text-blue-800 hover:underline font-mono"
                                        title={`Xem chứng từ nhận kho ${rcpt.receipt_reference}`}
                                      >
                                        {rcpt.receipt_reference} (
                                        {formatDisplayQuantity(
                                          rcpt.purchase_quantity,
                                        )}{" "}
                                        {rcpt.purchase_uom_code})
                                      </Link>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-slate-400 text-[11px]">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <span className="font-mono text-slate-800 block">
                                  {line.unit_cost
                                    ? formatCurrencyAmount(
                                        line.unit_cost,
                                        line.currency_code || "VND",
                                      )
                                    : "—"}
                                </span>
                                <span className="text-slate-400 text-[10px] block">
                                  {[
                                    line.country_of_origin,
                                    line.manufacturer,
                                    line.model,
                                  ]
                                    .filter(Boolean)
                                    .join(" / ") || ""}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                {selectedSource.status !== "voided" ? (
                                  <button
                                    type="button"
                                    className="px-2 py-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded"
                                    onClick={() => setEditLine(line)}
                                  >
                                    Sửa
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="p-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    Hiển thị {lines.length} trên tổng số {linesTotal} dòng
                  </span>
                  <PaginationControls
                    currentPage={currentLinePage}
                    totalItems={linesTotal}
                    onPageChange={(p) =>
                      updateParams({ line_page: p > 1 ? p : undefined })
                    }
                    pageSize={linePageSize}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400 text-xs">
              Vui lòng chọn hoặc tạo một hồ sơ nguồn để xem chi tiết.
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* Modal 1: Create Source */}
      {/* ========================================================================= */}
      {createSourceOpen ? (
        <CreateSourceDialog
          onClose={() => setCreateSourceOpen(false)}
          onCreated={(created) => {
            setSources((prev) => [created, ...prev]);
            setNotice({
              ok: true,
              message: `Tạo hồ sơ nguồn ${created.source_reference} thành công!`,
            });
            setCreateSourceOpen(false);
            updateParams({
              sourceId: created.id,
              line_page: undefined,
              line_q: undefined,
            });
          }}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 2: Edit Source */}
      {/* ========================================================================= */}
      {editSource ? (
        <EditSourceDialog
          source={editSource}
          onClose={() => setEditSource(null)}
          onUpdated={(updated) => {
            setSources((prev) =>
              prev.map((s) => (s.id === updated.id ? updated : s)),
            );
            setNotice({
              ok: true,
              message: `Cập nhật hồ sơ nguồn ${updated.source_reference} thành công!`,
            });
            setEditSource(null);
            router.refresh();
          }}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 3: Void Source (Admin Only) */}
      {/* ========================================================================= */}
      {voidSource ? (
        <ConfirmActionModal
          open={Boolean(voidSource)}
          title="Hủy hồ sơ nguồn / Void Acquisition Source"
          description="Hồ sơ nguồn sẽ chuyển sang trạng thái đã hủy (voided) và không thể tiếp tục nhận hàng. Lưu ý: Thao tác này có biến động tồn kho bằng 0 (Delta = 0) và không làm xóa hay thay đổi các phiếu nhận hàng thực tế đã ghi nhận trước đó."
          targetName={voidSource.source_reference}
          currentRevision={voidSource.revision}
          actionLabel="Xác nhận hủy hồ sơ"
          actionVariant="danger"
          isPending={isPending}
          onConfirm={handleConfirmVoid}
          onClose={() => setVoidSource(null)}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 4: Create Source Line */}
      {/* ========================================================================= */}
      {createLineOpen && selectedSource ? (
        <CreateSourceLineDialog
          sourceId={selectedSource.id}
          sourceRevision={selectedSource.revision}
          onClose={() => setCreateLineOpen(false)}
          onCreated={(createdLine, newSourceRevision) => {
            setLines((prev) => [...prev, createdLine]);
            if (newSourceRevision !== undefined) {
              setSources((prev) =>
                prev.map((s) =>
                  s.id === selectedSource.id
                    ? { ...s, revision: newSourceRevision }
                    : s,
                ),
              );
            }
            setNotice({
              ok: true,
              message: `Đã thêm dòng ${createdLine.line_key} vào hồ sơ`,
            });
            setCreateLineOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 5: Edit Source Line */}
      {/* ========================================================================= */}
      {editLine && selectedSource ? (
        <EditSourceLineDialog
          line={editLine}
          sourceRevision={selectedSource.revision}
          onClose={() => setEditLine(null)}
          onUpdated={(updatedLine, newSourceRevision) => {
            setLines((prev) =>
              prev.map((l) => (l.id === updatedLine.id ? updatedLine : l)),
            );
            if (newSourceRevision !== undefined) {
              setSources((prev) =>
                prev.map((s) =>
                  s.id === selectedSource.id
                    ? { ...s, revision: newSourceRevision }
                    : s,
                ),
              );
            }
            setNotice({
              ok: true,
              message: `Đã cập nhật dòng ${updatedLine.line_key}`,
            });
            setEditLine(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: Create Source
// -----------------------------------------------------------------------------
function CreateSourceDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (source: AcquisitionRecord) => void;
}) {
  const [sourceRef, setSourceRef] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [selectedSupplierLabel, setSelectedSupplierLabel] = useState("");
  const [referenceDate, setReferenceDate] = useState(businessTodayString());
  const [fundingSource, setFundingSource] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceRef.trim() || !supplierId || !referenceDate) {
      setError("Vui lòng điền đủ mã hồ sơ, nhà cung cấp và ngày hồ sơ");
      return;
    }

    startTransition(async () => {
      const res = await createSourceAction({
        source_reference: sourceRef.trim(),
        supplier_id: supplierId,
        reference_date: referenceDate,
        funding_source: fundingSource.trim() || undefined,
        external_reference: externalRef.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      if (res.ok && res.data) {
        onCreated({
          id: res.data.id,
          source_reference: sourceRef.trim().toUpperCase(),
          supplier_id: supplierId,
          reference_date: referenceDate,
          funding_source: fundingSource.trim() || null,
          external_reference: externalRef.trim() || null,
          notes: notes.trim() || null,
          status: "active",
          revision: extractRevision(res.data) ?? 1,
        });
      } else {
        setError(res.error || "Lỗi tạo hồ sơ nguồn");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-source-dialog-title"
    >
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3
            id="create-source-dialog-title"
            className="text-sm font-bold text-slate-900 uppercase tracking-wider"
          >
            Tạo hồ sơ nguồn mới / Create Acquisition Source
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
            onClick={onClose}
            aria-label="Đóng / Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="create-source-ref"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Mã hồ sơ nguồn <span className="text-red-500">*</span>
              </label>
              <input
                id="create-source-ref"
                type="text"
                className="w-full text-xs font-mono uppercase border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                placeholder="VD: HD-2026-001"
                value={sourceRef}
                onChange={(e) => setSourceRef(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                htmlFor="create-source-date"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Ngày hồ sơ <span className="text-red-500">*</span>
              </label>
              <input
                id="create-source-date"
                type="date"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={referenceDate}
                onChange={(e) => setReferenceDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="create-source-supplier"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Nhà cung cấp <span className="text-red-500">*</span>
            </label>
            <InventoryLookup<InventorySupplier>
              resource="suppliers"
              filters={{ active: true }}
              value={supplierId}
              valueKey="id"
              label="Nhà cung cấp"
              id="create-source-supplier"
              selectedLabel={selectedSupplierLabel}
              placeholder="Chọn hoặc tìm kiếm nhà cung cấp…"
              hideLabel={true}
              required={true}
              onSelect={(sup) => {
                setSupplierId(sup.id);
                setSelectedSupplierLabel(sup.name);
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="create-source-funding"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Nguồn kinh phí / Dự án
              </label>
              <input
                id="create-source-funding"
                type="text"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                placeholder="VD: Ngân sách ĐH EIU"
                value={fundingSource}
                onChange={(e) => setFundingSource(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="create-source-external-ref"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Số tham chiếu ngoài (HĐ/HĐĐT)
              </label>
              <input
                id="create-source-external-ref"
                type="text"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                placeholder="VD: INV-789012"
                value={externalRef}
                onChange={(e) => setExternalRef(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="create-source-notes"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Ghi chú
            </label>
            <textarea
              id="create-source-notes"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              rows={2}
              placeholder="Ghi chú chi tiết về hồ sơ..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error ? (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              className="button button-secondary text-xs"
              onClick={onClose}
              disabled={isPending}
            >
              Hủy bỏ / Cancel
            </button>
            <button
              type="submit"
              className="button button-primary text-xs"
              disabled={isPending}
            >
              {isPending ? "Đang lưu..." : "Lưu hồ sơ nguồn"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: Edit Source
// -----------------------------------------------------------------------------
function EditSourceDialog({
  source,
  onClose,
  onUpdated,
}: {
  source: AcquisitionRecord;
  onClose: () => void;
  onUpdated: (source: AcquisitionRecord) => void;
}) {
  const [sourceRef, setSourceRef] = useState(source.source_reference);
  const [supplierId, setSupplierId] = useState(source.supplier_id);
  const [selectedSupplierLabel, setSelectedSupplierLabel] = useState(
    source.supplier_name || "",
  );
  const [referenceDate, setReferenceDate] = useState(source.reference_date);
  const [fundingSource, setFundingSource] = useState(
    source.funding_source || "",
  );
  const [externalRef, setExternalRef] = useState(
    source.external_reference || "",
  );
  const [notes, setNotes] = useState(source.notes || "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    startTransition(async () => {
      const res = await updateSourceAction({
        id: source.id,
        expected_revision: source.revision,
        source_reference: sourceRef.trim(),
        supplier_id: supplierId,
        reference_date: referenceDate,
        funding_source: fundingSource.trim() || undefined,
        external_reference: externalRef.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      if (res.ok && res.data) {
        onUpdated({
          ...source,
          source_reference: sourceRef.trim().toUpperCase(),
          supplier_id: supplierId,
          reference_date: referenceDate,
          funding_source: fundingSource.trim() || null,
          external_reference: externalRef.trim() || null,
          notes: notes.trim() || null,
          revision: extractRevision(res.data) ?? source.revision,
        });
      } else {
        setError(res.error || "Lỗi cập nhật hồ sơ");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-source-dialog-title"
    >
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3
            id="edit-source-dialog-title"
            className="text-sm font-bold text-slate-900 uppercase tracking-wider"
          >
            Sửa hồ sơ nguồn / Edit Source
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
            onClick={onClose}
            aria-label="Đóng / Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="edit-source-ref"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Mã hồ sơ <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-source-ref"
                type="text"
                className="w-full text-xs font-mono uppercase border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={sourceRef}
                onChange={(e) => setSourceRef(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                htmlFor="edit-source-date"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Ngày hồ sơ <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-source-date"
                type="date"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={referenceDate}
                onChange={(e) => setReferenceDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="edit-source-supplier"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Nhà cung cấp <span className="text-red-500">*</span>
            </label>
            <InventoryLookup<InventorySupplier>
              resource="suppliers"
              filters={{ active: true }}
              value={supplierId}
              valueKey="id"
              label="Nhà cung cấp"
              id="edit-source-supplier"
              selectedLabel={selectedSupplierLabel || source.supplier_name}
              placeholder="Chọn hoặc tìm kiếm nhà cung cấp…"
              hideLabel={true}
              required={true}
              onSelect={(sup) => {
                setSupplierId(sup.id);
                setSelectedSupplierLabel(sup.name);
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="edit-source-funding"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Nguồn kinh phí
              </label>
              <input
                id="edit-source-funding"
                type="text"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={fundingSource}
                onChange={(e) => setFundingSource(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="edit-source-external-ref"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Mã tham chiếu ngoài
              </label>
              <input
                id="edit-source-external-ref"
                type="text"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={externalRef}
                onChange={(e) => setExternalRef(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="edit-source-notes"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Ghi chú
            </label>
            <textarea
              id="edit-source-notes"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error ? (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              className="button button-secondary text-xs"
              onClick={onClose}
              disabled={isPending}
            >
              Hủy bỏ / Cancel
            </button>
            <button
              type="submit"
              className="button button-primary text-xs"
              disabled={isPending}
            >
              {isPending ? "Đang lưu..." : "Lưu thay đổi"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: Create Source Line
// -----------------------------------------------------------------------------
function CreateSourceLineDialog({
  sourceId,
  sourceRevision,
  onClose,
  onCreated,
}: {
  sourceId: string;
  sourceRevision: string | number;
  onClose: () => void;
  onCreated: (
    line: AcquisitionRecordLine,
    sourceRevision?: string | number,
  ) => void;
}) {
  const [lineKey, setLineKey] = useState("L1");
  const [catalogItemId, setCatalogItemId] = useState("");
  const [selectedItem, setSelectedItem] = useState<InventoryCatalogItem | null>(
    null,
  );
  const [selectedItemLabel, setSelectedItemLabel] = useState("");
  const [expectedQty, setExpectedQty] = useState("10");
  const [purchaseUomCode, setPurchaseUomCode] = useState("");
  const [selectedPurchaseUomLabel, setSelectedPurchaseUomLabel] = useState("");
  const [expectedFactor, setExpectedFactor] = useState("1");
  const [unitCost, setUnitCost] = useState("");
  const [currencyCode, setCurrencyCode] = useState("VND");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [country, setCountry] = useState("");
  const [warrantyStart, setWarrantyStart] = useState("");
  const [warrantyEnd, setWarrantyEnd] = useState("");
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const qtyVal = validateDecimalString(expectedQty);
    if (!qtyVal.valid || !qtyVal.normalized) {
      setError(`Số lượng dự kiến không hợp lệ: ${qtyVal.error}`);
      return;
    }

    const isCostPresent = unitCost.trim() !== "";
    let validatedCost: string | undefined = undefined;
    let currencyToSend: string | undefined = undefined;

    if (isCostPresent) {
      const cCheck = validateDecimalString(unitCost, 4);
      if (!cCheck.valid || !cCheck.normalized) {
        setError(`Đơn giá không hợp lệ: ${cCheck.error}`);
        return;
      }
      if (cCheck.normalized.startsWith("-")) {
        setError("Đơn giá không được là số âm / Unit cost cannot be negative");
        return;
      }
      validatedCost = cCheck.normalized;
      currencyToSend = currencyCode.trim() || "VND";
    }

    if (warrantyStart && warrantyEnd && warrantyEnd < warrantyStart) {
      setError(
        "Ngày kết thúc bảo hành phải sau hoặc bằng ngày bắt đầu / Warranty end date must be on or after start date",
      );
      return;
    }

    startTransition(async () => {
      const res = await createSourceLineAction({
        acquisition_record_id: sourceId,
        expected_revision: sourceRevision,
        line_key: lineKey.trim(),
        catalog_item_id: catalogItemId,
        expected_purchase_quantity: qtyVal.normalized!,
        purchase_uom_code: purchaseUomCode,
        expected_conversion_factor: expectedFactor.trim() || undefined,
        unit_cost: validatedCost,
        currency_code: currencyToSend,
        manufacturer: manufacturer.trim() || undefined,
        model: model.trim() || undefined,
        country_of_origin: country.trim() || undefined,
        warranty_start: warrantyStart || undefined,
        warranty_end: warrantyEnd || undefined,
        notes: notes.trim() || undefined,
      });

      if (res.ok && res.data) {
        const exactSourceRevision = extractSourceRevision(res.data);

        onCreated(
          {
            id: res.data.id,
            acquisition_record_id: sourceId,
            line_key: lineKey.trim(),
            catalog_item_id: catalogItemId,
            item_code: selectedItem?.code,
            item_name: selectedItem?.name,
            expected_purchase_quantity: qtyVal.normalized!,
            purchase_uom_code: purchaseUomCode,
            expected_conversion_factor: expectedFactor.trim() || null,
            unit_cost: validatedCost ?? null,
            currency_code: currencyToSend ?? null,
            manufacturer: manufacturer.trim() || null,
            model: model.trim() || null,
            country_of_origin: country.trim() || null,
            warranty_start: warrantyStart || null,
            warranty_end: warrantyEnd || null,
            notes: notes.trim() || null,
          },
          exactSourceRevision,
        );
      } else {
        setError(res.error || "Lỗi tạo dòng hồ sơ nguồn");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-source-line-title"
    >
      <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3
            id="create-source-line-title"
            className="text-sm font-bold text-slate-900 uppercase tracking-wider"
          >
            Thêm dòng vật tư cam kết / Add Source Line
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
            onClick={onClose}
            aria-label="Đóng / Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="create-line-key"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Ký hiệu dòng (Line Key) <span className="text-red-500">*</span>
              </label>
              <input
                id="create-line-key"
                type="text"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                placeholder="VD: L1, L2"
                value={lineKey}
                onChange={(e) => setLineKey(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                htmlFor="create-line-item"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Vật tư danh mục <span className="text-red-500">*</span>
              </label>
              <InventoryLookup<InventoryCatalogItem>
                resource="items"
                filters={{ active: true }}
                value={catalogItemId}
                valueKey="id"
                label="Vật tư danh mục"
                id="create-line-item"
                selectedLabel={selectedItemLabel}
                placeholder="Chọn hoặc tìm kiếm vật tư SKU…"
                hideLabel={true}
                required={true}
                onSelect={(it) => {
                  setCatalogItemId(it.id);
                  setSelectedItem(it);
                  setSelectedItemLabel(`${it.name} (${it.code})`);
                  setPurchaseUomCode(it.base_uom_code);
                  setSelectedPurchaseUomLabel(
                    it.base_uom_name
                      ? `${it.base_uom_name} (${it.base_uom_code})`
                      : it.base_uom_code,
                  );
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="create-line-qty"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                SL Đặt/Cam kết <span className="text-red-500">*</span>
              </label>
              <input
                id="create-line-qty"
                type="text"
                inputMode="decimal"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={expectedQty}
                onChange={(e) => setExpectedQty(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                htmlFor="create-line-uom"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                ĐVT Nhập <span className="text-red-500">*</span>
              </label>
              <InventoryLookup<InventoryUom>
                resource="uoms"
                filters={{ active: true }}
                value={purchaseUomCode}
                valueKey="code"
                label="ĐVT Nhập"
                id="create-line-uom"
                selectedLabel={selectedPurchaseUomLabel}
                placeholder="Chọn ĐVT nhập…"
                hideLabel={true}
                required={true}
                onSelect={(uom) => {
                  setPurchaseUomCode(uom.code);
                  setSelectedPurchaseUomLabel(`${uom.name} (${uom.code})`);
                }}
              />
            </div>
            <div>
              <label
                htmlFor="create-line-factor"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Hệ số quy đổi dự kiến
              </label>
              <input
                id="create-line-factor"
                type="text"
                inputMode="decimal"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                placeholder="1"
                value={expectedFactor}
                onChange={(e) => setExpectedFactor(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="create-line-cost"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Đơn giá mua (INV-018)
              </label>
              <input
                id="create-line-cost"
                type="text"
                inputMode="decimal"
                placeholder="VD: 55000"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="create-line-currency"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Loại tiền
              </label>
              <input
                id="create-line-currency"
                type="text"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={currencyCode}
                onChange={(e) => setCurrencyCode(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="create-line-manufacturer"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Hãng sản xuất
              </label>
              <input
                id="create-line-manufacturer"
                type="text"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="create-line-model"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Model
              </label>
              <input
                id="create-line-model"
                type="text"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="create-line-country"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Nước sản xuất
              </label>
              <input
                id="create-line-country"
                type="text"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="create-line-warranty-start"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Bảo hành từ (Warranty Start)
              </label>
              <input
                id="create-line-warranty-start"
                type="date"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={warrantyStart}
                onChange={(e) => setWarrantyStart(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="create-line-warranty-end"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Bảo hành đến (Warranty End)
              </label>
              <input
                id="create-line-warranty-end"
                type="date"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={warrantyEnd}
                onChange={(e) => setWarrantyEnd(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="create-line-notes"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Ghi chú dòng vật tư
            </label>
            <textarea
              id="create-line-notes"
              rows={2}
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              placeholder="Ghi chú quy cách, xuất xứ, điều kiện..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error ? (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              className="button button-secondary text-xs"
              onClick={onClose}
              disabled={isPending}
            >
              Hủy bỏ / Cancel
            </button>
            <button
              type="submit"
              className="button button-primary text-xs"
              disabled={isPending}
            >
              {isPending ? "Đang lưu..." : "Thêm dòng vật tư"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: Edit Source Line
function EditSourceLineDialog({
  line,
  sourceRevision,
  onClose,
  onUpdated,
}: {
  line: AcquisitionRecordLine;
  sourceRevision: string | number;
  onClose: () => void;
  onUpdated: (
    line: AcquisitionRecordLine,
    sourceRevision?: string | number,
  ) => void;
}) {
  const [expectedQty, setExpectedQty] = useState(
    line.expected_purchase_quantity,
  );
  const [purchaseUomCode, setPurchaseUomCode] = useState(
    line.purchase_uom_code,
  );
  const [selectedPurchaseUomLabel, setSelectedPurchaseUomLabel] = useState(
    line.purchase_uom_name || line.purchase_uom_code,
  );
  const [expectedFactor, setExpectedFactor] = useState(
    line.expected_conversion_factor || "",
  );
  const [unitCost, setUnitCost] = useState(line.unit_cost || "");
  const [currencyCode, setCurrencyCode] = useState(line.currency_code || "VND");
  const [manufacturer, setManufacturer] = useState(line.manufacturer || "");
  const [model, setModel] = useState(line.model || "");
  const [country, setCountry] = useState(line.country_of_origin || "");

  const [warrantyStart, setWarrantyStart] = useState(
    line.warranty_start ? line.warranty_start.slice(0, 10) : "",
  );
  const [warrantyEnd, setWarrantyEnd] = useState(
    line.warranty_end ? line.warranty_end.slice(0, 10) : "",
  );
  const [notes, setNotes] = useState(line.notes || "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const qtyVal = validateDecimalString(expectedQty);
    if (!qtyVal.valid || !qtyVal.normalized) {
      setError(`Số lượng dự kiến không hợp lệ: ${qtyVal.error}`);
      return;
    }

    const isCostPresent = unitCost.trim() !== "";
    let validatedCost: string | undefined = undefined;
    let currencyToSend: string | undefined = undefined;

    if (isCostPresent) {
      const cCheck = validateDecimalString(unitCost, 4);
      if (!cCheck.valid || !cCheck.normalized) {
        setError(`Đơn giá không hợp lệ: ${cCheck.error}`);
        return;
      }
      if (cCheck.normalized.startsWith("-")) {
        setError("Đơn giá không được là số âm / Unit cost cannot be negative");
        return;
      }
      validatedCost = cCheck.normalized;
      currencyToSend = currencyCode.trim() || "VND";
    }

    if (warrantyStart && warrantyEnd && warrantyEnd < warrantyStart) {
      setError(
        "Ngày kết thúc bảo hành phải sau hoặc bằng ngày bắt đầu / Warranty end date must be on or after start date",
      );
      return;
    }

    startTransition(async () => {
      const res = await updateSourceLineAction({
        id: line.id,
        acquisition_record_id: line.acquisition_record_id,
        expected_revision: sourceRevision,
        expected_purchase_quantity: qtyVal.normalized!,
        purchase_uom_code: purchaseUomCode,
        expected_conversion_factor: expectedFactor.trim() || undefined,
        unit_cost: validatedCost,
        currency_code: currencyToSend,
        manufacturer: manufacturer.trim() || undefined,
        model: model.trim() || undefined,
        country_of_origin: country.trim() || undefined,
        warranty_start: warrantyStart || undefined,
        warranty_end: warrantyEnd || undefined,
        notes: notes.trim() || undefined,
      });

      if (res.ok && res.data) {
        const exactSourceRevision = extractSourceRevision(res.data);

        onUpdated(
          {
            ...line,
            expected_purchase_quantity: qtyVal.normalized!,
            purchase_uom_code: purchaseUomCode,
            expected_conversion_factor: expectedFactor.trim() || null,
            unit_cost: validatedCost ?? null,
            currency_code: currencyToSend ?? null,
            manufacturer: manufacturer.trim() || null,
            model: model.trim() || null,
            country_of_origin: country.trim() || null,
            warranty_start: warrantyStart || null,
            warranty_end: warrantyEnd || null,
            notes: notes.trim() || null,
          },
          exactSourceRevision,
        );
      } else {
        setError(res.error || "Lỗi cập nhật dòng hồ sơ");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-source-line-title"
    >
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3
            id="edit-source-line-title"
            className="text-sm font-bold text-slate-900 uppercase tracking-wider"
          >
            Sửa dòng vật tư / Edit Line ({line.line_key})
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
            onClick={onClose}
            aria-label="Đóng / Close"
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="edit-line-qty"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                SL Đặt/Cam kết <span className="text-red-500">*</span>
              </label>
              <input
                id="edit-line-qty"
                type="text"
                inputMode="decimal"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={expectedQty}
                onChange={(e) => setExpectedQty(e.target.value)}
                required
              />
            </div>
            <div>
              <label
                htmlFor="edit-line-uom"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                ĐVT Nhập <span className="text-red-500">*</span>
              </label>
              <InventoryLookup<InventoryUom>
                resource="uoms"
                filters={{ active: true }}
                value={purchaseUomCode}
                valueKey="code"
                label="ĐVT Nhập"
                id="edit-line-uom"
                selectedLabel={selectedPurchaseUomLabel}
                placeholder="Chọn ĐVT nhập…"
                hideLabel={true}
                required={true}
                onSelect={(uom) => {
                  setPurchaseUomCode(uom.code);
                  setSelectedPurchaseUomLabel(`${uom.name} (${uom.code})`);
                }}
              />
            </div>
            <div>
              <label
                htmlFor="edit-line-factor"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Hệ số quy đổi
              </label>
              <input
                id="edit-line-factor"
                type="text"
                inputMode="decimal"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={expectedFactor}
                onChange={(e) => setExpectedFactor(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="edit-line-cost"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Đơn giá mua (INV-018)
              </label>
              <input
                id="edit-line-cost"
                type="text"
                inputMode="decimal"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="edit-line-currency"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Loại tiền
              </label>
              <input
                id="edit-line-currency"
                type="text"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={currencyCode}
                onChange={(e) => setCurrencyCode(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="edit-line-manufacturer"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Hãng sản xuất
              </label>
              <input
                id="edit-line-manufacturer"
                type="text"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="edit-line-model"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Model
              </label>
              <input
                id="edit-line-model"
                type="text"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="edit-line-country"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Nước sản xuất
              </label>
              <input
                id="edit-line-country"
                type="text"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="edit-line-warranty-start"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Bảo hành từ (Warranty Start)
              </label>
              <input
                id="edit-line-warranty-start"
                type="date"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={warrantyStart}
                onChange={(e) => setWarrantyStart(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="edit-line-warranty-end"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Bảo hành đến (Warranty End)
              </label>
              <input
                id="edit-line-warranty-end"
                type="date"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                value={warrantyEnd}
                onChange={(e) => setWarrantyEnd(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="edit-line-notes"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Ghi chú dòng vật tư
            </label>
            <textarea
              id="edit-line-notes"
              rows={2}
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              placeholder="Ghi chú quy cách, xuất xứ, điều kiện..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error ? (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              className="button button-secondary text-xs"
              onClick={onClose}
              disabled={isPending}
            >
              Hủy bỏ / Cancel
            </button>
            <button
              type="submit"
              className="button button-primary text-xs"
              disabled={isPending}
            >
              {isPending ? "Đang lưu..." : "Lưu thay đổi"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
