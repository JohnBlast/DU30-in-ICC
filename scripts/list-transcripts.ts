#!/usr/bin/env npx tsx
/**
 * List transcript documents and their chunk counts.
 * Usage: npx tsx --env-file=.env.local scripts/list-transcripts.ts
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
  const { data: transcripts, error } = await supabase
    .from("icc_documents")
    .select("document_id, title, url, date_published, last_crawled_at")
    .eq("document_type", "transcript")
    .order("title");

  if (error) {
    console.error("Error fetching transcripts:", error);
    process.exit(1);
  }

  if (!transcripts?.length) {
    console.log("No transcript documents in the knowledge base.");
    console.log("Run: npm run ingest -- --discover-transcripts --ingest");
    return;
  }

  const countByDoc = new Map<string, number>();
  for (const t of transcripts) {
    const { count } = await supabase
      .from("document_chunks")
      .select("chunk_id", { count: "exact", head: true })
      .eq("document_id", t.document_id);
    countByDoc.set(t.document_id, count ?? 0);
  }

  console.log("=== TRANSCRIPT DOCUMENTS ===\n");
  let totalChunks = 0;
  for (const t of transcripts) {
    const chunks = countByDoc.get(t.document_id) ?? 0;
    totalChunks += chunks;
    console.log(`  ${t.title}`);
    console.log(`    URL: ${t.url}`);
    console.log(`    chunks: ${chunks}`);
    console.log("");
  }
  console.log(`Total: ${transcripts.length} transcript(s), ${totalChunks} chunks`);
}

main().catch(console.error);
