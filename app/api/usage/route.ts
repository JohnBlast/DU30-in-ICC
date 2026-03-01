/**
 * GET /api/usage — return usage status for current user (for UI).
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/auth";
import { getUsageStatus } from "@/lib/usage";

export async function GET() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await verifySessionToken(token);
  if (!payload) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const status = await getUsageStatus(payload.user_id);
    return NextResponse.json(status);
  } catch (err) {
    console.error("[usage] Error:", err);
    return NextResponse.json(
      {
        underCap: true,
        globalCost: 0,
        resetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        dailyCount: 0,
        dailyLimitReached: false,
      },
      { status: 200 }
    );
  }
}
