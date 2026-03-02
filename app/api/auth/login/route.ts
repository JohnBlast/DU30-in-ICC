/**
 * POST /api/auth/login — username + password → session cookie.
 * Accepts JSON or form-urlencoded. On success, redirects to / (303) with cookie.
 * On failure, redirects to /login?error=... so the cookie is set in the redirect response.
 */

import { NextResponse } from "next/server";
import { verifyPassword, createSessionToken, COOKIE_NAME, COOKIE_MAX_AGE } from "@/lib/auth";

function redirectWithCookie(url: string, token: string) {
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
  return res;
}

function redirectToLogin(origin: string, error: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;

  try {
    let username: string | null = null;
    let password: string | null = null;

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      username = form.get("username") as string | null;
      password = form.get("password") as string | null;
    } else {
      const body = await req.json().catch(() => ({}));
      username = body?.username ?? null;
      password = body?.password ?? null;
    }

    if (!username || !password || typeof username !== "string" || typeof password !== "string") {
      return redirectToLogin(origin, "Username and password required");
    }

    const user = await verifyPassword(username.trim(), password);
    if (!user) {
      return redirectToLogin(origin, "Invalid username or password");
    }

    const token = await createSessionToken(user.user_id, user.username);
    return redirectWithCookie(origin + "/", token);
  } catch (err) {
    console.error("[auth/login] Error:", err);
    return redirectToLogin(origin, "Login failed");
  }
}
