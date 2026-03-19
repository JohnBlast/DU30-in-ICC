# The Docket

RAG-powered Q&A app for the Duterte ICC case. Answers are grounded in official ICC documents, cited, and verified by an LLM-as-Judge.

## Quick Start

1. **Setup** — Follow TASKS.md §0 for external services (OpenAI, Supabase, Firecrawl).
2. **Configure** — Copy `.env.local` template from TASKS.md §0 Step 5.
3. **Database** — Run schema: `npm run db:migrate` or apply `supabase/schema.sql` in Supabase SQL Editor. For upgrades, apply migrations 002–009 (see supabase/README.md).
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
| **SECURITY.md** | Security review, API keys, RLS, LLM guardrails |
| **PROJECT_STRUCTURE.md** | Directory layout, file navigation |
| **prd-v2.md** | PRD Iteration 2 (optional) |
| **prompts/** | Cursor implementation prompts; `prompts/archive/` for historical |
| **test-fixtures/** | Test data (`real-world-factchecks`), generated baselines |
| **Guides/** | Workflow, testing, and tooling guides |

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server |
| `npm run db:migrate` | Apply schema (requires SUPABASE_DB_URL) |
| `npm run db:seed-admin -- <user> <pass>` | Create admin user |
| `npm run add-user -- <user> <pass>` | Create user |
| `npm run ingest` | Ingest single URL (or first curated URL) |
| `npm run ingest:all` | Ingest all curated ICC URLs |
| `npm run ingest:discover` | Discover new case filings (dry run) |
| `npm run ingest:case-filings` | Discover and ingest all case filings |
| `npm run cleanup-expired` | Delete expired conversations |
| `npm run verify-guardrails` | Test out-of-scope / redacted handling |
| `npm run verify-e2e` | Run E2E verification |
| `npm run verify-legal-questions` | Test legal question coverage (22 questions) |
| `npm run verify-retrieval-drift` | Compare retrieval to baseline |
| `npm run verify-verdict-stability` | Fact-check verdict regression tests |
| `npm run verify-adversarial-safeguards` | Adversarial + safeguard tests (S-1–S-8, SR-07–09) |
| `npm run verify-false-decline` | False-decline reduction tests (FD-01–FD-15) |
| `npm run verify-contamination-guard` | Contamination guard unit tests |
| `npm run verify-indirect-coperpetration` | Indirect co-perpetration list-query regression tests |
| `npm run run-real-world-factchecks` | Run 15 real-world fact-check examples |
| `npm run ingest-glossary` | Ingest glossary chunks |
| `npm run tune-thresholds` | Run labeled queries for retrieval threshold tuning |
| `npm run check-retrieval -- "<query>"` | Debug RAG retrieval for a query |
| `npm run check-names-in-kb` | Verify co-perpetrator names exist in knowledge base |

## Observability

Optional LangSmith tracing: set in `.env.local`:
```
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=ls_...
LANGSMITH_PROJECT=the-docket
```
Traces appear at [smith.langchain.com](https://smith.langchain.com). Threads and Evaluator remain empty unless explicitly configured.
