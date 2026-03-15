# Apply RLS Migration (010)

This migration enables Row Level Security on all public tables to address Supabase linter security findings.

## What it does

- Enables RLS on: `users`, `conversations`, `messages`, `usage_tracking`, `document_chunks`, `icc_documents`
- Blocks direct REST API access via the anon key (which is public in client bundles)
- Your app continues to work — it uses `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS

## How to apply

### Option A: Supabase SQL Editor (recommended)

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → select your project
2. Go to **SQL Editor** → **New query**
3. Copy the contents of `supabase/migrations/010_enable_rls.sql`
4. Paste and click **Run**
5. Confirm success (no errors)

### Option B: psql or direct connection

If you have `SUPABASE_DB_URL` in `.env.local`:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/010_enable_rls.sql
```

## Verify

1. In Supabase Dashboard → **Database** → **Tables**, open any table
2. You should see "RLS enabled" in the table details
3. Run your app — login, chat, and retrieval should work as before

## Rollback (if needed)

To disable RLS (not recommended):

```sql
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_tracking DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.icc_documents DISABLE ROW LEVEL SECURITY;
```
