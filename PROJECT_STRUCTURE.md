# Project Structure

> Quick reference for navigating The Docket codebase.

## Root Layout

```
├── app/                    # Next.js App Router (pages, API routes)
├── components/             # React UI components
├── lib/                    # Core application logic (chat, RAG, fact-check, etc.)
├── prompts/                # Cursor implementation prompts & planning docs
│   └── archive/            # Historical prompts (not actively referenced)
├── scripts/                # CLI scripts (ingest, verify, admin)
├── supabase/               # Database schema & migrations
├── test-fixtures/          # Test data & generated baselines
└── Guides/                 # Workflow & testing guides
```

## Core Specs (root)

| File | Purpose |
|------|---------|
| `constitution.md` | Governing principles, tiebreaker rules |
| `prd.md` | Product requirements, data model |
| `prompt-spec.md` | System prompt, Judge, response contract |
| `nl-interpretation.md` | Intent categories, classifier, phrase mapping |
| `data-quality.md` | CLEAN rules, validation |
| `TASKS.md` | Ordered implementation tasks |
| `handoff-checklist.md` | Pre-implementation verification |
| `ARCHITECTURE.md` | Tech stack, schema overview |

## Directories

### `app/`

- `page.tsx`, `layout.tsx` — Main chat UI
- `api/chat/route.ts` — Chat API
- `api/retrieve/route.ts` — RAG retrieval API
- `api/auth/*` — Auth endpoints
- `api/conversations/*` — Conversation CRUD
- `api/cron/cleanup-expired/` — Scheduled cleanup

### `lib/`

- `chat.ts` — Chat pipeline (intent → RAG → LLM → Judge)
- `follow-up-rewriter.ts` — Rewrites follow-ups ("list them", "what about X") using conversation history
- `retrieve.ts` — Vector + FTS retrieval, adjacent chunks, list-query expansion, supplemental FTS/vector for named-individual queries
- `fact-check.ts` — Claim extraction, verification
- `claim-verifier.ts` — Citation verification, fallback when cited chunks lack list items
- `intent-classifier.ts`, `intent.ts` — NL interpretation
- `prompts.ts` — System prompt builder, Judge prompt
- `attribution-verifier.ts`, `deterministic-judge.ts` — Production safeguards
- `contamination-guard.ts`, `normative-filter.ts` — Content filters

### `prompts/`

- Active Cursor prompts (e.g. `cursor-production-hardening-prompt.md`)
- Planning docs (`docket-improvement-plan.md`, `production-hardening-blueprint.md`)
- `archive/` — Old prompts kept for reference

### `scripts/`

- `ingest.ts` — ICC document ingestion (`ingest`, `ingest:all`, `ingest:discover`, `ingest:case-filings`)
- `ingest-glossary.ts` — Glossary chunk ingestion
- `verify-*.ts` — Verification scripts (guardrails, retrieval drift, verdict stability, indirect co-perpetration)
- `run-real-world-factchecks.ts` — Fact-check regression tests

### `test-fixtures/`

- `real-world-factchecks` — Reference examples for fact-check tests
- `retrieval-drift-baseline.json` — Generated baseline for retrieval drift (created on first `verify-retrieval-drift` run)

### `supabase/`

- `schema.sql` — Base schema
- `migrations/` — Incremental migrations (002–009; 009 adds `get_adjacent_chunks` RPC)
