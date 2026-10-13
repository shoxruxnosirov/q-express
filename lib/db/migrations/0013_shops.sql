-- Several shops on one platform.
--
-- Q express is shop 1, the platform's own shop: everything that existed before
-- this migration (categories, products, orders, admins, conversations) is its.
-- Q express's super admins create the other shops, each with its own catalog,
-- orders, admins, conversations, hours, delivery fee and Telegram bot.
--
-- A shop's bot token is a credential: it is stored encrypted by the API
-- (AES-256-GCM under a key derived from SESSION_SECRET), never in the clear.
-- Q express's own bot still comes from the environment (TELEGRAM_BOT_TOKEN /
-- TELEGRAM_NEW_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID), so bot_token_enc and
-- owner_chat_id stay NULL for shop 1.
--
-- Customers are shared: one account per Telegram person across every shop.
-- A block on users.blocked_at holds everywhere (Q express's super admins set
-- it); a shop blocks a customer for itself in customer_shop_blocks.
--
-- Idempotent: an existing database is left untouched.
CREATE TABLE IF NOT EXISTS "shops" (
  "id" serial PRIMARY KEY,
  "slug" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  -- Orders are numbered "<prefix>-0000123".
  "order_prefix" text NOT NULL UNIQUE,
  "sort_order" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  -- The card the storefront shows for the shop: rich HTML per language,
  -- {"uz": "...", "ru": "...", "en": "..."}, made in the admin's editor.
  "card" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "open_time" text NOT NULL DEFAULT '06:00',
  "close_time" text NOT NULL DEFAULT '23:00',
  "accepting_orders" boolean NOT NULL DEFAULT true,
  "delivery_fee" numeric(12, 2) NOT NULL DEFAULT 4590,
  "free_first_delivery" boolean NOT NULL DEFAULT false,
  "bot_token_enc" text,
  -- Public facts about the bot, read from getMe when the token is saved.
  "bot_id" text UNIQUE,
  "bot_username" text,
  -- The shop owner's own Telegram chat, told about every order like
  -- TELEGRAM_ADMIN_CHAT_ID is for Q express. Optional.
  "owner_chat_id" text,
  "settings_updated_by" integer REFERENCES "admins"("id") ON DELETE SET NULL,
  "settings_updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  -- "Deleting" a shop archives it (owner's choice): hidden, its bot silent,
  -- its admins locked out, its history kept, and a platform super admin may
  -- bring it back. NULL while the shop is in business.
  "archived_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "shops_slug_format" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  CONSTRAINT "shops_order_prefix_format" CHECK ("order_prefix" ~ '^[A-Z]{2,4}$'),
  CONSTRAINT "shops_open_time_format" CHECK ("open_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT "shops_close_time_format" CHECK ("close_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT "shops_delivery_fee_range" CHECK ("delivery_fee" >= 0)
);

-- For a database that ran this file before the column was added.
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;

-- Q express, carrying over the hours an admin set before shops existed.
INSERT INTO "shops" ("id", "slug", "name", "order_prefix", "sort_order", "free_first_delivery", "open_time", "close_time", "accepting_orders")
SELECT 1, 'qexpress', 'Q express', 'QE', 0, true,
  coalesce(s.open_time, '06:00'), coalesce(s.close_time, '23:00'), coalesce(s.accepting_orders, true)
FROM (SELECT 1) AS one
LEFT JOIN "store_settings" s ON s.id = 1
ON CONFLICT ("id") DO NOTHING;
SELECT setval(pg_get_serial_sequence('shops', 'id'), greatest((SELECT max("id") FROM "shops"), 1));

-- Every existing row is Q express's. The default only fills old rows and
-- protects older code paths; the API always names the shop it writes for.
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "shop_id" integer NOT NULL DEFAULT 1 REFERENCES "shops"("id");
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "shop_id" integer NOT NULL DEFAULT 1 REFERENCES "shops"("id");
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "shop_id" integer NOT NULL DEFAULT 1 REFERENCES "shops"("id");
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "shop_id" integer NOT NULL DEFAULT 1 REFERENCES "shops"("id");
ALTER TABLE "chat_threads" ADD COLUMN IF NOT EXISTS "shop_id" integer NOT NULL DEFAULT 1 REFERENCES "shops"("id");

-- A category slug is unique within its shop: two shops may both have "sut".
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_slug_unique";
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_slug_key";
CREATE UNIQUE INDEX IF NOT EXISTS "categories_shop_slug_key" ON "categories" ("shop_id", "slug");

CREATE INDEX IF NOT EXISTS "products_shop_idx" ON "products" ("shop_id");
CREATE INDEX IF NOT EXISTS "orders_shop_idx" ON "orders" ("shop_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "chat_threads_shop_user_idx" ON "chat_threads" ("shop_id", "user_id");

-- One person may run two shops' bots from one Telegram account, so a chat is
-- unique per shop rather than everywhere.
ALTER TABLE "admins" DROP CONSTRAINT IF EXISTS "admins_telegram_chat_id_unique";
ALTER TABLE "admins" DROP CONSTRAINT IF EXISTS "admins_telegram_chat_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "admins_shop_telegram_chat_key" ON "admins" ("shop_id", "telegram_chat_id");

-- The first free delivery is counted per shop.
DROP INDEX IF EXISTS "orders_address_key_idx";
CREATE INDEX IF NOT EXISTS "orders_shop_address_key_idx" ON "orders" ("shop_id", "address_key") WHERE "address_key" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "customer_shop_blocks" (
  "id" serial PRIMARY KEY,
  "shop_id" integer NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "blocked_at" timestamp with time zone NOT NULL DEFAULT now(),
  "blocked_by" integer REFERENCES "admins"("id") ON DELETE SET NULL,
  "reason" text,
  CONSTRAINT "customer_shop_blocks_shop_user_key" UNIQUE ("shop_id", "user_id")
);
