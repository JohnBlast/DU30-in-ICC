# The Docket — Production Hardening Blueprint

> **Classification**: Internal architecture hardening document
> **Author**: Principal AI Systems Architect / Legal Reliability Auditor
> **Date**: 2026-03-02
> **Scope**: Addresses 10 critical/high-risk gaps identified in post-audit review
> **Constraint**: Design as if system will be scrutinized by journalists, legal scholars, political actors, and AI safety auditors

---

## 1. Executive Risk Summary

### Existential Risks (system credibility destroyed if exploited)

| Gap | Risk Level | Why Existential |
|-----|-----------|-----------------|
| **No deterministic causal-attribution enforcement** | CRITICAL | System can VERIFY "Duterte ordered the killings" by stitching actor from chunk A + harm from chunk B. If screenshotted: "The Docket verified Duterte ordered killings." Irrecoverable credibility loss. |
| **Citation validation is lexical, not semantic** | CRITICAL | 40% key-term overlap cannot distinguish "Duterte is charged with murder [1]" (supported) from "Duterte murdered 30,000 [1]" (unsupported). Cross-chunk stitching survives. |
| **Multi-turn factual contamination** | HIGH | User states "30,000 killed" in turn 1. Turn 3 answer references "the 30,000 figure" from history. System appears to endorse user's number as ICC-sourced. Adversarial actors can seed assertions. |
| **Judge overburdened on lightweight model** | HIGH | Judge has 30+ REJECT + 15+ APPROVE-override conditions. gpt-4o-mini cannot hold this many constraints. False rejections suppress valid answers; false approvals leak violations. Both are exploitable. |

### Quality Risks (degraded trust, not destroyed)

| Gap | Risk Level | Why Quality |
|-----|-----------|-------------|
| **Embedding underperformance for domain vocabulary** | HIGH | Drug war queries (Tokhang, DDS) return 0 vector hits. System functions via FTS fallback, but retrieval quality is inconsistent. |
| **Claim decomposition partially prompt-based** | MEDIUM | D2–D6 rules exist only in prompt. Model may not decompose "Since the ICC convicted him, extradition follows" into two independent claims. |
| **Normative detection is keyword-based** | MEDIUM | "Objectively speaking, was the ICC biased?" bypasses current patterns. Subtle evaluative framing can draw the system into normative territory. |
| **Retrieval drift tracks chunks, not verdicts** | MEDIUM | Same chunks can produce different answers across model versions. No verdict stability baseline. |
| **Translation drift risk** | MEDIUM | Filipino→English may alter "pinapatay" (being killed) to "killed" (active voice), shifting attribution. No audit layer. |

### Risk Interaction: Epistemic Collapse Path

The most dangerous failure is not any single gap but the **convergence path**:

1. User submits: "Duterte ordered killings of 30,000 drug suspects"
2. Claim extraction keeps "Duterte ordered killings" (D3 fails to decompose)
3. Vector search returns 0; FTS returns chunks mentioning Duterte + chunks mentioning killings separately
4. LLM verifies VERIFIED (actor and harm both "in chunks")
5. Attribution engine (current) checks cited chunks — finds actor in one, harm in another, but `chunkSupportsCausalAttribution` passes because chunk has both words (in different paragraphs of a 1000-char chunk)
6. Citation integrity passes at 40% overlap (enough legal terms match)
7. Judge approves (within "err on APPROVE" bias)
8. User sees: "Based on ICC documents, this is supported."

This path is currently possible. Sections 2–3 below close it.

---

## 2. Deterministic Causal Attribution Engine — Redesign

### Current State

`lib/attribution-verifier.ts` implements `hasCausalAttributionStructure()` and `chunkSupportsCausalAttribution()`. The logic checks for actor + causal verb + harmful act in the same chunk, but:

1. **Chunk granularity is too coarse**: Chunks are ~1000 chars. Actor and harm can appear in unrelated paragraphs within the same chunk.
2. **Verb matching is single-word**: "bore responsibility for" or "directed operations leading to" won't match the `CAUSAL_VERBS` regex.
3. **Coreference is ignored**: "He ordered" when "he" doesn't resolve to the actor within the chunk.
4. **Passive constructions partially handled**: "killings were ordered by Duterte" matches, but "the killings, for which Duterte bore responsibility" does not.

### Redesigned Detection Logic

#### A. Expanded Causal Verb Taxonomy

```typescript
const CAUSAL_VERB_PATTERNS = [
  // Direct
  /\b(ordered|directed|authorized|commanded|instructed|oversaw|approved|sanctioned|endorsed|masterminded|orchestrated|initiated)\b/i,
  // Indirect / responsibility
  /\b(bore\s+responsibility\s+for|was\s+responsible\s+for|presided\s+over|led\s+to|resulted\s+in)\b/i,
  // Phrasal
  /\b(carried\s+out\s+under|at\s+the\s+(direction|behest|order)\s+of|on\s+(the\s+)?orders?\s+of)\b/i,
  // Modes of liability (Rome Statute Art 25/28)
  /\b(aided\s+and\s+abetted|contributed\s+to|facilitated|had\s+(effective\s+)?command\s+(and\s+control\s+)?over)\b/i,
];
```

#### B. Sentence-Window Co-occurrence (not chunk-level)

The critical fix: instead of checking an entire 1000-char chunk, require co-occurrence within a **3-sentence window**.

```typescript
function sentenceWindowCooccurrence(
  chunk: string,
  actorPattern: RegExp,
  verbPatterns: RegExp[],
  actPattern: RegExp,
  windowSize: number = 3
): boolean {
  const sentences = chunk.split(/(?<=[.!?])\s+/);
  for (let i = 0; i < sentences.length; i++) {
    const window = sentences.slice(i, i + windowSize).join(" ");
    const hasActor = actorPattern.test(window);
    const hasVerb = verbPatterns.some(p => p.test(window));
    const hasAct = actPattern.test(window);
    if (hasActor && hasVerb && hasAct) return true;
  }
  return false;
}
```

#### C. Indirect Phrasing Handling

| Phrasing | Matched By | Rule |
|----------|-----------|------|
| "Duterte ordered the killings" | Direct verb match | Standard co-occurrence |
| "bore responsibility for the drug war killings" | Indirect pattern | Same window required |
| "directed operations leading to extrajudicial executions" | Phrasal pattern | Same window required |
| "under Duterte's watch, killings occurred" | Possessive + temporal proximity | New: possessive + harmful act in 2-sentence window |
| "the accused, through his authority as commander-in-chief, authorized the operations" | Modes of liability pattern | Same window required |

#### D. Allegation-Source Compound Check

Even if the 3-sentence window matches, if the chunk source is `transcript` or `filing` AND the matching sentence contains allegation verbs (`alleges`, `argues`, `submits`), the attribution is **alleged, not established**. The verdict should be:

- If verdict was VERIFIED → downgrade to UNVERIFIABLE
- icc_says: "The prosecution alleges this, but no court ruling confirms the causal link."

```typescript
function isAllegationContext(sentence: string, chunk: RetrievalChunk): boolean {
  const ALLEGATION_CONTEXT = /\b(alleges?|argues?|submits?|contends?|claims?|according\s+to\s+the\s+(prosecution|OTP|defence))\b/i;
  const docType = chunk.metadata.document_type?.toLowerCase() ?? "";
  return (docType === "transcript" || docType === "filing") && ALLEGATION_CONTEXT.test(sentence);
}
```

#### E. Integration Point

In `lib/fact-check.ts`, the current call to `enforceAttributionVerification()` at line 601 remains, but the underlying function changes:

```
Claims → LLM verification → [existing] procedural check → [UPGRADED] attribution check → [existing] allegation framing → verdicts
```

#### F. Edge Cases

| Edge Case | Handling |
|-----------|---------|
| Chunk quotes prosecution: "Duterte ordered the operations" (with quotes in chunk) | Allegation-source check catches: transcript/filing + allegation context → UNVERIFIABLE |
| Decision says: "The Chamber finds that Duterte authorized..." | Decision document_type = ruling → co-occurrence check passes → VERIFIED |
| Multiple actors: "Police officers, under Duterte's command, carried out killings" | Actor resolves via "Duterte" + "under X's command" phrasal match → window check |
| Chunk discusses Duterte's political career + separate paragraph on killings | Sentence-window check: actor in sentence 1, killings in sentence 8 → NOT co-occurring → UNVERIFIABLE |

---

## 3. Semantic Citation Validation Upgrade

### Current State

`lib/chat.ts` — `validateCitationIntegrity()` extracts key terms from the citing sentence, checks what fraction appear in the cited chunk, marks `trusted: false` if < 40%.

### Why 40% Lexical Overlap Fails

| Scenario | Key Terms | Chunk Content | Overlap | Correct? |
|----------|-----------|---------------|---------|----------|
| "Duterte is charged with murder [1]" | Duterte, charged, murder | DCC mentioning "charged with murder" | ~80% | Yes ✓ |
| "Duterte murdered 30,000 people [1]" | Duterte, murdered, 30000, people | DCC mentioning Duterte + "killings" + no number | ~40% | PASSES but should FAIL |
| "The court convicted Duterte [1]" | court, convicted, Duterte | Chunk mentioning "Duterte" + "court" + "charges" | ~50% | PASSES but should FAIL |

### Proposed: Mini Proposition Verifier (Lightweight NLI)

Instead of replacing the existing check, **layer a proposition check on top** for claims that pass the 40% threshold but have high stakes.

#### Architecture

```
Answer sentence with [N] marker
        ↓
  [Existing] Key-term overlap check (40% threshold)
        ↓ (if passes)
  [NEW] Proposition extraction from sentence
        ↓
  [NEW] Chunk entailment check: "Does the chunk ENTAIL the proposition?"
        ↓
  trusted: true/false
```

#### Implementation: Chunk-Level Entailment via Targeted LLM Call

This is NOT a full NLI model. It is a **constrained, single-question LLM call**:

```typescript
async function verifyPropositionGrounding(
  sentence: string,
  chunkContent: string
): Promise<boolean> {
  const prompt = `Does the following passage DIRECTLY STATE or DIRECTLY SUPPORT the proposition? Answer only YES or NO.

Passage: "${chunkContent.slice(0, 800)}"

Proposition: "${sentence}"

Rules:
- YES only if the passage explicitly states or clearly implies the proposition
- NO if the proposition adds information not in the passage
- NO if the passage mentions related topics but does not support the specific claim
- NO if the proposition attributes causation but the passage only mentions actors and events separately

Answer: YES or NO`;

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 3,
    temperature: 0,
  });
  return res.choices[0]?.message?.content?.trim().toUpperCase().startsWith("YES") ?? false;
}
```

#### When to Trigger

Not every citation needs the LLM check. Trigger only when:

1. The claim contains a **causal attribution** (from attribution engine detection)
2. The claim contains a **specific number** not found verbatim in the chunk
3. The claim uses **absolute language** ("convicted", "sentenced", "guilty")
4. The overall verdict is VERIFIED for a factual claim

This limits the extra LLM calls to ~1–3 per fact-check, costing ~$0.001 each.

#### Pipeline Insertion Point

In `lib/chat.ts`, after `validateCitationIntegrity()` (Step 10), before response assembly (Step 11). For fact-check mode, in `lib/fact-check.ts` after verdict computation, before answer formatting.

#### Performance Trade-offs

| Aspect | Impact |
|--------|--------|
| Latency | +100–200ms per triggered check (1–3 checks per request) |
| Cost | +$0.001–0.003 per request (gpt-4o-mini, 3-token response) |
| False positive risk | Over-strict: valid paraphrases might fail. Mitigated by only triggering on high-stakes claims |
| False negative risk | LLM may say YES when proposition is weakly supported. Mitigated by constrained prompt rules |

---

## 4. Multi-Turn Contamination Guard

### Current State

`lib/contamination-guard.ts` implements `sanitizeHistoryForContamination()` with 4 regex patterns:
- Numbers + casualties
- Source attributions
- Actor + causal verb patterns
- Guilt/innocence assertions

### Identified Gaps

1. **Partial sentence matching**: Pattern `\b(the )?(\w+)\s+(ordered|authorized|directed)\s+[^.!?]+[.!?]` requires a sentence-ending punctuation. "Duterte ordered the killings" without a period won't match.
2. **Numbers without context**: "30,000" alone (no "killed"/"victims" after it) survives. User can say "30,000" in one turn and "were those people killed?" in the next.
3. **Factual assertions disguised as questions**: "Given that 30,000 were killed, what does the ICC say?" — the "given that" framing survives.
4. **Assistant echo**: If the assistant's response in turn N echoes a user number (from a corrected answer), it persists in history.

### Upgraded Sanitization Rules

```typescript
const USER_FACT_PATTERNS_V2: Array<{ pattern: RegExp; replacement: string }> = [
  // Numbers + casualties (existing, made more aggressive)
  {
    pattern: /\b\d{3,}\s*(killed|died|victims|people|casualties|dead|deaths?)\b/gi,
    replacement: "[User-stated number — omitted from context]",
  },
  // Standalone large numbers near ICC/drug war context
  {
    pattern: /\b(approximately|around|about|at least|over|more than)?\s*\d{3,}\b(?=\s*(drug|kill|victim|people|death|case|warrant|count|charge))/gi,
    replacement: "[User-stated number — omitted from context]",
  },
  // "Given that X" / "Since X" framing
  {
    pattern: /\b(given that|since|because|considering that)\s+[^,]+\b(killed|died|victims|convicted|sentenced|guilty|ordered)\b[^,]*/gi,
    replacement: "[User-stated premise — omitted from context]",
  },
  // Source attributions (existing, extended)
  {
    pattern: /\b(according to|sources say|it is known that|everyone knows|it has been reported|as we know|as established)\s+[^.!?]+[.!?]?/gi,
    replacement: "[User-stated claim — omitted from context]",
  },
  // Actor + causal verb (existing, made punctuation-optional)
  {
    pattern: /\b(duterte|du30|the president|he)\s+(ordered|authorized|directed|commanded|instructed)\b[^.!?]*/gi,
    replacement: "[User-stated claim — omitted from context]",
  },
  // Guilt/innocence (existing)
  {
    pattern: /\b(duterte|du30)\s+(is|was)\s+(guilty|innocent|convicted|acquitted)\b/gi,
    replacement: "[User-stated claim — omitted from context]",
  },
  // User-embedded "facts" with specific numbers
  {
    pattern: /\b(there were|there are|there have been)\s+\d{3,}\s+\w+/gi,
    replacement: "[User-stated claim — omitted from context]",
  },
];
```

### Assistant Message Sanitization

New: also strip numbers from **assistant** messages that echo user numbers (not from chunks):

```typescript
function sanitizeAssistantEcho(
  assistantContent: string,
  userMessages: string[]
): string {
  const userNumbers = new Set<string>();
  for (const um of userMessages) {
    const nums = um.match(/\b\d{3,}\b/g) ?? [];
    nums.forEach(n => userNumbers.add(n));
  }
  let result = assistantContent;
  for (const num of userNumbers) {
    if (parseInt(num) > 2030) { // Not a year
      result = result.replace(new RegExp(`\\b${num}\\b`, 'g'), '[number from prior context]');
    }
  }
  return result;
}
```

### Risks of Over-Sanitization

| Risk | Mitigation |
|------|-----------|
| Stripping legitimate follow-up context ("What about the 3 counts?") | Preserve numbers ≤ 100 and years 2020–2030 |
| Losing question structure ("Given the charges, what happens next?") | Only strip the premise clause, preserve the question |
| Breaking pronoun references ("What about that?") | Preserve pronouns and question words |

### Example Before/After

| Turn | Before Sanitization | After Sanitization |
|------|--------------------|--------------------|
| User T1 | "30,000 were killed in the drug war" | "[User-stated number — omitted from context]" |
| Assistant T1 | "ICC documents mention killings but the specific number 30,000 does not appear..." | (preserved) |
| User T2 | "Is that number accurate?" | "Is that number accurate?" (preserved — question structure) |
| User T3 | "Given that Duterte ordered the killings, what charges apply?" | "[User-stated premise — omitted from context], what charges apply?" |

---

## 5. Domain Embedding Strategy Upgrade

### Current State

- Embedding model: `text-embedding-3-small` (1536 dims)
- Drug war terms (Tokhang, DDS, Double Barrel) routinely return 0 vector results
- Query expansion via `expandQueryForEmbedding()` appends context phrases
- FTS carries most of the load for domain-specific queries

### Why Embeddings Fail

`text-embedding-3-small` was trained on general web text. "Tokhang" is a low-frequency Filipino term. The embedding space does not encode it near "drug war operation" or "anti-drug campaign." Query expansion helps the FTS branch but the appended context for embedding creates a noisy, long query that dilutes the semantic signal.

### Minimal Viable Upgrade (No infrastructure change)

**Strategy: Synthetic Glossary Document Injection**

Create 15–20 synthetic glossary chunks and ingest them into the knowledge base:

```
document_type: "glossary"
rag_index: 2
content: "Oplan Tokhang (also known as Operation Tokhang, Project Tokhang) is the name of the Philippine 
National Police anti-drug campaign launched in 2016 under President Rodrigo Duterte. The operation involved 
door-to-door visits to known drug personalities. In ICC proceedings, Tokhang is referenced in the context 
of the alleged widespread and systematic attack against civilian population, as described in the Document 
Containing the Charges. Related terms: drug war, anti-drug campaign, Project Double Barrel, PNPAIDG, 
war on drugs, extrajudicial killings, EJK."
```

These chunks serve as **embedding anchors** — they give the vector search a high-similarity target for domain-specific queries. They don't change the factual content (they contain only terms already in the KB) but they create semantic bridges.

**Implementation**:
1. Create `scripts/ingest-glossary.ts`
2. Define 15–20 glossary entries covering: Tokhang, DDS/Davao Death Squad, Double Barrel, EJK, nanlaban, salvaging, DCC (Document Containing the Charges), OPCV, OTP, Confirmation of Charges, Article 7, Article 15, Article 18, complementarity, in absentia
3. Mark `document_type: "glossary"`, `rag_index: 2` (case docs index)
4. Embed and store normally

**Expected impact**: Vector search starts returning glossary chunks for "What is Tokhang?" queries, which then get merged with FTS results via RRF.

### Ideal Upgrade (Higher investment)

**Strategy: Domain-Adapted Embedding + Cross-Encoder Reranker**

1. **Switch to `text-embedding-3-large`** (3072 dims) — better domain coverage, ~2× cost per embed but one-time re-embed
2. **Add Cohere Rerank v3** as a cross-encoder reranker after RRF merge:
   - RRF produces top-20
   - Cohere reranker scores each (query, chunk) pair
   - Top 4–6 returned
   - Cost: ~$0.002 per query (Cohere rerank pricing)
3. **Query rewriting via LLM** for drug war terms:
   ```
   User: "What is Tokhang?"
   Rewritten: "What is Operation Tokhang, the Philippine anti-drug campaign referenced in the ICC case?"
   ```
   - Only triggered when query matches drug war term regex
   - Single LLM call, ~$0.0005

### Migration Risk Assessment

| Upgrade | Risk | Mitigation |
|---------|------|-----------|
| Glossary injection | Low — additive, no schema change | Verify glossary chunks don't dominate results for non-glossary queries |
| text-embedding-3-large | Medium — requires re-embedding all 3186 chunks (~$2.50 at current pricing) | Run re-embed as migration; keep old embeddings until validated |
| Cohere reranker | Low — additive, optional dependency | Implement as optional middleware; fallback to current top-K slice |
| Query rewriting | Medium — adds LLM call to retrieval path | Only trigger on drug war regex; cache rewrites |

---

## 6. Judge Refactor Plan

### Current State

`JUDGE_SYSTEM_PROMPT` in `lib/prompts.ts` contains:
- 13 base REJECT conditions
- 14 fact-check-specific REJECT conditions (total ~27)
- 12+ "APPROVE explicitly for" clauses
- All running on gpt-4o-mini

The "APPROVE explicitly for" list is a diagnostic signal: it means the Judge was previously rejecting valid answers. Each entry is a patch for a false rejection. This is architectural debt.

### What Should Move to Deterministic Checks

| Current Judge Responsibility | Move To | Rationale |
|-----------------------------|---------|-----------|
| Prohibited terms ("guilty", "innocent", "murderer") | Deterministic regex scan | Zero ambiguity; no LLM needed |
| Citation index bounds ([N] within 1..chunks.length) | Deterministic validation | Arithmetic check |
| Hallucinated numbers | Already deterministic (`checkForHallucinatedNumbers`) | Keep as-is |
| Enumeration grounding | Already deterministic (`verifyEnumeratedClaims`) | Keep as-is |
| [REDACTED] in answer | Deterministic regex | Zero tolerance |
| Procedural impossibility (verdict context) | Already implemented (`isProcedurallyImpossible`) | Keep as-is |
| Causal attribution without co-occurrence | Attribution engine (Section 2) | Deterministic with window check |

### What Should Remain LLM-Evaluated

| Judge Responsibility | Why LLM-Only |
|---------------------|-------------|
| Citation semantic support (does claim trace to chunk content?) | Requires understanding paraphrasing |
| Transcript vs ruling framing | Requires understanding context of "the court found" vs "prosecution argued" |
| Neutrality / tone | Subtle; "strong evidence" vs "evidence exists" |
| Scope creep (non-ICC claims) | Requires semantic understanding |

### Layered Compliance Architecture

```
Answer from LLM
      ↓
[Layer 1: Deterministic] — runs first, no LLM cost
  ├── Prohibited term scan → REJECT if found
  ├── Citation bounds check → REJECT if invalid
  ├── [REDACTED] in answer → REJECT if found
  ├── Attribution verification → downgrade verdict if needed
  └── Hallucinated number flag → inject warning for Layer 2
      ↓ (if all pass)
[Layer 2: Narrow LLM Judge] — reduced scope, ~600 token prompt
  ├── Citation semantic support
  ├── Transcript vs ruling framing
  ├── Neutrality check
  └── Scope creep check
      ↓
APPROVE or REJECT
```

### Reduced-Scope Judge Prompt (~600 tokens vs current ~2000)

```
You are a verification judge for The Docket.

You receive: the generated answer + retrieved ICC document chunks.

REJECT ONLY if:
1. A factual claim in the answer is NOT supported by any chunk (paraphrasing OK)
2. A transcript/filing source is presented as a court ruling ("The Court found..." when source is prosecution argument)
3. The answer expresses opinion on guilt/innocence or uses politically loaded language
4. The answer references information not from the provided chunks

APPROVE if:
- Claims trace to chunks (paraphrasing acceptable)
- Tone is neutral
- Transcript sources properly framed

Respond: APPROVE or REJECT + one sentence reason.
```

### Cost-Aware Model Allocation

| LLM Call | Current | Recommended | Rationale |
|----------|---------|-------------|-----------|
| Intent classification (L3) | gpt-4o-mini | gpt-4o-mini | Fallback only; low stakes |
| Translation | gpt-4o-mini | gpt-4o-mini | Adequate quality |
| Q&A generation | gpt-4o-mini | gpt-4o-mini | Adequate with strong retrieval |
| Claim extraction | gpt-4o-mini | gpt-4o-mini | Stripping/decomposition partially deterministic |
| **Fact-check verification** | gpt-4o-mini | **gpt-4o** | Highest-stakes LLM call; FALSE vs UNVERIFIABLE requires strong reasoning |
| **Judge** | gpt-4o-mini | **gpt-4o** (reduced scope) | Fewer conditions + stronger model = fewer false rejections |
| Proposition grounding (new) | N/A | gpt-4o-mini | 3-token response; fast model sufficient |

**Cost impact**: gpt-4o is ~10× more expensive per token than gpt-4o-mini. But:
- Fact-check verification: 1500 max tokens → ~$0.03 per check (vs $0.003)
- Judge (reduced scope): 256 max tokens → ~$0.005 per check (vs $0.0005)
- Total per-request increase: ~$0.035 (from ~$0.005)
- At 1000 requests/month: $35/month (from $5)

This is well within reasonable cost for a production legal system.

---

## 7. Deterministic Decomposition Expansion

### Current State

- **D1** (comma-list): Implemented in code (`decomposeCommaList`)
- **D2–D6**: Exist only in `CLAIM_EXTRACTION_SYSTEM` prompt

### Which Rules Should Move to Code

| Rule | Deterministic Feasibility | Recommendation |
|------|--------------------------|----------------|
| **D2: Subordinate clauses** | High — "After X, Y" / "Before X, Y" / "When X, Y" are structurally detectable | Move to code |
| **D3: Conditional/causal chains** | High — "Since X, Y" / "Because X, Y" / "If X, then Y" | Move to code |
| **D4: Implicit prerequisites** | Already partially in code (`injectPrerequisiteClaims`) | Expand patterns |
| **D5: Temporal sequences** | Medium — "X, then Y, then Z" / "first X, then Y" | Move to code |
| **D6: Exclusivity claims** | Medium — "only X" / "solely X" / "just X" | Move to code |

### Heuristics for D2 and D3

```typescript
const SUBORDINATE_PATTERNS = [
  /^(after|before|when|once|upon)\s+(.+?),\s*(.+)$/i,
  /^(.+?)\s+(after|before|when|once)\s+(.+)$/i,
];

function decomposeSubordinate(claim: ExtractedClaim): ExtractedClaim[] {
  if (claim.claimType !== "factual_claim") return [claim];
  for (const p of SUBORDINATE_PATTERNS) {
    const m = claim.extractedText.match(p);
    if (m) {
      const parts = [m[2].trim(), m[3].trim()].filter(s => s.length > 15);
      if (parts.length === 2) {
        return parts.map(t => ({ ...claim, extractedText: normalizeClaimStart(t) }));
      }
    }
  }
  return [claim];
}

const CAUSAL_CHAIN_PATTERNS = [
  /^(since|because|as)\s+(.+?),\s*(.+)$/i,
  /^(.+?)\s+(so|therefore|thus|hence)\s+(.+)$/i,
];

function decomposeCausalChain(claim: ExtractedClaim): ExtractedClaim[] {
  if (claim.claimType !== "factual_claim") return [claim];
  for (const p of CAUSAL_CHAIN_PATTERNS) {
    const m = claim.extractedText.match(p);
    if (m) {
      const parts = [m[2].trim(), m[3].trim()].filter(s => s.length > 15);
      if (parts.length === 2) {
        return parts.map(t => ({ ...claim, extractedText: normalizeClaimStart(t) }));
      }
    }
  }
  return [claim];
}
```

### Risk of Over-Splitting

| Risk | Example | Mitigation |
|------|---------|-----------|
| Legal phrases split incorrectly | "murder as a crime against humanity" | Stopping rule: if subclaim < 15 chars, don't split |
| Date modifiers detached | "convicted on March 8, 2024" → "convicted" + "on March 8, 2024" | Don't split if second part starts with preposition + date |
| Meaningful clause split | "After withdrawing from the Rome Statute, the Philippines challenged jurisdiction" → both parts are independently verifiable and correct to split | This is correct behavior — not a risk |

### Fallback Strategy

Deterministic decomposition runs first. The prompt-based D2–D6 instructions remain as a safety net for cases the regex misses. If deterministic decomposition produces subclaims, they replace the original before the LLM sees them.

---

## 8. Normative Domain Filter Upgrade

### Current State

`lib/normative-filter.ts` has 8 `NORMATIVE_PATTERNS` and 4 `FACTUAL_PROCEDURAL_OK` exceptions.

### Gaps

1. **Implicit evaluation**: "Objectively speaking, was the ICC biased?" — "objectively speaking" masks the evaluative "was X biased?"
2. **Comparative evaluation**: "Is the ICC more effective than the ICTY?" — not caught
3. **Disguised normative**: "Would you agree that the ICC has no jurisdiction?" — "would you agree" is a normative prompt
4. **Framing as factual**: "Is it a fact that the ICC is politically motivated?" — appears factual but is evaluative

### Upgraded Detection

```typescript
const NORMATIVE_PATTERNS_V2 = [
  // Existing patterns (kept)
  ...NORMATIVE_PATTERNS,
  // "Objectively" / "honestly" + evaluative
  /\b(objectively|honestly|realistically|truthfully)\s+(speaking\s*,?\s*)?(is|was|are|were|do|does|did)\b/i,
  // "Would you agree" / "Don't you think"
  /\b(would\s+you\s+agree|don'?t\s+you\s+think|wouldn'?t\s+you\s+say|isn'?t\s+it\s+(true|obvious|clear))\b/i,
  // "Is it a fact that [evaluative]"
  /\b(is\s+it\s+(a\s+)?fact\s+that)\s+.*(biased|political|illegal|unfair|hypocritical|corrupt)/i,
  // Comparative to other courts/leaders
  /\b(more|less)\s+(effective|fair|biased|corrupt|legitimate)\s+than\b/i,
  // "How can the ICC" (rhetorical)
  /\bhow\s+can\s+(the\s+)?(icc|court)\s+(justify|claim|pretend|dare)\b/i,
  // Sovereignty-flavored normative
  /\b(interference|meddling|neo-?colonial|imperial)\s+(in|with|of)\s+(philippine|filipino|our|the)\b/i,
];
```

### Borderline Query Handling

| Query | Classification | Rationale |
|-------|---------------|-----------|
| "Objectively speaking, was the ICC biased?" | Normative | "Was X biased?" is evaluative regardless of prefix |
| "Did the Philippines argue the ICC was biased?" | Factual | Asks what was argued — answerable from chunks |
| "Is the ICC more effective than the ICTY?" | Normative | Comparative evaluation across institutions |
| "What is the ICC's jurisdiction?" | Factual | Descriptive question about legal framework |
| "Is it a fact that the drug war killed thousands?" | Factual | Despite framing, asks about a verifiable claim |
| "How dare the ICC interfere?" | Normative | Rhetorical + evaluative |

### Failure Mitigation

**False positive risk**: A query like "Is the ICC biased in its selection of cases?" could be a legitimate legal question about ICC complementarity. Mitigation:

1. `FACTUAL_PROCEDURAL_OK` whitelist includes patterns like `/\bwhat\s+does\s+the\s+(rome\s+statute|icc)\s+say\s+about\b/i`
2. Add new exception: `/\b(did|does|has)\s+(the\s+)?(defence|defense|philippines)\s+(argue|claim|contend|submit)\s+that\b/i` — questions about what parties argued
3. When normative filter triggers, the decline message includes: "If you're asking about a specific legal argument made in the case, try rephrasing as 'What did [party] argue about [topic]?'"

---

## 9. Retrieval Drift Expansion

### Current State

`scripts/verify-retrieval-drift.ts` checks chunk IDs against a baseline (`test-fixtures/retrieval-drift-baseline.json`). Migration `007_retrieval_drift_monitoring.sql` creates the schema.

### Missing: Answer and Verdict Stability

Chunk stability ≠ answer stability. The same chunks can produce different answers if:
- Model version changes
- Prompt wording changes
- Temperature drift
- Token budget changes

### Expanded Evaluation Schema

```typescript
interface DriftTestCase {
  id: string;
  query: string;
  mode: "qa" | "fact_check";
  pastedText?: string;
  expectedChunkIds: string[];      // Retrieval stability
  expectedAnswerPhrases: string[]; // Answer stability (key phrases that must appear)
  expectedVerdict?: ClaimVerdict;  // Verdict stability (fact-check only)
  proceduralStage?: string;        // Stage-sensitive tests
  critical: boolean;
}
```

### Verdict Stability Tests (Fact-Check Specific)

```typescript
const VERDICT_STABILITY_TESTS: DriftTestCase[] = [
  {
    id: "VS-01",
    query: "",
    mode: "fact_check",
    pastedText: "Duterte was convicted by the ICC",
    expectedVerdict: "false",
    expectedAnswerPhrases: ["confirmation of charges", "no verdict"],
    critical: true,
  },
  {
    id: "VS-02",
    query: "",
    mode: "fact_check",
    pastedText: "Duterte is charged with three counts of crimes against humanity",
    expectedVerdict: "verified",
    expectedAnswerPhrases: ["three counts", "crimes against humanity"],
    critical: true,
  },
  {
    id: "VS-03",
    query: "",
    mode: "fact_check",
    pastedText: "Duterte was charged with genocide",
    expectedVerdict: "false",
    expectedAnswerPhrases: ["crimes against humanity", "not genocide"],
    critical: true,
  },
];
```

### Release Gating Logic

```
On PR merge to main:
  1. Run retrieval drift tests (existing)
  2. Run verdict stability tests (new)
  3. Run answer phrase tests (new)
  
  If ANY critical test fails:
    → Block deployment
    → Log which tests failed
    → Require manual review

  If non-critical tests drift:
    → Log warning
    → Allow deployment with review flag
```

### Procedural-Stage-Sensitive Tests

When the case stage changes (e.g., confirmation → trial), some tests must update:

```typescript
const STAGE_SENSITIVE_TESTS: DriftTestCase[] = [
  {
    id: "PS-01",
    query: "",
    mode: "fact_check",
    pastedText: "Duterte was convicted",
    proceduralStage: "confirmation_of_charges",
    expectedVerdict: "false",
    critical: true,
  },
  // When stage changes to "trial", this test updates:
  // expectedVerdict stays "false" until stage reaches "verdict"
];
```

---

## 10. Translation Stability Safeguards

### The Risk

Filipino → English translation can alter:
- **Voice**: "Pinapatay" (being killed / are being killed) → "killed" (active, past) — shifts from passive ongoing to active completed
- **Modality**: "Maaaring ma-convict" (may be convicted) → "will be convicted" — shifts possibility to certainty
- **Attribution**: "Sinasabing pinapatay niya" (said to be killing by him) → "He killed" — drops the hearsay marker

In a legal fact-checking context, these shifts can change verdicts.

### Lightweight Solution: Back-Translation Consistency Check

After translating Filipino → English, translate English → Filipino and compare key legal assertions:

```typescript
async function checkTranslationStability(
  original: string,
  englishTranslation: string
): Promise<{ stable: boolean; warning?: string }> {
  const backTranslated = await translateToFilipino(englishTranslation);
  
  // Extract key assertions from both
  const MODAL_MARKERS = /\b(will|would|shall|must|may|might|could|can)\s+(be\s+)?(convicted|sentenced|charged|killed|arrested)/gi;
  const VOICE_MARKERS = /\b(was|were|is|are|being)\s+(killed|convicted|charged|ordered|arrested)/gi;
  
  const originalModals = (original.match(/\b(maaari|dapat|pwede|siguro|baka)\b/gi) ?? []).length;
  const translatedModals = (englishTranslation.match(MODAL_MARKERS) ?? []).length;
  
  // If modal count differs significantly, flag
  if (originalModals > 0 && translatedModals === 0) {
    return { stable: false, warning: "Translation may have dropped modal/uncertainty markers" };
  }
  
  return { stable: true };
}
```

### High-Assurance Solution: Dual-Language Verification

Run fact-check verification in **both** English and the original Filipino (using the same chunks). Compare verdicts:

```
Filipino claim → Extract claims (in Filipino)
                → Translate claims → English claims
                → Verify English claims → Verdict A
Filipino claim → Verify original Filipino claims directly → Verdict B

If Verdict A ≠ Verdict B → flag for manual review
If Verdict A = Verdict B → proceed with Verdict A
```

This doubles the verification cost but catches translation-induced verdict drift.

### Recommended Approach

For launch: **Lightweight solution** (back-translation check). Flag discrepancies in logs but don't block. Manual review of flagged cases builds a corpus for future fine-tuning.

Post-launch: If flagged cases exceed 5% of Filipino inputs, implement dual-language verification.

---

## 11. Prioritized Hardening Roadmap

### P0 — Must Fix Before Public Launch

| Item | Description | Effort | Justification |
|------|-------------|--------|---------------|
| **Causal attribution: sentence-window co-occurrence** | Replace chunk-level check with 3-sentence window in attribution verifier | 1.5 days | Closes the #1 catastrophic failure: VERIFIED for stitched causation claims. Adversarial actors will test this on day 1. |
| **Causal attribution: expanded verb taxonomy** | Add indirect phrasing, modes of liability, phrasal patterns | 0.5 days | "Bore responsibility for" and "had effective command over" are how ICC charges are actually phrased. Missing them creates false negatives in the attribution check. |
| **Causal attribution: allegation-source compound** | When chunk is transcript/filing AND sentence has allegation verbs, block VERIFIED | 0.5 days | Prevents "prosecution alleges X" → "X is verified." Direct path to misrepresentation. |
| **Judge refactor: Layer 1 deterministic checks** | Move prohibited terms, citation bounds, [REDACTED] to code | 1 day | Reduces Judge prompt from ~2000 to ~600 tokens. Deterministic checks are 100% reliable; current Judge catches them ~95%. |
| **Judge refactor: reduced-scope prompt** | Rewrite Judge to 4 conditions | 0.5 days | Fewer conditions = more consistent enforcement. |
| **Multi-turn contamination: expanded patterns** | Add premise-framing, standalone numbers, assistant echo stripping | 1 day | User-seeded "30,000" in turn 1 can contaminate turn 3 answer. Adversarial vector in political environment. |
| **Normative filter: expanded patterns** | Add "objectively", "would you agree", rhetorical, comparative, sovereignty-flavored | 0.5 days | "Objectively, was the ICC biased?" bypasses current filter. Quick fix, high value. |
| **Glossary chunk injection** | Create and ingest 15–20 synthetic glossary chunks | 1 day | Fixes vector-0 for Tokhang/DDS/Double Barrel. Minimal risk, additive change. |

**P0 Total**: ~6.5 days

### P1 — Important But Not Existential

| Item | Description | Effort | Justification |
|------|-------------|--------|---------------|
| **Semantic citation validation** | Mini proposition verifier for high-stakes citations | 2 days | Closes the 40%-overlap gap for causal claims. Lower priority than attribution engine because attribution engine catches the worst cases. |
| **Deterministic D2/D3 decomposition** | Subordinate clause and causal chain splitting in code | 1.5 days | Prevents "Since X, Y" from being treated as single claim. LLM may still catch these but deterministic is more reliable. |
| **Deterministic D5/D6 decomposition** | Temporal sequence and exclusivity splitting in code | 1 day | Completeness of decomposition pipeline. |
| **Judge model upgrade** | gpt-4o for Judge and fact-check verification | 0.5 days (config change) | Stronger reasoning for remaining LLM-evaluated conditions. Cost increase justified for legal system. |
| **Verdict stability tests** | Add verdict and answer phrase stability to drift monitoring | 2 days | Catches silent verdict drift across model/prompt changes. |
| **Translation stability: back-translation check** | Lightweight modal/voice preservation audit | 1.5 days | Flags Filipino→English translation drift. Logging only at launch. |

**P1 Total**: ~8.5 days

### P2 — Quality Optimization

| Item | Description | Effort | Justification |
|------|-------------|--------|---------------|
| **Cross-encoder reranker** | Cohere Rerank v3 after RRF merge | 2 days | Significant retrieval quality improvement but system functions without it. |
| **text-embedding-3-large migration** | Re-embed all chunks with larger model | 1 day (compute) + 1 day (validation) | Better domain coverage but glossary injection covers worst cases. |
| **Dual-language verification** | Full parallel verification in English + Filipino | 3 days | High-assurance translation stability but heavyweight. |
| **Procedural-stage-sensitive regression** | Auto-update drift tests when case stage changes | 1 day | Future-proofing for case progression. |
| **Query rewriting for drug war terms** | LLM-based query expansion before embedding | 1 day | Better than glossary injection but adds latency. |

**P2 Total**: ~8 days

### Justification for P0 Ordering

The first items to implement are the attribution engine upgrades because:

1. **Highest adversarial value**: Political actors will submit "Duterte ordered the killings — fact-check this" on launch day
2. **Highest misrepresentation risk**: Screenshot of "Based on ICC documents, this is supported" for a stitched causation claim is irrecoverable
3. **Easiest to validate**: Same-chunk co-occurrence is binary; easy to test
4. **Blocks the epistemic collapse path** described in Section 1

Judge refactor is second because it reduces the surface area for all subsequent fixes — a simpler Judge means fewer false rejections blocking valid hardening tests.

---

## Appendix A: Files Affected Per Section

| Section | Files Modified | Files Created |
|---------|---------------|---------------|
| §2 Attribution | `lib/attribution-verifier.ts` | — |
| §3 Citation | `lib/chat.ts` | `lib/proposition-verifier.ts` |
| §4 Contamination | `lib/contamination-guard.ts` | — |
| §5 Embeddings | — | `scripts/ingest-glossary.ts` |
| §6 Judge | `lib/prompts.ts`, `lib/chat.ts` | `lib/deterministic-judge.ts` |
| §7 Decomposition | `lib/fact-check.ts` | — |
| §8 Normative | `lib/normative-filter.ts` | — |
| §9 Drift | `scripts/verify-retrieval-drift.ts` | — |
| §10 Translation | `lib/translate.ts` | `lib/translation-stability.ts` |

## Appendix B: Test Matrix

| Test ID | Section | Input | Expected | Critical? |
|---------|---------|-------|----------|-----------|
| ATT-01 | §2 | "Duterte ordered the killings" + actor/harm in separate chunks | UNVERIFIABLE | Yes |
| ATT-02 | §2 | "Duterte ordered the killings" + co-occurring in same sentence of decision | VERIFIED | Yes |
| ATT-03 | §2 | "bore responsibility for drug war killings" + prosecution transcript | UNVERIFIABLE (allegation) | Yes |
| CIT-01 | §3 | "Duterte murdered 30,000 [1]" + chunk has no number | trusted: false | Yes |
| CON-01 | §4 | T1: "30,000 killed" → T2: "Is that accurate?" | No "30,000" in generation context | Yes |
| CON-02 | §4 | "Given that Duterte ordered killings, what charges?" | Premise stripped | Yes |
| EMB-01 | §5 | "What is Tokhang?" | vec_count > 0 after glossary injection | Yes |
| JDG-01 | §6 | Answer contains "murderer" | Layer 1 REJECT (no LLM call) | Yes |
| DEC-01 | §7 | "After being convicted, Duterte appealed" | 2 separate claims | Yes |
| NRM-01 | §8 | "Objectively, was the ICC biased?" | Normative rejection | Yes |
| DRF-01 | §9 | "Duterte charged with" — verdict stability across runs | VERIFIED consistently | Yes |
| TRN-01 | §10 | "Maaaring ma-convict si Duterte" | Translation preserves "may be" not "will be" | Yes |
