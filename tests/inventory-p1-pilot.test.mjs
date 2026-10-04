import test from "node:test";
import assert from "node:assert/strict";
import {
  setupP1Local,
  buildP1SmokeSql,
} from "./helpers/inventory-p1-runtime.mjs";
import { runP1Races } from "./helpers/inventory-p1-races.mjs";
import { buildP1OpeningSql } from "./helpers/inventory-p1-opening.mjs";
import { buildP1AuthorizationSql } from "./helpers/inventory-p1-authorization.mjs";

test("P1: pilot mock markers, writer gate, and concurrent physical serialization", async (t) => {
  const setup = await setupP1Local();

  await t.test(
    "P1 smoke: comprehensive capability, physical workflow, and rollback integrity",
    async () => {
      const smokeSql = buildP1SmokeSql(setup.manifest);
      const smokeOutput = await setup.sql(smokeSql);
      assert.match(smokeOutput, /"rollback_integrity":\s*true/);
      assert.match(smokeOutput, /"final_phase":\s*"PAUSED"/);
    },
  );
  await t.test(
    "P1 opening: incomplete provenance denies activation; generated binding posts once",
    async () => {
      await setup.sql(buildP1OpeningSql(setup.manifest));
    },
  );

  await t.test(
    "P1 authorization: canonical backing rejects forgery without freezing unrelated workflows",
    async () => {
      await setup.sql(buildP1AuthorizationSql(setup.manifest));
    },
  );

  await t.test(
    "P1 races: concurrent activation, confirmation, pause, and transfer serialization",
    async () => {
      const report = await runP1Races({ manifest: setup.manifest });
      assert.equal(report.final.scope.phase, "PAUSED");
    },
  );
});
