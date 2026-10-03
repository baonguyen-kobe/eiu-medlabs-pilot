"use client";

import React, { useState, useTransition } from "react";
import { setAssetLifecycleAction } from "@/app/inventory/assets/mutation-actions";
import { readAssetOptions } from "@/app/inventory/assets/read-actions";
import { LifecycleBadge } from "./asset-status-badge";
import type {
  AssetLifecycleStatus,
  EquipmentAsset,
} from "@/lib/inventory/asset-types";

export interface AssetLifecycleFormProps {
  asset: EquipmentAsset;
  isAdmin: boolean;
  onSuccess?: () => void;
}

function getPermittedTransitions(
  current: AssetLifecycleStatus,
): AssetLifecycleStatus[] {
  switch (current) {
    case "registered":
      return ["in_service", "inactive", "retired", "disposed"];
    case "in_service":
      return ["inactive", "retired", "disposed"];
    case "inactive":
      return ["in_service", "retired", "disposed"];
    case "retired":
      return ["in_service", "disposed"];
    case "disposed":
      return [];
    default:
      return [];
  }
}

export function AssetLifecycleForm({
  asset,
  isAdmin,
  onSuccess,
}: AssetLifecycleFormProps) {
  const permitted = getPermittedTransitions(asset.lifecycle_status);
  const isTerminal = asset.lifecycle_status === "disposed";

  const [expectedRevision, setExpectedRevision] = useState(asset.revision);
  const [retryKey, setRetryKey] = useState(() => crypto.randomUUID());

  const [targetStatus, setTargetStatus] = useState<AssetLifecycleStatus>(
    permitted[0] || "in_service",
  );
  const [reason, setReason] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isStaleRevision, setIsStaleRevision] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isAdmin) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-xs text-slate-500">
        [Quản trị] Thao tác chuyển đổi vòng đời tài sản (Lifecycle) chỉ dành
        riêng cho Quản trị viên (Admin).
      </div>
    );
  }

  const handleReviewLatest = async () => {
    try {
      const res = await readAssetOptions<EquipmentAsset>("detail", {
        id: asset.id,
      });
      const latest = res.rows[0];
      if (latest) {
        setExpectedRevision(latest.revision);
        const newPermitted = getPermittedTransitions(latest.lifecycle_status);
        setTargetStatus(newPermitted[0] || "in_service");
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

    if (!confirmed) {
      setServerError("Vui lòng tích xác nhận quyết định quản trị vòng đời.");
      return;
    }

    startTransition(async () => {
      const res = await setAssetLifecycleAction({
        id: asset.id,
        expected_revision: expectedRevision,
        lifecycle_status: targetStatus,
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
        setServerError(res.error || "Lỗi thay đổi vòng đời tài sản");
      } else if (res.data) {
        setIsSuccess(true);
        setExpectedRevision(res.data.revision);
        setReason("");
        setEvidenceNote("");
        setConfirmed(false);
        setRetryKey(crypto.randomUUID());
        if (onSuccess) {
          onSuccess();
        }
      }
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
      <div className="border-b pb-3 border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
              Quản trị viên (Admin)
            </span>
          </div>
          <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mt-1">
            Quyết định Vòng đời Thiết bị / Lifecycle Transition
          </h3>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Trạng thái hiện tại:</span>
          <LifecycleBadge status={asset.lifecycle_status} />
        </div>
      </div>

      {isTerminal ? (
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs">
          [Trạng thái kết thúc] <strong>Tài sản đã thanh lý (Disposed):</strong>{" "}
          Theo quy chế quản lý tài sản S3, tài sản đã thanh lý không thể tái
          kích hoạt hay chuyển trạng thái thông thường.
        </div>
      ) : (
        <>
          {serverError && (
            <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs space-y-2">
              <div className="font-semibold">Lỗi thay đổi vòng đời:</div>
              <div>{serverError}</div>
              {isStaleRevision && (
                <div className="pt-2 border-t border-rose-200/60">
                  <button
                    type="button"
                    onClick={handleReviewLatest}
                    className="button button-secondary text-xs px-3 py-1 bg-white border-rose-300 text-rose-900 font-medium"
                  >
                    Tải lại snapshot mới nhất (Review Latest Rev #
                    {asset.revision})
                  </button>
                </div>
              )}
            </div>
          )}

          {isSuccess && (
            <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-semibold">
              [Thành công] Quyết định chuyển trạng thái vòng đời đã được ghi
              nhận thành công!
            </div>
          )}

          {asset.lifecycle_status === "retired" && (
            <div className="p-3 bg-amber-50 rounded border border-amber-200 text-amber-800 text-xs">
              [Quy chế phục hồi tài sản ngừng sử dụng] Quản trị viên có thể đưa
              tài sản từ <em>Ngừng sử dụng (Retired)</em> trở lại{" "}
              <em>Đang vận hành (In Service)</em> khi có lý do chính đáng và văn
              bản bằng chứng nghiệm thu tái sử dụng.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="lifecycle-target-status"
                  className="block font-medium text-slate-700 mb-1"
                >
                  Trạng thái vòng đời mới *
                </label>
                <select
                  id="lifecycle-target-status"
                  value={targetStatus}
                  onChange={(e) =>
                    setTargetStatus(e.target.value as AssetLifecycleStatus)
                  }
                  className="input-field text-xs w-full"
                >
                  {permitted.map((st) => (
                    <option key={st} value={st}>
                      {st === "in_service" &&
                        "Đang vận hành / In Service (Đưa vào sử dụng)"}
                      {st === "inactive" &&
                        "Tạm ngưng / Inactive (Bảo quản, lưu trữ)"}
                      {st === "retired" &&
                        "Ngừng sử dụng / Retired (Hết niên hạn, hỏng nặng)"}
                      {st === "disposed" &&
                        "Thanh lý / Disposed (Hủy bỏ, bán thanh lý)"}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="lifecycle-occurred-at"
                  className="block font-medium text-slate-700 mb-1"
                >
                  Thời điểm hiệu lực quyết định (Tùy chọn)
                </label>
                <input
                  id="lifecycle-occurred-at"
                  type="datetime-local"
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                  className="input-field text-xs w-full"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="lifecycle-reason"
                className="block font-medium text-slate-700 mb-1"
              >
                Lý do thay đổi vòng đời *
              </label>
              <input
                id="lifecycle-reason"
                type="text"
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="VD: Quyết định nghiệm thu đưa thiết bị vào vận hành chính thức tại phòng thực hành"
                className="input-field text-xs w-full"
              />
            </div>

            <div>
              <label
                htmlFor="lifecycle-evidence"
                className="block font-medium text-slate-700 mb-1"
              >
                Căn cứ bằng chứng pháp lý / Số văn bản phê duyệt *
              </label>
              <textarea
                id="lifecycle-evidence"
                required
                rows={2}
                value={evidenceNote}
                onChange={(e) => setEvidenceNote(e.target.value)}
                placeholder="VD: Quyết định số 108/QĐ-ĐHEIU ngày 03/10/2026 phê duyệt đưa vào sử dụng tài sản"
                className="input-field text-xs w-full"
              />
            </div>

            <div className="p-3 bg-slate-50 rounded border border-slate-200">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-slate-700 text-[11px] leading-relaxed">
                  Tôi xác nhận với tư cách Quản trị viên (Admin) rằng quyết định
                  thay đổi trạng thái vòng đời này là chính xác và chịu trách
                  nhiệm về tính pháp lý của hồ sơ.
                </span>
              </label>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <div className="text-[11px] text-slate-500">
                Phiên bản biểu mẫu:{" "}
                <span className="font-mono font-semibold">
                  #{expectedRevision}
                </span>
                {expectedRevision !== asset.revision && (
                  <span className="text-amber-700 font-medium ml-2">
                    (Server đã có Rev #{asset.revision})
                  </span>
                )}
              </div>
              <button
                type="submit"
                disabled={isPending || !confirmed}
                className="button button-primary text-xs px-4 py-2 font-semibold"
              >
                {isPending ? "Đang xử lý..." : "Ban hành Quyết định Vòng đời"}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
