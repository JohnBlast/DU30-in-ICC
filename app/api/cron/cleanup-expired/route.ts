/**
 * POST /api/cron/cleanup-expired — delete expired conversations.
 * Call from Vercel Cron (set CRON_SECRET in env). Or run: npm run cleanup-expired
 */

import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Cron not configured" }, { status: 503 });
    }
  } else if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("conversations")
      .delete()
      .lt("expires_at", now)
      .select("conversation_id");

    if (error) {
      console.error("[cron/cleanup-expired] error:", error);
      return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
    }

    const count = data?.length ?? 0;
    return NextResponse.json({ deleted: count });
  } catch (e) {
    console.error("[cron/cleanup-expired] error:", e);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
