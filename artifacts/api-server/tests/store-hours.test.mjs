import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deliverySlots,
  earliestAcceptedAt,
  formatTashkent,
  isOpenNow,
  nextOpenAt,
  scheduleProblem,
  withinHours,
} from "../src/lib/store-hours.ts";

// Tashkent is UTC+5: "2026-09-27T09:00+05:00" is 04:00 UTC.
const tk = (local) => new Date(`${local}+05:00`);
const HOURS = { openTime: "06:00", closeTime: "23:00", acceptingOrders: true };

test("open from the opening minute up to, not including, the closing minute", () => {
  assert.equal(withinHours(tk("2026-09-27T05:59:00"), "06:00", "23:00"), false);
  assert.equal(withinHours(tk("2026-09-27T06:00:00"), "06:00", "23:00"), true);
  assert.equal(withinHours(tk("2026-09-27T22:59:00"), "06:00", "23:00"), true);
  assert.equal(withinHours(tk("2026-09-27T23:00:00"), "06:00", "23:00"), false);
  assert.equal(withinHours(tk("2026-09-27T02:00:00"), "06:00", "23:00"), false, "the night between");
});

test("hours that run past midnight, and all-day hours", () => {
  assert.equal(withinHours(tk("2026-09-27T23:30:00"), "18:00", "02:00"), true);
  assert.equal(withinHours(tk("2026-09-27T01:59:00"), "18:00", "02:00"), true);
  assert.equal(withinHours(tk("2026-09-27T02:00:00"), "18:00", "02:00"), false);
  assert.equal(withinHours(tk("2026-09-27T12:00:00"), "18:00", "02:00"), false);
  assert.equal(withinHours(tk("2026-09-27T03:00:00"), "00:00", "00:00"), true, "equal times mean never closed");
});

test("the shop's day follows Tashkent, not the server's UTC clock", () => {
  // 01:30 UTC is 06:30 in Tashkent: open, though it is the small hours in UTC.
  assert.equal(isOpenNow(HOURS, new Date("2026-09-27T01:30:00Z")), true);
  // 18:30 UTC is 23:30 in Tashkent: closed.
  assert.equal(isOpenNow(HOURS, new Date("2026-09-27T18:30:00Z")), false);
});

test("a paused shop is closed whatever the hours say", () => {
  assert.equal(isOpenNow({ ...HOURS, acceptingOrders: false }, tk("2026-09-27T12:00:00")), false);
  assert.deepEqual(deliverySlots({ ...HOURS, acceptingOrders: false }, tk("2026-09-27T12:00:00")), []);
  assert.match(scheduleProblem(tk("2026-09-27T14:00:00"), { ...HOURS, acceptingOrders: false }, tk("2026-09-27T12:00:00")), /qabul qilinmayapti/);
});

test("next opening is this morning before 06:00, tomorrow after 23:00, none while open", () => {
  assert.equal(nextOpenAt(HOURS, tk("2026-09-27T03:00:00")).getTime(), tk("2026-09-27T06:00:00").getTime());
  assert.equal(nextOpenAt(HOURS, tk("2026-09-27T23:30:00")).getTime(), tk("2026-09-28T06:00:00").getTime());
  assert.equal(nextOpenAt(HOURS, tk("2026-09-27T12:00:00")), null);
});

test("at night the first pre-order slot is the opening time", () => {
  const slots = deliverySlots(HOURS, tk("2026-09-27T23:40:00"));
  assert.equal(slots[0].getTime(), tk("2026-09-28T06:00:00").getTime());
  assert.ok(slots.every((slot) => withinHours(slot, "06:00", "23:00")), "never a slot at night");
  assert.equal(slots.at(-1).getTime(), tk("2026-09-29T22:30:00").getTime(), "the last bookable day ends at the last slot before closing");
});

test("by day slots start at least half an hour ahead, on the half hour", () => {
  const slots = deliverySlots(HOURS, tk("2026-09-27T12:10:00"));
  assert.equal(slots[0].getTime(), tk("2026-09-27T13:00:00").getTime());
  assert.equal(slots[1].getTime(), tk("2026-09-27T13:30:00").getTime());
  // today 13:00..22:30 (20) + two full days 06:00..22:30 (34 each)
  assert.equal(slots.length, 20 + 34 + 34);
});

test("every listed slot is accepted; anything off the list is refused with a reason", () => {
  const now = tk("2026-09-27T12:10:00");
  for (const slot of deliverySlots(HOURS, now)) assert.equal(scheduleProblem(slot, HOURS, now), undefined, slot.toISOString());
  assert.match(scheduleProblem(tk("2026-09-28T03:00:00"), HOURS, now), /ish vaqtida: 06:00–23:00/);
  assert.match(scheduleProblem(tk("2026-09-27T12:00:00"), HOURS, now), /o‘tib ketdi/);
  assert.match(scheduleProblem(tk("2026-09-27T14:15:00"), HOURS, now), /ro‘yxatdan tanlang/);
  assert.match(scheduleProblem(tk("2026-09-30T10:00:00"), HOURS, now), /3 kun/);
  assert.match(scheduleProblem(new Date("not a date"), HOURS, now), /noto‘g‘ri/);
});

test("a slot listed a few minutes ago is still honoured when the button is pressed", () => {
  const listedAt = tk("2026-09-27T12:25:00");
  const [first] = deliverySlots(HOURS, listedAt);
  assert.equal(first.getTime(), tk("2026-09-27T13:00:00").getTime());
  assert.equal(scheduleProblem(first, HOURS, tk("2026-09-27T12:45:00")), undefined, "15 minutes ahead is still fine");
});

test("the earliest accepted time the storefront is told is exactly the server's boundary", () => {
  const now = tk("2026-09-27T12:31:00");
  const earliest = earliestAcceptedAt(now);
  assert.equal(earliest.getTime(), tk("2026-09-27T12:41:00").getTime());
  // A slot dropped from the list (the list starts at 13:30 by now) is still
  // accepted, which is why the storefront keeps it selected.
  assert.equal(deliverySlots(HOURS, now)[0].getTime(), tk("2026-09-27T13:30:00").getTime());
  assert.equal(scheduleProblem(tk("2026-09-27T13:00:00"), HOURS, now), undefined);
  // One grid step before the boundary is refused.
  assert.match(scheduleProblem(tk("2026-09-27T12:30:00"), HOURS, now), /o‘tib ketdi/);
});

test("notification dates read naturally on the Tashkent clock", () => {
  assert.equal(formatTashkent(tk("2026-09-28T06:00:00")), "28-sentabr, 06:00");
  assert.equal(formatTashkent(new Date("2026-12-31T19:30:00Z")), "1-yanvar, 00:30");
});
