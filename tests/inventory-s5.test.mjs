import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createS5Harness,
  jsonSql,
  sqlLiteral,
} from "./helpers/inventory-s5-fixture.mjs";

// These races use independent authenticated PostgreSQL sessions, queued behind
// the inventory writer before release. No ordering depends on HTTP timing/sleep.
// Run against the migrated, seeded isolated pilot with Docker available.
test("S5: physical fulfillment serializes stock, exact assets, retries and revisions", async (t) => {
  const db = createS5Harness();
  let fixture;
  try {
    fixture = await db.setup();
    const workspace = async (n) => {
      const requestState = await db.read(
        db.actors[2],
        `public.equipment_fulfillment_read(${sqlLiteral(fixture[`request${n}`])}::uuid)`,
      );
      // Global location options can change while unrelated suite fixtures run.
      delete requestState.locations;
      return requestState;
    };
    function issue(
      n,
      revision,
      locationId,
      quantity,
      assetIds = [],
      operation = "supplement",
    ) {
      return {
        requestId: fixture[`request${n}`],
        operation,
        retryKey: crypto.randomUUID(),
        payload: {
          expected_revision: revision,
          business_key: crypto.randomUUID(),
          reason: "Synthetic S5 concurrency physical issue",
          lines: [
            {
              line_id: fixture[`line${n}`],
              mapping_id: fixture[n <= 3 ? "mapQ" : "mapA"].mapping_id,
              location_id: locationId,
              quantity,
              asset_ids: assetIds,
            },
          ],
        },
      };
    }
    async function available(n, locationId) {
      for (let page = 1; ; page++) {
        const projection = await db.read(
          db.actors[2],
          `public.equipment_preparation_read(${sqlLiteral(fixture[`request${n}`])}::uuid,'stock',${jsonSql({ catalog_item_id: db.id(20), page })})`,
        );
        const row = projection.rows.find(
          ({ location_id }) => location_id === locationId,
        );
        if (row) return Number(row.available_quantity);
        assert.equal(
          projection.rows.length,
          100,
          "Fixture location must exist in the paged public stock projection",
        );
      }
    }
    const micros = (quantity) => Math.round(Number(quantity) * 1_000_000);
    const issuedAt = (ws, locationId) =>
      ws.issues
        .filter(({ location_id }) => location_id === locationId)
        .reduce((sum, { issued }) => sum + Number(issued), 0);
    function oneWinner(outcomes, expectedMessage, expectedCode) {
      assert.equal(
        outcomes.filter(({ ok }) => ok).length,
        1,
        "Exactly one physical issue commits",
      );
      const loser = outcomes.findIndex(({ ok }) => !ok);
      assert.equal(outcomes[loser].code, expectedCode);
      assert.equal(outcomes[loser].message, expectedMessage);
      return { winner: 1 - loser, loser };
    }

    await t.test(
      "the last available decimal quantity is issued once without stealing another preparation",
      async () => {
        // Opening target=0.3, with 0.2 backing a separate prepared request.
        assert.equal(await available(2, db.id(42)), 0.1);
        const before = await Promise.all([workspace(2), workspace(3)]);
        const commands = [2, 3].map((n, index) =>
          issue(n, before[index].revision, db.id(42), "0.1"),
        );
        const outcomes = await db.race(commands);
        const { winner, loser } = oneWinner(
          outcomes,
          "S5_INSUFFICIENT_AVAILABLE",
          "P0001",
        );
        const after = await Promise.all([workspace(2), workspace(3)]);
        assert.equal(issuedAt(after[winner], db.id(42)), 0.1);
        assert.equal(after[winner].revision, before[winner].revision + 1);
        assert.equal(after[winner].status, "handed_over");
        assert.equal(
          after[winner].events.find(
            ({ id }) => id === outcomes[winner].result.event_id,
          ).signature,
          null,
          "Physical fulfillment takes effect without a recipient signature",
        );
        assert.deepEqual(
          after[loser],
          before[loser],
          "Failed issue leaves no event, debt or revision effect",
        );
        assert.equal(await available(2, db.id(42)), 0);

        const steal = await db.command(
          issue(2, after[0].revision, db.id(42), "0.1"),
        );
        assert.deepEqual(steal, {
          ok: false,
          code: "P0001",
          message: "S5_INSUFFICIENT_AVAILABLE",
        });
        assert.deepEqual(await workspace(2), after[0]);
        const ownerBefore = await workspace(1);
        assert.equal(ownerBefore.status, "preparing");
        assert.equal(ownerBefore.issues.length, 0);
        const owner = await db.command(
          issue(1, ownerBefore.revision, db.id(42), "0.2", [], "handover"),
        );
        assert.equal(owner.ok, true, JSON.stringify(owner));
        const ownerAfter = await workspace(1);
        assert.equal(
          issuedAt(ownerAfter, db.id(42)),
          0.2,
          "Reserved owner still physically hands over its full backing",
        );
        assert.equal(ownerAfter.status, "handed_over");
        assert.equal(await available(2, db.id(42)), 0);
        assert.equal(
          [ownerAfter, ...after].reduce(
            (sum, ws) => sum + micros(issuedAt(ws, db.id(42))),
            0,
          ),
          300_000,
        );
      },
    );

    await t.test(
      "the same exact asset cannot be physically issued to two requests",
      async () => {
        const before = await Promise.all([workspace(4), workspace(5)]);
        const targetAsset = fixture.asset3.id;
        const outcomes = await db.race(
          [4, 5].map((n, index) =>
            issue(n, before[index].revision, db.id(42), "1", [targetAsset]),
          ),
        );
        const { winner, loser } = oneWinner(
          outcomes,
          "S5_ASSET_UNAVAILABLE",
          "P0001",
        );
        const after = await Promise.all([workspace(4), workspace(5)]);
        const targetIssues = after
          .flatMap(({ issues }) => issues)
          .filter(({ asset_id }) => asset_id === targetAsset);
        assert.equal(
          targetIssues.length,
          1,
          "Only one request acquires custody of the exact asset",
        );
        assert.equal(Number(targetIssues[0].issued), 1);
        assert.equal(Number(targetIssues[0].due), 1);
        assert.equal(after[winner].revision, before[winner].revision + 1);
        assert.deepEqual(
          after[loser],
          before[loser],
          "Losing asset issue is atomic",
        );
        const repeat = await db.command(
          issue(4 + loser, after[loser].revision, db.id(42), "1", [
            targetAsset,
          ]),
        );
        assert.deepEqual(repeat, {
          ok: false,
          code: "P0001",
          message: "S5_ASSET_UNAVAILABLE",
        });
        assert.deepEqual(await workspace(4 + loser), after[loser]);
      },
    );

    await t.test(
      "identical concurrent retries post once and a changed payload is rejected",
      async () => {
        const before = await workspace(2);
        const stockBefore = await available(2, db.id(41));
        const same = issue(2, before.revision, db.id(41), "0.1");
        const outcomes = await db.race([same, same]);
        for (const outcome of outcomes)
          assert.equal(outcome.ok, true, JSON.stringify(outcome));
        assert.deepEqual(
          outcomes[0].result,
          outcomes[1].result,
          "Both retries identify the same physical effect",
        );
        const after = await workspace(2);
        assert.equal(after.revision, before.revision + 1);
        assert.equal(after.event_count, before.event_count + 1);
        assert.equal(
          after.events.filter(({ id }) => id === outcomes[0].result.event_id)
            .length,
          1,
        );
        assert.equal(
          micros(issuedAt(after, db.id(41))) -
            micros(issuedAt(before, db.id(41))),
          100_000,
        );
        assert.equal(
          micros(await available(2, db.id(41))),
          micros(stockBefore) - 100_000,
        );

        const changed = structuredClone(same);
        changed.payload.lines[0].quantity = "0.2";
        assert.deepEqual(await db.command(changed), {
          ok: false,
          code: "23505",
          message: "RETRY_PAYLOAD_MISMATCH",
        });
        assert.deepEqual(
          await workspace(2),
          after,
          "Retry fingerprint mismatch cannot mutate physical history",
        );
        assert.equal(
          micros(await available(2, db.id(41))),
          micros(stockBefore) - 100_000,
        );
      },
    );

    await t.test(
      "distinct commands with the same concurrent revision produce exactly one effect",
      async () => {
        const before = await workspace(3);
        const stockBefore = await available(3, db.id(41));
        const commands = [
          issue(3, before.revision, db.id(41), "0.1"),
          issue(3, before.revision, db.id(41), "0.2"),
        ];
        const outcomes = await db.race(commands);
        const { winner, loser } = oneWinner(
          outcomes,
          "STALE_REVISION",
          "23505",
        );
        const after = await workspace(3);
        const quantity = Number(commands[winner].payload.lines[0].quantity);
        assert.equal(after.revision, before.revision + 1);
        assert.equal(after.event_count, before.event_count + 1);
        const event = after.events.find(
          ({ id }) => id === outcomes[winner].result.event_id,
        );
        assert.equal(event.business_key, commands[winner].payload.business_key);
        assert.equal(
          after.events.some(
            ({ business_key }) =>
              business_key === commands[loser].payload.business_key,
          ),
          false,
        );
        assert.equal(Number(event.payload.lines[0].quantity), quantity);
        assert.equal(
          micros(issuedAt(after, db.id(41))) -
            micros(issuedAt(before, db.id(41))),
          micros(quantity),
        );
        assert.equal(
          micros(await available(3, db.id(41))),
          micros(stockBefore) - micros(quantity),
        );
        assert.deepEqual(await db.command(commands[loser]), {
          ok: false,
          code: "23505",
          message: "STALE_REVISION",
        });
        assert.deepEqual(
          await workspace(3),
          after,
          "A stale retry never adds a second effect",
        );
      },
    );
  } finally {
    await db.cleanup();
  }
});
