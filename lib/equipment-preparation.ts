import { z } from "zod";

const quantity = z.string().regex(/^\d+(\.\d+)?$/);
export const preparationAllocationSchema = z.object({
  mapping_id: z.guid(),
  location_id: z.guid(),
  base_quantity: z.string(),
  asset_ids: z.array(z.guid()),
});
export const preparationPlanSchema = z.object({
  lines: z.array(
    z.object({
      line_id: z.guid(),
      planned_quantity: z.string(),
      reviewed_revision: z.number().int().nullable(),
      shortage_reason: z.string(),
      allocations: z.array(preparationAllocationSchema),
    }),
  ),
});
const demandSchema = z.object({
  id: z.guid(),
  catalog_item_id: z.guid(),
  skill_name: z.string(),
  demand_quantity: quantity,
  registered_quantity: quantity,
  planned_quantity: quantity,
  baseline_source: z.string(),
  line_revision: z.number().int(),
  note: z.string().nullable(),
  commercial_name: z.string(),
  item_name: z.string(),
  unit: z.string(),
});
const attemptSchema = z.object({
  id: z.guid(),
  state: z.enum(["draft", "prepared", "reversing", "reversed", "cancelled"]),
  revision: z.number().int(),
  source_revision: z.number().int(),
  draft: preparationPlanSchema,
  lock_holder: z.guid().nullable(),
  lock_expires_at: z.string().nullable(),
  primary_preparer: z.guid().nullable(),
  health: z.array(
    z.object({
      reservation_id: z.guid(),
      allocation_id: z.guid(),
      committed: quantity,
      pool_shortfall: quantity,
    }),
  ),
});
export const preparationAdjustmentTargetSchema = z.union([
  z.object({
    line_id: z.guid(),
    quantity,
    catalog_item_id: z.guid(),
    skill_name: z.string(),
    note: z.string(),
    commercial_name: z.string(),
    item_name: z.string(),
    unit: z.string(),
  }),
  z.object({ line_id: z.guid(), quantity }).strict(),
]);
const adjustmentSchema = z.object({
  id: z.guid(),
  status: z.enum(["pending", "approved", "rejected"]),
  submitted_revision: z.number().int(),
  reason: z.string(),
  targets: z.array(preparationAdjustmentTargetSchema),
});
const transferSchema = z.object({
  id: z.guid(),
  transaction_id: z.guid(),
  compensates_id: z.guid().nullable(),
  source_location_id: z.guid(),
  destination_location_id: z.guid(),
  cohort_id: z.guid().nullable(),
  asset_id: z.guid().nullable(),
  quantity,
  condition: z.string(),
});
export const preparationWorkspaceSchema = z.object({
  request: z.object({
    id: z.guid(),
    status: z.string(),
    revision: z.number().int(),
    receive_at: z.string(),
    return_at: z.string(),
    registrant_id: z.guid(),
    responsible_lecturer_id: z.guid(),
  }),
  manager: z.boolean(),
  admin: z.boolean(),
  actor_id: z.guid(),
  can_propose: z.boolean(),
  lines: z.array(demandSchema),
  preparation: attemptSchema.nullable(),
  adjustments: z.array(adjustmentSchema),
  transfers: z.array(transferSchema),
});
export const preparationSourceSchema = z.object({
  mapping_id: z.guid(),
  catalog_item_id: z.guid(),
  inventory_item_id: z.guid(),
  conversion_factor: quantity,
  base_uom_code: z.string(),
  item_name: z.string(),
  item_code: z.string(),
  tracking_strategy: z.enum(["quantity", "serialized"]),
  location_id: z.guid(),
  location_name: z.string(),
  available_quantity: quantity,
});
export const preparationSourcesSchema = z.object({
  rows: z.array(preparationSourceSchema),
  page: z.number().int(),
});
export const preparationAssetSchema = z.object({
  id: z.guid(),
  asset_code: z.string(),
  manufacturer_serial: z.string().nullable(),
  revision: z.number().int(),
  eligible: z.boolean(),
  unreserved: z.boolean(),
});
export const preparationAssetsSchema = z.object({
  rows: z.array(preparationAssetSchema),
  total: z.number().int(),
  page: z.number().int(),
});
export const preparationHistorySchema = z.object({
  rows: z.array(
    z.object({
      id: z.guid(),
      operation: z.string(),
      revision: z.number().int(),
      created_at: z.string(),
      actor_name: z.string().nullable(),
      payload: z.json(),
    }),
  ),
  total: z.number().int(),
  page: z.number().int(),
});
export const preparationInventoryOptionsSchema = z.object({
  rows: z.array(
    z.object({
      id: z.guid(),
      code: z.string(),
      name: z.string(),
      base_uom_code: z.string(),
    }),
  ),
  total: z.number().int(),
});
export const preparationCatalogSchema = z.object({
  rows: z.array(
    z.object({
      id: z.guid(),
      commercial_name: z.string(),
      item_name: z.string(),
      unit: z.string(),
    }),
  ),
  total: z.number().int(),
  page: z.number().int(),
});
export type PreparationCatalog = z.infer<typeof preparationCatalogSchema>;
export type PreparationAdjustmentTarget = z.infer<
  typeof preparationAdjustmentTargetSchema
>;
export type PreparationAddedTarget = Extract<
  PreparationAdjustmentTarget,
  { catalog_item_id: string }
>;
export type PreparationAllocation = z.infer<typeof preparationAllocationSchema>;
export type PreparationPlan = z.infer<typeof preparationPlanSchema>;
export type PreparationPlanLine = PreparationPlan["lines"][number];
export type PreparationDemand = z.infer<typeof demandSchema>;
export type PreparationAttempt = z.infer<typeof attemptSchema>;
export type QuantityAdjustment = z.infer<typeof adjustmentSchema>;
export type PreparationTransfer = z.infer<typeof transferSchema>;
export type PreparationWorkspace = z.infer<typeof preparationWorkspaceSchema>;
export type PreparationSource = z.infer<typeof preparationSourceSchema>;
export type PreparationAsset = z.infer<typeof preparationAssetSchema>;
export type PreparationHistory = z.infer<typeof preparationHistorySchema>;
export type PreparationOperation =
  | "start"
  | "save"
  | "heartbeat"
  | "release_lock"
  | "confirm"
  | "override_lock"
  | "map_item"
  | "add_line"
  | "propose_adjustment"
  | "approve_adjustment"
  | "reject_adjustment"
  | "reallocate"
  | "begin_reversal"
  | "finalize_reversal";
export type PreparationResult<T> =
  { ok: true; data: T } | { ok: false; error: string };

export function preparationPlan(
  workspace: PreparationWorkspace,
): PreparationPlan {
  const attempt = workspace.preparation;
  const saved = new Map(
    attempt && !["reversed", "cancelled"].includes(attempt.state)
      ? attempt.draft.lines.map((line) => [line.line_id, line])
      : [],
  );
  return {
    lines: workspace.lines.map(
      (line) =>
        saved.get(line.id) ?? {
          line_id: line.id,
          planned_quantity: line.planned_quantity,
          reviewed_revision: null,
          shortage_reason: "",
          allocations: [],
        },
    ),
  };
}

const errors: Record<string, string> = {
  STALE_REVISION:
    "Dữ liệu đã thay đổi. Tải phiên bản mới và rà soát lại; dữ liệu đang nhập được giữ nguyên.",
  S4_LOCK_HELD:
    "Tab khác đang giữ khóa chuẩn bị. Không ghi đè tiến độ của tab đó.",
  S4_LOCK_REQUIRED:
    "Khóa chuẩn bị đã hết hạn hoặc thuộc tab khác. Bắt đầu chuẩn bị lại trước khi lưu.",
  S4_REVIEW_REQUIRED: "Có dòng chưa rà soát theo phiên bản hiện hành.",
  S4_ALL_LINES_REVIEW_REQUIRED: "Phải rà soát mọi dòng đang hoạt động.",
  S4_INSUFFICIENT_AVAILABLE:
    "Nguồn đủ điều kiện không đủ sau khi trừ các cam kết đang giữ.",
  S4_SHORTAGE_REASON_REQUIRED: "Nhập lý do cho từng dòng chuẩn bị thiếu.",
  S4_ALLOCATION_TOTAL_MISMATCH:
    "Tổng allocations sau quy đổi phải bằng SL sẽ giao.",
  S4_ALL_ZERO_FORBIDDEN:
    "Không thể xác nhận phiếu có toàn bộ SL sẽ giao bằng 0.",
  S4_PHYSICAL_COMPENSATION_REQUIRED:
    "Chưa hoàn tất chuyển trả vật lý liên quan về nguồn gốc. Cam kết chưa được giải phóng.",
  S4_RESERVED_BACKING_PROTECTED:
    "Không được chuyển phần tồn đang bảo vệ cam kết của phiếu khác.",
  S4_ASSET_INELIGIBLE: "Tài sản không còn đủ điều kiện tại nguồn đã chọn.",
  S4_ABSOLUTE_TARGET_REQUIRED:
    "Plan phải dùng đúng SL đề nghị tuyệt đối đã được rà soát.",
  S4_MAPPING_REQUIRED:
    "Cần mapping Inventory hợp lệ và đơn vị tương đương đã xác minh.",
  AUTH_DENIED: "Bạn không có quyền thực hiện thao tác trên phiếu này.",
};
export function preparationError(message: string): string {
  const code = Object.keys(errors).find((key) => message.includes(key));
  if (code) return errors[code];
  if (message.includes("inventory_reservations_active_asset"))
    return "Tài sản đã được giữ cho một allocation khác. Hãy chọn tài sản khác.";
  return message;
}
