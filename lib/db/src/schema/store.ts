import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
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