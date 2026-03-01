/**
 * DELETE /api/conversations/[id] — delete a conversation
 * PATCH /api/conversations/[id] — update (e.g. bookmark, rename)
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

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabase();

  const { data: conv, error: fetchError } = await supabase
    .from("conversations")
    .select("conversation_id")
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .single();

  if (fetchError || !conv) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from("conversations")
    .delete()
    .eq("conversation_id", id)
    .eq("user_id", userId);

  if (deleteError) {
    console.error("[conversations] DELETE error:", deleteError);
    return NextResponse.json({ error: "Failed to delete conversation" }, { status: 500 });
  }

  return NextResponse.json({ deleted: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = getSupabase();

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};

  if (typeof body.is_bookmarked === "boolean") {
    updates.is_bookmarked = body.is_bookmarked;
  }
  if (typeof body.title === "string" && body.title.trim()) {
    updates.title = body.title.trim().slice(0, 200);
  }
  if (body.response_language !== undefined) {
    const validLanguages = ["en", "tl", "taglish"];
    if (!validLanguages.includes(body.response_language)) {
      return NextResponse.json({ error: "Invalid response_language" }, { status: 400 });
    }
    updates.response_language = body.response_language;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid updates" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("conversations")
    .update(updates)
    .eq("conversation_id", id)
    .eq("user_id", userId)
    .select("conversation_id, title, is_bookmarked, response_language")
    .single();

  if (error) {
    console.error("[conversations] PATCH error:", error);
    return NextResponse.json({ error: "Failed to update conversation" }, { status: 500 });
  }

  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
