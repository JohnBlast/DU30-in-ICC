import { NextResponse } from "next/server";

/**
 * Task 1.6: Verify .env.local is loaded in server-side code.
 * This route runs server-side only - env vars are never exposed to the client.
 */
export async function GET() {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  // Log the key prefix for verification (never log full key in production)
  const keyPrefix = process.env.OPENAI_API_KEY
    ? process.env.OPENAI_API_KEY.substring(0, 10) + "..."
    : "NOT_SET";
  console.log("[env-check] OPENAI_API_KEY loaded:", keyPrefix);

  return NextResponse.json({
    envLoaded: hasKey,
    message: hasKey ? "Environment variables loaded successfully" : "OPENAI_API_KEY not found",
  });
}
