-- Admins are reminded on Telegram 15 minutes before a pre-order is due.
-- The time a reminder went out is recorded, so none is ever sent twice, even
-- when the server restarts in between.
--
-- Idempotent: an existing database is left untouched.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "reminder_sent_at" timestamp with time zone;

-- The reminder loop looks for pre-orders not yet reminded, every minute.
CREATE INDEX IF NOT EXISTS "orders_pending_reminder_idx"
  ON "orders" ("scheduled_for") WHERE "scheduled_for" IS NOT NULL AND "reminder_sent_at" IS NULL;
