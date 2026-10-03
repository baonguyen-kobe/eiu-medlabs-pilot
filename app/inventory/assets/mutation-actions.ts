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
  AssetLifecycleStatus,
  AssetOperationalStatus,
} from "@/lib/inventory/asset-types";
import type { ExpiryPrecision } from "@/lib/inventory/types";

/**
 * 3. Set asset physical state (Staff or Admin).
 * Requires own-key presence for custodian_id before normalization.
 */
export async function setAssetStateAction(input: {
  id: string;
  expected_revision: number;
  location_id: string;
  custodian_id: string | null;
  operational_status: AssetOperationalStatus;
  reason: string;
  evidence_note: string;
  occurred_at?: string;
  retryKey?: string;
}): Promise<ActionResult<AssetCommandResult>> {
  try {
    await requireInventoryViewer();

    if (!input.id?.trim()) {
      return {
        ok: false,
        error: "Mã định danh tài sản không hợp lệ / Asset ID is required",
      };
    }
    if (
      !Number.isSafeInteger(input.expected_revision) ||
      input.expected_revision < 1
    ) {
      return {
        ok: false,
        error: "Phiên bản kỳ vọng không hợp lệ / Invalid expected revision",
      };
    }
    if (!input.location_id?.trim()) {
      return {
        ok: false,
        error: "Vui lòng chọn vị trí lưu trữ / Location is required",
      };
    }
    if (!input.operational_status) {
      return {
        ok: false,
        error:
          "Vui lòng chọn trạng thái vận hành / Operational status is required",
      };
    }
    if (!Object.prototype.hasOwnProperty.call(input, "custodian_id")) {
      return {
        ok: false,
        error:
          "Trường 'custodian_id' là bắt buộc trong snapshot trạng thái (phải truyền giá trị hoặc null rõ ràng).",
      };
    }
    if (!input.reason?.trim()) {
      return {
        ok: false,
        error: "Vui lòng nhập lý do thay đổi trạng thái / Reason is required",
      };
    }
    if (!input.evidence_note?.trim()) {
      return {
        ok: false,
        error: "Vui lòng nhập ghi chú bằng chứng / Evidence note is required",
      };
    }

    const custodian_id =
      input.custodian_id === null
        ? null
        : typeof input.custodian_id === "string"
          ? input.custodian_id.trim() || null
          : null;

    const payload = {
      id: input.id.trim(),
      expected_revision: input.expected_revision,
      location_id: input.location_id.trim(),
      custodian_id,
      operational_status: input.operational_status,
      reason: input.reason.trim(),
      evidence_note: input.evidence_note.trim(),
      occurred_at: input.occurred_at?.trim() || undefined,
    };

    const result = await assetCommand(
      "set_asset_state",
      payload,
      input.retryKey,
    );
    revalidatePath(`/inventory/assets/${input.id}`);
    revalidatePath("/inventory/assets");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const { error, code } = parseErrorMessage(err);
    return { ok: false, error, code };
  }
}

/**
 * 4. Set asset lifecycle (Admin only).
 */
export async function setAssetLifecycleAction(input: {
  id: string;
  expected_revision: number;
  lifecycle_status: AssetLifecycleStatus;
  reason: string;
  evidence_note: string;
  occurred_at?: string;
  retryKey?: string;
}): Promise<ActionResult<AssetCommandResult>> {
  try {
    await requireInventoryAdmin();

    if (!input.id?.trim()) {
      return {
        ok: false,
        error: "Mã định danh tài sản không hợp lệ / Asset ID is required",
      };
    }
    if (
      !Number.isSafeInteger(input.expected_revision) ||
      input.expected_revision < 1
    ) {
      return {
        ok: false,
        error: "Phiên bản kỳ vọng không hợp lệ / Invalid expected revision",
      };
    }
    if (!input.lifecycle_status) {
      return {
        ok: false,
        error:
          "Vui lòng chọn trạng thái vòng đời / Lifecycle status is required",
      };
    }
    if (!input.reason?.trim()) {
      return {
        ok: false,
        error: "Vui lòng nhập lý do thay đổi vòng đời / Reason is required",
      };
    }
    if (!input.evidence_note?.trim()) {
      return {
        ok: false,
        error: "Vui lòng nhập ghi chú bằng chứng / Evidence note is required",
      };
    }

    const payload = {
      id: input.id.trim(),
      expected_revision: input.expected_revision,
      lifecycle_status: input.lifecycle_status,
      reason: input.reason.trim(),
      evidence_note: input.evidence_note.trim(),
      occurred_at: input.occurred_at?.trim() || undefined,
    };

    const result = await assetCommand(
      "set_asset_lifecycle",
      payload,
      input.retryKey,
    );
    revalidatePath(`/inventory/assets/${input.id}`);
    revalidatePath("/inventory/assets");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const { error, code } = parseErrorMessage(err);
    return { ok: false, error, code };
  }
}

/**
 * 5. Correct asset metadata & expiry facts.
 * Strict required snapshot keys: manufacturer, model, manufacturer_serial, expiry_precision, expiry_input.
 * Requires own-key presence for all snapshot keys before normalization (explicit null allowed).
 * Authorization for Admin opening/required-expiry is authoritatively enforced by DB RPC.
 */
export async function correctAssetAction(input: {
  id: string;
  expected_revision: number;
  corrects_event_id: string;
  manufacturer: string | null;
  model: string | null;
  manufacturer_serial: string | null;
  expiry_precision: ExpiryPrecision;
  expiry_input: string | null;
  reason: string;
  evidence_note: string;
  occurred_at?: string;
  retryKey?: string;
}): Promise<ActionResult<AssetCommandResult>> {
  try {
    await requireInventoryViewer();

    if (!input.id?.trim()) {
      return {
        ok: false,
        error: "Mã định danh tài sản không hợp lệ / Asset ID is required",
      };
    }
    if (
      !Number.isSafeInteger(input.expected_revision) ||
      input.expected_revision < 1
    ) {
      return {
        ok: false,
        error: "Phiên bản kỳ vọng không hợp lệ / Invalid expected revision",
      };
    }
    if (!input.corrects_event_id?.trim()) {
      return {
        ok: false,
        error:
          "Vui lòng chọn sự kiện cần đính chính / Event to correct is required",
      };
    }

    // Require own-key presence for all snapshot keys before normalization (explicit null allowed)
    const requiredSnapshotKeys = [
      "manufacturer",
      "model",
      "manufacturer_serial",
      "expiry_precision",
      "expiry_input",
    ] as const;

    for (const key of requiredSnapshotKeys) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) {
        return {
          ok: false,
          error: `Trường snapshot '${key}' là bắt buộc trong đính chính (phải truyền giá trị hoặc null rõ ràng).`,
        };
      }
    }

    if (!input.reason?.trim()) {
      return {
        ok: false,
        error: "Vui lòng nhập lý do đính chính / Reason is required",
      };
    }
    if (!input.evidence_note?.trim()) {
      return {
        ok: false,
        error: "Vui lòng nhập ghi chú bằng chứng / Evidence note is required",
      };
    }

    const serial =
      input.manufacturer_serial === null
        ? null
        : typeof input.manufacturer_serial === "string"
          ? input.manufacturer_serial.trim() || null
          : null;
    const manufacturer =
      input.manufacturer === null
        ? null
        : typeof input.manufacturer === "string"
          ? input.manufacturer.trim() || null
          : null;
    const model =
      input.model === null
        ? null
        : typeof input.model === "string"
          ? input.model.trim() || null
          : null;

    if (serial && (!manufacturer || !model)) {
      return {
        ok: false,
        error:
          "Khi có số sê-ri, Hãng sản xuất (Manufacturer) và Model là bắt buộc.",
      };
    }

    let normalizedExpiry: string | null = null;
    const precision = input.expiry_precision;
    if (precision === "day" || precision === "month") {
      const expRes = normalizeExpiryInput(precision, input.expiry_input || "");
      if (!expRes.valid) {
        return {
          ok: false,
          error: `Hạn sử dụng không hợp lệ: ${expRes.error}`,
        };
      }
      normalizedExpiry = input.expiry_input!.trim();
    } else if (precision === "unknown" || precision === "not_required") {
      normalizedExpiry = null;
    } else {
      return { ok: false, error: "Độ chính xác hạn dùng không hợp lệ" };
    }

    const payload = {
      id: input.id.trim(),
      expected_revision: input.expected_revision,
      corrects_event_id: input.corrects_event_id.trim(),
      manufacturer,
      model,
      manufacturer_serial: serial,
      expiry_precision: precision,
      expiry_input: normalizedExpiry,
      reason: input.reason.trim(),
      evidence_note: input.evidence_note.trim(),
      occurred_at: input.occurred_at?.trim() || undefined,
    };

    const result = await assetCommand("correct_asset", payload, input.retryKey);
    revalidatePath(`/inventory/assets/${input.id}`);
    revalidatePath("/inventory/assets");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const { error, code } = parseErrorMessage(err);
    return { ok: false, error, code };
  }
}
