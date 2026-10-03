"use client";

import React, { useState, useTransition } from "react";
import { InventoryLookup } from "@/components/inventory/inventory-lookup";
import { setAssetStateAction } from "@/app/inventory/assets/mutation-actions";
import { readAssetOptions } from "@/app/inventory/assets/read-actions";
import type {
  AssetOperationalStatus,
  EquipmentAsset,
} from "@/lib/inventory/asset-types";

export interface AssetStateFormProps {
  asset: EquipmentAsset;
  onSuccess?: () => void;
}

export function AssetStateForm({ asset, onSuccess }: AssetStateFormProps) {
  // Freeze expected_revision alongside initial snapshot fields to avoid silent rebase
  const [expectedRevision, setExpectedRevision] = useState(asset.revision);
  const [retryKey, setRetryKey] = useState(() => crypto.randomUUID());

  const [locationId, setLocationId] = useState(asset.location_id);
  const [locationName, setLocationName] = useState(
    asset.location_code
      ? `${asset.location_code} (${asset.location_name})`
      : asset.location_name,
  );
  const [custodianId, setCustodianId] = useState(asset.custodian_id || "");
  const [operationalStatus, setOperationalStatus] =
    useState<AssetOperationalStatus>(asset.operational_status);
  const [reason, setReason] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [occurredAt, setOccurredAt] = useState("");

  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isStaleRevision, setIsStaleRevision] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleReviewLatest = async () => {
    try {
      const res = await readAssetOptions<EquipmentAsset>("detail", {
        id: asset.id,
      });
      const latest = res.rows[0];
      if (latest) {
        setExpectedRevision(latest.revision);
        setLocationId(latest.location_id);
        setLocationName(
          latest.location_code
            ? `${latest.location_code} (${latest.location_name})`
            : latest.location_name,
        );
        setCustodianId(latest.custodian_id || "");
        setOperationalStatus(latest.operational_status);
        setRetryKey(crypto.randomUUID());
        setIsStaleRevision(false);
        setServerError(null);
      }
    } catch {
      // retain state if network error
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setIsStaleRevision(false);
    setIsSuccess(false);

    startTransition(async () => {
      const res = await setAssetStateAction({
        id: asset.id,
        expected_revision: expectedRevision,
        location_id: locationId,
        custodian_id: custodianId.trim() || null,
        operational_status: operationalStatus,
        reason,
        evidence_note: evidenceNote,
        occurred_at: occurredAt.trim() || undefined,
        retryKey,
      });

      if (!res.ok) {
        if (
          res.code === "STALE_REVISION" ||
          res.error?.includes("STALE_REVISION")
        ) {
          setIsStaleRevision(true);
        }
        setServerError(res.error || "Lỗi cập nhật trạng thái vật lý");
      } else if (res.data) {
        setIsSuccess(true);
        setExpectedRevision(res.data.revision);
        setReason("");
        setEvidenceNote("");
        setRetryKey(crypto.randomUUID());
        if (onSuccess) {
          onSuccess();
        }
      }
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      <div className="border-b pb-3 border-slate-200">
        <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">
          Cập nhật Vị trí & Trạng thái Vận hành / Update Physical State
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Ghi nhận thực tế quan sát hiện trường (Vị trí, hiện trạng hoạt động,
          nhân sự chịu trách nhiệm).
        </p>
      </div>

      {serverError && (
        <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs space-y-2">
          <div className="font-semibold">Lỗi cập nhật trạng thái:</div>
          <div>{serverError}</div>
          {isStaleRevision && (
            <div className="pt-2 border-t border-rose-200/60">
              <button
                type="button"
                onClick={handleReviewLatest}
                className="button button-secondary text-xs px-3 py-1 bg-white border-rose-300 text-rose-900 font-medium"
              >
                Tải lại snapshot mới nhất (Review Latest Rev #{asset.revision})
              </button>
            </div>
          )}
        </div>
      )}

      {isSuccess && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-semibold">
          [Thành công] Đã cập nhật vị trí và trạng thái vật lý thành công!
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <InventoryLookup
              id="state-location-lookup"
              resource="locations"
              value={locationId}
              label="Vị trí lưu trữ hiện tại *"
              selectedLabel={locationName}
              onSelect={(loc: Record<string, unknown>) => {
                const code = String(loc.code || "");
                const name = String(loc.name || "");
                setLocationId(String(loc.id || ""));
                setLocationName(code ? `${code} (${name})` : name);
              }}
              required
            />
          </div>

          <div>
            <label
              htmlFor="state-operational-status"
              className="block font-medium text-slate-700 mb-1"
            >
              Trạng thái vận hành thực tế *
            </label>
            <select
              id="state-operational-status"
              value={operationalStatus}
              onChange={(e) =>
                setOperationalStatus(e.target.value as AssetOperationalStatus)
              }
              className="input-field text-xs w-full"
            >
              <option value="ready">Sẵn sàng / Ready</option>
              <option value="in_use">Đang sử dụng / In Use</option>
              <option value="under_maintenance">
                Đang bảo trì / Under Maintenance
              </option>
              <option value="damaged">Hư hỏng / Damaged</option>
              <option value="prohibited">Cấm lưu hành / Prohibited</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="state-custodian-id"
              className="block font-medium text-slate-700 mb-1"
            >
              UUID người quản lý / Người chịu trách nhiệm (Tùy chọn)
            </label>
            <input
              id="state-custodian-id"
              type="text"
              value={custodianId}
              onChange={(e) => setCustodianId(e.target.value)}
              placeholder="Để trống nếu không giao cá nhân quản lý"
              className="input-field font-mono text-xs w-full"
            />
          </div>

          <div>
            <label
              htmlFor="state-occurred-at"
              className="block font-medium text-slate-700 mb-1"
            >
              Thời điểm quan sát / Bàn giao thực tế (Tùy chọn)
            </label>
            <input
              id="state-occurred-at"
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="input-field text-xs w-full"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="state-reason"
            className="block font-medium text-slate-700 mb-1"
          >
            Lý do cập nhật trạng thái vật lý *
          </label>
          <input
            id="state-reason"
            type="text"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="VD: Điều chuyển thiết bị sang Phòng Thực hành 302 phục vụ giảng dạy"
            className="input-field text-xs w-full"
          />
        </div>

        <div>
          <label
            htmlFor="state-evidence"
            className="block font-medium text-slate-700 mb-1"
          >
            Ghi chú bằng chứng thực tế *
          </label>
          <textarea
            id="state-evidence"
            required
            rows={2}
            value={evidenceNote}
            onChange={(e) => setEvidenceNote(e.target.value)}
            placeholder="VD: Phiếu giao nhận nội bộ số 12/PGN ký nhận bởi bộ môn Điều dưỡng"
            className="input-field text-xs w-full"
          />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-200">
          <div className="text-[11px] text-slate-500">
            Phiên bản biểu mẫu:{" "}
            <span className="font-mono font-semibold">#{expectedRevision}</span>
            {expectedRevision !== asset.revision && (
              <span className="text-amber-700 font-medium ml-2">
                (Server đã có Rev #{asset.revision})
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="button button-primary text-xs px-4 py-2 font-semibold"
          >
            {isPending ? "Đang cập nhật..." : "Lưu thay đổi trạng thái"}
          </button>
        </div>
      </form>
    </div>
  );
}
