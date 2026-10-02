import React from "react";
import Link from "next/link";
import { requireInventoryViewer } from "@/lib/inventory/auth";
import { inventoryRead } from "@/lib/inventory/client";
import { StockTable } from "@/components/inventory/stock-table";
import { PageHeader } from "@/components/patterns/page-header";
import { normalizePage, TABLE_PAGE_SIZE } from "@/lib/pagination";
import type {
  InventoryCohortDetail,
  InventoryStockBalance,
  InventoryStorageLocation,
  StockCondition,
} from "@/lib/inventory/types";

interface StockPageProps {
  searchParams: Promise<{
    q?: string;
    location_id?: string;
    condition?: string;
    expiry_state?: string;
    status?: string;
    active?: string;
    sort?: string;
    page?: string;
    page_size?: string;
    selected_item?: string;
    selected_location?: string;
    selected_condition?: string;
    cohort_page?: string;
  }>;
}

export default async function StockPage({ searchParams }: StockPageProps) {
  await requireInventoryViewer();
  const query = await searchParams;

  const page = normalizePage(query.page);
  const pageSize = Math.min(
    Math.max(1, query.page_size ? Number(query.page_size) : TABLE_PAGE_SIZE),
    100,
  );

  // Normalize expiry state from either expiry_state or legacy status param
  const expiryState =
    query.expiry_state && query.expiry_state !== "all"
      ? query.expiry_state
      : query.status && query.status !== "all"
        ? query.status
        : undefined;

  // Active filter: 'true' -> true, 'false' -> false, 'all'/undefined -> undefined (historical stock)
  const activeFilter =
    query.active === "true"
      ? true
      : query.active === "false"
        ? false
        : undefined;

  const conditionFilter =
    query.condition && query.condition !== "all"
      ? (query.condition as StockCondition)
      : undefined;

  const [balancesRes, selectedLocRes, cohortsRes] = await Promise.all([
    inventoryRead<InventoryStockBalance>("balances", {
      q: query.q?.trim() || undefined,
      location_id: query.location_id || undefined,
      condition: conditionFilter,
      expiry_state: expiryState,
      active: activeFilter,
      sort: query.sort || undefined,
      page,
      page_size: pageSize,
    }),
    query.location_id
      ? inventoryRead<InventoryStorageLocation>("locations", {
          id: query.location_id,
        })
      : null,
    query.selected_item
      ? inventoryRead<InventoryCohortDetail>("cohorts", {
          item_id: query.selected_item,
          location_id: query.selected_location || undefined,
          page: normalizePage(query.cohort_page),
          page_size: 20,
        })
      : null,
  ]);

  const selectedLoc = selectedLocRes?.rows[0];
  const selectedLocationLabel = selectedLoc
    ? `${selectedLoc.code} - ${selectedLoc.name}`
    : undefined;

  const selectedDimensions = query.selected_item
    ? {
        item_id: query.selected_item,
        location_id: query.selected_location,
        condition: query.selected_condition,
      }
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tồn kho thực tế & Đủ điều kiện / Stock Balances"
        description="Số dư tồn kho phân tách theo vị trí lưu trữ, tình trạng tốt/hỏng và tính đủ điều kiện cấp phát"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/inventory/operations"
              className="button button-primary text-xs flex items-center gap-1.5"
            >
              <span>Nghiệp vụ kho S2 / Operations →</span>
            </Link>
          </div>
        }
      />

      <StockTable
        balances={balancesRes.rows}
        totalBalances={balancesRes.total}
        currentPage={page}
        pageSize={pageSize}
        currentFilters={{
          q: query.q || "",
          location_id: query.location_id || "",
          condition: query.condition || "all",
          expiry_state: expiryState || "all",
          active: query.active || "all",
          sort: query.sort || "",
        }}
        selectedLocationLabel={selectedLocationLabel}
        selectedDimensions={selectedDimensions}
        cohorts={cohortsRes?.rows ?? []}
        totalCohorts={cohortsRes?.total ?? 0}
        cohortPage={normalizePage(query.cohort_page)}
      />
    </div>
  );
}
