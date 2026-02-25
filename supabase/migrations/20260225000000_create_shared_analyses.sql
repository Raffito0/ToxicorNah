-- Shared analyses for CALL HIM OUT link sharing
-- Stores only card preview data (no chat content or detailed analysis)
CREATE TABLE shared_analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  soul_type_title TEXT NOT NULL,
  soul_type_tagline TEXT NOT NULL,
  soul_type_image_url TEXT NOT NULL,
  overall_score INTEGER NOT NULL,
  person_gender TEXT NOT NULL DEFAULT 'male',
  gradient_from TEXT,
  gradient_to TEXT,
  og_image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  view_count INTEGER DEFAULT 0
);

ALTER TABLE shared_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read shared analyses"
  ON shared_analyses FOR SELECT USING (true);

CREATE POLICY "Anyone can create shared analyses"
  ON shared_analyses FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update view count"
  ON shared_analyses FOR UPDATE USING (true);
