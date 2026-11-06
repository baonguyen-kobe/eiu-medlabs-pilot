import assert from "node:assert/strict";
import test from "node:test";
import {
  returnEntryError,
  returnEntryLines,
} from "../lib/inventory/decimal.ts";

const issue = { issued: "6", returned: "4" };

test("a return row accepts this visit's good and damaged within what is still out", () => {
  assert.equal(returnEntryError({ good: "", damaged: "" }, issue), null);
  assert.equal(returnEntryError({ good: "1", damaged: "1" }, issue), null);
  assert.equal(returnEntryError({ good: "1.5", damaged: "0.5" }, issue), null);
});

test("a return row rejects quantities above what is still out", () => {
  assert.match(
    returnEntryError({ good: "2", damaged: "0.000001" }, issue),
    /vượt/,
  );
});

test("a return row rejects values that are not exact quantities", () => {
  for (const good of ["1,5", "-1", "1e2", "1.0000001", "abc"]) {
    assert.match(returnEntryError({ good, damaged: "" }, issue), /Nhập số/);
  }
});

test("each condition with a quantity becomes one line; blanks and zero do not", () => {
  assert.deepEqual(
    returnEntryLines(
      {
        a: { good: "3", damaged: "1" },
        b: { good: "", damaged: "0" },
        c: { good: "0.000000", damaged: "2" },
      },
      "location",
    ),
    [
      {
        issue_slice_id: "a",
        quantity: "3",
        location_id: "location",
        condition: "good",
      },
      {
        issue_slice_id: "a",
        quantity: "1",
        location_id: "location",
        condition: "damaged",
      },
      {
        issue_slice_id: "c",
        quantity: "2",
        location_id: "location",
        condition: "damaged",
      },
    ],
  );
});
