"use client";

import { usePathname } from "next/navigation";
import { useLanguage } from "@/components/i18n/language-provider";

// One title per Inventory page, matching its menu label, so the shell h1 names
// the page and the content does not repeat it (DEC-UI-20261117).
const pages: Array<[RegExp, string, string]> = [
  [
    /^\/inventory$/,
    "Tổng quan kho",
    "Việc cần chú ý, số dư và thao tác thường dùng.",
  ],
  [
    /^\/inventory\/stock$/,
    "Tồn kho",
    "Số lượng theo vật tư, vị trí và tình trạng.",
  ],
  [
    /^\/inventory\/rooms$/,
    "Thiết bị theo phòng",
    "Thiết bị cố định và đang mượn tại từng phòng học.",
  ],
  [
    /^\/inventory\/rooms\/[^/]+$/,
    "Thiết bị của phòng",
    "Cố định, tạm mượn và tài sản có mã của một phòng.",
  ],
  [
    /^\/inventory\/assets$/,
    "Thiết bị cá thể",
    "Thiết bị theo dõi từng cái: mã, vị trí và tình trạng.",
  ],
  [
    /^\/inventory\/assets\/receive$/,
    "Nhận thiết bị",
    "Ghi nhận thiết bị cá thể mới vào kho.",
  ],
  [
    /^\/inventory\/assets\/opening$/,
    "Tồn đầu kỳ thiết bị",
    "Khai báo thiết bị cá thể có sẵn khi bắt đầu dùng hệ thống.",
  ],
  [
    /^\/inventory\/assets\/[^/]+$/,
    "Chi tiết thiết bị",
    "Thông tin, vị trí và lịch sử của một thiết bị.",
  ],
  [
    /^\/inventory\/catalog$/,
    "Vật tư & Danh mục",
    "Danh sách vật tư, nhóm và đơn vị tính.",
  ],
  [
    /^\/inventory\/acquisitions$/,
    "Hồ sơ nguồn",
    "Hợp đồng, hóa đơn, biên bản làm căn cứ nhận kho.",
  ],
  [
    /^\/inventory\/receive$/,
    "Nhận kho",
    "Ghi nhận hàng thực nhận theo hồ sơ nguồn.",
  ],
  [
    /^\/inventory\/opening$/,
    "Tồn đầu kỳ",
    "Khai báo số dư có sẵn khi bắt đầu dùng hệ thống.",
  ],
  [
    /^\/inventory\/transactions$/,
    "Lịch sử giao dịch",
    "Mọi lần nhập, xuất, chuyển và điều chỉnh kho.",
  ],
  [
    /^\/inventory\/transactions\/[^/]+$/,
    "Chi tiết giao dịch",
    "Các dòng hàng và chứng từ của một giao dịch.",
  ],
  [
    /^\/inventory\/suppliers$/,
    "Nhà cung cấp",
    "Danh sách nhà cung cấp dùng trong hồ sơ nguồn.",
  ],
  [/^\/inventory\/locations$/, "Vị trí kho", "Kho, phòng và kệ lưu trữ."],
  [
    /^\/inventory\/operations$/,
    "Nghiệp vụ kho",
    "Điều chuyển, kiểm kê và báo hỏng.",
  ],
];

function current(pathname: string) {
  return (
    pages.find(([pattern]) => pattern.test(pathname)) ?? [
      /./,
      "Quản lý Kho & Thiết bị",
      "",
    ]
  );
}

export function InventoryShellTitle() {
  const { text } = useLanguage();
  return <>{text(current(usePathname())[1])}</>;
}

export function InventoryShellDescription() {
  const { text } = useLanguage();
  const description = current(usePathname())[2];
  return description ? <>{text(description)}</> : null;
}
