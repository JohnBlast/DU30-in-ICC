/**
 * Intent → RAG index mapping (nl-interpretation.md §2.2, §2.4, §3.2).
 * Used by retrieval and LLM pipeline.
 */

export type IntentCategory =
  | "case_facts"
  | "case_timeline"
  | "legal_concept"
  | "procedure"
  | "glossary"
  | "paste_text"
  | "fact_check"
  | "out_of_scope";

/**
 * Returns RAG indexes to search. [1] = legal framework, [2] = case documents.
 * Dual-index [1, 2] when query requires both (nl-interpretation.md §2.4).
 */
export function intentToRagIndexes(
  intent: IntentCategory,
  query: string
): number[] {
  switch (intent) {
    case "out_of_scope":
      return [];
    case "paste_text":
    case "fact_check":
      return [1, 2]; // Search both per spec
    case "case_facts":
    case "case_timeline":
    case "legal_concept":
    case "procedure":
    case "glossary":
      if (requiresDualIndex(intent, query)) return [1, 2];
      return intentToSingleIndex(intent);
    default:
      return [];
  }
}

function intentToSingleIndex(intent: IntentCategory): number[] {
  switch (intent) {
    case "case_facts":
    case "case_timeline":
      return [2];
    case "legal_concept":
    case "procedure":
    case "glossary":
      return [1];
    default:
      return [];
  }
}

/** Dual-index patterns from nl-interpretation.md §2.4 */
function requiresDualIndex(intent: IntentCategory, query: string): boolean {
  const q = query.toLowerCase();

  // Article/statute + Duterte/charges
  if (/\b(article|statute|rome\s+statute)\b.*\b(duterte|charges|du30)\b/i.test(q)) return true;
  if (/\b(duterte|charges|du30)\b.*\b(article|statute|rome\s+statute)\b/i.test(q)) return true;

  // Next step / what happens now
  if (/next\s+step|what('s|\s+is)\s+next|what\s+happens\s+now|what\s+happens\s+next/i.test(q)) return true;

  // Case summary / status / update — need both legal framework and case docs
  if (/\b(summary|summarize|overview|briefing|at\s+a\s+glance|catch\s+me\s+up)\b.*\b(case|duterte|icc)\b/i.test(q)) return true;
  if (/\b(case|duterte|icc)\b.*\b(summary|summarize|overview|briefing|at\s+a\s+glance)\b/i.test(q)) return true;
  if (/^(can\s+you\s+)?(give\s+me\s+)?(a\s+)?(summary|summarize|overview|briefing)\s*[?.!]?$/i.test(q.trim())) return true;
  if (/\bwhere\s+(is|are)\s+(the\s+)?(case|we)\s+(at|now)\b/i.test(q)) return true;
  // App scope: only Duterte ICC case — "the case" / "this case" always means that case; dual-index for full coverage
  if (intent === "case_facts" && /\b(the|this|that)\s+case\b/i.test(q)) return true;
  if (/\b(update|latest|current)\s+(on\s+)?(the\s+)?(case|duterte)\b/i.test(q)) return true;
  if (/\b(key\s+information|critical\s+info|important\s+(facts|information))\b.*\b(case|duterte)\b/i.test(q)) return true;
  if (/\b(how\s+is\s+the\s+case\s+going|what('s|\s+is)\s+the\s+latest)\b/i.test(q)) return true;
  if (/\b(give\s+me\s+an?\s+)?(update|summary|briefing)\b/i.test(q) && /\b(case|duterte|icc)\b/i.test(q)) return true;

  // Term definition + case application
  if (/\b(proprio\s+motu|in\s+absentia)\b.*\b(duterte|case)\b/i.test(q)) return true;

  // Procedure + current case status
  if (/\b(confirmation\s+of\s+charges|has\s+.*happened\s+yet)\b/i.test(q)) return true;

  // Rome Statute article + arrest warrant / DCC
  if (/\b(rome\s+statute\s+article|article\s+.*\bform\b).*\b(arrest\s+warrant|dcc|jurisdictional)\b/i.test(q)) return true;
  if (/\b(arrest\s+warrant|jurisdictional\s+basis)\b.*\b(article|rome\s+statute)\b/i.test(q)) return true;

  // Rule N / evidentiary standard + case event
  if (/\b(reasonable\s+grounds|evidentiary\s+standard)\b.*\b(arrest\s+warrant|warrant)\b/i.test(q)) return true;

  // Legal concept (complementarity, jurisdiction, withdrawal) + case-specific
  if (/\b(complementarity|jurisdiction|withdrawal)\b.*\b(duterte|case)\b/i.test(q)) return true;

  // Victim rules + case scope
  if (/\b(victim|qualifies)\b.*\b(scope\s+of\s+charges|current)\b/i.test(q)) return true;

  // Phase 3: Legal effect + case ("does X invalidate/affect/apply")
  if (/\b(invalidate|affect|apply|impact|override|bar|prevent)\b.*\b(case|duterte|charges|icc)\b/i.test(q)) return true;
  if (/\b(case|duterte|charges|icc)\b.*\b(invalidate|affect|apply|impact|override|bar|prevent)\b/i.test(q)) return true;

  // Phase 3: Counsel/representation + case
  if (/\b(lawyer|lawyers|counsel|defen[cs]e|represent\w*|accredit\w*)\b.*\b(duterte|case|icc)\b/i.test(q)) return true;
  if (/\b(duterte|case|icc)\b.*\b(lawyer|lawyers|counsel|defen[cs]e|represent\w*|accredit\w*)\b/i.test(q)) return true;

  // Phase 3: Evidence + legal standard
  if (/\b(evidence|evidentiary|proof)\b.*\b(standard|rule|article|admissib\w*|listed|access)\b/i.test(q)) return true;

  // Phase 3: Withdrawal inflected forms + case
  if (/\b(withdr[ae]w\w*|withdrew)\b.*\b(case|duterte|icc|jurisdiction|rome\s+statute|invalidat\w*)\b/i.test(q)) return true;
  if (/\b(case|duterte|icc|jurisdiction|rome\s+statute)\b.*\b(withdr[ae]w\w*|withdrew)\b/i.test(q)) return true;

  // Drug war / Philippines operational terms always need both indexes
  if (/\b(tokhang|oplan|double\s+barrel|davao\s+death\s+squad|dds|war\s+on\s+drugs?|drug\s+war|extrajudicial|buy[- ]?bust|shabu)\b/i.test(q))
    return true;

  // Co-perpetration / modes of liability + case — dual-index
  if (/\b(co-?perpetrat|indirect\s+co-?perpetrat|common\s+plan|modes?\s+of\s+liability)\b/i.test(q))
    return true;

  // Hearing/transcript queries need both indexes
  if (/\b(hearing|transcript|testified|testimony)\b/i.test(q)) return true;

  // Rights + case/accused (cursor-false-decline-reduction P0-5)
  if (/\b(rights?|entitle\w*|guarantee\w*)\b.*\b(duterte|accused|defendant|case|icc|trial)\b/i.test(q)) return true;
  if (/\b(duterte|accused|defendant)\b.*\b(rights?|entitle\w*)\b/i.test(q)) return true;
  if (/\b(admissib\w*|cooperat\w*|obligat\w*|surrend\w*|extraditi\w*)\b.*\b(philippines|duterte|case|icc)\b/i.test(q))
    return true;
  if (/\b(philippines|duterte|case)\b.*\b(admissib\w*|cooperat\w*|obligat\w*|surrend\w*|extraditi\w*)\b/i.test(q))
    return true;
  if (/\b(does|do|did|would|could|can)\b.*\b(apply|matter|affect|change|impact)\b.*\b(case|duterte|charges|icc)\b/i.test(q))
    return true;
  if (/\brule\s+\d+\b.*\b(duterte|case|icc|charges|hearing)\b/i.test(q)) return true;
  if (/\b(duterte|case|icc|charges|hearing)\b.*\brule\s+\d+\b/i.test(q)) return true;

  return false;
}

/** @deprecated Use intentToRagIndexes. Returns first index or undefined for dual-index. */
export function intentToRagIndex(intent: IntentCategory): 1 | 2 | undefined {
  const indexes = intentToRagIndexes(intent, "");
  if (indexes.length === 0) return undefined;
  if (indexes.length === 2) return undefined; // Caller should use intentToRagIndexes
  return indexes[0] as 1 | 2;
}
