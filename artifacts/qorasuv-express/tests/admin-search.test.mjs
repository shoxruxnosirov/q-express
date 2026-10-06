import assert from "node:assert/strict";
import { test } from "node:test";
import { filterAdminProducts, matchesSearch, productHasStatus, searchKey } from "../src/lib/admin-search.ts";

test("apostrophes, case and spacing do not matter", () => {
  assert.equal(searchKey("  Go‘sht   MOL "), "gosht mol");
  assert.equal(searchKey("go'sht"), "gosht");
  assert.equal(searchKey("Oʻrik"), "orik");
});

test("a query typed in Cyrillic finds a Latin name", () => {
  assert.equal(matchesSearch("олма", "Olma qizil"), true);
  assert.equal(matchesSearch("гўшт", "Mol go‘shti"), true);
  assert.equal(matchesSearch("ҳолва", "Holva"), true);
});

test("every word must match, in any order and in any field", () => {
  assert.equal(matchesSearch("litr sut", "Sut 1 litr"), true);
  assert.equal(matchesSearch("sut qatiq", "Sut 1 litr"), false);
  assert.equal(matchesSearch("sut yangi", "Sut", "Yangi sog‘ilgan"), true);
  assert.equal(matchesSearch("   ", "Anything"), true);
});

const products = [
  { id: 1, name: "Olma", description: "Qizil", category: "Mevalar", category_id: 1, active: true, stock: 40 },
  { id: 2, name: "Nok", description: "Sariq", category: "Mevalar", category_id: 1, active: false, stock: 10 },
  { id: 3, name: "Sut", description: "1 litr", category: "Sut mahsulotlari", category_id: 2, active: true, stock: 0 },
  { id: 4, name: "Qatiq", description: "0.5 litr", category: "Sut mahsulotlari", category_id: 2, active: true, stock: 3 },
];
const ids = (rows) => rows.map((row) => row.id);

test("status filters match the dashboard's rules", () => {
  assert.deepEqual(ids(products.filter((p) => productHasStatus(p, "visible"))), [1, 3, 4]);
  assert.deepEqual(ids(products.filter((p) => productHasStatus(p, "hidden"))), [2]);
  assert.deepEqual(ids(products.filter((p) => productHasStatus(p, "sold-out"))), [3]);
  // Low stock counts visible products at or under five, sold-out ones too.
  assert.deepEqual(ids(products.filter((p) => productHasStatus(p, "low"))), [3, 4]);
});

test("search, category and status combine", () => {
  assert.deepEqual(ids(filterAdminProducts(products, {})), [1, 2, 3, 4]);
  assert.deepEqual(ids(filterAdminProducts(products, { categoryId: 2 })), [3, 4]);
  assert.deepEqual(ids(filterAdminProducts(products, { search: "litr" })), [3, 4]);
  assert.deepEqual(ids(filterAdminProducts(products, { search: "meva" })), [1, 2]);
  assert.deepEqual(ids(filterAdminProducts(products, { search: "meva", status: "hidden" })), [2]);
  assert.deepEqual(ids(filterAdminProducts(products, { categoryId: 1, search: "sut" })), []);
});

test("a product in a hidden category is off the site whatever its own switch says", () => {
  const hidden = new Set([2]);
  assert.deepEqual(ids(products.filter((p) => productHasStatus(p, "visible", hidden))), [1]);
  assert.deepEqual(ids(products.filter((p) => productHasStatus(p, "hidden", hidden))), [2, 3, 4]);
  // Not for sale, so not a restocking signal either; sold out still counts.
  assert.deepEqual(ids(products.filter((p) => productHasStatus(p, "low", hidden))), []);
  assert.deepEqual(ids(products.filter((p) => productHasStatus(p, "sold-out", hidden))), [3]);
  assert.deepEqual(ids(filterAdminProducts(products, { status: "visible", hiddenCategories: hidden })), [1]);
});
