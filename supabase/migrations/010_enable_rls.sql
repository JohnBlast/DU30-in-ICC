-- ============================================
-- Migration 010: Enable Row Level Security (RLS)
-- ============================================
-- Supabase linter flagged public tables without RLS.
-- Enabling RLS blocks direct REST API access via the anon key.
-- The app uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
-- ============================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.icc_documents ENABLE ROW LEVEL SECURITY;
