/**
 * Verdict stability tests (production-hardening Phase 8).
 * Runs canonical fact-check inputs; asserts verdict and expected phrases.
 * Usage: npm run verify-verdict-stability
 */

import { extractClaims, generateFactCheckResponse } from "../lib/fact-check";
import { retrieve } from "../lib/retrieve";
import { classifyIntent } from "../lib/intent-classifier";
import { intentToRagIndexes } from "../lib/intent";

const VERDICT_STABILITY_TESTS = [
  {
    id: "VS-01",
    pastedText: "Duterte was convicted by the ICC",
    expectedVerdict: "false",
    expectedPhrases: ["confirmation of charges"],
    critical: true,
  },
  {
    id: "VS-02",
    pastedText: "Duterte is charged with three counts of crimes against humanity",
    expectedVerdict: "verified",
    expectedPhrases: ["three counts", "crimes against humanity"],
    critical: true,
  },
  {
    id: "VS-03",
    pastedText: "Duterte was charged with genocide",
    expectedVerdict: "false",
    expectedPhrases: ["crimes against humanity"],
    critical: true,
  },
  {
    id: "VS-04",
    pastedText: "The ICC issued an arrest warrant for Duterte",
    expectedVerdict: "verified",
    expectedPhrases: ["warrant"],
    critical: true,
  },
  {
    id: "VS-05",
    pastedText: "Duterte was sentenced to life imprisonment",
    expectedVerdict: "false",
    expectedPhrases: ["confirmation of charges", "no sentence"],
    critical: true,
  },
];

async function main() {
  console.log("Verdict stability verification...\n");
  let passed = 0;
  let failed = 0;

  for (const test of VERDICT_STABILITY_TESTS) {
    process.stdout.write(`${test.id}: `);
    try {
      const claims = await extractClaims(test.pastedText);
      const factualClaims = claims.filter((c) => c.claimType === "factual_claim");
      if (factualClaims.length === 0) {
        console.log("FAIL — no factual claims extracted");
        failed++;
        if (test.critical) {
          console.log(`  CRITICAL: ${test.pastedText}`);
        }
        continue;
      }

      const { intent } = await classifyIntent(test.pastedText, true);
      const ragIndexes = intentToRagIndexes(intent, test.pastedText);
      const claimQuery = factualClaims.map((c) => c.extractedText).join(". ");
      const result = await retrieve({
        query: claimQuery,
        ragIndexes,
        intent,
      });

      if (result.chunks.length === 0) {
        console.log("FAIL — no chunks retrieved");
        failed++;
        continue;
      }

      const { answer, factCheck } = await generateFactCheckResponse(
        claims,
        result.chunks,
        test.pastedText.slice(0, 100),
        "en",
        "en"
      );

      const overallVerdict = factCheck.overallVerdict;
      const verdictMatch = overallVerdict === test.expectedVerdict;
      const phraseMatch = test.expectedPhrases.every((p) =>
        new RegExp(p, "i").test(answer)
      );

      if (verdictMatch && phraseMatch) {
        console.log(`PASS (verdict: ${overallVerdict})`);
        passed++;
      } else {
        console.log(
          `FAIL — expected verdict ${test.expectedVerdict}, got ${overallVerdict}` +
            (phraseMatch ? "" : "; expected phrase(s) missing")
        );
        failed++;
        if (test.critical) {
          console.log(`  CRITICAL: ${test.pastedText}`);
        }
      }
    } catch (e) {
      console.log(`FAIL — ${e instanceof Error ? e.message : String(e)}`);
      failed++;
      if (test.critical) {
        console.log(`  CRITICAL: ${test.pastedText}`);
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  const criticalFailed = VERDICT_STABILITY_TESTS.filter(
    (t) => t.critical
  ).length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
