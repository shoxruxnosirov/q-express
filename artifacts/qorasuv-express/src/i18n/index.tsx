import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { formatMoney, inScript, isLang, langFromCode, LANGS, localeOf, translate, type Lang, type Messages, type Params } from './core';
import { telegramInitData } from '@/lib/telegram-mini-app';

export { LANGS, formatMoney, inScript, isLang, langFromCode, localeOf, translate };
export type { Lang, Messages, Params };
export { defineMessages } from './core';

// The language this device shows the shop in. The account remembers it too
// (see LanguageSync in App.tsx), so another device of the same Telegram
// account follows. A choice made here that the account has not taken yet is
// marked pending, and only a pending choice is ever sent to the account: a
// device that merely remembers an old language adopts the account's instead,
// so two devices never flip the account back and forth.
const STORAGE_KEY = 'qorasuv-lang';
const PENDING_KEY = 'qorasuv-lang-pending';

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage may be unavailable; the language still holds for this visit.
  }
}

function storedLang(): Lang | undefined {
  const value = readStorage(STORAGE_KEY);
  return isLang(value) ? value : undefined;
}

function telegramLanguageCode() {
  try {
    const user = JSON.parse(new URLSearchParams(telegramInitData()).get('user') ?? '') as { language_code?: unknown };
    return typeof user.language_code === 'string' ? user.language_code : undefined;
  } catch {
    return undefined;
  }
}

// First visit: what Telegram says the customer uses, then the browser's
// language, then Uzbek.
export function initialLang(): Lang {
  return storedLang() ?? langFromCode(telegramLanguageCode() ?? (typeof navigator === 'undefined' ? undefined : navigator.language));
}

// The admin pages stay Uzbek whatever the storefront was last shown in.
function onAdminPage() {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
}

// The language every API call announces in X-Lang, so the server's messages
// come back in it. Kept outside React because the fetch layer is.
let currentLang: Lang = typeof window === 'undefined' ? 'uz' : initialLang();
export function getCurrentLang(): Lang {
  return onAdminPage() ? 'uz' : currentLang;
}

type LanguageContext = {
  lang: Lang;
  // The customer's own choice on this device: remembered here, and pending
  // until the account has it.
  setLang: (lang: Lang) => void;
  // The account's language, taken by a device with nothing pending.
  adoptLang: (lang: Lang) => void;
  pending: boolean;
  markSaved: () => void;
};
const Context = createContext<LanguageContext>({ lang: 'uz', setLang: () => {}, adoptLang: () => {}, pending: false, markSaved: () => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(currentLang);
  const [pending, setPending] = useState(() => readStorage(PENDING_KEY) === '1');

  const show = useCallback((next: Lang) => {
    currentLang = next;
    setLangState(next);
    writeStorage(STORAGE_KEY, next);
  }, []);
  const setLang = useCallback((next: Lang) => {
    show(next);
    setPending(true);
    writeStorage(PENDING_KEY, '1');
  }, [show]);
  const adoptLang = useCallback((next: Lang) => show(next), [show]);
  const markSaved = useCallback(() => {
    setPending(false);
    writeStorage(PENDING_KEY, null);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, adoptLang, pending, markSaved }), [lang, setLang, adoptLang, pending, markSaved]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useLanguage() {
  return useContext(Context);
}

// t('key', { n: 3 }) for one namespace of messages, in the current language,
// plus money and the language itself for formatting dates. On the admin pages
// shared pieces (an error box, the leaderboard) stay Uzbek.
export function useT<K extends string>(messages: Messages<K>) {
  const { lang: chosen } = useContext(Context);
  const lang: Lang = onAdminPage() ? 'uz' : chosen;
  const t = useCallback((key: K, params?: Params) => translate(messages, lang, key, params), [messages, lang]);
  const money = useCallback((value: number) => formatMoney(value, lang), [lang]);
  const script = useCallback((text: string) => inScript(text, lang), [lang]);
  return { t, lang, money, script, locale: localeOf(lang) };
}

// Exported for screens that only need the list.
export const languages = LANGS;
