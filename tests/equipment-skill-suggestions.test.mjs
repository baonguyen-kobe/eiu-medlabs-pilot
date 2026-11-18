import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// t4a: suggestions are distinct names ranked by use, so a frequent name late
// in the alphabet is no longer cut off by the 1,000-row API cap.
function localDatabase() {
  const project = process.env.SUPABASE_LOCAL_PROJECT_ID ?? "eiu-medlabs-pilot";
  assert.ok(["eiu-medlabs-pilot", "lich-truc-app-ci"].includes(project));
  const listed = spawnSync(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${project}`,
      "--format",
      "{{.Names}}",
    ],
    { encoding: "utf8" },
  );
  const databases = (listed.stdout ?? "")
    .split(/\r?\n/)
    .filter((name) => name.startsWith("supabase_db_"));
  assert.equal(
    databases.length,
    1,
    "REFUSING_AMBIGUOUS_LOCAL_SUPABASE_DATABASE",
  );
  return databases[0];
}

test("skill suggestions are distinct, ranked by use and reach past 1,000 lines", () => {
  const sql = `
begin;
set local session_replication_role = replica;
insert into public.equipment_request_items (id, request_id, catalog_item_id, skill_name, quantity)
select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'T4A kỹ năng ' || lpad(n::text, 4, '0'), 1
from generate_series(1, 1100) n;
insert into public.equipment_request_items (id, request_id, catalog_item_id, skill_name, quantity)
select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), case when n = 1 then ' Zz T4A tiêm ' else 'Zz T4A tiêm' end, 1
from generate_series(1, 2000) n;
select json_build_object(
  'first', (select s from public.list_equipment_skill_suggestions() s limit 1),
  'count', (select count(*) from public.list_equipment_skill_suggestions()),
  'zz', (select count(*) from public.list_equipment_skill_suggestions() s where s = 'Zz T4A tiêm'));
rollback;`;
  const run = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      localDatabase(),
      "psql",
      "-X",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-qAt",
    ],
    { input: sql, encoding: "utf8" },
  );
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(
    run.stdout.split(/\r?\n/).find((line) => line.startsWith('{"first"')),
  );
  assert.equal(result.first, "Zz T4A tiêm", "the most used name comes first");
  assert.equal(result.zz, 1, "names are trimmed and listed once");
  assert.equal(result.count, 1000, "the list is capped at 1,000 names");
});
