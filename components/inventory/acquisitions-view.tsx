"use client";

import React, { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, X } from "@/components/icons";
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
  isPositive,
  validateDecimalString,
} from "@/lib/inventory/decimal";
import { formatInventoryDate } from "@/lib/inventory/dates";
import { businessTodayString } from "@/lib/business-time";
import { ConfirmActionModal } from "./confirm-action-modal";
import { RecordDrawer } from "./record-drawer";
import { PaginationControls } from "@/components/pagination-controls";
import { InventoryLookup } from "./inventory-lookup";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type {
  AcquisitionRecord,
  AcquisitionRecordLine,
  AcquisitionSourceKind,
  InventoryCatalogItem,
  InventorySourceReceipt,
  InventorySupplier,
  InventoryUom,
} from "@/lib/inventory/types";
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

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
  const { text: uiText } = useLanguage();

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

  function openSource(id: string) {
    updateParams({ sourceId: id, line_page: undefined, line_q: undefined });
  }

  const closeSource = useCallback(
    () =>
      updateParams({
        sourceId: undefined,
        line_page: undefined,
        line_q: undefined,
      }),
    [updateParams],
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
          <span>
            <LocalizedText text={notice.message ?? ""} />
          </span>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 p-1"
            onClick={() => setNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      <form className="list-filters" onSubmit={handleSourceSearchSubmit}>
        <label>
          {uiText("Tìm kiếm")}
          <input
            id="acquisitions-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={uiText("Mã hồ sơ hoặc nhà cung cấp")}
          />
        </label>
        <div className="list-filters-field">
          <span>{uiText("Nhà cung cấp")}</span>
          <InventoryLookup<InventorySupplier>
            resource="suppliers"
            filters={{ active: true }}
            value={supplierFilter}
            valueKey="id"
            label={uiText("Nhà cung cấp")}
            id="acquisitions-supplier-filter"
            selectedLabel={selectedSupplierFilterLabel}
            placeholder={uiText("Tất cả nhà cung cấp")}
            hideLabel
            onSelect={(sup) => {
              setSupplierFilter(sup.id);
              setSelectedSupplierFilterLabel(sup.name);
              updateParams({ supplier_id: sup.id, page: undefined });
            }}
          />
        </div>
        <label>
          {uiText("Trạng thái")}
          <select
            id="acquisitions-status-filter"
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
          >
            <option value="all">{uiText("Tất cả")}</option>
            <option value="active">{uiText("Hiệu lực")}</option>
            <option value="voided">{uiText("Đã hủy")}</option>
          </select>
        </label>
        <div className="list-filters-actions">
          <button type="submit" className="button button-primary">
            {uiText("Lọc")}
          </button>
          {search || supplierFilter || statusFilter !== "all" ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setSupplierFilter("");
                setSelectedSupplierFilterLabel("");
                updateParams({
                  q: undefined,
                  supplier_id: undefined,
                  status: undefined,
                  page: undefined,
                });
              }}
            >
              {uiText("Xóa bộ lọc")}
            </button>
          ) : null}
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setCreateSourceOpen(true)}
          >
            <Plus size={16} />
            {uiText("Tạo hồ sơ")}
          </button>
          <span className="inline-toolbar-count">
            {uiText("{0} hồ sơ", [sourcesTotal])}
          </span>
        </div>
      </form>

      {sources.length === 0 ? (
        <p className="panel-empty">
          {uiText("Chưa có hồ sơ nguồn nào phù hợp.")}
        </p>
      ) : (
        <div className="data-panel">
          <div className="responsive-table">
            <table className="data-table records-on-phone">
              <thead>
                <tr>
                  <th>{uiText("Mã hồ sơ")}</th>
                  <th>{uiText("Nhà cung cấp")}</th>
                  <th>{uiText("Ngày hồ sơ")}</th>
                  <th>{uiText("Nguồn kinh phí")}</th>
                  <th>{uiText("Trạng thái")}</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr
                    key={source.id}
                    className="row-link"
                    aria-selected={source.id === selectedSourceId}
                    onClick={() => openSource(source.id)}
                  >
                    <td data-label={uiText("Mã hồ sơ")}>
                      <button
                        type="button"
                        className="link-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openSource(source.id);
                        }}
                      >
                        {source.source_reference}
                      </button>
                    </td>
                    <td data-label={uiText("Nhà cung cấp")}>
                      {sourceSupplierLabel(source, uiText)}
                    </td>
                    <td data-label={uiText("Ngày hồ sơ")}>
                      {formatInventoryDate(source.reference_date)}
                    </td>
                    <td data-label={uiText("Nguồn kinh phí")}>
                      {source.funding_source || "—"}
                    </td>
                    <td data-label={uiText("Trạng thái")}>
                      <SourceStatus status={source.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <PaginationControls
        currentPage={currentSourcePage}
        totalItems={sourcesTotal}
        onPageChange={(p) => updateParams({ page: p > 1 ? p : undefined })}
        pageSize={sourcePageSize}
      />

      {selectedSource ? (
        <RecordDrawer
          title={selectedSource.source_reference}
          subtitle={sourceSupplierLabel(selectedSource, uiText)}
          onClose={closeSource}
          actions={
            selectedSource.status !== "voided" ? (
              <>
                <Link
                  href={`/inventory/receive?sourceId=${selectedSource.id}`}
                  className="button button-primary"
                >
                  {uiText("Nhận hàng")}
                </Link>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setEditSource(selectedSource)}
                >
                  {uiText("Sửa")}
                </button>
                {isAdmin ? (
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => setVoidSource(selectedSource)}
                  >
                    {uiText("Hủy hồ sơ")}
                  </button>
                ) : null}
              </>
            ) : null
          }
        >
          <dl className="detail-list">
            <div>
              <dt>{uiText("Trạng thái")}</dt>
              <dd>
                <SourceStatus status={selectedSource.status} />
              </dd>
            </div>
            <div>
              <dt>{uiText("Ngày hồ sơ")}</dt>
              <dd>{formatInventoryDate(selectedSource.reference_date)}</dd>
            </div>
            <div>
              <dt>{uiText("Nguồn kinh phí")}</dt>
              <dd>{selectedSource.funding_source || "—"}</dd>
            </div>
            <div>
              <dt>{uiText("Mã tham chiếu ngoài")}</dt>
              <dd>{selectedSource.external_reference || "—"}</dd>
            </div>
            {selectedSource.notes ? (
              <div>
                <dt>{uiText("Ghi chú")}</dt>
                <dd>{selectedSource.notes}</dd>
              </div>
            ) : null}
          </dl>
          <p className="field-note">
            {uiText(
              "Hồ sơ đã có hàng nhận vào kho thì không sửa số lượng được; mọi thay đổi được ghi lịch sử.",
            )}
          </p>

          <h3>{uiText("Các dòng cam kết ({0})", [linesTotal])}</h3>
          <form className="drawer-search" onSubmit={handleLineSearchSubmit}>
            <input
              id="search-source-lines"
              aria-label={uiText("Tìm dòng vật tư")}
              placeholder={uiText("Mã hoặc tên vật tư")}
              value={lineSearch}
              onChange={(e) => setLineSearch(e.target.value)}
            />
            <button type="submit" className="button button-secondary">
              {uiText("Tìm")}
            </button>
            {selectedSource.status !== "voided" ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setCreateLineOpen(true)}
              >
                <Plus size={16} />
                {uiText("Thêm dòng")}
              </button>
            ) : null}
          </form>
          {lines.length === 0 ? (
            <p className="panel-empty">
              {uiText("Hồ sơ này chưa có dòng vật tư cam kết nào.")}
            </p>
          ) : (
            lines.map((line) => (
              <SourceLineFacts
                key={line.id}
                line={line}
                receipts={receipts.filter((r) => r.source_line_id === line.id)}
                onEdit={
                  selectedSource.status !== "voided"
                    ? () => setEditLine(line)
                    : undefined
                }
              />
            ))
          )}
          {linesTotal > linePageSize ? (
            <PaginationControls
              currentPage={currentLinePage}
              totalItems={linesTotal}
              onPageChange={(p) =>
                updateParams({ line_page: p > 1 ? p : undefined })
              }
              pageSize={linePageSize}
            />
          ) : null}
        </RecordDrawer>
      ) : null}

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
          title={uiText("Hủy hồ sơ nguồn")}
          description={uiText(
            "Hồ sơ nguồn sẽ chuyển sang trạng thái đã hủy (voided) và không thể tiếp tục nhận hàng. Lưu ý: Thao tác này có biến động tồn kho bằng 0 (Delta = 0) và không làm xóa hay thay đổi các phiếu nhận hàng thực tế đã ghi nhận trước đó.",
          )}
          targetName={voidSource.source_reference}
          currentRevision={voidSource.revision}
          actionLabel={uiText("Xác nhận hủy hồ sơ")}
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
  const { text: uiText } = useLanguage();

  const [sourceRef, setSourceRef] = useState("");
  const [sourceKind, setSourceKind] =
    useState<AcquisitionSourceKind>("purchase");
  const isDonation = sourceKind === "donation";
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
    if (!sourceRef.trim() || (!supplierId && !isDonation) || !referenceDate) {
      setError("Vui lòng điền đủ mã hồ sơ, nhà cung cấp và ngày hồ sơ");
      return;
    }
    if (isDonation && !notes.trim()) {
      setError("Hàng tặng cần ghi rõ nguồn gốc (ai tặng, khi nào)");
      return;
    }

    startTransition(async () => {
      const res = await createSourceAction({
        source_reference: sourceRef.trim(),
        source_kind: sourceKind,
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
          source_kind: sourceKind,
          supplier_id: supplierId || null,
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
            {uiText("Tạo hồ sơ nguồn mới")}
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
            onClick={onClose}
            aria-label={uiText("Đóng")}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div
            className="segmented-control"
            role="radiogroup"
            aria-label={uiText("Loại hồ sơ nguồn")}
          >
            {(
              [
                ["purchase", "Hợp đồng / Hóa đơn"],
                ["donation", "Tặng / Không chứng từ"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={sourceKind === kind}
                className={sourceKind === kind ? "selected" : ""}
                onClick={() => setSourceKind(kind)}
              >
                {uiText(label)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="create-source-ref"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {uiText("Mã hồ sơ nguồn ")}
                <span className="text-red-500">*</span>
              </label>
              <input
                id="create-source-ref"
                type="text"
                className="w-full text-xs font-mono uppercase border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                placeholder={uiText("VD: HD-2026-001")}
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
                {uiText("Ngày hồ sơ ")}
                <span className="text-red-500">*</span>
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
              {isDonation
                ? uiText("Nhà cung cấp / người tặng (tùy chọn)")
                : uiText("Nhà cung cấp *")}
            </label>
            <InventoryLookup<InventorySupplier>
              resource="suppliers"
              filters={{ active: true }}
              value={supplierId}
              valueKey="id"
              label={uiText("Nhà cung cấp")}
              id="create-source-supplier"
              selectedLabel={selectedSupplierLabel}
              placeholder={uiText("Chọn hoặc tìm kiếm nhà cung cấp…")}
              hideLabel={true}
              required={!isDonation}
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
                {uiText("Nguồn kinh phí / Dự án")}
              </label>
              <input
                id="create-source-funding"
                type="text"
                className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                placeholder={uiText("VD: Ngân sách ĐH EIU")}
                value={fundingSource}
                onChange={(e) => setFundingSource(e.target.value)}
              />
            </div>
            <div>
              <label
                htmlFor="create-source-external-ref"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {uiText("Số tham chiếu ngoài (HĐ/HĐĐT)")}
              </label>
              <input
                id="create-source-external-ref"
                type="text"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                placeholder={uiText("VD: INV-789012")}
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
              {isDonation ? uiText("Nguồn gốc hàng tặng *") : uiText("Ghi chú")}
            </label>
            <textarea
              id="create-source-notes"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              rows={2}
              required={isDonation}
              placeholder={
                isDonation
                  ? uiText("Ai tặng, khi nào, kèm giấy tờ gì (nếu có)")
                  : uiText("Ghi chú chi tiết về hồ sơ...")
              }
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error ? (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              <LocalizedText text={error ?? ""} />
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              className="button button-secondary text-xs"
              onClick={onClose}
              disabled={isPending}
            >
              {uiText("Hủy bỏ")}
            </button>
            <button
              type="submit"
              className="button button-primary text-xs"
              disabled={isPending}
            >
              {isPending ? uiText("Đang lưu...") : uiText("Lưu hồ sơ nguồn")}
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
  const { text: uiText } = useLanguage();

  const [sourceRef, setSourceRef] = useState(source.source_reference);
  const [supplierId, setSupplierId] = useState(source.supplier_id ?? "");
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
            {uiText("Sửa hồ sơ nguồn")}
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
            onClick={onClose}
            aria-label={uiText("Đóng")}
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
                {uiText("Mã hồ sơ ")}
                <span className="text-red-500">*</span>
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
                {uiText("Ngày hồ sơ ")}
                <span className="text-red-500">*</span>
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
              {uiText("Nhà cung cấp ")}
              <span className="text-red-500">*</span>
            </label>
            <InventoryLookup<InventorySupplier>
              resource="suppliers"
              filters={{ active: true }}
              value={supplierId}
              valueKey="id"
              label={uiText("Nhà cung cấp")}
              id="edit-source-supplier"
              selectedLabel={selectedSupplierLabel || source.supplier_name}
              placeholder={uiText("Chọn hoặc tìm kiếm nhà cung cấp…")}
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
                {uiText("Nguồn kinh phí")}
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
                {uiText("Mã tham chiếu ngoài")}
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
              {uiText("Ghi chú")}
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
              <LocalizedText text={error ?? ""} />
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              className="button button-secondary text-xs"
              onClick={onClose}
              disabled={isPending}
            >
              {uiText("Hủy bỏ")}
            </button>
            <button
              type="submit"
              className="button button-primary text-xs"
              disabled={isPending}
            >
              {isPending ? uiText("Đang lưu...") : uiText("Lưu thay đổi")}
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
  const { text: uiText } = useLanguage();

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
        setError("Đơn giá không được là số âm");
        return;
      }
      validatedCost = cCheck.normalized;
      currencyToSend = currencyCode.trim() || "VND";
    }

    if (warrantyStart && warrantyEnd && warrantyEnd < warrantyStart) {
      setError("Ngày kết thúc bảo hành phải sau hoặc bằng ngày bắt đầu");
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
            {uiText("Thêm dòng vật tư cam kết")}
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
            onClick={onClose}
            aria-label={uiText("Đóng")}
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
                {uiText("Ký hiệu dòng (Line Key) ")}
                <span className="text-red-500">*</span>
              </label>
              <input
                id="create-line-key"
                type="text"
                className="w-full text-xs font-mono border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
                placeholder={uiText("VD: L1, L2")}
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
                {uiText("Vật tư danh mục ")}
                <span className="text-red-500">*</span>
              </label>
              <InventoryLookup<InventoryCatalogItem>
                resource="items"
                filters={{ active: true }}
                value={catalogItemId}
                valueKey="id"
                label={uiText("Vật tư danh mục")}
                id="create-line-item"
                selectedLabel={selectedItemLabel}
                placeholder={uiText("Chọn hoặc tìm kiếm vật tư SKU…")}
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
                {uiText("SL Đặt/Cam kết ")}
                <span className="text-red-500">*</span>
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
                {uiText("ĐVT Nhập ")}
                <span className="text-red-500">*</span>
              </label>
              <InventoryLookup<InventoryUom>
                resource="uoms"
                filters={{ active: true }}
                value={purchaseUomCode}
                valueKey="code"
                label={uiText("ĐVT Nhập")}
                id="create-line-uom"
                selectedLabel={selectedPurchaseUomLabel}
                placeholder={uiText("Chọn ĐVT nhập…")}
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
                {uiText("Hệ số quy đổi dự kiến")}
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
                {uiText("Đơn giá mua (INV-018)")}
              </label>
              <input
                id="create-line-cost"
                type="text"
                inputMode="decimal"
                placeholder={uiText("VD: 55000")}
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
                {uiText("Loại tiền")}
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
                {uiText("Hãng sản xuất")}
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
                {uiText("Model")}
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
                {uiText("Nước sản xuất")}
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
                {uiText("Bảo hành từ (Warranty Start)")}
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
                {uiText("Bảo hành đến (Warranty End)")}
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
              {uiText("Ghi chú dòng vật tư")}
            </label>
            <textarea
              id="create-line-notes"
              rows={2}
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              placeholder={uiText("Ghi chú quy cách, xuất xứ, điều kiện...")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error ? (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              <LocalizedText text={error ?? ""} />
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              className="button button-secondary text-xs"
              onClick={onClose}
              disabled={isPending}
            >
              {uiText("Hủy bỏ")}
            </button>
            <button
              type="submit"
              className="button button-primary text-xs"
              disabled={isPending}
            >
              {isPending ? uiText("Đang lưu...") : uiText("Thêm dòng vật tư")}
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
  const { text: uiText } = useLanguage();

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
        setError("Đơn giá không được là số âm");
        return;
      }
      validatedCost = cCheck.normalized;
      currencyToSend = currencyCode.trim() || "VND";
    }

    if (warrantyStart && warrantyEnd && warrantyEnd < warrantyStart) {
      setError("Ngày kết thúc bảo hành phải sau hoặc bằng ngày bắt đầu");
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
            {uiText("Sửa dòng vật tư")}
            {line.line_key})
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1"
            onClick={onClose}
            aria-label={uiText("Đóng")}
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
                {uiText("SL Đặt/Cam kết ")}
                <span className="text-red-500">*</span>
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
                {uiText("ĐVT Nhập ")}
                <span className="text-red-500">*</span>
              </label>
              <InventoryLookup<InventoryUom>
                resource="uoms"
                filters={{ active: true }}
                value={purchaseUomCode}
                valueKey="code"
                label={uiText("ĐVT Nhập")}
                id="edit-line-uom"
                selectedLabel={selectedPurchaseUomLabel}
                placeholder={uiText("Chọn ĐVT nhập…")}
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
                {uiText("Hệ số quy đổi")}
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
                {uiText("Đơn giá mua (INV-018)")}
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
                {uiText("Loại tiền")}
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
                {uiText("Hãng sản xuất")}
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
                {uiText("Model")}
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
                {uiText("Nước sản xuất")}
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
                {uiText("Bảo hành từ (Warranty Start)")}
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
                {uiText("Bảo hành đến (Warranty End)")}
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
              {uiText("Ghi chú dòng vật tư")}
            </label>
            <textarea
              id="edit-line-notes"
              rows={2}
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-blue-500"
              placeholder={uiText("Ghi chú quy cách, xuất xứ, điều kiện...")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error ? (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
              <LocalizedText text={error ?? ""} />
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              className="button button-secondary text-xs"
              onClick={onClose}
              disabled={isPending}
            >
              {uiText("Hủy bỏ")}
            </button>
            <button
              type="submit"
              className="button button-primary text-xs"
              disabled={isPending}
            >
              {isPending ? uiText("Đang lưu...") : uiText("Lưu thay đổi")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SourceStatus({ status }: { status: string }) {
  const { text } = useLanguage();
  return status === "voided" ? (
    <span className="badge" data-tone="neutral">
      {text("Đã hủy")}
    </span>
  ) : (
    <span className="badge" data-tone="success">
      {text("Hiệu lực")}
    </span>
  );
}

/** One committed line, shown as a labelled record inside the drawer. */
function SourceLineFacts({
  line,
  receipts,
  onEdit,
}: {
  line: AcquisitionRecordLine;
  receipts: InventorySourceReceipt[];
  onEdit?: () => void;
}) {
  const { text } = useLanguage();
  const hasFactor = Boolean(line.expected_conversion_factor);
  const discrepancy =
    hasFactor && line.base_discrepancy != null
      ? Number(line.base_discrepancy)
      : null;
  return (
    <dl className="detail-list">
      <div>
        <dt>{text("Dòng {0}", [line.line_key])}</dt>
        <dd>
          <span className="cell-stack">
            <strong>{line.item_name ?? line.catalog_item_name}</strong>
            <small>{line.item_code ?? line.catalog_item_code}</small>
          </span>
        </dd>
      </div>
      <div>
        <dt>{text("Cam kết")}</dt>
        <dd>
          {formatDisplayQuantity(line.expected_purchase_quantity)}{" "}
          {line.purchase_uom_name || line.purchase_uom_code}
          {hasFactor
            ? ` × ${formatDisplayQuantity(line.expected_conversion_factor!)}`
            : ""}
        </dd>
      </div>
      <div>
        <dt>{text("Đã nhận / dự kiến")}</dt>
        <dd>
          {formatDisplayQuantity(line.actual_base_quantity || "0")} /{" "}
          {line.expected_base_quantity
            ? formatDisplayQuantity(line.expected_base_quantity)
            : "—"}{" "}
          {!isPositive(line.actual_base_quantity || "0") ? (
            <span className="badge" data-tone="neutral">
              {text("Chưa nhận")}
            </span>
          ) : discrepancy !== null && discrepancy !== 0 ? (
            <span className="badge" data-tone="warning">
              {text("Lệch {0}", [
                `${discrepancy > 0 ? "+" : ""}${formatDisplayQuantity(line.base_discrepancy!)}`,
              ])}
            </span>
          ) : null}
        </dd>
      </div>
      {receipts.length ? (
        <div>
          <dt>{text("Phiếu nhận")}</dt>
          <dd className="cell-stack">
            {receipts.map((rcpt) => (
              <Link
                key={`${rcpt.transaction_id}-${rcpt.origin_id}`}
                href={`/inventory/transactions/${rcpt.transaction_id}?origin=${rcpt.origin_id}`}
              >
                {rcpt.receipt_reference} (
                {formatDisplayQuantity(rcpt.purchase_quantity)}{" "}
                {rcpt.purchase_uom_code})
              </Link>
            ))}
          </dd>
        </div>
      ) : null}
      {line.unit_cost ? (
        <div>
          <dt>{text("Đơn giá")}</dt>
          <dd>
            {formatCurrencyAmount(line.unit_cost, line.currency_code || "VND")}
          </dd>
        </div>
      ) : null}
      {onEdit ? (
        <div>
          <dt />
          <dd>
            <button type="button" className="link-button" onClick={onEdit}>
              {text("Sửa dòng")}
            </button>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

function sourceSupplierLabel(
  source: AcquisitionRecord,
  uiText: (key: string) => string,
) {
  if (source.supplier_name) return source.supplier_name;
  return source.source_kind === "donation"
    ? uiText("Tặng / Không chứng từ")
    : uiText("Nhà cung cấp chưa đặt tên");
}
