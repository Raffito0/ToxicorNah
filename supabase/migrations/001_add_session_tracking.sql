-- Add session_id column to user_analysis_tracking for anonymous user support
ALTER TABLE user_analysis_tracking
ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Add full_analyses_used column
ALTER TABLE user_analysis_tracking
ADD COLUMN IF NOT EXISTS full_analyses_used INTEGER DEFAULT 0;

-- Remove UNIQUE constraint on user_id to allow multiple sessions
ALTER TABLE user_analysis_tracking
DROP CONSTRAINT IF EXISTS user_analysis_tracking_user_id_key;

-- Add index on session_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_analysis_tracking_session_id
ON user_analysis_tracking(session_id);

-- Update RLS policies for session-based tracking
DROP POLICY IF EXISTS "Users can view own tracking" ON user_analysis_tracking;
DROP POLICY IF EXISTS "Users can insert own tracking" ON user_analysis_tracking;
DROP POLICY IF EXISTS "Users can update own tracking" ON user_analysis_tracking;

-- Allow anyone to view/insert/update tracking (session-based security)
CREATE POLICY "Anyone can view tracking"
  ON user_analysis_tracking FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Anyone can insert tracking"
  ON user_analysis_tracking FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Anyone can update tracking"
  ON user_analysis_tracking FOR UPDATE
  TO public
  USING (true);

-- Update user_subscriptions to remove UNIQUE constraint on user_id
-- to allow upsert operations
ALTER TABLE user_subscriptions
DROP CONSTRAINT IF EXISTS user_subscriptions_user_id_key;

-- Add session_id to user_subscriptions for anonymous users
ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS session_id TEXT;

-- Create index on session_id
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_session_id
ON user_subscriptions(session_id);
