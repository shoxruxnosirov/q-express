import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  clearProfile,
  emptyProfile,
  profileFieldError,
  readProfile,
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

test("an empty browser yields an empty profile", () => {
  installStorage();
  assert.deepEqual(readProfile(), emptyProfile);
  assert.deepEqual(emptyProfile, { name: "", phone: "", dom: "", xonadon: "" });
});

test("a name saved by the old checkout is carried over", () => {
  installStorage({ seed: { [LEGACY_KEY]: "Bahrom Asrorov" } });
  assert.deepEqual(readProfile(), { name: "Bahrom Asrorov", phone: "", dom: "", xonadon: "" });
});

test("a stored profile wins over the legacy name", () => {
  installStorage({
    seed: {
      [LEGACY_KEY]: "Eski Ism",
      [PROFILE_KEY]: JSON.stringify({ name: "Yangi Ism", phone: "+998901234567", dom: "12", xonadon: "7" }),
    },
  });
  assert.deepEqual(readProfile(), {
    name: "Yangi Ism",
    phone: "+998901234567",
    dom: "12",
    xonadon: "7",
  });
});

test("a typed address saved before the selects existed is recovered", () => {
  installStorage({
    seed: {
      [PROFILE_KEY]: JSON.stringify({ name: "Bahrom", phone: "", address: "12-dom, 7-xonadon" }),
    },
  });
  assert.deepEqual(readProfile(), { name: "Bahrom", phone: "", dom: "12", xonadon: "7" });
});

test("a typed address that is not a dom and xonadon is simply re-picked", () => {
  installStorage({
    seed: {
      [PROFILE_KEY]: JSON.stringify({ name: "Bahrom", phone: "", address: "Navoiy ko‘chasi 15" }),
    },
  });
  assert.deepEqual(readProfile(), { name: "Bahrom", phone: "", dom: "", xonadon: "" });
});

test("a stored value the shop no longer offers is dropped", () => {
  installStorage({
    seed: { [PROFILE_KEY]: JSON.stringify({ name: "", phone: "", dom: "9999", xonadon: "7" }) },
  });
  // Keeping it would ask the select to display an option it does not have.
  assert.deepEqual(readProfile(), { name: "", phone: "", dom: "", xonadon: "7" });
});

test("saving trims the text fields and keeps the legacy name in step", () => {
  const store = installStorage();
  const saved = writeProfile({ name: "  Bahrom  ", phone: " +998901234567 ", dom: "12", xonadon: "7" });

  assert.deepEqual(saved, { name: "Bahrom", phone: "+998901234567", dom: "12", xonadon: "7" });
  assert.deepEqual(JSON.parse(store.get(PROFILE_KEY)), saved);
  // An older tab still running the previous bundle reads the legacy key, so it
  // must not be left holding a stale name.
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
});

test("unavailable storage degrades to filling the form in by hand", () => {
  installStorage({ failing: true });
  assert.deepEqual(readProfile(), emptyProfile);
  // Writing must not throw either, or submitting an order would fail outright.
  assert.deepEqual(writeProfile({ name: "Bahrom", phone: "", dom: "", xonadon: "" }), {
    name: "Bahrom",
    phone: "",
    dom: "",
    xonadon: "",
  });
  assert.doesNotThrow(() => clearProfile());
});

test("clearing removes both keys", () => {
  const store = installStorage();
  writeProfile({ name: "Bahrom", phone: "+998901234567", dom: "12", xonadon: "7" });
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
