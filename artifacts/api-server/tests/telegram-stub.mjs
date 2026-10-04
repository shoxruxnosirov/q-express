import { appendFileSync } from "node:fs";

// Answers the Bot API as Telegram would. getMe names the bot, so sign-in links
// can be built; with TG_STUB_LOG set, every call is appended to that file so a
// test can read what the bot said.
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.telegram.org/")) {
    const method = String(url).split("/").pop();
    if (process.env.TG_STUB_LOG) {
      appendFileSync(process.env.TG_STUB_LOG, JSON.stringify({ method, body: init?.body ? JSON.parse(init.body) : null }) + "\n");
    }
    if (method === "getMe") {
      return new Response(JSON.stringify({ ok: true, result: { id: 424242, is_bot: true, username: "Q_express_bot" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  }
  throw new Error("Unexpected outbound request in integration test");
};
