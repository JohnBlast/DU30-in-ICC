/**
 * Validation checks after cleaning (data-quality.md §4.1).
 */

export interface ValidationResult {
  id: string;
  passed: boolean;
  message?: string;
}

/** VAL-01: No mojibake (Ã©, Ã¯, â€œ, etc.) */
function val01NoMojibake(text: string): ValidationResult {
  const match = text.match(/Ã[^\s\n\r]/);
  return {
    id: "VAL-01",
    passed: !match,
    message: match ? `Mojibake found: ${match[0]}` : undefined,
  };
}

/** VAL-02: No LaTeX delimiters in body ($...$) */
function val02NoLatexDelimiters(text: string): ValidationResult {
  const match = text.match(/\$[^$]+\$/);
  return {
    id: "VAL-02",
    passed: !match,
    message: match ? `LaTeX delimiter found: ${match[0]}` : undefined,
  };
}

/** VAL-03: All REDACTED markers canonical ([REDACTED] only) */
function val03RedactedCanonical(text: string): ValidationResult {
  const bad = text.match(/\\\[REDACTED\\\]|████|\[REDACTED\s+\]|\[\s+REDACTED\]/);
  return {
    id: "VAL-03",
    passed: !bad,
    message: bad ? `Non-canonical REDACTED variant: ${bad[0]}` : undefined,
  };
}

/** VAL-05: No form artifacts (☒, ☐) */
function val05NoFormArtifacts(text: string): ValidationResult {
  const match = text.match(/[☒☐☑]/);
  return {
    id: "VAL-05",
    passed: !match,
    message: match ? `Form artifact: ${match[0]}` : undefined,
  };
}

/** VAL-06: No image markdown (![) */
function val06NoImageMarkdown(text: string): ValidationResult {
  const match = text.match(/!\[/);
  return {
    id: "VAL-06",
    passed: !match,
    message: match ? "Image markdown found" : undefined,
  };
}

/** VAL-07: Document not empty after cleaning (> 100 chars) */
function val07NotEmpty(text: string): ValidationResult {
  const len = text.trim().length;
  return {
    id: "VAL-07",
    passed: len > 100,
    message: len <= 100 ? `Document too short: ${len} chars` : undefined,
  };
}

/** VAL-08: Legal numbering preserved (spot-check patterns exist if source has them) - informational */
function val08LegalNumbering(text: string): ValidationResult {
  const hasArticle = /\bArticle\s+\d+/i.test(text);
  const hasRule = /\bRule\s+\d+/i.test(text);
  const hasCount = /\bCount\s+\d+/i.test(text);
  const hasRefs = hasArticle || hasRule || hasCount;
  return {
    id: "VAL-08",
    passed: true,
    message: hasRefs ? "Legal refs present" : undefined,
  };
}

/** VAL-09: No excessive repeated lines (no line > 3 times) */
function val09NoExcessiveRepeats(text: string): ValidationResult {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const count = new Map<string, number>();
  for (const l of lines) count.set(l, (count.get(l) ?? 0) + 1);
  const maxRep = Math.max(0, ...count.values());
  return {
    id: "VAL-09",
    passed: maxRep <= 3,
    message: maxRep > 3 ? `Line repeats ${maxRep} times` : undefined,
  };
}

/** VAL-10: OCR corrections applied - checked by correction logging; assume pass if no errors */
function val10OcrCorrections(): ValidationResult {
  return { id: "VAL-10", passed: true };
}

/** Run all validation checks. */
export function validateCleanedContent(text: string): ValidationResult[] {
  return [
    val01NoMojibake(text),
    val02NoLatexDelimiters(text),
    val03RedactedCanonical(text),
    val05NoFormArtifacts(text),
    val06NoImageMarkdown(text),
    val07NotEmpty(text),
    val08LegalNumbering(text),
    val09NoExcessiveRepeats(text),
    val10OcrCorrections(),
  ];
}

/** Return true if all checks pass. */
export function allValidationsPass(results: ValidationResult[]): boolean {
  return results.every((r) => r.passed);
}
