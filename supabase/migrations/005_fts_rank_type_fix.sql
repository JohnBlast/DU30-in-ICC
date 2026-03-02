-- Fix: "structure of query does not match function result type"
-- ts_rank * 2.0 yields double precision; RETURNS TABLE expects rank REAL.
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
