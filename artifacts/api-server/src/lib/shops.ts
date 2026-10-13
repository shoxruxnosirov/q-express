import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { asc } from "drizzle-orm";
import { db } from "@workspace/db";
import { PLATFORM_SHOP_ID, shopsTable } from "@workspace/db/schema";
import type { StoreHours } from "./store-hours";
import { logger } from "./logger";
import { envBotContext, getBotUsername, knownBotUsername, registerMenuButton, registerWebhook, unregisterWebhook, withBot, type BotContext } from "./telegram";

// The platform runs several shops. Shop 1 is Q express, the platform's own:
// its bot comes from the environment as it always did. Every other shop was
// created by a Q express super admin and has its own bot, whose token is
// stored here encrypted.

export type ShopRow = typeof shopsTable.$inferSelect;

export { PLATFORM_SHOP_ID };

export function isPlatformShop(shop: Pick<ShopRow, "id">) {
  return shop.id === PLATFORM_SHOP_ID;
}

// A shop a platform super admin "deleted": kept for its history, closed to
// everyone else (routes/shops.ts).
export function isArchived(shop: Pick<ShopRow, "archivedAt">) {
  return shop.archivedAt !== null;
}

// The shops table is small and read on nearly every request, so it is kept in
// memory for a short while. Every write in this process forgets it at once
// (forgetShops), so a changed fee or hours apply to the very next order; the
// time limit only covers a change made elsewhere, such as by hand in the
// database.
const SHOPS_TTL_MS = 30_000;
let cached: { at: number; shops: Promise<ShopRow[]> } | undefined;

export function forgetShops() {
  cached = undefined;
}

export async function listShops(): Promise<ShopRow[]> {
  if (!cached || Date.now() - cached.at > SHOPS_TTL_MS) {
    const shops = db.select().from(shopsTable).orderBy(asc(shopsTable.sortOrder), asc(shopsTable.id));
    const entry = { at: Date.now(), shops };
    cached = entry;
    // A failed read is not kept, so the next request tries again.
    shops.catch(() => {
      if (cached === entry) cached = undefined;
    });
  }
  return cached.shops;
}

export async function loadShop(id: number): Promise<ShopRow | undefined> {
  return (await listShops()).find((shop) => shop.id === id);
}

export async function shopBySlug(slug: string): Promise<ShopRow | undefined> {
  return (await listShops()).find((shop) => shop.slug === slug);
}

// Where the site is served from, for the bots' webhooks and Mini App links.
// Render names it in RENDER_EXTERNAL_URL; PUBLIC_BASE_URL overrides it.
export function publicBaseUrl(req: { get(name: string): string | undefined }) {
  return process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `https://${req.get("host")}`;
}

// The shop a storefront request is about: ?shop=<slug>, Q express when absent.
// A hidden or unknown shop answers like a missing one.
export async function requestShop(value: unknown): Promise<ShopRow | undefined> {
  const slug = typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
  const shop = slug ? await shopBySlug(slug) : await loadShop(PLATFORM_SHOP_ID);
  return shop && shop.active && !isArchived(shop) ? shop : undefined;
}

export function shopHours(shop: ShopRow): StoreHours {
  return { openTime: shop.openTime, closeTime: shop.closeTime, acceptingOrders: shop.acceptingOrders };
}

export function deliveryFeeCents(shop: ShopRow) {
  return Math.round(Number(shop.deliveryFee) * 100);
}

// Where the shop lives on the site: Q express at the root, the others under
// /s/<slug>. Bot buttons and the Mini App menu open the shop there.
export function shopAppPath(shop: Pick<ShopRow, "id" | "slug">) {
  return isPlatformShop(shop) ? "" : `/s/${shop.slug}`;
}

// ---------------------------------------------------------------------------
// Bot tokens
//
// AES-256-GCM under a key derived from SESSION_SECRET, which only lives in the
// Render dashboard: a leaked database alone does not hand out the shops' bots.
// Stored as "v1.<iv>.<tag>.<ciphertext>", base64url.
// ---------------------------------------------------------------------------

function tokenKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to store bot tokens");
  return createHash("sha256").update(`shop-bot-token:${secret}`).digest();
}

export function encryptBotToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptBotToken(stored: string | null): string | undefined {
  if (!stored) return undefined;
  const [version, iv, tag, data] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !data) return undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // SESSION_SECRET changed since it was saved: the token has to be entered
    // again, and until then the shop's bot is silent rather than broken.
    return undefined;
  }
}

// A bot token as BotFather issues it: "<bot id>:<secret>".
export function isBotTokenShape(token: string) {
  return /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/.test(token);
}

// The bot a shop speaks through. Q express's is the environment's.
// Another shop's bot links customers to Q express's Mini App, so it carries
// Q express's bot @username. That is asked of Telegram once (every server
// start does it, in connectShopBot) and never waited on here: a webhook or an
// order must not hang on a slow getMe. Until it is known, the buttons open the
// shop's page in the browser instead.
export async function shopBot(shop: ShopRow): Promise<BotContext> {
  const platform = envBotContext();
  if (isPlatformShop(shop)) {
    return { ...platform, shopId: shop.id, shopName: shop.name, freeFirstDelivery: shop.freeFirstDelivery };
  }
  const learned = knownBotUsername(platform.token);
  if (!learned) void learnPlatformBotUsername();
  const miniAppBot = learned ?? configuredPlatformBotUsername();
  return {
    miniAppBot,
    shopId: shop.id,
    shopName: shop.name,
    platform: false,
    // An archived shop's bot is silent: nothing is sent through it.
    token: isArchived(shop) ? undefined : decryptBotToken(shop.botTokenEnc),
    ownerChatId: shop.ownerChatId ?? undefined,
    appPath: shopAppPath(shop),
    webhookPath: `/api/telegram/webhook/${shop.id}`,
    freeFirstDelivery: shop.freeFirstDelivery,
  };
}

// Q express's bot @username as the Render dashboard names it
// (TELEGRAM_BOT_USERNAME), so another shop's buttons open the Mini App from
// the very first message after a start, before getMe has answered. What
// Telegram says wins once known: the setting could name the other bot mode's
// bot.
function configuredPlatformBotUsername() {
  const value = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  return value && /^[A-Za-z0-9_]{5,64}$/.test(value) ? value : undefined;
}

// One lookup at a time; a failed one is tried again on the next need.
let learning: Promise<unknown> | undefined;
function learnPlatformBotUsername() {
  learning ??= withBot(envBotContext(), () => getBotUsername())
    .then((username) => {
      const configured = configuredPlatformBotUsername();
      if (username && configured && username.toLowerCase() !== configured.toLowerCase()) {
        logger.warn({ configured, actual: username }, "TELEGRAM_BOT_USERNAME is not the bot in use");
      }
    })
    .catch(() => undefined)
    .finally(() => {
      learning = undefined;
    });
  return learning;
}

// The other shops with a bot: the bots each server start points at itself
// once Q express's own is connected (connectShopBot).
export async function otherShopsWithBots(): Promise<ShopRow[]> {
  const shops = await listShops();
  return shops.filter((shop) => !isPlatformShop(shop) && !isArchived(shop) && shop.botTokenEnc !== null);
}

// Whether each bot is pointed at this server, as this process last tried it.
// Kept in memory on purpose: every start connects every bot again, so what an
// earlier process saw says nothing about now. Shown to the platform's super
// admins next to the shop, with a button to try again.
export type BotStatus = { state: "connecting" | "connected" | "failed"; error: string | null; at: Date };
const botStatuses = new Map<number, BotStatus>();

export function botStatus(shopId: number): BotStatus | undefined {
  return botStatuses.get(shopId);
}

// Points a bot at this server and sets its menu button. Best effort: the shop
// is saved either way, and every server start tries again. Q express's bot is
// the environment's, so connecting it needs no database.
async function connectBot(bot: BotContext, baseUrl: string): Promise<BotStatus> {
  botStatuses.set(bot.shopId, { state: "connecting", error: null, at: new Date() });
  let status: BotStatus;
  try {
    status = await withBot(bot, async () => {
      const webhook = await registerWebhook(baseUrl);
      if (webhook.sent) logger.info({ shopId: bot.shopId }, "Telegram webhook registered");
      else logger.warn({ shopId: bot.shopId, reason: webhook.error }, "Telegram webhook not registered");
      const menu = await registerMenuButton(baseUrl);
      if (!menu.sent) logger.warn({ shopId: bot.shopId, reason: menu.error }, "Telegram menu button not set");
      if (webhook.sent && menu.sent) return { state: "connected", error: null, at: new Date() };
      return { state: "failed", error: (!webhook.sent ? webhook.error : menu.error) ?? "Telegram did not confirm", at: new Date() };
    });
  } catch (error) {
    logger.warn({ shopId: bot.shopId, error }, "Telegram bot not connected");
    status = { state: "failed", error: error instanceof Error ? error.message : String(error), at: new Date() };
  }
  botStatuses.set(bot.shopId, status);
  return status;
}

export function connectPlatformBot(baseUrl: string) {
  return connectBot(envBotContext(), baseUrl);
}

export async function connectShopBot(shop: ShopRow, baseUrl: string) {
  if (!isPlatformShop(shop)) await learnPlatformBotUsername();
  return connectBot(await shopBot(shop), baseUrl);
}

// The same without making the caller wait: a request that has already saved
// the shop answers at once, and the outcome shows as the shop's bot status.
export function connectShopBotLater(shop: ShopRow, baseUrl: string) {
  botStatuses.set(shop.id, { state: "connecting", error: null, at: new Date() });
  void connectShopBot(shop, baseUrl).catch((error) => logger.warn({ shopId: shop.id, error }, "Telegram bot not connected"));
}

// An archived shop's bot stops hearing from Telegram. Given the shop as it was
// before archiving, while its token still opens the bot. Best effort: the
// webhook ignores an archived shop anyway.
export async function disconnectShopBot(shop: ShopRow) {
  botStatuses.delete(shop.id);
  if (isPlatformShop(shop)) return;
  try {
    const result = await withBot(await shopBot(shop), () => unregisterWebhook());
    if (!result.sent) logger.warn({ shopId: shop.id, reason: result.error }, "Telegram webhook not removed");
  } catch (error) {
    logger.warn({ shopId: shop.id, error }, "Telegram webhook not removed");
  }
}

export function shopDto(shop: ShopRow) {
  return {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    is_platform: isPlatformShop(shop),
    card: shop.card ?? {},
    sort_order: shop.sortOrder,
    delivery_fee: Number(shop.deliveryFee),
    free_first_delivery: shop.freeFirstDelivery,
  };
}

// What an admin of the platform sees of a shop. Never the token itself.
export function adminShopDto(shop: ShopRow) {
  return {
    ...shopDto(shop),
    order_prefix: shop.orderPrefix,
    active: shop.active,
    open_time: shop.openTime,
    close_time: shop.closeTime,
    accepting_orders: shop.acceptingOrders,
    bot_username: isPlatformShop(shop) ? null : shop.botUsername,
    bot_configured: isPlatformShop(shop) ? true : Boolean(decryptBotToken(shop.botTokenEnc)),
    // Unknown until this process has tried, as in development without a
    // public address.
    bot_status: botStatus(shop.id)?.state ?? "unknown",
    bot_error: botStatus(shop.id)?.error ?? null,
    owner_chat_id: isPlatformShop(shop) ? null : shop.ownerChatId,
    archived_at: shop.archivedAt ? shop.archivedAt.toISOString() : null,
    created_at: shop.createdAt.toISOString(),
  };
}
