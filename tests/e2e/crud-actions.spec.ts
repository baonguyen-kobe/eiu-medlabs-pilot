import nextEnv from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "@e965/xlsx";
import { openCombobox } from "./helpers/interaction-readiness";

nextEnv.loadEnvConfig(process.cwd());

const serviceDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const adminDataDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
let adminDataReady = false;

const runKey = `${Date.now()}`.slice(-7);

async function login(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function loginAsAdmin(page: Page) {
  await login(page, "admin@campus.local", "LocalAdmin123!");
}

async function ensureAdminDataClient() {
  if (!adminDataReady) {
    const { error } = await adminDataDb.auth.signInWithPassword({
      email: "admin@campus.local",
      password: "LocalAdmin123!",
    });
    if (error) throw error;
    adminDataReady = true;
  }
  return adminDataDb;
}

async function deleteSchedulesOnDate(date: string) {
  const { error } = await serviceDb
    .from("class_schedules")
    .delete()
    .eq("schedule_date", date);
  if (error) throw error;
}

async function deleteSchedulesBetween(from: string, to: string) {
  const { error } = await serviceDb
    .from("class_schedules")
    .delete()
    .gte("schedule_date", from)
    .lte("schedule_date", to);
  if (error) throw error;
}

async function deleteShiftsBetween(from: string, to: string) {
  const { error } = await serviceDb
    .from("staff_shifts")
    .delete()
    .gte("shift_date", from)
    .lte("shift_date", to);
  if (error) throw error;
}

async function deletePersonnelByEmail(email: string) {
  const db = await ensureAdminDataClient();
  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (profile?.id) await serviceDb.auth.admin.deleteUser(profile.id);
}

async function createManualClass(page: Page, date: string) {
  await page.goto("/schedule-entry/new");
  const courseCombobox = page.getByRole("combobox", {
    name: "Tìm và chọn môn học",
  });
  await openCombobox(courseCombobox);
  await page.getByRole("listbox").getByRole("option").first().click();
  await page.locator('input[name="student_count"]').fill("25");
  await page.locator('select[name="room_id"]').selectOption({ index: 1 });
  await page.locator('select[name="semester"]').selectOption("HK1");
  await page.locator('input[name="schedule_date"]').fill(date);
  await page.locator('input[name="start_time"]').fill("07:30");
  await page.locator('input[name="end_time"]').fill("11:30");
  const selectedCourse = await courseCombobox.inputValue();
  await page.getByRole("button", { name: "Tạo lịch" }).click();
  await expect(page.getByRole("status")).toHaveText("Đã tạo lịch thành công.", {
    timeout: 20_000,
  });
  return selectedCourse.split("—")[0].trim();
}

test.describe.configure({ mode: "serial", timeout: 60_000 });

test("all authenticated pages load without a Server Action module error", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const routes = [
    "/dashboard",
    "/class-schedules",
    "/classes/open",
    "/classes/mine",
    "/staff-shifts",
    "/schedule-entry/new",
    "/schedule-entry/import",
    "/imports",
    "/admin/personnel",
    "/admin/courses",
    "/admin/rooms",
    "/admin/audit",
  ];

  for (const route of routes) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBeLessThan(400);
    await expect(page.locator("body"), route).not.toContainText(
      "Internal Server Error",
    );
  }
  expect(pageErrors).toEqual([]);
  await page.getByRole("button", { name: /Tài khoản của/ }).click();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("admin assigns two lecturers directly in open classes", async ({
  page,
}) => {
  const date = "2036-02-02";
  await deleteSchedulesOnDate(date);
  await loginAsAdmin(page);

  try {
    await createManualClass(page, date);
    await page.goto(`/classes/open?period=day&date=${date}`);
    const row = page.locator("tbody tr").first();
    const firstLecturer = row.getByRole("combobox", { name: /Giảng viên 1/ });
    await firstLecturer.fill("Ngọc Diễm");
    await page
      .getByRole("listbox")
      .getByRole("option", { name: /Nguyễn Ngọc Diễm/ })
      .click();
    const secondLecturer = row.getByRole("combobox", { name: /Giảng viên 2/ });
    await secondLecturer.fill("Trần Minh Anh");
    await page
      .getByRole("listbox")
      .getByRole("option", { name: /Trần Minh Anh/ })
      .click();
    await row.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      /Đã cập nhật giảng viên|Đã lưu thay đổi/,
    );
    await expect(
      row.getByRole("combobox", { name: /Giảng viên 1/ }),
    ).toHaveValue("Nguyễn Ngọc Diễm");
    await expect(
      row.getByRole("combobox", { name: /Giảng viên 2/ }),
    ).toHaveValue("Trần Minh Anh");
  } finally {
    await deleteSchedulesOnDate(date);
  }
});

test("admin can create, toggle, cancel deletion and delete course and room catalogs", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const courseCode = `QA${runKey}`;
  const roomCode = `Q${runKey.slice(-4)}`;

  try {
    await page.goto("/admin/courses");
    await page.locator("summary", { hasText: "+ Thêm môn học" }).click();
    await page.locator('input[name="course_code"]').fill(courseCode);
    await page
      .locator('input[name="course_name"]')
      .fill(`Môn kiểm thử ${runKey}`);
    await page
      .locator('select[name="room_type_id"]')
      .selectOption({ label: "Kỹ năng Điều dưỡng" });
    await page.getByRole("button", { name: "Thêm môn học" }).click();
    let row = page.locator("tbody tr").filter({ hasText: courseCode });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Kỹ năng Điều dưỡng");

    // Deactivate course
    await page.getByLabel(`Chọn ${courseCode}`).check();
    await page
      .locator(".catalog-master-action-group")
      .getByRole("button", { name: "Ngừng sử dụng", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Xác nhận" })
      .click();
    await expect(page.getByRole("status")).toContainText("Đã ngừng dùng");

    // Activate course
    await page.getByLabel(`Chọn ${courseCode}`).check();
    await page
      .locator(".catalog-master-action-group")
      .getByRole("button", { name: "Kích hoạt", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Xác nhận" })
      .click();
    await expect(page.getByRole("status")).toContainText("Đã kích hoạt");

    // Delete course
    await page.getByLabel(`Chọn ${courseCode}`).check();
    await page
      .locator(".catalog-master-action-group")
      .getByRole("button", { name: "Xóa", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Xác nhận" })
      .click();
    await expect(
      page.locator("tbody tr").filter({ hasText: courseCode }),
    ).toHaveCount(0);

    await page.goto("/admin/rooms");
    await page.locator("summary", { hasText: "+ Thêm phòng" }).click();
    await page.locator('input[name="room_code"]').fill(roomCode);
    await page.locator('input[name="building_code"]').fill("QA");
    await page
      .locator('input[name="room_name"]')
      .fill(`Phòng kiểm thử ${runKey}`);
    await page
      .locator('select[name="room_type_id"]')
      .selectOption({ label: "Kỹ năng Điều dưỡng" });
    await page.locator('input[name="capacity"]').fill("24");
    await page.getByRole("button", { name: "Thêm phòng" }).click();
    row = page.locator("tbody tr").filter({ hasText: `${roomCode}.QA` });
    await expect(row).toBeVisible();

    // Deactivate room
    await page.getByLabel(`Chọn ${roomCode}`).check();
    await page
      .locator(".catalog-master-action-group")
      .getByRole("button", { name: "Ngừng sử dụng", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Xác nhận" })
      .click();
    await expect(page.getByRole("status")).toContainText("Đã ngừng dùng");

    // Activate room
    await page.getByLabel(`Chọn ${roomCode}`).check();
    await page
      .locator(".catalog-master-action-group")
      .getByRole("button", { name: "Kích hoạt", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Xác nhận" })
      .click();
    await expect(page.getByRole("status")).toContainText("Đã kích hoạt");

    // Delete room
    await page.getByLabel(`Chọn ${roomCode}`).check();
    await page
      .locator(".catalog-master-action-group")
      .getByRole("button", { name: "Xóa", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Xác nhận" })
      .click();
    await expect(
      page.locator("tbody tr").filter({ hasText: `${roomCode}.QA` }),
    ).toHaveCount(0);
  } finally {
    const db = await ensureAdminDataClient();
    await db.from("courses").delete().eq("course_code", courseCode);
    await db
      .from("rooms")
      .delete()
      .eq("room_code", roomCode)
      .eq("building_code", "QA");
  }
});

test("admin can atomically edit roles, import capability and account state", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const email = `qa-${runKey}@campus.local`;

  await deletePersonnelByEmail(email);
  try {
    await page.goto("/admin/personnel");
    await page.getByText("Thêm nhân sự mới", { exact: true }).click();
    const createForm = page.locator(".admin-create-personnel form");
    await createForm
      .locator('input[name="full_name"]')
      .fill(`Nhân sự QA ${runKey}`);
    await createForm.locator('input[name="email"]').fill(email);
    await createForm.locator('input[name="password"]').fill("LocalQa123!");
    await createForm.locator('input[name="phone"]').fill("0900000000");
    await createForm.locator('input[name="title"]').fill("Kiểm thử viên");
    await createForm
      .locator('input[name="roles"][value="teaching_assistant"]')
      .check();
    await createForm.locator('input[name="can_import_schedules"]').check();
    await createForm.getByRole("button", { name: "Tạo tài khoản" }).click();
    await expect(page.locator(".action-feedback.success")).toContainText(email);

    const row = page
      .locator(".personnel-table tbody tr")
      .filter({ hasText: email });
    await expect(row).toContainText("Trợ giảng");
    await expect(row).toContainText("Nhập lịch");
    await row.getByRole("button", { name: "Sửa" }).click();

    const dialog = page.getByRole("dialog", { name: "Chỉnh sửa nhân sự" });
    await dialog.getByLabel("Chức danh").fill("Kiểm thử viên đã cập nhật");
    await dialog.getByLabel("Cho phép nhập lịch").uncheck();
    await dialog.getByLabel("Đang hoạt động").uncheck();
    await dialog.getByRole("button", { name: "Lưu thay đổi" }).click();
    const confirmation = page.locator(".confirm-dialog");
    await confirmation.getByRole("button", { name: "Khóa tài khoản" }).click();
    await expect(dialog.getByRole("status")).toContainText(
      /Đã cập nhật|Đã lưu/,
    );
    await expect(row).toContainText("Kiểm thử viên đã cập nhật");
    await expect(row).toContainText("Đã khóa");
  } finally {
    await deletePersonnelByEmail(email);
  }
});

test("manual schedule cancel, create, save lecturer and cancel class all work", async ({
  page,
}) => {
  const date = "2036-02-03";
  await deleteSchedulesOnDate(date);
  await loginAsAdmin(page);

  try {
    await page.goto("/schedule-entry/new");
    await page.getByRole("link", { name: "Hủy" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const courseCode = await createManualClass(page, date);
    await page.goto(`/class-schedules?view=week&date=${date}`);
    const classEvent = page
      .locator(".slot-event-class")
      .filter({ hasText: courseCode })
      .first();
    await expect(classEvent).toBeVisible();
    await classEvent.click();
    await expect(page.getByLabel("Chi tiết lịch")).toBeVisible();
    await page.getByRole("button", { name: "Đóng", exact: true }).click();
    await expect(page.getByLabel("Chi tiết lịch")).toHaveCount(0);

    await classEvent.click();
    await page
      .getByLabel("Chọn giảng viên thứ nhất")
      .selectOption({ index: 1 });
    await page
      .getByLabel("Chi tiết lịch")
      .getByRole("button", { name: "Lưu", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Đã lưu thay đổi lớp học",
    );
    await classEvent.click();
    await page.getByRole("button", { name: "Hủy lớp" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Quay lại" })
      .click();
    await expect(page.locator(".confirm-dialog")).toHaveCount(0);
    await expect(page.getByLabel("Chi tiết lịch")).toBeVisible();
    await page.getByRole("button", { name: "Hủy lớp" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Hủy lịch học" })
      .click();
    await expect(page.getByRole("status")).toContainText("Đã hủy lớp");
  } finally {
    await deleteSchedulesOnDate(date);
  }
});

test("lecturer can claim, cancel the dialog and withdraw an owned class", async ({
  page,
}) => {
  const date = "2036-02-04";
  await deleteSchedulesOnDate(date);
  await loginAsAdmin(page);
  await createManualClass(page, date);

  try {
    await login(page, "giangvien@campus.local", "LocalLecturer123!");
    await page.goto(`/classes/open?period=day&date=${date}`);
    const row = page.locator("tbody tr").first();
    await row.getByRole("button", { name: "Nhận lớp" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Đăng ký lớp thành công",
    );

    let ownedRow = page.locator("tbody tr").first();
    await ownedRow.getByRole("button", { name: "Hủy", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Quay lại" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    ownedRow = page.locator("tbody tr").first();
    await ownedRow.getByRole("button", { name: "Hủy", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Hủy nhận lớp" })
      .click();
    await expect(page.getByRole("status")).toContainText(
      /Đã rút khỏi lớp|rút/i,
    );
  } finally {
    await deleteSchedulesOnDate(date);
  }
});

test("import back, remove file, create and delete imported schedule all work", async ({
  page,
}) => {
  const date = "2036-02-05";
  const fileName = `qa-import-${runKey}.csv`;
  const header =
    "Ngày học,Giờ bắt đầu,Giờ kết thúc,Mã môn học,Tên môn học,Số sinh viên,Mã phòng,Mã tòa nhà,Email giảng viên,Tên giảng viên,Ghi chú";
  const row = `${date},07:30,11:30,NUR 101,Thăm khám thể chất,25,105,B5,,,QA ${runKey}`;
  const file = {
    name: fileName,
    mimeType: "text/csv",
    buffer: Buffer.from(`${header}\n${row}`, "utf8"),
  };

  await deleteSchedulesOnDate(date);
  await loginAsAdmin(page);

  try {
    await page.goto("/schedule-entry/import");
    await page.locator("#import-semester-select").selectOption({ index: 1 });
    await page.locator(".drop-zone").evaluate(
      (element, payload) => {
        const droppedFile = new File([payload.content], payload.name, {
          type: payload.mimeType,
        });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(droppedFile);
        element.dispatchEvent(
          new DragEvent("dragenter", { bubbles: true, dataTransfer }),
        );
        element.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer,
          }),
        );
      },
      {
        name: file.name,
        mimeType: file.mimeType,
        content: `${header}\n${row}`,
      },
    );
    await expect(page.locator(".file-summary")).toContainText(fileName);
    await page.locator(".file-summary button").click();
    await expect(page.locator(".drop-zone")).toBeVisible();

    await page.locator("#schedule-import-file").setInputFiles(file);
    await page.getByRole("button", { name: /Tiếp tục/ }).click();
    await page.getByRole("button", { name: /Quay lại/ }).click();
    await page.getByRole("button", { name: /Tiếp tục/ }).click();
    await page.getByRole("button", { name: /Tiếp tục/ }).click();
    await page.getByRole("button", { name: /Tạo lịch/ }).click();
    await expect(
      page.getByRole("heading", { name: "Import đã hoàn tất" }),
    ).toBeVisible();
    await expect(page.locator(".import-result")).toContainText("Đã tạo 1 lịch");
    await page.getByRole("button", { name: "Import file khác" }).click();
    await expect(page.locator(".drop-zone")).toBeVisible();

    await page.goto(`/classes/open?period=day&date=${date}`);
    const importedRow = page
      .locator("tbody tr")
      .filter({ hasText: "NUR 101" })
      .first();
    const deleteImportedScheduleButton = page.locator(
      "button.button-outline-danger.row-action-button",
    );
    await deleteImportedScheduleButton.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Quay lại" })
      .click();
    await expect(importedRow).toBeVisible();
    await deleteImportedScheduleButton.click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Xóa lịch học" })
      .click();
    await expect(
      page.locator("tbody tr").filter({ hasText: "NUR 101" }),
    ).toHaveCount(0);
  } finally {
    await deleteSchedulesOnDate(date);
  }
});

test("xlsx import accepts 18 Excel serial dates, reports format errors and finishes quickly", async ({
  page,
}, testInfo) => {
  const from = "2040-03-01";
  const to = "2040-03-18";
  const excelEpoch = Date.UTC(1899, 11, 30);
  const dayMs = 86_400_000;
  const rows = Array.from({ length: 18 }, (_, index) => {
    const date = new Date(Date.UTC(2040, 2, index + 1));
    const scheduleDate =
      index < 6
        ? (date.valueOf() - excelEpoch) / dayMs
        : index < 12
          ? date
          : `${String(index + 1).padStart(2, "0")}/03/2040`;
    const startTime =
      index < 6
        ? 7.5 / 24
        : index < 12
          ? new Date(1899, 11, 30, 7, 30)
          : "07:30";
    const endTime =
      index < 6
        ? 11.5 / 24
        : index < 12
          ? new Date(1899, 11, 30, 11, 30)
          : "11:30";
    return {
      schedule_date: scheduleDate,
      start_time: startTime,
      end_time: endTime,
      course_code: "NUR 101",
      course_name: "Thăm khám thể chất",
      student_count: 25,
      room_code: 105,
      building_code: "B5",
      lecturer_email: "",
      lecturer_name: "",
      note: `Excel serial QA ${runKey}-${index}`,
    };
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows),
    "Import Template",
  );
  const file = {
    name: `excel-serial-18-${runKey}.xlsx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  };

  await deleteSchedulesBetween(from, to);
  await loginAsAdmin(page);
  try {
    await page.goto("/schedule-entry/import");
    await page.locator("#import-semester-select").selectOption({ index: 1 });
    await page.locator("#schedule-import-file").setInputFiles(file);
    await expect(page.locator(".preview-table tbody tr")).toHaveCount(18);
    await expect(page.locator(".preview-table tbody tr").last()).toContainText(
      "18/03/2040",
    );
    expect(
      await page
        .locator(".preview-table-wrap")
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    ).toBe(true);
    await expect(
      page.locator(".preview-table tbody tr").first().locator("td").nth(1),
    ).toHaveText("01/03/2040");
    await expect(page.locator(".preview-table tbody")).not.toContainText(
      String(rows[0].schedule_date),
    );
    await expect(
      page.locator(".import-stats article.warning strong"),
    ).toHaveText("0");
    await page.screenshot({
      path: testInfo.outputPath("import-18-normalized-preview.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: /Tiếp tục/ }).click();
    await page.getByRole("button", { name: /Tiếp tục/ }).click();
    const startedAt = Date.now();
    await page.getByRole("button", { name: /Tạo lịch/ }).click();
    await expect(page.locator(".import-result")).toContainText(
      "Đã tạo 18 lịch",
      {
        timeout: 20_000,
      },
    );
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    await expect(page.locator(".import-duration")).toBeVisible();
  } finally {
    await deleteSchedulesBetween(from, to);
  }

  await page.getByRole("button", { name: "Import file khác" }).click();
  const invalidWorkbook = XLSX.utils.book_new();
  const validReviewRow = {
    ...rows[0],
    schedule_date: "19/03/2040",
    note: `Validation QA ${runKey}`,
  };
  XLSX.utils.book_append_sheet(
    invalidWorkbook,
    XLSX.utils.json_to_sheet([
      validReviewRow,
      { ...rows[0], schedule_date: "31/02/2040", note: `Invalid QA ${runKey}` },
      validReviewRow,
    ]),
    "Import Template",
  );
  await page.locator("#schedule-import-file").setInputFiles({
    name: `invalid-date-${runKey}.xlsx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: XLSX.write(invalidWorkbook, { type: "buffer", bookType: "xlsx" }),
  });
  await expect(page.locator(".preview-table thead")).toContainText("Ngày học");
  await expect(page.locator(".preview-table thead")).toContainText(
    "Tên môn học",
  );
  await expect(page.locator(".preview-table thead")).not.toContainText(
    "schedule_date",
  );

  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  await expect(page.locator(".stepper li").nth(2)).toHaveClass(/active/);
  await expect(
    page
      .locator(".import-stats article")
      .filter({ hasText: "Có thể tạo" })
      .locator("strong"),
  ).toHaveText("1");
  await expect(
    page
      .locator(".import-stats article")
      .filter({ hasText: "Cần sửa" })
      .locator("strong"),
  ).toHaveText("1");
  await expect(
    page
      .locator(".import-stats article")
      .filter({ hasText: "Trùng, không tạo" })
      .locator("strong"),
  ).toHaveText("1");
  await expect(page.locator(".preview-table thead")).toContainText("Kiểm tra");
  await expect(page.locator(".preview-table tbody")).toContainText(
    "Ngày học không hợp lệ",
  );
  await expect(page.locator(".preview-table tbody")).toContainText(
    "Dòng trùng với một dòng khác trong cùng file",
  );

  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  await expect(page.locator(".stepper li").nth(3)).toHaveClass(/active/);
  await expect(page.locator(".preview-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".preview-table thead")).not.toContainText(
    "Kiểm tra",
  );
  await expect(page.locator(".preview-table tbody")).toContainText(
    "19/03/2040",
  );
  await page.screenshot({
    path: testInfo.outputPath("import-invalid-date.png"),
    fullPage: true,
  });
});

test("staff shift registration and cancellation work in V2", async ({
  page,
}) => {
  const shiftDate = "2036-02-11";
  await deleteShiftsBetween("2036-02-09", "2036-02-15");

  try {
    await login(page, "staff@campus.local", "LocalStaff123!");
    await page.goto(`/staff-shifts?tab=register&view=week&date=${shiftDate}`);

    // Mode 2: Tự chọn ngày trực
    await page.getByRole("button", { name: "Tự chọn ngày trực" }).click();
    await page.locator('input[type="date"]').first().fill(shiftDate);
    await page
      .getByRole("button", { name: /Đăng ký ca|Đăng ký các dòng đã điền/ })
      .first()
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Đã đăng ký thành công",
    );

    // Verify shift card is visible on roster
    await page.goto(`/staff-shifts?tab=roster&view=week&date=${shiftDate}`);
    const cancelButton = page
      .getByRole("button", { name: /Hủy lịch trực/ })
      .first();
    await expect(cancelButton).toBeVisible();

    // Cancel own shift
    await cancelButton.click();
    await page.getByRole("button", { name: "Hủy ca trực" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Đã hủy ca trực thành công",
    );
  } finally {
    await deleteShiftsBetween("2036-02-09", "2036-02-15");
  }
});
