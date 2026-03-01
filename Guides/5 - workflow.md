# Workflow Guide — Step-by-Step Process

> From idea to shipped product. When to create each document, in what order, and how Claude and Cursor fit together.

---

## Overview

This guide walks through the complete product development workflow. Each phase maps to a tool (Claude or Cursor) and references the appropriate template.

This workflow covers both the **Starter tier** (Constitution + PRD §1-10 + Checklist) and the **Advanced tier** (additional documents for LLM, pipeline, RAG, and recommender features). Steps marked **(Advanced)** can be skipped for standard features.

---

## Phase 1: Define (Claude)

**Goal:** Capture what the product does and why it exists.

### Step 1.0: Write the Constitution

**Tool:** Claude
**Template:** `templates/constitution.md`

**Prompt Claude:**

```
I'm building [description]. Before we write any requirements, help me
establish project principles. I care about [your priorities]. Ask me
questions until you understand my constraints, then produce a
constitution.md following this template: [paste template]
```

**Quality check:** Does each principle help resolve a real trade-off? If not, it's too vague.

**Time estimate:** 30 minutes

### Step 1.1: Write the PRD

**Tool:** Claude
**Template:** `templates/prd.md`

**Two approaches:**

**Option A: You already have a PRD.** Give it to Claude:

```
Here's my PRD. Read it critically. Tell me every assumption I'm making
that isn't explicit, every edge case I haven't addressed, and every
decision I'm deferring that will cause problems during implementation.
Then interview me on the gaps.
```

**Option B: Start from scratch.** Tell Claude what you want:

```
I want to build [description]. Interview me about this until you have
enough detail to write a complete PRD using this template: [paste template].
Focus on sections 1-10. Push back on anything vague.
```

**What to write:**

- Sections 1–10 (standard PRD sections): Overview, users, journeys, requirements, data model, relationships, success criteria, edge cases, capabilities, API contract
- If your feature has an LLM: also write Sections 11–14
- If your feature has a data pipeline: also write Sections 12–13

**Decision point:**

```
Does your feature involve an LLM?
├── YES → Write Sections 11-14 in the PRD
│         Does it also use RAG?
│         ├── YES → Also write Section 15 (RAG Contract)
│         │         Then proceed to Step 1.2 (NL Interpretation Contract)
│         └── NO  → Proceed to Step 1.2 (NL Interpretation Contract)
└── NO  → Skip Sections 11-15
          Does it have a data pipeline?
          ├── YES → Write Sections 12-13
          │         Then proceed to Step 1.3 (Data Quality Contract)
          └── NO  → Proceed to Phase 2

Does your feature recommend/rank items for users?
├── YES → Write Section 16 (Scoring & Ranking Contract)
│         Read guides/recommender-systems.md for the three extra contracts
│         Then proceed to Step 1.3 (Data Quality — include §6 Feedback Loop)
└── NO  → Skip Section 16
```

**Time estimate:** 2-4 hours for a medium feature

### Step 1.2: Write the NL Interpretation Contract (Advanced — LLM features only)

**Tool:** Claude
**Template:** `templates/nl-interpretation.md`

**Prompt Claude:**

```
Based on the PRD we wrote, I need an NL interpretation contract.
Start by listing 20+ example user prompts this feature should handle.
Group them into intent categories. For each category, write the exact
structured JSON output. Use this template: [paste template]
```

**Quality check:** If you can't write the exact JSON output for a given prompt, the spec is too vague.

**Time estimate:** 1-2 hours

### Step 1.3: Write the Data Quality Contract (Advanced — pipeline features only)

**Tool:** Claude
**Template:** `templates/data-quality.md`

**What to write:**

1. Get a sample of your actual data
2. Catalogue every dirty pattern you see (case, typos, format)
3. For each pipeline stage, document what gets normalized and what doesn't
4. Map field aliases
5. Define number and date parsing rules

**Quality check:** Can you trace a single dirty value through every pipeline stage and predict what it looks like at the end?

**Time estimate:** 1-2 hours

---

## Phase 2: Specify & Clarify (Claude)

**Goal:** Challenge the spec, fill gaps, ensure nothing is ambiguous.

### Step 2.1: Have Claude Interrogate Your Spec

Feed your PRD (and companion documents) to Claude:

```
Here are all my spec documents. Read them as if you were the developer
who has to build this. What questions would you need answered? What's
ambiguous? What will break?
```

Focus Claude's questioning on:

- **For LLM features:** "How should the LLM handle [ambiguous query]?" "What field names should it use?" "What happens when it produces invalid output?"
- **For data pipelines:** "What format are numbers in after [stage]?" "How is the correct tenant resolved?" "What happens to dirty values?"
- **For recommenders:** "What happens for new users?" "What ranking rules override scoring?" "What bias mitigations are needed?"
- **For all features:** "What's the expected behavior when [edge case]?" "How does [component A] communicate with [component B]?"

**Quality check:** If Claude doesn't surface new questions, either your PRD is very thorough or you need to prompt more specifically about data formats, field naming, and error states.

### Step 2.2: Write the Prompt Spec (Advanced — LLM features only)

**Tool:** Claude
**Template:** `templates/prompt-spec.md`

Now that the spec is refined, design the system prompt with Claude.

**Time estimate:** 1 hour

---

## Phase 3: Plan (Claude)

**Goal:** Make technical decisions and create an architecture document.

### Step 3.1: Create the Architecture

**Tool:** Claude

```
https://github.com/JohnBlast/DU30-in-ICC.git
```

If you haven't chosen a tech stack yet, see [Tech Stack Picker](tech-stack-picker.md).

### Step 3.2: Write E2E Scenarios (Advanced)

**Tool:** Claude
**Template:** `templates/e2e-scenarios.md`

Now that the plan exists, create concrete test scenarios. One scenario per supported query/action pattern.

**Time estimate:** 1-2 hours

---

## Phase 4: Tasks (Claude)

**Goal:** Break the plan into actionable implementation tasks.

### Step 4.1: Create the Task Breakdown

**Tool:** Claude

```
Based on the spec, architecture, and tech stack, break the implementation
into an ordered task list. Each task should:
- Be completable in one Cursor session (15-30 min)
- List specific files to create/modify
- Have a clear "done condition" I can verify manually
- Note dependencies on prior tasks
Output as TASKS.md.
```

### Step 4.2: Complete the Handoff Checklist

**Template:** `templates/handoff-checklist.md`

Go through every checkbox. Any unchecked item is a risk.

### Step 4.3: Generate `.cursorrules`

**Tool:** Claude

```
Based on our constitution, spec, architecture, and task list, generate
a .cursorrules file that gives Cursor the context it needs. Include:
references to each spec document, the tech stack, project structure
conventions, and implementation rules.
```

---

## Phase 5: Build (Cursor)

**Goal:** Implement the product, task by task.

### Step 5.1: Set Up the Project

Open Cursor with your project folder containing all spec documents and `.cursorrules`.

**First task** is usually project scaffolding:

```
Implement Task 1 from TASKS.md: [scaffold description].
Set up the project structure per ARCHITECTURE.md.
```

### Step 5.2: Implement Task by Task

For each task, open Cursor's Composer and give it the specific task with spec references:

```
Implement Task [N]: [task description]
Per SPEC.md §[X]: [relevant requirement]
Per ARCHITECTURE.md: [relevant structural decision]
Done condition: [what to verify]
```

**After each task:**

1. Verify it works (see [Testing Guide](testing-guide.md))
2. Git commit (see [Git Survival Guide](git-survival-guide.md))
3. Move to the next task

### Step 5.3: Handle Issues During Build

- **Code doesn't work:** Fix in Cursor. See [Implementation Recovery](implementation-recovery.md).
- **Spec is wrong or incomplete:** Go to Claude, update the spec, come back to Cursor.
- **You're stuck:** Go to Claude and describe the problem. Get advice, then apply in Cursor.

**Figma integration (if you have designs):** For tasks that involve UI, point Cursor to your Figma frames during implementation. See `guides/figma-mcp.md`.

**Observability check:** After implementation, verify logging is in place per the handoff checklist (Section G). Every component should log input/output counts at boundaries and log *why* rows are dropped or transformed.

### Step 5.4: Checkpoints

Every 3-5 tasks, do a full walkthrough:

1. Go through every completed user journey end-to-end
2. Check data in the database
3. Compare against the spec
4. Git tag the checkpoint

### Step 5.5: Test Against E2E Scenarios

After implementation, manually verify each E2E scenario. If any fail, check the handoff checklist diagnostic table for which document needs updating.

---

## Phase 6: Ship (Cursor + Hosting Platform)

**Goal:** Get the product online.

See [Shipping Guide](shipping-guide.md) for deployment instructions.

---

## Phase 7: Learn (Claude)

**Goal:** Capture lessons for next time.

See [Lessons Learned](lessons-learned.md) template.

---

## Summary Timeline


| Phase                | Tool                | Duration  | Key Output                                |
| -------------------- | ------------------- | --------- | ----------------------------------------- |
| 1. Define            | Claude              | 3-6 hours | Constitution, PRD, companion docs         |
| 2. Specify & Clarify | Claude              | 1-2 hours | Refined spec, prompt spec                 |
| 3. Plan              | Claude              | 1-2 hours | ARCHITECTURE.md, E2E scenarios            |
| 4. Tasks             | Claude              | 30-60 min | TASKS.md, .cursorrules, handoff checklist |
| 5. Build             | Cursor              | Varies    | Working product                           |
| 6. Ship              | Cursor + Vercel/etc | 30-60 min | Live URL                                  |
| 7. Learn             | Claude              | 30 min    | Lessons learned doc                       |


**Total PM prep time before implementation:** 3-5 hours for a standard feature, 6-12 hours for a complex LLM feature, 10-16 hours for LLM + RAG.

**Investment return:** In past projects, skipping 4 hours of upfront specification cost 20+ hours of debugging iterations.