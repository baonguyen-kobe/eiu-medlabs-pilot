import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sqlFiles = [
  "../supabase/migrations/20260903120000_preserve_historical_equipment_responsible_lecturer.sql",
  "../supabase/schemas/33_preserve_historical_equipment_responsible_lecturer.sql",
];

const unchangedSkillsCondition =
  /if tg_op = 'UPDATE'\s+and new\.request_domain = 'nursing_skills'\s+and old\.request_domain = 'nursing_skills'\s+and new\.responsible_lecturer_id is not distinct from old\.responsible_lecturer_id then/;

test("updateEquipmentRequest preserves its existing historical responsible lecturer", () => {
  const source = readFileSync(
    new URL("../app/equipment/actions.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /"id,class_schedule_id,registrant_id,responsible_lecturer_id,status,request_domain,semester,receive_at,late_approval_status,late_registration_reason"/,
  );
  assert.match(
    source,
    /const preservesResponsibleLecturer =\s*responsibleId === request\.responsible_lecturer_id;/,
  );
  assert.match(
    source,
    /if\s*\(\s*!preservesResponsibleLecturer\s*&&\s*responsibleId !== request\.registrant_id\s*&&\s*!eligibleLecturerIds\.has\(responsibleId\)\s*\)/,
  );
});

test("Skills-only historical bypass is identical in migration and schema", () => {
  for (const file of sqlFiles) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const contentValidatorStart = source.indexOf(
      "create or replace function private.validate_equipment_request_content()",
    );
    const updateGuardStart = source.indexOf(
      "create or replace function private.guard_equipment_request_update()",
    );

    assert.notEqual(contentValidatorStart, -1);
    assert.notEqual(updateGuardStart, -1);
    assert.ok(updateGuardStart > contentValidatorStart);

    const contentValidator = source.slice(
      contentValidatorStart,
      updateGuardStart,
    );
    assert.match(contentValidator, unchangedSkillsCondition);
    assert.match(source, /ROOT_ADMIN_OPERATIONAL_ASSIGNMENT_FORBIDDEN/);
    assert.match(
      source,
      /and new\.responsible_lecturer_id is distinct from old\.responsible_lecturer_id\s+and not exists \(/,
    );
    assert.doesNotMatch(
      contentValidator,
      /if tg_op = 'UPDATE'\s+and new\.responsible_lecturer_id\s+is not distinct from old\.responsible_lecturer_id then\s+return new;/,
    );
  }
});
