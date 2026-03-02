-- ================================================
-- TOXIC OR NAH - DATABASE SETUP SCRIPT
-- Run this in Supabase SQL Editor to set up everything
-- ================================================

-- Step 1: Create Emotional Analysis Tables
-- ================================================

CREATE TABLE IF NOT EXISTS archetypes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  category_number INTEGER NOT NULL,
  gradient_start TEXT NOT NULL,
  gradient_end TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS archetype_traits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  archetype_id UUID REFERENCES archetypes(id) ON DELETE CASCADE,
  trait TEXT NOT NULL,
  trait_color TEXT NOT NULL DEFAULT '#FFFFFF',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Create Persons and Chat Uploads Tables
-- ================================================

CREATE TABLE IF NOT EXISTS persons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  is_demo BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_uploads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id UUID REFERENCES persons(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  analysis_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 3: Create Analysis and Monetization Tables
-- ================================================

CREATE TABLE IF NOT EXISTS analysis_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_upload_id UUID REFERENCES chat_uploads(id) ON DELETE CASCADE,
  person_id UUID REFERENCES persons(id) ON DELETE CASCADE,
  overall_score INTEGER,
  warmth_score INTEGER,
  communication_score INTEGER,
  drama_score INTEGER,
  distance_score INTEGER,
  passion_score INTEGER,
  profile_type TEXT,
  profile_subtitle TEXT,
  profile_description TEXT,
  ai_raw_response JSONB,
  processing_status TEXT DEFAULT 'pending',
  error_message TEXT,
  is_unlocked BOOLEAN DEFAULT FALSE,
  unlock_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analysis_emotional_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id UUID REFERENCES analysis_results(id) ON DELETE CASCADE,
  archetype_id UUID REFERENCES archetypes(id) ON DELETE CASCADE,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analysis_message_insights (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id UUID REFERENCES analysis_results(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL,
  message_count TEXT,
  insight_title TEXT NOT NULL,
  insight_tag TEXT,
  tag_color TEXT,
  description TEXT NOT NULL,
  solution TEXT,
  gradient_start TEXT,
  gradient_end TEXT,
  accent_color TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analysis_relationship_archetypes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  analysis_id UUID REFERENCES analysis_results(id) ON DELETE CASCADE,
  person_type TEXT NOT NULL CHECK (person_type IN ('person', 'user')),
  archetype_name TEXT NOT NULL,
  archetype_title TEXT NOT NULL,
  description TEXT NOT NULL,
  traits TEXT[] NOT NULL,
  trait_colors TEXT[] NOT NULL,
  energy_type TEXT NOT NULL,
  image_url TEXT,
  gradient_from TEXT,
  gradient_to TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  subscription_type TEXT NOT NULL CHECK (subscription_type IN ('toxic_unlimited')),
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due')),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_analysis_tracking (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  has_used_first_free_analysis BOOLEAN DEFAULT FALSE,
  single_unlocks_used_this_month INTEGER DEFAULT 0,
  single_unlocks_max_per_month INTEGER DEFAULT 2,
  viral_bonus_unlocks_available INTEGER DEFAULT 0,
  last_single_unlock_reset TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_payment_intent_id TEXT UNIQUE,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'eur',
  payment_type TEXT NOT NULL CHECK (payment_type IN ('subscription', 'single_unlock')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS viral_shares (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('tiktok', 'instagram', 'other')),
  bonus_granted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 4: Create Illustrations System
-- ================================================

CREATE TABLE IF NOT EXISTS illustrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  alt_text TEXT,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS illustration_mappings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  archetype_id UUID REFERENCES archetypes(id) ON DELETE CASCADE,
  illustration_id UUID REFERENCES illustrations(id) ON DELETE CASCADE,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(archetype_id, illustration_id)
);

-- Step 5: Create Storage Bucket
-- ================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-screenshots', 'chat-screenshots', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS Policies
CREATE POLICY IF NOT EXISTS "Authenticated users can upload chat screenshots"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'chat-screenshots');

CREATE POLICY IF NOT EXISTS "Anonymous users can upload chat screenshots"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'chat-screenshots');

CREATE POLICY IF NOT EXISTS "Public can view chat screenshots"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'chat-screenshots');

-- Step 6: Enable Row Level Security (RLS) on all tables
-- ================================================

ALTER TABLE archetypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE archetype_traits ENABLE ROW LEVEL SECURITY;
ALTER TABLE persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_emotional_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_message_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_relationship_archetypes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_analysis_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE viral_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE illustrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE illustration_mappings ENABLE ROW LEVEL SECURITY;

-- Step 7: Create RLS Policies (Public Read Access for Demo)
-- ================================================

-- Allow public to view archetypes
CREATE POLICY IF NOT EXISTS "Anyone can view archetypes"
  ON archetypes FOR SELECT
  TO public
  USING (true);

CREATE POLICY IF NOT EXISTS "Anyone can view archetype traits"
  ON archetype_traits FOR SELECT
  TO public
  USING (true);

-- Allow users to view their own persons
CREATE POLICY IF NOT EXISTS "Users can view their own persons"
  ON persons FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR is_demo = true);

CREATE POLICY IF NOT EXISTS "Anonymous users can view demo persons"
  ON persons FOR SELECT
  TO anon
  USING (is_demo = true);

CREATE POLICY IF NOT EXISTS "Users can create persons"
  ON persons FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

-- Chat uploads policies
CREATE POLICY IF NOT EXISTS "Users can view their own chat uploads"
  ON chat_uploads FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY IF NOT EXISTS "Users can create chat uploads"
  ON chat_uploads FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

-- Analysis results policies
CREATE POLICY IF NOT EXISTS "Users can view analysis results"
  ON analysis_results FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY IF NOT EXISTS "Users can create analysis results"
  ON analysis_results FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "Users can update analysis results"
  ON analysis_results FOR UPDATE
  TO authenticated, anon
  USING (true);

-- Analysis emotional profiles policies
CREATE POLICY IF NOT EXISTS "Anyone can view emotional profiles"
  ON analysis_emotional_profiles FOR SELECT
  TO public
  USING (true);

CREATE POLICY IF NOT EXISTS "Users can insert emotional profiles"
  ON analysis_emotional_profiles FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

-- Message insights policies
CREATE POLICY IF NOT EXISTS "Anyone can view message insights"
  ON analysis_message_insights FOR SELECT
  TO public
  USING (true);

CREATE POLICY IF NOT EXISTS "Users can insert message insights"
  ON analysis_message_insights FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

-- Relationship archetypes policies
CREATE POLICY IF NOT EXISTS "Anyone can view relationship archetypes"
  ON analysis_relationship_archetypes FOR SELECT
  TO public
  USING (true);

CREATE POLICY IF NOT EXISTS "Users can insert relationship archetypes"
  ON analysis_relationship_archetypes FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

-- User tracking policies
CREATE POLICY IF NOT EXISTS "Users can view own tracking"
  ON user_analysis_tracking FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "Users can insert own tracking"
  ON user_analysis_tracking FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "Users can update own tracking"
  ON user_analysis_tracking FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- Illustrations policies
CREATE POLICY IF NOT EXISTS "Anyone can view illustrations"
  ON illustrations FOR SELECT
  TO public
  USING (true);

CREATE POLICY IF NOT EXISTS "Anyone can view illustration mappings"
  ON illustration_mappings FOR SELECT
  TO public
  USING (true);

-- ================================================
-- DATABASE SETUP COMPLETE!
-- ================================================
