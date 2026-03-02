# Cursor Implementation Prompt — Discovery Fix + Data Pipeline Improvements

## Overview

The discovery job in `scripts/ingest.ts` has two critical bugs and one feature request. All three follow the same root cause: the discovery pipeline only does shallow scraping.

**Bug 1: No pagination** — Only page 1 of the case records listing is scraped. Older filings on pages 2+ are never discovered.

**Bug 2: No PDF follow-through** — When a court record page (e.g., `/court-record/icc-01/21-01/25-391`) is discovered, only the HTML wrapper page is ingested. The actual PDF document linked from that page (e.g., `/sites/default/files/CourtRecords/0902ebd180dcf355.pdf`) is never downloaded or ingested. The HTML page has minimal content; the real document content is in the PDF.

**Feature: Allow transcripts** — Transcripts are currently excluded by `EXCLUDED_DOC_TYPES`. They should be allowed. Registry (administrative metadata) and translation (non-English duplicates) remain excluded.

---

## Files to Modify

| File | Change |
|------|--------|
| `scripts/ingest.ts` | Pagination loop, PDF extraction, transcript filter, date extraction, retry logic, heading-aware chunking |
| `lib/icc-urls.ts` | Add `"transcript"` to `DocumentType` union |
| `lib/clean.ts` | Add CLEAN-11 transcript boilerplate, CLEAN-12 whitespace normalization |
| `lib/clients.ts` | Add `createTranscriptSplitter()` |
| `lib/retrieve.ts` | BM25 phrase query, document-type filter, chunk diversity |
| `supabase/schema.sql` | Add `"transcript"` to CHECK constraint, add `document_type` param to retrieval RPCs |

---

## Step 1: Extract markdown link parsing into a helper (ingest.ts)

Refactor the link parsing logic currently inside `discoverNewUrls()` (lines 203–233) into a reusable helper function so it can be called once per page:

```typescript
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
    if (allowed) {
      docs.push({ url, title, detectedType: type });
    } else {
      console.warn(`${logPrefix} discover_unknown_type url=${url}`);
      docs.push({ url, title, detectedType: "unknown" });
    }
  }

  return docs;
}
```

---

## Step 2: Add pagination to `discoverNewUrls()` (ingest.ts)

Replace the current `discoverNewUrls()` function (lines 191–242) with a paginated version:

```typescript
async function discoverNewUrls(): Promise<DiscoveredDoc[]> {
  const logPrefix = "[Docket:Ingest]";
  const allDocs: DiscoveredDoc[] = [];
  const seenUrls = new Set<string>();
  let page = 0;
  const MAX_PAGES = 20; // Safety limit

  while (page < MAX_PAGES) {
    // ICC Drupal uses 0-indexed ?page=N; base URL already has ?f[0]=... so append with &
    const pageUrl = page === 0
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

  // Filter out already-ingested URLs
  const { data: existing } = await supabase.from("icc_documents").select("url");
  const existingUrls = new Set((existing ?? []).map((r) => r.url));
  const newDocs = allDocs.filter((d) => !existingUrls.has(d.url));

  console.log(`${logPrefix} Found ${newDocs.length} new document URLs not in icc_documents`);
  return newDocs;
}
```

**Key points:**
- ICC Drupal pagination is 0-indexed: `?page=0` (same as no param), `?page=1`, `?page=2`, etc.
- The base URL already contains `?f[0]=cr_case_code:1527`, so pagination appends `&page=N`
- Stop conditions: empty page content OR no new document links found on a page
- Safety limit of 20 pages to prevent infinite loops

---

## Step 3: Add PDF extraction from court record pages (ingest.ts)

Add a new function that, given a court record HTML page URL, scrapes that page and extracts the linked PDF URL:

```typescript
async function extractPdfFromCourtRecord(courtRecordUrl: string): Promise<string | null> {
  const logPrefix = "[Docket:Ingest]";

  const scraped = await scrapeUrl(courtRecordUrl);
  const text = scraped.markdown ?? "";

  // Look for PDF links in markdown format: [text](https://...pdf)
  const pdfRegex = /\[([^\]]*)\]\s*\(\s*(https:\/\/www\.icc-cpi\.int\/sites\/default\/files\/[^\s)]+\.pdf)\s*\)/gi;
  const match = pdfRegex.exec(text);

  if (match) {
    console.log(`${logPrefix} found_pdf court_record=${courtRecordUrl} pdf=${match[2]}`);
    return match[2];
  }

  // Fallback: bare PDF URL in text (not wrapped in markdown link)
  const directPdfRegex = /(https:\/\/www\.icc-cpi\.int\/sites\/default\/files\/CourtRecords\/[^\s)"]+\.pdf)/gi;
  const directMatch = directPdfRegex.exec(text);
  if (directMatch) {
    console.log(`${logPrefix} found_pdf_direct court_record=${courtRecordUrl} pdf=${directMatch[1]}`);
    return directMatch[1];
  }

  console.warn(`${logPrefix} no_pdf_found court_record=${courtRecordUrl}`);
  return null;
}
```

---

## Step 4: Update the discovery ingestion loop (ingest.ts)

Modify the ingestion loop (lines 267–280) to extract PDFs from court record pages before ingesting:

```typescript
const logPrefix = "[Docket:Ingest]";
let total = 0;
for (const discovered of newDocs) {
  try {
    let ingestUrl = discovered.url;

    // If this is a court-record HTML page (not already a PDF), extract the actual PDF
    if (/\/court-record\//.test(discovered.url)) {
      const pdfUrl = await extractPdfFromCourtRecord(discovered.url);
      if (pdfUrl) {
        // Check if this PDF URL is already ingested
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
```

**Key behavior:**
- For `/court-record/` URLs: scrape the page → extract PDF link → ingest the PDF
- For direct PDF URLs found on the listing page: ingest directly (no extra scrape needed)
- Dedup check on the PDF URL before ingesting (it may already be in the DB from a previous run or from the hardcoded URL list)
- Falls back to ingesting the HTML page if no PDF is found on the court record page

---

## Step 5: Update document type filters (ingest.ts lines 169-170)

Allow transcripts. Keep registry and translation excluded:

```typescript
// Before:
const ALLOWED_DOC_TYPES = /\b(decision|order|warrant|filing|judgment)\b/i;
const EXCLUDED_DOC_TYPES = /\b(transcript|registry|translation)\b/i;

// After:
const ALLOWED_DOC_TYPES = /\b(decision|order|warrant|filing|judgment|transcript)\b/i;
const EXCLUDED_DOC_TYPES = /\b(registry|translation)\b/i;
```

---

## Step 6: Add `"transcript"` to DocumentType (lib/icc-urls.ts)

Update the type union on line 6:

```typescript
// Before:
export type DocumentType = "case_record" | "press_release" | "legal_text" | "case_info_sheet";

// After:
export type DocumentType = "case_record" | "press_release" | "legal_text" | "case_info_sheet" | "transcript";
```

---

## Step 7: Add transcript-specific chunking (lib/clients.ts)

Transcripts are verbose — 400-token chunks capture too little context. Add a larger splitter:

```typescript
export function createTranscriptSplitter() {
  return new RecursiveCharacterTextSplitter({
    chunkSize: 3200,    // ~800 tokens (transcripts need more context per chunk)
    chunkOverlap: 320,  // ~80 tokens overlap
  });
}
```

Update `ingestOne()` in `scripts/ingest.ts` to use the transcript splitter:

```typescript
// Before:
const splitter = ragIndex === 1 ? createRag1Splitter() : createRag2Splitter();

// After:
import { createTranscriptSplitter } from "../lib/clients";

const splitter = documentType === "transcript"
  ? createTranscriptSplitter()
  : ragIndex === 1 ? createRag1Splitter() : createRag2Splitter();
```

---

## Step 8: Add transcript cleaning rules (lib/clean.ts)

Add CLEAN-11 for transcript-specific boilerplate. Transcripts have procedural noise that hurts retrieval quality:

```typescript
/**
 * CLEAN-11: Strip transcript procedural boilerplate (transcripts only).
 * Removes court officer announcements, timestamp markers, page/line numbers,
 * and procedural parentheticals. Preserves judge and counsel speech.
 */
function clean11StripTranscriptBoilerplate(text: string): string {
  return text
    // Strip procedural speaker labels (not judge/counsel — those have substance)
    .replace(/^(THE COURT OFFICER|COURT OFFICER|THE REGISTRAR|REGISTRAR|THE INTERPRETER|INTERPRETER):?\s*/gim, "")
    // Strip timestamp markers (e.g., "10:32:15")
    .replace(/^\s*\d{1,2}:\d{2}:\d{2}\s*/gm, "")
    // Strip page/line number markers
    .replace(/^\s*Page\s+\d+\s*$/gim, "")
    .replace(/^\s*\d{1,3}\s{2,}/gm, "")
    // Strip procedural parentheticals
    .replace(/\(Interpretation\)/gi, "")
    .replace(/\(Status conference called to order\)/gi, "")
    .replace(/\(The hearing (?:starts|resumes|adjourns) at [\d:]+\)/gi, "")
    .replace(/\((?:Brief|Short) pause\)/gi, "");
}
```

**Integration:** Update `cleanDocumentContent()` to accept an optional `documentType` parameter:

```typescript
// Before:
export function cleanDocumentContent(raw: string, sourceType: SourceType): string {

// After:
export function cleanDocumentContent(raw: string, sourceType: SourceType, documentType?: string): string {
```

At the end of the cleaning pipeline (after existing CLEAN rules), add:

```typescript
if (documentType === "transcript") {
  result = clean11StripTranscriptBoilerplate(result);
}
```

Then update the call in `ingestOne()`:

```typescript
// Before:
const cleaned = cleanDocumentContent(rawText, sourceType);

// After:
const cleaned = cleanDocumentContent(rawText, sourceType, documentType);
```

---

# Part 2: Data Pipeline Improvements

These improvements address quality issues across ingestion, cleaning, chunking, and retrieval that affect answer accuracy regardless of knowledge base size.

---

## Step 9: Fix `date_published` — extract real document date (ingest.ts)

### Problem
`ingest.ts` line 142: `const datePublished = new Date().toISOString().slice(0, 10);`
Every chunk's metadata says the document was published TODAY. Citations show today's date instead of the actual filing date. For a legal case where dates matter enormously, this is wrong.

### Solution
Extract the real date from the scraped content or URL. ICC documents have dates in predictable locations.

Add a date extraction helper in `scripts/ingest.ts`:

```typescript
/**
 * Extract the actual publication date from document content or URL.
 * ICC documents typically have dates in the title, URL path, or first few lines.
 */
function extractDocumentDate(content: string, url: string, scrapedTitle?: string): string {
  // 1. Try URL path date (e.g., /2026-02/DuterteEng.pdf or /2025-07/...)
  const urlDateMatch = url.match(/\/(\d{4}-\d{2})\//);
  if (urlDateMatch) return `${urlDateMatch[1]}-01`;

  // 2. Try common ICC date formats in first 500 chars of content
  const header = (scrapedTitle ?? "") + " " + content.slice(0, 500);

  // "4 July 2025" or "28 February 2026"
  const longDateMatch = header.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  if (longDateMatch) {
    const months: Record<string, string> = {
      january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
      july: "07", august: "08", september: "09", october: "10", november: "11", december: "12"
    };
    const day = longDateMatch[1].padStart(2, "0");
    const month = months[longDateMatch[2].toLowerCase()];
    return `${longDateMatch[3]}-${month}-${day}`;
  }

  // 3. Try ISO-style dates: 2025-09-04
  const isoMatch = header.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  // 4. Fallback: today's date (same as current behavior)
  return new Date().toISOString().slice(0, 10);
}
```

Then update `ingestOne()` to use it:

```typescript
// Before (line 142):
const datePublished = new Date().toISOString().slice(0, 10);

// After:
const datePublished = extractDocumentDate(cleaned, url, scraped.metadata?.title);
```

Also update the `icc_documents` upsert to store the extracted date:

```typescript
// Add to the upsert object:
date_published: datePublished,
```

---

## Step 10: Add CLEAN-12 — whitespace normalization (lib/clean.ts)

### Problem
After all CLEAN rules run, PDFs often have 3-5 consecutive blank lines between sections, plus trailing whitespace on lines. This wastes chunk space and dilutes embedding quality.

### Solution
Add as the FINAL cleaning step (after CLEAN-04):

```typescript
/**
 * CLEAN-12: Normalize whitespace.
 * Collapse 3+ consecutive blank lines to 2. Strip trailing whitespace per line.
 */
function clean12NormalizeWhitespace(text: string): string {
  return text
    // Strip trailing whitespace per line
    .replace(/[ \t]+$/gm, "")
    // Collapse 3+ consecutive blank lines to 2 (preserves paragraph breaks)
    .replace(/\n{4,}/g, "\n\n\n");
}
```

Add it at the end of `cleanDocumentContent()`, after CLEAN-04 (line 249):

```typescript
  // Step 10: CLEAN-04
  text = clean04OcrCorrections(text);

  // Step 11: CLEAN-12 (always, must be last)
  text = clean12NormalizeWhitespace(text);

  return text.trim();
```

---

## Step 11: Add heading context to chunks (ingest.ts)

### Problem
When `RecursiveCharacterTextSplitter` splits a 200-page document, chunk #47 might start mid-paragraph with "The accused further directed..." — zero context about which Count, Article, or section it belongs to. A query about "Count 1" may miss a relevant chunk because the heading "Count 1: Murder as a Crime Against Humanity" was 3 chunks ago.

### Solution
After splitting, prepend the nearest parent heading(s) to each chunk. Add a helper in `scripts/ingest.ts`:

```typescript
/**
 * Extract markdown headings and their positions from document text.
 * Returns array of { level, text, charOffset }.
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
 * Returns a context prefix like "Count 1: Murder > Paragraph 45".
 */
function getHeadingContext(headings: Array<{ level: number; text: string; charOffset: number }>, offset: number): string {
  // Find headings that appear before this offset
  const prior = headings.filter((h) => h.charOffset < offset);
  if (prior.length === 0) return "";

  // Build heading hierarchy: find the last heading at each level
  const context: string[] = [];
  const levels = [1, 2, 3, 4];
  for (const level of levels) {
    const last = prior.filter((h) => h.level === level).pop();
    if (last) context.push(last.text);
  }

  if (context.length === 0) return "";
  return `[Section: ${context.join(" > ")}]\n`;
}
```

Then update the chunking section of `ingestOne()`:

```typescript
// After splitting, prepend heading context to each chunk
const headings = extractHeadings(cleaned);
const enrichedChunks = chunks.map((chunkContent) => {
  // Find approximate position of this chunk in the original text
  const idx = cleaned.indexOf(chunkContent.slice(0, 50));
  if (idx === -1 || headings.length === 0) return chunkContent;
  const prefix = getHeadingContext(headings, idx);
  return prefix + chunkContent;
});
```

Use `enrichedChunks` instead of `chunks` for embedding and storage.

**Important:** Only prepend if the prefix doesn't already duplicate content in the chunk (i.e., the chunk doesn't already start with a heading).

---

## Step 12: Upgrade BM25 to phrase-aware search (lib/retrieve.ts + supabase/schema.sql)

### Problem
`retrieve.ts` line 113 uses `plainto_tsquery('english', query)` which splits "crimes against humanity" into three separate words. A chunk mentioning "crimes" and "humanity" separately (but not as a phrase) would score equally with one containing the exact phrase.

### Solution

Update the `search_document_chunks_fts` RPC in `supabase/schema.sql` to try phrase query first, fall back to plain:

```sql
CREATE OR REPLACE FUNCTION search_document_chunks_fts(
  search_query TEXT,
  match_rag_index SMALLINT DEFAULT NULL,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  metadata JSONB,
  rank REAL
) AS $$
DECLARE
  phrase_tsquery tsquery;
  plain_tsquery tsquery;
BEGIN
  -- Try phrase query first (preserves word order/proximity)
  phrase_tsquery := phraseto_tsquery('english', search_query);
  plain_tsquery := plainto_tsquery('english', search_query);

  RETURN QUERY
  SELECT
    dc.chunk_id,
    dc.document_id,
    dc.content,
    dc.metadata,
    -- Boost phrase matches by 2x over plain keyword matches
    CASE
      WHEN dc.content_tsv @@ phrase_tsquery
        THEN ts_rank(dc.content_tsv, phrase_tsquery) * 2.0
      ELSE ts_rank(dc.content_tsv, plain_tsquery)
    END AS rank
  FROM document_chunks dc
  JOIN icc_documents d ON dc.document_id = d.document_id
  WHERE
    dc.content_tsv @@ plain_tsquery
    AND (match_rag_index IS NULL OR d.rag_index = match_rag_index)
  ORDER BY rank DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
```

This keeps the existing plain-text matching (so all keyword matches still return) but **boosts chunks that contain the exact phrase by 2x** in the BM25 ranking. "Crimes against humanity" as a phrase will rank above chunks that mention "crimes" and "humanity" separately.

---

## Step 13: Add document-type filter to retrieval RPCs (supabase/schema.sql + lib/retrieve.ts)

### Problem
Once transcripts are added, retrieval treats all chunks equally. A query about "what are the charges" could return a verbose transcript chunk where a lawyer mentions charges in passing, instead of the DCC chunk that defines them.

### Solution

**Schema change** — Add optional `match_document_type` param to both RPCs:

Update `match_document_chunks` in `supabase/schema.sql`:

```sql
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(1536),
  match_rag_index SMALLINT DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.68,
  match_count INT DEFAULT 10,
  match_document_type TEXT DEFAULT NULL  -- NEW: optional filter
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.chunk_id,
    dc.document_id,
    dc.content,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  JOIN icc_documents d ON dc.document_id = d.document_id
  WHERE
    (match_rag_index IS NULL OR d.rag_index = match_rag_index)
    AND (match_document_type IS NULL OR d.document_type = match_document_type)
    AND (1 - (dc.embedding <=> query_embedding)) >= match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
```

Update `search_document_chunks_fts` similarly — add `match_document_type TEXT DEFAULT NULL` param and add `AND (match_document_type IS NULL OR d.document_type = match_document_type)` to the WHERE clause.

**Also update the `document_type` CHECK constraint** on `icc_documents`:

```sql
-- Drop and recreate the constraint to include 'transcript'
ALTER TABLE icc_documents DROP CONSTRAINT IF EXISTS icc_documents_document_type_check;
ALTER TABLE icc_documents ADD CONSTRAINT icc_documents_document_type_check
  CHECK (document_type IN ('case_record', 'press_release', 'legal_text', 'case_info_sheet', 'transcript'));
```

**TypeScript side** — Update `vectorSearch()` and `bm25Search()` in `lib/retrieve.ts` to accept and pass the optional `document_type` filter:

```typescript
async function vectorSearch(
  supabase: SupabaseClient,
  embedding: number[],
  ragIndex: 1 | 2 | undefined,
  limit: number,
  threshold: number,
  documentType?: string  // NEW
): Promise<RetrievalChunk[]> {
  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: embedding,
    match_rag_index: ragIndex ?? null,
    match_threshold: threshold,
    match_count: limit,
    match_document_type: documentType ?? null,  // NEW
  });
  // ... rest unchanged
}
```

Do the same for `bm25Search()`. The caller (`retrieve()`) does NOT need to use this filter yet — it's wired through so future retrieval strategies can filter by document type when needed.

---

## Step 14: Add chunk diversity — max 2 chunks per document (lib/retrieve.ts)

### Problem
The top-4 results could all come from the same document. If 4 adjacent chunks from the DCC all mention "murder," they dominate results and crowd out relevant chunks from other documents.

### Solution
Add a diversity enforcement step after RRF merge, before the final `rerank()` call:

```typescript
/**
 * Enforce document diversity: max N chunks per document.
 * Takes more candidates than needed, deduplicates, then returns up to `limit`.
 */
function enforceDocDiversity(chunks: RetrievalChunk[], maxPerDoc: number = 2, limit: number = POST_RERANK_TOP_K): RetrievalChunk[] {
  const docCounts = new Map<string, number>();
  const result: RetrievalChunk[] = [];

  for (const chunk of chunks) {
    const docId = chunk.document_id;
    const count = docCounts.get(docId) ?? 0;
    if (count >= maxPerDoc) continue;
    docCounts.set(docId, count + 1);
    result.push(chunk);
    if (result.length >= limit) break;
  }

  return result;
}
```

Insert it into the `retrieve()` function between RRF merge and rerank:

```typescript
// Before:
const topChunks = rerank(merged);

// After:
const diverseChunks = enforceDocDiversity(merged);
const topChunks = rerank(diverseChunks);
```

This ensures answers draw from at least 2 different source documents when available, giving broader coverage and better citations.

---

## Step 15: Add retry logic for API calls (ingest.ts)

### Problem
If Firecrawl or OpenAI calls fail mid-batch (rate limit, timeout), the entire ingestion fails with no retry. With pagination + PDF extraction making many more API calls, this becomes fragile.

### Solution
Add a generic retry wrapper in `scripts/ingest.ts`:

```typescript
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
      const delay = baseDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
      console.warn(`[Docket:Ingest] ${label} attempt ${attempt}/${maxRetries} failed: ${e}`);
      if (isLast) throw e;
      console.info(`[Docket:Ingest] Retrying ${label} in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}
```

Wrap the two most failure-prone calls:

```typescript
// Scraping
const scraped = await withRetry(() => scrapeUrl(url, config.fullPage), `scrape ${url}`);

// Embedding
const embeddings = await withRetry(() => embedTexts(chunks), `embed ${title}`);
```

---

# Summary of ALL changes after execution

## Part 1: Discovery fixes

| What | Before | After |
|------|--------|-------|
| Case records pages scraped | Page 1 only | All pages (up to 20) |
| Court record documents | HTML wrapper page ingested (minimal content) | Actual PDF ingested (full document text) |
| Transcripts | Excluded by filter | Ingested with 800-token chunking + boilerplate cleaning |
| Registry / Translation | Excluded | Still excluded |
| RAG 2 document count | ~26 docs (6 curated + 20 page-1 HTML wrappers) | All case filings across all pages, as PDFs |

## Part 2: Pipeline improvements

| What | Before | After |
|------|--------|-------|
| `date_published` in metadata | Always today's date | Extracted from document content/URL |
| Whitespace in cleaned text | Multiple blank lines preserved | Collapsed to max 2 blank lines |
| Chunk heading context | None — chunks start mid-paragraph | `[Section: Count 1 > Paragraph 45]` prefix |
| BM25 search | `plainto_tsquery` (splits phrases) | Phrase-aware with 2x boost for exact phrases |
| Document-type filter in retrieval | Not available | Optional `match_document_type` param wired through |
| DB `document_type` CHECK | 4 types only | Includes `"transcript"` |
| Chunk diversity | No limit per document | Max 2 chunks per document in results |
| API call reliability | No retries | 3 retries with exponential backoff |

---

## Testing checklist

### Part 1: Discovery
- [ ] `npx tsx --env-file=.env.local scripts/ingest.ts --discover` reports documents from multiple pages
- [ ] Dry run shows `found_pdf` log lines for court record pages
- [ ] Transcript URLs appear in discovered list (not excluded)
- [ ] Registry and translation URLs are still excluded
- [ ] `--discover --ingest` successfully ingests PDFs (not HTML pages)
- [ ] PDF dedup works — running discovery twice doesn't re-ingest existing PDFs
- [ ] Transcript chunks use 800-token size (verify in Supabase: longer `content` fields)
- [ ] Existing hardcoded PDFs (DCC, Key Messages, Case Info Sheet) are not duplicated

### Part 2: Pipeline improvements
- [ ] Ingested documents have correct `date_published` in metadata (not today's date)
- [ ] Cleaned text has no runs of 4+ blank lines
- [ ] Chunks from documents with headings have `[Section: ...]` prefix
- [ ] BM25 search for "crimes against humanity" ranks exact-phrase chunks higher
- [ ] Retrieval RPCs accept `match_document_type` parameter (test with `NULL` = no filter)
- [ ] DB accepts `document_type = 'transcript'` without constraint violation
- [ ] Top-4 retrieval results come from at least 2 different documents (when available)
- [ ] Firecrawl 429/timeout triggers retry with backoff (test by temporarily setting bad API key)
- [ ] TypeScript compiles cleanly: `npx tsc --noEmit`
