# PM → AI Developer Handoff Checklist

> **What this is:** A verification checklist completed before starting implementation. Ensures all documents are complete and the AI agent has everything it needs to build the feature without guessing.

---

# Handoff Checklist: The Docket — Iteration 1 (Q&A + Citations + Multi-Turn)

**Date:** 2026-02-28
**PM:** John
**Target:** Implementation in Cursor / Claude Code

---

## A. Core Documents (Required for ALL features)

### A0. Constitution

- [x] `constitution.md` exists
- [x] Principles cover: users (Principle 1), data handling (Principles 2, 3, 5), development philosophy (Principle 7), delivery approach (Principle 8)
- [x] Governance section defines decision priorities (7 tiebreaker rules)
- [ ] Referenced in `.cursorrules` — **TODO: create `.cursorrules` referencing constitution.md, prd.md, and all spec docs**

### A1. PRD Completeness

- [x] Overview and problem statement written (§1)
- [x] Target users defined with capabilities AND restrictions (§2)
- [x] All user journeys documented with numbered steps (§3 — 5 journeys)
- [x] Functional requirements use "System shall..." language (§4)
- [x] Data entities defined with exact field names (§5 — ICCDocument, DocumentChunk, Query, Citation, Conversation, Message)
- [x] Key relationships documented including access control (§6)
- [x] Success criteria are testable (§7)
- [x] Edge cases listed with expected behavior — 18 edge cases (§8)
- [x] Out of scope explicitly listed (§1)

### A2. Specification Artifacts

- [x] PRD has been interrogated by Claude (gaps identified and resolved — 4 interview rounds)
- [x] Clarification round completed (all answers recorded in PRD amendments)
- [x] All clarification answers are recorded (reflected in PRD §4, §8, §19)
- [ ] ARCHITECTURE.md exists with tech stack, project structure, and key decisions — **Not created as separate doc. Tech decisions recorded in TASKS.md (Next.js, Supabase, OpenAI, Firecrawl, Vercel). Sufficient for iteration 1 scope.**
- [x] TASKS.md exists with ordered, verifiable tasks (97 tasks across 12 groups)

---

## A3. Figma Designs

> **N/A** — No Figma designs for this feature. UI will be built to spec from PRD user journeys.

---

## B. LLM Features

### B1. NL Interpretation Contract

- [x] `nl-interpretation.md` exists
- [x] Semantic taxonomy covers all intent categories — 7 categories (case_facts, case_timeline, legal_concept, procedure, glossary, paste_text, out_of_scope)
- [x] Phrase → structured output mapping has concrete JSON (§3.2 — JSON for every intent)
- [x] Field resolution rules map user concepts to exact field names (§3.1 — 9 mappings)
- [x] Prohibited outputs listed — 15 rules (P-1 through P-15)
- [x] Acceptance scenarios have Given/When/Then with exact expected behavior — 38 scenarios (NL-01 through NL-38)
- [x] Edge cases listed with expected behavior — 10 edge cases (EC-01 through EC-10)
- [x] Every intent category has at least one acceptance scenario

### B2. System Prompt Specification

- [x] `prompt-spec.md` exists
- [x] Prompt structure documented — 12 sections, static vs dynamic (§2)
- [x] Dynamic injection points defined with source and condition — 6 points (§3)
- [x] Rules section has concrete do/don't statements — 11 hard rules (§4)
- [x] Few-shot examples cover every intent category — 7 examples (§5)
- [x] Response contract defines exact JSON shape (§6.1)
- [x] Error handling covers: API down, rate limit, malformed response, timeout, judge failure, RAG failure (§8)
- [x] Version number assigned — 1.0.0 (§9)

### B3. LLM Integration Verification

- [x] API key / environment variable documented (`OPENAI_API_KEY` in TASKS.md §0)
- [x] Rate limiting configured and documented (prompt-spec.md §8 — exponential backoff)
- [x] Fallback behavior defined — service unavailable message, never show unverified answer (prompt-spec.md §8)
- [x] Maximum token limit appropriate — 1024 for answer, 256 for judge (prompt-spec.md §1)

---

## C. Data Pipeline Features

### C1. Data Quality Contract

- [x] `data-quality.md` exists
- [x] Dirty data patterns documented with REAL examples — 10 patterns from actual Firecrawl output (§1)
- [x] Every field type has known dirty variants listed (§1.1 pattern table)
- [x] Normalization rules documented for EACH pipeline stage — 10 CLEAN rules in order (§2, §3)
- [x] What IS and IS NOT normalized at each stage is explicit (§3 pipeline order + §5 document type matrix)
- [x] Field alias mappings are complete — N/A (not applicable to ICC document pipeline; aliases handled in nl-interpretation.md §3.1)
- [x] Number format handling specified — LaTeX math artifacts (CLEAN-03)
- [x] Date format handling specified — ISO 8601 normalization (§9 out-of-scope transformations, handled by Unstructured.io)

### C2. Pipeline Boundary Contracts

- [x] Each pipeline stage is named and ordered (PRD §12.1 — 2 jobs, 5 stages each)
- [x] Data shape documented at each boundary (PRD §12.2 — 5 boundaries)
- [x] Value formats documented at each boundary (PRD §12.2)
- [x] Key transformations at each stage are explicit (PRD §12.2)

---

## D. Multi-Component Features

### D1. End-to-End Scenarios

- [x] E2E scenarios exist — 17 scenarios in PRD §17 (not a separate file, but inline in PRD)
- [x] At least one scenario per supported query/action pattern (covered: law question, case fact, political opinion, paste-text matched/unmatched, glossary, not-in-records, unverified claim, new document, multi-turn, redacted, personal trivia, daily limit, monthly cap, conversation expiry, non-English, document update)
- [ ] Sample test data is concrete (actual JSON rows) — **Partial. Acceptance scenarios in nl-interpretation.md have concrete inputs/outputs but not full JSON rows at every pipeline boundary. Sufficient for iteration 1.**
- [ ] Each scenario defines expected intermediate states at every boundary — **Not specified at every boundary. E2E scenarios define input → expected output. Sufficient for iteration 1.**
- [x] Edge case scenarios cover dirty data (covered in data-quality.md §7 — 10 edge cases)

---

## E. RAG Features

### E1. Indexing Contract

- [x] Data sources listed with content type and update frequency — 13 URLs (PRD §15.1)
- [x] Chunking strategy defined with rationale — RAG 1: 600 tokens/60 overlap; RAG 2: 400 tokens/40 overlap (PRD §15.1)
- [x] Metadata fields defined for each chunk — 7 fields (PRD §15.1)
- [x] Indexing quality rules defined — content hash dedup, CLEAN rules, validation checks (data-quality.md)
- [x] Re-indexing strategy defined — weekly scrape, content hash comparison, replace + log (PRD §4, §15.1)

### E2. Retrieval Contract

- [x] Top-k value defined with rationale — pre-rerank: 10, post-rerank: 4 (PRD §15.2)
- [x] Similarity threshold defined with rationale — 0.68 (PRD §15.2)
- [x] Mandatory filters defined — `rag_index` (PRD §15.2)
- [x] Fallback behavior defined for: zero results (flat decline), low confidence (below threshold), index unavailable (service unavailable message) (PRD §15.2, prompt-spec.md §8)
- [x] Cross-tenant isolation verified — N/A (single-tenant app; per-user isolation is at conversation level, not RAG level)

### E3. Context Injection

- [x] Injection template defined — location, format, citation markers (prompt-spec.md §7.1)
- [x] Token budget defined — 3,000 tokens for retrieved context (prompt-spec.md §7.2)
- [x] Overflow strategy defined — drop lowest-ranked chunk; never truncate mid-sentence (prompt-spec.md §7.2)
- [x] Citation format defined — inline `[N]` markers + citation list + source passage (prompt-spec.md §7.3)

### E4. Answer Quality Rules

- [x] Rule: only answer from retrieved context (R-1 in prompt-spec.md §4)
- [x] Rule: cite sources for every factual claim (R-2)
- [x] Rule: admit when context is insufficient (R-10)
- [x] Rule: never combine cross-tenant information — N/A (single-tenant; RAG 1 and RAG 2 are separate indexes with mandatory filter)
- [x] Freshness warning rule defined — every answer includes `knowledge_base_last_updated` (prompt-spec.md §7.3)

### E5. RAG-Specific Scenarios

- [x] "Direct match" scenario — E2E-01, E2E-02 (PRD §17)
- [x] "No relevant context" scenario — E2E-07 (PRD §17); NL-33 (nl-interpretation.md)
- [x] "Cross-tenant isolation" — N/A (single-tenant)
- [x] "Stale content" — Addressed via `knowledge_base_last_updated` on every answer
- [x] Retrieval quality metrics — 8 retrieval quality tests (RAG-01 through RAG-08 in nl-interpretation.md §6)

---

## F. Recommender Features

> **N/A** — No recommendation, scoring, or ranking component in iteration 1.

---

## G. Observability & Validation Logging

### G1. Boundary Logging

- [ ] Every component/stage boundary logs input count and output count — **Not yet specified. Will be implemented during build (TASKS.md Task Group 3 ingestion pipeline, Task Group 4 RAG retrieval).**
- [ ] Key match/miss rates logged at integration points — **Not yet specified.**
- [ ] Zero-output warning logs — **Not yet specified.**

### G2. Decision Logging

- [ ] Drop/filter reasons logged — **Not yet specified.**
- [ ] Transform samples logged — **Not yet specified.**
- [x] LLM interpretation results logged — prompt-spec.md §8 (log malformed output, log rejected answers)

### G3. Log Standards

- [ ] Consistent prefix per component — **Not yet specified. Will define during implementation.**
- [ ] Structured enough to diagnose "returns empty" — **Not yet specified.**
- [x] No PII in logs — constitution Principle 6 (conversations ephemeral, no secondary use)
- [ ] Critical-path logs in both dev and production — **Not yet specified.**

**Note on Section G:** Logging standards are not fully specified in the spec documents. These will be defined during implementation as part of each task group. The PRD and constitution establish the data privacy constraints (no PII logging, 7-day auto-delete); the implementation details will be determined during build. This is acceptable for iteration 1's small user base.

---

## H. Final Verification

### H1. Cross-Document Consistency

- [x] Field names in PRD match field names in NL interpretation contract
- [x] Field names in NL interpretation contract match field names in prompt spec examples
- [x] Dirty data patterns in data-quality.md cover all patterns from the actual data source (3 representative Firecrawl outputs tested)
- [x] E2E scenarios reference correct sample data
- [x] All documents reference the same entity/field naming convention
- [x] (RAG) Metadata fields in indexing contract match filter fields in retrieval contract
- [x] (RAG) Citation format in prompt spec matches citation rules in answer quality

### H2. AI Agent Context

- [ ] `.cursorrules` references all spec documents — **TODO: create `.cursorrules`**
- [x] Document hierarchy is clear: constitution → PRD → nl-interpretation / data-quality / prompt-spec → TASKS.md

---

## Checklist Summary

| Section                    | Status       | Notes |
| -------------------------- | ------------ | ----- |
| A. Core Documents          | [x] Complete | Missing `.cursorrules` (create during Task 1.1). No separate ARCHITECTURE.md — tech decisions in TASKS.md. |
| B. LLM Features            | [x] Complete | All 3 subsections fully checked |
| C. Data Pipeline           | [x] Complete | All items checked |
| D. Multi-Component         | [x] Complete | E2E scenarios in PRD §17 (not separate file). Partial intermediate state coverage — acceptable for iteration 1. |
| E. RAG Features            | [x] Complete | All 5 subsections fully checked |
| F. Recommender Features    | [x] N/A      | No recommender in iteration 1 |
| G. Observability & Logging | [ ] Partial  | Logging standards will be defined during implementation. Data privacy constraints specified. Acceptable for iteration 1 scope. |
| H. Final Verification      | [x] Complete | Cross-document consistency verified. `.cursorrules` to be created during setup. |

**Ready for implementation?** [x] Yes

**Pre-implementation TODOs (do during Task Group 1):**
1. Create `.cursorrules` referencing constitution.md, prd.md, nl-interpretation.md, data-quality.md, prompt-spec.md, TASKS.md
2. Define logging standards as part of each task group implementation

---

## When Things Go Wrong

If the AI agent gets stuck during implementation, use this diagnostic:

| Symptom                                             | Likely missing document                                                          | Action                                                                    |
| --------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| LLM uses wrong field names                          | prompt-spec.md §4 (Rules), nl-interpretation.md §3.1 (Field Resolution)         | Add field mapping to prompt spec                                          |
| LLM answers from training data, ignoring docs       | prompt-spec.md §7 (Context Injection), nl-interpretation.md §6 (RAG rules)      | Strengthen R-1: "Only answer from retrieved context"                      |
| Wrong documents retrieved                           | data-quality.md §7 (Indexing Quality), PRD §15.2 (Retrieval Contract)           | Check chunking strategy, metadata filters, similarity threshold           |
| LLM generates politically loaded language           | prompt-spec.md §4 R-4 (prohibited words), nl-interpretation.md §4 P-2           | Add word to prohibited list; re-test                                      |
| LLM investigates [REDACTED] content                 | prompt-spec.md §4 R-9, constitution Principle 3                                  | Strengthen redaction guardrail in system prompt                            |
| Citation markers don't match source passages        | prompt-spec.md §6.1 (Response Contract), §7.3 (Citation Rules)                  | Check citation extraction logic; verify source_passage mapping            |
| Paste-text warning not showing                      | prompt-spec.md §3 ({paste_text_matched}), §4 (Paste-Text Rules)                 | Verify hybrid search matching threshold; check warning injection          |
| Multi-turn context erodes neutrality                | prompt-spec.md §2 Section 5, nl-interpretation.md NL-22                          | Each response must be independently evaluated for neutrality              |
| Token limit exceeded                                | prompt-spec.md §7.2 (Token Budget)                                               | Reduce top-k or chunk size; implement overflow strategy                   |
| "Returns empty" or "returns wrong" with no clue why | Handoff checklist §G (Observability)                                              | Add boundary logging at each stage; log counts and decision reasons       |
| Firecrawl output has new data quality issue          | data-quality.md §7 (Edge Cases), §10 (Open Questions)                            | Add new CLEAN rule; update validation checks                              |
