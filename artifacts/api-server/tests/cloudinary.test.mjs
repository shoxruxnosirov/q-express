import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";
import {
  createUploadTicket,
  deleteImage,
  isCloudinaryConfigured,
  isOwnImageUrl,
} from "../src/lib/cloudinary.ts";

const keys = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];
const originalEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

const configure = () => {
  process.env.CLOUDINARY_CLOUD_NAME = "qorasuv";
  process.env.CLOUDINARY_API_KEY = "424242424242424";
  process.env.CLOUDINARY_API_SECRET = "s3cr3t-never-leaves-the-server";
};

afterEach(() => {
  for (const key of keys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  globalThis.fetch = originalFetch;
});

test("configuration requires all three credentials", () => {
  for (const key of keys) delete process.env[key];
  assert.equal(isCloudinaryConfigured(), false);

  process.env.CLOUDINARY_CLOUD_NAME = "qorasuv";
  process.env.CLOUDINARY_API_KEY = "424242424242424";
  assert.equal(isCloudinaryConfigured(), false, "a partial configuration is not usable");

  configure();
  assert.equal(isCloudinaryConfigured(), true);
});

test("an upload ticket signs exactly the parameters the browser will send", () => {
  configure();
  const ticket = createUploadTicket();

  const expected = createHash("sha1")
    .update(`folder=${ticket.folder}&timestamp=${ticket.timestamp}${process.env.CLOUDINARY_API_SECRET}`)
    .digest("hex");
  assert.equal(ticket.signature, expected);
  assert.equal(ticket.cloud_name, "qorasuv");
  assert.equal(ticket.api_key, "424242424242424");
  assert.match(ticket.folder, /^qorasuv-express\/products$/);
  assert.ok(ticket.expires_in > 0);
});

test("the ticket never carries the API secret", () => {
  configure();
  const serialised = JSON.stringify(createUploadTicket());
  assert.ok(!serialised.includes(process.env.CLOUDINARY_API_SECRET));
});

test("only URLs inside our own cloud are treated as ours to delete", () => {
  configure();
  assert.equal(isOwnImageUrl("https://res.cloudinary.com/qorasuv/image/upload/v1/a.jpg"), true);
  // A different Cloudinary account, a lookalike host, plaintext transport and
  // an outright foreign link must all fail, or a bad value could make us try to
  // delete somebody else's file.
  assert.equal(isOwnImageUrl("https://res.cloudinary.com/someone-else/image/upload/v1/a.jpg"), false);
  assert.equal(isOwnImageUrl("https://res.cloudinary.com.evil.test/qorasuv/a.jpg"), false);
  assert.equal(isOwnImageUrl("http://res.cloudinary.com/qorasuv/image/upload/v1/a.jpg"), false);
  assert.equal(isOwnImageUrl("https://images.unsplash.com/photo-1511381939415-e44015466834"), false);
  assert.equal(isOwnImageUrl("not a url at all"), false);
});

test("nothing is considered ours while Cloudinary is unconfigured", () => {
  for (const key of keys) delete process.env[key];
  assert.equal(isOwnImageUrl("https://res.cloudinary.com/qorasuv/image/upload/v1/a.jpg"), false);
});

test("deleting signs public_id and timestamp and reports success", async () => {
  configure();
  let sent;
  globalThis.fetch = async (url, init) => {
    sent = { url: String(url), body: new URLSearchParams(await init.body.toString()) };
    return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
  };

  const outcome = await deleteImage("qorasuv-express/products/abc123");
  assert.deepEqual(outcome, { deleted: true });
  assert.equal(sent.url, "https://api.cloudinary.com/v1_1/qorasuv/image/destroy");

  const timestamp = sent.body.get("timestamp");
  const expected = createHash("sha1")
    .update(
      `public_id=qorasuv-express/products/abc123&timestamp=${timestamp}${process.env.CLOUDINARY_API_SECRET}`,
    )
    .digest("hex");
  assert.equal(sent.body.get("signature"), expected);
  assert.equal(sent.body.get("public_id"), "qorasuv-express/products/abc123");
  assert.equal(sent.body.get("api_key"), "424242424242424");
});

test("an already absent file counts as deleted", async () => {
  configure();
  globalThis.fetch = async () => new Response(JSON.stringify({ result: "not found" }), { status: 200 });
  assert.deepEqual(await deleteImage("gone"), { deleted: true });
});

test("a failure is reported rather than thrown, so callers keep their committed row", async () => {
  configure();

  globalThis.fetch = async () => new Response("nope", { status: 401 });
  const rejected = await deleteImage("abc");
  assert.equal(rejected.deleted, false);
  assert.match(rejected.reason, /401/);

  globalThis.fetch = async () => {
    throw new Error("socket hang up");
  };
  const failed = await deleteImage("abc");
  assert.equal(failed.deleted, false);
  assert.equal(failed.reason, "socket hang up");

  globalThis.fetch = async () => new Response(JSON.stringify({ result: "locked" }), { status: 200 });
  const refused = await deleteImage("abc");
  assert.equal(refused.deleted, false);
  assert.equal(refused.reason, "locked");
});

test("an unconfigured delete is a no-op that never calls out", async () => {
  for (const key of keys) delete process.env[key];
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };

  const outcome = await deleteImage("abc");
  assert.equal(outcome.deleted, false);
  assert.equal(called, false);
});
