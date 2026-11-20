import { unstable_rethrow } from "next/navigation";

// Codes raised by inventory_command / inventory_read (supabase/migrations/*inventory*.sql).
const MESSAGES: Record<string, string> = {
  STALE_REVISION:
    "Dữ liệu đã được người khác thay đổi. Vui lòng tải lại trang rồi thử lại.",
  AUTH_DENIED: "Bạn không có quyền thực hiện thao tác này.",
  PERMISSION_DENIED: "Bạn không có quyền thực hiện thao tác này.",
  INACTIVE_REFERENCE:
    "Một mục được chọn (vật tư, vị trí, nhà cung cấp…) đã ngừng hoạt động.",
  BUSINESS_DUPLICATE: "Mã này đã tồn tại. Vui lòng dùng mã khác.",
  DUPLICATE_NATURAL_DIMENSIONS: "Mục này đã tồn tại với cùng thông tin.",
  INVALID_EXPIRY: "Hạn dùng không hợp lệ hoặc còn thiếu.",
  REASON_REQUIRED: "Vui lòng nhập lý do.",
  EVIDENCE_REQUIRED: "Vui lòng đính kèm hoặc ghi chứng từ.",
  INVALID_DECIMAL: "Số lượng hoặc đơn giá không hợp lệ.",
  INVALID_QUANTITY: "Số lượng không hợp lệ.",
  INVALID_COST: "Đơn giá không hợp lệ.",
  LINES_REQUIRED: "Vui lòng thêm ít nhất một dòng.",
  EMPTY_LINES: "Vui lòng thêm ít nhất một dòng.",
  INSUFFICIENT_STOCK: "Tồn kho không đủ cho số lượng này.",
  INSUFFICIENT_ORIGIN_STOCK: "Tồn ở vị trí nguồn không đủ cho số lượng này.",
  OPENING_SCOPE_CONFLICT: "Tồn đầu kỳ cho phạm vi này đã được ghi nhận.",
  DEPENDENT_FACT: "Không thể sửa vì đã có giao dịch phát sinh sau đó.",
  SOURCE_RECORD_VOIDED: "Hồ sơ nguồn này đã bị hủy.",
  ITEM_SOURCE_MISMATCH: "Vật tư không khớp với dòng hồ sơ nguồn.",
  RETRY_PAYLOAD_MISMATCH:
    "Yêu cầu gửi lại không khớp với lần gửi trước. Vui lòng tải lại trang.",
  ITEM_NOT_FOUND: "Không tìm thấy vật tư.",
  SOURCE_LINE_NOT_FOUND: "Không tìm thấy dòng hồ sơ nguồn.",
  TRANSACTION_NOT_FOUND: "Không tìm thấy giao dịch.",
  INVALID_PAYLOAD: "Dữ liệu gửi lên không hợp lệ. Vui lòng kiểm tra lại.",
};

/** Turns a thrown inventory error into an action result, letting Next redirects through. */
export function inventoryActionError(err: unknown, fallback: string) {
  unstable_rethrow(err);
  const raw = err instanceof Error ? err.message : "";
  const code = Object.keys(MESSAGES).find((key) => raw.includes(key));
  if (code) return { ok: false as const, error: MESSAGES[code], code };
  // Unmapped: keep the server detail after the fallback so staff can report it.
  const detail = raw.replace(/^INVENTORY_COMMAND_ERROR \[[^\]]*\]:\s*/, "");
  if (!detail) return { ok: false as const, error: fallback };
  // A message the action itself threw in Vietnamese reads fine alone.
  const technical =
    /[A-Z]{2,}_[A-Z]/.test(detail) || /^[\x00-\x7F]*$/.test(detail);
  return {
    ok: false as const,
    error: technical ? `${fallback}: ${detail}` : detail,
  };
}
