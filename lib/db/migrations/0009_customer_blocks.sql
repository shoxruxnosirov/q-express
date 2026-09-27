-- Admins can block a customer.
--
-- A blocked customer cannot order, chat, change their profile, verify their
-- phone or sign in through the Mini App. The block is enforced against the
-- account, its phone number and its Telegram account, so clearing cookies or
-- switching devices does not lift it. Existing orders are left as they are.
--
-- Idempotent: an existing database is left untouched.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "blocked_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "blocked_by" integer REFERENCES "admins"("id") ON DELETE SET NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "block_reason" text;

-- Every order checks whether its phone belongs to a blocked customer.
CREATE INDEX IF NOT EXISTS "users_blocked_phone_idx" ON "users" ("phone") WHERE "blocked_at" IS NOT NULL;
