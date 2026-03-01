/**
 * Diagnostic: check what chunks retrieval returns for a query.
 * Usage: npm run check-retrieval -- "What are the evidences against Duterte?"
 */

import { retrieve } from "../lib/retrieve";
import { classifyIntent } from "../lib/intent-classifier";
import { intentToRagIndexes } from "../lib/intent";

const query = process.argv[2] || "What are the evidences against Duterte?";

async function main() {
  console.log(`Query: "${query}"\n`);
  const { intent } = await classifyIntent(query, false);
  const ragIndexes = intentToRagIndexes(intent, query);
  console.log(`Intent: ${intent} → RAG ${ragIndexes.length ? ragIndexes : "none"}`);

  const result = await retrieve({ query, ragIndexes: ragIndexes.length ? ragIndexes : [2] });
  console.log(`Chunks: ${result.chunks.length}\n`);

  result.chunks.forEach((c, i) => {
    console.log(`--- Chunk ${i + 1} (${c.metadata?.document_title ?? "?"}) ---`);
    console.log(c.content.slice(0, 400) + (c.content.length > 400 ? "…" : ""));
    console.log("");
  });
}

main().catch(console.error);
