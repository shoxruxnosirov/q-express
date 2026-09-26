import { createHmac, timingSafeEqual } from "node:crypto";

const TELEGRAM_API = "https://api.telegram.org";

// Every chat notification carries this line, and a reply in Telegram is routed
// back to the customer by reading it from the message being replied to. The
// renderer and the parser share one place so they cannot drift apart.
const THREAD_LABEL = "Suhbat:";
const THREAD_PATTERN = new RegExp(`${THREAD_LABEL}\\s*#(\\d+)`);

function threadLine(threadId: number) {
  return `<b>${THREAD_LABEL}</b> #${threadId}`;
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

function formatMoney(value: string | number | null) {
  return `${Number(value ?? 0).toLocaleString("ru-RU")} so'm`;
}

type TelegramCredentials = { token: string; chatId: string };

// The code never checks which bot a token belongs to, so the mode alone decides
// which variable is read, and a missing one is never quietly swapped for the
// other bot's.
function resolveCredentials(): TelegramCredentials | TelegramResult {
  const botMode = process.env.TELEGRAM_BOT_MODE ?? "legacy";
  if (botMode !== "legacy" && botMode !== "new") {
    return { sent: false, error: "Telegram bot mode is invalid" };
  }
  const token = botMode === "new"
    ? process.env.TELEGRAM_NEW_BOT_TOKEN
    : process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token || !chatId) {
    return { sent: false, error: "Telegram bot configuration is missing" };
  }
  return { token, chatId };
}

async function callBotApi(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<TelegramResult> {
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(payload),
    });

    const result = (await response.json()) as { ok?: boolean; error_code?: number };
    if (!response.ok || !result.ok) {
      return { sent: false, error: `Telegram returned ${result.error_code ?? response.status}` };
    }

    return { sent: true };
  } catch {
    return {
      sent: false,
      // Fetch errors may contain the token-bearing URL. Never return raw errors.
      error: "Telegram request failed or timed out",
    };
  }
}

async function sendToAdminChat(text: string, replyToMessageId?: number): Promise<TelegramResult> {
  const credentials = resolveCredentials();
  if (!("token" in credentials)) return credentials;
  const { token, chatId } = credentials;
  return callBotApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyToMessageId === undefined
      ? {}
      : { reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true } }),
  });
}

// ---------------------------------------------------------------------------
// Replies from Telegram
//
// The operator answers a customer by replying, in the admin chat, to the
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
  const credentials = resolveCredentials();
  const sessionSecret = process.env.SESSION_SECRET;
  if (!("token" in credentials) || !sessionSecret) return undefined;
  return createHmac("sha256", sessionSecret)
    .update(`telegram-webhook:${credentials.token}`)
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
  const credentials = resolveCredentials();
  if (!("token" in credentials)) return credentials;
  const secret = webhookSecret();
  if (!secret) return { sent: false, error: "SESSION_SECRET is required for the Telegram webhook" };
  return callBotApi(credentials.token, "setWebhook", {
    url: `${baseUrl.replace(/\/+$/, "")}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message"],
  });
}

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    chat?: { id?: number | string };
    text?: string;
    reply_to_message?: {
      from?: { id?: number; is_bot?: boolean };
      text?: string;
    };
  };
};

export type AdminReply =
  // A reply to one of our chat notifications: deliver it to that thread.
  | { kind: "reply"; threadId: number; body: string; messageId: number; ref: string }
  // Something the operator sent that we cannot route; answer with a hint.
  | { kind: "hint"; messageId: number }
  // Not ours to handle at all: another chat, an edit, a sticker, and so on.
  | { kind: "ignore" };

export const MAX_REPLY_LENGTH = 2000;

// Pure so it can be tested without Telegram: decides what an update means.
// Only the configured admin chat is ever listened to, since anybody in the
// world can message the bot, and only a reply to a message this bot wrote is
// trusted to name a thread.
export function parseAdminReply(update: unknown): AdminReply {
  const credentials = resolveCredentials();
  if (!("token" in credentials)) return { kind: "ignore" };
  const message = (update as TelegramUpdate | null)?.message;
  if (!message || typeof message.message_id !== "number") return { kind: "ignore" };
  if (String(message.chat?.id ?? "") !== credentials.chatId) return { kind: "ignore" };

  const body = typeof message.text === "string" ? message.text.trim() : "";
  const original = message.reply_to_message;
  const botId = Number(credentials.token.split(":")[0]);
  const fromThisBot = original?.from?.is_bot === true && original.from.id === botId;
  const match = fromThisBot ? THREAD_PATTERN.exec(original?.text ?? "") : null;

  if (!match || !body || body.length > MAX_REPLY_LENGTH) {
    return { kind: "hint", messageId: message.message_id };
  }
  return {
    kind: "reply",
    threadId: Number(match[1]),
    body,
    messageId: message.message_id,
    // Telegram retries a webhook it thinks failed, for instance while this
    // instance is still waking up. Storing this key with a unique index makes
    // a retried update land once.
    ref: `${credentials.chatId}:${message.message_id}`,
  };
}

// A thumbs-up on the operator's own message says "delivered" without adding
// another message to the chat. Best effort: a missing reaction loses nothing.
export async function acknowledgeAdminReply(messageId: number): Promise<TelegramResult> {
  const credentials = resolveCredentials();
  if (!("token" in credentials)) return credentials;
  return callBotApi(credentials.token, "setMessageReaction", {
    chat_id: credentials.chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji: "👍" }],
  });
}

export async function sendReplyHint(messageId: number, reason: "unroutable" | "missing-thread") {
  const text = reason === "missing-thread"
    ? "Bu suhbat topilmadi, javob yuborilmadi."
    : `Mijozga javob berish uchun uning xabariga <b>Reply</b> qilib yozing (matn ${MAX_REPLY_LENGTH} belgidan oshmasin).`;
  return sendToAdminChat(text, messageId);
}

// The operator is not always watching the dashboard, so a customer's message
// reaches the same chat the order notifications already go to.
export async function sendChatMessageNotification(message: {
  threadId: number;
  customerName: string;
  phone: string;
  body: string;
}): Promise<TelegramResult> {
  const who = message.customerName.trim() || "Noma’lum mijoz";
  const phone = message.phone.trim();
  const lines = [
    "<b>YANGI XABAR</b>",
    "",
    "<b>Mijoz:</b> " + escapeHtml(who),
    ...(phone ? ["<b>Telefon:</b> " + escapeHtml(phone)] : []),
    threadLine(message.threadId),
    "",
    escapeHtml(message.body),
    "",
    "<i>Javob berish uchun shu xabarga Reply qiling.</i>",
  ];
  return sendToAdminChat(lines.join("\n"));
}

// What the operator wrote from the dashboard, copied to Telegram so the admin
// chat holds the whole conversation. It carries the thread line too, so the
// operator can carry on by replying to it.
export async function sendOperatorReplyNotification(message: {
  threadId: number;
  customerName: string;
  phone: string;
  body: string;
}): Promise<TelegramResult> {
  const who = message.customerName.trim() || "Noma’lum mijoz";
  const phone = message.phone.trim();
  const lines = [
    "<b>OPERATOR JAVOBI</b> (admin panel)",
    "",
    "<b>Kimga:</b> " + escapeHtml(who),
    ...(phone ? ["<b>Telefon:</b> " + escapeHtml(phone)] : []),
    threadLine(message.threadId),
    "",
    escapeHtml(message.body),
  ];
  return sendToAdminChat(lines.join("\n"));
}

export async function sendNewOrderNotification(order: TelegramOrder): Promise<TelegramResult> {
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
    `<b>Telefon:</b> ${escapeHtml(order.phone)}`,
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

  return sendToAdminChat(text);
}
