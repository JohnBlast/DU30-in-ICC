/**
 * Chat endpoint: query → intent → RAG → LLM → parsed response.
 * Saves messages when conversationId provided or created.
 * POST /api/chat
 * Body: { query: string, pastedText?: string, conversationId?: string }
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/auth";
import { getSupabase } from "@/lib/db";
import { getUsageStatus, recordQuery, estimateCostPerQuery, SOFT_DAILY_LIMIT } from "@/lib/usage";
import { chat } from "@/lib/chat";
import { logEvent } from "@/lib/logger";
import { validateChatInput } from "@/lib/validate-chat-input";

async function getUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  return payload?.user_id ?? null;
}

export async function POST(req: Request) {
  try {
    const userId = await getUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { query, pastedText, conversationId } = body;

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Missing query" }, { status: 400 });
    }

    const validation = validateChatInput(query, pastedText);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const sanitizedQuery = validation.sanitizedQuery!;

    const usageStatus = await getUsageStatus(userId);
    if (!usageStatus.underCap) {
      return NextResponse.json(
        {
          answer: `The Q&A service has reached its monthly usage limit. You can still browse your conversations and the document library. Service resets on ${usageStatus.resetDate}.`,
          citations: [],
          warning: null,
          verified: false,
          knowledge_base_last_updated: new Date().toISOString().slice(0, 10),
          capExceeded: true,
          resetDate: usageStatus.resetDate,
        },
        { status: 429 }
      );
    }

    const supabase = getSupabase();
    let convId = typeof conversationId === "string" ? conversationId : null;

    // Load conversation history or create new conversation
    let conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    if (convId) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("conversation_id")
        .eq("conversation_id", convId)
        .eq("user_id", userId)
        .single();
      if (!conv) {
        return NextResponse.json({ error: "Conversation not found or access denied" }, { status: 404 });
      }
      const { data: messages } = await supabase
        .from("messages")
        .select("role, content")
        .eq("conversation_id", convId)
        .order("created_at", { ascending: true });
      conversationHistory = (messages ?? []).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
    } else {
      const { data: newConv, error: convError } = await supabase
        .from("conversations")
        .insert({ user_id: userId, title: "New conversation" })
        .select("conversation_id")
        .single();
      if (convError || !newConv) {
        logEvent("chat.error", "error", {
          error_type: "conversation_create",
          error_message: convError?.message ?? "unknown",
        });
        return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 });
      }
      convId = newConv.conversation_id;
    }

    const result = await chat({
      query: sanitizedQuery,
      pastedText: typeof pastedText === "string" ? pastedText.trim() : undefined,
      conversationHistory,
    });

    if (convId) {
      const userContent = pastedText
        ? `[Pasted text]\n${pastedText.slice(0, 500)}${pastedText.length > 500 ? "…" : ""}\n\n${sanitizedQuery}`
        : sanitizedQuery;

      const { error: msgError } = await supabase.from("messages").insert([
        { conversation_id: convId, role: "user", content: userContent },
        {
          conversation_id: convId,
          role: "assistant",
          content: result.answer,
          citations: result.citations,
        },
      ]);
      if (msgError) {
        logEvent("chat.error", "error", { error_type: "message_save", error_message: msgError.message });
      }

      const { count } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("conversation_id", convId)
        .eq("role", "user");
      if (count === 1) {
        const title = (sanitizedQuery.slice(0, 60) || "New conversation") + (sanitizedQuery.length > 60 ? "…" : "");
        await supabase
          .from("conversations")
          .update({ title })
          .eq("conversation_id", convId);
      }
    }

    await recordQuery(userId, estimateCostPerQuery());

    return NextResponse.json({
      ...result,
      conversationId: convId,
      dailyLimitReached: usageStatus.dailyCount + 1 >= SOFT_DAILY_LIMIT,
    });
  } catch (err) {
    logEvent("chat.error", "error", { error_type: "route", error_message: String(err) });
    return NextResponse.json(
      {
        answer: "The Q&A service is temporarily unavailable. Please try again shortly.",
        citations: [],
        warning: null,
        verified: false,
        knowledge_base_last_updated: new Date().toISOString().slice(0, 10),
      },
      { status: 503 }
    );
  }
}
