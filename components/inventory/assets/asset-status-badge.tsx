import React from "react";
import type {
  AssetLifecycleStatus,
  AssetOperationalStatus,
} from "@/lib/inventory/asset-types";

export function LifecycleBadge({ status }: { status: AssetLifecycleStatus }) {
  switch (status) {
    case "in_service":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
          Đang vận hành / In Service
        </span>
      );
    case "registered":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-800 border border-sky-200">
          Mới tiếp nhận / Registered
        </span>
      );
    case "inactive":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
          Tạm ngưng / Inactive
        </span>
      );
    case "retired":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
          Ngừng sử dụng / Retired
        </span>
      );
    case "disposed":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 border border-rose-200">
          Đã thanh lý / Disposed
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          {status}
        </span>
      );
  }
}

export function OperationalStatusBadge({
  status,
}: {
  status: AssetOperationalStatus;
}) {
  switch (status) {
    case "ready":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
          Sẵn sàng / Ready
        </span>
      );
    case "in_use":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
          Đang sử dụng / In Use
        </span>
      );
    case "under_maintenance":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          Bảo trì / Maintenance
        </span>
      );
    case "damaged":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
          Hư hỏng / Damaged
        </span>
      );
    case "prohibited":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
          Cấm lưu hành / Prohibited
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          {status}
        </span>
      );
  }
}

export function AssetEligibilityBadge({
  eligible,
  available,
  reasons = [],
}: {
  eligible: boolean;
  available: boolean;
  reasons?: string[];
}) {
  const availability = (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${
        available === true
          ? "bg-emerald-100 text-emerald-800 border-emerald-300"
          : "bg-amber-100 text-amber-800 border-amber-300"
      }`}
    >
      {available === true
        ? "Khả dụng cho yêu cầu mới / Available for new"
        : available === false
          ? "Không khả dụng cho yêu cầu mới / Unavailable for new"
          : "Chưa xác định khả dụng / Availability unknown"}
    </span>
  );
  const tooltip = eligible
    ? "Đủ điều kiện vật lý; không đồng nghĩa với khả dụng cho yêu cầu mới / Physical eligibility does not imply availability"
    : reasons.length > 0
      ? reasons.join("; ")
      : "Không đủ điều kiện xuất mượn hoặc vận hành";

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${
          eligible
            ? "bg-emerald-100 text-emerald-800 border-emerald-300"
            : "bg-rose-100 text-rose-800 border-rose-300"
        }`}
        title={tooltip}
      >
        {eligible ? "[Đủ điều kiện] / Eligible" : "[Không đủ ĐK] / Ineligible"}
      </span>
      {availability}
    </span>
  );
}
