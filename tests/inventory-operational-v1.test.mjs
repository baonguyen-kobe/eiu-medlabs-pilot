import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { legacyStageFixture } from "./helpers/legacy-equipment-fixture.mjs";
import {
  createS5Harness,
  jsonSql,
  sqlLiteral,
} from "./helpers/inventory-s5-fixture.mjs";

test("operational V1 preserves physical quantities, amendment boundaries and replay", async (t) => {
  const db = createS5Harness({ quantityReturnSemantics: "returnable" });
  let f;
  const ws = async (n) =>
    db.read(
      db.actors[2],
      `public.equipment_fulfillment_read(${sqlLiteral(f[`request${n}`])}::uuid)`,
    );
  const cmd = (n, operation, revision, extra = {}) => ({
    requestId: f[`request${n}`],
    operation,
    retryKey: crypto.randomUUID(),
    payload: {
      expected_revision: revision,
      business_key: crypto.randomUUID(),
      reason: "Synthetic operational V1",
      ...extra,
    },
  });
  const receipt = (slice, quantity, condition = "good") => ({
    issue_slice_id: slice,
    quantity,
    condition,
    location_id: db.id(41),
  });
  try {
    f = await db.setup();
    await t.test(
      "legacy fixture staging refuses missing requests and Inventory history",
      async () => {
        await assert.rejects(
          () => legacyStageFixture(crypto.randomUUID(), "preparing"),
          /LEGACY_FIXTURE_REQUEST_REQUIRED/,
        );
        const before = await ws(1);
        await assert.rejects(
          () => legacyStageFixture(f.request1, "preparing"),
          /REFUSING_INVENTORY_HISTORY_LEGACY_FIXTURE/,
        );
        assert.deepEqual(await ws(1), before);
      },
    );
    await t.test(
      "NEW request editing changes quantity/additions/removals with stable history and scoped authority",
      async () => {
        const request = f.request6;
        const read = () =>
          db.read(
            db.actors[1],
            `public.equipment_preparation_read(${sqlLiteral(request)}::uuid)`,
          );
        let current = await read();
        const original = current.lines[0];
        const edit = (actor, items) =>
          db.read(
            actor,
            `jsonb_build_object('id',public.update_equipment_request_content(${sqlLiteral(request)}::uuid,${sqlLiteral(db.id(106))}::uuid,'HK1',${sqlLiteral(db.actors[1])}::uuid,${sqlLiteral(current.request.receive_at)}::timestamptz,${sqlLiteral(current.request.return_at)}::timestamptz,'Synthetic edit',null,${jsonSql(items)}))`,
          );
        const item = {
          id: original.id,
          catalog_item_id: original.catalog_item_id,
          skill_name: "S5 race",
          quantity: 2,
          expected_revision: current.request.revision,
        };
        const first = [{ ...item, skill_name: "Changed activity" }];
        await edit(db.actors[1], first);
        current = await read();
        assert.equal(current.lines[0].id, original.id);
        assert.equal(
          current.lines[0].registered_quantity,
          original.registered_quantity,
        );
        assert.equal(current.lines[0].demand_quantity, "2");
        await assert.rejects(() => edit(db.actors[1], first), /STALE_REVISION/);
        const before = current;
        const keep = {
          ...item,
          skill_name: "Changed activity",
          quantity: 3,
          expected_revision: current.request.revision,
        };
        const add = {
          catalog_item_id: db.id(20),
          skill_name: "Changed activity",
          quantity: 1,
          expected_revision: current.request.revision,
        };
        await assert.rejects(
          () => edit(db.actors[3], [keep, add]),
          /AUTH_DENIED/,
        );
        assert.deepEqual(await read(), before);
        await edit(db.actors[1], [keep, add]);
        current = await read();
        assert.equal(current.lines.length, 2);
        const added = current.lines.find((line) => line.id !== original.id);
        assert.equal(added.registered_quantity, "0");
        await edit(db.actors[1], [
          {
            id: added.id,
            catalog_item_id: added.catalog_item_id,
            skill_name: added.skill_name,
            quantity: 1,
            expected_revision: current.request.revision,
          },
        ]);
        current = await read();
        assert.equal(current.lines.length, 1);
        assert.equal(current.lines[0].id, added.id);
        const quickAdd = (actor) =>
          db.read(
            actor,
            `jsonb_build_object('id',public.add_equipment_request_item(${sqlLiteral(request)}::uuid,'Changed activity',${sqlLiteral(original.catalog_item_id)}::uuid,2,'Synthetic quick add'))`,
          );
        await assert.rejects(() => quickAdd(db.actors[1]), /AUTH_DENIED/);
        const quick = await quickAdd(db.actors[2]);
        current = await read();
        const quickLine = current.lines.find((line) => line.id === quick.id);
        assert.equal(quickLine.registered_quantity, "0");
        assert.equal(quickLine.demand_quantity, "2");
        assert.equal(quickLine.baseline_source, "added");
        await assert.rejects(
          () => quickAdd(db.actors[2]),
          /EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY/,
        );
        const remove = (actor) =>
          db.read(
            actor,
            `jsonb_build_object('removed',public.remove_equipment_request_item(${sqlLiteral(quick.id)}::uuid))`,
          );
        await assert.rejects(() => remove(db.actors[3]), /AUTH_DENIED/);
        assert.equal((await remove(db.actors[1])).removed, true);
        current = await read();
        assert.equal(current.lines.length, 1);
        assert.equal(current.lines[0].id, added.id);
        const history = await db.read(
          db.actors[0],
          `public.equipment_preparation_read(${sqlLiteral(request)}::uuid,'history')`,
        );
        assert.ok(
          history.rows.some((event) => event.operation === "line_changed"),
        );
      },
    );
    await t.test(
      "new SKU amendment keeps baseline/signatures immutable and has no physical stock effect",
      async () => {
        const before = await ws(3);
        const amendment = cmd(3, "add_supplemental_line", before.revision, {
          line_id: crypto.randomUUID(),
          reference_line_id: f.line3,
          mapping_id: f.mapA.mapping_id,
          location_id: db.id(42),
          requested_quantity: "1",
        });
        const denied = await db.command({ ...amendment, actor: db.actors[1] });
        assert.equal(denied.code, "42501");
        const wrongReference = await db.command({
          ...amendment,
          retryKey: crypto.randomUUID(),
          payload: { ...amendment.payload, reference_line_id: f.line1 },
        });
        assert.equal(wrongReference.message, "S4_INVALID_LINE_ID");
        const added = await db.command(amendment);
        assert.equal(added.ok, true, JSON.stringify(added));
        assert.equal(added.result.stock_effect, false);
        const after = await ws(3);
        assert.equal(after.event_count, before.event_count);
        assert.deepEqual(after.issues, before.issues);
        assert.deepEqual(after.events, before.events);
        const line = after.lines.find(
          (line) => line.id === added.result.line_id,
        );
        assert.equal(String(line.registered_quantity), "0");
        assert.equal(String(line.planned_quantity), "0");
        assert.equal(String(line.requested_quantity), "1");
        assert.equal(line.baseline_source, "added");
        assert.deepEqual(await db.command(amendment), added);
        const again = await db.command({
          ...amendment,
          retryKey: crypto.randomUUID(),
          payload: {
            ...amendment.payload,
            expected_revision: after.revision,
            line_id: crypto.randomUUID(),
          },
        });
        assert.equal(again.message, "S5_NEW_MAPPED_CATALOG_REQUIRED");
        const issue = await db.command(
          cmd(3, "supplement", after.revision, {
            lines: [
              {
                line_id: line.id,
                mapping_id: f.mapA.mapping_id,
                location_id: db.id(42),
                quantity: "1",
                asset_ids: [f.asset3.id],
              },
            ],
          }),
        );
        assert.equal(issue.ok, true, JSON.stringify(issue));
        assert.equal(
          (await ws(3)).issues.some((row) => row.asset_id === f.asset3.id),
          true,
        );
      },
    );
    await t.test(
      "incremental good/damaged returns coexist with cumulative clients and retries",
      async () => {
        let current = await ws(2);
        const slice = current.issues[0].id;
        const initial = await db.command(
          cmd(2, "initial_return", current.revision, {
            lines: [],
            carrier_name: "Synthetic TA carrier",
          }),
        );
        assert.equal(initial.ok, true, JSON.stringify(initial));
        current = await ws(2);
        const incremental = cmd(2, "recover", current.revision, {
          return_entry_mode: "incremental",
          lines: [receipt(slice, "0.04")],
          carrier_name: "Synthetic TA carrier",
        });
        const first = await db.command(incremental);
        assert.equal(first.ok, true, JSON.stringify(first));
        assert.deepEqual(await db.command(incremental), first);
        const mismatch = await db.command({
          ...incremental,
          payload: { ...incremental.payload, return_entry_mode: "cumulative" },
        });
        assert.equal(mismatch.message, "RETRY_PAYLOAD_MISMATCH");
        current = await ws(2);
        assert.equal(Number(current.issues[0].returned), 0.04);
        assert.equal(
          (
            await db.command(
              cmd(2, "recover", current.revision, {
                return_entry_mode: "incremental",
                lines: [receipt(slice, "0.01", "damaged")],
              }),
            )
          ).ok,
          true,
        );
        current = await ws(2);
        assert.equal(Number(current.issues[0].returned), 0.05);
        assert.equal(
          (
            await db.command(
              cmd(2, "recover", current.revision, {
                lines: [receipt(slice, "0.05")],
              }),
            )
          ).ok,
          true,
        );
        current = await ws(2);
        assert.equal(Number(current.issues[0].returned), 0.06);
        const over = await db.command(
          cmd(2, "recover", current.revision, {
            return_entry_mode: "incremental",
            lines: [receipt(slice, "0.05")],
          }),
        );
        assert.equal(over.ok, false);
        const invalid = await db.command(
          cmd(2, "recover", current.revision, {
            return_entry_mode: null,
            lines: [],
          }),
        );
        assert.equal(invalid.message, "S5_INVALID_RETURN_ENTRY_MODE");
        const badStage = await db.command(
          cmd(2, "add_supplemental_line", current.revision, {
            line_id: crypto.randomUUID(),
            reference_line_id: f.line2,
            mapping_id: f.mapA.mapping_id,
            location_id: db.id(42),
            requested_quantity: "1",
          }),
        );
        assert.equal(
          badStage.message,
          "S5_SUPPLEMENT_BEFORE_INITIAL_RETURN_REQUIRED",
        );
        const done = await db.command(
          cmd(2, "recover", current.revision, {
            return_entry_mode: "incremental",
            lines: [receipt(slice, "0.04")],
          }),
        );
        assert.equal(done.ok, true, JSON.stringify(done));
        current = await ws(2);
        assert.equal(Number(current.issues[0].returned), 0.1);
        assert.equal(Number(current.issues[0].due), 0);
        assert.notEqual(
          current.status,
          "completed",
          "Pending signatures still block completion",
        );
      },
    );
    await t.test(
      "correction of incremental receipt replaces actual once and preserves predecessor",
      async () => {
        let current = await ws(2);
        const previous = current.events.find(
          (event) =>
            event.operation === "recover" &&
            event.payload.return_entry_mode === "incremental",
        );
        const slice = current.issues[0].id;
        const correction = await db.command(
          cmd(2, "correct", current.revision, {
            event_id: previous.id,
            lines: [receipt(slice, "0.03")],
          }),
        );
        assert.equal(correction.ok, true, JSON.stringify(correction));
        current = await ws(2);
        assert.equal(Number(current.issues[0].returned), 0.09);
        const predecessor = current.events.find(
          (event) => event.id === previous.id,
        );
        assert.equal(predecessor.superseded, true);
        assert.deepEqual(predecessor.snapshot, previous.snapshot);
      },
    );
    await t.test(
      "incremental late asset return offsets waiver and keeps Admin consequence on hold",
      async () => {
        let current = await ws(4);
        const slice = current.issues[0].id;
        assert.equal(
          (
            await db.command(
              cmd(4, "initial_return", current.revision, { lines: [] }),
            )
          ).ok,
          true,
        );
        current = await ws(4);
        assert.equal(
          (
            await db.command(
              cmd(4, "resolve", current.revision, {
                lines: [
                  {
                    issue_slice_id: slice,
                    quantity: "1",
                    classification: "waived",
                  },
                ],
              }),
            )
          ).ok,
          true,
        );
        current = await ws(4);
        assert.equal(Number(current.issues[0].due), 0);
        assert.equal(
          (
            await db.command({
              ...cmd(4, "consequence", current.revision, {
                issue_slice_id: slice,
                quantity: "1",
                classification: "settled",
                evidence: "Synthetic settlement",
              }),
              actor: db.actors[0],
            })
          ).ok,
          true,
        );
        current = await ws(4);
        const late = await db.command(
          cmd(4, "recover", current.revision, {
            return_entry_mode: "incremental",
            lines: [receipt(slice, "1", "damaged")],
          }),
        );
        assert.equal(late.ok, true, JSON.stringify(late));
        current = await ws(4);
        assert.equal(Number(current.issues[0].returned), 1);
        assert.equal(Number(current.issues[0].resolved), 0);
        assert.equal(Number(current.issues[0].held), 1);
        const holds = await db.read(
          db.actors[0],
          `public.equipment_operations_read(${jsonSql({ phase: "hold", page: 1 })})`,
        );
        assert.ok(holds.rows.some((row) => row.id === f.request4));
      },
    );
    await t.test(
      "concurrent receivers serialize revisions, and worklist exposes real obligations",
      async () => {
        let current = await ws(3);
        const slice = current.issues.find((row) => !row.asset_id).id;
        assert.equal(
          (
            await db.command(
              cmd(3, "initial_return", current.revision, { lines: [] }),
            )
          ).ok,
          true,
        );
        current = await ws(3);
        const commands = [db.actors[0], db.actors[2]].map((actor) => ({
          ...cmd(3, "recover", current.revision, {
            return_entry_mode: "incremental",
            lines: [receipt(slice, "0.05")],
          }),
          actor,
        }));
        const outcomes = await db.race(commands);
        assert.equal(outcomes.filter((result) => result.ok).length, 1);
        assert.equal(
          outcomes.find((result) => !result.ok).message,
          "STALE_REVISION",
        );
        const work = await db.read(
          db.actors[2],
          `public.equipment_operations_read(${jsonSql({ phase: "return", search: "S5-", page: 1 })})`,
        );
        assert.ok(
          work.rows.some(
            (row) => row.id === f.request3 && row.due_line_count > 0,
          ),
        );
        assert.ok(
          !work.rows.some(
            (row) => row.id === f.request2 && row.due_line_count === 0,
          ),
        );
        await assert.rejects(
          () => db.read(db.actors[1], `public.equipment_operations_read('{}')`),
          /AUTH_DENIED/,
        );
      },
    );
  } finally {
    if (f) await db.cleanup();
  }
});
