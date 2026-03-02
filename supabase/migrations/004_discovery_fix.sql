-- Discovery fix + data pipeline improvements (cursor-discovery-fix-prompt.md)
-- Add transcript, date_published, document-type filter, BM25 phrase boost

-- 1. Add transcript to document_type
ALTER TABLE icc_documents DROP CONSTRAINT IF EXISTS icc_documents_document_type_check;
ALTER TABLE icc_documents ADD CONSTRAINT icc_documents_document_type_check
  CHECK (document_type IN ('case_record', 'press_release', 'legal_text', 'case_info_sheet', 'transcript'));

-- 2. Update match_document_chunks with optional document_type filter
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(1536),
  match_rag_index SMALLINT DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.68,
  match_count INT DEFAULT 10,
  match_document_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.chunk_id,
    dc.document_id,
    dc.content,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  JOIN icc_documents d ON dc.document_id = d.document_id
  WHERE
    (match_rag_index IS NULL OR d.rag_index = match_rag_index)
    AND (match_document_type IS NULL OR d.document_type = match_document_type)
    AND (1 - (dc.embedding <=> query_embedding)) >= match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- 3. Update search_document_chunks_fts with phrase boost and document_type filter
CREATE OR REPLACE FUNCTION search_document_chunks_fts(
  search_query TEXT,
  match_rag_index SMALLINT DEFAULT NULL,
  match_count INT DEFAULT 10,
  match_document_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  metadata JSONB,
  rank REAL
) AS $$
DECLARE
  phrase_tsquery tsquery;
  plain_tsquery tsquery;
BEGIN
  phrase_tsquery := phraseto_tsquery('english', search_query);
  plain_tsquery := plainto_tsquery('english', search_query);

  RETURN QUERY
  SELECT
    dc.chunk_id,
    dc.document_id,
    dc.content,
    dc.metadata,
    (CASE
      WHEN dc.content_tsv @@ phrase_tsquery
        THEN ts_rank(dc.content_tsv, phrase_tsquery) * 2.0
      ELSE ts_rank(dc.content_tsv, plain_tsquery)
    END)::real AS rank
  FROM document_chunks dc
  JOIN icc_documents d ON dc.document_id = d.document_id
  WHERE
    dc.content_tsv @@ plain_tsquery
    AND (match_rag_index IS NULL OR d.rag_index = match_rag_index)
    AND (match_document_type IS NULL OR d.document_type = match_document_type)
  ORDER BY rank DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
