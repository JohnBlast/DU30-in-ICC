/**
 * Verify brainstormed user prompts from nl-interpretation.md §2.1.
 * Usage: npm run verify-nl-prompts
 */

import { chat } from "../lib/chat";

/** Minimal ICC-like text for paste-text tests */
const SAMPLE_PASTE =
  "The suspect is alleged to have committed murder and attempted murder as crimes against humanity under Article 7 of the Rome Statute.";

const PROMPTS: Array<{
  id: number;
  category: string;
  query: string;
  pastedText?: string;
  expectIntent: string;
  expectAnswer: "substantive" | "substantive_or_decline" | "flat_decline" | "redaction" | "non_english" | "glossary_not_found";
}> = [
  // Case Facts (1-5)
  { id: 1, category: "case_facts", query: "What is Duterte charged with?", expectIntent: "case_facts", expectAnswer: "substantive" },
  { id: 2, category: "case_facts", query: "What are the three counts against Duterte?", expectIntent: "case_facts", expectAnswer: "substantive" },
  { id: 3, category: "case_facts", query: "Who are the victims in the case?", expectIntent: "case_facts", expectAnswer: "substantive" },
  { id: 4, category: "case_facts", query: "What evidence does the ICC have?", expectIntent: "case_facts", expectAnswer: "substantive" },
  { id: 5, category: "case_facts", query: "How many people were killed in the drug war according to the charges?", expectIntent: "case_facts", expectAnswer: "substantive" },
  // Case Timeline (6-9) — #6, #7 may return "not addressed" if KB lacks that specific content
  { id: 6, category: "case_timeline", query: "When did the ICC open the investigation into Duterte?", expectIntent: "case_timeline", expectAnswer: "substantive_or_decline" },
  { id: 7, category: "case_timeline", query: "What happened at the February 2026 hearing?", expectIntent: "case_timeline", expectAnswer: "substantive_or_decline" },
  { id: 8, category: "case_timeline", query: "What's the timeline of the case so far?", expectIntent: "case_timeline", expectAnswer: "substantive" },
  { id: 9, category: "case_timeline", query: "When was the arrest warrant issued?", expectIntent: "case_timeline", expectAnswer: "substantive" },
  // Legal Concepts (10-13)
  { id: 10, category: "legal_concept", query: "What is Article 7 of the Rome Statute?", expectIntent: "legal_concept", expectAnswer: "substantive" },
  { id: 11, category: "legal_concept", query: "What are crimes against humanity?", expectIntent: "legal_concept", expectAnswer: "substantive" },
  { id: 12, category: "legal_concept", query: "What is the Pre-Trial Chamber?", expectIntent: "legal_concept", expectAnswer: "substantive" },
  { id: 13, category: "legal_concept", query: "What does the Rome Statute say about murder as a crime against humanity?", expectIntent: "legal_concept", expectAnswer: "substantive" },
  // Procedure (14-16)
  { id: 14, category: "procedure", query: "What happens after confirmation of charges?", expectIntent: "procedure", expectAnswer: "substantive" },
  { id: 15, category: "procedure", query: "What is the next step in the case?", expectIntent: "procedure", expectAnswer: "substantive" },
  { id: 16, category: "procedure", query: "Can Duterte be tried if he doesn't show up?", expectIntent: "procedure", expectAnswer: "substantive" },
  // Glossary (17-19)
  { id: 17, category: "glossary", query: "What does 'in absentia' mean?", expectIntent: "glossary", expectAnswer: "substantive" },
  { id: 18, category: "glossary", query: "What is 'proprio motu'?", expectIntent: "glossary", expectAnswer: "substantive" },
  { id: 19, category: "glossary", query: "What does confirmation of charges mean?", expectIntent: "glossary", expectAnswer: "substantive" },
  // Paste-Text (20-22) — require pasted text
  { id: 20, category: "paste_text", query: "What does this paragraph mean?", pastedText: SAMPLE_PASTE, expectIntent: "paste_text", expectAnswer: "substantive" },
  { id: 21, category: "paste_text", query: "Can you explain this in simpler terms?", pastedText: SAMPLE_PASTE, expectIntent: "paste_text", expectAnswer: "substantive" },
  { id: 22, category: "paste_text", query: "What is this section saying about the charges?", pastedText: SAMPLE_PASTE, expectIntent: "paste_text", expectAnswer: "substantive" },
  // Out of Scope (23-27)
  { id: 23, category: "out_of_scope", query: "Was Duterte justified in the drug war?", expectIntent: "out_of_scope", expectAnswer: "flat_decline" },
  { id: 24, category: "out_of_scope", query: "Is the ICC biased against the Philippines?", expectIntent: "out_of_scope", expectAnswer: "flat_decline" },
  { id: 25, category: "out_of_scope", query: "What's Duterte's favorite color?", expectIntent: "out_of_scope", expectAnswer: "flat_decline" },
  { id: 26, category: "out_of_scope", query: "Who will be the next president of the Philippines?", expectIntent: "out_of_scope", expectAnswer: "flat_decline" },
  { id: 27, category: "out_of_scope", query: "Why is the sky blue?", expectIntent: "out_of_scope", expectAnswer: "flat_decline" },
  // Redacted (28-30) — 28 has literal [REDACTED]; 29-30 get flat decline (out_of_scope)
  { id: 28, category: "redacted", query: "Who is [REDACTED] in the charges?", expectIntent: "out_of_scope", expectAnswer: "redaction" },
  { id: 29, category: "redacted", query: "Can you figure out what name is redacted in Count 2?", expectIntent: "out_of_scope", expectAnswer: "flat_decline" },
  { id: 30, category: "redacted", query: "What's behind the redacted section on page 15?", expectIntent: "out_of_scope", expectAnswer: "flat_decline" },
];

const FLAT_DECLINE = "This is not addressed in current ICC records.";

function checkExpected(answer: string, expected: string): boolean {
  const a = answer.trim().toLowerCase();
  if (expected === "flat_decline") {
    return a === FLAT_DECLINE.toLowerCase();
  }
  if (expected === "redaction") {
    return a.includes("redacted") && (a.includes("cannot investigate") || a.includes("cannot speculate"));
  }
  if (expected === "substantive") {
    return a.length > 50 && !a.startsWith(FLAT_DECLINE.toLowerCase());
  }
  if (expected === "substantive_or_decline") {
    const isSubstantive = a.length > 50 && !a.startsWith(FLAT_DECLINE.toLowerCase());
    const isDecline = a.startsWith(FLAT_DECLINE.toLowerCase());
    return isSubstantive || isDecline;
  }
  return true;
}

async function main() {
  console.log("Verifying nl-interpretation.md §2.1 brainstormed prompts...\n");
  let passed = 0;
  let failed = 0;

  for (const p of PROMPTS) {
    process.stdout.write(`#${p.id} [${p.category}] "${p.query.slice(0, 45)}${p.query.length > 45 ? "…" : ""}": `);
    try {
      const result = await chat({
        query: p.query,
        pastedText: p.pastedText,
        conversationHistory: [],
      });

      const ok = checkExpected(result.answer, p.expectAnswer);
      if (ok) {
        console.log("PASS");
        passed++;
      } else {
        console.log("FAIL");
        console.log(`  Expected: ${p.expectAnswer}`);
        console.log(`  Got: ${result.answer.slice(0, 120)}${result.answer.length > 120 ? "…" : ""}`);
        failed++;
      }
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
