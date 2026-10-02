export type Language = "vi" | "en";

export interface TranslationDictionary {
  [key: string]: {
    vi: string;
    en: string;
  };
}

export const inventoryTranslations: TranslationDictionary = {
  // Navigation & Titles
  inventoryTitle: {
    vi: "Quản lý Kho & Thiết bị",
    en: "Inventory & Equipment Management",
  },
  overview: {
    vi: "Tổng quan",
    en: "Overview",
  },
  stock: {
    vi: "Tồn kho",
    en: "Stock Balances",
  },
  catalog: {
    vi: "Vật tư & Danh mục",
    en: "Catalog Items",
  },
  acquisitions: {
    vi: "Hồ sơ nguồn",
    en: "Acquisition Records",
  },
  receive: {
    vi: "Nhận kho",
    en: "Receive Stock",
  },
  opening: {
    vi: "Tồn đầu kỳ",
    en: "Opening Balance",
  },
  transactions: {
    vi: "Lịch sử giao dịch",
    en: "Transaction History",
  },
  suppliers: {
    vi: "Nhà cung cấp",
    en: "Suppliers",
  },
  locations: {
    vi: "Vị trí kho",
    en: "Storage Locations",
  },
  uoms: {
    vi: "Đơn vị tính",
    en: "Units of Measure (UOM)",
  },
  categories: {
    vi: "Nhóm vật tư",
    en: "Item Categories",
  },

  // Attributes & Columns
  code: {
    vi: "Mã",
    en: "Code",
  },
  name: {
    vi: "Tên",
    en: "Name",
  },
  category: {
    vi: "Nhóm",
    en: "Category",
  },
  baseUom: {
    vi: "Đơn vị cơ sở",
    en: "Base UOM",
  },
  purchaseUom: {
    vi: "ĐVT Nhập",
    en: "Purchase UOM",
  },
  conversionFactor: {
    vi: "Hệ số quy đổi",
    en: "Conversion Factor",
  },
  materialKind: {
    vi: "Phân loại vật chất",
    en: "Material Kind",
  },
  chemical: {
    vi: "Hóa chất (Bắt buộc HSD)",
    en: "Chemical (Expiry Required)",
  },
  other: {
    vi: "Khác / Thông thường",
    en: "Other / Standard",
  },
  trackingStrategy: {
    vi: "Theo dõi",
    en: "Tracking",
  },
  returnSemantics: {
    vi: "Cơ chế hoàn trả",
    en: "Return Semantics",
  },
  returnable: {
    vi: "Có thể hoàn trả",
    en: "Returnable",
  },
  nonreturnable: {
    vi: "Không hoàn trả (Tiêu hao)",
    en: "Non-returnable (Consumable)",
  },
  inPlace: {
    vi: "Sử dụng tại chỗ",
    en: "In Place",
  },
  expiryRequired: {
    vi: "Bắt buộc HSD",
    en: "Expiry Required",
  },
  status: {
    vi: "Trạng thái",
    en: "Status",
  },
  active: {
    vi: "Hoạt động",
    en: "Active",
  },
  inactive: {
    vi: "Ngừng hoạt động",
    en: "Inactive",
  },
  revision: {
    vi: "Phiên bản",
    en: "Revision",
  },
  supplier: {
    vi: "Nhà cung cấp",
    en: "Supplier",
  },
  location: {
    vi: "Vị trí",
    en: "Location",
  },
  condition: {
    vi: "Tình trạng",
    en: "Condition",
  },
  goodCondition: {
    vi: "Tốt / Đạt chuẩn",
    en: "Good Condition",
  },
  damagedCondition: {
    vi: "Hỏng / Không đạt",
    en: "Damaged / Defective",
  },
  physicalQuantity: {
    vi: "SL Thực tế",
    en: "Physical Quantity",
  },
  eligibleQuantity: {
    vi: "SL Đủ điều kiện",
    en: "Eligible Quantity",
  },
  expiryDate: {
    vi: "Hạn sử dụng",
    en: "Expiry Date",
  },
  expiryPrecision: {
    vi: "Độ chính xác HSD",
    en: "Expiry Precision",
  },
  notRequired: {
    vi: "Không yêu cầu",
    en: "Not Required",
  },
  dayPrecision: {
    vi: "Theo ngày (YYYY-MM-DD)",
    en: "By Day (YYYY-MM-DD)",
  },
  monthPrecision: {
    vi: "Theo tháng (YYYY-MM)",
    en: "By Month (YYYY-MM)",
  },
  unknownPrecision: {
    vi: "Chưa rõ (Cần xác minh)",
    en: "Unknown (Needs Verification)",
  },
  sourceReference: {
    vi: "Mã số hồ sơ nguồn",
    en: "Source Reference",
  },
  receiptReference: {
    vi: "Mã phiếu nhận hàng",
    en: "Receipt Reference",
  },
  cutoverKey: {
    vi: "Mã số chốt số dư",
    en: "Cutover Key",
  },
  countCutoff: {
    vi: "Thời điểm chốt kiểm kê",
    en: "Count Cutoff Datetime",
  },
  provenanceGroup: {
    vi: "Nhóm chứng từ / Nguồn gốc",
    en: "Provenance Group",
  },
  unitCost: {
    vi: "Đơn giá",
    en: "Unit Cost",
  },
  currency: {
    vi: "Loại tiền",
    en: "Currency",
  },
  evidenceNote: {
    vi: "Ghi chú chứng từ / Bằng chứng",
    en: "Evidence / Notes",
  },
  reason: {
    vi: "Lý do",
    en: "Reason",
  },
  occurredAt: {
    vi: "Thời điểm phát sinh",
    en: "Occurred At",
  },
  postedAt: {
    vi: "Thời điểm ghi sổ",
    en: "Posted At",
  },
  actor: {
    vi: "Người thực hiện",
    en: "Actor",
  },
  operation: {
    vi: "Nghiệp vụ",
    en: "Operation",
  },

  // Actions
  search: {
    vi: "Tìm kiếm...",
    en: "Search...",
  },
  create: {
    vi: "Thêm mới",
    en: "Create New",
  },
  edit: {
    vi: "Chỉnh sửa",
    en: "Edit",
  },
  save: {
    vi: "Lưu thay đổi",
    en: "Save Changes",
  },
  cancel: {
    vi: "Hủy bỏ",
    en: "Cancel",
  },
  confirm: {
    vi: "Xác nhận",
    en: "Confirm",
  },
  inactivate: {
    vi: "Ngừng hoạt động",
    en: "Inactivate",
  },
  reactivate: {
    vi: "Kích hoạt lại",
    en: "Reactivate",
  },
  voidSource: {
    vi: "Hủy hồ sơ nguồn",
    en: "Void Acquisition Source",
  },
  correctReceipt: {
    vi: "Điều chỉnh phiếu nhận",
    en: "Correct Receipt",
  },
  reverseReceipt: {
    vi: "Hủy bỏ phiếu nhận (Về 0)",
    en: "Reverse Receipt (To Zero)",
  },
  correctOpening: {
    vi: "Điều chỉnh tồn đầu",
    en: "Correct Opening Balance",
  },
  verifyExpiry: {
    vi: "Xác minh hạn dùng",
    en: "Verify Expiry Date",
  },
  addLine: {
    vi: "Thêm dòng",
    en: "Add Line",
  },
  removeLine: {
    vi: "Xóa dòng",
    en: "Remove Line",
  },
  backToHistory: {
    vi: "Quay lại lịch sử",
    en: "Back to History",
  },
  viewDetails: {
    vi: "Xem chi tiết",
    en: "View Details",
  },
  refresh: {
    vi: "Làm mới",
    en: "Refresh",
  },

  // Messages & Hints
  noData: {
    vi: "Không có dữ liệu phù hợp",
    en: "No matching data found",
  },
  loading: {
    vi: "Đang tải dữ liệu...",
    en: "Loading data...",
  },
  adminOnlyHint: {
    vi: "Thao tác yêu cầu quyền Quản trị viên (Admin)",
    en: "Operation requires Administrator privileges",
  },
  costNotice: {
    vi: "Thông tin chi phí được hiển thị theo quyền INV-018",
    en: "Cost information displayed per INV-018 authority",
  },
  sourceZeroStockHint: {
    vi: "Lưu hồ sơ nguồn KHÔNG làm tăng tồn kho. Tồn kho chỉ ghi nhận sau khi Nhận kho thực tế.",
    en: "Acquisition records do NOT increase stock. Stock increases only after physical Receipt.",
  },
  syntheticOpeningHint: {
    vi: "Chốt tồn đầu kỳ chỉ thực hiện 1 lần cho mỗi phạm vi. Mọi điều chỉnh sau đó được ghi vết minh bạch.",
    en: "Opening balance confirmation is one-time per scope. Subsequent adjustments are transparently audited.",
  },
  chemicalExpiryNotice: {
    vi: "Vật tư hóa chất bắt buộc phải có Hạn sử dụng theo quy chuẩn an toàn MedLabs.",
    en: "Chemical items strictly require an Expiry Date per MedLabs safety regulations.",
  },
};

/**
 * Gets a bilingual translation pair or string by key.
 */
export function t(key: string, lang: Language = "vi"): string {
  const item = inventoryTranslations[key];
  if (!item) return key;
  return item[lang] ?? item.vi;
}

/**
 * Returns formatted bilingual label: "Tiếng Việt / English"
 */
export function bilingualLabel(key: string): string {
  const item = inventoryTranslations[key];
  if (!item) return key;
  return `${item.vi} / ${item.en}`;
}
