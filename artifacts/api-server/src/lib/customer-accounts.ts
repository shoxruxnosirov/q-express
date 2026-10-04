import type { Request, Response } from "express";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  chatMessagesTable,
  chatThreadsTable,
  customerAddressesTable,
  customerSessionsTable,
  ordersTable,
  usersTable,
} from "@workspace/db/schema";
import {
  clearCustomerCookie,
  createCustomerToken,
  hashCustomerToken,
  readCustomerToken,
  setCustomerCookie,
} from "./customer-session";
import { createRateLimiter } from "./rate-window";
import { parseOrderAddress, type AddressParts } from "./order-rules";

export type { AddressParts };

// A customer is a "users" row. A device is tied to one through a session
// whose secret lives in the httpOnly qorasuv_customer cookie; only its hash is
// stored. The shop lives in Telegram: inside the Mini App the Telegram account
// is the customer's identity (Telegram signs the launch data, so nobody types
// a code), and the customer fills in their own name, phone and addresses. A
// browser outside Telegram orders as a guest account of its own.

export type CustomerRow = typeof usersTable.$inferSelect;
export type SessionRow = typeof customerSessionsTable.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const MAX_SAVED_ADDRESSES = 5;
const LAST_SEEN_RESOLUTION_MS = 60 * 60 * 1000;
const USER_AGENT_MAX = 300;


export function isVerified(user: CustomerRow) {
  return user.phoneVerifiedAt !== null;
}

// ---------------------------------------------------------------------------
// Blocks
//
// A block holds a Telegram account, never a number or an address: those are
// only what somebody typed, and a prankster may type a stranger's. Orders are
// taken only in the Mini App, so every buyer is a Telegram account.
//
// A block is set on the account (or on one of its devices) and enforced
// against its Telegram account: a blocked customer who opens the shop on
// another device is still the same Telegram user.
// ---------------------------------------------------------------------------

export const BLOCKED_MESSAGE = "Hisobingiz do‘kon tomonidan bloklangan. Buyurtma berish va yozish imkoni yo‘q.";

export function isBlocked(user: CustomerRow) {
  return user.blockedAt !== null;
}

// A Telegram account is refused when its customer is blocked, and also when
// an admin blocked one of the Mini App sessions it opened: otherwise the next
// launch would simply sign it in on a fresh session.
export async function telegramIsBlocked(telegramUserId: string) {
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.telegramId, telegramUserId), isNotNull(usersTable.blockedAt)))
    .limit(1);
  if (user) return true;
  const [session] = await db
    .select({ id: customerSessionsTable.id })
    .from(customerSessionsTable)
    .where(and(eq(customerSessionsTable.telegramId, telegramUserId), isNotNull(customerSessionsTable.blockedAt)))
    .limit(1);
  return Boolean(session);
}

// The customer behind a request is blocked, or the device it came from is.
export function customerIsBlocked(customer: SignedInCustomer | undefined) {
  return Boolean(customer && (isBlocked(customer.user) || customer.session.blockedAt !== null || customer.telegramBlocked));
}

// ---------------------------------------------------------------------------
// Chat
//
// The chat is one conversation in two places, the Mini App and the bot, so it
// is open to every customer who belongs to a Telegram account, ordered or not.
// A guest in a browser has no Telegram to answer to and is sent there instead.
// An admin deletes a conversation from the dashboard when it is done with.
// ---------------------------------------------------------------------------

export function chatIsOpen(user: CustomerRow) {
  return user.telegramId !== null;
}

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

// Takes the signed-in customer, so a blocked device reads as blocked, or a
// bare account row where the device does not matter.
export async function customerProfileDto(customer: SignedInCustomer | CustomerRow | undefined) {
  if (!customer) {
    return { authenticated: false, name: "", phone: "", phone_verified: false, telegram_linked: false, addresses: [], blocked: false, chat_open: false };
  }
  const user = "user" in customer ? customer.user : customer;
  const blocked = "user" in customer ? customerIsBlocked(customer) : isBlocked(user);
  return {
    authenticated: true,
    blocked,
    chat_open: !blocked && chatIsOpen(user),
    name: user.name,
    phone: user.phone ?? "",
    phone_verified: isVerified(user),
    telegram_linked: user.telegramId !== null,
    addresses: await loadAddresses(user.id),
  };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

// telegramBlocked: an admin blocked one of the devices this Telegram account
// signed in on, which blocks the account on all of them, this one included.
export type SignedInCustomer = { user: CustomerRow; token: string; session: SessionRow; telegramBlocked?: boolean };

type SessionOrigin = { source: "telegram" | "browser"; telegramId?: string | null };

function userAgentOf(req: Request) {
  const agent = req.get("user-agent");
  return agent ? agent.slice(0, USER_AGENT_MAX) : null;
}

// Starts a new session for this device and hands it the cookie.
async function openSession(
  executor: Tx | typeof db,
  req: Request,
  res: Response,
  userId: number,
  origin: SessionOrigin = { source: "browser" },
) {
  const token = createCustomerToken();
  const [session] = await executor
    .insert(customerSessionsTable)
    .values({
      userId,
      tokenHash: hashCustomerToken(token),
      source: origin.source,
      telegramId: origin.telegramId ?? null,
      userAgent: userAgentOf(req),
    })
    .returning();
  setCustomerCookie(res, token);
  return { token, session };
}

// The customer this request's cookie belongs to, if any. Refreshes the rolling
// cookie. A session an admin revoked, or the customer ended, no longer
// signs anyone in; a blocked one still resolves, so every route can refuse
// it as blocked. A cookie from before accounts existed only tagged its
// orders; such a browser gets an account on first sight, built from its
// latest order, so it keeps its history without doing anything.
export async function resolveCustomer(req: Request, res: Response): Promise<SignedInCustomer | undefined> {
  const token = readCustomerToken(req);
  if (!token) return undefined;
  const tokenHash = hashCustomerToken(token);

  const [row] = await db
    .select({
      user: usersTable,
      session: customerSessionsTable,
      // A device block holds the Telegram account on every device it uses,
      // not only the one an admin picked.
      telegramBlocked: sql<boolean>`exists (select 1 from customer_sessions b
        where b.telegram_id = ${usersTable.telegramId} and b.blocked_at is not null)`,
    })
    .from(customerSessionsTable)
    .innerJoin(usersTable, eq(customerSessionsTable.userId, usersTable.id))
    .where(eq(customerSessionsTable.tokenHash, tokenHash))
    .limit(1);
  if (row) {
    if (row.session.revokedAt) {
      clearCustomerCookie(res);
      return undefined;
    }
    // The order page and the chat widget poll every few seconds; recording
    // "last seen" at most hourly keeps that from writing to the free database
    // on every poll.
    const now = new Date();
    if (now.getTime() - row.session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
      await db.update(customerSessionsTable).set({ lastSeenAt: now }).where(eq(customerSessionsTable.id, row.session.id));
      await db.update(usersTable).set({ lastSeenAt: now }).where(eq(usersTable.id, row.user.id));
    }
    setCustomerCookie(res, token);
    return { user: row.user, token, session: row.session, telegramBlocked: Boolean(row.telegramBlocked) };
  }

  const adopted = await adoptLegacyBrowser(req, tokenHash);
  if (!adopted) return undefined;
  setCustomerCookie(res, token);
  return { ...adopted, token };
}

async function adoptLegacyBrowser(req: Request, tokenHash: string) {
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
      .select({ user: usersTable, session: customerSessionsTable })
      .from(customerSessionsTable)
      .innerJoin(usersTable, eq(customerSessionsTable.userId, usersTable.id))
      .where(eq(customerSessionsTable.tokenHash, tokenHash))
      .limit(1);
    if (adopted) return adopted;

    const [user] = await tx
      .insert(usersTable)
      .values({ name: latest.customerName, phone: latest.phone, lastSeenAt: new Date() })
      .returning();
    const [session] = await tx
      .insert(customerSessionsTable)
      .values({ userId: user.id, tokenHash, source: "browser", userAgent: userAgentOf(req) })
      .returning();
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
    return { user, session };
  });
}

// Saving a profile needs no order, so without a limit a script could fill the
// free database with empty accounts. A household needs one; ten an hour per
// address is plenty for a shared Wi-Fi. Orders are not charged here: an order
// is its own proof of intent. Mini App accounts are not charged either: each
// is a real Telegram account.
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
): Promise<SignedInCustomer> {
  const signedIn = await resolveCustomer(req, res);
  if (signedIn) return signedIn;
  if (!accountCreation.allow(clientKey(req))) throw new AccountLimitError();
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(usersTable)
      .values({ name: details.name ?? "", phone: details.phone ?? null, lastSeenAt: new Date() })
      .returning();
    const { token, session } = await openSession(tx, req, res, user.id);
    return { user, token, session };
  });
}

// Signing out keeps the row, marked revoked by nobody, so the dashboard's
// list of a customer's devices still shows it.
export async function endCustomerSession(req: Request) {
  const token = readCustomerToken(req);
  if (!token) return;
  await db
    .update(customerSessionsTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(customerSessionsTable.tokenHash, hashCustomerToken(token)), isNull(customerSessionsTable.revokedAt)));
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
// Telegram identity
//
// Inside the Mini App, Telegram signs the launch data with the bot token, so
// the Telegram account it names is proven. That account is the customer: the
// first launch (or the first message to the bot) creates it, later launches
// sign the webview in again. What the customer types (a name, any phone, an
// address) is saved on that account; it never joins two accounts, because
// anybody can type somebody else's number.
// ---------------------------------------------------------------------------

export type TelegramSignIn = SignedInCustomer;

// Who Telegram says the customer is, kept on the account for the admins.
export type TelegramIdentity = { name: string; username: string | null };

function identityValues(identity: TelegramIdentity) {
  return { telegramName: identity.name || null, telegramUsername: identity.username };
}

function identityChanged(user: CustomerRow, identity: TelegramIdentity) {
  return user.telegramName !== (identity.name || null) || user.telegramUsername !== identity.username;
}

// Signs this webview in as the customer of a Telegram account, creating the
// account on first sight. The webview's own unverified account, the one it
// got by ordering before this existed, is claimed or folded in, so nothing it
// ordered is lost. A session of a different Telegram account (two accounts on
// one phone share the webview's cookies) is left alone and a new one started.
export async function signInByTelegram(
  req: Request,
  res: Response,
  telegramUserId: string,
  identity: TelegramIdentity,
): Promise<TelegramSignIn> {
  const displayName = identity.name;
  const current = await resolveCustomer(req, res);
  if (current && current.user.telegramId === telegramUserId && current.session.telegramId === telegramUserId) {
    if (!identityChanged(current.user, identity)) return current;
    const [user] = await db.update(usersTable).set(identityValues(identity)).where(eq(usersTable.id, current.user.id)).returning();
    return { ...current, user };
  }
  // Only the webview's own guest account (tied to no Telegram account, and
  // verified by no code of an earlier build) may be folded in.
  const foldable = current && current.user.telegramId === null && !isVerified(current.user) && !customerIsBlocked(current)
    ? current
    : undefined;

  const result = await db.transaction(async (tx) => {
    // Telegram opens the Mini App and the page signs in more than once at a
    // time on a slow network; the lock makes the first create the account and
    // the rest find it.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`telegram:${telegramUserId}`}))`);
    const [existing] = await tx.select().from(usersTable).where(eq(usersTable.telegramId, telegramUserId)).limit(1).for("update");

    let target: CustomerRow;
    let keepSession = false;
    if (existing) {
      target = existing;
      if (current?.user.id === existing.id) keepSession = true;
      else if (foldable) {
        await mergeCustomer(tx, foldable.user.id, existing.id);
        keepSession = true;
      }
    } else if (foldable) {
      // The webview's own account becomes this Telegram account's.
      [target] = await tx
        .update(usersTable)
        .set({ telegramId: telegramUserId, name: foldable.user.name || displayName, ...identityValues(identity) })
        .where(eq(usersTable.id, foldable.user.id))
        .returning();
      keepSession = true;
    } else {
      [target] = await tx
        .insert(usersTable)
        .values({ name: displayName, telegramId: telegramUserId, lastSeenAt: new Date(), ...identityValues(identity) })
        .returning();
    }
    if ((!target.name && displayName) || identityChanged(target, identity)) {
      [target] = await tx
        .update(usersTable)
        .set({ name: target.name || displayName, ...identityValues(identity) })
        .where(eq(usersTable.id, target.id))
        .returning();
    }

    if (keepSession && current) {
      const [session] = await tx
        .update(customerSessionsTable)
        .set({ userId: target.id, source: "telegram", telegramId: telegramUserId })
        .where(eq(customerSessionsTable.id, current.session.id))
        .returning();
      return { user: target, token: current.token, session };
    }
    const { token, session } = await openSession(tx, req, res, target.id, { source: "telegram", telegramId: telegramUserId });
    return { user: target, token, session };
  });
  return result;
}

// The customer of a Telegram account that wrote to the bot, created on the
// first message: writing to the bot is as good a way in as opening the shop.
export async function telegramCustomer(telegramUserId: string, identity: TelegramIdentity): Promise<CustomerRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`telegram:${telegramUserId}`}))`);
    const [existing] = await tx.select().from(usersTable).where(eq(usersTable.telegramId, telegramUserId)).limit(1);
    if (existing) {
      if (!identityChanged(existing, identity)) return existing;
      const [updated] = await tx.update(usersTable).set(identityValues(identity)).where(eq(usersTable.id, existing.id)).returning();
      return updated;
    }
    const [created] = await tx
      .insert(usersTable)
      .values({ name: identity.name, telegramId: telegramUserId, lastSeenAt: new Date(), ...identityValues(identity) })
      .returning();
    return created;
  });
}

// ---------------------------------------------------------------------------
// Devices, for the dashboard
// ---------------------------------------------------------------------------

export async function customerSessions(userId: number) {
  return db
    .select()
    .from(customerSessionsTable)
    .where(eq(customerSessionsTable.userId, userId))
    .orderBy(desc(customerSessionsTable.lastSeenAt), desc(customerSessionsTable.id));
}

export function isSessionActive(session: SessionRow) {
  return session.revokedAt === null && session.blockedAt === null;
}


// Moves everything of a guest account into the customer Telegram vouched for,
// then drops the empty account.
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
