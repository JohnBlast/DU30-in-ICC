/**
 * Authority Tone Suppression Rule (docket-improvement-plan.md §25).
 * Replaces raw verdict labels with epistemic-humble phrasing.
 */

import type { ClaimVerdict } from "./fact-check";

/**
 * Format verdict for user-facing output. Avoids "VERIFIED"/"FALSE" as standalone labels.
 */
export function formatVerdictForUser(
  internal: ClaimVerdict,
  iccSays: string | null
): string {
  switch (internal) {
    case "verified":
      return iccSays ? `Based on ICC documents, this is supported. ${iccSays}` : "Based on ICC documents, this is supported.";
    case "false":
      return iccSays ? `ICC documents indicate otherwise: ${iccSays}` : "ICC documents indicate otherwise.";
    case "unverifiable":
      return "ICC documents do not contain information on this topic.";
    case "not_in_icc_records":
      return "This specific reference does not appear in the ICC documents we have.";
    case "opinion":
      return "This is an opinion, not a verifiable factual claim.";
    default:
      return iccSays ?? "Could not verify from retrieved ICC documents.";
  }
}
