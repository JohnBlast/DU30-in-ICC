/**
 * ICC legal and Latin terms for inline linking in answers.
 * Terms link to /glossary#slug.
 */

export const GLOSSARY_TERMS: Array<{ term: string; slug: string }> = [
  { term: "confirmation of charges", slug: "confirmation-of-charges" },
  { term: "in absentia", slug: "in-absentia" },
  { term: "proprio motu", slug: "proprio-motu" },
  { term: "crimes against humanity", slug: "crimes-against-humanity" },
  { term: "pre-trial chamber", slug: "pre-trial-chamber" },
  { term: "document containing the charges", slug: "document-containing-the-charges" },
  { term: "Office of the Prosecutor", slug: "office-of-the-prosecutor" },
  { term: "Rome Statute", slug: "rome-statute" },
  { term: "Elements of Crimes", slug: "elements-of-crimes" },
  { term: "Rules of Procedure and Evidence", slug: "rules-of-procedure-and-evidence" },
  { term: "OTP", slug: "office-of-the-prosecutor" },
  { term: "ICC", slug: "icc" },
];

// Sort by term length descending so we match longer phrases first
const SORTED_TERMS = [...GLOSSARY_TERMS].sort((a, b) => b.term.length - a.term.length);

/** Build regex to find glossary terms (case-insensitive, whole-word) */
const TERM_REGEX = new RegExp(
  "\\b(" + SORTED_TERMS.map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b",
  "gi"
);

/**
 * Split text into parts, replacing glossary terms with placeholder objects.
 * Caller renders links for each match.
 */
export function splitGlossaryTerms(
  text: string
): Array<{ type: "text"; value: string } | { type: "term"; term: string; slug: string }> {
  const result: Array<{ type: "text"; value: string } | { type: "term"; term: string; slug: string }> = [];
  let lastIndex = 0;
  let m;

  while ((m = TERM_REGEX.exec(text)) !== null) {
    result.push({ type: "text", value: text.slice(lastIndex, m.index) });
    const matchedTerm = m[1];
    const entry = SORTED_TERMS.find((e) => e.term.toLowerCase() === matchedTerm.toLowerCase());
    if (entry) {
      result.push({ type: "term", term: matchedTerm, slug: entry.slug });
    } else {
      result.push({ type: "text", value: matchedTerm });
    }
    lastIndex = TERM_REGEX.lastIndex;
  }
  result.push({ type: "text", value: text.slice(lastIndex) });
  return result;
}
