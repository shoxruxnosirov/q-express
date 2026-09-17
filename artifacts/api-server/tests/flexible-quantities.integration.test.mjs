import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

// This suite is deliberately separate from the fast unit suite. It uses only
// the provisioned development database and never logs connection details.
const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pg = require(require.resolve("pg", { paths: [resolve(repoRoot, "lib/db")] }));
const databaseUrl = process.env.DATABASE_URL;
const port = 19080 + (process.pid % 500);
const adminCode = "integration-only-admin-code";
let pool;
let server;
let categoryId;
let duplicateProductId;
let concurrentProductId;
const createdOrderIds = [];

const shouldRun = Boolean(databaseUrl);

function assertIntegrationEnvironment() {
  if (!shouldRun) {
    return false;
  }
  return true;
}

async function query(text, values = []) {
  return pool.query(text, values);
}

async function http(path, init = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await http("/api/healthz");
      if (response.ok) return;
    } catch {
      // The child may still be starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("API integration process did not become healthy");
}

before(async () => {
  if (!assertIntegrationEnvironment()) return;
  pool = new pg.Pool({ connectionString: databaseUrl });
  const suffix = randomUUID().replaceAll("-", "");
  const category = await query(
    "insert into categories (name, slug, icon) values ($1, $2, $3) returning id",
    [`Integration ${suffix}`, `integration-${suffix}`, "test"],
  );
  categoryId = category.rows[0].id;
  const products = await query(
    `insert into products
       (category_id, name, description, image_url, price, unit, stock, active)
     values
       ($1, $2, 'Integration fixture', 'https://example.com/integration.png', 12000, 'kg', 5.000000, true),
       ($1, $3, 'Integration fixture', 'https://example.com/integration.png', 12000, 'kg', 1.000000, true)
     returning id`,
    [categoryId, `Duplicate fixture ${suffix}`, `Concurrent fixture ${suffix}`],
  );
  duplicateProductId = products.rows[0].id;
  concurrentProductId = products.rows[1].id;

  const stub = resolve(repoRoot, "artifacts/api-server/tests/telegram-stub.mjs");
  const entry = resolve(repoRoot, "artifacts/api-server/dist/index.mjs");
  server = spawn(process.execPath, ["--import", stub, entry], {
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_ACCESS_CODE: adminCode,
      TELEGRAM_BOT_MODE: "new",
      TELEGRAM_NEW_BOT_TOKEN: "integration-stub-token",
      TELEGRAM_ADMIN_CHAT_ID: "integration-stub-chat",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  await waitForHealth();
});

after(async () => {
  if (!assertIntegrationEnvironment()) return;
  if (server) server.kill("SIGTERM");
  if (!pool) return;
  if (createdOrderIds.length > 0) {
    await query("delete from orders where id = any($1::int[])", [createdOrderIds]);
  }
  const productIds = [duplicateProductId, concurrentProductId].filter((id) => id != null);
  if (productIds.length > 0) {
    await query("delete from products where id = any($1::int[])", [productIds]);
  }
  if (categoryId != null) await query("delete from categories where id = $1", [categoryId]);
  await pool.end();
});

test("HTTP admin auth login/logout works in an isolated child process", { skip: !shouldRun }, async () => {
  const login = await http("/api/admin/auth", {
    method: "POST",
    body: JSON.stringify({ code: adminCode }),
  });
  assert.equal(login.status, 200);
  assert.deepEqual((await login.json()).authenticated, true);
  const setCookie = login.headers.get("set-cookie");
  assert.ok(setCookie);
  const cookie = setCookie.split(";", 1)[0];

  const logout = await http("/api/admin/logout", {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(logout.status, 200);
  assert.deepEqual((await logout.json()).authenticated, false);
});

test("duplicate lines aggregate and failed transaction leaves fixture stock unchanged", { skip: !shouldRun }, async () => {
  const failed = await http("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      customer_name: "Integration Rollback",
      items: [{ product_id: duplicateProductId, quantity: 6 }],
      address: "Integration test address",
      phone: "+998900000001",
      payment_method: "cash",
    }),
  });
  assert.equal(failed.status, 400);
  const afterFailed = await query("select stock from products where id = $1", [duplicateProductId]);
  assert.equal(Number(afterFailed.rows[0].stock), 5);

  const amountOrderResponse = await http("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      customer_name: "Integration Amount",
      items: [{ product_id: duplicateProductId, purchase_mode: "amount", amount: 10000 }],
      address: "Integration test address",
      phone: "+998900000003",
      payment_method: "cash",
    }),
  });
  assert.equal(amountOrderResponse.status, 201);
  const amountOrder = await amountOrderResponse.json();
  createdOrderIds.push(amountOrder.id);
  assert.equal(amountOrder.items[0].quantity, 0.833333);
  assert.equal(amountOrder.items[0].requested_amount, 10000);
  assert.equal(amountOrder.items[0].total, 10000);
  assert.equal(amountOrder.subtotal, 10000);

  const created = await http("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      customer_name: "Integration Duplicate",
      items: [
        { product_id: duplicateProductId, quantity: 1 },
        { product_id: duplicateProductId, quantity: 2 },
      ],
      address: "Integration test address",
      phone: "+998900000002",
      payment_method: "cash",
    }),
  });
  assert.equal(created.status, 201);
  const order = await created.json();
  createdOrderIds.push(order.id);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].quantity, 3);
  assert.equal(order.items[0].total, 36000);
  const afterCreated = await query("select stock from products where id = $1", [duplicateProductId]);
  assert.equal(Number(afterCreated.rows[0].stock), 1.166667);
});

test("concurrent orders lock the product and cannot oversell fractional stock", { skip: !shouldRun }, async () => {
  const body = (phone) => ({
    customer_name: "Integration Concurrent",
    items: [{ product_id: concurrentProductId, quantity: 0.75 }],
    address: "Integration test address",
    phone,
    payment_method: "cash",
  });
  const responses = await Promise.all([
    http("/api/orders", { method: "POST", body: JSON.stringify(body("+998900000011")) }),
    http("/api/orders", { method: "POST", body: JSON.stringify(body("+998900000012")) }),
  ]);
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [201, 400]);
  for (const response of responses) {
    if (response.status === 201) {
      const order = await response.json();
      createdOrderIds.push(order.id);
      assert.equal(order.items[0].quantity, 0.75);
      assert.equal(order.items[0].total, 9000);
    }
  }
  const stock = await query("select stock, numeric_scale from products p join information_schema.columns c on c.table_name = 'products' and c.column_name = 'stock' where p.id = $1", [concurrentProductId]);
  assert.equal(Number(stock.rows[0].numeric_scale), 6);
  assert.equal(Number(stock.rows[0].stock), 0.25);
});