/**
 * POST /api/auth/login — username + password → session cookie.
 */

import { NextResponse } from "next/server";
import { verifyPassword, createSessionToken, COOKIE_NAME, COOKIE_MAX_AGE } from "@/lib/auth";
import { checkLoginRateLimit, recordFailedLogin } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const limit = checkLoginRateLimit(req);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password || typeof username !== "string" || typeof password !== "string") {
      return NextResponse.json({ error: "Username and password required" }, { status: 400 });
    }

    const user = await verifyPassword(username.trim(), password);
    if (!user) {
      recordFailedLogin(req);
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    const token = await createSessionToken(user.user_id, user.username);

    const res = NextResponse.json({ ok: true, username: user.username });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    });

    return res;
  } catch (err) {
    console.error("[auth/login] Error:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
