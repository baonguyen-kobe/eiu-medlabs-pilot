import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as contract from "../lib/equipment-preparation.ts";

const id = "18000000-0000-4000-8000-000000000001";
const key = "18000000-0000-4000-8000-000000000002";
const source = await readFile(
  new URL("../app/equipment/preparation/actions.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const workspace = {
  request: {
    id,
    status: "new",
    revision: 2,
    receive_at: "2026-10-28T01:00:00Z",
    return_at: "2026-10-28T09:00:00Z",
    registrant_id: id,
    responsible_lecturer_id: id,
  },
  manager: true,
  admin: false,
  actor_id: id,
  can_propose: true,
  lines: [],
  preparation: null,
  adjustments: [],
  transfers: [],
};

function actionWith(responses) {
  const calls = [];
  const db = {
    auth: { getClaims: async () => ({ data: { claims: { sub: id } } }) },
    rpc: async (name, args) => {
      calls.push({ name, args });
      assert.ok(responses.length, "Unexpected RPC");
      return responses.shift();
    },
  };
  const exports = {};
  const dependencies = {
    "next/cache": { revalidatePath() {} },
    "next/server": { after() {} },
    "@/lib/supabase/server": { createClient: async () => db },
    "@/lib/equipment-request-emails": { processPendingEmailOutbox() {} },
    "@/lib/equipment-preparation": contract,
  };
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      assert.ok(name in dependencies, name);
      return dependencies[name];
    },
  });
  return { change: exports.changePreparation, calls };
}

test("preparation retains a retryable outcome when transport cannot establish commit status", async () => {
  for (const operation of ["confirm", "physical_transfer"]) {
    for (const response of [
      { error: { code: "", message: "fetch failed" }, status: 0 },
      { error: { code: "40001", message: "gateway failure" }, status: 503 },
    ]) {
      const action = actionWith([response]);
      const payload = { expected_revision: 1, reason: "Synthetic recovery" };
      const result = await action.change(id, operation, payload, key);
      assert.equal(result.ok, false);
      assert.equal(result.uncertain, true);
      assert.equal(action.calls.length, 1);
      assert.equal(action.calls[0].args.p_retry_key, key);
      assert.equal(action.calls[0].args.p_payload, payload);
    }
  }
});

test("preparation distinguishes a definitive denial from a committed command with failed readback", async () => {
  const denied = actionWith([
    { error: { code: "42501", message: "AUTH_DENIED" }, status: 403 },
  ]);
  const denial = await denied.change(id, "confirm", {}, key);
  assert.equal(denial.ok, false);
  assert.equal(denial.uncertain, false);
  assert.equal(denial.committed, undefined);
  for (const read of [
    { error: { message: "read unavailable" } },
    { error: null, data: { malformed: true } },
  ]) {
    const action = actionWith([{ error: null, status: 200 }, read]);
    const result = await action.change(id, "confirm", {}, key);
    assert.equal(result.ok, false);
    assert.equal(result.committed, true);
    assert.equal(action.calls.length, 2);
  }
});

test("preparation only reports success after a valid workspace readback", async () => {
  const action = actionWith([
    { error: null, status: 200 },
    { error: null, data: workspace },
  ]);
  const result = await action.change(id, "confirm", {}, key);
  assert.equal(result.ok, true);
  assert.equal(result.data.request.revision, 2);
  assert.equal(action.calls[1].name, "equipment_preparation_read");
});
