import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);
const duplicate =
  await import("../lib/equipment-request-commercial-name-duplicate.ts");

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("commercial-name duplicate helper scopes identity to an activity", () => {
  const catalog = new Map([
    ["x", { id: "x", commercial_name: " Máy X " }],
    ["x-copy", { id: "x-copy", commercial_name: "máy x" }],
    ["y", { id: "y", commercial_name: "Máy Y" }],
  ]);

  assert.equal(
    duplicate.hasDuplicateCommercialNameWithinActivity(
      [
        { activityId: "Activity A", catalogItemId: "x" },
        { activityId: "activity a", catalogItemId: "x-copy" },
      ],
      catalog,
    ),
    true,
  );
  assert.equal(
    duplicate.hasDuplicateCommercialNameWithinActivity(
      [
        { activityId: "Activity A", catalogItemId: "x" },
        { activityId: "Activity B", catalogItemId: "x-copy" },
      ],
      catalog,
    ),
    false,
  );
  assert.equal(
    duplicate.hasDuplicateCommercialNameWithinActivity(
      [
        { activityId: "Activity A", catalogItemId: "x" },
        { activityId: "Activity A", catalogItemId: "y" },
      ],
      catalog,
    ),
    false,
  );
});

test("schedule email and assignment paths preserve Lecturer 1 then Lecturer 2", async () => {
  const [migration, schema] = await Promise.all([
    source(
      "supabase/migrations/20260824110000_preserve_lecturer_order_and_equipment_commercial_name_guard.sql",
    ),
    source(
      "supabase/schemas/31_preserve_lecturer_order_and_equipment_commercial_name_guard.sql",
    ),
  ]);

  assert.match(migration, /normalized_ids := array_remove/);
  assert.match(migration, /normalized_lecturer_ids := array_remove/);
  assert.doesNotMatch(
    migration,
    /array_agg\(distinct id_val order by id_val\)/,
  );
  assert.match(migration, /preserve_schedule_email_lecturer_order/);
  assert.match(migration, /lecturer_1\.full_name[\s\S]*lecturer_2\.full_name/);
  assert.match(
    schema,
    /20260824110000_preserve_lecturer_order_and_equipment_commercial_name_guard/,
  );
});

test("both request forms hard-block duplicate commercial names and retain domain activity scope", async () => {
  const [skills, basicMedical, migration] = await Promise.all([
    source("components/equipment-request-form.tsx"),
    source("components/basic-medical-equipment-request-form.tsx"),
    source(
      "supabase/migrations/20260824110000_preserve_lecturer_order_and_equipment_commercial_name_guard.sql",
    ),
  ]);

  assert.match(skills, /hasDuplicateCommercialNameWithinActivity/);
  assert.match(skills, /activityId: item\.skillName/);
  assert.doesNotMatch(skills, /window\.confirm/);
  assert.match(basicMedical, /hasDuplicateCommercialNameWithinActivity/);
  assert.match(basicMedical, /activityId: session\.id/);
  assert.match(
    migration,
    /EQUIPMENT_REQUEST_DUPLICATE_COMMERCIAL_NAME_IN_ACTIVITY/,
  );
  assert.match(migration, /lower\(btrim\(existing\.skill_name\)\)/);
  assert.match(migration, /basic_medical_equipment_catalog/);
  assert.match(migration, /equipment_catalog/);
});
