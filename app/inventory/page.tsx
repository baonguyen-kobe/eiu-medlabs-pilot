import React from "react";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { inventoryRead } from "@/lib/inventory/client";
import {
  OverviewView,
  type OverviewMetrics,
} from "@/components/inventory/overview-view";
import { PageHeader } from "@/components/patterns/page-header";
import type {
  InventoryStockBalance,
  InventorySummary,
} from "@/lib/inventory/types";

export default async function InventoryOverviewPage() {
  const viewer = await requireInventoryViewer();

  // Bounded parallel reads for overview dashboard:
  // - summary: active item and source counts (never sum mixed-UOM quantities)
  // - balances: bounded 10 rows for recent stock
  // - balances with expiry_state: bounded attention queries for expired and unknown expiry rows
  const [summaryRes, balancesRes, expiredRes, unknownRes] = await Promise.all([
    inventoryRead<InventorySummary>("summary"),
    inventoryRead<InventoryStockBalance>("balances", {
      page: 1,
      page_size: 10,
    }),
    inventoryRead<InventoryStockBalance>("balances", {
      expiry_state: "expired",
      page: 1,
      page_size: 10,
    }),
    inventoryRead<InventoryStockBalance>("balances", {
      expiry_state: "unknown",
      page: 1,
      page_size: 10,
    }),
  ]);

  const summary = summaryRes.rows[0] ?? {
    active_item_count: 0,
    active_source_count: 0,
  };

  const expiredCount = expiredRes.total;
  const unknownCount = unknownRes.total;
  const totalAttentionCount = expiredCount + unknownCount;

  // Deduplicate attention items from bounded expired and unknown queries
  const attentionMap = new Map<string, InventoryStockBalance>();
  for (const item of [...expiredRes.rows, ...unknownRes.rows]) {
    const key = `${item.item_id}-${item.location_id}-${item.condition}`;
    if (!attentionMap.has(key)) {
      attentionMap.set(key, item);
    }
  }

  const metrics: OverviewMetrics = {
    activeItemCount: summary.active_item_count,
    activeSourceCount: summary.active_source_count,
    totalBalanceRows: balancesRes.total,
    attentionItems: Array.from(attentionMap.values()),
    recentBalances: balancesRes.rows,
    totalAttentionCount,
    expiredCount,
    unknownCount,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tổng quan Kho & Số dư / Inventory Overview"
        description="Tra cứu nhanh tình trạng kho, các cảnh báo hạn dùng và truy cập nhanh các nghiệp vụ nhận kho S1"
      />

      <OverviewView metrics={metrics} isAdmin={viewer.isAdmin} />
    </div>
  );
}
