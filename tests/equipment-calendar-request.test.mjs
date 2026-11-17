import assert from "node:assert/strict";
import test from "node:test";

const calendarRequest = await import("../lib/equipment-calendar-request.ts");

test("calendar normalizes one-to-one equipment request objects and arrays", () => {
  const request = { id: "11111111-1111-4111-8111-111111111111", status: "new" };
  assert.deepEqual(
    calendarRequest.normalizeCalendarEquipmentRequest(request),
    request,
  );
  assert.deepEqual(
    calendarRequest.normalizeCalendarEquipmentRequest([request]),
    request,
  );
  assert.equal(
    calendarRequest.normalizeCalendarEquipmentRequest(null),
    undefined,
  );
  assert.equal(
    calendarRequest.normalizeCalendarEquipmentRequest({
      ...request,
      status: null,
    }),
    undefined,
  );
});

test("calendar uses role-aware exact-request deep links", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    calendarRequest.equipmentRequestDeepLink(["admin"], id),
    `/equipment/requests?request=${id}`,
  );
  assert.equal(
    calendarRequest.equipmentRequestDeepLink(["lecturer"], id),
    `/equipment/mine?request=${id}`,
  );
});
