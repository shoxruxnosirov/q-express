import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import {
  AdminLoginBody,
  CreateOrderBody,
  CreateAdminCategoryBody,
  CreateAdminProductBody,
  GetDeliveryFeeEstimateQueryParams,
  GetOrderParams,
  GetProductParams,
  ListAdminOrdersQueryParams,
  ListProductsQueryParams,
  UpdateAdminProductBody,
  UpdateAdminProductParams,
  UpdateAdminOrderStatusBody,
  UpdateAdminOrderStatusParams,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  categoriesTable,
  ordersTable,
  productsTable,
} from "@workspace/db/schema";
import { sendNewOrderNotification } from "../lib/telegram";
import {
  addMicroquantities,
  deriveAmountQuantityMicro,
  MICROQUANTITY_SCALE,
  quantityTotalCents,
  requireWholeUnitQuantity,
} from "../lib/quantity";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE,
  adminCodesMatch,
  createAdminSession,
  hasAdminSession,
} from "../lib/admin-auth";

const router: IRouter = Router();
const DELIVERY_FEE_CENTS = 4590 * 100;
const THOUSANDTH_SCALE = 1_000;
// numeric(12,2) is used by prices and order totals.
const MAX_MONEY_CENTS = 999_999_999_999;
const WEEKLY_PRIZE = "Maxsus sovg‘a";
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOGIN_MAX_ATTEMPTS = 5;
const ADMIN_LOGIN_BLOCK_MS = 15 * 60 * 1000;
const adminLoginAttempts = new Map<string, { count: number; windowStartedAt: number; blockedUntil: number }>();

const seedCategories = [
  { name: "Meva va sabzavotlar", slug: "meva-sabzavot", icon: "leaf", sortOrder: 1 },
  { name: "Sut mahsulotlari", slug: "sut", icon: "milk", sortOrder: 2 },
  { name: "Non va bakery", slug: "non-bakery", icon: "wheat", sortOrder: 3 },
  { name: "Go‘sht", slug: "gosht", icon: "beef", sortOrder: 4 },
  { name: "Ichimliklar", slug: "ichimliklar", icon: "cup", sortOrder: 5 },
  { name: "Shirinliklar", slug: "shirinliklar", icon: "cookie", sortOrder: 6 },
  { name: "Maishiy", slug: "maishiy", icon: "sparkles", sortOrder: 7 },
  { name: "Gigiyena", slug: "gigiyena", icon: "hand", sortOrder: 8 },
];

const seedProducts = [
  {
    categorySlug: "meva-sabzavot",
    name: "Qizil olma",
    description: "Shirin va xushbo‘y bog‘ olmalari",
    imageUrl: "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?auto=format&fit=crop&w=640&q=85",
    price: "18000",
    oldPrice: "22000",
    unit: "kg",
    stock: 34,
    isPopular: true,
    isNew: false,
  },
  {
    categorySlug: "meva-sabzavot",
    name: "Avokado",
    description: "Pishgan, yumshoq va foydali avokado",
    imageUrl: "https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=640&q=85",
    price: "32000",
    oldPrice: null,
    unit: "dona",
    stock: 18,
    isPopular: true,
    isNew: true,
  },
  {
    categorySlug: "sut",
    name: "Qatiq 2.5%",
    description: "Kundalik nonushta uchun tabiiy qatiq",
    imageUrl: "https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=640&q=85",
    price: "12500",
    oldPrice: null,
    unit: "qadoq",
    stock: 26,
    isPopular: true,
    isNew: false,
  },
  {
    categorySlug: "non-bakery",
    name: "Tandir non",
    description: "Har kuni yangi yopilgan issiq non",
    imageUrl: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=640&q=85",
    price: "5000",
    oldPrice: null,
    unit: "dona",
    stock: 45,
    isPopular: true,
    isNew: false,
  },
  {
    categorySlug: "gosht",
    name: "Mol go‘shti",
    description: "Yumshoq va sifatli saralangan go‘sht",
    imageUrl: "https://images.unsplash.com/photo-1603048297172-c92544798d5a?auto=format&fit=crop&w=640&q=85",
    price: "98000",
    oldPrice: "110000",
    unit: "kg",
    stock: 9,
    isPopular: false,
    isNew: true,
  },
  {
    categorySlug: "ichimliklar",
    name: "Gazsiz suv 1.5L",
    description: "Toza buloq suvi",
    imageUrl: "https://images.unsplash.com/photo-1548839140-29a749e1cf4d?auto=format&fit=crop&w=640&q=85",
    price: "4500",
    oldPrice: null,
    unit: "litr",
    stock: 60,
    isPopular: false,
    isNew: false,
  },
  {
    categorySlug: "shirinliklar",
    name: "Qora shokolad",
    description: "Kakao miqdori yuqori premium shokolad",
    imageUrl: "https://images.unsplash.com/photo-1548907040-4d42f0c1e73b?auto=format&fit=crop&w=640&q=85",
    price: "28000",
    oldPrice: "35000",
    unit: "qadoq",
    stock: 14,
    isPopular: true,
    isNew: false,
  },
  {
    categorySlug: "maishiy",
    name: "Idish yuvish geli",
    description: "Yog‘larni tez ketkazadigan limonli gel",
    imageUrl: "https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=640&q=85",
    price: "24000",
    oldPrice: null,
    unit: "dona",
    stock: 3,
    isPopular: false,
    isNew: false,
  },
];

let seedPromise: Promise<void> | undefined;

async function ensureSeedData() {
  if (!seedPromise) {
    seedPromise = (async () => {
      const existing = await db.select({ id: productsTable.id }).from(productsTable).limit(1);
      if (existing.length > 0) return;

      const categories = await db.insert(categoriesTable).values(seedCategories).returning();
      const categoryBySlug = new Map(categories.map((category) => [category.slug, category.id]));
      await db.insert(productsTable).values(
        seedProducts.map(({ categorySlug, ...product }) => ({
          ...product,
          categoryId: categoryBySlug.get(categorySlug)!,
        })),
      );
    })();
    // A rejected promise must not stay cached, or every later request
    // repeats the first failure long after its cause is gone.
    seedPromise.catch(() => {
      seedPromise = undefined;
    });
  }
  await seedPromise;
}

function money(value: string | number | null) {
  return value === null ? null : Number(value);
}

type ProductUnit = "dona" | "kg" | "litr" | "qadoq";
type PurchaseMode = "quantity" | "amount";

class OrderValidationError extends Error {}

function invalidOrder(message: string): never {
  throw new OrderValidationError(message);
}

function scaledInteger(value: number, scale: number, label: string, positive = false) {
  if (!Number.isFinite(value) || !Number.isSafeInteger(Math.round(value * scale))) {
    invalidOrder(`${label} noto‘g‘ri yoki chegaradan tashqari`);
  }
  const scaled = Math.round(value * scale);
  if (Math.abs(value * scale - scaled) > 1e-7) {
    invalidOrder(`${label} aniqligi noto‘g‘ri`);
  }
  if ((positive && scaled <= 0) || (!positive && scaled < 0)) {
    invalidOrder(`${label} musbat bo‘lishi kerak`);
  }
  return scaled;
}

function priceCents(value: string | number | null, label = "Narx") {
  if (value === null) invalidOrder(`${label} mavjud emas`);
  const cents = scaledInteger(Number(value), 100, label, true);
  if (cents > MAX_MONEY_CENTS) invalidOrder(`${label} chegaradan tashqari`);
  return cents;
}

function stockMicro(value: number | string) {
  return scaledInteger(Number(value), MICROQUANTITY_SCALE, "Ombor qoldig‘i");
}

function validateAdminProductNumbers(input: {
  price?: number;
  old_price?: number | null;
  stock?: number;
  unit?: ProductUnit;
}) {
  if (input.price !== undefined) priceCents(input.price);
  if (input.old_price !== undefined && input.old_price !== null) {
    if (!Number.isFinite(input.old_price)) invalidOrder("Eski narx noto‘g‘ri");
    if (scaledInteger(input.old_price, 100, "Eski narx") > MAX_MONEY_CENTS) {
      invalidOrder("Eski narx chegaradan tashqari");
    }
  }
  if (input.stock !== undefined) {
    const unit = input.unit;
    if (!unit) invalidOrder("Ombor birligi ko‘rsatilmagan");
    if (unit === "dona" || unit === "qadoq") {
      scaledInteger(input.stock, 1, "Ombor qoldig‘i");
    } else {
      stockMicro(input.stock);
    }
  }
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function phoneCondition(phone: string) {
  return sql`regexp_replace(${ordersTable.phone}, '[^0-9]', '', 'g') = ${phone}`;
}

function weekStart(date = new Date()) {
  const start = new Date(date);
  const day = start.getUTCDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  start.setUTCDate(start.getUTCDate() - daysFromMonday);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

function maskPhone(phone: string) {
  const digits = normalizePhone(phone);
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "Noma’lum";
}

function realCustomerName(value: string) {
  const name = value.trim();
  const placeholderNames = new Set(["", "telegram mijoz", "mijoz", "mehmon", "ism kiritilmagan"]);
  return placeholderNames.has(name.toLocaleLowerCase("uz-UZ")) ? undefined : name;
}

function weeklyLeaderboard(orders: Array<typeof ordersTable.$inferSelect>) {
  const start = weekStart();
  const customers = new Map<string, { phone: string; realName?: string; realNameAt?: Date; orderCount: number }>();
  const knownNames = new Map<string, { name: string; createdAt: Date }>();

  for (const order of orders) {
    const normalizedPhone = normalizePhone(order.phone);
    const name = realCustomerName(order.customerName);
    const known = knownNames.get(normalizedPhone);
    if (name && (!known || order.createdAt > known.createdAt)) {
      knownNames.set(normalizedPhone, { name, createdAt: order.createdAt });
    }
  }

  for (const order of orders) {
    if (order.status === "cancelled" || order.createdAt < start) continue;
    const normalizedPhone = normalizePhone(order.phone);
    const knownName = knownNames.get(normalizedPhone);
    const existing = customers.get(normalizedPhone);
    if (existing) {
      existing.orderCount += 1;
      if (knownName && (!existing.realNameAt || knownName.createdAt > existing.realNameAt)) {
        existing.realName = knownName.name;
        existing.realNameAt = knownName.createdAt;
      }
    } else {
      customers.set(normalizedPhone, {
        phone: normalizedPhone,
        realName: knownName?.name,
        realNameAt: knownName?.createdAt,
        orderCount: 1,
      });
    }
  }

  return [...customers.values()]
    .sort((a, b) => b.orderCount - a.orderCount || a.phone.localeCompare(b.phone))
    .slice(0, 10)
    .map((customer, index) => ({
      rank: index + 1,
      customer_name: customer.realName ?? "Ism kiritilmagan",
      phone_masked: maskPhone(customer.phone),
      order_count: customer.orderCount,
      is_winner: index === 0,
      prize: index === 0 ? WEEKLY_PRIZE : null,
    }));
}

function productDto(product: typeof productsTable.$inferSelect, category: string) {
  return {
    id: product.id,
    category_id: product.categoryId,
    category,
    name: product.name,
    description: product.description,
    image_url: product.imageUrl,
    price: money(product.price),
    old_price: money(product.oldPrice),
    unit: product.unit as "dona" | "kg" | "litr" | "qadoq",
    stock: Number(product.stock),
    is_popular: product.isPopular,
    is_new: product.isNew,
  };
}

function categoryDto(
  category: Pick<typeof categoriesTable.$inferSelect, "id" | "name" | "slug" | "icon">,
  productCount = 0,
) {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    icon: category.icon,
    product_count: productCount,
  };
}

function orderDto(order: typeof ordersTable.$inferSelect) {
  return {
    id: order.id,
    order_number: order.orderNumber,
    customer_name: order.customerName,
    phone: order.phone,
    address: order.address,
    items: order.items,
    status: order.status as "new" | "preparing" | "courier" | "delivered" | "cancelled",
    payment_method: order.paymentMethod as "cash" | "click" | "payme" | "uzcard" | "humo",
    subtotal: money(order.subtotal)!,
    delivery_fee: money(order.deliveryFee)!,
    total: money(order.total)!,
    created_at: order.createdAt,
  };
}

router.get("/categories", async (_req, res, next) => {
  try {
    await ensureSeedData();
    const categories = await db
      .select({
        id: categoriesTable.id,
        name: categoriesTable.name,
        slug: categoriesTable.slug,
        icon: categoriesTable.icon,
        product_count: sql<number>`count(${productsTable.id})`,
      })
      .from(categoriesTable)
      .leftJoin(productsTable, eq(productsTable.categoryId, categoriesTable.id))
      .where(eq(categoriesTable.active, true))
      .groupBy(categoriesTable.id)
      .orderBy(asc(categoriesTable.sortOrder));
    res.json(categories.map((category) => categoryDto(category, Number(category.product_count))));
  } catch (error) {
    return next(error);
  }
});

router.get("/products", async (req, res, next) => {
  try {
    await ensureSeedData();
    const query = ListProductsQueryParams.parse(req.query);
    const filters = [eq(productsTable.active, true)];
    if (query.search) filters.push(ilike(productsTable.name, `%${query.search}%`));
    if (query.category) filters.push(eq(categoriesTable.slug, query.category));

    const orderBy =
      query.sort === "price_asc"
        ? asc(productsTable.price)
        : query.sort === "price_desc"
          ? desc(productsTable.price)
          : query.sort === "newest"
            ? desc(productsTable.isNew)
            : query.sort === "discount"
              ? desc(sql`coalesce(${productsTable.oldPrice}, ${productsTable.price}) - ${productsTable.price}`)
              : desc(productsTable.isPopular);

    const rows = await db
      .select({ product: productsTable, category: categoriesTable.name })
      .from(productsTable)
      .innerJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
      .where(and(...filters))
      .orderBy(orderBy);
    res.json(rows.map(({ product, category }) => productDto(product, category)));
  } catch (error) {
    return next(error);
  }
});

router.get("/products/:id", async (req, res, next) => {
  try {
    await ensureSeedData();
    const { id } = GetProductParams.parse(req.params);
    const [row] = await db
      .select({ product: productsTable, category: categoriesTable.name })
      .from(productsTable)
      .innerJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
      .where(eq(productsTable.id, id))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Product not found" });
    return res.json(productDto(row.product, row.category));
  } catch (error) {
    return next(error);
  }
});

router.get("/orders/delivery-fee", async (req, res, next) => {
  try {
    const { phone } = GetDeliveryFeeEstimateQueryParams.parse(req.query);
    const normalizedPhone = normalizePhone(phone);
    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(ordersTable)
      .where(and(phoneCondition(normalizedPhone), sql`${ordersTable.status} <> 'cancelled'`));
    const previousOrderCount = Number(result.count);
    res.json({
      delivery_fee: previousOrderCount === 0 ? 0 : DELIVERY_FEE_CENTS / 100,
      previous_order_count: previousOrderCount,
      is_first_order: previousOrderCount === 0,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/orders", async (_req, res, next) => {
  try {
    const orders = await db.select().from(ordersTable).orderBy(desc(ordersTable.createdAt));
    res.json(orders.map(orderDto));
  } catch (error) {
    return next(error);
  }
});

router.get("/orders/:id", async (req, res, next) => {
  try {
    const { id } = GetOrderParams.parse(req.params);
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, id)).limit(1);
    if (!order) return res.status(404).json({ error: "Order not found" });
    return res.json(orderDto(order));
  } catch (error) {
    return next(error);
  }
});

router.post("/orders", async (req, res, next) => {
  try {
    await ensureSeedData();
    const input = CreateOrderBody.parse(req.body);
    const customerName = input.customer_name.trim();
    if (customerName.length < 2 || customerName.length > 80) {
      res.status(400).json({ error: "Mijoz ismi 2-80 ta belgidan iborat bo‘lishi kerak" });
      return;
    }
    const phone = normalizePhone(input.phone);
    const order = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${phone}))`);
      const [previousOrders] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(ordersTable)
        .where(and(phoneCondition(phone), sql`${ordersTable.status} <> 'cancelled'`));
      const deliveryFeeCents = Number(previousOrders.count) === 0 ? 0 : DELIVERY_FEE_CENTS;
      const productIds = [...new Set(input.items.map((item) => item.product_id))].sort((a, b) => a - b);
      const products = await tx
        .select({ product: productsTable, category: categoriesTable.name })
        .from(productsTable)
        .innerJoin(categoriesTable, eq(productsTable.categoryId, categoriesTable.id))
        .where(sql`${productsTable.id} in (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})`)
        .orderBy(asc(productsTable.id))
        .for("update");
      const productById = new Map(products.map((row) => [row.product.id, row]));
      if (products.length !== productIds.length) invalidOrder("Mahsulot topilmadi");

      const aggregates = new Map<number, {
        mode: PurchaseMode;
        quantityMicro?: number;
        amountCents?: number;
      }>();
      for (const item of input.items) {
        const row = productById.get(item.product_id);
        if (!row) invalidOrder("Mahsulot topilmadi");
        const mode = item.purchase_mode ?? "quantity";
        if (item.quantity !== undefined && item.amount !== undefined) {
          invalidOrder("Miqdor va summa bir vaqtda yuborilmaydi");
        }
        if (mode === "quantity" && item.amount !== undefined) {
          invalidOrder("Miqdor rejimida summa yuborilmaydi");
        }
        if (mode === "amount" && item.quantity !== undefined) {
          invalidOrder("Summa rejimida miqdor yuborilmaydi");
        }
        const unit = row.product.unit as ProductUnit;
        if (mode === "amount" && unit !== "kg" && unit !== "litr") {
          invalidOrder("Summa rejimi faqat kg yoki litr uchun mavjud");
        }
        const existing = aggregates.get(item.product_id);
        if (existing && existing.mode !== mode) {
          invalidOrder("Bir mahsulot uchun rejimlar aralashtirilmasin");
        }
        const aggregate = existing ?? { mode };
        if (mode === "quantity") {
          if (item.quantity === undefined) invalidOrder("Miqdor ko‘rsatilishi kerak");
          const quantityThousandths = scaledInteger(item.quantity, THOUSANDTH_SCALE, "Miqdor", true);
          const quantityMicro = quantityThousandths * (MICROQUANTITY_SCALE / THOUSANDTH_SCALE);
          if (!Number.isSafeInteger(quantityMicro)) invalidOrder("Miqdor chegaradan tashqari");
          if (unit === "dona" || unit === "qadoq") {
            if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
              invalidOrder("Dona va qadoq miqdori butun musbat son bo‘lishi kerak");
            }
          }
          try {
            aggregate.quantityMicro = addMicroquantities(aggregate.quantityMicro ?? 0, quantityMicro);
          } catch {
            invalidOrder("Buyurtma qiymati chegaradan tashqari");
          }
        } else {
          if (item.amount === undefined) invalidOrder("Summa ko‘rsatilishi kerak");
          const amountCents = scaledInteger(item.amount, 100, "Summa", true);
          if (amountCents > MAX_MONEY_CENTS) invalidOrder("Summa chegaradan tashqari");
          aggregate.amountCents = (aggregate.amountCents ?? 0) + amountCents;
        }
        if (!Number.isSafeInteger(aggregate.quantityMicro ?? 0) || !Number.isSafeInteger(aggregate.amountCents ?? 0)) {
          invalidOrder("Buyurtma qiymati chegaradan tashqari");
        }
        aggregates.set(item.product_id, aggregate);
      }

      const items = [...aggregates].map(([productId, aggregate]) => {
        const row = productById.get(productId)!;
        const unit = row.product.unit as ProductUnit;
        const currentPriceCents = priceCents(row.product.price);
        let quantityMicro: number;
        let requestedAmountCents: number | undefined;
        if (aggregate.mode === "amount") {
          quantityMicro = deriveAmountQuantityMicro(aggregate.amountCents!, currentPriceCents);
          requestedAmountCents = aggregate.amountCents;
          if (!Number.isSafeInteger(quantityMicro) || quantityMicro <= 0) {
            invalidOrder("Summa bo‘yicha miqdor juda kichik");
          }
        } else {
          quantityMicro = aggregate.quantityMicro!;
        }
        if (quantityMicro < MICROQUANTITY_SCALE / 1000) {
          invalidOrder("Miqdor kamida 0.001 bo‘lishi kerak");
        }
        if ((unit === "dona" || unit === "qadoq") && quantityMicro % MICROQUANTITY_SCALE !== 0) {
          try {
            requireWholeUnitQuantity(quantityMicro);
          } catch {
            invalidOrder("Dona va qadoq miqdori butun musbat son bo‘lishi kerak");
          }
        }
        const availableMicro = stockMicro(row.product.stock);
        if (availableMicro < quantityMicro) invalidOrder("Omborda yetarli mahsulot yo‘q");
        const totalCents = requestedAmountCents ?? quantityTotalCents(currentPriceCents, quantityMicro);
        if (!Number.isSafeInteger(totalCents)) invalidOrder("Buyurtma summasi chegaradan tashqari");
        const line = {
          product_id: row.product.id,
          name: row.product.name,
          image_url: row.product.imageUrl,
          price: money(row.product.price)!,
          quantity: quantityMicro / MICROQUANTITY_SCALE,
          unit: row.product.unit,
          total: totalCents / 100,
          purchase_mode: aggregate.mode,
          ...(requestedAmountCents === undefined ? {} : { requested_amount: requestedAmountCents / 100 }),
        };
        return { line, quantityMicro, totalCents };
      });
      const subtotalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
      if (!Number.isSafeInteger(subtotalCents) || subtotalCents > MAX_MONEY_CENTS) {
        invalidOrder("Buyurtma summasi chegaradan tashqari");
      }
      if (subtotalCents + deliveryFeeCents > MAX_MONEY_CENTS) {
        invalidOrder("Buyurtma jami chegaradan tashqari");
      }
      const orderNumber = `QE-${Date.now().toString().slice(-6)}`;
      const [created] = await tx
        .insert(ordersTable)
        .values({
          orderNumber,
          customerName,
          phone,
          address: input.address,
          items: items.map((item) => item.line),
          status: "new",
          paymentMethod: input.payment_method,
          subtotal: (subtotalCents / 100).toFixed(2),
          deliveryFee: (deliveryFeeCents / 100).toFixed(2),
          total: ((subtotalCents + deliveryFeeCents) / 100).toFixed(2),
        })
        .returning();
      for (const item of items) {
        await tx
          .update(productsTable)
          .set({ stock: sql`${productsTable.stock} - ${item.quantityMicro / MICROQUANTITY_SCALE}` })
          .where(eq(productsTable.id, item.line.product_id));
      }
      return created;
    });
    const notification = await sendNewOrderNotification(order);
    if (!notification.sent) {
      req.log.error({ error: notification.error, orderId: order.id }, "Telegram order notification failed");
    }
    return res.status(201).json(orderDto(order));
  } catch (error) {
    if (error instanceof OrderValidationError) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.get("/leaderboard/weekly", async (_req, res, next) => {
  try {
    const orders = await db.select().from(ordersTable);
    res.json(weeklyLeaderboard(orders));
  } catch (error) {
    return next(error);
  }
});

router.post("/admin/auth", async (req, res, next) => {
  try {
    const { code } = AdminLoginBody.parse(req.body);
    const expectedCode = process.env.ADMIN_ACCESS_CODE;
    if (!expectedCode) throw new Error("ADMIN_ACCESS_CODE is not configured");
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const previous = adminLoginAttempts.get(key);
    const attempt = previous && now - previous.windowStartedAt < ADMIN_LOGIN_WINDOW_MS
      ? previous
      : { count: 0, windowStartedAt: now, blockedUntil: 0 };
    if (attempt.blockedUntil > now) {
      return res.status(429).json({ error: "Too many attempts. Try again later." });
    }
    if (!adminCodesMatch(code, expectedCode)) {
      attempt.count += 1;
      if (attempt.count >= ADMIN_LOGIN_MAX_ATTEMPTS) attempt.blockedUntil = now + ADMIN_LOGIN_BLOCK_MS;
      adminLoginAttempts.set(key, attempt);
      return res.status(401).json({ error: "Invalid operator code" });
    }
    adminLoginAttempts.delete(key);

    res.cookie(ADMIN_SESSION_COOKIE, createAdminSession(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ADMIN_SESSION_MAX_AGE,
      path: "/",
    });
    return res.json({ authenticated: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/session", (req, res) => {
  res.json({ authenticated: hasAdminSession(req) });
});

router.post("/admin/logout", (req, res) => {
  res.clearCookie(ADMIN_SESSION_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
  res.json({ authenticated: false });
});

router.use("/admin", (req, res, next) => {
  if (!hasAdminSession(req)) {
    return res.status(401).json({ error: "Operator authentication required" });
  }
  return next();
});

router.post("/admin/categories", async (req, res, next) => {
  try {
    const input = CreateAdminCategoryBody.parse(req.body);
    const [category] = await db
      .insert(categoriesTable)
      .values({
        name: input.name.trim(),
        slug: input.slug.trim().toLowerCase(),
        icon: input.icon.trim(),
        sortOrder: input.sort_order ?? 0,
      })
      .returning();
    return res.status(201).json(categoryDto(category));
  } catch (error) {
    return next(error);
  }
});

router.post("/admin/products", async (req, res, next) => {
  try {
    await ensureSeedData();
    const input = CreateAdminProductBody.parse(req.body);
    validateAdminProductNumbers(input);
    const [category] = await db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.id, input.category_id))
      .limit(1);
    if (!category) return res.status(400).json({ error: "Category not found" });

    const [product] = await db
      .insert(productsTable)
      .values({
        categoryId: input.category_id,
        name: input.name.trim(),
        description: input.description.trim(),
        imageUrl: input.image_url,
        price: String(input.price),
        oldPrice: input.old_price == null ? null : String(input.old_price),
        unit: input.unit,
        stock: input.stock,
        isPopular: input.is_popular ?? false,
        isNew: input.is_new ?? false,
      })
      .returning();
    return res.status(201).json(productDto(product, category.name));
  } catch (error) {
    if (error instanceof OrderValidationError) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.patch("/admin/products/:id", async (req, res, next) => {
  try {
    const { id } = UpdateAdminProductParams.parse(req.params);
    const input = UpdateAdminProductBody.parse(req.body);
    const [existingProduct] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, id))
      .limit(1);
    if (!existingProduct) return res.status(404).json({ error: "Product not found" });
    validateAdminProductNumbers({
      ...input,
      unit: input.unit ?? (existingProduct.unit as ProductUnit),
      stock: input.stock ?? (input.unit === undefined ? undefined : existingProduct.stock),
    });
    const update: Partial<typeof productsTable.$inferInsert> = {};
    if (input.category_id !== undefined) update.categoryId = input.category_id;
    if (input.name !== undefined) update.name = input.name.trim();
    if (input.description !== undefined) update.description = input.description.trim();
    if (input.image_url !== undefined) update.imageUrl = input.image_url;
    if (input.price !== undefined) update.price = String(input.price);
    if (input.old_price !== undefined) update.oldPrice = input.old_price == null ? null : String(input.old_price);
    if (input.unit !== undefined) update.unit = input.unit;
    if (input.stock !== undefined) update.stock = input.stock;
    if (input.is_popular !== undefined) update.isPopular = input.is_popular;
    if (input.is_new !== undefined) update.isNew = input.is_new;
    if (Object.keys(update).length === 0) return res.status(400).json({ error: "No product changes supplied" });
    if (input.category_id !== undefined) {
      const [category] = await db
        .select({ id: categoriesTable.id })
        .from(categoriesTable)
        .where(eq(categoriesTable.id, input.category_id))
        .limit(1);
      if (!category) return res.status(400).json({ error: "Category not found" });
    }

    const [product] = await db
      .update(productsTable)
      .set(update)
      .where(eq(productsTable.id, id))
      .returning();
    const [category] = await db
      .select({ name: categoriesTable.name })
      .from(categoriesTable)
      .where(eq(categoriesTable.id, product.categoryId))
      .limit(1);
    return res.json(productDto(product, category?.name ?? "Noma'lum"));
  } catch (error) {
    if (error instanceof OrderValidationError) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

router.get("/admin/dashboard", async (_req, res, next) => {
  try {
    await ensureSeedData();
    const orders = await db.select().from(ordersTable);
    const now = Date.now();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const recent = orders.filter((order) => order.createdAt >= todayStart);
    const sumSince = (from: Date) =>
      orders
        .filter((order) => order.createdAt >= from && order.status !== "cancelled")
        .reduce((sum, order) => sum + money(order.total)!, 0);
    const statuses = (status: string) => orders.filter((order) => order.status === status).length;
    const [{ count: productCount }] = await db.select({ count: sql<number>`count(*)` }).from(productsTable);
    const [{ count: lowStockCount }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(productsTable)
      .where(sql`${productsTable.stock} <= 5`);
    res.json({
      today_orders: recent.length,
      new_orders: statuses("new"),
      preparing_orders: statuses("preparing"),
      courier_orders: statuses("courier"),
      delivered_orders: statuses("delivered"),
      cancelled_orders: statuses("cancelled"),
      today_revenue: sumSince(todayStart),
      weekly_revenue: sumSince(weekStart),
      monthly_revenue: sumSince(monthStart),
       customer_count: new Set(orders.filter((order) => order.status !== "cancelled").map((order) => order.phone)).size,
      product_count: Number(productCount),
      low_stock_count: Number(lowStockCount),
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/admin/orders", async (req, res, next) => {
  try {
    const query = ListAdminOrdersQueryParams.parse(req.query);
    const orders = await db
      .select()
      .from(ordersTable)
      .where(query.status ? eq(ordersTable.status, query.status) : undefined)
      .orderBy(desc(ordersTable.createdAt));
    res.json(orders.map(orderDto));
  } catch (error) {
    return next(error);
  }
});

router.patch("/admin/orders/:id/status", async (req, res, next) => {
  try {
    const { id } = UpdateAdminOrderStatusParams.parse(req.params);
    const { status } = UpdateAdminOrderStatusBody.parse(req.body);
    const [order] = await db
      .update(ordersTable)
      .set({ status })
      .where(eq(ordersTable.id, id))
      .returning();
    if (!order) return res.status(404).json({ error: "Order not found" });
    return res.json(orderDto(order));
  } catch (error) {
    return next(error);
  }
});

export default router;