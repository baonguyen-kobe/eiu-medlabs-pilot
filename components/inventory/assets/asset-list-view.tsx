"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search, X } from "@/components/icons";
import {
  LifecycleBadge,
  OperationalStatusBadge,
  AssetEligibilityBadge,
} from "./asset-status-badge";
import { AssetQrLookup } from "./asset-qr-lookup";
import { PaginationControls } from "@/components/pagination-controls";
import type {
  AssetLifecycleStatus,
  AssetOperationalStatus,
  EquipmentAsset,
} from "@/lib/inventory/asset-types";

export interface AssetListViewProps {
  assets: EquipmentAsset[];
  total: number;
  page: number;
  pageSize: number;
  isAdmin: boolean;
  filters: {
    q?: string;
    lifecycle_status?: AssetLifecycleStatus;
    operational_status?: AssetOperationalStatus;
    source_line_id?: string;
  };
}

export function AssetListView({
  assets,
  total,
  page,
  pageSize,
  isAdmin,
  filters,
}: AssetListViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [searchQuery, setSearchQuery] = useState(filters.q || "");
  const [lifecycleFilter, setLifecycleFilter] = useState<string>(
    filters.lifecycle_status || "all",
  );
  const [operationalFilter, setOperationalFilter] = useState<string>(
    filters.operational_status || "all",
  );
  const [showQrLookup, setShowQrLookup] = useState(false);

  const applyFilters = (newParams: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", "1"); // reset to page 1 on filter change

    for (const [k, v] of Object.entries(newParams)) {
      if (!v || v === "all") {
        params.delete(k);
      } else {
        params.set(k, v);
      }
    }
    router.push(`/inventory/assets?${params.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    applyFilters({
      q: searchQuery.trim() || null,
      lifecycle_status: lifecycleFilter !== "all" ? lifecycleFilter : null,
      operational_status:
        operationalFilter !== "all" ? operationalFilter : null,
    });
  };

  const handleResetFilters = () => {
    setSearchQuery("");
    setLifecycleFilter("all");
    setOperationalFilter("all");
    router.push("/inventory/assets");
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(newPage));
    router.push(`/inventory/assets?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Tác vụ Thiết bị Cá thể / Asset Actions:
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowQrLookup((prev) => !prev)}
            className="button button-secondary text-xs"
          >
            <Search size={14} />
            <span>{showQrLookup ? "Ẩn Tra cứu QR" : "Quét / Tra cứu QR"}</span>
          </button>

          <Link
            href="/inventory/assets/receive"
            className="button button-primary text-xs"
          >
            <Plus size={14} />
            <span>Tiếp nhận Thiết bị / Receive Asset</span>
          </Link>

          {isAdmin && (
            <Link
              href="/inventory/assets/opening"
              className="button button-secondary text-xs border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-50"
            >
              <span>Tồn đầu kỳ (Admin)</span>
            </Link>
          )}
        </div>
      </div>

      {/* Expandable QR Lookup Section */}
      {showQrLookup && (
        <section aria-label="Tra cứu mã QR">
          <AssetQrLookup />
        </section>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <form
          onSubmit={handleSearchSubmit}
          className="flex flex-wrap items-end gap-3 text-xs"
        >
          <div className="flex-1 min-w-[200px]">
            <label
              htmlFor="asset-search-query"
              className="block font-medium text-slate-700 mb-1"
            >
              Tìm kiếm (Mã tài sản, sê-ri, SKU, model...)
            </label>
            <div className="relative">
              <input
                id="asset-search-query"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="VD: EIU-AST-..., SN-1234, CX23..."
                className="input-field text-xs pl-8 w-full"
              />
              <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                <Search size={14} />
              </span>
            </div>
          </div>

          <div className="w-40">
            <label
              htmlFor="asset-lifecycle-filter"
              className="block font-medium text-slate-700 mb-1"
            >
              Vòng đời
            </label>
            <select
              id="asset-lifecycle-filter"
              value={lifecycleFilter}
              onChange={(e) => setLifecycleFilter(e.target.value)}
              className="input-field text-xs w-full"
            >
              <option value="all">Tất cả vòng đời</option>
              <option value="in_service">Đang vận hành (In Service)</option>
              <option value="registered">Mới tiếp nhận (Registered)</option>
              <option value="inactive">Tạm ngưng (Inactive)</option>
              <option value="retired">Ngừng sử dụng (Retired)</option>
              <option value="disposed">Đã thanh lý (Disposed)</option>
            </select>
          </div>

          <div className="w-40">
            <label
              htmlFor="asset-operational-filter"
              className="block font-medium text-slate-700 mb-1"
            >
              Vận hành
            </label>
            <select
              id="asset-operational-filter"
              value={operationalFilter}
              onChange={(e) => setOperationalFilter(e.target.value)}
              className="input-field text-xs w-full"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="ready">Sẵn sàng (Ready)</option>
              <option value="in_use">Đang sử dụng (In Use)</option>
              <option value="under_maintenance">Bảo trì (Maintenance)</option>
              <option value="damaged">Hư hỏng (Damaged)</option>
              <option value="prohibited">Cấm lưu hành (Prohibited)</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              className="button button-primary text-xs px-3.5 py-1.5"
            >
              Lọc kết quả
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              className="button button-secondary text-xs px-3 py-1.5"
              title="Xóa bộ lọc"
            >
              <X size={14} />
            </button>
          </div>

          {filters.source_line_id && (
            <div className="w-full mt-2 pt-2 border-t border-slate-200 flex items-center gap-2 text-xs">
              <span className="text-slate-500">Đang lọc theo dòng nguồn:</span>
              <span className="font-mono font-semibold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">
                {filters.source_line_id}
              </span>
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-xs text-rose-600 hover:underline ml-2"
              >
                (Xóa lọc dòng nguồn)
              </button>
            </div>
          )}
        </form>
      </div>

      {/* Asset Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Mã tài sản (Code)</th>
                <th className="py-3 px-4">Vật tư danh mục</th>
                <th className="py-3 px-4">Số sê-ri / Hãng & Model</th>
                <th className="py-3 px-4">Vị trí lưu trữ</th>
                <th className="py-3 px-4">Vòng đời</th>
                <th className="py-3 px-4">Vận hành</th>
                <th className="py-3 px-4">Đủ ĐK / Khả dụng cho yêu cầu mới</th>
                <th className="py-3 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assets.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="py-12 text-center text-slate-500 text-xs"
                  >
                    Không tìm thấy thiết bị nào khớp với tiêu chí tìm kiếm.
                  </td>
                </tr>
              ) : (
                assets.map((asset) => (
                  <tr
                    key={asset.id}
                    className="hover:bg-slate-50/60 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                      <Link
                        href={`/inventory/assets/${asset.id}`}
                        className="hover:underline hover:text-indigo-600"
                      >
                        {asset.asset_code}
                      </Link>
                    </td>

                    <td className="py-3 px-4 max-w-[200px]">
                      <div className="font-semibold text-slate-900 truncate">
                        {asset.item_name}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        SKU: {asset.item_code}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      {asset.manufacturer_serial ? (
                        <div className="font-mono font-medium text-slate-800">
                          {asset.manufacturer_serial}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">
                          Không có S/N
                        </span>
                      )}
                      {(asset.manufacturer || asset.model) && (
                        <div className="text-[11px] text-slate-500">
                          {asset.manufacturer || ""}{" "}
                          {asset.model ? `(${asset.model})` : ""}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-medium text-slate-800">
                        {asset.location_code}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {asset.location_name}
                      </div>
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <LifecycleBadge status={asset.lifecycle_status} />
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <OperationalStatusBadge
                        status={asset.operational_status}
                      />
                    </td>

                    <td className="py-3 px-4 whitespace-nowrap">
                      <AssetEligibilityBadge
                        eligible={asset.eligible}
                        available={asset.available}
                        reasons={asset.ineligibility_reasons}
                      />
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <Link
                        href={`/inventory/assets/${asset.id}`}
                        className="button button-secondary text-[11px] px-2.5 py-1 font-medium"
                      >
                        Chi tiết →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > pageSize && (
          <div className="p-4 border-t border-slate-200">
            <PaginationControls
              currentPage={page}
              totalItems={total}
              pageSize={pageSize}
              onPageChange={handlePageChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}
