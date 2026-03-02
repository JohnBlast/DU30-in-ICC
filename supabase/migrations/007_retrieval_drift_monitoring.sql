-- Retrieval Drift Monitoring (docket-improvement-plan.md §24)
-- Canonical tests for retrieval regression detection.

CREATE TABLE IF NOT EXISTS retrieval_canonical_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query TEXT NOT NULL,
  expected_chunk_ids UUID[] NOT NULL,
  rag_indexes INT[] NOT NULL,
  intent TEXT,
  min_overlap_ratio FLOAT NOT NULL DEFAULT 0.8,
  is_critical BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS retrieval_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id UUID REFERENCES retrieval_canonical_tests(id) ON DELETE CASCADE,
  actual_chunk_ids UUID[] NOT NULL,
  overlap_ratio FLOAT NOT NULL,
  passed BOOLEAN NOT NULL,
  run_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retrieval_test_runs_test_id ON retrieval_test_runs(test_id);
CREATE INDEX IF NOT EXISTS idx_retrieval_test_runs_run_at ON retrieval_test_runs(run_at);
