# Rà soát toàn dự án — 04/11/2026

Trạng thái: báo cáo đánh giá và đề xuất; chưa triển khai thay đổi nghiệp vụ hoặc schema.

## Kết luận

Nền tảng dự án nhìn chung hợp lý, có đầu tư vào phân quyền, kiểm tra nghiệp vụ ở database, lịch sử giao dịch và kiểm thử. Không có cơ sở để viết lại toàn bộ. Tuy nhiên, chưa nên coi dự án đã hoàn thiện: có lỗi cụ thể cần sửa, luồng kho chung chưa nối đủ hai miền, một số truy vấn/UI chưa phù hợp khi dữ liệu tăng và bằng chứng database/runtime còn thiếu.

Ưu tiên: sửa tính đúng đắn và lỗi xác nhận được → chốt thiết kế kho chung → đơn giản hóa thao tác → refactor các ranh giới thực sự cần thay đổi. Không nên tách hàng loạt file chỉ để giảm số dòng hoặc nâng dependency hàng loạt trong cùng đợt.

## Phạm vi và giới hạn

- Workspace `D:/Orca/eiu-medlabs`, nhánh `codex/pilot-deep-review-20261028`, HEAD `058014b52e5dee4f2b21af49fa02c56b9cc53c8f`.
- Kiểm kê và quét nội dung tự động 915 tệp văn bản thuộc các phần source, SQL, test, tài liệu, skill và cấu hình; nhận diện 65 entrypoint page/route. Đây không phải tuyên bố đã đọc và thẩm định thủ công từng dòng của 915 tệp. Tệp bị ignore, binary, một số định dạng và dữ liệu bên ngoài không nằm trong kiểm kê này.
- Đọc sâu các luồng đăng nhập/mật khẩu/quyền, lịch và đăng ký, quản lý nhân sự, nhập/xuất dữ liệu, kho/giao nhận, email/reconciliation, cấu hình build/release và các điểm dùng chung. Đối chiếu test và tài liệu authority/UI Master.
- Mã nguồn và các migration trong checkout không chứng minh schema đang chạy ở production giống hệt. Docker local chưa hoạt động; chưa xác nhận bằng database integration, RLS thực thi hoặc E2E có đăng nhập.
- GitNexus index cũ nên không dùng graph làm bằng chứng không có dependency. Control plane `D:/Orca/medlabs-OPs` không có trên máy; trạng thái parity DB-01 vẫn là điểm cần xác minh, không tự suy ra đã hoàn tất từ build thành công.
- Giữ nguyên các thay đổi UI Master, tracker và Figma có sẵn. Chỉ thêm báo cáo; không sửa source/schema, commit, push, deploy hoặc tác động database production.

## Bản đồ rà soát

| Phần                              | Kết quả đánh giá                                                                      | Còn cần xác minh                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Auth, mật khẩu, workspace/quyền   | Có guard và phân tách quyền; callback có lỗi kiểm tra đích chuyển hướng               | OAuth thực tế, negative test qua API/RLS, tài khoản buộc đổi mật khẩu |
| Lịch, lớp học, đăng ký và ca trực | Luồng nghiệp vụ đã có; cần phân biệt lỗi tải với rỗng và bảo đảm đọc đủ dữ liệu       | Dữ liệu vượt giới hạn API, cạnh tranh cập nhật, trải nghiệm thực tế   |
| Thiết bị và vật tư                | Có nền tảng inventory tương đối đầy đủ; Y cơ sở chưa dùng trọn engine chung           | Migration/đối soát số dư khi nối hai miền                             |
| Nhân sự và quản trị               | Có capability và cơ chế reconciliation; trang nhân sự tạo nhiều request theo số người | Độ trễ/tải thực tế và khả năng xử lý backlog                          |
| Nhập/xuất, PDF, CSV               | Có validation, kiểm soát quyền và biện pháp bảo vệ xuất dữ liệu                       | Fixture lớn và integration trên DB chạy đúng migration                |
| Email và công việc nền            | Có queue/recovery/idempotency; cần thống nhất lịch chạy và SLA                        | Tồn đọng, lỗi nhà cung cấp, cảnh báo vận hành                         |
| UI, responsive, ngôn ngữ          | Có design system và primitive dùng chung; áp dụng chưa đồng đều                       | Render trên mobile, keyboard, hành trình VI/EN                        |
| Build, test, dependency           | Typecheck/build và test chọn lọc đạt; audit dev dependency và format còn vấn đề       | DB/E2E và gate đầy đủ trước phát hành                                 |
| Tài liệu, release, ownership      | Có authority; còn tài liệu/workflow kế thừa repository cũ                             | Phân định runbook pilot với tài liệu lịch sử                          |

## Phát hiện cần xử lý

### 1. Đích chuyển hướng sau đăng nhập có thể ra ngoài tên miền

**Ưu tiên cao; đã tái hiện bằng biểu thức lấy từ source.** `app/auth/callback/route.ts:24` chỉ kiểm tra bắt đầu bằng `/` và không bắt đầu bằng `//`. Chuỗi `/\review.example/path` qua được điều kiện; `new URL(next, origin)` ở cuối callback chuẩn hóa thành `https://review.example/path`.

Điều kiện là callback đi đến nhánh đăng nhập thành công và không bị chuyển sang màn hình buộc đổi mật khẩu. Đây là open redirect; chưa có bằng chứng đánh cắp token/cookie và chưa chạy OAuth trực tiếp. Không quy kết mọi chỗ dùng `startsWith` có cùng lỗi: luồng tạo schedule còn kiểm tra pathname trước khi chuyển hướng.

**Sửa đề xuất:** phân tích URL rồi kiểm tra cùng origin tin cậy, chỉ nhận đường dẫn nội bộ hợp lệ; kiểm thử slash/backslash, đường dẫn thường và nhánh recovery/forced-password.

### 2. Tìm vật tư có thể hiển thị kết quả của từ khóa cũ

**Đã tái hiện từ callback source bằng mock bất đồng bộ.** `components/inventory/inventory-lookup.tsx:223` cập nhật rows sau mỗi response mà không kiểm tra request còn mới nhất. Tìm `a` rồi `ab`, response `ab` về trước và `a` về sau sẽ khiến UI cuối cùng hiển thị kết quả `a`.

**Sửa đề xuất:** dùng mã thứ tự request hoặc cơ chế bỏ response cũ cho cả rows/total/loading/error. Debounce giảm request nhưng tự nó không sửa được race này. Giữ nguyên giá trị đã chọn khi thay đổi kết quả tìm.

### 3. Hộp chọn vật tư có thể tràn màn hình nhỏ

`components/inventory/inventory-lookup.tsx:255` đặt chiều rộng tối thiểu 340px. Với viewport 320px và lề trái 8px, cạnh phải là 348px: tràn 28px. Đã kiểm tra phép tính từ source; chưa có bằng chứng render trình duyệt.

**Sửa đề xuất:** giới hạn chiều rộng theo viewport trừ lề; kiểm tra cả vị trí ngang/dọc, focus và chọn bằng bàn phím. Đối chiếu UI Master hiện hành thay vì dùng test cũ cho phép cuộn ngang làm bằng chứng đáp ứng thiết kế mới.

### 4. Một số trang biến lỗi truy vấn thành danh sách rỗng

Ví dụ `app/classes/open/page.tsx:51`, `app/class-schedules/page.tsx:62`, `app/dashboard/page.tsx:56` và `app/classes/mine/page.tsx:45` đọc data nhưng không xử lý lỗi tương ứng, rồi dùng mảng rỗng thay thế. Khi DB/query lỗi, người dùng có thể hiểu nhầm là không có lịch hoặc lớp.

**Sửa đề xuất:** tách trạng thái không có dữ liệu, không có quyền và tải thất bại; thêm thử lại và log có ngữ cảnh. Đây là vấn đề hiển thị/độ tin cậy, không phải bằng chứng vượt kiểm tra trùng lịch ở database.

### 5. Danh sách/lịch cần bảo đảm đọc đủ dữ liệu

`supabase/config.toml:18` giới hạn API 1.000 dòng. Một số truy vấn lịch/lớp lấy cả khoảng ngày nhưng không có phân trang hoặc cơ chế đọc hết; lớp mở cho phép khoảng tới sáu tháng. Khi kết quả vượt giới hạn hiệu lực, có nguy cơ thiếu dòng. Chưa quan sát mất dữ liệu ở production; đây là rủi ro có điều kiện từ hợp đồng truy vấn/config.

**Sửa đề xuất:** phân trang phía server cho danh sách; lịch và tổng hợp phải có hợp đồng đọc đầy đủ hoặc RPC tổng hợp phù hợp. Phân trang ở client không khôi phục được dòng server chưa trả. Cần fixture ít nhất 1.001 bản ghi cùng bộ lọc.

### 6. Kho chung và trải nghiệm giao nhận chưa hoàn thiện

Xem [báo cáo kho chi tiết](./INVENTORY_REVIEW_2026-11-04.md). Danh sách phiếu chung không đồng nghĩa một nguồn số tồn: mapping, reservation, fulfillment và worklist hiện còn giới hạn Skills Lab; Y cơ sở có luồng số lượng riêng.

**Hướng đề xuất:** một danh mục hàng thực tế và một sổ tồn chung, phân biệt đơn vị sử dụng với vị trí vật lý. Giữ lot, serial, số lượng chính xác, lịch sử và phân biệt tồn thực/khả dụng. Không gộp hoặc bỏ kiểm soát chỉ để giảm số màn hình.

Trả từng phần đã có nền tảng. UI nên cho nhập số nhận trong lần này, phân rõ còn dùng được/hỏng/tiêu hao và tự hiển thị còn phải trả. Không biến vật tư đã tiêu hao thành hàng nhập lại. Nhà cung cấp và nguồn mua có sẵn, nhưng chưa đủ để gọi là quản lý hợp đồng/chứng từ mua sắm đầy đủ. Chỉ bổ sung phạm vi thực sự cần, không mở rộng thành hệ thống kế toán.

### 7. Trang nhân sự có chi phí truy vấn tăng theo số người

`app/admin/personnel/page.tsx:69` gọi `getUserById` cho từng người, sau đó thêm truy vấn profile/capability cho từng người: khoảng 2N request bổ sung qua hai đợt. Chưa đo tải thực tế, nhưng cấu trúc N+1 có thể xác nhận từ source.

**Sửa đề xuất:** batch phần capability theo hợp đồng phân quyền hiện có; xem xét giới hạn concurrency/phan trang phần provider. Không bỏ kiểm tra trạng thái provider hoặc dùng cache quyền dài hạn để tối ưu.

### 8. Tần suất công việc nền và mô tả vận hành không thống nhất

README mô tả reconciliation nhân sự chạy mỗi giờ, nhưng `vercel.json` đặt `0 0 * * *` — mỗi ngày; email recovery cũng chạy mỗi ngày (`0 1 * * *`). Một lượt reconciliation lấy tối đa 20 mục; recovery email có batch hữu hạn. Các trigger bình thường còn xử lý email, nên không thể kết luận toàn hệ thống chỉ gửi được 25 email/ngày.

**Cải thiện đề xuất:** thống nhất SLA phục hồi, lịch chạy, batch giới hạn theo thời gian và cảnh báo backlog. Giữ idempotency và quy tắc không tự gửi lại khi provider đã thành công. Chưa tự đổi cron vì đây là quyết định vận hành.

### 9. Có cơ hội giảm tải và giảm độ phức tạp, cần đo trước khi tối ưu sâu

- `lib/viewer.ts` thực hiện auth và nhiều read/RPC; inventory layout/page gọi lại đường lấy viewer. Cân nhắc chia sẻ kết quả trong cùng request/render. Chưa đo số network request thực tế vì tầng fetch có thể đã deduplicate một phần. Không cache quyền giữa nhiều người dùng; [React cache](https://react.dev/reference/react/cache) là tham chiếu cho memoization trong Server Components theo request.
- `lib/use-schedule-realtime.ts` refresh router khi có sự kiện trên các bảng lịch/ca trực. Có thể gộp sự kiện hoặc giới hạn phạm vi sau khi đo; chưa có bằng chứng cần thêm một tầng cache lớn.
- Các file transaction detail, acquisitions, staff roster, catalog và admin actions khoảng 1.800–2.300 dòng; `globals.css` trên 11.000 dòng. Đây là tín hiệu chi phí bảo trì, không tự động là lỗi. Tách theo nghiệp vụ/form/view/action khi sửa phần đó, tái sử dụng trường create/edit; tránh tạo abstraction tổng quát chưa có nhu cầu.
- Còn native prompt/confirm và chuỗi tiếng Việt cố định, ví dụ thao tác từ chối ở `components/equipment-request-list.tsx:985`. Chuẩn hóa theo dialog và hệ thống ngôn ngữ hiện có; kiểm tra cả người dùng bàn phím. Không kết luận toàn bộ accessibility đạt từ việc đã có ConfirmDialog chuẩn.

### 10. Dependency, định dạng và tài liệu cần một đợt vệ sinh riêng

- Snapshot `npm audit` lưu cuối lượt có 21 dependency entry bị cảnh báo: 19 moderate, 2 high; high gồm brace-expansion/minimatch ở chuỗi công cụ phát triển. Audit bỏ dev dependency trả về 0. Cần xử lý tooling có chọn lọc, kiểm tra tương thích; không chạy `audit fix --force` hàng loạt. Số entry không đồng nghĩa 21 lỗ hổng ứng dụng độc lập.
- Prettier toàn workspace báo 464 tệp. Kiểm tra nội dung sau chuẩn hóa CRLF trong bộ nhớ cho thấy 436 tệp chỉ khác newline, 28 tệp còn khác định dạng. Đây không phải 464 lỗi nghiệp vụ; không suy ra CI Linux sẽ báo cùng số lượng. Không format hàng loạt snapshot bất biến, bundle sinh tự động hoặc tài liệu lịch sử.
- Authority xác định repository pilot, trong khi một số release document/workflow vẫn trỏ repository/project gốc. Workflow được thấy có manual dispatch và guard; chưa có bằng chứng tự động ghi nhầm production. Cần phân biệt rõ tài liệu tham khảo với runbook được phép thực thi cho pilot, bổ sung/kiểm tra guard đích trước lần phát hành tiếp theo.
- Hướng dẫn cổng Supabase local trong README chưa khớp cấu hình pilot. Đồng bộ tài liệu, ownership và trạng thái OpenSpec dựa trên bằng chứng, không tự mở lại task DONE.

## Những cơ chế nên giữ

- Phân quyền/capability và validation nghiệp vụ ở tầng server/database; không thay bằng kiểm tra UI.
- Ledger và lịch sử kho, phân biệt hàng theo serial/số lượng, tình trạng và chính sách trả.
- Reconciliation và idempotency cho các thao tác đi qua provider; không giản lược thành cập nhật nhiều nơi thiếu cơ chế phục hồi.
- Validation import, bảo vệ CSV, kiểm soát quyền và tính nhất quán khi xuất PDF. QR dùng dữ liệu đã ràng buộc không được quy kết thành XSS chỉ vì có `dangerouslySetInnerHTML`.
- Design system, dialog và localization hiện có; hoàn thiện việc dùng chung thay vì tạo hệ UI song song.

## Bằng chứng kiểm tra

Thư mục bằng chứng local: `D:/Orca/MedLabs-Project-Review-2026-11-04/`. Các probe là công cụ điều tra từ source, chưa phải regression test được thêm vào repository.

| Kiểm tra                                                         | Nhãn bằng chứng                           | Kết quả/giới hạn                                                         |
| ---------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| `npm run lint`                                                   | RUN AND PASS                              | 0 error, 9 warning; warning chưa được sửa                                |
| `npm run typecheck`                                              | RUN AND PASS                              | Không lỗi type                                                           |
| `npm run build`                                                  | RUN AND PASS                              | Build Next.js hoàn tất; không chứng minh DB runtime đúng                 |
| 51 tệp Node test chọn lọc                                        | RUN AND PASS                              | 234/234 test; không phải toàn bộ test suite                              |
| Probe callback, lookup race và kích thước                        | RUN AND PASS                              | Probe xác nhận ba vấn đề còn tồn tại, không có nghĩa ứng dụng đã sửa đạt |
| `npm audit --omit=dev --json`                                    | RUN AND PASS                              | 0 cảnh báo tại thời điểm chạy                                            |
| `npm audit --json`                                               | RUN AND FAIL                              | 19 moderate, 2 high theo snapshot cuối                                   |
| `prettier --check .`                                             | RUN AND FAIL                              | 436 khác newline; 28 còn khác format; không thay đổi tệp để làm xanh     |
| DB integration, migration replay/parity, pgTAP, E2E có đăng nhập | NOT RUN — BLOCKED                         | Docker engine local không sẵn sàng; chưa dùng DB khác thay thế           |
| Kiểm tra production, deploy                                      | NOT RUN — NOT REQUIRED FOR CURRENT IMPACT | Lượt này chỉ rà soát; không có thao tác phát hành                        |

Build/test chọn lọc đạt không bù cho các gate bị fail hoặc blocked. Báo cáo này hoàn tất phần rà soát source đã mô tả, không phải chứng nhận sẵn sàng phát hành hay không còn lỗi.

## Thứ tự cải thiện đề xuất

1. **Đợt sửa nhỏ:** callback URL, lookup race/viewport, phân biệt lỗi tải với rỗng. Thêm regression đúng hành vi, kiểm tra giao diện local cho phần nhìn thấy được.
2. **Đợt xác minh nền tảng:** khôi phục DB local đúng cấu hình, chạy migration/parity và negative tests RLS/quyền; bổ sung fixture vượt 1.000 dòng; xử lý dependency dev và tài liệu vận hành theo phạm vi riêng.
3. **Đợt kho chung:** lập OpenSpec cho ánh xạ danh mục hai miền, reservation/fulfillment, phân quyền và migration/đối soát số dư. Không chỉ bỏ điều kiện domain hoặc gộp bảng bằng tên hàng.
4. **Đợt đơn giản hóa giao diện:** thống nhất nhận/trả trong một hành trình theo phiếu, nhập phần phát sinh trong lần này, hiện tồn/đang giữ/còn phải trả rõ ràng; bổ sung hợp đồng/chứng từ tối thiểu theo nhu cầu thực.
5. **Đợt refactor có mục tiêu:** batch truy vấn nhân sự, chia sẻ viewer trong request nếu đo thấy lặp, tách các form/view lớn tại ranh giới đã chạm. Đo thời gian và số thao tác trước/sau.

Thay đổi xuyên miền/schema phải có thiết kế và migration được kiểm tra; thay đổi UI theo gate render/local review và chấp nhận hình thức hiện hành. Không cần chờ viết lại toàn dự án để sửa các lỗi nhỏ đã xác nhận.
