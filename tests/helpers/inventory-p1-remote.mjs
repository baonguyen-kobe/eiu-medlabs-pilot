import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

export const P1_PROJECT = "kwpyukofofoaqhmxndlc";

// Management SQL only on the already linked isolated pilot. No password/URL or
// alternate target is accepted; every call rechecks the actual linked reference.
export function createP1RemoteClient(root = process.cwd()) {
  const executable =
    process.platform === "win32"
      ? resolve(root, "node_modules/@supabase/cli-windows-x64/bin/supabase.exe")
      : "supabase";
  async function query(sql) {
    assert.equal(
      (
        await readFile(resolve(root, "supabase/.temp/project-ref"), "utf8")
      ).trim(),
      P1_PROJECT,
      "WRONG_LINKED_PROJECT_STOP",
    );
    const dir = await mkdtemp(join(tmpdir(), "medlabs-p1-mock-"));
    const file = join(dir, "query.sql");
    try {
      await writeFile(file, sql, "utf8");
      const raw = await new Promise((accept, reject) => {
        const child = spawn(
          executable,
          ["db", "query", "--linked", "--file", file, "--output", "json"],
          { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
        );
        let out = "",
          err = "";
        child.stdout.on("data", (c) => {
          out += c;
        });
        child.stderr.on("data", (c) => {
          err += c;
        });
        child.once("error", reject);
        child.once("close", (code) =>
          code === 0
            ? accept(out)
            : reject(new Error(`Pilot SQL failed (${code}): ${err}`)),
        );
      });
      const result = JSON.parse(raw);
      const rows = Array.isArray(result) ? result : result.rows;
      assert.ok(Array.isArray(rows), "REMOTE_QUERY_ROWS_REQUIRED");
      return rows;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return { query, projectRef: P1_PROJECT };
}

export function singleJson(rows) {
  assert.equal(rows.length, 1, "EXPECTED_SINGLE_REMOTE_RESULT");
  const values = Object.values(rows[0]);
  assert.equal(values.length, 1);
  return values[0];
}
