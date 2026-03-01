# Guide: Implementation Recovery — When Things Go Wrong

> What to do when the AI agent produces broken code, goes in circles, or builds the wrong thing. A playbook for getting back on track without starting over.

---

## The Three Types of "Wrong"

When implementation goes sideways, it's always one of these:

| Type | Symptom | Root cause | Fix |
|------|---------|-----------|-----|
| **Code is broken** | Error messages, crashes, blank screens | Bug in generated code | Fix in Cursor (it's a code problem) |
| **Code works but does the wrong thing** | Feature behaves differently than spec | Spec was ambiguous or Cursor misinterpreted it | Clarify spec, then fix in Cursor |
| **Spec was wrong** | You realize the requirement itself was a mistake | Incomplete product thinking | Update spec in Claude, then adjust code |

Diagnosing which type you're dealing with is the most important step. Don't start fixing until you know.

---

## Recovery Playbook by Symptom

### Symptom: Blank Screen / App Won't Load

**Stay calm. This is almost always a single broken import or syntax error.**

1. Open Cursor's terminal (Cmd+` / Ctrl+`)
2. Look at the error output — the last error is usually the relevant one
3. Copy the error and paste it into Cursor Chat:
   ```
   The app won't load. Here's the error from the terminal:
   [paste error]
   Fix this.
   ```
4. If Cursor can't fix it, check if the error references a file that was recently changed — that's your culprit

**If you've been going back and forth for more than 3 attempts:** Git stash your changes, go back to the last working version, and re-approach the task in smaller steps.

### Symptom: Feature Works But Looks Wrong

**This is usually a CSS/layout issue — straightforward to fix.**

1. Take a screenshot or describe what you see vs what you expected
2. In Cursor Chat, reference the Figma frame (if you have one) or describe the expected layout:
   ```
   The product grid should be 3 columns on desktop, 1 column on mobile.
   Right now it's stacking everything in a single column even on desktop.
   Fix the grid layout in src/components/ProductGrid.tsx.
   ```

### Symptom: Feature Works But Behaves Wrong

**This is the spec-to-code gap — the most common problem.**

1. Open prd.md or TASKS.md and find the relevant requirement
2. Check: did Cursor implement what the spec says, or something different?
3. If different: paste the spec requirement into Cursor and ask it to align:
   ```
   Per prd.md §4: "System shall restrict results to the current tenant's catalog."
   Right now, the search is returning products from all tenants.
   Fix the query to filter by tenant_id.
   ```
4. If the spec is ambiguous (could be read two ways): go to Claude, clarify the requirement, update the spec, then come back to Cursor

### Symptom: Cursor Is Going in Circles

**The AI keeps trying things, reverting, trying again — nothing sticks.**

This means the task is too complex or the context is too muddled. Stop iterating and reset:

1. **Git commit** whatever currently works (even if it's incomplete)
2. **Start a fresh Composer session** in Cursor (the old conversation's context is polluted)
3. **Break the task down** into smaller pieces:
   ```
   Let's take this step by step.
   Step 1: Just create the database query that returns the right data.
   Don't touch the UI yet. Show me the query result.
   ```
4. Verify each step works before moving to the next

### Symptom: Error Messages You Don't Understand

**Don't try to understand the error — just give it to Cursor.**

1. Copy the full error (including the stack trace)
2. Paste into Cursor Chat:
   ```
   I'm getting this error. Explain what it means in plain English,
   then fix it:
   [paste full error]
   ```
3. If Cursor's fix doesn't work after 2 attempts, search the error message on Google — it's often a known issue with a known fix

### Symptom: You Changed Your Mind About a Feature

**This is a spec change, not a bug.**

1. Update the spec:
   ```
   I've changed my mind about [feature]. Instead of [old behavior],
   I want [new behavior]. Update prd.md section [N] to reflect this.
   Also update TASKS.md if the task list needs to change.
   ```
2. In Cursor, tell it about the change:
   ```
   prd.md has been updated. [Feature] now works differently.
   Read the updated §[N] and adjust the implementation.
   ```

---

## The Decision Framework: Fix, Revert, or Rewrite?

When code is broken, you have three options. Here's how to choose:

```
How much of the task works correctly?
│
├── Most of it (80%+)
│   └── FIX: Make targeted corrections
│       How: Point Cursor to the specific broken part
│       Time: 5-15 minutes
│
├── Some of it (30-80%)
│   └── REVERT to last working state, then redo in smaller steps
│       How: git stash or git checkout, then break task into 2-3 parts
│       Time: 15-30 minutes
│
└── Almost none of it (<30%)
    └── REWRITE the task from scratch in a fresh Composer session
        How: New session, re-state the task with clearer instructions
        Time: 10-20 minutes (usually faster than fixing a mess)
```

**The key insight:** Reverting and rewriting is almost always faster than "one more attempt" debugging. PMs tend to over-invest in fixing because it feels like progress. It's not — it's sunk cost.

---

## Scope Management During Implementation

### The AI Added Features You Didn't Ask For

Common with complex tasks. The AI agent adds error handling you didn't specify, UI polish you don't need yet, or entire features that aren't in scope.

**How to handle:**
```
Remove the [feature]. It's not in prd.md and it's out of scope.
Keep only what's defined in Task [N].
```

**Prevention:** Be explicit about scope in your task prompts:
```
Implement ONLY the basic product list. No search, no filtering,
no pagination. Those are separate tasks.
```

### You Discover Something Wasn't Considered

Mid-build, you realize: "wait, what happens when the user has no items?"

**If it's small** (affects one component, one code path): Handle it inline in Cursor.
```
Add handling for the empty state: when there are no products,
show a message "No products yet" with a "Add Product" button.
```

**If it's significant** (affects architecture, data model, or multiple features): Stop. Go to Claude. Update the spec. Then come back.

The litmus test: *Would this change require updating TASKS.md?* If yes, go to Claude first.

### You Want to Change Direction

You're 5 tasks in and realize the whole approach is wrong.

1. **Don't panic.** Git commit everything.
2. **Go to Claude.** Explain what you've built so far and what's not working.
3. **Get Claude to reassess.** Ask: "Given what we've learned, should we restructure the plan or push forward?"
4. **Update TASKS.md** with the revised plan.
5. **Create a new branch** in git for the new direction (keep the old one in case you want to go back).

---

## Prevention: Habits That Reduce Breakage

### Commit after every working task
```bash
git add -A && git commit -m "Task 3: User login flow complete"
```
This gives you a save point to return to.

### Verify before moving on
After each task, manually check that it works. Open the app, click through the flow, check the data. Don't trust "no errors in terminal" — runtime behavior is what matters. See `9 - testing-guide.md`.

### Keep a "discoveries" note
When you learn something during implementation that wasn't in the spec — write it down. A simple text file:
```
DISCOVERIES.md
- Database doesn't support nested arrays — using JSON column instead
- Supabase auth magic links expire in 1 hour, not 24
- Tailwind's `grid-cols-3` needs explicit breakpoints for responsive
```
This becomes input for post-iteration review.

---

## Emergency Recovery: "I Broke Everything"

If the app is completely broken and you can't figure out what happened:

1. **Check git:** `git log --oneline` — find the last commit where things worked
2. **Create a safety branch:** `git branch backup-broken-state`
3. **Reset to the working state:** `git checkout [commit-hash] -- .`
4. **Verify it works**
5. **Re-implement the broken task** in smaller steps, committing after each step

If you haven't been committing (learn from this): ask Cursor to help you identify and revert the changes that broke things. Start from the error message and work backwards.
