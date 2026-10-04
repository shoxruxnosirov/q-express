import { Router, type IRouter, type Response } from "express";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  BlockCustomerBody,
  BlockCustomerParams,
  BlockCustomerSessionBody,
  BlockCustomerSessionParams,
  ListCustomerSessionsParams,
  ReplaceCustomerAddressesBody,
  RevokeCustomerSessionParams,
  UnblockCustomerParams,
  UnblockCustomerSessionParams,
  SignInWithTelegramBody,
  UpdateCustomerProfileBody,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { customerAddressesTable, customerSessionsTable, ordersTable, usersTable } from "@workspace/db/schema";
import { signedInAdmin } from "../lib/admin-directory";
import {
  AccountLimitError,
  BLOCKED_MESSAGE,
  BlockedMergeError,
  customerIsBlocked,
  customerProfileDto,
  customerSessions,
  endCustomerSession,
  ensureCustomer,
  isBlocked,
  isSessionActive,
  isVerified,
  replaceAddresses,
  resolveCustomer,
  signInByTelegram,
  telegramIsBlocked,
  type SessionRow,
} from "../lib/customer-accounts";
import { CHAT_SESSION_COOKIE } from "../lib/chat-session";
import { clearCustomerCookie } from "../lib/customer-session";
import { normalizeUzPhone } from "../lib/phone";
import { getBotUsername, verifyWebAppInitData, webAppUser } from "../lib/telegram";

const router: IRouter = Router();

const TOO_MANY_ACCOUNTS = "Juda ko‘p urinish. Birozdan keyin qayta urinib ko‘ring.";
const ADDRESS_PART = /^[0-9A-Za-z]{1,10}$/;

router.get("/customer/me", async (req, res, next) => {
  try {
    return res.json(await customerProfileDto(await resolveCustomer(req, res)));
  } catch (error) {
    return next(error);
  }
});

router.patch("/customer/me", async (req, res, next) => {
  try {
    const input = UpdateCustomerProfileBody.parse(req.body);
    const name = input.name?.trim();
    const rawPhone = input.phone?.trim();
    let phone: string | null | undefined;
    if (rawPhone !== undefined) {
      if (rawPhone === "") phone = null;
      else {
        phone = normalizeUzPhone(rawPhone);
        if (!phone) return res.status(400).json({ error: "Telefon raqam noto‘g‘ri. Masalan: +998 90 123 45 67" });
      }
    }
    if (name !== undefined && name !== "" && (name.length < 2 || name.length > 80)) {
      return res.status(400).json({ error: "Ism 2–80 ta belgidan iborat bo‘lsin" });
    }
    const customer = await ensureCustomer(req, res);
    if (customerIsBlocked(customer)) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
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
        ...(phoneChanged && isVerified(user) ? { phoneVerifiedAt: null } : {}),
      })
      .where(eq(usersTable.id, user.id))
      .returning();
    return res.json(await customerProfileDto({ ...customer, user: updated }));
  } catch (error) {
    if (error instanceof AccountLimitError) return res.status(429).json({ error: TOO_MANY_ACCOUNTS });
    return next(error);
  }
});

router.put("/customer/me/addresses", async (req, res, next) => {
  try {
    const { addresses } = ReplaceCustomerAddressesBody.parse(req.body);
    const cleaned = addresses.map((address) => ({ dom: address.dom.trim(), xonadon: address.xonadon.trim() }));
    if (cleaned.some((address) => !ADDRESS_PART.test(address.dom) || !ADDRESS_PART.test(address.xonadon))) {
      return res.status(400).json({ error: "Manzil noto‘g‘ri" });
    }
    const customer = await ensureCustomer(req, res);
    if (customerIsBlocked(customer)) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    await replaceAddresses(customer.user.id, cleaned);
    return res.json(await customerProfileDto(customer));
  } catch (error) {
    if (error instanceof AccountLimitError) return res.status(429).json({ error: TOO_MANY_ACCOUNTS });
    return next(error);
  }
});

// Outside Telegram the site sends people to the bot, where the shop opens as
// the Mini App and they are signed in by their Telegram account.
router.get("/customer/login", async (_req, res, next) => {
  try {
    const username = await getBotUsername();
    if (!username) return res.status(503).json({ error: "Telegram bot sozlanmagan" });
    return res.json({ url: `https://t.me/${username}` });
  } catch (error) {
    return next(error);
  }
});

// Inside the Mini App: Telegram's signed launch data is the sign-in. Sent on
// every launch, so the webview always follows the Telegram account using it.
router.post("/customer/telegram", async (req, res, next) => {
  try {
    const { init_data } = SignInWithTelegramBody.parse(req.body);
    const telegramUserId = verifyWebAppInitData(init_data);
    if (!telegramUserId) return res.status(401).json({ error: "Telegram ma’lumoti tasdiqlanmadi" });
    if (await telegramIsBlocked(telegramUserId)) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    // A blocked device stays blocked for the account it belongs to. Another
    // Telegram account on the same phone is a different person and gets its
    // own session.
    const current = await resolveCustomer(req, res);
    if (customerIsBlocked(current) && (current!.session.telegramId ?? telegramUserId) === telegramUserId) {
      return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    }
    const customer = await signInByTelegram(req, res, telegramUserId, webAppUser(init_data));
    // The token goes back too: the Mini App sends it as a bearer header,
    // because Telegram Web runs the shop in a frame that may drop the cookie.
    return res.json({ profile: await customerProfileDto(customer), session_token: customer.token });
  } catch (error) {
    if (error instanceof BlockedMergeError) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
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

// Every customer, or one, with order totals, saved addresses and any block.
async function adminCustomers(onlyId?: number) {
    const rows = await db
      .select({
        user: usersTable,
        blockedByName: sql<string | null>`(select a.display_name from admins a where a.id = ${usersTable.blockedBy})`,
        activeSessions: sql<number>`(select count(*) from customer_sessions s
          where s.user_id = ${usersTable.id} and s.revoked_at is null and s.blocked_at is null)`,
        // Devices an admin blocked: their Telegram account is refused everywhere.
        blockedDevices: sql<number>`(select count(*) from customer_sessions s
          where s.blocked_at is not null and (s.user_id = ${usersTable.id}
            or (${usersTable.telegramId} is not null and s.telegram_id = ${usersTable.telegramId})))`,
        orderCount: sql<number>`count(${ordersTable.id}) filter (where ${ordersTable.status} <> 'cancelled')`,
        // What the customer has actually paid for: delivered orders only.
        totalSpent: sql<string>`coalesce(sum(${ordersTable.total}) filter (where ${ordersTable.status} = 'delivered'), 0)`,
        lastOrderAt: sql<Date | null>`max(${ordersTable.createdAt})`,
      })
      .from(usersTable)
      .leftJoin(ordersTable, eq(ordersTable.userId, usersTable.id))
      .where(onlyId === undefined ? undefined : eq(usersTable.id, onlyId))
      .groupBy(usersTable.id)
      .orderBy(sql`max(${ordersTable.createdAt}) desc nulls last`, desc(usersTable.createdAt));
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
    return rows.map(({ user, blockedByName, activeSessions, blockedDevices, orderCount, totalSpent, lastOrderAt }) => ({
        id: user.id,
        name: user.name,
        phone: user.phone ?? "",
        phone_verified: isVerified(user),
        telegram_linked: user.telegramId !== null,
        telegram_name: user.telegramName,
        telegram_username: user.telegramUsername,
        active_sessions: Number(activeSessions),
        order_count: Number(orderCount),
        total_spent: Number(totalSpent),
        last_order_at: lastOrderAt ? new Date(lastOrderAt).toISOString() : null,
        created_at: user.createdAt.toISOString(),
        addresses: byUser.get(user.id) ?? [],
        // Blocked on the account or on any of its devices: either way the
        // customer is refused.
        blocked: isBlocked(user) || Number(blockedDevices) > 0,
        blocked_devices: Number(blockedDevices),
        blocked_at: user.blockedAt ? user.blockedAt.toISOString() : null,
        blocked_by: user.blockedAt ? blockedByName : null,
        block_reason: user.blockReason,
      }));
}

// Behind the /admin guard registered in routes/admins.ts, which runs first.
router.get("/admin/customers", async (_req, res, next) => {
  try {
    res.json(await adminCustomers());
  } catch (error) {
    return next(error);
  }
});

// Only a super admin may block or lift a block (the owner's decision); every
// admin can see who is blocked. The block takes effect on the customer's next
// request.
function superAdminOnly(res: Response) {
  if (signedInAdmin(res).role === "super_admin") return true;
  res.status(403).json({ error: "Bloklash faqat super admin uchun" });
  return false;
}

router.post("/admin/customers/:id/block", async (req, res, next) => {
  try {
    if (!superAdminOnly(res)) return;
    const { id } = BlockCustomerParams.parse(req.params);
    const { reason } = BlockCustomerBody.parse(req.body ?? {});
    const [updated] = await db
      .update(usersTable)
      .set({ blockedAt: new Date(), blockedBy: signedInAdmin(res).id, blockReason: reason?.trim() || null })
      .where(eq(usersTable.id, id))
      .returning({ id: usersTable.id });
    if (!updated) return res.status(404).json({ error: "Mijoz topilmadi" });
    const [customer] = await adminCustomers(id);
    return res.json(customer);
  } catch (error) {
    return next(error);
  }
});

router.delete("/admin/customers/:id/block", async (req, res, next) => {
  try {
    if (!superAdminOnly(res)) return;
    const { id } = UnblockCustomerParams.parse(req.params);
    const [updated] = await db
      .update(usersTable)
      .set({ blockedAt: null, blockedBy: null, blockReason: null })
      .where(eq(usersTable.id, id))
      .returning({ id: usersTable.id, telegramId: usersTable.telegramId });
    if (!updated) return res.status(404).json({ error: "Mijoz topilmadi" });
    // Lifting the customer's block lifts their device blocks too; otherwise the
    // Telegram account would stay refused with nothing on the card to say so.
    await db
      .update(customerSessionsTable)
      .set({ blockedAt: null, blockedBy: null, blockReason: null })
      .where(
        updated.telegramId === null
          ? eq(customerSessionsTable.userId, id)
          : or(eq(customerSessionsTable.userId, id), eq(customerSessionsTable.telegramId, updated.telegramId)),
      );
    const [customer] = await adminCustomers(id);
    return res.json(customer);
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
    if (!superAdminOnly(res)) return;
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
    if (!superAdminOnly(res)) return;
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
