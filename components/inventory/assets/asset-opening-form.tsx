"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InventoryLookup } from "@/components/inventory/inventory-lookup";
import { openAssetAction } from "@/app/inventory/assets/intake-actions";
import {
  AssetManufacturerFields,
  AssetReasonFields,
} from "./asset-form-fields";
import type { AssetOperationalStatus } from "@/lib/inventory/asset-types";
import type { ExpiryPrecision } from "@/lib/inventory/types";

interface FormState {
  catalog_item_id: string;
  catalog_item_name: string;
  source_line_id: string;
  source_line_label: string;
  location_id: string;
  location_name: string;
  intake_reference: string;
  row_key: string;
  manufacturer: string;
  model: string;
  manufacturer_serial: string;
  custodian_id: string;
  operational_status: AssetOperationalStatus;
  expiry_precision: ExpiryPrecision;
  expiry_input: string;
  reason: string;
  evidence_note: string;
  occurred_at: string;
}

const initialFormState: FormState = {
  catalog_item_id: "",
  catalog_item_name: "",
  source_line_id: "",
  source_line_label: "",
  location_id: "",
  location_name: "",
  intake_reference: "",
  row_key: "",
  manufacturer: "",
  model: "",
  manufacturer_serial: "",
  custodian_id: "",
  operational_status: "ready",
  expiry_precision: "not_required",
  expiry_input: "",
  reason: "",
  evidence_note: "",
  occurred_at: "",
};

export function AssetOpeningForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialFormState);
  const [retryKey, setRetryKey] = useState(() => crypto.randomUUID());
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<{
    id: string;
    asset_code: string;
    revision: number;
  } | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    if (
      form.manufacturer_serial.trim() &&
      (!form.manufacturer.trim() || !form.model.trim())
    ) {
      setServerError("Khi có số sê-ri, Hãng sản xuất và Model là bắt buộc.");
      return;
    }

    startTransition(async () => {
      const res = await openAssetAction({
        catalog_item_id: form.catalog_item_id,
        source_line_id: form.source_line_id.trim() || null,
        location_id: form.location_id,
        intake_reference: form.intake_reference,
        row_key: form.row_key,
        manufacturer: form.manufacturer.trim() || null,
        model: form.model.trim() || null,
        manufacturer_serial: form.manufacturer_serial.trim() || null,
        custodian_id: form.custodian_id.trim() || null,
        operational_status: form.operational_status,
        expiry_precision: form.expiry_precision,
        expiry_input: form.expiry_input.trim() || null,
        reason: form.reason,
        evidence_note: form.evidence_note,
        occurred_at: form.occurred_at.trim() || undefined,
        retryKey,
      });

      if (!res.ok) {
        setServerError(res.error || "Giao dịch ghi nhận tồn đầu kỳ thất bại");
      } else if (res.data) {
        setSuccessResult({
          id: res.data.id,
          asset_code: res.data.asset_code,
          revision: res.data.revision,
        });
      }
    });
  };

  const handleResetForNext = () => {
    setForm((prev) => ({
      ...prev,
      row_key: "",
      manufacturer_serial: "",
      reason: "",
      evidence_note: "",
    }));
    setRetryKey(crypto.randomUUID());
    setSuccessResult(null);
    setServerError(null);
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs max-w-4xl mx-auto space-y-6">
      <div className="border-b pb-4 border-slate-200">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
            Dành riêng Quản trị viên (Admin)
          </span>
        </div>
        <h2 className="text-lg font-bold text-slate-900 mt-1">
          Ghi nhận Tồn đầu kỳ Thiết bị Cá thể / Opening Balance Asset
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Khởi tạo tài sản hiện hữu từ biên bản kiểm kê đầu kỳ. Thao tác này ghi
          nhận thực thể độc lập với số dư sổ cái và không tạo đơn mua hàng ngầm
          định.
        </p>
      </div>

      {serverError && (
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs space-y-1">
          <div className="font-semibold">Lỗi ghi nhận tồn đầu kỳ:</div>
          <div>{serverError}</div>
        </div>
      )}

      {successResult ? (
        <div className="p-6 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-center space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">
            [Đã ghi nhận]
          </div>
          <div>
            <h3 className="text-base font-bold">
              Ghi nhận tài sản đầu kỳ thành công!
            </h3>
            <p className="text-xs text-emerald-700 mt-1">
              Mã tài sản chuẩn máy chủ cấp phát:
            </p>
            <div className="inline-block mt-2 px-4 py-1.5 bg-white border border-emerald-400 rounded-md font-mono text-lg font-bold tracking-widest text-emerald-800 shadow-xs">
              {successResult.asset_code}
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Link
              href={`/inventory/assets/${successResult.id}`}
              className="button button-primary text-xs px-4 py-2"
            >
              Xem chi tiết & In tem QR →
            </Link>
            <button
              type="button"
              onClick={handleResetForNext}
              className="button button-secondary text-xs px-4 py-2"
            >
              Ghi nhận thiết bị đầu kỳ kế tiếp
            </button>
            <button
              type="button"
              onClick={() => router.push("/inventory/assets")}
              className="button button-secondary text-xs px-4 py-2"
            >
              Về danh sách tài sản
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Section 1: Catalog & Optional Source Line */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              1. Thông tin Danh mục & Dòng nguồn (Tùy chọn)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <InventoryLookup
                  id="open-item-lookup"
                  resource="items"
                  value={form.catalog_item_id}
                  label="Vật tư danh mục (Theo dõi cá thể / Serialized) *"
                  selectedLabel={form.catalog_item_name}
                  onSelect={(item: Record<string, unknown>) => {
                    const code = String(item.code || "");
                    const name = String(item.name || "");
                    setForm((prev) => ({
                      ...prev,
                      catalog_item_id: String(item.id || ""),
                      catalog_item_name: code ? `${code} - ${name}` : name,
                    }));
                  }}
                  required
                />
              </div>
              <div>
                <InventoryLookup
                  id="open-source-line-lookup"
                  resource="source_lines"
                  value={form.source_line_id}
                  label="Dòng hồ sơ nguồn (Tùy chọn đối với tồn đầu kỳ)"
                  selectedLabel={form.source_line_label}
                  onSelect={(line: Record<string, unknown>) => {
                    setForm((prev) => ({
                      ...prev,
                      source_line_id: String(line.id || ""),
                      source_line_label: String(line.line_key || line.id || ""),
                    }));
                  }}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Opening Manifest & Location */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              2. Biên bản kiểm kê & Vị trí kho (Manifest & Location)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="open-manifest-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Mã biên bản kiểm kê đầu kỳ (Opening Manifest) *
                </label>
                <input
                  id="open-manifest-input"
                  type="text"
                  required
                  value={form.intake_reference}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      intake_reference: e.target.value,
                    }))
                  }
                  placeholder="VD: BBKK-DAUKY-2026"
                  className="input-field text-xs w-full"
                />
              </div>

              <div>
                <label
                  htmlFor="open-row-key-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Mã dòng biên bản (Row Key) *
                </label>
                <input
                  id="open-row-key-input"
                  type="text"
                  required
                  value={form.row_key}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, row_key: e.target.value }))
                  }
                  placeholder="VD: SHEET1-ROW-05"
                  className="input-field text-xs w-full"
                />
              </div>

              <div>
                <InventoryLookup
                  id="open-location-lookup"
                  resource="locations"
                  value={form.location_id}
                  label="Vị trí kho hiện tại *"
                  selectedLabel={form.location_name}
                  onSelect={(loc: Record<string, unknown>) => {
                    const code = String(loc.code || "");
                    const name = String(loc.name || "");
                    setForm((prev) => ({
                      ...prev,
                      location_id: String(loc.id || ""),
                      location_name: code ? `${code} (${name})` : name,
                    }));
                  }}
                  required
                />
              </div>
            </div>
          </div>

          {/* Section 3: Serial & Custody via AssetManufacturerFields */}
          <AssetManufacturerFields
            serial={form.manufacturer_serial}
            onSerialChange={(val) =>
              setForm((prev) => ({ ...prev, manufacturer_serial: val }))
            }
            manufacturer={form.manufacturer}
            onManufacturerChange={(val) =>
              setForm((prev) => ({ ...prev, manufacturer: val }))
            }
            model={form.model}
            onModelChange={(val) =>
              setForm((prev) => ({ ...prev, model: val }))
            }
            custodianId={form.custodian_id}
            onCustodianIdChange={(val) =>
              setForm((prev) => ({ ...prev, custodian_id: val }))
            }
            operationalStatus={form.operational_status}
            onOperationalStatusChange={(val) =>
              setForm((prev) => ({ ...prev, operational_status: val }))
            }
            occurredAt={form.occurred_at}
            onOccurredAtChange={(val) =>
              setForm((prev) => ({ ...prev, occurred_at: val }))
            }
            idPrefix="open"
            occurredLabel="Thời điểm kiểm kê thực tế"
          />

          {/* Section 4: Expiry Precision with Unknown Allowed */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              4. Hạn sử dụng (Expiry Precision)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="open-expiry-precision-select"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Độ chính xác hạn dùng
                </label>
                <select
                  id="open-expiry-precision-select"
                  value={form.expiry_precision}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      expiry_precision: e.target.value as ExpiryPrecision,
                    }))
                  }
                  className="input-field text-xs w-full"
                >
                  <option value="not_required">
                    Không yêu cầu hạn dùng / Not Required
                  </option>
                  <option value="day">Theo ngày (YYYY-MM-DD)</option>
                  <option value="month">Theo tháng (YYYY-MM)</option>
                  <option value="unknown">
                    Chưa rõ (Unknown - Cần xác minh sau)
                  </option>
                </select>
              </div>

              {(form.expiry_precision === "day" ||
                form.expiry_precision === "month") && (
                <div>
                  <label
                    htmlFor="open-expiry-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Ngày/Tháng hết hạn *
                  </label>
                  <input
                    id="open-expiry-input"
                    type="text"
                    required
                    value={form.expiry_input}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        expiry_input: e.target.value,
                      }))
                    }
                    placeholder={
                      form.expiry_precision === "day"
                        ? "YYYY-MM-DD (VD: 2028-12-31)"
                        : "YYYY-MM (VD: 2028-12)"
                    }
                    className="input-field text-xs w-full"
                  />
                </div>
              )}
            </div>
            {form.expiry_precision === "unknown" && (
              <div className="p-3 bg-amber-50 rounded border border-amber-200 text-amber-800 text-xs">
                Lưu ý: Tài sản ghi nhận hạn dùng{" "}
                <strong>Chưa rõ (Unknown)</strong> sẽ ở trạng thái{" "}
                <strong>Không đủ điều kiện (Ineligible)</strong> cho đến khi
                Quản trị viên thực hiện đính chính xác minh hạn sử dụng kèm bằng
                chứng.
              </div>
            )}
          </div>

          {/* Section 5: Reason & Evidence via AssetReasonFields */}
          <AssetReasonFields
            reason={form.reason}
            onReasonChange={(val) =>
              setForm((prev) => ({ ...prev, reason: val }))
            }
            evidenceNote={form.evidence_note}
            onEvidenceNoteChange={(val) =>
              setForm((prev) => ({ ...prev, evidence_note: val }))
            }
            reasonLabel="Lý do ghi nhận tồn đầu kỳ *"
            reasonPlaceholder="VD: Ghi nhận thiết bị hiện hữu theo biên bản kiểm kê tài sản đầu kỳ 2026"
            evidenceLabel="Ghi chú bằng chứng pháp lý / Quyết định thành lập *"
            evidencePlaceholder="VD: Biên bản đối chiếu số 01/BB-KK ngày 01/10/2026 có chữ ký của Hội đồng kiểm kê"
            idPrefix="open"
          />

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={() => router.push("/inventory/assets")}
              className="button button-secondary text-xs px-4 py-2"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="button button-primary text-xs px-5 py-2 font-semibold"
            >
              {isPending ? "Đang ghi nhận..." : "Xác nhận Ghi nhận Tồn đầu kỳ"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
