import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  createEquipmentHandoverPdf,
  type EquipmentHandoverRequest,
} from "../../lib/equipment-handover-pdf";
import { formatEquipmentRequestCode } from "../../lib/equipment-request-code";
import { equipmentHandoverSelect } from "../../lib/equipment-requests";
import {
  cleanupLegacyRequest,
  legacyItemFixture,
} from "../helpers/legacy-equipment-fixture.mjs";
import {
  assertLocalDestructiveTestTarget,
  resolveEffectiveSupabaseTestConfig,
} from "../helpers/local-test-safety.mjs";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
}

async function requestFromNewContext(context: BrowserContext, path: string) {
  const page = await context.newPage();
  return page.request.get(path);
}

test("equipment handover PDF separates missing, authorization, and query failures", async ({
  browser,
  page,
}) => {
  const envText = await readFile(
    new URL("../../.env.local", import.meta.url),
    "utf8",
  );
  const env = Object.fromEntries(
    envText
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const [key, ...value] = line.split("=");
        return [key, value.join("=")];
      }),
  );
  const supabaseConfig = resolveEffectiveSupabaseTestConfig(process.env, env);
  assertLocalDestructiveTestTarget({
    supabaseUrl: supabaseConfig.supabaseUrl,
    playwrightBaseUrl: process.env.PLAYWRIGHT_BASE_URL,
  });

  const databaseClient = createClient(
    supabaseConfig.supabaseUrl,
    supabaseConfig.secretKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const authClient = createClient(
    supabaseConfig.supabaseUrl,
    supabaseConfig.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: signedIn, error: signInError } =
    await authClient.auth.signInWithPassword({
      email: "admin@campus.local",
      password: "LocalAdmin123!",
    });
  expect(signInError).toBeNull();
  const adminId = signedIn.user?.id;
  expect(adminId).toBeTruthy();

  const [{ data: lecturer }, { data: course }] = await Promise.all([
    databaseClient
      .from("profiles")
      .select("id")
      .eq("email", "giangvien@campus.local")
      .single(),
    databaseClient
      .from("courses")
      .select("id,room_type_id")
      .eq("is_active", true)
      .limit(1)
      .single(),
  ]);
  expect(lecturer).toBeTruthy();
  expect(course).toBeTruthy();
  if (!lecturer || !course || !adminId) {
    throw new Error("Missing local PDF regression seed data");
  }
  const { data: room } = await databaseClient
    .from("rooms")
    .select("id")
    .eq("room_type_id", course.room_type_id)
    .eq("is_active", true)
    .limit(1)
    .single();
  expect(room).toBeTruthy();
  if (!room) throw new Error("Missing local PDF regression room");

  const requestId = crypto.randomUUID();
  const scheduleId = crypto.randomUUID();
  const catalogId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const handoverSignature =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const returnSignature =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

  try {
    expect(
      (
        await databaseClient.from("class_schedules").insert({
          id: scheduleId,
          course_id: course.id,
          course_code_snapshot: "PDF 101",
          course_name_snapshot: "Kiểm thử phiếu giao nhận",
          room_id: room.id,
          schedule_date: "2048-08-20",
          start_time: "07:30",
          end_time: "09:30",
          source: "manual",
          schedule_status: "published",
          student_count: 20,
          semester: "HK1",
          created_by: adminId,
          published_by: adminId,
          published_at: new Date().toISOString(),
          lecturer_id: lecturer.id,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await databaseClient.from("equipment_catalog").insert({
          id: catalogId,
          item_name: "Thiết bị PDF regression",
          commercial_name: "PDF regression",
          unit: "Cái",
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await databaseClient.from("equipment_requests").insert({
          id: requestId,
          class_schedule_id: scheduleId,
          semester: "HK1",
          registrant_id: adminId,
          responsible_lecturer_id: lecturer.id,
          phone_snapshot: "0901000001",
          email_snapshot: "admin@campus.local",
          receive_at: "2048-08-19T09:00:00+07:00",
          return_at: "2048-08-20T16:00:00+07:00",
          note: "Completed PDF regression",
          status: "completed",
          created_by: adminId,
          created_at: "2048-08-12T12:34:56+07:00",
          handover_staff_confirmed_by: adminId,
          handover_staff_confirmed_at: "2048-08-19T09:00:00+07:00",
          handover_signature_path: handoverSignature,
          handover_recipient_signed_at: "2048-08-19T09:05:00+07:00",
          handover_effective_at: "2048-08-19T09:05:00+07:00",
          return_staff_confirmed_by: adminId,
          return_staff_confirmed_at: "2048-08-20T16:00:00+07:00",
          return_signature_path: returnSignature,
          return_recipient_signed_at: "2048-08-20T16:05:00+07:00",
          return_effective_at: "2048-08-20T16:05:00+07:00",
        })
      ).error,
    ).toBeNull();
    await legacyItemFixture(
      {
        id: itemId,
        request_id: requestId,
        skill_name: "Kỹ năng PDF regression",
        catalog_item_id: catalogId,
        quantity: 2,
      },
      { staged: true },
    );

    await login(page, "admin@campus.local", "LocalAdmin123!");

    const { data: selectedRequest, error: selectedRequestError } =
      await authClient
        .from("equipment_requests")
        .select(equipmentHandoverSelect)
        .eq("id", requestId)
        .maybeSingle();
    expect(selectedRequestError).toBeNull();
    expect(selectedRequest).toBeTruthy();
    if (!selectedRequest) throw new Error("Missing selected PDF request");
    expect(selectedRequest).toMatchObject({
      status: "completed",
      handover_recipient_signature: handoverSignature,
      return_recipient_signature: returnSignature,
      handover_staff_confirmed_at: "2048-08-19T02:00:00+00:00",
      handover_recipient_signed_at: "2048-08-19T02:05:00+00:00",
      handover_effective_at: "2048-08-19T02:05:00+00:00",
      return_staff_confirmed_at: "2048-08-20T09:00:00+00:00",
      return_recipient_signed_at: "2048-08-20T09:05:00+00:00",
      return_effective_at: "2048-08-20T09:05:00+00:00",
      email_snapshot: "admin@campus.local",
      phone_snapshot: "0901000001",
      class_schedules: {
        course_code_snapshot: "PDF 101",
        course_name_snapshot: "Kiểm thử phiếu giao nhận",
        student_count: 20,
      },
      equipment_request_items: [
        {
          skill_name: "Kỹ năng PDF regression",
          quantity: 2,
          equipment_catalog: {
            item_name: "Thiết bị PDF regression",
            commercial_name: "PDF regression",
            unit: "Cái",
          },
        },
      ],
    });
    expect("handover_signature_path" in selectedRequest).toBe(false);
    expect("return_signature_path" in selectedRequest).toBe(false);
    const handoverRequest =
      selectedRequest as unknown as EquipmentHandoverRequest;
    expect(handoverRequest.handover_staff?.full_name).toBeTruthy();
    expect(handoverRequest.return_staff?.full_name).toBe(
      handoverRequest.handover_staff?.full_name,
    );

    const { data: currentColumns, error: currentColumnsError } =
      await databaseClient
        .from("equipment_requests")
        .select("handover_signature_path,return_signature_path")
        .eq("id", requestId)
        .single();
    expect(currentColumnsError).toBeNull();
    expect(currentColumns).toEqual({
      handover_signature_path: handoverSignature,
      return_signature_path: returnSignature,
    });

    const directPdf = await createEquipmentHandoverPdf(handoverRequest);
    expect(directPdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const directPdfObjects = directPdf.toString("latin1");
    expect(
      directPdfObjects.match(/\/Subtype\s*\/Image\b/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);

    const basicMedicalPdf = await createEquipmentHandoverPdf({
      ...handoverRequest,
      request_domain: "basic_medical",
      equipment_request_items: [
        {
          ...handoverRequest.equipment_request_items[0],
          skill_name: "Bài TN-TH PDF Y cơ sở",
          equipment_catalog: null,
          basic_medical_equipment_catalog: {
            id: catalogId,
            item_name: "Thiết bị PDF Y cơ sở",
            commercial_name: "PDF Y cơ sở",
            item_type: "Thiết bị",
            country_of_origin: "Việt Nam",
            manufacturer: "MedLabs",
            model: "BM-PDF",
            unit: "Bộ",
          },
        },
      ],
    });
    expect(basicMedicalPdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(basicMedicalPdf.byteLength).toBeGreaterThan(1_000);

    const completed = await page.request.get(
      `/api/equipment-requests/${requestId}/handover`,
    );
    expect(completed.status()).toBe(200);
    expect(completed.headers()["content-type"]).toContain("application/pdf");
    expect(completed.headers()["content-disposition"]).toContain(
      "phieu-giao-nhan-",
    );
    expect(completed.headers()["content-disposition"]).toContain(
      formatEquipmentRequestCode(selectedRequest.created_at),
    );
    const completedBody = await completed.body();
    expect(completedBody.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(completedBody.byteLength).toBeGreaterThan(1_000);
    const completedPdfObjects = completedBody.toString("latin1");
    expect(
      completedPdfObjects.match(/\/Subtype\s*\/Image\b/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);

    const missing = await page.request.get(
      "/api/equipment-requests/ffffffff-ffff-4fff-8fff-ffffffffffff/handover",
    );
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toEqual({
      error: "Không tìm thấy phiếu thiết bị.",
    });

    const queryFailure = await page.request.get(
      "/api/equipment-requests/not-a-uuid/handover",
    );
    // The route now rejects a malformed id before it queries.
    expect(queryFailure.status()).toBe(400);
    expect(await queryFailure.json()).toEqual({
      error: "Mã phiếu không hợp lệ.",
    });

    const lecturerContext = await browser.newContext();
    try {
      const lecturerPage = await lecturerContext.newPage();
      await login(lecturerPage, "giangvien@campus.local", "LocalLecturer123!");
      const forbidden = await lecturerPage.request.get(
        `/api/equipment-requests/${requestId}/handover`,
      );
      expect(forbidden.status()).toBe(403);
    } finally {
      await lecturerContext.close();
    }

    const anonymousContext = await browser.newContext();
    try {
      const anonymous = await requestFromNewContext(
        anonymousContext,
        `/api/equipment-requests/${requestId}/handover`,
      );
      expect(anonymous.status()).toBe(401);
    } finally {
      await anonymousContext.close();
    }
  } finally {
    await cleanupLegacyRequest(requestId);
    await databaseClient.from("class_schedules").delete().eq("id", scheduleId);
    await databaseClient.from("equipment_catalog").delete().eq("id", catalogId);
  }
});
