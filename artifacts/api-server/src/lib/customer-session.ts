import type { Request, Response } from "express";
import { createChatToken, hashChatToken } from "./chat-session";

// A customer has no account, so "my orders" means "the orders this browser
// placed". The browser holds a random secret in an httpOnly cookie and each
// order stores only its SHA-256, exactly as the chat does. A separate cookie
// from the chat's, so clearing one never costs the other.

export const CUSTOMER_SESSION_COOKIE = "qorasuv_customer";
// Rolling, like the chat cookie: refreshed on every order request, so a
// customer who keeps ordering keeps their history.
export const CUSTOMER_SESSION_MAX_AGE = 180 * 24 * 60 * 60 * 1000;

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export const createCustomerToken = createChatToken;
export const hashCustomerToken = hashChatToken;

export function readCustomerToken(req: Request) {
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
