#!/usr/bin/env npx tsx
/**
 * Task 7.5: Add a new user to the database.
 * Usage: npx tsx --env-file=.env.local scripts/add-user.ts <username> <password> [--admin]
 *
 * Example: npx tsx --env-file=.env.local scripts/add-user.ts juan SecretPass123
 * Example (admin): npx tsx --env-file=.env.local scripts/add-user.ts admin AdminPass456 --admin
 */

import { createClient } from "@supabase/supabase-js";
import { hashPassword } from "../lib/auth";

async function main() {
  const args = process.argv.slice(2);
  const adminIndex = args.indexOf("--admin");
  const isAdmin = adminIndex !== -1;
  if (isAdmin) args.splice(adminIndex, 1);

  const [username, password] = args;
  if (!username || !password) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/add-user.ts <username> <password> [--admin]");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const supabase = createClient(url, serviceKey);

  const { data, error } = await supabase
    .from("users")
    .upsert(
      { username: username.trim(), password_hash: passwordHash, is_admin: isAdmin },
      { onConflict: "username" }
    )
    .select()
    .single();

  if (error) {
    console.error("Failed to add user:", error.message);
    process.exit(1);
  }

  console.log("User created/updated successfully:");
  console.log("  user_id:", data.user_id);
  console.log("  username:", data.username);
  console.log("  is_admin:", data.is_admin);
}

main();
