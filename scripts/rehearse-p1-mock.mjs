import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// Standalone contract rehearsal ONLY. Never imported by the application; no DB/network writes.
const manifest = JSON.parse(
  readFileSync(
    new URL("../docs/architecture/P1_MOCK_MANIFEST.json", import.meta.url),
    "utf8",
  ),
);
assert.equal(manifest.synthetic, true);
assert.equal(manifest.real_activation, false);
assert.equal(manifest.marker_runtime_enforced, false);
const fingerprint = createHash("sha256")
  .update(
    JSON.stringify({
      manifest_id: manifest.manifest_id,
      scope_id: manifest.scope_id,
      scope_version: manifest.scope_version,
      target: manifest.target_project_ref,
      location: manifest.location,
      users: manifest.users,
      items: manifest.items,
      opening: manifest.opening_payload,
      asset: manifest.asset,
      workflow: manifest.workflow,
    }),
  )
  .digest("hex");
const command = {
  target: manifest.target_project_ref,
  scope_id: manifest.scope_id,
  scope_version: manifest.scope_version,
  manifest_id: manifest.manifest_id,
  fingerprint,
  writer: "pilot_rpc",
  actor_id: manifest.users[0].id,
  location_id: manifest.location.id,
  item_id: manifest.items.find((item) => item.key === "consumable").id,
  domain: "nursing_skills",
  new_request: true,
  legacy_obligation: false,
  operation: "opening",
};
function newMarker() {
  return {
    phase: "OPENING_READY",
    reconciled: false,
    exclusions_proven: false,
    dual_write: false,
    writers: {
      pilot_rpc: "exclusive",
      legacy: "excluded",
      privileged: "excluded",
    },
  };
}
function gate(marker, input) {
  if (
    input.target !== manifest.target_project_ref ||
    input.target !== "kwpyukofofoaqhmxndlc"
  )
    return "WRONG_TARGET";
  if (
    input.scope_id !== manifest.scope_id ||
    input.scope_version !== manifest.scope_version ||
    input.manifest_id !== manifest.manifest_id ||
    input.fingerprint !== fingerprint
  )
    return "STALE_OR_WRONG_MANIFEST";
  if (
    input.location_id !== manifest.location.id ||
    !manifest.items.some((item) => item.id === input.item_id)
  )
    return "OUT_OF_SCOPE";
  const item = manifest.items.find((entry) => entry.id === input.item_id);
  if (
    item.tracking_strategy === "serialized" &&
    input.asset_id !== manifest.asset.id
  )
    return "WRONG_EXACT_ASSET";
  if (
    input.domain !== "nursing_skills" ||
    !input.new_request ||
    input.legacy_obligation
  )
    return "EXCLUDED_WORKFLOW";
  const actor = manifest.users.find(
    (user) => user.id === input.actor_id && user.is_active,
  );
  if (!actor) return "UNREGISTERED_ACTOR";
  if (
    input.writer !== "pilot_rpc" ||
    marker.writers.pilot_rpc !== "exclusive" ||
    marker.writers.legacy !== "excluded" ||
    marker.writers.privileged !== "excluded"
  )
    return "WRITER_NOT_EXCLUSIVE";
  if (marker.phase === "PAUSED" || marker.dual_write) return "PAUSED";
  if (input.operation === "opening") {
    if (marker.phase !== "OPENING_READY") return "OPENING_CLOSED";
    if (actor.id !== manifest.users[0].id || actor.role !== "admin")
      return "ADMIN_REQUIRED";
    return "ALLOW";
  }
  if (input.operation !== "physical") return "UNKNOWN_OPERATION";
  return marker.phase === "ACTIVE" ? "ALLOW" : "NOT_ACTIVE";
}
function activate(marker) {
  if (marker.phase !== "OPENING_READY") return "INVALID_TRANSITION";
  if (!marker.reconciled) return "RECONCILIATION_REQUIRED";
  if (
    !marker.exclusions_proven ||
    marker.writers.legacy !== "excluded" ||
    marker.writers.privileged !== "excluded"
  )
    return "EXCLUSIONS_REQUIRED";
  if (marker.dual_write) return "DUAL_WRITE";
  marker.phase = "ACTIVE";
  return "ALLOW";
}
function signal(marker, event) {
  if (event.scope_id !== manifest.scope_id) return "OUTSIDE_SCOPE_UNCHANGED";
  if (event.writer !== "pilot_rpc") {
    marker.dual_write = true;
    marker.phase = "PAUSED";
    return "DUAL_WRITE_PAUSED";
  }
  return "PILOT_EVENT";
}
function pause(marker, reason) {
  if (!reason.trim()) return "REASON_REQUIRED";
  marker.phase = "PAUSED";
  return "ALLOW";
}
const results = [];
function check(name, actual, expected) {
  assert.equal(actual, expected, name);
  results.push({ name, result: actual, status: "PASS_SIMULATION_ONLY" });
}
const marker = newMarker();
check("named Admin opening in OPENING_READY", gate(marker, command), "ALLOW");
for (const user of manifest.users.filter((entry) => entry.role === "staff")) {
  check(
    `Staff opening denied: ${user.full_name}`,
    gate(marker, { ...command, actor_id: user.id }),
    "ADMIN_REQUIRED",
  );
}
check(
  "physical write before ACTIVE",
  gate(marker, { ...command, operation: "physical" }),
  "NOT_ACTIVE",
);
check(
  "stale scope version",
  gate(marker, { ...command, scope_version: 0 }),
  "STALE_OR_WRONG_MANIFEST",
);
check(
  "changed count/expiry manifest fingerprint",
  gate(marker, { ...command, fingerprint: "altered" }),
  "STALE_OR_WRONG_MANIFEST",
);
check(
  "wrong business manifest",
  gate(marker, { ...command, manifest_id: "different" }),
  "STALE_OR_WRONG_MANIFEST",
);
check(
  "production target",
  gate(marker, { ...command, target: "bwhiivfhezoozrzvchmm" }),
  "WRONG_TARGET",
);
check(
  "wrong location",
  gate(marker, { ...command, location_id: "outside" }),
  "OUT_OF_SCOPE",
);
check(
  "wrong item",
  gate(marker, { ...command, item_id: "outside" }),
  "OUT_OF_SCOPE",
);
check(
  "unregistered actor",
  gate(marker, { ...command, actor_id: "outside" }),
  "UNREGISTERED_ACTOR",
);
check(
  "Basic Medical excluded",
  gate(marker, { ...command, domain: "basic_medical" }),
  "EXCLUDED_WORKFLOW",
);
check(
  "old request excluded",
  gate(marker, { ...command, new_request: false }),
  "EXCLUDED_WORKFLOW",
);
check(
  "legacy obligation excluded",
  gate(marker, { ...command, legacy_obligation: true }),
  "EXCLUDED_WORKFLOW",
);
check(
  "legacy writer rejected",
  gate(marker, { ...command, writer: "legacy" }),
  "WRITER_NOT_EXCLUSIVE",
);
check(
  "privileged/import bypass rejected",
  gate(marker, { ...command, writer: "privileged" }),
  "WRITER_NOT_EXCLUSIVE",
);
check(
  "activation before reconciliation",
  activate(marker),
  "RECONCILIATION_REQUIRED",
);
// Actual fixture quantities/eligibility reconciled separately in SQL; exclusions remain invented rehearsal evidence.
marker.reconciled = true;
check(
  "activation before writer exclusion evidence",
  activate(marker),
  "EXCLUSIONS_REQUIRED",
);
marker.exclusions_proven = true;
marker.writers.legacy = "enabled";
check(
  "activation with competing writer",
  activate(marker),
  "EXCLUSIONS_REQUIRED",
);
marker.writers.legacy = "excluded";
check("activation after simulated gates", activate(marker), "ALLOW");
check("opening after ACTIVE", gate(marker, command), "OPENING_CLOSED");
for (const user of manifest.users.filter((entry) => entry.role === "staff")) {
  check(
    `scoped Staff physical write in ACTIVE: ${user.full_name}`,
    gate(marker, { ...command, actor_id: user.id, operation: "physical" }),
    "ALLOW",
  );
}
const serialized = {
  ...command,
  operation: "physical",
  item_id: manifest.asset.catalog_item_id,
  asset_id: manifest.asset.id,
};
check("exact asset allowed", gate(marker, serialized), "ALLOW");
check(
  "wrong exact asset rejected",
  gate(marker, { ...serialized, asset_id: "different" }),
  "WRONG_EXACT_ASSET",
);
check(
  "out-of-scope control unaffected",
  signal(marker, { scope_id: "outside", writer: "legacy" }),
  "OUTSIDE_SCOPE_UNCHANGED",
);
assert.equal(marker.phase, "ACTIVE");
check(
  "pilot-only event",
  signal(marker, { scope_id: manifest.scope_id, writer: "pilot_rpc" }),
  "PILOT_EVENT",
);
check(
  "dual-write signal auto-pauses",
  signal(marker, { scope_id: manifest.scope_id, writer: "legacy" }),
  "DUAL_WRITE_PAUSED",
);
check(
  "PAUSED Staff write rejected",
  gate(marker, {
    ...command,
    actor_id: manifest.users[1].id,
    operation: "physical",
  }),
  "PAUSED",
);
check("PAUSED Admin opening rejected", gate(marker, command), "PAUSED");
check("unsafe reactivation rejected", activate(marker), "INVALID_TRANSITION");
assert.equal(
  marker.writers.legacy,
  "excluded",
  "Pause never silently hands back to legacy writer",
);
const manualPause = newMarker();
check("pause requires reason", pause(manualPause, " "), "REASON_REQUIRED");
check(
  "manual pause",
  pause(manualPause, "MOCK discrepancy investigation"),
  "ALLOW",
);
console.log(
  JSON.stringify(
    {
      kind: "SIMULATION_ONLY_NO_RUNTIME_ENFORCEMENT",
      scope_id: manifest.scope_id,
      scope_version: manifest.scope_version,
      manifest_id: manifest.manifest_id,
      fingerprint,
      phase_trace: ["OPENING_READY", "ACTIVE", "PAUSED"],
      final_phase: marker.phase,
      checks: results.length,
      results,
      limitations: [
        "No marker deployed",
        "No real writer frozen or exclusion proved",
        "No real dual-write detected",
        "No real P1 activation",
        "No production target touched",
        "Privileged bypass is modeled, not DB-enforced",
      ],
    },
    null,
    2,
  ),
);
