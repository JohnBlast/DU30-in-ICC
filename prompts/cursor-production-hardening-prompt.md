# Cursor Implementation Prompt — Production Hardening

> **Status**: ✅ ALL PHASES IMPLEMENTED (2026-03-02)
>
> **Context**: P0 + P1 fixes from `prompts/production-hardening-blueprint.md` for The Docket, an ICC legal Q&A + fact-checking system.
>
> **Architecture reference**: `prompts/system-review-for-llm.md` (updated to reflect all changes)
>
> **Constraint**: Do not restructure the pipeline. Modify existing files. Follow the spec exactly.

---

## Implementation Order (follow sequentially — do not skip ahead)

### Phase 1: Attribution Engine Upgrade (P0)

**File**: `lib/attribution-verifier.ts`

**Task 1.1**: Replace `CAUSAL_VERBS` with expanded verb taxonomy.

Add these patterns to the module:

```typescript
const CAUSAL_VERB_PATTERNS: RegExp[] = [
  /\b(ordered|directed|authorized|commanded|instructed|oversaw|approved|sanctioned|endorsed|masterminded|orchestrated|initiated)\b/i,
  /\b(bore\s+responsibility\s+for|was\s+responsible\s+for|presided\s+over)\b/i,
  /\b(carried\s+out\s+under|at\s+the\s+(direction|behest|order)\s+of|on\s+(the\s+)?orders?\s+of)\b/i,
  /\b(aided\s+and\s+abetted|contributed\s+to|facilitated|had\s+(effective\s+)?command\s+(and\s+control\s+)?over)\b/i,
];
```

Update `hasCausalAttributionStructure()` to check against all patterns in `CAUSAL_VERB_PATTERNS` instead of the single `CAUSAL_VERBS` regex.

**Task 1.2**: Replace chunk-level co-occurrence with 3-sentence-window co-occurrence.

Replace the `chunkSupportsCausalAttribution` function with:

```typescript
function sentenceWindowCooccurrence(
  chunkContent: string,
  actorPattern: RegExp,
  verbPatterns: RegExp[],
  actPattern: RegExp,
  windowSize: number = 3
): boolean {
  const sentences = chunkContent.split(/(?<=[.!?])\s+/);
  for (let i = 0; i <= sentences.length - 1; i++) {
    const window = sentences.slice(i, i + windowSize).join(" ");
    const hasActor = actorPattern.test(window);
    const hasVerb = verbPatterns.some(p => p.test(window));
    const hasAct = actPattern.test(window);
    if (hasActor && hasVerb && hasAct) return true;
  }
  return false;
}
```

Update `chunkSupportsCausalAttribution` to use `sentenceWindowCooccurrence`:

```typescript
function chunkSupportsCausalAttribution(claim: string, chunkContent: string): boolean {
  return sentenceWindowCooccurrence(
    chunkContent,
    ACTOR_PATTERNS,
    CAUSAL_VERB_PATTERNS,
    HARMFUL_ACTS,
    3
  );
}
```

**Task 1.3**: Add allegation-source compound check.

Add a new exported function:

```typescript
const ALLEGATION_CONTEXT_VERBS = /\b(alleges?|argues?|submits?|contends?|claims?|according\s+to\s+the\s+(prosecution|OTP|defence|defense))\b/i;

export function isAllegationContextAttribution(
  claim: string,
  chunk: RetrievalChunk
): boolean {
  if (!hasCausalAttributionStructure(claim)) return false;
  const docType = (chunk.metadata.document_type ?? "").toLowerCase();
  if (docType !== "transcript" && docType !== "filing") return false;
  
  const sentences = chunk.content.split(/(?<=[.!?])\s+/);
  for (let i = 0; i < sentences.length; i++) {
    const window = sentences.slice(i, i + 3).join(" ");
    const hasAttribution = sentenceWindowCooccurrence(
      window, ACTOR_PATTERNS, CAUSAL_VERB_PATTERNS, HARMFUL_ACTS, 3
    );
    if (hasAttribution && ALLEGATION_CONTEXT_VERBS.test(window)) {
      return true;
    }
  }
  return false;
}
```

Import `RetrievalChunk` type from `./retrieve`.

**Task 1.4**: Update `enforceAttributionVerification` to use allegation compound check.

After the existing `anySupports` check, add:

```typescript
if (anySupports) {
  const anyAllegation = citedChunks.some(c => isAllegationContextAttribution(claim, c));
  if (anyAllegation) return "unverifiable";
  return verdict;
}
```

**Verification**: Run `npm run verify-adversarial-safeguards`. Manually test:
- "Duterte ordered the killings" with actor and harm in separate chunks → UNVERIFIABLE
- Same claim with co-occurrence in decision document → VERIFIED

---

### Phase 2: Judge Refactor — Layer 1 Deterministic Checks (P0)

**File**: Create `lib/deterministic-judge.ts`

Implement Layer 1 deterministic checks that run BEFORE the LLM Judge:

```typescript
import type { RetrievalChunk } from "./retrieve";

export interface DeterministicJudgeResult {
  pass: boolean;
  reason?: string;
  warnings: string[];
}

const PROHIBITED_PATTERNS = [
  { pattern: /\b(he|duterte|du30)\s+(is|was)\s+(guilty|innocent|convicted|acquitted)\b/i, label: "guilt/innocence" },
  { pattern: /\b(murderer|tyrant|hero|saint|villain)\b/i, label: "loaded characterization" },
  { pattern: /\b(witch\s+hunt|persecution|justice\s+served)\b/i, label: "politically loaded term" },
];

const FACT_CHECK_EXEMPT_PATTERNS = [
  /\b(FALSE|indicate\s+otherwise|UNVERIFIABLE|OPINION|NOT\s+IN\s+ICC|no\s+verdict\s+has\s+been\s+rendered)\b/i,
  /\bprocedural\s+status\b/i,
];

export function runDeterministicJudge(
  answer: string,
  chunks: RetrievalChunk[],
  isFactCheck: boolean
): DeterministicJudgeResult {
  const warnings: string[] = [];

  // 1. Prohibited terms (exempt fact-check refutation lines)
  for (const { pattern, label } of PROHIBITED_PATTERNS) {
    const match = answer.match(pattern);
    if (match) {
      const line = getLineContaining(answer, match.index ?? 0);
      const isExempt = isFactCheck && FACT_CHECK_EXEMPT_PATTERNS.some(p => p.test(line));
      if (!isExempt) {
        return { pass: false, reason: `Prohibited term: ${label} ("${match[0]}")`, warnings };
      }
    }
  }

  // 2. Citation bounds
  const citationRefs = [...answer.matchAll(/\[(\d+)\]/g)].map(m => parseInt(m[1], 10));
  for (const ref of citationRefs) {
    if (ref < 1 || ref > chunks.length) {
      return { pass: false, reason: `Invalid citation [${ref}] — only ${chunks.length} chunks available`, warnings };
    }
  }

  // 3. [REDACTED] content in answer (not in citations or quoted chunks)
  const answerWithoutCitations = answer.replace(/\[\d+\]/g, "");
  if (/\bredacted\s+(name|person|witness|individual|identity)/i.test(answerWithoutCitations)) {
    return { pass: false, reason: "Answer references redacted content", warnings };
  }

  return { pass: true, warnings };
}

function getLineContaining(text: string, index: number): string {
  const before = text.lastIndexOf("\n", index);
  const after = text.indexOf("\n", index);
  return text.slice(before === -1 ? 0 : before, after === -1 ? text.length : after);
}
```

**File**: `lib/chat.ts`

At the point where `judgeAnswer()` is called, insert deterministic judge first:

```typescript
import { runDeterministicJudge } from "./deterministic-judge";

// Before calling LLM Judge:
const deterministicResult = runDeterministicJudge(answer, chunks, isFactCheck);
if (!deterministicResult.pass) {
  logEvent("judge.deterministic_reject", "warn", { reason: deterministicResult.reason });
  // Return rejected response (same as current Judge REJECT handling)
  return { /* blocked response */ };
}
// Then proceed to LLM Judge with reduced prompt
```

**File**: `lib/prompts.ts`

Replace `JUDGE_SYSTEM_PROMPT` with a reduced-scope version. Keep the existing variable name but shorten the content to approximately:

```
You are a verification judge for The Docket, a neutral ICC case Q&A application.

You receive: the generated answer + retrieved ICC document chunks.

IMPORTANT: Prohibited terms, citation bounds, and redaction checks are handled separately. You only need to evaluate:

REJECT the answer ONLY if:
1. A factual claim in the answer is NOT supported by any retrieved chunk (reasonable paraphrasing is OK)
2. Content from a transcript or filing is presented as a court ruling (e.g., "The Court found..." when source is prosecution argument)
3. The answer expresses opinion on guilt/innocence or uses politically loaded language not caught by automated checks
4. The answer references information clearly not from the provided chunks

APPROVE the answer if:
- Factual claims trace to chunk content (paraphrasing acceptable)
- Tone is neutral
- Transcript/filing sources are properly framed as argument/testimony, not court findings
- Synthesized descriptions from contextual mentions across chunks are acceptable

Err on the side of APPROVE. Default to APPROVE. Only REJECT if CERTAIN of a violation.

FACT-CHECK SPECIFIC:
- When verdict is FALSE: The answer correctly refutes the user's claim. Do NOT reject for "contradicts chunks" — the answer IS supposed to contradict the user's claim.
- When verdict is UNVERIFIABLE: The answer states documents contain no information. Do NOT reject for "unsupported."
- Party/counsel statements labeled OPINION (e.g., "Kaufman claimed X") — APPROVE.

Respond: APPROVE or REJECT
Reason: one sentence.
```

**Verification**: Run `npm run run-real-world-factchecks`. Pass rate should stay ≥ 12/15 (ideally improve to 13–14/15 with reduced false rejections).

---

### Phase 3: Multi-Turn Contamination Guard Expansion (P0)

**File**: `lib/contamination-guard.ts`

Replace the `USER_FACT_PATTERNS` array with an expanded version:

```typescript
const USER_FACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\b\d{3,}\s*(killed|died|victims|people|casualties|dead|deaths?)\b/gi,
    replacement: "[User-stated number — omitted from context]",
  },
  {
    pattern: /\b(approximately|around|about|at least|over|more than)?\s*\d{3,}\b(?=\s*(drug|kill|victim|people|death|case|warrant|count|charge))/gi,
    replacement: "[User-stated number — omitted from context]",
  },
  {
    pattern: /\b(given that|since|because|considering that)\s+[^,]+\b(killed|died|victims|convicted|sentenced|guilty|ordered)\b[^,]*/gi,
    replacement: "[User-stated premise — omitted from context]",
  },
  {
    pattern: /\b(according to|sources say|it is known that|everyone knows|it has been reported|as we know|as established)\s+[^.!?]+[.!?]?/gi,
    replacement: "[User-stated claim — omitted from context]",
  },
  {
    pattern: /\b(duterte|du30|the president|he)\s+(ordered|authorized|directed|commanded|instructed)\b[^.!?]*/gi,
    replacement: "[User-stated claim — omitted from context]",
  },
  {
    pattern: /\b(duterte|du30)\s+(is|was)\s+(guilty|innocent|convicted|acquitted)\b/gi,
    replacement: "[User-stated claim — omitted from context]",
  },
  {
    pattern: /\b(there were|there are|there have been)\s+\d{3,}\s+\w+/gi,
    replacement: "[User-stated claim — omitted from context]",
  },
];
```

Verify that `sanitizeHistoryForContamination` is called in `lib/chat.ts` BEFORE `sanitizeHistory` (the redaction sanitizer). Check the pipeline order:

```
conversationHistory → sanitizeHistoryForContamination → sanitizeHistory (redaction) → buildSystemPrompt
```

If it's not already in this order, fix the call order.

**Verification**: Create a test scenario:
- Turn 1: "30,000 were killed in the drug war"
- Turn 2: "Is that number accurate?"
- Check that history passed to LLM does not contain "30,000"

---

### Phase 4: Normative Filter Expansion (P0)

**File**: `lib/normative-filter.ts`

Add new patterns to `NORMATIVE_PATTERNS`:

```typescript
const NORMATIVE_PATTERNS = [
  // Existing patterns (keep all)
  /\b(is|are|was|were)\s+(the\s+)?(icc|duterte|case)\s+(hypocritical|justified|right|wrong|fair|biased|legitimate)\b/i,
  /\b(violation of sovereignty|illegal|unlawful)\s*\??\s*$/i,
  /\bis\s+(duterte|he)\s+(a\s+)?(hero|villain|tyrant|saint|murderer)\b/i,
  /\b(should|ought|must)\s+(the\s+)?(icc|philippines|duterte)\b/i,
  /\b(do\s+you\s+think|what\s+do\s+you\s+think|in\s+your\s+opinion|what'?s?\s+your\s+(opinion|take))\b/i,
  /\b(morally|ethically)\s+(right|wrong|justified)\b/i,
  /\b(justified|unjustified)\s+(in|to)\b/i,
  /\bdeserves?\s+(to\s+)?(be\s+)?(convicted|punished|freed)\b/i,
  // NEW patterns
  /\b(objectively|honestly|realistically|truthfully)\s+(speaking\s*,?\s*)?(is|was|are|were|do|does|did)\b/i,
  /\b(would\s+you\s+agree|don'?t\s+you\s+think|wouldn'?t\s+you\s+say|isn'?t\s+it\s+(true|obvious|clear))\b/i,
  /\b(is\s+it\s+(a\s+)?fact\s+that)\s+.*(biased|political|illegal|unfair|hypocritical|corrupt)/i,
  /\b(more|less)\s+(effective|fair|biased|corrupt|legitimate)\s+than\b/i,
  /\bhow\s+can\s+(the\s+)?(icc|court)\s+(justify|claim|pretend|dare)\b/i,
  /\b(interference|meddling|neo-?colonial|imperial)\s+(in|with|of)\s+(philippine|filipino|our|the)\b/i,
];
```

Add new exception to `FACTUAL_PROCEDURAL_OK`:

```typescript
const FACTUAL_PROCEDURAL_OK = [
  // Existing (keep all)
  /\bdoes\s+(article|rule)\s+\d+\s+apply\b/i,
  /\bwhat\s+does\s+the\s+(rome\s+statute|icc)\s+say\s+about\b/i,
  /\bis\s+(the\s+deferral|it)\s+(granted|approved|admissible)\b/i,
  /\bwas\s+(the\s+deferral|it)\s+(granted|approved|rejected)\b/i,
  // NEW exception: asking what parties argued
  /\b(did|does|has)\s+(the\s+)?(defence|defense|philippines|prosecution)\s+(argue|claim|contend|submit)\s+that\b/i,
];
```

**Verification**: Test these queries:
- "Objectively speaking, was the ICC biased?" → normative rejection
- "Did the Philippines argue the ICC was biased?" → allowed (factual)
- "How can the ICC justify this case?" → normative rejection
- "What does the Rome Statute say about jurisdiction?" → allowed

---

### Phase 5: Glossary Chunk Injection (P0)

**File**: Create `scripts/ingest-glossary.ts`

Create a script that ingests synthetic glossary chunks. The chunks should be embedded and stored exactly like regular document chunks but with `document_type: "glossary"` and `rag_index: 2`.

Define these glossary entries (at minimum):

1. **Oplan Tokhang** — Philippine National Police anti-drug campaign, door-to-door operations, 2016, related to charges
2. **Davao Death Squad (DDS)** — Alleged extrajudicial killing group in Davao City, linked to Duterte's mayorship, referenced in ICC charges
3. **Project Double Barrel** — PNP anti-drug framework with supply reduction + demand reduction, referenced in ICC documents
4. **EJK / Extrajudicial killings** — Killings outside judicial process, central to ICC charges against Duterte
5. **Nanlaban** — "Fought back" — police justification for lethal force, referenced in ICC proceedings
6. **Salvaging** — Filipino slang for extrajudicial killing, used in ICC context
7. **DCC (Document Containing the Charges)** — ICC pre-trial document specifying charges against the accused
8. **OPCV** — Office of Public Counsel for Victims, represents victim interests at ICC
9. **OTP** — Office of the Prosecutor, ICC prosecution arm
10. **Confirmation of Charges** — ICC pre-trial hearing where judge decides if case goes to trial
11. **Article 7 Rome Statute** — Defines crimes against humanity
12. **Article 15 Rome Statute** — Prosecutor's proprio motu investigation authority
13. **Article 18 Rome Statute** — Preliminary rulings on admissibility, deferral mechanism
14. **Complementarity** — ICC only acts when domestic courts unwilling/unable to prosecute
15. **In absentia** — Proceedings without the accused present

Each entry should be ~200–400 words, rich in synonyms and related terms to serve as embedding anchors.

Create the glossary document in `icc_documents` with:
- `title`: "The Docket — Domain Glossary (System-Generated)"
- `document_type`: "glossary"
- `rag_index`: 2
- `date_published`: current date
- `url`: null

Then chunk and embed each entry as a separate chunk.

Add a script command in `package.json`:
```json
"ingest-glossary": "tsx scripts/ingest-glossary.ts"
```

**Verification**: After running `npm run ingest-glossary`, test:
- `npm run check-retrieval -- "What is Tokhang?"` — should return glossary chunk + FTS chunks
- Vector count (`vec_count`) should be > 0 for drug war terms

---

### Phase 6: Deterministic Decomposition D2/D3 (P1)

**File**: `lib/fact-check.ts`

Add these functions near the existing `decomposeCommaList`:

```typescript
const SUBORDINATE_PATTERNS = [
  /^(after|before|when|once|upon)\s+(.{15,}?),\s+(.{15,})$/i,
  /^(.{15,}?)\s+(after|before|when|once)\s+(.{15,})$/i,
];

function decomposeSubordinate(claim: ExtractedClaim): ExtractedClaim[] {
  if (claim.claimType !== "factual_claim") return [claim];
  for (const p of SUBORDINATE_PATTERNS) {
    const m = claim.extractedText.match(p);
    if (m) {
      const [_, _connector, part1, part2] = m;
      const parts = [part1.trim(), part2.trim()].filter(s => s.length >= 15);
      if (parts.length === 2) {
        return parts.map(t => ({
          ...claim,
          extractedText: t.charAt(0).toUpperCase() + t.slice(1),
        }));
      }
    }
  }
  return [claim];
}

const CAUSAL_CHAIN_PATTERNS = [
  /^(since|because|as)\s+(.{15,}?),\s+(.{15,})$/i,
  /^(.{15,}?)\s+(so|therefore|thus|hence)\s+(.{15,})$/i,
];

function decomposeCausalChain(claim: ExtractedClaim): ExtractedClaim[] {
  if (claim.claimType !== "factual_claim") return [claim];
  for (const p of CAUSAL_CHAIN_PATTERNS) {
    const m = claim.extractedText.match(p);
    if (m) {
      const parts = [m[2].trim(), m[3].trim()].filter(s => s.length >= 15);
      if (parts.length === 2) {
        return parts.map(t => ({
          ...claim,
          extractedText: t.charAt(0).toUpperCase() + t.slice(1),
        }));
      }
    }
  }
  return [claim];
}
```

Update the decomposition pipeline where `decomposeCommaList` is called (currently around line 449):

```typescript
let result = claims
  .flatMap(decomposeCommaList)
  .flatMap(decomposeSubordinate)
  .flatMap(decomposeCausalChain)
  .slice(0, 5);
```

**Verification**: Test these inputs:
- "After being convicted, Duterte appealed" → 2 claims: "Being convicted" (or similar) + "Duterte appealed"
- "Since the ICC found him guilty, the Philippines must extradite him" → 2 claims

---

### Phase 7: Judge Model Upgrade (P1)

**File**: `lib/chat.ts` or wherever `judgeAnswer` makes the OpenAI call.

Change the Judge LLM call model from `gpt-4o-mini` to `gpt-4o`:

```typescript
const res = await openai.chat.completions.create({
  model: "gpt-4o",  // was gpt-4o-mini
  // ... rest unchanged
});
```

**File**: `lib/fact-check.ts`

Change the fact-check verification call model from `gpt-4o-mini` to `gpt-4o`:

```typescript
const res = await openai.chat.completions.create({
  model: "gpt-4o",  // was gpt-4o-mini
  // ... rest unchanged
});
```

Keep all other LLM calls (intent classification, translation, claim extraction, paste detection) on `gpt-4o-mini`.

Consider making the model configurable via environment variable:

```typescript
const JUDGE_MODEL = process.env.JUDGE_MODEL ?? "gpt-4o";
const FACTCHECK_MODEL = process.env.FACTCHECK_MODEL ?? "gpt-4o";
```

**Verification**: Run `npm run run-real-world-factchecks`. Expect improved pass rate (target: 14/15 or 15/15).

---

### Phase 8: Verdict Stability Tests (P1)

**File**: Extend `scripts/verify-retrieval-drift.ts` or create `scripts/verify-verdict-stability.ts`

Add verdict stability test cases:

```typescript
const VERDICT_STABILITY_TESTS = [
  {
    id: "VS-01",
    pastedText: "Duterte was convicted by the ICC",
    expectedVerdict: "false",
    expectedPhrases: ["confirmation of charges"],
    critical: true,
  },
  {
    id: "VS-02",
    pastedText: "Duterte is charged with three counts of crimes against humanity",
    expectedVerdict: "verified",
    expectedPhrases: ["three counts", "crimes against humanity"],
    critical: true,
  },
  {
    id: "VS-03",
    pastedText: "Duterte was charged with genocide",
    expectedVerdict: "false",
    expectedPhrases: ["crimes against humanity"],
    critical: true,
  },
  {
    id: "VS-04",
    pastedText: "The ICC issued an arrest warrant for Duterte",
    expectedVerdict: "verified",
    expectedPhrases: ["warrant"],
    critical: true,
  },
  {
    id: "VS-05",
    pastedText: "Duterte was sentenced to life imprisonment",
    expectedVerdict: "false",
    expectedPhrases: ["confirmation of charges", "no sentence"],
    critical: true,
  },
];
```

Each test:
1. Calls `extractClaims` on the pasted text
2. Retrieves chunks
3. Calls `generateFactCheckResponse`
4. Asserts verdict matches expected
5. Asserts expected phrases appear in answer

Add script command:
```json
"verify-verdict-stability": "tsx scripts/verify-verdict-stability.ts"
```

**Verification**: Run `npm run verify-verdict-stability`. All critical tests should pass.

---

### Phase 9: Translation Stability — Lightweight Check (P1)

**File**: Create `lib/translation-stability.ts`

```typescript
export interface TranslationStabilityResult {
  stable: boolean;
  warning?: string;
}

const FILIPINO_MODAL_MARKERS = /\b(maaari|dapat|pwede|siguro|baka|malamang|posible)\b/gi;
const ENGLISH_CERTAINTY = /\b(will|shall|must|definitely|certainly)\s+(be\s+)?(convicted|sentenced|charged|killed|arrested)\b/gi;

export function checkTranslationStability(
  originalFilipino: string,
  englishTranslation: string
): TranslationStabilityResult {
  const filipinoModals = (originalFilipino.match(FILIPINO_MODAL_MARKERS) ?? []).length;
  const englishCertainty = (englishTranslation.match(ENGLISH_CERTAINTY) ?? []).length;

  if (filipinoModals > 0 && englishCertainty > 0) {
    return {
      stable: false,
      warning: "Translation may have converted uncertain Filipino markers to certain English assertions",
    };
  }

  return { stable: true };
}
```

**File**: `lib/chat.ts`

After the translation step (Step 1), if the query was translated, call the stability check:

```typescript
import { checkTranslationStability } from "./translation-stability";

// After translation:
if (translatedQuery && detectedLanguage !== "en") {
  const stability = checkTranslationStability(originalQuery, translatedQuery);
  if (!stability.stable) {
    logEvent("translation.stability_warning", "warn", {
      warning: stability.warning,
      original: originalQuery.slice(0, 100),
      translated: translatedQuery.slice(0, 100),
    });
  }
}
```

This is logging-only for now. Do not block or alter the response.

**Verification**: Test with "Maaaring ma-convict si Duterte" — log should show stability warning if translation says "will be convicted" instead of "may be convicted."

---

## Post-Implementation Checklist

After all phases:

- [ ] Run `npm run verify-adversarial-safeguards` — all 8+ tests pass
- [ ] Run `npm run run-real-world-factchecks` — ≥ 12/15 pass (target 14/15)
- [ ] Run `npm run verify-retrieval-drift` — no regressions
- [ ] Run `npm run verify-verdict-stability` — all critical tests pass
- [ ] Manual test: "Duterte ordered the killings" with split chunks → UNVERIFIABLE
- [ ] Manual test: "Objectively, was the ICC biased?" → normative rejection
- [ ] Manual test: Multi-turn with user number "30,000" → not in generation context
- [ ] Manual test: "What is Tokhang?" → vec_count > 0 (after glossary ingest)
- [ ] `lib/prompts.ts` JUDGE_SYSTEM_PROMPT is ~600 tokens (down from ~2000)
- [ ] No TypeScript compilation errors
- [ ] No new linter warnings

## Files Modified Summary

| File | Changes |
|------|---------|
| `lib/attribution-verifier.ts` | Expanded verbs, sentence-window, allegation compound |
| `lib/deterministic-judge.ts` | **NEW** — Layer 1 deterministic checks |
| `lib/chat.ts` | Deterministic judge insertion, translation stability hook, contamination guard order |
| `lib/prompts.ts` | Reduced JUDGE_SYSTEM_PROMPT |
| `lib/contamination-guard.ts` | Expanded patterns |
| `lib/normative-filter.ts` | Expanded patterns + exceptions |
| `lib/fact-check.ts` | D2/D3 decomposition, model upgrade |
| `lib/translation-stability.ts` | **NEW** — translation audit |
| `scripts/ingest-glossary.ts` | **NEW** — glossary embedding anchors |
| `scripts/verify-verdict-stability.ts` | **NEW** — verdict regression tests |
| `package.json` | New script commands |
