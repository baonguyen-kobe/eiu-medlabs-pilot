"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ClipboardList,
  LayoutDashboard,
  PackageCheck,
  ShieldCheck,
} from "@/components/icons";
import { TransferForm } from "./transfer-form";
import { ConditionChangeForm } from "./condition-change-form";
import { StocktakeReconcileForm } from "./stocktake-reconcile-form";
import { SurplusManagementView } from "./surplus-management-view";
import { formatDisplayQuantity } from "@/lib/inventory/decimal";
import {
  ConditionBadge,
  HoldStatusBadge,
  ProvenanceBadge,
} from "./status-badge";
import type { InventoryOperationStock } from "@/lib/inventory/types";

export type OperationTab = "transfer" | "condition" | "stocktake" | "surplus";

export function OperationsHub({
  isAdmin = false,
  initialStock = [],
  heldStockCount = 0,
}: {
  isAdmin?: boolean;
  initialStock?: InventoryOperationStock[];
  heldStockCount?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabParam = (searchParams?.get("tab") as OperationTab) || "transfer";
  const activeTab: OperationTab = [
    "transfer",
    "condition",
    "stocktake",
    "surplus",
  ].includes(tabParam)
    ? tabParam
    : "transfer";

  const preselectedLocationId = searchParams?.get("location_id") || "";
  const preselectedOriginId = searchParams?.get("origin_id") || "";

  function setTab(tab: OperationTab) {
    const params = new URLSearchParams(
      searchParams ? searchParams.toString() : "",
    );
    params.set("tab", tab);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="space-y-6 max-w-full min-w-0">
      {/* Navigation tabs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 bg-white rounded-2xl p-1.5 border border-slate-200 shadow-xs max-w-full min-w-0">
        <button
          type="button"
          onClick={() => setTab("transfer")}
          className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-semibold transition-all min-w-0 truncate ${
            activeTab === "transfer"
              ? "bg-sky-50 text-sky-800 shadow-xs border border-sky-200 font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          <PackageCheck
            size={16}
            className={`shrink-0 ${activeTab === "transfer" ? "text-sky-600" : "text-slate-400"}`}
          />
          <span className="truncate">Điều chuyển kho / Transfer</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("condition")}
          className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-semibold transition-all min-w-0 truncate ${
            activeTab === "condition"
              ? "bg-amber-50 text-amber-800 shadow-xs border border-amber-200 font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          <AlertTriangle
            size={16}
            className={`shrink-0 ${activeTab === "condition" ? "text-amber-600" : "text-slate-400"}`}
          />
          <span className="truncate">Hạ phẩm cấp / Deterioration</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("stocktake")}
          className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-semibold transition-all min-w-0 truncate ${
            activeTab === "stocktake"
              ? "bg-purple-50 text-purple-800 shadow-xs border border-purple-200 font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          <ClipboardList
            size={16}
            className={`shrink-0 ${activeTab === "stocktake" ? "text-purple-600" : "text-slate-400"}`}
          />
          <span className="truncate">Kiểm kê {"&"} Đối soát / Stocktake</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("surplus")}
          className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl text-xs font-semibold transition-all min-w-0 truncate ${
            activeTab === "surplus"
              ? "bg-emerald-50 text-emerald-800 shadow-xs border border-emerald-200 font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
          }`}
        >
          <ShieldCheck
            size={16}
            className={`shrink-0 ${activeTab === "surplus" ? "text-emerald-600" : "text-slate-400"}`}
          />
          <span className="truncate">Thẩm định Hàng thừa</span>
          {heldStockCount > 0 ? (
            <span className="bg-rose-500 text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full shrink-0 animate-pulse">
              {heldStockCount}
            </span>
          ) : null}
        </button>
      </div>
      {/* Active Tab Surface */}
      <div>
        {activeTab === "transfer" && (
          <TransferForm
            preselectedSourceId={preselectedLocationId}
            preselectedOriginId={preselectedOriginId}
          />
        )}

        {activeTab === "condition" && (
          <ConditionChangeForm
            preselectedLocationId={preselectedLocationId}
            preselectedOriginId={preselectedOriginId}
          />
        )}

        {activeTab === "stocktake" && (
          <StocktakeReconcileForm
            preselectedLocationId={preselectedLocationId}
          />
        )}
        {activeTab === "surplus" && <SurplusManagementView isAdmin={isAdmin} />}
      </div>

      {/* Bounded Preview of Operation Stock & Cohort Identities */}
      <section
        aria-label="Tra cứu số dư thực tế theo lô và phiên bản"
        className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <LayoutDashboard size={16} className="text-slate-600" />
              <span>
                Tra cứu Bách phân vị Số dư Lô {"&"} Phiên bản / Bounded
                Operation Stock Preview
              </span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Theo dõi trực tiếp số dư theo chiều kích (vị trí, tình trạng, lô
              nguồn, phiên bản vX và trạng thái giữ Hold)
            </p>
          </div>
          <Link
            href="/inventory/stock"
            className="button button-secondary text-xs"
          >
            Về trang Tồn kho / Stock →
          </Link>
        </div>

        {initialStock.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center">
            Hiện không có số liệu tồn kho khả dụng để hiển thị xem trước.
          </p>
        ) : (
          <div className="overflow-x-auto border border-slate-100 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase text-[11px]">
                  <th className="py-2.5 px-3">Mã SKU {"&"} Tên vật tư</th>
                  <th className="py-2.5 px-3">Kho</th>
                  <th className="py-2.5 px-3">Tình trạng</th>
                  <th className="py-2.5 px-3">Trạng thái giữ</th>
                  <th className="py-2.5 px-3 text-right">Tổng tồn</th>
                  <th className="py-2.5 px-3 text-right">Khả dụng</th>
                  <th className="py-2.5 px-3">Nguồn gốc</th>
                  <th className="py-2.5 px-3">Hạn dùng</th>
                  <th className="py-2.5 px-3 text-center">Tác vụ nhanh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {initialStock.map((row) => (
                  <tr
                    key={`${row.origin_id}-${row.condition}`}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-900">
                        {row.item_code} - {row.item_name}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                        Lô: {row.origin_id.slice(0, 8)}... | Phiên bản kho: r
                        {row.stock_revision ?? row.current_version}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">
                      {row.location_code}
                    </td>
                    <td className="py-2.5 px-3">
                      <ConditionBadge condition={row.condition} />
                    </td>
                    <td className="py-2.5 px-3">
                      <HoldStatusBadge
                        isHeld={row.is_held}
                        holdReason={row.hold_reason}
                      />
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                      {formatDisplayQuantity(row.quantity)} {row.base_uom_code}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-700">
                      {formatDisplayQuantity(row.available_quantity)}{" "}
                      {row.base_uom_code}
                    </td>
                    <td className="py-2.5 px-3">
                      <ProvenanceBadge provenance={row.provenance_group} />
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      {row.expiry_date || "—"}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <div className="inline-flex items-center gap-1 justify-center">
                        <button
                          type="button"
                          onClick={() => {
                            const params = new URLSearchParams(
                              searchParams ? searchParams.toString() : "",
                            );
                            params.set("tab", "transfer");
                            params.set("location_id", row.location_id);
                            params.set("origin_id", row.origin_id);
                            router.push(`${pathname}?${params.toString()}`);
                          }}
                          className="button button-secondary text-[10px] py-0.5 px-2 text-sky-700"
                          title="Chuyển lô này sang kho khác"
                        >
                          Chuyển
                        </button>
                        {row.condition === "good" ? (
                          <button
                            type="button"
                            onClick={() => {
                              const params = new URLSearchParams(
                                searchParams ? searchParams.toString() : "",
                              );
                              params.set("tab", "condition");
                              params.set("location_id", row.location_id);
                              params.set("origin_id", row.origin_id);
                              router.push(`${pathname}?${params.toString()}`);
                            }}
                            className="button button-secondary text-[10px] py-0.5 px-2 text-amber-700"
                            title="Báo hỏng lô này"
                          >
                            Hỏng
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
