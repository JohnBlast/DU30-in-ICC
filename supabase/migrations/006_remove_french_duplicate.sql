-- Remove French-language duplicate of Article 15(3) decision
-- (Cascades to document_chunks via ON DELETE CASCADE)
DELETE FROM icc_documents
WHERE title LIKE 'Décision relative à la demande%';
