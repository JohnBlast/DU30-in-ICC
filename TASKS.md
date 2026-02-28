# The Docket — Implementation Tasks

> **What this is:** Ordered, verifiable implementation tasks for Iteration 1. Each task is small enough to verify individually, ordered by dependency, and references the spec section it implements.
>
> **Rule:** Never start Task N+1 until Task N is verified. See `9 - testing-guide.md`.

---

## 0. External Setup (You Do This — Outside the IDE)

These steps must be completed before any implementation begins. They require signing up for services, creating accounts, and copying API keys.

### Step 1: OpenAI Account (Pay-as-you-go)

**What it's for:** LLM answer generation (`gpt-4o-mini`) + embeddings (`text-embedding-3-small`)
**Cost:** Pay-as-you-go. Estimated ~$2–5/month for small user base.

1. Go to [platform.openai.com](https://platform.openai.com)
2. Sign up or log in
3. Go to **Settings → Billing** → Add a payment method
4. Set a monthly spending limit (e.g., $10/month) to match the PRD's global cost cap
5. Go to **API Keys** → **Create new secret key**
6. Name it `the-docket-dev`
7. Copy the key immediately (you won't see it again)
8. Save it somewhere safe — you'll add it to `.env.local` later as `OPENAI_API_KEY`

### Step 2: Supabase Project (Free Tier)

**What it's for:** PostgreSQL database, pgvector (vector search), BM25 index, user auth, conversation storage
**Cost:** Free (500 MB database, 1 GB storage, 2 GB bandwidth)

1. Go to [supabase.com](https://supabase.com)
2. Sign up with GitHub
3. Click **New Project**
4. Name: `the-docket`
5. Database password: generate a strong one and save it
6. Region: choose the closest to your users (e.g., Southeast Asia if targeting Filipino users)
7. Wait for the project to provision (~2 minutes)
8. Go to **Settings → API** and copy these three values:
   - **Project URL** → save as `NEXT_PUBLIC_SUPABASE_URL`
   - **anon (public) key** → save as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role (secret) key** → save as `SUPABASE_SERVICE_ROLE_KEY`
9. Go to **SQL Editor** and run:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
   This enables pgvector for vector search.

### Step 3: Firecrawl Account (Free Tier)

**What it's for:** Scraping ICC documents (HTML pages + PDFs)
**Cost:** Free tier = 500 credits/month (1 credit = 1 scrape). Sufficient for initial ingestion + weekly re-scrapes of ~13 URLs.

1. Go to [firecrawl.dev](https://firecrawl.dev)
2. Sign up
3. Go to **Dashboard → API Keys**
4. Copy the key
5. Save as `FIRECRAWL_API_KEY`

### Step 4: Vercel Account (Free Hobby Tier)

**What it's for:** Hosting the Next.js application
**Cost:** Free (hobby tier). Sufficient for small user base.

1. Go to [vercel.com](https://vercel.com)
2. Sign up with GitHub
3. You'll link your repository later during deployment (Task Group 11)
4. No API key needed — Vercel CLI uses your login session

### Step 5: Create `.env.local` Template

After steps 1–4, create a file called `.env.local` in the project root with these values:

```
# OpenAI
OPENAI_API_KEY=sk-...your-key-here...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...your-anon-key...
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key...

# Firecrawl
FIRECRAWL_API_KEY=fc-...your-key-here...
```

**Important:** `.env.local` is automatically gitignored by Next.js. Never commit API keys.

### No Signup Needed

These are free open-source libraries installed during Task Group 1:

| Library | Install command | What it does |
|---------|----------------|--------------|
| **Unstructured** | `pip install "unstructured[pdf]"` | PDF/HTML parsing |
| **FlashRank** | `pip install flashrank` | Reranking retrieved chunks |
| **LangChain** | `npm install langchain` | Text splitting (chunking) |

---

## Implementation Tasks

### Task Group 1: Project Setup

**Dependency:** External Setup (Step 0) complete. `.env.local` exists with all keys.

| # | Task | Spec Reference | Verify By |
|---|------|---------------|-----------|
| 1.1 | Initialize Next.js app with TypeScript and Tailwind CSS | — | `npm run dev` starts without errors; localhost shows default page |
| 1.2 | Install Supabase client: `npm install @supabase/supabase-js` | PRD §4 | Import resolves without error |
| 1.3 | Install OpenAI client: `npm install openai` | PRD §4 | Import resolves without error |
| 1.4 | Install Firecrawl client: `npm install @mendable/firecrawl-js` | PRD §12 | Import resolves without error |
| 1.5 | Install LangChain text splitter: `npm install langchain` | PRD §15.1 | Import resolves without error |
| 1.6 | Configure environment variables — verify `.env.local` is loaded | — | `console.log(process.env.OPENAI_API_KEY)` prints the key in server-side code |
| 1.7 | Create project folder structure: `/app`, `/lib`, `/components`, `/scripts` | — | Folders exist |

---

### Task Group 2: Database Schema

**Dependency:** Task Group 1 complete. Supabase project provisioned with pgvector enabled.

| # | Task | Spec Reference | Verify By |
|---|------|---------------|-----------|
| 2.1 | Create `icc_documents` table: `document_id`, `title`, `url`, `document_type`, `date_published`, `rag_index`, `content_hash`, `last_crawled_at` | PRD §5 | Table visible in Supabase dashboard; columns match spec |
| 2.2 | Create `document_chunks` table: `chunk_id`, `document_id` (FK), `content`, `embedding` (vector(1536)), `chunk_index`, `token_count`, `metadata` (jsonb) | PRD §5 | Table visible; embedding column is vector type |
| 2.3 | Create `users` table: `user_id`, `username`, `password_hash`, `created_at`, `is_admin` | PRD §4 (Auth) | Table visible; no plaintext passwords |
| 2.4 | Create `conversations` table: `conversation_id`, `user_id` (FK), `title`, `created_at`, `last_message_at`, `expires_at` (7 days from last message) | PRD §4 (Multi-Turn) | Table visible; `expires_at` defaults to 7 days |
| 2.5 | Create `messages` table: `message_id`, `conversation_id` (FK), `role` (user/assistant), `content`, `citations` (jsonb), `created_at` | PRD §4 (Multi-Turn) | Table visible |
| 2.6 | Create `usage_tracking` table: `id`, `user_id`, `date`, `query_count`, `global_month`, `global_total_cost` | PRD §4 (Cost Controls) | Table visible |
| 2.7 | Create vector similarity search function in Supabase (SQL function for cosine distance) | PRD §15.2 | Function callable via Supabase RPC |
| 2.8 | Create BM25 index on `document_chunks.content` using Supabase full-text search | PRD §15.2 | Full-text search query returns results |
| 2.9 | Seed admin user: insert yourself with hashed password | PRD §4 (Auth) | Can query the user from Supabase dashboard |

---

### Task Group 3: Ingestion Pipeline

**Dependency:** Task Group 2 complete. Database tables exist.

| # | Task | Spec Reference | Verify By |
|---|------|---------------|-----------|
| 3.1 | Create ingestion script (`/scripts/ingest.ts`) with Firecrawl scrape-mode for a single URL | PRD §12, §15.1 | Script scrapes one ICC URL and logs the output |
| 3.2 | Implement CLEAN-01: strip HTML boilerplate from scraped HTML pages | data-quality.md §2.1 | HTML output contains only substantive content (no nav/footer/social) |
| 3.3 | Implement CLEAN-02: fix UTF-8 mojibake (use API response directly; fallback re-encode) | data-quality.md §2.1 | No `Ã` mojibake signatures in output |
| 3.4 | Implement CLEAN-03: strip LaTeX math artifacts (`$...$`, `\mathrm`) | data-quality.md §2.1 | No `$` delimiters in body text |
| 3.5 | Implement CLEAN-10: strip repeated page headers/footers from PDFs | data-quality.md §2.3 | No line repeats verbatim more than 3 times |
| 3.6 | Implement CLEAN-09: strip image refs and copyright lines | data-quality.md §2.3 | No `![` image markdown or `©` lines |
| 3.7 | Implement CLEAN-08: strip checkbox/form artifacts | data-quality.md §2.3 | No `☒` or `☐` characters |
| 3.8 | Implement CLEAN-06: separate inline footnote superscripts | data-quality.md §2.2 | Footnotes separated without damaging legal references |
| 3.9 | Implement CLEAN-05: flatten broken tables | data-quality.md §2.2 | Tables rendered as `{Label}: {Value}` format |
| 3.10 | Implement CLEAN-07: normalize REDACTED markers to `[REDACTED]` | data-quality.md §2.3 | All variants normalized; no escaped `\[REDACTED\]` |
| 3.11 | Implement CLEAN-04: OCR corrections list (static key-value replacements) | data-quality.md §2.2 | `('MMm.` → `('DDS')` and any other known corrections applied |
| 3.12 | Implement validation checks VAL-01 through VAL-10 | data-quality.md §4.1 | All 10 validation checks pass on cleaned output |
| 3.13 | Parse cleaned text with Unstructured.io (PDF → plain text, HTML → plain text) | PRD §12.2 | Parsed output preserves headings and legal numbering |
| 3.14 | Chunk parsed text with LangChain splitter: RAG 1 = 600 tokens/60 overlap; RAG 2 = 400 tokens/40 overlap | PRD §15.1 | Chunks are correct size; metadata (document_id, title, url, date, rag_index) attached |
| 3.15 | Generate embeddings with OpenAI `text-embedding-3-small` (1536 dimensions) | PRD §15.1 | Each chunk has a 1536-dimension vector |
| 3.16 | Store chunks + embeddings in Supabase `document_chunks` table | PRD §12.2 | Chunks queryable in Supabase; vector column populated |
| 3.17 | Implement content hash deduplication: skip re-ingestion if hash matches | PRD §4 (Ingestion) | Re-running script on same URL produces no duplicate chunks |
| 3.18 | Run full ingestion on all 13 URLs from PRD §15.1 validated URL list | PRD §15.1 | All documents ingested; spot-check 3 random chunks against original PDFs |
| 3.19 | Implement Job 2 — case records discovery: scrape filtered URL, extract new document links | PRD §12.1 | Script discovers and lists new filing URLs not already in `icc_documents` |

---

### Task Group 4: RAG Retrieval

**Dependency:** Task Group 3 complete. Knowledge base populated.

| # | Task | Spec Reference | Verify By |
|---|------|---------------|-----------|
| 4.1 | Implement vector search: embed user query → cosine similarity against `document_chunks` | PRD §15.2 | Query "What is Duterte charged with?" returns DCC chunks |
| 4.2 | Implement BM25 search: full-text search on `document_chunks.content` | PRD §15.2 | Same query returns relevant chunks via keyword match |
| 4.3 | Implement RRF (Reciprocal Rank Fusion) to merge vector + BM25 results | PRD §15.2 | Combined ranking produces better results than either alone |
| 4.4 | Implement FlashRank reranking on top-10 merged results → return top-4 | PRD §15.2 | Top-4 chunks are highly relevant to the query |
| 4.5 | Implement similarity threshold (0.68): filter out chunks below threshold | PRD §15.2 | Query with no good matches returns zero chunks |
| 4.6 | Implement mandatory `rag_index` filter: route queries to RAG 1 or RAG 2 based on intent | PRD §15.2 | Legal concept query hits RAG 1 only; case fact query hits RAG 2 only |
| 4.7 | Implement paste-text cross-reference: hybrid search on pasted text to find matching KB document | PRD §15.2 | Pasting DCC text matches to DCC chunks; random text returns no match |

---

### Task Group 5: LLM Integration

**Dependency:** Task Group 4 complete. RAG retrieval returns relevant chunks.

| # | Task | Spec Reference | Verify By |
|---|------|---------------|-----------|
| 5.1 | Implement system prompt from prompt-spec.md (all static sections) | prompt-spec.md §2 | System prompt matches spec |
| 5.2 | Implement dynamic injection: `{retrieved_chunks}` formatted per §7.1 template | prompt-spec.md §3, §7 | Chunks appear in prompt in correct format |
| 5.3 | Implement intent classification: classify user query into 7 intent categories | nl-interpretation.md §2.2 | "What is Duterte charged with?" → `case_facts`; "What does in absentia mean?" → `glossary` |
| 5.4 | Implement `{query_type}` injection based on classification | prompt-spec.md §3 | Query type appears in prompt |
| 5.5 | Implement `{pasted_text}` and `{paste_text_matched}` injection for paste-text queries | prompt-spec.md §3 | Paste-text queries include pasted text + match boolean in prompt |
| 5.6 | Implement `{conversation_history}` injection: last 5 turns from conversation | prompt-spec.md §3 | Follow-up questions have prior context in prompt |
| 5.7 | Implement `{knowledge_base_last_updated}` injection from Supabase metadata | prompt-spec.md §3 | Every answer ends with last-updated date |
| 5.8 | Parse LLM response into response contract JSON (answer, citations, warning, verified) | prompt-spec.md §6.1 | Response object matches contract shape |
| 5.9 | Implement citation extraction: map inline `[N]` markers to source passages from retrieved chunks | prompt-spec.md §6.1 | Each citation has document_title, date, url, source_passage |
| 5.10 | End-to-end test: query → RAG → LLM → parsed response with citations | PRD §17 E2E-01 | Full pipeline returns a cited answer |

---

### Task Group 6: LLM-as-Judge

**Dependency:** Task Group 5 complete. LLM generates answers.

| # | Task | Spec Reference | Verify By |
|---|------|---------------|-----------|
| 6.1 | Implement judge system prompt from prompt-spec.md §6.2 | prompt-spec.md §6.2 | Judge prompt matches spec |
| 6.2 | Implement judge call: send generated answer + retrieved chunks → receive APPROVE/REJECT | prompt-spec.md §6.2 | Judge returns APPROVE for good answers; REJECT for answers with unsupported claims |
| 6.3 | Implement block logic: on REJECT, replace answer with fallback message, set `verified = false` | prompt-spec.md §6.2 | Blocked answer shows: "This answer could not be verified..." |
| 6.4 | Implement judge error handling: if judge API fails, show service unavailable (never show unverified answer) | prompt-spec.md §8 | Judge timeout → user sees service unavailable message, NOT the unverified answer |

---

### Task Group 7: Authentication

**Dependency:** Task Group 2 complete (users table exists). Can be built in parallel with Task Groups 3–6.

| # | Task | Spec Reference | Verify By |
|---|------|---------------|-----------|
| 7.1 | Create login page: username + password form | PRD §4 (Auth) | Login page renders at `/login` |
| 7.2 | Implement password hashing with bcrypt on login verification | PRD §4 (Auth) | Passwords stored as hashes, never plaintext |
| 7.3 | Implement session management (cookie-based or JWT) | PRD §4 (Auth) | After login, user stays authenticated across page navigations |
| 7.4 | Implement route protection: redirect unauthenticated users to `/login` | PRD §4 (Auth) | Accessing `/` without login redirects to `/login` |
| 7.5 | Create admin script to add new users: `node scripts/add-user.ts <username> <password>` | PRD §4 (Auth) | Running script creates a user in the database with hashed password |

---

### Task Group 8: Chat UI

**Dependency:** Task Groups 5–7 complete. LLM pipeline works, auth works.

| # | Task | Spec Reference | Verify By |
|---|------|---------------|-----------|
| 8.1 | Create chat page layout: message list + input box + send button | PRD §3 Journey 1 | Chat page renders at `/` after login |
| 8.2 | Implement message display: user messages (right) and assistant messages (left) | PRD §3 Journey 1 | Messages appear in correct positions |
| 8.3 | Implement inline citation markers: `[1]`, `[2]` etc. rendered as clickable badges in the answer | PRD §4 (Source Transparency) | Citation markers are visible and clickable |
| 8.4 | Implement source passage preview: clicking a citation shows the source passage + ICC document URL | PRD §4 (Source Transparency), constitution Principle 4 | Click `[1]` → popup/panel shows the exact passage + link |
| 8.5 | Implement paste-text input: allow user to paste text into a dedicated area alongside their question | PRD §3 Journey 2 | Paste-text area visible; submitted alongside the question |
| 8.6 | Implement paste-text warning display: show ⚠ warning banner when `paste_text_matched = false` | PRD §4 (Paste-Text) | Unverified paste-text shows warning at top of answer |
| 8.7 | Implement conversation sidebar: list of conversations, "New Conversation" button | PRD §3 Journey 4 | Sidebar shows conversation list; clicking opens that conversation |
| 8.8 | Implement conversation creation and switching | PRD §4 (Multi-Turn) | Can create new conversation and switch between them |
| 8.9 | Implement conversation message persistence: save user + assistant messages to `messages` table | PRD §4 (Multi-Turn) | Messages persist across page refreshes |
| 8.10 | Implement loading state while LLM processes | PRD §4 | User sees loading indicator while waiting for response |
| 8.11 | Implement "Last updated from ICC records" footer on every answer | prompt-spec.md §2 (Section 7) | Every answer shows the date |

---

### Task Group 9: Cost Controls

**Dependency:** Task Group 5 complete (LLM calls work). Task Group 7 complete (auth works).

| # | Task | Spec Reference | Verify By |
|---|------|---------------|-----------|
| 9.1 | Track per-query cost: log estimated token usage per LLM call (generation + judge) | PRD §4 (Cost Controls) | Each query logs its cost to `usage_tracking` |
| 9.2 | Implement global monthly cap check: before each LLM call, check if cap is exceeded | PRD §4 (Cost Controls) | When cap is hit, LLM calls are blocked |
| 9.3 | Implement read-only mode UI: when cap is hit, show message with reset date, disable chat input | PRD §4 (Cost Controls) | Users see "monthly usage limit" message; can browse history but not query |
| 9.4 | Implement soft daily per-user limit: track queries per user per day; show nudge after limit | PRD §4 (Cost Controls) | After 30 queries, nudge message appears but queries still work |

---

### Task Group 10: Guardrails & Edge Cases

**Dependency:** Task Groups 5–8 complete. Full pipeline works with UI.

| # | Task | Spec Reference | Verify By |
|---|------|---------------|-----------|
| 10.1 | Test out-of-scope flat decline: "Was Duterte justified?" → flat decline, no engagement | nl-interpretation.md NL-24 | Response is exactly: "This is not addressed in current ICC records." |
| 10.2 | Test redacted content handling: "Who is [REDACTED]?" → acknowledge and stop | nl-interpretation.md NL-20 | Response acknowledges redaction; no investigation |
| 10.3 | Test non-English detection: "Ano yung charges?" → English-only message | nl-interpretation.md NL-30 | Response: "The Docket currently supports English only." |
| 10.4 | Implement conversation expiry: auto-delete conversations older than 7 days | PRD §4 (Multi-Turn) | Expired conversations are gone from sidebar and database |
| 10.5 | Implement expired conversation UX: show message prompting user to start a new conversation | PRD §4 (Multi-Turn) | User sees prompt to start new conversation |
| 10.6 | Test multi-turn neutrality erosion: ask neutral question, then "was that fair?" → flat decline | nl-interpretation.md NL-22 | Second response is flat decline despite prior context |
| 10.7 | Test paste-text with biased content: paste "Duterte is a murderer" + ask "Is this true?" → neutral response | nl-interpretation.md NL-19 | Response is neutral; does not adopt pasted language |
| 10.8 | Test LLM-as-Judge blocking: craft an answer with unsupported claims → judge rejects | prompt-spec.md §6.2 | Blocked answer shows fallback message |

---

### Task Group 11: Disclaimers, Polish & Deployment

**Dependency:** Task Groups 1–10 complete. All features working.

| # | Task | Spec Reference | Verify By |
|---|------|---------------|-----------|
| 11.1 | Add footer disclaimer: *"This is an independent AI tool. Not affiliated with or endorsed by the International Criminal Court."* | PRD Legal Bounds | Visible on every page |
| 11.2 | Add answer disclaimer: *"AI-generated summary based on ICC official documents."* | PRD Legal Bounds | Visible on every answer |
| 11.3 | Add data privacy notice on login page | PRD Legal Bounds | Visible on `/login` |
| 11.4 | Implement empty state: what the user sees before their first message | PRD §8 | Welcome message or prompt suggestions shown |
| 11.5 | Implement glossary link: when a legal term appears in an answer, link it to a glossary definition (if available) | PRD §4 (Glossary) | Legal terms in answers are linked/explained |
| 11.6 | Deploy to Vercel: import GitHub repo, configure environment variables | — | App accessible at production URL |
| 11.7 | Verify all E2E scenarios from PRD §17 (E2E-01 through E2E-17) | PRD §17 | All 17 scenarios produce expected output |
| 11.8 | Run handoff-checklist.md final verification | handoff-checklist.md | All items checked |

---

## Summary

| Group | Tasks | Depends On | Can Parallelize? |
|-------|-------|-----------|-----------------|
| 0. External Setup | 5 steps | Nothing | — |
| 1. Project Setup | 7 tasks | Step 0 | — |
| 2. Database Schema | 9 tasks | Group 1 | — |
| 3. Ingestion Pipeline | 19 tasks | Group 2 | — |
| 4. RAG Retrieval | 7 tasks | Group 3 | — |
| 5. LLM Integration | 10 tasks | Group 4 | — |
| 6. LLM-as-Judge | 4 tasks | Group 5 | — |
| 7. Authentication | 5 tasks | Group 2 | Yes — parallel with Groups 3–6 |
| 8. Chat UI | 11 tasks | Groups 5–7 | — |
| 9. Cost Controls | 4 tasks | Groups 5, 7 | — |
| 10. Guardrails & Edge Cases | 8 tasks | Groups 5–8 | — |
| 11. Disclaimers & Deploy | 8 tasks | Groups 1–10 | — |

**Total: 97 tasks across 12 groups (including external setup)**
