import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set to run database migrations");
}

// Every .sql file in this directory is applied in filename order, inside one
// transaction, so a failure part-way leaves the database untouched. Each file
// must be idempotent because they are replayed on every deployment.
const here = new URL("./", import.meta.url);
const entries = await readdir(here);
const files = entries.filter((name) => name.endsWith(".sql")).sort();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const file of files) {
    const sql = await readFile(new URL(file, here), "utf8");
    await client.query(sql);
    console.log(`applied ${file}`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
