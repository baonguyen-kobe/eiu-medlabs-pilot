import assert from "node:assert/strict";
import {
  createP1LocalClient,
  jsonSql,
  sqlLiteral,
} from "./inventory-p1-runtime.mjs";

// Historical legacy fixtures only. Docker transport pins the isolated local
// pilot; runtime assertions must still use the original authenticated clients.
function insertSql(table, payload) {
  const keys = Object.keys(payload);
  assert.ok(keys.every((key) => /^[a-z_]+$/.test(key)));
  return `insert into public.${table}(${keys.join(",")}) select ${keys.map((key) => `r.${key}`).join(",")} from jsonb_populate_record(null::public.${table},${jsonSql(payload)}) r;`;
}
export async function legacyRequestFixture(payload) {
  const sql = createP1LocalClient().sql;
  await sql(
    `begin; select set_config('request.jwt.claims',${jsonSql({ sub: payload.registrant_id, role: "authenticated" })}::text,true); ${insertSql("equipment_requests", payload)} commit;`,
  );
  return { error: null };
}
export async function legacyItemFixture(payload) {
  const rows = Array.isArray(payload) ? payload : [payload];
  assert.ok(rows.length > 0);
  const requestId = rows[0].request_id;
  assert.ok(rows.every((row) => row.request_id === requestId));
  await createP1LocalClient().sql(
    `begin; select set_config('request.jwt.claims',jsonb_build_object('sub',(select registrant_id from public.equipment_requests where id=${sqlLiteral(requestId)}::uuid),'role','authenticated')::text,true); select set_config('app.s4_registration',${sqlLiteral(requestId)},true); ${rows.map((row) => insertSql("equipment_request_items", row)).join("\n")} commit;`,
  );
  return { error: null };
}
export async function legacyStageFixture(requestId, status) {
  assert.ok(["preparing", "handed_over"].includes(status));
  // Reconstruct a pre-S4 legacy state only. Guards are restored before the
  // authenticated action under test; this never creates a fake preparation.
  await createP1LocalClient().sql(
    `begin;
      select id from public.equipment_requests where id=${sqlLiteral(requestId)}::uuid for update;
      do $$ begin
        if not exists(select 1 from public.equipment_requests where id=${sqlLiteral(requestId)}::uuid) then raise exception 'LEGACY_FIXTURE_REQUEST_REQUIRED'; end if;
        if exists(select 1 from public.equipment_preparations where request_id=${sqlLiteral(requestId)}::uuid)
          or exists(select 1 from public.equipment_fulfillment_events where request_id=${sqlLiteral(requestId)}::uuid)
        then raise exception 'REFUSING_INVENTORY_HISTORY_LEGACY_FIXTURE'; end if;
      end $$;
      set local session_replication_role=replica;
      update public.equipment_requests set status=${sqlLiteral(status)} where id=${sqlLiteral(requestId)}::uuid;
      set local session_replication_role=origin; commit;`,
  );
}

export async function cleanupLegacyRequest(requestId) {
  await createP1LocalClient().sql(`begin;
    select set_config('request.jwt.claims',jsonb_build_object('sub',(select root_admin_id from public.system_security_principals where singleton),'role','authenticated')::text,true);
    do $$ begin if exists(select 1 from public.equipment_preparations where request_id=${sqlLiteral(requestId)}::uuid) then raise exception 'REFUSING_INVENTORY_HISTORY_FIXTURE_CLEANUP'; end if; end $$;
    delete from public.equipment_request_items where request_id=${sqlLiteral(requestId)}::uuid;
    delete from public.equipment_requests where id=${sqlLiteral(requestId)}::uuid;
    commit;`);
  return { error: null };
}
