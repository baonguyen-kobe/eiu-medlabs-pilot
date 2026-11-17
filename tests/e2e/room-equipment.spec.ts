import { expect, test, type Page } from "@playwright/test";
import { createS5Harness } from "../helpers/inventory-s5-fixture.mjs";

// t4r1: the room list and one room's page render at desktop and phone widths.
const db = createS5Harness({ quantityReturnSemantics: "returnable" });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await db.setup();
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await db.cleanup();
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="email"]').fill("admin@campus.local");
  await page.locator('input[name="password"]').fill("LocalAdmin123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const width of [1440, 390]) {
  test(`room equipment pages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page);

    await page.goto("/inventory/rooms", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: "Kho theo phòng" }),
    ).toBeVisible();
    await expect(page.locator(".data-table tbody tr").first()).toBeVisible();
    await noHorizontalScroll(page);

    const roomId = db.id(10);
    await page.goto(`/inventory/rooms/${roomId}`, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: "Thiết bị của phòng" }),
    ).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Nhóm thiết bị" });
    await expect(tabs.getByRole("link", { name: /^Cố định/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await noHorizontalScroll(page);

    await tabs.getByRole("link", { name: /^Tạm mượn/ }).click();
    await expect(page).toHaveURL(/tab=temporary/);
    await expect(tabs.getByRole("link", { name: /^Tạm mượn/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await noHorizontalScroll(page);
  });
}
