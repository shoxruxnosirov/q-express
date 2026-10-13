// The shop runs on Tashkent time (UTC+5, no daylight saving) whatever the
// customer's phone is set to, so delivery times are shown on that clock.

import { translateText, type Lang } from './i18n-text.ts';
import messages from '../i18n/messages/tashkentTime.ts';

const OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12'] as const;

const local = (at: Date) => new Date(at.getTime() + OFFSET_MS);
const dayNumber = (at: Date) => Math.floor(local(at).getTime() / DAY_MS);

export function clockTime(at: Date) {
  const l = local(at);
  return `${String(l.getUTCHours()).padStart(2, '0')}:${String(l.getUTCMinutes()).padStart(2, '0')}`;
}

// "Bugun", "Ertaga", "Indinga", or "30-sentabr" further out (in the given
// language).
export function dayLabel(at: Date, now = new Date(), lang: Lang = 'uz') {
  const diff = dayNumber(at) - dayNumber(now);
  if (diff === 0) return translateText(messages, lang, 'today');
  if (diff === 1) return translateText(messages, lang, 'tomorrow');
  if (diff === 2) return translateText(messages, lang, 'dayAfterTomorrow');
  const l = local(at);
  return translateText(messages, lang, 'date', { day: l.getUTCDate(), month: translateText(messages, lang, MONTHS[l.getUTCMonth()]) });
}

// "13-oktabr", with the year once it is not this year's: "13-oktabr 2025".
// Written out here rather than by Intl, whose Uzbek month names Chrome lacks
// (it printed "M10 13").
export function dateLabel(at: Date, now = new Date(), lang: Lang = 'uz') {
  const l = local(at);
  const label = translateText(messages, lang, 'date', { day: l.getUTCDate(), month: translateText(messages, lang, MONTHS[l.getUTCMonth()]) });
  return l.getUTCFullYear() === local(now).getUTCFullYear() ? label : `${label} ${l.getUTCFullYear()}`;
}

// When something happened: "13-oktabr, 19:32".
export function dateTimeLabel(at: Date, now = new Date(), lang: Lang = 'uz') {
  return `${dateLabel(at, now, lang)}, ${clockTime(at)}`;
}

// "Ertaga, 06:00"
export function deliveryLabel(at: Date, now = new Date(), lang: Lang = 'uz') {
  return `${dayLabel(at, now, lang)}, ${clockTime(at)}`;
}

export type SlotDay = { key: number; label: string; slots: string[] };

// Slots arrive as one list; the picker shows a day, then that day's times.
export function groupSlotsByDay(slots: readonly string[], now = new Date(), lang: Lang = 'uz'): SlotDay[] {
  const days: SlotDay[] = [];
  for (const slot of slots) {
    const at = new Date(slot);
    const key = dayNumber(at);
    let day = days.find(d => d.key === key);
    if (!day) {
      day = { key, label: dayLabel(at, now, lang), slots: [] };
      days.push(day);
    }
    day.slots.push(slot);
  }
  return days;
}
