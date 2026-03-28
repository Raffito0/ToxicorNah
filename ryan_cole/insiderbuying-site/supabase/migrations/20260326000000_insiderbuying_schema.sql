-- EarlyInsider — Supabase Schema
-- Run this after creating the Supabase project

-- ============================================================
-- 1. PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  subscription_tier TEXT NOT NULL DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro')),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- ============================================================
-- 2. SUBSCRIPTIONS
-- ============================================================
CREATE TABLE public.subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'pro')),
  status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'trialing')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- 3. INSIDER ALERTS (Realtime-enabled)
-- ============================================================
CREATE TABLE public.insider_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker TEXT NOT NULL,
  company_name TEXT,
  insider_name TEXT NOT NULL,
  insider_title TEXT,
  transaction_type TEXT CHECK (transaction_type IN ('buy', 'sell')),
  shares INTEGER,
  price_per_share NUMERIC(10,2),
  total_value NUMERIC(14,2),
  filing_date DATE,
  significance_score INTEGER CHECK (significance_score BETWEEN 1 AND 10),
  ai_analysis TEXT,
  cluster_id UUID,
  is_cluster_buy BOOLEAN DEFAULT FALSE,
  raw_filing_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.insider_alerts ENABLE ROW LEVEL SECURITY;

-- Public read for all authenticated users (ai_analysis filtered in API by tier)
CREATE POLICY "Authenticated users can read alerts"
  ON public.insider_alerts FOR SELECT
  TO authenticated
  USING (true);

-- Service role can insert (from n8n workflows)
CREATE POLICY "Service role can insert alerts"
  ON public.insider_alerts FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.insider_alerts;

-- ============================================================
-- 4. USER ALERT PREFERENCES
-- ============================================================
CREATE TABLE public.user_alert_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  email_enabled BOOLEAN DEFAULT TRUE,
  push_enabled BOOLEAN DEFAULT FALSE,
  min_significance_score INTEGER DEFAULT 6,
  watched_tickers TEXT[] DEFAULT '{}',
  sectors TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_alert_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own alert preferences"
  ON public.user_alert_preferences FOR ALL
  USING (auth.uid() = user_id);

-- ============================================================
-- 5. ARTICLES CACHE (denormalized from NocoDB for fast SSR)
-- ============================================================
CREATE TABLE public.articles_cache (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nocodb_record_id TEXT UNIQUE,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  meta_description TEXT,
  body_html TEXT,
  key_takeaways TEXT,
  verdict_type TEXT,
  ticker TEXT,
  hero_image_url TEXT,
  published_at TIMESTAMPTZ,
  word_count INTEGER
);

ALTER TABLE public.articles_cache ENABLE ROW LEVEL SECURITY;

-- Public read (blog articles are public content)
CREATE POLICY "Anyone can read articles"
  ON public.articles_cache FOR SELECT
  USING (true);

-- Service role can manage articles
CREATE POLICY "Service role can manage articles"
  ON public.articles_cache FOR ALL
  TO service_role
  USING (true);

-- ============================================================
-- 6. REPORTS (purchased PDFs)
-- ============================================================
CREATE TABLE public.reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  report_type TEXT CHECK (report_type IN ('data_study', 'premium', 'lead_magnet')),
  title TEXT,
  stripe_payment_id TEXT,
  pdf_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own reports"
  ON public.reports FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- 7. NEWSLETTER SUBSCRIBERS
-- ============================================================
CREATE TABLE public.newsletter_subscribers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  source TEXT DEFAULT 'site',
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unsubscribed_at TIMESTAMPTZ
);

ALTER TABLE public.newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- Anyone can subscribe (anon insert for email capture)
CREATE POLICY "Anyone can subscribe to newsletter"
  ON public.newsletter_subscribers FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ============================================================
-- 8. INDEXES
-- ============================================================
CREATE INDEX idx_insider_alerts_ticker ON public.insider_alerts(ticker);
CREATE INDEX idx_insider_alerts_created ON public.insider_alerts(created_at DESC);
CREATE INDEX idx_insider_alerts_score ON public.insider_alerts(significance_score DESC);
CREATE INDEX idx_insider_alerts_cluster ON public.insider_alerts(cluster_id) WHERE cluster_id IS NOT NULL;
CREATE INDEX idx_articles_cache_slug ON public.articles_cache(slug);
CREATE INDEX idx_articles_cache_published ON public.articles_cache(published_at DESC);
CREATE INDEX idx_articles_cache_ticker ON public.articles_cache(ticker);
CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX idx_reports_user ON public.reports(user_id);

-- ============================================================
-- 9. AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 10. AUTO-CREATE ALERT PREFERENCES ON SIGNUP
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user_preferences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_alert_preferences (user_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_preferences
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_preferences();
