# Prompt for Claude — Investigate “Indirect co-perpetration list” Failure + Produce Improvement Plan
#
# Use-case: The Docket (ICC DU30 case Q&A / fact-check) refused or failed to answer a newcomer question that should be answerable from ingested ICC documents.
#
# Inputs you should read in the repo:
# - `prompts/system-review-for-llm.md` (architecture + failure points)
# - `nl-interpretation.md` (intent routing + acceptance scenarios + Phase 3 false-decline reduction)
# - `prompt-spec.md` and `constitution.md` (hard constraints)
# - Key code: `lib/chat.ts`, `lib/retrieve.ts`, `lib/intent-classifier.ts`, `lib/intent.ts`, `lib/prompts.ts`, `lib/claim-verifier.ts`
# - Frontend: `app/page.tsx`, `components/ChatMessage.tsx`, `components/ChatInput.tsx`
#
# Output you must produce:
# A concrete, prioritized improvement plan that anticipates newcomer questions like the one below, while preventing regressions.

You are an expert engineer auditing The Docket: a citation-grounded, politically neutral RAG Q&A + fact-checker about the ICC case against Rodrigo Duterte (DU30). The tool must answer only from ICC documents in its knowledge base and must refuse out-of-scope/opinion questions with the exact flat decline string: “This is not addressed in current ICC records.”

## Hard constraints (do not violate)
- ICC documents are the only source of truth (no news, no Wikipedia).
- Every surfaced factual claim must be grounded in retrieved chunks with inline citations.
- No opinions on guilt/innocence/culpability; no politically loaded language.
- No [REDACTED] inference; redaction boundary is absolute.
- Maintain 0 hallucinations and avoid regressions.
- You may propose UX/UI wrappers, but you must not change the refusal string content.

## The failure report (real user transcript)
User asked:

> “Who are Indirect co-perpetration in DU30's case?”

System response included an explanation of “indirect co-perpetration” and referenced two sources (DCC + a pre-confirmation brief), but did not list names and then later declined follow-ups:

Follow-up 1:
> “can you list them?”
→ declined with: “This is not addressed in current ICC records.”

Follow-up 2:
> “then what about Ronald ‘Bato’ DELA ROSA”
→ declined with: “This is not addressed in current ICC records.”

The user asserts that the names are clearly listed in the ICC PDF:
`https://www.icc-cpi.int/sites/default/files/CourtRecords/0902ebd180dbe2bf.pdf`

## What you must do

### 1) Diagnose root causes (code-level)
Explain *why* this happens in the current pipeline, referencing specific mechanisms in:
- intent classification (including how it handles multi-turn follow-ups like “list them”)
- retrieval and thresholds (why the “names list” chunk might not be retrieved even if ingested)
- claim-level grounding (why names may be stripped if not in retrieved chunks)
- judge / deterministic gates (if relevant)
- UI decline wrapper behavior (why users see repeated decline blocks)

You must consider and evaluate at least these hypotheses:
- **H1: Multi-turn follow-ups are misclassified** because the classifier does not receive conversation history (so “list them” becomes `out_of_scope`).
- **H2: Retrieval misses the list** because list chunks contain names but not the query term (“indirect co-perpetration”), so neither vector nor FTS returns them.
- **H3: Document not ingested / wrong URL discovered** (the PDF exists publicly but isn’t in KB because discovery didn’t follow through to the PDF, or doc-type filtering excluded it).
- **H4: Grounding strips output** (LLM tries to list names, but claim verifier strips them because the names are not present in retrieved chunks).

### 2) Propose improvements (prioritized P0/P1/P2)
Your plan must include:
- **Multi-turn follow-up handling** that correctly resolves “them/that/this/what about X” questions without relaxing safety. (Examples: adding conversation history to intent classification; adding a deterministic follow-up rewriter; or adding a “follow-up intent carryover” strategy.)
- **List retrieval improvements** for “who are the X” questions:
  - query expansion for synonyms like “Co-Perpetrators”, “members of the common plan”, “common plan”, “agreement”, etc.
  - a “same-document neighborhood fetch” strategy: after retrieving a relevant chunk from a doc, fetch adjacent chunks from the same `document_id` to capture list sections that don’t match the query lexically.
  - changes to top-k for “who are / list / name” questions.
- **Ingestion/discovery verification** for court-record pages → PDF follow-through:
  - ensure `/court-record/...` pages result in ingesting the linked `/sites/default/files/CourtRecords/*.pdf` (not only the HTML wrapper).
  - ensure doc type detection doesn’t exclude critical filings.
- **Answer shaping**: if names are not found in retrieved chunks, do a safe partial answer:
  - explain the concept,
  - explicitly state that the names are not present in the retrieved passages (or not present in current KB),
  - suggest the user paste the relevant passage for paste-text mode (this suggestion can be UI-level if the refusal string policy is strict).

### 3) Regression prevention
Add explicit tests for this class of failures:
- A Q&A test where the system *must* retrieve and list names **when they exist in the KB** (with citations).
- A Q&A test where the system *must not* invent names when the KB doesn’t contain them.
- A multi-turn follow-up test:
  - Turn 1: ask about indirect co-perpetration in DU30 case
  - Turn 2: “list them”
  - Expectation: does not become `out_of_scope`; either lists names with citations or clearly says names aren’t present in retrieved chunks.
- A “what about [named person]” test: if the person is named in ICC docs, answer with citations; otherwise correctly say not addressed in current ICC records / or “not found in retrieved documents” depending on system policy.

Include monitoring metrics:
- out_of_scope rate for short follow-ups (“list them”, “what about X”)
- retrievalConfidence and chunks=0 rate on those follow-ups
- judge reject rate for list answers

### 4) UX/UI improvements (required)
Propose UI changes that reduce user frustration and guide them to success *without changing backend refusal string content*:
- When the backend refuses, show UI-only “Try pasting the paragraph that lists the names” guidance.
- Add “Ask follow-up” chips under answers that are likely to prompt list requests (e.g., chips: “List the named co-perpetrators (if any)”, “Show where this appears in the brief”).
- Add a “Paste excerpt” affordance near declines that often result from missing context.

## Output format
Return a markdown plan with:
- ## Diagnosis
- ## Improvement plan (P0/P1/P2)
- ## Test plan (new + existing)
- ## UX/UI plan
- ## Risks and mitigations

Be specific: name files/functions to change and give decision rules (not vague advice).

