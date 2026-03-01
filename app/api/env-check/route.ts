import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/db";

/**
 * Deployment debug: verify env and DB connectivity.
 * GET /api/env-check — no login required.
 */
export async function GET() {
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasSupabaseUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasSupabaseKey = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const hasAuthSecret = Boolean(
    process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32
  );

  let supabaseConnected = false;
  let userCount: number | null = null;
  if (hasSupabaseUrl && hasSupabaseKey) {
    try {
      const supabase = getSupabase();
      const { count, error } = await supabase
        .from("users")
        .select("user_id", { count: "exact", head: true });
      supabaseConnected = !error;
      if (!error && typeof count === "number") userCount = count;
    } catch {
      supabaseConnected = false;
    }
  }

  return NextResponse.json({
    envLoaded: hasOpenAI,
    supabaseUrl: hasSupabaseUrl,
    supabaseKey: hasSupabaseKey,
    authSecret: hasAuthSecret,
    supabaseConnected,
    userCount,
  });
}
