-- Baseline schema. Mirrors lib/db/src/schema/store.ts so a fresh database is
-- ready without drizzle-kit push, which is a development-only tool.
-- Idempotent: an existing database is left untouched.
CREATE TABLE IF NOT EXISTS "categories" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "icon" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "products" (
  "id" serial PRIMARY KEY,
  "category_id" integer NOT NULL REFERENCES "categories"("id"),
  "name" text NOT NULL,
  "description" text NOT NULL,
  "image_url" text NOT NULL,
  "price" numeric(12, 2) NOT NULL,
  "old_price" numeric(12, 2),
  "unit" text NOT NULL,
  -- Six decimals carry kg/litr stock and derived amount-mode quantities.
  "stock" numeric(16, 6) NOT NULL DEFAULT 0,
  "is_popular" boolean NOT NULL DEFAULT false,
  "is_new" boolean NOT NULL DEFAULT false,
  "active" boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" serial PRIMARY KEY,
  "telegram_id" text UNIQUE,
  "name" text NOT NULL,
  "phone" text,
  "role" text NOT NULL DEFAULT 'customer',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "orders" (
  "id" serial PRIMARY KEY,
  "order_number" text NOT NULL UNIQUE,
  "user_id" integer REFERENCES "users"("id"),
  "customer_name" text NOT NULL,
  "phone" text NOT NULL,
  "address" text NOT NULL,
  "items" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'new',
  "payment_method" text NOT NULL,
  "subtotal" numeric(12, 2) NOT NULL,
  "delivery_fee" numeric(12, 2) NOT NULL,
  "total" numeric(12, 2) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
