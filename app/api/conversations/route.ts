/**
 * GET /api/conversations — list user's conversations
 * POST /api/conversations — create new conversation
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/auth";
import { getSupabase } from "@/lib/db";

async function getUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  return payload?.user_id ?? null;
}

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  const now = new Date().toISOString();

  let { data, error } = await supabase
    .from("conversations")
    .select("conversation_id, title, created_at, last_message_at, is_bookmarked")
    .eq("user_id", userId)
    .gt("expires_at", now)
    .order("last_message_at", { ascending: false });

  // Fallback if is_bookmarked column doesn't exist (migration not run)
  if (error && /is_bookmarked|column/i.test(String(error.message))) {
    const fallback = await supabase
      .from("conversations")
      .select("conversation_id, title, created_at, last_message_at")
      .eq("user_id", userId)
      .gt("expires_at", now)
      .order("last_message_at", { ascending: false });
    error = fallback.error;
    data = fallback.data
      ? (fallback.data as { conversation_id: string; title: string; created_at: string; last_message_at: string }[]).map((c) => ({ ...c, is_bookmarked: false }))
      : null;
  }

  if (error) {
    console.error("[conversations] GET error:", error);
    return NextResponse.json({ error: "Failed to load conversations" }, { status: 500 });
  }

  return NextResponse.json({ conversations: data ?? [] });
}

export async function POST() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title: "New conversation" })
    .select("conversation_id, title, created_at")
    .single();

  if (error) {
    console.error("[conversations] POST error:", error);
    return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 });
  }

  return NextResponse.json(data);
}
