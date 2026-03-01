# Cursor Prompt: Phase 4 — Claim-Level Grounding Verification

## Context

You are working on **The Docket**, a RAG-powered Q&A app about the Duterte ICC case. The system generates answers using retrieved ICC document chunks and cites them with `[N]` markers.

**Problem discovered:** When answering enumeration questions (e.g., "What crimes is Duterte charged with?"), the LLM sometimes lists items beyond what the retrieved chunks contain. Example: the chunk mentions "murder" but the answer adds "torture" and "rape" from the LLM's parametric knowledge. These additions may be factually true but are **not grounded in the retrieved context** — a grounding violation.

**Solution:** A deterministic, post-generation claim verifier that extracts enumerated items from the answer, verifies each one against the cited chunk text, and strips ungrounded items before the answer reaches the judge.

## Specs to reference

- `nl-interpretation.md` §11 — Full Phase 4 design (root cause, verification logic, integration, test cases)
- `prompt-spec.md` §4 R-16, §6.2 (judge criterion), §6.3 (claim verification section)
- `TASKS.md` Task Group 14 (tasks 14.1–14.9)

## What has already been done (DO NOT redo)

- R-16 added to `HARD_RULES` in `lib/prompts.ts` (rule 16: enumerate only items from documents)
- Enumeration REJECT criterion added to `JUDGE_SYSTEM_PROMPT` in `lib/prompts.ts`
- Spec documents updated (nl-interpretation.md §11, prompt-spec.md v1.4.0, TASKS.md Group 14)

## Tasks to implement

### Task 14.1–14.4: Create `lib/claim-verifier.ts`

Create a new file `lib/claim-verifier.ts` with the following:

#### 1. Enumeration detection

Detect sentences containing enumerated lists — the primary vector for over-expansion.

```typescript
// Detection patterns — match sentences containing lists after trigger phrases
const ENUMERATION_TRIGGERS = [
  // "charged with A, B, and C"
  /(?:charged\s+with|accused\s+of|alleged|include[s]?|including|namely|specifically)\s+(.+?)(?:\.\s|\.$|$)/gi,
  // "The charges are: A, B, and C" / "The crimes include A, B, and C"
  /(?:charges|crimes|counts|allegations|acts)\s*(?:are|include|involve)\s*:?\s*(.+?)(?:\.\s|\.$|$)/gi,
];
```

Extract individual items from matched list text:
- Split on `, ` and `, and ` and `; ` and ` and `
- Trim each item, filter empty strings
- Return array of individual claim terms

#### 2. Three-tier claim verification

For each extracted item, verify it exists in the cited chunk:

**Tier 1 — Exact lexical match:**
```typescript
const chunkLower = chunk.content.toLowerCase();
if (chunkLower.includes(claimLower)) return "grounded";
```

**Tier 2 — Stem equivalents map:**
```typescript
const STEM_EQUIVALENTS: Record<string, string[]> = {
  "murder": ["murder", "murders", "murdered", "killing", "killings", "killed"],
  "torture": ["torture", "tortured", "torturing"],
  "imprisonment": ["imprisonment", "imprisoned", "imprison", "detention", "detained", "deprivation of liberty", "deprivation of physical liberty"],
  "rape": ["rape", "raped", "sexual violence", "sexual assault"],
  "persecution": ["persecution", "persecuted", "persecuting"],
  "deportation": ["deportation", "deported", "forcible transfer"],
  "extermination": ["extermination", "exterminated"],
  "enslavement": ["enslavement", "enslaved"],
  "enforced disappearance": ["enforced disappearance", "disappearance", "disappeared"],
  "apartheid": ["apartheid"],
  "other inhumane acts": ["other inhumane acts", "inhumane acts"],
  "crimes against humanity": ["crimes against humanity", "article 7"],
  "war crimes": ["war crimes", "article 8"],
  "genocide": ["genocide", "article 6"],
};

// Check: does any synonym of this claim appear in the chunk?
// Also check reverse: does this claim appear as a synonym of any key?
```

**Tier 3 — Contextual proximity:**
```typescript
// Extract key terms from the claim (reuse extractKeyTerms pattern from chat.ts)
// Check if any 3+ char content word from the claim appears in the chunk
// This catches partial matches like "acts of murder" matching "murder"
```

If no tier matches → mark as UNGROUNDED.

#### 3. Claim stripping

When an item is UNGROUNDED, remove it from the list and fix grammar:

```typescript
// Grammar rules:
// ["A", "B", "C"] minus "C" → "A and B"
// ["A", "B", "C"] minus "B" → "A and C"
// ["A", "B", "C", "D"] minus "C" → "A, B, and D"
// ["A"] (only one left) → "A"
// [] (all removed) → replace sentence with fallback text
```

Fallback text when all items stripped:
`"The specific [charges/crimes/items] are detailed in the ICC documents but could not be individually verified from the retrieved passages."`

#### 4. Multi-citation handling

If a sentence cites multiple chunks (e.g., `[1][2]` or `[1] and [2]`), verify each claim against the **union** of all cited chunks. A claim is grounded if it appears in ANY cited chunk.

#### 5. Return type

```typescript
export interface ClaimVerificationResult {
  cleanedAnswer: string;
  strippedClaims: Array<{
    original: string;
    citedChunk: number;
    reason: "not_in_chunk" | "no_stem_match" | "no_proximity_match";
  }>;
  hadEnumerations: boolean;
  totalClaims: number;
  groundedClaims: number;
}

export function verifyEnumeratedClaims(
  answer: string,
  chunks: RetrievalChunk[]
): ClaimVerificationResult
```

#### 6. Logging

```typescript
import { logEvent } from "./logger";

// After verification:
logEvent("claim.verify", strippedClaims.length > 0 ? "warn" : "info", {
  enumeration_count: /* number of enumerated sentences found */,
  total_claims: totalClaims,
  grounded_claims: groundedClaims,
  stripped_claims: strippedClaims.length,
  stripped_details: strippedClaims,
  answer_modified: strippedClaims.length > 0,
});
```

### Task 14.5: Integrate into chat pipeline

In `lib/chat.ts`, add the verification step between `checkForHallucinatedNumbers()` and `judgeAnswer()`:

```typescript
import { verifyEnumeratedClaims } from "./claim-verifier";

// After line ~332 (after checkForHallucinatedNumbers):
const claimResult = verifyEnumeratedClaims(rawAnswer, chunks);
const verifiedAnswer = claimResult.cleanedAnswer;

// If claims were stripped, add note to judge extra context
if (claimResult.strippedClaims.length > 0) {
  judgeExtraContext += `\n\n⚠ Automated check: ${claimResult.strippedClaims.length} enumerated claim(s) were stripped because they were not found in any retrieved chunk.`;
}

// Pass verifiedAnswer (not rawAnswer) to judgeAnswer:
const judgeResult = await judgeAnswer(verifiedAnswer, chunks, openai, judgeExtraContext, sanitizedHistory);

// Pass verifiedAnswer to parseResponse as well
```

### Task 14.6: Already done

R-16 and judge enumeration criterion already added to `lib/prompts.ts`. No action needed.

### Task 14.7: Update ChatResponse interface

In `lib/chat.ts`, add to the `ChatResponse` interface:

```typescript
export interface ChatResponse {
  answer: string;
  citations: Citation[];
  warning: string | null;
  verified: boolean;
  knowledge_base_last_updated: string;
  retrievalConfidence?: "high" | "medium" | "low";
  claimsVerified?: boolean;    // NEW
  claimsStripped?: number;     // NEW
}
```

Populate these fields in the `parseResponse` return or after claim verification in `chat()`.

## Important constraints

1. **No LLM calls in the verifier.** All verification is deterministic string matching. Zero additional API cost.
2. **Only verify enumerated lists.** Single factual claims continue to be validated by the existing `validateCitationIntegrity()` at sentence level.
3. **Conservative stripping.** If Tier 3 (contextual proximity) matches even one key term, the claim is GROUNDED. Only strip when NO tier matches.
4. **Don't break existing tests.** Phase 3 test cases (FD-01 through FD-08) must still pass. The verifier should NOT strip claims that are legitimately grounded in chunks.
5. **Stem equivalents map is extensible.** Use a `Record<string, string[]>` that can be expanded without code changes.
6. **Grammar correction must handle all list sizes** — from 1 item remaining to 4+ items remaining.

## Files to modify

| File | Action |
|------|--------|
| `lib/claim-verifier.ts` | **CREATE** — new file with all verification logic |
| `lib/chat.ts` | **MODIFY** — import verifier, call in pipeline, update ChatResponse interface, populate new fields |

## Files NOT to modify

- `lib/prompts.ts` — already updated (R-16 + judge criterion)
- `lib/retrieve.ts` — no changes needed
- `lib/intent.ts` — no changes needed
- `lib/intent-classifier.ts` — no changes needed

## Test scenarios (from nl-interpretation.md §11.9)

After implementing, verify these scenarios:

| ID | Input | Expected |
|----|-------|----------|
| CV-01 | Answer: "murder, torture, and imprisonment [1]" / Chunk has "murder" only | Strip "torture" and "imprisonment". Output: "murder [1]" |
| CV-02 | Answer: "Count 1: murder, Count 2: imprisonment [1]" / Chunk has "murder" and "deprivation of liberty" | Keep both (Tier 2: imprisonment ↔ deprivation of liberty). No stripping. |
| CV-03 | Answer: "murder and other inhumane acts [1]" / Chunk has both | Keep both (exact match). No stripping. |
| CV-04 | Answer: "witness statements and documentary evidence [1]" / Chunk has both | Keep both. No stripping. |
| CV-05 | Answer: "murder [1] and torture [2]" / Chunk 1 has "murder", Chunk 2 has "torture" | Keep both (each grounded in its cited chunk). No stripping. |
| CV-07 | Answer: "murder, imprisonment, and torture [1]" / Chunk has "murder" only | Strip "imprisonment" and "torture". Output: "murder [1]". Log shows 2 stripped claims. |
| CV-08 | Answer: fully grounded list | No claims stripped. `answer_modified: false`. |
