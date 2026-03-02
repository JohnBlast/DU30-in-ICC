-- Add glossary document type for synthetic glossary chunks (production-hardening Phase 5)
ALTER TABLE icc_documents DROP CONSTRAINT IF EXISTS icc_documents_document_type_check;
ALTER TABLE icc_documents ADD CONSTRAINT icc_documents_document_type_check
  CHECK (document_type IN ('case_record', 'press_release', 'legal_text', 'case_info_sheet', 'transcript', 'glossary'));
