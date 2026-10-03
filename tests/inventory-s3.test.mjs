import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  assertLocalSupabaseTarget,
  resolveEffectiveSupabaseTestConfig,
} from "./helpers/local-test-safety.mjs";

let fileEnv = {};
try {
  fileEnv = Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const [key, ...value] = line.split("=");
        return [key, value.join("=")];
      }),
  );
} catch {
  fileEnv = {};
}

const localEnv = resolveEffectiveSupabaseTestConfig(process.env, fileEnv);

function getServiceClient() {
  assertLocalSupabaseTarget(localEnv.supabaseUrl);
  return createClient(localEnv.supabaseUrl, localEnv.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function getAnonClient() {
  assertLocalSupabaseTarget(localEnv.supabaseUrl);
  return createClient(localEnv.supabaseUrl, localEnv.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createTestUser(service, role, isActive = true) {
  const email = `s3-${role}-${crypto.randomUUID()}@campus.local`;
  const password = "LocalS3TestPassword123!";
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { preapproved: true },
    user_metadata: { full_name: `S3 Test ${role}` },
  });
  assert.ifError(error);
  const userId = data.user.id;

  await service.from("profiles").upsert({
    id: userId,
    email,
    full_name: `S3 Test ${role}`,
    is_active: isActive,
  });

  await service.from("user_roles").insert({
    user_id: userId,
    role,
  });

  const userClient = createClient(
    localEnv.supabaseUrl,
    localEnv.publishableKey,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const { error: authError } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  assert.ifError(authError);

  return { userId, email, password, client: userClient };
}

async function setupMasterFixtures(admin, staff, ns) {
  // 1. Create discrete UOM (count)
  const uomDiscreteCode = `uom_s3_cnt_${ns}`;
  const { error: uomErr } = await admin.client.rpc("inventory_command", {
    p_operation: "create_inventory_uom",
    p_payload: {
      code: uomDiscreteCode,
      name: `Count S3 ${ns}`,
      dimension: "count",
      allowed_scale: 0,
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(uomErr);

  // 2. Create Category
  const catCode = `CAT_S3_${ns.toUpperCase()}`;
  const { data: catRes, error: catErr } = await admin.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_category",
      p_payload: {
        code: catCode,
        name: `Category S3 ${ns}`,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(catErr);
  const categoryId = catRes.id;

  // 3. Create Supplier
  const { data: suppRes, error: suppErr } = await admin.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_supplier",
      p_payload: {
        name: `Supplier S3 ${ns}`,
        tax_code: `TAX-S3-${ns}`,
        contact: "supplier-s3@campus.local",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(suppErr);
  const supplierId = suppRes.id;

  // 4. Create Storage Locations (A & B)
  const locACode = `LOC_S3_A_${ns.toUpperCase()}`;
  const { data: locARes, error: locAErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_location",
      p_payload: {
        code: locACode,
        name: `Location S3 A ${ns}`,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(locAErr);
  const locationAId = locARes.id;

  const locBCode = `LOC_S3_B_${ns.toUpperCase()}`;
  const { data: locBRes, error: locBErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_location",
      p_payload: {
        code: locBCode,
        name: `Location S3 B ${ns}`,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(locBErr);
  const locationBId = locBRes.id;

  // 5. Create Serialized Catalog Item 1 (No Expiry Required)
  const item1Code = `ITEM_SER1_${ns.toUpperCase()}`;
  const { data: item1Res, error: item1Err } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_item",
      p_payload: {
        code: item1Code,
        name: `Serialized ECG Device ${ns}`,
        category_id: categoryId,
        material_kind: "other",
        base_uom_code: uomDiscreteCode,
        tracking_strategy: "serialized",
        return_semantics: "returnable",
        expiry_required: false,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(item1Err);
  const item1Id = item1Res.id;

  // 6. Create Serialized Catalog Item 2 (Expiry Required)
  const item2Code = `ITEM_SER2_EXP_${ns.toUpperCase()}`;
  const { data: item2Res, error: item2Err } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_item",
      p_payload: {
        code: item2Code,
        name: `Calibrated Dialyzer Cartridge ${ns}`,
        category_id: categoryId,
        material_kind: "other",
        base_uom_code: uomDiscreteCode,
        tracking_strategy: "serialized",
        return_semantics: "returnable",
        expiry_required: true,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(item2Err);
  const item2Id = item2Res.id;

  // 7. Create Serialized Catalog Item 3 (Alternative SKU for qualified serial test)
  const item3Code = `ITEM_SER3_SKU_${ns.toUpperCase()}`;
  const { data: item3Res, error: item3Err } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_item",
      p_payload: {
        code: item3Code,
        name: `Hospital Bed Model X ${ns}`,
        category_id: categoryId,
        material_kind: "other",
        base_uom_code: uomDiscreteCode,
        tracking_strategy: "serialized",
        return_semantics: "returnable",
        expiry_required: false,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(item3Err);
  const item3Id = item3Res.id;

  // 8. Create Acquisition Source & Line for Item 1
  const sourceRef = `PO_S3_${ns.toUpperCase()}`;
  const { data: sourceRes, error: sourceErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source",
      p_payload: {
        source_reference: sourceRef,
        supplier_id: supplierId,
        reference_date: "2026-10-01",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(sourceErr);
  const sourceId = sourceRes.id;

  const { data: sLine1Res, error: sLine1Err } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source_line",
      p_payload: {
        acquisition_record_id: sourceId,
        line_key: "L1",
        catalog_item_id: item1Id,
        expected_purchase_quantity: "10.000000",
        purchase_uom_code: uomDiscreteCode,
        expected_conversion_factor: "1.000000",
        expected_revision: 1,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(sLine1Err);
  const sourceLine1Id = sLine1Res.id;

  const { data: sLine2Res, error: sLine2Err } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source_line",
      p_payload: {
        acquisition_record_id: sourceId,
        line_key: "L2",
        catalog_item_id: item2Id,
        expected_purchase_quantity: "10.000000",
        purchase_uom_code: uomDiscreteCode,
        expected_conversion_factor: "1.000000",
        expected_revision: sLine1Res.source_revision,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(sLine2Err);
  const sourceLine2Id = sLine2Res.id;

  return {
    uomDiscrete: uomDiscreteCode,
    categoryId,
    supplierId,
    locationAId,
    locationBId,
    item1Id,
    item1Code,
    item2Id,
    item2Code,
    item3Id,
    item3Code,
    sourceId,
    sourceLine1Id,
    sourceLine2Id,
  };
}

// ============================================================================
// TEST 1: Admin Opening & Generated Stable Asset Code
// ============================================================================
test("S3 Inventory: Admin opening, stable code generation, & shared header", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fx = await setupMasterFixtures(admin, staff, ns);

  const retryKey = crypto.randomUUID();
  const openPayload = {
    catalog_item_id: fx.item1Id,
    location_id: fx.locationAId,
    intake_reference: `OPEN-MANIFEST-${ns}`,
    row_key: "ROW-001",
    manufacturer: "Philips",
    model: "PageWriter TC50",
    manufacturer_serial: `SN-OPEN-${ns}-01`,
    reason: "Initial baseline asset opening",
    evidence_note: "Physical tag audit form signed by lab director",
  };

  const { data: openRes, error: openErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "open_asset",
      p_payload: openPayload,
      p_retry_key: retryKey,
    },
  );
  assert.ifError(openErr);
  assert.ok(openRes.id, "Asset ID must be returned");
  assert.ok(openRes.asset_code, "Asset code must be returned");
  assert.equal(openRes.revision, 1, "Initial revision must be 1");
  assert.ok(openRes.event_id, "Event ID must be returned");
  assert.ok(openRes.transaction_id, "Transaction ID must be returned");

  // Format check: EIU-AST-XXXXXXXX (8 uppercase hexadecimal characters)
  assert.match(
    openRes.asset_code,
    /^EIU-AST-[0-9A-F]{8}$/,
    "Asset code must match EIU-AST-XXXXXXXX regex",
  );

  // Read detail via equipment_asset_read
  const { data: detailRes, error: detailErr } = await admin.client.rpc(
    "equipment_asset_read",
    {
      p_resource: "detail",
      p_filters: { id: openRes.id },
    },
  );
  assert.ifError(detailErr);
  assert.equal(detailRes.total, 1);
  const asset = detailRes.rows[0];
  assert.equal(asset.asset_code, openRes.asset_code);
  assert.equal(asset.intake_kind, "open");
  assert.equal(asset.intake_reference, `OPEN-MANIFEST-${ns}`);
  assert.equal(asset.row_key, "ROW-001");
  assert.equal(asset.manufacturer, "Philips");
  assert.equal(asset.model, "PageWriter TC50");
  assert.equal(asset.manufacturer_serial, `SN-OPEN-${ns}-01`);
  assert.equal(asset.location_id, fx.locationAId);
  assert.equal(asset.lifecycle_status, "registered");
  assert.equal(asset.operational_status, "ready");
  assert.equal(asset.revision, 1);
  assert.equal(asset.eligible, false, "Registered asset is not yet in_service");
  assert.ok(
    asset.ineligibility_reasons.some((r) => r.includes("requires in_service")),
    "Ineligibility reasons must indicate lifecycle not in_service",
  );

  // Shared transaction header check via public RPC inventory_read('transaction_detail')
  const { data: txDetail, error: txErr } = await admin.client.rpc(
    "inventory_read",
    {
      p_resource: "transaction_detail",
      p_filters: { id: openRes.transaction_id },
    },
  );
  assert.ifError(txErr);
  assert.equal(txDetail.rows.length, 1);
  const txHeader = txDetail.rows[0].transaction;
  assert.equal(txHeader.operation, "ASSET_OPEN");
  assert.equal(txHeader.actor_id, admin.userId);
  assert.equal(txHeader.reason, "Initial baseline asset opening");
  assert.equal(
    txDetail.rows[0].lines.length,
    0,
    "Transaction header has zero quantity lines",
  );
  assert.equal(
    txDetail.rows[0].facts.length,
    0,
    "Transaction header has zero quantity facts",
  );

  // Event check via public RPC equipment_asset_read('history')
  const { data: evHist, error: evErr } = await admin.client.rpc(
    "equipment_asset_read",
    {
      p_resource: "history",
      p_filters: { id: openRes.id },
    },
  );
  assert.ifError(evErr);
  assert.equal(evHist.total, 1);
  const evRow = evHist.rows[0];
  assert.equal(evRow.asset_id, openRes.id);
  assert.equal(evRow.revision, 1);
  assert.equal(evRow.operation, "open_asset");
  assert.equal(evRow.actor_id, admin.userId);
  assert.equal(evRow.transaction_id, openRes.transaction_id);
  assert.equal(
    evRow.before_state,
    null,
    "Revision 1 before_state must be null",
  );
  assert.equal(evRow.after_state.asset_code, openRes.asset_code);
});

// ============================================================================
// TEST 2: Staff Receipt with Source Line & Zero Quantity Balance Effects
// ============================================================================
test("S3 Inventory: Staff receipt with source line & zero quantity balance effects", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fx = await setupMasterFixtures(admin, staff, ns);

  // Check quantity balance BEFORE receipt via public RPC inventory_read('balances')
  const { data: balBefore, error: balBeforeErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "balances",
      p_filters: { item_id: fx.item1Id },
    },
  );
  assert.ifError(balBeforeErr);
  assert.equal(
    balBefore.rows.length,
    0,
    "No stock balances before asset receipt",
  );

  const retryKey = crypto.randomUUID();
  const receivePayload = {
    catalog_item_id: fx.item1Id,
    source_line_id: fx.sourceLine1Id,
    location_id: fx.locationAId,
    intake_reference: `PO-REC-${ns}`,
    row_key: "LN1-UNIT-01",
    manufacturer: "GE Healthcare",
    model: "MAC 2000",
    manufacturer_serial: `GE-SN-${ns}-01`,
    reason: "New delivery received from supplier",
    evidence_note: "Waybill #WB-2026-999 signed by receiving staff",
  };

  const { data: recRes, error: recErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "receive_asset",
      p_payload: receivePayload,
      p_retry_key: retryKey,
    },
  );
  assert.ifError(recErr);
  assert.ok(recRes.id);
  assert.ok(recRes.asset_code);
  assert.equal(recRes.revision, 1);
  assert.ok(recRes.transaction_id);

  // Check quantity balance AFTER receipt: STILL EXACTLY 0!
  const { data: balAfter, error: balAfterErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "balances",
      p_filters: { item_id: fx.item1Id },
    },
  );
  assert.ifError(balAfterErr);
  assert.equal(
    balAfter.rows.length,
    0,
    "Stock balances must remain 0 after asset receipt (no quantity balance effect)",
  );

  // Zero quantity lines in transaction via inventory_read('transaction_detail')
  const { data: txDetail, error: txDetailErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "transaction_detail",
      p_filters: { id: recRes.transaction_id },
    },
  );
  assert.ifError(txDetailErr);
  assert.equal(
    txDetail.rows[0].lines.length,
    0,
    "Transaction must have zero quantity lines",
  );
  assert.equal(
    txDetail.rows[0].facts.length,
    0,
    "Transaction must have zero quantity facts",
  );

  // Verify detail
  const { data: detailRes } = await staff.client.rpc("equipment_asset_read", {
    p_resource: "detail",
    p_filters: { id: recRes.id },
  });
  const asset = detailRes.rows[0];
  assert.equal(asset.intake_kind, "receive");
  assert.equal(asset.source_line_id, fx.sourceLine1Id);
  assert.equal(asset.lifecycle_status, "registered");
  assert.equal(asset.operational_status, "ready");
});

// ============================================================================
// TEST 3: Canonical Serial Qualification Across SKU, Nullable Serials, & Collisions Allowed
// ============================================================================
test("S3 Inventory: Qualified serial uniqueness across SKUs, nullable serials, & collisions allowed", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fx = await setupMasterFixtures(admin, staff, ns);

  const sharedSerial = `SN-SHARED-${ns}-999`;

  // 1. Asset 1 on Item 1 (SKU 1): Stryker / Bed S3 / sharedSerial
  const { data: ast1Res, error: ast1Err } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "open_asset",
      p_payload: {
        catalog_item_id: fx.item1Id,
        location_id: fx.locationAId,
        intake_reference: `OPEN-SER-A-${ns}`,
        row_key: "R1",
        manufacturer: "Stryker",
        model: "Bed S3",
        manufacturer_serial: sharedSerial,
        reason: "First asset with serial",
        evidence_note: "Tag inspection",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(ast1Err);
  assert.ok(ast1Res.id);

  // 2. Rule A: Same manufacturer + model + serial on DIFFERENT SKU (Item 3) is REJECTED
  // (Testing case-insensitivity and trim normalization as well)
  const { error: dupSerialErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "open_asset",
      p_payload: {
        catalog_item_id: fx.item3Id, // DIFFERENT SKU!
        location_id: fx.locationAId,
        intake_reference: `OPEN-SER-B-${ns}`,
        row_key: "R1",
        manufacturer: "  stryker  ",
        model: "BED S3",
        manufacturer_serial: sharedSerial.toLowerCase(),
        reason: "Duplicate serial attempt",
        evidence_note: "Inspection note",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(
    dupSerialErr,
    "Duplicate manufacturer+model+serial must be rejected across SKUs",
  );
  assert.match(dupSerialErr.message, /DUPLICATE_MANUFACTURER_SERIAL/);

  // 3. Rule B: Same serial with DIFFERENT manufacturer is ALLOWED
  const { data: diffMakerRes, error: diffMakerErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "open_asset",
      p_payload: {
        catalog_item_id: fx.item3Id,
        location_id: fx.locationAId,
        intake_reference: `OPEN-SER-C-${ns}`,
        row_key: "R1",
        manufacturer: "Hill-Rom", // Different manufacturer!
        model: "Bed S3",
        manufacturer_serial: sharedSerial, // Same serial!
        reason: "Different maker same serial",
        evidence_note: "Inspection note",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(
    diffMakerErr,
    "Same serial with different manufacturer must be allowed",
  );
  assert.ok(diffMakerRes.id);

  // 4. Rule B (cont): Same serial with DIFFERENT model is ALLOWED
  const { data: diffModelRes, error: diffModelErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "open_asset",
      p_payload: {
        catalog_item_id: fx.item1Id,
        location_id: fx.locationAId,
        intake_reference: `OPEN-SER-D-${ns}`,
        row_key: "R1",
        manufacturer: "Stryker",
        model: "Gurney X1", // Different model!
        manufacturer_serial: sharedSerial, // Same serial!
        reason: "Different model same serial",
        evidence_note: "Inspection note",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(
    diffModelErr,
    "Same serial with different model must be allowed",
  );
  assert.ok(diffModelRes.id);

  // 5. Rule C: Nullable serial: multiple assets with NULL/blank serial are ALLOWED
  const { data: nullSer1, error: nullSer1Err } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "open_asset",
      p_payload: {
        catalog_item_id: fx.item1Id,
        location_id: fx.locationAId,
        intake_reference: `OPEN-NULL-A-${ns}`,
        row_key: "R1",
        manufacturer: "Generic",
        model: "Mobile Stand",
        manufacturer_serial: null,
        reason: "No serial asset 1",
        evidence_note: "Batch sticker",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(nullSer1Err);
  assert.ok(nullSer1.id);

  const { data: nullSer2, error: nullSer2Err } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "open_asset",
      p_payload: {
        catalog_item_id: fx.item1Id,
        location_id: fx.locationAId,
        intake_reference: `OPEN-NULL-B-${ns}`,
        row_key: "R1",
        manufacturer: "Generic",
        model: "Mobile Stand",
        manufacturer_serial: null, // Same maker/model, both null serial
        reason: "No serial asset 2",
        evidence_note: "Batch sticker",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(
    nullSer2Err,
    "Multiple assets with null serial must be allowed",
  );
  assert.ok(nullSer2.id);

  // 6. Rule D: Serial present without manufacturer or model is REJECTED
  const { error: noMakerErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "open_asset",
      p_payload: {
        catalog_item_id: fx.item1Id,
        location_id: fx.locationAId,
        intake_reference: `OPEN-NOMAKER-${ns}`,
        row_key: "R1",
        manufacturer_serial: "SERIAL-ALONE-12345",
        reason: "Serial without maker",
        evidence_note: "Note",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(noMakerErr, "Serial without manufacturer/model must be rejected");
  assert.match(noMakerErr.message, /INVALID_SERIAL_IDENTITY/);
});

// ============================================================================
// TEST 4: Idempotent Replay, Payload Mismatch, & Business Duplicate Row Key
// ============================================================================
test("S3 Inventory: Idempotent replay, payload mismatch, & business duplicate intake", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fx = await setupMasterFixtures(admin, staff, ns);

  const retryKey = crypto.randomUUID();
  const payload = {
    catalog_item_id: fx.item1Id,
    source_line_id: fx.sourceLine1Id,
    location_id: fx.locationAId,
    intake_reference: `PO-REPLAY-${ns}`,
    row_key: "ROW-DUP-01",
    manufacturer: "Mindray",
    model: "BeneView T1",
    manufacturer_serial: `MY-${ns}-100`,
    reason: "Initial receipt for replay test",
    evidence_note: "Delivery slip signed",
  };

  // 1. Initial submission succeeds
  const { data: res1, error: err1 } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "receive_asset",
      p_payload: payload,
      p_retry_key: retryKey,
    },
  );
  assert.ifError(err1);
  assert.ok(res1.id);
  assert.ok(res1.asset_code);

  // 2. Exact Replay with identical payload and retryKey returns cached result
  const { data: replayRes, error: replayErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "receive_asset",
      p_payload: payload,
      p_retry_key: retryKey,
    },
  );
  assert.ifError(replayErr);
  assert.equal(replayRes.id, res1.id, "Replay must return identical asset ID");
  assert.equal(
    replayRes.asset_code,
    res1.asset_code,
    "Replay must return identical code",
  );
  assert.equal(
    replayRes.revision,
    res1.revision,
    "Replay must return identical revision",
  );
  assert.equal(
    replayRes.event_id,
    res1.event_id,
    "Replay must return identical event ID",
  );
  assert.equal(
    replayRes.transaction_id,
    res1.transaction_id,
    "Replay must return identical tx ID",
  );

  // 3. Replay with altered payload must fail with RETRY_PAYLOAD_MISMATCH
  const alteredPayload = {
    ...payload,
    evidence_note: "Tampered note during replay",
  };
  const { error: mismatchErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "receive_asset",
      p_payload: alteredPayload,
      p_retry_key: retryKey, // SAME retry key!
    },
  );
  assert.ok(
    mismatchErr,
    "Altered payload with same retry key must be rejected",
  );
  assert.match(mismatchErr.message, /RETRY_PAYLOAD_MISMATCH/);

  // 4. Semantic duplicate intake: NEW retry key, but SAME (intake_kind, intake_reference, row_key)
  const newRetryKey = crypto.randomUUID();
  const { error: bizDupErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "receive_asset",
      p_payload: payload, // Same intake_reference & row_key
      p_retry_key: newRetryKey, // NEW retry key!
    },
  );
  assert.ok(bizDupErr, "Duplicate intake business identity must be rejected");
  assert.match(bizDupErr.message, /BUSINESS_DUPLICATE/);

  // 5. Security: NULL operation rejected before replay & privilege checks
  const { error: nullOpErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: null,
      p_payload: payload,
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(nullOpErr, "NULL operation must be rejected");
  assert.match(nullOpErr.message, /INVALID_OPERATION/);

  // 6. Security: Same retry UUID used by another actor is valid (isolated replay scope)
  const { data: crossActorRes, error: crossActorErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "open_asset",
      p_payload: {
        catalog_item_id: fx.item1Id,
        location_id: fx.locationAId,
        intake_reference: `OPEN-CROSS-ACTOR-${ns}`,
        row_key: "R-CROSS-1",
        reason: "Cross actor retry key isolation test",
        evidence_note: "Test note",
      },
      p_retry_key: retryKey, // SAME retry key used by staff earlier!
    },
  );
  assert.ifError(
    crossActorErr,
    "Same retry key used by different actor must be isolated and succeed",
  );
  assert.ok(crossActorRes.id);

  // 7. Security: S1/S2 same retry UUID does not poison S3 replay
  const sharedS1S3Key = crypto.randomUUID();
  const { error: s1Err } = await admin.client.rpc("inventory_command", {
    p_operation: "create_inventory_category",
    p_payload: {
      code: `CAT_S1_S3_${ns.toUpperCase()}`,
      name: `S1-S3 Key Category ${ns}`,
    },
    p_retry_key: sharedS1S3Key,
  });
  assert.ifError(s1Err);

  const { data: s3CrossDomainRes, error: s3CrossDomainErr } =
    await admin.client.rpc("equipment_asset_command", {
      p_operation: "open_asset",
      p_payload: {
        catalog_item_id: fx.item1Id,
        location_id: fx.locationAId,
        intake_reference: `OPEN-CROSS-DOMAIN-${ns}`,
        row_key: "R-CROSS-DOM-1",
        reason: "S1/S2 retry key cross domain test",
        evidence_note: "Test note",
      },
      p_retry_key: sharedS1S3Key, // SAME retry key used in S1 inventory_command!
    });
  assert.ifError(s3CrossDomainErr, "S1/S2 retry key must not poison S3 replay");
  assert.ok(s3CrossDomainRes.id);
});

// ============================================================================
// TEST 5: Full Lifecycle Transitions, Admin Retired Reactivation, & Disposed Denial
// ============================================================================
test("S3 Inventory: Lifecycle transitions, Admin retired reactivation, & disposed terminal denial", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fx = await setupMasterFixtures(admin, staff, ns);

  // Create asset via open_asset (registered, revision 1)
  const { data: ast } = await admin.client.rpc("equipment_asset_command", {
    p_operation: "open_asset",
    p_payload: {
      catalog_item_id: fx.item1Id,
      location_id: fx.locationAId,
      intake_reference: `OPEN-LC-${ns}`,
      row_key: "R1",
      manufacturer: "B. Braun",
      model: "Infusomat Space",
      manufacturer_serial: `BB-${ns}-001`,
      reason: "Asset for lifecycle testing",
      evidence_note: "Opening register line",
    },
    p_retry_key: crypto.randomUUID(),
  });
  const assetId = ast.id;
  assert.equal(ast.revision, 1);

  // 1. Commissioning: registered -> in_service (revision 1 -> 2)
  const { data: commRes, error: commErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "set_asset_lifecycle",
      p_payload: {
        id: assetId,
        expected_revision: 1,
        lifecycle_status: "in_service",
        reason: "Commissioning and safety inspection completed",
        evidence_note: "Electrical safety test report PASS #EST-2026-1",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(commErr);
  assert.equal(commRes.revision, 2);

  // Read detail: in_service + ready => eligible = true
  const { data: d1 } = await admin.client.rpc("equipment_asset_read", {
    p_resource: "detail",
    p_filters: { id: assetId },
  });
  assert.equal(d1.rows[0].lifecycle_status, "in_service");
  assert.equal(
    d1.rows[0].eligible,
    true,
    "Commissioned asset in ready state must be eligible",
  );

  // 2. Inactivate: in_service -> inactive (revision 2 -> 3)
  const { data: inactRes, error: inactErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "set_asset_lifecycle",
      p_payload: {
        id: assetId,
        expected_revision: 2,
        lifecycle_status: "inactive",
        reason: "Temporarily taken out of service for clinical audit",
        evidence_note: "Audit memo #ADM-11",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(inactErr);
  assert.equal(inactRes.revision, 3);

  // 3. Reactivate: inactive -> in_service (revision 3 -> 4)
  const { data: reactRes, error: reactErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "set_asset_lifecycle",
      p_payload: {
        id: assetId,
        expected_revision: 3,
        lifecycle_status: "in_service",
        reason: "Audit completed, returned to active pool",
        evidence_note: "Clinical sign-off #CSO-22",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(reactErr);
  assert.equal(reactRes.revision, 4);

  // 4. Retire: in_service -> retired (revision 4 -> 5)
  const { data: retRes, error: retErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "set_asset_lifecycle",
      p_payload: {
        id: assetId,
        expected_revision: 4,
        lifecycle_status: "retired",
        reason: "End of scheduled operating lifespan",
        evidence_note: "Asset board retirement decree #RET-55",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(retErr);
  assert.equal(retRes.revision, 5);

  // 5. Retired Reactivation by Admin (Owner clarification): retired -> in_service (revision 5 -> 6)
  const { data: retReactRes, error: retReactErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "set_asset_lifecycle",
      p_payload: {
        id: assetId,
        expected_revision: 5,
        lifecycle_status: "in_service",
        reason: "Refurbished with certified replacement motor and recalibrated",
        evidence_note: "OEM certification certificate #OEM-CERT-999",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(
    retReactErr,
    "Admin must be authorized to reactivate retired asset with reason/evidence",
  );
  assert.equal(retReactRes.revision, 6);

  // 6. Dispose: in_service -> disposed (revision 6 -> 7)
  const { data: dispRes, error: dispErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "set_asset_lifecycle",
      p_payload: {
        id: assetId,
        expected_revision: 6,
        lifecycle_status: "disposed",
        reason: "Hazardous failure, destroyed under bio-waste protocol",
        evidence_note: "Destruction manifest #DES-2026-99",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(dispErr);
  assert.equal(dispRes.revision, 7);

  // 7. Disposed Terminal Denial: cannot transition out of disposed!
  const { error: reactDispErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "set_asset_lifecycle",
      p_payload: {
        id: assetId,
        expected_revision: 7,
        lifecycle_status: "in_service",
        reason: "Attempting reactivation of disposed asset",
        evidence_note: "Invalid request",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(
    reactDispErr,
    "Disposed assets cannot undergo ordinary reactivation",
  );
  assert.match(reactDispErr.message, /DISPOSED_LIFECYCLE_TERMINAL/);

  // Cannot transition to registered either
  const { error: toRegErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "set_asset_lifecycle",
      p_payload: {
        id: assetId,
        expected_revision: 7,
        lifecycle_status: "registered",
        reason: "Reset to registered",
        evidence_note: "Invalid",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(toRegErr, "Transition to registered must be rejected");
  assert.match(
    toRegErr.message,
    /DISPOSED_LIFECYCLE_TERMINAL|INVALID_LIFECYCLE_TRANSITION/,
  );
});

// ============================================================================
// TEST 6: Independent Operational Physical State & Custody (No Lifecycle Change)
// ============================================================================
test("S3 Inventory: Independent operational state & custody snapshot", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fx = await setupMasterFixtures(admin, staff, ns);

  // Create asset and commission
  const { data: ast } = await admin.client.rpc("equipment_asset_command", {
    p_operation: "open_asset",
    p_payload: {
      catalog_item_id: fx.item1Id,
      location_id: fx.locationAId,
      intake_reference: `OPEN-OPS-${ns}`,
      row_key: "R1",
      manufacturer: "Welch Allyn",
      model: "Spot Vital Signs",
      manufacturer_serial: `WA-${ns}-001`,
      reason: "Asset for operational testing",
      evidence_note: "Tag",
    },
    p_retry_key: crypto.randomUUID(),
  });
  await admin.client.rpc("equipment_asset_command", {
    p_operation: "set_asset_lifecycle",
    p_payload: {
      id: ast.id,
      expected_revision: 1,
      lifecycle_status: "in_service",
      reason: "Commissioning",
      evidence_note: "Pass",
    },
    p_retry_key: crypto.randomUUID(),
  });

  // Staff updates physical state: moves to location B, custodian staff, status: under_maintenance
  const { data: stRes, error: stErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "set_asset_state",
      p_payload: {
        id: ast.id,
        expected_revision: 2,
        location_id: fx.locationBId,
        custodian_id: staff.userId,
        operational_status: "under_maintenance",
        reason: "Periodic battery pack swap",
        evidence_note: "Work order #WO-303",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(stErr);
  assert.equal(stRes.revision, 3);

  // Read detail: verify physical snapshot updated, lifecycle UNCHANGED
  const { data: dRes } = await staff.client.rpc("equipment_asset_read", {
    p_resource: "detail",
    p_filters: { id: ast.id },
  });
  const asset = dRes.rows[0];
  assert.equal(asset.location_id, fx.locationBId);
  assert.equal(asset.custodian_id, staff.userId);
  assert.equal(asset.custodian_name, `S3 Test staff`);
  assert.equal(asset.operational_status, "under_maintenance");
  assert.equal(
    asset.lifecycle_status,
    "in_service",
    "Lifecycle status must remain in_service",
  );
  assert.equal(
    asset.eligible,
    false,
    "under_maintenance asset must not be eligible",
  );
  assert.ok(
    asset.ineligibility_reasons.some((r) => r.includes("requires ready")),
    "Ineligibility reason must cite operational status",
  );

  // Regression: set_asset_state missing custodian_id key is rejected without clearing existing custody
  const { error: missingCustErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "set_asset_state",
      p_payload: {
        id: ast.id,
        expected_revision: 3,
        location_id: fx.locationBId,
        // custodian_id intentionally omitted!
        operational_status: "ready",
        reason: "Omitted custodian test",
        evidence_note: "Note",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(
    missingCustErr,
    "set_asset_state missing custodian_id must be rejected",
  );
  assert.match(missingCustErr.message, /INVALID_PAYLOAD.*custodian_id/);

  // Verify custody was NOT cleared and revision NOT bumped
  const { data: dUnchanged } = await staff.client.rpc("equipment_asset_read", {
    p_resource: "detail",
    p_filters: { id: ast.id },
  });
  assert.equal(
    dUnchanged.rows[0].custodian_id,
    staff.userId,
    "Existing custody must be retained",
  );
  assert.equal(
    dUnchanged.rows[0].revision,
    3,
    "Revision must remain unchanged",
  );

  // Update back to ready, null custodian
  const { data: readyRes, error: readyErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "set_asset_state",
      p_payload: {
        id: ast.id,
        expected_revision: 3,
        location_id: fx.locationBId,
        custodian_id: null,
        operational_status: "ready",
        reason: "Battery replaced, tested OK",
        evidence_note: "Service slip #SS-404",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(readyErr);
  assert.equal(readyRes.revision, 4);

  const { data: dReady } = await staff.client.rpc("equipment_asset_read", {
    p_resource: "detail",
    p_filters: { id: ast.id },
  });
  assert.equal(dReady.rows[0].operational_status, "ready");
  assert.equal(dReady.rows[0].custodian_id, null);
  assert.equal(dReady.rows[0].eligible, true, "Asset is now eligible");
});

// ============================================================================
// TEST 7: Stale Revision Concurrency Protection & Atomic Projection
// ============================================================================
test("S3 Inventory: Stale revision concurrency protection", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fx = await setupMasterFixtures(admin, staff, ns);

  const { data: ast } = await admin.client.rpc("equipment_asset_command", {
    p_operation: "open_asset",
    p_payload: {
      catalog_item_id: fx.item1Id,
      location_id: fx.locationAId,
      intake_reference: `OPEN-RACE-${ns}`,
      row_key: "R1",
      reason: "Race test asset",
      evidence_note: "Tag",
    },
    p_retry_key: crypto.randomUUID(),
  });
  const assetId = ast.id;
  assert.equal(ast.revision, 1);

  // Operator 1 succeeds with expected_revision: 1
  const { data: op1Res, error: op1Err } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "set_asset_state",
      p_payload: {
        id: assetId,
        expected_revision: 1,
        location_id: fx.locationBId,
        custodian_id: null,
        operational_status: "in_use",
        reason: "Assigned to clinic room",
        evidence_note: "Room assignment log",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(op1Err);
  assert.equal(op1Res.revision, 2);

  // Operator 2 attempts with stale expected_revision: 1 (fails immediately)
  const { error: op2Err } = await staff.client.rpc("equipment_asset_command", {
    p_operation: "set_asset_state",
    p_payload: {
      id: assetId,
      expected_revision: 1, // Stale! Current is 2
      location_id: fx.locationAId,
      custodian_id: null,
      operational_status: "ready",
      reason: "Conflicting relocation",
      evidence_note: "Relocation note",
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(op2Err, "Concurrent update with stale revision must be rejected");
  assert.match(op2Err.message, /STALE_REVISION/);

  // Non-monotonic future revision is also rejected
  const { error: futureRevErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "set_asset_state",
      p_payload: {
        id: assetId,
        expected_revision: 99, // Future!
        location_id: fx.locationAId,
        custodian_id: null,
        operational_status: "ready",
        reason: "Future revision attempt",
        evidence_note: "Note",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(futureRevErr, "Future revision must be rejected");
  assert.match(futureRevErr.message, /STALE_REVISION/);
});

// ============================================================================
// TEST 8: Full Auth Matrix, Denied Roles, & Replay After Role Loss
// ============================================================================
test("S3 Inventory: Full auth matrix, denied roles, & replay after role loss", async () => {
  const service = getServiceClient();
  const anon = getAnonClient();

  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const lecturer = await createTestUser(service, "lecturer", true);
  const ta = await createTestUser(service, "teaching_assistant", true);
  const viewer = await createTestUser(service, "viewer", true);
  const inactiveStaff = await createTestUser(service, "staff", false);

  const ns = crypto.randomUUID().slice(0, 6);
  const fx = await setupMasterFixtures(admin, staff, ns);

  // 1. Staff calling Admin-only command: open_asset -> DENIED
  const { error: staffOpenErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "open_asset",
      p_payload: {
        catalog_item_id: fx.item1Id,
        location_id: fx.locationAId,
        intake_reference: `OPEN-STAFF-DENY-${ns}`,
        row_key: "R1",
        reason: "Staff attempting open_asset",
        evidence_note: "Note",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(staffOpenErr, "Staff role must be denied open_asset");
  assert.match(staffOpenErr.message, /AUTH_DENIED/);

  // 2. Staff calling Admin-only command: set_asset_lifecycle -> DENIED
  // Create an asset first with admin
  const { data: ast } = await admin.client.rpc("equipment_asset_command", {
    p_operation: "open_asset",
    p_payload: {
      catalog_item_id: fx.item1Id,
      location_id: fx.locationAId,
      intake_reference: `OPEN-AUTH-${ns}`,
      row_key: "R1",
      reason: "Asset for auth test",
      evidence_note: "Note",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { error: staffLcErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "set_asset_lifecycle",
      p_payload: {
        id: ast.id,
        expected_revision: 1,
        lifecycle_status: "in_service",
        reason: "Staff attempting lifecycle change",
        evidence_note: "Note",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(staffLcErr, "Staff role must be denied set_asset_lifecycle");
  assert.match(staffLcErr.message, /AUTH_DENIED/);

  // 3. Denied roles: Lecturer, TA, Viewer, Inactive, Anonymous
  for (const user of [lecturer, ta, viewer, inactiveStaff]) {
    const { error: readErr } = await user.client.rpc("equipment_asset_read", {
      p_resource: "assets",
      p_filters: {},
    });
    assert.ok(readErr, "Unauthorized role must be denied equipment_asset_read");
    assert.match(readErr.message, /AUTH_DENIED/);

    const { error: cmdErr } = await user.client.rpc("equipment_asset_command", {
      p_operation: "receive_asset",
      p_payload: {
        catalog_item_id: fx.item1Id,
        source_line_id: fx.sourceLine1Id,
        location_id: fx.locationAId,
        intake_reference: `PO-DENY-${ns}`,
        row_key: "R1",
        reason: "Unauthorized command",
        evidence_note: "Note",
      },
      p_retry_key: crypto.randomUUID(),
    });
    assert.ok(
      cmdErr,
      "Unauthorized role must be denied equipment_asset_command",
    );
    assert.match(cmdErr.message, /AUTH_DENIED/);
  }

  const { error: anonReadErr } = await anon.rpc("equipment_asset_read", {
    p_resource: "assets",
  });
  assert.ok(anonReadErr, "Anonymous must be denied equipment_asset_read");

  const { error: anonCmdErr } = await anon.rpc("equipment_asset_command", {
    p_operation: "receive_asset",
    p_payload: {},
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(anonCmdErr, "Anonymous must be denied equipment_asset_command");

  // 4. Replay After Role Loss: Admin executes command, then is deactivated; replay is DENIED
  const demoteAdmin = await createTestUser(service, "admin", true);
  const replayKey = crypto.randomUUID();
  const { data: demoteAst, error: demoteAstErr } = await demoteAdmin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "open_asset",
      p_payload: {
        catalog_item_id: fx.item1Id,
        location_id: fx.locationAId,
        intake_reference: `OPEN-REPLAY-LOSS-${ns}`,
        row_key: "R1",
        reason: "Replay role loss initial command",
        evidence_note: "Initial note",
      },
      p_retry_key: replayKey,
    },
  );
  assert.ifError(demoteAstErr);
  assert.ok(demoteAst.id);

  // Inactivate profile
  await service
    .from("profiles")
    .update({ is_active: false })
    .eq("id", demoteAdmin.userId);

  // Replay attempt must now fail authorization BEFORE returning cached replay!
  const { error: replayLossErr } = await demoteAdmin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "open_asset",
      p_payload: {
        catalog_item_id: fx.item1Id,
        location_id: fx.locationAId,
        intake_reference: `OPEN-REPLAY-LOSS-${ns}`,
        row_key: "R1",
        reason: "Replay role loss initial command",
        evidence_note: "Initial note",
      },
      p_retry_key: replayKey,
    },
  );
  assert.ok(replayLossErr, "Replay by now-inactive user must be denied");
  assert.match(replayLossErr.message, /AUTH_DENIED/);
});

// ============================================================================
// TEST 9: Direct Table DML Prohibited by RLS & Immutability Triggers
// ============================================================================
test("S3 Inventory: Direct DML on equipment_assets and events prohibited", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fx = await setupMasterFixtures(admin, staff, ns);

  // Create an asset legitimately
  const { data: ast } = await admin.client.rpc("equipment_asset_command", {
    p_operation: "open_asset",
    p_payload: {
      catalog_item_id: fx.item1Id,
      location_id: fx.locationAId,
      intake_reference: `OPEN-DML-${ns}`,
      row_key: "R1",
      reason: "Asset for DML test",
      evidence_note: "Note",
    },
    p_retry_key: crypto.randomUUID(),
  });

  // 1. Direct INSERT on equipment_assets via authenticated client: revoked / forbidden
  const { error: insErr } = await admin.client.from("equipment_assets").insert({
    asset_code: "EIU-AST-99999999",
    catalog_item_id: fx.item1Id,
    intake_kind: "open",
    intake_reference: `OPEN-DIRECT-${ns}`,
    row_key: "R1",
    location_id: fx.locationAId,
  });
  assert.ok(insErr, "Direct INSERT on equipment_assets must be denied");

  // 2. Direct UPDATE on equipment_assets via authenticated client: revoked
  const { error: updErr } = await admin.client
    .from("equipment_assets")
    .update({ asset_code: "EIU-AST-88888888" })
    .eq("id", ast.id);
  assert.ok(updErr, "Direct UPDATE on equipment_assets must be denied");

  // 3. Direct DELETE on equipment_assets via authenticated client: revoked
  const { error: delErr } = await admin.client
    .from("equipment_assets")
    .delete()
    .eq("id", ast.id);
  assert.ok(delErr, "Direct DELETE on equipment_assets must be denied");

  // 4. Direct INSERT on equipment_asset_events via authenticated client: revoked
  const { error: insEvErr } = await admin.client
    .from("equipment_asset_events")
    .insert({
      asset_id: ast.id,
      revision: 99,
      operation: "bogus",
      actor_id: admin.userId,
      occurred_at: new Date().toISOString(),
      reason: "Fake event",
      evidence_note: "Fake",
      after_state: {},
      transaction_id: ast.transaction_id,
    });
  assert.ok(insEvErr, "Direct INSERT on equipment_asset_events must be denied");

  // 5. Direct UPDATE and DELETE on equipment_asset_events via authenticated client: revoked
  const { error: updEvErr } = await admin.client
    .from("equipment_asset_events")
    .update({ reason: "Tampered reason" })
    .eq("id", ast.event_id);
  assert.ok(updEvErr, "Direct UPDATE on equipment_asset_events must be denied");

  const { error: delEvErr } = await admin.client
    .from("equipment_asset_events")
    .delete()
    .eq("id", ast.event_id);
  assert.ok(delEvErr, "Direct DELETE on equipment_asset_events must be denied");
});

// ============================================================================
// TEST 10: Append-Only Event Corrections Preserve History & Protect Fixed Axes
// ============================================================================
test("S3 Inventory: Append-only event corrections preserve history & protect fixed axes", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fx = await setupMasterFixtures(admin, staff, ns);

  // 1. Staff receipts an asset (Item 1, not expiry required)
  const { data: recAst } = await staff.client.rpc("equipment_asset_command", {
    p_operation: "receive_asset",
    p_payload: {
      catalog_item_id: fx.item1Id,
      source_line_id: fx.sourceLine1Id,
      location_id: fx.locationAId,
      intake_reference: `PO-CORR-${ns}`,
      row_key: "R1",
      manufacturer: "TypoMaker",
      model: "OldModel",
      manufacturer_serial: `TYPO-${ns}-01`,
      reason: "Initial delivery with typo",
      evidence_note: "Rough waybill note",
    },
    p_retry_key: crypto.randomUUID(),
  });
  const assetId = recAst.id;
  const originalEventId = recAst.event_id;
  const originalCode = recAst.asset_code;

  // 2. Staff corrects metadata (manufacturer, model, serial) referencing event 1
  const { data: corrRes, error: corrErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "correct_asset",
      p_payload: {
        id: assetId,
        expected_revision: 1,
        corrects_event_id: originalEventId,
        manufacturer: "Siemens Healthineers",
        model: "Axiom Artis",
        manufacturer_serial: `SIEMENS-${ns}-01`,
        expiry_precision: "not_required",
        expiry_input: null,
        reason: "Corrected manufacturer and serial from engraved nameplate",
        evidence_note: "Nameplate photograph attached #IMG-9912",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(corrErr);
  assert.equal(corrRes.revision, 2);
  assert.equal(
    corrRes.asset_code,
    originalCode,
    "Asset code must remain immutable during correction",
  );

  // 3. Verify history preserves BOTH events
  const { data: histRes } = await staff.client.rpc("equipment_asset_read", {
    p_resource: "history",
    p_filters: { id: assetId },
  });
  assert.equal(histRes.total, 2);
  const [event2, event1] = histRes.rows;

  // Event 2 is correction
  assert.equal(event2.revision, 2);
  assert.equal(event2.operation, "correct_asset");
  assert.equal(event2.corrects_event_id, originalEventId);
  assert.equal(event2.after_state.manufacturer, "Siemens Healthineers");
  assert.equal(event2.before_state.manufacturer, "TypoMaker");

  // Event 1 is pristine original receipt
  assert.equal(event1.revision, 1);
  assert.equal(event1.operation, "receive_asset");
  assert.equal(event1.after_state.manufacturer, "TypoMaker");
  assert.equal(event1.corrects_event_id, null);

  // 4. Verify asset projection has updated facts
  const { data: detailRes } = await staff.client.rpc("equipment_asset_read", {
    p_resource: "detail",
    p_filters: { id: assetId },
  });
  const asset = detailRes.rows[0];
  assert.equal(asset.manufacturer, "Siemens Healthineers");
  assert.equal(asset.model, "Axiom Artis");
  assert.equal(asset.manufacturer_serial, `SIEMENS-${ns}-01`);
  assert.equal(asset.asset_code, originalCode, "Code remains immutable");
  assert.equal(
    asset.catalog_item_id,
    fx.item1Id,
    "Catalog item remains immutable",
  );
  assert.equal(asset.intake_kind, "receive", "Intake kind remains immutable");
  assert.equal(
    asset.intake_reference,
    `PO-CORR-${ns}`,
    "Intake ref remains immutable",
  );
  assert.equal(asset.row_key, "R1", "Row key remains immutable");

  // Regression: correct_asset omitting snapshot keys is rejected with unchanged serial/revision/history
  const { error: missingKeyErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "correct_asset",
      p_payload: {
        id: assetId,
        expected_revision: 2,
        corrects_event_id: originalEventId,
        manufacturer: "Siemens Healthineers",
        // model and manufacturer_serial intentionally omitted!
        expiry_precision: "not_required",
        expiry_input: null,
        reason: "Omitted keys test",
        evidence_note: "Note",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(
    missingKeyErr,
    "correct_asset with missing snapshot keys must be rejected",
  );
  assert.match(
    missingKeyErr.message,
    /INVALID_PAYLOAD.*Metadata correction requires complete snapshot/,
  );

  // Verify serial, revision, and history remain completely UNCHANGED
  const { data: dCorrUnchanged } = await staff.client.rpc(
    "equipment_asset_read",
    {
      p_resource: "detail",
      p_filters: { id: assetId },
    },
  );
  assert.equal(
    dCorrUnchanged.rows[0].manufacturer_serial,
    `SIEMENS-${ns}-01`,
    "Serial must remain unchanged",
  );
  assert.equal(
    dCorrUnchanged.rows[0].revision,
    2,
    "Revision must remain unchanged",
  );

  const { data: hCorrUnchanged } = await staff.client.rpc(
    "equipment_asset_read",
    {
      p_resource: "history",
      p_filters: { id: assetId },
    },
  );
  assert.equal(
    hCorrUnchanged.total,
    2,
    "History event count must remain unchanged",
  );

  // 5. Invalid correction target: event belonging to a DIFFERENT asset
  const { data: otherAst } = await admin.client.rpc("equipment_asset_command", {
    p_operation: "open_asset",
    p_payload: {
      catalog_item_id: fx.item1Id,
      location_id: fx.locationAId,
      intake_reference: `OPEN-OTHER-${ns}`,
      row_key: "R1",
      reason: "Other asset",
      evidence_note: "Note",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { error: crossAstErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "correct_asset",
      p_payload: {
        id: assetId,
        expected_revision: 2,
        corrects_event_id: otherAst.event_id, // Belongs to OTHER asset!
        manufacturer: "Siemens",
        model: "Axiom",
        manufacturer_serial: null,
        expiry_precision: "not_required",
        expiry_input: null,
        reason: "Cross asset correction attempt",
        evidence_note: "Note",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(
    crossAstErr,
    "Correction referencing event of another asset must be rejected",
  );
  assert.match(crossAstErr.message, /INVALID_CORRECTION_TARGET/);

  // 6. Staff cannot correct an open_asset intake (Admin-only)
  const { error: staffCorrOpenErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "correct_asset",
      p_payload: {
        id: otherAst.id, // otherAst is an 'open' asset!
        expected_revision: 1,
        corrects_event_id: otherAst.event_id,
        manufacturer: "New Maker",
        model: "New Model",
        manufacturer_serial: null,
        expiry_precision: "not_required",
        expiry_input: null,
        reason: "Staff attempting to correct opening",
        evidence_note: "Note",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(
    staffCorrOpenErr,
    "Staff role must be denied correcting an opening asset",
  );
  assert.match(staffCorrOpenErr.message, /AUTH_DENIED/);
});

// ============================================================================
// TEST 11: Expiry Precision, Unknown Expiry Opening Ineligibility, & Date Correction
// ============================================================================
test("S3 Inventory: Expiry precision, unknown expiry opening ineligibility, & date correction", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fx = await setupMasterFixtures(admin, staff, ns);

  // Item 2 has expiry_required = true

  // 1. Staff receipt with unknown expiry on expiry-required item is REJECTED
  const { error: staffUnknownErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "receive_asset",
      p_payload: {
        catalog_item_id: fx.item2Id,
        source_line_id: fx.sourceLine2Id,
        location_id: fx.locationAId,
        intake_reference: `PO-EXP-UNK-${ns}`,
        row_key: "R1",
        expiry_precision: "unknown",
        reason: "Receipt with unknown expiry",
        evidence_note: "Note",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(
    staffUnknownErr,
    "Staff receipt with unknown expiry on expiry-required item must be rejected",
  );
  assert.match(staffUnknownErr.message, /INVALID_EXPIRY/);

  // 2. Admin opening with unknown expiry on expiry-required item is ACCEPTED
  const { data: openUnkRes, error: openUnkErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "open_asset",
      p_payload: {
        catalog_item_id: fx.item2Id,
        location_id: fx.locationAId,
        intake_reference: `OPEN-EXP-UNK-${ns}`,
        row_key: "R1",
        expiry_precision: "unknown",
        reason: "Opening batch with unverified expiry sticker",
        evidence_note: "Physical unit pending lab re-assay",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(openUnkErr);
  const assetId = openUnkRes.id;
  const openEventId = openUnkRes.event_id;

  // 3. Commission the asset to in_service
  await admin.client.rpc("equipment_asset_command", {
    p_operation: "set_asset_lifecycle",
    p_payload: {
      id: assetId,
      expected_revision: 1,
      lifecycle_status: "in_service",
      reason: "Commissioning unknown expiry asset",
      evidence_note: "Lab intake memo",
    },
    p_retry_key: crypto.randomUUID(),
  });

  // 4. Verify eligibility: even though in_service and ready, eligible must be FALSE due to unknown expiry!
  const { data: unkDetail } = await admin.client.rpc("equipment_asset_read", {
    p_resource: "detail",
    p_filters: { id: assetId },
  });
  const unkAsset = unkDetail.rows[0];
  assert.equal(unkAsset.lifecycle_status, "in_service");
  assert.equal(unkAsset.operational_status, "ready");
  assert.equal(
    unkAsset.eligible,
    false,
    "Asset with unknown required expiry must not be eligible",
  );
  assert.ok(
    unkAsset.ineligibility_reasons.some((r) =>
      r.includes("unknown or unverified"),
    ),
    "Ineligibility reasons must cite unknown or unverified expiry",
  );

  // 5. Staff attempts to correct required-expiry: DENIED (Admin-only)
  const { error: staffCorrExpErr } = await staff.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "correct_asset",
      p_payload: {
        id: assetId,
        expected_revision: 2,
        corrects_event_id: openEventId,
        manufacturer: null,
        model: null,
        manufacturer_serial: null,
        expiry_precision: "day",
        expiry_input: "2028-12-31",
        reason: "Staff attempting expiry correction",
        evidence_note: "Note",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(
    staffCorrExpErr,
    "Staff role must be denied correcting required-expiry item",
  );
  assert.match(staffCorrExpErr.message, /AUTH_DENIED/);

  // 6. Admin verifies and corrects expiry date with evidence
  const { data: corrExpRes, error: corrExpErr } = await admin.client.rpc(
    "equipment_asset_command",
    {
      p_operation: "correct_asset",
      p_payload: {
        id: assetId,
        expected_revision: 2,
        corrects_event_id: openEventId,
        manufacturer: null,
        model: null,
        manufacturer_serial: null,
        expiry_precision: "day",
        expiry_input: "2028-12-31",
        reason: "Certificate of Analysis retrieved from manufacturer portal",
        evidence_note: "COA #COA-2028-9988 verified and archived",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(corrExpErr);
  assert.equal(corrExpRes.revision, 3);

  // 7. Verify eligibility after correction: now TRUE!
  const { data: verifiedDetail } = await admin.client.rpc(
    "equipment_asset_read",
    {
      p_resource: "detail",
      p_filters: { id: assetId },
    },
  );
  const verifiedAsset = verifiedDetail.rows[0];
  assert.equal(verifiedAsset.expiry_date, "2028-12-31");
  assert.equal(
    verifiedAsset.eligible,
    true,
    "Asset with verified future expiry must now be eligible",
  );
  assert.equal(verifiedAsset.ineligibility_reasons.length, 0);

  // 8. Test expired date behavior: past expiry makes asset ineligible
  const { data: expAst } = await admin.client.rpc("equipment_asset_command", {
    p_operation: "open_asset",
    p_payload: {
      catalog_item_id: fx.item2Id,
      location_id: fx.locationAId,
      intake_reference: `OPEN-EXP-PAST-${ns}`,
      row_key: "R1",
      expiry_precision: "day",
      expiry_input: "2020-01-01", // Past date!
      reason: "Historical expired unit recorded for inventory reconciliation",
      evidence_note: "Expired package inspection",
    },
    p_retry_key: crypto.randomUUID(),
  });
  await admin.client.rpc("equipment_asset_command", {
    p_operation: "set_asset_lifecycle",
    p_payload: {
      id: expAst.id,
      expected_revision: 1,
      lifecycle_status: "in_service",
      reason: "Commissioning",
      evidence_note: "Pass",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: expDetail } = await admin.client.rpc("equipment_asset_read", {
    p_resource: "detail",
    p_filters: { id: expAst.id },
  });
  assert.equal(
    expDetail.rows[0].eligible,
    false,
    "Expired asset must be ineligible",
  );
  assert.ok(
    expDetail.rows[0].ineligibility_reasons.some((r) => r.includes("expired")),
    "Ineligibility reasons must cite asset expiration",
  );
});

// ============================================================================
// TEST 12: Exact QR Code Lookup (Valid, Malformed, Unknown, & Ineligible Status)
// ============================================================================
test("S3 Inventory: Exact QR code lookup (valid, malformed, unknown, & ineligible status)", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fx = await setupMasterFixtures(admin, staff, ns);

  // Create an asset in registered status (ineligible)
  const { data: ast } = await admin.client.rpc("equipment_asset_command", {
    p_operation: "open_asset",
    p_payload: {
      catalog_item_id: fx.item1Id,
      location_id: fx.locationAId,
      intake_reference: `OPEN-QR-${ns}`,
      row_key: "R1",
      manufacturer: "Abbott",
      model: "i-STAT 1",
      manufacturer_serial: `AB-${ns}-001`,
      reason: "Asset for QR lookup test",
      evidence_note: "QR barcode sticker applied",
    },
    p_retry_key: crypto.randomUUID(),
  });
  const validCode = ast.asset_code;

  // 1. Valid exact code lookup
  const { data: lookupRes, error: lookupErr } = await staff.client.rpc(
    "equipment_asset_read",
    {
      p_resource: "lookup",
      p_filters: { asset_code: validCode },
    },
  );
  assert.ifError(lookupErr);
  assert.equal(lookupRes.total, 1);
  const found = lookupRes.rows[0];
  assert.equal(found.id, ast.id);
  assert.equal(found.asset_code, validCode);
  assert.equal(found.model, "i-STAT 1");
  // Ineligible match is identified, but explicitly marked eligible = false!
  assert.equal(found.eligible, false);
  assert.ok(found.ineligibility_reasons.length > 0);

  // 2. Malformed codes are REJECTED with INVALID_ASSET_CODE
  const malformedCodes = [
    "",
    "INVALID",
    "EIU-AST-123", // too short
    "EIU-AST-123456789", // too long
    "EIU-AST-ZZZZZZZZ", // non-hex
    validCode.toLowerCase(), // lowercase
    "http://campus.local/inventory/assets/123", // URL instead of bare code
  ];

  for (const badCode of malformedCodes) {
    const { error: badCodeErr } = await staff.client.rpc(
      "equipment_asset_read",
      {
        p_resource: "lookup",
        p_filters: { asset_code: badCode },
      },
    );
    assert.ok(badCodeErr, `Malformed code '${badCode}' must be rejected`);
    assert.match(badCodeErr.message, /INVALID_ASSET_CODE/);
  }

  // 3. Unknown code with valid format: not found throws INVALID_ASSET_CODE
  const unknownCode = "EIU-AST-FFFFFFFF";
  const { error: unkErr } = await staff.client.rpc("equipment_asset_read", {
    p_resource: "lookup",
    p_filters: { asset_code: unknownCode },
  });
  assert.ok(unkErr, "Unknown valid format code must return not found");
  assert.match(unkErr.message, /INVALID_ASSET_CODE/);
});

// ============================================================================
// TEST 13: Paginated History Beyond Limit Retains Oldest Evidence
// ============================================================================
test("S3 Inventory: Paginated history beyond limit retains oldest evidence", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fx = await setupMasterFixtures(admin, staff, ns);

  // 1. Initial intake (Revision 1)
  const { data: ast } = await admin.client.rpc("equipment_asset_command", {
    p_operation: "open_asset",
    p_payload: {
      catalog_item_id: fx.item1Id,
      location_id: fx.locationAId,
      intake_reference: `OPEN-HIST-${ns}`,
      row_key: "R1",
      reason: "Genesis opening event for history pagination test",
      evidence_note: "Original intake memorandum 2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });
  const assetId = ast.id;
  const initialEventId = ast.event_id;

  // 2. Commission (Revision 2)
  await admin.client.rpc("equipment_asset_command", {
    p_operation: "set_asset_lifecycle",
    p_payload: {
      id: assetId,
      expected_revision: 1,
      lifecycle_status: "in_service",
      reason: "Commissioning event",
      evidence_note: "Pass report",
    },
    p_retry_key: crypto.randomUUID(),
  });

  // 3. State update 1 (Revision 3)
  await staff.client.rpc("equipment_asset_command", {
    p_operation: "set_asset_state",
    p_payload: {
      id: assetId,
      expected_revision: 2,
      location_id: fx.locationBId,
      custodian_id: null,
      operational_status: "in_use",
      reason: "Moved to location B",
      evidence_note: "Move slip 1",
    },
    p_retry_key: crypto.randomUUID(),
  });

  // 4. State update 2 (Revision 4)
  await staff.client.rpc("equipment_asset_command", {
    p_operation: "set_asset_state",
    p_payload: {
      id: assetId,
      expected_revision: 3,
      location_id: fx.locationBId,
      custodian_id: staff.userId,
      operational_status: "under_maintenance",
      reason: "Maintenance check",
      evidence_note: "Service tag 2",
    },
    p_retry_key: crypto.randomUUID(),
  });

  // 5. State update 3 (Revision 5)
  await staff.client.rpc("equipment_asset_command", {
    p_operation: "set_asset_state",
    p_payload: {
      id: assetId,
      expected_revision: 4,
      location_id: fx.locationAId,
      custodian_id: null,
      operational_status: "ready",
      reason: "Returned to location A ready",
      evidence_note: "Return receipt 3",
    },
    p_retry_key: crypto.randomUUID(),
  });

  // 6. Correction (Revision 6)
  await admin.client.rpc("equipment_asset_command", {
    p_operation: "correct_asset",
    p_payload: {
      id: assetId,
      expected_revision: 5,
      corrects_event_id: initialEventId,
      manufacturer: "Corrected Brand",
      model: "Corrected Model",
      manufacturer_serial: null,
      expiry_precision: "not_required",
      expiry_input: null,
      reason: "Brand corrected",
      evidence_note: "Verification memo",
    },
    p_retry_key: crypto.randomUUID(),
  });
  // Total events = 6. Let's query with page_size = 2.
  // Page 1: Revisions 6, 5
  const { data: page1 } = await staff.client.rpc("equipment_asset_read", {
    p_resource: "history",
    p_filters: { id: assetId, page: 1, page_size: 2 },
  });
  assert.equal(page1.total, 6);
  assert.equal(page1.rows.length, 2);
  assert.equal(page1.rows[0].revision, 6);
  assert.equal(page1.rows[1].revision, 5);

  // Page 2: Revisions 4, 3
  const { data: page2 } = await staff.client.rpc("equipment_asset_read", {
    p_resource: "history",
    p_filters: { id: assetId, page: 2, page_size: 2 },
  });
  assert.equal(page2.total, 6);
  assert.equal(page2.rows.length, 2);
  assert.equal(page2.rows[0].revision, 4);
  assert.equal(page2.rows[1].revision, 3);

  // Page 3: Revisions 2, 1 (Retains oldest genesis opening evidence!)
  const { data: page3 } = await staff.client.rpc("equipment_asset_read", {
    p_resource: "history",
    p_filters: { id: assetId, page: 3, page_size: 2 },
  });
  assert.equal(page3.total, 6);
  assert.equal(page3.rows.length, 2);
  assert.equal(page3.rows[0].revision, 2);
  assert.equal(page3.rows[1].revision, 1);
  assert.equal(
    page3.rows[1].reason,
    "Genesis opening event for history pagination test",
    "Oldest genesis intake evidence must be retained on final page",
  );
  assert.equal(
    page3.rows[1].evidence_note,
    "Original intake memorandum 2026-10-01",
  );

  // 7. Query history by transaction_id
  const genesisTxId = ast.transaction_id;
  const { data: txHist, error: txHistErr } = await staff.client.rpc(
    "equipment_asset_read",
    {
      p_resource: "history",
      p_filters: { transaction_id: genesisTxId },
    },
  );
  assert.ifError(txHistErr);
  assert.equal(txHist.total, 1);
  assert.equal(txHist.rows[0].revision, 1);
  assert.equal(txHist.rows[0].transaction_id, genesisTxId);

  // 8. History filter validation: neither or both must fail
  const { error: neitherErr } = await staff.client.rpc("equipment_asset_read", {
    p_resource: "history",
    p_filters: {},
  });
  assert.ok(neitherErr, "History query without id or transaction_id must fail");
  assert.match(neitherErr.message, /INVALID_PAYLOAD/);

  const { error: bothErr } = await staff.client.rpc("equipment_asset_read", {
    p_resource: "history",
    p_filters: { id: assetId, transaction_id: genesisTxId },
  });
  assert.ok(bothErr, "History query with both id and transaction_id must fail");
  assert.match(bothErr.message, /INVALID_PAYLOAD/);
});

// ============================================================================
// TEST 14: First-Fact Master Axis Retarget Guards
// ============================================================================
test("S3 Inventory: First-fact master axis retarget guards", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fx = await setupMasterFixtures(admin, staff, ns);

  // Create an asset referencing item 1 and sourceLine 1
  const { data: ast } = await staff.client.rpc("equipment_asset_command", {
    p_operation: "receive_asset",
    p_payload: {
      catalog_item_id: fx.item1Id,
      source_line_id: fx.sourceLine1Id,
      location_id: fx.locationAId,
      intake_reference: `PO-LOCK-${ns}`,
      row_key: "R1",
      reason: "Asset establishing first fact locks",
      evidence_note: "Lock verification note",
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(ast.id);

  // 1. Direct UPDATE on catalog items is REVOKED / DENIED for authenticated users
  // (Privileged first-fact trigger enforcement SENSITIVE_AXES_LOCKED is covered by pgTAP test 17)
  const { error: lockTrackErr } = await admin.client
    .from("inventory_catalog_items")
    .update({ tracking_strategy: "quantity" })
    .eq("id", fx.item1Id);
  assert.ok(lockTrackErr, "Direct UPDATE on catalog items must be denied");

  // 2. Direct DELETE on catalog items is REVOKED / DENIED for authenticated users
  const { error: delItemErr } = await admin.client
    .from("inventory_catalog_items")
    .delete()
    .eq("id", fx.item1Id);
  assert.ok(delItemErr, "Direct DELETE on catalog items must be denied");

  // 3. Direct UPDATE on source lines is REVOKED / DENIED for authenticated users
  // (Privileged first-fact trigger enforcement SOURCE_LINE_IN_USE is covered by pgTAP test 18)
  const { error: lockSourceLineErr } = await admin.client
    .from("acquisition_record_lines")
    .update({ catalog_item_id: fx.item2Id })
    .eq("id", fx.sourceLine1Id);
  assert.ok(lockSourceLineErr, "Direct UPDATE on source lines must be denied");
});
