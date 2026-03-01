#!/usr/bin/env npx tsx
/**
 * Ingestion pipeline: Firecrawl scrape → clean → chunk → embed → Supabase.
 * Usage:
 *   npx tsx --env-file=.env.local scripts/ingest.ts [url]     # Single URL (default: first ICC URL)
 *   npx tsx --env-file=.env.local scripts/ingest.ts --all    # All 12 ingestion URLs
 *   npx tsx --env-file=.env.local scripts/ingest.ts --discover       # Job 2: discover new filings (dry run)
 *   npx tsx --env-file=.env.local scripts/ingest.ts --discover --ingest  # discover + ingest
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { Firecrawl } from "@mendable/firecrawl-js";
import { createHash } from "crypto";
import {
  ICC_INGESTION_URLS,
  CASE_RECORDS_DISCOVERY_URL,
  type IccUrlConfig,
} from "../lib/icc-urls";
import { cleanDocumentContent, type SourceType } from "../lib/clean";
import { validateCleanedContent, allValidationsPass } from "../lib/validate";
import { createRag1Splitter, createRag2Splitter } from "../lib/clients";

// --- Env ---
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !OPENAI_API_KEY || !FIRECRAWL_API_KEY) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, FIRECRAWL_API_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const firecrawl = new Firecrawl({ apiKey: FIRECRAWL_API_KEY });

// --- Helpers ---
function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function isPdfUrl(url: string): boolean {
  return url.toLowerCase().endsWith(".pdf");
}

async function scrapeUrl(
  url: string,
  fullPage?: boolean
): Promise<{ markdown?: string; metadata?: { title?: string } }> {
  const doc = await firecrawl.scrape(url, {
    formats: ["markdown"],
    onlyMainContent: fullPage ? false : true,
  });
  return { markdown: doc.markdown, metadata: doc.metadata as { title?: string } | undefined };
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  return res.data
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding);
}

// --- Pipeline ---
async function ingestOne(config: IccUrlConfig, skipDedup = false): Promise<{ chunks: number; skipped?: boolean }> {
  const { url, title, ragIndex, documentType } = config;
  const sourceType: SourceType = isPdfUrl(url) ? "pdf" : "html";

  console.log(`Scraping: ${title} (${url})${config.fullPage ? " [full page]" : ""}`);
  const scraped = await scrapeUrl(url, config.fullPage);
  const rawText = scraped.markdown ?? scraped.metadata?.title ?? "";

  if (!rawText || rawText.trim().length < 100) {
    throw new Error(`Firecrawl returned empty or too short content for ${url}`);
  }

  const cleaned = cleanDocumentContent(rawText, sourceType);
  const validations = validateCleanedContent(cleaned);
  const logPrefix = "[Docket:Ingest]";
  if (!allValidationsPass(validations)) {
    const failed = validations.filter((v) => !v.passed);
    console.warn(`${logPrefix} validation_failures url=${url} failed=${failed.map((v) => v.id).join(",")}`);
    // Continue but log
  }

  const hash = contentHash(cleaned);

  if (!skipDedup) {
    const { data: existing } = await supabase
      .from("icc_documents")
      .select("document_id")
      .eq("url", url)
      .eq("content_hash", hash)
      .single();

    if (existing) {
      console.info(`${logPrefix} skipped content_unchanged url=${url} title=${title}`);
      return { chunks: 0, skipped: true };
    }
  }

  const splitter = ragIndex === 1 ? createRag1Splitter() : createRag2Splitter();
  const chunks = await splitter.splitText(cleaned);

  if (chunks.length === 0) {
    console.warn(`${logPrefix} zero_chunks url=${url}`);
    return { chunks: 0 };
  }

  const embeddings = await embedTexts(chunks);

  const { data: docRow, error: docErr } = await supabase
    .from("icc_documents")
    .upsert(
      {
        title,
        url,
        document_type: documentType,
        rag_index: ragIndex,
        content_hash: hash,
        last_crawled_at: new Date().toISOString(),
      },
      { onConflict: "url" }
    )
    .select("document_id")
    .single();

  if (docErr || !docRow) {
    throw new Error(`Failed to upsert icc_documents: ${docErr?.message ?? "unknown"}`);
  }

  const documentId = docRow.document_id;

  // Delete old chunks for this document before inserting new ones
  await supabase.from("document_chunks").delete().eq("document_id", documentId);

  const datePublished = new Date().toISOString().slice(0, 10);
  const metadata = {
    document_title: title,
    url,
    date_published: datePublished,
    rag_index: String(ragIndex),
    document_type: documentType,
  };

  const rows = chunks.map((content, i) => ({
    document_id: documentId,
    content,
    embedding: embeddings[i],
    chunk_index: i,
    token_count: Math.ceil(content.length / 4),
    metadata,
  }));

  const { error: chunksErr } = await supabase.from("document_chunks").insert(rows);
  if (chunksErr) {
    throw new Error(`Failed to insert chunks: ${chunksErr.message}`);
  }

  console.info(`${logPrefix} doc=${title} chunks=${chunks.length}`);
  return { chunks: chunks.length };
}

const ALLOWED_DOC_TYPES = /\b(decision|order|warrant|filing|judgment)\b/i;
const EXCLUDED_DOC_TYPES = /\b(transcript|registry|translation)\b/i;

const CONTEXT_CHARS = 200;

export interface DiscoveredDoc {
  url: string;
  title: string;
  detectedType: string;
}

function detectDocType(context: string): { type: string; excluded: boolean; allowed: boolean } {
  const c = context.toLowerCase();
  const excludedMatch = c.match(EXCLUDED_DOC_TYPES);
  if (excludedMatch) return { type: excludedMatch[0], excluded: true, allowed: false };

  const allowedMatch = c.match(ALLOWED_DOC_TYPES);
  if (allowedMatch) return { type: allowedMatch[0], excluded: false, allowed: true };

  return { type: "unknown", excluded: false, allowed: false };
}

async function discoverNewUrls(): Promise<DiscoveredDoc[]> {
  const logPrefix = "[Docket:Ingest]";
  console.log("Discovering new filings from case records page...");

  const scraped = await scrapeUrl(CASE_RECORDS_DISCOVERY_URL);
  const text = scraped.markdown ?? "";

  // Check for pagination (TODO: full pagination support)
  if (/\bpage=\d+|next\s+page|pagination\b/i.test(text)) {
    console.warn(`${logPrefix} discover_pagination_detected — only page 1 scraped. Manual review needed.`);
  }

  // Extract [link text](url) pairs — link text often contains document type
  const markdownLinkRegex = /\[([^\]]*)\]\s*\(\s*(https:\/\/www\.icc-cpi\.int\/[^\s)]+)\s*\)/g;
  const docs: DiscoveredDoc[] = [];
  const seenUrls = new Set<string>();

  let m;
  while ((m = markdownLinkRegex.exec(text)) !== null) {
    const linkText = m[1].trim();
    const url = m[2].replace(/&amp;/g, "&");

    if (!/\/court-record\//.test(url) && !/\/sites\/default\/files\/.*\.pdf/i.test(url)) continue;
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    const start = Math.max(0, m.index - CONTEXT_CHARS);
    const context = text.slice(start, m.index + m[0].length);

    const { type, excluded, allowed } = detectDocType(context);

    if (excluded) {
      console.info(`${logPrefix} discover_skip_excluded type=${type} url=${url}`);
      continue;
    }

    const title = linkText || "Court Record";
    if (allowed) {
      docs.push({ url, title, detectedType: type });
    } else {
      console.warn(`${logPrefix} discover_unknown_type url=${url}`);
      docs.push({ url, title, detectedType: "unknown" });
    }
  }

  const { data: existing } = await supabase.from("icc_documents").select("url");
  const existingUrls = new Set((existing ?? []).map((r) => r.url));
  const newDocs = docs.filter((d) => !existingUrls.has(d.url));

  console.log(`Found ${newDocs.length} new document URLs not in icc_documents`);
  return newDocs;
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);
  const isAll = args.includes("--all");
  const isDiscover = args.includes("--discover");

  if (isDiscover) {
    const newDocs = await discoverNewUrls();
    if (newDocs.length === 0) {
      console.log("No new filings discovered.");
      return;
    }

    newDocs.forEach((d) => console.log("  NEW:", d.url, `[${d.detectedType}]`));

    const shouldIngest = args.includes("--ingest");
    if (!shouldIngest) {
      console.log(`\nRun with --discover --ingest to ingest these ${newDocs.length} URLs.`);
      return;
    }

    const logPrefix = "[Docket:Ingest]";
    let total = 0;
    for (const discovered of newDocs) {
      try {
        const config: IccUrlConfig = {
          url: discovered.url,
          title: discovered.title,
          ragIndex: 2,
          documentType: "case_record",
        };
        const { chunks } = await ingestOne(config);
        total += chunks;
      } catch (e) {
        console.error(`Failed to ingest ${discovered.url}:`, e);
      }
    }
    console.log(`${logPrefix} Discovery ingestion complete: ${total} chunks from ${newDocs.length} new documents.`);
    return;
  }

  if (isAll) {
    let total = 0;
    for (const config of ICC_INGESTION_URLS) {
      try {
        const { chunks } = await ingestOne(config);
        total += chunks;
      } catch (e) {
        console.error(`Failed ${config.title}:`, e);
      }
    }
    console.log(`Total chunks ingested: ${total}`);
    return;
  }

  const force = args.includes("--force");
  const urlArg = args.find((a) => !a.startsWith("--"));
  const config = urlArg
    ? ICC_INGESTION_URLS.find((c) => c.url === urlArg) ?? {
        url: urlArg,
        title: new URL(urlArg).pathname.split("/").pop() ?? "Unknown",
        ragIndex: 2 as const,
        documentType: "case_record" as const,
      }
    : ICC_INGESTION_URLS[0];

  const result = await ingestOne(config, force);
  console.log("Result:", result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
