-- Create table for relationship dynamic (The Dynamic section)
CREATE TABLE IF NOT EXISTS analysis_relationship_dynamic (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analysis_id UUID NOT NULL REFERENCES analysis_results(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  why_this_happens TEXT NOT NULL,
  pattern_break TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- One relationship dynamic per analysis
  UNIQUE(analysis_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_relationship_dynamic_analysis_id
  ON analysis_relationship_dynamic(analysis_id);

-- Enable RLS
ALTER TABLE analysis_relationship_dynamic ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow users to view their own relationship dynamics
CREATE POLICY "Users can view their own relationship dynamics"
  ON analysis_relationship_dynamic FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM analysis_results ar
      JOIN chat_uploads cu ON ar.chat_upload_id = cu.id
      WHERE ar.id = analysis_relationship_dynamic.analysis_id
      AND (cu.user_id = auth.uid() OR cu.user_id IS NULL)
    )
  );

-- RLS Policy: Service role can insert
CREATE POLICY "Service role can insert relationship dynamics"
  ON analysis_relationship_dynamic FOR INSERT
  WITH CHECK (true);

-- Grant permissions
GRANT SELECT ON analysis_relationship_dynamic TO authenticated;
GRANT SELECT ON analysis_relationship_dynamic TO anon;
GRANT INSERT ON analysis_relationship_dynamic TO authenticated;
GRANT INSERT ON analysis_relationship_dynamic TO anon;
