import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  assertLocalSupabaseTarget,
  resolveEffectiveSupabaseTestConfig,
} from "./helpers/local-test-safety.mjs";
import { createCanonicalScheduleFixture } from "./helpers/canonical-schedule-fixture.mjs";

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

async function createActor(service, role, roomTypeId = null) {
  const email = `s4-${role}-${crypto.randomUUID()}@campus.local`;
  const password = "LocalS4TestPassword123!";
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { preapproved: true },
    user_metadata: { full_name: `S4 ${role}` },
  });
  assert.ifError(error);
  const id = data.user.id;
  await service.from("profiles").upsert({
    id,
    email,
    full_name: `S4 ${role}`,
    phone: "0901234567",
    is_active: true,
  });
  await service.from("user_roles").insert({ user_id: id, role });

  // Explicit room-type assignment matching the fixture's room type
  if (roomTypeId) {
    await service
      .from("profile_room_types")
      .upsert({ profile_id: id, room_type_id: roomTypeId });
  }

  const client = createClient(localEnv.supabaseUrl, localEnv.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });
  assert.ifError(signInError);
  return { id, email, client };
}

test("S4: Tab lock, exact decimal multi-source reservation, adjustment and strict reversal", async () => {
  const service = getServiceClient();

  // 1. Create schedule using canonical dependency fixture
  const adminActor = await createActor(service, "admin");
  const fixture = await createCanonicalScheduleFixture(service, adminActor.id);

  // 2. Create scoped lecturer and scoped staff matching the fixture's room type
  const lecturer = await createActor(
    service,
    "lecturer",
    fixture.skillsRoomTypeId,
  );
  const scopedStaff = await createActor(
    service,
    "staff",
    fixture.skillsRoomTypeId,
  );

  // 3. Create active equipment catalog item
  const catalogId = crypto.randomUUID();
  const catNonce = crypto.randomBytes(4).toString("hex");
  const { error: catErr } = await service.from("equipment_catalog").insert({
    id: catalogId,
    item_name: `S4 Item ${catNonce}`,
    commercial_name: `S4 Commercial ${catNonce}`,
    unit: "chai",
    is_active: true,
  });
  assert.ifError(catErr);

  // 4. Create inventory category, UOM, and active catalog item via public RPC
  const { data: catRes, error: catResErr } = await adminActor.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_category",
      p_payload: {
        code: `CAT_${catNonce.toUpperCase()}`,
        name: `Category ${catNonce}`,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(catResErr);
  const catId = catRes.id;

  const uom = `uom_${catNonce.slice(0, 6)}`;
  const { error: uomErr } = await adminActor.client.rpc("inventory_command", {
    p_operation: "create_inventory_uom",
    p_payload: {
      code: uom,
      name: `Milliliter ${catNonce}`,
      dimension: "volume",
      allowed_scale: 6,
    },
    p_retry_key: crypto.randomUUID(),
  });
  assert.ifError(uomErr);

  const { data: itemRes, error: itemErr } = await adminActor.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_item",
      p_payload: {
        code: `INV_${catNonce.toUpperCase()}`,
        name: `Physical Solution ${catNonce}`,
        category_id: catId,
        material_kind: "other",
        base_uom_code: uom,
        tracking_strategy: "quantity",
        return_semantics: "nonreturnable",
        expiry_required: false,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(itemErr);
  const invItemId = itemRes.id;

  // 5. Create storage locations via public RPC
  const { data: locARes, error: locAErr } = await adminActor.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_location",
      p_payload: {
        code: `LOC_A_${catNonce.toUpperCase()}`,
        name: `Warehouse A ${catNonce}`,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(locAErr);
  const locA = locARes.id;

  const { data: locBRes, error: locBErr } = await adminActor.client.rpc(
    "inventory_command",
    {
      p_operation: "create_inventory_location",
      p_payload: {
        code: `LOC_B_${catNonce.toUpperCase()}`,
        name: `Warehouse B ${catNonce}`,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(locBErr);
  const locB = locBRes.id;

  // 6. Confirm initial opening balance for physical stock
  const { error: openError } = await adminActor.client.rpc(
    "inventory_command",
    {
      p_operation: "confirm_opening_balance",
      p_payload: {
        synthetic: true,
        cutover_key: `OPEN_${catNonce.toUpperCase()}`,
        scope_description: "S4 test opening",
        count_cutoff: new Date().toISOString(),
        provenance_note: "S4 test opening",
        lines: [
          {
            line_key: "1",
            provenance_group: "1",
            catalog_item_id: invItemId,
            location_id: locA,
            good_quantity: "0.400000",
            damaged_quantity: "0",
            expiry_precision: "not_required",
          },
          {
            line_key: "2",
            provenance_group: "2",
            catalog_item_id: invItemId,
            location_id: locB,
            good_quantity: "0.600000",
            damaged_quantity: "0",
            expiry_precision: "not_required",
          },
        ],
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(openError);

  // 7. Lecturer creates equipment request for 10 units
  const { data: reqId, error: createError } = await lecturer.client.rpc(
    "create_equipment_request_with_items",
    {
      target_class_schedule_id: fixture.scheduleId,
      target_semester: "HK1",
      target_responsible_lecturer_id: lecturer.id,
      target_receive_at: fixture.receiveAt,
      target_return_at: fixture.returnAt,
      target_late_registration_reason: null,
      target_note: "S4 canonical integration test",
      target_items: [
        { skill_name: "Skill 1", catalog_item_id: catalogId, quantity: 10 },
      ],
    },
  );
  assert.ifError(createError);

  // 8. Staff reads workspace
  const { data: initialWorkspace, error: readInitErr } =
    await scopedStaff.client.rpc("equipment_preparation_read", {
      p_request_id: reqId,
    });
  assert.ifError(readInitErr);
  assert.equal(initialWorkspace.manager, true);
  const lineId = initialWorkspace.lines[0].id;
  assert.equal(initialWorkspace.lines[0].registered_quantity, "10");

  // 9. Admin maps equipment catalog item to inventory item (1 unit = 0.1 ml)
  const { data: mapData, error: mapError } = await adminActor.client.rpc(
    "equipment_preparation_command",
    {
      p_request_id: reqId,
      p_operation: "map_item",
      p_payload: {
        expected_revision: initialWorkspace.request.revision,
        catalog_item_id: catalogId,
        inventory_item_id: invItemId,
        base_units_per_requested_unit: "0.100000",
        reason: "1 unit = 0.1 ml",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(mapError);
  const mappingId = mapData.mapping_id;

  // 10. Staff acquires tab lock
  const lockToken1 = crypto.randomUUID();
  const { data: wsBeforeStart } = await scopedStaff.client.rpc(
    "equipment_preparation_read",
    { p_request_id: reqId },
  );
  const { error: startError } = await scopedStaff.client.rpc(
    "equipment_preparation_command",
    {
      p_request_id: reqId,
      p_operation: "start",
      p_payload: {
        expected_revision: wsBeforeStart.request.revision,
        lock_token: lockToken1,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(startError);

  // 11. Competing actor cannot acquire lock while active
  const lockToken2 = crypto.randomUUID();
  const { error: lockConflict } = await adminActor.client.rpc(
    "equipment_preparation_command",
    {
      p_request_id: reqId,
      p_operation: "start",
      p_payload: {
        expected_revision: wsBeforeStart.request.revision,
        lock_token: lockToken2,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.match(lockConflict?.message || "", /S4_LOCK_HELD/);

  // 12. Staff confirms preparation: allocates 0.4 ml from locA and 0.6 ml from locB
  const planPayload = {
    lines: [
      {
        line_id: lineId,
        planned_quantity: "10",
        reviewed_revision: 1,
        shortage_reason: "",
        allocations: [
          {
            mapping_id: mappingId,
            location_id: locA,
            base_quantity: "0.400000",
            asset_ids: [],
          },
          {
            mapping_id: mappingId,
            location_id: locB,
            base_quantity: "0.600000",
            asset_ids: [],
          },
        ],
      },
    ],
  };
  const { error: confirmError } = await scopedStaff.client.rpc(
    "equipment_preparation_command",
    {
      p_request_id: reqId,
      p_operation: "confirm",
      p_payload: {
        expected_revision: wsBeforeStart.request.revision,
        lock_token: lockToken1,
        draft_revision: 1,
        plan: planPayload,
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(confirmError);

  // 13. Verify request transitions to PREPARED and reservations are held
  const { data: confirmedWorkspace } = await scopedStaff.client.rpc(
    "equipment_preparation_read",
    { p_request_id: reqId },
  );
  assert.equal(confirmedWorkspace.request.status, "preparing");
  assert.equal(confirmedWorkspace.preparation.state, "prepared");

  // Stock A availability is now 0 (all 0.4 reserved)
  // Verify reservations were recorded via authenticated scopedStaff client
  const { data: reservations, error: resErr } = await scopedStaff.client
    .from("inventory_reservations")
    .select("location_id, quantity")
    .eq("preparation_id", confirmedWorkspace.preparation.id);
  assert.ifError(resErr);
  assert.equal(reservations.length, 2);
  const locAReservation = reservations.find((r) => r.location_id === locA);
  assert.equal(Number(locAReservation.quantity), 0.4);

  // 14. Lecturer proposes adjustment: reduce quantity to 6
  const { data: proposalData, error: propError } = await lecturer.client.rpc(
    "equipment_preparation_command",
    {
      p_request_id: reqId,
      p_operation: "propose_adjustment",
      p_payload: {
        expected_revision: confirmedWorkspace.request.revision,
        targets: [{ line_id: lineId, quantity: "6" }],
        reason: "Lớp học giảm sinh viên",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(propError);
  assert.equal(
    proposalData.preparation,
    undefined,
    "Participant proposal response does not disclose draft",
  );

  // 15. Staff approves adjustment with new allocation (0.2 from locA, 0.4 from locB = 0.6 ml = 6 units)
  const adjustedPlan = {
    lines: [
      {
        line_id: lineId,
        planned_quantity: "6",
        reviewed_revision: 1,
        shortage_reason: "Lớp học giảm sinh viên",
        allocations: [
          {
            mapping_id: mappingId,
            location_id: locA,
            base_quantity: "0.200000",
            asset_ids: [],
          },
          {
            mapping_id: mappingId,
            location_id: locB,
            base_quantity: "0.400000",
            asset_ids: [],
          },
        ],
      },
    ],
  };
  const { error: approveError } = await scopedStaff.client.rpc(
    "equipment_preparation_command",
    {
      p_request_id: reqId,
      p_operation: "approve_adjustment",
      p_payload: {
        expected_revision: confirmedWorkspace.request.revision,
        adjustment_id: proposalData.adjustment_id,
        reviewed_revision: confirmedWorkspace.request.revision,
        plan: adjustedPlan,
        reason: "Duyệt giảm số lượng",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(approveError);

  // 16. Verify baseline is preserved (10) while current planned is updated (6)
  const { data: postApprove } = await scopedStaff.client.rpc(
    "equipment_preparation_read",
    { p_request_id: reqId },
  );
  assert.equal(postApprove.lines[0].planned_quantity, "6");
  assert.equal(postApprove.lines[0].registered_quantity, "10");

  // 17. Reversal: begin reversal transitions state to 'reversing'
  const { error: beginRevError } = await scopedStaff.client.rpc(
    "equipment_preparation_command",
    {
      p_request_id: reqId,
      p_operation: "begin_reversal",
      p_payload: {
        expected_revision: postApprove.request.revision,
        reason: "Hủy chuẩn bị để phân bổ lại",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(beginRevError);

  const { data: reversingWorkspace } = await scopedStaff.client.rpc(
    "equipment_preparation_read",
    { p_request_id: reqId },
  );
  assert.equal(reversingWorkspace.preparation.state, "reversing");

  // 18. Finalize reversal releases reservations and rolls request back to 'new'
  const { error: finalizeError } = await scopedStaff.client.rpc(
    "equipment_preparation_command",
    {
      p_request_id: reqId,
      p_operation: "finalize_reversal",
      p_payload: {
        expected_revision: reversingWorkspace.request.revision,
        reason: "Hoàn tất đảo về NEW không có nợ chuyển kho",
      },
      p_retry_key: crypto.randomUUID(),
    },
  );
  assert.ifError(finalizeError);

  const { data: reversedWorkspace } = await scopedStaff.client.rpc(
    "equipment_preparation_read",
    { p_request_id: reqId },
  );
  assert.equal(reversedWorkspace.request.status, "new");
  assert.equal(reversedWorkspace.preparation.state, "reversed");

  // Race independent requests for the same final pool, then the same exact asset.
  async function rpc(client, name, args) {
    const { data, error } = await client.rpc(name, args);
    assert.ifError(error);
    return data;
  }
  const countUom = `s4_count_${catNonce}`;
  await rpc(adminActor.client, "inventory_command", {
    p_operation: "create_inventory_uom",
    p_payload: {
      code: countUom,
      name: "S4 count",
      dimension: "count",
      allowed_scale: 0,
    },
    p_retry_key: crypto.randomUUID(),
  });
  const assetItem = await rpc(adminActor.client, "inventory_command", {
    p_operation: "create_inventory_item",
    p_payload: {
      code: `S4_ASSET_${catNonce}`,
      name: "S4 race asset",
      category_id: catId,
      base_uom_code: countUom,
      material_kind: "other",
      tracking_strategy: "serialized",
      return_semantics: "returnable",
      expiry_required: false,
    },
    p_retry_key: crypto.randomUUID(),
  });
  const asset = await rpc(adminActor.client, "equipment_asset_command", {
    p_operation: "open_asset",
    p_payload: {
      catalog_item_id: assetItem.id,
      location_id: locA,
      intake_reference: `S4-RACE-${catNonce}`,
      row_key: "1",
      expiry_precision: "not_required",
      reason: "Synthetic race fixture",
      evidence_note: "S4 concurrency acceptance",
    },
    p_retry_key: crypto.randomUUID(),
  });
  await rpc(adminActor.client, "equipment_asset_command", {
    p_operation: "set_asset_lifecycle",
    p_payload: {
      id: asset.id,
      expected_revision: 1,
      lifecycle_status: "in_service",
      reason: "Available race fixture",
      evidence_note: "Verified synthetic opening",
    },
    p_retry_key: crypto.randomUUID(),
  });
  const assetCatalogId = crypto.randomUUID();
  const { error: assetCatalogError } = await service
    .from("equipment_catalog")
    .insert({
      id: assetCatalogId,
      item_name: `S4 Race ${catNonce}`,
      commercial_name: `S4 Race Asset ${catNonce}`,
      unit: "cái",
      is_active: true,
    });
  assert.ifError(assetCatalogError);
  for (const serialized of [false, true]) {
    const raceCatalogId = serialized ? assetCatalogId : catalogId;
    const contenders = [];
    let raceMappingId = mappingId;
    for (let index = 0; index < 2; index++) {
      const raceFixture = await createCanonicalScheduleFixture(
        service,
        adminActor.id,
      );
      const id = await rpc(
        lecturer.client,
        "create_equipment_request_with_items",
        {
          target_class_schedule_id: raceFixture.scheduleId,
          target_semester: "HK1",
          target_responsible_lecturer_id: lecturer.id,
          target_receive_at: raceFixture.receiveAt,
          target_return_at: raceFixture.returnAt,
          target_late_registration_reason: null,
          target_note: "S4 simultaneous reservation",
          target_items: [
            {
              skill_name: "Race",
              catalog_item_id: raceCatalogId,
              quantity: serialized ? 1 : 4,
            },
          ],
        },
      );
      let workspace = await rpc(
        scopedStaff.client,
        "equipment_preparation_read",
        { p_request_id: id },
      );
      if (serialized && index === 0) {
        const mapping = await rpc(
          adminActor.client,
          "equipment_preparation_command",
          {
            p_request_id: id,
            p_operation: "map_item",
            p_payload: {
              expected_revision: workspace.request.revision,
              catalog_item_id: raceCatalogId,
              inventory_item_id: assetItem.id,
              base_units_per_requested_unit: "1",
              reason: "Exact race asset",
            },
            p_retry_key: crypto.randomUUID(),
          },
        );
        raceMappingId = mapping.mapping_id;
        workspace = await rpc(
          scopedStaff.client,
          "equipment_preparation_read",
          { p_request_id: id },
        );
      }
      const token = crypto.randomUUID();
      await rpc(scopedStaff.client, "equipment_preparation_command", {
        p_request_id: id,
        p_operation: "start",
        p_payload: {
          expected_revision: workspace.request.revision,
          lock_token: token,
        },
        p_retry_key: crypto.randomUUID(),
      });
      workspace = await rpc(scopedStaff.client, "equipment_preparation_read", {
        p_request_id: id,
      });
      contenders.push({
        id,
        args: {
          p_request_id: id,
          p_operation: "confirm",
          p_retry_key: crypto.randomUUID(),
          p_payload: {
            expected_revision: workspace.request.revision,
            lock_token: token,
            draft_revision: workspace.preparation.revision,
            plan: {
              lines: [
                {
                  line_id: workspace.lines[0].id,
                  planned_quantity: serialized ? "1" : "4",
                  reviewed_revision: workspace.lines[0].line_revision,
                  shortage_reason: "",
                  allocations: [
                    {
                      mapping_id: raceMappingId,
                      location_id: locA,
                      base_quantity: serialized ? "1" : "0.400000",
                      asset_ids: serialized ? [asset.id] : [],
                    },
                  ],
                },
              ],
            },
          },
        },
      });
    }
    const outcomes = await Promise.all(
      contenders.map(({ args }) =>
        scopedStaff.client.rpc("equipment_preparation_command", args),
      ),
    );
    assert.equal(
      outcomes.filter(({ error }) => !error).length,
      1,
      `${serialized ? "Exact asset" : "Final quantity pool"} has exactly one race winner`,
    );
    const loserIndex = outcomes.findIndex(({ error }) => error);
    assert.equal(
      outcomes[loserIndex].error.code,
      serialized ? "23505" : "P0001",
    );
    const after = await Promise.all(
      contenders.map(({ id }) =>
        rpc(scopedStaff.client, "equipment_preparation_read", {
          p_request_id: id,
        }),
      ),
    );
    assert.equal(
      after[loserIndex].request.status,
      "new",
      "losing confirmation is atomic",
    );
    assert.equal(
      after[1 - loserIndex].request.status,
      "preparing",
      "winning confirmation publishes prepared state",
    );
    const { data: ownedReservations, error: reservationError } =
      await scopedStaff.client
        .from("inventory_reservations")
        .select("preparation_id,quantity,asset_id")
        .in(
          "preparation_id",
          after.map(({ preparation }) => preparation.id),
        )
        .is("released_at", null);
    assert.ifError(reservationError);
    assert.deepEqual(
      ownedReservations.map(({ preparation_id, quantity, asset_id }) => ({
        preparation_id,
        quantity: Number(quantity),
        asset_id,
      })),
      [
        {
          preparation_id: after[1 - loserIndex].preparation.id,
          quantity: serialized ? 1 : 0.4,
          asset_id: serialized ? asset.id : null,
        },
      ],
    );
  }
});
