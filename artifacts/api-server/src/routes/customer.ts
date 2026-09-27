import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, sql } from "drizzle-orm";
import {
  BlockCustomerBody,
  BlockCustomerParams,
  ReplaceCustomerAddressesBody,
  UnblockCustomerParams,
  SignInWithTelegramBody,
  UpdateCustomerProfileBody,
  VerifyCustomerLoginBody,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { customerAddressesTable, ordersTable, usersTable } from "@workspace/db/schema";
import { signedInAdmin } from "../lib/admin-directory";
import {
  AccountLimitError,
  BLOCKED_MESSAGE,
  BlockedMergeError,
  isBlocked,
  verifiedPhoneIsBlocked,
  telegramIsBlocked,
  consumeLoginCode,
  customerProfileDto,
  endCustomerSession,
  ensureCustomer,
  isVerified,
  replaceAddresses,
  resolveCustomer,
  signInByTelegram,
  signInVerified,
} from "../lib/customer-accounts";
import { CHAT_SESSION_COOKIE } from "../lib/chat-session";
import { CUSTOMER_SESSION_COOKIE } from "../lib/customer-session";
import { normalizeUzPhone } from "../lib/phone";
import { createRateLimiter } from "../lib/rate-window";
import { getBotUsername, verifyWebAppInitData } from "../lib/telegram";

const router: IRouter = Router();

function clientKey(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

// Wrong codes are charged per address, on top of the five guesses each code
// allows, so rotating phone numbers does not buy unlimited guessing.
const codeFailures = createRateLimiter<string>({ windowMs: 15 * 60 * 1000, max: 10 });

const TOO_MANY_ACCOUNTS = "Juda ko‘p urinish. Birozdan keyin qayta urinib ko‘ring.";
const ADDRESS_PART = /^[0-9A-Za-z]{1,10}$/;

router.get("/customer/me", async (req, res, next) => {
  try {
    const signedIn = await resolveCustomer(req, res);
    return res.json(await customerProfileDto(signedIn?.user));
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
    const user = await ensureCustomer(req, res);
    if (isBlocked(user)) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    // A verified number is the customer's identity; changing it means
    // verifying the new one.
    if (phone !== undefined && isVerified(user) && phone !== user.phone) {
      return res.status(400).json({ error: "Tasdiqlangan raqamni o‘zgartirish uchun yangi raqamni tasdiqlang" });
    }
    const [updated] = await db
      .update(usersTable)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(phone !== undefined && !isVerified(user) ? { phone } : {}),
      })
      .where(eq(usersTable.id, user.id))
      .returning();
    return res.json(await customerProfileDto(updated));
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
    const user = await ensureCustomer(req, res);
    if (isBlocked(user)) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    await replaceAddresses(user.id, cleaned);
    return res.json(await customerProfileDto(user));
  } catch (error) {
    if (error instanceof AccountLimitError) return res.status(429).json({ error: TOO_MANY_ACCOUNTS });
    return next(error);
  }
});

router.get("/customer/login", async (_req, res, next) => {
  try {
    const username = await getBotUsername();
    if (!username) return res.status(503).json({ error: "Telegram bot sozlanmagan" });
    return res.json({ url: `https://t.me/${username}?start=login` });
  } catch (error) {
    return next(error);
  }
});

router.post("/customer/login", async (req, res, next) => {
  try {
    const input = VerifyCustomerLoginBody.parse(req.body);
    const key = clientKey(req);
    if (codeFailures.isExhausted(key)) {
      return res.status(429).json({ error: "Juda ko‘p urinish. 15 daqiqadan keyin qayta urinib ko‘ring." });
    }
    const phone = normalizeUzPhone(input.phone);
    // A blocked browser may not sign in to anything (it would merge away).
    const current = await resolveCustomer(req, res);
    if (current && isBlocked(current.user)) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    const check = phone ? await consumeLoginCode(phone, input.code) : ({ ok: false } as const);
    if (!phone || !check.ok) {
      codeFailures.allow(key);
      return res.status(401).json({ error: "Kod noto‘g‘ri yoki eskirgan. Botdan yangi kod oling." });
    }
    // Checked only with a valid code, so this route cannot be used to ask
    // whether a number is blocked.
    if (await verifiedPhoneIsBlocked(phone)) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    const user = await signInVerified(req, res, phone, check.telegramUserId);
    return res.json(await customerProfileDto(user));
  } catch (error) {
    if (error instanceof BlockedMergeError) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    return next(error);
  }
});

router.post("/customer/telegram", async (req, res, next) => {
  try {
    const { init_data } = SignInWithTelegramBody.parse(req.body);
    const telegramUserId = verifyWebAppInitData(init_data);
    if (!telegramUserId) return res.status(401).json({ error: "Telegram ma’lumoti tasdiqlanmadi" });
    if (await telegramIsBlocked(telegramUserId)) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    // Signing a blocked browser in to another account would merge the blocked
    // account away, and the block with it.
    const current = await resolveCustomer(req, res);
    if (current && isBlocked(current.user)) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    const user = await signInByTelegram(req, res, telegramUserId);
    if (user) return res.json(await customerProfileDto(user));
    const signedIn = await resolveCustomer(req, res);
    return res.json(await customerProfileDto(signedIn?.user));
  } catch (error) {
    if (error instanceof BlockedMergeError) return res.status(403).json({ error: BLOCKED_MESSAGE, blocked: true });
    return next(error);
  }
});

router.post("/customer/logout", async (req, res, next) => {
  try {
    await endCustomerSession(req);
    // The chat cookie goes too, so the next person on a shared phone does not
    // land in this customer's conversation.
    const cookie = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
    res.clearCookie(CUSTOMER_SESSION_COOKIE, cookie);
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
    return rows.map(({ user, blockedByName, orderCount, totalSpent, lastOrderAt }) => ({
        id: user.id,
        name: user.name,
        phone: user.phone ?? "",
        phone_verified: isVerified(user),
        order_count: Number(orderCount),
        total_spent: Number(totalSpent),
        last_order_at: lastOrderAt ? new Date(lastOrderAt).toISOString() : null,
        created_at: user.createdAt.toISOString(),
        addresses: byUser.get(user.id) ?? [],
        blocked: isBlocked(user),
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
      .returning({ id: usersTable.id });
    if (!updated) return res.status(404).json({ error: "Mijoz topilmadi" });
    const [customer] = await adminCustomers(id);
    return res.json(customer);
  } catch (error) {
    return next(error);
  }
});

export default router;
