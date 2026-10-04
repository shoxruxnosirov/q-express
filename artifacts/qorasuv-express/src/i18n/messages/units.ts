import { defineText, scriptText, translateText, type Lang } from '../../lib/i18n-text.ts';

// The units products are sold in (product.unit). Node-safe, so the stock
// rules can use it under node --test.
const units = defineText({
  uz: { dona: 'dona', qadoq: 'qadoq', kg: 'kg', litr: 'litr' },
  ru: { dona: 'шт', qadoq: 'уп.', kg: 'кг', litr: 'л' },
  en: { dona: 'pcs', qadoq: 'pack', kg: 'kg', litr: 'l' },
});

export default units;

type UnitKey = keyof typeof units.uz;
const isUnitKey = (unit: string): unit is UnitKey => Object.prototype.hasOwnProperty.call(units.uz, unit);

// "dona" -> "шт" / "pcs"; a unit the list does not know is shown as the shop
// wrote it (transliterated for Uzbek Cyrillic).
export function unitLabel(unit: string, lang: Lang) {
  return isUnitKey(unit) ? translateText(units, lang, unit) : scriptText(unit, lang);
}
