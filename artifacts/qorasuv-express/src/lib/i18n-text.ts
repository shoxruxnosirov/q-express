import type { Lang, Messages, Params } from '../i18n/core.ts';
import { toCyrillic } from '../i18n/translit.ts';

// The same translation as @/i18n/core, for the plain helpers in src/lib that
// node --test loads directly. Node resolves imports only with their file
// extension, and core.ts imports './translit' without one, so these helpers
// (and the message files they use) come here instead. The rules are the same:
// Uzbek Latin is the source, Uzbek Cyrillic is it transliterated before the
// values go in, Russian and English are written by hand.

export type { Lang };

export function defineText<K extends string>(messages: Messages<K>): Messages<K> {
  return messages;
}

export function translateText<K extends string>(messages: Messages<K>, lang: Lang, key: K, params?: Params): string {
  const source = lang === 'ru' ? messages.ru : lang === 'en' ? messages.en : messages.uz;
  let text = source[key] ?? messages.uz[key] ?? key;
  if (lang === 'uz-Cyrl') text = toCyrillic(text);
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
  }
  return text;
}

// Shop-written Uzbek (a unit the shop typed, say) in the reader's script.
export function scriptText(text: string, lang: Lang) {
  return lang === 'uz-Cyrl' ? toCyrillic(text) : text;
}
