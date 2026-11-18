import { expect, test, type Page } from "@playwright/test";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("admin sees a slim dashboard, real routes and the four-region calendar", async ({
  page,
}, testInfo) => {
  await login(page, "admin@campus.local", "LocalAdmin123!");

  await expect(page.locator(".skip-link")).not.toBeInViewport();
  const sidebarLogo = page.locator(".workspace-sidebar .brand-mark");
  const sidebarLogoImage = sidebarLogo.locator("img");
  await expect(sidebarLogoImage).toBeVisible();
  await expect(sidebarLogoImage).toHaveAttribute("src", /eiu-full-logo\.jpg/);
  const logoPresentation = await sidebarLogo.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    const image = element.querySelector("img");
    const imageStyle = image ? getComputedStyle(image) : null;
    return {
      complete: image?.complete ?? false,
      frameHeight: frame.height,
      frameWidth: frame.width,
      naturalHeight: image?.naturalHeight ?? 0,
      naturalWidth: image?.naturalWidth ?? 0,
      objectFit: imageStyle?.objectFit,
    };
  });
  expect(logoPresentation.complete).toBe(true);
  expect(logoPresentation.naturalWidth).toBeGreaterThan(
    logoPresentation.naturalHeight,
  );
  expect(logoPresentation.frameWidth).toBeGreaterThan(
    logoPresentation.frameHeight * 3,
  );
  expect(logoPresentation.objectFit).toBe("contain");
  await sidebarLogo.screenshot({
    path: testInfo.outputPath("sidebar-logo.png"),
  });

  const accountTrigger = page.getByRole("button", {
    name: "Tài khoản của Nguyễn An",
  });
  await expect(accountTrigger).toBeVisible();
  await expect(accountTrigger.locator(".avatar")).toHaveText("NA");
  await expect(
    accountTrigger.locator(".workspace-user-copy strong"),
  ).toHaveText("Nguyễn An");
  await expect(
    accountTrigger.locator(".workspace-user-copy > span"),
  ).toHaveText("Quản trị viên");
  await expect(accountTrigger).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "Đăng xuất", exact: true }),
  ).toHaveCount(0);

  await accountTrigger.click();
  const logoutButton = page.getByRole("button", {
    name: "Đăng xuất",
    exact: true,
  });
  await expect(accountTrigger).toHaveAttribute("aria-expanded", "true");
  await expect(logoutButton).toBeVisible();
  const accountMenuPosition = await page.evaluate(() => {
    const trigger = document.querySelector<HTMLElement>(
      ".workspace-user-trigger",
    );
    const popover = document.querySelector<HTMLElement>(
      ".workspace-account-popover",
    );
    if (!trigger || !popover) throw new Error("Account menu missing");
    return {
      popoverBottom: popover.getBoundingClientRect().bottom,
      triggerTop: trigger.getBoundingClientRect().top,
    };
  });
  expect(accountMenuPosition.popoverBottom).toBeLessThanOrEqual(
    accountMenuPosition.triggerTop,
  );
  await page.keyboard.press("Escape");
  await expect(logoutButton).toHaveCount(0);
  await expect(accountTrigger).toBeFocused();

  await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible();
  await expect(page.locator(".kpi-grid article").first()).toBeVisible();
  await expect(page.locator(".kpi-card small")).toHaveCount(0);
  await expect(page.locator(".kpi-card > span").first()).toHaveText(
    "Tổng lớp học trong tháng",
  );
  await expect(page.locator(".overview-panel-heading h2")).toHaveText(
    "LỊCH HỌC 7 NGÀY TỚI",
  );
  await page.screenshot({
    path: testInfo.outputPath("dashboard.png"),
    fullPage: true,
  });
  await expect(page.locator(".calendar-card")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Lịch Skills lab", exact: true }),
  ).toHaveAttribute("href", "/class-schedules");
  await expect(page.getByRole("link", { name: "Lịch phòng" })).toHaveCount(0);
  const catalogNavigation = page.getByRole("link", {
    name: "Danh mục",
    exact: true,
  });
  await expect(catalogNavigation).toBeVisible();
  await expect(catalogNavigation).toHaveAttribute("href", "/admin/equipment");

  await page.goto("/class-schedules?view=month&date=2026-07-31");
  await expect(page.locator(".hero-strip")).toHaveCount(0);
  await expect(page.locator(".kpi-card")).toHaveCount(4);
  await expect(page.locator(".upcoming-card")).toHaveCount(0);
  await expect(page.locator(".date-filter-control > svg")).toHaveCount(0);
  await expect(page.locator(".period-calendar-month .period-week")).toHaveCount(
    6,
  );
  await expect(
    page.locator(".period-calendar-month .period-label"),
  ).toHaveCount(24);
  await expect(
    page
      .locator(".period-calendar-month .period-week")
      .first()
      .locator(".period-label"),
  ).toHaveCount(4);
  await expect(
    page
      .locator(".period-calendar-month .period-week")
      .first()
      .locator(".period-label")
      .filter({ hasText: "Sáng" }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "Lịch Skills lab" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ngày", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Chọn ngày làm mốc")).toBeVisible();
  // Today is only highlighted in the current month, not the fixture month.
  await page.goto("/class-schedules?view=month");
  const todayHeaderStyle = await page
    .locator(".period-day-heading.is-today")
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, boxShadow: style.boxShadow };
    });
  expect(todayHeaderStyle.background).toBe("rgb(248, 230, 206)");
  expect(todayHeaderStyle.boxShadow).toBe("none");
  const todayCellStyle = await page
    .locator(".period-cell.is-today")
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, boxShadow: style.boxShadow };
    });
  expect(todayCellStyle.background).toBe("rgb(255, 240, 220)");
  expect(todayCellStyle.boxShadow).toBe("none");
  await page.goto("/class-schedules?view=month&date=2026-07-31");
  await expect(page.locator(".kpi-card small")).toHaveCount(0);
  await expect(
    page.locator(".slot-event-class").first().locator("time"),
  ).toBeVisible();
  await expect(
    page.locator(".slot-event-class").first().locator("strong"),
  ).toBeVisible();
  await expect(
    page.locator(".slot-event-class").first().locator("small"),
  ).toContainText(" - ");
  await page.screenshot({
    path: testInfo.outputPath("calendar-class-cards.png"),
    fullPage: true,
  });
  await page.locator(".slot-event-class").first().click();
  await expect(page.getByLabel("Chọn giảng viên thứ nhất")).toBeVisible();
  await expect(page.getByLabel("Chọn giảng viên thứ hai")).toBeVisible();
  await expect(
    page
      .getByLabel("Chi tiết lịch")
      .getByRole("button", { name: "Lưu", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.locator(".slot-event-shift").first().click();
  // Shifts are read-only here; they are changed on the Lịch trực page.
  await expect(page.getByLabel("Chi tiết lịch")).toBeVisible();
  await expect(page.getByLabel("Chi tiết lịch").locator("select")).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.getByLabel("Lịch học", { exact: true }).uncheck();
  await expect(
    page
      .locator(".period-calendar-month .period-week")
      .first()
      .locator(".period-label"),
  ).toHaveCount(2);

  await page.screenshot({
    path: testInfo.outputPath("calendar-month.png"),
    fullPage: true,
  });

  // The default range is around today; the seeded classes are in July 2026.
  // "Hủy" (withdraw) only shows to an assigned lecturer, which the Root admin
  // can no longer be, so only the delete action is checked here.
  await page.goto("/classes/open?period=month&date=2026-07-31");
  await expect(
    page.getByRole("button", { name: /Xóa lớp/ }).first(),
  ).toHaveClass(/button-outline-danger/);
  await page.screenshot({
    path: testInfo.outputPath("classes-open.png"),
    fullPage: true,
  });

  await expect(
    page.getByRole("link", { name: "Lịch Y cơ sở", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Tạo lịch Y cơ sở", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Import lịch Y cơ sở", exact: true }),
  ).toBeVisible();
  await page.goto("/basic-medical/schedules?view=week&date=2026-07-31");
  await expect(
    page.getByRole("heading", { name: "Lịch Y cơ sở" }),
  ).toBeVisible();
  await expect(page.locator(".kpi-grid-three article")).toHaveCount(3);
  await expect(page.locator(".period-calendar-week .period-label")).toHaveCount(
    2,
  );
  await expect(page.getByLabel("Lịch học", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Lịch trực", { exact: true })).toHaveCount(0);
});

// These steps describe the personnel cards, catalog tabs and shift dialogs as
// they were before their redesign. Kept for the rewrite planned with the
// schedule and personnel review; personnel-management, catalog-inline-edit,
// course-room-type and time-picker specs cover the current pages.
test.fixme("admin personnel, catalog, shift and import pages match the pre-redesign layout", async ({
  page,
}, testInfo) => {
  await login(page, "admin@campus.local", "LocalAdmin123!");
  await page.goto("/admin/personnel");
  await expect(
    page.getByRole("heading", { name: "Nhân sự & vai trò" }),
  ).toBeVisible();
  await expect(page.getByText("Thêm nhân sự mới")).toBeVisible();
  await expect(page.locator(".personnel-filters")).toBeVisible();
  await expect(page.getByText("Mã nhân sự", { exact: true })).toHaveCount(0);
  const firstPersonCard = page.locator(".person-card").first();
  const firstPersonName =
    (
      await firstPersonCard.locator(".person-heading strong").textContent()
    )?.trim() ?? "";
  const firstPersonInitials = firstPersonName
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toLocaleUpperCase("vi-VN");
  await expect(firstPersonCard.locator(".person-avatar")).toHaveText(
    firstPersonInitials,
  );
  const avatarStyles = await page.evaluate(() => {
    const sidebarAvatar = document.querySelector<HTMLElement>(
      ".workspace-user .initials-avatar",
    );
    const personnelAvatar =
      document.querySelector<HTMLElement>(".person-avatar");
    if (!sidebarAvatar || !personnelAvatar)
      throw new Error("Missing initials avatar");
    const sidebar = getComputedStyle(sidebarAvatar);
    const personnel = getComputedStyle(personnelAvatar);
    return {
      sidebar: [
        sidebar.display,
        sidebar.placeItems,
        sidebar.fontFamily,
        sidebar.fontSize,
        sidebar.fontWeight,
      ],
      personnel: [
        personnel.display,
        personnel.placeItems,
        personnel.fontFamily,
        personnel.fontSize,
        personnel.fontWeight,
      ],
    };
  });
  expect(avatarStyles.sidebar).toEqual(avatarStyles.personnel);
  expect(avatarStyles.sidebar.slice(0, 2)).toEqual(["grid", "center"]);
  await page.screenshot({
    path: testInfo.outputPath("personnel-avatars.png"),
    fullPage: true,
  });

  await page.goto("/admin/catalogs");
  await expect(page).toHaveURL(/\/admin\/courses$/);
  await expect(page.locator(".catalog-tabs")).toBeVisible();
  const catalogColumnCount = await page
    .locator(".catalog-tabs")
    .evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
  expect(catalogColumnCount).toBe(4);
  const catalogLinks = page.locator(".catalog-tabs a");
  await expect(catalogLinks).toHaveCount(4);
  const courseTab = page.getByRole("link", { name: "Môn học", exact: true });
  await expect(courseTab).toHaveClass(/active/);
  await expect(courseTab).toHaveAttribute("aria-current", "page");
  const courseTabStyle = await courseTab.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      align: style.justifyContent,
      background: style.backgroundColor,
      color: style.color,
      fontWeight: style.fontWeight,
      textAlign: style.textAlign,
    };
  });
  expect(courseTabStyle.align).toBe("center");
  expect(courseTabStyle.textAlign).toBe("center");
  expect(Number(courseTabStyle.fontWeight)).toBeGreaterThanOrEqual(700);
  expect(courseTabStyle.background).toBe("rgb(20, 64, 105)");
  expect(courseTabStyle.color).toBe("rgb(255, 255, 255)");
  await expect(
    page.getByRole("button", { name: "Xóa", exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("catalog-courses.png"),
    fullPage: true,
  });

  await page.goto("/staff-shifts?tab=manage&view=week&date=2026-07-31");
  await expect(page.locator(".period-label-shift")).toHaveCount(2);
  await page.locator(".shift-event").first().click();
  await expect(
    page.getByRole("dialog", { name: "Đổi lịch trực" }),
  ).toBeVisible();
  await expect(page.getByLabel("Người trực")).toBeVisible();
  await page
    .getByRole("dialog", { name: "Đổi lịch trực" })
    .getByLabel("Đóng")
    .click();
  await page.locator(".empty-shift-action").first().click();
  await expect(
    page.getByRole("dialog", { name: "Tạo lịch trực" }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Tạo lịch trực" })
    .getByLabel("Đóng")
    .click();

  await page.goto("/schedule-entry/import");
  await expect(
    page.getByRole("heading", { name: "Import lịch Skills lab" }),
  ).toBeVisible();
  await expect(page.locator(".stepper li")).toHaveCount(5);
  await expect(page.getByText("Mapping", { exact: true })).toHaveCount(0);

  const header =
    "Ngày học,Giờ bắt đầu,Giờ kết thúc,Mã môn học,Tên môn học,Mã phòng,Mã tòa nhà,Email giảng viên,Tên giảng viên,Ghi chú";
  const row = "03/08/2026,07:30,11:30,NUR 101,Thăm khám thể chất,105,B5,,,";
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("label.drop-zone").click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "over-limit.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([header, ...Array(501).fill(row)].join("\n"), "utf8"),
  });
  await expect(page.getByText(/vượt giới hạn 500 dòng/)).toBeVisible();
});

test("sidebar logo stays complete on narrow screens", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await login(page, "admin@campus.local", "LocalAdmin123!");
  await page.locator(".menu-button").click();

  const sidebarLogo = page.locator(".workspace-sidebar .brand-mark");
  await expect(sidebarLogo).toBeVisible();
  const logoPresentation = await sidebarLogo.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    const image = element.querySelector("img");
    const title =
      element.parentElement?.querySelector<HTMLElement>(".brand-copy strong");
    const titleRange = document.createRange();
    if (title) titleRange.selectNodeContents(title);
    return {
      frameHeight: frame.height,
      frameWidth: frame.width,
      objectFit: image ? getComputedStyle(image).objectFit : null,
      titleWidth: title ? titleRange.getBoundingClientRect().width : 0,
    };
  });
  expect(logoPresentation.frameWidth).toBeGreaterThan(
    logoPresentation.frameHeight * 3,
  );
  expect(logoPresentation.objectFit).toBe("contain");
  // 4% band (owner decision, 2026-11-17): Linux renders the title 3.2% wider
  // than Windows, which the earlier 3% band could not absorb.
  expect(
    logoPresentation.titleWidth / logoPresentation.frameWidth,
  ).toBeGreaterThan(0.96);
  expect(
    logoPresentation.titleWidth / logoPresentation.frameWidth,
  ).toBeLessThan(1.04);
  await sidebarLogo.screenshot({
    path: testInfo.outputPath("sidebar-logo-mobile.png"),
  });
});

test("lecturer navigation only exposes lecturer workflows", async ({
  page,
}) => {
  await login(page, "giangvien@campus.local", "LocalLecturer123!");
  await expect(page.getByRole("link", { name: "Lớp đang mở" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Lớp của tôi" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Import lịch" })).toHaveCount(0);
  await expect(page.getByText("Ca trực của tôi", { exact: true })).toHaveCount(
    0,
  );

  await page.goto("/class-schedules?view=week&date=2026-07-31");
  await page.locator(".slot-event-class").first().click();
  const lecturerDetail = page.getByLabel("Chi tiết lịch");
  await expect(lecturerDetail).toBeVisible();
  await expect(lecturerDetail.getByLabel("Chọn giảng viên")).toHaveCount(0);
  await lecturerDetail
    .getByRole("button", { name: "Đóng", exact: true })
    .click();
  await expect(lecturerDetail).toHaveCount(0);

  await page.goto("/classes/open");
  await expect(
    page.getByRole("heading", { name: "Lớp đang mở" }),
  ).toBeVisible();
  await expect(page.locator(".data-panel")).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Giảng viên" }),
  ).toBeVisible();
  await expect(page.getByText("Lớp trống", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Kiểu lọc thời gian")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Áp dụng", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("columnheader", { name: "Môn học" }),
  ).toBeVisible();
  await page.getByLabel("Kiểu lọc thời gian").selectOption("week");
  await expect(page).toHaveURL(/period=week/);
  await page.getByLabel("Ngày làm mốc").fill("2026-08-03");
  await expect(page).toHaveURL(/date=2026-08-03/);
  await expect(page.getByRole("button", { name: /Xóa lớp/ })).toHaveCount(0);

  await page.goto("/classes/mine");
  await expect(
    page.getByRole("heading", { name: "Lớp của tôi" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Trạng thái" }),
  ).toHaveCount(0);
});

test("staff sees separate shift views and can only self-register", async ({
  page,
}, testInfo) => {
  await login(page, "staff@campus.local", "LocalStaff123!");
  await expect(page.getByRole("link", { name: "Lớp đang mở" })).toBeVisible();
  // Importing needs the explicit capability, which seeded Staff does not have.
  const navigation = page.getByLabel("Điều hướng chính");
  await expect(
    navigation.getByRole("link", {
      name: "Import lịch Skills lab",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    navigation.getByRole("link", { name: "Lịch sử import", exact: true }),
  ).toBeVisible();

  await page.goto("/class-schedules?view=week&date=2026-07-31");
  await page.locator(".slot-event-class").first().click();
  const staffDetail = page.getByLabel("Chi tiết lịch");
  await expect(staffDetail).toBeVisible();
  await expect(
    staffDetail.getByLabel("Chọn giảng viên thứ nhất"),
  ).toBeVisible();
  await expect(staffDetail.getByLabel("Chọn giảng viên thứ hai")).toBeVisible();
  await staffDetail.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(staffDetail).toHaveCount(0);

  // The default range is around today; the seeded classes are in July 2026.
  await page.goto("/classes/open?period=month&date=2026-07-31");
  const deleteClassButton = page
    .getByRole("button", { name: /Xóa lớp/ })
    .first();
  await expect(deleteClassButton).toBeVisible();
  await deleteClassButton.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Xóa lịch học?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Quay lại" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/staff-shifts?date=2026-07-31");

  await expect(page.getByRole("heading", { name: "Lịch trực" })).toBeVisible();
  // The page now has two tabs: the roster and the registration form.
  await expect(page.getByText("Đăng ký lịch trực").first()).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("staff-shifts.png"),
    fullPage: true,
  });
});

test("login offers company Google authentication", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Đăng nhập bằng Google" }),
  ).toBeVisible();
  await expect(page.getByText(/@eiu\.edu\.vn/)).toBeVisible();
});
