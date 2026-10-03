import { z } from "zod";

const amount = z.union([z.string(), z.number()]).transform(String);
export const fulfillmentSchema = z.object({
  request_id: z.guid(),
  revision: z.number().int(),
  status: z.string(),
  manager: z.boolean(),
  admin: z.boolean(),
  signer: z.boolean(),
  lines: z.array(
    z.object({
      id: z.guid(),
      catalog_item_id: z.guid(),
      name: z.string(),
      registered_quantity: amount,
      planned_quantity: amount,
      unit: z.string(),
    }),
  ),
  locations: z.array(
    z.object({ id: z.guid(), name: z.string(), active: z.boolean() }),
  ),
  issues: z.array(
    z.object({
      id: z.guid(),
      event_id: z.guid(),
      request_line_id: z.guid(),
      mapping_id: z.guid(),
      location_id: z.guid(),
      asset_id: z.guid().nullable(),
      asset_code: z.string().nullable(),
      item_name: z.string(),
      return_required: z.boolean(),
      issued: amount,
      returned: amount,
      resolved: amount,
      due: amount,
      held: amount,
    }),
  ),
  events: z.array(
    z.object({
      id: z.guid(),
      revision: z.number(),
      operation: z.string(),
      occurred_at: z.string(),
      reason: z.string(),
      signature_required: z.boolean(),
      superseded: z.boolean(),
      snapshot_hash: z.string(),
      snapshot: z.json(),
      payload: z.record(z.string(), z.json()),
      signature: z
        .object({
          actor_id: z.guid(),
          signed_at: z.string(),
          snapshot_hash: z.string(),
        })
        .nullable(),
    }),
  ),
  event_count: z.number().int(),
});
export type Fulfillment = z.infer<typeof fulfillmentSchema>;
export type FulfillmentOperation =
  | "handover"
  | "supplement"
  | "initial_return"
  | "recover"
  | "resolve"
  | "consequence"
  | "reconcile"
  | "correct"
  | "sign";
export const fulfillmentLabels: Record<FulfillmentOperation, string> = {
  handover: "Thực giao lần đầu",
  supplement: "Giao bổ sung",
  initial_return: "Xác nhận thực trả lần đầu",
  recover: "Thu hồi / trả muộn",
  resolve: "Đóng nghĩa vụ chưa thu hồi",
  consequence: "Xử lý tài sản (Admin)",
  reconcile: "Đối soát hold (Admin)",
  correct: "Đính chính sự kiện",
  sign: "Ký xác nhận",
};
export function fulfillmentError(message: string) {
  if (message.includes("STALE_REVISION"))
    return "Phiếu đã thay đổi. Tải phiên bản mới, kiểm tra và xác nhận lại; dữ liệu nhập được giữ.";
  if (message.includes("AUTH_DENIED"))
    return "Bạn không có quyền thực hiện thao tác này.";
  if (
    message.includes("S5_INSUFFICIENT") ||
    message.includes("S5_ASSET_UNAVAILABLE")
  )
    return "Nguồn thực giao không đủ điều kiện hoặc đã được phiếu khác giữ. Chọn lại nguồn/tài sản.";
  if (message.includes("S5_CUMULATIVE_DECREASE"))
    return "Không được giảm tổng đã thu hồi. Hãy đính chính sự kiện sai.";
  return `Không ghi nhận thao tác: ${message}`;
}
