/**
 * Step 0: Language detection (nl-interpretation.md §2.3.1).
 * Detects en/tl/taglish/other. Robustness: uncertain → try as English.
 */

export type DetectedLanguage = "en" | "tl" | "taglish" | "other";

export interface LanguageDetectionResult {
  language: DetectedLanguage;
  tagalogWordCount: number;
  englishContentRatio: number;
}

/** Expanded Tagalog function word list (30 words) from nl-interpretation.md §2.3.1 */
const TAGALOG_WORDS = [
  "ang",
  "yung",
  "kay",
  "ba",
  "siya",
  "niya",
  "pero",
  "kasi",
  "sino",
  "ano",
  "paano",
  "bakit",
  "talaga",
  "naman",
  "daw",
  "raw",
  "mo",
  "ko",
  "sa",
  "ng",
  "mga",
  "na",
  "po",
  "rin",
  "din",
  "lang",
  "pala",
  "ito",
  "yan",
  "yon",
];

/** Cebuano words — if 2+ Cebuano AND 0 Tagalog → other */
const CEBUANO_WORDS = ["unsa", "kini", "mao", "dili", "wala", "kanang", "bitaw", "ug", "nga", "kay"];

/** Proper nouns / ICC terms — excluded from English content word count */
const PROPER_NOUNS = [
  "duterte",
  "du30",
  "icc",
  "philippines",
  "hague",
  "rome",
  "statute",
  "tokhang",
  "davao",
];

/** Build regex with word boundaries for each Tagalog word */
function buildTagalogRegex(): RegExp {
  const escaped = TAGALOG_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

const TAGALOG_REGEX = buildTagalogRegex();

function buildCebuanoRegex(): RegExp {
  const escaped = CEBUANO_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
}

const CEBUANO_REGEX = buildCebuanoRegex();

/** Common English stop words — not counted as "content" */
const ENGLISH_STOP = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "shall",
  "can",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
]);

/**
 * Detect language of text. 0-1 Tagalog matches → English. 2+ → Filipino (tl or taglish).
 * Sub-classify: <20% English content words = tl (pure Tagalog), else taglish.
 * Robustness: if uncertain, return "en".
 */
export function detectLanguage(text: string): LanguageDetectionResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { language: "en", tagalogWordCount: 0, englishContentRatio: 1 };
  }

  const tagalogMatches = trimmed.match(TAGALOG_REGEX);
  const tagalogCount = tagalogMatches ? tagalogMatches.length : 0;

  // Cebuano check: 2+ Cebuano AND 0 Tagalog → other
  const cebuanoMatches = trimmed.match(CEBUANO_REGEX);
  const cebuanoCount = cebuanoMatches ? cebuanoMatches.length : 0;
  if (cebuanoCount >= 2 && tagalogCount === 0) {
    return { language: "other", tagalogWordCount: 0, englishContentRatio: 0 };
  }

  // 0-1 Tagalog matches → English (robustness: uncertain = try as English)
  if (tagalogCount <= 1) {
    return { language: "en", tagalogWordCount: tagalogCount, englishContentRatio: 1 };
  }

  // 2+ Tagalog → Filipino. Sub-classify by English content word ratio.
  const words = trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\w]/g, ""))
    .filter((w) => w.length >= 2);

  const tagalogSet = new Set(TAGALOG_WORDS.map((t) => t.toLowerCase()));
  const properSet = new Set(PROPER_NOUNS.map((p) => p.toLowerCase()));

  let englishContentCount = 0;
  let totalContentCount = 0;

  for (const w of words) {
    if (tagalogSet.has(w)) continue; // Tagalog function word — skip
    if (properSet.has(w)) continue; // Proper noun — skip for ratio

    // Heuristic: 4+ chars, mostly ASCII letters → likely English content word
    const isLikelyEnglish =
      /^[a-z]+$/.test(w) &&
      w.length >= 2 &&
      !ENGLISH_STOP.has(w) &&
      !tagalogSet.has(w);

    totalContentCount++;
    if (isLikelyEnglish) englishContentCount++;
  }

  const englishContentRatio = totalContentCount > 0 ? englishContentCount / totalContentCount : 0;

  // <20% English content words = pure Tagalog (tl); ≥20% = Tanglish (taglish)
  const language: DetectedLanguage = englishContentRatio < 0.2 ? "tl" : "taglish";

  return { language, tagalogWordCount: tagalogCount, englishContentRatio };
}
