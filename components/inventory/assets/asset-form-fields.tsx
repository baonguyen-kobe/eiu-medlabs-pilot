"use client";

import React from "react";
import type { AssetOperationalStatus } from "@/lib/inventory/asset-types";

export interface AssetManufacturerFieldsProps {
  serial: string;
  onSerialChange: (val: string) => void;
  manufacturer: string;
  onManufacturerChange: (val: string) => void;
  model: string;
  onModelChange: (val: string) => void;
  custodianId: string;
  onCustodianIdChange: (val: string) => void;
  operationalStatus: AssetOperationalStatus;
  onOperationalStatusChange: (val: AssetOperationalStatus) => void;
  occurredAt: string;
  onOccurredAtChange: (val: string) => void;
  idPrefix?: string;
  occurredLabel?: string;
}

export function AssetManufacturerFields({
  serial,
  onSerialChange,
  manufacturer,
  onManufacturerChange,
  model,
  onModelChange,
  custodianId,
  onCustodianIdChange,
  operationalStatus,
  onOperationalStatusChange,
  occurredAt,
  onOccurredAtChange,
  idPrefix = "asset",
  occurredLabel = "Thời gian thực tế (Tùy chọn)",
}: AssetManufacturerFieldsProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
        Định danh nhà sản xuất & Người quản lý (Manufacturer & Custody)
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label
            htmlFor={`${idPrefix}-mfg-serial`}
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Số sê-ri nhà sản xuất (Serial Number)
          </label>
          <input
            id={`${idPrefix}-mfg-serial`}
            type="text"
            value={serial}
            onChange={(e) => onSerialChange(e.target.value)}
            placeholder="VD: SN-987654321 (nếu có)"
            className="input-field font-mono text-xs w-full"
          />
          <span className="text-[10px] text-slate-400 mt-0.5 block">
            * Nhập sê-ri bắt buộc phải điền Hãng & Model
          </span>
        </div>

        <div>
          <label
            htmlFor={`${idPrefix}-mfg-name`}
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Hãng sản xuất (Manufacturer)
          </label>
          <input
            id={`${idPrefix}-mfg-name`}
            type="text"
            value={manufacturer}
            onChange={(e) => onManufacturerChange(e.target.value)}
            placeholder="VD: Olympus, Nihon Kohden..."
            className="input-field text-xs w-full"
          />
        </div>

        <div>
          <label
            htmlFor={`${idPrefix}-mfg-model`}
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Model
          </label>
          <input
            id={`${idPrefix}-mfg-model`}
            type="text"
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder="VD: CX23, Cardiofax M..."
            className="input-field text-xs w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label
            htmlFor={`${idPrefix}-custodian-id`}
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            UUID người quản lý (Tùy chọn)
          </label>
          <input
            id={`${idPrefix}-custodian-id`}
            type="text"
            value={custodianId}
            onChange={(e) => onCustodianIdChange(e.target.value)}
            placeholder="UUID nhân sự chịu trách nhiệm (nếu có)"
            className="input-field font-mono text-xs w-full"
          />
        </div>

        <div>
          <label
            htmlFor={`${idPrefix}-op-status`}
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Trạng thái vận hành ban đầu *
          </label>
          <select
            id={`${idPrefix}-op-status`}
            value={operationalStatus}
            onChange={(e) =>
              onOperationalStatusChange(
                e.target.value as AssetOperationalStatus,
              )
            }
            className="input-field text-xs w-full"
          >
            <option value="ready">Sẵn sàng / Ready</option>
            <option value="under_maintenance">
              Bảo trì / Under Maintenance
            </option>
            <option value="damaged">Hư hỏng / Damaged</option>
            <option value="in_use">Đang sử dụng / In Use</option>
            <option value="prohibited">Cấm lưu hành / Prohibited</option>
          </select>
        </div>

        <div>
          <label
            htmlFor={`${idPrefix}-occurred-at`}
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            {occurredLabel}
          </label>
          <input
            id={`${idPrefix}-occurred-at`}
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => onOccurredAtChange(e.target.value)}
            className="input-field text-xs w-full"
          />
        </div>
      </div>
    </div>
  );
}

export interface AssetReasonFieldsProps {
  reason: string;
  onReasonChange: (val: string) => void;
  evidenceNote: string;
  onEvidenceNoteChange: (val: string) => void;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  evidenceLabel?: string;
  evidencePlaceholder?: string;
  idPrefix?: string;
}

export function AssetReasonFields({
  reason,
  onReasonChange,
  evidenceNote,
  onEvidenceNoteChange,
  reasonLabel = "Lý do tiếp nhận tài sản *",
  reasonPlaceholder = "VD: Nhập bàn giao thiết bị phòng thí nghiệm từ gói thầu TB-2026",
  evidenceLabel = "Ghi chú bằng chứng / Biên bản bàn giao *",
  evidencePlaceholder = "VD: Biên bản nghiệm thu số 45/BB-NT ngày 03/10/2026 kèm phiếu bảo hành",
  idPrefix = "asset",
}: AssetReasonFieldsProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
        Lý do & Bằng chứng pháp lý (Reason & Evidence)
      </h3>
      <div className="space-y-3">
        <div>
          <label
            htmlFor={`${idPrefix}-reason`}
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            {reasonLabel}
          </label>
          <input
            id={`${idPrefix}-reason`}
            type="text"
            required
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder={reasonPlaceholder}
            className="input-field text-xs w-full"
          />
        </div>

        <div>
          <label
            htmlFor={`${idPrefix}-evidence`}
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            {evidenceLabel}
          </label>
          <textarea
            id={`${idPrefix}-evidence`}
            required
            rows={3}
            value={evidenceNote}
            onChange={(e) => onEvidenceNoteChange(e.target.value)}
            placeholder={evidencePlaceholder}
            className="input-field text-xs w-full"
          />
        </div>
      </div>
    </div>
  );
}
