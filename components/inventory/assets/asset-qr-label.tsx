"use client";

import React from "react";
import type { EquipmentAsset } from "@/lib/inventory/asset-types";

export interface AssetQrLabelProps {
  asset: EquipmentAsset;
  qrSvg: string;
}

export function AssetQrLabel({ asset, qrSvg }: AssetQrLabelProps) {
  const handlePrint = () => {
    window.print();
  };

  const handleDownloadSvg = () => {
    const blob = new Blob([qrSvg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${asset.asset_code}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
          Nhãn mã phản hồi nhanh / QR Asset Label
        </h3>
        <div className="flex items-center gap-2 print:hidden">
          <button
            type="button"
            onClick={handleDownloadSvg}
            className="button button-secondary text-xs px-2.5 py-1"
            title="Tải tệp SVG về máy"
          >
            Tải SVG
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="button button-primary text-xs px-2.5 py-1"
            title="In nhãn tài sản này"
          >
            In nhãn (Print)
          </button>
        </div>
      </div>

      {/* Printable Tag Container */}
      <div className="asset-print-label border-2 border-dashed border-slate-300 rounded-lg p-4 bg-white flex flex-col items-center gap-4">
        {/* QR SVG Display */}
        <div
          className="w-36 h-36 bg-white p-2 rounded border border-slate-200 shadow-xs shrink-0 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
          dangerouslySetInnerHTML={{ __html: qrSvg }}
          aria-label={`QR Code cho mã tài sản ${asset.asset_code}`}
        />

        {/* Textual Identity Facts */}
        <div className="space-y-1.5 text-center min-w-0 w-full">
          <div className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
            EIU MEDLABS • ASSET TAG
          </div>
          <div className="text-base font-mono font-bold text-slate-900 break-words">
            {asset.asset_code}
          </div>
          <div className="text-xs font-semibold text-slate-700 break-words">
            {asset.item_code} - {asset.item_name}
          </div>
          {asset.manufacturer_serial ? (
            <div className="text-[11px] text-slate-500 font-mono">
              S/N: {asset.manufacturer_serial}
              {asset.manufacturer ? ` • ${asset.manufacturer}` : ""}
              {asset.model ? ` (${asset.model})` : ""}
            </div>
          ) : (
            <div className="text-[11px] text-slate-400 italic">
              Không có số sê-ri nhà sản xuất
            </div>
          )}
          <div className="text-[11px] text-slate-500">
            Vị trí:{" "}
            <span className="font-medium text-slate-700">
              {asset.location_code}
            </span>{" "}
            ({asset.location_name})
          </div>
        </div>
      </div>

      <div className="text-[11px] text-slate-500 italic print:hidden">
        * Tiêu chuẩn mã QR mã hóa duy nhất chuỗi <code>{asset.asset_code}</code>{" "}
        theo đặc tả S3. Nhãn không chứa bí mật hay liên kết nội bộ.
      </div>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .asset-print-label, .asset-print-label * { visibility: visible !important; }
          .asset-print-label {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 70mm !important;
            break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}
