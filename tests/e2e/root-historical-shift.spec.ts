import { spawnSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { clickUntilState } from "./helpers/interaction-readiness";

function localSql(sql: string) {
  const listed = spawnSync(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${process.env.SUPABASE_LOCAL_PROJECT_ID ?? "lich-truc-app"}`,
      "--format",
      "{{.Names}}",
    ],
    { encoding: "utf8" },
  );
  const databases = listed.stdout
    .split(/\r?\n/)
    .filter((name) => name.startsWith("supabase_db_"));
  if (listed.status !== 0 || databases.length !== 1) {
    throw new Error("REFUSING_AMBIGUOUS_LOCAL_SUPABASE_DATABASE");
  }
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      databases[0],
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: sql, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "LOCAL_SQL_FAILED");
  }
  return result.stdout.trim();
}

async function loginAsRoot(page: Page) {
  await page.goto("/login");
  await clickUntilState(
    page.locator('button[type="submit"]'),
    () => expect(page).toHaveURL(/\/dashboard$/, { timeout: 1_000 }),
    async () => {
      await page.locator('input[name="email"]').fill("admin@campus.local");
      await page.locator('input[name="password"]').fill("LocalAdmin123!");
    },
  );
}

test("historical Root shift stays readable and read-only on the calendar", async ({
  page,
}) => {
  const shiftId = crypto.randomUUID();
  const date = "2020-01-06";
  const [rootId, rootName] = localSql(
    `select p.id || '|' || p.full_name
     from public.profiles p
     join public.system_security_principals s on s.root_admin_id = p.id
     limit 1;`,
  ).split("|");

  try {
    localSql(`
      begin;
      alter table public.staff_shifts disable trigger staff_shift_operational_assignee;
      insert into public.staff_shifts
        (id, staff_id, shift_date, shift_slot, start_time, end_time, status, registration_source, created_by, note)
      values
        ('${shiftId}', '${rootId}', '${date}', 'MORNING', '08:30', '11:30', 'scheduled', 'admin_assigned', '${rootId}', 'historical Root fixture');
      alter table public.staff_shifts enable trigger staff_shift_operational_assignee;
      commit;
    `);

    await loginAsRoot(page);
    await page.goto(`/class-schedules?view=week&date=${date}`);
    const rootEvent = page
      .locator(".slot-event-shift")
      .filter({ hasText: rootName });
    await expect(rootEvent).toBeVisible();
    await clickUntilState(rootEvent, () =>
      expect(page.getByLabel("Chi tiết lịch")).toBeVisible({ timeout: 1_000 }),
    );

    // The calendar detail no longer reassigns shifts (roster page only), so
    // the shift is read-only here. The database trigger
    // staff_shift_operational_assignee still keeps Root out of new shifts.
    const detail = page.getByLabel("Chi tiết lịch");
    await expect(detail).toContainText(rootName);
    await expect(detail.locator("select")).toHaveCount(0);
  } finally {
    localSql(`delete from public.staff_shifts where id = '${shiftId}';`);
  }
});
