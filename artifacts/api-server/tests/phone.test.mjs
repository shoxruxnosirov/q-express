import assert from "node:assert/strict";
import { test } from "node:test";
import { formatUzPhone, normalizeUzPhone } from "../src/lib/phone.ts";
import { parseOrderAddress } from "../src/lib/order-rules.ts";

test("every way of writing an Uzbek number becomes 998XXXXXXXXX", () => {
  for (const input of ["+998 90 111 22 33", "998901112233", "90 111 22 33", "(90) 111-22-33", "8 90 111 22 33", " +998-90-111-22-33 "]) {
    assert.equal(normalizeUzPhone(input), "998901112233", input);
  }
});

test("anything that is not an Uzbek number is refused", () => {
  for (const input of ["", "12345", "+7 912 345 67 89", "+1 202 555 0100", "9989011122334", "abc"]) {
    assert.equal(normalizeUzPhone(input), undefined, input);
  }
});

test("a stored number is shown back readably", () => {
  assert.equal(formatUzPhone("998901112233"), "+998 90 111 22 33");
  assert.equal(formatUzPhone("odd"), "odd");
});

test("an order's address is read back into dom and xonadon", () => {
  assert.deepEqual(parseOrderAddress("12-dom, 45-xonadon"), { dom: "12", xonadon: "45" });
  assert.equal(parseOrderAddress("Navoiy ko'chasi 5"), undefined);
});
