import { BUSINESS_TIME_ZONE, businessTodayString } from "@/lib/business-time";
import type { ExpiryPrecision } from "./types";

export interface ExpiryEvaluation {
  status: "not_required" | "valid" | "expiring_soon" | "expired" | "unknown";
  isEligible: boolean;
  labelVi: string;
  labelEn: string;
}

/**
 * Validates and normalizes expiry input based on precision.
 * For month precision, calculates the last day of the given month.
 */
export function normalizeExpiryInput(
  precision: ExpiryPrecision,
  input: string | null | undefined,
): { valid: boolean; normalizedDate?: string | null; error?: string } {
  if (precision === "not_required") {
    return { valid: true, normalizedDate: null };
  }

  if (precision === "unknown") {
    return { valid: true, normalizedDate: null };
  }

  const trimmed = String(input ?? "").trim();
  if (!trimmed) {
    return {
      valid: false,
      error:
        "Vui lòng nhập thông tin hạn sử dụng / Expiry date input is required",
    };
  }

  if (precision === "day") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return {
        valid: false,
        error:
          "Định dạng ngày hết hạn phải là YYYY-MM-DD / Format must be YYYY-MM-DD",
      };
    }
    const [year, month, day] = trimmed.split("-").map(Number);
    const dateObj = new Date(year, month - 1, day);
    if (
      dateObj.getFullYear() !== year ||
      dateObj.getMonth() !== month - 1 ||
      dateObj.getDate() !== day
    ) {
      return {
        valid: false,
        error: "Ngày hết hạn không tồn tại trên lịch / Invalid calendar date",
      };
    }
    return { valid: true, normalizedDate: trimmed };
  }

  if (precision === "month") {
    if (!/^\d{4}-\d{2}$/.test(trimmed)) {
      return {
        valid: false,
        error:
          "Định dạng tháng hết hạn phải là YYYY-MM / Format must be YYYY-MM",
      };
    }
    const [year, month] = trimmed.split("-").map(Number);
    if (month < 1 || month > 12) {
      return {
        valid: false,
        error: "Tháng hết hạn không hợp lệ (01-12) / Invalid month (01-12)",
      };
    }
    // Calculate last day of the month
    const lastDayObj = new Date(year, month, 0);
    const lastDayStr = String(lastDayObj.getDate()).padStart(2, "0");
    const normalizedDate = `${trimmed}-${lastDayStr}`;
    return { valid: true, normalizedDate };
  }

  return {
    valid: false,
    error: "Độ chính xác hạn dùng không hợp lệ / Invalid precision",
  };
}

/**
 * Evaluates expiry status against current date in Asia/Ho_Chi_Minh.
 */
export function evaluateExpiry(
  precision: ExpiryPrecision,
  expiryDateStr: string | null | undefined,
): ExpiryEvaluation {
  if (precision === "not_required") {
    return {
      status: "not_required",
      isEligible: true,
      labelVi: "Không yêu cầu HSD",
      labelEn: "Not Required",
    };
  }

  if (precision === "unknown" || !expiryDateStr) {
    return {
      status: "unknown",
      isEligible: false,
      labelVi: "Chưa rõ HSD (Cần xác minh)",
      labelEn: "Unknown (Verification Required)",
    };
  }

  const today = businessTodayString();
  if (expiryDateStr < today) {
    return {
      status: "expired",
      isEligible: false,
      labelVi: "Đã hết hạn",
      labelEn: "Expired",
    };
  }

  // Calculate 30-day threshold
  const future30 = new Date(`${today}T00:00:00+07:00`);
  future30.setUTCDate(future30.getUTCDate() + 30);
  const future30Str = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(future30);

  if (expiryDateStr <= future30Str) {
    return {
      status: "expiring_soon",
      isEligible: true,
      labelVi: "Sắp hết hạn (<= 30 ngày)",
      labelEn: "Expiring Soon (<= 30 days)",
    };
  }

  return {
    status: "valid",
    isEligible: true,
    labelVi: "Còn hạn sử dụng",
    labelEn: "Valid",
  };
}

export function formatInventoryDate(
  dateStr: string | null | undefined,
): string {
  if (!dateStr) return "—";
  const trimmed = dateStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return dateStr;
  const [year, month, day] = trimmed.split("-");
  return `${day}/${month}/${year}`;
}

export function formatInventoryDateTime(
  isoString: string | null | undefined,
): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: BUSINESS_TIME_ZONE,
      hour12: false,
    }).format(d);
  } catch {
    return isoString;
  }
}
