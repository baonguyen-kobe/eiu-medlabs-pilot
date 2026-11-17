import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { clickUntilState } from "./helpers/interaction-readiness";

const signature =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function localSql(sql: string) {
  const listed = spawnSync(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${process.env.SUPABASE_LOCAL_PROJECT_ID ?? "lich-truc-app"}`,
      "--format",
      "{{.Names}}",
    ],
    { encoding: "utf8" },
  );
  const databases = listed.stdout
    .split(/\r?\n/)
    .filter((name) => name.startsWith("supabase_db_"));
  if (listed.status !== 0 || databases.length !== 1) {
    throw new Error("REFUSING_AMBIGUOUS_LOCAL_SUPABASE_DATABASE");
  }
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      databases[0],
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: sql, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "LOCAL_SQL_FAILED");
  }
  return result.stdout.trim();
}

async function login(page: Page) {
  await page.goto("/login");
  await clickUntilState(
    page.locator('button[type="submit"]'),
    () => expect(page).toHaveURL(/\/dashboard$/, { timeout: 1_000 }),
    async () => {
      await page.locator('input[name="email"]').fill("admin@campus.local");
      await page.locator('input[name="password"]').fill("LocalAdmin123!");
    },
  );
}

test("Basic Medical calendar uses confirmation-aware cancellation and invalidation actions", async ({
  page,
}) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const ids = Object.fromEntries(
    [
      "course",
      "room",
      "catalog",
      "inventory",
      "registration",
      "unconfirmedSchedule",
      "confirmedSchedule",
      "unconfirmedSession",
      "confirmedSession",
      "confirmation",
    ].map((name) => [name, crypto.randomUUID()]),
  ) as Record<string, string>;
  const unconfirmedCode = `CAL-U-${suffix}`;
  const confirmedCode = `CAL-C-${suffix}`;
  const date = "2045-08-11";
  const adminId = localSql(
    "select id from public.profiles where email = 'admin@campus.local' limit 1;",
  );
  const lecturerId = localSql(
    "select id from public.profiles where email = 'giangvien@campus.local' limit 1;",
  );

  try {
    localSql(`
      begin;
      select set_config('app.basic_medical_registration_mutation', 'true', true);
      insert into public.courses (id, course_code, course_name, room_type_id, is_active)
      select '${ids.course}', '${unconfirmedCode}', 'Calendar fixture ${suffix}', id, true
      from public.room_types where code = 'basic_medical';
      insert into public.rooms (id, room_code, building_code, room_name, room_type_id, capacity, is_active)
      select '${ids.room}', 'CAL-${suffix}', 'E2E', 'Calendar room ${suffix}', id, 20, true
      from public.room_types where code = 'basic_medical';
      insert into public.basic_medical_equipment_catalog (id, item_name, commercial_name, unit, is_active)
      values ('${ids.catalog}', 'Calendar item ${suffix}', 'Calendar commercial ${suffix}', 'piece', true);
      insert into public.basic_medical_room_inventory
        (id, room_id, catalog_item_id, total_quantity, good_quantity, damaged_quantity, is_active)
      values ('${ids.inventory}', '${ids.room}', '${ids.catalog}', 5, 5, 0, true);
      insert into public.basic_medical_registrations
        (id, academic_year, semester, start_date, end_date, course_id, room_id, student_count,
         registrant_id, responsible_lecturer_id, created_by)
      values ('${ids.registration}', '2045-2046', 'HK1', '${date}', '${date}', '${ids.course}',
        '${ids.room}', 10, '${adminId}', '${lecturerId}', '${adminId}');
      insert into public.class_schedules
        (id, course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id, schedule_date,
         start_time, end_time, source, schedule_status, student_count, basic_medical_registration_id,
         created_by, published_by, published_at)
      values
        ('${ids.unconfirmedSchedule}', '${ids.course}', '${unconfirmedCode}', 'Calendar unconfirmed ${suffix}', '${ids.room}', '${lecturerId}', '${date}', '08:00', '10:00', 'manual', 'published', 10, '${ids.registration}', '${adminId}', '${adminId}', clock_timestamp()),
        ('${ids.confirmedSchedule}', '${ids.course}', '${confirmedCode}', 'Calendar confirmed ${suffix}', '${ids.room}', '${lecturerId}', '${date}', '10:30', '12:30', 'manual', 'published', 10, '${ids.registration}', '${adminId}', '${adminId}', clock_timestamp());
      insert into public.basic_medical_registration_sessions
        (id, registration_id, class_schedule_id, lesson_title, teaching_lecturer_id, session_number)
      values
        ('${ids.unconfirmedSession}', '${ids.registration}', '${ids.unconfirmedSchedule}', 'Unconfirmed ${suffix}', '${lecturerId}', 1),
        ('${ids.confirmedSession}', '${ids.registration}', '${ids.confirmedSchedule}', 'Confirmed ${suffix}', '${lecturerId}', 2);
      insert into public.basic_medical_session_confirmations
        (id, session_id, registration_id_snapshot, class_schedule_id_snapshot, signer_id, signature_data,
         schedule_date_snapshot, start_time_snapshot, end_time_snapshot, room_id_snapshot,
         teaching_lecturer_id_snapshot, signer_name_snapshot, signed_at)
      values ('${ids.confirmation}', '${ids.confirmedSession}', '${ids.registration}', '${ids.confirmedSchedule}', '${lecturerId}', '${signature}',
         '${date}', '10:30', '12:30', '${ids.room}', '${lecturerId}', 'Calendar signer ${suffix}', clock_timestamp());
      insert into public.basic_medical_session_equipment_checks
        (confirmation_id, inventory_id, item_name_snapshot, commercial_name_snapshot, unit_snapshot,
         total_before, good_before, damaged_before, newly_damaged_quantity, good_after, damaged_after)
      values ('${ids.confirmation}', '${ids.inventory}', 'Calendar item ${suffix}', 'Calendar commercial ${suffix}', 'piece', 5, 5, 0, 0, 5, 0);
      commit;
    `);

    await login(page);
    await page.goto(`/basic-medical/schedules?view=week&date=${date}`);

    const unconfirmed = page
      .locator(".slot-event-class")
      .filter({ hasText: unconfirmedCode });
    await expect(unconfirmed).toBeVisible();
    await clickUntilState(unconfirmed, () =>
      expect(page.getByLabel("Chi tiết lịch")).toBeVisible({ timeout: 1_000 }),
    );
    await expect(page.getByRole("button", { name: "Hủy lớp" })).toBeVisible();
    await page.getByRole("button", { name: "Hủy lớp" }).click();
    const cancelDialog = page.getByRole("dialog", {
      name: "Hủy buổi học Y cơ sở?",
    });
    await clickUntilState(page.locator(".drawer-actions button").last(), () =>
      expect(cancelDialog).toBeVisible({ timeout: 1_000 }),
    );
    await cancelDialog.getByRole("button", { name: "Hủy buổi học" }).click();
    await expect(page.getByRole("status")).toContainText("lý do bắt buộc");
    await cancelDialog
      .getByLabel("Lý do hủy buổi học *")
      .fill("Calendar cancellation reason");
    await cancelDialog.getByRole("button", { name: "Hủy buổi học" }).click();
    await expect(cancelDialog).toHaveCount(0);
    // The dialog can close before the save commits; wait for the stored status.
    await expect
      .poll(() =>
        localSql(
          `select schedule_status from public.class_schedules where id = '${ids.unconfirmedSchedule}';`,
        ),
      )
      .toBe("cancelled");
    expect(
      localSql(
        `select schedule_status from public.class_schedules where id = '${ids.confirmedSchedule}';`,
      ),
    ).toBe("published");

    await page.goto(`/basic-medical/schedules?view=week&date=${date}`);
    const confirmed = page
      .locator(".slot-event-class")
      .filter({ hasText: confirmedCode });
    await expect(confirmed).toBeVisible();
    await clickUntilState(confirmed, () =>
      expect(page.getByLabel("Chi tiết lịch")).toBeVisible({ timeout: 1_000 }),
    );
    await expect(page.getByRole("button", { name: "Hủy lớp" })).toHaveCount(0);
    await page.getByRole("button", { name: "Vô hiệu hóa xác nhận" }).click();
    const invalidateDialog = page.getByRole("dialog", {
      name: "Vô hiệu hóa xác nhận buổi học?",
    });
    await clickUntilState(page.locator(".drawer-actions button").last(), () =>
      expect(invalidateDialog).toBeVisible({ timeout: 1_000 }),
    );
    await expect(invalidateDialog).toContainText(confirmedCode);
    await invalidateDialog.getByRole("button", { name: "Vô hiệu hóa" }).click();
    await expect(page.getByRole("status")).toContainText("lý do bắt buộc");
    await invalidateDialog
      .getByLabel("Lý do vô hiệu hóa *")
      .fill("Calendar invalidation reason");
    await invalidateDialog.getByRole("button", { name: "Vô hiệu hóa" }).click();
    await expect(invalidateDialog).toHaveCount(0);
    await expect
      .poll(() =>
        localSql(
          `select count(*) from public.basic_medical_session_confirmations where id = '${ids.confirmation}' and invalidated_at is not null;`,
        ),
      )
      .toBe("1");
    expect(
      localSql(
        `select count(*) from public.basic_medical_session_equipment_checks where confirmation_id = '${ids.confirmation}';`,
      ),
    ).toBe("1");
  } finally {
    localSql(`
      begin;
      select set_config('app.basic_medical_registration_mutation', 'true', true);
      delete from public.basic_medical_equipment_condition_logs where inventory_id = '${ids.inventory}';
      delete from public.basic_medical_session_equipment_checks where confirmation_id = '${ids.confirmation}';
      delete from public.basic_medical_session_confirmations where id = '${ids.confirmation}';
      delete from public.basic_medical_registration_sessions where registration_id = '${ids.registration}';
      delete from public.class_schedules where basic_medical_registration_id = '${ids.registration}';
      delete from public.basic_medical_registrations where id = '${ids.registration}';
      delete from public.basic_medical_room_inventory where id = '${ids.inventory}';
      delete from public.basic_medical_equipment_catalog where id = '${ids.catalog}';
      delete from public.rooms where id = '${ids.room}';
      delete from public.courses where id = '${ids.course}';
      commit;
    `);
  }
});
