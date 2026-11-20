import test from "node:test";
import assert from "node:assert/strict";
import {
  describeBusinessKey,
  describeIneligibility,
  businessKeyTitle,
  labelOf,
  operationLabels,
} from "../lib/inventory/labels.ts";

const id = "123e4567-e89b-12d3-a456-426614174000";

test("describeBusinessKey is readable and never shows JSON or a full UUID", () => {
  assert.equal(
    describeBusinessKey('{"ref":"OPEN-QR-1","row":"R1"}'),
    "OPEN-QR-1 · dòng R1",
  );
  assert.equal(
    describeBusinessKey(`{"rev":2,"asset_id":"${id}"}`),
    "Tài sản · phiên bản 2",
  );
  assert.equal(describeBusinessKey(`transfer:${id}`), "Điều chuyển");
  assert.equal(describeBusinessKey(`${id}:abc`).includes(id), false);
  assert.equal(describeBusinessKey(id).includes(id), false);
  assert.equal(describeBusinessKey("{broken"), "Phiếu hệ thống");
  assert.equal(describeBusinessKey(""), "—");
  assert.equal(businessKeyTitle(`transfer:${id}`), "transfer:123e4567");
});

test("describeIneligibility maps known reasons and keeps unknown text", () => {
  assert.match(
    describeIneligibility(
      "Lifecycle status is registered (requires in_service)",
    ),
    /Mới tiếp nhận/,
  );
  assert.match(
    describeIneligibility("Asset expired on 2026-01-01"),
    /2026-01-01/,
  );
  assert.equal(describeIneligibility("Something else"), "Something else");
});

test("labelOf falls back to the code", () => {
  assert.equal(labelOf(operationLabels, "RECEIVE"), "Nhận kho");
  assert.equal(labelOf(operationLabels, "NEW_OP"), "NEW_OP");
});
