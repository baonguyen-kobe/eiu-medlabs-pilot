import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [action, page, list, evidenceFlag, evidencePage] = await Promise.all([
  readFile(
    new URL("../app/basic-medical/registrations/actions.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../app/basic-medical/registrations/page.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../components/basic-medical-registration-list.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../lib/basic-medical-confirmation-evidence.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../app/basic-medical/registrations/confirmations/[id]/page.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
]);

const snapshotFields = [
  "inventory_id",
  "newly_damaged_quantity",
  "expected_catalog_item_id",
  "expected_total_quantity",
  "expected_good_quantity",
  "expected_damaged_quantity",
  "expected_item_name",
  "expected_commercial_name",
  "expected_unit",
];

test("bridge emits the complete reviewed confirmation snapshot contract", () => {
  for (const field of snapshotFields) assert.match(action, new RegExp(field));
  assert.match(page, /basic_medical_equipment_catalog!inner/);
  assert.match(page, /\.eq\("catalog\.is_active", true\)/);
  assert.match(list, /expectedCatalogItemId: inventory\.catalog_item_id/);
  assert.match(list, /expectedItemName: inventory\.catalog\?\.item_name/);
  assert.doesNotMatch(
    action,
    /checks\.map\(\(\{ inventoryId, newlyDamagedQuantity \}\)/,
  );
});

test("evidence flag is server-only and defaults fail-closed", () => {
  assert.match(evidenceFlag, /^import "server-only";/);
  assert.match(
    evidenceFlag,
    /process\.env\.BASIC_MEDICAL_CONFIRMATION_EVIDENCE_ENABLED === "true"/,
  );
  assert.doesNotMatch(evidenceFlag, /NEXT_PUBLIC_/);
  assert.match(
    list,
    /evidenceEnabled \? \(\s*<>[\s\S]*historicalConfirmations[\s\S]*<\/>\s*\) : null/,
  );
  assert.match(list, /evidenceEnabled\s*\? invalidatedConfirmations\.map/);
  assert.match(
    page,
    /evidenceEnabled=\{isBasicMedicalConfirmationEvidenceEnabled\(\)\}/,
  );
});

test("disabled evidence route terminates before auth or RPC work", () => {
  const guard = evidencePage.indexOf(
    "if (!isBasicMedicalConfirmationEvidenceEnabled()) notFound();",
  );
  const viewer = evidencePage.indexOf("await getViewer()");
  const rpc = evidencePage.indexOf('"get_basic_medical_confirmation_evidence"');
  assert.ok(guard >= 0);
  assert.ok(viewer > guard);
  assert.ok(rpc > viewer);
});

test("evidence UI preserves reviewed Vietnamese text encoding", () => {
  assert.match(list, /Xem bằng chứng/);
  assert.match(evidencePage, /BẰNG CHỨNG XÁC NHẬN Y CƠ SỞ/);
  assert.match(evidencePage, /Chữ ký điện tử/);
  assert.match(
    evidencePage,
    /<th>\s*<LocalizedText text=\{"ĐVT"\} \/>\s*<\/th>/,
  );
  assert.doesNotMatch(`${list}\n${evidencePage}`, /(?:Ã.|Â.|Æ.|áº|á»|Ä)/);
});
