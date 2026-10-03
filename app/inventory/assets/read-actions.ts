"use server";

import { requireInventoryViewer } from "@/lib/inventory/auth";
import { assetRead } from "@/lib/inventory/asset-client";
import type {
  AssetReadFilters,
  AssetReadResult,
  AssetResource,
  EquipmentAsset,
  AssetLookupResponse,
} from "@/lib/inventory/asset-types";

const ASSET_CODE_REGEX = /^EIU-AST-[0-9A-F]{8}$/;

export interface ActionResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

/**
 * Shared authorized server action for single bounded RPC page read of assets.
 */
export async function readAssetOptions<T = EquipmentAsset>(
  resource: AssetResource,
  filters: AssetReadFilters = {},
): Promise<AssetReadResult<T>> {
  await requireInventoryViewer();

  const page =
    typeof filters.page === "number" && filters.page > 0 ? filters.page : 1;
  const pageSize = Math.min(
    typeof filters.page_size === "number" && filters.page_size > 0
      ? filters.page_size
      : 50,
    100,
  );

  return await assetRead<T>(resource, {
    ...filters,
    page,
    page_size: pageSize,
  });
}

/**
 * Authenticated exact lookup by asset_code.
 * Rejects malformed codes before dispatching to RPC.
 * Returns asset details, found status, physical eligibility, and availability for new reservations.
 */
export async function lookupAssetAction(
  rawAssetCode: string,
): Promise<ActionResult<AssetLookupResponse>> {
  try {
    await requireInventoryViewer();

    const assetCode = (rawAssetCode || "").trim().toUpperCase();
    if (!assetCode) {
      return {
        ok: false,
        error: "Vui lòng nhập hoặc quét mã tài sản / Asset code is required",
      };
    }

    if (!ASSET_CODE_REGEX.test(assetCode)) {
      return {
        ok: false,
        error: `Mã tài sản không đúng định dạng chuẩn EIU-AST-XXXXXXXX (8 ký tự hex viết hoa). Nhận được: "${assetCode}"`,
      };
    }

    const result = await assetRead<EquipmentAsset>("lookup", {
      asset_code: assetCode,
    });

    if (result.rows.length === 0) {
      return {
        ok: true,
        data: {
          asset: null,
          found: false,
          eligible: false,
          available: false,
          ineligibility_reasons: [
            "Không tìm thấy tài sản trong hệ thống / Asset not found",
          ],
        },
      };
    }

    const asset = result.rows[0];
    return {
      ok: true,
      data: {
        asset,
        found: true,
        eligible: Boolean(asset.eligible),
        available: asset.available,
        ineligibility_reasons: asset.ineligibility_reasons || [],
      },
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi tra cứu mã tài sản";
    return { ok: false, error: message };
  }
}
