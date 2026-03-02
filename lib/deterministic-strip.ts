/**
 * Deterministic stripping pre-pass (docket-improvement-plan.md §12).
 * S-2, S-3, S-5, S-7 applied in code before LLM. Reduces prompt reliance.
 */

const STRIP_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // S-2: Source attributions (exclude "we say"/"they say" — idiomatic, not citation)
  {
    pattern:
      /\b(according to|per|as reported by|rappler|inquirer)\s+[^,.!?]+,?\s*|\b(the\s+report|the\s+document|sources?|experts?)\s+say(?:s)?\s+[^,.!?]+,?\s*/gi,
    replacement: " ",
  },
  // S-3: Epistemic hedges
  {
    pattern: /\b(reportedly|allegedly|in principle|essentially|perhaps|some claim|many say|it is believed|technically)\b/gi,
    replacement: " ",
  },
  // S-5: Authority attributions
  {
    pattern: /\b(ICC judges?|the court|the chamber|the prosecutor)\s+(declared|found|confirmed|established)\s+that\s+/gi,
    replacement: " ",
  },
  // S-7: Double negatives
  { pattern: /\bit'?s not true that (\w+ )?was not (\w+)\b/gi, replacement: "$1was $2" },
  { pattern: /\bthe ICC didn't fail to (issue|grant)\b/gi, replacement: "the ICC $1" },
];

/**
 * Strip framing patterns from text before claim extraction/verification.
 * Normalizes whitespace after stripping.
 */
export function deterministicStrip(text: string): string {
  let t = text;
  for (const { pattern, replacement } of STRIP_PATTERNS) {
    t = t.replace(pattern, replacement);
  }
  return t.replace(/\s{2,}/g, " ").trim();
}
