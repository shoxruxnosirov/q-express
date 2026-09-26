// Fixed-window rate limiting held in this process. A limit that cost a query
// per request would itself be the cheapest way to take the free instance down,
// and a single web service has no second process to share a count with.
//
// The map is swept as windows expire and is hard-capped on top of that,
// because the keys come from the caller: an address or a thread id a script
// can rotate must not be able to grow the map until the instance runs out of
// memory. Counts live only in memory, so a restart forgives everyone — that is
// the accepted trade for not putting this in the database.

export type RateLimiterOptions = {
  windowMs: number;
  max: number;
  // Above this many tracked keys the oldest windows are dropped. They are the
  // closest to expiring anyway, so the most a flood can buy is an early reset
  // of somebody else's window rather than unbounded memory.
  maxKeys?: number;
  // Injectable so the regression tests can move time without sleeping.
  now?: () => number;
};

export type RateLimiter<Key> = {
  allow: (key: Key) => boolean;
  // Whether the key has used up its window, without counting this call. For
  // limits that charge only failures: check first, charge after a failure.
  isExhausted: (key: Key) => boolean;
  size: () => number;
};

const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter<Key>(options: RateLimiterOptions): RateLimiter<Key> {
  const { windowMs, max, maxKeys = DEFAULT_MAX_KEYS, now = Date.now } = options;
  const windows = new Map<Key, { count: number; windowStartedAt: number }>();
  let lastSweptAt = now();

  const isExpired = (windowStartedAt: number, at: number) => at - windowStartedAt >= windowMs;

  // Sweeping on every call would be O(tracked keys) per request. Once per
  // window is enough: nothing outlives its window by more than the wait for
  // the next sweep, so the map stays proportional to real traffic.
  function sweep(at: number) {
    for (const [key, window] of windows) {
      if (isExpired(window.windowStartedAt, at)) windows.delete(key);
    }
    lastSweptAt = at;
  }

  function enforceCap(at: number) {
    if (windows.size <= maxKeys) return;
    sweep(at);
    if (windows.size <= maxKeys) return;
    const oldestFirst = [...windows.entries()].sort(
      (left, right) => left[1].windowStartedAt - right[1].windowStartedAt,
    );
    for (const [key] of oldestFirst) {
      if (windows.size <= maxKeys) break;
      windows.delete(key);
    }
  }

  return {
    allow(key: Key) {
      const at = now();
      if (at - lastSweptAt >= windowMs) sweep(at);

      const current = windows.get(key);
      if (!current || isExpired(current.windowStartedAt, at)) {
        windows.set(key, { count: 1, windowStartedAt: at });
        enforceCap(at);
        return true;
      }
      // A refused call is not counted: the window is fixed by when it started,
      // so hammering can neither extend it nor overflow the counter.
      if (current.count >= max) return false;
      current.count += 1;
      return true;
    },
    isExhausted(key: Key) {
      const current = windows.get(key);
      return Boolean(current && !isExpired(current.windowStartedAt, now()) && current.count >= max);
    },
    size() {
      return windows.size;
    },
  };
}
