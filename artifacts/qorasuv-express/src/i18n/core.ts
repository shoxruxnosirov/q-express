import { toCyrillic } from './translit';

// The four languages the storefront speaks. Uzbek is written once, in Latin;
// Uzbek Cyrillic is made from it by transliteration, so the two never drift
// apart. Russian and English are written by hand. The admin pages stay Uzbek.
export type Lang = 'uz' | 'uz-Cyrl' | 'ru' | 'en';

export const LANGS: readonly { code: Lang; label: string; short: string }[] = [
  { code: 'uz', label: 'O‘zbekcha', short: 'UZ' },
  { code: 'uz-Cyrl', label: 'Ўзбекча', short: 'ЎЗ' },
  { code: 'ru', label: 'Русский', short: 'RU' },
  { code: 'en', label: 'English', short: 'EN' },
];

export function isLang(value: unknown): value is Lang {
  return value === 'uz' || value === 'uz-Cyrl' || value === 'ru' || value === 'en';
}

// The language a Telegram or browser language code suggests: Russian for
// those who use Russian (or a neighbouring language) on their phone, English
// for English, Uzbek for everyone else.
export function langFromCode(code: string | null | undefined): Lang {
  const base = (code ?? '').toLowerCase().split(/[-_]/)[0];
  if (base === 'ru' || base === 'uk' || base === 'be' || base === 'kk' || base === 'ky' || base === 'tg') return 'ru';
  if (base === 'en') return 'en';
  return 'uz';
}

// A namespace of messages: Uzbek (Latin) is the source, and Russian and
// English must have every key it has. Placeholders are written {name}.
export type Messages<K extends string> = { uz: Record<K, string>; ru: Record<K, string>; en: Record<K, string> };

export function defineMessages<K extends string>(messages: Messages<K>): Messages<K> {
  return messages;
}

export type Params = Record<string, string | number>;

// One message in one language, placeholders filled in. Uzbek Cyrillic is the
// Latin text transliterated before the values go in, so a customer's name or
// a number is never transliterated.
export function translate<K extends string>(messages: Messages<K>, lang: Lang, key: K, params?: Params): string {
  const source = lang === 'ru' ? messages.ru : lang === 'en' ? messages.en : messages.uz;
  let text = source[key] ?? messages.uz[key] ?? key;
  if (lang === 'uz-Cyrl') text = toCyrillic(text);
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
  }
  return text;
}

// What the shop itself wrote in Uzbek Latin (a product or category name), in
// the reader's script: transliterated for Uzbek Cyrillic, untouched otherwise.
export function inScript(text: string, lang: Lang) {
  return lang === 'uz-Cyrl' ? toCyrillic(text) : text;
}

// The locale Intl formats dates and numbers with.
export function localeOf(lang: Lang) {
  return lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : lang === 'uz-Cyrl' ? 'uz-Cyrl-UZ' : 'uz-Latn-UZ';
}

const CURRENCY: Record<Lang, string> = { uz: 'so‘m', 'uz-Cyrl': 'сўм', ru: 'сум', en: 'UZS' };

// "12 000 so‘m" / "12 000 сум" / "12 000 UZS": the grouping stays the same
// in every language, so prices line up the way customers are used to.
export function formatMoney(value: number, lang: Lang) {
  return `${Math.round(value).toLocaleString('ru-RU')} ${CURRENCY[lang]}`;
}
