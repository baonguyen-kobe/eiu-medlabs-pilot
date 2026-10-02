"use client";

import React, { useEffect } from "react";
import { AlertTriangle } from "@/components/icons";

export default function InventoryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error for client telemetry / diagnostic tracking
    console.error("Inventory error boundary caught:", error);
  }, [error]);

  return (
    <div className="p-8 max-w-2xl mx-auto my-12 bg-white rounded-2xl border border-red-200 shadow-sm space-y-4">
      <div className="flex items-center gap-3 text-red-700">
        <div className="p-2.5 bg-red-100 rounded-xl">
          <AlertTriangle size={24} className="text-red-600" />
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Đã xảy ra lỗi tải dữ liệu Kho / Inventory System Error
          </h2>
          <p className="text-xs text-slate-500">
            Hệ thống không thể tải dữ liệu từ cơ sở dữ liệu. Vui lòng thử lại
            hoặc liên hệ quản trị viên.
          </p>
        </div>
      </div>

      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-700 overflow-x-auto">
        {error.message || "Lỗi không xác định (Unknown error)"}
        {error.digest ? (
          <span className="block mt-1 text-[11px] text-slate-400">
            Mã định danh lỗi: {error.digest}
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          className="button button-primary text-xs"
          onClick={() => reset()}
        >
          Thử lại / Try Again
        </button>
      </div>
    </div>
  );
}
