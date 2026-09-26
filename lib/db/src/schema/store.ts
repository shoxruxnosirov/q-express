import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const categoriesTable = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  icon: text("icon").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id")
    .notNull()
    .references(() => categoriesTable.id),
  name: text("name").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url").notNull(),
  // Set when the image lives in our own Cloudinary account, NULL when image_url
  // points at a third party. Only a non-NULL id is ever deleted remotely.
  imagePublicId: text("image_public_id"),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  oldPrice: numeric("old_price", { precision: 12, scale: 2 }),
  unit: text("unit").notNull(),
  // Six decimal places are required for kg/litr inventory and derived
  // amount-mode quantities. Keep the API DTO as a number.
  stock: numeric("stock", { precision: 16, scale: 6, mode: "number" }).notNull().default(0),
  isPopular: boolean("is_popular").notNull().default(false),
  isNew: boolean("is_new").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  telegramId: text("telegram_id").unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  role: text("role").notNull().default("customer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Set once the phone was confirmed through the Telegram bot. Only a verified
  // phone identifies a customer across devices, and only it earns the free
  // first delivery. Unique among verified customers (partial index).
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

// One row per signed-in browser. The cookie holds a random secret and only its
// SHA-256 is stored, as with the chat; a customer may have several devices.
export const customerSessionsTable = pgTable("customer_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customerAddressesTable = pgTable(
  "customer_addresses",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    dom: text("dom").notNull(),
    xonadon: text("xonadon").notNull(),
    // Checkout lists these newest first and preselects the top one.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("customer_addresses_user_address_key").on(table.userId, table.dom, table.xonadon)],
);

// The code the bot sent after a customer shared their own phone. One live code
// per phone; only its hash is kept, and it dies after five minutes or five
// wrong guesses.
export const phoneLoginCodesTable = pgTable("phone_login_codes", {
  phone: text("phone").primaryKey(),
  codeHash: text("code_hash").notNull(),
  telegramUserId: text("telegram_user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  userId: integer("user_id").references(() => usersTable.id),
  customerName: text("customer_name").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  items: jsonb("items").notNull(),
  status: text("status").notNull().default("new"),
  paymentMethod: text("payment_method").notNull(),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  deliveryFee: numeric("delivery_fee", { precision: 12, scale: 2 }).notNull(),
  total: numeric("total", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // SHA-256 of the secret in the ordering browser's customer cookie. Only that
  // browser can list or open the order; NULL for orders placed before this
  // existed, which only the dashboard shows.
  customerTokenHash: text("customer_token_hash"),
  statusChangedBy: integer("status_changed_by").references(() => adminsTable.id, { onDelete: "set null" }),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
  // A pre-order's chosen delivery time; NULL means as soon as possible.
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
});

// The shop's one row of settings. Times are "HH:MM" on the Tashkent clock; a
// closing time at or before the opening time runs past midnight.
export const storeSettingsTable = pgTable("store_settings", {
  id: integer("id").primaryKey().default(1),
  openTime: text("open_time").notNull().default("06:00"),
  closeTime: text("close_time").notNull().default("23:00"),
  // An admin's switch for "no orders at all right now", hours or not.
  acceptingOrders: boolean("accepting_orders").notNull().default(true),
  updatedBy: integer("updated_by").references(() => adminsTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per person who can open the operator dashboard. Passwords are scrypt
// hashes; a NULL hash is a super admin seeded by migration who has not yet set
// one (the repository is public, so no password or hash is ever committed).
export const adminsTable = pgTable("admins", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  // 'super_admin' manages admins; 'admin' runs the shop.
  role: text("role").notNull().default("admin"),
  passwordHash: text("password_hash"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  // Part of every session cookie. Bumping it signs the admin out everywhere,
  // which is what a password change, a reset or a deletion needs.
  sessionVersion: integer("session_version").notNull().default(0),
  // Where this admin's Telegram notifications go, once they have linked it.
  telegramChatId: text("telegram_chat_id").unique(),
  // SHA-256 of the one-time code in a pending t.me link, and when it lapses.
  telegramLinkHash: text("telegram_link_hash").unique(),
  telegramLinkExpiresAt: timestamp("telegram_link_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A chat thread belongs to whoever holds its secret, not to a phone number,
// because the shop has no accounts and a phone number is not a credential.
// Only the hash of that secret is stored.
export const chatThreadsTable = pgTable("chat_threads", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  customerName: text("customer_name").notNull().default(""),
  phone: text("phone").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  operatorReadAt: timestamp("operator_read_at", { withTimezone: true }),
  customerReadAt: timestamp("customer_read_at", { withTimezone: true }),
  // The customer account this conversation belongs to, so it follows them to
  // another device once they verify their phone.
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
});

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id")
    .notNull()
    .references(() => chatThreadsTable.id, { onDelete: "cascade" }),
  sender: text("sender").notNull(),
  body: text("body").notNull(),
  // "<chat id>:<message id>" for an operator reply written in Telegram, NULL
  // otherwise. Unique, so a webhook Telegram retries is stored only once.
  telegramRef: text("telegram_ref").unique(),
  // Which admin wrote an operator message. NULL for customer messages, for
  // replies from the owner's Telegram chat, and after the admin is deleted.
  adminId: integer("admin_id").references(() => adminsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCategorySchema = createInsertSchema(categoriesTable).omit({ id: true });
export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true });
export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true });

export type Category = z.infer<typeof insertCategorySchema> & { id: number };
export type Product = z.infer<typeof insertProductSchema> & { id: number };
export type User = z.infer<typeof insertUserSchema> & { id: number };
export type Order = z.infer<typeof insertOrderSchema> & { id: number; createdAt: Date };