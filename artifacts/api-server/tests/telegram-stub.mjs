import { appendFileSync } from "node:fs";

// Answers the Bot API as Telegram would. getMe names the bot, so sign-in links
// can be built: the bot's id is the token's first part, and Q express's test
// bot (424242) is @Q_express_bot, any other @bot<id>_bot. With TG_STUB_LOG
// set, every call is appended to that file, with the id of the bot that made
// it, so a test can read what each bot said. Cloudinary deletes are answered
// and logged too.
// Each message sent gets an id of its own, as Telegram gives, and the log
// names it.
let nextMessageId = 5000;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.telegram.org/")) {
    const [, token = "", method = ""] = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(String(url)) ?? [];
    const botId = Number(token.split(":")[0]);
    const messageId = nextMessageId++;
    if (process.env.TG_STUB_LOG) {
      appendFileSync(process.env.TG_STUB_LOG, JSON.stringify({ bot: botId, method, body: init?.body ? JSON.parse(init.body) : null, messageId }) + "\n");
    }
    if (method === "getMe") {
      if (token.includes("unknown")) return new Response(JSON.stringify({ ok: false, error_code: 401 }), { status: 401 });
      const username = botId === 424242 ? "Q_express_bot" : `bot${botId}_bot`;
      return new Response(JSON.stringify({ ok: true, result: { id: botId, is_bot: true, username } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: messageId } }), { status: 200 });
  }
  // Cloudinary deleting a stored picture: logged as { cloudinary, public_id }.
  if (/^https:\/\/api\.cloudinary\.com\/v1_1\/[^/]+\/image\/destroy$/.test(String(url))) {
    const publicId = new URLSearchParams(String(init?.body ?? "")).get("public_id");
    if (process.env.TG_STUB_LOG) appendFileSync(process.env.TG_STUB_LOG, JSON.stringify({ cloudinary: "destroy", public_id: publicId }) + "\n");
    return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
  }
  throw new Error("Unexpected outbound request in integration test");
};
