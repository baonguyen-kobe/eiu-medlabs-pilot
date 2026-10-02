"use server";

import { revalidatePath } from "next/cache";
import {
  requireInventoryAdmin,
  requireInventoryViewer,
} from "@/lib/inventory/auth";
import { inventoryCommand } from "@/lib/inventory/client";
import {
  multiplyExact,
  validateDecimalString,
  validateSplit,
} from "@/lib/inventory/decimal";
import { normalizeExpiryInput } from "@/lib/inventory/dates";
import type {
  ConfirmOpeningBalancePayload,
  CorrectOpeningBalancePayload,
  CorrectReceiptPayload,
  InventoryCommandResult,
  MaterialKind,
  ReceiveStockPayload,
  ReturnSemantics,
  ReverseReceiptPayload,
  TrackingStrategy,
  UomDimension,
  VerifyOpeningExpiryPayload,
} from "@/lib/inventory/types";

export interface ActionResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

// ==========================================
// 1. Inventory Catalog Items
// ==========================================

export async function createItemAction(input: {
  code: string;
  name: string;
  category_id: string;
  base_uom_code: string;
  material_kind: MaterialKind;
  tracking_strategy: TrackingStrategy;
  return_semantics: ReturnSemantics;
  expiry_required: boolean;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();

    if (!code || !name) {
      return {
        ok: false,
        error: "Mã và Tên vật tư là bắt buộc / SKU Code and Name are required",
      };
    }
    if (!input.category_id) {
      return {
        ok: false,
        error: "Vui lòng chọn nhóm vật tư / Category is required",
      };
    }
    if (!input.base_uom_code) {
      return {
        ok: false,
        error: "Vui lòng chọn đơn vị cơ sở / Base UOM is required",
      };
    }

    // Invariant: chemical requires expiry_required=true
    const expiryRequired =
      input.material_kind === "chemical"
        ? true
        : Boolean(input.expiry_required);

    const result = await inventoryCommand("create_inventory_item", {
      code,
      name,
      category_id: input.category_id,
      base_uom_code: input.base_uom_code,
      material_kind: input.material_kind,
      tracking_strategy: input.tracking_strategy,
      return_semantics: input.return_semantics,
      expiry_required: expiryRequired,
    });

    revalidatePath("/inventory/catalog");
    revalidatePath("/inventory");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lỗi tạo vật tư";
    return { ok: false, error: message };
  }
}

export async function updateItemAction(input: {
  id: string;
  expected_revision: string | number;
  name: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    const name = input.name.trim();
    if (!name) {
      return {
        ok: false,
        error: "Tên vật tư không được để trống / Name is required",
      };
    }

    const result = await inventoryCommand("update_inventory_item", {
      id: input.id,
      expected_revision: input.expected_revision,
      name,
    });

    revalidatePath("/inventory/catalog");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lỗi cập nhật vật tư";
    return { ok: false, error: message };
  }
}

export async function inactivateItemAction(input: {
  id: string;
  expected_revision: string | number;
  reason: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    const reason = input.reason.trim();
    if (!reason) {
      return {
        ok: false,
        error: "Vui lòng nhập lý do ngừng hoạt động / Reason is required",
      };
    }

    const result = await inventoryCommand("inactivate_inventory_item", {
      id: input.id,
      expected_revision: input.expected_revision,
      reason,
    });

    revalidatePath("/inventory/catalog");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi ngừng hoạt động vật tư";
    return { ok: false, error: message };
  }
}

export async function reactivateItemAction(input: {
  id: string;
  expected_revision: string | number;
  reason: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    const reason = input.reason.trim();
    if (!reason) {
      return {
        ok: false,
        error: "Vui lòng nhập lý do kích hoạt lại / Reason is required",
      };
    }

    const result = await inventoryCommand("reactivate_inventory_item", {
      id: input.id,
      expected_revision: input.expected_revision,
      reason,
    });

    revalidatePath("/inventory/catalog");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi kích hoạt lại vật tư";
    return { ok: false, error: message };
  }
}

// ==========================================
// 2. Categories
// ==========================================

export async function createCategoryAction(input: {
  code: string;
  name: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    if (!code || !name) {
      return {
        ok: false,
        error: "Mã và tên nhóm vật tư là bắt buộc / Code and name are required",
      };
    }

    const result = await inventoryCommand("create_inventory_category", {
      code,
      name,
    });
    revalidatePath("/inventory/catalog");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lỗi tạo nhóm vật tư";
    return { ok: false, error: message };
  }
}

export async function updateCategoryAction(input: {
  id: string;
  expected_revision: string | number;
  name: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    const name = input.name.trim();
    if (!name) {
      return {
        ok: false,
        error: "Tên nhóm không được để trống / Name is required",
      };
    }

    const result = await inventoryCommand("update_inventory_category", {
      id: input.id,
      expected_revision: input.expected_revision,
      name,
    });
    revalidatePath("/inventory/catalog");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lỗi cập nhật nhóm";
    return { ok: false, error: message };
  }
}

export async function inactivateCategoryAction(input: {
  id: string;
  expected_revision: string | number;
  reason: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    const reason = input.reason.trim();
    if (!reason) {
      return { ok: false, error: "Vui lòng nhập lý do / Reason is required" };
    }

    const result = await inventoryCommand("inactivate_inventory_category", {
      id: input.id,
      expected_revision: input.expected_revision,
      reason,
    });
    revalidatePath("/inventory/catalog");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi ngừng hoạt động nhóm";
    return { ok: false, error: message };
  }
}

export async function reactivateCategoryAction(input: {
  id: string;
  expected_revision: string | number;
  reason: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    const reason = input.reason.trim();
    if (!reason) {
      return { ok: false, error: "Vui lòng nhập lý do / Reason is required" };
    }

    const result = await inventoryCommand("reactivate_inventory_category", {
      id: input.id,
      expected_revision: input.expected_revision,
      reason,
    });
    revalidatePath("/inventory/catalog");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi kích hoạt lại nhóm";
    return { ok: false, error: message };
  }
}

// ==========================================
// 3. Units of Measure (UOM) - Admin Only
// ==========================================

export async function createUomAction(input: {
  code: string;
  name: string;
  dimension: UomDimension;
  allowed_scale: number;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    const code = input.code.trim().toLowerCase();
    const name = input.name.trim();

    if (!code || !name) {
      return {
        ok: false,
        error: "Mã và tên ĐVT là bắt buộc / Code and Name are required",
      };
    }

    const scale = Math.max(0, Math.min(6, Math.floor(input.allowed_scale)));
    // Discrete dimension forces scale 0
    const finalScale =
      input.dimension === "count" || input.dimension === "package" ? 0 : scale;

    const result = await inventoryCommand("create_inventory_uom", {
      code,
      name,
      dimension: input.dimension,
      allowed_scale: finalScale,
    });

    revalidatePath("/inventory/catalog");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lỗi tạo ĐVT";
    return { ok: false, error: message };
  }
}

export async function updateUomAction(input: {
  code: string;
  expected_revision: string | number;
  name: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    const name = input.name.trim();
    if (!name) {
      return {
        ok: false,
        error: "Tên ĐVT không được để trống / Name is required",
      };
    }

    const result = await inventoryCommand("update_inventory_uom", {
      code: input.code,
      expected_revision: input.expected_revision,
      name,
    });

    revalidatePath("/inventory/catalog");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lỗi cập nhật ĐVT";
    return { ok: false, error: message };
  }
}

export async function inactivateUomAction(input: {
  code: string;
  expected_revision: string | number;
  reason: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    const reason = input.reason.trim();
    if (!reason) {
      return { ok: false, error: "Vui lòng nhập lý do / Reason is required" };
    }

    const result = await inventoryCommand("inactivate_inventory_uom", {
      code: input.code,
      expected_revision: input.expected_revision,
      reason,
    });

    revalidatePath("/inventory/catalog");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi ngừng hoạt động ĐVT";
    return { ok: false, error: message };
  }
}

export async function reactivateUomAction(input: {
  code: string;
  expected_revision: string | number;
  reason: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    const reason = input.reason.trim();
    if (!reason) {
      return { ok: false, error: "Vui lòng nhập lý do / Reason is required" };
    }

    const result = await inventoryCommand("reactivate_inventory_uom", {
      code: input.code,
      expected_revision: input.expected_revision,
      reason,
    });

    revalidatePath("/inventory/catalog");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi kích hoạt lại ĐVT";
    return { ok: false, error: message };
  }
}

// ==========================================
// 4. Suppliers
// ==========================================

export async function createSupplierAction(input: {
  name: string;
  tax_code?: string;
  contact?: string;
  notes?: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    const name = input.name.trim();
    if (!name) {
      return {
        ok: false,
        error: "Tên nhà cung cấp là bắt buộc / Supplier name is required",
      };
    }

    const result = await inventoryCommand("create_inventory_supplier", {
      name,
      tax_code: input.tax_code?.trim() || null,
      contact: input.contact?.trim() || null,
      notes: input.notes?.trim() || null,
    });

    revalidatePath("/inventory/suppliers");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lỗi tạo nhà cung cấp";
    return { ok: false, error: message };
  }
}

export async function updateSupplierAction(input: {
  id: string;
  expected_revision: string | number;
  name: string;
  tax_code?: string;
  contact?: string;
  notes?: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    const name = input.name.trim();
    if (!name) {
      return {
        ok: false,
        error:
          "Tên nhà cung cấp không được để trống / Supplier name is required",
      };
    }

    const result = await inventoryCommand("update_inventory_supplier", {
      id: input.id,
      expected_revision: input.expected_revision,
      name,
      tax_code: input.tax_code?.trim() || null,
      contact: input.contact?.trim() || null,
      notes: input.notes?.trim() || null,
    });

    revalidatePath("/inventory/suppliers");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi cập nhật nhà cung cấp";
    return { ok: false, error: message };
  }
}

export async function inactivateSupplierAction(input: {
  id: string;
  expected_revision: string | number;
  reason: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    const reason = input.reason.trim();
    if (!reason) {
      return { ok: false, error: "Vui lòng nhập lý do / Reason is required" };
    }

    const result = await inventoryCommand("inactivate_inventory_supplier", {
      id: input.id,
      expected_revision: input.expected_revision,
      reason,
    });

    revalidatePath("/inventory/suppliers");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi ngừng hoạt động nhà cung cấp";
    return { ok: false, error: message };
  }
}

export async function reactivateSupplierAction(input: {
  id: string;
  expected_revision: string | number;
  reason: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    const reason = input.reason.trim();
    if (!reason) {
      return { ok: false, error: "Vui lòng nhập lý do / Reason is required" };
    }

    const result = await inventoryCommand("reactivate_inventory_supplier", {
      id: input.id,
      expected_revision: input.expected_revision,
      reason,
    });

    revalidatePath("/inventory/suppliers");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi kích hoạt lại nhà cung cấp";
    return { ok: false, error: message };
  }
}

// ==========================================
// 5. Storage Locations
// ==========================================

export async function createLocationAction(input: {
  code: string;
  name: string;
  parent_location_id?: string;
  room_id?: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();

    if (!code || !name) {
      return {
        ok: false,
        error: "Mã và tên vị trí kho là bắt buộc / Code and Name are required",
      };
    }

    const result = await inventoryCommand("create_inventory_location", {
      code,
      name,
      parent_location_id: input.parent_location_id || null,
      room_id: input.room_id || null,
    });

    revalidatePath("/inventory/locations");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lỗi tạo vị trí kho";
    return { ok: false, error: message };
  }
}

export async function updateLocationAction(input: {
  id: string;
  expected_revision: string | number;
  name: string;
  parent_location_id?: string;
  room_id?: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    const name = input.name.trim();
    if (!name) {
      return {
        ok: false,
        error: "Tên vị trí kho không được để trống / Name is required",
      };
    }

    // Acyclic check: cannot be parent of self
    if (input.parent_location_id && input.parent_location_id === input.id) {
      return {
        ok: false,
        error:
          "Vị trí không thể tự làm vị trí cha của chính nó / Cyclic parent location",
      };
    }

    const result = await inventoryCommand("update_inventory_location", {
      id: input.id,
      expected_revision: input.expected_revision,
      name,
      parent_location_id: input.parent_location_id || null,
      room_id: input.room_id || null,
    });

    revalidatePath("/inventory/locations");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi cập nhật vị trí kho";
    return { ok: false, error: message };
  }
}

export async function inactivateLocationAction(input: {
  id: string;
  expected_revision: string | number;
  reason: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    const reason = input.reason.trim();
    if (!reason) {
      return { ok: false, error: "Vui lòng nhập lý do / Reason is required" };
    }

    const result = await inventoryCommand("inactivate_inventory_location", {
      id: input.id,
      expected_revision: input.expected_revision,
      reason,
    });

    revalidatePath("/inventory/locations");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi ngừng hoạt động vị trí";
    return { ok: false, error: message };
  }
}

export async function reactivateLocationAction(input: {
  id: string;
  expected_revision: string | number;
  reason: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    const reason = input.reason.trim();
    if (!reason) {
      return { ok: false, error: "Vui lòng nhập lý do / Reason is required" };
    }

    const result = await inventoryCommand("reactivate_inventory_location", {
      id: input.id,
      expected_revision: input.expected_revision,
      reason,
    });

    revalidatePath("/inventory/locations");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi kích hoạt lại vị trí";
    return { ok: false, error: message };
  }
}

// ==========================================
// 6. Acquisition Records (Sources) & Lines
// ==========================================

export async function createSourceAction(input: {
  source_reference: string;
  supplier_id: string;
  reference_date: string;
  funding_source?: string;
  external_reference?: string;
  notes?: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    const sourceRef = input.source_reference.trim().toUpperCase();
    if (!sourceRef) {
      return {
        ok: false,
        error: "Mã hồ sơ nguồn là bắt buộc / Source reference is required",
      };
    }
    if (!input.supplier_id) {
      return {
        ok: false,
        error: "Vui lòng chọn nhà cung cấp / Supplier is required",
      };
    }
    if (!input.reference_date) {
      return {
        ok: false,
        error: "Vui lòng nhập ngày hồ sơ / Reference date is required",
      };
    }

    const result = await inventoryCommand("create_acquisition_source", {
      source_reference: sourceRef,
      supplier_id: input.supplier_id,
      reference_date: input.reference_date,
      funding_source: input.funding_source?.trim() || null,
      external_reference: input.external_reference?.trim() || null,
      notes: input.notes?.trim() || null,
    });

    revalidatePath("/inventory/acquisitions");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lỗi tạo hồ sơ nguồn";
    return { ok: false, error: message };
  }
}

export async function updateSourceAction(input: {
  id: string;
  expected_revision: string | number;
  source_reference: string;
  supplier_id: string;
  reference_date: string;
  funding_source?: string;
  external_reference?: string;
  notes?: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    const sourceRef = input.source_reference.trim().toUpperCase();
    if (!sourceRef) {
      return {
        ok: false,
        error: "Mã hồ sơ nguồn là bắt buộc / Source reference is required",
      };
    }

    const result = await inventoryCommand("update_acquisition_source", {
      id: input.id,
      expected_revision: input.expected_revision,
      source_reference: sourceRef,
      supplier_id: input.supplier_id,
      reference_date: input.reference_date,
      funding_source: input.funding_source?.trim() || null,
      external_reference: input.external_reference?.trim() || null,
      notes: input.notes?.trim() || null,
    });

    revalidatePath("/inventory/acquisitions");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi cập nhật hồ sơ nguồn";
    return { ok: false, error: message };
  }
}

export async function voidSourceAction(input: {
  id: string;
  expected_revision: string | number;
  reason: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    const reason = input.reason.trim();
    if (!reason) {
      return {
        ok: false,
        error: "Vui lòng nhập lý do hủy hồ sơ / Reason is required",
      };
    }

    const result = await inventoryCommand("update_acquisition_source", {
      id: input.id,
      expected_revision: input.expected_revision,
      status: "voided",
      reason,
    });

    revalidatePath("/inventory/acquisitions");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lỗi hủy hồ sơ nguồn";
    return { ok: false, error: message };
  }
}

export async function createSourceLineAction(input: {
  acquisition_record_id: string;
  expected_revision: string | number;
  line_key: string;
  catalog_item_id: string;
  expected_purchase_quantity: string;
  purchase_uom_code: string;
  expected_conversion_factor?: string;
  unit_cost?: string;
  currency_code?: string;
  manufacturer?: string;
  model?: string;
  country_of_origin?: string;
  warranty_start?: string;
  warranty_end?: string;
  notes?: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    const qtyVal = validateDecimalString(input.expected_purchase_quantity);
    if (!qtyVal.valid || !qtyVal.normalized) {
      return {
        ok: false,
        error: `Số lượng dự kiến không hợp lệ: ${qtyVal.error}`,
      };
    }

    let factorVal: string | null = null;
    if (input.expected_conversion_factor?.trim()) {
      const fCheck = validateDecimalString(input.expected_conversion_factor);
      if (!fCheck.valid || !fCheck.normalized) {
        return {
          ok: false,
          error: `Hệ số quy đổi dự kiến không hợp lệ: ${fCheck.error}`,
        };
      }
      factorVal = fCheck.normalized;
    }

    let unitCostVal: string | null = null;
    if (input.unit_cost?.trim()) {
      const cCheck = validateDecimalString(input.unit_cost, 4);
      if (!cCheck.valid || !cCheck.normalized) {
        return { ok: false, error: `Đơn giá không hợp lệ: ${cCheck.error}` };
      }
      unitCostVal = cCheck.normalized;
    }

    const result = await inventoryCommand("create_acquisition_source_line", {
      acquisition_record_id: input.acquisition_record_id,
      expected_revision: input.expected_revision,
      line_key: input.line_key.trim(),
      catalog_item_id: input.catalog_item_id,
      expected_purchase_quantity: qtyVal.normalized,
      purchase_uom_code: input.purchase_uom_code,
      expected_conversion_factor: factorVal,
      unit_cost: unitCostVal,
      currency_code:
        input.currency_code?.trim() || (unitCostVal ? "VND" : null),
      manufacturer: input.manufacturer?.trim() || null,
      model: input.model?.trim() || null,
      country_of_origin: input.country_of_origin?.trim() || null,
      warranty_start: input.warranty_start || null,
      warranty_end: input.warranty_end || null,
      notes: input.notes?.trim() || null,
    });

    revalidatePath("/inventory/acquisitions");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi tạo dòng hồ sơ nguồn";
    return { ok: false, error: message };
  }
}

export async function updateSourceLineAction(input: {
  id: string;
  acquisition_record_id: string;
  expected_revision: string | number;
  expected_purchase_quantity: string;
  purchase_uom_code: string;
  expected_conversion_factor?: string;
  unit_cost?: string;
  currency_code?: string;
  manufacturer?: string;
  model?: string;
  country_of_origin?: string;
  warranty_start?: string;
  warranty_end?: string;
  notes?: string;
}): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    const qtyVal = validateDecimalString(input.expected_purchase_quantity);
    if (!qtyVal.valid || !qtyVal.normalized) {
      return {
        ok: false,
        error: `Số lượng dự kiến không hợp lệ: ${qtyVal.error}`,
      };
    }

    let factorVal: string | null = null;
    if (input.expected_conversion_factor?.trim()) {
      const fCheck = validateDecimalString(input.expected_conversion_factor);
      if (!fCheck.valid || !fCheck.normalized) {
        return {
          ok: false,
          error: `Hệ số quy đổi dự kiến không hợp lệ: ${fCheck.error}`,
        };
      }
      factorVal = fCheck.normalized;
    }

    let unitCostVal: string | null = null;
    if (input.unit_cost?.trim()) {
      const cCheck = validateDecimalString(input.unit_cost, 4);
      if (!cCheck.valid || !cCheck.normalized) {
        return { ok: false, error: `Đơn giá không hợp lệ: ${cCheck.error}` };
      }
      unitCostVal = cCheck.normalized;
    }

    const result = await inventoryCommand("update_acquisition_source_line", {
      id: input.id,
      acquisition_record_id: input.acquisition_record_id,
      expected_revision: input.expected_revision,
      expected_purchase_quantity: qtyVal.normalized,
      purchase_uom_code: input.purchase_uom_code,
      expected_conversion_factor: factorVal,
      unit_cost: unitCostVal,
      currency_code:
        input.currency_code?.trim() || (unitCostVal ? "VND" : null),
      manufacturer: input.manufacturer?.trim() || null,
      model: input.model?.trim() || null,
      country_of_origin: input.country_of_origin?.trim() || null,
      warranty_start: input.warranty_start || null,
      warranty_end: input.warranty_end || null,
      notes: input.notes?.trim() || null,
    });

    revalidatePath("/inventory/acquisitions");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi cập nhật dòng hồ sơ";
    return { ok: false, error: message };
  }
}

// ==========================================
// 7. Receive Stock
// ==========================================

export async function receiveStockAction(
  payload: ReceiveStockPayload,
  retryKey?: string,
): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    const ref = payload.receipt_reference.trim().toUpperCase();
    if (!ref) {
      return {
        ok: false,
        error: "Mã phiếu nhận hàng là bắt buộc / Receipt reference is required",
      };
    }
    if (!payload.occurred_at) {
      return {
        ok: false,
        error: "Thời điểm nhận hàng là bắt buộc / Occurred date is required",
      };
    }
    if (!payload.lines || payload.lines.length === 0) {
      return {
        ok: false,
        error:
          "Phiếu nhận phải có ít nhất một dòng hàng / At least one line required",
      };
    }

    // Validate each line
    for (const [idx, line] of payload.lines.entries()) {
      const lineNo = idx + 1;
      if (!line.source_line_id) {
        return {
          ok: false,
          error: `Dòng ${lineNo}: Thiếu thông tin dòng hồ sơ nguồn`,
        };
      }
      if (!line.location_id) {
        return {
          ok: false,
          error: `Dòng ${lineNo}: Vui lòng chọn vị trí kho nhận`,
        };
      }

      const mult = multiplyExact(
        line.purchase_quantity,
        line.conversion_factor,
      );
      if (!mult.valid || !mult.result) {
        return { ok: false, error: `Dòng ${lineNo}: ${mult.error}` };
      }

      const split = validateSplit(
        mult.result,
        line.good_quantity,
        line.damaged_quantity,
      );
      if (!split.valid) {
        return { ok: false, error: `Dòng ${lineNo}: ${split.error}` };
      }

      // Check expiry input normalization
      const expNorm = normalizeExpiryInput(
        line.expiry_precision,
        line.expiry_input,
      );
      if (!expNorm.valid) {
        return { ok: false, error: `Dòng ${lineNo}: ${expNorm.error}` };
      }
    }

    const result = await inventoryCommand(
      "receive_stock",
      payload as unknown as Record<string, unknown>,
      retryKey,
    );

    revalidatePath("/inventory/stock");
    revalidatePath("/inventory/transactions");
    revalidatePath("/inventory/receive");
    revalidatePath("/inventory");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi thực hiện nhận kho";
    return { ok: false, error: message };
  }
}

// ==========================================
// 8. Confirm Opening Balance (Admin Only)
// ==========================================

export async function confirmOpeningBalanceAction(
  payload: ConfirmOpeningBalancePayload,
  retryKey?: string,
): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    const cutoverKey = payload.cutover_key.trim().toUpperCase();
    if (!cutoverKey) {
      return {
        ok: false,
        error: "Mã số chốt số dư là bắt buộc / Cutover key is required",
      };
    }
    if (!payload.count_cutoff) {
      return {
        ok: false,
        error: "Thời điểm chốt kiểm kê là bắt buộc / Cutoff date is required",
      };
    }
    if (!payload.scope_description.trim()) {
      return {
        ok: false,
        error: "Mô tả phạm vi là bắt buộc / Scope description is required",
      };
    }
    if (!payload.provenance_note.trim()) {
      return {
        ok: false,
        error:
          "Ghi chú chứng từ tồn đầu là bắt buộc / Provenance note is required",
      };
    }
    if (!payload.lines || payload.lines.length === 0) {
      return {
        ok: false,
        error:
          "Danh sách tồn đầu phải có ít nhất một dòng / At least one line required",
      };
    }

    // Validate each line
    for (const [idx, line] of payload.lines.entries()) {
      const lineNo = idx + 1;
      if (!line.catalog_item_id) {
        return { ok: false, error: `Dòng ${lineNo}: Chưa chọn vật tư` };
      }
      if (!line.location_id) {
        return { ok: false, error: `Dòng ${lineNo}: Chưa chọn vị trí kho` };
      }
      const split = validateSplit(
        line.base_quantity,
        line.good_quantity,
        line.damaged_quantity,
      );
      if (!split.valid) {
        return { ok: false, error: `Dòng ${lineNo}: ${split.error}` };
      }
      const expNorm = normalizeExpiryInput(
        line.expiry_precision,
        line.expiry_input,
      );
      if (!expNorm.valid) {
        return { ok: false, error: `Dòng ${lineNo}: ${expNorm.error}` };
      }
    }

    const result = await inventoryCommand(
      "confirm_opening_balance",
      payload as unknown as Record<string, unknown>,
      retryKey,
    );

    revalidatePath("/inventory/stock");
    revalidatePath("/inventory/opening");
    revalidatePath("/inventory/transactions");
    revalidatePath("/inventory");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lỗi xác nhận tồn đầu";
    return { ok: false, error: message };
  }
}

// ==========================================
// 9. Corrections & Reversals
// ==========================================

export async function correctReceiptAction(
  payload: CorrectReceiptPayload,
  retryKey?: string,
): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    if (!payload.reason.trim()) {
      return {
        ok: false,
        error: "Lý do điều chỉnh là bắt buộc / Reason is required",
      };
    }
    if (!payload.lines || payload.lines.length === 0) {
      return {
        ok: false,
        error:
          "Vui lòng cung cấp ít nhất một dòng điều chỉnh / At least one line required",
      };
    }

    for (const [idx, line] of payload.lines.entries()) {
      const lineNo = idx + 1;
      if (!line.origin_id) {
        return { ok: false, error: `Dòng ${lineNo}: Thiếu origin_id` };
      }
      if (line.purchase_quantity && line.conversion_factor) {
        const mult = multiplyExact(
          line.purchase_quantity,
          line.conversion_factor,
        );
        if (!mult.valid || !mult.result) {
          return { ok: false, error: `Dòng ${lineNo}: ${mult.error}` };
        }
        const split = validateSplit(
          mult.result,
          line.good_quantity,
          line.damaged_quantity,
        );
        if (!split.valid) {
          return { ok: false, error: `Dòng ${lineNo}: ${split.error}` };
        }
      }
      const expNorm = normalizeExpiryInput(
        line.expiry_precision,
        line.expiry_input,
      );
      if (!expNorm.valid) {
        return { ok: false, error: `Dòng ${lineNo}: ${expNorm.error}` };
      }
    }

    const result = await inventoryCommand(
      "correct_receipt",
      payload as unknown as Record<string, unknown>,
      retryKey,
    );

    revalidatePath("/inventory/transactions");
    revalidatePath("/inventory/stock");
    revalidatePath("/inventory");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi điều chỉnh phiếu nhận";
    return { ok: false, error: message };
  }
}

export async function reverseReceiptAction(
  payload: ReverseReceiptPayload,
  retryKey?: string,
): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryViewer();

    if (!payload.reason.trim()) {
      return {
        ok: false,
        error: "Lý do hủy phiếu nhận là bắt buộc / Reason is required",
      };
    }
    if (!payload.versions || payload.versions.length === 0) {
      return {
        ok: false,
        error:
          "Vui lòng cung cấp danh sách nguồn gốc cần hủy / Versions list required",
      };
    }

    const result = await inventoryCommand(
      "reverse_receipt",
      payload as unknown as Record<string, unknown>,
      retryKey,
    );

    revalidatePath("/inventory/transactions");
    revalidatePath("/inventory/stock");
    revalidatePath("/inventory");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Lỗi hủy phiếu nhận";
    return { ok: false, error: message };
  }
}

export async function correctOpeningBalanceAction(
  payload: CorrectOpeningBalancePayload,
  retryKey?: string,
): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    if (!payload.reason.trim()) {
      return {
        ok: false,
        error: "Lý do điều chỉnh tồn đầu là bắt buộc / Reason is required",
      };
    }
    if (!payload.lines || payload.lines.length === 0) {
      return {
        ok: false,
        error:
          "Cần ít nhất một dòng điều chỉnh tồn đầu / At least one line required",
      };
    }

    for (const [idx, line] of payload.lines.entries()) {
      const lineNo = idx + 1;
      const split = validateSplit(
        line.base_quantity,
        line.good_quantity,
        line.damaged_quantity,
      );
      if (!split.valid) {
        return { ok: false, error: `Dòng ${lineNo}: ${split.error}` };
      }
      const expNorm = normalizeExpiryInput(
        line.expiry_precision,
        line.expiry_input,
      );
      if (!expNorm.valid) {
        return { ok: false, error: `Dòng ${lineNo}: ${expNorm.error}` };
      }
    }

    const result = await inventoryCommand(
      "correct_opening_balance",
      payload as unknown as Record<string, unknown>,
      retryKey,
    );

    revalidatePath("/inventory/transactions");
    revalidatePath("/inventory/stock");
    revalidatePath("/inventory");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi điều chỉnh tồn đầu";
    return { ok: false, error: message };
  }
}

export async function verifyOpeningExpiryAction(
  payload: VerifyOpeningExpiryPayload,
  retryKey?: string,
): Promise<ActionResult<InventoryCommandResult>> {
  try {
    await requireInventoryAdmin();

    if (!payload.origin_id) {
      return {
        ok: false,
        error: "Thiếu thông tin origin_id / Missing origin_id",
      };
    }
    if (!payload.reason.trim()) {
      return {
        ok: false,
        error: "Lý do xác minh là bắt buộc / Reason is required",
      };
    }
    if (!payload.evidence_note.trim()) {
      return {
        ok: false,
        error: "Bằng chứng xác minh là bắt buộc / Evidence note is required",
      };
    }

    if (
      payload.expiry_precision !== "day" &&
      payload.expiry_precision !== "month"
    ) {
      return {
        ok: false,
        error:
          "Xác minh bắt buộc phải chuyển sang ngày cụ thể hoặc tháng cụ thể / Day or month precision required",
      };
    }

    const expNorm = normalizeExpiryInput(
      payload.expiry_precision,
      payload.expiry_input,
    );
    if (!expNorm.valid) {
      return { ok: false, error: expNorm.error };
    }

    const result = await inventoryCommand(
      "verify_opening_expiry",
      payload as unknown as Record<string, unknown>,
      retryKey,
    );

    revalidatePath("/inventory/transactions");
    revalidatePath("/inventory/stock");
    revalidatePath("/inventory");
    return { ok: true, data: result };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Lỗi xác minh hạn sử dụng";
    return { ok: false, error: message };
  }
}
