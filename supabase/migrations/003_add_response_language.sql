-- Add response_language column to conversations table for multilingual support.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS response_language VARCHAR(10) DEFAULT 'en';
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS valid_response_language;
ALTER TABLE conversations ADD CONSTRAINT valid_response_language
  CHECK (response_language IN ('en', 'tl', 'taglish'));
