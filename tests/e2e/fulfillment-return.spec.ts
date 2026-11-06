import { expect, test, type Page } from "@playwright/test";
import {
  createS5Harness,
  sqlLiteral,
} from "../helpers/inventory-s5-fixture.mjs";

const db = createS5Harness({ quantityReturnSemantics: "returnable" });
let fixture: Record<string, string>;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  fixture = await db.setup();
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await db.cleanup();
});

const fieldset = (page: Page) => page.locator("fieldset");

async function signIn(page: Page) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.locator('input[name="email"]').fill("admin@campus.local");
  await page.locator('input[name="password"]').fill("LocalAdmin123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
}

async function record(page: Page, reason: string) {
  await fieldset(page).getByRole("textbox", { name: "Lý do" }).fill(reason);
  await fieldset(page).getByRole("checkbox").check();
  await fieldset(page)
    .getByRole("button", { name: /^Ghi nhận / })
    .click();
  await expect(page.getByText(/^Đã ghi nhận\./)).toBeVisible();
}

test("U09–U10: a return visit records good and damaged, then the next visit adds only its own count", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const issue = async () =>
    (
      await db.read(
        db.actors[2],
        `public.equipment_fulfillment_read(${sqlLiteral(fixture.request2)}::uuid)`,
      )
    ).issues[0];

  await signIn(page);
  await page.goto(`/equipment/fulfillment/${fixture.request2}`);

  const good = page.getByRole("textbox", { name: /^Tốt:/ });
  const damaged = page.getByRole("textbox", { name: /^Hỏng:/ });
  const post = fieldset(page).getByRole("button", { name: /^Ghi nhận / });

  await good.fill("0.05");
  await damaged.fill("0.01");
  await expect(
    page.getByText("Kiểm tra lượt nhận trước khi ghi"),
  ).toBeVisible();
  await record(page, "UAT U09 lượt đầu");
  expect(await issue()).toMatchObject({ returned: 0.06, due: 0.04 });

  await good.fill("1");
  await expect(page.locator(".form-error")).toContainText("vượt");
  await fieldset(page).getByRole("textbox", { name: "Lý do" }).fill("Vượt số");
  await fieldset(page).getByRole("checkbox").check();
  await expect(post).toBeDisabled();

  await good.fill("0.01");
  await record(page, "UAT U10 lượt sau");
  expect(await issue()).toMatchObject({ returned: 0.07, due: 0.03 });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(good).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
