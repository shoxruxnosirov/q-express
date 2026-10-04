import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, ilike, isNotNull, isNull, sql } from "drizzle-orm";
import {
  CreateOrderBody,
  CreateAdminCategoryBody,
  CreateAdminProductBody,
  DeleteAdminProductParams,
  GetAdminChatTranscriptParams,
  SendAdminChatMessageBody,
  SendAdminChatMessageParams,
  DeleteAdminChatParams,
  SendChatMessageBody,
  StartChatSessionBody,
  GetDeliveryFeeEstimateQueryParams,
  GetOrderParams,
  SendOrderFeedbackBody,
  SendOrderFeedbackParams,
  UpdateStoreHoursBody,
  GetProductParams,
  ListAdminOrdersQueryParams,
  ListProductsQueryParams,
  UpdateAdminProductBody,
  UpdateAdminProductParams,
  UpdateAdminOrderStatusBody,
  UpdateAdminOrderStatusParams,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  adminsTable,
  categoriesTable,
  chatMessagesTable,
  chatThreadsTable,
  ordersTable,
  productsTable,
  storeSettingsTable,
  usersTable,
} from "@workspace/db/schema";
import {
  deliverySlots,
  earliestAcceptedAt,
  formatTashkent,
  isOpenNow,
  isValidTime,
  nextOpenAt,
  scheduleProblem,
  type StoreHours,
} from "../lib/store-hours";
import {
  acknowledgeAdminReply,
  parseAdminUpdate,
  sendChatMessageNotification,
  sendCustomerEcho,
  sendLinkResult,
  sendNewOrderNotification,
  sendOrderFeedback,
  type ChatSource,
  sendOperatorReplyNotification,
  isAdminChat,
  leaveChat,
  sendCustomerNotice,
  sendCustomerReply,
  sendReplyHint,
  sendWelcome,
  webhookSecretMatches,
} from "../lib/telegram";
import { linkedTelegramChatIds, linkedTelegramRecipients, signedInAdmin } from "../lib/admin-directory";
import { telegramLinkHash } from "./admins";
import {
  BLOCKED_MESSAGE,
  chatIsOpen,
  customerIsBlocked,
  isVerified,
  telegramCustomer,
  telegramIsBlocked,
  rememberOrderAddress,
  resolveCustomer,
} from "../lib/customer-accounts";
import { normalizeUzPhone } from "../lib/phone";
import { addressKey, canChangeStatus, stockToRestore, tashkentDayStart, tashkentWeekStart } from "../lib/order-rules";
import {
  createChatToken,
  hashChatToken,
  readChatToken,
} from "../lib/chat-session";
import { createRateLimiter } from "../lib/rate-window";
import {
  createUploadTicket,
  deleteImage,
  isCloudinaryConfigured,
  isOwnImageUrl,
} from "../lib/cloudinary";
import {
  addMicroquantities,
  deriveAmountQuantityMicro,
  MICROQUANTITY_SCALE,
  quantityTotalCents,
  requireWholeUnitQuantity,
} from "../lib/quantity";

const router: IRouter = Router();
const DELIVERY_FEE_CENTS = 4590 * 100;
const THOUSANDTH_SCALE = 1_000;
// numeric(12,2) is used by prices and order totals.
const MAX_MONEY_CENTS = 999_999_999_999;
const WEEKLY_PRIZE = "Maxsus sovg‘a";

// Everything limited per caller is keyed by this. Behind Render the socket
// address is always their proxy, so app.ts trusts exactly one hop and req.ip
// becomes the address Render reports for the client.
function clientKey(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

const seedCategories = [
  { name: "Meva va sabzavotlar", slug: "meva-sabzavot", icon: "leaf", sortOrder: 1 },
  { name: "Sut mahsulotlari", slug: "sut", icon: "milk", sortOrder: 2 },
  { name: "Non va bakery", slug: "non-bakery", icon: "wheat", sortOrder: 3 },
  { name: "Go‘sht", slug: "gosht", icon: "beef", sortOrder: 4 },
  { name: "Ichimliklar", slug: "ichimliklar", icon: "cup", sortOrder: 5 },
  { name: "Shirinliklar", slug: "shirinliklar", icon: "cookie", sortOrder: 6 },
  { name: "Maishiy", slug: "maishiy", icon: "sparkles", sortOrder: 7 },
  { name: "Gigiyena", slug: "gigiyena", icon: "hand", sortOrder: 8 },
];

const seedProducts = [
  {
    categorySlug: "meva-sabzavot",
    name: "Qizil olma",
    description: "Shirin va xushbo‘y bog‘ olmalari",
    imageUrl: "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=640&q=85",
    price: "18000",
    oldPrice: "22000",
    unit: "kg",
    stock: 34,
    isPopular: true,
    isNew: false,
  },
  {
    categorySlug: "meva-sabzavot",
    name: "Avokado",
    description: "Pishgan, yumshoq va foydali avokado",
    imageUrl: "https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=640&q=85",
    price: "32000",
    oldPrice: null,
    unit: "dona",
    stock: 18,
    isPopular: true,
    isNew: true,
  },
  {
    categorySlug: "sut",
    name: "Qatiq 2.5%",
    description: "Kundalik nonushta uchun tabiiy qatiq",
    imageUrl: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=640&q=85",
    price: "12500",
    oldPrice: null,
    unit: "qadoq",
    stock: 26,
    isPopular: true,
    isNew: false,
  },
  {
    categorySlug: "non-bakery",
    name: "Tandir non",
    description: "Har kuni yangi yopilgan issiq non",
    imageUrl: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=640&q=85",
    price: "5000",
    oldPrice: null,
    unit: "dona",
    stock: 45,
    isPopular: true,
    isNew: false,
  },
  {
    categorySlug: "gosht",
    name: "Mol go‘shti",
    description: "Yumshoq va sifatli saralangan go‘sht",
    imageUrl: "https://images.unsplash.com/photo-1603048297172-c92544798d5a?auto=format&fit=crop&w=640&q=85",
    price: "98000",
    oldPrice: "110000",
    unit: "kg",
    stock: 9,
    isPopular: false,
    isNew: true,
  },
  {
    categorySlug: "ichimliklar",
    name: "Gazsiz suv 1.5L",
    description: "Toza buloq suvi",
    imageUrl: "https://images.unsplash.com/photo-1548839140-29a749e1cf4d?auto=format&fit=crop&w=640&q=85",
    price: "4500",
    oldPrice: null,
    unit: "litr",
    stock: 60,
    isPopular: false,
    isNew: false,
  },
  {
    categorySlug: "shirinliklar",
    name: "Qora shokolad",
    description: "Kakao miqdori yuqori premium shokolad",
    imageUrl: "https://images.unsplash.com/photo-1511381939415-e44015466834?auto=format&fit=crop&w=640&q=85",
    price: "28000",
    oldPrice: "35000",
    unit: "qadoq",
    stock: 14,
    isPopular: true,
    isNew: false,
  },
  {
    categorySlug: "maishiy",
    name: "Idish yuvish geli",
    description: "Yog‘larni tez ketkazadigan limonli gel",
    imageUrl: "https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=640&q=85",
    price: "24000",
    oldPrice: null,
    unit: "dona",
    stock: 3,
    isPopular: false,
    isNew: false,
  },
];

let seedPromise: Promise<void> | undefined;

async function ensureSeedData() {
  if (!seedPromise) {
    seedPromise = (async () => {
      // Keyed on categories, not products: an operator who deletes every
      // product must get an empty catalog, not a reseed that collides with
      // the category slugs still there and fails every request after it.
      const existing = await db.select({ id: categoriesTable.id }).from(categoriesTable).limit(1);
      if (existing.length > 0) return;

      const categories = await db.insert(categoriesTable).values(seedCategories).returning();
      const categoryBySlug = new Map(categories.map((category) => [category.slug, category.id]));
      await db.insert(productsTable).values(
        seedProducts.map(({ categorySlug, ...product }) => ({
          ...product,
          categoryId: categoryBySlug.get(categorySlug)!,
        })),
      );
    })();
    // A rejected promise must not stay cached, or every later request
    // repeats the first failure long after its cause is gone.
    seedPromise.catch(() => {
      seedPromise = undefined;
    });
  }
  await seedPromise;
}

function money(value: string | number | null) {
  return value === null ? null : Number(value);
}

type ProductUnit = "dona" | "kg" | "litr" | "qadoq";
type PurchaseMode = "quantity" | "amount";

class OrderValidationError extends Error {}

function invalidOrder(message: string): never {
  throw new OrderValidationError(message);
}

function scaledInteger(value: number, scale: number, label: string, positive = false) {
  if (!Number.isFinite(value) || !Number.isSafeInteger(Math.round(value * scale))) {
    invalidOrder(`${label} noto‘g‘ri yoki chegaradan tashqari`);
  }
  const scaled = Math.round(value * scale);
  if (Math.abs(value * scale - scaled) > 1e-7) {
    invalidOrder(`${label} aniqligi noto‘g‘ri`);
  }
  if ((positive && scaled <= 0) || (!positive && scaled < 0)) {
    invalidOrder(`${label} musbat bo‘lishi kerak`);
  }
  return scaled;
}

function priceCents(value: string | number | null, label = "Narx") {
  if (value === null) invalidOrder(`${label} mavjud emas`);
  const cents = scaledInteger(Number(value), 100, label, true);
  if (cents > MAX_MONEY_CENTS) invalidOrder(`${label} chegaradan tashqari`);
  return cents;
}

function stockMicro(value: number | string) {
  return scaledInteger(Number(value), MICROQUANTITY_SCALE, "Ombor qoldig‘i");
}

function validateAdminProductNumbers(input: {
  price?: number;
  old_price?: number | null;
  stock?: number;
  unit?: ProductUnit;
}) {
  if (input.price !== undefined) priceCents(input.price);
  if (input.old_price !== undefined && input.old_price !== null) {
    if (!Number.isFinite(input.old_price)) invalidOrder("Eski narx noto‘g‘ri");
    if (scaledInteger(input.old_price, 100, "Eski narx") > MAX_MONEY_CENTS) {
      invalidOrder("Eski narx chegaradan tashqari");
    }
  }
  if (input.stock !== undefined) {
    const unit = input.unit;
    if (!unit) invalidOrder("Ombor birligi ko‘rsatilmagan");
    if (unit === "dona" || unit === "qadoq") {
      scaledInteger(input.stock, 1, "Ombor qoldig‘i");
    } else {
      stockMicro(input.stock);
    }
  }
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function maskPhone(phone: string) {
  const digits = normalizePhone(phone);
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "Noma’lum";
}

function realCustomerName(value: string) {
  const name = value.trim();
  const placeholderNames = new Set(["", "telegram mijoz", "mijoz", "mehmon", "ism kiritilmagan"]);
  return placeholderNames.has(name.toLocaleLowerCase("uz-UZ")) ? undefined : name;
}

function weeklyLeaderboard(orders: Array<typeof ordersTable.$inferSelect>) {
  // Monday 00:00 on the shop's clock, not the server's UTC one.
  const start = tashkentWeekStart();
  const customers = new Map<string, { phone: string; realName?: string; realNameAt?: Date; orderCount: number }>();
  const knownNames = new Map<string, { name: string; createdAt: Date }>();

  for (const order of orders) {
    const normalizedPhone = normalizePhone(order.phone);
    const name = realCustomerName(order.customerName);
    const known = knownNames.get(normalizedPhone);
    if (name && (!known || order.createdAt > known.createdAt)) {
      knownNames.set(normalizedPhone, { name, createdAt: order.createdAt });
    }
  }

  for (const order of orders) {
    if (order.status === "cancelled" || order.createdAt < start) continue;
    const normalizedPhone = normalizePhone(order.phone);
    const knownName = knownNames.get(normalizedPhone);
    const existing = customers.get(normalizedPhone);
    if (existing) {
      existing.orderCount += 1;
      if (knownName && (!existing.realNameAt || knownName.createdAt > existing.realNameAt)) {
        existing.realName = knownName.name;
        existing.realNameAt = knownName.createdAt;
      }
    } else {
      customers.set(normalizedPhone, {
        phone: normalizedPhone,
        realName: knownName?.name,
        realNameAt: knownName?.createdAt,
        orderCount: 1,
      });
    }
  }

  return [...customers.values()]
    .sort((a, b) => b.orderCount - a.orderCount || a.phone.localeCompare(b.phone))
    .slice(0, 10)
    .map((customer, index) => ({
      rank: index + 1,
      customer_name: customer.realName ?? "Ism kiritilmagan",
      phone_masked: maskPhone(customer.phone),
      order_count: customer.orderCount,
      is_winner: index === 0,
      prize: index === 0 ? WEEKLY_PRIZE : null,
    }));
}

function productDto(product: typeof productsTable.$inferSelect, category: string) {
  return {
    id: product.id,
    category_id: product.categoryId,
    category,
    name: product.name,
    description: product.description,
    image_url: product.imageUrl,
    price: money(product.price),
    old_price: money(product.oldPrice),
    unit: product.unit as "dona" | "kg" | "litr" | "qadoq",
    stock: Number(product.stock),
    is_popular: product.isPopular,
    is_new: product.isNew,
  };
}

// An image_public_id is a claim that we own the file and may delete it later.
// Only honour that claim when image_url really points into our own Cloudinary
// account. Otherwise a wrong value would either make us delete a stranger's
// file or, worse, delete ours while the product still displays a foreign link.
function resolveImagePublicId(
  imageUrl: string | undefined,
  imagePublicId: string | null | undefined,
) {
  if (imagePublicId === undefined) return undefined;
  if (imagePublicId === null) return null;
  if (!imageUrl || !isOwnImageUrl(imageUrl)) {
    invalidOrder("Rasm manzili yuklangan faylga mos kelmadi");
  }
  return imagePublicId;
}

// Deleting the stored file is best effort and never fails the request. The
// database row is already written by the time this runs, so a failure leaves
// an unreferenced file in Cloudinary rather than a product whose image is gone.
async function discardStoredImage(req: Request, publicId: string | null | undefined) {
  if (!publicId) return;
  const outcome = await deleteImage(publicId);
  if (!outcome.deleted) {
    req.log.warn({ publicId, reason: outcome.reason }, "Stored image delete failed");
  }
}

function adminProductDto(product: typeof productsTable.$inferSelect, category: string) {
  return { ...productDto(product, category), active: product.active };
}

// A customer may send twenty messages a minute, which is far more than anyone
// types and far less than a script would. Keyed by thread, so one abusive
// conversation cannot silence the rest.
const chatMessageLimiter = createRateLimiter<number>({ windowMs: 60 * 1000, max: 5 });

// Opening a conversation is the one chat action that needs no cookie, so it is
// the one a script can repeat from nothing, and every such call writes a row.
// The message limit above cannot see it: each new thread arrives with its own
// empty counter, so a script that opens a thread per message never trips it.
// Ten an hour per address is far more than a household needs and far less than
// a flood, and only a caller that actually creates a thread is charged.
const chatSessionLimiter = createRateLimiter<string>({ windowMs: 60 * 60 * 1000, max: 10 });

function chatMessageDto(message: typeof chatMessagesTable.$inferSelect) {
  return {
    id: message.id,
    sender: message.sender as "customer" | "operator",
    body: message.body,
    created_at: message.createdAt.toISOString(),
  };
}

// The cookie holds the secret; only its hash is stored, so the lookup is by
// hash and there is nothing to compare in constant time.
async function loadThreadByToken(token: string | undefined) {
  if (!token) return undefined;
  const [thread] = await db
    .select()
    .from(chatThreadsTable)
    .where(eq(chatThreadsTable.tokenHash, hashChatToken(token)))
    .limit(1);
  return thread;
}

// The conversation this request may read and write: the signed-in customer's,
// reached through their session on any device. A session that was revoked
// reaches nothing, and a blocked one (or a blocked customer) can neither read
// nor write. A thread a browser's old chat cookie opened before accounts is
// adopted by the account once, unless it already belongs to someone else.
async function resolveThread(req: Request, res: Response) {
  const found = await findThread(req, res);
  const blocked = customerIsBlocked(found.customer);
  // The chat is shared with the bot, so it is for customers who belong to a
  // Telegram account; a browser guest is sent to Telegram.
  const closed = !found.customer || !chatIsOpen(found.customer.user);
  return { ...found, blocked, closed };
}

const CHAT_CLOSED_MESSAGE = "Chat do‘konning Telegram botida ishlaydi. Do‘konni Telegram orqali oching.";
const TELEGRAM_REQUIRED_MESSAGE = "Buyurtma Telegram'dagi do‘kon orqali qabul qilinadi. Do‘konni Telegram'da oching.";

// Orders a customer has placed and not cancelled, so the admins can tell a
// buyer from someone who has only written.
async function activeOrderCount(userId: number | null) {
  if (userId === null) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(ordersTable)
    .where(and(eq(ordersTable.userId, userId), sql`${ordersTable.status} <> 'cancelled'`));
  return Number(row.count);
}

// A customer's message reaches every admin chat as a chat (not an order),
// with who they are now: the account's current name and phone, which the
// thread only copied when it opened.
async function notifyAdminsOfChat(
  req: Request,
  thread: typeof chatThreadsTable.$inferSelect,
  body: string,
  via: ChatSource,
  linkedChatIds: readonly string[],
) {
  const [owner] = thread.userId === null
    ? []
    : await db
        .select({ name: usersTable.name, phone: usersTable.phone, telegramName: usersTable.telegramName, telegramUsername: usersTable.telegramUsername })
        .from(usersTable)
        .where(eq(usersTable.id, thread.userId))
        .limit(1);
  const notified = await sendChatMessageNotification(
    {
      threadId: thread.id,
      customerName: owner?.name || thread.customerName,
      phone: owner?.phone || thread.phone,
      body,
      orderCount: await activeOrderCount(thread.userId),
      via,
      telegramName: owner?.telegramName,
      telegramUsername: owner?.telegramUsername,
    },
    linkedChatIds,
  );
  if (!notified.sent) req.log.warn({ reason: notified.error }, "Telegram chat notification failed");
}

async function findThread(req: Request, res: Response) {
  const customer = await resolveCustomer(req, res);
  if (!customer) return { thread: undefined, customer };
  const [own] = await db
    .select()
    .from(chatThreadsTable)
    .where(eq(chatThreadsTable.userId, customer.user.id))
    .orderBy(desc(chatThreadsTable.lastMessageAt))
    .limit(1);
  if (own) return { thread: own, customer };
  const cookieThread = await loadThreadByToken(readChatToken(req));
  if (!cookieThread || cookieThread.userId !== null) return { thread: undefined, customer };
  // Under the same lock as customerThread, so a bot message opening a thread
  // at this moment cannot leave the customer with two.
  const adopted = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`chat-thread:${customer.user.id}`}))`);
    const [mine] = await tx
      .select()
      .from(chatThreadsTable)
      .where(eq(chatThreadsTable.userId, customer.user.id))
      .orderBy(desc(chatThreadsTable.lastMessageAt))
      .limit(1);
    if (mine) return mine;
    const [taken] = await tx
      .update(chatThreadsTable)
      .set({ userId: customer.user.id })
      .where(and(eq(chatThreadsTable.id, cookieThread.id), isNull(chatThreadsTable.userId)))
      .returning();
    return taken;
  });
  return { thread: adopted, customer };
}

// A customer has one conversation. Finding it, and opening it when there is
// none, happen under a per-customer lock: Telegram delivers webhook updates in
// parallel, and two messages arriving together must not open two threads.
async function customerThread(
  user: { id: number; name: string; phone: string | null },
  details: { name?: string; phone?: string } = {},
) {
  // Reached through the account; the hash is a random one nobody holds, only
  // there because threads from before accounts were owned by a chat cookie.
  const tokenHash = hashChatToken(createChatToken());
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`chat-thread:${user.id}`}))`);
    const [own] = await tx
      .select()
      .from(chatThreadsTable)
      .where(eq(chatThreadsTable.userId, user.id))
      .orderBy(desc(chatThreadsTable.lastMessageAt))
      .limit(1);
    if (own) return { thread: own, created: false };
    const [thread] = await tx
      .insert(chatThreadsTable)
      .values({
        tokenHash,
        customerName: details.name || user.name || "",
        phone: details.phone || user.phone || "",
        userId: user.id,
      })
      .returning();
    return { thread, created: true };
  });
}

// An admin's reply also goes to the customer's own Telegram when the
// account belongs to one: they opened the shop from the bot or shared their
// number with it, so the bot may write to them. Not to a blocked customer, and not when that Telegram
// account is itself an admin chat, where it would read as an admin message.
// Best effort: the reply is stored for the site either way.
async function deliverReplyToCustomerTelegram(
  req: Request,
  userId: number | null,
  body: string,
  linkedChatIds: readonly string[],
) {
  if (userId === null) return;
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!owner?.telegramId || owner.blockedAt) return;
  if (isAdminChat(owner.telegramId, linkedChatIds)) return;
  const sent = await sendCustomerReply(owner.telegramId, body, publicBaseUrl(req));
  if (!sent.sent) req.log.warn({ reason: sent.error }, "Telegram reply to customer failed");
}

// Whether the customer a conversation belongs to is blocked. They cannot read
// replies, so neither the dashboard nor Telegram should send them any.
async function threadOwnerBlocked(userId: number | null) {
  if (userId === null) return false;
  const [owner] = await db.select({ blockedAt: usersTable.blockedAt }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return Boolean(owner?.blockedAt);
}

async function chatTranscript(threadId: number) {
  const messages = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.threadId, threadId))
    .orderBy(asc(chatMessagesTable.id));
  return { thread_id: threadId, messages: messages.map(chatMessageDto) };
}

// The operators' view also says which admin wrote each reply. The customer's
// transcript above never carries names.
async function adminChatTranscript(threadId: number) {
  const rows = await db
    .select({ message: chatMessagesTable, adminName: adminsTable.displayName })
    .from(chatMessagesTable)
    .leftJoin(adminsTable, eq(chatMessagesTable.adminId, adminsTable.id))
    .where(eq(chatMessagesTable.threadId, threadId))
    .orderBy(asc(chatMessagesTable.id));
  return {
    thread_id: threadId,
    messages: rows.map(({ message, adminName }) => ({ ...chatMessageDto(message), admin_name: adminName })),
  };
}

function categoryDto(
  category: Pick<typeof categoriesTable.$inferSelect, "id" | "name" | "slug" | "icon">,
  productCount = 0,
) {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    icon: category.icon,
    product_count: productCount,
  };
}

function orderDto(order: typeof ordersTable.$inferSelect) {
  return {
    id: order.id,
    order_number: order.orderNumber,
    customer_name: order.customerName,
    phone: order.phone,
    address: order.address,
    items: order.items,
    status: order.status as "new" | "preparing" | "courier" | "delivered" | "cancelled",
    payment_method: order.paymentMethod as "cash" | "click" | "payme" | "uzcard" | "humo",
    subtotal: money(order.subtotal)!,
    delivery_fee: money(order.deliveryFee)!,
    total: money(order.total)!,
    created_at: order.createdAt,
    scheduled_for: order.scheduledFor ? order.scheduledFor.toISOString() : null,
  };
}

async function loadStoreHours(): Promise<StoreHours> {
  const [row] = await db.select().from(storeSettingsTable).where(eq(storeSettingsTable.id, 1)).limit(1);
  // The migration inserts the row; the defaults only cover a database that
  // has not run it yet.
  return row
    ? { openTime: row.openTime, closeTime: row.closeTime, acceptingOrders: row.acceptingOrders }
    : { openTime: "06:00", closeTime: "23:00", acceptingOrders: true };
}

function storeStatusDto(hours: StoreHours, now = new Date()) {
  const next = nextOpenAt(hours, now);
  return {
    open_now: isOpenNow(hours, now),
    accepting_orders: hours.acceptingOrders,
    open_time: hours.openTime,
    close_time: hours.closeTime,
    next_open_at: hours.acceptingOrders && next ? next.toISOString() : null,
    slots: deliverySlots(hours, now).map((slot) => slot.toISOString()),
    earliest_accepted_at: earliestAcceptedAt(now).toISOString(),
  };
}

// The dashboard's view adds who last moved the status. Customers never see it.
function adminOrderDto(
  order: typeof ordersTable.$inferSelect,
  changedBy: string | null,
  telegram: { name: string | null; username: string | null } = { name: null, username: null },
) {
  return {
    ...orderDto(order),
    status_changed_by: changedBy,
    status_changed_at: order.statusChangedAt ? order.statusChangedAt.toISOString() : null,
    telegram_name: telegram.name,
    telegram_username: telegram.username,
  };
}

async function orderTelegram(userId: number | null) {
  if (userId === null) return undefined;
  const [row] = await db
    .select({ name: usersTable.telegramName, username: usersTable.telegramUsername })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return row;
}

// The first delivery to a flat is free, once: whoever orders, from whichever
// account or number. A phone or an account can be swapped for a new one at
// will; the flat stays where it is. An address the shop did not write has no
// key and pays.
async function ordersToAddress(executor: Pick<typeof db, "select">, key: string) {
  const [row] = await executor
    .select({ count: sql<number>`count(*)` })
    .from(ordersTable)
    .where(and(eq(ordersTable.addressKey, key), sql`${ordersTable.status} <> 'cancelled'`));
  return Number(row.count);
}
// Anybody can write to the bot. Someone who may not chat is told why a few
// times, then ignored, so a flood costs one lookup per message and no replies.
const customerNoticeLimiter = createRateLimiter<string>({ windowMs: 10 * 60 * 1000, max: 3 });

router.get("/categories", async (_req, res, next) => {
  try {
    await ensureSeedData();
    const categories = await db
      .select({
        id: categoriesTable.id,
        name: categoriesTable.name,
        slug: categoriesTable.slug,
        icon: categoriesTable.icon,
        product_count: sql<number>`count(${productsTable.id})`,
      })
      .from(categoriesTable)
      .leftJoin(
        productsTable,
        and(eq(productsTable.categoryId, categoriesTable.id), eq(productsTable.active, true)),
      )
      .where(eq(categoriesTable.active, true))
      .groupBy(categoriesTable.id)
      .orderBy(asc(categoriesTable.sortOrder));
    res.json(categories.map((category) => categoryDto(category, Number(category.product_count))));
  } catch (error) {
    return next(error);
  }
});

router.get("/products", async (req, res, next) => {
  try {
    await ensureSeedData();
    const query = ListProductsQueryParams.parse(req.query);
    const filters = [eq(productsTable.active, true)];
    if (query.search) filters.push(ilike(productsTable.name, `%${query.search}%`));
    if (query.category) filters.push(eq(categoriesTable.slug, query.category));

    const orderBy =
      query.sort === "price_asc"
        ? asc(productsTable.price)
        : query.sort === "price_desc"
          ? desc(productsTable.price)
          : query.sort === "newest"
            ? desc(productsTable.isNew)
            : query.sort === "discount"
              ? desc(sql`coalesce(${productsTable.oldPrice}, ${productsTable.price}) - ${productsTable.price}`)
              : desc(productsTable.isPopular);

    const rows = await db
      .select({ product: productsTable, category: categoriesTable.name })
      .from(productsTable)
      .innerJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
      .where(and(...filters))
      .orderBy(orderBy);
    res.json(rows.map(({ product, category }) => productDto(product, category)));
  } catch (error) {
    return next(error);
  }
});

router.get("/products/:id", async (req, res, next) => {
  try {
    await ensureSeedData();
    const { id } = GetProductParams.parse(req.params);
    const [row] = await db
      .select({ product: productsTable, category: categoriesTable.name })
      .from(productsTable)
      .innerJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
      // A hidden product is gone from the storefront, direct links included.
      .where(and(eq(productsTable.id, id), eq(productsTable.active, true)))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Product not found" });
    return res.json(productDto(row.product, row.category));
  } catch (error) {
    return next(error);
  }
});

router.get("/orders/delivery-fee", async (req, res, next) => {
  try {
    const { address } = GetDeliveryFeeEstimateQueryParams.parse(req.query);
    const key = addressKey(address);
    const free = key !== undefined && (await ordersToAddress(db, key)) === 0;
    res.json({ delivery_fee: free ? 0 : DELIVERY_FEE_CENTS / 100, is_first_order: free });
  } catch (error) {
    return next(error);
  }
});

router.get("/orders", async (req, res, next) => {
  try {
    const customer = await resolveCustomer(req, res);
    if (!customer) return res.json([]);
    const orders = await db
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.userId, customer.user.id))
      .orderBy(desc(ordersTable.createdAt));
    res.json(orders.map(orderDto));
  } catch (error) {
    return next(error);
  }
});

router.get("/orders/:id", async (req, res, next) => {
  try {
    const { id } = GetOrderParams.parse(req.params);
    const customer = await resolveCustomer(req, res);
    // Somebody else's order answers exactly like a missing one, so order ids
    // cannot be probed.
    if (!customer) return res.status(404).json({ error: "Order not found" });
    const [order] = await db
      .select()
      .from(ordersTable)
      .where(and(eq(ordersTable.id, id), eq(ordersTable.userId, customer.user.id)))
      .limit(1);
    if (!order) return res.status(404).json({ error: "Order not found" });
    return res.json(orderDto(order));
  } catch (error) {
    return next(error);
  }
});

// A comment on a delivered order goes straight to the admins through the bot
// and is not stored, by the owner's decision: Telegram is the only place it is
// kept. Three a day per order, counted in memory, is plenty for a customer
// and stops a script from flooding the admins.
const feedbackLimiter = createRateLimiter<number>({ windowMs: 24 * 60 * 60 * 1000, max: 3 });

router.post("/orders/:id/feedback", async (req, res, next) => {
  try {
    const { id } = SendOrderFeedbackParams.parse(req.params);
    const { text } = SendOrderFeedbackBody.parse(req.body);
    const body = text.trim();
    if (!body) return res.status(400).json({ error: "Izoh bo‘sh bo‘lmasin" });
    const customer = await resolveCustomer(req, res);
    if (customerIsBlocked(customer)) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    if (!customer || customer.session.source !== "telegram" || customer.user.telegramId === null) {
      return res.status(403).json({ error: TELEGRAM_REQUIRED_MESSAGE, telegram_required: true });
    }
    // Somebody else's order answers exactly like a missing one.
    const [order] = await db
      .select()
      .from(ordersTable)
      .where(and(eq(ordersTable.id, id), eq(ordersTable.userId, customer.user.id)))
      .limit(1);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "delivered") {
      return res.status(409).json({ error: "Izohni buyurtma yetkazilgandan keyin yozish mumkin" });
    }
    // Only a comment that reached the admins counts against the three.
    if (feedbackLimiter.isExhausted(order.id)) {
      return res.status(429).json({ error: "Bu buyurtma uchun bugun yetarlicha izoh yozildi. Ertaga yozishingiz mumkin." });
    }
    const sent = await sendOrderFeedback(
      {
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        phone: order.phone,
        address: order.address,
        total: order.total,
        telegramName: customer.user.telegramName,
        telegramUsername: customer.user.telegramUsername,
        text: body,
      },
      await linkedTelegramChatIds(),
    );
    // Nothing was kept, so the customer must know to try again. The text
    // itself is never logged.
    if (!sent.sent) {
      req.log.warn({ reason: sent.error, orderId: order.id }, "Telegram order feedback failed");
      return res.status(502).json({ error: "Izoh yuborilmadi. Birozdan keyin qayta urinib ko‘ring." });
    }
    feedbackLimiter.allow(order.id);
    return res.json({ sent: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/orders", async (req, res, next) => {
  try {
    await ensureSeedData();
    const input = CreateOrderBody.parse(req.body);
    const customerName = input.customer_name.trim();
    if (customerName.length < 2 || customerName.length > 80) {
      res.status(400).json({ error: "Mijoz ismi 2-80 ta belgidan iborat bo‘lishi kerak" });
      return;
    }
    const phone = normalizeUzPhone(input.phone);
    if (!phone) {
      res.status(400).json({ error: "Telefon raqam noto‘g‘ri. Masalan: +998 90 123 45 67" });
      return;
    }
    // Right now only while open; ahead of time only for a slot inside the
    // hours. Checked before anything is written or reserved.
    const hours = await loadStoreHours();
    const scheduledFor = input.scheduled_for ? new Date(input.scheduled_for) : null;
    if (!hours.acceptingOrders) {
      res.status(409).json({ error: "Hozir buyurtma qabul qilinmayapti. Birozdan keyin urinib ko‘ring." });
      return;
    }
    if (scheduledFor) {
      const problem = scheduleProblem(scheduledFor, hours);
      if (problem) {
        res.status(409).json({ error: problem });
        return;
      }
    } else if (!isOpenNow(hours)) {
      res.status(409).json({
        error: `Do‘kon hozir yopiq. Ish vaqti ${hours.openTime}–${hours.closeTime}. Yetkazish vaqtini tanlab, oldindan buyurtma bering.`,
      });
      return;
    }
    // Orders are taken only in the Mini App: every buyer is a Telegram
    // account, which is what a block holds. A browser has no identity to
    // block, so it is sent to Telegram instead.
    const customer = await resolveCustomer(req, res);
    if (customerIsBlocked(customer)) {
      res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
      return;
    }
    if (!customer || customer.session.source !== "telegram" || customer.user.telegramId === null) {
      res.status(403).json({ error: TELEGRAM_REQUIRED_MESSAGE, telegram_required: true });
      return;
    }
    const key = addressKey(input.address);
    const order = await db.transaction(async (tx) => {
      // Two orders to one flat at the same moment must not both go free.
      if (key) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`address:${key}`}))`);
      const deliveryFeeCents = key !== undefined && (await ordersToAddress(tx, key)) === 0 ? 0 : DELIVERY_FEE_CENTS;
      const productIds = [...new Set(input.items.map((item) => item.product_id))].sort((a, b) => a - b);
      const products = await tx
        .select({ product: productsTable, category: categoriesTable.name })
        .from(productsTable)
        .innerJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
        .where(sql`${productsTable.id} in (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})`)
        .orderBy(asc(productsTable.id))
        .for("update");
      const productById = new Map(products.map((row) => [row.product.id, row]));
      if (products.length !== productIds.length) invalidOrder("Mahsulot topilmadi");
      // A cart can outlive a product being hidden; the shop no longer sells it.
      const hidden = products.find((row) => !row.product.active);
      if (hidden) invalidOrder(`"${hidden.product.name}" hozir sotuvda yo‘q. Uni savatdan olib tashlang.`);

      const aggregates = new Map<number, {
        mode: PurchaseMode;
        quantityMicro?: number;
        amountCents?: number;
      }>();
      for (const item of input.items) {
        const row = productById.get(item.product_id);
        if (!row) invalidOrder("Mahsulot topilmadi");
        const mode = item.purchase_mode ?? "quantity";
        if (item.quantity !== undefined && item.amount !== undefined) {
          invalidOrder("Miqdor va summa bir vaqtda yuborilmaydi");
        }
        if (mode === "quantity" && item.amount !== undefined) {
          invalidOrder("Miqdor rejimida summa yuborilmaydi");
        }
        if (mode === "amount" && item.quantity !== undefined) {
          invalidOrder("Summa rejimida miqdor yuborilmaydi");
        }
        const unit = row.product.unit as ProductUnit;
        if (mode === "amount" && unit !== "kg" && unit !== "litr") {
          invalidOrder("Summa rejimi faqat kg yoki litr uchun mavjud");
        }
        const existing = aggregates.get(item.product_id);
        if (existing && existing.mode !== mode) {
          invalidOrder("Bir mahsulot uchun rejimlar aralashtirilmasin");
        }
        const aggregate = existing ?? { mode };
        if (mode === "quantity") {
          if (item.quantity === undefined) invalidOrder("Miqdor ko‘rsatilishi kerak");
          const quantityThousandths = scaledInteger(item.quantity, THOUSANDTH_SCALE, "Miqdor", true);
          const quantityMicro = quantityThousandths * (MICROQUANTITY_SCALE / THOUSANDTH_SCALE);
          if (!Number.isSafeInteger(quantityMicro)) invalidOrder("Miqdor chegaradan tashqari");
          if (unit === "dona" || unit === "qadoq") {
            if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
              invalidOrder("Dona va qadoq miqdori butun musbat son bo‘lishi kerak");
            }
          }
          try {
            aggregate.quantityMicro = addMicroquantities(aggregate.quantityMicro ?? 0, quantityMicro);
          } catch {
            invalidOrder("Buyurtma qiymati chegaradan tashqari");
          }
        } else {
          if (item.amount === undefined) invalidOrder("Summa ko‘rsatilishi kerak");
          const amountCents = scaledInteger(item.amount, 100, "Summa", true);
          if (amountCents > MAX_MONEY_CENTS) invalidOrder("Summa chegaradan tashqari");
          aggregate.amountCents = (aggregate.amountCents ?? 0) + amountCents;
        }
        if (!Number.isSafeInteger(aggregate.quantityMicro ?? 0) || !Number.isSafeInteger(aggregate.amountCents ?? 0)) {
          invalidOrder("Buyurtma qiymati chegaradan tashqari");
        }
        aggregates.set(item.product_id, aggregate);
      }

      const items = [...aggregates].map(([productId, aggregate]) => {
        const row = productById.get(productId)!;
        const unit = row.product.unit as ProductUnit;
        const currentPriceCents = priceCents(row.product.price);
        let quantityMicro: number;
        let requestedAmountCents: number | undefined;
        if (aggregate.mode === "amount") {
          quantityMicro = deriveAmountQuantityMicro(aggregate.amountCents!, currentPriceCents);
          requestedAmountCents = aggregate.amountCents;
          if (!Number.isSafeInteger(quantityMicro) || quantityMicro <= 0) {
            invalidOrder("Summa bo‘yicha miqdor juda kichik");
          }
        } else {
          quantityMicro = aggregate.quantityMicro!;
        }
        if (quantityMicro < MICROQUANTITY_SCALE / 1000) {
          invalidOrder("Miqdor kamida 0.001 bo‘lishi kerak");
        }
        if ((unit === "dona" || unit === "qadoq") && quantityMicro % MICROQUANTITY_SCALE !== 0) {
          try {
            requireWholeUnitQuantity(quantityMicro);
          } catch {
            invalidOrder("Dona va qadoq miqdori butun musbat son bo‘lishi kerak");
          }
        }
        const availableMicro = stockMicro(row.product.stock);
        if (availableMicro < quantityMicro) invalidOrder("Omborda yetarli mahsulot yo‘q");
        const totalCents = requestedAmountCents ?? quantityTotalCents(currentPriceCents, quantityMicro);
        if (!Number.isSafeInteger(totalCents)) invalidOrder("Buyurtma summasi chegaradan tashqari");
        const line = {
          product_id: row.product.id,
          name: row.product.name,
          image_url: row.product.imageUrl,
          price: money(row.product.price)!,
          quantity: quantityMicro / MICROQUANTITY_SCALE,
          unit: row.product.unit,
          total: totalCents / 100,
          purchase_mode: aggregate.mode,
          ...(requestedAmountCents === undefined ? {} : { requested_amount: requestedAmountCents / 100 }),
        };
        return { line, quantityMicro, totalCents };
      });
      const subtotalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
      if (!Number.isSafeInteger(subtotalCents) || subtotalCents > MAX_MONEY_CENTS) {
        invalidOrder("Buyurtma summasi chegaradan tashqari");
      }
      if (subtotalCents + deliveryFeeCents > MAX_MONEY_CENTS) {
        invalidOrder("Buyurtma jami chegaradan tashqari");
      }
      // Numbered from the id sequence, so two orders can never share a number.
      // The last six digits of the clock, used before, repeated every 16.7
      // minutes and a repeat failed the order on the unique constraint. Seven
      // digits so a new number can never equal an old six-digit one.
      const { rows: [{ id: orderId }] } = await tx.execute<{ id: string }>(
        sql`select nextval(pg_get_serial_sequence('orders', 'id')) as id`,
      );
      const orderNumber = `QE-${String(orderId).padStart(7, "0")}`;
      // The latest details the customer typed win on their account; each
      // order keeps its own copy of the name, phone and address.
      const userId = customer.user.id;
      const phoneChanged = customer.user.phone !== phone;
      await tx
        .update(usersTable)
        .set({ name: customerName, phone, ...(phoneChanged && isVerified(customer.user) ? { phoneVerifiedAt: null } : {}) })
        .where(eq(usersTable.id, userId));
      const [created] = await tx
        .insert(ordersTable)
        .values({
          id: Number(orderId),
          orderNumber,
          userId,
          scheduledFor,
          customerName,
          phone,
          address: input.address,
          addressKey: key ?? null,
          items: items.map((item) => item.line),
          status: "new",
          paymentMethod: input.payment_method,
          subtotal: (subtotalCents / 100).toFixed(2),
          deliveryFee: (deliveryFeeCents / 100).toFixed(2),
          total: ((subtotalCents + deliveryFeeCents) / 100).toFixed(2),
        })
        .returning();
      for (const item of items) {
        await tx
          .update(productsTable)
          .set({ stock: sql`${productsTable.stock} - ${item.quantityMicro / MICROQUANTITY_SCALE}` })
          .where(eq(productsTable.id, item.line.product_id));
      }
      return created;
    });
    if (order.userId) await rememberOrderAddress(order.userId, order.address);
    const notification = await sendNewOrderNotification(
      {
        ...order,
        scheduledLabel: order.scheduledFor ? formatTashkent(order.scheduledFor) : undefined,
        telegramName: customer.user.telegramName,
        telegramUsername: customer.user.telegramUsername,
      },
      await linkedTelegramChatIds(),
    );
    if (!notification.sent) {
      req.log.error({ error: notification.error, orderId: order.id }, "Telegram order notification failed");
    }
    return res.status(201).json(orderDto(order));
  } catch (error) {
    if (error instanceof OrderValidationError) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.get("/store/status", async (_req, res, next) => {
  try {
    return res.json(storeStatusDto(await loadStoreHours()));
  } catch (error) {
    return next(error);
  }
});

// Behind the /admin guard. Any admin may change the hours or pause orders:
// the person on shift is the one who knows the shop cannot deliver.
router.put("/admin/store-hours", async (req, res, next) => {
  try {
    const input = UpdateStoreHoursBody.parse(req.body);
    if (!isValidTime(input.open_time) || !isValidTime(input.close_time)) {
      return res.status(400).json({ error: "Vaqt SS:DD ko‘rinishida bo‘lsin, masalan 06:00" });
    }
    const values = {
      openTime: input.open_time,
      closeTime: input.close_time,
      acceptingOrders: input.accepting_orders,
      updatedBy: signedInAdmin(res).id,
      updatedAt: new Date(),
    };
    await db
      .insert(storeSettingsTable)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: storeSettingsTable.id, set: values });
    return res.json(storeStatusDto(await loadStoreHours()));
  } catch (error) {
    return next(error);
  }
});

router.get("/leaderboard/weekly", async (_req, res, next) => {
  try {
    const orders = await db.select().from(ordersTable);
    // A blocked customer's orders are off the leaderboard, so prank orders
    // can neither rank nor win the weekly prize. By account, not by number:
    // a number a blocked prankster typed may be a stranger's.
    const blocked = await db.select({ id: usersTable.id }).from(usersTable).where(isNotNull(usersTable.blockedAt));
    const blockedIds = new Set(blocked.map((row) => row.id));
    const eligible = orders.filter((order) => !(order.userId !== null && blockedIds.has(order.userId)));
    res.json(weeklyLeaderboard(eligible));
  } catch (error) {
    return next(error);
  }
});

// Opening the chat is idempotent: a browser that already holds a valid cookie
// gets its existing conversation back rather than a second empty one.
router.post("/chat/session", async (req, res, next) => {
  try {
    const input = StartChatSessionBody.parse(req.body ?? {});
    const name = input.name?.trim() ?? "";
    const phone = input.phone?.trim() ?? "";

    const { thread: existing, customer, blocked, closed } = await resolveThread(req, res);
    if (blocked) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    if (closed || !customer) return res.status(403).json({ error: CHAT_CLOSED_MESSAGE, chat_closed: true });
    if (existing) {
      // The customer may have filled in their profile since the thread was
      // opened, so newly supplied details replace blanks without wiping what
      // is already known.
      const nextName = name || existing.customerName;
      const nextPhone = phone || existing.phone;
      if (nextName !== existing.customerName || nextPhone !== existing.phone) {
        await db
          .update(chatThreadsTable)
          .set({ customerName: nextName, phone: nextPhone })
          .where(eq(chatThreadsTable.id, existing.id));
      }
      return res.json({ thread_id: existing.id, customer_name: nextName, phone: nextPhone });
    }

    if (!chatSessionLimiter.allow(clientKey(req))) {
      return res.status(429).json({ error: "Juda ko‘p suhbat ochildi. Biroz kuting." });
    }

    const { thread } = await customerThread(customer.user, { name, phone });
    return res.json({ thread_id: thread.id, customer_name: thread.customerName, phone: thread.phone });
  } catch (error) {
    return next(error);
  }
});

router.get("/chat/messages", async (req, res, next) => {
  try {
    const { thread, blocked, closed } = await resolveThread(req, res);
    if (blocked) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    if (closed) return res.status(403).json({ error: CHAT_CLOSED_MESSAGE, chat_closed: true });
    if (!thread) return res.status(404).json({ error: "Suhbat topilmadi" });
    await db
      .update(chatThreadsTable)
      .set({ customerReadAt: new Date() })
      .where(eq(chatThreadsTable.id, thread.id));
    return res.json(await chatTranscript(thread.id));
  } catch (error) {
    return next(error);
  }
});

router.post("/chat/messages", async (req, res, next) => {
  try {
    const { body } = SendChatMessageBody.parse(req.body);
    const { thread, customer, blocked, closed } = await resolveThread(req, res);
    if (blocked) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    if (closed || !customer) return res.status(403).json({ error: CHAT_CLOSED_MESSAGE, chat_closed: true });
    if (!thread) return res.status(404).json({ error: "Suhbat topilmadi" });
    if (!chatMessageLimiter.allow(thread.id)) {
      return res.status(429).json({ error: "Juda ko‘p xabar yuborildi. Biroz kuting." });
    }

    // The device it was written on is kept with the message.
    const [message] = await db
      .insert(chatMessagesTable)
      .values({ threadId: thread.id, sender: "customer", body: body.trim(), sessionId: customer.session.id })
      .returning();
    await db
      .update(chatThreadsTable)
      .set({ lastMessageAt: message.createdAt, customerReadAt: message.createdAt })
      .where(eq(chatThreadsTable.id, thread.id));

    // Best effort, exactly like the order notification: the message is stored
    // either way, and a Telegram outage must not lose what the customer wrote.
    const linkedChatIds = await linkedTelegramChatIds();
    const via: ChatSource = customer.session.source === "telegram" ? "mini-app" : "site";
    // The bot holds the whole conversation: what was written in the Mini App
    // is copied into the customer's chat with the bot too. Not into an admin's
    // own chat, where it would read as a message to the admins. Both go out
    // together, so the customer waits for Telegram once, not twice.
    const telegramId = customer.user.telegramId;
    const echo = async () => {
      if (!telegramId || isAdminChat(telegramId, linkedChatIds)) return;
      const echoed = await sendCustomerEcho(telegramId, message.body);
      if (!echoed.sent) req.log.warn({ reason: echoed.error }, "Telegram chat echo to customer failed");
    };
    await Promise.all([notifyAdminsOfChat(req, thread, message.body, via, linkedChatIds), echo()]);
    return res.status(201).json(chatMessageDto(message));
  } catch (error) {
    return next(error);
  }
});

// Where the shop is served from, for links the bot sends. Render names it in
// RENDER_EXTERNAL_URL; PUBLIC_BASE_URL overrides it elsewhere.
function publicBaseUrl(req: Request) {
  return process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || `https://${req.get("host")}`;
}

// Telegram calls this for every message an admin sends the bot. A reply to a
// chat notification becomes an operator message in that thread, exactly as if
// it had been typed on the dashboard, so the customer's widget and the
// dashboard both show it on their next poll, and the other admins get a copy.
// "/start <code>" from a dashboard link connects that chat to an admin.
router.post("/telegram/webhook", async (req, res, next) => {
  try {
    if (!webhookSecretMatches(req.get("x-telegram-bot-api-secret-token"))) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const recipients = await linkedTelegramRecipients();
    const update = parseAdminUpdate(req.body, recipients.map((recipient) => recipient.chatId));
    if (update.kind === "ignore") return res.json({ ok: true });
    // The shop works in private chats only. Added to a group or channel, the
    // bot reads nothing there and leaves.
    if (update.kind === "leave") {
      const left = await leaveChat(update.chatId);
      if (!left.sent) req.log.warn({ reason: left.error }, "Telegram leaveChat failed");
      return res.json({ ok: true });
    }

    if (update.kind === "link") {
      const linked = await db.transaction(async (tx) => {
        const [admin] = await tx
          .select()
          .from(adminsTable)
          .where(eq(adminsTable.telegramLinkHash, telegramLinkHash(update.code)))
          .limit(1)
          .for("update");
        if (!admin || !admin.telegramLinkExpiresAt || admin.telegramLinkExpiresAt < new Date()) return undefined;
        // One chat belongs to one admin: a chat moving to a new account stops
        // notifying the old one.
        await tx
          .update(adminsTable)
          .set({ telegramChatId: null })
          .where(eq(adminsTable.telegramChatId, update.chatId));
        const [updated] = await tx
          .update(adminsTable)
          .set({ telegramChatId: update.chatId, telegramLinkHash: null, telegramLinkExpiresAt: null })
          .where(eq(adminsTable.id, admin.id))
          .returning();
        return updated;
      });
      await sendLinkResult(update.chatId, linked?.displayName);
      return res.json({ ok: true });
    }

    // Somebody opened the bot: greet them with today's biggest discounts among
    // products that can actually be bought, and the shop as a Mini App.
    if (update.kind === "welcome") {
      const offers = await db
        .select({ name: productsTable.name, price: productsTable.price, oldPrice: productsTable.oldPrice })
        .from(productsTable)
        .where(and(eq(productsTable.active, true), sql`${productsTable.stock} > 0`, sql`${productsTable.oldPrice} > ${productsTable.price}`))
        .orderBy(desc(sql`(${productsTable.oldPrice} - ${productsTable.price}) / ${productsTable.oldPrice}`))
        .limit(3);
      const welcomed = await sendWelcome(
        update.chatId,
        publicBaseUrl(req),
        offers.map((offer) => ({ name: offer.name, price: Number(offer.price), oldPrice: offer.oldPrice === null ? null : Number(offer.oldPrice) })),
        await loadStoreHours(),
      );
      if (!welcomed.sent) req.log.warn({ reason: welcomed.error }, "Telegram welcome failed");
      return res.json({ ok: true });
    }

    if (update.kind === "hint") {
      await sendReplyHint(update.chatId, update.messageId, "unroutable");
      return res.json({ ok: true });
    }

    // A customer writing to the bot: stored in their conversation, the same
    // one the Mini App shows, under the same rules (not blocked, the same
    // limit). Writing to the bot is a way in by itself: a Telegram account the
    // shop has not met yet becomes a customer with its first message, ordered
    // or not.
    if (update.kind === "customer-unsupported") {
      if (customerNoticeLimiter.allow(update.chatId)) await sendCustomerNotice(update.chatId, "unsupported");
      return res.json({ ok: true });
    }
    if (update.kind === "customer-message") {
      if (await telegramIsBlocked(update.telegramUserId)) {
        if (customerNoticeLimiter.allow(update.chatId)) await sendCustomerNotice(update.chatId, "blocked");
        return res.json({ ok: true });
      }
      const customer = await telegramCustomer(update.telegramUserId, { name: update.name, username: update.username });
      const { thread } = await customerThread(customer);
      if (!chatMessageLimiter.allow(thread.id)) {
        if (customerNoticeLimiter.allow(update.chatId)) await sendCustomerNotice(update.chatId, "too-many");
        return res.json({ ok: true });
      }
      const [message] = await db
        .insert(chatMessagesTable)
        .values({ threadId: thread.id, sender: "customer", body: update.body, telegramRef: update.ref })
        .onConflictDoNothing()
        .returning();
      // Telegram re-sent an update already stored.
      if (!message) return res.json({ ok: true });
      await db
        .update(chatThreadsTable)
        .set({ lastMessageAt: message.createdAt, customerReadAt: message.createdAt })
        .where(eq(chatThreadsTable.id, thread.id));

      const acknowledged = await acknowledgeAdminReply(update.chatId, update.messageId);
      if (!acknowledged.sent) req.log.warn({ reason: acknowledged.error }, "Telegram customer message acknowledgement failed");
      await notifyAdminsOfChat(req, thread, message.body, "bot", recipients.map((recipient) => recipient.chatId));
      return res.json({ ok: true });
    }

    const [thread] = await db
      .select()
      .from(chatThreadsTable)
      .where(eq(chatThreadsTable.id, update.threadId))
      .limit(1);
    if (!thread) {
      await sendReplyHint(update.chatId, update.messageId, "missing-thread");
      return res.json({ ok: true });
    }
    if (await threadOwnerBlocked(thread.userId)) {
      await sendReplyHint(update.chatId, update.messageId, "customer-blocked");
      return res.json({ ok: true });
    }

    // The owner's chat from TELEGRAM_ADMIN_CHAT_ID may belong to no admin row.
    const author = recipients.find((recipient) => recipient.chatId === update.chatId);
    const [message] = await db
      .insert(chatMessagesTable)
      .values({
        threadId: thread.id,
        sender: "operator",
        body: update.body,
        telegramRef: update.ref,
        adminId: author?.adminId ?? null,
      })
      .onConflictDoNothing()
      .returning();
    // No row means Telegram re-sent an update already stored. Answer 200 so it
    // stops retrying, and do not react or copy a second time.
    if (!message) return res.json({ ok: true });

    await db
      .update(chatThreadsTable)
      .set({ lastMessageAt: message.createdAt, operatorReadAt: message.createdAt })
      .where(eq(chatThreadsTable.id, thread.id));

    const acknowledged = await acknowledgeAdminReply(update.chatId, update.messageId);
    if (!acknowledged.sent) {
      req.log.warn({ reason: acknowledged.error }, "Telegram reply acknowledgement failed");
    }
    const copied = await sendOperatorReplyNotification(
      {
        threadId: thread.id,
        customerName: thread.customerName,
        phone: thread.phone,
        body: message.body,
        authorName: author?.displayName ?? "Asosiy chat",
        via: "telegram",
      },
      recipients.map((recipient) => recipient.chatId),
      update.chatId,
    );
    if (!copied.sent) req.log.warn({ reason: copied.error }, "Telegram reply copy failed");
    await deliverReplyToCustomerTelegram(req, thread.userId, message.body, recipients.map((recipient) => recipient.chatId));
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/admin/categories", async (req, res, next) => {
  try {
    const input = CreateAdminCategoryBody.parse(req.body);
    const [category] = await db
      .insert(categoriesTable)
      .values({
        name: input.name.trim(),
        slug: input.slug.trim().toLowerCase(),
        icon: input.icon.trim(),
        sortOrder: input.sort_order ?? 0,
      })
      .returning();
    return res.status(201).json(categoryDto(category));
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/products", async (_req, res, next) => {
  try {
    await ensureSeedData();
    const rows = await db
      .select({ product: productsTable, category: categoriesTable.name })
      .from(productsTable)
      .innerJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
      .orderBy(asc(categoriesTable.sortOrder), asc(productsTable.name));
    res.json(rows.map(({ product, category }) => adminProductDto(product, category)));
  } catch (error) {
    return next(error);
  }
});

router.post("/admin/products", async (req, res, next) => {
  try {
    await ensureSeedData();
    const input = CreateAdminProductBody.parse(req.body);
    validateAdminProductNumbers(input);
    const [category] = await db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.id, input.category_id))
      .limit(1);
    if (!category) return res.status(400).json({ error: "Category not found" });

    const [product] = await db
      .insert(productsTable)
      .values({
        categoryId: input.category_id,
        name: input.name.trim(),
        description: input.description.trim(),
        imageUrl: input.image_url,
        imagePublicId: resolveImagePublicId(input.image_url, input.image_public_id) ?? null,
        price: String(input.price),
        oldPrice: input.old_price == null ? null : String(input.old_price),
        unit: input.unit,
        stock: input.stock,
        active: input.active ?? true,
        isPopular: input.is_popular ?? false,
        isNew: input.is_new ?? false,
      })
      .returning();
    return res.status(201).json(productDto(product, category.name));
  } catch (error) {
    if (error instanceof OrderValidationError) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.patch("/admin/products/:id", async (req, res, next) => {
  try {
    const { id } = UpdateAdminProductParams.parse(req.params);
    const input = UpdateAdminProductBody.parse(req.body);
    const [existingProduct] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, id))
      .limit(1);
    if (!existingProduct) return res.status(404).json({ error: "Product not found" });
    validateAdminProductNumbers({
      ...input,
      unit: input.unit ?? (existingProduct.unit as ProductUnit),
      stock: input.stock ?? (input.unit === undefined ? undefined : existingProduct.stock),
    });
    const update: Partial<typeof productsTable.$inferInsert> = {};
    if (input.category_id !== undefined) update.categoryId = input.category_id;
    if (input.name !== undefined) update.name = input.name.trim();
    if (input.description !== undefined) update.description = input.description.trim();
    // The URL and the public id always move together. A new URL without an id
    // is a link to somebody else's server, so the id becomes NULL and the file it
    // used to name is retired below. Leaving a stale id behind would later
    // delete a file the product no longer shows.
    if (input.image_url !== undefined) {
      update.imageUrl = input.image_url;
      update.imagePublicId = resolveImagePublicId(input.image_url, input.image_public_id ?? null);
    } else if (input.image_public_id !== undefined) {
      invalidOrder("Rasm identifikatori manzilsiz yuborildi");
    }
    if (input.price !== undefined) update.price = String(input.price);
    if (input.old_price !== undefined) update.oldPrice = input.old_price == null ? null : String(input.old_price);
    if (input.unit !== undefined) update.unit = input.unit;
    if (input.stock !== undefined) update.stock = input.stock;
    if (input.active !== undefined) update.active = input.active;
    if (input.is_popular !== undefined) update.isPopular = input.is_popular;
    if (input.is_new !== undefined) update.isNew = input.is_new;
    if (Object.keys(update).length === 0) return res.status(400).json({ error: "No product changes supplied" });
    if (input.category_id !== undefined) {
      const [category] = await db
        .select({ id: categoriesTable.id })
        .from(categoriesTable)
        .where(eq(categoriesTable.id, input.category_id))
        .limit(1);
      if (!category) return res.status(400).json({ error: "Category not found" });
    }

    const [product] = await db
      .update(productsTable)
      .set(update)
      .where(eq(productsTable.id, id))
      .returning();
    const [category] = await db
      .select({ name: categoriesTable.name })
      .from(categoriesTable)
      .where(eq(categoriesTable.id, product.categoryId))
      .limit(1);
    // The row now points at the new image, so the previous file is orphaned.
    if (
      existingProduct.imagePublicId &&
      existingProduct.imagePublicId !== product.imagePublicId
    ) {
      await discardStoredImage(req, existingProduct.imagePublicId);
    }
    return res.json(productDto(product, category?.name ?? "Noma'lum"));
  } catch (error) {
    if (error instanceof OrderValidationError) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.delete("/admin/products/:id", async (req, res, next) => {
  try {
    const { id } = DeleteAdminProductParams.parse(req.params);
    // Orders keep their own snapshot of every line item, so removing a product
    // never rewrites history. There is no foreign key to block this either.
    const [product] = await db
      .delete(productsTable)
      .where(eq(productsTable.id, id))
      .returning();
    if (!product) return res.status(404).json({ error: "Product not found" });
    await discardStoredImage(req, product.imagePublicId);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

// The operator's browser uploads straight to Cloudinary so the image bytes
// never queue behind this free instance waking from sleep. This hands out a
// signature that authorises exactly one upload into one folder.
router.post("/admin/uploads/signature", (_req, res, next) => {
  try {
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({ error: "Rasm ombori sozlanmagan" });
    }
    return res.status(201).json(createUploadTicket());
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/chats", async (_req, res, next) => {
  try {
    // Two correlated subqueries rather than a query per thread, so the list
    // stays one round trip as conversations pile up.
    const rows = await db
      .select({
        id: chatThreadsTable.id,
        customerName: chatThreadsTable.customerName,
        phone: chatThreadsTable.phone,
        ownerName: usersTable.name,
        ownerPhone: usersTable.phone,
        telegramName: usersTable.telegramName,
        telegramUsername: usersTable.telegramUsername,
        lastMessageAt: chatThreadsTable.lastMessageAt,
        lastMessage: sql<string | null>`(
          select m.body from chat_messages m
          where m.thread_id = ${chatThreadsTable.id}
          order by m.id desc limit 1
        )`,
        customerBlocked: sql<boolean>`coalesce((select u.blocked_at is not null from users u where u.id = ${chatThreadsTable.userId}), false)`,
        unreadCount: sql<number>`(
          select count(*) from chat_messages m
          where m.thread_id = ${chatThreadsTable.id}
            and m.sender = 'customer'
            and (${chatThreadsTable.operatorReadAt} is null
                 or m.created_at > ${chatThreadsTable.operatorReadAt})
        )`,
      })
      .from(chatThreadsTable)
      .leftJoin(usersTable, eq(chatThreadsTable.userId, usersTable.id))
      .orderBy(desc(chatThreadsTable.lastMessageAt));

    res.json(
      rows.map((row) => ({
        id: row.id,
        // What the customer has typed by now; the thread only copied it when
        // it opened.
        customer_name: row.ownerName || row.customerName,
        phone: row.ownerPhone || row.phone,
        telegram_name: row.telegramName ?? null,
        telegram_username: row.telegramUsername ?? null,
        last_message: row.lastMessage ?? "",
        last_message_at: row.lastMessageAt.toISOString(),
        unread_count: Number(row.unreadCount),
        customer_blocked: Boolean(row.customerBlocked),
      })),
    );
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/chats/:id/messages", async (req, res, next) => {
  try {
    const { id } = GetAdminChatTranscriptParams.parse(req.params);
    const [thread] = await db
      .select({ id: chatThreadsTable.id })
      .from(chatThreadsTable)
      .where(eq(chatThreadsTable.id, id))
      .limit(1);
    if (!thread) return res.status(404).json({ error: "Suhbat topilmadi" });
    // Opening the thread is what clears its unread badge.
    await db
      .update(chatThreadsTable)
      .set({ operatorReadAt: new Date() })
      .where(eq(chatThreadsTable.id, id));
    return res.json(await adminChatTranscript(id));
  } catch (error) {
    return next(error);
  }
});

// Deleting a conversation removes every message in it (ON DELETE CASCADE).
// The customer's next message opens a fresh one; a reply to the deleted one,
// from here or from Telegram, finds nothing.
router.delete("/admin/chats/:id", async (req, res, next) => {
  try {
    const { id } = DeleteAdminChatParams.parse(req.params);
    const deleted = await db.delete(chatThreadsTable).where(eq(chatThreadsTable.id, id)).returning({ id: chatThreadsTable.id });
    if (deleted.length === 0) return res.status(404).json({ error: "Suhbat topilmadi" });
    req.log.info({ threadId: id, adminId: signedInAdmin(res).id }, "Chat deleted");
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

router.post("/admin/chats/:id/messages", async (req, res, next) => {
  try {
    const { id } = SendAdminChatMessageParams.parse(req.params);
    const { body } = SendAdminChatMessageBody.parse(req.body);
    const admin = signedInAdmin(res);
    const [thread] = await db
      .select({
        id: chatThreadsTable.id,
        customerName: chatThreadsTable.customerName,
        phone: chatThreadsTable.phone,
        userId: chatThreadsTable.userId,
      })
      .from(chatThreadsTable)
      .where(eq(chatThreadsTable.id, id))
      .limit(1);
    if (!thread) return res.status(404).json({ error: "Suhbat topilmadi" });
    if (await threadOwnerBlocked(thread.userId)) {
      return res.status(409).json({ error: "Mijoz bloklangan va javoblarni o‘qiy olmaydi" });
    }

    const [message] = await db
      .insert(chatMessagesTable)
      .values({ threadId: id, sender: "operator", body: body.trim(), adminId: admin.id })
      .returning();
    await db
      .update(chatThreadsTable)
      .set({ lastMessageAt: message.createdAt, operatorReadAt: message.createdAt })
      .where(eq(chatThreadsTable.id, id));

    // Copied to every admin chat so Telegram holds the whole conversation.
    // Best effort: the customer already has the reply either way.
    const copied = await sendOperatorReplyNotification(
      {
        threadId: thread.id,
        customerName: thread.customerName,
        phone: thread.phone,
        body: message.body,
        authorName: admin.displayName,
        via: "panel",
      },
      await linkedTelegramChatIds(),
    );
    if (!copied.sent) {
      req.log.warn({ reason: copied.error }, "Telegram operator reply copy failed");
    }
    await deliverReplyToCustomerTelegram(req, thread.userId, message.body, await linkedTelegramChatIds());
    return res.status(201).json({ ...chatMessageDto(message), admin_name: admin.displayName });
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/dashboard", async (_req, res, next) => {
  try {
    await ensureSeedData();
    const orders = await db.select().from(ordersTable);
    const now = Date.now();
    // Midnight in Tashkent; the server's own clock is UTC.
    const todayStart = tashkentDayStart(new Date(now));
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const recent = orders.filter((order) => order.createdAt >= todayStart);
    // Revenue is money actually earned: only delivered orders, counted on the
    // day they were delivered. Delivered is the last status, so the time of
    // the last status change is the delivery time; orders delivered before
    // that was recorded fall back to when they were placed.
    const sumSince = (from: Date) =>
      orders
        .filter((order) => order.status === "delivered" && (order.statusChangedAt ?? order.createdAt) >= from)
        .reduce((sum, order) => sum + money(order.total)!, 0);
    const statuses = (status: string) => orders.filter((order) => order.status === status).length;
    const [{ count: productCount }] = await db.select({ count: sql<number>`count(*)` }).from(productsTable);
    const [{ count: lowStockCount }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(productsTable)
      // A hidden product is not for sale, so it is not a restocking signal.
      .where(and(sql`${productsTable.stock} <= 5`, eq(productsTable.active, true)));
    res.json({
      today_orders: recent.length,
      new_orders: statuses("new"),
      preparing_orders: statuses("preparing"),
      courier_orders: statuses("courier"),
      delivered_orders: statuses("delivered"),
      cancelled_orders: statuses("cancelled"),
      today_revenue: sumSince(todayStart),
      weekly_revenue: sumSince(weekStart),
      monthly_revenue: sumSince(monthStart),
       customer_count: new Set(orders.filter((order) => order.status !== "cancelled").map((order) => order.phone)).size,
      product_count: Number(productCount),
      low_stock_count: Number(lowStockCount),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/orders", async (req, res, next) => {
  try {
    const query = ListAdminOrdersQueryParams.parse(req.query);
    const rows = await db
      .select({
        order: ordersTable,
        changedBy: adminsTable.displayName,
        telegramName: usersTable.telegramName,
        telegramUsername: usersTable.telegramUsername,
      })
      .from(ordersTable)
      .leftJoin(adminsTable, eq(ordersTable.statusChangedBy, adminsTable.id))
      .leftJoin(usersTable, eq(ordersTable.userId, usersTable.id))
      .where(query.status ? eq(ordersTable.status, query.status) : undefined)
      .orderBy(desc(ordersTable.createdAt));
    res.json(rows.map(({ order, changedBy, telegramName, telegramUsername }) =>
      adminOrderDto(order, changedBy, { name: telegramName ?? null, username: telegramUsername ?? null })));
  } catch (error) {
    return next(error);
  }
});

router.patch("/admin/orders/:id/status", async (req, res, next) => {
  try {
    const { id } = UpdateAdminOrderStatusParams.parse(req.params);
    const { status } = UpdateAdminOrderStatusBody.parse(req.body);
    const admin = signedInAdmin(res);
    const outcome = await db.transaction(async (tx) => {
      // Locked so two admins pressing at once cannot both cancel the same
      // order and return its stock twice.
      const [current] = await tx.select().from(ordersTable).where(eq(ordersTable.id, id)).limit(1).for("update");
      if (!current) return { kind: "missing" as const };
      if (!canChangeStatus(current.status, status)) return { kind: "refused" as const, from: current.status };

      if (status === "cancelled") {
        // What the order took out of stock goes back. A product deleted since
        // simply has nothing to return to.
        for (const [productId, quantity] of stockToRestore(current.items)) {
          await tx
            .update(productsTable)
            .set({ stock: sql`${productsTable.stock} + ${quantity}` })
            .where(eq(productsTable.id, productId));
        }
      }
      const [order] = await tx
        .update(ordersTable)
        .set({ status, statusChangedBy: admin.id, statusChangedAt: new Date() })
        .where(eq(ordersTable.id, id))
        .returning();
      return { kind: "updated" as const, order };
    });
    if (outcome.kind === "missing") return res.status(404).json({ error: "Order not found" });
    if (outcome.kind === "refused") {
      return res.status(409).json({ error: "Buyurtma holatini bunday o‘zgartirib bo‘lmaydi", current_status: outcome.from });
    }
    return res.json(adminOrderDto(outcome.order, admin.displayName, await orderTelegram(outcome.order.userId)));
  } catch (error) {
    return next(error);
  }
});

export default router;