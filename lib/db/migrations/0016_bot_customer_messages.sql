-- The messages a bot sent a customer on behalf of a conversation (an admin's
-- answer, the copy of what they wrote in the Mini App). On a bot several shops
-- share, a customer's answer in Telegram names the message it answers, and
-- this says whose conversation that was. Kept for the conversation's life.
CREATE TABLE IF NOT EXISTS "bot_customer_messages" (
  "bot_id" text NOT NULL,
  "chat_id" text NOT NULL,
  "message_id" integer NOT NULL,
  "thread_id" integer NOT NULL REFERENCES "chat_threads"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("bot_id", "chat_id", "message_id")
);
CREATE INDEX IF NOT EXISTS "bot_customer_messages_thread_idx" ON "bot_customer_messages" ("thread_id");
