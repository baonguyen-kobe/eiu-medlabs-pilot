import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("admin@campus.local");
  await page.locator('input[name="password"]').fill("LocalAdmin123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("form Y cơ sở tự tính năm học và hiển thị giảng viên theo chức danh", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/basic-medical/new");

  const academicYear = page.locator('input[name="academic_year"]');
  await expect(academicYear).toHaveValue("2025-2026");
  await page.locator('input[name="start_date"]').fill("2026-10-01");
  await expect(academicYear).toHaveValue("2026-2027");
  await page.locator('input[name="start_date"]').fill("2026-09-30");
  await expect(academicYear).toHaveValue("2025-2026");

  const responsible = page.locator('select[name="responsible_lecturer_id"]');
  expect(await responsible.locator("option").count()).toBeGreaterThan(1);
  await expect(responsible).toContainText("Đoàn Văn Khánh");
  await responsible.selectOption({ label: "Đoàn Văn Khánh" });
  await expect(responsible).not.toHaveValue("");
});

test("form Y cơ sở tạo được đúng một buổi theo khung giờ của form ngoài", async ({
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
  const adminDatabaseClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: signInError } = await databaseClient.auth.signInWithPassword({
    email: "admin@campus.local",
    password: "LocalAdmin123!",
  });
  expect(signInError).toBeNull();

  const note = `E2E Y cơ sở ${crypto.randomUUID()}`;
  let registrationId = "";
  try {
    await loginAsAdmin(page);
    await page.goto("/basic-medical/new");

    const sessionCount = page.getByLabel("Số buổi TN-TH *");
    await expect(sessionCount).toHaveValue("1");
    await expect(sessionCount).not.toHaveAttribute("max");

    await page.locator('input[name="start_date"]').fill("2048-08-06");
    await page.locator('input[name="end_date"]').fill("2048-08-06");
    await page.locator('select[name="semester"]').selectOption("HK1");
    await page.locator('select[name="course_id"]').selectOption({ index: 1 });
    await page.locator('select[name="room_id"]').selectOption({ index: 1 });
    await page.locator('input[name="student_count"]').fill("1");
    await page
      .locator('select[name="responsible_lecturer_id"]')
      .selectOption({ index: 1 });

    const sessionRow = page.locator("tbody tr").first();
    const sessionDate = sessionRow.locator('input[type="date"]');
    await expect(sessionDate).toHaveAttribute("min", "2048-08-06");
    await expect(sessionDate).toHaveAttribute("max", "2048-08-06");
    await sessionDate.fill("2048-08-06");
    await page.getByLabel("Buổi 1 - Giờ bắt đầu").fill("19:00");
    await page.getByLabel("Buổi 1 - Giờ kết thúc").fill("21:00");
    await page.getByLabel("Buổi 1 - Tên bài TN-TH").fill("Bài E2E");
    await page
      .getByRole("combobox", {
        name: "Buổi 1 - Giảng viên giảng dạy/hướng dẫn",
      })
      .selectOption({ index: 1 });
    await page.locator('textarea[name="note"]').fill(note);

    await page.getByRole("button", { name: "Gửi đăng ký" }).click();
    const feedback = page.locator(".basic-medical-form-feedback");
    await expect(feedback.locator(".form-success")).toContainText(
      "Đã tạo phiếu Y cơ sở với 1 buổi học",
    );
    await expect(feedback.getByRole("link", { name: "Tạo mới" })).toBeVisible();
    await expect
      .poll(async () => {
        const box = await feedback.boundingBox();
        const viewportHeight = page.viewportSize()?.height ?? 0;
        return box ? box.y >= 0 && box.y + box.height <= viewportHeight : false;
      })
      .toBe(true);

    const { data: registration, error } = await databaseClient
      .from("basic_medical_registrations")
      .select("id")
      .eq("note", note)
      .single();
    expect(error).toBeNull();
    registrationId = registration!.id;

    await expect
      .poll(async () => {
        const { data: notifications } = await adminDatabaseClient
          .from("email_notifications")
          .select("status")
          .contains("payload", {
            schedule_date: "2048-08-06",
            course_code: "BIO 110",
          });
        return (
          (notifications?.length ?? 0) > 0 &&
          notifications!.every(({ status }) => status === "suppressed")
        );
      })
      .toBe(true);

    await feedback.getByRole("link", { name: "Tạo mới" }).click();
    await expect(page).toHaveURL(/\/basic-medical\/new$/);
    await expect(page.locator(".basic-medical-form-feedback")).toHaveCount(0);
    await expect(page.getByLabel("Số buổi TN-TH *")).toHaveValue("1");
  } finally {
    if (registrationId) {
      await databaseClient
        .from("basic_medical_registrations")
        .delete()
        .eq("id", registrationId);
    }
    await adminDatabaseClient
      .from("email_notifications")
      .delete()
      .contains("payload", {
        schedule_date: "2048-08-06",
        course_code: "BIO 110",
      });
  }
});

test("các trang đăng ký native hiển thị trên local", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/basic-medical/new");
  await expect(
    page.getByRole("heading", { name: "Tạo lịch Y cơ sở" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Thông tin người đăng ký" }),
  ).toBeVisible();
  await expect(
    page.getByText("GV giảng dạy/hướng dẫn", { exact: true }),
  ).toBeVisible();

  await page.goto("/equipment/register");
  await expect(
    page.getByRole("heading", { name: "Đăng ký thiết bị" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Thông tin nhận thiết bị" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Thiết bị theo kỹ năng/bài thực hành" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "+ Tạo lớp mới" }),
  ).toHaveAttribute(
    "href",
    "/schedule-entry/new?returnTo=%2Fequipment%2Fregister",
  );
  await expect(page.locator('input[name="phone"]')).toHaveValue("0901000001");
  await expect(
    page.locator('select[name="responsible_lecturer_id"]'),
  ).toHaveValue("c18c4f94-a58a-4b5f-abd0-8c4856affab8");
  await expect(page.locator('input[name="semester"]')).toHaveValue("");
  await expect(page.locator('input[name="semester"]')).toHaveAttribute(
    "readonly",
    "",
  );
  await page.getByLabel("Số lượng kỹ năng/bài thực hành *").selectOption("2");
  await page.getByRole("button", { name: "+ Tạo bảng thiết bị" }).click();
  await expect(page.locator(".equipment-skill-card")).toHaveCount(2);
  await expect(page.locator(".equipment-items-table tbody tr")).toHaveCount(6);

  await page.goto("/equipment/mine");
  await expect(
    page.getByRole("heading", { name: "Phiếu thiết bị của tôi" }),
  ).toBeVisible();
  await expect(page.locator(".equipment-request-list-item")).toHaveCount(5);

  await page.goto("/equipment/requests");
  await expect(
    page.getByRole("heading", { name: "Phiếu thiết bị", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".equipment-request-list-item")).toHaveCount(5);
  await expect(
    page.getByRole("columnheader", { name: "Môn học" }),
  ).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Ngày" })).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Phòng/Lab" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Trạng thái" }),
  ).toBeVisible();
  await page.getByLabel("Trạng thái").selectOption("completed");
  await expect(page.locator(".equipment-request-list-item")).toHaveCount(1);
  const completedRequest = page
    .locator(".equipment-request-list-item")
    .filter({ hasText: "21/08/2026" });
  await completedRequest.locator(".equipment-request-summary").click();
  const requestDetails = completedRequest.locator(".equipment-request-details");
  const requestCode = requestDetails.getByText(/^\d{12}$/);
  await expect(requestCode).toBeVisible();
  const detailGrid = requestDetails.locator(".equipment-request-detail-grid");
  await expect(detailGrid).toHaveCSS("display", "grid");
  const detailColumns = await detailGrid.evaluate(
    (element) =>
      getComputedStyle(element).gridTemplateColumns.split(" ").length,
  );
  expect(detailColumns).toBe(3);
  const registrantTop = await detailGrid
    .getByText("Người đăng ký", { exact: true })
    .locator("..")
    .evaluate((element) => element.getBoundingClientRect().top);
  const emailTop = await detailGrid
    .getByText("Email", { exact: true })
    .locator("..")
    .evaluate((element) => element.getBoundingClientRect().top);
  const phoneTop = await detailGrid
    .getByText("Số điện thoại", { exact: true })
    .locator("..")
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(Math.max(registrantTop, emailTop, phoneTop)).toBeLessThanOrEqual(
    Math.min(registrantTop, emailTop, phoneTop) + 1,
  );
  const statusBox = await requestDetails
    .locator(".equipment-status-section-top")
    .boundingBox();
  const codeBox = await requestCode.boundingBox();
  expect(statusBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(
    codeBox?.y ?? Number.NEGATIVE_INFINITY,
  );
  const deleteButton = completedRequest.getByRole("button", {
    name: "Xóa phiếu",
    exact: true,
  });
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();
  const deleteDialog = page.getByRole("dialog", {
    name: "Xóa phiếu thiết bị?",
  });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog).toContainText(
    "Lớp Skills lab gốc vẫn được giữ lại",
  );
  await deleteDialog.getByRole("button", { name: "Quay lại" }).click();
  await expect(deleteDialog).toBeHidden();
  const downloadPromise = page.waitForEvent("download");
  const exportPdfLink = completedRequest.getByRole("link", {
    name: "Xuất phiếu PDF",
    exact: true,
  });
  const statusButton = completedRequest
    .locator(".equipment-status-actions .request-status-button")
    .first();
  const [statusButtonBox, exportBox] = await Promise.all([
    statusButton.boundingBox(),
    exportPdfLink.boundingBox(),
  ]);
  expect(
    Math.abs((statusButtonBox?.y ?? 0) - (exportBox?.y ?? 0)),
  ).toBeLessThan(6);
  await exportPdfLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^phieu-giao-nhan-\d{6}-\d{6}\.pdf$/,
  );
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();
  const pdf = await readFile(downloadedPath!);
  expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(pdf.byteLength).toBeGreaterThan(20_000);
  await completedRequest
    .getByRole("button", { name: /Xem toàn bộ danh sách/ })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByText("[Mock] Hồi sức tim phổi", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Kiểm tra pin trước giờ học", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "×" }).click();
  await page.getByLabel("Trạng thái").selectOption("");
  await completedRequest
    .getByRole("button", { name: "Mới", exact: true })
    .click();
  await expect(
    completedRequest.locator(".request-status-red").first(),
  ).toHaveText("Mới");
  await expect(
    completedRequest.getByRole("button", {
      name: "Hoàn Thành",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByLabel("Từ ngày").fill("2026-08-20");
  await page.getByLabel("Đến ngày").fill("2026-08-20");
  await expect(page.locator(".equipment-request-list-item")).toHaveCount(1);
  await page.getByRole("button", { name: "Xóa bộ lọc" }).click();
  await expect(page.locator(".equipment-request-list-item")).toHaveCount(5);

  await page.goto("/equipment/mine");
  await page.getByLabel("Trạng thái").selectOption("completed");
  await expect(
    page
      .locator(".equipment-request-list-item")
      .filter({ hasText: "21/08/2026" }),
  ).toHaveCount(1);

  await page.goto("/admin/equipment");
  await expect(
    page.getByRole("heading", { name: "Danh mục thiết bị" }),
  ).toBeVisible();
  await expect(
    page.getByText("Máy đo huyết áp", { exact: true }),
  ).toBeVisible();

  await page.goto("/class-schedules");
  await expect(
    page.getByRole("heading", { name: "Lịch Skills lab" }),
  ).toBeVisible();
});

test("giảng viên có thể mở luồng tạo lớp mới từ đăng ký thiết bị", async ({
  page,
}) => {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("giangvien@campus.local");
  await page.locator('input[name="password"]').fill("LocalLecturer123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/schedule-entry/new?returnTo=%2Fequipment%2Fregister");
  await expect(
    page.getByRole("heading", { name: "Tạo lịch Skills lab" }),
  ).toBeVisible();
  await expect(page.locator('input[name="return_to"]')).toHaveValue(
    "/equipment/register",
  );
  await expect(page.getByRole("link", { name: "Hủy" })).toHaveAttribute(
    "href",
    "/equipment/register",
  );
  await page.goto("/equipment/requests");
  await expect(page).toHaveURL(/\/equipment\/mine$/);
  await page.locator(".equipment-request-summary").first().click();
  await expect(
    page.getByRole("button", { name: "Đã soạn", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Xuất phiếu PDF", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Xóa phiếu", exact: true }),
  ).toHaveCount(0);
  const forbiddenExport = await page.request.get(
    "/api/equipment-requests/62000000-0000-0000-0000-000000000001/handover",
  );
  expect(forbiddenExport.status()).toBe(403);
});

test("sao chép và điều chỉnh phiếu nạp dữ liệu theo đúng nguyên lý form ngoài", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/equipment/register");

  const editPanel = page
    .locator(".equipment-registration-mode")
    .filter({ hasText: "Điều chỉnh phiếu" });
  await editPanel.getByText("Điều chỉnh phiếu", { exact: true }).click();
  const editSelect = editPanel.locator('select[name="request"]');
  await expect(editSelect.locator("option")).toHaveCount(2);
  await editSelect.selectOption({ index: 1 });
  const sourceId = await editSelect.inputValue();

  await page.goto("/equipment/requests");
  await page
    .locator(".equipment-request-filters .data-search input")
    .fill(sourceId);
  const sourceRequest = page.locator(".equipment-request-list-item").first();
  await sourceRequest.locator(".equipment-request-summary").click();
  const sourceCode = await sourceRequest.getByText(/^\d{12}$/).textContent();
  expect(sourceCode).toBeTruthy();

  await page.goto("/equipment/register");

  const copyPanel = page
    .locator(".equipment-registration-mode")
    .filter({ hasText: "Sao chép phiếu" });
  await copyPanel.getByText("Sao chép phiếu", { exact: true }).click();
  const copyIdInput = copyPanel.locator('input[name="request"]');
  await copyIdInput.fill(sourceCode!);
  await expect(copyPanel.locator('select[name="request"]')).toHaveCount(0);
  await copyPanel
    .getByRole("button", { name: "Tải dữ liệu để sao chép" })
    .click();

  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === "/equipment/register" &&
      url.searchParams.get("mode") === "copy" &&
      url.searchParams.get("request") === sourceCode
    );
  });
  await expect(page.getByText(/^Đang sao chép phiếu #/)).toBeVisible();
  await expect(page.locator('select[name="class_schedule_id"]')).toHaveValue(
    "",
  );
  await expect(page.locator('input[name="receive_date"]')).toHaveValue("");
  await expect(page.locator('input[name="return_date"]')).toHaveValue("");
  await expect(
    page.locator('select[name="responsible_lecturer_id"]'),
  ).toHaveValue("c18c4f94-a58a-4b5f-abd0-8c4856affab8");
  await expect(page.locator(".equipment-skill-card").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tạo phiếu sao chép" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "+ Tạo lớp mới" }),
  ).toHaveAttribute(
    "href",
    `/schedule-entry/new?returnTo=${encodeURIComponent(`/equipment/register?mode=copy&request=${sourceId}`)}`,
  );

  await page.goto("/equipment/register");
  const reopenedEditPanel = page
    .locator(".equipment-registration-mode")
    .filter({ hasText: "Điều chỉnh phiếu" });
  await reopenedEditPanel
    .getByText("Điều chỉnh phiếu", { exact: true })
    .click();
  const reopenedEditSelect = reopenedEditPanel.locator(
    'select[name="request"]',
  );
  await expect(reopenedEditSelect.locator("option")).toHaveCount(2);
  await reopenedEditSelect.selectOption(sourceId);
  const editId = await reopenedEditSelect.inputValue();
  await reopenedEditPanel
    .getByRole("button", { name: "Tải phiếu để điều chỉnh" })
    .click();

  await expect(page).toHaveURL(
    new RegExp(`/equipment/register\\?mode=edit&request=${editId}`),
  );
  await expect(page.getByText(/^Đang điều chỉnh phiếu #/)).toBeVisible();
  await expect(page.locator('input[name="request_id"]')).toHaveValue(editId);
  await expect(
    page.locator('select[name="class_schedule_id"]'),
  ).not.toHaveValue("");
  await expect(page.locator('input[name="receive_date"]')).not.toHaveValue("");
  await expect(page.locator('input[name="return_date"]')).not.toHaveValue("");
  await expect(page.locator('input[name="receive_date"]')).toHaveAttribute(
    "min",
    /\d{4}-\d{2}-\d{2}/,
  );
  await expect(page.locator('input[name="receive_date"]')).toHaveAttribute(
    "max",
    /\d{4}-\d{2}-\d{2}/,
  );
  await expect(page.locator('input[name="return_date"]')).toHaveAttribute(
    "min",
    /\d{4}-\d{2}-\d{2}/,
  );
  await expect(page.locator(".equipment-skill-card").first()).toBeVisible();
  await page.getByRole("button", { name: "Lưu điều chỉnh" }).click();
  await expect(
    page.getByText(/Đã lưu điều chỉnh.*trạng thái hiện tại.*giữ nguyên/),
  ).toBeVisible();
  const feedback = page.locator(".equipment-form-feedback");
  await expect(feedback).toHaveCSS("text-align", "center");
  await expect
    .poll(async () => {
      const box = await feedback.boundingBox();
      const viewportHeight = page.viewportSize()?.height ?? 0;
      return box ? box.y >= 0 && box.y + box.height <= viewportHeight : false;
    })
    .toBe(true);
});

test("danh sách và popup thiết bị dùng được trên màn hình nhỏ", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);
  await page.goto("/equipment/requests");
  await page.getByLabel("Trạng thái").selectOption("completed");
  const request = page.locator(".equipment-request-list-item").first();
  await request.locator(".equipment-request-summary").click();
  await request.getByRole("button", { name: /Xem toàn bộ danh sách/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  await expect(
    dialog.getByText("Kiểm tra pin trước giờ học", { exact: true }),
  ).toBeVisible();
});
