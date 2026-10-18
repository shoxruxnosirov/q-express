import { Router, type IRouter, type Response } from "express";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
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
  adminShopView,
  telegramAdminCounts,
  effectiveBotId,
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
import { isOwnStoredImage } from "../lib/cloudinary";
import { discardStoredImage } from "../lib/stored-images";
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

// The bot a shop is to speak through. One bot may serve several shops: a
// shop may use Q express's bot or another shop's instead of one of its own.
// - A shop picked (bot_shop_id): that shop's bot, or its host's.
// - A token: asked of Telegram first, so a typo is caught here rather than as
//   a silent bot later. Q express's bot, or a bot another shop already has,
//   is taken as that bot (the owner's choice); else it is the shop's own.
type BotChoice =
  | { host: ShopRow }
  | { own: { token: string; id: string; username: string } }
  | { error: string };

async function chooseBot(input: { bot_token?: string; bot_shop_id?: number | null }, shopId?: number): Promise<BotChoice | undefined> {
  if (typeof input.bot_shop_id === "number") {
    let host = await loadShop(input.bot_shop_id);
    if (host && host.botShopId !== null) host = await loadShop(host.botShopId);
    if (!host || isArchived(host)) return { error: "Bot tanlangan do‘kon topilmadi" };
    if (host.id === shopId) return undefined;
    if (!isPlatformShop(host) && host.botTokenEnc === null) return { error: "Bu do‘konning o‘z boti yo‘q" };
    return { host };
  }
  const token = input.bot_token?.trim() ?? "";
  if (token === "") return undefined;
  if (!isBotTokenShape(token)) return { error: "Bot tokeni noto‘g‘ri ko‘rinishda (BotFather bergan 123456:ABC… ko‘rinishidagi token)" };
  // Both of Q express's bots, the one in use and the one the other bot mode
  // would switch to: by id, which needs no call to Telegram.
  const tokenId = token.split(":")[0];
  const activeId = envBotContext().token?.split(":")[0];
  if (tokenId === activeId) {
    const platform = await loadShop(PLATFORM_SHOP_ID);
    if (platform && shopId !== PLATFORM_SHOP_ID) return { host: platform };
  }
  // Q express's bot of the other TELEGRAM_BOT_MODE: it may become Q express's
  // again, so no shop takes it for its own.
  const otherIds = [process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_NEW_BOT_TOKEN].map((other) => other?.split(":")[0]);
  if (otherIds.includes(tokenId)) return { error: "Bu Q express'ning zaxira boti, uni do‘konga berib bo‘lmaydi. Q express botini «Mavjud bot» orqali tanlang." };
  const identity = await getBotIdentity(token);
  if (!identity) return { error: "Telegram bu tokenni tanimadi. Tokenni BotFather'dan qayta nusxalang." };
  const [taken] = await db
    .select()
    .from(shopsTable)
    .where(and(eq(shopsTable.botId, identity.id), shopId === undefined ? undefined : ne(shopsTable.id, shopId)))
    .limit(1);
  if (taken) {
    if (isArchived(taken)) return { error: "Bu bot arxivdagi do‘konga ulangan. Avval o‘sha do‘konni arxivdan qaytaring." };
    return { host: taken };
  }
  return { own: { token, id: identity.id, username: identity.username } };
}

// The bot columns for a choice: a host's bot, or the shop's own.
function botColumns(choice: { host: ShopRow } | { own: { token: string; id: string; username: string } }) {
  if ("host" in choice) {
    return { botShopId: choice.host.id, botTokenEnc: null, botId: null, botUsername: null };
  }
  return {
    botShopId: null,
    botTokenEnc: encryptBotToken(choice.own.token),
    botId: choice.own.id,
    botUsername: choice.own.username,
  };
}

const HOST_GONE = "Bot tanlangan do‘kon endi o‘z boti bilan ishlamayapti yoki arxivda. Sahifani yangilab, botni qayta tanlang.";

class BotHostGone extends Error {}

// Locks the shop whose bot another is to use and says whether it may host:
// in business, with a bot of its own (Q express always has one).
async function lockHost(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], hostId: number) {
  const [host] = await tx.select().from(shopsTable).where(eq(shopsTable.id, hostId)).for("update");
  return Boolean(host && host.archivedAt === null && host.botShopId === null && (isPlatformShop(host) || host.botTokenEnc !== null));
}

const HAS_GUESTS = "Bu do‘kon botidan boshqa do‘konlar ham foydalanadi. Avval ularni boshqa botga o‘tkazing.";

function cleanOwnerChat(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const chat = value?.trim() ?? "";
  if (chat === "") return null;
  return /^[1-9]\d{0,19}$/.test(chat) ? chat : false;
}

const ARCHIVED = "Do‘kon arxivlangan. Avval uni arxivdan qaytaring.";

const OWNER_CHAT_INVALID = "Egasining chat ID raqami musbat son bo‘lsin (shaxsiy chat), masalan 123456789";

const IMAGE_NOT_OURS = "Rasm manzili yuklangan faylga mos kelmadi. Rasmni qaytadan yuklang.";

type ImageInput = { url: string; public_id: string } | null | undefined;

// A shop's background or icon as columns: undefined leaves it as it is, null
// removes it, and a new one must be a file of our own Cloudinary account.
function imageColumns(input: ImageInput, url: "backgroundUrl" | "iconUrl", publicId: "backgroundPublicId" | "iconPublicId") {
  if (input === undefined) return {};
  if (input === null) return { [url]: null, [publicId]: null };
  if (!isOwnStoredImage(input.url, input.public_id)) return false;
  return { [url]: input.url, [publicId]: input.public_id };
}

function shopImages(input: { background?: ImageInput; icon?: ImageInput }) {
  const background = imageColumns(input.background, "backgroundUrl", "backgroundPublicId");
  const icon = imageColumns(input.icon, "iconUrl", "iconPublicId");
  if (background === false || icon === false) return false;
  return { ...background, ...icon } as Partial<typeof shopsTable.$inferInsert>;
}

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
    const telegramAdmins = await telegramAdminCounts();
    res.json(visible.sort(platformFirst).map((shop) => adminShopDto(shop, shops, telegramAdmins)));
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
    const images = shopImages(input);
    if (images === false) return res.status(400).json({ error: IMAGE_NOT_OURS });
    const bot = await chooseBot(input);
    if (!bot) return res.status(400).json({ error: "Bot tanlang: yangi bot tokeni, Q express boti yoki boshqa do‘kon boti" });
    if ("error" in bot) return res.status(400).json({ error: bot.error });

    const passwordHash = await hashPassword(input.super_admin.temporary_password);
    const created = await db.transaction(async (tx) => {
      if ("host" in bot && !(await lockHost(tx, bot.host.id))) throw new BotHostGone();
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
          ...images,
          openTime: input.open_time,
          closeTime: input.close_time,
          deliveryFee: input.delivery_fee.toFixed(2),
          freeFirstDelivery: input.free_first_delivery,
          ...botColumns(bot),
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
    return res.status(201).json({ shop: await adminShopView(created.shop), admin: adminAccountDto(created.admin) });
  } catch (error) {
    if (error instanceof BotHostGone) return res.status(409).json({ error: HOST_GONE });
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
    const wantsBot = (input.bot_token !== undefined && input.bot_token.trim() !== "") || input.bot_shop_id !== undefined;
    if (wantsBot) {
      if (platform) return res.status(400).json({ error: "Q express boti Render sozlamalarida o‘zgartiriladi" });
      const bot = await chooseBot(input, shop.id);
      if (bot && "error" in bot) return res.status(400).json({ error: bot.error });
      if (bot) {
        Object.assign(update, botColumns(bot));
        botChanged = true;
      } else if (input.bot_shop_id === null && shop.botShopId !== null) {
        // Back to a bot of its own: that needs its token.
        return res.status(400).json({ error: "Do‘konning o‘z boti uchun BotFather bergan tokenni kiriting" });
      }
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ error: "O‘zgarish yo‘q" });
    update.settingsUpdatedBy = signedInAdmin(res).id;
    update.settingsUpdatedAt = new Date();

    const shopsBefore = await listShops();
    const botBefore = effectiveBotId(shop, shopsBefore);
    // The shops on this one's bot, archived ones too: their links follow it.
    const followers = shopsBefore.filter((row) => row.botShopId === id).map((row) => row.id);
    const outcome = await db.transaction(async (tx) => {
      // Both rows locked at once, in id order, so two shops joining each
      // other's bot at the same moment wait in turn rather than deadlock.
      const lockIds = typeof update.botShopId === "number" ? [id, update.botShopId] : [id];
      const locked = await tx.select().from(shopsTable).where(inArray(shopsTable.id, lockIds)).orderBy(asc(shopsTable.id)).for("update");
      const current = locked.find((row) => row.id === id);
      if (!current) return "missing" as const;
      if (typeof update.botShopId === "number") {
        // Joining another shop's bot: that shop has a bot of its own and is in
        // business, and no shop in business uses this one's bot. Shops in the
        // archive that did move along, so no shop is ever two bots away.
        if (!(await lockHost(tx, update.botShopId))) return "host-gone" as const;
        const [guest] = await tx
          .select({ id: shopsTable.id })
          .from(shopsTable)
          .where(and(eq(shopsTable.botShopId, id), isNull(shopsTable.archivedAt)))
          .limit(1);
        if (guest) return "has-guests" as const;
        await tx.update(shopsTable).set({ botShopId: update.botShopId }).where(eq(shopsTable.botShopId, id));
      }
      const [row] = await tx.update(shopsTable).set(update).where(eq(shopsTable.id, id)).returning();
      return row;
    });
    if (outcome === "missing") return res.status(404).json({ error: "Do‘kon topilmadi" });
    if (outcome === "host-gone") return res.status(409).json({ error: HOST_GONE });
    if (outcome === "has-guests") return res.status(409).json({ error: HAS_GUESTS });
    const saved = outcome;
    forgetShops();
    // Another bot now: the chats linked through the old one never started this
    // one, so Telegram would refuse every message to them. Those links are
    // dropped (the admins link again from "Profilim"), for this shop and the
    // shops on its bot; the dashboard says so.
    const shopsAfter = await listShops();
    if (botChanged && effectiveBotId(saved, shopsAfter) !== botBefore) {
      await db
        .update(adminsTable)
        .set({ telegramChatId: null, telegramLinkHash: null, telegramLinkExpiresAt: null })
        .where(inArray(adminsTable.shopId, [saved.id, ...followers]));
    }
    // A new bot, or a new path for the old one, needs Telegram told; an
    // archived shop's bot stays off until the shop is restored.
    if (!isArchived(saved) && (botChanged || (update.slug !== undefined && update.slug !== shop.slug && !platform))) {
      connectShopBotLater(saved, publicBaseUrl(req));
    }
    // Its own bot left for another shop's: the old bot stops calling here.
    if (botChanged && shop.botShopId === null && shop.botTokenEnc !== null && saved.botShopId !== null) {
      void disconnectShopBot(shop);
    }
    return res.json(await adminShopView(saved));
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
    return res.json(await adminShopView(shop));
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
    if (isArchived(shop)) return res.json(await adminShopView(shop));
    const saved = await db.transaction(async (tx) => {
      await tx.select({ id: shopsTable.id }).from(shopsTable).where(eq(shopsTable.id, id)).for("update");
      const [guest] = await tx
        .select({ id: shopsTable.id })
        .from(shopsTable)
        .where(and(eq(shopsTable.botShopId, id), isNull(shopsTable.archivedAt)))
        .limit(1);
      if (guest) return undefined;
      const [row] = await tx
        .update(shopsTable)
        .set({ archivedAt: new Date(), active: false, settingsUpdatedBy: signedInAdmin(res).id, settingsUpdatedAt: new Date() })
        .where(eq(shopsTable.id, id))
        .returning();
      return row;
    });
    if (!saved) return res.status(409).json({ error: HAS_GUESTS });
    forgetShops();
    await disconnectShopBot(shop);
    req.log.info({ shopId: id, adminId: signedInAdmin(res).id }, "Shop archived");
    return res.json(await adminShopView(saved));
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
    if (!isArchived(shop)) return res.json(await adminShopView(shop));
    // A shop on another shop's bot needs that shop in business: an archived
    // host's bot is silent, and the restored shop would be too. Checked under
    // the rows' locks (in id order), so an archive of the host at the same
    // moment waits for this, or this for it.
    const saved = await db.transaction(async (tx) => {
      const lockIds = shop.botShopId !== null ? [id, shop.botShopId] : [id];
      const locked = await tx.select().from(shopsTable).where(inArray(shopsTable.id, lockIds)).orderBy(asc(shopsTable.id)).for("update");
      const current = locked.find((row) => row.id === id);
      if (!current) return undefined;
      if (current.botShopId !== null) {
        const host = locked.find((row) => row.id === current.botShopId);
        if (!host || host.archivedAt !== null || host.botShopId !== null) return "host-gone" as const;
      }
      const [row] = await tx
        .update(shopsTable)
        .set({ archivedAt: null, settingsUpdatedBy: signedInAdmin(res).id, settingsUpdatedAt: new Date() })
        .where(eq(shopsTable.id, id))
        .returning();
      return row;
    });
    if (!saved) return res.status(404).json({ error: "Do‘kon topilmadi" });
    if (saved === "host-gone") {
      return res.status(409).json({ error: "Bu do‘kon arxivdagi do‘kon botidan foydalanadi. Avval o‘sha do‘konni qaytaring yoki bu do‘konga boshqa bot tanlang." });
    }
    forgetShops();
    if (saved.botTokenEnc !== null) connectShopBotLater(saved, publicBaseUrl(req));
    req.log.info({ shopId: id, adminId: signedInAdmin(res).id }, "Shop restored");
    return res.json(await adminShopView(saved));
  } catch (error) {
    return next(error);
  }
});

// Q express's admins (any of them) and the shop's own admins may change how
// the shop presents itself.
router.put("/admin/shops/:id/card", async (req, res, next) => {
  try {
    const { id } = UpdateShopCardParams.parse(req.params);
    const input = UpdateShopCardBody.parse(req.body);
    const admin = signedInAdmin(res);
    if (admin.shopId !== PLATFORM_SHOP_ID && admin.shopId !== id) {
      return res.status(403).json({ error: "Faqat o‘z do‘koningiz ko‘rinishini o‘zgartira olasiz" });
    }
    const images = shopImages(input);
    if (images === false) return res.status(400).json({ error: IMAGE_NOT_OURS });
    // The files in use before, read in the same transaction as the change, so
    // a replaced one is known for certain.
    const result = await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ background: shopsTable.backgroundPublicId, icon: shopsTable.iconPublicId })
        .from(shopsTable)
        .where(eq(shopsTable.id, id))
        .for("update");
      if (!before) return undefined;
      const [saved] = await tx
        .update(shopsTable)
        .set({ card: cleanCard(input.card), ...images })
        .where(eq(shopsTable.id, id))
        .returning();
      return { before, saved };
    });
    forgetShops();
    if (!result) return res.status(404).json({ error: "Do‘kon topilmadi" });
    const { before, saved } = result;
    // A replaced or removed picture goes once nothing else uses it.
    if (before.background !== saved.backgroundPublicId) await discardStoredImage(req.log, before.background);
    if (before.icon !== saved.iconPublicId) await discardStoredImage(req.log, before.icon);
    return res.json(await adminShopView(saved));
  } catch (error) {
    return next(error);
  }
});

export default router;
