-- insider_alerts v2 — add missing columns, fix CHECK constraint, add UPDATE policy
-- Note: cluster_id and is_cluster_buy already exist from v1 migration.

-- Add missing columns (all idempotent via IF NOT EXISTS)
ALTER TABLE public.insider_alerts
  ADD COLUMN IF NOT EXISTS transaction_date DATE,
  ADD COLUMN IF NOT EXISTS dedup_key TEXT,
  ADD COLUMN IF NOT EXISTS insider_category TEXT,
  ADD COLUMN IF NOT EXISTS score_reasoning TEXT,
  ADD COLUMN IF NOT EXISTS cluster_size INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emails_sent INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS push_sent INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_log TEXT;

-- Unique index on dedup_key (partial — only for non-null keys)
CREATE UNIQUE INDEX IF NOT EXISTS idx_insider_alerts_dedup
  ON public.insider_alerts(dedup_key)
  WHERE dedup_key IS NOT NULL;

-- Index on status for deliver-alert.js queries (WHERE status = 'new')
CREATE INDEX IF NOT EXISTS idx_insider_alerts_status
  ON public.insider_alerts(status, created_at DESC);

-- Fix transaction_type CHECK constraint to include 'cluster'
-- PostgreSQL auto-names this constraint 'insider_alerts_transaction_type_check'.
-- Drop first (idempotent: IF EXISTS), then re-add inside a guard block.
ALTER TABLE public.insider_alerts
  DROP CONSTRAINT IF EXISTS insider_alerts_transaction_type_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.insider_alerts'::regclass
      AND conname = 'insider_alerts_transaction_type_check'
  ) THEN
    ALTER TABLE public.insider_alerts
      ADD CONSTRAINT insider_alerts_transaction_type_check
      CHECK (transaction_type IN ('buy', 'sell', 'cluster'));
  END IF;
END
$$;

-- Add status CHECK constraint (state-machine values for delivery tracking)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.insider_alerts'::regclass
      AND conname = 'insider_alerts_status_check'
  ) THEN
    ALTER TABLE public.insider_alerts
      ADD CONSTRAINT insider_alerts_status_check
      CHECK (status IN ('new', 'processed', 'delivered', 'delivery_failed', 'dead_letter'));
  END IF;
END
$$;

-- Add service_role UPDATE policy (required for cluster detection to patch existing rows)
-- Without this, the UPDATE runs but affects 0 rows silently (RLS blocks it).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'insider_alerts'
      AND policyname = 'service_role can update insider_alerts'
  ) THEN
    EXECUTE '
      CREATE POLICY "service_role can update insider_alerts"
        ON public.insider_alerts
        FOR UPDATE
        TO service_role
        USING (true)
        WITH CHECK (true)
    ';
  END IF;
END
$$;
