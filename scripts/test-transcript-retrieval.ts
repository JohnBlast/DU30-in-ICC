#!/usr/bin/env npx tsx
/**
 * Test transcript retrieval for a hearing-content query.
 * Usage: npx tsx --env-file=.env.local scripts/test-transcript-retrieval.ts
 */

import { retrieve } from "../lib/retrieve";

const QUERY = "What were the closing statements of the defence during the confirmation of charges?";

async function main() {
  console.log("Query:", QUERY);
  console.log("\nRetrieving with documentType: 'transcript' (hearing-content query)...\n");

  const result = await retrieve({
    query: QUERY,
    ragIndexes: [2],
    intent: "case_facts",
    documentType: "transcript",
  });

  console.log(`Retrieved ${result.chunks.length} chunks\n`);
  result.chunks.forEach((c, i) => {
    const docType = (c.metadata?.document_type as string) ?? "?";
    const title = (c.metadata?.document_title as string) ?? "?";
    const preview = c.content.slice(0, 200).replace(/\n/g, " ");
    console.log(`--- Chunk ${i + 1} [${docType}] ${title} ---`);
    console.log(`${preview}...`);
    console.log("");
  });
}

main().catch(console.error);
