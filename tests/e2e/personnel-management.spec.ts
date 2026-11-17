import nextEnv from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { clickUntilState } from "./helpers/interaction-readiness";

nextEnv.loadEnvConfig(process.cwd());

const serviceDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const adminDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const e2eAdminEmail = process.env.E2E_ADMIN_EMAIL ?? "admin@campus.local";
const e2eAdminPassword = process.env.E2E_ADMIN_PASSWORD ?? "LocalAdmin123!";
const e2eAdminAuthEmail =
  process.env.E2E_ADMIN_AUTH_EMAIL ??
  (e2eAdminEmail === "admin" ? "admin@medlabs.local" : e2eAdminEmail);
const e2eAdminProfileEmail =
  process.env.E2E_ADMIN_PROFILE_EMAIL ?? "admin@campus.local";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(e2eAdminEmail);
  await page.locator('input[name="password"]').fill(e2eAdminPassword);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
}

async function deletePersonnel(email: string) {
  await adminDb.auth.signInWithPassword({
    email: e2eAdminAuthEmail,
    password: e2eAdminPassword,
  });
  const { data } = await adminDb
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (data?.id) await serviceDb.auth.admin.deleteUser(data.id);
}

test("personnel drawer saves role, import capability and lock atomically", async ({
  page,
}) => {
  const email = `personnel-e2e-${crypto.randomUUID()}@campus.local`;
  const phone = `09${Date.now().toString().slice(-8)}`;
  await loginAsAdmin(page);
  try {
    await page.goto("/admin/personnel");
    await page.getByText("Thêm nhân sự mới", { exact: true }).click();
    const createForm = page.locator(".admin-create-personnel form");
    await createForm.locator('input[name="full_name"]').fill("Trợ giảng E2E");
    await createForm.locator('input[name="email"]').fill(email);
    await createForm.locator('input[name="password"]').fill("LocalQa123!");
    await createForm.locator('input[name="phone"]').fill(phone);
    await createForm
      .locator('input[name="roles"][value="teaching_assistant"]')
      .check();
    await createForm.locator('input[name="can_import_schedules"]').check();
    await createForm.getByRole("button", { name: "Tạo tài khoản" }).click();
    // The list shows 50 people a page; search so the new row is on screen.
    await expect(page).toHaveURL(/[?&]notice=/);
    await page.goto(`/admin/personnel?q=${encodeURIComponent(email)}`);

    const row = page
      .locator(".personnel-table tbody tr")
      .filter({ hasText: email });
    await expect(row).toContainText("Trợ giảng");
    await expect(row).toContainText("Nhập lịch");
    const drawer = page.getByRole("dialog", { name: "Chỉnh sửa nhân sự" });
    await clickUntilState(row.getByRole("button", { name: "Sửa" }), () =>
      expect(drawer).toBeVisible({ timeout: 1_000 }),
    );
    await drawer.getByLabel("Cho phép nhập lịch").uncheck();
    await drawer.getByLabel("Đang hoạt động").uncheck();
    await drawer.getByRole("button", { name: "Lưu thay đổi" }).click();
    const confirmation = page.locator(".confirm-dialog");
    await expect(confirmation).toContainText("Khóa tài khoản?");
    await expect(
      confirmation.getByRole("button", { name: "Quay lại" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      confirmation.getByRole("button", { name: "Khóa tài khoản" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      confirmation.getByRole("button", { name: "Quay lại" }),
    ).toBeFocused();
    await clickUntilState(
      confirmation.getByRole("button", { name: "Khóa tài khoản" }),
      () =>
        expect(drawer.getByRole("status")).toContainText(
          "Đã cập nhật nhân sự.",
        ),
    );
    await expect(row).toContainText("Đã khóa");
    await expect(row).not.toContainText("Nhập lịch");
  } finally {
    await deletePersonnel(email);
  }
});

test("Root và Bảo thấy Personnel, Admin thường bị ẩn menu và redirect", async ({
  page,
}) => {
  await login(page, "bao.nguyen@eiu.edu.vn", "LocalPersonnelManager123!");
  await expect(page.getByRole("link", { name: "Nhân sự" })).toBeVisible();
  await page.goto("/admin/personnel");
  await expect(page).toHaveURL(/\/admin\/personnel/);
  const rootRow = page
    .locator(".personnel-table tbody tr")
    .filter({ hasText: e2eAdminProfileEmail });
  await expect(rootRow).toContainText("Quản trị viên gốc");
  await expect(rootRow.getByRole("button", { name: "Xem" })).toBeVisible();
  const managerRow = page
    .locator(".personnel-table tbody tr")
    .filter({ hasText: "bao.nguyen@eiu.edu.vn" });
  await expect(managerRow).toContainText("Quản lý nhân sự");
  await expect(managerRow.getByRole("button", { name: "Xem" })).toBeVisible();

  await page.context().clearCookies();
  await login(page, "admin.other@campus.local", "LocalOtherAdmin123!");
  await expect(page.getByRole("link", { name: "Nhân sự" })).toHaveCount(0);
  await page.goto("/admin/personnel");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("Personnel edit drawer remains usable at the required desktop viewports", async ({
  page,
}) => {
  await loginAsAdmin(page);
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/admin/personnel");
    await expect(page.locator(".personnel-table")).toBeVisible();
    const staffRow = page
      .locator(".personnel-table tbody tr")
      .filter({ hasText: "staff@campus.local" });
    await expect(staffRow).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await staffRow.getByRole("button", { name: "Sửa" }).click();
    const drawer = page.getByRole("dialog", { name: "Chỉnh sửa nhân sự" });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByText("Mật khẩu / Bảo mật", { exact: true }),
    ).toBeVisible();
    await expect(
      drawer.getByText("Vai trò chính", { exact: true }),
    ).toBeVisible();
    await expect(
      drawer.getByText("Phạm vi phụ trách", { exact: true }),
    ).toBeVisible();
    await expect(
      drawer.getByLabel("Quản lý Email Notifications"),
    ).toBeVisible();
    const body = drawer.locator(".personnel-drawer-body");
    await expect
      .poll(() =>
        body.evaluate((element) => element.scrollHeight > element.clientHeight),
      )
      .toBe(true);
    await body.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect(
      drawer.getByRole("button", { name: "Lưu thay đổi" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await drawer.getByRole("button", { name: "Đóng" }).click();
  }
});

async function openStaffDrawer(page: Page, email: string) {
  const staffRow = page
    .locator(".personnel-table tbody tr")
    .filter({ hasText: email });
  await expect(staffRow).toBeVisible();
  await staffRow.getByRole("button", { name: "Sửa" }).click();
  return page.getByRole("dialog", { name: "Chỉnh sửa nhân sự" });
}

async function createStaffParityFixture(canManageEmailNotifications: boolean) {
  const email = `personnel-parity-${crypto.randomUUID()}@campus.local`;
  const { data: created, error: createError } =
    await serviceDb.auth.admin.createUser({
      email,
      password: "LocalParity123!",
      email_confirm: true,
    });
  if (createError || !created.user) {
    throw createError ?? new Error("Unable to create Personnel parity fixture");
  }
  const { data: roomType, error: roomTypeError } = await serviceDb
    .from("room_types")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .single();
  if (roomTypeError || !roomType) {
    await serviceDb.auth.admin.deleteUser(created.user.id);
    throw roomTypeError ?? new Error("Missing active room type fixture");
  }
  const [roleResult, scopeResult, profileResult] = await Promise.all([
    serviceDb
      .from("user_roles")
      .insert({ user_id: created.user.id, role: "staff" }),
    serviceDb.from("profile_room_types").upsert(
      {
        profile_id: created.user.id,
        room_type_id: roomType.id,
        receive_schedule_emails: false,
      },
      { onConflict: "profile_id,room_type_id" },
    ),
    serviceDb
      .from("profiles")
      .update({
        full_name: "Nhân sự parity local",
        is_active: true,
        can_manage_email_notifications: canManageEmailNotifications,
      })
      .eq("id", created.user.id),
  ]);
  const setupError =
    roleResult.error ?? scopeResult.error ?? profileResult.error;
  if (setupError) {
    await serviceDb.auth.admin.deleteUser(created.user.id);
    throw setupError;
  }
  return { email, id: created.user.id };
}

test("email notification capability alone keeps the production dirty boundary", async ({
  page,
}) => {
  const fixture = await createStaffParityFixture(false);

  await loginAsAdmin(page);
  await page.goto("/admin/personnel");
  try {
    await page.goto(`/admin/personnel?q=${encodeURIComponent(fixture.email)}`);
    const drawer = await openStaffDrawer(page, fixture.email);
    const capability = drawer.getByLabel("Quản lý Email Notifications");
    const save = drawer.getByRole("button", { name: "Lưu thay đổi" });
    await expect(save).toBeDisabled();
    await capability.setChecked(true);
    await expect(save).toBeDisabled();
    await drawer.getByRole("button", { name: "Đóng" }).click();
    await expect(
      page.getByRole("dialog", { name: "Bỏ thay đổi chưa lưu?" }),
    ).toHaveCount(0);

    const { data: persisted } = await serviceDb
      .from("profiles")
      .select("can_manage_email_notifications")
      .eq("id", fixture.id)
      .single();
    expect(persisted?.can_manage_email_notifications).toBe(false);
  } finally {
    await serviceDb.auth.admin.deleteUser(fixture.id);
  }
});

test("email notification capability-only close does not open a discard confirmation", async ({
  page,
}) => {
  const fixture = await createStaffParityFixture(false);

  await loginAsAdmin(page);
  try {
    await page.goto(`/admin/personnel?q=${encodeURIComponent(fixture.email)}`);
    const drawer = await openStaffDrawer(page, fixture.email);
    const capability = drawer.getByLabel("Quản lý Email Notifications");
    await capability.setChecked(true);
    await drawer.getByRole("button", { name: "Đóng" }).click();
    await expect(
      page.getByRole("dialog", { name: "Bỏ thay đổi chưa lưu?" }),
    ).toHaveCount(0);
    await expect(drawer).toHaveCount(0);
  } finally {
    await serviceDb.auth.admin.deleteUser(fixture.id);
  }
});

test("removing Staff preserves the raw email capability like production", async ({
  page,
}) => {
  const fixture = await createStaffParityFixture(true);
  await loginAsAdmin(page);
  try {
    await page.goto(`/admin/personnel?q=${encodeURIComponent(fixture.email)}`);
    const drawer = await openStaffDrawer(page, fixture.email);
    await drawer.getByLabel("Giảng viên").check();
    await drawer.getByLabel("Chuyên viên").uncheck();
    await drawer.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(drawer.getByText("Đã lưu", { exact: true })).toBeVisible();
    // The access_version page key remounts after a successful mutation. Reopen
    // the current drawer without reloading the page, as production does.
    await expect(drawer).toHaveCount(0);
    const reopened = await openStaffDrawer(page, fixture.email);
    await reopened.getByLabel("Chuyên viên").check();
    await expect(
      reopened.getByLabel("Quản lý Email Notifications"),
    ).toBeChecked();
    const { data: persisted } = await serviceDb
      .from("profiles")
      .select("can_manage_email_notifications")
      .eq("id", fixture.id)
      .single();
    expect(persisted?.can_manage_email_notifications).toBe(true);
    await reopened.getByRole("button", { name: "Đóng" }).click();
    const discard = page.getByRole("dialog", { name: "Bỏ thay đổi chưa lưu?" });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Bỏ thay đổi" }).click();
  } finally {
    await serviceDb.auth.admin.deleteUser(fixture.id);
  }
});

test("personnel reconciler actual integration test (N-MEDIUM-01)", async ({
  request,
}) => {
  const email = `reconciler-e2e-${Date.now()}@campus.local`;
  const { data: targetUser, error: createError } =
    await serviceDb.auth.admin.createUser({
      email,
      password: "LocalTest123!",
      email_confirm: true,
    });
  expect(createError).toBeNull();
  if (!targetUser?.user?.id) {
    throw new Error("Failed to create personnel reconciliation test user");
  }
  const targetUserId = targetUser.user.id;

  try {
    // Create a fresh client for root admin to avoid sharing state
    const rootDb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Sign in as root temporarily to get session
    const { error: rootAuthError } = await rootDb.auth.signInWithPassword({
      email: e2eAdminAuthEmail,
      password: e2eAdminPassword,
    });
    expect(rootAuthError).toBeNull();

    // Get profile data for target
    const { data: profile } = await serviceDb
      .from("profiles")
      .select("*")
      .eq("id", targetUserId)
      .single();
    if (!profile) {
      throw new Error("Missing personnel reconciliation test profile");
    }

    const { data: roomType } = await serviceDb
      .from("room_types")
      .select("id")
      .limit(1)
      .single();
    if (!roomType) {
      throw new Error(
        "Missing room type fixture for personnel reconciliation test",
      );
    }

    // 1. Begin personnel update
    const requestedEmail = `changed-${email}`;
    const payload = {
      target_profile_id: targetUserId,
      target_full_name: profile.full_name || "Reconciler Test",
      target_email: requestedEmail,
      target_phone: profile.phone || "0900999888",
      target_roles: ["lecturer"],
      target_room_type_ids: [roomType.id],
      target_email_room_type_ids: [roomType.id],
      target_title: profile.title || null,
      target_allow_basic_medical_access: false,
      target_is_active: true,
      target_expected_version: profile.access_version,
      target_can_import_schedules: false,
    };

    const { data: operation, error: beginError } = await rootDb.rpc(
      "begin_personnel_update",
      payload,
    );
    expect(beginError).toBeNull();
    if (!operation?.operation_id) {
      throw new Error("Personnel update operation is missing operation_id");
    }
    const operationId = operation.operation_id;

    // 2. Auth update succeeds
    const { error: authUpdateError } =
      await serviceDb.auth.admin.updateUserById(targetUserId, {
        email: requestedEmail,
        email_confirm: true,
      });
    expect(authUpdateError).toBeNull();

    // 3. DB mark/finalization is intentionally skipped
    // 4. Operation becomes expired (we simulate by updating expires_at)
    await serviceDb
      .from("personnel_update_operations")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", operationId);

    // 5. REAL reconciler runs
    const response = await request.get(
      "/api/internal/personnel-reconciliation",
      {
        headers: {
          authorization: "Bearer local-e2e-cron-secret",
        },
      },
    );
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.rolledBack).toBeGreaterThanOrEqual(1);

    // 6. Auth is restored
    const { data: finalAuth } =
      await serviceDb.auth.admin.getUserById(targetUserId);
    expect(finalAuth.user?.email).toBe(email);

    // 7. Profile stays/restores previous state
    const { data: finalProfile } = await serviceDb
      .from("profiles")
      .select("email")
      .eq("id", targetUserId)
      .single();
    if (!finalProfile) {
      throw new Error("Missing profile during reconciliation verify");
    }
    expect(finalProfile.email).toBe(email);

    // 8. Operation becomes rolled_back
    const { data: durable } = await serviceDb
      .from("personnel_update_operations")
      .select("status")
      .eq("id", operationId)
      .single();
    if (!durable) {
      throw new Error("Missing personnel operation during verify");
    }
    expect(durable.status).toBe("rolled_back");
  } finally {
    if (targetUser?.user?.id) {
      await serviceDb.auth.admin.deleteUser(targetUser.user.id);
    }
  }
});
