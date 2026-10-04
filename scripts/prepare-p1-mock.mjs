import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// INV-061: single-use synthetic seed; never a migration or operational activation.
const root = fileURLToPath(new URL("../", import.meta.url));
const target = "kwpyukofofoaqhmxndlc";
const manifestPath = resolve(root, "docs/architecture/P1_MOCK_MANIFEST.json");
assert.deepEqual(
  process.argv.slice(2),
  ["--create"],
  "Explicit --create required",
);
assert.equal(
  readFileSync(resolve(root, "supabase/.temp/project-ref"), "utf8").trim(),
  target,
  "Wrong linked project: STOP",
);
assert.equal(
  existsSync(manifestPath),
  false,
  "Manifest exists: verify it; do not reseed immutable opening",
);
const executable =
  process.platform === "win32"
    ? resolve(root, "node_modules/@supabase/cli-windows-x64/bin/supabase.exe")
    : "supabase";
const result = spawnSync(
  executable,
  [
    "db",
    "query",
    "--linked",
    "--file",
    "scripts/p1-mock-manifest.sql",
    "--output",
    "json",
  ],
  {
    cwd: root,
    encoding: "utf8",
    timeout: 90000,
    maxBuffer: 4 * 1024 * 1024,
  },
);
if (result.error || result.status !== 0) {
  throw new Error(
    result.error?.message ??
      result.stderr ??
      "Pilot fixture failed; inspect transaction before retry",
  );
}
const output = JSON.parse(result.stdout);
const manifest = output.rows.find((row) => row.manifest)?.manifest;
assert.ok(
  manifest,
  "Committed output missing: recover manifest by read-only query; do not reseed",
);
assert.equal(manifest.synthetic, true);
assert.equal(manifest.target_project_ref, target);
assert.equal(manifest.real_activation, false);
manifest.asset.catalog_item_id = manifest.items.find(
  (item) => item.key === "serialized",
).id;
manifest.asset.location_id = manifest.location.id;
manifest.asset.custodian_id = manifest.users[1].id;
manifest.asset.lifecycle_status = "in_service";
manifest.asset.opening_good_count = 1;
manifest.asset.opening_damaged_count = 0;
manifest.opening_retry_key = "97df21fa-50f4-4011-8b2e-2aefc75ed409";
manifest.asset_opening_retry_key = "431c6bd8-cd39-403c-9eed-6c7fe91df288";
manifest.marker_runtime_enforced = false;
manifest.execution = {
  observed_at: new Date().toISOString(),
  target_project_ref: target,
  fixture_sha256: createHash("sha256")
    .update(readFileSync(resolve(root, "scripts/p1-mock-manifest.sql")))
    .digest("hex"),
  kind: "ACTUAL_SYNTHETIC_DATABASE_SMOKE",
  interactive_login_verified: false,
  writer_marker_verified: false,
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify(
    {
      target,
      scope: manifest.scope_code,
      manifest: manifestPath,
      opening: manifest.opening_result,
      asset: manifest.asset.id,
      database_checks: manifest.database_checks,
    },
    null,
    2,
  ),
);
