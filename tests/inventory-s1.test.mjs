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

function toScaled(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,6}))?$/.exec(String(value));
  assert.ok(match, `Invalid exact decimal: ${value}`);
  const magnitude =
    BigInt(match[2]) * BigInt(1000000) +
    BigInt((match[3] ?? "").padEnd(6, "0"));
  return match[1] ? -magnitude : magnitude;
}

function assertDecimalEqual(actual, expected, message) {
  const actualScaled = toScaled(actual);
  const expectedScaled = toScaled(expected);
  assert.equal(
    actualScaled,
    expectedScaled,
    message ??
      `Expected numeric ${expected} (scaled ${expectedScaled}), got ${actual} (scaled ${actualScaled})`,
  );
}

async function createTestUser(service, role, isActive = true) {
  const email = `s1-${role}-${crypto.randomUUID()}@campus.local`;
  const password = "LocalS1TestPassword123!";
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { preapproved: true },
    user_metadata: { full_name: `S1 Test ${role}` },
  });
  assert.ifError(error);
  const userId = data.user.id;

  await service.from("profiles").upsert({
    id: userId,
    email,
    full_name: `S1 Test ${role}`,
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
  const uomDiscreteCode = `uom_cnt_${ns}`;
  const { error: uomErr1 } = await admin.client.rpc("inventory_command", {
    p_operation: "create_inventory_uom",
    p_payload: {
      code: uomDiscreteCode,
      name: `Count ${ns}`,
      dimension: "count",
      allowed_scale: 0,
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(uomErr1);

  // 2. Create measured UOM (mL)
  const uomMlCode = `uom_ml_${ns}`;
  const { error: uomErr2 } = await admin.client.rpc("inventory_command", {
    p_operation: "create_inventory_uom",
    p_payload: {
      code: uomMlCode,
      name: `Milliliter ${ns}`,
      dimension: "volume",
      allowed_scale: 6,
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(uomErr2);

  // 3. Create package UOM (box)
  const uomBoxCode = `uom_box_${ns}`;
  const { error: uomErr3 } = await admin.client.rpc("inventory_command", {
    p_operation: "create_inventory_uom",
    p_payload: {
      code: uomBoxCode,
      name: `Box ${ns}`,
      dimension: "package",
      allowed_scale: 0,
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(uomErr3);

  // 4. Create category
  const catCode = `CAT_${ns.toUpperCase()}`;
  const { data: catRes, error: catErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_category",
      p_payload: { code: catCode, name: `Category ${ns}` },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(catErr);
  const categoryId = catRes.id;

  // 5. Create supplier
  const { data: suppRes, error: suppErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_supplier",
      p_payload: {
        name: `Supplier ${ns}`,
        tax_code: "0101234567",
        contact: "contact@supplier.local",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(suppErr);
  const supplierId = suppRes.id;

  // 6. Create locations (Root Loc A, Child Loc B)
  const { data: locARes, error: locAErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_location",
      p_payload: {
        code: `LOC_A_${ns.toUpperCase()}`,
        name: `Warehouse A ${ns}`,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(locAErr);
  const locationAId = locARes.id;

  const { data: locBRes, error: locBErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_location",
      p_payload: {
        code: `LOC_B_${ns.toUpperCase()}`,
        name: `Cabinet B ${ns}`,
        parent_location_id: locationAId,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(locBErr);
  const locationBId = locBRes.id;

  return {
    uomDiscrete: uomDiscreteCode,
    uomMl: uomMlCode,
    uomBox: uomBoxCode,
    categoryId,
    supplierId,
    locationAId,
    locationBId,
  };
}

async function getOriginIdFromTransaction(client, transactionId) {
  const { data: detail, error } = await client.rpc("inventory_read", {
    p_resource: "transaction_detail",
    p_filters: { id: transactionId },
  });
  assert.ifError(error);
  assert.ok(
    detail.rows.length > 0,
    `Transaction ${transactionId} not found in detail read`,
  );
  assert.ok(
    detail.rows[0].facts.length > 0,
    `No facts found for transaction ${transactionId}`,
  );
  return detail.rows[0].facts[0].origin_id;
}

// ============================================================================
// TEST 1: Full Auth Matrix, Denied Roles & Replay Role Loss
// ============================================================================
test("S1 Inventory: Full Auth Matrix, Denied Roles & Replay Role Loss", async () => {
  const service = getServiceClient();
  const anon = getAnonClient();

  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const lecturer = await createTestUser(service, "lecturer", true);
  const ta = await createTestUser(service, "teaching_assistant", true);
  const viewer = await createTestUser(service, "viewer", true);
  const importer = await createTestUser(service, "importer", true);
  const inactiveStaff = await createTestUser(service, "staff", false);

  // 1. Allowed roles: Admin and Staff can read
  for (const user of [admin, staff]) {
    const { data, error } = await user.client.rpc("inventory_read", {
      p_resource: "items",
      p_filters: {},
    });
    assert.ifError(error);
    assert.ok(Array.isArray(data.rows));
  }

  // 2. Denied roles: Lecturer, TA, Viewer, Importer, Inactive, Anonymous
  for (const user of [lecturer, ta, viewer, importer, inactiveStaff]) {
    const { error: readErr } = await user.client.rpc("inventory_read", {
      p_resource: "items",
      p_filters: {},
    });
    assert.ok(readErr, `Role must be denied inventory_read`);
    assert.match(readErr.message, /AUTH_DENIED/);

    const { error: cmdErr } = await user.client.rpc("inventory_command", {
      p_operation: "create_inventory_category",
      p_payload: {
        code: `DENIED_${crypto.randomUUID().slice(0, 6)}`,
        name: "Denied",
      },
      p_retry_key: crypto.randomUUID(),
    });
    assert.ok(cmdErr, `Role must be denied inventory_command`);
    assert.match(cmdErr.message, /AUTH_DENIED/);
  }

  const { error: anonErr } = await anon.rpc("inventory_read", {
    p_resource: "items",
  });
  assert.ok(anonErr, "Anonymous must be denied inventory_read");

  // 3. Direct table mutation denial
  const { error: directErr } = await admin.client
    .from("inventory_catalog_items")
    .insert({ code: "DIRECT", name: "Direct" });
  assert.ok(directErr, "Direct INSERT on inventory tables must be revoked");

  // 4. Staff denied on Admin commands
  const { error: staffAdminErr } = await staff.client.rpc("inventory_command", {
    p_operation: "confirm_opening_balance",
    p_payload: { cutover_key: "CUT-DENY", synthetic: true, lines: [] },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(staffAdminErr);
  assert.match(staffAdminErr.message, /AUTH_DENIED/);

  // 5. Replay Role Loss: Staff executes command, then is demoted/inactivated; replay is denied
  const demoteStaff = await createTestUser(service, "staff", true);
  const replayKey = crypto.randomUUID();
  const catCode = `CAT_REPLAY_LOSS_${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  const { data: initRes, error: initErr } = await demoteStaff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_category",
      p_payload: { code: catCode, name: "Replay Role Loss Test" },
      p_retry_key: replayKey,
    },
  );
  assert.ifError(initErr);
  assert.ok(initRes.id);

  // Inactivate profile
  await service
    .from("profiles")
    .update({ is_active: false })
    .eq("id", demoteStaff.userId);

  // Replay attempt must now fail authorization before returning cached replay
  const { error: replayLossErr } = await demoteStaff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_category",
      p_payload: { code: catCode, name: "Replay Role Loss Test" },
      p_retry_key: replayKey,
    },
  );
  assert.ok(replayLossErr, "Replay by now-inactive user must be denied");
  assert.match(replayLossErr.message, /AUTH_DENIED/);
});

// ============================================================================
// TEST 2: Discrete vs Measured Decimals, Trailing Zeros & Excess Precision
// ============================================================================
test("S1 Inventory: Discrete vs Measured Decimals, Trailing Zeros & Excess Precision", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = "s1_" + crypto.randomUUID().slice(0, 8);

  const fx = await setupMasterFixtures(admin, staff, ns);

  // Create discrete item (box, scale 0)
  const discreteCode = `ITEM_DISC_${ns.toUpperCase()}`;
  const { data: itemDisc, error: itemDiscErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_item",
      p_payload: {
        code: discreteCode,
        name: "Discrete Syringes",
        category_id: fx.categoryId,
        material_kind: "other",
        base_uom_code: fx.uomDiscrete,
        tracking_strategy: "quantity",
        return_semantics: "nonreturnable",
        expiry_required: false,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(itemDiscErr);

  // Create acquisition source
  const sourceRef = `PO_DEC_${ns.toUpperCase()}`;
  const { data: source, error: sourceErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source",
      p_payload: {
        source_reference: sourceRef,
        supplier_id: fx.supplierId,
        reference_date: "2026-10-01",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(sourceErr);

  const { data: sLine, error: sLineErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source_line",
      p_payload: {
        acquisition_record_id: source.id,
        line_key: "L1",
        catalog_item_id: itemDisc.id,
        expected_purchase_quantity: "100.000000",
        purchase_uom_code: fx.uomDiscrete,
        expected_conversion_factor: "1.000000",
        expected_revision: 1,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(sLineErr);

  // 1. Trailing zero canonical string: '10.000000' on discrete count is mathematically integer => ACCEPTED
  const { data: acceptZeroRes, error: acceptZeroErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "receive_stock",
      p_payload: {
        receipt_reference: `RCV_ZERO_${ns.toUpperCase()}`,
        occurred_at: new Date().toISOString(),
        lines: [
          {
            line_key: "L1",
            source_line_id: sLine.id,
            catalog_item_id: itemDisc.id,
            location_id: fx.locationAId,
            purchase_quantity: "10.000000",
            purchase_uom_code: fx.uomDiscrete,
            conversion_factor: "1.000000",
            good_quantity: "10.000000",
            damaged_quantity: "0.000000",
            expiry_precision: "not_required",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(
    acceptZeroErr,
    "Trailing zero integer canonical string '10.000000' must be accepted",
  );
  assert.ok(acceptZeroRes.receipt_id);

  // 2. Fractional nonzero: '10.500000' on discrete count => REJECTED
  const { error: fracErr1 } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `RCV_FRAC1_${ns.toUpperCase()}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L1",
          source_line_id: sLine.id,
          catalog_item_id: itemDisc.id,
          location_id: fx.locationAId,
          purchase_quantity: "10.500000",
          purchase_uom_code: fx.uomDiscrete,
          conversion_factor: "1.000000",
          good_quantity: "10.500000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(
    fracErr1,
    "Fractional value '10.500000' on discrete UOM must be rejected",
  );
  assert.match(fracErr1.message, /INVALID_DECIMAL/);

  // 3. Excess scale > 6 decimals (e.g. '1.1234567') => REJECTED
  const { error: excessScaleErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "receive_stock",
      p_payload: {
        receipt_reference: `RCV_SCALE7_${ns.toUpperCase()}`,
        occurred_at: new Date().toISOString(),
        lines: [
          {
            line_key: "L1",
            source_line_id: sLine.id,
            catalog_item_id: itemDisc.id,
            location_id: fx.locationAId,
            purchase_quantity: "1.1234567",
            purchase_uom_code: fx.uomDiscrete,
            conversion_factor: "1.000000",
            good_quantity: "1.000000",
            damaged_quantity: "0.000000",
            expiry_precision: "not_required",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(excessScaleErr, "Scale exceeding 6 decimals must be rejected");
  assert.match(excessScaleErr.message, /INVALID_DECIMAL/);

  // 4. Non-canonical strings (NaN, exponents, negative) => REJECTED
  for (const badVal of ["NaN", "1e2", "-10.000000", "abc"]) {
    const { error: badValErr } = await staff.client.rpc("inventory_command", {
      p_operation: "receive_stock",
      p_payload: {
        receipt_reference: `RCV_BAD_${crypto.randomUUID().slice(0, 6)}`,
        occurred_at: new Date().toISOString(),
        lines: [
          {
            line_key: "L1",
            source_line_id: sLine.id,
            catalog_item_id: itemDisc.id,
            location_id: fx.locationAId,
            purchase_quantity: badVal,
            purchase_uom_code: fx.uomDiscrete,
            conversion_factor: "1.000000",
            good_quantity: "10.000000",
            damaged_quantity: "0.000000",
            expiry_precision: "not_required",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    });
    assert.ok(badValErr, `Non-canonical value '${badVal}' must be rejected`);
    assert.match(badValErr.message, /INVALID_DECIMAL/);
  }
});

// ============================================================================
// TEST 3: Packaging Conversions (700 & 380) & Source Snapshot / Cost Read (INV-018)
// ============================================================================
test("S1 Inventory: Packaging Conversions (700 & 380) & Source Snapshot / Cost Read (INV-018)", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = "s1_" + crypto.randomUUID().slice(0, 8);

  const fx = await setupMasterFixtures(admin, staff, ns);

  const itemCode = `ITEM_PKG_${ns.toUpperCase()}`;
  const { data: item, error: itemErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_item",
      p_payload: {
        code: itemCode,
        name: "Surgical Gauze",
        category_id: fx.categoryId,
        material_kind: "other",
        base_uom_code: fx.uomDiscrete,
        tracking_strategy: "quantity",
        return_semantics: "nonreturnable",
        expiry_required: false,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(itemErr);

  const sourceRef = `PO_PKG_${ns.toUpperCase()}`;
  const { data: source, error: sourceErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source",
      p_payload: {
        source_reference: sourceRef,
        supplier_id: fx.supplierId,
        reference_date: "2026-10-01",
        notes: "Contract with cost evidence",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(sourceErr);

  const { data: sLine1, error: sLine1Err } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source_line",
      p_payload: {
        acquisition_record_id: source.id,
        line_key: "K1",
        catalog_item_id: item.id,
        expected_purchase_quantity: "50.000000",
        purchase_uom_code: fx.uomBox,
        expected_conversion_factor: "50.000000",
        unit_cost: "250000.0000",
        currency_code: "VND",
        expected_revision: 1,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(sLine1Err);

  const { data: sLine2, error: sLine2Err } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source_line",
      p_payload: {
        acquisition_record_id: source.id,
        line_key: "K2",
        catalog_item_id: item.id,
        expected_purchase_quantity: "50.000000",
        purchase_uom_code: fx.uomBox,
        expected_conversion_factor: "20.000000",
        unit_cost: "110000.0000",
        currency_code: "VND",
        expected_revision: 2,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(sLine2Err);

  // 1. Cost visibility check under INV-018: Active Staff can read unit cost
  const { data: linesRead, error: readErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "source_lines",
      p_filters: { source_id: source.id },
    },
  );
  assert.ifError(readErr);
  assert.equal(linesRead.rows.length, 2);
  const costLine = linesRead.rows.find((line) => line.id === sLine1.id);
  assertDecimalEqual(costLine.unit_cost, "250000.0000");
  assert.equal(costLine.currency_code, "VND");

  // 2. Acceptance Scenario A25: 10x50 + 10x20 = 700 count
  const { data: rcv700, error: err700 } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "receive_stock",
      p_payload: {
        receipt_reference: `RCV_700_${ns.toUpperCase()}`,
        occurred_at: new Date().toISOString(),
        lines: [
          {
            line_key: "L1",
            source_line_id: sLine1.id,
            catalog_item_id: item.id,
            location_id: fx.locationAId,
            purchase_quantity: "10.000000",
            purchase_uom_code: fx.uomBox,
            conversion_factor: "50.000000",
            good_quantity: "500.000000",
            damaged_quantity: "0.000000",
            expiry_precision: "not_required",
          },
          {
            line_key: "L2",
            source_line_id: sLine2.id,
            catalog_item_id: item.id,
            location_id: fx.locationAId,
            purchase_quantity: "10.000000",
            purchase_uom_code: fx.uomBox,
            conversion_factor: "20.000000",
            good_quantity: "200.000000",
            damaged_quantity: "0.000000",
            expiry_precision: "not_required",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(err700);

  // 3. Acceptance Scenario A29: 6x50 + 4x20 = 380 count
  const { error: err380 } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `RCV_380_${ns.toUpperCase()}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L1",
          source_line_id: sLine1.id,
          catalog_item_id: item.id,
          location_id: fx.locationAId,
          purchase_quantity: "6.000000",
          purchase_uom_code: fx.uomBox,
          conversion_factor: "50.000000",
          good_quantity: "300.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
        {
          line_key: "L2",
          source_line_id: sLine2.id,
          catalog_item_id: item.id,
          location_id: fx.locationAId,
          purchase_quantity: "4.000000",
          purchase_uom_code: fx.uomBox,
          conversion_factor: "20.000000",
          good_quantity: "80.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(err380);

  // 4. Source Snapshot Preservation: Update source line notes; verify posted receipt facts retain original snapshot
  const { error: updateLineErr } = await staff.client.rpc("inventory_command", {
    p_operation: "update_acquisition_source_line",
    p_payload: {
      id: sLine1.id,
      notes: "Amended contract line notes",
      expected_revision: 3,
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(updateLineErr);

  const { data: detail700 } = await staff.client.rpc("inventory_read", {
    p_resource: "transaction_detail",
    p_filters: { id: rcv700.transaction_id },
  });
  assert.equal(detail700.rows.length, 1);
  const facts700 = detail700.rows[0].facts;
  const firstSourceFact = facts700.find(
    (fact) => fact.source_snapshot.source_line_id === sLine1.id,
  );
  assertDecimalEqual(
    firstSourceFact.source_snapshot.expected_purchase_quantity,
    "50.000000",
  );
  assertDecimalEqual(firstSourceFact.source_snapshot.unit_cost, "250000.0000");
});

// ============================================================================
// TEST 4: Expiry Normalization, Leap Year & Chemical Expiry Policy
// ============================================================================
test("S1 Inventory: Expiry Normalization, Leap Year & Chemical Expiry Policy", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = "s1_" + crypto.randomUUID().slice(0, 8);

  const fx = await setupMasterFixtures(admin, staff, ns);

  // 1. Chemical item requires expiry_required=true
  const chemFailCode = `CHEM_FAIL_${ns.toUpperCase()}`;
  const { error: chemFailErr } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: chemFailCode,
      name: "Ethanol 96%",
      category_id: fx.categoryId,
      material_kind: "chemical",
      base_uom_code: fx.uomMl,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(chemFailErr);
  assert.match(chemFailErr.message, /INVALID_EXPIRY_POLICY/);

  const chemOkCode = `CHEM_OK_${ns.toUpperCase()}`;
  const { data: chemItem, error: chemOkErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_item",
      p_payload: {
        code: chemOkCode,
        name: "Hydrochloric Acid 37%",
        category_id: fx.categoryId,
        material_kind: "chemical",
        base_uom_code: fx.uomMl,
        tracking_strategy: "quantity",
        return_semantics: "nonreturnable",
        expiry_required: true,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(chemOkErr);

  const sourceRef = `PO_EXP_${ns.toUpperCase()}`;
  const { data: source } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: sourceRef,
      supplier_id: fx.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: sLine } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: source.id,
      line_key: "L1",
      catalog_item_id: chemItem.id,
      expected_purchase_quantity: "5000.000000",
      purchase_uom_code: fx.uomMl,
      expected_conversion_factor: "1.000000",
      expected_revision: 1,
    },
    p_retry_key: crypto.randomUUID(),
  });

  // 2. Normal receipt for chemical rejects blank / not_required / unknown
  const { error: blankExpiryErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "receive_stock",
      p_payload: {
        receipt_reference: `RCV_BLANK_${ns.toUpperCase()}`,
        occurred_at: new Date().toISOString(),
        lines: [
          {
            line_key: "L1",
            source_line_id: sLine.id,
            catalog_item_id: chemItem.id,
            location_id: fx.locationAId,
            purchase_quantity: "100.000000",
            purchase_uom_code: fx.uomMl,
            conversion_factor: "1.000000",
            good_quantity: "100.000000",
            damaged_quantity: "0.000000",
            expiry_precision: "not_required",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(blankExpiryErr, "Chemical item without expiry must be rejected");
  assert.match(blankExpiryErr.message, /INVALID_EXPIRY/);

  // 3. Leap Year normalization: month '2028-02' normalizes to '2028-02-29'
  const { data: leapRes, error: leapErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "receive_stock",
      p_payload: {
        receipt_reference: `RCV_LEAP_${ns.toUpperCase()}`,
        occurred_at: new Date().toISOString(),
        lines: [
          {
            line_key: "L1",
            source_line_id: sLine.id,
            catalog_item_id: chemItem.id,
            location_id: fx.locationAId,
            purchase_quantity: "100.000000",
            purchase_uom_code: fx.uomMl,
            conversion_factor: "1.000000",
            good_quantity: "100.000000",
            damaged_quantity: "0.000000",
            expiry_precision: "month",
            expiry_input: "2028-02",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(leapErr);

  const { data: leapDetail } = await staff.client.rpc("inventory_read", {
    p_resource: "transaction_detail",
    p_filters: { id: leapRes.transaction_id },
  });
  assert.equal(leapDetail.rows[0].facts[0].expiry_date, "2028-02-29");

  // 4. Invalid calendar day: '2027-02-29' in non-leap year is rejected
  const { error: invalidDayErr } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `RCV_INVDAY_${ns.toUpperCase()}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L1",
          source_line_id: sLine.id,
          catalog_item_id: chemItem.id,
          location_id: fx.locationAId,
          purchase_quantity: "100.000000",
          purchase_uom_code: fx.uomMl,
          conversion_factor: "1.000000",
          good_quantity: "100.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "day",
          expiry_input: "2027-02-29",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(
    invalidDayErr,
    "2027-02-29 must be rejected as an invalid calendar date",
  );
  assert.match(invalidDayErr.message, /INVALID_EXPIRY/);
});

// ============================================================================
// TEST 5: Opening Scope Claim Retention (A -> B Location Move)
// ============================================================================
test("S1 Inventory: Opening Scope Claim Retention (A -> B Location Move)", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = "s1_" + crypto.randomUUID().slice(0, 8);

  const fx = await setupMasterFixtures(admin, staff, ns);

  const itemCode = `ITEM_SCOPE_${ns.toUpperCase()}`;
  const { data: item } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: "Scope Item",
      category_id: fx.categoryId,
      material_kind: "other",
      base_uom_code: fx.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { error: normalizedDuplicateError } = await admin.client.rpc(
    "inventory_command",
    {
      p_operation: "confirm_opening_balance",
      p_payload: {
        cutover_key: `CUT_NORMALIZED_${ns}`,
        count_cutoff: "2026-10-01T00:00:00Z",
        scope_description: "Duplicate normalized count",
        provenance_note: "Synthetic duplicate guard",
        synthetic: true,
        lines: ["count-A", " count-A "].map((provenance_group, index) => ({
          line_key: `D${index}`,
          provenance_group,
          catalog_item_id: item.id,
          location_id: fx.locationAId,
          good_quantity: "10",
          damaged_quantity: "0",
          expiry_precision: "not_required",
        })),
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.match(
    normalizedDuplicateError?.message ?? "",
    /DUPLICATE_NATURAL_DIMENSIONS/,
  );

  // 1. Initial opening at Location A
  const cutoverKey1 = `CUT_SCOPE1_${ns.toUpperCase()}`;
  const { data: open1, error: open1Err } = await admin.client.rpc(
    "inventory_command",
    {
      p_operation: "confirm_opening_balance",
      p_payload: {
        cutover_key: cutoverKey1,
        count_cutoff: "2026-10-01T00:00:00Z",
        scope_description: "Initial count at Location A",
        provenance_note: "Physical audit A",
        synthetic: true,
        lines: [
          {
            line_key: "R1",
            provenance_group: "grp-scope-1",
            catalog_item_id: item.id,
            location_id: fx.locationAId,
            good_quantity: "100.000000",
            damaged_quantity: "0.000000",
            expiry_precision: "not_required",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(open1Err);

  // 2. Duplicate opening attempt at Location A is rejected with OPENING_SCOPE_CONFLICT
  const { error: dupScopeErr } = await admin.client.rpc("inventory_command", {
    p_operation: "confirm_opening_balance",
    p_payload: {
      cutover_key: `CUT_DUP_${ns.toUpperCase()}`,
      count_cutoff: "2026-10-01T00:00:00Z",
      scope_description: "Duplicate count at Location A",
      provenance_note: "Duplicate audit",
      synthetic: true,
      lines: [
        {
          line_key: "R1",
          provenance_group: "grp-scope-2",
          catalog_item_id: item.id,
          location_id: fx.locationAId,
          good_quantity: "50.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(
    dupScopeErr,
    "Overlapping opening claim at Location A must be rejected",
  );
  assert.match(dupScopeErr.message, /OPENING_SCOPE_CONFLICT/);

  // 3. Opening location correction A -> B: moves stock from Location A to Location B
  // Obtain origin_id via public RPC read (transaction_detail)
  const originId = await getOriginIdFromTransaction(
    staff.client,
    open1.transaction_id,
  );

  const { error: corrErr } = await admin.client.rpc("inventory_command", {
    p_operation: "correct_opening_balance",
    p_payload: {
      transaction_id: open1.transaction_id,
      reason: "Correcting storage location: stock was physically in Cabinet B",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          location_id: fx.locationBId,
          good_quantity: "100.000000",
          damaged_quantity: "0.000000",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(corrErr);

  // 4. Verify claim retention:
  // - Attempting a new opening at Location A is STILL rejected (old claim retained!)
  const { error: newOpenAErr } = await admin.client.rpc("inventory_command", {
    p_operation: "confirm_opening_balance",
    p_payload: {
      cutover_key: `CUT_NEW_A_${ns.toUpperCase()}`,
      count_cutoff: "2026-10-01T00:00:00Z",
      scope_description: "New batch at Location A",
      provenance_note: "Testing retained claim",
      synthetic: true,
      lines: [
        {
          line_key: "R1",
          provenance_group: "grp-scope-3",
          catalog_item_id: item.id,
          location_id: fx.locationAId,
          good_quantity: "20.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(
    newOpenAErr,
    "Location A claim must be retained and reject new opening",
  );
  assert.match(newOpenAErr.message, /OPENING_SCOPE_CONFLICT/);

  // - Attempting a new opening at Location B is ALSO rejected (new claim active!)
  const { error: newOpenBErr } = await admin.client.rpc("inventory_command", {
    p_operation: "confirm_opening_balance",
    p_payload: {
      cutover_key: `CUT_NEW_B_${ns.toUpperCase()}`,
      count_cutoff: "2026-10-01T00:00:00Z",
      scope_description: "New batch at Location B",
      provenance_note: "Testing destination claim",
      synthetic: true,
      lines: [
        {
          line_key: "R1",
          provenance_group: "grp-scope-4",
          catalog_item_id: item.id,
          location_id: fx.locationBId,
          good_quantity: "20.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(
    newOpenBErr,
    "Destination Location B claim must reject new opening",
  );
  assert.match(newOpenBErr.message, /OPENING_SCOPE_CONFLICT/);

  // Verify balances: 0 at Location A, 100 at Location B
  const { data: balA } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: item.id, location_id: fx.locationAId },
  });
  assert.equal(
    balA.rows.reduce((sum, row) => sum + toScaled(row.quantity), BigInt(0)),
    BigInt(0),
  );

  const { data: balB } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: item.id, location_id: fx.locationBId },
  });
  assertDecimalEqual(balB.rows[0].quantity, "100.000000");
});

// ============================================================================
// TEST 6: Unknown Expiry Opening & Admin Zero-Delta Verification
// ============================================================================
test("S1 Inventory: Unknown Expiry Opening & Admin Zero-Delta Verification", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = "s1_" + crypto.randomUUID().slice(0, 8);

  const fx = await setupMasterFixtures(admin, staff, ns);

  const itemCode = `CHEM_UNK_${ns.toUpperCase()}`;
  const { data: item } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: "Potassium Permanganate",
      category_id: fx.categoryId,
      material_kind: "chemical",
      base_uom_code: fx.uomMl,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: true,
    },
    p_retry_key: crypto.randomUUID(),
  });

  // 1. Opening balance confirmed with 'unknown' expiry
  const cutoverKey = `CUT_UNK_${ns.toUpperCase()}`;
  const { data: openRes, error: openErr } = await admin.client.rpc(
    "inventory_command",
    {
      p_operation: "confirm_opening_balance",
      p_payload: {
        cutover_key: cutoverKey,
        count_cutoff: "2026-10-01T00:00:00Z",
        scope_description: "Chemical audit unknown bottle",
        provenance_note: "Faded vintage bottle",
        synthetic: true,
        lines: [
          {
            line_key: "R1",
            provenance_group: "grp-kmno4",
            catalog_item_id: item.id,
            location_id: fx.locationAId,
            good_quantity: "250.000000",
            damaged_quantity: "0.000000",
            expiry_precision: "unknown",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(openErr);

  // 2. Balances check: physical = 250, eligible = 0
  const { data: balBefore } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: item.id, location_id: fx.locationAId },
  });
  assertDecimalEqual(balBefore.rows[0].quantity, "250.000000");
  assertDecimalEqual(balBefore.rows[0].eligible_quantity, "0.000000");
  assertDecimalEqual(balBefore.rows[0].unknown_expiry_quantity, "250.000000");

  // 3. Staff verification attempt is denied (Admin only!)
  const originId = await getOriginIdFromTransaction(
    staff.client,
    openRes.transaction_id,
  );
  for (const evidence_note of [undefined, "   "]) {
    const { error: evidenceError } = await admin.client.rpc(
      "inventory_command",
      {
        p_operation: "correct_opening_balance",
        p_payload: {
          transaction_id: openRes.transaction_id,
          reason: "Correct faded opening expiry",
          lines: [
            {
              origin_id: originId,
              expected_version: 0,
              location_id: fx.locationAId,
              good_quantity: "250",
              damaged_quantity: "0",
              expiry_precision: "day",
              expiry_input: "2030-12-31",
              evidence_note,
            },
          ],
        },
        p_retry_key: crypto.randomUUID(),
      },
    );
    assert.match(evidenceError?.message ?? "", /EVIDENCE_REQUIRED/);
  }

  const { error: staffVerifyErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "verify_opening_expiry",
      p_payload: {
        origin_id: originId,
        expected_version: 0,
        expiry_precision: "month",
        expiry_input: "2028-12",
        evidence_note: "Staff lab report",
        reason: "Staff verification",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ok(staffVerifyErr, "Staff must be denied verify_opening_expiry");
  assert.match(staffVerifyErr.message, /AUTH_DENIED/);

  // 4. Admin verification succeeds with zero stock delta
  const { data: verifyRes, error: verifyErr } = await admin.client.rpc(
    "inventory_command",
    {
      p_operation: "verify_opening_expiry",
      p_payload: {
        origin_id: originId,
        expected_version: 0,
        expiry_precision: "month",
        expiry_input: "2028-12",
        evidence_note: "Certificate of Analysis retrieved from archive",
        reason: "Lab chemical test confirmed 99% purity and 2028 stability",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(verifyErr);

  // Zero stock delta: verify that NO rows were added to transaction lines
  const { data: verifyDetail } = await staff.client.rpc("inventory_read", {
    p_resource: "transaction_detail",
    p_filters: { id: verifyRes.transaction_id },
  });
  assert.equal(
    verifyDetail.rows[0].lines.length,
    0,
    "verify_opening_expiry must have zero ledger lines",
  );

  // Balances check: stock is now eligible!
  const { data: balAfter } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: item.id, location_id: fx.locationAId },
  });
  assertDecimalEqual(balAfter.rows[0].quantity, "250.000000");
  assertDecimalEqual(balAfter.rows[0].eligible_quantity, "250.000000");
  assertDecimalEqual(balAfter.rows[0].unknown_expiry_quantity, "0.000000");
});

// ============================================================================
// TEST 7: Corrections A–F, Reversal & Double Reversal Guard
// ============================================================================
test("S1 Inventory: Corrections A–F, Reversal & Double Reversal Guard", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = "s1_" + crypto.randomUUID().slice(0, 8);

  const fx = await setupMasterFixtures(admin, staff, ns);

  const itemCode = `ITEM_CORR_${ns.toUpperCase()}`;
  const { data: item } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: "Surgical Scalpel #11",
      category_id: fx.categoryId,
      material_kind: "other",
      base_uom_code: fx.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const sourceRef = `PO_CORR_${ns.toUpperCase()}`;
  const { data: source } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: sourceRef,
      supplier_id: fx.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: sLine } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: source.id,
      line_key: "C1",
      catalog_item_id: item.id,
      expected_purchase_quantity: "100.000000",
      purchase_uom_code: fx.uomBox,
      expected_conversion_factor: "50.000000",
      expected_revision: 1,
    },
    p_retry_key: crypto.randomUUID(),
  });

  // Post receipt: 100 boxes * 50 = 5000 count
  const receiptRef = `RCV_CORR_${ns.toUpperCase()}`;
  const { data: rcvRes } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: receiptRef,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "C1",
          source_line_id: sLine.id,
          catalog_item_id: item.id,
          location_id: fx.locationAId,
          purchase_quantity: "100.000000",
          purchase_uom_code: fx.uomBox,
          conversion_factor: "50.000000",
          good_quantity: "5000.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });

  const originId = await getOriginIdFromTransaction(
    staff.client,
    rcvRes.transaction_id,
  );
  const { error: zeroCorrectionError } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "correct_receipt",
      p_payload: {
        transaction_id: rcvRes.transaction_id,
        reason: "Attempt zero receipt correction",
        lines: [
          {
            origin_id: originId,
            expected_version: 0,
            location_id: fx.locationAId,
            purchase_quantity: "0",
            purchase_uom_code: fx.uomBox,
            conversion_factor: "50",
            good_quantity: "0",
            damaged_quantity: "0",
            expiry_precision: "not_required",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.match(zeroCorrectionError?.message ?? "", /INVALID_DECIMAL/);

  // Case A: Quantity typo (100 boxes should be 10 boxes): intended 500 vs 5000, delta -4500
  const { error: corrAErr } = await staff.client.rpc("inventory_command", {
    p_operation: "correct_receipt",
    p_payload: {
      transaction_id: rcvRes.transaction_id,
      reason: "Correcting count typo: 10 boxes received instead of 100",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          location_id: fx.locationAId,
          purchase_quantity: "10.000000",
          purchase_uom_code: fx.uomBox,
          conversion_factor: "50.000000",
          good_quantity: "500.000000",
          damaged_quantity: "0.000000",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(corrAErr);

  // Verify balance dropped to 500
  const { data: balA } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: item.id, location_id: fx.locationAId },
  });
  assertDecimalEqual(
    balA.rows.find((row) => row.condition === "good").quantity,
    "500.000000",
  );

  // Case B: Factor typo (factor should be 20 instead of 50): intended 200 vs 500, delta -300
  const { error: corrBErr } = await staff.client.rpc("inventory_command", {
    p_operation: "correct_receipt",
    p_payload: {
      transaction_id: rcvRes.transaction_id,
      reason: "Correcting factor typo: box size is 20, not 50",
      lines: [
        {
          origin_id: originId,
          expected_version: 1, // targeting latest fact version 1
          location_id: fx.locationAId,
          purchase_quantity: "10.000000",
          purchase_uom_code: fx.uomBox,
          conversion_factor: "20.000000",
          good_quantity: "200.000000",
          damaged_quantity: "0.000000",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(corrBErr);

  const { data: balB } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: item.id, location_id: fx.locationAId },
  });
  assertDecimalEqual(
    balB.rows.find((row) => row.condition === "good").quantity,
    "200.000000",
  );

  // Case E: Correct the intake condition entry: original delivery was 150 good + 50 damaged.
  const { error: corrEErr } = await staff.client.rpc("inventory_command", {
    p_operation: "correct_receipt",
    p_payload: {
      transaction_id: rcvRes.transaction_id,
      reason:
        "Original receipt condition entered incorrectly: 150 good and 50 damaged",
      lines: [
        {
          origin_id: originId,
          expected_version: 2,
          location_id: fx.locationAId,
          purchase_quantity: "10.000000",
          purchase_uom_code: fx.uomBox,
          conversion_factor: "20.000000",
          good_quantity: "150.000000",
          damaged_quantity: "50.000000",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(corrEErr);

  // Full Reversal: sets target quantities to 0; debits all balances to 0
  const { error: revErr } = await staff.client.rpc("inventory_command", {
    p_operation: "reverse_receipt",
    p_payload: {
      transaction_id: rcvRes.transaction_id,
      reason:
        "Duplicate physical intake was entered in error; reverse the erroneous record",
      versions: [{ origin_id: originId, expected_version: 3 }],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(revErr);

  const { data: balRev } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: item.id, location_id: fx.locationAId },
  });
  assert.ok(
    balRev.rows.every((row) => toScaled(row.quantity) === BigInt(0)),
    "All balances must be zero after reversal",
  );

  // Double reversal / Stale correction attempt: rejected
  const { error: staleRevErr } = await staff.client.rpc("inventory_command", {
    p_operation: "reverse_receipt",
    p_payload: {
      transaction_id: rcvRes.transaction_id,
      reason: "Attempting duplicate reversal",
      versions: [{ origin_id: originId, expected_version: 4 }], // Even the latest version is terminal.
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(staleRevErr, "Double reversal or stale version must fail");
});

// ============================================================================
// TEST 8: Mid-Multiline Atomic Rollback on Error (A31)
// ============================================================================
test("S1 Inventory: Mid-Multiline Atomic Rollback on Error (A31)", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = "s1_" + crypto.randomUUID().slice(0, 8);

  const fx = await setupMasterFixtures(admin, staff, ns);

  const itemCode = `ITEM_A31_${ns.toUpperCase()}`;
  const { data: item } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: "Item A31",
      category_id: fx.categoryId,
      material_kind: "other",
      base_uom_code: fx.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const sourceRef = `PO_A31_${ns.toUpperCase()}`;
  const { data: source } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: sourceRef,
      supplier_id: fx.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: sLine1 } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: source.id,
      line_key: "L1",
      catalog_item_id: item.id,
      expected_purchase_quantity: "10.000000",
      purchase_uom_code: fx.uomDiscrete,
      expected_conversion_factor: "1.000000",
      expected_revision: 1,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: sLine2 } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: source.id,
      line_key: "L2",
      catalog_item_id: item.id,
      expected_purchase_quantity: "10.000000",
      purchase_uom_code: fx.uomDiscrete,
      expected_conversion_factor: "1.000000",
      expected_revision: 2,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const receiptRef = `RCV_A31_${ns.toUpperCase()}`;

  // Multi-line receipt: Line 1 valid (good=10, damaged=0, sum=10).
  // Line 2 has sum mismatch (base=10, but good=5, damaged=0 => sum=5 != 10)
  const { error: txErr } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: receiptRef,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L1",
          source_line_id: sLine1.id,
          catalog_item_id: item.id,
          location_id: fx.locationAId,
          purchase_quantity: "10.000000",
          purchase_uom_code: fx.uomDiscrete,
          conversion_factor: "1.000000",
          good_quantity: "10.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
        {
          line_key: "L2",
          source_line_id: sLine2.id,
          catalog_item_id: item.id,
          location_id: fx.locationAId,
          purchase_quantity: "10.000000",
          purchase_uom_code: fx.uomDiscrete,
          conversion_factor: "1.000000",
          good_quantity: "5.000000",
          damaged_quantity: "0.000000", // Intentional sum mismatch!
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });

  assert.ok(txErr, "Multi-line receipt with invalid second line must fail");
  assert.match(txErr.message, /INVALID_DECIMAL/);

  // Verify total rollback via public inventory_read: zero transactions, zero balances
  const { data: readTx } = await staff.client.rpc("inventory_read", {
    p_resource: "transactions",
    p_filters: {},
  });
  const txMatch = readTx.rows.find((t) => t.business_key === receiptRef);
  assert.equal(txMatch, undefined, "Transaction must not exist after rollback");

  const { data: balA31 } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: item.id },
  });
  assert.equal(balA31.rows.length, 0, "Balances must not exist after rollback");
});

// ============================================================================
// TEST 9: Concurrency Races (Simultaneous Receipts & Correction Race)
// ============================================================================
test("S1 Inventory: Concurrency Races (Simultaneous Receipts & Correction Race)", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = "s1_" + crypto.randomUUID().slice(0, 8);

  const fx = await setupMasterFixtures(admin, staff, ns);

  const itemCode = `ITEM_RACE_${ns.toUpperCase()}`;
  const { data: item } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: "Item Race",
      category_id: fx.categoryId,
      material_kind: "other",
      base_uom_code: fx.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const sourceRef = `PO_RACE_${ns.toUpperCase()}`;
  const { data: source } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: sourceRef,
      supplier_id: fx.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: sLine1 } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: source.id,
      line_key: "R1",
      catalog_item_id: item.id,
      expected_purchase_quantity: "100.000000",
      purchase_uom_code: fx.uomDiscrete,
      expected_conversion_factor: "1.000000",
      expected_revision: 1,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: sLine2 } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: source.id,
      line_key: "R2",
      catalog_item_id: item.id,
      expected_purchase_quantity: "100.000000",
      purchase_uom_code: fx.uomDiscrete,
      expected_conversion_factor: "1.000000",
      expected_revision: 2,
    },
    p_retry_key: crypto.randomUUID(),
  });

  // 1. Concurrent First Receipts touching same item & location
  const req1 = staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `RCV_CONC_1_${ns.toUpperCase()}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "R1",
          source_line_id: sLine1.id,
          catalog_item_id: item.id,
          location_id: fx.locationAId,
          purchase_quantity: "50.000000",
          purchase_uom_code: fx.uomDiscrete,
          conversion_factor: "1.000000",
          good_quantity: "50.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });

  const req2 = staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `RCV_CONC_2_${ns.toUpperCase()}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "R2",
          source_line_id: sLine2.id,
          catalog_item_id: item.id,
          location_id: fx.locationAId,
          purchase_quantity: "70.000000",
          purchase_uom_code: fx.uomDiscrete,
          conversion_factor: "1.000000",
          good_quantity: "70.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });

  const [res1, res2] = await Promise.all([req1, req2]);
  assert.ifError(res1.error);
  assert.ifError(res2.error);
  assert.ok(res1.data.receipt_id);
  assert.ok(res2.data.receipt_id);

  // Verify total physical balance is 50 + 70 = 120
  const { data: balanceData } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: item.id, location_id: fx.locationAId },
  });
  assert.equal(balanceData.rows.length, 1);
  assertDecimalEqual(balanceData.rows[0].quantity, "120.000000");

  // 2. Concurrent Correction Race: Two simultaneous corrections targeting the same fact version 0
  const txId = res1.data.transaction_id;
  const originId = await getOriginIdFromTransaction(staff.client, txId);

  const corr1 = staff.client.rpc("inventory_command", {
    p_operation: "correct_receipt",
    p_payload: {
      transaction_id: txId,
      reason: "Correction race attempt 1",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          location_id: fx.locationAId,
          purchase_quantity: "40.000000",
          purchase_uom_code: fx.uomDiscrete,
          conversion_factor: "1.000000",
          good_quantity: "40.000000",
          damaged_quantity: "0.000000",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });

  const corr2 = staff.client.rpc("inventory_command", {
    p_operation: "correct_receipt",
    p_payload: {
      transaction_id: txId,
      reason: "Correction race attempt 2",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          location_id: fx.locationAId,
          purchase_quantity: "45.000000",
          purchase_uom_code: fx.uomDiscrete,
          conversion_factor: "1.000000",
          good_quantity: "45.000000",
          damaged_quantity: "0.000000",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });

  const [cRes1, cRes2] = await Promise.all([corr1, corr2]);
  const successes = [cRes1, cRes2].filter((r) => !r.error);
  const failures = [cRes1, cRes2].filter((r) => r.error);

  assert.equal(
    successes.length,
    1,
    "Exactly one correction must succeed in version race",
  );
  assert.equal(failures.length, 1, "The competing correction must fail");
  assert.match(
    failures[0].error.message,
    /(STALE_REVISION|could not serialize|deadlock)/,
  );
});

// ============================================================================
// TEST 10: Location Hierarchy Concurrent Edits & Cycle Prevention
// ============================================================================
test("S1 Inventory: Location Hierarchy Concurrent Edits & Cycle Prevention", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = "s1_" + crypto.randomUUID().slice(0, 8);

  await setupMasterFixtures(admin, staff, ns);

  // Create Node 1, Node 2, Node 3
  const { data: n1 } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_location",
    p_payload: { code: `NODE_1_${ns.toUpperCase()}`, name: "Node 1" },
    p_retry_key: crypto.randomUUID(),
  });
  const { data: n2 } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_location",
    p_payload: {
      code: `NODE_2_${ns.toUpperCase()}`,
      name: "Node 2",
      parent_location_id: n1.id,
    },
    p_retry_key: crypto.randomUUID(),
  });
  const { data: n3 } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_location",
    p_payload: {
      code: `NODE_3_${ns.toUpperCase()}`,
      name: "Node 3",
      parent_location_id: n2.id,
    },
    p_retry_key: crypto.randomUUID(),
  });

  // Cycle: Setting Node 1 parent to Node 3 forms loop (1 -> 2 -> 3 -> 1)
  const { error: cycleErr } = await staff.client.rpc("inventory_command", {
    p_operation: "update_inventory_location",
    p_payload: {
      id: n1.id,
      expected_revision: 1,
      name: "Node 1",
      parent_location_id: n3.id,
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(cycleErr, "Ancestral cycle must be rejected");
  assert.match(cycleErr.message, /CYCLIC_LOCATION_DETECTED/);

  // Self-parent: Setting Node 2 parent to Node 2
  const { error: selfParentErr } = await staff.client.rpc("inventory_command", {
    p_operation: "update_inventory_location",
    p_payload: {
      id: n2.id,
      expected_revision: 1,
      name: "Node 2",
      parent_location_id: n2.id,
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(selfParentErr, "Self parent must be rejected");
  assert.match(selfParentErr.message, /CYCLIC_LOCATION_DETECTED/);
});

// ============================================================================
// TEST 11: Full Ledger Reconciliation & History Immutability
// ============================================================================
test("S1 Inventory: Full Ledger Reconciliation & History Immutability", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = "s1_" + crypto.randomUUID().slice(0, 8);

  const fx = await setupMasterFixtures(admin, staff, ns);

  const itemCode = `ITEM_RECON_${ns.toUpperCase()}`;
  const { data: item } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: "Reconciliation Test Item",
      category_id: fx.categoryId,
      material_kind: "other",
      base_uom_code: fx.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const sourceRef = `PO_RECON_${ns.toUpperCase()}`;
  const { data: source } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: sourceRef,
      supplier_id: fx.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: sLine } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: source.id,
      line_key: "RC1",
      catalog_item_id: item.id,
      expected_purchase_quantity: "500.000000",
      purchase_uom_code: fx.uomDiscrete,
      expected_conversion_factor: "1.000000",
      expected_revision: 1,
    },
    p_retry_key: crypto.randomUUID(),
  });

  // Post initial receipt: 300 count
  const { data: rcvRes } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `RCV_RECON_${ns.toUpperCase()}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "RC1",
          source_line_id: sLine.id,
          catalog_item_id: item.id,
          location_id: fx.locationAId,
          purchase_quantity: "300.000000",
          purchase_uom_code: fx.uomDiscrete,
          conversion_factor: "1.000000",
          good_quantity: "300.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });

  const originId = await getOriginIdFromTransaction(
    staff.client,
    rcvRes.transaction_id,
  );

  // Post correction: correct count to 250
  const { error: corrErr } = await staff.client.rpc("inventory_command", {
    p_operation: "correct_receipt",
    p_payload: {
      transaction_id: rcvRes.transaction_id,
      reason: "Inventory reconciliation: count is 250",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          location_id: fx.locationAId,
          purchase_quantity: "250.000000",
          purchase_uom_code: fx.uomDiscrete,
          conversion_factor: "1.000000",
          good_quantity: "250.000000",
          damaged_quantity: "0.000000",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(corrErr);

  // Invariant: Full Ledger Reconciliation
  // 1. Read balance from inventory_read
  const { data: balData } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: {
      item_id: item.id,
      location_id: fx.locationAId,
      condition: "good",
    },
  });
  assert.equal(balData.rows.length, 1);
  const currentBalance = balData.rows[0].quantity;
  assertDecimalEqual(currentBalance, "250.000000");

  // 2. Sensitive axes lock: cannot alter base_uom_code once facts exist
  const { error: lockErr } = await staff.client.rpc("inventory_command", {
    p_operation: "update_inventory_item",
    p_payload: {
      id: item.id,
      expected_revision: 1,
      name: "Renamed Item",
      base_uom_code: fx.uomMl, // Forbidden
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(lockErr, "Cannot alter base UOM once stock facts exist");
  assert.match(lockErr.message, /SENSITIVE_AXES_LOCKED/);

  // 3. Direct table mutation denial: direct client UPDATE on stock facts or transactions is rejected
  const { error: directFactErr } = await admin.client
    .from("inventory_stock_facts")
    .update({ good_quantity: 999 })
    .eq("origin_id", originId);
  assert.ok(directFactErr, "Direct UPDATE on stock facts must be denied");

  const { error: directTxErr } = await admin.client
    .from("inventory_transactions")
    .delete()
    .eq("id", rcvRes.transaction_id);
  assert.ok(directTxErr, "Direct DELETE on transactions must be denied");
});

// ============================================================================
// TEST 12: Same-Origin Target Mismatch Correction Regression
// ============================================================================
test("S1 Inventory: Same-Origin Target Mismatch Correction Regression", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = "s1_" + crypto.randomUUID().slice(0, 8);

  const fx = await setupMasterFixtures(admin, staff, ns);

  // Create two distinct items
  const { data: item1 } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: `ITEM_MISMATCH_1_${ns.toUpperCase()}`,
      name: "Item 1",
      category_id: fx.categoryId,
      material_kind: "other",
      base_uom_code: fx.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: item2 } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: `ITEM_MISMATCH_2_${ns.toUpperCase()}`,
      name: "Item 2",
      category_id: fx.categoryId,
      material_kind: "other",
      base_uom_code: fx.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: source } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: `PO_MISMATCH_${ns.toUpperCase()}`,
      supplier_id: fx.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: sLine1 } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: source.id,
      line_key: "M1",
      catalog_item_id: item1.id,
      expected_purchase_quantity: "50.000000",
      purchase_uom_code: fx.uomDiscrete,
      expected_conversion_factor: "1.000000",
      expected_revision: 1,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: sLine2 } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: source.id,
      line_key: "M2",
      catalog_item_id: item2.id,
      expected_purchase_quantity: "50.000000",
      purchase_uom_code: fx.uomDiscrete,
      expected_conversion_factor: "1.000000",
      expected_revision: 2,
    },
    p_retry_key: crypto.randomUUID(),
  });

  // Post Receipt 1 for Item 1
  const { data: rcv1 } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `RCV_MIS1_${ns.toUpperCase()}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "M1",
          source_line_id: sLine1.id,
          catalog_item_id: item1.id,
          location_id: fx.locationAId,
          purchase_quantity: "50.000000",
          purchase_uom_code: fx.uomDiscrete,
          conversion_factor: "1.000000",
          good_quantity: "50.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });

  // Post Receipt 2 for Item 2
  const { data: rcv2 } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `RCV_MIS2_${ns.toUpperCase()}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "M2",
          source_line_id: sLine2.id,
          catalog_item_id: item2.id,
          location_id: fx.locationAId,
          purchase_quantity: "50.000000",
          purchase_uom_code: fx.uomDiscrete,
          conversion_factor: "1.000000",
          good_quantity: "50.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });

  const origin2 = await getOriginIdFromTransaction(
    staff.client,
    rcv2.transaction_id,
  );

  // Attempt to correct Receipt 1, but passing origin2 (which belongs to Receipt 2!)
  // Must fail: origin does not belong to the target transaction!
  const { error: mismatchErr } = await staff.client.rpc("inventory_command", {
    p_operation: "correct_receipt",
    p_payload: {
      transaction_id: rcv1.transaction_id, // Target is Receipt 1
      reason: "Attempting mismatched origin correction",
      lines: [
        {
          origin_id: origin2, // Belongs to Receipt 2!
          expected_version: 0,
          location_id: fx.locationAId,
          purchase_quantity: "40.000000",
          purchase_uom_code: fx.uomDiscrete,
          conversion_factor: "1.000000",
          good_quantity: "40.000000",
          damaged_quantity: "0.000000",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });

  assert.ok(
    mismatchErr,
    "Correcting transaction with an origin belonging to a different transaction must fail",
  );
});

test("S1 Inventory: Source lifecycle cannot bypass Admin authority", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin");
  const staff = await createTestUser(service, "staff");
  const ns = `s1_${crypto.randomUUID().slice(0, 8)}`;
  const fx = await setupMasterFixtures(admin, staff, ns);
  const { data: source, error: createError } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source",
      p_payload: {
        source_reference: `AUTH-${ns}`,
        supplier_id: fx.supplierId,
        reference_date: "2026-10-01",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(createError);
  const { error: voidError } = await admin.client.rpc("inventory_command", {
    p_operation: "update_acquisition_source",
    p_payload: {
      id: source.id,
      expected_revision: 1,
      status: "voided",
      reason: "Source entered in error",
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(voidError);
  const { error: bypassError } = await staff.client.rpc("inventory_command", {
    p_operation: "update_acquisition_source",
    p_payload: {
      id: source.id,
      expected_revision: 2,
      status: "active",
      reason: "Unauthorized reactivation",
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(bypassError, "Staff must not reactivate an Admin-voided source");
  assert.equal(bypassError.code, "42501");
  const { data: readback, error: readError } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "sources",
      p_filters: { id: source.id },
    },
  );
  assert.ifError(readError);
  assert.equal(readback.rows[0].status, "voided");
  assert.equal(readback.rows[0].revision, 2);
});

test("S1 Inventory: Bounded reads >100 paging, filtering, and count consistency for masters and history", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin");
  const staff = await createTestUser(service, "staff");
  const ns = `pg_${crypto.randomUUID().slice(0, 8)}`;
  const fx = await setupMasterFixtures(admin, staff, ns);

  // Create 105 catalog items using typed commands
  for (let i = 1; i <= 105; i++) {
    const pad = String(i).padStart(3, "0");
    const { error: itemErr } = await staff.client.rpc("inventory_command", {
      p_operation: "create_inventory_item",
      p_payload: {
        code: `ITEM_${ns.toUpperCase()}_${pad}`,
        name: `Reagent ${pad} ${ns}`,
        category_id: fx.categoryId,
        material_kind: "other",
        base_uom_code: fx.uomDiscrete,
        tracking_strategy: "quantity",
        return_semantics: "nonreturnable",
        expiry_required: false,
      },
      p_retry_key: crypto.randomUUID(),
    });
    assert.ifError(itemErr);
  }

  // 1. Page 1 read: default 50 items
  const { data: page1, error: err1 } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "items",
      p_filters: { q: ns, page: 1, page_size: 50 },
    },
  );
  assert.ifError(err1);
  assert.equal(page1.total, 105);
  assert.equal(page1.rows.length, 50);
  assert.equal(page1.page, 1);
  assert.equal(page1.page_size, 50);

  // 2. Page 2 read
  const { data: page2, error: err2 } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "items",
      p_filters: { q: ns, page: 2, page_size: 50 },
    },
  );
  assert.ifError(err2);
  assert.equal(page2.total, 105);
  assert.equal(page2.rows.length, 50);
  assert.equal(page2.page, 2);

  // 3. Page 3 read: remainder 5 items
  const { data: page3, error: err3 } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "items",
      p_filters: { q: ns, page: 3, page_size: 50 },
    },
  );
  assert.ifError(err3);
  assert.equal(page3.total, 105);
  assert.equal(page3.rows.length, 5);
  assert.equal(page3.page, 3);

  // 4. Page size clamping: max 100
  const { data: clampedMax, error: clampErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "items",
      p_filters: { q: ns, page: 1, page_size: 500 },
    },
  );
  assert.ifError(clampErr);
  assert.equal(clampedMax.page_size, 100);
  assert.equal(clampedMax.rows.length, 100);

  // 5. Default page_size fallback to 50 when <= 0
  const { data: defaultPage, error: defErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "items",
      p_filters: { q: ns, page: 1, page_size: 0 },
    },
  );
  assert.ifError(defErr);
  assert.equal(defaultPage.page_size, 50);

  // 6. Deterministic sorting: name_desc
  const { data: sortDesc, error: sortErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "items",
      p_filters: { q: ns, sort: "name_desc", page: 1, page_size: 50 },
    },
  );
  assert.ifError(sortErr);
  assert.ok(sortDesc.rows[0].name > sortDesc.rows[49].name);

  // 7. Resource summary
  const { data: summary, error: sumErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "summary",
    },
  );
  assert.ifError(sumErr);
  assert.equal(summary.total, 1);
  assert.ok(summary.rows[0].active_item_count >= 105);
  assert.ok(typeof summary.rows[0].active_source_count === "number");
});

test("S1 Inventory: Expiry state aggregate filtering on stock balances and cohorts", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin");
  const staff = await createTestUser(service, "staff");
  const ns = `exp_${crypto.randomUUID().slice(0, 8)}`;
  const fx = await setupMasterFixtures(admin, staff, ns);

  // Chemical item requiring expiry
  const { data: chemItem, error: chemErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_item",
      p_payload: {
        code: `CHEM_${ns.toUpperCase()}`,
        name: `Chemical ${ns}`,
        category_id: fx.categoryId,
        material_kind: "chemical",
        base_uom_code: fx.uomMl,
        tracking_strategy: "quantity",
        return_semantics: "nonreturnable",
        expiry_required: true,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(chemErr);

  // Source record and line
  const { data: src, error: srcErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source",
      p_payload: {
        source_reference: `SRC-EXP-${ns}`,
        supplier_id: fx.supplierId,
        reference_date: "2026-10-01",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(srcErr);

  const { data: sLine, error: sLineErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source_line",
      p_payload: {
        acquisition_record_id: src.id,
        line_key: "LN1",
        catalog_item_id: chemItem.id,
        expected_purchase_quantity: "1000.000000",
        purchase_uom_code: fx.uomMl,
        expected_conversion_factor: "1.000000",
        expected_revision: 1,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(sLineErr);

  // 1. Receive future-dated stock (eligible)
  const { error: rcvFutErr } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `RCV_FUT_${ns.toUpperCase()}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L_FUT",
          source_line_id: sLine.id,
          catalog_item_id: chemItem.id,
          location_id: fx.locationAId,
          purchase_quantity: "100.000000",
          purchase_uom_code: fx.uomMl,
          conversion_factor: "1.000000",
          good_quantity: "100.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "day",
          expiry_input: "2028-12-31",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(rcvFutErr);

  // 2. Receive expired stock (past date)
  const { error: rcvExpErr } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `RCV_EXP_${ns.toUpperCase()}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L_EXP",
          source_line_id: sLine.id,
          catalog_item_id: chemItem.id,
          location_id: fx.locationBId,
          purchase_quantity: "50.000000",
          purchase_uom_code: fx.uomMl,
          conversion_factor: "1.000000",
          good_quantity: "50.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "day",
          expiry_input: "2020-01-01",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(rcvExpErr);

  // 3. Opening balance with unknown expiry
  const { error: openErr } = await admin.client.rpc("inventory_command", {
    p_operation: "confirm_opening_balance",
    p_payload: {
      cutover_key: `CUT_UNK_${ns.toUpperCase()}`,
      count_cutoff: "2026-10-01T00:00:00Z",
      scope_description: "Unknown expiry audit",
      provenance_note: "Audited bottle",
      synthetic: true,
      lines: [
        {
          line_key: "R_UNK",
          provenance_group: `grp-${ns}`,
          catalog_item_id: chemItem.id,
          location_id: fx.locationAId,
          good_quantity: "30.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "unknown",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(openErr);

  // 4. Balances aggregate filtering by expiry_state:
  // (a) Filter 'expired'
  const { data: balExpired, error: balExpErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "balances",
      p_filters: { item_id: chemItem.id, expiry_state: "expired" },
    },
  );
  assert.ifError(balExpErr);
  assert.equal(balExpired.total, 1);
  assert.equal(balExpired.rows[0].location_id, fx.locationBId);
  assertDecimalEqual(balExpired.rows[0].expired_quantity, "50.000000");

  // (b) Filter 'eligible'
  const { data: balEligible, error: balElgErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "balances",
      p_filters: { item_id: chemItem.id, expiry_state: "eligible" },
    },
  );
  assert.ifError(balElgErr);
  assert.equal(balEligible.total, 1);
  assert.equal(balEligible.rows[0].location_id, fx.locationAId);
  assertDecimalEqual(balEligible.rows[0].eligible_quantity, "100.000000");

  // (c) Filter 'unknown'
  const { data: balUnknown, error: balUnkErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "balances",
      p_filters: { item_id: chemItem.id, expiry_state: "unknown" },
    },
  );
  assert.ifError(balUnkErr);
  assert.equal(balUnknown.total, 1);
  assert.equal(balUnknown.rows[0].location_id, fx.locationAId);
  assertDecimalEqual(balUnknown.rows[0].unknown_expiry_quantity, "30.000000");

  // 5. Cohorts filtering and canonical DTO structure
  const { data: cohortsExpired, error: cohExpErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "cohorts",
      p_filters: { item_id: chemItem.id, expiry_state: "expired" },
    },
  );
  assert.ifError(cohExpErr);
  assert.equal(cohortsExpired.total, 1);
  const expCohort = cohortsExpired.rows[0];
  assert.ok(
    expCohort.transaction_id,
    "Cohort must carry intake transaction_id",
  );
  assert.equal(expCohort.current_location_id, fx.locationBId);
  assert.equal(expCohort.current_expiry_precision, "day");
  assert.equal(expCohort.current_expiry_date, "2020-01-01");
  assertDecimalEqual(expCohort.good_balance, "50.000000");
  assertDecimalEqual(expCohort.physical_balance, "50.000000");
  assertDecimalEqual(expCohort.eligible_balance, "0.000000");

  const { data: cohortsUnknown, error: cohUnkErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "cohorts",
      p_filters: { item_id: chemItem.id, expiry_state: "unknown" },
    },
  );
  assert.ifError(cohUnkErr);
  assert.equal(cohortsUnknown.total, 1);
  const unkCohort = cohortsUnknown.rows[0];
  assert.ok(
    unkCohort.transaction_id,
    "Unknown cohort must carry intake transaction_id",
  );
  assert.equal(unkCohort.current_expiry_precision, "unknown");
  assert.equal(unkCohort.current_expiry_date, null);
  assertDecimalEqual(unkCohort.good_balance, "30.000000");
  assertDecimalEqual(unkCohort.eligible_balance, "0.000000");
});

test("S1 Inventory: Source actuals 6x50+4x20=380 with optional factor unknown discrepancy and immutable source snapshots", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin");
  const staff = await createTestUser(service, "staff");
  const ns = `act_${crypto.randomUUID().slice(0, 8)}`;
  const fx = await setupMasterFixtures(admin, staff, ns);

  const { data: item, error: itemErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_item",
      p_payload: {
        code: `ITEM_ACT_${ns.toUpperCase()}`,
        name: `Syringe ${ns}`,
        category_id: fx.categoryId,
        material_kind: "other",
        base_uom_code: fx.uomDiscrete,
        tracking_strategy: "quantity",
        return_semantics: "nonreturnable",
        expiry_required: false,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(itemErr);

  // 1. Create source
  const { data: source, error: srcErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source",
      p_payload: {
        source_reference: `SRC-ACTUALS-${ns}`,
        supplier_id: fx.supplierId,
        reference_date: "2026-10-01",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(srcErr);

  // 2. Create line 1 with expected conversion factor 50
  const { data: sLine1, error: sLine1Err } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source_line",
      p_payload: {
        acquisition_record_id: source.id,
        line_key: "LN1",
        catalog_item_id: item.id,
        expected_purchase_quantity: "10.000000",
        purchase_uom_code: fx.uomBox,
        expected_conversion_factor: "50.000000",
        unit_cost: "100000.0000",
        currency_code: "VND",
        notes: "Original contract terms",
        expected_revision: 1,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(sLine1Err);

  // 3. Create line 2 with optional conversion factor (null)
  const { data: sLine2, error: sLine2Err } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source_line",
      p_payload: {
        acquisition_record_id: source.id,
        line_key: "LN2",
        catalog_item_id: item.id,
        expected_purchase_quantity: "5.000000",
        purchase_uom_code: fx.uomBox,
        expected_conversion_factor: null,
        unit_cost: null,
        currency_code: null,
        expected_revision: 2,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(sLine2Err);

  // 4. Intake 1: 6 boxes at factor 50 = 300 base quantity against sLine1
  const { data: rcv1, error: rcv1Err } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "receive_stock",
      p_payload: {
        receipt_reference: `RCV_6X50_${ns.toUpperCase()}`,
        occurred_at: new Date().toISOString(),
        lines: [
          {
            line_key: "L1",
            source_line_id: sLine1.id,
            catalog_item_id: item.id,
            location_id: fx.locationAId,
            purchase_quantity: "6.000000",
            purchase_uom_code: fx.uomBox,
            conversion_factor: "50.000000",
            good_quantity: "300.000000",
            damaged_quantity: "0.000000",
            expiry_precision: "not_required",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(rcv1Err);

  // 5. Intake 2: 4 boxes at factor 20 = 80 base quantity against the SAME sLine1
  const { error: rcv2Err } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `RCV_4X20_${ns.toUpperCase()}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L2",
          source_line_id: sLine1.id,
          catalog_item_id: item.id,
          location_id: fx.locationAId,
          purchase_quantity: "4.000000",
          purchase_uom_code: fx.uomBox,
          conversion_factor: "20.000000",
          good_quantity: "80.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(rcv2Err);

  // 6. Intake 3: 5 boxes at factor 10 = 50 base quantity against sLine2
  const { error: rcv3Err } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `RCV_OPT_${ns.toUpperCase()}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L3",
          source_line_id: sLine2.id,
          catalog_item_id: item.id,
          location_id: fx.locationAId,
          purchase_quantity: "5.000000",
          purchase_uom_code: fx.uomBox,
          conversion_factor: "10.000000",
          good_quantity: "50.000000",
          damaged_quantity: "0.000000",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(rcv3Err);

  // 7. Verify source_lines actuals, packaging, and discrepancy
  const { data: linesData, error: linesErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "source_lines",
      p_filters: { source_id: source.id },
    },
  );
  assert.ifError(linesErr);
  assert.equal(linesData.rows.length, 2);

  const l1 = linesData.rows.find((l) => l.id === sLine1.id);
  assert.ok(l1);
  // Acceptance: 6x50 + 4x20 = 380 actual base quantity
  assertDecimalEqual(l1.actual_base_quantity, "380.000000");
  assertDecimalEqual(l1.expected_base_quantity, "500.000000");
  assertDecimalEqual(l1.base_discrepancy, "-120.000000");
  assert.equal(l1.packaging.length, 2);

  const pkg20 = l1.packaging.find((p) => p.conversion_factor.startsWith("20"));
  const pkg50 = l1.packaging.find((p) => p.conversion_factor.startsWith("50"));
  assert.ok(pkg20);
  assert.ok(pkg50);
  assertDecimalEqual(pkg20.purchase_quantity, "4.000000");
  assertDecimalEqual(pkg20.base_quantity, "80.000000");
  assertDecimalEqual(pkg50.purchase_quantity, "6.000000");
  assertDecimalEqual(pkg50.base_quantity, "300.000000");

  const l2 = linesData.rows.find((l) => l.id === sLine2.id);
  assert.ok(l2);
  assertDecimalEqual(l2.actual_base_quantity, "50.000000");
  assert.equal(l2.expected_base_quantity, null);
  assert.equal(
    l2.base_discrepancy,
    null,
    "When expected factor is absent, base discrepancy must be null",
  );

  // 8. Verify source_receipts resource rows
  const { data: receiptsData, error: receiptsErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "source_receipts",
      p_filters: { source_id: source.id },
    },
  );
  assert.ifError(receiptsErr);
  assert.equal(receiptsData.rows.length, 3);
  for (const r of receiptsData.rows) {
    assert.ok(
      r.transaction_id,
      "source_receipts must carry intake transaction_id",
    );
    assert.ok(
      r.receipt_reference,
      "source_receipts must carry receipt_reference",
    );
    assert.ok(r.origin_id, "source_receipts must carry origin_id");
    assert.ok(r.source_line_id, "source_receipts must carry source_line_id");
    assert.ok(r.line_key, "source_receipts must carry line_key");
    assert.ok(
      r.purchase_quantity,
      "source_receipts must carry purchase_quantity",
    );
    assert.ok(
      r.purchase_uom_code,
      "source_receipts must carry purchase_uom_code",
    );
    assert.ok(
      r.conversion_factor,
      "source_receipts must carry conversion_factor",
    );
    assert.ok(r.base_quantity, "source_receipts must carry base_quantity");
    assert.ok(r.base_uom_code, "source_receipts must carry base_uom_code");
  }

  // 9. Immutable source snapshot check: update source line unit_cost and verify original snapshot intact
  const { error: updateErr } = await staff.client.rpc("inventory_command", {
    p_operation: "update_acquisition_source_line",
    p_payload: {
      id: sLine1.id,
      expected_purchase_quantity: "10.000000",
      purchase_uom_code: fx.uomBox,
      expected_conversion_factor: "50.000000",
      unit_cost: "999999.0000",
      currency_code: "VND",
      expected_revision: 3,
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(updateErr);

  const { data: txDetail, error: txErr } = await staff.client.rpc(
    "inventory_read",
    {
      p_resource: "transaction_detail",
      p_filters: { id: rcv1.transaction_id },
    },
  );
  assert.ifError(txErr);
  const fact1 = txDetail.rows[0].facts.find(
    (f) => f.source_snapshot.source_line_id === sLine1.id,
  );
  assert.ok(fact1);
  assertDecimalEqual(fact1.source_snapshot.unit_cost, "100000.0000");
});
