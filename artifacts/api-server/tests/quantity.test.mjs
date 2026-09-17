import assert from "node:assert/strict";
import test from "node:test";
import {
  addMicroquantities,
  deriveAmountQuantityMicro,
  quantityTotalCents,
  MICROQUANTITY_SCALE,
  requireWholeUnitQuantity,
} from "../src/lib/quantity.ts";

test("amount mode keeps the requested UZS total and derives six-decimal quantity", () => {
  const quantity = deriveAmountQuantityMicro(10_000 * 100, 12_000 * 100);
  assert.equal(quantity, 833_333);
  assert.equal(quantityTotalCents(12_000 * 100, quantity), 10_000 * 100);
});

test("quantity mode rounds a fractional litre total to kopeks", () => {
  assert.equal(quantityTotalCents(4_500 * 100, MICROQUANTITY_SCALE / 2), 2_250 * 100);
});

test("integer arithmetic does not silently accept an unsafe quantity", () => {
  assert.throws(
    () => quantityTotalCents(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
    /safe integer/,
  );
});

test("duplicate quantity lines aggregate before stock reservation", () => {
  assert.equal(addMicroquantities(500_000, 500_000), MICROQUANTITY_SCALE);
});

test("dona and qadoq quantities must be whole units", () => {
  assert.throws(() => requireWholeUnitQuantity(500_000), /whole positive/);
  assert.equal(requireWholeUnitQuantity(MICROQUANTITY_SCALE), MICROQUANTITY_SCALE);
});