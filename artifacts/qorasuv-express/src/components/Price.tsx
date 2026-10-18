import { useT } from '@/i18n';
import { currencyLabel, formatMoney } from '@/i18n/core';
import storeMessages from '@/i18n/messages/store';

// A product's price as shoppers read it at a glance: the thousands full size,
// the last three digits smaller with their tops level with the thousands
// ("12 ⁵⁰⁰ so‘m"). Below a thousand it is written plainly. Read aloud whole.
//
// The small digits are 65% of the size; the top of a digit sits 0.145em
// (Manrope) or 0.12em (DM Sans) below the top of a line set at line-height 1,
// so they are moved down by that gap's lost 35%: about 0.07em of their own size.
export function Price({ value, strike = false }: { value: number; strike?: boolean }) {
  const { lang } = useT(storeMessages);
  // Nothing to show for a value that is not a number (the API never sends one).
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  const whole = formatMoney(rounded, lang);
  if (rounded < 1000) return <span className={strike ? 'line-through' : undefined}>{whole}</span>;
  const thousands = Math.floor(rounded / 1000).toLocaleString('ru-RU');
  const rest = String(rounded % 1000).padStart(3, '0');
  return (
    // A long price (a million and more) may put the currency on the next line
    // in a narrow card rather than spill out of it; a struck one stays on
    // one line, under its one line through.
    <span className={`relative inline-flex items-baseline leading-none ${strike ? 'whitespace-nowrap' : 'flex-wrap'}`}>
      <span className="sr-only">{whole}</span>
      <span aria-hidden className="whitespace-nowrap">{thousands}</span>
      <span aria-hidden className="ml-[.12em] mt-[.07em] self-start text-[.65em] leading-none">{rest}</span>
      <span aria-hidden className="ml-[.25em]">{currencyLabel(lang)}</span>
      {/* One line through all of it: a line-through of its own on each part
          would sit at three heights. */}
      {strike && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-[55%] h-px bg-current" />}
    </span>
  );
}
