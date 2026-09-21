import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";

// A customer has no account, so their conversation is owned by a secret their
// browser holds rather than by their phone number. Keying on the phone number
// would have let anyone who knows it read that customer's messages, and the
// order list already leaks phone numbers.
//
// The cookie is httpOnly, so page scripts cannot read the secret and it never
// appears in a URL, a log line or a Referer header.

export const CHAT_SESSION_COOKIE = "qorasuv_chat_session";
// Long enough that a customer coming back next month still finds their
// conversation, which is the point of keeping it permanent.
export const CHAT_SESSION_MAX_AGE = 180 * 24 * 60 * 60 * 1000;

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function createChatToken() {
  return randomBytes(32).toString("hex");
}

// Only the hash reaches the database, so a leaked dump does not hand anybody a
// working key to somebody's conversation.
export function hashChatToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function readChatToken(req: Request) {
  const token = req.cookies?.[CHAT_SESSION_COOKIE];
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return undefined;
  return token;
}

export function setChatCookie(res: Response, token: string) {
  res.cookie(CHAT_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: CHAT_SESSION_MAX_AGE,
    path: "/",
  });
}
