/**
 * Simple in-memory rate limiter for login attempts.
 * Per-process only (serverless: each instance has its own map).
 * For production at scale, use Upstash Redis or Vercel Firewall.
 */

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const attempts = new Map<string, { count: number; firstAt: number }>();

function getKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `login:${ip}`;
}

export function checkLoginRateLimit(req: Request): { ok: true } | { ok: false; retryAfter: number } {
  const key = getKey(req);
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry) {
    return { ok: true };
  }

  if (now - entry.firstAt > LOGIN_WINDOW_MS) {
    attempts.delete(key);
    return { ok: true };
  }

  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.firstAt + LOGIN_WINDOW_MS - now) / 1000);
    return { ok: false, retryAfter };
  }
  return { ok: true };
}

/** Call only on failed login (401) — increments attempt count. */
export function recordFailedLogin(req: Request): void {
  const key = getKey(req);
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry) {
    attempts.set(key, { count: 1, firstAt: now });
    return;
  }

  if (now - entry.firstAt > LOGIN_WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return;
  }

  entry.count++;
}
