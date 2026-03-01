# Cursor Prompt: Job 2 — Case Records Discovery with Document Type Filter

> **Copy this entire prompt into Cursor when implementing the discovery job refinement.**

---

## Context

You are completing Task 3.19 in `TASKS.md` for The Docket — a RAG Q&A app about the Duterte ICC case. The ingestion pipeline (`scripts/ingest.ts`) already has a `--discover` mode that scrapes the ICC case records page, extracts document URLs, and lists new ones. But it currently:

1. Does **not** filter by document type — it would ingest transcripts, registry filings, translations, and administrative documents that pollute RAG retrieval
2. Does **not** actually ingest the discovered URLs — it only prints them

You need to add document type filtering and auto-ingestion to the discovery job.

## Files to Read First

1. `scripts/ingest.ts` — current ingestion pipeline (lines 168-199: `discoverNewUrls()` and `--discover` CLI handler)
2. `lib/icc-urls.ts` — URL configs and types
3. `prd.md` — search for "Job 2 document type filter" (§12.1) and "Case records — filtered filings" (§15.1)
4. `data-quality.md` — cleaning rules applied to ingested content

## What to Build

### Step 1: Understand the ICC case records page structure

The case records page at `https://www.icc-cpi.int/case-records?f%5B0%5D=cr_case_code%3A1527` is a paginated listing. Each entry has:
- A document title (e.g., "Decision on the confirmation of charges")
- A document type label (e.g., "Decision", "Order", "Warrant of Arrest", "Filing", "Transcript", "Registry")
- A link to the PDF or court record page

When Firecrawl scrapes this page as markdown, document type labels appear as text near each link. Use these labels to filter.

### Step 2: Add document type filtering to `discoverNewUrls()`

**Allowed document types (case-insensitive match):**
- Decision
- Order
- Warrant (includes "Warrant of Arrest")
- Filing
- Judgment

**Excluded document types:**
- Transcript
- Registry
- Translation
- Any other type not in the allowed list

**Implementation approach:**

In `scripts/ingest.ts`, modify `discoverNewUrls()` to:

1. After extracting all document links from the scraped markdown, look at the surrounding text context (within ~200 characters before each link) for document type labels
2. Only include links whose nearby text contains an allowed document type keyword
3. If a link has no detectable type label nearby, **include it** (safer to over-include than miss a new Decision) but log a warning: `[Docket:Ingest] discover_unknown_type url=...`

```typescript
const ALLOWED_DOC_TYPES = /\b(decision|order|warrant|filing|judgment)\b/i;
const EXCLUDED_DOC_TYPES = /\b(transcript|registry|translation)\b/i;
```

For each extracted link, check the ~200 characters of markdown text preceding it:
- If `EXCLUDED_DOC_TYPES` matches → skip, log: `[Docket:Ingest] discover_skip_excluded type=Transcript url=...`
- If `ALLOWED_DOC_TYPES` matches → include
- If neither matches → include with warning (unknown type)

### Step 3: Add `--discover --ingest` mode

Currently `--discover` only lists URLs. Add an `--ingest` flag that actually ingests the discovered URLs:

```typescript
// In main():
if (isDiscover) {
  const newUrls = await discoverNewUrls();
  if (newUrls.length === 0) {
    console.log("No new filings discovered.");
    return;
  }

  newUrls.forEach((u) => console.log("  NEW:", u.url, `[${u.detectedType}]`));

  const shouldIngest = args.includes("--ingest");
  if (!shouldIngest) {
    console.log(`\nRun with --discover --ingest to ingest these ${newUrls.length} URLs.`);
    return;
  }

  // Ingest each discovered URL
  let total = 0;
  for (const discovered of newUrls) {
    try {
      const config: IccUrlConfig = {
        url: discovered.url,
        title: discovered.title || "Court Record",
        ragIndex: 2,
        documentType: "case_record",
      };
      const { chunks } = await ingestOne(config);
      total += chunks;
    } catch (e) {
      console.error(`Failed to ingest ${discovered.url}:`, e);
    }
  }
  console.log(`Discovery ingestion complete: ${total} chunks from ${newUrls.length} new documents.`);
  return;
}
```

### Step 4: Update `discoverNewUrls()` return type

Change the return type from `string[]` to a structured type:

```typescript
interface DiscoveredDoc {
  url: string;
  title: string;          // extracted from nearby text or link text
  detectedType: string;   // "Decision", "Order", "unknown", etc.
}

async function discoverNewUrls(): Promise<DiscoveredDoc[]> {
  // ... existing scrape logic ...
  // Return structured objects instead of plain strings
}
```

### Step 5: Handle pagination

The case records page may have multiple pages. Check if the scraped markdown contains a "next page" or pagination link (e.g., `?page=1`). If it does:
- Scrape subsequent pages until no more pagination links are found
- Cap at 10 pages maximum to prevent runaway scraping
- Log: `[Docket:Ingest] discover_page page=2 links_found=15`

If pagination handling is too complex for the initial implementation, add a `TODO` comment and log a warning when pagination links are detected:
```
[Docket:Ingest] discover_pagination_detected — only page 1 scraped. Manual review needed.
```

### Step 6: Update `lib/icc-urls.ts`

Rename the discovery page title from "Case records — all filings" to "Case records — filtered filings" on line 73:

```typescript
{
  url: "https://www.icc-cpi.int/case-records?f%5B0%5D=cr_case_code%3A1527",
  title: "Case records — filtered filings",
  ragIndex: 2,
  documentType: "case_record",
  isDiscoveryPage: true,
},
```

## Constraints

- Do NOT change `ingestOne()` — it already handles the full pipeline correctly
- Do NOT change `IccUrlConfig` interface — discovered URLs are adapted to it before passing to `ingestOne()`
- All discovered documents go to RAG index 2 (case documents) with `documentType: "case_record"`
- Log all discovery actions with `[Docket:Ingest]` prefix
- Keep `--discover` (dry run) and `--discover --ingest` (actual ingestion) as separate modes
- Content hash deduplication in `ingestOne()` already prevents re-ingestion of unchanged documents

## Testing

After implementation, verify:

1. `npx tsx --env-file=.env.local scripts/ingest.ts --discover` → lists only Decision/Order/Warrant/Filing/Judgment URLs, skips Transcripts
2. Any transcript URLs in the output should be absent
3. Unknown-type URLs logged with warning
4. `--discover --ingest` ingests the discovered documents through the existing pipeline

## Usage (for reference)

```bash
# Dry run — see what would be ingested
npx tsx --env-file=.env.local scripts/ingest.ts --discover

# Actually ingest discovered documents
npx tsx --env-file=.env.local scripts/ingest.ts --discover --ingest

# Full pipeline (Job 1 + Job 2)
npx tsx --env-file=.env.local scripts/ingest.ts --all && npx tsx --env-file=.env.local scripts/ingest.ts --discover --ingest
```
