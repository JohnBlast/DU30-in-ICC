# Fact-Check Pipeline Improvement Plan — V2 (Constrained Revision)

> **Purpose:** Constrained optimization pass on V1 plan. Fixes the same failure categories (TC-26–TC-58) under stricter architectural, latency, and enum constraints.
>
> **Governing constraints:**
> - Minimal Intervention Principle — prompt refinement and deterministic post-processing preferred over new LLM calls
> - Latency Budget Discipline — zero new LLM calls unless strongly justified
> - Verdict Enum Stability — strictly VERIFIED, FALSE, UNVERIFIABLE, NOT_IN_ICC_RECORDS, OPINION (5 verdicts only)
> - No Architectural Drift — all changes inside: claim extraction → retrieval → verification → judge → deterministic post-processing
> - No guardrail weakening (P-1–P-24, R-1–R-21)

---

## Part 1 — What Was Over-Engineered in the Previous Plan

### 1.1 MISLEADING Verdict Was Unnecessary Complexity

V1 included MISLEADING as a per-claim verdict and PARTIALLY_VERIFIED as an overall verdict. This expanded the enum from 5 to 8 values, created ambiguous boundaries (when is something MISLEADING vs FALSE?), and gave the LLM a "soft" option that it defaulted to when uncertain. MISLEADING was a crutch — it let the verification LLM avoid committing to FALSE.

**Fix in V2:** Remove MISLEADING entirely. A claim either matches the documents (VERIFIED), contradicts them (FALSE), has no relevant information (UNVERIFIABLE), references specifics absent from documents (NOT_IN_ICC_RECORDS), or is non-factual (OPINION). Partial truth with missing context is FALSE — the claim as stated is not what the documents say. The `icc_says` field provides the nuance: "ICC documents state X, which differs from the claim's assertion of Y."

### 1.2 Decomposition Rules Were Under-Constrained

V1 proposed 6 decomposition rules (D-1 through D-6) with no stopping condition. This creates a real risk of over-splitting: "Duterte was charged with murder as a crime against humanity" could be fragmented into "Duterte was charged," "the charge is murder," "the charge is classified as a crime against humanity" — three trivial subclaims from one coherent statement. The 5-claim limit is a cap, not a stopping rule.

**Fix in V2:** Add explicit stopping rules and a decomposition depth limit.

### 1.3 Pre-Verification Normalization Was Redundant With Extraction

V1 proposed both: (a) stripping rules in the extraction prompt (S-1 through S-7), and (b) a separate deterministic `normalizeClaimForVerification()` regex function. This is belt-and-suspenders — if the extraction prompt strips hedges correctly, the regex function does nothing. If the extraction prompt fails, the regex catches it. But there's a subtle problem: the regex function operates on the *extracted* text, which the extraction LLM has already reformulated. Applying regex patterns designed for raw social media text to LLM-reformulated text can cause false matches.

**Fix in V2:** Keep the deterministic normalization function but narrow its scope to only patterns that reliably survive extraction (authority attributions, comparison prefixes). Move hedge stripping and double negation resolution entirely to the extraction prompt where the LLM has full context.

### 1.4 JSON Mode Switch Was Higher Risk Than Acknowledged

V1 proposed switching the verification LLM from freeform text to `response_format: { type: "json_object" }`. This is correct in principle but the V1 plan underestimated the risk: JSON mode changes the model's output distribution, and the verification prompt is heavily instructional. A prompt that works well for freeform reasoning may produce worse verdicts when forced into JSON. The V1 plan had no fallback quality check.

**Fix in V2:** Keep JSON mode but add a quality gate — if the JSON response contains zero citations or all claims are UNVERIFIABLE despite non-empty chunks, log a warning and trigger the regex fallback parser on a re-call without JSON mode.

### 1.5 Too Many Verification Sub-Rules

V1 added 7 specialized verification blocks (Procedural Stage, Numerical, Legal Concept, Exclusivity, Overgeneralization, Implicit Prerequisites, Fabricated Specificity). Each is individually justified, but together they bloat the verification prompt to ~800 tokens of instructions. With gpt-4o-mini's context constraints, this crowds out space for the actual ICC document chunks. The LLM has diminishing returns on instruction-following past a certain prompt length.

**Fix in V2:** Consolidate verification rules into 3 blocks maximum: (1) FALSE vs UNVERIFIABLE distinction with procedural stage, (2) Completeness/exclusivity checks, (3) Document-only grounding. Specific examples are more effective than category labels.

### 1.6 Judge Criteria Were Too Fine-Grained

V1 proposed 7 new REJECT criteria for the judge (J-FC-1 through J-FC-6 plus fabricated detail). The judge is a fast pass/fail check — overloading it with specific pattern-matching criteria turns it into a second verification LLM. The judge should check structural violations, not re-verify claim logic.

**Fix in V2:** Consolidate to 3 new judge criteria that address structural failures, not logical ones.

---

## Part 2 — Revised Minimal Plan

### 2.1 Changes Retained From V1 (Validated)

| Change | Type | Why Retained |
|--------|------|-------------|
| Decomposition rules in extraction prompt (D-1–D-6) | Prompt-only | Addresses ~10 TCs. Zero latency cost. Core failure. |
| Stripping rules in extraction prompt (S-1–S-7) | Prompt-only | Addresses ~6 TCs. Zero latency cost. |
| FALSE vs UNVERIFIABLE distinction examples | Prompt-only | Addresses ~8 TCs. Single most impactful verification fix. |
| Procedural stage reference in verification prompt | Prompt-only | Addresses ~5 TCs. Zero cost. Critical for temporal claims. |
| Deterministic overall verdict computation | Already implemented | `computeOverallVerdict()` exists. Just remove LLM-computed overall verdict from prompt. |
| Post-parse validation function | Deterministic layer | Zero cost. Prevents invalid enum values reaching the UI. |

### 2.2 Changes Modified From V1

| Change | V1 Approach | V2 Approach | Why |
|--------|-------------|-------------|-----|
| Normalization function | Broad regex (hedges, social proof, authority, comparisons, certainty) | Narrow regex (authority attributions, comparison prefixes only) | Hedge stripping belongs in the extraction prompt where LLM has context. Regex on LLM-reformulated text risks false matches. |
| JSON output mode | Switch to JSON mode unconditionally | Switch to JSON mode with quality gate fallback | Protects against JSON mode degrading verdict quality. |
| Verification prompt size | 7 specialized blocks (~800 tokens) | 3 consolidated blocks (~400 tokens) | Leaves more context window for chunks. |
| Judge criteria | 7 new fine-grained criteria | 3 new structural criteria | Judge checks structure, not logic. |
| MISLEADING verdict | Kept as enum value | Removed — mapped to FALSE with explanatory `icc_says` | Enum stability constraint. Eliminates LLM's "soft" escape hatch. |

### 2.3 Changes Removed From V1

| Change | Why Removed |
|--------|------------|
| 10% threshold for "approximately" claims | Arbitrary. LLM can handle "approximately" in context without a numeric rule. Adds prompt complexity for 1 test case (TC-35). |
| Separate numerical comparison rules block | Merged into FALSE vs UNVERIFIABLE examples. One concrete example ("15 counts" vs "3 counts") does more than an abstract rule. |
| Separate legal concept verification block | The existing "wrong article/standard = FALSE" instruction is sufficient when combined with document-grounding. No separate block needed. |

---

## Part 3 — Deterministic Enhancements (Preferred Fixes)

### 3.1 Deterministic Claim Normalization (Narrowed Scope)

**Type:** Deterministic layer
**Minimal Intervention Justification:** Cannot be solved by prompt alone because the extraction LLM may output claims like "ICC judges declared that Duterte was convicted" as a single factual claim (correctly — it IS a factual claim about what judges allegedly declared). The verification LLM then sees "ICC judges declared" and gives it undue weight. A deterministic strip before verification removes the bias vector without relying on the extraction LLM to anticipate verification-stage problems.

```typescript
function normalizeClaimForVerification(claim: string): string {
  let c = claim;
  // Strip authority attribution framing (when "that" follows — indicates separate claim embedded)
  c = c.replace(/\b(ICC judges declared|the court confirmed|the prosecutor established|the chamber found|it has been officially stated)\s+that\s+/gi, '');
  // Strip comparison framing
  c = c.replace(/\b(like other (leaders?|cases?|defendants?) (convicted|sentenced|charged) by the ICC|similar to the \w+ case),?\s*/gi, '');
  // Clean up: leading punctuation, double spaces
  c = c.replace(/^[,;:\s]+/, '').replace(/\s{2,}/g, ' ').trim();
  if (c.length > 0) c = c.charAt(0).toUpperCase() + c.slice(1);
  return c;
}
```

**What was removed vs V1:** Epistemic hedges (`reportedly`, `allegedly`, etc.), social proof framing (`it is widely known`), certainty markers (`obviously`, `clearly`), and truth wrappers (`it is true that`). These are moved entirely to the extraction prompt (S-3, S-4, S-7) where the LLM has full sentence context and can handle them more reliably than regex.

**Impact:** 4 TCs (TC-48, TC-52, TC-58, TC-41)
**Complexity:** Low
**Risk:** Minimal — only strips two narrow patterns with clear structural markers (`that` conjunction, comma-separated prefix).

### 3.2 Post-Parse Validation Function

**Type:** Deterministic layer
**Minimal Intervention Justification:** Pure defensive code. No alternative needed — this is the lowest-cost possible fix for enum violations and missing fields.

```typescript
function validateVerifiedClaim(c: VerifiedClaim): VerifiedClaim {
  const validVerdicts: ClaimVerdict[] = ["verified", "false", "unverifiable", "not_in_icc_records", "opinion", "out_of_scope"];
  return {
    ...c,
    verdict: validVerdicts.includes(c.verdict) ? c.verdict : "unverifiable",
    iccSays: c.iccSays || "Could not verify from retrieved ICC documents.",
    citationMarker: c.citationMarker || "",
    confidence: (["high", "medium", "low"] as const).includes(c.confidence as "high"|"medium"|"low") ? c.confidence : "low" as const,
    evidenceType: c.evidenceType || "case_fact",
  };
}
```

**Impact:** All structured output TCs
**Complexity:** Low
**Risk:** None

### 3.3 Deterministic Overall Verdict Computation (Revised for 5-Enum)

**Type:** Deterministic layer (already exists, needs revision)
**Minimal Intervention Justification:** Already implemented as `computeOverallVerdict()`. Needs update to remove MISLEADING and PARTIALLY_VERIFIED from the logic.

```typescript
function computeOverallVerdict(claims: VerifiedClaim[]): ClaimVerdict {
  const verdicts = claims.map(c => c.verdict);
  const factualVerdicts = verdicts.filter(v => v !== "opinion" && v !== "out_of_scope");

  if (factualVerdicts.length === 0) return "opinion";
  if (factualVerdicts.includes("false")) return "false";
  if (factualVerdicts.every(v => v === "verified")) return "verified";
  if (factualVerdicts.includes("verified") && factualVerdicts.some(v => v !== "verified")) return "false";
  // All UNVERIFIABLE / NOT_IN_ICC_RECORDS
  return "unverifiable";
}
```

**Logic change from V1:**
- Removed `misleading` from the chain entirely.
- Removed `partially_verified` — a mix of VERIFIED + non-VERIFIED is now `false` overall (the content as a whole contains false claims). This is stricter but simpler and eliminates the ambiguous "partially verified" state.
- If ALL factual claims are VERIFIED → `verified`
- If ANY factual claim is FALSE → `false`
- If mix of VERIFIED + UNVERIFIABLE (no FALSE) → `false` overall (because the content contains unverifiable claims alongside verified ones — the content as a whole is unreliable)

Wait — that last rule is too strict. If someone says "Duterte faces 3 counts [VERIFIED] and his lawyer is named X [UNVERIFIABLE]", marking the whole thing FALSE is wrong. Let me reconsider.

Better logic:
```
- All VERIFIED → overall VERIFIED
- Any FALSE → overall FALSE
- Mix of VERIFIED + (UNVERIFIABLE or NOT_IN_ICC_RECORDS), no FALSE → overall UNVERIFIABLE
  (some claims check out, but the content as a whole cannot be fully verified)
- All UNVERIFIABLE/NOT_IN_ICC_RECORDS → overall UNVERIFIABLE
- All OPINION → overall OPINION
```

This maps the old PARTIALLY_VERIFIED → UNVERIFIABLE, which is semantically accurate: "we couldn't fully verify this content."

Updated code:
```typescript
function computeOverallVerdict(claims: VerifiedClaim[]): ClaimVerdict {
  const verdicts = claims.map(c => c.verdict);
  const factualVerdicts = verdicts.filter(v => v !== "opinion" && v !== "out_of_scope");

  if (factualVerdicts.length === 0) return "opinion";
  if (factualVerdicts.includes("false")) return "false";
  if (factualVerdicts.every(v => v === "verified")) return "verified";
  return "unverifiable";
}
```

This is 4 lines. Clean. Deterministic. No ambiguity.

**Impact:** All overall verdict consistency issues
**Complexity:** Low
**Risk:** Downgrade — content with 2 VERIFIED + 1 UNVERIFIABLE claim gets overall UNVERIFIABLE instead of the old PARTIALLY_VERIFIED. This is acceptable: the system is saying "we couldn't fully verify this" which is true.

### 3.4 Deterministic Prerequisite Detection (Post-Extraction)

**Type:** Deterministic layer
**Minimal Intervention Justification:** The extraction prompt handles this via D-4 (Implicit Prerequisites). But D-4 relies on the LLM to recognize prerequisites, which it may miss. A deterministic post-extraction check catches the most common pattern: claims that use past-tense completion of a later procedural stage.

```typescript
const PROCEDURAL_PREREQUISITE_PATTERNS: Array<{ pattern: RegExp; prerequisiteClaim: string }> = [
  { pattern: /\b(served|serving|completed?)\b.*\b(sentence|term|imprisonment)\b/i, prerequisiteClaim: "Duterte was sentenced by the ICC" },
  { pattern: /\b(appeal|appealed|appealing)\b.*\b(verdict|conviction|sentence)\b/i, prerequisiteClaim: "A verdict or sentence was rendered" },
  { pattern: /\b(acquit|acquitted|exonerat)\b/i, prerequisiteClaim: "A trial was held and verdict rendered" },
  { pattern: /\b(pardon|pardoned|commut)\b/i, prerequisiteClaim: "A sentence was imposed" },
  { pattern: /\b(retri|new trial|second trial)\b/i, prerequisiteClaim: "A first trial was completed" },
];

function injectPrerequisiteClaims(claims: ExtractedClaim[]): ExtractedClaim[] {
  const newClaims: ExtractedClaim[] = [];
  for (const c of claims) {
    if (c.claimType !== "factual_claim") { newClaims.push(c); continue; }
    for (const pp of PROCEDURAL_PREREQUISITE_PATTERNS) {
      if (pp.pattern.test(c.extractedText)) {
        // Check if prerequisite is already extracted
        const alreadyExtracted = claims.some(existing =>
          existing.claimType === "factual_claim" &&
          existing.extractedText.toLowerCase().includes(pp.prerequisiteClaim.toLowerCase().slice(0, 20))
        );
        if (!alreadyExtracted) {
          newClaims.push({ extractedText: pp.prerequisiteClaim, claimType: "factual_claim" });
        }
        break; // One prerequisite per claim is sufficient
      }
    }
    newClaims.push(c);
  }
  return newClaims.slice(0, 5); // Respect CE-1 limit
}
```

**Impact:** TC-32, TC-30, TC-31
**Complexity:** Medium
**Risk:** Could inject a prerequisite claim that the user didn't intend. Mitigated by: (1) only injecting for claims that match very specific procedural-completion patterns, (2) checking for duplicate extraction, (3) the prerequisite claim is worded neutrally and will be verified against ICC documents like any other claim.

### 3.5 Deterministic Fabricated Reference Detection (Post-Extraction)

**Type:** Deterministic layer
**Minimal Intervention Justification:** Fake ICC filing numbers (e.g., "ICC-01/21-01/11-T-001-Red") cannot be reliably detected by the verification LLM because the LLM may treat detailed-looking references as credible. A regex check against the retrieved chunks is more reliable.

```typescript
const ICC_REFERENCE_PATTERN = /ICC-\d{2}\/\d{2}-\d{2}\/\d{2}[^\s,.)]*|No\.\s*ICC-[^\s,.)]+/gi;

function flagFabricatedReferences(claim: string, chunks: RetrievalChunk[]): boolean {
  const refs = claim.match(ICC_REFERENCE_PATTERN);
  if (!refs || refs.length === 0) return false;
  const chunkText = chunks.map(c => c.content).join(" ");
  return refs.some(ref => !chunkText.includes(ref));
}
```

When this returns true, the claim's verdict is overridden to `not_in_icc_records` in post-processing, with `icc_says` set to "This filing reference does not appear in retrieved ICC documents."

**Impact:** TC-56
**Complexity:** Low
**Risk:** Could false-positive on legitimate references with minor formatting differences. Mitigated by only checking exact string inclusion.

---

## Part 4 — LLM Call Justification

**New LLM calls proposed: ZERO.**

Every change in this plan is one of:
- Prompt refinement to an existing LLM call (extraction or verification)
- Deterministic post-processing layer (regex, validation, prerequisite injection)
- Judge criteria modification (prompt-only)

The two existing LLM calls remain:
1. Claim extraction (gpt-4o-mini, ~200ms) — prompt refined
2. Verification (gpt-4o-mini, ~400ms) — prompt refined, JSON mode added

**Why no new LLM call is needed:**

The V1 plan's secondary cause analysis noted that "compound decomposition requires multi-step reasoning" and suggested a more capable model. V2 rejects this: the extraction prompt with explicit D-1 through D-6 rules and examples gives gpt-4o-mini sufficient scaffolding for decomposition. If gpt-4o-mini still fails at decomposition after the improved prompt, the deterministic prerequisite injection (3.4) catches the most critical missed case (implicit prerequisites). A model upgrade can be evaluated later based on production telemetry, but is not justified pre-launch.

---

## Part 5 — Strict Enum Compliance Strategy

### 5.1 The 5 Permitted Verdicts

| Verdict | Per-Claim | Overall | Definition |
|---------|-----------|---------|------------|
| `VERIFIED` | Yes | Yes | Claim directly supported by ICC documents |
| `FALSE` | Yes | Yes | Claim directly contradicted by ICC documents (including procedural impossibility) |
| `UNVERIFIABLE` | Yes | Yes | No relevant information in ICC documents about this topic |
| `NOT_IN_ICC_RECORDS` | Yes | No (maps to UNVERIFIABLE) | Specific fact/number/reference not found in any ICC document |
| `OPINION` | Yes | Yes | Non-factual value judgment, emotional expression, or prediction |

### 5.2 How MISLEADING Is Simulated

MISLEADING was "partial truth with missing context." Under the 5-enum constraint, this maps as follows:

| Old MISLEADING Scenario | V2 Mapping | Rationale |
|------------------------|------------|-----------|
| Claim states a number in a valid range but imprecise | `FALSE` with `icc_says`: "ICC documents state [exact number]. The claim's figure of [X] does not match." | The claim as stated is wrong. The `icc_says` field provides the context that makes it "partial truth." |
| Claim is technically true but omits critical context | `VERIFIED` with `icc_says`: "ICC documents confirm [X]. Note: [additional context from documents]." | If the claim as literally stated is supported, it is VERIFIED. The system provides additional context from documents in `icc_says` — this is factual reporting, not editorializing. |
| Claim conflates two distinct concepts | `FALSE` with `icc_says`: "ICC documents distinguish between [A] and [B]. The claim conflates them." | Conflation is factual error. |

**Key principle:** The verdict is binary on the claim-as-stated. Nuance lives in `icc_says`. This is actually *more neutral* than MISLEADING — the system doesn't label content as "misleading" (which implies intent to deceive), it simply states what ICC documents say.

### 5.3 How PARTIALLY_VERIFIED Is Simulated

PARTIALLY_VERIFIED was the overall verdict when some claims are VERIFIED and others aren't. Under 5-enum:

- Any FALSE → overall FALSE (the content contains false claims)
- All VERIFIED → overall VERIFIED
- Mix of VERIFIED + UNVERIFIABLE (no FALSE) → overall UNVERIFIABLE (content cannot be fully verified)
- All UNVERIFIABLE → overall UNVERIFIABLE

The per-claim breakdown in the structured output already shows which specific claims are verified and which aren't. The user sees the detail. The overall verdict is the conservative summary.

### 5.4 How OUT_OF_SCOPE Is Handled

OUT_OF_SCOPE is a claim classification label, not a verdict. Claims classified as `out_of_scope` during extraction are labeled with verdict `OPINION` for enum compliance (since out-of-scope claims are by definition non-verifiable against ICC documents — functionally equivalent to "not a factual claim about this case"). The `evidenceType` field distinguishes: `"out_of_scope"` vs `"opinion"`.

**Code change:** In `computeOverallVerdict` and the `ClaimVerdict` type, `out_of_scope` maps to the same treatment as `opinion` — filtered out before computing the overall verdict. The display text can still say "Outside the Duterte ICC case" — that's a UI concern, not a verdict concern.

### 5.5 Updated ClaimVerdict Type

```typescript
export type ClaimVerdict =
  | "verified"
  | "false"
  | "unverifiable"
  | "not_in_icc_records"
  | "opinion";
```

The code retains `"out_of_scope"` internally as a claim classification type (in `ExtractedClaim.claimType`) but the verdict enum is strictly 5 values. Display logic maps `out_of_scope` claims to display text that says "Outside the Duterte ICC case" — this is presentation, not a verdict.

---

## Part 6 — Decomposition Stopping Rules

### 6.1 The Over-Splitting Problem

Without stopping rules, D-1 through D-6 can fragment coherent claims into trivial or redundant subclaims:

| Input | Bad Decomposition | Good Decomposition |
|-------|-------------------|-------------------|
| "Charged with murder as a crime against humanity" | 3 claims: "charged", "with murder", "classified as crime against humanity" | 1 claim: "Charged with murder as a crime against humanity" (this is a single legal charge, not a compound claim) |
| "The ICC issued a warrant on March 8, 2023" | 2 claims: "ICC issued a warrant", "The warrant was issued on March 8, 2023" | 1 claim: "The ICC issued a warrant on March 8, 2023" (date is a modifier, not a separate assertion) |
| "After being convicted, he was sentenced" | This IS 2 claims: "convicted" + "sentenced" | 2 claims (correct — these are two distinct procedural events) |

### 6.2 Stopping Rule: The Independent Verifiability Test

**Rule:** A subclaim is a valid decomposition product if and only if it is independently verifiable against ICC documents. If removing the subclaim from the original claim would leave both parts meaningful and independently checkable, decompose. If removing it produces a trivial or meaningless fragment, do not decompose.

Formalized as a prompt instruction:

```
DECOMPOSITION STOPPING RULE:
Only decompose when BOTH resulting subclaims are independently verifiable against ICC documents.
- "After being convicted, Duterte appealed" → SPLIT: "convicted" is independently verifiable, "appealed" is independently verifiable
- "Charged with murder as a crime against humanity" → DO NOT SPLIT: "murder" is a modifier of the charge, not a separate claim. "As a crime against humanity" is the legal classification, not a separate assertion.
- "The ICC issued a warrant on March 8, 2023" → DO NOT SPLIT: the date is a property of the warrant issuance, not a separate claim.
- "Duterte faces 15 counts and was sentenced to life" → SPLIT: "15 counts" and "sentenced to life" are independent assertions about different procedural facts.

DO NOT decompose:
- Adjective-noun pairs ("serious charges" → don't split "serious" from "charges")
- Date/location modifiers ("warrant issued on March 8" → don't split date from event)
- Legal classification modifiers ("murder as a crime against humanity" → single charge description)
- Quantifier-noun pairs ("three counts" → don't split "three" from "counts")
```

### 6.3 Decomposition Depth Limit

**Maximum depth: 1 level.** The extraction LLM performs one pass of decomposition. It does not recursively decompose the products of decomposition.

Example: "After being convicted and sentenced, Duterte appealed and was acquitted"
- Level 0 (input): 1 compound sentence
- Level 1 (decomposition): "Duterte was convicted", "Duterte was sentenced", "Duterte appealed", "Duterte was acquitted" — 4 claims
- Level 2 (would be recursive — NOT DONE): no further decomposition of "Duterte was convicted"

The 5-claim limit (CE-1) and depth-1 limit together prevent runaway fragmentation.

### 6.4 Over-Splitting Safeguard in Prompt

Add to the extraction prompt:
```
OVER-SPLITTING SAFEGUARD:
- A legal charge description is ONE claim, not multiple: "murder as a crime against humanity" = 1 claim
- An event with a date/location modifier is ONE claim: "arrested on March 11, 2025" = 1 claim
- Decompose ONLY when two genuinely independent assertions are joined (e.g., "convicted AND sentenced", "arrested AND tried")
- If in doubt, do NOT split — a slightly coarse claim is better than a trivially fragmented one
```

---

## Part 7 — Roadmap with Priority Levels

### Phase 1: Minimum Viable Correction (P0 — Blocks Launch)

| # | Change | Type | Files | TCs Fixed | Complexity |
|---|--------|------|-------|-----------|------------|
| 1.1 | Rewrite extraction prompt: add D-1–D-6 decomposition rules with stopping rules, S-1–S-7 stripping rules | Prompt-only | `fact-check.ts` | TC-26, TC-27, TC-28, TC-29, TC-32, TC-42, TC-47, TC-48, TC-50, TC-52, TC-58 | Medium |
| 1.2 | Rewrite verification prompt: FALSE vs UNVERIFIABLE examples, procedural stage reference, exclusivity/completeness instructions, no-hallucination grounding | Prompt-only | `fact-check.ts` | TC-30, TC-31, TC-33, TC-36, TC-41, TC-42 | Medium |
| 1.3 | Remove MISLEADING and PARTIALLY_VERIFIED from verdict enum | Deterministic | `fact-check.ts` | All structured output TCs | Low |
| 1.4 | Revise `computeOverallVerdict` for 5-enum | Deterministic | `fact-check.ts` | Overall verdict TCs | Low |
| 1.5 | Switch to JSON mode with quality-gate fallback | Deterministic + prompt | `fact-check.ts` | All parsing failure TCs | Medium |
| 1.6 | Add post-parse validation function | Deterministic | `fact-check.ts` | Missing field TCs | Low |

**Phase 1 total: 6 changes, ~18 TCs addressed, 0 new LLM calls, 2 files modified.**

### Phase 2: Robustification (P1 — Important)

| # | Change | Type | Files | TCs Fixed | Complexity |
|---|--------|------|-------|-----------|------------|
| 2.1 | Add deterministic prerequisite injection (post-extraction) | Deterministic | `fact-check.ts` | TC-32, TC-30, TC-31 | Medium |
| 2.2 | Add narrowed deterministic normalization function (authority attribution + comparison prefix only) | Deterministic | `fact-check.ts` | TC-52, TC-58 | Low |
| 2.3 | Update judge REJECT criteria (3 new structural checks) | Judge modification | `prompts.ts` | Catch-all for FC-2, FC-3 failures | Low |
| 2.4 | Add fabricated reference detection (regex vs chunk content) | Deterministic | `fact-check.ts` | TC-56 | Low |

**Phase 2 total: 4 changes, ~6 additional TCs hardened, 0 new LLM calls, 2 files modified.**

### Phase 3: Hardening (P2 — Nice to Have)

| # | Change | Type | Files | TCs Fixed | Complexity |
|---|--------|------|-------|-----------|------------|
| 3.1 | Add judge APPROVE criteria for correct prerequisite handling and completeness checks | Judge modification | `prompts.ts` | Reduces false REJECT rate | Low |
| 3.2 | Telemetry: log extraction decomposition count, verdict distribution, JSON parse success rate | Deterministic | `fact-check.ts` | No TCs — operational visibility | Low |
| 3.3 | Evaluate gpt-4o-mini vs gpt-4o for extraction based on Phase 1 production data | Evaluation | N/A | Decision point, not a code change | N/A |

---

## Part 8 — Updated Coverage Matrix (TC-26 to TC-58)

| TC | Failure Cat | Proposed Fix | Fix Type | Phase | Priority | Expected Result |
|----|------------|-------------|----------|-------|----------|----------------|
| TC-26 | FC-1: Extraction | D-2 (subordinate clauses) in extraction prompt | Prompt-only | 1 | P0 | "convicted" + "appealed" extracted as 2 claims, both FALSE |
| TC-27 | FC-1: Extraction | D-3 (conditional/causal) in extraction prompt | Prompt-only | 1 | P0 | Premise + conclusion extracted separately |
| TC-28 | FC-1: Extraction | S-3 (hedge stripping) in extraction prompt | Prompt-only | 1 | P0 | "reportedly" stripped, bare claim verified |
| TC-29 | FC-1: Extraction | S-3 (hedge stripping) in extraction prompt | Prompt-only | 1 | P0 | "many say" stripped, bare claim verified |
| TC-30 | FC-2: Verification | Procedural stage reference in verification prompt + prerequisite injection (Phase 2) | Prompt + Deterministic | 1+2 | P0 | Temporal claim FALSE when later stage not reached |
| TC-31 | FC-2: Verification | Procedural stage reference in verification prompt | Prompt-only | 1 | P0 | Sequence claim verified against procedural order |
| TC-32 | FC-1+2: Both | D-4 (prerequisites) in extraction + prerequisite injection (Phase 2) + implicit prerequisite instruction in verification | Prompt + Deterministic | 1+2 | P0 | "served sentence" → "sentenced" (FALSE) + "served" (FALSE) |
| TC-33 | FC-2: Verification | FALSE vs UNVERIFIABLE examples (numbers) in verification prompt | Prompt-only | 1 | P0 | "15 counts" vs "3 counts" → FALSE |
| TC-34 | FC-2: Verification | FALSE vs UNVERIFIABLE examples (ranges) in verification prompt | Prompt-only | 1 | P1 | Range claim compared against document number |
| TC-35 | FC-2: Verification | Verification prompt examples for approximations | Prompt-only | 1 | P1 | "Approximately N" handled via verification LLM judgment |
| TC-36 | FC-2: Verification | Completeness/exclusivity block in verification prompt | Prompt-only | 1 | P0 | Wrong article number → FALSE |
| TC-37 | FC-2: Verification | Completeness/exclusivity block in verification prompt | Prompt-only | 1 | P1 | Wrong evidentiary standard → FALSE |
| TC-38 | FC-2: Verification | Completeness/exclusivity block in verification prompt | Prompt-only | 1 | P1 | Complementarity misstatement → FALSE |
| TC-41 | FC-3: Framing | Exclusivity/completeness instruction in verification prompt | Prompt-only | 1 | P0 | "Every allegation proven" → FALSE (no trial yet) |
| TC-42 | FC-2+3: Both | D-6 (exclusivity) in extraction + completeness instruction in verification | Prompt-only | 1 | P0 | "Only imprisonment" → "charged with imprisonment" (VERIFIED) + "no other charges" (FALSE) |
| TC-47 | FC-1: Extraction | D-2/D-3/D-4 in extraction prompt + stopping rules | Prompt-only | 1 | P1 | Multi-layer claims decomposed to depth 1, max 5 |
| TC-48 | FC-3: Framing | S-3 (hedge stripping) in extraction prompt | Prompt-only | 1 | P0 | "In principle" stripped → "convicted" → FALSE |
| TC-50 | FC-1: Extraction | S-7 (double negation) in extraction prompt | Prompt-only | 1 | P1 | Double negative resolved → verified normally |
| TC-52 | FC-3: Framing | S-5 (authority attribution) in extraction + deterministic normalization (Phase 2) | Prompt + Deterministic | 1+2 | P0 | "ICC judges declared" stripped → claim verified independently |
| TC-56 | FC-3: Framing | Fabricated reference detection (Phase 2) + verification prompt instruction | Deterministic + Prompt | 1+2 | P1 | Fake filing number → NOT_IN_ICC_RECORDS |
| TC-58 | FC-3: Framing | S-6 (comparison stripping) in extraction + deterministic normalization (Phase 2) | Prompt + Deterministic | 1+2 | P0 | Comparison stripped → Duterte-only claim verified |

### Summary

| Phase | Changes | TCs Addressed | New LLM Calls | Complexity |
|-------|---------|--------------|---------------|------------|
| Phase 1 | 6 | ~18 primary | 0 | Medium |
| Phase 2 | 4 | ~6 additional (hardened) | 0 | Low-Medium |
| Phase 3 | 3 | Operational (no TC fixes) | 0 | Low |

### Minimal Intervention Classification Summary

| Fix Type | Count | Latency Impact |
|----------|-------|---------------|
| Prompt-only | 8 | Zero |
| Deterministic layer | 6 | Near-zero (regex/validation) |
| Retrieval modification | 0 | N/A |
| Judge modification | 2 | Zero (prompt change) |
| New LLM call | 0 | N/A |
