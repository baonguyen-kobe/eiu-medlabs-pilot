"use server";

import { revalidatePath } from "next/cache";
import {
  requireInventoryAdmin,
  requireInventoryViewer,
} from "@/lib/inventory/auth";
import { assetCommand } from "@/lib/inventory/asset-client";
import { normalizeExpiryInput } from "@/lib/inventory/dates";
import { parseErrorMessage, type ActionResult } from "./action-helpers";
import type {
  AssetCommandResult,
  AssetOperationalStatus,
} from "@/lib/inventory/asset-types";
import type { ExpiryPrecision } from "@/lib/inventory/types";

/**
 * 1. Receive exact physical asset (Staff or Admin).
 */
export async function receiveAssetAction(input: {
  catalog_item_id: string;
  source_line_id: string;
  location_id: string;
  intake_reference: string;
  row_key: string;
  manufacturer?: string | null;
  model?: string | null;
  manufacturer_serial?: string | null;
  custodian_id?: string | null;
  operational_status?: AssetOperationalStatus;
  expiry_precision?: ExpiryPrecision;
  expiry_input?: string | null;
  reason: string;
  evidence_note: string;
  occurred_at?: string;
  retryKey?: string;
}): Promise<ActionResult<AssetCommandResult>> {
  try {
    await requireInventoryViewer();

    if (!input.catalog_item_id?.trim()) {
      return {
        ok: false,
        error: "Vui lòng chọn vật tư / Catalog item is required",
      };
    }
    if (!input.source_line_id?.trim()) {
      return {
        ok: false,
        error: "Vui lòng chọn dòng hồ sơ nguồn / Source line is required",
      };
    }
    if (!input.location_id?.trim()) {
      return {
        ok: false,
        error: "Vui lòng chọn vị trí lưu trữ / Location is required",
      };
    }
    if (!input.intake_reference?.trim()) {
      return {
        ok: false,
        error: "Vui lòng nhập số chứng từ nhận / Intake reference is required",
      };
    }
    if (!input.row_key?.trim()) {
      return {
        ok: false,
        error: "Vui lòng nhập định danh dòng (Row key) / Row key is required",
      };
    }
    if (!input.reason?.trim()) {
      return {
        ok: false,
        error: "Vui lòng nhập lý do nhận / Reason is required",
      };
    }
    if (!input.evidence_note?.trim()) {
      return {
        ok: false,
        error: "Vui lòng nhập ghi chú bằng chứng / Evidence note is required",
      };
    }

    const serial = input.manufacturer_serial?.trim() || null;
    const manufacturer = input.manufacturer?.trim() || null;
    const model = input.model?.trim() || null;

    if (serial && (!manufacturer || !model)) {
      return {
        ok: false,
        error:
          "Khi có số sê-ri, Hãng sản xuất (Manufacturer) và Model là bắt buộc.",
      };
    }

    let normalizedExpiry: string | null = null;
    const precision = input.expiry_precision || "not_required";
    if (precision === "day" || precision === "month") {
      const expRes = normalizeExpiryInput(precision, input.expiry_input || "");
      if (!expRes.valid) {
        return {
          ok: false,
          error: `Hạn sử dụng không hợp lệ: ${expRes.error}`,
        };
      }
      normalizedExpiry = input.expiry_input!.trim();
    }

    const payload = {
      catalog_item_id: input.catalog_item_id.trim(),
      source_line_id: input.source_line_id.trim(),
      location_id: input.location_id.trim(),
      intake_reference: input.intake_reference.trim(),
      row_key: input.row_key.trim(),
      manufacturer,
      model,
      manufacturer_serial: serial,
      custodian_id: input.custodian_id?.trim() || null,
      operational_status: input.operational_status || "ready",
      expiry_precision: precision,
      expiry_input: normalizedExpiry,
      reason: input.reason.trim(),
      evidence_note: input.evidence_note.trim(),
      occurred_at: input.occurred_at?.trim() || undefined,
    };

    const result = await assetCommand("receive_asset", payload, input.retryKey);
    revalidatePath("/inventory/assets");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const { error, code } = parseErrorMessage(err);
    return { ok: false, error, code };
  }
}

/**
 * 2. Open exact physical asset (Admin only).
 */
export async function openAssetAction(input: {
  catalog_item_id: string;
  source_line_id?: string | null;
  location_id: string;
  intake_reference: string;
  row_key: string;
  manufacturer?: string | null;
  model?: string | null;
  manufacturer_serial?: string | null;
  custodian_id?: string | null;
  operational_status?: AssetOperationalStatus;
  expiry_precision?: ExpiryPrecision;
  expiry_input?: string | null;
  reason: string;
  evidence_note: string;
  occurred_at?: string;
  retryKey?: string;
}): Promise<ActionResult<AssetCommandResult>> {
  try {
    await requireInventoryAdmin();

    if (!input.catalog_item_id?.trim()) {
      return {
        ok: false,
        error: "Vui lòng chọn vật tư / Catalog item is required",
      };
    }
    if (!input.location_id?.trim()) {
      return {
        ok: false,
        error: "Vui lòng chọn vị trí lưu trữ / Location is required",
      };
    }
    if (!input.intake_reference?.trim()) {
      return {
        ok: false,
        error:
          "Vui lòng nhập mã biên bản kiểm kê đầu kỳ / Opening manifest reference is required",
      };
    }
    if (!input.row_key?.trim()) {
      return {
        ok: false,
        error: "Vui lòng nhập định danh dòng (Row key) / Row key is required",
      };
    }
    if (!input.reason?.trim()) {
      return {
        ok: false,
        error: "Vui lòng nhập lý do ghi nhận tồn đầu kỳ / Reason is required",
      };
    }
    if (!input.evidence_note?.trim()) {
      return {
        ok: false,
        error: "Vui lòng nhập ghi chú bằng chứng / Evidence note is required",
      };
    }

    const serial = input.manufacturer_serial?.trim() || null;
    const manufacturer = input.manufacturer?.trim() || null;
    const model = input.model?.trim() || null;

    if (serial && (!manufacturer || !model)) {
      return {
        ok: false,
        error:
          "Khi có số sê-ri, Hãng sản xuất (Manufacturer) và Model là bắt buộc.",
      };
    }

    let normalizedExpiry: string | null = null;
    const precision = input.expiry_precision || "not_required";
    if (precision === "day" || precision === "month") {
      const expRes = normalizeExpiryInput(precision, input.expiry_input || "");
      if (!expRes.valid) {
        return {
          ok: false,
          error: `Hạn sử dụng không hợp lệ: ${expRes.error}`,
        };
      }
      normalizedExpiry = input.expiry_input!.trim();
    }

    const payload = {
      catalog_item_id: input.catalog_item_id.trim(),
      source_line_id: input.source_line_id?.trim() || null,
      location_id: input.location_id.trim(),
      intake_reference: input.intake_reference.trim(),
      row_key: input.row_key.trim(),
      manufacturer,
      model,
      manufacturer_serial: serial,
      custodian_id: input.custodian_id?.trim() || null,
      operational_status: input.operational_status || "ready",
      expiry_precision: precision,
      expiry_input: normalizedExpiry,
      reason: input.reason.trim(),
      evidence_note: input.evidence_note.trim(),
      occurred_at: input.occurred_at?.trim() || undefined,
    };

    const result = await assetCommand("open_asset", payload, input.retryKey);
    revalidatePath("/inventory/assets");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const { error, code } = parseErrorMessage(err);
    return { ok: false, error, code };
  }
}
