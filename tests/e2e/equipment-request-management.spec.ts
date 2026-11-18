import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  cleanupLegacyRequest,
  legacyItemFixture,
} from "../helpers/legacy-equipment-fixture.mjs";
import {
  assertLocalDestructiveTestTarget,
  resolveEffectiveSupabaseTestConfig,
} from "../helpers/local-test-safety.mjs";
import { NURSING_SKILLS_ROOM_TYPE_ID } from "../../lib/room-types";
import { clickUntilState } from "./helpers/interaction-readiness";

test("mã phiếu 12 số tải được và Admin thấy dòng bổ sung thiết bị", async ({
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
  const supabaseConfig = resolveEffectiveSupabaseTestConfig(process.env, env);
  assertLocalDestructiveTestTarget({
    supabaseUrl: supabaseConfig.supabaseUrl,
    playwrightBaseUrl: process.env.PLAYWRIGHT_BASE_URL,
  });
  const databaseClient = createClient(
    supabaseConfig.supabaseUrl,
    supabaseConfig.secretKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const authClient = createClient(
    supabaseConfig.supabaseUrl,
    supabaseConfig.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: signedIn, error: signInError } =
    await authClient.auth.signInWithPassword({
      email: "admin@campus.local",
      password: "LocalAdmin123!",
    });
  expect(signInError).toBeNull();
  const adminId = signedIn.user?.id;
  expect(adminId).toBeTruthy();

  const { data: lecturerProfile } = await databaseClient
    .from("profiles")
    .select("id")
    .eq("email", "giangvien@campus.local")
    .single();
  expect(lecturerProfile).toBeTruthy();
  if (!lecturerProfile) {
    throw new Error("Missing lecturer test fixture");
  }
  const lecturerId = lecturerProfile.id;

  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const requestId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const requestCode = "460820123456";

  let scheduleId: string | undefined;
  let catalogItemId: string | undefined;

  try {
    const { data: course } = await databaseClient
      .from("courses")
      .select("id, room_type_id")
      .eq("is_active", true)
      .eq("room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
      .limit(1)
      .single();
    expect(course).toBeTruthy();
    if (!course) {
      throw new Error("Missing course test fixture");
    }

    const { data: room } = await databaseClient
      .from("rooms")
      .select("id")
      .eq("room_type_id", course.room_type_id)
      .eq("is_active", true)
      .limit(1)
      .single();
    expect(room).toBeTruthy();
    if (!room) {
      throw new Error("Missing room test fixture");
    }

    catalogItemId = crypto.randomUUID();
    expect(
      (
        await databaseClient.from("equipment_catalog").insert({
          id: catalogItemId,
          item_name: `Thiết bị E2E ${suffix}`,
          commercial_name: `Thương mại E2E ${suffix}`,
          unit: "Cái",
        })
      ).error,
    ).toBeNull();
    const catalogItem = { id: catalogItemId };

    const { data: schedule, error: rpcError } = await authClient.rpc(
      "create_manual_class_schedule",
      {
        target_course_id: course.id,
        target_room_id: room.id,
        target_lecturer_id: lecturerId,
        target_lecturer_2_id: null,
        target_schedule_date: "2046-08-20",
        target_start_time: "07:30",
        target_end_time: "11:30",
        target_note: `E2E-${suffix} Kiểm thử quản lý phiếu thiết bị`,
        target_student_count: 20,
        target_semester: "HK1",
      },
    );
    expect(rpcError).toBeNull();
    scheduleId = schedule.id;

    expect(
      (
        await databaseClient.from("equipment_requests").insert({
          id: requestId,
          class_schedule_id: scheduleId,
          semester: "HK1",
          registrant_id: adminId!,
          responsible_lecturer_id: lecturerId,
          phone_snapshot: "0901000001",
          email_snapshot: "admin@campus.local",
          receive_at: "2046-08-19T09:00:00+07:00",
          return_at: "2046-08-20T16:00:00+07:00",
          note: `E2E-${suffix}`,
          status: "preparing",
          created_by: adminId!,
          created_at: "2046-08-20T12:34:56+07:00",
        })
      ).error,
    ).toBeNull();
    await legacyItemFixture(
      {
        id: itemId,
        request_id: requestId,
        skill_name: "Kỹ năng E2E",
        catalog_item_id: catalogItem.id,
        quantity: 1,
      },
      { staged: true },
    );

    await databaseClient
      .from("profiles")
      .update({ phone: "0901234567" })
      .eq("id", adminId);

    await page.goto("/login");
    await page.locator('input[name="email"]').fill("admin@campus.local");
    await page.locator('input[name="password"]').fill("LocalAdmin123!");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });

    await page.goto(`/equipment/register?mode=copy&request=${requestCode}`);
    await expect(page.locator(".equipment-form-mode-banner")).toContainText(
      `#${requestCode}`,
    );
    await expect(
      page.getByRole("button", { name: "Tạo phiếu sao chép", exact: true }),
    ).toBeVisible();

    const errors = await page.locator(".form-error").allInnerTexts();
    if (errors.length > 0) {
      console.log("FORM ERRORS:", errors);
    }
    await expect(page.locator(".form-error")).toHaveCount(0);

    await page.goto("/equipment/requests");
    await page.locator(".data-search input").fill(requestId);
    const requestRow = page.locator(".equipment-request-list-item").first();
    await expect(requestRow).toBeVisible();
    const statusStack = requestRow.locator(".equipment-request-status-stack");
    const statusControl = statusStack.locator(
      ".request-status, .equipment-sign-status-button",
    );
    const statusHeading = page.locator(".equipment-status-heading");
    const [headingBox, controlBox] = await Promise.all([
      statusHeading.boundingBox(),
      statusControl.boundingBox(),
    ]);
    expect(Math.abs(headingBox!.x - controlBox!.x)).toBeLessThan(1);

    const detailsButton = requestRow.getByRole("button", {
      name: "Mở chi tiết phiếu",
    });
    const fullListButton = requestRow.getByRole("button", {
      name: /Xem toàn bộ danh sách/,
    });
    await clickUntilState(detailsButton, () =>
      expect(fullListButton).toBeVisible({ timeout: 1_000 }),
    );
    await fullListButton.click();
    // Modal title will be something like "Phiếu thiết bị #...", but might not be requestCode.
    // Use the dialog role without specific name or find by DOM structure.
    const modal = page.getByRole("dialog");
    await expect(
      modal.getByRole("button", { name: "+ Thêm dòng" }),
    ).toBeVisible();
    await modal.getByRole("button", { name: "+ Thêm dòng" }).click();
    await expect(
      modal.getByRole("combobox", { name: /Tên thiết bị bổ sung/ }),
    ).toBeVisible();
    const itemNameCombobox = modal
      .getByRole("combobox", { name: /Tên thiết bị bổ sung dòng 1/ })
      .first();
    await itemNameCombobox.click();
    const suggestionList = page.locator(".searchable-combobox-portal");
    await expect(suggestionList).toBeVisible();
    await expect(suggestionList).toHaveCSS("z-index", "700");
    await modal
      .getByRole("combobox", { name: /Tên thương mại bổ sung dòng 1/ })
      .click();
    await expect(suggestionList).toBeVisible();
    await expect(suggestionList).toHaveCSS("z-index", "700");
    await expect(
      modal.getByRole("button", { name: "+ Thêm dòng" }),
    ).toBeVisible();
    await modal.getByRole("button", { name: "+ Thêm dòng" }).click();
    await expect(
      modal.getByRole("combobox", { name: /Tên thiết bị bổ sung/ }),
    ).toHaveCount(2);
    await expect(
      modal.getByRole("button", { name: "Lưu 2 dòng thiết bị" }),
    ).toBeDisabled();
    await modal
      .getByRole("button", { name: "Đóng danh sách trang thiết bị" })
      .click();

    // t2h: a Skills lab request has no manual status buttons; it opens the
    // inventory handover instead.
    await expect(
      requestRow.getByRole("button", { name: "Đã giao", exact: true }),
    ).toHaveCount(0);
    await expect(
      requestRow.getByRole("link", {
        name: "Bàn giao, thu hồi và ký xác nhận",
        exact: true,
      }),
    ).toHaveAttribute("href", `/equipment/fulfillment/${requestId}`);
    await expect(page.locator(".form-success")).toHaveCount(0);
  } finally {
    await cleanupLegacyRequest(requestId);
    if (scheduleId) {
      await databaseClient
        .from("class_schedules")
        .delete()
        .eq("id", scheduleId);
    }
    if (catalogItemId) {
      await databaseClient
        .from("equipment_catalog")
        .delete()
        .eq("id", catalogItemId);
    }
  }
});

test("calendar equipment request round trip follows the signed-in role", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);

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
  const supabaseConfig = resolveEffectiveSupabaseTestConfig(process.env, env);
  assertLocalDestructiveTestTarget({
    supabaseUrl: supabaseConfig.supabaseUrl,
    playwrightBaseUrl: process.env.PLAYWRIGHT_BASE_URL,
  });
  const databaseClient = createClient(
    supabaseConfig.supabaseUrl,
    supabaseConfig.secretKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const authClient = createClient(
    supabaseConfig.supabaseUrl,
    supabaseConfig.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: signedIn, error: signInError } =
    await authClient.auth.signInWithPassword({
      email: "admin@campus.local",
      password: "LocalAdmin123!",
    });
  expect(signInError).toBeNull();
  const adminId = signedIn.user?.id;
  expect(adminId).toBeTruthy();

  const { data: lecturerProfile } = await databaseClient
    .from("profiles")
    .select("id")
    .eq("email", "giangvien@campus.local")
    .single();
  expect(lecturerProfile).toBeTruthy();
  if (!lecturerProfile) throw new Error("Missing lecturer test fixture");

  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const requestId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  let scheduleId: string | undefined;
  let secondScheduleId: string | undefined;
  let catalogItemId: string | undefined;
  let lecturerContext:
    Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    const { data: course } = await databaseClient
      .from("courses")
      .select("id, course_code, room_type_id")
      .eq("is_active", true)
      .eq("room_type_id", NURSING_SKILLS_ROOM_TYPE_ID)
      .limit(1)
      .single();
    expect(course).toBeTruthy();
    if (!course) throw new Error("Missing course test fixture");

    const { data: room } = await databaseClient
      .from("rooms")
      .select("id")
      .eq("room_type_id", course.room_type_id)
      .eq("is_active", true)
      .limit(1)
      .single();
    expect(room).toBeTruthy();
    if (!room) throw new Error("Missing room test fixture");

    catalogItemId = crypto.randomUUID();
    expect(
      (
        await databaseClient.from("equipment_catalog").insert({
          id: catalogItemId,
          item_name: `Thiết bị E2E ${suffix}`,
          commercial_name: `Thương mại E2E ${suffix}`,
          unit: "Cái",
        })
      ).error,
    ).toBeNull();

    const { data: schedule, error: scheduleError } = await authClient.rpc(
      "create_manual_class_schedule",
      {
        target_course_id: course.id,
        target_room_id: room.id,
        target_lecturer_id: lecturerProfile.id,
        target_lecturer_2_id: null,
        target_schedule_date: "2046-08-20",
        target_start_time: "07:30",
        target_end_time: "11:30",
        target_note: `E2E-${suffix} Calendar equipment request`,
        target_student_count: 20,
        target_semester: "HK1",
      },
    );
    expect(scheduleError).toBeNull();
    scheduleId = schedule.id;

    const { data: secondSchedule, error: secondScheduleError } =
      await authClient.rpc("create_manual_class_schedule", {
        target_course_id: course.id,
        target_room_id: room.id,
        target_lecturer_id: lecturerProfile.id,
        target_lecturer_2_id: null,
        target_schedule_date: "2046-08-20",
        target_start_time: "13:30",
        target_end_time: "16:00",
        target_note: `E2E-${suffix} Calendar no equipment request`,
        target_student_count: 20,
        target_semester: "HK1",
      });
    expect(secondScheduleError).toBeNull();
    secondScheduleId = secondSchedule.id;

    expect(
      (
        await databaseClient.from("equipment_requests").insert({
          id: requestId,
          class_schedule_id: scheduleId,
          semester: "HK1",
          registrant_id: adminId!,
          responsible_lecturer_id: lecturerProfile.id,
          phone_snapshot: "0901000001",
          email_snapshot: "admin@campus.local",
          receive_at: "2046-08-19T09:00:00+07:00",
          return_at: "2046-08-20T16:00:00+07:00",
          note: `E2E-${suffix}`,
          status: "preparing",
          created_by: adminId!,
          created_at: "2046-08-20T12:34:56+07:00",
        })
      ).error,
    ).toBeNull();
    await legacyItemFixture(
      {
        id: itemId,
        request_id: requestId,
        skill_name: "Kỹ năng E2E",
        catalog_item_id: catalogItemId,
        quantity: 1,
      },
      { staged: true },
    );

    await page.goto("/login");
    await page.locator('input[name="email"]').fill("admin@campus.local");
    await page.locator('input[name="password"]').fill("LocalAdmin123!");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
    await page.goto("/class-schedules?date=2046-08-20&view=week");
    await page.waitForLoadState("networkidle");

    const adminScheduleButton = page.getByRole("button", {
      name: `Xem ${course.course_code}, 07:30 đến 11:30`,
      exact: true,
    });
    await expect(adminScheduleButton).toBeVisible();
    await expect(adminScheduleButton).toBeEnabled();
    await adminScheduleButton.focus();
    await adminScheduleButton.press("Enter");
    const adminDrawer = page.getByRole("dialog", { name: "Chi tiết lịch" });
    await expect(adminDrawer).toBeVisible();
    await expect(adminDrawer).not.toContainText("Chưa đăng ký");
    const adminRequestLink = adminDrawer.locator(
      `a[href="/equipment/requests?request=${requestId}"]`,
    );
    await expect(adminRequestLink).toHaveText("Đã soạn");

    await page.keyboard.press("Escape");
    await expect(adminDrawer).toBeHidden();
    const noRequestScheduleButton = page.getByRole("button", {
      name: `Xem ${course.course_code}, 13:30 đến 16:00`,
      exact: true,
    });
    await expect(noRequestScheduleButton).toBeVisible();
    await expect(noRequestScheduleButton).toBeEnabled();
    await noRequestScheduleButton.focus();
    await noRequestScheduleButton.press("Enter");
    const noRequestDrawer = page.getByRole("dialog", {
      name: "Chi tiết lịch",
    });
    await expect(noRequestDrawer).toBeVisible();
    await expect(noRequestDrawer).toContainText("Chưa đăng ký");
    await expect(
      noRequestDrawer.locator(
        `a[href="/equipment/register?schedule=${secondScheduleId}"]`,
      ),
    ).toHaveText("Chưa đăng ký");

    await page.keyboard.press("Escape");
    await expect(noRequestDrawer).toBeHidden();
    await adminScheduleButton.focus();
    await adminScheduleButton.press("Enter");
    await expect(adminDrawer).toBeVisible();
    await adminDrawer
      .locator(`a[href="/equipment/requests?request=${requestId}"]`)
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/equipment/requests\\?request=${requestId}$`),
    );
    const adminRequestRow = page
      .locator("tbody.equipment-request-list-item")
      .filter({ hasText: course.course_code })
      .filter({ has: page.locator('[aria-expanded="true"]') });
    await expect(adminRequestRow).toHaveCount(1);
    await expect(adminRequestRow).toContainText("20/08/2046");
    await expect(adminRequestRow).toContainText("07:30–11:30");

    lecturerContext = await browser.newContext();
    const lecturerPage = await lecturerContext.newPage();
    await lecturerPage.goto("/login");
    await lecturerPage
      .locator('input[name="email"]')
      .fill("giangvien@campus.local");
    await lecturerPage
      .locator('input[name="password"]')
      .fill("LocalLecturer123!");
    await lecturerPage
      .getByRole("button", { name: "Đăng nhập", exact: true })
      .click();
    await expect(lecturerPage).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
    await lecturerPage.goto("/class-schedules?date=2046-08-20&view=week");
    await lecturerPage.waitForLoadState("networkidle");
    const lecturerScheduleButton = lecturerPage.getByRole("button", {
      name: `Xem ${course.course_code}, 07:30 đến 11:30`,
      exact: true,
    });
    await expect(lecturerScheduleButton).toBeVisible();
    await expect(lecturerScheduleButton).toBeEnabled();
    await lecturerScheduleButton.focus();
    await lecturerScheduleButton.press("Enter");
    const lecturerDrawer = lecturerPage.getByRole("dialog", {
      name: "Chi tiết lịch",
    });
    await expect(lecturerDrawer).toBeVisible();
    const lecturerRequestLink = lecturerDrawer.locator(
      `a[href="/equipment/mine?request=${requestId}"]`,
    );
    await expect(lecturerRequestLink).toHaveText("Đã soạn");
    const lecturerNavigations: string[] = [];
    const recordLecturerNavigation = () =>
      lecturerNavigations.push(lecturerPage.url());
    lecturerPage.on("framenavigated", recordLecturerNavigation);
    await lecturerRequestLink.click();
    await expect(lecturerPage).toHaveURL(
      new RegExp(`/equipment/mine\\?request=${requestId}$`),
    );
    expect(lecturerNavigations).not.toContainEqual(
      expect.stringContaining("/equipment/requests"),
    );
    const lecturerRequestRow = lecturerPage
      .locator("tbody.equipment-request-list-item")
      .filter({ hasText: course.course_code })
      .filter({ has: lecturerPage.locator('[aria-expanded="true"]') });
    await expect(lecturerRequestRow).toHaveCount(1);
    await expect(lecturerRequestRow).toContainText("20/08/2046");
    await expect(lecturerRequestRow).toContainText("07:30–11:30");
    lecturerPage.off("framenavigated", recordLecturerNavigation);
  } finally {
    await lecturerContext?.close();
    await cleanupLegacyRequest(requestId);
    if (secondScheduleId) {
      await databaseClient
        .from("class_schedules")
        .delete()
        .eq("id", secondScheduleId);
    }
    if (scheduleId) {
      await databaseClient
        .from("class_schedules")
        .delete()
        .eq("id", scheduleId);
    }
    if (catalogItemId) {
      await databaseClient
        .from("equipment_catalog")
        .delete()
        .eq("id", catalogItemId);
    }
  }
});
