#!/usr/bin/env npx tsx
/**
 * List what has been ingested into the knowledge base.
 * Usage: npx tsx --env-file=.env.local scripts/list-ingested.ts
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
  const { data: docs, error } = await supabase
    .from("icc_documents")
    .select("document_id, title, document_type, rag_index, date_published, url, last_crawled_at")
    .order("rag_index")
    .order("title");

  if (error) {
    console.error("Error fetching icc_documents:", error);
    process.exit(1);
  }

  if (!docs?.length) {
    console.log("No documents ingested.");
    return;
  }

  // Get chunk counts per document (paginate to avoid 1000-row default limit)
  const countByDoc = new Map<string, number>();
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data } = await supabase
      .from("document_chunks")
      .select("document_id")
      .range(offset, offset + pageSize - 1);
    if (!data?.length) break;
    for (const row of data) {
      countByDoc.set(row.document_id, (countByDoc.get(row.document_id) ?? 0) + 1);
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  const byRag = { 1: [] as typeof docs, 2: [] as typeof docs } as const;
  for (const d of docs) {
    const idx = d.rag_index as 1 | 2;
    if (idx === 1 || idx === 2) byRag[idx].push(d);
  }

  console.log("=== INGESTED DOCUMENTS ===\n");
  console.log(`Total: ${docs.length} documents\n`);

  for (const rag of [1, 2] as const) {
    const list = byRag[rag];
    if (list.length === 0) continue;
    console.log(`--- RAG Index ${rag} (${rag === 1 ? "Legal framework" : "Case documents"}) ---`);
    for (const d of list) {
      const chunks = countByDoc.get(d.document_id) ?? 0;
      const type = (d.document_type ?? "?").padEnd(16);
      const date = d.date_published ?? "n.d.";
      console.log(`  [${type}] ${d.title}`);
      console.log(`    ${chunks} chunks | ${date} | ${d.document_type === "transcript" ? "TRANSCRIPT" : ""}`);
    }
    console.log("");
  }

  const totalChunks = [...countByDoc.values()].reduce((a, b) => a + b, 0);
  console.log(`Total chunks: ${totalChunks}`);
}

main().catch(console.error);
