import { createHmac, timingSafeEqual } from "node:crypto";

const TELEGRAM_API = "https://api.telegram.org";

// Every chat notification opens with this header, and a reply in Telegram is
// routed back to the customer by reading it from the message being replied to.
// It must be the FIRST line and only the first line is parsed: everything
// below it includes text a customer chose, and a name such as "Suhbat #5"
// placed above the real number would send the operator's answer to somebody
// else's conversation. The renderer and the parser share one place so they
// cannot drift apart.
const THREAD_SEPARATOR = " · Suhbat #";
// An emoji may lead the title (the admins tell a chat from an order at a
// glance); older notifications without one still parse.
const THREAD_HEADER_PATTERN = /^(?:\S+ )?[A-Z ]+ · Suhbat #(\d+)$/u;
// Postgres `serial` ids stop here; anything larger cannot name a thread.
const MAX_THREAD_ID = 2_147_483_647;

function threadHeader(title: string, threadId: number) {
  return `<b>${title}</b>${THREAD_SEPARATOR}${threadId}`;
}

function threadIdFromNotification(text: string | undefined) {
  const firstLine = (text ?? "").split("\n", 1)[0].trim();
  const match = THREAD_HEADER_PATTERN.exec(firstLine);
  if (!match) return undefined;
  const threadId = Number(match[1]);
  return Number.isSafeInteger(threadId) && threadId > 0 && threadId <= MAX_THREAD_ID ? threadId : undefined;
}

type TelegramResult = {
  sent: boolean;
  error?: string;
};

type TelegramOrder = {
  id: number;
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  items: unknown;
  paymentMethod: string;
  subtotal: string | number | null;
  deliveryFee: string | number | null;
  total: string | number | null;
  // "28-sentabr, 06:00" for a pre-order, formatted by the caller on the
  // Tashkent clock; absent for as soon as possible.
  scheduledLabel?: string;
  // Who placed it in Telegram.
  telegramName?: string | null;
  telegramUsername?: string | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// +998 90 123 45 67 for the admins reading it. Kept here rather than imported
// from ./phone because the tests load this file on its own.
function formatUzPhone(phone: string) {
  const match = /^998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return match ? `+998 ${match[1]} ${match[2]} ${match[3]} ${match[4]}` : phone;
}

function formatMoney(value: string | number | null) {
  return `${Number(value ?? 0).toLocaleString("ru-RU")} so'm`;
}

// "12 000": an amount inside a line, where "so'm" would only be noise.
function formatNumber(value: string | number | null | undefined) {
  return Number(value ?? 0).toLocaleString("ru-RU");
}

// ---------------------------------------------------------------------------
// Message design
//
// Telegram has no coloured text, so every kind of message is told apart by
// its first line: a coloured mark and an emoji, then the title in capitals
// (🟢🛒 order, 🟠⏰ pre-order, 🔵💬 chat, 🟡⭐ comment). Sections inside are
// separated by a rule and lead with their own emoji, and whatever a customer
// wrote sits in a quote block, apart from what the shop wrote around it.
// ---------------------------------------------------------------------------

const RULE = "━━━━━━━━━━━━━━";

// The customer's text, in Telegram's quote block. Escaped: it is theirs.
function quote(text: string) {
  return `<blockquote>${escapeHtml(text)}</blockquote>`;
}

// "✈️ Aziz Karimov (@aziz)", a link to their Telegram when they have a
// @username, so an admin reaches them in one tap.
function telegramLine(profile: { telegramName?: string | null; telegramUsername?: string | null }) {
  const label = telegramLabel(profile);
  if (!label) return undefined;
  const text = escapeHtml(label);
  return profile.telegramUsername ? `✈️ <a href="https://t.me/${profile.telegramUsername}">${text}</a>` : `✈️ ${text}`;
}

// Who the customer is: what they typed, then who they are in Telegram, then
// where to deliver.
function customerLines(customer: {
  name: string;
  phone?: string;
  telegramName?: string | null;
  telegramUsername?: string | null;
  address?: string;
}) {
  const name = escapeHtml(customer.name.trim() || "Noma’lum mijoz");
  const phone = customer.phone?.trim() ? ` · ${escapeHtml(formatUzPhone(customer.phone.trim()))}` : "";
  const telegram = telegramLine(customer);
  return [
    `👤 <b>${name}</b>${phone}`,
    ...(telegram ? [telegram] : []),
    ...(customer.address ? [`📍 ${escapeHtml(customer.address)}`] : []),
  ];
}

// "3 dona", "0.5 kg": what the courier has to bring. Pieces and packs are
// whole; weight and volume keep up to three decimals, without the noise of
// floating point (0.30000000000000004).
export function formatQuantity(quantity: unknown, unit: unknown) {
  const value = typeof quantity === "number" && Number.isFinite(quantity) ? quantity : 0;
  const unitText = typeof unit === "string" ? unit : "";
  const whole = unitText === "dona" || unitText === "qadoq";
  const shown = whole ? String(Math.round(value)) : String(Number(value.toFixed(3)));
  return `${shown} ${unitText}`.trim();
}

// One line of an order for the admins: how many, at what price, for how much.
// A line bought by amount ("30 000 so'mlik go'sht") says the amount and the
// weight it came to.
export function orderLineText(item: unknown) {
  const line = (item ?? {}) as {
    name?: string;
    quantity?: number;
    unit?: string;
    price?: number;
    total?: number;
    purchase_mode?: "quantity" | "amount";
    requested_amount?: number | null;
  };
  const name = escapeHtml(line.name ?? "Mahsulot");
  const quantity = escapeHtml(formatQuantity(line.quantity, line.unit));
  if (line.purchase_mode === "amount" && line.requested_amount != null) {
    return `▫️ ${name} — <b>${formatMoney(line.requested_amount)}lik</b> (~${quantity})`;
  }
  const price = typeof line.price === "number" ? ` × ${formatNumber(line.price)}` : "";
  return `▫️ ${name} — <b>${quantity}</b>${price} = <b>${formatNumber(line.total ?? 0)}</b>`;
}

// Telegram refuses a message over 4096 characters, and then no admin hears of
// the order at all. The lines stop well short of that, and the rest are
// counted; the dashboard always lists them all.
const ITEMS_TEXT_LIMIT = 2800;

export function itemsWithinLimit(lines: string[]) {
  const shown: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > ITEMS_TEXT_LIMIT) break;
    shown.push(line);
    length += line.length + 1;
  }
  const rest = lines.length - shown.length;
  if (rest > 0) shown.push(`… va yana <b>${rest}</b> ta mahsulot (to‘liq ro‘yxat admin panelda)`);
  return shown.join("\n");
}

const PAYMENT_LABELS: Record<string, string> = { cash: "💵 Naqd", click: "💳 Click", payme: "💳 Payme", uzcard: "💳 Uzcard", humo: "💳 Humo" };

function paymentLabel(method: string) {
  return PAYMENT_LABELS[method] ?? method;
}

// ---------------------------------------------------------------------------
// Bot and recipients
//
// Notifications go to the owner's chat from TELEGRAM_ADMIN_CHAT_ID, when set,
// plus every admin who linked their Telegram from the dashboard. The caller
// passes the linked chats in, so this module never touches the database and
// stays testable on its own.
// ---------------------------------------------------------------------------

const MISSING_CONFIGURATION = "Telegram bot configuration is missing";

// The code never checks which bot a token belongs to, so the mode alone decides
// which variable is read, and a missing one is never quietly swapped for the
// other bot's.
function resolveBotToken(): { token: string } | TelegramResult {
  const botMode = process.env.TELEGRAM_BOT_MODE ?? "legacy";
  if (botMode !== "legacy" && botMode !== "new") {
    return { sent: false, error: "Telegram bot mode is invalid" };
  }
  const token = botMode === "new"
    ? process.env.TELEGRAM_NEW_BOT_TOKEN
    : process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { sent: false, error: MISSING_CONFIGURATION };
  return { token };
}

export function ownerChatId() {
  return process.env.TELEGRAM_ADMIN_CHAT_ID?.trim() || undefined;
}

// The bot works with private chats only: a private chat's id is the user's
// own, a positive number, while groups and channels have negative ids. A
// group or channel configured as the owner chat is left out rather than
// written to.
export function isPrivateChatId(chatId: string) {
  return /^[1-9]\d{0,19}$/.test(chatId);
}

function recipientChats(linkedChatIds: readonly string[], exclude?: string) {
  const owner = ownerChatId();
  const all = [...(owner ? [owner] : []), ...linkedChatIds];
  return [...new Set(all)].filter((chatId) => chatId !== exclude && isPrivateChatId(chatId));
}

type BotApiResult = TelegramResult & { result?: unknown };

async function callBotApi(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<BotApiResult> {
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(payload),
    });

    const body = (await response.json()) as { ok?: boolean; error_code?: number; result?: unknown };
    if (!response.ok || !body.ok) {
      return { sent: false, error: `Telegram returned ${body.error_code ?? response.status}` };
    }

    return { sent: true, result: body.result };
  } catch {
    return {
      sent: false,
      // Fetch errors may contain the token-bearing URL. Never return raw errors.
      error: "Telegram request failed or timed out",
    };
  }
}

async function sendToChat(chatId: string, text: string, replyToMessageId?: number): Promise<TelegramResult> {
  const bot = resolveBotToken();
  if (!("token" in bot)) return bot;
  const { sent, error } = await callBotApi(bot.token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyToMessageId === undefined
      ? {}
      : { reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true } }),
  });
  return error === undefined ? { sent } : { sent, error };
}

// Counts as sent when at least one recipient got it: one admin who blocked the
// bot must not make the order look unannounced to the rest.
async function sendToChats(chatIds: readonly string[], text: string): Promise<TelegramResult> {
  const bot = resolveBotToken();
  if (!("token" in bot)) return bot;
  if (chatIds.length === 0) return { sent: false, error: MISSING_CONFIGURATION };
  const results = await Promise.all(chatIds.map((chatId) => sendToChat(chatId, text)));
  if (results.some((result) => result.sent)) return { sent: true };
  return { sent: false, error: results[0]?.error ?? "Telegram request failed" };
}

// ---------------------------------------------------------------------------
// Webhook
//
// Admins answer customers by replying, in their own chat with the bot, to the
// notification that carried the customer's message. Telegram delivers that
// reply to a webhook on this server. A webhook rather than getUpdates polling,
// because the free instance sleeps: an incoming request wakes it, a poll loop
// inside a sleeping process never runs.
// ---------------------------------------------------------------------------

// Telegram echoes this value in a header on every webhook call, which is how a
// call from Telegram is told apart from a stranger posting to the URL. It is
// derived rather than configured, so there is no extra variable to set, and it
// changes by itself when either secret is rotated.
export function webhookSecret(): string | undefined {
  const bot = resolveBotToken();
  const sessionSecret = process.env.SESSION_SECRET;
  if (!("token" in bot) || !sessionSecret) return undefined;
  return createHmac("sha256", sessionSecret)
    .update(`telegram-webhook:${bot.token}`)
    .digest("hex");
}

export function webhookSecretMatches(provided: unknown) {
  const expected = webhookSecret();
  if (!expected || typeof provided !== "string") return false;
  const left = Buffer.from(provided, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

// Points the bot at this server. Called on every start, which is harmless:
// setWebhook with the same URL is idempotent. Note that a bot with a webhook
// can no longer be read with getUpdates by any other program.
export async function registerWebhook(baseUrl: string): Promise<TelegramResult> {
  const bot = resolveBotToken();
  if (!("token" in bot)) return bot;
  const secret = webhookSecret();
  if (!secret) return { sent: false, error: "SESSION_SECRET is required for the Telegram webhook" };
  const { sent, error } = await callBotApi(bot.token, "setWebhook", {
    url: `${baseUrl.replace(/\/+$/, "")}/api/telegram/webhook`,
    secret_token: secret,
    // my_chat_member: the bot being added to a group or channel, which it
    // then leaves (a channel never sends it a message to react to).
    allowed_updates: ["message", "my_chat_member"],
  });
  return error === undefined ? { sent } : { sent, error };
}

// The bot's @username, needed to build t.me links. Cached after the first
// success; a failure is not cached so the next attempt can recover.
let botUsername: string | undefined;
export async function getBotUsername(): Promise<string | undefined> {
  if (botUsername) return botUsername;
  const bot = resolveBotToken();
  if (!("token" in bot)) return undefined;
  const { result } = await callBotApi(bot.token, "getMe", {});
  const username = (result as { username?: unknown } | undefined)?.username;
  if (typeof username === "string" && /^[A-Za-z0-9_]{5,64}$/.test(username)) botUsername = username;
  return botUsername;
}

type TelegramUpdate = {
  update_id?: number;
  my_chat_member?: {
    chat?: { id?: number | string; type?: string };
    new_chat_member?: { status?: string };
  };
  message?: {
    message_id?: number;
    chat?: { id?: number | string; type?: string };
    from?: { id?: number; first_name?: string; last_name?: string; username?: string };
    text?: string;
    contact?: { phone_number?: string; user_id?: number };
    reply_to_message?: {
      from?: { id?: number; is_bot?: boolean };
      text?: string;
    };
  };
};

export type AdminUpdate =
  // "/start <code>" from a t.me link an admin created on the dashboard. Taken
  // from any chat, because linking is how a new chat becomes known.
  | { kind: "link"; chatId: string; code: string; messageId: number }
  // Anyone opening the bot: greet them and offer the shop as a Mini App.
  | { kind: "welcome"; chatId: string }
  // A reply to one of our chat notifications: deliver it to that thread.
  | { kind: "reply"; chatId: string; threadId: number; body: string; messageId: number; ref: string }
  // Something a known admin sent that we cannot route; answer with a hint.
  | { kind: "hint"; chatId: string; messageId: number }
  // A customer writing to the bot in their private chat: it goes into their
  // conversation with the shop, the same one the Mini App shows. The name is
  // Telegram's, for an account the message itself creates.
  | { kind: "customer-message"; chatId: string; telegramUserId: string; name: string; username: string | null; body: string; messageId: number; ref: string }
  // A customer sent something the chat cannot hold (a photo, a sticker, a
  // text over the limit); answer with what is accepted.
  | { kind: "customer-unsupported"; chatId: string; messageId: number }
  // A group, supergroup or channel the bot was added to: the shop works in
  // private chats only, so the bot leaves it.
  | { kind: "leave"; chatId: string }
  // Not ours to handle: an edit, a command, and so on.
  | { kind: "ignore" };

// The same ceiling the website puts on a chat message (ChatMessageInput).
export const MAX_REPLY_LENGTH = 1000;
// What createTelegramLinkCode produces: 32 hex characters.
const LINK_COMMAND_PATTERN = /^\/start(?:@\w+)?\s+([0-9a-f]{32})$/;
// A bare /start, or the "login" ones that pages of earlier builds still link
// to (signing in and verifying phones are gone): all of them get the shop.
const BARE_START_PATTERN = /^\/start(?:@\w+)?(?:\s+login(?:_[0-9a-f]{32})?)?$/;

// Pure so it can be tested without Telegram: decides what an update means.
// Only the owner's chat and chats linked to an admin are listened to, since
// anybody in the world can message the bot, and only a reply to a message this
// bot wrote is trusted to name a thread.
export function parseAdminUpdate(update: unknown, linkedChatIds: readonly string[] = []): AdminUpdate {
  const bot = resolveBotToken();
  if (!("token" in bot)) return { kind: "ignore" };
  const membership = (update as TelegramUpdate | null)?.my_chat_member;
  if (membership) {
    const memberChatId = String(membership.chat?.id ?? "");
    const type = membership.chat?.type;
    const joined = ["member", "administrator"].includes(membership.new_chat_member?.status ?? "");
    return joined && memberChatId && (type === "group" || type === "supergroup" || type === "channel")
      ? { kind: "leave", chatId: memberChatId }
      : { kind: "ignore" };
  }
  const message = (update as TelegramUpdate | null)?.message;
  if (!message || typeof message.message_id !== "number") return { kind: "ignore" };
  const chatId = String(message.chat?.id ?? "");
  if (!chatId) return { kind: "ignore" };

  // Private chats only, for customers and admins alike. Anything from a group
  // or channel is not read at all, and the bot leaves.
  const type = message.chat?.type;
  const isPrivate = type === undefined ? isPrivateChatId(chatId) : type === "private" && isPrivateChatId(chatId);
  if (!isPrivate) return type === "group" || type === "supergroup" || type === "channel" ? { kind: "leave", chatId } : { kind: "ignore" };

  const body = typeof message.text === "string" ? message.text.trim() : "";
  const link = LINK_COMMAND_PATTERN.exec(body);
  if (link) return { kind: "link", chatId, code: link[1], messageId: message.message_id };

  const isAdminChat = recipientChats(linkedChatIds).includes(chatId);
  // /start is somebody opening the bot, admins included, and gets the shop.
  if (BARE_START_PATTERN.test(body)) return { kind: "welcome", chatId };

  if (!isAdminChat) {
    // A private chat's id is the user's own; a message whose sender is not
    // the chat is not a customer talking to the shop.
    const senderId = message.from?.id;
    if (typeof senderId !== "number" || String(senderId) !== chatId) return { kind: "ignore" };
    if (body.startsWith("/")) return { kind: "ignore" };
    if (!body || body.length > MAX_REPLY_LENGTH) return { kind: "customer-unsupported", chatId, messageId: message.message_id };
    const name = [message.from?.first_name, message.from?.last_name]
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .join(" ")
      .trim()
      .slice(0, 80);
    return {
      kind: "customer-message",
      chatId,
      telegramUserId: chatId,
      name,
      username: cleanUsername(message.from?.username),
      body,
      messageId: message.message_id,
      ref: `${chatId}:${message.message_id}`,
    };
  }

  const original = message.reply_to_message;
  const botId = Number(bot.token.split(":")[0]);
  const fromThisBot = original?.from?.is_bot === true && original.from.id === botId;
  const threadId = fromThisBot ? threadIdFromNotification(original?.text) : undefined;

  if (threadId === undefined || !body || body.length > MAX_REPLY_LENGTH) {
    return { kind: "hint", chatId, messageId: message.message_id };
  }
  return {
    kind: "reply",
    chatId,
    threadId,
    body,
    messageId: message.message_id,
    // Telegram retries a webhook it thinks failed, for instance while this
    // instance is still waking up. Storing this key with a unique index makes
    // a retried update land once.
    ref: `${chatId}:${message.message_id}`,
  };
}

// A thumbs-up on the admin's own message says "delivered" without adding
// another message to the chat. Best effort: a missing reaction loses nothing.
export async function acknowledgeAdminReply(chatId: string, messageId: number): Promise<TelegramResult> {
  const bot = resolveBotToken();
  if (!("token" in bot)) return bot;
  const { sent, error } = await callBotApi(bot.token, "setMessageReaction", {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji: "👍" }],
  });
  return error === undefined ? { sent } : { sent, error };
}

export async function sendReplyHint(chatId: string, messageId: number, reason: "unroutable" | "missing-thread" | "customer-blocked") {
  const text = reason === "missing-thread"
    ? "⚠️ Bu suhbat topilmadi, javob yuborilmadi."
    : reason === "customer-blocked"
      ? "⛔️ Bu mijoz bloklangan, javob yuborilmadi."
      : `ℹ️ Mijozga javob berish uchun uning <b>💬 CHAT</b> xabariga <b>Reply</b> qilib yozing (matn ${MAX_REPLY_LENGTH} belgidan oshmasin).`;
  return sendToChat(chatId, text, messageId);
}

// ---------------------------------------------------------------------------
// The shop's replies in the customer's own Telegram
//
// A customer who verified their phone through the bot has a Telegram account
// on file and has written to the bot, so the bot may write back. An admin's
// reply is sent there too, and the customer can answer right in the bot.
// ---------------------------------------------------------------------------

function webAppButton(text: string, baseUrl: string, path: string) {
  return { inline_keyboard: [[{ text, web_app: { url: `${baseUrl.replace(/\/+$/, "")}${path}` } }]] };
}

export function customerReplyText(body: string) {
  return ["💬 <b>Q express javobi</b>", RULE, quote(body), "", "<i>✍️ Javob yozish uchun shu yerga yozing</i>"].join("\n");
}

// Whether a chat is an admin's: the owner's chat or one linked to an admin.
export function isAdminChat(chatId: string, linkedChatIds: readonly string[]) {
  return recipientChats(linkedChatIds).includes(chatId);
}

export function sendCustomerReply(telegramUserId: string, body: string, baseUrl: string) {
  return sendToChatWithMarkup(telegramUserId, customerReplyText(body), webAppButton("💬 Chatni ochish", baseUrl, "/?chat=open"));
}

export type CustomerNotice = "blocked" | "unsupported" | "too-many";

export function customerNoticeText(reason: CustomerNotice) {
  switch (reason) {
    case "blocked":
      return "⛔️ Hisobingiz do‘kon tomonidan bloklangan. Buyurtma berish va yozish imkoni yo‘q.";
    case "unsupported":
      return `ℹ️ Faqat matnli xabar qabul qilinadi (${MAX_REPLY_LENGTH} belgigacha).`;
    case "too-many":
      return "⏳ Juda ko‘p xabar yuborildi. Bir daqiqadan keyin yozing.";
  }
}

// The keyboard is removed too: chats of earlier builds may still show the
// old "share your number" button, and a contact sent with it is not text.
export function sendCustomerNotice(chatId: string, reason: CustomerNotice) {
  return sendToChatWithMarkup(chatId, customerNoticeText(reason), { remove_keyboard: true });
}

// What the customer wrote in the Mini App's chat, copied into their chat with
// the bot, so the bot holds the whole conversation. Silent: they wrote it.
export function customerEchoText(body: string) {
  return ["✉️ <b>Siz yozdingiz</b>", quote(body)].join("\n");
}

export async function sendCustomerEcho(telegramUserId: string, body: string) {
  const bot = resolveBotToken();
  if (!("token" in bot)) return bot;
  const { sent, error } = await callBotApi(bot.token, "sendMessage", {
    chat_id: telegramUserId,
    text: customerEchoText(body),
    parse_mode: "HTML",
    disable_notification: true,
  });
  return error === undefined ? { sent } : { sent, error };
}

async function sendToChatWithMarkup(chatId: string, text: string, replyMarkup: Record<string, unknown>) {
  const bot = resolveBotToken();
  if (!("token" in bot)) return bot;
  const { sent, error } = await callBotApi(bot.token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: replyMarkup,
  });
  return error === undefined ? { sent } : { sent, error };
}

// ---------------------------------------------------------------------------
// The shop as a Mini App
// ---------------------------------------------------------------------------

export type WelcomeOffer = { name: string; price: number; oldPrice: number | null };

function formatSum(value: number) {
  return `${Math.round(value).toLocaleString("ru-RU")} so‘m`;
}

// The greeting a customer gets on /start: the brand banner, what the shop
// promises, today's biggest discounts from the catalogue, and buttons that
// open the site inside Telegram. Web-app buttons need no BotFather setup.
export function welcomeMessage(
  baseUrl: string,
  offers: readonly WelcomeOffer[],
  hours?: { openTime: string; closeTime: string },
) {
  const root = baseUrl.replace(/\/+$/, "");
  const deals = offers
    .filter((offer) => offer.oldPrice !== null && offer.oldPrice > offer.price)
    .slice(0, 3)
    .map((offer) => {
      const percent = Math.round((1 - offer.price / offer.oldPrice!) * 100);
      return `▫️ ${escapeHtml(offer.name)}: <b>${formatSum(offer.price)}</b> <s>${formatSum(offer.oldPrice!)}</s> (−${percent}%)`;
    });
  const caption = [
    "🛒 <b>Q express'ga xush kelibsiz!</b>",
    "Qorasuvda oziq-ovqat eshigingizgacha.",
    RULE,
    "⚡ <b>15–19 daqiqada</b> yetkazamiz",
    ...(hours ? [`🕕 Ish vaqti: <b>${escapeHtml(hours.openTime)}–${escapeHtml(hours.closeTime)}</b>, yopiq paytda oldindan buyurtma bering`] : []),
    "🎁 <b>Har bir xonadonga birinchi yetkazish bepul</b>",
    "💵 Naqd, Click, Payme, Uzcard yoki Humo",
    ...(deals.length ? [RULE, "🔥 <b>Bugungi chegirmalar</b>", ...deals] : []),
    RULE,
    "👇 Pastdagi tugmani bosing, do‘kon shu yerning o‘zida ochiladi",
  ].join("\n");
  const app = (text: string, path: string) => ({ text, web_app: { url: `${root}${path}` } });
  return {
    photo: `${root}/brand/q-express-logo.png`,
    caption,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [app("🛒 Do‘konni ochish", "/")],
        [app("🔥 Chegirmalar", "/catalog?sort=discount"), app("📦 Buyurtmalarim", "/orders")],
      ],
    },
  };
}

export async function sendWelcome(
  chatId: string,
  baseUrl: string,
  offers: readonly WelcomeOffer[],
  hours?: { openTime: string; closeTime: string },
) {
  const bot = resolveBotToken();
  if (!("token" in bot)) return bot;
  const { sent, error } = await callBotApi(bot.token, "sendPhoto", { chat_id: chatId, ...welcomeMessage(baseUrl, offers, hours) });
  return error === undefined ? { sent } : { sent, error };
}

// The button next to the message box in every private chat with the bot opens
// the shop too. Set on each start, like the webhook; it is idempotent.
export async function registerMenuButton(baseUrl: string): Promise<TelegramResult> {
  const bot = resolveBotToken();
  if (!("token" in bot)) return bot;
  const { sent, error } = await callBotApi(bot.token, "setChatMenuButton", {
    menu_button: { type: "web_app", text: "Do‘kon", web_app: { url: `${baseUrl.replace(/\/+$/, "")}/` } },
  });
  return error === undefined ? { sent } : { sent, error };
}

// A Mini App receives initData signed with a key derived from the bot token.
// Checking it proves the Telegram account opening the shop, so a customer who
// verified their phone once is recognised without a cookie of this webview's.
// Returns the Telegram user id, or undefined for anything forged or stale.
// An hour, not a day: the data rides in the page's URL, so a copied link would
// otherwise sign its holder in as the customer for a whole day. Telegram
// issues fresh data every time the Mini App opens, and after the first
// sign-in the webview's own cookie carries the session.
const INIT_DATA_MAX_AGE_SECONDS = 60 * 60;
// A Telegram @username as Telegram allows it (5-32 letters, digits and
// underscores), without the @; anything else is dropped.
export function cleanUsername(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_]{4,32}$/.test(value) ? value : null;
}

export type TelegramProfile = { name: string; username: string | null };

// Who Telegram says the launching user is: their name and @username. Read only
// after verifyWebAppInitData accepted the same data.
export function webAppUser(initData: string): TelegramProfile {
  try {
    const user = JSON.parse(new URLSearchParams(initData).get("user") ?? "") as { first_name?: unknown; last_name?: unknown; username?: unknown };
    const parts = [user.first_name, user.last_name].filter((part): part is string => typeof part === "string" && part.trim() !== "");
    return { name: parts.join(" ").trim().slice(0, 80), username: cleanUsername(user.username) };
  } catch {
    return { name: "", username: null };
  }
}

// The bot was added to a group or channel; it works in private chats only.
export async function leaveChat(chatId: string): Promise<TelegramResult> {
  const bot = resolveBotToken();
  if (!("token" in bot)) return bot;
  const { sent, error } = await callBotApi(bot.token, "leaveChat", { chat_id: chatId });
  return error === undefined ? { sent } : { sent, error };
}

// "Aziz Karimov (@aziz)" for the admins: who the customer is in Telegram.
export function telegramLabel(profile: { telegramName?: string | null; telegramUsername?: string | null }) {
  const name = profile.telegramName?.trim();
  const username = profile.telegramUsername ? `@${profile.telegramUsername}` : "";
  if (name && username) return `${name} (${username})`;
  return name || username || undefined;
}

export function verifyWebAppInitData(initData: string, now = Date.now()): string | undefined {
  const bot = resolveBotToken();
  if (!("token" in bot) || !initData) return undefined;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return undefined;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(bot.token).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hash, "hex"))) return undefined;
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > INIT_DATA_MAX_AGE_SECONDS || authDate - now / 1000 > 60) {
    return undefined;
  }
  try {
    const user = JSON.parse(params.get("user") ?? "") as { id?: unknown };
    return typeof user.id === "number" && Number.isSafeInteger(user.id) ? String(user.id) : undefined;
  } catch {
    return undefined;
  }
}

export async function sendLinkResult(chatId: string, displayName: string | undefined) {
  const text = displayName
    ? `✅ <b>${escapeHtml(displayName)}</b>, Telegram ulandi. Endi buyurtma va mijoz xabarlari shu yerga keladi.`
    : "Bu havola eskirgan yoki allaqachon ishlatilgan. Admin paneldagi <b>Profilim</b> bo‘limidan yangisini oling.";
  return sendToChat(chatId, text);
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

// The operators are not always watching the dashboard, so a customer's message
// reaches the same chats the order notifications already go to.
export type ChatSource = "mini-app" | "bot" | "site";

export async function sendChatMessageNotification(
  message: {
    threadId: number;
    customerName: string;
    phone: string;
    body: string;
    // Orders the customer has placed (not cancelled); absent when unknown.
    orderCount?: number;
    via?: ChatSource;
    telegramName?: string | null;
    telegramUsername?: string | null;
  },
  linkedChatIds: readonly string[] = [],
): Promise<TelegramResult> {
  return sendToChats(recipientChats(linkedChatIds), chatNotificationText(message));
}

export function chatNotificationText(message: Parameters<typeof sendChatMessageNotification>[0]) {
  const where = message.via === "bot" ? "🤖 Telegram bot orqali yozdi" : message.via === "mini-app" ? "📱 Mini App orqali yozdi" : message.via === "site" ? "🌐 Saytdan yozdi" : undefined;
  const status = message.orderCount === undefined
    ? undefined
    : message.orderCount > 0
      ? `🛍 Buyurtmachi · ${message.orderCount} ta buyurtma`
      : "🆕 Hali buyurtma bermagan";
  // The first line is the thread header a reply is routed by; it stays first.
  const lines = [
    threadHeader("🔵💬 CHAT", message.threadId),
    RULE,
    ...customerLines({ name: message.customerName, phone: message.phone, telegramName: message.telegramName, telegramUsername: message.telegramUsername }),
    ...(status ? [status] : []),
    ...(where ? [where] : []),
    "",
    quote(message.body),
    "",
    "<i>↩️ Javob berish uchun shu xabarga Reply qiling</i>",
  ];
  return lines.join("\n");
}

// What an admin wrote, copied to every other admin chat so Telegram holds the
// whole conversation and two people do not answer the same question. It opens
// with the thread header too, so anyone can carry on by replying to it.
export async function sendOperatorReplyNotification(
  message: {
    threadId: number;
    customerName: string;
    phone: string;
    body: string;
    authorName: string;
    via: "panel" | "telegram";
  },
  linkedChatIds: readonly string[] = [],
  excludeChatId?: string,
): Promise<TelegramResult> {
  const who = escapeHtml(message.customerName.trim() || "Noma’lum mijoz");
  const phone = message.phone.trim() ? ` · ${escapeHtml(formatUzPhone(message.phone.trim()))}` : "";
  const where = message.via === "panel" ? "admin paneldan" : "Telegram'dan";
  const lines = [
    threadHeader("🔵↩️ OPERATOR JAVOBI", message.threadId),
    RULE,
    `✍️ <b>${escapeHtml(message.authorName)}</b> ${where} javob berdi`,
    `👤 Kimga: <b>${who}</b>${phone}`,
    "",
    quote(message.body),
  ];
  const chats = recipientChats(linkedChatIds, excludeChatId);
  // Nobody else to tell is not a failure.
  if (chats.length === 0) return { sent: true };
  return sendToChats(chats, lines.join("\n"));
}

// The nudge before a pre-order is due. `minutesLeft` is how long until the
// chosen time; zero or less means it is due now (the server may have been
// asleep when the reminder was first due).
export function preorderReminderText(order: {
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  total: string | number | null;
  scheduledLabel: string;
  minutesLeft: number;
}) {
  const when = order.minutesLeft > 0 ? `${order.minutesLeft} daqiqa qoldi` : "vaqti keldi";
  return [
    `🟠⏰ <b>OLDINDAN BUYURTMA · ${when}</b>`,
    `🗓 <b>Yetkazish: ${escapeHtml(order.scheduledLabel)}</b> · #${escapeHtml(order.orderNumber)}`,
    RULE,
    ...customerLines({ name: order.customerName, phone: order.phone, address: order.address }),
    `💰 Jami: <b>${formatMoney(order.total)}</b>`,
  ].join("\n");
}

// A customer's comment on a delivered order. It is not stored anywhere: this
// message is the only place it ends up, so it says everything the admins need
// to know whose it is. Not a chat notification, so a reply to it is not
// routed to anyone (its first line carries no thread number).
export type OrderFeedback = {
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  total: string | number | null;
  telegramName?: string | null;
  telegramUsername?: string | null;
  text: string;
};

export function orderFeedbackText(feedback: OrderFeedback) {
  return [
    `🟡⭐ <b>IZOH</b> · Buyurtma <b>#${escapeHtml(feedback.orderNumber)}</b>`,
    RULE,
    ...customerLines({
      name: feedback.customerName,
      phone: feedback.phone,
      telegramName: feedback.telegramName,
      telegramUsername: feedback.telegramUsername,
      address: feedback.address,
    }),
    `💰 Buyurtma: ${formatMoney(feedback.total)}`,
    "",
    quote(feedback.text),
  ].join("\n");
}

export async function sendOrderFeedback(feedback: OrderFeedback, linkedChatIds: readonly string[] = []): Promise<TelegramResult> {
  return sendToChats(recipientChats(linkedChatIds), orderFeedbackText(feedback));
}

export async function sendPreorderReminder(
  order: Parameters<typeof preorderReminderText>[0],
  linkedChatIds: readonly string[] = [],
): Promise<TelegramResult> {
  return sendToChats(recipientChats(linkedChatIds), preorderReminderText(order));
}

export async function sendNewOrderNotification(
  order: TelegramOrder,
  linkedChatIds: readonly string[] = [],
): Promise<TelegramResult> {
  const lines = Array.isArray(order.items) ? order.items : [];
  const items = lines.length > 0 ? itemsWithinLimit(lines.map(orderLineText)) : "• Mahsulotlar ro‘yxati mavjud emas";

  const number = `<b>#${escapeHtml(order.orderNumber)}</b>`;
  const free = Number(order.deliveryFee ?? 0) === 0;
  const text = [
    order.scheduledLabel ? `🟠⏰ <b>OLDINDAN BUYURTMA</b> · ${number}` : `🟢🛒 <b>YANGI BUYURTMA</b> · ${number}`,
    ...(order.scheduledLabel ? [`🗓 <b>Yetkazish: ${escapeHtml(order.scheduledLabel)}</b>`] : []),
    RULE,
    ...customerLines({
      name: order.customerName,
      phone: order.phone,
      telegramName: order.telegramName,
      telegramUsername: order.telegramUsername,
      address: order.address,
    }),
    "",
    `📦 <b>Mahsulotlar · ${lines.length} xil</b>`,
    items,
    RULE,
    `💰 <b>Jami: ${formatMoney(order.total)}</b>`,
    `🧾 Mahsulotlar: ${formatMoney(order.subtotal)} · 🚚 Yetkazish: ${free ? "bepul 🎁" : formatMoney(order.deliveryFee)}`,
    `💳 To‘lov: ${escapeHtml(paymentLabel(order.paymentMethod))}`,
  ].join("\n");

  return sendToChats(recipientChats(linkedChatIds), text);
}
