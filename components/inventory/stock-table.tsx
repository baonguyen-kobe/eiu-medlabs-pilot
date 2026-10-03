"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "@/components/icons";
import { formatDisplayQuantity, isPositive } from "@/lib/inventory/decimal";
import { ConditionBadge } from "./status-badge";
import { InventoryLookup } from "./inventory-lookup";
import { PaginationControls } from "@/components/pagination-controls";
import { TABLE_PAGE_SIZE } from "@/lib/pagination";
import type {
  InventoryCohortDetail,
  InventoryStockBalance,
  InventoryStorageLocation,
  StockCondition,
} from "@/lib/inventory/types";

export interface StockTableProps {
  balances?: InventoryStockBalance[];
  initialBalances?: InventoryStockBalance[];
  totalBalances: number;
  currentPage: number;
  pageSize?: number;
  currentFilters: {
    q: string;
    location_id: string;
    condition: string;
    expiry_state: string;
    active: string;
    sort: string;
  };
  selectedLocationLabel?: string;
  selectedDimensions?: {
    item_id: string;
    location_id?: string;
    condition?: string;
  } | null;
  cohorts?: InventoryCohortDetail[];
  totalCohorts?: number;
  cohortPage?: number;
}

export function StockTable({
  balances: propBalances,
  initialBalances,
  totalBalances,
  currentPage,
  pageSize = TABLE_PAGE_SIZE,
  currentFilters,
  selectedLocationLabel,
  selectedDimensions,
  cohorts = [],
  totalCohorts = 0,
  cohortPage = 1,
}: StockTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const balances = propBalances ?? initialBalances ?? [];

  const [search, setSearch] = useState(currentFilters.q);

  const [prevQ, setPrevQ] = useState(currentFilters.q);
  if (prevQ !== currentFilters.q) {
    setPrevQ(currentFilters.q);
    setSearch(currentFilters.q);
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
          (key === "cohort_page" && Number(val) <= 1) ||
          (key === "condition" && val === "all") ||
          (key === "expiry_state" && val === "all") ||
          (key === "status" && val === "all") ||
          (key === "active" && val === "all")
        ) {
          params.delete(key);
        } else {
          params.set(key, String(val));
        }
      }
      if ("expiry_state" in updates) {
        params.delete("status");
      }
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  const hasActiveFilters = Boolean(
    currentFilters.q ||
    currentFilters.location_id ||
    (currentFilters.condition && currentFilters.condition !== "all") ||
    (currentFilters.expiry_state && currentFilters.expiry_state !== "all") ||
    (currentFilters.active && currentFilters.active !== "all") ||
    currentFilters.sort,
  );

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateParams({ q: search.trim() || undefined, page: 1 });
  }

  function clearFilters() {
    setSearch("");
    updateParams({
      q: undefined,
      location_id: undefined,
      condition: undefined,
      expiry_state: undefined,
      status: undefined,
      active: undefined,
      sort: undefined,
      page: 1,
    });
  }

  return (
    <div className="space-y-4">
      {/* Filter Toolbar */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {/* Search SKU/Name */}
          <form
            onSubmit={handleSearchSubmit}
            className="relative xl:col-span-2"
          >
            <Search
              className="absolute left-3 top-2.5 text-slate-400"
              size={16}
            />
            <input
              aria-label="Tìm vật tư tồn kho / Search stock"
              type="text"
              className="w-full text-xs pl-9 pr-8 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Tìm theo mã SKU, tên vật tư..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => {
                if (search !== currentFilters.q) {
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

          {/* Location Bounded Lookup */}
          <div className="relative">
            <InventoryLookup<InventoryStorageLocation>
              resource="locations"
              filters={{ active: true }}
              value={currentFilters.location_id}
              valueKey="id"
              label="Vị trí kho / Location"
              id="stock-location-filter"
              selectedLabel={selectedLocationLabel}
              placeholder="Tất cả vị trí / All Locations"
              hideLabel={true}
              onSelect={(loc) => {
                updateParams({ location_id: loc.id, page: 1 });
              }}
            />
            {currentFilters.location_id ? (
              <button
                type="button"
                aria-label="Xóa chọn vị trí"
                title="Xóa chọn vị trí / Clear location"
                onClick={() =>
                  updateParams({ location_id: undefined, page: 1 })
                }
                className="absolute right-8 top-2.5 text-slate-400 hover:text-slate-600 z-10"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>

          {/* Condition Filter */}
          <div>
            <select
              aria-label="Lọc tình trạng / Filter condition"
              className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              value={currentFilters.condition}
              onChange={(e) => {
                updateParams({ condition: e.target.value, page: 1 });
              }}
            >
              <option value="all">Tất cả tình trạng / All Conditions</option>
              <option value="good">Chỉ hàng tốt / Good condition</option>
              <option value="damaged">Chỉ hàng hỏng / Damaged condition</option>
            </select>
          </div>

          {/* Expiry State / Status Filter */}
          <div>
            <select
              aria-label="Lọc hạn dùng / Filter expiry"
              className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              value={currentFilters.expiry_state}
              onChange={(e) => {
                updateParams({ expiry_state: e.target.value, page: 1 });
              }}
            >
              <option value="all">Tất cả hạn dùng / All Expiry States</option>
              <option value="eligible">Đủ điều kiện cấp phát / Eligible</option>
              <option value="expired">Đã hết hạn / Expired</option>
              <option value="unknown">Chưa rõ HSD (Tồn đầu) / Unknown</option>
            </select>
          </div>

          {/* Active / Inactive Historical Filter */}
          <div>
            <select
              aria-label="Lọc trạng thái hoạt động / Filter active state"
              className="w-full text-xs py-2 px-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              value={currentFilters.active}
              onChange={(e) => {
                updateParams({ active: e.target.value, page: 1 });
              }}
            >
              <option value="all">Tất cả trạng thái / All (Historical)</option>
              <option value="true">Chỉ đang hoạt động / Active only</option>
              <option value="false">Đã ngừng hoạt động / Inactive</option>
            </select>
          </div>
        </div>

        {/* Sort & Active Filters Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-medium">Sắp xếp / Sort:</span>
            <select
              aria-label="Sắp xếp tồn kho / Sort stock"
              className="text-xs py-1 px-2 border border-slate-300 rounded-md bg-white text-slate-700"
              value={currentFilters.sort || "code_asc"}
              onChange={(e) => updateParams({ sort: e.target.value, page: 1 })}
            >
              <option value="code_asc">Mã SKU: A &rarr; Z</option>
              <option value="code_desc">Mã SKU: Z &rarr; A</option>
              <option value="name_asc">Tên vật tư: A &rarr; Z</option>
              <option value="name_desc">Tên vật tư: Z &rarr; A</option>
            </select>
          </div>

          {hasActiveFilters ? (
            <div className="flex items-center gap-3 text-slate-500">
              <span>
                Tìm thấy <strong>{totalBalances}</strong> kết quả lọc
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
            <div className="flex items-center gap-3">
              <span className="text-slate-400">
                Tổng số dòng tồn kho: <strong>{totalBalances}</strong>
              </span>
              <Link
                href="/inventory/operations"
                className="button button-primary text-xs py-1 px-2.5"
              >
                Nghiệp vụ kho S2 →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Balances Data Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th scope="col" className="py-3 px-4">
                  Mã SKU / Code
                </th>
                <th scope="col" className="py-3 px-4">
                  Tên vật tư / Name
                </th>
                <th scope="col" className="py-3 px-4">
                  Vị trí kho / Location
                </th>
                <th scope="col" className="py-3 px-4">
                  Tình trạng / Condition
                </th>
                <th scope="col" className="py-3 px-4 text-right">
                  Tồn thực tế / On hand
                </th>
                <th scope="col" className="py-3 px-4 text-right">
                  Đủ ĐK / Eligible
                </th>
                <th scope="col" className="py-3 px-4 text-right">
                  Khả dụng cho yêu cầu mới / Available for new
                </th>
                <th scope="col" className="py-3 px-4 text-right">
                  Hết hạn / Expired
                </th>
                <th scope="col" className="py-3 px-4 text-right">
                  Chưa rõ HSD / Unknown
                </th>
                <th scope="col" className="py-3 px-4">
                  ĐVT / Unit
                </th>
                <th scope="col" className="py-3 px-4 text-center">
                  Chi tiết lô
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {balances.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400">
                    {hasActiveFilters
                      ? "Không tìm thấy dòng tồn kho nào phù hợp với bộ lọc."
                      : "Kho hiện chưa có số dư tồn kho nào."}
                  </td>
                </tr>
              ) : (
                balances.map((bal, idx) => {
                  const rowKey = `${bal.item_code}-${bal.location_id}-${bal.condition}-${idx}`;
                  const isSelected =
                    selectedDimensions?.item_id === bal.item_id &&
                    selectedDimensions?.location_id === bal.location_id &&
                    selectedDimensions?.condition === bal.condition;

                  return (
                    <tr
                      key={rowKey}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isSelected
                          ? "bg-blue-50/70 border-l-4 border-l-blue-600 font-medium"
                          : ""
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                        {bal.item_code}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-800">
                        {bal.item_name}
                      </td>
                      <td className="py-3 px-4 text-slate-600 font-medium">
                        {bal.location_name}
                      </td>
                      <td className="py-3 px-4">
                        <ConditionBadge
                          condition={bal.condition as StockCondition}
                        />
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 text-sm">
                        {formatDisplayQuantity(bal.quantity)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-700">
                        {formatDisplayQuantity(bal.eligible_quantity ?? "0")}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-700">
                        {bal.available_quantity == null
                          ? "Chưa xác định / Unknown"
                          : formatDisplayQuantity(bal.available_quantity)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-medium text-rose-600">
                        {formatDisplayQuantity(bal.expired_quantity ?? "0")}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-medium text-amber-600">
                        {formatDisplayQuantity(
                          bal.unknown_expiry_quantity ?? "0",
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-medium">
                        {bal.base_uom_code}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              updateParams({
                                selected_item: undefined,
                                selected_location: undefined,
                                selected_condition: undefined,
                                cohort_page: undefined,
                              });
                            } else {
                              updateParams({
                                selected_item: bal.item_id,
                                selected_location: bal.location_id,
                                selected_condition: bal.condition,
                                cohort_page: 1,
                              });
                            }
                          }}
                          className={`button text-xs py-1 px-2.5 ${
                            isSelected
                              ? "button-primary bg-blue-600 text-white"
                              : "button-secondary"
                          }`}
                        >
                          {isSelected ? "Đang chọn" : "Lô / Cohorts"}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Hiển thị {balances.length} trên tổng số{" "}
            <strong>{totalBalances}</strong> dòng số dư
          </span>
          <PaginationControls
            currentPage={currentPage}
            totalItems={totalBalances}
            onPageChange={(page) => updateParams({ page })}
            pageSize={pageSize}
          />
        </div>
      </div>

      {/* Cohort Drilldown Section */}
      {selectedDimensions ? (
        <section
          aria-label="Chi tiết lô tồn kho"
          className="bg-white rounded-xl border border-blue-200 overflow-hidden shadow-xs space-y-3 p-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Chi tiết các lô tiếp nhận / Cohort Breakdown
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Truy vết nguồn gốc giao dịch nhập, hạn dùng và số dư theo từng
                lô tiếp nhận ban đầu
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                updateParams({
                  selected_item: undefined,
                  selected_location: undefined,
                  selected_condition: undefined,
                  cohort_page: undefined,
                });
              }}
              className="button button-secondary text-xs"
            >
              Đóng / Close
            </button>
          </div>

          {cohorts.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              Không tìm thấy thông tin lô tồn kho nào cho mục đã chọn.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                    <th scope="col" className="py-2.5 px-3">
                      Mã lô / Line Key
                    </th>
                    <th scope="col" className="py-2.5 px-3">
                      Tham chiếu nhận / Reference
                    </th>
                    <th scope="col" className="py-2.5 px-3">
                      Vị trí kho / Location
                    </th>
                    <th scope="col" className="py-2.5 px-3 text-right">
                      Tổng tồn / Physical
                    </th>
                    <th scope="col" className="py-2.5 px-3 text-right">
                      Đủ ĐK / Eligible
                    </th>
                    <th scope="col" className="py-2.5 px-3 text-right">
                      Khả dụng cho yêu cầu mới / Available for new
                    </th>
                    <th scope="col" className="py-2.5 px-3">
                      Hạn dùng / Expiry
                    </th>
                    <th scope="col" className="py-2.5 px-3 text-right">
                      Giao dịch gốc / Origin
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {cohorts.map((cohort) => (
                    <tr
                      key={cohort.origin_id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-2.5 px-3 font-mono font-medium text-slate-900">
                        {cohort.line_key}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-800">
                        {cohort.receipt_reference || cohort.cutover_key || "—"}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {cohort.location_state === "split" ? (
                          <div className="space-y-0.5">
                            <span className="badge bg-purple-50 text-purple-800 border-purple-200 text-[10px] font-semibold">
                              Phân tán ({cohort.locations?.length || "nhiều"}{" "}
                              kho)
                            </span>
                            {cohort.locations ? (
                              <div className="text-[10px] text-slate-500 font-mono">
                                {cohort.locations
                                  .map(
                                    (loc) =>
                                      `${loc.location_code}: ${formatDisplayQuantity(loc.physical_balance)}`,
                                  )
                                  .join(", ")}
                              </div>
                            ) : null}
                          </div>
                        ) : cohort.location_state === "depleted" ? (
                          <span className="text-slate-400 text-xs italic">
                            Đã xuất hết / Depleted
                          </span>
                        ) : (
                          `${cohort.current_location_code || "—"} - ${cohort.current_location_name || ""}`
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                        {formatDisplayQuantity(
                          cohort.physical_balance || cohort.remaining_quantity,
                        )}{" "}
                        {cohort.base_uom_code}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-700">
                        {formatDisplayQuantity(cohort.eligible_balance)}{" "}
                        {cohort.base_uom_code}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-700">
                        {cohort.available_quantity == null
                          ? "Chưa xác định / Unknown"
                          : `${formatDisplayQuantity(cohort.available_quantity)} ${cohort.base_uom_code}`}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">
                        {cohort.current_expiry_date ||
                          (cohort.current_expiry_precision === "not_required"
                            ? "Không yêu cầu"
                            : cohort.current_expiry_precision === "unknown"
                              ? "Chưa rõ (Tồn đầu)"
                              : "—")}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <Link
                            href={`/inventory/transactions/${cohort.transaction_id}?origin=${cohort.origin_id}`}
                            className="button button-secondary text-[11px] py-1 px-2"
                            title="Xem lịch sử giao dịch gốc"
                          >
                            Giao dịch
                          </Link>
                          <Link
                            href={
                              cohort.current_location_id
                                ? `/inventory/operations?tab=transfer&location_id=${cohort.current_location_id}&origin_id=${cohort.origin_id}`
                                : `/inventory/operations?tab=transfer&origin_id=${cohort.origin_id}`
                            }
                            className="button button-secondary text-[11px] py-1 px-2 text-sky-700"
                            title="Chuyển lô này sang kho khác"
                          >
                            Chuyển
                          </Link>
                          {isPositive(cohort.good_balance) ? (
                            <Link
                              href={
                                cohort.current_location_id
                                  ? `/inventory/operations?tab=condition&location_id=${cohort.current_location_id}&origin_id=${cohort.origin_id}`
                                  : `/inventory/operations?tab=condition&origin_id=${cohort.origin_id}`
                              }
                              className="button button-secondary text-[11px] py-1 px-2 text-amber-700"
                              title="Báo hỏng lô này"
                            >
                              Báo hỏng
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalCohorts > 20 ? (
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Hiển thị {cohorts.length} trên tổng số {totalCohorts} lô
              </span>
              <PaginationControls
                currentPage={cohortPage}
                totalItems={totalCohorts}
                onPageChange={(page) => updateParams({ cohort_page: page })}
                pageSize={20}
              />
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
