/**
 * Intent classification: 6-step pipeline Steps 3-6 (nl-interpretation.md §2.3).
 * Steps 0-2 (language detect, translate, paste detect) run before this.
 * Deterministic-first, LLM-second.
 */

import type { IntentCategory } from "./intent";
import type { PasteType } from "./paste-detect";
import { getOpenAIClient } from "./openai-client";
import { logEvent } from "./logger";

const VALID_INTENTS: IntentCategory[] = [
  "case_facts",
  "case_timeline",
  "legal_concept",
  "procedure",
  "glossary",
  "paste_text",
  "fact_check",
  "out_of_scope",
];

const INTENT_PROMPT = `You classify user questions about the Duterte ICC case.

Respond with exactly one of these words: case_facts, case_timeline, legal_concept, procedure, glossary, paste_text, fact_check, out_of_scope

- fact_check: User pasted social media content for claim verification (not ICC document text)
- case_facts: "What is Duterte charged with?", "Who are the victims?", "How many counts?", "What are the evidences against Duterte?", "Who are the judges?", "Is Du30 fit to stand trial?", "Who pays for Duterte's defence?", "Where is Duterte detained?", "Did Duterte surrender or was he arrested?", "measures to facilitate attendance", "What did the prosecutor say at the hearing?", "What was the defense's argument?", "What were the closing statements of the defence during the confirmation of charges?", "What is Tokhang?", "What were the operations during the war on drugs?", "What is the Davao Death Squad?", "How many were killed in the drug war?", "What is Oplan Double Barrel?", "What are the charges?", "What evidence is there?", "What's the status of the case?", "Has he been arrested?", "What are Duterte's rights?", "What are the allegations against Duterte?", "Who is the judge?", "Is there a trial yet?"
- case_timeline: "When did the ICC open the investigation?", "What's the timeline?", "When was the arrest warrant issued?", "When did the Philippines withdraw?", "What happened at the February 2026 hearing?", "Key dates of the case?"
- legal_concept: "What is Article 7?", "What are crimes against humanity?", "What does the Rome Statute say about withdrawal?", "What is complementarity?", "What is an Article 18 deferral?", "What is indirect co-perpetration?", "What are the elements of murder as a crime against humanity?"
- procedure: "What happens after confirmation of charges?", "What is the next step in the case?", "Can he be tried in absentia?", "What is an Article 18 deferral?", "Can the Philippines challenge admissibility?", "What is complementarity?", "What happens after this?", "Can the case be dismissed?", "What steps occur if charges are confirmed?"
- glossary: "What does in absentia mean?", "What is proprio motu?", "What does EJK mean?", "What is the DCC?", "Define extrajudicial killing"
- out_of_scope: "Was Duterte justified?", "What's his favorite color?", "Who is [REDACTED]?", "Is the ICC biased?", "Compare Duterte to Marcos", "Should Duterte be punished?"

Nothing else. Just the single category word.`;

// --- Layer 1: Prompt injection stripping (nl-interpretation.md §4.2) ---
const INJECTION_PATTERNS = [
  /\bignore\s+all\s+(previous\s+)?instructions\.?\s*/gi,
  /\byou\s+are\s+now\s+[^.]+\.?\s*/gi,
  /\[System[^\]]*\][\s.]*/gi,
  /\[INST[^\]]*\][\s.]*/gi,
  /\bsystem\s+message\s*:\s*[^\n]+[\s\n]*/gi,
  /\b(jailbreak|bypass|unrestricted)\s+[^.]*\.?\s*/gi,
];

function stripInjectionPrefix(query: string): string {
  let cleaned = query.trim();
  for (const pat of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pat, " ").trim();
  }
  return cleaned.trim() || query.trim();
}

// --- Layer 1: Deterministic gates ---
// When pasteType is provided, Step 2 already decided — bypass LLM
function layer1Deterministic(
  query: string,
  hasPastedText: boolean,
  cleanedQuery: string,
  pasteType?: PasteType
): IntentCategory | null {
  if (pasteType === "social_media") return "fact_check";
  if (pasteType === "icc_document") return "paste_text";
  if (hasPastedText && !pasteType) return "paste_text"; // Legacy: no paste detection yet
  if (!cleanedQuery || /^\s*$/.test(cleanedQuery)) return "out_of_scope";
  if (/\[REDACTED\]/i.test(cleanedQuery)) return "out_of_scope";
  // Prompt injection: if full query is an injection attempt with no real question left, out_of_scope
  if (cleanedQuery !== query.trim() && !cleanedQuery) return "out_of_scope";
  return null;
}

// --- Layer 2: Regex patterns (nl-interpretation.md §2.3, §4.1) ---
// Note: Tagalog → non_english removed; language detection is Step 0, translation is Step 1.

function layer2Regex(cleanedQuery: string): { intent: IntentCategory; confidence: "high" | "low" } | null {
  const q = cleanedQuery;

  // Redaction signals (§4.1)
  if (/\bredacted\b/i.test(q)) return { intent: "out_of_scope", confidence: "high" };
  if (/\bconfidential\s+witness\b/i.test(q)) return { intent: "out_of_scope", confidence: "high" };
  if (/\bunnamed\b.*\b(source|witness|person|individual)\b/i.test(q)) return { intent: "out_of_scope", confidence: "high" };
  if (/\bunnamed\b.*\b(dcc|document)\b/i.test(q)) return { intent: "out_of_scope", confidence: "high" };
  if (/\bsealed\b.*\b(evidence|document|record)\b/i.test(q)) return { intent: "out_of_scope", confidence: "high" };
  if (/\bfigure\s+out\b.*\b(name|who)\b/i.test(q)) return { intent: "out_of_scope", confidence: "high" };
  if (/\bde-?anonymize\b/i.test(q)) return { intent: "out_of_scope", confidence: "high" };
  if (/\bwho\s+is\s+the\s+witness\b.*\b(page|section)\d+/i.test(q)) return { intent: "out_of_scope", confidence: "high" };

  // Guilt/innocence status (P1-2) — route to case_facts with procedural-status treatment; BEFORE other patterns
  if (/\b(is|was)\s+(he|duterte|du30|the\s+accused)\s+(guilty|innocent|convicted|acquitted)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\bguilty\s+ba\b/i.test(q)) return { intent: "case_facts", confidence: "high" };

  // case_facts patterns
  if (/(surrender|arrested|arrest)\s*(duterte|du30|him|accused)|(duterte|du30)\s*(surrender|arrested|arrest)/i.test(q)) return { intent: "case_facts", confidence: "high" };
  if (/\bevidence[s]?\b.*duterte|duterte.*\bevidence[s]?\b/i.test(q)) return { intent: "case_facts", confidence: "high" };
  if (/who\s+are\s+the\s+judges|judges\s+in\s+the\s+case|fit\s+to\s+stand\s+trial/i.test(q)) return { intent: "case_facts", confidence: "high" };
  if (/how\s+many\s+.*(killed|victims|counts?|people|died)/i.test(q)) return { intent: "case_facts", confidence: "high" };
  if (/measures\s*.*(facilitate|attendance|duterte)|facilitate\s*.*(attendance|duterte)/i.test(q)) return { intent: "case_facts", confidence: "high" };
  if (/(who\s+pays?|who\s+funds?|pays?\s+for)\s*(defence|defense|legal\s+aid|duterte)/i.test(q)) return { intent: "case_facts", confidence: "high" };
  if (/where\s+(is|was)\s+.*(duterte|du30|accused)\s+(detained|held|in\s+custody)/i.test(q)) return { intent: "case_facts", confidence: "high" };
  if (/(detained|detention|in\s+custody).*duterte/i.test(q)) return { intent: "case_facts", confidence: "high" };

  // Evidence + case/documents (broader — don't require "duterte")
  if (/\b(evidence|evidentiary|proof)\b.*\b(icc|case|charges|listed|access|documents?)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\b(icc|case|charges)\b.*\b(evidence|evidentiary|proof)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };

  // Drug war operations / Philippines-specific case terms → case_facts
  if (/\b(tokhang|oplan\s+tokhang|oplan\s+double\s+barrel|double\s+barrel)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\b(davao\s+death\s+squad|dds|davao\s+killings?)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\b(war\s+on\s+drugs?|drug\s+war|anti[- ]?drug)\b.*\b(operat|campaign|kill|victim|murder|shoot|raid)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\b(operat|campaign|kill|victim|murder|shoot|raid)\b.*\b(war\s+on\s+drugs?|drug\s+war|anti[- ]?drug)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\b(extrajudicial|extra[- ]?judicial)\s+(kill|execution|murder)/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\b(noche\s+buena|buy[- ]?bust|shabu)\b.*\b(icc|case|duterte|operation|kill)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\bwhat\s+is\s+tokhang\b/i.test(q)) return { intent: "case_facts", confidence: "high" };

  // Hearing/transcript content queries → case_facts
  if (/\b(hearing|transcript|testified|testimony|argued|argument)\b.*\b(duterte|icc|case|prosecution|defence|defense)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\b(prosecution|defence|defense)\b.*\b(argued?|said|stated|claimed|presented)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };

  // Article 18 / deferral / admissibility challenge → procedure
  if (/\b(article\s+18|deferral|admissibility\s+challeng|complementarity\s+challeng)\b/i.test(q))
    return { intent: "procedure", confidence: "high" };

  // Lawyer/counsel/representation + Duterte/ICC/case
  if (/\b(lawyer|lawyers|counsel|defen[cs]e|represent\w*|accredit\w*)\b.*\b(duterte|du30|icc|case|accused)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\b(duterte|du30|accused)\b.*\b(lawyer|lawyers|counsel|defen[cs]e|represent\w*)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };

  // Withdrawal inflected forms + jurisdiction/Rome Statute
  if (/\b(withdr[ae]w\w*|withdrew)\b.*\b(rome|icc|statute|jurisdiction)\b/i.test(q))
    return { intent: "legal_concept", confidence: "high" };
  if (/\b(rome|icc|statute|jurisdiction)\b.*\b(withdr[ae]w\w*|withdrew)\b/i.test(q))
    return { intent: "legal_concept", confidence: "high" };

  // case_timeline
  if (/(when\s+(did|was|is)|timeline|what\s+happened)\s+.*\b(icc|investigation|case|hearing|warrant)\b/i.test(q)) return { intent: "case_timeline", confidence: "high" };
  if (/\b(icc|investigation|case|hearing|warrant)\b.*(when\s+(did|was|is)|timeline)/i.test(q)) return { intent: "case_timeline", confidence: "high" };

  // procedure (incl. absence/status queries: "Has X been convicted?", "Has trial started?")
  if (/next\s+step|what\s+happens\s+next|next\s+steps|what('s|\s+is)\s+next|what\s+happens\s+now/i.test(q)) return { intent: "procedure", confidence: "high" };
  if (/what\s+happens\s+after\s+(confirmation|charges)/i.test(q)) return { intent: "procedure", confidence: "high" };
  if (/\bhas\s+.{1,40}(been\s+convicted|trial\s+started|started\s+yet)\b/i.test(q)) return { intent: "case_facts", confidence: "high" };

  // Standalone case-context questions (cursor-false-decline-reduction P0-3)
  if (/\b(what|tell\s+me\s+about)\s+(are\s+)?(the\s+)?(charges?|counts?|allegations?|indictment)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\b(what|who)\s+(is|are|was|were)\s+(the\s+)?(judge|judges|magistrate|chamber)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\b(what|where)\s+(is|are|was|were)\s+(the\s+)?(status|current\s+status|latest|update)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (
    /\b(is|has)\s+(there|he|duterte|du30)\s+(been\s+)?(a\s+)?(trial|verdict|sentence|hearing|arrested|detained|convicted|acquitted)\b/i.test(q)
  )
    return { intent: "case_facts", confidence: "high" };
  if (/\b(what|tell\s+me\s+about)\s+(the\s+)?(evidence|proof|evidentiary)\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };
  if (/\b(detain\w*|detention|in\s+custody|held\s+in|imprisoned)\b/i.test(q))
    return { intent: "case_facts", confidence: "low" };
  if (/\b(counsel|lawyer|represent\w*|legal\s+aid|legal\s+team)\b/i.test(q))
    return { intent: "case_facts", confidence: "low" };
  if (/\bwhat\s+happens\s+(after|if|when|once)\b/i.test(q))
    return { intent: "procedure", confidence: "low" };
  if (/\b(can|could)\s+(duterte|he|the\s+accused)\s+(be\s+)?(tried|sentenced|convicted|acquitted|released)\b/i.test(q))
    return { intent: "procedure", confidence: "low" };
  // Factual-procedural: normative filter lets these through; route to in-scope (cursor-false-decline FD-13, FD-14)
  if (/\bis\s+(the\s+)?(case|investigation|prosecution)\s+(legitimate|admissible|valid)\b/i.test(q))
    return { intent: "procedure", confidence: "high" };
  if (/\b(should|must)\s+(duterte|he|the\s+accused)\s+(appear|attend|surrender|cooperate|comply)\b/i.test(q))
    return { intent: "procedure", confidence: "high" };
  if (/\bwhat\s+did\s+(duterte|du30|he)\s+do\b/i.test(q))
    return { intent: "case_facts", confidence: "high" };

  // glossary / legal_concept (definition-style)
  if (/\b(define|what\s+does|what\s+is)\s+['"]?\w+['"]?\s+mean/i.test(q)) return { intent: "legal_concept", confidence: "high" };
  if (/\bdefine\s+\w+/i.test(q)) return { intent: "legal_concept", confidence: "high" };

  return null;
}

// --- Layer 3: LLM classification ---
async function layer3LLM(cleanedQuery: string): Promise<string | null> {
  const openai = getOpenAIClient();
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: INTENT_PROMPT },
      { role: "user", content: cleanedQuery },
    ],
    max_tokens: 32,
  });

  const raw = (res.choices[0]?.message?.content?.trim().toLowerCase() ?? "").replace(/[^a-z_\s]/g, "");
  const found = VALID_INTENTS.find((intent) => raw.includes(intent));
  if (found && found !== "paste_text") return found;
  if (raw.includes("case facts")) return "case_facts";
  if (raw.includes("case timeline")) return "case_timeline";
  if (raw.includes("legal concept")) return "legal_concept";
  if (raw.includes("procedure")) return "procedure";
  if (raw.includes("glossary")) return "glossary";
  if (raw.includes("fact check") || raw.includes("fact_check")) return "fact_check";
  return found ?? "out_of_scope";
}

/** Redaction response (nl-interpretation.md §3.2, §4.1) */
export const REDACTION_RESPONSE =
  "This content is redacted in ICC records. The Docket cannot investigate or speculate on redacted material.";

function isRedactionQuery(q: string): boolean {
  if (/\[REDACTED\]/i.test(q)) return true;
  if (/\bredacted\b/i.test(q)) return true;
  if (/\bconfidential\s+witness\b/i.test(q)) return true;
  if (/\bunnamed\b.*\b(source|witness|person|individual|dcc|document)\b/i.test(q)) return true;
  if (/\bsealed\b.*\b(evidence|document|record)\b/i.test(q)) return true;
  if (/\bfigure\s+out\b.*\b(name|who)\b/i.test(q)) return true;
  if (/\bde-?anonymize\b/i.test(q)) return true;
  if (/\bwho\s+is\s+the\s+witness\b.*\b(page|section)\d+/i.test(q)) return true;
  return false;
}

export interface ClassificationResult {
  intent: IntentCategory;
  isRedaction: boolean;
}

/**
 * Classify user query into intent category. Steps 3-6 of 6-step pipeline.
 * When pasteType is provided (from Step 2), routes directly to fact_check or paste_text.
 */
export async function classifyIntent(
  query: string,
  hasPastedText: boolean,
  pasteType?: PasteType
): Promise<ClassificationResult> {
  // Strip injection prefix before any classification (Task 10.11)
  const cleanedQuery = stripInjectionPrefix(query);

  // Layer 1: Deterministic gates (includes pasteType from Step 2)
  const layer1 = layer1Deterministic(query, hasPastedText, cleanedQuery, pasteType);
  if (layer1) {
    const isRedaction = layer1 === "out_of_scope" && isRedactionQuery(cleanedQuery);
    logEvent("classifier.intent", "info", { layer: 1, intent: layer1 });
    return { intent: layer1, isRedaction };
  }

  // Layer 2: Regex pattern matching
  const layer2 = layer2Regex(cleanedQuery);
  if (layer2 && layer2.confidence === "high") {
    const isRedaction = layer2.intent === "out_of_scope";
    logEvent("classifier.intent", "info", { layer: 2, intent: layer2.intent, confidence: layer2.confidence });
    return { intent: layer2.intent, isRedaction };
  }

  // Layer 3: LLM (only when Layers 1–2 produce no match)
  const layer3 = await layer3LLM(cleanedQuery);

  // Layer 4: Cross-validation — if Layer 2 had low-confidence match and Layer 3 disagrees, Layer 2 wins
  if (layer2 && layer2.intent !== layer3) {
    logEvent("classifier.conflict", "warn", {
      layer2_intent: layer2.intent,
      layer3_intent: layer3,
      resolved_to: layer2.intent,
    });
    return { intent: layer2.intent, isRedaction: layer2.intent === "out_of_scope" };
  }

  const intent = VALID_INTENTS.includes(layer3 as IntentCategory) ? layer3 : "out_of_scope";
  const isRedaction = intent === "out_of_scope" && isRedactionQuery(cleanedQuery);
  logEvent("classifier.intent", "info", { layer: 3, intent });
  return { intent: intent as IntentCategory, isRedaction };
}
