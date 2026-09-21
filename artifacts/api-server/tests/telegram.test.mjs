import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { sendChatMessageNotification, sendNewOrderNotification } from "../src/lib/telegram.ts";

const keys = [
  "TELEGRAM_BOT_MODE",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_NEW_BOT_TOKEN",
  "TELEGRAM_ADMIN_CHAT_ID",
];
const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const order = {
  id: 0,
  orderNumber: "TEST",
  customerName: "<Test>",
  phone: "TEST",
  address: "TEST",
  items: [],
  paymentMethod: "cash",
  subtotal: 0,
  deliveryFee: 0,
  total: 0,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of keys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function configure(mode) {
  process.env.TELEGRAM_BOT_MODE = mode;
  process.env.TELEGRAM_BOT_TOKEN = "test-legacy-token";
  process.env.TELEGRAM_NEW_BOT_TOKEN = "test-new-token";
  process.env.TELEGRAM_ADMIN_CHAT_ID = "test-chat";
}

test("new mode sends only through the new bot, with the existing recipient", async () => {
  configure("new");
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://api.telegram.org/bottest-new-token/sendMessage");
    const body = JSON.parse(options.body);
    assert.equal(body.chat_id, "test-chat");
    assert.match(body.text, /&lt;Test&gt;/);
    assert.ok(options.signal);
    return new Response(JSON.stringify({ ok: true }));
  };
  assert.deepEqual(await sendNewOrderNotification(order), { sent: true });
  assert.equal(calls, 1);
});

test("legacy remains the default and can be explicitly selected", async () => {
  configure("legacy");
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.equal(url, "https://api.telegram.org/bottest-legacy-token/sendMessage");
    return new Response(JSON.stringify({ ok: true }));
  };
  assert.deepEqual(await sendNewOrderNotification(order), { sent: true });
  delete process.env.TELEGRAM_BOT_MODE;
  assert.deepEqual(await sendNewOrderNotification(order), { sent: true });
  assert.equal(calls, 2);
});

test("missing new token never silently falls back to the old bot", async () => {
  configure("new");
  delete process.env.TELEGRAM_NEW_BOT_TOKEN;
  globalThis.fetch = async () => assert.fail("must not call Telegram");
  assert.deepEqual(await sendNewOrderNotification(order), {
    sent: false,
    error: "Telegram bot configuration is missing",
  });
});

test("missing recipient or invalid mode prevents sending", async () => {
  configure("unknown");
  globalThis.fetch = async () => assert.fail("must not call Telegram");
  assert.equal((await sendNewOrderNotification(order)).error, "Telegram bot mode is invalid");
  process.env.TELEGRAM_BOT_MODE = "new";
  delete process.env.TELEGRAM_ADMIN_CHAT_ID;
  assert.equal((await sendNewOrderNotification(order)).sent, false);
});

test("network errors cannot expose token-bearing URLs", async () => {
  configure("new");
  globalThis.fetch = async (url) => { throw new Error(`Request failed: ${url}`); };
  assert.deepEqual(await sendNewOrderNotification(order), {
    sent: false,
    error: "Telegram request failed or timed out",
  });
});

test("Telegram rejections expose only status codes, not raw responses", async () => {
  configure("new");
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false,
    error_code: 403,
    description: "Sensitive response containing test-new-token",
  }), { status: 403 });
  assert.deepEqual(await sendNewOrderNotification(order), {
    sent: false,
    error: "Telegram returned 403",
  });
});

test("a customer's message is escaped before it becomes HTML", async () => {
  configure("new");
  let sent;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const result = await sendChatMessageNotification({
    threadId: 7,
    customerName: "<script>alert(1)</script>",
    phone: "+998901234567",
    body: 'Buyurtmam qayerda? <b>"tez"</b> & shoshilinch',
  });

  assert.deepEqual(result, { sent: true });
  assert.equal(sent.parse_mode, "HTML");
  // The notification is sent as HTML, so anything a stranger types must arrive
  // as text and never as markup that breaks or reshapes the message.
  assert.ok(!sent.text.includes("<script>"));
  assert.ok(!sent.text.includes('<b>"tez"</b>'));
  assert.ok(sent.text.includes("&lt;script&gt;"));
  assert.ok(sent.text.includes("&lt;b&gt;&quot;tez&quot;&lt;/b&gt;"));
  assert.ok(sent.text.includes("&amp; shoshilinch"));
  assert.ok(sent.text.includes("#7"), "the operator needs to know which thread");
});

test("a chat notification needs the same credentials as an order", async () => {
  configure("new");
  delete process.env.TELEGRAM_ADMIN_CHAT_ID;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  assert.deepEqual(await sendChatMessageNotification({ threadId: 1, customerName: "", phone: "", body: "salom" }), {
    sent: false,
    error: "Telegram bot configuration is missing",
  });
  assert.equal(called, false);
});