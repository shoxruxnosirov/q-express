-- Customer to operator chat.
--
-- The shop has no accounts, so a thread is owned by a secret this browser
-- holds, not by a phone number. Only the SHA-256 of that secret is stored, so
-- a leaked database still does not grant access to anyone's conversation.
-- Keying on the phone number instead would have let anybody who knows a phone
-- number read that customer's messages.
--
-- Idempotent: an existing database is left untouched.
CREATE TABLE IF NOT EXISTS "chat_threads" (
  "id" serial PRIMARY KEY,
  "token_hash" text NOT NULL UNIQUE,
  "customer_name" text NOT NULL DEFAULT '',
  "phone" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_message_at" timestamp with time zone NOT NULL DEFAULT now(),
  -- When each side last opened the thread, which is what drives the unread
  -- badge on the operator dashboard.
  "operator_read_at" timestamp with time zone,
  "customer_read_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" serial PRIMARY KEY,
  "thread_id" integer NOT NULL REFERENCES "chat_threads"("id") ON DELETE CASCADE,
  -- 'customer' or 'operator'.
  "sender" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Messages are always read one thread at a time, in id order.
CREATE INDEX IF NOT EXISTS "chat_messages_thread_idx" ON "chat_messages" ("thread_id", "id");
-- The operator's list is ordered by most recent activity.
CREATE INDEX IF NOT EXISTS "chat_threads_recent_idx" ON "chat_threads" ("last_message_at" DESC);
