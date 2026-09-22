import assert from "node:assert/strict";
import { test } from "node:test";
import { createRateLimiter } from "../src/lib/rate-window.ts";

// A clock the test moves by hand, so a window can expire without waiting.
const clock = (start = 1_000_000) => {
  let at = start;
  return { now: () => at, advance: (ms) => { at += ms; } };
};

test("a window allows exactly its quota and then refuses", () => {
  const time = clock();
  const limiter = createRateLimiter({ windowMs: 1000, max: 3, now: time.now });
  assert.deepEqual([limiter.allow("a"), limiter.allow("a"), limiter.allow("a")], [true, true, true]);
  assert.equal(limiter.allow("a"), false);
});

test("keys are counted apart, so one caller cannot silence another", () => {
  const time = clock();
  const limiter = createRateLimiter({ windowMs: 1000, max: 1, now: time.now });
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);
  assert.equal(limiter.allow("b"), true, "b is a different caller and starts fresh");
});

test("the window is fixed, so hammering cannot push its end further away", () => {
  const time = clock();
  const limiter = createRateLimiter({ windowMs: 1000, max: 2, now: time.now });
  limiter.allow("a");
  limiter.allow("a");
  for (let i = 0; i < 50; i += 1) {
    time.advance(10);
    assert.equal(limiter.allow("a"), false);
  }
  time.advance(600);
  assert.equal(limiter.allow("a"), true, "the window started at the first call, not the last refusal");
});

test("an expired window is swept instead of being kept forever", () => {
  const time = clock();
  const limiter = createRateLimiter({ windowMs: 1000, max: 5, now: time.now });
  for (let i = 0; i < 100; i += 1) limiter.allow(`caller-${i}`);
  assert.equal(limiter.size(), 100);

  time.advance(1001);
  limiter.allow("someone-new");
  assert.equal(limiter.size(), 1, "the hundred expired windows are gone, not merely ignored");
});

test("rotating keys cannot grow the map without bound", () => {
  const time = clock();
  const limiter = createRateLimiter({ windowMs: 60_000, max: 5, maxKeys: 50, now: time.now });
  // Every key is fresh and none of them expire, which is what a flood from
  // rotating addresses looks like inside one window.
  for (let i = 0; i < 5000; i += 1) {
    time.advance(1);
    limiter.allow(`spoofed-${i}`);
  }
  assert.ok(limiter.size() <= 50, `expected the cap to hold, saw ${limiter.size()} keys`);
});

test("the cap drops the oldest windows, so the newest callers keep their counts", () => {
  const time = clock();
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 2, now: time.now });
  limiter.allow("oldest");
  time.advance(10);
  limiter.allow("middle");
  time.advance(10);
  limiter.allow("newest");

  assert.equal(limiter.allow("newest"), false, "the newest caller is still counted");
  assert.equal(limiter.allow("oldest"), true, "the oldest window was the one dropped");
});
