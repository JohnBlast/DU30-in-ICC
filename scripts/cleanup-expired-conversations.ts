/**
 * Delete expired conversations (expires_at < NOW).
 * Run manually or via cron (e.g. Vercel Cron).
 * Usage: npm run cleanup-expired
 */

import { getSupabase } from "../lib/db";

async function main() {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("conversations")
    .delete()
    .lt("expires_at", now)
    .select("conversation_id");

  if (error) {
    console.error("[cleanup-expired] error:", error);
    process.exit(1);
  }

  const count = data?.length ?? 0;
  console.log(`[cleanup-expired] deleted ${count} expired conversation(s)`);
}

main();
