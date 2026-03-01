/**
 * Test endpoint for RAG retrieval.
 * GET /api/retrieve?q=What+is+Duterte+charged+with&rag=2
 */

import { NextResponse } from "next/server";
import { retrieve } from "@/lib/retrieve";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const rag = searchParams.get("rag");
  const paste = searchParams.get("paste");

  if (!q && !paste) {
    return NextResponse.json({ error: "Missing q or paste" }, { status: 400 });
  }

  const ragIndexes =
    rag === "1" ? [1] : rag === "2" ? [2] : [1, 2];
  const result = await retrieve({
    query: q ?? "",
    pastedText: paste ?? undefined,
    ragIndexes,
  });

  const body = {
    chunkCount: result.chunks.length,
    pasteTextMatched: result.pasteTextMatched,
    chunks: result.chunks.map((c) => ({
      chunk_id: c.chunk_id,
      document_title: c.metadata.document_title,
      similarity: c.similarity,
      content_preview: c.content.slice(0, 200) + "...",
    })),
  };

  const pretty = searchParams.get("pretty") !== null;
  return new NextResponse(JSON.stringify(body, null, pretty ? 2 : undefined), {
    headers: { "Content-Type": "application/json" },
  });
}
