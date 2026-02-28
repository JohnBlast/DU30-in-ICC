# Guide: Cursor Handbook for PMs

> How to set up Cursor, feed it your specs, and work with it effectively. Written for product managers, not developers.

---

## First-Time Setup

### Install Cursor

Download from [cursor.sh](https://cursor.sh). It's VS Code under the hood, so if you've ever opened VS Code, you'll recognize it.

### Key Concepts

| Concept | What it is | When to use |
|---------|-----------|-------------|
| **Chat** (Cmd+L / Ctrl+L) | Conversational AI in a sidebar. Can see your files. | Ask questions, get explanations, small targeted changes |
| **Composer** (Cmd+I / Ctrl+I) | AI that can create and edit multiple files at once. | Implement tasks, build features, make cross-file changes |
| **Inline edit** (Cmd+K / Ctrl+K) | Edit a specific selection of code in place. | Small, targeted fixes — "make this button blue", "add error handling here" |
| **Tab completion** | Cursor predicts your next edit as you type. | Accept with Tab for small, obvious completions |
| **`.cursorrules`** | A file in your project root that Cursor reads before every interaction. | Persistent instructions: your spec references, coding conventions, project rules |
| **`@` references** | Tag files, folders, or docs in chat/composer. | Point Cursor to specific context: `@SPEC.md`, `@src/components` |

### Your First Project

1. Create a project folder
2. Drop in the spec docs Claude produced (CONSTITUTION.md, SPEC.md, ARCHITECTURE.md, TASKS.md)
3. Create `.cursorrules` (see below)
4. Open the folder in Cursor
5. Start with Task 1 from TASKS.md

---

## Setting Up `.cursorrules`

This is the most important file in your project. Cursor reads it before every interaction — it's your standing instructions.

```markdown
# Project: [Your Project Name]

## Context Documents
Read these before writing any code:
- SPEC.md — Product requirements (source of truth for what to build)
- ARCHITECTURE.md — Tech stack, project structure, key decisions
- TASKS.md — Implementation plan (work through in order)

## Rules
- Follow the task order in TASKS.md. Do not skip ahead.
- Use exact field names from SPEC.md §5 (Data & Domain Concepts).
- After completing a task, list what was created/changed and how to verify it works.
- If a requirement is ambiguous, say so and suggest options — do not guess.
- Keep files small and focused. One component per file.
- Add comments only where the "why" isn't obvious from the code.

## Tech Stack
- [Your framework, e.g., Next.js 14 with App Router]
- [Your database, e.g., Supabase with Postgres]
- [Your styling, e.g., Tailwind CSS]
- [Any key libraries]

## Project Structure
[Paste the structure from ARCHITECTURE.md, e.g.:]
src/
  app/           — Pages and routes
  components/    — Reusable UI components
  lib/           — Utilities, API clients, helpers
  types/         — TypeScript type definitions
```

### Tips for Good `.cursorrules`

- Keep it under 1 page. Cursor reads this every time — bloat slows it down.
- Reference your spec docs by name so Cursor knows where to look.
- Include the tech stack explicitly — don't make Cursor infer it from `package.json`.
- Update it as the project evolves (add new conventions as they emerge).

---

## How to Give Cursor Tasks

### The Right Way: One Task at a Time

Open Composer (Cmd+I) and give it a single task from your TASKS.md:

```
Implement Task 3: Create the user authentication flow.

Per SPEC.md §3 Journey 1:
- User enters email on the login page
- System sends a magic link
- User clicks link and is redirected to the dashboard
- Session persists for 7 days

Per ARCHITECTURE.md:
- Use Supabase Auth with magic links
- Create src/app/login/page.tsx
- Create src/lib/auth.ts for the Supabase auth client

Done condition: User can enter email, receive magic link (in Supabase logs), click it, and see the dashboard.
```

### The Wrong Way: Everything at Once

```
Build the whole app based on SPEC.md
```

This will produce something that looks complete but has subtle bugs in every feature. Always go task by task.

### How Big Should a Task Be?

A good task is something you can verify in 5–15 minutes. If you find yourself saying "there's too much to check," the task is too big — ask Claude to break it down further.

**Too big:** "Build the product catalog with search, filtering, sorting, and pagination"

**Right size:** "Create the product list page that displays products from the database in a grid. No search or filtering yet — just render the data."

---

## Working with Cursor: Patterns That Work

### Pattern 1: Reference your specs

Always point Cursor to the relevant spec section:

```
Per SPEC.md §4 (Functional Requirements), the search should return results
within 500ms. Implement the search endpoint at /api/search with the query
parameter structure defined in §10 (API Contract).
```

You can also use `@` references: `@SPEC.md` will include the file in context.

### Pattern 2: Show before and after

When something is wrong, describe what you see and what you expected:

```
The product cards are showing price as "NaN". The price field in the database
is stored as a string with comma-decimal format (e.g., "29,99").
Per SPEC.md §8 (Edge Cases), prices should display as "$29.99".
Fix the price parsing.
```

### Pattern 3: Ask for verification steps

After Cursor completes a task, ask it what to check:

```
Task 5 is complete. Give me a list of things to manually verify
in the browser to confirm this task is done correctly.
```

### Pattern 4: Incremental requests

Instead of one big prompt, build up:

1. "Create the basic page layout with a header and empty content area"
2. "Now add the data table component that displays [fields] from [data]"
3. "Now add sorting — clicking a column header sorts by that column"
4. "Now add the search input that filters the table client-side"

### Pattern 5: Fix-and-explain

When Cursor produces something that doesn't work:

```
This is throwing a "Cannot read properties of undefined" error on line 23.
Fix the error and explain what was wrong so I understand the pattern.
```

The "explain" part is important — it helps you learn, which reduces future errors.

---

## What Cursor Can't Do (Use Claude Instead)

| Situation | Why Cursor struggles | Use Claude for |
|-----------|---------------------|----------------|
| "Should I use a modal or a separate page?" | Product decision, not a code decision | Discussing UX trade-offs |
| "Is my data model right?" | Cursor defaults to "whatever works in code" | Validating data model against requirements |
| "How should I handle this edge case?" | Cursor will pick an implementation, not the *right* implementation | Reasoning through the product implications |
| "Why is this architecture a bad idea?" | Cursor won't push back on your architecture | Getting honest trade-off analysis |
| "Rewrite my PRD" | Cursor will make it code-shaped | Structured product thinking |

---

## Troubleshooting Common Cursor Issues

### "Cursor keeps changing files I didn't ask it to touch"

This happens when tasks are too vague. Be specific about which files to create/edit:

```
Create src/components/ProductCard.tsx. Do NOT modify any other files.
```

### "Cursor generated a ton of code but it doesn't work"

Break the task into smaller pieces. If a single Composer prompt produces more than ~200 lines of new code, it's probably too much at once.

### "Cursor forgot about my spec docs"

Re-reference them: `@SPEC.md Look at §4 requirements. The search feature should...`

Cursor's context window is limited. For very long conversations, start a new Composer session and re-state the task with spec references.

### "Cursor used the wrong framework/library/pattern"

Your `.cursorrules` might be missing the tech stack section. Add explicit instructions:

```
Always use server components in Next.js unless the component needs
client-side interactivity (useState, onClick, etc.).
```

### "Cursor's suggestion looks wrong but I'm not sure"

Ask it to explain:

```
Before I accept this change, explain your reasoning.
Why did you use [approach] instead of [alternative]?
```

---

## Keyboard Shortcuts Worth Knowing

| Action | Mac | Windows |
|--------|-----|---------|
| Open Chat | Cmd+L | Ctrl+L |
| Open Composer | Cmd+I | Ctrl+I |
| Inline edit | Cmd+K | Ctrl+K |
| Accept tab completion | Tab | Tab |
| Open terminal | Cmd+` | Ctrl+` |
| Open file by name | Cmd+P | Ctrl+P |
| Toggle sidebar | Cmd+B | Ctrl+B |
| Save file | Cmd+S | Ctrl+S |
