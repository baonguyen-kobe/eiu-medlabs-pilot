import React from "react";

export default function InventoryLoading() {
  return (
    <div
      className="space-y-6 animate-pulse"
      aria-busy="true"
      aria-label="Đang tải dữ liệu..."
    >
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-6 w-72 bg-slate-200 rounded-md" />
        <div className="h-4 w-96 bg-slate-100 rounded-md" />
      </div>

      {/* KPI skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-28 bg-white border border-slate-200 rounded-xl p-4 space-y-3"
          >
            <div className="h-4 w-32 bg-slate-100 rounded" />
            <div className="h-8 w-16 bg-slate-200 rounded" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="h-5 w-48 bg-slate-200 rounded" />
        <div className="space-y-3 pt-2">
          {[1, 2, 3, 4, 5].map((row) => (
            <div
              key={row}
              className="h-10 bg-slate-50 rounded-lg border border-slate-100"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
