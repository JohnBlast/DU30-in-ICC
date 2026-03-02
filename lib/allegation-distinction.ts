/**
 * Allegation vs Established Fact Distinction Layer (docket-improvement-plan.md §23).
 * Prevents "alleges X" from becoming "X happened" in output.
 */

import type { RetrievalChunk } from "./retrieve";

const ALLEGATION_VERBS = /\b(alleges?|submits?|argues?|contends?|claims?|asserts?|presents?|according to the (prosecution|defence|OTP))\b/i;

export type SourceAllegationStatus = "allegation" | "ruling" | "neutral";

/**
 * Determine if a chunk's content is allegation (party submission) vs ruling (court decision).
 */
export function getSourceAllegationStatus(chunk: RetrievalChunk): SourceAllegationStatus {
  const dt = ((chunk.metadata?.document_type as string) ?? "").toLowerCase();
  if (dt === "transcript" || dt === "filing" || dt === "case_record") return "allegation";
  if (dt === "decision" || dt === "order" || dt === "judgment" || dt === "legal_text") return "ruling";
  if (ALLEGATION_VERBS.test(chunk.content)) return "allegation";
  return "neutral";
}

/**
 * Ensure icc_says preserves allegation framing when source is transcript/filing.
 * If iccSays does not already contain allegation framing, prepend it.
 */
export function requireAllegationFraming(
  iccSays: string,
  chunk: RetrievalChunk
): string {
  const status = getSourceAllegationStatus(chunk);
  if (status === "ruling" || status === "neutral") return iccSays;
  if (ALLEGATION_VERBS.test(iccSays)) return iccSays;
  const dt = (chunk.metadata?.document_type as string) ?? "document";
  const framing =
    dt === "transcript"
      ? "According to hearing testimony or argument, "
      : "According to party submission, ";
  return framing + iccSays.replace(/^[Aa]n?\s+/, "").replace(/^[Tt]he\s+/, "");
}
