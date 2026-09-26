import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  ADMIN_SESSION_MAX_AGE,
  adminCodesMatch,
  burnPasswordCheck,
  createAdminSessionToken,
  hashPassword,
  newPasswordProblem,
  normalizeUsername,
  readAdminSessionToken,
  verifyPassword,
} from "../src/lib/admin-auth.ts";

const originalSecret = process.env.SESSION_SECRET;
afterEach(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

test("a password verifies against its own hash and nothing else", async () => {
  const hash = await hashPassword("qorasuv-2026!");
  assert.match(hash, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.ok(!hash.includes("qorasuv-2026!"));
  assert.equal(await verifyPassword("qorasuv-2026!", hash), true);
  assert.equal(await verifyPassword("qorasuv-2026", hash), false);
  assert.equal(await verifyPassword("QORASUV-2026!", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

test("the same password hashes differently each time", async () => {
  const [a, b] = await Promise.all([hashPassword("bir xil parol"), hashPassword("bir xil parol")]);
  assert.notEqual(a, b, "a per-password salt keeps equal passwords from standing out");
  assert.equal(await verifyPassword("bir xil parol", a), true);
  assert.equal(await verifyPassword("bir xil parol", b), true);
});

test("a missing or malformed stored hash never verifies", async () => {
  for (const stored of [null, undefined, "", "plain-text", "scrypt$1$2$3", "bcrypt$x$y$z$a$b", "scrypt$x$8$1$AAAA$AAAA"]) {
    assert.equal(await verifyPassword("anything", stored), false, String(stored));
  }
});

test("the timing decoy for unknown usernames never succeeds", async () => {
  assert.equal(await burnPasswordCheck("guess"), false);
});

test("new passwords must be long enough and not the username", () => {
  assert.match(newPasswordProblem("short", "ali"), /kamida 8/);
  assert.match(newPasswordProblem("shoxrux", "shoxrux") ?? "", /kamida 8|login/);
  assert.match(newPasswordProblem("Bahrom12", "bahrom12"), /login/);
  assert.match(newPasswordProblem("x".repeat(129), "ali"), /uzun/);
  assert.equal(newPasswordProblem("yaxshi-parol", "ali"), undefined);
});

test("usernames are compared without case or surrounding space", () => {
  assert.equal(normalizeUsername("  Shoxrux "), "shoxrux");
});

test("the access code comparison is exact", () => {
  assert.equal(adminCodesMatch("abc123", "abc123"), true);
  assert.equal(adminCodesMatch("abc12", "abc123"), false);
  assert.equal(adminCodesMatch("ABC123", "abc123"), false);
});

test("a session token names the admin and version, and survives only untouched", () => {
  process.env.SESSION_SECRET = "test-secret";
  const now = 1_800_000_000_000;
  const token = createAdminSessionToken(12, 3, now);
  assert.deepEqual(readAdminSessionToken(token, now + 1000), { adminId: 12, version: 3 });

  const [id, version, issued, signature] = token.split(".");
  // Pointing the cookie at another admin, or back at an old version, must fail.
  assert.equal(readAdminSessionToken(`13.${version}.${issued}.${signature}`, now), undefined);
  assert.equal(readAdminSessionToken(`${id}.2.${issued}.${signature}`, now), undefined);
  assert.equal(readAdminSessionToken(`${id}.${version}.${now + 5}.${signature}`, now + 10), undefined);
  assert.equal(readAdminSessionToken(`${token}x`, now), undefined);
  for (const junk of [undefined, null, 42, "", "a.b.c.d", "1.2.3", "1.2.3.4.5"]) {
    assert.equal(readAdminSessionToken(junk, now), undefined, String(junk));
  }
});

test("a session token expires after eight hours and is useless under another secret", () => {
  process.env.SESSION_SECRET = "test-secret";
  const now = 1_800_000_000_000;
  const token = createAdminSessionToken(1, 0, now);
  assert.ok(readAdminSessionToken(token, now + ADMIN_SESSION_MAX_AGE));
  assert.equal(readAdminSessionToken(token, now + ADMIN_SESSION_MAX_AGE + 1), undefined);
  assert.equal(readAdminSessionToken(token, now - 1), undefined, "issued in the future");
  process.env.SESSION_SECRET = "rotated";
  assert.equal(readAdminSessionToken(token, now), undefined);
});
