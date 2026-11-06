---
name: medlabs-ui
description: Build or change any MedLabs page, component or style so it stays consistent with the rest of the app. Use for new pages, forms, tables, lists, drawers, badges, responsive fixes and UI reviews.
---

# MedLabs UI

Mọi giá trị hiển thị nằm trong `docs/UI_DESIGN_SYSTEM_V2_MASTER.md`, Section 0A.
Skill này là quy trình làm việc; không chép giá trị vào đây. Khi có mâu thuẫn, Master
thắng. Nghiệp vụ, quyền và dữ liệu luôn đứng trên quy tắc giao diện.

## Trước khi viết code

1. Đọc Section 0A. Đọc thêm mục family liên quan trong Master nếu có.
2. Mở page cùng loại đang đúng chuẩn: Personnel cho bảng, Tạo lịch Skills cho form.
3. Liệt kê class và component dùng chung sẽ dùng (bảng 0A.2).
4. Thiếu gì thì sửa class hoặc component dùng chung, rồi ghi vào 0A.2. Không tạo
   biến thể riêng cho một page.

Không lấy `components/inventory` và `staff-shift-roster` làm mẫu cho đến khi được
chuyển đổi.

## Chữ và ngôn ngữ

- Mọi chữ giao diện đi qua `useLanguage` hoặc `LocalizedText`, khóa là tiếng Việt, và
  thêm bản EN vào `lib/i18n/messages`. Không viết nhãn kiểu `Việt / English`.
- Nhãn, tiêu đề cột, tab và nút tối đa hai từ; câu giải thích để trong chú thích.
- Tên người, dữ liệu, mã và tài liệu đã ký giữ nguyên, không dịch.

## Khung một page

Theo 0A.4: `PageHeader`, KPI nếu có, toolbar lọc, bảng hoặc thẻ dọc, phân trang.
Từ 920px trở xuống không có cuộn ngang và không giấu trường dữ liệu.

## Cần đủ trạng thái

Đang tải, chưa có dữ liệu, lọc không ra kết quả, lỗi tải có thử lại, đang lưu, đã lưu.
Lỗi tải không bao giờ hiển thị thành danh sách rỗng.

## Tự kiểm trước khi bàn giao

Chạy trên file đã sửa và file mới; kết quả phải rỗng:

```powershell
git ls-files -m -o --exclude-standard '*.tsx' | ForEach-Object { Select-String -Path $_ -Pattern 'text-xs|text-\[[0-9.]+px\]|font-mono|dark:|<table(?![^>]*data-table)|(text|bg|border|ring|divide)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|green|emerald|teal|sky|blue|indigo|violet|purple|rose)-[0-9]' }
```

Sau đó:

- Xem bản render ở 1440, 1024, 920, 390 và 320 px: không tràn ngang, không control bị cắt.
- Thử nhãn VI và EN dài, dữ liệu dài, 0 kết quả, trạng thái lỗi.
- Thử bàn phím: focus thấy rõ, Escape đóng lớp phủ, focus trở về đúng chỗ.
- Thay đổi nhìn thấy được giữ VERIFY cho đến khi chủ dự án chấp nhận.

## Tài liệu kèm theo

Hướng dẫn chung, đọc đúng phần cần; Master thắng khi khác nhau:

- `references/layout-and-alignment.md`: co giãn, lề, bảng, badge, form, overlay.
- `references/workflow-patterns.md`: danh sách, form, popup, lịch, Admin.
- `references/time-filters.md`: bộ lọc thời gian và cụm `‹ Hôm nay ›`.

Quy tắc sản phẩm của UniCouncil (vai trò, trạng thái, số dòng mỗi trang) không áp dụng
cho MedLabs.
