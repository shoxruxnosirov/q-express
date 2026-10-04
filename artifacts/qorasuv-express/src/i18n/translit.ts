// Uzbek Latin to Uzbek Cyrillic. The shop writes Uzbek once, in Latin, and a
// customer who reads Cyrillic gets it transliterated, so the two never drift
// apart. The same file lives in the API (artifacts/api-server/src/lib/translit.ts); the
// tests of both hold them to the same answers.
//
// Left as they are: names of things that are not Uzbek words (Q express,
// Telegram, Mini App, the payment brands), words Uzbek Latin cannot spell
// (a c without an h, a w: Coca-Cola, Coffee, Snickers stay brands),
// {placeholders}, HTML tags and entities, links and @usernames, and every
// character that is not a Latin letter.

const KEEP = /((?<![A-Za-z])(?:Q express|Telegram|Mini App|Click|Payme|Uzcard|Humo)(?![A-Za-z])|https?:\/\/\S+|@\w+|\{[^}]*\}|<[^>]*>|&[a-z#0-9]+;)/g;

// The apostrophe forms Uzbek Latin is written with: ‘ ’ ʻ ʼ ' and `.
const APOSTROPHE = "[‘’ʻʼ'`]";
const VOWELS = "aeiouAEIOU";
const WORD = /[A-Za-z‘’ʻʼ'`]+/g;

function cased(cyrillic: string, latin: string) {
  if (latin.length === 0) return cyrillic;
  const first = latin[0];
  const upper = first === first.toUpperCase() && first !== first.toLowerCase();
  if (!upper) return cyrillic;
  // "SH" in an all-capital word stays all capital; "Sh" capitalises one.
  const allUpper = latin.length > 1 && latin === latin.toUpperCase() && latin !== latin.toLowerCase();
  return allUpper ? cyrillic.toUpperCase() : cyrillic.charAt(0).toUpperCase() + cyrillic.slice(1);
}

const SINGLE: Record<string, string> = {
  a: "а", b: "б", d: "д", f: "ф", g: "г", h: "ҳ", i: "и", j: "ж", k: "к", l: "л", m: "м", n: "н",
  o: "о", p: "п", q: "қ", r: "р", s: "с", t: "т", u: "у", v: "в", x: "х", y: "й", z: "з",
};

const RULES: Array<[RegExp, (match: string, at: number, whole: string) => string]> = [
  [new RegExp(`[oO]${APOSTROPHE}`, "y"), (m) => cased("ў", m)],
  [new RegExp(`[gG]${APOSTROPHE}`, "y"), (m) => cased("ғ", m)],
  [/[sS][hH]/y, (m) => cased("ш", m)],
  [/[cC][hH]/y, (m) => cased("ч", m)],
  [/[yY][oO](?![‘’ʻʼ'`])/y, (m) => cased("ё", m)],
  [/[yY][uU]/y, (m) => cased("ю", m)],
  [/[yY][aA]/y, (m) => cased("я", m)],
  [/[yY][eE]/y, (m) => cased("е", m)],
  // e is э at the start of a word or after a vowel, е elsewhere.
  [/[eE]/y, (m, at, whole) => {
    const before = at > 0 ? whole[at - 1] : "";
    const wordStart = before === "" || !/[A-Za-z‘’ʻʼ'`]/.test(before);
    return cased(wordStart || VOWELS.includes(before) ? "э" : "е", m);
  }],
  // A lone apostrophe between letters is the hard sign (tutuq belgisi).
  [new RegExp(`${APOSTROPHE}(?=[A-Za-z])`, "y"), (_m, at, whole) => (at > 0 && /[A-Za-z]/.test(whole[at - 1]) ? "ъ" : whole[at])],
];

// Borrowed words whose Cyrillic keeps a soft or hard sign, or a ц, that the
// letter rules cannot guess. Matched at the start of a word, so endings follow
// (kuryerga, sentabrda).
const WORD_STARTS: Array<[string, string]> = [
  ["kuryer", "курьер"],
  ["obyekt", "объект"],
  ["aksiya", "акция"],
  ["yanvar", "январь"],
  ["fevral", "февраль"],
  ["aprel", "апрель"],
  ["iyun", "июнь"],
  ["iyul", "июль"],
  ["sentabr", "сентябрь"],
  ["oktabr", "октябрь"],
  ["noyabr", "ноябрь"],
  ["dekabr", "декабрь"],
  ["profil", "профиль"],
  ["filtr", "фильтр"],
];

// A word Uzbek Latin cannot spell is a foreign name (a brand), kept as written.
function isForeign(word: string) {
  return /c(?!h)|w/i.test(word);
}

function transliterateWord(text: string) {
  let out = "";
  let at = 0;
  outer: while (at < text.length) {
    if (at === 0) {
      const rest = text.toLowerCase();
      for (const [latin, cyrillic] of WORD_STARTS) {
        if (rest.startsWith(latin)) {
          out += cased(cyrillic, text.slice(0, latin.length));
          at = latin.length;
          continue outer;
        }
      }
    }
    for (const [pattern, replace] of RULES) {
      pattern.lastIndex = at;
      const match = pattern.exec(text);
      if (match) {
        out += replace(match[0], at, text);
        at += match[0].length;
        continue outer;
      }
    }
    const char = text[at];
    const single = SINGLE[char.toLowerCase()];
    out += single ? cased(single, char) : char;
    at += 1;
  }
  return out;
}

function transliterateWords(text: string) {
  return text.replace(WORD, (word) => (isForeign(word) ? word : transliterateWord(word)));
}

export function toCyrillic(text: string) {
  let out = "";
  let last = 0;
  for (const keep of text.matchAll(KEEP)) {
    out += transliterateWords(text.slice(last, keep.index)) + keep[0];
    last = (keep.index ?? 0) + keep[0].length;
  }
  return out + transliterateWords(text.slice(last));
}

// Uzbek Cyrillic (or Russian letters) back to Uzbek Latin, roughly: enough for
// a customer reading the shop in Cyrillic to search names the shop wrote in
// Latin ("олма" finds "olma").
const TO_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh",
  щ: "sh", ъ: "’", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o‘", қ: "q", ғ: "g‘", ҳ: "h",
};

export function toLatin(text: string) {
  return [...text].map((char) => {
    const lower = char.toLowerCase();
    const latin = TO_LATIN[lower];
    if (latin === undefined) return char;
    return char !== lower && latin ? latin.charAt(0).toUpperCase() + latin.slice(1) : latin;
  }).join("");
}
