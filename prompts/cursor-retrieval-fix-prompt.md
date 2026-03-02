# The Docket — Comprehensive System Status & Retrieval Fix Plan

## Table of Contents
1. [System Architecture Overview](#1-system-architecture-overview)
2. [What Was Done (Ingestion & Pipeline Changes)](#2-what-was-done)
3. [Current State Diagnosis](#3-current-state-diagnosis)
4. [Root Cause Analysis](#4-root-cause-analysis)
5. [Fix Plan (13 Steps)](#5-fix-plan)
6. [Verification](#6-verification)

---

## 1. System Architecture Overview

### What is The Docket?

The Docket is a RAG-based (Retrieval Augmented Generation) application that answers questions about the Duterte ICC case using only official ICC documents. It has two modes:
- **Q&A Mode**: User asks a question → system retrieves relevant ICC document chunks → LLM generates answer citing those chunks → Judge LLM verifies → response shown to user
- **Fact-Check Mode**: User pastes social media content → system extracts claims → retrieves relevant chunks → verifies each claim against chunks → produces per-claim verdicts (VERIFIED/FALSE/UNVERIFIABLE/NOT_IN_ICC_RECORDS/OPINION)

### Pipeline Architecture (8 Steps)

```
User Query
  ↓
Step 0: Language Detection (lib/language-detect.ts)
  - Detects: English, Tagalog, Taglish, Other
  ↓
Step 1: Translation (lib/translate.ts)
  - If Filipino → translate to English for processing
  ↓
Step 2: Paste Detection (lib/paste-detect.ts)
  - If user pasted text → classify as "social_media" (fact-check) or "icc_document" (paste_text)
  ↓
Step 3-6: Intent Classification (lib/intent-classifier.ts)
  - Layer 1: Deterministic gates (paste type, empty query, redaction)
  - Layer 2: Regex patterns (~40 patterns for case_facts, procedure, legal_concept, etc.)
  - Layer 3: LLM classification (gpt-4o-mini with INTENT_PROMPT)
  - Layer 4: Cross-validation (if Layer 2 and 3 disagree, Layer 2 wins)
  - Output: one of 8 intents (case_facts, case_timeline, legal_concept, procedure, glossary, paste_text, fact_check, out_of_scope)
  ↓
Step 7: Intent → RAG Index Mapping (lib/intent.ts)
  - case_facts, case_timeline → index 2 (case documents)
  - legal_concept, procedure, glossary → index 1 (legal framework)
  - fact_check, paste_text → [1, 2] (both)
  - requiresDualIndex() upgrades single-index queries to both when terms span both domains
  ↓
Step 8: Hybrid Retrieval (lib/retrieve.ts)
  - Vector search: OpenAI text-embedding-3-small (1536 dims) → pgvector cosine similarity
  - BM25 search: PostgreSQL full-text search (tsvector/tsquery)
  - RRF Fusion: Reciprocal Rank Fusion merges both ranked lists (k=60)
  - Document diversity: max 2 chunks per document
  - Top 4 chunks returned
  - Thresholds: case_facts=0.52, legal_concept=0.58, glossary=0.55, etc.
  - Fallback cascade: primary threshold → lower fallback → dual-index → last-resort (0.30)
  ↓
Step 9: LLM Generation (lib/chat.ts → lib/prompts.ts)
  - System prompt: 23 Hard Rules, citation format, query type context, retrieved chunks
  - LLM: gpt-4o-mini, max 1024 tokens
  - For fact-check: separate claim extraction → per-claim verification pipeline
  ↓
Step 10: Post-Processing
  - Claim-level grounding verification (lib/claim-verifier.ts)
    - Extracts enumerated lists, verifies each item exists in cited chunks
    - 3 tiers: exact match → stem equivalents → contextual proximity
    - Strips ungrounded items before Judge sees answer
  - Hallucinated number detection (checks answer numbers against chunk numbers)
  ↓
Step 11: LLM-as-Judge (lib/prompts.ts → JUDGE_SYSTEM_PROMPT)
  - Receives: generated answer + retrieved chunks + extra context
  - APPROVE or REJECT with reason
  - Defaults to APPROVE (err on side of showing answer)
  - 30+ REJECT conditions, 15+ APPROVE overrides
  ↓
Step 12: Response
  - If APPROVE: parse citations, validate integrity, return answer
  - If REJECT: return fallback blocked message
  - For fact-check: structured FactCheckResult with per-claim verdicts
```

### Two RAG Indexes

| Index | Content | Documents | Chunks |
|-------|---------|-----------|--------|
| **1** | Legal framework (Rome Statute, Rules of Procedure, Elements of Crimes, How the Court Works) | 6 | ~259 |
| **2** | Case documents (warrants, decisions, filings, transcripts, victim pages + 198 auto-discovered court records) | 223 | ~2,927 |

**Total: 229 documents, 3,186 chunks**

### Database Schema

```
icc_documents (rag_index SMALLINT, document_type TEXT, title, url, content_hash, date_published)
    ↓ 1:many
document_chunks (content TEXT, embedding vector(1536), chunk_index, token_count, metadata JSONB)
```

**RPC Functions:**
- `match_document_chunks(query_embedding, match_rag_index, match_threshold, match_count, match_document_type)` — vector cosine similarity search, JOINs to icc_documents for rag_index/document_type filtering
- `search_document_chunks_fts(search_query, match_rag_index, match_count, match_document_type)` — BM25 full-text search

### Ingestion Pipeline

```
Source URL (PDF or HTML)
  ↓ Firecrawl (@mendable/firecrawl-js)
  ↓ → Markdown output
  ↓
12-step Cleaning (lib/clean.ts)
  - UTF-8 mojibake fix, LaTeX strip, repeated header removal
  - PDF form checkbox strip, footnote separation, table flattening
  - Redaction marker normalization, OCR corrections
  - Transcript boilerplate strip, whitespace normalization
  ↓
Text Splitting (LangChain RecursiveCharacterTextSplitter)
  - RAG 1: 2,400 chars / 240 overlap (~600 tokens)
  - RAG 2: 1,600 chars / 160 overlap (~400 tokens)
  - Transcripts: 3,200 chars / 320 overlap (~800 tokens)
  ↓
Embedding (OpenAI text-embedding-3-small, 1536 dims)
  ↓
Upsert to Supabase (icc_documents + document_chunks)
```

**Discovery Crawl (--discover flag):**
- Starts at: `https://www.icc-cpi.int/case-records?f[0]=cr_case_code:1527`
- Paginates through up to 20 pages
- Extracts markdown links, filters by document type (decision, order, warrant, filing, judgment, transcript)
- Excludes: registry, translation
- Cross-references with existing `icc_documents` table
- Resolves court record HTML pages to embedded PDF links

---

## 2. What Was Done

### Phase 1: Ingestion (Completed)

**Command:** `npx tsx --env-file=.env.local scripts/ingest.ts --discover --ingest`

**Result:** 198 new court record PDFs discovered and ingested → 2,657 new chunks in RAG index 2.

Key documents ingested include:
- Decision on the Prosecutor's request for authorisation (Article 15(3)) — 64 chunks
- Decision on the Defence Challenge to the Jurisdiction of the Court — 52 chunks
- Corrected Prosecution response to Defence Challenge on Jurisdiction — 53 chunks
- Confirmation of charges hearing transcript — 63 chunks
- Warrant of Arrest for Mr Duterte — 16 chunks
- Philippine Government's observations — multiple filings
- Multiple defence motions (interim release, adjournment, disqualification)
- Victims' observations and responses
- Various scheduling orders, decisions on evidence, etc.

### Phase 2: Transcript Awareness (Implemented by Cursor)

**File: `prompts/cursor-transcript-awareness-prompt.md`** — 9 steps, all executed.

Changes made:
- **`lib/prompts.ts`**: Hard Rules 22-23 (transcript citation framing, evidence hierarchy), transcript NOTE injection when transcript chunks present, expanded judge APPROVE/REJECT for transcript handling
- **`lib/fact-check.ts`**: Transcript note in chunk section, TRANSCRIPT vs RULING DISTINCTION section in verification prompt, `transcript_testimony` evidence type
- **`lib/intent-classifier.ts`**: Hearing query examples added to LLM prompt

### Phase 3: Retrieval & Robustness Fixes (Implemented by Cursor)

**Changes across 7 files:**
- **`lib/intent-classifier.ts`**: Drug war regex patterns (Tokhang, DDS, war on drugs, extrajudicial killings, etc.) + hearing/transcript patterns + Article 18/deferral patterns. LLM prompt examples expanded.
- **`lib/intent.ts`**: `requiresDualIndex()` catches drug war terms and hearing/transcript terms → forces both-index search
- **`lib/retrieve.ts`**: Glossary threshold lowered (0.60→0.55), last-resort 0.30 fallback added
- **`lib/fact-check.ts`**: Procedural stage sequence covers interlocutory appeals, ICC_CLAIM_INDICATORS expanded, drug war claim examples added
- **`lib/claim-verifier.ts`**: STEM_EQUIVALENTS covers EJK, drug war, neutralization, death vocabulary
- **`lib/chat.ts`**: ABSENCE_PATTERNS expanded, hardcoded dates removed, flat-decline message improved
- **`lib/prompts.ts`**: Contradictory-submissions instruction for mixed prosecution/defence chunks

---

## 3. Current State Diagnosis

### Diagnostic Results

**Test: "What is Tokhang?"**
```
Intent: case_facts (Layer 2 regex match) ✅
RAG indexes: [1, 2] (dual-index via requiresDualIndex) ✅
Vector search results: 0 ❌
BM25 (full-text) results: 10 ✅
Final chunks after RRF + diversity: 4 ✅
Retrieval confidence: medium

Chunk 1: Transcript — "Mr Duterte's anti-drug campaign...illegal imprisonment of surviving family members"
Chunk 2: Transcript — "children of the 'Na-Tokhang'. The children of the murdered Tokhang victim..."
Chunk 3: FRENCH DOCUMENT — "Meurtres qui auraient été commis pendant des opérations « Tokhang »"
Chunk 4: Philippine Government's Observation — "Project: Double Barrel...campaign plan implemented by PNPAIDG"
```

**App response:** "This is not addressed in current ICC records." ❌

**Test: "What were the operations during the war on drugs?"**
```
Intent: case_facts (Layer 3 LLM) ✅
RAG indexes: [1, 2] ✅
Vector search results: 0 ❌
BM25 results: 10 ✅
Final chunks: 4 ✅

Chunk 1: Art 15(3) Decision — "persons were killed by Philippine security forces...so-called 'war on drugs' campaign"
Chunk 2: Transcript — "thousands of victims...suffered immeasurable harm under the so-called anti-drug campaign"
Chunk 3: Art 15(3) Decision — "killings committed between 1 July 2016 and 16 March 2019...not a legitimate anti-drug law enforcement operation"
Chunk 4: Philippine Government — "Project: Double Barrel...campaign plan implemented by PNPAIDG, commencing on 1 July 2016"
```

**App response:** "This is not addressed in current ICC records." ❌

### What's Working

| Component | Status | Evidence |
|-----------|--------|----------|
| Intent classification | ✅ Working | "What is Tokhang?" → `case_facts` (Layer 2 regex) |
| Dual-index routing | ✅ Working | `requiresDualIndex` triggers [1,2] for drug war terms |
| BM25 keyword search | ✅ Working | Finds 10 results for both queries |
| Chunk content | ✅ Has Tokhang content | Chunks mention "Na-Tokhang", "Tokhang victim", war on drugs, Double Barrel |
| Last-resort fallback | ✅ Working | Not needed — BM25 finds results |

### What's Failing

| Component | Status | Evidence |
|-----------|--------|----------|
| Vector search | ❌ Zero results | `vec_count: 0` for both queries — embedding similarity below 0.52 threshold |
| French document | ❌ Contaminating results | "Décision relative à la demande d'autorisation..." is a French duplicate taking up one of 4 chunk slots |
| LLM response generation | ❌ Declining with relevant chunks | LLM sees 4 relevant chunks but generates "This is not addressed" from Hard Rule 10 |
| System prompt guidance | ❌ Missing | No instruction telling LLM to synthesize contextual mentions into an explanation |

---

## 4. Root Cause Analysis

### Root Cause 1: LLM Too Conservative (PRIMARY CAUSE)

**Hard Rule 10** in `lib/prompts.ts` says:
> "If a question cannot be answered from the provided documents, respond only with: 'This is not addressed in current ICC records.'"

The LLM (gpt-4o-mini) interprets "cannot be answered" too narrowly. When the user asks "What is Tokhang?", the chunks mention Tokhang in context (victims of Tokhang, operations called Tokhang, "Na-Tokhang" as a label) but don't contain a clean one-sentence definition. The LLM decides it "can't answer" and generates the decline.

**The chunks DO contain enough to answer.** For example:
- "The children of the murdered Tokhang victim..." → implies Tokhang involves killings
- "opérations « Tokhang »" → Tokhang is an operation name
- "Project: Double Barrel...anti-drug campaign" → describes the operational context
- "anti-drug campaign conducted during the administration of..." → links to Duterte

A properly instructed LLM should be able to synthesize: "Based on ICC documents, 'Tokhang' refers to an anti-drug operation conducted during the Duterte administration. ICC documents describe killings committed during 'Tokhang' operations [1][2], as well as a related campaign called 'Project: Double Barrel' [4]."

**Fix needed:** Add a system prompt instruction that tells the LLM to synthesize descriptions from contextual mentions when the query asks about a case-specific term.

### Root Cause 2: Zero Vector Search Results

The embedding for "What is Tokhang?" has ZERO cosine similarity above 0.52 against any chunk embedding. Only BM25 (keyword) search works.

This means the semantic embedding space doesn't connect "What is Tokhang?" to ICC legal document chunks about the drug war. The embedding model (text-embedding-3-small) likely maps "Tokhang" to a very different region than ICC legal language.

**Fix needed:** Add query expansion for FTS to include more drug-war-specific synonyms, and consider lowering the case_facts vector threshold.

### Root Cause 3: French Document Contamination

One of the 198 ingested documents is a **French-language duplicate**: "Décision relative à la demande d'autorisation d'ouvrir une enquête en vertu de l'article 15-3 du Statut de Rome présentée par le Procureur". This is the same document as the English "Decision on the Prosecutor's request for authorisation of an investigation pursuant to Article 15(3) of the Statute" — but in French.

This French document has chunks containing "opérations « Tokhang »" which BM25 finds via keyword match. These French chunks take up one of the 4 available chunk slots, pushing out potentially more useful English chunks.

**Fix needed:** Either (a) exclude non-English documents during discovery/ingestion, or (b) add a language filter in the retrieval pipeline, or (c) remove the French document from the database.

### Root Cause 4: No Contextual Synthesis Instruction

The system prompt has HARD RULES about only using provided chunks, but no guidance on HOW to use contextual mentions. When a term like "Tokhang" appears in chunks describing victims, operations, and legal proceedings, the LLM needs to be told: "If the user asks about a case-specific term and the chunks mention it in context, synthesize a description from those contextual mentions."

---

## 5. Fix Plan

### Files to Modify

| File | Changes |
|------|--------|
| `lib/prompts.ts` | Add contextual synthesis instruction to system prompt |
| `lib/retrieve.ts` | Expand FTS query for drug war terms, lower case_facts threshold |
| `lib/chat.ts` | Add query expansion for drug war terms before retrieval |
| `scripts/ingest.ts` | Add language detection to skip non-English documents |

---

### Step 1: `lib/prompts.ts` — Add contextual synthesis instruction (CRITICAL FIX)

In the `HARD_RULES` constant, after Hard Rule 23 (line 31), add a new rule:

```typescript
24. CASE-SPECIFIC TERMS: When the user asks "What is X?" about a term that appears in multiple retrieved chunks (e.g., Tokhang, Oplan Double Barrel, DDS, Noche Buena, buy-bust, shabu), do NOT decline just because no single chunk contains a formal definition. Instead, synthesize a factual description by combining contextual mentions across chunks. Report how ICC documents describe the term: what kind of thing it is (operation, program, event), who conducted it, when, and what happened. Cite each chunk that mentions the term. This IS answerable from the provided documents — contextual mentions ARE factual content.
```

This directly addresses the primary failure: the LLM declining when chunks contain relevant contextual information.

---

### Step 2: `lib/prompts.ts` — Add PARTIAL ANSWERS enhancement

The existing PARTIAL ANSWERS section (around line 71-76) should be updated to explicitly address case-specific term queries. After the existing line about transcript chunks (line 76), add:

```
- When asked "What is [term]?" and chunks mention the term in context (e.g., describing victims, operations, legal proceedings), you MUST synthesize a factual description from those mentions. A partial answer that describes how ICC documents reference the term is ALWAYS better than declining.
```

---

### Step 3: `lib/prompts.ts` — Update Judge APPROVE list

In the `JUDGE_SYSTEM_PROMPT`, in the "APPROVE when" section (after line 264), add:

```
- Answers that synthesize a description of a case-specific term (Tokhang, DDS, Double Barrel, etc.) from contextual mentions across multiple chunks — this is correct grounded behavior, not speculation. As long as each stated fact traces to a chunk, APPROVE.
```

---

### Step 4: `lib/retrieve.ts` — Expand FTS query for drug war terms

The `expandQueryForFts` function (line 192) currently only expands "closing statement" → "closing submissions" and "defence" → "defense". It needs to expand drug war terms for better BM25 matching.

**Current function:**
```typescript
function expandQueryForFts(query: string): string {
  let expanded = query;
  if (/\bclosing\s+statement(s)?\b/i.test(expanded) && !/\bclosing\s+submission/i.test(expanded)) {
    expanded += " closing submissions";
  }
  if (/\bdefence\b/i.test(expanded) && !/\bdefense\b/i.test(expanded)) {
    expanded += " defense";
  }
  return expanded.trim();
}
```

**Change to:**
```typescript
function expandQueryForFts(query: string): string {
  let expanded = query;
  if (/\bclosing\s+statement(s)?\b/i.test(expanded) && !/\bclosing\s+submission/i.test(expanded)) {
    expanded += " closing submissions";
  }
  if (/\bdefence\b/i.test(expanded) && !/\bdefense\b/i.test(expanded)) {
    expanded += " defense";
  }
  // Drug war term expansion for better FTS recall
  if (/\btokhang\b/i.test(expanded)) {
    expanded += " anti-drug campaign operation drug war";
  }
  if (/\bdouble\s+barrel\b/i.test(expanded)) {
    expanded += " Oplan Tokhang anti-drug campaign PNPAIDG";
  }
  if (/\b(davao\s+death\s+squad|dds)\b/i.test(expanded)) {
    expanded += " Davao killings extrajudicial";
  }
  if (/\b(war\s+on\s+drugs?|drug\s+war)\b/i.test(expanded)) {
    expanded += " Tokhang Double Barrel anti-drug campaign operation";
  }
  if (/\bextrajudicial\b/i.test(expanded)) {
    expanded += " killing execution drug war Tokhang";
  }
  return expanded.trim();
}
```

---

### Step 5: `lib/retrieve.ts` — Lower case_facts primary threshold

The vector search returns 0 results for "What is Tokhang?" at the 0.52 threshold. While BM25 compensates, lowering the vector threshold will improve hybrid retrieval quality by including vector matches that enhance RRF fusion.

**Current (line 15):**
```typescript
case_facts: { primary: 0.52, fallback: 0.35 },
```

**Change to:**
```typescript
case_facts: { primary: 0.45, fallback: 0.30 },
```

**Rationale:** The new court record PDFs contain dense legal language that doesn't semantically match user questions as closely as the manually-selected core documents. Lowering from 0.52 to 0.45 will catch more relevant chunks in the initial vector search, while RRF fusion and the diversity filter will still prioritize the best matches.

---

### Step 6: `scripts/ingest.ts` — Skip non-English documents

A French-language duplicate of the Article 15(3) decision was ingested ("Décision relative à la demande d'autorisation d'ouvrir une enquête en vertu de l'article 15-3 du Statut de Rome présentée par le Procureur"). This wastes chunk slots and confuses the LLM.

In the `discoverNewUrls` function or the ingestion flow, add a language check. After the Firecrawl scrape returns markdown content (around the point where `scrapeUrl` is called for each document), add:

```typescript
// Skip non-English documents (ICC publishes French/Arabic duplicates)
const NON_ENGLISH_SIGNALS = /\b(décision|procureur|chambre|enquête|statut|conformément|préliminaire|présent[ée]|relatif|vertu)\b/i;
function isNonEnglishContent(markdown: string): boolean {
  // Check first 500 chars for French/non-English signals
  const sample = markdown.slice(0, 500);
  const matches = sample.match(NON_ENGLISH_SIGNALS);
  return (matches?.length ?? 0) >= 3; // 3+ French words in first 500 chars = likely French
}
```

Then in the ingestion loop, after scraping:
```typescript
if (isNonEnglishContent(scraped.markdown ?? "")) {
  console.log(`  ⚠ Skipping non-English document: ${title}`);
  continue;
}
```

**Also:** Remove the existing French document from the database. Run in Supabase SQL editor:
```sql
-- Find and delete the French duplicate
DELETE FROM icc_documents WHERE title LIKE 'Décision relative à la demande%';
```

---

### Step 7: `lib/chat.ts` — Add query context injection for drug war terms

When the user asks "What is Tokhang?", the LLM needs to understand that this is asking about the factual basis of the ICC case, not a random glossary term. Add a query context injection in `buildSystemPrompt` call.

In `chat.ts`, before the `buildSystemPrompt` call (around line 554), add:

```typescript
// For drug war term queries, inject context so the LLM knows these are core case terms
const isDrugWarTermQuery = /\b(what\s+is|what\s+are|what\s+was|what\s+were|tell\s+me\s+about|explain|describe)\b.*\b(tokhang|oplan|double\s+barrel|davao\s+death\s+squad|dds|war\s+on\s+drugs?|drug\s+war|nanlaban|shabu|buy[- ]?bust|extrajudicial)\b/i.test(effectiveQuery);
```

Then pass this as a flag to `buildSystemPrompt` via a new option, or inject extra context into the existing prompt. The simplest approach: add a query type note.

After the `isAbsenceQuery` check (line 551), add:
```typescript
const isDrugWarTermQuery = /\bwhat\s+(is|are|was|were)\b.*\b(tokhang|oplan|double\s+barrel|dds|davao\s+death|drug\s+war|war\s+on\s+drugs?|nanlaban|shabu|buy[- ]?bust|extrajudicial)\b/i.test(effectiveQuery)
  || /\b(tokhang|oplan|double\s+barrel|dds|davao\s+death)\b.*\bwhat\b/i.test(effectiveQuery);
```

Then in `buildSystemPrompt` (in `lib/prompts.ts`), accept `isDrugWarTermQuery` as a new option. After the `isAbsenceQuery` note injection (around line 172), add:

```typescript
if (opts.isDrugWarTermQuery) {
  prompt += `\nQUERY TYPE NOTE: This query asks about a term or operation central to the ICC case against Duterte. The retrieved documents will mention this term in context (describing victims, operations, legal proceedings, policy programs). You MUST synthesize a factual description from these contextual mentions — explain what the term refers to based on how ICC documents describe it. Do NOT decline with "This is not addressed." The chunks contain the information needed.\n`;
}
```

Update `BuildPromptOptions` interface to include `isDrugWarTermQuery?: boolean`.

---

### Step 8: `lib/chat.ts` — Pass isDrugWarTermQuery to buildSystemPrompt

In the `buildSystemPrompt` call (around line 554), add the new flag:

```typescript
const systemPrompt = buildSystemPrompt({
  chunks,
  queryType: intent,
  query: effectiveQuery,
  pastedText: effectivePastedText,
  pasteTextMatched,
  conversationHistory: sanitizeHistory(conversationHistory.slice(-3)),
  knowledgeBaseLastUpdated: kbDate,
  isAbsenceQuery,
  responseLanguage,
  originalQuery,
  isDrugWarTermQuery,  // <-- ADD THIS
});
```

---

### Step 9: `lib/prompts.ts` — Add isDrugWarTermQuery to BuildPromptOptions

Add to the `BuildPromptOptions` interface (around line 114):

```typescript
isDrugWarTermQuery?: boolean;
```

And in `buildSystemPrompt`, destructure it:
```typescript
const {
  // ... existing fields ...
  isDrugWarTermQuery,
} = opts;
```

---

### Step 10: `lib/chat.ts` — Handle hearing content query detection more broadly

The existing `isHearingContentQuery` regex (line 520-524) is too narrow. It only matches specific patterns like "closing statement" and "what did the defence argue". Expand it to catch more hearing-related questions:

**Current:**
```typescript
const isHearingContentQuery =
  ragIndexes.includes(2) &&
  /\b(closing\s+statement(s)?|what\s+(did|were)\s+(the\s+)?(defence|defense|prosecution)\s+(argue|say)|what\s+was\s+(said|argued)\s+at\s+the\s+hearing|defence['\s]?s?\s+argument|prosecution['\s]?s?\s+argument)\b/i.test(
    effectiveQuery
  );
```

**Change to:**
```typescript
const isHearingContentQuery =
  ragIndexes.includes(2) &&
  /\b(closing\s+statement|what\s+(did|were)\s+(the\s+)?(defence|defense|prosecution)\s+(argue|say|present|claim|state)|what\s+was\s+(said|argued|presented|discussed)\s+at\s+the\s+(hearing|confirmation)|defence['\s]?s?\s+argument|prosecution['\s]?s?\s+argument|what\s+happened\s+at\s+the\s+(hearing|confirmation)|confirmation\s+of\s+charges\s+hearing|testimony\s+(at|during|in)\s+the)\b/i.test(
    effectiveQuery
  );
```

---

### Step 11 (OPTIONAL — Database Fix): Remove French document

Run this SQL in the Supabase SQL editor to remove the French duplicate:

```sql
-- Verify the French document
SELECT document_id, title, document_type FROM icc_documents
WHERE title LIKE 'Décision relative%' OR title LIKE 'Décision%';

-- Delete it (cascades to its chunks)
DELETE FROM icc_documents
WHERE title LIKE 'Décision relative à la demande d%autorisation%';
```

Alternatively, add this to the ingestion discovery filter in `scripts/ingest.ts` to prevent future French ingestion. In the `extractDocsFromMarkdown` function, add a check:

```typescript
// Skip obvious French-language documents
if (/^(Décision|Demande|Ordonnance|Chambre|Requête)\b/.test(title)) {
  continue;
}
```

---

### Step 12: Verify existing retrieval/robustness changes are intact

Confirm these previous changes are still in place (they should be — they were implemented by Cursor):

- [ ] `lib/intent-classifier.ts` has drug war regex patterns (line 105-128)
- [ ] `lib/intent.ts` has drug war terms in `requiresDualIndex()` (line 101-106)
- [ ] `lib/retrieve.ts` has glossary threshold at 0.55 (line 19)
- [ ] `lib/retrieve.ts` has last-resort 0.30 fallback (line 298-306)
- [ ] `lib/fact-check.ts` has expanded ICC_CLAIM_INDICATORS (line 48-49)
- [ ] `lib/fact-check.ts` has interlocutory appeals in procedural stage sequence (line 248-249)
- [ ] `lib/claim-verifier.ts` has drug war STEM_EQUIVALENTS (line 40-79)
- [ ] `lib/chat.ts` has expanded ABSENCE_PATTERNS (line 548-549)
- [ ] `lib/chat.ts` has improved flat-decline message (line 538-539)
- [ ] `lib/prompts.ts` has contradictory-submissions instruction (line 182-194)

---

### Step 13 (OPTIONAL — Performance): Add query embedding cache

For common drug war terms, the vector search consistently returns 0 results because the embedding space is too distant. Consider adding a term → expanded query mapping that runs BEFORE embedding, to improve vector search recall:

In `lib/retrieve.ts`, add before `embedText`:

```typescript
/** Expand query for better embedding match on domain-specific terms */
function expandQueryForEmbedding(query: string): string {
  // Drug war terms → add ICC legal context for better semantic match
  if (/\btokhang\b/i.test(query) && !/\b(operation|campaign|drug|anti)\b/i.test(query)) {
    return query + " Philippine anti-drug operation campaign killings ICC case";
  }
  if (/\bdouble\s+barrel\b/i.test(query) && !/\b(project|pnp|anti)\b/i.test(query)) {
    return query + " Project Double Barrel anti-drug Philippine National Police campaign";
  }
  if (/\b(davao\s+death\s+squad|dds)\b/i.test(query) && !/\b(kill|extrajudicial|murder)\b/i.test(query)) {
    return query + " Davao Death Squad extrajudicial killings Philippines";
  }
  return query;
}
```

Then in `retrieve`, before `embedText(searchText)`:
```typescript
const embeddingText = expandQueryForEmbedding(searchText);
const embedding = await embedText(embeddingText);
```

Note: Keep `ftsQuery` using the original `searchText` (with FTS expansion) since BM25 works differently than embeddings.

---

## Summary

| Step | File | What Changes | Priority |
|------|------|-------------|----------|
| 1 | `lib/prompts.ts` | Hard Rule 24: contextual synthesis for case-specific terms | CRITICAL |
| 2 | `lib/prompts.ts` | PARTIAL ANSWERS: synthesize from contextual mentions | CRITICAL |
| 3 | `lib/prompts.ts` | Judge APPROVE: allow synthesized case-term descriptions | HIGH |
| 4 | `lib/retrieve.ts` | `expandQueryForFts`: drug war term expansion for BM25 | HIGH |
| 5 | `lib/retrieve.ts` | Lower case_facts threshold from 0.52 → 0.45 | MEDIUM |
| 6 | `scripts/ingest.ts` | Skip non-English documents during ingestion | MEDIUM |
| 7 | `lib/chat.ts` | Detect drug war term queries and flag them | HIGH |
| 8 | `lib/chat.ts` | Pass `isDrugWarTermQuery` to `buildSystemPrompt` | HIGH |
| 9 | `lib/prompts.ts` | Accept `isDrugWarTermQuery` option, inject query context note | HIGH |
| 10 | `lib/chat.ts` | Broader `isHearingContentQuery` regex | MEDIUM |
| 11 | Database | Remove French duplicate document | LOW |
| 12 | All files | Verify previous changes are intact | LOW |
| 13 | `lib/retrieve.ts` | Query expansion for embedding (improve vector recall) | MEDIUM |

---

## 6. Verification

After implementation, test these queries:

### Must-Pass (Currently Failing)
1. **"What is Tokhang?"** — MUST return a synthesized description citing chunks (NOT "This is not addressed")
2. **"What were the operations during the war on drugs?"** — MUST describe Oplan Tokhang, Double Barrel with citations
3. **"What is the Davao Death Squad?"** — MUST synthesize from contextual mentions
4. **"How many were killed in the drug war?"** — MUST cite numbers from chunks or state "specific number varies by source document"

### Regression Tests (Must Still Work)
5. **"What are crimes against humanity?"** — Should route to `legal_concept` (index 1), return Rome Statute content
6. **"What is Article 7?"** — Should route to `legal_concept`, return Article 7 content
7. **"What is Duterte charged with?"** — Should return charges with citations
8. **"Did Duterte surrender or was he arrested?"** — Should work as before

### Fact-Check Tests
9. Paste **"Tokhang killed 30,000 people"** — Should extract as factual claim, verify against chunks
10. Paste **"Duterte was convicted"** — Should return FALSE (procedural impossibility)

### Diagnostic Commands
```bash
# Check retrieval directly
npx tsx --env-file=.env.local scripts/check-retrieval.ts "What is Tokhang?"

# List all ingested documents
npx tsx --env-file=.env.local scripts/list-ingested.ts

# Check for French document
npx tsx --env-file=.env.local scripts/list-ingested.ts | grep -i "décision"
```

Check server logs for:
- `rag.retrieve` — confirm `vec_count > 0` (vector search now finding results)
- `rag.fallback_last_resort` — if this fires, thresholds may need further lowering
- `classifier.intent` — confirm Layer 2 regex matches for drug war queries
