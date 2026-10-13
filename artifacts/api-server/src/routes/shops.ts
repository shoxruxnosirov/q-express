import { Router, type IRouter, type Response } from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  ArchiveAdminShopParams,
  ConnectAdminShopBotParams,
  CreateAdminShopBody,
  RestoreAdminShopParams,
  UpdateAdminShopBody,
  UpdateAdminShopParams,
  UpdateShopCardBody,
  UpdateShopCardParams,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { adminsTable, shopsTable } from "@workspace/db/schema";
import { hashPassword, newPasswordProblem, normalizeUsername } from "../lib/admin-auth";
import { adminAccountDto, isPlatformSuperAdmin, signedInAdmin } from "../lib/admin-directory";
import { isUniqueViolation } from "../lib/pg-error";
import {
  adminShopDto,
  connectPlatformBot,
  connectShopBot,
  connectShopBotLater,
  disconnectShopBot,
  encryptBotToken,
  forgetShops,
  isArchived,
  isBotTokenShape,
  isPlatformShop,
  listShops,
  loadShop,
  PLATFORM_SHOP_ID,
  publicBaseUrl,
  shopDto,
  type ShopRow,
} from "../lib/shops";
import { isValidTime } from "../lib/store-hours";
import { envBotContext, getBotIdentity } from "../lib/telegram";

const router: IRouter = Router();

// The shops a customer can visit, Q express first.
router.get("/shops", async (_req, res, next) => {
  try {
    const shops = await listShops();
    res.json(shops.filter((shop) => shop.active).sort(platformFirst).map(shopDto));
  } catch (error) {
    return next(error);
  }
});

function platformFirst(a: ShopRow, b: ShopRow) {
  return Number(isPlatformShop(b)) - Number(isPlatformShop(a)) || a.sortOrder - b.sortOrder || a.id - b.id;
}


function requirePlatformSuperAdmin(res: Response) {
  if (isPlatformSuperAdmin(signedInAdmin(res))) return true;
  res.status(403).json({ error: "Bu amal faqat Q express super admini uchun" });
  return false;
}

// A token typed for a shop is asked of Telegram before it is saved, so a typo
// is caught here rather than as a silent bot later. It must be a bot of its
// own: not Q express's, not another shop's.
async function checkBotToken(token: string, exceptShopId?: number) {
  if (!isBotTokenShape(token)) return { error: "Bot tokeni noto‘g‘ri ko‘rinishda (BotFather bergan 123456:ABC… ko‘rinishidagi token)" } as const;
  const identity = await getBotIdentity(token);
  if (!identity) return { error: "Telegram bu tokenni tanimadi. Tokenni BotFather'dan qayta nusxalang." } as const;
  // Both of Q express's bots, the one in use and the one the other bot mode
  // would switch to.
  const platformTokens = [envBotContext().token, process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_NEW_BOT_TOKEN];
  if (platformTokens.some((platformToken) => platformToken && platformToken.split(":")[0] === identity.id)) {
    return { error: "Bu Q express'ning o‘z boti. Do‘kon uchun alohida bot yarating." } as const;
  }
  const [taken] = await db
    .select({ id: shopsTable.id })
    .from(shopsTable)
    .where(and(eq(shopsTable.botId, identity.id), exceptShopId === undefined ? undefined : ne(shopsTable.id, exceptShopId)))
    .limit(1);
  if (taken) return { error: "Bu bot boshqa do‘konga ulangan" } as const;
  return { identity } as const;
}

function cleanOwnerChat(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const chat = value?.trim() ?? "";
  if (chat === "") return null;
  return /^[1-9]\d{0,19}$/.test(chat) ? chat : false;
}

const ARCHIVED = "Do‘kon arxivlangan. Avval uni arxivdan qaytaring.";

const OWNER_CHAT_INVALID = "Egasining chat ID raqami musbat son bo‘lsin (shaxsiy chat), masalan 123456789";

// What a shop's card may hold: the editor's HTML per language, nothing else.
// It is sanitized again whenever it is shown.
function cleanCard(card: Partial<Record<"uz" | "ru" | "en", string>> | undefined) {
  const result: Partial<Record<"uz" | "ru" | "en", string>> = {};
  for (const lang of ["uz", "ru", "en"] as const) {
    const html = card?.[lang]?.trim();
    if (html) result[lang] = html;
  }
  return result;
}

router.get("/admin/shops", async (_req, res, next) => {
  try {
    const admin = signedInAdmin(res);
    const shops = await listShops();
    // Q express's admins may edit every shop's card, so they see them all.
    // A copy: the list is shared with every other request.
    const visible = admin.shopId === PLATFORM_SHOP_ID ? [...shops] : shops.filter((shop) => shop.id === admin.shopId);
    res.json(visible.sort(platformFirst).map(adminShopDto));
  } catch (error) {
    return next(error);
  }
});

router.post("/admin/shops", async (req, res, next) => {
  try {
    if (!requirePlatformSuperAdmin(res)) return;
    const input = CreateAdminShopBody.parse(req.body);
    const name = input.name.trim();
    if (name.length < 2) return res.status(400).json({ error: "Do‘kon nomi kamida 2 harf bo‘lsin" });
    if (!isValidTime(input.open_time) || !isValidTime(input.close_time)) {
      return res.status(400).json({ error: "Vaqt SS:DD ko‘rinishida bo‘lsin, masalan 06:00" });
    }
    const ownerChatId = cleanOwnerChat(input.owner_chat_id);
    if (ownerChatId === false) return res.status(400).json({ error: OWNER_CHAT_INVALID });
    const username = normalizeUsername(input.super_admin.username);
    const passwordProblem = newPasswordProblem(input.super_admin.temporary_password, username);
    if (passwordProblem) return res.status(400).json({ error: passwordProblem });
    const token = input.bot_token.trim();
    const checked = await checkBotToken(token);
    if ("error" in checked) return res.status(400).json({ error: checked.error });

    const passwordHash = await hashPassword(input.super_admin.temporary_password);
    const created = await db.transaction(async (tx) => {
      // New shops go after the existing ones.
      const [{ last }] = await tx.select({ last: sql<number | null>`max(${shopsTable.sortOrder})` }).from(shopsTable);
      const [shop] = await tx
        .insert(shopsTable)
        .values({
          slug: input.slug,
          name,
          orderPrefix: input.order_prefix,
          sortOrder: last === null ? 1 : Number(last) + 1,
          card: cleanCard(input.card),
          openTime: input.open_time,
          closeTime: input.close_time,
          deliveryFee: input.delivery_fee.toFixed(2),
          freeFirstDelivery: input.free_first_delivery,
          botTokenEnc: encryptBotToken(token),
          botId: checked.identity.id,
          botUsername: checked.identity.username,
          ownerChatId: ownerChatId ?? null,
          settingsUpdatedBy: signedInAdmin(res).id,
        })
        .returning();
      // The shop's first super admin, who then adds its other admins. A
      // temporary password, replaced at their first sign-in.
      const [admin] = await tx
        .insert(adminsTable)
        .values({
          shopId: shop.id,
          username,
          displayName: input.super_admin.display_name.trim(),
          role: "super_admin",
          passwordHash,
          mustChangePassword: true,
        })
        .returning();
      return { shop, admin };
    });
    forgetShops();
    // Not waited on: the new super admin's password is shown only once this
    // answers, and a slow Telegram must not cut that off. The bot's status
    // shows on the shop, with a button to try again.
    connectShopBotLater(created.shop, publicBaseUrl(req));
    return res.status(201).json({ shop: adminShopDto(created.shop), admin: adminAccountDto(created.admin) });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: "Bu slug, buyurtma prefiksi, bot yoki admin logini band" });
    }
    return next(error);
  }
});

router.patch("/admin/shops/:id", async (req, res, next) => {
  try {
    if (!requirePlatformSuperAdmin(res)) return;
    const { id } = UpdateAdminShopParams.parse(req.params);
    const input = UpdateAdminShopBody.parse(req.body);
    const shop = await loadShop(id);
    if (!shop) return res.status(404).json({ error: "Do‘kon topilmadi" });
    const platform = isPlatformShop(shop);

    const update: Partial<typeof shopsTable.$inferInsert> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 2) return res.status(400).json({ error: "Do‘kon nomi kamida 2 harf bo‘lsin" });
      update.name = name;
    }
    if (input.slug !== undefined) update.slug = input.slug;
    if (input.order_prefix !== undefined) update.orderPrefix = input.order_prefix;
    if (input.sort_order !== undefined) update.sortOrder = input.sort_order;
    if (input.active !== undefined) {
      if (platform && !input.active) return res.status(400).json({ error: "Q express'ni yashirib bo‘lmaydi" });
      if (isArchived(shop) && input.active) return res.status(409).json({ error: ARCHIVED });
      update.active = input.active;
    }
    if (input.open_time !== undefined || input.close_time !== undefined) {
      const openTime = input.open_time ?? shop.openTime;
      const closeTime = input.close_time ?? shop.closeTime;
      if (!isValidTime(openTime) || !isValidTime(closeTime)) {
        return res.status(400).json({ error: "Vaqt SS:DD ko‘rinishida bo‘lsin, masalan 06:00" });
      }
      update.openTime = openTime;
      update.closeTime = closeTime;
    }
    if (input.accepting_orders !== undefined) update.acceptingOrders = input.accepting_orders;
    if (input.delivery_fee !== undefined) update.deliveryFee = input.delivery_fee.toFixed(2);
    if (input.free_first_delivery !== undefined) update.freeFirstDelivery = input.free_first_delivery;
    if (input.owner_chat_id !== undefined) {
      if (platform) return res.status(400).json({ error: "Q express'ning asosiy chati Render sozlamalarida (TELEGRAM_ADMIN_CHAT_ID)" });
      const ownerChatId = cleanOwnerChat(input.owner_chat_id);
      if (ownerChatId === false) return res.status(400).json({ error: OWNER_CHAT_INVALID });
      update.ownerChatId = ownerChatId;
    }
    let botChanged = false;
    if (input.bot_token !== undefined && input.bot_token.trim() !== "") {
      if (platform) return res.status(400).json({ error: "Q express boti Render sozlamalarida o‘zgartiriladi" });
      const token = input.bot_token.trim();
      const checked = await checkBotToken(token, shop.id);
      if ("error" in checked) return res.status(400).json({ error: checked.error });
      update.botTokenEnc = encryptBotToken(token);
      update.botId = checked.identity.id;
      update.botUsername = checked.identity.username;
      botChanged = true;
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ error: "O‘zgarish yo‘q" });
    update.settingsUpdatedBy = signedInAdmin(res).id;
    update.settingsUpdatedAt = new Date();

    const [saved] = await db.update(shopsTable).set(update).where(eq(shopsTable.id, id)).returning();
    forgetShops();
    // A new bot, or a new path for the old one, needs Telegram told; an
    // archived shop's bot stays off until the shop is restored.
    if (!isArchived(saved) && (botChanged || (update.slug !== undefined && update.slug !== shop.slug && !platform))) {
      connectShopBotLater(saved, publicBaseUrl(req));
    }
    return res.json(adminShopDto(saved));
  } catch (error) {
    if (isUniqueViolation(error)) return res.status(409).json({ error: "Bu slug, buyurtma prefiksi yoki bot band" });
    return next(error);
  }
});

// When a bot's status shows it did not connect. Waited on here: nothing is
// lost if this request is cut off, and the answer carries the outcome.
router.post("/admin/shops/:id/bot", async (req, res, next) => {
  try {
    if (!requirePlatformSuperAdmin(res)) return;
    const { id } = ConnectAdminShopBotParams.parse(req.params);
    const shop = await loadShop(id);
    if (!shop) return res.status(404).json({ error: "Do‘kon topilmadi" });
    if (isArchived(shop)) return res.status(409).json({ error: ARCHIVED });
    if (isPlatformShop(shop)) await connectPlatformBot(publicBaseUrl(req));
    else await connectShopBot(shop, publicBaseUrl(req));
    return res.json(adminShopDto(shop));
  } catch (error) {
    return next(error);
  }
});

// "Deleting" a shop archives it (the owner's choice): it leaves the storefront
// and is hidden, its bot goes silent, its admins can no longer sign in, and
// its orders, chats and customers stay for the record. Only a platform super
// admin does it, after confirming in the dashboard, and may undo it.
router.post("/admin/shops/:id/archive", async (req, res, next) => {
  try {
    if (!requirePlatformSuperAdmin(res)) return;
    const { id } = ArchiveAdminShopParams.parse(req.params);
    const shop = await loadShop(id);
    if (!shop) return res.status(404).json({ error: "Do‘kon topilmadi" });
    if (isPlatformShop(shop)) return res.status(400).json({ error: "Q express'ni o‘chirib bo‘lmaydi" });
    if (isArchived(shop)) return res.json(adminShopDto(shop));
    const [saved] = await db
      .update(shopsTable)
      .set({ archivedAt: new Date(), active: false, settingsUpdatedBy: signedInAdmin(res).id, settingsUpdatedAt: new Date() })
      .where(eq(shopsTable.id, id))
      .returning();
    forgetShops();
    await disconnectShopBot(shop);
    req.log.info({ shopId: id, adminId: signedInAdmin(res).id }, "Shop archived");
    return res.json(adminShopDto(saved));
  } catch (error) {
    return next(error);
  }
});

// Back from the archive: its admins may sign in and its bot is connected
// again. It stays hidden until a platform super admin shows it.
router.post("/admin/shops/:id/restore", async (req, res, next) => {
  try {
    if (!requirePlatformSuperAdmin(res)) return;
    const { id } = RestoreAdminShopParams.parse(req.params);
    const shop = await loadShop(id);
    if (!shop) return res.status(404).json({ error: "Do‘kon topilmadi" });
    if (!isArchived(shop)) return res.json(adminShopDto(shop));
    const [saved] = await db
      .update(shopsTable)
      .set({ archivedAt: null, settingsUpdatedBy: signedInAdmin(res).id, settingsUpdatedAt: new Date() })
      .where(eq(shopsTable.id, id))
      .returning();
    forgetShops();
    if (saved.botTokenEnc !== null) connectShopBotLater(saved, publicBaseUrl(req));
    req.log.info({ shopId: id, adminId: signedInAdmin(res).id }, "Shop restored");
    return res.json(adminShopDto(saved));
  } catch (error) {
    return next(error);
  }
});

// Q express's admins (any of them) and the shop's own admins may change how
// the shop presents itself.
router.put("/admin/shops/:id/card", async (req, res, next) => {
  try {
    const { id } = UpdateShopCardParams.parse(req.params);
    const { card } = UpdateShopCardBody.parse(req.body);
    const admin = signedInAdmin(res);
    if (admin.shopId !== PLATFORM_SHOP_ID && admin.shopId !== id) {
      return res.status(403).json({ error: "Faqat o‘z do‘koningiz ko‘rinishini o‘zgartira olasiz" });
    }
    const [saved] = await db
      .update(shopsTable)
      .set({ card: cleanCard(card) })
      .where(eq(shopsTable.id, id))
      .returning();
    forgetShops();
    if (!saved) return res.status(404).json({ error: "Do‘kon topilmadi" });
    return res.json(adminShopDto(saved));
  } catch (error) {
    return next(error);
  }
});

export default router;
