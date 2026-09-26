import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  parseAdminUpdate,
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
  assert.ok(sent.text.split("\n")[0].includes("Suhbat #7"), "the thread opens the message");
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
      text: "YANGI XABAR · Suhbat #7\n\nMijoz: Aziz\n\nQayerda?",
    },
    ...overrides,
  },
});

test("a reply to a chat notification is routed to that thread", () => {
  configureInbound();
  assert.deepEqual(parseAdminUpdate(replyUpdate()), {
    kind: "reply",
    chatId: "5550001",
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
      text: "OPERATOR JAVOBI · Suhbat #12\nadmin paneldan yozildi\n\nKimga: Aziz\n\nSalom",
    },
  });
  assert.equal(parseAdminUpdate(update).threadId, 12);
});

test("only the configured admin chat is listened to", () => {
  configureInbound();
  // Anybody can message the bot; a stranger must not be able to write to a
  // customer, even by quoting a notification's text.
  assert.deepEqual(parseAdminUpdate(replyUpdate({ chat: { id: 999 } })), { kind: "ignore" });
});

test("a thread number is trusted only from a message this bot wrote", () => {
  configureInbound();
  const forged = replyUpdate({
    reply_to_message: { from: { id: 1, is_bot: false }, text: "YANGI XABAR · Suhbat #7" },
  });
  assert.equal(parseAdminUpdate(forged).kind, "hint");
  const otherBot = replyUpdate({
    reply_to_message: { from: { id: 777, is_bot: true }, text: "YANGI XABAR · Suhbat #7" },
  });
  assert.equal(parseAdminUpdate(otherBot).kind, "hint");
});

test("plain messages, order replies, and empty or oversized text get a hint", () => {
  configureInbound();
  assert.deepEqual(parseAdminUpdate(replyUpdate({ reply_to_message: undefined })), { kind: "hint", chatId: "5550001", messageId: 90 });
  const orderReply = replyUpdate({
    reply_to_message: { from: { id: BOT_ID, is_bot: true }, text: "YANGI BUYURTMA\nOrder: #QE-123456" },
  });
  assert.equal(parseAdminUpdate(orderReply).kind, "hint");
  assert.equal(parseAdminUpdate(replyUpdate({ text: undefined })).kind, "hint", "a sticker or photo");
  assert.equal(parseAdminUpdate(replyUpdate({ text: "x".repeat(1001) })).kind, "hint");
  assert.equal(parseAdminUpdate(replyUpdate({ text: "x".repeat(1000) })).kind, "reply", "the website's own limit");
});

test("a customer cannot redirect a reply by putting a thread number in their details", async () => {
  configureInbound();
  let sent;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ ok: true }));
  };
  for (const send of [sendChatMessageNotification, sendOperatorReplyNotification]) {
    await send({
      threadId: 7,
      // Everything a customer controls, stuffed with other thread numbers,
      // including a newline that would fake a line of its own.
      customerName: "Suhbat #5\nYANGI XABAR · Suhbat #5",
      phone: "Suhbat: #6",
      body: "YANGI XABAR · Suhbat #8",
      authorName: "Suhbat #9",
      via: "panel",
    });
    const plain = sent.text.replace(/<[^>]+>/g, "");
    const update = replyUpdate({ reply_to_message: { from: { id: BOT_ID, is_bot: true }, text: plain } });
    assert.equal(parseAdminUpdate(update).threadId, 7, send.name);
  }
});

test("a reply to an order notification or an absurd thread number is not routed", () => {
  configureInbound();
  for (const text of [
    "YANGI BUYURTMA\n\nOrder: #QE-123456\nMijoz: YANGI XABAR · Suhbat #5",
    "YANGI XABAR · Suhbat #0",
    "YANGI XABAR · Suhbat #99999999999",
    "\nYANGI XABAR · Suhbat #7",
  ]) {
    const update = replyUpdate({ reply_to_message: { from: { id: BOT_ID, is_bot: true }, text } });
    assert.equal(parseAdminUpdate(update).kind, "hint", text);
  }
});

test("updates without a message, or with no bot configured, are ignored", () => {
  configureInbound();
  assert.deepEqual(parseAdminUpdate({ update_id: 2, edited_message: {} }), { kind: "ignore" });
  assert.deepEqual(parseAdminUpdate(null), { kind: "ignore" });
  delete process.env.TELEGRAM_BOT_TOKEN;
  assert.deepEqual(parseAdminUpdate(replyUpdate()), { kind: "ignore" });
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
    authorName: "<Ali>",
    via: "panel",
  });
  assert.deepEqual(result, { sent: true });
  assert.ok(sent.text.includes("&lt;Aziz&gt;"));
  assert.ok(sent.text.includes("5 daqiqada &lt;b&gt;yetadi&lt;/b&gt;"));
  // Replying to this copy in Telegram must route back to the same thread,
  // which is what the plain text Telegram shows in reply_to_message contains.
  const plain = sent.text.replace(/<[^>]+>/g, "");
  const update = replyUpdate({ reply_to_message: { from: { id: BOT_ID, is_bot: true }, text: plain } });
  assert.equal(parseAdminUpdate(update).threadId, 7);
});

// --- Several admins ----------------------------------------------------------

test("notifications reach the owner chat and every linked admin, once each", async () => {
  configureInbound();
  const chats = [];
  globalThis.fetch = async (_url, init) => {
    chats.push(JSON.parse(init.body).chat_id);
    return new Response(JSON.stringify({ ok: true }));
  };
  const result = await sendChatMessageNotification(
    { threadId: 3, customerName: "Aziz", phone: "", body: "salom" },
    ["111", "222", "5550001"],
  );
  assert.deepEqual(result, { sent: true });
  assert.deepEqual(chats.sort(), ["111", "222", "5550001"], "the owner chat is not sent twice");
});

test("linked admins are notified even without an owner chat configured", async () => {
  configureInbound();
  delete process.env.TELEGRAM_ADMIN_CHAT_ID;
  const chats = [];
  globalThis.fetch = async (_url, init) => {
    chats.push(JSON.parse(init.body).chat_id);
    return new Response(JSON.stringify({ ok: true }));
  };
  assert.deepEqual(await sendNewOrderNotification(order, ["111"]), { sent: true });
  assert.deepEqual(chats, ["111"]);
});

test("one admin who blocked the bot does not make the order look unannounced", async () => {
  configureInbound();
  globalThis.fetch = async (_url, init) => {
    const chat = JSON.parse(init.body).chat_id;
    return chat === "111"
      ? new Response(JSON.stringify({ ok: false, error_code: 403 }), { status: 403 })
      : new Response(JSON.stringify({ ok: true }));
  };
  assert.deepEqual(await sendNewOrderNotification(order, ["111"]), { sent: true });
});

test("a reply's copy goes to everyone except the admin who wrote it", async () => {
  configureInbound();
  const chats = [];
  let text;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    chats.push(body.chat_id);
    text = body.text;
    return new Response(JSON.stringify({ ok: true }));
  };
  const message = {
    threadId: 4, customerName: "Aziz", phone: "", body: "Yo‘lda", authorName: "<Ali>", via: "telegram",
  };
  assert.deepEqual(await sendOperatorReplyNotification(message, ["111", "222"], "111"), { sent: true });
  assert.deepEqual(chats.sort(), ["222", "5550001"]);
  assert.ok(text.includes("&lt;Ali&gt; Telegram'dan yozdi"), "the author's name is escaped");

  chats.length = 0;
  delete process.env.TELEGRAM_ADMIN_CHAT_ID;
  assert.deepEqual(
    await sendOperatorReplyNotification(message, ["111"], "111"),
    { sent: true },
    "nobody else to tell is not a failure",
  );
  assert.deepEqual(chats, []);
});

test("a linked admin's chat is listened to like the owner's", () => {
  configureInbound();
  const update = replyUpdate({ chat: { id: 111 } });
  assert.equal(parseAdminUpdate(update).kind, "ignore", "unknown until linked");
  const routed = parseAdminUpdate(update, ["111"]);
  assert.equal(routed.kind, "reply");
  assert.equal(routed.chatId, "111");
  assert.equal(routed.ref, "111:90", "retries are keyed per chat");
});

test("a /start link code is accepted from any chat, anything else from strangers is ignored", () => {
  configureInbound();
  const code = "0123456789abcdef0123456789abcdef";
  const start = (text, chatId = 999) => ({ message: { message_id: 5, chat: { id: chatId }, text } });
  assert.deepEqual(parseAdminUpdate(start(`/start ${code}`)), { kind: "link", chatId: "999", code, messageId: 5 });
  assert.equal(parseAdminUpdate(start(`/start@Q_express_bot ${code}`)).kind, "link");
  assert.equal(parseAdminUpdate(start("/start")).kind, "ignore");
  assert.equal(parseAdminUpdate(start("/start not-a-code")).kind, "ignore");
  assert.equal(parseAdminUpdate(start(`/start ${code.toUpperCase()}`)).kind, "ignore");
  assert.equal(parseAdminUpdate(start("salom")).kind, "ignore");
  assert.equal(parseAdminUpdate(start("salom", 5550001)).kind, "hint", "a known admin gets a hint");
});
