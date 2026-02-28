# DU30 in ICC — Data Quality Contract

> **What this is:** Rules for cleaning, normalizing, and validating ICC documents after Firecrawl scrape and before chunking. Every rule is derived from observed patterns in real Firecrawl output tested against ICC URLs.
> **Traceability:** PRD Section 12 (Ingestion Pipeline), Section 13 (Data Quality Rules), Section 15.1 (Indexing Contract), Constitution Principles 2, 3.

---

## 1. Observed Data Quality Patterns

All patterns below were identified by scraping 3 representative ICC URLs with Firecrawl scrape-mode:

- **HTML page:** `https://www.icc-cpi.int/philippines/duterte` (Duterte case overview)
- **Short PDF:** `https://www.icc-cpi.int/sites/default/files/2026-02/DuterteEng.pdf` (Case Information Sheet)
- **Long PDF:** `https://www.icc-cpi.int/sites/default/files/CourtRecords/0902ebd180c9bfd4.pdf` (Document Containing the Charges, ~160 pages)

### 1.1 Pattern Summary

| ID    | Pattern                         | Severity | Source Types  | Example                                                    |
| ----- | ------------------------------- | -------- | ------------- | ---------------------------------------------------------- |
| DQ-01 | HTML boilerplate contamination  | High     | HTML          | Navigation bars, footer links, social media icons, cookie banners — ~70% of scraped HTML is non-content |
| DQ-02 | UTF-8 encoding corruption       | High     | PDF (download)| `Adélaïde` → `AdÃ©laÃ¯de`; smart quotes → `â€œ` / `â€™`   |
| DQ-03 | LaTeX math artifacts            | High     | PDF (long)    | `$6 0 %` instead of `60%`; `$^ { 1 3 0 } \mathrm { H e }` instead of `¹³⁰He` |
| DQ-04 | OCR errors                      | Medium   | PDF (short)   | `('MMm.` instead of `('DDS')` — acronym garbled            |
| DQ-05 | Table extraction failure        | Medium   | PDF (short)   | Structured tables rendered as flat text; columns jumbled    |
| DQ-06 | Footnote superscripts inline    | Medium   | PDF (long)    | Superscript numbers merged with body text: `victims.12 The` |
| DQ-07 | REDACTED marker escaping        | Low      | PDF (long)    | `\[REDACTED\]` (escaped) vs `[REDACTED]` (raw) — inconsistent |
| DQ-08 | Checkbox / form artifacts       | Low      | PDF (short)   | `☒` and `☐` characters from form checkboxes                |
| DQ-09 | Image reference artifacts       | Low      | HTML, PDF     | `![image description](url)` markdown for images, copyright lines |
| DQ-10 | Copyright / boilerplate headers | Low      | PDF (both)    | ICC copyright notices, page headers/footers repeated per page |

---

## 2. Cleaning Rules

Rules are applied **after Firecrawl output and before Unstructured.io parsing** (or as post-processing if Unstructured.io does not resolve the issue). Each rule has a unique ID for traceability.

### 2.1 High Severity — Must Fix Before Chunking

#### CLEAN-01: Strip HTML Boilerplate

**Applies to:** HTML pages only
**Problem:** Firecrawl returns full-page markdown including navigation, footer, social icons, cookie consent, and site-wide links. ~70% of HTML output is non-content.
**Rule:** Strip all content before the first `<main>` or `<article>` tag equivalent and after the last content section. Specifically remove:
- Navigation menus and breadcrumbs
- Footer content (contact info, social links, site map)
- Cookie/consent banners
- "Share this page" / social media widgets
- Sidebar promotional content
- "Related cases" and cross-links to non-Duterte ICC content

**Validation:** After stripping, the remaining text must contain only substantive ICC case/legal content. If stripping removes >95% of the page, flag for manual review — the page structure may have changed.

**Implementation note:** Use Unstructured.io's HTML partitioning to extract content elements only. If Firecrawl returns markdown (not raw HTML), apply regex-based stripping of common ICC site boilerplate patterns.

---

#### CLEAN-02: Fix UTF-8 Encoding Corruption (Mojibake)

**Applies to:** PDF documents (particularly when saved/downloaded as .md files)
**Problem:** Multi-byte UTF-8 characters are double-encoded, producing mojibake. This corrupts proper nouns (judge/prosecutor names), legal terms, and any accented characters.

**Known corruption patterns:**

| Corrupted             | Correct           | Context                  |
| --------------------- | ----------------- | ------------------------ |
| `AdÃ©laÃ¯de`         | `Adélaïde`        | Judge name               |
| `RodrÃ­guez`         | `Rodríguez`       | Prosecutor name          |
| `â€œ` / `â€\x9d`     | `"` / `"`         | Smart double quotes      |
| `â€™` / `â€˜`        | `'` / `'`         | Smart single quotes      |
| `â€"` / `â€"`        | `—` / `–`         | Em dash / en dash        |
| `Ã©`                  | `é`               | Accented e               |
| `Ã¯`                  | `ï`               | Accented i               |
| `Ã¨`                  | `è`               | Accented e (grave)       |

**Rule:**
1. **Primary fix:** Use the Firecrawl API JSON response directly (not downloaded markdown files). The API response preserves correct UTF-8 encoding.
2. **Fallback fix:** If working from saved files, detect and repair mojibake using a decode-reencode pass: attempt `latin-1` → `utf-8` re-encoding on any text containing known mojibake byte sequences (`Ã©`, `Ã¯`, `â€`, etc.).
3. **Post-fix normalization:** Replace all smart quotes with straight quotes (`"` → `"`, `'` → `'`). Replace em/en dashes with standard hyphens only if they cause downstream issues; otherwise preserve.

**Validation:** After cleaning, no text should contain `Ã` followed by another character (mojibake signature). Run a regex check: `Ã[€-¿]` should return zero matches.

---

#### CLEAN-03: Strip LaTeX Math Artifacts

**Applies to:** Long PDF documents (DCC and similar)
**Problem:** Firecrawl's PDF extraction interprets some content as LaTeX math mode, producing garbled output instead of plain text.

**Known artifact patterns:**

| Artifact                                      | Correct text   | Context                    |
| --------------------------------------------- | -------------- | -------------------------- |
| `$6 0 %`                                      | `60%`          | Percentage in body text    |
| `$^ { 1 3 0 } \mathrm { H e }`               | `¹³⁰He`        | Chemical isotope reference |
| `$\mathrm { }$`                               | *(empty)*      | Empty math mode tags       |
| `$ N $`                                       | `N`            | Single character in math   |
| `\mathrm{...}`                                | Plain text     | Roman text inside math     |

**Rule:**
1. Detect LaTeX math mode delimiters: `$...$` and `$$...$$`
2. Strip the delimiters and LaTeX commands (`\mathrm`, `\text`, `^`, `_`, `{`, `}`)
3. Collapse extra whitespace introduced by LaTeX spacing: `6 0 %` → `60%`
4. Preserve the semantic content (the number, the text, the symbol)

**Regex pattern:** `\$\^?\s*\{?\s*([^$]*?)\s*\}?\s*\$` → extract content, strip LaTeX commands, collapse spaces.

**Validation:** After cleaning, no `$` delimiters should remain in body text (except in financial amounts like `$USD`, which are not present in ICC documents).

---

### 2.2 Medium Severity — Fix to Improve Retrieval Quality

#### CLEAN-04: OCR Error Correction (Manual Corrections List)

**Applies to:** PDF documents, especially scanned/image-based sections
**Problem:** OCR occasionally garbles text, particularly acronyms and short strings.

**Known corrections:**

| OCR Output   | Correct Text | Source Document        | Context                |
| ------------ | ------------ | ---------------------- | ---------------------- |
| `('MMm.`     | `('DDS')`    | Case Information Sheet | Acronym for Davao Death Squad |

**Rule:**
1. Maintain a static corrections list (key-value pairs: `wrong` → `right`)
2. Apply corrections as exact string replacements after all other cleaning
3. When new OCR errors are discovered during ingestion QA, add them to the corrections list
4. Log every correction applied (document_id, original text, corrected text, correction_id)

**Governance:** The corrections list is append-only. Corrections are never removed — only superseded by newer corrections if the original was wrong.

**Validation:** All entries in the corrections list must be verified against the original ICC PDF (viewed directly, not via Firecrawl) before being added.

---

#### CLEAN-05: Flatten Broken Tables

**Applies to:** PDF documents with structured tables
**Problem:** Firecrawl renders tables as flat text with columns jumbled or merged. Row/column structure is lost.

**Rule:**
1. Detect table-like structures in Firecrawl output (repeating patterns of labels + values, pipe-delimited rows, or indented columns)
2. Flatten to key-value paragraph format: `{Label}: {Value}` on separate lines
3. If the table is too garbled to reconstruct, preserve the raw text as-is — do not attempt to infer structure
4. Add metadata tag `table_flattened: true` to affected chunks so retrieval can flag provenance

**Example transformation:**
```
Before (garbled):
Current situation Rodrigo Duterte Philippines Crimes against humanity

After (flattened):
Current situation: Rodrigo Duterte
Country: Philippines
Charges: Crimes against humanity
```

**Validation:** Flattened tables must preserve all values present in the garbled source. No values may be added or inferred.

---

#### CLEAN-06: Separate Inline Footnote Superscripts

**Applies to:** Long PDF documents (DCC and similar)
**Problem:** Footnote reference numbers are merged with adjacent body text, making both the citation and the preceding word unsearchable.

**Known patterns:**

| Raw Output              | Cleaned                    |
| ----------------------- | -------------------------- |
| `victims.12 The`        | `victims. [fn:12] The`     |
| `killings,34 including` | `killings, [fn:34] including` |

**Rule:**
1. Detect patterns where a period/comma is immediately followed by a number and then a space + capital letter: `([.,;:])\s*(\d{1,3})\s+([A-Z])`
2. Insert a footnote marker: `$1 [fn:$2] $3`
3. Do not modify numbers that are part of legal references (e.g., `Article 7(1)(a)` — these follow specific patterns with parentheses)

**Validation:** Footnote separation must not alter legal numbering patterns. Run a check that no `Article \d+`, `Rule \d+`, `Count \d+`, or `paragraph \d+` references were affected.

---

### 2.3 Low Severity — Normalize for Consistency

#### CLEAN-07: Normalize REDACTED Markers

**Applies to:** PDF documents with redacted content
**Problem:** Firecrawl produces both escaped `\[REDACTED\]` and raw `[REDACTED]` in the same document.

**Rule:** Normalize all variants to a single canonical form: `[REDACTED]` (unescaped, uppercase).

**Variants to normalize:**

| Variant              | Normalized    |
| -------------------- | ------------- |
| `\[REDACTED\]`       | `[REDACTED]`  |
| `[redacted]`         | `[REDACTED]`  |
| `[ REDACTED ]`       | `[REDACTED]`  |
| `[REDACTED ]`        | `[REDACTED]`  |
| `████`               | `[REDACTED]`  |
| `[***]`              | `[REDACTED]`  |

**Governance:** This is a normalization rule only. The system must never replace `[REDACTED]` with inferred content. Constitution Principle 3 (Redacted Content Is Sacred) applies — the marker is preserved; the content behind it is never investigated.

**Validation:** After normalization, every `[REDACTED]` marker must be the exact string `[REDACTED]`. Regex check: no remaining `\[REDACTED\]` (escaped) or `████` (block redaction) patterns.

---

#### CLEAN-08: Strip Checkbox and Form Artifacts

**Applies to:** PDF documents with form fields
**Problem:** Checkboxes from ICC form PDFs appear as Unicode symbols.

**Rule:** Strip `☒`, `☐`, and similar form-control Unicode characters. If a checkbox is adjacent to a label (e.g., `☒ Crimes against humanity`), preserve the label text only.

**Validation:** No Unicode form characters (U+2610, U+2611, U+2612) in output.

---

#### CLEAN-09: Strip Image References and Copyright Lines

**Applies to:** HTML pages and PDF documents
**Problem:** Markdown image references (`![alt](url)`) and ICC copyright notices are scraped as content.

**Rule:**
1. Strip all markdown image references: `!\[.*?\]\(.*?\)`
2. Strip ICC copyright boilerplate lines matching: `© International Criminal Court`, `ICC-CPI`, or similar
3. Strip repeated page headers/footers (detect by exact-match repetition across page boundaries)

**Validation:** No `![` image markdown or `©` copyright lines in cleaned output.

---

#### CLEAN-10: Strip Repeated Page Headers and Footers

**Applies to:** PDF documents (especially long ones like the DCC)
**Problem:** PDF extraction repeats the document header and footer on every page, creating noise in chunks.

**Rule:**
1. Detect lines that repeat verbatim more than 3 times in the document (strong indicator of page header/footer)
2. Keep the first occurrence (top of document); strip all subsequent repeats
3. Common patterns: document reference numbers (e.g., `ICC-01/21-01/23`), page numbers, confidentiality markings, date stamps

**Validation:** After stripping, no line should repeat verbatim more than 3 times unless it's substantive legal text (e.g., a repeated legal standard in charges). Flag any removed line that is longer than 80 characters for manual review.

---

## 3. Processing Pipeline Order

Rules must be applied in this order to prevent cascading errors:

```
Step 1: CLEAN-01  → Strip HTML boilerplate (HTML pages only)
Step 2: CLEAN-02  → Fix UTF-8 mojibake (all documents)
Step 3: CLEAN-03  → Strip LaTeX math artifacts (all documents)
Step 4: CLEAN-10  → Strip repeated page headers/footers (PDFs)
Step 5: CLEAN-09  → Strip image refs and copyright (all documents)
Step 6: CLEAN-08  → Strip checkbox/form artifacts (PDFs)
Step 7: CLEAN-06  → Separate inline footnote superscripts (PDFs)
Step 8: CLEAN-05  → Flatten broken tables (PDFs)
Step 9: CLEAN-07  → Normalize REDACTED markers (all documents)
Step 10: CLEAN-04 → Apply OCR corrections (all documents, last)
```

**Rationale for order:**
- Boilerplate and encoding fixes first — they affect all downstream rules
- Structural fixes (headers, images, checkboxes) before content fixes (footnotes, tables)
- REDACTED normalization near the end — it depends on LaTeX stripping being done first
- OCR corrections last — they are exact string matches that should run on fully cleaned text

---

## 4. Validation Contract

After all cleaning rules are applied and before chunking, every document must pass these checks:

### 4.1 Automated Checks

| ID     | Check                                    | Pass Condition                                              | Action on Fail                          |
| ------ | ---------------------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| VAL-01 | No mojibake signatures                   | Regex `Ã[€-¿]` returns 0 matches                           | Re-run CLEAN-02; if still failing, flag for manual review |
| VAL-02 | No LaTeX delimiters in body text         | Regex `\$[^$]+\$` returns 0 matches                        | Re-run CLEAN-03; flag for manual review |
| VAL-03 | All REDACTED markers canonical           | Only exact `[REDACTED]` present; no escaped or variant forms | Re-run CLEAN-07                         |
| VAL-04 | No HTML boilerplate (HTML pages)         | No navigation, footer, cookie, or social media content      | Re-run CLEAN-01; flag for manual review |
| VAL-05 | No form artifacts                        | No `☒`, `☐`, or similar Unicode form characters             | Re-run CLEAN-08                         |
| VAL-06 | No image markdown                        | No `![` patterns                                            | Re-run CLEAN-09                         |
| VAL-07 | Document is not empty after cleaning     | Cleaned text > 100 characters                               | Flag as critical — source page may have changed structure |
| VAL-08 | Legal numbering preserved                | Spot-check: `Article \d+`, `Rule \d+`, `Count \d+` patterns present if source contains them | Manual review — CLEAN-06 may have damaged legal refs |
| VAL-09 | No excessive repeated lines              | No line repeats verbatim > 3 times (except substantive text) | Re-run CLEAN-10                         |
| VAL-10 | OCR corrections applied                  | All entries in corrections list matched and replaced         | Log unmatched corrections — source may have been updated |

### 4.2 Manual Spot Checks (per ingestion run)

These are not automated but must be performed by the admin after each weekly ingestion:

1. **Sample 3 random chunks** from each document type (HTML, short PDF, long PDF) and compare against the original ICC document viewed directly in a browser
2. **Verify REDACTED markers** — confirm that `[REDACTED]` appears in the cleaned text wherever the original document has redactions
3. **Verify legal references** — confirm that at least 5 legal references (`Article X`, `Rule Y`, `Count Z`) survive cleaning intact
4. **Verify proper nouns** — confirm that judge and prosecutor names with accented characters are correctly rendered after cleaning

---

## 5. Data Quality Rules by Document Type

### 5.1 HTML Pages (RAG 1 + RAG 2)

| Rule       | Applies | Notes                                              |
| ---------- | ------- | -------------------------------------------------- |
| CLEAN-01   | Yes     | Primary concern — most of HTML output is boilerplate |
| CLEAN-02   | Rare    | HTML is usually well-encoded; check anyway          |
| CLEAN-03   | No      | LaTeX artifacts not observed in HTML scrapes         |
| CLEAN-04   | No      | OCR not relevant for HTML                            |
| CLEAN-05   | Rare    | HTML tables render better than PDF tables            |
| CLEAN-06   | No      | HTML footnotes are usually hyperlinked, not inline   |
| CLEAN-07   | No      | REDACTED markers not observed in HTML pages          |
| CLEAN-08   | No      | Form artifacts not observed in HTML pages            |
| CLEAN-09   | Yes     | Images and copyright lines present in HTML           |
| CLEAN-10   | No      | No page headers/footers in HTML                      |

### 5.2 Short PDFs — Case Information Sheets, Key Messages (RAG 2)

| Rule       | Applies | Notes                                              |
| ---------- | ------- | -------------------------------------------------- |
| CLEAN-01   | No      | Not HTML                                             |
| CLEAN-02   | Yes     | Accented names are common (judge/prosecutor names)   |
| CLEAN-03   | Rare    | Not observed in short PDFs; check anyway             |
| CLEAN-04   | Yes     | OCR errors observed (`('MMm.` → `('DDS')`)           |
| CLEAN-05   | Yes     | Table extraction is poor in short PDFs               |
| CLEAN-06   | Rare    | Few footnotes in info sheets                         |
| CLEAN-07   | No      | REDACTED content not observed in info sheets         |
| CLEAN-08   | Yes     | Checkbox artifacts present in Case Info Sheet        |
| CLEAN-09   | Yes     | Copyright and image refs present                     |
| CLEAN-10   | Rare    | Short PDFs have few pages                            |

### 5.3 Long PDFs — DCC, Rome Statute, Rules of Procedure (RAG 1 + RAG 2)

| Rule       | Applies | Notes                                              |
| ---------- | ------- | -------------------------------------------------- |
| CLEAN-01   | No      | Not HTML                                             |
| CLEAN-02   | Yes     | Accented names throughout                            |
| CLEAN-03   | Yes     | LaTeX artifacts confirmed in DCC                     |
| CLEAN-04   | Possible| Not observed yet; monitor during ingestion           |
| CLEAN-05   | Possible| Tables present in legal texts; quality unknown       |
| CLEAN-06   | Yes     | Footnote superscripts inline confirmed in DCC        |
| CLEAN-07   | Yes     | REDACTED markers with inconsistent escaping in DCC   |
| CLEAN-08   | Rare    | Form fields uncommon in long legal documents         |
| CLEAN-09   | Yes     | Copyright headers on every page                      |
| CLEAN-10   | Yes     | Document headers/footers repeat on every page        |

---

## 6. REDACTED Content Handling

> **Constitution Principle 3:** Redacted Content Is Sacred. The LLM must never attempt to de-anonymize, identify, link names to, or investigate [REDACTED] content.

The data quality pipeline treats `[REDACTED]` markers with special care:

1. **Preserve:** `[REDACTED]` markers are never removed, replaced, or modified (except normalization per CLEAN-07)
2. **Normalize:** All variant forms are standardized to `[REDACTED]` for consistent retrieval
3. **Do not infer:** If text adjacent to `[REDACTED]` provides context clues about the redacted content, the pipeline does not act on those clues — it cleans the surrounding text normally
4. **Chunk boundary:** `[REDACTED]` may appear in any chunk. The chunking strategy does not split on or around redacted markers — they are treated as regular text tokens
5. **Metadata:** Chunks containing `[REDACTED]` do not receive any special metadata flag. The LLM guardrail (not the pipeline) is responsible for refusing to investigate redacted content

---

## 7. Edge Cases

| ID     | Scenario                                         | Handling                                                     |
| ------ | ------------------------------------------------ | ------------------------------------------------------------ |
| DQ-EC-01 | Firecrawl returns empty content for a URL       | Log error; do not ingest; alert admin; retry on next run     |
| DQ-EC-02 | Entire document is REDACTED                      | Ingest normally — the chunks will contain only `[REDACTED]` markers, which is valid |
| DQ-EC-03 | New ICC document type not seen before            | All CLEAN rules still apply; admin spot-checks first ingestion of new type |
| DQ-EC-04 | OCR correction creates an incorrect replacement  | Revert correction; update corrections list; re-ingest document |
| DQ-EC-05 | Table flattening loses data                      | Prefer raw garbled text over lossy flattening; flag for manual review |
| DQ-EC-06 | Legal reference damaged by footnote separation   | VAL-08 catches this; re-run CLEAN-06 with adjusted regex     |
| DQ-EC-07 | Document encoding changes between scrapes        | Content hash will differ; document is re-ingested with current encoding |
| DQ-EC-08 | Firecrawl API response vs downloaded file differ | Always use API response (CLEAN-02 primary fix); never rely on downloaded markdown files |
| DQ-EC-09 | New mojibake pattern not in known list            | Admin adds to CLEAN-02 known patterns; re-ingest affected documents |
| DQ-EC-10 | Cleaning removes substantive content             | VAL-07 catches empty documents; admin spot-checks catch over-aggressive stripping |

---

## 8. Traceability

| Data Quality Rule | PRD Section             | Constitution Principle           |
| ----------------- | ----------------------- | -------------------------------- |
| CLEAN-01          | 13.1 (HTML pages)       | 2 (ICC Documents Only Source)    |
| CLEAN-02          | 12.2 (After Firecrawl)  | 4 (Source Transparency)          |
| CLEAN-03          | 12.2 (After Firecrawl)  | 4 (Source Transparency)          |
| CLEAN-04          | 13.1 (PDF documents)    | 2 (ICC Documents Only Source)    |
| CLEAN-05          | 13.1 (PDF documents)    | 1 (Audience-First Simplicity)    |
| CLEAN-06          | 13.1 (Legal numbering)  | 4 (Source Transparency)          |
| CLEAN-07          | 13.1 (REDACTED markers) | 3 (Redacted Content Is Sacred)   |
| CLEAN-08          | 13.1 (PDF documents)    | 1 (Audience-First Simplicity)    |
| CLEAN-09          | 13.1 (HTML pages)       | 2 (ICC Documents Only Source)    |
| CLEAN-10          | 13.1 (PDF documents)    | 2 (ICC Documents Only Source)    |
| VAL-01 – VAL-10   | 7 (Success Criteria)    | 7 (Specification-First Dev)      |
| REDACTED handling  | 4 (Guardrails)          | 3 (Redacted Content Is Sacred)   |

---

## 9. Out-of-Scope Transformations

The following are specified in PRD Section 13.1 but are **pipeline transformations**, not cleaning rules. They are handled downstream (during or after chunking), not in this data quality contract:

| Transformation       | PRD Requirement                        | Handled By                          |
| -------------------- | -------------------------------------- | ----------------------------------- |
| Date normalization   | Normalize to ISO 8601 for storage      | Unstructured.io metadata extraction |
| Content deduplication| Compare `content_hash`; skip if same   | Ingestion pipeline (Job 1 / Job 2)  |
| Latin term mapping   | Map to glossary entries where available | LLM prompt / glossary lookup        |
| Legal numbering      | Preserve exactly as-is                 | No transformation needed — preserve |

---

## 10. Open Questions

| ID     | Question                                                        | Impact                                    | Status       |
| ------ | --------------------------------------------------------------- | ----------------------------------------- | ------------ |
| DQ-Q-1 | Does Unstructured.io resolve any of CLEAN-02/03/06 natively?    | May reduce custom cleaning code           | Untested     |
| DQ-Q-2 | What is the LaTeX artifact rate in the Rome Statute PDF?        | May require additional regex patterns     | Untested     |
| DQ-Q-3 | Are there other PDF document types on ICC that have new issues? | May expand the corrections list           | Monitor      |
| DQ-Q-4 | Can Firecrawl be configured to output clean UTF-8 directly?    | Would eliminate CLEAN-02 entirely         | Untested     |
| DQ-Q-5 | What is the false positive rate for footnote separation regex?  | May damage legal references if too aggressive | Test during pipeline spike |

---

*This document governs all data quality decisions in the ingestion pipeline. When in doubt, refer to the constitution (Principles 2, 3, 4) and the PRD (Sections 12, 13, 15).*
