import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// drizzle-kit reads these paths as glob patterns, and glob treats the Windows
// separator as an escape character. Splitting on path.sep and rejoining with
// forward slashes keeps the pattern valid on every platform.
const fromHere = (relative: string) =>
  path.join(__dirname, relative).split(path.sep).join("/");

export default defineConfig({
  schema: fromHere("./src/schema/index.ts"),
  out: fromHere("./migrations"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
