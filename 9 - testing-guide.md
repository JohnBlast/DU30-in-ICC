# Guide: Testing as You Go

> How to verify each task works before moving on. Written for PMs who don't write test suites — practical, manual validation that catches real bugs.

---

## The Rule

> **Never start Task N+1 until Task N is verified.** Every unverified task is a landmine for the next one.

Skipping verification is the most expensive mistake in vibe-coding. A bug in Task 3 that you discover during Task 7 takes 5x longer to fix because now you have to untangle four tasks of code built on a broken foundation.

---

## The Verification Loop

After Cursor completes a task:

```
1. Save all files (Cmd+S / Ctrl+S)
2. Check the terminal for errors (red text = problem)
3. Open the app in your browser
4. Walk through the happy path (does it do what the spec says?)
5. Try one edge case (what happens with empty input, no data, wrong data?)
6. If it works → git commit → move to next task
7. If it doesn't → fix before moving on
```

---

## What to Check for Each Task Type

### UI / Page Tasks
- Does the page load without errors?
- Does it match the layout described in the spec (or Figma)?
- Do all buttons/links do something (even if it's a placeholder)?
- Does it look reasonable on mobile? (Resize your browser window)
- Is there a loading state while data fetches?
- What does it look like with no data (empty state)?

### Data / API Tasks
- Does the API endpoint return data? (Check browser's Network tab: right-click → Inspect → Network)
- Is the data shape correct? (Right fields, right types)
- Does it return the right data for different inputs?
- What does it return with no matching data? (Should be an empty array, not an error)
- Does it respect access controls? (Can you see data you shouldn't?)

### Auth / Login Tasks
- Can you sign up / log in?
- Are you redirected to the right page after login?
- If you go to a protected page without logging in, are you redirected to login?
- Does logout work?
- Does the session persist when you refresh?

### Form Tasks
- Can you submit with valid data?
- What happens with empty required fields?
- What happens with invalid data (wrong email format, text in number field)?
- Does the success message / redirect work?
- Is the data actually saved? (Check by refreshing and looking at the list/table)

### Search / Filter Tasks
- Does searching return relevant results?
- Does searching for something that doesn't exist show "no results"?
- Do filters narrow results correctly?
- Can you clear filters and get all results back?
- Does the result count update?

---

## The Quick Smoke Test Prompt

After a task is done, ask Cursor to give you a verification checklist:

```
Task [N] is complete. Give me a step-by-step manual testing checklist 
I can follow in the browser to verify this task works correctly.
Include both happy path and one edge case.
```

This produces a checklist tailored to the specific task, which is faster than writing your own.

---

## Using Browser Developer Tools (The Minimum You Need)

You don't need to be a developer to use these three things:

### 1. Console (for errors)
- **Open:** Right-click page → Inspect → Console tab
- **Look for:** Red text = error. Yellow text = warning (usually fine).
- **Action:** Copy red errors and paste into Cursor Chat for diagnosis.

### 2. Network Tab (for API calls)
- **Open:** Right-click page → Inspect → Network tab
- **Look for:** Red rows = failed API calls. Click a row to see the response.
- **Action:** Check that API calls return 200 (success) and the response body has the right data.

### 3. Responsive Mode (for mobile)
- **Open:** Right-click page → Inspect → Toggle device toolbar (phone icon)
- **Look for:** Layout breaking, text overflowing, buttons too small to tap
- **Action:** Check at least "iPhone 14" and "iPad" sizes.

---

## Verification Scripts (The Docket)

The project includes automated verification scripts. Run these before deploying:

| Script | Purpose |
|--------|---------|
| `npm run verify-guardrails` | Out-of-scope, redacted, non-English, multi-turn neutrality, paste-text bias |
| `npm run verify-e2e` | E2E scenarios from PRD §17 (ICC law, case facts, glossary, etc.) |
| `npm run verify-legal-questions` | 22 legal questions across 9 categories (jurisdiction, charges, procedure, etc.) |
| `npm run check-retrieval -- "<query>"` | Debug what chunks RAG returns for a query |

If any script fails, fix before proceeding. See handoff-checklist.md §I for Quick Verification.

---

## When to Ask Cursor for Automated Tests

For most vibe-coded MVPs, manual verification is enough. But ask Cursor to write automated tests when:

- **The feature involves calculations** (totals, percentages, scoring) — manual math checking is error-prone
- **The feature has data transformations** (ETL, format conversion) — you need to verify many input patterns
- **The feature will be iterated on** — tests prevent regressions when you change things later
- **You're building an API** that other code depends on — the contract needs to be enforced

**How to ask:**
```
Write tests for the price calculation logic in src/lib/pricing.ts.
Cover: standard prices, comma-decimal prices ("29,99"), null values,
and negative values. Use [your test framework, e.g., Vitest].
```

---

## The Checkpoint System

After every 3-5 tasks, do a "checkpoint" — a more thorough review:

### Checkpoint Checklist

1. **Full walkthrough:** Open the app and go through every user journey in the spec from start to finish
2. **Data check:** Look at the actual data in your database (Supabase dashboard, database viewer, etc.) — does it look right?
3. **Spec alignment:** Open prd.md and compare each completed feature against the requirements. Anything drifting?
4. **Cross-feature:** Do the features you've built work together? (e.g., can you create a product, then search for it, then view it?)
5. **Git tag:** Mark this checkpoint so you can return to it:
   ```bash
   git tag checkpoint-v1 -m "Tasks 1-5 complete and verified"
   ```

### What to Do at a Checkpoint

If everything works: celebrate, commit, move on.

If something is drifting from the spec:
1. Note the drift in DISCOVERIES.md
2. Decide: is the spec wrong, or is the code wrong?
3. If spec is wrong → update in Claude
4. If code is wrong → fix in Cursor before proceeding

---

## Testing Data: Making Sure You Have What You Need

Many tasks fail verification because there's no test data. Before starting implementation:

**Ask Cursor to create seed data:**
```
Create a seed file at src/lib/seed.ts that populates the database with:
- 3 users (admin, regular, new user with no data)
- 10 products across 3 categories
- 5 orders (including one cancelled)
- Price values including comma-decimal format ("29,99")

Per prd.md §5, use these exact field names: [list fields]
```

**Good seed data includes:**
- Happy path data (normal values that should work)
- Edge case data (empty strings, nulls, zero values)
- Boundary data (very long names, maximum quantities, prices with many decimals)
- Format variations (if your spec mentions dirty data patterns)

---

## The "It Looks Done But Is It?" Checklist

Before declaring any feature complete:

- [ ] Happy path works end-to-end (not just individual screens)
- [ ] At least one edge case tested (empty state, no data, invalid input)
- [ ] No red errors in browser console
- [ ] No failed API calls in Network tab
- [ ] Data actually persists (refresh the page — is it still there?)
- [ ] Navigation works (can you get to and from this feature?)
- [ ] The feature matches what the spec says, not just "something that works"
