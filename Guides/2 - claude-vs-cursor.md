# Guide: Claude vs Cursor — When to Use Which

> The single biggest mistake PMs make when vibe-coding is using the wrong tool for the task. Claude and Cursor are good at different things. Using them correctly cuts debugging time in half.

---

## The Core Principle

**Claude is for thinking. Cursor is for building.**

Claude excels at understanding your intent, challenging your assumptions, producing structured documents, and reasoning about architecture. It sees the big picture.

Cursor excels at writing code within the context of your project — it sees your files, understands your codebase, and can make changes across multiple files. It sees the details.

When you blur this line — asking Cursor to architect, or asking Claude to write production code without project context — you get worse results from both.

---

## Decision Table

| Task | Use Claude | Use Cursor | Why |
|------|:----------:|:----------:|-----|
| Draft or refine a PRD | ✓ | | Claude can interrogate your requirements conversationally |
| Challenge assumptions in your spec | ✓ | | Claude asks "what about X?" without project bias |
| Choose a tech stack | ✓ | | Claude can reason about trade-offs without defaulting to what's in the codebase |
| Write the constitution | ✓ | | Needs broad thinking, not code context |
| Break a plan into tasks | ✓ | | Claude produces cleaner task lists without being distracted by existing code |
| Design a system prompt | ✓ | | Prompt design needs iteration and reasoning, not file access |
| Write the NL interpretation contract | ✓ | | Needs careful reasoning about intent categories |
| Research a library or framework | ✓ | | Claude can search the web and reason about options |
| Implement a task (write code) | | ✓ | Cursor sees your project structure and existing code |
| Fix a bug | | ✓ | Cursor can read the error, find the file, and fix in context |
| Add a feature to existing code | | ✓ | Cursor knows what's already built |
| Refactor or restructure code | | ✓ | Cursor can make changes across files |
| Write tests | | ✓ | Cursor knows your test framework and file patterns |
| Debug a build/runtime error | | ✓ | Cursor can read terminal output and source files together |
| Decide whether to fix code or update spec | ✓ | | This is a product decision, not a code decision |
| Generate sample data / seed files | | ✓ | Cursor can write it in the right format for your project |
| Explain what existing code does | Both | Both | Claude if you paste it; Cursor if it's in your project |
| Write a deployment config | | ✓ | Cursor knows your project structure and dependencies |

---

## The Handoff: Claude → Cursor

The most critical moment is when you move from specification (Claude) to implementation (Cursor). Here's how to do it cleanly.

### What Claude Produces

By the end of your Claude conversation, you should have:

1. **`constitution.md`** — Project principles
2. **`SPEC.md`** (or `prd.md`) — Complete product requirements
3. **`ARCHITECTURE.md`** — Tech stack, project structure, key decisions
4. **`TASKS.md`** — Ordered task list with file paths and done conditions
5. **`.cursorrules`** — Instructions for Cursor (Claude can generate this for you)

### What to Put in Cursor

Drop all spec documents into your project root. Then create or update `.cursorrules`:

```markdown
# Project Rules

You are building [project name].

Before writing any code, read these documents:
- CONSTITUTION.md — Project principles and decision framework
- SPEC.md — Product requirements and acceptance criteria
- ARCHITECTURE.md — Tech stack and structural decisions
- TASKS.md — Implementation plan (work through in order)

## Implementation Rules
- Implement tasks from TASKS.md in order. Do not skip ahead.
- After each task, verify it meets the acceptance criteria in SPEC.md.
- If something in the spec is ambiguous, flag it — do not guess.
- Use the exact field names defined in SPEC.md §5.
- Follow the project structure defined in ARCHITECTURE.md.
```

### When to Go Back to Claude

While building in Cursor, go back to Claude when:

- You realize the spec has a gap (something wasn't considered)
- You need to make a product decision ("should this be a modal or a new page?")
- The task list needs restructuring because of a discovery during implementation
- You want to understand a concept before implementing it
- You're stuck and want to reason through the problem before trying code fixes

Don't go back to Claude for: "fix this error", "write this component", "add this CSS" — those are Cursor tasks.

---

## Which Model, Where: A Practical Guide

You're paying for AI in two places — Claude.ai (or the Claude app) for thinking, and Cursor for building. Each context has different models available, and the right choice depends on the task.

### Claude.ai / Claude App (for specification work)

| Model | When to use | Why |
|-------|------------|-----|
| **Opus 4.6** | Writing PRDs, challenging your spec, architecture decisions, designing system prompts, complex reasoning about edge cases | Most intelligent model available. Deep reasoning catches gaps in your spec that cheaper models miss. Worth the message limit for specification work because spec errors cost 10x more to fix during implementation. |
| **Sonnet 4.6** | Generating `.cursorrules`, writing task breakdowns, formatting documents, research with web search, simpler clarifications | Matches or exceeds Opus 4.5 quality at a fraction of the cost. Fast and reliable for structured output. Use this as your default when you're producing documents, not interrogating them. |

**The rule:** Use Opus 4.6 when you need Claude to *think hard* — challenge your assumptions, find gaps, reason about architecture. Use Sonnet 4.6 when you need Claude to *produce output* — write documents, format specs, generate task lists. If you're running low on Opus messages, draft with Sonnet and then switch to Opus for a critical review pass.

### Cursor (for implementation)

Cursor gives you access to multiple model providers. Here's how to use them:

| Model | Best for | Speed | Credit cost | Notes |
|-------|---------|-------|-------------|-------|
| **Cursor Composer** | Default for most coding tasks — implementing features, making changes across files, iterating quickly | Very fast (~30s per turn) | Low | Cursor's own model. Purpose-built for agentic coding. Excellent at navigating large codebases and using tools. Best speed-to-quality ratio for everyday coding. Use this as your workhorse. |
| **Claude Sonnet 4.5** | Complex logic, careful refactoring, tasks that need deep understanding of your spec docs, subtle bug fixes | Medium | Medium | Better reasoning than Composer. Use when Composer's output is "close but not quite right" or when the task involves nuanced business logic from your spec. |
| **Claude Opus 4.6** | Large architectural refactors, tricky multi-file changes, debugging complex issues where other models fail | Slow | Expensive | The "call in the expert" model. Don't use for everyday tasks — it burns through credits fast. Reserve for when Sonnet and Composer can't solve the problem. |
| **GPT-5** | Alternative perspective when Claude models get stuck, sometimes better at CSS/styling, broad general coding | Medium | Medium | Useful when Claude models are being overly cautious or going in circles. Different "brain" can break deadlocks. |
| **Gemini 3 Pro** | Research tasks, reading large codebases, generating documentation | Medium | Medium | Large context window. Good for "read this entire codebase and suggest improvements." |
| **Haiku 4.5** | Simple edits, quick fixes, small changes, routine tasks | Very fast | Very low | "Change this button text", "add a margin here", "rename this variable". Don't overthink it — Haiku handles the trivial stuff. |

### The Model Ladder: Escalate When Stuck

When a task isn't working, escalate up the model ladder instead of repeating the same prompt:

```
Task not working?
│
├── Try 1: Cursor Composer (fast, cheap, handles 80% of tasks)
│   └── If it gets it wrong...
│
├── Try 2: Claude Sonnet 4.5 (better reasoning, understands nuance)
│   └── If it still struggles...
│
├── Try 3: Claude Opus 4.6 (maximum intelligence, expensive)
│   └── If even Opus can't do it...
│
├── Try 4: Switch to GPT-5 (different model, different approach)
│   └── If nothing works...
│
└── The problem is in your spec, not the model.
    Go back to Claude.ai and rethink the requirement.
```

### Managing Cursor Credits

Cursor uses a credit system where different models cost different amounts. Heavy models like Opus can burn through credits fast. Here's how to be smart about it:

**Save expensive models for expensive problems.** Implementing a basic CRUD page? Composer or Haiku. Debugging a complex race condition in your auth flow? That's when you bring in Sonnet or Opus.

**Use Plan Mode for complex tasks.** Cursor 2.0 lets you plan with one model and execute with another. Use Sonnet or Opus to create the plan, then let Composer execute the steps. This gets you smart planning with fast execution.

**Don't use Opus in Cursor for things Claude.ai does better.** If you need to reason about whether your data model is right, do that in Claude.ai (Opus 4.6 with web search). Don't waste Cursor Opus credits on product thinking.

### The Complete Model Map

```
SPECIFICATION (Claude.ai)              IMPLEMENTATION (Cursor)
─────────────────────────              ────────────────────────

PRD & Requirements ─── Opus 4.6        Simple features ────── Composer
Architecture ───────── Opus 4.6        Everyday coding ────── Composer
Edge case analysis ─── Opus 4.6        Complex logic ──────── Sonnet 4.5
                                       Tough debugging ────── Opus 4.6
Task breakdown ─────── Sonnet 4.6      Quick fixes ────────── Haiku 4.5
.cursorrules ───────── Sonnet 4.6      Style/CSS ──────────── GPT-5
Formatting docs ────── Sonnet 4.6      Stuck? ─────────────── Switch models
Research ───────────── Sonnet 4.6
                       (with web search)
```

---

## Anti-Patterns to Avoid

### Don't: Ask Cursor to write your PRD
Cursor will produce a PRD shaped like code comments — it'll focus on implementation details and miss product thinking. Use Claude.

### Don't: Paste your entire codebase into Claude
Claude doesn't need your code to write good specs. It needs your *intent*. Give it the problem, not the solution.

### Don't: Ask Claude to fix a runtime error without context
Claude can't see your project. If you paste an error, also paste the relevant code, the file structure, and what you expected. Better yet, just use Cursor — it already has all of that.

### Don't: Use Cursor to make product decisions
"Should we support multi-tenancy?" is a Claude question. "How do I implement tenant isolation in this Supabase schema?" is a Cursor question.

### Don't: Switch tools mid-task
If you're implementing a task in Cursor and realize the spec is wrong, don't try to fix the spec in Cursor. Go to Claude, update the spec, then come back to Cursor with the corrected context.

---

## Quick Reference

```
I need to...
│
├── Think about what to build          → Claude
├── Write requirements                 → Claude
├── Challenge my assumptions           → Claude
├── Choose technologies                → Claude
├── Break work into tasks              → Claude
├── Design an LLM prompt               → Claude
├── Research a library                  → Claude (with web search)
│
├── Write code                         → Cursor
├── Fix a bug                          → Cursor
├── Add a feature                      → Cursor
├── Write tests                        → Cursor
├── Debug errors                       → Cursor
├── Refactor                           → Cursor
├── Deploy                             → Cursor
│
└── Understand what went wrong         → Claude (for product/spec issues)
    and decide what to do about it       Cursor (for code/runtime issues)
```
