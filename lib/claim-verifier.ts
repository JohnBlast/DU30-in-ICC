/**
 * Claim-level grounding verification for enumerated lists.
 * Phase 4: nl-interpretation.md §11, prompt-spec.md §6.3.
 *
 * Extracts list items from answers, verifies each against cited chunks,
 * and strips ungrounded items before the answer reaches the judge.
 */

import type { RetrievalChunk } from "./retrieve";
import { logEvent } from "./logger";

const STEM_EQUIVALENTS: Record<string, string[]> = {
  murder: ["murder", "murders", "murdered", "killing", "killings", "killed"],
  torture: ["torture", "tortured", "torturing"],
  imprisonment: [
    "imprisonment",
    "imprisoned",
    "imprison",
    "detention",
    "detained",
    "deprivation of liberty",
    "deprivation of physical liberty",
  ],
  rape: ["rape", "raped", "sexual violence", "sexual assault"],
  persecution: ["persecution", "persecuted", "persecuting"],
  deportation: ["deportation", "deported", "forcible transfer"],
  extermination: ["extermination", "exterminated"],
  enslavement: ["enslavement", "enslaved"],
  "enforced disappearance": [
    "enforced disappearance",
    "disappearance",
    "disappeared",
  ],
  apartheid: ["apartheid"],
  "other inhumane acts": ["other inhumane acts", "inhumane acts"],
  "crimes against humanity": ["crimes against humanity", "article 7"],
  "war crimes": ["war crimes", "article 8"],
  genocide: ["genocide", "article 6"],
  aggression: ["aggression", "crime of aggression", "article 8 bis"],
  "extrajudicial killing": [
    "extrajudicial killing",
    "extrajudicial killings",
    "extra-judicial killing",
    "extra-judicial killings",
    "extrajudicial execution",
    "extrajudicial executions",
    "summary execution",
    "summary executions",
    "EJK",
    "EJKs",
  ],
  "drug war": [
    "drug war",
    "war on drugs",
    "anti-drug campaign",
    "anti-drug operation",
    "anti-drug operations",
    "Oplan Tokhang",
    "Oplan Double Barrel",
    "Tokhang",
  ],
  neutralization: [
    "neutralization",
    "neutralize",
    "neutralized",
    "nanlaban",
    "fought back",
    "resisted arrest",
  ],
  death: [
    "death",
    "deaths",
    "died",
    "dead",
    "fatality",
    "fatalities",
    "body count",
  ],
  salvaging: ["salvaging", "salvage", "salvaged"],
};

const FALLBACK_STRIPPED =
  "The specific charges, crimes, or other items are detailed in the ICC documents but could not be individually verified from the retrieved passages.";

export interface ClaimVerificationResult {
  cleanedAnswer: string;
  strippedClaims: Array<{
    original: string;
    citedChunk: number;
    reason: "not_in_chunk" | "no_stem_match" | "no_proximity_match";
  }>;
  hadEnumerations: boolean;
  totalClaims: number;
  groundedClaims: number;
}

function extractKeyTerms(sentence: string): string[] {
  const terms: string[] = [];
  const words = sentence.split(/\s+/);
  for (const w of words) {
    const clean = w.replace(/[^\w]/g, "");
    if (!clean || clean.length < 3) continue;
    if (
      /^(the|and|for|are|was|were|has|have|had|with|this|that|from|but|not|his|her|its|they|them|been|will|would|could|should|into|also)$/i.test(
        clean
      )
    )
      continue;
    terms.push(clean.toLowerCase());
  }
  return terms.slice(0, 8);
}

/** Split list text into individual items. */
function extractListItems(listText: string): string[] {
  const withoutMarkers = listText.replace(/\[\d+\]/g, "").trim();
  const split = withoutMarkers.split(/\s*[,;]\s*/);
  const result: string[] = [];
  for (const s of split) {
    const trimmed = s.trim().replace(/^\s*and\s+/i, "").trim();
    if (trimmed.length > 0) result.push(trimmed);
  }
  return result;
}

/** Extract citation marker numbers from text (1-based). */
function extractCitationIndices(text: string): number[] {
  const matches = text.match(/\[(\d+)\]/g) ?? [];
  const seen = new Set<number>();
  const indices: number[] = [];
  for (const m of matches) {
    const n = parseInt(m.replace(/[\[\]]/g, ""), 10);
    if (n >= 1 && !seen.has(n)) {
      seen.add(n);
      indices.push(n);
    }
  }
  return indices;
}

/** Check if a claim is grounded in chunk content (Tier 1, 2, or 3). */
function isClaimGrounded(
  claim: string,
  chunkContent: string
): { grounded: boolean; reason?: "not_in_chunk" | "no_stem_match" | "no_proximity_match" } {
  const claimLower = claim.toLowerCase().trim();
  const chunkLower = chunkContent.toLowerCase();

  if (!claimLower || claimLower.length < 2) return { grounded: true };

  // Tier 1: exact lexical match
  if (chunkLower.includes(claimLower)) return { grounded: true };

  // Tier 2: stem equivalents
  for (const [key, synonyms] of Object.entries(STEM_EQUIVALENTS)) {
    const keyMatch = claimLower === key.toLowerCase() || synonyms.some((s) => s === claimLower);
    const chunkHasKey = chunkLower.includes(key) || synonyms.some((s) => chunkLower.includes(s));
    if (keyMatch && chunkHasKey) return { grounded: true };
    if (chunkHasKey) {
      for (const syn of synonyms) {
        if (claimLower.includes(syn) || syn.includes(claimLower)) return { grounded: true };
      }
    }
    for (const syn of synonyms) {
      if (chunkLower.includes(syn) && (claimLower.includes(syn) || claimLower.includes(key))) {
        return { grounded: true };
      }
    }
  }

  // Tier 2 reverse: claim might be a synonym of a key
  for (const [key, synonyms] of Object.entries(STEM_EQUIVALENTS)) {
    if (chunkLower.includes(key) || synonyms.some((s) => chunkLower.includes(s))) {
      if (
        claimLower === key ||
        synonyms.some((s) => s === claimLower || claimLower.includes(s) || s.includes(claimLower))
      ) {
        return { grounded: true };
      }
    }
  }

  // Tier 3: contextual proximity - any 3+ char content word from claim in chunk
  const keyTerms = extractKeyTerms(claim);
  for (const term of keyTerms) {
    if (term.length >= 3 && chunkLower.includes(term)) return { grounded: true };
  }

  return { grounded: false, reason: "no_proximity_match" };
}

/** Format a list of items with correct grammar. */
function formatList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const last = items[items.length - 1];
  const rest = items.slice(0, -1);
  return `${rest.join(", ")}, and ${last}`;
}

export function verifyEnumeratedClaims(
  answer: string,
  chunks: RetrievalChunk[]
): ClaimVerificationResult {
  const strippedClaims: ClaimVerificationResult["strippedClaims"] = [];
  let totalClaims = 0;
  let groundedClaims = 0;
  let hadEnumerations = false;
  let cleanedAnswer = answer;

  const sentences = answer.split(/(?<=[.!?])\s+/);

  const ENUMERATION_TRIGGERS = [
    /(?:charged\s+with|accused\s+of|alleged|include[s]?|including|namely|specifically)\s+(.+?)(?:\.\s|\.$|$)/gi,
    /(?:charges|crimes|counts|allegations|acts)\s*(?:are|include|involve)\s*:?\s*(.+?)(?:\.\s|\.$|$)/gi,
  ];

  for (const sentence of sentences) {
    if (!/\[\d+\]/.test(sentence)) continue;

    let listMatch: RegExpExecArray | null = null;
    let matchedListText = "";
    for (const pattern of ENUMERATION_TRIGGERS) {
      pattern.lastIndex = 0;
      listMatch = pattern.exec(sentence);
      if (listMatch) {
        matchedListText = listMatch[1].trim();
        break;
      }
    }
    if (!listMatch || !matchedListText) continue;

    hadEnumerations = true;
    const citedIndices = extractCitationIndices(sentence);
    if (citedIndices.length === 0) continue;

    const citedChunks = citedIndices
      .filter((i) => i >= 1 && i <= chunks.length)
      .map((i) => chunks[i - 1].content);
    const combinedChunk = citedChunks.join(" ");

    const items = extractListItems(matchedListText);
    if (items.length < 2) continue;

    totalClaims += items.length;

    const grounded: string[] = [];
    for (const item of items) {
      const { grounded: ok } = isClaimGrounded(item, combinedChunk);
      if (ok) {
        grounded.push(item);
        groundedClaims++;
      } else {
        strippedClaims.push({
          original: item,
          citedChunk: citedIndices[0],
          reason: "no_proximity_match",
        });
      }
    }

    if (grounded.length < items.length) {
      const citationPart = (sentence.match(/\[\d+(?:\]\s*\[\d+)*\]/) ?? [""])[0];
      const newSentence =
        grounded.length === 0
          ? FALLBACK_STRIPPED
          : sentence.replace(
              matchedListText,
              formatList(grounded) + (citationPart ? " " + citationPart : "")
            );
      cleanedAnswer = cleanedAnswer.replace(sentence, newSentence);
    }
  }

  const enumerationCount = sentences.filter((s) => {
    if (!/\[\d+\]/.test(s)) return false;
    for (const p of ENUMERATION_TRIGGERS) {
      p.lastIndex = 0;
      if (p.exec(s)) return true;
    }
    return false;
  }).length;

  logEvent("claim.verify", strippedClaims.length > 0 ? "warn" : "info", {
    enumeration_count: enumerationCount,
    total_claims: totalClaims,
    grounded_claims: groundedClaims,
    stripped_claims: strippedClaims.length,
    stripped_details: strippedClaims,
    answer_modified: strippedClaims.length > 0,
  });

  return {
    cleanedAnswer,
    strippedClaims,
    hadEnumerations,
    totalClaims,
    groundedClaims,
  };
}
