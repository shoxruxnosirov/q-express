-- Orders become private to the browser that placed them, and record which
-- admin last moved their status.
--
-- Until now GET /orders returned every customer's name, phone and address to
-- anyone. An order now carries the SHA-256 of a secret held in the ordering
-- browser's httpOnly cookie, the same scheme the chat uses. Orders placed
-- before this migration keep a NULL hash: no browser can claim them, and only
-- the dashboard lists them.
--
-- Idempotent: an existing database is left untouched.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "customer_token_hash" text;
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "status_changed_by" integer REFERENCES "admins"("id") ON DELETE SET NULL;
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "status_changed_at" timestamp with time zone;

-- "My orders" is read by this hash on every visit.
CREATE INDEX IF NOT EXISTS "orders_customer_token_hash_idx"
  ON "orders" ("customer_token_hash", "created_at" DESC);
