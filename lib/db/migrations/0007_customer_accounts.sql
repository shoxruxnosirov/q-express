-- Customer accounts, optionally verified through the Telegram bot.
--
-- A browser that orders, saves its profile or opens the chat becomes a row in
-- "users" (which existed but was never written) and holds a session secret
-- whose SHA-256 is in "customer_sessions". Verifying the phone through the bot
-- sets "phone_verified_at"; a verified phone is what lets the same customer
-- sign in on another device and what earns the free first delivery.
--
-- Idempotent: an existing database is left untouched.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone_verified_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;

-- A phone can back at most one verified customer. Unverified phones are just
-- what somebody typed and may repeat.
CREATE UNIQUE INDEX IF NOT EXISTS "users_verified_phone_key"
  ON "users" ("phone") WHERE "phone_verified_at" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "customer_sessions" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "customer_sessions_user_idx" ON "customer_sessions" ("user_id");

CREATE TABLE IF NOT EXISTS "customer_addresses" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "dom" text NOT NULL,
  "xonadon" text NOT NULL,
  "last_used_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "customer_addresses_user_address_key" UNIQUE ("user_id", "dom", "xonadon")
);

CREATE TABLE IF NOT EXISTS "phone_login_codes" (
  "phone" text PRIMARY KEY,
  "code_hash" text NOT NULL,
  "telegram_user_id" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "chat_threads"
  ADD COLUMN IF NOT EXISTS "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "orders_user_idx" ON "orders" ("user_id", "created_at" DESC);

-- One phone format everywhere, 998XXXXXXXXX, so "90 111 22 33" and
-- "+998 90 111 22 33" are the same customer for the first-order rule and the
-- leaderboard. Orders already hold digits only; a nine-digit local number and
-- the old "8" trunk prefix are completed with the country code. Anything else
-- is left as it was. Re-running changes nothing.
UPDATE "orders" SET "phone" = '998' || "phone" WHERE "phone" ~ '^[0-9]{9}$';
UPDATE "orders" SET "phone" = '998' || substr("phone", 2) WHERE "phone" ~ '^8[0-9]{9}$';
