/**
 * Auth: JWT session tokens, password verification.
 * PRD §4 (Auth), Task Group 7.
 */

import { SignJWT, jwtVerify } from "jose";
import * as bcrypt from "bcrypt";
import { createClient } from "@supabase/supabase-js";

const COOKIE_NAME = "docket_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const BCRYPT_ROUNDS = 12;

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "Missing or invalid AUTH_SECRET. Add a 32+ character secret to .env.local (e.g. openssl rand -hex 32)"
    );
  }
  return new TextEncoder().encode(secret);
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !key) throw new Error("Missing Supabase env");
  return createClient(url, key);
}

export interface SessionPayload {
  user_id: string;
  username: string;
  exp: number;
}

/** Create a signed JWT for the session. */
export async function createSessionToken(userId: string, username: string): Promise<string> {
  const secret = getSecret();
  const exp = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE;
  return new SignJWT({ user_id: userId, username })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(exp)
    .setIssuedAt()
    .sign(secret);
}

/** Verify and decode the session token. Returns null if invalid. */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/** Verify username + password. Returns user row or null. */
export async function verifyPassword(
  username: string,
  password: string
): Promise<{ user_id: string; username: string } | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("users")
    .select("user_id, username, password_hash")
    .eq("username", username.trim())
    .single();

  if (error || !data) return null;

  const valid = await bcrypt.compare(password, data.password_hash);
  if (!valid) return null;

  return { user_id: data.user_id, username: data.username };
}

/** Hash a password for storage (used by add-user script). */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export { COOKIE_NAME, COOKIE_MAX_AGE };
