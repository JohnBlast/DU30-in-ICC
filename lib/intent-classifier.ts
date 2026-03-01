/**
 * Intent classification: 4-layer architecture (nl-interpretation.md §2.3).
 * Deterministic-first, LLM-second.
 */

import type { IntentCategory } from "./intent";
import { getOpenAIClient } from "./openai-client";
import { logEvent } from "./logger";

const VALID_INTENTS: IntentCategory[] = [
  "case_facts",
  "case_timeline",
  "legal_concept",
  "procedure",
  "glossary",
  "paste_text",
  "non_english",
  "out_of_scope",
];

const INTENT_PROMPT = `You classify user questions about the Duterte ICC case.

Respond with exactly one of these words: case_facts, case_timeline, legal_concept, procedure, glossary, non_english, out_of_scope

- non_english: Query is primarily in Tagalog, Filipino, or another non-English language (e.g. "Ano yung charges?", "Sino ang akusado?")
- case_facts: "What is Duterte charged with?", "Who are the victims?", "How many counts?", "What are the evidences against Duterte?", "Who are the judges?", "Is Du30 fit to stand trial?", "Who pays for Duterte's defence?", "Where is Duterte detained?", "Did Duterte surrender or was he arrested?", "measures to facilitate attendance"
- case_timeline: "When did the ICC open the investigation?", "What's the timeline?"
- legal_concept: "What is Article 7?", "What are crimes against humanity?"
- procedure: "What happens after confirmation of charges?", "What is the next step in the case?", "Can he be tried in absentia?"
- glossary: "What does in absentia mean?", "What is proprio motu?"
- out_of_scope: "Was Duterte justified?", "What's his favorite color?", "Who is [REDACTED]?"

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
function layer1Deterministic(
  query: string,
  hasPastedText: boolean,
  cleanedQuery: string
): IntentCategory | null {
  if (hasPastedText) return "paste_text";
  if (!cleanedQuery || /^\s*$/.test(cleanedQuery)) return "out_of_scope";
  if (/\[REDACTED\]/i.test(cleanedQuery)) return "out_of_scope";
  // Prompt injection: if full query is an injection attempt with no real question left, out_of_scope
  if (cleanedQuery !== query.trim() && !cleanedQuery) return "out_of_scope";
  return null;
}

// --- Layer 2: Regex patterns (nl-interpretation.md §2.3, §4.1) ---

const TAGALOG_WORDS = /\b(ang|yung|kay|ba|siya|niya|pero|kasi|sino|ano|paano|bakit|talaga|naman|daw|raw|mo)\b/gi;

function layer2Regex(cleanedQuery: string): { intent: IntentCategory; confidence: "high" | "low" } | null {
  const q = cleanedQuery;

  // Tagalog function words (2+ matches) → non_english (§2.2)
  const tagalogMatches = q.match(TAGALOG_WORDS);
  if (tagalogMatches && tagalogMatches.length >= 2) return { intent: "non_english", confidence: "high" };

  // Redaction signals (§4.1)
  if (/\bredacted\b/i.test(q)) return { intent: "out_of_scope", confidence: "high" };
  if (/\bconfidential\s+witness\b/i.test(q)) return { intent: "out_of_scope", confidence: "high" };
  if (/\bunnamed\b.*\b(source|witness|person|individual)\b/i.test(q)) return { intent: "out_of_scope", confidence: "high" };
  if (/\bunnamed\b.*\b(dcc|document)\b/i.test(q)) return { intent: "out_of_scope", confidence: "high" };
  if (/\bsealed\b.*\b(evidence|document|record)\b/i.test(q)) return { intent: "out_of_scope", confidence: "high" };
  if (/\bfigure\s+out\b.*\b(name|who)\b/i.test(q)) return { intent: "out_of_scope", confidence: "high" };
  if (/\bde-?anonymize\b/i.test(q)) return { intent: "out_of_scope", confidence: "high" };
  if (/\bwho\s+is\s+the\s+witness\b.*\b(page|section)\d+/i.test(q)) return { intent: "out_of_scope", confidence: "high" };

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
  if (raw.includes("non english") || raw.includes("non_english")) return "non_english";
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
 * Classify user query into intent category. 4-layer architecture.
 */
export async function classifyIntent(
  query: string,
  hasPastedText: boolean
): Promise<ClassificationResult> {
  // Strip injection prefix before any classification (Task 10.11)
  const cleanedQuery = stripInjectionPrefix(query);

  // Layer 1: Deterministic gates
  const layer1 = layer1Deterministic(query, hasPastedText, cleanedQuery);
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
