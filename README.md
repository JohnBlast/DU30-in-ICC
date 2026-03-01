# The Docket

RAG-powered Q&A app for the Duterte ICC case. Answers are grounded in official ICC documents, cited, and verified by an LLM-as-Judge.

## Quick Start

1. **Setup** — Follow TASKS.md §0 for external services (OpenAI, Supabase, Firecrawl).
2. **Configure** — Copy `.env.local` template from TASKS.md §0 Step 5.
3. **Database** — Run schema: `npm run db:migrate` or apply `supabase/schema.sql` in Supabase SQL Editor.
4. **Seed** — Create admin: `npm run db:seed-admin -- admin your-password`
5. **Run** — `npm run dev`

## Key Docs

| Document | Purpose |
|----------|---------|
| **constitution.md** | Governing principles, non-negotiable constraints |
| **prd.md** | Product requirements, user journeys, data model |
| **TASKS.md** | Ordered implementation tasks, verification criteria |
| **handoff-checklist.md** | Pre-implementation verification; catch-up for AI agents (§I) |
| **prompt-spec.md** | System prompt, response contract, LLM-as-Judge |
| **nl-interpretation.md** | Intent categories, phrase→action mapping |
| **data-quality.md** | CLEAN rules, validation, pipeline order |
| **ARCHITECTURE.md** | Tech stack, schema, API contracts |

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server |
| `npm run db:migrate` | Apply schema (requires SUPABASE_DB_URL) |
| `npm run db:seed-admin -- <user> <pass>` | Create admin user |
| `npm run add-user -- <user> <pass>` | Create user |
| `npm run ingest` | Scrape and ingest ICC documents |
| `npm run cleanup-expired` | Delete expired conversations |
| `npm run verify-guardrails` | Test out-of-scope / redacted handling |
| `npm run verify-e2e` | Run E2E verification |
| `npm run verify-legal-questions` | Test legal question coverage (22 questions) |
| `npm run check-retrieval -- "<query>"` | Debug RAG retrieval for a query |

## Observability

Optional LangSmith tracing: set in `.env.local`:
```
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=ls_...
LANGSMITH_PROJECT=the-docket
```
Traces appear at [smith.langchain.com](https://smith.langchain.com). Threads and Evaluator remain empty unless explicitly configured.
