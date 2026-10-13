import { Router, type IRouter, type Response } from "express";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  BlockCustomerBody,
  BlockCustomerParams,
  BlockCustomerSessionBody,
  BlockCustomerSessionParams,
  ListCustomerSessionsParams,
  ReplaceCustomerAddressesBody,
  RevokeCustomerSessionParams,
  UnblockCustomerEverywhereParams,
  UnblockCustomerParams,
  UnblockCustomerSessionParams,
  SignInWithTelegramBody,
  UpdateCustomerProfileBody,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  customerAddressesTable,
  customerSessionsTable,
  customerShopBlocksTable,
  ordersTable,
  usersTable,
} from "@workspace/db/schema";
import { adminShopId, isPlatformSuperAdmin, signedInAdmin } from "../lib/admin-directory";
import { PLATFORM_SHOP_ID, publicBaseUrl, requestShop, shopBot } from "../lib/shops";
import {
  AccountLimitError,
  BlockedMergeError,
  blockedMessage,
  customerIsBlocked,
  customerProfileDto,
  customerSessions,
  endCustomerSession,
  ensureCustomer,
  isBlocked,
  isSessionActive,
  isVerified,
  rememberLanguage,
  replaceAddresses,
  resolveCustomer,
  signInByTelegram,
  telegramIsBlocked,
  type SessionRow,
} from "../lib/customer-accounts";
import { CHAT_SESSION_COOKIE } from "../lib/chat-session";
import { clearCustomerCookie } from "../lib/customer-session";
import { flatKey } from "../lib/order-rules";
import { normalizeUzPhone } from "../lib/phone";
import { botConfigured, getBotUsername, verifyWebAppInitData, webAppUser, registerMenuButton, withBot } from "../lib/telegram";
import { requestLang, translate, type Lang } from "../lib/i18n";
import { accountMessages, commonMessages } from "../lib/messages";

const router: IRouter = Router();

const ADDRESS_PART = /^[0-9A-Za-z]{1,10}$/;

router.get("/customer/me", async (req, res, next) => {
  try {
    return res.json(await customerProfileDto(await resolveCustomer(req, res)));
  } catch (error) {
    return next(error);
  }
});

// What the customer is told, in the language the web app shows (X-Lang),
// else their account's, else their browser's.
function say(lang: Lang, key: keyof typeof accountMessages.uz) {
  return translate(accountMessages, lang, key);
}

function tooManyAccounts(lang: Lang) {
  return translate(commonMessages, lang, "tooManyAttempts");
}

router.patch("/customer/me", async (req, res, next) => {
  let lang = requestLang(req);
  try {
    const input = UpdateCustomerProfileBody.parse(req.body);
    const name = input.name?.trim();
    const rawPhone = input.phone?.trim();
    let phone: string | null | undefined;
    if (rawPhone !== undefined) {
      if (rawPhone === "") phone = null;
      else {
        phone = normalizeUzPhone(rawPhone);
        if (!phone) return res.status(400).json({ error: say(lang, "phoneInvalid") });
      }
    }
    if (name !== undefined && name !== "" && (name.length < 2 || name.length > 80)) {
      return res.status(400).json({ error: say(lang, "nameLength") });
    }
    const customer = await ensureCustomer(req, res);
    lang = requestLang(req, customer.user);
    if (customerIsBlocked(customer)) return res.status(403).json({ error: blockedMessage(lang), blocked: true });
    // The customer's own details, whatever they type: the Telegram account,
    // not the phone, is who they are. A number changed away from the one an
    // earlier build verified is no longer marked verified.
    const user = customer.user;
    const phoneChanged = phone !== undefined && phone !== user.phone;
    const [updated] = await db
      .update(usersTable)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(phone !== undefined ? { phone } : {}),
        // The language the customer picked in the shop.
        ...(input.language !== undefined ? { language: input.language } : {}),
        ...(phoneChanged && isVerified(user) ? { phoneVerifiedAt: null } : {}),
      })
      .where(eq(usersTable.id, user.id))
      .returning();
    // The menu button of Q express's bot, the one bot with a Mini App, follows
    // the customer's language. Best effort.
    if (input.language !== undefined && input.language !== user.language && updated.telegramId) {
      void registerMenuButton(publicBaseUrl(req), updated.telegramId, input.language);
    }
    return res.json(await customerProfileDto({ ...customer, user: updated }));
  } catch (error) {
    if (error instanceof AccountLimitError) return res.status(429).json({ error: tooManyAccounts(lang) });
    return next(error);
  }
});

router.put("/customer/me/addresses", async (req, res, next) => {
  let lang = requestLang(req);
  try {
    const { addresses } = ReplaceCustomerAddressesBody.parse(req.body);
    const cleaned = addresses.map((address) => ({ dom: address.dom.trim(), xonadon: address.xonadon.trim() }));
    if (cleaned.some((address) => !ADDRESS_PART.test(address.dom) || !ADDRESS_PART.test(address.xonadon))) {
      return res.status(400).json({ error: say(lang, "addressInvalid") });
    }
    const customer = await ensureCustomer(req, res);
    lang = requestLang(req, customer.user);
    if (customerIsBlocked(customer)) return res.status(403).json({ error: blockedMessage(lang), blocked: true });
    await replaceAddresses(customer.user.id, cleaned);
    return res.json(await customerProfileDto(customer));
  } catch (error) {
    if (error instanceof AccountLimitError) return res.status(429).json({ error: tooManyAccounts(lang) });
    return next(error);
  }
});

// Outside Telegram the site sends people to the bot, where the shop opens as
// the Mini App and they are signed in by their Telegram account.
router.get("/customer/login", async (req, res, next) => {
  try {
    // The bot of the shop the page shows.
    const shop = await requestShop(req.query.shop);
    const username = shop ? await withBot(await shopBot(shop), () => getBotUsername()) : undefined;
    if (!username) return res.status(503).json({ error: say(requestLang(req), "botNotConfigured") });
    return res.json({ url: `https://t.me/${username}` });
  } catch (error) {
    return next(error);
  }
});

// Inside the Mini App: Telegram's signed launch data is the sign-in. Sent on
// every launch, so the webview always follows the Telegram account using it.
router.post("/customer/telegram", async (req, res, next) => {
  // The Mini App says which language it shows; on the first launch that is
  // the language of the customer's Telegram.
  const lang = requestLang(req);
  try {
    const { init_data } = SignInWithTelegramBody.parse(req.body);
    // Only Q express's own bot opens the Mini App, so only launch data it
    // signed is accepted. Another shop's owner holds their bot's token and
    // could sign launch data for anybody with it; their bots therefore link
    // to Q express's Mini App rather than opening one of their own.
    if (!botConfigured()) return res.status(503).json({ error: say(lang, "botNotConfigured") });
    const telegramUserId = verifyWebAppInitData(init_data);
    if (!telegramUserId) return res.status(401).json({ error: say(lang, "telegramNotVerified") });
    if (await telegramIsBlocked(telegramUserId)) return res.status(403).json({ error: blockedMessage(lang), blocked: true });
    // A blocked device stays blocked for the account it belongs to. Another
    // Telegram account on the same phone is a different person and gets its
    // own session.
    const current = await resolveCustomer(req, res);
    if (customerIsBlocked(current) && (current!.session.telegramId ?? telegramUserId) === telegramUserId) {
      return res.status(403).json({ error: blockedMessage(lang), blocked: true });
    }
    const signedIn = await signInByTelegram(req, res, telegramUserId, webAppUser(init_data));
    // An account that has no language yet takes the one the Mini App opened
    // in, without asking; one the customer already has is kept.
    const customer = { ...signedIn, user: await rememberLanguage(signedIn.user, lang) };
    // The token goes back too: the Mini App sends it as a bearer header,
    // because Telegram Web runs the shop in a frame that may drop the cookie.
    return res.json({ profile: await customerProfileDto(customer), session_token: customer.token });
  } catch (error) {
    if (error instanceof BlockedMergeError) return res.status(403).json({ error: blockedMessage(lang), blocked: true });
    return next(error);
  }
});

router.post("/customer/logout", async (req, res, next) => {
  try {
    await endCustomerSession(req);
    // The old chat cookie goes too, so the next person on a shared phone does
    // not land in this customer's conversation.
    const cookie = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
    clearCustomerCookie(res);
    res.clearCookie(CHAT_SESSION_COOKIE, cookie);
    return res.json(await customerProfileDto(undefined));
  } catch (error) {
    return next(error);
  }
});

// Every customer of a shop, or one, with order totals, saved addresses and any
// block. A shop's admins, Q express's included, meet a customer with their
// first order there (the owner's rule): the account is shared by every shop,
// but who it is stays out of a shop's sight until it is that shop's customer.
// Only that shop's orders are counted, and only the flats it delivered to.
// Someone who only wrote to the shop's chat, or is blocked here, is listed
// too, so they can be blocked or let back in, but as their Telegram name
// alone: no phone and no addresses until they order. A platform super admin
// (`full`) is not held to that in any shop: they see every customer whole.
async function adminCustomers(shopId: number, onlyId?: number, full = false) {
    const rows = await db
      .select({
        user: usersTable,
        blockedByName: sql<string | null>`(select a.display_name from admins a where a.id = ${usersTable.blockedBy})`,
        activeSessions: sql<number>`(select count(*) from customer_sessions s
          where s.user_id = ${usersTable.id} and s.revoked_at is null and s.blocked_at is null)`,
        // Devices an admin blocked: their Telegram account is refused everywhere.
        blockedDevices: sql<number>`(select count(*) from customer_sessions s
          where s.blocked_at is not null and (
            case when ${usersTable.telegramId} is null then s.user_id = ${usersTable.id}
                 else s.telegram_id = ${usersTable.telegramId} end))`,
        orderCount: sql<number>`count(${ordersTable.id}) filter (where ${ordersTable.status} <> 'cancelled')`,
        // What the customer has actually paid for: delivered orders only.
        totalSpent: sql<string>`coalesce(sum(${ordersTable.total}) filter (where ${ordersTable.status} = 'delivered'), 0)`,
        lastOrderAt: sql<Date | null>`max(${ordersTable.createdAt})`,
        ordered: sql<boolean>`count(${ordersTable.id}) > 0`,
        orderedFlats: sql<string[]>`coalesce(array_agg(distinct ${ordersTable.addressKey}) filter (where ${ordersTable.addressKey} is not null), '{}')`,
      })
      .from(usersTable)
      .leftJoin(ordersTable, and(eq(ordersTable.userId, usersTable.id), eq(ordersTable.shopId, shopId)))
      .where(and(
        onlyId === undefined ? undefined : eq(usersTable.id, onlyId),
        or(
          sql`exists (select 1 from orders o where o.user_id = ${usersTable.id} and o.shop_id = ${shopId})`,
          sql`exists (select 1 from chat_threads t where t.user_id = ${usersTable.id} and t.shop_id = ${shopId})`,
          sql`exists (select 1 from customer_shop_blocks b where b.user_id = ${usersTable.id} and b.shop_id = ${shopId})`,
          shopId === PLATFORM_SHOP_ID ? isNotNull(usersTable.blockedAt) : undefined,
        ),
      ))
      .groupBy(usersTable.id)
      .orderBy(sql`max(${ordersTable.createdAt}) desc nulls last`, desc(usersTable.createdAt));
    const shopBlocks = await db
      .select({
        userId: customerShopBlocksTable.userId,
        blockedAt: customerShopBlocksTable.blockedAt,
        reason: customerShopBlocksTable.reason,
        blockedBy: sql<string | null>`(select a.display_name from admins a where a.id = ${customerShopBlocksTable.blockedBy})`,
      })
      .from(customerShopBlocksTable)
      .where(eq(customerShopBlocksTable.shopId, shopId));
    const shopBlockByUser = new Map(shopBlocks.map((block) => [block.userId, block]));
    const addresses = await db
      .select()
      .from(customerAddressesTable)
      .orderBy(desc(customerAddressesTable.lastUsedAt));
    const byUser = new Map<number, { dom: string; xonadon: string }[]>();
    for (const address of addresses) {
      const list = byUser.get(address.userId) ?? [];
      list.push({ dom: address.dom, xonadon: address.xonadon });
      byUser.set(address.userId, list);
    }
    return rows.map(({ user, blockedByName, activeSessions, blockedDevices, orderCount, totalSpent, lastOrderAt, ordered, orderedFlats }) => {
      const flats = new Set(orderedFlats);
      const known = ordered || full;
      // A block everywhere wins; otherwise this shop's own.
      const shopBlock = shopBlockByUser.get(user.id);
      const block = isBlocked(user)
        ? { at: user.blockedAt!, by: blockedByName, reason: user.blockReason }
        : shopBlock
          ? { at: shopBlock.blockedAt, by: shopBlock.blockedBy, reason: shopBlock.reason }
          : undefined;
      return {
        id: user.id,
        name: known ? user.name : "",
        phone: known ? user.phone ?? "" : "",
        phone_verified: known && isVerified(user),
        telegram_linked: user.telegramId !== null,
        telegram_name: user.telegramName,
        telegram_username: user.telegramUsername,
        active_sessions: Number(activeSessions),
        order_count: Number(orderCount),
        total_spent: Number(totalSpent),
        last_order_at: lastOrderAt ? new Date(lastOrderAt).toISOString() : null,
        created_at: user.createdAt.toISOString(),
        addresses: (byUser.get(user.id) ?? []).filter((address) => full || flats.has(flatKey(address.dom, address.xonadon))),
        // Blocked on the account, by this shop, or on any of its devices:
        // either way the customer is refused here.
        blocked: block !== undefined || Number(blockedDevices) > 0,
        // Blocked by Q express on the account or a device: only Q express can
        // lift it, whichever shop the customer is shown in.
        blocked_everywhere: isBlocked(user) || Number(blockedDevices) > 0,
        blocked_devices: Number(blockedDevices),
        blocked_at: block ? block.at.toISOString() : null,
        blocked_by: block ? block.by : null,
        block_reason: block ? block.reason : null,
      };
    });
}

// Behind the /admin guard registered in routes/admins.ts, which runs first.
router.get("/admin/customers", async (_req, res, next) => {
  try {
    res.json(await adminCustomers(adminShopId(res), undefined, platformSuper(res)));
  } catch (error) {
    return next(error);
  }
});

// Only a super admin may block or lift a block (the owner's decision); every
// admin can see who is blocked. The block takes effect on the customer's next
// request. In Q express a platform super admin blocks a customer everywhere;
// in another shop the shop's super admin blocks them in that shop alone.
// A platform super admin has no limits in any shop (the owner's decision,
// 2026-10-13): there they may block in that shop or everywhere, and lift
// either.
// The /admin guard only lets a platform super admin act outside their own
// shop, so a super admin is always one of the shop being acted in.
function superAdminOnly(res: Response) {
  if (signedInAdmin(res).role === "super_admin") return true;
  res.status(403).json({ error: "Bloklash faqat super admin uchun" });
  return false;
}

function platformSuper(res: Response) {
  return isPlatformSuperAdmin(signedInAdmin(res));
}

// Devices are shared by every shop, so only Q express handles them: any of
// its admins in Q express, its super admins in whichever shop they work in.
function platformOnly(res: Response) {
  if (adminShopId(res) === PLATFORM_SHOP_ID || platformSuper(res)) return true;
  res.status(403).json({ error: "Qurilmalarni faqat Q express boshqaradi" });
  return false;
}

const EVERYWHERE_BLOCK = "Bu mijozni Q express hamma do‘konlarda bloklagan. Uni faqat Q express super admini blokdan chiqara oladi.";

router.post("/admin/customers/:id/block", async (req, res, next) => {
  try {
    if (!superAdminOnly(res)) return;
    const { id } = BlockCustomerParams.parse(req.params);
    const { reason, everywhere } = BlockCustomerBody.parse(req.body ?? {});
    const shopId = adminShopId(res);
    const full = platformSuper(res);
    if (everywhere && shopId !== PLATFORM_SHOP_ID && !full) {
      return res.status(403).json({ error: "Hamma do‘konlarda faqat Q express super admini bloklay oladi" });
    }
    const [exists] = await adminCustomers(shopId, id, full);
    if (!exists) return res.status(404).json({ error: "Mijoz topilmadi" });
    if (shopId === PLATFORM_SHOP_ID || everywhere) {
      await db
        .update(usersTable)
        .set({ blockedAt: new Date(), blockedBy: signedInAdmin(res).id, blockReason: reason?.trim() || null })
        .where(eq(usersTable.id, id));
    } else {
      await db
        .insert(customerShopBlocksTable)
        .values({ shopId, userId: id, blockedBy: signedInAdmin(res).id, reason: reason?.trim() || null })
        .onConflictDoUpdate({
          target: [customerShopBlocksTable.shopId, customerShopBlocksTable.userId],
          set: { blockedAt: new Date(), blockedBy: signedInAdmin(res).id, reason: reason?.trim() || null },
        });
    }
    const [customer] = await adminCustomers(shopId, id, full);
    return res.json(customer);
  } catch (error) {
    return next(error);
  }
});

function liftShopBlock(shopId: number, userId: number) {
  return db
    .delete(customerShopBlocksTable)
    .where(and(eq(customerShopBlocksTable.shopId, shopId), eq(customerShopBlocksTable.userId, userId)))
    .returning({ userId: customerShopBlocksTable.userId });
}

// Lifts the block on the account and its device blocks too; otherwise the
// Telegram account would stay refused with nothing on the card to say so.
async function liftEverywhereBlock(userId: number) {
  const [updated] = await db
    .update(usersTable)
    .set({ blockedAt: null, blockedBy: null, blockReason: null })
    .where(eq(usersTable.id, userId))
    .returning({ id: usersTable.id, telegramId: usersTable.telegramId });
  if (!updated) return false;
  await db
    .update(customerSessionsTable)
    .set({ blockedAt: null, blockedBy: null, blockReason: null })
    .where(
      updated.telegramId === null
        ? eq(customerSessionsTable.userId, userId)
        : or(eq(customerSessionsTable.userId, userId), eq(customerSessionsTable.telegramId, updated.telegramId)),
    );
  return true;
}

router.delete("/admin/customers/:id/block", async (req, res, next) => {
  try {
    if (!superAdminOnly(res)) return;
    const { id } = UnblockCustomerParams.parse(req.params);
    const shopId = adminShopId(res);
    const full = platformSuper(res);
    const [exists] = await adminCustomers(shopId, id, full);
    if (!exists) return res.status(404).json({ error: "Mijoz topilmadi" });
    if (shopId !== PLATFORM_SHOP_ID) {
      // Only this shop's own block; one set by Q express stays.
      const lifted = await liftShopBlock(shopId, id);
      const [customer] = await adminCustomers(shopId, id, full);
      // Still refused here, so the admin is told why rather than shown a
      // success that changed nothing they can see.
      if (customer?.blocked_everywhere) {
        return res.status(409).json({
          error: lifted.length > 0 ? `Do‘kondagi blok olindi. ${EVERYWHERE_BLOCK}` : EVERYWHERE_BLOCK,
        });
      }
      // Let back in, the customer may no longer be on this shop's list at all
      // (null): blocked was the only thing that kept them there.
      return res.json(customer ?? null);
    }
    if (!(await liftEverywhereBlock(id))) return res.status(404).json({ error: "Mijoz topilmadi" });
    const [customer] = await adminCustomers(shopId, id, full);
    return res.json(customer ?? null);
  } catch (error) {
    return next(error);
  }
});

// A platform super admin working in another shop lifts everything that
// refuses the customer there: that shop's block and Q express's.
router.delete("/admin/customers/:id/block-everywhere", async (req, res, next) => {
  try {
    if (!platformSuper(res)) return res.status(403).json({ error: "Bu amal faqat Q express super admini uchun" });
    const { id } = UnblockCustomerEverywhereParams.parse(req.params);
    const shopId = adminShopId(res);
    const [exists] = await adminCustomers(shopId, id, true);
    if (!exists) return res.status(404).json({ error: "Mijoz topilmadi" });
    if (shopId !== PLATFORM_SHOP_ID) await liftShopBlock(shopId, id);
    if (!(await liftEverywhereBlock(id))) return res.status(404).json({ error: "Mijoz topilmadi" });
    const [customer] = await adminCustomers(shopId, id, true);
    return res.json(customer ?? null);
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// A customer's devices
// ---------------------------------------------------------------------------

async function sessionDto(session: SessionRow) {
  let blockedBy: string | null = null;
  if (session.blockedBy !== null) {
    const { rows } = await db.execute<{ display_name: string }>(
      sql`select display_name from admins where id = ${session.blockedBy}`,
    );
    blockedBy = rows[0]?.display_name ?? null;
  }
  return {
    id: session.id,
    source: session.source === "telegram" ? ("telegram" as const) : ("browser" as const),
    user_agent: session.userAgent,
    created_at: session.createdAt.toISOString(),
    last_seen_at: session.lastSeenAt.toISOString(),
    revoked_at: session.revokedAt ? session.revokedAt.toISOString() : null,
    blocked: session.blockedAt !== null,
    blocked_at: session.blockedAt ? session.blockedAt.toISOString() : null,
    blocked_by: blockedBy,
    block_reason: session.blockReason,
    current: isSessionActive(session),
  };
}

router.get("/admin/customers/:id/sessions", async (req, res, next) => {
  try {
    if (!platformOnly(res)) return;
    const { id } = ListCustomerSessionsParams.parse(req.params);
    const sessions = await customerSessions(id);
    return res.json(await Promise.all(sessions.map(sessionDto)));
  } catch (error) {
    return next(error);
  }
});

// Any admin may sign a device out: it costs the customer nothing but signing
// in again.
router.post("/admin/customer-sessions/:id/revoke", async (req, res, next) => {
  try {
    if (!platformOnly(res)) return;
    const { id } = RevokeCustomerSessionParams.parse(req.params);
    const [session] = await db
      .update(customerSessionsTable)
      .set({ revokedAt: new Date(), revokedBy: signedInAdmin(res).id })
      .where(and(eq(customerSessionsTable.id, id), isNull(customerSessionsTable.revokedAt)))
      .returning();
    if (session) return res.json(await sessionDto(session));
    const [existing] = await db.select().from(customerSessionsTable).where(eq(customerSessionsTable.id, id)).limit(1);
    if (!existing) return res.status(404).json({ error: "Qurilma topilmadi" });
    return res.json(await sessionDto(existing));
  } catch (error) {
    return next(error);
  }
});

router.post("/admin/customer-sessions/:id/block", async (req, res, next) => {
  try {
    if (!platformOnly(res) || !superAdminOnly(res)) return;
    const { id } = BlockCustomerSessionParams.parse(req.params);
    const { reason } = BlockCustomerSessionBody.parse(req.body ?? {});
    const [session] = await db
      .update(customerSessionsTable)
      .set({ blockedAt: new Date(), blockedBy: signedInAdmin(res).id, blockReason: reason?.trim() || null })
      .where(eq(customerSessionsTable.id, id))
      .returning();
    if (!session) return res.status(404).json({ error: "Qurilma topilmadi" });
    return res.json(await sessionDto(session));
  } catch (error) {
    return next(error);
  }
});

router.delete("/admin/customer-sessions/:id/block", async (req, res, next) => {
  try {
    if (!platformOnly(res) || !superAdminOnly(res)) return;
    const { id } = UnblockCustomerSessionParams.parse(req.params);
    const [session] = await db
      .update(customerSessionsTable)
      .set({ blockedAt: null, blockedBy: null, blockReason: null })
      .where(eq(customerSessionsTable.id, id))
      .returning();
    if (!session) return res.status(404).json({ error: "Qurilma topilmadi" });
    return res.json(await sessionDto(session));
  } catch (error) {
    return next(error);
  }
});

export default router;
