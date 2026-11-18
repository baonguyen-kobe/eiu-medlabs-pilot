import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import test from "node:test";

// t4r3 step A: Basic Medical items map to shared SKUs (Admin only, once per
// item) and the cutover preview converts room counts to base units at each
// room's root location. Everything runs in one rolled-back transaction.
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

test("Basic Medical items map once, by an Admin, and preview the room opening", () => {
  const [admin, staff, room, bmMapped, bmUnmapped, category, item] = Array.from(
    { length: 7 },
    () => crypto.randomUUID(),
  );
  const nonce = crypto.randomBytes(4).toString("hex");
  const sql = `
begin;
set local session_replication_role = replica;
insert into public.profiles (id, email, full_name, is_active) values
  ('${admin}', 'bm-admin-${nonce}@campus.local', 'BM admin', true),
  ('${staff}', 'bm-staff-${nonce}@campus.local', 'BM staff', true);
insert into public.user_roles (user_id, role) values ('${admin}', 'admin'), ('${staff}', 'staff');
insert into public.inventory_uoms (code, name, dimension, allowed_scale)
  values ('bm_${nonce}', 'cái', 'count', 0);
insert into public.inventory_categories (id, code, name) values ('${category}', 'BM_${nonce}', 'BM ${nonce}');
insert into public.inventory_catalog_items (id, code, name, category_id, material_kind, base_uom_code,
  tracking_strategy, return_semantics, expiry_required, active)
  values ('${item}', 'BM-${nonce}', 'Găng tay ${nonce}', '${category}', 'other', 'bm_${nonce}',
  'quantity', 'nonreturnable', false, true);
insert into public.basic_medical_equipment_catalog (id, item_name, commercial_name, unit, is_active) values
  ('${bmMapped}', 'Hộp găng ${nonce}', 'Găng ${nonce}', 'hộp', true),
  ('${bmUnmapped}', 'Ống nghe ${nonce}', 'Ống nghe ${nonce}', 'cái', true);
set local session_replication_role = origin;
insert into public.rooms (id, room_code, building_code, room_type_id)
  values ('${room}', 'BM-${nonce}', 'Y', (select id from public.room_types order by code limit 1));
insert into public.basic_medical_room_inventory (room_id, catalog_item_id, total_quantity, good_quantity, damaged_quantity, is_active)
  values ('${room}', '${bmMapped}', 3, 2, 1, true), ('${room}', '${bmUnmapped}', 1, 1, 0, true);

create function pg_temp.attempt(actor uuid, sql text) returns jsonb language plpgsql as $f$
declare result jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute sql into result;
  execute 'reset role';
  return jsonb_build_object('ok', true, 'value', result);
exception when others then
  execute 'reset role';
  return jsonb_build_object('ok', false, 'message', sqlerrm);
end $f$;

select jsonb_build_object(
  'byStaff', pg_temp.attempt('${staff}', $q$select to_jsonb(public.map_basic_medical_inventory_item('${bmMapped}', '${item}', '50', 'Hộp 50 cái'))$q$),
  'mapped', pg_temp.attempt('${admin}', $q$select to_jsonb(public.map_basic_medical_inventory_item('${bmMapped}', '${item}', '50', 'Hộp 50 cái'))$q$),
  'again', pg_temp.attempt('${admin}', $q$select to_jsonb(public.map_basic_medical_inventory_item('${bmMapped}', '${item}', '10', 'Lần hai'))$q$),
  'preview', pg_temp.attempt('${admin}', $q$select public.basic_medical_cutover_preview()$q$),
  'previewByStaff', pg_temp.attempt('${staff}', $q$select public.basic_medical_cutover_preview()$q$)
) as result;
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
  const line = run.stdout
    .split(/\r?\n/)
    .find(
      (value) => value.startsWith('{"mapped"') || value.includes('"byStaff"'),
    );
  assert.ok(line, run.stdout);
  const result = JSON.parse(line);

  assert.equal(result.byStaff.ok, false);
  assert.match(result.byStaff.message, /BASIC_MEDICAL_MAPPING_ADMIN_ONLY/);
  assert.equal(result.mapped.ok, true, JSON.stringify(result.mapped));
  assert.match(result.again.message, /BASIC_MEDICAL_ITEM_ALREADY_MAPPED/);
  assert.match(
    result.previewByStaff.message,
    /BASIC_MEDICAL_MAPPING_ADMIN_ONLY/,
  );

  const rows = result.preview.value.rows.filter(
    ({ room_id }) => room_id === room,
  );
  const mapped = rows.find(
    ({ basic_medical_item_id }) => basic_medical_item_id === bmMapped,
  );
  const unmapped = rows.find(
    ({ basic_medical_item_id }) => basic_medical_item_id === bmUnmapped,
  );
  assert.equal(mapped.blocker, null);
  assert.ok(
    mapped.location_id,
    "the room's root location receives the opening",
  );
  assert.equal(Number(mapped.base_good), 100, "2 hộp × 50 cái");
  assert.equal(Number(mapped.base_damaged), 50);
  assert.equal(unmapped.blocker, "UNMAPPED");
});
