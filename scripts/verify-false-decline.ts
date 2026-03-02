/**
 * False-decline verification (cursor-false-decline-reduction.md).
 * Ensures previously declined newcomer questions now get cited answers.
 * Usage: npm run verify-false-decline
 */

import { chat } from "../lib/chat";

interface TestCase {
  id: string;
  query: string;
  description: string;
  expect: (answer: string) => boolean;
}

const TESTS: TestCase[] = [
  {
    id: "FD-01",
    query: "Has Duterte been convicted?",
    description: "Cited answer with 'not been convicted' or 'confirmation of charges'",
    expect: (a) =>
      /\b(not\s+been\s+convicted|confirmation\s+of\s+charges|no\s+verdict)\b/i.test(a) && /\[\d+\]/.test(a),
  },
  {
    id: "FD-02",
    query: "What are the charges?",
    description: "Cited answer listing counts",
    expect: (a) => /\[\d+\]/.test(a) && (/\b(count|charges?|indictment)\b/i.test(a) || /\d+\s+(count|charge)/i.test(a)),
  },
  {
    id: "FD-03",
    query: "What evidence is there?",
    description: "Cited answer from DCC/case documents",
    expect: (a) => /\[\d+\]/.test(a) && a.length > 80,
  },
  {
    id: "FD-04",
    query: "Is there a trial yet?",
    description: "Cited answer: no trial yet, case at confirmation stage",
    expect: (a) =>
      /\b(no\s+trial|confirmation|not\s+yet|pre-?trial)\b/i.test(a) && /\[\d+\]/.test(a),
  },
  {
    id: "FD-05",
    query: "What's the status of the case?",
    description: "Cited answer with current procedural stage",
    expect: (a) => /\[\d+\]/.test(a) && (/\b(confirmation|pre-?trial|investigation|status)\b/i.test(a) || a.length > 100),
  },
  {
    id: "FD-06",
    query: "Who is the judge?",
    description: "Cited answer with chamber/judge info",
    expect: (a) => /\[\d+\]/.test(a) && a.length > 60,
  },
  {
    id: "FD-07",
    query: "Has he been arrested?",
    description: "Cited answer about surrender/arrest",
    expect: (a) =>
      /\[\d+\]/.test(a) &&
      (/\b(surrender|arrest|warrant|detained|custody)\b/i.test(a) || /\bnot\s+(yet|been)\b/i.test(a)),
  },
  {
    id: "FD-08",
    query: "What are Duterte's rights at the ICC?",
    description: "Cited answer from Rome Statute + case docs",
    expect: (a) => /\[\d+\]/.test(a) && (/\b(rights?|article|statute)\b/i.test(a) || a.length > 80),
  },
  {
    id: "FD-09",
    query: "Can the case be dismissed?",
    description: "Cited answer about admissibility/complementarity",
    expect: (a) =>
      /\[\d+\]/.test(a) &&
      (/\b(admissib|complementar|dismiss|article\s+17|article\s+18)\b/i.test(a) || a.length > 80),
  },
  {
    id: "FD-10",
    query: "What happens after this?",
    description: "Cited answer about next procedural step",
    expect: (a) => /\[\d+\]/.test(a) && a.length > 60,
  },
  {
    id: "FD-11",
    query: "What did that murderer Duterte do?",
    description: "Neutralized query; cited answer without 'murderer' in output",
    expect: (a) => !/\bmurderer\b/i.test(a) && /\[\d+\]/.test(a) && a.length > 80,
  },
  {
    id: "FD-12",
    query: "What are the allegations against Duterte?",
    description: "Cited answer (synonym expansion catches 'allegations')",
    expect: (a) => /\[\d+\]/.test(a) && (/\b(charges?|counts?|allegations?)\b/i.test(a) || a.length > 80),
  },
  {
    id: "FD-13",
    query: "Is the case legitimate?",
    description: "NOT caught by normative filter; cited answer about admissibility",
    expect: (a) =>
      /\[\d+\]/.test(a) &&
      !/evaluation or opinion|not addressed/i.test(a) &&
      (/\b(admissib|legitimate|valid|article)\b/i.test(a) || a.length > 80),
  },
  {
    id: "FD-14",
    query: "Should Duterte appear at the hearing?",
    description: "NOT caught by normative filter; cited answer about legal obligation",
    expect: (a) =>
      /\[\d+\]/.test(a) &&
      !/evaluation or opinion|not addressed/i.test(a) &&
      (/\b(appear|attend|surrender|obligat|rule|article)\b/i.test(a) || a.length > 80),
  },
];

async function main() {
  console.log("False-decline verification (cursor-false-decline-reduction.md)\n");

  let passed = 0;
  let failed = 0;

  for (const t of TESTS) {
    process.stdout.write(`${t.id}: `);
    try {
      const result = await chat({ query: t.query, conversationHistory: [] });
      const ok = t.expect(result.answer);
      if (ok) {
        console.log("PASS");
        passed++;
      } else {
        console.log("FAIL");
        console.log(`  ${t.description}`);
        console.log(`  Got: ${result.answer.slice(0, 250)}…`);
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
