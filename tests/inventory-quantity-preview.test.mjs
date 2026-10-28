import assert from "node:assert/strict";
import test from "node:test";
import { formatQuantityDelta } from "../lib/inventory/decimal.ts";

test("correction previews retain six decimals and large exact quantities", () => {
  for (const [current, previous, expected] of [
    ["1.000001", "1", "+0.000001"],
    ["1.004", "1", "+0.004"],
    ["999999999999.000001", "999999999999", "+0.000001"],
    ["1", "1.000001", "-0.000001"],
    ["1.000000", "1", "0"],
    ["0", "8", "-8"],
    ["", "1", "—"],
    ["1e3", "1", "—"],
    ["1.0000001", "1", "—"],
  ])
    assert.equal(formatQuantityDelta(current, previous), expected);
});
