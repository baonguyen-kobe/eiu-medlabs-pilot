"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "@/components/icons";
import { lookupAssetAction } from "@/app/inventory/assets/read-actions";
import {
  LifecycleBadge,
  OperationalStatusBadge,
  AssetEligibilityBadge,
} from "./asset-status-badge";
import type { EquipmentAsset } from "@/lib/inventory/asset-types";

export function AssetQrLookup() {
  const [code, setCode] = useState("");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    asset: EquipmentAsset | null;
    found: boolean;
    eligible: boolean;
    available: boolean;
    ineligibility_reasons: string[];
    error?: string;
  } | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return;

    startTransition(async () => {
      const res = await lookupAssetAction(cleanCode);
      if (!res.ok) {
        setResult({
          asset: null,
          found: false,
          eligible: false,
          available: false,
          ineligibility_reasons: [],
          error: res.error || "Lỗi tra cứu",
        });
      } else if (res.data) {
        setResult({
          asset: res.data.asset,
          found: res.data.found,
          eligible: res.data.eligible,
          available: res.data.available,
          ineligibility_reasons: res.data.ineligibility_reasons,
        });
      }
    });
  };

  const handleClear = () => {
    setCode("");
    setResult(null);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">
          Tra cứu & Quét mã QR Thiết bị / Asset QR Lookup
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Nhập mã hoặc dùng máy quét phần cứng 2D/QR (chuẩn{" "}
          <code>EIU-AST-XXXXXXXX</code>) để kiểm tra tính hợp lệ và điều kiện sử
          dụng tức thì.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <label htmlFor="asset-scanner-input" className="sr-only">
            Mã tài sản hoặc quét QR / Asset Code
          </label>
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <Search size={16} />
          </div>
          <input
            id="asset-scanner-input"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="EIU-AST-XXXXXXXX hoặc quét từ máy đọc..."
            className="input-field pl-10 font-mono uppercase text-sm w-full"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={isPending}
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isPending || !code.trim()}
            className="button button-primary text-xs px-4 whitespace-nowrap"
          >
            {isPending ? "Đang tra cứu..." : "Tra cứu / Lookup"}
          </button>
          {result && (
            <button
              type="button"
              onClick={handleClear}
              className="button button-secondary text-xs px-3"
            >
              Làm mới
            </button>
          )}
        </div>
      </form>

      {/* Live Result Feedback */}
      <div aria-live="polite">
        {result?.error && (
          <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs space-y-1">
            <div className="font-semibold">Lỗi tra cứu:</div>
            <div>{result.error}</div>
          </div>
        )}

        {result && !result.error && !result.found && (
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
            <div className="font-semibold">
              Không tìm thấy tài sản / Asset Not Found
            </div>
            <div className="mt-1">
              Không có tài sản nào khớp với mã <code>{code}</code>. Vui lòng
              kiểm tra lại tem nhãn hoặc thao tác quét.
            </div>
          </div>
        )}

        {result && result.asset && (
          <div
            className={`p-4 rounded-lg border text-xs space-y-3 ${
              result.available === true
                ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                : "bg-amber-50 border-amber-300 text-amber-900"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 border-current/10">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-sm tracking-wider">
                  {result.asset.asset_code}
                </span>
                <AssetEligibilityBadge
                  eligible={result.eligible}
                  available={result.available}
                  reasons={result.ineligibility_reasons}
                />
              </div>
              <Link
                href={`/inventory/assets/${result.asset.id}`}
                className="button button-secondary text-xs py-1 px-3 underline font-medium"
              >
                Xem chi tiết tài sản &rarr;
              </Link>
            </div>
            <p>
              Tra cứu chỉ xác định tài sản; không tự chọn hoặc giữ chỗ. /
              Identity lookup only; does not select or reserve an asset.
            </p>

            {/* Ineligibility Reasons Callout */}
            {!result.eligible && (
              <div className="p-3 bg-white rounded border border-rose-200 text-rose-800 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-xs text-rose-700">
                  Lý do không đủ điều kiện sử dụng / Ineligibility Reasons:
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] pl-1">
                  {result.ineligibility_reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Asset Facts Quick View */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500">Vật tư: </span>
                <span className="font-semibold">
                  {result.asset.item_code} - {result.asset.item_name}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Vị trí: </span>
                <span className="font-medium">
                  {result.asset.location_code} ({result.asset.location_name})
                </span>
              </div>
              <div>
                <span className="text-slate-500">Sê-ri NSX: </span>
                <span className="font-mono font-medium">
                  {result.asset.manufacturer_serial || "Không có"}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Hãng/Model: </span>
                <span>
                  {result.asset.manufacturer || "N/A"}{" "}
                  {result.asset.model ? `(${result.asset.model})` : ""}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">Vòng đời: </span>
                <LifecycleBadge status={result.asset.lifecycle_status} />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">Vận hành: </span>
                <OperationalStatusBadge
                  status={result.asset.operational_status}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
