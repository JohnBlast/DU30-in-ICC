/**
 * Phase 3 false decline reduction: FD-01 through FD-08.
 * Usage: npm run verify-phase3
 */

import { chat } from "../lib/chat";

const FLAT_DECLINE = "This is not addressed in current ICC records.";

const TESTS: Array<{
  id: string;
  query: string;
  expectNotFlatDecline: boolean;
  expectCitations: boolean;
  expectVerified: boolean;
}> = [
  {
    id: "FD-01 Withdrawal invalidate",
    query:
      "Since the Philippines withdrew from the Rome Statute, does that automatically invalidate the ICC case?",
    expectNotFlatDecline: true,
    expectCitations: true,
    expectVerified: true,
  },
  {
    id: "FD-02 Evidence listed",
    query:
      "How many pieces of evidence are listed in the ICC documents, and where can the public access them?",
    expectNotFlatDecline: true,
    expectCitations: true,
    expectVerified: true,
  },
  {
    id: "FD-03 Filipino lawyers",
    query:
      "Can Duterte's Filipino lawyers represent him before the ICC, or do they need special accreditation?",
    expectNotFlatDecline: true,
    expectCitations: true,
    expectVerified: true,
  },
  {
    id: "FD-04 Detention + filing date",
    query:
      "Where is Duterte currently detained, and when was that confirmed in an ICC filing?",
    expectNotFlatDecline: true,
    expectCitations: true,
    expectVerified: true,
  },
  {
    id: "FD-05 Trial started",
    query: "Has the trial started yet?",
    expectNotFlatDecline: true,
    expectCitations: true,
    expectVerified: true,
  },
  {
    id: "FD-06 Types of evidence",
    query: "What types of evidence does the ICC have against Duterte?",
    expectNotFlatDecline: true,
    expectCitations: true,
    expectVerified: true,
  },
  {
    id: "FD-07 Jurisdiction after withdrawal",
    query: "Does the ICC's jurisdiction still apply after the Philippines left?",
    expectNotFlatDecline: true,
    expectCitations: true,
    expectVerified: true,
  },
  {
    id: "FD-08 Representing Duterte",
    query: "Who is representing Duterte at the ICC?",
    expectNotFlatDecline: true,
    expectCitations: true,
    expectVerified: true,
  },
];

async function main() {
  console.log("Verifying Phase 3 (FD-01 through FD-08)...\n");
  let passed = 0;
  let failed = 0;

  for (const t of TESTS) {
    process.stdout.write(`${t.id}: `);
    try {
      const result = await chat({ query: t.query });

      if (t.expectNotFlatDecline && result.answer.trim() === FLAT_DECLINE) {
        console.log("FAIL (flat decline)");
        failed++;
        continue;
      }
      if (t.expectVerified && !result.verified) {
        console.log("FAIL (judge rejected)");
        failed++;
        continue;
      }
      if (
        t.expectCitations &&
        result.citations.length === 0 &&
        !/\[\d+\]/.test(result.answer)
      ) {
        console.log("FAIL (no citations)");
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
