/**
 * Multi-Turn Contamination Guard (docket-improvement-plan.md §26).
 * Strips user-asserted facts from conversation history before generation/Judge.
 * Prevents user-injected "30,000 were killed" from leaking into later answers.
 */

const USER_FACT_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\b\d{3,}\s*(killed|died|victims|people|casualties|dead|deaths?)\b/gi,
    replacement: "[User-stated number — omitted from context]",
  },
  {
    pattern:
      /\b(approximately|around|about|at least|over|more than)?\s*\d{3,}\b(?=\s*(drug|kill|victim|people|death|case|warrant|count|charge))/gi,
    replacement: "[User-stated number — omitted from context]",
  },
  {
    pattern:
      /\b(given that|since|because|considering that)\s+[^,]+\b(killed|died|victims|convicted|sentenced|guilty|ordered)\b[^,]*/gi,
    replacement: "[User-stated premise — omitted from context]",
  },
  {
    pattern:
      /\b(according to|sources say|it is known that|everyone knows|it has been reported|as we know|as established)\s+[^.!?]+[.!?]?/gi,
    replacement: "[User-stated claim — omitted from context]",
  },
  {
    pattern:
      /\b(duterte|du30|the president|he)\s+(ordered|authorized|directed|commanded|instructed)\b[^.!?]*/gi,
    replacement: "[User-stated claim — omitted from context]",
  },
  {
    pattern: /\b(duterte|du30)\s+(is|was)\s+(guilty|innocent|convicted|acquitted)\b/gi,
    replacement: "[User-stated claim — omitted from context]",
  },
  {
    pattern: /\b(there were|there are|there have been)\s+\d{3,}\s+\w+/gi,
    replacement: "[User-stated claim — omitted from context]",
  },
];

/**
 * Sanitize a single user message by replacing factual assertions with placeholder.
 * Preserves question structure and intent ("What evidence supports that?").
 */
export function sanitizeUserMessageForContext(content: string): string {
  if (!content || content.length < 10) return content;
  let t = content;
  for (const { pattern, replacement } of USER_FACT_PATTERNS) {
    t = t.replace(pattern, replacement);
  }
  return t.trim() || content;
}

/**
 * Sanitize conversation history for contamination before passing to LLM/Judge.
 * Only transforms user messages; assistant messages are preserved.
 */
export function sanitizeHistoryForContamination(
  history: Array<{ role: "user" | "assistant"; content: string }>
): Array<{ role: "user" | "assistant"; content: string }> {
  return history.map((msg) =>
    msg.role === "user"
      ? { ...msg, content: sanitizeUserMessageForContext(msg.content) }
      : msg
  );
}
