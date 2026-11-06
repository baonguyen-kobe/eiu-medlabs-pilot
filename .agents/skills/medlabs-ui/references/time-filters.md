# Bộ lọc thời gian và cụm ‹ Hôm nay ›

Áp dụng cho danh sách và lịch có điều hướng thời gian. Dùng chung trạng thái ngày/khoảng ngày giữa nút, lịch, filter, nhãn kỳ và dữ liệu; giữ ý nghĩa trường ngày theo nghiệp vụ hiện hành.

## Cụm điều hướng chính

Mẫu mặc định:

```text
[ ‹ ] [ Hôm nay ] [ › ]   04/11/2026       [ lịch ]
```

- `‹`: về ngày trước; `›`: sang ngày sau khi đang ở chế độ ngày. Không tự bỏ qua ngày không có dữ liệu.
- **Hôm nay là nút đưa về hiện tại** theo múi giờ sản phẩm. Nhãn nút giữ “Hôm nay”, không làm người dùng hiểu nhầm rằng mọi ngày đang xem đều là hôm nay.
- Nhãn ngày/khoảng ngày đang xem nằm cạnh cụm hoặc ở dòng bên dưới nếu mobile thiếu chỗ. Ngày khác hiện ngày cụ thể; tuần hiện khoảng ngày; tháng hiện tháng/năm.
- Chế độ tuần: mũi tên chuyển một tuần, Hôm nay về tuần chứa hôm nay. Chế độ tháng: mũi tên chuyển một tháng lịch, Hôm nay về tháng chứa hôm nay. Tránh cộng cố định 30 ngày để chuyển tháng.
- Cho biết rõ chế độ Ngày/Tuần/Tháng hoặc đơn vị điều hướng nếu màn hình có nhiều chế độ. Nếu app chỉ dùng lọc ngày thì không thêm chuyển chế độ không cần thiết.
- Nhấn nhãn kỳ hoặc icon lịch mở bộ chọn ngày/khoảng ngày. Không gán nút Hôm nay đồng thời hai nghĩa mở picker và đặt lại ngày.
- Khi chọn ngày trong picker, cập nhật ngày neo và chuyển đúng kỳ của chế độ đang xem. Khi đổi chế độ, giữ ngày neo có ý nghĩa thay vì tự nhảy về hiện tại; nút Hôm nay vẫn là đường về rõ ràng.
- Khi chọn “Tất cả ngày”, tắt/ẩn điều hướng trước/sau vì không có kỳ để dịch. Khoảng tùy chỉnh chỉ có điều hướng nếu sản phẩm đã định nghĩa rõ bước dịch; không tự suy đoán bước đó.

## Chọn nhanh và lịch chọn khoảng ngày

- Cung cấp những preset có ích theo màn hình: Tất cả ngày, Hôm nay, Ngày mai, Tuần này, Tháng này, Tùy chọn. Không buộc mọi màn hình phải hiển thị toàn bộ preset.
- Preset, lịch và nhãn đang lọc phản ánh cùng giá trị. Sau khi bấm mũi tên ra khỏi kỳ preset, không giữ chip “Hôm nay” hoặc “Tháng này” sai với dữ liệu đang xem.
- Picker có điều hướng tháng/năm, đánh dấu hôm nay riêng với ngày đang chọn. Với khoảng ngày, thể hiện rõ ngày đầu, ngày cuối và phần ở giữa; hỗ trợ chọn từ một ngày đến chính ngày đó.
- Trường Từ ngày/Đến ngày có nhãn rõ, không cho áp dụng khoảng chưa hợp lệ. Lỗi ngày kết thúc trước ngày bắt đầu hiển thị sát trường; giữ dữ liệu để sửa. Giới hạn ngày quá khứ/tương lai chỉ theo nghiệp vụ, không tự cấm.
- Preset có thể áp dụng ngay nếu đó là hành vi nhất quán của màn hình. Với khoảng tùy chỉnh nhiều bước, giữ bản nháp trong picker và dùng **Áp dụng**; đóng/X/Hủy bỏ bản nháp, giữ bộ lọc đang áp dụng.
- **Đặt lại** về mặc định đã chốt của sản phẩm, không mặc nhiên là Tất cả ngày hoặc Hôm nay. Đổi lọc thời gian thì đưa phân trang về trang đầu, tính lại số đếm theo cùng bộ lọc.
- Giữ các bộ lọc khác như trạng thái, lãnh đạo, đơn vị khi chỉ đổi thời gian. Hiển thị rõ lọc trên ngày tạo yêu cầu hay ngày họp; không âm thầm đổi trường ngày được dùng.

## PC, mobile và tương tác

- Cụm mũi tên/Hôm nay/nhãn kỳ ở phần điều khiển cố định phía trên vùng nội dung cuộn. Không để đổi ngày làm header hoặc phân trang nhảy vị trí.
- PC có thể dùng popover lịch; mobile dùng popover vừa khung hoặc bottom sheet. Chỉ dùng một hay hai tháng cạnh nhau khi đủ chiều ngang; không bắt mobile vuốt ngang để chọn ngày.
- Nhãn kỳ dài được xuống dòng ở dòng riêng; cụm `‹ Hôm nay ›` vẫn gọn, dễ bấm. Giữ chữ từ 14 px, input từ 16 px, icon nhất quán và vùng chạm phù hợp; không thu nhỏ chữ để ép vừa.
- Hai mũi tên có tên truy cập “Ngày trước/Ngày sau”, “Tuần trước/Tuần sau” hoặc “Tháng trước/Tháng sau” đúng chế độ. Các ô lịch dùng được bằng bàn phím, trạng thái chọn/focus không chỉ dựa vào màu. Đóng picker thì trả focus về nút mở.
- Ngày không có cuộc họp vẫn có thể chọn, hiển thị trạng thái rỗng đúng ngày/kỳ. Chấm lịch biểu thị có dữ liệu, không thay cho trạng thái chọn ngày.

## Ranh giới thời gian và kiểm tra

- Dùng ngày lịch và múi giờ của sản phẩm nhất quán cho “hôm nay”, đầu tuần và khoảng ngày; đầu tuần theo quy ước locale/sản phẩm. Không lấy ngày UTC hoặc ngày của server làm mặc định nếu khác ngày người dùng đang làm việc.
- Khoảng ngày hiển thị bao gồm cả ngày kết thúc. Nếu API dùng mốc thời gian, có thể truy vấn từ đầu ngày bắt đầu đến trước đầu ngày sau ngày kết thúc theo múi giờ đúng; không tự đổi hợp đồng API đang có.
- Kiểm tra chuyển cuối tháng/năm, tháng có số ngày khác nhau, năm nhuận, một ngày đơn lẻ và ngày/kỳ rỗng. Chuyển nhanh nhiều lần thì kết quả cuối phải khớp kỳ cuối, không để response cũ ghi đè.
- Kiểm tra mũi tên trong từng chế độ, nút Hôm nay khi đang ở kỳ khác, chọn picker, hủy bản nháp, áp dụng, đặt lại, giữ bộ lọc khác và phân trang sau khi đổi ngày.
