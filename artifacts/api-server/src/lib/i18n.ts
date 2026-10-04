import { toCyrillic } from "./translit.ts";

// The four languages the storefront speaks, the same as the web app's
// src/i18n/core.ts. Uzbek is written once, in Latin; Uzbek Cyrillic is made
// from it by transliteration, so the two never drift apart. Russian and
// English are written by hand. What the admins read stays Uzbek.
export type Lang = "uz" | "uz-Cyrl" | "ru" | "en";

export const LANGS: readonly Lang[] = ["uz", "uz-Cyrl", "ru", "en"];

export function isLang(value: unknown): value is Lang {
  return value === "uz" || value === "uz-Cyrl" || value === "ru" || value === "en";
}

// The language a Telegram or browser language code suggests: Russian for
// those who use Russian (or a neighbouring language) on their phone, English
// for English, Uzbek for everyone else.
export function langFromCode(code: string | null | undefined): Lang {
  const base = (code ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (base === "ru" || base === "uk" || base === "be" || base === "kk" || base === "ky" || base === "tg") return "ru";
  if (base === "en") return "en";
  return "uz";
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
  const source = lang === "ru" ? messages.ru : lang === "en" ? messages.en : messages.uz;
  let text = source[key] ?? messages.uz[key] ?? key;
  if (lang === "uz-Cyrl") text = toCyrillic(text);
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
  }
  return text;
}

// What the shop itself wrote in Uzbek Latin (a product name), in the reader's
// script: transliterated for Uzbek Cyrillic, untouched otherwise.
export function inScript(text: string, lang: Lang) {
  return lang === "uz-Cyrl" ? toCyrillic(text) : text;
}

// Anything with request headers: an Express request, or a stand-in in tests.
export type HeaderSource = { get(name: string): string | undefined };

// The language to answer a request in: the one the web app says it shows
// (X-Lang), else the one saved on the customer's account, else the browser's
// first Accept-Language, else Uzbek.
export function requestLang(req: HeaderSource, user?: { language?: string | null } | null): Lang {
  const header = req.get("x-lang")?.trim();
  if (isLang(header)) return header;
  if (user && isLang(user.language)) return user.language;
  const accept = req.get("accept-language");
  if (accept) {
    const first = accept.split(",")[0]?.split(";")[0]?.trim();
    if (first) return langFromCode(first);
  }
  return "uz";
}

// The language saved on an account, or the one its Telegram language code
// suggests when nothing is saved.
export function accountLang(user: { language?: string | null } | null | undefined, languageCode?: string | null): Lang {
  return user && isLang(user.language) ? user.language : langFromCode(languageCode);
}
