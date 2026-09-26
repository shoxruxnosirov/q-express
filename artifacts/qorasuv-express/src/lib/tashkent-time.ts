// The shop runs on Tashkent time (UTC+5, no daylight saving) whatever the
// customer's phone is set to, so delivery times are shown on that clock.

const OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

const local = (at: Date) => new Date(at.getTime() + OFFSET_MS);
const dayNumber = (at: Date) => Math.floor(local(at).getTime() / DAY_MS);

export function clockTime(at: Date) {
  const l = local(at);
  return `${String(l.getUTCHours()).padStart(2, '0')}:${String(l.getUTCMinutes()).padStart(2, '0')}`;
}

// "Bugun", "Ertaga", "Indinga", or "30-sentabr" further out.
export function dayLabel(at: Date, now = new Date()) {
  const diff = dayNumber(at) - dayNumber(now);
  if (diff === 0) return 'Bugun';
  if (diff === 1) return 'Ertaga';
  if (diff === 2) return 'Indinga';
  const l = local(at);
  return `${l.getUTCDate()}-${MONTHS[l.getUTCMonth()]}`;
}

// "Ertaga, 06:00"
export function deliveryLabel(at: Date, now = new Date()) {
  return `${dayLabel(at, now)}, ${clockTime(at)}`;
}

export type SlotDay = { key: number; label: string; slots: string[] };

// Slots arrive as one list; the picker shows a day, then that day's times.
export function groupSlotsByDay(slots: readonly string[], now = new Date()): SlotDay[] {
  const days: SlotDay[] = [];
  for (const slot of slots) {
    const at = new Date(slot);
    const key = dayNumber(at);
    let day = days.find(d => d.key === key);
    if (!day) {
      day = { key, label: dayLabel(at, now), slots: [] };
      days.push(day);
    }
    day.slots.push(slot);
  }
  return days;
}
