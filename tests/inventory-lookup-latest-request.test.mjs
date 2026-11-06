import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function loadFetchOptions() {
  const source = await readFile(
    new URL("../components/inventory/inventory-lookup.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "lookup.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let callback;
  (function find(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === "fetchOptions"
    ) {
      callback = node.initializer.arguments[0];
    }
    ts.forEachChild(node, find);
  })(ast);
  assert.ok(callback, "fetchOptions is declared in InventoryLookup");
  const { outputText } = ts.transpileModule(
    `return (${callback.getText(ast)});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  );
  return (scope) =>
    new Function(...Object.keys(scope), outputText)(...Object.values(scope));
}

function harness(fetchOptionsFactory) {
  const pending = [];
  const view = { rows: [], total: 0, loading: false, error: null };
  const fetchOptions = fetchOptionsFactory({
    latestRequest: { current: 0 },
    readInventoryOptions: (_resource, params) =>
      new Promise((resolve, reject) =>
        pending.push({ q: params.q, resolve, reject }),
      ),
    resource: "items",
    filters: {},
    pageSize: 10,
    setLoading: (value) => (view.loading = value),
    setError: (value) => (view.error = value),
    setRows: (value) => (view.rows = value),
    setTotal: (value) => (view.total = value),
  });
  return { fetchOptions, pending, view };
}

test("a slower older search never replaces the latest results", async () => {
  const { fetchOptions, pending, view } = harness(await loadFetchOptions());
  const older = fetchOptions("a", 1);
  const latest = fetchOptions("ab", 1);

  pending[1].resolve({ rows: ["result for ab"], total: 1 });
  await latest;
  assert.equal(view.loading, false);

  pending[0].resolve({ rows: ["result for a"], total: 9 });
  await older;
  assert.deepEqual(view.rows, ["result for ab"]);
  assert.equal(view.total, 1);
});

test("a failed older search neither shows an error nor ends the loading state", async () => {
  const { fetchOptions, pending, view } = harness(await loadFetchOptions());
  const older = fetchOptions("a", 1);
  const latest = fetchOptions("ab", 1);

  pending[0].reject(new Error("older failed"));
  await older;
  assert.equal(view.error, null);
  assert.equal(view.loading, true);

  pending[1].resolve({ rows: ["result for ab"], total: 1 });
  await latest;
  assert.equal(view.loading, false);
  assert.deepEqual(view.rows, ["result for ab"]);
});
