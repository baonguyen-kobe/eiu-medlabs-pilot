import nextEnv from "@next/env";
import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "@e965/xlsx";

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

type Fixture = {
  scheduleId: string;
  courseCode: string;
  scheduleDate: string;
  startTime: string;
  room: string;
  adminId: string;
  adminName: string;
  adminEmail: string;
  adminPhone: string;
  lecturerName: string;
  lecturerEmail: string;
  catalogIds: string[];
  requestId?: string;
};

let fixture: Fixture;

test.beforeAll(async () => {
  const { error: signInError } = await adminDb.auth.signInWithPassword({
    email: "admin@campus.local",
    password: "LocalAdmin123!",
  });
  if (signInError) throw signInError;

  const { data: admin, error: adminError } = await serviceDb
    .from("profiles")
    .select("id,full_name,email,phone")
    .eq("is_active", true)
    .eq("email", "admin@campus.local")
    .limit(1)
    .single();
  if (adminError || !admin) throw adminError ?? new Error("Missing admin");
  // The seeded admin is the Root account, which may not teach a class.
  const { data: lecturer } = await serviceDb
    .from("profiles")
    .select("id,full_name,email")
    .eq("email", "giangvien@campus.local")
    .single();
  if (!lecturer) throw new Error("Missing lecturer");

  // Own schedule: the import needs a semester on the class, and seeded demo
  // schedules have none.
  const skillsRoomType = "40000000-0000-0000-0000-000000000001";
  const [{ data: course }, { data: room }] = await Promise.all([
    serviceDb
      .from("courses")
      .select("id")
      .eq("is_active", true)
      .eq("room_type_id", skillsRoomType)
      .limit(1)
      .single(),
    serviceDb
      .from("rooms")
      .select("id,room_code,building_code")
      .eq("is_active", true)
      .eq("room_type_id", skillsRoomType)
      .limit(1)
      .single(),
  ]);
  if (!course || !room) throw new Error("Missing course or room fixture");
  const { data: schedule, error: scheduleError } = await adminDb.rpc(
    "create_manual_class_schedule",
    {
      target_course_id: course.id,
      target_room_id: room.id,
      target_lecturer_id: lecturer.id,
      target_lecturer_2_id: null,
      target_schedule_date: `2047-03-${String(1 + (Date.now() % 28)).padStart(2, "0")}`,
      target_start_time: "13:00",
      target_end_time: "16:30",
      target_note: "E2E equipment import",
      target_student_count: 20,
      target_semester: "HK1",
    },
  );
  if (scheduleError || !schedule) {
    throw scheduleError ?? new Error("Cannot create schedule fixture");
  }

  const marker = `E2E-${Date.now()}`;
  const { data: catalog, error: catalogError } = await adminDb
    .from("equipment_catalog")
    .insert([
      {
        item_name: `Máy đo thử ${marker}`,
        commercial_name: `Thương mại A ${marker}`,
        model: `MODEL-A-${marker}`,
        unit: "Cái",
      },
      {
        item_name: `Ống nghe thử ${marker}`,
        commercial_name: `Thương mại B ${marker}`,
        model: `MODEL-B-${marker}`,
        unit: "Cái",
      },
    ])
    .select("id,item_name,commercial_name,model");
  if (catalogError || !catalog || catalog.length !== 2) {
    throw catalogError ?? new Error("Cannot seed catalog");
  }
  fixture = {
    scheduleId: schedule.id,
    courseCode: schedule.course_code_snapshot,
    scheduleDate: schedule.schedule_date,
    startTime: schedule.start_time.slice(0, 5),
    room: `${room.room_code}.${room.building_code}`,
    adminId: admin.id,
    adminName: admin.full_name,
    adminEmail: admin.email,
    adminPhone: admin.phone,
    lecturerName: lecturer.full_name,
    lecturerEmail: lecturer.email,
    catalogIds: catalog.map(({ id }) => id),
  };
});

test.afterAll(async () => {
  if (!fixture) return;
  if (fixture.requestId) {
    await adminDb
      .from("equipment_requests")
      .delete()
      .eq("id", fixture.requestId);
  } else {
    await adminDb
      .from("equipment_requests")
      .delete()
      .eq("class_schedule_id", fixture.scheduleId);
  }
  await adminDb.from("equipment_catalog").delete().in("id", fixture.catalogIds);
  await serviceDb.from("class_schedules").delete().eq("id", fixture.scheduleId);
});

// Parked: the import page is hidden (owner decision, 2026-11-17). Since the S4
// line guard, the database rejects lines for a request that is not "new"
// (S4_USE_QUANTITY_ADJUSTMENT), and the inventory pilot lists privileged_import
// as a forbidden writer, so importing a finished request cannot succeed.
test.fixme("admin imports one historical equipment request with two items", async ({
  page,
}) => {
  const templateResponse = await page.request.get(
    "/api/equipment-import-template/xlsx",
  );
  expect(templateResponse.ok()).toBeTruthy();
  const templateWorkbook = XLSX.read(await templateResponse.body(), {
    type: "buffer",
  });
  expect(templateWorkbook.SheetNames).toEqual(["Dữ liệu import", "Hướng dẫn"]);
  const templateHeaders = XLSX.utils.sheet_to_json<string[]>(
    templateWorkbook.Sheets["Dữ liệu import"],
    { header: 1 },
  )[0];
  expect(templateHeaders).toContain("Mã phiếu nguồn");
  expect(templateHeaders).toContain("Học kỳ");
  expect(templateHeaders).toContain("Tên thiết bị và vật tư");

  const { data: catalog } = await serviceDb
    .from("equipment_catalog")
    .select("item_name,commercial_name,model")
    .in("id", fixture.catalogIds)
    .order("item_name");
  const [year, month, day] = fixture.scheduleDate.split("-");
  const displayDate = `${day}/${month}/${year}`;
  const requestCode = `${year.slice(-2)}${month}${day}101010`;
  const common = {
    "Mã phiếu nguồn": requestCode,
    "Người đăng ký": fixture.adminName,
    "Email người đăng ký": fixture.adminEmail,
    "Số điện thoại": fixture.adminPhone,
    "Giảng viên phụ trách": fixture.lecturerName,
    "Email giảng viên phụ trách": fixture.lecturerEmail,
    "Mã môn học": fixture.courseCode,
    "Học kỳ": "HK1",
    "Ngày học": displayDate,
    "Giờ bắt đầu học": fixture.startTime,
    "Phòng/Lab": fixture.room,
    "Ngày nhận": displayDate,
    "Giờ nhận": "09:00",
    "Ngày trả": displayDate,
    "Giờ trả": "11:00",
    "Trạng thái": "Hoàn Thành",
    "Ghi chú chung": "Phiếu kiểm thử sẽ được xóa sau khi hoàn tất",
    "Kỹ năng/Bài thực hành": "Kỹ năng kiểm thử import",
  };
  const rows = catalog!.map((item, index) => ({
    ...common,
    "Tên thiết bị và vật tư": item.item_name,
    "Tên thương mại": item.commercial_name,
    Model: item.model,
    "Số lượng": index + 1,
    "Ghi chú thiết bị": `Thiết bị thử ${index + 1}`,
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(rows),
    "Dữ liệu import",
  );

  await page.goto("/login");
  await page.locator('input[name="email"]').fill("admin@campus.local");
  await page.locator('input[name="password"]').fill("LocalAdmin123!");
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/equipment/import");
  await expect(
    page.getByRole("heading", { name: "Import Phiếu thiết bị" }),
  ).toBeVisible();
  await page.locator("#equipment-import-file").setInputFiles({
    name: "phieu-thiet-bi-cu.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  });
  await expect(page.locator(".preview-table tbody tr")).toHaveCount(2);

  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  await expect(page.locator(".stepper li").nth(2)).toHaveClass(/active/);
  await expect(page.locator(".preview-status-error")).toHaveCount(0);
  await expect(page.locator(".preview-status-duplicate")).toHaveCount(0);

  await page.getByRole("button", { name: /Tiếp tục/ }).click();
  await expect(page.locator(".stepper li").nth(3)).toHaveClass(/active/);
  await page.getByRole("button", { name: /Tạo phiếu/ }).click();
  await expect(
    page.getByRole("heading", { name: "Import đã hoàn tất" }),
  ).toBeVisible();
  await expect(page.locator(".import-result")).toContainText("Đã tạo 1 phiếu");

  const { data: request, error: requestError } = await serviceDb
    .from("equipment_requests")
    .select(
      "id,semester,status,created_at,equipment_request_items(id,quantity)",
    )
    .eq("class_schedule_id", fixture.scheduleId)
    .single();
  if (requestError || !request)
    throw requestError ?? new Error("Missing request");
  fixture.requestId = request.id;
  expect(request.semester).toBe("HK1");
  expect(request.status).toBe("completed");
  expect(request.equipment_request_items).toHaveLength(2);
});
