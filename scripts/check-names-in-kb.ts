#!/usr/bin/env npx tsx
/**
 * Diagnostic: Check if co-perpetrator names exist in ingested chunks.
 * Usage: npm run check-names-in-kb
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, key);

async function main() {
  const terms = ["Dela Rosa", "Danao", "Cascolan", "Albayalde", "Bong GO", "LAPEÑA", "Lapena", "AGUIRRE", "Aguirre"];
  console.log("=== Checking if co-perpetrator names exist in KB ===\n");

  for (const term of terms) {
    const { data, error } = await supabase
      .from("document_chunks")
      .select("chunk_id, content, metadata")
      .ilike("content", `%${term}%`)
      .limit(1);

    if (error) {
      console.log(`${term}: Error - ${error.message}`);
      continue;
    }
    const found = data && data.length > 0;
    console.log(`${term}: ${found ? "FOUND" : "not found"}`);
    if (found && data[0]) {
      const excerpt = data[0].content
        .replace(new RegExp(term.replace(/\s/g, "\\s*"), "gi"), (m) => `>>>${m}<<<`)
        .slice(0, 400);
      console.log(`  Doc: ${(data[0].metadata as { document_title?: string })?.document_title}`);
      console.log(`  Excerpt: ${excerpt}...`);
    }
  }
}

main().catch(console.error);
