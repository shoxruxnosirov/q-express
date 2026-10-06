import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import {
  AdminLoginBody,
  AdminSetupBody,
  ChangeOwnAdminPasswordBody,
  CreateAdminBody,
  DeleteAdminParams,
  ResetAdminPasswordBody,
  ResetAdminPasswordParams,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { adminsTable } from "@workspace/db/schema";
import {
  adminCodesMatch,
  burnPasswordCheck,
  clearAdminSessionCookie,
  hashPassword,
  newPasswordProblem,
  normalizeUsername,
  readAdminSession,
  setAdminSessionCookie,
  verifyPassword,
} from "../lib/admin-auth";
import { adminAccountDto, signedInAdmin, type AdminRow } from "../lib/admin-directory";
import { isUniqueViolation } from "../lib/pg-error";
import { createRateLimiter } from "../lib/rate-window";
import { getBotUsername } from "../lib/telegram";

const router: IRouter = Router();

// Behind Render the socket address is always their proxy, so app.ts trusts
// exactly one hop and req.ip becomes the address Render reports for the client.
function clientKey(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

// Only FAILED sign-in or first-password attempts are charged. The dashboard
// asks for the password on every visit and several admins may share the
// shop's one Wi-Fi address, so charging successes would lock out honest staff
// while a guessing script is slowed just the same. Per address, so one caller
// cannot lock out the shop, plus a looser per-username ceiling so rotating
// addresses does not buy unlimited guesses at one account.
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const failuresByAddress = createRateLimiter<string>({ windowMs: ATTEMPT_WINDOW_MS, max: 10 });
const failuresByUsername = createRateLimiter<string>({ windowMs: ATTEMPT_WINDOW_MS, max: 30 });

function tooManyFailures(req: Request, username: string) {
  return failuresByAddress.isExhausted(clientKey(req)) || failuresByUsername.isExhausted(username);
}

function chargeFailure(req: Request, username: string) {
  failuresByAddress.allow(clientKey(req));
  failuresByUsername.allow(username);
}

const TOO_MANY = "Juda ko‘p urinish. 15 daqiqadan keyin qayta urinib ko‘ring.";
const WRONG_LOGIN = "Login yoki parol noto‘g‘ri";

function sessionBody(admin: AdminRow) {
  return { authenticated: true, admin: adminAccountDto(admin) };
}

async function findByUsername(username: string) {
  const [admin] = await db.select().from(adminsTable).where(eq(adminsTable.username, username)).limit(1);
  return admin;
}

// Loads the admin a request's cookie names, and only while the cookie's
// session version is still the current one.
async function loadSessionAdmin(req: Request) {
  const claim = readAdminSession(req);
  if (!claim) return undefined;
  const [admin] = await db.select().from(adminsTable).where(eq(adminsTable.id, claim.adminId)).limit(1);
  if (!admin || admin.sessionVersion !== claim.version || admin.passwordHash === null) return undefined;
  return admin;
}

router.post("/admin/auth", async (req, res, next) => {
  try {
    const input = AdminLoginBody.parse(req.body);
    const username = normalizeUsername(input.username);
    if (tooManyFailures(req, username)) return res.status(429).json({ error: TOO_MANY });

    const admin = await findByUsername(username);
    if (!admin) {
      await burnPasswordCheck(input.password);
      chargeFailure(req, username);
      return res.status(401).json({ error: WRONG_LOGIN });
    }
    // Seeded super admins are public in the repository anyway, so saying that
    // one still needs its first password reveals nothing new.
    if (admin.passwordHash === null) {
      return res.status(409).json({ error: "Bu hisobga hali parol o‘rnatilmagan", needs_setup: true });
    }
    if (!(await verifyPassword(input.password, admin.passwordHash))) {
      chargeFailure(req, username);
      return res.status(401).json({ error: WRONG_LOGIN });
    }

    setAdminSessionCookie(res, admin.id, admin.sessionVersion);
    return res.json(sessionBody(admin));
  } catch (error) {
    return next(error);
  }
});

// A super admin seeded by migration has no password, because the repository
// is public. Proving the deployment's ADMIN_ACCESS_CODE, which only lives in
// the Render dashboard, is what lets them choose one. It works once per
// account: afterwards the account has a password and this route refuses it.
router.post("/admin/setup", async (req, res, next) => {
  try {
    const input = AdminSetupBody.parse(req.body);
    const username = normalizeUsername(input.username);
    if (tooManyFailures(req, username)) return res.status(429).json({ error: TOO_MANY });

    const expectedCode = process.env.ADMIN_ACCESS_CODE;
    if (!expectedCode) throw new Error("ADMIN_ACCESS_CODE is not configured");

    const admin = await findByUsername(username);
    const codeMatches = adminCodesMatch(input.access_code, expectedCode);
    if (!admin || admin.role !== "super_admin" || admin.passwordHash !== null || !codeMatches) {
      chargeFailure(req, username);
      return res.status(401).json({ error: "Kirish kodi noto‘g‘ri yoki bu hisob sozlangan" });
    }
    const problem = newPasswordProblem(input.new_password, username);
    if (problem) return res.status(400).json({ error: problem });

    const [updated] = await db
      .update(adminsTable)
      .set({
        passwordHash: await hashPassword(input.new_password),
        mustChangePassword: false,
        sessionVersion: sql`${adminsTable.sessionVersion} + 1`,
      })
      // Guarded again here so two simultaneous setups cannot both win.
      .where(sql`${adminsTable.id} = ${admin.id} and ${adminsTable.passwordHash} is null`)
      .returning();
    if (!updated) return res.status(401).json({ error: "Bu hisob allaqachon sozlangan" });

    setAdminSessionCookie(res, updated.id, updated.sessionVersion);
    return res.json(sessionBody(updated));
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/session", async (req, res, next) => {
  try {
    const admin = await loadSessionAdmin(req);
    return res.json(admin ? sessionBody(admin) : { authenticated: false });
  } catch (error) {
    return next(error);
  }
});

router.post("/admin/logout", (_req, res) => {
  clearAdminSessionCookie(res);
  res.json({ authenticated: false });
});

// Every other /admin route needs a current session. An admin who still has a
// temporary password may do nothing but replace it.
router.use("/admin", async (req, res, next) => {
  try {
    const admin = await loadSessionAdmin(req);
    if (!admin) return res.status(401).json({ error: "Operator authentication required" });
    if (admin.mustChangePassword && req.path !== "/me/password") {
      return res.status(403).json({ error: "Avval parolingizni almashtiring", must_change_password: true });
    }
    res.locals.admin = admin;
    return next();
  } catch (error) {
    return next(error);
  }
});

router.post("/admin/me/password", async (req, res, next) => {
  try {
    const admin = signedInAdmin(res);
    const input = ChangeOwnAdminPasswordBody.parse(req.body);
    if (!(await verifyPassword(input.current_password, admin.passwordHash))) {
      return res.status(400).json({ error: "Joriy parol noto‘g‘ri" });
    }
    const problem = newPasswordProblem(input.new_password, admin.username);
    if (problem) return res.status(400).json({ error: problem });
    if (input.new_password === input.current_password) {
      return res.status(400).json({ error: "Yangi parol eskisidan farq qilsin" });
    }

    // Bumping the version signs every other device out; this one gets a fresh
    // cookie under the new version and stays in.
    const [updated] = await db
      .update(adminsTable)
      .set({
        passwordHash: await hashPassword(input.new_password),
        mustChangePassword: false,
        sessionVersion: sql`${adminsTable.sessionVersion} + 1`,
      })
      .where(eq(adminsTable.id, admin.id))
      .returning();
    setAdminSessionCookie(res, updated.id, updated.sessionVersion);
    return res.json(sessionBody(updated));
  } catch (error) {
    return next(error);
  }
});

// The link carries a one-time code; only its hash is stored, so a leaked
// database cannot be used to attach a stranger's Telegram to an admin.
const TELEGRAM_LINK_TTL_MS = 30 * 60 * 1000;

export function telegramLinkHash(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

router.post("/admin/me/telegram", async (_req, res, next) => {
  try {
    const admin = signedInAdmin(res);
    const username = await getBotUsername();
    if (!username) return res.status(503).json({ error: "Telegram bot sozlanmagan" });

    const code = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TTL_MS);
    await db
      .update(adminsTable)
      .set({ telegramLinkHash: telegramLinkHash(code), telegramLinkExpiresAt: expiresAt })
      .where(eq(adminsTable.id, admin.id));
    return res.status(201).json({
      url: `https://t.me/${username}?start=${code}`,
      expires_at: expiresAt.toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

router.delete("/admin/me/telegram", async (_req, res, next) => {
  try {
    const admin = signedInAdmin(res);
    const [updated] = await db
      .update(adminsTable)
      .set({ telegramChatId: null, telegramLinkHash: null, telegramLinkExpiresAt: null })
      .where(eq(adminsTable.id, admin.id))
      .returning();
    return res.json(sessionBody(updated));
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// Managing admins: super admins only
// ---------------------------------------------------------------------------

function requireSuperAdmin(res: Response) {
  if (signedInAdmin(res).role === "super_admin") return true;
  res.status(403).json({ error: "Bu amal faqat super admin uchun" });
  return false;
}

router.get("/admin/admins", async (_req, res, next) => {
  try {
    if (!requireSuperAdmin(res)) return;
    const rows = await db.select().from(adminsTable).orderBy(adminsTable.role, adminsTable.username);
    // role sorts 'admin' before 'super_admin'; show super admins first.
    rows.sort((a, b) => (a.role === b.role ? 0 : a.role === "super_admin" ? -1 : 1));
    return res.json(rows.map(adminAccountDto));
  } catch (error) {
    return next(error);
  }
});

router.post("/admin/admins", async (req, res, next) => {
  try {
    if (!requireSuperAdmin(res)) return;
    const input = CreateAdminBody.parse(req.body);
    const username = normalizeUsername(input.username);
    const problem = newPasswordProblem(input.temporary_password, username);
    if (problem) return res.status(400).json({ error: problem });

    const passwordHash = await hashPassword(input.temporary_password);
    try {
      const [created] = await db
        .insert(adminsTable)
        .values({
          username,
          displayName: input.display_name.trim(),
          role: input.role,
          passwordHash,
          mustChangePassword: true,
        })
        .returning();
      return res.status(201).json(adminAccountDto(created));
    } catch (error) {
      if (isUniqueViolation(error)) return res.status(409).json({ error: "Bu login band" });
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

router.post("/admin/admins/:id/password", async (req, res, next) => {
  try {
    if (!requireSuperAdmin(res)) return;
    const { id } = ResetAdminPasswordParams.parse(req.params);
    const { temporary_password } = ResetAdminPasswordBody.parse(req.body);
    const [target] = await db.select().from(adminsTable).where(eq(adminsTable.id, id)).limit(1);
    if (!target) return res.status(404).json({ error: "Admin topilmadi" });
    const problem = newPasswordProblem(temporary_password, target.username);
    if (problem) return res.status(400).json({ error: problem });

    // They are signed out everywhere and must choose their own password next.
    const [updated] = await db
      .update(adminsTable)
      .set({
        passwordHash: await hashPassword(temporary_password),
        mustChangePassword: true,
        sessionVersion: sql`${adminsTable.sessionVersion} + 1`,
      })
      .where(eq(adminsTable.id, id))
      .returning();
    return res.json(adminAccountDto(updated));
  } catch (error) {
    return next(error);
  }
});

router.delete("/admin/admins/:id", async (req, res, next) => {
  try {
    if (!requireSuperAdmin(res)) return;
    const { id } = DeleteAdminParams.parse(req.params);
    // Locking every super admin row serialises two deletions racing each
    // other, which could otherwise remove the last two at the same moment.
    const outcome = await db.transaction(async (tx) => {
      const supers = await tx
        .select({ id: adminsTable.id })
        .from(adminsTable)
        .where(eq(adminsTable.role, "super_admin"))
        .for("update");
      const [target] = await tx.select().from(adminsTable).where(eq(adminsTable.id, id)).limit(1).for("update");
      if (!target) return "missing" as const;
      if (target.role === "super_admin" && supers.length <= 1) return "last-super" as const;
      await tx.delete(adminsTable).where(eq(adminsTable.id, id));
      return "deleted" as const;
    });
    if (outcome === "missing") return res.status(404).json({ error: "Admin topilmadi" });
    if (outcome === "last-super") {
      return res.status(409).json({ error: "Oxirgi super adminni o‘chirib bo‘lmaydi" });
    }
    // A deleted row has no session version left to match, so every cookie it
    // held stops working on the next request.
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
