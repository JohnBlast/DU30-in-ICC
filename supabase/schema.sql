-- ============================================
-- The Docket — Database Schema
-- ============================================
-- Run this in Supabase SQL Editor after enabling pgvector:
--   CREATE EXTENSION IF NOT EXISTS vector;
-- ============================================

-- Enable pgvector (run separately if not already done)
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- 2.1 icc_documents
-- ============================================
CREATE TABLE IF NOT EXISTS icc_documents (
  document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  document_type TEXT NOT NULL CHECK (document_type IN ('case_record', 'press_release', 'legal_text', 'case_info_sheet')),
  date_published DATE,
  rag_index SMALLINT NOT NULL CHECK (rag_index IN (1, 2)),
  content_hash TEXT NOT NULL,
  last_crawled_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_icc_documents_rag_index ON icc_documents(rag_index);
CREATE INDEX IF NOT EXISTS idx_icc_documents_url ON icc_documents(url);
CREATE INDEX IF NOT EXISTS idx_icc_documents_content_hash ON icc_documents(content_hash);

-- ============================================
-- 2.2 document_chunks
-- ============================================
CREATE TABLE IF NOT EXISTS document_chunks (
  chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES icc_documents(document_id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  chunk_index INTEGER NOT NULL,
  token_count INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_rag_index ON document_chunks((metadata->>'rag_index'));
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding ON document_chunks 
  USING hnsw (embedding vector_cosine_ops);

-- ============================================
-- 2.3 users
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_admin BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- ============================================
-- 2.4 conversations
-- ============================================
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title TEXT DEFAULT 'New conversation',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_expires_at ON conversations(expires_at);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_bookmarked BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_conversations_is_bookmarked ON conversations(is_bookmarked) WHERE is_bookmarked = true;

-- ============================================
-- 2.5 messages
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
  message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  citations JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

-- Trigger: Update expires_at to 7 days from last_message_at when a message is added
CREATE OR REPLACE FUNCTION update_conversation_expiry()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET last_message_at = NOW(),
      expires_at = NOW() + INTERVAL '7 days'
  WHERE conversation_id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_conversation_expiry ON messages;
CREATE TRIGGER trg_update_conversation_expiry
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_conversation_expiry();

-- ============================================
-- 2.6 usage_tracking
-- ============================================
CREATE TABLE IF NOT EXISTS usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  query_count INTEGER DEFAULT 0,
  global_month TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM'),
  global_total_cost NUMERIC(12, 6) DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_usage_tracking_user_date ON usage_tracking(user_id, date);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_global_month ON usage_tracking(global_month);

-- ============================================
-- 2.7 Vector similarity search (cosine distance)
-- ============================================
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(1536),
  match_rag_index SMALLINT DEFAULT NULL,
  match_threshold FLOAT DEFAULT 0.68,
  match_count INT DEFAULT 10
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
    AND (1 - (dc.embedding <=> query_embedding)) >= match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 2.8 Full-text search (BM25-style) on document_chunks.content
-- ============================================
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS content_tsv tsvector 
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

CREATE INDEX IF NOT EXISTS idx_document_chunks_content_fts 
  ON document_chunks USING GIN(content_tsv);

-- Full-text search function callable via RPC
CREATE OR REPLACE FUNCTION search_document_chunks_fts(
  search_query TEXT,
  match_rag_index SMALLINT DEFAULT NULL,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  metadata JSONB,
  rank REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.chunk_id,
    dc.document_id,
    dc.content,
    dc.metadata,
    ts_rank(dc.content_tsv, plainto_tsquery('english', search_query)) AS rank
  FROM document_chunks dc
  JOIN icc_documents d ON dc.document_id = d.document_id
  WHERE
    dc.content_tsv @@ plainto_tsquery('english', search_query)
    AND (match_rag_index IS NULL OR d.rag_index = match_rag_index)
  ORDER BY rank DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;
