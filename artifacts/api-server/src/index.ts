import { setTimeout as sleep } from "node:timers/promises";
import app from "./app";
import { logger } from "./lib/logger";
import { startPreorderReminders } from "./lib/preorder-reminders";
import { connectPlatformBot, connectShopBot, otherShopsWithBots } from "./lib/shops";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Every minute: remind the admins 15 minutes before a pre-order is due.
  startPreorderReminders();


  // Point the bots at this server so replies written in Telegram reach the
  // customer. Render supplies RENDER_EXTERNAL_URL to every web service;
  // PUBLIC_BASE_URL overrides it elsewhere. Unset in development, where
  // Telegram could not reach this machine anyway.
  const publicUrl = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  if (publicUrl) {
    // Q express's bot comes from the environment, so it never waits on the
    // database, which may still be waking up.
    void connectPlatformBot(publicUrl);
    void connectOtherShopBots(publicUrl);
  }
});

// The other shops' bots are stored with their shop. A database that does not
// answer yet is asked again a few times rather than leaving the shops' bots
// unconnected until the next deploy.
const RETRY_DELAYS_MS = [10_000, 30_000, 60_000, 120_000, 300_000];

async function connectOtherShopBots(publicUrl: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      const shops = await otherShopsWithBots();
      for (const shop of shops) await connectShopBot(shop, publicUrl);
      // deploy/oracle's --go-live waits for this line.
      logger.info({ shops: shops.length }, "Shop bots checked");
      return;
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        logger.error({ error }, "Shop bots not registered");
        return;
      }
      logger.warn({ error, retryInMs: delay }, "Shop bots not registered yet, trying again");
      await sleep(delay);
    }
  }
}
