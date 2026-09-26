import assert from "node:assert/strict";
import { test } from "node:test";
import { clockTime, dayLabel, deliveryLabel, groupSlotsByDay } from "../src/lib/tashkent-time.ts";

const tk = (local) => new Date(`${local}+05:00`);

test("times read on the Tashkent clock, whatever the phone's zone", () => {
  assert.equal(clockTime(new Date("2026-09-28T01:00:00Z")), "06:00");
  assert.equal(clockTime(tk("2026-09-27T23:30:00")), "23:30");
});

test("days are named relative to today in Tashkent", () => {
  const now = tk("2026-09-27T23:40:00");
  assert.equal(dayLabel(tk("2026-09-27T23:50:00"), now), "Bugun");
  assert.equal(dayLabel(tk("2026-09-28T06:00:00"), now), "Ertaga");
  assert.equal(dayLabel(tk("2026-09-29T06:00:00"), now), "Indinga");
  assert.equal(dayLabel(tk("2026-09-30T06:00:00"), now), "30-sentabr");
  assert.equal(deliveryLabel(tk("2026-09-28T06:00:00"), now), "Ertaga, 06:00");
});

test("slots are grouped by day for the two selects", () => {
  const now = tk("2026-09-27T21:10:00");
  const slots = ["2026-09-27T22:00:00+05:00", "2026-09-27T22:30:00+05:00", "2026-09-28T06:00:00+05:00"].map((s) => new Date(s).toISOString());
  const days = groupSlotsByDay(slots, now);
  assert.deepEqual(days.map((d) => [d.label, d.slots.length]), [["Bugun", 2], ["Ertaga", 1]]);
});
