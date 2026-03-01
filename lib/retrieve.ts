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
  case_facts: { primary: 0.52, fallback: 0.35 },
  case_timeline: { primary: 0.52, fallback: 0.35 },
  legal_concept: { primary: 0.58, fallback: 0.4 },
  procedure: { primary: 0.55, fallback: 0.38 },
  glossary: { primary: 0.6, fallback: 0.42 },
  paste_text: { primary: 0.58, fallback: 0.35 },
};

function getThresholds(intent?: string): { primary: number; fallback: number } {
  return INTENT_THRESHOLDS[intent ?? ""] ?? { primary: 0.55, fallback: 0.38 };
}
const POST_RERANK_TOP_K = 4;
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
}

export interface RetrieveResult {
  chunks: RetrievalChunk[];
  pasteTextMatched: boolean;
  retrievalConfidence: "high" | "medium" | "low";
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
  threshold: number
): Promise<RetrievalChunk[]> {
  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: embedding,
    match_rag_index: ragIndex ?? null,
    match_threshold: threshold,
    match_count: limit,
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
  limit = PRE_RERANK_TOP_K
): Promise<RetrievalChunk[]> {
  const { data, error } = await supabase.rpc("search_document_chunks_fts", {
    search_query: query,
    match_rag_index: ragIndex ?? null,
    match_count: limit,
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
 * Rerank: take top POST_RERANK_TOP_K from RRF-merged list.
 * FlashRank is Python-only; we use RRF order as reranked order for now.
 */
function rerank(chunks: RetrievalChunk[]): RetrievalChunk[] {
  return chunks.slice(0, POST_RERANK_TOP_K);
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
  const { query, ragIndexes, pastedText, intent } = options;
  const searchText = pastedText ?? query;
  const supabase = getSupabase();

  const { primary: primaryThreshold, fallback: fallbackThreshold } = getThresholds(intent);
  const matchIndex = toMatchRagIndex(ragIndexes);
  const embedding = await embedText(searchText);

  const [vecChunks, ftsChunks] = await Promise.all([
    vectorSearch(supabase, embedding, matchIndex, PRE_RERANK_TOP_K, primaryThreshold),
    bm25Search(supabase, searchText, matchIndex, PRE_RERANK_TOP_K),
  ]);

  let merged = rrfMerge(vecChunks, ftsChunks);
  let usedFallback = false;
  let usedDualIndexFallback = false;

  // Fallback: if both vector and FTS return 0, retry vector with lower threshold
  if (merged.length === 0 && matchIndex !== undefined) {
    const { data: fallbackData } = await supabase.rpc("match_document_chunks", {
      query_embedding: embedding,
      match_rag_index: matchIndex,
      match_threshold: fallbackThreshold,
      match_count: PRE_RERANK_TOP_K,
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
      bm25Search(supabase, searchText, undefined, PRE_RERANK_TOP_K),
    ]);
    merged = rrfMerge(vecFallback, ftsFallback);
    if (merged.length > 0) {
      usedDualIndexFallback = true;
    }
  }

  const topChunks = rerank(merged);

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
