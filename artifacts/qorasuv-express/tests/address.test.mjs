import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DOM_OPTIONS,
  XONADON_OPTIONS,
  emptyAddress,
  formatAddress,
  isCompleteAddress,
  matchOptions,
  normalizeAddress,
  parseAddress,
} from "../src/lib/address.ts";

test("both option lists are non-empty and hold plain numbers", () => {
  assert.ok(DOM_OPTIONS.length > 0);
  assert.ok(XONADON_OPTIONS.length > 0);
  for (const option of [...DOM_OPTIONS, ...XONADON_OPTIONS]) {
    assert.match(option, /^\d+[A-Za-z]?$/);
  }
  assert.equal(new Set(DOM_OPTIONS).size, DOM_OPTIONS.length, "duplicates would render twice");
  assert.equal(new Set(XONADON_OPTIONS).size, XONADON_OPTIONS.length);
});

test("an address is only complete once both parts are picked", () => {
  assert.equal(isCompleteAddress(emptyAddress), false);
  assert.equal(isCompleteAddress({ dom: "12", xonadon: "" }), false);
  assert.equal(isCompleteAddress({ dom: "", xonadon: "7" }), false);
  assert.equal(isCompleteAddress({ dom: "12", xonadon: "7" }), true);
});

test("formatting produces the single line the order carries", () => {
  assert.equal(formatAddress({ dom: "12", xonadon: "7" }), "12-dom, 7-xonadon");
  // An incomplete address must never reach the order as a half-written line.
  assert.equal(formatAddress({ dom: "12", xonadon: "" }), "");
  assert.equal(formatAddress(emptyAddress), "");
});

test("what formatting writes, parsing reads back", () => {
  for (const parts of [
    { dom: "1", xonadon: "1" },
    { dom: DOM_OPTIONS[DOM_OPTIONS.length - 1], xonadon: XONADON_OPTIONS[XONADON_OPTIONS.length - 1] },
  ]) {
    assert.deepEqual(parseAddress(formatAddress(parts)), parts);
  }
});

test("parsing tolerates the spacing a person or an older build might have written", () => {
  assert.deepEqual(parseAddress("12-dom, 7-xonadon"), { dom: "12", xonadon: "7" });
  assert.deepEqual(parseAddress("12 dom 7 xonadon"), { dom: "12", xonadon: "7" });
  assert.deepEqual(parseAddress("  12-DOM,7-XONADON  "), { dom: "12", xonadon: "7" });
});

test("anything that is not a dom and xonadon yields empty selects", () => {
  for (const input of ["", "Navoiy ko‘chasi 15", "12-dom", "7-xonadon", "dom, xonadon", "12-uy, 7-xonadon"]) {
    assert.deepEqual(parseAddress(input), emptyAddress, `unexpectedly parsed: ${input}`);
  }
});

test("a value the shop no longer offers is cleared rather than kept", () => {
  assert.deepEqual(normalizeAddress({ dom: "9999", xonadon: "7" }), { dom: "", xonadon: "7" });
  assert.deepEqual(normalizeAddress({ dom: "12", xonadon: "9999" }), { dom: "12", xonadon: "" });
  assert.deepEqual(normalizeAddress({ dom: "  12  ", xonadon: "7" }), { dom: "", xonadon: "7" });
  assert.deepEqual(parseAddress("9999-dom, 7-xonadon"), { dom: "", xonadon: "7" });
});

test("the address search puts numbers starting with what was typed first", () => {
  assert.deepEqual(matchOptions(["1", "2", "10", "12", "21", "31"], "1"), ["1", "10", "12", "21", "31"]);
  assert.deepEqual(matchOptions(DOM_OPTIONS, " 57 "), ["57", "157"]);
  assert.deepEqual(matchOptions(XONADON_OPTIONS, ""), XONADON_OPTIONS);
  assert.deepEqual(matchOptions(XONADON_OPTIONS, "999"), []);
  assert.deepEqual(matchOptions(["12A", "12B", "3"], "12a"), ["12A"]);
});
