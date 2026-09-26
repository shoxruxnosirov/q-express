import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  parseAdminReply,
  registerWebhook,
  sendChatMessageNotification,
  sendNewOrderNotification,
  sendOperatorReplyNotification,
  webhookSecret,
  webhookSecretMatches,
} from "../src/lib/telegram.ts";

const keys = [
  "TELEGRAM_BOT_MODE",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_NEW_BOT_TOKEN",
  "TELEGRAM_ADMIN_CHAT_ID",
  "SESSION_SECRET",
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
// --- Replies written in Telegram -------------------------------------------

const BOT_ID = 424242;

function configureInbound() {
  process.env.TELEGRAM_BOT_MODE = "legacy";
  process.env.TELEGRAM_BOT_TOKEN = `${BOT_ID}:test-inbound-token`;
  process.env.TELEGRAM_ADMIN_CHAT_ID = "5550001";
  process.env.SESSION_SECRET = "test-session-secret";
}

const replyUpdate = (overrides = {}) => ({
  update_id: 1,
  message: {
    message_id: 90,
    chat: { id: 5550001 },
    text: "  Buyurtmangiz yo‘lda  ",
    reply_to_message: {
      from: { id: BOT_ID, is_bot: true },
      text: "YANGI XABAR\n\nMijoz: Aziz\nSuhbat: #7\n\nQayerda?",
    },
    ...overrides,
  },
});

test("a reply to a chat notification is routed to that thread", () => {
  configureInbound();
  assert.deepEqual(parseAdminReply(replyUpdate()), {
    kind: "reply",
    threadId: 7,
    body: "Buyurtmangiz yo‘lda",
    messageId: 90,
    ref: "5550001:90",
  });
});

test("the operator's own dashboard copy can be replied to as well", () => {
  configureInbound();
  const update = replyUpdate({
    reply_to_message: {
      from: { id: BOT_ID, is_bot: true },
      text: "OPERATOR JAVOBI (admin panel)\n\nKimga: Aziz\nSuhbat: #12\n\nSalom",
    },
  });
  assert.equal(parseAdminReply(update).threadId, 12);
});

test("only the configured admin chat is listened to", () => {
  configureInbound();
  // Anybody can message the bot; a stranger must not be able to write to a
  // customer, even by quoting a notification's text.
  assert.deepEqual(parseAdminReply(replyUpdate({ chat: { id: 999 } })), { kind: "ignore" });
});

test("a thread number is trusted only from a message this bot wrote", () => {
  configureInbound();
  const forged = replyUpdate({
    reply_to_message: { from: { id: 1, is_bot: false }, text: "Suhbat: #7" },
  });
  assert.equal(parseAdminReply(forged).kind, "hint");
  const otherBot = replyUpdate({
    reply_to_message: { from: { id: 777, is_bot: true }, text: "Suhbat: #7" },
  });
  assert.equal(parseAdminReply(otherBot).kind, "hint");
});

test("plain messages, order replies, and empty or oversized text get a hint", () => {
  configureInbound();
  assert.deepEqual(parseAdminReply(replyUpdate({ reply_to_message: undefined })), { kind: "hint", messageId: 90 });
  const orderReply = replyUpdate({
    reply_to_message: { from: { id: BOT_ID, is_bot: true }, text: "YANGI BUYURTMA\nOrder: #QE-123456" },
  });
  assert.equal(parseAdminReply(orderReply).kind, "hint");
  assert.equal(parseAdminReply(replyUpdate({ text: undefined })).kind, "hint", "a sticker or photo");
  assert.equal(parseAdminReply(replyUpdate({ text: "x".repeat(2001) })).kind, "hint");
});

test("updates without a message, or with no bot configured, are ignored", () => {
  configureInbound();
  assert.deepEqual(parseAdminReply({ update_id: 2, edited_message: {} }), { kind: "ignore" });
  assert.deepEqual(parseAdminReply(null), { kind: "ignore" });
  delete process.env.TELEGRAM_BOT_TOKEN;
  assert.deepEqual(parseAdminReply(replyUpdate()), { kind: "ignore" });
});

test("the webhook secret is derived, stable, and checked in full", () => {
  configureInbound();
  const secret = webhookSecret();
  assert.match(secret, /^[0-9a-f]{64}$/, "Telegram allows only [A-Za-z0-9_-]");
  assert.equal(webhookSecret(), secret);
  assert.ok(webhookSecretMatches(secret));
  assert.ok(!webhookSecretMatches(secret.slice(0, -1)));
  assert.ok(!webhookSecretMatches(undefined));
  assert.ok(!webhookSecretMatches(""));
  process.env.TELEGRAM_BOT_TOKEN = `${BOT_ID}:rotated-token`;
  assert.notEqual(webhookSecret(), secret, "rotating the token retires the old secret");
  delete process.env.SESSION_SECRET;
  assert.equal(webhookSecret(), undefined);
  assert.ok(!webhookSecretMatches(secret), "no secret configured means nothing matches");
});

test("the webhook is registered at the API path with the secret", async () => {
  configureInbound();
  let call;
  globalThis.fetch = async (url, init) => {
    call = { url, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ ok: true }));
  };
  assert.deepEqual(await registerWebhook("https://q-express.onrender.com/"), { sent: true });
  assert.equal(call.url, `https://api.telegram.org/bot${BOT_ID}:test-inbound-token/setWebhook`);
  assert.equal(call.body.url, "https://q-express.onrender.com/api/telegram/webhook");
  assert.equal(call.body.secret_token, webhookSecret());
  assert.deepEqual(call.body.allowed_updates, ["message"]);
});

test("a dashboard reply is copied to Telegram escaped, with its thread", async () => {
  configureInbound();
  let sent;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ ok: true }));
  };
  const result = await sendOperatorReplyNotification({
    threadId: 7,
    customerName: "<Aziz>",
    phone: "+998901234567",
    body: "5 daqiqada <b>yetadi</b>",
  });
  assert.deepEqual(result, { sent: true });
  assert.ok(sent.text.includes("&lt;Aziz&gt;"));
  assert.ok(sent.text.includes("5 daqiqada &lt;b&gt;yetadi&lt;/b&gt;"));
  // Replying to this copy in Telegram must route back to the same thread,
  // which is what the plain text Telegram shows in reply_to_message contains.
  const plain = sent.text.replace(/<[^>]+>/g, "");
  const update = replyUpdate({ reply_to_message: { from: { id: BOT_ID, is_bot: true }, text: plain } });
  assert.equal(parseAdminReply(update).threadId, 7);
});
