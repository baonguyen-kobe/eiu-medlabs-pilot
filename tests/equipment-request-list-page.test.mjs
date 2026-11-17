import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import test from "node:test";

// t2i: list_equipment_request_page filters, counts and pages in the database,
// so a list past the 1,000-row API cap stays complete. All fixture rows live
// in one transaction that is rolled back.
function localDatabase() {
  const project = process.env.SUPABASE_LOCAL_PROJECT_ID ?? "eiu-medlabs-pilot";
  assert.ok(
    ["eiu-medlabs-pilot", "lich-truc-app-ci"].includes(project),
    "Requires an isolated local pilot or disposable CI runtime",
  );
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

test("equipment request list pages, filters and searches past 1,000 rows", () => {
  const actor = crypto.randomUUID();
  const other = crypto.randomUUID();
  const sql = `
begin;
-- Fixture rows only: skip workflow triggers and FKs inside this rollback.
set local session_replication_role = replica;
insert into public.profiles (id, email, full_name, is_active)
values ('${actor}', 't2i-${actor}@campus.local', 'Người lập t2i', true),
       ('${other}', 't2i-${other}@campus.local', 'Giảng viên Tìm Riêng', true);
insert into public.equipment_requests (
  id, registrant_id, responsible_lecturer_id, created_by, phone_snapshot,
  email_snapshot, receive_at, return_at, semester, request_domain,
  source_identity_id, status, created_at, class_schedule_id)
select gen_random_uuid(), '${actor}',
  case when n <= 3 then '${other}'::uuid else '${actor}'::uuid end,
  '${actor}', '0900000000', 't2i@campus.local',
  now(), now() + interval '2 hours', 'HK1',
  (case when n % 2 = 0 then 'basic_medical' else 'nursing_skills' end)::public.equipment_request_domain,
  gen_random_uuid(),
  case when n % 10 = 0 then 'cancelled' else 'new' end,
  timestamptz '2026-01-01' + n * interval '1 minute',
  -- Skills requests need a schedule link; FKs are off for this fixture.
  case when n % 2 = 0 then null else gen_random_uuid() end
from generate_series(1, 1050) n;
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '${actor}', 'role', 'authenticated')::text, true) is not null;
select jsonb_build_object(
  'all', public.list_equipment_request_page(array['nursing_skills','basic_medical'], true),
  'last', public.list_equipment_request_page(array['nursing_skills','basic_medical'], true, p_page => 21, p_page_size => 50),
  'beyond', public.list_equipment_request_page(array['nursing_skills','basic_medical'], true, p_page => 99, p_page_size => 50),
  'cancelled', public.list_equipment_request_page(array['nursing_skills','basic_medical'], true, p_status => 'cancelled'),
  'basic', public.list_equipment_request_page(array['nursing_skills','basic_medical'], true, p_domain => 'basic_medical'),
  'search', public.list_equipment_request_page(array['nursing_skills','basic_medical'], true, p_query => 'NGƯỜI LẬP'),
  'wildcard', public.list_equipment_request_page(array['nursing_skills','basic_medical'], true, p_query => '%'),
  'scoped', public.list_equipment_request_page(array['nursing_skills'], true),
  'oldest', (select id from public.equipment_requests where registrant_id = '${actor}' order by created_at limit 1),
  'focus', public.list_equipment_request_page(array['nursing_skills','basic_medical'], true,
    p_page_size => 50,
    p_focus_id => (select id from public.equipment_requests where registrant_id = '${actor}' order by created_at limit 1))
);
rollback;
`;
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
  const jsonLine = run.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith('{"all"'));
  assert.ok(jsonLine, run.stdout);
  const result = JSON.parse(jsonLine);

  assert.equal(result.all.total, 1050);
  assert.equal(result.all.page, 1);
  assert.equal(result.all.ids.length, 20);
  assert.equal(result.last.page, 21);
  assert.equal(result.last.ids.length, 50);
  assert.equal(
    result.beyond.page,
    21,
    "a page past the end clamps to the last page",
  );
  assert.equal(result.cancelled.total, 105);
  assert.equal(result.basic.total, 525);
  assert.equal(
    result.search.total,
    1050,
    "search folds Vietnamese case and matches the registrant name",
  );
  assert.equal(
    result.wildcard.total,
    0,
    "% is matched literally, not as a wildcard",
  );
  assert.equal(result.scoped.total, 525, "only the allowed domains are listed");
  assert.equal(
    result.focus.page,
    21,
    "a deep link opens the page holding that request",
  );
  assert.ok(result.focus.ids.includes(result.oldest));
});
