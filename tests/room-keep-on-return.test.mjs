import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createS5Harness,
  sqlLiteral,
} from "./helpers/inventory-s5-fixture.mjs";

// t4r2: "Giữ lại cho phòng" is a return into the session room's location.
// Only an Admin may do it, only into that room, and the asset then counts as
// the room's fixed equipment instead of a loan.
test("keeping a borrowed asset in its room is an Admin return into that room", async () => {
  const db = createS5Harness();
  try {
    const fixture = await db.setup();
    const admin = db.actors[0];
    const staff = db.actors[2];
    const request = fixture.request4;
    const workspace = () =>
      db.read(
        staff,
        `public.equipment_fulfillment_read(${sqlLiteral(request)}::uuid)`,
      );
    const room = () =>
      db.read(
        staff,
        `public.room_equipment_read(${sqlLiteral(db.id(10))}::uuid)`,
      );

    const before = await workspace();
    const asset = fixture.asset3.id;
    const issued = await db.command({
      requestId: request,
      operation: "supplement",
      retryKey: crypto.randomUUID(),
      payload: {
        expected_revision: before.revision,
        business_key: crypto.randomUUID(),
        reason: "Synthetic loan into the room",
        lines: [
          {
            line_id: fixture.line4,
            mapping_id: fixture.mapA.mapping_id,
            location_id: db.id(42),
            quantity: "1",
            asset_ids: [asset],
          },
        ],
      },
    });
    assert.equal(issued.ok, true, JSON.stringify(issued));
    const loaned = await workspace();
    const slice = loaned.issues.find((issue) => issue.asset_id === asset);
    const roomLocation = (await room()).room.location_id;
    assert.ok(
      loaned.locations.some(({ id, room }) => id === roomLocation && room),
      "the return form offers the session room, flagged",
    );

    const keep = (actor, locationId) =>
      db.command({
        actor,
        requestId: request,
        operation: "initial_return",
        retryKey: crypto.randomUUID(),
        payload: {
          expected_revision: loaned.revision,
          business_key: crypto.randomUUID(),
          reason: "Giữ lại cho phòng",
          lines: [
            {
              issue_slice_id: slice.id,
              quantity: "1",
              location_id: locationId,
              condition: "good",
            },
          ],
        },
      });

    const byStaff = await keep(staff, roomLocation);
    assert.equal(byStaff.message, "S5_ROOM_KEEP_ADMIN_ONLY");

    const otherRoot = await db.read(
      admin,
      `(select jsonb_build_object('id', l.id) from public.inventory_storage_locations l
         where l.is_room_root and l.room_id <> ${sqlLiteral(db.id(10))}::uuid limit 1)`,
    );
    const wrongRoom = await keep(admin, otherRoot.id);
    assert.equal(wrongRoom.message, "S5_ROOM_KEEP_WRONG_ROOM");

    const kept = await keep(admin, roomLocation);
    assert.equal(kept.ok, true, JSON.stringify(kept));

    const after = await room();
    assert.ok(
      after.assets.some(({ id }) => id === asset),
      "the asset is now fixed in the room",
    );
    assert.ok(
      !after.temporary.some(({ asset_id }) => asset_id === asset),
      "and no longer on loan",
    );
  } finally {
    await db.cleanup();
  }
});
