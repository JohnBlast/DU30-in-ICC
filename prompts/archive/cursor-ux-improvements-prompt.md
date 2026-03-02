# Cursor Implementation Prompt — Fact-Check UX Improvements

## Overview

Three UX improvements to the fact-checker UI. All changes are frontend-only (React components + Tailwind CSS). No backend or LLM pipeline changes.

**Files to modify:**
- `components/ChatMessage.tsx` — fact-check display redesign (Issues 1 + 3)
- `components/ChatInput.tsx` — clear paste area after send (Issue 2)

---

## Issue 1: Fact-check results make chat bubbles too long

### Problem
When a fact-check returns multiple claims, the entire result (overall verdict + all claim cards + copy button) renders inline inside the chat bubble, creating an extremely long bubble that pushes other messages out of view.

### Solution: Collapsible fact-check panel with summary header

Replace the current inline `<div className="mb-3 space-y-3">` block (lines 176–216 of `ChatMessage.tsx`) with a collapsible accordion pattern:

1. **Summary header (always visible):** Show a compact one-line summary inside the bubble:
   - Overall verdict badge (existing `VerdictBadge` component)
   - Claim count: e.g., "3 claims verified" or "5 claims checked — 2 false"
   - Expand/collapse chevron toggle button

2. **Expandable detail panel:** The per-claim cards and copy button are hidden by default and toggled by clicking the summary header.

### Implementation

Add a `useState<boolean>` called `expanded`, default `false`.

**Summary header (always visible):**
```tsx
<div
  className="mb-2 flex items-center justify-between cursor-pointer rounded-lg border border-gray-200 bg-white px-4 py-3"
  onClick={() => setExpanded(!expanded)}
>
  <div className="flex items-center gap-3">
    <VerdictBadge verdict={factCheck.overallVerdict} />
    <span className="text-sm text-gray-600">
      {factCheck.claims.length} claim{factCheck.claims.length !== 1 ? "s" : ""} checked
    </span>
  </div>
  <svg
    className={`h-5 w-5 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
</div>
```

**Expandable detail section (conditionally rendered):**
```tsx
{expanded && (
  <div className="mb-3 space-y-3">
    {/* Per-claim cards (Issue 3 redesign below) */}
    {/* Copy fact-check button */}
  </div>
)}
```

### Claim count summary logic

Generate a human-readable summary string for the header. Use a helper:

```tsx
function getClaimSummary(claims: VerifiedClaim[]): string {
  const total = claims.length;
  const falseCount = claims.filter(c => c.verdict === "false").length;
  const verifiedCount = claims.filter(c => c.verdict === "verified").length;

  if (falseCount > 0) return `${total} claim${total !== 1 ? "s" : ""} checked — ${falseCount} false`;
  if (verifiedCount === total) return `${total} claim${total !== 1 ? "s" : ""} verified`;
  return `${total} claim${total !== 1 ? "s" : ""} checked`;
}
```

Display this string instead of the static "N claims checked" text.

---

## Issue 2: Paste area doesn't clear after sending

### Problem
In `ChatInput.tsx` line 29, after submitting, the pasted text is intentionally preserved:
```tsx
setPastedText(toPaste ?? ""); // Keep pasted text so user can retry or ask follow-ups
```
This is confusing — the user expects the paste area to clear after submitting, similar to how the query input clears.

### Solution

In `ChatInput.tsx`, in the `handleSubmit` function, change line 29 to clear the pasted text AND collapse the paste area:

```tsx
// Before (line 29):
setPastedText(toPaste ?? ""); // Keep pasted text so user can retry or ask follow-ups

// After:
setPastedText("");
setShowPaste(false);
```

This clears the paste textarea and collapses the paste section after sending, giving the user a clean input area. They can always re-open it with the "+ Paste" button if needed.

---

## Issue 3: Per-claim card design improvement

### Problem
Current per-claim cards are plain white boxes with basic text layout. The verdict badge and explanation text are stacked vertically with no visual hierarchy. The extracted claim text and ICC response blur together.

### Solution: Redesigned claim cards with left-border verdict indicator

Replace the current claim card markup (lines 183–205 of `ChatMessage.tsx`) with an improved design:

### New claim card design

Each claim card should have:
1. **Left color border** indicating verdict (green = verified, red = false, gray = unverifiable/not in records, blue = opinion)
2. **Verdict badge** on the top-right of the card (not stacked below the claim)
3. **Claim text** as the primary content, clearly quoted
4. **ICC response** in a subtle secondary style below, with a small "ICC documents:" prefix label

```tsx
{factCheck.claims.map((c, i) => {
  const borderColor = {
    verified: "border-l-green-500",
    false: "border-l-red-500",
    unverifiable: "border-l-gray-400",
    not_in_icc_records: "border-l-gray-400",
    opinion: "border-l-blue-400",
  }[c.verdict === "opinion" && c.evidenceType === "out_of_scope" ? "opinion" : c.verdict] ?? "border-l-gray-400";

  return (
    <div
      key={i}
      className={`rounded-lg border border-gray-200 border-l-4 ${borderColor} bg-white px-4 py-3 text-sm shadow-sm`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-gray-900 leading-snug flex-1">
          &ldquo;{c.extractedText}&rdquo;
        </p>
        <div className="shrink-0 pt-0.5">
          <VerdictBadge verdict={c.verdict} evidenceType={c.evidenceType} />
        </div>
      </div>

      {c.verdict === "opinion" && c.evidenceType === "out_of_scope" ? (
        <p className="mt-2 text-sm text-gray-500 italic">
          Outside the scope of the Duterte ICC case.
        </p>
      ) : c.verdict === "opinion" ? (
        <p className="mt-2 text-sm text-gray-500 italic">
          Statement of opinion — not a verifiable factual claim.
        </p>
      ) : c.iccSays ? (
        <div className="mt-2 rounded bg-gray-50 px-3 py-2">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">ICC Documents</p>
          <p className="text-sm text-gray-700 leading-relaxed">{c.iccSays}</p>
        </div>
      ) : null}
    </div>
  );
})}
```

### Key design changes:
- **Left color border** (`border-l-4`) gives instant visual verdict signal without reading the badge
- **Badge top-right** instead of stacked below — reduces vertical space
- **ICC response** in a subtle `bg-gray-50` inset box with uppercase "ICC DOCUMENTS" label — clear visual separation from the claim text
- **`shadow-sm`** adds subtle depth to each card
- **`rounded-lg`** instead of `rounded` for softer corners
- Opinion text shortened and made more concise

---

## Summary of all changes

| File | Change | Lines affected |
|------|--------|----------------|
| `ChatMessage.tsx` | Add `expanded` state, collapsible fact-check panel with summary header | Lines 144-217 (fact-check render block) |
| `ChatMessage.tsx` | Redesign per-claim cards with left-border verdict, badge top-right, ICC inset box | Lines 183-205 (claim card map) |
| `ChatMessage.tsx` | Add `getClaimSummary` helper function | New function, place near other helpers |
| `ChatInput.tsx` | Clear paste text and collapse paste area on submit | Line 29 |

## Testing checklist

- [ ] Fact-check result shows compact summary header with overall verdict and claim count
- [ ] Clicking the summary header expands/collapses the claim details
- [ ] Claim details are collapsed by default
- [ ] Each claim card has correct left-border color matching its verdict
- [ ] Verdict badge appears top-right of each claim card
- [ ] ICC response text appears in gray inset box with "ICC DOCUMENTS" label
- [ ] Opinion and out-of-scope claims show italic explanation text
- [ ] "Copy fact-check" button appears inside the expanded section
- [ ] Paste area clears after sending a message with pasted content
- [ ] Paste area collapses (hides) after sending
- [ ] "+ Paste" button still works to re-open the paste area
- [ ] Normal Q&A messages (no fact-check) render unchanged
- [ ] Copy button (hover icon) still works on all messages
- [ ] Mobile responsiveness — cards don't overflow on small screens
