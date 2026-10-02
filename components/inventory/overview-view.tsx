"use client";

import React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ClipboardList,
  FileClock,
  Import,
  PackageCheck,
  Plus,
  Settings,
} from "@/components/icons";
import { formatDisplayQuantity, isPositive } from "@/lib/inventory/decimal";
import { ConditionBadge } from "./status-badge";
import type { InventoryStockBalance } from "@/lib/inventory/types";

export interface OverviewMetrics {
  activeItemCount: number;
  activeSourceCount: number;
  totalBalanceRows: number;
  attentionItems: InventoryStockBalance[];
  recentBalances: InventoryStockBalance[];
  totalAttentionCount?: number;
  expiredCount?: number;
  unknownCount?: number;
}

export function OverviewView({
  metrics,
  isAdmin,
}: {
  metrics: OverviewMetrics;
  isAdmin: boolean;
}) {
  const totalAttention =
    metrics.totalAttentionCount ?? metrics.attentionItems.length;

  const expiredCount =
    metrics.expiredCount ??
    metrics.attentionItems.filter((item) =>
      isPositive(item.expired_quantity ?? "0"),
    ).length;

  const unknownCount =
    metrics.unknownCount ??
    metrics.attentionItems.filter((item) =>
      isPositive(item.unknown_expiry_quantity ?? "0"),
    ).length;
  return (
    <div className="space-y-6">
      {/* Quick Action Navigation Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Phím tắt tác vụ / Quick Actions:
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/inventory/receive"
            className="button button-primary text-xs"
          >
            <Plus size={15} />
            <span>Nhận kho / Receive Stock</span>
          </Link>
          <Link
            href="/inventory/stock"
            className="button button-secondary text-xs"
          >
            <PackageCheck size={15} />
            <span>Tồn kho / Stock</span>
          </Link>
          <Link
            href="/inventory/catalog"
            className="button button-secondary text-xs"
          >
            <Settings size={15} />
            <span>Danh mục vật tư / Items</span>
          </Link>
          <Link
            href="/inventory/acquisitions"
            className="button button-secondary text-xs"
          >
            <ClipboardList size={15} />
            <span>Hồ sơ nguồn / Acquisitions</span>
          </Link>
          {isAdmin ? (
            <Link
              href="/inventory/opening"
              className="button button-secondary text-xs border-indigo-200 text-indigo-700 bg-indigo-50/50 hover:bg-indigo-50"
            >
              <Import size={15} />
              <span>Tồn đầu kỳ / Opening (Admin)</span>
            </Link>
          ) : null}
          <Link
            href="/inventory/transactions"
            className="button button-secondary text-xs"
          >
            <FileClock size={15} />
            <span>Lịch sử / History</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <section className="kpi-grid" aria-label="Chỉ số tổng quan kho">
        <article className="kpi-card kpi-teal">
          <div className="kpi-icon">
            <Settings />
          </div>
          <span>Danh mục vật tư hoạt động / Active Items</span>
          <strong>{metrics.activeItemCount}</strong>
        </article>

        <article className="kpi-card kpi-indigo">
          <div className="kpi-icon">
            <ClipboardList />
          </div>
          <span>Hồ sơ nguồn đang hiệu lực / Active Sources</span>
          <strong>{metrics.activeSourceCount}</strong>
        </article>

        <article className="kpi-card kpi-violet">
          <div className="kpi-icon">
            <PackageCheck />
          </div>
          <span>Số dòng tồn kho / Stock Balances</span>
          <strong>{metrics.totalBalanceRows}</strong>
        </article>

        <article className="kpi-card kpi-amber">
          <div className="kpi-icon">
            <AlertTriangle />
          </div>
          <span>Vật tư cần chú ý / Attention Items</span>
          <strong>{totalAttention}</strong>
        </article>
      </section>

      {/* Attention Alert Banner if any items are expired or unknown */}
      {totalAttention > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-3">
          <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
            <AlertTriangle size={18} className="text-amber-600" />
            <span>
              Cảnh báo vật tư kho cần lưu ý / Attention Required (
              {totalAttention})
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {expiredCount > 0 ? (
              <div className="p-3 bg-white rounded-lg border border-amber-200">
                <span className="font-semibold text-red-700 block mb-1">
                  Có số lượng hết hạn / Expired: {expiredCount} dòng số dư
                </span>
                <p className="text-slate-600">
                  Các dòng số dư này có phần số lượng đã hết hạn sử dụng, bị
                  loại khỏi cấp phát khả dụng (Not eligible).
                </p>
                <Link
                  href="/inventory/stock?expiry_state=expired"
                  className="inline-block mt-2 font-semibold text-blue-600 hover:underline"
                >
                  Xem danh sách hết hạn &rarr;
                </Link>
              </div>
            ) : null}
            {unknownCount > 0 ? (
              <div className="p-3 bg-white rounded-lg border border-amber-200">
                <span className="font-semibold text-amber-800 block mb-1">
                  Chưa rõ hạn sử dụng (Tồn đầu kỳ) / Unknown Expiry:{" "}
                  {unknownCount} dòng số dư
                </span>
                <p className="text-slate-600">
                  Số lượng tồn đầu kỳ chưa rõ hạn dùng, cần Quản trị viên
                  (Admin) thẩm tra và xác minh.
                </p>
                <Link
                  href="/inventory/stock?expiry_state=unknown"
                  className="inline-block mt-2 font-semibold text-blue-600 hover:underline"
                >
                  Xem danh sách cần xác minh &rarr;
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Stock Balances Summary Table */}
      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Tồn kho hiện hữu gần nhất / Current Stock Balances
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Dữ liệu tổng hợp từ sổ cái thực tế, phân tách theo tình trạng
              tốt/hỏng và hạn dùng
            </p>
          </div>
          <Link
            href="/inventory/stock"
            className="button button-secondary text-xs"
          >
            Xem toàn bộ tồn kho &rarr;
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                <th scope="col" className="py-3 px-4">
                  Mã / SKU
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
                  Tổng tồn / Total Qty
                </th>
                <th scope="col" className="py-3 px-4 text-right">
                  Đủ ĐK / Eligible
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {metrics.recentBalances.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-400">
                    Kho hiện chưa có số dư tồn kho nào. Hãy thực hiện Nhận kho
                    hoặc Khởi tạo tồn đầu.
                  </td>
                </tr>
              ) : (
                metrics.recentBalances.map((bal, idx) => {
                  const rowKey = `${bal.item_code}-${bal.location_id}-${bal.condition}-${idx}`;

                  return (
                    <tr
                      key={rowKey}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                        {bal.item_code}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-800">
                        {bal.item_name}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {bal.location_name}
                      </td>
                      <td className="py-3 px-4">
                        <ConditionBadge condition={bal.condition} />
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        {formatDisplayQuantity(bal.quantity)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-700">
                        {formatDisplayQuantity(bal.eligible_quantity ?? "0")}
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
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
