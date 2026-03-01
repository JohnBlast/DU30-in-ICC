/**
 * GET /api/conversations/[id]/messages — get messages for a conversation
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

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabase();

  let conv: { conversation_id: string; expires_at?: string; response_language?: string } | null = null;
  const { data: convData, error: convError } = await supabase
    .from("conversations")
    .select("conversation_id, expires_at, response_language")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .single();

  if (convError && /response_language|column/i.test(String(convError.message))) {
    const fallback = await supabase
      .from("conversations")
      .select("conversation_id, expires_at")
      .eq("conversation_id", id)
      .eq("user_id", userId)
      .single();
    conv = fallback.data as typeof conv;
  } else {
    conv = convData;
  }

  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date().toISOString();
  if (conv.expires_at && conv.expires_at <= now) {
    return NextResponse.json(
      { error: "This conversation has expired.", expired: true },
      { status: 410 }
    );
  }

  const { data: messages, error } = await supabase
    .from("messages")
    .select("message_id, role, content, citations, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[messages] GET error:", error);
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }

  const validLanguages = ["en", "tl", "taglish"];
  const responseLanguage =
    conv?.response_language && validLanguages.includes(conv.response_language)
      ? conv.response_language
      : "en";

  return NextResponse.json({
    messages: messages ?? [],
    response_language: responseLanguage,
  });
}
