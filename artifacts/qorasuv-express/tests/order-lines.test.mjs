import assert from "node:assert/strict";
import { test } from "node:test";
import { formatQuantity, orderLineParts } from "../src/lib/order-lines.ts";

const space = (text) => text.replace(/\s/g, " ");

test("the dashboard shows how many of each line, as the Telegram notification does", () => {
  assert.equal(formatQuantity(3, "dona"), "3 dona");
  assert.equal(formatQuantity(2.9999999, "qadoq"), "3 qadoq", "pieces and packs are whole");
  assert.equal(formatQuantity(0.1 + 0.2, "kg"), "0.3 kg", "no floating-point noise");
  const line = { product_id: 1, name: "Non", image_url: "", price: 4000, quantity: 3, unit: "dona", total: 12000, purchase_mode: "quantity" };
  const parts = orderLineParts(line);
  assert.equal(parts.name, "Non");
  assert.equal(space(parts.quantity), "3 dona × 4 000 so'm");
  assert.equal(space(parts.total), "12 000 so'm");
  const byAmount = orderLineParts({ ...line, name: "Go‘sht", unit: "kg", quantity: 0.25, price: 120000, total: 30000, purchase_mode: "amount", requested_amount: 30000 });
  assert.equal(space(byAmount.quantity), "30 000 so'mlik (~0.25 kg)");
});
