import assert from "node:assert/strict";
import { test } from "node:test";
import { __test, openTelegramLink, postEvent } from "../src/lib/telegram-mini-app.ts";

const { captureInitData, setInitData } = __test;

function memoryStorage() {
  const store = new Map();
  return { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
}

const initData = "query_id=AAE&user=%7B%22id%22%3A5001%7D&auth_date=1800000000&hash=abc";
const launchHash = `#tgWebAppData=${encodeURIComponent(initData)}&tgWebAppVersion=7.10&tgWebAppPlatform=android`;

test("the signed launch data is read from the URL fragment, exactly as Telegram sent it", () => {
  assert.equal(captureInitData({ hash: launchHash }, memoryStorage()), initData);
});

test("a reload inside Telegram that drops the fragment still has the launch data", () => {
  const storage = memoryStorage();
  captureInitData({ hash: launchHash }, storage);
  assert.equal(captureInitData({ hash: "" }, storage), initData);
});

test("outside Telegram there is nothing to sign in with", () => {
  assert.equal(captureInitData({ hash: "" }, memoryStorage()), "");
  assert.equal(captureInitData({ hash: "#section" }, memoryStorage()), "");
  assert.equal(captureInitData({ hash: launchHash }, undefined), initData, "works without storage");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(captureInitData({ hash: "" }, broken), "", "blocked storage never breaks the page");
});

test("events reach the phone and desktop apps through TelegramWebviewProxy, with a JSON payload", () => {
  const calls = [];
  const target = { TelegramWebviewProxy: { postEvent: (type, data) => calls.push([type, data]) }, parent: { postMessage: () => assert.fail("not the web path") } };
  postEvent("web_app_expand", undefined, target);
  postEvent("web_app_set_header_color", { color: "#1f6657" }, target);
  assert.deepEqual(calls, [["web_app_expand", undefined], ["web_app_set_header_color", '{"color":"#1f6657"}']], "no payload, as Telegram's library sends it");
});

test("on Telegram Web the event goes to the parent frame as one JSON message", () => {
  const messages = [];
  const target = { parent: { postMessage: (message, origin) => messages.push([JSON.parse(message), origin]) } };
  postEvent("web_app_ready", undefined, target);
  postEvent("web_app_set_background_color", { color: "#f7f4ec" }, target);
  assert.deepEqual(messages, [
    [{ eventType: "web_app_ready" }, "*"],
    [{ eventType: "web_app_set_background_color", eventData: { color: "#f7f4ec" } }, "*"],
  ]);
});

test("a client that throws never breaks the page", () => {
  const target = { TelegramWebviewProxy: { postEvent: () => { throw new Error("unknown event"); } }, parent: { postMessage() {} } };
  assert.doesNotThrow(() => postEvent("web_app_expand", undefined, target));
});

test("a t.me link is opened inside Telegram only in the Mini App, and only for t.me", () => {
  setInitData("");
  assert.equal(openTelegramLink("https://t.me/Q_express_bot?start=login"), false, "a browser follows the link itself");
  setInitData(initData);
  const sent = [];
  globalThis.window = { TelegramWebviewProxy: { postEvent: (type, data) => sent.push([type, JSON.parse(data)]) }, parent: { postMessage() {} } };
  try {
    assert.equal(openTelegramLink("https://t.me/Q_express_bot?start=login"), true);
    assert.deepEqual(sent, [["web_app_open_tg_link", { path_full: "/Q_express_bot?start=login" }]]);
    assert.equal(openTelegramLink("https://example.com/x"), false, "anything else is left to the browser");
  } finally {
    delete globalThis.window;
    setInitData("");
  }
});
