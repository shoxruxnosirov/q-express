import assert from "node:assert/strict";
import { test } from "node:test";
import { canChangeStatus, stockToRestore, tashkentDayStart, tashkentWeekStart } from "../src/lib/order-rules.ts";

test("an order only moves forward, and can be cancelled until delivered", () => {
  const allowed = [
    ["new", "preparing"], ["preparing", "courier"], ["courier", "delivered"],
    ["new", "cancelled"], ["preparing", "cancelled"], ["courier", "cancelled"],
  ];
  for (const [from, to] of allowed) assert.equal(canChangeStatus(from, to), true, `${from} -> ${to}`);

  const refused = [
    ["new", "courier"], ["new", "delivered"], ["preparing", "new"], ["courier", "preparing"],
    ["delivered", "cancelled"], ["delivered", "new"], ["cancelled", "new"], ["cancelled", "cancelled"],
    ["new", "new"], ["unknown", "new"], ["new", "unknown"],
  ];
  for (const [from, to] of refused) assert.equal(canChangeStatus(from, to), false, `${from} -> ${to}`);
});

test("cancelling returns each product's quantity once, summed exactly", () => {
  const restore = stockToRestore([
    { product_id: 1, quantity: 0.1 },
    { product_id: 1, quantity: 0.2 },
    { product_id: 2, quantity: 3 },
  ]);
  assert.deepEqual([...restore], [[1, 0.3], [2, 3]], "0.1 + 0.2 must be 0.3, not 0.30000000000000004");
});

test("malformed order lines are skipped, not trusted", () => {
  const restore = stockToRestore([
    { product_id: "x", quantity: 1 },
    { product_id: 3, quantity: -1 },
    { product_id: 4, quantity: "abc" },
    { product_id: 0, quantity: 1 },
    null,
    { product_id: 5, quantity: 2 },
  ]);
  assert.deepEqual([...restore], [[5, 2]]);
  assert.equal(stockToRestore(null).size, 0);
  assert.equal(stockToRestore({}).size, 0);
});

test("the shop's day starts at midnight in Tashkent, not UTC", () => {
  // 20:00 UTC on 25 Sep is already 01:00 on 26 Sep in Tashkent.
  assert.equal(tashkentDayStart(new Date("2026-09-25T20:00:00Z")).toISOString(), "2026-09-25T19:00:00.000Z");
  // 18:59 UTC is still 23:59 on the 25th in Tashkent.
  assert.equal(tashkentDayStart(new Date("2026-09-25T18:59:00Z")).toISOString(), "2026-09-24T19:00:00.000Z");
});

test("the shop's week starts on Monday in Tashkent", () => {
  // Sunday 27 Sep 2026, 20:00 UTC is Monday 28 Sep 01:00 in Tashkent.
  assert.equal(tashkentWeekStart(new Date("2026-09-27T20:00:00Z")).toISOString(), "2026-09-27T19:00:00.000Z");
  // Saturday 26 Sep midday belongs to the week that began Monday 21 Sep.
  assert.equal(tashkentWeekStart(new Date("2026-09-26T07:00:00Z")).toISOString(), "2026-09-20T19:00:00.000Z");
});

test("the free first delivery is counted per flat, however the line is spelled", async () => {
  const { addressKey } = await import("../src/lib/order-rules.ts");
  assert.equal(addressKey("12-dom, 5-xonadon"), "12|5");
  assert.equal(addressKey("  12 dom 5 xonadon "), "12|5", "the same flat");
  assert.equal(addressKey("12A-DOM, 5b-Xonadon"), "12a|5b", "letters in any case");
  assert.notEqual(addressKey("12-dom, 5-xonadon"), addressKey("12-dom, 6-xonadon"), "a neighbour is another flat");
  assert.equal(addressKey("Navoiy ko‘chasi 5"), undefined, "a line the shop did not write never goes free");
  assert.equal(addressKey("012-dom, 05-xonadon"), "12|5", "leading zeros name the same flat");
  assert.equal(addressKey("0-dom, 00-xonadon"), "0|0", "a zero stays a zero");
});
