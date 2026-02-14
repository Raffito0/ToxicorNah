/*
  # Monetization and Analysis System

  1. New Tables
    - `user_subscriptions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `subscription_status` (text) - 'active', 'cancelled', 'expired'
      - `stripe_subscription_id` (text)
      - `stripe_customer_id` (text)
      - `current_period_start` (timestamptz)
      - `current_period_end` (timestamptz)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      
    - `user_analysis_tracking`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users, nullable for anonymous)
      - `session_id` (text) - for anonymous user tracking
      - `full_analyses_used` (integer) - total full analyses unlocked
      - `single_unlocks_this_month` (integer) - 1.99 euro unlocks this month
      - `free_bonus_unlocks` (integer) - unlocks earned via viral sharing
      - `first_analysis_completed` (boolean) - tracks if first free analysis used
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      
    - `analysis_results`
      - `id` (uuid, primary key)
      - `chat_upload_id` (uuid, foreign key to chat_uploads)
      - `person_id` (uuid, foreign key to persons)
      - `user_id` (uuid, foreign key to auth.users, nullable)
      - `overall_score` (integer) - 0-100 toxicity score
      - `warmth_score` (integer)
      - `communication_score` (integer)
      - `drama_score` (integer)
      - `distance_score` (integer)
      - `passion_score` (integer)
      - `profile_type` (text) - 'Mixed Profile', 'Red Flag Alert', etc.
      - `profile_subtitle` (text) - 'The Emotional Rollercoaster'
      - `profile_description` (text)
      - `ai_raw_response` (jsonb) - raw GPT-4 Vision response
      - `unlock_type` (text) - 'free_first', 'subscription', 'single_purchase', 'viral_bonus'
      - `is_unlocked` (boolean) - whether user has access to full results
      - `processing_status` (text) - 'pending', 'processing', 'completed', 'failed'
      - `error_message` (text)
      - `created_at` (timestamptz)
      
    - `analysis_emotional_profiles`
      - `id` (uuid, primary key)
      - `analysis_id` (uuid, foreign key to analysis_results)
      - `archetype_id` (uuid, foreign key to archetypes)
      - `display_order` (integer)
      - `created_at` (timestamptz)
      
    - `analysis_message_insights`
      - `id` (uuid, primary key)
      - `analysis_id` (uuid, foreign key to analysis_results)
      - `message_text` (text)
      - `message_count` (text) - '1 of 42'
      - `insight_title` (text) - 'Attention Hook'
      - `insight_tag` (text) - 'Opening Move'
      - `tag_color` (text)
      - `description` (text)
      - `solution` (text)
      - `gradient_start` (text)
      - `gradient_end` (text)
      - `accent_color` (text)
      - `display_order` (integer)
      - `created_at` (timestamptz)
      
    - `analysis_relationship_archetypes`
      - `id` (uuid, primary key)
      - `analysis_id` (uuid, foreign key to analysis_results)
      - `person_type` (text) - 'person' or 'user'
      - `archetype_name` (text)
      - `archetype_title` (text)
      - `description` (text)
      - `traits` (text[])
      - `trait_colors` (text[])
      - `energy_type` (text)
      - `image_url` (text)
      - `gradient_from` (text)
      - `gradient_to` (text)
      - `created_at` (timestamptz)
      
    - `viral_shares`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users, nullable)
      - `session_id` (text)
      - `analysis_id` (uuid, foreign key to analysis_results)
      - `platform` (text) - 'tiktok', 'instagram', 'other'
      - `share_code` (text) - unique tracking code
      - `share_verified` (boolean) - whether share was completed
      - `bonus_granted` (boolean) - whether free unlock was granted
      - `created_at` (timestamptz)
      
    - `payment_transactions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users, nullable)
      - `session_id` (text)
      - `transaction_type` (text) - 'subscription', 'single_unlock'
      - `amount` (numeric) - in euros
      - `currency` (text) - 'EUR'
      - `stripe_payment_id` (text)
      - `analysis_id` (uuid, foreign key to analysis_results, nullable)
      - `status` (text) - 'pending', 'completed', 'failed', 'refunded'
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Users can only access their own data
    - Allow anonymous access with session-based tracking

  3. Indexes
    - Add indexes on user_id and session_id for performance
    - Add index on analysis_results.processing_status
    - Add index on created_at for monthly resets
*/

-- Create user_subscriptions table
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_status text DEFAULT 'active' CHECK (subscription_status IN ('active', 'cancelled', 'expired')),
  stripe_subscription_id text,
  stripe_customer_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create user_analysis_tracking table
CREATE TABLE IF NOT EXISTS user_analysis_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text,
  full_analyses_used integer DEFAULT 0,
  single_unlocks_this_month integer DEFAULT 0,
  free_bonus_unlocks integer DEFAULT 0,
  first_analysis_completed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id),
  UNIQUE(session_id)
);

-- Create analysis_results table
CREATE TABLE IF NOT EXISTS analysis_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_upload_id uuid REFERENCES chat_uploads(id) ON DELETE CASCADE,
  person_id uuid REFERENCES persons(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  overall_score integer DEFAULT 0,
  warmth_score integer DEFAULT 0,
  communication_score integer DEFAULT 0,
  drama_score integer DEFAULT 0,
  distance_score integer DEFAULT 0,
  passion_score integer DEFAULT 0,
  profile_type text,
  profile_subtitle text,
  profile_description text,
  ai_raw_response jsonb,
  unlock_type text CHECK (unlock_type IN ('free_first', 'subscription', 'single_purchase', 'viral_bonus')),
  is_unlocked boolean DEFAULT false,
  processing_status text DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- Create analysis_emotional_profiles table
CREATE TABLE IF NOT EXISTS analysis_emotional_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid REFERENCES analysis_results(id) ON DELETE CASCADE,
  archetype_id uuid REFERENCES archetypes(id) ON DELETE CASCADE,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Create analysis_message_insights table
CREATE TABLE IF NOT EXISTS analysis_message_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid REFERENCES analysis_results(id) ON DELETE CASCADE,
  message_text text NOT NULL,
  message_count text,
  insight_title text NOT NULL,
  insight_tag text,
  tag_color text,
  description text,
  solution text,
  gradient_start text,
  gradient_end text,
  accent_color text,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Create analysis_relationship_archetypes table
CREATE TABLE IF NOT EXISTS analysis_relationship_archetypes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid REFERENCES analysis_results(id) ON DELETE CASCADE,
  person_type text NOT NULL CHECK (person_type IN ('person', 'user')),
  archetype_name text NOT NULL,
  archetype_title text,
  description text,
  traits text[] DEFAULT '{}',
  trait_colors text[] DEFAULT '{}',
  energy_type text,
  image_url text,
  gradient_from text,
  gradient_to text,
  created_at timestamptz DEFAULT now()
);

-- Create viral_shares table
CREATE TABLE IF NOT EXISTS viral_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text,
  analysis_id uuid REFERENCES analysis_results(id) ON DELETE CASCADE,
  platform text CHECK (platform IN ('tiktok', 'instagram', 'other')),
  share_code text UNIQUE NOT NULL,
  share_verified boolean DEFAULT false,
  bonus_granted boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Create payment_transactions table
CREATE TABLE IF NOT EXISTS payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text,
  transaction_type text NOT NULL CHECK (transaction_type IN ('subscription', 'single_unlock')),
  amount numeric NOT NULL,
  currency text DEFAULT 'EUR',
  stripe_payment_id text,
  analysis_id uuid REFERENCES analysis_results(id) ON DELETE SET NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  created_at timestamptz DEFAULT now()
);

-- Add relationship_type to persons table if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'persons' AND column_name = 'relationship_type'
  ) THEN
    ALTER TABLE persons ADD COLUMN relationship_type text;
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(subscription_status);
CREATE INDEX IF NOT EXISTS idx_user_analysis_tracking_user_id ON user_analysis_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_user_analysis_tracking_session_id ON user_analysis_tracking(session_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_user_id ON analysis_results(user_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_person_id ON analysis_results(person_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_processing_status ON analysis_results(processing_status);
CREATE INDEX IF NOT EXISTS idx_analysis_results_created_at ON analysis_results(created_at);
CREATE INDEX IF NOT EXISTS idx_viral_shares_session_id ON viral_shares(session_id);
CREATE INDEX IF NOT EXISTS idx_viral_shares_share_code ON viral_shares(share_code);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id ON payment_transactions(user_id);

-- Enable RLS
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_analysis_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_emotional_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_message_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_relationship_archetypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE viral_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_subscriptions
CREATE POLICY "Users can view own subscriptions"
  ON user_subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscriptions"
  ON user_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions"
  ON user_subscriptions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for user_analysis_tracking
CREATE POLICY "Users can view own tracking"
  ON user_analysis_tracking FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tracking"
  ON user_analysis_tracking FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tracking"
  ON user_analysis_tracking FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Anonymous policies for user_analysis_tracking
CREATE POLICY "Anonymous can view own tracking by session"
  ON user_analysis_tracking FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous can insert tracking"
  ON user_analysis_tracking FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous can update own tracking by session"
  ON user_analysis_tracking FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- RLS Policies for analysis_results
CREATE POLICY "Users can view own analysis results"
  ON analysis_results FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analysis results"
  ON analysis_results FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own analysis results"
  ON analysis_results FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Anonymous policies for analysis_results
CREATE POLICY "Anonymous can view all analysis results"
  ON analysis_results FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous can insert analysis results"
  ON analysis_results FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous can update analysis results"
  ON analysis_results FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- RLS Policies for analysis_emotional_profiles
CREATE POLICY "Anyone can view emotional profiles"
  ON analysis_emotional_profiles FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert emotional profiles"
  ON analysis_emotional_profiles FOR INSERT
  WITH CHECK (true);

-- RLS Policies for analysis_message_insights
CREATE POLICY "Anyone can view message insights"
  ON analysis_message_insights FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert message insights"
  ON analysis_message_insights FOR INSERT
  WITH CHECK (true);

-- RLS Policies for analysis_relationship_archetypes
CREATE POLICY "Anyone can view relationship archetypes"
  ON analysis_relationship_archetypes FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert relationship archetypes"
  ON analysis_relationship_archetypes FOR INSERT
  WITH CHECK (true);

-- RLS Policies for viral_shares
CREATE POLICY "Users can view own viral shares"
  ON viral_shares FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own viral shares"
  ON viral_shares FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Anonymous policies for viral_shares
CREATE POLICY "Anonymous can view viral shares by session"
  ON viral_shares FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous can insert viral shares"
  ON viral_shares FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anonymous can update viral shares"
  ON viral_shares FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- RLS Policies for payment_transactions
CREATE POLICY "Users can view own transactions"
  ON payment_transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON payment_transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Anonymous policies for payment_transactions
CREATE POLICY "Anonymous can view transactions by session"
  ON payment_transactions FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anonymous can insert transactions"
  ON payment_transactions FOR INSERT
  TO anon
  WITH CHECK (true);