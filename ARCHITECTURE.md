# The Docket — Architecture Document

> **What this is:** Technical architecture for The Docket (DU30 in ICC), covering project structure, key decisions, database schema, API contracts, third-party dependencies, and decisions that must be made upfront.
>
> **Governing documents:** constitution.md, prd.md, prompt-spec.md, data-quality.md, nl-interpretation.md
>
> **Note:** Some sections (e.g. project structure, API paths) were written during planning. The implemented structure is flatter — see `handoff-checklist.md` §I for current key files. Schema lives in `supabase/schema.sql`.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         THE DOCKET                                  │
│                                                                     │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │  Next.js  │───▶│  API Routes  │───▶│   OpenAI     │               │
│  │  Frontend │◀──│  /api/*      │◀──│  gpt-4o-mini │               │
│  └──────────┘    └──────┬───────┘    └──────────────┘               │
│                         │                                           │
│                         ▼                                           │
│                 ┌───────────────┐                                    │
│                 │   Supabase    │                                    │
│                 │  PostgreSQL   │                                    │
│                 │  + pgvector   │                                    │
│                 │  + BM25 FTS   │                                    │
│                 └───────────────┘                                    │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Ingestion Pipeline (offline, weekly cron)                    │   │
│  │  Firecrawl → CLEAN rules → Unstructured.io → LangChain →    │   │
│  │  OpenAI Embeddings → Supabase pgvector                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**Two distinct runtime contexts:**

1. **Request path (user-facing):** Browser → Next.js → API route → RAG retrieval → LLM generation → LLM-as-Judge → response
2. **Ingestion path (offline):** Cron/manual trigger → Firecrawl scrape → data cleaning → parse → chunk → embed → store

These never run simultaneously against the same data. Partially ingested documents are not queryable until ingestion completes (PRD §8).

---

## 2. Tech Stack

| Layer | Technology | Version | Why This |
|-------|-----------|---------|----------|
| **Framework** | Next.js (App Router) | 14+ | Full-stack React, API routes colocated, Vercel-native, SSR for login page |
| **Language** | TypeScript | 5+ | Type safety for API contracts, response parsing, database queries |
| **Styling** | Tailwind CSS | 3+ | Utility-first, fast iteration, no design system overhead for iteration 1 |
| **Database** | Supabase (PostgreSQL) | — | Free tier, pgvector extension, full-text search (BM25), row-level security, JS client |
| **Vector search** | pgvector (via Supabase) | 0.7+ | Cosine similarity on 1536-dim embeddings, no separate vector DB needed |
| **Full-text search** | PostgreSQL tsvector/tsquery (via Supabase) | — | BM25-equivalent keyword search for hybrid retrieval |
| **LLM** | OpenAI `gpt-4o-mini` | — | Cost-efficient, sufficient quality for factual Q&A + judge; 128K context window |
| **Embeddings** | OpenAI `text-embedding-3-small` | — | 1536 dimensions, good legal text performance, low cost |
| **Reranking** | FlashRank | — | Free, local, no API key; reranks top-10 hybrid results to top-4 |
| **Scraping** | Firecrawl (scrape-mode) | — | Returns clean markdown from ICC HTML pages and PDFs; 500 free credits/month |
| **PDF/HTML parsing** | Unstructured.io (free library) | — | Local `pip install`; handles scanned PDFs, OCR, HTML partitioning |
| **Text splitting** | LangChain `RecursiveCharacterTextSplitter` | — | Token-aware chunking with overlap; metadata inheritance |
| **Hosting** | Vercel (Hobby tier) | — | Free, zero-config Next.js deployment, environment variable management |
| **Auth** | Custom (bcrypt + cookie/JWT) | — | Simple username/password; admin-created accounts; no OAuth complexity for iteration 1 |

### Why not...

| Alternative | Why we chose differently |
|------------|------------------------|
| **Pinecone / Weaviate** | Supabase pgvector is free and sufficient for ~1,000–5,000 chunks. No need for a separate managed vector DB at this scale. |
| **Claude / Anthropic** | gpt-4o-mini is cheaper for the two-call pattern (generation + judge). Claude is blocked by ICC robots.txt (`ClaudeBot` disallowed). Model can be swapped later. |
| **Supabase Auth** | Over-engineered for admin-created accounts with no self-registration. Custom bcrypt + session is simpler and gives full control. |
| **Prisma** | Adds ORM complexity. Supabase JS client handles queries directly. Schema managed via SQL migrations. |
| **Streaming (SSE)** | LLM-as-Judge must verify the full answer before display. Streaming would show unverified content. Explicitly out of scope (PRD §1). |
| **Redis / caching** | User base is tiny (friends). No caching layer needed for iteration 1. |
| **Docker** | Vercel handles deployment. Ingestion scripts run locally or via cron. No containerization needed. |

---

## 3. Project Structure

```
/
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout — disclaimers footer
│   ├── page.tsx                  # Chat page (protected)
│   ├── login/
│   │   └── page.tsx              # Login page with privacy notice
│   └── api/
│       ├── query/
│       │   └── route.ts          # POST /api/query — Q&A endpoint
│       ├── conversations/
│       │   ├── route.ts          # GET /api/conversations
│       │   └── [id]/
│       │       └── messages/
│       │           └── route.ts  # GET /api/conversations/:id/messages
│       ├── documents/
│       │   └── route.ts          # GET /api/documents
│       ├── glossary/
│       │   └── [term]/
│       │       └── route.ts      # GET /api/glossary/:term
│       └── auth/
│           ├── login/
│           │   └── route.ts      # POST /api/auth/login
│           └── logout/
│               └── route.ts      # POST /api/auth/logout
│
├── lib/                          # Shared server-side logic
│   ├── supabase/
│   │   ├── client.ts             # Supabase client (anon key — browser)
│   │   ├── server.ts             # Supabase client (service role — server)
│   │   └── schema.sql            # Database schema (source of truth)
│   ├── rag/
│   │   ├── retrieval.ts          # Hybrid search: vector + BM25 + RRF + FlashRank
│   │   ├── embeddings.ts         # OpenAI embedding calls
│   │   └── intent.ts             # Intent classification (8 categories)
│   ├── language-detect.ts        # Step 0: Language detection (en/tl/taglish/other)
│   ├── translate.ts              # Step 1: Filipino → English translation (GPT-4o-mini)
│   ├── paste-detect.ts           # Step 2: ICC document vs social media classification
│   ├── fact-check.ts             # Fact-check claim extraction, verification, verdict logic
│   ├── llm/
│   │   ├── generate.ts           # LLM answer generation with system prompt
│   │   ├── judge.ts              # LLM-as-Judge verification
│   │   └── prompts.ts            # System prompt constants (generation + judge)
│   ├── auth/
│   │   ├── session.ts            # Cookie/JWT session management
│   │   └── middleware.ts         # Route protection middleware
│   ├── cost/
│   │   └── tracking.ts           # Usage tracking, cap checks, daily limits
│   └── cleaning/
│       ├── pipeline.ts           # CLEAN-01 through CLEAN-10 in order
│       ├── validators.ts         # VAL-01 through VAL-10
│       └── corrections.ts        # OCR corrections list (CLEAN-04)
│
├── components/                   # React components
│   ├── chat/
│   │   ├── ChatMessage.tsx       # Single message (user or assistant)
│   │   ├── ChatInput.tsx         # Text input + paste-text area + send
│   │   ├── CitationMarker.tsx    # Clickable [1] badge
│   │   ├── SourcePassage.tsx     # Citation preview panel/popup
│   │   └── PasteTextWarning.tsx  # ⚠ unverified paste-text banner
│   ├── sidebar/
│   │   ├── ConversationList.tsx  # List of conversations
│   │   └── NewConversation.tsx   # "New Conversation" button
│   ├── layout/
│   │   ├── Footer.tsx            # Disclaimers (always visible)
│   │   └── LoadingState.tsx      # Loading indicator during LLM processing
│   └── auth/
│       └── LoginForm.tsx         # Username + password form
│
├── scripts/                      # Offline scripts (not deployed to Vercel)
│   ├── ingest.ts                 # Full ingestion pipeline (Job 1 + Job 2)
│   ├── add-user.ts               # Admin: create user account
│   ├── cleanup-expired.ts        # Delete conversations older than 7 days
│   └── seed-urls.ts              # Curated URL list from PRD §15.1
│
├── .env.local                    # API keys (gitignored)
├── .gitignore
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.ts
│
├── constitution.md               # Governing principles
├── prd.md                        # Product requirements
├── nl-interpretation.md          # NL interpretation contract
├── data-quality.md               # Data quality rules
├── prompt-spec.md                # System prompt specification
├── TASKS.md                      # Implementation task breakdown
├── ARCHITECTURE.md               # This file
└── handoff-checklist.md          # Pre-implementation verification
```

### Directory Conventions

| Directory | Rule |
|-----------|------|
| `app/api/` | Server-only. Every route handler validates auth, checks cost caps, and returns typed JSON. |
| `lib/` | Shared server logic. No React imports. No browser APIs. Importable by both API routes and scripts. |
| `components/` | Client components only. No direct Supabase or OpenAI calls — always go through API routes. |
| `scripts/` | CLI-only scripts. Not deployed to Vercel. Run locally with `npx tsx scripts/ingest.ts`. |

---

## 4. Database Schema

All tables live in Supabase PostgreSQL. Schema managed via `lib/supabase/schema.sql`.

### 4.1 Tables

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- ICC Documents (knowledge base source)
-- ============================================
CREATE TABLE icc_documents (
  document_id   TEXT PRIMARY KEY,           -- e.g., "doc_duterte_dcc_2025_09"
  title         TEXT NOT NULL,
  url           TEXT NOT NULL UNIQUE,
  document_type TEXT NOT NULL CHECK (document_type IN ('case_record', 'press_release', 'legal_text', 'case_info_sheet')),
  date_published DATE,
  rag_index     INTEGER NOT NULL CHECK (rag_index IN (1, 2)),  -- 1 = legal framework, 2 = case documents
  content_hash  TEXT NOT NULL,              -- SHA-256 of cleaned content, for dedup
  last_crawled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- Document Chunks (embedded for retrieval)
-- ============================================
CREATE TABLE document_chunks (
  chunk_id      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  document_id   TEXT NOT NULL REFERENCES icc_documents(document_id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  embedding     vector(1536) NOT NULL,      -- OpenAI text-embedding-3-small
  chunk_index   INTEGER NOT NULL,           -- Order within document
  token_count   INTEGER NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'  -- {document_title, url, date_published, document_type, rag_index}
);

-- Indexes for hybrid search
CREATE INDEX idx_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_chunks_document ON document_chunks (document_id);
CREATE INDEX idx_chunks_rag_index ON document_chunks ((metadata->>'rag_index'));

-- Full-text search index (BM25 equivalent)
ALTER TABLE document_chunks ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;
CREATE INDEX idx_chunks_fts ON document_chunks USING GIN (fts);

-- ============================================
-- Users (admin-created, no self-registration)
-- ============================================
CREATE TABLE users (
  user_id       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,              -- bcrypt
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- Conversations (7-day auto-expiry)
-- ============================================
CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title           TEXT,                     -- Auto-generated from first message
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE INDEX idx_conversations_user ON conversations (user_id);
CREATE INDEX idx_conversations_expires ON conversations (expires_at);

-- ============================================
-- Messages (conversation history)
-- ============================================
CREATE TABLE messages (
  message_id      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content         TEXT NOT NULL,
  citations       JSONB,                    -- Array of citation objects (assistant messages only)
  warning         TEXT,                     -- Paste-text unverified warning (if applicable)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at);

-- ============================================
-- Usage Tracking (cost controls)
-- ============================================
CREATE TABLE usage_tracking (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id         TEXT NOT NULL REFERENCES users(user_id),
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  query_count     INTEGER NOT NULL DEFAULT 0,
  tokens_used     INTEGER NOT NULL DEFAULT 0,
  estimated_cost  NUMERIC(10, 6) NOT NULL DEFAULT 0,
  UNIQUE (user_id, date)
);

CREATE TABLE global_usage (
  month           TEXT PRIMARY KEY,          -- e.g., "2026-03"
  total_cost      NUMERIC(10, 4) NOT NULL DEFAULT 0,
  cost_cap        NUMERIC(10, 4) NOT NULL DEFAULT 10.00,  -- Monthly cap in USD
  is_read_only    BOOLEAN NOT NULL DEFAULT FALSE
);

-- ============================================
-- Document Version Log (change tracking)
-- ============================================
CREATE TABLE document_versions (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  document_id     TEXT NOT NULL REFERENCES icc_documents(document_id),
  old_content_hash TEXT NOT NULL,
  new_content_hash TEXT NOT NULL,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4.2 Key SQL Functions

```sql
-- Vector similarity search (cosine distance)
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(1536),
  match_count INT DEFAULT 10,
  match_threshold FLOAT DEFAULT 0.68,
  filter_rag_index INT DEFAULT NULL
)
RETURNS TABLE (
  chunk_id TEXT,
  document_id TEXT,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.chunk_id,
    dc.document_id,
    dc.content,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  WHERE
    (filter_rag_index IS NULL OR (dc.metadata->>'rag_index')::int = filter_rag_index)
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Full-text search (BM25 equivalent)
CREATE OR REPLACE FUNCTION search_chunks_bm25(
  search_query TEXT,
  match_count INT DEFAULT 10,
  filter_rag_index INT DEFAULT NULL
)
RETURNS TABLE (
  chunk_id TEXT,
  document_id TEXT,
  content TEXT,
  metadata JSONB,
  rank FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.chunk_id,
    dc.document_id,
    dc.content,
    dc.metadata,
    ts_rank(dc.fts, plainto_tsquery('english', search_query)) AS rank
  FROM document_chunks dc
  WHERE
    dc.fts @@ plainto_tsquery('english', search_query)
    AND (filter_rag_index IS NULL OR (dc.metadata->>'rag_index')::int = filter_rag_index)
  ORDER BY rank DESC
  LIMIT match_count;
END;
$$;
```

### 4.3 Data Lifecycle

| Data | Created | Expires | Deletion Method |
|------|---------|---------|----------------|
| ICC documents + chunks | Ingestion pipeline | Never (replaced on update) | `ON DELETE CASCADE` when document replaced |
| Users | Admin script | Never | Manual admin deletion |
| Conversations | User creates | 7 days from last message | `scripts/cleanup-expired.ts` cron + `expires_at` index |
| Messages | Each Q&A turn | With parent conversation | `ON DELETE CASCADE` |
| Usage tracking | Each query | Never (audit trail) | Manual cleanup if needed |
| Document versions | On document update | Never (audit trail) | — |

---

## 5. Request Flow — Query Pipeline

```
User types question
        │
        ▼
┌─────────────────┐
│  POST /api/query │
│                  │
│  1. Auth check   │ ── fail → 401 redirect to /login
│  2. Cost cap     │ ── exceeded → 429 "monthly limit reached"
│  3. Daily limit  │ ── exceeded → proceed + nudge flag
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│ 6-Step Pipeline │  Step 0: Language detect → Step 1: Translate (if Filipino) → Step 2: Paste detect (if pasted)
│ (lib/)           │  Step 3: Hard gates → Step 4: Regex → Step 5: LLM classify → Step 6: Cross-validate
└────────┬─────────┘
         │
         ├── out_of_scope → return flat decline immediately (no RAG, no LLM)
         │
         ▼
┌─────────────────┐
│  RAG Retrieval   │
│ (lib/rag/        │
│  retrieval)      │
│                  │
│  1. Embed query  │  OpenAI text-embedding-3-small
│  2. Vector search│  pgvector cosine similarity → top 10
│  3. BM25 search  │  PostgreSQL full-text → top 10
│  4. RRF fusion   │  Reciprocal Rank Fusion merge
│  5. FlashRank    │  Rerank → top 4
│  6. Threshold    │  Filter < 0.68
└────────┬─────────┘
         │
         ├── 0 chunks above threshold → return "not in ICC records"
         │
         ▼
┌─────────────────┐
│  If paste_text:  │
│  Cross-reference │  Hybrid search on pasted text
│  against KB      │  Set paste_text_matched = true/false
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│  LLM Generation  │  gpt-4o-mini
│ (lib/llm/        │  Also used for: Tanglish/Tagalog→English translation, paste content auto-detection (LLM fallback)
│  generate)       │
│                  │
│  Inputs:         │
│  - System prompt │  (static rules + few-shot examples)
│  - Retrieved     │  (top 4 chunks, formatted)
│    chunks        │
│  - Query type    │
│  - Pasted text   │  (if paste_text query)
│  - Conversation  │  (last 5 turns)
│    history       │
│  - User query    │
│  - response_     │
│    language      │  (en | tl | taglish)
│                  │
│  Output:         │
│  - Answer text   │
│  - Citations     │  (parsed from inline [N] markers)
│  - Warning       │  (if paste_text unmatched)
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│ Claim Grounding  │  verifyEnumeratedClaims() — strip ungrounded list items
│ (lib/claim-      │
│  verifier)       │
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│  LLM-as-Judge    │  gpt-4o-mini (second call)
│ (lib/llm/judge)  │
│                  │
│  Input: answer   │
│       + chunks   │
│                  │
│  Output: APPROVE │
│       or REJECT  │
└────────┬─────────┘
         │
         ├── REJECT → return "could not be verified" fallback
         │
         ▼
┌─────────────────┐
│  Persist & Return│
│                  │
│  1. Save message │  to messages table
│  2. Log usage    │  to usage_tracking
│  3. Update       │  conversation.last_message_at + expires_at
│  4. Return JSON  │  {answer, citations, verified, ...}
└─────────────────┘
```

**Latency budget (soft goal: <10s total):**

| Step | Expected | Notes |
|------|----------|-------|
| Intent classification | ~0.5s | Single LLM call, short response |
| Embedding query | ~0.3s | OpenAI API call |
| Vector + BM25 search | ~0.5s | Supabase queries in parallel |
| FlashRank reranking | ~0.2s | Local, no network |
| LLM generation | ~3–5s | Main bottleneck |
| LLM-as-Judge | ~1–2s | Shorter prompt, single-word response |
| DB writes | ~0.3s | Supabase inserts |
| **Total** | **~6–9s** | Within 10s soft goal |

---

## 6. Ingestion Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│  Job 1: Known URLs (weekly)                                      │
│                                                                  │
│  seed-urls.ts → for each URL:                                    │
│    Firecrawl scrape → content_hash check → if changed:           │
│      CLEAN-01..10 → Unstructured.io parse → LangChain chunk →   │
│      OpenAI embed → Supabase upsert                             │
│                                                                  │
│  Job 2: Discovery (weekly, after Job 1)                          │
│                                                                  │
│  Firecrawl scrape case records page → extract new URLs →         │
│    for each new URL: same pipeline as Job 1                      │
└─────────────────────────────────────────────────────────────────┘
```

**Cleaning pipeline order** (from data-quality.md §3):

```
CLEAN-01 → Strip HTML boilerplate (HTML only)
CLEAN-02 → Fix UTF-8 mojibake
CLEAN-03 → Strip LaTeX math artifacts
CLEAN-10 → Strip repeated page headers/footers
CLEAN-09 → Strip image refs and copyright
CLEAN-08 → Strip checkbox/form artifacts
CLEAN-06 → Separate inline footnote superscripts
CLEAN-05 → Flatten broken tables
CLEAN-07 → Normalize [REDACTED] markers
CLEAN-04 → Apply OCR corrections (last)
```

**Chunking strategy:**

| Parameter | RAG 1 (Legal Framework) | RAG 2 (Case Documents) |
|-----------|------------------------|----------------------|
| Chunk size | 600 tokens | 400 tokens |
| Overlap | 60 tokens | 40 tokens |
| Method | By article/rule/section heading | By paragraph |

---

## 7. API Contract Summary

All endpoints require authentication (cookie/JWT) except `POST /api/auth/login`.

### 7.1 Core Endpoints

| Method | Path | Purpose | Auth | Spec Reference |
|--------|------|---------|------|---------------|
| `POST` | `/api/auth/login` | Authenticate user | No | PRD §4 (Auth) |
| `POST` | `/api/auth/logout` | End session | Yes | PRD §4 (Auth) |
| `POST` | `/api/chat` | Submit question (general, paste_text, or glossary) | Yes | PRD §10, prompt-spec.md §6.1 |
| `GET` | `/api/conversations` | List user's conversations | Yes | PRD §10 |
| `GET` | `/api/conversations/:id/messages` | Get messages for a conversation | Yes | PRD §10 |
| `DELETE` | `/api/conversations/:id` | Delete a conversation | Yes | PRD §2 |
| `PATCH` | `/api/conversations/:id` | Update conversation (bookmark, title, response_language) | Yes | PRD §2, prd-v2 §10. Accepts `response_language` (en \| tl \| taglish) |

### 7.2 Request/Response Shapes

**POST /api/query — Request:**

```typescript
interface QueryRequest {
  query: string;                    // User's question
  query_type: 'general' | 'paste_text' | 'glossary';
  conversation_id: string;         // Existing or new conversation
  pasted_text?: string;            // Only for paste_text queries
}
```

**POST /api/query — Response:**

```typescript
interface QueryResponse {
  answer: string;                   // Full answer with inline [N] markers
  citations: Citation[];            // Citation objects
  warning: string | null;          // Paste-text unverified warning
  verified: boolean;               // LLM-as-Judge result
  intent_category: IntentCategory;  // Classified intent
  rag_index_used: 1 | 2 | null;   // Which index was queried
  knowledge_base_last_updated: string; // ISO 8601 date
  daily_limit_reached?: boolean;   // Nudge flag
}

interface Citation {
  citation_marker: string;          // "[1]"
  document_title: string;
  url: string;
  date_published: string;
  source_passage: string;           // Exact chunk text for click-to-view
}

type IntentCategory =
  | 'case_facts'
  | 'case_timeline'
  | 'legal_concept'
  | 'procedure'
  | 'glossary'
  | 'paste_text'
  | 'out_of_scope';
```

**POST /api/auth/login — Request/Response:**

```typescript
interface LoginRequest {
  username: string;
  password: string;
}

interface LoginResponse {
  success: boolean;
  user_id?: string;
  error?: string;                   // "Invalid username or password"
}
```

---

## 8. Key Technical Decisions

### 8.1 Decisions Made

| Decision | Choice | Why | Alternatives Rejected |
|----------|--------|-----|----------------------|
| **Single API endpoint for all query types** | `POST /api/query` with `query_type` field | Simplifies frontend; intent classification happens server-side | Separate endpoints per query type (over-engineering) |
| **Two LLM calls per query** | Generation + Judge, both gpt-4o-mini | Non-negotiable safety net; every answer verified before display (constitution Principle 9) | Single call (unsafe), streaming (can't verify before display) |
| **Hybrid search (vector + BM25)** | Both searches run in parallel, merged with RRF | Legal text has specific terminology (BM25 catches "Article 7(1)(a)") that pure semantic search misses | Vector-only (misses exact legal references), BM25-only (misses semantic similarity) |
| **FlashRank over Cohere reranking** | Local library, no API key, free | Sufficient quality for iteration 1; no network latency; can swap later | Cohere (paid, API dependency), no reranking (lower retrieval quality) |
| **Intent classification as a separate LLM call** | Classify first, then route to correct RAG index | Prevents RAG 1 chunks appearing in case fact answers; enables flat decline without RAG | Embed intent in generation prompt (can't filter RAG index before retrieval) |
| **Conversation title auto-generated** | First user message truncated to ~50 chars | No user friction; works for a small private user base | User-provided titles (unnecessary friction), no titles (hard to find conversations) |
| **Cookie-based sessions over JWT** | HTTP-only cookie with session token | Simpler, no token refresh logic, no client-side storage of secrets | JWT (more complex, token expiry management, client-side storage) |
| **Ingestion scripts run locally** | `npx tsx scripts/ingest.ts` from terminal | No server-side cron needed for iteration 1; admin runs manually or via local crontab | Vercel Cron (limited on free tier), Supabase Edge Functions (added complexity) |
| **No separate API server** | Next.js API routes serve everything | One deployment unit; Vercel handles scaling; no CORS issues | Express backend (two deployments, CORS, more infrastructure) |
| **pgvector IVFFlat over HNSW** | IVFFlat index with 100 lists | Sufficient for <5,000 chunks; simpler to configure; can migrate to HNSW if needed | HNSW (better recall at scale, but more complex and more memory) |

### 8.2 Decisions Deferred

| Decision | When to Decide | Impact if Delayed |
|----------|---------------|-------------------|
| **Conversation title generation strategy** | Task Group 8 (Chat UI) | Low — truncated first message is the fallback |
| **Exact FlashRank model** | Task Group 4 (RAG Retrieval) | Low — test with default model, swap if quality is poor |
| **IVFFlat lists parameter (currently 100)** | After ingestion, when chunk count is known | Medium — too few lists = slow search; too many = poor recall. Rule of thumb: `sqrt(n_chunks)` |
| **Session expiry duration** | Task Group 7 (Auth) | Low — start with 24h, adjust based on usage |
| **Conversation auto-title or manual** | Task Group 8 (Chat UI) | Low — start with auto (first message truncated) |
| **Mobile responsiveness** | Future iteration | High for target audience but explicitly deferred (PRD §1) |

---

## 9. Security

| Concern | Mitigation |
|---------|-----------|
| **API keys in client code** | `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` are server-side only. Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are exposed to the browser. |
| **Password storage** | bcrypt with salt rounds ≥ 10. Never store plaintext. |
| **SQL injection** | Supabase JS client uses parameterized queries. SQL functions use PL/pgSQL parameters. |
| **XSS** | React escapes output by default. Never use `dangerouslySetInnerHTML` on user input or LLM output. Sanitize markdown rendering. |
| **CSRF** | Cookie-based auth uses `SameSite=Strict` and HTTP-only flags. |
| **Conversation isolation** | Every database query filters by `user_id` from the authenticated session. No endpoint exposes another user's data. |
| **LLM prompt injection** | LLM-as-Judge catches hallucinated or off-topic answers. System prompt has hard rules. User input is never concatenated into prompts without the template structure. |
| **Rate limiting** | Soft daily limit per user (30 queries/day). Global monthly cost cap. OpenAI rate limits as backstop. |
| **Sensitive data in logs** | No conversation content in logs. Only counts, timing, and error types. (constitution Principle 6) |
| **`.env.local` exposure** | Gitignored. Vercel environment variables set via dashboard, never in code. |

---

## 10. Cost Model

### 10.1 Per-Query Cost Estimate

| Component | Input tokens | Output tokens | Cost per query |
|-----------|-------------|---------------|---------------|
| Intent classification | ~200 | ~20 | ~$0.00003 |
| Query embedding | ~50 | — | ~$0.000001 |
| LLM generation | ~5,000 (prompt + chunks) | ~500 | ~$0.001 |
| LLM-as-Judge | ~2,000 (answer + chunks) | ~5 | ~$0.0003 |
| **Total per query** | | | **~$0.0013** |

### 10.2 Monthly Cost Projection

| Scenario | Queries/month | Monthly cost | Within $10 cap? |
|----------|--------------|-------------|-----------------|
| Light usage (5 users, 5 queries/day) | ~750 | ~$1.00 | Yes |
| Moderate (5 users, 15 queries/day) | ~2,250 | ~$2.90 | Yes |
| Heavy (5 users, 30 queries/day) | ~4,500 | ~$5.85 | Yes |
| Abuse (1 user, 100 queries/day) | ~3,000 | ~$3.90 | Yes (soft limit kicks in at 30/day) |

### 10.3 Ingestion Cost (One-Time + Weekly)

| Component | Volume | Cost |
|-----------|--------|------|
| Firecrawl (13 URLs) | 13 credits | Free (500/month) |
| Embeddings (~2,000 chunks × 1536 dims) | ~1M tokens | ~$0.02 |
| **Total per ingestion run** | | **~$0.02** |

---

## 11. Environment Variables

| Variable | Where Used | Secret? | Set In |
|----------|-----------|---------|--------|
| `OPENAI_API_KEY` | Server (API routes + scripts) | Yes | `.env.local`, Vercel dashboard |
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | No | `.env.local`, Vercel dashboard |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client (browser) | No | `.env.local`, Vercel dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Yes | `.env.local`, Vercel dashboard |
| `FIRECRAWL_API_KEY` | Scripts only (not deployed) | Yes | `.env.local` only |
| `AUTH_SECRET` | Session signing (JWT) | Yes | `.env.local`, Vercel |
| `LANGSMITH_TRACING` | Optional: enable LLM tracing | No | `true` to enable |
| `LANGSMITH_API_KEY` | Optional: LangSmith API key | Yes | smith.langchain.com |
| `LANGSMITH_PROJECT` | Optional: project name for traces | No | e.g. `the-docket` |

**Rule:** Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser. All others are server-side only. Never prefix a secret with `NEXT_PUBLIC_`.

---

## 12. Things You'll Regret Not Deciding Upfront

| Thing | Decision | Why it matters |
|-------|----------|---------------|
| **Schema first, code second** | `lib/supabase/schema.sql` is the source of truth. Run it before writing any application code. | Changing schema after data is ingested means re-ingesting everything. |
| **TypeScript interfaces for all API responses** | Define `QueryResponse`, `Citation`, `ConversationSummary` etc. in a shared types file before building any endpoint or component. | Frontend and backend will drift if types aren't shared. |
| **System prompt as a constant, not a template literal** | Store the full prompt in `lib/llm/prompts.ts` as a versioned constant. Never build prompts with string concatenation in route handlers. | Prompt drift is the #1 cause of LLM behavior bugs. Centralize it. |
| **Cleaning pipeline as composable functions** | Each CLEAN rule is a pure function: `(text: string) => string`. Pipeline is `pipe(CLEAN_01, CLEAN_02, ..., CLEAN_10)`. | Makes it trivial to add/remove/reorder rules without touching other code. |
| **Supabase RPC for search, not raw SQL in app code** | Vector search and BM25 search are SQL functions called via `supabase.rpc()`. | Keeps complex queries in the database, not scattered across route handlers. |
| **Conversation expiry is a cron, not a query filter** | Actually delete expired conversations (not just hide them). Run `scripts/cleanup-expired.ts` daily. | Query-time filtering accumulates dead data. Cron keeps the database clean. |
| **Error responses are typed and consistent** | Every API error returns `{ error: string, code: string }`. Frontend has one error handler. | Ad-hoc error shapes cause frontend bugs that are hard to trace. |
| **Log at pipeline boundaries, not inside functions** | Log input count → output count at each step of retrieval and ingestion. | When "no results" happens, you need to know which step dropped them. |
| **Never trust the LLM's citation markers** | Parse `[1]`, `[2]` from the answer text and map them back to the retrieved chunks you actually sent. If a marker references a chunk you didn't send, strip it. | LLMs can hallucinate citation numbers. Always validate against the chunks you provided. |
| **`.cursorrules` file** | Create during Task 1.1. Reference all spec docs so the AI agent knows the full context. | Without this, the AI agent will guess instead of reading the specs. |
