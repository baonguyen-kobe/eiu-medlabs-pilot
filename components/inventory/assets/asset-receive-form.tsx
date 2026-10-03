"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { InventoryLookup } from "@/components/inventory/inventory-lookup";
import { receiveAssetAction } from "@/app/inventory/assets/intake-actions";
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

export function AssetReceiveForm() {
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
      const res = await receiveAssetAction({
        catalog_item_id: form.catalog_item_id,
        source_line_id: form.source_line_id,
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
        setServerError(res.error || "Giao dịch tiếp nhận thất bại");
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
        <h2 className="text-lg font-bold text-slate-900">
          Tiếp nhận Thiết bị Cá thể / Receive Physical Asset
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Ghi nhận chính xác một thực thể vật lý vào hệ thống. Mã tài sản{" "}
          <code>EIU-AST-XXXXXXXX</code> sẽ được máy chủ khởi tạo bất biến.
        </p>
      </div>

      {serverError && (
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs space-y-1">
          <div className="font-semibold">Lỗi tiếp nhận tài sản:</div>
          <div>{serverError}</div>
        </div>
      )}

      {successResult ? (
        <div className="p-6 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-center space-y-4">
          <div className="text-xs font-bold uppercase tracking-wider text-emerald-700">
            [Đã tiếp nhận]
          </div>
          <div>
            <h3 className="text-base font-bold">
              Tiếp nhận tài sản thành công!
            </h3>
            <p className="text-xs text-emerald-700 mt-1">
              Hệ thống đã khởi tạo mã định danh duy nhất:
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
              Tiếp nhận thiết bị kế tiếp
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
          {/* Section 1: Catalog & Source Line */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              1. Thông tin Danh mục & Hồ sơ nguồn (Item & Source)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <InventoryLookup
                  id="receive-item-lookup"
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
                  id="receive-source-line-lookup"
                  resource="source_lines"
                  value={form.source_line_id}
                  label="Dòng hồ sơ nguồn (Source Line) *"
                  selectedLabel={form.source_line_label}
                  onSelect={(line: Record<string, unknown>) => {
                    setForm((prev) => ({
                      ...prev,
                      source_line_id: String(line.id || ""),
                      source_line_label: String(line.line_key || line.id || ""),
                    }));
                  }}
                  required
                />
              </div>
            </div>
          </div>

          {/* Section 2: Intake Reference & Location */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              2. Chứng từ tiếp nhận & Vị trí kho (Intake & Location)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="intake-reference-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Số chứng từ nhận (Intake Reference) *
                </label>
                <input
                  id="intake-reference-input"
                  type="text"
                  required
                  value={form.intake_reference}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      intake_reference: e.target.value,
                    }))
                  }
                  placeholder="VD: PO-2026-001 hoặc HD-9988"
                  className="input-field text-xs w-full"
                />
              </div>

              <div>
                <label
                  htmlFor="row-key-input"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Định danh dòng chứng từ (Row Key) *
                </label>
                <input
                  id="row-key-input"
                  type="text"
                  required
                  value={form.row_key}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, row_key: e.target.value }))
                  }
                  placeholder="VD: ITEM-1-UNIT-01"
                  className="input-field text-xs w-full"
                />
              </div>

              <div>
                <InventoryLookup
                  id="receive-location-lookup"
                  resource="locations"
                  value={form.location_id}
                  label="Vị trí lưu trữ ban đầu *"
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

          {/* Section 3: Physical Identifiers & Serial via AssetManufacturerFields */}
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
            idPrefix="recv"
            occurredLabel="Thời gian nhận thực tế (Tùy chọn)"
          />

          {/* Section 4: Expiry */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              4. Hạn sử dụng (Expiry)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="expiry-precision-select"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Độ chính xác hạn dùng
                </label>
                <select
                  id="expiry-precision-select"
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
                </select>
              </div>

              {form.expiry_precision !== "not_required" && (
                <div>
                  <label
                    htmlFor="expiry-input"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Ngày/Tháng hết hạn *
                  </label>
                  <input
                    id="expiry-input"
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
            reasonLabel="Lý do tiếp nhận tài sản *"
            reasonPlaceholder="VD: Nhập bàn giao thiết bị phòng thí nghiệm từ gói thầu TB-2026"
            evidenceLabel="Ghi chú bằng chứng / Biên bản nghiệm thu bàn giao *"
            evidencePlaceholder="VD: Biên bản nghiệm thu số 45/BB-NT ngày 03/10/2026 kèm phiếu bảo hành"
            idPrefix="recv"
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
              {isPending ? "Đang tiếp nhận..." : "Xác nhận Tiếp nhận Thiết bị"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
