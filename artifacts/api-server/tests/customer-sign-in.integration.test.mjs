// End-to-end check of the shop living in Telegram: the Mini App signs in by
// Telegram's launch data with nothing typed (also with no cookie at all, as in
// Telegram Web), the customer fills in their own details, orders are taken
// only there, the first order to a flat is free, the chat is one conversation
// in the Mini App and the bot, private chats only, the admins see who each
// customer is in Telegram, and a block holds a Telegram account, never a
// number somebody typed.
//
// It needs a freshly migrated, otherwise empty database (a throwaway local
// cluster is fine), because it chooses the seeded super admin's first
// password and counts what it creates. On any other database it is skipped.
// Telegram is stubbed; nothing leaves the machine.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, test as nodeTest } from "node:test";

const DATABASE_URL = process.env.DATABASE_URL;
const TOKEN = "424242:flow-test-token";
const SESSION_SECRET = "flow-test-session-secret";
const ADMIN_CODE = "flow-admin-code";
const OWNER_CHAT = "5550001";
const PORT = 19555;
const BASE = `http://127.0.0.1:${PORT}/api`;
const LOG = join(mkdtempSync(join(tmpdir(), "qe-sign-in-")), "telegram-calls.log");

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const require = createRequire(import.meta.url);
const pg = require(require.resolve("pg", { paths: [resolve(repoRoot, "lib/db")] }));
const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL }) : undefined;
const q = async (text, values = []) => (await pool.query(text, values)).rows;

// Fresh means migrated, with the seeded super admin still waiting for a
// password and no customer yet.
async function isFresh() {
  if (!pool) return false;
  try {
    const [admin] = await q(`select password_hash from admins where username = 'shoxrux'`);
    const [users] = await q(`select count(*)::int as n from users`);
    return Boolean(admin) && admin.password_hash === null && users.n === 0;
  } catch {
    return false;
  }
}
const fresh = await isFresh();
const test = fresh
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "needs DATABASE_URL pointing at a freshly migrated, empty database" }, fn);

let server;

// A cookie jar per simulated device.
class Device {
  // bearerOnly: a frame in Telegram Web whose cookies the browser refuses;
  // the Mini App then sends the session token it was given as a header.
  constructor(name, { bearerOnly = false } = {}) { this.name = name; this.cookies = new Map(); this.bearerOnly = bearerOnly; this.token = null; }
  header() { return this.bearerOnly ? "" : [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  async call(method, path, body) {
    const headers = { "content-type": "application/json", cookie: this.header(), "user-agent": `${this.name} (Linux; Android 14) Chrome/130` };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const [k, v] = pair.split("=");
      if (/Expires=Thu, 01 Jan 1970/.test(line) || v === "") this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: response.status, body: json };
  }
  // Opens the shop as the Mini App of a Telegram account, keeping the
  // session token for later calls as the Mini App does. Answers the profile.
  async launch(user, authDate) {
    const r = await this.call("POST", "/customer/telegram", { init_data: initData(user, authDate) });
    if (r.status === 200) {
      assert.match(r.body.session_token, /^[0-9a-f]{64}$/);
      this.token = r.body.session_token;
      return { status: r.status, body: r.body.profile };
    }
    return r;
  }
}

function initData(user, authDate = Math.floor(Date.now() / 1000)) {
  const fields = { auth_date: String(authDate), query_id: "AAE", user: JSON.stringify(user) };
  const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const webhookSecret = createHmac("sha256", SESSION_SECRET).update(`telegram-webhook:${TOKEN}`).digest("hex");
let messageId = 1;
async function sendUpdate(message) {
  const response = await fetch(`${BASE}/telegram/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": webhookSecret },
    body: JSON.stringify({ update_id: messageId, message: { message_id: messageId++, ...message } }),
  });
  assert.equal(response.status, 200);
}
function writeToBot(from, text, firstName = "", username) {
  return sendUpdate({ chat: { id: from, type: "private" }, from: { id: from, first_name: firstName, ...(username ? { username } : {}) }, text });
}

function botCalls() {
  return readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}
function messagesTo(chatId) {
  return botCalls().filter((c) => c.method === "sendMessage" && String(c.body.chat_id) === String(chatId)).map((c) => c.body);
}
const lastTo = (chatId) => messagesTo(chatId).pop();
const plain = (html) => html.replace(/<[^>]+>/g, "");

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}

before(async () => {
  if (!fresh) return;
  writeFileSync(LOG, "");
  // Open all day, so orders are taken whatever the clock says.
  await q(`update store_settings set open_time = '00:00', close_time = '00:00', accepting_orders = true`);
  // --import takes a URL; a bare Windows path such as D:... is read as scheme "d:".
  server = spawn(process.execPath, ["--import", pathToFileURL(join(here, "telegram-stub.mjs")).href, resolve(here, "../dist/index.mjs")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      TELEGRAM_BOT_MODE: "legacy",
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_ADMIN_CHAT_ID: OWNER_CHAT,
      SESSION_SECRET,
      ADMIN_ACCESS_CODE: ADMIN_CODE,
      TG_STUB_LOG: LOG,
      PUBLIC_BASE_URL: "",
      RENDER_EXTERNAL_URL: "",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  await waitForServer();
});

after(async () => {
  server?.kill();
  await pool?.end();
});

async function placeOrder(device, address, phone = "+998 90 111 22 33", name = "Mijoz") {
  const [product] = await q(`select id from products where active and stock > 10 and unit in ('dona','qadoq') order by id limit 1`);
  return device.call("POST", "/orders", {
    customer_name: name,
    phone,
    address,
    payment_method: "cash",
    items: [{ product_id: product.id, quantity: 1 }],
  });
}

// What Telegram says about 5001 on every launch.
const AZIZ = { id: 5001, first_name: "Aziz", last_name: "Karimov", username: "aziz_k" };

const admin = new Device("admin");
const miniA = new Device("miniA"); // Telegram 5001
const miniB = new Device("miniB"); // Telegram 5002, a neighbour's guest
const browserG = new Device("browserG"); // a guest outside Telegram
const tabletA = new Device("miniA-tablet"); // 5001 on a second device

test("seed the catalogue and an admin", async () => {
  assert.equal((await new Device("seed").call("GET", "/categories")).status, 200);
  const setup = await admin.call("POST", "/admin/setup", { username: "shoxrux", access_code: ADMIN_CODE, new_password: "Flow-test-Password-2026" });
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
});

test("opening the Mini App signs a new Telegram user in with nothing typed", async () => {
  const r = await miniA.launch(AZIZ);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.authenticated, true);
  assert.equal(r.body.telegram_linked, true);
  assert.equal(r.body.name, "Aziz Karimov");
  assert.equal(r.body.chat_open, true, "the chat is open before any order");
  assert.equal((await miniA.launch(AZIZ)).status, 200);
  const sessions = await q(`select s.source, s.telegram_id from customer_sessions s join users u on u.id = s.user_id where u.telegram_id = '5001'`);
  assert.equal(sessions.length, 1, "a second launch reuses the session");
  assert.equal(sessions[0].source, "telegram");
});

test("forged or stale launch data signs nobody in", async () => {
  const forged = initData({ id: 5001 }).replace("5001", "5009");
  assert.equal((await new Device("f").call("POST", "/customer/telegram", { init_data: forged })).status, 401);
  assert.equal((await new Device("s").launch({ id: 5001 }, Math.floor(Date.now() / 1000) - 7200)).status, 401);
});

test("the customer fills in any number and their flat, saved on their Telegram account", async () => {
  const saved = await miniA.call("PATCH", "/customer/me", { name: "Aziz aka", phone: "+998 93 777 66 55" });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.phone, "998937776655");
  const addresses = await miniA.call("PUT", "/customer/me/addresses", { addresses: [{ dom: "12", xonadon: "5" }] });
  assert.equal(addresses.status, 200);
  // Changing it again is just as free: nothing is verified.
  assert.equal((await miniA.call("PATCH", "/customer/me", { phone: "+998 90 111 22 33" })).body.phone, "998901112233");
  // Another device of the same Telegram account sees the same details.
  const other = await tabletA.launch(AZIZ);
  assert.equal(other.body.name, "Aziz aka");
  assert.deepEqual(other.body.addresses, [{ dom: "12", xonadon: "5" }]);
});

let firstOrderId;
test("orders are taken only in the Mini App", async () => {
  const refused = await placeOrder(browserG, "13-dom, 1-xonadon", "+998 97 123 45 67", "Mehmon");
  assert.equal(refused.status, 403);
  assert.equal(refused.body.telegram_required, true);
  const [orders] = await q(`select count(*)::int as n from orders`);
  assert.equal(orders.n, 0, "nothing stored");
});

test("Telegram Web: with no cookie at all, the session token as a header does everything", async () => {
  const web = new Device("tgweb", { bearerOnly: true });
  const r = await web.launch({ id: 5006, first_name: "Web" });
  assert.equal(r.status, 200);
  assert.equal(web.header(), "", "no cookie is ever sent");
  const me = await web.call("GET", "/customer/me");
  assert.equal(me.body.authenticated, true);
  assert.equal(me.body.name, "Web");
  const order = await placeOrder(web, "70-dom, 7-xonadon", "+998 90 700 70 70", "Web");
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal((await web.call("GET", "/orders")).body.length, 1);
  // A token that is not a session signs nobody in.
  const forged = new Device("forged", { bearerOnly: true });
  forged.token = "f".repeat(64);
  assert.equal((await forged.call("GET", "/customer/me")).body.authenticated, false);
});

test("the first order to a flat is free, whoever places it, and only once", async () => {
  const estimate = await miniA.call("GET", `/orders/delivery-fee?address=${encodeURIComponent("12-dom, 5-xonadon")}`);
  assert.deepEqual(estimate.body, { delivery_fee: 0, is_first_order: true });
  const first = await placeOrder(miniA, "12-dom, 5-xonadon", "+998 90 111 22 33", "Aziz aka");
  assert.equal(first.status, 201);
  assert.equal(Number(first.body.delivery_fee), 0);
  firstOrderId = first.body.id;

  // Another Telegram account, another number, the same flat: it pays.
  assert.equal((await miniB.launch({ id: 5002, first_name: "Qo‘shni" })).status, 200);
  const again = await placeOrder(miniB, "12-dom, 5-xonadon", "+998 99 000 00 01", "Qo‘shni");
  assert.equal(Number(again.body.delivery_fee), 4590);
  // Spelled differently it is still the same flat.
  const spelled = await placeOrder(miniB, " 12 dom 5 xonadon", "+998 99 000 00 01", "Qo‘shni");
  assert.equal(Number(spelled.body.delivery_fee), 4590);
  // The same account ordering to a new flat gets that flat's free delivery.
  const otherFlat = await placeOrder(miniA, "12-dom, 6-xonadon", "+998 90 111 22 33", "Aziz aka");
  assert.equal(Number(otherFlat.body.delivery_fee), 0);
});

test("a cancelled first order gives the flat its free delivery back", async () => {
  const flat = encodeURIComponent("50-dom, 9-xonadon");
  const order = await placeOrder(miniB, "50-dom, 9-xonadon", "+998 99 000 00 01");
  assert.equal(Number(order.body.delivery_fee), 0);
  assert.equal((await miniB.call("GET", `/orders/delivery-fee?address=${flat}`)).body.is_first_order, false);
  const cancelled = await admin.call("PATCH", `/admin/orders/${order.body.id}/status`, { status: "cancelled" });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal((await miniB.call("GET", `/orders/delivery-fee?address=${flat}`)).body.is_first_order, true);
});

test("the admins are told it is an order, and who placed it in Telegram", async () => {
  const orders = messagesTo(OWNER_CHAT).filter((m) => m.text.includes("YANGI BUYURTMA"));
  assert.ok(orders.length >= 5);
  assert.ok(orders.every((m) => m.text.startsWith("🟢🛒 ") || m.text.startsWith("🟠⏰ ")), "an order is green, a pre-order orange");
  assert.ok(orders.some((m) => plain(m.text).includes("✈️ Aziz Karimov (@aziz_k)")));
  // Each order keeps what was typed for it; the dashboard adds the Telegram identity.
  const list = (await admin.call("GET", "/admin/orders")).body;
  const aziz = list.find((o) => o.customer_name === "Aziz aka" && o.address === "12-dom, 5-xonadon");
  assert.equal(aziz.telegram_username, "aziz_k");
  assert.equal(aziz.telegram_name, "Aziz Karimov");
  assert.equal(aziz.address, "12-dom, 5-xonadon");
  assert.equal(aziz.phone, "998901112233");
});

test("a number a blocked prankster typed blocks nobody else", async () => {
  const prankster = new Device("prankster");
  assert.equal((await prankster.launch({ id: 5007, first_name: "Hazil" })).status, 200);
  assert.equal((await placeOrder(prankster, "80-dom, 8-xonadon", "+998 90 888 88 88", "Hazil")).status, 201);
  const [row] = await q(`select id from users where telegram_id = '5007'`);
  assert.equal((await admin.call("POST", `/admin/customers/${row.id}/block`, { reason: "hazil" })).status, 200);
  assert.equal((await placeOrder(prankster, "80-dom, 8-xonadon", "+998 90 999 99 99", "Hazil")).status, 403, "the prankster is out");
  // The real owner of that number orders in peace.
  const owner = new Device("owner");
  assert.equal((await owner.launch({ id: 5008, first_name: "Egasi" })).status, 200);
  assert.equal((await placeOrder(owner, "81-dom, 1-xonadon", "+998 90 888 88 88", "Egasi")).status, 201);
  // And the prankster's flat is no one's ban either.
  assert.equal((await placeOrder(owner, "80-dom, 8-xonadon", "+998 90 888 88 88", "Egasi")).status, 201);
});

let threadA;
test("writing in the Mini App reaches the admins as a chat and the customer's bot", async () => {
  // 5004 has never ordered: the chat is open anyway.
  const newcomer = new Device("newcomer");
  assert.equal((await newcomer.launch({ id: 5004, first_name: "Yangi" })).status, 200);
  assert.equal((await newcomer.call("POST", "/chat/session", {})).status, 200);
  assert.equal((await newcomer.call("POST", "/chat/messages", { body: "Non bormi?" })).status, 201);
  const note = lastTo(OWNER_CHAT);
  assert.match(plain(note.text), /^🔵💬 CHAT · Suhbat #\d+/);
  assert.match(plain(note.text), /Hali buyurtma bermagan/);
  assert.match(plain(note.text), /📱 Mini App orqali yozdi/);
  const echo = lastTo(5004);
  assert.doesNotMatch(plain(note.text), /@\w/, "no @username, none shown");
  assert.match(plain(echo.text), /Siz yozdingiz\s+Non bormi\?/);
  assert.match(echo.text, /<blockquote>Non bormi\?<\/blockquote>/, "the customer's words in a quote");
  assert.equal(echo.disable_notification, true, "a copy of their own words does not ring");

  const opened = await miniA.call("POST", "/chat/session", {});
  threadA = opened.body.thread_id;
  assert.equal(miniA.cookies.has("qorasuv_chat_session"), false, "no separate chat cookie");
  assert.equal((await miniA.call("POST", "/chat/messages", { body: "Buyurtmam qachon keladi?" })).status, 201);
  const buyerNote = plain(lastTo(OWNER_CHAT).text);
  assert.match(buyerNote, /🛍 Buyurtmachi · \d+ ta buyurtma/);
  assert.match(buyerNote, /✈️ Aziz Karimov \(@aziz_k\)/);
  assert.match(buyerNote, /👤 Aziz aka/, "the account's current name");
  const [row] = await q(`select m.session_id, s.user_agent from chat_messages m join customer_sessions s on s.id = m.session_id order by m.id desc limit 1`);
  assert.match(row.user_agent, /miniA/);
});

test("writing to the bot lands in the same conversation, and the answer reaches both", async () => {
  await writeToBot(5001, "Botdan ham yozaman");
  assert.match(plain(lastTo(OWNER_CHAT).text), /🤖 Telegram bot orqali yozdi/);
  const reply = await admin.call("POST", `/admin/chats/${threadA}/messages`, { body: "10 daqiqada yetadi" });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.match(plain(lastTo(5001).text), /10 daqiqada yetadi/, "the answer reaches the bot");
  const transcript = await miniA.call("GET", "/chat/messages");
  assert.deepEqual(transcript.body.messages.map((m) => m.body), ["Buyurtmam qachon keladi?", "Botdan ham yozaman", "10 daqiqada yetadi"]);
});

test("a Telegram user who only ever wrote to the bot becomes a customer", async () => {
  await writeToBot(6001, "Salom, yetkazib berasizmi?", "Dilshod", "dilshod_uz");
  const [user] = await q(`select id, name, telegram_name, telegram_username from users where telegram_id = '6001'`);
  assert.equal(user.name, "Dilshod");
  assert.equal(user.telegram_username, "dilshod_uz");
  const chats = (await admin.call("GET", "/admin/chats")).body;
  const theirs = chats.find((c) => c.telegram_username === "dilshod_uz");
  assert.equal(theirs.telegram_name, "Dilshod");
  assert.match(plain(lastTo(OWNER_CHAT).text), /👤 Dilshod/);
  // Opening the shop later shows the same account and conversation.
  const later = new Device("dilshod");
  assert.equal((await later.launch({ id: 6001, first_name: "Dilshod" })).status, 200);
  const transcript = await later.call("GET", "/chat/messages");
  assert.deepEqual(transcript.body.messages.map((m) => m.body), ["Salom, yetkazib berasizmi?"]);
});

test("five messages a minute per customer, from the Mini App and the bot together", async () => {
  const chatty = new Device("chatty");
  assert.equal((await chatty.launch({ id: 5009, first_name: "Ko‘p" })).status, 200);
  await chatty.call("POST", "/chat/session", {});
  for (let i = 1; i <= 3; i++) assert.equal((await chatty.call("POST", "/chat/messages", { body: `xabar ${i}` })).status, 201);
  await writeToBot(5009, "xabar 4");
  await writeToBot(5009, "xabar 5");
  assert.equal((await chatty.call("POST", "/chat/messages", { body: "xabar 6" })).status, 429);
  await writeToBot(5009, "xabar 7");
  assert.match(plain(lastTo(5009).text), /Juda ko‘p xabar/);
  const stored = await q(`select count(*)::int as n from chat_messages m join chat_threads t on t.id = m.thread_id join users u on u.id = t.user_id where u.telegram_id = '5009'`);
  assert.equal(stored[0].n, 5);
});

test("groups and channels are not read, and the bot leaves them", async () => {
  const before = (await q(`select count(*)::int as n from chat_messages`))[0].n;
  await sendUpdate({ chat: { id: -1009876, type: "supergroup" }, from: { id: 5001 }, text: "salom guruhdan" });
  assert.equal((await q(`select count(*)::int as n from chat_messages`))[0].n, before, "nothing stored");
  const left = botCalls().filter((c) => c.method === "leaveChat");
  assert.equal(String(left.at(-1).body.chat_id), "-1009876");
});

test("a guest in a browser is sent to Telegram for the chat", async () => {
  const me = await browserG.call("GET", "/customer/me");
  assert.equal(me.body.authenticated, false, "a browser that could not order has no account");
  assert.equal(me.body.chat_open, false);
  assert.equal((await browserG.call("POST", "/chat/session", {})).status, 403);
  const link = await browserG.call("GET", "/customer/login");
  assert.deepEqual(link.body, { url: "https://t.me/Q_express_bot" });
});

let customerId;
let sessions;
test("the dashboard lists a customer's devices", async () => {
  const list = await admin.call("GET", "/admin/customers");
  const aziz = list.body.find((c) => c.name === "Aziz aka");
  customerId = aziz.id;
  assert.equal(aziz.telegram_linked, true);
  assert.equal(aziz.active_sessions, 2, "phone and tablet");
  sessions = (await admin.call("GET", `/admin/customers/${customerId}/sessions`)).body;
  assert.equal(sessions.length, 2);
  assert.ok(sessions.every((s) => s.source === "telegram" && s.current));
});

test("signing a device out ends that device only, until Telegram signs it in again", async () => {
  const tablet = sessions.find((s) => s.user_agent.startsWith("miniA-tablet"));
  const r = await admin.call("POST", `/admin/customer-sessions/${tablet.id}/revoke`);
  assert.equal(r.body.current, false);
  assert.equal((await miniA.call("GET", "/customer/me")).body.authenticated, true, "the phone stays in");
  // The signed-out Mini App is told its session is gone, signs in again by
  // Telegram's launch data (as the checkout does), and the order goes through.
  const refused = await placeOrder(tabletA, "90-dom, 9-xonadon", "+998 90 111 22 33", "Aziz aka");
  assert.equal(refused.status, 403);
  assert.equal(refused.body.telegram_required, true);
  const oldToken = tabletA.token;
  assert.equal((await tabletA.launch(AZIZ)).status, 200);
  assert.notEqual(tabletA.token, oldToken, "a new session");
  assert.equal((await placeOrder(tabletA, "90-dom, 9-xonadon", "+998 90 111 22 33", "Aziz aka")).status, 201);
});

test("a blocked Mini App device refuses its Telegram account everywhere until lifted", async () => {
  const phone = sessions.find((s) => s.user_agent.startsWith("miniA ("));
  const r = await admin.call("POST", `/admin/customer-sessions/${phone.id}/block`, { reason: "test" });
  assert.equal(r.body.blocked, true);
  assert.equal(r.body.blocked_by, "Shoxrux");
  assert.equal((await miniA.call("GET", "/customer/me")).body.blocked, true);
  assert.equal((await placeOrder(miniA, "12-dom, 5-xonadon")).status, 403);
  assert.equal((await miniA.call("POST", "/chat/messages", { body: "x" })).status, 403);
  assert.equal((await new Device("fresh").launch(AZIZ)).status, 403);
  await writeToBot(5001, "meni blokladingizmi?");
  assert.match(plain(lastTo(5001).text), /bloklangan/);
  await admin.call("DELETE", `/admin/customer-sessions/${phone.id}/block`);
  assert.equal((await miniA.call("GET", "/customer/me")).body.blocked, false);
});

test("another Telegram account on the same phone gets its own session", async () => {
  const r = await miniA.launch({ id: 5005, first_name: "Opa" });
  assert.equal(r.body.name, "Opa");
  assert.deepEqual(r.body.addresses, [], "not the first account's details");
  const back = await miniA.launch(AZIZ);
  assert.equal(back.body.name, "Aziz aka", "switching back works");
});

test("a blocked customer is refused in the Mini App and in the bot", async () => {
  assert.equal((await admin.call("POST", `/admin/customers/${customerId}/block`, { reason: "x" })).status, 200);
  assert.equal((await new Device("n").launch(AZIZ)).status, 403);
  const before = (await q(`select count(*)::int as n from chat_messages`))[0].n;
  await writeToBot(5001, "salom");
  assert.equal((await q(`select count(*)::int as n from chat_messages`))[0].n, before, "nothing stored");
  await admin.call("DELETE", `/admin/customers/${customerId}/block`);
});

test("signing out keeps the device on record as ended", async () => {
  const browserD = new Device("browserD");
  await browserD.call("PATCH", "/customer/me", { name: "Dilnoza" });
  assert.equal((await browserD.call("POST", "/customer/logout")).body.authenticated, false);
  const [row] = await q(`select revoked_at, revoked_by from customer_sessions where user_agent like 'browserD%'`);
  assert.ok(row.revoked_at);
  assert.equal(row.revoked_by, null);
});

test("only a super admin may block a device", async () => {
  const anyId = sessions[0].id;
  const temp = "Vaqtinchalik-2026";
  const created = await admin.call("POST", "/admin/admins", { username: "oddiy", display_name: "Oddiy", role: "admin", temporary_password: temp });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const plainAdmin = new Device("plain");
  assert.equal((await plainAdmin.call("POST", "/admin/auth", { username: "oddiy", password: temp })).status, 200);
  await plainAdmin.call("POST", "/admin/me/password", { current_password: temp, new_password: "Oddiy-Admin-Password-2026" });
  await plainAdmin.call("POST", "/admin/auth", { username: "oddiy", password: "Oddiy-Admin-Password-2026" });
  assert.equal((await plainAdmin.call("POST", `/admin/customer-sessions/${anyId}/block`, {})).status, 403);
  assert.equal((await plainAdmin.call("POST", `/admin/customer-sessions/${anyId}/revoke`)).status, 200, "any admin may sign a device out");
});

test("a comment on a delivered order reaches the admins through the bot and is kept nowhere", async () => {
  const order = await placeOrder(miniA, "33-dom, 3-xonadon", "+998 90 111 22 33", "Aziz aka");
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const comment = "Non issiq keldi, kuryer juda xushmuomala <rahmat>";
  const write = (device, text = comment, id = order.body.id) => device.call("POST", `/orders/${id}/feedback`, { text });

  assert.equal((await write(miniA)).status, 409, "not before it is delivered");
  for (const status of ["preparing", "courier", "delivered"]) {
    assert.equal((await admin.call("PATCH", `/admin/orders/${order.body.id}/status`, { status })).status, 200);
  }
  // Only its own customer, and only in the Mini App.
  assert.equal((await write(miniB)).status, 404, "somebody else's order");
  assert.equal((await write(new Device("anon"))).status, 403, "a browser");
  assert.equal((await write(miniA, "   ")).status, 400, "an empty comment");

  const sent = await write(miniA);
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual(sent.body, { sent: true });
  const note = plain(lastTo(OWNER_CHAT).text);
  assert.match(note, new RegExp(`^🟡⭐ IZOH · Buyurtma #${order.body.order_number}`));
  assert.match(note, /👤 Aziz aka · \+998 90 111 22 33/);
  assert.match(note, /✈️ Aziz Karimov \(@aziz_k\)/);
  assert.match(note, /📍 33-dom, 3-xonadon/);
  assert.ok(note.includes("Non issiq keldi, kuryer juda xushmuomala &lt;rahmat&gt;"), "the comment itself, escaped for Telegram");

  // Nothing of it is in the database.
  const { rows } = await pool.query(`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb')`);
  for (const { table_name, column_name } of rows) {
    const [hit] = await q(`select count(*)::int as n from "${table_name}" where "${column_name}"::text like $1`, ["%kuryer juda xushmuomala%"]);
    assert.equal(hit.n, 0, `${table_name}.${column_name}`);
  }

  // Three a day per order.
  assert.equal((await write(miniA, "ikkinchi")).status, 200);
  assert.equal((await write(miniA, "uchinchi")).status, 200);
  assert.equal((await write(miniA, "to‘rtinchi")).status, 429);
});

test("a piece order tells the admins how many, in Telegram and on the dashboard", async () => {
  const [product] = await q(`select id, name, unit from products where active and stock > 10 and unit in ('dona','qadoq') order by id limit 1`);
  const order = await miniA.call("POST", "/orders", {
    customer_name: "Aziz aka",
    phone: "+998 90 111 22 33",
    address: "34-dom, 4-xonadon",
    payment_method: "cash",
    items: [{ product_id: product.id, quantity: 3 }],
  });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const note = plain(lastTo(OWNER_CHAT).text).replace(/\s/g, " ");
  assert.ok(note.includes(`▫️ ${product.name} — 3 ${product.unit} × `), note);
  assert.match(note, /To‘lov: 💵 Naqd/);
  const listed = (await admin.call("GET", "/admin/orders")).body.find((o) => o.id === order.body.id);
  assert.equal(listed.items[0].quantity, 3);
  assert.equal(listed.items[0].unit, product.unit);
});

test("a device block holds the Telegram account on its other devices, shows on the card, and lifting the customer's block lifts it", async () => {
  const sessionsNow = (await admin.call("GET", `/admin/customers/${customerId}/sessions`)).body;
  const phone = sessionsNow.find((s) => s.user_agent.startsWith("miniA (") && s.current);
  assert.ok(phone, "the phone's live session");
  assert.equal((await admin.call("POST", `/admin/customer-sessions/${phone.id}/block`, { reason: "boshqa qurilma" })).status, 200);
  // The tablet was never blocked itself, yet it is the same Telegram account.
  assert.equal((await tabletA.call("GET", "/customer/me")).body.blocked, true);
  assert.equal((await placeOrder(tabletA, "35-dom, 5-xonadon", "+998 90 111 22 33", "Aziz aka")).status, 403);
  assert.equal((await tabletA.call("POST", "/chat/messages", { body: "x" })).status, 403);
  const card = (await admin.call("GET", "/admin/customers")).body.find((c) => c.id === customerId);
  assert.equal(card.blocked, true, "the card says so");
  assert.equal(card.blocked_devices, 1);
  // The chat list says so too, without stopping the admins from answering.
  const thread = (await admin.call("GET", "/admin/chats")).body.find((c) => c.id === threadA);
  assert.equal(thread.device_blocked, true);
  assert.equal(thread.customer_blocked, false);
  // And the weekly leaderboard leaves them out.
  const board = (await new Device("board").call("GET", "/leaderboard/weekly")).body;
  assert.ok(!board.some((entry) => entry.phone_masked.endsWith("22 33") || entry.phone_masked.endsWith("2233")), JSON.stringify(board));
  // "Blokdan chiqarish" on the card lifts the device block too.
  assert.equal((await admin.call("DELETE", `/admin/customers/${customerId}/block`)).status, 200);
  const after = (await admin.call("GET", "/admin/customers")).body.find((c) => c.id === customerId);
  assert.equal(after.blocked, false);
  assert.equal(after.blocked_devices, 0);
  assert.equal((await tabletA.call("GET", "/customer/me")).body.blocked, false);
  const boardAfter = (await new Device("board2").call("GET", "/leaderboard/weekly")).body;
  assert.ok(boardAfter.some((entry) => entry.phone_masked.endsWith("2233")), "back on the leaderboard: " + JSON.stringify(boardAfter));
});

test("leading zeros do not make a flat new again", async () => {
  const first = await placeOrder(miniA, "36-dom, 6-xonadon", "+998 90 111 22 33", "Aziz aka");
  assert.equal(Number(first.body.delivery_fee), 0);
  const padded = await placeOrder(miniA, "036-dom, 06-xonadon", "+998 90 111 22 33", "Aziz aka");
  assert.equal(Number(padded.body.delivery_fee), 4590);
});

test("an address too long for one Telegram message is refused", async () => {
  const long = `12-dom, 5-xonadon ${"x".repeat(300)}`;
  const r = await placeOrder(miniA, long, "+998 90 111 22 33", "Aziz aka");
  assert.equal(r.status, 400);
});
