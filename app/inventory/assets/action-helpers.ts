export interface ActionResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export function parseErrorMessage(err: unknown): {
  error: string;
  code?: string;
} {
  const raw = err instanceof Error ? err.message : String(err);

  if (raw.includes("STALE_REVISION")) {
    return {
      error:
        "Dữ liệu phiên bản đã cũ (STALE_REVISION). Tài sản đã bị thay đổi bởi người dùng khác. Vui lòng tải lại trang và giữ nguyên thông tin vừa nhập để kiểm tra.",
      code: "STALE_REVISION",
    };
  }
  if (raw.includes("DUPLICATE_MANUFACTURER_SERIAL")) {
    return {
      error:
        "Số sê-ri nhà sản xuất này đã tồn tại trong hệ thống với cùng hãng sản xuất và model (DUPLICATE_MANUFACTURER_SERIAL).",
      code: "DUPLICATE_MANUFACTURER_SERIAL",
    };
  }
  if (raw.includes("BUSINESS_DUPLICATE")) {
    return {
      error:
        "Hồ sơ nhập này đã được ghi nhận với cùng mã dòng (BUSINESS_DUPLICATE). Không thể tạo trùng lặp vật lý.",
      code: "BUSINESS_DUPLICATE",
    };
  }
  if (
    raw.includes("DISPOSED_LIFECYCLE_TERMINAL") ||
    raw.includes("INVALID_LIFECYCLE_TRANSITION")
  ) {
    return {
      error:
        "Tài sản đã thanh lý là trạng thái kết thúc, không thể kích hoạt lại (DISPOSED_LIFECYCLE_TERMINAL).",
      code: "DISPOSED_LIFECYCLE_TERMINAL",
    };
  }
  if (raw.includes("INVALID_SERIAL_IDENTITY")) {
    return {
      error:
        "Khi nhập số sê-ri của nhà sản xuất, hãng sản xuất (Manufacturer) và model là bắt buộc.",
      code: "INVALID_SERIAL_IDENTITY",
    };
  }
  if (raw.includes("AUTH_DENIED") || raw.includes("PERMISSION_DENIED")) {
    return {
      error:
        "Bạn không có quyền thực hiện thao tác này. Vui lòng kiểm tra vai trò Quản trị viên (Admin).",
      code: "AUTH_DENIED",
    };
  }
  if (raw.includes("RETRY_PAYLOAD_MISMATCH")) {
    return {
      error:
        "Yêu cầu gửi lại không khớp với nội dung đã ghi nhận trước đó (RETRY_PAYLOAD_MISMATCH).",
      code: "RETRY_PAYLOAD_MISMATCH",
    };
  }
  if (raw.includes("INVALID_CORRECTION_TARGET")) {
    return {
      error:
        "Sự kiện được chỉ định đính chính không thuộc về tài sản này hoặc không hợp lệ.",
      code: "INVALID_CORRECTION_TARGET",
    };
  }
  if (raw.includes("INVALID_EXPIRY")) {
    return {
      error:
        "Thông tin hạn sử dụng không hợp lệ hoặc đã hết hạn đối với vật tư yêu cầu hạn sử dụng.",
      code: "INVALID_EXPIRY",
    };
  }

  return { error: raw };
}
