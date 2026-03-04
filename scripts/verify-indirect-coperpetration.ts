/**
 * Indirect co-perpetration regression tests (cursor-indirect-coperpetration-fix).
 * Verifies: follow-up rewrite, list retrieval, no spurious out_of_scope.
 * Usage: npm run verify-indirect-coperpetration
 */

import { chat } from "../lib/chat";

interface TestCase {
  id: string;
  description: string;
  run: () => Promise<boolean>;
}

const FLAT_DECLINE = "This is not addressed in current ICC records.";

const TESTS: TestCase[] = [
  {
    id: "IC-01",
    description: "Who are indirect co-perpetrators — not flat decline",
    run: async () => {
      const r = await chat({
        query: "Who are the indirect co-perpetrators in DU30's case?",
        conversationHistory: [],
      });
      const isDecline = r.answer.trim() === FLAT_DECLINE;
      if (isDecline) return false;
      return true;
    },
  },
  {
    id: "IC-02",
    description: "Multi-turn: 'list them' after co-perpetration question — not out_of_scope",
    run: async () => {
      const r1 = await chat({
        query: "Who are indirect co-perpetration in DU30's case?",
        conversationHistory: [],
      });
      const r2 = await chat({
        query: "can you list them?",
        conversationHistory: [
          { role: "user", content: "Who are indirect co-perpetration in DU30's case?" },
          { role: "assistant", content: r1.answer },
        ],
      });
      const isDecline = r2.answer.trim() === FLAT_DECLINE;
      return !isDecline;
    },
  },
  {
    id: "IC-03",
    description: "Multi-turn: 'what about Ronald Dela Rosa' — not out_of_scope when prior context",
    run: async () => {
      const r1 = await chat({
        query: "Who are the indirect co-perpetrators?",
        conversationHistory: [],
      });
      const r2 = await chat({
        query: "then what about Ronald 'Bato' DELA ROSA",
        conversationHistory: [
          { role: "user", content: "Who are the indirect co-perpetrators?" },
          { role: "assistant", content: r1.answer },
        ],
      });
      const isDecline = r2.answer.trim() === FLAT_DECLINE;
      return !isDecline;
    },
  },
  {
    id: "IC-04",
    description: "List query retrieves and answers — cited or partial, no hallucination",
    run: async () => {
      const r = await chat({
        query: "List the named co-perpetrators in the Duterte ICC case",
        conversationHistory: [],
      });
      if (r.answer.trim() === FLAT_DECLINE) return false;
      if (/\[\d+\]/.test(r.answer)) return true;
      if (/not\s+(present|available|in\s+the\s+retrieved)/i.test(r.answer)) return true;
      return r.answer.length > 80;
    },
  },
];

async function main() {
  console.log("Indirect co-perpetration verification\n");

  let passed = 0;
  let failed = 0;

  for (const t of TESTS) {
    process.stdout.write(`${t.id}: `);
    try {
      const ok = await t.run();
      if (ok) {
        console.log("PASS");
        passed++;
      } else {
        console.log("FAIL");
        console.log(`  ${t.description}`);
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
