# Security & Data Integrity

> **Last review:** 2026-03-19. Review after major changes.

## 1. API Keys & Secrets


| Secret                          | Exposure        | Notes                                                               |
| ------------------------------- | --------------- | ------------------------------------------------------------------- |
| `OPENAI_API_KEY`                | Server-only     | Never in client bundles. Used by chat, intent, retrieve, translate. |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server-only     | Bypasses RLS. **Never** prefix with `NEXT_PUBLIC_`.                 |
| `FIRECRAWL_API_KEY`             | Server-only     | Ingestion scripts only (CLI).                                       |
| `AUTH_SECRET`                   | Server-only     | 32+ chars. JWT signing. Generate: `openssl rand -hex 32`.           |
| `CRON_SECRET`                   | Server-only     | 32+ chars. Vercel Cron sends `Authorization: Bearer <secret>`.      |
| `NEXT_PUBLIC_SUPABASE_URL`      | Client + Server | Public; Supabase project URL.                                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | Public; **RLS must be enabled** or anon has full DB access.         |


**Rule:** Never commit `.env.local`. Use Vercel env vars for production. Rotate keys if leaked.

## 2. Infrastructure Access

### Supabase

- **RLS:** Apply `supabase/migrations/010_enable_rls.sql` in production. Without RLS, the anon key (exposed in client bundles) could access all tables.
- **Service role:** App uses `SUPABASE_SERVICE_ROLE_KEY` for server-side DB access; bypasses RLS.
- **Fallback:** If service role is missing, code falls back to anon key — will fail with RLS enabled (correct).

### Cron

- `POST /api/cron/cleanup-expired` — protected by `CRON_SECRET`. Set in Vercel env; Vercel sends `Authorization: Bearer <CRON_SECRET>`.
- Without `CRON_SECRET` or if it’s <16 chars: returns 503.
- Do not expose cron URL; keep `CRON_SECRET` random and long.

### Auth

- JWT session cookie (`docket_session`), httpOnly, secure in prod.
- Login rate-limited (`lib/rate-limit.ts`).
- Protected routes require valid session.

## 3. LLM Behavior (Prompt Injection & Jailbreaking)


| Layer                   | What it does                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------ |
| **Intent classifier**   | Strips `ignore instructions`, `[System`, `jailbreak`, etc. (nl-interpretation §4.2). |
| **Normative filter**    | Blocks evaluative questions before LLM.                                              |
| **Input validation**    | 3–5000 char query, 0–50000 char paste; control chars stripped.                       |
| **Deterministic judge** | Blocks prohibited terms (guilt, loaded language) post-generation.                    |
| **LLM-as-Judge**        | Verifies answers against retrieved chunks.                                           |


**R-14:** User instructions like "no citations needed" are ignored.

## 4. Data Integrity


| Concern                 | Mitigation                                                                 |
| ----------------------- | -------------------------------------------------------------------------- |
| **SQL injection**       | Supabase client uses parameterized queries.                                |
| **XSS**                 | React escapes by default. No `dangerouslySetInnerHTML` on user/LLM output. |
| **Conversation access** | Chat/conversations scoped by `user_id` from JWT.                           |


## 5. Debug / Info Leak Prevention


| Endpoint                  | Production |
| ------------------------- | ---------- |
| `GET /api/env-check`      | 404        |
| `GET /api/auth/env-check` | 404        |


Both return 404 in production to avoid exposing env state or user counts.

## 6. Security Headers (next.config.ts)

- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`: camera, microphone, geolocation disabled
- `Content-Security-Policy`: restricts script/style/img/connect sources

## 7. Checklist for Deployment

- RLS migration applied (`010_enable_rls.sql`)
- `AUTH_SECRET` set (32+ chars)
- `CRON_SECRET` set (32+ chars) for Vercel Cron
- `SUPABASE_SERVICE_ROLE_KEY` set (not anon key)
- `.env.local` not committed; production secrets in Vercel

## 8. If You Suspect Compromise

1. Rotate `AUTH_SECRET` (invalidates all sessions).
2. Rotate `SUPABASE_SERVICE_ROLE_KEY` in Supabase Dashboard.
3. Rotate `OPENAI_API_KEY` in OpenAI dashboard.
4. Rotate `CRON_SECRET` and update Vercel.
5. Check Supabase logs and Vercel logs for unusual activity.

