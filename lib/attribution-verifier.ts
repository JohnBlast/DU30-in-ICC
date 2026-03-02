/**
 * Attribution Verification Engine (docket-improvement-plan.md §22).
 * Blocks VERIFIED when claim attributes causation (actor + causal verb + harmful act)
 * but chunks only mention actor and crime separately — require same-chunk co-occurrence.
 */

import type { RetrievalChunk } from "./retrieve";
import type { ClaimVerdict } from "./fact-check";

const CAUSAL_VERB_PATTERNS: RegExp[] = [
  /\b(ordered|directed|authorized|commanded|instructed|oversaw|approved|sanctioned|endorsed|masterminded|orchestrated|initiated)\b/i,
  /\b(bore\s+responsibility\s+for|was\s+responsible\s+for|presided\s+over)\b/i,
  /\b(carried\s+out\s+under|at\s+the\s+(direction|behest|order)\s+of|on\s+(the\s+)?orders?\s+of)\b/i,
  /\b(aided\s+and\s+abetted|contributed\s+to|facilitated|had\s+(effective\s+)?command\s+(and\s+control\s+)?over)\b/i,
];

const ACTOR_PATTERNS = /\b(duterte|du30|the accused|the president)\b/i;
const HARMFUL_ACTS = /\b(killings?|executions?|murders?|extrajudicial|drug war|tokhang|neutralizations?|operations?)\b/i;

const ALLEGATION_CONTEXT_VERBS =
  /\b(alleges?|argues?|submits?|contends?|claims?|according\s+to\s+the\s+(prosecution|OTP|defence|defense))\b/i;

/**
 * Detect if claim has causal attribution structure: [Actor] + [CausalVerb] + [HarmfulAct]
 */
export function hasCausalAttributionStructure(claim: string): boolean {
  const hasVerb = CAUSAL_VERB_PATTERNS.some((p) => p.test(claim));
  const hasActor = ACTOR_PATTERNS.test(claim) || /\bhe\b/i.test(claim);
  const hasAct = HARMFUL_ACTS.test(claim);
  return hasVerb && hasActor && hasAct;
}

/**
 * Check if actor + verb + act co-occur within a 3-sentence window.
 */
function sentenceWindowCooccurrence(
  chunkContent: string,
  actorPattern: RegExp,
  verbPatterns: RegExp[],
  actPattern: RegExp,
  windowSize: number = 3
): boolean {
  const sentences = chunkContent.split(/(?<=[.!?])\s+/);
  for (let i = 0; i <= sentences.length - 1; i++) {
    const window = sentences.slice(i, i + windowSize).join(" ");
    const hasActor = actorPattern.test(window);
    const hasVerb = verbPatterns.some((p) => p.test(window));
    const hasAct = actPattern.test(window);
    if (hasActor && hasVerb && hasAct) return true;
  }
  return false;
}

/**
 * Check if a single chunk supports causal attribution (3-sentence window co-occurrence).
 */
function chunkSupportsCausalAttribution(claim: string, chunkContent: string): boolean {
  return sentenceWindowCooccurrence(
    chunkContent,
    ACTOR_PATTERNS,
    CAUSAL_VERB_PATTERNS,
    HARMFUL_ACTS,
    3
  );
}

/**
 * Check if causal attribution comes from allegation context (transcript/filing with allegation verbs).
 * If so, downgrade VERIFIED to UNVERIFIABLE — we cannot treat party arguments as verified facts.
 */
export function isAllegationContextAttribution(
  claim: string,
  chunk: RetrievalChunk
): boolean {
  if (!hasCausalAttributionStructure(claim)) return false;
  const docType = (chunk.metadata.document_type ?? "").toLowerCase();
  if (docType !== "transcript" && docType !== "filing") return false;

  const sentences = chunk.content.split(/(?<=[.!?])\s+/);
  for (let i = 0; i < sentences.length; i++) {
    const window = sentences.slice(i, i + 3).join(" ");
    const hasAttribution = sentenceWindowCooccurrence(
      window,
      ACTOR_PATTERNS,
      CAUSAL_VERB_PATTERNS,
      HARMFUL_ACTS,
      3
    );
    if (hasAttribution && ALLEGATION_CONTEXT_VERBS.test(window)) {
      return true;
    }
  }
  return false;
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
 * require same-chunk co-occurrence. If support comes only from allegation context (transcript/filing),
 * downgrade to UNVERIFIABLE.
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
  if (anySupports) {
    const anyAllegation = citedChunks.some((c) => isAllegationContextAttribution(claim, c));
    if (anyAllegation) return "unverifiable";
    return verdict;
  }
  return "unverifiable";
}
