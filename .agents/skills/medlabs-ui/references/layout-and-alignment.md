# Bố cục co giãn và căn chỉnh giao diện

Áp dụng cho giao diện nghiệp vụ PC/mobile. Dùng token và component hiện có; các kích thước tham khảo bên dưới là mặc định để bắt đầu khi chưa có quyết định riêng. Quy tắc gutter nằm trong [SKILL.md](../SKILL.md); các luồng cụ thể trong [workflow-patterns.md](workflow-patterns.md).

## Co giãn cả PC và mobile

- Dùng container theo chiều rộng khả dụng. Khi cửa sổ PC đổi từ rộng sang hẹp, nội dung tự tính lại sau sidebar và gutter, không giữ nguyên chiều rộng 1440 px hoặc dùng scale/zoom toàn trang để giả responsive.
- Trong flex/grid, phần nội dung co được bằng `min-width: 0` hoặc track tương đương `minmax(0, 1fr)`. Kiểm tra chiều rộng cộng cả padding, gap, border, icon và scrollbar; không chỉ so tổng chiều rộng text.
- Cột dữ liệu dài nhận không gian linh hoạt; cột mã, badge, ngày, chọn và thao tác có độ rộng tối thiểu hợp lý. Đừng đặt min-width lớn lên cả bảng rồi để nó đẩy tràn trang.
- Breakpoint dựa trên lúc nội dung không còn vừa: toolbar chuyển hàng/nhóm, form giảm số cột, sidebar thu gọn thành menu, bảng đổi thẻ khi cần. Không chỉ kiểm tra nhãn “PC” hay “mobile” theo thiết bị.
- Mặc định không có cuộn ngang ở trang, toolbar, danh sách và thẻ trên mọi kích thước hỗ trợ. Với ma trận dữ liệu thật sự cần rộng, chỉ dùng vùng cuộn cục bộ nếu nhiệm vụ chấp nhận trường hợp đó; không tự thêm ngoại lệ vào app đã chốt không vuốt ngang.
- Sửa nguyên nhân tràn. Không dùng `overflow-x: hidden` trên toàn trang, cắt text hoặc tắt zoom để giấu control nằm ngoài khung. Chuỗi email/URL/tên tệp dài cần wrap phù hợp hoặc ellipsis có cách xem đầy đủ.
- Màn hình rất rộng: dùng hết không gian hữu ích của bảng; chỉ đặt max-width/căn giữa khi nó cải thiện việc đọc. Form không cần kéo ô nhập dài hết màn hình nếu gây khó theo dõi.
- Với danh sách có header/filter/footer cố định, chỉ vùng dòng/thẻ cuộn. Nếu header bảng sticky thì nằm đúng dưới toolbar; phần đầu nội dung không bị lớp sticky phủ mất. Khi bàn phím/zoom làm chiều cao quá thấp, dùng bố cục gọn hoặc cuộn phù hợp để mọi điều khiển vẫn truy cập được.

## Lề và khoảng cách

- Gutter trái/phải bằng nhau, bắt đầu sau sidebar. Tiêu đề trang trong vùng nội dung, KPI, filter, bảng, empty state và pagination theo cùng trục ngoài; một thành phần lệch lề phải có lý do thiết kế.
- Container chỉ có một nơi quản lý gutter. Bên trong thẻ/panel dùng padding riêng, thường 16–24 px trên PC và 12–16 px trên mobile; không cộng lại gutter vào từng cấp con.
- Các cột và nhóm form dùng gap theo cùng scale token. Khoảng cách trong một nhóm nhỏ hơn khoảng cách giữa các nhóm. Khi đổi kích thước, thay token/bố cục có chủ đích, không bù bằng margin âm hoặc tọa độ tuyệt đối.
- Đường viền, nền, radius và shadow phân tầng nhẹ: không tạo nhiều lớp thẻ lồng nhau chỉ để phân cách nội dung. Giữ cùng kiểu bề mặt cho các màn hình có cùng vai trò.
- Dành vùng an toàn cho footer, toast, nút đóng và nội dung sát mép thiết bị. Tránh gutter bị nhân đôi hoặc bị mất khi chuyển bảng thành thẻ.

## Header bảng và các dòng dữ liệu

| Thành phần                | Mặc định                                                      |
| ------------------------- | ------------------------------------------------------------- |
| Chữ tiêu đề cột           | Căn trái, căn giữa theo chiều dọc vùng header                 |
| Nội dung ô dữ liệu        | Căn trái, thẳng trục chữ với header cùng cột                  |
| Ô một dòng trong bảng gọn | Căn giữa dọc, cùng quy tắc toàn bảng                          |
| Ô nhiều dòng              | Có thể căn trên để dễ đọc; giữ nhất quán trong bảng           |
| Badge trong ô             | Căn giữa nội bộ, đặt đầu cột theo lề của cột                  |
| Nhóm thao tác             | Cột riêng có bề rộng ổn định; không trôi theo chiều dài badge |

- Header và body dùng cùng schema/colgroup/grid tracks, cùng padding-inline và gap. Không dùng `space-between` để mỗi hàng tự tính vị trí cột theo nội dung của hàng đó.
- Trục chữ đầu tiên của header trùng trục chữ đầu tiên của ô bên dưới. Nếu ô có avatar/icon, dùng cùng vị trí bắt đầu của vùng dữ liệu và kiểm tra riêng trục text; đừng thêm khoảng trống tùy ý chỉ ở một vài dòng.
- Header có icon sắp xếp nằm cạnh nhãn với gap nhỏ; icon xuất hiện khi hover hoặc đổi chiều không đẩy cả cột lệch vị trí. Trạng thái sắp xếp phải nhận biết được khi không hover.
- Mặc định cả số và text đều căn trái theo quy ước này. Chỉ đổi căn phải/giữa cho một cột khi sản phẩm yêu cầu rõ (ví dụ số tiền); header và dữ liệu cột đó cùng quy tắc. Checkbox/icon-action có thể đặt giữa cột hẹp riêng nếu được thiết kế nhất quán.
- Badge luôn căn giữa nội bộ dù ô căn trên hoặc trái. Với danh sách yêu cầu nhiều dòng, mã và badge có thể ở đầu dòng như thiết kế đã chốt, không tự chuyển badge ra giữa chiều cao hàng.
- Dòng có thể tăng chiều cao để giữ nội dung cần đọc; nếu dùng chiều cao cố định, tính đủ padding và số dòng đã cho phép. Dùng line-clamp/ellipsis có chủ đích, không cắt chữ bằng chiều cao ngẫu nhiên.
- Nếu header và body cuộn tách vùng, tính cả chỗ scrollbar của body để hai vùng không lệch cột. Có thể dùng chung bảng/khung cuộn với header sticky hoặc giữ gutter scrollbar đồng bộ.
- Hover, selected và focus của dòng phải phân biệt được; màu nền nhẹ không làm mất tương phản badge/text. Dòng không click được không giả dạng nút. Dòng mở chi tiết hỗ trợ bàn phím và không xung đột các nút con.

## Badge, chip và icon

- Badge dùng inline-flex/auto-layout, căn giữa ngang và dọc. Padding trên/dưới bằng nhau, line-height rõ, chấm/icon không co méo. Không canh bằng khoảng trắng trong chuỗi, margin lệch hoặc tọa độ riêng cho từng nhãn.
- Nếu có chấm/icon, căn giữa **cả nhóm icon + chữ** trong badge; chữ vẫn ở giữa theo chiều dọc. Chấm, chữ, viền/nền dùng semantic token cùng trạng thái.
- Badge trạng thái giữ một dòng và đọc đủ nhãn khi có thể. Ưu tiên HUG/chiều rộng theo nội dung; nếu quá dài thì cấp thêm chỗ hoặc đưa sang dòng riêng, không cắt mất ý nghĩa trạng thái để giữ thẻ nhỏ.
- Cùng loại badge có cùng chiều cao, padding, radius và cỡ chữ. Nếu cần bề rộng bằng nhau cho cột trạng thái, chọn đủ cho nhãn dài/ngôn ngữ hỗ trợ; vẫn căn giữa nội bộ.
- Chip filter có X với vùng bấm rõ, không làm cả chip lệch tâm; chip nhiều lựa chọn có thể wrap theo hàng. Chip không có hành vi thì không tạo cảm giác bấm được.
- Icon cùng family, stroke và kích cỡ theo vai trò, thường 18–20 px trong vùng bấm khoảng 44 px. Icon-only button có tên truy cập; tooltip bổ trợ cho PC, không phải cách duy nhất để hiểu thao tác trên mobile.
- Không dùng emoji hoặc icon từ nhiều bộ lẫn lộn thay cho các biểu tượng hành động đã có.

## Chữ, nhãn và nút

- Phân cấp chữ bằng kích thước và weight có giới hạn: body/metadata/label từ 14 px, input mobile từ 16 px, section thường 18–20 px, heading PC khoảng 28–32 px và mobile khoảng 18–20 px. Theo font/tokens dự án và quy tắc tối thiểu trong SKILL.md.
- Text dài để wrap tự nhiên theo loại nội dung; dòng mã/ngày ngắn hoặc nhãn nút được ưu tiên một dòng. Không giảm cỡ chữ dưới chuẩn để né wrap. Số đếm dùng chữ số có độ rộng ổn định khi cần để tránh nhảy layout.
- Chữ, icon và spinner trong nút căn giữa ngang/dọc; gap và padding thống nhất. Nút cùng nhóm có cùng chiều cao; nếu xếp dọc trên mobile, chiếm chiều rộng hợp lý và giữ thứ tự hành động dễ hiểu.
- Nhóm có một nút chính, nút phụ và nguy hiểm phân biệt rõ. Không biến mọi nút thành primary. Trạng thái loading giữ nhãn/ý nghĩa và bề rộng ổn định, chặn gửi trùng; spinner không làm nút nhảy kích thước.
- Vùng bấm có thể lớn hơn icon/chữ; không giả disabled chỉ bằng màu nhạt. Control disabled thực sự không thực hiện hành động và lý do phải nhận biết được khi cần.
- Header trang, toolbar và footer có chiều cao/padding thống nhất giữa các page; không ép text lớn vào khung thấp khiến bị cắt dấu tiếng Việt.

## Form, search, dropdown và combobox

- Nhãn và ô nhập thẳng trục trái; các field cùng hàng dùng cùng khoảng cách nhãn–control và chiều cao control, thường từ 44 px với input/select/button. Textarea hoặc multi-select được phép cao hơn khi nội dung cần.
- Bắt buộc có nhãn thật, không dùng placeholder làm nhãn duy nhất. Dấu * đỏ gắn sát cuối nhãn; gợi ý và lỗi nằm dưới đúng field, căn theo control. Trường read-only vẫn đọc rõ; không làm nó mờ đến giống dữ liệu không tồn tại.
- Icon đầu/cuối input, nút X, mắt và caret có vùng riêng trong padding; text không chui xuống dưới icon. Prefix/suffix không làm nhãn hoặc giá trị lệch hàng so với field khác.
- Toolbar PC có thể chia search rộng hơn, filter vừa nội dung, action ổn định. Khi hẹp, wrap theo nhóm có ý nghĩa; không chia ô search còn vài ký tự chỉ để giữ mọi thứ một hàng.
- Search có cách xóa từ khóa, trạng thái đang tìm/không có kết quả phù hợp. Khi tìm trên server, debounce vừa đủ theo luồng và bỏ response cũ; không thay thành việc đợi lâu cho mọi thao tác. Không đặt timeout để giả phản hồi.
- Popup dropdown bám đúng field, không rộng tràn viewport. Đổi phía trên/dưới khi thiếu chỗ; giới hạn chiều cao danh sách và cho cuộn dọc bên trong. Không bị bảng/drawer cắt bởi `overflow`; dùng cơ chế overlay/portal phù hợp framework.
- Chọn nhiều giữ chip và ô gõ tìm tiếp; chip wrap, X không đè text. Chọn đơn không vô tình giữ nhiều mục. Có trạng thái hover/focus/selected, điều hướng bàn phím, Escape đóng và click ngoài xử lý nhất quán.
- Dữ liệu nhiều dùng search hoặc tải theo trang phù hợp; không mở dropdown khổng lồ vượt màn hình. Không chỉ dựa vào hover để hiện thao tác cần dùng trên cảm ứng.
- Trong combobox, Enter chọn mục đang focus theo luồng của component; không vô tình submit cả form. Trạng thái mở/đóng, loading và không có gợi ý phải nhận biết được mà không làm mất lựa chọn đã nhập.

## Điều hướng, tabs và thống kê

- Sidebar dùng cùng vị trí logo, workspace và tài khoản trên các page. Item hiện tại nhận biết được bằng cả kiểu trình bày và nhãn, không phụ thuộc hover; nội dung theo quyền thực của role.
- Sidebar thu gọn hoặc chuyển menu khi thiếu chiều rộng; menu mobile có X/cách đóng rõ, không đẩy cả nội dung ra ngoài màn hình. Mở/đóng không làm mất vị trí hoặc bộ lọc đang dùng.
- Tabs đồng nhất chiều cao, padding và cách đánh dấu active. Nếu không vừa mobile, dùng nhóm xuống hàng có chủ đích hoặc dropdown; không bắt người dùng cuộn ngang để thấy một mục quan trọng.
- Thẻ KPI cùng hệ thống chiều cao, padding, vị trí nhãn và giá trị; số không thêm 0 ở đầu. Dùng màu theo ý nghĩa, không gán màu ngẫu nhiên từng thẻ. Nhãn dài được cấp chỗ mà không ép nhỏ chữ hoặc làm lệch hàng thống kê.
- Logo/ảnh giữ tỷ lệ, không kéo méo để lấp khoảng trống. Dành kích thước ổn định cho asset đang tải để tránh đẩy nội dung sau khi tải xong.

## Card, dialog, drawer và phản hồi

- Card có padding nhất quán, heading/metadata cùng trục. Không đặt badge phủ lên tên dài. Khi không đủ chỗ, cho metadata xuống dòng hoặc thay bố cục, giữ ưu tiên nội dung.
- Dialog có max-width theo nội dung, chiều rộng nằm trong viewport trừ gutter; không dùng width cứng làm tràn mobile. Nội dung dài cuộn, header/X và hành động vẫn truy cập được. Drawer có giới hạn chiều rộng PC, mobile có thể toàn màn hình.
- Tiêu đề và phần mô tả của dialog mặc định căn trái. Dòng tên sản phẩm nếu có căn giữa theo quy ước popup. Các trường, summary và footer theo cùng lề trong; khoảng trước nhóm nút theo mẫu popup, không dính control.
- Khi mở overlay, nền không cuộn ngoài ý muốn; đóng thì trả đúng vị trí và focus. Thứ tự lớp rõ: menu/tooltip, drawer, dialog và preview tài liệu không che mất X hoặc hành động của lớp đang dùng. Không tăng z-index rải rác vô hạn để vá lỗi.
- Thông báo lỗi quan trọng nằm gần nội dung gây lỗi; thành công ngắn gọn. Toast không che nút, phân trang hoặc bàn phím, thích ứng safe area. Không chỉ dùng màu để báo lỗi/thành công.
- Component có trạng thái cần thiết: default, hover nếu có con trỏ, focus-visible, active/pressed, selected, disabled, loading, error và success theo chức năng. Focus thấy rõ, thứ tự tab hợp lý; giảm chuyển động khi người dùng có thiết lập đó. Chuyển trạng thái không làm nội dung nhảy đột ngột.

## Kiểm tra trước khi bàn giao

- Soát vài kích thước đại diện PC 1024/1280/1440/1920 px, tablet 768 px và mobile 320/360/390/430 px khi phù hợp phạm vi hỗ trợ; kéo thay đổi liên tục giữa chúng. Thử cả màn hình thấp, sidebar mở/đóng, browser toolbar và bàn phím.
- Kiểm tra gutter trái/phải, trục header–body, badge/icon/nút căn giữa nội bộ, cột thao tác không xê dịch và footer không chạy lên theo số dòng ít.
- Thử nhãn tiếng Việt dài, ngôn ngữ khác được hỗ trợ, email/URL/tên tệp không có khoảng trắng, badge dài, 0 kết quả, nhiều dòng và nhiều chip. Không chỉ dùng dữ liệu ngắn để chứng minh bố cục vừa.
- Khi triển khai, đo vùng bị tràn và kiểm tra ảnh render thực tế; phân biệt clipping có chủ đích của vùng cuộn với control bị cắt ngoài ý muốn. Thử keyboard, focus, touch scroll và zoom; không lấy một ảnh Figma làm bằng chứng đã đúng trên thiết bị.
