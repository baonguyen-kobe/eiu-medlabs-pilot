import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDisplayQuantity,
  formatQuantityDelta,
} from "../lib/inventory/decimal.ts";

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

test("displayed quantities drop trailing zeros but keep exact digits", () => {
  for (const [value, expected] of [
    ["10.000000", "10"],
    ["2.500000", "2.5"],
    ["1234567.000100", "1,234,567.0001"],
    ["0.000000", "0"],
    ["-3.250", "-3.25"],
    ["15", "15"],
    [null, "0"],
  ])
    assert.equal(formatDisplayQuantity(value), expected);
});
