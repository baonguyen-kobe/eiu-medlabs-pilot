"use client";

import { DialogKeyboard } from "@/components/dialog-keyboard";
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import {
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
  formatQuantityDelta,
  isPositive,
  multiplyExact,
  validateSplit,
  uomLabel,
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
import { useLanguage } from "@/components/i18n/language-provider";
import { LocalizedText } from "@/components/i18n/language-provider";

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
  const { text: uiText } = useLanguage();

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
    <div className="kho-record">
      <header className="kho-record-header">
        <div className="kho-record-head">
          <div className="kho-record-title">
            <Link href="/inventory/transactions">
              ← {uiText("Lịch sử giao dịch")}
            </Link>
            <OperationBadge operation={transaction.operation} />
            <h2 className="mono">{transaction.business_key}</h2>
            <span className="kho-record-sub">
              {transaction.actor_name || uiText("Hệ thống")} ·{" "}
              {formatInventoryDateTime(transaction.occurred_at)}
            </span>
          </div>
          <div className="kho-record-actions">
            {isOriginalReceive ? (
              <>
                <button
                  ref={correctReceiptBtnRef}
                  type="button"
                  className="button button-secondary text-xs"
                  onClick={() => setCorrectReceiptOpen(true)}
                >
                  <Settings size={14} />
                  {uiText(" Điều chỉnh phiếu nhận (O09)")}
                </button>
                <button
                  ref={reverseReceiptBtnRef}
                  type="button"
                  className="button button-danger text-xs"
                  onClick={() => setReverseReceiptOpen(true)}
                >
                  {uiText("Hủy phiếu nhận (Về 0)")}
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
                <Settings size={14} />
                {uiText(" Điều chỉnh tồn đầu (Admin O10)")}
              </button>
            ) : null}

            {isCorrectionOrReversal && transaction.corrects_transaction_id ? (
              <Link
                href={`/inventory/transactions/${transaction.corrects_transaction_id}`}
                className="button button-secondary text-xs inline-flex items-center gap-1.5"
              >
                <FileClock size={14} />
                {uiText(" Xem giao dịch gốc")}
              </Link>
            ) : null}

            {isS2Operation ? (
              <Link
                href="/inventory/operations"
                className="button button-primary text-xs inline-flex items-center gap-1.5"
              >
                {uiText("Nghiệp vụ kho S2 / Operations →")}
              </Link>
            ) : null}
          </div>
        </div>
      </header>

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
          <span>
            <LocalizedText text={notice.message ?? ""} />
          </span>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 p-1"
            onClick={() => setNotice(null)}
            aria-label={uiText("Đóng thông báo")}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      <div className="kho-record-grid">
        <div className="kho-record-main">
          <section className="kho-card" aria-labelledby="tx-lines">
            <div className="kho-card-head">
              <h3 id="tx-lines">
                {uiText("Dòng sổ cái")}{" "}
                <small>{uiText("· {0} dòng", [lines.length])}</small>
              </h3>
            </div>
            {lines.length === 0 ? (
              <p className="kho-card-body">
                {uiText(
                  "Giao dịch chỉ đính chính chứng từ hoặc hạn dùng; số lượng tồn kho không đổi.",
                )}
              </p>
            ) : (
              <div className="kho-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">{uiText("Vật tư")}</th>
                      <th scope="col">{uiText("Vị trí kho")}</th>
                      <th scope="col">{uiText("Tình trạng")}</th>
                      <th scope="col" className="num">
                        {uiText("Biến động")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const isZero = l.quantity_delta === "0";
                      const isPositiveDelta =
                        !l.quantity_delta.startsWith("-") && !isZero;
                      return (
                        <tr key={l.line_no}>
                          <td>{l.line_no}</td>
                          <th scope="row">
                            <span className="cell-stack">
                              <strong>{l.item_name}</strong>
                              <small>{l.item_code}</small>
                            </span>
                          </th>
                          <td>{l.location_name}</td>
                          <td>
                            <ConditionBadge
                              condition={l.condition as StockCondition}
                            />
                          </td>
                          <td
                            className="num kho-delta"
                            data-sign={
                              isZero
                                ? "zero"
                                : isPositiveDelta
                                  ? "plus"
                                  : "minus"
                            }
                          >
                            {isZero
                              ? "0"
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
          </section>

          {/* Side-by-Side Fact Evidence Comparison */}
          <div className="space-y-4">
            <div>
              <h3 className="kho-section-title">
                {uiText(
                  "Đối chiếu chứng từ nguồn gốc & Phiên bản (Origins & Evidence:",
                )}{" "}
                {origins.length})
              </h3>
              <p className="kho-section-sub">
                {uiText(
                  "Bảo lưu nguyên vẹn bằng chứng mua sắm ban đầu (Fact v0) đối chiếu cùng sự thật hiệu chỉnh hiện thời (Current Fact)",
                )}
              </p>
            </div>

            <div className="space-y-4">
              {origins.map((orig) => {
                const hasUnknown =
                  orig.current_fact.expiry_precision === "unknown";
                const isSelected = selectedOriginId === orig.origin_id;
                const snapshot = orig.original_fact.source_snapshot as
                  Record<string, unknown> | undefined;

                return (
                  <details
                    key={orig.origin_id}
                    id={`cohort-section-${orig.origin_id}`}
                    open={origins.length <= 3 || isSelected}
                    tabIndex={-1}
                    className={`bg-white rounded-xl border overflow-hidden shadow-xs transition-all dark:bg-slate-900 ${
                      isSelected
                        ? "ring-2 ring-indigo-500 border-indigo-400 bg-indigo-50/10 dark:border-indigo-600"
                        : "border-slate-200 dark:border-slate-800"
                    }`}
                  >
                    <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-slate-100 bg-slate-50/60 text-xs dark:border-slate-800 dark:bg-slate-800/40">
                      <div className="flex items-center gap-2">
                        <div>
                          <span className="font-semibold text-slate-800 dark:text-slate-200 font-mono mr-2">
                            [{orig.line_key}]
                          </span>
                          <strong className="text-slate-900 dark:text-slate-100">
                            {orig.item_code} - {orig.item_name}
                          </strong>
                          <span className="text-slate-400 text-[11px] block mt-0.5 font-mono">
                            {uiText("Origin ID: ")}
                            {orig.origin_id}
                          </span>
                        </div>

                        {isSelected ? (
                          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
                            {uiText("Đang xem lô này")}
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
                          title={uiText(
                            "Xem nhật ký bằng chứng kiểm kê / thẩm định",
                          )}
                        >
                          <ClipboardList size={13} />
                          <span>{uiText("Nhật ký bằng chứng")}</span>
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
                          {uiText("Xác minh hạn dùng (Admin O14)")}
                        </button>
                      ) : null}
                    </summary>

                    {/* Side-by-side grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 text-xs dark:divide-slate-800">
                      {/* Left: Original Fact */}
                      <div className="p-4 space-y-3">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                          <span className="font-bold text-slate-700 dark:text-slate-300 uppercase text-[11px]">
                            {uiText("Bằng chứng gốc ban đầu")} (v
                            {String(orig.original_fact.version)})
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            {orig.original_fact.id.slice(0, 8)}…
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-slate-400 block text-[11px]">
                              {uiText("SL Nhập ban đầu:")}
                            </span>
                            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                              {orig.original_fact.purchase_quantity
                                ? `${formatDisplayQuantity(orig.original_fact.purchase_quantity)} ${orig.original_fact.purchase_uom_code}`
                                : uiText("— (Tồn đầu)")}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">
                              {uiText("Hệ số quy đổi:")}
                            </span>
                            <span className="font-mono text-slate-800 dark:text-slate-200">
                              {orig.original_fact.conversion_factor
                                ? uiText("×{0}", [
                                    orig.original_fact.conversion_factor,
                                  ])
                                : "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">
                              {uiText("SL Quy đổi cơ sở:")}
                            </span>
                            <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300">
                              {formatDisplayQuantity(
                                orig.original_fact.base_quantity,
                              )}{" "}
                              {uomLabel(orig)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">
                              {uiText("Tốt / Hỏng ban đầu:")}
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
                              {uiText("Hạn dùng ban đầu:")}
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
                              {uiText("Vị trí tiếp nhận:")}
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
                                {uiText("Bằng chứng hồ sơ nguồn gốc bất biến")}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                {uiText("Snapshot v0")}
                              </span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                              {Boolean(snapshot.source_reference) && (
                                <div>
                                  <span className="text-slate-400 block text-[10px]">
                                    {uiText("Mã hồ sơ nguồn:")}
                                  </span>
                                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                                    {String(snapshot.source_reference)}
                                  </span>
                                </div>
                              )}
                              {Boolean(snapshot.supplier_name) && (
                                <div>
                                  <span className="text-slate-400 block text-[10px]">
                                    {uiText("Nhà cung cấp:")}
                                  </span>
                                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                                    {String(snapshot.supplier_name)}
                                  </span>
                                </div>
                              )}
                              {Boolean(snapshot.unit_cost) && (
                                <div>
                                  <span className="text-slate-400 block text-[10px]">
                                    {uiText("Đơn giá cam kết (INV-018):")}
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
                                    {uiText("Hãng SX / Model / Xuất xứ:")}
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
                                    {uiText("Ghi chú nguồn cam kết:")}
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
                            {uiText("Sự thật hiệu chỉnh hiện thời")} (v
                            {String(orig.current_fact.version)})
                          </span>
                          <span className="text-[11px] font-mono text-slate-400">
                            {orig.current_fact.id.slice(0, 8)}…
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-slate-400 block text-[11px]">
                              {uiText("SL Nhập hiện tại:")}
                            </span>
                            <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                              {orig.current_fact.purchase_quantity
                                ? `${formatDisplayQuantity(orig.current_fact.purchase_quantity)} ${orig.current_fact.purchase_uom_code}`
                                : "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">
                              {uiText("Hệ số quy đổi:")}
                            </span>
                            <span className="font-mono text-slate-800 dark:text-slate-200">
                              {orig.current_fact.conversion_factor
                                ? uiText("×{0}", [
                                    orig.current_fact.conversion_factor,
                                  ])
                                : "—"}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">
                              {uiText("SL Cơ sở hiện tại:")}
                            </span>
                            <span className="font-mono font-bold text-indigo-700 dark:text-indigo-300">
                              {formatDisplayQuantity(
                                orig.current_fact.base_quantity,
                              )}{" "}
                              {uomLabel(orig)}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px]">
                              {uiText("Tốt / Hỏng hiện thời:")}
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
                              {uiText("Hạn dùng hiện thời:")}
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
                              {uiText("Vị trí kho hiện tại:")}
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
                          {uiText(
                            "Tồn kho thực tế còn lại của lô này (Remaining Balance):",
                          )}
                        </span>
                        <div className="flex items-center gap-3">
                          {orig.balances.map((b, bi) => (
                            <span key={bi} className="font-mono">
                              <strong className="text-slate-900 dark:text-slate-100">
                                {formatDisplayQuantity(b.quantity)}
                              </strong>{" "}
                              <span className="text-slate-500 dark:text-slate-400 font-sans">
                                (
                                {b.condition === "good"
                                  ? uiText("Tốt")
                                  : uiText("Hỏng")}
                                {uiText(" tại")} {b.location_name})
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </details>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="kho-record-aside">
          <dl className="kho-summary">
            <dt>{uiText("Người thực hiện")}</dt>
            <dd>{transaction.actor_name || uiText("Hệ thống")}</dd>
            <dt>{uiText("Phát sinh")}</dt>
            <dd>{formatInventoryDateTime(transaction.occurred_at)}</dd>
            <dt>{uiText("Ghi sổ")}</dt>
            <dd>{formatInventoryDateTime(transaction.posted_at)}</dd>
            <dt>{uiText("Đính chính cho")}</dt>
            <dd>
              {transaction.corrects_transaction_id ? (
                <Link
                  href={`/inventory/transactions/${transaction.corrects_transaction_id}`}
                >
                  {uiText("Giao dịch gốc")}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt>{uiText("Lý do")}</dt>
            <dd>{transaction.reason || "—"}</dd>
          </dl>
        </aside>
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
  const { text: uiText } = useLanguage();

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
      const newBase = mult.valid && mult.result ? mult.result : "";

      return {
        orig,
        oldFact,
        newBase,
        diffGood: formatQuantityDelta(l.good_quantity, oldFact.good_quantity),
        diffDamaged: formatQuantityDelta(
          l.damaged_quantity,
          oldFact.damaged_quantity,
        ),
        diffBase: formatQuantityDelta(newBase, oldFact.base_quantity),
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
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="correct-receipt-dialog-title"
    >
      <DialogKeyboard onClose={onClose} pending={isPending} />
      <div className="relative w-full max-w-3xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/40">
          <h3
            id="correct-receipt-dialog-title"
            className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider"
          >
            {uiText("Điều chỉnh phiếu nhận")}
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1 dark:hover:text-slate-200"
            onClick={onClose}
            aria-label={uiText("Đóng")}
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
              {uiText("Lý do điều chỉnh (Bắt buộc theo INV-018)")}{" "}
              <span className="text-red-500">*</span>
            </label>
            <textarea
              id="correct-receipt-reason"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              rows={2}
              placeholder={uiText("VD: Sai sót hệ số quy đổi lúc nhập kho...")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>

          <div className="space-y-4">
            <span className="font-bold text-slate-800 dark:text-slate-200 block">
              {uiText("Dòng vật tư cần điều chỉnh sự thật (")}
              {lines.length})
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
                        {uiText("Vị trí kho")}
                      </label>
                      <select
                        aria-label={uiText("Vị trí kho dòng {0}", [i + 1])}
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
                        {uiText("SL Giao")}
                      </label>
                      <input
                        aria-label={uiText("SL Giao dòng {0}", [i + 1])}
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
                        {uiText("Hệ số quy đổi")}
                      </label>
                      <input
                        aria-label={uiText("Hệ số quy đổi dòng {0}", [i + 1])}
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
                        {uiText("SL Tốt")}
                      </label>
                      <input
                        aria-label={uiText("SL Tốt dòng {0}", [i + 1])}
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
                        {uiText("SL Hỏng")}
                      </label>
                      <input
                        aria-label={uiText("SL Hỏng dòng {0}", [i + 1])}
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
                      {uiText("Đơn vị nhập")}
                      <select
                        aria-label={uiText("Đơn vị nhập dòng {0}", [i + 1])}
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
                      {uiText("Độ chính xác HSD")}
                      <select
                        aria-label={uiText("Độ chính xác HSD dòng {0}", [
                          i + 1,
                        ])}
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
                        <option value="not_required">
                          {uiText("Không yêu cầu")}
                        </option>
                        <option value="day">{uiText("Theo ngày")}</option>
                        <option value="month">{uiText("Theo tháng")}</option>
                      </select>
                    </label>
                    <label className="block text-[10px] text-slate-500">
                      {uiText("Hạn dùng (YYYY-MM-DD hoặc YYYY-MM)")}
                      <input
                        aria-label={uiText("Hạn dùng dòng {0}", [i + 1])}
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
                            {uiText("Trước điều chỉnh (Fact hiện thời):")}
                          </span>
                          <span className="font-mono text-slate-700 dark:text-slate-300">
                            {uiText("Cơ sở: ")}
                            {preview.oldFact.base_quantity}
                            {uiText(" (Tốt:")} {preview.oldFact.good_quantity}
                            {uiText(" / Hỏng:")}{" "}
                            {preview.oldFact.damaged_quantity})
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                            {uiText("Dự kiến sau điều chỉnh (Intended Fact):")}
                          </span>
                          <span className="font-mono font-semibold text-indigo-900 dark:text-indigo-200">
                            {uiText("Cơ sở: ")}
                            {preview.newBase}
                            {uiText(" (Tốt: ")}
                            {l.good_quantity}
                            {uiText(" / Hỏng: ")}
                            {l.damaged_quantity})
                          </span>
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                            {uiText("Dự kiến biến động sổ cái (Signed Delta):")}
                          </span>
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            {uiText("ΔTốt: ")}
                            {preview.diffGood}
                            {uiText(" &bull; ΔHỏng:")} {preview.diffDamaged}
                            {uiText(" &bull; ΔCơ sở:")} {preview.diffBase}
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">
                        {uiText(
                          "* Máy chủ là cơ quan thẩm quyền duy nhất tính toán và ghi nhận biến động sổ cái (server authority). Biểu mẫu chỉ gửi sự thật dự kiến, không gửi client delta.",
                        )}
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
              {isPending
                ? uiText("Đang ghi sổ…")
                : uiText("Ghi nhận điều chỉnh mới")}
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
  const { text: uiText } = useLanguage();

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
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reverse-receipt-dialog-title"
    >
      <DialogKeyboard onClose={onClose} pending={isPending} />
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/40">
          <h3
            id="reverse-receipt-dialog-title"
            className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider"
          >
            {uiText("Hủy phiếu nhận")}
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1 dark:hover:text-slate-200"
            onClick={onClose}
            aria-label={uiText("Đóng")}
            disabled={isPending}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {uiText(
              "Thao tác hủy phiếu sẽ đưa toàn bộ số lượng thực nhận của phiếu này về ",
            )}
            <strong>0</strong>
            {uiText(
              ". Lịch sử gốc ban đầu được lưu vết nguyên vẹn và số dư sổ cái được trừ bù tương ứng.",
            )}
          </p>

          <div>
            <label
              htmlFor="reverse-receipt-reason"
              className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
            >
              {uiText("Lý do hủy phiếu ")}
              <span className="text-red-500">*</span>
            </label>
            <textarea
              id="reverse-receipt-reason"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              rows={3}
              placeholder={uiText(
                "VD: Hóa đơn bị hủy do nhà cung cấp giao nhầm đợt...",
              )}
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
              {uiText("Quay lại")}
            </button>
            <button
              type="submit"
              className="button button-danger text-xs"
              disabled={isPending}
            >
              {isPending
                ? uiText("Đang hủy…")
                : uiText("Xác nhận hủy phiếu về 0")}
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
  const { text: uiText } = useLanguage();

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

      return {
        orig,
        oldFact,
        diffBase: formatQuantityDelta(l.base_quantity, oldFact.base_quantity),
        diffGood: formatQuantityDelta(l.good_quantity, oldFact.good_quantity),
        diffDamaged: formatQuantityDelta(
          l.damaged_quantity,
          oldFact.damaged_quantity,
        ),
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
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="correct-opening-dialog-title"
    >
      <DialogKeyboard onClose={onClose} pending={isPending} />
      <div className="relative w-full max-w-3xl bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/40">
          <h3
            id="correct-opening-dialog-title"
            className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider"
          >
            {uiText("Điều chỉnh tồn đầu kỳ")}
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1 dark:hover:text-slate-200"
            onClick={onClose}
            aria-label={uiText("Đóng")}
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
              {uiText("Lý do điều chỉnh kiểm kê ")}
              <span className="text-red-500">*</span>
            </label>
            <textarea
              id="correct-opening-reason"
              className="w-full text-xs border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              rows={2}
              placeholder={uiText(
                "VD: Kiểm đếm lại vị trí Phòng Lab phát hiện thừa/thiếu...",
              )}
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
                        {uiText("Vị trí kho")}
                      </label>
                      <select
                        aria-label={uiText("Vị trí kho dòng {0}", [i + 1])}
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
                        {uiText("SL Cơ sở")}
                      </label>
                      <input
                        aria-label={uiText("SL Cơ sở dòng {0}", [i + 1])}
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
                        {uiText("SL Tốt")}
                      </label>
                      <input
                        aria-label={uiText("SL Tốt dòng {0}", [i + 1])}
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
                        {uiText("SL Hỏng")}
                      </label>
                      <input
                        aria-label={uiText("SL Hỏng dòng {0}", [i + 1])}
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
                        {uiText("Độ chính xác HSD")}
                      </label>
                      <select
                        aria-label={uiText("Độ chính xác HSD dòng {0}", [
                          i + 1,
                        ])}
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
                        <option value="not_required">
                          {uiText("Không yêu cầu")}
                        </option>
                        <option value="unknown">
                          {uiText("Chưa rõ (Unknown)")}
                        </option>
                        <option value="day">{uiText("Theo ngày")}</option>
                        <option value="month">{uiText("Theo tháng")}</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] text-slate-500">
                        {uiText("Hạn dùng (YYYY-MM-DD hoặc YYYY-MM)")}
                      </label>
                      <input
                        aria-label={uiText("Hạn dùng dòng {0}", [i + 1])}
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
                        {uiText("Ghi chú bằng chứng (bắt buộc khi bỏ Unknown)")}
                      </label>
                      <input
                        aria-label={uiText("Ghi chú bằng chứng dòng {0}", [
                          i + 1,
                        ])}
                        className="w-full text-xs border border-slate-300 rounded p-1.5 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                        placeholder={uiText("VD: Nhãn chai LOT-123...")}
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
                            {uiText("Trước điều chỉnh (Fact hiện thời):")}
                          </span>
                          <span className="font-mono text-slate-700 dark:text-slate-300">
                            {uiText("Cơ sở: ")}
                            {preview.oldFact.base_quantity}
                            {uiText(" (Tốt:")} {preview.oldFact.good_quantity}
                            {uiText(" / Hỏng:")}{" "}
                            {preview.oldFact.damaged_quantity})
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                            {uiText("Dự kiến sau điều chỉnh (Intended Fact):")}
                          </span>
                          <span className="font-mono font-semibold text-indigo-900 dark:text-indigo-200">
                            {uiText("Cơ sở: ")}
                            {l.base_quantity}
                            {uiText(" (Tốt: ")}
                            {l.good_quantity}
                            {uiText(" / Hỏng: ")}
                            {l.damaged_quantity})
                          </span>
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <span className="text-slate-500 dark:text-slate-400 block text-[10px]">
                            {uiText("Dự kiến biến động sổ cái (Signed Delta):")}
                          </span>
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            {uiText("ΔTốt: ")}
                            {preview.diffGood}
                            {uiText(" &bull; ΔHỏng:")} {preview.diffDamaged}
                            {uiText(" &bull; ΔCơ sở:")} {preview.diffBase}
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">
                        {uiText(
                          "* Máy chủ là cơ quan thẩm quyền duy nhất tính toán và ghi nhận biến động sổ cái (server authority). Biểu mẫu chỉ gửi sự thật dự kiến, không gửi client delta.",
                        )}
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
              {isPending
                ? uiText("Đang ghi sổ…")
                : uiText("Ghi nhận điều chỉnh kiểm kê")}
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
  const { text: uiText } = useLanguage();

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
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verify-expiry-dialog-title"
    >
      <DialogKeyboard onClose={onClose} pending={isPending} />
      <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-800/40">
          <h3
            id="verify-expiry-dialog-title"
            className="text-sm font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider"
          >
            {uiText("Xác minh hạn dùng")}
          </h3>
          <button
            type="button"
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1 dark:hover:text-slate-200"
            onClick={onClose}
            aria-label={uiText("Đóng")}
            disabled={isPending}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 text-xs dark:bg-slate-800/50 dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400 block text-[11px]">
              {uiText("Đối tượng vật tư:")}
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
                {uiText("Độ chính xác ")}
                <span className="text-red-500">*</span>
              </label>
              <select
                id="verify-expiry-precision"
                className="w-full text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
                value={precision}
                onChange={(e) =>
                  setPrecision(e.target.value as "day" | "month")
                }
              >
                <option value="day">{uiText("Theo ngày (YYYY-MM-DD)")}</option>
                <option value="month">{uiText("Theo tháng (YYYY-MM)")}</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="verify-expiry-input"
                className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                {uiText("Hạn sử dụng thẩm tra ")}
                <span className="text-red-500">*</span>
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
              {uiText("Bằng chứng thẩm tra thực tế")}{" "}
              <span className="text-red-500">*</span>
            </label>
            <input
              id="verify-expiry-evidence"
              type="text"
              className="w-full text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              placeholder={uiText(
                "VD: Kiểm tra nhãn phụ trên vỏ chai, số lô LOT-12345...",
              )}
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
              {uiText("Lý do xác minh ")}
              <span className="text-red-500">*</span>
            </label>
            <textarea
              id="verify-expiry-reason"
              className="w-full text-xs border border-slate-300 rounded p-2 focus:ring-1 focus:ring-indigo-500 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-100"
              rows={2}
              placeholder={uiText("Nhập lý do chi tiết...")}
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
              {isPending
                ? uiText("Đang xác minh…")
                : uiText("Xác nhận hạn dùng ngay")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
