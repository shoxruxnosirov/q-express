import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response } from "express";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export const ADMIN_SESSION_COOKIE = "qorasuv_admin_session";
export const ADMIN_SESSION_MAX_AGE = 8 * 60 * 60 * 1000;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for admin sessions");
  return secret;
}

function signature(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Passwords
//
// scrypt from node:crypto, so there is no native dependency to build on
// Render. Parameters travel with the hash, so they can be raised later without
// invalidating the passwords already stored.
// ---------------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const { N, r, p, keylen } = SCRYPT;
  const key = await scrypt(password, salt, keylen, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined) {
  const parts = (stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (![N, r, p].every(Number.isSafeInteger) || salt.length === 0 || expected.length === 0) return false;
  try {
    const key = await scrypt(password, salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// Verified against when the username does not exist, so a miss costs the same
// time as a wrong password and the response time does not reveal who has an
// account.
let dummyHash: Promise<string> | undefined;
export function burnPasswordCheck(password: string) {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash.then((hash) => verifyPassword(password, hash));
}

// Returns an Uzbek message for the admin, or undefined when acceptable.
export function newPasswordProblem(password: string, username: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Parol kamida ${PASSWORD_MIN_LENGTH} belgidan iborat bo‘lsin`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) return "Parol juda uzun";
  if (password.trim().toLowerCase() === username.trim().toLowerCase()) {
    return "Parol login bilan bir xil bo‘lmasin";
  }
  return undefined;
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

// Only used to authorise a seeded super admin's first password.
export function adminCodesMatch(providedCode: string, expectedCode: string) {
  return safeEqual(providedCode, expectedCode);
}

// ---------------------------------------------------------------------------
// Sessions
//
// The cookie names the admin and the session version it was issued under, and
// is signed. The version is checked against the database on every request, so
// deleting an admin, resetting their password or their own password change
// signs them out everywhere at once instead of after eight hours.
// ---------------------------------------------------------------------------

export type AdminSessionClaim = { adminId: number; version: number };

export function createAdminSessionToken(adminId: number, version: number, now = Date.now()) {
  const payload = `${adminId}.${version}.${now}`;
  return `${payload}.${signature(payload)}`;
}

export function readAdminSessionToken(token: unknown, now = Date.now()): AdminSessionClaim | undefined {
  if (typeof token !== "string") return undefined;
  const parts = token.split(".");
  if (parts.length !== 4 || !parts.slice(0, 3).every((part) => /^\d{1,15}$/.test(part))) return undefined;
  const [adminId, version, issuedAt] = parts.slice(0, 3).map(Number);
  const age = now - issuedAt;
  if (age < 0 || age > ADMIN_SESSION_MAX_AGE) return undefined;
  if (!safeEqual(parts[3], signature(parts.slice(0, 3).join(".")))) return undefined;
  return { adminId, version };
}

export function readAdminSession(req: Request) {
  return readAdminSessionToken(req.cookies?.[ADMIN_SESSION_COOKIE]);
}

export function setAdminSessionCookie(res: Response, adminId: number, version: number) {
  res.cookie(ADMIN_SESSION_COOKIE, createAdminSessionToken(adminId, version), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ADMIN_SESSION_MAX_AGE,
    path: "/",
  });
}

export function clearAdminSessionCookie(res: Response) {
  res.clearCookie(ADMIN_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}
