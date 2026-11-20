import { expect, test, type Page } from "@playwright/test";
import { clickUntilState } from "./helpers/interaction-readiness";

const mobileViewport = { width: 390, height: 844 };

async function loginAsAdmin(page: Page) {
  await page.setViewportSize(mobileViewport);
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("admin@campus.local");
  await page.locator('input[name="password"]').fill("LocalAdmin123!");
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    return {
      htmlOverflow: getComputedStyle(document.documentElement).overflowX,
      bodyOverflow: getComputedStyle(document.body).overflowX,
    };
  });
  expect(overflow.htmlOverflow).toBe("hidden");
  expect(overflow.bodyOverflow).toBe("hidden");
}

test("mobile workspace uses a drawer and keeps dashboard content inside the viewport", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await expectNoPageOverflow(page);

  const menuButton = page.getByRole("button", { name: "Mở menu" });
  await expect(menuButton).toBeVisible();
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");

  const kpiColumns = await page
    .locator(".kpi-grid")
    .evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
  expect(kpiColumns).toBe(2);

  const drawer = page.getByRole("dialog", { name: "Menu chính" });
  await clickUntilState(menuButton, () =>
    expect(drawer).toBeVisible({ timeout: 1_000 }),
  );
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  const drawerSize = await drawer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, width: rect.width };
  });
  expect(drawerSize.width).toBeLessThan(mobileViewport.width);
  expect(drawerSize.height).toBeLessThanOrEqual(mobileViewport.height);
  await expect(
    drawer.getByRole("link", { name: "Lịch Skills lab", exact: true }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(menuButton).toBeFocused();
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");
});

test("mobile calendars scroll inside their card and dialogs remain usable", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/class-schedules?view=week&date=2026-07-31");
  await expectNoPageOverflow(page);

  const calendar = page.getByRole("region", { name: /Lịch tuần/ });
  const calendarOverflow = await calendar.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(calendarOverflow.scrollWidth).toBeGreaterThan(
    calendarOverflow.clientWidth,
  );
  await expect(page.locator(".period-label").first()).toHaveCSS(
    "position",
    "sticky",
  );

  const event = page.locator(".slot-event-class").first();
  const detail = page.getByRole("dialog", { name: "Chi tiết lịch" });
  await clickUntilState(event, () =>
    expect(detail).toBeVisible({ timeout: 1_000 }),
  );
  const detailSize = await detail.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, width: rect.width };
  });
  expect(detailSize.width).toBeLessThanOrEqual(mobileViewport.width + 0.1);
  expect(detailSize.height).toBeLessThanOrEqual(mobileViewport.height);
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);

  await page.goto("/staff-shifts?tab=manage&view=week&date=2026-07-31");
  await expectNoPageOverflow(page);
  const emptyShift = page
    .locator(".staff-shift-day-list .empty-shift-action")
    .first();
  await expect(emptyShift).toBeVisible();
  await expect(emptyShift).toHaveCSS("opacity", "1");
  const shiftDialog = page.getByRole("dialog", { name: "Tạo lịch trực" });
  await clickUntilState(emptyShift, () =>
    expect(shiftDialog).toBeVisible({ timeout: 1_000 }),
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Tạo lịch trực" })).toHaveCount(
    0,
  );
});

test("mobile filters, data tables, catalogs and import controls use local scrolling", async ({
  page,
}) => {
  await loginAsAdmin(page);

  await page.goto("/classes/open");
  await expectNoPageOverflow(page);
  await expect(page.locator(".class-filter-panel")).toHaveCSS(
    "display",
    "grid",
  );
  // Class tables are labelled records on phones now, so they must not need
  // sideways scrolling.
  const classTable = page.getByRole("region", { name: /Danh sách lớp/ });
  expect(
    await classTable.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(false);

  await page.goto("/admin/courses");
  await expectNoPageOverflow(page);
  const tabColumns = await page
    .locator(".catalog-tabs")
    .evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
  expect(tabColumns).toBe(2);
  const catalogTable = page.getByRole("region", { name: /Danh mục môn học/ });
  expect(
    await catalogTable.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);

  await page.goto("/schedule-entry/import");
  await expectNoPageOverflow(page);
  await expect(page.locator(".stepper li")).toHaveCount(5);
  await expect(page.locator(".drop-zone")).toBeVisible();
});

test("iPad portrait uses the drawer and a two-column information layout", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 820, height: 1180 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await loginAsAdmin(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  await expectNoPageOverflow(page);

  await expect(page.locator(".menu-button")).toBeVisible();
  const kpiColumns = await page
    .locator(".kpi-grid")
    .evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    );
  expect(kpiColumns).toBe(2);

  const menuButton = page.locator(".menu-button");
  const openSidebar = page.locator(".workspace-sidebar.sidebar-open");
  await clickUntilState(menuButton, () =>
    expect(openSidebar).toBeVisible({ timeout: 1_000 }),
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".workspace-sidebar")).not.toHaveClass(
    /sidebar-open/,
  );
  await context.close();
});

test("iPad landscape uses touch drawer rules without changing desktop chrome", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await loginAsAdmin(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expectNoPageOverflow(page);

  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
  ).toBe(true);
  await expect(page.locator(".menu-button")).toBeVisible();
  const shell = await page.locator(".workspace-main").evaluate((element) => ({
    marginLeft: getComputedStyle(element).marginLeft,
    width: element.getBoundingClientRect().width,
  }));
  expect(shell.marginLeft).toBe("0px");
  expect(shell.width).toBeCloseTo(1024, 0);

  await page.goto("/classes/open");
  const table = page.locator(".responsive-table").first();
  expect(
    await table.evaluate(
      (element) => element.scrollWidth >= element.clientWidth,
    ),
  ).toBe(true);
  await context.close();
});

test("desktop keeps the fixed sidebar and original workspace width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("admin@campus.local");
  await page.locator('input[name="password"]').fill("LocalAdmin123!");
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });

  await expect(page.locator(".menu-button")).toBeHidden();
  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>(".workspace-sidebar");
    const main = document.querySelector<HTMLElement>(".workspace-main");
    if (!sidebar || !main) throw new Error("Workspace shell missing");
    return {
      sidebarLeft: sidebar.getBoundingClientRect().left,
      sidebarWidth: sidebar.getBoundingClientRect().width,
      mainMarginLeft: Number.parseFloat(getComputedStyle(main).marginLeft),
    };
  });
  expect(layout.sidebarLeft).toBe(0);
  expect(layout.sidebarWidth).toBeGreaterThanOrEqual(220);
  expect(layout.mainMarginLeft).toBeCloseTo(layout.sidebarWidth, 0);
});
