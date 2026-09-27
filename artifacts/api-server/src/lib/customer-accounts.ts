import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  chatMessagesTable,
  chatThreadsTable,
  customerAddressesTable,
  customerSessionsTable,
  ordersTable,
  phoneLoginCodesTable,
  usersTable,
} from "@workspace/db/schema";
import {
  createCustomerToken,
  hashCustomerToken,
  readCustomerToken,
  setCustomerCookie,
} from "./customer-session";
import { createRateLimiter } from "./rate-window";
import { parseOrderAddress, type AddressParts } from "./order-rules";

export type { AddressParts };

// A customer is a "users" row. A browser is tied to one through a session
// whose secret lives in the httpOnly qorasuv_customer cookie; only its hash is
// stored. Verifying the phone through the Telegram bot is what lets the same
// customer be recognised on another device.

export type CustomerRow = typeof usersTable.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const MAX_SAVED_ADDRESSES = 5;
const LOGIN_CODE_TTL_MS = 5 * 60 * 1000;
export const LOGIN_CODE_MAX_ATTEMPTS = 5;
const LAST_SEEN_RESOLUTION_MS = 60 * 60 * 1000;


export function isVerified(user: CustomerRow) {
  return user.phoneVerifiedAt !== null;
}

// ---------------------------------------------------------------------------
// Blocks
//
// A block is set on the account, but enforced against its phone number and
// Telegram account as well: a blocked customer who clears their cookies, or
// opens the shop on another device, is still the same number and the same
// Telegram user.
// ---------------------------------------------------------------------------

export const BLOCKED_MESSAGE = "Hisobingiz do‘kon tomonidan bloklangan. Buyurtma berish va yozish imkoni yo‘q.";

export function isBlocked(user: CustomerRow) {
  return user.blockedAt !== null;
}

// Every number a blocked customer is known by: the one on the account, and
// every one they put on an order. The account only keeps the latest number,
// so checking it alone let a customer who had ordered under several numbers
// come back on a fresh browser with an earlier one.
//
// Those numbers are only what somebody typed, though, and a prankster may
// type a stranger's. A number therefore stops counting against anyone once a
// verified, unblocked customer owns it: they proved through Telegram that it
// is theirs, and must not be locked out by what someone else typed.
export async function phoneIsBlocked(phone: string) {
  const { rows } = await db.execute(sql`
    select 1 from users u
    where u.blocked_at is not null
      and (u.phone = ${phone}
           or exists (select 1 from orders o where o.user_id = u.id and o.phone = ${phone}))
      and not exists (
        select 1 from users v
        where v.phone = ${phone} and v.phone_verified_at is not null and v.blocked_at is null)
    limit 1`);
  return rows.length > 0;
}

// Proving a number through the bot (Telegram's contact button, then the code)
// is refused only when that number belongs to a blocked verified customer. A
// number that a blocked unverified account merely typed does not stop its
// real owner from proving it is theirs.
export async function verifiedPhoneIsBlocked(phone: string) {
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.phone, phone), isNotNull(usersTable.phoneVerifiedAt), isNotNull(usersTable.blockedAt)))
    .limit(1);
  return Boolean(row);
}

export async function telegramIsBlocked(telegramUserId: string) {
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.telegramId, telegramUserId), isNotNull(usersTable.blockedAt)))
    .limit(1);
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// Chat
//
// The chat opens with the customer's first order, so nobody who has never
// ordered can fill the database with messages. It then stays open, also after
// delivery, for questions and complaints; an admin deletes a conversation from
// the dashboard when it is done with.
// ---------------------------------------------------------------------------

export async function hasOrdered(userId: number) {
  const [row] = await db.select({ id: ordersTable.id }).from(ordersTable).where(eq(ordersTable.userId, userId)).limit(1);
  return Boolean(row);
}

async function loadAddresses(userId: number): Promise<AddressParts[]> {
  const rows = await db
    .select({ dom: customerAddressesTable.dom, xonadon: customerAddressesTable.xonadon })
    .from(customerAddressesTable)
    .where(eq(customerAddressesTable.userId, userId))
    .orderBy(desc(customerAddressesTable.lastUsedAt), desc(customerAddressesTable.id))
    .limit(MAX_SAVED_ADDRESSES);
  return rows;
}

export async function customerProfileDto(user: CustomerRow | undefined) {
  if (!user) return { authenticated: false, name: "", phone: "", phone_verified: false, addresses: [], blocked: false, chat_open: false };
  return {
    authenticated: true,
    blocked: isBlocked(user),
    chat_open: !isBlocked(user) && (await hasOrdered(user.id)),
    name: user.name,
    phone: user.phone ?? "",
    phone_verified: isVerified(user),
    addresses: await loadAddresses(user.id),
  };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type SignedInCustomer = { user: CustomerRow; token: string };

// The customer this request's cookie belongs to, if any. Refreshes the rolling
// cookie. A cookie from before accounts existed only tagged its orders; such a
// browser gets an account on first sight, built from its latest order, so it
// keeps its history without doing anything.
export async function resolveCustomer(req: Request, res: Response): Promise<SignedInCustomer | undefined> {
  const token = readCustomerToken(req);
  if (!token) return undefined;
  const tokenHash = hashCustomerToken(token);

  const [row] = await db
    .select({ user: usersTable, sessionId: customerSessionsTable.id, sessionSeenAt: customerSessionsTable.lastSeenAt })
    .from(customerSessionsTable)
    .innerJoin(usersTable, eq(customerSessionsTable.userId, usersTable.id))
    .where(eq(customerSessionsTable.tokenHash, tokenHash))
    .limit(1);
  if (row) {
    // The order page and the chat widget poll every few seconds; recording
    // "last seen" at most hourly keeps that from writing to the free database
    // on every poll.
    const now = new Date();
    if (now.getTime() - row.sessionSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
      await db.update(customerSessionsTable).set({ lastSeenAt: now }).where(eq(customerSessionsTable.id, row.sessionId));
      await db.update(usersTable).set({ lastSeenAt: now }).where(eq(usersTable.id, row.user.id));
    }
    setCustomerCookie(res, token);
    return { user: row.user, token };
  }

  const user = await adoptLegacyBrowser(tokenHash);
  if (!user) return undefined;
  setCustomerCookie(res, token);
  return { user, token };
}

async function adoptLegacyBrowser(tokenHash: string) {
  const [latest] = await db
    .select()
    .from(ordersTable)
    .where(and(eq(ordersTable.customerTokenHash, tokenHash), sql`${ordersTable.userId} is null`))
    .orderBy(desc(ordersTable.createdAt))
    .limit(1);
  if (!latest) return undefined;
  return db.transaction(async (tx) => {
    // Checkout fires several requests at once, and each would adopt the same
    // browser. The lock queues them; the first creates the account and the
    // rest find it, instead of failing on the unique session hash.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`adopt:${tokenHash}`}))`);
    const [adopted] = await tx
      .select({ user: usersTable })
      .from(customerSessionsTable)
      .innerJoin(usersTable, eq(customerSessionsTable.userId, usersTable.id))
      .where(eq(customerSessionsTable.tokenHash, tokenHash))
      .limit(1);
    if (adopted) return adopted.user;

    const [user] = await tx
      .insert(usersTable)
      .values({ name: latest.customerName, phone: latest.phone, lastSeenAt: new Date() })
      .returning();
    await tx.insert(customerSessionsTable).values({ userId: user.id, tokenHash });
    await tx
      .update(ordersTable)
      .set({ userId: user.id })
      .where(and(eq(ordersTable.customerTokenHash, tokenHash), sql`${ordersTable.userId} is null`));
    const legacyOrders = await tx
      .select({ address: ordersTable.address, createdAt: ordersTable.createdAt })
      .from(ordersTable)
      .where(eq(ordersTable.userId, user.id));
    for (const order of legacyOrders) {
      const parts = parseOrderAddress(order.address);
      if (parts) await upsertAddress(tx, user.id, parts, order.createdAt);
    }
    return user;
  });
}

// Saving a profile needs no order, so without a limit a script could fill the
// free database with empty accounts. A household needs one; ten an hour per
// address is plenty for a shared Wi-Fi. Orders are not charged here: an order
// is its own proof of intent.
const accountCreation = createRateLimiter<string>({ windowMs: 60 * 60 * 1000, max: 10 });

export class AccountLimitError extends Error {
  constructor() {
    super("Too many new customer accounts from this address");
    this.name = "AccountLimitError";
  }
}

function clientKey(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

// The signed-in customer, creating an unverified one with a fresh session when
// this browser has none yet.
export async function ensureCustomer(
  req: Request,
  res: Response,
  details: { name?: string; phone?: string } = {},
): Promise<CustomerRow> {
  const signedIn = await resolveCustomer(req, res);
  if (signedIn) return signedIn.user;
  if (!accountCreation.allow(clientKey(req))) throw new AccountLimitError();
  const token = createCustomerToken();
  const user = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(usersTable)
      .values({ name: details.name ?? "", phone: details.phone ?? null, lastSeenAt: new Date() })
      .returning();
    await tx.insert(customerSessionsTable).values({ userId: created.id, tokenHash: hashCustomerToken(token) });
    return created;
  });
  setCustomerCookie(res, token);
  return user;
}

export async function endCustomerSession(req: Request) {
  const token = readCustomerToken(req);
  if (token) await db.delete(customerSessionsTable).where(eq(customerSessionsTable.tokenHash, hashCustomerToken(token)));
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

async function upsertAddress(tx: Tx | typeof db, userId: number, parts: AddressParts, usedAt = new Date()) {
  await tx
    .insert(customerAddressesTable)
    .values({ userId, dom: parts.dom, xonadon: parts.xonadon, lastUsedAt: usedAt })
    .onConflictDoUpdate({
      target: [customerAddressesTable.userId, customerAddressesTable.dom, customerAddressesTable.xonadon],
      set: { lastUsedAt: sql`greatest(${customerAddressesTable.lastUsedAt}, excluded.last_used_at)` },
    });
  await pruneAddresses(tx, userId);
}

// Keeps the newest few; a household never needs more.
async function pruneAddresses(tx: Tx | typeof db, userId: number) {
  await tx.execute(sql`
    delete from customer_addresses where user_id = ${userId} and id not in (
      select id from customer_addresses where user_id = ${userId}
      order by last_used_at desc, id desc limit ${MAX_SAVED_ADDRESSES}
    )`);
}

export async function rememberOrderAddress(userId: number, address: string) {
  const parts = parseOrderAddress(address);
  if (parts) await upsertAddress(db, userId, parts);
}

// Replaces the list exactly, first entry most recent.
export async function replaceAddresses(userId: number, addresses: readonly AddressParts[]) {
  const now = Date.now();
  const unique: AddressParts[] = [];
  for (const address of addresses) {
    if (!unique.some((kept) => kept.dom === address.dom && kept.xonadon === address.xonadon)) unique.push(address);
  }
  await db.transaction(async (tx) => {
    await tx.delete(customerAddressesTable).where(eq(customerAddressesTable.userId, userId));
    if (unique.length > 0) {
      await tx.insert(customerAddressesTable).values(
        unique.slice(0, MAX_SAVED_ADDRESSES).map((address, index) => ({
          userId,
          dom: address.dom,
          xonadon: address.xonadon,
          // Older entries a second apart keep the order the customer chose.
          lastUsedAt: new Date(now - index * 1000),
        })),
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Phone verification through the bot
// ---------------------------------------------------------------------------

function codeHash(phone: string, code: string) {
  return createHash("sha256").update(`${phone}:${code}`).digest("hex");
}

// Issued when a customer shares their own contact with the bot. A new request
// replaces the previous code for that phone.
export async function issueLoginCode(phone: string, telegramUserId: string) {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const values = {
    phone,
    codeHash: codeHash(phone, code),
    telegramUserId,
    expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MS),
    attempts: 0,
    createdAt: new Date(),
  };
  await db
    .insert(phoneLoginCodesTable)
    .values(values)
    .onConflictDoUpdate({ target: phoneLoginCodesTable.phone, set: values });
  return code;
}

export type CodeCheck = { ok: true; telegramUserId: string } | { ok: false };

// One use. Wrong guesses are counted, and the code is gone after five of them
// or five minutes, so a six-digit code cannot be brute-forced.
export async function consumeLoginCode(phone: string, code: string): Promise<CodeCheck> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(phoneLoginCodesTable)
      .where(eq(phoneLoginCodesTable.phone, phone))
      .limit(1)
      .for("update");
    if (!row) return { ok: false };
    if (row.expiresAt < new Date() || row.attempts >= LOGIN_CODE_MAX_ATTEMPTS) {
      await tx.delete(phoneLoginCodesTable).where(eq(phoneLoginCodesTable.phone, phone));
      return { ok: false };
    }
    const expected = Buffer.from(row.codeHash, "hex");
    const provided = Buffer.from(codeHash(phone, code), "hex");
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      await tx
        .update(phoneLoginCodesTable)
        .set({ attempts: row.attempts + 1 })
        .where(eq(phoneLoginCodesTable.phone, phone));
      return { ok: false };
    }
    await tx.delete(phoneLoginCodesTable).where(eq(phoneLoginCodesTable.phone, phone));
    return { ok: true, telegramUserId: row.telegramUserId };
  });
}

// After a correct code: this browser becomes the verified customer for the
// phone. If that customer already exists (another device), this browser's
// unverified account is folded into it, orders, addresses and chat included.
// A browser signed in as a different verified customer simply switches; two
// verified accounts are never merged.
export async function signInVerified(
  req: Request,
  res: Response,
  phone: string,
  telegramUserId: string,
): Promise<CustomerRow> {
  const signedIn = await resolveCustomer(req, res);
  const current = signedIn?.user;

  const final = await db.transaction(async (tx) => {
    const [verified] = await tx
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.phone, phone), isNotNull(usersTable.phoneVerifiedAt)))
      .limit(1)
      .for("update");

    let target: CustomerRow;
    if (verified) {
      target = verified;
      if (current && current.id !== verified.id && !isVerified(current)) {
        await mergeCustomer(tx, current.id, verified.id);
      }
    } else if (current && !isVerified(current)) {
      target = current;
    } else {
      [target] = await tx.insert(usersTable).values({ name: current?.name ?? "", lastSeenAt: new Date() }).returning();
    }

    // A Telegram account and a phone each identify one customer.
    await tx
      .update(usersTable)
      .set({ telegramId: null })
      .where(and(eq(usersTable.telegramId, telegramUserId), ne(usersTable.id, target.id)));
    const [updated] = await tx
      .update(usersTable)
      .set({
        phone,
        phoneVerifiedAt: target.phoneVerifiedAt ?? new Date(),
        telegramId: telegramUserId,
        lastSeenAt: new Date(),
      })
      .where(eq(usersTable.id, target.id))
      .returning();

    if (signedIn) {
      // The browser keeps its cookie; its session now points at the verified
      // customer.
      await tx
        .update(customerSessionsTable)
        .set({ userId: updated.id })
        .where(eq(customerSessionsTable.tokenHash, hashCustomerToken(signedIn.token)));
    }
    return updated;
  });

  if (!signedIn) {
    const token = createCustomerToken();
    await db.insert(customerSessionsTable).values({ userId: final.id, tokenHash: hashCustomerToken(token) });
    setCustomerCookie(res, token);
  }
  return final;
}

// Moves everything of an unverified customer into a verified one, then drops
// the empty account.
// A block must never be merged away: folding a blocked account into another
// would delete the row that carries the block, and with it every number it
// guarded. Callers refuse earlier; this is the last line.
export class BlockedMergeError extends Error {
  constructor() {
    super("A blocked customer cannot be merged into another account");
    this.name = "BlockedMergeError";
  }
}

async function mergeCustomer(tx: Tx, fromId: number, intoId: number) {
  const [from] = await tx.select({ blockedAt: usersTable.blockedAt }).from(usersTable).where(eq(usersTable.id, fromId)).limit(1);
  if (from?.blockedAt) throw new BlockedMergeError();
  await tx.update(ordersTable).set({ userId: intoId }).where(eq(ordersTable.userId, fromId));

  const addresses = await tx.select().from(customerAddressesTable).where(eq(customerAddressesTable.userId, fromId));
  for (const address of addresses) {
    await upsertAddress(tx, intoId, { dom: address.dom, xonadon: address.xonadon }, address.lastUsedAt);
  }

  // One conversation per customer: the verified one keeps its thread and
  // takes the other's messages; if it had none, it adopts the other thread.
  const [intoThread] = await tx
    .select({ id: chatThreadsTable.id })
    .from(chatThreadsTable)
    .where(eq(chatThreadsTable.userId, intoId))
    .orderBy(desc(chatThreadsTable.lastMessageAt))
    .limit(1);
  const fromThreads = await tx
    .select({ id: chatThreadsTable.id })
    .from(chatThreadsTable)
    .where(eq(chatThreadsTable.userId, fromId));
  if (fromThreads.length > 0) {
    if (!intoThread) {
      await tx.update(chatThreadsTable).set({ userId: intoId }).where(eq(chatThreadsTable.userId, fromId));
    } else {
      const ids = fromThreads.map((thread) => thread.id);
      await tx.update(chatMessagesTable).set({ threadId: intoThread.id }).where(inArray(chatMessagesTable.threadId, ids));
      await tx.execute(sql`
        update chat_threads set last_message_at = coalesce(
          (select max(created_at) from chat_messages where thread_id = ${intoThread.id}), last_message_at)
        where id = ${intoThread.id}`);
      await tx.delete(chatThreadsTable).where(inArray(chatThreadsTable.id, ids));
    }
  }

  await tx.update(customerSessionsTable).set({ userId: intoId }).where(eq(customerSessionsTable.userId, fromId));
  await tx.delete(usersTable).where(eq(usersTable.id, fromId));
}

// Inside Telegram the shop runs in the app's own webview, which does not share
// cookies with the phone's browser. A customer who verified their phone is
// recognised there by the Telegram account the Mini App vouches for, and this
// webview is signed in as them. Its own unverified account, if it made one,
// is folded in, exactly as when verifying on a second device.
export async function signInByTelegram(req: Request, res: Response, telegramUserId: string) {
  const [target] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.telegramId, telegramUserId), isNotNull(usersTable.phoneVerifiedAt)))
    .limit(1);
  if (!target || isBlocked(target)) return undefined;

  const signedIn = await resolveCustomer(req, res);
  if (signedIn?.user.id === target.id) return target;
  if (signedIn && isBlocked(signedIn.user)) throw new BlockedMergeError();
  if (signedIn) {
    await db.transaction(async (tx) => {
      if (!isVerified(signedIn.user)) await mergeCustomer(tx, signedIn.user.id, target.id);
      await tx
        .update(customerSessionsTable)
        .set({ userId: target.id })
        .where(eq(customerSessionsTable.tokenHash, hashCustomerToken(signedIn.token)));
    });
  } else {
    const token = createCustomerToken();
    await db.insert(customerSessionsTable).values({ userId: target.id, tokenHash: hashCustomerToken(token) });
    setCustomerCookie(res, token);
  }
  const [fresh] = await db.select().from(usersTable).where(eq(usersTable.id, target.id)).limit(1);
  return fresh;
}
