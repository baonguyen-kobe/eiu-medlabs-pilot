import { expect, test, type Page } from "@playwright/test";
import { clickUntilState } from "./helpers/interaction-readiness";

async function loginAsAdmin(page: Page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/login");
    await page.getByLabel("ID hoặc email").fill("admin@campus.local");
    await page.getByLabel("Mật khẩu").fill("LocalAdmin123!");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    try {
      await page.waitForURL(/\/dashboard$/, { timeout: 10_000 });
      return;
    } catch {
      if (attempt === 1) throw new Error("E2E_ADMIN_LOGIN_FAILED_AFTER_RETRY");
    }
  }
}

test("hộp thoại thêm vị trí kho giữ focus, đóng bằng Escape và trả focus", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/inventory/locations");

  const opener = page.getByRole("button", { name: "Thêm vị trí kho mới" });
  const dialog = page.getByRole("dialog");
  await clickUntilState(opener, async () => {
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  });

  const focusInsideDialog = () =>
    page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"]')),
    );

  await expect.poll(focusInsideDialog).toBe(true);
  for (let i = 0; i < 15; i += 1) {
    await page.keyboard.press("Tab");
    expect(await focusInsideDialog()).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
