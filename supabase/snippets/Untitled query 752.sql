CREATE TABLE IF NOT EXISTS analysis_relationship_dynamic (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analysis_id UUID NOT NULL REFERENCES analysis_results(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  why_this_happens TEXT NOT NULL,
  pattern_break TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(analysis_id)
);

CREATE INDEX IF NOT EXISTS idx_relationship_dynamic_analysis_id
  ON analysis_relationship_dynamic(analysis_id);