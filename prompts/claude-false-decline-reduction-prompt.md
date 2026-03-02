# Prompt for Claude — False Decline Reduction (Safety + Newcomer UX)
#
# Purpose:
# - Reduce false declines and false blocks for normal newcomer questions about the ICC + DU30 case
# - Preserve safety posture (no hallucinations, no political drift, strict redaction boundary)
# - Address known gaps/concerns found during review of `prompts/cursor-false-decline-reduction.md`
#
# Inputs for you (Claude):
# - `prompts/cursor-false-decline-reduction.md`
# - `prompts/system-review-for-llm.md`
# - `nl-interpretation.md`
# - Key code: `lib/chat.ts`, `lib/retrieve.ts`, `lib/deterministic-judge.ts`, `lib/normative-filter.ts`, `lib/intent-classifier.ts`, `lib/intent.ts`, frontend components (see below)
#
# Output:
# A concrete improvement plan with prioritized steps, exact code-level targets, risks, mitigations, and a UX/UI plan.

You are an expert product+engineering reviewer. You are auditing and improving a conservative RAG+Judge Q&A and fact-check system (“The Docket”) about the ICC case against Rodrigo Duterte (DU30).

## Goal
Produce an implementation-ready improvement plan that **reduces false declines / false blocks** for newcomer-friendly questions **without weakening** any hard safety constraints.

## Hard constraints (non-negotiable)
- **ICC-documents-only grounding**: generation may only use retrieved chunks.
- **Citations required** for factual claims (per system contract).
- **Neutrality**: no political advocacy, no loaded terms; no “ICC for/against X”.
- **Guilt/innocence**: never express opinions; avoid phrasing that implies innocence/guilt.
- **Redaction wall**: never infer/guess [REDACTED]; never accumulate reasoning across turns.
- **No regressions**: hallucination rate must remain 0%; safety test suite must continue to pass.
- **Refusal message**: do **not** change the *content* of the flat decline string when the system must refuse. (You may add UI wrappers around it as separate UI elements.)

## Critical concerns you MUST address (from review)
### Concern A — Spec/diagnosis must match the current code, not assumptions
In `lib/chat.ts`, the Q&A “prohibited terms” regex is narrower than “any mention of convicted/acquitted”; diagnose actual match behavior and only propose fixes that target real triggers. Cite the exact regex/patterns you observed.

### Concern B — Deterministic safety gap: “is not guilty/innocent”
Before allowing any policy change where Q&A answers “Is he guilty?” with procedural status, ensure deterministic gates catch unsafe phrasing.

Specifically: today the deterministic checks do **not** obviously catch variants like:
- “He is not guilty.”
- “Duterte is not innocent.”
- “He was found not guilty.”

Your plan MUST include a deterministic safeguard that blocks these, plus tests.

### Concern C — Decline behavior inconsistency
The system’s “chunks=0” behavior may currently return a helpful rephrase message rather than the strict flat decline string. Decide and document one coherent policy:
- Either make behavior strictly match the “flat decline only” constraint everywhere, or
- Keep the helpful retrieval-miss message but clearly classify it as a different UI/system state than out-of-scope refusal (and ensure it doesn’t violate constitutional constraints).

You must recommend ONE approach and describe how to align specs, tests, and UI accordingly.

### Concern D — evidence sufficiency gate is high leverage but high risk
`evidenceSufficiency()` is a hard gate. Removing it may increase recall but risks thin-context answers slipping through.

Propose a safer alternative than “delete the gate entirely”, such as:
- allow 1 chunk only under certain confidence signals (e.g., both FTS+vector agree; similarity above X; chunk contains the key entity; or query is “focused/date/definition” type),
- otherwise keep the gate.

Include clear decision rules and explain how they preserve 0 hallucinations.

## Deliverable format (markdown)
Produce a document with:

### 1) Executive summary
- What changes you recommend, why they improve newcomer Q&A, and how safety is preserved.

### 2) Findings (grounded in files)
- For each major “false decline/block” path, cite the file(s) and the exact mechanism (regex, thresholds, Judge behavior).
- Explicitly correct any mismatches you find in `prompts/cursor-false-decline-reduction.md`.

### 3) Prioritized implementation plan (P0/P1/P2)
For each item include:
- **Behavior change** (before → after)
- **Where** (file + function names)
- **Risks**
- **Mitigations** (deterministic checks, judge nuance, citation integrity, monitoring)
- **Verification** (which existing scripts/tests to run + what new tests to add)

Must cover at minimum:
- intent/routing robustness (inflections, dual-index triggers)
- retrieval recall without noise (thresholds, synonym expansion)
- Q&A prohibited-term handling with safe exemptions (if any)
- deterministic judge coverage for negated guilt statements (Concern B)
- partial-answer support (generator + judge alignment)
- fact-check consistency around numbers-from-paste vs numbers-from-chunks
- monitoring metrics for false decline and judge reject rates

### 4) Regression prevention (release gates)
Provide:
- a small curated “answerable but previously declined” Q&A set (10–20)
- a curated “must refuse” set (10–20)
- measurable targets: judge reject rate, chunks=0 rate, evidence gate rate, prohibited-term block rate

### 5) UX/UI improvements (required)
Add concrete frontend changes that improve newcomer success **without changing** the refusal text itself.

Include:
- **First-run prompt chips** (example questions)
- **“What can I ask?”** expandable explainer (scope examples)
- **Decline wrapper UI**: when backend returns the flat decline string, show separate UI helper text underneath (not part of assistant message)
- **Input affordances**: placeholder rotation; “paste to fact-check” affordance; suggested follow-ups
- **Telemetry hooks**: track which chip was clicked, which declines occurred, rephrase success rate

For each UX/UI item: specify the likely component targets (e.g., `components/ChatMessage.tsx`, `components/ChatInput.tsx` or similar) and acceptance criteria.

## Optional policy decision (explicitly label as optional)
If—and only if—Concern B is fully addressed, you may propose an *optional* policy:
- Answer “Is he guilty?”-type questions with **procedural status only**, using phrasing that avoids “guilty/innocent” words.
- You MUST list all required spec and test updates to safely adopt it.

## Style requirements
- Be specific and implementation-oriented.
- Prefer deterministic-first changes where possible.
- When uncertain, propose the lowest-risk path and include instrumentation to validate in production.

