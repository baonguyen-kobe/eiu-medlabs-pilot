import { expect, test, type Page } from "@playwright/test";
import { clickUntilState } from "./helpers/interaction-readiness";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  const email = page.locator('input[name="email"]');
  const password = page.locator('input[name="password"]');
  await clickUntilState(
    page.getByRole("button", { name: "Đăng nhập", exact: true }),
    () => expect(page).toHaveURL(/\/dashboard$/),
    async () => {
      await email.fill("admin@campus.local");
      await password.fill("LocalAdmin123!");
    },
  );
}

function catalogCsv(name: string, manufacturer: string) {
  return [
    "item_name,commercial_name,item_type,country_of_origin,manufacturer,model,unit",
    `"${name}","E2E Trade","Vật tư","Việt Nam","${manufacturer}","E2E-01","Cái"`,
  ].join("\r\n");
}

test("danh mục thiết bị hỗ trợ import, export, tìm kiếm, sort và thao tác hàng loạt", async ({
  page,
}) => {
  await loginAsAdmin(page);

  const nav = page.locator(".workspace-nav");
  await nav.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  const scrollBefore = await nav.evaluate((element) => element.scrollTop);
  await clickUntilState(
    page.getByRole("link", { name: "Danh mục", exact: true }),
    () => expect(page).toHaveURL(/\/admin\/equipment$/),
  );
  // t4c: the other catalogs are tabs on the catalog page.
  await expect(page.getByRole("link", { name: "Môn học" })).toBeVisible();
  if (scrollBefore > 0) {
    await expect
      .poll(() => nav.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
  }

  await expect(
    page.getByRole("button", { name: "Import tất cả" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Import mới" })).toBeVisible();
  const templateLink = page.getByRole("link", {
    name: "Tải template",
    exact: true,
  });
  await expect(templateLink).toBeVisible();
  const exportLink = page.getByRole("link", { name: "Export tất cả" });
  await expect(exportLink).toBeVisible();
  const importActionTops = await Promise.all(
    [
      templateLink,
      page.getByRole("button", { name: "Import tất cả" }),
      page.getByRole("button", { name: "Import mới" }),
      exportLink,
    ].map(async (control) => (await control.boundingBox())?.y ?? 0),
  );
  expect(
    Math.max(...importActionTops) - Math.min(...importActionTops),
  ).toBeLessThan(3);
  await expect(
    page.getByRole("button", { name: "Sửa", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ngừng sử dụng" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Xóa", exact: true }),
  ).toBeVisible();

  const actionWidths = await Promise.all(
    ["Sửa", "Ngừng sử dụng", "Xóa"].map(async (name) => {
      const box = await page
        .getByRole("button", { name, exact: true })
        .boundingBox();
      return Math.round(box?.width ?? 0);
    }),
  );
  expect(new Set(actionWidths).size).toBe(1);

  const templateDownloadPromise = page.waitForEvent("download");
  await templateLink.click();
  const templateDownload = await templateDownloadPromise;
  expect(templateDownload.suggestedFilename()).toBe(
    "template-import-danh-muc-thiet-bi.xlsx",
  );

  const manualInput = page.locator(
    '.equipment-catalog-create-form input[name="item_name"]',
  );
  await expect(manualInput).toHaveCSS("border-top-style", "solid");
  await expect(manualInput).toHaveCSS("border-top-width", "1px");

  const itemNameCells = page.locator(
    ".equipment-catalog-table tbody tr td:first-of-type",
  );
  const namesAscending = await itemNameCells.allTextContents();
  expect(namesAscending).toEqual(
    namesAscending.toSorted((left, right) =>
      left.trim().localeCompare(right.trim(), "vi", {
        numeric: true,
        sensitivity: "base",
      }),
    ),
  );
  await page
    .getByRole("button", { name: /Tên thiết bị và vật tư/ })
    .last()
    .click();
  const namesDescending = await itemNameCells.allTextContents();
  expect(namesDescending).toEqual([...namesAscending].reverse());

  const downloadPromise = page.waitForEvent("download");
  await exportLink.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^danh-muc-thiet-bi-\d{8}\.xlsx$/,
  );

  const uniqueName = `[E2E ${Date.now()}] Bộ thực hành`;
  const importNewUpload = page.locator(
    '.catalog-import-new-action input[name="file"]',
  );
  await importNewUpload.setInputFiles({
    name: "equipment-new.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(catalogCsv(uniqueName, "Hãng ban đầu"), "utf8"),
  });
  await expect(page).toHaveURL(/notice=/);
  await page.goto("/admin/equipment", { waitUntil: "networkidle" });

  const search = page.locator(".equipment-catalog-search input");
  await search.fill(uniqueName);
  let row = page
    .locator(".equipment-catalog-table tbody tr")
    .filter({ hasText: uniqueName });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Hãng ban đầu");

  const importAllUpload = page.locator(
    '.catalog-import-all-action input[type="file"]',
  );
  await importAllUpload.setInputFiles({
    name: "equipment-all.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(catalogCsv(uniqueName, "Hãng đã cập nhật"), "utf8"),
  });
  const previewDialog = page.getByRole("dialog", { name: "Import tất cả" });
  await expect(previewDialog).toBeVisible();
  await expect(previewDialog).toContainText("equipment-all.csv");
  await previewDialog
    .getByRole("button", { name: "Import tất cả", exact: true })
    .click();
  await expect(previewDialog).toHaveCount(0);
  await page.goto("/admin/equipment", { waitUntil: "networkidle" });
  await page.locator(".equipment-catalog-search input").fill(uniqueName);
  row = page
    .locator(".equipment-catalog-table tbody tr")
    .filter({ hasText: uniqueName });
  await expect(row).toContainText("Hãng đã cập nhật");

  await page.getByRole("button", { name: "Sửa", exact: true }).click();
  await page
    .getByRole("textbox", { name: `Tên thương mại của ${uniqueName}` })
    .fill("E2E Trade Updated");
  await page.getByRole("button", { name: "Lưu chỉnh sửa" }).click();
  await expect(page.getByText(/Đã lưu 1 dòng thiết bị/)).toBeVisible();
  row = page
    .locator(".equipment-catalog-table tbody tr")
    .filter({ hasText: uniqueName });
  await expect(row).toContainText("E2E Trade Updated");

  await page.getByRole("button", { name: "Ngừng sử dụng" }).click();
  await row.getByRole("checkbox", { name: `Chọn ${uniqueName}` }).check();
  await page.getByRole("button", { name: "Xác nhận ngừng sử dụng" }).click();
  const disableDialog = page.locator(".confirm-dialog");
  await expect(disableDialog).toContainText("Ngừng sử dụng 1 thiết bị?");
  await disableDialog.getByRole("button", { name: "Xác nhận" }).click();
  await expect(row).toContainText("Ngừng sử dụng");
  await page.getByLabel("Lọc trạng thái thiết bị").selectOption("inactive");
  await expect(row).toHaveCount(1);

  await page.getByRole("button", { name: "Xóa", exact: true }).click();
  await row.getByRole("checkbox", { name: `Chọn ${uniqueName}` }).check();
  await page.getByRole("button", { name: "Xác nhận xóa" }).click();
  const deleteDialog = page.locator(".confirm-dialog");
  await expect(deleteDialog).toContainText("Xóa 1 thiết bị?");
  await deleteDialog.getByRole("button", { name: "Xác nhận" }).click();
  await expect(row).toHaveCount(0);
});
