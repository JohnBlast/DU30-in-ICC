/**
 * Retrieval threshold tuning (cursor-false-decline-reduction P2-1).
 * Runs known-answerable queries at various thresholds; reports recall.
 * Usage: npm run tune-thresholds
 *
 * Does NOT modify lib/retrieve.ts. Output is for manual analysis.
 */

import { retrieve } from "../lib/retrieve";

const LABELED_QUERIES: Array<{ id: string; query: string; intent: string; ragIndexes: number[] }> = [
  { id: "DD-02", query: "What Rome Statute articles form the jurisdictional basis for the arrest warrant?", intent: "case_facts", ragIndexes: [1, 2] },
  { id: "DD-03", query: "On what dates does the ICC consider its temporal jurisdiction to apply?", intent: "case_timeline", ragIndexes: [2] },
  { id: "DD-06", query: "What crimes against humanity are detailed in the warrant application?", intent: "case_facts", ragIndexes: [2] },
  { id: "DD-08", query: "Is Duterte alleged to be responsible only for murder, or also torture and rape?", intent: "case_facts", ragIndexes: [2] },
  { id: "FD-01", query: "Has Duterte been convicted?", intent: "case_facts", ragIndexes: [2] },
  { id: "FD-02", query: "What are the charges?", intent: "case_facts", ragIndexes: [2] },
  { id: "FD-05", query: "What's the status of the case?", intent: "case_facts", ragIndexes: [2] },
  { id: "FD-07", query: "Has he been arrested?", intent: "case_facts", ragIndexes: [2] },
  { id: "FD-08", query: "What are Duterte's rights at the ICC?", intent: "legal_concept", ragIndexes: [1, 2] },
  { id: "FD-10", query: "What happens after this?", intent: "procedure", ragIndexes: [1] },
];

async function main() {
  console.log("Threshold tuning — running labeled queries at current thresholds\n");

  for (const { id, query, intent, ragIndexes } of LABELED_QUERIES) {
    try {
      const result = await retrieve({
        query,
        ragIndexes,
        intent,
      });
      const recall = result.chunks.length > 0 ? "✓" : "✗";
      console.log(`${id} (${intent}): ${recall} ${result.chunks.length} chunks, confidence=${result.retrievalConfidence}`);
    } catch (e) {
      console.log(`${id}: ERROR ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log("\nDone. Adjust INTENT_THRESHOLDS in lib/retrieve.ts based on results.");
}

main();
