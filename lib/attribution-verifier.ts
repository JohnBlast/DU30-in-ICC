/**
 * Attribution Verification Engine (docket-improvement-plan.md §22).
 * Blocks VERIFIED when claim attributes causation (actor + causal verb + harmful act)
 * but chunks only mention actor and crime separately — require same-chunk co-occurrence.
 */

import type { RetrievalChunk } from "./retrieve";
import type { ClaimVerdict } from "./fact-check";

const CAUSAL_VERBS = /\b(ordered|directed|authorized|commanded|instructed|oversaw|approved|sanctioned|endorsed)\b/i;
const ACTOR_PATTERNS = /\b(duterte|du30|the accused|the president)\b/i;
const HARMFUL_ACTS = /\b(killings?|executions?|murders?|extrajudicial|drug war|tokhang|neutralizations?|operations?)\b/i;

/**
 * Detect if claim has causal attribution structure: [Actor] + [CausalVerb] + [HarmfulAct]
 */
export function hasCausalAttributionStructure(claim: string): boolean {
  return (
    CAUSAL_VERBS.test(claim) &&
    (ACTOR_PATTERNS.test(claim) || /\bhe\b/i.test(claim)) &&
    HARMFUL_ACTS.test(claim)
  );
}

/**
 * Check if a single chunk contains actor + causal verb + harmful act (same-chunk co-occurrence).
 */
function chunkSupportsCausalAttribution(claim: string, chunkContent: string): boolean {
  const chunkLower = chunkContent.toLowerCase();

  const verbMatch = claim.match(CAUSAL_VERBS);
  const verbs = verbMatch ? [verbMatch[0].toLowerCase()] : [];
  const hasVerb = verbs.some((v) => chunkLower.includes(v));

  const hasActor = ACTOR_PATTERNS.test(chunkLower) || chunkLower.includes("he ");

  const actMatch = claim.match(HARMFUL_ACTS);
  const acts = actMatch ? [actMatch[0].toLowerCase()] : [];
  const hasAct = acts.some((a) => chunkLower.includes(a));

  return hasVerb && hasActor && hasAct;
}

/**
 * Extract cited chunk indices from citation marker string (e.g. "[1]" or "[1], [2]").
 */
function extractCitedChunkIndices(citationMarker: string): number[] {
  const matches = citationMarker.match(/\[(\d+)\]/g) ?? [];
  const indices: number[] = [];
  for (const m of matches) {
    const n = parseInt(m.replace(/[\[\]]/g, ""), 10);
    if (n >= 1 && !indices.includes(n)) indices.push(n);
  }
  return indices;
}

/**
 * Enforce attribution verification: if claim has causal structure and verdict is VERIFIED,
 * require same-chunk co-occurrence. Otherwise downgrade to UNVERIFIABLE.
 */
export function enforceAttributionVerification(
  claim: string,
  verdict: ClaimVerdict,
  citationMarker: string,
  chunks: RetrievalChunk[]
): ClaimVerdict {
  if (verdict !== "verified") return verdict;
  if (!hasCausalAttributionStructure(claim)) return verdict;

  const citedIndices = extractCitedChunkIndices(citationMarker);
  const citedChunks = citedIndices
    .filter((i) => i >= 1 && i <= chunks.length)
    .map((i) => chunks[i - 1]);

  if (citedChunks.length === 0) return "unverifiable";

  const anySupports = citedChunks.some((c) => chunkSupportsCausalAttribution(claim, c.content));
  return anySupports ? verdict : "unverifiable";
}
