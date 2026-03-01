/**
 * Route protection: redirect unauthenticated users to /login.
 * PRD §4 (Auth), Task 7.4.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Inlined to avoid importing lib/auth (which pulls in bcrypt — incompatible with Edge runtime)
const COOKIE_NAME = "docket_session";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths
  if (pathname === "/login") {
    const token = req.cookies.get(COOKIE_NAME)?.value;
    if (token && process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32) {
      try {
        const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
        await jwtVerify(token, secret);
        return NextResponse.redirect(new URL("/", req.nextUrl.origin));
      } catch {
        // Invalid token — continue to login
      }
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/auth/") || pathname.startsWith("/_next/") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // Protected routes
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }

  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
    return NextResponse.next(); // No secret configured — allow (dev fallback)
  }
  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    await jwtVerify(token, secret);
    return NextResponse.next();
  } catch {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", req.nextUrl.origin);
    const res = NextResponse.redirect(loginUrl);
    res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
    return res;
  }
}

export const config = {
  matcher: ["/", "/login", "/glossary", "/api/:path*"],
};
