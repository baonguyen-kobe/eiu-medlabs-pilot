"use client";

import React, { useState, useTransition } from "react";
import { correctAssetAction } from "@/app/inventory/assets/mutation-actions";
import { readAssetOptions } from "@/app/inventory/assets/read-actions";
import type {
  EquipmentAsset,
  EquipmentAssetEvent,
} from "@/lib/inventory/asset-types";
import type { ExpiryPrecision } from "@/lib/inventory/types";

export interface AssetCorrectionFormProps {
  asset: EquipmentAsset;
  events: EquipmentAssetEvent[];
  isAdmin: boolean;
  onSuccess?: () => void;
}

export function AssetCorrectionForm({
  asset,
  events,
  isAdmin,
  onSuccess,
}: AssetCorrectionFormProps) {
  const requiresAdmin =
    asset.intake_kind === "open" || asset.expiry_precision !== "not_required";
  const canPerform = isAdmin || !requiresAdmin;

  const [expectedRevision, setExpectedRevision] = useState(asset.revision);
  const [retryKey, setRetryKey] = useState(() => crypto.randomUUID());

  const [correctsEventId, setCorrectsEventId] = useState(events[0]?.id || "");
  const [manufacturer, setManufacturer] = useState(asset.manufacturer || "");
  const [model, setModel] = useState(asset.model || "");
  const [manufacturerSerial, setManufacturerSerial] = useState(
    asset.manufacturer_serial || "",
  );
  const [expiryPrecision, setExpiryPrecision] = useState<ExpiryPrecision>(
    asset.expiry_precision || "not_required",
  );
  const [expiryInput, setExpiryInput] = useState(
    asset.expiry_precision === "month" && asset.expiry_date
      ? asset.expiry_date.slice(0, 7)
      : asset.expiry_date || "",
  );
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
        setManufacturer(latest.manufacturer || "");
        setModel(latest.model || "");
        setManufacturerSerial(latest.manufacturer_serial || "");
        setExpiryPrecision(latest.expiry_precision || "not_required");
        setExpiryInput(
          latest.expiry_precision === "month" && latest.expiry_date
            ? latest.expiry_date.slice(0, 7)
            : latest.expiry_date || "",
        );
        setCorrectsEventId(events[0]?.id || "");
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

    if (manufacturerSerial.trim() && (!manufacturer.trim() || !model.trim())) {
      setServerError("Khi có số sê-ri, Hãng sản xuất và Model là bắt buộc.");
      return;
    }

    if (!correctsEventId) {
      setServerError("Vui lòng chọn sự kiện gốc cần đính chính.");
      return;
    }

    startTransition(async () => {
      const res = await correctAssetAction({
        id: asset.id,
        expected_revision: expectedRevision,
        corrects_event_id: correctsEventId,
        manufacturer: manufacturer.trim() || null,
        model: model.trim() || null,
        manufacturer_serial: manufacturerSerial.trim() || null,
        expiry_precision: expiryPrecision,
        expiry_input: expiryInput.trim() || null,
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
        setServerError(res.error || "Lỗi đính chính thông tin tài sản");
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
          Đính chính Dữ kiện Thực tế / Fact & Expiry Correction
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Đính chính thông tin hãng, model, sê-ri hoặc xác minh hạn sử dụng có
          bằng chứng. Thao tác này tham chiếu sự kiện cũ và ghi nhận lịch sử
          mới, bảo toàn lịch sử gốc.
        </p>
      </div>

      {!canPerform && (
        <div className="p-3.5 bg-amber-50 rounded-lg border border-amber-200 text-amber-800 text-xs">
          [Quyền hạn] Tài sản này thuộc hồ sơ Tồn đầu kỳ hoặc yêu cầu hạn dùng
          bắt buộc. Chỉ có <strong>Quản trị viên (Admin)</strong> mới có quyền
          thực hiện đính chính dữ kiện pháp lý này.
        </div>
      )}

      {serverError && (
        <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs space-y-2">
          <div className="font-semibold">Lỗi đính chính:</div>
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
          [Thành công] Sự kiện đính chính thông tin đã được ghi nhận vào sổ cái!
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div>
          <label
            htmlFor="correct-target-event"
            className="block font-medium text-slate-700 mb-1"
          >
            Sự kiện gốc cần đính chính (Target Event) *
          </label>
          <select
            id="correct-target-event"
            required
            value={correctsEventId}
            onChange={(e) => setCorrectsEventId(e.target.value)}
            disabled={!canPerform}
            className="input-field text-xs w-full"
          >
            {events.length === 0 ? (
              <option value="">Không có sự kiện lịch sử</option>
            ) : (
              events.map((evt) => (
                <option key={evt.id} value={evt.id}>
                  Rev #{evt.revision} • {evt.operation} (
                  {evt.posted_at?.slice(0, 10)}) - {evt.reason}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="correct-serial-input"
              className="block font-medium text-slate-700 mb-1"
            >
              Số sê-ri nhà sản xuất (S/N)
            </label>
            <input
              id="correct-serial-input"
              type="text"
              value={manufacturerSerial}
              onChange={(e) => setManufacturerSerial(e.target.value)}
              disabled={!canPerform}
              placeholder="Để trống nếu không có"
              className="input-field font-mono text-xs w-full"
            />
          </div>

          <div>
            <label
              htmlFor="correct-mfg-input"
              className="block font-medium text-slate-700 mb-1"
            >
              Hãng sản xuất
            </label>
            <input
              id="correct-mfg-input"
              type="text"
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              disabled={!canPerform}
              className="input-field text-xs w-full"
            />
          </div>

          <div>
            <label
              htmlFor="correct-model-input"
              className="block font-medium text-slate-700 mb-1"
            >
              Model
            </label>
            <input
              id="correct-model-input"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!canPerform}
              className="input-field text-xs w-full"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="correct-expiry-precision"
              className="block font-medium text-slate-700 mb-1"
            >
              Độ chính xác hạn dùng
            </label>
            <select
              id="correct-expiry-precision"
              value={expiryPrecision}
              onChange={(e) =>
                setExpiryPrecision(e.target.value as ExpiryPrecision)
              }
              disabled={!canPerform || !isAdmin}
              className="input-field text-xs w-full"
            >
              <option value="not_required">
                Không yêu cầu hạn dùng / Not Required
              </option>
              <option value="day">Theo ngày (YYYY-MM-DD)</option>
              <option value="month">Theo tháng (YYYY-MM)</option>
              <option value="unknown">Chưa rõ (Unknown)</option>
            </select>
          </div>

          {(expiryPrecision === "day" || expiryPrecision === "month") && (
            <div>
              <label
                htmlFor="correct-expiry-input"
                className="block font-medium text-slate-700 mb-1"
              >
                Ngày/Tháng hết hạn chính xác *
              </label>
              <input
                id="correct-expiry-input"
                type="text"
                required
                value={expiryInput}
                onChange={(e) => setExpiryInput(e.target.value)}
                disabled={!canPerform || !isAdmin}
                placeholder={
                  expiryPrecision === "day"
                    ? "YYYY-MM-DD (VD: 2028-12-31)"
                    : "YYYY-MM (VD: 2028-12)"
                }
                className="input-field text-xs w-full"
              />
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="correct-reason"
            className="block font-medium text-slate-700 mb-1"
          >
            Lý do đính chính *
          </label>
          <input
            id="correct-reason"
            type="text"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!canPerform}
            placeholder="VD: Đính chính số sê-ri đúng từ tem kim loại gắn trên thân máy"
            className="input-field text-xs w-full"
          />
        </div>

        <div>
          <label
            htmlFor="correct-evidence"
            className="block font-medium text-slate-700 mb-1"
          >
            Bằng chứng xác minh đính chính *
          </label>
          <textarea
            id="correct-evidence"
            required
            rows={2}
            value={evidenceNote}
            onChange={(e) => setEvidenceNote(e.target.value)}
            disabled={!canPerform}
            placeholder="VD: Ảnh chụp tem máy và biên bản kiểm tra lại hiện trạng thiết bị số 05/BB-KT"
            className="input-field text-xs w-full"
          />
        </div>

        <div>
          <label
            htmlFor="correct-occurred-at"
            className="block font-medium text-slate-700 mb-1"
          >
            Thời điểm phát hiện / Đính chính thực tế (Tùy chọn)
          </label>
          <input
            id="correct-occurred-at"
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            disabled={!canPerform}
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
            disabled={isPending || !canPerform}
            className="button button-primary text-xs px-4 py-2 font-semibold"
          >
            {isPending ? "Đang xử lý..." : "Xác nhận Đính chính"}
          </button>
        </div>
      </form>
    </div>
  );
}
