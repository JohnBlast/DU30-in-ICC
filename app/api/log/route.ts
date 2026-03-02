/**
 * Frontend telemetry endpoint (cursor-false-decline-reduction §5.5).
 * POST /api/log — body: { event: string, data?: Record<string, unknown> }
 * Requires auth. No PII in data (constitution Principle 6).
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/auth";
import { logEvent } from "@/lib/logger";

async function getUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  return payload?.user_id ?? null;
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { event, data = {} } = body;
    if (!event || typeof event !== "string") {
      return NextResponse.json({ error: "Missing event" }, { status: 400 });
    }
    logEvent(`ui.${event}`, "info", data as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
