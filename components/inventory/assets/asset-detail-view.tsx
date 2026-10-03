"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "@/components/icons";
import {
  LifecycleBadge,
  OperationalStatusBadge,
  AssetEligibilityBadge,
} from "./asset-status-badge";
import { AssetQrLabel } from "./asset-qr-label";
import { AssetStateForm } from "./asset-state-form";
import { AssetLifecycleForm } from "./asset-lifecycle-form";
import { AssetCorrectionForm } from "./asset-correction-form";
import { AssetHistoryView } from "./asset-history-view";
import type {
  EquipmentAsset,
  EquipmentAssetEvent,
} from "@/lib/inventory/asset-types";

export interface AssetDetailViewProps {
  asset: EquipmentAsset;
  events: EquipmentAssetEvent[];
  eventsTotal: number;
  eventsPage: number;
  eventsPageSize: number;
  qrSvg: string;
  isAdmin: boolean;
}

export type DetailActionTab = "state" | "lifecycle" | "correction";

export function AssetDetailView({
  asset,
  events,
  eventsTotal,
  eventsPage,
  eventsPageSize,
  qrSvg,
  isAdmin,
}: AssetDetailViewProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<DetailActionTab>("state");

  const handleRefresh = () => {
    router.refresh();
  };

  const handleHistoryPageChange = (newPage: number) => {
    router.push(`/inventory/assets/${asset.id}?page=${newPage}`);
  };

  return (
    <div className="space-y-6 w-full max-w-full min-w-0 overflow-x-hidden">
      {/* Navigation Breadcrumb & Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4 border-slate-200">
        <div className="space-y-1">
          <Link
            href="/inventory/assets"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft size={14} /> Quay lại danh sách thiết bị
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-mono font-bold text-slate-900 tracking-wide break-all">
              {asset.asset_code}
            </h1>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">
              Phiên bản #{asset.revision}
            </span>
          </div>
          <div className="text-sm text-slate-600">
            {asset.item_code} •{" "}
            <span className="font-semibold">{asset.item_name}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <LifecycleBadge status={asset.lifecycle_status} />
          <OperationalStatusBadge status={asset.operational_status} />
          <AssetEligibilityBadge
            eligible={asset.eligible}
            reasons={asset.ineligibility_reasons}
          />
        </div>
      </div>

      {/* Eligibility Callout Banner */}
      {!asset.eligible ? (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 space-y-2">
          <div className="font-bold flex items-center gap-2 text-sm text-rose-800">
            <span>[Không đủ điều kiện]</span> Tài sản không đủ điều kiện xuất
            mượn / vận hành (Ineligible)
          </div>
          <p className="text-xs text-rose-700">
            Theo chính sách quản lý tài sản MedLabs, thiết bị này hiện không
            được phép xuất dùng do các lý do sau:
          </p>
          <ul className="list-disc list-inside space-y-1 text-xs pl-2 font-medium">
            {asset.ineligibility_reasons.map((reason, idx) => (
              <li key={idx}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 flex items-center gap-2 text-xs">
          <span className="text-emerald-700 font-bold">[Đủ điều kiện]</span>
          <span>
            Vòng đời đang vận hành, trạng thái sẵn sàng, vị trí hoạt động và hạn
            dùng hợp lệ.
          </span>
        </div>
      )}

      {/* Grid: Facts & QR Label */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-w-0 max-w-full">
        {/* Left 2 Cols: Identity & State Cards */}
        <div className="lg:col-span-2 space-y-6 min-w-0 max-w-full">
          {/* Physical & Location Facts */}
          <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-3 min-w-0 overflow-hidden">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Hiện trạng Vị trí & Quản lý thực tế
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-400 block mb-0.5">
                  Vị trí lưu trữ:
                </span>
                <span className="font-semibold text-slate-800">
                  {asset.location_code} ({asset.location_name})
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">
                  Người chịu trách nhiệm / Quản lý:
                </span>
                <span className="font-semibold text-slate-800">
                  {asset.custodian_name ||
                    asset.custodian_id ||
                    "Không có (Kho chung)"}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">
                  Độ chính xác hạn dùng:
                </span>
                <span className="font-medium text-slate-700">
                  {asset.expiry_precision === "not_required" && "Không yêu cầu"}
                  {asset.expiry_precision === "day" && "Theo ngày"}
                  {asset.expiry_precision === "month" && "Theo tháng"}
                  {asset.expiry_precision === "unknown" &&
                    "Chưa rõ (Cần xác minh)"}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">
                  Hạn sử dụng:
                </span>
                <span className="font-mono font-medium text-slate-700">
                  {asset.expiry_date || "—"}
                </span>
              </div>
            </div>
          </section>

          {/* Manufacturer & S/N Facts */}
          <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs space-y-3 min-w-0 overflow-hidden">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Định danh Nhà sản xuất & Nguồn gốc
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-slate-400 block mb-0.5">
                  Số sê-ri NSX (Serial Number):
                </span>
                <span className="font-mono font-bold text-slate-800">
                  {asset.manufacturer_serial || "Không có"}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">
                  Hãng sản xuất:
                </span>
                <span className="font-medium text-slate-800">
                  {asset.manufacturer || "—"}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Model:</span>
                <span className="font-medium text-slate-800">
                  {asset.model || "—"}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">
                  Hình thức tiếp nhận:
                </span>
                <span className="font-medium text-slate-700">
                  {asset.intake_kind === "receive"
                    ? "Nhận kho mới (Receive)"
                    : "Tồn đầu kỳ (Open)"}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">
                  Chứng từ tiếp nhận:
                </span>
                <span className="font-medium text-slate-700 font-mono">
                  {asset.intake_reference}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">
                  Mã dòng (Row Key):
                </span>
                <span className="font-mono text-slate-700">
                  {asset.row_key}
                </span>
              </div>
              <div className="sm:col-span-3">
                <span className="text-slate-400 block mb-0.5">
                  Dòng hồ sơ nguồn (Source Line ID):
                </span>
                {asset.source_line_id ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                    <span className="font-mono font-medium text-slate-700 break-all text-xs">
                      {asset.source_line_id}
                    </span>
                    <Link
                      href="/inventory/acquisitions"
                      className="text-indigo-600 hover:underline text-[11px] font-medium shrink-0"
                    >
                      (Tra cứu Hồ sơ nguồn / Acquisitions &rarr;)
                    </Link>
                  </div>
                ) : (
                  <span className="text-slate-400 italic">
                    Không có dòng nguồn (Ghi nhận tồn đầu kỳ)
                  </span>
                )}
              </div>
            </div>
            <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded border border-slate-200">
              [Định danh vật lý độc lập] Thiết bị cá thể được quản lý theo thực
              thể riêng biệt ngoài số dư số lượng (quantity balance) của sổ cái
              kho. Mỗi tem nhãn mã QR đại diện cho một máy móc/vật tư vật lý duy
              nhất.
            </div>
          </section>

          {/* Action Tabs for State, Lifecycle, Correction */}
          <section className="space-y-4 min-w-0 max-w-full overflow-hidden">
            <div className="flex border-b border-slate-200 text-xs overflow-x-auto scrollbar-none gap-1 sm:gap-2 pb-px">
              <button
                type="button"
                onClick={() => setActiveTab("state")}
                className={`py-2 px-3 sm:px-4 font-semibold border-b-2 whitespace-nowrap shrink-0 transition-colors ${
                  activeTab === "state"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                1. Vị trí & Vận hành
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("lifecycle")}
                className={`py-2 px-3 sm:px-4 font-semibold border-b-2 whitespace-nowrap shrink-0 transition-colors ${
                  activeTab === "lifecycle"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                2. Vòng đời (Admin)
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("correction")}
                className={`py-2 px-3 sm:px-4 font-semibold border-b-2 whitespace-nowrap shrink-0 transition-colors ${
                  activeTab === "correction"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                3. Đính chính
              </button>
            </div>

            {/* Tab Body */}
            <div>
              {activeTab === "state" && (
                <AssetStateForm asset={asset} onSuccess={handleRefresh} />
              )}
              {activeTab === "lifecycle" && (
                <AssetLifecycleForm
                  asset={asset}
                  isAdmin={isAdmin}
                  onSuccess={handleRefresh}
                />
              )}
              {activeTab === "correction" && (
                <AssetCorrectionForm
                  asset={asset}
                  events={events}
                  isAdmin={isAdmin}
                  onSuccess={handleRefresh}
                />
              )}
            </div>
          </section>
        </div>

        {/* Right Col: QR Label Card (Parent handles layout) */}
        <div className="space-y-6 min-w-0 max-w-full">
          <AssetQrLabel asset={asset} qrSvg={qrSvg} />
        </div>
      </div>

      {/* History Audit Trail Section */}
      <section
        aria-label="Sổ cái lịch sử"
        className="min-w-0 max-w-full overflow-hidden"
      >
        <AssetHistoryView
          events={events}
          total={eventsTotal}
          page={eventsPage}
          pageSize={eventsPageSize}
          onPageChange={handleHistoryPageChange}
        />
      </section>
    </div>
  );
}
