import app from "./app";
import { logger } from "./lib/logger";
import { startPreorderReminders } from "./lib/preorder-reminders";
import { registerMenuButton, registerWebhook } from "./lib/telegram";

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

  // Point the bot at this server so replies written in Telegram reach the
  // customer. Render supplies RENDER_EXTERNAL_URL to every web service;
  // PUBLIC_BASE_URL overrides it elsewhere. Unset in development, where
  // Telegram could not reach this machine anyway.
  const publicUrl = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  if (publicUrl) {
    registerWebhook(publicUrl).then((result) => {
      if (result.sent) logger.info("Telegram webhook registered");
      else logger.warn({ reason: result.error }, "Telegram webhook not registered");
    });
    registerMenuButton(publicUrl).then((result) => {
      if (result.sent) logger.info("Telegram menu button set");
      else logger.warn({ reason: result.error }, "Telegram menu button not set");
    });
  }
});
