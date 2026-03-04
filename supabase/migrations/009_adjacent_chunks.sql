-- Adjacent chunk fetch for list/name queries (cursor-indirect-coperpetration-fix P0-2).
-- Fetches chunks from the same document with adjacent chunk_index for same-document neighborhood.

CREATE OR REPLACE FUNCTION get_adjacent_chunks(
  target_chunk_id UUID,
  neighbor_count INT DEFAULT 2
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  metadata JSONB
) AS $$
  WITH target AS (
    SELECT document_id, chunk_index
    FROM document_chunks
    WHERE chunk_id = target_chunk_id
  )
  SELECT
    dc.chunk_id,
    dc.document_id,
    dc.content,
    dc.metadata
  FROM document_chunks dc
  JOIN target t ON dc.document_id = t.document_id
  WHERE dc.chunk_id != target_chunk_id
  ORDER BY ABS(dc.chunk_index - t.chunk_index)
  LIMIT neighbor_count;
$$ LANGUAGE sql STABLE;
