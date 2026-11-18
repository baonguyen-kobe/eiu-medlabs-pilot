"use server";

import { revalidatePath } from "next/cache";
import { requireInventoryAdmin } from "@/lib/inventory/auth";
import { createClient } from "@/lib/supabase/server";

export type MapResult = { ok: boolean; message: string };

const messages: Record<string, string> = {
  BASIC_MEDICAL_ITEM_ALREADY_MAPPED: "Thiết bị này đã được ghép.",
  BASIC_MEDICAL_MAPPING_ADMIN_ONLY: "Chỉ Admin được ghép danh mục.",
  REASON_REQUIRED: "Cần ghi lý do ghép.",
};

export async function mapBasicMedicalItem(
  _previous: MapResult | null,
  form: FormData,
): Promise<MapResult> {
  await requireInventoryAdmin();
  const factor = String(form.get("factor") ?? "").trim();
  const inventoryItemId = String(form.get("inventory_item_id") ?? "");
  if (!inventoryItemId) {
    return { ok: false, message: "Chọn mã hàng trong kho." };
  }
  if (!/^\d+(\.\d{1,6})?$/.test(factor) || Number(factor) <= 0) {
    return { ok: false, message: "Hệ số quy đổi phải là số dương." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("map_basic_medical_inventory_item", {
    p_basic_medical_catalog_item_id: String(form.get("bm_item_id") ?? ""),
    p_inventory_item_id: inventoryItemId,
    p_base_units_per_unit: factor,
    p_reason: String(form.get("reason") ?? ""),
  });
  if (error) {
    const code = Object.keys(messages).find((key) =>
      error.message.includes(key),
    );
    return { ok: false, message: code ? messages[code] : error.message };
  }
  revalidatePath("/inventory/basic-medical-mapping");
  return { ok: true, message: "Đã ghép." };
}

/** Step B: move every ready room row into the shared ledger (audited). */
export async function cutoverBasicMedical(
  _previous: MapResult | null,
  form: FormData,
): Promise<MapResult> {
  await requireInventoryAdmin();
  if (form.get("confirm") !== "on") {
    return { ok: false, message: "Xác nhận đã kiểm số trước khi chuyển." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("basic_medical_cutover_apply", {
    p_reason: String(form.get("reason") ?? ""),
  });
  if (error) {
    const code = Object.keys(messages).find((key) =>
      error.message.includes(key),
    );
    return { ok: false, message: code ? messages[code] : error.message };
  }
  revalidatePath("/inventory/basic-medical-mapping");
  revalidatePath("/inventory/rooms");
  const moved = (data as { moved: number }).moved;
  return {
    ok: true,
    message: moved
      ? `Đã chuyển ${moved} dòng sang kho chung.`
      : "Không còn dòng nào để chuyển.",
  };
}
