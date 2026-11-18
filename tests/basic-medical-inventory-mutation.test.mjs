import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  assertLocalSupabaseTarget,
  resolveEffectiveSupabaseTestConfig,
} from "./helpers/local-test-safety.mjs";

const BASIC_MEDICAL_ROOM_TYPE_ID = "40000000-0000-0000-0000-000000000002";
const FIXTURE_EMAIL_PREFIX = "y02-inventory-target-";
const FIXTURE_ROOM_CODE_PREFIX = "Y02-INV-TARGET-";
const FIXTURE_CATALOG_NAME_PREFIX = "Y02 inventory target fixture ";

const fileEnv = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [key, ...value] = line.split("=");
      return [key, value.join("=")];
    }),
);
const localEnv = resolveEffectiveSupabaseTestConfig(process.env, fileEnv);

function client(key = localEnv.publishableKey) {
  return createClient(localEnv.supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function inventoryState(row) {
  return {
    room_id: row.room_id,
    catalog_item_id: row.catalog_item_id,
    total_quantity: row.total_quantity,
    good_quantity: row.good_quantity,
    damaged_quantity: row.damaged_quantity,
    is_active: row.is_active,
  };
}

async function cleanupFixture(
  service,
  { inventoryId, catalogItemId, roomId, managerId },
) {
  const cleanupErrors = [];
  const attempt = async (label, operation) => {
    const { error } = await operation;
    if (error) {
      cleanupErrors.push(
        new Error(`${label}: ${error.code ?? "UNKNOWN"} ${error.message}`),
      );
    }
  };

  if (inventoryId) {
    await attempt(
      "delete condition logs",
      service
        .from("basic_medical_equipment_condition_logs")
        .delete()
        .eq("inventory_id", inventoryId),
    );
    await attempt(
      "delete inventory",
      service
        .from("basic_medical_room_inventory")
        .delete()
        .eq("id", inventoryId),
    );
  }
  if (catalogItemId) {
    await attempt(
      "delete catalog item",
      service
        .from("basic_medical_equipment_catalog")
        .delete()
        .eq("id", catalogItemId),
    );
  }
  if (roomId) {
    await attempt(
      "delete room",
      service.from("rooms").delete().eq("id", roomId),
    );
  }
  if (managerId) {
    await attempt("delete test user", service.auth.admin.deleteUser(managerId));
  }

  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, "Y-02 fixture cleanup failed");
  }
}

test("existing inventory cannot bypass inactive Basic Medical targets", async () => {
  assertLocalSupabaseTarget(localEnv.supabaseUrl);

  const service = client(localEnv.secretKey);
  const suffix = crypto.randomUUID();
  const managerEmail = `${FIXTURE_EMAIL_PREFIX}${suffix}@campus.local`;
  const managerPassword = "LocalInventoryTarget123!";
  let managerId;
  let inventoryId;
  let roomId;
  let catalogItemId;
  let primaryFailure;

  try {
    const { data: manager, error: managerError } =
      await service.auth.admin.createUser({
        email: managerEmail,
        password: managerPassword,
        email_confirm: true,
        app_metadata: { preapproved: true },
        user_metadata: { full_name: "Inventory target test manager" },
      });
    assert.ifError(managerError);
    managerId = manager.user.id;
    assert.ifError(
      (
        await service
          .from("profiles")
          .update({ is_active: true })
          .eq("id", managerId)
      ).error,
    );
    assert.ifError(
      (
        await service
          .from("user_roles")
          .insert({ user_id: managerId, role: "admin" })
      ).error,
    );

    const { data: room, error: roomError } = await service
      .from("rooms")
      .insert({
        room_code: `${FIXTURE_ROOM_CODE_PREFIX}${suffix}`,
        building_code: "Y02",
        room_name: "Y-02 inventory target test room",
        room_type_id: BASIC_MEDICAL_ROOM_TYPE_ID,
        is_active: true,
      })
      .select("id")
      .single();
    assert.ifError(roomError);
    roomId = room.id;

    const { data: catalogItem, error: catalogError } = await service
      .from("basic_medical_equipment_catalog")
      .insert({
        item_name: `${FIXTURE_CATALOG_NAME_PREFIX}${suffix}`,
        commercial_name: `${FIXTURE_CATALOG_NAME_PREFIX}commercial-${suffix}`,
        unit: "item",
        is_active: true,
      })
      .select("id")
      .single();
    assert.ifError(catalogError);
    catalogItemId = catalogItem.id;

    const managerClient = client();
    const { error: signInError } = await managerClient.auth.signInWithPassword({
      email: managerEmail,
      password: managerPassword,
    });
    assert.ifError(signInError);

    const created = await managerClient.rpc(
      "set_basic_medical_room_inventory",
      {
        target_inventory_id: null,
        target_room_id: roomId,
        target_catalog_item_id: catalogItemId,
        target_total_quantity: 4,
        target_damaged_quantity: 1,
        target_is_active: true,
        target_note: "Y-02 active target control",
      },
    );
    assert.ifError(created.error);
    inventoryId = created.data.id;
    assert.deepEqual(inventoryState(created.data), {
      room_id: roomId,
      catalog_item_id: catalogItemId,
      total_quantity: 4,
      good_quantity: 3,
      damaged_quantity: 1,
      is_active: true,
    });

    const beforeInactiveRoom = inventoryState(created.data);
    assert.ifError(
      (
        await service
          .from("rooms")
          .update({ is_active: false })
          .eq("id", roomId)
      ).error,
    );
    const inactiveRoom = await managerClient.rpc(
      "set_basic_medical_room_inventory",
      {
        target_inventory_id: inventoryId,
        target_room_id: roomId,
        target_catalog_item_id: catalogItemId,
        target_total_quantity: 9,
        target_damaged_quantity: 1,
        target_is_active: true,
        target_note: "must reject inactive room",
      },
    );
    assert.equal(inactiveRoom.error?.code, "22023");
    const { data: afterInactiveRoom, error: afterInactiveRoomError } =
      await service
        .from("basic_medical_room_inventory")
        .select(
          "room_id,catalog_item_id,total_quantity,good_quantity,damaged_quantity,is_active",
        )
        .eq("id", inventoryId)
        .single();
    assert.ifError(afterInactiveRoomError);
    assert.deepEqual(inventoryState(afterInactiveRoom), beforeInactiveRoom);

    assert.ifError(
      (await service.from("rooms").update({ is_active: true }).eq("id", roomId))
        .error,
    );
    assert.ifError(
      (
        await service
          .from("basic_medical_equipment_catalog")
          .update({ is_active: false })
          .eq("id", catalogItemId)
      ).error,
    );
    const inactiveCatalog = await managerClient.rpc(
      "set_basic_medical_room_inventory",
      {
        target_inventory_id: inventoryId,
        target_room_id: roomId,
        target_catalog_item_id: catalogItemId,
        target_total_quantity: 10,
        target_damaged_quantity: 1,
        target_is_active: true,
        target_note: "must reject inactive catalog",
      },
    );
    assert.equal(inactiveCatalog.error?.code, "22023");
    const { data: afterInactiveCatalog, error: afterInactiveCatalogError } =
      await service
        .from("basic_medical_room_inventory")
        .select(
          "room_id,catalog_item_id,total_quantity,good_quantity,damaged_quantity,is_active",
        )
        .eq("id", inventoryId)
        .single();
    assert.ifError(afterInactiveCatalogError);
    assert.deepEqual(inventoryState(afterInactiveCatalog), beforeInactiveRoom);

    assert.ifError(
      (
        await service
          .from("basic_medical_equipment_catalog")
          .update({ is_active: true })
          .eq("id", catalogItemId)
      ).error,
    );
    const activeTarget = await managerClient.rpc(
      "set_basic_medical_room_inventory",
      {
        target_inventory_id: inventoryId,
        target_room_id: roomId,
        target_catalog_item_id: catalogItemId,
        target_total_quantity: 5,
        target_damaged_quantity: 2,
        target_is_active: true,
        target_note: "Y-02 active target update control",
      },
    );
    assert.ifError(activeTarget.error);
    assert.deepEqual(inventoryState(activeTarget.data), {
      room_id: roomId,
      catalog_item_id: catalogItemId,
      total_quantity: 5,
      good_quantity: 3,
      damaged_quantity: 2,
      is_active: true,
    });
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    try {
      await cleanupFixture(service, {
        inventoryId,
        catalogItemId,
        roomId,
        managerId,
      });
    } catch (cleanupFailure) {
      if (primaryFailure) {
        primaryFailure.cleanupFailure = cleanupFailure;
      } else {
        throw cleanupFailure;
      }
    }
  }
});
