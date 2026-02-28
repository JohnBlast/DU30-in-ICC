# DU30 in ICC — Product Requirements Document

> **What this is:** PRD for DU30 in ICC — a RAG-powered Q&A application that explains the Duterte ICC case using only official ICC documents.  
> **Iteration scope:** Iteration 1 (MVP). Fact-checker (Iteration 2) and Dashboard (Iteration 3) are documented separately.

---

# ━━━ CORE SECTIONS ━━━

## 1. Overview

### Product Context

DU30 in ICC is a desktop web application that allows users to ask questions about the Duterte ICC case and receive factual, cited, politically neutral answers in plain English. All answers are grounded exclusively in official ICC documents. The application targets young Filipino digital natives who want to understand the case but lack the legal background or patience to read ICC documents directly.

### Problem Statement

The Duterte ICC case is one of the most significant legal proceedings involving a Filipino head of state, yet it remains inaccessible to most Filipinos. Legal jargon, complex ICC procedures, and politically charged media coverage make it nearly impossible for non-lawyers to follow the case accurately. Young, politically curious Filipinos consume only headlines without fact-checking, leaving them vulnerable to misinformation and political bias from all sides.

### Primary Goal (Iteration 1)

Enable young Filipino digital natives to:

- Ask plain-English questions about the Duterte ICC case and receive accurate, cited answers
- Paste text from an ICC document into the chat and ask questions about that specific passage
- Look up ICC legal terms and Latin phrases in a plain-English glossary
- Have multi-turn conversations that persist for up to 7 days, linked to their personal account
- Trust that every answer is verified against ICC official records and politically neutral
- See exactly which part of which ICC document backs every claim — via inline citation markers and source passage previews

### Core Capability

DU30 in ICC uses a dual-index RAG pattern: user questions are embedded and matched against two separate ICC document indexes — one for ICC legal framework (laws, procedures, definitions) and one for Duterte case-specific documents (indictments, rulings, press releases). Users can also paste text from ICC documents into the chat, which is cross-referenced against the knowledge base using the same hybrid search pipeline (BM25 + vector with RRF fusion), followed by FlashRank reranking. Multi-turn conversations are supported (last 5 turns as LLM context, 7-day auto-expiry, per-user isolation). Every generated answer is verified by a second LLM-as-Judge before being shown to the user — with inline citation markers linking each claim to its source passage.

### Out of Scope (Iteration 1)

- Fact-checker for user-submitted text (Iteration 2)
- Dashboard with case timeline and trial date tracking (Iteration 3)
- Taglish / Tagalog language support (future iteration — noted as important for target audience)
- Mobile experience (target audience is mobile-first; acknowledged tension, deferred to future iteration)
- Public access — app is password-protected with admin-created accounts
- Any ICC Philippines situation beyond the Duterte case
- News outlets, Philippine government sources, or any non-ICC data
- In-app document viewer with text selection (paste-text into chat is the iteration 1 approach)
- Response streaming (answers are delivered complete after LLM-as-Judge verification)

---

## 2. Target Users

### Young Filipino Digital Native

**Profile:** Politically curious, English-speaking, no legal background. Reads headlines but does not fact-check. Aged roughly 18–35. Desktop user.

**Capabilities:**

- Submit plain-English questions about the Duterte ICC case
- Paste text from an ICC document into the chat and ask questions scoped to that passage
- Browse the ICC document library
- Look up ICC legal and Latin terms in the glossary
- View the source passage behind every citation via inline preview, with a link to the full ICC document
- Continue multi-turn conversations across sessions (up to 7-day expiry)

**Restrictions:**

- English only — Taglish and Tagalog queries are not supported in iteration 1
- Cannot access sealed, confidential, or restricted ICC documents
- Cannot investigate, de-anonymize, or ask the system to identify [REDACTED] content
- Cannot view other users' conversation history
- Cannot modify, export, or reproduce answer content as ICC-official material

---

## 3. User Journeys

### Journey 1: Ask a General Question About the Case

**Intent:** User wants to understand a fact, event, or concept related to the Duterte ICC case.

**Flow:**

1. User lands on the Q&A page
2. User types a plain-English question (e.g., *"What is Duterte charged with?"*)
3. System routes the query to RAG 1, RAG 2, or both based on intent classification
4. System retrieves top relevant chunks via hybrid search + reranking
5. LLM generates a plain-English answer with inline citations
6. LLM-as-Judge verifies the answer against retrieved ICC documents
7. Verified answer is displayed with source document name, link, and last-updated timestamp
8. If unverifiable, system displays: *"This answer could not be verified against ICC documents."*

**Outcome:** User receives a factual, cited, politically neutral answer in plain English.

---

### Journey 2: Ask a Question About Pasted ICC Text

**Intent:** User has read part of an ICC document and wants to understand a specific passage.

**Flow:**

1. User reads an ICC document externally (e.g., PDF from icc-cpi.int)
2. User copies a passage from the document
3. User pastes the passage into the chat input alongside their question (e.g., *"What does this paragraph mean?"* + pasted text)
4. System runs hybrid search (BM25 + vector) on the pasted text to cross-reference against the knowledge base
5. If matched: system attaches proper citation metadata (document title, URL, date) and retrieves surrounding context chunks
6. If not matched: system flags with a warning — *"This text could not be verified against ingested ICC documents. The response may not be reliable."*
7. LLM generates an answer grounded in the pasted text and any matched knowledge base context
8. LLM-as-Judge verifies the answer
9. Verified answer displayed with inline citation markers and source passage preview

**Outcome:** User gets a focused answer about the specific passage, with proper citations when the text matches the knowledge base, or a clear warning when it doesn't.

---

### Journey 3: Look Up a Legal or Latin Term

**Intent:** User encounters an unfamiliar ICC term and wants a plain-English definition.

**Flow:**

1. User opens the Glossary or clicks an inline term link in an answer
2. User searches for or selects a term (e.g., *"confirmation of charges"*, *"in absentia"*)
3. System queries RAG 1 for the term definition
4. Definition is returned in plain English with a citation to the ICC source document

**Outcome:** User understands the term and can read the case with greater comprehension.

---

### Journey 4: Multi-Turn Conversation

**Intent:** User wants to ask follow-up questions that build on previous answers within the same conversation.

**Flow:**

1. User logs in with their admin-created username and password
2. User sees their existing conversations (up to 7 days old) or starts a new one
3. User asks a question; system responds with a cited answer
4. User asks a follow-up (e.g., *"What happens after that?"* or *"Can you explain the third count in simpler terms?"*)
5. System includes the last 5 user-assistant exchanges as context for the LLM (older turns remain visible in UI but are not sent to the LLM)
6. LLM generates a contextual follow-up answer with citations; LLM-as-Judge verifies independently
7. Each response is evaluated for political neutrality independently — conversational context does not erode guardrails
8. After 7 days, the conversation is automatically and permanently deleted

**Outcome:** User can conduct multi-turn research sessions across multiple logins within a 7-day window, with all guardrails maintained on every turn.

---

### Journey 5: Cost Cap or Daily Limit Reached

**Intent:** System needs to gracefully handle resource limits.

**Flow — Soft Daily Limit:**

1. User reaches the soft daily query limit (e.g., 30 queries/day)
2. System displays a nudge: *"You've reached your suggested daily limit. You can still ask questions, but please be mindful of shared resources."*
3. User can continue querying

**Flow — Global Monthly Cap:**

1. Global monthly LLM spend cap is reached
2. System enters read-only mode for all users
3. Users can still log in, view conversation history, and browse the document library
4. Q&A input is disabled with message: *"The Q&A service has reached its monthly usage limit. You can still browse your conversations and the document library. Service resets on [date]."*

**Outcome:** Users are never surprised by a lockout; resource limits are communicated clearly.

---

## 4. Functional Requirements

### Q&A Engine

- System shall classify every user query into an intent category before retrieval
- System shall route queries to RAG 1, RAG 2, or both based on intent classification
- System shall use hybrid search (BM25 + vector with RRF fusion) for all retrieval
- System shall rerank retrieved chunks using FlashRank before passing to LLM
- System shall pass every generated answer through LLM-as-Judge before displaying to user — no exceptions, including follow-up turns
- System shall display inline citation markers in the answer text, linking each claim to its source document
- System shall show the exact retrieved source passage (chunk) when a user clicks or expands a citation marker
- System shall include a direct link to the ICC source document URL alongside every citation
- System shall display the knowledge base last-updated timestamp alongside every answer
- System shall target answer delivery within 10 seconds (soft goal — not a hard SLA); display a loading state for longer queries
- System shall include the last 5 user-assistant exchanges as conversational context for multi-turn queries; older turns are excluded from the LLM call

### Document Library

- System shall display all ingested ICC documents with title, type, and publication date
- System shall link every document directly to its source on icc-cpi.int
- System shall serve as a reference for users to find and read ICC documents before pasting text into the chat

### Paste-Text Input

- System shall accept user-pasted text from ICC documents alongside a question in the chat input
- System shall cross-reference pasted text against the knowledge base using hybrid search (BM25 + vector) to identify the source document
- If matched: system shall attach citation metadata (document title, URL, date) and retrieve surrounding context chunks for richer answers
- If not matched: system shall answer the question but display a prominent warning — *"This text could not be verified against ingested ICC documents. The response may not be reliable."*
- Pasted text does not bypass any guardrail — neutrality, citation standards, prohibited outputs, and redacted-content rules still apply
- Even if a user pastes biased or editorialized content, the system's response remains neutral and grounded in ICC documents

### Glossary

- System shall support plain-English definitions for ICC legal and Latin terms
- System shall cite the ICC source document for every glossary definition
- System shall make glossary terms accessible inline from Q&A answers

### Knowledge Base Ingestion

**Validated:** Firecrawl scrape-mode tested against all target ICC URLs. All HTML pages and PDFs returned clean text. [REDACTED] markers preserved. Case records filtered URL worked. Rome Statute returned complete text. Crawl-mode is not used (see below).

**Ingestion strategy: scrape-mode on a curated URL list — not crawl-mode.**

ICC's site structure does not expose a crawlable link tree from the Duterte case page. Crawl-mode returns only 1 result from that entry point. Using `crawlEntireDomain=true` would ingest all ICC situations (Kosovo, Sudan, Palestine, etc.) and contaminate the knowledge base. The correct approach is two weekly jobs:

- **Job 1 — Scrape known URLs:** Scrape each URL in the curated list (see Section 15). If content hash is unchanged, skip re-ingestion.
- **Job 2 — Discover new filings:** Scrape the case records filtered URL, extract any new document links not already in the knowledge base, then scrape and ingest those new documents.

Other requirements:

- System shall scrape only publicly available ICC documents — sealed, confidential, or restricted documents are never accessed
- System shall parse all document formats (PDF, HTML) via Unstructured.io
- System shall preserve [REDACTED] markers from ICC documents — the LLM must never attempt to de-anonymize, identify, link names to, or investigate redacted content
- System shall store document chunks with full metadata in Supabase pgvector
- When an ICC document is updated or amended, system shall replace the old version with the new one and log the change (document_id, old content_hash, new content_hash, timestamp)
- System shall skip re-ingestion when content hash is unchanged (deduplication)

### Guardrails

- System shall never display an answer that implies guilt or innocence before a verdict
- System shall never display an answer containing political opinion or editorial language
- System shall never display an answer that cannot be traced to a specific ICC document (exception: unverified paste-text answers carry a warning instead of a citation)
- System shall never compare Duterte to other political leaders or heads of state
- System shall never frame the ICC as "for" or "against" the Philippines or any country
- System shall never characterize ICC proceedings using loaded language (e.g., "persecution," "witch hunt," "justice served," "murderer," "hero")
- System shall never attempt to de-anonymize, identify, or investigate [REDACTED] content — if asked, the system acknowledges the redaction exists and stops
- System shall respond to all out-of-scope questions with a flat decline: *"This is not addressed in current ICC records."* — no redirection, no suggestions, no engagement with the premise
- Out-of-scope includes: personal trivia about individuals, general knowledge, political speculation, other legal cases, anything outside the Duterte ICC case
- Each response in a multi-turn conversation is independently evaluated for neutrality — conversational context must not allow gradual erosion of guardrails across turns

### Multi-Turn Conversations

- System shall support multi-turn conversations where follow-up questions build on previous context
- System shall send the last 5 user-assistant exchanges as context to the LLM on each turn; older turns remain visible in the UI but are excluded from the LLM call
- Conversations persist for 7 days from the last message, then are automatically and permanently deleted — no recovery
- After 7 days, the user is prompted to start a new conversation
- Users can create multiple conversations and switch between them within the 7-day window
- Conversation history is strictly isolated per user — no user can access, view, or infer another user's history

### Authentication & Access

- System shall require admin-created username + password for access — no self-registration
- The admin (project owner) manually creates accounts for each user
- Each user's conversation history is linked to their account and isolated from other users
- System shall display on every page: *"This is an independent AI tool. Not affiliated with or endorsed by the International Criminal Court."*
- System shall display on every page: *"AI-generated content based on ICC official documents. Not legal advice."*
- System shall display a data privacy notice on the login page

### Cost Controls

- System shall enforce a global monthly LLM spend cap across all users
- When the global cap is reached, the app enters read-only mode: users can log in, view conversation history, and browse the document library, but cannot submit new queries
- Read-only mode displays: *"The Q&A service has reached its monthly usage limit. You can still browse your conversations and the document library. Service resets on [date]."*
- System shall enforce a soft daily query limit per user (e.g., 30 queries/day) — after the limit, users see a nudge message but can still query
- Soft limit message: *"You've reached your suggested daily limit. You can still ask questions, but please be mindful of shared resources."*

---

## 5. Data & Domain Concepts

### ICCDocument

An official document published by the International Criminal Court, ingested into the knowledge base.

**Fields:** `document_id`, `title`, `url`, `document_type` (case_record | press_release | legal_text | case_info_sheet), `date_published`, `rag_index` (1 = legal framework | 2 = case documents), `content_hash`, `last_crawled_at`

### DocumentChunk

A chunked portion of an ICCDocument, embedded and stored for retrieval.

**Fields:** `chunk_id`, `document_id`, `content`, `embedding` (vector), `chunk_index`, `token_count`, `metadata` (document_title, url, date_published, document_type, rag_index)

### Query

A user-submitted question.

**Fields:** `query_id`, `conversation_id`, `text`, `query_type` (general | paste_text | glossary), `pasted_text` (nullable — set when paste_text), `paste_text_matched` (nullable — boolean, whether pasted text was found in KB), `intent_category`, `rag_index_used`, `timestamp`

### Answer

An LLM-generated response to a Query, verified by LLM-as-Judge.

**Fields:** `answer_id`, `query_id`, `content`, `citations[]`, `verified` (bool), `judge_score`, `created_at`, `knowledge_base_last_updated`

### Citation

A reference to the ICC source document backing a specific claim in an Answer.

**Fields:** `citation_id`, `answer_id`, `document_id`, `document_title`, `url`, `date_published`, `source_passage` (the retrieved chunk text shown on citation click), `citation_marker` (e.g., "[1]" — inline reference in the answer text)

### GlossaryTerm

A plain-English definition of an ICC legal or Latin term.

**Fields:** `term_id`, `term`, `aliases[]`, `definition`, `source_document_id`, `source_url`

---

## 6. Key Relationships

- ICCDocument has many DocumentChunks
- DocumentChunk belongs to ICCDocument via `document_id`
- Query optionally includes `pasted_text` cross-referenced against ICCDocuments (paste_text queries only)
- Answer belongs to Query via `query_id`
- Answer has many Citations via `answer_id`
- Citation belongs to ICCDocument via `document_id`
- GlossaryTerm belongs to ICCDocument via `source_document_id`
- Access: RAG 1 index serves legal framework queries; RAG 2 index serves case document queries; paste-text queries cross-reference against both indexes via hybrid search

---

## 7. Success Criteria

### Answer Quality

- LLM-as-Judge passes answers at ≥ 90% rate in test scenarios
- 0 answers containing political opinion, speculation, or guilt implication pass to user
- Multi-turn neutrality: 0 cases where conversational context causes guardrail erosion across turns

### Citation Coverage

- 100% of surfaced answers include at least one ICC document citation with inline marker and source passage preview
- Exception: unverified paste-text answers display a warning instead of a citation

### Guardrail Effectiveness

- System correctly declines out-of-scope questions (flat decline, no engagement) in 100% of test cases
- System correctly returns "not in ICC records" for questions outside the knowledge base
- System correctly refuses to investigate or de-anonymize [REDACTED] content in 100% of test cases

### Retrieval Performance

- Hybrid search + reranking returns relevant top-3 chunks in ≤ 3 seconds for 95% of queries
- Paste-text cross-referencing identifies the source document in ≥ 85% of cases where the text is from an ingested ICC document

### Data Freshness

- Knowledge base updated within 7 days of new ICC document publication (weekly scrape of curated URL list + case records discovery job)
- Last-updated timestamp visible on every answer

### Conversation & Cost

- Conversations auto-delete after 7 days with 100% reliability
- Conversation isolation: 0 cases where one user can access another user's history
- Global monthly cost cap prevents overspend; app enters read-only mode before exceeding budget

---

## 8. Edge Cases & Constraints

- **User asks politically charged question** ("Was Duterte justified?", "Is ICC biased?"): Flat decline — *"This is not addressed in current ICC records."* No engagement, no redirection
- **User asks out-of-bounds question** ("Duterte's favorite color", "Why is the sky blue?", "Who will be the next president?"): Flat decline — *"This is not addressed in current ICC records."*
- **Question not in ICC records:** System responds with *"This is not addressed in current ICC records."* — never speculates or fills gaps
- **LLM-as-Judge fails an answer:** Answer is blocked; user sees *"This answer could not be verified against ICC documents. Please rephrase your question."*
- **User pastes text not found in knowledge base:** System answers with a prominent warning — *"This text could not be verified against ingested ICC documents. The response may not be reliable."*
- **User pastes biased or editorialized content:** System responds neutrally regardless — guardrails apply to the response, not to the input
- **User asks about [REDACTED] content:** System acknowledges the redaction exists and stops — *"This content is redacted in ICC records. The Docket cannot investigate or speculate on redacted material."*
- **User attempts to de-anonymize redacted content across turns:** Each turn independently refuses — no cumulative reasoning about redacted content across conversation history
- **Glossary term not found:** System responds *"This term is not currently in the ICC glossary."*
- **Weekly scrape finds no changed documents:** Content hashes match; no re-ingestion triggered; no user-facing message; last-updated timestamp unchanged
- **ICC website unavailable during weekly scrape:** Skip that scrape cycle; retain existing data; do not surface error to user
- **ICC document updated or amended:** Old version is replaced; change is logged (old hash, new hash, timestamp); past answers retain their original citations
- **LLM unavailable:** Display *"The Q&A service is temporarily unavailable. Please try again shortly."*; do not fall back to unverified answers
- **Conversation reaches 7-day expiry:** Conversation is permanently deleted; user sees a message to start a new conversation
- **Soft daily limit reached:** User sees a nudge message but can continue querying
- **Global monthly cap reached mid-conversation:** App enters read-only mode; user can view history and documents but cannot submit queries; clear message with reset date
- **User queries during weekly re-ingestion:** System serves from existing data; partially ingested documents are not queryable until ingestion completes
- **Empty knowledge base (first deploy):** All queries return *"This is not addressed in current ICC records."* with a note that the knowledge base is being populated
- **Non-English query (Taglish/Tagalog):** System responds *"The Docket currently supports English only. Please ask your question in English."*
- **Citation link rot (ICC moves a URL):** Broken links are not detected in iteration 1 — documented as a known risk for future iteration

---

## 9. Supported Query Capabilities (Iteration 1)

### Intent Categories


| Intent            | Description                                            | Routed To           | Example                                             |
| ----------------- | ------------------------------------------------------ | ------------------- | --------------------------------------------------- |
| `case_facts`      | Facts about the Duterte case — charges, events, status | RAG 2               | *"What is Duterte charged with?"*                   |
| `case_timeline`   | Dates, hearings, procedural events in the case         | RAG 2               | *"When was Duterte arrested?"*                      |
| `legal_concept`   | ICC laws, articles, legal definitions                  | RAG 1               | *"What is a confirmation of charges hearing?"*      |
| `procedure`       | How the ICC process works                              | RAG 1               | *"What happens after charges are confirmed?"*       |
| `glossary`        | Definition of a legal or Latin term                    | RAG 1               | *"What does 'in absentia' mean?"*                   |
| `paste_text`      | Question about user-pasted ICC text                    | Hybrid cross-ref + RAG 2 | *"What does this paragraph mean?"* + pasted text    |
| `out_of_scope`    | Political opinion, speculation, non-ICC content, personal trivia, general knowledge | Guardrail — flat decline | *"Was Duterte right?"*, *"What's his favorite color?"* |


---

## 10. API Contract

### General Q&A

**Endpoint:** `POST /api/query`

**Request:**

```json
{
  "query": "What are the charges against Duterte?",
  "query_type": "general",
  "conversation_id": "conv_abc123"
}
```

**Response:**

```json
{
  "answer": "Rodrigo Duterte is charged with three counts of crimes against humanity [1]...",
  "citations": [
    {
      "citation_marker": "[1]",
      "document_title": "Case Information Sheet — Duterte",
      "url": "https://www.icc-cpi.int/sites/default/files/2026-02/DuterteEng.pdf",
      "date_published": "2026-02",
      "source_passage": "Rodrigo Roa Duterte is suspected of crimes against humanity of murder (article 7(1)(a)), imprisonment or other severe deprivation of physical liberty (article 7(1)(e))..."
    }
  ],
  "verified": true,
  "intent_category": "case_facts",
  "rag_index_used": 2,
  "knowledge_base_last_updated": "2026-02-28"
}
```

---

### Paste-Text Q&A

**Endpoint:** `POST /api/query`

**Request:**

```json
{
  "query": "What does this paragraph mean in simpler terms?",
  "query_type": "paste_text",
  "pasted_text": "The Chamber finds that there is a reasonable basis to believe that crimes against humanity of murder (article 7(1)(a)) and imprisonment or other severe deprivation of physical liberty (article 7(1)(e))...",
  "conversation_id": "conv_abc123"
}
```

**Response:**

```json
{
  "answer": "This paragraph says the court found enough initial evidence to believe that...",
  "citations": [
    {
      "document_title": "Document Containing the Charges",
      "url": "https://www.icc-cpi.int/sites/default/files/CourtRecords/0902ebd180c9bfd4.pdf",
      "date_published": "2025-09-22",
      "source_passage": "The Chamber finds that there is a reasonable basis to believe that crimes against humanity...",
      "matched": true
    }
  ],
  "paste_text_verified": true,
  "verified": true,
  "intent_category": "paste_text",
  "rag_index_used": 2,
  "knowledge_base_last_updated": "2026-02-28"
}
```

**When paste-text is not matched:**

```json
{
  "paste_text_verified": false,
  "warning": "This text could not be verified against ingested ICC documents. The response may not be reliable."
}
```

---

### Conversation Management

**Endpoint:** `GET /api/conversations`

**Response:**

```json
{
  "conversations": [
    {
      "conversation_id": "conv_abc123",
      "title": "Charges against Duterte",
      "created_at": "2026-02-25T10:00:00Z",
      "last_message_at": "2026-02-25T10:15:00Z",
      "expires_at": "2026-03-04T10:15:00Z",
      "message_count": 6
    }
  ]
}
```

**Endpoint:** `GET /api/conversations/:id/messages`

**Response:**

```json
{
  "messages": [
    {
      "role": "user",
      "content": "What is Duterte charged with?",
      "timestamp": "2026-02-25T10:00:00Z"
    },
    {
      "role": "assistant",
      "content": "Rodrigo Duterte is charged with three counts of crimes against humanity...",
      "citations": [...],
      "timestamp": "2026-02-25T10:00:08Z"
    }
  ]
}
```

---

### Document Library

**Endpoint:** `GET /api/documents`

**Response:**

```json
{
  "documents": [
    {
      "document_id": "doc_duterte_dcc_2025_09",
      "title": "Document Containing the Charges",
      "url": "https://www.icc-cpi.int/sites/default/files/CourtRecords/0902ebd180c9bfd4.pdf",
      "document_type": "case_record",
      "date_published": "2025-09-22",
      "rag_index": 2
    }
  ],
  "total_count": 14,
  "last_updated": "2026-02-28"
}
```

---

### Glossary Lookup

**Endpoint:** `GET /api/glossary/:term`

**Response:**

```json
{
  "term": "confirmation of charges",
  "definition": "A hearing where Pre-Trial Chamber judges review the prosecution's evidence to decide whether there is enough to proceed to full trial.",
  "source": {
    "document_title": "Rules of Procedure and Evidence",
    "url": "https://www.icc-cpi.int/sites/default/files/Publications/Rules-of-Procedure-and-Evidence.pdf"
  }
}
```

---

# ━━━ ADVANCED SECTIONS ━━━

## 11. Interpretation Contract (LLM)

### 11.1 Semantic Taxonomy


| Category          | Description                                     | Example phrasings                                                                               |
| ----------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `case_facts`      | Facts about the case — charges, events, people  | *"What is Duterte charged with?"*, *"When was he arrested?"*, *"Who are the victims?"*          |
| `case_timeline`   | Dates and sequence of case events               | *"When did the arrest happen?"*, *"What happened at the February hearing?"*                     |
| `legal_concept`   | ICC law, articles, definitions                  | *"What is Article 7?"*, *"What is a Pre-Trial Chamber?"*, *"What are crimes against humanity?"* |
| `procedure`       | How ICC process works step by step              | *"What happens after confirmation of charges?"*, *"What is the next step?"*                     |
| `glossary`        | Plain-English meaning of a legal/Latin term     | *"What does 'in absentia' mean?"*, *"What is 'proprio motu'?"*                                  |
| `paste_text`      | Question about user-pasted ICC text             | Any query with `pasted_text` field set                                                          |
| `out_of_scope`    | Political opinion, speculation, non-ICC content, personal trivia, general knowledge | *"Was Duterte right?"*, *"Is the ICC biased?"*, *"What's his favorite color?"*, *"Why is the sky blue?"* |


### 11.2 Phrase-to-Output Mapping


| Phrase pattern                                                          | Structured output                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| *"What is [person] charged with"*                                       | `{intent: "case_facts", rag_index: 2, query: original}`                        |
| *"What does [term] mean"* / *"What is [term]"* (legal/Latin)            | `{intent: "glossary", rag_index: 1, term: extracted_term}`                     |
| *"What happens after / next"*                                           | `{intent: "procedure", rag_index: 1, query: original}`                         |
| *"When did / when is"*                                                  | `{intent: "case_timeline", rag_index: 2, query: original}`                     |
| *"What is Article [N]"* / *"What does the Rome Statute say"*            | `{intent: "legal_concept", rag_index: 1, query: original}`                     |
| Any query with `pasted_text` field set                                  | `{intent: "paste_text", rag_index: 2, pasted_text: set, query: original}`      |
| *"Was [person] right"* / *"Is [institution] biased"* / opinion requests | `{intent: "out_of_scope", action: "flat_decline"}`                             |
| Personal trivia / general knowledge / non-ICC topics                    | `{intent: "out_of_scope", action: "flat_decline"}`                             |
| *"Who is [REDACTED]"* / *"Can you figure out what's redacted"*          | `{intent: "out_of_scope", action: "flat_decline"}`                             |


### 11.3 Field Resolution Rules


| User says                                      | Maps to                           | Notes                                   |
| ---------------------------------------------- | --------------------------------- | --------------------------------------- |
| *"Duterte"*, *"Rodrigo"*, *"former president"* | Subject of case `ICC-01/21-01/25` | Always refers to Rodrigo Roa Duterte    |
| *"the charges"*, *"what he's accused of"*      | Counts 1–3 in the DCC             | Three counts of crimes against humanity |
| *"the hearing"*, *"the trial"*                 | Most recent proceeding in RAG 2   | Scoped to Duterte case only             |
| *"the law"*, *"ICC law"*, *"the rules"*        | Rome Statute / Rules of Procedure | Route to RAG 1                          |
| *"next steps"*, *"what happens now"*           | ICC procedural sequence           | Route to RAG 1 for procedure            |


### 11.4 Prohibited Outputs


| Rule                                                                                    | Reason                                                                |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Do NOT express an opinion on guilt, innocence, or culpability                           | Philippine cyber libel exposure; political neutrality hard constraint |
| Do NOT use the words "guilty", "innocent", "murderer", "hero", "corrupt", "persecution", "witch hunt", "justice served" | Loaded language — guardrail violation                                 |
| Do NOT compare Duterte to other political leaders or heads of state                     | Political neutrality — no comparative framing                        |
| Do NOT frame the ICC as "for" or "against" the Philippines or any country               | Institutional neutrality — ICC is a judicial body, not a political actor |
| Do NOT speculate on what ICC judges will decide                                         | No ICC document supports this; LLM-as-Judge will block it             |
| Do NOT reference news articles, government statements, or non-ICC sources               | Data isolation — ICC documents only                                   |
| Do NOT infer, reconstruct, de-anonymize, or investigate [REDACTED] content              | Legal and ethical hard stop — redaction boundary is absolute          |
| Do NOT engage with out-of-scope questions — decline flatly with no redirection          | No engagement with political, personal, or general knowledge premises |
| Do NOT answer without citing a specific ICC document (exception: unverified paste-text answers carry a warning) | Uncited answers are blocked by LLM-as-Judge                           |
| Do NOT allow multi-turn context to erode neutrality — each response is independently evaluated | Prevents gradual steering via adversarial conversation threads       |


### 11.5 Acceptance Scenarios


| ID    | Given                                                               | When                                                    | Then                                                                                                       |
| ----- | ------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| NL-01 | RAG 2 contains DCC document                                         | User asks *"What is Duterte charged with?"*             | Answer lists 3 counts of crimes against humanity; cites DCC document with inline markers and source passage |
| NL-02 | RAG 1 contains Rules of Procedure                                   | User asks *"What happens after charges are confirmed?"* | Answer explains trial phase per ICC procedure; cites Rules of Procedure                                    |
| NL-03 | User asks *"Was Duterte justified in the drug war?"*                | Any state                                               | Flat decline: *"This is not addressed in current ICC records."* No engagement, no redirection              |
| NL-04 | User asks *"What does 'in absentia' mean?"*                         | Any state                                               | Glossary definition returned with ICC source citation                                                      |
| NL-05 | User pastes DCC paragraph; asks *"What does this mean?"*            | `pasted_text` set                                       | Answer explains passage in plain English; cross-references KB; cites DCC if matched                        |
| NL-06 | Question has no relevant ICC documents                              | User asks about unrelated event                         | Returns: *"This is not addressed in current ICC records."*                                                 |
| NL-07 | User pastes text not in knowledge base                              | `pasted_text` set, no KB match                          | Answer provided with warning: *"This text could not be verified against ingested ICC documents."*          |
| NL-08 | User asks *"Who is [REDACTED] in the charges?"*                     | Any state                                               | System acknowledges redaction and declines: *"This content is redacted in ICC records."*                   |
| NL-09 | User asks follow-up in multi-turn                                   | Conversation has prior context                          | Answer uses last 5 turns as context; independently verified for neutrality by LLM-as-Judge                 |
| NL-10 | User asks *"What's Duterte's favorite color?"*                      | Any state                                               | Flat decline: *"This is not addressed in current ICC records."*                                            |


---

## 12. Data Flow Contract (Pipeline)

### 12.1 Pipeline Stages

**Job 1 — Known URLs (weekly):**
```
Curated URL list → Firecrawl scrape → content hash check → Unstructured.io (parse) → LangChain Splitter (chunk) → OpenAI Embeddings → Supabase pgvector (store)
```

**Job 2 — New filing discovery (weekly, runs after Job 1):**
```
Case records filtered URL → Firecrawl scrape → extract new document links → Firecrawl scrape each new URL → Unstructured.io (parse) → LangChain Splitter (chunk) → OpenAI Embeddings → Supabase pgvector (store)
```

### 12.2 Data Shape at Each Boundary


| Boundary                 | Content                                       | Key Transformation                                                                           |
| ------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| After Firecrawl          | Raw HTML or PDF bytes + URL metadata          | Source URL, crawl timestamp captured                                                         |
| After Unstructured.io    | Structured plain text + document metadata     | PDF/HTML → clean text; headings, article numbers, tables preserved                           |
| After LangChain Splitter | Text chunks with overlap + inherited metadata | Chunked by size; metadata (document_id, title, url, date, rag_index) attached to every chunk |
| After OpenAI Embeddings  | Chunks + 1536-dimension embedding vectors     | Each chunk has embedding for vector search                                                   |
| After Supabase insert    | Stored DocumentChunks queryable via pgvector  | BM25 index also maintained for hybrid search                                                 |


---

## 13. Data Quality Rules

### 13.1 Input Variations


| Field type          | Variations system must handle                         | Resolution strategy                                        |
| ------------------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| PDF documents       | Scanned PDFs, text PDFs, mixed                        | Unstructured.io handles both; OCR for scanned              |
| Legal numbering     | "Article 7(1)(a)", "Rule 84", "Count 1"               | Preserve exactly — used in citations                       |
| Dates               | "7 March 2025", "2025-03-07", "March 2025"            | Normalize to ISO 8601 for storage; display as published    |
| [REDACTED] markers  | `[REDACTED]`, `████`, blank sections                  | Preserve marker text as-is; never replace or infer         |
| Latin terms         | Mixed case, abbreviations (*"proprio motu"*, *"OTP"*) | Preserve as-is; map to glossary entries where available    |
| HTML pages          | Navigation, headers, footers, boilerplate             | Strip non-content HTML; retain body text and headings only |
| Duplicate documents | Same document re-crawled with no changes              | Compare `content_hash`; skip re-ingestion if hash matches  |


---

## 14. System Prompt Contract (LLM)

### 14.1 Prompt Structure


| Section                   | Static/Dynamic | Purpose                                                           |
| ------------------------- | -------------- | ----------------------------------------------------------------- |
| Role definition           | Static         | Establishes the LLM as a neutral ICC case analyst                 |
| Behavioral rules          | Static         | Hard guardrails: neutrality, citation requirement, no speculation, redaction protection |
| Output format rules       | Static         | Plain English, inline citation markers, response structure        |
| Retrieved context         | Dynamic        | ICC document chunks retrieved by RAG                              |
| Query type context        | Dynamic        | Tells LLM whether it's general Q&A, paste-text, or glossary      |
| Pasted text context       | Dynamic        | Injected only for paste-text queries; includes match status       |
| Conversation history      | Dynamic        | Last 5 user-assistant exchanges for multi-turn context            |


### 14.2 Dynamic Injection Points


| Point                           | Source                                   | When                                          |
| ------------------------------- | ---------------------------------------- | --------------------------------------------- |
| `{retrieved_chunks}`            | Top-N reranked chunks from RAG retrieval | Every query — the factual basis of the answer |
| `{query_type}`                  | Query intent classification              | Every query — scopes LLM behavior             |
| `{pasted_text}`                 | User-pasted ICC document text            | Paste-text queries only                       |
| `{paste_text_matched}`          | Boolean — whether pasted text was found in KB | Paste-text queries only — controls warning display |
| `{conversation_history}`        | Last 5 user-assistant exchanges          | Multi-turn queries — provides conversational context |
| `{knowledge_base_last_updated}` | Supabase metadata                        | Every query — appended to every answer        |


### 14.3 System Prompt (Draft)

```
You are a neutral, factual analyst for The Docket — an application that explains the Duterte ICC case using only official ICC documents.

ROLE:
- Answer questions about the Duterte ICC case and ICC procedures in plain English
- Your audience is non-lawyers — explain all legal and Latin terms clearly
- You are a neutral information tool, not an advocate for any position

HARD RULES (never violate):
1. Only answer using the ICC documents provided in {retrieved_chunks}
2. Every factual claim must cite its source document inline using the citation marker format below
3. Never express an opinion on guilt, innocence, or culpability
4. Never use politically loaded language (e.g., "murderer", "hero", "persecution", "corrupt", "witch hunt", "justice served")
5. Never compare Duterte to other political leaders or heads of state
6. Never frame the ICC as "for" or "against" any country
7. Never speculate on what ICC judges will decide
8. Never reference news articles, government statements, or non-ICC sources
9. Never infer, reconstruct, de-anonymize, or investigate [REDACTED] content — if asked about redacted content, respond: "This content is redacted in ICC records. The Docket cannot investigate or speculate on redacted material."
10. If a question cannot be answered from the provided documents, respond only with: "This is not addressed in current ICC records." — no redirection, no suggestions, no engagement with the premise
11. If the question is about personal trivia, general knowledge, or anything outside the Duterte ICC case, respond only with: "This is not addressed in current ICC records."

CITATION FORMAT:
After every factual claim, add an inline citation marker: [1], [2], etc.
At the end of your answer, list all citations with:
- [N] {document_title}, {date_published} — ICC official document — {url}
Each citation marker in the text must correspond to a specific source passage that can be shown to the user.

PASTE-TEXT QUERIES:
When the user provides pasted text ({pasted_text}):
- Answer the question using the pasted text and any matched knowledge base context
- If {paste_text_matched} is true, cite the matched ICC document normally
- If {paste_text_matched} is false, include this warning at the top of your answer: "⚠ This text could not be verified against ingested ICC documents. The response may not be reliable."
- Even if the pasted text contains biased or editorialized language, your response must remain neutral

MULTI-TURN CONTEXT:
- You may receive {conversation_history} with previous exchanges
- Use this context to understand follow-up questions, but evaluate every response independently for neutrality
- Do not let prior conversation context erode any hard rule
- Do not accumulate reasoning about [REDACTED] content across turns

OUT-OF-SCOPE QUESTIONS:
For any question that is political opinion, personal trivia, general knowledge, or outside the Duterte ICC case, respond only with:
"This is not addressed in current ICC records."
Do not add context. Do not redirect. Do not engage with the premise.

RESPONSE FORMAT:
- Plain English — no unexplained jargon
- If a legal or Latin term appears, define it inline in parentheses
- Clearly distinguish between what ICC documents state and what ICC has not yet ruled on
- End every answer with: "Last updated from ICC records: {knowledge_base_last_updated}"
```

---

## 15. RAG Contract

### 15.1 Indexing Contract

**Data sources:**


All URLs validated with Firecrawl scrape-mode. Ingestion uses scrape-mode only — crawl-mode is not used.

| Source | URL | RAG Index | Content type | Update frequency |
| ------ | --- | --------- | ------------ | ---------------- |
| Core Legal Texts hub | https://www.icc-cpi.int/publications/core-legal-texts | 1 | HTML → plain text | Rarely |
| Rome Statute | https://www.icc-cpi.int/sites/default/files/2024-05/Rome-Statute-eng.pdf | 1 | PDF → plain text | Rarely (on new edition) |
| Rules of Procedure and Evidence | https://www.icc-cpi.int/sites/default/files/Publications/Rules-of-Procedure-and-Evidence.pdf | 1 | PDF → plain text | Rarely |
| Elements of Crimes | https://www.icc-cpi.int/sites/default/files/Publications/Elements-of-Crimes.pdf | 1 | PDF → plain text | Rarely |
| How the Court Works | https://www.icc-cpi.int/about/how-the-court-works | 1 | HTML → plain text | Rarely |
| Resource Library | https://www.icc-cpi.int/resource-library | 1 | HTML → plain text | Rarely |
| Main Duterte case page | https://www.icc-cpi.int/philippines/duterte | 2 | HTML → plain text | Weekly |
| Philippines situation page | https://www.icc-cpi.int/philippines | 2 | HTML → plain text | Weekly |
| Case records — all filings *(discovery job)* | https://www.icc-cpi.int/case-records?f%5B0%5D=cr_case_code%3A1527 | 2 | HTML → extract links | Weekly |
| Case Information Sheet (Feb 2026) | https://www.icc-cpi.int/sites/default/files/2026-02/DuterteEng.pdf | 2 | PDF → plain text | Weekly |
| Key Messages document | https://www.icc-cpi.int/sites/default/files/2025-07/Duterte%20Case%20Key%20Messages.pdf | 2 | PDF → plain text | Weekly |
| Document Containing the Charges (Sep 2025) | https://www.icc-cpi.int/sites/default/files/CourtRecords/0902ebd180c9bfd4.pdf | 2 | PDF → plain text | Weekly |
| Victims page | https://www.icc-cpi.int/victims/duterte-case | 2 | HTML → plain text | Weekly |


**Chunking strategy:**


| Parameter       | RAG 1 (Legal Framework)         | RAG 2 (Case Documents) | Rationale                                                               |
| --------------- | ------------------------------- | ---------------------- | ----------------------------------------------------------------------- |
| Chunk size      | 600 tokens                      | 400 tokens             | Legal articles are longer; case documents more granular                 |
| Chunk overlap   | 60 tokens                       | 40 tokens              | Prevents splitting article numbers and legal references                 |
| Chunking method | By article/rule/section heading | By paragraph           | Preserves legal structure in RAG 1; maintains document context in RAG 2 |


**Metadata per chunk:**


| Field            | Source             | Purpose                                                 |
| ---------------- | ------------------ | ------------------------------------------------------- |
| `document_id`    | ICCDocument record | Links chunk to source document for citation             |
| `document_title` | ICCDocument record | Displayed in citation                                   |
| `url`            | ICCDocument record | Direct link in citation                                 |
| `date_published` | ICCDocument record | Freshness display in answer                             |
| `rag_index`      | ICCDocument record | Mandatory filter — routes queries to correct index      |
| `document_type`  | ICCDocument record | Filtering by case_record vs legal_text vs press_release |
| `chunk_index`    | Ingestion pipeline | Order preservation within document                      |


### 15.2 Retrieval Contract


| Parameter                            | Value                                   | Rationale                                                                     |
| ------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------- |
| Initial top-k (pre-rerank)           | 10                                      | Wide net for hybrid search; FlashRank narrows to best                         |
| Final top-k (post-rerank)            | 4                                       | Enough context for LLM without exceeding token budget                         |
| Similarity threshold                 | 0.68                                    | Below this, chunks are unlikely to be relevant                                |
| Mandatory filter                     | `rag_index` matches query intent        | Prevents legal framework chunks appearing in case fact answers and vice versa |
| Paste-text cross-reference           | Hybrid search (BM25 + vector) on pasted text | Identifies source document for citation; uses same pipeline as query retrieval |
| Paste-text match threshold           | Same as similarity threshold (0.68)     | Below this, pasted text is flagged as unverified                              |
| Fallback (no chunks above threshold) | Return "not in ICC records" message     | Never hallucinate when retrieval fails                                        |


### 15.3 Context Injection


| Parameter          | Value                                                                          |
| ------------------ | ------------------------------------------------------------------------------ |
| Location in prompt | After system rules and behavioral guardrails, before user query                |
| Format             | Numbered list, each chunk labeled with source document title and date          |
| Token budget       | Max 3,000 tokens for retrieved context                                         |
| Citation format    | `[Source: {document_title}, {date_published} — ICC official document — {url}]` |


### 15.4 Answer Quality Rules


| ID      | Rule                                                                              | Reason                                                     |
| ------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| RAG-R-1 | Only answer using retrieved ICC document chunks                                   | Prevents hallucination                                     |
| RAG-R-2 | Cite source document for every factual claim                                      | User can verify; legal accountability                      |
| RAG-R-3 | If retrieved context is insufficient, say so explicitly                           | Prefer acknowledged ignorance over plausible wrong answers |
| RAG-R-4 | Never combine RAG 1 and RAG 2 context in a way that implies they are one document | Different indexes serve different purposes                 |
| RAG-R-5 | In paste-text mode, cross-reference pasted text against KB via hybrid search; flag as unverified if no match | Trust-but-verify for user-submitted content                |
| RAG-R-6 | LLM-as-Judge must verify every answer against retrieved chunks before display     | Second layer of hallucination protection                   |
| RAG-R-7 | Answers must acknowledge ICC records last-updated date                            | Transparency about data freshness                          |


---

## 17. End-to-End Scenarios (Pipeline)


| ID     | Scenario                         | Input                                                        | Expected Output                                                                                      |
| ------ | -------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| E2E-01 | ICC law question                 | *"What is Article 7 of the Rome Statute?"*                   | Answer from RAG 1 chunks; inline citation markers; source passage viewable; verified = true           |
| E2E-02 | Case fact question               | *"What are the three counts against Duterte?"*               | Answer from RAG 2 DCC chunks; cites Document Containing the Charges; verified = true                 |
| E2E-03 | Political opinion question       | *"Was the drug war justified?"*                              | Flat decline: *"This is not addressed in current ICC records."*; no engagement                       |
| E2E-04 | Paste-text (matched)             | User pastes DCC paragraph; asks *"What does this mean?"*     | Answer explains passage; cross-ref matches DCC; cites DCC; verified = true                           |
| E2E-05 | Paste-text (unmatched)           | User pastes non-ICC text; asks a question                    | Answer provided with warning: *"This text could not be verified..."*; verified = true                |
| E2E-06 | Glossary lookup                  | *"What does 'confirmation of charges' mean?"*                | Plain-English definition from RAG 1; cites Rules of Procedure                                        |
| E2E-07 | Question not in ICC records      | *"What does Duterte's family think?"*                        | Flat decline: *"This is not addressed in current ICC records."*                                      |
| E2E-08 | LLM generates unverified claim   | LLM answer contains unsupported claim                        | LLM-as-Judge blocks; user sees *"This answer could not be verified against ICC documents."*          |
| E2E-09 | New ICC document published       | Discovery job finds new filing link in case records page     | New URL scraped; document chunked, embedded, stored; last-updated refreshed                          |
| E2E-10 | Multi-turn follow-up             | User asks *"What are the charges?"* then *"Explain count 2"* | Second answer uses last 5 turns as context; independently verified; cites DCC                        |
| E2E-11 | Redacted content question        | *"Who is [REDACTED] in the charges?"*                        | System acknowledges redaction; declines to investigate                                               |
| E2E-12 | Out-of-bounds personal trivia    | *"What's Duterte's favorite color?"*                         | Flat decline: *"This is not addressed in current ICC records."*                                      |
| E2E-13 | Soft daily limit reached         | User makes 31st query of the day                             | Nudge message shown; user can still query                                                            |
| E2E-14 | Global monthly cap reached       | Total LLM spend exceeds monthly cap                          | App enters read-only mode; users see message with reset date; can browse history and docs             |
| E2E-15 | Conversation expires (7 days)    | User returns to a conversation after 7 days                  | Conversation is deleted; user prompted to start a new one                                            |
| E2E-16 | Non-English query                | *"Ano yung charges kay Duterte?"*                            | System responds: *"The Docket currently supports English only."*                                     |
| E2E-17 | ICC document updated             | Weekly scrape detects changed content hash on DCC URL        | Old version replaced; change logged; new chunks embedded and stored                                  |


---

## 18. Assumptions

- ICC official website (icc-cpi.int) remains publicly accessible for scraping
- Firecrawl scrape-mode successfully accesses all target ICC URLs — **validated.** All HTML pages and PDFs return clean text; [REDACTED] markers preserved; case records filtered URL works; Rome Statute returned complete. Crawl-mode is not used (returns only 1 result from the Duterte case page; broad crawl would contaminate knowledge base with non-Duterte content).
- OpenAI `text-embedding-3-small` embeddings are sufficient for semantic retrieval accuracy on legal text
- `gpt-4o-mini` is sufficient for both answer generation and LLM-as-Judge verification — two LLM calls per query
- ICC case documents are in English — no translation required for iteration 1
- Weekly crawl frequency is sufficient given the pace of ICC proceedings
- Supabase free tier is sufficient for the volume of ICC documents, user accounts, and conversation storage in scope — **not yet sized (see Risks)**
- The confirmation of charges decision (pending as of February 2026) will add new documents to RAG 2 when published
- User base is small (admin-created accounts for friends) — no self-registration, no public access
- Global monthly cost cap is sufficient to manage LLM spend for the expected user base
- Hybrid search (BM25 + vector) is sufficient for paste-text cross-referencing even when formatting differs slightly from ingested content

---

## 19. Known Risks

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| **Firecrawl crawl-mode not viable** | ~~Day-one blocker~~ **Resolved** — scrape-mode validated against all target URLs | Use scrape-mode on curated URL list + case records discovery job; do not use crawl-mode |
| **Supabase free tier sizing unknown** | Could hit storage or query limits with documents + conversations | Estimate chunk count, user count, and conversation volume; size against free tier limits |
| **FlashRank untested on legal text** | Reranking may underperform on ICC legal jargon | Validate during pipeline spike; have fallback to raw similarity ranking |
| **Citation link rot** | ICC may move or remove document URLs; citation links break | Not addressed in iteration 1; documented for future — consider periodic link validation |
| **Concurrent crawl + query** | Users may get inconsistent results during weekly re-ingestion | Ensure partially ingested documents are not queryable until ingestion completes |
| **Mobile-first audience, desktop-only app** | Target audience (18-35 Filipino digital natives) is predominantly mobile | Acknowledged tension; mobile deferred to future iteration |
| **ICC robots.txt compliance** | `ai-train=no` may be interpreted broadly; crawling for retrieval is a separate use case | Document legal basis for retrieval-only crawling; do not fine-tune on ICC data |
| **Two LLM calls per query (generation + judge)** | Doubles cost and latency per query | Accepted trade-off — judge is non-negotiable safety net; budget accordingly |

---

## Legal Bounds & Compliance

### ICC Document Usage

- Only publicly available ICC documents may be ingested and referenced
- All content attributed to the ICC as original source with direct links on every answer
- No sealed, redacted, or restricted ICC content may be accessed or displayed
- `ai-train=no` per ICC robots.txt (EU Directive 2019/790 Article 4) — no model fine-tuning on ICC data, ever
- This application's use is classified as `ai-input` (RAG retrieval / grounding) under the ICC robots.txt Content Signal framework — ICC explicitly chose not to restrict `ai-input`, having the framework to do so. This distinction is on record: retrieval for Q&A is not training.

### Misrepresentation — Hard Line

- No ICC logos or official branding anywhere in the application
- No implied ICC endorsement or affiliation
- Every page footer: *"This is an independent AI tool. Not affiliated with or endorsed by the International Criminal Court."*
- Every answer: *"AI-generated summary based on ICC official documents."*

### Philippine Cybercrime Prevention Act (2012)

- No factual claims about named individuals beyond what ICC documents explicitly state
- No statements implying guilt before charges are formally confirmed by ICC ruling
- No editorializing that could be construed as defamatory
- Enforced by neutrality guardrails and LLM-as-Judge

### ICC Contempt of Court (Rome Statute Article 70)

- No content that could interfere with ongoing proceedings
- No speculation on witness identities or sealed evidence
- No attempt to de-anonymize, identify, or investigate [REDACTED] content — redaction boundary is absolute
- Mitigated by ICC-sources-only rule, [REDACTED] hard-wall guardrail, and per-turn independent neutrality evaluation

### Data Privacy

- Philippines Data Privacy Act (2012): User accounts store only username and hashed password; conversation history auto-deletes after 7 days
- Conversation history is strictly isolated per user — no cross-user access
- No conversation data is used for training, analytics, or any purpose beyond serving the user's active session
- GDPR: Privacy notice displayed at login
- No query logging beyond what is needed for conversation continuity (messages stored for 7-day window only)

### Required Disclaimers on Every Page


| Disclaimer                                           | Placement           |
| ---------------------------------------------------- | ------------------- |
| Not affiliated with or endorsed by the ICC           | Every page — footer |
| AI-generated content based on ICC official documents | Every answer        |
| Not legal advice — consult a qualified attorney      | Every page — footer |
| Knowledge base last updated: [date]                  | Every answer        |
| Data privacy notice                                  | Login page          |


