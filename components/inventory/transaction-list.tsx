"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { formatInventoryDateTime } from "@/lib/inventory/dates";
import { OperationBadge } from "./status-badge";
import { PaginationControls } from "@/components/pagination-controls";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type {
  InventoryTransaction,
  TransactionOperationType,
} from "@/lib/inventory/types";
import { useLanguage } from "@/components/i18n/language-provider";

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

const operations: Array<[string, string]> = [
  ["RECEIVE", "Nhận kho"],
  ["OPENING", "Tồn đầu kỳ"],
  ["CORRECT_RECEIPT", "Điều chỉnh phiếu nhận"],
  ["REVERSE_RECEIPT", "Hủy phiếu nhận"],
  ["CORRECT_OPENING", "Điều chỉnh tồn đầu kỳ"],
  ["TRANSFER", "Điều chuyển kho"],
  ["CONDITION_CHANGE", "Đổi tình trạng"],
  ["STOCKTAKE_ADJUST", "Điều chỉnh kiểm kê"],
  ["STOCKTAKE_SURPLUS", "Dư thừa kiểm kê"],
  ["VERIFY_SURPLUS", "Thẩm định dư thừa"],
  ["ASSET_RECEIVE", "Nhận tài sản"],
  ["ASSET_OPEN", "Tài sản đầu kỳ"],
  ["ASSET_SET_STATE", "Hiện trạng tài sản"],
  ["ASSET_SET_LIFECYCLE", "Vòng đời tài sản"],
  ["ASSET_CORRECT", "Đính chính tài sản"],
];

/** Ledger history in the Kho list pattern (UI Master 0A.4): filters, table, pages. */
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
  const { text } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const transactions = propTransactions ?? initialTransactions ?? [];
  const total = totalTransactions ?? transactions.length;
  const filtered =
    Boolean(currentQ.trim()) ||
    currentOperation !== "all" ||
    currentSort !== "posted_desc";

  function go(values: {
    q?: string;
    operation?: string;
    sort?: string;
    page?: number;
  }) {
    const params = new URLSearchParams();
    const next = {
      q: currentQ,
      operation: currentOperation,
      sort: currentSort,
      ...values,
    };
    if (next.q?.trim()) params.set("q", next.q.trim());
    if (next.operation && next.operation !== "all")
      params.set("operation", next.operation);
    if (next.sort && next.sort !== "posted_desc") params.set("sort", next.sort);
    if (values.page && values.page > 1) params.set("page", String(values.page));
    router.push(params.size ? `${pathname}?${params}` : pathname);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    go({
      q: String(form.get("q") ?? ""),
      operation: String(form.get("operation") ?? "all"),
      sort: String(form.get("sort") ?? "posted_desc"),
    });
  }

  return (
    <>
      <form
        className="list-filters"
        onSubmit={submit}
        key={`${currentQ}|${currentOperation}|${currentSort}`}
      >
        <label>
          {text("Tìm kiếm")}
          <input
            name="q"
            defaultValue={currentQ}
            placeholder={text("Mã nghiệp vụ, lý do, người thực hiện")}
          />
        </label>
        <label>
          {text("Nghiệp vụ")}
          <select name="operation" defaultValue={currentOperation}>
            <option value="all">{text("Tất cả")}</option>
            {operations.map(([value, label]) => (
              <option key={value} value={value}>
                {text(label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text("Sắp xếp")}
          <select name="sort" defaultValue={currentSort}>
            <option value="posted_desc">{text("Mới nhất trước")}</option>
            <option value="posted_asc">{text("Cũ nhất trước")}</option>
          </select>
        </label>
        <div className="list-filters-actions">
          <button type="submit" className="button button-primary">
            {text("Lọc")}
          </button>
          {filtered ? (
            <Link href={pathname} className="button button-secondary">
              {text("Xóa bộ lọc")}
            </Link>
          ) : null}
          <span className="inline-toolbar-count">
            {text("{0} giao dịch", [total])}
          </span>
        </div>
      </form>

      {transactions.length === 0 ? (
        <p className="panel-empty">
          {filtered
            ? text("Không có giao dịch nào khớp bộ lọc.")
            : text("Chưa có giao dịch nào được ghi sổ.")}
        </p>
      ) : (
        <div className="data-panel">
          <div className="responsive-table kho-list">
            <table className="data-table records-on-phone">
              <thead>
                <tr>
                  <th>{text("Nghiệp vụ")}</th>
                  <th>{text("Mã nghiệp vụ")}</th>
                  <th>{text("Thời điểm")}</th>
                  <th>{text("Người thực hiện")}</th>
                  <th>{text("Lý do")}</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="row-link"
                    onClick={() =>
                      router.push(`/inventory/transactions/${tx.id}`)
                    }
                  >
                    <td data-label={text("Nghiệp vụ")}>
                      <OperationBadge
                        operation={tx.operation as TransactionOperationType}
                      />
                    </td>
                    <td data-label={text("Mã nghiệp vụ")}>
                      <span className="cell-stack">
                        <Link
                          href={`/inventory/transactions/${tx.id}`}
                          onClick={(event) => event.stopPropagation()}
                        >
                          {tx.business_key}
                        </Link>
                        {tx.corrects_transaction_id ? (
                          <small>
                            {text("Sửa giao dịch {0}", [
                              tx.corrects_transaction_id.slice(0, 8),
                            ])}
                          </small>
                        ) : null}
                      </span>
                    </td>
                    <td data-label={text("Thời điểm")}>
                      <span className="cell-stack">
                        <span>{formatInventoryDateTime(tx.occurred_at)}</span>
                        <small>
                          {text("Ghi sổ {0}", [
                            formatInventoryDateTime(tx.posted_at),
                          ])}
                        </small>
                      </span>
                    </td>
                    <td data-label={text("Người thực hiện")}>
                      {tx.actor_name || text("Hệ thống")}
                    </td>
                    <td data-label={text("Lý do")}>{tx.reason || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PaginationControls
        currentPage={currentPage}
        totalItems={total}
        onPageChange={(page) => go({ page })}
        pageSize={pageSize}
      />
    </>
  );
}
