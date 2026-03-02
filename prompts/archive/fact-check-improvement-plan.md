# Fact-Check Pipeline Improvement Plan

> **Purpose:** Root cause analysis and concrete fixes for 4 failure categories observed in TC-26 through TC-58.
> **Scope:** Changes within the existing pipeline architecture (claim extraction → retrieval → verification → judge).
> **Constraint:** No existing guardrail (P-1–P-24, R-1–R-21) is weakened.

---

## Part 1: Root Cause Analysis

### Failure Category 1: Claim Extraction Failures

**Root cause:** The claim extraction prompt (`CLAIM_EXTRACTION_SYSTEM` in `fact-check.ts`) treats extraction as a single-pass classification task. It tells the LLM to "extract and classify statements" but provides no decomposition strategy for:

- **Embedded assumptions in subordinate clauses** (TC-26: "After being convicted, Duterte appealed" — the subordinate clause "being convicted" is an unstated assumption that must become its own claim). The prompt says "decompose compound claims" but only gives one example pattern: comma-separated lists ("murder, torture, and rape"). It never shows subordinate clause decomposition.
- **Logical chains** (TC-27): "Since the ICC found him guilty, the Philippines must extradite him" contains two claims — a premise and a conclusion — but the prompt has no instruction to split conditional/causal chains.
- **Hedge terms** (TC-28, TC-29): "Reportedly" and "many say" are not in the strip-list. The prompt strips "According to Rappler" (source attribution) and "murderer" (emotional framing) but never addresses epistemic hedges.
- **Multi-layer nesting** (TC-47): The 5-claim extraction limit (CE-1) is correct, but the prompt doesn't tell the LLM to prioritize depth of decomposition over surface-level counting. A sentence with 4 embedded assumptions looks like "1 statement" to a model that hasn't been told to unpack assumptions.
- **Double negatives** (TC-50): "It's not true that Duterte was not charged" — the prompt has zero guidance on negation resolution.

**Secondary cause:** `gpt-4o-mini` is used for extraction. This model is fast but weaker at multi-step reasoning. Compound decomposition requires the model to identify implicit presuppositions — a task that benefits from a more capable model or a structured decomposition prompt.

### Failure Category 2: Verification Logic Errors

**Root cause:** The verification step (`buildFactCheckPrompt`) sends all claims to the LLM in a single batch with all chunks. The LLM must simultaneously:
1. Match each claim to relevant chunks
2. Determine if chunks support, contradict, or are silent
3. Apply the correct verdict

This is too many cognitive steps for a single prompt. Specific failures:

- **Temporal/procedural claims** (TC-30, TC-31): The prompt has no procedural timeline reference. When a claim says "sentenced in 2024," the LLM must infer from chunks that the case is still at pre-trial. But if the chunks describe the confirmation hearing (not sentencing), the LLM defaults to UNVERIFIABLE because it doesn't find the word "sentence" — missing that confirmation-stage = no-sentence-yet = FALSE.
- **Implicit prerequisite claims** (TC-32): "Served part of his sentence" implies a sentence exists. The prompt never tells the LLM to unpack implicit prerequisites before verifying.
- **Numerical comparison** (TC-33, TC-34, TC-35): The prompt says "if documents state a DIFFERENT number → FALSE" but provides no instruction for ranges, approximations, or "at least" qualifiers.
- **Legal concept verification** (TC-36, TC-37, TC-38): The prompt treats all claims the same. Legal claims (wrong article number, wrong evidentiary standard, complementarity misstatement) require specific comparison against legal framework documents, but the prompt doesn't distinguish them.
- **Exclusivity claims** (TC-42): "Only accused of imprisonment" requires checking that imprisonment is in the DCC AND that nothing else is. The prompt never addresses "only/solely/exclusively" as completeness checks.

**Secondary cause:** The retrieval step combines all factual claims into one query string (`claimSearchQueries.join(". ")`). This means a 3-claim input produces one retrieval call. If claim 1 and claim 3 relate to different document topics, the merged query may fail to retrieve relevant chunks for any individual claim.

### Failure Category 3: Framing Bypass

**Root cause:** The claim extraction step strips some framing (emotional language, source attributions) but the verification step is exposed to the full claim text including qualifiers. Specific gaps:

- **"In principle" qualifiers** (TC-48): The extraction prompt strips "obviously" and "reportedly" (if added) but not epistemic qualifiers like "in principle," "essentially," "technically." These pass through to verification, where the LLM treats them as hedges that soften the verdict.
- **Authority attributions** (TC-52): "ICC judges declared" passes through extraction because it looks like a factual claim about what judges said. But the verification LLM treats the attribution as adding credibility, biasing toward VERIFIED.
- **Embedded comparisons** (TC-58): "Like other leaders convicted by the ICC, Duterte..." — the comparison causes the verification LLM to discuss other cases (violating P-3) or drift into comparison mode.
- **Fabricated specificity** (TC-56): Fake filing numbers ("ICC-01/21-01/11-T-001-Red") look credible because they follow ICC naming conventions. Neither the extraction nor verification prompt tells the LLM to check filing numbers against retrieved documents.
- **Overgeneralization** (TC-41, TC-42): "Every allegation proven" — the LLM sees "proven" and focuses on the proof concept rather than checking whether EVERY allegation was individually verified.

**Secondary cause:** The judge criteria don't check for framing bypass. The judge checks "verdict contradicting retrieved chunks" but not "verdict softened by linguistic qualifier" or "response influenced by fabricated authority attribution."

### Failure Category 4: Structured Output Inconsistency

**Root cause:** The verification LLM outputs freeform text that is parsed with regex:
```
/\d+\.\s*"([^"]+)"\s*—\s*(VERIFIED|FALSE|MISLEADING|UNVERIFIABLE|NOT_IN_ICC_RECORDS)\.\s*ICC documents state:\s*([^[\]]+)\.\s*\[?(\d+)\]?/gi
```

This regex is brittle:
- If the LLM uses slightly different formatting (e.g., single quotes, em-dash instead of en-dash, extra newlines), the regex fails silently. When it fails, ALL claims fall through to the fallback (line 353-364 in fact-check.ts), which labels everything UNVERIFIABLE with low confidence.
- The overall verdict is extracted from the first line of the LLM output (`VERDICT: X`), but `computeOverallVerdict` in fact-check.ts recalculates it deterministically. These can disagree if the LLM computes the overall verdict incorrectly.
- The copy-text is generated from the structured data (correct), but `citationMarker` only captures one citation per claim (the regex captures `(\d+)` singular), so multi-citation claims lose citation markers.

**Secondary cause:** No post-generation validation layer exists. The parsed output is used directly without checking that required fields are populated, verdict codes are valid, or overall verdict follows precedence rules.

---

## Part 2: Claim Extraction Improvements

### Improvement 2.1: Structured Decomposition Instructions

**Problem:** Embedded assumptions, logical chains, and multi-layer claims are not decomposed (TC-26, TC-27, TC-47).

**Implementation:** Replace the single "Decompose compound claims" instruction with explicit decomposition rules and examples.

**Current prompt language:**
```
- Decompose compound claims: "charged with murder, torture, and rape" → 3 separate claims
```

**Replacement:**
```
DECOMPOSITION RULES (apply in order):
D-1. COMMA/AND LISTS: "charged with murder, torture, and rape" → 3 claims: "charged with murder", "charged with torture", "charged with rape"
D-2. SUBORDINATE CLAUSES: "After being convicted, Duterte appealed" → 2 claims: "Duterte was convicted", "Duterte appealed"
D-3. CONDITIONAL/CAUSAL: "Since the ICC found him guilty, the Philippines must extradite" → 2 claims: "The ICC found him guilty", "The Philippines must extradite Duterte"
D-4. IMPLICIT PREREQUISITES: "Duterte served part of his sentence" → 2 claims: "Duterte was sentenced", "Duterte served part of his sentence"
D-5. TEMPORAL SEQUENCES: "Duterte was arrested, tried, and convicted" → 3 claims with temporal ordering preserved
D-6. EXCLUSIVITY CLAIMS: "Duterte is only charged with imprisonment" → 2 claims: "Duterte is charged with imprisonment", "Duterte has no other charges" (the "only" creates an implicit completeness claim)

CRITICAL: If a sentence ASSUMES something happened (subordinate clause, past participle, prerequisite), that assumption IS a separate claim that must be independently verified.
```

**Example input/output:**
- Before: "After being convicted, Duterte appealed to the Appeals Chamber" → 1 claim: "After being convicted, Duterte appealed to the Appeals Chamber"
- After: Claim 1: "Duterte was convicted by the ICC" / Claim 2: "Duterte appealed to the Appeals Chamber"

**Test cases addressed:** TC-26, TC-27, TC-32, TC-42, TC-47
**Risk:** Over-decomposition of simple sentences. Mitigated by the 5-claim limit and instruction to not split below the level of independently verifiable units.

### Improvement 2.2: Hedge/Qualifier Stripping Rules

**Problem:** "Reportedly," "many say," "in principle," "essentially," "technically" survive extraction (TC-28, TC-29, TC-48).

**Current prompt language:**
```
- Strip ALL emotional framing: "Duterte the murderer was convicted" → extract "Duterte was convicted"
- Strip ALL source attributions: "According to Rappler, 30,000 were killed" → extract "30,000 were killed"
```

**Addition (after source attribution stripping):**
```
- Strip ALL epistemic hedges and qualifiers: "reportedly", "allegedly", "many say", "it is believed", "in principle", "essentially", "technically", "some claim" → extract the bare assertion
  Example: "Reportedly, Duterte was convicted" → "Duterte was convicted"
  Example: "In principle, the ICC has jurisdiction" → "The ICC has jurisdiction"
  Example: "Many say 30,000 were killed" → "30,000 were killed"
- Strip ALL certainty/uncertainty markers: "obviously", "clearly", "undeniably", "perhaps", "maybe"
- The stripped qualifier does NOT change the claim type — a hedged factual assertion is still a FACTUAL_CLAIM
```

**Test cases addressed:** TC-28, TC-29, TC-48
**Risk:** None. Stripping hedges makes claims more verifiable, not less.

### Improvement 2.3: Double Negation Resolution

**Problem:** "It's not true that Duterte was not charged" is not resolved to its positive form (TC-50).

**Addition to extraction prompt:**
```
- Resolve double negatives to their positive equivalent before classification:
  "It's not true that Duterte was not charged" → "Duterte was charged"
  "The ICC didn't fail to issue a warrant" → "The ICC issued a warrant"
  "It cannot be denied that he committed crimes" → "He committed crimes" (then verify procedurally)
```

**Test cases addressed:** TC-50
**Risk:** Subtle double negatives may be misresolved. Mitigated by the LLM's natural language understanding and the temperature=0 setting.

### Improvement 2.4: Authority Attribution as Framing (Not Fact)

**Problem:** "ICC judges declared" and "the court confirmed" cause extraction to treat the claim as more credible (TC-52).

**Addition to extraction prompt:**
```
- Strip ALL authority attributions that the user asserts but that must be verified:
  "ICC judges declared him guilty" → "Duterte was declared guilty" (then verify)
  "The court confirmed the charges" → "The charges were confirmed" (then verify)
  "The Prosecutor established that..." → "[the claimed fact]" (then verify)
  The authority of the source is PART OF the claim to verify, not a reason to believe it.
```

**Test cases addressed:** TC-52
**Risk:** Legitimate references to ICC authority (e.g., "The Pre-Trial Chamber issued a warrant") should NOT be stripped — the "Pre-Trial Chamber issued a warrant" is the factual claim itself. The stripping should only apply to attributions used to add credibility to a separate assertion.

### Improvement 2.5: Comparison/Other-Case Detection

**Problem:** "Like other leaders convicted by the ICC, Duterte..." causes topic drift (TC-58).

**Addition to extraction prompt:**
```
- Strip ALL embedded comparisons to other leaders, cases, or situations:
  "Like other leaders convicted by the ICC, Duterte was sentenced" → "Duterte was sentenced"
  "Similar to the Lubanga case, Duterte's charges include..." → "Duterte's charges include [X]"
  The comparison is IRRELEVANT to verification. Extract only the Duterte-specific claim.
- If the input is ENTIRELY about another case or leader with no Duterte-specific claim → OUT_OF_SCOPE
```

**Test cases addressed:** TC-58
**Risk:** None — P-3 already prohibits comparing leaders.

---

## Part 3: Verification Logic Improvements

### Improvement 3.1: Procedural Stage Reference Block

**Problem:** Temporal and procedural claims default to UNVERIFIABLE because the LLM doesn't have a reference framework for what case stages mean (TC-30, TC-31, TC-32).

**Implementation:** Add a procedural stage reference to the verification prompt, derived from the retrieved chunks.

**Addition to `buildFactCheckPrompt`:**
```
PROCEDURAL STAGE REFERENCE:
The Duterte ICC case follows this sequence: preliminary examination → investigation → arrest warrant → surrender/arrest → confirmation of charges hearing → confirmation decision → trial → verdict → sentencing → appeal.
When verifying temporal or procedural claims, determine the CURRENT stage from the ICC documents below. Any claim asserting an event from a LATER stage has occurred is FALSE (not UNVERIFIABLE) because the procedural sequence means it cannot have happened yet.
Example: If documents show the case is at "confirmation of charges," then:
- "Duterte was tried" → FALSE (trial comes after confirmation)
- "Duterte was sentenced" → FALSE (sentencing comes after trial)
- "Duterte was convicted" → FALSE (conviction comes after trial)
```

**Test cases addressed:** TC-30, TC-31, TC-32, TC-25, TC-07
**Risk:** If the KB is outdated and the case has progressed, the stage reference could be stale. Mitigated by deriving the stage from retrieved chunks, not hardcoded.

### Improvement 3.2: Numerical Comparison Rules

**Problem:** Numerical claims are not compared strictly enough, and ranges/approximations are not handled (TC-33, TC-34, TC-35).

**Addition to verification prompt:**
```
NUMERICAL CLAIM RULES:
- If claim states a SPECIFIC number and documents state a DIFFERENT specific number → FALSE
- If claim states a RANGE ("between 10,000 and 30,000") and documents state a specific number outside that range → FALSE
- If claim states a RANGE and documents state a number WITHIN that range → MISLEADING (range may imply uncertainty not in the documents)
- If claim uses "approximately" or "about" and documents state a number within 10% → VERIFIED; outside 10% → MISLEADING
- If claim uses "at least N" and documents state N or more → VERIFIED; documents state less than N → FALSE
- If documents contain NO numbers on this topic → UNVERIFIABLE or NOT_IN_ICC_RECORDS
- NEVER use your own knowledge of numbers. ONLY compare against numbers in the ICC DOCUMENTS section.
```

**Test cases addressed:** TC-33, TC-34, TC-35
**Risk:** The 10% threshold for "approximately" is arbitrary. Acceptable because any reasonable threshold is better than no threshold.

### Improvement 3.3: Legal Concept Verification Rules

**Problem:** Legal claims (wrong article, wrong standard, complementarity) are not caught (TC-36, TC-37, TC-38).

**Addition to verification prompt:**
```
LEGAL CONCEPT CLAIMS:
- If claim cites a specific ARTICLE NUMBER, check that article number against the documents. Wrong article number → FALSE.
- If claim asserts a specific EVIDENTIARY STANDARD (e.g., "beyond reasonable doubt"), check against the documents for what standard actually applies at the current stage. Wrong standard → FALSE.
- If claim asserts JURISDICTION on specific grounds, check against the documents. Wrong jurisdictional basis → FALSE.
- If claim uses a legal term incorrectly (e.g., calls "crimes against humanity" a "war crime"), that is FALSE if the documents clearly use the correct term.
- "Complementarity" claims: if claim asserts the Philippines handled the case adequately (therefore ICC has no jurisdiction), check whether documents address the admissibility/complementarity finding. If documents found the case admissible → claim is FALSE.
```

**Test cases addressed:** TC-36, TC-37, TC-38
**Risk:** None — legal verification against documents is the core function.

### Improvement 3.4: Exclusivity Claim Handling

**Problem:** "Only charged with X" is verified by checking X exists, but not by checking that nothing else exists (TC-42).

**Addition to verification prompt:**
```
EXCLUSIVITY/COMPLETENESS CLAIMS:
- Claims containing "only", "solely", "exclusively", "just", "nothing but" require TWO checks:
  1. Does the stated item exist in documents? (If no → FALSE)
  2. Are there OTHER items in documents not mentioned? (If yes → FALSE or MISLEADING)
  Example: "Only charged with imprisonment" → Check: is imprisonment in DCC? (yes) + Are there other charges? (yes, murder) → FALSE
  Example: "Only three counts" → Check: are there three counts? (yes) + Are there more? (no) → VERIFIED
```

**Test cases addressed:** TC-42
**Risk:** None.

### Improvement 3.5: Implicit Prerequisite Unpacking

**Problem:** Claims that presuppose a prior event ("served his sentence" presupposes sentencing) are not caught (TC-32).

This is primarily an extraction-side fix (Improvement 2.1, D-4). At the verification level, add:

```
IMPLICIT PREREQUISITES:
If a claim implicitly requires a prior event to have occurred (e.g., "served his sentence" requires sentencing; "appealed the verdict" requires a verdict), and the documents show that prior event has NOT occurred, then the claim is FALSE — because the prerequisite has not been met.
Do not label such claims as UNVERIFIABLE. The absence of the prerequisite event is itself a contradiction.
```

**Test cases addressed:** TC-32
**Risk:** None.

---

## Part 4: Framing Resistance

### Improvement 4.1: Pre-Verification Claim Normalization

**Problem:** Qualifiers, authority attributions, and comparisons survive extraction and bias the verification LLM.

**Implementation:** After claim extraction and before verification, apply a deterministic normalization step (no LLM needed):

```typescript
function normalizeClaim(claim: string): string {
  let c = claim;
  // Strip epistemic hedges
  c = c.replace(/\b(reportedly|allegedly|essentially|technically|in principle|perhaps|obviously|clearly|undeniably|supposedly|purportedly)\b,?\s*/gi, '');
  // Strip social proof framing
  c = c.replace(/\b(it is widely known that|everyone knows that|many say that|many believe that|it is common knowledge that|some claim that)\b/gi, '');
  // Strip authority attributions (only when followed by a separate claim)
  c = c.replace(/\b(ICC judges declared|the court confirmed|the prosecutor established|the chamber found|it has been officially stated)\s+that\s+/gi, '');
  // Strip comparison prefixes
  c = c.replace(/\b(like other leaders convicted by the ICC|similar to the \w+ case|just as in the \w+ case),?\s*/gi, '');
  // Strip certainty markers
  c = c.replace(/\b(it is (un)?true that|the fact is that|it cannot be denied that|there is no doubt that)\s*/gi, '');
  // Clean up leading/trailing whitespace and capitalize
  c = c.trim().replace(/^\w/, (ch) => ch.toUpperCase());
  return c;
}
```

**Test cases addressed:** TC-28, TC-29, TC-41, TC-48, TC-52, TC-58
**Risk:** Aggressive stripping could remove substantive content. Mitigated by only stripping known framing patterns and preserving the original text in the output.
**Latency cost:** Zero — this is a regex pass, not an LLM call.

### Improvement 4.2: Fabricated Specificity Detection

**Problem:** Fake filing numbers, hearing dates, and document references are not flagged (TC-56).

**Implementation:** Add to the verification prompt:

```
FABRICATED SPECIFICITY:
- If a claim cites a specific ICC filing number, document number, or case reference (e.g., "ICC-01/21-01/11-T-001-Red"), check whether that exact reference appears in the ICC documents below.
- If the reference does NOT appear in the documents → NOT_IN_ICC_RECORDS
- NEVER treat a detailed-looking reference as credible simply because it follows ICC naming conventions. Verify every specific reference against the documents.
- Same for specific hearing dates: if a claim says "the March 15, 2026 hearing," check whether any document mentions that date. If not → NOT_IN_ICC_RECORDS.
```

**Test cases addressed:** TC-56
**Risk:** None.

### Improvement 4.3: Overgeneralization Detection

**Problem:** "Every allegation was proven" and "all charges confirmed" are not challenged for completeness (TC-41).

**Addition to verification prompt:**
```
OVERGENERALIZATION:
- Claims containing "every", "all", "each", "no", "none", "never" require checking against the COMPLETE set in the documents.
- "Every allegation was proven" → check: has a trial occurred? (if no → FALSE). Has every charge been individually adjudicated? (if no → FALSE or MISLEADING)
- "All charges were confirmed" → check: were all charges confirmed, or were some charges not confirmed?
- Treat universal claims ("all", "every", "none") with the same rigor as exclusivity claims.
```

**Test cases addressed:** TC-41
**Risk:** None.

---

## Part 5: Structured Output Enforcement

### Improvement 5.1: Use OpenAI Function Calling / JSON Mode

**Problem:** Freeform text output parsed with brittle regex.

**Implementation:** Switch the verification LLM call from freeform text to structured output using OpenAI's `response_format: { type: "json_object" }` or function calling.

Define the expected schema:
```typescript
const VERIFICATION_SCHEMA = {
  type: "object",
  properties: {
    overall_verdict: { type: "string", enum: ["VERIFIED", "FALSE", "MISLEADING", "UNVERIFIABLE", "NOT_IN_ICC_RECORDS", "PARTIALLY_VERIFIED"] },
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim_text: { type: "string" },
          verdict: { type: "string", enum: ["VERIFIED", "FALSE", "MISLEADING", "UNVERIFIABLE", "NOT_IN_ICC_RECORDS"] },
          icc_says: { type: "string" },
          citation_markers: { type: "array", items: { type: "string" } },
          evidence_type: { type: "string", enum: ["procedural_status", "case_fact", "legal_framework", "timeline", "numerical"] }
        },
        required: ["claim_text", "verdict", "icc_says", "citation_markers", "evidence_type"]
      }
    },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          marker: { type: "string" },
          document_title: { type: "string" },
          date: { type: "string" }
        },
        required: ["marker", "document_title"]
      }
    }
  },
  required: ["overall_verdict", "claims", "citations"]
};
```

**Test cases addressed:** All FC-4 (structured output) failures
**Risk:** JSON mode may slightly change output quality. Mitigated by explicit schema instructions in the prompt.

### Improvement 5.2: Deterministic Overall Verdict Computation

**Problem:** LLM computes overall verdict in the prompt, which can disagree with `computeOverallVerdict`.

**Implementation:** Already implemented in code — `computeOverallVerdict()` recalculates deterministically. The improvement is to REMOVE the overall verdict from the LLM's output instructions entirely, and only use the deterministic computation. In the prompt, change:

```
Respond with the per-claim verdicts only. Do NOT output an overall verdict — it will be computed automatically.
```

This prevents the LLM from wasting tokens on overall verdict computation and eliminates disagreement.

**Test cases addressed:** Overall verdict inconsistencies
**Risk:** None.

### Improvement 5.3: Post-Generation Validation

**Problem:** Parsed output may have missing fields or invalid values.

**Implementation:** Add a validation function after parsing:

```typescript
function validateFactCheckOutput(claims: VerifiedClaim[]): VerifiedClaim[] {
  const validVerdicts: ClaimVerdict[] = ["verified", "false", "misleading", "unverifiable", "not_in_icc_records", "opinion", "out_of_scope", "partially_verified"];
  return claims.map(c => ({
    ...c,
    verdict: validVerdicts.includes(c.verdict) ? c.verdict : "unverifiable",
    iccSays: c.iccSays || "Could not verify from retrieved ICC documents.",
    citationMarker: c.citationMarker || "",
    confidence: ["high", "medium", "low"].includes(c.confidence) ? c.confidence : "low",
    evidenceType: c.evidenceType || "case_fact",
  }));
}
```

**Test cases addressed:** Missing fields, invalid enum values
**Risk:** None.

---

## Part 6: LLM-as-Judge Criteria Updates

### New criterion J-FC-1: Framing Bypass Detection
- **Checks:** Whether the response verdict was softened by linguistic qualifiers in the original claim
- **REJECT if:** Response says MISLEADING or UNVERIFIABLE for a claim that contains "in principle," "reportedly," "essentially" when the stripped claim would be FALSE
- **Example rejection:** Claim: "In principle, Duterte was convicted" → Response: "MISLEADING. In principle the case may lead to conviction..." → REJECT (should be FALSE — no conviction exists)

### New criterion J-FC-2: Fabricated Authority Detection
- **Checks:** Whether the response treats a user-asserted authority attribution as verified
- **REJECT if:** Response treats "ICC judges declared X" as evidence that X happened, without verifying X against the chunks
- **Example rejection:** Claim: "ICC judges declared him guilty" → Response: "VERIFIED. As the judges declared..." → REJECT (no declaration of guilt in chunks)

### New criterion J-FC-3: Exclusivity/Completeness Check
- **Checks:** Whether claims with "only/solely/all/every/none" were checked for completeness
- **REJECT if:** Response marks "only charged with X" as VERIFIED without checking whether other charges exist in the documents
- **Example rejection:** Claim: "Only charged with imprisonment" → Response: "VERIFIED. ICC documents confirm imprisonment charge" → REJECT (documents also show murder charge)

### New criterion J-FC-4: Implicit Prerequisite Check
- **Checks:** Whether claims that presuppose a prior event were checked for that prerequisite
- **REJECT if:** Response labels a claim UNVERIFIABLE when its implicit prerequisite is contradicted by documents
- **Example rejection:** Claim: "Duterte served part of his sentence" → Response: "UNVERIFIABLE. No information about sentence serving" → REJECT (should be FALSE — no sentence has been imposed)

### New criterion J-FC-5: Numerical Accuracy
- **Checks:** Whether numerical claims were compared against document numbers
- **REJECT if:** Response labels a numerical claim UNVERIFIABLE when documents contain a different number
- **Example rejection:** Claim: "15 counts" → Chunks say "3 counts" → Response: "UNVERIFIABLE" → REJECT (should be FALSE)

### New criterion J-FC-6: Fabricated Detail Detection
- **Checks:** Whether the response introduces charges, dates, or details from training data
- **REJECT if:** Response mentions charges (e.g., "torture and rape") that do not appear in any retrieved chunk
- **Example rejection:** Response says "charged with crimes against humanity of murder, torture, and rape" when chunks only mention "murder" and "imprisonment" → REJECT

---

## Part 7: Prompt Spec Changes

### Change 7.1: Claim Extraction System Prompt

**Current (in `CLAIM_EXTRACTION_SYSTEM`):**
```
- Decompose compound claims: "charged with murder, torture, and rape" → 3 separate claims
```

**Replacement:**
```
DECOMPOSITION RULES (apply in order):
D-1. COMMA/AND LISTS: "charged with murder, torture, and rape" → 3 claims
D-2. SUBORDINATE CLAUSES: "After being convicted, Duterte appealed" → "Duterte was convicted" + "Duterte appealed"
D-3. CONDITIONAL/CAUSAL: "Since the ICC found him guilty, X must happen" → "The ICC found him guilty" + "X must happen"
D-4. IMPLICIT PREREQUISITES: "Duterte served his sentence" → "Duterte was sentenced" + "Duterte served his sentence"
D-5. TEMPORAL SEQUENCES: "arrested, tried, and convicted" → 3 separate temporal claims
D-6. EXCLUSIVITY CLAIMS: "only charged with X" → "charged with X" + "no other charges exist"

CRITICAL: If a sentence ASSUMES something happened (subordinate clause, past participle, prerequisite), that assumption IS a separate claim.
```

**Why:** Current instruction only covers comma-separated lists. Real-world social media contains embedded assumptions, causal chains, and implicit prerequisites that must be decomposed.

### Change 7.2: Hedge/Qualifier Stripping

**Current:** No explicit hedge stripping rule exists.

**NEW — add after source attribution stripping:**
```
- Strip ALL epistemic hedges: "reportedly", "allegedly", "in principle", "essentially", "technically", "many say", "it is believed", "perhaps", "some claim"
- Strip ALL certainty markers: "obviously", "clearly", "undeniably", "it is widely known"
- Strip ALL authority attributions used as credibility boosts: "ICC judges declared that X" → "X" (then verify X)
- Strip ALL embedded comparisons: "Like other ICC-convicted leaders, Duterte X" → "Duterte X"
- Resolve double negatives: "It's not true that he was not charged" → "He was charged"
```

**Why:** These framing patterns survive extraction and bias the verification step.

### Change 7.3: Verification Prompt — Procedural Stage Block

**Current:** No procedural stage reference exists in the verification prompt.

**NEW — add to `buildFactCheckPrompt`:**
```
PROCEDURAL STAGE REFERENCE:
ICC case sequence: preliminary examination → investigation → arrest warrant → surrender/arrest → confirmation of charges → trial → verdict → sentencing → appeal.
Determine the CURRENT stage from the documents below. Any claim asserting a LATER stage event has occurred is FALSE — the procedural sequence means it cannot have happened yet.
```

**Why:** Without this, the LLM defaults to UNVERIFIABLE for "sentenced" claims when chunks only discuss confirmation, missing the logical implication that no trial = no sentence.

### Change 7.4: Verification Prompt — Numerical, Legal, Exclusivity Rules

**Current:** Only the FALSE vs UNVERIFIABLE distinction block exists.

**NEW — add after that block:**
```
NUMERICAL CLAIMS: Compare exact numbers. Different number = FALSE, not UNVERIFIABLE. ONLY use numbers from the documents.
LEGAL CONCEPT CLAIMS: Check article numbers, evidentiary standards, and jurisdictional bases against documents. Wrong article/standard = FALSE.
EXCLUSIVITY CLAIMS ("only", "solely"): Check that the stated item exists AND that no other items exist in documents. If other items exist → FALSE.
OVERGENERALIZATION ("all", "every", "none"): Check completeness against documents. If not all items verified → FALSE or MISLEADING.
IMPLICIT PREREQUISITES: If a claim presupposes an event (e.g., "served sentence" presupposes sentencing), and documents show that event has not occurred → FALSE.
FABRICATED SPECIFICITY: If a claim cites specific filing numbers, dates, or document references, verify them against the documents. If not found → NOT_IN_ICC_RECORDS.
```

**Why:** These are distinct verification patterns that the current prompt does not address.

### Change 7.5: Judge Criteria Updates

**Current (`JUDGE_SYSTEM_PROMPT` fact-check section):**
```
- (Fact-check) Adopting pasted claims as verified; verdict contradicting retrieved chunks...
```

**Addition (after existing fact-check REJECT criteria):**
```
- (Fact-check) Response verdict softened by qualifier framing ("in principle", "reportedly") — if the stripped claim would be FALSE, a MISLEADING verdict is wrong
- (Fact-check) Response treats user-asserted authority attribution ("ICC judges declared") as evidence without chunk verification
- (Fact-check) "Only/solely/all/every" claims verified without completeness check against documents
- (Fact-check) Claims presupposing prior events (e.g., "served sentence") labeled UNVERIFIABLE when prerequisite is contradicted by documents
- (Fact-check) Numerical claim labeled UNVERIFIABLE when documents contain a contradicting number
- (Fact-check) Response introduces charges, dates, or details not found in any retrieved chunk (hallucination from training data)
```

**Why:** These are the specific judge gaps that allow Failure Categories 2 and 3 to pass through.

---

## Part 8: Test Case Coverage Matrix

| TC | Failure Cat | Improvement | Expected After Fix | Priority |
|----|-------------|-------------|-------------------|----------|
| TC-26 | 1: Extraction | 2.1 (D-2 subordinate clauses) | "convicted" and "appealed" extracted as 2 separate claims | P0 |
| TC-27 | 1: Extraction | 2.1 (D-3 conditional/causal) | Premise and conclusion extracted separately | P0 |
| TC-28 | 1: Extraction | 2.2 (hedge stripping) | "reportedly" stripped, bare claim verified | P1 |
| TC-29 | 1: Extraction | 2.2 (hedge stripping) | "many say" stripped, bare claim verified | P1 |
| TC-30 | 2: Verification | 3.1 (procedural stage) | Temporal claim checked against case stage → FALSE if stage not reached | P0 |
| TC-31 | 2: Verification | 3.1 (procedural stage) | Sequence claim verified against procedural order | P0 |
| TC-32 | 1+2: Both | 2.1 (D-4) + 3.5 (prerequisites) | "served sentence" decomposed; sentencing prerequisite checked → FALSE | P0 |
| TC-33 | 2: Verification | 3.2 (numerical) | Specific number compared against document number → FALSE if different | P0 |
| TC-34 | 2: Verification | 3.2 (numerical) | Range claim compared against document number | P1 |
| TC-35 | 2: Verification | 3.2 (numerical) | "Approximately" claim with 10% threshold | P1 |
| TC-36 | 2: Verification | 3.3 (legal concept) | Wrong article number → FALSE | P0 |
| TC-37 | 2: Verification | 3.3 (legal concept) | Wrong evidentiary standard → FALSE | P1 |
| TC-38 | 2: Verification | 3.3 (legal concept) | Complementarity misstatement → FALSE | P1 |
| TC-41 | 3: Framing | 4.3 (overgeneralization) | "Every allegation proven" → checked for completeness → FALSE | P0 |
| TC-42 | 2+3: Both | 2.1 (D-6) + 3.4 (exclusivity) | "Only imprisonment" decomposed; completeness check → FALSE | P0 |
| TC-47 | 1: Extraction | 2.1 (multi-layer) | 4-5 embedded claims decomposed into independent units | P1 |
| TC-48 | 3: Framing | 2.2 + 4.1 (qualifier stripping) | "In principle" stripped → bare claim verified → FALSE | P0 |
| TC-50 | 1: Extraction | 2.3 (double negation) | Double negative resolved to positive → verified normally | P1 |
| TC-52 | 3: Framing | 2.4 + 4.1 (authority attribution) | "ICC judges declared" stripped → claim verified independently | P0 |
| TC-56 | 3: Framing | 4.2 (fabricated specificity) | Fake filing number checked against documents → NOT_IN_ICC_RECORDS | P1 |
| TC-58 | 3: Framing | 2.5 + 4.1 (comparison) | Comparison prefix stripped → only Duterte claim verified | P0 |
| All | 4: Output | 5.1 (JSON mode) + 5.2 (deterministic verdict) + 5.3 (validation) | Consistent schema, valid enums, correct overall verdict | P0 |

**Priority summary:**
- **P0 (12 items):** TC-26, TC-27, TC-30, TC-31, TC-32, TC-33, TC-36, TC-41, TC-42, TC-48, TC-52, TC-58, structured output
- **P1 (9 items):** TC-28, TC-29, TC-34, TC-35, TC-37, TC-38, TC-47, TC-50, TC-56
- **P2:** None — all test cases represent real failure modes

---

## Implementation Sequence

1. **Claim extraction prompt rewrite** (addresses FC-1: ~10 TCs) — highest impact, single-file change
2. **Pre-verification normalization function** (addresses FC-3: ~6 TCs) — zero-latency regex pass
3. **Verification prompt additions** (addresses FC-2: ~10 TCs) — single-prompt change
4. **JSON mode for verification output** (addresses FC-4) — API parameter + parser rewrite
5. **Judge criteria updates** (addresses missed catches) — prompt string addition
6. **Post-generation validation** (addresses FC-4 edge cases) — utility function

Total new LLM calls: **0** (all improvements modify existing prompts or add deterministic steps).
Total latency increase: **Near zero** (one regex normalization pass added before verification).
