/**
 * RAG retrieval: vector search, BM25, RRF fusion, reranking.
 * PRD §15.2
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getOpenAIClient } from "./openai-client";
import { logEvent } from "./logger";

/** @deprecated Use getThresholds(intent).primary */
const SIMILARITY_THRESHOLD = 0.58;
const PRE_RERANK_TOP_K = 10;

const INTENT_THRESHOLDS: Record<string, { primary: number; fallback: number }> = {
  case_facts: { primary: 0.45, fallback: 0.30 },
  case_timeline: { primary: 0.52, fallback: 0.35 },
  legal_concept: { primary: 0.58, fallback: 0.4 },
  procedure: { primary: 0.55, fallback: 0.38 },
  glossary: { primary: 0.55, fallback: 0.38 },
  paste_text: { primary: 0.58, fallback: 0.35 },
  fact_check: { primary: 0.52, fallback: 0.35 },
};

function getThresholds(intent?: string): { primary: number; fallback: number } {
  return INTENT_THRESHOLDS[intent ?? ""] ?? { primary: 0.55, fallback: 0.38 };
}
const POST_RERANK_TOP_K_DEFAULT = 4;
const POST_RERANK_TOP_K_EXTENDED = 6; // case_facts + drug war terms (docket-improvement-plan §16)
const RRF_K = 60; // Reciprocal Rank Fusion constant

export interface RetrievalChunk {
  chunk_id: string;
  document_id: string;
  content: string;
  metadata: {
    document_title?: string;
    url?: string;
    date_published?: string;
    rag_index?: string;
    document_type?: string;
  };
  similarity?: number;
  rank?: number;
}

export interface RetrieveOptions {
  /** RAG indexes to search. [1] = legal, [2] = case, [1,2] = both. [] = no retrieval. */
  ragIndexes: number[];
  /** Query to embed and search for. */
  query: string;
  /** Pasted text for cross-reference (optional). */
  pastedText?: string;
  /** Intent for threshold selection (Phase 3). */
  intent?: string;
  /** When set, restrict retrieval to this document_type (e.g. "transcript" for hearing-content queries). */
  documentType?: string;
  /** Use 6 chunks instead of 4 for case_facts + drug war term queries (broader coverage). */
  useExtendedTopK?: boolean;
}

export interface RetrieveResult {
  chunks: RetrievalChunk[];
  pasteTextMatched: boolean;
  retrievalConfidence: "high" | "medium" | "low";
}

/**
 * Evidence sufficiency (docket-improvement-plan.md §16).
 * Gate: if insufficient, do not generate — return structured "lack of data" message.
 */
export function evidenceSufficiency(result: RetrieveResult): "sufficient" | "insufficient" {
  const { chunks, retrievalConfidence } = result;
  if (chunks.length === 0) return "insufficient";
  if (chunks.length <= 1 && retrievalConfidence !== "high") return "insufficient";
  if (retrievalConfidence === "low" && chunks.length < 3) return "insufficient";
  return "sufficient";
}

function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !key) throw new Error("Missing Supabase env");
  return createClient(url, key);
}

/** Embed a string with OpenAI text-embedding-3-small (1536 dims). */
export async function embedText(text: string): Promise<number[]> {
  const openai = getOpenAIClient();
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  if (!res.data?.[0]?.embedding) {
    throw new Error("Failed to embed text: empty response from OpenAI");
  }
  return res.data[0].embedding;
}

/** Vector search via pgvector cosine similarity. */
async function vectorSearch(
  supabase: SupabaseClient,
  embedding: number[],
  ragIndex: 1 | 2 | undefined,
  limit: number,
  threshold: number,
  documentType?: string
): Promise<RetrievalChunk[]> {
  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: embedding,
    match_rag_index: ragIndex ?? null,
    match_threshold: threshold,
    match_count: limit,
    match_document_type: documentType ?? null,
  });
  if (error) throw new Error(`Vector search failed: ${error.message}`);
  return (data ?? []).map((r: { chunk_id: string; document_id: string; content: string; metadata: object; similarity: number }) => ({
    chunk_id: r.chunk_id,
    document_id: r.document_id,
    content: r.content,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    similarity: r.similarity,
  }));
}

/** BM25-style full-text search. */
async function bm25Search(
  supabase: SupabaseClient,
  query: string,
  ragIndex?: 1 | 2,
  limit = PRE_RERANK_TOP_K,
  documentType?: string
): Promise<RetrievalChunk[]> {
  const { data, error } = await supabase.rpc("search_document_chunks_fts", {
    search_query: query,
    match_rag_index: ragIndex ?? null,
    match_count: limit,
    match_document_type: documentType ?? null,
  });
  if (error) throw new Error(`FTS search failed: ${error.message}`);
  return (data ?? []).map((r: { chunk_id: string; document_id: string; content: string; metadata: object; rank: number }) => ({
    chunk_id: r.chunk_id,
    document_id: r.document_id,
    content: r.content,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    rank: r.rank,
  }));
}

/**
 * RRF (Reciprocal Rank Fusion): merge two ranked lists.
 * Score = sum(1 / (k + rank)) for each list.
 */
function rrfMerge(vecChunks: RetrievalChunk[], ftsChunks: RetrievalChunk[]): RetrievalChunk[] {
  const scores = new Map<string, number>();
  const chunkMap = new Map<string, RetrievalChunk>();

  vecChunks.forEach((c, i) => {
    const id = c.chunk_id;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1));
    if (!chunkMap.has(id)) chunkMap.set(id, { ...c, similarity: c.similarity });
  });

  ftsChunks.forEach((c, i) => {
    const id = c.chunk_id;
    scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + i + 1));
    if (!chunkMap.has(id)) chunkMap.set(id, { ...c });
  });

  const sorted = [...chunkMap.entries()]
    .sort((a, b) => (scores.get(b[0]) ?? 0) - (scores.get(a[0]) ?? 0))
    .slice(0, PRE_RERANK_TOP_K);

  return sorted.map(([id]) => chunkMap.get(id)!);
}

/**
 * Enforce document diversity: max N chunks per document.
 */
function enforceDocDiversity(
  chunks: RetrievalChunk[],
  maxPerDoc: number = 2,
  limit: number = POST_RERANK_TOP_K_DEFAULT
): RetrievalChunk[] {
  const docCounts = new Map<string, number>();
  const result: RetrievalChunk[] = [];

  for (const chunk of chunks) {
    const docId = chunk.document_id;
    const count = docCounts.get(docId) ?? 0;
    if (count >= maxPerDoc) continue;
    docCounts.set(docId, count + 1);
    result.push(chunk);
    if (result.length >= limit) break;
  }

  return result;
}


/** Expand query for better embedding match on domain-specific terms. */
function expandQueryForEmbedding(query: string): string {
  if (/\btokhang\b/i.test(query) && !/\b(operation|campaign|drug|anti)\b/i.test(query)) {
    return query + " Philippine anti-drug operation campaign killings ICC case";
  }
  if (/\bdouble\s+barrel\b/i.test(query) && !/\b(project|pnp|anti)\b/i.test(query)) {
    return query + " Project Double Barrel anti-drug Philippine National Police campaign";
  }
  if (/\b(davao\s+death\s+squad|dds)\b/i.test(query) && !/\b(kill|extrajudicial|murder)\b/i.test(query)) {
    return query + " Davao Death Squad extrajudicial killings Philippines";
  }
  return query;
}

/** Expand query with ICC terminology synonyms for better FTS match (e.g. closing submissions vs closing statements). */
function expandQueryForFts(query: string): string {
  let expanded = query;
  if (/\bclosing\s+statement(s)?\b/i.test(expanded) && !/\bclosing\s+submission/i.test(expanded)) {
    expanded += " closing submissions";
  }
  if (/\bdefence\b/i.test(expanded) && !/\bdefense\b/i.test(expanded)) {
    expanded += " defense";
  }
  // Drug war term expansion for better FTS recall
  if (/\btokhang\b/i.test(expanded)) {
    expanded += " anti-drug campaign operation drug war";
  }
  if (/\bdouble\s+barrel\b/i.test(expanded)) {
    expanded += " Oplan Tokhang anti-drug campaign PNPAIDG";
  }
  if (/\b(davao\s+death\s+squad|dds)\b/i.test(expanded)) {
    expanded += " Davao killings extrajudicial";
  }
  if (/\b(war\s+on\s+drugs?|drug\s+war)\b/i.test(expanded)) {
    expanded += " Tokhang Double Barrel anti-drug campaign operation";
  }
  if (/\bextrajudicial\b/i.test(expanded)) {
    expanded += " killing execution drug war Tokhang";
  }
  return expanded.trim();
}

/** Resolve ragIndexes to single filter for RPC: undefined = search all (both indexes). */
function toMatchRagIndex(ragIndexes: number[]): 1 | 2 | undefined {
  if (ragIndexes.length === 0) return undefined;
  if (ragIndexes.length === 2) return undefined; // both
  return ragIndexes[0] as 1 | 2;
}

/**
 * Hybrid retrieval: vector + BM25 → RRF → rerank → top 4.
 * For dual-index [1,2], searches both indexes (match_rag_index=null).
 */
export async function retrieve(options: RetrieveOptions): Promise<RetrieveResult> {
  const { query, ragIndexes, pastedText, intent, documentType, useExtendedTopK } = options;
  const searchText = pastedText ?? query;
  const supabase = getSupabase();

  const { primary: primaryThreshold, fallback: fallbackThreshold } = getThresholds(intent);
  const matchIndex = toMatchRagIndex(ragIndexes);
  const embeddingText = expandQueryForEmbedding(searchText);
  const embedding = await embedText(embeddingText);

  const ftsQuery = expandQueryForFts(searchText);

  // For hearing-content queries: run BOTH normal + transcript-only retrieval, then ensure transcript chunks are included
  const wantsTranscripts = documentType === "transcript";
  const [vecChunks, ftsChunks, transcriptVec, transcriptFts] = wantsTranscripts
    ? await Promise.all([
        vectorSearch(supabase, embedding, matchIndex, PRE_RERANK_TOP_K, primaryThreshold),
        bm25Search(supabase, ftsQuery, matchIndex, PRE_RERANK_TOP_K),
        vectorSearch(supabase, embedding, matchIndex, PRE_RERANK_TOP_K, Math.min(primaryThreshold, 0.35), "transcript"),
        bm25Search(supabase, ftsQuery, matchIndex, PRE_RERANK_TOP_K, "transcript"),
      ])
    : await Promise.all([
        vectorSearch(supabase, embedding, matchIndex, PRE_RERANK_TOP_K, primaryThreshold, documentType),
        bm25Search(supabase, ftsQuery, matchIndex, PRE_RERANK_TOP_K, documentType),
        [] as RetrievalChunk[],
        [] as RetrievalChunk[],
      ]);

  let merged = rrfMerge(vecChunks, ftsChunks);

  if (wantsTranscripts && (transcriptVec.length > 0 || transcriptFts.length > 0)) {
    const transcriptMerged = rrfMerge(transcriptVec, transcriptFts);
    if (transcriptMerged.length > 0) {
      const transcriptIds = new Set(transcriptMerged.map((c) => c.chunk_id));
      const nonTranscript = merged.filter((c) => !transcriptIds.has(c.chunk_id));
      const transcriptTop = transcriptMerged.slice(0, 2);
      merged = [...transcriptTop, ...nonTranscript].slice(0, PRE_RERANK_TOP_K * 3);
    }
  }

  let usedFallback = false;
  let usedDualIndexFallback = false;

  if (merged.length === 0 && documentType !== undefined) {
    const [vecFallback, ftsFallback] = await Promise.all([
      vectorSearch(supabase, embedding, matchIndex, PRE_RERANK_TOP_K, primaryThreshold),
      bm25Search(supabase, ftsQuery, matchIndex, PRE_RERANK_TOP_K),
    ]);
    merged = rrfMerge(vecFallback, ftsFallback);
  }

  if (merged.length === 0 && matchIndex !== undefined) {
    const { data: fallbackData } = await supabase.rpc("match_document_chunks", {
      query_embedding: embedding,
      match_rag_index: matchIndex,
      match_threshold: fallbackThreshold,
      match_count: PRE_RERANK_TOP_K,
      match_document_type: null,
    });
    const fallbackChunks = (fallbackData ?? []).map(
      (r: { chunk_id: string; document_id: string; content: string; metadata: object; similarity: number }) => ({
        chunk_id: r.chunk_id,
        document_id: r.document_id,
        content: r.content,
        metadata: (r.metadata as Record<string, unknown>) ?? {},
        similarity: r.similarity,
      })
    );
    merged = fallbackChunks;
    usedFallback = true;
  }

  // Dual-index fallback: if single-index returned 0, retry searching both indexes
  if (merged.length === 0 && matchIndex !== undefined) {
    logEvent("rag.fallback_dual_index", "info", { original_index: matchIndex });
    const [vecFallback, ftsFallback] = await Promise.all([
      vectorSearch(supabase, embedding, undefined, PRE_RERANK_TOP_K, primaryThreshold),
      bm25Search(supabase, ftsQuery, undefined, PRE_RERANK_TOP_K),
    ]);
    merged = rrfMerge(vecFallback, ftsFallback);
    if (merged.length > 0) {
      usedDualIndexFallback = true;
    }
  }

  // Last-resort fallback: very low threshold across both indexes
  if (merged.length === 0) {
    logEvent("rag.fallback_last_resort", "info", { threshold: 0.3 });
    const lastResort = await vectorSearch(supabase, embedding, undefined, PRE_RERANK_TOP_K, 0.3);
    if (lastResort.length > 0) {
      merged = lastResort;
      usedFallback = true;
    }
  }

  const topK = useExtendedTopK ? POST_RERANK_TOP_K_EXTENDED : POST_RERANK_TOP_K_DEFAULT;
  const diverseChunks = enforceDocDiversity(merged, 2, topK);
  const topChunks = diverseChunks.slice(0, topK);

  const bothMethods = vecChunks.length > 0 && ftsChunks.length > 0;
  let retrievalConfidence: "high" | "medium" | "low";
  if (usedFallback && !usedDualIndexFallback) {
    retrievalConfidence = "low";
  } else if (usedDualIndexFallback) {
    retrievalConfidence = "medium";
  } else if (topChunks.length <= 1) {
    retrievalConfidence = "low";
  } else if (bothMethods && topChunks.length >= 2) {
    retrievalConfidence = "high";
  } else {
    retrievalConfidence = "medium";
  }

  if (topChunks.length === 0) {
    logEvent("rag.retrieve", "warn", {
      rag_indexes: ragIndexes,
      vec_count: vecChunks.length,
      fts_count: ftsChunks.length,
      final_count: 0,
      confidence: retrievalConfidence,
    });
  } else {
    logEvent("rag.retrieve", "info", {
      rag_indexes: ragIndexes,
      vec_count: vecChunks.length,
      fts_count: ftsChunks.length,
      final_count: topChunks.length,
      confidence: retrievalConfidence,
    });
  }

  const pasteTextMatched =
    pastedText !== undefined ? (vecChunks.length > 0 || ftsChunks.length > 0) : true;

  return { chunks: topChunks, pasteTextMatched, retrievalConfidence };
}

/**
 * Paste-text cross-reference: run hybrid search on pasted text.
 * Returns matched chunks + whether paste matched KB (>= threshold).
 */
export async function pasteTextCrossReference(
  pastedText: string,
  ragIndexes: number[] = [1, 2]
): Promise<RetrieveResult> {
  return retrieve({ query: "", pastedText, ragIndexes });
}
