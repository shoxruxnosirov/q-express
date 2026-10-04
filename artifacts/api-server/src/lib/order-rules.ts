// Pure order rules, kept apart from the routes so they can be tested without a
// database.

export type OrderStatus = "new" | "preparing" | "courier" | "delivered" | "cancelled";

// The one direction an order moves in, plus cancelling at any point before it
// is delivered. Delivered and cancelled are final: reopening a cancelled order
// would have to take its stock back out, and a delivered one has left the shop.
const NEXT: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ["preparing", "cancelled"],
  preparing: ["courier", "cancelled"],
  courier: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

export function canChangeStatus(from: string, to: string) {
  return (NEXT[from as OrderStatus] ?? []).includes(to as OrderStatus);
}

// The shop and its customers live in Tashkent (UTC+5, no daylight saving),
// while the server runs in UTC. "Today" and "this week" must follow the
// shop's clock, or the day would flip at five in the morning.
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

export function tashkentDayStart(now = new Date()) {
  const local = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - TASHKENT_OFFSET_MS);
}

export function tashkentWeekStart(now = new Date()) {
  const dayStart = tashkentDayStart(now);
  const local = new Date(dayStart.getTime() + TASHKENT_OFFSET_MS);
  const daysFromMonday = (local.getUTCDay() + 6) % 7;
  return new Date(dayStart.getTime() - daysFromMonday * 24 * 60 * 60 * 1000);
}

// What cancelling an order hands back to each product, summed per product so
// a product listed twice is restored once. Lines are the order's own
// snapshot, so anything malformed is skipped rather than trusted.
export function stockToRestore(items: unknown) {
  const restore = new Map<number, number>();
  if (!Array.isArray(items)) return restore;
  for (const item of items) {
    const line = item as { product_id?: unknown; quantity?: unknown };
    const productId = Number(line?.product_id);
    const quantity = Number(line?.quantity);
    if (!Number.isSafeInteger(productId) || productId <= 0) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    // Six decimals is the stock column's precision; summing in micro-units
    // keeps 0.1 + 0.2 from drifting.
    const micro = Math.round(quantity * 1_000_000);
    restore.set(productId, (restore.get(productId) ?? 0) + micro);
  }
  return new Map([...restore].map(([id, micro]) => [id, micro / 1_000_000]));
}

export type AddressParts = { dom: string; xonadon: string };

// The storefront composes an order's address as "12-dom, 45-xonadon"; this is
// the inverse, so an order can add to the customer's saved addresses.
const ADDRESS_PATTERN = /^\s*([0-9A-Za-z]{1,10})\s*-?\s*dom\s*[,\s]\s*([0-9A-Za-z]{1,10})\s*-?\s*xonadon\s*$/i;
export function parseOrderAddress(address: string): AddressParts | undefined {
  const match = ADDRESS_PATTERN.exec(address);
  return match ? { dom: match[1], xonadon: match[2] } : undefined;
}

// The flat an address names, as orders.address_key stores it: "12|45", lower
// case and without leading zeros ("012" is flat 12 too), the same however the
// line was spaced. The first order to a flat has
// free delivery, so two spellings of one flat must give one key. Undefined
// for a line the shop did not write, which never earns the free delivery.
// Migration 0011 fills in older orders with the same pattern.
export function addressKey(address: string): string | undefined {
  const parts = parseOrderAddress(address);
  if (!parts) return undefined;
  const part = (value: string) => value.toLowerCase().replace(/^0+(?=.)/, "");
  return `${part(parts.dom)}|${part(parts.xonadon)}`;
}
