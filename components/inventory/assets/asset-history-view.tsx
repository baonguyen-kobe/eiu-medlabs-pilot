"use client";

import React from "react";
import { formatInventoryDateTime } from "@/lib/inventory/dates";
import { PaginationControls } from "@/components/pagination-controls";
import type { EquipmentAssetEvent } from "@/lib/inventory/asset-types";

export interface AssetHistoryViewProps {
  events: EquipmentAssetEvent[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange?: (page: number) => void;
}

function formatOperationLabel(op: string): string {
  switch (op) {
    case "receive_asset":
      return "Nhận tài sản mới / Receive Asset";
    case "open_asset":
      return "Ghi nhận tồn đầu kỳ / Open Asset";
    case "set_asset_state":
      return "Cập nhật vị trí & trạng thái / Set Physical State";
    case "set_asset_lifecycle":
      return "Chuyển trạng thái vòng đời / Set Lifecycle";
    case "correct_asset":
      return "Đính chính thông tin / Correct Metadata";
    default:
      return op;
  }
}

function renderStateSummary(state: Record<string, unknown> | null) {
  if (!state)
    return <span className="text-slate-400 italic">Không có / None</span>;

  const fields: Array<{ label: string; value: unknown }> = [
    {
      label: "Vị trí",
      value: state.location_code || state.location_name || state.location_id,
    },
    { label: "Vòng đời", value: state.lifecycle_status },
    { label: "Vận hành", value: state.operational_status },
    {
      label: "Người quản lý",
      value: state.custodian_name || state.custodian_id,
    },
    { label: "Hãng sản xuất", value: state.manufacturer },
    { label: "Model", value: state.model },
    { label: "Sê-ri", value: state.manufacturer_serial },
    { label: "Hạn dùng", value: state.expiry_date || state.expiry_precision },
  ].filter((f) => f.value !== undefined && f.value !== null && f.value !== "");

  if (fields.length === 0) {
    return <span className="text-slate-400 italic">Dữ liệu gốc ban đầu</span>;
  }

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
      {fields.map((f, i) => (
        <div key={i} className="min-w-0 break-words">
          <dt className="text-slate-600 font-normal inline">{f.label}: </dt>
          <dd className="font-medium text-slate-800 inline">
            {String(f.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AssetHistoryView({
  events,
  total,
  page,
  pageSize,
  onPageChange,
}: AssetHistoryViewProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 border-slate-200">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
            Sổ cái lịch sử bất biến / Immutable Audit Trail
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Mọi sự kiện thay đổi trạng thái, vòng đời hoặc đính chính đều được
            lưu trữ vĩnh viễn cùng phiên bản và bằng chứng.
          </p>
        </div>
        <div className="text-xs text-slate-500">
          Tổng cộng:{" "}
          <span className="font-semibold text-slate-800">{total}</span> sự kiện
        </div>
      </div>

      {events.length === 0 ? (
        <div className="p-8 text-center text-xs text-slate-500 border border-dashed rounded-lg">
          Chưa có sự kiện lịch sử nào được ghi nhận cho tài sản này.
        </div>
      ) : (
        <div className="space-y-4">
          {events.map((evt) => (
            <article
              key={evt.id}
              className="border border-slate-200 rounded-lg p-4 bg-slate-50/50 space-y-3"
            >
              {/* Event Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 border-slate-200">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-200 text-slate-800">
                    Rev #{evt.revision}
                  </span>
                  <span className="font-semibold text-xs text-slate-900">
                    {formatOperationLabel(evt.operation)}
                  </span>
                  {evt.corrects_event_id && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                      Đính chính sự kiện #{evt.corrects_event_id.slice(0, 8)}...
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  <span>Thực hiện bởi: </span>
                  <span className="font-medium text-slate-700">
                    {evt.actor_name || evt.actor_id}
                  </span>{" "}
                  • <span>Ghi nhận: </span>
                  <span className="font-medium text-slate-700">
                    {formatInventoryDateTime(evt.posted_at)}
                  </span>
                  {evt.occurred_at && (
                    <span>
                      {" "}
                      (Phát sinh: {formatInventoryDateTime(evt.occurred_at)})
                    </span>
                  )}
                </div>
              </div>

              {/* Reason & Evidence Note */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="bg-white p-2.5 rounded border border-slate-200">
                  <span className="font-semibold text-slate-600 block text-[11px] uppercase tracking-wider mb-1">
                    Lý do thực hiện / Reason:
                  </span>
                  <p className="text-slate-800">{evt.reason}</p>
                </div>
                <div className="bg-white p-2.5 rounded border border-slate-200">
                  <span className="font-semibold text-slate-600 block text-[11px] uppercase tracking-wider mb-1">
                    Bằng chứng / Evidence Note:
                  </span>
                  <p className="text-slate-800">
                    {evt.evidence_note || "Không có ghi chú bổ sung"}
                  </p>
                </div>
              </div>

              {/* Before vs After State Comparison */}
              <div className="bg-white rounded border border-slate-200 p-3 space-y-2">
                <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Đối chiếu trạng thái trước & sau sự kiện / State Transition:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-2 rounded bg-slate-50 border border-slate-200/60">
                    <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                      Trước sự kiện (Before):
                    </span>
                    {renderStateSummary(evt.before_state)}
                  </div>
                  <div className="p-2 rounded bg-slate-50 border border-slate-200/60">
                    <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                      Sau sự kiện (After):
                    </span>
                    {renderStateSummary(evt.after_state)}
                  </div>
                </div>
              </div>
            </article>
          ))}

          {onPageChange && total > pageSize && (
            <div className="pt-2">
              <PaginationControls
                currentPage={page}
                totalItems={total}
                pageSize={pageSize}
                onPageChange={onPageChange}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
