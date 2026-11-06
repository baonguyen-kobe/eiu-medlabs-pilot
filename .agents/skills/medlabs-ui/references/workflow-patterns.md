# Các mẫu giao diện nghiệp vụ

Đọc phần liên quan đến luồng đang làm. Đây là quy ước trình bày; số dòng, trạng thái và quyền cụ thể theo từng sản phẩm. Căn chỉnh bảng/badge, gutter và co giãn PC/mobile theo [layout-and-alignment.md](layout-and-alignment.md).

## Danh sách PC và thẻ mobile

- Cho biết rõ mã, nội dung chính, trạng thái, người/thành phần liên quan và lịch khi có. Ưu tiên nội dung chính hơn trường phụ. Cột có cùng vai trò phải thẳng hàng cả khi badge dài/ngắn khác nhau; đặt badge HUG trong cột có bề rộng phù hợp.
- Toàn dòng hoặc thẻ mở chi tiết khi đó là hành vi chính. Nút tài liệu, menu, checkbox có hành vi riêng không kích hoạt nhầm mở chi tiết; hỗ trợ bàn phím và tên truy cập.
- Mobile đặt mã và trạng thái ở đầu thẻ; nội dung và thành phần ở dưới. Khi chữ dài, cấp dòng riêng cho metadata thay vì ép badge cạnh text đến mất chữ.
- Nhãn lịch căn trái; khi thiếu chiều ngang, đặt nhãn trên, ngày/giờ/địa điểm dưới. Thiếu giờ hoặc địa điểm thì chỉ hiển thị giá trị thật. Ví dụ `21/10/2026 | 09:00 - B5.201`; chỉ có địa điểm thì `21/10/2026 | B5.201`; cả hai trống thì chỉ ngày. Không tạo chuỗi `Chưa xác định - Chưa xác định` ở thẻ danh sách.
- Giới hạn dòng theo loại thông tin và sản phẩm. Ellipsis phải có đường mở chi tiết để đọc đầy đủ. Không thu nhỏ chữ để đạt số dòng mong muốn.
- Phân trang: tổng 5 mục, 4 mục/trang → trang 1 hiển thị 1–4 / 5, trang 1/2; trang 2 hiển thị 5–5 / 5, trang 2/2. Khi 0 kết quả, ghi rõ trạng thái rỗng và tắt điều khiển không có tác dụng.
- Search/filter hoặc đổi số mục mỗi trang thì tính lại trang phù hợp, thông thường về trang đầu. Xóa mục cuối một trang thì lùi về trang còn dữ liệu, không để khoảng hiển thị sai hoặc một trang rỗng giả.
- Các điều khiển phân trang có vị trí và vùng bấm ổn định; nhãn tổng kết quả không xô lệch khi đổi một chữ số thành nhiều chữ số. Chuyển trang chỉ cuộn vùng danh sách về đầu theo luồng, giữ phần filter và trạng thái lọc.

## Form và combo tìm kiếm

- Nhãn trên ô nhập, dấu * đỏ sát cuối nhãn bắt buộc; dấu * không tách thành dòng riêng. Phân biệt trường có thể sửa và chỉ đọc, giữ chữ của trường chỉ đọc đủ rõ.
- Chọn đơn và nhiều là hai cấu hình khác nhau. Chọn đơn: chọn mới thay thế giá trị cũ. Chọn nhiều: chọn xong xóa từ khóa để tìm tiếp, giữ chip đã chọn. Đóng dropdown khi chọn nếu luồng không cần giữ mở.
- Chỉ cho nhập ngoài danh sách khi nghiệp vụ cho phép. Gợi ý dùng tên đầy đủ để tìm; chip và tóm tắt có thể dùng tên viết tắt do dữ liệu cung cấp. Không đoán từ viết tắt hoặc làm mất ID của lựa chọn.
- Date/time input và select co được trong mobile và popup. Soát chiều rộng thực, padding và control native, không chỉ frame Figma.
- Lỗi sát trường tương ứng, giữ dữ liệu đã nhập. Gợi ý giúp quyết định hoặc nhập đúng; bỏ câu kỹ thuật, lặp nhãn hoặc mô tả quyền không cần thiết.
- Upload nêu định dạng và dung lượng theo giới hạn backend thực tế. Tệp preview được có mắt và tải xuống; tệp không preview vẫn tải được nếu hệ thống cho phép. Không hứa preview chỉ dựa vào đuôi file; dùng khả năng và kiểm tra thực tế.

## Chi tiết và popup thao tác

- PC có thể dùng drawer; mobile dùng toàn màn hình cho nội dung dài. Header và footer hành động cố định, nội dung chi tiết cuộn độc lập. Nhãn PC như “Thành phần tham dự” và “Góp ý của lãnh đạo” đủ rộng để không xuống dòng ngoài ý muốn.
- Mã và badge trạng thái có thể cùng hàng, căn giữa theo chiều dọc. Dùng heading và khoảng cách phân nhóm thông tin; tránh lặp nhiều tầng khung trang trí.
- Popup xác nhận có mã trên, tên/nội dung yêu cầu dưới; chữ đủ rõ. Nếu có dòng tên sản phẩm phía trên, căn giữa dòng đó. Tiêu đề hành động và nội dung có thể căn trái để đọc dễ.
- Chừa khoảng trống trước nhóm nút, mặc định khoảng 20 px; nút không dính textarea hoặc date input. Chọn bề rộng popup theo nội dung, có max-height và vùng cuộn khi dài.
- X luôn truy cập được. Preview tài liệu mở trong lớp xem riêng có X, không chèn preview xuống dưới drawer/chi tiết. Đóng thì về ngữ cảnh vừa xem.

## Lịch họp

- Bộ lọc ngày và cụm `‹ Hôm nay ›` theo [time-filters.md](time-filters.md): mũi tên chuyển kỳ trước/sau, Hôm nay đưa về hiện tại, nhãn kỳ và lịch chọn ngày đồng bộ cùng dữ liệu.
- Mặc định loại lịch phục vụ mục đích chính. Với lịch công việc sắp tới, có thể ẩn hoàn thành theo bộ lọc mặc định nếu đó là quyết định sản phẩm, vẫn có cách bật lại.
- Mobile vừa chiều ngang: tháng gọn để chọn ngày, danh sách cuộc họp đọc được bên dưới; tuần có thể dùng agenda theo ngày thay lưới PC phải vuốt ngang. Chọn theo chiều cao và lượng dữ liệu.
- Giờ và địa điểm dùng `-` khi cả hai tồn tại; mã ở dòng phụ. Không dùng màu lịch thay toàn bộ nhãn trạng thái.
- Filter và checkbox có hai ý nghĩa: lọc người/đơn vị/trạng thái; bật lớp lịch chờ duyệt hoặc phạm vi tất cả người. Không để cùng nhãn mang hai nghĩa mâu thuẫn; mô tả phạm vi hiện tại rõ.
- Chi tiết từ lịch dùng cùng thông tin và quyền với trang yêu cầu. Không tạo luồng duyệt riêng vượt kiểm tra quyền chung.

## Admin và phản hồi

- Cùng shell, font, button và filter với phần nghiệp vụ. Danh mục hiện tại, tìm kiếm và thêm/sửa rõ ràng; nhiều danh mục trên mobile có thể dùng dropdown thay dãy tab vuốt ngang.
- Thẻ nhân sự cho họ tên/email đủ chiều ngang. Vai trò và badge trạng thái bên dưới khi cần; không chừa khoảng trống cố định lớn cạnh họ tên chỉ để nhét badge.
- Đang lưu/upload cần phản hồi và chặn gửi trùng. Phần trăm upload phản ánh dữ liệu hoặc tiến trình tổng đã đo; không báo 100% trước khi tiêu chí lưu của luồng hoàn tất.
- Toast trên footer/phân trang, có khoảng cách và X dễ bấm. Không đẩy cả filter xuống chỉ để thêm thông báo thành công.
- Skeleton giữ khung ổn định. Phân biệt chưa có dữ liệu, lọc không có kết quả, mất kết nối và tệp không còn tồn tại; nút khắc phục đúng nguyên nhân.
