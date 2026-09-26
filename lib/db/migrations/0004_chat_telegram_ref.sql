-- The operator can now answer a customer by replying in the Telegram admin
-- chat. Telegram retries a webhook it believes failed, for example while the
-- free instance is still waking up, so each reply carries the Telegram message
-- it came from and a unique index keeps a retried update from being stored
-- twice. NULL for everything written on the website; Postgres treats NULLs as
-- distinct, so they never collide.
--
-- Idempotent: an existing database is left untouched.
ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "telegram_ref" text;

CREATE UNIQUE INDEX IF NOT EXISTS "chat_messages_telegram_ref_key"
  ON "chat_messages" ("telegram_ref");
