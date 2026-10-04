import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountLang,
  defineMessages,
  isLang,
  langFromCode,
  LANGS,
  requestLang,
  translate,
} from "../src/lib/i18n.ts";
import {
  accountMessages,
  botMessages,
  chatMessages,
  commonMessages,
  orderMessages,
  orderProblems,
  scheduleMessages,
  valueLabels,
} from "../src/lib/messages.ts";
import { customerEchoText, customerNoticeText, customerReplyText, welcomeMessage } from "../src/lib/telegram.ts";
import { scheduleProblem } from "../src/lib/store-hours.ts";

// Both copies of the transliteration, loaded by file URL: the server's and
// the web app's must give the same answers, or a customer would read one
// spelling in the shop and another in the bot.
const serverTranslit = await import(new URL("../src/lib/translit.ts", import.meta.url).href);
const webTranslit = await import(new URL("../../qorasuv-express/src/i18n/translit.ts", import.meta.url).href);

const sample = defineMessages({
  uz: { hello: "Salom, {name}! Sizda {count} ta buyurtma bor.", only: "Faqat o‘zbekcha" },
  ru: { hello: "Здравствуйте, {name}! Заказов: {count}.", only: "Только по-русски" },
  en: { hello: "Hello, {name}! Orders: {count}.", only: "English only" },
});

// A request with these headers, as Express's req.get reads them.
function req(headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => lower[name.toLowerCase()] };
}

test("translate fills placeholders in every language", () => {
  assert.equal(translate(sample, "uz", "hello", { name: "Aziz", count: 2 }), "Salom, Aziz! Sizda 2 ta buyurtma bor.");
  assert.equal(translate(sample, "ru", "hello", { name: "Aziz", count: 2 }), "Здравствуйте, Aziz! Заказов: 2.");
  assert.equal(translate(sample, "en", "hello", { name: "Aziz", count: 2 }), "Hello, Aziz! Orders: 2.");
  assert.equal(translate(sample, "en", "hello", { name: "Aziz" }), "Hello, Aziz! Orders: {count}.", "a missing value leaves the placeholder");
  assert.equal(translate(sample, "uz", "only"), "Faqat o‘zbekcha");
});

test("Uzbek Cyrillic is the Latin text transliterated before the values go in", () => {
  // "Shoxrux" must stay as the customer wrote it, not become "Шохрух".
  assert.equal(translate(sample, "uz-Cyrl", "hello", { name: "Shoxrux", count: 3 }), "Салом, Shoxrux! Сизда 3 та буюртма бор.");
  assert.equal(translate(sample, "uz-Cyrl", "only"), "Фақат ўзбекча");
  assert.equal(
    translate(scheduleMessages, "uz-Cyrl", "outsideHours", { open: "06:00", close: "23:00" }),
    "Етказиш фақат иш вақтида: 06:00–23:00",
  );
});

test("the server's messages keep the exact Uzbek they had, and have every key in every language", () => {
  assert.equal(translate(accountMessages, "uz", "blocked"), "Hisobingiz do‘kon tomonidan bloklangan. Buyurtma berish va yozish imkoni yo‘q.");
  assert.equal(translate(commonMessages, "uz", "invalidInput"), "Kiritilgan ma'lumotlar noto‘g‘ri");
  assert.equal(translate(chatMessages, "uz", "closed"), "Chat do‘konning Telegram botida ishlaydi. Do‘konni Telegram orqali oching.");
  assert.equal(
    translate(orderMessages, "uz", "closedNow", { open: "06:00", close: "23:00" }),
    "Do‘kon hozir yopiq. Ish vaqti 06:00–23:00. Yetkazish vaqtini tanlab, oldindan buyurtma bering.",
  );
  assert.equal(translate(orderProblems, "uz", "valueOutOfRange", { label: translate(valueLabels, "uz", "quantity") }), "Miqdor chegaradan tashqari");
  for (const messages of [commonMessages, accountMessages, orderMessages, orderProblems, valueLabels, scheduleMessages, chatMessages, botMessages]) {
    const keys = Object.keys(messages.uz).sort();
    assert.deepEqual(Object.keys(messages.ru).sort(), keys);
    assert.deepEqual(Object.keys(messages.en).sort(), keys);
    for (const key of keys) {
      // The same placeholders in every language.
      const holes = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join();
      assert.equal(holes(messages.ru[key]), holes(messages.uz[key]), `ru ${key}`);
      assert.equal(holes(messages.en[key]), holes(messages.uz[key]), `en ${key}`);
    }
  }
});

test("a delivery time is refused in the customer's language, Uzbek by default", () => {
  const hours = { openTime: "06:00", closeTime: "23:00", acceptingOrders: false };
  const now = new Date("2026-09-27T07:00:00Z");
  const when = new Date("2026-09-27T09:00:00Z");
  assert.equal(scheduleProblem(when, hours, now), "Hozir buyurtma qabul qilinmayapti");
  assert.equal(scheduleProblem(when, hours, now, "ru"), "Сейчас заказы не принимаются");
  assert.equal(scheduleProblem(when, hours, now, "en"), "We are not taking orders right now");
  assert.equal(scheduleProblem(when, hours, now, "uz-Cyrl"), "Ҳозир буюртма қабул қилинмаяпти");
});

test("langFromCode: Russian and its neighbours, English, Uzbek for the rest", () => {
  for (const code of ["ru", "ru-RU", "uk", "be", "kk", "ky", "tg", "RU", "kk_KZ"]) assert.equal(langFromCode(code), "ru", code);
  for (const code of ["en", "en-US", "en-GB", "EN"]) assert.equal(langFromCode(code), "en", code);
  for (const code of ["uz", "uz-Latn", "tr", "de", "*", "", null, undefined]) assert.equal(langFromCode(code), "uz", String(code));
});

test("isLang accepts exactly the four languages", () => {
  assert.deepEqual(LANGS, ["uz", "uz-Cyrl", "ru", "en"]);
  for (const lang of LANGS) assert.equal(isLang(lang), true);
  for (const value of ["uz-cyrl", "UZ", "kk", "", null, undefined, 1]) assert.equal(isLang(value), false, String(value));
});

test("requestLang: X-Lang, then the account, then Accept-Language, then Uzbek", () => {
  const russianUser = { language: "ru" };
  assert.equal(requestLang(req({ "X-Lang": "uz-Cyrl", "Accept-Language": "en-US" }), russianUser), "uz-Cyrl", "the header wins");
  assert.equal(requestLang(req({ "X-Lang": "de", "Accept-Language": "en-US" }), russianUser), "ru", "an invalid header is ignored");
  assert.equal(requestLang(req({ "Accept-Language": "en-US,en;q=0.9" }), russianUser), "ru", "the account before the browser");
  assert.equal(requestLang(req({ "Accept-Language": "en-US,en;q=0.9" }), { language: null }), "en");
  assert.equal(requestLang(req({ "Accept-Language": "ru;q=0.8, en" })), "ru", "the first tag counts");
  assert.equal(requestLang(req({ "Accept-Language": "*" })), "uz", "what Node's fetch sends");
  assert.equal(requestLang(req({}), { language: "nonsense" }), "uz");
  assert.equal(requestLang(req()), "uz");
});

test("accountLang: the saved language, else the Telegram one", () => {
  assert.equal(accountLang({ language: "en" }, "ru"), "en");
  assert.equal(accountLang({ language: null }, "ru"), "ru");
  assert.equal(accountLang(undefined, "en-GB"), "en");
  assert.equal(accountLang(undefined), "uz");
});

test("the welcome caption stays under Telegram's 1024 characters in every language", () => {
  // Three discounted products with absurd names: the longest the caption gets.
  const offers = [1, 2, 3].map((i) => ({ name: `<${"Juda uzun mahsulot nomi ".repeat(12)}${i}>`, price: 1_000_000, oldPrice: 2_000_000 }));
  for (const lang of LANGS) {
    const message = welcomeMessage("https://x", offers, { openTime: "06:00", closeTime: "23:00" }, lang);
    const visible = message.caption.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "&");
    assert.ok([...visible].length < 1024, `${lang}: ${[...visible].length}`);
    assert.ok(!/<Juda|<Жуда/.test(message.caption), `${lang}: names stay escaped`);
    assert.ok(message.caption.includes("06:00–23:00"), lang);
    assert.equal(message.reply_markup.inline_keyboard.flat().length, 3, lang);
  }
});

test("the welcome, replies, notices and echoes speak the customer's language", () => {
  const offers = [{ name: "Mol go‘shti", price: 98000, oldPrice: 110000 }];
  const ru = welcomeMessage("https://x", offers, undefined, "ru");
  assert.ok(ru.caption.startsWith("🛒 <b>Добро пожаловать в Q express!</b>"));
  assert.ok(ru.caption.replace(/[\u00a0\u202f]/g, " ").includes("Mol go‘shti: <b>98 000 сум</b>"), "names as the shop wrote them");
  assert.deepEqual(ru.reply_markup.inline_keyboard.flat().map((button) => button.text), ["🛒 Открыть магазин", "🔥 Скидки", "📦 Мои заказы"]);
  const cyrl = welcomeMessage("https://x", offers, undefined, "uz-Cyrl");
  assert.ok(cyrl.caption.startsWith("🛒 <b>Q express'га хуш келибсиз!</b>"), cyrl.caption.split("\n")[0]);
  assert.ok(cyrl.caption.replace(/[\u00a0\u202f]/g, " ").includes("Мол гўшти: <b>98 000 сўм</b>"), "names in the reader's script");
  assert.ok(welcomeMessage("https://x", offers, undefined, "en").caption.includes("UZS"));
  assert.equal(welcomeMessage("https://x", offers).caption, welcomeMessage("https://x", offers, undefined, "uz").caption, "Uzbek by default");

  assert.match(customerReplyText("<b>10</b>", "en"), /Reply from Q express/);
  assert.ok(customerReplyText("<b>10</b>", "ru").includes("<blockquote>&lt;b&gt;10&lt;/b&gt;</blockquote>"), "still escaped");
  assert.match(customerEchoText("x", "ru"), /Вы написали/);
  assert.match(customerEchoText("x", "uz-Cyrl"), /Сиз ёздингиз/);
  assert.equal(customerNoticeText("unsupported", "en"), "ℹ️ Only text messages are accepted (up to 1000 characters).");
  assert.equal(customerNoticeText("unsupported", "uz-Cyrl"), "ℹ️ Фақат матнли хабар қабул қилинади (1000 белгигача).");
  assert.equal(customerNoticeText("blocked"), "⛔️ Hisobingiz do‘kon tomonidan bloklangan. Buyurtma berish va yozish imkoni yo‘q.");
});

test("the server's and the web app's transliteration give the same answers", () => {
  const phrases = [
    "Salom",
    "Do‘konni ochish",
    "O‘zbekiston",
    "G‘isht va go‘sht",
    "Shirinliklar va choy",
    "Yetkazib berish bepul",
    "Yangi yil aksiyasi",
    "Kuryerga qo‘ng‘iroq qiling",
    "Ma’lumotlar noto‘g‘ri",
    "Bu vaqt o‘tib ketdi, boshqa vaqtni tanlang",
    "Q express'ga xush kelibsiz!",
    "Telegram orqali yozing: @Q_express_bot",
    "Ish vaqti: {open}–{close}",
    "<b>15–19 daqiqada</b> yetkazamiz",
    "Naqd, Click, Payme, Uzcard yoki Humo",
    "Elektron hamyon va energiya",
    "ShAHAR MARKAZI",
    "Yo‘l, yoz, yulduz, yaxshi",
    "Mehmon &amp; mezbon",
    "https://q-express.onrender.com/catalog sahifasi",
    "Sa'n'at va obyekt",
  ];
  for (const phrase of phrases) {
    assert.equal(serverTranslit.toCyrillic(phrase), webTranslit.toCyrillic(phrase), phrase);
  }
  assert.equal(serverTranslit.toCyrillic("Do‘konni ochish"), "Дўконни очиш");
});

test("transliteration keeps brands, keeps the soft sign of loanwords, and reads back for search", async () => {
  const { toCyrillic, toLatin } = await import("../src/lib/translit.ts");
  assert.equal(toCyrillic("Coca-Cola 1L"), "Coca-Cola 1Л", "a word Uzbek Latin cannot spell is a brand");
  assert.equal(toCyrillic("Coffee Jacobs"), "Coffee Jacobs");
  assert.equal(toCyrillic("Humoyun"), "Ҳумоюн", "only the whole word Humo is the payment brand");
  assert.equal(toCyrillic("Humo yoki Click"), "Humo ёки Click");
  assert.equal(toCyrillic("5-oktabr, sentabrda"), "5-октябрь, сентябрьда");
  assert.equal(toCyrillic("Profil, Filtrlar"), "Профиль, Фильтрлар");
  assert.equal(toCyrillic("Kuryer yo‘lda"), "Курьер йўлда");
  assert.equal(toLatin("Қизил олма"), "Qizil olma");
  assert.equal(toLatin("ўрик, ғишт, нон"), "o‘rik, g‘isht, non");
});
