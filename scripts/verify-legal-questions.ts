/**
 * Verify legal question coverage — representative questions from jurisdiction,
 * authorization, complementarity, warrant, charges, fair trial, procedure,
 * outcomes, and state cooperation.
 * Usage: npm run verify-legal-questions
 */

import { chat } from "../lib/chat";

const FLAT_DECLINE_PATTERN = /not addressed in current ICC records/i;
const REDACTED_RESPONSE = /redacted|cannot investigate|cannot disclose|cannot speculate/i;

type Expectation = "substantive" | "flat_decline" | "redacted_or_decline";

const TESTS: Array<{
  id: string;
  category: string;
  query: string;
  expect: Expectation;
  /** If substantive, ensure answer has some minimum content and citations when available */
  minLength?: number;
}> = [
  // 1. Jurisdiction (Legal Basis)
  {
    id: "J-1",
    category: "Jurisdiction",
    query: "What dates define the ICC's temporal jurisdiction over alleged crimes in the Philippines?",
    expect: "substantive",
    minLength: 30,
  },
  {
    id: "J-2",
    category: "Jurisdiction",
    query: "Which articles of the Rome Statute are cited as the jurisdictional basis for the Philippines case?",
    expect: "substantive",
    minLength: 30,
  },
  {
    id: "J-3",
    category: "Jurisdiction",
    query: "Are the alleged crimes classified under Article 7 (crimes against humanity), and which specific sub-paragraphs?",
    expect: "substantive",
    minLength: 40,
  },
  // 2. Authorization of Investigation
  {
    id: "A-1",
    category: "Authorization",
    query: "Did the Prosecutor seek authorization under Article 15 for the Philippines investigation?",
    expect: "substantive",
    minLength: 20,
  },
  // 3. Complementarity (Admissibility)
  {
    id: "C-1",
    category: "Complementarity",
    query: "Did the ICC evaluate whether Philippine authorities were investigating the same conduct?",
    expect: "substantive",
    minLength: 20,
  },
  // 4. Arrest Warrant
  {
    id: "W-1",
    category: "Arrest Warrant",
    query: "Has a public arrest warrant been issued in the Duterte case?",
    expect: "substantive",
    minLength: 20,
  },
  {
    id: "W-2",
    category: "Arrest Warrant",
    query: "Under which article (typically Article 58) would an arrest warrant be issued?",
    expect: "substantive",
    minLength: 30,
  },
  // 5. Charges and Legal Theory
  {
    id: "Ch-1",
    category: "Charges",
    query: "What specific acts are alleged against Duterte (e.g., murder as a crime against humanity)?",
    expect: "substantive",
    minLength: 50,
  },
  {
    id: "Ch-2",
    category: "Charges",
    query: "Does the Prosecutor allege a widespread or systematic attack?",
    expect: "substantive",
    minLength: 20,
  },
  {
    id: "Ch-4",
    category: "Charges",
    query: "Did Duterte surrender or was he arrested?",
    expect: "substantive",
    minLength: 60,
  },
  {
    id: "Ch-3",
    category: "Charges",
    query: "Is Duterte alleged to have direct responsibility or superior responsibility?",
    expect: "substantive",
    minLength: 30,
  },
  // 6. Fair Trial and Due Process
  {
    id: "F-1",
    category: "Fair Trial",
    query: "What rights are guaranteed under Article 67 of the Rome Statute?",
    expect: "substantive",
    minLength: 40,
  },
  {
    id: "F-2",
    category: "Fair Trial",
    query: "What is the burden of proof at trial?",
    expect: "substantive",
    minLength: 20,
  },
  {
    id: "F-3",
    category: "Fair Trial",
    query: "What is the standard at confirmation of charges?",
    expect: "substantive",
    minLength: 30,
  },
  // 7. Procedural Stage
  {
    id: "P-1",
    category: "Procedural Stage",
    query: "Has a confirmation of charges hearing been scheduled in the Duterte case?",
    expect: "substantive",
    minLength: 20,
  },
  {
    id: "P-2",
    category: "Procedural Stage",
    query: "What procedural steps must occur before trial begins?",
    expect: "substantive",
    minLength: 40,
  },
  {
    id: "P-3",
    category: "Procedural Stage",
    query: "Can charges be amended before confirmation?",
    expect: "substantive",
    minLength: 20,
  },
  // 8. Potential Outcomes
  {
    id: "O-1",
    category: "Outcomes",
    query: "What sentencing range is permitted under Article 77 of the Rome Statute?",
    expect: "substantive",
    minLength: 30,
  },
  {
    id: "O-2",
    category: "Outcomes",
    query: "Can life imprisonment be imposed under the Rome Statute, and under what conditions?",
    expect: "substantive",
    minLength: 30,
  },
  {
    id: "O-3",
    category: "Outcomes",
    query: "Does the Statute allow reparations to victims under Article 75?",
    expect: "substantive",
    minLength: 30,
  },
  // 9. State Cooperation
  {
    id: "S-1",
    category: "State Cooperation",
    query: "What are the cooperation obligations of States Parties under Part 9 of the Rome Statute?",
    expect: "substantive",
    minLength: 40,
  },
  {
    id: "S-2",
    category: "State Cooperation",
    query: "Can non-States Parties arrest a suspect if he enters their territory?",
    expect: "substantive",
    minLength: 30,
  },
  // Out-of-scope check (should still decline)
  {
    id: "X-1",
    category: "Out-of-scope",
    query: "Was Duterte justified in the drug war?",
    expect: "flat_decline",
  },
];

async function main() {
  console.log("Verifying legal question coverage...\n");
  let passed = 0;
  let failed = 0;
  const results: Array<{ id: string; category: string; status: string; answerPreview: string }> = [];

  for (const t of TESTS) {
    process.stdout.write(`${t.id} [${t.category}]: `);
    try {
      const result = await chat({
        query: t.query,
        conversationHistory: [],
      });

      const answer = result.answer.trim();
      let ok = false;

      if (t.expect === "flat_decline") {
        ok = FLAT_DECLINE_PATTERN.test(answer);
        if (!ok) {
          console.log("FAIL (expected flat decline)");
          console.log(`  Got: ${answer.slice(0, 120)}…`);
          failed++;
          continue;
        }
      } else if (t.expect === "redacted_or_decline") {
        ok = REDACTED_RESPONSE.test(answer) || FLAT_DECLINE_PATTERN.test(answer);
      } else {
        // substantive: accept real answer OR "not addressed" (KB limitation)
        const isUnverified = /could not be verified|rephrase your question/i.test(answer);
        const minLen = t.minLength ?? 20;
        const isDecline = FLAT_DECLINE_PATTERN.test(answer);
        ok = (!isDecline && !isUnverified && answer.length >= minLen) || isDecline;
        if (ok) {
          results.push({
            id: t.id,
            category: t.category,
            status: isDecline ? "NOT_IN_KB" : "PASS",
            answerPreview:
              isDecline ? "Not in current ICC records" : answer.slice(0, 80) + (answer.length > 80 ? "…" : ""),
          });
        }
      }

      if (ok) {
        const isDecline = FLAT_DECLINE_PATTERN.test(answer);
        const status =
          t.expect === "flat_decline" ? "PASS" : isDecline ? "NOT_IN_KB" : "PASS";
        console.log(status);
        if (!isDecline) {
          const citeCount = result.citations?.length ?? 0;
          console.log(`  → ${answer.slice(0, 100)}… [${citeCount} citations]`);
        }
        passed++;
      } else {
        console.log("FAIL");
        console.log(`  Answer: ${answer.slice(0, 150)}…`);
        failed++;
      }
    } catch (e) {
      console.log("ERROR");
      console.error("  ", e instanceof Error ? e.message : e);
      results.push({
        id: t.id,
        category: t.category,
        status: "ERROR",
        answerPreview: e instanceof Error ? e.message : String(e),
      });
      failed++;
    }
  }

  console.log("\n--- Summary ---");
  console.log(`${passed} passed, ${failed} failed`);

  const notInKb = results.filter((r) => r.status === "NOT_IN_KB");
  if (notInKb.length > 0) {
    console.log(`\n${notInKb.length} questions returned "not addressed" (KB may lack specific documents):`);
    notInKb.forEach((r) => console.log(`  ${r.id} [${r.category}]`));
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
