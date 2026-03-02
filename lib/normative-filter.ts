/**
 * Normative Domain Rejection Layer (docket-improvement-plan.md §27).
 * Deterministically detects evaluative/moral questions and rejects them.
 */

const NORMATIVE_PATTERNS = [
  /\b(is|are|was|were)\s+(the\s+)?(icc|duterte|case)\s+(hypocritical|justified|right|wrong|fair|biased|legitimate)\b/i,
  /\b(violation of sovereignty|illegal|unlawful)\s*\??\s*$/i,
  /\bis\s+(duterte|he)\s+(a\s+)?(hero|villain|tyrant|saint|murderer)\b/i,
  /\b(should|ought|must)\s+(the\s+)?(icc|philippines|duterte)\b/i,
  /\b(do\s+you\s+think|what\s+do\s+you\s+think|in\s+your\s+opinion|what'?s?\s+your\s+(opinion|take))\b/i,
  /\b(morally|ethically)\s+(right|wrong|justified)\b/i,
  /\b(justified|unjustified)\s+(in|to)\b/i,
  /\bdeserves?\s+(to\s+)?(be\s+)?(convicted|punished|freed)\b/i,
];

/** Factual/procedural questions that might match normative patterns but are valid */
const FACTUAL_PROCEDURAL_OK = [
  /\bdoes\s+(article|rule)\s+\d+\s+apply\b/i,
  /\bwhat\s+does\s+the\s+(rome\s+statute|icc)\s+say\s+about\b/i,
  /\bis\s+(the\s+deferral|it)\s+(granted|approved|admissible)\b/i,
  /\bwas\s+(the\s+deferral|it)\s+(granted|approved|rejected)\b/i,
];

/**
 * Check if query is normative/evaluative and should be rejected.
 */
export function isNormativeQuery(query: string): boolean {
  const q = query.trim();
  if (!q) return false;
  if (FACTUAL_PROCEDURAL_OK.some((p) => p.test(q))) return false;
  return NORMATIVE_PATTERNS.some((p) => p.test(q));
}

/** Message for normative refusal */
export const NORMATIVE_REFUSAL_MESSAGE =
  "This question asks for an evaluation or opinion. The Docket only answers factual questions from ICC documents.";
