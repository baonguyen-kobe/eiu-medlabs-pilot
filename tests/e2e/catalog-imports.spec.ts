import nextEnv from "@next/env";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "@e965/xlsx";
import { clickUntilState } from "./helpers/interaction-readiness";

nextEnv.loadEnvConfig(process.cwd());

const serviceDb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
const e2eAdminEmail = process.env.E2E_ADMIN_EMAIL ?? "admin@campus.local";
const e2eAdminPassword = process.env.E2E_ADMIN_PASSWORD ?? "LocalAdmin123!";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  const email = page.locator('input[name="email"]');
  const password = page.locator('input[name="password"]');
  await clickUntilState(
    page.getByRole("button", { name: "Đăng nhập", exact: true }),
    () => expect(page).toHaveURL(/\/dashboard$/, { timeout: 1_000 }),
    async () => {
      await email.fill(e2eAdminEmail);
      await password.fill(e2eAdminPassword);
    },
  );
}

async function expectDownload(page: Page, linkName: string, filename: string) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: linkName, exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(filename);
}

async function workbookText(page: Page, url: string) {
  const response = await page.request.get(url);
  expect(response.ok()).toBe(true);
  const workbook = XLSX.read(await response.body(), { type: "buffer" });
  return workbook.SheetNames.flatMap((sheetName) =>
    XLSX.utils.sheet_to_json<Array<unknown>>(workbook.Sheets[sheetName], {
      header: 1,
      defval: "",
    }),
  )
    .flat(2)
    .join("\n");
}

test("equipment catalog stale reconciliation keeps the preview open and blocks the old plan", async ({
  page,
}) => {
  const staleFixtureId = crypto.randomUUID();
  const suffix = staleFixtureId.slice(0, 8);
  await loginAsAdmin(page);
  try {
    await page.goto("/admin/equipment", { waitUntil: "networkidle" });
    await page
      .locator('.catalog-import-all-action input[type="file"]')
      .setInputFiles({
        name: "catalog-stale.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          [
            "Tên thiết bị và vật tư,Tên thương mại,ĐVT",
            `Thiết bị preview ${suffix},Thương mại preview ${suffix},Cái`,
          ].join("\n"),
          "utf8",
        ),
      });

    const dialog = page.getByRole("dialog", { name: "Import tất cả" });
    const apply = dialog.getByRole("button", {
      name: "Import tất cả",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".preview-table")).toBeVisible();
    await expect(apply).toBeEnabled();

    const { error: mutationError } = await serviceDb
      .from("equipment_catalog")
      .insert({
        id: staleFixtureId,
        item_name: `Stale fingerprint ${suffix}`,
        commercial_name: `Stale fingerprint ${suffix}`,
        unit: "Cái",
        is_active: true,
      });
    if (mutationError) throw mutationError;

    await apply.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Dữ liệu danh mục đã thay đổi. Hãy chọn lại file để xem trước bản mới.",
    );
    await expect(dialog.locator(".preview-table")).toBeVisible();
    await expect(apply).toBeDisabled();
  } finally {
    await serviceDb.from("equipment_catalog").delete().eq("id", staleFixtureId);
  }
});

test("equipment catalog preview preserves parsed rows when server validation rejects them", async ({
  page,
}) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  await loginAsAdmin(page);
  await page.goto("/admin/equipment", { waitUntil: "networkidle" });

  await page
    .locator('.catalog-import-all-action input[type="file"]')
    .setInputFiles({
      name: "catalog-server-validation.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "Tên thiết bị và vật tư,Tên thương mại,ĐVT",
          `Thiết bị A ${suffix},Tên thương mại ${suffix},Cái`,
          `Thiết bị B ${suffix},tên thương mại ${suffix},Cái`,
        ].join("\n"),
        "utf8",
      ),
    });

  const dialog = page.getByRole("dialog", { name: "Import tất cả" });
  const apply = dialog.getByRole("button", {
    name: "Import tất cả",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".preview-table tbody tr")).toHaveCount(2);
  await expect(dialog.getByRole("alert")).toHaveText(
    "Dữ liệu trong file không hợp lệ. Vui lòng kiểm tra lại Tên thương mại và các trường bắt buộc.",
  );
  await expect(apply).toBeDisabled();
});

test("authenticated admin receives a safe diagnostic for an invalid catalog RPC payload", async () => {
  const actor = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error: signInError } = await actor.auth.signInWithPassword({
    email: e2eAdminEmail === "admin" ? "admin@medlabs.local" : e2eAdminEmail,
    password: e2eAdminPassword,
  });
  expect(signInError).toBeNull();
  try {
    const { error } = await actor.rpc("preview_catalog_reconciliation", {
      target_domain: "skills",
      target_rows: [
        {
          item_name: "Thiết bị local thiếu dữ liệu",
          commercial_name: "",
          unit: "",
        },
      ],
    });
    expect(error?.code).toBe("22023");
    expect(error?.message).toBe("CATALOG_COMMERCIAL_NAME_AND_UNIT_REQUIRED");
  } finally {
    await actor.auth.signOut();
  }
});

test("a portable XLSX matching the actual Course workbook is rejected before preview", async ({
  page,
}) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      Array.from({ length: 26 }, (_, index) => ({
        "Mã môn": `M${String(index + 1).padStart(3, "0")}`,
        "Tên môn học": `Môn học ${index + 1}`,
      })),
    ),
    "Môn",
  );
  const payload = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
  });
  const decoded = XLSX.read(payload, { type: "buffer" });
  const sourceRows = XLSX.utils.sheet_to_json<Array<unknown>>(
    decoded.Sheets[decoded.SheetNames[0]],
    { header: 1, defval: "" },
  );
  expect(sourceRows[0]).toEqual(["Mã môn", "Tên môn học"]);
  expect(sourceRows).toHaveLength(27);

  await loginAsAdmin(page);
  await page.goto("/admin/equipment", { waitUntil: "networkidle" });
  const serverActions: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) {
      serverActions.push(request.url());
    }
  });
  await page
    .locator('.catalog-import-all-action input[type="file"]')
    .setInputFiles({
      name: "Import.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: payload,
    });

  await expect(
    page.getByText("Mỗi dòng cần có Tên thiết bị, Tên thương mại và ĐVT.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Import tất cả" })).toHaveCount(
    0,
  );
  expect(serverActions).toEqual([]);
});

test("local Root administrator has both Skills and Basic Medical workspaces", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { data: principal, error: principalError } = await serviceDb
    .from("system_security_principals")
    .select("root_admin_id")
    .eq("singleton", true)
    .single();
  if (principalError || !principal) {
    throw principalError ?? new Error("Missing local Root administrator");
  }

  const { data: originalProfile, error: profileError } = await serviceDb
    .from("profiles")
    .select("can_import_schedules,can_manage_email_notifications")
    .eq("id", principal.root_admin_id)
    .single();
  if (profileError || !originalProfile) {
    throw profileError ?? new Error("Missing local Root administrator profile");
  }

  const { error: capabilityResetError } = await serviceDb
    .from("profiles")
    .update({
      can_import_schedules: false,
      can_manage_email_notifications: false,
    })
    .eq("id", principal.root_admin_id);
  if (capabilityResetError) throw capabilityResetError;

  try {
    const actor = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    try {
      const { data: signIn, error: signInError } =
        await actor.auth.signInWithPassword({
          email:
            e2eAdminEmail === "admin" ? "admin@medlabs.local" : e2eAdminEmail,
          password: e2eAdminPassword,
        });
      expect(signInError).toBeNull();
      expect(signIn.user?.id).toBe(principal.root_admin_id);
      const [
        { data: personnelAuthority, error: personnelError },
        { data: roles },
      ] = await Promise.all([
        actor.rpc("get_personnel_authority_context"),
        serviceDb
          .from("user_roles")
          .select("role")
          .eq("user_id", principal.root_admin_id),
      ]);
      expect(personnelError).toBeNull();
      expect(personnelAuthority?.is_root_administrator).toBe(true);
      expect(roles?.map((row) => row.role)).toContain("admin");
    } finally {
      await actor.auth.signOut();
    }

    await loginAsAdmin(page);
    for (const route of [
      "/dashboard",
      "/class-schedules",
      "/schedule-entry/new",
      "/schedule-entry/import",
      "/imports",
      "/basic-medical/schedules",
      "/basic-medical/new",
      "/basic-medical/import",
      "/basic-medical/registrations",
      "/admin/personnel",
      "/admin/equipment",
      "/admin/courses",
      "/email-notifications",
    ]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(`${route}$`));
    }
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(
      page.locator('.workspace-sidebar a[href="/class-schedules"]'),
    ).toBeVisible();
    await expect(
      page.locator('.workspace-sidebar a[href="/basic-medical/schedules"]'),
    ).toBeVisible();
    await expect(
      page.locator('.workspace-sidebar a[href="/schedule-entry/import"]'),
    ).toBeVisible();
    await expect(
      page.locator('.workspace-sidebar a[href="/basic-medical/import"]'),
    ).toBeVisible();
    await expect(
      page.locator('.workspace-sidebar a[href="/email-notifications"]'),
    ).toBeVisible();
    await expect(
      page.locator('.workspace-sidebar a[href="/admin/personnel"]'),
    ).toBeVisible();
  } finally {
    const { error: restoreError } = await serviceDb
      .from("profiles")
      .update(originalProfile)
      .eq("id", principal.root_admin_id);
    if (restoreError) throw restoreError;
  }
});

test("template và import danh mục môn học, phòng, thiết bị, nhân sự và Y cơ sở hoạt động", async ({
  page,
}) => {
  const suffix = `${Date.now()}`.slice(-7);
  const courseCode = `IMP${suffix}`;
  const roomCode = `I${suffix.slice(-4)}`;
  const personnelEmail = `import-personnel-${suffix}@campus.local`;
  const personnelViewerEmail = `import-viewer-${suffix}@campus.local`;
  const personnelPhone = `09${suffix.padStart(8, "0").slice(-8)}`;
  const updatedPersonnelPhone = `08${suffix.padStart(8, "0").slice(-8)}`;
  const viewerPhone = `07${suffix.padStart(8, "0").slice(-8)}`;
  let personnelId: string | undefined;
  let personnelViewerId: string | undefined;
  const [
    { data: originalProfiles },
    { data: originalRoles },
    { data: originalScopes },
  ] = await Promise.all([
    serviceDb.from("profiles").select("id,is_active"),
    serviceDb.from("user_roles").select("user_id,role,created_by"),
    serviceDb
      .from("profile_room_types")
      .select("profile_id,room_type_id,created_by,receive_schedule_emails"),
  ]);

  await loginAsAdmin(page);
  try {
    await page.goto("/basic-medical/import");
    await expectDownload(
      page,
      "Mẫu XLSX",
      "basic-medical-import-template.xlsx",
    );
    const scheduleTemplateText = await workbookText(
      page,
      "/api/import-template/xlsx",
    );
    expect(scheduleTemplateText).toContain("Thời gian học");
    expect(scheduleTemplateText).not.toContain("schedule_date");

    await page.goto("/admin/equipment");
    await expectDownload(
      page,
      "Tải template",
      "template-import-danh-muc-thiet-bi.xlsx",
    );

    await page.goto("/admin/courses");
    await expect(
      page.getByRole("button", { name: "Import", exact: true }),
    ).toBeVisible();
    await expectDownload(
      page,
      "Tải template",
      "template-import-danh-muc-mon-hoc.xlsx",
    );
    const courseTemplateText = await workbookText(
      page,
      "/api/admin-catalog-template/courses",
    );
    expect(courseTemplateText).toContain("Loại");
    expect(courseTemplateText).toContain("Kỹ năng Điều dưỡng");
    expect(courseTemplateText).toContain("Y cơ sở");
    expect(courseTemplateText).not.toContain("nursing_skills");
    await page.getByLabel("Chọn file import môn học").setInputFiles({
      name: "courses.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `Mã môn học,Tên môn học,Loại\n${courseCode},Môn import ${suffix},Kỹ năng Điều dưỡng`,
        "utf8",
      ),
    });
    await expect(page).toHaveURL(/\/admin\/courses\?notice=/);
    await expect(
      page.locator("tbody tr").filter({ hasText: courseCode }),
    ).toContainText(`Môn import ${suffix}`);
    await expect(
      page.locator("tbody tr").filter({ hasText: courseCode }),
    ).toContainText("Kỹ năng Điều dưỡng");

    await page.goto("/admin/rooms");
    await expect(
      page.getByRole("button", { name: "Import", exact: true }),
    ).toBeVisible();
    await expectDownload(
      page,
      "Tải template",
      "template-import-danh-muc-phong.xlsx",
    );
    const roomTemplateText = await workbookText(
      page,
      "/api/admin-catalog-template/rooms",
    );
    expect(roomTemplateText).toContain("Kỹ năng Điều dưỡng");
    expect(roomTemplateText).not.toContain("nursing_skills");
    await page.getByLabel("Chọn file import phòng").setInputFiles({
      name: "rooms.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "Mã phòng,Tòa nhà,Tên phòng,Loại phòng,Sức chứa",
          `${roomCode},QA,Phòng import ${suffix},Kỹ năng Điều dưỡng,28`,
        ].join("\n"),
        "utf8",
      ),
    });
    await expect(page).toHaveURL(/\/admin\/rooms\?notice=/);
    const roomRow = page
      .locator("tbody tr")
      .filter({ hasText: `${roomCode}.QA` });
    await expect(roomRow).toContainText(`Phòng import ${suffix}`);
    await expect(roomRow).toContainText("28");

    await page.goto("/admin/personnel");
    await expectDownload(page, "Tải template", "template-import-nhan-su.xlsx");
    const personnelTemplateText = await workbookText(
      page,
      "/api/admin-catalog-template/personnel",
    );
    expect(personnelTemplateText).toContain("Giảng viên");
    expect(personnelTemplateText).toContain("Quản trị viên");
    expect(personnelTemplateText).toContain("Chuyên viên");
    expect(personnelTemplateText).toContain("Trợ giảng");
    expect(personnelTemplateText).toContain("Người xem");
    expect(personnelTemplateText).toContain("Quy tắc riêng cho Người xem");
    expect(personnelTemplateText).toContain(
      "Để trống nếu chỉ xem và không nhận email",
    );
    expect(personnelTemplateText).toContain(
      "Sáu dòng trong sheet Nhân sự là ví dụ hợp lệ",
    );
    expect(personnelTemplateText).toContain("Kỹ năng Điều dưỡng");
    expect(personnelTemplateText).not.toContain("lecturer");
    expect(personnelTemplateText).not.toContain("nursing_skills");
    expect(personnelTemplateText).not.toContain("Admin");
    expect(personnelTemplateText).not.toContain("Staff");
    await expect(
      page.getByRole("button", { name: "Import mới", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Import tất cả", exact: true }),
    ).toBeVisible();

    await page.getByLabel("Chọn file import nhân sự").setInputFiles({
      name: "personnel-invalid-room-type.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "Họ và tên,Email đăng nhập,Mật khẩu tạm,Số điện thoại,Chức danh,Vai trò,Loại phòng,Quyền Y cơ sở",
          `Nhân sự sai ${suffix},invalid-${personnelEmail},LocalImport123!,0901234567,Giảng viên,Giảng viên,Phòng không tồn tại,Không`,
        ].join("\n"),
        "utf8",
      ),
    });
    await page.getByRole("button", { name: "Import mới", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/personnel\?error=/);
    await expect(page.locator(".action-feedback.error")).toContainText(
      'Giá trị chưa đúng: "Phòng không tồn tại"',
    );
    await expect(page.locator(".action-feedback.error")).toContainText(
      "Chỉ dùng: Kỹ năng Điều dưỡng, Y cơ sở",
    );

    await page.getByLabel("Chọn file import nhân sự").setInputFiles({
      name: "personnel-new.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "Họ và tên,Email đăng nhập,Mật khẩu tạm,Số điện thoại,Chức danh,Vai trò,Loại phòng,Quyền Y cơ sở",
          `Nhân sự import ${suffix},${personnelEmail},LocalImport123!,${personnelPhone},Giảng viên,Giảng viên,Kỹ năng Điều dưỡng,Không`,
        ].join("\n"),
        "utf8",
      ),
    });
    await page.getByRole("button", { name: "Import mới", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/personnel\?notice=/);
    await expect(
      page
        .locator(".personnel-table tbody tr")
        .filter({ hasText: personnelEmail }),
    ).toContainText(`Nhân sự import ${suffix}`);

    const { data: createdProfile, error: createdProfileError } = await serviceDb
      .from("profiles")
      .select("id,phone,title,allow_basic_medical_access")
      .eq("email", personnelEmail)
      .single();
    if (createdProfileError) throw createdProfileError;
    personnelId = createdProfile.id;
    expect(createdProfile.phone).toBe(personnelPhone);
    expect(createdProfile.allow_basic_medical_access).toBe(false);

    await page.getByLabel("Chọn file import nhân sự").setInputFiles({
      name: "personnel-all.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "Họ và tên,Email đăng nhập,Mật khẩu tạm,Số điện thoại,Chức danh,Vai trò,Loại phòng,Quyền Y cơ sở",
          `Nhân sự cập nhật ${suffix},${personnelEmail},,${updatedPersonnelPhone},Điều phối viên,Giảng viên,Y cơ sở,Có`,
        ].join("\n"),
        "utf8",
      ),
    });
    await page
      .getByRole("button", { name: "Import tất cả", exact: true })
      .click();
    const replaceDialog = page.getByRole("dialog");
    await replaceDialog.getByRole("textbox").fill("THAY TOÀN BỘ");
    await replaceDialog
      .getByRole("button", { name: "Thay toàn bộ", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/personnel\?notice=/);
    await expect(
      page
        .locator(".personnel-table tbody tr")
        .filter({ hasText: personnelEmail }),
    ).toContainText(`Nhân sự cập nhật ${suffix}`);

    const [{ data: updatedProfile }, { data: importedRoles }] =
      await Promise.all([
        serviceDb
          .from("profiles")
          .select("full_name,phone,title,allow_basic_medical_access")
          .eq("id", personnelId)
          .single(),
        serviceDb.from("user_roles").select("role").eq("user_id", personnelId),
      ]);
    expect(updatedProfile).toMatchObject({
      full_name: `Nhân sự cập nhật ${suffix}`,
      phone: updatedPersonnelPhone,
      title: "Điều phối viên",
      allow_basic_medical_access: true,
    });
    expect(importedRoles?.map(({ role }) => role)).toEqual(["lecturer"]);

    await page.getByLabel("Chọn file import nhân sự").setInputFiles({
      name: "personnel-viewer.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "Họ và tên,Email đăng nhập,Mật khẩu tạm,Số điện thoại,Chức danh,Vai trò,Loại phòng,Loại phòng nhận email,Quyền Y cơ sở",
          `Người xem ${suffix},${personnelViewerEmail},LocalImport123!,${viewerPhone},Người xem lịch,Người xem,"Kỹ năng Điều dưỡng, Y cơ sở",Kỹ năng Điều dưỡng,Không`,
        ].join("\n"),
        "utf8",
      ),
    });
    await page.getByRole("button", { name: "Import mới", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/personnel\?notice=/);

    await expect
      .poll(async () => {
        const { data: viewerProfile } = await serviceDb
          .from("profiles")
          .select("id")
          .eq("email", personnelViewerEmail)
          .maybeSingle();
        personnelViewerId = viewerProfile?.id;
        return Boolean(personnelViewerId);
      })
      .toBe(true);

    const viewerCard = page
      .locator(".personnel-table tbody tr")
      .filter({ hasText: personnelViewerEmail });
    await expect(viewerCard.locator(".role-chip.selected")).toHaveText(
      "Người xem",
    );
    const { data: viewerScopes, error: viewerScopesError } = await serviceDb
      .from("profile_room_types")
      .select("room_type_id,receive_schedule_emails")
      .eq("profile_id", personnelViewerId!);
    if (viewerScopesError) throw viewerScopesError;
    expect(viewerScopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          room_type_id: "40000000-0000-0000-0000-000000000001",
          receive_schedule_emails: true,
        }),
        expect.objectContaining({
          room_type_id: "40000000-0000-0000-0000-000000000002",
          receive_schedule_emails: false,
        }),
      ]),
    );
  } finally {
    if (!personnelId) {
      const { data: profile } = await serviceDb
        .from("profiles")
        .select("id")
        .eq("email", personnelEmail)
        .maybeSingle();
      personnelId = profile?.id;
    }
    if (personnelId) {
      await serviceDb.auth.admin.deleteUser(personnelId);
    }
    if (!personnelViewerId) {
      const { data: viewerProfile } = await serviceDb
        .from("profiles")
        .select("id")
        .eq("email", personnelViewerEmail)
        .maybeSingle();
      personnelViewerId = viewerProfile?.id;
    }
    if (personnelViewerId) {
      await serviceDb.auth.admin.deleteUser(personnelViewerId);
    }
    const originalIds = (originalProfiles ?? []).map(({ id }) => id);
    if (originalIds.length) {
      await serviceDb.from("user_roles").delete().in("user_id", originalIds);
      await serviceDb
        .from("profile_room_types")
        .delete()
        .in("profile_id", originalIds);
      if (originalRoles?.length) {
        await serviceDb.from("user_roles").insert(originalRoles);
      }
      if (originalScopes?.length) {
        await serviceDb.from("profile_room_types").insert(originalScopes);
      }
      await Promise.all(
        (originalProfiles ?? []).map(({ id, is_active }) =>
          serviceDb.from("profiles").update({ is_active }).eq("id", id),
        ),
      );
    }
    await serviceDb.from("courses").delete().eq("course_code", courseCode);
    await serviceDb
      .from("rooms")
      .delete()
      .eq("room_code", roomCode)
      .eq("building_code", "QA");
  }
});
