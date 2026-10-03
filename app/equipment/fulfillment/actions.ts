"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processPendingEmailOutbox } from "@/lib/equipment-request-emails";
import type { Json } from "@/lib/database.types";
import {
  fulfillmentError,
  fulfillmentSchema,
  type FulfillmentOperation,
} from "@/lib/equipment-fulfillment";
import { isEquipmentRequestId } from "@/lib/equipment-calendar-request";

export async function readFulfillment(requestId: string, page = 1) {
  if (!isEquipmentRequestId(requestId))
    return { ok: false as const, error: "Mã phiếu không hợp lệ." };
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub)
    return { ok: false as const, error: "Phiên đăng nhập đã hết hạn." };
  const { data, error } = await db.rpc("equipment_fulfillment_read", {
    p_request_id: requestId,
    p_page: page,
  });
  if (error)
    return { ok: false as const, error: fulfillmentError(error.message) };
  return { ok: true as const, data: fulfillmentSchema.parse(data) };
}

export async function changeFulfillment(
  requestId: string,
  operation: FulfillmentOperation,
  payload: Record<string, Json>,
  retryKey: string,
) {
  if (
    !isEquipmentRequestId(requestId) ||
    !isEquipmentRequestId(retryKey) ||
    !payload ||
    JSON.stringify(payload).length > 750_000
  )
    return { ok: false as const, error: "Dữ liệu thao tác không hợp lệ." };
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub)
    return { ok: false as const, error: "Phiên đăng nhập đã hết hạn." };
  const { error, status } = await db.rpc("equipment_fulfillment_command", {
    p_request_id: requestId,
    p_operation: operation,
    p_payload: payload,
    p_retry_key: retryKey,
  });
  if (error)
    return {
      ok: false as const,
      uncertain:
        status === 0 || status >= 500 || !/^[0-9A-Z]{5}$/.test(error.code),
      error: fulfillmentError(error.message),
    };
  for (const path of [
    "/equipment/requests",
    "/equipment/mine",
    "/inventory/stock",
    "/inventory/assets",
    `/equipment/fulfillment/${requestId}`,
  ])
    revalidatePath(path);
  after(() => processPendingEmailOutbox());
  const result = await readFulfillment(requestId);
  if (!result.ok)
    return {
      ok: false as const,
      committed: true as const,
      error: `Thao tác đã ghi nhận; chưa tải được phiên bản mới. Giữ nguyên yêu cầu và thử lại: ${result.error}`,
    };
  return result;
}
