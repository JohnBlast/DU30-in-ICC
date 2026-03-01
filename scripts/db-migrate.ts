#!/usr/bin/env npx tsx
/**
 * Apply database schema to Supabase.
 * Requires SUPABASE_DB_URL in .env.local (from Supabase Dashboard → Settings → Database → Connection string).
 *
 * Usage: npx tsx --env-file=.env.local scripts/db-migrate.ts
 *
 * Alternative: Copy supabase/schema.sql and run manually in Supabase SQL Editor.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error(
      "Missing SUPABASE_DB_URL. Add it to .env.local from Supabase Dashboard → Settings → Database → Connection string (URI)."
    );
    console.error("Or run supabase/schema.sql manually in the Supabase SQL Editor.");
    process.exit(1);
  }

  const schemaPath = join(__dirname, "..", "supabase", "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    await client.query(schema);
    console.log("Schema applied successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
