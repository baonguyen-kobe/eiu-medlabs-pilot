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
  const email = `s2-${role}-${crypto.randomUUID()}@campus.local`;
  const password = "LocalS2TestPassword123!";
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { preapproved: true },
    user_metadata: { full_name: `S2 Test ${role}` },
  });
  assert.ifError(error);
  const userId = data.user.id;

  await service.from("profiles").upsert({
    id: userId,
    email,
    full_name: `S2 Test ${role}`,
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
      allowed_scale: 2,
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(uomErr2);

  // 3. Create Category
  const catCode = `CAT_${ns.toUpperCase()}`;
  const { data: catRes, error: catErr } = await admin.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_category",
      p_payload: {
        code: catCode,
        name: `Category ${ns}`,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(catErr);
  const categoryId = catRes.id;

  // 4. Create Supplier
  const { data: suppRes, error: suppErr } = await admin.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_supplier",
      p_payload: {
        name: `Supplier ${ns}`,
        tax_code: `TAX-${ns}`,
        contact: "supplier@local.test",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(suppErr);
  const supplierId = suppRes.id;

  // 5. Create Storage Locations
  const locACode = `LOC_A_${ns.toUpperCase()}`;
  const { data: locARes, error: locAErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_location",
      p_payload: {
        code: locACode,
        name: `Location A ${ns}`,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(locAErr);
  const locationAId = locARes.id;

  const locBCode = `LOC_B_${ns.toUpperCase()}`;
  const { data: locBRes, error: locBErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_location",
      p_payload: {
        code: locBCode,
        name: `Location B ${ns}`,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(locBErr);
  const locationBId = locBRes.id;

  return {
    uomDiscrete: uomDiscreteCode,
    uomMl: uomMlCode,
    categoryId,
    supplierId,
    locationAId,
    locationBId,
  };
}

async function getOriginDetails(client, originId) {
  const { data, error } = await client.rpc("inventory_read", {
    p_resource: "operation_stock",
    p_filters: { origin_id: originId },
  });
  assert.ifError(error);
  assert.ok(
    data.rows.length > 0,
    `Origin ${originId} not found in operation_stock`,
  );
  return data.rows[0];
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
// TEST 1: Stock Transfer (transfer_stock) - Conservation, Overdraw, Locations
// ============================================================================
test("S2 Inventory: Stock Transfer (transfer_stock) conservation, overdraw guard & distinct locations", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fixtures = await setupMasterFixtures(admin, staff, ns);

  // 1. Create a discrete catalog item (non-chemical, non-expiry)
  const itemCode = `ITEM_TR_${ns.toUpperCase()}`;
  const { data: itemRes, error: itemErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_item",
      p_payload: {
        code: itemCode,
        name: `Transfer Item ${ns}`,
        category_id: fixtures.categoryId,
        material_kind: "other",
        base_uom_code: fixtures.uomDiscrete,
        tracking_strategy: "quantity",
        return_semantics: "nonreturnable",
        expiry_required: false,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(itemErr);
  const itemId = itemRes.id;

  // 2. Receive 10 units of stock at Location A
  const sourceRef = `SRC-TR-${ns}`;
  const { data: srcRes, error: srcErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source",
      p_payload: {
        source_reference: sourceRef,
        supplier_id: fixtures.supplierId,
        reference_date: "2026-10-01",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(srcErr);

  const { data: srcLineRes, error: lineErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source_line",
      p_payload: {
        acquisition_record_id: srcRes.id,
        expected_revision: 1,
        line_key: "L1",
        catalog_item_id: itemId,
        expected_purchase_quantity: "10",
        purchase_uom_code: fixtures.uomDiscrete,
        expected_conversion_factor: "1",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(lineErr);

  const receiptRef = `REC-TR-${ns}`;
  const { data: rxRes, error: rxErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "receive_stock",
      p_payload: {
        receipt_reference: receiptRef,
        occurred_at: new Date().toISOString(),
        lines: [
          {
            line_key: "L1",
            source_line_id: srcLineRes.id,
            catalog_item_id: itemId,
            location_id: fixtures.locationAId,
            purchase_quantity: "10",
            purchase_uom_code: fixtures.uomDiscrete,
            conversion_factor: "1",
            good_quantity: "10",
            damaged_quantity: "0",
            expiry_precision: "not_required",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(rxErr);
  const originId = await getOriginIdFromTransaction(
    staff.client,
    rxRes.transaction_id,
  );

  // 3. Test Transfer Validation: Same source and target location is rejected
  const { error: sameLocErr } = await staff.client.rpc("inventory_command", {
    p_operation: "transfer_stock",
    p_payload: {
      source_location_id: fixtures.locationAId,
      target_location_id: fixtures.locationAId,
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 1,
          condition: "good",
          quantity: "2",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(sameLocErr, "Transferring to identical location must be rejected");
  assert.match(sameLocErr.message, /INVALID_TRANSFER/);

  // 4. Test Transfer Validation: Overdraw is rejected
  const { error: overdrawErr } = await staff.client.rpc("inventory_command", {
    p_operation: "transfer_stock",
    p_payload: {
      source_location_id: fixtures.locationAId,
      target_location_id: fixtures.locationBId,
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 1,
          condition: "good",
          quantity: "15", // Only 10 available
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(overdrawErr, "Overdraw transfer must be rejected");
  assert.match(overdrawErr.message, /INSUFFICIENT_STOCK/);

  // 5. Test Transfer Validation: Outdated expected_stock_revision fails with STALE_REVISION
  const { error: staleErr } = await staff.client.rpc("inventory_command", {
    p_operation: "transfer_stock",
    p_payload: {
      source_location_id: fixtures.locationAId,
      target_location_id: fixtures.locationBId,
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 99, // Stale!
          condition: "good",
          quantity: "4",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(staleErr, "Stale revision must be rejected");
  assert.match(staleErr.message, /STALE_REVISION/);

  // 6. Valid Transfer: Transfer 4 units from Location A to Location B
  const { data: trRes, error: trErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "transfer_stock",
      p_payload: {
        source_location_id: fixtures.locationAId,
        target_location_id: fixtures.locationBId,
        reason: "Moving 4 units to Room B",
        lines: [
          {
            origin_id: originId,
            expected_version: 0,
            expected_stock_revision: 1,
            condition: "good",
            quantity: "4",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(trErr);
  assert.ok(trRes.transaction_id);

  // Verify conservation in balances:
  // Location A good: 6, Location B good: 4, Total: 10
  const { data: balA } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: itemId, location_id: fixtures.locationAId },
  });
  assert.equal(balA.rows.length, 1);
  assertDecimalEqual(balA.rows[0].quantity, "6");

  const { data: balB } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: itemId, location_id: fixtures.locationBId },
  });
  assert.equal(balB.rows.length, 1);
  assertDecimalEqual(balB.rows[0].quantity, "4");

  // Total across item
  const { data: balTotal } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: itemId },
  });
  const sumTotal = balTotal.rows.reduce(
    (acc, row) => acc + toScaled(row.quantity),
    0n,
  );
  assert.equal(sumTotal, 10000000n, "Total physical quantity conserved at 10");
});

// ============================================================================
// TEST 2: Concurrent Last-Stock Transfers - Only One Success
// ============================================================================
test("S2 Inventory: Concurrent last-stock transfers only one succeeds", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fixtures = await setupMasterFixtures(admin, staff, ns);

  // 1. Create item and intake exactly 5 units at Location A
  const itemCode = `ITEM_RACE_${ns.toUpperCase()}`;
  const { data: itemRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: `Race Item ${ns}`,
      category_id: fixtures.categoryId,
      material_kind: "other",
      base_uom_code: fixtures.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });
  const itemId = itemRes.id;

  const { data: srcRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: `SRC-RACE-${ns}`,
      supplier_id: fixtures.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: lineRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: srcRes.id,
      expected_revision: 1,
      line_key: "L1",
      catalog_item_id: itemId,
      expected_purchase_quantity: "5",
      purchase_uom_code: fixtures.uomDiscrete,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: rxRes } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `REC-RACE-${ns}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L1",
          source_line_id: lineRes.id,
          catalog_item_id: itemId,
          location_id: fixtures.locationAId,
          purchase_quantity: "5",
          purchase_uom_code: fixtures.uomDiscrete,
          conversion_factor: "1",
          good_quantity: "5",
          damaged_quantity: "0",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  const originId = await getOriginIdFromTransaction(
    staff.client,
    rxRes.transaction_id,
  );

  // 2. Launch two concurrent transfers for all 5 units using Promise.allSettled
  const results = await Promise.allSettled([
    staff.client.rpc("inventory_command", {
      p_operation: "transfer_stock",
      p_payload: {
        source_location_id: fixtures.locationAId,
        target_location_id: fixtures.locationBId,
        reason: "Concurrent transfer 1",
        lines: [
          {
            origin_id: originId,
            expected_version: 0,
            expected_stock_revision: 1,
            condition: "good",
            quantity: "5",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    }),
    staff.client.rpc("inventory_command", {
      p_operation: "transfer_stock",
      p_payload: {
        source_location_id: fixtures.locationAId,
        target_location_id: fixtures.locationBId,
        reason: "Concurrent transfer 2",
        lines: [
          {
            origin_id: originId,
            expected_version: 0,
            expected_stock_revision: 1,
            condition: "good",
            quantity: "5",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    }),
  ]);

  const successes = results.filter(
    (r) => r.status === "fulfilled" && !r.value.error,
  );
  const failures = results.filter(
    (r) => r.status === "fulfilled" && r.value.error,
  );

  assert.equal(
    successes.length,
    1,
    "Exactly one concurrent transfer must succeed",
  );
  assert.equal(failures.length, 1, "Exactly one concurrent transfer must fail");
  assert.match(
    failures[0].value.error.message,
    /STALE_REVISION|INSUFFICIENT_STOCK/,
    "Failed transfer must fail with STALE_REVISION or INSUFFICIENT_STOCK",
  );

  // Verify final balances: Location A is 0, Location B is 5
  const { data: balA } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: itemId, location_id: fixtures.locationAId },
  });
  assertDecimalEqual(balA.rows[0].quantity, "0");

  const { data: balB } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: itemId, location_id: fixtures.locationBId },
  });
  assertDecimalEqual(balB.rows[0].quantity, "5");
});

// ============================================================================
// TEST 3: Stock Condition Change good->damaged conservation & repair excluded
// ============================================================================
test("S2 Inventory: Stock Condition Change good->damaged conservation & repair excluded", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fixtures = await setupMasterFixtures(admin, staff, ns);

  // 1. Create item and intake 10 good units at Location A
  const itemCode = `ITEM_CD_${ns.toUpperCase()}`;
  const { data: itemRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: `Condition Change Item ${ns}`,
      category_id: fixtures.categoryId,
      material_kind: "other",
      base_uom_code: fixtures.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });
  const itemId = itemRes.id;

  const { data: srcRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: `SRC-CD-${ns}`,
      supplier_id: fixtures.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: lineRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: srcRes.id,
      expected_revision: 1,
      line_key: "L1",
      catalog_item_id: itemId,
      expected_purchase_quantity: "10",
      purchase_uom_code: fixtures.uomDiscrete,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: rxRes } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `REC-CD-${ns}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L1",
          source_line_id: lineRes.id,
          catalog_item_id: itemId,
          location_id: fixtures.locationAId,
          purchase_quantity: "10",
          purchase_uom_code: fixtures.uomDiscrete,
          conversion_factor: "1",
          good_quantity: "10",
          damaged_quantity: "0",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  const originId = await getOriginIdFromTransaction(
    staff.client,
    rxRes.transaction_id,
  );

  // 2. Test Repair Exclusion: damaged -> good is rejected in V1
  const { error: repairErr } = await staff.client.rpc("inventory_command", {
    p_operation: "change_stock_condition",
    p_payload: {
      location_id: fixtures.locationAId,
      reason: "Attempting repair",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 1,
          from_condition: "damaged",
          to_condition: "good",
          quantity: "1",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(repairErr, "Repair (damaged->good) must be rejected");
  assert.match(repairErr.message, /REPAIR_EXCLUDED/);

  // 3. Test Overdraw: Attempt to damage more than available good balance
  const { error: overdrawErr } = await staff.client.rpc("inventory_command", {
    p_operation: "change_stock_condition",
    p_payload: {
      location_id: fixtures.locationAId,
      reason: "Dropped items",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 1,
          from_condition: "good",
          to_condition: "damaged",
          quantity: "15", // only 10
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(overdrawErr, "Overdrawing good balance must fail");
  assert.match(overdrawErr.message, /INSUFFICIENT_STOCK/);

  // 4. Valid Condition Change: Damage 3 units
  const { data: cdRes, error: cdErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "change_stock_condition",
      p_payload: {
        location_id: fixtures.locationAId,
        reason: "3 units dropped and shattered",
        lines: [
          {
            origin_id: originId,
            expected_version: 0,
            expected_stock_revision: 1,
            from_condition: "good",
            to_condition: "damaged",
            quantity: "3",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(cdErr);
  assert.ok(cdRes.transaction_id);

  // 5. Verify balances: good is 7, damaged is 3; total is 10 (strictly conserved)
  const { data: balGood } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: {
      item_id: itemId,
      location_id: fixtures.locationAId,
      condition: "good",
    },
  });
  assert.equal(balGood.rows.length, 1);
  assertDecimalEqual(balGood.rows[0].quantity, "7");

  const { data: balDamaged } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: {
      item_id: itemId,
      location_id: fixtures.locationAId,
      condition: "damaged",
    },
  });
  assert.equal(balDamaged.rows.length, 1);
  assertDecimalEqual(balDamaged.rows[0].quantity, "3");
});

// ============================================================================
// TEST 4: True ABA Movement Sequence (10 -> 6 -> 10) Rejected by Stock Revision
// ============================================================================
test("S2 Inventory: True ABA movement sequence rejected by monotonic stock revision", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fixtures = await setupMasterFixtures(admin, staff, ns);

  // 1. Intake 10 units at Location A
  const itemCode = `ITEM_ABA_${ns.toUpperCase()}`;
  const { data: itemRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: `ABA Test Item ${ns}`,
      category_id: fixtures.categoryId,
      material_kind: "other",
      base_uom_code: fixtures.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });
  const itemId = itemRes.id;

  const { data: srcRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: `SRC-ABA-${ns}`,
      supplier_id: fixtures.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: lineRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: srcRes.id,
      expected_revision: 1,
      line_key: "L1",
      catalog_item_id: itemId,
      expected_purchase_quantity: "10",
      purchase_uom_code: fixtures.uomDiscrete,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: rxRes } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `REC-ABA-${ns}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L1",
          source_line_id: lineRes.id,
          catalog_item_id: itemId,
          location_id: fixtures.locationAId,
          purchase_quantity: "10",
          purchase_uom_code: fixtures.uomDiscrete,
          conversion_factor: "1",
          good_quantity: "10",
          damaged_quantity: "0",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  const originId = await getOriginIdFromTransaction(
    staff.client,
    rxRes.transaction_id,
  );

  // Operator reads initial state: quantity = 10, fact_version = 0, stock_revision = 1
  const initialDetails = await getOriginDetails(staff.client, originId);
  assert.equal(initialDetails.stock_revision, 1);
  assertDecimalEqual(initialDetails.quantity, "10");

  // Movement 1: Transfer 4 units away from A to B (balance at A becomes 6, stock_revision becomes 2)
  const { error: tr1Err } = await staff.client.rpc("inventory_command", {
    p_operation: "transfer_stock",
    p_payload: {
      source_location_id: fixtures.locationAId,
      target_location_id: fixtures.locationBId,
      reason: "Move away (A -> B)",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 1,
          condition: "good",
          quantity: "4",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(tr1Err);

  // Movement 2: Transfer 4 units back from B to A (balance at A becomes 10 again! stock_revision becomes 3)
  const { error: tr2Err } = await staff.client.rpc("inventory_command", {
    p_operation: "transfer_stock",
    p_payload: {
      source_location_id: fixtures.locationBId,
      target_location_id: fixtures.locationAId,
      reason: "Move back (B -> A)",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 2,
          condition: "good",
          quantity: "4",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(tr2Err);

  // Verify current state: quantity is 10, but stock_revision is now 3!
  const afterAbaDetails = await getOriginDetails(staff.client, originId);
  assertDecimalEqual(afterAbaDetails.quantity, "10");
  assert.equal(afterAbaDetails.stock_revision, 3);

  // Now: Operator attempts count reconciliation with the OLD previewed stock_revision (1):
  // Even though expected_quantity = 10 matches current balance 10, and expected_version = 0 matches fact version,
  // the monotonic stock_revision check (1 vs 3) MUST REJECT the stale ABA count!
  const { error: abaErr } = await staff.client.rpc("inventory_command", {
    p_operation: "reconcile_stocktake",
    p_payload: {
      stocktake_reference: `STK-ABA-${ns}-001`,
      location_id: fixtures.locationAId,
      count_timestamp: new Date().toISOString(),
      reason: "Stale ABA count attempt",
      evidence_note: "Count sheet captured before A->B->A movements",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 1, // Stale! (current is 3)
          condition: "good",
          expected_quantity: "10", // Quantity matches!
          counted_quantity: "9",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(
    abaErr,
    "True ABA sequence must be rejected by monotonic stock revision",
  );
  assert.match(abaErr.message, /STALE_REVISION/);
});

// ============================================================================
// TEST 5: Count-vs-Transfer Stale Race
// ============================================================================
test("S2 Inventory: Count-vs-transfer race condition fails with stale revision", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fixtures = await setupMasterFixtures(admin, staff, ns);

  const itemCode = `ITEM_RACE2_${ns.toUpperCase()}`;
  const { data: itemRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: `Race2 Item ${ns}`,
      category_id: fixtures.categoryId,
      material_kind: "other",
      base_uom_code: fixtures.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });
  const itemId = itemRes.id;

  const { data: srcRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: `SRC-RACE2-${ns}`,
      supplier_id: fixtures.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: lineRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: srcRes.id,
      expected_revision: 1,
      line_key: "L1",
      catalog_item_id: itemId,
      expected_purchase_quantity: "10",
      purchase_uom_code: fixtures.uomDiscrete,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: rxRes } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `REC-RACE2-${ns}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L1",
          source_line_id: lineRes.id,
          catalog_item_id: itemId,
          location_id: fixtures.locationAId,
          purchase_quantity: "10",
          purchase_uom_code: fixtures.uomDiscrete,
          conversion_factor: "1",
          good_quantity: "10",
          damaged_quantity: "0",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  const originId = await getOriginIdFromTransaction(
    staff.client,
    rxRes.transaction_id,
  );

  // Operator observes balance 10, revision 1. Before submitting count, a transfer moves 2 units away:
  const { error: trErr } = await staff.client.rpc("inventory_command", {
    p_operation: "transfer_stock",
    p_payload: {
      source_location_id: fixtures.locationAId,
      target_location_id: fixtures.locationBId,
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 1,
          condition: "good",
          quantity: "2",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(trErr);

  // Count submitted with expected_quantity = 10, expected_stock_revision = 1: fails!
  const { error: countRaceErr } = await staff.client.rpc("inventory_command", {
    p_operation: "reconcile_stocktake",
    p_payload: {
      stocktake_reference: `STK-RACE-${ns}`,
      location_id: fixtures.locationAId,
      count_timestamp: new Date().toISOString(),
      reason: "Count after intervening transfer",
      evidence_note: "Count sheet",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 1,
          condition: "good",
          expected_quantity: "10",
          counted_quantity: "8",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(
    countRaceErr,
    "Intervening transfer must cause count reconciliation to fail",
  );
  assert.match(countRaceErr.message, /STALE_REVISION/);
});

// ============================================================================
// TEST 6: Stocktake Reconcile & Zero-Delta Count Evidence
// ============================================================================
test("S2 Inventory: Stocktake zero-delta count persists evidence & count to 0", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fixtures = await setupMasterFixtures(admin, staff, ns);

  const itemCode = `ITEM_ZD_${ns.toUpperCase()}`;
  const { data: itemRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: `Zero Delta Item ${ns}`,
      category_id: fixtures.categoryId,
      material_kind: "other",
      base_uom_code: fixtures.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });
  const itemId = itemRes.id;

  const { data: srcRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: `SRC-ZD-${ns}`,
      supplier_id: fixtures.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: lineRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: srcRes.id,
      expected_revision: 1,
      line_key: "L1",
      catalog_item_id: itemId,
      expected_purchase_quantity: "10",
      purchase_uom_code: fixtures.uomDiscrete,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: rxRes } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `REC-ZD-${ns}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L1",
          source_line_id: lineRes.id,
          catalog_item_id: itemId,
          location_id: fixtures.locationAId,
          purchase_quantity: "10",
          purchase_uom_code: fixtures.uomDiscrete,
          conversion_factor: "1",
          good_quantity: "10",
          damaged_quantity: "0",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  const originId = await getOriginIdFromTransaction(
    staff.client,
    rxRes.transaction_id,
  );

  // 1. Perform a zero-delta count: counted_quantity = 10, expected_quantity = 10 (delta = 0)
  const stocktakeRef1 = `STK-ZD-${ns}-001`;
  const { data: zdRes, error: zdErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "reconcile_stocktake",
      p_payload: {
        stocktake_reference: stocktakeRef1,
        location_id: fixtures.locationAId,
        count_timestamp: new Date().toISOString(),
        reason: "Zero delta periodic verification",
        evidence_note: "Physical count confirmed exactly 10",
        lines: [
          {
            origin_id: originId,
            expected_version: 0,
            expected_stock_revision: 1,
            condition: "good",
            expected_quantity: "10",
            counted_quantity: "10", // zero delta!
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(zdErr);

  // 2. Assert count evidence is persisted with expected, counted, delta: 0, stocktake_reference and complete server metadata
  const { data: evRows } = await staff.client.rpc("inventory_read", {
    p_resource: "stock_evidence",
    p_filters: { origin_id: originId },
  });
  assert.ok(
    evRows.rows.length > 0,
    "Zero-delta count must produce evidence record",
  );
  const zdEv = evRows.rows.find(
    (r) => r.metadata?.stocktake_reference === stocktakeRef1,
  );
  assert.ok(zdEv, "Evidence metadata must contain stocktake_reference");
  assertDecimalEqual(zdEv.metadata.delta, "0");
  assertDecimalEqual(zdEv.metadata.expected_quantity, "10");
  assertDecimalEqual(zdEv.metadata.counted_quantity, "10");
  assert.equal(
    zdEv.metadata.location_id,
    fixtures.locationAId,
    "Evidence must record validated location_id",
  );
  assert.equal(
    zdEv.metadata.transaction_id,
    zdRes.transaction_id,
    "Evidence must record transaction_id",
  );
  assert.equal(
    zdEv.metadata.expected_version,
    0,
    "Evidence must record expected_version",
  );
  assert.equal(
    zdEv.metadata.expected_stock_revision,
    1,
    "Evidence must record expected_stock_revision",
  );
  assert.ok(
    zdEv.metadata.count_timestamp,
    "Evidence must record count_timestamp",
  );

  // 3. Count to 0: counted_quantity = 0
  const stocktakeRef2 = `STK-ZD-${ns}-002`;
  const { error: toZeroErr } = await staff.client.rpc("inventory_command", {
    p_operation: "reconcile_stocktake",
    p_payload: {
      stocktake_reference: stocktakeRef2,
      location_id: fixtures.locationAId,
      count_timestamp: new Date().toISOString(),
      reason: "All items missing",
      evidence_note: "Shelf empty",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 1,
          condition: "good",
          expected_quantity: "10",
          counted_quantity: "0",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(toZeroErr);

  const { data: balZero } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: { item_id: itemId, location_id: fixtures.locationAId },
  });
  assertDecimalEqual(balZero.rows[0].quantity, "0");
});

// ============================================================================
// TEST 7: Duplicate Stocktake Reference with Different Retry Key Rejected
// ============================================================================
test("S2 Inventory: Same stocktake_reference with different retry key refused", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fixtures = await setupMasterFixtures(admin, staff, ns);

  const itemCode = `ITEM_DUP_${ns.toUpperCase()}`;
  const { data: itemRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: `Dup Item ${ns}`,
      category_id: fixtures.categoryId,
      material_kind: "other",
      base_uom_code: fixtures.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const stocktakeRef = `STK-DUP-${ns}`;
  const countPayload = {
    stocktake_reference: stocktakeRef,
    location_id: fixtures.locationAId,
    count_timestamp: new Date().toISOString(),
    reason: "Surplus finding",
    evidence_note: "Box found",
    lines: [
      {
        type: "surplus",
        catalog_item_id: itemRes.id,
        condition: "good",
        counted_quantity: "5",
      },
    ],
  };

  // Submit 1: succeeds
  const { error: sub1Err } = await staff.client.rpc("inventory_command", {
    p_operation: "reconcile_stocktake",
    p_payload: countPayload,
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(sub1Err);

  // Submit 2 with NEW retry_key but SAME stocktake_reference: must fail with BUSINESS_DUPLICATE!
  const { error: sub2Err } = await staff.client.rpc("inventory_command", {
    p_operation: "reconcile_stocktake",
    p_payload: countPayload,
    p_retry_key: crypto.randomUUID(), // NEW retry key!
  });
  assert.ok(
    sub2Err,
    "Same stocktake_reference with new retry key must be rejected",
  );
  assert.match(sub2Err.message, /BUSINESS_DUPLICATE/);
});

// ============================================================================
// TEST 8: Duplicate Count Line with UUID Aliases (Upper vs Lower) Rejected
// ============================================================================
test("S2 Inventory: Duplicate count line with UUID casing aliases rejected", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fixtures = await setupMasterFixtures(admin, staff, ns);

  const itemCode = `ITEM_CASE_${ns.toUpperCase()}`;
  const { data: itemRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: `Case Item ${ns}`,
      category_id: fixtures.categoryId,
      material_kind: "other",
      base_uom_code: fixtures.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });
  const itemId = itemRes.id;

  const { data: srcRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: `SRC-CASE-${ns}`,
      supplier_id: fixtures.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: lineRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: srcRes.id,
      expected_revision: 1,
      line_key: "L1",
      catalog_item_id: itemId,
      expected_purchase_quantity: "10",
      purchase_uom_code: fixtures.uomDiscrete,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: rxRes } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `REC-CASE-${ns}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L1",
          source_line_id: lineRes.id,
          catalog_item_id: itemId,
          location_id: fixtures.locationAId,
          purchase_quantity: "10",
          purchase_uom_code: fixtures.uomDiscrete,
          conversion_factor: "1",
          good_quantity: "10",
          damaged_quantity: "0",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  const originId = await getOriginIdFromTransaction(
    staff.client,
    rxRes.transaction_id,
  );

  const lowerOriginId = originId.toLowerCase();
  const upperOriginId = originId.toUpperCase();

  const { error: dupCaseErr } = await staff.client.rpc("inventory_command", {
    p_operation: "reconcile_stocktake",
    p_payload: {
      stocktake_reference: `STK-CASE-${ns}`,
      location_id: fixtures.locationAId,
      count_timestamp: new Date().toISOString(),
      reason: "Duplicate case test",
      evidence_note: "Duplicate check",
      lines: [
        {
          origin_id: lowerOriginId,
          expected_version: 0,
          expected_stock_revision: 1,
          condition: "good",
          expected_quantity: "10",
          counted_quantity: "9",
        },
        {
          origin_id: upperOriginId,
          expected_version: 0,
          expected_stock_revision: 1,
          condition: "good",
          expected_quantity: "10",
          counted_quantity: "8",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(
    dupCaseErr,
    "Duplicate count lines with different UUID casing must be rejected",
  );
  assert.match(dupCaseErr.message, /DUPLICATE_COUNT_LINE/);
});

// ============================================================================
// TEST 9: Exact Ledger Sum Equals Balance Across All Affected Dimensions
// ============================================================================
test("S2 Inventory: Exact ledger sum equals balance across all dimensions", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fixtures = await setupMasterFixtures(admin, staff, ns);

  // 1. Create item and intake 20 units at Location A
  const itemCode = `ITEM_SUM_${ns.toUpperCase()}`;
  const { data: itemRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: `Ledger Sum Item ${ns}`,
      category_id: fixtures.categoryId,
      material_kind: "other",
      base_uom_code: fixtures.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });
  const itemId = itemRes.id;

  const { data: srcRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: `SRC-SUM-${ns}`,
      supplier_id: fixtures.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: lineRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: srcRes.id,
      expected_revision: 1,
      line_key: "L1",
      catalog_item_id: itemId,
      expected_purchase_quantity: "20",
      purchase_uom_code: fixtures.uomDiscrete,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: rxRes } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `REC-SUM-${ns}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L1",
          source_line_id: lineRes.id,
          catalog_item_id: itemId,
          location_id: fixtures.locationAId,
          purchase_quantity: "20",
          purchase_uom_code: fixtures.uomDiscrete,
          conversion_factor: "1",
          good_quantity: "20",
          damaged_quantity: "0",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  const originId = await getOriginIdFromTransaction(
    staff.client,
    rxRes.transaction_id,
  );

  // 2. Perform transfer of 7 units from A to B
  const { error: trSumErr } = await staff.client.rpc("inventory_command", {
    p_operation: "transfer_stock",
    p_payload: {
      source_location_id: fixtures.locationAId,
      target_location_id: fixtures.locationBId,
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 1,
          condition: "good",
          quantity: "7",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(trSumErr, "Transfer mutation in ledger test must succeed");

  // 3. Condition change of 3 units at Location A to damaged
  const { error: cdSumErr } = await staff.client.rpc("inventory_command", {
    p_operation: "change_stock_condition",
    p_payload: {
      location_id: fixtures.locationAId,
      reason: "Damage 3 units",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 2,
          from_condition: "good",
          to_condition: "damaged",
          quantity: "3",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(
    cdSumErr,
    "Condition change mutation in ledger test must succeed",
  );

  // 4. Stocktake adjust at Location B: count 6 units (delta -1)
  const { error: stkSumErr } = await staff.client.rpc("inventory_command", {
    p_operation: "reconcile_stocktake",
    p_payload: {
      stocktake_reference: `STK-SUM-${ns}`,
      location_id: fixtures.locationBId,
      count_timestamp: new Date().toISOString(),
      reason: "Lost 1 unit at B",
      evidence_note: "Count sheet",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 3,
          condition: "good",
          expected_quantity: "7",
          counted_quantity: "6",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(
    stkSumErr,
    "Stocktake adjust mutation in ledger test must succeed",
  );

  // Read ledger and projections through the authorized Staff SELECT policies.
  const { data: allLines, error: linesError } = await staff.client
    .from("inventory_transaction_lines")
    .select("location_id, condition, quantity_delta")
    .eq("cohort_id", originId);

  const { data: allBalances, error: balancesError } = await staff.client
    .from("inventory_stock_balances")
    .select("location_id, condition, quantity")
    .eq("cohort_id", originId);
  assert.ifError(linesError);
  assert.ifError(balancesError);

  // Exact scenario verification: A good 10, A damaged 3, B good 6
  const balAGood = allBalances.find(
    (b) => b.location_id === fixtures.locationAId && b.condition === "good",
  );
  const balADamaged = allBalances.find(
    (b) => b.location_id === fixtures.locationAId && b.condition === "damaged",
  );
  const balBGood = allBalances.find(
    (b) => b.location_id === fixtures.locationBId && b.condition === "good",
  );

  assert.ok(balAGood, "Location A good balance row must exist");
  assertDecimalEqual(
    balAGood.quantity,
    "10",
    "Location A good balance must be exactly 10",
  );

  assert.ok(balADamaged, "Location A damaged balance row must exist");
  assertDecimalEqual(
    balADamaged.quantity,
    "3",
    "Location A damaged balance must be exactly 3",
  );

  assert.ok(balBGood, "Location B good balance row must exist");
  assertDecimalEqual(
    balBGood.quantity,
    "6",
    "Location B good balance must be exactly 6",
  );

  // Group ledger lines by (location_id, condition)
  const ledgerMap = new Map();
  for (const line of allLines) {
    const key = `${line.location_id}:${line.condition}`;
    const cur = ledgerMap.get(key) ?? 0n;
    ledgerMap.set(key, cur + toScaled(line.quantity_delta));
  }

  // Verify against balance table
  for (const bal of allBalances) {
    const key = `${bal.location_id}:${bal.condition}`;
    const ledgerSum = ledgerMap.get(key) ?? 0n;
    const balanceQty = toScaled(bal.quantity);
    assert.equal(
      ledgerSum,
      balanceQty,
      `Ledger delta sum (${ledgerSum}) must match balance (${balanceQty}) for ${key}`,
    );
  }
});

// ============================================================================
// TEST 10: Surplus Hold, Admin Verification & Chemical Expiry Guard
// ============================================================================
test("S2 Inventory: Surplus hold, Admin verification & chemical expiry guard", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fixtures = await setupMasterFixtures(admin, staff, ns);

  // 1. Create a chemical item requiring expiry
  const chemCode = `CHEM_EXP_${ns.toUpperCase()}`;
  const { data: chemRes } = await admin.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: chemCode,
      name: `Chemical Expiry Item ${ns}`,
      category_id: fixtures.categoryId,
      material_kind: "chemical",
      base_uom_code: fixtures.uomMl,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: true,
    },
    p_retry_key: crypto.randomUUID(),
  });
  const chemId = chemRes.id;

  // 2. Create a non-expiry equipment item
  const equipCode = `EQUIP_NX_${ns.toUpperCase()}`;
  const { data: equipRes } = await admin.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: equipCode,
      name: `Nonexpiry Equip ${ns}`,
      category_id: fixtures.categoryId,
      material_kind: "other",
      base_uom_code: fixtures.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "in_place",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });
  const equipId = equipRes.id;

  // 3. Staff records surplus of both
  const stocktakeRef = `STK-SURP-${ns}`;
  const { data: surplusRes, error: surplusErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "reconcile_stocktake",
      p_payload: {
        stocktake_reference: stocktakeRef,
        location_id: fixtures.locationAId,
        count_timestamp: new Date().toISOString(),
        reason: "Surplus discovered",
        evidence_note: "Physical stocktake box photos",
        lines: [
          {
            type: "surplus",
            catalog_item_id: chemId,
            condition: "good",
            counted_quantity: "500",
            expiry_precision: "unknown",
            evidence_note: "Unopened chemical bottle",
          },
          {
            type: "surplus",
            catalog_item_id: equipId,
            condition: "good",
            counted_quantity: "3",
            evidence_note: "Extra power supply units",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(surplusErr);
  const chemOriginId = surplusRes.surplus_origins[0].origin_id;
  const equipOriginId = surplusRes.surplus_origins[1].origin_id;

  // 4. Chemical surplus release denied even if not_required is supplied:
  const { error: chemNotReqErr } = await admin.client.rpc("inventory_command", {
    p_operation: "verify_stocktake_surplus",
    p_payload: {
      origin_id: chemOriginId,
      expected_version: 0,
      expected_stock_revision: 1,
      action: "release",
      expiry_precision: "not_required", // Prohibited for chemical!
      reason: "Trying to release chemical as not_required",
      evidence_note: "Note",
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(
    chemNotReqErr,
    "Chemical surplus release without day/month precision must fail",
  );
  assert.match(chemNotReqErr.message, /CHEMICAL_EXPIRY_REQUIRED/);

  // 5. Admin releases chemical with day precision:
  const { error: chemOkErr } = await admin.client.rpc("inventory_command", {
    p_operation: "verify_stocktake_surplus",
    p_payload: {
      origin_id: chemOriginId,
      expected_version: 0,
      expected_stock_revision: 1,
      action: "release",
      expiry_precision: "day",
      expiry_input: "2028-06-30",
      reason: "Batch CoA verified",
      evidence_note: "CoA document attached",
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(chemOkErr);

  // 6. Admin releases non-expiry equipment without historical receipt:
  const { error: equipOkErr } = await admin.client.rpc("inventory_command", {
    p_operation: "verify_stocktake_surplus",
    p_payload: {
      origin_id: equipOriginId,
      expected_version: 0,
      expected_stock_revision: 1,
      action: "release",
      reason: "Surplus verified from count evidence",
      evidence_note: "Lab director approval",
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(equipOkErr);

  // Both should now be eligible:
  const { data: opStock } = await staff.client.rpc("inventory_read", {
    p_resource: "operation_stock",
    p_filters: { location_id: fixtures.locationAId },
  });
  const chemRow = opStock.rows.find((r) => r.origin_id === chemOriginId);
  assert.equal(chemRow.is_held, false);
  assertDecimalEqual(chemRow.available_quantity, "500");

  const equipRow = opStock.rows.find((r) => r.origin_id === equipOriginId);
  assert.equal(equipRow.is_held, false);
  assertDecimalEqual(equipRow.available_quantity, "3");
});

// ============================================================================
// TEST 11: Security & Auth: Role Denial, Direct DML Denial & Replay Auth Loss
// ============================================================================
test("S2 Inventory: Security & auth role denial, direct DML denial & replay auth loss", async () => {
  const service = getServiceClient();
  const anon = getAnonClient();
  const admin = await createTestUser(service, "admin", true);
  const lecturer = await createTestUser(service, "lecturer", true);
  const ta = await createTestUser(service, "teaching_assistant", true);

  // 1. Lecturer, TA, Anon denied inventory_command and inventory_read
  for (const user of [lecturer, ta]) {
    const { error: cmdErr } = await user.client.rpc("inventory_command", {
      p_operation: "transfer_stock",
      p_payload: {},
      p_retry_key: crypto.randomUUID(),
    });
    assert.ok(cmdErr);
    assert.match(cmdErr.message, /AUTH_DENIED/);

    const { error: readErr } = await user.client.rpc("inventory_read", {
      p_resource: "operation_stock",
      p_filters: {},
    });
    assert.ok(readErr);
    assert.match(readErr.message, /AUTH_DENIED/);
  }

  const { error: anonErr } = await anon.rpc("inventory_read", {
    p_resource: "operation_stock",
  });
  assert.ok(anonErr);

  // 2. Direct DML revoked on new S2 tables for authenticated
  const { error: dmlSurplusErr } = await admin.client
    .from("inventory_stocktake_surplus_records")
    .insert({ surplus_reference: "DIRECT_HACK" });
  assert.ok(dmlSurplusErr, "Direct INSERT on surplus records must be revoked");

  const { error: dmlHoldErr } = await admin.client
    .from("inventory_stock_holds")
    .insert({ status: "active" });
  assert.ok(dmlHoldErr, "Direct INSERT on stock holds must be revoked");

  const { error: dmlEvErr } = await admin.client
    .from("inventory_stock_evidence")
    .insert({ action: "DIRECT" });
  assert.ok(dmlEvErr, "Direct INSERT on stock evidence must be revoked");

  // 3. Replay Auth Loss: Staff executes command, then is inactivated; replay is denied
  const demoteStaff = await createTestUser(service, "staff", true);
  const replayKey = crypto.randomUUID();
  const ns = crypto.randomUUID().slice(0, 6);

  const { data: firstRes, error: firstErr } = await demoteStaff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_location",
      p_payload: {
        code: `LOC_REPLAY_${ns.toUpperCase()}`,
        name: `Replay Loc ${ns}`,
      },
      p_retry_key: replayKey,
    },
  );
  assert.ifError(firstErr);
  assert.ok(firstRes.id);

  // Inactivate staff user
  await service
    .from("profiles")
    .update({ is_active: false })
    .eq("id", demoteStaff.userId);

  // Replay request with same key: must fail with AUTH_DENIED!
  const { error: replayErr } = await demoteStaff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_location",
      p_payload: {
        code: `LOC_REPLAY_${ns.toUpperCase()}`,
        name: `Replay Loc ${ns}`,
      },
      p_retry_key: replayKey,
    },
  );
  assert.ok(replayErr, "Replaying as inactivated user must be denied");
  assert.match(replayErr.message, /AUTH_DENIED/);
});

// ============================================================================
// TEST 12: S1 Operational Correction Guard Refusal (even after zero-delta count or transfer)
// ============================================================================
test("S2 Inventory: Operational correction guard refuses original-intake corrections after transfer/movement", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fixtures = await setupMasterFixtures(admin, staff, ns);

  // 1. Receive 10 units at Location A
  const itemCode = `ITEM_GD_${ns.toUpperCase()}`;
  const { data: itemRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: `Guard Test Item ${ns}`,
      category_id: fixtures.categoryId,
      material_kind: "other",
      base_uom_code: fixtures.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });
  const itemId = itemRes.id;

  const { data: srcRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: `SRC-GD-${ns}`,
      supplier_id: fixtures.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: lineRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: srcRes.id,
      expected_revision: 1,
      line_key: "L1",
      catalog_item_id: itemId,
      expected_purchase_quantity: "10",
      purchase_uom_code: fixtures.uomDiscrete,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: rxRes } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `REC-GD-${ns}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L1",
          source_line_id: lineRes.id,
          catalog_item_id: itemId,
          location_id: fixtures.locationAId,
          purchase_quantity: "10",
          purchase_uom_code: fixtures.uomDiscrete,
          conversion_factor: "1",
          good_quantity: "10",
          damaged_quantity: "0",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  const originId = await getOriginIdFromTransaction(
    staff.client,
    rxRes.transaction_id,
  );

  // 2. Perform a transfer movement of 2 units to Location B
  const { data: trRes, error: trErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "transfer_stock",
      p_payload: {
        source_location_id: fixtures.locationAId,
        target_location_id: fixtures.locationBId,
        reason: "Moving 2 units",
        lines: [
          {
            origin_id: originId,
            expected_version: 0,
            expected_stock_revision: 1,
            condition: "good",
            quantity: "2",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(trErr);
  assert.ok(trRes.transaction_id);

  // 3. Attempt to correct original receipt: Must fail with DEPENDENT_FACT!
  const { error: correctErr } = await staff.client.rpc("inventory_command", {
    p_operation: "correct_receipt",
    p_payload: {
      transaction_id: rxRes.transaction_id,
      reason: "Attempting intake correction after downstream physical transfer",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          location_id: fixtures.locationAId,
          purchase_quantity: "9",
          purchase_uom_code: fixtures.uomDiscrete,
          conversion_factor: "1",
          good_quantity: "9",
          damaged_quantity: "0",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(
    correctErr,
    "Original intake correction after physical transfer must be refused",
  );
  assert.match(
    correctErr.message,
    /DEPENDENT_FACT/,
    "Must throw DEPENDENT_FACT exception",
  );

  // 4. Attempt to reverse original receipt: Must also fail with DEPENDENT_FACT!
  const { error: reverseErr } = await staff.client.rpc("inventory_command", {
    p_operation: "reverse_receipt",
    p_payload: {
      transaction_id: rxRes.transaction_id,
      reason: "Attempting receipt reversal after downstream transfer",
      versions: [
        {
          origin_id: originId,
          expected_version: 0,
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ok(
    reverseErr,
    "Original intake reversal after physical transfer must be refused",
  );
  assert.match(
    reverseErr.message,
    /DEPENDENT_FACT/,
    "Must throw DEPENDENT_FACT exception",
  );
});

// ============================================================================
// TEST 13: Read Models: operation_stock origin_id filter & cohorts actual location
// ============================================================================
test("S2 Inventory: Read models origin_id filter and cohorts actual location", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fixtures = await setupMasterFixtures(admin, staff, ns);

  const itemCode = `ITEM_READ_${ns.toUpperCase()}`;
  const { data: itemRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: itemCode,
      name: `Read Item ${ns}`,
      category_id: fixtures.categoryId,
      material_kind: "other",
      base_uom_code: fixtures.uomDiscrete,
      tracking_strategy: "quantity",
      return_semantics: "nonreturnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });
  const itemId = itemRes.id;

  const { data: srcRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source",
    p_payload: {
      source_reference: `SRC-READ-${ns}`,
      supplier_id: fixtures.supplierId,
      reference_date: "2026-10-01",
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: lineRes } = await staff.client.rpc("inventory_command", {
    p_operation: "create_acquisition_source_line",
    p_payload: {
      acquisition_record_id: srcRes.id,
      source_id: srcRes.id,
      expected_revision: 1,
      line_key: "L1",
      catalog_item_id: itemId,
      expected_purchase_quantity: "10",
      purchase_uom_code: fixtures.uomDiscrete,
    },
    p_retry_key: crypto.randomUUID(),
  });

  const { data: rxRes } = await staff.client.rpc("inventory_command", {
    p_operation: "receive_stock",
    p_payload: {
      receipt_reference: `REC-READ-${ns}`,
      occurred_at: new Date().toISOString(),
      lines: [
        {
          line_key: "L1",
          source_line_id: lineRes.id,
          catalog_item_id: itemId,
          location_id: fixtures.locationAId,
          purchase_quantity: "10",
          purchase_uom_code: fixtures.uomDiscrete,
          conversion_factor: "1",
          good_quantity: "10",
          damaged_quantity: "0",
          expiry_precision: "not_required",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  const originId = await getOriginIdFromTransaction(
    staff.client,
    rxRes.transaction_id,
  );

  // 1. Partial transfer: Move 4 units from A to B (A has 6, B has 4)
  const { error: tr1Err } = await staff.client.rpc("inventory_command", {
    p_operation: "transfer_stock",
    p_payload: {
      source_location_id: fixtures.locationAId,
      target_location_id: fixtures.locationBId,
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 1,
          condition: "good",
          quantity: "4",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(tr1Err);

  // Test operation_stock origin_id filter:
  const { data: opFiltered } = await staff.client.rpc("inventory_read", {
    p_resource: "operation_stock",
    p_filters: { origin_id: originId },
  });
  assert.equal(opFiltered.total, 2);
  assert.deepEqual(
    opFiltered.rows
      .map((row) => [row.origin_id, row.location_id, toScaled(row.quantity)])
      .sort((a, b) => a[1].localeCompare(b[1])),
    [
      [originId, fixtures.locationAId, 6000000n],
      [originId, fixtures.locationBId, 4000000n],
    ].sort((a, b) => a[1].localeCompare(b[1])),
  );

  // Test operation_stock provenance_group filter:
  const { data: opProvReceive } = await staff.client.rpc("inventory_read", {
    p_resource: "operation_stock",
    p_filters: {
      origin_id: originId,
      provenance_group: `receipt:REC-READ-${ns}`,
    },
  });
  assert.equal(opProvReceive.total, 2);

  const { data: opProvSurplus } = await staff.client.rpc("inventory_read", {
    p_resource: "operation_stock",
    p_filters: { origin_id: originId, provenance_group: "STOCKTAKE_SURPLUS" },
  });
  assert.equal(
    opProvSurplus.total,
    0,
    "Provenance filter must exclude non-matching origins",
  );

  // Test cohorts unfiltered when split across A(6) and B(4):
  const { data: cohortSplit } = await staff.client.rpc("inventory_read", {
    p_resource: "cohorts",
    p_filters: { origin_id: originId },
  });
  assert.equal(cohortSplit.rows.length, 1);
  assert.equal(
    cohortSplit.rows[0].location_state,
    "split",
    "Split cohort across A & B must report location_state=split",
  );
  assert.equal(
    cohortSplit.rows[0].current_location_id,
    null,
    "Split cohort must have current_location_id=null",
  );
  assert.equal(
    cohortSplit.rows[0].locations.length,
    2,
    "Split cohort must list both positive locations",
  );
  assertDecimalEqual(
    cohortSplit.rows[0].physical_balance,
    "10",
    "Total physical balance across locations is 10",
  );

  // 2. Transfer remaining 6 units from A to B (A has 0, B has 10)
  const { error: tr2Err } = await staff.client.rpc("inventory_command", {
    p_operation: "transfer_stock",
    p_payload: {
      source_location_id: fixtures.locationAId,
      target_location_id: fixtures.locationBId,
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 2,
          condition: "good",
          quantity: "6",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(tr2Err);

  // Test cohorts unfiltered when all moved to B (single location):
  const { data: cohortSingle } = await staff.client.rpc("inventory_read", {
    p_resource: "cohorts",
    p_filters: { origin_id: originId },
  });
  assert.equal(cohortSingle.rows.length, 1);
  assert.equal(
    cohortSingle.rows[0].location_state,
    "single",
    "Single positive location must report location_state=single",
  );
  assert.equal(cohortSingle.rows[0].current_location_id, fixtures.locationBId);
  assert.equal(
    cohortSingle.rows[0].intake_location_id,
    fixtures.locationAId,
    "Intake location remains historical Location A",
  );
  assert.equal(cohortSingle.rows[0].locations.length, 1);
  assertDecimalEqual(cohortSingle.rows[0].physical_balance, "10");

  // Filtered by Location B: discovers stock
  const { data: cohortAtB } = await staff.client.rpc("inventory_read", {
    p_resource: "cohorts",
    p_filters: { location_id: fixtures.locationBId, origin_id: originId },
  });
  assert.equal(cohortAtB.rows.length, 1);
  assert.equal(cohortAtB.rows[0].current_location_id, fixtures.locationBId);
  assertDecimalEqual(cohortAtB.rows[0].good_balance, "10");

  // Filtered by Location A: 0 rows because stock at A is 0
  const { data: cohortAtA } = await staff.client.rpc("inventory_read", {
    p_resource: "cohorts",
    p_filters: { location_id: fixtures.locationAId, origin_id: originId },
  });
  assert.equal(
    cohortAtA.rows.length,
    0,
    "Transferred cohort must not match original location when balance is 0",
  );

  // 3. Count to 0 at Location B (all stock depleted):
  const { error: stkDepleteErr } = await staff.client.rpc("inventory_command", {
    p_operation: "reconcile_stocktake",
    p_payload: {
      stocktake_reference: `STK-DEPLETE-${ns}`,
      location_id: fixtures.locationBId,
      count_timestamp: new Date().toISOString(),
      reason: "Depleting stock",
      evidence_note: "Stock depleted",
      lines: [
        {
          origin_id: originId,
          expected_version: 0,
          expected_stock_revision: 3,
          condition: "good",
          expected_quantity: "10",
          counted_quantity: "0",
        },
      ],
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(stkDepleteErr);

  // Test cohorts unfiltered when depleted (0 across warehouse):
  const { data: cohortDepleted } = await staff.client.rpc("inventory_read", {
    p_resource: "cohorts",
    p_filters: { origin_id: originId },
  });
  assert.equal(cohortDepleted.rows.length, 1);
  assert.equal(
    cohortDepleted.rows[0].location_state,
    "depleted",
    "Zero stock across warehouse must report location_state=depleted",
  );
  assert.equal(
    cohortDepleted.rows[0].current_location_id,
    null,
    "Depleted cohort has current_location_id=null",
  );
  assert.equal(
    cohortDepleted.rows[0].locations.length,
    0,
    "Depleted cohort has empty locations array",
  );
  assertDecimalEqual(cohortDepleted.rows[0].physical_balance, "0");
});
test("S2 Inventory: Same-cohort two-condition (good + damaged) batch transfer & count reconciliation", async () => {
  const service = getServiceClient();
  const admin = await createTestUser(service, "admin", true);
  const staff = await createTestUser(service, "staff", true);
  const ns = crypto.randomUUID().slice(0, 6);
  const fixtures = await setupMasterFixtures(admin, staff, ns);

  // 1. Create item and intake 10 good and 5 damaged units at Location A
  const itemCode = `ITEM_2COND_${ns.toUpperCase()}`;
  const { data: itemRes, error: itemErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_item",
      p_payload: {
        code: itemCode,
        name: `Two-Condition Item ${ns}`,
        category_id: fixtures.categoryId,
        material_kind: "other",
        base_uom_code: fixtures.uomDiscrete,
        tracking_strategy: "quantity",
        return_semantics: "nonreturnable",
        expiry_required: false,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(itemErr);
  const itemId = itemRes.id;

  const { data: srcRes, error: srcErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source",
      p_payload: {
        source_reference: `SRC-2COND-${ns}`,
        supplier_id: fixtures.supplierId,
        reference_date: "2026-10-01",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(srcErr);

  const { data: lineRes, error: lineErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "create_acquisition_source_line",
      p_payload: {
        acquisition_record_id: srcRes.id,
        expected_revision: 1,
        line_key: "L1",
        catalog_item_id: itemId,
        expected_purchase_quantity: "15",
        purchase_uom_code: fixtures.uomDiscrete,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(lineErr);

  const { data: rxRes, error: rxErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "receive_stock",
      p_payload: {
        receipt_reference: `REC-2COND-${ns}`,
        occurred_at: new Date().toISOString(),
        lines: [
          {
            line_key: "L1",
            source_line_id: lineRes.id,
            catalog_item_id: itemId,
            location_id: fixtures.locationAId,
            purchase_quantity: "15",
            purchase_uom_code: fixtures.uomDiscrete,
            conversion_factor: "1",
            good_quantity: "10",
            damaged_quantity: "5",
            expiry_precision: "not_required",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(rxErr);
  const originId = await getOriginIdFromTransaction(
    staff.client,
    rxRes.transaction_id,
  );

  // 2. Transfer both good (3 units) and damaged (2 units) in ONE batch command:
  // Both lines have expected_version: 0 and expected_stock_revision: 1.
  // Must NOT self-invalidate revision after first line!
  const { data: tr2CondRes, error: tr2CondErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "transfer_stock",
      p_payload: {
        source_location_id: fixtures.locationAId,
        target_location_id: fixtures.locationBId,
        reason: "Transferring both good and damaged in single batch",
        lines: [
          {
            origin_id: originId,
            expected_version: 0,
            expected_stock_revision: 1,
            condition: "good",
            quantity: "3",
          },
          {
            origin_id: originId,
            expected_version: 0,
            expected_stock_revision: 1,
            condition: "damaged",
            quantity: "2",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(
    tr2CondErr,
    "Multi-condition transfer of same cohort in single batch must succeed",
  );
  assert.ok(tr2CondRes.transaction_id);

  // Verify Location B balances: good: 3, damaged: 2
  const { data: balBGood } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: {
      item_id: itemId,
      location_id: fixtures.locationBId,
      condition: "good",
    },
  });
  assertDecimalEqual(balBGood.rows[0].quantity, "3");

  const { data: balBDamaged } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: {
      item_id: itemId,
      location_id: fixtures.locationBId,
      condition: "damaged",
    },
  });
  assertDecimalEqual(balBDamaged.rows[0].quantity, "2");

  // Stock revision was incremented once for the cohort (1 -> 2)
  const opStockB = await getOriginDetails(staff.client, originId);
  assert.equal(opStockB.stock_revision, 2);

  // A fresh first condition must not authorize a stale second observation.
  const { error: mixedCountError } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "reconcile_stocktake",
      p_payload: {
        stocktake_reference: `STK-MIXED-STALE-${ns}`,
        location_id: fixtures.locationAId,
        count_timestamp: new Date().toISOString(),
        reason: "Reject mixed snapshot observations",
        evidence_note: "Second condition retains an older stock revision",
        lines: [
          {
            origin_id: originId,
            condition: "good",
            expected_version: 0,
            expected_stock_revision: 2,
            expected_quantity: "7",
            counted_quantity: "6",
          },
          {
            origin_id: originId,
            condition: "damaged",
            expected_version: 0,
            expected_stock_revision: 1,
            expected_quantity: "3",
            counted_quantity: "4",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.match(mixedCountError?.message ?? "", /STALE_REVISION/);

  const { error: mixedTransferError } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "transfer_stock",
      p_payload: {
        source_location_id: fixtures.locationAId,
        target_location_id: fixtures.locationBId,
        reason: "Reject mixed fact versions",
        lines: [
          {
            origin_id: originId,
            condition: "good",
            expected_version: 0,
            expected_stock_revision: 2,
            quantity: "1",
          },
          {
            origin_id: originId,
            condition: "damaged",
            expected_version: 1,
            expected_stock_revision: 2,
            quantity: "1",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.match(mixedTransferError?.message ?? "", /STALE_REVISION/);

  // 3. Reconcile both good and damaged conditions in ONE batch stocktake at Location A:
  // Location A currently has good: 7, damaged: 3.
  // Count good: 6 (delta -1), count damaged: 4 (delta +1).
  // Both lines have expected_stock_revision: 2.
  // Must NOT self-invalidate revision after first line!
  const { data: stk2CondRes, error: stk2CondErr } = await staff.client.rpc(
    "inventory_command",
    {
      p_operation: "reconcile_stocktake",
      p_payload: {
        stocktake_reference: `STK-2COND-${ns}`,
        location_id: fixtures.locationAId,
        count_timestamp: new Date().toISOString(),
        reason: "Counting both good and damaged at Location A",
        evidence_note: "Audited two-condition count",
        lines: [
          {
            origin_id: originId,
            expected_version: 0,
            expected_stock_revision: 2,
            condition: "good",
            expected_quantity: "7",
            counted_quantity: "6",
          },
          {
            origin_id: originId,
            expected_version: 0,
            expected_stock_revision: 2,
            condition: "damaged",
            expected_quantity: "3",
            counted_quantity: "4",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(
    stk2CondErr,
    "Multi-condition stocktake count of same cohort in single batch must succeed",
  );
  assert.ok(stk2CondRes.transaction_id);

  // Verify Location A balances: good: 6, damaged: 4
  const { data: balAGoodAfter } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: {
      item_id: itemId,
      location_id: fixtures.locationAId,
      condition: "good",
    },
  });
  assertDecimalEqual(balAGoodAfter.rows[0].quantity, "6");

  const { data: balADamagedAfter } = await staff.client.rpc("inventory_read", {
    p_resource: "balances",
    p_filters: {
      item_id: itemId,
      location_id: fixtures.locationAId,
      condition: "damaged",
    },
  });
  assertDecimalEqual(balADamagedAfter.rows[0].quantity, "4");
});
