import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const baselinePath = path.join(root, "tests/fixtures/ui-drift-baseline.json");
const banned =
  /text-xs|text-\[[0-9.]+px\]|font-mono|dark:|<table(?![^>]*data-table)|(?:text|bg|border|ring|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|green|emerald|teal|sky|blue|indigo|violet|purple|rose)-[0-9]/g;

async function driftByFile() {
  const counts = {};
  for (const dir of ["app", "components"]) {
    for (const entry of await readdir(path.join(root, dir), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
      const file = path.join(entry.parentPath, entry.name);
      const hits = (await readFile(file, "utf8")).match(banned)?.length ?? 0;
      if (hits) {
        counts[path.relative(root, file).replaceAll("\\", "/")] = hits;
      }
    }
  }
  return Object.fromEntries(Object.entries(counts).sort());
}

// Regenerate only after real cleanup: UPDATE_UI_DRIFT_BASELINE=1 node --test <this file>
test("UI style drift never grows beyond its recorded baseline", async () => {
  const current = await driftByFile();
  if (process.env.UPDATE_UI_DRIFT_BASELINE) {
    await writeFile(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    return;
  }

  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const grew = Object.entries(current)
    .filter(([file, hits]) => hits > (baseline[file] ?? 0))
    .map(([file, hits]) => `${file}: ${hits} > ${baseline[file] ?? 0}`);

  assert.deepEqual(
    grew,
    [],
    "Use shared classes and tokens instead; see UI Master Section 0A.5",
  );
});
