/**
 * Data quality cleaning rules (data-quality.md §2).
 * Applied after Firecrawl output, before chunking.
 * Order follows §3 Processing Pipeline Order.
 */

/** Whether the source is HTML (vs PDF). */
export type SourceType = "html" | "pdf";

/** CLEAN-04: OCR corrections list (data-quality.md §2.2) */
const OCR_CORRECTIONS: [string, string][] = [
  ["('MMm.", "('DDS')"],
  // Add more as discovered during ingestion QA
];

/**
 * CLEAN-01: Strip HTML boilerplate (HTML only).
 * Firecrawl's onlyMainContent helps; this catches remaining nav/footer/social patterns.
 */
function clean01StripHtmlBoilerplate(text: string): string {
  // Common ICC site patterns to strip (regex-based for markdown output)
  const patterns = [
    /\[?\s*Cookie(s)?\s*(policy|consent|notice)\s*\]?/gi,
    /\[?\s*Share\s+(this\s+)?(page|on)\s+[\s\S]*?\]?/gi,
    /\[\s*Twitter\s*\]|\[\s*Facebook\s*\]|\[\s*LinkedIn\s*\]/gi,
    /Navigation\s*:\s*Home[\s\S]*?(?=\n\n|$)/g,
    /Footer[\s\S]*?©\s*International\s*Criminal\s*Court[\s\S]*?/g,
    /Related\s+cases?\s*:[\s\S]*?(?=\n\n|$)/g,
    /Site\s+map\s*:[\s\S]*?(?=\n\n|$)/g,
  ];

  let result = text;
  for (const p of patterns) {
    result = result.replace(p, "");
  }
  return result;
}

/**
 * CLEAN-02: Fix UTF-8 mojibake.
 * Primary: use API response directly (caller responsibility).
 * Fallback: latin-1 → utf-8 re-encode for known mojibake sequences.
 */
function clean02FixMojibake(text: string): string {
  // Known mojibake → correct (data-quality.md §2.1)
  const replacements: [RegExp | string, string][] = [
    [/Ã©/g, "é"],
    [/Ã¯/g, "ï"],
    [/Ã¨/g, "è"],
    [/Ã­/g, "í"],
    [/Ã³/g, "ó"],
    [/RodrÃ­guez/g, "Rodríguez"],
    [/AdÃ©laÃ¯de/g, "Adélaïde"],
    [/â€œ/g, '"'],
    [/â€\x9d/g, '"'],
    [/â€™/g, "'"],
    [/â€˜/g, "'"],
    [/â€"/g, "—"],
    [/â€"/g, "–"],
  ];

  let result = text;
  for (const [from, to] of replacements) {
    result = result.replace(from, to);
  }
  return result;
}

/**
 * CLEAN-03: Strip LaTeX math artifacts.
 * $6 0 % → 60%, $^ { 1 3 0 } \mathrm { H e } → ¹³⁰He
 */
function clean03StripLatex(text: string): string {
  let result = text;
  // $...$ inline math: extract content, strip \mathrm, collapse spaces
  result = result.replace(/\$\^?\s*\{?\s*([^$]*?)\s*\}?\s*\$/g, (_, content) => {
    const stripped = content
      .replace(/\\mathrm\s*\{([^}]*)\}/g, "$1")
      .replace(/\\text\s*\{([^}]*)\}/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    return stripped;
  });
  // $$...$$ block math
  result = result.replace(/\$\$([^$]*?)\$\$/g, (_, content) => {
    const stripped = content
      .replace(/\\mathrm\s*\{([^}]*)\}/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    return stripped;
  });
  return result;
}

/**
 * CLEAN-10: Strip repeated page headers/footers.
 * No line repeats verbatim more than 3 times.
 */
function clean10StripRepeatedHeaders(text: string): string {
  const lines = text.split("\n");
  const count = new Map<string, number>();

  for (const line of lines) {
    const key = line.trim();
    if (key) count.set(key, (count.get(key) ?? 0) + 1);
  }

  const toRemove = new Set<string>();
  for (const [line, n] of count) {
    if (n > 3) toRemove.add(line);
  }

  const result: string[] = [];
  const seen = new Map<string, number>();

  for (const line of lines) {
    const key = line.trim();
    if (!key) {
      result.push(line);
      continue;
    }
    if (toRemove.has(key)) {
      const occurrences = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrences);
      if (occurrences <= 1) result.push(line);
      continue;
    }
    result.push(line);
  }

  return result.join("\n");
}

/**
 * CLEAN-09: Strip image refs and copyright lines.
 */
function clean09StripImagesAndCopyright(text: string): string {
  let result = text;
  result = result.replace(/!\[.*?\]\(.*?\)/g, "");
  result = result.replace(/©\s*International\s*Criminal\s*Court[^\n]*/gi, "");
  result = result.replace(/©\s*ICC-CPI[^\n]*/gi, "");
  return result;
}

/**
 * CLEAN-08: Strip checkbox/form artifacts.
 */
function clean08StripCheckboxes(text: string): string {
  return text.replace(/[☒☐☑]/g, "");
}

/**
 * CLEAN-06: Separate inline footnote superscripts.
 * victims.12 The → victims. [fn:12] The
 * Pattern: punct + digits + space + capital (footnote ref).
 * Skip when preceded by ")" (legal refs like Article 7(1)(a)).
 */
function clean06SeparateFootnotes(text: string): string {
  return text.replace(
    /([.,;:])\s*(\d{1,3})\s+([A-Z])/g,
    (full, punct, num, cap, offset) => {
      const before = offset > 0 ? text.slice(Math.max(0, offset - 20), offset) : "";
      if (/\)\s*$/.test(before)) return full;
      return `${punct} [fn:${num}] ${cap}`;
    }
  );
}

/**
 * CLEAN-05: Flatten broken tables (simplified).
 * Detect label: value pairs; normalize to "Label: Value".
 * Full table detection is complex; we do basic normalization.
 */
function clean05FlattenTables(text: string): string {
  // Simple pass: lines that look like "Label    Value" → "Label: Value"
  return text.replace(/^([A-Za-z][^:]*?)\s{2,}(.+)$/gm, "$1: $2");
}

/**
 * CLEAN-07: Normalize REDACTED markers to [REDACTED].
 */
function clean07NormalizeRedacted(text: string): string {
  let result = text;
  result = result.replace(/\\\[REDACTED\\\]/g, "[REDACTED]");
  result = result.replace(/\[redacted\]/gi, "[REDACTED]");
  result = result.replace(/\[\s*REDACTED\s*\]/g, "[REDACTED]");
  result = result.replace(/\[REDACTED\s*\]/g, "[REDACTED]");
  result = result.replace(/████+/g, "[REDACTED]");
  result = result.replace(/\[\*{2,}\]/g, "[REDACTED]");
  return result;
}

/**
 * CLEAN-04: Apply OCR corrections (exact string replacements).
 */
function clean04OcrCorrections(text: string): string {
  let result = text;
  for (const [wrong, right] of OCR_CORRECTIONS) {
    result = result.replaceAll(wrong, right);
  }
  return result;
}

/**
 * Run all cleaning rules in the specified order.
 */
export function cleanDocumentContent(rawText: string, sourceType: SourceType): string {
  let text = rawText;
  if (!text || text.trim().length === 0) return text;

  // Step 1: CLEAN-01 (HTML only)
  if (sourceType === "html") {
    text = clean01StripHtmlBoilerplate(text);
  }

  // Step 2: CLEAN-02
  text = clean02FixMojibake(text);

  // Step 3: CLEAN-03
  text = clean03StripLatex(text);

  // Step 4: CLEAN-10 (PDFs)
  if (sourceType === "pdf") {
    text = clean10StripRepeatedHeaders(text);
  }

  // Step 5: CLEAN-09
  text = clean09StripImagesAndCopyright(text);

  // Step 6: CLEAN-08 (PDFs)
  if (sourceType === "pdf") {
    text = clean08StripCheckboxes(text);
  }

  // Step 7: CLEAN-06 (PDFs)
  if (sourceType === "pdf") {
    text = clean06SeparateFootnotes(text);
  }

  // Step 8: CLEAN-05 (PDFs)
  if (sourceType === "pdf") {
    text = clean05FlattenTables(text);
  }

  // Step 9: CLEAN-07
  text = clean07NormalizeRedacted(text);

  // Step 10: CLEAN-04
  text = clean04OcrCorrections(text);

  return text.trim();
}
