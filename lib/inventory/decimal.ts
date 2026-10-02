/**
 * Exact Decimal Operations for MedLabs S1 Inventory
 * Enforces numeric(18,6) and numeric(20,4) constraints without JavaScript floating-point conversions.
 */

export const MAX_QUANTITY_SCALE = 6;
export const MAX_CURRENCY_SCALE = 4;
export const MAX_INTEGRAL_DIGITS = 12; // 999,999,999,999

const ZERO_BIGINT = BigInt(0);
const ONE_BIGINT = BigInt(1);
const TEN_BIGINT = BigInt(10);

function pow10(exponent: number): bigint {
  let result = ONE_BIGINT;
  for (let i = 0; i < exponent; i++) {
    result = result * TEN_BIGINT;
  }
  return result;
}

export interface DecimalValidationResult {
  valid: boolean;
  normalized?: string;
  error?: string;
}

/**
 * Normalizes user input (handling commas as decimal points, trimming whitespace)
 * and verifies that it is a valid finite decimal with bounds.
 */
export function validateDecimalString(
  raw: unknown,
  maxScale = MAX_QUANTITY_SCALE,
  maxIntegralDigits = MAX_INTEGRAL_DIGITS,
): DecimalValidationResult {
  if (raw === null || raw === undefined) {
    return {
      valid: false,
      error: "Giá trị số không được để trống / Value is required",
    };
  }

  let str = String(raw).trim();
  if (str === "") {
    return {
      valid: false,
      error: "Giá trị số không được để trống / Value is required",
    };
  }

  // Replace comma with dot if present
  str = str.replace(",", ".");

  // Reject scientific notation, non-numeric characters, multiple signs or dots
  const match = /^([+-]?)(0|[1-9]\d*)(\.(\d+))?$/.exec(str);
  if (!match) {
    return {
      valid: false,
      error:
        "Định dạng số không hợp lệ. Vui lòng nhập số thập phân chuẩn / Invalid decimal format",
    };
  }

  const sign = match[1] === "-" ? "-" : "";
  const integerPart = match[2];
  const fractionalPart = match[4] ?? "";

  if (integerPart.length > maxIntegralDigits) {
    return {
      valid: false,
      error: `Phần nguyên vượt quá giới hạn tối đa ${maxIntegralDigits} chữ số / Integral part exceeds ${maxIntegralDigits} digits`,
    };
  }

  if (fractionalPart.length > maxScale) {
    return {
      valid: false,
      error: `Độ chính xác vượt quá ${maxScale} chữ số thập phân / Precision exceeds ${maxScale} decimal places`,
    };
  }

  // Remove redundant trailing zeroes for normalized representation, but keep at least "0"
  const trimmedFraction = fractionalPart.replace(/0+$/, "");
  const normalized =
    trimmedFraction.length > 0
      ? `${sign}${integerPart}.${trimmedFraction}`
      : `${sign}${integerPart}`;

  // Check for negative zero
  if (normalized === "-0" || normalized === "-0.0") {
    return { valid: true, normalized: "0" };
  }

  return { valid: true, normalized };
}

/**
 * Parses a decimal string to a scaled BigInt.
 * E.g., parseToBigInt("12.345", 6) -> 12345000n
 */
export function parseToBigInt(
  strVal: string,
  scale = MAX_QUANTITY_SCALE,
): bigint {
  const validation = validateDecimalString(strVal, scale);
  if (!validation.valid || validation.normalized === undefined) {
    throw new Error(validation.error ?? "Invalid decimal string");
  }

  const normalized = validation.normalized;
  const isNegative = normalized.startsWith("-");
  const absStr = isNegative ? normalized.slice(1) : normalized;

  const [intPart, fracPart = ""] = absStr.split(".");
  const paddedFrac = fracPart.padEnd(scale, "0").slice(0, scale);
  const combined = `${intPart}${paddedFrac}`;
  const bigVal = BigInt(combined);

  return isNegative ? -bigVal : bigVal;
}

/**
 * Formats a scaled BigInt back to a canonical decimal string.
 */
export function formatFromBigInt(
  val: bigint,
  scale = MAX_QUANTITY_SCALE,
): string {
  const isNegative = val < ZERO_BIGINT;
  const absVal = isNegative ? -val : val;
  const divisor = pow10(scale);

  const intPart = absVal / divisor;
  const fracPart = absVal % divisor;

  const fracStr = fracPart.toString().padStart(scale, "0").replace(/0+$/, "");
  const sign =
    isNegative && (intPart > ZERO_BIGINT || fracPart > ZERO_BIGINT) ? "-" : "";

  return fracStr.length > 0
    ? `${sign}${intPart}.${fracStr}`
    : `${sign}${intPart}`;
}

/**
 * Exact addition of two decimal strings.
 */
export function addExact(
  a: string,
  b: string,
  scale = MAX_QUANTITY_SCALE,
): string {
  const aBig = parseToBigInt(a, scale);
  const bBig = parseToBigInt(b, scale);
  return formatFromBigInt(aBig + bBig, scale);
}

/**
 * Exact subtraction of two decimal strings (a - b).
 */
export function subtractExact(
  a: string,
  b: string,
  scale = MAX_QUANTITY_SCALE,
): string {
  const aBig = parseToBigInt(a, scale);
  const bBig = parseToBigInt(b, scale);
  return formatFromBigInt(aBig - bBig, scale);
}

/**
 * Exact comparison of two decimal strings.
 * Returns -1 if a < b, 0 if a == b, 1 if a > b.
 */
export function compareExact(
  a: string,
  b: string,
  scale = MAX_QUANTITY_SCALE,
): number {
  const aBig = parseToBigInt(a, scale);
  const bBig = parseToBigInt(b, scale);
  if (aBig < bBig) return -1;
  if (aBig > bBig) return 1;
  return 0;
}

export function isZero(val: string, scale = MAX_QUANTITY_SCALE): boolean {
  if (!val || val.trim() === "") return true;
  try {
    return parseToBigInt(val, scale) === ZERO_BIGINT;
  } catch {
    return false;
  }
}

export function isPositive(val: string, scale = MAX_QUANTITY_SCALE): boolean {
  if (!val || val.trim() === "") return false;
  try {
    return parseToBigInt(val, scale) > ZERO_BIGINT;
  } catch {
    return false;
  }
}

export function isNonNegative(
  val: string,
  scale = MAX_QUANTITY_SCALE,
): boolean {
  if (!val || val.trim() === "") return false;
  try {
    return parseToBigInt(val, scale) >= ZERO_BIGINT;
  } catch {
    return false;
  }
}

/**
 * Multiplies purchase quantity by conversion factor exactly,
 * checking against the destination unit's allowed scale.
 * E.g., count (scale 0) rejects 1 * 0.5 = 0.5.
 */
export function multiplyExact(
  qtyStr: string,
  factorStr: string,
  allowedScale: number = MAX_QUANTITY_SCALE,
): { valid: boolean; result?: string; error?: string } {
  const qtyVal = validateDecimalString(qtyStr, MAX_QUANTITY_SCALE);
  if (!qtyVal.valid || !qtyVal.normalized) {
    return {
      valid: false,
      error: `Số lượng nhập không hợp lệ: ${qtyVal.error}`,
    };
  }

  const factorVal = validateDecimalString(factorStr, MAX_QUANTITY_SCALE);
  if (!factorVal.valid || !factorVal.normalized) {
    return {
      valid: false,
      error: `Hệ số quy đổi không hợp lệ: ${factorVal.error}`,
    };
  }

  if (!isPositive(qtyVal.normalized)) {
    return {
      valid: false,
      error: "Số lượng nhập phải lớn hơn 0 / Purchase quantity must be > 0",
    };
  }

  if (!isPositive(factorVal.normalized)) {
    return {
      valid: false,
      error: "Hệ số quy đổi phải lớn hơn 0 / Conversion factor must be > 0",
    };
  }

  // Parse using raw decimal places
  const [qInt, qFrac = ""] = qtyVal.normalized.split(".");
  const [fInt, fFrac = ""] = factorVal.normalized.split(".");

  const qScale = qFrac.length;
  const fScale = fFrac.length;
  const totalScale = qScale + fScale;

  const qBig = BigInt(`${qInt}${qFrac}`);
  const fBig = BigInt(`${fInt}${fFrac}`);
  const productBig = qBig * fBig;

  // Format to intermediate string with totalScale
  const divisor = pow10(totalScale);
  const intPart = productBig / divisor;
  const fracPart = productBig % divisor;

  const fracStr =
    totalScale > 0
      ? fracPart.toString().padStart(totalScale, "0").replace(/0+$/, "")
      : "";

  // Check if product has more fractional digits than destination allowed_scale
  if (fracStr.length > allowedScale) {
    if (allowedScale === 0) {
      return {
        valid: false,
        error: `Đơn vị cơ sở là đơn vị đếm (scale 0), tích quy đổi (${intPart}.${fracStr}) không được có phần thập phân / Base UOM is discrete, fractional base quantity is prohibited`,
      };
    }
    return {
      valid: false,
      error: `Tích quy đổi có ${fracStr.length} chữ số thập phân, vượt quá giới hạn đơn vị cơ sở cho phép (${allowedScale}) / Base quantity precision exceeds allowed scale`,
    };
  }

  // Check integral limit
  if (intPart.toString().length > MAX_INTEGRAL_DIGITS) {
    return {
      valid: false,
      error:
        "Số lượng quy đổi vượt quá giới hạn hệ thống (12 chữ số nguyên) / Base quantity exceeds maximum magnitude",
    };
  }

  const result = fracStr.length > 0 ? `${intPart}.${fracStr}` : `${intPart}`;
  return { valid: true, result };
}

/**
 * Validates that good_quantity + damaged_quantity = base_quantity exactly.
 */
export function validateSplit(
  baseStr: string,
  goodStr: string,
  damagedStr: string,
  scale = MAX_QUANTITY_SCALE,
): { valid: boolean; error?: string } {
  const baseV = validateDecimalString(baseStr, scale);
  if (!baseV.valid || !baseV.normalized) {
    return {
      valid: false,
      error: `Số lượng cơ sở không hợp lệ: ${baseV.error}`,
    };
  }

  const goodV = validateDecimalString(goodStr, scale);
  if (!goodV.valid || !goodV.normalized) {
    return { valid: false, error: `Số lượng tốt không hợp lệ: ${goodV.error}` };
  }

  const damagedV = validateDecimalString(damagedStr, scale);
  if (!damagedV.valid || !damagedV.normalized) {
    return {
      valid: false,
      error: `Số lượng hỏng không hợp lệ: ${damagedV.error}`,
    };
  }

  if (compareExact(goodV.normalized, "0", scale) < 0) {
    return {
      valid: false,
      error: "Số lượng tốt không được âm / Good quantity cannot be negative",
    };
  }

  if (compareExact(damagedV.normalized, "0", scale) < 0) {
    return {
      valid: false,
      error:
        "Số lượng hỏng không được âm / Damaged quantity cannot be negative",
    };
  }

  const sum = addExact(goodV.normalized, damagedV.normalized, scale);
  if (compareExact(sum, baseV.normalized, scale) !== 0) {
    return {
      valid: false,
      error: `Tổng SL tốt (${goodV.normalized}) + SL hỏng (${damagedV.normalized}) = ${sum}, không khớp với SL cơ sở (${baseV.normalized}) / Good + damaged must equal base quantity exactly`,
    };
  }

  return { valid: true };
}

/**
 * Formats a decimal string for display, optionally with thousand separators.
 */
export function formatDisplayQuantity(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "0";
  const str = String(value).trim();
  const [intPart, fracPart] = str.split(".");
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart ? `${formattedInt}.${fracPart}` : formattedInt;
}

/**
 * Formats currency amount (numeric(20,4)) for display.
 */
export function formatCurrencyAmount(
  amount: string | number | null | undefined,
  currencyCode = "VND",
): string {
  if (amount === null || amount === undefined || amount === "")
    return `0 ${currencyCode}`;
  const formatted = formatDisplayQuantity(amount);
  return `${formatted} ${currencyCode}`;
}
