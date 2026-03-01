# The Docket — Constitution

> **Governing principles for all specification, planning, and implementation.**
> Write this before everything else. When the AI agent faces an ambiguous decision, it checks these principles first.

---

## Purpose

DU30 in ICC is a neutral, citation-first RAG application that explains the Duterte ICC case to young Filipino digital natives using only official ICC documents. All decisions prioritize factual accuracy, political neutrality, and source transparency — above convenience, above completeness, above everything else.

---

## Principles

### 1. Audience-First Simplicity

- Target users are young Filipino digital natives — politically curious, bilingual (English + Tagalog/Tanglish), no legal background
- Every answer must be in plain language in the user's chosen language (English, Tagalog, or Tanglish) — ICC jargon is always explained inline or linked to the glossary
- If the user's chosen language is Tagalog or Tanglish, the answer must read naturally to a Filipino speaker — machine-translation artifacts that obscure meaning are unacceptable
- Errors and empty states use simple language with a clear next step; never expose technical error codes or stack traces
- If a user cannot understand an answer without a law degree, the answer is wrong

### 2. ICC Documents Are the Only Source of Truth

- Every claim must trace directly to a specific, cited ICC official document
- No answer is surfaced to the user without a verified citation — if it cannot be cited, it cannot be shown
- Data from news outlets, Philippine government sources, or any non-ICC source is never ingested, referenced, or implied
- Only publicly available ICC documents may be crawled and ingested — sealed, confidential, or restricted documents are never accessed

### 3. Redacted Content Is Sacred

- Documents containing [REDACTED] markers are ingested into the knowledge base
- The redaction boundary is absolute — the LLM must never attempt to de-anonymize, identify, link names to, or investigate what lies behind [REDACTED] content
- The system treats [REDACTED] as a hard wall, not a puzzle to solve — no reasoning about, speculating on, or cross-referencing to uncover redacted material
- If a user asks about redacted content, the system acknowledges the redaction exists and stops there

### 4. Source Transparency Through Highlighting

- Every answer must visually mark which specific claims came from which document — inline citation markers, not just a list of sources at the end
- When a user clicks a citation, they see the exact source passage from the ICC document, not just a link to the full PDF
- The connection between a claim in the answer and its backing evidence must be visually obvious and immediate
- Users should never have to hunt through a document to find what supports a claim

### 5. User-Submitted Text Is Cross-Referenced, Not Trusted Blindly

- Users may paste text from ICC documents into the chat alongside their question
- The system accepts the pasted text and answers the question, but cross-references with the knowledge base to attach proper citations
- If the pasted text cannot be matched to any ingested ICC document, the system notes that the source could not be verified against ICC records
- User-pasted text does not bypass any guardrail — neutrality, citation standards, and prohibited outputs still apply
- User-submitted text may also be social media content pasted for fact-checking — the system extracts factual claims, verifies them against ICC documents, and returns a verdict. The system never adopts, endorses, or comments on the poster's tone, bias, or motivation.

### 6. Conversations Are Ephemeral and Isolated

- Multi-turn conversation is supported, linked to the user's password-based authentication
- Conversations persist for 7 days, then are automatically and permanently deleted — no recovery
- Conversation history is strictly isolated per user — no user can access, view, or infer another user's history
- A global monthly cost cap governs total LLM usage across all users; when the cap is reached, the app goes read-only until the next billing cycle
- No conversation data is used for training, analytics, or any purpose beyond serving the user's active session

### 7. Specification-First Development

- Requirements drive implementation — no improvisation during build
- Guardrails and system prompts are fully specified before any implementation begins
- Edge cases are documented before build; when behavior is ambiguous, the default is always "say you don't know"
- Decisions are documented in specs, not only in code comments

### 8. Incremental Delivery

- Iteration 1 = core RAG with Q&A, citations, paste-text input, multi-turn conversation, and glossary. Iteration 2 = content fact-checker and Tanglish/Tagalog language support. Dashboard is a future iteration.
- Out-of-scope features are documented for future iterations, never silently dropped or partially built
- Each iteration must be fully functional and tested before the next begins
- Do not gold-plate; do not over-engineer for hypothetical future requirements

### 9. AI-Native, Hard-Guardrailed

- AI generates all answers — but every answer passes through LLM-as-Judge verification before the user sees it
- Hard guardrails (never violated): never speculate on outcomes, never express political opinion, never imply guilt or innocence, never answer without a citation
- Soft guardrails (tone): plain English, calm and neutral register, ICC procedural framing for "what happens next" questions
- When the LLM cannot answer from ICC documents, it declines with a flat statement: *"This is not addressed in current ICC records."* — no redirection, no suggestions, no engagement with the premise
- Out-of-bounds questions include anything outside the Duterte ICC case: personal trivia, general knowledge, political speculation, other legal cases. The system does not engage — it declines only
- Political neutrality is a hard constraint, not a preference — the Duterte case is polarizing and adversarial prompting is expected
- **Neutrality specifics:** never compare Duterte to other leaders, never frame the ICC as "for" or "against" any country, never characterize proceedings with loaded language (e.g., "persecution," "witch hunt," "justice served")
- **Multi-turn neutrality:** each response is independently evaluated for neutrality — conversational context must not allow gradual erosion of the neutrality standard across turns
- **Paste-text neutrality:** even if a user pastes biased or editorialized content, the system's response remains neutral and grounded in ICC documents
- **Fact-checker neutrality:** when verifying social media claims, the system strips emotional framing, never adopts the poster's claims as truth, and only reports what ICC documents state. The verdict (VERIFIED/FALSE/MISLEADING/UNVERIFIABLE/NOT_IN_ICC_RECORDS/OPINION/PARTIALLY_VERIFIED) is based solely on ICC document evidence.
- **Fact-checker input tolerance:** the fact-checker accepts emotional, biased, and politically charged inputs without declining them. It extracts factual claims, labels opinions as OPINION, and verifies claims individually. Mixed inputs containing both opinions and facts are decomposed — never flat-declined as a whole.
- **Fact-checker guilt handling:** when a claim asserts guilt or conviction, the system verifies procedural status only. It never says "he is not guilty" or "he is not innocent." It only states whether a conviction exists in ICC records. The absence of a conviction is a procedural fact, not a judgment on innocence.
- **Multilingual neutrality:** Tagalog and Tanglish responses maintain the exact same political neutrality as English responses. Translation does not introduce bias. [REDACTED] markers are never translated.

---

## Governance

When in doubt:

1. Refer to the PRD and its guardrails first
2. Prioritize political neutrality — when in doubt, say less
3. Prioritize citation accuracy — if it cannot be cited from an ICC document, do not say it
4. Preserve the distinction between *"ICC documents state..."* and *"ICC has not yet ruled on..."*
5. Treat redacted content as a hard wall — when in doubt, acknowledge the redaction and stop
6. Treat user-pasted text as unverified until cross-referenced against the knowledge base
7. When the spec is silent, ask — do not guess

---

## Legal Constraints (Hard Stops)

These are non-negotiable at every phase of development:

- `ai-train=no` — ICC robots.txt expressly prohibits training AI models on their content. Do not fine-tune any model on ICC data, ever.
- Philippine Cyber Libel Act — never make factual claims about named individuals beyond what ICC documents explicitly state
- ICC Contempt of Court (Rome Statute Article 70) — never speculate on witness identities or sealed evidence; never attempt to de-anonymize redacted content
- No ICC logos, branding, or implied endorsement — the app is independent and must say so on every page
- Conversation data privacy — conversation history auto-deletes after 7 days; history is isolated per user; no conversation data is logged, exported, or used for any secondary purpose

---

## How the AI Agent Should Use This

This file lives in the project root and is referenced in `.cursorrules`. Before implementing any feature, the AI agent reads this constitution to understand the non-negotiables. When facing a trade-off not covered by the PRD, these principles are the tiebreaker.