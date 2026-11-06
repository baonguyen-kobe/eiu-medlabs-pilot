# Rà soát kho, số lượng và giao nhận — 04/11/2026

Trạng thái: báo cáo tư vấn từ mã nguồn, chưa phải thiết kế được duyệt hoặc lệnh triển khai.

## Kết luận

Nên refactor có giới hạn và hoàn thiện kết nối Y cơ sở vào Inventory hiện có. Không nên viết lại toàn bộ, cũng không nên giữ nguyên trải nghiệm hiện tại. Nền tảng số lượng có nhiều cơ chế cần thiết; sự phức tạp lộ ra quá nhiều ở màn hình và còn tồn tại hai cách quản lý tồn song song.

“Một kho” nên được hiểu là một nguồn số liệu tồn, một danh mục hàng thực tế và một bộ nghiệp vụ xuất/nhận/điều chuyển/kiểm kê. Kho trung tâm, tủ và phòng học vẫn là các vị trí vật lý. Skills Lab và Y cơ sở là phạm vi sử dụng/đăng ký, không mặc định là hai bản sao số tồn.

## Phạm vi và độ chắc chắn

- Workspace: `D:/Orca/eiu-medlabs`; nhánh `codex/pilot-deep-review-20261028`; HEAD `058014b52e5dee4f2b21af49fa02c56b9cc53c8f`.
- Đã đối chiếu source, schema, các migration tháng 10 liên quan, các test chọn lọc, UI Master và checkpoint hiện tại.
- Các thay đổi UI Master/tracker/Figma đã tồn tại trước lượt rà soát được giữ nguyên. Báo cáo này không đóng hoặc mở lại các task VERIFY.
- Đây là bản pilot đang checkout, không phải kết luận về phiên bản đang chạy production.
- GitNexus báo index cũ; không dùng graph để kết luận không có dependency. Dùng trực tiếp source.
- Control plane `D:/Orca/medlabs-OPs` được repository chỉ định nhưng không tồn tại trên máy hiện tại. Cần khôi phục hoặc xác lập lại authority trước khi chốt thiết kế schema xuyên miền. Báo cáo không thay thế authority đó.
- Chưa kiểm tra dữ liệu thật, số kho thực tế, số lượt thao tác đo bằng người dùng hoặc hiệu năng dưới tải; chưa xác nhận rendered UI hiện tại. Nhận xét UI dưới đây là bằng chứng source và đánh giá thiết kế.

## 1. Kho chung: có nền tảng, chưa hoàn tất cho hai miền

| Phần                          | Bằng chứng hiện tại                                                                               | Ý nghĩa                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Danh sách quản lý phiếu chung | `app/equipment/requests/page.tsx`, `tests/unified-equipment-operations.test.mjs`                  | Có hiển thị/lọc hai miền; không chứng minh cùng trừ tồn                        |
| Danh mục hàng kho chung       | `supabase/schemas/34_inventory_s1_foundation.sql:65`                                              | Đã có SKU, đơn vị cơ sở, cách theo dõi và chính sách trả                       |
| Ánh xạ phiếu sang hàng kho    | `supabase/schemas/37_inventory_s4_preparation.sql:19`                                             | FK hiện chỉ trỏ `equipment_catalog` của Skills, chưa trỏ danh mục Y cơ sở      |
| Chuẩn bị/giữ chỗ              | `supabase/schemas/39_equipment_reservation_engine.sql:40`, `44_equipment_preparation_reads.sql:7` | Giới hạn `nursing_skills`; miền khác chưa được bật                             |
| Hàng đợi công việc            | `supabase/schemas/65_inventory_operational_reads.sql:50`                                          | Vẫn chỉ lấy Skills                                                             |
| Cổng pilot                    | `supabase/migrations/20261004160000_inventory_p1_real_opening_gate.sql:193`                       | Cũng kiểm tra miền Skills; không thể chỉ đổi bộ lọc UI                         |
| Tồn phòng Y cơ sở             | `app/basic-medical/equipment/actions.ts:287`                                                      | Vẫn dùng `set_basic_medical_room_inventory`, cập nhật Tổng/Hư theo phòng riêng |

Migration `20261028070607_inventory_operational_readiness.sql` vẫn giữ các điều kiện Skills ở worklist, preparation command và fulfillment read. OpenSpec `inventory-operational-v1/proposal.md` cũng chủ động loại Basic Medical cutover khỏi phạm vi trước đây. Đây là phần tích hợp còn thiếu, không phải lý do xây một hệ thống kho mới.

Đề xuất thiết kế:

1. Giữ thông tin lịch, buổi học, môn và người phụ trách riêng theo miền; dùng chung đường xử lý nhu cầu → chuẩn bị → giao → nhận trả.
2. Một hàng thực tế có một SKU kho. Danh mục phục vụ đăng ký có thể là tên nghiệp vụ/alias có ánh xạ rõ sang SKU; không tự gộp theo tên gần giống. Quy đổi đơn vị phải được kiểm tra và lưu bằng chứng.
3. Bổ sung mapping Y cơ sở và cập nhật đầy đủ command/read/permission/pilot guards, không bỏ kiểm tra quyền để vượt chặn miền.
4. Sau cutover, màn hình “thiết bị theo phòng” đọc tồn theo vị trí từ kho chung. Không cho đồng thời sửa Tổng/Hư cũ và ghi sổ Inventory cho cùng số hàng.
5. Thiết bị cố định tại phòng giữ semantics `in_place`; không tạo xuất–trả giả cho mỗi buổi học. Dụng cụ di động dùng returnable; vật tư tiêu hao dùng nonreturnable.
6. Tồn phòng cũ phải được đối chiếu thực tế và kiểm tra đã có trong Inventory hay chưa trước khi lập số dư chuyển đổi. Không cộng thẳng hai nguồn vì có thể đếm đôi.

## 2. Quản lý số lượng: giữ lõi, làm rõ cách đọc

Các điểm hợp lý cần giữ:

- Phân biệt đăng ký, kế hoạch, thực giao, đã nhận lại và nghĩa vụ còn trả.
- Phân biệt tồn thực tế, đủ điều kiện và khả dụng; hàng hỏng/hết hạn/đang giữ không đồng nghĩa có thể giao.
- Tách theo số lượng và theo từng tài sản/serial; không ép mọi vật tư thành tài sản cá thể.
- Giữ lô, xuất xứ, hạn dùng, vị trí, lịch sử và giao dịch sửa sai; không sửa trực tiếp một số tổng rồi mất dấu.
- Số thập phân chính xác, version/retry, khóa giao dịch và kiểm tra số còn trả tồn tại trong source. Không bỏ các cơ chế này chỉ để giảm dòng mã.
- Không cộng số lượng khác đơn vị vào một KPI tổng.

Đáng chú ý: `52_equipment_fulfillment_commands.sql:64` giải phóng toàn bộ reservation khi giao lần đầu. Phần chưa giao không tiếp tục được giữ. Đây là chính sách hiện hành đã được ghi trong OpenSpec, không tự đổi thành giữ đến cuối buổi. UI cần nói rõ để thủ kho biết lần bổ sung phải kiểm tra khả dụng lại.

Màn hình tồn nên ưu tiên Tên hàng, Đơn vị, Tồn thực, Giữ chỗ, Khả dụng; tình trạng không cấp được và chi tiết lô mở khi cần. Đây là đề xuất trình bày, không phải công thức lấy Tồn thực trừ Giữ chỗ cho mọi hàng: còn phải tính eligibility và hold theo engine hiện hữu.

Không có bằng chứng từ source để kết luận đang có quá nhiều **kho vật lý**. Có bằng chứng đang có quá nhiều cửa vào và mô hình tồn song song. Hàng hỏng/đang giữ nên là trạng thái; chỉ tạo một vị trí riêng nếu ngoài thực tế có nơi chứa riêng.

## 3. Nhận lại sau sử dụng

Hiện tại đã có nhập số của từng lần nhận: `components/equipment-fulfillment-workspace.tsx:344` gửi `return_entry_mode: incremental` cho recover. `components/fulfillment-return-preview.tsx` hiển thị lần này, sau nhận và còn phải trả. Không cần làm lại khả năng trả nhiều lần.

`49_equipment_fulfillment_returns.sql` kiểm tra dòng được phép trả, không trả vượt thực giao, tách tốt/hỏng, ghi tăng tồn thực nhận và xử lý trả muộn. Hàng đã có hậu quả hành chính có thể cần giữ chờ đối soát; nhận hàng không tự xóa lịch sử xử lý. Trả hỏng vẫn giảm nghĩa vụ trả nhưng không biến thành hàng tốt sẵn sàng cấp.

Điểm còn rối ở UI: vùng `equipment-fulfillment-workspace.tsx:669` yêu cầu chọn từng phần thực giao, nơi nhận, tình trạng, số lượng rồi thêm dòng. Tốt và hỏng của cùng hàng phải nhập qua các dòng riêng; danh sách lựa chọn có thể hiện ID cùng `resolve`, `hold`. Điều này tăng thao tác theo số phần giao và tình trạng, dù phép tính phía sau đã hợp lý.

Luồng đề xuất:

1. Mở phiếu cần thu hồi từ Công việc; hệ thống hiện các hàng còn có thể nhận.
2. Mỗi hàng có Đã giao, Đã nhận, Còn trả và hai ô **Tốt / Hỏng của lần này**. Mặc định nơi nhận theo ngữ cảnh, cho đổi khi thực tế khác.
3. Bấm Xem trước, kiểm tra chênh lệch rồi Nhận trả. Giữ việc ghi nhận vật lý và chữ ký theo contract hiện hành; không thêm bước nhập kho độc lập cho cùng lần trả.
4. Phân bổ xuống issue slice/lô bên dưới. Khi có nhiều nguồn, serial hoặc quy tắc phân bổ chưa xác định, yêu cầu chọn rõ; không tự ghép chỉ theo tên hàng.
5. Sửa sai, xử lý không thu hồi, hậu quả hành chính và đối soát đưa vào nhóm ngoại lệ có quyền phù hợp. Vẫn có lịch sử và đường truy cập.

Ví dụ dụng cụ tái sử dụng: giao 10; nhận lần đầu 6 tốt + 1 hỏng → đã nhận 7, còn trả 3; nhận sau thêm 2 tốt → còn 1. Nhập “2” cho lần sau, không phải “9”.

Phân biệt ba việc: nhập mua mới, thu hồi dụng cụ, và ghi nhận tiêu hao. Vật tư đã tiêu hao không nhập lại. Vật tư tiêu hao còn nguyên chưa sử dụng muốn hoàn kho cần một chính sách và nghiệp vụ riêng gắn lần xuất, lô, chất lượng và hạn dùng; code nhận trả hiện tại từ chối dòng nonreturnable. Không dùng Nhận kho mua mới hoặc Kiểm kê để lách việc này. Thiết bị cần vệ sinh/tiệt khuẩn trước dùng lại cũng là yêu cầu cần xác nhận riêng: source hiện không chứng minh có workflow đó.

## 4. Giao diện và thao tác

| Điểm quan sát                                                                                            | Đánh giá và cải thiện                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/workspace-shell.tsx:383` có 10 mục kho cho Staff, thêm Tồn đầu kỳ cho Admin                  | Gom cửa vào thành Công việc, Tồn kho, Nhập hàng, Hồ sơ, Danh mục; đặt khởi tạo/kiểm kê/ngoại lệ theo ngữ cảnh và quyền. Giữ deep link cũ khi chuyển dần                            |
| `components/inventory/stock-table.tsx:333` có bảng 11 cột và bảng lô mở tiếp                             | Dùng bảng tổng hợp ngắn; xem lô trong chi tiết. Mobile đổi sang bản ghi dọc, giữ đủ dữ liệu                                                                                        |
| Bảng stock dùng `overflow-x-auto`, text-xs và header 11px riêng                                          | Có lệch source so với UI Master hiện hành; phải kiểm tra computed style/render khi sửa. Master cấm cuộn ngang tới 920px; CSS fulfillment riêng chỉ có breakpoint 640px cho padding |
| `components/inventory/operations-hub.tsx` có “Bách phân vị”, “Bounded”, phiên bản kho                    | Bỏ thuật ngữ kỹ thuật khỏi đường làm việc thường ngày, chỉ giữ trong chi tiết hỗ trợ                                                                                               |
| `components/equipment-fulfillment-workspace.tsx` hiện “Nguồn và mapping”, “resolve”, “hold”, “base unit” | Dùng tên nghiệp vụ rõ nghĩa, diễn giải nơi cần; không bắt thủ kho hiểu schema                                                                                                      |
| Hồ sơ nguồn và Nhận kho là hai thao tác riêng                                                            | Hợp lý về dữ liệu: lưu chứng từ không tăng tồn. Nên nối UI bằng Nhập hàng từ hồ sơ, tự điền dòng hàng/đơn vị/quy đổi, không bắt nhập lại                                           |
| Kiểm kê có cảnh báo đổi vị trí và `beforeunload`                                                         | Có cải thiện; persistent draft và bảo vệ navigation nội bộ chưa hoàn tất theo tasks hiện hành. Ưu tiên nếu kiểm kê dài                                                             |

Đánh giá này không thay thế UAT. Cần render desktop và mobile ở các kích thước trong UI Master, thử nội dung dài và nhiều dòng giao/nhận. Bản Figma đang VERIFY chưa đồng nghĩa source đã áp dụng.

## 5. Danh mục và hồ sơ còn thiếu gì?

| Nhu cầu                                           | Hiện trạng                                                                           | Đề xuất                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Nhà cung cấp                                      | Đã có tên, mã số thuế, liên hệ, ghi chú, active, lịch sử                             | Giữ; bổ sung liên hệ/địa chỉ tách trường chỉ khi cần tra cứu/báo cáo                                            |
| Loại hàng, đơn vị, quy đổi, vị trí                | Đã có nền tảng                                                                       | Tái sử dụng, làm gọn nơi quản trị                                                                               |
| Nguồn mua sắm/tài trợ                             | Có số tham chiếu, nhà cung cấp, ngày, nguồn kinh phí, tham chiếu ngoài               | Giữ và làm rõ tên/loại hồ sơ                                                                                    |
| Dòng mua, đơn giá, hãng, model, xuất xứ, bảo hành | Đã có trong acquisition_record_lines                                                 | Không tạo lại các danh mục chỉ để sao chép những trường này                                                     |
| Hợp đồng đầy đủ                                   | Chưa thấy model độc lập với vòng đời, phụ lục, tài liệu và giao hàng nhiều đợt       | Nếu cần quản lý hồ sơ tại đây, mở rộng từ acquisition; chốt quan hệ trước, không giả định mọi nguồn là hợp đồng |
| Chứng từ đính kèm                                 | Có ghi chú/tham chiếu; chưa thấy hệ thống tệp hồ sơ kho trong phạm vi source rà soát | Ưu tiên tệp hợp đồng, hóa đơn, nghiệm thu, bảo hành với quyền truy cập và liên kết đúng hồ sơ                   |
| Thanh toán/công nợ                                | Chưa thấy phân hệ nghiệp vụ                                                          | Không xây ERP kế toán nếu không có yêu cầu; trước mắt liên kết tham chiếu hệ thống tài chính                    |
| Bảo trì/hiệu chuẩn                                | Có asset lifecycle/state và thông tin bảo hành; chưa thấy lịch nghiệp vụ đầy đủ      | Bổ sung sau nếu thiết bị cần quản lý kỳ hạn và biên bản                                                         |

“Đã có Hồ sơ nguồn” không có nghĩa “đã có quản lý hợp đồng hoàn chỉnh”. Schema `34_inventory_s1_foundation.sql:110–154` cho thấy phạm vi hiện có cụ thể; mô tả màn hình có nhắc hợp đồng nhưng chưa thay thế được các nghiệp vụ trên.

## 6. Refactor và tối ưu kỹ thuật

- Ưu tiên mở rộng engine hiện hữu cho miền Y cơ sở; không dựng engine thứ hai rồi đồng bộ số tổng.
- `components/inventory/acquisitions-view.tsx`: form tạo/sửa nguồn và tạo/sửa dòng có phần trường/validation lặp lại. Tách bộ trường nguồn và bộ trường dòng mua dùng chung, giữ command và revision riêng. Không dựng generic form framework.
- `components/equipment-fulfillment-workspace.tsx`: tách màn nhận trả và thao tác ngoại lệ theo nghiệp vụ; giữ chung xử lý command/retry hiện có. Tránh chỉ chia file theo số dòng mà vẫn truyền quá nhiều state qua lại.
- `components/inventory/receive-form.tsx:66`: props tương thích cũ là ứng viên xóa sau khi kiểm tra toàn bộ consumer/test. Consumer production tìm được hiện truyền `initialSources`, `initialSourceLines`, `preselectedSourceId`; không cần giữ hai API mãi nếu không còn nơi dùng.
- Giữ truy vấn phân trang/bounded, exact decimal, immutable events, replay key, revision và authorization. Không thay bằng client cộng/trừ tồn.
- Chưa có số đo latency/query plan/tải đồng thời: không kết luận DB chậm hoặc đổi cơ chế writer lock trong lượt này. Đo trước nếu xuất hiện hàng đợi thao tác; lock hiện phục vụ tính toàn vẹn.
- Không ước lượng số dòng cắt bỏ hoặc phần trăm nhanh hơn khi chưa có diff/benchmark.

## 7. Thứ tự triển khai đề xuất

1. **Chốt phạm vi kho chung và dữ liệu chuyển đổi:** kiểm kê nguồn tồn hiện có, SKU trùng, đơn vị, phòng, quyền hai miền, phiếu đang mở. Khôi phục/reconcile control plane; lập OpenSpec cho cross-domain cutover.
2. **Làm gọn UI trên behavior hiện tại:** nhận trả theo bảng, ưu tiên công việc, thuật ngữ, mobile, nối Nhập hàng từ hồ sơ. Tận dụng rule UI Master đã duyệt, không tự chốt thiết kế Figma còn VERIFY.
3. **Nối Y cơ sở:** mapping có ràng buộc, domain-aware commands/reads/guards, cùng nguồn tồn; giữ thiết bị tại chỗ và các quyền riêng. Migration diễn tập, rollback/cutover theo phạm vi; ngăn hai writer cho một số tồn.
4. **Hồ sơ và vận hành:** chứng từ đính kèm/hợp đồng vừa đủ, draft kiểm kê; sau đó mới xem xét bảo trì, định mức và cảnh báo bổ sung.

Tiêu chí nghiệm thu bắt buộc cho kho chung: hai miền tranh cùng hàng không giữ/giao vượt khả dụng; quyền không bị mở rộng; không đếm đôi tồn phòng; đúng đơn vị; hàng cố định không tạo xuất–trả giả; trả nhiều lần tốt/hỏng không cộng trùng khi retry; sửa sự kiện không sửa lịch sử đã ký; hàng không đủ điều kiện không được cấp lại; legacy request vẫn đọc được. Luồng hoàn vật tư tiêu hao chưa dùng phải có hợp đồng nghiệp vụ riêng nếu được đưa vào phạm vi.

## 8. Kiểm chứng lượt này

- **RUN AND PASS** — `node --test tests/inventory-quantity-preview.test.mjs tests/equipment-operations-routing.test.mjs tests/unified-equipment-operations.test.mjs`: 7/7. Gồm tính chính xác preview, routing và source contracts cho phiếu chung; không chứng minh giao dịch DB xuyên miền.
- **NOT RUN — NOT REQUIRED FOR CURRENT IMPACT** — build, toàn bộ check và integration DB: chỉ thêm báo cáo, không sửa runtime/schema. Không dùng PASS cũ để khẳng định backend hiện tại đã được kiểm thử lại.
- **NOT RUN — NOT REQUIRED FOR CURRENT IMPACT** — rendered/visual acceptance: không có thay đổi UI trong lượt này. Vì chưa chạy nên chỉ đưa đánh giá source, chưa kết luận UI đạt hay không đạt trên trình duyệt.
- Tiêu chuẩn review UI bổ sung: [Vercel Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md); UI Master của dự án vẫn là authority.

Không sửa tính năng, không đổi schema/dữ liệu, không commit/push/deploy. Đây là phương án cụ thể để chọn phạm vi cải thiện tiếp theo, không phải tuyên bố đã hoàn thành refactor.
