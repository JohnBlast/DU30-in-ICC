/**
 * Chat pipeline: intent → RAG → LLM → parsed response.
 * prompt-spec.md, Task Group 5.
 */

import type OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { getOpenAIClient } from "./openai-client";
import { classifyIntent } from "./intent-classifier";
import { intentToRagIndexes } from "./intent";
import { retrieve, type RetrievalChunk } from "./retrieve";
import { buildSystemPrompt, JUDGE_SYSTEM_PROMPT, buildJudgeUserMessage } from "./prompts";
import { verifyEnumeratedClaims } from "./claim-verifier";
import { logEvent } from "./logger";

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
}

/** Multi-intent: "Tell me about Count 2. Also, was the drug war justified?" (nl-interpretation §5.9 NL-47) */
const OUT_OF_SCOPE_SIGNALS =
  /\b(justified|biased|favorite|compare|think about|opinion|speculation|political)\b|(\bwas\b.*\bright\b)|(\bdo\s+you\s+think\b)/i;

const REDACTION_CONTENT = /\[REDACTED\]|redacted|confidential\s+witness|de-?anonymize/i;
const REDACTION_RESPONSE_TEXT = "This content is redacted in ICC records";

function sanitizeHistory(
  history: Array<{ role: "user" | "assistant"; content: string }>
): Array<{ role: "user" | "assistant"; content: string }> {
  return history.map((msg) => {
    if (REDACTION_CONTENT.test(msg.content) || msg.content.includes(REDACTION_RESPONSE_TEXT)) {
      return { role: msg.role, content: "[Prior exchange about redacted content — omitted]" };
    }
    return msg;
  });
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
  const { query, pastedText, conversationHistory = [] } = opts;

  // Multi-intent: answer valid part, append flat decline for invalid part (Task 10.14)
  const multiIntent = splitMultiIntent(query);
  const effectiveQuery = multiIntent?.validQuery ?? query;

  const { intent, isRedaction } = await classifyIntent(effectiveQuery, !!pastedText);

  if (intent === "non_english") {
    const kbDate = await getKnowledgeBaseLastUpdated();
    return {
      answer:
        "The Docket currently supports English only. Please ask your question in English.",
      citations: [],
      warning: null,
      verified: true,
      knowledge_base_last_updated: kbDate,
    };
  }

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
    };
  }

  const ragIndexes = intentToRagIndexes(intent, effectiveQuery);
  const retrieveResult = await retrieve({
    query: effectiveQuery,
    pastedText,
    ragIndexes,
    intent,
  });

  const { chunks, pasteTextMatched, retrievalConfidence } = retrieveResult;

  if (chunks.length === 0) {
    logEvent("chat.flat_decline", "warn", { intent, reason: "chunks=0" });
    const kbDate = await getKnowledgeBaseLastUpdated();
    return {
      answer:
        "This is not addressed in current ICC records. We couldn't find relevant information on this in the ingested ICC documents—the knowledge base may not include documents that address this topic yet.",
      citations: [],
      warning: null,
      verified: true,
      knowledge_base_last_updated: kbDate,
      retrievalConfidence,
    };
  }

  const ABSENCE_PATTERNS =
    /\b(has\s+.{1,30}(happened|started|begun|been\s+\w+ed)\s*(yet|already)?)\b|\b(is\s+there\s+(a|any)\s+\w+\s+(yet|already))\b|\b(when\s+will)\b|\b(has\s+.*been\s+scheduled)\b/i;

  const isAbsenceQuery = ABSENCE_PATTERNS.test(effectiveQuery);

  const kbDate = await getKnowledgeBaseLastUpdated();
  const systemPrompt = buildSystemPrompt({
    chunks,
    queryType: intent,
    query: effectiveQuery,
    pastedText,
    pasteTextMatched,
    conversationHistory: sanitizeHistory(conversationHistory.slice(-3)),
    knowledgeBaseLastUpdated: kbDate,
    isAbsenceQuery,
  });

  const openai = getOpenAIClient();
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: effectiveQuery },
    ],
    max_tokens: MAX_ANSWER_TOKENS,
  });

  const rawAnswer = res.choices[0]?.message?.content?.trim() ?? "";

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

  const parsed = parseResponse(
    verifiedAnswer,
    chunks,
    pasteTextMatched,
    kbDate,
    !!pastedText,
    retrievalConfidence,
    claimResult.hadEnumerations ? claimResult.strippedClaims.length === 0 : undefined,
    claimResult.strippedClaims.length > 0 ? claimResult.strippedClaims.length : undefined
  );

  // Multi-intent: append flat decline for the out-of-scope part
  if (multiIntent?.hasInvalidPart) {
    parsed.answer =
      parsed.answer.trim() +
      "\n\nThe second part of your question asks for opinions or information outside ICC case documents, so we can't answer it from the records.";
  }

  return parsed;
}
