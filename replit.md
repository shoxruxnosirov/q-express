# Qorasuv Express

Qorasuv Express is a Telegram-ready grocery delivery web app for browsing fresh products, placing orders, tracking delivery, and operating the store.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
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
- OpenAPI remains the contract source and generated React Query hooks are used by the web app.
- Telegram admin notifications use the backend Bot API client and `TELEGRAM_ADMIN_CHAT_ID`; secrets never enter frontend bundles or logs. `TELEGRAM_BOT_MODE=new` selects `TELEGRAM_NEW_BOT_TOKEN` for @Q_express_bot; `legacy` (the default) selects the preserved `TELEGRAM_BOT_TOKEN`. Missing credentials never trigger fallback to a different bot. Activate the new mode only after checking bot identity and sending a test message to the configured admin chat. Existing chats, subscribers, and links do not migrate automatically.
- Product images are uploaded from the operator browser straight to Cloudinary. The API only signs one upload at a time and stores `products.image_public_id` next to the URL; the image bytes never pass through the server. Replacing an image or deleting a product retires the previous file, and that delete is best effort so a Cloudinary outage can never leave a product pointing at a missing image. A NULL public id means the row still holds somebody else's link and there is nothing of ours to delete.
- Products carry three operator flags: `active` hides a product from the storefront without deleting it, `is_popular` drives the home page and the catalog default sort, and `is_new` drives the badge and the newest sort. Because `/products` filters on `active`, the operator list reads `GET /api/admin/products`, which returns every product with its visibility; without that a hidden product could never be found again to bring back. Category product counts filter on `active` too, so the badge never promises more than the category lists.
- Telegram is deliberately NOT used to store images: the Bot Platform developer terms, section 5.2(e), forbid pairing a bot with an external frontend to build storage, and a ban would take order notifications down with the catalog.
- Image storage regression checks: `node --test artifacts/api-server/tests/cloudinary.test.mjs`.
- Telegram notification regression checks: `node --test artifacts/api-server/tests/telegram.test.mjs`.
- Telegram webhook status callbacks, payment providers, RBAC, and realtime delivery updates remain separate integration phases.
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
