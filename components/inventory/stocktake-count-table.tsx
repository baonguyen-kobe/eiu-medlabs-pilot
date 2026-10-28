"use client";

import React from "react";
import { Search } from "@/components/icons";
import {
  compareExact,
  formatDisplayQuantity,
  isNonNegative,
  subtractExact,
  validateDecimalString,
} from "@/lib/inventory/decimal";
import {
  ConditionBadge,
  HoldStatusBadge,
} from "@/components/inventory/status-badge";
import { PaginationControls } from "@/components/pagination-controls";
import type { StockCondition } from "@/lib/inventory/types";
import { useLanguage } from "@/components/i18n/language-provider";

const STOCK_PAGE_SIZE = 20;

export interface CountRowData {
  originId: string;
  currentFactVersion: number | string;
  stockRevision: number | string;
  catalogItemId: string;
  itemCode: string;
  itemName: string;
  condition: StockCondition;
  expectedQuantity: string;
  baseUomCode: string;
  isHeld: boolean;
  holdReason: string | null;
}

export interface CountObservation {
  row: CountRowData;
  snapshotFactVersion: number | string;
  snapshotStockRevision: number | string;
  snapshotExpectedQuantity: string;
  countedQuantity: string;
  includedInCount: boolean;
  isStale?: boolean;
}

export interface StocktakeCountTableProps {
  currentPageStock: CountRowData[];
  countedMap: Record<string, CountObservation>;
  totalStockCount: number;
  stockPage: number;
  stockSearch: string;
  isLoadingStock: boolean;
  onSearchChange: (q: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onPageChange: (page: number) => void;
  onUpdateCountedQuantity: (
    originId: string,
    condition: StockCondition,
    value: string,
  ) => void;
  onToggleInclude: (originId: string, condition: StockCondition) => void;
  onRecount?: (originId: string, condition: StockCondition) => void;
}

export function StocktakeCountTable({
  currentPageStock,
  countedMap,
  totalStockCount,
  stockPage,
  stockSearch,
  isLoadingStock,
  onSearchChange,
  onSearchSubmit,
  onPageChange,
  onUpdateCountedQuantity,
  onToggleInclude,
  onRecount,
}: StocktakeCountTableProps) {
  const { text: uiText } = useLanguage();

  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            {uiText("1. Đối chiếu Lô tồn kho hiện có / Existing Cohorts (")}
            {totalStockCount}
            {uiText(" lô tại kho)")}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {uiText(
              "Nhập số lượng thực tế đếm được. Hệ thống tính toán chênh lệch (Delta) và ghi nhận cả các lô khớp số liệu (Delta = 0) thành bằng chứng kiểm kê.",
            )}
          </p>
        </div>

        {/* Search form */}
        <form onSubmit={onSearchSubmit} className="flex items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-2.5 text-slate-400"
            />
            <input
              type="text"
              value={stockSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={uiText("Tìm SKU, tên vật tư...")}
              className="text-xs pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 w-52"
            />
          </div>
          <button
            type="submit"
            className="button button-secondary text-xs py-1.5 px-3"
          >
            {uiText("Tìm")}
          </button>
        </form>
      </div>

      {isLoadingStock ? (
        <div className="text-center py-8 text-xs text-purple-600 font-medium animate-pulse">
          {uiText("Đang tải danh sách tồn kho kiểm đếm...")}
        </div>
      ) : currentPageStock.length === 0 ? (
        <p className="text-xs text-slate-400 py-6 text-center">
          {uiText(
            "Kho này hiện không có lô vật tư nào còn số dư hoặc khớp bộ lọc tìm kiếm. Bạn có thể ghi nhận hàng thừa ở phần 2 dưới đây.",
          )}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[11px]">
                  <th className="py-2.5 px-3 w-10 text-center">
                    {uiText("Ghi nhận")}
                  </th>
                  <th className="py-2.5 px-3">
                    {uiText("Lô ")}
                    {"&"}
                    {uiText(" Vật tư")}
                  </th>
                  <th className="py-2.5 px-3">{uiText("Tình trạng")}</th>
                  <th className="py-2.5 px-3">{uiText("Trạng thái giữ")}</th>
                  <th className="py-2.5 px-3 text-right">
                    {uiText("Tồn sổ sách")}
                  </th>
                  <th className="py-2.5 px-3 text-right w-44">
                    {uiText("SL Thực tế đếm *")}
                  </th>
                  <th className="py-2.5 px-3 text-right">
                    {uiText("Chênh lệch (Delta)")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {currentPageStock.map((row) => {
                  const rowKey = `${row.originId}:${row.condition}`;
                  const state = countedMap[rowKey] || {
                    row,
                    countedQuantity: row.expectedQuantity,
                    includedInCount: true,
                  };

                  const val = validateDecimalString(state.countedQuantity, 6);
                  const isNonNeg =
                    val.valid &&
                    val.normalized &&
                    isNonNegative(val.normalized);

                  let delta = "0";
                  let deltaType: "match" | "surplus" | "shortage" = "match";

                  if (isNonNeg && val.normalized) {
                    delta = subtractExact(
                      val.normalized,
                      state.snapshotExpectedQuantity,
                    );
                    if (
                      compareExact(
                        val.normalized,
                        state.snapshotExpectedQuantity,
                      ) > 0
                    ) {
                      deltaType = "surplus";
                    } else if (
                      compareExact(
                        val.normalized,
                        state.snapshotExpectedQuantity,
                      ) < 0
                    ) {
                      deltaType = "shortage";
                    }
                  }

                  return (
                    <tr
                      key={rowKey}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        !state.includedInCount ? "opacity-40 bg-slate-50" : ""
                      }`}
                    >
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={state.includedInCount}
                          onChange={() =>
                            onToggleInclude(row.originId, row.condition)
                          }
                          className="rounded text-purple-600 focus:ring-purple-500"
                          title={uiText(
                            "Tích chọn để đưa vào biên bản kiểm kê",
                          )}
                        />
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-900">
                            {row.itemCode} - {row.itemName}
                          </span>
                          {state.isStale ? (
                            <span className="badge bg-amber-100 text-amber-900 border-amber-300 font-bold text-[10px] animate-pulse shrink-0">
                              {uiText("Lỗi thời (Stale)")}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono mt-0.5">
                          <span>
                            {uiText("Lô: ")}
                            {row.originId.slice(0, 8)}
                            {uiText("... | Phiên bản kho: r")}
                            {state.snapshotStockRevision}
                          </span>
                          {state.isStale && onRecount ? (
                            <button
                              type="button"
                              onClick={() =>
                                onRecount(row.originId, row.condition)
                              }
                              className="button button-secondary text-[10px] py-0 px-1.5 text-amber-800 bg-amber-50 border-amber-200 font-semibold"
                            >
                              {uiText("Đếm lại / Recount")}
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <ConditionBadge condition={row.condition} />
                      </td>
                      <td className="py-3 px-3">
                        <HoldStatusBadge
                          isHeld={row.isHeld}
                          holdReason={row.holdReason}
                        />
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-slate-700">
                        {formatDisplayQuantity(row.expectedQuantity)}{" "}
                        {row.baseUomCode}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <input
                            type="text"
                            disabled={!state.includedInCount}
                            value={state.countedQuantity}
                            onChange={(e) =>
                              onUpdateCountedQuantity(
                                row.originId,
                                row.condition,
                                e.target.value,
                              )
                            }
                            className={`w-28 text-right font-mono text-xs py-1.5 px-2 border rounded-lg focus:ring-2 ${
                              !val.valid || !isNonNeg
                                ? "border-rose-400 bg-rose-50/50 focus:ring-rose-500"
                                : "border-slate-300 focus:ring-purple-500"
                            }`}
                          />
                          <span className="text-slate-500 font-medium">
                            {row.baseUomCode}
                          </span>
                        </div>
                        {state.isStale ? (
                          <p className="text-[11px] text-amber-700 font-medium mt-1 text-right">
                            {uiText('Số dư kho đã đổi! Bấm "Đếm lại"')}
                          </p>
                        ) : !val.valid ? (
                          <p className="text-[11px] text-rose-600 mt-1 text-right">
                            {state.countedQuantity === ""
                              ? uiText("Bắt buộc nhập số lượng")
                              : val.error}
                          </p>
                        ) : !isNonNeg ? (
                          <p className="text-[11px] text-rose-600 mt-1 text-right">
                            {uiText("Không được âm")}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold">
                        {!val.valid || state.isStale ? (
                          <span className="text-slate-400">—</span>
                        ) : deltaType === "match" ? (
                          <span className="text-slate-400">
                            {uiText("0 (Khớp)")}
                          </span>
                        ) : deltaType === "surplus" ? (
                          <span className="text-emerald-700 font-bold">
                            +{formatDisplayQuantity(delta)} {row.baseUomCode}{" "}
                            {uiText("(Thừa)")}
                          </span>
                        ) : (
                          <span className="text-rose-600 font-bold">
                            {formatDisplayQuantity(delta)} {row.baseUomCode}{" "}
                            {uiText("(Thiếu)")}
                          </span>
                        )}
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
              {uiText("Hiển thị trang ")}
              {stockPage}
              {uiText(" trên tổng số ")}
              {totalStockCount}
              {uiText(" lô tồn")}
            </span>
            <PaginationControls
              currentPage={stockPage}
              totalItems={totalStockCount}
              pageSize={STOCK_PAGE_SIZE}
              onPageChange={onPageChange}
            />
          </div>
        </>
      )}
    </div>
  );
}
