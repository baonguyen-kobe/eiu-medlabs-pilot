// Plain-Vietnamese names for ledger and asset codes; the keys are i18n keys.
export const operationLabels: Record<string, string> = {
  RECEIVE: "Nhận kho",
  OPENING: "Tồn đầu kỳ",
  CORRECT_RECEIPT: "Điều chỉnh phiếu nhận",
  REVERSE_RECEIPT: "Hủy phiếu nhận",
  CORRECT_OPENING: "Điều chỉnh tồn đầu kỳ",
  TRANSFER: "Điều chuyển kho",
  CONDITION_CHANGE: "Đổi tình trạng",
  STOCKTAKE_ADJUST: "Điều chỉnh kiểm kê",
  STOCKTAKE_SURPLUS: "Dư thừa kiểm kê",
  VERIFY_SURPLUS: "Thẩm định dư thừa",
  EQUIPMENT_FULFILLMENT: "Cấp phát thiết bị",
  ASSET_RECEIVE: "Nhận tài sản",
  ASSET_OPEN: "Tài sản đầu kỳ",
  ASSET_SET_STATE: "Hiện trạng tài sản",
  ASSET_SET_LIFECYCLE: "Vòng đời tài sản",
  ASSET_CORRECT: "Đính chính tài sản",
  receive_asset: "Nhận tài sản mới",
  open_asset: "Ghi nhận tồn đầu kỳ",
  set_asset_state: "Cập nhật vị trí & trạng thái",
  set_asset_lifecycle: "Chuyển trạng thái vòng đời",
  correct_asset: "Đính chính thông tin",
};

export const expiryPrecisionLabels: Record<string, string> = {
  not_required: "Không cần hạn dùng",
  day: "Theo ngày",
  month: "Theo tháng",
  unknown: "Chưa rõ",
};

export const lifecycleLabels: Record<string, string> = {
  in_service: "Đang vận hành",
  registered: "Mới tiếp nhận",
  inactive: "Tạm ngưng",
  retired: "Ngừng sử dụng",
  disposed: "Đã thanh lý",
};

export const operationalLabels: Record<string, string> = {
  ready: "Sẵn sàng",
  in_use: "Đang sử dụng",
  under_maintenance: "Bảo trì",
  damaged: "Hư hỏng",
  prohibited: "Cấm lưu hành",
};

/** Falls back to the raw code so an unknown value is still visible. */
export const labelOf = (map: Record<string, string>, code: string) =>
  map[code] ?? code;

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Readable text for a ledger business key; never raw JSON or a full UUID. */
export function describeBusinessKey(key: string | null | undefined): string {
  const raw = (key ?? "").trim();
  if (!raw) return "—";
  if (raw.startsWith("{")) {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      if (o.ref !== undefined) {
        return o.row !== undefined ? `${o.ref} · dòng ${o.row}` : String(o.ref);
      }
      if (o.rev !== undefined) return `Tài sản · phiên bản ${o.rev}`;
    } catch {
      // fall through to the generic handling
    }
    return "Phiếu hệ thống";
  }
  const [head, ...rest] = raw.split(":");
  const tail = rest.join(":");
  if (head === "transfer") return "Điều chuyển";
  if (head === "stocktake") return tail ? `Kiểm kê ${tail}` : "Kiểm kê";
  if (UUID.test(head))
    return tail ? `Phiếu yêu cầu · ${tail}` : "Phiếu yêu cầu";
  return raw;
}

/** Tooltip text: the first 8 chars of any UUID in the key, else the key. */
export function businessKeyTitle(key: string | null | undefined): string {
  const raw = key ?? "";
  return raw.replace(/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/gi, (m) =>
    m.slice(0, 8),
  );
}

const reasonPatterns: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [
    /^Lifecycle status is (\w+) \(requires in_service\)$/,
    (m) =>
      `Tài sản đang ở trạng thái "${labelOf(lifecycleLabels, m[1])}", cần "Đang vận hành"`,
  ],
  [
    /^Operational status is (\w+) \(requires ready\)$/,
    (m) =>
      `Tình trạng hiện tại là "${labelOf(operationalLabels, m[1])}", cần "Sẵn sàng"`,
  ],
  [/^Catalog item is inactive$/, () => "Danh mục thiết bị đã ngừng hoạt động"],
  [/^Storage location is inactive$/, () => "Vị trí lưu trữ đã ngừng hoạt động"],
  [
    /^Asset expiry date is unknown or unverified$/,
    () => "Chưa rõ hoặc chưa xác minh hạn dùng",
  ],
  [/^Asset expired on (.+)$/, (m) => `Đã hết hạn dùng từ ${m[1]}`],
];

/** Vietnamese text for a server ineligibility reason; unknown text stays as is. */
export function describeIneligibility(reason: string): string {
  for (const [re, fn] of reasonPatterns) {
    const m = reason.match(re);
    if (m) return fn(m);
  }
  return reason;
}
