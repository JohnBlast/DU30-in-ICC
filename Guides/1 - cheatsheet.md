# Toolkit Cheat Sheet

> **Read this first.** 5 minutes. Covers 80% of what you need.

---

## The One Rule

> Before you tell an AI agent to build something, specify **what crosses every boundary**. The agent will guess at anything you don't make explicit — and every guess is a potential debugging loop.

---

## The Stack

| Step | Tool | What you do |
|------|------|------------|
| 1. Think | **Claude** | Write requirements, challenge assumptions, produce spec documents |
| 2. Bridge | **Your spec docs** | Constitution + PRD + Checklist (+ advanced docs if needed) |
| 3. Build | **Cursor** | Implement task-by-task from your specs |

**Key rule:** Use Claude for *thinking and specifying*. Use Cursor for *building and coding*. Don't blur the line — see [Claude vs Cursor Guide](guides/claude-vs-cursor.md) for when to use which.

---

## Starter Tier (Every Project)

**3 documents. ~3 hours. Covers standard features, CRUD apps, dashboards, and simple integrations.**

| # | Document | What to write | Time |
|---|----------|--------------|------|
| 1 | **Constitution** (`constitution.md`) | Your principles: who the users are, what matters most, how decisions get made when things are ambiguous | 30 min |
| 2 | **PRD** (`prd.md`, Sections 1–10) | What you're building: users, journeys, requirements, data model, API shapes, edge cases | 2 hrs |
| 3 | **Handoff Checklist** (`handoff-checklist.md`, Section A) | Verify completeness before you start building | 30 min |

**Workflow:** Write docs → Have Claude challenge them → Complete checklist → Break into tasks → Build in Cursor task-by-task

---

## When to Go Advanced

Add more documents **only when your feature has one of these**:

| Your feature has... | What to add | Why |
|--------------------|-------------|-----|
| **An LLM interpreting user text** (chatbot, NL-to-SQL, AI assistant) | PRD §11–14 + NL Interpretation + Prompt Spec | The LLM is a black box that guesses. Your spec is the only lever for controlling its output. |
| **A data pipeline** (ETL, joins, transformations) | Data Quality Contract + E2E Scenarios | Dirty data causes silent failures — NaN aggregations, zero-match filters, dropped rows. |
| **RAG** (chatbot over docs, knowledge Q&A) | RAG sections in PRD §15 + across all templates | RAG failures are invisible — the LLM confidently answers from wrong context. |
| **A recommender system** (personalized feeds, "similar items") | PRD §16 + Feedback Loop + Evaluation Scenarios | The feedback loop means specification errors compound over time. |

---

## The 5 Things That Cause Debugging Loops

These are the specific gaps that, when missing from your spec, cause the AI agent to guess wrong:

| # | Missing spec | What goes wrong | Example |
|---|-------------|----------------|---------|
| 1 | **Field names** | LLM invents field names that don't exist in your data | LLM uses `revenue` but the field is `total_price` |
| 2 | **Data formats** | Numbers, dates, and enums are silently mishandled | `Number("781,68")` returns NaN; "Acepted" doesn't match "accepted" |
| 3 | **Boundary contracts** | Components make wrong assumptions about each other | Query engine expects clean data, but ETL didn't normalize locations |
| 4 | **Edge cases** | System breaks on new users, empty results, missing values | New user with zero history gets empty recommendations instead of trending items |
| 5 | **Prohibited behaviors** | LLM does something technically valid but logically wrong | LLM adds a redundant filter that makes results empty |

---

## Quick Decision Matrix

```
What are you building?
│
├── Simple feature (CRUD, dashboard, form)
│   └── Starter tier: Constitution + PRD (§1-10) + Checklist
│       Time: ~3 hours
│
├── Feature with LLM (chatbot, NL search, AI assistant)
│   └── + PRD §11-14, NL Interpretation, Prompt Spec
│       Time: ~6-8 hours
│
├── Feature with data pipeline (ETL, imports, transforms)
│   └── + Data Quality Contract, E2E Scenarios
│       Time: ~5-7 hours
│
├── LLM + data pipeline
│   └── All of the above
│       Time: ~8-12 hours
│
├── LLM + RAG (chatbot over documents)
│   └── + RAG sections across all templates
│       Time: ~10-14 hours
│
├── Recommender system
│   └── + PRD §16, Feedback Loop, Evaluation Scenarios
│       Time: ~6-10 hours (add LLM/RAG time if applicable)
│
└── Not sure?
    └── Start with Starter tier. Add documents when you hit a
        debugging loop — the checklist diagnostic table tells you
        which document is missing.
```

---

## Template Quick Reference

| Template | Sections always needed | Add if LLM | Add if pipeline | Add if RAG | Add if recommender |
|----------|----------------------|------------|----------------|------------|-------------------|
| **PRD** | §1-10 | §11-14 | §12-13 | §15 | §16 |
| **NL Interpretation** | — | All | — | §6 | — |
| **Data Quality** | — | — | §1-5 | §7 | §6 |
| **Prompt Spec** | — | All | — | §7 | — |
| **E2E Scenarios** | — | — | §1-4 | §5 | §6 |
| **Handoff Checklist** | §A, §G-H | §B | §C-D | §E | §F |

---

## Figma + MCP (Optional)

If you have Figma designs, the AI agent can read them directly during implementation via MCP.

- **When:** During implementation — not during specification
- **How:** Reference Figma frame names in your PRD's User Journeys, then prompt the agent to use `get_design_context` on those frames
- **Setup:** Run `create_design_system_rules` once per project; set up Code Connect mappings if you have existing components
- **Full guide:** `guides/figma-mcp.md`

---

## Governance (When Things Are Ambiguous)

From your **Constitution** — when the AI agent faces a judgment call:

1. Refer to the spec and its constraints
2. Prioritize the end user's experience
3. Preserve data integrity over convenience
4. Document decisions in specs, not only in code
5. When in doubt, ask — don't guess
