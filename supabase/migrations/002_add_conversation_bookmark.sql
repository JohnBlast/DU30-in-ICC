-- Add is_bookmarked to conversations for bookmark UX.
-- Run in Supabase SQL Editor if db:migrate is not used, or if schema was applied before this change.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_bookmarked BOOLEAN DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_conversations_is_bookmarked ON conversations(is_bookmarked) WHERE is_bookmarked = true;
