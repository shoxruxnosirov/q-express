-- Opening hours and pre-orders.
--
-- The shop takes orders for right now only while open; outside the hours a
-- customer may still order ahead for a delivery slot inside them. Admins set
-- the hours and can pause all orders. Times are "HH:MM" on the Tashkent clock.
--
-- Idempotent: an existing database is left untouched.
CREATE TABLE IF NOT EXISTS "store_settings" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "open_time" text NOT NULL DEFAULT '06:00',
  "close_time" text NOT NULL DEFAULT '23:00',
  "accepting_orders" boolean NOT NULL DEFAULT true,
  "updated_by" integer REFERENCES "admins"("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "store_settings_single_row" CHECK ("id" = 1),
  CONSTRAINT "store_settings_open_time_format" CHECK ("open_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT "store_settings_close_time_format" CHECK ("close_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
INSERT INTO "store_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "scheduled_for" timestamp with time zone;
