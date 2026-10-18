-- A shop may speak through another shop's bot instead of one of its own:
-- Q express's (shop 1) or any shop's that has its own token. Telegram sends
-- that bot's updates to its host's webhook, which also serves the shops on it.
-- NULL is the shop's own bot (bot_token_enc), as every shop had before.
ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "bot_shop_id" integer REFERENCES "shops"("id");
