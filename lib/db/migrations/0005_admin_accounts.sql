-- Personal admin accounts replace the single shared operator code.
--
-- The two super admins are seeded here WITHOUT a password. This repository is
-- public, so neither a password nor its hash may be committed: a hash of an
-- ordinary password can be cracked offline. Each of them sets their own first
-- password on the website by also proving the deployment's ADMIN_ACCESS_CODE,
-- which only lives in the Render dashboard.
--
-- Idempotent: an existing database is left untouched, and a seeded account
-- that was later deleted on purpose is not resurrected once any admin exists
-- with a password (see the WHERE NOT EXISTS below).
CREATE TABLE IF NOT EXISTS "admins" (
  "id" serial PRIMARY KEY,
  "username" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "role" text NOT NULL DEFAULT 'admin',
  "password_hash" text,
  "must_change_password" boolean NOT NULL DEFAULT false,
  "session_version" integer NOT NULL DEFAULT 0,
  "telegram_chat_id" text UNIQUE,
  "telegram_link_hash" text UNIQUE,
  "telegram_link_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "admins_role_check" CHECK ("role" IN ('super_admin', 'admin'))
);

INSERT INTO "admins" ("username", "display_name", "role")
SELECT seed.username, seed.display_name, 'super_admin'
FROM (VALUES ('shoxrux', 'Shoxrux'), ('bahrom', 'Bahrom')) AS seed(username, display_name)
WHERE NOT EXISTS (SELECT 1 FROM "admins" WHERE "password_hash" IS NOT NULL)
ON CONFLICT ("username") DO NOTHING;

ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "admin_id" integer REFERENCES "admins"("id") ON DELETE SET NULL;
