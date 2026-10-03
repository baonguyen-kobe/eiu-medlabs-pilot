"use server";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/database.types";
import {
  preparationError,
  type PreparationResult,
} from "@/lib/equipment-preparation";
import type { TransferReadResource } from "@/lib/equipment-preparation-transfers";

export async function readPreparationTransfers(
  requestId: string,
  resource: TransferReadResource,
  filters: Record<string, Json> = {},
): Promise<PreparationResult<Json>> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      requestId,
    )
  )
    return { ok: false, error: "Mã phiếu không hợp lệ." };
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub)
    return { ok: false, error: "Phiên đăng nhập đã hết hạn." };
  const { data, error } = await db.rpc("equipment_preparation_transfer_read", {
    p_request_id: requestId,
    p_resource: resource,
    p_filters: filters,
  });
  return error
    ? { ok: false, error: preparationError(error.message) }
    : { ok: true, data };
}
