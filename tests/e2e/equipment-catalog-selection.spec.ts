import nextEnv from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

nextEnv.loadEnvConfig(process.cwd());

const serviceDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
// The seed has no catalog rows with these names, so the test brings its own.
const catalogFixture = [
  ["6e2e0000-0000-4000-8000-000000000001", "Anti A", "Anti A Atlas 10ml"],
  ["6e2e0000-0000-4000-8000-000000000002", "Anti A", "Anti A Spectrum 10ml"],
  ["6e2e0000-0000-4000-8000-000000000003", "Anti B", "Anti B Spectrum 10ml"],
  ["6e2e0000-0000-4000-8000-000000000004", "Ambu", "Ambu bóp bóng"],
].map(([id, item_name, commercial_name]) => ({
  id,
  item_name,
  commercial_name,
  unit: item_name === "Ambu" ? "Cái" : "Lọ",
  is_active: true,
}));

test.beforeAll(async () => {
  const { error } = await serviceDb
    .from("equipment_catalog")
    .upsert(catalogFixture, { onConflict: "id" });
  expect(error).toBeNull();
});

test.afterAll(async () => {
  await serviceDb
    .from("equipment_catalog")
    .delete()
    .in(
      "id",
      catalogFixture.map(({ id }) => id),
    );
});

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill("admin@campus.local");
  await page.locator('input[name="password"]').fill("LocalAdmin123!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("đăng ký thiết bị cho chọn và tìm kiếm theo hai chiều", async ({
  page,
}) => {
  await loginAsAdmin(page);
  await page.goto("/equipment/register");
  await page.getByLabel("Số lượng kỹ năng/bài thực hành *").selectOption("1");
  await page.getByRole("button", { name: "+ Tạo bảng thiết bị" }).click();

  const rows = page.locator(".equipment-items-table tbody tr");
  await expect(rows).toHaveCount(3);

  const firstRow = rows.nth(0);
  const firstItemName = firstRow.getByRole("combobox", {
    name: "Tên thiết bị dòng 1, kỹ năng 1",
  });
  const firstCommercialName = firstRow.getByRole("combobox", {
    name: "Tên thương mại dòng 1, kỹ năng 1",
  });

  await firstCommercialName.fill("Anti B Spectrum 10ml");
  await page.getByRole("option", { name: /^Anti B Spectrum 10ml/ }).click();
  await expect(firstItemName).toHaveValue("Anti B");
  await expect(firstRow.locator("td").nth(3).locator("input")).toHaveValue(
    "Lọ",
  );

  await firstCommercialName.fill("Ambu bóp bóng");
  await page.getByRole("option", { name: /^Ambu bóp bóng/ }).click();
  await expect(firstItemName).toHaveValue("Ambu");

  const secondRow = rows.nth(1);
  const secondItemName = secondRow.getByRole("combobox", {
    name: "Tên thiết bị dòng 2, kỹ năng 1",
  });
  const secondCommercialName = secondRow.getByRole("combobox", {
    name: "Tên thương mại dòng 2, kỹ năng 1",
  });

  await secondItemName.fill("Anti A");
  await page.getByRole("option", { name: "Anti A", exact: true }).click();
  await secondCommercialName.click();
  await expect(
    page.getByRole("option", { name: /^Anti A Atlas 10ml/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: /^Anti A Spectrum 10ml/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: /^Anti B Spectrum 10ml/ }),
  ).toHaveCount(0);

  await secondCommercialName.fill("Spectrum");
  await expect(
    page.getByRole("option", { name: /^Anti A Spectrum 10ml/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: /^Anti A Atlas 10ml/ }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: /^Anti A Spectrum 10ml/ }).click();
  await expect(secondItemName).toHaveValue("Anti A");
});
