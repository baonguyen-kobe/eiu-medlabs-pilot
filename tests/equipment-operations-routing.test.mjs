import assert from "node:assert/strict";
import test from "node:test";
import { equipmentOperationHref } from "../lib/equipment-operations.ts";

test("worklist sends pre-inventory requests to their read-only detail page", () => {
  for (const status of ["preparing", "handed_over", "returned"])
    assert.equal(
      equipmentOperationHref({
        id: "legacy",
        status,
        prepared: false,
        has_preparation: false,
      }),
      "/equipment/requests/legacy",
    );
  assert.equal(
    equipmentOperationHref({
      id: "draft",
      status: "new",
      prepared: false,
      has_preparation: false,
    }),
    "/equipment/preparation/draft",
  );
  assert.equal(
    equipmentOperationHref({
      id: "reverse",
      status: "preparing",
      prepared: false,
      has_preparation: true,
    }),
    "/equipment/preparation/reverse",
  );
  assert.equal(
    equipmentOperationHref({
      id: "issue",
      status: "handed_over",
      prepared: true,
      has_preparation: true,
    }),
    "/equipment/fulfillment/issue",
  );
});
