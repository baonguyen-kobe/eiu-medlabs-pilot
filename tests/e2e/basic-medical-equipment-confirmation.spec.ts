import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

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

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("admin@campus.local");
  await page.locator('input[name="password"]').fill("LocalAdmin123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
}

async function loginAsStaff(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("staff@campus.local");
  await page.locator('input[name="password"]').fill("LocalStaff123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
}

test("Phiếu Y cơ sở hiển thị danh sách thu gọn và bộ lọc trạng thái", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/basic-medical/registrations");
  await expect(
    page.getByRole("heading", { name: "Phiếu Y cơ sở" }),
  ).toBeVisible();
  await expect(page.locator('select[name="status"]')).toHaveValue("incomplete");
  await expect(
    page.getByRole("columnheader", { name: "Trạng thái" }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Tìm mã môn, tên môn, phòng, giảng viên…"),
  ).toBeVisible();
});

test("Danh sách thiết bị Y cơ sở có đủ bốn tab và thao tác quản lý", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/basic-medical/equipment");
  await expect(
    page.getByRole("heading", { name: "Danh sách thiết bị Y cơ sở" }),
  ).toBeVisible();
  await expect(page.locator(".basic-medical-equipment-tabs a")).toHaveText([
    "Thiết bị",
    "Thiết bị theo phòng",
    "Thiết bị hư",
    "Log thay đổi",
  ]);
  const tabsBeforeManualForm = await page.evaluate(() => {
    const tabs = document.querySelector(".basic-medical-equipment-tabs");
    const form = document.querySelector(".equipment-catalog-create-form");
    return Boolean(
      tabs &&
      form &&
      tabs.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  expect(tabsBeforeManualForm).toBe(true);
  await expect(page.getByRole("link", { name: "Tải template" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Export tất cả" })).toBeVisible();
  await page.getByRole("link", { name: "Thiết bị theo phòng" }).click();
  await expect(page).toHaveURL(/tab=rooms/);
  await expect(
    page.getByRole("heading", { name: "Thiết bị theo phòng" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Thiết bị hư" }).click();
  await expect(page).toHaveURL(/tab=damaged/);
  await expect(
    page.getByPlaceholder("Tìm thiết bị, phòng, người thay đổi, ghi chú…"),
  ).toBeVisible();
});

test("Chuyên viên ngoài scope không thấy và không mở được thiết bị Y cơ sở", async ({
  page,
}) => {
  await loginAsStaff(page);
  // The single "Danh mục" entry now exists for Kho staff, but must point at the
  // inventory catalog, never at the Basic Medical one.
  await expect(page.locator('a[href^="/basic-medical/equipment"]')).toHaveCount(
    0,
  );
  await page.goto("/basic-medical/equipment");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("Hai page Y cơ sở mới không tràn màn hình mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);
  for (const path of [
    "/basic-medical/registrations",
    "/basic-medical/equipment",
  ]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test("Người xem Y cơ sở không truy cập Danh sách thiết bị Y cơ sở", async ({
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
  const service = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false } },
  );
  const email = `viewer-basic-${crypto.randomUUID()}@campus.local`;
  const password = "LocalViewer123!";
  const { data: adminProfile } = await service
    .from("profiles")
    .select("id")
    .eq("email", "admin@campus.local")
    .single();
  const { data: created, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Người xem Y cơ sở" },
    app_metadata: { preapproved: true },
  });
  expect(error).toBeNull();
  const userId = created.user!.id;
  try {
    const { error: profileError } = await service
      .from("profiles")
      .update({ is_active: true })
      .eq("id", userId);
    expect(profileError).toBeNull();
    const { error: roleError } = await service.from("user_roles").insert({
      user_id: userId,
      role: "viewer",
      created_by: adminProfile!.id,
    });
    expect(roleError).toBeNull();
    const { error: scopeError } = await service
      .from("profile_room_types")
      .insert({
        profile_id: userId,
        room_type_id: "40000000-0000-0000-0000-000000000002",
        created_by: adminProfile!.id,
        receive_schedule_emails: false,
      });
    expect(scopeError).toBeNull();
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(page).toHaveURL(/\/basic-medical\/schedules$/);
    await expect(
      page.getByRole("link", { name: "Danh mục", exact: true }),
    ).toHaveCount(0);
    await page.goto("/basic-medical/equipment");
    await expect(
      page.getByRole("heading", { name: "Danh sách thiết bị Y cơ sở" }),
    ).toBeVisible();
    await expect(page.getByText("Thêm thiết bị thủ công")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import mới" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: "Export tất cả" })).toHaveCount(
      0,
    );
    await page.goto("/basic-medical/registrations");
    await expect(
      page.getByRole("heading", { name: "Phiếu Y cơ sở" }),
    ).toBeVisible();
  } finally {
    await service.auth.admin.deleteUser(userId);
  }
});

test("Phiếu Y cơ sở: Trạng thái bên trái, nút Sửa/Lưu/Hủy bên phải hàng, Hủy lớp tách biệt bên dưới", async ({
  page,
}) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const ids = Object.fromEntries(
    [
      "course",
      "room",
      "registration",
      "schedule1",
      "schedule2",
      "session1",
      "session2",
    ].map((name) => [name, crypto.randomUUID()]),
  ) as Record<string, string>;

  const courseCode = `BM-UI-${suffix}`;
  const testDate = "2048-11-20";
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
      select '${ids.course}', '${courseCode}', 'BM UI test ${suffix}', id, true
      from public.room_types where code = 'basic_medical';
      insert into public.rooms (id, room_code, building_code, room_name, room_type_id, capacity, is_active)
      select '${ids.room}', 'R-${suffix}', 'E2E', 'Room ${suffix}', id, 20, true
      from public.room_types where code = 'basic_medical';
      insert into public.basic_medical_registrations
        (id, academic_year, semester, start_date, end_date, course_id, room_id, student_count,
         registrant_id, responsible_lecturer_id, created_by)
      values ('${ids.registration}', '2048-2049', 'HK1', '${testDate}', '${testDate}', '${ids.course}',
        '${ids.room}', 20, '${adminId}', '${lecturerId}', '${adminId}');
      insert into public.class_schedules
        (id, course_id, course_code_snapshot, course_name_snapshot, room_id, lecturer_id, schedule_date,
         start_time, end_time, source, schedule_status, student_count, basic_medical_registration_id,
         created_by, published_by, published_at)
      values
        ('${ids.schedule1}', '${ids.course}', '${courseCode}', 'Session 1 ${suffix}', '${ids.room}', '${lecturerId}', '${testDate}', '07:30', '11:30', 'manual', 'published', 20, '${ids.registration}', '${adminId}', '${adminId}', clock_timestamp()),
        ('${ids.schedule2}', '${ids.course}', '${courseCode}', 'Session 2 ${suffix}', '${ids.room}', '${lecturerId}', '${testDate}', '13:30', '16:30', 'manual', 'published', 20, '${ids.registration}', '${adminId}', '${adminId}', clock_timestamp());
      insert into public.basic_medical_registration_sessions
        (id, registration_id, class_schedule_id, lesson_title, teaching_lecturer_id, session_number)
      values
        ('${ids.session1}', '${ids.registration}', '${ids.schedule1}', 'Lesson 1 ${suffix}', '${lecturerId}', 1),
        ('${ids.session2}', '${ids.registration}', '${ids.schedule2}', 'Lesson 2 ${suffix}', '${lecturerId}', 2);
      commit;
    `);

    // 2. Test UI
    await loginAsAdmin(page);
    await page.goto(`/basic-medical/registrations?status=all`);

    // Find and expand the created registration row
    const regRow = page
      .locator("tr.equipment-request-table-row")
      .filter({ hasText: courseCode })
      .first();
    await expect(regRow).toBeVisible({ timeout: 15_000 });
    await regRow.click();

    // Verify detail row expanded and session table visible
    const detailRow = page.locator("tr.equipment-request-detail-row").first();
    await expect(detailRow).toBeVisible();

    // Verify detail grid layout: Ghi chú in Column 4 Row 1 right side without overlapping Số sinh viên
    const studentCountBlock = detailRow.locator(
      ".basic-medical-registration-detail-student-count",
    );
    const noteBlock = detailRow.locator(
      ".basic-medical-registration-detail-note",
    );
    const detailActionBlock = detailRow.locator(
      ".basic-medical-registration-detail-action",
    );

    await expect(studentCountBlock).toBeVisible();
    await expect(noteBlock).toBeVisible();
    await expect(detailActionBlock).toBeVisible();

    const studentBox = await studentCountBlock.boundingBox();
    const noteBox = await noteBlock.boundingBox();
    const actionBox = await detailActionBlock.boundingBox();

    expect(studentBox).not.toBeNull();
    expect(noteBox).not.toBeNull();
    expect(actionBox).not.toBeNull();

    if (studentBox && noteBox && actionBox) {
      // 1. Ghi chú is on the same top row as Số sinh viên
      expect(Math.abs(noteBox.y - studentBox.y)).toBeLessThanOrEqual(6);
      // 2. Ghi chú is positioned to the right of Số sinh viên
      expect(noteBox.x).toBeGreaterThan(studentBox.x);
      // 3. Ghi chú content does not overlap Số sinh viên content
      const studentValue = await studentCountBlock
        .locator("strong")
        .boundingBox();
      if (studentValue) {
        expect(noteBox.x).toBeGreaterThan(studentValue.x + studentValue.width);
      }
      // 4. Ghi chú does not overlap or extend into Hủy phiếu (column 5)
      expect(noteBox.x + noteBox.width).toBeLessThanOrEqual(actionBox.x + 5);
    }

    // Capture Screenshot of expanded registration detail grid showing Ghi chú in column 4 row 1
    const artifactsDir =
      "C:/Users/User/.gemini/antigravity/brain/dffb3f58-6ffc-43d7-989c-33c163c573f8";
    await page.screenshot({
      path: `${artifactsDir}/basic_medical_registration_detail.png`,
    });

    const sessionTable = detailRow.locator(".basic-medical-session-table");
    await expect(sessionTable).toBeVisible();

    // Check first session action cell
    const sessionRow1 = sessionTable.locator("tbody tr").first();
    const actionCell = sessionRow1.locator(
      ".basic-medical-session-action-cell",
    );
    const statusRow = actionCell.locator(".basic-medical-session-status-row");

    // A. NORMAL MODE: status on left, Sửa on right
    const statusPill = statusRow.locator(".request-status");
    const editButton = statusRow.locator(
      ".basic-medical-session-lecturer-actions .basic-medical-lecturer-edit-button",
    );
    await expect(statusPill).toBeVisible();
    await expect(statusPill).toHaveText("Chưa xác nhận");
    await expect(editButton).toBeVisible();
    await expect(editButton).toHaveText("Sửa");

    // C. ADMINISTRATIVE ACTIONS PRESENT: Hủy lớp is outside the status row
    const cancelSessionButton = actionCell.locator(
      ".basic-medical-session-action-stack > button.button-danger",
    );
    await expect(cancelSessionButton).toBeVisible();
    await expect(cancelSessionButton).toHaveText("Hủy lớp");

    // Capture Screenshot A: Normal mode & Screenshot C: Administrative action present
    await page.screenshot({
      path: `${artifactsDir}/basic_medical_session_normal.png`,
    });
    await page.screenshot({
      path: `${artifactsDir}/basic_medical_session_admin.png`,
    });

    // B. EDIT MODE: Click Sửa -> Lưu + Hủy on right of status row, lecturer select visible
    await editButton.click();

    const lecturerSelect = sessionRow1.locator(
      ".basic-medical-lecturer-select",
    );
    await expect(lecturerSelect).toBeVisible();

    const saveButton = statusRow.locator(
      ".basic-medical-session-lecturer-actions .basic-medical-lecturer-save-button",
    );
    const cancelEditButton = statusRow.locator(
      ".basic-medical-session-lecturer-actions .basic-medical-lecturer-cancel-button",
    );
    await expect(saveButton).toBeVisible();
    await expect(saveButton).toHaveText("Lưu");
    await expect(cancelEditButton).toBeVisible();
    await expect(cancelEditButton).toHaveText("Hủy");

    // Capture Screenshot B: Edit mode
    await page.screenshot({
      path: `${artifactsDir}/basic_medical_session_edit.png`,
    });

    // Click Hủy to restore normal read mode
    await cancelEditButton.click();
    await expect(editButton).toBeVisible();
    await expect(lecturerSelect).not.toBeVisible();
  } finally {
    localSql(`
      begin;
      select set_config('app.basic_medical_registration_mutation', 'true', true);
      delete from public.basic_medical_registration_sessions where registration_id = '${ids.registration}';
      delete from public.class_schedules where basic_medical_registration_id = '${ids.registration}';
      delete from public.basic_medical_registrations where id = '${ids.registration}';
      delete from public.rooms where id = '${ids.room}';
      delete from public.courses where id = '${ids.course}';
      commit;
    `);
  }
});
