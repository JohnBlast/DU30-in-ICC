# Cursor Prompt — False Decline Test Fixes

> **Context**: After deploying the false-decline reduction plan (`prompts/cursor-false-decline-reduction.md`), test results revealed two critical code bugs. This prompt addresses those bugs. Read `prompts/system-review-for-llm.md` for architecture.
>
> **Scope**: Two targeted fixes + test adjustments. No architectural changes.

---

## Fix 1 (CRITICAL): `retrievalConfidence` always "low" for single-chunk results

### Problem

`lib/retrieve.ts` lines 374–385 assign `retrievalConfidence`. Line 379–380:

```typescript
} else if (topChunks.length <= 1) {
  retrievalConfidence = "low";
```

This fires for ALL 1-chunk results, including those found by the primary search (not fallback). It runs AFTER the fallback checks (lines 375–378), so even when primary vector+FTS search returns exactly 1 chunk, confidence is "low."

Combined with `evidenceSufficiency()` (line 71–77):

```typescript
if (chunks.length === 1 && retrievalConfidence === "low") return "insufficient";
```

Every single-chunk result is gated out, regardless of how it was found. The P0-2 fix intended to allow 1-chunk results at medium/high confidence, but the confidence assignment itself makes that impossible.

**This is the root cause of FD-03 ("What evidence is there?"), FD-09 ("Can the case be dismissed?"), and FD-10 ("What happens after this?") failures.**

### Fix

In `lib/retrieve.ts`, change the `retrievalConfidence` assignment logic so that 1-chunk results from the primary search get "medium" (not "low"). Only 1-chunk results from fallback searches should be "low."

**Current code** (lines 374–385):
```typescript
let retrievalConfidence: "high" | "medium" | "low";
if (usedFallback && !usedDualIndexFallback) {
  retrievalConfidence = "low";
} else if (usedDualIndexFallback) {
  retrievalConfidence = "medium";
} else if (topChunks.length <= 1) {
  retrievalConfidence = "low";
} else if (bothMethods && topChunks.length >= 2) {
  retrievalConfidence = "high";
} else {
  retrievalConfidence = "medium";
}
```

**Replace with**:
```typescript
let retrievalConfidence: "high" | "medium" | "low";
if (usedFallback && !usedDualIndexFallback) {
  retrievalConfidence = "low";
} else if (usedDualIndexFallback) {
  retrievalConfidence = topChunks.length >= 2 ? "medium" : "low";
} else if (topChunks.length === 0) {
  retrievalConfidence = "low";
} else if (topChunks.length === 1) {
  retrievalConfidence = bothMethods ? "medium" : "low";
} else if (bothMethods && topChunks.length >= 2) {
  retrievalConfidence = "high";
} else {
  retrievalConfidence = "medium";
}
```

**Logic**:
- Fallback (last-resort low-threshold) → always "low" (risky chunks)
- Dual-index fallback → "medium" if 2+ chunks, "low" if only 1
- Primary search, 0 chunks → "low"
- Primary search, 1 chunk → "medium" if BOTH vector and FTS found results (converging evidence), "low" if only one method found it
- Primary search, 2+ chunks, both methods → "high"
- Primary search, 2+ chunks, one method → "medium"

This means `evidenceSufficiency()` will:
- Pass 1-chunk results where both vector and FTS agree (converging evidence → medium confidence)
- Block 1-chunk results where only one search method found it (no convergence → low confidence → insufficient)
- Continue to block all last-resort fallback single chunks

### Verification

After this fix, re-run `npm run verify-false-decline`. Expected changes:
- FD-03 ("What evidence is there?"): If primary search returns 1 chunk with both vec+FTS converging → medium confidence → passes gate → LLM attempts answer
- FD-09, FD-10: Same logic — if the primary search finds a chunk via both methods, it proceeds

If these still fail after the fix, the issue is KB content (chunks don't contain the needed info), not the gate. That's acceptable.

---

## Fix 2 (CRITICAL — Safety): Contamination guard doesn't handle comma-formatted numbers

### Problem

`lib/contamination-guard.ts` `USER_FACT_PATTERNS` uses `\d{3,}` to match large numbers. This does NOT match comma-formatted numbers like "30,000":

- `\d{3,}` matches 3+ consecutive digits. In "30,000", the comma splits "30" (2 digits) from "000" (3 digits). The regex matches "000" but not "30,000" as a whole.
- Pattern 1: `/\b\d{3,}\s*(killed|died|...)/gi` — the `\s*` between number and keyword cannot skip intervening words. "30,000 were killed" has "were" between the number and "killed", so the pattern fails even if the number matched.

**This is a pre-existing safety bug.** User-stated "30,000 were killed" is NOT sanitized from conversation history, allowing the LLM to echo the user's unverified number.

### Fix

In `lib/contamination-guard.ts`, create a shared number pattern that handles comma-formatted numbers and intervening words.

**Replace the first two patterns** in `USER_FACT_PATTERNS`:

```typescript
const USER_FACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    // Numbers with optional commas (30,000 or 30000) followed by keywords within a few words
    pattern: /\b\d{1,3}(?:,\d{3})+\s+(?:\w+\s+){0,3}(killed|died|victims|people|casualties|dead|deaths?)\b/gi,
    replacement: "[User-stated number — omitted from context]",
  },
  {
    // Same but without commas (plain digits, 3+ chars)
    pattern: /\b\d{3,}\s+(?:\w+\s+){0,3}(killed|died|victims|people|casualties|dead|deaths?)\b/gi,
    replacement: "[User-stated number — omitted from context]",
  },
  {
    // Prefixed numbers with commas: "approximately 30,000" before domain keywords
    pattern:
      /\b(approximately|around|about|at least|over|more than)?\s*\d{1,3}(?:,\d{3})+\b(?=\s+(?:\w+\s+){0,3}(drug|kill|victim|people|death|case|warrant|count|charge))/gi,
    replacement: "[User-stated number — omitted from context]",
  },
  {
    // Prefixed numbers without commas before domain keywords
    pattern:
      /\b(approximately|around|about|at least|over|more than)?\s*\d{3,}\b(?=\s+(?:\w+\s+){0,3}(drug|kill|victim|people|death|case|warrant|count|charge))/gi,
    replacement: "[User-stated number — omitted from context]",
  },
  // ... keep remaining patterns 3-6 unchanged (premise, source attribution, causal, guilt, existence)
```

Key changes:
- `\d{1,3}(?:,\d{3})+` matches comma-formatted numbers: "30,000", "1,000,000", etc.
- `\s+(?:\w+\s+){0,3}` allows 0–3 intervening words between number and keyword: "30,000 were killed", "30,000 people were killed"
- Original `\d{3,}` patterns kept as separate entries for non-comma numbers

**Also update pattern 7** (the "there were/are/have been" pattern):

```typescript
  {
    // "there were 30,000 ..."
    pattern: /\b(there were|there are|there have been)\s+\d{1,3}(?:,\d{3})+\s+\w+/gi,
    replacement: "[User-stated claim — omitted from context]",
  },
  {
    pattern: /\b(there were|there are|there have been)\s+\d{3,}\s+\w+/gi,
    replacement: "[User-stated claim — omitted from context]",
  },
```

### Verification

Create a unit-level test (or add to an existing test file) that validates sanitization:

```typescript
import { sanitizeUserMessageForContext } from "../lib/contamination-guard";

// Must sanitize comma-formatted numbers
console.assert(
  !sanitizeUserMessageForContext("30,000 were killed in the drug war").includes("30,000"),
  "Should strip '30,000 were killed'"
);
console.assert(
  !sanitizeUserMessageForContext("at least 30,000 people died").includes("30,000"),
  "Should strip 'at least 30,000 people died'"
);
console.assert(
  !sanitizeUserMessageForContext("there were 30,000 victims").includes("30,000"),
  "Should strip 'there were 30,000 victims'"
);
// Must NOT strip non-number content
console.assert(
  sanitizeUserMessageForContext("What evidence supports that?") === "What evidence supports that?",
  "Should not modify plain questions"
);
```

Then re-run `npm run verify-adversarial-safeguards` — S-3 should now pass.

---

## Test Adjustments (non-code)

### FD-06: Change expectation to FAIL (expected)

Per project owner: FD-06 ("Who is the judge?") should be expected to fail because there are three pre-trial judges and this info may not be clearly represented in the KB.

In `scripts/verify-false-decline.ts`, change FD-06 to a "known limitation" that doesn't count as a failure:

```typescript
{
  id: "FD-06",
  query: "Who is the judge?",
  description: "Known limitation: 3 pre-trial judges, KB may not have clear judge info",
  expect: (a) => true, // Skip — known KB gap
},
```

Or better: remove FD-06 from the test suite and add a comment explaining why.

### FD-02, FD-04: Relax expectations

FD-02 ("What are the charges?") and FD-04 ("Is there a trial yet?") fail on phrasing expectations, not on whether they get an answer. After Fix 1 improves retrieval pass-through, these may start passing. If they still fail:

- **FD-02**: The answer may say "charges" without the expected `\d+ count` format. Relax the `expect` to accept any cited answer mentioning charges/DCC/crimes against humanity:
  ```typescript
  expect: (a) => /\[\d+\]/.test(a) && /\b(charge|count|indictment|crimes?\s+against\s+humanity|murder)\b/i.test(a),
  ```

- **FD-04**: The answer may say "no trial has taken place" without using "confirmation of charges". Relax:
  ```typescript
  expect: (a) => /\[\d+\]/.test(a) && /\b(no\s+trial|pre-?trial|confirmation|not\s+yet|has\s+not)\b/i.test(a),
  ```

### FD-09, FD-10, FD-13: May improve after Fix 1

These fail because 1-chunk low-confidence results are gated. After Fix 1, if the primary search found these chunks via both vector and FTS, they'll pass the gate. If they still fail, the issue is:
- FD-09: "Can the case be dismissed?" routes to `procedure` → RAG 1 only. Admissibility content may need dual-index. Verify `requiresDualIndex()` triggers for this query.
- FD-10: "What happens after this?" — very vague query, may need more specific phrasing examples in the test.
- FD-13: "Is the case legitimate?" — admissibility detail may be sparse in KB.

If they still fail after Fix 1, leave them as known limitations and add a comment.

---

## Implementation Order

1. **Fix 2 first** (contamination guard) — this is a safety bug
2. **Fix 1 second** (retrieval confidence) — this is a recall improvement
3. **Test adjustments** — after both fixes are deployed

Run `npm run verify-adversarial-safeguards` after Fix 2 (S-3 should pass).
Run `npm run verify-false-decline` after Fix 1 (some FD failures should resolve).

---

## Out of Scope

These are NOT addressed here (they are KB/content gaps, not code bugs):
- FD-06 failure: Judge info not in KB (3 pre-trial judges)
- FD-13 failure: Admissibility detail sparse in KB
- Any test that fails because the LLM chose different wording than expected (phrasing variance)
