import assert from "node:assert/strict";
import { test } from "node:test";
import { offeredSlots, reconcileChoice } from "../src/lib/delivery-choice.ts";

const tk = (local) => new Date(`${local}+05:00`).toISOString();
// The status as refreshed at 12:31: the list now starts at 13:30, but the
// server still accepts anything from 12:41.
const at1231 = { open_now: true, slots: [tk("2026-09-27T13:30:00"), tk("2026-09-27T14:00:00")], earliest_accepted_at: tk("2026-09-27T12:41:00") };

test("a chosen time that dropped off the list but is still accepted stays chosen", () => {
  const chosen = { mode: "later", slot: tk("2026-09-27T13:00:00") };
  const { next, change } = reconcileChoice(at1231, chosen);
  assert.deepEqual(next, chosen, "13:00 is not silently replaced by 13:30");
  assert.equal(change, undefined);
  assert.equal(offeredSlots(at1231, chosen)[0], chosen.slot, "and the time select still shows it");
});

test("a chosen time that can no longer be taken moves on, and says so", () => {
  const chosen = { mode: "later", slot: tk("2026-09-27T12:30:00") };
  const { next, change } = reconcileChoice(at1231, chosen);
  assert.deepEqual(next, { mode: "later", slot: tk("2026-09-27T13:30:00") });
  assert.deepEqual(change, { reason: "expired", from: chosen.slot });
});

test("a shop closing while checkout is open moves 'now' to a pre-order and says so", () => {
  const closed = { ...at1231, open_now: false };
  const { next, change } = reconcileChoice(closed, { mode: "now", slot: "" }, true);
  assert.deepEqual(next, { mode: "later", slot: tk("2026-09-27T13:30:00") });
  assert.deepEqual(change, { reason: "closed" }, "an order for now never quietly becomes one for later");
});

test("a shop already closed when checkout opens just starts on pre-order, with no alarm", () => {
  const closed = { ...at1231, open_now: false };
  const { next, change } = reconcileChoice(closed, { mode: "now", slot: "" }, false);
  assert.deepEqual(next, { mode: "later", slot: tk("2026-09-27T13:30:00") });
  assert.equal(change, undefined);
});

test("an untouched choice, an empty list and 'now' while open are left alone", () => {
  assert.deepEqual(reconcileChoice(at1231, { mode: "now", slot: "" }).next, { mode: "now", slot: "" });
  const empty = { open_now: false, slots: [], earliest_accepted_at: tk("2026-09-27T12:41:00") };
  const { next, change } = reconcileChoice(empty, { mode: "later", slot: "" });
  assert.deepEqual(next, { mode: "later", slot: "" }, "no loop on an empty list");
  assert.equal(change, undefined, "nothing was chosen, so nothing moved");
  assert.equal(reconcileChoice(empty, { mode: "now", slot: "" }, true).change, undefined, "closed with no slots: nothing to announce a move to");
});
