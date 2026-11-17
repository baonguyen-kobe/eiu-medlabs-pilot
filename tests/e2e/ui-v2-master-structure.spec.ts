import { expect, test } from "@playwright/test";
import { clickUntilState } from "./helpers/interaction-readiness";

// This one structural audit intentionally traverses five desktop/mobile widths.
test.setTimeout(90_000);

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  const email = page.locator('input[name="email"]');
  const password = page.locator('input[name="password"]');
  const submit = page.getByRole("button", { name: "Đăng nhập", exact: true });
  await clickUntilState(
    submit,
    () => expect(page).toHaveURL(/\/(dashboard|basic-medical\/schedules)/),
    async () => {
      await email.fill("admin@campus.local");
      await password.fill("LocalAdmin123!");
    },
  );
}

async function expectNoPageOverflow(
  page: import("@playwright/test").Page,
  width: number,
) {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
  const overflow = await page.evaluate(
    () =>
      Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      ) - window.innerWidth,
  );
  expect(overflow, `page overflow at ${width}px`).toBeLessThanOrEqual(1);
}

test("UI V2 preserves approved production masters and local table containment", async ({
  page,
}) => {
  await login(page);
  await page.goto("/dashboard");

  const sidebar = page.locator(".workspace-sidebar.sidebar");
  await expect(sidebar).toBeVisible();
  const sidebarStyle = await sidebar.evaluate((element) => {
    const active = element.querySelector<HTMLElement>(".nav-item.active");
    const heading = element.querySelector<HTMLElement>(".nav-heading");
    return {
      backgroundImage: getComputedStyle(element).backgroundImage,
      width: getComputedStyle(element).width,
      headingColor: heading ? getComputedStyle(heading).color : "",
      itemHeight: active ? getComputedStyle(active).minHeight : "",
      itemRadius: active ? getComputedStyle(active).borderRadius : "",
      activeShadow: active ? getComputedStyle(active).boxShadow : "",
    };
  });
  expect(sidebarStyle.backgroundImage).toContain("linear-gradient");
  expect(sidebarStyle.width).toBe("244px");
  expect(sidebarStyle.headingColor).toBe("rgb(217, 196, 158)");
  expect(sidebarStyle.itemHeight).toBe("42px");
  expect(sidebarStyle.itemRadius).toBe("11px");
  expect(sidebarStyle.activeShadow).toContain("rgb(167, 134, 86)");

  const heading = page.locator(".page-header h1, .workspace-topbar h1").first();
  await expect(heading).toBeVisible();
  const headingStyle = await heading.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.color,
      fontSize: Number.parseFloat(style.fontSize),
      weight: style.fontWeight,
    };
  });
  expect(headingStyle.color).toBe("rgb(20, 64, 105)");
  expect(headingStyle.fontSize).toBeGreaterThanOrEqual(27);
  expect(Number(headingStyle.weight)).toBeGreaterThanOrEqual(700);

  await page.goto("/schedule-entry/new");
  const sectionStyle = await page
    .locator(".form-section-number")
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      const title = element.parentElement?.querySelector<HTMLElement>("h2");
      return {
        width: Number.parseFloat(style.minWidth),
        height: Number.parseFloat(style.height),
        radius: style.borderRadius,
        background: style.backgroundColor,
        color: style.color,
        headingColor: title ? getComputedStyle(title).color : "",
      };
    });
  expect(sectionStyle.width).toBeGreaterThanOrEqual(34);
  expect(sectionStyle.height).toBe(30);
  expect(sectionStyle.radius).toBe("9px");
  expect(sectionStyle.background).toBe("rgb(229, 237, 245)");
  expect(sectionStyle.color).toBe("rgb(20, 64, 105)");
  expect(sectionStyle.headingColor).toBe("rgb(20, 64, 105)");

  await page.goto("/admin/personnel");
  await page.getByRole("button", { name: "Sửa", exact: true }).first().click();
  await expect(
    page.getByRole("dialog", { name: "Chỉnh sửa nhân sự" }),
  ).toBeVisible();
  const drawerSections = await page
    .locator(".personnel-drawer-body")
    .evaluate((element) =>
      Array.from(element.querySelectorAll("fieldset, section[aria-label]")).map(
        (section) => section.querySelector("legend, h3")?.textContent?.trim(),
      ),
    );
  expect(drawerSections.at(-1)).toBe("Mật khẩu / Bảo mật");

  await page.goto("/schedule-entry/import");
  const stepperStyle = await page
    .locator(".stepper")
    .first()
    .evaluate((element) => {
      const circle = element.querySelector<HTMLElement>("li > span");
      return {
        line: getComputedStyle(element, "::before").content,
        width: circle ? getComputedStyle(circle).width : "",
        radius: circle ? getComputedStyle(circle).borderRadius : "",
      };
    });
  expect(stepperStyle.line).not.toBe("none");
  expect(stepperStyle.width).toBe("31px");
  expect(stepperStyle.radius).toBe("50%");

  for (const width of [1920, 1440, 1366, 820, 390]) {
    await page.goto("/equipment/mine");
    await expectNoPageOverflow(page, width);
    const tableStyle = await page
      .locator(".responsive-table")
      .first()
      .evaluate((element) => {
        const style = getComputedStyle(element);
        const header = element.querySelector<HTMLElement>("thead th");
        return {
          overflowX: style.overflowX,
          // Inside a card the card owns the rounded shell (see globals.css:
          // "its card parent owns the single visual table shell").
          radius: Math.max(
            Number.parseFloat(style.borderTopLeftRadius),
            Number.parseFloat(
              getComputedStyle(element.parentElement ?? element)
                .borderTopLeftRadius,
            ),
          ),
          headerBackground: header
            ? getComputedStyle(header).backgroundColor
            : "",
        };
      });
    expect(tableStyle.overflowX).toBe("auto");
    expect(tableStyle.radius).toBeGreaterThan(0);
    expect(tableStyle.headerBackground).not.toBe("rgba(0, 0, 0, 0)");
  }
});
