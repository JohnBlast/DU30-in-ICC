/**
 * Retrieval drift monitoring (docket-improvement-plan.md §24).
 * Runs canonical retrieval tests; compares to baseline. Use for CI/release gating.
 * Usage: npm run verify-retrieval-drift
 *
 * Baseline: test-fixtures/retrieval-drift-baseline.json (auto-created on first run if missing).
 * Critical queries must maintain >= 0.8 overlap with baseline.
 */

import { retrieve } from "../lib/retrieve";
import { classifyIntent } from "../lib/intent-classifier";
import { intentToRagIndexes } from "../lib/intent";
import * as fs from "fs";
import * as path from "path";

const BASELINE_PATH = path.join(process.cwd(), "test-fixtures", "retrieval-drift-baseline.json");

interface BaselineEntry {
  query: string;
  intent: string;
  ragIndexes: number[];
  expectedChunkIds: string[];
  critical: boolean;
  minOverlapRatio: number;
}

interface Baseline {
  createdAt: string;
  entries: BaselineEntry[];
}

const CANONICAL_QUERIES: Array<{ query: string; critical: boolean }> = [
  { query: "What is Duterte charged with?", critical: true },
  { query: "What is Tokhang?", critical: true },
  { query: "When was the arrest warrant issued?", critical: true },
  { query: "What did the prosecution argue?", critical: true },
  { query: "What is Article 7 of the Rome Statute?", critical: false },
];

function loadBaseline(): Baseline | null {
  try {
    const raw = fs.readFileSync(BASELINE_PATH, "utf-8");
    return JSON.parse(raw) as Baseline;
  } catch {
    return null;
  }
}

function saveBaseline(baseline: Baseline): void {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
}

function overlapRatio(expected: string[], actual: string[]): number {
  if (expected.length === 0) return 1;
  const actualSet = new Set(actual);
  const found = expected.filter((id) => actualSet.has(id)).length;
  return found / expected.length;
}

async function main() {
  console.log("Retrieval drift verification...\n");

  let baseline = loadBaseline();
  const isFirstRun = !baseline;

  if (isFirstRun) {
    console.log("No baseline found. Running retrieval to establish baseline...\n");
    const entries: BaselineEntry[] = [];

    for (const { query, critical } of CANONICAL_QUERIES) {
      const { intent } = await classifyIntent(query, false);
      const ragIndexes = intentToRagIndexes(intent, query);
      const result = await retrieve({
        query,
        ragIndexes,
        intent,
        useExtendedTopK: intent === "case_facts",
      });
      const chunkIds = result.chunks.map((c) => c.chunk_id);
      entries.push({
        query,
        intent: intent as string,
        ragIndexes,
        expectedChunkIds: chunkIds,
        critical,
        minOverlapRatio: critical ? 0.8 : 0.6,
      });
      console.log(`  ${query}: ${chunkIds.length} chunks`);
    }

    baseline = {
      createdAt: new Date().toISOString(),
      entries,
    };
    saveBaseline(baseline);
    console.log(`\nBaseline saved to ${BASELINE_PATH}`);
    console.log("Re-run to verify against baseline.");
    process.exit(0);
    return;
  }

  let passed = 0;
  let failed = 0;

  for (const entry of baseline.entries) {
    const result = await retrieve({
      query: entry.query,
      ragIndexes: entry.ragIndexes,
      intent: entry.intent,
      useExtendedTopK: entry.intent === "case_facts",
    });
    const actualIds = result.chunks.map((c) => c.chunk_id);
    const ratio = overlapRatio(entry.expectedChunkIds, actualIds);
    const ok = ratio >= entry.minOverlapRatio;

    if (ok) {
      console.log(`PASS ${entry.query} (overlap ${(ratio * 100).toFixed(0)}%)`);
      passed++;
    } else {
      console.log(`FAIL ${entry.query} (overlap ${(ratio * 100).toFixed(0)}%, need >= ${entry.minOverlapRatio * 100}%)`);
      failed++;
      if (entry.critical) {
        console.log(`  CRITICAL: expected overlap >= 0.8`);
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
