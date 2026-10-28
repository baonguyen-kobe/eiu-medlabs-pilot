import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { createEquipmentFulfillmentPdf } from "../lib/equipment-fulfillment-pdf.ts";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const event = {
  id: "event-1",
  actor_id: "warehouse-staff-1",
  revision: 1,
  operation: "handover",
  occurred_at: "2026-10-28T02:00:00Z",
  reason: "Giao dụng cụ thực hành",
  signature_required: true,
  superseded: false,
  snapshot_hash: "a".repeat(64),
  snapshot: {},
  payload: {},
  signature: null,
  display_lines: [
    {
      id: "line-1",
      kind: "issue",
      item_name: "Dụng cụ thực hành tiếng Việt",
      unit: "cái",
      quantity: "6",
      condition: "good",
      asset_code: null,
      issue_slice_id: "slice-1",
    },
  ],
};
const workspace = {
  request_id: "request-1",
  revision: 1,
  status: "handed_over",
  manager: true,
  admin: true,
  signer: false,
  lines: [{ registered_quantity: "10", planned_quantity: "8" }],
  locations: [],
  issues: [
    {
      id: "slice-1",
      item_name: "Dụng cụ thực hành tiếng Việt",
      base_uom_code: "cái",
      issued: "6",
      returned: "0",
      resolved: "0",
      due: "6",
      held: "0",
      asset_code: null,
    },
  ],
  events: [event],
  event_count: 1,
};

test("fulfillment export generates a valid Vietnamese PDF including actual event and PNG evidence", async () => {
  const bytes = await createEquipmentFulfillmentPdf(workspace, [
    {
      event_id: event.id,
      actor_id: "actor-1",
      signed_at: event.occurred_at,
      snapshot_hash: event.snapshot_hash,
      signature: png,
    },
  ]);
  assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  assert.ok(bytes.length > 2000);
  if (process.env.MEDLABS_PDF_QA_OUTPUT)
    await writeFile(process.env.MEDLABS_PDF_QA_OUTPUT, bytes);
});
test("fulfillment export paginates long immutable histories", async () => {
  const events = Array.from({ length: 60 }, (_, i) => ({
    ...event,
    id: `event-${i}`,
    revision: i + 1,
    reason: "Nội dung giao nhận tiếng Việt dài ".repeat(8),
  }));
  const bytes = await createEquipmentFulfillmentPdf(
    { ...workspace, events, event_count: 60 },
    [],
  );
  assert.ok(
    (bytes.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length > 2,
  );
});
test("fulfillment export refuses a mismatched signature hash", async () => {
  await assert.rejects(
    () =>
      createEquipmentFulfillmentPdf(workspace, [
        {
          event_id: event.id,
          actor_id: "actor-1",
          signed_at: event.occurred_at,
          snapshot_hash: "wrong",
          signature: png,
        },
      ]),
    /SIGNATURE_SNAPSHOT_MISMATCH/,
  );
});
