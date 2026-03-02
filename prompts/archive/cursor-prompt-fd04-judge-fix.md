# Cursor Prompt: Fix FD-04 Judge False-REJECT on Document Dates

## Problem

FD-04 ("Where is Duterte currently detained, and when was that confirmed in an ICC filing?") is being judge-REJECTED because:

1. The LLM answer references a document's publication date (e.g., "28 February 2026")
2. This date comes from the chunk metadata header injected as `[1] Source: {title}, {date_published} — {document_type}`
3. The judge only cross-references the answer against chunk **body text**, not the metadata header
4. The judge sees the date as "a claim not supported by retrieved chunks" — but it IS supported, just by the metadata line

## Fix

Two changes needed:

### 1. Update judge extra context in `lib/chat.ts`

In the `chat()` function, after constructing `judgeExtraContext` (around line 329–335), add metadata dates as context so the judge knows these dates are legitimate:

```typescript
// After the existing judgeExtraContext construction:

// Provide chunk metadata dates to judge so it doesn't reject date references
const chunkDates = chunks
  .map((c, i) => `[${i + 1}] published: ${c.metadata.date_published ?? "n.d."}`)
  .join(", ");
judgeExtraContext += `\n\nNote: The following document publication dates appear in chunk metadata and may be referenced in the answer: ${chunkDates}`;
```

### 2. Add a false-REJECT prevention clause to the judge prompt in `lib/prompts.ts`

In the `JUDGE_SYSTEM_PROMPT`, add to the "IMPORTANT — do NOT reject for these" section:

```
- Referencing document publication dates from chunk metadata (e.g., citing "28 February 2026" when the source header shows that date) — these dates are part of the provided context, not fabrication
```

Add this line after the existing "Date contextualization" clause.

## Files to modify

| File | Change |
|------|--------|
| `lib/chat.ts` | Add chunk metadata dates to `judgeExtraContext` |
| `lib/prompts.ts` | Add document date clause to judge false-REJECT prevention list |

## Verify

After implementing, run `npm run verify-phase3` — FD-04 should now PASS (judge APPROVE). All other 7 tests should remain PASS.
