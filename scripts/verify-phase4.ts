/**
 * Phase 4 claim verification: CV-01 through CV-08.
 * Unit tests for verifyEnumeratedClaims().
 * Usage: npm run verify-phase4
 */

import { verifyEnumeratedClaims } from "../lib/claim-verifier";
import type { RetrievalChunk } from "../lib/retrieve";

function mkChunk(content: string, id = "1"): RetrievalChunk {
  return {
    chunk_id: id,
    document_id: "doc1",
    content,
    metadata: { document_title: "Test", url: "", date_published: "" },
  };
}

const TESTS: Array<{
  id: string;
  answer: string;
  chunks: RetrievalChunk[];
  expectStripped: string[];
  expectKept: string[];
  expectAllStripped: boolean;
}> = [
  {
    id: "CV-01",
    answer: "Duterte is charged with murder, torture, and imprisonment [1].",
    chunks: [mkChunk("The Prosecutor charges Mr Duterte with murder as a crime against humanity.")],
    expectStripped: ["torture", "imprisonment"],
    expectKept: ["murder"],
    expectAllStripped: false,
  },
  {
    id: "CV-02",
    answer: "Count 1: murder, Count 2: imprisonment [1].",
    chunks: [mkChunk("Count 1: murder. Count 2: deprivation of liberty.")],
    expectStripped: [],
    expectKept: ["murder", "imprisonment"],
    expectAllStripped: false,
  },
  {
    id: "CV-03",
    answer: "The charges include murder and other inhumane acts [1].",
    chunks: [mkChunk("murder and other inhumane acts as crimes against humanity.")],
    expectStripped: [],
    expectKept: ["murder", "other inhumane acts"],
    expectAllStripped: false,
  },
  {
    id: "CV-04",
    answer: "The evidence includes witness statements and documentary evidence [1].",
    chunks: [mkChunk("witness statements and documentary evidence were disclosed.")],
    expectStripped: [],
    expectKept: ["witness statements", "documentary evidence"],
    expectAllStripped: false,
  },
  {
    id: "CV-05",
    answer: "Charges: murder [1] and torture [2].",
    chunks: [
      mkChunk("murder as a crime against humanity.", "1"),
      mkChunk("torture and other inhumane acts.", "2"),
    ],
    expectStripped: [],
    expectKept: ["murder", "torture"],
    expectAllStripped: false,
  },
  {
    id: "CV-07",
    answer: "Duterte is charged with murder, imprisonment, and torture [1].",
    chunks: [mkChunk("The accused faces murder as a crime against humanity.")],
    expectStripped: ["imprisonment", "torture"],
    expectKept: ["murder"],
    expectAllStripped: false,
  },
  {
    id: "CV-08",
    answer: "The charges are murder and attempted murder [1].",
    chunks: [mkChunk("murder and attempted murder as crimes against humanity.")],
    expectStripped: [],
    expectKept: ["murder", "attempted murder"],
    expectAllStripped: false,
  },
];

function main() {
  console.log("Verifying Phase 4 (CV-01 through CV-08)...\n");
  let passed = 0;
  let failed = 0;

  for (const t of TESTS) {
    process.stdout.write(`${t.id}: `);
    try {
      const result = verifyEnumeratedClaims(t.answer, t.chunks);

      const strippedOriginals = result.strippedClaims.map((c) => c.original.toLowerCase());
      const keptInAnswer = t.expectKept.every((k) =>
        result.cleanedAnswer.toLowerCase().includes(k.toLowerCase())
      );
      const strippedCorrect = t.expectStripped.every((s) =>
        strippedOriginals.some((o) => o.includes(s.toLowerCase()) || s.toLowerCase().includes(o))
      );
      const noOverstrip = t.expectKept.every((k) => {
        const lower = k.toLowerCase();
        return (
          result.cleanedAnswer.toLowerCase().includes(lower) ||
          result.strippedClaims.some((c) => c.original.toLowerCase().includes(lower))
        );
      });

      let ok = true;
      if (t.expectAllStripped && result.cleanedAnswer !== "The specific charges, crimes, or other items are detailed in the ICC documents but could not be individually verified from the retrieved passages.") {
        console.log("FAIL (expected all stripped, fallback text)");
        failed++;
        continue;
      }
      if (!t.expectAllStripped && t.expectStripped.length > 0 && !strippedCorrect) {
        console.log("FAIL (expected to strip:", t.expectStripped.join(", ") + ")");
        failed++;
        continue;
      }
      if (!keptInAnswer && t.expectKept.length > 0) {
        console.log("FAIL (expected to keep:", t.expectKept.join(", ") + ")");
        failed++;
        continue;
      }
      if (t.expectStripped.length !== result.strippedClaims.length) {
        console.log(
          `FAIL (stripped ${result.strippedClaims.length}, expected ${t.expectStripped.length})`
        );
        failed++;
        continue;
      }

      console.log("PASS");
      passed++;
    } catch (e) {
      console.log("ERROR");
      console.error("  ", e instanceof Error ? e.message : e);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
