"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "@/components/icons";
import { formatInventoryDateTime } from "@/lib/inventory/dates";
import { OperationBadge } from "./status-badge";
import { PaginationControls } from "@/components/pagination-controls";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type {
  InventoryTransaction,
  TransactionOperationType,
} from "@/lib/inventory/types";

export interface TransactionListProps {
  transactions?: InventoryTransaction[];
  initialTransactions?: InventoryTransaction[];
  totalTransactions?: number;
  currentPage?: number;
  pageSize?: number;
  currentQ?: string;
  currentOperation?: string;
  currentSort?: string;
}

export function TransactionList({
  transactions: propTransactions,
  initialTransactions,
  totalTransactions,
  currentPage = 1,
  pageSize = TABLE_PAGE_SIZE,
  currentQ = "",
  currentOperation = "all",
  currentSort = "posted_desc",
}: TransactionListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const transactions = propTransactions ?? initialTransactions ?? [];
  const total = totalTransactions ?? transactions.length;

  const [search, setSearch] = useState(currentQ);

  const [prevQ, setPrevQ] = useState(currentQ);
  if (prevQ !== currentQ) {
    setPrevQ(currentQ);
    setSearch(currentQ);
  }

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
          (key === "operation" && val === "all") ||
          (key === "sort" && val === "posted_desc")
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

  const hasActiveFilters = Boolean(
    (currentQ && currentQ.trim() !== "") ||
    (currentOperation && currentOperation !== "all") ||
    (currentSort && currentSort !== "posted_desc"),
  );

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateParams({ q: search.trim() || undefined, page: 1 });
  }

  function clearFilters() {
    setSearch("");
    updateParams({
      q: undefined,
      operation: undefined,
      sort: undefined,
      page: 1,
    });
  }

  return (
    <div className="space-y-4">
      {/* Filters Toolbar */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Search: business_key, reason, actor_name */}
          <form
            onSubmit={handleSearchSubmit}
            className="sm:col-span-2 relative"
          >
            <Search
              className="absolute left-3 top-2.5 text-slate-400"
              size={16}
            />
            <input
              aria-label="Tìm giao dịch / Search transactions"
              type="text"
              className="w-full text-xs pl-9 pr-8 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Tìm theo mã nghiệp vụ, lý do, người thực hiện... / Search key, reason, actor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => {
                if (search !== currentQ) {
                  updateParams({ q: search.trim() || undefined, page: 1 });
                }
              }}
            />
            {search ? (
              <button
                type="button"
                aria-label="Xóa ô tìm kiếm"
                onClick={() => {
                  setSearch("");
                  updateParams({ q: undefined, page: 1 });
                }}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            ) : null}
          </form>

          {/* Operation Filter */}
          <div>
            <select
              aria-label="Lọc nghiệp vụ / Filter operation"
              className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              value={currentOperation}
              onChange={(e) => {
                updateParams({ operation: e.target.value, page: 1 });
              }}
            >
              <option value="all">Tất cả nghiệp vụ / All Operations</option>
              <option value="RECEIVE">Nhận kho / RECEIVE</option>
              <option value="OPENING">Tồn đầu kỳ / OPENING</option>
              <option value="CORRECT_RECEIPT">
                Điều chỉnh nhận / CORRECT_RECEIPT
              </option>
              <option value="REVERSE_RECEIPT">
                Hủy phiếu nhận / REVERSE_RECEIPT
              </option>
              <option value="CORRECT_OPENING">
                Điều chỉnh tồn đầu / CORRECT_OPENING
              </option>
              <option value="TRANSFER">Điều chuyển kho / TRANSFER</option>
              <option value="CONDITION_CHANGE">
                Hạ phẩm cấp / CONDITION_CHANGE
              </option>
              <option value="STOCKTAKE_ADJUST">
                Điều chỉnh kiểm kê / STOCKTAKE_ADJUST
              </option>
              <option value="STOCKTAKE_SURPLUS">
                Dư thừa kiểm kê / STOCKTAKE_SURPLUS
              </option>
              <option value="VERIFY_SURPLUS">
                Thẩm định dư thừa / VERIFY_SURPLUS
              </option>
            </select>
          </div>
        </div>

        {/* Sort & Filter Status */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-medium">Sắp xếp / Sort:</span>
            <select
              aria-label="Sắp xếp giao dịch / Sort transactions"
              className="text-xs py-1 px-2 border border-slate-300 rounded-md bg-white text-slate-700"
              value={currentSort}
              onChange={(e) => updateParams({ sort: e.target.value, page: 1 })}
            >
              <option value="posted_desc">
                Mới nhất trước / Newest posted
              </option>
              <option value="posted_asc">Cũ nhất trước / Oldest posted</option>
            </select>
          </div>

          {hasActiveFilters ? (
            <div className="flex items-center gap-3 text-slate-500">
              <span>
                Tìm thấy <strong>{total}</strong> kết quả lọc
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold"
                onClick={clearFilters}
              >
                <X size={14} /> Xóa bộ lọc / Clear filters
              </button>
            </div>
          ) : (
            <span className="text-slate-400">
              Tổng số giao dịch: <strong>{total}</strong>
            </span>
          )}
        </div>
      </div>

      {/* Distinction notice between Physical Adjustment vs Document Correction */}
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-xs flex items-start gap-2.5">
        <div className="text-blue-600 font-bold mt-0.5 shrink-0">ℹ</div>
        <div className="space-y-0.5">
          <span className="font-semibold text-slate-900 block">
            Phân biệt Điều chỉnh Thực tế (S2) vs Sửa chứng từ gốc (S1):
          </span>
          <p className="text-slate-600 leading-relaxed">
            • <strong>STOCKTAKE_ADJUST / TRANSFER / CONDITION_CHANGE:</strong>{" "}
            Giao dịch vận hành thực tế tại kho hiện tại, bảo toàn lịch sử và
            không ghi đè chứng từ nhận ban đầu.
            <br />• <strong>CORRECT_RECEIPT / CORRECT_OPENING:</strong> Sửa đổi
            sai sót hành chính trên chứng từ gốc khi chưa có biến động kho phái
            sinh.
          </p>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th scope="col" className="py-3 px-4">
                  Nghiệp vụ / Operation
                </th>
                <th scope="col" className="py-3 px-4">
                  Mã nghiệp vụ / Key
                </th>
                <th scope="col" className="py-3 px-4">
                  Thời điểm phát sinh
                </th>
                <th scope="col" className="py-3 px-4">
                  Thời điểm ghi sổ
                </th>
                <th scope="col" className="py-3 px-4">
                  Người thực hiện
                </th>
                <th scope="col" className="py-3 px-4">
                  Lý do / Reason
                </th>
                <th scope="col" className="py-3 px-4">
                  Tham chiếu gốc
                </th>
                <th scope="col" className="py-3 px-4 text-right">
                  Chi tiết
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    {hasActiveFilters
                      ? "Không tìm thấy giao dịch nào phù hợp với bộ lọc."
                      : "Chưa có giao dịch sổ cái nào được ghi nhận."}
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <OperationBadge
                        operation={tx.operation as TransactionOperationType}
                      />
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                      {tx.business_key}
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {formatInventoryDateTime(tx.occurred_at)}
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                      {formatInventoryDateTime(tx.posted_at)}
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800">
                      {tx.actor_name || "Hệ thống"}
                    </td>
                    <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                      {tx.reason || "—"}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-slate-500">
                      {tx.corrects_transaction_id ? (
                        <Link
                          href={`/inventory/transactions/${tx.corrects_transaction_id}`}
                          className="text-blue-600 hover:underline"
                        >
                          {tx.corrects_transaction_id.slice(0, 8)}...
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        href={`/inventory/transactions/${tx.id}`}
                        className="button button-secondary text-[11px] py-1 px-2.5"
                      >
                        Xem &rarr;
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Hiển thị {transactions.length} trên tổng số <strong>{total}</strong>{" "}
            giao dịch
          </span>
          <PaginationControls
            currentPage={currentPage}
            totalItems={total}
            onPageChange={(p) => updateParams({ page: p })}
            pageSize={pageSize}
          />
        </div>
      </div>
    </div>
  );
}
