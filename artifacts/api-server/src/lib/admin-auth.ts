import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export const ADMIN_SESSION_COOKIE = "qorasuv_admin_session";
export const ADMIN_SESSION_MAX_AGE = 8 * 60 * 60 * 1000;

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for admin sessions");
  return secret;
}

function signature(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

export function createAdminSession() {
  const payload = String(Date.now());
  return `${payload}.${signature(payload)}`;
}

export function adminCodesMatch(providedCode: string, expectedCode: string) {
  const provided = Buffer.from(providedCode, "utf8");
  const expected = Buffer.from(expectedCode, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function hasAdminSession(req: Request) {
  const token = req.cookies?.[ADMIN_SESSION_COOKIE];
  if (typeof token !== "string") return false;

  const [payload, providedSignature] = token.split(".");
  if (!payload || !providedSignature || !/^\d+$/.test(payload)) return false;

  const age = Date.now() - Number(payload);
  if (age < 0 || age > ADMIN_SESSION_MAX_AGE) return false;

  const expectedSignature = signature(payload);
  const expected = Buffer.from(expectedSignature, "utf8");
  const provided = Buffer.from(providedSignature, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}