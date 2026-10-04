import type { Request, Response } from "express";
import { createChatToken, hashChatToken } from "./chat-session";

// The device's session with a customer account. The cookie holds a random
// secret and customer_sessions only its SHA-256, so a leaked dump signs
// nobody in.

export const CUSTOMER_SESSION_COOKIE = "qorasuv_customer";
// Rolling: refreshed on every request that presents it, so a customer who
// keeps coming back stays signed in.
export const CUSTOMER_SESSION_MAX_AGE = 180 * 24 * 60 * 60 * 1000;

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const createCustomerToken = createChatToken;
export const hashCustomerToken = hashChatToken;

// The Mini App sends the session as "Authorization: Bearer <token>": inside
// Telegram Web the shop runs in a frame of another site, and the browser may
// withhold a cookie there. The header wins when both are present, since the
// Mini App always knows which Telegram account it was opened by.
const BEARER_PATTERN = /^Bearer ([0-9a-f]{64})$/;

export function readCustomerToken(req: Request) {
  const bearer = BEARER_PATTERN.exec(req.get?.("authorization") ?? "");
  if (bearer) return bearer[1];
  const token = req.cookies?.[CUSTOMER_SESSION_COOKIE];
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return undefined;
  return token;
}

export function setCustomerCookie(res: Response, token: string) {
  res.cookie(CUSTOMER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: CUSTOMER_SESSION_MAX_AGE,
    path: "/",
  });
}

export function clearCustomerCookie(res: Response) {
  res.clearCookie(CUSTOMER_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

// A browser waiting for the bot to approve its sign-in holds the request's
// secret here. Short-lived: the request itself lapses in ten minutes.
export const LOGIN_REQUEST_COOKIE = "qorasuv_login";
const LOGIN_REQUEST_MAX_AGE = 20 * 60 * 1000;

export function readLoginRequestToken(req: Request) {
  const token = req.cookies?.[LOGIN_REQUEST_COOKIE];
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return undefined;
  return token;
}

export function setLoginRequestCookie(res: Response, token: string) {
  res.cookie(LOGIN_REQUEST_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: LOGIN_REQUEST_MAX_AGE,
    path: "/",
  });
}

export function clearLoginRequestCookie(res: Response) {
  res.clearCookie(LOGIN_REQUEST_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}
