import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("UI V2 keeps the approved semantic visual foundation", async () => {
  const css = await source("app/globals.css");
  for (const token of [
    "--primary: #144069",
    "--secondary: #a78656",
    "--canvas: #f8f6f1",
    "--table-header: #f6f1e8",
    "--focus-ring:",
    "prefers-reduced-motion",
  ]) {
    assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(css, /overflow-x: auto/);
  assert.doesNotMatch(css, /scrollbar-gutter: stable both-edges/);
  assert.match(
    css,
    /linear-gradient\(180deg, #173f64 0%, #102f4d 62%, #0c2944 100%\)/,
  );
  assert.match(css, /color: #d9c49e/);
  assert.match(css, /inset 4px 0 #a78656/);
  assert.match(css, /font-size: clamp\(27px, 2vw, 32px\)/);
  assert.match(css, /background: #e5edf5/);
  assert.match(css, /border-radius: 9px/);
});

test("UI V2 gives composite controls one global visual shell", async () => {
  const css = await source("app/globals.css");
  const master = await source("docs/UI_DESIGN_SYSTEM_V2_MASTER.md");
  const shellContract = css.match(
    /\/\* One chrome-owning composite control gets one visual shell\.[\s\S]*?(?=\.badge,)/,
  )?.[0];

  assert.ok(shellContract);
  for (const family of [
    "search-field",
    "input-with-icon",
    "data-search",
    "filter-control",
    "role-switcher",
    "class-range-mode",
    "equipment-date-filter",
    "searchable-combobox-control",
  ]) {
    assert.match(shellContract, new RegExp(`\\.${family}`));
  }

  assert.match(
    shellContract,
    /> :is\(input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\), select, textarea\)/,
  );
  for (const reset of [
    "background: transparent",
    "border: 0",
    "border-radius: 0",
    "box-shadow: none",
    "outline: 0",
  ]) {
    assert.match(
      shellContract,
      new RegExp(reset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(
    shellContract,
    /:is\(\s*:focus,\s*:focus-visible\s*\)[\s\S]*box-shadow: none/,
  );
  assert.match(
    shellContract,
    /\):focus-within \{[\s\S]*border-color: var\(--primary\)[\s\S]*box-shadow: 0 0 0 3px rgb\(20 64 105 \/ 12%\)/,
  );
  assert.match(
    css,
    /:where\([\s\S]*input:not\(\[type="checkbox"\]\)[\s\S]*\):focus-visible \{[\s\S]*border-color: var\(--primary\)[\s\S]*box-shadow: 0 0 0 3px rgb\(20 64 105 \/ 12%\)/,
  );
  assert.doesNotMatch(css, /\.class-range-dates:focus-within/);
  assert.match(
    master,
    /Global one-control-one-visual-shell rule[\s\S]*wrapper owns border, radius, background[\s\S]*child native `input`, `select`, or `textarea` resets[\s\S]*standalone native controls keep the shared native `:focus-visible` rule/,
  );
  assert.match(
    master,
    /`class-range-dates`[\s\S]*independent native control shells[\s\S]*group must not add a combined `:focus-within`[\s\S]*ring/,
  );
});

test("UI V2 shared chrome and data primitives use canonical Master geometry", async () => {
  const css = await source("app/globals.css");
  const catalog = await source("components/equipment-catalog-manager.tsx");
  const classList = await source("components/class-registration-list.tsx");
  const master = await source("docs/UI_DESIGN_SYSTEM_V2_MASTER.md");

  for (const token of [
    "width: 244px",
    "flex: 0 0 244px",
    "font-size: 14px",
    "min-height: 82px",
    "padding: 16px 30px",
    "background: rgb(255 255 255 / 94%)",
    "backdrop-filter: blur(14px)",
    "height: 44px",
    "padding: 14px 16px",
    "text-align: left",
    "width: 275px",
    "width: 145px",
    "width: 52px",
  ]) {
    assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(
    css,
    /\.workspace-topbar\.page-header \{[\s\S]*position: sticky[\s\S]*z-index: 35/,
  );
  assert.match(
    css,
    /\.workspace-sidebar \.nav-heading \{[\s\S]*font-size: 14px[\s\S]*letter-spacing: 0\.06em/,
  );
  assert.match(
    css,
    /\.equipment-catalog-col-name,[\s\S]*\.equipment-catalog-col-commercial-name \{[\s\S]*width: 275px/,
  );
  assert.match(
    css,
    /\.data-table th,[\s\S]*\.preview-table-wrap table th \{[\s\S]*text-align: left/,
  );
  assert.match(
    css,
    /td\s*:is\(input, select, textarea, \.inline-time-editor\)\s*\{[\s\S]*max-inline-size: 100%[\s\S]*margin-inline: 0/,
  );
  assert.match(
    css,
    /td\s*:where\([\s\S]*input:not\(\[type="checkbox"\]\)[\s\S]*padding-inline: 11px/,
  );
  assert.match(
    css,
    /input\[type="date"\],[\s\S]*input\[type="time"\],[\s\S]*padding-inline-end: 20px/,
  );
  assert.match(
    css,
    /\.class-registration-table td\.class-registration-student-count-cell[\s\S]*padding-inline: 10px[\s\S]*text-align: center/,
  );
  assert.match(
    css,
    /\.class-registration-table-open\s*\{[\s\S]*width: 1485px[\s\S]*min-width: 1485px/,
  );
  assert.match(
    css,
    /\.class-list-panel \.responsive-table\s*\{[\s\S]*contain: paint[\s\S]*overflow-x: auto/,
  );
  assert.match(
    master,
    /# 14\.[\s\S]*All textual Data Table headers[\s\S]*text-align: left[\s\S]*Do not globally\s+center textual headers/,
  );
  assert.match(
    master,
    /Acceptance ph[^\n]*geometry th[^\n]*child\/content[\s\S]*cell edge \| >=16px \| content \/ control \| >=16px \| cell edge/,
  );
  assert.match(
    master,
    /Table control internal inset:[\s\S]*padding-inline-start: about 10–12px[\s\S]*computed control padding/,
  );
  assert.doesNotMatch(master, /text-align: center/);
  assert.match(catalog, /<colgroup>/);
  assert.match(catalog, /equipment-catalog-col-select/);
  assert.match(catalog, /equipment-catalog-col-commercial-name/);
  assert.match(
    classList,
    /<colgroup>[\s\S]*class-registration-col-date[\s\S]*class-registration-col-time[\s\S]*class-registration-col-room[\s\S]*class-registration-col-student-count/,
  );
});

test("UI V2 keeps equipment controls and wide request tables inside local viewports", async () => {
  const css = await source("app/globals.css");
  assert.match(
    css,
    /\.equipment-request-list-panel \.responsive-table \{[\s\S]*max-width: 100%/,
  );
  assert.match(
    css,
    /@media \(max-width: 1440px\) \{[\s\S]*\.equipment-catalog-import/,
  );
  assert.match(
    css,
    /@media \(max-width: 1080px\) \{[\s\S]*\.equipment-request-filters/,
  );
  assert.match(
    css,
    /@media \(max-width: 680px\) \{[\s\S]*\.equipment-catalog-filters/,
  );
});

test("Registration forms and equipment request filters keep distinct visual shells", async () => {
  const css = await source("app/globals.css");
  const scheduleForm = await source("components/schedule-form.tsx");
  const basicMedicalForm = await source(
    "components/basic-medical-registration-form.tsx",
  );

  assert.match(
    css,
    /\.class-filter-panel\.equipment-request-filters\s*\{[\s\S]*border-radius: var\(--radius-card\)[\s\S]*box-shadow: var\(--shadow-card\)/,
  );
  assert.match(
    css,
    /\.schedule-form\s*\{[\s\S]*display: grid[\s\S]*gap: 16px[\s\S]*overflow: visible/,
  );
  assert.match(
    css,
    /\.schedule-form > section\s*\{[\s\S]*background: var\(--surface\)[\s\S]*border-radius: var\(--radius-card\)[\s\S]*box-shadow: var\(--shadow-card\)/,
  );
  assert.match(scheduleForm, /className="schedule-form"/);
  assert.match(
    basicMedicalForm,
    /className="schedule-form external-layout-form"/,
  );
});

test("Basic Medical registration and sessions share one master grid", async () => {
  const css = await source("app/globals.css");
  const registrationList = await source(
    "components/basic-medical-registration-list.tsx",
  );

  for (const token of [
    "basic-medical-registration-col-course",
    "basic-medical-registration-col-sessions",
    "basic-medical-registration-col-status",
    "basic-medical-registration-status-control",
    "basic-medical-registration-detail-code",
    "basic-medical-registration-detail-student-count",
    "basic-medical-registration-detail-note",
    "basic-medical-registration-detail-action",
    "basic-medical-session-col-lesson",
    "basic-medical-session-col-lecturer",
    "basic-medical-session-viewport",
    "basic-medical-session-action-stack",
  ]) {
    assert.match(registrationList, new RegExp(token));
    assert.match(css, new RegExp(`\\.${token}`));
  }
  assert.match(
    css,
    /--basic-medical-track-1: 18\.41cqw;[\s\S]*--basic-medical-track-5: 17\.36cqw/,
  );
  assert.match(
    css,
    /\.basic-medical-registration-detail-grid\s*\{[\s\S]*var\(--basic-medical-track-1\)[\s\S]*var\(--basic-medical-track-5\)/,
  );
  assert.match(
    css,
    /\.basic-medical-session-viewport\s*\{[\s\S]*margin-inline-start: var\(--basic-medical-session-inset\)[\s\S]*inline-size: calc\(100% - var\(--basic-medical-session-inset\)\)/,
  );
  assert.match(
    css,
    /\.basic-medical-session-col-index\s*\{[\s\S]*width: calc\(5\.55982cqw - 5\.436px\)/,
  );
  assert.match(
    css,
    /\.basic-medical-session-col-date\s*\{[\s\S]*width: calc\(12\.85018cqw - 12\.564px\)/,
  );
  assert.match(
    css,
    /\.basic-medical-session-col-time\s*\{[\s\S]*width: var\(--basic-medical-track-2\)/,
  );
  assert.match(
    css,
    /\.basic-medical-session-col-lesson\s*\{[\s\S]*width: var\(--basic-medical-track-3\)/,
  );
  assert.match(
    css,
    /\.basic-medical-session-col-lecturer\s*\{[\s\S]*width: var\(--basic-medical-track-4\)/,
  );
  assert.match(
    css,
    /\.basic-medical-session-table td:nth-child\(5\)\s*\{[\s\S]*text-align: left/,
  );
  assert.match(
    css,
    /\.basic-medical-registration-detail-action\s*\{[\s\S]*justify-items: start/,
  );
  assert.match(
    css,
    /\.basic-medical-session-action-stack\s*\{[\s\S]*justify-items: start/,
  );
  assert.match(registrationList, /colSpan=\{5\}/);
  assert.match(registrationList, /onClick=\{toggleRegistration\}/);
  assert.match(
    css,
    /\.basic-medical-registration-table \.equipment-request-table-row\s*\{[\s\S]*cursor: pointer/,
  );
  assert.match(
    css,
    /\.basic-medical-session-table th:last-child\s*\{[\s\S]*text-align: left/,
  );
  assert.match(
    registrationList,
    /<th>\{uiText\("Trạng thái \/ Thao tác"\)\}<\/th>/,
  );
});

test("Email notification table preserves a single-line delivery status", async () => {
  const css = await source("app/globals.css");
  const table = await source("components/email-notification-table.tsx");

  for (const token of [
    "email-notification-col-time",
    "email-notification-col-status",
    "email-notification-col-error",
  ]) {
    assert.match(table, new RegExp(token));
    assert.match(css, new RegExp(`\\.${token}`));
  }
  assert.match(css, /\.email-notification-col-time\s*\{[\s\S]*width: 7%/);
  assert.match(css, /\.email-notification-col-status\s*\{[\s\S]*width: 12%/);
  assert.match(
    css,
    /\.email-notification-table \.status-pill\s*\{[\s\S]*white-space: nowrap/,
  );
});

test("Skills and Basic Medical calendars share a safe drawer inset", async () => {
  const css = await source("app/globals.css");
  const dashboard = await source("components/dashboard.tsx");

  assert.match(dashboard, /className="detail-drawer"/);
  assert.doesNotMatch(
    dashboard,
    /<dd className="mono">[\s\S]*selectedEvent\.room/,
  );
  assert.match(
    css,
    /\.detail-drawer\s*\{[\s\S]*width: min\(480px, 100%\)[\s\S]*padding: 24px 32px/,
  );
  assert.match(
    css,
    /\.detail-list > div\s*\{[\s\S]*grid-template-columns: 110px 1fr/,
  );
  assert.match(
    css,
    /max\(32px, env\(safe-area-inset-right\)\)[\s\S]*max\(32px, env\(safe-area-inset-left\)\)/,
  );
  assert.match(css, /\.detail-list > div\s*\{[\s\S]*align-items: center/);
  assert.match(
    css,
    /\.detail-list > div:has\(\.drawer-lecturer-selects\)\s*\{[\s\S]*align-items: start/,
  );
  assert.match(
    css,
    /\.detail-list > div:has\(\.drawer-lecturer-selects\) > dt\s*\{[\s\S]*padding-block-start: 10px/,
  );
  assert.match(
    css,
    /\.detail-list :is\(input, select\)\s*\{[\s\S]*padding-inline: 11px/,
  );
  assert.match(
    css,
    /@media \(max-width: 360px\)[\s\S]*\.detail-list \.drawer-time-editor\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\)[\s\S]*min-width: 0/,
  );
  assert.match(
    css,
    /\.detail-list \.drawer-time-editor input\s*\{[\s\S]*min-width: 0/,
  );
  assert.match(
    css,
    /\.drawer-time-editor\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)[\s\S]*min-width: 0/,
  );
  assert.match(
    css,
    /\.detail-list > div:has\(\.drawer-lecturer-selects\) > dd,[\s\S]*\.detail-list \.drawer-lecturer-selects\s*\{[\s\S]*display: contents/,
  );
  assert.match(
    css,
    /\.detail-list \.drawer-lecturer-selects select:nth-child\(2\)\s*\{[\s\S]*grid-column: 2/,
  );
  assert.match(
    css,
    /@media \(max-width: 360px\)[\s\S]*\.detail-list \.drawer-lecturer-selects select:nth-child\(2\)\s*\{[\s\S]*grid-column: 1 \/ -1/,
  );
});

test("UI V2 personnel structure follows the approved table and drawer order", async () => {
  const personnel = await source("components/personnel-management-list.tsx");
  const personnelPage = await source("app/admin/personnel/page.tsx");
  const dashboard = await source("app/dashboard/page.tsx");
  const master = await source("docs/UI_DESIGN_SYSTEM_V2_MASTER.md");
  for (const heading of [
    "Mã",
    "Họ và tên",
    "Email",
    "Vai trò",
    "Quyền bổ sung",
    "Phạm vi",
    "Trạng thái",
    "Thao tác",
  ]) {
    assert.ok(personnel.includes(`<th>{uiText("${heading}")}</th>`));
  }
  assert.match(personnel, /personnel-password-section/);
  assert.doesNotMatch(personnel, /window\.confirm/);
  assert.match(personnel, /<ConfirmDialog/);
  assert.match(
    personnel,
    /action === "grant-admin" && requiresDeactivationConfirmation\(\)/,
  );
  const confirmationDialog = await source("components/confirm-dialog.tsx");
  assert.match(confirmationDialog, /event\.key !== "Tab"/);
  assert.match(confirmationDialog, /last\.focus\(\)/);
  assert.match(confirmationDialog, /first\.focus\(\)/);
  assert.match(personnel, /getNameInitials\(item\.full_name\)/);
  assert.match(personnel, /className="personnel-name"/);
  assert.doesNotMatch(personnel, /person-avatar initials-avatar/);
  assert.doesNotMatch(personnel, /employee_code\?\.trim\(\)/);
  assert.doesNotMatch(personnel, /item\.id\.slice\(/);
  assert.match(personnelPage, /select\("can_manage_email_notifications"\)/);
  assert.doesNotMatch(personnelPage, /employee_code/);
  assert.match(
    master,
    /`Mã` displays initials derived from `full_name`[\s\S]*`Họ và tên` shows the full name only/,
  );
  assert.doesNotMatch(dashboard, /Xin chào/);
});

test("catalog import keeps the one-button file-to-preview flow and a circle stepper", async () => {
  const catalogImport = await source(
    "components/catalog-reconciliation-import.tsx",
  );
  const importWizard = await source("components/import-wizard.tsx");
  const capture = await source("tests/e2e/ui-v2-visual-capture.spec.ts");

  assert.match(catalogImport, /Import tất cả/);
  assert.doesNotMatch(catalogImport, /Chọn file đối soát|Preview đối soát/);
  assert.doesNotMatch(catalogImport, /Cập nhật.*Thêm mới.*Kích hoạt lại/s);
  assert.match(catalogImport, /previewPageSize/);
  assert.match(importWizard, /<ol className="stepper">/);
  assert.match(capture, /reports\/ui-v2\/after/);
  assert.match(capture, /basic-medical-calendar/);
});

test("final Master correction keeps table ownership, counters, and stable catalog slots", async () => {
  const css = await source("app/globals.css");
  const master = await source("docs/UI_DESIGN_SYSTEM_V2_MASTER.md");
  const catalog = await source("components/catalog-batch-manager.tsx");
  const personnel = await source("components/personnel-management-list.tsx");
  const personnelPage = await source("app/admin/personnel/page.tsx");
  const classList = await source("components/class-registration-list.tsx");
  const catalogImport = await source(
    "components/catalog-reconciliation-import.tsx",
  );

  assert.doesNotMatch(
    css,
    /\.responsive-table,\s*\.preview-table-wrap,\s*\.period-calendar\s*\{\s*scrollbar-gutter: stable/s,
  );
  assert.match(css, /\.responsive-table,[\s\S]*scrollbar-gutter: auto/);
  assert.match(css, /A direct child viewport only scrolls/);
  assert.match(
    css,
    /\.equipment-catalog-count,[\s\S]*height: 44px[\s\S]*display: inline-flex[\s\S]*justify-content: center/,
  );
  assert.match(
    css,
    /\.catalog-master-action-group \.button[\s\S]*width: 154px[\s\S]*min-height: 42px/,
  );
  assert.match(master, /Canonical Table Shell Ownership/);
  assert.match(master, /BUG-UI-TABLE-RIGHT-EDGE-001/);
  assert.match(catalog, /catalog-master-action-group/);
  assert.match(catalog, /selected\.length !== 1/);
  assert.match(
    catalog,
    /editing\.length \? uiText\("Lưu chỉnh sửa"\) : uiText\("Sửa"\)/,
  );
  assert.match(personnel, /const hasChanges = dirty;/);
  assert.doesNotMatch(personnel, /emailCapabilityDirty/);
  assert.doesNotMatch(personnel, /function effectiveEmailCapability/);
  assert.doesNotMatch(personnel, /setEmailCapability\(false\)/);
  assert.match(
    personnelPage,
    /rows\.map\(\(row\) => `\$\{row\.id\}:\$\{row\.access_version\}`\)\.join\("\\|"\)/,
  );
  assert.match(
    personnelPage,
    /className="inline-toolbar-count-slot"[\s\S]*className="personnel-result-count inline-toolbar-count"/,
  );
  assert.match(
    classList,
    /className="inline-toolbar-count-slot class-result-count-slot"[\s\S]*className="class-result-count inline-toolbar-count"/,
  );
  assert.match(catalogImport, /const \[modalNotice, setModalNotice\]/);
  assert.match(catalogImport, /role="alert"/);
  assert.match(catalogImport, /stalePreviewMessage/);
});

test("UI V2 Master places repeated rules above family and page overrides", async () => {
  const master = await source("docs/UI_DESIGN_SYSTEM_V2_MASTER.md");

  assert.match(
    master,
    /Existing business\/security requirements[\s\S]*Global UI Master[\s\S]*Component \/ Family Master[\s\S]*Approved Page Override/,
  );
  assert.match(
    master,
    /A Page Override changes only the rule\s+it names\.[\s\S]*inherits global and family rules/,
  );
  assert.match(
    master,
    /1\. Classify it: Global, Component \/ Family, or Page Override\.[\s\S]*4\. Add or update regression coverage\./,
  );
  assert.match(
    master,
    /This Master does not define authorization, role permissions, database or RPC[\s\S]*migration behavior/,
  );
  assert.match(
    master,
    /Table shell, textual header alignment, body-cell safe inset, and responsive[\s\S]*Global UI Master contracts/,
  );
  assert.match(
    master,
    /This is a Component \/ Family Master\. Catalog pages inherit the Global Control/,
  );
  assert.match(
    master,
    /Inherits the Table Master\. This override defines Personnel column semantics/,
  );
  assert.match(
    master,
    /Calendar detail drawer family[\s\S]*Native date, time, and select controls[\s\S]*must never clip or overflow the drawer/,
  );
  assert.doesNotMatch(master, /table header center|Table header centered/i);
});
