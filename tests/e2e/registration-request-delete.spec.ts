import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createP1LocalClient } from "../helpers/inventory-p1-runtime.mjs";
import { cleanupLegacyRequest } from "../helpers/legacy-equipment-fixture.mjs";

const adminSql =
  "(select id from public.profiles where email = 'admin@campus.local')";
const lecturerSql =
  "(select id from public.profiles where email = 'giangvien@campus.local')";
const courseId = "10000000-0000-0000-0000-000000000001";
const localSql = (query: string) => createP1LocalClient().sql(query);
const skillRoomId = crypto.randomUUID();
const basicRoomId = crypto.randomUUID();
const equipmentScheduleId = crypto.randomUUID();
const equipmentRequestId = crypto.randomUUID();
const equipmentItemId = crypto.randomUUID();
const catalogItemId = crypto.randomUUID();
const registrationId = crypto.randomUUID();
const basicScheduleId = crypto.randomUUID();
const basicSessionId = crypto.randomUUID();

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("admin@campus.local");
  await page.locator('input[name="password"]').fill("LocalAdmin123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("Admin hủy phiếu Y cơ sở và xóa phiếu thiết bị trên giao diện", async ({
  page,
}) => {
  const envText = await readFile(
    new URL("../../.env.local", import.meta.url),
    "utf8",
  );
  const env = Object.fromEntries(
    envText
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const [key, ...value] = line.split("=");
        return [key, value.join("=")];
      }),
  );
  const databaseClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: signInError } = await databaseClient.auth.signInWithPassword({
    email: "admin@campus.local",
    password: "LocalAdmin123!",
  });
  expect(signInError).toBeNull();

  try {
    // Direct table writes are closed to signed-in users and the request and
    // registration guards need their command context, so seed through SQL.
    await localSql(`
      begin;
      select set_config('request.jwt.claims', jsonb_build_object('sub', ${adminSql}, 'role', 'authenticated')::text, true);
      select set_config('app.basic_medical_registration_mutation', 'true', true);
      insert into public.rooms (id, room_code, building_code, room_type_id) values
        ('${skillRoomId}', 'E2E-SKILL-DELETE', 'QA', '40000000-0000-0000-0000-000000000001'),
        ('${basicRoomId}', 'E2E-BASIC-DELETE', 'QA', '40000000-0000-0000-0000-000000000002');
      insert into public.class_schedules
        (id, course_id, course_code_snapshot, course_name_snapshot, room_id, schedule_date, start_time,
         end_time, source, schedule_status, student_count, semester, created_by, published_by, published_at)
      values ('${equipmentScheduleId}', '${courseId}', 'DELETE-EQUIPMENT', 'Kiểm thử xóa phiếu thiết bị',
        '${skillRoomId}', '2044-08-20', '07:30', '11:30', 'manual', 'published', 20, 'HK1', ${adminSql}, ${adminSql}, clock_timestamp());
      insert into public.equipment_requests
        (id, class_schedule_id, semester, registrant_id, responsible_lecturer_id, phone_snapshot,
         email_snapshot, receive_at, return_at, status, created_by)
      values ('${equipmentRequestId}', '${equipmentScheduleId}', 'HK1', ${adminSql}, ${lecturerSql}, '0901000001',
        'admin@campus.local', '2044-08-20T02:00:00Z', '2044-08-20T04:00:00Z', 'new', ${adminSql});
      insert into public.equipment_catalog (id, item_name, commercial_name, unit)
      values ('${catalogItemId}', 'E2E DELETE ITEM', 'E2E DELETE ITEM ${catalogItemId}', 'Cái');
      select set_config('app.s4_registration', '${equipmentRequestId}', true);
      insert into public.equipment_request_items (id, request_id, skill_name, catalog_item_id, quantity)
      values ('${equipmentItemId}', '${equipmentRequestId}', 'Kiểm thử xóa phiếu', '${catalogItemId}', 1);
      insert into public.basic_medical_registrations
        (id, academic_year, semester, start_date, end_date, course_id, room_id, student_count,
         registrant_id, responsible_lecturer_id, note, created_by)
      values ('${registrationId}', '2044-2045', 'HK1', '2044-08-21', '2044-08-21', '${courseId}', '${basicRoomId}', 20,
        ${adminSql}, ${lecturerSql}, 'E2E DELETE BASIC MEDICAL', ${adminSql});
      insert into public.class_schedules
        (id, course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id, schedule_date,
         start_time, end_time, source, schedule_status, student_count, basic_medical_registration_id,
         created_by, published_by, published_at)
      values ('${basicScheduleId}', '${courseId}', 'DELETE-BASIC', 'Kiểm thử xóa phiếu Y cơ sở', '${basicRoomId}',
        ${lecturerSql}, '2044-08-21', '07:30', '11:30', 'manual', 'published', 20, '${registrationId}',
        ${adminSql}, ${adminSql}, clock_timestamp());
      insert into public.basic_medical_registration_sessions
        (id, registration_id, class_schedule_id, lesson_title, teaching_lecturer_id, session_number)
      values ('${basicSessionId}', '${registrationId}', '${basicScheduleId}', 'E2E DELETE BASIC MEDICAL', ${lecturerSql}, 1);
      commit;
    `);

    await loginAsAdmin(page);
    await page.goto("/equipment/register");
    const editModeButton = page.getByText("Điều chỉnh phiếu", {
      exact: true,
    });
    const copyModeButton = page.getByText("Sao chép phiếu", { exact: true });
    await expect(editModeButton).toHaveCSS(
      "background-color",
      "rgb(255, 247, 237)",
    );
    await expect(copyModeButton).toHaveCSS(
      "background-color",
      "rgb(245, 243, 255)",
    );
    await copyModeButton.click();
    await expect(page.locator('input[name="request"]')).toHaveAttribute(
      "placeholder",
      "Nhập mã phiếu, ví dụ: 123465789356",
    );

    await page.goto("/basic-medical/registrations");
    // A Y cơ sở registration is cancelled, not deleted: its rows are kept.
    const registrationCard = page
      .locator(".basic-medical-registration-table tbody")
      .filter({ hasText: "E2E-BASIC-DELETE" });
    await registrationCard.locator("tr").first().click();
    await registrationCard
      .getByRole("button", { name: "Hủy phiếu", exact: true })
      .click();
    const registrationDialog = page.getByRole("dialog", {
      name: "Xác nhận thao tác",
    });
    await expect(registrationDialog).toBeVisible();
    await registrationDialog
      .getByRole("button", { name: "Xác nhận", exact: true })
      .click();
    await expect(page.getByText("Đã hủy phiếu Y cơ sở.")).toBeVisible();

    await page.goto("/equipment/requests");
    await page
      .locator(".equipment-request-filters .data-search input")
      .fill(equipmentRequestId);
    const equipmentRow = page.locator(".equipment-request-list-item");
    await expect(equipmentRow).toHaveCount(1);
    await equipmentRow.locator(".equipment-request-summary").click();
    await expect(equipmentRow.getByText(/^\d{12}$/)).toBeVisible();
    await equipmentRow
      .getByRole("button", { name: "Xóa phiếu", exact: true })
      .click();
    const equipmentDialog = page.getByRole("dialog", {
      name: "Xóa phiếu thiết bị?",
    });
    await expect(equipmentDialog).toContainText(
      "Lớp Skills lab gốc vẫn được giữ lại",
    );
    await equipmentDialog
      .getByRole("button", { name: "Xóa phiếu", exact: true })
      .click();
    await expect(
      page.getByText("Đã xóa vĩnh viễn phiếu thiết bị."),
    ).toBeVisible();
    await expect(equipmentRow).toHaveCount(0);

    for (const [table, id, expected] of [
      ["basic_medical_registrations", registrationId, 1],
      ["basic_medical_registration_sessions", basicSessionId, 1],
      ["class_schedules", basicScheduleId, 1],
      ["equipment_requests", equipmentRequestId, 0],
      ["equipment_request_items", equipmentItemId, 0],
      ["class_schedules", equipmentScheduleId, 1],
    ] as const) {
      const { data, error } = await databaseClient
        .from(table)
        .select("id")
        .eq("id", id);
      expect(error).toBeNull();
      expect(data).toHaveLength(expected);
    }
  } finally {
    await cleanupLegacyRequest(equipmentRequestId);
    await localSql(`
      begin;
      select set_config('app.basic_medical_registration_mutation', 'true', true);
      delete from public.basic_medical_registration_sessions where id = '${basicSessionId}';
      delete from public.class_schedules where id in ('${equipmentScheduleId}', '${basicScheduleId}');
      delete from public.basic_medical_registrations where id = '${registrationId}';
      delete from public.equipment_catalog where id = '${catalogItemId}';
      delete from public.rooms where id in ('${skillRoomId}', '${basicRoomId}');
      commit;
    `);
  }
});
