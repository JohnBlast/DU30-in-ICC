# DU30 in ICC — Product Requirements Document (Iteration 2)

> **What this is:** PRD for DU30 in ICC Iteration 2 — adding a content fact-checker and Tanglish/Tagalog language support to the existing RAG-powered Q&A application.
> **Iteration scope:** Iteration 2. Builds on top of Iteration 1 (MVP) which is live and deployed.
> **Prerequisite:** Iteration 1 PRD (PRD.md) — all iteration 1 features remain unchanged unless explicitly modified below.

---

# ━━━ CORE SECTIONS ━━━

## 1. Overview

### Product Context

The Docket is a desktop web application that allows users to ask questions about the Duterte ICC case and receive factual, cited, politically neutral answers grounded exclusively in official ICC documents. Iteration 1 (MVP) is live with Q&A, paste-text explanation, glossary, multi-turn conversations, and LLM-as-Judge verification.

Iteration 2 expands The Docket with two major capabilities:

1. **Content Fact-Checker** — Users can paste social media posts, news snippets, or any online text about the Duterte ICC case, and the system will verify factual claims against official ICC documents, returning a verdict (Accurate / Misleading / False / Unverifiable) with citations.
2. **Tanglish & Tagalog Language Support** — The app now accepts questions and pasted content in English, Tanglish (Tagalog-English code-switching), or Tagalog, and can respond in the user's preferred language.

### Problem Statement

Filipino social media is saturated with claims about the Duterte ICC case — from Facebook posts to TikTok captions to Messenger forwards. Much of this content is partially true, misleadingly framed, or outright fabricated. The target audience (young Filipino digital natives) encounters these posts daily but has no quick way to verify them against official records. Additionally, most Filipino social media discourse happens in Tanglish or Tagalog, but Iteration 1 only supports English — creating a language barrier that excludes the very people who need this tool most.

### Primary Goal (Iteration 2)

Enable young Filipino digital natives to:

- **Paste any text** from social media (Facebook posts, tweets, TikTok captions, Messenger forwards) into the chat, and receive a fact-check verdict on the claims it contains — verified against official ICC documents
- **Ask questions and fact-check content in Tanglish or Tagalog**, not just English — removing the language barrier for the target audience
- **Choose their preferred response language** (English, Tagalog, or Tanglish) per conversation
- **Copy a formatted fact-check result** to share with friends and family who are spreading misinformation
- Continue using all Iteration 1 features (Q&A, paste-text explanation, glossary, multi-turn conversations) — now with full Tanglish/Tagalog support

### Core Capability

The system auto-detects whether pasted text is an ICC document excerpt (existing paste-text feature) or social media / online content (new fact-checker). For social media content, it extracts factual claims, translates non-English content to English for retrieval, verifies each claim against the ICC knowledge base using hybrid search, and returns an overall verdict with highlighted key claims. For Tanglish/Tagalog input, the system translates to English for RAG retrieval but generates responses in the user's chosen language. All existing guardrails (LLM-as-Judge, citation requirements, political neutrality) apply to both features.

### Out of Scope (Iteration 2)

- Screenshot/image OCR input (text copy-paste only)
- URL scraping (user must paste the text, not a link)
- Fact-checking claims unrelated to the Duterte ICC case
- Expanding the knowledge base beyond ICC official documents
- Shareable permalink URLs for fact-checks (copy-friendly format only, not public links)
- Dashboard with case timeline (Iteration 3)
- Mobile experience (deferred)
- Web search or external API fact-checking

---

## 2. Target Users

### Young Filipino Digital Native (Updated from Iteration 1)

**Profile:** Politically curious, bilingual (English + Tagalog/Tanglish), no legal background. Encounters Duterte ICC claims on social media daily. Aged roughly 18–35. Desktop user.

**New Capabilities (Iteration 2):**

- Paste social media content (Facebook posts, tweets, forwards) into the chat and receive a fact-check verdict with citations
- Ask questions in English, Tanglish, or Tagalog
- Set a preferred response language per conversation (English, Tagalog, or Tanglish)
- Copy a formatted fact-check result to clipboard for sharing via Messenger, Facebook comments, or group chats

**Retained Capabilities (from Iteration 1):**

- Submit questions about the Duterte ICC case
- Paste ICC document text for explanation
- Browse the ICC document library
- Look up ICC legal/Latin terms in the glossary
- View source passages behind citations
- Multi-turn conversations (7-day expiry)
- Delete and bookmark conversations

**Restrictions (Updated):**

- ~~English only~~ — **Removed.** Tanglish and Tagalog now supported
- Fact-checker only verifies claims related to the Duterte ICC case — non-ICC content is declined with an explanation
- Cannot access sealed, confidential, or restricted ICC documents
- Cannot investigate or de-anonymize [REDACTED] content
- Cannot view other users' conversations

---

## 3. User Journeys

### Journey 6: Fact-Check a Social Media Post (NEW)

**Intent:** User encounters a social media post about the Duterte ICC case and wants to know if it's accurate.

**Flow:**

1. User copies text from a social media post (e.g., a Facebook post claiming "Duterte was found guilty by the ICC")
2. User pastes the text into the chat input
3. System auto-detects this is social media content (not an ICC document excerpt) based on language, tone, and structure
4. System extracts factual claims from the pasted content, ignoring emotional/political framing
5. For Tanglish/Tagalog content: system translates extracted claims to English for retrieval
6. System runs hybrid search (BM25 + vector + RRF + FlashRank) against both RAG indexes to find relevant ICC source documents
7. System verifies each key claim against retrieved ICC documents
8. System generates a fact-check response containing:
   - **Overall verdict:** Accurate / Misleading / False / Unverifiable
   - **2-3 highlighted key claims** with individual verdicts and ICC citations
   - **What ICC documents actually say** about the topic (especially for Misleading/Unverifiable claims)
9. LLM-as-Judge verifies the fact-check response
10. Response displayed in the user's chosen language with inline citations
11. User can click "Copy fact-check" to get a formatted version for sharing

**Outcome:** User can verify social media claims against ICC records and share the result with others.

---

### Journey 7: Ask a Question in Tanglish or Tagalog (NEW)

**Intent:** User wants to ask about the Duterte ICC case in their natural language (Tanglish or Tagalog).

**Flow:**

1. User types a question in Tanglish (e.g., "Ano yung charges against Duterte sa ICC?") or Tagalog (e.g., "Ano ang mga kasong kinakaharap ni Duterte?")
2. System detects the input language (English / Tanglish / Tagalog)
3. System translates the query to English for intent classification and RAG retrieval
4. System runs the standard pipeline: intent classification → hybrid search → LLM generation → LLM-as-Judge
5. System generates the response in the user's chosen language (set via per-conversation toggle)
6. Citations remain in their original form (English, linking to ICC documents)
7. Response displayed with the same citation markers, source previews, and verification badge as English responses

**Outcome:** User receives the same quality of factual, cited, politically neutral answer — in their preferred language.

---

### Journey 8: Set Response Language (NEW)

**Intent:** User wants to switch the response language for their conversation.

**Flow:**

1. User sees a language toggle in the chat UI (default: English)
2. User selects their preferred language: English, Tagalog, or Tanglish
3. All subsequent responses in this conversation are generated in the selected language
4. User can change the language at any time during the conversation
5. Previous messages remain in their original language (no retroactive translation)

**Outcome:** User controls the language of responses without affecting input flexibility.

---

### Journey 9: Non-ICC Content Pasted for Fact-Check (NEW)

**Intent:** User pastes content that is not about the Duterte ICC case.

**Flow:**

1. User pastes a social media post about Philippine elections, COVID vaccines, or another unrelated topic
2. System detects the content is not related to the Duterte ICC case
3. System responds: *"This tool only verifies claims about the Duterte ICC case. The content you pasted doesn't appear to be about that. Try pasting a post that makes claims about Duterte, the ICC, or the case proceedings."*
4. No retrieval or LLM generation is performed (cost-free decline)

**Outcome:** User understands the tool's scope and is guided to use it correctly.

---

## 4. Functional Requirements

### Content Fact-Checker (NEW)

- System shall accept user-pasted text and auto-detect whether it is an ICC document excerpt (route to existing paste-text feature) or social media / online content (route to new fact-checker)
- Auto-detection shall analyze language register, structure, and content markers (e.g., formal legal language vs. casual social media tone, presence of legal citations vs. hashtags/mentions)
- System shall extract factual claims from social media content, stripping emotional and political framing (e.g., "Duterte is a murderer who killed 30,000!" → extract claim: "30,000 were killed")
- System shall ignore non-factual content (opinions, emotions, rhetorical questions) and only verify factual assertions
- System shall verify extracted claims against the ICC knowledge base using hybrid search across both RAG indexes
- System shall return a **four-tier verdict** for the overall content:
  - **Accurate** — All key claims are supported by ICC documents
  - **Misleading** — Claims contain partial truths, exaggerations, or missing context that changes the meaning
  - **False** — Key claims directly contradict ICC documents
  - **Unverifiable** — Claims cannot be confirmed or denied using available ICC documents
- System shall highlight the **2-3 most important claims** from the pasted content with individual verdicts and citations
- For claims not found in ICC documents, system shall flag as "Potentially Misleading — not supported by ICC records" and show what ICC documents actually say about the topic
- System shall decline to fact-check content unrelated to the Duterte ICC case with an explanatory message: *"This tool only verifies claims about the Duterte ICC case. The content you pasted doesn't appear to be about that."*
- Fact-check results shall be part of the conversation context — users can ask follow-up questions about previous fact-checks
- System shall provide a "Copy fact-check" button that formats the verdict, key claims, and citations into a clean text format suitable for pasting into Messenger, Facebook, or group chats

### Tanglish & Tagalog Language Support (NEW)

- System shall accept user input in English, Tanglish, or Tagalog for all features (Q&A, fact-checker, paste-text)
- The existing `non_english` intent category shall be **repurposed** to a `language_detection` step that identifies the input language and routes to the translation pipeline (instead of declining)
- A new `fact_check` intent category shall be added for pasted social media content
- System shall use a **hybrid translation approach**:
  - **Input processing:** Translate Tanglish/Tagalog input to English before intent classification, RAG retrieval, and claim verification (because the knowledge base is in English)
  - **Response generation:** Generate the final response in the user's chosen language
- Translation shall use GPT-4o-mini (same model as the rest of the pipeline) — no additional API dependency
- Translation shall be **skipped for clearly English input** to avoid unnecessary cost and latency
- System shall provide a **per-conversation language toggle** in the chat UI with three options: English (default), Tagalog, Tanglish
- The language toggle applies to all response types (Q&A answers, fact-check verdicts, error messages, decline messages)
- Citations shall always remain in their original form (English, linking to ICC documents) regardless of response language
- The language toggle setting persists for the conversation duration but does not carry over to new conversations (default: English)

### Updated Intent Classification (MODIFIED)

The intent taxonomy expands from 7 categories to 8:

| Intent | Description | Routed To | New/Modified |
|--------|-------------|-----------|--------------|
| `case_facts` | Facts about the Duterte case | RAG 2 | Unchanged |
| `case_timeline` | Dates, hearings, procedural events | RAG 2 | Unchanged |
| `legal_concept` | ICC laws, articles, definitions | RAG 1 | Unchanged |
| `procedure` | How the ICC process works | RAG 1 | Unchanged |
| `glossary` | Definition of a legal/Latin term | RAG 1 | Unchanged |
| `paste_text` | Question about user-pasted ICC document text | Both RAG 1 + RAG 2 | Unchanged |
| `fact_check` | Social media / online content pasted for verification | Both RAG 1 + RAG 2 | **NEW** |
| `out_of_scope` | Political opinion, speculation, non-ICC content | Guardrail — decline | Unchanged |

**Removed:** `non_english` — replaced by a language detection preprocessing step that runs before intent classification.

### Updated Guardrails (MODIFIED)

All Iteration 1 guardrails remain in effect. Additional guardrails for Iteration 2:

- Fact-checker shall strip emotional and political framing from pasted content before analysis — the system never comments on the poster's tone, bias, or motivation
- Fact-checker shall never adopt claims from the pasted content as truth — it only reports what ICC documents say
- Fact-checker shall never express agreement or disagreement with the poster's opinion — only verify factual claims
- Tanglish/Tagalog responses shall maintain the same political neutrality as English responses — translation does not introduce bias
- System shall never translate [REDACTED] markers — they remain as-is in all languages
- The "Copy fact-check" output shall include the disclaimer: *"Verified against ICC official documents by The Docket. Not legal advice."*

### Copy-Friendly Fact-Check Format (NEW)

The "Copy fact-check" button shall produce text in this format:

```
📋 FACT-CHECK: [Overall Verdict]

Content checked: "[First 100 chars of pasted text]..."

Key findings:
• [Claim 1] — [Verdict]. ICC documents state: [brief citation]
• [Claim 2] — [Verdict]. ICC documents state: [brief citation]
• [Claim 3] — [Verdict]. ICC documents state: [brief citation]

Sources: ICC official documents (icc-cpi.int)
Verified by The Docket — not legal advice.
```

### Cost Controls (MODIFIED)

- Per-query cost estimate increases from ~$0.0015 to ~$0.003 for multilingual fact-check queries (translation step + larger prompt context for claim extraction)
- English-only queries remain at ~$0.0015 (translation step skipped)
- Monthly cost projection increases from ~$1-6 to ~$2-12 for the same user base
- Global monthly cap of $10 remains — acceptable given the increased per-query cost
- Daily soft limit of 30 queries/day per user remains unchanged

---

## 5. Data & Domain Concepts

### All Iteration 1 concepts remain unchanged. New concepts:

### FactCheckResult (NEW)

A structured fact-check output for a pasted social media text.

**Fields:** `fact_check_id`, `message_id`, `pasted_content` (original text), `detected_language` (en | tl | taglish), `overall_verdict` (accurate | misleading | false | unverifiable), `claims[]`, `copy_text` (pre-formatted shareable text), `created_at`

### Claim (NEW)

An individual factual claim extracted from pasted social media content.

**Fields:** `claim_id`, `fact_check_id`, `extracted_text` (the claim as extracted from the post), `translated_text` (English translation, if applicable), `verdict` (accurate | misleading | false | unverifiable), `icc_says` (what ICC documents actually state), `citation` (Citation object), `confidence` (high | medium | low)

### ConversationSettings (NEW)

Per-conversation user preferences.

**Fields:** `conversation_id`, `response_language` (en | tl | taglish — default: en)

---

## 6. Key Relationships

All Iteration 1 relationships remain. New relationships:

- FactCheckResult belongs to Message (a fact-check is a type of assistant message)
- FactCheckResult has many Claims
- Claim optionally has one Citation (claims marked Unverifiable have no citation)
- ConversationSettings belongs to Conversation (1:1)
- Conversation optionally has ConversationSettings (defaults to English if not set)

---

## 7. Success Criteria

### All Iteration 1 criteria remain. New criteria for Iteration 2:

### Fact-Check Accuracy

- System correctly classifies claims as Accurate / Misleading / False / Unverifiable at ≥ 85% rate when tested against a curated set of known social media claims
- 0 fact-check results that adopt claims from pasted content as ICC-verified facts
- System correctly declines non-ICC content with explanatory message in 100% of test cases

### Tanglish / Tagalog Quality

- System handles Tanglish input (code-switched Filipino-English) without mistranslation or meaning loss in ≥ 80% of test cases
- System handles pure Tagalog input with correct intent classification in ≥ 85% of test cases
- Tagalog/Tanglish responses read naturally to Filipino speakers — no machine-translation artifacts that obscure meaning
- Translation step correctly preserves ICC-specific terms (e.g., "crimes against humanity," "confirmation of charges") without incorrect Tagalog translation

### Content Auto-Detection

- System correctly distinguishes ICC document excerpts from social media content in ≥ 90% of test cases
- False positives (ICC document misclassified as social media) < 5%
- False negatives (social media misclassified as ICC document) < 10%

### Language Detection

- System correctly identifies input language (English / Tanglish / Tagalog) in ≥ 90% of test cases
- English input correctly skips translation step (no unnecessary cost) in ≥ 95% of cases

### User Engagement

- At least 30% of queries are fact-check queries within the first month of launch
- Users who use the fact-checker return to the app at higher rates than Q&A-only users

### Copy-to-Share

- "Copy fact-check" button produces well-formatted, readable text in 100% of cases
- Copied text includes all required elements (verdict, key claims, sources, disclaimer)

---

## 8. Edge Cases & Constraints

All Iteration 1 edge cases remain. New edge cases for Iteration 2:

- **Pasted content is ambiguous (could be ICC document or social media):** System makes its best determination and proceeds. If wrong, the user can rephrase or re-paste with context (e.g., "fact-check this post:" prefix)
- **Pasted content contains a mix of true and false claims:** System returns overall verdict of "Misleading" and highlights individual claims with separate verdicts
- **Pasted content is extremely short (e.g., "Duterte guilty"):** System treats as a claim, checks against ICC docs, returns verdict. If too short to extract meaningful claims, asks user to provide more context
- **Pasted content is extremely long (e.g., full article):** System extracts the top 3-5 most significant factual claims and verifies those. Notes that not all claims were individually verified
- **Pasted content is in a language other than English/Tagalog/Tanglish (e.g., Spanish, Cebuano):** System responds: *"The Docket currently supports English, Tagalog, and Tanglish. Please translate your content to one of these languages."*
- **Tanglish input with heavy slang or abbreviations:** System attempts best-effort translation. If translation confidence is low, system proceeds but notes: *"Some slang or abbreviations may not have been fully interpreted."*
- **User asks a follow-up about a previous fact-check:** Fact-check context is in the conversation history (last 3 turns). System can reference previous verdicts and claims
- **Social media post contains no factual claims (pure opinion/emotion):** System responds: *"This content appears to contain opinions rather than verifiable factual claims about the ICC case. The Docket can only verify factual statements against ICC records."*
- **User explicitly says "fact-check this" with ICC document text:** System respects the user's explicit intent and runs fact-check mode even if the text looks like an ICC document
- **Translation changes meaning of a legal term:** System preserves ICC legal terms in English within the Tagalog/Tanglish response (e.g., "crimes against humanity" is not translated, or is kept alongside a Tagalog explanation)
- **Fact-check of content that mixes ICC claims with non-ICC claims:** System verifies the ICC-related claims and notes which claims are outside its scope: *"This claim is not related to the ICC case and cannot be verified by this tool."*

---

## 9. Supported Query Capabilities (Iteration 2)

### Intent Categories (Updated)

| Intent | Description | Routed To | Example | New? |
|--------|-------------|-----------|---------|------|
| `case_facts` | Facts about the Duterte case | RAG 2 | *"What is Duterte charged with?"* / *"Ano yung charges kay Duterte?"* | Updated (now accepts Tanglish/Tagalog) |
| `case_timeline` | Dates, hearings, procedural events | RAG 2 | *"When was Duterte arrested?"* / *"Kailan inaresto si Duterte?"* | Updated |
| `legal_concept` | ICC laws, articles, definitions | RAG 1 | *"What is Article 7?"* / *"Ano yung Article 7?"* | Updated |
| `procedure` | How the ICC process works | RAG 1 | *"What happens after charges are confirmed?"* | Updated |
| `glossary` | Definition of a legal/Latin term | RAG 1 | *"What does 'in absentia' mean?"* | Updated |
| `paste_text` | Question about user-pasted ICC document text | Both RAG 1 + RAG 2 | *"What does this paragraph mean?"* + pasted ICC text | Unchanged |
| `fact_check` | Social media content pasted for verification | Both RAG 1 + RAG 2 | *"Is this true?"* + pasted Facebook post | **NEW** |
| `out_of_scope` | Political opinion, speculation, non-ICC content | Guardrail — decline | *"Was Duterte right?"* / *"Tama ba si Duterte?"* | Updated |

### Language Preprocessing Step (NEW)

Before intent classification, the system runs a language detection step:

| Detected Language | Action | Cost |
|-------------------|--------|------|
| English | Skip translation, proceed to intent classification | Free |
| Tanglish | Translate to English via GPT-4o-mini, then proceed | ~$0.0005 |
| Tagalog | Translate to English via GPT-4o-mini, then proceed | ~$0.0005 |
| Other | Decline with language support message | Free |

### Paste Content Auto-Detection (NEW)

When pasted text is detected, the system classifies it before routing:

| Content Type | Detection Signals | Route To |
|--------------|-------------------|----------|
| ICC document excerpt | Formal legal language, article/section references, ICC-specific terminology, structured formatting | Existing `paste_text` intent |
| Social media / online content | Casual language, opinions, hashtags, mentions, emotional language, Tanglish/Tagalog | New `fact_check` intent |
| Ambiguous | Cannot confidently classify | Default to `fact_check` (safer — fact-checking ICC text is harmless; explaining social media as ICC text could mislead) |

---

## 10. API Contract

### Fact-Check Query (NEW)

**Endpoint:** `POST /api/chat`

**Request:**

```json
{
  "message": "Is this true?",
  "pasted_text": "Duterte was found guilty by the ICC last week! He's going to prison for life. The Philippines already agreed to hand him over. #DuterteGuilty",
  "conversation_id": "conv_abc123"
}
```

**Response:**

```json
{
  "answer": "This post contains several inaccurate claims...",
  "fact_check": {
    "overall_verdict": "false",
    "pasted_content_preview": "Duterte was found guilty by the ICC last week...",
    "detected_language": "en",
    "claims": [
      {
        "extracted_text": "Duterte was found guilty by the ICC",
        "verdict": "false",
        "icc_says": "As of the most recent ICC records, Duterte has not been found guilty. The case is at the confirmation of charges stage [1].",
        "citation_marker": "[1]"
      },
      {
        "extracted_text": "He's going to prison for life",
        "verdict": "false",
        "icc_says": "No sentencing has occurred. The confirmation of charges hearing has not yet concluded [2].",
        "citation_marker": "[2]"
      },
      {
        "extracted_text": "The Philippines already agreed to hand him over",
        "verdict": "misleading",
        "icc_says": "The Philippines withdrew from the ICC in 2019 but the Court retains jurisdiction over crimes committed during membership. Surrender/cooperation status is addressed in ICC records [3].",
        "citation_marker": "[3]"
      }
    ],
    "copy_text": "📋 FACT-CHECK: FALSE\n\nContent checked: \"Duterte was found guilty by the ICC last week! He's going to prison for life...\"\n\nKey findings:\n• \"Duterte was found guilty\" — FALSE. ICC records show the case is at the confirmation of charges stage.\n• \"Going to prison for life\" — FALSE. No sentencing has occurred.\n• \"Philippines agreed to hand him over\" — MISLEADING. The Philippines withdrew from ICC but the Court retains jurisdiction.\n\nSources: ICC official documents (icc-cpi.int)\nVerified by The Docket — not legal advice."
  },
  "citations": [
    {
      "citation_marker": "[1]",
      "document_title": "Case Information Sheet — Duterte",
      "url": "https://www.icc-cpi.int/...",
      "source_passage": "..."
    }
  ],
  "verified": true,
  "intent_category": "fact_check",
  "rag_index_used": [1, 2],
  "knowledge_base_last_updated": "2026-02-28",
  "response_language": "en"
}
```

---

### Tanglish/Tagalog Query (NEW — uses existing endpoint)

**Endpoint:** `POST /api/chat`

**Request:**

```json
{
  "message": "Ano yung charges kay Duterte sa ICC?",
  "conversation_id": "conv_abc123"
}
```

**Response:**

```json
{
  "answer": "Si Duterte ay kinakaharap ng tatlong bilang ng crimes against humanity sa ilalim ng Article 7 ng Rome Statute [1]...",
  "citations": [
    {
      "citation_marker": "[1]",
      "document_title": "Case Information Sheet — Duterte",
      "url": "https://www.icc-cpi.int/...",
      "source_passage": "Rodrigo Roa Duterte is suspected of crimes against humanity..."
    }
  ],
  "verified": true,
  "intent_category": "case_facts",
  "detected_language": "taglish",
  "translated_query": "What are the charges against Duterte at the ICC?",
  "response_language": "tl",
  "rag_index_used": 2,
  "knowledge_base_last_updated": "2026-02-28"
}
```

---

### Set Conversation Language (NEW)

**Endpoint:** `PATCH /api/conversations/:id`

**Request:**

```json
{
  "response_language": "tl"
}
```

**Response:**

```json
{
  "conversation_id": "conv_abc123",
  "response_language": "tl",
  "updated_at": "2026-03-01T12:00:00Z"
}
```

Valid values for `response_language`: `"en"` (English), `"tl"` (Tagalog), `"taglish"` (Tanglish). Default: `"en"`.

---

### All Iteration 1 API endpoints remain unchanged.

Existing endpoints that now handle multilingual input transparently:
- `POST /api/chat` — now accepts Tanglish/Tagalog questions and pasted content
- `GET /api/conversations/:id/messages` — messages stored in original language
- All other endpoints unchanged
