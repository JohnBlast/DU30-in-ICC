# Implementation Prompt for Cursor — Iteration 2 Build

You are implementing Iteration 2 of The Docket — a RAG-powered Q&A app about the Duterte ICC case. The spec documents (`nl-interpretation.md`, `prompt-spec.md`, `constitution.md`, `PRD-v2.md`) have already been updated. Your job is to implement the code changes.

**Read these spec files first** — they are the source of truth:
- `PRD-v2.md` — requirements
- `nl-interpretation.md` — updated pipeline (6-step architecture, new intents, test scenarios)
- `prompt-spec.md` — updated prompts, judge criteria, golden examples
- `TASKS.md` — implementation task groups 13-16

**Read every code file fully before editing it.** The existing code is well-structured — extend it, don't rewrite it.

---

## WHAT YOU'RE BUILDING

1. **Content Fact-Checker** — Users paste social media posts, system extracts claims, verifies against ICC docs, returns verdict (Accurate/Misleading/False/Unverifiable) with citations and a "Copy fact-check" button.
2. **Tanglish & Tagalog Language Support** — Accept input in English/Tanglish/Tagalog. Translate to English for retrieval. Respond in user's chosen language (per-conversation toggle).

---

## CURRENT CODEBASE (what exists today)

The pipeline currently flows:
```
API route (app/api/chat/route.ts)
  → validateChatInput (lib/validate-chat-input.ts)
  → classifyIntent (lib/intent-classifier.ts) — 4-layer: gates → regex → LLM → cross-validation
  → intentToRagIndexes (lib/intent.ts) — routes to RAG 1, 2, or both
  → retrieve (lib/retrieve.ts) — vector + BM25 → RRF → rerank → top 4 chunks
  → buildSystemPrompt + LLM generation (lib/prompts.ts + lib/chat.ts)
  → verifyEnumeratedClaims (lib/claim-verifier.ts) — Phase 4
  → judgeAnswer (lib/chat.ts) — LLM-as-Judge
  → parseResponse → return ChatResponse
```

Key types:
```typescript
// lib/intent.ts
type IntentCategory = "case_facts" | "case_timeline" | "legal_concept" | "procedure" | "glossary" | "paste_text" | "non_english" | "out_of_scope"

// lib/chat.ts
interface ChatOptions { query: string, pastedText?: string, conversationId?: string, conversationHistory?: Array<{role, content}> }
interface ChatResponse { answer, citations, warning, verified, knowledge_base_last_updated, retrievalConfidence?, claimsVerified?, claimsStripped? }
```

---

## IMPLEMENTATION PLAN (execute in this order)

### STEP 1: Create `lib/language-detect.ts`

New file. Implements Step 0 of the updated pipeline.

```typescript
// Exports:
type DetectedLanguage = "en" | "tl" | "taglish" | "other"
interface LanguageDetectionResult { language: DetectedLanguage, tagalogWordCount: number, englishContentRatio: number }
function detectLanguage(text: string): LanguageDetectionResult
```

Implementation:
- Expanded Tagalog word list (30 words from nl-interpretation.md §2.3.1): `ang, yung, kay, ba, siya, niya, pero, kasi, sino, ano, paano, bakit, talaga, naman, daw, raw, mo, ko, sa, ng, mga, na, po, rin, din, lang, pala, ito, yan, yon`
- Use word-boundary regex to count matches (case-insensitive). Be careful with `na`, `sa`, `ng` — these are short and could false-match. Use `\b` boundaries.
- 0-1 matches → `"en"`
- 2+ matches → sub-classify: count English content words (exclude Tagalog function words, proper nouns like "Duterte"/"ICC"/"Rome Statute", and common words). If English content words < 20% of total → `"tl"`, else → `"taglish"`
- For "other" language detection: maintain a small Cebuano word list (`unsa, kini, mao, dili, wala, kanang, bitaw, ug, nga, kay`) — if 2+ Cebuano words AND 0 Tagalog words → `"other"`
- Robustness: if uncertain, return `"en"` (never reject for language uncertainty)

### STEP 2: Create `lib/translate.ts`

New file. Implements Step 1 of the updated pipeline.

```typescript
// Exports:
interface TranslationResult { translatedText: string, originalText: string, success: boolean }
function translateToEnglish(text: string): Promise<TranslationResult>
```

Implementation:
- Call GPT-4o-mini with the translation prompt from prompt-spec.md §4c
- Use `getOpenAIClient()` from `lib/openai-client.ts` (existing)
- model: "gpt-4o-mini", max_tokens: 1024, temperature: 0
- On success: return `{ translatedText: response, originalText: text, success: true }`
- On failure (any error): return `{ translatedText: text, originalText: text, success: false }` — fall back to original text
- Log translation events via `logEvent()` from `lib/logger.ts`

### STEP 3: Create `lib/paste-detect.ts`

New file. Implements Step 2 of the updated pipeline.

```typescript
// Exports:
type PasteType = "icc_document" | "social_media"
interface PasteDetectionResult { pasteType: PasteType, confidence: "high" | "low", method: "deterministic" | "llm" }
function detectPasteType(pastedText: string, userQuery: string): Promise<PasteDetectionResult>
```

Implementation:
- **Deterministic signals first** (from nl-interpretation.md §2.3.3):
  - ICC signals (→ `icc_document`, high confidence): regex for `Article \d+`, `Rule \d+`, `paragraph \d+`, `\[REDACTED\]`, phrases like "The Chamber finds", "The Prosecution submits", "pursuant to"
  - Social signals (→ `social_media`, high confidence): regex for `#\w+`, `@\w+`, emoji unicode ranges, "RT", "SHARE", "LIKE", casual opinion patterns
  - Explicit user intent (→ `social_media`, high confidence): check if userQuery matches `/fact[- ]?check|is this (true|accurate|correct)|totoo ba|tama ba/i`
- **LLM fallback** if no high-confidence match:
  - Call GPT-4o-mini with the classification prompt from nl-interpretation.md §2.3.3
  - Use first 500 chars of pasted text
  - Parse response for "icc_document" or "social_media"
  - Return with confidence: "low", method: "llm"
- **Default on ambiguity**: `social_media` (safer per spec)

### STEP 4: Create `lib/fact-check.ts`

New file. Core fact-checking logic.

```typescript
// Exports:
interface ExtractedClaim { extractedText: string, translatedText?: string }
interface VerifiedClaim { extractedText: string, translatedText?: string, verdict: "accurate" | "misleading" | "false" | "unverifiable", iccSays: string, citationMarker: string, confidence: "high" | "medium" | "low" }
interface FactCheckResult { overallVerdict: "accurate" | "misleading" | "false" | "unverifiable", pastedContentPreview: string, detectedLanguage: DetectedLanguage, claims: VerifiedClaim[], copyText: string }

function extractClaims(pastedText: string): Promise<ExtractedClaim[]>
function generateFactCheckResponse(claims: ExtractedClaim[], chunks: RetrievalChunk[], responseLanguage: string): Promise<{ answer: string, factCheck: FactCheckResult }>
function formatCopyText(factCheck: FactCheckResult): string
```

Implementation:
- `extractClaims()`: Call GPT-4o-mini with the claim extraction instructions from prompt-spec.md §4b. Prompt should extract 2-3 key factual claims, strip emotional framing, restate as neutral assertions. Return array of claims.
- `generateFactCheckResponse()`: Build a system prompt using the fact-check rules from prompt-spec.md §4b + retrieved chunks. Call GPT-4o-mini. Parse the structured response (overall verdict + per-claim verdicts + citations).
- `formatCopyText()`: Build the copy-text format from prompt-spec.md copy-text section. Template:
```
📋 FACT-CHECK: [VERDICT]

Content checked: "[First 100 chars]..."

Key findings:
• "[Claim]" — [VERDICT]. ICC documents state: [summary]
...

Sources: ICC official documents (icc-cpi.int)
Verified by The Docket — not legal advice.
```
- Overall verdict logic: all ACCURATE → ACCURATE; any FALSE → FALSE; else MISLEADING; all UNVERIFIABLE → UNVERIFIABLE.

### STEP 5: Update `lib/intent.ts`

Modify existing file.

1. **Update IntentCategory type** — remove `"non_english"`, add `"fact_check"`:
```typescript
type IntentCategory = "case_facts" | "case_timeline" | "legal_concept" | "procedure" | "glossary" | "paste_text" | "fact_check" | "out_of_scope"
```

2. **Update `intentToRagIndexes()`** — add `fact_check` routing:
```typescript
case "fact_check": return [1, 2]  // always search both indexes
```
Remove the `"non_english"` case (which returned `[]`).

3. **Update `intentToSingleIndex()`** — add fact_check → [1, 2]

### STEP 6: Update `lib/intent-classifier.ts`

Modify existing file. This is the most critical change.

1. **Update VALID_INTENTS**: Remove `"non_english"`, add `"fact_check"`

2. **Update INTENT_PROMPT**: Remove the `non_english` line. Add: `- fact_check: User pasted social media content for claim verification (not ICC document text)`

3. **Remove Tagalog → non_english from Layer 2 (now Step 4)**:
   - The TAGALOG_WORDS regex and the 2+ match check that returns `non_english` — REMOVE this block entirely from `layer2Regex()`. The Tagalog word list is now used in `lib/language-detect.ts` instead.

4. **Update `classifyIntent()` function signature** to accept new preprocessing results:
```typescript
function classifyIntent(query: string, hasPastedText: boolean, pasteType?: PasteType): Promise<ClassificationResult>
```
   - If `pasteType === "social_media"` → return `{ intent: "fact_check", isRedaction: false }` immediately (Step 2 already decided)
   - If `pasteType === "icc_document"` → return `{ intent: "paste_text", isRedaction: false }` immediately
   - Otherwise proceed with existing Layer 1-4 logic (now Steps 3-6)

### STEP 7: Update `lib/prompts.ts`

Modify existing file.

1. **Add R-17 through R-21 to HARD_RULES constant** (from prompt-spec.md):
   - R-17: Strip emotional framing in fact-checks
   - R-18: Never adopt social media claims as ICC-verified
   - R-19: Identical neutrality in Tagalog/Tanglish, never translate [REDACTED]
   - R-20: Preserve ICC terms in English within Filipino responses
   - R-21: Copy-text must include disclaimer

2. **Update `getStaticSystemPrompt()`** — update the Role section to include "Verify social media claims" and "respond in English, Tagalog, or Tanglish"

3. **Add new prompt constants**:
   - `FACT_CHECK_SYSTEM_PROMPT`: The static block from prompt-spec.md §4b (claim extraction + verdict criteria + format + guardrails)
   - `TRANSLATION_PROMPT`: From prompt-spec.md §4c
   - `RESPONSE_LANGUAGE_RULES`: From prompt-spec.md §7b

4. **Update `buildSystemPrompt()`** — add new parameters and sections:
```typescript
interface BuildPromptOptions {
  // existing:
  queryType: IntentCategory, chunks, pastedText?, conversationHistory?, query, isAbsenceQuery?
  // new:
  responseLanguage?: "en" | "tl" | "taglish"
  isFactCheck?: boolean
  extractedClaims?: ExtractedClaim[]
  originalQuery?: string  // pre-translation query
}
```
   - If `isFactCheck`: inject FACT_CHECK_SYSTEM_PROMPT after paste-text rules
   - If `extractedClaims`: inject them as context ("EXTRACTED CLAIMS TO VERIFY: ...")
   - Always inject RESPONSE_LANGUAGE_RULES with the `responseLanguage` value
   - If `originalQuery` differs from `query`: inject "ORIGINAL USER QUERY (before translation): {originalQuery}"

5. **Update JUDGE_SYSTEM_PROMPT** — add fact-check REJECT/APPROVE criteria from prompt-spec.md judge section

### STEP 8: Update `lib/chat.ts`

Modify existing file. This is where the pipeline is orchestrated.

1. **Update ChatOptions interface**:
```typescript
interface ChatOptions {
  query: string
  pastedText?: string
  conversationId?: string
  conversationHistory?: Array<{role: string, content: string}>
  responseLanguage?: "en" | "tl" | "taglish"  // NEW
}
```

2. **Update ChatResponse interface**:
```typescript
interface ChatResponse {
  // existing fields...
  factCheck?: FactCheckResult     // NEW
  detectedLanguage?: string       // NEW
  translatedQuery?: string        // NEW
  responseLanguage?: string       // NEW
}
```

3. **Insert preprocessing steps at the beginning of `chat()`** (before existing intent classification):

```typescript
// Step 0: Language Detection
const langResult = detectLanguage(query)
let effectiveQuery = query
let originalQuery: string | undefined

// Step 1: Translation (if Filipino detected)
if (langResult.language === "tl" || langResult.language === "taglish") {
  const translation = await translateToEnglish(query)
  if (translation.success) {
    effectiveQuery = translation.translatedText
    originalQuery = query
  }
  // Also translate pastedText if present and in Filipino
  if (pastedText) {
    const pastedLang = detectLanguage(pastedText)
    if (pastedLang.language === "tl" || pastedLang.language === "taglish") {
      const pastedTranslation = await translateToEnglish(pastedText)
      if (pastedTranslation.success) {
        pastedText = pastedTranslation.translatedText
      }
    }
  }
}

// Step 2: Paste Auto-Detection (if pasted text exists)
let pasteType: PasteType | undefined
if (pastedText) {
  const pasteResult = await detectPasteType(pastedText, effectiveQuery)
  pasteType = pasteResult.pasteType
}

// "other" language decline
if (langResult.language === "other") {
  return {
    answer: "The Docket currently supports English, Tagalog, and Tanglish. Please rephrase your question in one of these languages.",
    citations: [], warning: null, verified: false,
    knowledge_base_last_updated: await getKnowledgeBaseLastUpdated(),
    responseLanguage: "en"
  }
}
```

4. **Update intent classification call**: Pass `pasteType` to `classifyIntent(effectiveQuery, !!pastedText, pasteType)`

5. **Remove the `non_english` handler block** (the block that returns "The Docket currently supports English only..." around lines 260-270). This is replaced by the "other" language decline above.

6. **Add fact-check flow** after retrieval but before standard LLM generation:
```typescript
if (intent === "fact_check") {
  // Extract claims from pasted text
  const claims = await extractClaims(pastedText!)

  if (claims.length === 0) {
    return {
      answer: "This content appears to contain opinions rather than verifiable factual claims about the ICC case. The Docket can only verify factual statements against ICC records.",
      citations: [], warning: null, verified: true,
      knowledge_base_last_updated: await getKnowledgeBaseLastUpdated(),
      responseLanguage: opts.responseLanguage || "en"
    }
  }

  // Build fact-check prompt with chunks and claims
  const systemPrompt = buildSystemPrompt({
    queryType: "fact_check", chunks, pastedText, conversationHistory,
    query: effectiveQuery, isFactCheck: true, extractedClaims: claims,
    responseLanguage: opts.responseLanguage || "en", originalQuery
  })

  // Generate fact-check response
  const { answer, factCheck } = await generateFactCheckResponse(claims, chunks, opts.responseLanguage || "en")

  // Judge the fact-check response
  const judgeResult = await judgeAnswer(answer, chunks, conversationHistory)
  if (judgeResult.verdict === "REJECT") {
    return { answer: FALLBACK_BLOCKED, citations: [], warning: null, verified: false, ... }
  }

  // Parse citations from the answer
  const citations = extractCitations(answer, chunks)
  const copyText = formatCopyText(factCheck)

  return {
    answer, citations, warning: null, verified: true,
    knowledge_base_last_updated: await getKnowledgeBaseLastUpdated(),
    factCheck: { ...factCheck, copyText },
    detectedLanguage: langResult.language,
    translatedQuery: originalQuery ? effectiveQuery : undefined,
    responseLanguage: opts.responseLanguage || "en"
  }
}
```

7. **Update standard Q&A flow** — pass `responseLanguage` and `originalQuery` to `buildSystemPrompt()`:
```typescript
const systemPrompt = buildSystemPrompt({
  queryType: intent, chunks, pastedText, conversationHistory,
  query: effectiveQuery, isAbsenceQuery,
  responseLanguage: opts.responseLanguage || "en",
  originalQuery
})
```

8. **Add new fields to the return** in `parseResponse()`: `detectedLanguage`, `translatedQuery`, `responseLanguage`

### STEP 9: Update `app/api/chat/route.ts`

Modify existing file.

1. **Accept `responseLanguage` from the conversation** — after loading the conversation, fetch the `response_language` column:
```typescript
const responseLanguage = conversation?.response_language || "en"
```

2. **Pass `responseLanguage` to `chat()`**:
```typescript
const result = await chat({ query: sanitized, pastedText, conversationHistory, responseLanguage })
```

3. **Include new fields in the API response**: `factCheck`, `detectedLanguage`, `translatedQuery`, `responseLanguage`

4. **Store fact-check data in message citations**: When intent is `fact_check`, store the `factCheck` object in the assistant message's `citations` JSONB field (or add a separate field if you prefer).

### STEP 10: Database Migration

Create `supabase/migrations/003_add_response_language.sql`:

```sql
-- Add response_language column to conversations table
ALTER TABLE conversations ADD COLUMN response_language VARCHAR(10) DEFAULT 'en';

-- Add CHECK constraint for valid values
ALTER TABLE conversations ADD CONSTRAINT valid_response_language
  CHECK (response_language IN ('en', 'tl', 'taglish'));
```

### STEP 11: Update `PATCH /api/conversations/:id`

In `app/api/conversations/[id]/route.ts`, update the PATCH handler to accept and persist `response_language`:

```typescript
// In the PATCH handler, after existing is_bookmarked/title handling:
if (body.response_language !== undefined) {
  const validLanguages = ["en", "tl", "taglish"]
  if (!validLanguages.includes(body.response_language)) {
    return NextResponse.json({ error: "Invalid response_language" }, { status: 400 })
  }
  updateFields.response_language = body.response_language
}
```

### STEP 12: Update `components/ChatInput.tsx`

Modify existing file.

1. **No changes needed for the paste input** — it already has a toggle for pasted text. The auto-detection (ICC doc vs social media) happens server-side.

### STEP 13: Update `components/ChatMessage.tsx`

Modify existing file.

1. **Add fact-check verdict rendering** — when the message has a `factCheck` object:
   - Render an overall verdict badge at the top (color-coded: green=ACCURATE, yellow=MISLEADING, red=FALSE, gray=UNVERIFIABLE)
   - Render each claim as a card with its individual verdict and ICC citation
   - Add a "Copy fact-check" button that copies `factCheck.copyText` to clipboard

2. **Keep existing citation rendering** — fact-check messages still have inline [N] citations that work the same way

### STEP 14: Add Language Toggle to `app/page.tsx`

Modify existing file.

1. **Add state**: `responseLanguage: "en" | "tl" | "taglish"` (default: "en")

2. **Add a language toggle UI** in the chat header area (near the conversation title or above the input):
   - Three options: English / Tagalog / Tanglish
   - Simple dropdown or segmented control
   - On change: call `PATCH /api/conversations/:id` with new `response_language`, update local state

3. **Pass `responseLanguage` in handleSend**: Include it in the POST /api/chat body so the API route can read it (or fetch it from the conversation record server-side — the server-side approach is already handled in Step 9).

4. **Load language preference** when loading a conversation: read `response_language` from the conversation data and set state.

### STEP 15: Update `lib/retrieve.ts`

Modify existing file.

1. **Add `fact_check` to the thresholds map**:
```typescript
fact_check: { primary: 0.52, fallback: 0.35 }  // same as case_facts since fact-checking case claims
```

---

## FILES CREATED (new)
- `lib/language-detect.ts` — Step 0: Language detection
- `lib/translate.ts` — Step 1: Translation
- `lib/paste-detect.ts` — Step 2: Paste auto-detection
- `lib/fact-check.ts` — Fact-check claim extraction, verdict generation, copy-text
- `supabase/migrations/003_add_response_language.sql` — DB migration

## FILES MODIFIED (existing)
- `lib/intent.ts` — Remove non_english, add fact_check to type + routing
- `lib/intent-classifier.ts` — Remove non_english from VALID_INTENTS + regex, add fact_check, accept pasteType param
- `lib/prompts.ts` — Add R-17-21, fact-check prompt, translation prompt, response language rules, update judge
- `lib/chat.ts` — Insert preprocessing Steps 0-2, add fact-check flow, pass responseLanguage
- `lib/retrieve.ts` — Add fact_check thresholds
- `app/api/chat/route.ts` — Accept responseLanguage, return new fields
- `app/api/conversations/[id]/route.ts` — Accept response_language in PATCH
- `components/ChatMessage.tsx` — Render fact-check verdicts + copy button
- `app/page.tsx` — Add language toggle, pass responseLanguage

## FILES UNCHANGED
- `lib/validate-chat-input.ts` — No changes needed
- `lib/claim-verifier.ts` — No changes needed (Phase 4 still applies to standard Q&A)
- `lib/openai-client.ts` — No changes needed
- `lib/retrieve.ts` — Only adding threshold, no structural changes
- `components/ConversationSidebar.tsx` — No changes needed
- `components/ChatInput.tsx` — No changes needed (paste toggle already exists)

---

## VERIFICATION

After implementing, test these scenarios:

**Fact-Check Tests:**
1. Paste "Duterte was found guilty by the ICC! #DuterteGuilty" + ask "Is this true?" → should return FALSE verdict
2. Paste "The ICC is investigating Duterte for crimes against humanity" → should return ACCURATE
3. Paste "Marcos is the best president! #BBM" → should decline (not ICC-related)
4. Click "Copy fact-check" → clipboard should have formatted text with disclaimer

**Language Tests:**
5. Ask "Ano yung charges kay Duterte?" → should detect Tagalog, translate, answer correctly
6. Ask "What are the charges?" with language toggle set to Tagalog → response should be in Tagalog
7. Ask "Guilty ba siya?" → should translate, then decline as out_of_scope (opinion), NOT as language issue

**Regression Tests:**
8. Ask "What is Duterte charged with?" in English → should work exactly as before
9. Paste ICC document text → should route to paste_text (not fact_check)
10. Ask about [REDACTED] → should still decline properly

**Run:** `npm run verify-e2e` and `npm run verify-guardrails` to check for regressions.
