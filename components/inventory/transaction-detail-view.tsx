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
  ArrowLeft,
  ClipboardList,
  FileClock,
  Settings,
  ShieldCheck,
  X,
} from "@/components/icons";
import { StockEvidenceModal } from "./stock-evidence-modal";
import {
  correctOpeningBalanceAction,
  correctReceiptAction,
  reverseReceiptAction,
  verifyOpeningExpiryAction,
} from "@/app/inventory/actions";
import {
  formatDisplayQuantity,
  isPositive,
  multiplyExact,
  validateSplit,
} from "@/lib/inventory/decimal";
import {
  formatInventoryDateTime,
  normalizeExpiryInput,
} from "@/lib/inventory/dates";
import { ConditionBadge, ExpiryBadge, OperationBadge } from "./status-badge";
import type {
  ExpiryPrecision,
  InventoryStorageLocation,
  InventoryUom,
  StockCondition,
  TransactionDetailResult,
} from "@/lib/inventory/types";

export function TransactionDetailView({
  detail,
  locations,
  uoms,
  isAdmin,
  selectedOriginId,
}: {
  detail: TransactionDetailResult;
  locations: InventoryStorageLocation[];
  uoms: InventoryUom[];
  isAdmin: boolean;
  selectedOriginId?: string;
}) {
  const { transaction, lines, origins } = detail;

  const [correctReceiptOpen, setCorrectReceiptOpen] = useState(false);
  const [reverseReceiptOpen, setReverseReceiptOpen] = useState(false);
  const [correctOpeningOpen, setCorrectOpeningOpen] = useState(false);
  const [verifyExpiryOrigin, setVerifyExpiryOrigin] = useState<{
    originId: string;
    expectedVersion: string | number;
    itemName: string;
  } | null>(null);
  const [evidenceOrigin, setEvidenceOrigin] = useState<{
    id: string;
    code?: string;
    name?: string;
  } | null>(null);

  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  // Trigger refs for focus restoration
  const correctReceiptBtnRef = useRef<HTMLButtonElement>(null);
  const reverseReceiptBtnRef = useRef<HTMLButtonElement>(null);
  const correctOpeningBtnRef = useRef<HTMLButtonElement>(null);
  const verifyExpiryBtnRefs = useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );

  const isOriginalReceive = transaction.operation === "RECEIVE";
  const isOriginalOpening = transaction.operation === "OPENING";
  const isCorrectionOrReversal =
    transaction.operation === "CORRECT_RECEIPT" ||
    transaction.operation === "CORRECT_OPENING" ||
    transaction.operation === "REVERSE_RECEIPT";
  const isS2Operation =
    transaction.operation === "TRANSFER" ||
    transaction.operation === "CONDITION_CHANGE" ||
    transaction.operation === "STOCKTAKE_ADJUST" ||
    transaction.operation === "STOCKTAKE_SURPLUS" ||
    transaction.operation === "VERIFY_SURPLUS";
  // Detail ?origin selects/focuses cohort section
  useEffect(() => {
    if (!selectedOriginId) return;
    const targetEl = document.getElementById(
      `cohort-section-${selectedOriginId}`,
    );
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      targetEl.focus();
    }
  }, [selectedOriginId]);

  return (
    <div className="space-y-6">
      {/* Back button & Title */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href="/inventory/transactions"
            className="button button-secondary text-xs inline-flex items-center gap-1.5"
          >
            <ArrowLeft size={14} /> Quay lại lịch sử
          </Link>
          <span className="text-slate-300">/</span>
          <span className="font-mono text-xs text-slate-500 font-semibold dark:text-slate-400">
            {transaction.business_key}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {isOriginalReceive ? (
            <>
              <button
                ref={correctReceiptBtnRef}
                type="button"
                className="button button-secondary text-xs"
                onClick={() => setCorrectReceiptOpen(true)}
              >
                <Settings size={14} /> Điều chỉnh phiếu nhận (O09)
              </button>
              <button
                ref={reverseReceiptBtnRef}
                type="button"
                className="button button-danger text-xs"
                onClick={() => setReverseReceiptOpen(true)}
              >
                Hủy phiếu nhận (Về 0)
              </button>
            </>
          ) : null}

          {isOriginalOpening && isAdmin ? (
            <button
              ref={correctOpeningBtnRef}
              type="button"
              className="button button-secondary text-xs border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:bg-indigo-950/40"
              onClick={() => setCorrectOpeningOpen(true)}
            >
              <Settings size={14} /> Điều chỉnh tồn đầu (Admin O10)
            </button>
          ) : null}

          {isCorrectionOrReversal && transaction.corrects_transaction_id ? (
            <Link
              href={`/inventory/transactions/${transaction.corrects_transaction_id}`}
              className="button button-secondary text-xs inline-flex items-center gap-1.5"
            >
              <FileClock size={14} /> Xem giao dịch gốc / View Original Intake
            </Link>
          ) : null}

          {isS2Operation ? (
            <Link
              href="/inventory/operations"
              className="button button-primary text-xs inline-flex items-center gap-1.5"
            >
              Nghiệp vụ kho S2 / Operations →
            </Link>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div
          role="alert"
          aria-live="polite"
          className={`p-3 text-xs rounded-xl flex items-center justify-between border ${
            notice.ok
              ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-200"
              : "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/30 dark:border-red-900 dark:text-red-200"
          }`}
        >
          <span>{notice.message}</span>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 p-1"
            onClick={() => setNotice(null)}
            aria-label="Đóng thông báo"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {/* Header Info Panel */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <OperationBadge operation={transaction.operation} />
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
              {transaction.business_key}
            </h2>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            ID: {transaction.id}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <span className="text-slate-400 block text-[11px]">
              Người thực hiện:
            </span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {transaction.actor_name || "Hệ thống"}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px]">
              Thời điểm phát sinh:
            </span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {formatInventoryDateTime(transaction.occurred_at)}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px]">
              Thời điểm ghi sổ:
            </span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {formatInventoryDateTime(transaction.posted_at)}
            </span>
          </div>
          <div>
            <span className="text-slate-400 block text-[11px]">
              Giao dịch gốc điều chỉnh:
            </span>
            {transaction.corrects_transaction_id ? (
              <Link
                href={`/inventory/transactions/${transaction.corrects_transaction_id}`}
                className="font-mono text-indigo-600 font-semibold hover:underline dark:text-indigo-400"
              >
                {transaction.corrects_transaction_id.slice(0, 10)}…
              </Link>
            ) : (
              <span className="text-slate-400">Giao dịch gốc (None)</span>
            )}
          </div>
        </div>

        {transaction.reason ? (
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs dark:bg-slate-800/50 dark:border-slate-800">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Lý do điều chỉnh / ghi chú:
            </span>{" "}
            <span className="text-slate-800 dark:text-slate-200">
              {transaction.reason}
            </span>
          </div>
        ) : null}
      </div>

      {/* Signed Ledger Delta Lines */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs dark:bg-slate-900 dark:border-slate-800">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/40">
          <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
            Các dòng dịch chuyển sổ cái thực tế (Ledger Lines: {lines.length})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Dòng phát sinh ghi sổ bất biến, thể hiện số lượng thay đổi có dấu
            (+/-) trên từng vị trí và tình trạng hàng
          </p>
        </div>

        {/* Zero-line corrections say stock delta0 */}
        {lines.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 bg-slate-50/30 dark:bg-slate-900/30 dark:text-slate-400 space-y-1">
            <p className="font-semibold text-slate-700 dark:text-slate-300">
              Biến động tồn kho: 0 (Delta = 0) / Stock delta: 0
            </p>
            <p className="text-[11px] text-slate-500">
              Đây là giao dịch hiệu chỉnh thông tin chứng từ hoặc xác minh hạn
              dùng; số lượng tồn kho vật lý không thay đổi (Stock delta = 0).
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-600 font-semibold uppercase tracking-wider text-[11px] dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
                  <th className="py-2.5 px-4">Dòng / Line No</th>
                  <th className="py-2.5 px-4">Mã SKU / Vật tư</th>
                  <th className="py-2.5 px-4">Vị trí kho / Location</th>
                  <th className="py-2.5 px-4">Tình trạng</th>
                  <th className="py-2.5 px-4 text-right">
                    Biến động số lượng (Delta)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-mono dark:divide-slate-800 dark:text-slate-300">
                {lines.map((l) => {
                  const isZero = l.quantity_delta === "0";
                  const isPositiveDelta =
                    !l.quantity_delta.startsWith("-") && !isZero;
                  return (
                    <tr
                      key={l.line_no}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50"
                    >
                      <td className="py-2.5 px-4 font-semibold text-slate-800 dark:text-slate-200">
                        #{l.line_no}
                      </td>
                      <td className="py-2.5 px-4 font-sans font-medium text-slate-900 dark:text-slate-100">
                        {l.item_code} - {l.item_name}
                      </td>
                      <td className="py-2.5 px-4 font-sans text-slate-600 dark:text-slate-400">
                        {l.location_name}
                      </td>
                      <td className="py-2.5 px-4 font-sans">
                        <ConditionBadge
                          condition={l.condition as StockCondition}
                        />
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-bold text-sm ${
                          isZero
                            ? "text-slate-500"
                            : isPositiveDelta
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-red-700 dark:text-red-400"
                        }`}
                      >
                        {isZero
                          ? "0 (Delta = 0)"
                          : isPositiveDelta
                            ? `+${formatDisplayQuantity(l.quantity_delta)}`
                            : formatDisplayQuantity(l.quantity_delta)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Side-by-Side Fact Evidence Comparison */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
            Đối chiếu chứng từ nguồn gốc & Phiên bản (Origins & Evidence:{" "}
            {origins.length})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Bảo lưu nguyên vẹn bằng chứng mua sắm ban đầu (Fact v0) đối chiếu
            cùng sự thật hiệu chỉnh hiện thời (Current Fact)
          </p>
        </div>

        <div className="space-y-4">
          {origins.map((orig) => {
            const hasUnknown = orig.current_fact.expiry_precision === "unknown";
            const isSelected = selectedOriginId === orig.origin_id;
            const snapshot = orig.original_fact.source_snapshot as
              Record<string, unknown> | undefined;

            return (
              <div
                key={orig.origin_id}
                id={`cohort-section-${orig.origin_id}`}
                tabIndex={-1}
                className={`bg-white rounded-xl border overflow-hidden shadow-xs transition-all dark:bg-slate-900 ${
                  isSelected
                    ? "ring-2 ring-indigo-500 border-indigo-400 bg-indigo-50/10 dark:border-indigo-600"
                    : "border-slate-200 dark:border-slate-800"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50/60 text-xs dark:border-slate-800 dark:bg-slate-800/40">
                  <div className="flex items-center gap-2">
                    <div>
                      <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono mr-2">
                        [{orig.line_key}]
                      </span>
                      <strong className="text-slate-900 dark:text-slate-100">
                        {orig.item_code} - {orig.item_name}
                      </strong>
                      <span className="text-slate-400 text-[11px] block mt-0.5 font-mono">
                        Origin ID: {orig.origin_id}
                      </span>
                    </div>

                    {isSelected ? (
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                        Đang xem lô này / Selected origin
                      </span>
                    ) : null}

                    <button
                      type="button"
                      onClick={() =>
                        setEvidenceOrigin({
                          id: orig.origin_id,
                          code: orig.item_code,
                          name: orig.item_name,
                        })
                      }
                      className="button button-secondary text-xs inline-flex items-center gap-1.5 text-purple-700 hover:bg-purple-50"
                      title="Xem nhật ký bằng chứng kiểm kê / thẩm định"
                    >
                      <ClipboardList size={13} />
                      <span>Nhật ký bằng chứng</span>
                    </button>
                  </div>

                  {hasUnknown && isAdmin && isOriginalOpening ? (
                    <button
                      ref={(el) => {
                        verifyExpiryBtnRefs.current[orig.origin_id] = el;
                      }}
                      type="button"
                      className="button button-secondary text-xs border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-200 dark:bg-amber-950/40"
                      onClick={() =>
                        setVerifyExpiryOrigin({
                          originId: orig.origin_id,
                          expectedVersion: orig.current_fact.version,
                          itemName: `${orig.item_code} - ${orig.item_name}`,
                        })
                      }
                    >
                      <ShieldCheck size={14} className="text-amber-600" />
                      Xác minh hạn dùng (Admin O14)
                    </button>
                  ) : null}
                </div>

                {/* Side-by-side grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 text-xs dark:divide-slate-800">
                  {/* Left: Original Fact */}
                  <div className="p-4 space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                      <span className="font-bold text-slate-700 dark:text-slate-300 uppercase text-[11px]">
                        Bằng chứng gốc ban đầu / Original Fact (v
                        {String(orig.original_fact.version)})
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {orig.original_fact.id.slice(0, 8)}…
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          SL Nhập ban đầu:
                        </span>
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                          {orig.original_fact.purchase_quantity
                            ? `${formatDisplayQuantity(orig.original_fact.purchase_quantity)} ${orig.original_fact.purchase_uom_code}`
                            : "— (Tồn đầu)"}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          Hệ số quy đổi:
                        </span>
                        <span className="font-mono text-slate-800 dark:text-slate-200">
                          {orig.original_fact.conversion_factor
                            ? `\u00d7${orig.original_fact.conversion_factor}`
                            : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          SL Quy đổi cơ sở:
                        </span>
                        <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300">
                          {formatDisplayQuantity(
                            orig.original_fact.base_quantity,
                          )}{" "}
                          {orig.base_uom_code}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          Tốt / Hỏng ban đầu:
                        </span>
                        <span className="font-mono">
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                            {formatDisplayQuantity(
                              orig.original_fact.good_quantity,
                            )}
                          </span>{" "}
                          /{" "}
                          <span className="text-amber-700 dark:text-amber-400 font-semibold">
                            {formatDisplayQuantity(
                              orig.original_fact.damaged_quantity,
                            )}
                          </span>
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          Hạn dùng ban đầu:
                        </span>
                        <ExpiryBadge
                          precision={orig.original_fact.expiry_precision}
                          expiryDate={orig.original_fact.expiry_date}
                        />
                        <span className="block text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                          {orig.original_fact.expiry_input ?? "—"} (
                          {orig.original_fact.expiry_precision})
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          Vị trí tiếp nhận:
                        </span>
                        <span className="text-slate-800 dark:text-slate-200">
                          {orig.original_fact.location_name ||
                            orig.original_fact.location_id}
                        </span>
                      </div>
                    </div>

                    {/* Immutable Source Snapshot evidence */}
                    {snapshot && Object.keys(snapshot).length > 0 ? (
                      <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                        <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/60 dark:border-slate-700/60">
                          <span className="font-bold text-slate-700 dark:text-slate-300 uppercase text-[10px] tracking-wider">
                            Bằng chứng hồ sơ nguồn gốc bất biến / Immutable
                            Source Snapshot
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            Snapshot v0
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                          {Boolean(snapshot.source_reference) && (
                            <div>
                              <span className="text-slate-400 block text-[10px]">
                                Mã hồ sơ nguồn:
                              </span>
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {String(snapshot.source_reference)}
                              </span>
                            </div>
                          )}
                          {Boolean(snapshot.supplier_name) && (
                            <div>
                              <span className="text-slate-400 block text-[10px]">
                                Nhà cung cấp:
                              </span>
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {String(snapshot.supplier_name)}
                              </span>
                            </div>
                          )}
                          {Boolean(snapshot.unit_cost) && (
                            <div>
                              <span className="text-slate-400 block text-[10px]">
                                Đơn giá cam kết (INV-018):
                              </span>
                              <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                                {formatDisplayQuantity(
                                  String(snapshot.unit_cost),
                                )}{" "}
                                {String(snapshot.currency_code || "VND")}
                              </span>
                            </div>
                          )}
                          {Boolean(
                            snapshot.manufacturer ||
                            snapshot.model ||
                            snapshot.country_of_origin,
                          ) && (
                            <div>
                              <span className="text-slate-400 block text-[10px]">
                                Hãng SX / Model / Xuất xứ:
                              </span>
                              <span className="text-slate-700 dark:text-slate-300">
                                {[
                                  snapshot.manufacturer,
                                  snapshot.model,
                                  snapshot.country_of_origin,
                                ]
                                  .filter(Boolean)
                                  .map(String)
                                  .join(" • ")}
                              </span>
                            </div>
                          )}
                          {Boolean(snapshot.notes) && (
                            <div className="sm:col-span-2">
                              <span className="text-slate-400 block text-[10px]">
                                Ghi chú nguồn cam kết:
                              </span>
                              <span className="text-slate-700 dark:text-slate-300 italic">
                                {String(snapshot.notes)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* Right: Current Fact */}
                  <div className="p-4 space-y-3 bg-slate-50/30 dark:bg-slate-900/40">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                      <span className="font-bold text-indigo-900 dark:text-indigo-300 uppercase text-[11px]">
                        Sự thật hiệu chỉnh hiện thời / Current Fact (v
                        {String(orig.current_fact.version)})
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        {orig.current_fact.id.slice(0, 8)}…
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          SL Nhập hiện tại:
                        </span>
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                          {orig.current_fact.purchase_quantity
                            ? `${formatDisplayQuantity(orig.current_fact.purchase_quantity)} ${orig.current_fact.purchase_uom_code}`
                            : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          Hệ số quy đổi:
                        </span>
                        <span className="font-mono text-slate-800 dark:text-slate-200">
                          {orig.current_fact.conversion_factor
                            ? `\u00d7${orig.current_fact.conversion_factor}`
                            : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          SL Cơ sở hiện tại:
                        </span>
                        <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300">
                          {formatDisplayQuantity(
                            orig.current_fact.base_quantity,
                          )}{" "}
                          {orig.base_uom_code}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          Tốt / Hỏng hiện thời:
                        </span>
                        <span className="font-mono">
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                            {formatDisplayQuantity(
                              orig.current_fact.good_quantity,
                            )}
                          </span>{" "}
                          /{" "}
                          <span className="text-amber-700 dark:text-amber-400 font-semibold">
                            {formatDisplayQuantity(
                              orig.current_fact.damaged_quantity,
                            )}
                          </span>
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          Hạn dùng hiện thời:
                        </span>
                        <ExpiryBadge
                          precision={orig.current_fact.expiry_precision}
                          expiryDate={orig.current_fact.expiry_date}
                        />
                        <span className="block text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                          {orig.current_fact.expiry_input ?? "—"} (
                          {orig.current_fact.expiry_precision})
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">
                          Vị trí kho hiện tại:
                        </span>
                        <span className="text-slate-800 dark:text-slate-200">
                          {orig.current_fact.location_name ||
                            orig.current_fact.location_id}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Cohort Remaining stock */}
                {orig.balances && orig.balances.length > 0 ? (
                  <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs dark:bg-slate-800/40 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400 font-medium">
                      Tồn kho thực tế còn lại của lô này (Remaining Balance):
                    </span>
                    <div className="flex items-center gap-3">
                      {orig.balances.map((b, bi) => (
                        <span key={bi} className="font-mono">
                          <strong className="text-slate-900 dark:text-slate-100">
                            {formatDisplayQuantity(b.quantity)}
                          </strong>{" "}
                          <span className="text-slate-500 dark:text-slate-400 font-sans">
                            ({b.condition === "good" ? "Tốt" : "Hỏng"} tại{" "}
                            {b.location_name})
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* Modal 1: Correct Receipt Modal */}
      {/* ========================================================================= */}
      {correctReceiptOpen ? (
        <CorrectReceiptDialog
          transactionId={transaction.id}
          origins={origins}
          locations={locations}
          uoms={uoms}
          onClose={() => {
            setCorrectReceiptOpen(false);
            correctReceiptBtnRef.current?.focus();
          }}
          onSuccess={(msg) => {
            setNotice({ ok: true, message: msg });
            setCorrectReceiptOpen(false);
            correctReceiptBtnRef.current?.focus();
          }}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 2: Reverse Receipt Modal */}
      {/* ========================================================================= */}
      {reverseReceiptOpen ? (
        <ReverseReceiptDialog
          transactionId={transaction.id}
          origins={origins}
          onClose={() => {
            setReverseReceiptOpen(false);
            reverseReceiptBtnRef.current?.focus();
          }}
          onSuccess={(msg) => {
            setNotice({ ok: true, message: msg });
            setReverseReceiptOpen(false);
            reverseReceiptBtnRef.current?.focus();
          }}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 3: Correct Opening Balance Modal */}
      {/* ========================================================================= */}
      {correctOpeningOpen ? (
        <CorrectOpeningDialog
          transactionId={transaction.id}
          origins={origins}
          locations={locations}
          onClose={() => {
            setCorrectOpeningOpen(false);
            correctOpeningBtnRef.current?.focus();
          }}
          onSuccess={(msg) => {
            setNotice({ ok: true, message: msg });
            setCorrectOpeningOpen(false);
            correctOpeningBtnRef.current?.focus();
          }}
        />
      ) : null}

      {/* ========================================================================= */}
      {/* Modal 4: Verify Opening Expiry (Admin Only) */}
      {/* ========================================================================= */}
      {verifyExpiryOrigin ? (
        <VerifyExpiryDialog
          originId={verifyExpiryOrigin.originId}
          expectedVersion={verifyExpiryOrigin.expectedVersion}
          itemName={verifyExpiryOrigin.itemName}
          onClose={() => {
            const originId = verifyExpiryOrigin.originId;
            setVerifyExpiryOrigin(null);
            verifyExpiryBtnRefs.current[originId]?.focus();
          }}
          onSuccess={(msg) => {
            const originId = verifyExpiryOrigin.originId;
            setNotice({ ok: true, message: msg });
            setVerifyExpiryOrigin(null);
            verifyExpiryBtnRefs.current[originId]?.focus();
          }}
        />
      ) : null}

      {/* Stock Evidence Modal */}
      <StockEvidenceModal
        open={Boolean(evidenceOrigin)}
        originId={evidenceOrigin?.id || ""}
        itemCode={evidenceOrigin?.code}
        itemName={evidenceOrigin?.name}
        onClose={() => setEvidenceOrigin(null)}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: Correct Receipt with Before/After Facts and Signed Delta Preview
// -----------------------------------------------------------------------------
function CorrectReceiptDialog({
  transactionId,
  origins,
  locations,
  uoms,
  onClose,
  onSuccess,
}: {
  transactionId: string;
  origins: TransactionDetailResult["origins"];
  locations: InventoryStorageLocation[];
  uoms: InventoryUom[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState(() =>
    origins.map((o) => ({
      origin_id: o.origin_id,
      expected_version: o.current_fact.version,
      itemName: `[${o.line_key}] ${o.item_code} - ${o.item_name}`,
      location_id: o.current_fact.location_id,
      purchase_quantity: o.current_fact.purchase_quantity || "",
      conversion_factor: o.current_fact.conversion_factor || "",
      purchase_uom_code: o.current_fact.purchase_uom_code || o.base_uom_code,
      good_quantity: o.current_fact.good_quantity,
      damaged_quantity: o.current_fact.damaged_quantity,
      expiry_precision: o.current_fact.expiry_precision,
      expiry_input:
        o.current_fact.expiry_input || o.current_fact.expiry_date || "",
      evidence_note: o.current_fact.evidence_note || "",
    })),
  );

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const lastPayloadRef = useRef<string | null>(null);
  const retryKeyRef = useRef<string | null>(null);

  // Focus and Escape management
  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
      prevActive?.focus();
    };
  }, [isPending, onClose]);

  // Compute signed deltas preview for each line
  const deltaPreviews = useMemo(() => {
    return lines.map((l) => {
      const orig = origins.find((o) => o.origin_id === l.origin_id);
      if (!orig) return null;

      const oldFact = orig.current_fact;
      const mult = multiplyExact(l.purchase_quantity, l.conversion_factor, 6);
      const newBase = mult.valid && mult.result ? mult.result : "0";

      // Delta calculations (signed)
      const diffGood =
        parseFloat(l.good_quantity || "0") -
        parseFloat(oldFact.good_quantity || "0");
      const diffDamaged =
        parseFloat(l.damaged_quantity || "0") -
        parseFloat(oldFact.damaged_quantity || "0");
      const diffBase =
        parseFloat(newBase) - parseFloat(oldFact.base_quantity || "0");

      const formatDelta = (val: number) => {
        if (Number.isNaN(val) || Math.abs(val) < 0.000001) return "0";
        return val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
      };

      return {
        orig,
        oldFact,
        newBase,
        diffGood: formatDelta(diffGood),
        diffDamaged: formatDelta(diffDamaged),
        diffBase: formatDelta(diffBase),
      };
    });
  }, [lines, origins]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Vui lòng nhập lý do điều chỉnh / Reason is required");
      return;
    }

    for (const l of lines) {
      if (!isPositive(l.purchase_quantity)) {
        setError(
          `Dòng ${l.itemName}: Số lượng nhập phải lớn hơn 0 trong điều chỉnh thông thường. Để hủy bỏ toàn bộ về 0, vui lòng sử dụng chức năng Hủy phiếu nhận.`,
        );
        return;
      }
      if (!isPositive(l.conversion_factor)) {
        setError(`Dòng ${l.itemName}: Hệ số quy đổi phải lớn hơn 0.`);
        return;
      }
      const mult = multiplyExact(l.purchase_quantity, l.conversion_factor);
      if (!mult.valid || !mult.result) {
        setError(`Dòng ${l.itemName}: ${mult.error}`);
        return;
      }
      const split = validateSplit(
        mult.result,
        l.good_quantity,
        l.damaged_quantity,
      );
      if (!split.valid) {
        setError(`Dòng ${l.itemName}: ${split.error}`);
        return;
      }
      const expNorm = normalizeExpiryInput(l.expiry_precision, l.expiry_input);
      if (!expNorm.valid) {
        setError(`Dòng ${l.itemName}: ${expNorm.error}`);
        return;
      }
    }

    // Submit intended facts ONLY; server remains authority, never submit client delta
    const payload = {
      transaction_id: transactionId,
      reason: reason.trim(),
      lines: lines.map((l) => ({
        origin_id: l.origin_id,
        expected_version: l.expected_version,
        location_id: l.location_id,
        purchase_quantity: l.purchase_quantity,
        purchase_uom_code: l.purchase_uom_code,
        conversion_factor: l.conversion_factor,
        good_quantity: l.good_quantity,
        damaged_quantity: l.damaged_quantity,
        expiry_precision: l.expiry_precision,
        expiry_input: l.expiry_input.trim(),
        evidence_note: l.evidence_note.trim() || undefined,
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
      const res = await correctReceiptAction(payload, retryKey).catch(
        (error: unknown) => ({
          ok: false as const,
          error: `Chưa nhận được kết quả; hãy thử lại cùng dữ liệu / Response unavailable; retry unchanged input. ${error instanceof Error ? error.message : ""}`,
        }),
      );

      if (res.ok) {
        lastPayloadRef.current = null;
        retryKeyRef.current = null;
        onSuccess(
          "Điều chỉnh phiếu nhận thành công! Phiên bản mới đã được ghi sổ.",
        );
      } else {
        setError(res.error || "Lỗi điều chỉnh phiếu nhận");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="correct-receipt-dialog-title"
    >
      <div className="relative w-full max-w-3xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/40">
          <h3
            id="correct-receipt-dialog-title"
            className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider"
          >
            Điều chỉnh phiếu nhận / Correct Receipt
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1 dark:hover:text-slate-200"
            onClick={onClose}
            aria-label="Đóng / Close"
            disabled={isPending}
          >
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-4 overflow-y-auto text-xs"
        >
          <div>
            <label
              htmlFor="correct-receipt-reason"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Lý do điều chỉnh (Bắt buộc theo INV-018){" "}
              <span className="text-red-500">*</span>
            </label>
            <textarea
              id="correct-receipt-reason"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              rows={2}
              placeholder="VD: Sai sót hệ số quy đổi lúc nhập kho..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>

          <div className="space-y-4">
            <span className="font-bold text-slate-800 dark:text-slate-200 block">
              Dòng vật tư cần điều chỉnh sự thật ({lines.length})
            </span>
            {lines.map((l, i) => {
              const preview = deltaPreviews[i];

              return (
                <div
                  key={l.origin_id}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3 dark:bg-slate-800/40 dark:border-slate-800"
                >
                  <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                    {l.itemName}
                  </span>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500">
                        Vị trí kho
                      </label>
                      <select
                        aria-label={`Vị trí kho dòng ${i + 1}`}
                        className="w-full text-xs border border-slate-300 rounded p-1.5 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={l.location_id}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((item, idx) =>
                              idx === i ? { ...item, location_id: val } : item,
                            ),
                          );
                        }}
                      >
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">
                        SL Giao
                      </label>
                      <input
                        aria-label={`SL Giao dòng ${i + 1}`}
                        type="text"
                        inputMode="decimal"
                        className="w-full text-xs font-mono border border-slate-300 rounded p-1.5 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={l.purchase_quantity}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((item, idx) =>
                              idx === i
                                ? { ...item, purchase_quantity: val }
                                : item,
                            ),
                          );
                        }}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">
                        Hệ số quy đổi
                      </label>
                      <input
                        aria-label={`Hệ số quy đổi dòng ${i + 1}`}
                        type="text"
                        inputMode="decimal"
                        className="w-full text-xs font-mono border border-slate-300 rounded p-1.5 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={l.conversion_factor}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((item, idx) =>
                              idx === i
                                ? { ...item, conversion_factor: val }
                                : item,
                            ),
                          );
                        }}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">
                        SL Tốt
                      </label>
                      <input
                        aria-label={`SL Tốt dòng ${i + 1}`}
                        type="text"
                        inputMode="decimal"
                        className="w-full text-xs font-mono border border-slate-300 rounded p-1.5 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={l.good_quantity}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((item, idx) =>
                              idx === i
                                ? { ...item, good_quantity: val }
                                : item,
                            ),
                          );
                        }}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">
                        SL Hỏng
                      </label>
                      <input
                        aria-label={`SL Hỏng dòng ${i + 1}`}
                        type="text"
                        inputMode="decimal"
                        className="w-full text-xs font-mono border border-slate-300 rounded p-1.5 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={l.damaged_quantity}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((item, idx) =>
                              idx === i
                                ? { ...item, damaged_quantity: val }
                                : item,
                            ),
                          );
                        }}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label className="block text-[10px] text-slate-500">
                      Đơn vị nhập
                      <select
                        aria-label={`Đơn vị nhập dòng ${i + 1}`}
                        className="w-full text-xs border border-slate-300 rounded p-1.5 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={l.purchase_uom_code}
                        onChange={(event) => {
                          const value = event.target.value;
                          setLines((prev) =>
                            prev.map((line, index) =>
                              index === i
                                ? { ...line, purchase_uom_code: value }
                                : line,
                            ),
                          );
                        }}
                      >
                        {uoms.map((uom) => (
                          <option key={uom.code} value={uom.code}>
                            {uom.name} ({uom.code})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-[10px] text-slate-500">
                      Độ chính xác HSD
                      <select
                        aria-label={`Độ chính xác HSD dòng ${i + 1}`}
                        className="w-full text-xs border border-slate-300 rounded p-1.5 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={l.expiry_precision}
                        onChange={(event) => {
                          const value = event.target.value as ExpiryPrecision;
                          setLines((prev) =>
                            prev.map((line, index) =>
                              index === i
                                ? {
                                    ...line,
                                    expiry_precision: value,
                                    expiry_input: "",
                                  }
                                : line,
                            ),
                          );
                        }}
                      >
                        <option value="not_required">Không yêu cầu</option>
                        <option value="day">Theo ngày</option>
                        <option value="month">Theo tháng</option>
                      </select>
                    </label>
                    <label className="block text-[10px] text-slate-500">
                      Hạn dùng (YYYY-MM-DD hoặc YYYY-MM)
                      <input
                        aria-label={`Hạn dùng dòng ${i + 1}`}
                        className="w-full text-xs border border-slate-300 rounded p-1.5 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={l.expiry_input}
                        disabled={l.expiry_precision === "not_required"}
                        required={l.expiry_precision !== "not_required"}
                        onChange={(event) => {
                          const value = event.target.value;
                          setLines((prev) =>
                            prev.map((line, index) =>
                              index === i
                                ? { ...line, expiry_input: value }
                                : line,
                            ),
                          );
                        }}
                      />
                    </label>
                  </div>

                  {/* Before / After Intended Facts & Signed Delta Preview */}
                  {preview ? (
                    <div className="p-2.5 bg-indigo-50/50 border border-indigo-100 rounded-lg text-[11px] space-y-1.5 dark:bg-indigo-950/30 dark:border-indigo-900/50">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <div>
                          <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                            Trước điều chỉnh (Fact hiện thời):
                          </span>
                          <span className="font-mono text-slate-700 dark:text-slate-300">
                            Cơ sở: {preview.oldFact.base_quantity} (Tốt:{" "}
                            {preview.oldFact.good_quantity} / Hỏng:{" "}
                            {preview.oldFact.damaged_quantity})
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                            Dự kiến sau điều chỉnh (Intended Fact):
                          </span>
                          <span className="font-mono font-semibold text-indigo-900 dark:text-indigo-200">
                            Cơ sở: {preview.newBase} (Tốt: {l.good_quantity} /
                            Hỏng: {l.damaged_quantity})
                          </span>
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                            Dự kiến biến động sổ cái (Signed Delta):
                          </span>
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            ΔTốt: {preview.diffGood} &bull; ΔHỏng:{" "}
                            {preview.diffDamaged} &bull; ΔCơ sở:{" "}
                            {preview.diffBase}
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">
                        * Máy chủ là cơ quan thẩm quyền duy nhất tính toán và
                        ghi nhận biến động sổ cái (server authority). Biểu mẫu
                        chỉ gửi sự thật dự kiến, không gửi client delta.
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {error ? (
            <div
              role="alert"
              aria-live="polite"
              className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg dark:bg-red-950/40 dark:border-red-900/50 dark:text-red-300"
            >
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
              {isPending ? "Đang ghi sổ…" : "Ghi nhận điều chỉnh mới"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: Reverse Receipt (Intake to Zero)
// -----------------------------------------------------------------------------
function ReverseReceiptDialog({
  transactionId,
  origins,
  onClose,
  onSuccess,
}: {
  transactionId: string;
  origins: TransactionDetailResult["origins"];
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const lastPayloadRef = useRef<string | null>(null);
  const retryKeyRef = useRef<string | null>(null);

  // Focus and Escape management
  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
      prevActive?.focus();
    };
  }, [isPending, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Vui lòng nhập lý do hủy phiếu nhận");
      return;
    }

    const payload = {
      transaction_id: transactionId,
      reason: reason.trim(),
      versions: origins.map((o) => ({
        origin_id: o.origin_id,
        expected_version: o.current_fact.version,
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
      const res = await reverseReceiptAction(payload, retryKey).catch(
        (error: unknown) => ({
          ok: false as const,
          error: `Chưa nhận được kết quả; hãy thử lại cùng dữ liệu / Response unavailable; retry unchanged input. ${error instanceof Error ? error.message : ""}`,
        }),
      );

      if (res.ok) {
        lastPayloadRef.current = null;
        retryKeyRef.current = null;
        onSuccess("Đã hủy bỏ toàn bộ phiếu nhận (Số dư về 0) thành công!");
      } else {
        setError(res.error || "Lỗi hủy phiếu nhận");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reverse-receipt-dialog-title"
    >
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/40">
          <h3
            id="reverse-receipt-dialog-title"
            className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider"
          >
            Hủy phiếu nhận / Reverse Receipt
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1 dark:hover:text-slate-200"
            onClick={onClose}
            aria-label="Đóng / Close"
            disabled={isPending}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Thao tác hủy phiếu sẽ đưa toàn bộ số lượng thực nhận của phiếu này
            về <strong>0</strong>. Lịch sử gốc ban đầu được lưu vết nguyên vẹn
            và số dư sổ cái được trừ bù tương ứng.
          </p>

          <div>
            <label
              htmlFor="reverse-receipt-reason"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Lý do hủy phiếu <span className="text-red-500">*</span>
            </label>
            <textarea
              id="reverse-receipt-reason"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              rows={3}
              placeholder="VD: Hóa đơn bị hủy do nhà cung cấp giao nhầm đợt..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>

          {error ? (
            <div
              role="alert"
              aria-live="polite"
              className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg dark:bg-red-950/40 dark:border-red-900/50 dark:text-red-300"
            >
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
              Quay lại
            </button>
            <button
              type="submit"
              className="button button-danger text-xs"
              disabled={isPending}
            >
              {isPending ? "Đang hủy…" : "Xác nhận hủy phiếu về 0"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: Correct Opening Balance (Admin Only) with Before/After Facts & Delta Preview
// -----------------------------------------------------------------------------
function CorrectOpeningDialog({
  transactionId,
  origins,
  locations,
  onClose,
  onSuccess,
}: {
  transactionId: string;
  origins: TransactionDetailResult["origins"];
  locations: InventoryStorageLocation[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState(() =>
    origins.map((o) => ({
      origin_id: o.origin_id,
      expected_version: o.current_fact.version,
      itemName: `[${o.line_key}] ${o.item_code} - ${o.item_name}`,
      location_id: o.current_fact.location_id,
      base_quantity: o.current_fact.base_quantity,
      good_quantity: o.current_fact.good_quantity,
      damaged_quantity: o.current_fact.damaged_quantity,
      expiry_precision: o.current_fact.expiry_precision,
      expiry_input:
        o.current_fact.expiry_input || o.current_fact.expiry_date || "",
      evidence_note: o.current_fact.evidence_note || "",
    })),
  );

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const lastPayloadRef = useRef<string | null>(null);
  const retryKeyRef = useRef<string | null>(null);

  // Focus and Escape management
  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
      prevActive?.focus();
    };
  }, [isPending, onClose]);

  // Delta calculations (signed)
  const deltaPreviews = useMemo(() => {
    return lines.map((l) => {
      const orig = origins.find((o) => o.origin_id === l.origin_id);
      if (!orig) return null;

      const oldFact = orig.current_fact;
      const diffBase =
        parseFloat(l.base_quantity || "0") -
        parseFloat(oldFact.base_quantity || "0");
      const diffGood =
        parseFloat(l.good_quantity || "0") -
        parseFloat(oldFact.good_quantity || "0");
      const diffDamaged =
        parseFloat(l.damaged_quantity || "0") -
        parseFloat(oldFact.damaged_quantity || "0");

      const formatDelta = (val: number) => {
        if (Number.isNaN(val) || Math.abs(val) < 0.000001) return "0";
        return val > 0 ? `+${val.toFixed(2)}` : val.toFixed(2);
      };

      return {
        orig,
        oldFact,
        diffBase: formatDelta(diffBase),
        diffGood: formatDelta(diffGood),
        diffDamaged: formatDelta(diffDamaged),
      };
    });
  }, [lines, origins]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Vui lòng nhập lý do điều chỉnh");
      return;
    }

    for (const l of lines) {
      const split = validateSplit(
        l.base_quantity,
        l.good_quantity,
        l.damaged_quantity,
      );
      if (!split.valid) {
        setError(`Dòng ${l.itemName}: ${split.error}`);
        return;
      }
      const expNorm = normalizeExpiryInput(l.expiry_precision, l.expiry_input);
      if (!expNorm.valid) {
        setError(`Dòng ${l.itemName}: ${expNorm.error}`);
        return;
      }
      const orig = origins.find((o) => o.origin_id === l.origin_id);
      if (
        orig?.current_fact.expiry_precision === "unknown" &&
        l.expiry_precision !== "unknown" &&
        !l.evidence_note.trim()
      ) {
        setError(
          `Dòng ${l.itemName}: Chuyển hạn dùng từ "Chưa rõ" sang ngày/tháng cụ thể bắt buộc phải có bằng chứng kiểm tra (evidence_note) theo quy định kiểm kê.`,
        );
        return;
      }
    }

    // Submit intended facts ONLY; server remains authority, never submit client delta
    const payload = {
      transaction_id: transactionId,
      reason: reason.trim(),
      lines: lines.map((l) => ({
        origin_id: l.origin_id,
        expected_version: l.expected_version,
        location_id: l.location_id,
        base_quantity: l.base_quantity,
        good_quantity: l.good_quantity,
        damaged_quantity: l.damaged_quantity,
        expiry_precision: l.expiry_precision,
        expiry_input: l.expiry_input.trim(),
        evidence_note: l.evidence_note.trim() || undefined,
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
      const res = await correctOpeningBalanceAction(payload, retryKey).catch(
        (error: unknown) => ({
          ok: false as const,
          error: `Chưa nhận được kết quả; hãy thử lại cùng dữ liệu / Response unavailable; retry unchanged input. ${error instanceof Error ? error.message : ""}`,
        }),
      );

      if (res.ok) {
        lastPayloadRef.current = null;
        retryKeyRef.current = null;
        onSuccess("Điều chỉnh tồn đầu kỳ thành công!");
      } else {
        setError(res.error || "Lỗi điều chỉnh tồn đầu");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="correct-opening-dialog-title"
    >
      <div className="relative w-full max-w-3xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/40">
          <h3
            id="correct-opening-dialog-title"
            className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider"
          >
            Điều chỉnh tồn đầu kỳ / Correct Opening (Admin)
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1 dark:hover:text-slate-200"
            onClick={onClose}
            aria-label="Đóng / Close"
            disabled={isPending}
          >
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-4 overflow-y-auto text-xs"
        >
          <div>
            <label
              htmlFor="correct-opening-reason"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Lý do điều chỉnh kiểm kê <span className="text-red-500">*</span>
            </label>
            <textarea
              id="correct-opening-reason"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              rows={2}
              placeholder="VD: Kiểm đếm lại vị trí Phòng Lab phát hiện thừa/thiếu..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>

          <div className="space-y-4">
            {lines.map((l, i) => {
              const preview = deltaPreviews[i];

              return (
                <div
                  key={l.origin_id}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3 dark:bg-slate-800/40 dark:border-slate-800"
                >
                  <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                    {l.itemName}
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <label className="block text-[10px] text-slate-500">
                        Vị trí kho
                      </label>
                      <select
                        aria-label={`Vị trí kho dòng ${i + 1}`}
                        className="w-full text-xs border border-slate-300 rounded p-1.5 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={l.location_id}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((it, idx) =>
                              idx === i ? { ...it, location_id: val } : it,
                            ),
                          );
                        }}
                      >
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">
                        SL Cơ sở
                      </label>
                      <input
                        aria-label={`SL Cơ sở dòng ${i + 1}`}
                        type="text"
                        inputMode="decimal"
                        className="w-full text-xs font-mono border border-slate-300 rounded p-1.5 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={l.base_quantity}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((it, idx) =>
                              idx === i ? { ...it, base_quantity: val } : it,
                            ),
                          );
                        }}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">
                        SL Tốt
                      </label>
                      <input
                        aria-label={`SL Tốt dòng ${i + 1}`}
                        type="text"
                        inputMode="decimal"
                        className="w-full text-xs font-mono border border-slate-300 rounded p-1.5 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={l.good_quantity}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((it, idx) =>
                              idx === i ? { ...it, good_quantity: val } : it,
                            ),
                          );
                        }}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">
                        SL Hỏng
                      </label>
                      <input
                        aria-label={`SL Hỏng dòng ${i + 1}`}
                        type="text"
                        inputMode="decimal"
                        className="w-full text-xs font-mono border border-slate-300 rounded p-1.5 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={l.damaged_quantity}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((it, idx) =>
                              idx === i ? { ...it, damaged_quantity: val } : it,
                            ),
                          );
                        }}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                    <div>
                      <label className="block text-[10px] text-slate-500">
                        Độ chính xác HSD
                      </label>
                      <select
                        aria-label={`Độ chính xác HSD dòng ${i + 1}`}
                        className="w-full text-xs border border-slate-300 rounded p-1.5 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={l.expiry_precision}
                        onChange={(e) => {
                          const val = e.target.value as ExpiryPrecision;
                          setLines((prev) =>
                            prev.map((it, idx) =>
                              idx === i
                                ? {
                                    ...it,
                                    expiry_precision: val,
                                    expiry_input: "",
                                  }
                                : it,
                            ),
                          );
                        }}
                      >
                        <option value="not_required">Không yêu cầu</option>
                        <option value="unknown">Chưa rõ (Unknown)</option>
                        <option value="day">Theo ngày</option>
                        <option value="month">Theo tháng</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">
                        Hạn dùng (YYYY-MM-DD hoặc YYYY-MM)
                      </label>
                      <input
                        aria-label={`Hạn dùng dòng ${i + 1}`}
                        className="w-full text-xs border border-slate-300 rounded p-1.5 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        value={l.expiry_input}
                        disabled={
                          l.expiry_precision === "not_required" ||
                          l.expiry_precision === "unknown"
                        }
                        required={
                          l.expiry_precision === "day" ||
                          l.expiry_precision === "month"
                        }
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((it, idx) =>
                              idx === i ? { ...it, expiry_input: val } : it,
                            ),
                          );
                        }}
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">
                        Ghi chú bằng chứng (bắt buộc khi bỏ Unknown)
                      </label>
                      <input
                        aria-label={`Ghi chú bằng chứng dòng ${i + 1}`}
                        className="w-full text-xs border border-slate-300 rounded p-1.5 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        placeholder="VD: Nhãn chai LOT-123..."
                        value={l.evidence_note}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLines((prev) =>
                            prev.map((it, idx) =>
                              idx === i ? { ...it, evidence_note: val } : it,
                            ),
                          );
                        }}
                      />
                    </div>
                  </div>

                  {/* Before / After Intended Facts & Signed Delta Preview */}
                  {preview ? (
                    <div className="p-2.5 bg-indigo-50/50 border border-indigo-100 rounded-lg text-[11px] space-y-1.5 dark:bg-indigo-950/30 dark:border-indigo-900/50">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <div>
                          <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                            Trước điều chỉnh (Fact hiện thời):
                          </span>
                          <span className="font-mono text-slate-700 dark:text-slate-300">
                            Cơ sở: {preview.oldFact.base_quantity} (Tốt:{" "}
                            {preview.oldFact.good_quantity} / Hỏng:{" "}
                            {preview.oldFact.damaged_quantity})
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                            Dự kiến sau điều chỉnh (Intended Fact):
                          </span>
                          <span className="font-mono font-semibold text-indigo-900 dark:text-indigo-200">
                            Cơ sở: {l.base_quantity} (Tốt: {l.good_quantity} /
                            Hỏng: {l.damaged_quantity})
                          </span>
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                            Dự kiến biến động sổ cái (Signed Delta):
                          </span>
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            ΔTốt: {preview.diffGood} &bull; ΔHỏng:{" "}
                            {preview.diffDamaged} &bull; ΔCơ sở:{" "}
                            {preview.diffBase}
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">
                        * Máy chủ là cơ quan thẩm quyền duy nhất tính toán và
                        ghi nhận biến động sổ cái (server authority). Biểu mẫu
                        chỉ gửi sự thật dự kiến, không gửi client delta.
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {error ? (
            <div
              role="alert"
              aria-live="polite"
              className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg dark:bg-red-950/40 dark:border-red-900/50 dark:text-red-300"
            >
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
              {isPending ? "Đang ghi sổ…" : "Ghi nhận điều chỉnh kiểm kê"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-dialog: Verify Opening Expiry (Admin Only O14)
// -----------------------------------------------------------------------------
function VerifyExpiryDialog({
  originId,
  expectedVersion,
  itemName,
  onClose,
  onSuccess,
}: {
  originId: string;
  expectedVersion: string | number;
  itemName: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [precision, setPrecision] = useState<"day" | "month">("day");
  const [inputVal, setInputVal] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const lastPayloadRef = useRef<string | null>(null);
  const retryKeyRef = useRef<string | null>(null);

  // Focus and Escape management
  useEffect(() => {
    const prevActive = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
      prevActive?.focus();
    };
  }, [isPending, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim() || !evidenceNote.trim() || !inputVal.trim()) {
      setError("Vui lòng điền đủ hạn dùng, bằng chứng kiểm tra và lý do");
      return;
    }

    const payload = {
      origin_id: originId,
      expected_version: expectedVersion,
      expiry_precision: precision,
      expiry_input: inputVal.trim(),
      evidence_note: evidenceNote.trim(),
      reason: reason.trim(),
    };

    const serialized = JSON.stringify(payload);
    let retryKey = retryKeyRef.current;
    if (lastPayloadRef.current !== serialized || !retryKey) {
      retryKey = crypto.randomUUID();
      lastPayloadRef.current = serialized;
      retryKeyRef.current = retryKey;
    }

    startTransition(async () => {
      const res = await verifyOpeningExpiryAction(payload, retryKey).catch(
        (error: unknown) => ({
          ok: false as const,
          error: `Chưa nhận được kết quả; hãy thử lại cùng dữ liệu / Response unavailable; retry unchanged input. ${error instanceof Error ? error.message : ""}`,
        }),
      );

      if (res.ok) {
        lastPayloadRef.current = null;
        retryKeyRef.current = null;
        onSuccess(
          `Xác minh HSD thành công cho ${itemName}! Vật tư đã đủ điều kiện cấp phát.`,
        );
      } else {
        setError(res.error || "Lỗi xác minh hạn dùng");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verify-expiry-dialog-title"
    >
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/40">
          <h3
            id="verify-expiry-dialog-title"
            className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider"
          >
            Xác minh hạn dùng / Verify Expiry (O14 Admin)
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1 dark:hover:text-slate-200"
            onClick={onClose}
            aria-label="Đóng / Close"
            disabled={isPending}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs dark:bg-slate-800/50 dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
              Đối tượng vật tư:
            </span>
            <strong className="text-slate-900 dark:text-slate-100 font-semibold">
              {itemName}
            </strong>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="verify-expiry-precision"
                className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Độ chính xác <span className="text-red-500">*</span>
              </label>
              <select
                id="verify-expiry-precision"
                className="w-full text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                value={precision}
                onChange={(e) =>
                  setPrecision(e.target.value as "day" | "month")
                }
              >
                <option value="day">Theo ngày (YYYY-MM-DD)</option>
                <option value="month">Theo tháng (YYYY-MM)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="verify-expiry-input"
                className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Hạn sử dụng thẩm tra <span className="text-red-500">*</span>
              </label>
              {precision === "day" ? (
                <input
                  id="verify-expiry-input"
                  type="date"
                  className="w-full text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  required
                />
              ) : (
                <input
                  id="verify-expiry-input"
                  type="month"
                  className="w-full text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  required
                />
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="verify-expiry-evidence"
              className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Bằng chứng thẩm tra thực tế{" "}
              <span className="text-red-500">*</span>
            </label>
            <input
              id="verify-expiry-evidence"
              type="text"
              className="w-full text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              placeholder="VD: Kiểm tra nhãn phụ trên vỏ chai, số lô LOT-12345..."
              value={evidenceNote}
              onChange={(e) => setEvidenceNote(e.target.value)}
              required
            />
          </div>

          <div>
            <label
              htmlFor="verify-expiry-reason"
              className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              Lý do xác minh <span className="text-red-500">*</span>
            </label>
            <textarea
              id="verify-expiry-reason"
              className="w-full text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              rows={2}
              placeholder="Nhập lý do chi tiết..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>

          {error ? (
            <div
              role="alert"
              aria-live="polite"
              className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg dark:bg-red-950/40 dark:border-red-900/50 dark:text-red-300"
            >
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
              {isPending ? "Đang xác minh…" : "Xác nhận hạn dùng ngay"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
