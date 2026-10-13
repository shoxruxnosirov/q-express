import assert from "node:assert/strict";
import { test } from "node:test";
import { clockTime, dateLabel, dateTimeLabel, dayLabel, deliveryLabel, groupSlotsByDay } from "../src/lib/tashkent-time.ts";

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

test("past moments read as a written date, never Intl's \"M10 13\"", () => {
  const now = tk("2026-10-13T20:00:00");
  // 14:32 UTC is 19:32 in Tashkent.
  assert.equal(dateTimeLabel(new Date("2026-10-13T14:32:00Z"), now), "13-oktabr, 19:32");
  assert.equal(dateTimeLabel(new Date("2026-10-13T14:32:00Z"), now, "ru"), "13 октября, 19:32");
  assert.equal(dateTimeLabel(new Date("2026-10-13T14:32:00Z"), now, "uz-Cyrl"), "13-октябрь, 19:32");
  // Late at night UTC is already the next day in Tashkent.
  assert.equal(dateLabel(new Date("2026-10-13T20:30:00Z"), now), "14-oktabr");
  assert.equal(dateLabel(tk("2025-12-31T10:00:00"), now, "en"), "31 December 2025");
});
