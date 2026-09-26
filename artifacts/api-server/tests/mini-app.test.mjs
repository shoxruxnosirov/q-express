import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, test } from "node:test";
import { verifyWebAppInitData, welcomeMessage } from "../src/lib/telegram.ts";

const TOKEN = "424242:mini-app-test-token";
const originalToken = process.env.TELEGRAM_BOT_TOKEN;
const originalMode = process.env.TELEGRAM_BOT_MODE;

function configure() {
  process.env.TELEGRAM_BOT_MODE = "legacy";
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
}

afterEach(() => {
  if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = originalToken;
  if (originalMode === undefined) delete process.env.TELEGRAM_BOT_MODE;
  else process.env.TELEGRAM_BOT_MODE = originalMode;
});

// Signs initData the way Telegram does, for a given bot token.
function signInitData(fields, token) {
  const check = Object.entries(fields).map(([key, value]) => `${key}=${value}`).sort().join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const NOW = 1_800_000_000;

test("genuine Mini App initData names the Telegram user", () => {
  configure();
  const initData = signInitData({ auth_date: String(NOW), query_id: "AAE", user: JSON.stringify({ id: 5001, first_name: "Aziz" }) }, TOKEN);
  assert.equal(verifyWebAppInitData(initData, NOW * 1000), "5001");
});

test("forged, re-signed, stale or malformed initData is refused", () => {
  configure();
  const fields = { auth_date: String(NOW), user: JSON.stringify({ id: 5001 }) };
  const good = signInitData(fields, TOKEN);
  assert.equal(verifyWebAppInitData(good.replace("5001", "5002"), NOW * 1000), undefined, "changing the user breaks the signature");
  assert.equal(verifyWebAppInitData(signInitData(fields, "999:other-bot"), NOW * 1000), undefined, "another bot's signature");
  assert.equal(verifyWebAppInitData(good, (NOW + 25 * 3600) * 1000), undefined, "older than a day");
  assert.equal(verifyWebAppInitData(good, (NOW - 3600) * 1000), undefined, "from the future");
  assert.equal(verifyWebAppInitData("", NOW * 1000), undefined);
  assert.equal(verifyWebAppInitData("user=%7B%7D&hash=zz", NOW * 1000), undefined);
  const noUser = signInitData({ auth_date: String(NOW) }, TOKEN);
  assert.equal(verifyWebAppInitData(noUser, NOW * 1000), undefined, "no user, nobody to sign in");
});

test("without a bot configured nothing is trusted", () => {
  configure();
  const initData = signInitData({ auth_date: String(NOW), user: JSON.stringify({ id: 5001 }) }, TOKEN);
  delete process.env.TELEGRAM_BOT_TOKEN;
  assert.equal(verifyWebAppInitData(initData, NOW * 1000), undefined);
});

test("the welcome carries the banner, the promises, real discounts and Mini App buttons", () => {
  const message = welcomeMessage("https://q-express.onrender.com/", [
    { name: "Mol go‘shti", price: 98000, oldPrice: 110000 },
    { name: "<b>Olma</b>", price: 18000, oldPrice: 22000 },
    { name: "Suv", price: 4500, oldPrice: null },
  ]);
  assert.equal(message.photo, "https://q-express.onrender.com/brand/q-express-logo.png");
  assert.ok(message.caption.includes("15–19 daqiqada"));
  assert.ok(message.caption.includes("Birinchi yetkazish bepul"));
  // Thousands are grouped with a non-breaking space, so "98 000" never wraps.
  const caption = message.caption.replaceAll(" ", " ");
  assert.ok(caption.includes("Mol go‘shti: <b>98 000 so‘m</b> <s>110 000 so‘m</s> (−11%)"), caption);
  assert.ok(message.caption.includes("&lt;b&gt;Olma&lt;/b&gt;"), "product names are escaped");
  assert.ok(!message.caption.includes("Suv"), "no discount, no line");
  const buttons = message.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map((button) => button.web_app.url), [
    "https://q-express.onrender.com/",
    "https://q-express.onrender.com/catalog?sort=discount",
    "https://q-express.onrender.com/orders",
  ]);
  assert.ok(!welcomeMessage("https://x.test", []).caption.includes("Bugungi chegirmalar"), "no deals, no heading");
});

test("the welcome states the opening hours when given", () => {
  const withHours = welcomeMessage("https://x.test", [], { openTime: "06:00", closeTime: "23:00" });
  assert.ok(withHours.caption.includes("Ish vaqti: <b>06:00–23:00</b>"));
  assert.ok(!welcomeMessage("https://x.test", []).caption.includes("Ish vaqti"));
});

test("a pre-order notification leads with its delivery time", async () => {
  configure();
  process.env.TELEGRAM_ADMIN_CHAT_ID = "5550001";
  const { sendNewOrderNotification } = await import("../src/lib/telegram.ts");
  let text;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    text = JSON.parse(init.body).text;
    return new Response(JSON.stringify({ ok: true }));
  };
  try {
    const order = { id: 1, orderNumber: "QE-1", customerName: "A", phone: "998901112233", address: "x", items: [], paymentMethod: "cash", subtotal: 0, deliveryFee: 0, total: 0 };
    await sendNewOrderNotification({ ...order, scheduledLabel: "28-sentabr, 06:00" });
    const [first, second] = text.split("\n");
    assert.equal(first, "<b>YANGI BUYURTMA · OLDINDAN</b>");
    assert.equal(second, "⏰ <b>Yetkazish vaqti:</b> 28-sentabr, 06:00");
    await sendNewOrderNotification(order);
    assert.equal(text.split("\n")[0], "<b>YANGI BUYURTMA</b>", "an order for now looks as before");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TELEGRAM_ADMIN_CHAT_ID;
  }
});
