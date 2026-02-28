# Guide: Specifying LLM-Mediated Features

> A deep dive on what makes LLM features different from traditional features, what goes wrong when under-specified, and how to get it right the first time.

---

## Why LLM Features Are Different

In a traditional feature, the code IS the implementation. If the spec says "sort by price descending," the developer writes `array.sort((a, b) => b.price - a.price)` and it either works or it doesn't. The mapping from requirement to code is direct.

In an LLM feature, there's an **interpretation layer** between the user's intent and the system's action:

```
Traditional:  User action  →  Code  →  Result
LLM feature:  User text  →  LLM interprets  →  Structured instruction  →  Code  →  Result
```

That interpretation layer is where all the ambiguity lives. The LLM is essentially a black box that converts natural language into structured output — and it will guess at anything you don't explicitly specify.

**The system prompt is your only lever for controlling the LLM's behavior.** If you don't spec the prompt, you don't spec the feature.

---

## The Five Failure Modes (Lessons from Real NL-to-Data Projects)

Every LLM feature can fail in these five ways. Your spec must address all five.

### Failure 1: Wrong Field Names

**What happens:** The LLM guesses field names that don't match the actual data.

**Example:** Data has `unit_price` but LLM uses `cost` or `price`. Data has `product_category` but LLM uses `category` or `type`. In a support chatbot, data has `resolution_status` but LLM uses `status` or `outcome`.

**How to prevent:**
- Pass actual column names to the LLM in the prompt (`dataColumns` injection)
- Define field resolution rules in the NL interpretation contract
- Add explicit rules: "Use ONLY fields from the data column list"

**Spec artifact:** NL Interpretation Contract §3.1, Prompt Spec §4 Rules

### Failure 2: Redundant or Wrong Filters

**What happens:** The LLM adds filters that contradict the data view's built-in logic.

**Example:** An e-commerce `in_stock_products` view already filters for `availability = 'in_stock'`. LLM adds `availability = 'in stock'` on top. The space vs underscore mismatch produces an empty result. In a support system, an `open_tickets` view pre-filters for unresolved tickets, but the LLM adds `ticket_status = 'open'` redundantly.

**How to prevent:**
- Document what each data source pre-filters in the PRD
- Add explicit prohibition: "Do NOT filter availability on in_stock_products"
- Include this in the prompt spec as a rule

**Spec artifact:** NL Interpretation Contract §4 (Prohibited Outputs), PRD §11.3

### Failure 3: Data Format Mismatch

**What happens:** Code assumes clean data but actual data has format variations.

**Example:** `Number('29,99')` returns `NaN` because comma-decimal format isn't handled. `'Electroincs'.toLowerCase()` doesn't match `'electronics'` because of the typo in imported product data. In a support system, `'Resoloved'` doesn't match `'resolved'`.

**How to prevent:**
- Catalogue all dirty data patterns in the data quality contract
- Specify normalization rules at each pipeline stage
- Define parsing functions (like `parseNum`) before implementation

**Spec artifact:** Data Quality Contract §1-4

### Failure 4: Missing Test Data

**What happens:** The data generator doesn't produce data that matches the queries users will ask.

**Example:** User asks "top-selling headphones under $50" but the generator produces random product data, and none of the `in_stock` items are headphones in the $0–$50 range. In a support chatbot, user asks "unresolved billing tickets this week" but no seeded tickets match that pattern.

**How to prevent:**
- Define E2E scenarios with required data characteristics
- Bias generators to ensure testable data exists
- Include specific data patterns in E2E scenario preconditions

**Spec artifact:** E2E Scenarios §3 (Preconditions)

### Failure 5: Boundary Contract Gaps

**What happens:** Component A produces output that component B doesn't expect.

**Example:** The enrichment service preserves `p.brand` as `product_brand` but the view derivation looks for `brand`. The tenant selector picks the first store ID instead of the most common one. In a support pipeline, the ingestion layer writes `agent_id` but the resolution service expects `assigned_agent`.

**How to prevent:**
- Document the exact data shape at each pipeline boundary
- Specify key transformations (what gets renamed, merged, filtered)
- Define boundary assertions in E2E scenarios

**Spec artifact:** PRD §12 (Data Flow Contract), E2E Scenarios §5 (Boundary States)

---

## The Specification Checklist for LLM Features

Before implementation, you should be able to answer YES to all of these:

### Intent Layer
- [ ] Can I list every type of question the user will ask? (Semantic taxonomy)
- [ ] For each question type, can I write the exact JSON output? (Phrase-to-output mapping)
- [ ] Have I defined what the LLM must NOT do? (Prohibited outputs)
- [ ] Have I mapped user concepts to actual field names? (Field resolution)

### Prompt Layer
- [ ] Have I designed the prompt structure? (Static vs dynamic sections)
- [ ] Have I defined what data gets injected into the prompt? (Dynamic injection points)
- [ ] Have I written explicit rules? (Not "be careful" but "do NOT use field X")
- [ ] Have I included few-shot examples for every intent category?

### Data Layer
- [ ] Have I catalogued all dirty data patterns? (Real examples, not general descriptions)
- [ ] Have I defined normalization rules at each stage? (What gets cleaned where)
- [ ] Have I mapped all field aliases? (Canonical name → all variants)
- [ ] Have I defined number/date parsing rules? (Comma-decimal, format detection)

### Integration Layer
- [ ] Have I defined the data shape at each boundary? (Column names, value formats)
- [ ] Have I created E2E scenarios with concrete test data?
- [ ] Have I verified that test data covers all query patterns?
- [ ] Have I defined expected intermediate states, not just final output?

---

## Template Selection Guide

| Situation | Documents needed | Time investment |
|-----------|-----------------|-----------------|
| Any feature | Constitution (always) | — |
| Simple CRUD feature | PRD only | 2-3 hours |
| Feature with data pipeline (no LLM) | PRD + Data Quality + E2E Scenarios | 4-6 hours |
| Feature with LLM (no pipeline) | PRD + NL Interpretation + Prompt Spec | 5-7 hours |
| Feature with LLM + data pipeline | All documents | 6-12 hours |

---

## Common PM Mistakes with LLM Features

### Mistake 1: Specifying the schema but not the mapping

**What PMs write:** "The system supports a SearchInstruction with fields: dataSource, columns, filters, groupBy, aggregations, sort, limit."

**What's missing:** "When the user asks 'top 5 brands by revenue', the LLM should produce: `{dataSource: "in_stock_products", groupBy: ["brand"], aggregations: [{field:"unit_price",op:"sum",alias:"total_revenue"}], sort: [{field:"total_revenue",dir:"desc"}], limit:5}`"

**Fix:** For every query pattern, write the exact JSON. If you can't, the spec is incomplete.

### Mistake 2: Assuming data is clean

**What PMs write:** "System processes pre-processed data conforming to the platform schema."

**What's missing:** The data has comma-decimal prices, category typos, brand misspellings, and mixed-case values even after ETL.

**Fix:** Run the data generator (or import real data) and catalogue what you see. The data quality contract exists for this reason.

### Mistake 3: Describing behavior in prose instead of JSON

**What PMs write:** "The system should show the top products by revenue, grouping by brand and category."

**What the AI agent needs:** The exact `SearchInstruction` JSON with exact field names, operator names, and sort directions.

**Fix:** Every acceptance scenario should include copy-pasteable JSON.

### Mistake 4: Not specifying what the LLM should NOT do

**What PMs write:** (nothing — they only specify positive requirements)

**What's missing:** "Do NOT add `availability = 'in_stock'` filter on `in_stock_products`", "Do NOT use a field called `category_name`", "Do NOT invent field names."

**Fix:** Think about what a naive LLM would do for each query and explicitly prevent the wrong patterns.

### Mistake 5: Testing only the happy path

**What PMs write:** E2E scenario with clean data: "Given products with unit_price 12.99, 8.50, 24.00..."

**What's missing:** E2E scenario with dirty data: "Given unit_price values '29,99', '12,50' (comma-decimal)..." and "Given product_category 'Electroincs' (typo)..."

**Fix:** Every E2E scenario should have a dirty-data variant.

---

## The Prompt-First Development Process

For LLM features, we recommend designing the prompt BEFORE the code:

1. **Write the NL interpretation contract** — Define all intent categories and mappings
2. **Design the system prompt** — Write the actual prompt text using the contract
3. **Test the prompt manually** — Send it to the LLM API with sample data and verify outputs
4. **Fix the prompt** — If outputs are wrong, adjust rules and examples
5. **Write E2E scenarios** — Based on verified prompt behavior
6. **Implement** — Now the AI agent has a tested prompt to embed

This inverts the traditional flow (implement → test → fix prompt → test again → fix prompt again) and saves significant iteration time.

---

## RAG: The Extra Layer That Multiplies Failure Modes

RAG (Retrieval-Augmented Generation) adds a retrieval step before the LLM generates its response. This seems like an implementation detail, but from a specification perspective it introduces **three new contracts** and **four new failure modes** on top of the five LLM failure modes above.

### How RAG Changes the Architecture

```
Without RAG:  User query → LLM (system prompt) → Structured output
With RAG:     User query → Vector search → Context injection → LLM → Output
                              ↑                    ↑
                         New boundary #1      New boundary #2
                        (what's retrieved)   (how it's injected)
```

Plus there's boundary #0: **what gets indexed** in the first place.

### The Four RAG-Specific Failure Modes

These are IN ADDITION to the five LLM failure modes. RAG makes them worse because failures are **silent** — the LLM confidently generates plausible-sounding answers from irrelevant context.

#### RAG Failure 1: Wrong Chunks Retrieved

**What happens:** The vector search returns chunks that are semantically similar but factually irrelevant to the user's question.

**Example:** User asks "What's the refund policy?" Vector search returns a chunk about "return shipping labels" because both mention "return" — but the refund policy chunk is ranked #6 and top-k is 5.

**How to prevent:**
- Define top-k and similarity threshold in the retrieval contract
- Test retrieval quality with representative queries (Precision@k)
- Consider re-ranking to improve precision

**Spec artifact:** PRD §15.2 (Retrieval Contract), E2E Scenarios §5 (Retrieval Scenarios)

#### RAG Failure 2: Cross-Tenant Data Leak

**What happens:** Chunks from another tenant's documents appear in retrieval results, and the LLM uses them to answer.

**Example:** Tenant A asks about pricing. Vector search returns Tenant B's pricing document because it's semantically similar. LLM answers with Tenant B's prices.

**How to prevent:**
- Mandatory tenant_id metadata filter on every retrieval query (non-negotiable)
- Automated test: query as Tenant A, verify zero chunks from Tenant B in results
- Zero-tolerance metric: cross-tenant leak rate must be 0%

**Spec artifact:** PRD §15.2 (Mandatory filters), Handoff Checklist §E2

#### RAG Failure 3: Stale Context

**What happens:** The indexed content is outdated, but the LLM presents it as current fact.

**Example:** Pricing changed in January, but the indexed "Pricing" article was last updated in November. LLM confidently states the old prices.

**How to prevent:**
- Attach `last_updated` metadata to every chunk
- Define freshness rules: "If chunk is older than N days, add disclaimer"
- Define re-indexing triggers: "Re-index when source document is updated"

**Spec artifact:** Data Quality §6.2 (Embedding Drift), Prompt Spec §7.3 (Citation Rules)

#### RAG Failure 4: Hallucination Despite Context

**What happens:** The LLM ignores retrieved context and answers from its training data, or blends real context with hallucinated details.

**Example:** Retrieved context says "Processing takes 5-7 business days." LLM answers "Processing takes 3-5 business days" because that's more common in its training data.

**How to prevent:**
- Explicit prompt rule: "Answer ONLY using the retrieved context below"
- Citation requirement: "Every factual claim must cite [Source N]"
- Fallback rule: "If context is insufficient, say so instead of guessing"

**Spec artifact:** PRD §15.4 (Answer Quality Rules), Prompt Spec §7.1 (Injection Template)

### The RAG Specification Checklist

In addition to the LLM checklist above, verify these for RAG features:

**Indexing:**
- [ ] What data sources are indexed?
- [ ] How is content chunked? (size, overlap, method)
- [ ] What metadata is attached to each chunk?
- [ ] How is the index refreshed when source content changes?
- [ ] What quality rules reject bad chunks?

**Retrieval:**
- [ ] What top-k and similarity threshold are used?
- [ ] What mandatory filters enforce data isolation?
- [ ] What happens when nothing relevant is found?
- [ ] How is retrieval quality measured?

**Context injection:**
- [ ] Where in the prompt does retrieved context go?
- [ ] What's the token budget for context?
- [ ] How are sources cited?
- [ ] What happens when context exceeds the budget?

**Answer quality:**
- [ ] Must the LLM only use retrieved context?
- [ ] How are stale sources flagged?
- [ ] What prevents cross-tenant information blending?

### Template Selection Guide (Updated)

| Situation | Documents needed | Time investment |
|-----------|-----------------|-----------------|
| Any feature | Constitution (always) | — |
| Simple CRUD feature | PRD only | 2-3 hours |
| Feature with data pipeline (no LLM) | PRD + Data Quality + E2E Scenarios | 4-6 hours |
| Feature with LLM (no pipeline, no RAG) | PRD + NL Interpretation + Prompt Spec | 5-7 hours |
| Feature with LLM + data pipeline | All templates (no RAG/Rec sections) | 6-12 hours |
| Feature with LLM + RAG | All templates including RAG sections | 8-14 hours |
| Feature with LLM + RAG + data pipeline | All templates, all sections (no Rec) | 10-16 hours |
| Recommender (no LLM) | PRD (+ §16) + Data Quality (+ §6) + E2E (+ §6) | 6-10 hours |
| Recommender + LLM preference extraction | All LLM templates + Rec sections | 10-14 hours |
| Recommender + RAG candidate retrieval | All LLM + RAG templates + Rec sections | 12-16 hours |
| Full recommender (LLM + RAG + feedback) | All templates, all sections | 14-20 hours |

For recommender features, also read `guides/recommender-systems.md` — it explains the three additional contracts (scoring & ranking, feedback loop, evaluation) and maps them to the existing templates.

---

## Real-World Example: What We Did vs. What We Should Have Done

This example is drawn from an e-commerce search project — the same failure patterns appear in any NL-to-data system.

### What happened (8+ iterations)

```
1. Wrote PRD with SearchInstruction schema (no interpretation contract)
2. Started building in Cursor without proper specs
3. "Top 5 brands by revenue" → empty      → Fix: field was unit_price, not revenue
4. Still empty                             → Fix: in_stock_products view pre-filters;
                                              LLM was adding redundant availability filter
5. Shows NaN for totals                    → Fix: comma-decimal prices ('29,99') not parsed
6. "Headphones under $50" → 0 results     → Fix: bias data generator to include
                                              headphones in the <$50 price range
7. Still using wrong field names           → Fix: pass dataColumns to prompt
8. Finally works
```

### What we should have done (1-2 iterations)

```
1. Wrote PRD with interpretation contract (Section 11)
2. Wrote nl-interpretation.md with exact JSON mappings
   (e.g., "top 5 brands" → groupBy:["brand"], agg:sum(unit_price), limit:5)
3. Wrote data-quality.md cataloguing comma-decimal prices, category typos, brand misspellings
4. Wrote prompt-spec.md with rules and examples
   (e.g., "Do NOT add availability filter on in_stock_products")
5. Wrote e2e-scenarios.md with dirty data variants
6. Started building in Cursor — AI agent had everything it needed
7. Minor fixes for edge cases not in spec
8. Done
```

The upfront investment: ~6 extra hours of specification.
The savings: ~20 hours of debugging iterations.
