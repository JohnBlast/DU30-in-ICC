# Cursor Prompt: Phase 3 — False Decline Reduction (Tasks 13.1–13.7)

> **Copy this entire prompt into Cursor when implementing Phase 3.**

---

## Context

You are fixing false declines in The Docket — a RAG Q&A app about the Duterte ICC case. The system currently produces zero hallucinations but rejects too many answerable questions. Live testing showed 4/4 answerable test queries were either flat-declined or judge-rejected.

**Root causes:**
1. Regex patterns in dual-index routing miss inflected word forms ("withdrew" vs "withdrawal")
2. Single similarity threshold (0.58) is too high for natural-language reformulations of formal legal concepts
3. Judge is over-strict — rejects partial answers and evidence category listings
4. No instruction for LLM on how to handle partially answerable queries
5. Layer 2 classifier patterns miss common query formulations (evidence+case, lawyer+duterte)

The full root cause analysis is in `nl-interpretation.md §10`.

## Files to Read First

Read ALL of these before writing any code:

1. `nl-interpretation.md §10` — Phase 3 spec: root cause analysis (§10.2), systemic issues (§10.3), concrete improvements (§10.4), test cases (§10.8)
2. `prompt-spec.md §4` — R-12 updated wording (evidence listing is OK), §6.2 (judge false-REJECT prevention nuances), §8 (intent-adaptive thresholds)
3. `TASKS.md` — Task Group 13 (tasks 13.1–13.7)
4. `lib/prompts.ts` — System prompt and judge prompt (where prompt changes land)
5. `lib/intent-classifier.ts` — Layer 2 regex patterns (where new classifier patterns go)
6. `lib/intent.ts` — `requiresDualIndex()` (where new dual-index patterns go)
7. `lib/retrieve.ts` — Similarity thresholds and retrieval pipeline (where threshold changes go)
8. `lib/chat.ts` — Chat pipeline (where intent is passed to retrieve)

## Implementation Order

Implement in this exact order. Run `npm run build` after each task.

---

### Phase 3a — Prompt-Only Changes (Tasks 13.1, 13.2, 13.3)

#### Task 13.1: Partial Answer Instruction

**File:** `lib/prompts.ts`

In `getStaticSystemPrompt()`, add this section **before** the `RESPONSE FORMAT:` section:

```
PARTIAL ANSWERS:
If you can answer PART of the question from the provided documents but not all of it:
- Answer the part you can, with full citations
- For parts you cannot answer, explicitly state: "This specific detail is not available in current ICC records."
- Never fabricate information to fill gaps
- A partial answer with citations is ALWAYS better than no answer
```

**Why:** Currently the LLM either fabricates the unanswerable part (→ judge REJECT) or gives up entirely (→ flat decline). This gives it a safe third option.

#### Task 13.2: Judge Prompt Recalibration

**File:** `lib/prompts.ts`

In `JUDGE_SYSTEM_PROMPT`, add this block **after** the line `APPROVE when the answer summarizes, paraphrases, or draws from the chunks. When uncertain, output APPROVE.`:

```
IMPORTANT — do NOT reject for these (common false triggers):
- Partial answers that answer what they can and explicitly state "this detail is not available in current ICC records" for the rest — this is correct and desired behavior, not a violation
- Listing categories or types of evidence from chunks (e.g., "The DCC references witness statements and documentary evidence [1]") — this is factual reporting, NOT evaluating evidence strength
- Reasonable paraphrasing that restates chunk content in simpler language, even if the exact words differ from the source
- Date contextualization: stating dates from chunks in a different sentence structure is paraphrasing, not fabrication
- Answering "does X apply?" with "Yes, because [chunk content]" — this is grounded reasoning from chunks, not opinion
```

**Why:** The judge prompt already says "err on APPROVE" but gpt-4o-mini interprets the 12 REJECT criteria aggressively, producing false REJECTs on legitimate answers.

#### Task 13.3: Broader Classifier Patterns

**File:** `lib/intent-classifier.ts`

In `layer2Regex()`, add these patterns **after** the existing `case_facts` patterns block (after line 96) and before `// case_timeline`:

```typescript
  // Evidence + case/documents (broader — don't require "duterte")
  if (/\b(evidence|evidentiary|proof)\b.*\b(icc|case|charges|listed|access|documents?)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\b(icc|case|charges)\b.*\b(evidence|evidentiary|proof)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };

  // Lawyer/counsel/representation + Duterte/ICC/case
  if (/\b(lawyer|lawyers|counsel|defen[cs]e|represent\w*|accredit\w*)\b.*\b(duterte|du30|icc|case|accused)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\b(duterte|du30|accused)\b.*\b(lawyer|lawyers|counsel|defen[cs]e|represent\w*)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };

  // Withdrawal inflected forms + jurisdiction/Rome Statute
  if (/\b(withdr[ae]w\w*|withdrew)\b.*\b(rome|icc|statute|jurisdiction)\b/i.test(q))
    return { intent: "legal_concept", confidence: "high" };
  if (/\b(rome|icc|statute|jurisdiction)\b.*\b(withdr[ae]w\w*|withdrew)\b/i.test(q))
    return { intent: "legal_concept", confidence: "high" };
```

**Why:** The current patterns miss common query formulations. "How many pieces of evidence are listed?" has no `duterte` keyword so evidence pattern doesn't fire. "Since Philippines withdrew" uses past tense so withdrawal pattern doesn't fire.

---

### Phase 3b — Retrieval and Routing Changes (Tasks 13.4, 13.5)

#### Task 13.4: Stem-Aware Dual-Index Patterns

**File:** `lib/intent.ts`

In `requiresDualIndex()`, add these patterns **after** the existing 8 patterns (after line 84, before `return false`):

```typescript
  // NEW Phase 3: Legal effect + case ("does X invalidate/affect/apply")
  if (/\b(invalidate|affect|apply|impact|override|bar|prevent)\b.*\b(case|duterte|charges|icc)\b/i.test(q)) return true;
  if (/\b(case|duterte|charges|icc)\b.*\b(invalidate|affect|apply|impact|override|bar|prevent)\b/i.test(q)) return true;

  // NEW Phase 3: Counsel/representation + case
  if (/\b(lawyer|lawyers|counsel|defen[cs]e|represent\w*|accredit\w*)\b.*\b(duterte|case|icc)\b/i.test(q)) return true;
  if (/\b(duterte|case|icc)\b.*\b(lawyer|lawyers|counsel|defen[cs]e|represent\w*|accredit\w*)\b/i.test(q)) return true;

  // NEW Phase 3: Evidence + legal standard
  if (/\b(evidence|evidentiary|proof)\b.*\b(standard|rule|article|admissib\w*|listed|access)\b/i.test(q)) return true;

  // NEW Phase 3: Withdrawal inflected forms + case (supplements existing "withdrawal" pattern)
  if (/\b(withdr[ae]w\w*|withdrew)\b.*\b(case|duterte|icc|jurisdiction|rome\s+statute|invalidat\w*)\b/i.test(q)) return true;
  if (/\b(case|duterte|icc|jurisdiction|rome\s+statute)\b.*\b(withdr[ae]w\w*|withdrew)\b/i.test(q)) return true;
```

**Why:** The existing patterns only match exact words. "withdrew" doesn't match `withdrawal`. "lawyers" + "ICC" doesn't trigger dual-index. These queries need both RAG 1 (legal framework) and RAG 2 (case documents) to answer properly.

#### Task 13.5: Intent-Adaptive Similarity Thresholds

**File:** `lib/retrieve.ts`, `lib/chat.ts`

**Step 1: Update `RetrieveOptions` to accept intent:**

```typescript
export interface RetrieveOptions {
  ragIndexes: number[];
  query: string;
  pastedText?: string;
  intent?: string; // NEW: used for threshold selection
}
```

**Step 2: Add threshold map in `lib/retrieve.ts`:**

```typescript
const INTENT_THRESHOLDS: Record<string, { primary: number; fallback: number }> = {
  case_facts:    { primary: 0.52, fallback: 0.35 },
  case_timeline: { primary: 0.52, fallback: 0.35 },
  legal_concept: { primary: 0.58, fallback: 0.40 },
  procedure:     { primary: 0.55, fallback: 0.38 },
  glossary:      { primary: 0.60, fallback: 0.42 },
  paste_text:    { primary: 0.58, fallback: 0.35 },
};

function getThresholds(intent?: string): { primary: number; fallback: number } {
  return INTENT_THRESHOLDS[intent ?? ""] ?? { primary: 0.55, fallback: 0.38 };
}
```

**Step 3: Use intent-specific thresholds in `retrieve()`:**

Replace the hardcoded `SIMILARITY_THRESHOLD` usage in `vectorSearch` calls:

```typescript
const { primary: primaryThreshold, fallback: fallbackThreshold } = getThresholds(options.intent);
```

Use `primaryThreshold` in the main `vectorSearch` call (pass to `match_threshold`).
Use `fallbackThreshold` in the fallback `vectorSearch` call (replacing hardcoded `0.35`).

**Step 4: Pass intent from `chat()` to `retrieve()`:**

In `lib/chat.ts`, update the `retrieve()` call (around line 277):

```typescript
const retrieveResult = await retrieve({
  query: effectiveQuery,
  pastedText,
  ragIndexes,
  intent, // pass the classified intent
});
```

**Important:** Keep `SIMILARITY_THRESHOLD` as a constant for backward compatibility but mark it `@deprecated`. New code uses `getThresholds()`.

**Risk guard:** Lower thresholds are compensated by: judge still verifies, citation integrity still validates, RRF co-ranking penalizes outliers.

---

### Phase 3c — Structural Changes (Tasks 13.6, 13.7)

#### Task 13.6: Three-Tier Response Categorization

**File:** `lib/chat.ts`

The absence query detection is already implemented (lines 298-301). Enhance it to produce verified negative responses:

Currently, when chunks ARE found and the query is an absence query, the system prompt includes the absence note. This should already produce "No, this hasn't happened yet" answers. **BUT** the judge may reject these as "speculation."

**Fix:** The judge recalibration in Task 13.2 should handle this. Additionally, when `isAbsenceQuery === true` AND the LLM's answer starts with "No" or "This has not" AND citations are present — the judge extra context should note:

```typescript
if (isAbsenceQuery) {
  judgeExtraContext += "\n\nNote: This is a status/absence query. A 'No, this has not happened yet' answer grounded in chunks establishing the current case stage is correct behavior, not speculation.";
}
```

#### Task 13.7: Phase 3 Test Suite

**File:** `scripts/verify-phase3.ts` (new) or add to `scripts/verify-guardrails.ts`

Add the 8 test cases from `nl-interpretation.md §10.8` (FD-01 through FD-08):

| ID | Input | Assert |
|----|-------|--------|
| FD-01 | "Since the Philippines withdrew from the Rome Statute, does that automatically invalidate the ICC case?" | Dual-index `[1,2]`; answer with citations; NOT flat decline |
| FD-02 | "How many pieces of evidence are listed in the ICC documents, and where can the public access them?" | Partial answer with evidence categories + "public access details not available"; judge APPROVE |
| FD-03 | "Can Duterte's Filipino lawyers represent him before the ICC, or do they need special accreditation?" | Dual-index `[1,2]`; answer about counsel rules with citations |
| FD-04 | "Where is Duterte currently detained, and when was that confirmed in an ICC filing?" | Partial answer: detention info + "filing date not available"; judge APPROVE |
| FD-05 | "Has the trial started yet?" | Verified negative: "No, case is at [stage] [1]" |
| FD-06 | "What types of evidence does the ICC have against Duterte?" | Lists categories with citations; judge APPROVE |
| FD-07 | "Does the ICC's jurisdiction still apply after the Philippines left?" | Dual-index answer about jurisdiction + withdrawal |
| FD-08 | "Who is representing Duterte at the ICC?" | `case_facts` classification; answer from RAG 2 |

**For each test, assert:**
1. Intent classification is correct (check structured log)
2. RAG index routing is correct (single vs dual)
3. Chunks retrieved > 0
4. Judge verdict = APPROVE
5. Answer contains citations
6. Answer is NOT a flat decline

---

## Constraints

- Do NOT change any of the 12 REJECT criteria in the judge prompt — only ADD the nuance clauses
- Do NOT lower thresholds below the values in the spec (case_facts: 0.52 minimum)
- Do NOT remove existing regex patterns — only ADD new ones
- Do NOT change the response contract shape
- Keep the hallucination guard (number checking) active
- Keep citation integrity validation active
- Run `npm run build` after each task
- Run `npm run verify-guardrails` after tasks 13.1, 13.2, 13.3 to ensure no regressions

## Verification

After all Phase 3 tasks, re-run these 4 queries that originally failed:

1. "Since the Philippines withdrew from the Rome Statute, does that automatically invalidate the ICC case?" → **Should produce a cited answer about Article 127 and ICC jurisdiction**
2. "How many pieces of evidence are listed in the ICC documents, and where can the public access them?" → **Should produce a partial answer listing evidence categories**
3. "Can Duterte's Filipino lawyers represent him before the ICC, or do they need special accreditation?" → **Should produce a cited answer about counsel rules**
4. "Where is Duterte currently detained, and when was that confirmed in an ICC filing?" → **Should produce a partial answer with detention info**

**If ANY of these still fails**, check:
- Structured logs for classifier intent and retrieval confidence
- Judge verdict reason (should show APPROVE, not REJECT)
- Whether dual-index was triggered (check rag_indexes in logs)
- Whether similarity threshold was the bottleneck (check vec_count in logs)
