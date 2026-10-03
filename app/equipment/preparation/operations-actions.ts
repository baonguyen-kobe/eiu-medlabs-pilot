"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  preparationError,
  type PreparationResult,
} from "@/lib/equipment-preparation";
import {
  preparationQueueFiltersSchema,
  preparationQueueSchema,
  preparationSettingsCommandSchema,
  preparationSettingsSchema,
  type PreparationQueue,
  type PreparationQueueFilters,
  type PreparationSettings,
  type PreparationSettingsCommand,
} from "@/lib/equipment-preparation-operations";

export async function readPreparationQueue(
  filters: PreparationQueueFilters,
): Promise<PreparationResult<PreparationQueue>> {
  const parsed = preparationQueueFiltersSchema.safeParse(filters);
  if (!parsed.success) return { ok: false, error: "Bộ lọc không hợp lệ." };
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub)
    return { ok: false, error: "Phiên đăng nhập đã hết hạn." };
  const { data, error } = await db.rpc(
    "equipment_preparation_operations_read",
    { p_resource: "queue", p_filters: parsed.data },
  );
  if (error) return { ok: false, error: preparationError(error.message) };
  const result = preparationQueueSchema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, error: "Dữ liệu hàng đợi không khớp hợp đồng." };
}

export async function savePreparationSettings(
  command: PreparationSettingsCommand,
): Promise<PreparationResult<PreparationSettings>> {
  const parsed = preparationSettingsCommandSchema.safeParse(command);
  if (!parsed.success)
    return {
      ok: false,
      error: "Nhập thời gian hợp lệ và lý do thay đổi (tối đa 1.000 ký tự).",
    };
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  if (!claims?.claims?.sub)
    return { ok: false, error: "Phiên đăng nhập đã hết hạn." };
  const { data, error } = await db.rpc(
    "equipment_preparation_settings_command",
    {
      p_expected_revision: parsed.data.revision,
      p_warning_lead_minutes: parsed.data.warning_lead_minutes,
      p_inactivity_minutes: parsed.data.inactivity_minutes,
      p_reason: parsed.data.reason,
    },
  );
  if (error) return { ok: false, error: preparationError(error.message) };
  const result = preparationSettingsSchema.safeParse(data);
  if (!result.success)
    return {
      ok: false,
      error:
        "Đã ghi nhận thao tác nhưng không đọc được cấu hình mới. Hãy tải lại trước khi tiếp tục.",
    };
  revalidatePath("/equipment/preparation");
  return { ok: true, data: result.data };
}
