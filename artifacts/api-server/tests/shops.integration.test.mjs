// End-to-end check of several shops on one platform: a Q express super admin
// creates a shop with its own bot and first super admin; the shop's admins
// see and change only their shop; the storefront asks about one shop at a
// time; an order belongs to one shop, is numbered with its prefix, charged its
// fee and announced through its bot to its admins only; the chat, blocks and
// the storefront card are per shop.
//
// It needs a migrated database where the seeded super admin "bahrom" has not
// chosen a password yet (a throwaway local cluster, fresh or after the
// sign-in test). On any other database it is skipped. Telegram is stubbed.
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
const QE_TOKEN = "424242:flow-test-token";
const SHOP_TOKEN = "777001:AAshop-bot-token-for-the-integration-test";
const SESSION_SECRET = "shops-test-session-secret";
const ADMIN_CODE = "shops-admin-code";
const QE_OWNER_CHAT = "5550001";
const SHOP_OWNER_CHAT = "6660001";
const PORT = 19556;
const BASE = `http://127.0.0.1:${PORT}/api`;
const LOG = join(mkdtempSync(join(tmpdir(), "qe-shops-")), "telegram-calls.log");

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const require = createRequire(import.meta.url);
const pg = require(require.resolve("pg", { paths: [resolve(repoRoot, "lib/db")] }));
const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL }) : undefined;
const q = async (text, values = []) => (await pool.query(text, values)).rows;

async function canRun() {
  if (!pool) return false;
  try {
    const [admin] = await q(`select password_hash from admins where username = 'bahrom'`);
    const [shops] = await q(`select count(*)::int as n from shops`);
    return Boolean(admin) && admin.password_hash === null && shops.n === 1;
  } catch {
    return false;
  }
}
const runnable = await canRun();
const test = runnable
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "needs a migrated test database where bahrom has no password yet" }, fn);

class Client {
  constructor(name) { this.name = name; this.cookies = new Map(); this.token = null; this.headers = {}; }
  async call(method, path, body) {
    const headers = { "content-type": "application/json", cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "), "user-agent": `${this.name} Chrome/130`, ...this.headers };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
  async launch(user, token) {
    const r = await this.call("POST", "/customer/telegram", { init_data: initData(user, token) });
    if (r.status === 200) this.token = r.body.session_token;
    return r;
  }
}

function initData(user, token) {
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: "AAE", user: JSON.stringify(user) };
  const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const secretFor = (token) => createHmac("sha256", SESSION_SECRET).update(`telegram-webhook:${token}`).digest("hex");
let updateId = 1;
async function webhook(path, token, message) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secretFor(token) },
    body: JSON.stringify({ update_id: updateId, message: { message_id: updateId++, ...message } }),
  });
  return response.status;
}

const calls = () => readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const sentBy = (bot, chatId) => calls().filter((c) => c.bot === bot && c.method === "sendMessage" && String(c.body.chat_id) === String(chatId)).map((c) => c.body);

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}

let server;
before(async () => {
  if (!runnable) return;
  writeFileSync(LOG, "");
  await q(`update shops set open_time = '00:00', close_time = '00:00', accepting_orders = true where id = 1`);
  server = spawn(process.execPath, ["--import", pathToFileURL(join(here, "telegram-stub.mjs")).href, resolve(here, "../dist/index.mjs")], {
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      TELEGRAM_BOT_MODE: "legacy",
      TELEGRAM_BOT_TOKEN: QE_TOKEN,
      TELEGRAM_ADMIN_CHAT_ID: QE_OWNER_CHAT,
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

const platform = new Client("platform");
const owner = new Client("shop-owner");
const customer = new Client("customer");
const customerUser = { id: 9100001, first_name: "Dilnoza", username: "dilnoza" };
const state = {};

test("a Q express super admin runs the platform", async () => {
  const setup = await platform.call("POST", "/admin/setup", { username: "bahrom", access_code: ADMIN_CODE, new_password: "Platform-pass-2026" });
  assert.equal(setup.status, 200);
  assert.equal(setup.body.admin.platform_super_admin, true);
  assert.equal(setup.body.shop.slug, "qexpress");
  // The demo catalog of Q express.
  assert.ok((await platform.call("GET", "/categories")).body.length > 0);
});

test("a shop is created with its own bot and first super admin", async () => {
  const base = {
    name: "Oila Market", slug: "oila-market", order_prefix: "OM", owner_chat_id: SHOP_OWNER_CHAT,
    open_time: "00:00", close_time: "00:00", delivery_fee: 7000, free_first_delivery: false,
    card: { uz: "<p><strong>Oila Market</strong></p>" },
    super_admin: { username: "aziz", display_name: "Aziz", role: "super_admin", temporary_password: "temp-pass-aziz-1" },
  };
  assert.equal((await platform.call("POST", "/admin/shops", { ...base, bot_token: "not-a-token" })).status, 400, "a token of the wrong shape");
  assert.equal((await platform.call("POST", "/admin/shops", { ...base, bot_token: "777002:unknown-token-unknown-token-unknown" })).status, 400, "a token Telegram does not know");
  assert.equal((await platform.call("POST", "/admin/shops", { ...base, bot_token: "424242:AAqexpress-bot-token-used-for-testing" })).status, 400, "Q express's own bot");
  const created = await platform.call("POST", "/admin/shops", { ...base, bot_token: SHOP_TOKEN });
  assert.equal(created.status, 201);
  assert.equal(created.body.shop.bot_username, "bot777001_bot");
  assert.equal(created.body.admin.role, "super_admin");
  assert.equal(created.body.admin.must_change_password, true);
  state.shopId = created.body.shop.id;
  // The token is stored encrypted, never as typed.
  const [row] = await q(`select bot_token_enc from shops where id = $1`, [state.shopId]);
  assert.ok(row.bot_token_enc.startsWith("v1."));
  assert.ok(!row.bot_token_enc.includes(SHOP_TOKEN));
  // The bot is connected after the answer, so a slow Telegram cannot cut off
  // the one reply that shows the temporary password. Its status says when.
  let listed;
  for (let i = 0; i < 50; i++) {
    listed = (await platform.call("GET", "/admin/shops")).body.find((s) => s.id === state.shopId);
    if (listed.bot_status !== "connecting") break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.equal(listed.bot_status, "connected");
  assert.equal(listed.bot_error, null);
  // Telegram was told where the shop's bot is answered.
  const hook = calls().find((c) => c.bot === 777001 && c.method === "setWebhook");
  assert.match(hook.body.url, new RegExp(`/api/telegram/webhook/${state.shopId}$`));
  assert.equal(hook.body.secret_token, secretFor(SHOP_TOKEN));
  // It has no Mini App of its own: its menu button stays Telegram's default.
  const menu = calls().find((c) => c.bot === 777001 && c.method === "setChatMenuButton");
  assert.deepEqual(menu.body.menu_button, { type: "default" });
  // Taken slug and taken bot.
  assert.equal((await platform.call("POST", "/admin/shops", { ...base, order_prefix: "OX", bot_token: "777003:AAanother-bot-token-for-the-test-xx", super_admin: { ...base.super_admin, username: "other" } })).status, 409);
  assert.equal((await platform.call("POST", "/admin/shops", { ...base, slug: "boshqa", order_prefix: "BX", bot_token: SHOP_TOKEN, super_admin: { ...base.super_admin, username: "other2" } })).status, 400);
});

test("the shop's super admin works in their own shop only", async () => {
  assert.equal((await owner.call("POST", "/admin/auth", { username: "aziz", password: "temp-pass-aziz-1" })).status, 200);
  assert.equal((await owner.call("GET", "/admin/categories")).status, 403, "the temporary password first");
  const changed = await owner.call("POST", "/admin/me/password", { current_password: "temp-pass-aziz-1", new_password: "Aziz-own-pass-77" });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.admin.platform_super_admin, false);
  assert.equal(changed.body.shop.slug, "oila-market");
  // A new shop starts empty: none of Q express's catalog.
  assert.deepEqual((await owner.call("GET", "/admin/categories")).body, []);
  const category = await owner.call("POST", "/admin/categories", { name: "Sut", slug: "sut", icon: "milk" });
  assert.equal(category.status, 201, "the same slug as Q express's dairy is fine in another shop");
  const product = await owner.call("POST", "/admin/products", {
    category_id: category.body.id, name: "Oila sut", description: "1 litr", image_url: "https://example.com/milk.jpg",
    price: 12000, unit: "dona", stock: 10,
  });
  assert.equal(product.status, 201);
  assert.equal(product.body.shop_id, state.shopId);
  state.shopProduct = product.body.id;
  const qeProduct = (await platform.call("GET", "/products")).body[0];
  state.qeProduct = qeProduct.id;
  // Q express's catalog is out of reach, even by naming another shop.
  owner.headers = { "x-admin-shop": "1" };
  assert.ok((await owner.call("GET", "/admin/products")).body.every((p) => p.id !== state.qeProduct));
  owner.headers = {};
  assert.equal((await owner.call("PATCH", `/admin/products/${state.qeProduct}`, { price: 1 })).status, 404);
  assert.equal((await owner.call("POST", "/admin/products", { category_id: (await platform.call("GET", "/categories")).body[0].id, name: "X", description: "x", image_url: "https://example.com/x.jpg", price: 1, unit: "dona", stock: 1 })).status, 400, "a Q express category");
  // Its own admins, not the platform's.
  const admin = await owner.call("POST", "/admin/admins", { username: "kassir", display_name: "Kassir", role: "admin", temporary_password: "kassir-temp-1" });
  assert.equal(admin.status, 201);
  assert.equal(admin.body.shop_id, state.shopId);
  const admins = (await owner.call("GET", "/admin/admins")).body.map((a) => a.username).sort();
  assert.deepEqual(admins, ["aziz", "kassir"]);
  // The fee is the platform's to set; the hours and pausing are the shop's
  // too. The hours go back to all day for the orders below.
  assert.equal((await owner.call("PATCH", `/admin/shops/${state.shopId}`, { delivery_fee: 1 })).status, 403);
  const hours = await owner.call("PUT", "/admin/store-hours", { open_time: "09:00", close_time: "18:00", accepting_orders: true });
  assert.equal(hours.status, 200);
  assert.equal(hours.body.open_time, "09:00");
  assert.equal((await owner.call("PUT", "/admin/store-hours", { open_time: "00:00", close_time: "00:00", accepting_orders: false })).body.accepting_orders, false);
  assert.equal((await owner.call("PUT", "/admin/store-hours", { open_time: "00:00", close_time: "00:00", accepting_orders: true })).body.accepting_orders, true);
  // Its admin links Telegram through the shop's bot.
  assert.match((await owner.call("POST", "/admin/me/telegram")).body.url, /^https:\/\/t\.me\/bot777001_bot\?start=/);
});

test("a bot that did not connect is connected again by a platform super admin", async () => {
  const again = await platform.call("POST", `/admin/shops/${state.shopId}/bot`);
  assert.equal(again.status, 200);
  assert.equal(again.body.bot_status, "connected");
  assert.equal((await owner.call("POST", `/admin/shops/${state.shopId}/bot`)).status, 403);
  assert.equal((await platform.call("POST", "/admin/shops/999999/bot")).status, 404);
});

test("a platform super admin acts inside any shop", async () => {
  platform.headers = { "x-admin-shop": String(state.shopId) };
  const products = (await platform.call("GET", "/admin/products")).body;
  assert.deepEqual(products.map((p) => p.id), [state.shopProduct]);
  platform.headers = {};
  const updated = await platform.call("PATCH", `/admin/shops/${state.shopId}`, { delivery_fee: 7000, free_first_delivery: false });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.delivery_fee, 7000);
});

test("the storefront asks about one shop at a time", async () => {
  const shops = (await customer.call("GET", "/shops")).body;
  assert.deepEqual(shops.map((s) => s.slug), ["qexpress", "oila-market"]);
  assert.equal(shops[1].delivery_fee, 7000);
  assert.equal(shops[1].card.uz, "<p><strong>Oila Market</strong></p>");
  assert.deepEqual((await customer.call("GET", "/products?shop=oila-market")).body.map((p) => p.id), [state.shopProduct]);
  assert.ok((await customer.call("GET", "/products")).body.every((p) => p.shop_id === 1));
  assert.equal((await customer.call("GET", "/categories?shop=oila-market")).body.length, 1);
  assert.equal((await customer.call("GET", "/categories?shop=yoq")).status, 404);
  assert.equal((await customer.call("GET", "/store/status?shop=oila-market")).body.open_now, true);
});

test("only Q express's bot opens the Mini App; a shop's bot links to it", async () => {
  // The shop's owner holds its token and could sign launch data for anybody.
  const forged = new Client("forger");
  assert.equal((await forged.launch(customerUser, SHOP_TOKEN)).status, 401);
  assert.equal((await customer.launch(customerUser, QE_TOKEN)).status, 200);
  // /start in the shop's bot: a welcome naming the shop, its buttons opening
  // Q express's Mini App at the shop's pages.
  const before = calls().length;
  assert.equal(await webhook(`/telegram/webhook/${state.shopId}`, SHOP_TOKEN, { chat: { id: 9100002, type: "private" }, from: { id: 9100002, first_name: "Ali" }, text: "/start" }), 200);
  const welcome = calls().slice(before).find((c) => c.bot === 777001 && c.method === "sendMessage");
  assert.match(welcome.body.text, /Oila Market/);
  const buttons = welcome.body.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.every((b) => !b.web_app));
  assert.deepEqual(buttons.map((b) => b.url), [
    "https://t.me/Q_express_bot?startapp=oila-market",
    "https://t.me/Q_express_bot?startapp=oila-market__deals",
    "https://t.me/Q_express_bot?startapp=oila-market__orders",
  ]);
});

test("a shop does not learn the saved name and phone from its chat before an order", async () => {
  // The widget sends the profile saved on the device; an old page sends it to
  // every shop.
  const opened = await customer.call("POST", "/chat/session?shop=oila-market", { name: "Dilnoza", phone: "+998 90 111 22 33" });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.customer_name, "");
  assert.equal(opened.body.phone, "");
  const [thread] = await q(`select customer_name, phone from chat_threads where id = $1`, [opened.body.thread_id]);
  assert.deepEqual(thread, { customer_name: "", phone: "" });
  // Opening it again with the details changes nothing either.
  assert.equal((await customer.call("POST", "/chat/session?shop=oila-market", { name: "Dilnoza", phone: "+998 90 111 22 33" })).body.customer_name, "");
});

const order = (productId) => ({
  customer_name: "Dilnoza", phone: "+998 90 111 22 33", address: "7-dom, 12-xonadon", payment_method: "cash",
  items: [{ product_id: productId, quantity: 1 }],
});

test("an order belongs to one shop, its number, its fee and its bot", async () => {
  const mixed = await customer.call("POST", "/orders", { ...order(state.shopProduct), items: [{ product_id: state.shopProduct, quantity: 1 }, { product_id: state.qeProduct, quantity: 1 }] });
  assert.equal(mixed.status, 400, "two shops in one order");
  assert.equal((await customer.call("GET", "/orders/delivery-fee?shop=oila-market&address=7-dom%2C%2012-xonadon")).body.delivery_fee, 7000);
  const before = calls().length;
  const shopOrder = await customer.call("POST", "/orders", order(state.shopProduct));
  assert.equal(shopOrder.status, 201);
  assert.match(shopOrder.body.order_number, /^OM-\d{7}$/);
  assert.equal(shopOrder.body.shop_id, state.shopId);
  assert.equal(shopOrder.body.delivery_fee, 7000, "this shop has no free first delivery");
  state.shopOrder = shopOrder.body.id;
  const announced = calls().slice(before).filter((c) => c.method === "sendMessage");
  assert.ok(announced.some((c) => c.bot === 777001 && String(c.body.chat_id) === SHOP_OWNER_CHAT && c.body.text.includes("YANGI BUYURTMA")));
  assert.ok(!announced.some((c) => c.bot === 424242), "Q express's bot says nothing about another shop's order");
  const qeOrder = await customer.call("POST", "/orders", order(state.qeProduct));
  assert.equal(qeOrder.status, 201);
  assert.match(qeOrder.body.order_number, /^QE-\d{7}$/);
  assert.equal(qeOrder.body.delivery_fee, 0, "Q express's first delivery to the flat is free");
  state.qeOrder = qeOrder.body.id;
  assert.ok(sentBy(424242, QE_OWNER_CHAT).some((m) => m.text.includes(qeOrder.body.order_number)));
  assert.ok(!sentBy(777001, SHOP_OWNER_CHAT).some((m) => m.text.includes(qeOrder.body.order_number)));
  const mine = (await customer.call("GET", "/orders")).body;
  assert.deepEqual(mine.map((o) => o.shop_name).sort(), ["Oila Market", "Q express"]);
});

test("each shop's admins see only their orders", async () => {
  assert.deepEqual((await owner.call("GET", "/admin/orders")).body.map((o) => o.id), [state.shopOrder]);
  assert.ok(!(await platform.call("GET", "/admin/orders")).body.some((o) => o.id === state.shopOrder));
  assert.equal((await owner.call("PATCH", `/admin/orders/${state.qeOrder}/status`, { status: "preparing" })).status, 404);
  assert.equal((await owner.call("PATCH", `/admin/orders/${state.shopOrder}/status`, { status: "preparing" })).status, 200);
  assert.equal((await owner.call("GET", "/admin/dashboard")).body.new_orders, 0);
});

test("the chat is one conversation per shop, through its bot", async () => {
  assert.equal((await customer.call("POST", "/chat/session?shop=oila-market", {})).status, 200);
  const sent = await customer.call("POST", "/chat/messages?shop=oila-market", { body: "Sut yangimi?" });
  assert.equal(sent.status, 201);
  assert.ok(sentBy(777001, SHOP_OWNER_CHAT).some((m) => m.text.includes("Sut yangimi?")));
  assert.ok(!sentBy(424242, QE_OWNER_CHAT).some((m) => m.text.includes("Sut yangimi?")));
  assert.equal((await customer.call("GET", "/chat/messages")).status, 404, "no conversation with Q express yet");
  const shopChats = (await owner.call("GET", "/admin/chats")).body;
  assert.equal(shopChats.length, 1);
  assert.ok(!(await platform.call("GET", "/admin/chats")).body.some((c) => c.id === shopChats[0].id));
  // The customer writes to the shop's bot: the same conversation.
  assert.equal(await webhook(`/telegram/webhook/${state.shopId}`, SHOP_TOKEN, { chat: { id: customerUser.id, type: "private" }, from: customerUser, text: "Yana bitta savol" }), 200);
  assert.equal(await webhook("/telegram/webhook", SHOP_TOKEN, { chat: { id: customerUser.id, type: "private" }, from: customerUser, text: "x" }), 401, "Q express's webhook refuses another bot");
  const transcript = (await owner.call("GET", `/admin/chats/${shopChats[0].id}/messages`)).body.messages.map((m) => m.body);
  assert.deepEqual(transcript, ["Sut yangimi?", "Yana bitta savol"]);
  // The shop's answer reaches the customer through the shop's bot.
  assert.equal((await owner.call("POST", `/admin/chats/${shopChats[0].id}/messages`, { body: "Ha, bugungi" })).status, 201);
  const reply = sentBy(777001, customerUser.id).find((m) => m.text.includes("Ha, bugungi"));
  assert.match(reply.text, /Oila Market/);
  assert.equal(reply.reply_markup.inline_keyboard[0][0].url, "https://t.me/Q_express_bot?startapp=oila-market__chat");
  assert.equal((await platform.call("DELETE", `/admin/chats/${shopChats[0].id}`)).status, 404, "only from inside the shop");
  platform.headers = { "x-admin-shop": String(state.shopId) };
  assert.equal((await platform.call("GET", "/admin/chats")).body.length, 1, "a platform super admin reads any shop's chats");
  platform.headers = {};
});

test("a shop blocks a customer for itself alone", async () => {
  const customers = (await owner.call("GET", "/admin/customers")).body;
  assert.equal(customers.length, 1, "only those who ordered from the shop");
  assert.ok(!customers.some((c) => c.telegram_name === "Ali"), "writing to the bot is not ordering");
  assert.equal((await owner.call("GET", `/admin/customers/${customers[0].id}/sessions`)).status, 403, "devices are Q express's");
  const blocked = await owner.call("POST", `/admin/customers/${customers[0].id}/block`, { reason: "test" });
  assert.equal(blocked.body.blocked, true);
  assert.equal((await customer.call("POST", "/orders", order(state.shopProduct))).status, 403);
  assert.equal((await customer.call("POST", "/orders", order(state.qeProduct))).status, 201, "Q express still sells to them");
  const platformView = (await platform.call("GET", "/admin/customers")).body.find((c) => c.id === customers[0].id);
  assert.equal(platformView.blocked, false);
  assert.equal((await owner.call("DELETE", `/admin/customers/${customers[0].id}/block`)).body.blocked, false);
  assert.equal((await customer.call("POST", "/orders", order(state.shopProduct))).status, 201);
});

test("someone who only wrote to the shop is listed by Telegram name alone, and can be blocked", async () => {
  assert.equal(await webhook(`/telegram/webhook/${state.shopId}`, SHOP_TOKEN, { chat: { id: 9100002, type: "private" }, from: { id: 9100002, first_name: "Ali" }, text: "Salom" }), 200);
  const ali = (await owner.call("GET", "/admin/customers")).body.find((c) => c.telegram_name === "Ali");
  assert.ok(ali, "listed, so the shop can block them");
  assert.equal(ali.phone, "");
  assert.equal(ali.name, "");
  assert.deepEqual(ali.addresses, []);
  assert.equal(ali.order_count, 0);
  assert.equal((await owner.call("POST", `/admin/customers/${ali.id}/block`, {})).body.blocked, true);
  assert.equal((await owner.call("DELETE", `/admin/customers/${ali.id}/block`)).body.blocked, false);
});

test("a block by Q express holds in every shop, and only Q express lifts it", async () => {
  const [dilnoza] = await q(`select id from users where telegram_id = $1`, [String(customerUser.id)]);
  assert.equal((await platform.call("POST", `/admin/customers/${dilnoza.id}/block`, {})).status, 200);
  const there = (await owner.call("GET", "/admin/customers")).body.find((c) => c.id === dilnoza.id);
  assert.equal(there.blocked, true);
  assert.equal(there.blocked_everywhere, true);
  assert.equal((await owner.call("DELETE", `/admin/customers/${dilnoza.id}/block`)).status, 409);
  assert.equal((await platform.call("DELETE", `/admin/customers/${dilnoza.id}/block`)).body.blocked, false);
});

test("a Q express super admin blocks and lets back in everywhere from inside any shop", async () => {
  const ali = (await owner.call("GET", "/admin/customers")).body.find((c) => c.telegram_name === "Ali");
  assert.equal((await owner.call("POST", `/admin/customers/${ali.id}/block`, { everywhere: true })).status, 403, "a shop blocks for itself only");
  platform.headers = { "x-admin-shop": String(state.shopId) };
  const blocked = await platform.call("POST", `/admin/customers/${ali.id}/block`, { reason: "spam", everywhere: true });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.body.blocked_everywhere, true);
  assert.equal((await q(`select blocked_at from users where id = $1`, [ali.id]))[0].blocked_at !== null, true);
  assert.equal((await platform.call("DELETE", `/admin/customers/${ali.id}/block`)).status, 409, "the plain unblock is this shop's own");
  const lifted = await platform.call("DELETE", `/admin/customers/${ali.id}/block-everywhere`);
  assert.equal(lifted.status, 200);
  assert.equal(lifted.body.blocked, false);
  platform.headers = {};
  assert.equal((await owner.call("DELETE", `/admin/customers/${ali.id}/block-everywhere`)).status, 403);
});

test("letting back in someone Q express knew only by the block answers null, not an empty body", async () => {
  const ali = (await owner.call("GET", "/admin/customers")).body.find((c) => c.telegram_name === "Ali");
  platform.headers = { "x-admin-shop": String(state.shopId) };
  assert.equal((await platform.call("POST", `/admin/customers/${ali.id}/block`, { everywhere: true })).status, 200);
  platform.headers = {};
  assert.ok((await platform.call("GET", "/admin/customers")).body.some((c) => c.id === ali.id), "listed in Q express while blocked");
  const lifted = await platform.call("DELETE", `/admin/customers/${ali.id}/block`);
  assert.equal(lifted.status, 200);
  assert.equal(lifted.body, null);
  assert.equal((await q(`select blocked_at from users where id = $1`, [ali.id]))[0].blocked_at, null);
});

test("a shop lifting its own block is told when Q express's still holds", async () => {
  const ali = (await owner.call("GET", "/admin/customers")).body.find((c) => c.telegram_name === "Ali");
  assert.equal((await owner.call("POST", `/admin/customers/${ali.id}/block`, {})).status, 200);
  platform.headers = { "x-admin-shop": String(state.shopId) };
  assert.equal((await platform.call("POST", `/admin/customers/${ali.id}/block`, { everywhere: true })).status, 200);
  platform.headers = {};
  const refused = await owner.call("DELETE", `/admin/customers/${ali.id}/block`);
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Do‘kondagi blok olindi/);
  assert.equal((await q(`select 1 from customer_shop_blocks where user_id = $1 and shop_id = $2`, [ali.id, state.shopId])).length, 0);
  platform.headers = { "x-admin-shop": String(state.shopId) };
  assert.equal((await platform.call("DELETE", `/admin/customers/${ali.id}/block-everywhere`)).body.blocked, false);
  platform.headers = {};
});

test("a shop's card is changed by its admins and Q express's", async () => {
  assert.equal((await owner.call("PUT", `/admin/shops/${state.shopId}/card`, { card: { uz: "<p>Yangi</p>", ru: "<p>Новый</p>" } })).status, 200);
  assert.equal((await owner.call("PUT", "/admin/shops/1/card", { card: { uz: "<p>x</p>" } })).status, 403);
  assert.equal((await platform.call("PUT", `/admin/shops/${state.shopId}/card`, { card: { uz: "<p>Q express tuzatdi</p>" } })).status, 200);
  const shop = (await customer.call("GET", "/shops")).body.find((s) => s.slug === "oila-market");
  assert.deepEqual(shop.card, { uz: "<p>Q express tuzatdi</p>" });
  assert.deepEqual((await owner.call("GET", "/admin/shops")).body.map((s) => s.slug), ["oila-market"]);
  assert.equal((await platform.call("GET", "/admin/shops")).body.length, 2);
});

test("a hidden shop leaves the storefront", async () => {
  assert.equal((await platform.call("PATCH", `/admin/shops/${state.shopId}`, { active: false })).status, 200);
  assert.deepEqual((await customer.call("GET", "/shops")).body.map((s) => s.slug), ["qexpress"]);
  assert.equal((await customer.call("GET", "/products?shop=oila-market")).status, 404);
  assert.equal((await customer.call("GET", `/products/${state.shopProduct}`)).status, 404);
  assert.equal((await customer.call("POST", "/orders", order(state.shopProduct))).status, 400);
  assert.equal((await platform.call("PATCH", "/admin/shops/1", { active: false })).status, 400, "Q express stays");
  // Its bot no longer greets or hears customers.
  const before = calls().length;
  assert.equal(await webhook(`/telegram/webhook/${state.shopId}`, SHOP_TOKEN, { chat: { id: 9100003, type: "private" }, from: { id: 9100003, first_name: "Vali" }, text: "/start" }), 200);
  assert.equal(calls().slice(before).filter((c) => c.method === "sendMessage").length, 0);
  // Its admins still see their hours.
  assert.equal((await owner.call("GET", "/admin/shops")).body[0].active, false);
  assert.equal((await platform.call("PATCH", `/admin/shops/${state.shopId}`, { active: true })).status, 200);
});

test("a deleted shop is archived: closed, its admins out, its history kept, and it comes back", async () => {
  assert.equal((await owner.call("POST", `/admin/shops/${state.shopId}/archive`)).status, 403);
  assert.equal((await platform.call("POST", "/admin/shops/1/archive")).status, 400, "Q express stays");
  const before = calls().length;
  const archived = await platform.call("POST", `/admin/shops/${state.shopId}/archive`);
  assert.equal(archived.status, 200);
  assert.ok(archived.body.archived_at);
  assert.equal(archived.body.active, false);
  assert.ok(calls().slice(before).some((c) => c.bot === 777001 && c.method === "deleteWebhook"), "its bot is told to stop");
  // Gone from the storefront.
  assert.deepEqual((await customer.call("GET", "/shops")).body.map((s) => s.slug), ["qexpress"]);
  assert.equal((await customer.call("GET", "/products?shop=oila-market")).status, 404);
  assert.equal((await customer.call("POST", "/orders", order(state.shopProduct))).status, 400);
  // Its bot hears nothing.
  const quiet = calls().length;
  assert.equal(await webhook(`/telegram/webhook/${state.shopId}`, SHOP_TOKEN, { chat: { id: 9100004, type: "private" }, from: { id: 9100004, first_name: "Sardor" }, text: "/start" }), 200);
  assert.equal(calls().slice(quiet).filter((c) => c.method === "sendMessage").length, 0);
  // Its admins are signed out and cannot sign in.
  assert.equal((await owner.call("GET", "/admin/session")).body.authenticated, false);
  assert.equal((await owner.call("GET", "/admin/orders")).status, 401);
  const signIn = await new Client("shop-owner-2").call("POST", "/admin/auth", { username: "aziz", password: "Aziz-own-pass-77" });
  assert.equal(signIn.status, 403);
  // Its history stays, for Q express to read.
  platform.headers = { "x-admin-shop": String(state.shopId) };
  assert.ok((await platform.call("GET", "/admin/orders")).body.length > 0);
  platform.headers = {};
  assert.equal((await platform.call("PATCH", `/admin/shops/${state.shopId}`, { active: true })).status, 409, "restored first");
  assert.equal((await platform.call("POST", `/admin/shops/${state.shopId}/bot`)).status, 409);
  // Back again: its admins return, and it is shown once a platform super admin says so.
  const restored = await platform.call("POST", `/admin/shops/${state.shopId}/restore`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.archived_at, null);
  assert.equal(restored.body.active, false);
  assert.equal((await owner.call("GET", "/admin/session")).body.authenticated, true);
  assert.equal((await platform.call("PATCH", `/admin/shops/${state.shopId}`, { active: true })).status, 200);
  assert.deepEqual((await customer.call("GET", "/shops")).body.map((s) => s.slug), ["qexpress", "oila-market"]);
});

test("a stale shop choice on the device is ignored, not fatal", async () => {
  platform.headers = { "x-admin-shop": "999999" };
  const products = await platform.call("GET", "/admin/products");
  assert.equal(products.status, 200);
  assert.ok(products.body.every((p) => p.shop_id === 1), "back in the admin's own shop");
  assert.equal((await platform.call("GET", "/admin/shops")).status, 200);
  platform.headers = {};
});

test("a large card is accepted, an oversized body refused cleanly", async () => {
  const big = `<p>${"a".repeat(90_000)}</p>`;
  assert.equal((await owner.call("PUT", `/admin/shops/${state.shopId}/card`, { card: { uz: big, ru: big, en: big } })).status, 200);
  const huge = `<p>${"a".repeat(400_000)}</p>`;
  assert.equal((await owner.call("PUT", `/admin/shops/${state.shopId}/card`, { card: { uz: huge, ru: huge, en: huge } })).status, 413);
  // A stranger's large body is cut off at the default limit, never read to 1 MB.
  assert.equal((await new Client("stranger").call("PUT", `/admin/shops/${state.shopId}/card`, { card: { uz: big, ru: big } })).status, 413);
  assert.equal((await new Client("stranger").call("PUT", `/admin/shops/${state.shopId}/card`, { card: { uz: "<p>x</p>" } })).status, 401);
  // The larger limit is the card's alone: an open route keeps the default.
  assert.equal((await customer.call("POST", "/chat/messages?shop=oila-market", { body: "a".repeat(200_000) })).status, 413);
});
