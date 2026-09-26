import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  MAX_SAVED_ADDRESSES,
  cleanAddresses,
  clearProfile,
  emptyProfile,
  forgetAddress,
  profileFieldError,
  readProfile,
  rememberAddress,
  writeProfile,
} from "../src/lib/profile.ts";

const PROFILE_KEY = "qorasuv-customer-profile";
const LEGACY_KEY = "qorasuv-customer-name";

// A stand-in for the browser's localStorage, including the ability to throw the
// way a private window or blocked site data does.
function installStorage({ failing = false, seed = {} } = {}) {
  const store = new Map(Object.entries(seed));
  const guard = () => {
    if (failing) throw new Error("storage is unavailable");
  };
  const storage = {
    getItem(key) {
      guard();
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      guard();
      store.set(key, String(value));
    },
    removeItem(key) {
      guard();
      store.delete(key);
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  return store;
}

afterEach(() => {
  delete globalThis.localStorage;
});

const a12 = { dom: "12", xonadon: "7" };
const a5 = { dom: "5", xonadon: "40" };

test("an empty browser yields an empty profile", () => {
  installStorage();
  assert.deepEqual(readProfile(), emptyProfile);
  assert.deepEqual(emptyProfile, { name: "", phone: "", addresses: [] });
});

test("a name saved by the old checkout is carried over", () => {
  installStorage({ seed: { [LEGACY_KEY]: "Bahrom Asrorov" } });
  assert.deepEqual(readProfile(), { name: "Bahrom Asrorov", phone: "", addresses: [] });
});

test("a single-address profile from the previous build becomes the first saved address", () => {
  installStorage({
    seed: {
      [LEGACY_KEY]: "Eski Ism",
      [PROFILE_KEY]: JSON.stringify({ name: "Yangi Ism", phone: "+998901234567", dom: "12", xonadon: "7" }),
    },
  });
  assert.deepEqual(readProfile(), { name: "Yangi Ism", phone: "+998901234567", addresses: [a12] });
});

test("a typed address saved before the selects existed is recovered", () => {
  installStorage({ seed: { [PROFILE_KEY]: JSON.stringify({ name: "Bahrom", phone: "", address: "12-dom, 7-xonadon" }) } });
  assert.deepEqual(readProfile(), { name: "Bahrom", phone: "", addresses: [a12] });
});

test("a typed address that is not a dom and xonadon is simply re-picked", () => {
  installStorage({ seed: { [PROFILE_KEY]: JSON.stringify({ name: "Bahrom", phone: "", address: "Navoiy ko‘chasi 15" }) } });
  assert.deepEqual(readProfile(), { name: "Bahrom", phone: "", addresses: [] });
});

test("several saved addresses are read back in order", () => {
  installStorage({ seed: { [PROFILE_KEY]: JSON.stringify({ name: "B", phone: "", addresses: [a5, a12] }) } });
  assert.deepEqual(readProfile().addresses, [a5, a12]);
});

test("an address the shop no longer offers, or a half-filled one, is dropped", () => {
  installStorage({
    seed: { [PROFILE_KEY]: JSON.stringify({ name: "", phone: "", addresses: [{ dom: "9999", xonadon: "7" }, { dom: "3", xonadon: "" }, a12] }) },
  });
  assert.deepEqual(readProfile().addresses, [a12]);
});

test("the address just used moves to the front, without repeats", () => {
  assert.deepEqual(rememberAddress([], a12), [a12], "the second order remembers the first address");
  assert.deepEqual(rememberAddress([a12], a5), [a5, a12], "a new address joins, preselected next time");
  assert.deepEqual(rememberAddress([a5, a12], a12), [a12, a5], "reusing one moves it up, not twice");
});

test("the list is capped, forgetting the oldest", () => {
  let list = [];
  for (let dom = 1; dom <= MAX_SAVED_ADDRESSES + 2; dom += 1) list = rememberAddress(list, { dom: String(dom), xonadon: "1" });
  assert.equal(list.length, MAX_SAVED_ADDRESSES);
  assert.equal(list[0].dom, String(MAX_SAVED_ADDRESSES + 2), "newest first");
  assert.ok(!list.some(address => address.dom === "1"), "oldest forgotten");
});

test("an address can be forgotten", () => {
  assert.deepEqual(forgetAddress([a5, a12], a5), [a12]);
  assert.deepEqual(cleanAddresses([a12, { ...a12 }]), [a12]);
});

test("saving trims, keeps the legacy keys in step, and round-trips", () => {
  const store = installStorage();
  const saved = writeProfile({ name: "  Bahrom  ", phone: " +998901234567 ", addresses: [a5, a12, a5] });

  assert.deepEqual(saved, { name: "Bahrom", phone: "+998901234567", addresses: [a5, a12] });
  const raw = JSON.parse(store.get(PROFILE_KEY));
  // An older tab still running the previous bundle reads dom/xonadon and the
  // legacy name key, so both carry the latest values.
  assert.equal(raw.dom, "5");
  assert.equal(raw.xonadon, "40");
  assert.equal(store.get(LEGACY_KEY), "Bahrom");
  assert.deepEqual(readProfile(), saved);
});

test("corrupt or foreign stored values never crash the page", () => {
  installStorage({ seed: { [PROFILE_KEY]: "{not json" } });
  assert.deepEqual(readProfile(), emptyProfile);

  installStorage({ seed: { [PROFILE_KEY]: JSON.stringify(["unexpected"]) } });
  assert.deepEqual(readProfile(), emptyProfile);

  installStorage({ seed: { [PROFILE_KEY]: JSON.stringify({ name: 42, phone: null, dom: [] }) } });
  assert.deepEqual(readProfile(), emptyProfile);

  installStorage({ seed: { [PROFILE_KEY]: JSON.stringify({ name: "", phone: "", addresses: [null, 5, "x", { dom: 1 }] }) } });
  assert.deepEqual(readProfile(), emptyProfile);
});

test("unavailable storage degrades to filling the form in by hand", () => {
  installStorage({ failing: true });
  assert.deepEqual(readProfile(), emptyProfile);
  // Writing must not throw either, or submitting an order would fail outright.
  assert.deepEqual(writeProfile({ name: "Bahrom", phone: "", addresses: [a12] }), { name: "Bahrom", phone: "", addresses: [a12] });
  assert.doesNotThrow(() => clearProfile());
});

test("clearing removes both keys", () => {
  const store = installStorage();
  writeProfile({ name: "Bahrom", phone: "+998901234567", addresses: [a12] });
  clearProfile();

  assert.equal(store.has(PROFILE_KEY), false);
  assert.equal(store.has(LEGACY_KEY), false);
  assert.deepEqual(readProfile(), emptyProfile);
});

test("validation mirrors what checkout will accept", () => {
  assert.equal(profileFieldError(emptyProfile), "", "a blank profile is allowed to be saved");
  assert.equal(profileFieldError({ ...emptyProfile, name: "B" }).length > 0, true);
  assert.equal(profileFieldError({ ...emptyProfile, name: "Bahrom", phone: "12345" }).length > 0, true);
  assert.equal(profileFieldError({ ...emptyProfile, name: "Bahrom", phone: "+998901234567" }), "");
  // Whitespace is not a value, so it must not trip the length rules.
  assert.equal(profileFieldError({ ...emptyProfile, name: "   ", phone: "   " }), "");
});
