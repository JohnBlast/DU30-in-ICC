#!/usr/bin/env npx tsx
/**
 * Ingestion pipeline: Firecrawl scrape → clean → chunk → embed → Supabase.
 * Usage:
 *   npx tsx --env-file=.env.local scripts/ingest.ts [url]     # Single URL (default: first ICC URL)
 *   npx tsx --env-file=.env.local scripts/ingest.ts --force [url]  # Re-ingest even if doc has chunks
 *   npx tsx --env-file=.env.local scripts/ingest.ts --all    # All curation URLs incl. transcripts
 *   npx tsx --env-file=.env.local scripts/ingest.ts --fix-zero-chunks       # List docs with 0 chunks (dry run)
 *   npx tsx --env-file=.env.local scripts/ingest.ts --fix-zero-chunks --ingest  # Re-ingest all 0-chunk docs
 *   npx tsx --env-file=.env.local scripts/ingest.ts --discover       # Job 2: discover new filings (dry run)
 *   npx tsx --env-file=.env.local scripts/ingest.ts --discover --ingest  # discover + ingest all case filings
 *   npm run ingest:case-filings  # shorthand for discover + ingest
 *   npx tsx --env-file=.env.local scripts/ingest.ts --discover-transcripts       # Find Duterte transcripts (dry run)
 *   npx tsx --env-file=.env.local scripts/ingest.ts --discover-transcripts --ingest  # discover + ingest transcripts
 */

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { Firecrawl } from "@mendable/firecrawl-js";
import { createHash } from "crypto";
import {
  ICC_INGESTION_URLS,
  CASE_RECORDS_DISCOVERY_URL,
  CASE_TRANSCRIPTS_DISCOVERY_URL,
  type IccUrlConfig,
} from "../lib/icc-urls";
import { cleanDocumentContent, type SourceType } from "../lib/clean";
import { validateCleanedContent, allValidationsPass } from "../lib/validate";
import { createRag1Splitter, createRag2Splitter, createTranscriptSplitter } from "../lib/clients";

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

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3,
  baseDelayMs = 2000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isLast = attempt === maxRetries;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[Docket:Ingest] ${label} attempt ${attempt}/${maxRetries} failed: ${e}`);
      if (isLast) throw e;
      console.info(`[Docket:Ingest] Retrying ${label} in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

/** Skip non-English documents (ICC publishes French/Arabic duplicates). */
const NON_ENGLISH_SIGNALS =
  /\b(décision|procureur|chambre|enquête|statut|conformément|préliminaire|présent[ée]|relatif|vertu)\b/i;
function isNonEnglishContent(markdown: string): boolean {
  const sample = markdown.slice(0, 500);
  const matches = sample.match(NON_ENGLISH_SIGNALS);
  return (matches?.length ?? 0) >= 3;
}

async function scrapeUrl(
  url: string,
  fullPage?: boolean
): Promise<{ markdown?: string; metadata?: { title?: string } }> {
  // For PDFs, onlyMainContent can strip content (it's designed for HTML). Use full content.
  const isPdf = url.toLowerCase().endsWith(".pdf");
  const onlyMainContent = isPdf ? false : (fullPage ? false : true);

  return withRetry(
    () =>
      firecrawl.scrape(url, {
        formats: ["markdown"],
        onlyMainContent,
      }).then((doc) => ({ markdown: doc.markdown, metadata: doc.metadata as { title?: string } | undefined })),
    `scrape ${url}`
  );
}

async function embedTexts(texts: string[], title?: string): Promise<number[][]> {
  return withRetry(async () => {
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: texts,
    });
    return res.data
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((d) => d.embedding);
  }, `embed ${title ?? "chunks"}`);
}

/**
 * Extract the actual publication date from document content or URL.
 */
function extractDocumentDate(content: string, url: string, scrapedTitle?: string): string {
  const urlDateMatch = url.match(/\/(\d{4}-\d{2})\//);
  if (urlDateMatch) return `${urlDateMatch[1]}-01`;

  const header = (scrapedTitle ?? "") + " " + content.slice(0, 500);

  const longDateMatch = header.match(
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i
  );
  if (longDateMatch) {
    const months: Record<string, string> = {
      january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
      july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
    };
    const day = longDateMatch[1].padStart(2, "0");
    const month = months[longDateMatch[2].toLowerCase()];
    return `${longDateMatch[3]}-${month}-${day}`;
  }

  const isoMatch = header.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  return new Date().toISOString().slice(0, 10);
}

/**
 * Extract markdown headings and their positions from document text.
 */
function extractHeadings(text: string): Array<{ level: number; text: string; charOffset: number }> {
  const headings: Array<{ level: number; text: string; charOffset: number }> = [];
  const regex = /^(#{1,4})\s+(.+)$/gm;
  let m;
  while ((m = regex.exec(text)) !== null) {
    headings.push({
      level: m[1].length,
      text: m[2].trim(),
      charOffset: m.index,
    });
  }
  return headings;
}

/**
 * Find the nearest parent heading(s) for a given character offset.
 */
function getHeadingContext(
  headings: Array<{ level: number; text: string; charOffset: number }>,
  offset: number
): string {
  const prior = headings.filter((h) => h.charOffset < offset);
  if (prior.length === 0) return "";

  const context: string[] = [];
  const levels = [1, 2, 3, 4];
  for (const level of levels) {
    const last = prior.filter((h) => h.level === level).pop();
    if (last) context.push(last.text);
  }

  if (context.length === 0) return "";
  return `[Section: ${context.join(" > ")}]\n`;
}

// --- Pipeline ---
async function ingestOne(config: IccUrlConfig, skipDedup = false): Promise<{ chunks: number; skipped?: boolean }> {
  let { url, title, ragIndex, documentType } = config;

  // Court-record pages (e.g. transcripts) link to PDFs; resolve to PDF for actual content
  if (/\/court-record\//.test(url)) {
    const pdfUrl = await extractPdfFromCourtRecord(url);
    if (pdfUrl) {
      url = pdfUrl;
    }
  }

  // Skip re-scraping if already fully ingested (has chunks)
  if (!skipDedup) {
    const { data: existingDoc } = await supabase
      .from("icc_documents")
      .select("document_id")
      .eq("url", url)
      .single();
    if (existingDoc) {
      const { count } = await supabase
        .from("document_chunks")
        .select("chunk_id", { count: "exact", head: true })
        .eq("document_id", existingDoc.document_id);
      if ((count ?? 0) > 0) {
        console.info(`[Docket:Ingest] skip_already_ingested url=${url} chunks=${count}`);
        return { chunks: 0, skipped: true };
      }
    }
  }

  const sourceType: SourceType = isPdfUrl(url) ? "pdf" : "html";

  console.log(`Scraping: ${title} (${url})${config.fullPage ? " [full page]" : ""}`);
  const scraped = await scrapeUrl(url, config.fullPage);
  const rawText = scraped.markdown ?? scraped.metadata?.title ?? "";

  if (isNonEnglishContent(rawText)) {
    console.info(`[Docket:Ingest] skip_non_english url=${url} title=${title}`);
    return { chunks: 0 };
  }

  if (!rawText || rawText.trim().length < 100) {
    throw new Error(`Firecrawl returned empty or too short content for ${url}`);
  }

  const cleaned = cleanDocumentContent(rawText, sourceType, documentType);
  const validations = validateCleanedContent(cleaned);
  const logPrefix = "[Docket:Ingest]";
  if (!allValidationsPass(validations)) {
    const failed = validations.filter((v) => !v.passed);
    console.warn(`${logPrefix} validation_failures url=${url} failed=${failed.map((v) => v.id).join(",")}`);
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

  const splitter =
    documentType === "transcript"
      ? createTranscriptSplitter()
      : ragIndex === 1
        ? createRag1Splitter()
        : createRag2Splitter();
  let chunks = await splitter.splitText(cleaned);

  if (chunks.length === 0) {
    console.warn(`${logPrefix} zero_chunks url=${url}`);
    return { chunks: 0 };
  }

  const headings = extractHeadings(cleaned);
  if (headings.length > 0) {
    chunks = chunks.map((chunkContent) => {
      const idx = cleaned.indexOf(chunkContent.slice(0, 50));
      if (idx === -1) return chunkContent;
      const prefix = getHeadingContext(headings, idx);
      return prefix + chunkContent;
    });
  }

  const embeddings = await embedTexts(chunks, title);

  const datePublished = extractDocumentDate(cleaned, url, scraped.metadata?.title);

  const { data: docRow, error: docErr } = await supabase
    .from("icc_documents")
    .upsert(
      {
        title,
        url,
        document_type: documentType,
        rag_index: ragIndex,
        content_hash: hash,
        date_published: datePublished,
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

  await supabase.from("document_chunks").delete().eq("document_id", documentId);

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

const ALLOWED_DOC_TYPES = /\b(decision|order|warrant|filing|judgment|transcript)\b/i;
const EXCLUDED_DOC_TYPES = /\b(registry|translation)\b/i;

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

function extractTranscriptLinks(text: string, seenUrls: Set<string>): DiscoveredDoc[] {
  const logPrefix = "[Docket:Ingest]";
  const markdownLinkRegex = /\[([^\]]*)\]\s*\(\s*(https:\/\/www\.icc-cpi\.int\/court-record\/[^\s)]+)\s*\)/g;
  const docs: DiscoveredDoc[] = [];
  let m;
  while ((m = markdownLinkRegex.exec(text)) !== null) {
    const url = m[2].replace(/&amp;/g, "&");
    if (!/icc-01\/21/i.test(url)) continue; // Duterte case only
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    const linkText = m[1].trim();
    docs.push({ url, title: linkText || "Transcript", detectedType: "transcript" });
  }
  return docs;
}

function extractDocsFromMarkdown(text: string, seenUrls: Set<string>): DiscoveredDoc[] {
  const logPrefix = "[Docket:Ingest]";
  const markdownLinkRegex = /\[([^\]]*)\]\s*\(\s*(https:\/\/www\.icc-cpi\.int\/[^\s)]+)\s*\)/g;
  const docs: DiscoveredDoc[] = [];

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
    // Skip obvious French-language documents
    if (/^(Décision|Demande|Ordonnance|Chambre|Requête)\b/.test(title)) {
      continue;
    }
    if (allowed) {
      docs.push({ url, title, detectedType: type });
    } else {
      console.warn(`${logPrefix} discover_unknown_type url=${url}`);
      docs.push({ url, title, detectedType: "unknown" });
    }
  }

  return docs;
}

async function extractPdfFromCourtRecord(courtRecordUrl: string): Promise<string | null> {
  const logPrefix = "[Docket:Ingest]";

  const scraped = await scrapeUrl(courtRecordUrl);
  const text = scraped.markdown ?? "";

  const pdfRegex = /\[([^\]]*)\]\s*\(\s*(https:\/\/www\.icc-cpi\.int\/sites\/default\/files\/[^\s)]+\.pdf)\s*\)/gi;
  const match = pdfRegex.exec(text);

  if (match) {
    console.log(`${logPrefix} found_pdf court_record=${courtRecordUrl} pdf=${match[2]}`);
    return match[2];
  }

  const directPdfRegex = /(https:\/\/www\.icc-cpi\.int\/sites\/default\/files\/CourtRecords\/[^\s)"]+\.pdf)/gi;
  const directMatch = directPdfRegex.exec(text);
  if (directMatch) {
    console.log(`${logPrefix} found_pdf_direct court_record=${courtRecordUrl} pdf=${directMatch[1]}`);
    return directMatch[1];
  }

  console.warn(`${logPrefix} no_pdf_found court_record=${courtRecordUrl}`);
  return null;
}

async function discoverNewUrls(): Promise<DiscoveredDoc[]> {
  const logPrefix = "[Docket:Ingest]";
  const allDocs: DiscoveredDoc[] = [];
  const seenUrls = new Set<string>();
  let page = 0;
  const MAX_PAGES = 20;

  while (page < MAX_PAGES) {
    const pageUrl =
      page === 0
        ? CASE_RECORDS_DISCOVERY_URL
        : `${CASE_RECORDS_DISCOVERY_URL}&page=${page}`;

    console.log(`${logPrefix} Discovering filings — page ${page} (${pageUrl})`);
    const scraped = await scrapeUrl(pageUrl);
    const text = scraped.markdown ?? "";

    if (!text || text.trim().length < 100) {
      console.log(`${logPrefix} Page ${page} returned no content — stopping pagination.`);
      break;
    }

    const pageDocs = extractDocsFromMarkdown(text, seenUrls);
    if (pageDocs.length === 0) {
      console.log(`${logPrefix} Page ${page} yielded no new document links — stopping pagination.`);
      break;
    }

    console.log(`${logPrefix} Page ${page}: found ${pageDocs.length} document links`);
    allDocs.push(...pageDocs);
    page++;
  }

  console.log(`${logPrefix} Discovered ${allDocs.length} total document URLs across ${page + 1} pages.`);

  const { data: existing } = await supabase.from("icc_documents").select("url");
  const existingUrls = new Set((existing ?? []).map((r) => r.url));
  const newDocs = allDocs.filter((d) => !existingUrls.has(d.url));

  console.log(`${logPrefix} Found ${newDocs.length} new document URLs not in icc_documents`);
  return newDocs;
}

// --- CLI ---
async function main() {
  const args = process.argv.slice(2);
  const isAll = args.includes("--all");
  const isDiscover = args.includes("--discover");
  const isDiscoverTranscripts = args.includes("--discover-transcripts");
  const isFixZeroChunks = args.includes("--fix-zero-chunks");

  if (isFixZeroChunks) {
    const logPrefix = "[Docket:Ingest]";
    const { data: docs } = await supabase
      .from("icc_documents")
      .select("document_id, url, title, document_type, rag_index");
    if (!docs?.length) {
      console.log("No documents in database.");
      return;
    }
    const zeroChunkDocs: { document_id: string; url: string; title: string; document_type: string; rag_index: number }[] = [];
    for (const d of docs) {
      const { count } = await supabase
        .from("document_chunks")
        .select("chunk_id", { count: "exact", head: true })
        .eq("document_id", d.document_id);
      if ((count ?? 0) === 0) {
        zeroChunkDocs.push(d);
      }
    }
    if (zeroChunkDocs.length === 0) {
      console.log("No documents with 0 chunks.");
      return;
    }
    console.log(`${logPrefix} Found ${zeroChunkDocs.length} documents with 0 chunks`);
    if (!args.includes("--ingest")) {
      zeroChunkDocs.forEach((d) => console.log(`  - ${d.title} (${d.url})`));
      console.log(`\nRun with --fix-zero-chunks --ingest to re-ingest these.`);
      return;
    }
    let total = 0;
    for (const d of zeroChunkDocs) {
      try {
        const config: IccUrlConfig = {
          url: d.url,
          title: d.title,
          ragIndex: d.rag_index as 1 | 2,
          documentType: (d.document_type as IccUrlConfig["documentType"]) ?? "case_record",
        };
        const { chunks } = await ingestOne(config, true);
        total += chunks;
      } catch (e) {
        console.error(`${logPrefix} Failed ${d.url}:`, e);
      }
    }
    console.log(`${logPrefix} Re-ingested ${total} chunks from ${zeroChunkDocs.length} documents.`);
    return;
  }

  if (isDiscoverTranscripts) {
    const logPrefix = "[Docket:Ingest]";
    console.log(`${logPrefix} Discovering transcripts from ${CASE_TRANSCRIPTS_DISCOVERY_URL}`);
    const scraped = await scrapeUrl(CASE_TRANSCRIPTS_DISCOVERY_URL);
    const text = scraped.markdown ?? "";
    const seenUrls = new Set<string>();
    const transcripts = extractTranscriptLinks(text, seenUrls);
    if (transcripts.length === 0) {
      console.log("No Duterte transcripts found.");
      return;
    }
    transcripts.forEach((t) => console.log("  TRANSCRIPT:", t.url, "—", t.title));
    const { data: existing } = await supabase.from("icc_documents").select("url");
    const existingSet = new Set((existing ?? []).map((r) => r.url));
    const newTranscripts = transcripts.filter((t) => !existingSet.has(t.url));
    if (newTranscripts.length === 0) {
      console.log("All transcripts already ingested.");
      return;
    }
    if (!args.includes("--ingest")) {
      console.log(`\nRun with --discover-transcripts --ingest to ingest ${newTranscripts.length} new transcript(s).`);
      return;
    }
    let total = 0;
    for (const t of newTranscripts) {
      try {
        const config: IccUrlConfig = { url: t.url, title: t.title, ragIndex: 2, documentType: "transcript" };
        const { chunks } = await ingestOne(config);
        total += chunks;
      } catch (e) {
        console.error(`${logPrefix} Failed ${t.url}:`, e);
      }
    }
    console.log(`${logPrefix} Transcript ingestion complete: ${total} chunks from ${newTranscripts.length} transcript(s).`);
    return;
  }

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
        let ingestUrl = discovered.url;

        if (/\/court-record\//.test(discovered.url)) {
          const pdfUrl = await extractPdfFromCourtRecord(discovered.url);
          if (pdfUrl) {
            const { data: existingPdf } = await supabase
              .from("icc_documents")
              .select("document_id")
              .eq("url", pdfUrl)
              .single();

            if (existingPdf) {
              console.info(`${logPrefix} skip_pdf_exists url=${pdfUrl}`);
              continue;
            }

            ingestUrl = pdfUrl;
          }
        }

        const config: IccUrlConfig = {
          url: ingestUrl,
          title: discovered.title,
          ragIndex: 2,
          documentType: discovered.detectedType === "transcript" ? "transcript" : "case_record",
        };
        const { chunks } = await ingestOne(config);
        total += chunks;
      } catch (e) {
        console.error(`${logPrefix} Failed to ingest ${discovered.url}:`, e);
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
