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
const THREAD_HEADER_PATTERN = /^[A-Z ]+ · Suhbat #(\d+)$/;
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

function recipientChats(linkedChatIds: readonly string[], exclude?: string) {
  const owner = ownerChatId();
  const all = [...(owner ? [owner] : []), ...linkedChatIds];
  return [...new Set(all)].filter((chatId) => chatId !== exclude);
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
    allowed_updates: ["message"],
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
  message?: {
    message_id?: number;
    chat?: { id?: number | string; type?: string };
    from?: { id?: number };
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
  // A customer opening the bot to verify their phone.
  | { kind: "customer-start"; chatId: string }
  // A shared contact. ownContact is Telegram's own statement that the number
  // belongs to the account that sent it; a forwarded card fails it.
  | { kind: "contact"; chatId: string; telegramUserId: string; phone: string; ownContact: boolean }
  // A reply to one of our chat notifications: deliver it to that thread.
  | { kind: "reply"; chatId: string; threadId: number; body: string; messageId: number; ref: string }
  // Something a known admin sent that we cannot route; answer with a hint.
  | { kind: "hint"; chatId: string; messageId: number }
  // Not ours to handle: a stranger's chat, an edit, and so on.
  | { kind: "ignore" };

// The same ceiling the website puts on a chat message (ChatMessageInput).
export const MAX_REPLY_LENGTH = 1000;
// What createTelegramLinkCode produces: 32 hex characters.
const LINK_COMMAND_PATTERN = /^\/start(?:@\w+)?\s+([0-9a-f]{32})$/;
const CUSTOMER_START_PATTERN = /^\/start(?:@\w+)?\s+login$/;
const BARE_START_PATTERN = /^\/start(?:@\w+)?$/;

// Pure so it can be tested without Telegram: decides what an update means.
// Only the owner's chat and chats linked to an admin are listened to, since
// anybody in the world can message the bot, and only a reply to a message this
// bot wrote is trusted to name a thread.
export function parseAdminUpdate(update: unknown, linkedChatIds: readonly string[] = []): AdminUpdate {
  const bot = resolveBotToken();
  if (!("token" in bot)) return { kind: "ignore" };
  const message = (update as TelegramUpdate | null)?.message;
  if (!message || typeof message.message_id !== "number") return { kind: "ignore" };
  const chatId = String(message.chat?.id ?? "");
  if (!chatId) return { kind: "ignore" };

  const body = typeof message.text === "string" ? message.text.trim() : "";
  const link = LINK_COMMAND_PATTERN.exec(body);
  if (link) return { kind: "link", chatId, code: link[1], messageId: message.message_id };

  // Customers only ever talk to the bot in a private chat.
  const isPrivate = message.chat?.type === undefined || message.chat.type === "private";
  if (message.contact && isPrivate) {
    const senderId = message.from?.id;
    return {
      kind: "contact",
      chatId,
      telegramUserId: String(senderId ?? ""),
      phone: String(message.contact.phone_number ?? ""),
      ownContact: typeof senderId === "number" && message.contact.user_id === senderId,
    };
  }

  const isAdminChat = recipientChats(linkedChatIds).includes(chatId);
  // "/start login" from the site's button, or a bare /start from anyone who is
  // not an admin, is a customer who wants to verify their phone.
  if (isPrivate && (CUSTOMER_START_PATTERN.test(body) || (!isAdminChat && BARE_START_PATTERN.test(body)))) {
    return { kind: "customer-start", chatId };
  }

  if (!isAdminChat) return { kind: "ignore" };

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

export async function sendReplyHint(chatId: string, messageId: number, reason: "unroutable" | "missing-thread") {
  const text = reason === "missing-thread"
    ? "Bu suhbat topilmadi, javob yuborilmadi."
    : `Mijozga javob berish uchun uning xabariga <b>Reply</b> qilib yozing (matn ${MAX_REPLY_LENGTH} belgidan oshmasin).`;
  return sendToChat(chatId, text, messageId);
}

// ---------------------------------------------------------------------------
// Customer phone verification
// ---------------------------------------------------------------------------

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

// Telegram's own button: it sends the account's verified number, which a
// customer cannot type or fake.
export function sendContactRequest(chatId: string) {
  return sendToChatWithMarkup(
    chatId,
    "Q express: telefon raqamingizni tasdiqlash uchun pastdagi <b>📱 Raqamni yuborish</b> tugmasini bosing.",
    {
      keyboard: [[{ text: "📱 Raqamni yuborish", request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  );
}

export function sendLoginCode(chatId: string, code: string) {
  return sendToChatWithMarkup(
    chatId,
    `Kirish kodi: <b>${code}</b>\n\nUni saytga kiriting. Kod 5 daqiqa amal qiladi. <b>Hech kimga bermang</b>, Q express xodimlari ham so‘ramaydi.`,
    { remove_keyboard: true },
  );
}

export function sendContactRejected(chatId: string, reason: "not-own" | "not-uzbek" | "too-many") {
  const text = reason === "not-own"
    ? "Faqat o‘zingizning raqamingizni tugma orqali yuboring."
    : reason === "not-uzbek"
      ? "Faqat O‘zbekiston raqamlari (+998) qabul qilinadi."
      : "Juda ko‘p urinish. Birozdan keyin qayta urinib ko‘ring.";
  return sendToChatWithMarkup(chatId, text, { remove_keyboard: true });
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
export async function sendChatMessageNotification(
  message: { threadId: number; customerName: string; phone: string; body: string },
  linkedChatIds: readonly string[] = [],
): Promise<TelegramResult> {
  const who = message.customerName.trim() || "Noma’lum mijoz";
  const phone = message.phone.trim();
  const lines = [
    threadHeader("YANGI XABAR", message.threadId),
    "",
    "<b>Mijoz:</b> " + escapeHtml(who),
    ...(phone ? ["<b>Telefon:</b> " + escapeHtml(formatUzPhone(phone))] : []),
    "",
    escapeHtml(message.body),
    "",
    "<i>Javob berish uchun shu xabarga Reply qiling.</i>",
  ];
  return sendToChats(recipientChats(linkedChatIds), lines.join("\n"));
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
  const who = message.customerName.trim() || "Noma’lum mijoz";
  const phone = message.phone.trim();
  const where = message.via === "panel" ? "admin paneldan" : "Telegram'dan";
  const lines = [
    threadHeader("OPERATOR JAVOBI", message.threadId),
    `<i>${escapeHtml(message.authorName)} ${where} yozdi</i>`,
    "",
    "<b>Kimga:</b> " + escapeHtml(who),
    ...(phone ? ["<b>Telefon:</b> " + escapeHtml(formatUzPhone(phone))] : []),
    "",
    escapeHtml(message.body),
  ];
  const chats = recipientChats(linkedChatIds, excludeChatId);
  // Nobody else to tell is not a failure.
  if (chats.length === 0) return { sent: true };
  return sendToChats(chats, lines.join("\n"));
}

export async function sendNewOrderNotification(
  order: TelegramOrder,
  linkedChatIds: readonly string[] = [],
): Promise<TelegramResult> {
  const items = Array.isArray(order.items)
    ? order.items
        .map((item) => {
          const line = item as {
            name?: string;
            quantity?: number;
            unit?: string;
            total?: number;
            purchase_mode?: "quantity" | "amount";
            requested_amount?: number | null;
          };
          const quantity = `${line.quantity ?? 0} ${escapeHtml(line.unit ?? "")}`;
          const priceText = line.purchase_mode === "amount" && line.requested_amount != null
            ? `${formatMoney(line.requested_amount)} (~${quantity})`
            : formatMoney(line.total ?? 0);
          return `• ${escapeHtml(line.name ?? "Mahsulot")} × ${priceText}`;
        })
        .join("\n")
    : "• Mahsulotlar ro‘yxati mavjud emas";

  const text = [
    "<b>YANGI BUYURTMA</b>",
    "",
    `<b>Order:</b> #${escapeHtml(order.orderNumber)}`,
    `<b>Mijoz:</b> ${escapeHtml(order.customerName)}`,
    `<b>Telefon:</b> ${escapeHtml(formatUzPhone(order.phone))}`,
    "",
    "<b>Mahsulotlar:</b>",
    items,
    "",
    `<b>Mahsulotlar:</b> ${formatMoney(order.subtotal)}`,
    `<b>Yetkazib berish:</b> ${formatMoney(order.deliveryFee)}`,
    `<b>Jami:</b> ${formatMoney(order.total)}`,
    `<b>To‘lov:</b> ${escapeHtml(order.paymentMethod)}`,
    "",
    `<b>Manzil:</b> ${escapeHtml(order.address)}`,
  ].join("\n");

  return sendToChats(recipientChats(linkedChatIds), text);
}
