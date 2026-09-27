# Qorasuv Express

Qorasuv Express is a Telegram-ready grocery delivery web app for browsing fresh products, placing orders, tracking delivery, and operating the store.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- `pnpm --filter @workspace/qorasuv-express run test` — profile storage checks
- Product image uploads need `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`. Without them the catalog still serves existing images and `POST /api/admin/uploads/signature` answers 503.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/qorasuv-express` — customer-facing web app and `/admin` operator dashboard
- `artifacts/api-server/src/routes/store.ts` — catalog, order, and dashboard API routes
- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/db/src/schema/store.ts` — PostgreSQL schema for catalog, users, and orders
- `artifacts/qorasuv-express/src/index.css` — Qorasuv Express theme tokens and motion utilities

## Architecture decisions

- The first build uses the workspace PostgreSQL database and Drizzle rather than an external Supabase dependency.
- The customer cart is intentionally local-first; order creation, stock validation, stock decrement, and admin status updates are server-backed.
- Orders are private to the customer who placed them (see customer accounts below). Placing an order sets a rolling 180-day httpOnly `qorasuv_customer` cookie holding a random secret, and the order stores only its SHA-256 in `orders.customer_token_hash`, the same scheme as the chat. `GET /orders` lists only that browser's orders and `GET /orders/:id` answers 404 for anyone else's, so ids cannot be probed. Orders placed before this existed have a NULL hash and appear only on the dashboard. A customer on a new phone or with cleared cookies starts an empty history; there are no accounts to recover it from.
- Customer accounts: a browser that orders or saves its profile becomes a `users` row, tied to the browser by `customer_sessions` (the `qorasuv_customer` cookie holds a random secret, the table its SHA-256; one customer may have several devices). Name, phone and up to five `customer_addresses` live in the database. Orders carry `orders.user_id`; `customer_token_hash` only lets a browser from before accounts be adopted on first sight, with its orders and addresses.
- Phone verification is optional and goes through the bot: the site opens `t.me/<bot>?start=login`, the customer taps Telegram's own contact button, the bot checks the contact is the sender's own (`contact.user_id === from.id`) and replies with a six-digit code (only its hash kept in `phone_login_codes`, five minutes, five guesses, five codes an hour per Telegram account), and the customer enters phone and code on the site. Verifying on another device folds that browser's unverified account into the verified one: orders, addresses and chat. Two verified accounts are never merged.
- The first delivery is free once per phone and only for a phone verified on the ordering browser; unverified customers pay the fee and are offered verification at checkout (`verification_required` on the fee estimate). Phones are stored as `998XXXXXXXXX`; migration 0007 rewrote older nine-digit and `8`-prefixed numbers.
- "Mijozlar" on the dashboard lists every customer account with order count, total, last order and saved addresses.
- Opening hours live in the one-row `store_settings` table ("HH:MM" on the Tashkent clock, 06:00–23:00 by default; a closing time at or before the opening time runs past midnight, equal times mean all day) and any admin sets them on the dashboard, along with a switch that pauses all orders. An order for right now is taken only while open. A pre-order (`orders.scheduled_for`) picks a half-hour slot inside the hours, from half an hour ahead through the end of the day after tomorrow; `GET /api/store/status` lists the slots and `lib/store-hours.ts` holds the rules the server re-checks (a slot listed a few minutes earlier is still honoured). Pre-orders are marked on the dashboard and lead their Telegram notification with the delivery time; the storefront shows a banner while closed. Stock is reserved when the order is placed, pre-order or not.
- Order-rule and hours checks: `node --test artifacts/api-server/tests/store-hours.test.mjs`.
- The shop is also a Telegram Mini App. A bare /start gets a photo welcome (the brand banner, the promises, up to three live discounts from the catalogue) with web-app buttons to the shop, the discounts (`/catalog?sort=discount`) and "Buyurtmalarim"; the bot's menu button opens the shop too (`setChatMenuButton`, set on every start next to the webhook). No BotFather setup is needed for web-app buttons.
- Inside Telegram the webview has no cookies of the phone's browser, so the Mini App posts Telegram's signed `initData` to `POST /api/customer/telegram`; the server checks the HMAC with the bot token (and that it is under an hour old) and, if that Telegram account belongs to a verified customer, signs the webview in, folding in any unverified account it had. No Telegram script is loaded: `lib/telegram-mini-app.ts` reads `tgWebAppData` from the URL fragment when the page loads (and keeps it in sessionStorage, since a reload inside Telegram can drop the fragment), and talks to the client through the documented web events (`TelegramWebviewProxy.postEvent` in the apps, `postMessage` to the parent on Telegram Web) to signal ready, expand, set colours and open t.me links. The earlier `document.write` of telegram-web-app.js could be blocked by Chrome on slow networks, silently turning off sign-in.
- Order numbers come from the orders id sequence (`QE-0000123`, seven digits so they never equal the older six-digit clock-based ones), so two orders can never share a number.
- Status moves one way: new → preparing → courier → delivered, and cancelling is allowed at any point before delivery. Delivered and cancelled are final. Cancelling returns each line's quantity to stock inside a transaction that locks the order row, so two admins cancelling at once return it once. Every change records the admin (`orders.status_changed_by`), shown on the dashboard.
- A hidden product (`active = false`) can be neither opened by link nor ordered, even from a cart that still holds it. The catalog is seeded only when there are no categories, so deleting every product leaves an empty catalog rather than a reseed that collides with existing slugs.
- "Today" on the dashboard and the leaderboard's week follow Tashkent time (UTC+5); the server runs in UTC.
- The dashboard keeps an admin's session for its eight hours instead of signing out on every visit, now that each admin has their own password; "Chiqish" clears every operator query so the next person on the device sees nothing of the previous one's.
- Order rule checks: `node --test artifacts/api-server/tests/order-rules.test.mjs`.
- OpenAPI remains the contract source and generated React Query hooks are used by the web app.
- Telegram admin notifications use the backend Bot API client and `TELEGRAM_ADMIN_CHAT_ID`; secrets never enter frontend bundles or logs. `TELEGRAM_BOT_MODE=new` selects `TELEGRAM_NEW_BOT_TOKEN` for @Q_express_bot; `legacy` (the default) selects the preserved `TELEGRAM_BOT_TOKEN`. Missing credentials never trigger fallback to a different bot. Activate the new mode only after checking bot identity and sending a test message to the configured admin chat. Existing chats, subscribers, and links do not migrate automatically.
- Product images are uploaded from the operator browser straight to Cloudinary. The API only signs one upload at a time and stores `products.image_public_id` next to the URL; the image bytes never pass through the server. Replacing an image or deleting a product retires the previous file, and that delete is best effort so a Cloudinary outage can never leave a product pointing at a missing image. A NULL public id means the row still holds somebody else's link and there is nothing of ours to delete.
- Products carry three operator flags: `active` hides a product from the storefront without deleting it, `is_popular` drives the home page and the catalog default sort, and `is_new` drives the badge and the newest sort. Because `/products` filters on `active`, the operator list reads `GET /api/admin/products`, which returns every product with its visibility; without that a hidden product could never be found again to bring back. Category product counts filter on `active` too, so the badge never promises more than the category lists.
- Delivery addresses are picked, not typed: checkout and the profile both show a dom select and a xonadon select, and the pair is composed into the single `address` string the order carries, so the API contract is unchanged. `lib/address.ts` holds the two option lists, and they are the shop’s configuration: plain ranges to start with, meant to be narrowed to the buildings actually served. A value no longer offered is cleared rather than shown, and a typed address stored by an earlier build is parsed back into the two parts when it matches, so a returning customer keeps it. A consequence to weigh: an address outside a block of flats, such as a private house or a street name, can no longer be entered.
- Customer to operator chat is permanent, not scoped to an order. A thread is owned by a secret the browser holds in an httpOnly cookie, and only its SHA-256 reaches the database, so a leaked dump grants access to nobody. Keying on the phone number instead would have let anyone who knows a number read that customer’s messages, which matters because phone numbers are no secret. Both sides poll rather than hold a socket, because the free instance sleeps after fifteen idle minutes. A customer message also reaches the Telegram admin chat, escaped, since the operator is not always watching the dashboard.
- Opening a chat is the only chat call that needs no cookie, so it is the one a script can repeat from nothing: it is limited to ten new threads an hour per address, on top of the twenty messages a minute per thread. The message limit alone could never catch it, because a script that opens a thread per message meets an empty counter every time. Both limits live in `artifacts/api-server/src/lib/rate-window.ts` and are held in memory — a limit that cost a query per request would itself be the cheapest way to take the free instance down — so a restart forgives everyone. Expired windows are swept and the map is hard-capped, because the keys are caller-supplied and must not grow it without bound.
- `app.set("trust proxy", 1)` in production: Render forwards to this process, so the socket address is always their proxy and, untrusted, every caller would share one rate-limit bucket and the first flood would lock out the whole town. Exactly one hop, so a caller cannot name its own address in `X-Forwarded-For` and shed the limits.
- The chat cookie is rolling: every request presenting a usable token has its 180 days written again, so a customer who keeps visiting never loses the conversation while a browser that stops visiting still expires. A cookie carries no age of its own, so there is nothing cheaper to test against than refreshing it each time.
- Chat regression checks: `node --test artifacts/api-server/tests/chat-session.test.mjs artifacts/api-server/tests/rate-window.test.mjs`.
- Admin account checks: `node --test artifacts/api-server/tests/admin-auth.test.mjs`.
- The customer profile is browser-local by design. There are no accounts: orders carry the name, phone and address directly and `users` is never written, so `lib/profile.ts` keeps the name, phone and up to five delivery addresses (most recent first) in localStorage purely to stop the customer retyping them. Checkout lists the saved addresses, merged with those of this browser's own past orders, preselects the latest and offers "Yangi manzil"; the address an order goes to moves to the front. Addresses are never looked up by phone number, since that would show anyone's address to whoever types their number. Checkout prefills from it and writes back before sending the order, so a rejected order keeps the details. The old name-only key is migrated on read and kept in step on write, so a tab still running an older bundle does not hand back a stale name.
- Telegram is deliberately NOT used to store images: the Bot Platform developer terms, section 5.2(e), forbid pairing a bot with an external frontend to build storage, and a ban would take order notifications down with the catalog.
- Image storage regression checks: `node --test artifacts/api-server/tests/cloudinary.test.mjs`.
- Telegram notification regression checks: `node --test artifacts/api-server/tests/telegram.test.mjs`.
- Every admin signs in with their own username and password (`admins` table, scrypt hashes from node:crypto). Roles are `super_admin`, who can create and delete admins and super admins but never the last super admin, and `admin`, who runs the shop. The super admins `shoxrux` and `bahrom` are seeded by migration 0005 WITHOUT a password, because this repository is public and even a hash can be cracked offline; each chooses their first password once at `/admin/setup` by proving `ADMIN_ACCESS_CODE`, which is otherwise no longer a login. A new admin gets a generated temporary password and can do nothing until replacing it; every admin changes their own password on "Profilim". The session cookie names the admin and a session version that is checked against the database on every request, so a password change, a reset or a deletion signs that admin out everywhere at once. Failed sign-in attempts are limited per address (10 per 15 minutes) and per username (30); successes are never charged, because the dashboard asks for the password on every visit and staff may share the shop's one Wi-Fi address.
- Telegram notifications go to the owner chat from `TELEGRAM_ADMIN_CHAT_ID` plus every admin who linked Telegram on "Profilim": the dashboard hands out a one-time `t.me/<bot>?start=<code>` link (30 minutes, only its SHA-256 stored), and pressing Start there records that chat. Any of those chats may answer a customer by replying; the reply is copied to the others with the author's name, and the dashboard shows who wrote each reply. Customers never see admin names.
- The operator can answer a customer from Telegram as well as from the dashboard. Replying, in the admin chat, to a chat notification posts to `POST /api/telegram/webhook`, which stores it as an operator message in the thread named by the notification's first line, `… · Suhbat #N`. Only that first line is parsed, because every line below it carries text the customer chose (a name like "Suhbat #5" must not redirect the answer); the bot then reacts 👍. Only the configured admin chat is listened to, and a thread number is trusted only from a message this bot wrote. A dashboard reply is copied to the admin chat so Telegram holds the whole conversation. The webhook, not getUpdates polling, because an incoming request wakes the sleeping free instance; its secret is an HMAC of the bot token under `SESSION_SECRET`, so there is nothing extra to configure, and the server calls `setWebhook` on every start using `RENDER_EXTERNAL_URL` (or `PUBLIC_BASE_URL`). A consequence: no other program can read this bot with getUpdates. Telegram retries a webhook it thinks failed, so `chat_messages.telegram_ref` is unique and a retried reply lands once.
- Telegram order status callbacks, payment providers, RBAC, and realtime delivery updates remain separate integration phases.
- Delivery pricing is customer-based: the first non-cancelled order for a normalized phone number is free, and later orders use a 4,590 so'm fee.
- The weekly leaderboard counts non-cancelled orders from Monday through Sunday, masks phone numbers publicly, and marks the highest-count customer as the prize winner.

## Product

- Uzbek mobile-first grocery shopping flow: home, catalog search/filter/sort, product details, cart, checkout, order history, and tracking.
- Operator dashboard with live health status, revenue and order metrics, low-stock signal, order queue, and status advancement.
- Seeded grocery catalog with real product imagery, first-order delivery promotion, weekly customer leaderboard, cash/online payment choices, and empty/loading/error states.

## User preferences

No additional preferences recorded.

## Gotchas

- The API workflow owns `/api`; frontend requests should stay relative so the shared proxy works in preview and production.
- The generated client needs `dom.iterable` in `lib/api-client-react/tsconfig.json` because generated fetch helpers use `Headers.entries()`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
