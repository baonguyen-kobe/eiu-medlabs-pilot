# EIU MEDLABS UI DESIGN SYSTEM V2 — MASTER

Status:
USER-APPROVED UI AUTHORITY

Canonical path:
docs/UI_DESIGN_SYSTEM_V2_MASTER.md

Last updated:
2026-10-28

---

# 0. AUTHORITY, INHERITANCE, AND GOVERNANCE

## 0.1 Precedence

When rules conflict, apply this order:

```text
1. Existing business/security requirements
2. Global UI Master
3. Component / Family Master
4. Approved Page Override
5. Approved production visual when this Master is silent
6. Existing implementation / legacy CSS
7. Generic UI/UX recommendations
```

The first four levels are defined in this document. A lower level cannot
weaken a higher level unless the higher level explicitly permits that override.

## 0.2 Classification and inheritance

### Level 1 — Global UI Master

Use for application-wide visual contracts: tokens, typography, layout,
controls, focus, table shell behavior, table body safe inset, and responsive
overflow rules.

### Level 2 — Component / Family Master

Use for repeated component families: Data Tables, catalog actions/imports,
toolbars, calendars, Personnel management, and dialogs/drawers. Family rules
inherit Global UI Master rules.

### Level 3 — Approved Page Override

Use only for a page's information architecture, semantic columns, or
explicitly approved action arrangement. A Page Override changes only the rule
it names. It still inherits global and family rules such as table shell,
header alignment, body safe inset, typography, focus, and responsive behavior.

## 0.3 Design decision placement

When the user approves a UI correction:

```text
1. Classify it: Global, Component / Family, or Page Override.
2. Update this canonical Master at that level first.
3. Implement the UI.
4. Add or update regression coverage.
5. Report the rule and the affected scope.
```

Do not turn every correction into a page-specific CSS exception. Do not create
another competing Master. This document records design intent and measurable
contracts, not selector accidents.

## 0.4 Business-logic firewall

This Master does not define authorization, role permissions, database or RPC
behavior, state transitions, email/outbox rules, or migration behavior. When a
UI depends on such a rule, it may reference the existing business requirement
without redefining it.

---

# 1. DESIGN DIALS — FINAL

## Application language — owner correction, 2026-10-28

The application supports an explicit VI/EN selector and defaults to Vietnamese
when no valid preference exists. Display one selected language at a time;
stacked or slash-separated Vietnamese/English labels are not the language UI.
Apply the preference to static interface copy across the application, including
visible and accessible labels. Persist it across navigation and reloads without
resetting an in-progress form, filter, preparation lock or retry intent.

Translate presentation only. Names, catalog/course data, notes, stored
notifications, signed snapshots and historical records retain their original
content. Codes, enum values, URLs, import formats and canonical date/quantity
payloads do not change with locale. Business time remains Asia/Ho_Chi_Minh.

Place the selector in shared authenticated chrome and on authentication screens;
use keyboard-operable buttons with a clear selected state and visible focus.
The language selector itself may show VI and EN together as choices.

## Inventory operational presentation — 2026-10-28

Under the owner's approved Inventory implementation plan, the outer WorkspaceShell owns the page h1 and sticky topbar. Inventory child headings use a normal-flow h2 and contextual actions, inheriting existing tokens and controls.

Receiving presents quantity for this visit, good/damaged condition, current obligations and a readable review of the complete event. Original demand, planned quantity, actual issue and received quantity remain distinct. Signing presents readable immutable event facts and snapshot identity; technical JSON is secondary detail. These presentation rules do not change signer authorization, physical posting, reservation policy, or completion rules. Rendered implementation stays VERIFY until user visual acceptance.

```text
Variance: 2 / 10
Motion:   2 / 10
Density:  7 / 10
```

Ý nghĩa:

- UI rất đồng bộ.
- Motion rất nhẹ.
- Admin/data-heavy, gọn nhưng không ép chữ nhỏ.
- Page mới phải tái sử dụng shared pattern.

---

# 2. BRAND MASTER

## Font

```text
Be Vietnam Pro
```

Fallback:

```css
"Be Vietnam Pro", "Segoe UI", system-ui, sans-serif
```

## Brand direction

```text
EIU Blue + Gold + Cream
```

Core colors:

```text
EIU Blue      #144069
EIU Gold      #A78656
EIU Cream     #F6F1E8
Canvas        #F8F6F1
Surface       #FFFFFF
Ink Primary   #303033
Danger        #B44425
Success       #52813B
Warning       #D88327
```

Component mới nên dùng semantic token thay vì hardcode brand hex trực tiếp khi có thể.

---

# 3. TYPOGRAPHY MASTER

Recommended semantic roles:

```text
Page title       clamp(27px, 2vw, 32px) / 1.2 / 750
Section title    16px / 1.35 / 800
Card title       15px / 1.4 / 700
Body             14px / 1.5 / 400-500
Table body       14px / 1.4 / 400-600
Table header     13px / 1.35 / 700
Field label      13px / 1.4 / 600-700
Button           14px / 1.2 / 600-700
Metadata         13px / 1.45 / 400-500
Caption          12px / 1.4 / 400-600
```

Rules:

- Không dùng 8px cho content bình thường.
- Không giảm font để “nhét” table.
- Dữ liệu số/ngày/giờ nên dùng tabular numerals khi phù hợp.

---

# 4. SPACING MASTER

Scale:

```text
4 / 8 / 12 / 16 / 24 / 32 / 48 px
```

Desktop guideline:

```text
Page gutter          ~32px
Major section gap    24–32px
Card padding         20–24px
Toolbar gap          8–12px
Field vertical gap   12–16px
```

Không thêm random spacing 13/17/23px nếu không có lý do layout rõ.

---

# 5. RADIUS MASTER

```text
Control radius     10px
Card/Table radius  15px
Dialog/Drawer      16px
Badge/Pill         999px
```

Outer component sở hữu radius và clipping.

Không để child tạo radius chỉ để vá visual.

---

# 6. SIDEBAR MASTER — FINAL

Giữ visual production đã được user duyệt.

## Desktop shell

```text
width: 244px
padding: 22px 14px 16px

background:
linear-gradient(
  180deg,
  #173F64 0%,
  #102F4D 62%,
  #0C2944 100%
)
```

## Logo

```text
height: 62px
background: #FFFFFF
border-radius: 12px
padding: 8px 10px
shadow: 0 10px 24px rgba(0,0,0,0.20)
```

## MedLabs Calendar

```text
font-size: 21.5px
font-weight: 800
line-height: 1.2
letter-spacing: -0.025em
color: #FFFFFF
```

## Group heading / Mục lớn

Ví dụ:

```text
KỸ NĂNG ĐIỀU DƯỠNG
TẠO PHIẾU
QUẢN LÝ LỚP
QUẢN LÝ PHÒNG
Y CƠ SỞ
QUẢN TRỊ
```

FINAL TO-BE:

```text
font-size: 14px
font-weight: 800
letter-spacing: 0.06em
text-transform: uppercase
color: #D9C49E
```

## Menu item / Mục nhỏ

```text
font-size: 12px
font-weight: 500
```

## Active menu item

```text
font-size: 12px
font-weight: 700

height: 42px
padding: 0 12px
border-radius: 11px

color: #144069
background: #FFFFFF

box-shadow:
inset 4px 0 0 #A78656,
0 8px 18px rgba(0,0,0,0.12)
```

Rules:

- Mục lớn phải lớn/đậm hơn mục nhỏ.
- Không bỏ gold left accent.
- Không đổi Sidebar thành flat blue.
- Chỉ chuẩn hóa spacing, không redesign visual identity.
- Brand/logo, product title, and the first navigation group must occupy
  separate vertical space. They must not overlap, clip, or be pulled together
  with negative margins, transforms, or absolute positioning.

---

# 7. PAGE HEADER / TOPBAR MASTER — FINAL

Áp dụng cho toàn bộ page trong WorkspaceShell.

## Shell

```text
min-height: 82px
padding: 16px 30px

background:
rgba(255,255,255,0.94)

backdrop-filter:
blur(14px)

position: sticky
top: 0
z-index: 35
```

Không dùng:

```text
min-height: 106px
padding: 24px 32px 18px
background: rgba(248,246,241,0.92)
```

Header của mọi page phải là **trắng**, không vàng nhạt.

## Page title

```text
font: Be Vietnam Pro
color: #144069
font-size: clamp(27px, 2vw, 32px)
font-weight: 750
line-height: 1.2
letter-spacing: -0.025em
margin: 0
```

## Subtitle

```text
font-size: 14px
color: #68686B
margin-top: 4px
```

Dashboard:

```text
Hôm nay 14/08/2026
```

Không hiển thị:

```text
· Xin chào ...
```

---

# 8. KPI CARD MASTER

Current production KPI card là chuẩn.

Giữ:

- white card
- subtle border
- subtle shadow
- left accent
- icon tile
- title
- large value

Rules:

- same row → same height
- same spacing
- same icon geometry
- same label/value typography

---

# 9. FORM MASTER — TẠO LỊCH SKILLS

`Tạo lịch Skills lab` là Form Master.

Structure:

```text
01 SECTION
title
helper
fields

02 SECTION
...

03 SECTION
...

Footer
Hủy | Primary action
```

## Section Number Badge — FINAL

```text
min-width: 34px
height: 30px
padding-inline: 7px

display: grid
place-items: center

background: #E5EDF5
color: #144069
border-radius: 9px

font-size: 16px
font-weight: 800
```

Không đổi thành circle/pill xanh đậm với số trắng.

## Section Heading — FINAL

```text
color: #144069
font-size: 16px
font-weight: 800
line-height: 1.35
gap với badge: 9px
```

## Field contract

```text
Label
Control
Helper text / optional
Inline error / optional
```

States:

```text
default
hover
focus
filled
read-only
disabled
error
```

---

# 10. DROPDOWN / SELECT FOCUS MASTER

Khi focus dropdown/select:

**chỉ có một viền focus cho toàn bộ control.**

Không được có:

```text
outer border
+
inner blue border/ring
```

Required:

- một focus boundary rõ
- no nested double border
- vẫn keyboard accessible
- visual giống production: một control = một viền focus

Nếu wrapper đã vẽ border thì native/select inner element không được vẽ thêm border/outline riêng.

---

## Global one-control-one-visual-shell rule

Một composite control chỉ có **một** visual-shell owner. Chỉ wrapper đã sở
hữu chrome (border, radius, background, padding hoặc icon/chevron layout) được
vẽ control shell và focus boundary.

For those wrappers:

- the wrapper owns border, radius, background, and the visible
  `:focus-within` boundary;
- its child native `input`, `select`, or `textarea` resets border,
  border-radius, outline, box-shadow, and background in both base and focused
  states;
- keyboard focus remains visible on the wrapper; a child must never regain a
  second focus ring through `:focus` or `:focus-visible`;
- standalone native controls keep the shared native `:focus-visible` rule and
  remain their own visual shell.

Applies to shared chrome-owning families such as search fields, icon inputs,
data search, filter/select shells, role switchers, class range modes,
equipment date filters, and searchable combobox controls. This is a shared
control contract, not a page-specific override.

`class-range-dates` is intentionally different: it is only a layout group.
Its start and end date inputs remain independent native control shells with
their own focus boundaries; the group must not add a combined `:focus-within`
ring.

Canonical visual contract:

```text
one control → one visual border/radius/background → one visible focus boundary
```

---

# 11. FILTER / TOOLBAR CONTROL MASTER — FINAL

Áp dụng cho cùng một filter row.

## Height

```text
height: 44px
min-height: 44px
box-sizing: border-box
border-radius: 10px
```

Áp dụng cho:

- Search
- Select/dropdown
- Date input
- Xóa bộ lọc
- Filter action button cùng cấp

Không để cùng hàng tồn tại:

```text
39px / 42px / 44px
```

## Alignment

- top edge thẳng nhau
- bottom edge thẳng nhau
- vertical center đồng nhất
- `Xóa bộ lọc` phải thẳng hàng với select/date/search

## Width

- các dropdown cùng cấp: equal width
- search có thể wider có chủ đích
- reset/count compact
- không layout tự do

---

# 12. INLINE COUNT LABEL MASTER

Áp dụng cho:

```text
1/1 phiếu
5/5 thiết bị
19 lớp
22 nhân sự
...
```

Wrapper:

```text
height: 44px
display: inline-flex
align-items: center
justify-content: center
```

Rules:

- vertical-center với control bên cạnh
- không lệch lên/xuống
- consistent baseline
- không custom padding theo page

---

# 13. TABLE MASTER — CRITICAL

Table shell, textual header alignment, body-cell safe inset, and responsive
local-scroll behavior are Global UI Master contracts. A family or page may
override semantic column meaning, content intent, or an explicitly approved
action arrangement; it does not replace these shared table contracts.

## Structure

```text
DataTableShell
├── FilterBar / optional
├── BulkActionBar / optional
├── TableScrollViewport
│   └── DataTable
├── EmptyState / optional
└── Pagination / optional
```

## Outer shell

Chỉ một lớp sở hữu:

```text
border
border-radius: 15px
shadow
background
clipping
```

Inner scroll viewport chỉ scrolling.

Không `shell inside shell`.

## Canonical Table Shell Ownership — BUG-UI-TABLE-RIGHT-EDGE-001

Personnel production table is the visual reference for a Data Table's right
edge, continuous border, rounded corners, and header/body coverage. This is a
visual-shell reference only; it does not prescribe Personnel columns or
business layout for other table families.

Every Data Table family has exactly one visual shell owner. The visual shell
owns border, border-radius, background, clipping, and any shadow. It may own
horizontal scrolling when the DOM permits it.

An optional inner scroll viewport is permitted only for scrolling. It must not
own a second border, radius, card background, shadow, or fake right padding.
Its equivalent contract is:

```text
width: 100%
max-width: 100%
overflow-x: auto
border: 0
border-radius: 0
background: transparent
padding-right: 0
scrollbar-gutter: auto
```

The table fills the available visual shell with `width: 100%`; use an
intentional `min-width` only when content requires local horizontal scrolling.
Header and body cells must terminate at the same right edge as the rounded
shell. Do not introduce a blank column, spacer, pseudo-element, width mismatch,
or nested visual shell that leaves a reserved white strip.

## Rounded corners

- bo kín cả 4 góc
- border continuous
- header cream clip đúng radius
- no square leak

## Header full width

Header background phải phủ đến mép phải thật sự.

Không có white gutter.

## Scrollbar gutter

For Data Table:

```text
scrollbar-gutter: auto
```

Không dùng:

```text
stable
stable both-edges
```

nếu reserve khoảng trắng.

## Page overflow

```text
Page horizontal overflow: FORBIDDEN
Table local horizontal scroll: ALLOWED
```

---

# 14. TABLE HEADER ALIGNMENT MASTER — FINAL

All textual Data Table headers:

```text
text-align: left
vertical-align: middle
padding: 14px 16px
font-size: 13px
font-weight: 700
white-space: nowrap
```

Canonical rule: all textual column headers are LEFT-aligned and start at the
same horizontal inset as their corresponding body content. Do not globally
center textual headers. Selection/checkbox columns and intentionally unlabeled
control headers may remain control-centered when appropriate.

---

# 15. TABLE BODY CELL MASTER — FINAL

Body text:

- tên / email / note / description → căn trái
- status / short numeric có thể center nếu phù hợp
- không ép tất cả body căn center

Cell inset:

```text
padding-block: 14px
padding-inline: 16px
```

Control bên trong cell:

- không sát mép
- không negative margin
- `width:100%` chỉ trong content box
- giữ safe inset khoảng 16px nếu đủ chỗ
- Acceptance phải đo geometry thực tế của child/content, không chỉ
  `getComputedStyle(td).paddingLeft`. Với control/content đại diện, cả inset
  trái và phải từ cell edge phải `>= 16px` (tolerance tối đa 1px cho border /
  subpixel). `width:100%` phải đi cùng `max-width:100%` (hoặc logical
  equivalent) và `box-sizing:border-box`; wrapper không được dùng negative
  margin, `calc(100% + ...)`, translate hoặc absolute positioning để tràn ra
  ngoài content box.

Canonical visible contract:

```text
cell edge | >=16px | content / control | >=16px | cell edge
```

Table control internal inset:

```text
padding-inline-start: about 10–12px
padding-inline-end:   about 10–12px minimum
```

Native date, time, and select controls may reserve a larger end inset for
their calendar, clock, or dropdown affordance. Acceptance must verify both the
cell-to-control geometry and the computed control padding; a `16px` table-cell
padding alone is not sufficient.

---

# 16. TABLE COLUMN INTENT SYSTEM

Không chia đều tất cả cột.

Concept:

```text
compact
narrow
medium
wide
flex
```

Representative:

```text
compact  ~64–96px
narrow   ~100–130px
medium   ~140–190px
wide     ~200–280px
flex     min ~220px + receives remaining space
```

Short-content columns phải nhỏ lại để nhường long-content columns.

---

# 17. EQUIPMENT TABLE MASTER — FINAL

Áp dụng cho các bảng thiết bị/vật tư.

```text
Tên thiết bị và vật tư: 275px
Tên thương mại:         275px

Loại:                   145px
Nước SX:                145px
Hãng:                    145px
Model:                   145px
ĐVT:                     145px
Trạng thái:              145px

Selection checkbox:       52px
```

Base:

```text
min-width: 1420px
table-layout: fixed
```

Rules:

- 2 cột tên phải rộng nhất
- metadata ngắn dùng width chuẩn bằng nhau
- không chia đều làm 2 cột tên bị bóp

Modal thiết bị cũng theo cùng philosophy.

---

# 18. ACTION BUTTON MASTER — FINAL

## One-line label

```text
white-space: nowrap
```

Không cho desktop label như:

- Ngừng sử dụng
- Import tất cả
- Tải template
- Xuất phiếu PDF

xuống dòng nếu có thể phân bổ width lại.

## Same group = equal geometry

Cùng action group:

```text
same height
same width/min-width
same horizontal padding
same radius
same icon size/gap
```

---

# 19. CATALOG ACTION MASTER — FINAL

This is a Component / Family Master. Catalog pages inherit the Global Control,
Toolbar, Table, Action Button, and Responsive Masters unless this section
explicitly changes a catalog-family behavior.

Áp dụng cho:

- Danh mục thiết bị
- Danh mục môn học
- Danh mục phòng
- Mẫu ca trực
- các catalog tương tự

Representative group:

```text
Kích hoạt | Sửa | Ngừng sử dụng | Xóa
```

Geometry:

```text
display: flex
align-items: center
gap: 9px

button width: 154px
button min-width: 154px
button min-height: 42px

justify-content: center
white-space: nowrap
```

Tone:

```text
Kích hoạt       Primary
Sửa             Primary/Secondary
Ngừng sử dụng   Warning
Xóa             Danger
```

## Position stability — MANDATORY

Button không được nhảy vị trí khi state thay đổi.

Các state:

```text
no selection
selected
multi-selected
editing
disabled
loading
```

Allowed:

- disabled
- color/tone
- loading text/icon

Forbidden:

- hide/remove button
- reflow toàn toolbar
- justify buttons sang vị trí khác
- button đổi slot

Nếu action chưa dùng được:

```text
keep slot
→ disabled
```

---

# 20. CATALOG CONSISTENCY MASTER

`Danh mục khác` phải đồng bộ `Danh mục thiết bị`.

Phải cùng:

- action button sizes
- icon sizes
- spacing
- toolbar placement
- disabled visual
- edit visual
- action ordering logic

Không chấp nhận:

```text
Danh mục thiết bị:
compact equal group

Danh mục khác:
buttons rải khắp hàng / nhảy vị trí
```

---

# 21. FILTER / IMPORT / ACTION GRID MASTER

Same visual row:

- same height
- same baseline
- same logical grid
- same control alignment

Desktop:

- ưu tiên 1 hàng
- nếu cần wrap → wrap nguyên control/button
- không wrap text bên trong button

Tablet/mobile:

- intentional 2-column / 1-column breakpoints
- no page horizontal overflow

---

# 22. PERSONNEL TABLE OVERRIDE — FINAL

Inherits the Table Master. This override defines Personnel column semantics and
content hierarchy only; it does not redefine shared shell, header, body inset,
typography, focus, or responsive behavior.

Columns:

```text
1 Mã
2 Họ và tên
3 Email
4 Vai trò
5 Quyền bổ sung
6 Phạm vi
7 Trạng thái
8 Thao tác
```

Chức danh nằm dưới Họ tên.

`Mã` displays initials derived from `full_name` using the canonical
`getNameInitials()` behavior (for example, `Lê Hoàng Minh` → `LHM` and
`Nguyễn Nhật Bảo` → `NNB`). It is a compact text identifier and is not this
table's `employee_code`.

`Họ và tên` shows the full name only as primary text, with title underneath
when present. It does not show initials or an avatar.

Example:

```text
Nguyễn Nhựt Bảo
Chuyên viên
```

Multiple roles:

- wrap badges inside Vai trò
- không shrink font
- row tăng height nếu cần

Column intent:

```text
Mã              compact
Họ và tên       wide
Email           wide/flex
Vai trò         medium
Quyền bổ sung   medium
Phạm vi         medium
Trạng thái      narrow
Thao tác        compact
```

---

# 23. PERSONNEL EDIT DRAWER OVERRIDE — FINAL

Drawer bên phải.

Actual DOM order phải là:

```text
Thông tin cơ bản
Vai trò chính
Quyền bổ sung
Phạm vi phụ trách
Trạng thái
Mật khẩu / Bảo mật
```

Không chỉ dùng CSS `order`.

Sticky Header + Scrollable Body + Sticky Footer.

Footer:

```text
Hủy | Lưu thay đổi
```

---

# 24. CALENDAR MASTER

`Lịch Skills lab` là Calendar Master.

`Lịch Y cơ sở` dùng cùng visual Master.

Keep:

- KPI
- search/date
- previous / Tuần này / next
- date range
- Tháng / Tuần / Danh sách
- event cards
- current day highlight
- detail drawer

Skills/Y chỉ khác data/business fields, không khác visual shell.

## Responsive calendar default

Áp dụng riêng cho `Lịch Skills lab` và `Lịch Y cơ sở`.

- URL có `view=week`, `view=month`, hoặc `view=list` hợp lệ luôn là lựa chọn
  rõ ràng của người dùng và phải thắng ở mọi viewport.
- Khi URL không có `view`, server render `Tuần` để tránh hydration mismatch.
  Client chỉ resolve một lần sau hydration: desktop giữ `Tuần`; breakpoint
  responsive hiện hành `max-width: 920px` dùng `Danh sách`.
- Default responsive không ghi URL, không tạo router loop, không lắng nghe
  resize để ghi đè view đang xem, và không được thay thế lựa chọn thủ công.
- `Tổng quan` và `Lịch trực` không thừa hưởng rule default này.

## Skills equipment-registration KPI

KPI thứ tư màu tím của `Tổng quan` và `Lịch Skills lab` là:

```text
Số lớp chưa đăng ký thiết bị
```

Chỉ đếm lớp Skills active trong period riêng của page. Một request thiết bị
được normalize theo calendar contract hiện hữu; request `cancelled` không còn
effective, nên lớp đó vẫn được tính là chưa đăng ký. Không đếm ca trực và
không áp dụng KPI này cho Lịch Y cơ sở.

## Calendar detail drawer family

Skills and Basic Medical share the same detail-drawer family. The drawer is a
visual editing/inspection pattern; its fields inherit the Global Form and
Control rules.

- Desktop drawer width is `min(480px, 100%)`; mobile continues to fit the
  viewport.
- Label/value rows use one shared grid. Labels align with the first value row;
  a multi-lecturer field keeps the second choice aligned to the value column on
  desktop.
- Room values use the same body/control typography as other field values; do
  not apply code/mono typography merely because a room label contains a code.
- Native date, time, and select controls retain their native affordances and
  must have sufficient inline space for their rendered locale value and icon.
  They must never clip or overflow the drawer.
- At a narrow mobile width, a time range may stack its start/end controls and a
  secondary lecturer choice may use a full row when that is necessary to keep
  all text visible. This is a responsive family behavior, not a page-specific
  exception.

---

# 25. DASHBOARD OVERRIDE

Keep current production direction.

Required:

- KPI Master
- white Topbar 82px
- no `Xin chào`
- `LỊCH HỌC 7 NGÀY TỚI` uses Table Master

---

# 26. CREATE BASIC MEDICAL / TẠO LỊCH Y CƠ SỞ OVERRIDE

Giữ **bố cục và nội dung nghiệp vụ hiện tại**.

Không ép thành layout Tạo lịch Skills.

Keep:

```text
Thao tác với phiếu đã đăng ký
Điều chỉnh phiếu
Sao chép phiếu

01 Thông tin môn học
02 Thông tin người đăng ký
03 Thông tin giảng viên phụ trách
04 Thông tin đăng ký
Session table
Ghi chú
Footer
```

Chỉ inherit:

- typography
- spacing
- field styles
- section badge
- buttons
- validation
- focus
- responsive
- table rules

---

# 27. PHIẾU Y CƠ SỞ OVERRIDE

Inherits the Table, Action Button, Calendar, and Responsive Masters. This
override defines the approved registration/session information architecture
and shared-grid anchors only.

Current layout cần standardize.

Collapsed row:

```text
Môn học
Thời gian đăng ký
Phòng
Số buổi
Trạng thái
Expand/Action
```

Expanded:

```text
Registration summary grid
Registration actions
Session table
```

Session columns:

```text
#                         compact
Ngày                      narrow
Thời gian                 narrow
Tên bài TN-TH             wide/flex
GV giảng dạy/hướng dẫn    wide
Trạng thái                medium
Thao tác                  compact
```

Không để `Tên bài TN-TH` wrap 2 dòng trong khi cột khác còn dư.

---

# 28. EQUIPMENT REQUEST OVERRIDE

Keep expanded-detail concept hiện tại.

Improve:

- spacing
- typography
- button hierarchy
- column intent
- one-line headers
- metadata grid

Approval:

```text
Approve = Primary
Reject  = Danger
```

Request actions:

```text
Export PDF = Secondary
Delete     = Danger
```

## Basic Medical equipment session picker

The Basic Medical equipment workspace reuses the Skills equipment registration
`class-picker-row` layout for a new-request or copy destination selection:

```text
Buổi học Y cơ sở *
[ selector ] [ + Tạo lịch Y cơ sở ]
```

It has no surrounding `data-panel` card. The shared responsive rule keeps the
selector and action on one row on desktop and stacks them cleanly on narrow
viewports. Edit mode keeps its immutable source session read-only and does not
offer this picker or a create-schedule action.

---

# 29. EQUIPMENT LIST MODAL OVERRIDE

Keep modal concept.

Inherit:

- Dialog Master
- Table Master
- Equipment column intent
- local horizontal scroll
- no white gutter
- one-line headers
- consistent add-row/footer actions

---

# 30. IMPORT MASTER — FINAL

This is a Component / Family Master for repeated import workflows. It defines
the user-facing wizard and preview experience, not file-processing, mutation,
or authorization semantics.

`Import lịch Skills lab` là Import Master.

Wizard:

```text
1 Chọn file
2 Xem trước
3 Kiểm tra
4 Xác nhận
5 Kết quả
```

Keep:

- large upload dropzone
- Template CSV/XLSX
- file summary
- KPI validation summary
- preview table
- pagination
- Quay lại / Tiếp tục

Apply to:

- Import Skills
- Import Y
- Import Phiếu thiết bị
- catalog import where workflow matches

---

# 31. CATALOG IMPORT ALL — FINAL UX REQUIREMENT

`Import tất cả` opens the existing application preview. The preview modal is
primarily for:

> Xem dữ liệu trong FILE sắp import trước khi áp dụng.

Final flow:

```text
Import tất cả
→ native file chooser
→ select CSV/XLSX
→ validate and parse
→ obtain the existing application preview
→ automatically open preview modal
→ user reviews file rows
→ Hủy or Import tất cả
```

Do NOT expose a separate action named `Preview đối soát`.

Do NOT expose a primary action named `Chọn file đối soát`.

## Preview modal content

Show:

- file name;
- row count;
- file-row preview table;
- file validation errors where applicable; and
- modal-local pagination for large files.

Equipment preview columns:

```text
Tên thiết bị và vật tư
Tên thương mại
Loại
Nước SX
Hãng
Model
ĐVT
```

Unified equipment operations keeps both lab domains in one shared Data Table.
Its first operational column is `Phạm vi`, followed by `Môn học`; the compact
domain badge belongs only in `Phạm vi`, while `Môn học` keeps the course code
and course name as its two lines. The shared filter toolbar places `Phạm vi`
between Search and Status, using the same control rhythm and responsive table
scroll contract as the existing equipment request list.

Do NOT require visible reconciliation KPI cards `Cập nhật`, `Thêm mới`, `Kích hoạt lại`, `Ngừng sử dụng`, or `Xóa` inside this preview modal.

The UI must present safe, mapped validation or stale-preview feedback and keep
the preview open when the existing business contract rejects an apply. The
underlying reconciliation, identity, mutation, authorization, and
stale-protection semantics remain outside this UI Master.

---

# 32. CATALOG ADD FORM

Manual add form mặc định **collapsed**.

Page ưu tiên list/filter.

Bấm:

```text
+ Thêm ...
```

mới expand manual form.

---

# 33. EVIDENCE OVERRIDE

Keep document-style.

Evidence là approved exception.

Principles:

- document/readability first
- signature/evidence prominent
- metadata secondary
- invalidation visible
- PDF/export compatible

---

# 34. LOGIN OVERRIDE

Keep gần production hiện tại.

Inherit shared:

- font
- input
- button
- focus
- error
- accessibility

Không redesign login thành unrelated visual family.

---

# 35. BUTTON / STATUS STATE MASTER

Buttons:

```text
default
hover
focus-visible
pressed
disabled
loading
```

Inputs:

```text
default
hover
focus
filled
read-only
disabled
error
```

Rows:

```text
default
hover
selected
expanded
inactive
warning
```

Dialogs:

```text
closed
opening
open
pending
error
closing
```

---

# 36. MODAL / DRAWER MASTER

Dialog:

- shared shell
- focus trap
- ESC when safe
- focus return
- pending handling
- one semantic tone

Drawer:

```text
Sticky Header
Scrollable Body
Sticky Footer
```

No browser-native `prompt()` for business input.

Browser `confirm()` should be migrated to shared ConfirmDialog where in UI V2 scope.

---

# 37. INLINE COUNTER + ACTION ALIGNMENT ACCEPTANCE

For every toolbar containing:

```text
Search
Filters
Xóa bộ lọc
Counter
Action buttons
```

verify:

```text
all controls same 44px row height
counter visually centered
reset button same height
same baseline
no vertical drift
```

---

# 38. RESPONSIVE MASTER

```text
Desktop productivity first
Tablet/mobile fully operable
```

Apply the shared layout, table, control, and drawer contracts first. Add a
page override only for an explicitly approved information-architecture need;
do not use a page-specific exception to avoid fixing a repeated family issue.

Desktop:

- dense
- one-line table headers
- one-line button labels

Tablet:

- intentional wrap
- local table scroll

Mobile:

- no page horizontal scroll
- controls 1 or 2 columns
- table can horizontal-scroll internally
- modal/drawer fit viewport

---

# 39. ACCESSIBILITY MASTER

Target WCAG AA-oriented.

Required:

- keyboard navigation
- visible focus
- no focus hidden under sticky UI
- accessible names for icon-only controls
- color not only status signal
- reduced motion
- accessible form errors
- modal/drawer focus management

Do not fix visual issues by removing focus outline entirely.

---

# 40. ANTI-PATTERNS — REJECT

Do not introduce:

- custom table shell per page
- custom filter visual per page
- another modal implementation
- random radius/shadow
- hardcoded page-specific table header color
- white table gutter
- outer visual table shell → nested visual responsive-table shell → reserved
  scrollbar gutter
- multiple elements in one Data Table hierarchy independently owning border,
  radius, and opaque background
- multi-line desktop table headers due poor width planning
- page-level horizontal scroll
- tiny font to fit data
- equal-width table columns regardless content
- buttons that move position between states
- buttons that wrap text on desktop
- multiple different control heights in same row
- double focus border
- duplicate CSS override instead of fixing shared contract
- CSS `order` to fake semantic DOM order
- browser prompt for business input
- visual refactor combined with unrelated business/security change

---

# 41. VISUAL REGRESSION REQUIREMENT

Representative viewports:

```text
1920
1440
1366
1024
820
390
```

Representative pages:

```text
Tổng quan
Lịch Skills lab
Skills detail drawer
Tạo lịch Skills lab
Nhân sự
Personnel edit drawer
Danh mục thiết bị
Danh mục khác
Lớp đang mở
Phiếu thiết bị của tôi
Phiếu Y cơ sở
Tạo lịch Y cơ sở
Import lịch Skills lab
Evidence
Login
```

Must visually inspect:

- Sidebar hierarchy
- Topbar white/82px
- title
- section badge
- table rounded edge
- right-edge gutter
- textual table header left alignment
- cell padding
- equipment column proportions
- filter alignment
- counter alignment
- focus border
- button sizes
- button no-wrap
- action position stability
- catalog consistency

`page.screenshot()` alone is capture, not final regression assertion.

Where feasible, use approved `toHaveScreenshot()` baseline later.

---

# 42. REQUIRED IMPLEMENTATION STRATEGY

Do not patch page-by-page first.

Preferred order:

```text
1. Fix shared tokens
2. Fix shared Workspace/PageHeader
3. Fix shared table shell/header/body
4. Fix shared filter/control contracts
5. Fix shared action/button group
6. Fix shared dialog/drawer
7. Apply page-family overrides
8. Remove obsolete legacy CSS causing specificity conflicts
9. Visual test representative pages
```

Important:

If legacy CSS has higher specificity than V2 `:where(...)`, do NOT assume later V2 selector wins.

Check **computed style**.

Remove or rewrite the old conflicting rule when necessary.

---

# 43. SAFETY RULES

This task is UI Design System work.

DO NOT:

- alter DB schema
- run production migrations
- deploy production
- modify production secrets
- weaken authorization
- change role/capability logic
- change business status transitions
- touch PR #2
- change production email behavior

Production must remain unchanged.

---

# 44. REQUIRED CHECKS BEFORE REPORTING DONE

At minimum run relevant:

```text
format
lint
typecheck
targeted Node tests
UI V2 source-contract tests
Playwright critical UI tests
visual capture at representative widths
```

Do not say PASS because a test file exists.

Actually run it.

---

# 45. REQUIRED FINAL REPORT FORMAT

When finished, report:

```text
MACHINE:
BRANCH:
BASE SHA:
HEAD SHA:
TASK:

FILES CHANGED:

MASTER AREAS IMPLEMENTED:
- Sidebar
- Topbar
- Form section
- Table
- Filter
- Counter
- Dropdown focus
- Buttons
- Catalog
- Personnel
- Y
- Import
...

KNOWN EXCEPTIONS:
...

TESTS:
- command
- result

VISUAL CHECKS:
- page
- viewport
- result

PRODUCTION CHANGED:
NO

BUSINESS LOGIC CHANGED:
NO

AUTHORIZATION CHANGED:
NO

READY FOR REVIEW:
YES/NO
```

If anything is still uncertain, say `PARTIAL` or `CANNOT VERIFY`.

Do not mark FIXED based only on source presence.

---

# 46. FINAL DEFINITION OF DONE

This task is DONE only when:

- approved Master values are implemented;
- Sidebar group 14px / menu 12px;
- Topbar is white and 82px;
- Page title exact Master;
- Section badge exact Master;
- Textual Table headers aligned left;
- cells have safe inset;
- table shell rounded 4 corners;
- no right-edge white gutter;
- every Data Table has exactly one visual shell owner;
- Data Table scrollbar gutter is `auto` or intentionally omitted;
- header and body terminate at the same right edge;
- Personnel production remains the visual reference for Data Table edge/radius;
- shared TableScrollViewport behavior is used instead of page-specific fixes;
- Equipment name columns prioritized;
- filters same 44px height;
- reset aligned;
- counters centered;
- dropdown focus has one border;
- action labels do not wrap desktop;
- same action group buttons equal size;
- catalog buttons do not jump position;
- Danh mục khác matches Danh mục thiết bị;
- Personnel final column structure remains correct;
- Password section is truly last in DOM;
- Y Create preserves approved business layout;
- Y Registration is standardized;
- Import Master remains 5-step;
- Import All automatically opens a file-row preview before apply;
- Import All file contents are visible before mutation;
- Import All keeps its existing safe stale-preview feedback; and
- Import All reconciliation KPI cards are NOT required in the preview UI;
- no page-level horizontal overflow;
- representative visual checks pass;
- no business/security/production regression.

---

# FINAL INSTRUCTION

Do not interpret this prompt as:

> “Make the UI look nicer.”

Interpret it as:

> **“Implement the exact MedLabs UI Design System Master approved by the user, consolidate repeated patterns into shared components/tokens, preserve business behavior, and remove UI drift.”**

If current local implementation conflicts with this MASTER, **MASTER wins**.

---

Governance, classification, inheritance, and correction placement are
canonical in Section 0; do not duplicate them in a page or component section.
