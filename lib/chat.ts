/**
 * Chat pipeline: intent → RAG → LLM → parsed response.
 * prompt-spec.md, Task Group 5.
 */

import type OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { getOpenAIClient } from "./openai-client";
import { classifyIntent } from "./intent-classifier";
import { intentToRagIndexes } from "./intent";
import { retrieve, evidenceSufficiency, type RetrievalChunk } from "./retrieve";
import { buildSystemPrompt, buildJudgeUserMessage, JUDGE_SYSTEM_PROMPT } from "./prompts";
import { verifyEnumeratedClaims } from "./claim-verifier";
import { logEvent } from "./logger";
import { detectLanguage } from "./language-detect";
import { translateToEnglish } from "./translate";
import { detectPasteType } from "./paste-detect";
import {
  extractClaims,
  generateFactCheckResponse,
  formatCopyText,
  type ClaimVerdict,
  type FactCheckResult,
  type VerifiedClaim,
} from "./fact-check";
import { sanitizeHistoryForContamination } from "./contamination-guard";
import { isNormativeQuery, NORMATIVE_REFUSAL_MESSAGE } from "./normative-filter";

const MAX_ANSWER_TOKENS = 1024;
const MAX_JUDGE_TOKENS = 256;
const FALLBACK_BLOCKED =
  "This answer could not be verified against ICC documents. Try rephrasing your question or asking about a different aspect of the case.";

export interface Citation {
  marker: string;
  document_title: string;
  date_published: string;
  url: string;
  source_passage: string;
  trusted: boolean;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  warning: string | null;
  verified: boolean;
  knowledge_base_last_updated: string;
  retrievalConfidence?: "high" | "medium" | "low";
  claimsVerified?: boolean;
  claimsStripped?: number;
  factCheck?: FactCheckResult;
  detectedLanguage?: string;
  translatedQuery?: string;
  responseLanguage?: string;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !key) throw new Error("Missing Supabase env");
  return createClient(url, key);
}

/** Get most recent knowledge base update from icc_documents. */
async function getKnowledgeBaseLastUpdated(): Promise<string> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("icc_documents")
    .select("last_crawled_at")
    .order("last_crawled_at", { ascending: false })
    .limit(1)
    .single();

  const date = data?.last_crawled_at;
  if (!date) return new Date().toISOString().slice(0, 10);
  return new Date(date).toISOString().slice(0, 10);
}

function extractKeyTerms(sentence: string): string[] {
  const terms: string[] = [];
  const words = sentence.split(/\s+/);
  for (const w of words) {
    const clean = w.replace(/[^\w]/g, "");
    if (!clean || clean.length < 3) continue;
    if (
      /^(the|and|for|are|was|were|has|have|had|with|this|that|from|but|not|his|her|its|they|them|been|will|would|could|should|into|also)$/i.test(
        clean
      )
    )
      continue;
    terms.push(clean.toLowerCase());
  }
  return terms.slice(0, 8);
}

/** Extract [N] markers and map to source passages from chunks. */
function extractCitations(
  answer: string,
  chunks: RetrievalChunk[]
): Citation[] {
  const markerRegex = /\[(\d+)\]/g;
  const seen = new Set<number>();
  const citations: Citation[] = [];

  let m;
  while ((m = markerRegex.exec(answer)) !== null) {
    const n = parseInt(m[1], 10);
    if (seen.has(n) || n < 1 || n > chunks.length) continue;
    seen.add(n);
    const chunk = chunks[n - 1];
    citations.push({
      marker: `[${n}]`,
      document_title: chunk.metadata.document_title ?? "Unknown",
      date_published: chunk.metadata.date_published ?? "n.d.",
      url: chunk.metadata.url ?? "",
      source_passage: chunk.content.slice(0, 500),
      trusted: true, // validated below
    });
  }

  return citations.sort((a, b) => parseInt(a.marker, 10) - parseInt(b.marker, 10));
}

function validateCitationIntegrity(
  citations: Citation[],
  answer: string,
  chunks: RetrievalChunk[]
): Citation[] {
  const sentences = answer.split(/(?<=[.!?])\s+/);

  return citations.map((cit) => {
    const markerIndex = parseInt(cit.marker.replace(/[\[\]]/g, ""), 10) - 1;
    if (markerIndex < 0 || markerIndex >= chunks.length) {
      return { ...cit, trusted: false };
    }

    const citSentence = sentences.find((s) => s.includes(cit.marker)) ?? "";
    if (!citSentence) return { ...cit, trusted: true };

    const keyTerms = extractKeyTerms(citSentence.replace(/\[\d+\]/g, ""));
    if (keyTerms.length === 0) return { ...cit, trusted: true };

    const chunkLower = chunks[markerIndex].content.toLowerCase();
    const matches = keyTerms.filter((t) => chunkLower.includes(t));
    const overlap = matches.length / keyTerms.length;

    return { ...cit, trusted: overlap >= 0.4 };
  });
}

function askedAboutProsecutionOrDefence(query: string): boolean {
  return /\b(prosecution|defence|defense)\s+(argue|say|present|claim|state)|(what)\s+(did|were)\s+(the\s+)?(prosecution|defence|defense)\b/i.test(query);
}

/** Call LLM-as-Judge to verify answer against retrieved chunks. */
async function judgeAnswer(
  rawAnswer: string,
  chunks: RetrievalChunk[],
  openai: OpenAI,
  extraContext?: string,
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>
): Promise<{ verdict: "APPROVE" | "REJECT"; reason: string }> {
  const userMessage = buildJudgeUserMessage(rawAnswer, chunks, extraContext, conversationHistory);
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    max_tokens: MAX_JUDGE_TOKENS,
  });

  const raw = res.choices[0]?.message?.content?.trim() ?? "";
  const firstLine = raw.split("\n")[0].trim().toUpperCase();
  const verdict: "APPROVE" | "REJECT" = firstLine.startsWith("APPROVE") ? "APPROVE" : "REJECT";
  const reason =
    raw
      .replace(/^(APPROVE|REJECT)\s*/i, "")
      .replace(/^Reason:\s*/i, "")
      .trim() || "No reason provided";

  logEvent("judge.verdict", verdict === "REJECT" ? "warn" : "info", { verdict, reason });
  return { verdict, reason };
}

function checkForHallucinatedNumbers(answer: string, chunks: RetrievalChunk[]): string[] {
  const answerNumbers = [...new Set((answer.match(/\b\d+\b/g) ?? []))];
  const chunkText = chunks.map((c) => c.content).join(" ");
  const chunkNumbers = new Set(chunkText.match(/\b\d+\b/g) ?? []);

  const suspicious = answerNumbers.filter((n) => {
    if (chunkNumbers.has(n)) return false;
    const num = parseInt(n, 10);
    if (num < 2 || (num >= 2020 && num <= 2030)) return false;
    return true;
  });

  return suspicious;
}

/** Parse LLM response into ChatResponse contract. */
function parseResponse(
  rawAnswer: string,
  chunks: RetrievalChunk[],
  pasteTextMatched: boolean,
  knowledgeBaseLastUpdated: string,
  isPasteTextQuery: boolean,
  retrievalConfidence?: "high" | "medium" | "low",
  claimsVerified?: boolean,
  claimsStripped?: number
): ChatResponse {
  const rawCitations = extractCitations(rawAnswer, chunks);
  const citations = validateCitationIntegrity(rawCitations, rawAnswer, chunks);

  let warning: string | null =
    isPasteTextQuery && !pasteTextMatched
      ? "⚠ This text could not be verified against ingested ICC documents. The response may not be reliable."
      : null;
  if (retrievalConfidence === "low" && !warning) {
    warning =
      "⚠ This answer is based on limited matches in ICC records and may not fully address your question.";
  }

  return {
    answer: rawAnswer,
    citations,
    warning,
    retrievalConfidence: retrievalConfidence ?? undefined,
    verified: true,
    knowledge_base_last_updated: knowledgeBaseLastUpdated,
    claimsVerified,
    claimsStripped,
  };
}

export interface ChatOptions {
  query: string;
  pastedText?: string;
  conversationId?: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  responseLanguage?: "en" | "tl" | "taglish";
}

/** Multi-intent: "Tell me about Count 2. Also, was the drug war justified?" (nl-interpretation §5.9 NL-47) */
const OUT_OF_SCOPE_SIGNALS =
  /\b(justified|biased|favorite|compare|think about|opinion|speculation|political)\b|(\bwas\b.*\bright\b)|(\bdo\s+you\s+think\b)/i;

const REDACTION_CONTENT = /\[REDACTED\]|redacted|confidential\s+witness|de-?anonymize/i;
const REDACTION_RESPONSE_TEXT = "This content is redacted in ICC records";

/** Prohibited terms: guilt/innocence — block before Judge. Catches line-start and mid-sentence. */
const PROHIBITED_TERMS =
  /\b(guilty|innocent|not guilty|not innocent|convicted|acquitted)\s+(of|as|for)\b|^\s*(he|duterte|du30)\s+(is|was)\s+(guilty|innocent|convicted|acquitted)\b|\b(he|duterte|du30)\s+(is|was)\s+(guilty|innocent|convicted|acquitted)\b/i;

function sanitizeHistory(
  history: Array<{ role: "user" | "assistant"; content: string }>
): Array<{ role: "user" | "assistant"; content: string }> {
  let result = sanitizeHistoryForContamination(history);
  result = result.map((msg) => {
    if (REDACTION_CONTENT.test(msg.content) || msg.content.includes(REDACTION_RESPONSE_TEXT)) {
      return { role: msg.role, content: "[Prior exchange about redacted content — omitted]" };
    }
    return msg;
  });
  return result;
}

function hasProhibitedTerms(text: string): boolean {
  return PROHIBITED_TERMS.test(text);
}

/** Fact-check answers quote claims; refutations (FALSE) and opinions are OK. Don't block those. */
function hasProhibitedTermsInFactCheckAnswer(answer: string): boolean {
  if (!PROHIBITED_TERMS.test(answer)) return false;
  const lines = answer.split(/\n/);
  for (const line of lines) {
    if (!PROHIBITED_TERMS.test(line)) continue;
    const isRefutation =
      /indicate otherwise|has not occurred|—\s*(FALSE|false)\b/i.test(line) ||
      /case is at|confirmation of charges/i.test(line);
    const isOpinionLabel =
      /—\s*(This is an opinion|OPINION|not a verifiable)/i.test(line) ||
      /opinion,?\s*not a verifiable/i.test(line);
    const isUnverifiable =
      /—\s*(UNVERIFIABLE|ICC documents do not contain)/i.test(line) ||
      /do not contain information on this topic/i.test(line);
    if (isRefutation || isOpinionLabel || isUnverifiable) continue; // Quoted claim; we're not asserting it
    return true; // Prohibited term in non-refutation, non-opinion context
  }
  return false;
}

function splitMultiIntent(query: string): { validQuery: string; hasInvalidPart: boolean } | null {
  const split = query.split(/\s*[.!?]\s+(?:Also|And|,)\s+/i);
  if (split.length < 2) return null;
  const first = split[0].trim();
  const second = split.slice(1).join(". ").trim();
  if (!first || !second) return null;
  if (!OUT_OF_SCOPE_SIGNALS.test(second)) return null;
  return { validQuery: first, hasInvalidPart: true };
}

export async function chat(opts: ChatOptions): Promise<ChatResponse> {
  const { query, pastedText, conversationHistory = [], responseLanguage = "en" } = opts;

  // Multi-intent: answer valid part, append flat decline for invalid part (Task 10.14)
  const multiIntent = splitMultiIntent(query);
  let effectiveQuery = multiIntent?.validQuery ?? query;
  let originalQuery: string | undefined;

  // Step 0: Language Detection
  const langResult = detectLanguage(effectiveQuery);

  let effectivePastedText = pastedText;

  // Step 1: Translation (if Filipino detected)
  if (langResult.language === "tl" || langResult.language === "taglish") {
    const translation = await translateToEnglish(effectiveQuery);
    if (translation.success) {
      effectiveQuery = translation.translatedText;
      originalQuery = opts.query;
    }
    // Also translate pastedText if present and in Filipino
    if (pastedText) {
      const pastedLang = detectLanguage(pastedText);
      if (pastedLang.language === "tl" || pastedLang.language === "taglish") {
        const pastedTranslation = await translateToEnglish(pastedText);
        if (pastedTranslation.success) {
          effectivePastedText = pastedTranslation.translatedText;
        }
      }
    }
  }

  // Step 2: Paste Auto-Detection (if pasted text exists)
  let pasteType: "icc_document" | "social_media" | undefined;
  if (effectivePastedText) {
    const pasteResult = await detectPasteType(effectivePastedText, effectiveQuery);
    pasteType = pasteResult.pasteType;
  }

  // "other" language decline
  if (langResult.language === "other") {
    const kbDate = await getKnowledgeBaseLastUpdated();
    return {
      answer:
        "The Docket currently supports English, Tagalog, and Tanglish. Please rephrase your question in one of these languages.",
      citations: [],
      warning: null,
      verified: true,
      knowledge_base_last_updated: kbDate,
      responseLanguage,
    };
  }

  if (isNormativeQuery(effectiveQuery)) {
    const kbDate = await getKnowledgeBaseLastUpdated();
    return {
      answer: NORMATIVE_REFUSAL_MESSAGE,
      citations: [],
      warning: null,
      verified: true,
      knowledge_base_last_updated: kbDate,
      responseLanguage,
    };
  }

  const { intent, isRedaction } = await classifyIntent(effectiveQuery, !!effectivePastedText, pasteType);

  if (intent === "out_of_scope") {
    const kbDate = await getKnowledgeBaseLastUpdated();
    const answer = isRedaction
      ? "This content is redacted in ICC records. The Docket cannot investigate or disclose redacted material."
      : "This is not addressed in current ICC records. Your question asks for opinions, speculation, or information outside the scope of ICC case documents—the Docket only answers from official records about the Philippines case.";
    return {
      answer,
      citations: [],
      warning: null,
      verified: true,
      knowledge_base_last_updated: kbDate,
      responseLanguage,
    };
  }

  // Fact-check flow: extract claims FIRST, then retrieve per-claim
  if (intent === "fact_check" && effectivePastedText) {
    const trimmedPaste = effectivePastedText.trim();
    if (!trimmedPaste || trimmedPaste.length < 10) {
      const kbDate = await getKnowledgeBaseLastUpdated();
      return {
        answer:
          "Please paste the content you want verified in the box above (click + Paste), then ask your question. The fact-checker needs the actual text to extract and verify claims.",
        citations: [],
        warning: null,
        verified: true,
        knowledge_base_last_updated: kbDate,
        responseLanguage,
      };
    }

    // Bug 3 fix: Check pasted text for redaction signals before claim extraction
    const redactionInPaste = /\[REDACTED\]|\bredacted\b|\bconfidential\s+witness\b|\bunnamed\b.*\b(source|witness|person|individual)\b|\bsealed\b.*\b(evidence|document|record)\b|\bde-?anonymize\b/i.test(trimmedPaste);
    if (redactionInPaste) {
      const kbDate = await getKnowledgeBaseLastUpdated();
      return {
        answer:
          "This content references redacted material in ICC records. The Docket cannot investigate, speculate on, or attempt to identify redacted content. Redactions are maintained to protect witnesses and the integrity of proceedings.",
        citations: [],
        warning: null,
        verified: true,
        knowledge_base_last_updated: kbDate,
        responseLanguage,
      };
    }

    const claims = await extractClaims(effectivePastedText);
    const factualClaims = claims.filter((c) => c.claimType === "factual_claim");
    const opinionClaims = claims.filter((c) => c.claimType === "opinion");
    const oosClaims = claims.filter((c) => c.claimType === "out_of_scope");

    if (claims.length === 0) {
      const kbDate = await getKnowledgeBaseLastUpdated();
      return {
        answer:
          "This content appears to contain no verifiable factual claims about the ICC case. The Docket extracts and verifies factual statements against ICC records.",
        citations: [],
        warning: null,
        verified: true,
        knowledge_base_last_updated: kbDate,
        responseLanguage,
      };
    }

    // Pure opinion/out-of-scope: label, don't decline, no retrieval needed
    if (factualClaims.length === 0) {
      const kbDate = await getKnowledgeBaseLastUpdated();
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
      const allClaims = [...opinionVerified, ...oosVerified];
      const factCheck: FactCheckResult = {
        overallVerdict: "opinion" as ClaimVerdict,
        pastedContentPreview: effectivePastedText.slice(0, 100) + (effectivePastedText.length > 100 ? "…" : ""),
        detectedLanguage: langResult.language,
        claims: allClaims,
        copyText: "",
        mode: "fact_check",
        inputPreview: effectivePastedText.slice(0, 100),
      };
      factCheck.copyText = formatCopyText(factCheck);
      return {
        answer:
          "OPINION\n\nThis content contains opinions rather than verifiable factual claims about the ICC case. No factual claims were found to verify against ICC records.\n\nThe Docket verifies factual claims about the Duterte ICC case against official ICC documents.",
        citations: [],
        warning: null,
        verified: true,
        knowledge_base_last_updated: kbDate,
        factCheck,
        detectedLanguage: langResult.language,
        responseLanguage,
      };
    }

    // Bug 1+2 fix: Retrieve using extracted factual claims as search queries, not raw pasted text
    const ragIndexes = intentToRagIndexes(intent, effectiveQuery);
    const claimSearchQueries = factualClaims.map((c) => c.extractedText);
    const combinedClaimQuery = claimSearchQueries.join(". ");

    const retrieveResult = await retrieve({
      query: combinedClaimQuery,
      ragIndexes,
      intent,
    });
    const { chunks, retrievalConfidence } = retrieveResult;

    if (chunks.length === 0) {
      logEvent("chat.flat_decline", "warn", { intent: "fact_check", reason: "chunks=0" });
      const kbDate = await getKnowledgeBaseLastUpdated();
      return {
        answer:
          "We couldn't find relevant ICC documents to verify these claims. The Docket can only fact-check against ingested ICC records. This topic may not be covered in our knowledge base yet.",
        citations: [],
        warning: null,
        verified: true,
        knowledge_base_last_updated: kbDate,
        responseLanguage,
      };
    }

    const { answer, factCheck } = await generateFactCheckResponse(
      claims,
      chunks,
      effectivePastedText.slice(0, 100),
      langResult.language,
      responseLanguage
    );

    if (hasProhibitedTermsInFactCheckAnswer(answer)) {
      logEvent("chat.fact_check", "warn", { reason: "prohibited_terms_in_answer" });
      const kbDate = await getKnowledgeBaseLastUpdated();
      return {
        answer:
          "We couldn't verify this fact-check against our ICC records. The verdict reached may not be sufficiently supported by the retrieved documents. Try content with claims that relate more directly to the ICC case documents we have.",
        citations: [],
        warning: null,
        verified: false,
        knowledge_base_last_updated: kbDate,
        responseLanguage,
      };
    }

    const openai = getOpenAIClient();
    const judgeDisabled = process.env.DISABLE_JUDGE === "true";
    if (!judgeDisabled) {
      try {
        const judgeResult = await judgeAnswer(
          answer,
          chunks,
          openai,
          undefined,
          sanitizeHistory(conversationHistory.slice(-3))
        );
        if (judgeResult.verdict === "REJECT") {
          const kbDate = await getKnowledgeBaseLastUpdated();
          const noDocsReject =
            chunks.length === 0 ||
            /no (icc )?documents|absence of.*documents|documents? (were )?retrieved/i.test(
              judgeResult.reason ?? ""
            );
          const factCheckRejectMessage = noDocsReject
            ? "We couldn't find relevant ICC documents to verify these claims. The Docket can only fact-check against ingested ICC records. This topic may not be covered in our knowledge base yet."
            : "We couldn't verify this fact-check against our ICC records. The verdict reached may not be sufficiently supported by the retrieved documents. Try content with claims that relate more directly to the ICC case documents we have.";
          return {
            answer: factCheckRejectMessage,
            citations: [],
            warning: null,
            verified: false,
            knowledge_base_last_updated: kbDate,
            responseLanguage,
          };
        }
      } catch (err) {
        logEvent("chat.error", "error", { error_type: "judge_api", error_message: String(err) });
        throw new Error("Judge API unavailable");
      }
    }

    const citations = extractCitations(answer, chunks);
    const validatedCitations = validateCitationIntegrity(citations, answer, chunks);
    const kbDate = await getKnowledgeBaseLastUpdated();

    return {
      answer,
      citations: validatedCitations,
      warning: null,
      verified: true,
      knowledge_base_last_updated: kbDate,
      factCheck: { ...factCheck, copyText: formatCopyText(factCheck) },
      detectedLanguage: langResult.language,
      translatedQuery: originalQuery ? effectiveQuery : undefined,
      responseLanguage,
    };
  }

  // Normal Q&A flow: retrieve using query (or pasted text for paste_text intent)
  const ragIndexes = intentToRagIndexes(intent, effectiveQuery);
  const isHearingContentQuery =
    ragIndexes.includes(2) &&
    /\b(closing\s+statement|what\s+(did|were)\s+(the\s+)?(defence|defense|prosecution)\s+(argue|say|present|claim|state)|what\s+was\s+(said|argued|presented|discussed)\s+at\s+the\s+(hearing|confirmation)|defence['\s]?s?\s+argument|prosecution['\s]?s?\s+argument|what\s+happened\s+at\s+the\s+(hearing|confirmation)|confirmation\s+of\s+charges\s+hearing|testimony\s+(at|during|in)\s+the)\b/i.test(
      effectiveQuery
    );
  const isDrugWarTermQuery =
    /\bwhat\s+(is|are|was|were)\b.*\b(tokhang|oplan|double\s+barrel|dds|davao\s+death|drug\s+war|war\s+on\s+drugs?|nanlaban|shabu|buy[- ]?bust|extrajudicial)\b/i.test(effectiveQuery) ||
    /\b(tokhang|oplan|double\s+barrel|dds|davao\s+death)\b.*\bwhat\b/i.test(effectiveQuery);
  const retrieveResult = await retrieve({
    query: effectiveQuery,
    pastedText: effectivePastedText,
    ragIndexes,
    intent,
    documentType: isHearingContentQuery ? "transcript" : undefined,
    useExtendedTopK: intent === "case_facts" && isDrugWarTermQuery,
  });
  const { chunks, pasteTextMatched, retrievalConfidence } = retrieveResult;

  if (chunks.length === 0) {
    logEvent("chat.flat_decline", "warn", { intent, reason: "chunks=0" });
    const kbDate = await getKnowledgeBaseLastUpdated();
    return {
      answer:
        "We couldn't find a strong match for this question in the ICC documents. Try rephrasing your question, using more specific terms (e.g., names, dates, legal terms), or asking about a different aspect of the case.",
      citations: [],
      warning: null,
      verified: true,
      knowledge_base_last_updated: kbDate,
      retrievalConfidence,
    };
  }

  if (evidenceSufficiency(retrieveResult) === "insufficient") {
    logEvent("chat.flat_decline", "warn", { intent, reason: "evidence_insufficient" });
    const kbDate = await getKnowledgeBaseLastUpdated();
    return {
      answer:
        "We couldn't find strong matches for this question in the ICC documents. Try rephrasing with more specific terms (e.g., names, dates, legal terms), or asking about a different aspect of the case.",
      citations: [],
      warning: null,
      verified: true,
      knowledge_base_last_updated: kbDate,
      retrievalConfidence,
    };
  }

  const ABSENCE_PATTERNS =
    /\b(has\s+.{1,30}(happened|started|begun|been\s+\w+ed)\s*(yet|already)?)\b|\b(is\s+there\s+(a|any)\s+\w+\s+(yet|already))\b|\b(when\s+will)\b|\b(has\s+.*been\s+scheduled)\b|\b(was\s+the\s+\w+\s+(granted|approved|denied|rejected|upheld|dismissed))\b|\b(has\s+(the\s+)?(trial|hearing|deferral|bail|admissibility)\s+(been\s+)?(started|granted|approved|scheduled|decided|resolved))\b/i;

  const isAbsenceQuery = ABSENCE_PATTERNS.test(effectiveQuery);

  const kbDate = await getKnowledgeBaseLastUpdated();
  const systemPrompt = buildSystemPrompt({
    chunks,
    queryType: intent,
    query: effectiveQuery,
    pastedText: effectivePastedText,
    pasteTextMatched,
    conversationHistory: sanitizeHistory(conversationHistory.slice(-3)),
    knowledgeBaseLastUpdated: kbDate,
    isAbsenceQuery,
    isDrugWarTermQuery,
    responseLanguage,
    originalQuery,
  });

  const openai = getOpenAIClient();
  const userMessageContent = effectivePastedText
    ? `[Pasted text]\n${effectivePastedText}\n\n${effectiveQuery}`
    : effectiveQuery;
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessageContent },
    ],
    max_tokens: MAX_ANSWER_TOKENS,
  });

  const rawAnswer = res.choices[0]?.message?.content?.trim() ?? "";

  // If LLM returned empty and we have transcript chunks for a hearing query, use transcript fallback
  if (!rawAnswer && isHearingContentQuery) {
    const hasTranscriptChunks = chunks.some((c) => (c.metadata?.document_type as string) === "transcript");
    if (hasTranscriptChunks) {
      const fallback =
        /\bclosing\s+statement/i.test(effectiveQuery)
          ? "The transcript(s) in the knowledge base cover the confirmation of charges hearing. Closing statements typically occur on the final day of a multi-day hearing. The transcript for that day may not yet be available in ICC records. You can ask about what the prosecution or defence said during the days that are in the knowledge base."
          : askedAboutProsecutionOrDefence(effectiveQuery)
            ? "We have transcript(s) from the confirmation of charges hearing, but we couldn't produce a verified answer to your question this time. Try rephrasing with a more specific topic (e.g., 'What did the prosecution say about Article 25?' or 'What was the defence's position on jurisdiction?'), or browse the transcript documents in the Sources section."
            : "The knowledge base includes transcript(s) from the confirmation of charges hearing. You can ask about what the prosecution or defence said during that hearing.";
      return {
        answer: fallback,
        citations: [],
        warning: null,
        verified: false,
        knowledge_base_last_updated: kbDate,
        retrievalConfidence,
      };
    }
  }

  const suspicious = checkForHallucinatedNumbers(rawAnswer, chunks);
  let judgeExtraContext = "";
  if (suspicious.length > 0) {
    judgeExtraContext = `\n\n⚠ Automated check: answer contains number(s) ${suspicious.join(", ")} not found in any retrieved chunk. Verify carefully.`;
  }
  if (isAbsenceQuery && /^(no[,.]?|this has not|not yet)/i.test(rawAnswer) && /\[\d+\]/.test(rawAnswer)) {
    judgeExtraContext += "\n\nNote: This is a status/absence query. A 'No, this has not happened yet' answer grounded in chunks establishing the current case stage is correct behavior, not speculation.";
  }

  const claimResult = verifyEnumeratedClaims(rawAnswer, chunks);
  const verifiedAnswer = claimResult.cleanedAnswer;
  if (claimResult.strippedClaims.length > 0) {
    judgeExtraContext += `\n\n⚠ Automated check: ${claimResult.strippedClaims.length} enumerated claim(s) were stripped because they were not found in any retrieved chunk.`;
  }

  const chunkDates = chunks
    .map((c, i) => `[${i + 1}] published: ${c.metadata.date_published ?? "n.d."}`)
    .join(", ");
  judgeExtraContext += `\n\nNote: The following document publication dates appear in chunk metadata and may be referenced in the answer: ${chunkDates}`;

  // Deterministic guilt/innocence block: never show answer with prohibited terms
  if (hasProhibitedTerms(verifiedAnswer)) {
    logEvent("chat.judge", "warn", { reason: "prohibited_terms" });
    return {
      answer: FALLBACK_BLOCKED,
      citations: [],
      warning: null,
      verified: false,
      knowledge_base_last_updated: kbDate,
      retrievalConfidence,
      claimsVerified: claimResult.hadEnumerations ? claimResult.strippedClaims.length === 0 : undefined,
      claimsStripped: claimResult.strippedClaims.length > 0 ? claimResult.strippedClaims.length : undefined,
    };
  }

  // LLM-as-Judge: verify answer before showing (prompt-spec.md §6.2)
  // Set DISABLE_JUDGE=true in .env.local to bypass (e.g. when judge is overly strict)
  const judgeDisabled = process.env.DISABLE_JUDGE === "true";
  let verdict: "APPROVE" | "REJECT" = judgeDisabled ? "APPROVE" : "REJECT";

  const sanitizedHistory = sanitizeHistory(conversationHistory.slice(-3));
  if (!judgeDisabled) {
    try {
      const judgeResult = await judgeAnswer(verifiedAnswer, chunks, openai, judgeExtraContext, sanitizedHistory);
      verdict = judgeResult.verdict;
    } catch (err) {
      logEvent("chat.error", "error", { error_type: "judge_api", error_message: String(err) });
      throw new Error("Judge API unavailable");
    }
  }

  if (verdict === "REJECT") {
    // For hearing-content queries with transcript chunks: provide a helpful fallback instead of generic blocked message
    const hasTranscriptChunks = chunks.some((c) => (c.metadata?.document_type as string) === "transcript");
    const transcriptFallback =
      isHearingContentQuery && hasTranscriptChunks
        ? /\bclosing\s+statement/i.test(effectiveQuery)
          ? "The transcript(s) in the knowledge base cover the confirmation of charges hearing. Closing statements typically occur on the final day of a multi-day hearing. The transcript for that day may not yet be available in ICC records. You can ask about what the prosecution or defence said during the days that are in the knowledge base."
          : askedAboutProsecutionOrDefence(effectiveQuery)
            ? "We have transcript(s) from the confirmation of charges hearing, but we couldn't produce a verified answer to your question this time. Try rephrasing with a more specific topic (e.g., 'What did the prosecution say about Article 25?' or 'What was the defence's position on jurisdiction?'), or browse the transcript documents in the Sources section."
            : "The knowledge base includes transcript(s) from the confirmation of charges hearing. You can ask about what the prosecution or defence said during that hearing."
        : null;

    return {
      answer: transcriptFallback ?? FALLBACK_BLOCKED,
      citations: [],
      warning: null,
      verified: false,
      knowledge_base_last_updated: kbDate,
      retrievalConfidence,
      claimsVerified: claimResult.hadEnumerations ? claimResult.strippedClaims.length === 0 : undefined,
      claimsStripped: claimResult.strippedClaims.length > 0 ? claimResult.strippedClaims.length : undefined,
    };
  }

  const parsed = parseResponse(
    verifiedAnswer,
    chunks,
    pasteTextMatched,
    kbDate,
    !!effectivePastedText,
    retrievalConfidence,
    claimResult.hadEnumerations ? claimResult.strippedClaims.length === 0 : undefined,
    claimResult.strippedClaims.length > 0 ? claimResult.strippedClaims.length : undefined
  );

  // Safety net: LLM sometimes returns minimal "this detail not available" for transcript queries.
  // Replace with helpful context when we have transcript chunks.
  const minimalDecline = /^This specific detail is not available in current ICC records\.?\s*(Last updated from ICC records:[\s\S]*)?\s*$/i;
  const hasTranscriptChunks = chunks.some((c) => (c.metadata?.document_type as string) === "transcript");
  if (
    isHearingContentQuery &&
    hasTranscriptChunks &&
    minimalDecline.test(parsed.answer.trim())
  ) {
    parsed.answer =
      /\bclosing\s+statement/i.test(effectiveQuery)
        ? "The transcript(s) in the knowledge base cover the confirmation of charges hearing. Closing statements typically occur on the final day of a multi-day hearing. The transcript for that day may not yet be available in ICC records. You can ask about what the prosecution or defence said during the days that are in the knowledge base.\n\nLast updated from ICC records: " +
          kbDate
        : askedAboutProsecutionOrDefence(effectiveQuery)
          ? "We have transcript(s) from the confirmation of charges hearing, but we couldn't produce a verified answer to your question this time. Try rephrasing with a more specific topic (e.g., 'What did the prosecution say about Article 25?' or 'What was the defence's position on jurisdiction?'), or browse the transcript documents in the Sources section.\n\nLast updated from ICC records: " +
            kbDate
          : "The knowledge base includes transcript(s) from the confirmation of charges hearing. You can ask about what the prosecution or defence said during that hearing.\n\nLast updated from ICC records: " +
            kbDate;
    parsed.citations = [];
  }

  // Multi-intent: append flat decline for the out-of-scope part
  if (multiIntent?.hasInvalidPart) {
    parsed.answer =
      parsed.answer.trim() +
      "\n\nThe second part of your question asks for opinions or information outside ICC case documents, so we can't answer it from the records.";
  }

  return {
    ...parsed,
    detectedLanguage: langResult.language !== "en" ? langResult.language : undefined,
    translatedQuery: originalQuery,
    responseLanguage,
  };
}
