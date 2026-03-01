#!/usr/bin/env npx tsx
/**
 * Task 2.9: Seed admin user with hashed password.
 * Usage: npx tsx --env-file=.env.local scripts/seed-admin.ts <username> <password>
 *
 * Example: npx tsx --env-file=.env.local scripts/seed-admin.ts admin your-secure-password
 */

import { createClient } from "@supabase/supabase-js";
import * as bcrypt from "bcrypt";

const BCRYPT_ROUNDS = 12;

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/seed-admin.ts <username> <password>");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey);
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const { data, error } = await supabase
    .from("users")
    .upsert(
      { username, password_hash: passwordHash, is_admin: true },
      { onConflict: "username" }
    )
    .select()
    .single();

  if (error) {
    console.error("Failed to seed admin user:", error.message);
    process.exit(1);
  }

  console.log("Admin user created/updated successfully:");
  console.log("  user_id:", data.user_id);
  console.log("  username:", data.username);
  console.log("  is_admin:", data.is_admin);
}

main();
