# MedLabs Calendar — Lịch học và lịch trực

Ứng dụng nội bộ quản lý lịch học, giảng viên nhận lớp và staff tự đăng ký ca trực.

## Tài liệu và hướng dẫn vận hành

- **Engineering & OMP Workflow:** `AGENTS.md` và `docs/DOCUMENTATION_AUTHORITY.md`.
- **Lựa chọn Skill:** `SKILLS.md`.
- **UI Modernization & Tiếp tục:** `docs/ui-modernization/README.md`.
- **Quy trình Release & Production:** `docs/RELEASE.md` và `docs/PRODUCTION_DEPLOYMENT.md`.

## Yêu cầu

- Node.js 22.13 trở lên
- npm
- Docker Desktop đang chạy

## Khởi động local

```powershell
npm.cmd install
npx.cmd supabase start
powershell.exe -ExecutionPolicy Bypass -File scripts/seed-local-users.ps1
npm.cmd run dev
```

Mở:

- Ứng dụng: http://localhost:3000
- Supabase Studio: http://127.0.0.1:54323
- Mailpit: http://127.0.0.1:54324

## Tài khoản mẫu

| Vai trò/capability                     | Email                        | Mật khẩu                  |
| -------------------------------------- | ---------------------------- | ------------------------- |
| Admin + Staff + Giảng viên + import    | admin@campus.local           | LocalAdmin123!            |
| Giảng viên                             | giangvien@campus.local       | LocalLecturer123!         |
| Staff                                  | staff@campus.local           | LocalStaff123!            |
| Giảng viên + `can_import_schedules`    | importer@campus.local        | LocalImporter123!         |
| Staff + `can_import_schedules`         | dieuphoi@eiu.edu.vn          | LocalCoordinator123!      |
| Trợ giảng                              | trogiang@campus.local        | LocalAssistant123!        |
| Trợ giảng + `can_import_schedules`     | trogiang.import@campus.local | LocalAssistantImport123!  |
| Personnel Manager local                | bao.nguyen@eiu.edu.vn        | LocalPersonnelManager123! |
| Admin thường (test phân quyền nhân sự) | admin.other@campus.local     | LocalOtherAdmin123!       |

Các mật khẩu trên chỉ dùng cho local development.

## Database

Declarative schema được nạp theo `supabase/config.toml` từ toàn bộ file
`supabase/schemas/*.sql` theo thứ tự tên. Lịch sử triển khai versioned nằm trong
`supabase/migrations/`; không xem riêng `01_app.sql` hoặc initial migration là
trạng thái database hiện hành.

Kiểm tra toàn bộ migration và seed từ đầu:

```powershell
npx.cmd supabase db reset --local
powershell.exe -ExecutionPolicy Bypass -File scripts/seed-local-users.ps1
```

## Kiểm tra chất lượng

Các lệnh kiểm tra chất lượng được phân chia theo rủi ro và phạm vi thay đổi (chi tiết xem `.agents/skills/medlabs-verification-gate/SKILL.md`):

| Loại task                                 | Kiểm chứng local                                                                                                                   | Khi cần mở rộng                                                                                                          |
| :---------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| **Docs / skills / routing**               | Đọc link, command, path thực tế; kiểm tra inventory và scenarios; kiểm tra format file sửa (`npx.cmd prettier --check <files>`)    | Không chạy app/DB suite chỉ vì thay đổi Markdown                                                                         |
| **Pure logic / server helper**            | `node --test --test-concurrency=1 tests/<affected>.test.mjs` và smoke thực tế; `npm.cmd run typecheck` khi đổi contract TypeScript | Shared dependency hoặc uncertain impact → mở rộng kiểm tra consumers                                                     |
| **UI component / layout**                 | Rendered browser scenario cho path thay đổi, kiểm tra viewport và focus liên quan; `npm.cmd run typecheck` khi TypeScript thay đổi | `npm.cmd run test:e2e:required` cho a11y scope; không chạy full E2E cho mỗi chỉnh spacing                                |
| **Auth / RLS / RPC / schema / migration** | Local isolated Supabase và DB regression liên quan; replay migration khi đổi chain; `npm.cmd run test:db` khi có DB impact         | Giữ security negative cases và data integrity; independent review theo mức độ rủi ro                                     |
| **Integration / delivery**                | Chạy CI theo cấu hình; không lặp lại toàn bộ suite local nếu evidence trước đó vẫn còn giá trị                                     | Full E2E (`npm.cmd run test:e2e`) cho release candidate, major integration, cross-cutting change, hoặc khi có yêu cầu rõ |
| **Build / runtime deployment config**     | `npm.cmd run build`, sau đó `npm.cmd run test:e2e:production-smoke:run`                                                            | Standalone `npm.cmd run test:e2e:production-smoke` đã bao gồm build; không build hai lần                                 |
| **Production**                            | Theo quy trình `docs/RELEASE.md`; kiểm tra live app SHA và lịch sử migration remote                                                | Không coi local production-bundle smoke là live Vercel smoke                                                             |

### Điều kiện tiên quyết và lưu ý chạy test:

- **Prerequisites:** Dependencies đã cài (`npm install`), local Supabase đang chạy (`npx.cmd supabase start`), seed dữ liệu đầy đủ (`scripts/seed-local-users.ps1`), và Docker Desktop hoạt động.
- **Database reset:** `npx.cmd supabase db reset --local` chỉ dùng trên local disposable target khi cần replay migration chain; tuyệt đối không reset production.
- **Tuần tự hóa:** Không chạy các bộ test làm thay đổi DB đồng thời (`npm test`, `npm run test:db`, Playwright mutating tests) trên cùng một local stack.
- **E2E suite:** `npm.cmd run test:e2e:required` là bộ smoke kiểm tra accessibility bắt buộc (`tests/e2e/accessibility-smoke.spec.ts`). `npm.cmd run test:e2e` là bộ full-local (theo `playwright.full-local.config.ts`, bỏ các specialist specs được chạy riêng). `npm.cmd run test:e2e:evidence-off` và `npm.cmd run test:e2e:production-smoke` là các bài test ở các môi trường khác nhau, không phải bài test trùng lặp.
- **Advisory audit:** `npm.cmd run react-doctor:audit` là công cụ audit tư vấn kiến trúc/performance React khi có refactor lớn, không bắt buộc chạy cho mỗi chỉnh sửa JSX hoặc nhãn nhỏ.

## Biến môi trường

Tạo `.env.local` với `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` và `SUPABASE_SECRET_KEY` do
`supabase status` cung cấp. Secret key chỉ được đọc ở server để Admin
tạo tài khoản hoặc đổi email đăng nhập.

Không đưa secret key hoặc service role key vào biến `NEXT_PUBLIC_*`.

### Email thông báo nghiệp vụ

Thông báo được ghi vào bảng hàng đợi sau khi nghiệp vụ lưu thành công, rồi
Vercel gọi Google Apps Script ngay. Thành công được ghi `sent`, lỗi được ghi
`failed`; Admin/Chuyên viên có thể mở **Email thông báo** để bấm **Gửi lại**.
Khi triển khai, cấu hình:

```text
NEXT_PUBLIC_APP_URL=https://ten-mien-noi-bo.example
EMAIL_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
EMAIL_APPS_SCRIPT_SECRET=...
```

Xem mã nguồn script tại `scripts/apps-script-email-webhook.gs` và cấu hình biến môi trường bên dưới (đây là implementation reference, không phải hướng dẫn cài đặt bên ngoài).

### Personnel reconciliation

Vercel Cron gọi `/api/internal/personnel-reconciliation` mỗi giờ. Cấu hình
`CRON_SECRET` riêng cho production; Vercel tự gửi secret qua header
`Authorization: Bearer <CRON_SECRET>`. Theo dõi response `inspected`,
`committed`, `rolledBack`, và `reconciliationRequired`. Cấu hình alert Vercel
Logs cho event `personnel.reconciliation.manual_action_required`.

Khi có operation cần xử lý thủ công, Root đối chiếu `profiles.email` với Auth,
giữ profile inactive đến khi hai nguồn khớp, sau đó resolve operation bằng
service workflow và lưu lại reconciliation log. Không dùng client để tự sửa
Auth/Profile trong lúc operation còn mở.

### Đăng nhập Google cho email EIU

Luồng OAuth và kiểm tra tên miền `@eiu.edu.vn` đã có sẵn. Để bật Google ở local:

1. Tạo OAuth Web Client trong Google Cloud, thêm callback
   `http://127.0.0.1:54321/auth/v1/callback`.
2. Tạo file `.env` ở thư mục dự án với
   `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` và
   `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET`.
3. Đổi `enabled = true` tại `[auth.external.google]` trong
   `supabase/config.toml`, rồi chạy lại `npx.cmd supabase stop` và
   `npx.cmd supabase start`.

Tham số Google `hd=eiu.edu.vn` chỉ hỗ trợ chọn đúng tài khoản. Ứng dụng vẫn
kiểm tra email tại callback và database tự vô hiệu hóa hồ sơ Google ngoài tên
miền để bảo vệ dữ liệu ngay cả khi callback bị bỏ qua.

## Template import

Sau khi đăng nhập bằng admin hoặc tài khoản có quyền nhập lịch:

- `/schedule-entry/import`
- Template CSV: `/api/import-template/csv`
- Template XLSX: `/api/import-template/xlsx`

Template gồm đầy đủ mã phòng và mã tòa nhà để đối chiếu `room_id`.
Template hiện dùng 10 cột: `schedule_date`, `start_time`, `end_time`,
`course_code`, `course_name`, `room_code`, `building_code`,
`lecturer_email`, `lecturer_name`, `note`.

`source_row_id`, `class_code` và `lecturer_employee_code` không xuất hiện trong
template. `class_code` được giữ nullable trong database để tương thích nhưng
Version 1 luôn ghi `null` và không hiển thị.

## Các màn hình chính

- `/dashboard`: tổng quan gọn, KPI và các việc sắp tới theo vai trò.
- `/class-schedules`: lịch tháng/tuần/danh sách, dùng một cột “Buổi” cố
  định bên trái cho bốn hàng học sáng, học chiều, trực sáng và trực chiều.
- `/classes/open`: xem toàn bộ lớp theo khoảng tối đa 6 tháng; nhận, trả hoặc
  xóa theo vai trò.
- `/classes/mine`: Giảng viên xem hoặc rút lớp của chính mình.
- `/staff-shifts`: lịch trực theo tuần/tháng/danh sách (mặc định tuần), ca của tôi và
  lịch cố định. Staff chỉ tự đăng ký/hủy ca của chính mình.
- `/schedule-entry/new`: tạo lịch thủ công và sử dụng ngay.
- `/schedule-entry/import`: import CSV/XLSX tối đa 500 dòng, preview, kiểm tra
  trùng và tải file lỗi.
- `/imports`: lịch sử các phiên import.
- `/admin/catalogs`: đầu mối truy cập các danh mục quản trị.
- `/admin/courses`: danh mục môn học.
- `/admin/rooms`: danh mục phòng.
- `/admin/personnel`: trạng thái tài khoản và nhiều vai trò.
- `/admin/shift-templates`: mẫu ca trực.
- `/admin/audit`: nhật ký thay đổi nghiệp vụ.

## Code navigation & tri thức mã nguồn

- **Graphify:** Knowledge graph nằm trong `graphify-out/`. Đây là artifact tham khảo lịch sử tùy chọn; không bắt buộc phải tồn tại hay tự động refresh cho mọi task.
- **GitNexus:** Công cụ phân tích cấu trúc, blast radius và luồng thực thi tùy chọn (xem `.omp/skills/gitnexus-code-intelligence/SKILL.md`).
- **Quyền tài liệu:** Các hợp đồng nghiệp vụ, phân quyền và kiến trúc hệ thống hiện hành được định nghĩa tại `docs/DOCUMENTATION_AUTHORITY.md`.

## Ghi chú chạy preview trên Windows

Nếu `next dev` gặp lỗi HMR/hydration khi workspace nằm trong đường dẫn có dấu,
dùng production preview:

```powershell
npm.cmd run build
npm.cmd run start -- -p 3000
```

Đây cũng là chế độ đang được dùng cho bản local đã kiểm thử cuối cùng.

## CI runner và ngân sách

- **Runner mặc định:** CI chính (`.github/workflows/ci.yml`) sử dụng GitHub-hosted runner `ubuntu-latest`. Quản trị viên theo dõi usage/quota trực tiếp trong GitHub billing; không áp dụng quota threshold tự động hay auto-switch ngầm.
- **Chuyển đổi thủ công sang self-hosted khi cần tiết kiệm quota:**
  1. Kiểm tra runner self-hosted tin cậy (Linux x64, có Docker daemon, PowerShell `pwsh`, Node/npm, browser dependencies) có đủ các labels: `self-hosted`, `linux`, `x64`, `eiu-medlabs-ci`. Tuyệt đối không đưa code từ untrusted fork lên máy self-hosted.
  2. Trong `.github/workflows/ci.yml`, sửa trường `jobs.verify.runs-on` thành danh sách 4 labels trên. Không bỏ bớt các bước kiểm tra hay gates an toàn. Thao tác này cần Git delivery được ủy quyền như thay đổi code khác.
- **Khôi phục GitHub-hosted:** Đổi `runs-on` trở lại `ubuntu-latest` khi quota phù hợp. Workflow `full-e2e.yml` tự động kế thừa vì gọi lại `ci.yml`.
- Nếu runner không khả dụng: CI sẽ ở trạng thái queued/unavailable; không tự động chuyển runner hoặc đánh dấu CI pass khi chưa chạy.
