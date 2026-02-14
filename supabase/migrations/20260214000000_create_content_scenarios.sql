-- Content scenarios table for loading approved n8n scenarios in the app
CREATE TABLE content_scenarios (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scenario_id TEXT NOT NULL UNIQUE,        -- e.g. "toxic-caught-lying-1707123456"
  scenario_json JSONB NOT NULL,            -- full ContentScenario JSON
  status TEXT DEFAULT 'approved',          -- approved / used / archived
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Allow anonymous reads (for loading on phone without auth)
ALTER TABLE content_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read scenarios" ON content_scenarios FOR SELECT USING (true);
