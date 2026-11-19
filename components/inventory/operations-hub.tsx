"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ClipboardList,
  PackageCheck,
  ShieldCheck,
} from "@/components/icons";
import { TransferForm } from "./transfer-form";
import { ConditionChangeForm } from "./condition-change-form";
import { StocktakeReconcileForm } from "./stocktake-reconcile-form";
import { SurplusManagementView } from "./surplus-management-view";
import { formatDisplayQuantity, uomLabel } from "@/lib/inventory/decimal";
import { ConditionBadge, HoldStatusBadge } from "./status-badge";
import type { InventoryOperationStock } from "@/lib/inventory/types";
import { useLanguage } from "@/components/i18n/language-provider";

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
  const { text: uiText } = useLanguage();
  const [lotQuery, setLotQuery] = React.useState("");
  const lotSearch = lotQuery.trim().toLowerCase();
  const visibleStock = lotSearch
    ? initialStock.filter((row) =>
        `${row.item_code} ${row.item_name} ${row.location_code}`
          .toLowerCase()
          .includes(lotSearch),
      )
    : initialStock;

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
          <span className="truncate">{uiText("Điều chuyển kho")}</span>
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
          <span className="truncate">{uiText("Hạ phẩm cấp")}</span>
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
          <span className="truncate">
            {uiText("Kiểm kê ")}
            {"&"}
            {uiText(" Đối soát")}
          </span>
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
          <span className="truncate">{uiText("Thẩm định Hàng thừa")}</span>
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

      <section className="kho-card" aria-labelledby="hub-lots">
        <div className="kho-card-head">
          <h3 id="hub-lots">
            {uiText("Số dư theo lô")}{" "}
            <small>{uiText("· {0} dòng", [visibleStock.length])}</small>
          </h3>
          <div className="kho-filter-bar">
            <label className="kho-search">
              <span className="sr-only">{uiText("Tìm lô")}</span>
              <input
                type="search"
                value={lotQuery}
                placeholder={uiText("Tìm mã, tên vật tư hoặc vị trí")}
                onChange={(event) => setLotQuery(event.target.value)}
              />
            </label>
            <Link href="/inventory/stock" className="button button-secondary">
              {uiText("Mở Tồn kho")}
            </Link>
          </div>
        </div>
        {initialStock.length === 0 ? (
          <p className="kho-card-body">
            {uiText(
              "Hiện không có số liệu tồn kho khả dụng để hiển thị xem trước.",
            )}
          </p>
        ) : (
          <div className="kho-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{uiText("Vật tư")}</th>
                  <th scope="col">{uiText("Vị trí")}</th>
                  <th scope="col">{uiText("Tình trạng")}</th>
                  <th scope="col" className="num">
                    {uiText("Khả dụng / tồn")}
                  </th>
                  <th scope="col">
                    <span className="sr-only">{uiText("Tác vụ nhanh")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleStock.map((row) => (
                  <tr
                    key={`${row.origin_id}-${row.location_id}-${row.condition}`}
                  >
                    <th scope="row">
                      <span className="cell-stack">
                        <strong>{row.item_name}</strong>
                        <small>
                          {row.item_code} · {uiText("Lô")}{" "}
                          {row.origin_id.slice(0, 8)}
                          {row.expiry_date
                            ? ` · ${uiText("HSD")} ${row.expiry_date}`
                            : ""}
                        </small>
                      </span>
                    </th>
                    <td>{row.location_code}</td>
                    <td>
                      <span className="kho-badges">
                        <ConditionBadge condition={row.condition} />
                        {row.is_held ? (
                          <HoldStatusBadge
                            isHeld={row.is_held}
                            holdReason={row.hold_reason}
                          />
                        ) : null}
                      </span>
                    </td>
                    <td className="num">
                      <b>{formatDisplayQuantity(row.available_quantity)}</b> /{" "}
                      {formatDisplayQuantity(row.quantity)} {uomLabel(row)}
                    </td>
                    <td>
                      <div className="kho-row-actions">
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
                          className="button button-secondary"
                          title={uiText("Chuyển lô này sang kho khác")}
                        >
                          {uiText("Chuyển")}
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
                            className="button button-secondary"
                            title={uiText("Báo hỏng lô này")}
                          >
                            {uiText("Hỏng")}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleStock.length ? null : (
                  <tr>
                    <td colSpan={5} className="panel-empty">
                      {uiText("Không có dòng nào khớp bộ lọc.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
