"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processPendingEmailOutbox } from "@/lib/equipment-request-emails";
import type { Json } from "@/lib/database.types";
import {
  preparationError,
  type PreparationOperation,
  type PreparationResult,
  type PreparationWorkspace,
} from "@/lib/equipment-preparation";
import { preparationWorkspaceSchema } from "@/lib/equipment-preparation";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readPreparation(
  requestId: string,
  resource:
    "workspace" | "stock" | "assets" | "history" | "catalog" = "workspace",
  filters: Record<string, Json> = {},
): Promise<PreparationResult<Json>> {
  if (!uuid.test(requestId))
    return { ok: false, error: "Mã phiếu không hợp lệ." };
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub)
    return { ok: false, error: "Phiên đăng nhập đã hết hạn." };
  const { data, error } = await db.rpc("equipment_preparation_read", {
    p_request_id: requestId,
    p_resource: resource,
    p_filters: filters,
  });
  return error
    ? { ok: false, error: preparationError(error.message) }
    : { ok: true, data };
}

export async function changePreparation(
  requestId: string,
  operation: PreparationOperation | "physical_transfer",
  payload: Record<string, Json>,
  retryKey: string,
): Promise<PreparationResult<PreparationWorkspace>> {
  if (
    !uuid.test(requestId) ||
    !uuid.test(retryKey) ||
    !payload ||
    JSON.stringify(payload).length > 750_000
  )
    return { ok: false, error: "Dữ liệu thao tác không hợp lệ." };
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub)
    return { ok: false, error: "Phiên đăng nhập đã hết hạn." };
  const { error } =
    operation === "physical_transfer"
      ? await db.rpc("equipment_preparation_transfer", {
          p_request_id: requestId,
          p_payload: payload,
          p_retry_key: retryKey,
        })
      : await db.rpc("equipment_preparation_command", {
          p_request_id: requestId,
          p_operation: operation,
          p_payload: payload,
          p_retry_key: retryKey,
        });
  if (error) return { ok: false, error: preparationError(error.message) };
  const { data, error: readError } = await db.rpc(
    "equipment_preparation_read",
    { p_request_id: requestId },
  );
  if (readError)
    return {
      ok: false,
      error: `Thao tác đã ghi nhận; không tải được phiên bản mới: ${preparationError(readError.message)}`,
    };
  if (!["save", "heartbeat", "release_lock"].includes(operation)) {
    revalidatePath("/equipment/requests");
    revalidatePath("/equipment/mine");
    revalidatePath("/inventory/stock");
    revalidatePath("/inventory/assets");
    if (
      ["confirm", "approve_adjustment", "finalize_reversal"].includes(operation)
    )
      after(() => processPendingEmailOutbox());
  }
  const parsed = preparationWorkspaceSchema.safeParse(data);
  if (!parsed.success)
    return {
      ok: false,
      error:
        "Dữ liệu phiên bản mới không khớp hợp đồng. Thao tác đã ghi nhận; hãy tải lại trước khi tiếp tục.",
    };
  return { ok: true, data: parsed.data };
}
