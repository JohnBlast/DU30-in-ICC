# Database Setup

## Auth Secret (Task Group 7)

Add to `.env.local` for session management:

```
AUTH_SECRET=your-32-char-minimum-secret
```

Generate one with: `openssl rand -hex 32`

## Global Monthly Cap (Task Group 9)

Optional. Default $5. Add to `.env.local`:
```
GLOBAL_MONTHLY_CAP_USD=5
```
When exceeded, the app enters read-only mode (users can browse but not query).

## Disable LLM-as-Judge (optional)

If the judge is overly strict and blocks valid answers, add to `.env.local`:
```
DISABLE_JUDGE=true
```
This bypasses the judge and shows answers directly. Use only for development/debugging.

## Prerequisites

- Supabase project created (TASKS.md §0 Step 2)
- pgvector enabled: run `CREATE EXTENSION IF NOT EXISTS vector;` in SQL Editor if not already done

## Apply Schema

For new setups, run `schema.sql` first. If upgrading an existing DB, run migrations in order: 002 (is_bookmarked), 003–008 as needed, **009** (`get_adjacent_chunks` RPC for list queries), **010** (enable RLS on all public tables). Apply each via Supabase SQL Editor or `psql`.

**Option A: npm script** (requires `SUPABASE_DB_URL` in .env.local)

```bash
# Add to .env.local from Supabase Dashboard → Settings → Database → Connection string (URI):
# SUPABASE_DB_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

npm run db:migrate
```

**Option B: Manual**

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) → your project
2. Open **SQL Editor** → **New query**
3. Copy the contents of `schema.sql` and paste
4. Click **Run**

## Verify

- **Tables:** Table Editor should show `icc_documents`, `document_chunks`, `users`, `conversations`, `messages`, `usage_tracking`
- **Vector function:** Run `SELECT * FROM match_document_chunks('[0,0,...]'::vector(1536), NULL, 0.68, 5);` (returns empty until chunks exist)
- **Full-text search:** Run `SELECT * FROM search_document_chunks_fts('test', NULL, 5);` (returns empty until chunks exist)

## Seed Admin User

After schema is applied:

```bash
npm run db:seed-admin -- admin your-secure-password
```

Or with explicit tsx:

```bash
npx tsx --env-file=.env.local scripts/seed-admin.ts admin your-secure-password
```

Replace `admin` and `your-secure-password` with your credentials.

## Add Users (Task 7.5)

```bash
npm run add-user -- <username> <password> [--admin]
```

Example: `npm run add-user -- juan SecretPass123` — creates a regular user.  
Add `--admin` to create an admin user.
