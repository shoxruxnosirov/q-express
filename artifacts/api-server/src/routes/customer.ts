import { Router, type IRouter, type Request } from "express";
import { desc, eq, sql } from "drizzle-orm";
import {
  ReplaceCustomerAddressesBody,
  UpdateCustomerProfileBody,
  VerifyCustomerLoginBody,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { customerAddressesTable, ordersTable, usersTable } from "@workspace/db/schema";
import {
  consumeLoginCode,
  customerProfileDto,
  endCustomerSession,
  ensureCustomer,
  isVerified,
  replaceAddresses,
  resolveCustomer,
  signInVerified,
} from "../lib/customer-accounts";
import { CHAT_SESSION_COOKIE } from "../lib/chat-session";
import { CUSTOMER_SESSION_COOKIE } from "../lib/customer-session";
import { normalizeUzPhone } from "../lib/phone";
import { createRateLimiter } from "../lib/rate-window";
import { getBotUsername } from "../lib/telegram";

const router: IRouter = Router();

function clientKey(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

// Wrong codes are charged per address, on top of the five guesses each code
// allows, so rotating phone numbers does not buy unlimited guessing.
const codeFailures = createRateLimiter<string>({ windowMs: 15 * 60 * 1000, max: 10 });

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
    await replaceAddresses(user.id, cleaned);
    return res.json(await customerProfileDto(user));
  } catch (error) {
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
    const check = phone ? await consumeLoginCode(phone, input.code) : ({ ok: false } as const);
    if (!phone || !check.ok) {
      codeFailures.allow(key);
      return res.status(401).json({ error: "Kod noto‘g‘ri yoki eskirgan. Botdan yangi kod oling." });
    }
    const user = await signInVerified(req, res, phone, check.telegramUserId);
    return res.json(await customerProfileDto(user));
  } catch (error) {
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

// Behind the /admin guard registered in routes/admins.ts, which runs first.
router.get("/admin/customers", async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        user: usersTable,
        orderCount: sql<number>`count(${ordersTable.id}) filter (where ${ordersTable.status} <> 'cancelled')`,
        totalSpent: sql<string>`coalesce(sum(${ordersTable.total}) filter (where ${ordersTable.status} <> 'cancelled'), 0)`,
        lastOrderAt: sql<Date | null>`max(${ordersTable.createdAt})`,
      })
      .from(usersTable)
      .leftJoin(ordersTable, eq(ordersTable.userId, usersTable.id))
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
    res.json(
      rows.map(({ user, orderCount, totalSpent, lastOrderAt }) => ({
        id: user.id,
        name: user.name,
        phone: user.phone ?? "",
        phone_verified: isVerified(user),
        order_count: Number(orderCount),
        total_spent: Number(totalSpent),
        last_order_at: lastOrderAt ? new Date(lastOrderAt).toISOString() : null,
        created_at: user.createdAt.toISOString(),
        addresses: byUser.get(user.id) ?? [],
      })),
    );
  } catch (error) {
    return next(error);
  }
});

export default router;
