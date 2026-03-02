/**
 * Fact-check logic: claim extraction, verification, verdict generation.
 * prompt-spec.md §4b, §6.4.
 * cursor-fact-check-v2-prompt.md — 5-verdict model with opinion/out-of-scope handling.
 */

import type { DetectedLanguage } from "./language-detect";
import type { RetrievalChunk } from "./retrieve";
import { getOpenAIClient } from "./openai-client";
import { logEvent } from "./logger";
import { isProcedurallyImpossible, getProceduralState } from "./procedural-state";
import { enforceAttributionVerification } from "./attribution-verifier";
import { requireAllegationFraming, getSourceAllegationStatus } from "./allegation-distinction";
import { formatVerdictForUser } from "./verdict-tone";
import { deterministicStrip } from "./deterministic-strip";

export type ClaimVerdict =
  | "verified"
  | "false"
  | "unverifiable"
  | "not_in_icc_records"
  | "opinion"
  | "mixed"; // Overall only: some verified, some unverifiable

export interface ExtractedClaim {
  extractedText: string;
  translatedText?: string;
  originalText?: string;
  claimType: "factual_claim" | "opinion" | "out_of_scope";
}

export interface VerifiedClaim {
  extractedText: string;
  translatedText?: string;
  originalText?: string;
  verdict: ClaimVerdict;
  iccSays: string | null;
  citationMarker: string;
  confidence: "high" | "medium" | "low";
  evidenceType: string;
}

export interface FactCheckResult {
  overallVerdict: ClaimVerdict;
  pastedContentPreview: string;
  detectedLanguage: DetectedLanguage;
  claims: VerifiedClaim[];
  copyText: string;
  mode: "fact_check";
  inputPreview: string;
}

/** ICC-related terms that indicate extractable factual content */
const ICC_CLAIM_INDICATORS =
  /\b(count|charges?|davao|warrant|murders?|crimes?\s+against\s+humanity|icc|rome\s+statute|arrest|confirmation\s+of\s+charges|davao\s+death\s+squad|allegation|deferral|complementarity|admissibility|article\s+18|tokhang|oplan|drug\s+war|extrajudicial|bail|adjournment|interim\s+release|surrender)\b/i;

/** Claim extraction system prompt — V2 with stripping and decomposition rules */
const CLAIM_EXTRACTION_SYSTEM = `You extract, decompose, and classify statements from content about the Duterte ICC case.

For each statement in the input, classify it as one of:
- FACTUAL_CLAIM: A verifiable assertion about events, dates, numbers, charges, or procedural status
- OPINION: A value judgment, moral assessment, emotional expression, or prediction
- OUT_OF_SCOPE: Not related to the Duterte ICC case

STRIPPING RULES (apply BEFORE decomposition and classification):
S-1. Strip ALL emotional framing: "Duterte the murderer was convicted" → "Duterte was convicted"
S-2. Strip ALL source attributions: "According to Rappler, 30,000 were killed" → "30,000 were killed"
S-3. Strip ALL epistemic hedges: "reportedly", "allegedly", "in principle", "essentially", "technically", "many say", "it is believed", "perhaps", "some claim" → extract bare assertion. Example: "In principle, Duterte was convicted" → "Duterte was convicted"
S-4. Strip ALL certainty markers: "obviously", "clearly", "undeniably", "it is widely known that" → extract bare assertion
S-5. Strip ALL authority attributions used as credibility boosts: "ICC judges declared that X" → extract "X". The authority attribution is PART of what must be verified, not a reason to believe it.
S-6. Strip ALL embedded comparisons to other leaders/cases: "Like other ICC-convicted leaders, Duterte X" → extract "Duterte X". If entire input is about another case → OUT_OF_SCOPE.
S-7. Resolve double negatives to positive form: "It's not true that he was not charged" → "He was charged". "The ICC didn't fail to issue a warrant" → "The ICC issued a warrant"

DECOMPOSITION RULES (apply AFTER stripping):
D-1. COMMA/AND LISTS: "charged with murder, torture, and rape" → 3 claims: "charged with murder", "charged with torture", "charged with rape"
D-2. SUBORDINATE CLAUSES: "After being convicted, Duterte appealed" → 2 claims: "Duterte was convicted" + "Duterte appealed"
D-3. CONDITIONAL/CAUSAL CHAINS: "Since the ICC found him guilty, the Philippines must extradite him" → 2 claims: "The ICC found Duterte guilty" + "The Philippines must extradite Duterte"
D-4. IMPLICIT PREREQUISITES: "Duterte served part of his sentence" → 2 claims: "Duterte was sentenced" + "Duterte served part of his sentence". The prerequisite (sentencing) must be verified independently.
D-5. TEMPORAL SEQUENCES: "Duterte was arrested, tried, and convicted" → 3 claims preserving order
D-6. EXCLUSIVITY CLAIMS: "only charged with imprisonment" → 2 claims: "charged with imprisonment" + "no other charges exist"

DECOMPOSITION STOPPING RULES (prevent over-splitting):
- Only decompose when BOTH subclaims are independently verifiable against ICC documents
- DO NOT split a legal charge description: "murder as a crime against humanity" = 1 claim (single legal charge)
- DO NOT split date/location modifiers from their event: "warrant issued on March 8, 2023" = 1 claim
- DO NOT split adjective-noun pairs: "three counts of crimes against humanity" = 1 claim
- DO NOT split quantifier from noun: "15 counts" = 1 claim (verify the number against documents)
- Decomposition depth: ONE level only. Do not recursively decompose decomposition products.
- Maximum: 5 claims total per input (CE-1 limit)
- If in doubt, do NOT split — a coarse claim is better than a trivially fragmented one

CLASSIFICATION RULES:
- Guilt/innocence assertions ARE extracted as FACTUAL_CLAIM: "He is guilty" → FACTUAL_CLAIM (will verify procedural status)
- "He is a hero" → OPINION (value judgment)
- "The ICC is biased" → OPINION (evaluative)
- Rhetorical questions ("How dare they?") → OPINION
- Predictions ("He will be convicted") → OPINION
- Drug war operational claims ARE extracted as FACTUAL_CLAIM: "Tokhang killed 30,000" → FACTUAL_CLAIM. "The drug war was state-sponsored" → FACTUAL_CLAIM (verifiable against ICC findings)
- Defence motion claims ARE extracted as FACTUAL_CLAIM: "The Philippines challenged admissibility" → FACTUAL_CLAIM. "The deferral was granted" → FACTUAL_CLAIM
- Preserve specific numbers and dates exactly
- CRITICAL: NEVER return NO_CLAIMS if content mentions charges, counts, warrant, ICC, conviction, guilty, arrest, or any ICC proceeding. Such content ALWAYS contains extractable claims.

Output format — one per line:
FACTUAL_CLAIM: [neutral assertion after stripping and decomposition]
OPINION: [original opinion text]
OUT_OF_SCOPE: [text]

If ZERO factual claims AND ZERO opinions can be extracted, output: NO_CLAIMS`;

/** Deterministic prerequisite detection — inject procedural prerequisites for independent verification */
const PROCEDURAL_PREREQUISITE_PATTERNS: Array<{ pattern: RegExp; prerequisiteClaim: string }> = [
  {
    pattern: /\b(served?|serving|completed?)\b.*\b(sentence|term|imprisonment)\b/i,
    prerequisiteClaim: "Duterte was sentenced by the ICC",
  },
  {
    pattern: /\b(appeal(?:ed|ing)?)\b.*\b(verdict|conviction|sentence|decision)\b/i,
    prerequisiteClaim: "A verdict or sentence was rendered by the ICC",
  },
  {
    pattern: /\b(acquit(?:ted|tal)?|exonerat)/i,
    prerequisiteClaim: "A trial was held and a verdict rendered by the ICC",
  },
  {
    pattern: /\b(pardon(?:ed)?|commut(?:ed|ation))/i,
    prerequisiteClaim: "A sentence was imposed by the ICC",
  },
  {
    pattern: /\b(retri(?:al|ed)|new trial|second trial)/i,
    prerequisiteClaim: "A first trial was completed at the ICC",
  },
];

function injectPrerequisiteClaims(claims: ExtractedClaim[]): ExtractedClaim[] {
  const result: ExtractedClaim[] = [];
  for (const c of claims) {
    if (c.claimType !== "factual_claim") {
      result.push(c);
      continue;
    }
    for (const pp of PROCEDURAL_PREREQUISITE_PATTERNS) {
      if (pp.pattern.test(c.extractedText)) {
        const alreadyPresent = claims.some(
          (existing) =>
            existing.claimType === "factual_claim" &&
            existing.extractedText
              .toLowerCase()
              .includes(pp.prerequisiteClaim.slice(0, 25).toLowerCase())
        );
        if (!alreadyPresent) {
          result.push({ extractedText: pp.prerequisiteClaim, claimType: "factual_claim" });
        }
        break;
      }
    }
    result.push(c);
  }
  return result.slice(0, 5);
}

/** Strip framing patterns before verification — authority attributions and comparisons */
function normalizeClaimForVerification(claim: string): string {
  let c = claim;
  c = c.replace(
    /\b(ICC judges declared|the court confirmed|the prosecutor established|the chamber found|it has been officially stated)\s+that\s+/gi,
    ""
  );
  c = c.replace(
    /\b(like other (leaders?|cases?|defendants?) (convicted|sentenced|charged) by the ICC|similar to the \w+ case),?\s*/gi,
    ""
  );
  c = c.replace(/^[,;:\s]+/, "").replace(/\s{2,}/g, " ").trim();
  if (c.length > 0) c = c.charAt(0).toUpperCase() + c.slice(1);
  return c;
}

/** Detect fabricated ICC filing references not present in retrieved chunks (docket-improvement-plan §12) */
const ICC_REF_PATTERNS = [
  /ICC-\d{2}\/\d{2}-\d{2}\/\d{2}[^\s,.)]*/gi,
  /No\.\s*ICC-[^\s,.)]+/gi,
  /ICC\/\d{2}[-\s]?\d{2}[-\s]?\d{2}[^\s,.)]*/gi,
  /document\s+ICC[-\s]?\d+[^\s,.)]*/gi,
];

function hasFabricatedReference(claim: string, chunks: RetrievalChunk[]): boolean {
  const chunkText = chunks.map((c) => c.content).join(" ");
  for (const p of ICC_REF_PATTERNS) {
    const refs = claim.match(p);
    if (refs?.length && refs.some((ref) => !chunkText.includes(ref))) return true;
  }
  return false;
}

/** Validate parsed verification output — ensure enum and required fields conform */
function validateVerifiedClaim(c: Partial<VerifiedClaim>): VerifiedClaim {
  const validVerdicts: ClaimVerdict[] = ["verified", "false", "unverifiable", "not_in_icc_records", "opinion"];
  return {
    extractedText: c.extractedText ?? "",
    translatedText: c.translatedText,
    originalText: c.originalText,
    verdict: validVerdicts.includes((c.verdict ?? "unverifiable") as ClaimVerdict) ? (c.verdict as ClaimVerdict) : "unverifiable",
    iccSays: c.iccSays ?? "Could not verify from retrieved ICC documents.",
    citationMarker: c.citationMarker ?? "",
    confidence: (["high", "medium", "low"] as const).includes(c.confidence as "high" | "medium" | "low")
      ? (c.confidence as "high" | "medium" | "low")
      : "low",
    evidenceType: c.evidenceType ?? "case_fact",
  };
}

/** Fact-check generation prompt — 5-verdict model, JSON output */
function buildFactCheckPrompt(
  claims: ExtractedClaim[],
  chunks: RetrievalChunk[],
  responseLanguage: string
): string {
  const chunksSection = chunks
    .map((c, i) => {
      const docType = c.metadata.document_type ?? "ICC document";
      const transcriptNote =
        docType === "transcript"
          ? `\n[NOTE: TRANSCRIPT — content is testimony/argument, NOT a court ruling]`
          : "";
      return `[${i + 1}] Source: ${c.metadata.document_title ?? "Unknown"}, ${c.metadata.date_published ?? "n.d."} — ${docType}${transcriptNote}\n${c.content}`;
    })
    .join("\n\n");

  const claimsList = claims.map((c, i) => `${i + 1}. "${c.extractedText}"`).join("\n");

  const langNote =
    responseLanguage === "tl"
      ? "Respond in full Tagalog. Keep ICC legal terms in English with Filipino explanation in parentheses on first use. [REDACTED] never translated."
      : responseLanguage === "taglish"
        ? "Respond in natural Tanglish (Tagalog-English code-switching). ICC terms stay in English."
        : "Respond in plain English.";

  return `You are a neutral fact-checker for The Docket. Verify the following claims ONLY against the ICC documents provided below.

CRITICAL RULES:
1. If the ICC DOCUMENTS section below is empty, respond with verdict UNVERIFIABLE for every claim.
2. Use ONLY the ICC documents provided below. NEVER use your training data, general knowledge, or assumptions. If a fact is not in the provided documents, it does not exist for this task.
3. If the ICC documents state a DIFFERENT number, date, charge, or fact than what the claim asserts, the verdict is FALSE — not UNVERIFIABLE.

VERDICT DEFINITIONS (5 verdicts only — use no others):
- VERIFIED: claim directly supported by the ICC documents below
- FALSE: claim directly contradicts the ICC documents below (including procedural impossibility and partial truths that misstate what documents say)
- UNVERIFIABLE: the ICC documents below contain NO relevant information about this topic at all
- NOT_IN_ICC_RECORDS: claim references specific facts, numbers, filing references, or hearing dates that do not appear in any document below

FALSE vs UNVERIFIABLE — THE CRITICAL DISTINCTION:
Use FALSE when documents CONTRADICT the claim (documents say something different):
- Claim: "15 counts" + Documents say "3 counts" → FALSE
- Claim: "sentenced to life" + Documents show case is at pre-trial → FALSE (procedural impossibility)
- Claim: "convicted" + Documents show confirmation stage → FALSE (later stage not yet reached)
- Claim: "charged with genocide" + Documents say "crimes against humanity" → FALSE
- Claim: "30,000 killed" + Documents say a different number → FALSE

Use UNVERIFIABLE when documents are SILENT (no information at all):
- Claim: "met witness X on date Y" + Documents say nothing about any meeting → UNVERIFIABLE
- Claim: "30,000 killed" + Documents mention no numbers on this topic → UNVERIFIABLE

PROCEDURAL STAGE REFERENCE:
ICC cases follow this sequence: preliminary examination → investigation → arrest warrant → surrender/arrest → confirmation of charges → trial → verdict → sentencing → appeal.
Interlocutory appeals (e.g., Article 18 admissibility challenges, jurisdictional objections) can occur DURING the investigation or pre-trial phases — they do NOT follow the linear sequence above. A deferral request or admissibility challenge is a procedural event within a phase, not a separate phase. If a claim asserts that a deferral was "granted" or "upheld" but the documents show it was rejected, the verdict is FALSE.
Determine the CURRENT stage from the documents below. If a claim asserts that an event from a LATER stage has occurred, the verdict is FALSE — the procedural sequence means it cannot have happened yet.
Example: If documents show the case is at "confirmation of charges," then claims about trial, conviction, sentencing, or appeal are all FALSE.

COMPLETENESS AND EXCLUSIVITY:
- Claims with "only", "solely", "just": verify that the stated item EXISTS in documents AND that NO OTHER items exist. If other items exist → FALSE.
- Claims with "all", "every", "none": verify completeness against the full set in documents. "All charges confirmed" requires checking every individual charge.
- Claims with specific article numbers, evidentiary standards, or legal terms: compare EXACTLY against documents. Wrong article number → FALSE. Wrong legal classification (e.g., "war crime" instead of "crime against humanity") → FALSE.

IMPLICIT PREREQUISITES:
If a claim presupposes a prior procedural event ("served sentence" presupposes sentencing, "appealed the verdict" presupposes a verdict), and the documents show that prior event has NOT occurred, the claim is FALSE.

GUILT/INNOCENCE CLAIMS:
- If a claim asserts guilt or conviction: verify procedural status ONLY
- NEVER say "he is not guilty" or "he is not innocent"
- ONLY state: "No verdict has been rendered" / "The case is at [stage]"

GROUNDING:
- ONLY cite facts from the ICC DOCUMENTS section below
- Do NOT introduce facts from your training data — no charges, dates, names, or numbers that don't appear in the documents below
- If you are unsure whether a detail is in the documents, re-read them before answering
- When the user's claim contains a specific number (e.g., "30,000 were killed"), compare it against numbers in retrieved chunks. If the documents state a different number, cite the discrepancy in icc_says and use verdict FALSE. Do not silently omit the comparison.

TRANSCRIPT vs. RULING DISTINCTION:
Some ICC documents below are hearing transcripts (marked "— transcript" in source header). Transcript content represents:
- What a prosecutor ARGUED (not what the court ruled)
- What a defense counsel CLAIMED (not what the court found)
- What a witness TESTIFIED (not established ICC fact)
- What a judge SAID in a hearing (can be authoritative if it is a ruling or order)

When verifying claims using transcript sources:
- If the only supporting chunks are transcripts, the claim may still be VERIFIED, but your icc_says field MUST note: "Based on [party]'s testimony/argument in the hearing — not a court ruling."
- If a claim asserts a court RULING or FINDING but the only source is transcript testimony (not a decision or order), use UNVERIFIABLE with icc_says: "This was argued/stated in a hearing, but no court ruling confirming this was found in retrieved documents."
- If a decision/order document contradicts what was stated in a transcript, the decision/order governs — use FALSE.
- Never treat what a party argued in a transcript as equivalent to what the court decided.

${langNote}

ICC DOCUMENTS:
${chunksSection}

---
CLAIMS TO VERIFY:
${claimsList}

---
Respond in valid JSON format with per-claim verdicts only. Do NOT include an overall verdict — it is computed automatically.

{
  "claims": [
    {
      "claim_text": "[the claim]",
      "verdict": "VERIFIED|FALSE|UNVERIFIABLE|NOT_IN_ICC_RECORDS",
      "icc_says": "[what ICC documents state — one or two sentences. For FALSE verdicts, state what the documents actually say. For UNVERIFIABLE, state that documents contain no information on this topic.]",
      "citation_markers": ["[1]"],
      "evidence_type": "procedural_status|case_fact|legal_framework|timeline|numerical|transcript_testimony"
    }
  ],
  "citations": [
    {
      "marker": "[1]",
      "document_title": "[title from document metadata]",
      "date": "[date from document metadata]"
    }
  ]
}

IMPORTANT: Output ONLY valid JSON. No text before or after the JSON object.`;
}

/** Verdict aggregation (docket-improvement-plan §14). Mixed when some verified, some unverifiable. */
function computeOverallVerdict(claims: VerifiedClaim[]): ClaimVerdict {
  const verdicts = claims.map((c) => c.verdict);
  const factualVerdicts = verdicts.filter((v) => v !== "opinion");

  if (factualVerdicts.length === 0) return "opinion";
  if (factualVerdicts.includes("false")) return "false";
  if (factualVerdicts.includes("not_in_icc_records") && !factualVerdicts.includes("false"))
    return "not_in_icc_records";
  if (factualVerdicts.every((v) => v === "verified")) return "verified";
  const verifiedCount = factualVerdicts.filter((v) => v === "verified").length;
  const unverifiableCount = factualVerdicts.filter((v) => v === "unverifiable").length;
  if (verifiedCount > 0 && unverifiableCount > 0) return "mixed";
  if (verifiedCount > 0) return "verified";
  return "unverifiable";
}

/** Normalize LLM verdict strings to the strict 5-value enum */
function normalizeVerdict(v: string): ClaimVerdict {
  const normalized = v.toLowerCase().replace(/\s+/g, "_");
  if (normalized === "accurate") return "verified";
  if (normalized === "misleading") return "false";
  if (normalized === "partially_verified") return "unverifiable";
  if (normalized === "out_of_scope") return "opinion";
  const valid: ClaimVerdict[] = ["verified", "false", "unverifiable", "not_in_icc_records", "opinion", "mixed"];
  return valid.includes(normalized as ClaimVerdict) ? (normalized as ClaimVerdict) : "unverifiable";
}

/**
 * Extract and classify claims from pasted content.
 */
/** D1: Decompose comma/and lists (e.g. "charged with X, Y, and Z" → 3 claims) */
function decomposeCommaList(claim: ExtractedClaim): ExtractedClaim[] {
  if (claim.claimType !== "factual_claim") return [claim];
  const listMatch = claim.extractedText.match(/^((?:charged with|accused of|including)\s+)(.+)$/i);
  if (!listMatch) return [claim];
  const prefix = listMatch[1];
  const items = listMatch[2].split(/\s*,\s*|\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  if (items.length < 2) return [claim];
  return items.map((item) => ({ ...claim, extractedText: `${prefix}${item}` }));
}

const SUBORDINATE_PATTERNS = [
  /^(after|before|when|once|upon)\s+(.{15,}?),\s+(.{15,})$/i,
  /^(.{15,}?)\s+(after|before|when|once)\s+(.{15,})$/i,
];

function decomposeSubordinate(claim: ExtractedClaim): ExtractedClaim[] {
  if (claim.claimType !== "factual_claim") return [claim];
  for (const p of SUBORDINATE_PATTERNS) {
    const m = claim.extractedText.match(p);
    if (m) {
      let parts: string[];
      if (/^(after|before|when|once|upon)$/i.test(m[1] ?? "")) {
        parts = [(m[2] ?? "").trim(), (m[3] ?? "").trim()];
      } else {
        parts = [(m[1] ?? "").trim(), (m[3] ?? "").trim()];
      }
      const valid = parts.filter((s) => s.length >= 15);
      if (valid.length === 2) {
        return valid.map((t) => ({ ...claim, extractedText: t.charAt(0).toUpperCase() + t.slice(1) }));
      }
    }
  }
  return [claim];
}

const CAUSAL_CHAIN_PATTERNS = [
  /^(since|because|as)\s+(.{15,}?),\s+(.{15,})$/i,
  /^(.{15,}?)\s+(so|therefore|thus|hence)\s+(.{15,})$/i,
];

function decomposeCausalChain(claim: ExtractedClaim): ExtractedClaim[] {
  if (claim.claimType !== "factual_claim") return [claim];
  for (const p of CAUSAL_CHAIN_PATTERNS) {
    const m = claim.extractedText.match(p);
    if (m) {
      let parts: string[];
      if (m[1]?.match(/^(since|because|as)$/i)) {
        parts = [m[2]?.trim() ?? "", m[3]?.trim() ?? ""];
      } else {
        parts = [m[1]?.trim() ?? "", m[3]?.trim() ?? ""];
      }
      if (parts.filter((s) => s.length >= 15).length === 2) {
        return parts.map((t) => ({ ...claim, extractedText: t.charAt(0).toUpperCase() + t.slice(1) }));
      }
    }
  }
  return [claim];
}

/** Hypothetical/prediction → OPINION (if/when X happens) */
const HYPOTHETICAL_PATTERN = /^(if|when|once)\s+.+\s+(happens?|occurs?|begins?|starts?|will)/i;
function isHypotheticalClaim(text: string): boolean {
  return HYPOTHETICAL_PATTERN.test(text) || /\b(will be|would be)\s+(convicted|sentenced|acquitted)\b/i.test(text);
}

export async function extractClaims(pastedText: string): Promise<ExtractedClaim[]> {
  let text = (pastedText || "").trim().slice(0, 3000);
  if (!text) return [];

  text = deterministicStrip(text);

  const userMessage = `Pasted content to extract claims from:

"""
${text}
"""

Extract and classify statements from the content above.`;

  try {
    const openai = getOpenAIClient();
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: CLAIM_EXTRACTION_SYSTEM },
        { role: "user", content: userMessage },
      ],
      max_tokens: 512,
      temperature: 0,
    });

    const raw = res.choices[0]?.message?.content?.trim() ?? "";
    if (raw.toUpperCase().includes("NO_CLAIMS")) {
      if (ICC_CLAIM_INDICATORS.test(text)) {
        const fallback = text
          .split(/[.!?]/)
          .map((s) => s.trim())
          .find((s) => s.length > 30 && ICC_CLAIM_INDICATORS.test(s));
        if (fallback) {
          logEvent("fact_check.extract", "info", { claims_count: 1, reason: "fallback_after_no_claims" });
          return [{ extractedText: fallback.slice(0, 300), claimType: "factual_claim" }];
        }
      }
      logEvent("fact_check.extract", "info", { claims_count: 0, reason: "no_claims" });
      return [];
    }

    const claims: ExtractedClaim[] = [];
    const lines = raw.split(/\n/).filter((l) => l.trim());
    for (const line of lines) {
      const factualMatch = line.match(/^FACTUAL_CLAIM:\s*(.+)/i);
      const opinionMatch = line.match(/^OPINION:\s*(.+)/i);
      const oosMatch = line.match(/^OUT_OF_SCOPE:\s*(.+)/i);

      if (factualMatch) {
        const extracted = factualMatch[1].trim();
        if (isHypotheticalClaim(extracted)) {
          claims.push({ extractedText: extracted, claimType: "opinion" });
        } else {
          claims.push({ extractedText: extracted, claimType: "factual_claim" });
        }
      } else if (opinionMatch) {
        claims.push({ extractedText: opinionMatch[1].trim(), claimType: "opinion" });
      } else if (oosMatch) {
        claims.push({ extractedText: oosMatch[1].trim(), claimType: "out_of_scope" });
      } else {
        const numbered = line.match(/^\d+\.\s*["']?(.+?)["']?\s*$/);
        if (numbered) {
          claims.push({ extractedText: numbered[1].trim(), claimType: "factual_claim" });
        }
      }
    }

    let result = claims
      .flatMap(decomposeCommaList)
      .flatMap(decomposeSubordinate)
      .flatMap(decomposeCausalChain)
      .slice(0, 5);

    if (result.length === 0 && ICC_CLAIM_INDICATORS.test(text)) {
      const fallback = text
        .split(/[.!?]/)
        .map((s) => s.trim())
        .find((s) => s.length > 30 && ICC_CLAIM_INDICATORS.test(s));
      if (fallback) {
        result = [{ extractedText: fallback.slice(0, 300), claimType: "factual_claim" }];
        logEvent("fact_check.extract", "info", { claims_count: 1, reason: "fallback_icc_indicators" });
      }
    }

    logEvent("fact_check.extract", "info", { claims_count: result.length });
    return result;
  } catch (err) {
    logEvent("fact_check.extract_failure", "warn", { error_message: String(err) });
    const text = (pastedText || "").trim().slice(0, 3000);
    if (ICC_CLAIM_INDICATORS.test(text)) {
      const fallback = text.split(/[.!?]/).map((s) => s.trim()).find((s) => s.length > 30 && ICC_CLAIM_INDICATORS.test(s));
      if (fallback) return [{ extractedText: fallback.slice(0, 300), claimType: "factual_claim" }];
    }
    return [];
  }
}

/**
 * Generate fact-check response: answer text + structured FactCheckResult.
 */
export async function generateFactCheckResponse(
  claims: ExtractedClaim[],
  chunks: RetrievalChunk[],
  pastedContentPreview: string,
  detectedLanguage: DetectedLanguage,
  responseLanguage: string
): Promise<{ answer: string; factCheck: FactCheckResult }> {
  const factualClaims = claims.filter((c) => c.claimType === "factual_claim");
  const opinionClaims = claims.filter((c) => c.claimType === "opinion");
  const oosClaims = claims.filter((c) => c.claimType === "out_of_scope");

  const opinionVerified: VerifiedClaim[] = opinionClaims.map((c) => ({
    extractedText: c.extractedText,
    originalText: c.originalText,
    verdict: "opinion" as ClaimVerdict,
    iccSays: null,
    citationMarker: "",
    confidence: "high" as const,
    evidenceType: "opinion",
  }));

  const oosVerified: VerifiedClaim[] = oosClaims.map((c) => ({
    extractedText: c.extractedText,
    originalText: c.originalText,
    verdict: "opinion" as ClaimVerdict,
    iccSays: null,
    citationMarker: "",
    confidence: "high" as const,
    evidenceType: "out_of_scope",
  }));

  let verifiedClaims: VerifiedClaim[] = [...opinionVerified, ...oosVerified];

  if (factualClaims.length > 0 && chunks.length > 0) {
    const withPrerequisites = injectPrerequisiteClaims(factualClaims);
    const normalizedClaims = withPrerequisites.map((c) => ({
      ...c,
      extractedText: normalizeClaimForVerification(c.extractedText),
    }));

    const prompt = buildFactCheckPrompt(normalizedClaims, chunks, responseLanguage);
    const openai = getOpenAIClient();

    const FACTCHECK_MODEL = process.env.FACTCHECK_MODEL ?? "gpt-4o";
    const res = await openai.chat.completions.create({
      model: FACTCHECK_MODEL,
      messages: [
        { role: "system", content: "You are a neutral fact-checker. Respond ONLY in valid JSON format." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1500,
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const rawAnswer = res.choices[0]?.message?.content?.trim() ?? "";

    const factualVerified: VerifiedClaim[] = [];
    let parseSucceeded = false;
    try {
      const jsonStr = rawAnswer.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      const parsed = JSON.parse(jsonStr);

      if (parsed.claims && Array.isArray(parsed.claims)) {
        for (const pc of parsed.claims) {
          factualVerified.push(
            validateVerifiedClaim({
              extractedText: pc.claim_text ?? "",
              verdict: normalizeVerdict(pc.verdict ?? "unverifiable"),
              iccSays: (pc.icc_says ?? "").trim(),
              citationMarker: Array.isArray(pc.citation_markers) ? pc.citation_markers.join(", ") : "",
              confidence: "high",
              evidenceType: pc.evidence_type ?? "case_fact",
            })
          );
        }
        parseSucceeded = factualVerified.length > 0;
      }
    } catch {
      logEvent("fact_check.json_parse_failure", "warn", { raw_length: rawAnswer.length });
    }

    const qualityGate =
      factualVerified.length > 0 &&
      factualVerified.every((c) => c.verdict === "unverifiable") &&
      chunks.length >= 2;

    if (!parseSucceeded || qualityGate) {
      if (!parseSucceeded) {
        logEvent("fact_check.fallback_regex", "warn", { reason: "json_parse_failed" });
      } else {
        logEvent("fact_check.fallback_regex", "warn", { reason: "all_unverifiable_quality_gate" });
        factualVerified.length = 0;
      }

      const claimRegex =
        /\d+\.\s*"([^"]+)"\s*[—–-]\s*(VERIFIED|FALSE|MISLEADING|UNVERIFIABLE|NOT_IN_ICC_RECORDS)\.\s*ICC documents state:\s*([^[\]]+?)\.\s*\[?(\d+)\]?/gi;
      let m;
      while ((m = claimRegex.exec(rawAnswer)) !== null) {
        factualVerified.push(
          validateVerifiedClaim({
            extractedText: m[1],
            verdict: normalizeVerdict(m[2]),
            iccSays: m[3].trim(),
            citationMarker: `[${m[4]}]`,
            confidence: "high",
            evidenceType: "case_fact",
          })
        );
      }
    }

    const procState = getProceduralState();
    for (const fv of factualVerified) {
      if (hasFabricatedReference(fv.extractedText, chunks) && fv.verdict !== "false") {
        fv.verdict = "not_in_icc_records";
        fv.iccSays = "This filing reference does not appear in retrieved ICC documents.";
      } else {
        const procCheck = isProcedurallyImpossible(fv.extractedText, procState);
        if (procCheck.impossible && procCheck.claimedStage) {
          fv.verdict = "false";
          fv.iccSays = `The case is at ${procState.currentStage}. ${procCheck.claimedStage?.replace(/_/g, " ")} has not occurred.`;
        }
      }
      fv.verdict = enforceAttributionVerification(
        fv.extractedText,
        fv.verdict,
        fv.citationMarker,
        chunks
      ) as ClaimVerdict;
      if (fv.verdict === "verified" && fv.citationMarker && fv.iccSays) {
        const citedNums = [...fv.citationMarker.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10));
        for (const idx of citedNums) {
          if (idx >= 1 && idx <= chunks.length) {
            const chunk = chunks[idx - 1];
            if (getSourceAllegationStatus(chunk) === "allegation") {
              fv.iccSays = requireAllegationFraming(fv.iccSays, chunk);
              break; // Apply framing once from first allegation-type chunk
            }
          }
        }
      }
    }

    if (factualVerified.length === 0) {
      for (const c of factualClaims) {
        factualVerified.push(
          validateVerifiedClaim({
            extractedText: c.extractedText,
            originalText: c.originalText,
            verdict: "unverifiable" as ClaimVerdict,
            iccSays: "Could not verify from retrieved ICC documents.",
            citationMarker: "",
            confidence: "low" as const,
            evidenceType: "case_fact",
          })
        );
      }
    }

    verifiedClaims = [...opinionVerified, ...oosVerified, ...factualVerified];
  }

  const overallVerdict = computeOverallVerdict(verifiedClaims);
  const preview = pastedContentPreview.slice(0, 100) + (pastedContentPreview.length > 100 ? "…" : "");

  const factCheck: FactCheckResult = {
    overallVerdict,
    pastedContentPreview: preview,
    detectedLanguage,
    claims: verifiedClaims,
    copyText: "",
    mode: "fact_check",
    inputPreview: preview,
  };

  factCheck.copyText = formatCopyText(factCheck);

  const verdictLabel =
    overallVerdict === "mixed"
      ? "MIXED (some claims verified, others could not be verified from ICC documents)"
      : overallVerdict.toUpperCase().replace(/_/g, " ");
  let answer = `VERDICT: ${verdictLabel}\n\n`;
  for (const c of verifiedClaims) {
    if (c.verdict === "opinion" && c.evidenceType === "out_of_scope") {
      answer += `• "${c.extractedText}" — OUT OF SCOPE. Outside the Duterte ICC case.\n`;
    } else if (c.verdict === "opinion") {
      answer += `• "${c.extractedText}" — ${formatVerdictForUser("opinion", null)}\n`;
    } else {
      const phrased = formatVerdictForUser(c.verdict, c.iccSays);
      const cite = c.citationMarker?.trim();
      answer += `• "${c.extractedText}" — ${phrased}${cite ? ` ${cite}` : ""}\n`;
    }
  }
  answer += `\nLast updated from ICC records: ${new Date().toISOString().slice(0, 10)}`;

  return { answer, factCheck };
}

/**
 * Format copy-text for sharing (prompt-spec.md §6.4).
 */
export function formatCopyText(factCheck: FactCheckResult): string {
  const verdict =
    factCheck.overallVerdict === "mixed"
      ? "MIXED (some verified, some unverifiable)"
      : factCheck.overallVerdict.toUpperCase().replace(/_/g, " ");
  const preview = factCheck.pastedContentPreview;

  const lines: string[] = [
    `📋 FACT-CHECK: ${verdict}`,
    "",
    `Content checked: "${preview}"`,
    "",
    "Key findings:",
  ];

  for (const c of factCheck.claims) {
    if (c.verdict === "opinion" && c.evidenceType === "out_of_scope") {
      lines.push(`• "${c.extractedText}" — OUT OF SCOPE. Outside the Duterte ICC case.`);
    } else if (c.verdict === "opinion") {
      lines.push(`• "${c.extractedText}" — ${formatVerdictForUser("opinion", null)}`);
    } else {
      const phrased = formatVerdictForUser(c.verdict, c.iccSays);
      lines.push(`• "${c.extractedText}" — ${phrased}`);
    }
  }

  lines.push("", "Sources: ICC official documents (icc-cpi.int)");
  lines.push("Verified by The Docket — not legal advice.");

  return lines.join("\n");
}
