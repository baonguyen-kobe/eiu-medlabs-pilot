import { z } from "zod";
import { preparationError, unknownCodeError } from "./equipment-preparation";

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
      requested_quantity: amount.optional(),
      baseline_source: z.string().optional(),
      unit: z.string(),
    }),
  ),
  locations: z.array(
    z.object({
      id: z.guid(),
      name: z.string(),
      active: z.boolean(),
      // The request's room location: receiving there keeps the item (t4r2).
      room: z.boolean().optional(),
    }),
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
      base_uom_code: z.string(),
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
      actor_id: z.guid(),
      occurred_at: z.string(),
      reason: z.string(),
      signature_required: z.boolean(),
      superseded: z.boolean(),
      snapshot_hash: z.string(),
      snapshot: z.json(),
      display_lines: z
        .array(
          z.object({
            id: z.guid(),
            kind: z.string(),
            item_name: z.string(),
            unit: z.string(),
            quantity: z.string(),
            condition: z.string().nullable(),
            asset_code: z.string().nullable(),
            issue_slice_id: z.guid(),
          }),
        )
        .optional(),
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

/** Request facts for the record header and summary (read by the page). */
export type FulfillmentSummary = {
  code: string;
  course: string;
  room: string;
  session: string;
  handover: string;
  registrant: string;
  responsible: string;
};
export type FulfillmentOperation =
  | "add_supplemental_line"
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
  add_supplemental_line: "Ghi nhận dụng cụ phát sinh",
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
const s5Errors: Record<string, string> = {
  S5_HANDOVER_REQUIRED: "Cần thực giao lần đầu trước khi thực hiện bước này.",
  S5_PREPARED_REQUEST_REQUIRED:
    "Phiếu chưa được chuẩn bị. Vui lòng chuẩn bị thiết bị trước khi bàn giao.",
  S5_PREPARATION_RECONCILIATION_REQUIRED:
    "Kết quả chuẩn bị chưa khớp với kho. Quay lại màn hình chuẩn bị để xử lý trước khi bàn giao.",
  S5_RETURN_EXCEEDS_ISSUE: "Số lượng trả vượt quá số lượng đã giao còn lại.",
  S5_RECEIPT_LOCATION_INACTIVE:
    "Vị trí nhận trả đã ngừng hoạt động. Vui lòng chọn vị trí khác.",
  S5_ROOM_KEEP_ADMIN_ONLY:
    "Chỉ Admin mới được chọn giữ lại thiết bị cho phòng.",
  S5_ROOM_KEEP_WRONG_ROOM:
    "Chỉ được giữ lại thiết bị tại phòng của buổi học của phiếu này.",
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
  const code = Object.keys(s5Errors).find((key) => message.includes(key));
  if (code) return s5Errors[code];
  if (/(S4_|P1_|RETRY_PAYLOAD_MISMATCH)/.test(message))
    return preparationError(message);
  return unknownCodeError(message) ?? `Không ghi nhận thao tác: ${message}`;
}
