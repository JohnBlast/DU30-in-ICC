/**
 * GET /api/auth/session — return current user from cookie (for client-side).
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken, COOKIE_NAME } from "@/lib/auth";

export async function GET() {
  try {
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ user: null });
    }

    const payload = await verifySessionToken(token);
    if (!payload) {
      return NextResponse.json({ user: null });
    }

    return NextResponse.json({
      user: { user_id: payload.user_id, username: payload.username },
    });
  } catch {
    return NextResponse.json({ user: null });
  }
}
