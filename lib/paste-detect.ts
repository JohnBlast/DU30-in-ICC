/**
 * Step 2: Paste auto-detection (nl-interpretation.md §2.3.3).
 * Classifies pasted text as ICC document or social media.
 * Default on ambiguity: social_media (safer).
 */

import { getOpenAIClient } from "./openai-client";
import { logEvent } from "./logger";

export type PasteType = "icc_document" | "social_media";

export interface PasteDetectionResult {
  pasteType: PasteType;
  confidence: "high" | "low";
  method: "deterministic" | "llm";
}

/** ICC document signals — high confidence */
const ICC_SIGNALS = [
  /\bArticle\s+\d+/i,
  /\bRule\s+\d+/i,
  /\bparagraph\s+\d+/i,
  /\[REDACTED\]/i,
  /\bThe\s+Chamber\s+finds\b/i,
  /\bThe\s+Prosecution\s+submits\b/i,
  /\bpursuant\s+to\b/i,
  /\bsection\s+\d+/i,
  /\bchapter\s+\d+/i,
];

/** Social media signals — high confidence */
const SOCIAL_SIGNALS = [
  /#\w+/,
  /@\w+/,
  /[\u{1F300}-\u{1F9FF}]/u, // emoji range
  /\bRT\b/i,
  /\bSHARE\b/i,
  /\bLIKE\b/i,
  /\bI\s+think\b/i,
  /\bOMG\b/i,
  /\bgrabe\b/i,
  /\b(talaga|naman)\s+[^.!?]*[.!?]/i,
  /\bfact[- ]?check\s+(this|it)/i,
  /\bis\s+this\s+(true|accurate|correct)/i,
  /\btotoo\s+ba\s+(ito|yan)/i,
  /\btama\s+ba\s+(ito|yan)/i,
];

/** Explicit user intent to fact-check → social_media */
const FACT_CHECK_USER_PREFIX = /fact[- ]?check|is this (true|accurate|correct)|totoo ba|tama ba/i;

function countMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const p of patterns) {
    if (p.test(text)) count++;
  }
  return count;
}

/** LLM fallback prompt */
const PASTE_CLASSIFY_PROMPT = `Classify the following pasted text as either "icc_document" or "social_media".

- icc_document: Formal legal language, ICC court documents, Article/Rule references, "The Chamber finds", "The Prosecution submits", legal filings
- social_media: Casual language, hashtags, @mentions, opinions, emotional language, Facebook posts, tweets, Messenger forwards

Respond with exactly one word: icc_document or social_media

Pasted text:
`;

/**
 * Detect whether pasted text is ICC document or social media.
 * Deterministic signals first; LLM fallback for ambiguous.
 * Default on ambiguity: social_media.
 */
export async function detectPasteType(
  pastedText: string,
  userQuery: string
): Promise<PasteDetectionResult> {
  const text = (pastedText || "").trim();
  const query = (userQuery || "").trim();

  // Explicit user intent: "fact-check this" etc. → social_media
  if (FACT_CHECK_USER_PREFIX.test(query)) {
    logEvent("paste_detect.result", "info", { pasteType: "social_media", method: "deterministic", signal: "user_prefix" });
    return { pasteType: "social_media", confidence: "high", method: "deterministic" };
  }

  const iccCount = countMatches(text, ICC_SIGNALS);
  const socialCount = countMatches(text, SOCIAL_SIGNALS);

  // Strong ICC signals
  if (iccCount >= 2) {
    logEvent("paste_detect.result", "info", { pasteType: "icc_document", method: "deterministic", icc_signals: iccCount });
    return { pasteType: "icc_document", confidence: "high", method: "deterministic" };
  }

  // Strong social signals
  if (socialCount >= 1) {
    logEvent("paste_detect.result", "info", { pasteType: "social_media", method: "deterministic", social_signals: socialCount });
    return { pasteType: "social_media", confidence: "high", method: "deterministic" };
  }

  // Single ICC signal (e.g. just "Article 7") — could be either
  if (iccCount === 1 && socialCount === 0) {
    // If it has formal legal phrasing, lean ICC
    if (/\bThe\s+(Chamber|Prosecution)\b|pursuant\s+to/i.test(text)) {
      return { pasteType: "icc_document", confidence: "high", method: "deterministic" };
    }
  }

  // Ambiguous — LLM fallback
  try {
    const openai = getOpenAIClient();
    const sample = text.slice(0, 500);
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: PASTE_CLASSIFY_PROMPT },
        { role: "user", content: sample },
      ],
      max_tokens: 16,
      temperature: 0,
    });

    const raw = (res.choices[0]?.message?.content?.trim() ?? "").toLowerCase();
    if (raw.includes("icc_document")) {
      logEvent("paste_detect.result", "info", { pasteType: "icc_document", method: "llm" });
      return { pasteType: "icc_document", confidence: "low", method: "llm" };
    }
    if (raw.includes("social_media")) {
      logEvent("paste_detect.result", "info", { pasteType: "social_media", method: "llm" });
      return { pasteType: "social_media", confidence: "low", method: "llm" };
    }
  } catch (err) {
    logEvent("paste_detect.llm_failure", "warn", { error_message: String(err) });
  }

  // Default on ambiguity: social_media (safer per spec)
  logEvent("paste_detect.result", "info", { pasteType: "social_media", method: "default_ambiguity" });
  return { pasteType: "social_media", confidence: "low", method: "deterministic" };
}
