"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";

/** t4e step 2: an Admin ticks which sides use one equipment item. */
export async function setEquipmentItemScopes(form: FormData) {
  const { supabase } = await requireAdmin();
  const back = String(form.get("back") ?? "");
  const target = back.startsWith("/admin/equipment-scopes")
    ? back
    : "/admin/equipment-scopes";
  const join = target.includes("?") ? "&" : "?";
  const { error } = await supabase.rpc("set_equipment_item_scopes", {
    p_item_id: String(form.get("id") ?? ""),
    p_scopes: form.getAll("scope").map(String),
  });
  if (error) {
    const message =
      error.hint ||
      (error.code === "23505"
        ? "Bên này đã có thiết bị cùng tên thương mại."
        : error.message.includes("EQUIPMENT_SCOPE_INVALID")
          ? "Chọn ít nhất một phạm vi."
          : error.message);
    redirect(`${target}${join}error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/admin/equipment-scopes");
  redirect(`${target}${join}notice=${encodeURIComponent("Đã lưu phạm vi.")}`);
}
