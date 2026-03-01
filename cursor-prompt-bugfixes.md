# Cursor Prompt: Bug Fixes

## Bug 1: Hardcoded daily limit (Medium)

**File:** `app/api/chat/route.ts`, line 132

**Problem:** The daily limit check is hardcoded to `>= 30` instead of using the configurable `SOFT_DAILY_LIMIT` from `lib/usage.ts`. If `SOFT_DAILY_LIMIT` is set via environment variable, the response still uses `30`.

**Current code:**
```typescript
dailyLimitReached: usageStatus.dailyCount + 1 >= 30,
```

**Fix:** Use `usageStatus.dailyLimitReached` which already computes this correctly in `lib/usage.ts` (line 78), accounting for the +1:

```typescript
dailyLimitReached: usageStatus.dailyCount + 1 >= SOFT_DAILY_LIMIT,
```

But since `SOFT_DAILY_LIMIT` isn't exported, the simplest fix is to use the already-computed field. However, `usageStatus.dailyLimitReached` doesn't account for the +1 (the current query). Two options:

**Option A (preferred):** Export `SOFT_DAILY_LIMIT` from `lib/usage.ts` and use it:
```typescript
// In lib/usage.ts — add to exports:
export const SOFT_DAILY_LIMIT = process.env.SOFT_DAILY_LIMIT ? parseInt(process.env.SOFT_DAILY_LIMIT, 10) : 30;

// In app/api/chat/route.ts:
import { getUsageStatus, recordQuery, estimateCostPerQuery, SOFT_DAILY_LIMIT } from "@/lib/usage";
// ...
dailyLimitReached: usageStatus.dailyCount + 1 >= SOFT_DAILY_LIMIT,
```

**Option B:** Recalculate in `getUsageStatus` to include "would next query trigger it":
```typescript
dailyLimitReached: dailyCount + 1 >= SOFT_DAILY_LIMIT,
```

Use Option A.

---

## Bug 2: Silent failure on conversation creation (Medium)

**File:** `app/api/chat/route.ts`, lines 84-89

**Problem:** If `supabase.from("conversations").insert(...)` fails, `newConv` is `null` and `convId` becomes `null`. Messages are then silently not saved (the `if (convId)` on line 98 skips the insert). The user gets an answer but their conversation is lost.

**Current code:**
```typescript
const { data: newConv } = await supabase
  .from("conversations")
  .insert({ user_id: userId, title: "New conversation" })
  .select("conversation_id")
  .single();
convId = newConv?.conversation_id ?? null;
```

**Fix:** Check for error and return 500 if conversation creation fails:
```typescript
const { data: newConv, error: convError } = await supabase
  .from("conversations")
  .insert({ user_id: userId, title: "New conversation" })
  .select("conversation_id")
  .single();
if (convError || !newConv) {
  logEvent("chat.error", "error", { error_type: "conversation_create", error_message: convError?.message ?? "unknown" });
  return NextResponse.json(
    { error: "Failed to create conversation" },
    { status: 500 }
  );
}
convId = newConv.conversation_id;
```

---

## Bug 3: No error check on message insert (Low)

**File:** `app/api/chat/route.ts`, lines 103-111

**Problem:** If message insert fails, data is silently lost. The user gets an answer but it's not saved to their conversation.

**Current code:**
```typescript
await supabase.from("messages").insert([...]);
```

**Fix:** Log the error (don't fail the request — the user already has the answer):
```typescript
const { error: msgError } = await supabase.from("messages").insert([
  { conversation_id: convId, role: "user", content: userContent },
  { conversation_id: convId, role: "assistant", content: result.answer, citations: result.citations },
]);
if (msgError) {
  logEvent("chat.error", "error", { error_type: "message_save", error_message: msgError.message });
}
```

---

## Bug 4: Defensive null check on embedding response (Low)

**File:** `lib/retrieve.ts`, line 75

**Problem:** `res.data[0].embedding` accessed without null check. Extremely unlikely to fail (OpenAI SDK always returns data), but crashes if it does.

**Current code:**
```typescript
return res.data[0].embedding;
```

**Fix:**
```typescript
if (!res.data?.[0]?.embedding) {
  throw new Error("Failed to embed text: empty response from OpenAI");
}
return res.data[0].embedding;
```

---

## Bug 5: Middleware encodes before checking (Low)

**File:** `middleware.ts`, lines 48-49

**Problem:** `new TextEncoder().encode(process.env.AUTH_SECRET!)` runs before the null/length check. Won't crash (encoding `undefined` produces bytes), but semantically wrong — wastes work and the non-null assertion is misleading.

**Current code:**
```typescript
const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
  return NextResponse.next();
}
```

**Fix:** Swap the order:
```typescript
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
  return NextResponse.next();
}
const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
```

Apply the same fix on lines 21-22 in the login branch:
```typescript
// Before:
const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
if (secret.length >= 32) {

// After:
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
  // Skip — no valid secret configured
} else {
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
  await jwtVerify(token, secret);
  return NextResponse.redirect(new URL("/", req.nextUrl.origin));
}
```

Or more cleanly:
```typescript
if (token && process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32) {
  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    await jwtVerify(token, secret);
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  } catch {
    // Invalid token — continue to login
  }
}
```

---

## Files to modify

| File | Changes |
|------|---------|
| `lib/usage.ts` | Export `SOFT_DAILY_LIMIT` |
| `app/api/chat/route.ts` | Import `SOFT_DAILY_LIMIT`, fix hardcoded 30; add error check on conversation insert; add error logging on message insert |
| `lib/retrieve.ts` | Add null check on embedding response |
| `middleware.ts` | Reorder secret check before encoding (both branches) |

## Verify

After implementing, run `npm run build` to confirm no type errors. Then `npm run verify-phase3` to confirm no regressions.
