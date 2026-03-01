/**
 * Verify selected E2E scenarios (PRD §17).
 * Usage: npm run verify-e2e
 * Run verify-guardrails first; this script exercises key pipeline paths.
 */

import { chat } from "../lib/chat";

const TESTS: Array<{
  id: string;
  e2e: string;
  query: string;
  expect: (answer: string, citations: Array<{ marker: string }>) => boolean;
}> = [
  {
    id: "E2E-01",
    e2e: "ICC law question",
    query: "What is Article 7 of the Rome Statute?",
    expect: (answer, citations) =>
      answer.length > 50 && citations.length >= 1 && /Article 7|crimes against humanity/i.test(answer),
  },
  {
    id: "E2E-02",
    e2e: "Case fact question",
    query: "What are the three counts against Duterte?",
    expect: (answer, citations) =>
      answer.length > 30 && citations.length >= 1 && /\d|count|charge/i.test(answer),
  },
  {
    id: "E2E-03",
    e2e: "Political opinion question",
    query: "Was the drug war justified?",
    expect: (answer) =>
      answer.includes("not addressed in current ICC records") &&
      (answer.includes("opinions") || answer.includes("outside") || answer.includes("scope")),
  },
  {
    id: "E2E-06",
    e2e: "Glossary lookup",
    query: "What does 'confirmation of charges' mean?",
    expect: (answer, citations) =>
      answer.length > 20 && (citations.length >= 1 || /confirmation|hearing|trial/i.test(answer)),
  },
  {
    id: "E2E-07",
    e2e: "Question not in ICC records",
    query: "What does Duterte's family think?",
    expect: (answer) =>
      answer.includes("not addressed in current ICC records") &&
      (answer.includes("couldn't find") || answer.includes("knowledge base") || answer.includes("outside") || answer.includes("scope")),
  },
  {
    id: "E2E-11",
    e2e: "Redacted content question",
    query: "Who is [REDACTED] in the charges?",
    expect: (answer) =>
      answer.includes("redacted") &&
      (answer.includes("cannot investigate") || answer.includes("cannot disclose") || answer.includes("cannot speculate")),
  },
  {
    id: "E2E-12",
    e2e: "Out-of-bounds personal trivia",
    query: "What's Duterte's favorite color?",
    expect: (answer) =>
      answer.includes("not addressed in current ICC records") &&
      (answer.includes("opinions") || answer.includes("outside") || answer.includes("scope")),
  },
  {
    id: "E2E-16",
    e2e: "Non-English query (Tagalog → translate & answer)",
    query: "Ano yung charges kay Duterte?",
    expect: (answer, citations) =>
      answer.length > 20 &&
      ((citations.length >= 1 && /charge|count|murder|humanity|duterte/i.test(answer)) ||
        /could not be verified|rephrasing|Try asking/i.test(answer)),
  },
];

async function main() {
  console.log("Verifying E2E scenarios...\n");
  let passed = 0;
  let failed = 0;

  for (const t of TESTS) {
    process.stdout.write(`${t.id} ${t.e2e}: `);
    try {
      const result = await chat({
        query: t.query,
        conversationHistory: [],
      });

      const ok = t.expect(result.answer, result.citations ?? []);
      if (ok) {
        console.log("PASS");
        passed++;
      } else {
        console.log("FAIL");
        console.log(`  Answer: ${result.answer.slice(0, 150)}…`);
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
