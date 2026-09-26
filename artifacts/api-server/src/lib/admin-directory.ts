import { isNotNull } from "drizzle-orm";
import type { Response } from "express";
import { db } from "@workspace/db";
import { adminsTable } from "@workspace/db/schema";

export type AdminRow = typeof adminsTable.$inferSelect;

export function adminAccountDto(admin: AdminRow) {
  return {
    id: admin.id,
    username: admin.username,
    display_name: admin.displayName,
    role: admin.role as "super_admin" | "admin",
    must_change_password: admin.mustChangePassword,
    has_password: admin.passwordHash !== null,
    telegram_linked: admin.telegramChatId !== null,
    created_at: admin.createdAt.toISOString(),
  };
}

// Set by the /admin guard in routes/admins.ts for every authenticated request.
export function signedInAdmin(res: Response): AdminRow {
  const admin = res.locals.admin as AdminRow | undefined;
  if (!admin) throw new Error("signedInAdmin used outside the /admin guard");
  return admin;
}

export type TelegramRecipient = { chatId: string; adminId: number; displayName: string };

// Every admin who linked Telegram. The owner's chat from TELEGRAM_ADMIN_CHAT_ID
// is added by lib/telegram.ts itself, so it keeps working with no admin rows.
export async function linkedTelegramRecipients(): Promise<TelegramRecipient[]> {
  const rows = await db
    .select({ chatId: adminsTable.telegramChatId, adminId: adminsTable.id, displayName: adminsTable.displayName })
    .from(adminsTable)
    .where(isNotNull(adminsTable.telegramChatId));
  return rows.map((row) => ({ chatId: row.chatId!, adminId: row.adminId, displayName: row.displayName }));
}

export async function linkedTelegramChatIds() {
  return (await linkedTelegramRecipients()).map((recipient) => recipient.chatId);
}
