# Qorasuv Express

Qorasuv Express is a Telegram-ready grocery delivery web app for browsing fresh products, placing orders, tracking delivery, and operating the store.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

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
