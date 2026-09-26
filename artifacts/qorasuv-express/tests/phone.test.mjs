import assert from "node:assert/strict";
import { test } from "node:test";
import { formatUzPhone, normalizeUzPhone, samePhone } from "../src/lib/phone.ts";

test("the form accepts the same Uzbek formats as the server", () => {
  for (const input of ["+998 90 111 22 33", "90 111 22 33", "8 90 111 22 33", "998901112233"]) {
    assert.equal(normalizeUzPhone(input), "998901112233", input);
  }
  assert.equal(normalizeUzPhone("+7 912 345 67 89"), undefined);
  assert.equal(normalizeUzPhone("12345"), undefined);
});

test("a verified number matches however it is typed", () => {
  assert.equal(samePhone("90 111 22 33", "998901112233"), true);
  assert.equal(samePhone("90 111 22 34", "998901112233"), false);
  assert.equal(samePhone("", ""), false, "two blanks are not the same verified number");
});

test("stored numbers are shown readably", () => {
  assert.equal(formatUzPhone("998901112233"), "+998 90 111 22 33");
});
