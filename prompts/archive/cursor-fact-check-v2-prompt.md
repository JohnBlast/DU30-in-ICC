# Cursor Implementation Prompt — Fact-Check Pipeline V2 (Constrained Revision)

> **Context:** You are modifying an existing fact-check pipeline for The Docket (Duterte ICC case fact-checker). The pipeline works but has failures in claim extraction, verification logic, framing resistance, and structured output consistency. This prompt describes the exact changes to make.
>
> **Read these before making any changes:**
> - `constitution.md` — non-negotiable principles
> - `nl-interpretation-fact-check-mode.md` — full fact-check mode spec
> - `fact-check-improvement-plan-v2.md` — root cause analysis and improvement plan (constrained revision)
> - `lib/fact-check.ts` — current implementation (PRIMARY file to modify)
> - `lib/prompts.ts` — judge prompt (SECONDARY file to modify)
>
> **Hard constraints:**
> - Do NOT weaken any guardrail (P-1 through P-24, R-1 through R-21)
> - Do NOT add new LLM calls — modify only the two existing ones (extraction and verification)
> - Do NOT add verdict types — the enum is strictly: `verified`, `false`, `unverifiable`, `not_in_icc_records`, `opinion`
> - Do NOT redesign the pipeline architecture
> - `lib/chat.ts` was already fixed in a prior session (claim extraction before retrieval, retrieval uses extracted claims as queries, redaction detection on pasted text). Do NOT modify `lib/chat.ts`.

---

## Step 1: Update the ClaimVerdict Type

**File:** `lib/fact-check.ts`

Find the `ClaimVerdict` type:
```typescript
export type ClaimVerdict =
  | "verified"
  | "false"
  | "misleading"
  | "unverifiable"
  | "not_in_icc_records"
  | "opinion"
  | "out_of_scope"
  | "partially_verified";
```

Replace with:
```typescript
export type ClaimVerdict =
  | "verified"
  | "false"
  | "unverifiable"
  | "not_in_icc_records"
  | "opinion";
```

**Why:** Strict 5-verdict enum. `misleading` and `partially_verified` are removed. `out_of_scope` is handled as a claim classification type, not a verdict — out-of-scope claims get verdict `"opinion"` with `evidenceType: "out_of_scope"` for display purposes.

---

## Step 2: Update normalizeVerdict for 5-Enum Compliance

**File:** `lib/fact-check.ts`

Find the `normalizeVerdict` function and replace it:

```typescript
/** Normalize LLM verdict strings to the strict 5-value enum */
function normalizeVerdict(v: string): ClaimVerdict {
  const normalized = v.toLowerCase().replace(/\s+/g, "_");
  // Map removed verdicts
  if (normalized === "accurate") return "verified";
  if (normalized === "misleading") return "false"; // Partial truth = FALSE; nuance goes in icc_says
  if (normalized === "partially_verified") return "unverifiable";
  if (normalized === "out_of_scope") return "opinion";
  const valid: ClaimVerdict[] = ["verified", "false", "unverifiable", "not_in_icc_records", "opinion"];
  return valid.includes(normalized as ClaimVerdict) ? (normalized as ClaimVerdict) : "unverifiable";
}
```

**Why:** If the verification LLM outputs MISLEADING (old prompt residue or hallucination), it maps to FALSE. PARTIALLY_VERIFIED maps to UNVERIFIABLE. OUT_OF_SCOPE maps to OPINION.

---

## Step 3: Update computeOverallVerdict for 5-Enum

**File:** `lib/fact-check.ts`

Find `computeOverallVerdict` and replace it:

```typescript
function computeOverallVerdict(claims: VerifiedClaim[]): ClaimVerdict {
  const verdicts = claims.map((c) => c.verdict);
  const factualVerdicts = verdicts.filter((v) => v !== "opinion");

  if (factualVerdicts.length === 0) return "opinion";
  if (factualVerdicts.includes("false")) return "false";
  if (factualVerdicts.every((v) => v === "verified")) return "verified";
  return "unverifiable";
}
```

**Why:** 4-line deterministic computation. No LLM-generated overall verdict. Rules:
- All factual claims VERIFIED → overall VERIFIED
- Any FALSE → overall FALSE
- Mix of VERIFIED + UNVERIFIABLE/NOT_IN_ICC_RECORDS → overall UNVERIFIABLE (content cannot be fully verified)
- All UNVERIFIABLE → overall UNVERIFIABLE
- All OPINION → overall OPINION

---

## Step 4: Rewrite the Claim Extraction System Prompt

**File:** `lib/fact-check.ts`
**Target:** The `CLAIM_EXTRACTION_SYSTEM` constant

Replace the entire constant with:

```typescript
const CLAIM_EXTRACTION_SYSTEM = `You extract, decompose, and classify statements from content about the Duterte ICC case.

For each statement in the input, classify it as one of:
- FACTUAL_CLAIM: A verifiable assertion about events, dates, numbers, charges, or procedural status
- OPINION: A value judgment, moral assessment, emotional expression, or prediction
- OUT_OF_SCOPE: Not related to the Duterte ICC case

STRIPPING RULES (apply BEFORE decomposition and classification):
S-1. Strip ALL emotional framing: "Duterte the murderer was convicted" → "Duterte was convicted"
S-2. Strip ALL source attributions: "According to Rappler, 30,000 were killed" → "30,000 were killed"
S-3. Strip ALL epistemic hedges: "reportedly", "allegedly", "in principle", "essentially", "technically", "many say", "it is believed", "perhaps", "some claim" → extract bare assertion. Example: "In principle, Duterte was convicted" → "Duterte was convicted"
S-4. Strip ALL certainty markers: "obviously", "clearly", "undeniably", "it is widely known that" → extract bare assertion
S-5. Strip ALL authority attributions used as credibility boosts: "ICC judges declared that X" → extract "X". The authority attribution is PART of what must be verified, not a reason to believe it.
S-6. Strip ALL embedded comparisons to other leaders/cases: "Like other ICC-convicted leaders, Duterte X" → extract "Duterte X". If entire input is about another case → OUT_OF_SCOPE.
S-7. Resolve double negatives to positive form: "It's not true that he was not charged" → "He was charged". "The ICC didn't fail to issue a warrant" → "The ICC issued a warrant"

DECOMPOSITION RULES (apply AFTER stripping):
D-1. COMMA/AND LISTS: "charged with murder, torture, and rape" → 3 claims: "charged with murder", "charged with torture", "charged with rape"
D-2. SUBORDINATE CLAUSES: "After being convicted, Duterte appealed" → 2 claims: "Duterte was convicted" + "Duterte appealed"
D-3. CONDITIONAL/CAUSAL CHAINS: "Since the ICC found him guilty, the Philippines must extradite him" → 2 claims: "The ICC found Duterte guilty" + "The Philippines must extradite Duterte"
D-4. IMPLICIT PREREQUISITES: "Duterte served part of his sentence" → 2 claims: "Duterte was sentenced" + "Duterte served part of his sentence". The prerequisite (sentencing) must be verified independently.
D-5. TEMPORAL SEQUENCES: "Duterte was arrested, tried, and convicted" → 3 claims preserving order
D-6. EXCLUSIVITY CLAIMS: "only charged with imprisonment" → 2 claims: "charged with imprisonment" + "no other charges exist"

DECOMPOSITION STOPPING RULES (prevent over-splitting):
- Only decompose when BOTH subclaims are independently verifiable against ICC documents
- DO NOT split a legal charge description: "murder as a crime against humanity" = 1 claim (single legal charge)
- DO NOT split date/location modifiers from their event: "warrant issued on March 8, 2023" = 1 claim
- DO NOT split adjective-noun pairs: "three counts of crimes against humanity" = 1 claim
- DO NOT split quantifier from noun: "15 counts" = 1 claim (verify the number against documents)
- Decomposition depth: ONE level only. Do not recursively decompose decomposition products.
- Maximum: 5 claims total per input (CE-1 limit)
- If in doubt, do NOT split — a coarse claim is better than a trivially fragmented one

CLASSIFICATION RULES:
- Guilt/innocence assertions ARE extracted as FACTUAL_CLAIM: "He is guilty" → FACTUAL_CLAIM (will verify procedural status)
- "He is a hero" → OPINION (value judgment)
- "The ICC is biased" → OPINION (evaluative)
- Rhetorical questions ("How dare they?") → OPINION
- Predictions ("He will be convicted") → OPINION
- Preserve specific numbers and dates exactly
- CRITICAL: NEVER return NO_CLAIMS if content mentions charges, counts, warrant, ICC, conviction, guilty, arrest, or any ICC proceeding. Such content ALWAYS contains extractable claims.

Output format — one per line:
FACTUAL_CLAIM: [neutral assertion after stripping and decomposition]
OPINION: [original opinion text]
OUT_OF_SCOPE: [text]

If ZERO factual claims AND ZERO opinions can be extracted, output: NO_CLAIMS`;
```

**What changed from the old prompt:**
- Added 7 stripping rules (S-1–S-7) covering hedges, qualifiers, authority attributions, comparisons, double negatives
- Expanded decomposition from 1 example to 6 rules (D-1–D-6)
- Added decomposition STOPPING RULES to prevent over-splitting
- Added depth-1 limit and independent verifiability test
- Moved classification to separate section

---

## Step 5: Add Deterministic Post-Extraction Functions

**File:** `lib/fact-check.ts`
**Location:** Add these functions AFTER the `ICC_CLAIM_INDICATORS` constant and BEFORE `buildFactCheckPrompt`

### 5a. Prerequisite Injection

```typescript
/**
 * Deterministic prerequisite detection: if a claim implies a later procedural
 * stage, inject the prerequisite claim so it gets independently verified.
 * Applied after extraction, before retrieval.
 */
const PROCEDURAL_PREREQUISITE_PATTERNS: Array<{ pattern: RegExp; prerequisiteClaim: string }> = [
  { pattern: /\b(served?|serving|completed?)\b.*\b(sentence|term|imprisonment)\b/i, prerequisiteClaim: "Duterte was sentenced by the ICC" },
  { pattern: /\b(appeal(?:ed|ing)?)\b.*\b(verdict|conviction|sentence|decision)\b/i, prerequisiteClaim: "A verdict or sentence was rendered by the ICC" },
  { pattern: /\b(acquit(?:ted|tal)?|exonerat)/i, prerequisiteClaim: "A trial was held and a verdict rendered by the ICC" },
  { pattern: /\b(pardon(?:ed)?|commut(?:ed|ation))/i, prerequisiteClaim: "A sentence was imposed by the ICC" },
  { pattern: /\b(retri(?:al|ed)|new trial|second trial)/i, prerequisiteClaim: "A first trial was completed at the ICC" },
];

function injectPrerequisiteClaims(claims: ExtractedClaim[]): ExtractedClaim[] {
  const result: ExtractedClaim[] = [];
  for (const c of claims) {
    if (c.claimType !== "factual_claim") {
      result.push(c);
      continue;
    }
    for (const pp of PROCEDURAL_PREREQUISITE_PATTERNS) {
      if (pp.pattern.test(c.extractedText)) {
        const alreadyPresent = claims.some(
          (existing) =>
            existing.claimType === "factual_claim" &&
            existing.extractedText.toLowerCase().includes(pp.prerequisiteClaim.slice(0, 25).toLowerCase())
        );
        if (!alreadyPresent) {
          result.push({ extractedText: pp.prerequisiteClaim, claimType: "factual_claim" });
        }
        break;
      }
    }
    result.push(c);
  }
  return result.slice(0, 5);
}
```

### 5b. Claim Normalization (Narrowed Scope)

```typescript
/**
 * Deterministic normalization: strip framing patterns that survive extraction
 * and could bias the verification LLM. Narrow scope — only two patterns that
 * reliably appear in LLM-reformulated text.
 * Applied after extraction, before verification prompt construction.
 */
function normalizeClaimForVerification(claim: string): string {
  let c = claim;
  // Strip authority attribution framing (when "that" follows)
  c = c.replace(
    /\b(ICC judges declared|the court confirmed|the prosecutor established|the chamber found|it has been officially stated)\s+that\s+/gi,
    ""
  );
  // Strip comparison framing
  c = c.replace(
    /\b(like other (leaders?|cases?|defendants?) (convicted|sentenced|charged) by the ICC|similar to the \w+ case),?\s*/gi,
    ""
  );
  // Clean up artifacts
  c = c.replace(/^[,;:\s]+/, "").replace(/\s{2,}/g, " ").trim();
  if (c.length > 0) c = c.charAt(0).toUpperCase() + c.slice(1);
  return c;
}
```

### 5c. Fabricated Reference Detection

```typescript
/**
 * Deterministic check: does a claim cite an ICC filing reference that does
 * not appear in the retrieved chunks? If so, override verdict to NOT_IN_ICC_RECORDS.
 */
const ICC_REFERENCE_PATTERN = /ICC-\d{2}\/\d{2}-\d{2}\/\d{2}[^\s,.)]*|No\.\s*ICC-[^\s,.)]+/gi;

function hasFabricatedReference(claim: string, chunks: RetrievalChunk[]): boolean {
  const refs = claim.match(ICC_REFERENCE_PATTERN);
  if (!refs || refs.length === 0) return false;
  const chunkText = chunks.map((c) => c.content).join(" ");
  return refs.some((ref) => !chunkText.includes(ref));
}
```

### 5d. Post-Parse Validation

```typescript
/**
 * Validate parsed verification output: ensure all fields conform to the
 * 5-value enum and have non-null required fields.
 */
function validateVerifiedClaim(c: VerifiedClaim): VerifiedClaim {
  const validVerdicts: ClaimVerdict[] = ["verified", "false", "unverifiable", "not_in_icc_records", "opinion"];
  return {
    ...c,
    verdict: validVerdicts.includes(c.verdict) ? c.verdict : "unverifiable",
    iccSays: c.iccSays || "Could not verify from retrieved ICC documents.",
    citationMarker: c.citationMarker || "",
    confidence: (["high", "medium", "low"] as const).includes(c.confidence as "high" | "medium" | "low")
      ? c.confidence
      : ("low" as const),
    evidenceType: c.evidenceType || "case_fact",
  };
}
```

---

## Step 6: Rewrite the Verification Prompt

**File:** `lib/fact-check.ts`
**Target:** The `buildFactCheckPrompt` function — replace the entire return template string.

```typescript
  return `You are a neutral fact-checker for The Docket. Verify the following claims ONLY against the ICC documents provided below.

CRITICAL RULES:
1. If the ICC DOCUMENTS section below is empty, respond with verdict UNVERIFIABLE for every claim.
2. Use ONLY the ICC documents provided below. NEVER use your training data, general knowledge, or assumptions. If a fact is not in the provided documents, it does not exist for this task.
3. If the ICC documents state a DIFFERENT number, date, charge, or fact than what the claim asserts, the verdict is FALSE — not UNVERIFIABLE.

VERDICT DEFINITIONS (5 verdicts only — use no others):
- VERIFIED: claim directly supported by the ICC documents below
- FALSE: claim directly contradicts the ICC documents below (including procedural impossibility and partial truths that misstate what documents say)
- UNVERIFIABLE: the ICC documents below contain NO relevant information about this topic at all
- NOT_IN_ICC_RECORDS: claim references specific facts, numbers, filing references, or hearing dates that do not appear in any document below

FALSE vs UNVERIFIABLE — THE CRITICAL DISTINCTION:
Use FALSE when documents CONTRADICT the claim (documents say something different):
- Claim: "15 counts" + Documents say "3 counts" → FALSE
- Claim: "sentenced to life" + Documents show case is at pre-trial → FALSE (procedural impossibility)
- Claim: "convicted" + Documents show confirmation stage → FALSE (later stage not yet reached)
- Claim: "charged with genocide" + Documents say "crimes against humanity" → FALSE
- Claim: "30,000 killed" + Documents say a different number → FALSE

Use UNVERIFIABLE when documents are SILENT (no information at all):
- Claim: "met witness X on date Y" + Documents say nothing about any meeting → UNVERIFIABLE
- Claim: "30,000 killed" + Documents mention no numbers on this topic → UNVERIFIABLE

PROCEDURAL STAGE REFERENCE:
ICC cases follow this sequence: preliminary examination → investigation → arrest warrant → surrender/arrest → confirmation of charges → trial → verdict → sentencing → appeal.
Determine the CURRENT stage from the documents below. If a claim asserts that an event from a LATER stage has occurred, the verdict is FALSE — the procedural sequence means it cannot have happened yet.
Example: If documents show the case is at "confirmation of charges," then claims about trial, conviction, sentencing, or appeal are all FALSE.

COMPLETENESS AND EXCLUSIVITY:
- Claims with "only", "solely", "just": verify that the stated item EXISTS in documents AND that NO OTHER items exist. If other items exist → FALSE.
- Claims with "all", "every", "none": verify completeness against the full set in documents. "All charges confirmed" requires checking every individual charge.
- Claims with specific article numbers, evidentiary standards, or legal terms: compare EXACTLY against documents. Wrong article number → FALSE. Wrong legal classification (e.g., "war crime" instead of "crime against humanity") → FALSE.

IMPLICIT PREREQUISITES:
If a claim presupposes a prior procedural event ("served sentence" presupposes sentencing, "appealed the verdict" presupposes a verdict), and the documents show that prior event has NOT occurred, the claim is FALSE.

GUILT/INNOCENCE CLAIMS:
- If a claim asserts guilt or conviction: verify procedural status ONLY
- NEVER say "he is not guilty" or "he is not innocent"
- ONLY state: "No verdict has been rendered" / "The case is at [stage]"

GROUNDING:
- ONLY cite facts from the ICC DOCUMENTS section below
- Do NOT introduce facts from your training data — no charges, dates, names, or numbers that don't appear in the documents below
- If you are unsure whether a detail is in the documents, re-read them before answering

${langNote}

ICC DOCUMENTS:
${chunksSection}

---
CLAIMS TO VERIFY:
${claimsList}

---
Respond in valid JSON format with per-claim verdicts only. Do NOT include an overall verdict — it is computed automatically.

{
  "claims": [
    {
      "claim_text": "[the claim]",
      "verdict": "VERIFIED|FALSE|UNVERIFIABLE|NOT_IN_ICC_RECORDS",
      "icc_says": "[what ICC documents state — one or two sentences. For FALSE verdicts, state what the documents actually say. For UNVERIFIABLE, state that documents contain no information on this topic.]",
      "citation_markers": ["[1]"],
      "evidence_type": "procedural_status|case_fact|legal_framework|timeline|numerical"
    }
  ],
  "citations": [
    {
      "marker": "[1]",
      "document_title": "[title from document metadata]",
      "date": "[date from document metadata]"
    }
  ]
}

IMPORTANT: Output ONLY valid JSON. No text before or after the JSON object.`;
```

**What changed:**
- Removed MISLEADING from verdict options (maps to FALSE)
- Removed overall verdict from LLM output (deterministic in code)
- Consolidated 7 verification blocks into 3: FALSE vs UNVERIFIABLE distinction, Completeness/Exclusivity, Implicit Prerequisites
- Added procedural stage reference
- Strengthened grounding instructions
- Reduced total instruction tokens (~400 vs ~800 in V1)

---

## Step 7: Rewrite the Response Parser and Integrate New Functions

**File:** `lib/fact-check.ts`
**Target:** The `generateFactCheckResponse` function. This is a significant rewrite of the function body.

Find the entire `generateFactCheckResponse` function and replace its body with:

```typescript
export async function generateFactCheckResponse(
  claims: ExtractedClaim[],
  chunks: RetrievalChunk[],
  pastedContentPreview: string,
  detectedLanguage: DetectedLanguage,
  responseLanguage: string
): Promise<{ answer: string; factCheck: FactCheckResult }> {
  const factualClaims = claims.filter((c) => c.claimType === "factual_claim");
  const opinionClaims = claims.filter((c) => c.claimType === "opinion");
  const oosClaims = claims.filter((c) => c.claimType === "out_of_scope");

  // Pre-labeled claims (no LLM verification needed)
  const opinionVerified: VerifiedClaim[] = opinionClaims.map((c) => ({
    extractedText: c.extractedText,
    originalText: c.originalText,
    verdict: "opinion" as ClaimVerdict,
    iccSays: null,
    citationMarker: "",
    confidence: "high" as const,
    evidenceType: "opinion",
  }));

  // Out-of-scope claims get verdict "opinion" for enum compliance, evidenceType "out_of_scope" for display
  const oosVerified: VerifiedClaim[] = oosClaims.map((c) => ({
    extractedText: c.extractedText,
    originalText: c.originalText,
    verdict: "opinion" as ClaimVerdict,
    iccSays: null,
    citationMarker: "",
    confidence: "high" as const,
    evidenceType: "out_of_scope",
  }));

  let verifiedClaims: VerifiedClaim[] = [...opinionVerified, ...oosVerified];

  if (factualClaims.length > 0 && chunks.length > 0) {
    // Apply deterministic prerequisite injection
    const withPrerequisites = injectPrerequisiteClaims(factualClaims);

    // Normalize claims to strip framing patterns before verification
    const normalizedClaims = withPrerequisites.map((c) => ({
      ...c,
      extractedText: normalizeClaimForVerification(c.extractedText),
    }));

    const prompt = buildFactCheckPrompt(normalizedClaims, chunks, responseLanguage);
    const openai = getOpenAIClient();

    // Primary: JSON mode
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a neutral fact-checker. Respond ONLY in valid JSON format." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1500,
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const rawAnswer = res.choices[0]?.message?.content?.trim() ?? "";

    // Parse JSON response
    const factualVerified: VerifiedClaim[] = [];
    let parseSucceeded = false;
    try {
      const jsonStr = rawAnswer.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      const parsed = JSON.parse(jsonStr);

      if (parsed.claims && Array.isArray(parsed.claims)) {
        for (const pc of parsed.claims) {
          factualVerified.push(
            validateVerifiedClaim({
              extractedText: pc.claim_text ?? "",
              verdict: normalizeVerdict(pc.verdict ?? "unverifiable"),
              iccSays: (pc.icc_says ?? "").trim(),
              citationMarker: Array.isArray(pc.citation_markers) ? pc.citation_markers.join(", ") : "",
              confidence: "high",
              evidenceType: pc.evidence_type ?? "case_fact",
            })
          );
        }
        parseSucceeded = factualVerified.length > 0;
      }
    } catch {
      logEvent("fact_check.json_parse_failure", "warn", { raw_length: rawAnswer.length });
    }

    // Quality gate: if JSON parse failed or all UNVERIFIABLE despite non-empty chunks, fall back to regex
    if (!parseSucceeded || (factualVerified.length > 0 && factualVerified.every((c) => c.verdict === "unverifiable") && chunks.length >= 2)) {
      if (!parseSucceeded) {
        logEvent("fact_check.fallback_regex", "warn", { reason: "json_parse_failed" });
      } else {
        logEvent("fact_check.fallback_regex", "warn", { reason: "all_unverifiable_quality_gate" });
        factualVerified.length = 0; // Clear and retry with regex parse
      }

      // Regex fallback on the same rawAnswer
      const claimRegex =
        /\d+\.\s*"([^"]+)"\s*[—–-]\s*(VERIFIED|FALSE|MISLEADING|UNVERIFIABLE|NOT_IN_ICC_RECORDS)\.\s*ICC documents state:\s*([^[\]]+?)\.\s*\[?(\d+)\]?/gi;
      let m;
      while ((m = claimRegex.exec(rawAnswer)) !== null) {
        factualVerified.push(
          validateVerifiedClaim({
            extractedText: m[1],
            verdict: normalizeVerdict(m[2]),
            iccSays: m[3].trim(),
            citationMarker: `[${m[4]}]`,
            confidence: "high",
            evidenceType: "case_fact",
          })
        );
      }
    }

    // Apply fabricated reference detection
    for (const fv of factualVerified) {
      if (hasFabricatedReference(fv.extractedText, chunks) && fv.verdict !== "false") {
        fv.verdict = "not_in_icc_records";
        fv.iccSays = "This filing reference does not appear in retrieved ICC documents.";
      }
    }

    // Final fallback: if still no parsed claims, mark all as unverifiable
    if (factualVerified.length === 0) {
      for (const c of factualClaims) {
        factualVerified.push(
          validateVerifiedClaim({
            extractedText: c.extractedText,
            originalText: c.originalText,
            verdict: "unverifiable" as ClaimVerdict,
            iccSays: "Could not verify from retrieved ICC documents.",
            citationMarker: "",
            confidence: "low" as const,
            evidenceType: "case_fact",
          })
        );
      }
    }

    verifiedClaims = [...opinionVerified, ...oosVerified, ...factualVerified];
  }

  // Deterministic overall verdict
  const overallVerdict = computeOverallVerdict(verifiedClaims);
  const preview = pastedContentPreview.slice(0, 100) + (pastedContentPreview.length > 100 ? "…" : "");

  const factCheck: FactCheckResult = {
    overallVerdict,
    pastedContentPreview: preview,
    detectedLanguage,
    claims: verifiedClaims,
    copyText: "",
    mode: "fact_check",
    inputPreview: preview,
  };

  factCheck.copyText = formatCopyText(factCheck);

  // Build answer text for display
  const verdictLabel = overallVerdict.toUpperCase().replace(/_/g, " ");
  let answer = `VERDICT: ${verdictLabel}\n\n`;
  for (const c of verifiedClaims) {
    const v = c.verdict.toUpperCase().replace(/_/g, " ");
    if (c.verdict === "opinion" && c.evidenceType === "out_of_scope") {
      answer += `• "${c.extractedText}" — OUT OF SCOPE. Outside the Duterte ICC case.\n`;
    } else if (c.verdict === "opinion") {
      answer += `• "${c.extractedText}" — OPINION. Not a verifiable factual claim.\n`;
    } else {
      answer += `• "${c.extractedText}" — ${v}. ICC documents state: ${c.iccSays ?? "N/A"}\n`;
    }
  }
  answer += `\nLast updated from ICC records: ${new Date().toISOString().slice(0, 10)}`;

  return { answer, factCheck };
}
```

---

## Step 8: Wire Prerequisite Injection Into chat.ts extractClaims Flow

**File:** `lib/fact-check.ts`
**Target:** The `extractClaims` function does NOT need changes — prerequisite injection happens inside `generateFactCheckResponse` (Step 7) after extraction and before verification. This keeps extraction clean and adds prerequisites as a deterministic post-processing step.

No changes needed to `extractClaims`.

---

## Step 9: Update the Judge Prompt

**File:** `lib/prompts.ts`
**Target:** The `JUDGE_SYSTEM_PROMPT` constant

### 9a. Update verdict references

Find all occurrences of `MISLEADING` in the judge prompt and update them. Specifically, find:
```
- (Fact-check) Correct FALSE/MISLEADING verdicts match retrieved chunk content
```
Replace with:
```
- (Fact-check) Correct FALSE verdicts match retrieved chunk content (contradicted by documents)
```

Also find:
```
- (Fact-check) Correct UNVERIFIABLE when no ICC support found
```
Keep this unchanged.

Also find:
```
- (Fact-check) MISLEADING overall when mix of true/false claims
```
Replace with:
```
- (Fact-check) Overall verdict is FALSE when any per-claim verdict is FALSE
```

### 9b. Add new REJECT criteria

Find this line in the REJECT section:
```
- (Fact-check) Compound claims are blanket-approved or blanket-denied instead of individually evaluated
```

Add these lines immediately AFTER it:
```
- (Fact-check) Claims presupposing prior events (e.g., "served sentence") labeled UNVERIFIABLE when the procedural prerequisite has not occurred — should be FALSE
- (Fact-check) Numerical claim labeled UNVERIFIABLE when documents contain a contradicting number — should be FALSE
- (Fact-check) Response introduces charges, dates, numbers, or details not found in any retrieved chunk (hallucination from training data)
```

### 9c. Add new APPROVE criteria

Find this line in the APPROVE section:
```
- (Fact-check) Per-claim structure maintained — compound claims decomposed
```

Add after it:
```
- (Fact-check) Procedural stage claims correctly compared against case timeline — later-stage events marked FALSE when current stage is earlier
- (Fact-check) Exclusivity claims ("only X") checked for completeness — both presence of X and absence of other items verified
```

---

## Step 10: Update Display Logic for out_of_scope Mapping

**File:** `lib/fact-check.ts`
**Target:** The `formatCopyText` function

Find the display logic for out_of_scope:
```typescript
    if (c.verdict === "opinion") {
      lines.push(`• "${c.extractedText}" — ${v}. Not a verifiable factual claim.`);
    } else if (c.verdict === "out_of_scope") {
      lines.push(`• "${c.extractedText}" — ${v}. Outside the Duterte ICC case.`);
```

Replace with:
```typescript
    if (c.verdict === "opinion" && c.evidenceType === "out_of_scope") {
      lines.push(`• "${c.extractedText}" — OUT OF SCOPE. Outside the Duterte ICC case.`);
    } else if (c.verdict === "opinion") {
      lines.push(`• "${c.extractedText}" — OPINION. Not a verifiable factual claim.`);
```

**Why:** `out_of_scope` is no longer a verdict value — it's a claim with verdict `opinion` and `evidenceType: "out_of_scope"`. Display logic uses `evidenceType` to distinguish.

---

## Step 11: Update chat.ts References to Removed Verdicts

**File:** `lib/chat.ts`

Search for any references to `"out_of_scope"` as a ClaimVerdict value (not as a claimType). The `out_of_scope` claim classification type is still valid in `ExtractedClaim.claimType` — only the verdict enum changed.

Check the pure-opinion return block in chat.ts. Find:
```typescript
      verdict: "out_of_scope" as ClaimVerdict,
```

Replace with:
```typescript
      verdict: "opinion" as ClaimVerdict,
```

And ensure the `evidenceType` is set to `"out_of_scope"` in that same object (it already should be from the existing code).

Also check the `overallVerdict` assignment in the pure-opinion block:
```typescript
        overallVerdict: "opinion" as ClaimVerdict,
```
This is already correct — no change needed.

---

## Step 12: Verify TypeScript Compilation

After all changes, run:
```bash
npx tsc --noEmit
```

The main areas to check:
- `ClaimVerdict` type no longer includes `"misleading"`, `"out_of_scope"`, or `"partially_verified"` — search for any code that assigns these values and update
- `normalizeVerdict` maps old values to new ones — ensure all callers work
- `response_format` parameter — ensure OpenAI SDK version supports `{ type: "json_object" }`
- `injectPrerequisiteClaims` and other new functions are used before export boundaries

---

## Summary of Changes

| File | Changes | Type |
|------|---------|------|
| `lib/fact-check.ts` | ClaimVerdict type (5 values), normalizeVerdict, computeOverallVerdict, extraction prompt rewrite, 4 new deterministic functions, verification prompt rewrite, parser rewrite with JSON + fallback + quality gate, display logic update | Prompt + Deterministic |
| `lib/prompts.ts` | 3 new REJECT criteria, 2 new APPROVE criteria, MISLEADING references removed | Judge modification |
| `lib/chat.ts` | `"out_of_scope"` verdict references → `"opinion"` | Deterministic (enum compliance) |

## New LLM Calls: 0
## New Dependencies: 0
## Estimated Latency Impact: Near-zero (deterministic regex/validation functions only)

## Verification Checklist

After implementation, test:

1. **TC-26** "After being convicted, Duterte appealed" → 2 claims extracted, both FALSE
2. **TC-32** "Duterte served part of his sentence" → prerequisite injected: "sentenced" (FALSE) + "served" (FALSE)
3. **TC-42** "Only charged with imprisonment" → 2 claims: "charged with imprisonment" (VERIFIED) + "no other charges" (FALSE)
4. **TC-48** "In principle, Duterte was convicted" → hedge stripped → "convicted" → FALSE
5. **TC-52** "ICC judges declared him guilty" → attribution stripped → FALSE
6. **TC-33** "Duterte faces 15 counts" → compared against DCC → FALSE
7. **TC-56** Fabricated filing number → detected by regex → NOT_IN_ICC_RECORDS
8. **TC-58** "Like other ICC-convicted leaders, Duterte was sentenced" → comparison stripped → FALSE
9. JSON output parses correctly; MISLEADING from LLM maps to FALSE
10. Overall verdict is deterministic: any FALSE → overall FALSE
11. `ClaimVerdict` type has exactly 5 values — no TypeScript errors
12. `out_of_scope` claims display correctly as "OUT OF SCOPE" despite having verdict `opinion`
