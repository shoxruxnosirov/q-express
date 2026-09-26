import assert from "node:assert/strict";
import { test } from "node:test";
import { findLineProblems, inStockFirst, isSoldOut, lineProblemText } from "../src/lib/stock-rules.ts";

test("zero or negative stock is sold out", () => {
  assert.equal(isSoldOut({ stock: 0 }), true);
  assert.equal(isSoldOut({ stock: -0.5 }), true);
  assert.equal(isSoldOut({ stock: 0.001 }), false);
});

test("sold-out products move to the end without reshuffling the rest", () => {
  const sorted = inStockFirst([
    { id: 1, stock: 0 }, { id: 2, stock: 5 }, { id: 3, stock: 0 }, { id: 4, stock: 1 },
  ]);
  assert.deepEqual(sorted.map(p => p.id), [2, 4, 1, 3]);
});

test("each cart line is checked against the live catalog", () => {
  const problems = findLineProblems(
    [
      { productId: 1, quantity: 1 },
      { productId: 2, quantity: 3 },
      { productId: 3, quantity: 2 },
      { productId: 4, quantity: 1.5 },
    ],
    [{ id: 1, stock: 10 }, { id: 2, stock: 0 }, { id: 4, stock: 1.2 }],
  );
  assert.equal(problems.has(1), false, "enough stock is fine");
  assert.deepEqual(problems.get(2), { kind: "sold-out" });
  assert.deepEqual(problems.get(3), { kind: "gone" }, "hidden or deleted");
  assert.deepEqual(problems.get(4), { kind: "short", available: 1.2 });
});

test("every problem has a message the customer can act on", () => {
  assert.match(lineProblemText({ kind: "gone" }, "dona"), /olib tashlang/);
  assert.match(lineProblemText({ kind: "sold-out" }, "dona"), /Tugagan/);
  assert.match(lineProblemText({ kind: "short", available: 2 }, "kg"), /faqat 2 kg/);
});
