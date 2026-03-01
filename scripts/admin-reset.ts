#!/usr/bin/env npx tsx
/**
 * Reset admin: clear all conversations and set password.
 * Usage: npx tsx --env-file=.env.local scripts/admin-reset.ts <new_password>
 *
 * Example: npx tsx --env-file=.env.local scripts/admin-reset.ts ICC321
 */

import { createClient } from "@supabase/supabase-js";
import { hashPassword } from "../lib/auth";

async function main() {
  const [newPassword] = process.argv.slice(2);
  if (!newPassword) {
    console.error("Usage: npx tsx --env-file=.env.local scripts/admin-reset.ts <new_password>");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey);

  // Find admin user
  const { data: admin, error: findError } = await supabase
    .from("users")
    .select("user_id, username")
    .eq("username", "admin")
    .single();

  if (findError || !admin) {
    console.error("Admin user not found:", findError?.message ?? "No admin row");
    process.exit(1);
  }

  // Delete all conversations for admin (messages cascade)
  const { data: deleted, error: deleteError } = await supabase
    .from("conversations")
    .delete()
    .eq("user_id", admin.user_id)
    .select("conversation_id");

  if (deleteError) {
    console.error("Failed to delete conversations:", deleteError.message);
    process.exit(1);
  }
  const count = deleted?.length ?? 0;
  console.log(`Cleared ${count} conversation(s) for admin.`);

  // Update password
  const passwordHash = await hashPassword(newPassword);
  const { error: updateError } = await supabase
    .from("users")
    .update({ password_hash: passwordHash })
    .eq("username", "admin");

  if (updateError) {
    console.error("Failed to update password:", updateError.message);
    process.exit(1);
  }

  console.log("Admin password updated successfully.");
}

main();
