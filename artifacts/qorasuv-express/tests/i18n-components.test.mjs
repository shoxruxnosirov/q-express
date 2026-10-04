import assert from "node:assert/strict";
import { test } from "node:test";
import { lineProblemText } from "../src/lib/stock-rules.ts";
import { dayLabel, deliveryLabel, groupSlotsByDay } from "../src/lib/tashkent-time.ts";
import { profileFieldError } from "../src/lib/profile.ts";
import { unitLabel } from "../src/i18n/messages/units.ts";

const tk = (local) => new Date(`${local}+05:00`);
const CYRILLIC = /[а-яёўқғҳ]/i;
const LATIN_WORD = /[a-z]{3,}/i;

// ru and en read differently from uz; uz-Cyrl is uz in Cyrillic letters.
function checkLanguages(make) {
  const uz = make("uz");
  const ru = make("ru");
  const en = make("en");
  const cyrl = make("uz-Cyrl");
  assert.notEqual(ru, uz);
  assert.notEqual(en, uz);
  assert.notEqual(ru, en);
  assert.match(cyrl, CYRILLIC);
  assert.doesNotMatch(cyrl, LATIN_WORD, `uz-Cyrl still has Latin words: ${cyrl}`);
  assert.match(ru, CYRILLIC);
  assert.doesNotMatch(en, CYRILLIC);
}

test("stock problems are told in every language, Uzbek by default", () => {
  for (const problem of [{ kind: "gone" }, { kind: "sold-out" }, { kind: "short", available: 2 }]) {
    checkLanguages(lang => lineProblemText(problem, "dona", lang));
    assert.equal(lineProblemText(problem, "dona"), lineProblemText(problem, "dona", "uz"));
  }
  assert.equal(lineProblemText({ kind: "short", available: 2 }, "dona", "ru"), "В наличии осталось только 2 шт. Измените количество.");
  assert.equal(lineProblemText({ kind: "short", available: 1.5 }, "kg", "en"), "Only 1.5 kg left in stock. Please change the quantity.");
});

test("day and delivery labels follow the language", () => {
  const now = tk("2026-09-27T23:40:00");
  for (const at of [tk("2026-09-27T23:50:00"), tk("2026-09-28T06:00:00"), tk("2026-09-29T09:00:00"), tk("2026-09-30T09:00:00")]) {
    checkLanguages(lang => dayLabel(at, now, lang));
  }
  assert.equal(dayLabel(tk("2026-09-28T06:00:00"), now), "Ertaga");
  assert.equal(deliveryLabel(tk("2026-09-28T06:00:00"), now, "ru"), "Завтра, 06:00");
  assert.equal(deliveryLabel(tk("2026-09-28T06:00:00"), now, "en"), "Tomorrow, 06:00");
  assert.equal(dayLabel(tk("2026-09-30T09:00:00"), now, "ru"), "30 сентября");
  assert.equal(dayLabel(tk("2026-09-30T09:00:00"), now, "en"), "30 September");
  assert.equal(dayLabel(tk("2026-09-30T09:00:00"), now), "30-sentabr");
  const [day] = groupSlotsByDay([tk("2026-09-28T06:00:00").toISOString()], now, "en");
  assert.equal(day.label, "Tomorrow");
});

test("profile errors and units follow the language", () => {
  checkLanguages(lang => profileFieldError({ name: "A", phone: "" }, lang));
  checkLanguages(lang => profileFieldError({ name: "", phone: "123" }, lang));
  assert.equal(profileFieldError({ name: "Ali", phone: "+998901234567" }, "ru"), "");
  assert.equal(unitLabel("dona", "ru"), "шт");
  assert.equal(unitLabel("qadoq", "en"), "pack");
  assert.equal(unitLabel("kg", "uz-Cyrl"), "кг");
  assert.equal(unitLabel("dona", "uz"), "dona");
  assert.equal(unitLabel("quti", "ru"), "quti");
});
