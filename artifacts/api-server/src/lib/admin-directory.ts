import { and, eq, isNotNull } from "drizzle-orm";
import type { Response } from "express";
import { db } from "@workspace/db";
import { adminsTable, PLATFORM_SHOP_ID } from "@workspace/db/schema";

export type AdminRow = typeof adminsTable.$inferSelect;

export function adminAccountDto(admin: AdminRow) {
  return {
    id: admin.id,
    username: admin.username,
    display_name: admin.displayName,
    role: admin.role as "super_admin" | "admin",
    shop_id: admin.shopId,
    platform_super_admin: isPlatformSuperAdmin(admin),
    must_change_password: admin.mustChangePassword,
    has_password: admin.passwordHash !== null,
    telegram_linked: admin.telegramChatId !== null,
    created_at: admin.createdAt.toISOString(),
  };
}

// A super admin of Q express runs the platform: creates shops, sets every
// shop's hours and delivery fee, and may act inside any shop.
export function isPlatformSuperAdmin(admin: Pick<AdminRow, "role" | "shopId">) {
  return admin.role === "super_admin" && admin.shopId === PLATFORM_SHOP_ID;
}

// Set by the /admin guard in routes/admins.ts for every authenticated request.
export function signedInAdmin(res: Response): AdminRow {
  const admin = res.locals.admin as AdminRow | undefined;
  if (!admin) throw new Error("signedInAdmin used outside the /admin guard");
  return admin;
}

// The shop an admin request acts in, also set by the guard: the admin's own,
// or, for a platform super admin, the one they switched to.
export function adminShopId(res: Response): number {
  const shopId = res.locals.shopId as number | undefined;
  if (shopId === undefined) throw new Error("adminShopId used outside the /admin guard");
  return shopId;
}

export type TelegramRecipient = { chatId: string; adminId: number; displayName: string };

// Every admin of a shop who linked Telegram. The shop owner's chat (for Q
// express TELEGRAM_ADMIN_CHAT_ID) is added by lib/telegram.ts itself, so it
// keeps working with no admin rows.
export async function linkedTelegramRecipients(shopId: number): Promise<TelegramRecipient[]> {
  const rows = await db
    .select({ chatId: adminsTable.telegramChatId, adminId: adminsTable.id, displayName: adminsTable.displayName })
    .from(adminsTable)
    .where(and(eq(adminsTable.shopId, shopId), isNotNull(adminsTable.telegramChatId)));
  return rows.map((row) => ({ chatId: row.chatId!, adminId: row.adminId, displayName: row.displayName }));
}

export async function linkedTelegramChatIds(shopId: number) {
  return (await linkedTelegramRecipients(shopId)).map((recipient) => recipient.chatId);
}
