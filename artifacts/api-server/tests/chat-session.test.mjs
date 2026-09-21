import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";
import {
  CHAT_SESSION_COOKIE,
  CHAT_SESSION_MAX_AGE,
  createChatToken,
  hashChatToken,
  readChatToken,
  setChatCookie,
} from "../src/lib/chat-session.ts";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

const requestWith = (value) => ({ cookies: value === undefined ? {} : { [CHAT_SESSION_COOKIE]: value } });

test("a token is 256 bits of hex and never repeats", () => {
  const tokens = new Set();
  for (let i = 0; i < 200; i += 1) {
    const token = createChatToken();
    assert.match(token, /^[0-9a-f]{64}$/);
    tokens.add(token);
  }
  assert.equal(tokens.size, 200, "a repeat would hand one customer another's thread");
});

test("only the hash is ever meant to be stored", () => {
  const token = createChatToken();
  const hash = hashChatToken(token);

  assert.equal(hash, createHash("sha256").update(token).digest("hex"));
  assert.notEqual(hash, token);
  assert.equal(hashChatToken(token), hash, "lookups depend on this being stable");
  assert.notEqual(hashChatToken(createChatToken()), hash);
});

test("a malformed cookie is refused before it reaches the database", () => {
  // Anything that is not exactly the token shape is rejected, so a crafted
  // value cannot reach the query as a wildcard or an injection attempt.
  for (const value of [
    undefined,
    "",
    "not-a-token",
    "ABCDEF".repeat(10),
    "0".repeat(63),
    "0".repeat(65),
    "0".repeat(63) + "g",
    "0".repeat(63) + "%",
  ]) {
    assert.equal(readChatToken(requestWith(value)), undefined, `accepted: ${String(value)}`);
  }
  assert.equal(readChatToken({}), undefined, "a request with no cookies at all is fine");
});

test("a well-formed cookie is returned untouched", () => {
  const token = createChatToken();
  assert.equal(readChatToken(requestWith(token)), token);
});

test("the cookie is not readable by page scripts and is long lived", () => {
  process.env.NODE_ENV = "production";
  let captured;
  const res = {
    cookie(name, value, options) {
      captured = { name, value, options };
    },
  };
  const token = createChatToken();
  setChatCookie(res, token);

  assert.equal(captured.name, CHAT_SESSION_COOKIE);
  assert.equal(captured.value, token);
  // httpOnly is what keeps the secret out of reach of any script on the page.
  assert.equal(captured.options.httpOnly, true);
  assert.equal(captured.options.secure, true);
  assert.equal(captured.options.sameSite, "lax");
  assert.equal(captured.options.maxAge, CHAT_SESSION_MAX_AGE);
  assert.ok(CHAT_SESSION_MAX_AGE > 30 * 24 * 60 * 60 * 1000, "a returning customer keeps their thread");
});

test("the cookie drops the secure flag outside production so local http works", () => {
  process.env.NODE_ENV = "development";
  let captured;
  setChatCookie({ cookie: (_n, _v, options) => { captured = options; } }, createChatToken());
  assert.equal(captured.secure, false);
  assert.equal(captured.httpOnly, true);
});
