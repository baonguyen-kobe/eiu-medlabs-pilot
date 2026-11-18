"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type BasicMedicalCatalogInput = {
  id?: string;
  item_name: string;
  commercial_name: string;
  item_type: string | null;
  country_of_origin: string | null;
  manufacturer: string | null;
  model: string | null;
  unit: string;
};

export type BasicMedicalEquipmentActionResult = {
  ok: boolean;
  message: string;
};

export type BasicMedicalCatalogReconciliationPreview = {
  updated: number;
  reactivated: number;
  inserted: number;
  deactivated: number;
  deleted: number;
  fingerprint: string;
};

export type BasicMedicalCatalogReconciliationPreviewResult =
  | { ok: true; preview: BasicMedicalCatalogReconciliationPreview }
  | { ok: false; reason: "permission" | "invalid" | "unavailable" };

type BasicMedicalCatalogReconciliationPreviewFailureReason =
  "permission" | "invalid" | "unavailable";

function previewFailureReason(error: {
  code?: string | null;
}): BasicMedicalCatalogReconciliationPreviewFailureReason {
  if (error.code === "42501") return "permission";
  if (["22023", "23503", "23505"].includes(error.code ?? "")) return "invalid";
  return "unavailable";
}

export async function previewBasicMedicalCatalogReconciliation(
  rows: BasicMedicalCatalogInput[],
): Promise<BasicMedicalCatalogReconciliationPreviewResult> {
  const supabase = await requireManager();
  const { data, error } = await supabase.rpc("preview_catalog_reconciliation", {
    target_domain: "basic_medical",
    target_rows: rows,
  });
  if (error) {
    console.error("catalog_reconciliation_preview_failed", {
      operation: "preview_catalog_reconciliation",
      domain: "basic_medical",
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      },
    });
    return { ok: false, reason: previewFailureReason(error) };
  }
  return {
    ok: true,
    preview: data as BasicMedicalCatalogReconciliationPreview,
  };
}

export async function applyBasicMedicalCatalogReconciliation(
  rows: BasicMedicalCatalogInput[],
  fingerprint: string,
): Promise<BasicMedicalEquipmentActionResult> {
  const supabase = await requireManager();
  const { error } = await supabase.rpc("apply_catalog_reconciliation", {
    target_domain: "basic_medical",
    target_rows: rows,
    target_fingerprint: fingerprint,
  });
  if (error?.message.includes("CATALOG_RECONCILIATION_STALE_PREVIEW"))
    return {
      ok: false,
      message: "Dữ liệu đã thay đổi; vui lòng xem lại preview.",
    };
  if (error)
    return {
      ok: false,
      message:
        error.code === "42501"
          ? "Bạn không có quyền đối soát danh mục."
          : error.code === "22023" ||
              error.code === "23503" ||
              error.code === "23505"
            ? "Dữ liệu danh mục không hợp lệ hoặc còn đang được tham chiếu."
            : "Không thể đối soát danh mục.",
    };
  revalidatePath("/basic-medical/equipment");
  return {
    ok: true,
    message: "Đã đối soát danh mục thiết bị Y cơ sở theo file.",
  };
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "");
}

async function requireManager() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: authority, error } = await supabase.rpc(
    "get_basic_medical_authority_context",
  );
  if (
    error ||
    !(authority as { can_manage_basic_medical?: boolean } | null)
      ?.can_manage_basic_medical
  )
    redirect("/dashboard");
  return supabase;
}

function parseCatalogRow(
  raw: Record<string, unknown>,
): BasicMedicalCatalogInput | null {
  const normalized = new Map(
    Object.entries(raw).map(([key, value]) => [normalizeKey(key), value]),
  );
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = cleanText(normalized.get(key));
      if (value) return value;
    }
    return null;
  };
  if (Object.values(raw).every((value) => !cleanText(value))) return null;
  const itemName = pick("tenthietbivavattu", "tenthietbi");
  const commercialName = pick("tenthuongmai", "commercialname");
  const unit = pick("dvt", "donvitinh");
  if (!itemName || !commercialName || !unit)
    throw new Error("Vui lòng nhập Tên thiết bị, Tên thương mại và ĐVT.");
  return {
    item_name: itemName,
    commercial_name: commercialName,
    item_type: pick("loai"),
    country_of_origin: pick("nuocsx", "nuocsanxuat"),
    manufacturer: pick("hang", "hangsanxuat"),
    model: pick("model"),
    unit,
  };
}

export async function createBasicMedicalCatalogItem(formData: FormData) {
  const supabase = await requireManager();
  const itemName = cleanText(formData.get("item_name"));
  const commercialName = cleanText(formData.get("commercial_name"));
  const unit = cleanText(formData.get("unit"));
  if (!itemName || !commercialName || !unit)
    redirect(
      "/basic-medical/equipment?error=" +
        encodeURIComponent(
          "Vui lòng nhập Tên thiết bị, Tên thương mại và ĐVT.",
        ),
    );
  const { error } = await supabase
    .from("basic_medical_equipment_catalog")
    .insert({
      item_name: itemName,
      commercial_name: commercialName,
      item_type: cleanText(formData.get("item_type")),
      country_of_origin: cleanText(formData.get("country_of_origin")),
      manufacturer: cleanText(formData.get("manufacturer")),
      model: cleanText(formData.get("model")),
      unit,
    });
  revalidatePath("/basic-medical/equipment");
  redirect(
    `/basic-medical/equipment?${error ? `error=${encodeURIComponent(error.code === "23505" ? "Tên thương mại đã tồn tại." : "Không thể thêm thiết bị.")}` : "notice=" + encodeURIComponent("Đã thêm thiết bị Y cơ sở.")}`,
  );
}

export async function updateBasicMedicalCatalogItems(
  rows: BasicMedicalCatalogInput[],
): Promise<BasicMedicalEquipmentActionResult> {
  const supabase = await requireManager();
  const payload = rows.map((row) => ({
    id: String(row.id ?? ""),
    item_name: cleanText(row.item_name),
    commercial_name: cleanText(row.commercial_name),
    item_type: cleanText(row.item_type),
    country_of_origin: cleanText(row.country_of_origin),
    manufacturer: cleanText(row.manufacturer),
    model: cleanText(row.model),
    unit: cleanText(row.unit),
  }));
  if (
    !payload.length ||
    payload.length > 1000 ||
    payload.some(
      (row) =>
        !uuidPattern.test(row.id) ||
        !row.item_name ||
        !row.commercial_name ||
        !row.unit,
    )
  ) {
    return { ok: false, message: "Danh sách chỉnh sửa không hợp lệ." };
  }
  const { error } = await supabase
    .from("basic_medical_equipment_catalog")
    .upsert(payload, { onConflict: "id" });
  if (error)
    return {
      ok: false,
      message:
        error.code === "23505"
          ? "Tên thương mại đã tồn tại."
          : "Không thể lưu chỉnh sửa.",
    };
  revalidatePath("/basic-medical/equipment");
  return { ok: true, message: `Đã lưu ${payload.length} thiết bị.` };
}

export async function setBasicMedicalCatalogActive(
  ids: string[],
  active: boolean,
): Promise<BasicMedicalEquipmentActionResult> {
  const supabase = await requireManager();
  const validIds = [...new Set(ids)].filter((id) => uuidPattern.test(id));
  if (!validIds.length)
    return { ok: false, message: "Vui lòng chọn thiết bị." };
  const { error } = await supabase
    .from("basic_medical_equipment_catalog")
    .update({ is_active: active })
    .in("id", validIds);
  if (error)
    return { ok: false, message: "Không thể cập nhật trạng thái thiết bị." };
  revalidatePath("/basic-medical/equipment");
  return {
    ok: true,
    message: active ? "Đã kích hoạt thiết bị." : "Đã ngừng sử dụng thiết bị.",
  };
}

export async function deleteBasicMedicalCatalogItems(
  ids: string[],
): Promise<BasicMedicalEquipmentActionResult> {
  const supabase = await requireManager();
  const validIds = [...new Set(ids)].filter((id) => uuidPattern.test(id));
  if (!validIds.length)
    return { ok: false, message: "Vui lòng chọn thiết bị cần xóa." };
  const { error } = await supabase
    .from("basic_medical_equipment_catalog")
    .delete()
    .in("id", validIds);
  if (error)
    return {
      ok: false,
      message:
        error.code === "23503"
          ? "Thiết bị đã được phân bổ vào phòng; hãy ngừng sử dụng thay vì xóa."
          : "Không thể xóa thiết bị.",
    };
  revalidatePath("/basic-medical/equipment");
  return { ok: true, message: `Đã xóa ${validIds.length} thiết bị.` };
}

export async function saveBasicMedicalRoomInventory(input: {
  inventoryId?: string;
  roomId: string;
  catalogItemId: string;
  totalQuantity: number;
  damagedQuantity: number;
  note?: string;
}): Promise<BasicMedicalEquipmentActionResult> {
  const supabase = await requireManager();
  if (!input.note?.trim())
    return { ok: false, message: "Vui lòng nhập ghi chú điều chỉnh." };
  const { error } = await supabase.rpc("set_basic_medical_room_inventory", {
    target_inventory_id: input.inventoryId ?? null,
    target_room_id: input.roomId,
    target_catalog_item_id: input.catalogItemId,
    target_total_quantity: input.totalQuantity,
    target_damaged_quantity: input.damagedQuantity,
    target_is_active: true,
    target_note: input.note.trim(),
  });
  // A row moved into Kho (t4r3) explains itself through its hint.
  if (error) return { ok: false, message: error.hint || error.message };
  revalidatePath("/basic-medical/equipment");
  revalidatePath("/basic-medical/registrations");
  return { ok: true, message: "Đã cập nhật thiết bị trong phòng." };
}

export async function searchBasicMedicalCatalogCandidates(query: string) {
  const supabase = await requireManager();
  const { data, error } = await supabase.rpc(
    "search_basic_medical_catalog_candidates",
    {
      target_query: query.trim() || null,
      target_limit: 30,
    },
  );
  if (error) return [] as BasicMedicalCatalogInput[];
  return (data ?? []) as BasicMedicalCatalogInput[];
}

export async function adjustBasicMedicalInventoryCondition(input: {
  inventoryId: string;
  goodQuantity: number;
  damagedQuantity: number;
  note: string;
}): Promise<BasicMedicalEquipmentActionResult> {
  const supabase = await requireManager();
  if (!input.note.trim())
    return { ok: false, message: "Vui lòng nhập ghi chú điều chỉnh." };
  const { error } = await supabase.rpc(
    "adjust_basic_medical_inventory_condition",
    {
      target_inventory_id: input.inventoryId,
      target_good_quantity: input.goodQuantity,
      target_damaged_quantity: input.damagedQuantity,
      target_note: input.note.trim(),
    },
  );
  if (error) return { ok: false, message: error.hint || error.message };
  revalidatePath("/basic-medical/equipment");
  revalidatePath("/basic-medical/registrations");
  return { ok: true, message: "Đã điều chỉnh số lượng Tốt/Hư." };
}

export async function importBasicMedicalEquipment(formData: FormData) {
  const supabase = await requireManager();
  const file = formData.get("file");
  const mode = String(formData.get("mode") ?? "new");
  if (
    !(file instanceof File) ||
    !file.size ||
    !/\.(csv|xlsx)$/i.test(file.name)
  )
    redirect(
      "/basic-medical/equipment?error=" +
        encodeURIComponent("Vui lòng chọn file CSV hoặc XLSX."),
    );
  if (mode !== "new") {
    redirect(
      "/basic-medical/equipment?error=" +
        encodeURIComponent("Import tất cả phải dùng Preview đối soát."),
    );
  }
  try {
    const XLSX = await import("@e965/xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = /\.csv$/i.test(file.name)
      ? XLSX.read(new TextDecoder("utf-8").decode(buffer), { type: "string" })
      : XLSX.read(buffer, { type: "array" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[workbook.SheetNames[0]],
      { defval: "", raw: false },
    );
    if (!rows.length || rows.length > 5000)
      throw new Error("File phải có từ 1 đến 5.000 dòng.");
    const parsed = rows
      .map(parseCatalogRow)
      .filter((row): row is BasicMedicalCatalogInput => Boolean(row));
    const { data: importResult, error: importError } = await supabase.rpc(
      "apply_basic_medical_catalog_import",
      { target_mode: mode, target_rows: parsed },
    );
    if (importError) throw importError;
    const counts = importResult as {
      inserted?: number;
      updated?: number;
      inactivated?: number;
    } | null;
    const processed =
      Number(counts?.inserted ?? 0) + Number(counts?.updated ?? 0);
    revalidatePath("/basic-medical/equipment");
    redirect(
      `/basic-medical/equipment?notice=${encodeURIComponent(`Đã import ${processed} thiết bị; ngừng sử dụng ${Number(counts?.inactivated ?? 0)} thiết bị vắng trong file.`)}`,
    );
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(
      `/basic-medical/equipment?error=${encodeURIComponent(error instanceof Error ? error.message : "Không thể đọc file import.")}`,
    );
  }
}
