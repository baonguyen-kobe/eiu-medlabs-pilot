import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Wave 2 creates Basic Medical requests through the shared guarded RPC", async () => {
  const actions = await source("app/basic-medical/registrations/actions.ts");

  assert.match(actions, /createBasicMedicalEquipmentRequest/);
  assert.match(actions, /basic_medical_registration_sessions/);
  assert.match(actions, /basic_medical_equipment_catalog/);
  assert.match(actions, /create_equipment_request_with_items/);
  assert.match(actions, /skill_name: source\.lesson_title/);
  assert.match(actions, /error\?\.code === "23505"/);
  assert.match(actions, /Buổi học này đã có phiếu đăng ký thiết bị/);
  assert.match(actions, /after\(\(\) => processPendingEmailOutbox\(\)\)/);
});

test("Wave 2 uses a separate page-based Basic Medical registration form", async () => {
  const [
    registerPage,
    workspacePage,
    registrationPage,
    list,
    form,
    basicMedicalPage,
  ] = await Promise.all([
    source("app/equipment/register/page.tsx"),
    source("app/basic-medical/equipment-requests/page.tsx"),
    source("app/basic-medical/registrations/page.tsx"),
    source("components/basic-medical-registration-list.tsx"),
    source("components/basic-medical-equipment-request-form.tsx"),
    source("components/basic-medical-equipment-registration-page.tsx"),
  ]);

  assert.match(registrationPage, /\.eq\("request_domain", "basic_medical"\)/);
  assert.match(registrationPage, /\.in\("source_identity_id", sessionIds\)/);
  assert.match(registrationPage, /equipmentRequestsBySession/);
  assert.match(list, /Phiếu thiết bị đã hủy/);
  assert.match(list, /Xem phiếu thiết bị/);
  assert.match(list, /Đăng ký thiết bị/);
  assert.doesNotMatch(registerPage, /BasicMedicalEquipmentRegistrationPage/);
  assert.doesNotMatch(registerPage, /query\.domain/);
  assert.doesNotMatch(registerPage, /EquipmentRegistrationDomainSwitch/);
  assert.match(workspacePage, /BasicMedicalEquipmentRegistrationPage/);
  assert.match(workspacePage, /canUseBasicMedicalEquipmentRegistration/);
  assert.match(basicMedicalPage, /\.in\("source_identity_id", sourceIds\)/);
  assert.match(basicMedicalPage, /requestsBySession/);
  assert.match(basicMedicalPage, /function sessionCanCreateEquipmentRequest/);
  assert.match(
    basicMedicalPage,
    /session\.class_schedules\.schedule_date >= today/,
  );
  assert.match(
    basicMedicalPage,
    /sessionCanCreateEquipmentRequest\([\s\S]*?today/,
  );
  assert.match(basicMedicalPage, /canEditSelected && initialData/);
  assert.match(basicMedicalPage, /BasicMedicalRequestModePicker/);
  assert.match(basicMedicalPage, /request_domain", "basic_medical"/);
  assert.match(form, /SearchableCombobox/);
  assert.match(form, /schedule-form equipment-request-form/);
  assert.match(form, /form-section-number/);
  assert.match(form, /equipment-items-table/);
  assert.match(form, /value=\{session\.lesson_title\} readOnly/);
  assert.match(form, /equipmentRegistrant\.fullName/);
  assert.match(form, /formatDate\(scheduleDate\)/);
  assert.match(form, /className="equipment-late-warning" role="alert"/);
  assert.match(form, /<\/table>\s*<\/div>\s*<button[\s\S]*?\+ Thêm dòng/);
  assert.doesNotMatch(form, /createPortal/);
  assert.match(
    list,
    /<Link[\s\S]*?href=\{`\/basic-medical\/equipment-requests\?session=\$\{session\.id\}`\}/,
  );
  assert.doesNotMatch(list, /activeEquipmentRequest/);
  assert.match(list, /session\.class_schedules\.schedule_date >=\s*today/);
});

test("equipment registration route preserves Skills default and adds Basic Medical access", async () => {
  const [page, shell, access] = await Promise.all([
    source("app/equipment/register/page.tsx"),
    source("components/workspace-shell.tsx"),
    source("lib/workspace-access.ts"),
  ]);

  assert.doesNotMatch(page, /query\.domain/);
  assert.doesNotMatch(page, /basic_medical/);
  assert.doesNotMatch(page, /BasicMedicalEquipmentRegistrationPage/);
  assert.match(access, /canUseBasicMedicalEquipmentRegistration/);
  assert.match(shell, /canUseBasicMedicalEquipmentRegistration/);
  assert.match(shell, /href: "\/basic-medical\/equipment-requests"/);
  assert.equal((shell.match(/label: "Đăng ký thiết bị"/g) ?? []).length, 2);
});

test("Basic Medical create refreshes the selected page after the guarded action", async () => {
  const [actions, form] = await Promise.all([
    source("app/basic-medical/registrations/actions.ts"),
    source("components/basic-medical-equipment-request-form.tsx"),
  ]);

  assert.match(
    actions,
    /revalidatePath\("\/basic-medical\/equipment-requests"\)/,
  );
  assert.match(form, /router\.refresh\(\)/);
  assert.doesNotMatch(form, /router\.replace/);
});

test("Basic Medical edit and copy remain domain-local and immutable", async () => {
  const [page, form, actions, migration, schema, emailMigration] =
    await Promise.all([
      source("components/basic-medical-equipment-registration-page.tsx"),
      source("components/basic-medical-equipment-request-form.tsx"),
      source("app/basic-medical/registrations/actions.ts"),
      source(
        "supabase/migrations/20260823110000_basic_medical_equipment_request_edit.sql",
      ),
      source("supabase/schemas/03_registration_workflows.sql"),
      source(
        "supabase/migrations/20260823120000_basic_medical_equipment_request_email.sql",
      ),
    ]);

  assert.match(page, /BasicMedicalRequestModePicker/);
  assert.match(page, /request_domain", "basic_medical"/);
  assert.match(page, /equipmentRequestCodeBounds/);
  assert.match(form, /mode: "edit" \| "copy"/);
  assert.match(form, /updateBasicMedicalEquipmentRequest/);
  assert.match(actions, /update_basic_medical_equipment_request_content/);
  assert.match(actions, /after\(\(\) => processPendingEmailOutbox\(\)\)/);
  for (const sql of [migration, schema]) {
    assert.match(sql, /update_basic_medical_equipment_request_content/);
    assert.match(sql, /request_domain = 'basic_medical'/);
    assert.match(sql, /basic_medical_equipment_catalog/);
    assert.match(sql, /basic_medical_catalog_item_id/);
    assert.match(sql, /source_row\.lesson_title/);
  }
  assert.doesNotMatch(migration, /enqueue_equipment_request_outbox_event/);
  assert.match(emailMigration, /enqueue_equipment_request_outbox_event/);
});

test("Basic Medical session selection reuses the Skills picker layout without changing access", async () => {
  const [selector, page] = await Promise.all([
    source("components/basic-medical-equipment-session-selector.tsx"),
    source("components/basic-medical-equipment-registration-page.tsx"),
  ]);

  assert.match(selector, /className="class-picker-row"/);
  assert.doesNotMatch(selector, /className="data-panel"/);
  assert.match(selector, /Buổi học Y cơ sở \*/);
  assert.match(
    selector,
    /placeholder=\{uiText\("Chọn buổi học theo ngày, giờ và phòng"\)\}/,
  );
  assert.match(selector, /\+ Tạo lịch Y cơ sở/);
  assert.match(selector, /href="\/basic-medical\/new"/);
  assert.doesNotMatch(selector, /schedule-entry\/new/);
  assert.match(
    page,
    /canManageBasicMedical \|\|[\s\S]*?registration\.created_by === userId[\s\S]*?registration\.registrant_id === userId[\s\S]*?session\.teaching_lecturer_id === userId/,
  );
  assert.match(page, /\["new", "preparing"\]\.includes\(request\.status\)/);
  assert.match(
    page,
    /canManageBasicMedical \|\| request\.registrant_id === userId/,
  );
  assert.match(page, /mode === "copy" && canUseSource/);
  assert.match(page, /!requestsBySession\.has\(session\.id\)/);
});

test("Root assignment safety keeps Root as requester rather than a teaching lecturer", async () => {
  const [page, actions] = await Promise.all([
    source("components/basic-medical-equipment-registration-page.tsx"),
    source("app/basic-medical/registrations/actions.ts"),
  ]);

  assert.match(page, /rootAdminAssignedToSession/);
  assert.match(page, /!selectedHasRootAssignment/);
  assert.match(
    page,
    /đang phân công Root Admin làm giảng viên[\s\S]*?giảng viên giảng dạy\/hướng dẫn/,
  );
  assert.match(actions, /ROOT_ADMIN_OPERATIONAL_ASSIGNMENT_FORBIDDEN/);
  assert.match(actions, /target_responsible_lecturer_id: null/);
});

test("shared request list renders the catalog that belongs to its domain", async () => {
  const list = await source("components/equipment-request-list.tsx");

  assert.match(list, /function catalogForRequest/);
  assert.match(list, /item\.basic_medical_equipment_catalog/);
  assert.match(list, /canAddItemsForRequest/);
  assert.match(list, /request\.request_domain === "nursing_skills"/);
  assert.match(list, /function domainLabel/);
  assert.match(list, /equipmentRequestWorkflowStatuses\.map/);
  assert.match(list, /Kỹ năng Điều dưỡng/);
});

test("display, manager, and import statuses remain separate", async () => {
  const [requests, actions, values] = await Promise.all([
    source("lib/equipment-requests.ts"),
    source("app/equipment/actions.ts"),
    source("lib/equipment-import-values.ts"),
  ]);
  assert.match(requests, /equipmentRequestWorkflowStatuses/);
  assert.match(requests, /type EquipmentRequestWorkflowStatus/);
  assert.match(requests, /value: "cancelled"/);
  assert.match(actions, /equipmentRequestWorkflowStatuses\.map/);
  assert.match(actions, /status: EquipmentRequestWorkflowStatus/);
  const list = await source("components/equipment-request-list.tsx");
  assert.match(list, /status: EquipmentRequestWorkflowStatus/);
  assert.match(
    values,
    /type EquipmentImportStatus = Exclude<EquipmentRequestStatus, "cancelled">/,
  );
  assert.doesNotMatch(values, /\["cancelled", "cancelled"\]/);
});
