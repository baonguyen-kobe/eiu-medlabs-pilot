"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { ClipboardList, History, X } from "@/components/icons";
import { readInventoryOptions } from "@/app/inventory/read-actions";
import { formatInventoryDateTime } from "@/lib/inventory/dates";
import { formatDisplayQuantity } from "@/lib/inventory/decimal";
import { PaginationControls } from "@/components/pagination-controls";
import type { InventoryStockEvidence } from "@/lib/inventory/types";

const EVIDENCE_PAGE_SIZE = 10;

export interface StockEvidenceModalProps {
  originId: string;
  itemCode?: string;
  itemName?: string;
  open: boolean;
  onClose: () => void;
}

function StockEvidenceModalContent({
  originId,
  itemCode,
  itemName,
  onClose,
}: {
  originId: string;
  itemCode?: string;
  itemName?: string;
  onClose: () => void;
}) {
  const [evidenceList, setEvidenceList] = useState<InventoryStockEvidence[]>(
    [],
  );
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Focus management and Escape key handling
  useEffect(() => {
    previousActiveElementRef.current =
      document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousActiveElementRef.current?.focus();
    };
  }, [onClose]);

  // Load bounded evidence on origin or page change
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await readInventoryOptions<InventoryStockEvidence>(
          "stock_evidence",
          {
            origin_id: originId,
            page,
            page_size: EVIDENCE_PAGE_SIZE,
          },
        );
        if (cancelled) return;
        setEvidenceList(res.rows);
        setTotalItems(res.total);
        setError(null);
      } catch (err: unknown) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Không tải được lịch sử bằng chứng / Failed to load evidence",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [originId, page]);

  function handlePageChange(newPage: number) {
    setPage(newPage);
    setIsLoading(true);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stock-evidence-title"
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardList className="text-purple-600" size={20} />
            <div>
              <h3
                id="stock-evidence-title"
                className="text-base font-bold text-slate-900"
              >
                Nhật ký Bằng chứng Bất biến / Stock Evidence History
              </h3>
              {itemCode || itemName ? (
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  {itemCode} - {itemName} | Lô: {originId.slice(0, 8)}...
                </p>
              ) : (
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Lô nguồn: {originId}
                </p>
              )}
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            aria-label="Đóng"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content list */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {isLoading ? (
            <div className="text-center py-10 text-xs text-purple-600 font-medium animate-pulse flex items-center justify-center gap-2">
              <History size={16} className="animate-spin" />
              <span>Đang tải lịch sử bằng chứng...</span>
            </div>
          ) : error ? (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl">
              {error}
            </div>
          ) : evidenceList.length === 0 ? (
            <div className="text-center py-12 text-xs text-slate-400">
              Chưa có bản ghi bằng chứng kiểm kê hay thẩm định nào cho lô này.
            </div>
          ) : (
            evidenceList.map((item) => {
              const meta = item.metadata || {};
              const actionLabel =
                item.action === "STOCKTAKE_COUNT_ADJUST"
                  ? "Đối chiếu kiểm kê / COUNT"
                  : item.action === "SURPLUS_RECORDED"
                    ? "Ghi nhận hàng thừa / SURPLUS"
                    : item.action === "SURPLUS_VERIFIED_RELEASED"
                      ? "Thẩm định giải tỏa / RELEASE"
                      : item.action === "EVIDENCE_APPENDED"
                        ? "Bổ sung bằng chứng / APPEND"
                        : item.action;

              const badgeColor =
                item.action === "SURPLUS_VERIFIED_RELEASED"
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : item.action === "SURPLUS_RECORDED"
                    ? "bg-purple-50 text-purple-800 border-purple-200"
                    : item.action === "STOCKTAKE_COUNT_ADJUST"
                      ? "bg-sky-50 text-sky-800 border-sky-200"
                      : "bg-slate-50 text-slate-700 border-slate-200";

              return (
                <div
                  key={item.id}
                  className="p-3.5 bg-slate-50/80 rounded-xl border border-slate-200 text-xs space-y-2 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`badge inline-flex items-center text-[11px] font-semibold ${badgeColor}`}
                      >
                        {actionLabel}
                      </span>
                      <span
                        className="font-semibold text-slate-800 font-mono"
                        title={`Mã người thực hiện: ${item.actor_id}`}
                      >
                        {item.actor_name || item.actor_id}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {formatInventoryDateTime(item.created_at)}
                    </span>
                  </div>

                  <p className="text-slate-800 font-medium whitespace-pre-wrap leading-relaxed">
                    {item.note}
                  </p>

                  {/* Metadata display if count/reconciliation/verification details exist */}
                  {Object.keys(meta).length > 0 && (
                    <div className="pt-2 border-t border-slate-200/60 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                      {meta.stocktake_reference ? (
                        <div>
                          <span className="text-slate-400 block">
                            Đợt kiểm kê:
                          </span>
                          <span className="font-mono font-semibold text-slate-700">
                            {String(meta.stocktake_reference)}
                          </span>
                        </div>
                      ) : null}
                      {meta.count_timestamp ? (
                        <div>
                          <span className="text-slate-400 block">
                            Thời điểm kiểm đếm:
                          </span>
                          <span className="font-mono text-slate-700">
                            {formatInventoryDateTime(
                              String(meta.count_timestamp),
                            )}
                          </span>
                        </div>
                      ) : null}
                      {meta.location_id || meta.location_code ? (
                        <div>
                          <span className="text-slate-400 block">
                            Vị trí kho:
                          </span>
                          <span className="font-mono text-slate-700">
                            {String(meta.location_code || meta.location_id)}
                          </span>
                        </div>
                      ) : null}
                      {meta.condition ? (
                        <div>
                          <span className="text-slate-400 block">
                            Tình trạng:
                          </span>
                          <span className="font-semibold text-slate-700">
                            {meta.condition === "good"
                              ? "Hàng tốt / Good"
                              : "Hàng hỏng / Damaged"}
                          </span>
                        </div>
                      ) : null}
                      {meta.expected_quantity !== undefined ? (
                        <div>
                          <span className="text-slate-400 block">
                            Tồn sổ sách:
                          </span>
                          <span className="font-mono font-semibold text-slate-700">
                            {formatDisplayQuantity(
                              String(meta.expected_quantity),
                            )}
                          </span>
                        </div>
                      ) : null}
                      {meta.counted_quantity !== undefined ? (
                        <div>
                          <span className="text-slate-400 block">
                            Thực tế đếm:
                          </span>
                          <span className="font-mono font-semibold text-slate-700">
                            {formatDisplayQuantity(
                              String(meta.counted_quantity),
                            )}
                          </span>
                        </div>
                      ) : null}
                      {meta.delta !== undefined ? (
                        <div>
                          <span className="text-slate-400 block">
                            Chênh lệch:
                          </span>
                          <span className="font-mono font-bold text-slate-900">
                            {formatDisplayQuantity(String(meta.delta))}
                          </span>
                        </div>
                      ) : null}
                      {meta.expected_version !== undefined ||
                      meta.expected_stock_revision !== undefined ? (
                        <div>
                          <span className="text-slate-400 block">
                            Phiên bản đối chiếu:
                          </span>
                          <span className="font-mono text-slate-700">
                            v{String(meta.expected_version ?? "—")} | r
                            {String(meta.expected_stock_revision ?? "—")}
                          </span>
                        </div>
                      ) : null}
                      {meta.transaction_id ? (
                        <div>
                          <span className="text-slate-400 block">
                            Giao dịch liên kết:
                          </span>
                          <Link
                            href={`/inventory/transactions/${meta.transaction_id}`}
                            className="font-mono text-indigo-600 hover:underline font-semibold"
                          >
                            {String(meta.transaction_id).slice(0, 8)}... →
                          </Link>
                        </div>
                      ) : null}
                      {meta.reason ? (
                        <div className="col-span-2 sm:col-span-4">
                          <span className="text-slate-400 block">Lý do:</span>
                          <span className="text-slate-700 italic">
                            {String(meta.reason)}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Bounded pagination controls */}
        {totalItems > EVIDENCE_PAGE_SIZE && (
          <div className="p-3 border-t border-slate-100 flex items-center justify-between shrink-0">
            <span className="text-xs text-slate-500">
              Trang {page} / {Math.ceil(totalItems / EVIDENCE_PAGE_SIZE)} (
              {totalItems} bằng chứng)
            </span>
            <PaginationControls
              currentPage={page}
              totalItems={totalItems}
              pageSize={EVIDENCE_PAGE_SIZE}
              onPageChange={handlePageChange}
            />
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end pt-3 border-t border-slate-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="button button-secondary text-xs"
          >
            Đóng / Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function StockEvidenceModal({
  originId,
  itemCode,
  itemName,
  open,
  onClose,
}: StockEvidenceModalProps) {
  if (!open || !originId || typeof document === "undefined") return null;

  return createPortal(
    <StockEvidenceModalContent
      key={originId}
      originId={originId}
      itemCode={itemCode}
      itemName={itemName}
      onClose={onClose}
    />,
    document.body,
  );
}
