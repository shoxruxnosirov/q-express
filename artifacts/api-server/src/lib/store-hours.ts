// Opening hours and pre-order slots, on the shop's clock: Tashkent, UTC+5 with
// no daylight saving. Pure, so the rules are tested without a database.

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MINUTES = 24 * 60;

// Pre-order slots are every half hour, from half an hour ahead, for today and
// the next two days.
export const SLOT_STEP_MINUTES = 30;
export const SLOT_LEAD_MINUTES = 30;
export const SLOT_DAYS = 3;
// A slot listed when checkout opened may be a little closer by the time the
// customer presses the button; it is still honoured this close to now.
const SUBMIT_GRACE_MINUTES = 10;

export type StoreHours = { openTime: string; closeTime: string; acceptingOrders: boolean };

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string) {
  return TIME_PATTERN.test(value);
}

function minutesOf(time: string) {
  const match = TIME_PATTERN.exec(time);
  if (!match) throw new Error(`invalid time ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function tashkentMinuteOfDay(at: Date) {
  const local = new Date(at.getTime() + TASHKENT_OFFSET_MS);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

// Midnight in Tashkent on the day `at` falls in, as a real instant.
function tashkentMidnight(at: Date) {
  const local = new Date(at.getTime() + TASHKENT_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - TASHKENT_OFFSET_MS);
}

// Whether the hours cover this instant. A closing time at or before the
// opening time runs past midnight (18:00 to 02:00); equal times mean all day.
export function withinHours(at: Date, openTime: string, closeTime: string) {
  const open = minutesOf(openTime);
  const close = minutesOf(closeTime);
  if (open === close) return true;
  const minute = tashkentMinuteOfDay(at);
  return open < close ? minute >= open && minute < close : minute >= open || minute < close;
}

export function isOpenNow(hours: StoreHours, now = new Date()) {
  return hours.acceptingOrders && withinHours(now, hours.openTime, hours.closeTime);
}

// The next opening time after `now` when the shop is shut by the hours. A
// paused shop has no known reopening, so this says nothing about pauses.
export function nextOpenAt(hours: StoreHours, now = new Date()) {
  if (withinHours(now, hours.openTime, hours.closeTime)) return null;
  const today = new Date(tashkentMidnight(now).getTime() + minutesOf(hours.openTime) * MINUTE_MS);
  return today > now ? today : new Date(today.getTime() + DAY_MINUTES * MINUTE_MS);
}

// The last moment a pre-order may be for: the end of the last bookable day.
function horizonEnd(now: Date) {
  return new Date(tashkentMidnight(now).getTime() + SLOT_DAYS * DAY_MINUTES * MINUTE_MS);
}

function onGrid(at: Date) {
  return at.getTime() % MINUTE_MS === 0 && tashkentMinuteOfDay(at) % SLOT_STEP_MINUTES === 0;
}

// Every half hour inside the hours, from half an hour ahead to the end of the
// last bookable day. Empty while orders are paused.
export function deliverySlots(hours: StoreHours, now = new Date()) {
  if (!hours.acceptingOrders) return [];
  const step = SLOT_STEP_MINUTES * MINUTE_MS;
  const earliest = now.getTime() + SLOT_LEAD_MINUTES * MINUTE_MS;
  // Tashkent is a whole number of hours from UTC, so the half-hour grid is
  // the same in both and rounding up in UTC lands on it.
  let at = Math.ceil(earliest / step) * step;
  const end = horizonEnd(now).getTime();
  const slots: Date[] = [];
  for (; at < end; at += step) {
    const slot = new Date(at);
    if (withinHours(slot, hours.openTime, hours.closeTime)) slots.push(slot);
  }
  return slots;
}

// The earliest delivery time an order placed now is still accepted for. The
// storefront is told this, so a slot the customer picked a few minutes ago
// stays selected for as long as it would still be taken, instead of the
// customer's choice silently moving to a later one.
export function earliestAcceptedAt(now = new Date()) {
  return new Date(now.getTime() + SUBMIT_GRACE_MINUTES * MINUTE_MS);
}

// Why a chosen delivery time cannot be accepted, in Uzbek, or undefined when
// it can. The same rules as the slot list, so any listed slot passes.
export function scheduleProblem(when: Date, hours: StoreHours, now = new Date()) {
  if (!Number.isFinite(when.getTime())) return "Yetkazish vaqti noto‘g‘ri";
  if (!hours.acceptingOrders) return "Hozir buyurtma qabul qilinmayapti";
  if (!onGrid(when)) return "Yetkazish vaqtini ro‘yxatdan tanlang";
  if (when.getTime() < earliestAcceptedAt(now).getTime()) {
    return "Bu vaqt o‘tib ketdi, boshqa vaqtni tanlang";
  }
  if (when.getTime() >= horizonEnd(now).getTime()) return "Faqat 3 kun oldinga buyurtma berish mumkin";
  if (!withinHours(when, hours.openTime, hours.closeTime)) {
    return `Yetkazish faqat ish vaqtida: ${hours.openTime}–${hours.closeTime}`;
  }
  return undefined;
}

const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];

// "27-sentabr, 09:00" on the Tashkent clock, for people reading notifications.
export function formatTashkent(at: Date) {
  const local = new Date(at.getTime() + TASHKENT_OFFSET_MS);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  return `${local.getUTCDate()}-${MONTHS[local.getUTCMonth()]}, ${hh}:${mm}`;
}
