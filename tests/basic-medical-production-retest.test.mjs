import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  identityMigration,
  identitySchema,
  dashboardActions,
  evidencePage,
  evidencePdfRoute,
  evidencePdf,
  inventoryManager,
  skillsCatalogManager,
] = await Promise.all([
  readFile(
    new URL(
      "../supabase/migrations/20260813130000_basic_medical_catalog_commercial_name_identity.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../supabase/schemas/18_basic_medical_catalog_identity.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(new URL("../app/dashboard/actions.ts", import.meta.url), "utf8"),
  readFile(
    new URL(
      "../app/basic-medical/registrations/confirmations/[id]/page.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../app/api/basic-medical/registrations/confirmations/[id]/pdf/route.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../lib/basic-medical-evidence-pdf.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../components/basic-medical-equipment-manager.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../components/equipment-catalog-manager.tsx", import.meta.url),
    "utf8",
  ),
]);

test("Basic Medical commercial name is a fail-closed durable catalog identity", () => {
  for (const sql of [identityMigration, identitySchema]) {
    assert.match(sql, /null or blank rows/i);
    assert.match(sql, /duplicate normalized commercial names/i);
    assert.match(sql, /alter column commercial_name set not null/i);
    assert.match(sql, /check \(btrim\(commercial_name\) <> ''\)/i);
    assert.match(
      sql,
      /create unique index basic_medical_catalog_commercial_name_normalized_key/i,
    );
    assert.match(
      sql,
      /lower\(btrim\(catalog\.commercial_name\)\) = item->>'normalized_commercial_name'/i,
    );
    assert.match(sql, /DUPLICATE_BASIC_MEDICAL_CATALOG_IMPORT_COMMERCIAL_NAME/);
    assert.doesNotMatch(
      sql,
      /delete from public\.basic_medical_equipment_catalog/i,
    );
  }
});

test("linked Basic Medical schedule cancellation uses the canonical one-session RPC", () => {
  const branch = dashboardActions.slice(
    dashboardActions.indexOf("export async function adminCancelClass"),
  );
  assert.match(branch, /select\("basic_medical_registration_id"\)/);
  assert.match(branch, /if \(schedule\.basic_medical_registration_id\)/);
  assert.match(branch, /from\("basic_medical_registration_sessions"\)/);
  assert.match(branch, /rpc\(\s*"cancel_basic_medical_session"/);
  assert.doesNotMatch(branch, /cancel_basic_medical_registration/);
  assert.match(branch, /rpc\("cancel_class_schedule"/);
  assert.ok(
    branch.indexOf("cancel_basic_medical_session") <
      branch.indexOf("cancel_class_schedule"),
  );
});

test("evidence UI and PDF stay feature-gated, snapshot-only, and readable", () => {
  assert.match(
    evidencePage,
    /title=\{<LocalizedText text=\{"BẰNG CHỨNG XÁC NHẬN Y CƠ SỞ"\} \/>\}/,
  );
  assert.match(
    evidencePage,
    /<th>\s*<LocalizedText text=\{"ĐVT"\} \/>\s*<\/th>/,
  );
  assert.match(evidencePage, /Xuất PDF/);
  assert.doesNotMatch(evidencePage, /(?:Ã.|Â.|Æ.|áº|á»|Ä)/);
  assert.match(
    evidencePdfRoute,
    /if \(!isBasicMedicalConfirmationEvidenceEnabled\(\)\)/,
  );
  assert.match(evidencePdfRoute, /auth\.getClaims\(\)/);
  assert.match(evidencePdfRoute, /get_basic_medical_confirmation_evidence/);
  assert.match(evidencePdfRoute, /application\/pdf/);
  assert.match(evidencePdfRoute, /Cache-Control": "private, no-store/);
  assert.doesNotMatch(evidencePdfRoute, /\.from\(/);
  assert.match(evidencePdf, /BẰNG CHỨNG XÁC NHẬN Y CƠ SỞ/);
  assert.match(evidencePdf, /equipment_checks/);
  assert.doesNotMatch(evidencePdf, /basic_medical_equipment_catalog/);
});

test("catalog managers offer explicit reactivation without changing inventory eligibility", () => {
  assert.match(
    inventoryManager,
    /setBasicMedicalCatalogActive\(selectedIds, action === "activate"\)/,
  );
  assert.match(inventoryManager, />\s*\{uiText\("Kích hoạt"\)\}\s*</);
  assert.match(skillsCatalogManager, /setEquipmentCatalogActive\(ids, true\)/);
  assert.match(skillsCatalogManager, /mode === "activate"/);
  assert.match(
    skillsCatalogManager,
    /mode === "activate"\s*\|\|\s*mode === "disable"\s*\|\|\s*mode === "delete"/,
  );
});
