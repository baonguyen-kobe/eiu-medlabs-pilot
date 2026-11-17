import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import {
  assertLocalDestructiveTestTarget,
  resolveEffectiveSupabaseTestConfig,
} from "../helpers/local-test-safety.mjs";
import { clickUntilState } from "./helpers/interaction-readiness";

const validSignature =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function runLocalSql(sql: string) {
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

async function localConfig() {
  const text = await readFile(
    new URL("../../.env.local", import.meta.url),
    "utf8",
  );
  const fileEnv = Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const [key, ...value] = line.split("=");
        return [key, value.join("=")];
      }),
  );
  return resolveEffectiveSupabaseTestConfig(process.env, fileEnv);
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await clickUntilState(
    page.locator('button[type="submit"]'),
    () =>
      expect(page).toHaveURL(/\/(dashboard|basic-medical\/schedules)$/, {
        timeout: 1_500,
      }),
    async () => {
      // Hydration can replace the server-rendered form and clear an early fill.
      // Refill on every bounded retry before submitting the React-owned form.
      await page.locator('input[name="email"]').fill(email);
      await page.locator('input[name="password"]').fill(password);
    },
  );
}

function evidenceCounts(confirmationId: string) {
  return JSON.parse(
    runLocalSql(`
      select json_build_object(
        'confirmation', (select count(*) from public.basic_medical_session_confirmations where id = '${confirmationId}'),
        'checks', (select count(*) from public.basic_medical_session_equipment_checks where confirmation_id = '${confirmationId}'),
        'logs', (select count(*) from public.basic_medical_equipment_condition_logs where confirmation_id = '${confirmationId}'),
        'outbox', (select count(*) from public.email_outbox_events where event_key = 'basic_medical:damage:${confirmationId}'),
        'audit', (select count(*) from public.audit_logs where entity_id = '${confirmationId}')
      )::text;
    `),
  );
}

test("authorized evidence page and PDF use immutable display snapshots without reads causing mutations", async ({
  browser,
  page,
}) => {
  const config = await localConfig();
  assertLocalDestructiveTestTarget({
    supabaseUrl: config.supabaseUrl,
    playwrightBaseUrl: process.env.PLAYWRIGHT_BASE_URL,
  });
  expect(config.secretKey).toBeTruthy();
  const service = createClient(config.supabaseUrl!, config.secretKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const suffix = crypto.randomUUID().slice(0, 8);
  const ids = Object.fromEntries(
    [
      "course",
      "room",
      "catalog",
      "inventory",
      "registration",
      "schedule",
      "session",
      "confirmation",
    ].map((name) => [name, crypto.randomUUID()]),
  ) as Record<string, string>;
  const lecturerEmail = `evidence-${suffix}@campus.local`;
  const outsiderEmail = `evidence-outsider-${suffix}@campus.local`;
  const password = "LocalEvidence123!";
  let lecturerId: string | null = null;
  let outsiderId: string | null = null;
  let primaryError: unknown;

  try {
    const [lecturer, outsider] = await Promise.all([
      service.auth.admin.createUser({
        email: lecturerEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: `Giảng viên snapshot ${suffix}` },
        app_metadata: { preapproved: true },
      }),
      service.auth.admin.createUser({
        email: outsiderEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: `Ngoài scope ${suffix}` },
        app_metadata: { preapproved: true },
      }),
    ]);
    expect(lecturer.error).toBeNull();
    expect(outsider.error).toBeNull();
    lecturerId = lecturer.data.user!.id;
    outsiderId = outsider.data.user!.id;

    runLocalSql(`
      begin;
      select set_config('app.basic_medical_registration_mutation', 'true', true);
      update public.profiles set is_active = true where id in ('${lecturerId}', '${outsiderId}');
      insert into public.user_roles (user_id, role) values
        ('${lecturerId}', 'lecturer'), ('${outsiderId}', 'staff');
      insert into public.profile_room_types (profile_id, room_type_id, receive_schedule_emails)
      select '${lecturerId}', id, false from public.room_types where code = 'basic_medical'
      on conflict do nothing;
      insert into public.profile_room_types (profile_id, room_type_id, receive_schedule_emails)
      select '${outsiderId}', id, false from public.room_types where code = 'nursing_skills'
      on conflict do nothing;
      insert into public.courses (id, course_code, course_name, room_type_id, is_active)
      select '${ids.course}', 'EV-${suffix}', 'Học phần snapshot ${suffix}', id, true
      from public.room_types where code = 'basic_medical';
      insert into public.rooms (id, room_code, building_code, room_name, room_type_id, capacity, is_active)
      select '${ids.room}', 'EV-${suffix}', 'TÒA-A', 'Phòng snapshot ${suffix}', id, 20, true
      from public.room_types where code = 'basic_medical';
      insert into public.basic_medical_equipment_catalog (id, item_name, commercial_name, unit, is_active)
      values ('${ids.catalog}', 'Thiết bị snapshot ${suffix}', 'Thương mại snapshot ${suffix}', 'bộ', true);
      insert into public.basic_medical_room_inventory
        (id, room_id, catalog_item_id, total_quantity, good_quantity, damaged_quantity, is_active)
      values ('${ids.inventory}', '${ids.room}', '${ids.catalog}', 5, 5, 0, true);
      insert into public.basic_medical_registrations
        (id, academic_year, semester, start_date, end_date, course_id, room_id,
         student_count, registrant_id, responsible_lecturer_id, created_by)
      values ('${ids.registration}', '2045-2046', 'HK1', '2045-08-11', '2045-08-11',
        '${ids.course}', '${ids.room}', 10, '${lecturerId}', '${lecturerId}', '${lecturerId}');
      insert into public.class_schedules
        (id, course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id,
         schedule_date, start_time, end_time, source, schedule_status, student_count,
         basic_medical_registration_id, created_by, published_by, published_at)
      values ('${ids.schedule}', '${ids.course}', 'EV-${suffix}', 'Học phần snapshot ${suffix}',
        '${ids.room}', '${lecturerId}', '2045-08-11', '08:00', '10:00', 'manual', 'published',
        10, '${ids.registration}', '${lecturerId}', '${lecturerId}', clock_timestamp());
      insert into public.basic_medical_registration_sessions
        (id, registration_id, class_schedule_id, lesson_title, teaching_lecturer_id, session_number)
      values ('${ids.session}', '${ids.registration}', '${ids.schedule}', 'Buổi snapshot ${suffix}', '${lecturerId}', 1);
      insert into public.basic_medical_session_confirmations
        (id, session_id, registration_id_snapshot, class_schedule_id_snapshot, signer_id,
         signature_data, schedule_date_snapshot, start_time_snapshot, end_time_snapshot,
         room_id_snapshot, teaching_lecturer_id_snapshot, signed_at)
      values ('${ids.confirmation}', '${ids.session}', '${ids.registration}', '${ids.schedule}', '${lecturerId}',
        '${validSignature}', '2045-08-11', '08:00', '10:00', '${ids.room}', '${lecturerId}', clock_timestamp());
      insert into public.basic_medical_session_equipment_checks
        (confirmation_id, inventory_id, item_name_snapshot, commercial_name_snapshot, unit_snapshot,
         total_before, good_before, damaged_before, newly_damaged_quantity, good_after, damaged_after)
      values ('${ids.confirmation}', '${ids.inventory}', 'Thiết bị snapshot ${suffix}',
        'Thương mại snapshot ${suffix}', 'bộ', 5, 5, 0, 0, 5, 0);
      update public.courses set course_code = 'CURRENT-${suffix}', course_name = 'Tên môn hiện tại'
      where id = '${ids.course}';
      update public.rooms set room_code = 'CURRENT-ROOM', building_code = 'CURRENT-BUILDING', room_name = 'Phòng hiện tại'
      where id = '${ids.room}';
      update public.profiles set full_name = 'Tên giảng viên hiện tại' where id = '${lecturerId}';
      update public.basic_medical_equipment_catalog
      set item_name = 'Thiết bị hiện tại', commercial_name = 'Thương mại hiện tại'
      where id = '${ids.catalog}';
      commit;
    `);

    await login(page, lecturerEmail, password);
    expect(config.publishableKey).toBeTruthy();
    const lecturerClient = createClient(
      config.supabaseUrl!,
      config.publishableKey!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: lecturerLoginError } =
      await lecturerClient.auth.signInWithPassword({
        email: lecturerEmail,
        password,
      });
    expect(lecturerLoginError).toBeNull();
    const { data: registrationRows, error: registrationLoadError } =
      await lecturerClient
        .from("basic_medical_registrations")
        .select(
          "id,basic_medical_registration_sessions(id,confirmations:basic_medical_session_confirmations(id,signer_name_snapshot,signed_at,invalidated_at,invalidated_by,invalidated_by_name_snapshot,invalidated_reason))",
        )
        .eq("id", ids.registration);
    expect(registrationLoadError).toBeNull();
    expect(
      registrationRows?.[0]?.basic_medical_registration_sessions?.[0]
        ?.confirmations?.[0]?.signer_name_snapshot,
    ).toBe(`Giảng viên snapshot ${suffix}`);
    expect(JSON.stringify(registrationRows)).not.toContain(validSignature);

    await page.goto(
      `/basic-medical/registrations?status=all&q=CURRENT-${suffix}`,
    );
    await expect(page.getByText(/permission denied/i)).toHaveCount(0);
    await expect(
      page.locator(".basic-medical-registration-table"),
    ).toContainText(`CURRENT-${suffix}`);
    await expect(
      page.locator(".basic-medical-registration-table .request-status"),
    ).toContainText("Hoàn thành");

    const before = evidenceCounts(ids.confirmation);
    await page.goto(
      `/basic-medical/registrations/confirmations/${ids.confirmation}`,
    );
    await expect(
      page.getByRole("heading", { name: "BẰNG CHỨNG XÁC NHẬN Y CƠ SỞ" }),
    ).toBeVisible();
    await expect(page.getByText(`Học phần snapshot ${suffix}`)).toBeVisible();
    await expect(
      page.getByText(`TÒA-A · EV-${suffix} · Phòng snapshot ${suffix}`),
    ).toBeVisible();
    await expect(page.getByText(`Giảng viên snapshot ${suffix}`)).toHaveCount(
      2,
    );
    await expect(page.getByText("Tên môn hiện tại")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Xuất PDF" })).toBeVisible();
    await page.getByText("5. Thông tin kỹ thuật").click();
    await expect(
      page.getByText(ids.confirmation, { exact: true }),
    ).toBeVisible();

    const pdf = await page.request.get(
      `/api/basic-medical/registrations/confirmations/${ids.confirmation}/pdf`,
    );
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect(pdf.headers()["content-disposition"]).toContain("attachment");
    const pdfBody = await pdf.body();
    expect(pdfBody.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(pdfBody.byteLength).toBeGreaterThan(1_000);
    expect(evidenceCounts(ids.confirmation)).toEqual(before);

    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
    const outsiderContext = await browser.newContext({ baseURL });
    try {
      const outsiderPage = await outsiderContext.newPage();
      await login(outsiderPage, outsiderEmail, password);
      const denied = await outsiderPage.request.get(
        `/api/basic-medical/registrations/confirmations/${ids.confirmation}/pdf`,
      );
      expect(denied.status()).toBe(404);
    } finally {
      await outsiderContext.close();
    }

    const anonymousContext = await browser.newContext({ baseURL });
    try {
      const denied = await anonymousContext.request.get(
        `/api/basic-medical/registrations/confirmations/${ids.confirmation}/pdf`,
      );
      expect(denied.status()).toBe(401);
    } finally {
      await anonymousContext.close();
    }
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors: unknown[] = [];
    try {
      runLocalSql(`
        begin;
        select set_config('app.basic_medical_registration_mutation', 'true', true);
        delete from public.basic_medical_equipment_condition_logs where inventory_id = '${ids.inventory}';
        delete from public.basic_medical_session_equipment_checks where confirmation_id = '${ids.confirmation}';
        delete from public.basic_medical_session_confirmations where id = '${ids.confirmation}';
        delete from public.basic_medical_registration_sessions where id = '${ids.session}';
        delete from public.class_schedules where id = '${ids.schedule}';
        delete from public.basic_medical_registrations where id = '${ids.registration}';
        delete from public.basic_medical_room_inventory where id = '${ids.inventory}';
        delete from public.basic_medical_equipment_catalog where id = '${ids.catalog}';
        delete from public.rooms where id = '${ids.room}';
        delete from public.courses where id = '${ids.course}';
        commit;
      `);
    } catch (error) {
      cleanupErrors.push(error);
    }
    for (const id of [lecturerId, outsiderId]) {
      if (!id) continue;
      const { error } = await service.auth.admin.deleteUser(id);
      if (error) cleanupErrors.push(error);
    }
    if (primaryError) throw primaryError;
    if (cleanupErrors.length) {
      throw new AggregateError(
        cleanupErrors,
        "Evidence PDF fixture cleanup failed",
      );
    }
  }
});
