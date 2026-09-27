import { and, eq, gt, inArray, isNotNull, isNull, lte, notInArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { ordersTable } from "@workspace/db/schema";
import { linkedTelegramChatIds } from "./admin-directory";
import { logger } from "./logger";
import { formatTashkent } from "./store-hours";
import { sendPreorderReminder } from "./telegram";

// Admins get a Telegram nudge 15 minutes before a pre-order is due.
//
// The check runs every minute inside this process. On Render's free plan the
// process sleeps after fifteen idle minutes and nothing runs while it sleeps,
// so reminders are only on time while something keeps it awake (an uptime
// ping every few minutes). A reminder missed while asleep is still sent on
// waking if the order is at most half an hour overdue; older ones are marked
// and skipped, since a reminder hours late would only be noise.

export const REMINDER_LEAD_MINUTES = 15;
const STALE_AFTER_MINUTES = 30;
const DEFAULT_INTERVAL_MS = 60 * 1000;
const MINUTE_MS = 60 * 1000;

export async function sendDueReminders(now = new Date()) {
  const dueBy = new Date(now.getTime() + REMINDER_LEAD_MINUTES * MINUTE_MS);
  const staleBefore = new Date(now.getTime() - STALE_AFTER_MINUTES * MINUTE_MS);
  const open = ["new", "preparing", "courier"];

  // Too late to be useful: marked so they are not considered again.
  await db
    .update(ordersTable)
    .set({ reminderSentAt: now })
    .where(and(
      isNotNull(ordersTable.scheduledFor),
      isNull(ordersTable.reminderSentAt),
      lte(ordersTable.scheduledFor, staleBefore),
    ));

  // Claimed by setting reminder_sent_at in the same statement that finds
  // them, so a reminder goes out once even if two checks overlap.
  const due = await db
    .update(ordersTable)
    .set({ reminderSentAt: now })
    .where(and(
      isNotNull(ordersTable.scheduledFor),
      isNull(ordersTable.reminderSentAt),
      lte(ordersTable.scheduledFor, dueBy),
      gt(ordersTable.scheduledFor, staleBefore),
      inArray(ordersTable.status, open),
    ))
    .returning();
  // A cancelled or delivered pre-order needs no reminder; mark it too.
  await db
    .update(ordersTable)
    .set({ reminderSentAt: now })
    .where(and(
      isNotNull(ordersTable.scheduledFor),
      isNull(ordersTable.reminderSentAt),
      lte(ordersTable.scheduledFor, dueBy),
      notInArray(ordersTable.status, open),
    ));

  if (due.length === 0) return 0;
  const chats = await linkedTelegramChatIds();
  let sent = due.length;
  for (const order of due) {
    const minutesLeft = Math.ceil((order.scheduledFor!.getTime() - now.getTime()) / MINUTE_MS);
    const result = await sendPreorderReminder(
      {
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        phone: order.phone,
        address: order.address,
        total: order.total,
        scheduledLabel: formatTashkent(order.scheduledFor!),
        minutesLeft,
      },
      chats,
    );
    if (!result.sent) {
      // Reached no chat at all (Telegram down, a timeout): released, so the
      // next check tries again. It still stops once the order is half an
      // hour past its time, when the stale rule above marks it.
      logger.warn({ orderId: order.id, reason: result.error }, "Pre-order reminder failed, will retry");
      await db.update(ordersTable).set({ reminderSentAt: null }).where(eq(ordersTable.id, order.id));
      sent -= 1;
    }
  }
  return sent;
}

// Started once, after the server is listening. REMINDER_INTERVAL_MS exists
// for tests; production uses a minute.
export function startPreorderReminders() {
  const interval = Number(process.env.REMINDER_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const sent = await sendDueReminders();
      if (sent) logger.info({ sent }, "Pre-order reminders sent");
    } catch (error) {
      logger.error({ error }, "Pre-order reminder check failed");
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(tick, interval);
}
