-- The shop lives in Telegram.
--
-- Inside the Mini App the customer is who Telegram says they are: the signed
-- launch data names the Telegram account, and that account is the customer.
-- Nothing is verified and no code is typed; the customer fills in their name,
-- phone and address themselves. Orders are taken only in the Mini App, so
-- every buyer is a Telegram account and a block holds; a browser outside
-- Telegram shows the catalogue and sends people to the bot.
--
-- Every session now records where it came from, so an admin can see a
-- customer's devices, sign one out, or block it.
--
-- The free first delivery now belongs to an address (dom and xonadon), not to
-- a phone or an account: the first order to a flat is free, whoever places it.
--
-- Idempotent: an existing database is left untouched.
ALTER TABLE "customer_sessions" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'browser';
ALTER TABLE "customer_sessions" ADD COLUMN IF NOT EXISTS "telegram_id" text;
ALTER TABLE "customer_sessions" ADD COLUMN IF NOT EXISTS "user_agent" text;
ALTER TABLE "customer_sessions" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp with time zone;
ALTER TABLE "customer_sessions" ADD COLUMN IF NOT EXISTS "revoked_by" integer REFERENCES "admins"("id") ON DELETE SET NULL;
ALTER TABLE "customer_sessions" ADD COLUMN IF NOT EXISTS "blocked_at" timestamp with time zone;
ALTER TABLE "customer_sessions" ADD COLUMN IF NOT EXISTS "blocked_by" integer REFERENCES "admins"("id") ON DELETE SET NULL;
ALTER TABLE "customer_sessions" ADD COLUMN IF NOT EXISTS "block_reason" text;
CREATE INDEX IF NOT EXISTS "customer_sessions_user_idx" ON "customer_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "customer_sessions_telegram_idx" ON "customer_sessions" ("telegram_id") WHERE "telegram_id" IS NOT NULL;

-- Who the customer is in Telegram, refreshed on every launch and message, so
-- the admins know them by more than what they typed: the name Telegram shows
-- and the @username (NULL when they have none).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_name" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "telegram_username" text;

-- Which device wrote a customer message on the site. NULL for operator
-- messages and for messages written to the bot.
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "session_id" integer REFERENCES "customer_sessions"("id") ON DELETE SET NULL;

-- "dom|xonadon", lower-cased and without leading zeros, for the address an
-- order goes to; NULL when the
-- address does not have the shape the shop writes ("12-dom, 5-xonadon").
-- Filled in for older orders from their address line.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "address_key" text;
UPDATE "orders" o
SET "address_key" = regexp_replace(lower(m[1]), '^0+(?=.)', '') || '|' || regexp_replace(lower(m[2]), '^0+(?=.)', '')
FROM (
  SELECT "id", regexp_match("address", '^\s*([0-9A-Za-z]{1,10})\s*-?\s*dom\s*[,\s]\s*([0-9A-Za-z]{1,10})\s*-?\s*xonadon\s*$', 'i') AS m
  FROM "orders"
  WHERE "address_key" IS NULL
) parsed
WHERE o."id" = parsed."id" AND parsed.m IS NOT NULL;
CREATE INDEX IF NOT EXISTS "orders_address_key_idx" ON "orders" ("address_key") WHERE "address_key" IS NOT NULL;

-- The six-digit codes are gone; nothing reads this table any more.
DROP TABLE IF EXISTS "phone_login_codes";
