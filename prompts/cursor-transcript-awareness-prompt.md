# Cursor Prompt: Make Pipeline Transcript-Aware

## Problem

Transcripts (hearing records) are now being ingested into RAG Index 2 alongside decisions, orders, and other court records. But the pipeline treats ALL document types identically — no prompt, rule, or logic distinguishes what someone SAID in a hearing from what the court RULED.

This creates a critical risk: users will confuse testimony/arguments with authoritative court findings.

The `document_type` field already exists in chunk metadata and is rendered in chunk headers as `— transcript`. But no prompt instructs the LLM to treat transcript content differently.

## What Needs to Change

3 files, 9 changes. No schema changes, no retrieval changes, no new intents.

| File | Changes |
|------|---------|
| `lib/prompts.ts` | Steps 1-5: chunk notice, 2 hard rules, response format, judge REJECT/APPROVE |
| `lib/fact-check.ts` | Steps 6-8: chunk notice, transcript vs ruling rules, evidence_type enum |
| `lib/intent-classifier.ts` | Step 9: hearing query examples |

---

## Step 1: `lib/prompts.ts` — Add transcript notice to `formatRetrievedChunks`

In the `formatRetrievedChunks` function, find the `chunks.forEach` loop (around lines 95-102).

**Current:**
```typescript
chunks.forEach((chunk, i) => {
  const title = chunk.metadata.document_title ?? "Unknown";
  const date = chunk.metadata.date_published ?? "n.d.";
  const docType = chunk.metadata.document_type ?? "ICC document";
  lines.push(`[${i + 1}] Source: ${title}, ${date} — ${docType}`);
  lines.push(chunk.content);
  lines.push("");
});
```

**Replace with:**
```typescript
chunks.forEach((chunk, i) => {
  const title = chunk.metadata.document_title ?? "Unknown";
  const date = chunk.metadata.date_published ?? "n.d.";
  const docType = chunk.metadata.document_type ?? "ICC document";
  lines.push(`[${i + 1}] Source: ${title}, ${date} — ${docType}`);
  if (docType === "transcript") {
    lines.push(`[NOTE: This is a hearing transcript. Content represents what was SAID (testimony, arguments, questions) — NOT court rulings or findings.]`);
  }
  lines.push(chunk.content);
  lines.push("");
});
```

---

## Step 2: `lib/prompts.ts` — Add Hard Rules 22-23

In the `HARD_RULES` constant, append these two rules at the end (after rule 21, before the closing backtick):

```
22. When citing a transcript chunk, explicitly indicate the nature of the source. Use framing like "According to testimony in [hearing title] [N]..." or "During the hearing, the prosecution argued that... [N]". NEVER present what someone said in a transcript as if it were a court ruling or finding. A judge's directive or order stated within a transcript IS authoritative; everything else is testimony or argument.
23. Evidence hierarchy for citation framing: decisions/judgments/orders = authoritative court findings ("The Court ruled...", "The Chamber found..."); transcripts = what was said in hearings ("Testimony states...", "The prosecution argued..."); case_records/filings = submissions ("According to the filing..."); legal_texts = foundational law ("Article X of the Rome Statute provides...").
```

---

## Step 3: `lib/prompts.ts` — Extend RESPONSE FORMAT section

In the `getStaticSystemPrompt()` function, find the RESPONSE FORMAT section. After the line:
```
- Clearly distinguish between what ICC documents state and what ICC has not yet ruled on
```

Add this new line:
```
- When a transcript is the basis for a claim, frame it as testimony or argument, not as an ICC finding. A statement in a transcript does not make it an ICC-established fact unless the speaker is the court itself issuing a ruling.
```

---

## Step 4: `lib/prompts.ts` — Update Judge REJECT list

In the `JUDGE_SYSTEM_PROMPT` constant, find the REJECT conditions list. After the last fact-check REJECT item (the one about "Response introduces charges, dates, numbers, or details not found in any retrieved chunk"), add:

```
- (Transcript) Answer presents what a party ARGUED or a witness TESTIFIED in a transcript as if it were an ICC court ruling or finding (e.g., "The Court found X" when the source is actually testimony from a hearing transcript, not a decision)
- (Transcript) Answer omits that a cited claim comes from hearing testimony rather than from a court ruling, when the only supporting source chunk is a transcript
```

---

## Step 5: `lib/prompts.ts` — Update Judge APPROVE / do-not-reject list

In the `JUDGE_SYSTEM_PROMPT` constant, find the "IMPORTANT — do NOT reject for these" section. After the last item (about answering "does X apply?" with grounded reasoning), add:

```
- Answers that correctly frame transcript content as testimony or argument (e.g., "According to testimony in the confirmation hearing...") — this is correct behavior, not hedging
- Answers that cite a judge's in-hearing directive from a transcript as authoritative — judges' in-hearing orders are legitimate court action
```

---

## Step 6: `lib/fact-check.ts` — Add transcript notice to chunk formatting in `buildFactCheckPrompt`

In the `buildFactCheckPrompt` function, find the `chunksSection` construction (around lines 202-207).

**Current:**
```typescript
const chunksSection = chunks
  .map(
    (c, i) =>
      `[${i + 1}] Source: ${c.metadata.document_title ?? "Unknown"}, ${c.metadata.date_published ?? "n.d."} — ${c.metadata.document_type ?? "ICC document"}\n${c.content}`
  )
  .join("\n\n");
```

**Replace with:**
```typescript
const chunksSection = chunks
  .map((c, i) => {
    const docType = c.metadata.document_type ?? "ICC document";
    const transcriptNote = docType === "transcript"
      ? `\n[NOTE: TRANSCRIPT — content is testimony/argument, NOT a court ruling]`
      : "";
    return `[${i + 1}] Source: ${c.metadata.document_title ?? "Unknown"}, ${c.metadata.date_published ?? "n.d."} — ${docType}${transcriptNote}\n${c.content}`;
  })
  .join("\n\n");
```

---

## Step 7: `lib/fact-check.ts` — Add TRANSCRIPT vs RULING DISTINCTION section

In the `buildFactCheckPrompt` function, find the prompt template string. After the `GROUNDING:` section (which ends with "If you are unsure whether a detail is in the documents, re-read them before answering") and BEFORE the `${langNote}` interpolation, insert this new section:

```
TRANSCRIPT vs. RULING DISTINCTION:
Some ICC documents below are hearing transcripts (marked "— transcript" in source header). Transcript content represents:
- What a prosecutor ARGUED (not what the court ruled)
- What a defense counsel CLAIMED (not what the court found)
- What a witness TESTIFIED (not established ICC fact)
- What a judge SAID in a hearing (can be authoritative if it is a ruling or order)

When verifying claims using transcript sources:
- If the only supporting chunks are transcripts, the claim may still be VERIFIED, but your icc_says field MUST note: "Based on [party]'s testimony/argument in the hearing — not a court ruling."
- If a claim asserts a court RULING or FINDING but the only source is transcript testimony (not a decision or order), use UNVERIFIABLE with icc_says: "This was argued/stated in a hearing, but no court ruling confirming this was found in retrieved documents."
- If a decision/order document contradicts what was stated in a transcript, the decision/order governs — use FALSE.
- Never treat what a party argued in a transcript as equivalent to what the court decided.
```

---

## Step 8: `lib/fact-check.ts` — Add `transcript_testimony` to evidence_type enum

In the `buildFactCheckPrompt` function, find the JSON schema section. Change the `evidence_type` line:

**Current:**
```
"evidence_type": "procedural_status|case_fact|legal_framework|timeline|numerical"
```

**Change to:**
```
"evidence_type": "procedural_status|case_fact|legal_framework|timeline|numerical|transcript_testimony"
```

---

## Step 9: `lib/intent-classifier.ts` — Add hearing query examples

In the `INTENT_PROMPT` constant, find the `case_facts` examples line (line 28).

**Current:**
```
- case_facts: "What is Duterte charged with?", "Who are the victims?", "How many counts?", "What are the evidences against Duterte?", "Who are the judges?", "Is Du30 fit to stand trial?", "Who pays for Duterte's defence?", "Where is Duterte detained?", "Did Duterte surrender or was he arrested?", "measures to facilitate attendance"
```

**Change to:**
```
- case_facts: "What is Duterte charged with?", "Who are the victims?", "How many counts?", "What are the evidences against Duterte?", "Who are the judges?", "Is Du30 fit to stand trial?", "Who pays for Duterte's defence?", "Where is Duterte detained?", "Did Duterte surrender or was he arrested?", "measures to facilitate attendance", "What did the prosecutor say at the hearing?", "What was the defense's argument?"
```

---

## Summary of Changes

| Step | File | What Changes |
|------|------|-------------|
| 1 | `lib/prompts.ts` | `formatRetrievedChunks` adds `[NOTE: ...]` for transcript chunks |
| 2 | `lib/prompts.ts` | Hard Rules 22-23: citation framing rules for transcripts + evidence hierarchy |
| 3 | `lib/prompts.ts` | RESPONSE FORMAT: transcript framing guidance |
| 4 | `lib/prompts.ts` | Judge REJECT: catch misframing of testimony as rulings |
| 5 | `lib/prompts.ts` | Judge APPROVE: allow correct transcript framing |
| 6 | `lib/fact-check.ts` | Chunk section: transcript notice inline |
| 7 | `lib/fact-check.ts` | New TRANSCRIPT vs RULING rules in verification prompt |
| 8 | `lib/fact-check.ts` | `evidence_type` enum: add `transcript_testimony` |
| 9 | `lib/intent-classifier.ts` | `INTENT_PROMPT`: hearing query examples |

## What NOT to Change

- `lib/retrieve.ts` — retrieval is document-type-agnostic by design, let RRF handle mixing
- `lib/intent.ts` — transcripts are in index 2, routing is already correct
- `lib/claim-verifier.ts` — grounding check is content-based, not type-based
- `lib/chat.ts` — no orchestration changes needed
- `supabase/schema.sql` — no schema changes needed
- No new intent categories needed — transcript queries are `case_facts` or `fact_check`
