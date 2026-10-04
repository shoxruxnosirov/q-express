import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  parseAdminUpdate,
  preorderReminderText,
  customerReplyText,
  isAdminChat,
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
  process.env.TELEGRAM_ADMIN_CHAT_ID = "4440001";
}

test("new mode sends only through the new bot, with the existing recipient", async () => {
  configure("new");
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://api.telegram.org/bottest-new-token/sendMessage");
    const body = JSON.parse(options.body);
    assert.equal(body.chat_id, "4440001");
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
  assert.deepEqual(call.body.allowed_updates, ["message", "my_chat_member"]);
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
  assert.ok(text.includes("<b>&lt;Ali&gt;</b> Telegram'dan javob berdi"), "the author's name is escaped");
  assert.equal(text.split("\n")[0], "<b>🔵↩️ OPERATOR JAVOBI</b> · Suhbat #4", "a copy can be replied to as well");
  assert.ok(text.includes("<blockquote>Yo‘lda</blockquote>"));

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
  assert.equal(parseAdminUpdate(start("/start")).kind, "welcome", "a stranger's /start is a customer arriving");
  assert.equal(parseAdminUpdate(start("/start not-a-code")).kind, "ignore");
  assert.equal(parseAdminUpdate(start(`/start ${code.toUpperCase()}`)).kind, "ignore");
  assert.equal(parseAdminUpdate(start("salom")).kind, "ignore");
  assert.equal(parseAdminUpdate(start("salom", 5550001)).kind, "hint", "a known admin gets a hint");
});

// --- Customers in the bot ------------------------------------------------------

test("every /start gets the shop, including the login links of earlier builds", () => {
  configureInbound();
  const code = "0123456789abcdef0123456789abcdef";
  const msg = (text, chat = { id: 777, type: "private" }) => ({ message: { message_id: 1, chat, from: { id: 777 }, text } });
  for (const text of ["/start", "/start login", `/start login_${code}`, "/start@Q_express_bot login"]) {
    assert.deepEqual(parseAdminUpdate(msg(text)), { kind: "welcome", chatId: "777" }, text);
  }
  assert.equal(parseAdminUpdate(msg("/start", { id: 5550001, type: "private" })).kind, "welcome", "admins get the shop too");
  assert.equal(parseAdminUpdate(msg("/start login", { id: -100, type: "group" })).kind, "leave", "never in a group");
  assert.equal(parseAdminUpdate(msg("/start login_short")).kind, "ignore");
  // An admin link code is still an admin link.
  assert.equal(parseAdminUpdate(msg(`/start ${code}`)).kind, "link");
});

test("a contact sent with an old button is not a chat message", () => {
  configureInbound();
  const update = { message: { message_id: 2, chat: { id: 777, type: "private" }, from: { id: 777 }, contact: { phone_number: "+998901112233", user_id: 777 } } };
  assert.equal(parseAdminUpdate(update).kind, "customer-unsupported");
});

test("the customer's own message is copied to the bot escaped, and notices drop the old keyboard", async () => {
  configureInbound();
  const { customerEchoText, sendCustomerNotice } = await import("../src/lib/telegram.ts");
  assert.ok(customerEchoText("<b>salom</b>").includes("&lt;b&gt;salom&lt;/b&gt;"));
  assert.match(customerEchoText("x"), /Siz yozdingiz/);
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }));
  };
  await sendCustomerNotice("777", "unsupported");
  assert.equal(bodies[0].reply_markup.remove_keyboard, true);
});

test("the admins can tell a chat from an order, a buyer from a newcomer, and where it came from", async () => {
  configureInbound();
  const { chatNotificationText } = await import("../src/lib/telegram.ts");
  const base = { threadId: 3, customerName: "Aziz", phone: "998901112233", body: "salom" };
  const buyer = chatNotificationText({ ...base, orderCount: 2, via: "mini-app" });
  assert.equal(buyer.split("\n")[0], "<b>🔵💬 CHAT</b> · Suhbat #3");
  assert.match(buyer, /🛍 Buyurtmachi · 2 ta buyurtma/);
  assert.match(buyer, /📱 Mini App orqali yozdi/);
  assert.match(buyer, /<blockquote>salom<\/blockquote>/, "the customer's words stand apart");
  const newcomer = chatNotificationText({ ...base, orderCount: 0, via: "bot" });
  assert.match(newcomer, /🆕 Hali buyurtma bermagan/);
  assert.match(newcomer, /🤖 Telegram bot orqali yozdi/);
  // The header still routes a reply, with or without the emoji.
  const reply = (text) => ({ message: { message_id: 9, chat: { id: 5550001 }, from: { id: 5550001 }, text: "javob", reply_to_message: { from: { id: BOT_ID, is_bot: true }, text } } });
  assert.equal(parseAdminUpdate(reply(buyer.replace(/<[^>]+>/g, ""))).threadId, 3);
  assert.equal(parseAdminUpdate(reply("YANGI XABAR · Suhbat #4")).threadId, 4, "notifications sent before this change");
});

test("phones in notifications are written for people, not as raw digits", async () => {
  configureInbound();
  let text;
  globalThis.fetch = async (_url, init) => {
    text = JSON.parse(init.body).text;
    return new Response(JSON.stringify({ ok: true }));
  };
  await sendNewOrderNotification({ ...order, phone: "998901112233" });
  assert.ok(text.includes("+998 90 111 22 33"), text);
  await sendChatMessageNotification({ threadId: 1, customerName: "A", phone: "998901112233", body: "x" });
  assert.ok(text.includes("+998 90 111 22 33"));
  await sendNewOrderNotification({ ...order, phone: "odd" });
  assert.ok(text.includes("</b> · odd"), "anything else is shown as stored");
});


test("a pre-order reminder says how long is left, or that the time has come", () => {
  const base = {
    orderNumber: "QE-1",
    customerName: "<Ali>",
    phone: "998901112233",
    address: "12-dom",
    total: "45000",
    scheduledLabel: "27.09 09:00",
  };
  const soon = preorderReminderText({ ...base, minutesLeft: 15 });
  assert.match(soon, /OLDINDAN BUYURTMA · 15 daqiqa qoldi/);
  assert.match(soon, /🗓 <b>Yetkazish: 27\.09 09:00<\/b> · #QE-1/);
  assert.ok(soon.startsWith("🔔 <b>ESLATMA"), "a reminder does not look like a new order");
  assert.ok(soon.includes("&lt;Ali&gt;"), "names are escaped");
  assert.ok(soon.includes("+998 90 111 22 33"));
  assert.match(preorderReminderText({ ...base, minutesLeft: 0 }), /vaqti keldi/);
  assert.match(preorderReminderText({ ...base, minutesLeft: -5 }), /vaqti keldi/);
});

test("a customer's private message to the bot is taken as a chat message", () => {
  configureInbound();
  const own = (message) => parseAdminUpdate({ update_id: 5, message: { message_id: 11, chat: { id: 7001, type: "private" }, from: { id: 7001 }, ...message } });
  assert.deepEqual(own({ text: "  non kam keldi " }), {
    kind: "customer-message", chatId: "7001", telegramUserId: "7001", name: "", username: null, body: "non kam keldi", messageId: 11, ref: "7001:11",
  });
  assert.equal(own({ text: "salom", from: { id: 7001, username: "vali_01" } }).username, "vali_01");
  assert.equal(own({ text: "salom", from: { id: 7001, username: "<b>" } }).username, null, "only what Telegram allows");
  // Telegram's name, for an account the message creates.
  assert.equal(own({ text: "salom", from: { id: 7001, first_name: "Vali", last_name: "Aliyev" } }).name, "Vali Aliyev");
  // A reply to the bot's message is still just the customer's own message:
  // it can only ever land in their own conversation.
  const note = { from: { id: BOT_ID, is_bot: true }, text: "YANGI XABAR · Suhbat #1\n\nx" };
  assert.equal(own({ text: "javob", reply_to_message: note }).kind, "customer-message");
  assert.equal(own({ photo: [{}] }).kind, "customer-unsupported");
  assert.equal(own({ text: "x".repeat(1001) }).kind, "customer-unsupported");
  assert.equal(own({ text: "/help" }).kind, "ignore");
  // Groups are left; a message whose sender is not the chat is not a customer.
  assert.equal(parseAdminUpdate({ message: { message_id: 1, chat: { id: -100, type: "group" }, from: { id: 7001 }, text: "salom" } }).kind, "leave");
  assert.equal(parseAdminUpdate({ message: { message_id: 1, chat: { id: 7002, type: "private" }, from: { id: 7001 }, text: "salom" } }).kind, "ignore");
  // The admin chat keeps its meaning.
  assert.equal(parseAdminUpdate({ message: { message_id: 1, chat: { id: 5550001, type: "private" }, from: { id: 5550001 }, text: "salom" } }).kind, "hint");
});

test("the shop's reply to a customer is escaped and the admin chats are recognised", () => {
  configureInbound();
  const text = customerReplyText("<b>10</b> daqiqada");
  assert.ok(text.includes("&lt;b&gt;10&lt;/b&gt; daqiqada"));
  assert.match(text, /Q express javobi/);
  assert.equal(isAdminChat("5550001", []), true, "the owner's chat");
  assert.equal(isAdminChat("777", ["777"]), true, "a linked admin");
  assert.equal(isAdminChat("7001", ["777"]), false);
});

test("the bot works in private chats only: groups and channels are left, never written to", async () => {
  configureInbound();
  const { isPrivateChatId } = await import("../src/lib/telegram.ts");
  const inChat = (chat, text = "salom") => parseAdminUpdate({ message: { message_id: 1, chat, from: { id: 7001 }, text } });
  for (const type of ["group", "supergroup", "channel"]) {
    assert.deepEqual(inChat({ id: -1001234, type }), { kind: "leave", chatId: "-1001234" }, type);
  }
  // Not even an admin link code or a reply is read in a group.
  assert.equal(inChat({ id: -100, type: "group" }, "/start 0123456789abcdef0123456789abcdef").kind, "leave");
  assert.equal(inChat({ id: -100 }).kind, "ignore", "a negative id is never a private chat");
  assert.equal(isPrivateChatId("5448064497"), true);
  assert.equal(isPrivateChatId("-1001234"), false);
  assert.equal(isPrivateChatId("test-chat"), false);
  // A group configured as the owner chat is not written to.
  process.env.TELEGRAM_ADMIN_CHAT_ID = "-1001234";
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body).chat_id);
    return new Response(JSON.stringify({ ok: true }));
  };
  await sendChatMessageNotification({ threadId: 1, customerName: "A", phone: "", body: "x" }, ["777"]);
  assert.deepEqual(sent, ["777"]);
  process.env.TELEGRAM_ADMIN_CHAT_ID = "5550001";
});

test("the admins see who the customer is in Telegram", async () => {
  configureInbound();
  const { chatNotificationText, telegramLabel } = await import("../src/lib/telegram.ts");
  assert.equal(telegramLabel({ telegramName: "Aziz", telegramUsername: "aziz_k" }), "Aziz (@aziz_k)");
  assert.equal(telegramLabel({ telegramName: "", telegramUsername: "aziz_k" }), "@aziz_k");
  assert.equal(telegramLabel({ telegramName: null, telegramUsername: null }), undefined);
  const text = chatNotificationText({ threadId: 2, customerName: "Aziz aka", phone: "", body: "x", telegramName: "<Aziz>", telegramUsername: "aziz_k" });
  assert.match(text, /✈️ <a href="https:\/\/t\.me\/aziz_k">&lt;Aziz&gt; \(@aziz_k\)<\/a>/, "escaped, and a link to their Telegram");
  const noUsername = chatNotificationText({ threadId: 2, customerName: "A", phone: "", body: "x", telegramName: "Vali", telegramUsername: null });
  assert.match(noUsername, /✈️ Vali\n/, "without a @username, just the name");
});

test("added to a group or channel, the bot leaves at once", () => {
  configureInbound();
  const added = (type, status = "administrator") => parseAdminUpdate({ update_id: 1, my_chat_member: { chat: { id: -1005555, type }, new_chat_member: { status } } });
  assert.deepEqual(added("channel"), { kind: "leave", chatId: "-1005555" });
  assert.deepEqual(added("supergroup", "member"), { kind: "leave", chatId: "-1005555" });
  assert.equal(added("group", "left").kind, "ignore", "already gone");
  assert.equal(added("private", "member").kind, "ignore", "a customer starting the bot");
});

test("a comment on a delivered order tells the admins whose it is, escaped, and is not a chat", async () => {
  configureInbound();
  const { orderFeedbackText } = await import("../src/lib/telegram.ts");
  const text = orderFeedbackText({
    orderNumber: "QE-0000042",
    customerName: "Aziz <aka>",
    phone: "998901112233",
    address: "12-dom, 5-xonadon",
    total: "45000",
    telegramName: "Aziz",
    telegramUsername: "aziz_k",
    text: "Non <b>sovuq</b> keldi · Suhbat #3",
  });
  assert.equal(text.split("\n")[0], "🟡⭐ <b>IZOH</b> · Buyurtma <b>#QE-0000042</b>");
  assert.match(text, /👤 <b>Aziz &lt;aka&gt;<\/b> · \+998 90 111 22 33/);
  assert.match(text, /✈️ <a href="https:\/\/t\.me\/aziz_k">Aziz \(@aziz_k\)<\/a>/);
  assert.match(text, /📍 12-dom, 5-xonadon/);
  assert.match(text, /<blockquote>Non &lt;b&gt;sovuq&lt;\/b&gt; keldi · Suhbat #3<\/blockquote>/);
  // An admin replying to it is given the usual hint: it names no conversation.
  const reply = { message: { message_id: 9, chat: { id: 5550001 }, from: { id: 5550001 }, text: "rahmat", reply_to_message: { from: { id: BOT_ID, is_bot: true }, text: text.replace(/<[^>]+>/g, "") } } };
  assert.equal(parseAdminUpdate(reply).kind, "hint");
});

test("every order line tells the admins how many, at what price, for how much", async () => {
  configureInbound();
  const { formatQuantity, orderLineText } = await import("../src/lib/telegram.ts");
  assert.equal(formatQuantity(3, "dona"), "3 dona");
  assert.equal(formatQuantity(2.9999999, "qadoq"), "3 qadoq", "pieces and packs are whole");
  assert.equal(formatQuantity(0.1 + 0.2, "kg"), "0.3 kg", "no floating-point noise");
  assert.equal(formatQuantity(1.25, "litr"), "1.25 litr");
  const plainLine = (item) => orderLineText(item).replace(/<[^>]+>/g, "").replace(/\s/g, " ");
  assert.equal(plainLine({ name: "Non", quantity: 3, unit: "dona", price: 4000, total: 12000 }), "▫️ Non — 3 dona × 4 000 = 12 000");
  assert.equal(plainLine({ name: "Olma", quantity: 0.5, unit: "kg", price: 6000, total: 3000, purchase_mode: "quantity" }), "▫️ Olma — 0.5 kg × 6 000 = 3 000");
  assert.equal(plainLine({ name: "Go‘sht", quantity: 0.25, unit: "kg", price: 120000, total: 30000, purchase_mode: "amount", requested_amount: 30000 }), "▫️ Go‘sht — 30 000 so'mlik (~0.25 kg)");
  assert.match(orderLineText({ name: "Non", quantity: 3, unit: "dona", price: 4000, total: 12000 }), /<b>3 dona<\/b>/, "the count stands out");
  assert.match(orderLineText({ name: "<b>x</b>", quantity: 1, unit: "dona", price: 1, total: 1 }), /&lt;b&gt;x&lt;\/b&gt;/, "names are escaped");
});

test("the order notification lists every line with its count, and the payment in Uzbek", async () => {
  configureInbound();
  let text;
  globalThis.fetch = async (_url, init) => {
    text = JSON.parse(init.body).text.replace(/<[^>]+>/g, "").replace(/\s/g, " ");
    return new Response(JSON.stringify({ ok: true }));
  };
  await sendNewOrderNotification({
    ...order,
    paymentMethod: "cash",
    items: [
      { name: "Non", quantity: 3, unit: "dona", price: 4000, total: 12000, purchase_mode: "quantity" },
      { name: "Sut", quantity: 2, unit: "qadoq", price: 9000, total: 18000, purchase_mode: "quantity" },
    ],
  });
  assert.match(text, /^🟢🛒 YANGI BUYURTMA · #/);
  assert.match(text, /📦 Mahsulotlar · 2 xil/);
  assert.match(text, /▫️ Non — 3 dona × 4 000 = 12 000/);
  assert.match(text, /▫️ Sut — 2 qadoq × 9 000 = 18 000/);
  assert.match(text, /💰 Jami:/);
  assert.match(text, /🚚 Yetkazish: bepul 🎁/);
  assert.match(text, /To‘lov: 💵 Naqd/);
});

test("a very long order still reaches the admins, its list cut short and counted", async () => {
  configureInbound();
  const { itemsWithinLimit } = await import("../src/lib/telegram.ts");
  const lines = Array.from({ length: 200 }, (_, i) => `• Mahsulot ${i} — 1 dona × 1 000 so'm = 1 000 so'm`);
  const text = itemsWithinLimit(lines);
  assert.ok(text.length < 3000);
  assert.match(text, /… va yana <b>\d+<\/b> ta mahsulot/);
  const shown = text.split("\n").length - 1;
  assert.match(text, new RegExp(`yana <b>${200 - shown}</b>`));
  assert.equal(itemsWithinLimit(lines.slice(0, 3)), lines.slice(0, 3).join("\n"), "a short list is left whole");
});

test("text that would push a message past Telegram's limits is cut, never dropped", async () => {
  configureInbound();
  const { shorten, welcomeMessage, orderLineText, preorderReminderText } = await import("../src/lib/telegram.ts");
  assert.equal(shorten("Non", 60), "Non");
  assert.equal(shorten("x".repeat(100), 60), `${"x".repeat(59)}…`);
  assert.equal([...shorten("🍞".repeat(100), 10)].length, 10, "counted in characters, emoji included");
  // Three discounted products with absurd names still leave the caption under 1024.
  const offers = [1, 2, 3].map((i) => ({ name: `<${"Juda uzun mahsulot nomi ".repeat(12)}${i}>`, price: 1000, oldPrice: 2000 }));
  const caption = welcomeMessage("https://x", offers, { openTime: "06:00", closeTime: "23:00" }).caption;
  assert.ok(caption.replace(/<[^>]+>/g, "").length < 1024, `${caption.length}`);
  assert.ok(!/<Juda/.test(caption), "names stay escaped after cutting");
  // A product name never takes the whole order list.
  assert.ok(orderLineText({ name: "x".repeat(5000), quantity: 1, unit: "dona", price: 1, total: 1 }).length < 250);
  // An old order with a long address is printed short.
  const reminder = preorderReminderText({ orderNumber: "QE-1", customerName: "A", phone: "998901112233", address: "y".repeat(3000), total: "1", scheduledLabel: "09:00", minutesLeft: 5 });
  assert.ok(reminder.length < 600);
});
