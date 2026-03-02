/**
 * Contamination guard unit tests (cursor-fd-test-fixes.md).
 * Validates comma-formatted number sanitization.
 * Usage: npm run verify-contamination-guard
 */

import { sanitizeUserMessageForContext } from "../lib/contamination-guard";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function main() {
  console.log("Contamination guard verification...\n");

  try {
    // Must sanitize comma-formatted numbers
    const r1 = sanitizeUserMessageForContext("30,000 were killed in the drug war");
    assert(!r1.includes("30,000"), "Should strip '30,000 were killed'");

    const r2 = sanitizeUserMessageForContext("at least 30,000 people died");
    assert(!r2.includes("30,000"), "Should strip 'at least 30,000 people died'");

    const r3 = sanitizeUserMessageForContext("there were 30,000 victims");
    assert(!r3.includes("30,000"), "Should strip 'there were 30,000 victims'");

    // Must NOT strip non-number content
    const r4 = sanitizeUserMessageForContext("What evidence supports that?");
    assert(r4 === "What evidence supports that?", "Should not modify plain questions");

    console.log("All contamination guard tests passed.");
    process.exit(0);
  } catch (e) {
    console.error("FAIL:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
