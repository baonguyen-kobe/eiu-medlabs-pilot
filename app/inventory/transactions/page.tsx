import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { inventoryRead } from "@/lib/inventory/client";
import { TransactionList } from "@/components/inventory/transaction-list";
import { PageHeader } from "@/components/patterns/page-header";
import { normalizePage, TABLE_PAGE_SIZE } from "@/lib/pagination";
import type { InventoryTransaction } from "@/lib/inventory/types";

interface TransactionsPageProps {
  searchParams: Promise<{
    q?: string;
    operation?: string;
    sort?: string;
    page?: string;
    page_size?: string;
  }>;
}

export default async function TransactionsPage({
  searchParams,
}: TransactionsPageProps) {
  await requireInventoryViewer();
  const query = await searchParams;

  const page = normalizePage(query.page);
  const pageSize = Math.min(
    Math.max(1, query.page_size ? Number(query.page_size) : TABLE_PAGE_SIZE),
    100,
  );

  const operationFilter =
    query.operation && query.operation !== "all" ? query.operation : undefined;

  const sortOrder = query.sort || "posted_desc";

  const transactionsRes = await inventoryRead<InventoryTransaction>(
    "transactions",
    {
      q: query.q?.trim() || undefined,
      operation: operationFilter,
      sort: sortOrder,
      page,
      page_size: pageSize,
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lịch sử giao dịch Sổ cái / Inventory Transactions"
        description="Toàn bộ nhật ký biến động kho bất biến: Nhận kho, Tồn đầu kỳ, Điều chỉnh và Hủy phiếu"
      />

      <TransactionList
        transactions={transactionsRes.rows}
        totalTransactions={transactionsRes.total}
        currentPage={page}
        pageSize={pageSize}
        currentQ={query.q || ""}
        currentOperation={query.operation || "all"}
        currentSort={sortOrder}
      />
    </div>
  );
}
